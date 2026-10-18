// Chausar venture launcher, core: lookups over the fixed view registry (onboarding v2).
// The AI picks view ids from this registry; the renderer has one drawing function per id. Nothing here is markup.
import { VIEW_IDS, VIEW_REGISTRY } from '../onboarding-contracts.ts';
import type { ViewId, ViewSpec } from '../onboarding-contracts.ts';

export function isViewId(value: unknown): value is ViewId {
  return typeof value === 'string' && (VIEW_IDS as readonly string[]).includes(value);
}

export function viewSpec(id: ViewId): ViewSpec {
  const spec = VIEW_REGISTRY.find(view => view.id === id);
  if (!spec) throw new Error(`Unknown view ${id}`);
  return spec;
}

export const LEAD_VIEW_IDS: readonly ViewId[] = Object.freeze(VIEW_REGISTRY.filter(view => view.role === 'lead').map(view => view.id));
export const SUPPORT_VIEW_IDS: readonly ViewId[] = Object.freeze(VIEW_REGISTRY.filter(view => view.role === 'support').map(view => view.id));

/**
 * Every view list decide may pick: one lead view first, then one to three support views in any order, each used
 * once. The schema walk test builds a compose schema for each of them.
 */
export function allowedViewPicks(): ViewId[][] {
  const picks: ViewId[][] = [];
  const orders = (rest: readonly ViewId[], size: number): ViewId[][] => {
    if (size === 0) return [[]];
    const out: ViewId[][] = [];
    for (const id of rest) for (const tail of orders(rest.filter(other => other !== id), size - 1)) out.push([id, ...tail]);
    return out;
  };
  for (const lead of LEAD_VIEW_IDS) for (let size = 1; size <= 3; size++) for (const tail of orders(SUPPORT_VIEW_IDS, size)) picks.push([lead, ...tail]);
  return picks;
}
