/**
 * The sweep of delivery runs when a vault opens (build/journal-sweep.ts): every run lands in one definite state, and no
 * native AI session is resumed and no outside effect is repeated. Nothing of this process was in flight when the
 * vault opened, so a run whose AI job reads as alive ('working' or 'finishing') has no session any more: it is
 * interrupted, whether its job had opened or not, with how far each step got (run-machine.ts interrupt). A run an
 * older build stored is written back once as a run of today (normaliseRun reads it; this stores it). A stopped run
 * that a newer job of its order replaced is marked superseded, for data written before that was stored. One
 * transaction, and only when something has to change.
 */
import type { Context } from '../../contracts.ts';
import type { DeliveryRunRecord, VentureDeps } from '../contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../records.ts';
import { interrupt, jobAlive, RUN_LIFECYCLE, supersede, superseded, toolSteps } from '../delivery/run-machine.ts';
import { hasAgentJob } from './lifecycle.ts';
import { hasAgentWork } from './runner.ts';

type Stored = { id: string; kind?: unknown; lifecycle?: unknown } | null;

/** Returns the ids of the runs it interrupted. */
export async function recoverRuns(deps: VentureDeps, ctx: Context): Promise<string[]> {
  const venture = currentVenture(deps.store.read());
  if (!venture) return [];
  const live = (id: string) => hasAgentJob(deps.store, id) || hasAgentWork(deps.store, id);
  const cut = (run: DeliveryRunRecord) => jobAlive(run) && !live(run.id);
  /** What has to change: the runs to interrupt, the stopped runs a newer run of their order replaced, the runs still in an older shape. */
  const plan = (conversations: readonly Stored[], runs: readonly DeliveryRunRecord[]) => {
    const newest = new Map<string, DeliveryRunRecord>();
    for (const run of runs) { const known = newest.get(run.orderId); if (!known || run.at >= known.at) newest.set(run.orderId, run); }
    const today = new Set(conversations.filter(record => record?.kind === 'venture-delivery-run' && record.lifecycle === RUN_LIFECYCLE).map(record => record!.id));
    return {
      cut: runs.filter(cut),
      replaced: runs.filter(run => !cut(run) && run.status === 'stopped' && !superseded(run) && newest.get(run.orderId)?.id !== run.id),
      older: runs.filter(run => !today.has(run.id)),
    };
  };
  const before = deps.store.read();
  const due = plan(before.conversations as Stored[], listRecords(before, 'venture-delivery-run', venture.id));
  if (!due.cut.length && !due.replaced.length && !due.older.length) return [];
  return ventureAction(deps, ctx, 'prepare', 'agent.job.recover', tx => {
    const now = plan(tx.state.conversations as Stored[], tx.list('venture-delivery-run'));
    const moved = new Set<string>();
    for (const run of now.cut) {
      tx.replace(interrupt(run, tx.now, 'interrupted', toolSteps(run)));
      tx.emit('run.stopped', { runId: run.id });
      tx.emit('run.step', { runId: run.id });
      moved.add(run.id);
    }
    for (const run of now.replaced) { tx.replace(supersede(run, tx.now)); moved.add(run.id); }
    // Read as a run of today; stored as one from now on.
    for (const run of now.older) if (!moved.has(run.id)) tx.replace(run);
    if (now.cut.length) tx.emit('queue.changed', {});
    return now.cut.map(run => run.id);
  }).catch(() => []);
}
