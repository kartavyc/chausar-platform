// Chausar venture launcher: the bank shape as engine methods. venture.bank.import { csv, account } and
// venture.bank.consent { account, days?, revoke? }, both the owner's own clicks inside the app.
// The statement file is one the owner downloaded from their bank: bank.ts reads it into exact minor units and gives each
// transaction a stable id, so a row already imported is never counted again, across imports too. Each import is its
// own record holding only the rows it added. Consent is read-only access with an end date; no bank provider is wired,
// so nothing reads the bank on its own yet and the consent says so.
//
// Ink v2 wave 2 (2D): the statements feed the books. venture.bank.ledger reads every kept row against the books: a
// transfer between the owner's own accounts (paired, never income or spending), money in that names an issued invoice by
// whole word (a suggested payment), or plain money in or out. venture.bank.apply records one row once, inside the app:
// as an invoice's payment through the same path as a typed payment (money/payments.ts), as a cost fact the calculator
// counts, or skipped. venture.bank.alerts.* keep the owner's alert rules and where alerts go; after an import, code
// checks the rules on the new rows, Today shows what they found, and one journalled bank.alert sends the count of
// alerts, and nothing else, to the owner's address through the network guard with redirects refused.
import { createHash } from 'node:crypto';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import type {
  BankAccountRecord, BankAlertsView, BankApplyResult, BankConsentView, BankImportRecord, BankImportResult, BankLedgerRow, BankLedgerView,
  BankMatchRecord, BankTransactionData, Display, QueueAction, QueueActionId, VentureDeps, VentureRecord,
} from '../contracts.ts';
import {
  exactPayload, formatVentureDate, identifier, isAppChannel, listRecords, MAX_STORED_PAYLOAD, readVenture, requireAppChannel, singleLine,
  smallInteger, ventureAction, type VentureTx,
} from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { guardedFetch } from '../core/net-guard.ts';
import { journalled, type ApplyResult } from '../journal/journal.ts';
import { booksReceiptFor, RECEIVED_COVERS_MORE } from '../money/books.ts';
import { costFact, insertBooksFact } from '../money/facts.ts';
import { recordPaymentMinor } from '../money/payments.ts';
import {
  alertDeliveries, consentStatus, emptyLedger, grantConsent, importAlerts, importStatement, matchInvoices, namesOwnAccount, namesWord, pairOwnTransfers,
  readAlertRules, revokeConsent, ruleLine, setAlertWebhook, CONSENT_MAX_DAYS, TRANSFER_DAYS, type BankAlert, type BankSettings, type BookRow, type InvoiceMatch,
} from './bank.ts';

/** The most one import keeps. A larger statement is refused in plain words, never cut short. */
const MAX_IMPORT_CHARS = MAX_STORED_PAYLOAD * 4;
const DEFAULT_CONSENT_DAYS = 90;
export const NO_PROVIDER_LINE = 'No bank provider is linked yet, so Chausar reads only the statement files you import.';
export const ALERTS_SENT_LINE = 'Alerts go to the address you set, as a count only. Today shows what each one found.';
export const ALERTS_TODAY_LINE = 'Alerts show on Today only. No address is set, so nothing is sent.';
/** One alert send waits this long at most; a send that does not finish is outcome unknown and never sent again. */
const ALERT_TIMEOUT_MS = 10_000;
/** Refusals that happen before anything leaves this computer: the alert was not sent. */
const NOT_SENT_CODES: ReadonlySet<string> = new Set(['NET_URL_REFUSED', 'NET_ADDRESS_REFUSED', 'NET_LOOKUP_FAILED']);
const ALERT_NOT_SENT = 'The count was not sent to your alert address. See the journal.';
const ALERT_MAYBE_SENT = 'The count may or may not have reached your alert address. See the journal.';
const ALERT_REFUSED = 'Your alert address refused it. See the journal.';

function accountLabel(value: unknown): string {
  return singleLine(value, 'The account name', { min: 1, max: 80 });
}

function countryOf(venture: VentureRecord | null) {
  const country = venture?.country ?? null;
  check(country, 'INVALID_VENTURE_REQUEST', 'Choose the country of your business first, so Chausar knows its currency.');
  return country;
}

const sameLabel = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function findAccount(tx: VentureTx, label: string): BankAccountRecord | undefined {
  return tx.list('venture-bank-account').find(account => sameLabel(account.label, label));
}

/** Every transaction already kept for an account, in import order. */
function keptTransactions(tx: VentureTx, accountId: string): BankTransactionData[] {
  return tx.list('venture-bank-import').filter(item => item.accountId === accountId).flatMap(item => item.transactions);
}

/** venture.bank.import { csv, account } (admin, inside the app): adds a statement file, counting each transaction once. */
export async function bankImport(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankImportResult> {
  requireAppChannel(ctx, 'venture.bank.import');
  const body = exactPayload(payload, ['csv', 'account'], ['csv', 'account']);
  check(typeof body.csv === 'string', 'BANK_STATEMENT_INVALID', 'Choose a statement file.');
  const csv = body.csv;
  const label = accountLabel(body.account);
  const fileDigest = createHash('sha256').update(csv, 'utf8').digest('hex');
  const imported = await ventureAction(deps, ctx, 'admin', 'bank.import', tx => {
    const country = countryOf(tx.venture);
    const options = { currency: country.currency, minorDigits: country.minorDigits, dateOrder: country.dateOrder };
    // One file belongs to one account: the same file in a second account would count every row twice.
    const elsewhere = tx.list('venture-bank-import').find(item => item.fileDigest === fileDigest && item.accountId !== findAccount(tx, label)?.id);
    const holder = elsewhere ? tx.find('venture-bank-account', elsewhere.accountId) : undefined;
    check(!elsewhere, 'BANK_STATEMENT_INVALID', `This file is already imported into ${holder?.label ?? 'another account'}. Import each statement into its own account.`);
    const account = findAccount(tx, label) ?? tx.put<BankAccountRecord>({ ...tx.base('venture-bank-account'), label, currency: country.currency, consent: null, polls: [] });
    const ledger = { ...emptyLedger(account.label, account.currency), transactions: keptTransactions(tx, account.id) };
    const result = importStatement(ledger, csv, options);
    check(JSON.stringify(result.added).length <= MAX_IMPORT_CHARS, 'BANK_STATEMENT_INVALID',
      'This statement holds more rows than Chausar keeps in one import. Download it a month at a time and import each one.');
    // The owner's rules, on the rows this import added (bank.ts importAlerts); a re-import raises nothing again.
    const earlier = tx.list('venture-bank-import').filter(item => item.accountId === account.id).flatMap(item => item.alerts ?? []);
    const alerts = importAlerts(account.rules ?? [], result.ledger, result.added, earlier, localDayAt(tx.now, country));
    const stored = tx.put<BankImportRecord>({
      ...tx.base('venture-bank-import'), accountId: account.id, fileDigest,
      transactions: result.added, duplicates: result.duplicates, rejected: result.rejected, line: result.line, ...(alerts.length ? { alerts } : {}),
    });
    // New rows may be an invoice's payment, and alerts wait on Today: the screens read the queue again.
    if (result.added.length) tx.emit('queue.changed', { bankImport: stored.id });
    const settings: BankSettings = { consent: account.consent, polls: account.polls, rules: account.rules ?? [], alertWebhook: account.alertAddress ?? null };
    return {
      importId: stored.id, alerts, settings,
      view: {
        account: account.label, accountId: account.id, added: result.added.length, duplicates: result.duplicates,
        rejected: result.rejected, line: result.line, transactions: result.ledger.transactions.length,
      },
    };
  });
  if (!imported.alerts.length) return imported.view;
  const found = `${plural(imported.alerts.length, 'bank alert is', 'bank alerts are')} on Today.`;
  const sent = await sendAlertCount(deps, ctx, imported.importId, imported.settings, imported.alerts);
  return { ...imported.view, line: [imported.view.line, found, sent].filter(Boolean).join(' ') };
}

/**
 * The count of an import's alerts, to the address the owner set, as one journalled bank.alert: proposed, approved by
 * the owner's standing setting inside the app, and applied once. The body is { count } and nothing else. The request
 * goes through the network guard, which checks the address again and refuses any redirect for a POST. A send that may
 * have happened is outcome unknown and is never retried. Whatever happens, the import stands; the words say what did.
 */
async function sendAlertCount(deps: VentureDeps, ctx: Context, importId: string, settings: BankSettings, alerts: readonly BankAlert[]): Promise<string> {
  const [delivery] = alertDeliveries(settings, alerts);
  if (!delivery) return '';
  const body = JSON.stringify(delivery.body);
  const count = delivery.body.count;
  // The address answered and said no (a 4xx, or a redirect Chausar does not follow): the count reached it.
  let refusedByAddress = false;
  try {
    const done = await journalled<null>(deps, ctx, {
      action: 'bank.alert', subject: `bank-alert:${importId}`, target: 'Your alert address',
      actionDigest: createHash('sha256').update(`${importId}\n${delivery.url}\n${body}`, 'utf8').digest('hex'),
      line: `Send the number of new bank alerts (${count}) to the address you set. Only the number goes out.`,
      descriptionComplete: true,
    }, async (): Promise<ApplyResult<null>> => {
      try {
        const answer = await guardedFetch(
          { url: delivery.url, method: 'POST', headers: { 'content-type': 'application/json' }, body, maxRedirects: 0, timeoutMs: ALERT_TIMEOUT_MS },
          deps.net ?? {},
        );
        if (answer.status >= 200 && answer.status < 300) return { outcome: 'applied', line: `Sent the alert count (${count}) to your alert address.`, value: null, by: 'platform' };
        if (answer.status >= 500) return { outcome: 'unknown', line: `Your alert address answered with an error (${answer.status}).`, value: null };
        refusedByAddress = true;
        return { outcome: 'not-sent', line: `Your alert address refused it (${answer.status}).`, value: null, by: 'platform' };
      } catch (error) {
        const code = error instanceof ChausarError ? error.code : '';
        if (code === 'NET_REDIRECT_REFUSED') {
          refusedByAddress = true;
          return { outcome: 'not-sent', line: 'Your alert address refused it: it asked Chausar to send it somewhere else, and Chausar does not follow that.', value: null, by: 'platform' };
        }
        if (NOT_SENT_CODES.has(code)) return { outcome: 'not-sent', line: (error as ChausarError).message, value: null, by: 'engine' };
        return { outcome: 'unknown', line: 'Sending the alert count stopped part way.', value: null };
      }
    }, { timeoutMs: ALERT_TIMEOUT_MS * 2 });
    if (done.entry.state === 'applied') return 'The count went to your alert address.';
    if (done.entry.state === 'rejected') return refusedByAddress ? ALERT_REFUSED : ALERT_NOT_SENT;
    return ALERT_MAYBE_SENT;
  } catch (error) {
    // A send that ran out of time is outcome unknown in the journal; anything else stopped before it went out.
    return error instanceof ChausarError && error.code === 'JOURNAL_OUTCOME_UNKNOWN' ? ALERT_MAYBE_SENT : ALERT_NOT_SENT;
  }
}

/**
 * venture.bank.consent { account, days?, revoke? } (admin, inside the app): gives read-only access with an end date
 * (one to 365 days, 90 when left out), or stops it. No provider is linked, so it is kept for when one is.
 */
export async function bankConsent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankConsentView> {
  requireAppChannel(ctx, 'venture.bank.consent');
  const body = exactPayload(payload, ['account', 'days', 'revoke'], ['account']);
  const label = accountLabel(body.account);
  check(body.revoke === undefined || typeof body.revoke === 'boolean', 'INVALID_VENTURE_REQUEST', 'revoke must be true or false.');
  const revoke = body.revoke === true;
  check(!(revoke && body.days !== undefined), 'INVALID_VENTURE_REQUEST', 'Either give consent for some days or stop it, not both.');
  const days = body.days === undefined ? DEFAULT_CONSENT_DAYS : smallInteger(body.days, 'Days', 1, CONSENT_MAX_DAYS);
  return ventureAction(deps, ctx, 'admin', 'bank.consent', tx => {
    const country = countryOf(tx.venture);
    let account = findAccount(tx, label);
    if (revoke) {
      check(account?.consent, 'INVALID_VENTURE_REQUEST', 'There is no bank consent to stop for this account.');
      account = tx.replace<BankAccountRecord>({ ...account, consent: revokeConsent(account.consent, tx.now) });
    } else {
      account ??= tx.put<BankAccountRecord>({ ...tx.base('venture-bank-account'), label, currency: country.currency, consent: null, polls: [] });
      const consent = grantConsent({ id: `${account.id}.consent`, provider: null, accountLabel: account.label, grantedAt: tx.now, days });
      account = tx.replace<BankAccountRecord>({ ...account, consent });
    }
    const consent = account.consent!;
    return { account: account.label, accountId: account.id, consent, status: consentStatus(consent, new Date(tx.now), country.dateOrder), provider: NO_PROVIDER_LINE };
  });
}

// ---------------------------------------------------------------------------
// The statements against the books (venture.bank.ledger)
// ---------------------------------------------------------------------------

/** A kept row with where it lives. Its ledger id is '<account id>:<transaction id>', unique even when two accounts hold one file. */
type KeptRow = BankTransactionData & { ledgerId: string; accountId: string; account: string; importedAt: string };
type BookEntry = { data: KeptRow; view: BankLedgerRow; match: InvoiceMatch | null };
type Book = { accounts: BankAccountRecord[]; rows: BookEntry[]; byId: Map<string, BookEntry> };

const ledgerIdOf = (accountId: string, transactionId: string) => `${accountId}:${transactionId}`;
/** A calendar date as a whole day number, to tell how many days apart two dates are. */
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00.000Z`) / 86_400_000;

/** A ledger row id from a payload: the account's id, a colon and the stable transaction id. */
function ledgerIdFrom(value: unknown): string {
  check(typeof value === 'string' && /^[A-Za-z0-9_.:#-]{3,240}$/.test(value), 'INVALID_VENTURE_REQUEST', 'Send the id of the bank row, as the ledger gives it.');
  return value;
}

function suggestionLine(match: InvoiceMatch, currency: string): Display {
  return match.full ? `Pays ${match.number} in full.` : `Pays part of ${match.number}. ${formatMinor(match.leftMinor, currency)} would be left.`;
}

/**
 * Every kept row of the business read against the books, account by account in the order they were made, each in
 * import order. The owner's decision comes first; then a transfer between own accounts; then money the owner already
 * typed as a payment; then an invoice it names. Pairing looks at every kept row, decided or not: an undecided row paired
 * with a recorded one is a transfer, and the recorded one keeps its decision with a flag asking the owner to check it.
 */
function bankBook(state: State, venture: VentureRecord): Book {
  const accounts = listRecords(state, 'venture-bank-account', venture.id);
  const imports = listRecords(state, 'venture-bank-import', venture.id);
  const kept: KeptRow[] = accounts.flatMap(account => imports.filter(item => item.accountId === account.id)
    .flatMap(item => item.transactions.map(t => ({ ...t, ledgerId: ledgerIdOf(account.id, t.id), accountId: account.id, account: account.label, importedAt: item.at }))));
  const byLedgerId = new Map(kept.map(row => [row.ledgerId, row]));
  const decisions = new Map(listRecords(state, 'venture-bank-match', venture.id).map((match: BankMatchRecord) => [match.transactionId, match]));
  const bookRow = (row: KeptRow): BookRow => ({
    id: row.ledgerId, accountId: row.accountId, date: row.date, amountMinor: row.amountMinor, currency: row.currency,
    counterparty: row.counterparty, description: row.description, reference: row.reference,
  });
  const pairs = pairOwnTransfers(kept.map(bookRow));
  const owners = accounts.map(account => ({ id: account.id, label: account.label }));
  const numbered = listRecords(state, 'venture-invoice', venture.id).filter(invoice => invoice.number !== null && invoice.status !== 'draft' && invoice.status !== 'void');
  const invoices = numbered.filter(invoice => invoice.status === 'issued' || invoice.status === 'part-paid')
    .map(invoice => ({ id: invoice.id, number: invoice.number as string, currency: invoice.currency, balanceMinor: invoice.balanceMinor }));
  // Payments the owner typed (no statement row behind them). Each one covers at most one statement row.
  const typed = listRecords(state, 'venture-payment', venture.id).filter(payment => !payment.bankTransactionId);
  const covered = new Set<string>();
  const typedFor = (row: KeptRow): string | null => {
    for (const invoice of numbered) {
      if (invoice.currency !== row.currency || !namesWord(row, invoice.number as string)) continue;
      const payment = typed.find(item => !covered.has(item.id) && item.invoiceId === invoice.id && item.amountMinor === row.amountMinor
        && Math.abs(dayNumber(item.receivedOn) - dayNumber(row.date)) <= TRANSFER_DAYS);
      if (payment) { covered.add(payment.id); return invoice.number as string; }
    }
    return null;
  };
  const rows = kept.map((row): BookEntry => {
    const decided = decisions.get(row.ledgerId)?.as ?? null;
    const partner = pairs.get(row.ledgerId) ?? null;
    const own = partner !== null || namesOwnAccount(bookRow(row), owners);
    const amount = BigInt(row.amountMinor);
    const already = decided === null && !own && amount > 0n ? typedFor(row) : null;
    const match = decided === null && !own && already === null ? matchInvoices(bookRow(row), invoices) : null;
    const recorded = decided === 'payment' || decided === 'cost';
    const flag = already !== null ? `Already recorded as a payment of ${already}.`
      : recorded && own ? `This was added to your books, but it looks like a move between your own accounts${partner ? ` (with a row in ${byLedgerId.get(partner)?.account ?? 'another account'})` : ''}. Check it.`
        : null;
    const classification: BankLedgerRow['classification'] = decided !== null ? (decided === 'skip' ? 'skipped' : 'applied')
      : own ? 'own-transfer' : match ? 'suggested-payment' : amount > 0n ? 'money-in' : 'money-out';
    return {
      data: row, match,
      view: {
        id: row.ledgerId, accountId: row.accountId, account: row.account, date: row.date, dateDisplay: formatVentureDate(row.date, venture.country.dateOrder),
        amount: formatMinor(amount < 0n ? -amount : amount, row.currency), direction: amount > 0n ? 'in' : 'out',
        description: row.description, counterparty: row.counterparty, classification, flag, pairedWith: partner,
        suggestion: match ? { invoiceId: match.invoiceId, number: match.number, line: suggestionLine(match, row.currency) } : null,
        decided,
      },
    };
  });
  return { accounts, rows, byId: new Map(rows.map(entry => [entry.view.id, entry])) };
}

function ledgerLine(rows: readonly BankLedgerRow[], accounts: number): Display {
  if (!rows.length) return accounts ? 'No bank transactions here yet.' : 'No bank statements imported yet.';
  const parts = [`${plural(rows.length, 'transaction', 'transactions')} in ${plural(accounts, 'account', 'accounts')}.`];
  const own = rows.filter(row => row.classification === 'own-transfer').length;
  const suggested = rows.filter(row => row.classification === 'suggested-payment').length;
  if (own) {
    parts.push(own === 1 ? '1 transaction moves between your own accounts, so it is not income or spending.'
      : `${own} transactions move between your own accounts, so they are not income or spending.`);
  }
  if (suggested) parts.push(`${suggested === 1 ? '1 transaction looks' : `${suggested} transactions look`} like an invoice payment.`);
  return parts.join(' ');
}

/**
 * venture.bank.ledger { account?, month? } (read): every kept row against the books, oldest first. Off the app channel
 * each row keeps its date, amount and class but not its description or counterparty.
 */
export async function bankLedger(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankLedgerView> {
  const body = exactPayload(payload, ['account', 'month']);
  const label = body.account === undefined ? null : accountLabel(body.account);
  check(body.month === undefined || (typeof body.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(body.month)), 'INVALID_VENTURE_REQUEST', 'Choose a month like 2026-10.');
  const month = body.month as string | undefined;
  const { state, venture } = readVenture(deps, ctx);
  const book = bankBook(state, venture);
  const account = label === null ? null : book.accounts.find(item => sameLabel(item.label, label)) ?? null;
  check(label === null || account, 'BANK_ACCOUNT_NOT_FOUND', 'There is no bank account with this name. Import a statement for it first.');
  // Off the app channel (the phone, MCP, a tainted context) the words on a statement row stay in the app, as on Today.
  const inApp = isAppChannel(ctx);
  const rows = book.rows.map(entry => (inApp ? entry.view : { ...entry.view, description: null, counterparty: null }))
    .filter(row => (!account || row.accountId === account.id) && (!month || row.date.startsWith(`${month}-`)))
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (a.row.date < b.row.date ? -1 : a.row.date > b.row.date ? 1 : a.index - b.index))
    .map(item => item.row);
  const now = deps.clock();
  return {
    accounts: book.accounts.map(item => ({
      id: item.id, label: item.label, currency: item.currency, consent: item.consent ? consentStatus(item.consent, now, venture.country.dateOrder) : null,
    })),
    rows, line: ledgerLine(rows, account ? 1 : book.accounts.length), provider: NO_PROVIDER_LINE,
  };
}

// ---------------------------------------------------------------------------
// The owner's decision on one row (venture.bank.apply)
// ---------------------------------------------------------------------------

type Applied = { as: BankMatchRecord['as']; rowId: string; line: Display; payment: { paymentId: string; orderId: string; amountMinor: string; date: string } | null; cost: { minor: string; date: string } | null };

/**
 * venture.bank.apply { transactionId, as, invoiceId? } (prepare, inside the app). Once per row: 'payment' records money in
 * as the payment of an invoice (the named one, else the one it was matched to) through recordPaymentMinor, method
 * bank-transfer, on the row's date; 'cost' writes money out as one cost fact for the books; 'skip' only records the
 * decision. A transfer between own accounts is never income or a cost. After the commit, the calculator's receipt.
 */
export async function bankApply(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankApplyResult> {
  requireAppChannel(ctx, 'venture.bank.apply');
  const body = exactPayload(payload, ['transactionId', 'as', 'invoiceId'], ['transactionId', 'as']);
  const rowId = ledgerIdFrom(body.transactionId);
  check(body.as === 'payment' || body.as === 'cost' || body.as === 'skip', 'INVALID_VENTURE_REQUEST', 'Record it as a payment or a cost, or skip it.');
  const as = body.as as BankMatchRecord['as'];
  check(body.invoiceId === undefined || as === 'payment', 'INVALID_VENTURE_REQUEST', 'Only a payment names an invoice.');
  const named = body.invoiceId === undefined ? null : identifier(body.invoiceId, 'Invoice');

  const applied = await ventureAction(deps, ctx, 'prepare', 'bank.apply', (tx): Applied => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const entry = bankBook(tx.state, venture).byId.get(rowId);
    check(entry, 'BANK_TRANSACTION_NOT_FOUND', 'This bank row was not found. Import the statement it is on first.');
    check(entry.view.decided === null, 'BANK_ALREADY_APPLIED', 'You already decided this bank row. Chausar never counts it twice.');
    check(as === 'skip' || entry.view.classification !== 'own-transfer', 'BANK_OWN_TRANSFER', 'This moved between your own accounts, so it is neither income nor a cost.');
    const amount = BigInt(entry.data.amountMinor);
    const base = tx.base('venture-bank-match');
    const decision = { ...base, transactionId: rowId, accountId: entry.data.accountId, as };
    tx.emit('queue.changed', { bankRow: rowId });
    if (as === 'payment') {
      check(amount > 0n, 'BANK_NOT_MONEY_IN', 'Only money that came in can pay an invoice.');
      const invoiceId = named ?? entry.match?.invoiceId ?? null;
      check(invoiceId, 'INVALID_VENTURE_REQUEST', 'Choose the invoice this pays.');
      const invoice = tx.find('venture-invoice', invoiceId);
      check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
      check(invoice.currency === entry.data.currency, 'INVALID_VENTURE_REQUEST', `This invoice is in ${invoice.currency} and the bank row is in ${entry.data.currency}.`);
      const recorded = recordPaymentMinor(tx, deps, { invoiceId: invoice.id, amount: { minor: amount.toString() }, receivedOn: entry.data.date, method: 'bank-transfer', bankTransactionId: rowId });
      tx.put<BankMatchRecord>({ ...decision, invoiceId: invoice.id, paymentId: recorded.paymentId, factId: null });
      return {
        as, rowId, line: `Recorded ${formatMinor(amount, entry.data.currency)} as a payment of ${invoice.number ?? 'the invoice'}.`,
        payment: { ...recorded, date: entry.data.date }, cost: null,
      };
    }
    if (as === 'cost') {
      check(amount < 0n, 'BANK_NOT_MONEY_OUT', 'Only money that went out can be a cost.');
      const minor = (-amount).toString();
      const description = entry.data.description ?? entry.data.counterparty ?? 'Bank payment';
      const fact = insertBooksFact(tx, deps.store, costFact(base.id, minor, entry.data.currency, entry.data.date, description, rowId));
      tx.put<BankMatchRecord>({ ...decision, invoiceId: null, paymentId: null, factId: fact.id });
      return { as, rowId, line: `Added ${formatMinor(minor, entry.data.currency)} to your costs.`, payment: null, cost: { minor, date: entry.data.date } };
    }
    tx.put<BankMatchRecord>({ ...decision, invoiceId: null, paymentId: null, factId: null });
    return { as, rowId, line: 'Skipped. It stays in your bank ledger and is not counted in the books.', payment: null, cost: null };
  });

  let receiptId: string | null = null;
  if (applied.payment) {
    const { paymentId, orderId, amountMinor, date } = applied.payment;
    const books = await booksReceiptFor(deps, ctx, 'received', date, orderId, amountMinor, RECEIVED_COVERS_MORE);
    await ventureAction(deps, ctx, 'prepare', 'payment.books', tx => {
      const payment = tx.find('venture-payment', paymentId);
      check(payment, 'INVALID_VENTURE_REQUEST', 'This payment was not found.');
      tx.replace({ ...payment, booksReceiptId: books.receiptId, booksNote: books.note });
    });
    receiptId = books.receiptId;
  } else if (applied.cost) {
    receiptId = await costReceipt(deps, ctx, applied.cost.date, applied.cost.minor);
  }
  const { state, venture } = readVenture(deps, ctx);
  const row = bankBook(state, venture).byId.get(applied.rowId)!.view;
  return { row, line: applied.line, ...(receiptId ? { receiptId } : {}) };
}

/** The calculator's costs receipt for the row's day, kept only when its total is exactly this cost. A failure never undoes the cost. */
async function costReceipt(deps: VentureDeps, ctx: Context, date: string, minor: string): Promise<string | null> {
  try {
    const receipt = await deps.services.calculator.calculate(ctx, { operation: 'costs', period: { from: date, to: date } });
    return typeof receipt?.id === 'string' && receipt.totalMinor === minor ? receipt.id : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Alert rules (venture.bank.alerts.get, venture.bank.alerts.set)
// ---------------------------------------------------------------------------

function alertsView(state: State, venture: VentureRecord): BankAlertsView {
  return {
    accounts: listRecords(state, 'venture-bank-account', venture.id).map(account => ({
      account: account.label, accountId: account.id, rules: account.rules ?? [],
      ruleLines: (account.rules ?? []).map(rule => ruleLine(rule, account.currency, venture.country.dateOrder)),
      // Words only: the address itself never leaves the engine, to a screen or to a model.
      destination: account.alertAddress ? ALERTS_SENT_LINE : ALERTS_TODAY_LINE,
    })),
  };
}

/** venture.bank.alerts.get {} (read): each account's rules in the engine's words, and where alerts go, never the address. */
export async function bankAlertsGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankAlertsView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  return alertsView(state, venture);
}

/**
 * venture.bank.alerts.set { account, rules, alertAddress? } (admin, inside the app only): replaces the account's rules and,
 * when given, where alerts go. The address must be https and passes the network guard (setAlertWebhook); null stops
 * alerts going out; left out, the address set before stays.
 */
export async function bankAlertsSet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BankAlertsView> {
  requireAppChannel(ctx, 'venture.bank.alerts.set');
  const body = exactPayload(payload, ['account', 'rules', 'alertAddress'], ['account', 'rules']);
  const label = accountLabel(body.account);
  check(body.alertAddress === undefined || body.alertAddress === null || (typeof body.alertAddress === 'string' && body.alertAddress.length <= 2000),
    'INVALID_VENTURE_REQUEST', 'Give the alert address as a web address, or nothing to stop alerts going out.');
  return ventureAction(deps, ctx, 'admin', 'bank.alerts', tx => {
    const country = countryOf(tx.venture);
    const rules = readAlertRules(body.rules, country.currency);
    const account = findAccount(tx, label) ?? tx.put<BankAccountRecord>({ ...tx.base('venture-bank-account'), label, currency: country.currency, consent: null, polls: [] });
    let alertAddress = account.alertAddress ?? null;
    if (body.alertAddress === null) alertAddress = null;
    else if (typeof body.alertAddress === 'string') {
      alertAddress = setAlertWebhook({ consent: account.consent, polls: account.polls, rules, alertWebhook: alertAddress }, body.alertAddress, ctx, tx.now).alertWebhook;
    }
    tx.replace<BankAccountRecord>({ ...account, rules, alertAddress });
    return alertsView(tx.state, tx.venture!);
  });
}

// ---------------------------------------------------------------------------
// Today (views/queue.ts reads these as 'bank' rows)
// ---------------------------------------------------------------------------

type BankPerform = (deps: VentureDeps, ctx: Context, input: { answer: string | null }) => Promise<{ line: Display; receiptId?: string }>;
export type BankQueueItem = {
  subject: string; version: string; createdAt: string; title: string; line?: string; actions: QueueAction[];
  perform: Partial<Record<QueueActionId, BankPerform>>;
};
const act = (id: QueueActionId, label: string, primary: boolean): QueueAction => ({ id, label, primary });
const subjectPart = (text: string) => text.replace(/[^A-Za-z0-9_.:-]/g, '_');

/**
 * Today's bank rows: one per row that looks like an invoice's payment (Record payment runs venture.bank.apply; Not this
 * leaves the books alone and the row stays in the ledger), and one per import whose rules found something. Inside the
 * app the alert row says what each alert found; anywhere else (the phone) it carries the count only.
 */
export function bankQueueItems(state: State, venture: VentureRecord, ctx: Context): BankQueueItem[] {
  const items: BankQueueItem[] = [];
  for (const { data, view } of bankBook(state, venture).rows) {
    if (view.classification !== 'suggested-payment' || !view.suggestion) continue;
    const suggestion = view.suggestion;
    items.push({
      subject: `bank:${subjectPart(view.id)}`, version: `pay-${suggestion.invoiceId}`, createdAt: data.importedAt,
      title: `Record ${formatMinor(data.amountMinor, data.currency)} from ${formatVentureDate(data.date, venture.country.dateOrder)} as payment of ${suggestion.number}?`,
      line: suggestion.line,
      actions: [act('deny', 'Not this', false), act('approve', 'Record payment', true)],
      perform: {
        approve: async (deps, decider) => {
          const done = await bankApply(deps, decider, { transactionId: view.id, as: 'payment', invoiceId: suggestion.invoiceId });
          return { line: done.line, ...(done.receiptId ? { receiptId: done.receiptId } : {}) };
        },
        deny: async () => ({ line: 'Not recorded. It stays in your bank ledger.' }),
      },
    });
  }
  const accounts = new Map(listRecords(state, 'venture-bank-account', venture.id).map(account => [account.id, account.label]));
  for (const record of listRecords(state, 'venture-bank-import', venture.id)) {
    const alerts = record.alerts ?? [];
    if (!alerts.length) continue;
    const said = `From ${accounts.get(record.accountId) ?? 'your bank account'}: ${alerts.map(alert => alert.line).join(' ')}`;
    items.push({
      subject: `bank-alert:${subjectPart(record.id)}`, version: 'alerts', createdAt: record.at,
      title: alerts.length === 1 ? '1 bank alert from your statement' : `${alerts.length} bank alerts from your statement`,
      ...(isAppChannel(ctx) ? { line: said } : {}),
      actions: [act('later', 'Later', false), act('approve', 'Seen', true)],
      perform: { approve: async () => ({ line: 'Marked as seen.' }) },
    });
  }
  return items;
}
