import type { State } from '../../contracts.ts';
import type { CheckResult, SignalRecord } from '../contracts.ts';
import { listRecords, type VentureTx } from '../records.ts';
import { firstFailedCheck } from './checks.ts';

/** One-shot C4 task 15: the business's signals, without those the owner took back. Every reader goes through this. */
export function liveSignals(state: State, ventureId: string): SignalRecord[] {
  return listRecords(state, 'venture-signal', ventureId).filter(signal => !signal.withdrawnAt);
}

export function recordCheckSignal(tx: VentureTx, runId: string, checks: readonly CheckResult[]) {
  const failed = firstFailedCheck(checks);
  if (!failed) return;
  const signal: SignalRecord = { ...tx.base('venture-signal'), source: 'check-failed', runId, reason: failed, scenarioId: null };
  tx.put(signal);
  tx.emit('signal-recorded', { signalId: signal.id, runId, source: signal.source, reason: failed });
}
