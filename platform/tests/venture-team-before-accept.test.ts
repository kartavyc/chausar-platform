// The team is built at setup (founder, 14 Nov 2026): the agents the owner hired when they kept their plan show on Team,
// are known to routing and can be opened and chatted with before the plan is accepted. The agents that come from the
// plan's delivery steps, and Keeper, still wait for the plan; Team says so in one line beside the hired ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeamListView } from '../runtime/venture/contracts.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';
import { teamCardDigest } from '../runtime/venture/agents/team-proposal.ts';
import { teamAgents } from '../runtime/venture/chief/routing.ts';
import { TEAM_WAITS_FOR_PLAN } from '../runtime/venture/views/team.ts';
import { currentVenture, ventureAction } from '../runtime/venture/records.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { call, code, owner, seedBlueprint, setup, type Env } from './venture-views-env.ts';
import { agentBusiness, asAnswer, consent, said } from './venture-agent-helpers.ts';

const SCOUT = { name: 'Asha', job: 'Finds cafes that buy tableware in bulk.', duties: ['Lists cafes in Pune from public listings', 'Flags the ones that fit your sets'], reads: ['plan', 'trackers'] };
const WRITER = { name: 'Kabir', job: 'Drafts quotes for your approval.', duties: ['Drafts a quote for each enquiry'], reads: ['plan', 'clients'] };
const card = (agent: typeof SCOUT) => ({ ...agent, digest: teamCardDigest(agent as never) });
const agents = (env: Env, method: string, payload: unknown = {}): Promise<any> => (agentHandlers as any)[method](env.deps, owner, payload);

test('hired agents show on Team before the plan is accepted, with one line for the agents the plan brings', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const empty = await call<TeamListView>(env, 'venture.team.list');
  assert.deepEqual([empty.agents, empty.waitsForPlan], [[], undefined], 'nobody hired, no plan: no team');
  const { hired } = await agents(env, 'venture.agents.hire.team', { agents: [card(SCOUT), card(WRITER)] });
  const team = await call<TeamListView>(env, 'venture.team.list');
  assert.deepEqual(team.agents.map(agent => [agent.id, agent.name, agent.role, agent.posture, agent.department, agent.kind, agent.state, agent.chat]), [
    [hired[0].id, 'Asha', SCOUT.job, 'approve-each', 'operations', 'agent', 'idle', true],
    [hired[1].id, 'Kabir', WRITER.job, 'approve-each', 'operations', 'agent', 'idle', true],
  ], 'the hired agents only: the plan\'s agents and Keeper wait for the plan');
  assert.deepEqual(team.agents[0]!.hired!.duties, SCOUT.duties);
  assert.match(team.agents[0]!.hired!.line, /^Hired by you on /);
  assert.equal(team.waitsForPlan, TEAM_WAITS_FOR_PLAN);
  assert.ok(!/[\u2014\u2013]/.test(TEAM_WAITS_FOR_PLAN));
  // The counts line and the departments count them where they sit.
  const operations = team.departments!.find(department => department.id === 'operations')!;
  assert.deepEqual(operations.counts, { working: 0, waiting: 0, stopped: 0, idle: 2 });
  assert.equal(team.teamHealth, undefined, 'no run has happened, so the team has no health of its own yet');
  // Each is introduced once, like any new agent.
  assert.deepEqual(team.introduce!.map(item => item.agentId), hired.map((view: any) => view.id));
  // Routing knows them by name, and each has a thread to open.
  const state = env.store.read(), venture = currentVenture(state)!;
  assert.deepEqual(teamAgents(state, venture), [{ id: hired[0].id, name: 'Asha', job: SCOUT.job }, { id: hired[1].id, name: 'Kabir', job: WRITER.job }]);
  const thread = await agents(env, 'venture.agents.thread.list', { agent: hired[0].id });
  assert.deepEqual(thread.agent, { id: hired[0].id, name: 'Asha', role: SCOUT.job });
  // The plan's own agent and Keeper still wait for the plan, as do gates.
  await assert.rejects(agents(env, 'venture.agents.thread.list', { agent: 'delivery' }), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.team.gate', { agentId: hired[0].id, stepId: 'draft', gate: 'hold' }), code('AGENT_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.team.posture', { agentId: hired[0].id, posture: 'approve-each' }), code('HIRE_POSTURE_FIXED'));
});

test('once the plan is accepted the plan\'s agents and Keeper join, and the line goes', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const { hired } = await agents(env, 'venture.agents.hire.team', { agents: [card(SCOUT)] });
  await seedBlueprint(env, { version: 2, price2: '1500000' });
  const team = await call<TeamListView>(env, 'venture.team.list');
  assert.equal(team.waitsForPlan, undefined);
  assert.deepEqual(team.agents.map(agent => agent.id), ['delivery', hired[0].id, 'keeper']);
});

test('a retired hire is not on the team before the plan either; the Retired shelf holds it', async () => {
  const env = await setup();
  await seedBlueprint(env, { status: 'draft' });
  const { hired } = await agents(env, 'venture.agents.hire.team', { agents: [card(SCOUT), card(WRITER)] });
  const check = await agents(env, 'venture.agents.retire.check', { agent: hired[0].id });
  await agents(env, 'venture.agents.retire', { agent: hired[0].id, to: 'owner', digest: check.digest });
  const team = await call<TeamListView>(env, 'venture.team.list');
  assert.deepEqual(team.agents.map(agent => agent.id), [hired[1].id]);
  assert.deepEqual(team.retired!.map(item => item.id), [hired[0].id], 'so it can be brought back');
  const state = env.store.read();
  assert.deepEqual(teamAgents(state, currentVenture(state)!).map(agent => agent.id), [hired[1].id]);
});

test('a hired agent answers in chat before the plan is accepted, and the first message still asks for the chat consent', async () => {
  const env = await agentBusiness();
  const { hired } = await env.agents('venture.agents.hire.team', { agents: [card(SCOUT)] });
  // The same business before its plan was accepted: the plan drafted, not accepted, and no playbook stored.
  await ventureAction(env.deps, owner, 'admin', 'seed.unaccept', tx => { tx.touch({ acceptedBlueprintId: null, status: 'blueprint' }); });
  const team = await (viewHandlers as any)['venture.team.list'](env.deps, owner, {});
  assert.deepEqual(team.agents.map((agent: any) => agent.id), [hired[0].id]);
  const asked: any[] = [];
  env.models.respond['agent-chat'] = task => { asked.push(task); return asAnswer({ parts: [said('Here are the cafes I would list first.')] }); };
  await assert.rejects(env.agents('venture.agents.thread.send', { agent: hired[0].id, text: 'Which cafes would you list first?' }), code('CHAT_CONSENT_REQUIRED'));
  assert.equal(asked.length, 0, 'nothing was sent before the consent');
  await consent(env, hired[0].id);
  const sent = await env.agents('venture.agents.thread.send', { agent: hired[0].id, text: 'Which cafes would you list first?' });
  assert.equal(sent.added.at(-1).message.parts[0].text, 'Here are the cafes I would list first.');
  assert.equal(asked.at(-1).schemaName, 'venture-agent-answer');
});

test('the month\'s AI spend on Team: on the owner\'s own AI plan nothing is priced, so a zero says that and shows no price', async () => {
  const env = await agentBusiness();
  const spend = async () => (await (viewHandlers as any)['venture.team.list'](env.deps, owner, {})).totals.spendThisMonth;
  // On a key every call has a price, so nothing spent yet is a figure: rupees first for a rupee business (the reference rate until the owner types one).
  assert.deepEqual((await spend()).lead, { currency: 'INR', figure: '₹0', beside: '$0.00 at ₹94.40 per $1', other: '$0.00' });
  // The owner's own Codex on this computer: calls are counted on their plan, never priced.
  const status = env.models.status.bind(env.models);
  const onCodex = (tier: any) => ({ ...tier, presetId: 'codex-cli', model: 'codex' });
  env.models.status = () => { const now = status(); return { ...now, tiers: { fast: onCodex(now.tiers.fast), main: onCodex(now.tiers.main) } }; };
  const counted = await spend();
  assert.deepEqual(counted.lead, { currency: 'USD', figure: 'On your own AI plan' });
  assert.equal(counted.display, '$0.00', 'the receipt keeps the sum it proved');
  assert.match(counted.receiptId, /^sum_/);
  // One tier on a key: a price can come, so the figure stays.
  env.models.status = () => { const now = status(); return { ...now, tiers: { fast: onCodex(now.tiers.fast), main: now.tiers.main } }; };
  assert.equal((await spend()).lead.figure, '₹0');
});
