// P1-A: runs (venture.runs.list and venture.runs.get) built from delivery runs, their harness turns and rehearsals.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, RunDetail, RunSummary, SimulationRunRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery, scenariosFor } from '../runtime/venture/delivery/index.ts';
import { CLIENT_NAME, START, call, code, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';

const runs = (env: Env, state?: 'active' | 'done' | 'all') => call<{ runs: RunSummary[] }>(env, 'venture.runs.list', state ? { state } : {}).then(result => result.runs);
const get = (env: Env, runId: string) => call<RunDetail>(env, 'venture.runs.get', { runId });
const states = (detail: RunDetail) => detail.steps.map(step => [step.id, step.state]);

async function ready(env: Env) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order, receipt } = await seedOrder(env, plan);
  return { plan, order, receipt };
}

test('runs: a template draft waits on you, its steps skip the agent loop, and it folds to done after review', async () => {
  const env = await setup();
  const { order, receipt } = await ready(env);
  const outline = await delivery['venture.delivery.run']!(env.deps, owner, { orderId: order.id, useTemplate: true }) as DeliveryRunRecord;
  const [summary] = await runs(env);
  assert.deepEqual(summary, {
    runId: outline.id, businessId: 'main', agent: 'Bookkeeping agent', purpose: `Draft a reply for ${CLIENT_NAME}`, state: 'waiting',
    startedAt: START, elapsed: '0s', progress: { done: 3, total: 5 },
  });
  const detail = await get(env, outline.id);
  assert.deepEqual(states(detail), [['price', 'done'], ['draft', 'done'], ['verify', 'done'], ['approve', 'waiting'], ['send', 'pending']]);
  assert.equal(detail.steps[0].purpose, 'Take prices from the calculator');
  assert.deepEqual(detail.steps[0].evidence, [{ kind: 'price-receipt', id: receipt.id, label: 'Price receipt' }]);
  assert.deepEqual(detail.steps[1].evidence, [{ kind: 'draft', id: outline.id, label: outline.deliverable!.title }]);
  assert.ok(detail.steps[2].evidence!.length > 0 && detail.steps[2].evidence!.every(item => item.kind === 'check' && item.label.startsWith('Passed: ')));
  assert.equal(detail.question, undefined);
  assert.deepEqual(await runs(env, 'done'), []);

  // Five minutes later the owner accepts it: the run is done, and its time stops at the review.
  env.advance(5 * 60_000);
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  env.advance(60 * 60_000);
  const [done] = await runs(env, 'done');
  assert.deepEqual({ state: done.state, elapsed: done.elapsed, result: done.result, progress: done.progress },
    { state: 'done', elapsed: '5m', result: 'Draft accepted. You send it to the client.', progress: undefined });
  assert.deepEqual(states(await get(env, outline.id)).slice(-2), [['approve', 'done'], ['send', 'pending']]);
  assert.deepEqual(await runs(env, 'active'), []);
});

test('runs: an agent run names its tools by purpose, shows receipts as evidence, and carries its question', async () => {
  const env = await setup();
  const { order } = await ready(env);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  await ventureAction(env.deps, owner, 'prepare', 'seed.work', tx => {
    tx.state.conversations.push({ id: 'work_1', kind: 'venture-work-receipt', ventureId: tx.venture!.id, explanation: 'Money out in September adds up to INR 41,250.00.', figures: [] });
    tx.state.conversations.push({ id: 'upload_1', kind: 'venture-upload', ventureId: tx.venture!.id, name: 'aroma-bank.csv', format: 'csv' });
  });
  const ok = (result: unknown) => ({ ok: true as const, result: result as any });
  const turn = (tool: string, envelope: any, receiptIds: string[] = []) => ({
    id: `tc_${tool}`, turn: 1, tool, input: {}, inputDigest: 'd', envelope, outcome: envelope.ok ? 'succeeded' as const : 'failed' as const,
    effect: null, tier: null, receiptIds, tableIds: [],
  });
  const asking = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'needs-answer',
    harness: harness({
      phase: 'needs-answer', uploadIds: ['upload_1'], workReceiptIds: ['work_1'],
      toolCalls: [
        turn('files.read', ok({})), turn('calc.totals', ok({}), ['work_1']),
        turn('sandbox.python', { ok: false, error: { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: 'Docker is not set up on this computer.' } }),
        turn('handoff.owner', ok({})),
      ],
      handoffs: [{ to: 'owner', question: 'Which bank account is the main one?', turn: 1, answer: null, answeredBy: null }],
    }),
  }, ['run.waiting']);
  const detail = await get(env, asking.id);
  assert.equal(detail.state, 'waiting');
  assert.deepEqual(states(detail), [
    ['gather', 'done'], ['clarify', 'waiting'], ['work', 'done'], ['price', 'pending'], ['draft', 'pending'], ['verify', 'pending'], ['approve', 'pending'], ['send', 'pending'],
  ]);
  assert.deepEqual(detail.progress, { done: 2, total: 8 });
  const [gather, clarify, work] = detail.steps;
  assert.deepEqual(gather.tools, [{ name: 'Read a client file', line: 'Done.' }]);
  assert.deepEqual(gather.evidence, [{ kind: 'file', id: 'upload_1', label: 'aroma-bank.csv' }]);
  assert.deepEqual(clarify.tools, [{ name: 'Asked you a question', line: 'Done.' }]);
  assert.deepEqual(work.tools, [
    { name: 'Worked out totals with the calculator', line: 'Done.' },
    { name: 'Ran a small program in a container', line: 'Docker is not set up on this computer.' },
  ]);
  assert.deepEqual(work.evidence, [{ kind: 'work-receipt', id: 'work_1', label: 'Money out in September adds up to INR 41,250.00.' }]);
  assert.ok(detail.question);
  assert.equal(detail.question.text, 'Which bank account is the main one?');
  // The question id is the Today row that answers it.
  const queue = await call<{ rows: { id: string; kind: string }[] }>(env, 'venture.queue.list', {});
  assert.equal(queue.rows.find(row => row.kind === 'question')?.id, detail.question.id);
  assert.deepEqual((await runs(env, 'active')).map(run => run.runId), [asking.id]);
});

test('runs: a failed run shows the engine error; rehearsals are listed; unknown runs and bad payloads are refused', async () => {
  const env = await setup();
  const { order } = await ready(env);
  await ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => {
    tx.state.conversations.push({ id: 'call_9', kind: 'venture-model-call', ventureId: tx.venture!.id, status: 'failed', error: { code: 'MODEL_FAILED', message: 'The provider did not answer.' } });
  });
  const failed = await seedRun(env, order, { status: 'failed', callId: 'call_9' }, ['run.failed']);
  const detail = await get(env, failed.id);
  assert.equal(detail.state, 'failed');
  assert.equal(detail.error, 'The provider did not answer.');
  const draft = detail.steps.find(step => step.id === 'draft')!;
  assert.deepEqual([draft.state, draft.error], ['failed', 'The provider did not answer.']);

  const scenarios = scenariosFor('bookkeeping');
  env.advance(2 * 60_000);
  const rehearsal = await ventureAction(env.deps, owner, 'prepare', 'seed.simulation', tx => {
    const episode = (index: number, passed: boolean) => ({
      scenarioId: scenarios[index].id, index: 0, turns: [], deliverable: null, renderedText: null, mocks: [], judge: [], costMicros: '0',
      checks: passed ? [] : [{ check: 'required-sections' as const, passed: false, detail: 'The draft is missing Next steps.' }], passed, firstFailure: passed ? null : 'The draft is missing Next steps.',
    });
    return tx.put<SimulationRunRecord>({
      ...tx.base('venture-simulation-run'), playbookId: 'playbook_x', playbookHash: 'h', scenarioIds: scenarios.slice(0, 2).map(item => item.id),
      episodes: [episode(0, true), episode(1, false)], passed: false, summary: { scenarios: 2, passed: 1, failed: 1 }, costMicros: '0', costDisplay: 'USD 0.0000',
      startedAt: '2026-10-15T10:01:00.000Z', finishedAt: '2026-10-15T10:02:30.000Z', modelMode: 'template',
    });
  });
  const all = await runs(env);
  assert.deepEqual(all.map(run => run.runId), [rehearsal.id, failed.id], 'newest first');
  assert.deepEqual({ ...all[0] }, {
    runId: rehearsal.id, businessId: 'main', agent: 'Bookkeeping agent', purpose: 'Rehearse with practice clients', state: 'done',
    startedAt: '2026-10-15T10:01:00.000Z', elapsed: '1m', result: '1 of 2 practice clients passed.',
  });
  const steps = (await get(env, rehearsal.id)).steps;
  assert.deepEqual(steps.map(step => [step.purpose, step.state, step.error ?? null]), [
    [scenarios[0].title, 'done', null], [scenarios[1].title, 'failed', 'The draft is missing Next steps.'],
  ]);
  assert.deepEqual((await runs(env, 'done')).map(run => run.state), ['done', 'failed']);

  await assert.rejects(get(env, 'delivery_missing'), code('RUN_NOT_FOUND'));
  await assert.rejects(call(env, 'venture.runs.get', {}), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(env, 'venture.runs.list', { state: 'paused' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-queue-decision').length, 0, 'reading runs writes nothing');
});
