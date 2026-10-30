// P2-posture: what the owner sees of the policy. The team shows the posture the agent really works at (the business
// stage tightened by the agent's own) and gates on hold until the owner sets them; Today offers Let it run and Keep on
// hold for a held call; spot checks at auto with spot checks pick runs by a fixed rule and wait on Today for review.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, QueueList } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { setAgentPosture } from '../runtime/venture/policy/context.ts';
import { recordSpotCheck, sampleRun, SPOT_CHECK_RULE } from '../runtime/venture/policy/spot-check.ts';
import { call, code, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const team = (env: Env) => call<{ agents: AgentView[] }>(env, 'venture.team.list').then(result => result.agents);
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});

// ---------------------------------------------------------------------------
// 1. The team
// ---------------------------------------------------------------------------

test('team: the posture is the business stage tightened by the agent, never loosened', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await setStage(env, 'approve-each');
  assert.equal((await team(env))[0].posture, 'approve-each');
  await setAgentPosture(env.deps, owner, 'delivery', 'shadow');
  assert.equal((await team(env))[0].posture, 'shadow');
  await setAgentPosture(env.deps, owner, 'delivery', 'auto-spot-check');
  assert.equal((await team(env))[0].posture, 'approve-each', 'looser than the business: the business posture stands');
  await setStage(env, 'approve-sample');
  assert.equal((await team(env))[0].posture, 'approve-each', 'approving a sample is planned, so it is approving each one');
});

test('team: gates start on hold at every posture, auto with spot checks included; the floor stays on hold', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await setStage(env, 'auto-spot-check');
  const [agent] = await team(env);
  // Ink v2 wave 4 (4J15): auto with spot checks is locked, so a vault whose stage says auto works at approve each.
  assert.equal(agent.posture, 'approve-each');
  assert.ok(agent.steps.every(step => step.gate === 'hold'), 'nothing runs alone until the owner says so, step by step');
  const { agent: after } = await call<{ agent: AgentView }>(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  assert.equal(after.steps.find(step => step.id === 'work')?.gate, 'auto');
  assert.deepEqual(after.steps.filter(step => step.floor).map(step => [step.id, step.gate]), [['send', 'hold']]);
});

// ---------------------------------------------------------------------------
// 2. A held call on Today
// ---------------------------------------------------------------------------

// Per-turn held-call questions were retired. Exact native approvals are exercised by agent-approvals-w6.test.ts.

// 3. Spot checks at auto with spot checks
// ---------------------------------------------------------------------------

test('spot checks: a fixed rule, every fifth run plus every run that spent more than the line; no chance involved', () => {
  assert.deepEqual(SPOT_CHECK_RULE, { everyNth: 5, overMicros: '200000' });
  const picked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(ordinal => sampleRun(ordinal, '1000').sampled);
  assert.deepEqual(picked, [false, false, false, false, true, false, false, false, false, true]);
  assert.deepEqual(sampleRun(5, '1000'), { sampled: true, reason: 'every-nth', line: 'One run in five is checked, and this is one.' });
  assert.deepEqual(sampleRun(2, '250000'), { sampled: true, reason: 'over-spend', line: 'This run spent USD 0.2500, more than USD 0.2000.' });
  assert.equal(sampleRun(5, '250000').reason, 'over-spend', 'the spend line wins when both pick a run');
  assert.deepEqual(sampleRun(2, '200000'), { sampled: false, reason: null, line: 'Not picked: not one run in five, and it spent no more than USD 0.2000.' });
  assert.deepEqual(sampleRun(3, '0', { everyNth: 1, overMicros: '0' }).reason, 'every-nth');
  assert.throws(() => sampleRun(0, '1000'), code('INVALID_VENTURE_REQUEST'));
  assert.throws(() => sampleRun(1, '1.5'), code('INVALID_AMOUNT'));
  assert.throws(() => sampleRun(1, '10', { everyNth: 0, overMicros: '0' }), code('INVALID_VENTURE_REQUEST'));
});

test('spot checks: while auto with spot checks is locked no run is recorded for one, even in a vault whose stage says auto', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  // Ink v2 wave 4 (4J15): the policy caps every posture at approve each (policy/auto-lock.ts), so the owner approves each run.
  await setStage(env, 'auto-spot-check');
  const run = await seedRun(env, order, { status: 'ready-for-review' });
  await assert.rejects(ventureAction(env.deps, owner, 'prepare', 'seed.spot', tx => recordSpotCheck(tx, { runId: run.id, spendMicros: '300000' })), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-spot-check').length, 0);
  assert.equal((await list(env)).rows.filter(row => row.id.startsWith('spot:')).length, 0);
});
