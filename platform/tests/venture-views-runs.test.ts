// P1-A: runs (venture.runs.list and venture.runs.get) built from delivery runs, their harness turns and rehearsals.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, ModelCallRecord, RunDetail, RunSummary, SimulationRunRecord } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { nativeContext } from './fixtures/venture/native-context.ts';
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
    startedAt: START, elapsed: '', progress: { done: 3, total: 5 }, writtenBy: "Written by Chausar's template, not your AI",
    // C4 task 12: it waits on the owner from the moment the draft was handed over, and names its client.
    waitingSince: START, client: { id: order.clientId, name: CLIENT_NAME },
  });
  const detail = await get(env, outline.id);
  assert.deepEqual(states(detail), [['price', 'done'], ['draft', 'done'], ['verify', 'done'], ['approve', 'waiting'], ['send', 'pending']]);
  assert.equal(detail.steps[0].purpose, 'Take prices from the calculator');
  assert.deepEqual(detail.steps[0].evidence, [{ kind: 'price-receipt', id: receipt.id, label: 'Price receipt' }]);
  assert.deepEqual(detail.steps[1].evidence, [{ kind: 'draft', id: outline.id, label: outline.deliverable!.title }]);
  assert.ok(detail.steps[2].evidence!.length > 0 && detail.steps[2].evidence!.every(item => item.kind === 'check' && item.label.startsWith('Passed: ')));
  assert.equal(detail.question, undefined);
  assert.deepEqual(await runs(env, 'done'), []);

  // Five minutes later the owner accepts it: the run is done, and its time stops at the review. C4 task 12: those five
  // minutes were the owner's wait, so the template worked no time and waited 5 min.
  env.advance(5 * 60_000);
  await delivery['venture.delivery.review']!(env.deps, owner, { runId: outline.id, verdict: 'accepted' });
  env.advance(60 * 60_000);
  const [done] = await runs(env, 'done');
  assert.deepEqual({ state: done.state, elapsed: done.elapsed, waited: done.waited, result: done.result, progress: done.progress },
    { state: 'done', elapsed: '', waited: '5 min', result: 'Draft accepted. You send it to the client.', progress: undefined });
  assert.deepEqual(states(await get(env, outline.id)).slice(-2), [['approve', 'done'], ['send', 'pending']]);
  assert.deepEqual(await runs(env, 'active'), []);
});

test('runs: an agent run names its tools by purpose, shows receipts as evidence, and carries its question', async t => {
  const env = await setup();
  const { order } = await ready(env);
  await setStage(env, 'approve-each');
  const playbook = await delivery['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const upload = await delivery['venture.files.add']!(env.deps, owner, { orderId: order.id, name: 'aroma-bank.csv', contentBase64: Buffer.from('Date,Amount\n2026-10-01,10\n').toString('base64') });
  await ventureAction(env.deps, owner, 'prepare', 'seed.work', tx => {
    tx.state.conversations.push({ id: 'work_1', kind: 'venture-work-receipt', ventureId: tx.venture!.id, explanation: 'Money out in September adds up to INR 41,250.00.', figures: [] });
  });
  const ok = (result: unknown) => ({ ok: true as const, result: result as any });
  const turn = (tool: string, envelope: any, receiptIds: string[] = []) => ({
    id: `tc_${tool}`, turn: 1, tool, input: {}, inputDigest: 'd', envelope, outcome: envelope.ok ? 'succeeded' as const : 'failed' as const,
    effect: null, tier: null, receiptIds, tableIds: [],
  });
  const asking = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'stopped',
    harness: harness({
      phase: 'act', uploadIds: [upload.id], workReceiptIds: ['work_1'],
      toolCalls: [
        turn('files.read', ok({})), turn('calc.totals', ok({}), ['work_1']),
        turn('sandbox.python', { ok: false, error: { code: 'TIER_UNAVAILABLE', name: 'TierUnavailable', message: 'Docker is not set up on this computer.' } }),
        turn('handoff.owner', ok({})),
      ],
      handoffs: [{ to: 'owner', question: 'Which bank account is the main one?', turn: 1, answer: 'The current account.', answeredBy: 'owner' }],
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
  assert.deepEqual(gather.evidence, [{ kind: 'file', id: upload.id, label: 'aroma-bank.csv' }]);
  assert.deepEqual(clarify.tools, [{ name: 'Asked you a question', line: 'Done.' }]);
  assert.deepEqual(work.tools, [
    { name: 'Worked out totals with the calculator', line: 'Done.' },
    { name: 'Ran a small program in a container', line: 'Docker is not set up on this computer.' },
  ]);
  assert.deepEqual(work.evidence, [{ kind: 'work-receipt', id: 'work_1', label: 'Money out in September adds up to INR 41,250.00.' }]);
  assert.equal(detail.question, undefined, 'the historical code-tool question was already answered');
  // Current questions belong to the native job. Do not mix an obsolete handoff into its state.
  env.advance(1000);
  const native = await nativeContext(env.deps, owner, order.id);
  t.after(() => native.job.close());
  const question = 'Which bank account is the main one?';
  await ventureAction(env.deps, owner, 'prepare', 'seed.native-question', tx => {
    const run = tx.find('venture-delivery-run', native.run.id)!;
    tx.replace({ ...run, status: 'needs-answer', agentJob: { ...run.agentJob!,
      pendingFacts: { digest: digest(question), missing: [], question, callId: 'synthetic-facts', at: tx.now } } });
  });
  const current = await get(env, native.run.id);
  assert.ok(current.question);
  assert.equal(current.question.text, question);
  assert.ok(current.agentProgress);
  // The exact native question id is the Today row that answers it.
  const queue = await call<{ rows: { id: string; kind: string; viewRef?: { id: string } }[] }>(env, 'venture.queue.list', {});
  assert.equal(queue.rows.find(row => row.kind === 'question' && row.viewRef?.id === native.run.id)?.id, current.question.id);
  assert.deepEqual((await runs(env, 'active')).map(run => run.runId), [native.run.id, asking.id]);
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
      episodes: [episode(0, true), episode(1, false)], passed: false, summary: { scenarios: 2, passed: 1, failed: 1 }, costMicros: '0', costDisplay: '$0.00',
      startedAt: '2026-10-15T10:01:00.000Z', finishedAt: '2026-10-15T10:02:30.000Z', modelMode: 'template',
    });
  });
  const all = await runs(env);
  assert.deepEqual(all.map(run => run.runId), [rehearsal.id, failed.id], 'newest first');
  assert.deepEqual({ ...all[0] }, {
    runId: rehearsal.id, businessId: 'main', agent: 'Bookkeeping agent', purpose: 'Rehearse with practice clients', state: 'done',
    startedAt: '2026-10-15T10:01:00.000Z', elapsed: '1 min 30 s', result: '1 of 2 practice clients passed.',
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

// Ink v2 wave 4 (4H2, U17): a run in the list names the engine that wrote its draft, from the run's own call record,
// the same line venture.delivery.list carries; nothing is claimed before an answer came.
test('runs: each run says who wrote its draft, from its own model call; nothing before the answer', async () => {
  const env = await setup();
  const { order } = await ready(env);
  const seedCall = (fields: Partial<ModelCallRecord>) => ventureAction(env.deps, owner, 'prepare', 'seed.call', tx => tx.put({
    ...tx.base('venture-model-call'), purpose: 'delivery', tier: 'main', presetId: 'anthropic-sonnet-5-5', connectionId: 'conn_synthetic',
    routeKind: 'anthropic-messages', model: 'claude-sonnet-5-5', consent: 'approved-preview', endpoint: 'https://api.anthropic.com/v1/messages',
    payloadText: '{}', payloadDigest: 'payload-digest', payloadTruncated: false, containsClientData: true, status: 'completed', approvedDigest: 'payload-digest',
    approvedAt: null, approvedBy: 'owner', estimatedMaxCostMicros: '1000', priceConfirmed: true, usage: { inputTokens: 10, outputTokens: 5 }, costMicros: '60',
    outputDigest: 'output-digest', error: null, replay: false, ...fields,
  } as ModelCallRecord));
  const answered = await seedCall({ answeredBy: 'claude-sonnet-5-5-20261001' });
  const pending = await seedCall({ status: 'dispatching', answeredBy: undefined });
  const drafted = await seedRun(env, order, { status: 'ready-for-review', servedBy: 'model', callId: answered.id });
  const waiting = await seedRun(env, order, { status: 'waiting-for-you', servedBy: 'model', callId: pending.id });
  const byId = new Map((await runs(env, 'all')).map(run => [run.runId, run]));
  assert.equal(byId.get(drafted.id)!.writtenBy, 'Written by Claude Sonnet 5.5');
  assert.equal('writtenBy' in byId.get(waiting.id)!, false, 'nothing is claimed before the answer');
  const listed = await delivery['venture.delivery.list']!(env.deps, owner, {}) as { id: string; writtenBy?: string | null }[];
  assert.equal(listed.find(run => run.id === drafted.id)!.writtenBy, byId.get(drafted.id)!.writtenBy, 'the same line as the draft list');
  assert.equal((await get(env, drafted.id)).writtenBy, 'Written by Claude Sonnet 5.5');
});
