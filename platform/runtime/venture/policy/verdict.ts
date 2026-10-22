// Chausar venture launcher, policy (P2-posture): allow / deny / ask, evaluated before an action and failing closed.
// The gate starts denied and only an explicit allow opens it. Policies run in a fixed order: any deny stops the rest,
// any ask beats an allow. A policy that throws, answers something unknown or runs out of time blocks the action; a
// timeout is never an approval. Verdicts carry a stable code the screens turn into plain words.
// The three verdicts and the fail-closed phases follow omnigent-ai/omnigent (Apache-2.0); the start-denied gate with
// typed reason codes follows decionis/docker internal/authority/gate.go (Apache-2.0). This is a rewrite, not a copy.
import type { FloorKind, PolicyAction } from './floor.ts';

export type VerdictKind = 'allow' | 'deny' | 'ask';
/** What one policy answers. null means it has no opinion on this action. */
export type PolicyAnswer = { verdict: VerdictKind; code: string; reason: string; floor?: FloorKind[]; step?: string | null; holdId?: string | null };
export type Verdict = { verdict: VerdictKind; code: string; reason: string; floor: FloorKind[]; policy: string | null; step?: string | null; holdId?: string | null };
export type Policy<C = unknown> = { id: string; decide(action: PolicyAction, ctx: C): PolicyAnswer | null | Promise<PolicyAnswer | null> };

/** Long enough for a check that reads the vault; a check that needs longer is a check that blocks. */
export const POLICY_TIMEOUT_MS = 2000;
const VERDICTS: readonly VerdictKind[] = ['allow', 'deny', 'ask'];

const denied = (code: string, reason: string, policy: string | null): Verdict => ({ verdict: 'deny', code, reason, floor: [], policy });
export const NOT_APPROVED = 'Nothing approved this.';
const FAILED = 'A check failed, so this was blocked.';
const UNKNOWN = 'A check gave an answer Chausar does not know, so this was blocked.';
const TIMED_OUT = 'A check did not answer in time. A timeout is not an approval.';
const NOT_AT_ONCE = 'A check could not answer at once, so this was blocked.';

function valid(answer: unknown): answer is PolicyAnswer {
  if (!answer || typeof answer !== 'object') return false;
  const value = answer as Record<string, unknown>;
  return VERDICTS.includes(value.verdict as VerdictKind) && typeof value.code === 'string' && /^[a-z][a-z_]{0,39}$/.test(value.code)
    && typeof value.reason === 'string' && value.reason.length > 0 && (value.floor === undefined || Array.isArray(value.floor));
}

function shaped(answer: PolicyAnswer, policy: string): Verdict {
  return {
    verdict: answer.verdict, code: answer.code, reason: answer.reason, floor: [...(answer.floor ?? [])], policy,
    ...(answer.step !== undefined ? { step: answer.step } : {}), ...(answer.holdId !== undefined ? { holdId: answer.holdId } : {}),
  };
}

/** Folds answers in order. Returns a verdict as soon as one decides for good (a deny or a broken answer). */
class Fold {
  private asks: Verdict[] = [];
  private allowed: Verdict | null = null;
  take(answer: unknown, policy: string): Verdict | null {
    if (answer === null) return null;
    if (!valid(answer)) return denied('unknown_verdict', UNKNOWN, policy);
    const verdict = shaped(answer, policy);
    if (verdict.verdict === 'deny') return verdict;
    if (verdict.verdict === 'ask') this.asks.push(verdict);
    else this.allowed = verdict;
    return null;
  }
  end(): Verdict {
    if (this.asks.length) {
      const [first] = this.asks;
      const floor = [...new Set(this.asks.flatMap(ask => ask.floor))];
      return { ...first, reason: this.asks.map(ask => ask.reason).join('; '), floor };
    }
    return this.allowed ?? denied('not_approved', NOT_APPROVED, null);
  }
}

class Timeout extends Error {}

/** Every policy in order, each with its time limit. Gates start denied; errors and timeouts deny. */
export async function evaluate<C>(policies: readonly Policy<C>[], action: PolicyAction, ctx?: C, options: { timeoutMs?: number } = {}): Promise<Verdict> {
  const timeoutMs = options.timeoutMs ?? POLICY_TIMEOUT_MS;
  const fold = new Fold();
  for (const policy of policies) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let answer: unknown;
    try {
      answer = await Promise.race([
        Promise.resolve().then(() => policy.decide(action, ctx as C)),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Timeout()), timeoutMs); }),
      ]);
    } catch (error) {
      return error instanceof Timeout ? denied('policy_timeout', TIMED_OUT, policy.id) : denied('policy_error', FAILED, policy.id);
    } finally {
      clearTimeout(timer);
    }
    const decided = fold.take(answer, policy.id);
    if (decided) return decided;
  }
  return fold.end();
}

/** The same fold without waiting: a policy that answers later is refused, never trusted, so nothing opens by delay. */
export function evaluateSync<C>(policies: readonly Policy<C>[], action: PolicyAction, ctx?: C): Verdict {
  const fold = new Fold();
  for (const policy of policies) {
    let answer: unknown;
    try { answer = policy.decide(action, ctx as C); } catch { return denied('policy_error', FAILED, policy.id); }
    if (answer && typeof (answer as { then?: unknown }).then === 'function') {
      (answer as Promise<unknown>).then(undefined, () => undefined);
      return denied('policy_async', NOT_AT_ONCE, policy.id);
    }
    const decided = fold.take(answer, policy.id);
    if (decided) return decided;
  }
  return fold.end();
}
