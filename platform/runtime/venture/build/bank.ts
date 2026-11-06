// Chausar venture launcher: the read-only bank connector shape (package P2-connectors).
// No bank provider is wired in this build (in India it would be an RBI account aggregator), so the card says planned.
// What is real: importing a statement file into exact minor units, a stable id per transaction so a re-import never
// counts anything twice, consent with an end date the owner can see, a cap on unattended reads, and alerts that go only
// to the address the owner set inside the app. The model can read a view without that address and can change none of it.
// Money is BigInt minor units as decimal text; nothing here rounds, and an amount with too many decimals is refused.
// Ideas from noskillish/bankmcp (MIT, Copyright (c) 2026 Nils Smed): the twin counter and the four-a-day polling limit,
// and (Ink v2 wave 2, 2D) pairing transfers between the owner's own accounts (findOwnTransfers) and whole-word search for
// an invoice number. These are rewrites in TypeScript on BigInt minor units, not copies.
import { createHash } from 'node:crypto';
import { check, type Context } from '../../contracts.ts';
import { decimalMinor, formatMinor } from '../../currency.ts';
import type { DateOrder, IsoDate, IsoTime, MinorString } from '../contracts.ts';
import { formatVentureDate, isAppChannel, isoDate, singleLine } from '../records.ts';
import { validDate } from '../../memory.ts';
import { checkUrl } from '../core/net-guard.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const BANK_POLLS_PER_DAY = 4; // the PSD2 limit for reads the owner did not start; kept everywhere
export const CONSENT_MAX_DAYS = 365;
export const CONSENT_WARN_DAYS = 7;
const MAX_STATEMENT_CHARS = 2 * 1024 * 1024;
const MAX_STATEMENT_ROWS = 20000;

// ---------------------------------------------------------------------------
// Consent and polling
// ---------------------------------------------------------------------------

export type BankConsent = {
  id: string;
  provider: string | null; // null until a provider is wired
  accountLabel: string;
  scope: 'read-only';
  grantedAt: IsoTime;
  expiresAt: IsoTime;
  revokedAt: IsoTime | null;
};
export type ConsentStatus = { state: 'active' | 'expiring' | 'expired' | 'revoked'; daysLeft: number; line: string };

export function grantConsent(input: { id: string; provider: string | null; accountLabel: string; grantedAt: IsoTime; days: number }): BankConsent {
  check(Number.isInteger(input.days) && input.days >= 1 && input.days <= CONSENT_MAX_DAYS, 'INVALID_VENTURE_REQUEST', `Consent lasts one to ${CONSENT_MAX_DAYS} days.`);
  const granted = Date.parse(input.grantedAt);
  check(Number.isFinite(granted), 'INVALID_VENTURE_REQUEST', 'Consent needs the time it was given.');
  return {
    id: input.id, provider: input.provider, accountLabel: input.accountLabel, scope: 'read-only',
    grantedAt: new Date(granted).toISOString(), expiresAt: new Date(granted + input.days * DAY_MS).toISOString(), revokedAt: null,
  };
}

export function revokeConsent(consent: BankConsent, at: IsoTime): BankConsent {
  return { ...consent, revokedAt: consent.revokedAt ?? at };
}

/** The end date in words, shown wherever bank data is shown. */
export function consentStatus(consent: BankConsent, now: Date, order: DateOrder = 'day-month-year'): ConsentStatus {
  const ends = formatVentureDate(consent.expiresAt.slice(0, 10), order);
  if (consent.revokedAt) return { state: 'revoked', daysLeft: 0, line: `You stopped bank access on ${formatVentureDate(consent.revokedAt.slice(0, 10), order)}.` };
  const left = Date.parse(consent.expiresAt) - now.getTime();
  if (left <= 0) return { state: 'expired', daysLeft: 0, line: `Bank access ended on ${ends}. Renew it to read again.` };
  const daysLeft = Math.ceil(left / DAY_MS);
  const days = daysLeft === 1 ? 'in 1 day' : `in ${daysLeft} days`;
  if (daysLeft <= CONSENT_WARN_DAYS) return { state: 'expiring', daysLeft, line: `Bank access ends on ${ends}, ${days}. Renew it before then.` };
  return { state: 'active', daysLeft, line: `Bank access ends on ${ends}, ${days}.` };
}

export function requireActiveConsent(consent: BankConsent | null, now: Date): BankConsent {
  check(consent, 'BANK_CONSENT_EXPIRED', 'Give bank consent first.');
  const status = consentStatus(consent, now);
  check(status.state === 'active' || status.state === 'expiring', 'BANK_CONSENT_EXPIRED', status.line);
  return consent;
}

export function pollAllowed(polls: readonly IsoTime[], now: Date, limit = BANK_POLLS_PER_DAY): { allowed: boolean; used: number; nextAt: IsoTime | null; line: string } {
  const windowStart = now.getTime() - DAY_MS;
  const recent = polls.map(p => Date.parse(p)).filter(t => t > windowStart).sort((a, b) => a - b);
  if (recent.length < limit) return { allowed: true, used: recent.length, nextAt: null, line: `${recent.length} of ${limit} reads used in the last day.` };
  const nextAt = new Date(recent[0] + DAY_MS).toISOString();
  return { allowed: false, used: recent.length, nextAt, line: `The bank allows ${limit} reads a day. The next one can run at ${nextAt.slice(11, 16)} UTC.` };
}

/** Records one unattended read, or refuses with BANK_POLL_LIMIT. Returns only the reads from the last day. */
export function recordPoll(polls: readonly IsoTime[], now: Date, limit = BANK_POLLS_PER_DAY): IsoTime[] {
  const verdict = pollAllowed(polls, now, limit);
  check(verdict.allowed, 'BANK_POLL_LIMIT', verdict.line);
  const windowStart = now.getTime() - DAY_MS;
  return [...polls.filter(p => Date.parse(p) > windowStart), now.toISOString()];
}

// ---------------------------------------------------------------------------
// Statements and stable ids
// ---------------------------------------------------------------------------

export type StatementRow = {
  date: IsoDate;
  amountMinor: MinorString; // signed: money in is positive, money out negative
  currency: string;
  counterparty: string | null;
  description: string | null;
  reference: string | null; // the bank's own reference, when it gives one
  balanceAfterMinor: MinorString | null;
  source: 'statement-csv' | 'provider';
};
export type BankTransaction = StatementRow & { id: string };
export type BankLedger = { accountLabel: string; currency: string; transactions: BankTransaction[] };
export type StatementOptions = { currency: string; minorDigits: number; dateOrder: DateOrder };

export function emptyLedger(accountLabel: string, currency: string): BankLedger {
  return { accountLabel, currency, transactions: [] };
}

function hash16(fields: (string | null)[]): string {
  return createHash('sha256').update(fields.map(f => f ?? '').join('\u001f')).digest('hex').slice(0, 16);
}

/** The bank's reference when there is one, else a hash of the fields that identify the row. */
export function transactionKey(row: StatementRow): string {
  if (row.reference) return `ref_${hash16([row.date, row.amountMinor, row.currency, row.reference])}`;
  return `fp_${hash16([row.date, row.amountMinor, row.currency, row.counterparty, row.description, row.balanceAfterMinor])}`;
}

/** Identical twins in one file (same day, same amount, same shop) get #2, #3 in file order, so each counts once. */
export function assignIds(rows: readonly StatementRow[]): BankTransaction[] {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const key = transactionKey(row);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...row, id: n === 1 ? key : `${key}#${n}` };
  });
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch !== '"') { cell += ch; continue; }
      if (input[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      continue;
    }
    if (ch === '"' && cell.trim() === '') { quoted = true; cell = ''; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

type Column = 'date' | 'valueDate' | 'description' | 'reference' | 'debit' | 'credit' | 'amount' | 'balance' | 'counterparty';
const HEADER_WORDS: Readonly<Record<Column, readonly string[]>> = Object.freeze({
  date: ['date', 'txn date', 'tran date', 'transaction date', 'posting date', 'booking date'],
  valueDate: ['value dt', 'value date'],
  description: ['narration', 'description', 'particulars', 'details', 'transaction details', 'remarks', 'memo'],
  reference: ['chq ref no', 'chq no', 'cheque no', 'ref no', 'ref no cheque no', 'reference', 'reference no', 'utr'],
  debit: ['withdrawal amt', 'withdrawal', 'withdrawals', 'debit', 'debit amount', 'dr'],
  credit: ['deposit amt', 'deposit', 'deposits', 'credit', 'credit amount', 'cr'],
  amount: ['amount', 'transaction amount'],
  balance: ['closing balance', 'balance', 'running balance'],
  counterparty: ['counterparty', 'payee', 'beneficiary'],
});
const headerWord = (cell: string) => cell.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function columnsOf(row: string[]): Partial<Record<Column, number>> | null {
  const found: Partial<Record<Column, number>> = {};
  row.forEach((cell, index) => {
    const word = headerWord(cell);
    for (const column of Object.keys(HEADER_WORDS) as Column[]) {
      if (found[column] === undefined && HEADER_WORDS[column].includes(word)) found[column] = index;
    }
  });
  const hasDate = found.date !== undefined || found.valueDate !== undefined;
  const hasMoney = found.amount !== undefined || found.debit !== undefined || found.credit !== undefined;
  return hasDate && hasMoney ? found : null;
}

const MONTHS: Readonly<Record<string, string>> = Object.freeze({
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
});
const pad2 = (value: string) => (value.length === 1 ? `0${value}` : value);
const fullYear = (value: string) => (value.length === 2 ? `20${value}` : value);

function parseDate(raw: string, order: DateOrder): IsoDate | null {
  const value = raw.trim();
  const valid = (y: string, m: string, d: string) => { const iso = `${fullYear(y)}-${pad2(m)}-${pad2(d)}`; return validDate(iso) ? iso : null; };
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})$/.exec(value);
  if (m) return order === 'month-day-year' ? valid(m[3], m[1], m[2]) : valid(m[3], m[2], m[1]);
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[A-Za-z]*[ -,]+(\d{4}|\d{2})$/.exec(value);
  if (m && MONTHS[m[2].toLowerCase()]) return valid(m[3], MONTHS[m[2].toLowerCase()], m[1]);
  return null;
}

type Amount = { kind: 'empty' } | { kind: 'error'; reason: string } | { kind: 'ok'; minor: bigint };

function parseAmount(raw: string | undefined, options: StatementOptions): Amount {
  let value = (raw ?? '').trim();
  if (!value) return { kind: 'empty' };
  let negative = false;
  if (/^\(.*\)$/.test(value)) { negative = true; value = value.slice(1, -1).trim(); }
  const side = /\s*(dr|cr)\.?$/i.exec(value);
  if (side) { if (side[1].toLowerCase() === 'dr') negative = !negative; value = value.slice(0, side.index); }
  value = value.replace(/[\s,]/g, '').replace(/^[^\d+\-.]+/, '');
  if (value.startsWith('-')) { negative = !negative; value = value.slice(1); } else if (value.startsWith('+')) value = value.slice(1);
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) return { kind: 'error', reason: `"${(raw ?? '').trim()}" is not an amount Chausar can read.` };
  const fraction = m[2] ?? '';
  if (fraction.length > options.minorDigits) {
    return { kind: 'error', reason: `The amount ${(raw ?? '').trim()} has more decimal places than ${options.currency} allows. Chausar does not round it.` };
  }
  const minor = BigInt(m[1]) * 10n ** BigInt(options.minorDigits) + BigInt(fraction.padEnd(options.minorDigits, '0') || '0');
  return { kind: 'ok', minor: negative ? -minor : minor };
}

const textOrNull = (value: string | undefined) => { const text = (value ?? '').trim(); return text ? text : null; };

/** Reads a statement file. Lines before the header (account details) are skipped; a row that cannot be read is listed, never guessed. */
export function parseStatementCsv(text: string, options: StatementOptions): { rows: StatementRow[]; rejected: { line: number; reason: string }[] } {
  check(typeof text === 'string' && text.length > 0 && text.length <= MAX_STATEMENT_CHARS, 'BANK_STATEMENT_INVALID', 'Choose a statement file under two megabytes.');
  check(Number.isInteger(options.minorDigits) && options.minorDigits >= 0 && options.minorDigits <= 4, 'BANK_STATEMENT_INVALID', 'The currency has an unusual number of decimal places.');
  const table = parseCsv(text);
  check(table.length <= MAX_STATEMENT_ROWS, 'BANK_STATEMENT_INVALID', 'This statement has more rows than Chausar reads at once.');
  const headerIndex = table.findIndex(row => columnsOf(row) !== null);
  check(headerIndex >= 0, 'BANK_STATEMENT_INVALID', 'Chausar could not find the date and amount columns in this file.');
  const columns = columnsOf(table[headerIndex])!;
  const at = (row: string[], column: Column) => (columns[column] === undefined ? undefined : row[columns[column]!]);
  const rows: StatementRow[] = [];
  const rejected: { line: number; reason: string }[] = [];
  for (let index = headerIndex + 1; index < table.length; index++) {
    const row = table[index];
    if (row.every(cell => cell.trim() === '')) continue;
    const line = index + 1;
    const date = parseDate(at(row, 'date') ?? at(row, 'valueDate') ?? '', options.dateOrder);
    if (!date) { rejected.push({ line, reason: 'No date Chausar can read in this row.' }); continue; }
    let amount: bigint;
    if (columns.amount !== undefined) {
      const parsed = parseAmount(at(row, 'amount'), options);
      if (parsed.kind !== 'ok') { rejected.push({ line, reason: parsed.kind === 'error' ? parsed.reason : 'No amount in this row.' }); continue; }
      amount = parsed.minor;
    } else {
      const debit = parseAmount(at(row, 'debit'), options), credit = parseAmount(at(row, 'credit'), options);
      const failed = [debit, credit].find(item => item.kind === 'error');
      if (failed && failed.kind === 'error') { rejected.push({ line, reason: failed.reason }); continue; }
      const out = debit.kind === 'ok' ? debit.minor : 0n, inward = credit.kind === 'ok' ? credit.minor : 0n;
      if (out !== 0n && inward !== 0n) { rejected.push({ line, reason: 'This row has money both in and out.' }); continue; }
      amount = inward !== 0n ? inward : -(out < 0n ? -out : out);
    }
    if (amount === 0n) { rejected.push({ line, reason: 'The amount in this row is zero.' }); continue; }
    const balance = parseAmount(at(row, 'balance'), options);
    if (balance.kind === 'error') { rejected.push({ line, reason: balance.reason }); continue; }
    const reference = textOrNull(at(row, 'reference'));
    rows.push({
      date, amountMinor: amount.toString(), currency: options.currency,
      counterparty: textOrNull(at(row, 'counterparty')), description: textOrNull(at(row, 'description')),
      reference: reference && !/^0+$/.test(reference) ? reference : null,
      balanceAfterMinor: balance.kind === 'ok' ? balance.minor.toString() : null, source: 'statement-csv',
    });
  }
  return { rows, rejected };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Adds a statement to the ledger. Transactions already in it are not counted again. */
export function importStatement(ledger: BankLedger, csv: string, options: StatementOptions): {
  ledger: BankLedger; added: BankTransaction[]; duplicates: number; rejected: { line: number; reason: string }[]; line: string;
} {
  check(ledger.currency === options.currency, 'BANK_STATEMENT_INVALID', `This account is in ${ledger.currency}, not ${options.currency}.`);
  const parsed = parseStatementCsv(csv, options);
  const known = new Set(ledger.transactions.map(t => t.id));
  const incoming = assignIds(parsed.rows);
  const added = incoming.filter(t => !known.has(t.id));
  const duplicates = incoming.length - added.length;
  const transactions = [...ledger.transactions, ...added].map((t, i) => ({ t, i }))
    .sort((a, b) => (a.t.date < b.t.date ? -1 : a.t.date > b.t.date ? 1 : a.i - b.i)).map(item => item.t);
  const parts = [`Added ${plural(added.length, 'transaction', 'transactions')}.`];
  if (duplicates > 0) parts.push(`${plural(duplicates, 'was', 'were')} already here and ${duplicates === 1 ? 'was' : 'were'} not counted again.`);
  if (parsed.rejected.length > 0) parts.push(`${plural(parsed.rejected.length, 'row', 'rows')} could not be read.`);
  return { ledger: { ...ledger, transactions }, added, duplicates, rejected: parsed.rejected, line: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Alerts and the settings the model cannot change
// ---------------------------------------------------------------------------

export type BankAlertRule =
  | { kind: 'balance-below'; minor: MinorString }
  | { kind: 'large-debit'; minor: MinorString }
  | { kind: 'credit-matching'; text: string }
  | { kind: 'credit-missing-by'; text: string; minor: MinorString; by: IsoDate };
export type BankAlert = { rule: BankAlertRule; transactionId: string | null; line: string };
export type BankSettings = {
  consent: BankConsent | null;
  polls: IsoTime[];
  rules: BankAlertRule[];
  alertWebhook: { url: string; setBy: string; setAt: IsoTime } | null;
};

const mentions = (t: BankTransaction, text: string) =>
  [t.description, t.counterparty, t.reference].some(field => field !== null && field.toLowerCase().includes(text.toLowerCase()));

/** Checks the rules in order. `since` limits which transactions count as new for the per-transaction rules. */
export function evaluateAlerts(rules: readonly BankAlertRule[], ledger: BankLedger, at: { today: IsoDate; balanceMinor: MinorString | null; since?: IsoDate }): BankAlert[] {
  const fresh = ledger.transactions.filter(t => at.since === undefined || t.date >= at.since);
  const alerts: BankAlert[] = [];
  for (const rule of rules) {
    if (rule.kind === 'balance-below') {
      if (at.balanceMinor !== null && BigInt(at.balanceMinor) < BigInt(rule.minor)) alerts.push({ rule, transactionId: null, line: 'The balance is below the level you set.' });
    } else if (rule.kind === 'large-debit') {
      for (const t of fresh) {
        if (BigInt(t.amountMinor) < 0n && -BigInt(t.amountMinor) >= BigInt(rule.minor)) alerts.push({ rule, transactionId: t.id, line: `A large payment went out: ${t.description ?? 'no description'}.` });
      }
    } else if (rule.kind === 'credit-matching') {
      for (const t of fresh) {
        if (BigInt(t.amountMinor) > 0n && mentions(t, rule.text)) alerts.push({ rule, transactionId: t.id, line: `A payment came in matching ${rule.text}.` });
      }
    } else if (at.today > rule.by) {
      const paid = ledger.transactions.some(t => BigInt(t.amountMinor) >= BigInt(rule.minor) && mentions(t, rule.text));
      if (!paid) alerts.push({ rule, transactionId: null, line: `No payment matching ${rule.text} arrived by ${rule.by}.` });
    }
  }
  return alerts;
}

/** Only the owner, inside the app, sets where alerts go. An agent, a phone or a tainted request cannot. */
export function setAlertWebhook(settings: BankSettings, url: string, ctx: Context, at: IsoTime): BankSettings {
  check(isAppChannel(ctx) && (ctx.role === 'owner' || ctx.role === 'cofounder'), 'APP_APPROVAL_REQUIRED', 'Set where alerts go inside the Chausar app.');
  let parsed: URL | null = null;
  try { parsed = new URL(url); } catch { parsed = null; }
  check(parsed && parsed.protocol === 'https:' && !parsed.username && !parsed.password, 'INVALID_VENTURE_REQUEST', 'Alerts go only to an https address.');
  // The network guard (W1 H16): never an address inside this computer or its network, in any spelling.
  checkUrl(parsed.href);
  return { ...settings, alertWebhook: { url: parsed.href, setBy: ctx.memberId, setAt: at } };
}

/** What a model may read: the rules and the consent, never the alert address. */
export function modelBankView(settings: BankSettings): { consent: { accountLabel: string; scope: 'read-only'; expiresAt: IsoTime } | null; rules: BankAlertRule[]; alertsGoTo: string } {
  return {
    consent: settings.consent ? { accountLabel: settings.consent.accountLabel, scope: 'read-only', expiresAt: settings.consent.expiresAt } : null,
    rules: settings.rules.map(rule => ({ ...rule })),
    alertsGoTo: settings.alertWebhook ? 'the address you set in the app' : 'nowhere yet',
  };
}

/**
 * At most one delivery, always to the stored address, and it carries the number of alerts and nothing else (spec 5.7):
 * no amount, no description, no transaction id. The owner reads the alerts themselves on Today, inside the app. There
 * is no parameter for another address.
 */
export function alertDeliveries(settings: BankSettings, alerts: readonly BankAlert[]): { url: string; body: { count: number } }[] {
  const target = settings.alertWebhook;
  if (!target || alerts.length === 0) return [];
  return [{ url: target.url, body: { count: alerts.length } }];
}

/**
 * The alerts one import raises. Rules about a row look only at the rows this import added, so a re-import never alerts
 * twice; the balance rule looks at the newest balance once the import added anything; a missing payment alerts once,
 * on the first import after its date that still shows it missing (`earlier` holds the alerts of the earlier imports).
 */
export function importAlerts(
  rules: readonly BankAlertRule[], ledger: BankLedger, added: readonly BankTransaction[], earlier: readonly BankAlert[], today: IsoDate,
): BankAlert[] {
  if (rules.length === 0 || added.length === 0) return [];
  const addedIds = new Set(added.map(t => t.id));
  const balanceMinor = [...ledger.transactions].reverse().find(t => t.balanceAfterMinor !== null)?.balanceAfterMinor ?? null;
  const same = (a: BankAlertRule, b: BankAlertRule) => JSON.stringify(a) === JSON.stringify(b);
  return evaluateAlerts(rules, ledger, { today, balanceMinor }).filter(alert => {
    if (alert.transactionId !== null) return addedIds.has(alert.transactionId);
    if (alert.rule.kind === 'credit-missing-by') return !earlier.some(prior => same(prior.rule, alert.rule));
    return true;
  });
}

// ---------------------------------------------------------------------------
// Alert rules as the owner gives them, and in words
// ---------------------------------------------------------------------------

/** A rule as the owner sends it: money as minor units (minor) or as the amount they typed (amount), never both. */
export type BankAlertRuleInput =
  | { kind: 'balance-below' | 'large-debit'; minor?: MinorString; amount?: string }
  | { kind: 'credit-matching'; text: string }
  | { kind: 'credit-missing-by'; text: string; minor?: MinorString; amount?: string; by: IsoDate };

export const MAX_ALERT_RULES = 10;
const RULE_FIELDS: Readonly<Record<BankAlertRule['kind'], readonly string[]>> = Object.freeze({
  'balance-below': ['kind', 'minor', 'amount'],
  'large-debit': ['kind', 'minor', 'amount'],
  'credit-matching': ['kind', 'text'],
  'credit-missing-by': ['kind', 'text', 'minor', 'amount', 'by'],
});

/** Exact minor units from either field; the typed amount is read in the account's currency and never rounded. */
function ruleMinor(rule: Record<string, unknown>, currency: string): MinorString {
  check((rule.minor === undefined) !== (rule.amount === undefined), 'INVALID_VENTURE_REQUEST', 'Give the amount for this alert once.');
  let minor: string;
  if (rule.minor !== undefined) {
    check(typeof rule.minor === 'string' && /^\d{1,18}$/.test(rule.minor), 'INVALID_VENTURE_REQUEST', 'The amount for this alert must be whole minor units.');
    minor = rule.minor;
  } else {
    const typed = typeof rule.amount === 'string' && rule.amount.length <= 40 ? rule.amount.replace(/[\s,]/g, '') : '';
    check(/^\d+(?:\.\d+)?$/.test(typed), 'INVALID_VENTURE_REQUEST', 'Type the amount for this alert like 50000 or 50000.00.');
    minor = decimalMinor(typed, currency);
  }
  check(BigInt(minor) > 0n, 'INVALID_VENTURE_REQUEST', 'The amount for this alert must be above zero.');
  return BigInt(minor).toString();
}

/** The owner's rules, checked one by one, in the order given. At most ten; anything unknown is refused, never dropped. */
export function readAlertRules(value: unknown, currency: string): BankAlertRule[] {
  check(Array.isArray(value) && value.length <= MAX_ALERT_RULES, 'INVALID_VENTURE_REQUEST', `Send a list of at most ${MAX_ALERT_RULES} alert rules.`);
  return value.map((item): BankAlertRule => {
    check(item !== null && typeof item === 'object' && !Array.isArray(item), 'INVALID_VENTURE_REQUEST', 'Send each alert rule as one object.');
    const rule = item as Record<string, unknown>;
    check(typeof rule.kind === 'string' && Object.hasOwn(RULE_FIELDS, rule.kind), 'INVALID_VENTURE_REQUEST', 'Choose a kind of alert Chausar checks.');
    const kind = rule.kind as BankAlertRule['kind'];
    check(Object.keys(rule).every(key => RULE_FIELDS[kind].includes(key)), 'INVALID_VENTURE_REQUEST', 'Send each alert rule with its own fields only.');
    if (kind === 'balance-below' || kind === 'large-debit') return { kind, minor: ruleMinor(rule, currency) };
    const text = singleLine(rule.text, 'The words to look for', { min: 2, max: 80 });
    if (kind === 'credit-matching') return { kind, text };
    return { kind, text, minor: ruleMinor(rule, currency), by: isoDate(rule.by, 'The date it should arrive by') };
  });
}

/** One rule in words, with its money as the engine formats it. */
export function ruleLine(rule: BankAlertRule, currency: string, order: DateOrder): string {
  if (rule.kind === 'large-debit') return `When ${formatMinor(rule.minor, currency)} or more goes out in one payment.`;
  if (rule.kind === 'balance-below') return `When the balance falls below ${formatMinor(rule.minor, currency)}.`;
  if (rule.kind === 'credit-matching') return `When money comes in that mentions ${rule.text}.`;
  return `When no payment of ${formatMinor(rule.minor, currency)} or more that mentions ${rule.text} has come in by ${formatVentureDate(rule.by, order)}.`;
}

// ---------------------------------------------------------------------------
// Statements into the books: own transfers and invoice payments
// ---------------------------------------------------------------------------

/** A row as pairing and matching read it. accountId is the owner's account; rows come in file order. */
export type BookRow = Pick<BankTransaction, 'id' | 'date' | 'amountMinor' | 'currency' | 'counterparty' | 'description' | 'reference'> & { accountId: string };
const dayOf = (date: IsoDate) => Date.parse(`${date}T00:00:00.000Z`) / DAY_MS;
export const TRANSFER_DAYS = 2;

/**
 * Transfers between the owner's own accounts: opposite amounts in the same currency, in two different own accounts, at
 * most two days apart. Each row pairs once; the nearest date wins, then the earlier row in file order. Returns each
 * paired row's partner, both ways.
 */
export function pairOwnTransfers(rows: readonly BookRow[]): Map<string, string> {
  const ordered = rows.map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.index - b.index));
  const pairs = new Map<string, string>();
  for (const { row } of ordered) {
    if (pairs.has(row.id)) continue;
    const wanted = -BigInt(row.amountMinor);
    let best: { id: string; gap: number; index: number } | null = null;
    for (const other of ordered) {
      const candidate = other.row;
      if (candidate.id === row.id || pairs.has(candidate.id) || candidate.accountId === row.accountId || candidate.currency !== row.currency) continue;
      if (BigInt(candidate.amountMinor) !== wanted) continue;
      const gap = Math.abs(dayOf(candidate.date) - dayOf(row.date));
      if (gap > TRANSFER_DAYS) continue;
      if (!best || gap < best.gap || (gap === best.gap && other.index < best.index)) best = { id: candidate.id, gap, index: other.index };
    }
    if (best) { pairs.set(row.id, best.id); pairs.set(best.id, row.id); }
  }
  return pairs;
}

const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The word as a whole word (case ignored) in the row's description, counterparty or reference: INV-0007 is not INV-00071. */
export function namesWord(row: Pick<BookRow, 'counterparty' | 'description' | 'reference'>, word: string): boolean {
  const pattern = new RegExp(`(?<![A-Za-z0-9_])${escapeText(word)}(?![A-Za-z0-9_])`, 'i');
  return [row.description, row.counterparty, row.reference].some(field => field !== null && pattern.test(field));
}

/**
 * A row that names another own account by its label, in its counterparty: a transfer even with nothing to pair it with.
 * A label of two words or more may appear inside the counterparty as whole words; a one-word label must be the whole
 * counterparty, so an account called SBI never swallows a payment to SBI Cards.
 */
export function namesOwnAccount(row: BookRow, accounts: readonly { id: string; label: string }[]): boolean {
  const counterparty = row.counterparty?.trim() ?? '';
  if (!counterparty) return false;
  return accounts.some(account => {
    if (account.id === row.accountId) return false;
    const label = account.label.trim();
    if (label.split(/\s+/).length >= 2) return namesWord({ counterparty, description: null, reference: null }, label);
    return counterparty.toLowerCase() === label.toLowerCase();
  });
}

export type InvoiceToMatch = { id: string; number: string; currency: string; balanceMinor: MinorString };
export type InvoiceMatch = { invoiceId: string; number: string; full: boolean; leftMinor: MinorString };

/**
 * The open invoice a money-in row looks like it pays: exactly one invoice in its currency, with a balance, named by
 * whole word, and the row no more than that balance. Money out, no name, two names, or too much: no suggestion.
 */
export function matchInvoices(row: BookRow, invoices: readonly InvoiceToMatch[]): InvoiceMatch | null {
  const amount = BigInt(row.amountMinor);
  if (amount <= 0n) return null;
  const named = invoices.filter(invoice => invoice.currency === row.currency && BigInt(invoice.balanceMinor) > 0n && namesWord(row, invoice.number));
  if (named.length !== 1) return null;
  const [invoice] = named;
  const balance = BigInt(invoice.balanceMinor);
  if (amount > balance) return null;
  return { invoiceId: invoice.id, number: invoice.number, full: amount === balance, leftMinor: (balance - amount).toString() };
}
