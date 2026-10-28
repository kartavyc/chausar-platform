// Original Chausar typed per-order workflow selection, after the CFO question-routing idea (MIT).
import { ChausarError } from '../../../contracts.ts';
import type { OrderIntake } from '../../contracts.ts';
import type { KitOffer, PlaybookDefinition } from './define.ts';

/** Every selected step belongs to the offer; writing artifacts and approval floors cannot disappear. */
export function kitWorkflowIds(definition: PlaybookDefinition, offer: KitOffer, intake: OrderIntake | null = null): readonly string[] {
  const declared = offer.workflow ?? offer.stages;
  const selected = definition.routeSteps?.(offer.id, intake) ?? declared;
  const mandatory = definition.steps.filter(step => step.floor !== undefined && declared.includes(step.id)).map(step => step.id);
  if (!Array.isArray(selected) || selected.length === 0 || new Set(selected).size !== selected.length || selected.some(id => typeof id !== 'string' || !declared.includes(id)) || selected.at(-1) !== declared.at(-1) || [...mandatory, ...offer.stages].some(id => !selected.includes(id))) {
    throw new ChausarError('PLAYBOOK_ROUTE_INVALID', 'The order workflow must use distinct declared steps and keep its writing artifacts, approval floors and final step.');
  }
  return [...selected];
}
