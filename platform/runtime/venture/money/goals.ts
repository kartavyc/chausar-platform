// Chausar venture launcher, money (Ink v2 wave 4, package 4I1): the owner's monthly goal. The goal counts money
// invoiced in the month before tax (not cash received, not profit), by the invoices' issue date on the owner's
// calendar, less credit notes issued in the month. venture.goals.get shows the month against its goal: invoiced, ready
// to issue, still to invoice (or past the goal by) and received so far, each a sum receipt code made in BigInt, and
// today's pace with its own receipt each day; a sum with nothing in it shows zero with no receipt, and none is written.
// The bar's shares are whole thousandths; the next best step and the briefing come from Today's rows (next-step.ts).
// venture.goals.set keeps a goal inside the app, for the owner; a newer goal for the same month is the one in use and
// the older stays as history. venture.goals.suggest asks the owner's own AI for a figure from the plan's offers and
// prices only (no client data), labelled a model estimate; it never becomes a goal unless the owner sets it.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currencyMinorDigits, decimalMinor, formatMinor } from '../../currency.ts';
import { exactPayload, isAppChannel, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type {
  BlueprintRecord, GoalFigureView, GoalRecord, GoalSuggestion, GoalView, Json, ModelTask, MoneyFigureView, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { localDayAt } from '../local-day.ts';
import { queueListHandler } from '../views/queue.ts';
import { calendarMonth, todayLocal } from './dates.ts';
import { latestBlueprint } from './shared.ts';
import { planDisplay, planTotal, receivedPlan, sumReceipt, type SumPlan } from './sums.ts';
import {
  aheadOfPace, daysInMonth, elapsedOn, goalInUse, goalPlan, invoicedPlan, monthsBetween, monthText, monthWords, previousMonth,
  requireGoalCurrency, taxRegistered,
} from './goal-plans.ts';
import { nextBestStep } from './next-step.ts';

const REJECTED = 'MODEL_OUTPUT_REJECTED';
/** A goal is a whole number of minor units above zero, at most 15 digits. */
const GOAL_AMOUNT = /^[1-9]\d{0,14}$/;
/** How far from this month a goal is read (back) and set, read or suggested (ahead). */
const MONTHS_BACK = 24;
const MONTHS_AHEAD = 12;
export const SUGGEST_LINE = 'A model estimate from your offers and prices. Change it to what you aim for.';

function goalAmount(value: unknown): string {
  check(typeof value === 'string' && GOAL_AMOUNT.test(value), 'GOAL_INVALID', 'A goal must be a whole amount above zero, at most 15 digits in the smallest unit of your currency.');
  return value;
}

/**
 * The owner's typed goal in minor units of the business's currency: digits with an optional decimal part, spaces and
 * grouping commas allowed ("1,50,000.50"); no more decimals than the currency has. Anything else is GOAL_INVALID.
 */
export function typedGoal(value: unknown, currency: string): string {
  const words = `Type the goal like 150000 or 150000.50, in ${currency}.`;
  check(typeof value === 'string' && value.length <= 40, 'GOAL_INVALID', words);
  const cleaned = value.replace(/[\s,]/g, '');
  check(/^\d+(?:\.\d+)?$/.test(cleaned), 'GOAL_INVALID', words);
  let minor: string;
  try {
    minor = decimalMinor(cleaned, currency);
  } catch {
    // More decimals than the currency has.
    check(false, 'GOAL_INVALID', words);
  }
  return goalAmount(BigInt(minor).toString());
}

/** A goal is set or suggested for this month or one up to a year ahead: a month over is GOAL_MONTH_PAST. */
function monthToPlan(month: string, today: string): void {
  check(month >= today.slice(0, 7), 'GOAL_MONTH_PAST', `${monthWords(month)} is over. Choose this month or a later one.`);
  check(monthsBetween(today.slice(0, 7), month) <= MONTHS_AHEAD, 'INVALID_VENTURE_REQUEST', 'Choose this month or one up to a year ahead.');
}

/** A sum's figure: with its receipt when it adds anything up; an empty sum shows zero with no receipt, and none is written. */
async function figureFor(deps: VentureDeps, ctx: Context, ventureId: string, plan: SumPlan): Promise<GoalFigureView> {
  if (!plan.addends.length) return { display: planDisplay(plan), receiptId: null };
  const record = await sumReceipt(deps, ctx, ventureId, plan);
  return { display: record.figures[0].display, receiptId: record.id };
}

/**
 * The goal's share in thousandths, floored and kept on the bar (0 to 1000). The amounts stay BigInt; only this small
 * bounded share becomes a JS number, read back from its digits.
 */
function thousandths(part: bigint, goalMinor: bigint): number {
  const share = part <= 0n ? 0n : part * 1000n / goalMinor;
  return parseInt((share > 1000n ? 1000n : share).toString(), 10);
}

/** A part of the goal in whole percent, floored, in BigInt; not capped, so past the goal it passes 100. */
export function wholePercent(part: bigint, goalMinor: bigint): number {
  return part <= 0n ? 0 : parseInt((part * 100n / goalMinor).toString(), 10);
}

/** The view's one plain line. Tax words only for a business registered for tax (simple first). */
function goalLine(month: string, goal: GoalRecord | null, invoicedMinor: bigint, pace: GoalView['pace'], pacePermille: number, registered: boolean): string {
  const words = monthWords(month);
  if (!goal) return `No goal for ${words} yet. Set one to see how the month is going.`;
  const goalMinor = BigInt(goal.amountMinor);
  const percent = invoicedMinor > 0n ? invoicedMinor * 100n / goalMinor : 0n;
  const head = `${percent}% of your ${words} goal invoiced${registered ? ', before tax' : ''}.`;
  if (invoicedMinor > goalMinor) return `Past the goal: ${head}`;
  if (invoicedMinor === goalMinor) return `Goal reached: ${head}`;
  if (pace === null) return head;
  return `${head} Today's pace is ${Math.floor(pacePermille / 10)}%, so you are ${pace}.`;
}

/**
 * The month against its goal, every money figure with its sum receipt (none for an empty sum); today's pace, the next
 * step and the briefing for the current month only. A month from 24 back to 12 ahead of this one on the owner's calendar.
 */
export async function goalView(deps: VentureDeps, ctx: Context, month: string | null): Promise<GoalView> {
  const { state, venture } = readVenture(deps, ctx);
  const currency = venture.country.currency;
  const today = todayLocal(deps.clock, venture.country);
  const current = today.slice(0, 7);
  const chosen = month ?? current;
  const away = monthsBetween(current, chosen);
  check(away >= -MONTHS_BACK && away <= MONTHS_AHEAD, 'INVALID_VENTURE_REQUEST', 'Choose a month from two years back to one year ahead.');
  const goal = goalInUse(state, venture.id, chosen);
  if (goal) requireGoalCurrency(goal, venture);
  const isCurrent = chosen === current;
  // Today's pace: the days gone out of the month's days, today counted as gone. A month over is all gone; a later one, none.
  const days = daysInMonth(chosen);
  const elapsed = elapsedOn(chosen, today);
  const pacePermille = Math.floor((elapsed * 1000) / days);

  const issuedPlan = invoicedPlan(state, venture, { type: 'invoiced', month: chosen, which: 'issued' });
  const readyPlan = invoicedPlan(state, venture, { type: 'invoiced', month: chosen, which: 'ready' });
  const period = calendarMonth(chosen);
  const invoiced = await figureFor(deps, ctx, venture.id, issuedPlan);
  const ready = await figureFor(deps, ctx, venture.id, readyPlan);
  const received = await figureFor(deps, ctx, venture.id, receivedPlan(state, venture, period.from, period.to));
  const invoicedMinor = planTotal(issuedPlan), readyMinor = planTotal(readyPlan);

  let goalFigure: MoneyFigureView | null = null, stillToInvoice: MoneyFigureView | null = null, lastMonth: GoalFigureView | null = null;
  let invoicedPermille: number | null = null, readyPermille: number | null = null, pace: GoalView['pace'] = null, paceReceiptId: string | null = null;
  let invoicedPercent: number | null = null, pastBy: MoneyFigureView | null = null, paceBy: MoneyFigureView | null = null;
  if (goal) {
    const goalMinor = BigInt(goal.amountMinor);
    // Still to invoice, or past the goal by: never empty, the goal in use is always one of its lines.
    const steps = await sumReceipt(deps, ctx, venture.id, goalPlan(state, venture, { type: 'goal', month: chosen, goalId: goal.id, day: null }));
    goalFigure = { display: formatMinor(goalMinor, currency), receiptId: steps.id };
    stillToInvoice = invoicedMinor < goalMinor ? { display: steps.figures[0].display, receiptId: steps.id } : null;
    // 4I2: past the goal, the same receipt says by how much ("Past the goal by").
    pastBy = invoicedMinor > goalMinor ? { display: steps.figures[0].display, receiptId: steps.id } : null;
    invoicedPercent = wholePercent(invoicedMinor, goalMinor);
    invoicedPermille = thousandths(invoicedMinor, goalMinor);
    readyPermille = Math.min(1000 - invoicedPermille, thousandths(readyMinor, goalMinor));
    if (isCurrent) {
      // Today's pace has its own receipt, a new one each day: "day 23 of 31", ahead or behind by how much.
      const paceSteps = await sumReceipt(deps, ctx, venture.id, goalPlan(state, venture, { type: 'goal', month: chosen, goalId: goal.id, day: today }));
      pace = aheadOfPace(invoicedMinor, goalMinor, elapsed, days) ? 'ahead' : 'behind';
      paceReceiptId = paceSteps.id;
      paceBy = { display: paceSteps.figures[0].display, receiptId: paceSteps.id };
    }
  } else {
    lastMonth = await figureFor(deps, ctx, venture.id, invoicedPlan(state, venture, { type: 'invoiced', month: previousMonth(chosen), which: 'issued' }));
  }

  let ahead: Pick<GoalView, 'next' | 'briefing'> = { next: null, briefing: null };
  if (isCurrent) {
    const rows = (await queueListHandler(deps, ctx, {})).rows;
    const progress = goal ? { month: chosen, goalMinor: BigInt(goal.amountMinor), invoicedMinor } : null;
    ahead = nextBestStep(deps.store.read(), venture, rows, progress, { inApp: isAppChannel(ctx) });
  }
  return {
    month: chosen, state: goal ? 'set' : 'unset', goal: goalFigure, invoiced, ready, stillToInvoice, receivedSoFar: received,
    invoicedPermille, readyPermille, pacePermille, pace, paceReceiptId,
    invoicedPercent, pacePercent: Math.floor(pacePermille / 10), past: pastBy !== null, pastBy, paceBy,
    elapsedDays: elapsed, monthDays: days, daysLeft: days - elapsed, lastDay: isCurrent && elapsed === days, lastMonth,
    line: goalLine(chosen, goal, invoicedMinor, pace, pacePermille, taxRegistered(state, venture)), ...ahead,
  };
}

/** venture.goals.get { month? } (level read): this month on the owner's calendar unless a month is named. */
export async function getGoal(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoalView> {
  const body = exactPayload(payload, ['month']);
  return goalView(deps, ctx, body.month === undefined ? null : monthText(body.month));
}

/**
 * venture.goals.set { month, amount | amountMinor } (level approve, app only): the goal typed by the owner (`amount`, read
 * in the business's currency) or in minor units; this month or up to a year ahead; the newest goal
 * is the one in use. Today's goal card reads again (queue.changed in the same commit).
 */
export async function setGoal(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoalView> {
  requireAppChannel(ctx, 'venture.goals.set');
  const body = exactPayload(payload, ['month', 'amountMinor', 'amount'], ['month']);
  check((body.amount === undefined) !== (body.amountMinor === undefined), 'INVALID_VENTURE_REQUEST', 'Send the goal as amount (typed) or amountMinor, not both.');
  const month = monthText(body.month);
  const exact = body.amountMinor === undefined ? null : goalAmount(body.amountMinor);
  await ventureAction(deps, ctx, 'approve', 'goals.set', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    // 4I2: the owner's typed amount ("1,50,000.50"), read in the business's currency in BigInt, as payments read theirs.
    const amountMinor = exact ?? typedGoal(body.amount, venture.country.currency);
    monthToPlan(month, localDayAt(tx.now, venture.country));
    tx.put<GoalRecord>({ ...tx.base('venture-goal'), month, amountMinor, currency: venture.country.currency, by: 'owner' });
    tx.emit('queue.changed', {});
  });
  return goalView(deps, ctx, month);
}

type PricedOffer = { name: string; per: string; price: string };

/** The plan's offers that have a price, as plain text in whole units: the only thing the suggestion reads. */
function pricedOffers(state: State, venture: VentureRecord): PricedOffer[] {
  const blueprints = listRecords(state, 'venture-blueprint', venture.id);
  const plan: BlueprintRecord | null = blueprints.find(item => item.id === venture.acceptedBlueprintId) ?? latestBlueprint(blueprints);
  if (!plan) return [];
  const currency = venture.country.currency;
  return plan.offers.filter(offer => offer.pricing.unitPriceMinor !== null).map(offer => ({
    name: offer.name.value, per: offer.pricing.quantityUnit,
    price: formatMinor(offer.pricing.unitPriceMinor as string, currency).slice(currency.length + 1).replace(/,/g, ''),
  }));
}

/** Local authority over the suggestion: a whole amount in digits only, at most 15 digits once in minor units. */
export function validateSuggestion(raw: unknown, currency: string): string {
  const body = exactPayload(raw, ['amount'], ['amount'], REJECTED);
  check(typeof body.amount === 'string' && /^[1-9]\d{0,14}$/.test(body.amount), REJECTED, 'The amount was not a whole number above zero in digits.');
  const minor = (BigInt(body.amount) * 10n ** BigInt(currencyMinorDigits(currency))).toString();
  check(GOAL_AMOUNT.test(minor), REJECTED, 'The amount was too large for a goal.');
  return minor;
}

function suggestTask(month: string, currency: string, offers: PricedOffer[]): ModelTask<string> {
  return {
    purpose: 'goal-suggest',
    instructions: [
      'chausar-goal-suggest-v1.',
      'Suggest one monthly goal for a small business: the money it could invoice in the given month, before tax.',
      'Read only the listed offers and their prices.',
      'Answer with a whole amount in the given currency, in digits only: no currency sign, commas, decimals or words.',
    ].join(' '),
    input: { month: monthWords(month), currency, offers: offers as unknown as Json },
    schemaName: 'venture-goal-suggest',
    schema: {
      type: 'object', additionalProperties: false, required: ['amount'],
      properties: { amount: { type: 'string', description: 'A whole amount in the given currency, digits only, such as 150000.' } },
    },
    validate: raw => validateSuggestion(raw, currency),
    containsClientData: false,
    maxOutputTokens: 256,
  };
}

/**
 * venture.goals.suggest { month } (level prepare): a goal figure from the owner's own AI, a model estimate. Null, and
 * nothing sent, with no priced offer, no AI connected or an AI that cannot be used now; null too for a template's answer
 * or one Chausar's checks refused. Nothing is stored as a goal.
 */
export async function suggestGoal(deps: VentureDeps, ctx: Context, payload: unknown): Promise<GoalSuggestion | null> {
  const body = exactPayload(payload, ['month'], ['month']);
  const month = monthText(body.month);
  authorize(deps.store, ctx, 'prepare');
  const { state, venture } = readVenture(deps, ctx);
  monthToPlan(month, todayLocal(deps.clock, venture.country));
  const offers = pricedOffers(state, venture);
  if (!offers.length) return null;
  const tier = deps.models.status(ctx).tiers[PURPOSE_TIER['goal-suggest']];
  if (tier.presetId === 'built-in-templates' || tier.usable === false) return null;
  const currency = venture.country.currency;
  let amountMinor: string;
  try {
    const outcome = await deps.models.generate(ctx, suggestTask(month, currency, offers));
    if (outcome.by !== 'model') return null;
    amountMinor = outcome.value;
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === 'NO_MODEL_CONNECTED' || code === REJECTED) return null;
    throw error;
  }
  // typed: the amount without the currency code or grouping, as the goal field takes it back ("150000.00").
  const typed = formatMinor(amountMinor, currency).slice(currency.length + 1).replace(/,/g, '');
  return { amountMinor, display: formatMinor(amountMinor, currency), estimate: true, line: SUGGEST_LINE, typed };
}
