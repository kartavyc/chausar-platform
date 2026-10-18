// Chausar hosted tier: key-only model routes. The hosted transport wraps the real HTTPS transport (or a synthetic
// recording in the demo and in tests) with three gates, all checked before anything leaves the server: the account's
// monthly AI ceiling (a BigInt sum of costs the model port already recorded), a per-account rate, and at most a few
// calls at once per account. It never starts a process: command-line tools run only in the desktop app.
import { ChausarError } from '../contracts.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelTransport } from '../venture/contracts.ts';
import { AVAILABILITY_REASONS } from '../venture/models/presets.ts';
import { formatMicros } from '../venture/records.ts';
import { checkMonthlyCeiling, monthOf, type ConcurrencyGate, type RateLimiter, type UsageEntry } from './limits.ts';

export type HostedTransportOptions = {
  tenantId: string;
  inner: ModelTransport;
  usage: () => readonly UsageEntry[];
  ceilingMicros: string;
  rate: RateLimiter;
  gate: ConcurrencyGate;
  clock: () => Date;
  /** Called once a call is about to leave, so the server reads the recorded cost into the account ledger afterwards. */
  dispatched: () => void;
};

export function hostedModelTransport(options: HostedTransportOptions): ModelTransport {
  return Object.freeze({
    replay: options.inner.replay === true,
    async http(request: ModelHttpRequest): Promise<ModelHttpResponse> {
      checkMonthlyCeiling(options.usage(), monthOf(options.clock().toISOString()), options.ceilingMicros, micros => formatMicros(micros));
      options.rate.take(options.tenantId, 'This account made many AI calls in the last minute. Wait a moment and try again.');
      return options.gate.run(options.tenantId, async () => {
        options.dispatched();
        return options.inner.http(request);
      });
    },
    async process(): Promise<never> {
      throw new ChausarError('PRESET_UNAVAILABLE', AVAILABILITY_REASONS.hostedCli);
    },
  });
}

/** New ledger entries from a business's recorded calls: finished calls with a cost, not already in the ledger. */
export function usageFromCalls(businessId: string, calls: readonly { id: string; at: string; status: string; costMicros: string | null }[], known: readonly UsageEntry[]): UsageEntry[] {
  const seen = new Set(known.map(entry => entry.callId));
  return calls
    .filter(call => (call.status === 'completed' || call.status === 'failed') && typeof call.costMicros === 'string' && /^\d{1,18}$/.test(call.costMicros) && !seen.has(call.id))
    .map(call => ({ callId: call.id, businessId, month: monthOf(call.at), costMicros: call.costMicros as string, at: call.at }));
}
