/**
 * The fake engine's rule for an AI spend figure on the owner's own AI plan, as the engine's models/own-plan.ts: an AI
 * tool on this computer (Claude Code or Codex) serves a tier and no tier goes to a key, and the month came to nothing
 * with no estimate held. Then the words lead, in no currency. Team and Money share it, as they do in the engine.
 */
import { formatCost } from '../../../../platform/runtime/owner-format';
import type { ModelStatusLite, SpendLead } from './types';

export const OWN_PLAN_WORDS = formatCost('0', { ownPlan: true });

/** As models/own-plan.ts onOwnPlan. A status that cannot be read is not that. */
export function fakeOnOwnPlan(ask: (method: string, params: Record<string, unknown>) => unknown): boolean {
  try {
    const presets = Object.values((ask('venture.models.status', {}) as ModelStatusLite).tiers).map((tier) => tier.presetId);
    const own = (id: string) => id === 'claude-code-cli' || id === 'codex-cli';
    return presets.some(own) && presets.every((id) => own(id) || id === 'built-in-templates');
  } catch {
    return false;
  }
}

/** As models/own-plan.ts ownPlanLead: the words, or null when anything was priced, an estimate is held or a key serves a tier. */
export function fakeOwnPlanLead(ask: (method: string, params: Record<string, unknown>) => unknown, micros: number | bigint, estimate: boolean): SpendLead | null {
  return BigInt(micros) === 0n && !estimate && fakeOnOwnPlan(ask) ? { currency: 'USD', figure: OWN_PLAN_WORDS } : null;
}
