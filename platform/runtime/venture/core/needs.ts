// Chausar venture launcher, core (wave 6, 6C7): venture.needs.list, the open business's outside services
// (needs-data.ts holds the list). Reading it connects nothing.
import type { Context } from '../../contracts.ts';
import type { VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, readVenture } from '../records.ts';
import { familyOf } from './families.ts';
import { classifyIdea } from './service-types.ts';
import { leadSources, mapNoteOf } from '../customers/find-target.ts';
import { NEED_IDS, businessFamily, businessNeeds, neededGroups, ownerNeeds, type NeedsList } from './needs-data.ts';

export { businessFamily, businessNeeds, keptNeeds, neededGroups, ownerNeeds, CARD_LABELS, NEED_IDS, NEEDS_MAX, RAIL_NAMES, type NeedGroup, type NeedId, type NeedLabel, type NeedView, type NeedsList } from './needs-data.ts';

/** venture.needs.list {} (level read): the open business's outside services. Nothing is connected by reading it. */
export async function needsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<NeedsList> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const profile = listRecords(state, 'venture-owner-profile', venture.id).at(-1) as { familyId?: unknown; needs?: unknown } | undefined;
  const familyId = businessFamily(profile?.familyId, venture.idea, classifyIdea);
  const country = venture.country;
  // The plan's own needs when it was kept with any (core/needs-data.ts); else the field's list, as before.
  const kept = ownerNeeds(profile?.needs);
  // Customers who are not places on a map: the need to find customers says so in one line (customers/find-target.ts).
  const mapNote = mapNoteOf(state, venture);
  const groups = kept.length ? neededGroups(kept, country?.code ?? null, country?.paymentRails ?? [], leadSources(state, venture.id), mapNote ? { 'find-customers': mapNote } : {}) : [];
  return {
    family: familyId ? { id: familyId, label: familyOf(familyId).label } : null,
    needs: groups.length ? [] : businessNeeds(familyId, country?.code ?? null, country?.paymentRails ?? []),
    groups,
    // What the owner ticks and unticks ("Change what you need"): the needs kept now, and the whole fixed list.
    chosen: kept, choices: [...NEED_IDS],
  };
}
