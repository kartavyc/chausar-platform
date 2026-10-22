// Runs view, the auditor and step times: a step counts as progress only when the auditor passed its work; each step
// shows how long its tool calls took, from the times the harness stamps on each call; improvement runs are runs too.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ImprovementRunRecord, RunDetail, RunSummary, ScenarioKind, ToolCallRecord, ToolName, VentureDeps } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { practiceFiles } from '../runtime/venture/delivery/harness/practice.ts';
import { callTool, type ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { call, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const runs = (env: Env, state?: 'active' | 'done' | 'all') => call<{ runs: RunSummary[] }>(env, 'venture.runs.list', state ? { state } : {}).then(result => result.runs);
const get = (env: Env, runId: string) => call<RunDetail>(env, 'venture.runs.get', { runId });
const ok = { ok: true as const, result: {} };

function toolCall(id: string, tool: string, times: [string, string] | null, receiptIds: string[] = []): ToolCallRecord {
  return {
    id, turn: 1, tool, input: {}, inputDigest: 'd', envelope: ok, outcome: 'succeeded', effect: null, tier: null, receiptIds, tableIds: [],
    ...(times ? { startedAt: times[0], finishedAt: times[1] } : {}),
  };
}

async function agentRun(env: Env, rounds: boolean) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const audit = (toolCallId: string, tool: string, audited: boolean, reason: string) => ({ toolCallId, tool, audited, reason, evidence: [] });
  return seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer',
    harness: harness({
      phase: 'needs-answer',
      toolCalls: [
        toolCall('t1.1', 'files.read', ['2026-10-15T10:00:00.000Z', '2026-10-15T10:00:05.000Z']),
        toolCall('t1.2', 'calc.totals', ['2026-10-15T10:00:10.000Z', '2026-10-15T10:01:40.000Z']),
        toolCall('t1.3', 'handoff.owner', null),
      ],
      handoffs: [{ to: 'owner', question: 'Which bank account is the main one?', turn: 1, answer: null, answeredBy: null }],
      ...(rounds ? { rounds: [{ round: 1, plan: 'Read the statement and total it', progress: 2, steps: [
        audit('t1.1', 'files.read', true, 'Checked file-read against what the step really made.'),
        audit('t1.2', 'calc.totals', false, 'The receipt work_1 does not match its own digest.'),
        audit('t1.3', 'handoff.owner', true, 'The step ran and returned its result.'),
      ] }] } : {}),
    }),
  }, ['run.waiting']);
}

test('runs: a step is audited only when the auditor passed its work, and only audited steps count as progress', async () => {
  const env = await setup();
  const run = await agentRun(env, true);
  const detail = await get(env, run.id);
  const step = (id: string) => detail.steps.find(item => item.id === id)!;
  assert.deepEqual([step('gather').state, step('gather').audited], ['done', true]);
  assert.deepEqual([step('work').state, step('work').audited], ['done', false]);
  assert.deepEqual([step('clarify').state, step('clarify').audited], ['waiting', true]);
  assert.equal('audited' in step('price'), false, 'a step with no tool calls is not the auditor\'s');
  assert.deepEqual(step('work').tools, [{ name: 'Worked out totals with the calculator', line: 'Done. Not counted: The receipt work_1 does not match its own digest.' }]);
  assert.deepEqual(step('gather').tools, [{ name: 'Read a client file', line: 'Done.' }]);
  // gather is done and audited; work is done but failed its audit, so it is not progress.
  assert.deepEqual(detail.progress, { done: 1, total: 8 });
  const [summary] = await runs(env);
  assert.deepEqual(summary.progress, { done: 1, total: 8 });
});

test('runs: each step shows how long its tool calls took; a run made before the auditor keeps its old progress', async () => {
  const env = await setup();
  const run = await agentRun(env, false);
  const detail = await get(env, run.id);
  const step = (id: string) => detail.steps.find(item => item.id === id)!;
  assert.equal(step('gather').elapsed, '5s');
  assert.equal(step('work').elapsed, '1m');
  assert.equal(step('clarify').elapsed, undefined, 'a call with no times shows no time');
  assert.equal(step('gather').audited, undefined, 'no ledger: not known, not false');
  assert.deepEqual(detail.progress, { done: 2, total: 8 });
});

test('harness: each tool call it runs carries when it started and finished', async () => {
  let tick = 0;
  const env: ToolEnv = {
    deps: { services: {} } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 },
    files: practiceFiles({ id: 'bookkeeping-clean' as `bookkeeping-${ScenarioKind}`, serviceType: 'bookkeeping', source: 'template' }), tables: [], receipts: [],
    dictionary: [], sandbox: undefined, now: () => new Date(Date.UTC(2026, 9, 16, 10, 0, tick++)).toISOString(), allowed: [],
  };
  const grant: ToolName[] = ['files.list'];
  const outcome = await callTool(env, grant, 1, 0, { tool: 'files.list', input: '{}' });
  assert.equal(outcome.record.outcome, 'succeeded');
  assert.equal(outcome.record.startedAt, '2026-10-16T10:00:00.000Z');
  assert.ok(outcome.record.finishedAt && outcome.record.finishedAt > outcome.record.startedAt!);
  const refused = await callTool(env, grant, 1, 1, { tool: 'files.read', input: '{}' });
  assert.equal(refused.record.outcome, 'failed');
  assert.ok(refused.record.startedAt && refused.record.finishedAt, 'a refusal is timed too');
});

test('runs: an improvement run is listed with one step per round, its time, and what it kept', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  const improvement = await ventureAction(env.deps, owner, 'prepare', 'seed.improve', tx => tx.put<ImprovementRunRecord>({
    ...tx.base('venture-improvement-run'), status: 'kept-parent', parentPlaybookId: 'playbook_1', parentHash: 'h', candidatePlaybookId: null,
    frozen: { pool: [], reserve: [], rehearsal: [], digest: 'f' },
    rounds: [
      { round: 1, diagnosis: { clusters: [], chosen: { reason: 'tone', step: 'draft', level: 'harness' } }, patch: null, refused: null, candidateHash: 'c1',
        gate: { cases: [], wins: 0, losses: 1, ties: 2, candidateCritical: 0, newBlockFailures: 0, decision: 'keep-parent', reason: 'The change lost one practice client and won none.' } },
      { round: 2, diagnosis: { clusters: [], chosen: null }, patch: null, refused: 'No other failure has a change Chausar can try.', candidateHash: null, gate: null },
    ],
    maxRounds: 2, costMicros: '0', costDisplay: 'USD 0.0000', modelMode: 'template', incompleteReason: null, changes: [], digest: 'd',
    startedAt: '2026-10-15T09:57:00.000Z',
  }));
  const [listed] = await runs(env);
  assert.deepEqual(listed, {
    runId: improvement.id, businessId: 'main', agent: 'Bookkeeping agent', purpose: 'Improve the playbook from your feedback', state: 'done',
    startedAt: '2026-10-15T09:57:00.000Z', elapsed: '3m', result: 'Kept your current playbook: the change did not do better.',
  });
  const detail = await get(env, improvement.id);
  assert.deepEqual(detail.steps.map(step => [step.id, step.purpose, step.state]), [
    ['round-1', 'Try a change for the tone', 'done'],
    ['round-2', 'Look for another change to try', 'done'],
  ]);
  assert.deepEqual(detail.steps[0].tools, [{ name: 'Compared with your current playbook', line: 'The change lost one practice client and won none.' }]);
  assert.deepEqual(detail.steps[1].tools, [{ name: 'Looked for a change', line: 'No other failure has a change Chausar can try.' }]);
});
