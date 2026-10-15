/**
 * BK-09, round 4: publishing a copy with either strategy core trials offer. `trials.promote`
 * takes `prospective` (publish for future calculations; saved answers are marked stale and
 * their receipts kept) or `retrospective` (also rebuilds the listed saved answers as new,
 * restated receipts; the originals stay). Each strategy is shown with its own impact preview
 * from `trials.impact` before anything is published, and a strategy core refuses (for
 * example `TRIAL_REBUILD_REQUIRED` when a saved answer has no pinned date) keeps its code.
 */
import type { Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';

export const STRATEGIES = ['prospective', 'retrospective'] as const;
export type Strategy = typeof STRATEGIES[number];
/** One strategy's impact preview, or the code core refused it with (`digest` null). */
export type StrategyImpact = { strategy: Strategy; digest: string | null; affectedAnswers: number; rebuild: number; activeWork: number; preserved: number; code: string | null };

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown) => Array.isArray(value) ? value.length : 0;
/** Of the receipts core keeps, only those the caller can read are counted: their own, in their current permission epoch. */
function readable(host: ModuleHost, ctx: Context, ids: unknown): number {
  if (!Array.isArray(ids)) return 0;
  const wanted = new Set(ids.filter((id): id is string => typeof id === 'string'));
  return host.store.read().receipts.filter(r => r && wanted.has(r.id) && r.memberId === ctx.memberId && r.epoch === ctx.epoch).length;
}
const refused = (strategy: Strategy, code: string): StrategyImpact => ({ strategy, digest: null, affectedAnswers: 0, rebuild: 0, activeWork: 0, preserved: 0, code });

/** `trials.impact` is a read: it never publishes. Every refusal becomes this strategy's code. */
export async function impactOf(host: ModuleHost, ctx: Context, trialId: string, strategy: Strategy): Promise<StrategyImpact> {
  try {
    const raw = await host.call('trials.impact', { trialId, strategy });
    if (!plain(raw) || typeof raw.digest !== 'string' || raw.digest.length === 0 || raw.digest.length > 200 || (raw.strategy !== undefined && raw.strategy !== strategy)) return refused(strategy, 'TRIAL_REPLY_INVALID');
    return { strategy, digest: raw.digest, affectedAnswers: count(raw.affectedSavedAnswerIds), rebuild: count(raw.rebuildArtifactIds), activeWork: count(raw.activeWorkIds), preserved: readable(host, ctx, raw.historicalReceiptIdsToPreserve), code: null };
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    return refused(strategy, typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'TRIAL_IMPACT_FAILED');
  }
}
export const impactsOf = (host: ModuleHost, ctx: Context, trialId: string) => Promise.all(STRATEGIES.map(strategy => impactOf(host, ctx, trialId, strategy)));
