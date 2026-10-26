// Chausar venture launcher, delivery (Ink v2 wave 4, package 4J13; catalogue H34): leases on runs. An approved call
// that goes out holds a renewable lease on its run, written before the call is claimed: a dated recheck with a reason,
// renewed while this engine process works on it, never a cron line. A second approval meanwhile finds the run held.
// If the engine dies, nobody renews the lease: at the next sweep (always when a vault opens, since nothing of the new
// process is in flight then) the run goes back to waiting, stopped with "Interrupted: Chausar stopped while this ran.
// Nothing was sent again.". The call it covered is never sent again: the model port claims each approved call once,
// and the journal sweep marks its entry as outcome_unknown. Each step's state survives: the stored calls (done, error,
// skipped), then what each started step of the cut turn had reached (running, done, error) from its run.call events;
// the finished steps stay as they were stored, and Resume (4F1) asks for the next turn afresh from there. The idea is DurableJobRunner's lease (platform/runtime/job-runner.ts), rebuilt here.
import { ChausarError, newId, type Context, type State } from '../../contracts.ts';
import { currentVenture, listRecords, ventureAction, type VentureTx } from '../records.ts';
import type { DeliveryRunRecord, HarnessState, RunInterruption, RunLease, RunStepState, VentureDeps } from '../contracts.ts';
import { noteWrite } from '../journal/chain.ts';

/** How long a lease lasts without a renewal. */
export const LEASE_MS = 2 * 60_000;
/** How often the holder renews it, well inside its time. */
export const LEASE_RENEW_MS = 40_000;
/** Why the run is held, as the lease says it. */
export const LEASE_REASON = 'An approved step is out with your AI.';
/** The run's line once a lease ran out under it. */
export const INTERRUPTED_LINE = 'Interrupted: Chausar stopped while this ran. Nothing was sent again.';
const HELD_LINE = 'This step is already running. Wait for it to come back.';

/** This engine process. A lease names the process that took it; another process never renews it. */
export const LEASE_HOLDER = newId('engine');
/** The leases this process holds now, by token: only these are renewed and only these are alive for sure. */
const LIVE = new Set<string>();

/** Whether this process holds the lease now. */
export function heldHere(lease: Pick<RunLease, 'token' | 'holder'>): boolean {
  return lease.holder === LEASE_HOLDER && LIVE.has(lease.token);
}

/**
 * Whether a lease is dead: no live holder in this process, and its time ran out, or it was taken longer ago than
 * claimLimitMs (1 when a vault opens: nothing of this process was in flight then, so every older lease is dead).
 */
export function leaseDead(lease: RunLease, nowMs: number, claimLimitMs: number = Number.POSITIVE_INFINITY): boolean {
  if (heldHere(lease)) return false;
  return Date.parse(lease.expiresAt) <= nowMs || Date.parse(lease.takenAt) + claimLimitMs <= nowMs;
}

/** What the lease-taking caller holds: release ends it (stops renewing and removes it from the run). Never throws. */
export type LeaseHandle = { token: string; release: () => Promise<void> };

/**
 * Takes the lease on a run waiting for approval of callId, before the call is claimed. Refuses DELIVERY_NOT_WAITING
 * when the run no longer waits on that call, or another live lease holds it. Renews itself until released.
 */
export async function takeRunLease(deps: VentureDeps, ctx: Context, runId: string, callId: string): Promise<LeaseHandle> {
  const token = newId('lease');
  await ventureAction(deps, ctx, 'approve', 'run.lease', tx => {
    const current = tx.find('venture-delivery-run', runId);
    if (!current || current.status !== 'waiting-for-you' || current.callId !== callId) {
      throw new ChausarError('DELIVERY_NOT_WAITING', 'This draft reply is not waiting for your approval.');
    }
    if (current.lease && !leaseDead(current.lease, Date.parse(tx.now))) throw new ChausarError('DELIVERY_NOT_WAITING', HELD_LINE);
    const lease: RunLease = { holder: LEASE_HOLDER, token, callId, takenAt: tx.now, expiresAt: new Date(Date.parse(tx.now) + LEASE_MS).toISOString(), reason: LEASE_REASON };
    tx.replace<DeliveryRunRecord>({ ...current, lease });
  });
  LIVE.add(token);
  const renew = () => ventureAction(deps, ctx, 'approve', 'run.lease.renew', tx => {
    const current = tx.find('venture-delivery-run', runId);
    if (current?.lease?.token !== token) return;
    tx.replace<DeliveryRunRecord>({ ...current, lease: { ...current.lease, expiresAt: new Date(Date.parse(tx.now) + LEASE_MS).toISOString() } });
  }).catch(() => undefined);
  const timer = setInterval(() => { void renew(); }, LEASE_RENEW_MS);
  timer.unref?.();
  let released = false;
  return {
    token,
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      LIVE.delete(token);
      await ventureAction(deps, ctx, 'approve', 'run.lease.release', tx => {
        const current = tx.find('venture-delivery-run', runId);
        if (current?.lease?.token === token) tx.replace<DeliveryRunRecord>({ ...current, lease: null });
      }).catch(() => undefined);
    },
  };
}

/** Runs work while holding the run's lease, and releases it however the work ends. */
export async function withRunLease<T>(deps: VentureDeps, ctx: Context, runId: string, callId: string, work: () => Promise<T>): Promise<T> {
  const lease = await takeRunLease(deps, ctx, runId, callId);
  try {
    return await work();
  } finally {
    await lease.release();
  }
}

/** The last state each step of a turn reached, from its run.call events (delivery/harness/controls.ts callProgress). */
export function turnSteps(state: State, ventureId: string, runId: string, modelCallId: string): RunInterruption['steps'] {
  const steps = new Map<string, RunInterruption['steps'][number]['state']>();
  const events = listRecords(state, 'venture-event', ventureId).filter(event => event.name === 'run.call').sort((a, b) => a.seq - b.seq);
  for (const event of events) {
    const data = event.data as { runId?: unknown; callId?: unknown; state?: unknown; modelCallId?: unknown } | null;
    if (!data || data.runId !== runId || data.modelCallId !== modelCallId || typeof data.callId !== 'string') continue;
    steps.set(data.callId, data.state === 'done' ? 'done' : data.state === 'error' ? 'error' : 'running');
  }
  return [...steps].map(([callId, state]) => ({ callId, state }));
}

/** Every step state of an interrupted run: its stored calls first, then the cut turn's (contracts.ts RunInterruption). */
function runSteps(state: State, run: DeliveryRunRecord, modelCallId: string): RunInterruption['steps'] {
  const stored = (run.harness?.toolCalls ?? []).map(call => ({
    callId: call.id, state: (call.outcome === 'succeeded' ? 'done' : call.outcome === 'cancelled' ? 'skipped' : 'error') as RunStepState,
  }));
  const known = new Set(stored.map(step => step.callId));
  return [...stored, ...turnSteps(state, run.ventureId, run.id, modelCallId).filter(step => !known.has(step.callId))];
}

/**
 * Marks a preview nobody claimed as expired, inside the caller's transaction, so the model port refuses to send it (it
 * claims only previews). The write is noted for the journal chain like any tx.replace (journal/chain.ts). The one helper
 * for this: run controls (run-controls.ts) and lease recovery both use it.
 */
export function voidPreview(tx: VentureTx, callId: string | null): void {
  if (!callId) return;
  const index = tx.state.conversations.findIndex((record: { id?: unknown; kind?: unknown } | null) => record?.id === callId && record?.kind === 'venture-model-call');
  const call = tx.state.conversations[index] as { status?: unknown } | undefined;
  if (index < 0 || call?.status !== 'preview') return;
  tx.state.conversations[index] = { ...tx.state.conversations[index], status: 'expired' };
  noteWrite(tx.state, callId);
}

/**
 * At a sweep (agents/routine-runner.ts, run with the journal sweep): every run of the open business whose lease is dead.
 * A run still waiting on the call its lease covered is stopped with the interrupted line, its steps' states kept; a run
 * that already moved on only loses the stale lease. One transaction each. Returns the ids of the runs it interrupted.
 */
export async function recoverLeases(deps: VentureDeps, ctx: Context, claimLimitMs?: number): Promise<string[]> {
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return [];
  const nowMs = deps.clock().getTime();
  const dead = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.lease && leaseDead(run.lease, nowMs, claimLimitMs));
  const interrupted: string[] = [];
  for (const run of dead) {
    const outcome = await ventureAction(deps, ctx, 'prepare', 'run.lease.recover', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      const lease = current?.lease;
      if (!current || !lease || lease.token !== run.lease!.token || !leaseDead(lease, Date.parse(tx.now), claimLimitMs)) return false;
      if (current.status !== 'waiting-for-you' || current.callId !== lease.callId) {
        tx.replace<DeliveryRunRecord>({ ...current, lease: null });
        return false;
      }
      // Never sent again: a preview the dead process had not claimed yet is voided; a claimed one stays claimed.
      voidPreview(tx, current.callId);
      const stop = { stop: { at: tx.now, by: 'chausar', force: false }, stoppedAt: tx.now, line: INTERRUPTED_LINE };
      const harness: HarnessState | null | undefined = current.harness
        ? { ...current.harness, control: stop, ...(current.harness.gate ? { gate: { ...current.harness.gate, waiting: null } } : {}) }
        : current.harness;
      const record: RunInterruption = { at: tx.now, line: INTERRUPTED_LINE, callId: lease.callId, steps: runSteps(tx.state, current, lease.callId) };
      tx.replace<DeliveryRunRecord>({ ...current, status: 'stopped', callId: null, preview: null, harness, lease: null, interrupted: record });
      tx.emit('run.stopped', { runId: current.id });
      tx.emit('run.step', { runId: current.id });
      return true;
    }).catch(() => false);
    if (outcome) interrupted.push(run.id);
  }
  return interrupted;
}
