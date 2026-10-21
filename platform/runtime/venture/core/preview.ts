// Chausar venture launcher, core (P1): venture.preview, the instant plan shown before any vault exists.
// Template words only. No model, no store, no clock: nothing is saved and nothing leaves the computer.
import { exactPayload, plainText } from '../records.ts';
import { OFFER_IDS, SECOND_OFFER_MODEL, STEP_PLAN } from '../contracts.ts';
import type { PlanPreview } from '../contracts.ts';
import { check } from '../../contracts.ts';
import { offerPricing, previewBackOffice } from './blueprint.ts';
import { countryProfile } from './countries.ts';
import { isPricingModel, previewQuestions } from './interview.ts';
import { playbookField } from './lookups.ts';
import { classifyIdea, offerWords, serviceTemplate } from './service-types.ts';
import { labelled } from './words.ts';

/**
 * Answers venture.preview { idea, countryCode, pricingModel? }. Takes no deps, reads no state and writes nothing.
 * pricingModel is how the owner says they will charge; the first offer is priced and worded for it (per month when
 * absent). Ask again with it when the owner changes the choice, so the plan never says 'Monthly' for an hourly offer.
 */
export function previewPlan(payload: unknown): PlanPreview {
  const body = exactPayload(payload, ['idea', 'countryCode', 'pricingModel'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  check(body.pricingModel === undefined || isPricingModel(body.pricingModel), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
  const firstModel = isPricingModel(body.pricingModel) ? body.pricingModel : 'monthly';
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
    offers: OFFER_IDS.map((id, index) => {
      // The first offer is monthly until the owner chooses; neither has a price until the owner types one.
      const model = index === 0 ? firstModel : SECOND_OFFER_MODEL[type];
      const words = offerWords(type, index, model);
      return { id, name: say(words.name), description: say(words.description), pricing: offerPricing(model, null) };
    }),
    deliverySteps: STEP_PLAN.map((step, index) => ({ id: step.id, title: say(template.steps[index]), doneBy: step.doneBy, capability: step.capability, note: step.note })),
    approvals: template.approvals.map(say),
    backOffice: previewBackOffice(country),
    questions: previewQuestions(template, country),
    by: 'template',
    saved: false,
    ...playbookField(idea),
  };
}
