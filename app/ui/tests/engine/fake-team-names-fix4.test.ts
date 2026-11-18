import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { fakeTeamCheck } from '../../src/engine/fake-hire';
import { fakeOrderAgents } from '../../src/engine/fake-order-agents';
import { keptTeamWith } from '../../../../platform/runtime/venture/agents/team-proposal';

// Fix round 4 (the real-app tour of 16 Nov 2026, problem 8): no two agents in one business show the same name. The fake
// holds a hired agent's name apart from the names the plan's own team takes, as the engine does (chief/routing.ts
// teamNames; platform/tests/venture-team-names-fix4.test.ts), and keeps a proposed team with the engine's own rule.
const SALON = 'I run a home salon and take bookings by WhatsApp';

describe('fake engine: agent names are one each', () => {
  it('a hand hire may not take the name of an agent the plan will bring, before the plan is accepted', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    await client.request('workspace.create', { name: 'Home salon', pack: 'services', folder: null } as never);
    await client.request('venture.create', { idea: SALON, countryCode: 'IN' } as never);
    const made = await client.request('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar' });
    for (const name of ['Reader', 'writer', 'Billing', 'Chausar', 'Keeper']) {
      await expect(client.request('venture.agents.hire.answer', { hireId: made.id, phase: 'role', edits: { name } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    }
    expect((await client.request('venture.agents.hire.answer', { hireId: made.id, phase: 'role', edits: { name: 'Tara' } })).phase).toBe('reads');
  });

  it('a proposed agent that is an order agent by name and work is merged into it, and one with other work is named after what it does', () => {
    const order = fakeOrderAgents(SALON, () => 'local-services');
    expect(order.agents.map((agent) => agent.name)).toEqual(['Reader', 'Writer']);
    expect([...(order.code ?? [])].sort()).toEqual(['Billing', 'Chausar']);
    const reader = { name: 'Reader', job: 'Keeps order enquiries organised for you.', duties: ['Lists missing order details for you.', 'Drafts order confirmations for you to approve.'], reads: ['clients', 'orders', 'notes'], department: 'operations' };
    const tracker = { name: 'Writer', job: 'Tracks customer follow ups for you.', duties: ['Tracks customer replies for you.'], reads: ['clients', 'trackers'], department: 'sales' };
    expect(keptTeamWith(fakeTeamCheck, [reader, tracker], { offers: [{ name: 'Home visit' }], orderAgents: order }).map((agent) => agent.name)).toEqual(['Tracker']);
  });
});
