// Chausar venture launcher, core (wave 6, 6C7): venture.needs.list, the open business's outside services
// (needs-data.ts holds the list). Reading it connects nothing.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, readVenture } from '../records.ts';
import { familyOf } from './families.ts';
import { classifyIdea } from './service-types.ts';
import { businessFamily, businessNeeds, type NeedsList } from './needs-data.ts';

export { businessFamily, businessNeeds, CARD_LABELS, RAIL_NAMES, type NeedLabel, type NeedView, type NeedsList } from './needs-data.ts';

/** venture.needs.list {} (level read): the open business's outside services. Nothing is connected by reading it. */
export async function needsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NeedsList> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const profile = listRecords(state, 'venture-owner-profile', venture.id).at(-1) as { familyId?: unknown } | undefined;
  const familyId = businessFamily(profile?.familyId, venture.idea, classifyIdea);
  const country = venture.country;
  return {
    family: familyId ? { id: familyId, label: familyOf(familyId).label } : null,
    needs: businessNeeds(familyId, country?.code ?? null, country?.paymentRails ?? []),
  };
}
