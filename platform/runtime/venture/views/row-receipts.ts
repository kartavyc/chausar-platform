// Chausar venture launcher, views (Ink v2 wave 4, package 4J1): receipts for the figures Today's rows state. A row's
// line, change and price beside Approve carry amounts code worked out from stored records: the most the next call to
// the owner's AI can cost (from the price table, before anything is sent), the most the judge's check can cost, the
// room a run at its spend cap asks for (in rupees at the owner's own rate too), a spend quote's figure, the prices a plan
// version sets, and this month's spend against its limit. Each is served by venture.receipt.get under an id that names
// its record ('fig:<kind>:<record id>[:<call id>]') and is worked out again from that record on every read, so nothing
// here is stored and no number comes from a model. A receipt whose record has moved on says it is stale.
import { ChausarError, type Context, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { digest, findRecord, formatMicros, listRecords } from '../records.ts';
import type {
  BlueprintRecord, DeliveryRunRecord, Display, IsoTime, Offer, RowFigure, RowFigureReceipt, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { latestBlueprint, newestFirst } from '../money/shared.ts';
import { quoteLive, rupeeFigure, rupeeRateWords, rupeesOf, spendOfMonth } from '../money/spend.ts';
import { capWindow, runCapMicros } from '../delivery/harness/loop.ts';
import { judgeNotice } from '../delivery/judge-run.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { clientNameFor } from './shared.ts';
import { weekFigureReceipt } from './probe-figures.ts';
import { shareWords } from '../money/share-price.ts';

/** Money text as the screens' money rule finds it: a currency sign or code, then its digits. */
export const MONEY_TEXT = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s?)\d[\d,]*(?:\.\d+)?/g;

/** Every amount a text states, in order, as it is written there. */
export function moneyIn(text: string | undefined | null): string[] {
  return [...(text ?? '').matchAll(MONEY_TEXT)].map(match => match[0]);
}

/** The ids of the figures a row may state. Each names the record the receipt is worked out from. */
export const ROW_FIGURE = Object.freeze({
  cost: (runId: string, callId: string) => `fig:cost:${runId}:${callId}`,
  judge: (runId: string, callId: string) => `fig:judge:${runId}:${callId}`,
  room: (runId: string, callId: string) => `fig:room:${runId}:${callId}`,
  quote: (quoteId: string) => `fig:quote:${quoteId}`,
  plan: (blueprintId: string) => `fig:plan:${blueprintId}`,
  spend: (month: string) => `fig:spend:${month}`,
  // 4F3: a run's spend cap as its scope froze it when it started (the run sheet's scope line).
  scope: (runId: string) => `fig:scope:${runId}`,
});

const GONE = 'This figure\'s record is gone, so there is no receipt for it.';
const MOVED_ON = 'This step was sent or replaced since, so this figure no longer stands. What it cost is under Money, Spend.';

/** A plan offer's price as Today's rows say it: "INR 2,999.00 per month", or "Not set". */
export function offerPriceText(offer: Offer | undefined, currency: string): string {
  // Ink v2 wave 5 (5A2): an offer priced as a share of an amount the client confirms later (money/share-price.ts).
  if (offer?.pricing.share) return shareWords(offer.pricing.share.bps);
  const minor = offer?.pricing.unitPriceMinor ?? null;
  return minor === null ? 'Not set' : `${formatMinor(minor, currency)} per ${offer!.pricing.quantityUnit}`;
}

const usd = (key: string, label: string, micros: string, display: Display = formatMicros(micros)): RowFigure =>
  ({ key, label, amount: micros, unit: 'micros', currency: 'USD', display });

function receiptOf(venture: VentureRecord, id: string, subject: RowFigureReceipt['subject'], at: IsoTime, figures: RowFigure[], explanation: string, stale: boolean): RowFigureReceipt {
  const allowedNumbers = [...new Set(figures.flatMap(figure => moneyIn(figure.display)))];
  return {
    id, kind: 'row-figure', ventureId: venture.id, at, operation: 'venture.row-figure', subject, figures, allowedNumbers, explanation,
    digest: digest({ id, figures: figures.map(figure => [figure.key, figure.unit, figure.amount]) }), stale,
  };
}

function runOf(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  if (!run || run.ventureId !== venture.id) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  return run;
}

/** The most the next call can cost, as the model port worked it out from the price table when it made the preview. */
function callCost(state: State, venture: VentureRecord, id: string, runId: string, callId: string): RowFigureReceipt {
  const run = runOf(state, venture, runId);
  const subject = { type: 'call-cost' as const, recordId: run.id };
  const preview = run.preview?.callId === callId ? run.preview : null;
  if (!preview) return receiptOf(venture, id, subject, run.at, [], MOVED_ON, true);
  const display = preview.estimatedMaxCostDisplay;
  return receiptOf(venture, id, subject, run.at, [usd('most', 'Most it can cost', preview.estimatedMaxCostMicros, display)],
    `The most the next step for ${clientNameFor(state, venture.id, run.orderId)} can cost on ${preview.model ?? 'your AI'}, worked out by code from its price table before anything was sent: ${display}. Nothing is spent until you approve it, and the provider's bill is what counts.`,
    false);
}

/** The most the judge's check of the ready draft can cost, worked out by code the same way the row's notice was. */
function judgeCost(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, id: string, runId: string, callId: string): RowFigureReceipt {
  const run = runOf(state, venture, runId);
  const subject = { type: 'judge-cost' as const, recordId: run.id };
  const notice = run.preview?.callId === callId ? judgeNotice(deps, ctx, state, venture, run) : null;
  if (!notice || notice.boundMicros === null) return receiptOf(venture, id, subject, run.at, [], MOVED_ON, true);
  return receiptOf(venture, id, subject, run.at, [usd('judge', "Most the judge's check can cost", notice.boundMicros, notice.cost)],
    `Once this draft is ready, the judge reads it on your AI for quick work. The most that check can cost, worked out by code from that AI's price table: ${notice.cost}. Nothing is spent until it runs.`,
    false);
}

/** The room a run at its spend cap asks for: whole windows of its own cap, enough for the call that waits. */
function capRoom(state: State, venture: VentureRecord, id: string, runId: string, callId: string): RowFigureReceipt {
  const run = runOf(state, venture, runId);
  const subject = { type: 'cap-room' as const, recordId: run.id };
  const preview = run.preview?.callId === callId ? run.preview : null;
  const harness = run.harness ?? null;
  const window = preview && harness ? capWindow(harness, preview.estimatedMaxCostMicros) : null;
  if (!preview || !harness || window === null) return receiptOf(venture, id, subject, run.at, [], MOVED_ON, true);
  const cap = String(runCapMicros(harness));
  const figures = [
    usd('room', BigInt(window) <= BigInt(harness.limits.maxCostMicros) ? 'One more window' : 'More spend for this run', window),
    usd('cap', "This run's spend cap", cap), usd('used', 'Used so far', harness.used.costMicros),
    usd('next', 'The next step could cost up to', preview.estimatedMaxCostMicros, preview.estimatedMaxCostDisplay),
  ];
  const rupees = rupeesOf(state, venture);
  let said = '';
  if (rupees) {
    figures.push({ key: 'room-inr', label: 'The same in rupees', amount: window, unit: 'micros', currency: 'INR', display: rupeeFigure(window, rupees) });
    figures.push({ key: 'rate', label: 'Your rate', amount: rupees.rate.perUsd, unit: 'rate', currency: 'INR', display: rupeeRateWords(rupees) });
    said = ` In rupees at ${rupeeRateWords(rupees)}: ${rupeeFigure(window, rupees)}.`;
  }
  return receiptOf(venture, id, subject, run.at, figures,
    `This run's spend cap is ${formatMicros(cap)} and it has used ${formatMicros(harness.used.costMicros)}. The next step could cost up to ${preview.estimatedMaxCostDisplay}, which would pass the cap. More room comes in whole windows of the run's own cap of ${formatMicros(harness.limits.maxCostMicros)}: ${formatMicros(window)}.${said} Nothing is spent until the step runs.`,
    false);
}

/** 4F3: a run's spend cap as its scope froze it when the run started; it never changes while the run goes on. */
function scopeCap(state: State, venture: VentureRecord, id: string, runId: string): RowFigureReceipt {
  const run = runOf(state, venture, runId);
  if (!run.scope) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  const subject = { type: 'scope-cap' as const, recordId: run.id };
  const figures = [usd('cap', "This run's spend cap", run.scope.capMicros)];
  const rupees = rupeesOf(state, venture);
  let said = '';
  if (rupees) {
    figures.push({ key: 'cap-inr', label: 'The same in rupees', amount: run.scope.capMicros, unit: 'micros', currency: 'INR', display: rupeeFigure(run.scope.capMicros, rupees) });
    figures.push({ key: 'rate', label: 'Your rate', amount: rupees.rate.perUsd, unit: 'rate', currency: 'INR', display: rupeeRateWords(rupees) });
    said = ` In rupees at ${rupeeRateWords(rupees)}: ${rupeeFigure(run.scope.capMicros, rupees)}.`;
  }
  return receiptOf(venture, id, subject, run.scope.frozenAt, figures,
    `Set when the run started, from the business's spend cap for one run: ${formatMicros(run.scope.capMicros)}.${said} It does not change while the run goes on.`,
    false);
}

/** A spend quote's figure, as code worked it out from the price before the call; it holds for one hour. */
function spendQuote(state: State, venture: VentureRecord, id: string, quoteId: string, now: IsoTime): RowFigureReceipt {
  const quote = findRecord(state, 'venture-spend-quote', quoteId);
  if (!quote || quote.ventureId !== venture.id) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  return receiptOf(venture, id, { type: 'spend-quote', recordId: quote.id }, quote.at, [usd('cost', 'It may cost', quote.figureMicros, quote.figure)],
    `The most ${quote.label} may cost, worked out by code from its price before the call: ${quote.figure}. One approval pays for this one call within an hour; nothing is spent until it runs.`,
    !quoteLive(quote, now));
}

/** The prices a plan version sets beside the ones in use: the owner typed them, code only compares them. */
function planPrices(state: State, venture: VentureRecord, id: string, blueprintId: string): RowFigureReceipt {
  const plan = findRecord(state, 'venture-blueprint', blueprintId) as BlueprintRecord | undefined;
  if (!plan || plan.ventureId !== venture.id) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  const accepted = acceptedBlueprintOrNull(state, venture);
  const currency = plan.backOffice.currency;
  const figures: RowFigure[] = [];
  const said: string[] = [];
  for (const offer of plan.offers) {
    const before = accepted?.offers.find(item => item.id === offer.id);
    const was = before?.pricing.unitPriceMinor ?? null, now = offer.pricing.unitPriceMinor;
    if (was !== null) figures.push({ key: `${offer.id}.before`, label: `${offer.name.value}, in use`, amount: was, unit: 'minor', currency, display: offerPriceText(before, currency) });
    if (now !== null) figures.push({ key: `${offer.id}.after`, label: `${offer.name.value}, in version ${plan.version}`, amount: now, unit: 'minor', currency, display: offerPriceText(offer, currency) });
    if (was !== now || (before?.pricing.share?.bps ?? null) !== (offer.pricing.share?.bps ?? null)) said.push(`${offer.name.value} is ${offerPriceText(before, currency)} in the plan in use and ${offerPriceText(offer, currency)} in version ${plan.version}`);
  }
  const latest = latestBlueprint(listRecords(state, 'venture-blueprint', venture.id));
  return receiptOf(venture, id, { type: 'plan-price', recordId: plan.id }, plan.at, figures,
    `You set these prices${said.length ? `: ${said.join('; ')}` : ''}. Chausar did not work them out; code only compares the two versions.`,
    latest?.id !== plan.id || plan.status !== 'draft');
}

/** This UTC month's AI and tool spend, added in code from the spend ledger, beside the owner's monthly limit. */
function monthSpend(state: State, venture: VentureRecord, id: string, month: string): RowFigureReceipt {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new ChausarError('RECEIPT_NOT_FOUND', GONE);
  const items = spendOfMonth(listRecords(state, 'venture-spend', venture.id), month);
  const spent = String(items.reduce((total, item) => total + item.micros, 0n));
  const policy = newestFirst(listRecords(state, 'venture-spend-policy', venture.id))[0] ?? null;
  const cap = policy?.capMicros ?? null;
  const figures = [usd('spent', 'AI and tools this month', spent), ...(cap !== null ? [usd('limit', 'Your monthly limit', cap)] : [])];
  const rupees = rupeesOf(state, venture);
  if (rupees) {
    figures.push({ key: 'spent-inr', label: 'Spent, in rupees', amount: spent, unit: 'micros', currency: 'INR', display: rupeeFigure(spent, rupees) });
    if (cap !== null) figures.push({ key: 'limit-inr', label: 'The limit, in rupees', amount: cap, unit: 'micros', currency: 'INR', display: rupeeFigure(cap, rupees) });
    figures.push({ key: 'rate', label: 'Your rate', amount: rupees.rate.perUsd, unit: 'rate', currency: 'INR', display: rupeeRateWords(rupees) });
  }
  const held = items.some(item => item.estimate) ? ' Calls not settled yet count at what they hold.' : '';
  const newest = newestFirst(items.map(item => item.record))[0]?.at ?? `${month}-01T00:00:00.000Z`;
  return receiptOf(venture, id, { type: 'month-spend', recordId: month }, newest, figures,
    `${items.length === 1 ? '1 paid call' : `${items.length} paid calls`} this month, added in code from the spend ledger: ${formatMicros(spent)}${cap !== null ? `, of your monthly limit of ${formatMicros(cap)}` : ''}.${held}`,
    false);
}

/**
 * The receipt behind a figure a Today row states, worked out again from its record, for venture.receipt.get; null when
 * the id is not one of these. RECEIPT_NOT_FOUND when its record is gone or the id does not fit.
 */
export function rowFigureReceipt(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, id: string): RowFigureReceipt | null {
  if (!id.startsWith('fig:')) return null;
  const [, kind, first, second] = id.split(':');
  const now = deps.clock().toISOString();
  if (kind === 'cost' && first && second) return callCost(state, venture, id, first, second);
  if (kind === 'judge' && first && second) return judgeCost(deps, ctx, state, venture, id, first, second);
  if (kind === 'room' && first && second) return capRoom(state, venture, id, first, second);
  if (kind === 'quote' && first && !second) return spendQuote(state, venture, id, first, now);
  if (kind === 'plan' && first && !second) return planPrices(state, venture, id, first);
  if (kind === 'spend' && first && !second) return monthSpend(state, venture, id, first);
  if (kind === 'scope' && first && !second) return scopeCap(state, venture, id, first);
  // 4G2: the two figures of a "moved sharply" notice, a week's total and the weekly average before it (probe-figures.ts).
  if (kind === 'week' || kind === 'weeks') return weekFigureReceipt(state, venture, id);
  throw new ChausarError('RECEIPT_NOT_FOUND', 'This receipt was not found.');
}
