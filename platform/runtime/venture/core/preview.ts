// Chausar venture launcher, core (P1): venture.preview, the instant plan shown before any vault exists.
// Template words only. No model, no store, no clock: nothing is saved and nothing leaves the computer.
import { exactPayload, plainText } from '../records.ts';
import { OFFER_IDS, SECOND_OFFER_MODEL, STEP_PLAN } from '../contracts.ts';
import type { PlanPreview } from '../contracts.ts';
import { check } from '../../contracts.ts';
import { flagshipApprovalLines, flagshipOfferWords, flagshipStepLines, offerPricing, previewBackOffice } from './blueprint.ts';
import { flagshipPlan } from '../playbooks/plan.ts';
import { countryProfile } from './countries.ts';
import { isPricingModel, previewQuestions } from './interview.ts';
import { playbookField } from './lookups.ts';
import { classifyIdea, offerWords, serviceTemplate } from './service-types.ts';
import { labelled } from './words.ts';

/**
 * Answers venture.preview { idea, countryCode, pricingModel? }. Takes no deps, reads no state and writes nothing.
 * pricingModel is how the owner says they will charge; the first offer is priced and worded for it (per month when
 * absent). Ask again with it when the owner changes the choice, so the plan never says 'Monthly' for an hourly offer.
 * An idea that picks a flagship playbook (playbooks/plan.ts) gets that playbook's label, summary, offers (priced the
 * way each is sold until the owner chooses) and approvals, on the base service type the playbook extends.
 */
export function previewPlan(payload: unknown): PlanPreview {
  const body = exactPayload(payload, ['idea', 'countryCode', 'pricingModel'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  check(body.pricingModel === undefined || isPricingModel(body.pricingModel), 'INVALID_VENTURE_REQUEST', 'Choose per month, per project or per hour.');
  const flagship = flagshipPlan(idea);
  const firstModel = isPricingModel(body.pricingModel) ? body.pricingModel : flagship?.offers[0].model ?? 'monthly';
  const country = countryProfile(body.countryCode);
  const type = classifyIdea(idea);
  const template = serviceTemplate(type);
  const say = (value: string) => labelled(value, 'assumption', 'template');
  const flagshipWords = flagship ? flagshipOfferWords(flagship) : null;
  return {
    idea,
    country,
    serviceType: labelled(type, 'assumption', 'template'),
    serviceLabel: flagship?.label ?? template.label,
    oneLiner: say(flagship?.oneLiner ?? template.oneLiner),
    customer: say(template.customer),
    offers: flagship && flagshipWords
      ? flagship.offers.map((offer, index) => ({
        id: `offer_${index + 1}`, playbookOffer: offer.key, ...flagshipWords[index], pricing: offerPricing(index === 0 ? firstModel : offer.model, null),
      }))
      : OFFER_IDS.map((id, index) => {
        // The first offer is monthly until the owner chooses; neither has a price until the owner types one.
        const model = index === 0 ? firstModel : SECOND_OFFER_MODEL[type];
        const words = offerWords(type, index, model);
        return { id, name: say(words.name), description: say(words.description), pricing: offerPricing(model, null) };
      }),
    deliverySteps: STEP_PLAN.map((step, index) => ({ id: step.id, title: say(template.steps[index]), doneBy: step.doneBy, capability: step.capability, note: step.note })),
    approvals: flagship ? flagshipApprovalLines(flagship) : template.approvals.map(say),
    backOffice: previewBackOffice(country),
    questions: previewQuestions(template, country, flagship ? firstModel : null),
    by: 'template',
    saved: false,
    ...playbookField(idea),
    ...(flagship ? { flagshipSteps: flagshipStepLines(flagship) } : {}),
  };
}
