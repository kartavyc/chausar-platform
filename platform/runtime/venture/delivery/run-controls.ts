// Native job controls. Stop interrupts immediately; continuation starts a new source-bound session.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, PauseRecord, PauseView, RunControlResult, RunDetail, VentureDeps, VentureRecord } from '../contracts.ts';
import { optionalFlag, readAs } from './shared.ts';
import { agentStage, deliveryRunHandler, STAGE_BLOCKED_REASON } from './runs.ts';
import { GATE_EVERY, gateWaits, STOPPED_BY_YOU } from './harness/controls.ts';
import { refuseNewWork, STOPPABLE } from './run-guards.ts';
import { redactSecrets, screenReadback } from '../core/secrets.ts';
import { runsGetHandler } from '../views/runs.ts';
import type { W4Decision, W4Outcome } from '../views/queue-w4.ts';
import { refuseUnsignedRun } from '../money/order-contracts.ts';
import { stopAgentJob } from '../agent-runtime/lifecycle.ts';
import { canResumeAgentJob } from '../agent-runtime/native-job.ts';

export { awaySkipLine, PAUSED_BY_YOU, pauseSkipLine, pausedNow } from './run-guards.ts';

const NOT_RUNNING = 'This run is not running, so there is nothing to stop or steer.';
const STALE = 'This changed since you opened it.';
const MAX_NOTE_CHARS = 500;
/** The owner's words for the agent, screened as they are kept: keys and tokens, card, Aadhaar, bank account and OTP numbers. */
function screenWords(text: string): string {
  return screenReadback(redactSecrets(text), { keep: ['pan'] }).text;
}

/**
 * A delivery run of the open business by id. A rehearsal or an improvement run is a run too, but it runs to its end in
 * one go, so there is nothing to control: RUN_NOT_RUNNING. Anything else: RUN_NOT_FOUND.
 */
function deliveryRunOf(state: State, venture: VentureRecord, runId: string): DeliveryRunRecord {
  const run = findRecord(state, 'venture-delivery-run', runId);
  if (run && run.ventureId === venture.id) return run;
  const other = [...listRecords(state, 'venture-simulation-run', venture.id), ...listRecords(state, 'venture-improvement-run', venture.id)].some(item => item.id === runId);
  throw other ? new ChausarError('RUN_NOT_RUNNING', NOT_RUNNING) : new ChausarError('RUN_NOT_FOUND', 'That run was not found.');
}

/** Stop a job before its next result can be accepted. Native session interruption follows commit. */
export function stopIn(tx: VentureTx, runId: string, _force: boolean, _by: string): void {
  const current = tx.find('venture-delivery-run', runId);
  check(current, 'RUN_NOT_FOUND', 'That run was not found.');
  check(current.status !== 'stopped', 'RUN_ALREADY_STOPPED', 'This run is already stopped. Resume it or run it again.');
  check(STOPPABLE.includes(current.status) || current.agentJob && current.status === 'ready-for-review', 'RUN_NOT_RUNNING', NOT_RUNNING);
  const job = current.agentJob ? { ...current.agentJob } : undefined;
  if (job) delete job.pendingApproval;
  tx.replace({ ...current, status: 'stopped', callId: null, preview: null, ...(job ? { agentJob: job } : {}) });
  tx.emit('run.stopped', { runId });
  tx.emit('queue.changed', {});
}

const SUPERSEDED = 'A newer run of this order replaced this one, so it cannot be resumed. Open the newer run instead.';

/** 4F3: whether a newer run of the same order exists; of two at the same moment, the later one stored wins. */
function supersededBy(state: State, run: DeliveryRunRecord): boolean {
  const runs = listRecords(state, 'venture-delivery-run', run.ventureId).filter(item => item.orderId === run.orderId);
  const newest = runs.reduce<DeliveryRunRecord | null>((best, item) => (!best || item.at >= best.at ? item : best), null);
  return !!newest && newest.id !== run.id;
}

/** The run as the run sheet reads it now. */
function detailOf(deps: VentureDeps, ctx: Context, runId: string): Promise<RunDetail> {
  return runsGetHandler(deps, ctx, { runId });
}

/** Owner-only immediate Stop. Completed local work remains available as a checked checkpoint. */
export async function runsStopHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.stop');
  const body = exactPayload(payload, ['runId', 'force'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const force = optionalFlag(body.force, 'force');
  const { state, venture } = readAs(deps, ctx, 'approve');
  deliveryRunOf(state, venture, runId);
  await ventureAction(deps, ctx, 'approve', 'runs.stop', tx => stopIn(tx, runId, force, ctx.memberId));
  stopAgentJob(deps.store, runId);
  return { run: await detailOf(deps, ctx, runId), line: STOPPED_BY_YOU };
}

async function resumeRun(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, run: DeliveryRunRecord): Promise<{ line: string; runId: string }> {
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  check(!supersededBy(state, run), 'RUN_SUPERSEDED', SUPERSEDED);
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  check(findRecord(state, 'venture-order', run.orderId)?.status !== 'cancelled', 'ORDER_NOT_ACTIVE', 'This order was cancelled, so its run cannot go on.');
  refuseUnsignedRun(state, venture, run);
  check(canResumeAgentJob(state, run), 'RUN_RESTART_REQUIRED', 'There is no current saved work to continue. Choose Run again to start a fresh AI job.');
  const next = await deliveryRunHandler(deps, ctx, { orderId: run.orderId }, { resumeFrom: run.id });
  return { line: 'Continued from saved work in a new AI session.', runId: next.id };
}

/** venture.runs.resume { runId } (approve, app only): see resumeRun. RUN_NOT_STOPPED for a run that is not stopped. */
export async function runsResumeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.resume');
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runId);
  check(run.status === 'stopped', 'RUN_NOT_STOPPED', 'This run is not stopped, so there is nothing to resume.');
  const resumed = await resumeRun(deps, ctx, state, venture, run);
  return { run: await detailOf(deps, ctx, resumed.runId), line: resumed.line };
}

/** Save the owner's screened instruction, then interrupt so a new session can use it. */
export async function runsSteerHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.steer');
  const body = exactPayload(payload, ['runId', 'text'], ['runId', 'text']);
  const runId = identifier(body.runId, 'Run');
  const text = screenWords(plainText(body.text, 'Your note', { min: 1, max: MAX_NOTE_CHARS }));
  const { state, venture } = readAs(deps, ctx, 'prepare');
  deliveryRunOf(state, venture, runId);
  await ventureAction(deps, ctx, 'prepare', 'runs.steer', tx => {
    const run = tx.find('venture-delivery-run', runId);
    check(run?.agentJob && (run.status === 'stopped' || STOPPABLE.includes(run.status) || run.status === 'ready-for-review'), 'RUN_CONTROL_UNAVAILABLE', 'This run cannot receive AI instructions. Start a new AI job.');
    tx.replace({ ...run, agentJob: { ...run.agentJob, ownerNotes: [...(run.agentJob.ownerNotes ?? []), { text, at: tx.now, by: ctx.memberId }] } });
    if (run.status !== 'stopped') stopIn(tx, runId, false, ctx.memberId);
    else { tx.emit('run.step', { runId }); tx.emit('queue.changed', {}); }
  });
  stopAgentJob(deps.store, runId);
  return { run: await detailOf(deps, ctx, runId), line: 'Instruction saved. Continue in a new AI session when you are ready.' };
}

/** Native tools review their own internal steps. The retired Chausar round loop cannot be enabled. */
export async function runsRoundGateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.roundGate');
  const body = exactPayload(payload, ['runId', 'on', 'every'], ['runId', 'on']);
  const runId = identifier(body.runId, 'Run');
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'on must be true or false.');
  check(body.every === undefined || (GATE_EVERY as readonly unknown[]).includes(body.every), 'INVALID_VENTURE_REQUEST', 'Choose every 1, 2, 3 or 5 rounds.');
  const { state, venture } = readAs(deps, ctx, 'approve');
  deliveryRunOf(state, venture, runId);
  throw new ChausarError('RUN_CONTROL_UNAVAILABLE', 'The AI tool reviews its own steps. Change AI review settings or stop this job.');
}

/**
 * venture.business.pause { paused, stopRunning? } (approve, app only). Paused: no new run starts and no turn is approved
 * (BUSINESS_PAUSED), routines skip with "Paused by you", and Team reads Paused. stopRunning (Stop all) also stops each
 * running run as Stop does. Unpausing changes no run: stopped runs stay stopped until the owner resumes them.
 */
export async function businessPauseHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PauseView> {
  requireAppChannel(ctx, 'venture.business.pause');
  const body = exactPayload(payload, ['paused', 'stopRunning'], ['paused']);
  check(typeof body.paused === 'boolean', 'INVALID_VENTURE_REQUEST', 'paused must be true or false.');
  const paused = body.paused;
  const stopRunning = optionalFlag(body.stopRunning, 'stopRunning');
  check(paused || !stopRunning, 'INVALID_VENTURE_REQUEST', 'Stop all goes with pausing.');
  readAs(deps, ctx, 'approve');
  const stoppedIds: string[] = [];
  const result = await ventureAction(deps, ctx, 'approve', 'business.pause', tx => {
    tx.put<PauseRecord>({ ...tx.base('venture-pause'), paused, stopRunning, by: ctx.memberId });
    let stopped = 0;
    if (stopRunning) {
      for (const run of tx.list('venture-delivery-run')) {
        if (!STOPPABLE.includes(run.status) && !(run.agentJob && run.status === 'ready-for-review')) continue;
        stopIn(tx, run.id, false, ctx.memberId);
        stoppedIds.push(run.id);
        stopped += 1;
      }
    }
    tx.emit('queue.changed', {});
    const line = !paused ? 'Unpaused. Stopped runs stay stopped until you resume them.'
      : !stopRunning ? 'Paused. No new work starts until you unpause.'
        : `Paused. ${stopped === 1 ? '1 run is' : `${stopped} runs are`} stopping or stopped. No new work starts until you unpause.`;
    return { paused, stopped, line };
  });
  for (const id of stoppedIds) stopAgentJob(deps.store, id);
  return result;
}

// ---------------------------------------------------------------------------
// Today's run-control rows (run-control-rows.ts), decided through views/queue-w4.ts
// ---------------------------------------------------------------------------

const runOfSubject = (subject: string) => subject.slice('runctl:'.length);

/** Stale round cards cannot restart the retired model loop. */
export async function decideGateContinue(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const { state, venture } = readAs(deps, ctx, 'approve');
  deliveryRunOf(state, venture, runOfSubject(decision.subject));
  throw new ChausarError('RUN_CONTROL_UNAVAILABLE', 'The AI tool reviews its own steps. Stop this job and start again.');
}

/** Stop at the round gate: the run stops at once, keeping every finished step. */
export async function decideGateStop(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const runId = runOfSubject(decision.subject);
  readAs(deps, ctx, 'approve');
  await ventureAction(deps, ctx, 'approve', 'runs.stop', tx => stopIn(tx, runId, false, ctx.memberId));
  stopAgentJob(deps.store, runId);
  return { line: STOPPED_BY_YOU };
}

/** Resume a stopped run from Today. */
export async function decideResume(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runOfSubject(decision.subject));
  check(run.status === 'stopped', 'APPROVAL_STALE', STALE);
  return { line: (await resumeRun(deps, ctx, state, venture, run)).line };
}

/** Run again on a stopped run: a new run for the same order, with the same files the first step collected. */
export async function decideRunAgain(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  check(decision.action === 'run-again', 'INVALID_VENTURE_REQUEST', 'This row does not offer that.');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runOfSubject(decision.subject));
  await deliveryRunHandler(deps, ctx, { orderId: run.orderId });
  return { line: 'Started again with the same files.' };
}

/** The open run statuses a gate or a note applies to, for other packages (4F2's breaker rows). */
export const CONTROLLED_STATUSES: readonly DeliveryRunRecord['status'][] = Object.freeze([...STOPPABLE, 'stopped']);
export { gateWaits };
