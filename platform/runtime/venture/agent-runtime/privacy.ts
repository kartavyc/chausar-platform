/** Erase tool-owned job copies; statutory invoice and price records follow their existing retention path. */
import type { VentureTx } from '../records.ts';
import type { DeliveryRunRecord } from '../contracts.ts';
import { removeRecords } from '../network/people.ts';

export function eraseAgentJobs(tx: VentureTx, clientIds: ReadonlySet<string>): string[] {
  for (const client of tx.list('venture-client')) if (clientIds.has(client.id) && client.aiConsent) {
    const { aiConsent: _consent, ...kept } = client; tx.replace(kept);
  }
  const orders = new Set(tx.list('venture-order').filter(order => clientIds.has(order.clientId)).map(order => order.id));
  const scopedRuns = tx.list('venture-delivery-run').filter(run => run.agentJob && orders.has(run.orderId));
  return eraseAgentJobRecords(tx, scopedRuns);
}

/** Accept pre-erasure snapshots so domain cleanup cannot discard links to private call payloads. */
export function eraseAgentJobRecords(tx: VentureTx, scopedRuns: readonly DeliveryRunRecord[]): string[] {
  const runs = new Set(scopedRuns.map(run => run.id));
  // Preserve the financial row, but erase opaque payloads while their run links still exist.
  const calls = new Set(scopedRuns.flatMap(run => [run.callId, run.preview?.callId, run.judge?.callId])
    .filter((id): id is string => typeof id === 'string'));
  const jobs = new Map(scopedRuns.map(run => [run.agentJob!.scope.jobId, run.agentJob!.scope.agentId]));
  for (const call of tx.list('venture-model-call')) {
    const boundQuality = call.purpose === 'judge' && call.agentJobId && jobs.has(call.agentJobId) && jobs.get(call.agentJobId) === call.agentId;
    if (!calls.has(call.id) && !boundQuality) continue;
    const texts = Object.fromEntries(Object.entries(call).filter(([key, value]) => key.endsWith('Text') && typeof value === 'string').map(([key]) => [key, '']));
    tx.replace({ ...call, ...texts, payloadText: '', error: call.error ? { ...call.error, message: '' } : null,
      ...(call.status === 'preview' ? { status: 'expired' as const } : {}), erasedAt: call.erasedAt ?? tx.now });
  }
  removeRecords(tx, record => {
    if (record.kind === 'venture-delivery-run') return typeof record.id === 'string' && runs.has(record.id);
    if (record.kind === 'venture-agent-message' || record.kind === 'venture-agent-proposal') return typeof record.runId === 'string' && runs.has(record.runId);
    if (record.kind === 'venture-work-receipt' || record.kind === 'venture-work-table') {
      const ref = record.runRef as { kind?: string; runId?: string } | undefined;
      return ref?.kind === 'delivery' && typeof ref.runId === 'string' && runs.has(ref.runId);
    }
    return false;
  });
  return [...runs];
}
