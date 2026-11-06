// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, M13 and M14): every money figure says how it was made.
// A figure is reported (read from a file, with its row), calculated (code added it up, with its receipt), an assumption
// (an input taken as given, shown beside each result that uses it) or an estimate (a model's, labelled "model estimate"
// and never given a receipt). A figure whose receipt holds amounts not known yet (a call still running, a forecast)
// says so with estimate. A total also says what it counted (the filters), whether it stopped short and what it left
// out and why: money in another currency is never added to the business's own, and each total counts what it left out
// ("1 not counted: 1 payment in another currency, with no rate to INR"), so a total that left something out never reads
// as complete. Nothing here adds money; it labels what code added.
import { ChausarError, check, type State } from '../../contracts.ts';
import { BOOKS_SOURCE_ID, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import type { CountryProfile, Display, FigureKind, FigureSource, IsoDate, KindedFigure, SumReceiptRecord, TotalBasis, VentureRecord } from '../contracts.ts';
import { paymentState } from './ledger.ts';

export const FIGURE_KINDS: readonly FigureKind[] = Object.freeze(['reported', 'calculated', 'assumption', 'estimate']);

/**
 * The business's country, which gives its currency and calendar. A business still in its interview has none yet
 * (venture.country is null there): the money views refuse in words rather than guess a currency.
 */
export function moneyCountry(venture: VentureRecord): CountryProfile {
  const country = (venture as { country: CountryProfile | null }).country;
  check(country, 'INVALID_VENTURE_REQUEST', 'Choose the country of your business first, so Chausar knows its currency.');
  return country;
}

/** Whether the business has its country yet (NOTES 32): a read that cannot work without one answers empty. */
export function hasCountry(venture: VentureRecord): boolean {
  return (venture as { country: CountryProfile | null }).country !== null;
}

type Extra = { uses?: Display[]; projected?: boolean; basis?: TotalBasis };

/** Adds the optional parts only when they say something. */
function withExtra(figure: KindedFigure, extra: Extra): KindedFigure {
  return {
    ...figure,
    ...(extra.uses && extra.uses.length ? { uses: [...extra.uses] } : {}),
    ...(extra.projected ? { projected: true as const } : {}),
    ...(extra.basis ? { basis: extra.basis } : {}),
  };
}

/** A figure code added up, shown as its receipt shows it, with that receipt as its source; estimate when the receipt is. */
export function calculatedFigure(receipt: SumReceiptRecord, extra: Extra = {}): KindedFigure {
  return withExtra({
    display: receipt.figures[0].display, receiptId: receipt.id, kind: 'calculated', source: { from: 'receipt', receiptId: receipt.id },
    ...(receipt.estimate ? { estimate: true as const } : {}),
  }, extra);
}

/** A figure read from one row of a file the owner gave (a bank statement's balance), with the record and row it came from. */
export function reportedFigure(display: Display, receiptId: string, source: { recordId: string; row: string; line: Display }, extra: Extra = {}): KindedFigure {
  return withExtra({ display, receiptId, kind: 'reported', source: { from: 'file', ...source } }, extra);
}

/** An input taken as given (the owner's rate, a usual amount), in words, with the receipt of a result that uses it. */
export function assumptionFigure(display: Display, receiptId: string, line: Display, extra: Extra = {}): KindedFigure {
  return withExtra({ display, receiptId, kind: 'assumption', source: { from: 'input', line } }, extra);
}

/** A whole number of thousandths, from a BigInt worked out in minor units: never a float on an amount. */
export function countOf(value: bigint): number {
  return parseInt(value.toString(), 10);
}

/** One kind of item a total left out: how many, and the words for one and for several. */
export type LeftOut = { count: number; one: string; many: string };

/** How a total was made. notCounted: how many items were left out and why, in words; null when nothing was. */
export function basisOf(filters: readonly Display[], notCounted: { count: number; line: Display } | null = null, truncated = false): TotalBasis {
  return { filters: [...filters], truncated, notCounted: notCounted && notCounted.count > 0 ? { ...notCounted } : null };
}

/** "3 not counted: 1 payment in another currency, with no rate to INR; 2 paid AI calls with no rupee rate set"; null for none. */
export function notCountedOf(parts: readonly LeftOut[]): { count: number; line: Display } | null {
  const left = parts.filter(part => part.count > 0);
  const count = left.reduce((sum, part) => sum + part.count, 0);
  return count > 0 ? { count, line: `${count} not counted: ${left.map(part => `${part.count} ${part.count === 1 ? part.one : part.many}`).join('; ')}` } : null;
}

/** Items in another currency, which Chausar keeps apart: it has no rate to the business's own. */
export function otherCurrency(count: number, one: string, many: string, currency: string): LeftOut {
  return { count, one: `${one} in another currency, with no rate to ${currency}`, many: `${many} in another currency, with no rate to ${currency}` };
}

/** Open invoices (issued, with a balance) in another currency than the business's. */
export function openElsewhere(state: State, venture: VentureRecord): number {
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => (invoice.status === 'issued' || invoice.status === 'part-paid') && invoice.number !== null && BigInt(invoice.balanceMinor) > 0n && invoice.currency !== venture.country.currency).length;
}

/** Cleared payments received from one day to another in another currency. */
export function paymentsElsewhere(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate): number {
  return listRecords(state, 'venture-payment', venture.id)
    .filter(payment => paymentState(payment) === 'cleared' && payment.receivedOn >= from && payment.receivedOn <= to && payment.currency !== venture.country.currency).length;
}

/** Invoices issued from one day to another in another currency. */
export function invoicesElsewhere(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate): number {
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => invoice.number !== null && invoice.status !== 'draft' && invoice.issueDate !== null && invoice.issueDate >= from && invoice.issueDate <= to && invoice.currency !== venture.country.currency).length;
}

/** Credit notes issued from one day to another (owner's calendar) in another currency. */
export function creditsElsewhere(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate): number {
  return listRecords(state, 'venture-credit-note', venture.id).filter(note => note.status === 'issued' && note.issuedAt !== null && note.currency !== venture.country.currency
    && localDayAt(note.issuedAt, venture.country) >= from && localDayAt(note.issuedAt, venture.country) <= to).length;
}

/** The books' cost facts from one day to another in another currency. */
export function costsElsewhere(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate): number {
  return state.facts.filter(fact => fact.kind === 'cost' && fact.sourceId === BOOKS_SOURCE_ID && !fact.supersededAt && !fact.deletedAt
    && fact.fields.currency !== venture.country.currency && fact.validFrom >= from && fact.validFrom <= to).length;
}

/** Whether a source matches its kind, the way a contract test walks every figure. */
export function sourceFits(kind: FigureKind, source: FigureSource): boolean {
  if (kind === 'reported') return source.from === 'file';
  if (kind === 'calculated') return source.from === 'receipt';
  if (kind === 'assumption') return source.from === 'input';
  return source.from === 'model';
}

/** One page of a paged read: its items and the cursor of the next page, null at the end. */
export type Page<T> = { items: T[]; next: string | null };

/**
 * Reads every page of a paged source. It stops only when the source says there is no next page: a short or empty page
 * is not the end. A cursor seen before stops it with PAGING_LOOP, so a source that loops can never be read as complete.
 * After maxPages it stops with truncated set, so the total built from it says it stopped short.
 * No caller yet: every money view reads the vault's own records, which are not paged. This is here, tested, for the
 * first connector read that pages (M14); until one uses it, M14's paging rule is not in force anywhere.
 */
export async function readAllPages<T>(fetchPage: (cursor: string | null) => Promise<Page<T>>, maxPages = 100): Promise<{ items: T[]; truncated: boolean }> {
  check(Number.isInteger(maxPages) && maxPages >= 1 && maxPages <= 10_000, 'INVALID_VENTURE_REQUEST', 'Read between 1 and 10,000 pages.');
  const seen = new Set<string>();
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const got: Page<T> = await fetchPage(cursor);
    items.push(...got.items);
    if (got.next === null) return { items, truncated: false };
    if (seen.has(got.next) || got.next === cursor) throw new ChausarError('PAGING_LOOP', 'The source gave the same page twice, so Chausar stopped reading it. Nothing was counted as complete.');
    seen.add(got.next);
    cursor = got.next;
  }
  return { items, truncated: true };
}
