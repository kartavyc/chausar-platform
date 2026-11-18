// Chausar venture launcher, core: whether what is sold is ready (the rule of core/way.ts, read from the records).
// Today it tells the chief what to propose (chief/answer.ts). The lead finding still to be built must check it too,
// before it looks for anyone: that capability is refused until this says ready, and then needs the owner's approval.
// A message the owner chooses to draft themselves is not held by it.
import type { State } from '../../contracts.ts';
import type { VentureRecord } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { PLAN_FIXED_WORDS } from '../chief/plan-core.ts';

const PLAN_FIRST = PLAN_FIXED_WORDS.planFirst;

/**
 * Whether what is sold is ready, so customers may be looked for (and then only with the owner's approval): the plan is
 * accepted and every offer on it has the owner's price. missing: what is still to do, in order, in plain words.
 */
export function offerReadiness(state: State, venture: VentureRecord): { ready: boolean; missing: string[] } {
  const found = venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
  const plan = found && found.ventureId === venture.id && found.status === 'accepted' ? found : null;
  if (!plan) return { ready: false, missing: [PLAN_FIRST] };
  const missing = plan.offers.filter(offer => offer.pricing.unitPriceMinor === null).map(offer => `Set your price for ${offer.name.value}.`);
  if (!plan.offers.length) missing.push('Add at least one offer to your plan.');
  return { ready: missing.length === 0, missing };
}
