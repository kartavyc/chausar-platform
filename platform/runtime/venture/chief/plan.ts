// Chausar venture launcher, chief: the standing plan as the engine keeps and shows it. plan-core.ts decides and
// plan-view.ts words; this file reads the facts they work from (the way to earn kept with the business, whether what is
// sold is ready, clients, invoices, payments, the proposals its moves stand for, Today's rows and the month's goal),
// stores the plan as one record per business, and answers venture.chief.plan.get and venture.chief.plan.move.
//
// The plan is read through planNow, never straight from its record: every read runs the records through plan-core's
// sync, so the plan always follows the records, with no model call. Events move it too, not only the clock: the
// venture's one write path (records.ts ventureAction) calls keepPlan in the same commit as any write the plan is read
// from, so a plan accepted, an offer priced, a proposal approved or set aside, a client added, an invoice issued or a
// payment recorded is in the stored plan at once. Each of those already tells the screens to read again.
import { type Context, type State, check } from '../../contracts.ts';
import type {
  ChatConsentView, ChiefPlanRecord, ChiefPlanView, ChiefReviewView, IsoDate, ModelPresetId, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt, ventureTimeZone } from '../local-day.ts';
import { ownerProfileOf } from '../core/owner.ts';
import { offerReadiness } from '../core/way-ready.ts';
import { readAs } from '../delivery/shared.ts';
import { chatConsentState, chatRoute } from '../agents/consent.ts';
import { pauseSkipLine } from '../delivery/run-guards.ts';
import { dailyReviewOf, nextOccurrence } from '../agents/routines.ts';
import { computerZone } from '../../owner-format.ts';
import { goalView } from '../money/goals.ts';
import { lateOf } from '../money/aging.ts';
import { queueListHandler, queueRowsWithSubjects } from '../views/queue.ts';
import type { ChiefClientContext } from './client-context.ts';
import { proposalRowId, proposalStanding } from './gate.ts';
import { ownUseOf, ownUsedOn, ownUseView } from './own-use.ts';
import {
  codeLine, nextStepOf, ownerMove, seedPlan, syncPlan, type PlanFacts, type PlanMove, type ProposalState, type StandingPlan,
} from './plan-core.ts';
import { DAILY_REVIEW_TIME, REVIEW_OFFER_SUBJECT, REVIEW_OFFER_TITLE, REVIEW_WORDS, SETUP_KIND, STEP_WORDS, moveView, reviewOfferLine, reviewWhen, stepView } from './plan-view.ts';
import { openCard, openCardWords, outsideWords } from './tools.ts';

// ---------------------------------------------------------------------------
// The facts, and the plan as it stands now
// ---------------------------------------------------------------------------

/** What plan-core decides from, read from the records as they are. moves: the stored moves, for the proposals they stand for. */
export function planFacts(state: State, venture: VentureRecord, today: IsoDate, moves: readonly PlanMove[] = []): PlanFacts {
  const readiness = offerReadiness(state, venture);
  const accepted = venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
  const linked = new Set(moves.flatMap(move => (move.proposalId ? [move.proposalId] : [])));
  const proposals: Record<string, ProposalState> = {};
  if (linked.size) for (const record of listRecords(state, 'venture-proposal', venture.id)) if (linked.has(record.id)) proposals[record.id] = proposalStanding(state, record);
  return {
    today, accepted: !!accepted && accepted.ventureId === venture.id && accepted.status === 'accepted', ready: readiness.ready, missing: readiness.missing,
    clients: listRecords(state, 'venture-client', venture.id).length,
    invoicesIssued: listRecords(state, 'venture-invoice', venture.id).filter(invoice => invoice.status === 'issued' || invoice.status === 'part-paid' || invoice.status === 'paid').length,
    payments: listRecords(state, 'venture-payment', venture.id).length,
    firstWeek: ownerProfileOf(state, venture.id).way?.firstWeek ?? [],
    proposals,
  };
}

/** The business's stored plan, or null when none was stored yet. */
export function storedPlan(state: State, ventureId: string): ChiefPlanRecord | null {
  return listRecords(state, 'venture-chief-plan', ventureId).at(-1) ?? null;
}

/**
 * The plan as it stands at an instant: the stored one (or this week's from the records alone when none is stored) run
 * through the records by plan-core's sync. Every reader and writer of the plan starts here. changed: it differs from
 * what is stored.
 */
export function planNow(state: State, venture: VentureRecord, at: Date | string): { record: ChiefPlanRecord | null; plan: StandingPlan; facts: PlanFacts; today: IsoDate; changed: boolean } {
  const now = typeof at === 'string' ? at : at.toISOString();
  const today = localDayAt(now, venture.country);
  const record = storedPlan(state, venture.id);
  const facts = planFacts(state, venture, today, record?.moves ?? []);
  const stored = record ? { weekOf: record.weekOf, moves: record.moves, past: record.past } : null;
  const plan = stored ? syncPlan(stored, facts, now) : seedPlan(facts, now);
  return { record, plan, facts, today, changed: plan !== stored };
}

/** Stores the plan inside the caller's transaction: the one record of the business, made or replaced. */
export function savePlan(tx: VentureTx, plan: StandingPlan, record: ChiefPlanRecord | null, patch: Partial<Pick<ChiefPlanRecord, 'line' | 'reviewed' | 'ownUse'>> = {}): ChiefPlanRecord {
  const today = localDayAt(tx.now, tx.venture!.country);
  const kept = { line: record?.line ?? null, reviewed: record?.reviewed ?? null, ownUse: record?.ownUse ?? { day: today, runs: 0, micros: '0' }, ...patch };
  const next = { weekOf: plan.weekOf, moves: plan.moves.map(move => ({ ...move })), past: [...plan.past], ...kept };
  return record ? tx.replace<ChiefPlanRecord>({ ...record, ...next }) : tx.put<ChiefPlanRecord>({ ...tx.base('venture-chief-plan'), ...next });
}

/**
 * Keeps the stored plan in step with a write it is read from (a kind in plan-core's PLAN_KINDS), inside that write's
 * own commit (records.ts ventureAction). Code only: no model is asked and no event is added. It never fails the commit it rides on: if the
 * plan cannot be worked out from records as they stand mid-write, the next read works it out instead.
 */
export function keepPlan(tx: VentureTx): void {
  if (!tx.venture) return;
  try {
    const current = planNow(tx.state, tx.venture, tx.now);
    if (current.changed) savePlan(tx, current.plan, current.record);
  } catch {
    // The write this rode on stands; planNow gives the plan again on the next read.
  }
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The most overdue open invoice on a day, or none. */
function mostOverdue(state: State, venture: VentureRecord, today: IsoDate): { invoiceId: string; number: string; days: number } | null {
  let worst: { invoiceId: string; number: string; days: number } | null = null;
  for (const invoice of listRecords(state, 'venture-invoice', venture.id)) {
    const late = lateOf(invoice, today);
    if (late && (!worst || late.days > worst.days)) worst = { invoiceId: invoice.id, number: invoice.number as string, days: late.days };
  }
  return worst;
}

/** Where this computer is, for words that say a place only when it differs; null on the hosted app, whose server is elsewhere. */
export function zoneHere(deps: Pick<VentureDeps, 'host'>): string | null {
  return deps.host === 'hosted-web' ? null : computerZone();
}

/** The AI a chat would go to now, or null: with templates only, or when the models cannot say. */
export function chatPreset(deps: VentureDeps, ctx: Context): ModelPresetId | null {
  try { return chatRoute(deps.models.status(ctx))?.presetId ?? null; } catch { return null; }
}

/**
 * Whether the daily review is still to be offered: the business never had one, and the owner has not answered the
 * offer (their answer, yes or not now, is a decision recorded under the offer's subject).
 */
export function reviewOffered(state: State, ventureId: string): boolean {
  if (listRecords(state, 'venture-routine', ventureId).some(routine => routine.review === 'daily')) return false;
  return !listRecords(state, 'venture-decision', ventureId).some(item => item.subject === REVIEW_OFFER_SUBJECT);
}

/** The chat consent while an AI is connected and the consent does not hold (needed, or stale after the AI changed); else null. */
export function missingChatConsent(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord): ChatConsentView | null {
  try {
    const { view, route } = chatConsentState(deps, ctx, state, venture);
    return route && (view.state === 'needed' || view.state === 'stale') ? view : null;
  } catch { return null; }
}

/**
 * The daily review as the owner reads it: on or off, when it runs, what its last run said, and Chausar's own AI
 * allowance. offer: while it is still to be offered, the card that asks for the owner's one approval, filled in already.
 * ready: what is sold is ready (planFacts), so a review would ask the owner's AI.
 * consent and the line that asks for it show only while they are true: never while the review is off (the offer aside,
 * which carries the consent so one press agrees and turns it on), and never once the consent is given.
 */
export function reviewView(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, record: ChiefPlanRecord | null, today: IsoDate, nowMs: number, ready = false): ChiefReviewView {
  const routine = dailyReviewOf(state, venture.id);
  const schedule = routine?.schedule.kind === 'calendar' ? routine.schedule : null;
  const time = schedule?.time ?? DAILY_REVIEW_TIME;
  const timeZone = schedule?.timeZone ?? ventureTimeZone(venture.country);
  const on = routine?.on === true;
  const preset = chatPreset(deps, ctx);
  const offered = reviewOffered(state, venture.id);
  const missing = missingChatConsent(deps, ctx, state, venture);
  // The review is on and would ask the owner's AI now, but for the consent (review.ts aiGate holds the same order).
  const asks = on && ready && !pauseSkipLine(state);
  const todayNote = record?.reviewed && localDayAt(record.reviewed.at, venture.country) === today ? record.reviewed.note : null;
  return {
    on, routineId: routine?.id ?? null, time, timeZone,
    offer: offered ? { title: REVIEW_OFFER_TITLE, line: reviewOfferLine(time, ownUseOf(venture).runsPerDay, preset !== null) } : null,
    when: reviewWhen(time, timeZone, zoneHere(deps)),
    next: routine && on ? nextOccurrence(routine.schedule, nowMs) : null,
    last: record?.reviewed ? { at: record.reviewed.at, line: record.reviewed.line, by: record.reviewed.by } : null,
    // A note is about a review that is on: switched off, nothing "looks again tomorrow".
    note: !on ? null : missing && asks ? REVIEW_WORDS.consent : todayNote,
    consent: missing && (offered || asks) ? missing : null,
    ownUse: ownUseView(venture, ownUsedOn(record, today), preset),
    line: REVIEW_WORDS.line(on, time),
  };
}

/**
 * The standing plan for the open business: the goal, the chief's line for today, exactly one next best step with its
 * one primary action, this week's moves with their states, and the daily review. Today's rows are read once and shared
 * with the goal (money/goals.ts), which ranks the waiting row the step may be.
 */
export async function planView(deps: VentureDeps, ctx: Context): Promise<ChiefPlanView> {
  const rows = (await queueListHandler(deps, ctx, {})).rows;
  const goal = await goalView(deps, ctx, null, { rows });
  const { state, venture } = readVenture(deps, ctx);
  const now = deps.clock();
  const { record, plan, facts, today } = planNow(state, venture, now);
  const review = reviewView(deps, ctx, state, venture, record, today, now.getTime(), facts.ready);
  // The queue names a setup card only when no other row waits (money/next-step.ts); the step ranks it last (plan-core.ts).
  const rankedKind = goal.next ? rows.find(row => row.id === goal.next!.rowId)?.kind : undefined;
  const ranked = goal.next ? { rowId: goal.next.rowId, title: goal.next.title, setup: rankedKind === SETUP_KIND, notice: rankedKind === 'notice' } : null;
  const core = nextStepOf({
    facts, row: ranked, planRowId: rows.find(row => row.kind === 'plan')?.id ?? null,
    overdue: mostOverdue(state, venture, today), moves: plan.moves,
  });
  const said = record?.line && record.line.day === today ? record.line : null;
  // A move that stands for a card reads as the card's own title, taken from the proposal as it is now: the plan keeps
  // no copy of it (a title can name a client, and Forget must leave nothing behind in the plan).
  const shown = (move: PlanMove) => {
    const proposal = move.proposalId ? findRecord(state, 'venture-proposal', move.proposalId) : undefined;
    const rowId = proposal && move.state === 'proposed' && proposal.status === 'raised' ? proposalRowId(state, venture, proposal) : null;
    return moveView(proposal && proposal.ventureId === venture.id ? { ...move, text: proposal.title } : move, rowId);
  };
  return {
    weekOf: plan.weekOf,
    goal: { month: goal.month, state: goal.state, line: goal.line, percent: goal.invoicedPercent, figure: goal.goal },
    line: said ? { text: said.text, estimate: said.estimate, by: said.by } : { text: codeLine(facts, plan.moves), estimate: false, by: 'records' },
    // The ranked row's own words (its line, agent and figure) belong to the step only when the step is that row.
    next: stepView(core, { rows, ranked: core.kind === 'row' && goal.next?.rowId === core.rowId ? goal.next : null, moves: plan.moves, reviewOn: review.on }),
    moves: plan.moves.map(shown),
    review,
  };
}

// ---------------------------------------------------------------------------
// The plan as the owner's AI is given it
// ---------------------------------------------------------------------------

/**
 * What stands in for a card or a move the AI may not be told about. move: also the words the plan itself keeps for a
 * move that stands for a card (review.ts), since the card's own title is read from its proposal each time.
 */
export const AI_PLAN_WORDS = Object.freeze({ card: 'A card waits on Today for your decision.', move: 'A card Chausar put on Today.' });

/** The subjects of rows that hold no client's records: the setup rows and the plan's own card. */
const OWN_SUBJECT = /^(?:setup:|connector:github$|plan:)/;

/**
 * A move's words as an AI may read them. A move that stands for a proposal card is named by what it is, never by the
 * card's title, which can hold a client's name, unless the card is one whose title cannot (card: tools.ts openCardWords); every
 * other move is the owner's or the chief's own plain words, kept only when they name no client and no person in the
 * pipeline (review.ts).
 */
export const moveForAi = (move: Pick<PlanMove, 'text' | 'proposalId'>, card?: (proposalId: string) => string | null): string =>
  (move.proposalId ? card?.(move.proposalId) ?? AI_PLAN_WORDS.move : move.text);

/** also: the housekeeping cards that also wait on Today, as one line; left out when none waits. */
export type ChatPlan = { today: string; next: { step: string; why: string | null }; week: { move: string; state: string }[]; goal: string; also?: string };

/**
 * The plan as the chief's chat is given it, so "what should I do next?" is answered from the plan Today shows. A step
 * that is a card on Today names the card only as far as the chat may read it: a card about a client goes by the same
 * rule as the queue tool (the client's AI permission, then the untrusted screen), and is otherwise said without its title.
 */
export async function chatPlan(deps: VentureDeps, ctx: Context, scope: ChiefClientContext): Promise<ChatPlan> {
  const view = await planView(deps, ctx);
  const { state, venture } = readVenture(deps, ctx);
  let step = view.next.title;
  const rowId = view.next.action?.id === 'row' ? view.next.action.rowId : null;
  if (view.next.kind === 'row' && rowId) {
    const found = (await queueRowsWithSubjects(deps, ctx)).find(item => item.row.id === rowId);
    const allowed = !!found && (OWN_SUBJECT.test(found.subject) || openCard(state, venture, found.subject) || scope.subject(found.subject) || (!!found.row.viewRef && scope.record(found.row.viewRef.id)));
    step = (allowed ? outsideWords(state, venture, view.next.title) : null) ?? AI_PLAN_WORDS.card;
  }
  const { plan } = planNow(state, venture, deps.clock());
  const stored = new Map(plan.moves.map(move => [move.id, move]));
  return {
    today: view.line.text, next: { step, why: view.next.line },
    week: view.moves.map(move => ({ move: moveForAi(stored.get(move.id) ?? { text: move.text }, id => openCardWords(state, venture, id)), state: move.label })), goal: view.goal.line,
    // Setup cards hold no client's records: their titles are Chausar's own words.
    ...(view.next.also ? { also: view.next.also.line } : {}),
  };
}

// ---------------------------------------------------------------------------
// venture.chief.plan.get and venture.chief.plan.move
// ---------------------------------------------------------------------------

/** venture.chief.plan.get {} (read): the standing plan of the open business. */
export async function planGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefPlanView> {
  exactPayload(payload, []);
  return planView(deps, ctx);
}

const MOVE_TO: readonly string[] = ['done', 'dropped', 'planned'];

/**
 * venture.chief.plan.move { id, to } (prepare, app only): the owner says a move is done, drops it, or plans it again.
 * A move the records check themselves, and a change its state does not take (plan-core's table), is refused.
 */
export async function planMoveHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefPlanView> {
  requireAppChannel(ctx, 'venture.chief.plan.move');
  const body = exactPayload(payload, ['id', 'to'], ['id', 'to']);
  const id = identifier(body.id, 'Move');
  check(typeof body.to === 'string' && MOVE_TO.includes(body.to), 'INVALID_VENTURE_REQUEST', STEP_WORDS.moveTo);
  const to = body.to as 'done' | 'dropped' | 'planned';
  readAs(deps, ctx, 'prepare');
  await ventureAction(deps, ctx, 'prepare', 'chief.plan.move', tx => {
    const current = planNow(tx.state, tx.venture!, tx.now);
    const moved = ownerMove(current.plan, id, to, current.facts, tx.now);
    check(moved, 'INVALID_VENTURE_REQUEST', STEP_WORDS.moveRefused);
    savePlan(tx, moved, current.record);
    tx.emit('queue.changed', {});
  });
  return planView(deps, ctx);
}
