// Browser-safe social onboarding adapter. Prices remain owner-set.
import registry from './fixtures-playbook-picks.json';
import metadata from './fixtures-social-plan.json';
import type { BlueprintViewLite, OfferIntakeLite } from './types';
import {SOCIAL_D2_KEYS} from '../../../../platform/runtime/venture/playbooks/social/d2-core';
const CLIPS=['reel-from-clips','hook-variations','local-instagram','cross-posting'];
const KEYS = ['content-calendar', 'community-replies', 'ugc-ads', 'monthly-report', 'repurpose-pack', 'linkedin-ghostwriting',...SOCIAL_D2_KEYS];
export function fakeSocialForIdea(idea: string): boolean {
 const text = idea.toLowerCase().replace(/\s+/g, ' ');
 let best = '', length = 0;
 for (const entry of registry) for (const phrase of entry.picks) if (phrase.length > length && text.includes(phrase)) { best = entry.id; length = phrase.length; }
 return best === metadata.registration.id;
}
export function fakeSocialOfferIntake(key: string | undefined): OfferIntakeLite | undefined {
 if (!key || !KEYS.includes(key)) return undefined;
 return { rights: CLIPS.includes(key)?['own-footage']:[], fields: [...(key === 'monthly-report' ? [] : ['aiVoice', 'aiPresenter', 'paidPromotion'] as const), ...(key === 'content-calendar' ? ['calendar'] as const : []), 'clientRules'], kit: structuredClone(metadata.offers.find(offer => offer.id === key)!.intake) as NonNullable<OfferIntakeLite['kit']> };
}
export function fakeSocialPlan(base: BlueprintViewLite): BlueprintViewLite {
 const label = (value: string) => ({ value, label: 'assumption' as const, by: 'template' as const });
 const offers = KEYS.map(key => {
  const offer = metadata.offers.find(item => item.id === key)!;
  return { id: 'offer_' + key.replace(/-/g, '_'), playbookOffer: key, name: label(offer.name), description: label(offer.description), pricing: { model: offer.charge as 'monthly' | 'project', quantityUnit: offer.charge === 'monthly' ? 'month' as const : 'project' as const, unitPriceMinor: null, unitPriceLabel: 'not-set' as const, defaultQuantity: '1' } };
 });
 return { ...base, blueprint: { ...base.blueprint, serviceType: 'agency', oneLiner: label(metadata.registration.summary), offers }, playbook: { id: 'social-agency', label: metadata.registration.label }, offerReceipts: Object.fromEntries(offers.map(offer => [offer.id, null])), intake: Object.fromEntries(offers.map(offer => [offer.id, fakeSocialOfferIntake(offer.playbookOffer)!])) };
}

/** Engine-pinned step words for the fake chain; no server graph enters the browser. */
export const fakeSocialSteps = metadata.steps;
