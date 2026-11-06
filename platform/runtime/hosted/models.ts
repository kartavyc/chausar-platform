// Chausar hosted tier: key-only model routes. The hosted transport wraps the real HTTPS transport (or a synthetic
// recording in the demo and in tests) with three gates, all checked before anything leaves the server: the account's
// monthly AI ceiling (a BigInt sum of costs the model port already recorded), a per-account rate, and at most a few
// calls at once per account. It never starts a process: command-line tools run only in the desktop app. A temporary
// business (4J23) has its own lower rate and ceiling, and a call of its leaves only on the owner's own key.
import { ChausarError } from '../contracts.ts';
import type { ModelHttpRequest, ModelHttpResponse, ModelTransport } from '../venture/contracts.ts';
import { AVAILABILITY_REASONS } from '../venture/models/presets.ts';
import { formatMicros } from '../venture/records.ts';
import { checkMonthlyCeiling, monthOf, type ConcurrencyGate, type RateLimiter, type UsageEntry } from './limits.ts';
import { TRIAL_KEY_LINE, carriesOwnKey } from './trial.ts';

export type HostedTransportOptions = {
  /** The account the rate and the "at once" gate count toward; a function is asked at each call (4J23: it can change). */
  tenantId: string | (() => string);
  inner: ModelTransport;
  usage: () => readonly UsageEntry[];
  ceilingMicros: string;
  rate: RateLimiter;
  gate: ConcurrencyGate;
  clock: () => Date;
  /** Called once a call is about to leave, so the server reads the recorded cost into the account ledger afterwards. */
  dispatched: () => void;
  /**
   * Ink v2 wave 4 (4J23): for a temporary business, its own rate and monthly ceiling; null once it is kept on an
   * account. Asked at each call. While it answers, a call must carry the owner's own key, or nothing leaves.
   */
  trial?: () => { rate: RateLimiter; ceilingMicros: string } | null;
};

export function hostedModelTransport(options: HostedTransportOptions): ModelTransport {
  return Object.freeze({
    replay: options.inner.replay === true,
    async http(request: ModelHttpRequest): Promise<ModelHttpResponse> {
      const trial = options.trial?.() ?? null;
      if (trial && !carriesOwnKey(request.headers)) throw new ChausarError('TRIAL_LIMIT', TRIAL_KEY_LINE);
      checkMonthlyCeiling(options.usage(), monthOf(options.clock().toISOString()), trial?.ceilingMicros ?? options.ceilingMicros, micros => formatMicros(micros), trial ? 'trial' : 'account');
      const tenantId = typeof options.tenantId === 'function' ? options.tenantId() : options.tenantId;
      (trial?.rate ?? options.rate).take(tenantId, trial ? 'This temporary business made many AI calls in the last minute. Wait a moment and try again.'
        : 'This account made many AI calls in the last minute. Wait a moment and try again.');
      return options.gate.run(tenantId, async () => {
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
