import { RECRUITING_META } from './recruiting-metadata';
import { SUPPORT_DESK_META } from './support-metadata';
import { SELLER_FAKE_METADATA } from './fake-online-seller';
import { BOOKKEEPING_FAKE_METADATA } from './fake-bookkeeping-cfo';
import { SEO_FAKE_META } from './fake-seo-visibility';
// Chausar fake kit onboarding (5M integration). Original adaptation of landed browser-safe playbook metadata.
import type { BlueprintViewLite, OfferIntakeLite, PricingModel, ServiceType } from './types';
import planPicks from './fixtures-kit-plan-picks.json';
import registryPicks from './fixtures-playbook-picks.json';
import { LEADGEN_REGISTRATION, LEADGEN_OFFERS, LEADGEN_INTAKE_FIELDS } from './fake-lead-generation';
export interface FakeKitMetadata {
 registration: { id: string; label: string; serviceType: ServiceType; picks: readonly string[]; summary: string };
 offers: readonly { id: string; name: string; description: string; pricing: PricingModel; unit: string; intake: readonly string[]; rights?: readonly ('own-footage' | 'licence' | 'creator-clip-programme')[] }[];
 intakeFields: readonly NonNullable<OfferIntakeLite['kit']>[number][];
}
const METADATA = [RECRUITING_META, SUPPORT_DESK_META, SELLER_FAKE_METADATA, BOOKKEEPING_FAKE_METADATA, SEO_FAKE_META, { registration: LEADGEN_REGISTRATION, offers: LEADGEN_OFFERS, intakeFields: LEADGEN_INTAKE_FIELDS }] as readonly FakeKitMetadata[];
const KITS = planPicks.map(plan => {
 const kit = METADATA.find(item => item.registration.id === plan.id);
 if (!kit) throw new Error('A landed kit has no browser metadata for ' + plan.id);
 return kit;
});
/** Pick only a landed kit's own explicit phrases, preserving the registry's precedence. */
export function fakeKitForIdea(idea: string): FakeKitMetadata | null {
 const text = idea.toLowerCase().replace(/\s+/g, ' ');
 let best: string | null = null, length = 0;
 for (const entry of registryPicks) for (const pick of entry.picks) {
  if (pick.length > length && text.includes(pick)) { best = entry.id; length = pick.length; }
 }
 return KITS.find(kit => kit.registration.id === best) ?? null;
}
/** Internal validation still needs a kit schema when the public plan omits an empty ask. */
export function fakeKitOfferIntake(playbookId: string | undefined, offerKey: string | undefined): OfferIntakeLite | undefined {
 const kit = KITS.find(item => item.registration.id === playbookId);
 const offer = kit?.offers.find(item => item.id === offerKey);
 if (!kit || !offer) return undefined;
 return { rights: [...offer.rights ?? []], fields: [], kit: offer.intake.map(id => {
  const field = kit.intakeFields.find(item => item.id === id);
  if (!field) throw new Error('A landed kit offer has no intake schema for ' + id);
  return structuredClone(field);
 }) };
}
/** Keep owner-set prices and the real kit's offer keys and intake questions in a new fake plan. */
export function fakeKitPlan(kit: FakeKitMetadata, base: BlueprintViewLite): BlueprintViewLite {
 const label = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
 const keys = planPicks.find(plan => plan.id === kit.registration.id)?.offers;
 if (!keys) throw new Error('A landed kit has no plan selection for ' + kit.registration.id);
 const selected = keys.map(key => {
  const offer = kit.offers.find(item => item.id === key);
  if (!offer) throw new Error('A landed kit has no offer metadata for ' + key);
  return offer;
 });
 const offers = selected.map(offer => ({
  id: `offer_${offer.id.replace(/-/g, '_')}`, playbookOffer: offer.id,
  name: label(offer.name), description: label(offer.description),
  pricing: { model: offer.pricing, quantityUnit: offer.pricing === 'monthly' ? 'month' as const : offer.pricing === 'hourly' ? 'hour' as const : 'project' as const, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' },
 }));
 const intake: Record<string, OfferIntakeLite> = {};
 for (const [index, offer] of selected.entries()) {
  if (!(offer.rights?.length || offer.intake.length)) continue;
  intake[offers[index]!.id] = fakeKitOfferIntake(kit.registration.id, offer.id)!;
 }
 return { ...base, blueprint: { ...base.blueprint, serviceType: kit.registration.serviceType, oneLiner: label(kit.registration.summary), offers },
  offerReceipts: Object.fromEntries(offers.map(offer => [offer.id, null])),
  playbook: { id: kit.registration.id, label: kit.registration.label }, intake };
}
