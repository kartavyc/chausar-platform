// Chausar venture launcher, views (Ink v2 wave 4, package 4G2; catalogue O10): the figures behind the "moved sharply"
// probe. Money received (cleared payments, by the day they came in) and money billed (issued invoices, before tax, by
// their issue day) are added up per week (Monday to Sunday, on the owner's calendar) in BigInt from records. A week
// moved sharply when its total, in whole units of the business's currency, is more than 3 standard deviations from
// the mean of the weeks before it (up to 12, never before the first week that has any), with at least 7 of them and a
// spread above zero. The test is integer arithmetic only: with n weeks, S their sum and Q their sum of squares, the
// week's total x moved sharply when (n x - S)^2 > 9 (n Q - S^2). This week counts only when it rose (a week still
// under way can only grow); last week counts either way. Both figures a notice states carry receipts that are worked
// out again from the records on every read: 'fig:week:<what>:<monday>' and 'fig:weeks:<what>:<first monday>:<last
// monday>'. Nothing here is stored, and no number comes from a model.
import { ChausarError, type State } from '../../contracts.ts';
import { currencyMinorDigits, formatMinor } from '../../currency.ts';
import { digest, formatVentureDate, listRecords } from '../records.ts';
import type { InvoiceRecord, IsoDate, IsoTime, QueueAmount, QueueRow, RowFigure, RowFigureReceipt, VentureRecord } from '../contracts.ts';
import { paymentState } from '../money/ledger.ts';
import { beforeTax } from '../money/goal-plans.ts';
import { addDays, daysBetween, weekStart } from '../network/followups.ts';

/** The two weekly figures a probe watches. */
export type WeeklyWhat = 'received' | 'billed';
export const WEEKLY_WHATS: readonly WeeklyWhat[] = Object.freeze(['received', 'billed']);
/** The z-score's numbers: how many weeks before the one tested it needs and reads at most, and the bar. */
export const SHARP_MOVE = Object.freeze({ minWeeks: 7, maxWeeks: 12, z: 3 });

const ISSUED: readonly InvoiceRecord['status'][] = ['issued', 'part-paid', 'paid'];
/** label: the words a receipt names it by, worked out only for the items a receipt lists. */
type Item = { recordId: string; day: IsoDate; at: IsoTime; minor: bigint; label: () => string };

/** Every dated amount of one kind in the business's own currency, oldest first. */
function itemsOf(state: State, venture: VentureRecord, what: WeeklyWhat): Item[] {
  const currency = venture.country.currency;
  const order = venture.country.dateOrder;
  if (what === 'received') {
    return listRecords(state, 'venture-payment', venture.id)
      .filter(payment => paymentState(payment) === 'cleared' && payment.currency === currency)
      .map(payment => ({ recordId: payment.id, day: payment.receivedOn, at: payment.at, minor: BigInt(payment.amountMinor), label: () => `Payment of ${formatVentureDate(payment.receivedOn, order)}` }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
  }
  return listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => ISSUED.includes(invoice.status) && invoice.number !== null && invoice.issueDate !== null && invoice.currency === currency)
    .map(invoice => ({ recordId: invoice.id, day: invoice.issueDate as IsoDate, at: invoice.at, minor: beforeTax(invoice), label: () => `${invoice.number}, issued ${formatVentureDate(invoice.issueDate as IsoDate, order)}` }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.at.localeCompare(b.at));
}

const inWeek = (items: readonly Item[], monday: IsoDate) => items.filter(item => item.day >= monday && item.day <= addDays(monday, 6));
const totalOf = (items: readonly Item[]) => items.reduce((sum, item) => sum + item.minor, 0n);

/** Every week's total, Monday to Sunday, keyed by its Monday: the items are walked once. */
function byWeek(items: readonly Item[]): Map<IsoDate, bigint> {
  const totals = new Map<IsoDate, bigint>();
  for (const item of items) {
    const monday = weekStart(item.day);
    totals.set(monday, (totals.get(monday) ?? 0n) + item.minor);
  }
  return totals;
}
const weekTotal = (weeks: ReadonlyMap<IsoDate, bigint>, monday: IsoDate) => weeks.get(monday) ?? 0n;

/** The Mondays from one to another, both included. */
function mondays(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let day = from; day <= to; day = addDays(day, 7)) out.push(day);
  return out;
}

/** The baseline weeks before a week: up to 12, from the first week with any amount; null when fewer than 7. */
function baselineOf(items: readonly Item[], week: IsoDate): { from: IsoDate; to: IsoDate } | null {
  if (!items.length) return null;
  const first = weekStart(items[0].day);
  const to = addDays(week, -7);
  const earliest = addDays(week, -7 * SHARP_MOVE.maxWeeks);
  const from = first > earliest ? first : earliest;
  if (from > to || daysBetween(from, to) / 7 + 1 < SHARP_MOVE.minWeeks) return null;
  return { from, to };
}

/** A week's total in whole units of the currency, the fraction dropped: the units the z-score is worked in. */
const wholeOf = (minor: bigint, scale: bigint) => minor / scale;

/** The mean of weekly totals in minor units, rounded half up to a whole unit of the currency. */
function averageMinor(totals: readonly bigint[], scale: bigint): bigint {
  const n = BigInt(totals.length);
  const sum = totals.reduce((total, value) => total + value, 0n);
  return ((2n * sum + n * scale) / (2n * n * scale)) * scale;
}

/** Whether a week's total moved more than 3 standard deviations from its baseline, and which way; null when not, or when there is no spread. */
function moved(x: bigint, baseline: readonly bigint[]): 'up' | 'down' | null {
  const n = BigInt(baseline.length);
  const s = baseline.reduce((total, value) => total + value, 0n);
  const q = baseline.reduce((total, value) => total + value * value, 0n);
  const spread = n * q - s * s;
  if (spread <= 0n) return null;
  const d = n * x - s;
  const z = BigInt(SHARP_MOVE.z);
  return d * d > z * z * spread ? (d > 0n ? 'up' : 'down') : null;
}

/** One sharp move of one weekly figure, with what its notice says and the receipts behind it. */
export type SharpMove = {
  what: WeeklyWhat; week: IsoDate; current: boolean; direction: 'up' | 'down';
  total: string; average: string; weeks: number; weekReceiptId: string; averageReceiptId: string;
};

export const WEEK_FIGURE = Object.freeze({
  week: (what: WeeklyWhat, monday: IsoDate) => `fig:week:${what}:${monday}`,
  weeks: (what: WeeklyWhat, from: IsoDate, to: IsoDate) => `fig:weeks:${what}:${from}:${to}`,
});

/**
 * The sharp move of one weekly figure as of today, or null: this week when it already rose sharply, else last week
 * when it rose or fell sharply. Reads only.
 */
export function sharpMove(state: State, venture: VentureRecord, what: WeeklyWhat, today: IsoDate): SharpMove | null {
  const items = itemsOf(state, venture, what);
  const currency = venture.country.currency;
  const scale = 10n ** BigInt(currencyMinorDigits(currency));
  const thisWeek = weekStart(today);
  const weekly = byWeek(items);
  for (const [week, current] of [[thisWeek, true], [addDays(thisWeek, -7), false]] as const) {
    const baseline = baselineOf(items, week);
    if (!baseline) continue;
    const totals = mondays(baseline.from, baseline.to).map(monday => weekTotal(weekly, monday));
    const total = weekTotal(weekly, week);
    const direction = moved(wholeOf(total, scale), totals.map(value => wholeOf(value, scale)));
    if (!direction || (current && direction !== 'up')) continue;
    return {
      what, week, current, direction, total: formatMinor(total, currency), average: formatMinor(averageMinor(totals, scale), currency), weeks: totals.length,
      weekReceiptId: WEEK_FIGURE.week(what, week), averageReceiptId: WEEK_FIGURE.weeks(what, baseline.from, baseline.to),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The receipts (venture.receipt.get, through views/row-receipts.ts)
// ---------------------------------------------------------------------------

const WHAT_WORDS: Readonly<Record<WeeklyWhat, { one: string; many: string; label: string; how: string }>> = Object.freeze({
  received: { one: 'payment', many: 'payments', label: 'Received', how: 'cleared payments, by the day each came in' },
  billed: { one: 'invoice', many: 'invoices', label: 'Billed before tax', how: 'issued invoices before tax, by their issue day' },
});
const GONE = 'This receipt was not found.';
const MONDAY = /^\d{4}-\d{2}-\d{2}$/;

function receipt(venture: VentureRecord, id: string, subject: RowFigureReceipt['subject'], at: IsoTime, figures: RowFigure[], explanation: string): RowFigureReceipt {
  // Each figure as written, in any currency (a money pattern would miss some codes).
  const allowedNumbers = [...new Set(figures.map(figure => figure.display))];
  return {
    id, kind: 'row-figure', ventureId: venture.id, at, operation: 'venture.row-figure', subject, figures, allowedNumbers, explanation,
    digest: digest({ id, figures: figures.map(figure => [figure.key, figure.unit, figure.amount]) }), stale: false,
  };
}

const isMonday = (day: string | undefined): day is IsoDate => !!day && MONDAY.test(day) && !Number.isNaN(Date.parse(`${day}T00:00:00.000Z`)) && weekStart(day) === day;

/**
 * The receipt behind a weekly figure a "moved sharply" notice states, worked out again from the records: one week's
 * total ('fig:week:<what>:<monday>'), or the weekly average over a run of weeks ('fig:weeks:<what>:<from>:<to>', each
 * week's total then the average). null when the id is not one of these; RECEIPT_NOT_FOUND when it does not fit.
 */
export function weekFigureReceipt(state: State, venture: VentureRecord, id: string): RowFigureReceipt | null {
  const [, kind, what, from, to, extra] = id.split(':');
  if (kind !== 'week' && kind !== 'weeks') return null;
  if (!venture.country || !(WEEKLY_WHATS as readonly string[]).includes(what) || extra !== undefined || !isMonday(from)) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  const words = WHAT_WORDS[what as WeeklyWhat];
  const items = itemsOf(state, venture, what as WeeklyWhat);
  const currency = venture.country.currency;
  const order = venture.country.dateOrder;
  const figureOf = (key: string, label: string, minor: bigint): RowFigure => ({ key, label, amount: String(minor), unit: 'minor', currency, display: formatMinor(minor, currency) });
  if (kind === 'week') {
    if (to !== undefined) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
    const counted = inWeek(items, from);
    const total = totalOf(counted);
    const named = counted.map(item => `${item.label()} ${formatMinor(item.minor, currency)}`).join('; ');
    const count = counted.length === 1 ? `1 ${words.one}` : `${counted.length} ${words.many}`;
    return receipt(venture, id, { type: 'week-total', recordId: `${what}:${from}` }, counted.at(-1)?.at ?? `${from}T00:00:00.000Z`,
      [figureOf('total', `${words.label}, week of ${formatVentureDate(from, order)}`, total)],
      `${count} in the week of ${formatVentureDate(from, order)}, added in code from ${words.how}${named ? `: ${named}` : ''}. Total ${formatMinor(total, currency)}.`);
  }
  if (!isMonday(to) || to < from || daysBetween(from, to) / 7 + 1 > SHARP_MOVE.maxWeeks) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  const scale = 10n ** BigInt(currencyMinorDigits(currency));
  const weeks = mondays(from, to);
  const weekly = byWeek(items);
  const totals = weeks.map(monday => weekTotal(weekly, monday));
  const average = averageMinor(totals, scale);
  const figures = weeks.map((monday, index) => figureOf(`week-${monday}`, `Week of ${formatVentureDate(monday, order)}`, totals[index]));
  figures.push(figureOf('average', 'Average week', average));
  return receipt(venture, id, { type: 'week-average', recordId: `${what}:${from}:${to}` }, `${to}T00:00:00.000Z`, figures,
    `The ${weeks.length} weekly totals from the week of ${formatVentureDate(from, order)} to the week of ${formatVentureDate(to, order)}, added in code from ${words.how}, then divided by ${weeks.length} and rounded to a whole amount: ${formatMinor(average, currency)} a week.`);
}

/**
 * The amounts a probe notice's line states, each with its receipt: the notice carries each amount exactly as the line
 * writes it, and each is found in the line by its text, in order, after the one before (views/row-meta.ts adds them
 * after the digest, as it does every row's amounts). No money pattern is involved, so any currency gets its receipts.
 * An amount the line does not hold is left out.
 */
export function noticeAmounts(row: Pick<QueueRow, 'line' | 'notice'>): QueueAmount[] {
  const figures = row.notice?.figures ?? [];
  const line = row.line ?? '';
  const amounts: QueueAmount[] = [];
  let from = 0;
  for (const figure of figures) {
    const start = figure.text ? line.indexOf(figure.text, from) : -1;
    if (start < 0) continue;
    amounts.push({ text: figure.text, where: 'line', start, length: figure.text.length, receiptId: figure.receiptId });
    from = start + figure.text.length;
  }
  return amounts;
}
