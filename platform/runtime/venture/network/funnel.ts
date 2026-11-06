// Chausar venture launcher, network (Ink v2 wave 4, package 4E1): the pipeline's counted figures, each a sum receipt
// money/sums.ts serves (subject { type: 'count', what: 'funnel', scope, from, to }), so every number on the board opens
// the cards it counts. Scopes: a stage ("How people moved": each card that reached it between the days, and whether it
// moved on); 'due' (next steps due by the last day, read as of the first); 'drafts' (drafts waiting to be sent); 'moved'
// (moves forward between the days); 'forecast' (money, not a count: each open quote times the share of closed cards
// won from its stage, from the same history; labelled a forecast, every amount an estimate). Counted from the cards'
// own records in code; no model number anywhere. Addend labels never name a person ("A card reached Asked on ..."):
// the record ids say which card, and Forget removes any receipt that counted one of theirs.
import type { State } from '../../contracts.ts';
import { PIPELINE_STAGES } from '../contracts.ts';
import type { IsoDate, PipelineStage, SumReceiptSubject, VentureRecord } from '../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { formatVentureDate, listRecords } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import type { Addend, SumPlan } from '../money/sums.ts';
import { receiptFigure } from '../money/quote.ts';
import { CHANNEL_WORDS, CLOSED_STAGES, DRAFT_WORDS, STAGE_LABEL, STAGE_RANK, cardsOf, nextStepOf, unsentDrafts, type Card } from './pipeline.ts';
import { count } from './text.ts';

type CountSubject = Extract<SumReceiptSubject, { type: 'count' }>;
/** A forecast needs at least this many cards closed in its window. */
export const FORECAST_MIN_CLOSED = 10;
/** The window of "How people moved" and the forecast, in days, today included. */
export const HISTORY_DAYS = 90;

const countPlan = (subject: CountSubject, addends: Addend[], words: SumPlan['words']): SumPlan => ({ subject, currency: 'count', unit: 'count', addends, words });
const one = (recordId: string, label: string): Addend => ({ recordId, label, amount: '1', display: '1', estimate: false });

/** The day a move happened on, on the owner's calendar. */
const moveDay = (venture: VentureRecord, at: string) => localDayAt(at, venture.country);
/** Whether a stage counts as moving on from another: a later open stage, or Won. */
const movesOn = (from: PipelineStage, to: PipelineStage) => STAGE_RANK[to] > STAGE_RANK[from] && to !== 'lost' && to !== 'not-now';

/** The first move into a stage within the days, or null. */
function reachedIn(card: Card, stage: PipelineStage, venture: VentureRecord, from: IsoDate, to: IsoDate): { index: number; day: IsoDate } | null {
  for (let index = 0; index < card.history.length; index += 1) {
    const move = card.history[index];
    if (move.to !== stage) continue;
    const day = moveDay(venture, move.at);
    if (day >= from && day <= to) return { index, day };
  }
  return null;
}

/** Whether a card that reached a stage moved on from it, and the words for what came after. */
function after(card: Card, stage: PipelineStage, index: number): { movedOn: boolean; words: string } {
  const later = card.history.slice(index + 1).find(move => STAGE_RANK[move.to] > STAGE_RANK[stage] || CLOSED_STAGES.has(move.to));
  if (!later) return { movedOn: false, words: CLOSED_STAGES.has(stage) ? '' : ', and is still there' };
  return movesOn(stage, later.to) ? { movedOn: true, words: `, then moved on to ${STAGE_LABEL[later.to]}` } : { movedOn: false, words: `, then ${STAGE_LABEL[later.to]}` };
}

/** How people moved through one stage between two days: who reached it, and how many moved on. */
export function stageFunnel(cards: readonly Card[], venture: VentureRecord, stage: PipelineStage, from: IsoDate, to: IsoDate): { addends: Addend[]; reached: number; movedOn: number } {
  const addends: Addend[] = [];
  let movedOn = 0;
  for (const card of cards) {
    const reached = reachedIn(card, stage, venture, from, to);
    if (!reached) continue;
    const next = after(card, stage, reached.index);
    if (next.movedOn) movedOn += 1;
    addends.push(one(card.id, `A card reached ${STAGE_LABEL[stage]} on ${formatVentureDate(reached.day, venture.country.dateOrder)}${next.words}`));
  }
  return { addends, reached: addends.length, movedOn };
}

/** The closed cards of a window: closed by a move within the days. */
export function closedIn(cards: readonly Card[], venture: VentureRecord, from: IsoDate, to: IsoDate): Card[] {
  return cards.filter(card => CLOSED_STAGES.has(card.stage)
    && card.history.some(move => CLOSED_STAGES.has(move.to) && moveDay(venture, move.at) >= from && moveDay(venture, move.at) <= to));
}

/** The share of closed cards won among those that reached a stage, in permille; null when none closed from it. */
export function winShare(closed: readonly Card[], stage: PipelineStage): number | null {
  const reached = closed.filter(card => card.history.some(move => move.to === stage));
  if (!reached.length) return null;
  return Math.floor((reached.filter(card => card.stage === 'won').length * 1000) / reached.length);
}

/** The amount before tax of the quote an open card's move to Proposal rests on, if its receipt is still here. */
function quoteOf(state: State, venture: VentureRecord, card: Card) {
  const evidence = [...card.history].reverse().find(move => move.evidence.kind === 'quote' && move.evidence.id)?.evidence;
  if (!evidence) return null;
  const receipt = listRecords(state, 'venture-price-receipt', venture.id).find(item => item.id === evidence.id);
  if (!receipt || receipt.currency !== venture.country.currency) return null;
  return receiptFigure(receipt, 'taxable') ?? receiptFigure(receipt, 'total');
}

/** The forecast's plan: each open card with a quote, its amount before tax times the share won from its stage. */
function forecastPlan(state: State, venture: VentureRecord, subject: CountSubject, cards: readonly Card[]): SumPlan {
  const closed = closedIn(cards, venture, subject.from, subject.to);
  const addends: Addend[] = [];
  for (const card of cards) {
    if (CLOSED_STAGES.has(card.stage)) continue;
    const quote = quoteOf(state, venture, card);
    if (!quote) continue;
    const share = winShare(closed, card.stage) ?? 0;
    const amount = (BigInt(quote.minor) * BigInt(share) + 500n) / 1000n;
    const label = STAGE_LABEL[card.stage];
    addends.push({
      recordId: card.id, amount: String(amount), display: formatMinor(amount, venture.country.currency), estimate: true,
      label: `A card at ${label}: a quote of ${quote.display} before tax, times ${count(share)} in 1,000 won from ${label}`,
    });
  }
  return {
    subject, currency: venture.country.currency, unit: 'minor', addends,
    words: { label: 'Forecast from your last 90 days', one: 'open quote', many: 'open quotes', none: 'No open card has a quote.' },
    estimateWords: 'Each amount is a forecast from your last 90 days, not money anyone owes.',
  };
}

/**
 * The `count` receipt with what 'funnel', by scope: a stage (who reached it between the days, as of the last), 'due'
 * (open cards with a next step due on or before the last day, as of the first), 'drafts' (drafts waiting, as of the
 * last), 'moved' (moves forward between the days) or 'forecast' (money; see forecastPlan).
 */
export function funnelCountPlan(state: State, venture: VentureRecord, subject: CountSubject): SumPlan {
  const scope = subject.scope;
  const cards = cardsOf(state, venture, scope === 'due' ? subject.from : subject.to);
  const order = venture.country.dateOrder;
  if ((PIPELINE_STAGES as readonly string[]).includes(scope)) {
    const stage = scope as PipelineStage;
    const { addends } = stageFunnel(cards, venture, stage, subject.from, subject.to);
    return countPlan(subject, addends, { label: `People who reached ${STAGE_LABEL[stage]}`, one: 'person', many: 'people', none: `Nobody reached ${STAGE_LABEL[stage]} in these days.` });
  }
  if (scope === 'due') {
    const addends = cards.flatMap(card => {
      const next = nextStepOf(card);
      return next && card.stage !== 'not-now' && next.due <= subject.to ? [one(card.id, `A card's next step, due ${formatVentureDate(next.due, order)}`)] : [];
    });
    return countPlan(subject, addends, { label: 'Next steps due', one: 'next step', many: 'next steps', none: 'No next steps are due.' });
  }
  if (scope === 'drafts') {
    const addends = cards.filter(card => !CLOSED_STAGES.has(card.stage)).flatMap(card => unsentDrafts(state, venture, card)
      .map(draft => one(draft.id, `${DRAFT_WORDS[draft.kind]} for ${CHANNEL_WORDS[draft.channel]}`)));
    return countPlan(subject, addends, { label: 'Drafts to send', one: 'draft', many: 'drafts', none: 'No drafts are waiting.' });
  }
  if (scope === 'moved') {
    const addends = cards.flatMap(card => card.history
      .filter(move => move.from !== null && movesOn(move.from, move.to) && moveDay(venture, move.at) >= subject.from && moveDay(venture, move.at) <= subject.to)
      .map(move => one(card.id, `A card moved to ${STAGE_LABEL[move.to]} on ${formatVentureDate(moveDay(venture, move.at), order)}`)));
    return countPlan(subject, addends, { label: 'Moved forward', one: 'move', many: 'moves', none: 'Nothing moved forward in these days.' });
  }
  return forecastPlan(state, venture, subject, cards);
}
