// The fake engine names the agents that will do each order from a snapshot (app/ui/src/engine/fixtures-order-agents.json,
// read by fake-order-agents.ts). This holds the snapshot equal to the engine's own playbooks, so About you and the plan
// sheet show the same agents in the app's tests as in the real engine (agents/order-agents.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { flagshipPlanById } from '../runtime/venture/playbooks/plan.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { orderAgentsFor, orderAgentsOfPlan } from '../runtime/venture/agents/order-agents.ts';
import { DELIVERY_AGENT_NAMES, DELIVERY_JOB, OWN_ORDER_JOB, deliveryAgent } from '../runtime/venture/agents/order-agents-core.ts';
import { SERVICE_TYPES } from '../runtime/venture/contracts.ts';

test('the fake engine\'s order agents are the engine\'s: every playbook with a plan, its agent roles in step order', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../app/ui/src/engine/fixtures-order-agents.json', import.meta.url), 'utf8')) as { id: string; agents: { name: string; does: string }[]; code: string[] }[];
  // code: the names of the playbook's code roles, which join the team too, so no other agent may take one (fix round 4).
  const real = PLAYBOOK_REGISTRY.filter(entry => flagshipPlanById(entry.id)).map(entry => ({
    id: entry.id, agents: (flagshipDelivery(entry.id)?.roles ?? []).filter(role => role.kind === 'agent').map(role => ({ name: role.name, does: role.job })),
    code: (flagshipDelivery(entry.id)?.roles ?? []).filter(role => role.kind === 'code').map(role => role.name),
  })).filter(entry => entry.agents.length > 0);
  assert.deepEqual(snapshot, real);
  // The plan's own reader gives the same agents for the same playbook, and the delivery agent for none.
  for (const entry of real) assert.deepEqual(orderAgentsOfPlan(entry.id, 'other'), { agents: entry.agents, flagship: true, code: entry.code });
  assert.deepEqual(orderAgentsOfPlan(null, 'local-services'), { agents: [{ name: 'Bookings agent', does: DELIVERY_JOB }], flagship: false });
});

test('the one delivery agent has a name for every service type, and says no more than it does where no order flow fits', () => {
  assert.deepEqual(Object.keys(DELIVERY_AGENT_NAMES).sort(), [...SERVICE_TYPES].sort());
  for (const type of SERVICE_TYPES) assert.deepEqual(deliveryAgent(type), { name: DELIVERY_AGENT_NAMES[type], does: type === 'other' ? OWN_ORDER_JOB : DELIVERY_JOB });
  assert.deepEqual(deliveryAgent('unheard-of'), { name: 'Delivery agent', does: OWN_ORDER_JOB });
  assert.equal(orderAgentsFor('I make pottery by hand and sell mugs to cafes.').agents[0]!.name, 'Delivery agent');
});
