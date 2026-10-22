// P1-A: the team (venture.team.list and venture.team.gate) from the playbook, the launch ladder and the model calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, DeliveryRunRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { call, code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const team = (env: Env) => call<{ agents: AgentView[] }>(env, 'venture.team.list').then(result => result.agents);
const gate = (env: Env, stepId: string, value: 'auto' | 'hold', agentId = 'delivery', ctx = owner) =>
  call<{ agent: AgentView }>(env, 'venture.team.gate', { agentId, stepId, gate: value }, ctx);

test('team: no agents before a plan is accepted; then one agent from the playbook, every gate on hold, the send step on the floor', async () => {
  const env = await setup();
  assert.deepEqual(await team(env), []);
  await seedBlueprint(env, { price2: '1500000' });
  const [agent] = await team(env);
  assert.deepEqual({ id: agent.id, name: agent.name, posture: agent.posture, now: agent.now, spend: agent.spend, last: agent.last },
    { id: 'delivery', name: 'Bookkeeping agent', posture: 'rehearsal', now: 'Idle', spend: 'USD 0.0000', last: undefined });
  assert.equal(agent.role, 'Reads each order, works on it with tools, and drafts the reply for you to check.');
  assert.deepEqual(agent.steps.map(step => [step.id, step.gate, step.floor]), [
    ['gather', 'hold', false], ['clarify', 'hold', false], ['work', 'hold', false], ['price', 'hold', false],
    ['draft', 'hold', false], ['verify', 'hold', false], ['approve', 'hold', false], ['send', 'hold', true],
  ]);
  assert.equal(agent.steps[0].purpose, "Read the client's message and files and pull out what is needed");
  assert.deepEqual(listRecords(env.store.read(), 'venture-playbook'), [], 'reading the team builds no playbook');
});

test('team.gate: loosening a step is stored; the always-ask floor refuses auto; tightening is always allowed', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  const { agent } = await gate(env, 'draft', 'auto');
  assert.equal(agent.steps.find(step => step.id === 'draft')?.gate, 'auto');
  assert.equal((await team(env))[0].steps.find(step => step.id === 'draft')?.gate, 'auto');
  const [record] = listRecords(env.store.read(), 'venture-team-gate');
  assert.deepEqual([record.agentId, record.stepId, record.gate, record.memberId], ['delivery', 'draft', 'auto', 'owner']);

  await assert.rejects(gate(env, 'send', 'auto'), (error: any) => error.code === 'GATE_FLOOR' && error.message === 'Sending to a client or the public always asks you first.');
  assert.equal((await gate(env, 'send', 'hold')).agent.steps.find(step => step.id === 'send')?.gate, 'hold');
  assert.equal((await gate(env, 'draft', 'hold')).agent.steps.find(step => step.id === 'draft')?.gate, 'hold', 'the newest gate wins');

  await assert.rejects(gate(env, 'draft', 'auto', 'designer'), code('AGENT_NOT_FOUND'));
  await assert.rejects(gate(env, 'publish', 'auto'), code('STEP_NOT_FOUND'));
  await assert.rejects(gate(env, 'draft', 'auto', 'delivery', phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'draft', gate: 'sometimes' }), code('INVALID_VENTURE_REQUEST'));
});

test('team: posture follows the launch ladder; now, spend and the last result come from runs and model calls', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer',
    harness: harness({ phase: 'needs-answer', handoffs: [{ to: 'owner', question: 'Which account?', turn: 1, answer: null, answeredBy: null }] }),
  });
  // Spend: the agent's own calls only (a draft and an agent turn), not rehearsal or plan calls.
  // 2000 + 1000 = 3000 micros = USD 0.0030; the plan call (500) is someone else's.
  await ventureAction(env.deps, owner, 'prepare', 'seed.calls', tx => {
    const call = (id: string, purpose: string, costMicros: string | null, priceConfirmed = true) =>
      tx.state.conversations.push({ id, kind: 'venture-model-call', ventureId: tx.venture!.id, purpose, costMicros, priceConfirmed, status: 'completed' });
    call('call_a', 'delivery', '2000'); call('call_b', 'agent-turn', '1000'); call('call_c', 'blueprint', '500'); call('call_d', 'agent-turn', null);
  });
  const [agent] = await team(env);
  assert.equal(agent.posture, 'approve-each');
  assert.equal(agent.now, 'Waiting on you: Decide what is still unclear');
  assert.equal(agent.spend, 'USD 0.0030');
  assert.deepEqual(agent.last, { line: 'Draft for Cafe Aroma Demo accepted.' });
  await ventureAction(env.deps, owner, 'prepare', 'seed.unconfirmed', tx => {
    tx.state.conversations.push({ id: 'call_e', kind: 'venture-model-call', ventureId: tx.venture!.id, purpose: 'delivery', costMicros: '1000', priceConfirmed: false, status: 'completed' });
  });
  assert.equal((await team(env))[0].spend, 'USD 0.0040 (estimate, price unconfirmed)');
  await setStage(env, 'shadow');
  assert.equal((await team(env))[0].posture, 'shadow');
});
