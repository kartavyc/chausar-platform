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

  /** How many keys (addresses, emails, sessions, tenants) this family holds now. */
  get size(): number { return this.#buckets.size; }

  /**
   * Forgets every key whose bucket has filled up again: it is the same as one never seen. Housekeeping calls it each
   * minute (app.ts), so an address is held no longer than its own window. Answers how many went.
   */
  sweep(): number {
    const now = this.#clock(), before = this.#buckets.size;
    for (const [key, bucket] of this.#buckets) if (bucket.tokens + Math.floor((now - bucket.at) / this.rule.refillEveryMs) >= this.rule.capacity) this.#buckets.delete(key);
    return before - this.#buckets.size;
  }
}

/**
 * The key a network address is limited by (Ink v2 wave 4, 4J23): an IPv4 address as it is (also when written as IPv6,
 * ::ffff:a.b.c.d), and an IPv6 address by its /64, the block one household or machine usually holds, so changing the
 * last 64 bits does not make a new network. Anything else is used as it came.
 */
export function addressKey(address: string): string {
  const text = address.trim().toLowerCase().replace(/%.*$/, '');
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (mapped) return mapped[1];
  if (!text.includes(':') || !/^[0-9a-f:.]+$/.test(text)) return text;
  const [head, tail = null, extra] = text.split('::');
  if (extra !== undefined) return text;
  const left = head ? head.split(':') : [];
  const right = tail === null ? [] : tail ? tail.split(':') : [];
  if (right.some(part => part.includes('.')) || left.some(part => part.includes('.'))) return text;
  const fill = tail === null ? 0 : 8 - left.length - right.length;
  if (fill < 0 || (tail === null && left.length !== 8)) return text;
  const groups = [...left, ...Array(fill).fill('0'), ...right];
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return text;
  return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
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

/**
 * Refuses a new AI call once this month's recorded spend has reached the account ceiling. A temporary business (Ink v2
 * wave 4, 4J23) has its own, lower one, and its words say how to leave it behind.
 */
export function checkMonthlyCeiling(entries: readonly UsageEntry[], month: string, ceilingMicros: string, display: (micros: string) => string, whose: 'account' | 'trial' = 'account') {
  check(/^\d{1,18}$/.test(ceilingMicros), 'INVALID_LIMIT', 'The monthly ceiling must be whole micro units.');
  const spent = monthSpendMicros(entries, month);
  check(spent < BigInt(ceilingMicros), 'BUDGET_REACHED', whose === 'trial'
    ? `This temporary business reached its monthly AI limit of ${display(ceilingMicros)} (spent ${display(String(spent))}). Add your email to keep it and use your account's limit.`
    : `Your account reached this server's monthly AI ceiling of ${display(ceilingMicros)} (spent ${display(String(spent))}). It resets on the first of the month, UTC.`);
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
  // Ink v2 wave 4 (4J23): businesses started without an account (trial.ts).
  /** New trials from one network address. */
  trialStartsPerAddress: RateRule;
  /** Trials alive on this server at once; past it, people sign in with an email to start. */
  trialsLive: number;
  /** A trial is deleted with its vault this long after its last use, unless claimed. */
  trialIdleMs: number;
  /** AI calls per trial, on the owner's own key. */
  trialModelCallsPerTenant: RateRule;
  /** A trial's monthly AI ceiling on the owner's own key, below the account one. */
  trialModelCeilingMicros: string;
  /** A trial with no business is deleted this long after its last use. */
  trialEmptyMs: number;
  /** Requests per trial session, slower than an account's. */
  trialRpcPerSession: RateRule;
  /** The most a trial's vault may hold, in bytes of its records; a write that grows it past this is refused. */
  trialVaultBytes: number;
  /** "Add your email" links one trial may ask for, in all. */
  trialClaimLinks: number;
  /** Trials ended in one housekeeping round, at most; the rest wait for the next minute. */
  trialEndsPerRound: number;
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
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
  trialStartsPerAddress: { capacity: 3, refillEveryMs: 20 * MINUTE },
  trialsLive: 500,
  trialIdleMs: 7 * DAY,
  trialModelCallsPerTenant: { capacity: 20, refillEveryMs: MINUTE },
  trialModelCeilingMicros: '2000000',
  trialEmptyMs: 60 * MINUTE,
  trialRpcPerSession: { capacity: 60, refillEveryMs: 500 },
  trialVaultBytes: 8 * 1024 * 1024,
  trialClaimLinks: 3,
  trialEndsPerRound: 20,
});
