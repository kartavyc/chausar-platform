// Package 1C (H13, H14): just before an approved action applies, the gate runs again on what the vault says then
// (digest unchanged, order and client still active, the stage, the run's cap and the monthly limit re-read), and a
// deny cancels it and says why; and while calls wait for approval, the agent is told they have not run, so it never
// tells the owner something went out. No network, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessState, JournalRecord, ScenarioKind, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import {
  actTask, AGENT_TURN_INSTRUCTIONS, answerHandoff, applyTurn, AWAITING_APPROVAL, awaitingApproval, DEFAULT_LIMITS, newHarnessState, writeTask, type LoopContext,
} from '../runtime/venture/delivery/harness/loop.ts';
import { recheckBeforeApply, recheckRun, recheckSend, type ApplyFacts } from '../runtime/venture/delivery/harness/recheck.ts';
import { buildToolEnv } from '../runtime/venture/delivery/harness/env.ts';
import { setSpendPolicy } from '../runtime/venture/money/spend.ts';
import { HOLD_APPROVE_ANSWER } from '../runtime/venture/policy/holds.ts';
import type { PolicyContext } from '../runtime/venture/policy/ladder.ts';
import { approve, code, decideBrief, installFakeClaude, owner, realOrder, startRun, turnOf, type RealOrderEnv } from './venture-real-order-env.ts';

const practice = (kind: ScenarioKind) => practiceFiles({ id: `bookkeeping-${kind}`, serviceType: 'bookkeeping', source: 'template' });
const turn = (calls: [string, unknown][], finished = false) => ({ note: 'Work on the files', calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const meta = { by: 'model' as const, callId: 'call_1', costMicros: '1000' };
const GRANT: ToolName[] = ['files.list', 'files.read', 'handoff.owner', 'outbox.propose'];
const REAL = { kind: 'delivery' as const, runId: 'delivery_1' };

function context(over: Partial<PolicyContext> = {}): PolicyContext {
  return {
    posture: 'approve-each', approval: { kind: 'none' }, gates: { gather: 'hold' },
    stepsByTool: { 'files.list': ['gather'], 'files.read': ['gather'], 'handoff.owner': ['gather'] }, stepTitles: { gather: 'Read the files' }, ...over,
  };
}
function toolEnv(over: Partial<PolicyContext> = {}, recheck?: ToolEnv['recheck']): ToolEnv {
  return {
    deps: { services: {} } as never, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef: REAL,
    files: practice('clean'), tables: [], receipts: [], dictionary: [], sandbox: undefined, now: () => '2026-10-21T10:00:00.000Z', allowed: [],
    policy: { context: context(over) }, ...(recheck ? { recheck } : {}),
  };
}
const error = (outcome: Awaited<ReturnType<typeof callTool>>) => outcome.record.envelope.ok ? null : outcome.record.envelope.error;
const CANCELLED = { code: 'ORDER_NOT_ACTIVE', reason: 'The order was cancelled after you approved this.' };

// ---------------------------------------------------------------------------
// 1. The gate again, as a pure check
// ---------------------------------------------------------------------------

const FACTS: ApplyFacts = {
  approvedDigest: 'a'.repeat(64), currentDigest: 'a'.repeat(64), order: { status: 'open' }, clientOnFile: true, stage: 'approve-each',
  run: { usedMicros: '0', capMicros: '1000' }, month: { capMicros: null, spentMicros: '0' }, callMicros: '100',
};
const facts = (over: Partial<ApplyFacts> = {}): ApplyFacts => ({ ...FACTS, ...over });

test('recheck: nothing changed lets it apply; each changed fact denies with its own code and plain words', () => {
  assert.equal(recheckBeforeApply(facts()), null);
  const denied = (over: Partial<ApplyFacts>) => recheckBeforeApply(facts(over));
  assert.equal(denied({ currentDigest: 'b'.repeat(64) })?.code, 'APPROVAL_STALE');
  assert.equal(denied({ currentDigest: null })?.code, 'APPROVAL_STALE', 'no longer waiting is a change too');
  assert.deepEqual(denied({ order: { status: 'cancelled' } }), { code: 'ORDER_NOT_ACTIVE', reason: 'The order was cancelled after you approved this, so it was stopped.' });
  assert.equal(denied({ order: null })?.code, 'ORDER_NOT_ACTIVE');
  assert.equal(denied({ order: { status: 'invoiced' } }), null, 'an invoiced order is still being worked on');
  assert.deepEqual(denied({ clientOnFile: false }), { code: 'CLIENT_NOT_ACTIVE', reason: 'The client for this order is no longer on file, so it was stopped.' });
  // The stage can move either way: down to rehearsal, or up past approve each; both stop it with the same words.
  for (const stage of ['rehearsal', 'auto-spot-check'] as const) {
    assert.deepEqual(denied({ stage }), { code: 'LAUNCH_STAGE_BLOCKED', reason: "The business's launch stage changed after you approved this, so it was stopped." }, stage);
  }
  assert.equal(denied({ stage: 'shadow' }), null);
  const overRun = denied({ run: { usedMicros: '950', capMicros: '1000' } });
  assert.equal(overRun?.code, 'RUN_CAP_REACHED');
  assert.match(overRun!.reason, /USD 0\.0010/);
  assert.equal(denied({ run: { usedMicros: '900', capMicros: '1000' } }), null, 'reaching the run cap exactly fits');
  const overMonth = denied({ month: { capMicros: '1000', spentMicros: '950' } });
  assert.equal(overMonth?.code, 'SPEND_CAP');
  assert.match(overMonth!.reason, /USD 0\.0010/, 'the limit as set now, in the engine format');
  assert.equal(denied({ month: { capMicros: '1000', spentMicros: '5000' }, callMicros: '0' }), null, 'a free action is never stopped by the monthly limit');
  assert.equal(denied({ run: null, month: { capMicros: null, spentMicros: '99999999' } }), null);
});

// ---------------------------------------------------------------------------
// 2. In the harness: a tool call an approval let through
// ---------------------------------------------------------------------------

test('tool call: just before a call an approval let through runs, the gate runs again; a deny cancels it and nothing runs', async () => {
  const seen: unknown[] = [];
  const env = toolEnv({ approval: { kind: 'owner-turn', callId: 'call_1' } }, action => { seen.push(action); return CANCELLED; });
  const denied = await callTool(env, GRANT, 1, 0, { tool: 'files.read', input: JSON.stringify({ target: 'f1', part: 'columns' }) });
  assert.equal(denied.record.outcome, 'cancelled');
  assert.deepEqual(error(denied), { code: 'ORDER_NOT_ACTIVE', name: 'OrderNotActive', message: 'The order was cancelled after you approved this. Nothing ran.' });
  assert.deepEqual([denied.proofs, denied.receipts, denied.tables, denied.hold], [[], [], [], null]);
  assert.equal(seen.length, 1);
  assert.equal((seen[0] as { tool: string }).tool, 'files.read');

  const allowed = await callTool(toolEnv({ approval: { kind: 'owner-turn', callId: 'call_1' } }, () => null), GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(allowed.record.outcome, 'succeeded');
});

test('tool call: a recheck that throws blocks the call; calls nothing approved, or that only record a request, are not rechecked', async () => {
  const thrown = await callTool(toolEnv({ approval: { kind: 'owner-turn' } }, () => { throw new Error('vault closed'); }), GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.deepEqual(error(thrown), { code: 'RECHECK_FAILED', name: 'RecheckFailed', message: 'The check before this ran could not finish, so it was stopped. Nothing ran.' });
  let asked = 0;
  const count = () => { asked += 1; return CANCELLED; };
  const held = await callTool(toolEnv({}, count), GRANT, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(error(held)?.code, 'POLICY_ASK', 'a call on hold waits for the owner as before');
  const recorded = await callTool(toolEnv({}, count), GRANT, 1, 0, { tool: 'outbox.propose', input: JSON.stringify({ connector: 'mail-app', summary: 'Send the report' }) });
  assert.equal(recorded.record.outcome, 'succeeded', 'recording a request sends nothing; its effect is gated when it applies');
  assert.equal(asked, 0);
});

test('loop: an approved hold whose order was cancelled meanwhile is stopped at the recheck, used up, and kept as evidence', async () => {
  let cancelled = false;
  const env = toolEnv({}, () => (cancelled ? CANCELLED : null));
  let state = newHarnessState(GRANT, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.list', {}]]), meta);
  state = answerHandoff(state, HOLD_APPROVE_ANSWER, 'owner');
  assert.equal(state.holds?.[0].status, 'approved');
  cancelled = true;
  state = await applyTurn(env, state, turn([['files.list', {}]]), meta);
  const last = state.toolCalls.at(-1)!;
  assert.deepEqual([last.id, last.outcome, !last.envelope.ok && last.envelope.error.code], ['t2.1', 'cancelled', 'ORDER_NOT_ACTIVE']);
  assert.equal(state.holds?.[0].status, 'used', 'the approval was for one call and that call was stopped');
  const step = state.rounds!.at(-1)!.steps.at(-1)!;
  assert.equal(step.audited, false);
  assert.match(step.reason, /cancelled after you approved this/);
});

// ---------------------------------------------------------------------------
// 3. Real orders: the send and the tools read the vault again
// ---------------------------------------------------------------------------

const READ = turnOf('Look at the statement', [['files.list', {}]]);
const journalSends = (env: RealOrderEnv) => listRecords(env.store.read(), 'venture-journal-entry').filter((entry: JournalRecord) => entry.action === 'delivery.send');
async function cancelOrder(env: RealOrderEnv) {
  await ventureAction(env.deps, owner, 'prepare', 'seed.cancel', tx => { tx.replace({ ...tx.find('venture-order', env.order.id)!, status: 'cancelled' }); });
}

test('real order: a send approved after its order was cancelled is stopped before it goes, and the journal says why', async () => {
  const env = await realOrder();
  env.models.turns = [READ];
  const run = await startRun(env);
  await cancelOrder(env);
  await assert.rejects(approve(env, run), code('ORDER_NOT_ACTIVE'));
  assert.equal(env.models.sent, 0, 'nothing went to the AI');
  const [entry] = journalSends(env);
  assert.equal(entry.state, 'rejected');
  assert.equal(entry.outcome?.line, 'The order was cancelled after you approved this, so it was stopped.');
});

test('real order: the monthly limit is read again at the send; lowered under what the call may cost, it stops the send', async () => {
  const env = await realOrder();
  env.models.turns = [READ];
  const run = await startRun(env);
  await setSpendPolicy(env.deps, owner, { capMicros: '500' });
  await assert.rejects(approve(env, run), code('SPEND_CAP'));
  assert.equal(env.models.sent, 0);
  const [entry] = journalSends(env);
  assert.equal(entry.state, 'rejected');
  assert.match(entry.outcome!.line, /past your limit of USD 0\.0005/);
  await setSpendPolicy(env.deps, owner, { capMicros: null });
  await approve(env, run);
  assert.equal(env.models.sent, 1, 'with the limit lifted the same approval goes');
});

test('real order: the tools of an approved turn read the order again; with the order cancelled, each call is stopped', async () => {
  const env = await realOrder();
  const run = await startRun(env);
  const state = env.store.read();
  const venture = listRecords(state, 'venture-record')[0];
  const playbook = listRecords(state, 'venture-playbook')[0];
  const built = buildToolEnv({ deps: env.deps, ctx: owner, state, venture, playbook, runRef: { kind: 'delivery', runId: run.id }, files: [], allowed: [], approval: { kind: 'owner-turn', callId: run.callId } });
  assert.equal(recheckRun(env.deps, venture.id, run.id), null);
  const open = await callTool(built, ['files.list'], 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(open.record.outcome, 'succeeded');
  await cancelOrder(env);
  const stopped = await callTool(built, ['files.list'], 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(error(stopped)?.code, 'ORDER_NOT_ACTIVE');
});

test('real order: the run cap is read again from the playbook in force; the smaller of it and the run snapshot, plus windows, counts', async () => {
  const env = await realOrder();
  env.models.turns = [READ, READ];
  const run = await approve(env, await startRun(env));
  const ventureId = env.venture.id;
  assert.equal(recheckRun(env.deps, ventureId, run.id), null, '200 spent of 250000');
  // The owner's playbook now allows each run only 100: the run has already spent 200.
  await ventureAction(env.deps, owner, 'prepare', 'seed.limits', tx => {
    const playbook = tx.find('venture-playbook', tx.venture!.playbookId!)!;
    tx.replace({ ...playbook, limits: { ...DEFAULT_LIMITS, maxCostMicros: '100' } });
  });
  const denial = recheckRun(env.deps, ventureId, run.id);
  assert.equal(denial?.code, 'RUN_CAP_REACHED');
  assert.match(denial!.reason, /USD 0\.0001/);
  await assert.rejects(approve(env, run), code('RUN_CAP_REACHED'), 'the send reads it again too');
  assert.equal(env.models.sent, 1);
  // A window the owner allowed still counts on top of the smaller cap.
  await ventureAction(env.deps, owner, 'prepare', 'seed.window', tx => {
    const current = tx.find('venture-delivery-run', run.id)!;
    tx.replace({ ...current, harness: { ...current.harness!, capWindows: [{ micros: '5000', at: '2026-10-16T10:00:00.000Z', by: 'owner' }] } });
  });
  assert.equal(recheckRun(env.deps, ventureId, run.id), null);
});

test('real order: when the check before the send cannot finish, the send is refused, never left with an unknown outcome', async () => {
  const env = await realOrder();
  env.models.turns = [READ];
  const run = await startRun(env);
  const failing = { ...env.deps, store: { read: () => { throw new Error('vault closed'); } } } as unknown as VentureDeps;
  assert.throws(() => recheckSend(failing, env.venture.id, run.id, run.callId!, run.preview!.digest), (error: any) => {
    assert.equal(error.code, 'RECHECK_FAILED');
    assert.equal(error.message, 'The check before this ran could not finish, so it was stopped. Nothing was sent.');
    return true;
  });
});

test('heavy work: the start reads the order again; a brief approved after the order was cancelled starts nothing', async () => {
  const fake = installFakeClaude();
  try {
    const env = await realOrder({ delegate: fake.ports });
    env.models.turns = [turnOf('Hand the matching to the owner tool', [['agent.delegate', { brief: 'Match every payment in the bank statement to a bill.' }]])];
    const run = await approve(env, await startRun(env));
    assert.equal(run.status, 'brief-waiting');
    await cancelOrder(env);
    await assert.rejects(decideBrief(env, run, 'approve'), code('ORDER_NOT_ACTIVE'));
    assert.equal(fake.started(), false);
  } finally {
    fake.cleanup();
  }
});

// ---------------------------------------------------------------------------
// 4. While approvals wait, the agent is told they have not run (H14)
// ---------------------------------------------------------------------------

const LOOP: LoopContext = {
  serviceType: 'bookkeeping', offer: { name: 'Monthly books', description: 'Books.' }, clientRequest: 'Close my books', playbook: { steps: [] },
  dictionaryManifest: 'm', files: [], containsClientData: true, allowed: [],
};
const WRITE = { ...LOOP, idea: 'Books for cafes.', priceRefs: { figures: [], dates: [] }, templateTotalRef: 'order.total' as const, proven: [] };

test('agent turn: a recorded outside action awaits approval, so the next turn and the reply step are told it has not executed', async () => {
  const env = toolEnv({ approval: { kind: 'owner-turn', callId: 'call_1' } });
  let state = newHarnessState(GRANT, DEFAULT_LIMITS, []);
  const plain = actTask(LOOP, state);
  assert.equal(Object.hasOwn(plain.input as object, 'awaitingApproval'), false, 'nothing waiting adds nothing');
  assert.equal(plain.instructions, AGENT_TURN_INSTRUCTIONS);

  state = await applyTurn(env, state, turn([['outbox.propose', { connector: 'mail-app', summary: 'Send the September report' }], ['files.list', {}]]), meta);
  assert.deepEqual(awaitingApproval(state), [{ call: 't1.1', tool: 'outbox.propose' }]);
  const next = actTask(LOOP, state);
  assert.deepEqual((next.input as Record<string, unknown>).awaitingApproval, { note: AWAITING_APPROVAL, calls: [{ call: 't1.1', tool: 'outbox.propose' }] });
  assert.equal(AWAITING_APPROVAL, 'These calls are awaiting approval and have not executed.');
  assert.ok(next.instructions.startsWith(AGENT_TURN_INSTRUCTIONS));
  assert.ok(next.instructions.includes(`${AWAITING_APPROVAL} t1.1 (outbox.propose).`), next.instructions);
  const reply = writeTask(WRITE, { ...state, phase: 'write' }, []);
  assert.deepEqual((reply.input as Record<string, unknown>).awaitingApproval, { note: AWAITING_APPROVAL, calls: [{ call: 't1.1', tool: 'outbox.propose' }] });
  assert.ok(reply.instructions.includes(AWAITING_APPROVAL));
});

test('agent turn: a held call waiting for the owner, and a brief waiting for the owner, are listed; decided ones are not', () => {
  const waiting: HarnessState = {
    ...newHarnessState(GRANT, DEFAULT_LIMITS, []),
    toolCalls: [
      { id: 't1.1', turn: 1, tool: 'files.list', input: {}, inputDigest: 'd', envelope: { ok: false, error: { code: 'POLICY_ASK', name: 'PolicyAsk', message: 'On hold.' } }, outcome: 'cancelled', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] },
      { id: 't1.2', turn: 1, tool: 'agent.delegate', input: {}, inputDigest: 'e', envelope: { ok: true, result: { waiting: true } }, outcome: 'succeeded', effect: 'delegate', tier: 'owner-cli', receiptIds: [], tableIds: [] },
      { id: 't1.3', turn: 1, tool: 'files.read', input: {}, inputDigest: 'f', envelope: { ok: false, error: { code: 'POLICY_ASK', name: 'PolicyAsk', message: 'On hold.' } }, outcome: 'cancelled', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] },
    ],
    holds: [
      { id: 'h1.1', toolCallId: 't1.1', tool: 'files.list', stepId: null, inputDigest: 'd', code: 'step_on_hold', reason: 'On hold.', turn: 1, handoff: 0, status: 'waiting', validTurn: null },
      { id: 'h1.3', toolCallId: 't1.3', tool: 'files.read', stepId: null, inputDigest: 'f', code: 'step_on_hold', reason: 'On hold.', turn: 1, handoff: 1, status: 'declined', validTurn: null },
    ],
    delegations: [{ toolCallId: 't1.2', status: 'waiting' } as NonNullable<HarnessState['delegations']>[number]],
  };
  assert.deepEqual(awaitingApproval(waiting), [{ call: 't1.1', tool: 'files.list' }, { call: 't1.2', tool: 'agent.delegate' }]);
  const decided: HarnessState = { ...waiting, holds: waiting.holds!.map(hold => ({ ...hold, status: 'used' as const })), delegations: [{ ...waiting.delegations![0], status: 'finished' }] };
  assert.deepEqual(awaitingApproval(decided), []);
});
