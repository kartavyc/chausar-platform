// One model preset budget, including body-free session calls. Linked ordinary spend rows are never counted twice.
import type { ModelCallRecord, SpendRecord } from '../contracts.ts';
import { countedMicros } from '../money/spend.ts';
import { recordedCallMicros } from './cost.ts';

/** Unanswered sent calls stay held by their spend row; never-sent released rows count nothing. */
export function modelBudgetUsed(calls: readonly ModelCallRecord[], spends: readonly SpendRecord[], presetId: string, month: string): bigint {
  let total = 0n;
  const linked = new Map(calls.map(call => [call.id, call]));
  for (const call of calls) {
    if (call.presetId !== presetId) continue;
    if (call.status === 'dispatching') total += BigInt(call.estimatedMaxCostMicros);
    else if (call.at.slice(0, 7) === month) {
      const micros = recordedCallMicros(call);
      if (micros !== null) total += BigInt(micros);
    }
  }
  for (const row of spends) {
    if (row.item !== 'model:' + presetId) continue;
    const call = row.ref ? linked.get(row.ref) : undefined;
    if (call && !(row.phase === 'unknown' && call.status !== 'dispatching' && recordedCallMicros(call) === null)) continue;
    if (row.phase === 'reserved' || row.phase === 'unknown' || row.at.slice(0, 7) === month) total += BigInt(countedMicros(row));
  }
  return total;
}
