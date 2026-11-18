// One rule for an AI spend figure on the owner's own AI plan, shared by Team (views/team-series.ts) and Money
// (money/overview.ts, money/spend.ts listSpend). On the owner's own Codex or Claude plan a call is counted, never
// priced: nothing spent says that in words, in no currency, where a zero would read as a price. Anything priced, and
// any held estimate, keeps its figure: the provider's dollars as code summed them, with rupees only at the owner's own
// rate (money/spend.ts). No rate is ever invented here. The sum and its receipt are never changed; only what leads.
import { formatCost } from '../../owner-format.ts';
import type { Context } from '../../contracts.ts';
import type { SpendLead, VentureDeps } from '../contracts.ts';
import { presetSpec } from './presets.ts';

/** "On your own AI plan" (owner-format.ts formatCost), the one place these words are written. */
export const OWN_PLAN_WORDS = formatCost('0', { ownPlan: true });

/**
 * Whether the owner's AI runs on their own plan and nothing is priced: an AI tool on this computer (Claude Code or
 * Codex) serves a tier, and no tier goes to a key. A status that cannot be read is not that.
 */
export function onOwnPlan(deps: VentureDeps, ctx: Context): boolean {
  try {
    const kinds = Object.values(deps.models.status(ctx).tiers).map(tier => presetSpec(tier.presetId).kind);
    return kinds.some(kind => kind === 'claude-cli' || kind === 'codex-cli') && kinds.every(kind => kind === 'claude-cli' || kind === 'codex-cli' || kind === 'template');
  } catch { return false; }
}

/**
 * What leads a month's AI spend that came to nothing on the owner's own plan: the words, in no currency. Null when
 * anything was priced (micros above zero), when the sum holds an estimate, or when a tier goes to a key: the caller
 * then leads with the figure as it always did.
 */
export function ownPlanLead(deps: VentureDeps, ctx: Context, micros: string | bigint, estimate: boolean): SpendLead | null {
  return BigInt(micros) === 0n && !estimate && onOwnPlan(deps, ctx) ? { currency: 'USD', figure: OWN_PLAN_WORDS } : null;
}
