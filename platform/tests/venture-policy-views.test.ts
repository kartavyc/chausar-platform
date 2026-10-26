// P2-posture: what the owner sees of the policy. The team shows the posture the agent really works at (the business
// stage tightened by the agent's own) and gates on hold until the owner sets them; Today offers Let it run and Keep on
// hold for a held call; spot checks at auto with spot checks pick runs by a fixed rule and wait on Today for review.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentView, DeliveryRunRecord, QueueDecision, QueueList, QueueRow } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { HOLD_APPROVE_ANSWER, HOLD_DECLINE_ANSWER } from '../runtime/venture/policy/holds.ts';
import { setAgentPosture } from '../runtime/venture/policy/context.ts';
import { recordSpotCheck, sampleRun, SPOT_CHECK_RULE } from '../runtime/venture/policy/spot-check.ts';
import { CLIENT_NAME, call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const team = (env: Env) => call<{ agents: AgentView[] }>(env, 'venture.team.list').then(result => result.agents);
const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const decide = (env: Env, row: QueueRow, action: string, extra: Record<string, unknown> = {}) =>
  call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action, ...extra });

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

const PREVIEW = {
  callId: 'call_2', payloadText: '{"system":"..."}', digest: 'c'.repeat(64), presetId: 'anthropic-sonnet-5-5' as const, model: 'claude-sonnet-5-5',
  endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '1000', estimatedMaxCostDisplay: 'USD 0.0010', expiresAt: '2026-10-15T10:30:00.000Z',
};

async function heldRun(env: Env) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  env.models.connected = true;
  (env.models as unknown as { preview: () => Promise<typeof PREVIEW> }).preview = async () => PREVIEW;
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const question = 'Read the files is on hold, so it waits for you. The agent wants to run files.list. Let it run once?';
  return seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer',
    harness: harness({
      phase: 'needs-answer', used: { turns: 1, toolCalls: 0, costMicros: '1000' },
      handoffs: [{ to: 'owner', question, turn: 1, answer: null, answeredBy: null }],
      holds: [{ id: 'h1.1', toolCallId: 't1.1', tool: 'files.list', stepId: 'gather', inputDigest: 'd'.repeat(64), code: 'step_on_hold', reason: 'Read the files is on hold, so it waits for you.', turn: 1, handoff: 0, status: 'waiting', validTurn: null }],
    }),
  });
}

test('queue: a held call is a question with Let it run once and Keep on hold; approving answers with the exact approve words', async () => {
  const env = await setup();
  const run = await heldRun(env);
  const [row] = (await list(env)).rows.filter(item => item.kind === 'question');
  assert.equal(row.title, `Bookkeeping agent wants to run a step on hold for ${CLIENT_NAME}`);
  assert.equal(row.line, 'Read the files is on hold, so it waits for you. The agent wants to run files.list. Let it run once?');
  assert.deepEqual(row.actions.map(action => [action.id, action.label, action.primary]), [['deny', 'Keep on hold', false], ['approve', 'Let it run once', true]]);
  assert.deepEqual(row.viewRef, { kind: 'run', id: run.id });
  const done = await decide(env, row, 'approve');
  assert.deepEqual([done.outcome, done.line], ['done', 'It runs once, in the next step.']);
  const stored = listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id) as DeliveryRunRecord;
  assert.equal(stored.harness?.handoffs[0].answer, HOLD_APPROVE_ANSWER);
  assert.deepEqual(stored.harness?.holds?.map(hold => [hold.status, hold.validTurn]), [['approved', 2]]);
  assert.equal(stored.status, 'waiting-for-you', 'the next turn waits for the owner like every other');
});

test('queue: Keep on hold declines the held call and tells the agent to go on without it', async () => {
  const env = await setup();
  const run = await heldRun(env);
  const [row] = (await list(env)).rows.filter(item => item.kind === 'question');
  const done = await decide(env, row, 'deny');
  assert.deepEqual([done.outcome, done.line], ['done', 'Kept on hold. The agent goes on without it.']);
  const stored = listRecords(env.store.read(), 'venture-delivery-run').find(item => item.id === run.id) as DeliveryRunRecord;
  assert.equal(stored.harness?.handoffs[0].answer, HOLD_DECLINE_ANSWER);
  assert.equal(stored.harness?.holds?.[0].status, 'declined');
});

// ---------------------------------------------------------------------------
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
