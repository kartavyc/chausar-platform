// Chausar venture launcher, agents (Ink v2 wave 4, package 4J13; catalogue A12, A13, H34): the routine runner and the
// sweep it runs with. It runs with the journal sweep (build/journal-sweep.ts): when a vault opens and on the engine's
// tick. Each sweep first recovers runs whose lease ran out (delivery/leases.ts), times out questions nobody answered
// (delivery/timed-questions.ts) and asks again a judge that waited while the owner worked (delivery/judge-run.ts),
// then looks at each routine the owner set that is on (no agent or chief path saves one
// yet, so only the owner's run):
// - Its occurrences since the last one it handled are counted from its schedule; the newest runs when it is no more
//   than 60 minutes late (the catch-up window); every older one becomes one missed run that says how many. So after a
//   restart only the latest missed occurrence runs, and only inside the window.
// - While the business is paused it is skipped ("Paused by you"). While the owner is away it keeps running: each run
//   still only waits on Today. While an earlier run of it still waits, the new one is skipped, so runs never overlap.
// - A run is claimed (running), then parks in needs input: a routine never approves anything. Its own posture is
//   always approve each, so the stricter of its own and its agent's is never looser: every run waits for the owner on
//   Today (one card, so one notification, with when it runs out). Run it checks the AI connection again, then sends
//   the prompt to the agent's chat or to the routine's pinned chat with Chausar as a routine message: through the same
//   consent and checks as the owner's own words, but never taken as the answer to a waiting question, a standing order
//   or a note. Not now skips it; nobody answering within 24 hours counts as no, recorded as a timeout.
// - A run found running from a sweep this process did not start was cut by a crash: it is interrupted, never run again.
// - A routine whose sweep fails gets one failed run with why; the other routines still run.
// History says delivered, never done.
import { check, type Context, type State } from '../../contracts.ts';
import { currentVenture, digest, listRecords, ventureAction, type VentureTx } from '../records.ts';
import {appendChiefMessage} from '../chief/store.ts';
import { ROUTINE_ANSWER_MS } from '../contracts.ts';
import type { ChiefThreadRecord, QueueAction, RoutineRecord, RoutineRunRecord, RoutineRunState, VentureDeps, VentureRecord } from '../contracts.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../views/queue-w4.ts';
import { askedName, liveRoutines, occurrencesBetween, runsOf } from './routines.ts';
import { pauseSkipLine } from '../delivery/run-guards.ts';
import { recoverLeases } from '../delivery/leases.ts';
import { expireQuestions } from '../delivery/timed-questions.ts';
import { recordDecision } from '../journal/decisions.ts';
import { short } from '../views/shared.ts';
import { teamAgents } from '../chief/routing.ts';
import { chatRoute } from './consent.ts';
import { requireConnectorChecked } from '../build/connector-check.ts';
// W6 6G5 (D44): a routine past its own limit, its agent's or the month's is refused before it starts; its AI calls name it.
import { keyedPreset, routineCapError } from '../money/spend-meter.ts';
import { routineStartRefusal } from '../money/agent-meters.ts';
import { withRoutineScope } from './routine-scope.ts';
// C7: routines wait for the AI plan to reset (models/plan-book.ts); the owner may set an earlier pause point.
import { planBookOf, planCliOf, USED_UP_HOLD_MS } from '../models/plan-book.ts';
import { CLI_LABELS } from '../models/presets.ts';
import { agentSettingsOf } from '../agent-runtime/settings.ts';
import { formatTime, ownerZone } from '../../owner-format.ts';
import type { DelegateCli, IsoTime } from '../contracts.ts';
import { ChausarError } from '../../contracts.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import { EVENT_WORDS, fillBlanks, type EventFacts } from '../build/event-triggers.ts';
import { RUN_ELSEWHERE, BACKUP_WORDS, clientAllowsBackup, routineRoutes, usableBackup } from './routine-backup.ts';
import type { ChatRoute } from './consent.ts';

/** How late a run may start: an occurrence older than this is missed. */
export const CATCH_UP_MS = 60 * 60_000;
/** How long a parked run waits for the owner before it counts as no (contracts.ts, so Today's row meta reads it too). */
export const ANSWER_MS = ROUTINE_ANSWER_MS;

/** The run lines, in Chausar's words. */
export const ROUTINE_WORDS = Object.freeze({
  running: 'Getting it ready.',
  waiting: 'Waiting for you on Today. Nothing goes to your AI until you approve it.',
  missed: (count: number) => (count === 1 ? 'Missed once while Chausar was closed.' : `Missed ${count} times while Chausar was closed.`),
  overlap: 'Skipped: the job before it was still waiting for you.',
  paused: (line: string) => `Skipped: ${line}.`,
  noAnswer: 'Nobody approved it within 24 hours, so it counts as no. Nothing was sent.',
  notNow: 'You said not now. Nothing was sent.',
  interrupted: 'Interrupted: Chausar stopped while this ran. It will not run again.',
  gone: 'Skipped: the agent it asks is no longer on the team.',
  delivered: (where: string) => `Delivered to ${where}.`,
  failed: (why: string) => `Could not run: ${why}`,
  overLimit: (why: string) => `Skipped: ${why}`,
  planReset: (tool: string, time: string) => `Waits for your ${tool} plan to reset at ${time}. Nothing was sent.`,
  planLater: (tool: string) => `Waits for your ${tool} plan. Chausar looks again every ${USED_UP_HOLD_MS / 60_000} minutes.`,
});

/** C7: when a parked run's 24 hours started: when it came back to Today after a plan wait, else when it was made. */
export const parkedAt = (run: Pick<RoutineRunRecord, 'at' | 'parkedAt'>): string => run.parkedAt ?? run.at;

/** C7: a run waiting for the plan comes back to Today once its reset passed, or after 30 minutes when none is known. */
function planWaitOver(run: RoutineRunRecord, nowMs: number): boolean {
  if (!run.waitsFor) return false;
  if (run.waitsFor.resetsAt !== null) return Date.parse(run.waitsFor.resetsAt) <= nowMs;
  return Date.parse(run.waitingSince ?? run.at) + USED_UP_HOLD_MS <= nowMs;
}

/** The routine runs this process is making ready now; any other run found running was cut by a crash. */
const MAKING = new Set<string>();
/** One sweep at a time per vault, so two ticks never run the same occurrence. */
const SWEEPING = new WeakSet<object>();

const OPEN: readonly RoutineRunState[] = ['queued', 'running', 'needs-input'];

/** The routines that run: on, and set by the owner. */
function runnable(state: State, ventureId: string): RoutineRecord[] {
  return liveRoutines(state, ventureId).filter(routine => routine.on && routine.setBy === 'owner');
}

/** One run record of a routine, inside the caller's transaction. */
function putRun(tx: VentureTx, routine: RoutineRecord, dueAt: string, state: RoutineRunState, line: string, missed = 0): RoutineRunRecord {
  return tx.put<RoutineRunRecord>({ ...tx.base('venture-routine-run'), routineId: routine.id, dueAt, state, line, missed, runId: null, threadId: null });
}

/** Ends parked runs nobody answered within 24 hours (a no, recorded as a timeout) and runs a crash cut. */
function settleOld(tx: VentureTx, nowMs: number): void {
  for (const run of tx.list('venture-routine-run')) {
    if (run.state === 'queued' && run.waitsFor) {
      // C7: a run waiting for the plan is not one a crash cut; once the plan resets it waits on Today for a fresh 24 hours.
      if (planWaitOver(run, nowMs)) {
        const { waitsFor: _waited, waitingSince: _since, ...rest } = run;
        tx.replace<RoutineRunRecord>({ ...rest, state: 'needs-input', line: ROUTINE_WORDS.waiting, parkedAt: tx.now });
        tx.emit('queue.changed', {});
      }
    } else if ((run.state === 'running' || run.state === 'queued') && !MAKING.has(run.id)) {
      tx.replace<RoutineRunRecord>({ ...run, state: 'interrupted', line: ROUTINE_WORDS.interrupted });
    } else if (run.state === 'needs-input' && Date.parse(parkedAt(run)) + ANSWER_MS <= nowMs) {
      tx.replace<RoutineRunRecord>({ ...run, state: 'skipped', line: ROUTINE_WORDS.noAnswer });
      const routine = tx.find('venture-routine', run.routineId);
      recordDecision(tx, { subject: `routine:${run.id}`, action: 'timeout', who: 'timeout', ruleId: null, rowId: null, reason: `${routine?.name ?? 'A routine'} waited 24 hours for your approval, so it did not run.` });
    }
  }
}

/**
 * One routine at a sweep: its missed occurrences become one missed run, and the newest inside the catch-up window is
 * skipped (paused, overlap, agent gone) or claimed. Answers the run it claimed, or null.
 */
function planRoutine(tx: VentureTx, routine: RoutineRecord, nowMs: number, keyed = false): RoutineRunRecord | null {
  const runs = runsOf(tx.state, tx.venture!.id, routine.id);
  const last = runs.reduce((latest, run) => Math.max(latest, Date.parse(run.dueAt)), Date.parse(routine.at));
  const due = occurrencesBetween(routine.schedule, last, nowMs);
  if (!due.count || !due.latest) return null;
  const late = nowMs - Date.parse(due.latest) > CATCH_UP_MS;
  const missed = late ? due.count : due.count - 1;
  if (missed > 0) putRun(tx, routine, late ? due.latest : due.previous!, 'missed', ROUTINE_WORDS.missed(missed), missed);
  if (late) return null;
  const paused = pauseSkipLine(tx.state);
  if (paused) { putRun(tx, routine, due.latest, 'skipped', ROUTINE_WORDS.paused(paused)); return null; }
  if (runs.some(run => OPEN.includes(run.state))) { putRun(tx, routine, due.latest, 'skipped', ROUTINE_WORDS.overlap); return null; }
  if (routine.agent !== null && !teamAgents(tx.state, tx.venture!).some(agent => agent.id === routine.agent)) {
    putRun(tx, routine, due.latest, 'skipped', ROUTINE_WORDS.gone);
    return null;
  }
  // W6 6G5: on a key, a routine whose own limit, agent's limit or the month's limit is used is skipped with the reason.
  const over = keyed && !routine.recordReport ? routineStartRefusal(tx.state, tx.venture!, routine, tx.now) : null;
  if (over) { putRun(tx, routine, due.latest, 'skipped', ROUTINE_WORDS.overLimit(over)); return null; }
  const claimed = putRun(tx, routine, due.latest, 'running', ROUTINE_WORDS.running);
  MAKING.add(claimed.id);
  return claimed;
}

/** Why a routine's sweep failed, in plain words. */
const whyOf = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Chausar could not work out when it runs.');

/**
 * Records a routine's failed sweep as one failed run of it, due now; the same failure twice in a row is recorded once.
 */
async function recordFailure(deps: VentureDeps, ctx: Context, routineId: string, error: unknown): Promise<void> {
  const line = ROUTINE_WORDS.failed(whyOf(error));
  await ventureAction(deps, ctx, 'prepare', 'routines.failed', tx => {
    const routine = tx.find('venture-routine', routineId);
    if (!routine) return;
    const newest = runsOf(tx.state, tx.venture!.id, routine.id).at(-1);
    if (newest?.state === 'failed' && newest.line === line) return;
    putRun(tx, routine, tx.now, 'failed', line);
  }).catch(() => undefined);
}

/**
 * The routines' part of a sweep. Old runs are settled first; then each routine is planned in a transaction of its own,
 * so one that fails is recorded on itself and the others still run. A claimed run parks in its own write, so a crash
 * between the two leaves it running, and the next sweep finds it interrupted. Returns how many runs it parked.
 */
export async function runRoutines(deps: VentureDeps, ctx: Context): Promise<number> {
  const ids = await ventureAction(deps, ctx, 'prepare', 'routines.settle', tx => {
    settleOld(tx, Date.parse(tx.now));
    return runnable(tx.state, tx.venture!.id).map(routine => routine.id);
  });
  let parked = 0;
  let keyed = false;
  try { keyed = keyedPreset(chatRoute(deps.models.status(ctx))?.presetId); } catch { keyed = false; }
  for (const routineId of ids) {
    let claimed: RoutineRunRecord | null = null;
    try {
      claimed = await ventureAction(deps, ctx, 'prepare', 'routines.sweep', tx => {
        const routine = tx.find('venture-routine', routineId);
        return routine && routine.on && routine.setBy === 'owner' && routine.removedAt === null ? planRoutine(tx, routine, Date.parse(tx.now), keyed) : null;
      });
    } catch (error) {
      await recordFailure(deps, ctx, routineId, error);
      continue;
    }
    if (!claimed) continue;
    const id = claimed.id;
    try {
      await ventureAction(deps, ctx, 'prepare', 'routines.park', tx => {
        const run = tx.find('venture-routine-run', id);
        if (run?.state !== 'running') return;
        tx.replace<RoutineRunRecord>({ ...run, state: 'needs-input', line: ROUTINE_WORDS.waiting });
        tx.emit('queue.changed', {});
        parked += 1;
      });
    } finally {
      MAKING.delete(id);
    }
  }
  return parked;
}

/**
 * The sweep the journal sweep runs (build/journal-sweep.ts): leases that ran out, questions nobody answered, then the
 * routines. claimLimitMs: the journal's own, 1 when a vault opens. Never throws.
 */
export async function routineTick(deps: VentureDeps, ctx: Context, claimLimitMs?: number): Promise<void> {
  const store = deps.store as unknown as object;
  if (SWEEPING.has(store)) return;
  SWEEPING.add(store);
  try {
    if (!currentVenture(deps.store.read())) return;
    await recoverLeases(deps, ctx, claimLimitMs).catch(() => []);
    await expireQuestions(deps, ctx).catch(() => []);
    // H30: a judge that waited while the owner worked is asked again once background model work may go.
    await import('../delivery/judge-run.ts').then(module => module.retryWaitingJudges(deps, ctx)).catch(() => 0);
    await runRoutines(deps, ctx).catch(() => 0);
    // C7: events the owner's relay brought in, while Chausar is open: confirmed, then drafted by their triggers.
    await import('../build/event-triggers.ts').then(module => module.eventTick(deps, ctx, (routine, facts, dueAt) => runEventTrigger(deps, ctx, routine, facts, dueAt))).catch(() => 0);
  } finally {
    SWEEPING.delete(store);
  }
}

// ---------------------------------------------------------------------------
// Today: one card per parked run
// ---------------------------------------------------------------------------

const runOfSubject = (subject: string) => subject.slice('routine:'.length);

/** Where a run's answer goes, in words: the agent's chat, or the routine's chat with Chausar. */
function whereWords(state: State, venture: VentureRecord, routine: RoutineRecord): string {
  return routine.agent === null ? `your ${routine.name} chat with Chausar` : `${askedName(state, venture, routine.agent)}'s chat`;
}

/**
 * The open business's routine cards: every parked run of a routine the owner set, still inside its 24 hours, oldest
 * first. Today's row meta gives each its real expiry, 24 hours after it parked (views/row-meta.ts).
 */
export function routineRows(deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const nowMs = deps.clock().getTime();
  const routines = new Map(listRecords(state, 'venture-routine', venture.id).map(routine => [routine.id, routine]));
  const rows: W4RowItem[] = [];
  for (const run of listRecords(state, 'venture-routine-run', venture.id)) {
    const routine = routines.get(run.routineId);
    if (run.state !== 'needs-input' || !routine || routine.removedAt !== null || routine.setBy !== 'owner' || Date.parse(parkedAt(run)) + ANSWER_MS <= nowMs) continue;
    const who = askedName(state, venture, routine.agent);
    const approve: QueueAction = { id: 'approve', label: 'Run it', primary: true, secondAsk: true };
    rows.push({
      kind: 'proposal', subject: `routine:${run.id}`, version: routine.recordReport?digest({run:run.id,routine}):run.parkedAt?`${run.id}-${run.parkedAt}`:run.id, createdAt: parkedAt(run), title: `${routine.name} is due`, agent: who,
      line: `It asks ${who}: "${short(routine.prompt, 240)}" The answer goes to ${whereWords(state, venture, routine)}. Nothing changes until you approve.`,
      actions: [{ id: 'deny', label: 'Not now', primary: false }, approve],
    });
  }
  return rows;
}

/** The pinned chat with Chausar a chief routine answers into, made the first time it runs. */
function routineThread(tx: VentureTx, routine: RoutineRecord): ChiefThreadRecord {
  const found = tx.list('venture-chief-thread').find(thread => thread.routine === routine.id);
  return found ?? tx.put<ChiefThreadRecord>({ ...tx.base('venture-chief-thread'), title: routine.name, pinned: true, routine: routine.id, lastAt: tx.now });
}

/** Codes that leave a run waiting: nothing was sent, and the owner can fix the cause and run it again. */
const STAYS_WAITING = new Set(['CLIENT_AI_CONSENT_REQUIRED', 'CHAT_CONSENT_REQUIRED', 'CHAT_CONSENT_STALE', 'APP_APPROVAL_REQUIRED', 'BUSINESS_PAUSED', 'CHAT_KEY_REFUSED', 'ROUTINE_NEEDS_CHECK']);

/**
 * A decision on a routine card (views/queue-w4.ts): Not now skips the run; Run it checks the AI connection again
 * (ROUTINE_NEEDS_CHECK leaves it waiting), claims it, then sends the prompt as a routine message, so the chat consent,
 * the key screen and every gate apply as they do to anything typed. The run is delivered once the answer is in the chat.
 */
export async function decideRoutine(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const runId = runOfSubject(decision.subject);
  if (decision.action === 'deny') {
    return ventureAction(deps, ctx, 'approve', 'routines.notNow', tx => {
      const run = tx.find('venture-routine-run', runId);
      check(run && run.state === 'needs-input', 'APPROVAL_STALE', 'This changed since you opened it.');
      tx.replace<RoutineRunRecord>({ ...run, state: 'skipped', line: ROUTINE_WORDS.notNow });
      return { line: ROUTINE_WORDS.notNow };
    });
  }
  check(decision.action === 'approve', 'INVALID_VENTURE_REQUEST', 'This card does not offer that.');
  // 4J7 (K7): the AI the prompt goes to must be one Check connections has looked at, read again now, before the claim.
  const before = deps.store.read();
  const venture = currentVenture(before);
  const route = chatRoute(deps.models.status(ctx));
  const pending=listRecords(before,'venture-routine-run',venture?.id).find(r=>r.id===runId),routine=pending?listRecords(before,'venture-routine',venture?.id).find(r=>r.id===pending.routineId):null;
  if (venture && route&&!routine?.recordReport) requireConnectorChecked(before, venture.id, `model:${route.presetId}`);
  // W6 6G5 (D44): a run that would pass the owner's cap is refused before it starts, with the reason; nothing is sent
  // and the card keeps waiting, so the owner can raise the limit and run it.
  if (venture && routine && !routine.recordReport && keyedPreset(route?.presetId)) {
    const over = routineStartRefusal(before, venture, routine, deps.clock().toISOString());
    if (over) throw routineCapError(over);
  }
  // C7: a plan the tool reported used up, or at or over the owner's pause point, holds the run before anything is sent,
  // unless a usable backup AI (agents/routine-backup.ts) can take it.
  // C7: a trigger's run carries a client's facts only with that client's AI permission; it stays waiting without it.
  if (venture && pending?.clientId) requireClientAiConsent(before, venture.id, pending.clientId);
  const planCli = routine && !routine.recordReport ? planCliOf(route?.presetId) : null;
  const backups = venture && routine && !routine.recordReport && pending ? usableBackups(deps, ctx, before, venture, pending) : { routes: [], refusal: null };
  const held = venture && planCli ? planHold(deps, venture, planCli) : null;
  if (held && !backups.routes.length) {
    if (backups.refusal) throw new ChausarError('CLIENT_AI_CONSENT_REQUIRED', backups.refusal);
    return parkForPlan(deps, ctx, runId, 'needs-input', planCli!, held.resetsAt);
  }
  // The AIs this run may go to, in order: the main one (unless its plan holds it), then each usable backup.
  const tries: (ChatRoute | null)[] = held ? backups.routes : [null, ...backups.routes];
  let why: string | null = held ? 'AI_USAGE_LIMIT' : null;
  // Marked as this process's own before the claim commits, so a sweep in between never takes it for a crash.
  MAKING.add(runId);
  try {
    const claimed = await ventureAction(deps, ctx, 'approve', 'routines.run', tx => {
      const run = tx.find('venture-routine-run', runId);
      check(run && run.state === 'needs-input' && Date.parse(parkedAt(run)) + ANSWER_MS > Date.parse(tx.now), 'APPROVAL_STALE', 'This changed since you opened it.');
      const routine = tx.find('venture-routine', run.routineId);
      check(routine && routine.removedAt === null && routine.setBy === 'owner', 'APPROVAL_STALE', 'This routine was removed.');
      const threadId = routine.agent === null ? routineThread(tx, routine).id : null;
      tx.replace<RoutineRunRecord>({ ...run, state: 'running', line: ROUTINE_WORDS.running, threadId });
      return { routine, threadId, where: whereWords(tx.state, tx.venture!, routine), text: run.filled ?? routine.prompt, draftOnly: routine.schedule.kind === 'event' };
    });
    const end = (state: RoutineRunState, line: string) => ventureAction(deps, ctx, 'approve', 'routines.ran', tx => {
      const run = tx.find('venture-routine-run', runId);
      if (run?.state === 'running') tx.replace<RoutineRunRecord>({ ...run, state, line });
    });
    try {
      if(claimed.routine.recordReport){
        const {vaRecordReport}=await import('../playbooks/virtual-assistant/routines.ts');
        const report=await vaRecordReport(deps,ctx,claimed.routine.recordReport==='va-morning'?'morning':'weekly');
        await ventureAction(deps,ctx,'approve','routines.recordReport',tx=>{
          const current=tx.find('venture-routine',claimed.routine.id),run=tx.find('venture-routine-run',runId);
          check(current?.on&&current.removedAt===null&&digest(current)===digest(claimed.routine)&&run?.state==='running'&&tx.state.revision===report.revision,'APPROVAL_STALE','The routine or source records changed. Review it again.');
          check(claimed.threadId,'INVALID_VENTURE_REQUEST','A private report needs its owner chat.');
          const message=appendChiefMessage(tx,{threadId:claimed.threadId,from:'chief',author:'engine',text:report.text||'No saved records in this report window.',receiptIds:[...new Set(report.lines.flatMap(line=>line.receiptIds))]});
          tx.replace({...message,recordReport:true});
          tx.emit('chief.message',{threadId:claimed.threadId,messageId:message.id});
        });
      } else {
        for (let index = 0; ; index++) {
          const backup = tries[index] ?? null;
          const scope = { routineId: claimed.routine.id, runId, ...(backup ? { presetId: backup.presetId } : {}), ...(claimed.draftOnly ? { draftOnly: true as const } : {}) };
          try {
            if (claimed.threadId) {
              const { threadSendHandler } = await import('../chief/threads.ts');
              const threadId = claimed.threadId;
              await withRoutineScope(scope, () => threadSendHandler(deps, ctx, { threadId, text: claimed.text }, { routine: true }));
            } else {
              const { threadSendHandler } = await import('./threads.ts');
              await withRoutineScope(scope, () => threadSendHandler(deps, ctx, { agent: claimed.routine.agent, text: claimed.text }, { routine: true }));
            }
            if (backup) await noteRanOn(deps, ctx, runId, backup, route ? shortName(route) : 'Your AI', why ?? 'AI_UNAVAILABLE');
            break;
          } catch (error) {
            const code = (error as { code?: unknown } | null)?.code;
            // C7: the main AI refused before anything reached it: the next usable backup takes the run.
            if (typeof code === 'string' && RUN_ELSEWHERE.has(code) && index + 1 < tries.length) {
              if (backup === null) { why = code; if (code === 'AI_USAGE_LIMIT' && planCli) planBookOf(deps.store).failed(planCli, 'usage-limit', deps.clock().toISOString()); }
              continue;
            }
            throw error;
          }
        }
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      // C7: a used-up plan the tool named waits for the reset instead of failing the run.
      if (code === 'AI_USAGE_LIMIT' && planCli && venture) {
        planBookOf(deps.store).failed(planCli, 'usage-limit', deps.clock().toISOString());
        const reading = planBookOf(deps.store).read(planCli, deps.clock().toISOString());
        return await parkForPlan(deps, ctx, runId, 'running', planCli, latestReset(reading.windows.filter(window => window.state === 'used-up')));
      }
      const why = error instanceof Error ? error.message : 'Chausar could not send it.';
      await (STAYS_WAITING.has(typeof code === 'string' ? code : '') ? end('needs-input', ROUTINE_WORDS.waiting) : end('failed', ROUTINE_WORDS.failed(why))).catch(() => undefined);
      throw error;
    }
    const line = ROUTINE_WORDS.delivered(claimed.where);
    await end('completed', line);
    return { line };
  } finally {
    // Only once the run's end is written: until then a sweep must still read it as this process's own.
    MAKING.delete(runId);
  }
}

// ---------------------------------------------------------------------------
// C7: waiting for the AI plan
// ---------------------------------------------------------------------------

const latestReset = (windows: readonly { resetsAt: IsoTime | null }[]): IsoTime | null =>
  windows.reduce<IsoTime | null>((latest, window) => window.resetsAt !== null && (latest === null || window.resetsAt > latest) ? window.resetsAt : latest, null);

/** Whether the plan meter holds a run now: used up, or a window at or over the owner's pause point. Unknown never holds. */
function planHold(deps: VentureDeps, venture: VentureRecord, cli: DelegateCli): { resetsAt: IsoTime | null } | null {
  const reading = planBookOf(deps.store).read(cli, deps.clock().toISOString());
  let pause: number | null = null;
  try { pause = agentSettingsOf(deps.store.read(), venture.id).planPause ?? null; } catch { pause = null; }
  const over = reading.windows.filter(window => window.state === 'used-up' || pause !== null && window.usedPercent !== null && window.usedPercent >= pause);
  if (!over.length && reading.state !== 'used-up') return null;
  return { resetsAt: latestReset(over) };
}

/** Parks a run as queued until the plan resets, with the line that says when; nothing was sent. */
function parkForPlan(deps: VentureDeps, ctx: Context, runId: string, from: RoutineRunState, cli: DelegateCli, resetsAt: IsoTime | null): Promise<W4Outcome> {
  return ventureAction(deps, ctx, 'approve', 'routines.planWait', tx => {
    const run = tx.find('venture-routine-run', runId);
    check(run && run.state === from, 'APPROVAL_STALE', 'This changed since you opened it.');
    const zone = ownerZone(tx.venture!.country?.code, 'UTC'), tool = CLI_LABELS[cli];
    const line = resetsAt === null ? ROUTINE_WORDS.planLater(tool) : ROUTINE_WORDS.planReset(tool, formatTime(resetsAt, zone));
    tx.replace<RoutineRunRecord>({ ...run, state: 'queued', line, waitsFor: { cli, resetsAt }, waitingSince: tx.now });
    tx.emit('queue.changed', {});
    return { line };
  });
}

// ---------------------------------------------------------------------------
// C7: the backup AI for routines
// ---------------------------------------------------------------------------

/**
 * The backups this run may take now: on, consented, not used up, and for a run that carries a client's data only when
 * that client agreed while the backup was already connected (else refusal says so and none is usable).
 */
function usableBackups(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, run: RoutineRunRecord): { routes: ChatRoute[]; refusal: string | null } {
  const status = deps.models.status(ctx);
  const routes = routineRoutes(status, venture).slice(1).filter(route => usableBackup(deps, state, venture, route));
  if (!run.clientId) return { routes, refusal: null };
  const allowed = routes.filter(route => clientAllowsBackup(state, venture, run.clientId!, status, route.presetId));
  return { routes: allowed, refusal: routes.length && !allowed.length ? BACKUP_WORDS.clientBefore : null };
}

/** Writes on the run which AI it ran on and why, in owner words. */
function noteRanOn(deps: VentureDeps, ctx: Context, runId: string, backup: ChatRoute, main: string, code: string): Promise<void> {
  return ventureAction(deps, ctx, 'approve', 'routines.ranOn', tx => {
    const run = tx.find('venture-routine-run', runId);
    if (run) tx.replace<RoutineRunRecord>({ ...run, ranOn: { presetId: backup.presetId, label: shortName(backup), why: BACKUP_WORDS.ranOn(shortName(backup), main, code) } });
  });
}

/** An AI's short name for a line: "Codex" or "Claude Code" for the tools, else the preset's label. */
function shortName(route: ChatRoute): string {
  const cli = planCliOf(route.presetId);
  return cli ? CLI_LABELS[cli] : route.label;
}

// ---------------------------------------------------------------------------
// C7: a trigger's run
// ---------------------------------------------------------------------------

/**
 * One run of a trigger for one confirmed event. Setting the trigger up was the owner's approval of exactly which facts each
 * event sends, so it goes to the AI with no second Run it, with its blanks filled by code, and only drafts. Without the
 * client's AI permission it waits on Today instead. A used-up plan waits for the reset; anything else is one failed run.
 */
export async function runEventTrigger(deps: VentureDeps, ctx: Context, routine: RoutineRecord, facts: EventFacts, dueAt: IsoTime): Promise<void> {
  const filled = fillBlanks(routine.prompt, facts);
  const state = deps.store.read(), venture = currentVenture(state);
  let allowed = !facts.clientId;
  if (venture && facts.clientId) { try { requireClientAiConsent(state, venture.id, facts.clientId); allowed = true; } catch { allowed = false; } }
  const claimed = await ventureAction(deps, ctx, 'prepare', 'routines.event', tx => {
    const threadId = routine.agent === null ? routineThread(tx, routine).id : null;
    const run = tx.put<RoutineRunRecord>({ ...tx.base('venture-routine-run'), routineId: routine.id, dueAt, state: allowed ? 'running' : 'needs-input', line: allowed ? ROUTINE_WORDS.running : EVENT_WORDS.needsClient(facts.client), missed: 0, runId: null, threadId, clientId: facts.clientId, filled });
    if (allowed) MAKING.add(run.id); else tx.emit('queue.changed', {});
    return { id: run.id, threadId, where: whereWords(tx.state, tx.venture!, routine) };
  });
  if (!allowed) return;
  const end = (next: RoutineRunState, line: string) => ventureAction(deps, ctx, 'prepare', 'routines.eventRan', tx => {
    const run = tx.find('venture-routine-run', claimed.id);
    if (run?.state === 'running') tx.replace<RoutineRunRecord>({ ...run, state: next, line });
    tx.emit('queue.changed', {});
  });
  const scope = { routineId: routine.id, runId: claimed.id, draftOnly: true as const };
  try {
    if (claimed.threadId) {
      const { threadSendHandler } = await import('../chief/threads.ts');
      const threadId = claimed.threadId;
      await withRoutineScope(scope, () => threadSendHandler(deps, ctx, { threadId, text: filled }, { routine: true }));
    } else {
      const { threadSendHandler } = await import('./threads.ts');
      await withRoutineScope(scope, () => threadSendHandler(deps, ctx, { agent: routine.agent, text: filled }, { routine: true }));
    }
    await end('completed', ROUTINE_WORDS.delivered(claimed.where));
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    const planCli = planCliOf(chatRoute(deps.models.status(ctx))?.presetId);
    if (code === 'AI_USAGE_LIMIT' && planCli) {
      planBookOf(deps.store).failed(planCli, 'usage-limit', deps.clock().toISOString());
      await parkForPlan(deps, ctx, claimed.id, 'running', planCli, null).catch(() => undefined);
    } else if (STAYS_WAITING.has(typeof code === 'string' ? code : '')) await end('needs-input', ROUTINE_WORDS.waiting).catch(() => undefined);
    else await end('failed', ROUTINE_WORDS.failed(error instanceof Error ? error.message : 'Chausar could not send it.')).catch(() => undefined);
  } finally { MAKING.delete(claimed.id); }
}
