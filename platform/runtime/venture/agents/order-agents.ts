// The agents that will do each order for a business, worked out by code (agents/order-agents-core.ts holds the words
// and the rules; this file knows the engine's playbooks). Two readers: About you, before any business exists, from the
// owner's own words (the idea a plan will start from); and the plan the owner reads before accepting, from the business
// and its plan. Both name the same agents Team shows once the plan is accepted (chief/routing.ts teamAgents): a
// playbook's own agents in the order of their first step, else the one delivery agent of the eight fixed steps. Keeper
// and a playbook's code roles are code, not AI, and are not listed; the code roles' names are carried beside the agents
// (code), since they join the team too and no other agent may take one. Reads only.
import { classifyIdea } from '../core/service-types.ts';
import { flagshipPlan } from '../playbooks/plan.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { deliveryAgent, type OrderAgents } from './order-agents-core.ts';

function ofPlaybook(id: string | null): OrderAgents | null {
  const flagship = flagshipDelivery(id);
  const agents = flagship?.roles.filter(role => role.kind === 'agent').map(role => ({ name: role.name, does: role.job })) ?? [];
  return agents.length ? { agents, flagship: true, code: flagship!.roles.filter(role => role.kind === 'code').map(role => role.name) } : null;
}

/**
 * From the owner's words alone, as About you has them. A playbook counts when the words pick it and its plan carries
 * its own offers (playbooks/plan.ts), which is when delivery follows it (delivery/playbook.ts deliveryFlagship).
 */
export function orderAgentsFor(idea: string): OrderAgents {
  const id = pickPlaybook(idea)?.id ?? null;
  return (id && flagshipPlan(idea) ? ofPlaybook(id) : null) ?? { agents: [deliveryAgent(classifyIdea(idea))], flagship: false };
}

/**
 * For a business and the plan it has: flagship is the playbook the plan delivers with (delivery/playbook.ts
 * deliveryFlagship), or null; then the plan's service type names the one delivery agent.
 */
export function orderAgentsOfPlan(flagship: string | null, serviceType: string): OrderAgents {
  return ofPlaybook(flagship) ?? { agents: [deliveryAgent(serviceType)], flagship: false };
}
