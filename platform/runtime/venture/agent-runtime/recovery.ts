/** Vault-open recovery never resumes a native AI session or repeats an outside effect. */
import type { Context } from '../../contracts.ts';
import type { DeliveryRunRecord, VentureDeps } from '../contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../records.ts';
import { hasAgentJob } from './lifecycle.ts';
import { hasAgentWork } from './runner.ts';

const INTERRUPTED = 'Interrupted: Chausar stopped while this ran. Nothing was sent again.';
function unfinished(run: DeliveryRunRecord): boolean {
  return !!run.agentJob && !run.agentJob.pendingFacts && (run.status === 'waiting-for-you'
    || run.status === 'ready-for-review' && !run.agentJob.reviewReady);
}
export async function recoverNativeJobs(deps: VentureDeps, ctx: Context): Promise<void> {
  const venture = currentVenture(deps.store.read());
  if (!venture) return;
  const live = (id: string) => hasAgentJob(deps.store, id) || hasAgentWork(deps.store, id);
  for (const run of listRecords(deps.store.read(), 'venture-delivery-run', venture.id)) {
    if (!unfinished(run) || live(run.id)) continue;
    await ventureAction(deps, ctx, 'prepare', 'agent.job.recover', tx => {
      const current = tx.find('venture-delivery-run', run.id);
      if (!current || !unfinished(current) || live(current.id)) return;
      const job = { ...current.agentJob! };
      delete job.pendingApproval;
      tx.replace({ ...current, status: 'stopped', callId: null, preview: null, agentJob: job,
        interrupted: { at: tx.now, line: INTERRUPTED, callId: job.scope.jobId,
          steps: job.tools.map(tool => ({ callId: tool.id, state: tool.status === 'done' ? 'done' as const : 'error' as const })) } });
      tx.emit('run.stopped', { runId: current.id });
      tx.emit('run.step', { runId: current.id });
      tx.emit('queue.changed', {});
    });
  }
}
