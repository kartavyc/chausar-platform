// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, M9): what clients owe on open invoices, in five buckets
// by days late (venture.money.aging). It is a true as-of: on a day (today on the owner's calendar unless asOf is given)
// it counts the invoices issued by then, each at what was left on it then: today's balance with the payments that
// cleared and the credit notes issued after that day added back. Days are counted from each due date to that day.
// Balances count tax, as the invoices do (books.ts BOOKS_AGING_NOTE: the books' own receivable aging compares invoices
// without tax to cash with tax, so it is not used here). One aging sum receipt lists every invoice with its bucket;
// each bucket adds its invoices from that receipt, so the five add up to the total exactly. Each bucket's share is per
// mille of the total, floored in BigInt, at least 1 when it holds anything. Invoices in another currency are left out
// and the total says so. Money in BigInt minor units.
import type { Context, State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { exactPayload, formatVentureDate, isoDate, listRecords, readVenture } from '../records.ts';
import { localDayAt, ventureTimeZone } from '../local-day.ts';
import type {
  AgingBucketId, AgingBucketView, AgingInvoiceView, AgingView, InvoiceRecord, IsoDate, KindedFigure, SumReceiptSubject, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { daysFrom, lateWords, paymentState, settledBy } from './ledger.ts';
import { sumReceipt, type SumPlan } from './sums.ts';
import { basisOf, calculatedFigure, countOf, moneyCountry, notCountedOf, otherCurrency } from './figure-kinds.ts';

/** The five buckets, in order: each one's words on the screen and in a receipt's line, and its last day late. */
const BUCKETS: readonly { id: AgingBucketId; label: string; word: string; upTo: number }[] = Object.freeze([
  { id: 'not-due', label: 'Not due yet', word: 'not due yet', upTo: 0 },
  { id: '1-30', label: '1 to 30 days late', word: '1 to 30 days late', upTo: 30 },
  { id: '31-60', label: '31 to 60 days late', word: '31 to 60 days late', upTo: 60 },
  { id: '61-90', label: '61 to 90 days late', word: '61 to 90 days late', upTo: 90 },
  { id: 'over-90', label: 'Over 90 days late', word: 'over 90 days late', upTo: Number.POSITIVE_INFINITY },
]);

/** Whole days an invoice is late on a day: 0 or below while it is not due. */
export function daysLate(invoice: Pick<InvoiceRecord, 'dueDate'>, asOf: IsoDate): number {
  return invoice.dueDate === null ? 0 : daysFrom(invoice.dueDate, asOf);
}

/** The bucket of a number of days late. */
export function bucketOf(days: number): AgingBucketId {
  return BUCKETS.find(bucket => days <= bucket.upTo)!.id;
}

/** How late an open invoice is on a day, in days and words; null while it is not due (4J4, M9). */
export function lateOf(invoice: Pick<InvoiceRecord, 'status' | 'dueDate' | 'balanceMinor' | 'number'>, asOf: IsoDate): { days: number; line: string } | null {
  if ((invoice.status !== 'issued' && invoice.status !== 'part-paid') || invoice.number === null || BigInt(invoice.balanceMinor) <= 0n) return null;
  const days = daysLate(invoice, asOf);
  return days > 0 ? { days, line: lateWords(days) } : null;
}

type Owed = { invoice: InvoiceRecord; minor: bigint };

/**
 * Invoices issued by a day with something left on them on that day, oldest due first, and how many in other currencies
 * were left out. What was left then: today's balance, plus what cleared or was credited after that day.
 */
function owedOn(state: State, venture: VentureRecord, asOf: IsoDate): { owed: Owed[]; other: number } {
  const later = new Map<string, bigint>();
  const add = (invoiceId: string, minor: bigint) => later.set(invoiceId, (later.get(invoiceId) ?? 0n) + minor);
  for (const payment of listRecords(state, 'venture-payment', venture.id)) if (paymentState(payment) === 'cleared' && payment.receivedOn > asOf) add(payment.invoiceId, settledBy(payment));
  for (const note of listRecords(state, 'venture-credit-note', venture.id)) {
    if (note.status === 'issued' && note.issuedAt !== null && localDayAt(note.issuedAt, venture.country) > asOf) add(note.invoiceId, BigInt(note.amountMinor));
  }
  let other = 0;
  const owed: Owed[] = [];
  for (const invoice of listRecords(state, 'venture-invoice', venture.id)) {
    if (invoice.number === null || !['issued', 'part-paid', 'paid'].includes(invoice.status) || invoice.issueDate === null || invoice.issueDate > asOf) continue;
    const minor = BigInt(invoice.balanceMinor) + (later.get(invoice.id) ?? 0n);
    if (minor <= 0n) continue;
    if (invoice.currency !== venture.country.currency) { other += 1; continue; }
    owed.push({ invoice, minor });
  }
  owed.sort((a, b) => (a.invoice.dueDate ?? '').localeCompare(b.invoice.dueDate ?? '') || (a.invoice.number as string).localeCompare(b.invoice.number as string));
  return { owed, other };
}

/** The `aging` receipt's addends as of a day: each invoice's balance then, with its bucket, oldest due first. */
export function agingPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'aging' }>): SumPlan {
  const country = moneyCountry(venture);
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  // late (4J20): the invoices past their due date on that day alone.
  const owed = owedOn(state, venture, subject.asOf).owed.filter(({ invoice }) => !subject.late || daysLate(invoice, subject.asOf) > 0);
  const addends = owed.map(({ invoice, minor }) => ({
    recordId: invoice.id,
    label: `${invoice.number} for ${names.get(invoice.clientId) ?? 'a client'}, ${BUCKETS.find(bucket => bucket.id === bucketOf(daysLate(invoice, subject.asOf)))!.word}`,
    amount: String(minor), display: formatMinor(minor, invoice.currency), estimate: false,
  }));
  return {
    subject: subject.late ? { type: 'aging', asOf: subject.asOf, late: true } : { type: 'aging', asOf: subject.asOf }, currency: country.currency, unit: 'minor', addends,
    words: subject.late
      ? { label: 'Owed on late invoices', one: 'late invoice', many: 'late invoices', none: 'No invoice is late.' }
      : { label: 'Owed by age', one: 'open invoice', many: 'open invoices', none: 'No open invoices, so nothing is owed.' },
  };
}

const countLine = (count: number) => (count === 0 ? 'None' : `${count} ${count === 1 ? 'invoice' : 'invoices'}`);

/** A share of the total in per mille, floored, at least 1 for a part that holds anything. */
export function permilleOf(part: bigint, whole: bigint): number {
  if (whole <= 0n || part <= 0n) return 0;
  const share = countOf((part * 1000n) / whole);
  return share === 0 ? 1 : share;
}

/**
 * venture.money.aging { asOf? } (read): what was owed on a day, tax included, in five buckets by days late, with counts,
 * amounts, shares and one receipt; the invoices oldest due first, each with how late it was then in words.
 */
export async function moneyAging(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgingView> {
  const body = exactPayload(payload, ['asOf']);
  const { state, venture } = readVenture(deps, ctx);
  const country = moneyCountry(venture);
  const asOf = body.asOf === undefined ? localDayAt(deps.clock(), country) : isoDate(body.asOf, 'As of');
  const plan = agingPlan(state, venture, { type: 'aging', asOf });
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  const { owed, other } = owedOn(state, venture, asOf);
  const shown = formatVentureDate(asOf, country.dateOrder);
  const basis = basisOf(
    [`Invoices in ${country.currency} issued by ${shown}, tax included, less what was paid or credited by then`, `Days late from the due date, as of ${shown} in ${ventureTimeZone(country)}`],
    notCountedOf([otherCurrency(other, 'open invoice', 'open invoices', country.currency)]),
  );
  const total = calculatedFigure(receipt, { basis });
  const part = (minor: bigint): KindedFigure => ({ display: formatMinor(minor, country.currency), receiptId: receipt.id, kind: 'calculated', source: { from: 'receipt', receiptId: receipt.id } });
  const sums = new Map<AgingBucketId, { count: number; minor: bigint }>(BUCKETS.map(bucket => [bucket.id, { count: 0, minor: 0n }]));
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const rows: AgingInvoiceView[] = owed.map(({ invoice, minor }) => {
    const days = daysLate(invoice, asOf);
    const bucket = bucketOf(days);
    const sum = sums.get(bucket)!;
    sum.count += 1;
    sum.minor += minor;
    return {
      invoiceId: invoice.id, number: invoice.number as string, client: names.get(invoice.clientId) ?? 'A client', dueDate: invoice.dueDate as IsoDate,
      bucket, late: days > 0 ? { days, line: lateWords(days) } : null, balance: part(minor),
    };
  });
  const whole = BigInt(receipt.totalMinor);
  const buckets: AgingBucketView[] = BUCKETS.map(bucket => {
    const sum = sums.get(bucket.id)!;
    return { id: bucket.id, label: bucket.label, count: sum.count, countLine: countLine(sum.count), amount: part(sum.minor), permille: permilleOf(sum.minor, whole) };
  });
  const lateCount = rows.filter(row => row.late !== null).length;
  const line = rows.length === 0 ? 'Nothing is owed on open invoices.'
    : `${total.display} is owed on ${rows.length} open ${rows.length === 1 ? 'invoice' : 'invoices'} as of ${shown}.${lateCount ? ` ${lateCount} of them ${lateCount === 1 ? 'is' : 'are'} late.` : ''}`;
  // 4J20: what the late ones owe, with its own receipt listing each of them; none late, none shown.
  const late = lateCount ? calculatedFigure(await sumReceipt(deps, ctx, venture.id, agingPlan(state, venture, { type: 'aging', asOf, late: true }))) : null;
  return { asOf, buckets, total, invoices: rows, line, late };
}
