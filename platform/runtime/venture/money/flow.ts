// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, M9): money in and out by month, and what was left
// (venture.money.flow). In is cleared payments by the day received on the owner's calendar, tax included (sums.ts
// receivedPlan). Out is every cost fact in the books by its day at what left the bank: a bank row's cost as it was, a bill
// payment's cost fact with the GST it may claim back (both left the bank), so a bill counts once whether it was paid by
// typing it or against its bank row (bills.ts). AI and tool spend is counted by UTC month, as the spend limit counts it,
// in rupees at the owner's own rate and labelled with that rate; without a rate (or for a business that keeps its books
// in another currency) it is left out and the month and the total say so, never counted as zero. Each figure has its
// own sum receipt; bars are per mille of the largest month; a side with nothing recorded is null. Money in BigInt.
import type { Context, Fact, State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { BOOKS_SOURCE_ID, exactPayload, formatVentureDate, listRecords, readVenture, smallInteger } from '../records.ts';
import type { FlowMonthView, FlowView, IsoDate, KindedFigure, SpendRecord, SumReceiptSubject, VentureDeps, VentureRecord } from '../contracts.ts';
import { calendarMonth, todayLocal } from './dates.ts';
import { monthWords, previousMonth } from './goal-plans.ts';
import { microsToPaise, rupeeRateWords, rupeesOf, spendOfMonth, type Rupees } from './spend.ts';
import { receivedPlan, sumReceipt, type Addend, type SumPlan } from './sums.ts';
import { basisOf, calculatedFigure, costsElsewhere, countOf, moneyCountry, notCountedOf, otherCurrency, paymentsElsewhere } from './figure-kinds.ts';

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 'Oct 2026' for '2026-10'. */
export function shortMonth(month: string): string {
  return `${SHORT_MONTHS[parseInt(month.slice(5, 7), 10) - 1]} ${month.slice(0, 4)}`;
}

/** One cost fact as money out: what left the bank (its amount and any tax it holds) and whether a bill wrote it. */
export type CostOut = { fact: Fact; cash: bigint; bill: boolean };

/** The ids of every cost fact a bill payment is recorded against: its own, or a bank row's it was matched to. */
function billFactIds(state: State, ventureId: string): Set<string> {
  return new Set(listRecords(state, 'venture-bill', ventureId).flatMap(bill => bill.payments.map(payment => payment.factId)).filter((id): id is string => typeof id === 'string'));
}

/** The books' cost facts in the business's currency (or in any, given null) from one day to another, both included, by day. */
export function costsOut(state: State, venture: VentureRecord, from: IsoDate, to: IsoDate, currency: string | null = venture.country.currency): CostOut[] {
  const bills = billFactIds(state, venture.id);
  const minor = (value: unknown) => (typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : 0n);
  return state.facts
    .filter(fact => fact.kind === 'cost' && fact.sourceId === BOOKS_SOURCE_ID && !fact.supersededAt && !fact.deletedAt
      && (currency === null || fact.fields.currency === currency) && fact.validFrom >= from && fact.validFrom <= to)
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom) || a.sourceRow - b.sourceRow)
    .map(fact => ({ fact, cash: minor(fact.fields.amountMinor) + minor(fact.fields.taxMinor), bill: typeof fact.fields.billId === 'string' || bills.has(fact.id) }));
}

/** A cost fact as an addend: its words and day, at what left the bank. */
export function costAddend(venture: VentureRecord, cost: CostOut): Addend {
  const words = typeof cost.fact.fields.description === 'string' && cost.fact.fields.description.trim() ? cost.fact.fields.description.trim() : 'A cost';
  return { recordId: cost.fact.id, label: `${words}, ${formatVentureDate(cost.fact.validFrom, venture.country.dateOrder)}`, amount: String(cost.cash), display: formatMinor(cost.cash, venture.country.currency), estimate: false };
}

/**
 * One paid call in rupees at the owner's rate: its US dollar figure converted on its own, half a paisa up (spend.ts
 * microsToPaise), the one rule flow, cash and margins all use. A spend record keeps no rupee rate of its own (rupees are
 * shown, never kept: spend.ts), so the rate is the owner's rate today, and the views' basis says so. The addend keeps
 * its record's own id and the rate beside it (rupeeRate), so the receipt still links to the call, says which rate it
 * used, and reads stale once the rate changes. A call still running counts at its estimate and is marked so.
 */
export function callAddend(item: { record: SpendRecord; micros: bigint; estimate: boolean }, rupees: Rupees): Addend {
  const paise = microsToPaise(String(item.micros), rupees.rate.perUsd);
  return {
    recordId: item.record.id, label: `${item.record.label}${item.estimate ? ' (estimate)' : ''} at ${rupeeRateWords(rupees)}`,
    amount: String(paise), display: formatMinor(paise, 'INR'), estimate: item.estimate, rupeeRate: rupees.rate.perUsd,
  };
}

/** The basis line for AI spend in rupees: the owner's rate today, since no spend record keeps the rate of its day. */
export function rateBasis(rate: string | null): string[] {
  return rate ? [`AI spend in rupees at your rate today, ${rate}: Chausar keeps no rate for the day of each call`] : [];
}

/**
 * The month's AI and tool spend (UTC month, as the spend limit counts it), one addend a call in the business's currency
 * at the owner's rupee rate. counted is false when there was spend Chausar has no rate to count.
 */
export function aiSpendOut(state: State, venture: VentureRecord, month: string): { addends: Addend[]; calls: number; counted: boolean; rate: string | null } {
  const items = spendOfMonth(listRecords(state, 'venture-spend', venture.id), month);
  if (!items.length) return { addends: [], calls: 0, counted: true, rate: null };
  const rupees = rupeesOf(state, venture);
  if (!rupees || venture.country.currency !== 'INR') return { addends: [], calls: items.length, counted: false, rate: null };
  return { addends: items.map(item => callAddend(item, rupees)), calls: items.length, counted: true, rate: rupeeRateWords(rupees) };
}

/** Why AI spend was left out, for a business with no rate to its currency. */
function noRateWhy(venture: VentureRecord): string {
  return venture.country.currency === 'INR' ? 'no rupee rate set' : `no rate from US dollars to ${venture.country.currency}`;
}

const PART_WORDS = Object.freeze({
  in: { label: 'Money in', one: 'payment', many: 'payments', none: 'Nothing came in this month.' },
  out: { label: 'Money out', one: 'cost', many: 'costs', none: 'Nothing went out this month.' },
  left: { label: 'What was left', one: 'entry', many: 'entries', none: 'Nothing came in or went out this month.' },
});

/** The `flow` receipt's addends: one month's money in, its money out, or both with money out as negative amounts. */
export function flowPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'flow' }>): SumPlan {
  const country = moneyCountry(venture);
  const { from, to } = calendarMonth(subject.month);
  const ins = receivedPlan(state, venture, from, to).addends;
  const outs = [...costsOut(state, venture, from, to).map(cost => costAddend(venture, cost)), ...aiSpendOut(state, venture, subject.month).addends];
  const negate = (addend: Addend): Addend => ({ ...addend, label: `Out: ${addend.label}`, amount: String(-BigInt(addend.amount)), display: formatMinor(-BigInt(addend.amount), country.currency) });
  const addends = subject.part === 'in' ? ins : subject.part === 'out' ? outs : [...ins.map(addend => ({ ...addend, label: `In: ${addend.label}` })), ...outs.map(negate)];
  const words = PART_WORDS[subject.part];
  return {
    subject: { type: 'flow', month: subject.month, part: subject.part }, currency: country.currency, unit: 'minor', addends,
    words: { ...words, label: `${words.label}, ${monthWords(subject.month)}` },
    estimateWords: 'AI calls not settled yet count at their estimate.',
  };
}

/** The months to show, oldest first, ending with this one on the owner's calendar. */
function lastMonths(today: IsoDate, count: number): string[] {
  const months = [today.slice(0, 7)];
  while (months.length < count) months.unshift(previousMonth(months[0]));
  return months;
}

/**
 * venture.money.flow { months? } (read): money in and out for the last months (6 unless asked, 1 to 24), and what was
 * left, each figure with its receipt; the AI spend at the owner's rate, labelled with it, or left out and said so.
 */
export async function moneyFlow(deps: VentureDeps, ctx: Context, payload: unknown): Promise<FlowView> {
  const body = exactPayload(payload, ['months']);
  const count = body.months === undefined ? 6 : smallInteger(body.months, 'Months', 1, 24);
  const { state, venture } = readVenture(deps, ctx);
  const country = moneyCountry(venture);
  const today = todayLocal(deps.clock, country);
  const thisMonth = today.slice(0, 7);
  let rate: string | null = null, uncounted = 0, anySpend = false, otherIn = 0, otherOut = 0;
  const rows: { month: string; in: KindedFigure | null; out: KindedFigure | null; left: KindedFigure | null; inMinor: bigint | null; outMinor: bigint | null; note: string | null }[] = [];
  for (const month of lastMonths(today, count)) {
    const plans = (['in', 'out', 'left'] as const).map(part => flowPlan(state, venture, { type: 'flow', month, part }));
    const ai = aiSpendOut(state, venture, month);
    if (ai.calls) anySpend = true;
    if (ai.rate) rate = ai.rate;
    if (!ai.counted) uncounted += ai.calls;
    const { from, to } = calendarMonth(month);
    otherIn += paymentsElsewhere(state, venture, from, to);
    otherOut += costsElsewhere(state, venture, from, to);
    const uses = ai.addends.length && ai.rate ? [ai.rate] : [];
    const figure = async (plan: SumPlan, withRate: boolean) => (plan.addends.length ? calculatedFigure(await sumReceipt(deps, ctx, venture.id, plan), withRate ? { uses } : {}) : null);
    const [inPlan, outPlan, leftPlan] = plans;
    const total = (plan: SumPlan) => (plan.addends.length ? plan.addends.reduce((sum, addend) => sum + BigInt(addend.amount), 0n) : null);
    rows.push({
      month, in: await figure(inPlan, false), out: await figure(outPlan, true), left: await figure(leftPlan, true),
      inMinor: total(inPlan), outMinor: total(outPlan), note: ai.counted ? null : `AI spend not counted: ${noRateWhy(venture)}`,
    });
  }
  const largest = rows.reduce((max, row) => [row.inMinor ?? 0n, row.outMinor ?? 0n].reduce((m, v) => (v > m ? v : m), max), 0n);
  const scaled = (minor: bigint | null) => (minor === null ? null : largest <= 0n ? 0 : countOf((minor * 1000n) / largest));
  const months: FlowMonthView[] = rows.map(row => ({
    month: row.month, label: row.month === thisMonth ? `${shortMonth(row.month)} so far` : shortMonth(row.month),
    in: row.in, out: row.out, left: row.left, inPermille: scaled(row.inMinor), outPermille: scaled(row.outMinor), receiptId: row.left?.receiptId ?? null, note: row.note,
  }));
  const spendLine = !anySpend ? '' : rate && uncounted === 0 ? ` AI spend counts at ${rate}.` : ` AI spend is not counted: ${noRateWhy(venture)}.`;
  const basis = basisOf(
    [`Money in: cleared payments in ${country.currency}, tax included, by the day received`, 'Money out: costs in the books, tax included, by the day paid', 'AI spend by UTC month, as your spend limit counts it', ...rateBasis(rate)],
    notCountedOf([
      otherCurrency(otherIn, 'payment', 'payments', country.currency), otherCurrency(otherOut, 'cost', 'costs', country.currency),
      { count: uncounted, one: `paid AI call with ${noRateWhy(venture)}`, many: `paid AI calls with ${noRateWhy(venture)}` },
    ]),
  );
  return { months, line: `Money in and out for the last ${count} ${count === 1 ? 'month' : 'months'}, tax included.${spendLine}`, basis };
}
