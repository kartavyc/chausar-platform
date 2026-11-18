/**
 * The plan the owner reads before accepting it (venture.queue.view, kind plan), as the engine's views/queue-view.ts
 * planView answers it: the kept plan, laid out by the engine's own views/plan-sections.ts from the same parts (the
 * blueprint, the way to earn kept with the business, and the agents the owner hired).
 */
import { formatMoney } from '../../../../platform/runtime/owner-format';
import { planSections } from '../../../../platform/runtime/venture/views/plan-sections';
import type { BlueprintLite, FlagshipStepLite, QueueItemView, WayToEarnLite } from './types';

const MODEL_ESTIMATE = ' (model estimate)';
const said = (line: { value: string; estimate?: boolean }) => `${line.value}${line.estimate ? MODEL_ESTIMATE : ''}`;
/** Who does a flagship playbook's step, in the engine's words (views/queue-view.ts stepDoer). */
function stepDoer(step: FlagshipStepLite): string {
  if (step.doneBy === 'agent') return `the ${step.who}, an agent`;
  if (step.doneBy === 'code') return `${step.who}, in code with no AI`;
  return step.doneBy === 'you' ? 'you' : step.who;
}

/** orderAgents: the agents that do each order, and whether the plan is accepted so they are on the team (fake-order-agents.ts). */
export function fakePlanView(businessName: string, blueprint: BlueprintLite, way: WayToEarnLite | null, team: { name: string; job: string; duties: string[] }[], orderAgents?: { agents: { name: string; does: string }[]; joined: boolean }): QueueItemView {
  const tax = blueprint.backOffice;
  return {
    kind: 'plan', id: blueprint.id, businessName, title: said(blueprint.name), line: said(blueprint.oneLiner),
    sections: planSections({
      serviceType: blueprint.serviceType,
      customer: blueprint.customer,
      offers: blueprint.offers.map((offer) => ({
        name: offer.name, description: offer.description,
        price: offer.pricing.unitPriceMinor === null ? null : `${formatMoney(offer.pricing.unitPriceMinor, tax.currency)} per ${offer.pricing.quantityUnit}`,
      })),
      steps: blueprint.deliverySteps.map((step) => ({ title: step.title, doneBy: step.doneBy, note: step.note })),
      ...(blueprint.flagshipSteps ? { flagshipSteps: blueprint.flagshipSteps.map((step) => ({ title: step.title, doer: stepDoer(step) })) } : {}),
      approvals: blueprint.approvals,
      tax: { label: tax.taxLabel, registered: tax.taxRegistered.value, assumed: tax.taxRegistered.label === 'assumption', invoiceKind: tax.invoiceKind, missing: tax.taxInvoiceMissing },
      way, team, ...(orderAgents ? { orderAgents } : {}),
    }),
  };
}
