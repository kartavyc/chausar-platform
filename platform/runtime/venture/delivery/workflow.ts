// Original Chausar run-owned workflow pins. Selecting a question never creates a global playbook version.
import { check, type Context, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, DeliveryWorkflow, OrderRecord, PlaybookRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, findRecord } from '../records.ts';
import { kitDefinition } from '../playbooks/kit/installed.ts';
import { kitWorkflowIds } from '../playbooks/kit/workflow.ts';
import { dictionaryEntries, ownerDefinitions } from './harness/dictionary.ts';
import { playbookLimits, validatePlaybook } from './playbook.ts';
import {youtubeServiceWorkflow} from '../playbooks/youtube/service-workflow.ts';

export type RunPlaybook = PlaybookRecord & { runWorkflow?: DeliveryWorkflow };
const workflowHash = ({ hash: _hash, ...body }: DeliveryWorkflow): string => digest(body);

/** Owner changes on the base remain, within the selected workflow's declared tool ceiling. */
export function playbookForOrder(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, base: PlaybookRecord, order: OrderRecord, offerId: string | null): RunPlaybook {
  const youtubeSteps=youtubeServiceWorkflow(state,venture,base,order,offerId);
  if(youtubeSteps){
    const limits=playbookLimits(base),aliases=base.aliases??{};validatePlaybook(youtubeSteps,{limits,aliases});
    const workflow:DeliveryWorkflow=structuredClone({orderId:order.id,offerId:offerId!,baseHash:base.hash,intakeDigest:digest(order.intake??null),steps:youtubeSteps,limits,aliases,dictionary:dictionaryEntries(state,venture,aliases,ownerDefinitions(deps,ctx)),hash:''});workflow.hash=workflowHash(workflow);
    return {...base,hash:workflow.hash,steps:workflow.steps,limits,aliases,runWorkflow:workflow};
  }
  const definition = kitDefinition(base.flagship ?? null);
  const offer = definition?.offers.find(item => item.id === offerId);
  if (!definition || !offer?.workflow) return base;
  const ids = kitWorkflowIds(definition, offer, order.intake ?? null);
  const ceiling = new Set(ids.flatMap(id => definition.steps.find(step => step.id === id)?.tools ?? []));
  const steps = ids.map(id => {
    const step = base.steps.find(item => item.id === id);
    check(step, 'PLAYBOOK_ROUTE_INVALID', 'The current playbook is missing a declared workflow step.');
    const declared = definition.steps.find(item => item.id === id)!;
    check(!declared.floor || step.kind === 'approve', 'PLAYBOOK_ROUTE_INVALID', 'The workflow approval floor cannot change.');
    return { ...step, tools: (step.tools ?? []).filter(tool => ceiling.has(tool)) };
  });
  const limits = playbookLimits(base), aliases = base.aliases ?? {};
  validatePlaybook(steps, { limits, aliases });
  const workflow: DeliveryWorkflow = structuredClone({ orderId: order.id, offerId: offer.id, baseHash: base.hash, intakeDigest: digest(order.intake ?? null), steps, limits, aliases, dictionary: dictionaryEntries(state, venture, aliases, ownerDefinitions(deps, ctx)), hash: '' });
  workflow.hash = workflowHash(workflow);
  return { ...base, hash: workflow.hash, steps: workflow.steps, limits: workflow.limits, aliases: workflow.aliases, runWorkflow: workflow };
}

/** Every resumed turn resolves the exact pin; the business pointer and later versions are irrelevant. */
export function playbookForRun(state: State, run: DeliveryRunRecord): RunPlaybook | undefined {
  const base = findRecord(state, 'venture-playbook', run.playbookId);
  if (!base || !run.workflow) return base;
  const pin = run.workflow;
  check(pin.orderId === run.orderId && pin.baseHash === base.hash && pin.hash === run.playbookHash && workflowHash(pin) === pin.hash, 'PLAYBOOK_WORKFLOW_CHANGED', 'This run workflow changed. Start a new run for a new approval.');
  validatePlaybook(pin.steps, { limits: pin.limits, aliases: pin.aliases });
  return { ...base, hash: pin.hash, steps: pin.steps, limits: pin.limits, aliases: pin.aliases, runWorkflow: pin };
}
