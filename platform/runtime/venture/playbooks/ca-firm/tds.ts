// AI-native CA firm: the TDS working for a business that deducts tax, for common sections, from the versioned
// section table, in BigInt paise. Per payee and section it applies the threshold (per bill or per year for
// contractors, per year for fees, commission and interest, per month for rent), deducts at the highest of the rate
// in the Act, the rate in force or 20% when there is no valid PAN (section 206AA, and 397(2) from FY 2026-27), puts
// the catch-up on earlier bills onto the payment that crosses the threshold, and lists the challans by section and
// month with the deposit due date. TDS is rounded to the nearest rupee. The CA
// files the TDS returns (24Q, 26Q) on TRACES; agents never do.
import { ChausarError } from '../../../contracts.ts';
import { bpsText, divRound, invalid, isoDate, maxBig, notModelled, paise, sumBig, type IsoDate } from './money.ts';
import { rateTableFor, sectionOf, useRateTable, REHEARSAL, type RateTable, type RateUse, type TdsPayload, type TdsSectionRate } from './rates.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';

export type PayeeKind = 'individual' | 'huf' | 'company' | 'firm' | 'other';
export type TdsSectionCode = '194A' | '194C' | '194H' | '194I-building' | '194I-plant' | '194J-professional' | '194J-technical' | '194T';
export type TdsPayment = { id: string; payee: string; pan: string | null; payeeKind: PayeeKind; section: TdsSectionCode; date: IsoDate; amountMinor: string };
export type TdsWorkingInput = { financialYear: '2025-26' | '2026-27'; payments: TdsPayment[] };
export type TdsRow = {
  id: string; payee: string; section: string; date: IsoDate; amountMinor: string; rateBps: string;
  /** This payment's own share of TDS once the threshold is crossed; 0 when it never is. */
  dueMinor: string;
  /** What is deducted on this payment's date: its own share and any catch-up on earlier bills. */
  tdsMinor: string;
  /** When this payment's share is deducted; null when the threshold is never crossed. */
  deductOn: IsoDate | null;
  note: string;
};
export type TdsWorking = {
  payments: TdsRow[];
  challans: { section: string; month: string; depositDue: IsoDate; tdsMinor: string }[];
  findings: string[];
};

const PAN = /^[A-Z]{5}\d{4}[A-Z]$/;
const PAN_LETTER: Partial<Record<PayeeKind, string>> = { individual: 'P', huf: 'H', company: 'C', firm: 'F' };
const LETTER_WORDS: Readonly<Record<string, string>> = { P: 'an individual', H: 'a Hindu undivided family', C: 'a company', F: 'a firm', T: 'a trust', A: 'an association of persons', B: 'a body of individuals', L: 'a local authority', J: 'an artificial juridical person', G: 'a government body' };
const KINDS: readonly PayeeKind[] = ['individual', 'huf', 'company', 'firm', 'other'];

export function tdsTable(financialYear: string): RateTable<TdsPayload> {
  if (typeof financialYear !== 'string' || !/^\d{4}-\d{2}$/.test(financialYear)) invalid('The financial year is written like 2025-26.');
  const table = rateTableFor<TdsPayload>('tds-sections', `${financialYear.slice(0, 4)}-04-01`);
  if (table.payload.financialYear !== financialYear) throw new ChausarError('RATE_TABLE_MISSING', `No TDS table is kept for the financial year ${financialYear}.`);
  return table;
}

/** The deposit due date for tax deducted in a month: the 7th of the next month, or 30 April for March. */
export function depositDue(month: string, payload: TdsPayload): IsoDate {
  const [y, m] = month.split('-').map(Number);
  if (m === 3) return `${y}-${payload.marchDepositDue}`;
  const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
  return `${next.y}-${String(next.m).padStart(2, '0')}-${String(payload.depositDayNextMonth).padStart(2, '0')}`;
}

type Item = { payment: TdsPayment; index: number; amount: bigint; rate: bigint; due: bigint; deductedAt: TdsPayment | null; noPan: boolean };

/** Marks when each payment in one payee's bucket is deducted, by the bucket's threshold. Payments are in date order. */
function applyThreshold(items: Item[], threshold: TdsSectionRate['threshold']): void {
  const yearly = threshold.kind === 'single-or-year' ? BigInt(threshold.yearMinor) : BigInt(threshold.amountMinor);
  let running = 0n, crossed = false;
  const waiting: Item[] = [];
  for (const item of items) {
    running += item.amount;
    if (crossed) { item.deductedAt = item.payment; continue; }
    if (threshold.kind === 'single-or-year' && item.amount > BigInt(threshold.singleMinor)) item.deductedAt = item.payment;
    else waiting.push(item);
    if (running > yearly) {
      crossed = true;
      for (const earlier of waiting) earlier.deductedAt = item.payment;
      waiting.length = 0;
    }
  }
}

export function tdsWorking(input: TdsWorkingInput, use: RateUse = REHEARSAL): CaReceipt<TdsWorking> {
  if (!input || typeof input !== 'object' || !Array.isArray(input.payments)) invalid('Send the payments as a list.');
  const table = tdsTable(input.financialYear);
  const stamp = useRateTable(table, use);
  const rates = table.payload;
  const builder = new ReceiptBuilder('tds-working');
  builder.useTable(table, stamp);
  const findings: string[] = [];
  const ids = new Set<string>();

  const items: Item[] = input.payments.map((payment, index) => {
    const where = `Payment ${index + 1}`;
    if (!payment || typeof payment !== 'object') invalid(`${where} is not a payment.`);
    if (typeof payment.id !== 'string' || !/^[A-Za-z0-9_.-]{1,60}$/.test(payment.id) || ids.has(payment.id)) invalid(`${where} needs a short id of its own.`);
    ids.add(payment.id);
    if (typeof payment.payee !== 'string' || !payment.payee.trim() || payment.payee.length > 120) invalid(`${where} needs the payee's name.`);
    if (!KINDS.includes(payment.payeeKind)) invalid(`${where} needs the kind of payee.`);
    const date = isoDate(payment.date, `${where}'s date`);
    if (date < table.validFrom || (table.validTo !== null && date >= table.validTo)) invalid(`${where} is dated ${date}, outside the financial year ${input.financialYear}.`);
    const amount = paise(payment.amountMinor, `${where}'s amount`);
    const section = rates.sections.find(item => item.code === payment.section);
    if (!section) notModelled(`Section ${String(payment.section)} is not in this TDS working. Your CA works it.`);
    const pan = payment.pan === null ? null : String(payment.pan).toUpperCase();
    const noPan = pan === null || !PAN.test(pan);
    if (pan !== null && !noPan) {
      const expected = PAN_LETTER[payment.payeeKind];
      if (expected && pan[3] !== expected) findings.push(`The PAN ${pan} of ${payment.payee}: the fourth letter ${pan[3]} means ${LETTER_WORDS[pan[3]] ?? 'another kind of payee'}, but the payee is recorded as a ${payment.payeeKind}. Check which rate applies.`);
    }
    const base = BigInt(payment.payeeKind === 'individual' || payment.payeeKind === 'huf' ? section!.individualBps : section!.otherBps);
    const rate = noPan ? maxBig(base * BigInt(rates.noPanMultiplier), BigInt(rates.noPanFloorBps)) : base;
    return { payment: { ...payment, pan }, index, amount, rate, due: 0n, deductedAt: null, noPan };
  });

  // Buckets: one payee and one section; rent also one month.
  const buckets = new Map<string, Item[]>();
  for (const item of items) {
    const section = rates.sections.find(entry => entry.code === item.payment.section)!;
    const payee = item.payment.pan && !item.noPan ? item.payment.pan : item.payment.payee.trim().toLowerCase().replace(/\s+/g, ' ');
    const key = `${section.code}|${payee}${section.threshold.kind === 'month' ? `|${item.payment.date.slice(0, 7)}` : ''}`;
    buckets.set(key, [...buckets.get(key) ?? [], item]);
  }
  for (const [key, bucket] of buckets) {
    const section = rates.sections.find(entry => entry.code === key.split('|')[0])!;
    bucket.sort((a, b) => (a.payment.date < b.payment.date ? -1 : a.payment.date > b.payment.date ? 1 : a.index - b.index));
    applyThreshold(bucket, section.threshold);
  }
  for (const item of items) item.due = item.deductedAt ? divRound(item.amount * item.rate, 1_000_000n, 'half-up') * 100n : 0n;

  // The no-PAN rule in the Act's words: the highest of the rate in the Act, the rate in force or the floor. Only
  // version 1 of the FY 2025-26 table, kept for history, doubled the rate.
  const floor = bpsText(rates.noPanFloorBps);
  const noPanRule = rates.noPanMultiplier === '1'
    ? `the rate in the Act, the rate in force or ${floor}, whichever is highest`
    : `twice the rate or ${floor}, whichever is higher`;
  const rows: TdsRow[] = items.map(item => {
    const atThis = items.filter(other => other.deductedAt?.id === item.payment.id);
    const notes: string[] = [];
    if (item.noPan) notes.push(`No PAN: ${bpsText(item.rate)}, ${noPanRule}.`);
    if (!item.deductedAt) notes.push('Below the threshold so far: nothing to deduct.');
    else if (item.deductedAt.id !== item.payment.id) notes.push(`Deducted on ${item.deductedAt.date}, when the threshold was crossed.`);
    if (atThis.some(other => other.payment.id !== item.payment.id)) notes.push('Carries the catch-up on earlier bills.');
    return {
      id: item.payment.id, payee: item.payment.payee, section: item.payment.section, date: item.payment.date, amountMinor: String(item.amount),
      rateBps: String(item.rate), dueMinor: String(item.due), tdsMinor: String(sumBig(atThis.map(other => other.due))),
      deductOn: item.deductedAt?.date ?? null, note: notes.join(' '),
    };
  });

  const challanMap = new Map<string, { section: string; month: string; tds: bigint }>();
  for (const item of items) {
    if (!item.deductedAt || item.due === 0n) continue;
    const month = item.deductedAt.date.slice(0, 7);
    const key = `${month}|${item.payment.section}`;
    const entry = challanMap.get(key) ?? { section: item.payment.section, month, tds: 0n };
    entry.tds += item.due;
    challanMap.set(key, entry);
  }
  const challans = [...challanMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, entry]) => ({ section: entry.section, month: entry.month, depositDue: depositDue(entry.month, rates), tdsMinor: String(entry.tds) }));

  const codes = [...new Set(items.map(item => item.payment.section))].sort();
  for (const code of codes) {
    const section = rates.sections.find(entry => entry.code === code)!;
    // Section references are keyed by the payment's code ('194I-building' reads 'tds-194I'), so a table that names
    // the Income-tax Act, 2025 section (393) keeps the same keys.
    builder.step(`tds-${code}`, `TDS under ${section.title.toLowerCase()}`, sumBig(items.filter(item => item.payment.section === code).map(item => item.due)), sectionOf(table, `tds-${code.split('-')[0]}`));
  }
  builder.step('tds-total', 'TDS for the year so far', sumBig(items.map(item => item.due)));
  if (items.some(item => item.noPan)) builder.cite(sectionOf(table, 'no-pan'));
  if (challans.length) builder.cite(sectionOf(table, 'deposit'));
  builder.assume('TDS is rounded to the nearest rupee on each payment; the CA confirms the rounding the return utility uses.');
  builder.assume('A payment is counted when it is paid or credited, whichever is earlier, on the date given.');

  return builder.build(input, { payments: rows, challans, findings }, `TDS working for the financial year ${input.financialYear}: ${items.length} payments, ${challans.length} challans.`, stamp);
}
