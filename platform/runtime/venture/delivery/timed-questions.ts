// Chausar venture launcher, delivery (Ink v2 wave 4, package 4J13; catalogue A13): timed questions. A run's question
// to the owner stays answerable for a fixed time, 24 hours unless the playbook's question step says otherwise, and
// carries that time as expiresAt (Today's row meta shows it, views/row-meta.ts). When it passes unanswered, Chausar
// closes the question with its own line, declines any call the question held (fail closed: an approval nobody gave is
// a no), stops the run there and records the decision as a timeout, never as the owner's refusal. The run waits for the
// owner to go on (Resume, whose next turn reads the line and whose question gets a fresh window) or leave it stopped.
// Other runs go on meanwhile. A NEEDS_FACTS hand-off (4J16) never expires: expiresAt null. Code only.
import { ChausarError, type Context } from '../../contracts.ts';
import { currentVenture, formatVentureDate, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, HandoffRequest, HarnessState, IsoTime, PlaybookRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { localTimeAt } from '../local-day.ts';
import { expireHandoff } from './harness/loop.ts';
import { recordDecision } from '../journal/decisions.ts';

/** How long a question stays answerable when the playbook says nothing else. */
export const QUESTION_HOURS = 24;
const HOUR_MS = 3_600_000;
/** The shortest and longest window a playbook may give a question. */
const MIN_WINDOW_MS = 15 * 60_000;
const MAX_WINDOW_MS = 14 * 24 * HOUR_MS;

/** How long this playbook's questions stay answerable: its question step's timeoutMs, else 24 hours. */
export function questionWindowMs(playbook?: Pick<PlaybookRecord, 'steps'> | null): number {
  const step = playbook?.steps.find(item => item.kind === 'question' && typeof item.timeoutMs === 'number' && Number.isFinite(item.timeoutMs));
  return step ? Math.min(Math.max(step.timeoutMs!, MIN_WINDOW_MS), MAX_WINDOW_MS) : QUESTION_HOURS * HOUR_MS;
}

/**
 * Gives each open question that has no expiry yet (expiresAt absent) its expiry: asked now, answerable for windowMs. The
 * one source of truth for a question that never expires is expiresAt null, set where the question is made (a NEEDS_FACTS
 * hand-off, delivery/harness/loop.ts, 4J16): it keeps it, as one that has a time keeps that. Returns the state it is
 * given when nothing changes.
 */
export function withQuestionExpiry(state: HarnessState, nowIso: IsoTime, windowMs: number): HarnessState {
  if (!state.handoffs.some(handoff => handoff.answer === null && handoff.expiresAt === undefined)) return state;
  const expiresAt = new Date(Date.parse(nowIso) + windowMs).toISOString();
  return { ...state, handoffs: state.handoffs.map(handoff => (handoff.answer === null && handoff.expiresAt === undefined ? { ...handoff, expiresAt } : handoff)) };
}

/** The open question with a fresh window from now (Resume back to a question, run-controls.ts); one that never expires stays so. */
export function renewQuestionExpiry(state: HarnessState, nowIso: IsoTime, windowMs: number): HarnessState {
  const index = state.handoffs.findLastIndex(handoff => handoff.answer === null);
  if (index < 0 || state.handoffs[index].expiresAt === null) return state;
  const expiresAt = new Date(Date.parse(nowIso) + windowMs).toISOString();
  return { ...state, handoffs: state.handoffs.map((handoff, at) => (at === index ? { ...handoff, expiresAt } : handoff)) };
}

/** The open question when it ran out unanswered by nowMs, else null. One with expiresAt null never runs out. */
export function expiredQuestion(state: Pick<HarnessState, 'handoffs' | 'phase'> | null | undefined, nowMs: number): HandoffRequest | null {
  if (!state || state.phase !== 'needs-answer') return null;
  const open = state.handoffs.findLast(handoff => handoff.answer === null);
  return open?.expiresAt && Date.parse(open.expiresAt) <= nowMs ? open : null;
}

/** A moment as the owner reads it: their calendar day in their date order and the time on their clock ('17 Oct 2026, 15:30'). */
export function ownerMoment(iso: IsoTime, venture: Pick<VentureRecord, 'country'>): string {
  const country = venture.country ?? { code: 'XX', dateOrder: 'year-month-day' as const };
  const local = localTimeAt(iso, country);
  return `${formatVentureDate(local.slice(0, 10), country.dateOrder ?? 'year-month-day')}, ${local.slice(11, 16)}`;
}

/** The line the run and its next turn read once its question ran out. */
export function noAnswerLine(expiresAt: IsoTime, venture: Pick<VentureRecord, 'country'>): string {
  return `No answer by ${ownerMoment(expiresAt, venture)}. Go on without it, or stop.`;
}

/** Refuses an answer to a question that already ran out, so a late approval never lets a held call run. */
export function refuseExpiredQuestion(state: HarnessState | null | undefined, nowMs: number, venture: Pick<VentureRecord, 'country'>): void {
  const open = expiredQuestion(state, nowMs);
  if (open) throw new ChausarError('DELIVERY_NOT_ASKING', `${noAnswerLine(open.expiresAt!, venture)} The question can no longer be answered; resume the run to go on.`);
}

/**
 * The question ran out on this run: closed with Chausar's line, its held call declined, the run stopped with the line
 * so the owner chooses to go on or stop. Inside the caller's transaction; returns the stored run.
 */
function timeOut(tx: VentureTx, run: DeliveryRunRecord, open: HandoffRequest): DeliveryRunRecord {
  const line = noAnswerLine(open.expiresAt!, tx.venture!);
  const moved = expireHandoff(run.harness!, line);
  const harness: HarnessState = {
    ...moved, control: { stop: { at: tx.now, by: 'chausar', force: false }, stoppedAt: tx.now, line },
    ...(moved.gate ? { gate: { ...moved.gate, waiting: null } } : {}),
  };
  const stored = tx.replace<DeliveryRunRecord>({ ...run, status: 'stopped', callId: null, preview: null, harness });
  // The decision record (4J1) lists it as a timeout: nobody answered, so nothing the question asked about ran.
  recordDecision(tx, {
    subject: `run:${run.id}`, action: 'timeout', who: 'timeout', ruleId: null, rowId: null,
    reason: `the question "${open.question.slice(0, 160)}" was not answered, so any call it held was declined and the run stopped.`,
  });
  tx.emit('run.stopped', { runId: run.id });
  tx.emit('run.step', { runId: run.id });
  return stored;
}

/**
 * At a tick (agents/routine-runner.ts): every run of the open business whose question ran out is timed out, one
 * transaction each, so one failure never holds the others. Returns the ids of the runs it stopped. Never throws.
 */
export async function expireQuestions(deps: VentureDeps, ctx: Context): Promise<string[]> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return [];
  const nowMs = deps.clock().getTime();
  const due = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.status === 'needs-answer' && expiredQuestion(run.harness, nowMs));
  const stopped: string[] = [];
  for (const run of due) {
    const done = await ventureAction(deps, ctx, 'prepare', 'question.timeout', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      const open = current?.status === 'needs-answer' ? expiredQuestion(current.harness, Date.parse(tx.now)) : null;
      if (!current || !open) return false;
      timeOut(tx, current, open);
      return true;
    }).catch(() => false);
    if (done) stopped.push(run.id);
  }
  return stopped;
}
