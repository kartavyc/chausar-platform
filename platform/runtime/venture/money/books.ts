// The books: the existing calculator proves billed, received and earned from the facts the venture wrote.
// Every calculator call here runs after a venture transaction has committed, never inside one.
import { check, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { exactPayload, isoDate, listRecords, readVenture } from '../records.ts';
import { localDayAt, ventureTimeZone } from '../local-day.ts';
import { BOOKS_PERIOD_KEYS, booksPeriods, todayLocal } from './dates.ts';
import { newestFirst } from './shared.ts';
import type { BooksFigure, BooksPeriodKey, BooksSummary, IsoDate, MinorString, VentureDeps, VentureRecord } from '../contracts.ts';

export const EXPERIMENTAL_NOTE = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
export const BOOKS_TAX_NOTE = 'Billed and earned leave out tax. Received is the cash that came in, tax included.';
export const BOOKS_AGING_NOTE = "The back office's receivable aging compares invoices without tax to cash with tax, so use these invoice balances for taxed invoices.";
export const BILLED_COVERS_MORE = 'The books receipt covers more than this invoice.';
export const RECEIVED_COVERS_MORE = 'The books receipt covers more than this payment.';

export const BOOKS_OPERATIONS: readonly { operation: BooksFigure['operation']; label: string }[] = Object.freeze([
  { operation: 'billed', label: 'Billed (without tax)' },
  { operation: 'received', label: 'Received (with tax)' },
  { operation: 'earned', label: 'Earned (without tax)' },
]);

/** An error code safe to show in a note. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z_]{1,64}$/.test(code) ? code : 'REQUEST_FAILED';
}

/**
 * Asks the calculator for one day of one order's billed or received total, after a commit. Keeps the receipt only
 * when its total equals the expected amount; otherwise says why in words. A failed calculation never undoes the
 * committed invoice or payment.
 */
export async function booksReceiptFor(
  deps: VentureDeps, ctx: Context, operation: 'billed' | 'received', date: IsoDate, orderId: string,
  expectedMinor: MinorString, coversMore: string,
): Promise<{ receiptId: string | null; note: string | null }> {
  try {
    const receipt = await deps.services.calculator.calculate(ctx, { operation, period: { from: date, to: date }, orderId });
    const total = receipt?.totalMinor;
    if (typeof receipt?.id === 'string' && typeof total === 'string' && total === expectedMinor) return { receiptId: receipt.id, note: null };
    if (typeof total === 'string' && /^-?\d+$/.test(total) && BigInt(total) > BigInt(expectedMinor)) return { receiptId: null, note: coversMore };
    return { receiptId: null, note: 'The books receipt does not match this amount.' };
  } catch (error) {
    return { receiptId: null, note: `The books receipt could not be made: ${errorCode(error)}.` };
  }
}

/** The business dates the books count: invoice issue dates, payment dates and delivery dates. */
function entryDates(state: State, ventureId: string): IsoDate[] {
  const days: IsoDate[] = [];
  for (const invoice of listRecords(state, 'venture-invoice', ventureId)) if (invoice.status !== 'draft' && invoice.issueDate !== null) days.push(invoice.issueDate);
  for (const payment of listRecords(state, 'venture-payment', ventureId)) days.push(payment.receivedOn);
  for (const order of listRecords(state, 'venture-order', ventureId)) if (order.deliveredOn !== null) days.push(order.deliveredOn);
  return days;
}

/**
 * venture.books.summary { period? | from?, to? } (level read): billed, received and earned for a period, each with its
 * calculator receipt. period picks one of the choices in `periods` ('all' when nothing is given); from and to give
 * exact days instead, and a missing one is taken from 'all'. Every default day is on the owner's calendar.
 */
export async function booksSummary(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BooksSummary> {
  const body = exactPayload(payload, ['period', 'from', 'to']);
  const { state, venture } = readVenture(deps, ctx);
  const custom = body.from !== undefined || body.to !== undefined;
  check(body.period === undefined || (typeof body.period === 'string' && (BOOKS_PERIOD_KEYS as readonly string[]).includes(body.period)),
    'INVALID_VENTURE_REQUEST', 'Choose all time, this month, last month or this year.');
  check(!(custom && body.period !== undefined), 'INVALID_VENTURE_REQUEST', 'Choose a period or give dates, not both.');
  const today = todayLocal(deps.clock, venture.country);
  const periods = booksPeriods(today, startDay(venture), entryDates(state, venture.id));
  const periodKey: BooksPeriodKey = body.period === undefined ? 'all' : body.period as BooksPeriodKey;
  const chosen = periods.find(p => p.key === periodKey) ?? periods[0];
  const from = body.from === undefined ? chosen.from : isoDate(body.from, 'From');
  const to = body.to === undefined ? chosen.to : isoDate(body.to, 'To');
  check(from <= to, 'INVALID_VENTURE_REQUEST', 'The start date must be on or before the end date.');

  const figures: BooksFigure[] = [];
  for (const { operation, label } of BOOKS_OPERATIONS) {
    const receipt = await deps.services.calculator.calculate(ctx, { operation, period: { from, to } });
    check(typeof receipt?.id === 'string' && typeof receipt.totalMinor === 'string' && /^-?\d+$/.test(receipt.totalMinor),
      'INVALID_VENTURE_REQUEST', 'The books gave an answer Chausar could not read.');
    const currency = typeof receipt.currency === 'string' ? receipt.currency : venture.country.currency;
    figures.push({ operation, label, receiptId: receipt.id, minor: receipt.totalMinor, display: formatMinor(receipt.totalMinor, currency), stale: receipt.stale === true });
  }

  const clients = listRecords(state, 'venture-client', venture.id);
  const openInvoices = newestFirst(listRecords(state, 'venture-invoice', venture.id))
    .reverse()
    .filter(invoice => (invoice.status === 'issued' || invoice.status === 'part-paid') && BigInt(invoice.balanceMinor) > 0n && invoice.number !== null && invoice.dueDate !== null)
    .sort((a, b) => ((a.dueDate as string) < (b.dueDate as string) ? -1 : (a.dueDate as string) > (b.dueDate as string) ? 1 : 0))
    .map(invoice => ({
      invoiceId: invoice.id,
      number: invoice.number as string,
      clientName: clients.find(c => c.id === invoice.clientId)?.name ?? 'Unknown client',
      balanceMinor: invoice.balanceMinor,
      balanceDisplay: formatMinor(invoice.balanceMinor, invoice.currency),
      dueDate: invoice.dueDate as IsoDate,
    }));

  const notes = [BOOKS_TAX_NOTE, BOOKS_AGING_NOTE];
  if (deps.storage === 'experimental-file') notes.push(EXPERIMENTAL_NOTE);
  return {
    period: { from, to }, periodKey: custom ? 'custom' : periodKey, periods, today, timeZone: ventureTimeZone(venture.country),
    currency: venture.country.currency, figures, openInvoices, notes,
  };
}

/** The day the business was started, on the owner's calendar. */
function startDay(venture: VentureRecord): IsoDate {
  return localDayAt(venture.at, venture.country);
}
