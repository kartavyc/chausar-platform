// Chausar venture launcher, core (P1): venture.preview, the instant plan shown before any vault exists.
// Template words only. No model, no store, no clock: nothing is saved and nothing leaves the computer.
import { exactPayload, plainText } from '../records.ts';
import { OFFER_IDS, SECOND_OFFER_MODEL, STEP_PLAN } from '../contracts.ts';
import type { PlanPreview } from '../contracts.ts';
import { offerPricing, previewBackOffice } from './blueprint.ts';
import { countryProfile } from './countries.ts';
import { previewQuestions } from './interview.ts';
import { classifyIdea, serviceTemplate } from './service-types.ts';
import { labelled } from './words.ts';

/** Answers venture.preview { idea, countryCode }. Takes no deps, reads no state and writes nothing. */
export function previewPlan(payload: unknown): PlanPreview {
  const body = exactPayload(payload, ['idea', 'countryCode'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  const country = countryProfile(body.countryCode);
  const type = classifyIdea(idea);
  const template = serviceTemplate(type);
  const say = (value: string) => labelled(value, 'assumption', 'template');
  return {
    idea,
    country,
    serviceType: labelled(type, 'assumption', 'template'),
    serviceLabel: template.label,
    oneLiner: say(template.oneLiner),
    customer: say(template.customer),
    offers: OFFER_IDS.map((id, index) => ({
      id,
      name: say(template.offers[index].name),
      description: say(template.offers[index].description),
      // The first offer is monthly until the owner chooses; neither has a price until the owner types one.
      pricing: offerPricing(index === 0 ? 'monthly' : SECOND_OFFER_MODEL[type], null),
    })),
    deliverySteps: STEP_PLAN.map((step, index) => ({ id: step.id, title: say(template.steps[index]), doneBy: step.doneBy, capability: step.capability, note: step.note })),
    approvals: template.approvals.map(say),
    backOffice: previewBackOffice(country),
    questions: previewQuestions(template, country),
    by: 'template',
    saved: false,
  };
}
