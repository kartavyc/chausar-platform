// Chausar hosted tier: rate and budget limits. Token buckets live in this process (a deploy with several server
// processes needs a shared store; docs/venture/hosted.md lists it). Money limits are BigInt sums of costs the model
// port already worked out in code; nothing here estimates or rounds a price.
import { ChausarError, check } from '../contracts.ts';

export type RateRule = { capacity: number; refillEveryMs: number };
type Bucket = { tokens: number; at: number };

/** One named family of token buckets: capacity tokens, one more every refillEveryMs, keyed by email, address or tenant. */
export class RateLimiter {
  readonly name: string;
  readonly rule: RateRule;
  #clock: () => number;
  #buckets = new Map<string, Bucket>();
  #maxKeys: number;

  constructor(name: string, rule: RateRule, clock: () => number = Date.now, maxKeys = 50000) {
    check(Number.isSafeInteger(rule.capacity) && rule.capacity >= 1 && Number.isSafeInteger(rule.refillEveryMs) && rule.refillEveryMs >= 1, 'INVALID_LIMIT', 'A rate limit needs a whole capacity and refill time.');
    this.name = name; this.rule = rule; this.#clock = clock; this.#maxKeys = maxKeys;
  }

  #bucket(key: string): Bucket {
    const now = this.#clock();
    let bucket = this.#buckets.get(key);
    if (!bucket) {
      if (this.#buckets.size >= this.#maxKeys) this.#sweep(now);
      bucket = { tokens: this.rule.capacity, at: now };
      this.#buckets.set(key, bucket);
      return bucket;
    }
    const earned = Math.floor((now - bucket.at) / this.rule.refillEveryMs);
    if (earned > 0) { bucket.tokens = Math.min(this.rule.capacity, bucket.tokens + earned); bucket.at += earned * this.rule.refillEveryMs; }
    if (bucket.tokens >= this.rule.capacity) bucket.at = now;
    return bucket;
  }

  #sweep(now: number) {
    for (const [key, bucket] of this.#buckets) if (bucket.tokens + Math.floor((now - bucket.at) / this.rule.refillEveryMs) >= this.rule.capacity) this.#buckets.delete(key);
    if (this.#buckets.size >= this.#maxKeys) this.#buckets.clear();
  }

  /** Takes one token or throws RATE_LIMITED with a plain wait. */
  take(key: string, message = 'Too many requests. Wait a little and try again.') {
    const bucket = this.#bucket(key);
    if (bucket.tokens < 1) {
      const waitMs = this.rule.refillEveryMs - (this.#clock() - bucket.at);
      throw Object.assign(new ChausarError('RATE_LIMITED', message), { retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) });
    }
    bucket.tokens -= 1;
  }

  remaining(key: string): number { return this.#bucket(key).tokens; }
}

/** At most `limit` jobs at once per key, for model calls that hold a provider connection open. */
export class ConcurrencyGate {
  #active = new Map<string, number>();
  readonly limit: number;
  constructor(limit: number) { check(Number.isSafeInteger(limit) && limit >= 1, 'INVALID_LIMIT', 'A concurrency limit must be a whole number.'); this.limit = limit; }

  async run<T>(key: string, work: () => Promise<T>, message = 'Another AI call for this account is still running. Try again when it finishes.'): Promise<T> {
    const active = this.#active.get(key) ?? 0;
    if (active >= this.limit) throw new ChausarError('RATE_LIMITED', message);
    this.#active.set(key, active + 1);
    try { return await work(); }
    finally {
      const left = (this.#active.get(key) ?? 1) - 1;
      if (left > 0) this.#active.set(key, left); else this.#active.delete(key);
    }
  }

  active(key: string): number { return this.#active.get(key) ?? 0; }
}

export type UsageEntry = { callId: string; businessId: string; month: string; costMicros: string; at: string };

/** 'YYYY-MM' of an ISO time, in UTC, by reading the text. */
export function monthOf(iso: string): string {
  check(typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(iso), 'INVALID_LIMIT', 'A usage entry needs an ISO time.');
  return iso.slice(0, 7);
}

/** Sum of one tenant's recorded AI costs in a month, in micro units, by BigInt addition. */
export function monthSpendMicros(entries: readonly UsageEntry[], month: string): bigint {
  let total = 0n;
  for (const entry of entries) if (entry.month === month) total += BigInt(entry.costMicros);
  return total;
}

/** Refuses a new AI call once this month's recorded spend has reached the account ceiling. */
export function checkMonthlyCeiling(entries: readonly UsageEntry[], month: string, ceilingMicros: string, display: (micros: string) => string) {
  check(/^\d{1,18}$/.test(ceilingMicros), 'INVALID_LIMIT', 'The monthly ceiling must be whole micro units.');
  const spent = monthSpendMicros(entries, month);
  check(spent < BigInt(ceilingMicros), 'BUDGET_REACHED',
    `Your account reached this server's monthly AI ceiling of ${display(ceilingMicros)} (spent ${display(String(spent))}). It resets on the first of the month, UTC.`);
}

/** The limits a hosted server applies. Every value is a plain number or micro string from config. */
export type HostedLimits = {
  magicLinkPerEmail: RateRule;
  magicLinkPerAddress: RateRule;
  authAttemptsPerAddress: RateRule;
  rpcPerSession: RateRule;
  modelCallsPerTenant: RateRule;
  githubSyncsPerTenant: RateRule;
  modelConcurrencyPerTenant: number;
  monthlyModelCeilingMicros: string;
  businessesPerAccount: number;
  passkeysPerAccount: number;
  sessionsPerAccount: number;
  awakeActors: number;
  actorIdleMs: number;
  maxBodyBytes: number;
};

const MINUTE = 60_000;
export const DEFAULT_LIMITS: Readonly<HostedLimits> = Object.freeze({
  magicLinkPerEmail: { capacity: 5, refillEveryMs: 12 * MINUTE },
  magicLinkPerAddress: { capacity: 20, refillEveryMs: 3 * MINUTE },
  authAttemptsPerAddress: { capacity: 30, refillEveryMs: 2 * MINUTE },
  rpcPerSession: { capacity: 120, refillEveryMs: 250 },
  modelCallsPerTenant: { capacity: 60, refillEveryMs: MINUTE },
  githubSyncsPerTenant: { capacity: 10, refillEveryMs: 3 * MINUTE },
  modelConcurrencyPerTenant: 2,
  monthlyModelCeilingMicros: '20000000',
  businessesPerAccount: 3,
  passkeysPerAccount: 10,
  sessionsPerAccount: 20,
  awakeActors: 200,
  actorIdleMs: 15 * MINUTE,
  maxBodyBytes: 262144,
});
