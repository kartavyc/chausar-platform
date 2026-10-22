// P2-posture: the policy wired into the delivery harness. Every tool call is checked before it runs, a held call
// waits for the owner as a question on Today, an approval lets exactly that call run once, a policy that fails blocks
// the call, and the heavy-work start (an outside effect on the owner's own signed-in tool) needs the owner's approval
// bound to the brief. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DelegationRequest, HarnessState, PlaybookRecord, ScenarioKind, ToolName } from '../runtime/venture/contracts.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { answerHandoff, applyTurn, DEFAULT_LIMITS, newHarnessState, startDelegation } from '../runtime/venture/delivery/harness/loop.ts';
import { buildToolEnv } from '../runtime/venture/delivery/harness/env.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { digest, listRecords } from '../runtime/venture/records.ts';
import { HOLD_APPROVE_ANSWER, HOLD_DECLINE_ANSWER } from '../runtime/venture/policy/holds.ts';
import { harnessPolicyContext, setAgentPosture } from '../runtime/venture/policy/context.ts';
import type { HarnessPolicy, PolicyContext } from '../runtime/venture/policy/ladder.ts';
import type { Policy } from '../runtime/venture/policy/verdict.ts';
import { call as viewCall, owner, seedBlueprint, setStage, setup } from './venture-views-env.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const practice = (kind: ScenarioKind) => practiceFiles({ id: `bookkeeping-${kind}`, serviceType: 'bookkeeping', source: 'template' });
const turn = (calls: [string, unknown][], finished = false, note = 'Work on the files') => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const meta = { by: 'model' as const, callId: 'call_1', costMicros: '1000' };
const GRANT: ToolName[] = ['files.list', 'files.read', 'calc.sum', 'handoff.owner', 'outbox.propose'];

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    posture: 'approve-each', approval: { kind: 'none' }, gates: { gather: 'hold', work: 'auto' },
    stepsByTool: { 'files.list': ['gather'], 'files.read': ['gather', 'work'], 'calc.sum': ['work'], 'handoff.owner': ['gather'] },
    stepTitles: { gather: 'Read the files', work: 'Do the hands-on work' }, ...over,
  };
}

function toolEnv(runRef: ToolEnv['runRef'], policy?: HarnessPolicy, kind: ScenarioKind = 'clean'): ToolEnv {
  return {
    deps: { services: {} } as never, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef,
    files: practice(kind), tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => '2026-10-21T10:00:00.000Z', allowed: [],
    ...(policy ? { policy } : {}),
  };
}
const REAL = { kind: 'delivery' as const, runId: 'delivery_1' };
const REHEARSAL = { kind: 'rehearsal' as const, scenarioId: 'bookkeeping-clean', episode: 0 };
const run = (env: ToolEnv, tool: string, input: unknown, holds: HarnessState['holds'] = []) =>
  callTool(env, GRANT, 1, 0, { tool, input: JSON.stringify(input) }, holds);
const error = (outcome: Awaited<ReturnType<typeof callTool>>) => outcome.record.envelope.ok ? null : outcome.record.envelope.error;

// ---------------------------------------------------------------------------
// 1. Each tool call is checked before it runs
// ---------------------------------------------------------------------------

test('tool call: a step on hold waits for the owner and nothing runs; the owner approving the turn lets it run', async () => {
  const held = await run(toolEnv(REAL, { context: context() }), 'files.list', {});
  assert.equal(held.record.outcome, 'cancelled');
  assert.deepEqual(error(held), { code: 'POLICY_ASK', name: 'PolicyAsk', message: 'Read the files is on hold, so it waits for you. The owner was asked; nothing ran.' });
  assert.deepEqual(held.hold && { tool: held.hold.tool, stepId: held.hold.stepId, code: held.hold.code }, { tool: 'files.list', stepId: 'gather', code: 'step_on_hold' });
  assert.equal(held.hold?.inputDigest, digest({}), 'bound to the checked input, not its spacing');
  assert.deepEqual([held.proofs, held.receipts, held.tables], [[], [], []]);

  const ran = await run(toolEnv(REAL, { context: context({ approval: { kind: 'owner-turn', callId: 'call_1' } }) }), 'files.list', {});
  assert.equal(ran.record.outcome, 'succeeded');
  assert.equal(ran.verdict?.code, 'owner_turn');
  assert.equal(ran.hold, null);
});

test('tool call: auto runs alone only at auto with spot checks; below that the posture waits for the owner', async () => {
  const input = { table: 'f2', amountColumn: 'Amount' };
  const below = await run(toolEnv(REAL, { context: context() }), 'calc.sum', input);
  assert.equal(error(below)?.code, 'POLICY_ASK');
  assert.equal(below.hold?.code, 'posture');
  const auto = await run(toolEnv(REAL, { context: context({ posture: 'auto-spot-check' }) }), 'calc.sum', input);
  assert.equal(auto.record.outcome, 'succeeded');
  assert.equal(auto.verdict?.code, 'auto');
});

test('tool call: a policy that throws or runs out of time blocks the call, which never starts', async () => {
  const boom: Policy<PolicyContext> = { id: 'boom', decide: () => { throw new Error('broken'); } };
  const thrown = await run(toolEnv(REAL, { context: context({ approval: { kind: 'owner-turn' } }), policies: [boom] }), 'files.list', {});
  assert.equal(thrown.record.outcome, 'failed');
  assert.deepEqual(error(thrown), { code: 'POLICY_DENIED', name: 'PolicyDenied', message: 'A check failed, so this was blocked.' });
  assert.equal(thrown.hold, null);
  const slow: Policy<PolicyContext> = { id: 'slow', decide: () => new Promise(resolve => setTimeout(() => resolve({ verdict: 'allow', code: 'late', reason: 'Late.' }), 200)) };
  const late = await run(toolEnv(REAL, { context: context({ approval: { kind: 'owner-turn' } }), policies: [slow], timeoutMs: 20 }), 'files.list', {});
  assert.deepEqual(error(late), { code: 'POLICY_DENIED', name: 'PolicyDenied', message: 'A check did not answer in time. A timeout is not an approval.' });
  const no: Policy<PolicyContext> = { id: 'no', decide: () => ({ verdict: 'deny', code: 'risky', reason: 'This run read bank statements.' }) };
  const refused = await run(toolEnv(REHEARSAL, { context: context({ approval: { kind: 'practice' } }), policies: [no] }), 'files.list', {});
  assert.equal(error(refused)?.message, 'This run read bank statements.');
});

test('tool call: without a policy a real order fails closed, made-up clients run under standing consent, and requests are only recorded', async () => {
  const real = await run(toolEnv(REAL), 'files.list', {});
  assert.equal(error(real)?.code, 'POLICY_ASK');
  assert.equal(real.hold?.stepId, null);
  const rehearsal = await run(toolEnv(REHEARSAL), 'files.list', {});
  assert.equal(rehearsal.record.outcome, 'succeeded');
  assert.equal(rehearsal.verdict?.code, 'practice');
  const proposed = await run(toolEnv(REAL), 'outbox.propose', { connector: 'mail-app', summary: 'Send the September report' });
  assert.equal(proposed.record.outcome, 'succeeded');
  assert.equal(proposed.verdict?.code, 'records_only');
  assert.deepEqual(proposed.verdict?.floor, ['send']);
  assert.equal(proposed.mock?.connector, 'mail-app', 'recorded for the owner, never sent');
});

// ---------------------------------------------------------------------------
// 2. A held call is a question for the owner; an approval covers that call once
// ---------------------------------------------------------------------------

test('loop: a held call ends the turn as a question for the owner; later calls do not run', async () => {
  const env = toolEnv(REAL, { context: context() });
  let state = newHarnessState(GRANT, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.list', {}], ['files.read', { target: 'f1', part: 'columns' }]]), meta);
  assert.equal(state.phase, 'needs-answer');
  assert.deepEqual(state.toolCalls.map(item => [item.id, item.outcome]), [['t1.1', 'cancelled'], ['t1.2', 'cancelled']]);
  assert.equal(!state.toolCalls[1].envelope.ok && state.toolCalls[1].envelope.error.message, 'A call on hold ended this turn, so this call did not run.');
  assert.equal(state.used.toolCalls, 0, 'nothing ran');
  assert.deepEqual(state.holds?.map(hold => [hold.id, hold.toolCallId, hold.tool, hold.stepId, hold.status, hold.turn, hold.handoff]), [['h1.1', 't1.1', 'files.list', 'gather', 'waiting', 1, 0]]);
  assert.deepEqual(state.handoffs, [{ to: 'owner', question: 'Read the files is on hold, so it waits for you. The agent wants to run files.list. Let it run once?', turn: 1, answer: null, answeredBy: null }]);
  assert.deepEqual(state.rounds?.[0].steps.map(step => [step.toolCallId, step.audited]), [['t1.1', false], ['t1.2', false]]);
  assert.ok(!/[0-9]/.test(state.handoffs[0].question), 'the question carries no digits');
});

test('loop: the owner approving a hold lets exactly that call run once, in the next turn; then it asks again', async () => {
  const env = toolEnv(REAL, { context: context() });
  let state = newHarnessState(GRANT, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.list', {}]]), meta);
  state = answerHandoff(state, HOLD_APPROVE_ANSWER, 'owner');
  assert.equal(state.phase, 'act');
  assert.deepEqual(state.holds?.map(hold => [hold.status, hold.validTurn]), [['approved', 2]]);
  assert.equal(state.handoffs[0].answer, HOLD_APPROVE_ANSWER);

  // A different input is a different call: still on hold.
  const other = await applyTurn(env, state, turn([['files.read', { target: 'f1', part: 'columns' }]]), meta);
  assert.equal(other.phase, 'needs-answer');
  assert.equal(other.holds?.[0].status, 'approved', 'the approval waits for its own call, but only this turn');

  state = await applyTurn(env, state, turn([['files.list', {}]]), meta);
  assert.deepEqual(state.toolCalls.map(item => [item.id, item.outcome]), [['t1.1', 'cancelled'], ['t2.1', 'succeeded']]);
  assert.deepEqual(state.holds?.map(hold => hold.status), ['used']);
  assert.equal(state.phase, 'act');
  state = await applyTurn(env, state, turn([['files.list', {}]]), meta);
  assert.equal(state.phase, 'needs-answer', 'single use: the same call asks again');
  assert.deepEqual(state.holds?.map(hold => [hold.id, hold.status]), [['h1.1', 'used'], ['h3.1', 'waiting']]);
});

test('loop: any other answer declines the hold, and only the owner can approve one', async () => {
  const env = toolEnv(REAL, { context: context() });
  const start = await applyTurn(env, newHarnessState(GRANT, DEFAULT_LIMITS, []), turn([['files.list', {}]]), meta);
  const declined = answerHandoff(start, 'Use the bills file instead.', 'owner');
  assert.deepEqual(declined.holds?.map(hold => [hold.status, hold.validTurn]), [['declined', null]]);
  assert.equal(declined.handoffs[0].answer, 'Use the bills file instead.');
  assert.equal(answerHandoff(start, HOLD_DECLINE_ANSWER, 'owner').holds?.[0].status, 'declined');
  assert.equal(answerHandoff(start, HOLD_APPROVE_ANSWER, 'practice-client').holds?.[0].status, 'declined', 'a practice client never approves');
  const after = await applyTurn(env, declined, turn([['files.list', {}]]), meta);
  assert.equal(after.phase, 'needs-answer');
});

// ---------------------------------------------------------------------------
// 3. The heavy-work start is an outside effect: the owner's approval bound to the brief
// ---------------------------------------------------------------------------

test('outside effect: starting heavy work needs the owner approval bound to that exact brief', () => {
  const brief: DelegationRequest = {
    toolCallId: 't1.1', turn: 1, cli: 'claude-code', executable: '/x/claude', version: '2.1.0', briefText: 'Sort the bills.', uploadIds: [],
    limits: { minutes: 10 } as DelegationRequest['limits'], digest: 'a'.repeat(64), status: 'waiting', startedAt: null, delegateRunId: null,
  };
  const state: HarnessState = { ...newHarnessState(['agent.delegate'], DEFAULT_LIMITS, []), phase: 'brief', delegations: [brief] };
  assert.throws(() => startDelegation(state, '2026-10-21T10:00:00.000Z'), code('POLICY_ASK'));
  assert.throws(() => startDelegation(state, '2026-10-21T10:00:00.000Z', { kind: 'owner-turn' }), code('POLICY_ASK'));
  assert.throws(() => startDelegation(state, '2026-10-21T10:00:00.000Z', { kind: 'owner-action', digest: 'b'.repeat(64), memberId: 'owner' }), code('POLICY_ASK'));
  const started = startDelegation(state, '2026-10-21T10:00:00.000Z', { kind: 'owner-action', digest: 'a'.repeat(64), memberId: 'owner' });
  assert.equal(started.delegations?.[0].status, 'running');
});

// ---------------------------------------------------------------------------
// 4. The context comes from the vault: launch stage, the agent's own posture, the step gates
// ---------------------------------------------------------------------------

test('context: posture from the launch stage, tightened by the agent and the run; gates from venture.team.gate, on hold by default', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as PlaybookRecord;
  await viewCall(env, 'venture.team.gate', { agentId: 'delivery', stepId: 'work', gate: 'auto' });
  const venture = () => listRecords(env.store.read(), 'venture-record')[0];

  const real = harnessPolicyContext({ state: env.store.read(), venture: venture(), playbook, runRef: REAL });
  assert.equal(real.posture, 'approve-each');
  assert.deepEqual(real.approval, { kind: 'none' }, 'a real order without an approval fails closed');
  assert.equal(real.gates.gather, 'hold');
  assert.equal(real.gates.work, 'auto');
  assert.equal(real.gates.send, 'hold');
  assert.deepEqual(real.stepsByTool['files.read'], ['gather', 'work']);
  assert.equal(real.stepTitles?.gather, "Read the client's message and files and pull out what is needed");
  const practiceCtx = harnessPolicyContext({ state: env.store.read(), venture: venture(), playbook, runRef: REHEARSAL });
  assert.deepEqual([practiceCtx.posture, practiceCtx.approval.kind], ['rehearsal', 'practice']);

  // The agent's own posture tightens the business one and never loosens it.
  await setAgentPosture(env.deps, owner, 'delivery', 'shadow');
  assert.equal(harnessPolicyContext({ state: env.store.read(), venture: venture(), playbook, runRef: REAL }).posture, 'shadow');
  await setAgentPosture(env.deps, owner, 'delivery', 'auto-spot-check');
  assert.equal(harnessPolicyContext({ state: env.store.read(), venture: venture(), playbook, runRef: REAL }).posture, 'approve-each');
  assert.deepEqual(listRecords(env.store.read(), 'venture-agent-posture').map(record => [record.agentId, record.posture]), [['delivery', 'shadow'], ['delivery', 'auto-spot-check']]);
  await assert.rejects(setAgentPosture(env.deps, owner, 'designer', 'shadow'), code('AGENT_NOT_FOUND'));
  await assert.rejects(setAgentPosture(env.deps, owner, 'delivery', 'reckless' as never), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(setAgentPosture(env.deps, { ...owner, channel: 'phone' }, 'delivery', 'shadow'), code('APP_APPROVAL_REQUIRED'));

  // buildToolEnv carries the context; the caller says when the owner approved the turn.
  const built = buildToolEnv({ deps: env.deps, ctx: owner, state: env.store.read(), venture: venture(), playbook, runRef: REAL, files: [], allowed: [], approval: { kind: 'owner-turn', callId: 'call_1' } });
  assert.deepEqual(built.policy?.context.approval, { kind: 'owner-turn', callId: 'call_1' });
  const bare = buildToolEnv({ deps: env.deps, ctx: owner, state: env.store.read(), venture: venture(), playbook, runRef: REAL, files: [], allowed: [] });
  assert.deepEqual(bare.policy?.context.approval, { kind: 'none' });
});
