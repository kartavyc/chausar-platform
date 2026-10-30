import { check, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, OrderRecord, PriceReceiptRecord } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { playbookForRun } from '../delivery/workflow.ts';
import { flagshipDraft } from '../delivery/playbook.ts';
import { personaInputs, personaPart, writingStyle } from '../agents/persona.ts';
import { brandKitPart } from '../playbooks/kit/brand-kit.ts';
import { socialVoicePart } from '../playbooks/social/chain.ts';
import { vaRoomEvidence } from '../playbooks/virtual-assistant/run-source.ts';
import { deskContext } from './desk-context.ts';
import { jobMemory } from './job-memory.ts';

/** Current, job-scoped background data. Model output cannot choose its client or work plan. */
export function jobContext(state: State, run: DeliveryRunRecord, order: OrderRecord, receipt: PriceReceiptRecord) {
  const venture = listRecords(state, 'venture-record').find(item => item.id === run.ventureId);
  const blueprint = listRecords(state, 'venture-blueprint', run.ventureId).find(item => item.digest === receipt.inputs.blueprintDigest);
  check(venture && blueprint, 'JOB_SOURCE_CHANGED', 'The plan used for this order is no longer available.');
  const offer = blueprint.offers.find(item => item.id === order.offerId);
  const playbook = playbookForRun(state, run);
  const draft = playbook && flagshipDraft(playbook, offer?.playbookOffer ?? null, order.intake, order.chainStage);
  const workInstructions = draft?.guidance ?? playbook?.steps.find(step => step.kind === 'write')?.guidance ?? [];
  const desk = deskContext(state, run, order, playbook?.flagship);
  return {
    offer: offer ? { name: offer.name.value, description: offer.description.value } : null,
    workInstructions: [...workInstructions],
    style: { ...(playbook ? { ...writingStyle(state, venture, playbook),
      ...personaPart([...new Map([...personaInputs(state, venture, playbook, 'act'), ...personaInputs(state, venture, playbook, 'write')].map(item => [item.agent, item])).values()]) } : {}),
      ...brandKitPart(state, venture, order.clientId), ...socialVoicePart(order) },
    approvedBrief: vaRoomEvidence(state, venture.id, order.id)?.fields ?? null,
    deskBinding: desk.binding, playbookEvidence: desk.data,
    ...(playbook ? jobMemory(state, venture, order, playbook, offer?.name.value ?? '', workInstructions) : {
      notes: { background: true as const, items: [] }, knowledge: { background: true as const, items: [] },
    }),
  };
}
