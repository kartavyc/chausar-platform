// Fix round 4 (the real-app tour of 16 Nov 2026, problem 8): no two agents in one business show the same name, and one
// run names one agent on every screen. Found: the AI proposed a "Reader" and the booking desk's order crew adds its own
// "Reader"; the desk also had a code role called "Keeper" with the id of Chausar's own Keeper, so Team listed Keeper
// twice (a playbook's code is named Chausar, as in every other playbook); and one order was "Run by Bookings agent" on Work (the service type's name for the one delivery agent, which
// is not on a playbook's team at all) and "Run by Writer" on its model receipt (the role its job ran as).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeamListView } from '../runtime/venture/contracts.ts';
import { checkTeamHire } from '../runtime/venture/agents/hire-check.ts';
import { keptTeamWith, teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { orderAgentsFor } from '../runtime/venture/agents/order-agents.ts';
import { PLAYBOOK_REGISTRY } from '../runtime/venture/playbooks/registry.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { KEEPER_ID, KEEPER_NAME } from '../runtime/venture/views/keeper.ts';
import { AGENT_ID } from '../runtime/venture/views/shared.ts';
import { runModelReceipt } from '../runtime/venture/money/model-receipt.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { agentBusiness, consent } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';
import { awaitingStep } from './venture-views-env.ts';

const SALON = 'I run a home salon and take bookings by WhatsApp';
const ORDER = orderAgentsFor(SALON);
const OFFERS = [{ name: 'Home visit' }];
const kept = (team: unknown) => keptTeamWith(checkTeamHire, team, { offers: OFFERS, orderAgents: ORDER }).map(agent => agent.name);
// The three agents the owner's AI proposed in the real app, word for word.
const READER = { name: 'Reader', job: 'Keeps order enquiries organised for you.', duties: ['Lists missing order details for you.', 'Drafts order confirmations for you to approve.'], reads: ['clients', 'orders', 'notes'], department: 'operations' };
const SCOUT = { name: 'Scout', job: 'Finds possible office and event planner customers for you.', duties: ['Lists possible customers for you to review.', 'Drafts outreach messages for you to approve.'], reads: ['clients', 'plan', 'notes'], department: 'sales' };
const TRACKER = { name: 'Tracker', job: 'Tracks customer follow ups for you.', duties: ['Tracks customer replies for you.', 'Reminds you of follow ups due.'], reads: ['clients', 'orders', 'trackers'], department: 'sales' };

test('no playbook role takes the name or the id of Chausar\'s own agents, and a playbook\'s names are its own once each', () => {
  for (const entry of PLAYBOOK_REGISTRY) {
    const roles = flagshipDelivery(entry.id)?.roles ?? [];
    const names = roles.map(role => role.name.toLowerCase());
    assert.equal(new Set(names).size, names.length, `${entry.id}: a role name twice`);
    for (const role of roles) {
      assert.ok(role.id !== KEEPER_ID && role.id !== AGENT_ID, `${entry.id}: the role id ${role.id} is Chausar's own`);
      // A playbook's code is named Chausar, as the engine itself is; Keeper is the one agent every team has.
      assert.ok(role.name.toLowerCase() !== KEEPER_NAME.toLowerCase(), `${entry.id}: the role name ${role.name} is Keeper's own`);
    }
  }
  // The booking desk's order crew, as the owner is shown it, and the names its code roles take.
  assert.deepEqual(ORDER.agents.map(agent => agent.name), ['Reader', 'Writer']);
  assert.deepEqual([...ORDER.code!].sort(), ['Billing', 'Chausar']);
});

test('a proposed agent that is an order agent by name and by work is merged into it; the rest stay', () => {
  assert.deepEqual(kept([READER, SCOUT, TRACKER]), ['Scout', 'Tracker']);
  // The same three with no playbook's crew to clash with are all kept.
  assert.deepEqual(keptTeamWith(checkTeamHire, [READER, SCOUT, TRACKER], { offers: OFFERS, orderAgents: orderAgentsFor('I bake cakes to order from my home kitchen.') }).map(agent => agent.name), ['Reader', 'Scout', 'Tracker']);
});

test('a proposed agent with a taken name and other work is named after what it does, never with a number', () => {
  const followUps = { ...TRACKER, name: 'Writer' };
  assert.deepEqual(kept([followUps]), ['Tracker'], 'Tracks: Tracker');
  assert.deepEqual(kept([TRACKER, followUps]), ['Tracker', 'Reminder'], 'Tracker is taken by then, so its next act names it');
  assert.deepEqual(kept([{ ...SCOUT, name: 'Billing' }]), ['Scout'], 'a code role\'s name is taken too');
  assert.deepEqual(kept([SCOUT, { ...TRACKER, name: 'scout' }]), ['Scout', 'Tracker'], 'two proposed agents never share a name');
  // Renamed, the card is the renamed agent's own: its digest is of the words the owner reads.
  const [card] = keptTeamWith(checkTeamHire, [followUps], { offers: OFFERS, orderAgents: ORDER });
  assert.equal(card!.digest, teamCardDigest({ ...TRACKER, name: 'Tracker' } as never));
  for (const name of kept([TRACKER, followUps, { ...SCOUT, name: 'Reader' }])) assert.ok(!/\d/.test(name), name);
  // No act of its own gives a free name: it is left out, and the owner can hire it by hand under a name of their own.
  assert.deepEqual(kept([TRACKER, { name: 'Tracker', job: 'Tracks supplier bills for you.', duties: ['Tracks supplier due dates for you.'], reads: ['money'], department: 'money' }]), ['Tracker']);
});

test('hiring by hand refuses every name on the team and every name the plan will bring', async () => {
  const env = await agentBusiness(SALON);
  await consent(env, 'reader');
  const team = await env.call('venture.team.list') as TeamListView;
  const names = team.agents.map(agent => agent.name);
  assert.deepEqual([...names].sort(), ['Billing', 'Chausar', 'Keeper', 'Reader', 'Writer']);
  assert.equal(names.at(-1), 'Keeper');
  assert.equal(new Set(team.agents.map(agent => agent.id)).size, team.agents.length, 'and no id twice');
  env.models.respond['agent-chat'] = task => (task.schemaName === 'venture-hire-role' ? { name: 'Mira', job: 'Keeps the content calendar.', duties: ['Keeps the content calendar up to date'] } : { reads: [] });
  const made = await env.agents('venture.agents.hire.start', { sentence: 'someone who keeps my content calendar' });
  for (const name of ['Reader', 'writer', 'Chausar', 'Billing', 'Keeper']) {
    await assert.rejects(env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'role', edits: { name } }), { code: 'INVALID_VENTURE_REQUEST' }, name);
  }
  assert.equal((await env.agents('venture.agents.hire.answer', { hireId: made.id, phase: 'role', edits: { name: 'Mira' } })).phase, 'reads');
  // The team the owner keeps at setup is held to the same names (a card made before this rule, or by hand).
  const card = { ...SCOUT, name: 'Billing' };
  await assert.rejects(env.agents('venture.agents.hire.team', { agents: [{ ...card, digest: teamCardDigest(card as never) }] }), { code: 'INVALID_VENTURE_REQUEST' });
});

test('one run names one agent: Work, Today and the run\'s model receipt all say the agent the job ran as', async () => {
  const env = await agentBusiness(SALON);
  const order = await env.call('venture.order.create', { clientId: env.client.id, offerId: env.offers[0]!.id, quantity: '1', request: 'A haircut at home on Friday afternoon.' });
  const run = await ventureAction(env.deps, owner, 'prepare', 'seed.run', tx => tx.put({
    ...tx.base('venture-delivery-run'), lifecycle: 2, orderId: order.id, playbookId: 'playbook_missing', playbookHash: 'hash', status: 'working', servedBy: 'model',
    practice: false, callId: null, preview: null, deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
    agentJob: { ...awaitingStep(), scope: { ...awaitingStep().scope, agentId: 'writer' } },
  } as never));
  const state = env.store.read(), venture = currentVenture(state)!;
  const stored = listRecords(state, 'venture-delivery-run', venture.id).find(item => item.id === (run as { id: string }).id)!;
  const receipt = runModelReceipt(state, venture, stored);
  assert.equal(receipt.agent, 'Writer');
  const runs = await env.call('venture.runs.list', {});
  const row = runs.runs.find((item: { runId: string }) => item.runId === stored.id);
  assert.equal(row.agent, 'Writer', 'Work and the run sheet');
  const team = (await env.call('venture.team.list') as TeamListView).agents.map(agent => agent.name);
  assert.ok(team.includes(row.agent), 'a name on the team');
  assert.ok(!JSON.stringify(runs).includes('Bookings agent'), 'the service type\'s name for the one delivery agent is not on a playbook\'s team');
  const queue = await env.call('venture.queue.list', {});
  assert.ok(!JSON.stringify(queue).includes('Bookings agent'));
});
