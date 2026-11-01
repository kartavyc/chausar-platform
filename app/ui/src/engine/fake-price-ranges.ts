/**
 * W6 6C3 (D17): the fake engine's price guide on a plan view, as platform/runtime/venture/core/lookups.ts adds it:
 * the profession the plan's playbook serves, from the engine's own data and code (core/price-ranges.ts), so the two
 * answer exactly alike. Information only; it never touches an offer's price.
 */
import { priceGuideForPlaybook } from '../../../../platform/runtime/venture/core/price-ranges';
import type { BlueprintViewLite, PriceGuideView } from './types';

/** countryCode: the business's country, used when the plan carries none (the engine reads the plan's, then the venture's). */
export function withPriceGuide<T extends BlueprintViewLite | null>(view: T, countryCode: string): T {
  if (!view) return view;
  const guide = priceGuideForPlaybook(view.playbook?.id, view.blueprint.country?.code ?? countryCode);
  if (guide) view.priceGuide = guide as PriceGuideView;
  else delete view.priceGuide;
  return view;
}
