// Chausar venture launcher, delivery (Ink v2 wave 4, package 4F1): run controls. The owner can always stop a run.
// Stop lets the step in progress finish safely and keeps every finished step; while a turn is out the stop is recorded
// on the run and read between calls, so the call in progress finishes, the rest of the turn is cancelled, and then the
// run is stopped. Force stop stops the run at once and says what is lost: the step in progress is thrown away when it
// comes back, except what its journal says went out, which stays sent. Nothing in flight is retried on its own after a
// stop. Resume asks again: it previews the next turn afresh (the cut step again after a force stop) from the run's own
// playbook version, and that turn waits for the owner's approval like any other, so anything that spends or sends is
// asked again. A steer note waits for the next turn and is used once. The round gate holds the run for the owner after
// every round (or every few). Pause all refuses new work until the owner unpauses; Stop all stops each running run.
// A stopped run never reads as done. Catalogue O1 to O4; LongHorizon's stop and gate, a rewrite, not a copy.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { exactPayload, findRecord, identifier, listRecords, plainText, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, HarnessState, PauseRecord, PauseView, RoundGate, RunControlResult, RunDetail, SteerNote, VentureDeps, VentureRecord } from '../contracts.ts';
import { optionalFlag, readAs } from './shared.ts';
import { agentStage, deliveryRunHandler, previewNextTurn, STAGE_BLOCKED_REASON } from './runs.ts';
import { continueGate, FORCE_STOPPED, GATE_EVERY, gateWaits, setGate, stampOwnerWords, stopAsked, STOPPED_BY_YOU } from './harness/controls.ts';
import { openDelegation } from './harness/loop.ts';
import { refuseNewWork, STOPPABLE } from './run-guards.ts';
import { redactSecrets, screenReadback } from '../core/secrets.ts';
import { runsGetHandler } from '../views/runs.ts';
import type { W4Decision, W4Outcome } from '../views/queue-w4.ts';
import { voidPreview } from './leases.ts';
import { questionWindowMs, renewQuestionExpiry } from './timed-questions.ts';
import { refuseUnsignedRun } from '../money/order-contracts.ts';

export { awaySkipLine, PAUSED_BY_YOU, pauseSkipLine, pausedNow } from './run-guards.ts';

const NOT_RUNNING = 'This run is not running, so there is nothing to stop or steer.';
const RECEIVED = 'Stop received. The step in progress finishes, then the run stops.';
const ONE_STEP = 'This run has one step, and it is finishing now. Nothing runs after it.';
const RESUMED = 'Resumed. Approve the next step when you are ready.';
const STEER_SENT = 'Sent. Waiting for the agent to pick it up.';
const STALE = 'This changed since you opened it.';
/** The most notes that may wait for the next turn at once. */
const MAX_WAITING_NOTES = 5;
const MAX_NOTE_CHARS = 500;
const CLEARED = { stop: null, stoppedAt: null, line: null, cutCallId: null };
const CUT_OUT = 'The step you cut is still coming back. Resume once it has: Chausar counts what it cost and keeps nothing it made.';

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

/**
 * Whether a turn of this run is out right now: its approved call was claimed (sent, or answered and its tools running),
 * or the owner's own tool is working on its brief and has not run past its time.
 */
function inFlight(state: State, run: DeliveryRunRecord, nowMs: number): boolean {
  if (run.status === 'waiting-for-you' && run.callId) {
    const call = state.conversations.find((record: { id?: unknown } | null) => record?.id === run.callId) as { status?: unknown } | undefined;
    return call?.status === 'dispatching' || call?.status === 'completed';
  }
  if (run.status === 'brief-waiting' && run.harness) {
    const open = openDelegation(run.harness);
    return open?.status === 'running' && open.startedAt !== null && Date.parse(open.startedAt) + open.limits.minutes * 60_000 + 120_000 >= nowMs;
  }
  return false;
}

type StopOutcome = 'stopped' | 'cut' | 'stopping' | 'finishing';

/**
 * One stop, inside a transaction. A run with nothing out stops at once and keeps every finished step; its waiting
 * preview is voided, never sent. A run with a turn out records the stop, which the turn reads between calls, unless
 * force, which stops it at once (the turn is thrown away when it comes back). A one-step run's only step finishes.
 */
export function stopIn(tx: VentureTx, runId: string, force: boolean, by: string): StopOutcome {
  const current = tx.find('venture-delivery-run', runId);
  check(current, 'RUN_NOT_FOUND', 'That run was not found.');
  check(current.status !== 'stopped', 'RUN_ALREADY_STOPPED', 'This run is already stopped. Resume it or run it again.');
  check(STOPPABLE.includes(current.status), 'RUN_NOT_RUNNING', NOT_RUNNING);
  const out = inFlight(tx.state, current, Date.parse(tx.now));
  const stop = { at: tx.now, by, force };
  if (out && !force) {
    if (!current.harness) return 'finishing';
    if (stopAsked(current.harness)) return 'stopping';
    tx.replace({ ...current, harness: { ...current.harness, control: { stop, stoppedAt: null, line: null } } });
    tx.emit('run.step', { runId });
    return 'stopping';
  }
  // What a force stop cuts while it is out: the turn's model call, or the brief the owner's tool works on. Its turn
  // settles it when it comes back (delivery/runs.ts keepCutTurn, keepCutBrief); Resume waits until then.
  const cut = !out ? null : current.status === 'brief-waiting' && current.harness ? openDelegation(current.harness)?.toolCallId ?? null : current.callId;
  // A waiting preview nothing claimed is released in this same write, so an approval already past its checks finds
  // it stale: nothing is sent and nothing is charged.
  if (!out) releasePreview(tx, current.callId);
  const harness: HarnessState | null | undefined = current.harness
    ? {
      ...current.harness, control: { stop, stoppedAt: tx.now, line: out ? FORCE_STOPPED : STOPPED_BY_YOU, ...(cut ? { cutCallId: cut } : {}) },
      ...(current.harness.gate ? { gate: { ...current.harness.gate, waiting: null } } : {}),
    }
    : current.harness;
  // A one-step run has no loop state, so it keeps the cut call on the record until its answer is settled (runs.ts).
  tx.replace({ ...current, status: 'stopped', callId: !current.harness && cut ? cut : null, preview: null, harness });
  tx.emit('run.stopped', { runId });
  return out ? 'cut' : 'stopped';
}

/** Marks a preview no one claimed as expired, so the model port refuses to send it: the one helper (4J13, leases.ts). */
const releasePreview = (tx: VentureTx, callId: string | null): void => voidPreview(tx, callId);

const SUPERSEDED = 'A newer run of this order replaced this one, so it cannot be resumed. Open the newer run instead.';

/** 4F3: whether a newer run of the same order exists; of two at the same moment, the later one stored wins. */
function supersededBy(state: State, run: DeliveryRunRecord): boolean {
  const runs = listRecords(state, 'venture-delivery-run', run.ventureId).filter(item => item.orderId === run.orderId);
  const newest = runs.reduce<DeliveryRunRecord | null>((best, item) => (!best || item.at >= best.at ? item : best), null);
  return !!newest && newest.id !== run.id;
}

/** How long a cut turn may stay out before Resume goes on without it: past any tool's and model call's time limit. */
const CUT_GRACE_MS = 15 * 60_000;

/**
 * Whether a call a force stop cut is still out and not yet settled: Resume waits for it, so the cut turn can never run
 * on beside a resumed one, its journal says it went out, and its cost is counted before the run goes on.
 */
function cutStillOut(state: State, run: DeliveryRunRecord, nowMs: number): boolean {
  const call = (id: string) => state.conversations.find((record: { id?: unknown } | null) => record?.id === id) as { status?: unknown } | undefined;
  if (!run.harness) return !!run.callId && call(run.callId)?.status === 'dispatching';
  const control = run.harness.control;
  const cut = control?.cutCallId;
  if (!cut || Date.parse(control.stop?.at ?? control.stoppedAt ?? '') + CUT_GRACE_MS < nowMs) return false;
  const model = call(cut);
  if (model) return model.status === 'dispatching' || model.status === 'completed';
  return openDelegation(run.harness)?.toolCallId === cut && openDelegation(run.harness)?.status === 'running';
}

/** The run as the run sheet reads it now. */
function detailOf(deps: VentureDeps, ctx: Context, runId: string): Promise<RunDetail> {
  return runsGetHandler(deps, ctx, { runId });
}

/**
 * venture.runs.stop { runId, force? } (approve, app only). Stop: "Stopped by you. Finished steps are kept.", or while a
 * turn is out "Stop received..." and the run reads stopping until it is stopped. Force stop: stopped at once, and lost
 * names the step thrown away. Refused: RUN_NOT_FOUND, RUN_NOT_RUNNING (done, failed, accepted, rejected, ready for
 * review, a rehearsal), RUN_ALREADY_STOPPED.
 */
export async function runsStopHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.stop');
  const body = exactPayload(payload, ['runId', 'force'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const force = optionalFlag(body.force, 'force');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runId);
  check(run.status !== 'stopped', 'RUN_ALREADY_STOPPED', 'This run is already stopped. Resume it or run it again.');
  check(STOPPABLE.includes(run.status), 'RUN_NOT_RUNNING', NOT_RUNNING);
  // The step in progress, named before the stop, for what a force stop loses.
  const before = force ? await detailOf(deps, ctx, runId) : null;
  const step = before?.steps.find(item => item.state === 'current' || item.state === 'waiting')?.purpose ?? 'the step in progress';
  const outcome = await ventureAction(deps, ctx, 'approve', 'runs.stop', tx => stopIn(tx, runId, force, ctx.memberId));
  const detail = await detailOf(deps, ctx, runId);
  if (outcome === 'cut') return { run: detail, line: 'Stopped by you.', lost: `The step in progress is thrown away: ${step}. Anything already sent stays sent.` };
  return { run: detail, line: outcome === 'stopped' ? STOPPED_BY_YOU : outcome === 'stopping' ? RECEIVED : ONE_STEP };
}

/**
 * Puts a stopped run back where it was: waiting for approval of a fresh preview of its next turn (the write turn once
 * its limits are spent; the cut step again after a force stop), or back to its open question or brief. The preview is
 * made from the run's own playbook version. The approval it waits for asks again for anything that spends or sends.
 */
async function resumeRun(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, run: DeliveryRunRecord): Promise<string> {
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  // 4F3: a newer run of the same order replaced this one (Run again), so this one stays where it stopped.
  check(!supersededBy(state, run), 'RUN_SUPERSEDED', SUPERSEDED);
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  check(findRecord(state, 'venture-order', run.orderId)?.status !== 'cancelled', 'ORDER_NOT_ACTIVE', 'This order was cancelled, so its run cannot go on.');
  check(!cutStillOut(state, run, deps.clock().getTime()), 'RUN_NOT_STOPPED', CUT_OUT);
  // 4J12 (H24): a run whose order contract waits for the owner's signature stays stopped (again in the commit).
  refuseUnsignedRun(state, venture, run);
  const cleared: HarnessState | null = run.harness
    ? { ...run.harness, control: { ...CLEARED }, ...(run.harness.gate ? { gate: { ...run.harness.gate, waiting: null } } : {}) }
    : null;
  const asks = cleared?.phase === 'needs-answer' || cleared?.phase === 'brief';
  const made = asks ? null : await previewNextTurn(deps, ctx, state, venture, run, cleared);
  await ventureAction(deps, ctx, 'approve', 'runs.resume', tx => {
    const current = tx.find('venture-delivery-run', run.id);
    // The same stopped run that was read: no turn came back, settled or cost anything meanwhile.
    check(current && current.status === 'stopped' && current.harness?.used.turns === run.harness?.used.turns
      && current.harness?.used.costMicros === run.harness?.used.costMicros, 'RUN_NOT_STOPPED', 'This run is not stopped, so there is nothing to resume.');
    check(!cutStillOut(tx.state, current, Date.parse(tx.now)), 'RUN_NOT_STOPPED', CUT_OUT);
    refuseNewWork(tx.state, tx.venture!, ctx, tx.now);
    refuseUnsignedRun(tx.state, tx.venture!, current);
    // Notes the owner sent while it was stopped stay for the next turn; those the fresh text carries are stamped with it.
    const base = made ? made.harness : cleared;
    const kept = base ? { ...base, steer: current.harness?.steer ?? base.steer, control: { ...CLEARED } } : current.harness;
    const harness = kept && made && base ? stampOwnerWords(kept, base, made.preview.callId) : kept;
    // 4J13: a question the run goes back to gets a fresh window from now (timed-questions.ts); an interruption is over.
    const asked = !made && cleared?.phase === 'needs-answer' && harness
      ? renewQuestionExpiry(harness, tx.now, questionWindowMs(findRecord(tx.state, 'venture-playbook', current.playbookId))) : harness;
    const rest: DeliveryRunRecord = { ...current };
    delete rest.interrupted;
    const stored: DeliveryRunRecord = made
      ? { ...rest, status: 'waiting-for-you', callId: made.preview.callId, preview: made.preview, harness }
      : { ...rest, status: cleared?.phase === 'brief' ? 'brief-waiting' : 'needs-answer', callId: null, preview: null, harness: asked };
    tx.replace(stored);
    if (made) tx.emit('delivery-waiting', { runId: stored.id, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId: stored.id });
    tx.emit('run.waiting', { runId: stored.id });
  });
  return made ? RESUMED : cleared?.phase === 'brief' ? 'Resumed. Decide on the brief to go on.' : 'Resumed. Answer the question to go on.';
}

/** venture.runs.resume { runId } (approve, app only): see resumeRun. RUN_NOT_STOPPED for a run that is not stopped. */
export async function runsResumeHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.resume');
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runId);
  check(run.status === 'stopped', 'RUN_NOT_STOPPED', 'This run is not stopped, so there is nothing to resume.');
  const line = await resumeRun(deps, ctx, state, venture, run);
  return { run: await detailOf(deps, ctx, runId), line };
}

/**
 * venture.runs.steer { runId, text } (prepare, app only): the owner's words for the agent's next turn, at most 500
 * characters, screened for secrets, used once. A run waiting for approval of its next turn gets that turn's text again
 * with the note in it, so the owner approves what the agent will read. Notes wait while a turn runs, a question or a
 * brief waits, or the run is stopped.
 */
export async function runsSteerHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.steer');
  const body = exactPayload(payload, ['runId', 'text'], ['runId', 'text']);
  const runId = identifier(body.runId, 'Run');
  const text = screenWords(plainText(body.text, 'Your note', { min: 1, max: MAX_NOTE_CHARS }));
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const run = deliveryRunOf(state, venture, runId);
  const open = [...STOPPABLE, 'stopped'] as DeliveryRunRecord['status'][];
  check(open.includes(run.status), 'RUN_NOT_RUNNING', NOT_RUNNING);
  check(run.harness, 'INVALID_VENTURE_REQUEST', 'This run has one step, so there is no next step to tell it about.');
  check((run.harness.steer ?? []).filter(note => note.pickedUpTurn === null).length < MAX_WAITING_NOTES, 'INVALID_VENTURE_REQUEST',
    'Five notes already wait for the next step. Send more once the agent picks them up.');
  const nowMs = deps.clock().getTime();
  const note: SteerNote = { text, at: deps.clock().toISOString(), by: ctx.memberId, pickedUpTurn: null };
  const refresh = run.status === 'waiting-for-you' && !!run.preview && !!run.callId && !inFlight(state, run, nowMs)
    && Date.parse(run.preview.expiresAt) > nowMs && agentStage(venture.launchStage);
  const previewed: HarnessState = { ...run.harness, steer: [...(run.harness.steer ?? []), note] };
  const made = refresh ? await previewNextTurn(deps, ctx, state, venture, run, previewed) : null;
  await ventureAction(deps, ctx, 'prepare', 'runs.steer', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.harness && open.includes(current.status), 'RUN_NOT_RUNNING', NOT_RUNNING);
    const steer = [...(current.harness.steer ?? []), note];
    // The fresh text replaces the waiting one only while that one is still waiting: never a turn that is out (an
    // approval may have claimed it meanwhile). Otherwise the note just waits for the next turn.
    const fresh = made && current.status === 'waiting-for-you' && current.callId === run.callId && !inFlight(tx.state, current, Date.parse(tx.now));
    if (fresh) releasePreview(tx, current.callId);
    tx.replace(fresh
      ? {
        ...current, callId: made.preview.callId, preview: made.preview,
        harness: stampOwnerWords({ ...current.harness, steer, phase: made.harness!.phase, stopReason: made.harness!.stopReason }, previewed, made.preview.callId),
      }
      : { ...current, harness: { ...current.harness, steer } });
    tx.emit('run.step', { runId });
  });
  return { run: await detailOf(deps, ctx, runId), line: STEER_SENT };
}

/**
 * The round gate opens: the owner's words (if any) wait for the next turn, a limit gives 2 more turns once where it
 * can, and the next turn is previewed from the run's own playbook and waits for approval. setting: the gate's new
 * switch and pace, when the owner turned it off while it held the run.
 */
async function continueRun(deps: VentureDeps, ctx: Context, runId: string, words: string | null, round: number, setting?: { on: boolean; every: RoundGate['every'] }): Promise<void> {
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runId);
  check(run.status === 'waiting-for-you' && run.harness?.gate?.waiting?.round === round, 'APPROVAL_STALE', STALE);
  refuseNewWork(state, venture, ctx, deps.clock().toISOString());
  check(agentStage(venture.launchStage), 'LAUNCH_STAGE_BLOCKED', STAGE_BLOCKED_REASON);
  let opened = continueGate(run.harness, words);
  if (setting) opened = setGate(opened, setting.on, setting.every);
  const made = await previewNextTurn(deps, ctx, state, venture, run, opened);
  await ventureAction(deps, ctx, 'approve', 'runs.continue', tx => {
    const current = tx.find('venture-delivery-run', runId);
    check(current && current.status === 'waiting-for-you' && current.harness?.gate?.waiting?.round === round, 'APPROVAL_STALE', STALE);
    const kept = { ...made.harness!, steer: current.harness.steer ?? made.harness!.steer, control: current.harness.control ?? made.harness!.control };
    // Notes this text carries are stamped with its call; one sent meanwhile waits for the turn after (harness/controls.ts).
    const harness = stampOwnerWords(kept, made.harness!, made.preview.callId);
    const stored: DeliveryRunRecord = { ...current, callId: made.preview.callId, preview: made.preview, harness };
    tx.replace(stored);
    tx.emit('delivery-waiting', { runId, orderId: stored.orderId, practice: stored.practice });
    tx.emit('run.step', { runId });
    tx.emit('run.waiting', { runId });
  });
}

const gateLine = (on: boolean, every: number) => (!on ? 'The round gate is off.' : every === 1 ? 'The run waits for you after every round.' : `The run waits for you after every ${every} rounds.`);

/**
 * venture.runs.roundGate { runId, on, every? } (approve, app only): the owner's gate after each round, or every 2, 3
 * or 5 rounds. Turning it off lets a run waiting at it go on with its next turn. A one-step run has no rounds.
 */
export async function runsRoundGateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RunControlResult> {
  requireAppChannel(ctx, 'venture.runs.roundGate');
  const body = exactPayload(payload, ['runId', 'on', 'every'], ['runId', 'on']);
  const runId = identifier(body.runId, 'Run');
  check(typeof body.on === 'boolean', 'INVALID_VENTURE_REQUEST', 'on must be true or false.');
  const on = body.on;
  check(body.every === undefined || (GATE_EVERY as readonly unknown[]).includes(body.every), 'INVALID_VENTURE_REQUEST', 'Choose every 1, 2, 3 or 5 rounds.');
  const every = (body.every ?? 1) as RoundGate['every'];
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runId);
  check(([...STOPPABLE, 'stopped'] as DeliveryRunRecord['status'][]).includes(run.status), 'RUN_NOT_RUNNING', 'This run is not running, so it has no next round.');
  check(run.harness, 'INVALID_VENTURE_REQUEST', 'This run has one step, so it has no rounds to gate.');
  const waiting = run.harness.gate?.waiting ?? null;
  if (!on && waiting && run.status === 'waiting-for-you') {
    await continueRun(deps, ctx, runId, null, waiting.round, { on, every });
  } else {
    await ventureAction(deps, ctx, 'approve', 'runs.roundGate', tx => {
      const current = tx.find('venture-delivery-run', runId);
      check(current && current.harness, 'RUN_NOT_FOUND', 'That run was not found.');
      tx.replace({ ...current, harness: { ...current.harness, gate: setGate(current.harness, on, every).gate } });
      tx.emit('run.step', { runId });
    });
  }
  return { run: await detailOf(deps, ctx, runId), line: gateLine(on, every) };
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
  return ventureAction(deps, ctx, 'approve', 'business.pause', tx => {
    tx.put<PauseRecord>({ ...tx.base('venture-pause'), paused, stopRunning, by: ctx.memberId });
    let stopped = 0;
    if (stopRunning) {
      for (const run of tx.list('venture-delivery-run')) {
        if (!STOPPABLE.includes(run.status)) continue;
        stopIn(tx, run.id, false, ctx.memberId);
        stopped += 1;
      }
    }
    tx.emit('queue.changed', {});
    const line = !paused ? 'Unpaused. Stopped runs stay stopped until you resume them.'
      : !stopRunning ? 'Paused. No new work starts until you unpause.'
        : `Paused. ${stopped === 1 ? '1 run is' : `${stopped} runs are`} stopping or stopped. No new work starts until you unpause.`;
    return { paused, stopped, line };
  });
}

// ---------------------------------------------------------------------------
// Today's run-control rows (run-control-rows.ts), decided through views/queue-w4.ts
// ---------------------------------------------------------------------------

const runOfSubject = (subject: string) => subject.slice('runctl:'.length);

/** Continue at the round gate, with the owner's optional words for the next turn. */
export async function decideGateContinue(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const round = parseInt(/:gate-(\d+)$/.exec(decision.row.id)?.[1] ?? '', 10);
  check(Number.isInteger(round), 'APPROVAL_STALE', STALE);
  const words = decision.answer?.trim() ? screenWords(decision.answer.trim()) : null;
  check(!words || words.length <= MAX_NOTE_CHARS, 'INVALID_VENTURE_REQUEST', 'Keep the note for the next step to 500 characters.');
  await continueRun(deps, ctx, runOfSubject(decision.subject), words, round);
  return { line: 'The run goes on. Approve the next step when you are ready.' };
}

/** Stop at the round gate: the run stops at once, keeping every finished step. */
export async function decideGateStop(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const runId = runOfSubject(decision.subject);
  readAs(deps, ctx, 'approve');
  await ventureAction(deps, ctx, 'approve', 'runs.stop', tx => stopIn(tx, runId, false, ctx.memberId));
  return { line: STOPPED_BY_YOU };
}

/** Resume a stopped run from Today. */
export async function decideResume(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const { state, venture } = readAs(deps, ctx, 'approve');
  const run = deliveryRunOf(state, venture, runOfSubject(decision.subject));
  check(run.status === 'stopped', 'APPROVAL_STALE', STALE);
  return { line: await resumeRun(deps, ctx, state, venture, run) };
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
