import type { CheckResult, SignalRecord } from '../contracts.ts';
import type { VentureTx } from '../records.ts';
import { firstFailedCheck } from './checks.ts';

export function recordCheckSignal(tx: VentureTx, runId: string, checks: readonly CheckResult[]) {
  const failed = firstFailedCheck(checks);
  if (!failed) return;
  const signal: SignalRecord = { ...tx.base('venture-signal'), source: 'check-failed', runId, reason: failed, scenarioId: null };
  tx.put(signal);
  tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason: failed });
}
