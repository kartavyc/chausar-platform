/**
 * The agents that will do each order, as the engine's agents/order-agents.ts works them out: the playbook an idea picks
 * (the longest phrase that names the owner's work, the registry's order breaking a tie; fixtures-playbook-picks.json) gives its own agents
 * (fixtures-order-agents.json, held equal to the engine's playbooks by platform/tests/venture-order-agents-fixture.test.ts),
 * else the one delivery agent named after the idea's service type. The words are the engine's own
 * (agents/order-agents-core.ts), so About you and the plan sheet say here what they say there.
 */
import picks from './fixtures-playbook-picks.json';
import playbookAgents from './fixtures-order-agents.json';
import { deliveryAgent, type OrderAgents } from '../../../../platform/runtime/venture/agents/order-agents-core';
import { pickedBy } from '../../../../platform/runtime/venture/core/service-keywords';

/** The playbook an idea picks, by the engine's own rule (core/service-keywords.ts pickedBy, which playbooks/registry.ts pickPlaybook is). */
const picked = (idea: string): string | null => pickedBy(idea, picks)?.id ?? null;

/** classify: the fake's own idea classifier (fake.ts), as the engine uses classifyIdea. */
export function fakeOrderAgents(idea: string, classify: (idea: string) => string): OrderAgents {
  const own = playbookAgents.find((item) => item.id === picked(idea));
  return own ? { agents: own.agents.map((agent) => ({ ...agent })), flagship: true, code: [...own.code] } : { agents: [deliveryAgent(classify(idea))], flagship: false };
}
