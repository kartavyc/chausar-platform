// Auditor tests: in the agent loop the manager plans a round (the act turn), the executor runs one step per tool
// call, and a read-only auditor checks each step's real output (the receipts and tables in the run, the client's
// files) before it counts. Only audited steps count as progress or back a claim of finished work. Each round goes
// into a ledger on the run. No network, no paid calls, no docker command.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { HarnessState, ScenarioKind, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import type { FileLike } from '../runtime/venture/delivery/harness/files.ts';
import { applyTurn, compactHistory, DEFAULT_LIMITS, newHarnessState, settleDelegation } from '../runtime/venture/delivery/harness/loop.ts';
import { auditedProgress, auditedSteps, auditStep, isStepAudited, WAITING_BRIEF_REASON } from '../runtime/venture/delivery/judge/auditor.ts';

const practice = (kind: ScenarioKind) => practiceFiles({ id: `bookkeeping-${kind}`, serviceType: 'bookkeeping', source: 'template' });
function toolEnv(files: FileLike[], extra: Partial<ToolEnv> = {}): ToolEnv {
  return {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }, files, tables: [], receipts: [],
    dictionary: [{ id: 'term.client', kind: 'term', name: 'Client', meaning: 'A cafe that pays for the books.', aliases: [] }],
    sandbox: undefined, now: () => '2026-10-16T10:00:00.000Z', allowed: [], ...extra,
  };
}
const ALL: ToolName[] = ['files.list', 'files.read', 'dictionary.browse', 'dictionary.resolve', 'calc.sum', 'calc.totals', 'books.reconcile', 'bills.pick', 'handoff.client', 'handoff.owner'];
const turn = (calls: [string, unknown][], finished = false, note = 'Work on the files') => ({ note, calls: calls.map(([tool, input]) => ({ tool, input: JSON.stringify(input) })), finished });
const meta = { by: 'model' as const, callId: 'call_1', costMicros: '1000' };
const RECONCILE = { bank: 'f1', description: 'Narration', moneyOut: 'Withdrawal', moneyIn: 'Deposit', balance: 'Balance', bills: [{ table: 'f2', vendor: 'Supplier', amount: 'Amount' }] };
const call = (env: ToolEnv, tool: string, input: unknown) => callTool(env, ALL, 1, 0, { tool, input: JSON.stringify(input) });

test('auditor: each round keeps the plan and every step with its audit; real outputs pass and count as progress', async () => {
  const env = toolEnv(practice('clean'));
  let state = newHarnessState(ALL, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['files.read', { target: 'f1', part: 'sample' }], ['books.reconcile', RECONCILE]], false, 'Read the statement, then reconcile it'), meta);
  assert.equal(state.rounds?.length, 1);
  const [round] = state.rounds!;
  assert.equal(round.round, 1);
  assert.equal(round.plan, 'Read the statement, then reconcile it');
  assert.deepEqual(round.steps.map(step => [step.toolCallId, step.tool, step.audited]), [['t1.1', 'files.read', true], ['t1.2', 'books.reconcile', true]]);
  assert.equal(round.progress, 2);
  assert.ok(round.steps[1].evidence.includes(env.receipts[0].id), 'the auditor names the receipt it read');
  assert.deepEqual(state.proofs.map(proof => proof.kind), ['file-read', 'reconciled', 'matched', 'balanced'], 'audited proofs back claims as before');
  assert.equal(state.sections, 'report');
  assert.deepEqual(auditedProgress(state), { done: 2, total: 2 });
  assert.equal(isStepAudited(state, 't1.2'), true);

  state = await applyTurn(env, state, turn([['files.list', {}], ['calc.sum', { table: 'f2', amountColumn: 'Nope' }]], true, 'Total the bills'), meta);
  assert.equal(state.rounds?.length, 2);
  assert.deepEqual(state.rounds![1].steps.map(step => step.audited), [true, false]);
  assert.match(state.rounds![1].steps[1].reason, /did not succeed/);
  assert.deepEqual(auditedProgress(state), { done: 3, total: 4 });
  assert.deepEqual(auditedSteps(state).map(step => [step.stepId, step.round, step.audited]), [['t1.1', 1, true], ['t1.2', 1, true], ['t2.1', 2, true], ['t2.2', 2, false]]);
});

test('auditor: refused and cancelled steps are kept as evidence, never as progress', async () => {
  const env = toolEnv(practice('messy'));
  let state = newHarnessState(ALL, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['inbox.read', {}], ['handoff.client', { question: 'Which account is this?' }], ['files.list', {}]]), meta);
  const steps = state.rounds![0].steps;
  assert.deepEqual(steps.map(step => [step.toolCallId, step.audited]), [['t1.1', false], ['t1.2', true], ['t1.3', false]]);
  assert.match(steps[0].reason, /did not succeed/);
  assert.match(steps[2].reason, /did not run/);
  assert.equal(state.rounds![0].progress, 1);
  const history = (compactHistory(state) as any).turns; // 4J11: the history is { summary, turns }
  assert.deepEqual(history[0].calls.map((item: any) => item.audited), [false, true, false], 'the manager plans the next round from what was audited');
  assert.match(history[0].calls[0].auditNote, /did not succeed/);
  assert.equal('auditNote' in history[0].calls[1], false);
});

test('auditor: a step whose receipt never joined the run is not audited, and its proofs back no claim', async () => {
  const env = toolEnv(practice('clean'));
  // The run's receipt list refuses new receipts, as if the calculator's record were lost after the call.
  Object.defineProperty(env.receipts, 'push', { value: () => 0 });
  let state = newHarnessState(ALL, DEFAULT_LIMITS, env.files.map(file => file.id));
  state = await applyTurn(env, state, turn([['books.reconcile', RECONCILE]], true), meta);
  const [step] = state.rounds![0].steps;
  assert.equal(step.audited, false);
  assert.match(step.reason, /not in the run/);
  assert.deepEqual(state.proofs, []);
  assert.equal(state.sections, 'reply', 'without an audited proof the reply cannot report finished work');
  assert.equal(state.toolCalls[0].outcome, 'succeeded', 'the call itself is kept as it happened');
});

test('auditor: it checks the real output, so a tampered receipt or table, or a proof the output does not support, fails', async () => {
  const env = toolEnv(practice('clean'));
  const sum = await call(env, 'calc.sum', { table: 'f2', amountColumn: 'Amount' });
  assert.equal(auditStep(env, sum).audited, true);
  assert.equal(auditStep(env, { ...sum, proofs: [...sum.proofs, { kind: 'balanced', toolCallId: sum.record.id, receiptId: sum.receipts[0].id, tableId: null }] }).audited, false, 'calc.sum cannot prove a balance');
  assert.match(auditStep(env, { ...sum, proofs: [{ ...sum.proofs[0], toolCallId: 't9.9' }] }).reason, /another step/);
  const receipt = env.receipts[0];
  const kept = receipt.figures[0].display;
  receipt.figures[0].display = 'INR 1.00';
  const tampered = auditStep(env, sum);
  assert.equal(tampered.audited, false);
  assert.match(tampered.reason, /digest/);
  receipt.figures[0].display = kept;
  assert.equal(auditStep(env, sum).audited, true);

  const reconcile = await call(env, 'books.reconcile', RECONCILE);
  assert.equal(auditStep(env, reconcile).audited, true);
  const rec = env.receipts.find(item => item.id === reconcile.receipts[0].id)!;
  const forged = { ...reconcile, proofs: reconcile.proofs.map(proof => ({ ...proof })) };
  rec.reconciliation!.balanced = false;
  assert.match(auditStep(env, forged).reason, /digest|balance/);

  const other = toolEnv(practice('clean'), { runRef: { kind: 'rehearsal', scenarioId: 'other', episode: 1 } });
  const elsewhere = await call(other, 'calc.sum', { table: 'f2', amountColumn: 'Amount' });
  assert.match(auditStep(env, { ...elsewhere }).reason, /not in the run/);
  env.receipts.push(...other.receipts);
  assert.match(auditStep(env, elsewhere).reason, /another run/);

  const read = await call(env, 'files.read', { target: 'f1', part: 'columns' });
  assert.equal(auditStep(env, read).audited, true);
  assert.match(auditStep(env, { ...read, proofs: [{ ...read.proofs[0], tableId: 'upload_missing' }] }).reason, /not a file or table of this run/);
});

test('auditor: a heavy-work brief counts as progress only once the owner\'s tool finished; a declined brief never does', () => {
  const briefed: HarnessState = {
    ...newHarnessState(['agent.delegate'], DEFAULT_LIMITS, ['upload_1']),
    phase: 'brief',
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'agent.delegate', input: {}, inputDigest: '', envelope: { ok: true, result: { waiting: true } }, outcome: 'succeeded', effect: 'delegate', tier: 'owner-cli', receiptIds: [], tableIds: [] }],
    rounds: [{ round: 1, plan: 'Hand the heavy work to the owner\'s tool', steps: [{ toolCallId: 't1.1', tool: 'agent.delegate', audited: false, reason: WAITING_BRIEF_REASON, evidence: [] }], progress: 0 }],
    delegations: [{ toolCallId: 't1.1', turn: 1, cli: 'claude-code', executable: 'claude', version: '1', briefText: 'Sort the rows.', uploadIds: ['upload_1'], limits: { minutes: 10, maxTurns: 5, budgetMicros: null }, digest: 'd', status: 'running', startedAt: null, delegateRunId: null }],
  };
  const declined = settleDelegation(briefed, { status: 'declined', envelope: { ok: false, error: { code: 'DELEGATE_DECLINED', name: 'DelegateDeclined', message: 'Declined.' } }, outcome: 'cancelled', delegateRunId: null, receiptIds: [], proofs: [] });
  assert.deepEqual([declined.rounds![0].steps[0].audited, declined.rounds![0].progress], [false, 0]);
  assert.match(declined.rounds![0].steps[0].reason, /declined/);
  const finished = settleDelegation(briefed, {
    status: 'finished', envelope: { ok: true, result: { done: true } }, outcome: 'succeeded', delegateRunId: 'delegaterun_1', receiptIds: ['work_9'],
    proofs: [{ kind: 'delegated', toolCallId: 't1.1', receiptId: null, tableId: null }, { kind: 'totals', toolCallId: 't1.1', receiptId: 'work_9', tableId: null }],
  });
  assert.deepEqual([finished.rounds![0].steps[0].audited, finished.rounds![0].progress], [true, 1]);
  assert.deepEqual(finished.rounds![0].steps[0].evidence, ['work_9']);
  assert.deepEqual(finished.proofs.map(proof => proof.kind), ['delegated', 'totals']);
});

test('auditor: the runs view reads one flag per step; a run from before the ledger has no audited steps', () => {
  const old: HarnessState = {
    ...newHarnessState(['files.list'], DEFAULT_LIMITS, []),
    toolCalls: [{ id: 't1.1', turn: 1, tool: 'files.list', input: {}, inputDigest: '', envelope: { ok: true, result: {} }, outcome: 'succeeded', effect: 'read', tier: 'code', receiptIds: [], tableIds: [] }],
  };
  assert.deepEqual(auditedSteps(old), [{ stepId: 't1.1', tool: 'files.list', round: 1, audited: false, reason: 'This run started before steps were audited.' }]);
  assert.equal(isStepAudited(old, 't1.1'), false);
  assert.deepEqual(auditedProgress(old), { done: 0, total: 1 });
  assert.deepEqual(auditedSteps(null), []);
  assert.deepEqual(auditedProgress(undefined), { done: 0, total: 0 });
});
