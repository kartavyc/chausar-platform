// C5 task 28: Diagnostics in plain words. Fixed records give the exact minutes, summed by code from the business's own
// records, each sum with the calls that went into it. Nothing today says so.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { OrderRecord } from '../runtime/venture/contracts.ts';
import type { DiagnosticsTodayView } from '../runtime/venture/views/diagnostics-core.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { START, call as ask, code, owner, seedBlueprint, seedOrder, seedRun, setup, type Env } from './venture-views-env.ts';

const today = (env: Env) => ask<DiagnosticsTodayView>(env, 'venture.diagnostics.today', {});
const at = (minutes: number) => new Date(Date.parse(START) + minutes * 60_000).toISOString();
const toolCall = (id: string, tool: string, from: number, to: number) => ({
  id, turn: 1, tool, input: {}, inputDigest: 'd', envelope: { ok: true as const, result: {} as any }, outcome: 'succeeded' as const,
  effect: null, tier: null, receiptIds: [], tableIds: [], startedAt: at(from), finishedAt: at(to),
});
async function business(env: Env): Promise<OrderRecord> {
  const plan = await seedBlueprint(env);
  return (await seedOrder(env, plan)).order;
}
const emit = (env: Env, name: 'run.waiting' | 'run.step' | 'run.done', runId: string) => ventureAction(env.deps, owner, 'prepare', 'seed.event', tx => { tx.emit(name, { runId }); });

test('no calls today: "Nothing ran today."', async () => {
  const env = await setup();
  assert.deepEqual(await today(env), { day: '2026-10-15', line: 'Nothing ran today.', rows: [], modelCalls: 0 });
  await assert.rejects(ask(env, 'venture.diagnostics.today', { day: '2026-10-15' }), code('INVALID_VENTURE_REQUEST'));
});

test('fixed records give the exact minutes: tools by what they do, the wait apart, the most first; each sum has its calls', async () => {
  const env = await setup();
  const order = await business(env);
  const run = await seedRun(env, order, { status: 'waiting-for-you', harness: { toolCalls: [toolCall('tc_read', 'files.read', 0, 1), toolCall('tc_sum', 'calc.totals', 1, 3), toolCall('tc_old', 'calc.totals', -20_000, -19_999)] } as any }, ['run.started']);
  env.advance(3 * 60_000); await emit(env, 'run.waiting', run.id);
  env.advance(6 * 60_000); await emit(env, 'run.step', run.id);
  const view = await today(env);
  assert.equal(view.line, 'Today Chausar spent most of its time waiting for you (6 min) and writing drafts (2 min).');
  assert.deepEqual(view.rows.map(row => [row.key, row.label, row.ms, row.display]), [
    ['owner', 'waiting for you', 360_000, '6 min'],
    ['tool:writing drafts', 'writing drafts', 120_000, '2 min'],
    ['tool:reading your files', 'reading your files', 60_000, '1 min'],
  ]);
  assert.deepEqual(view.rows[1]!.receipt, { source: 'tool-calls', items: [{ id: 'tc_sum', ms: 120_000 }], sumMs: 120_000 }, 'a call from another day is not in it');
  assert.deepEqual(view.rows[0]!.receipt, { source: 'run-events', items: [{ id: run.id, ms: 360_000 }], sumMs: 360_000 });
  for (const row of view.rows) assert.equal(row.receipt.items.reduce((sum, item) => sum + item.ms, 0), row.ms);
});

test('an owner\'s-AI job counts as waiting for that tool, without the time it waited for the owner', async () => {
  const env = await setup();
  const order = await business(env);
  const job = { tools: [], messages: [], proposal: null, route: { model: 'claude-sonnet-5-5', tier: 'standard' } } as any;
  const run = await seedRun(env, order, { status: 'waiting-for-you', agentJob: job }, ['run.started']);
  env.advance(3 * 60_000); await emit(env, 'run.waiting', run.id);
  env.advance(60_000); await emit(env, 'run.step', run.id);
  env.advance(40_000); await emit(env, 'run.done', run.id);
  env.advance(60 * 60_000);
  const view = await today(env);
  assert.equal(view.line, 'Today Chausar spent most of its time waiting for Claude Code (3 min 40 s) and waiting for you (1 min).');
  const codex = await setup();
  const again = await business(codex);
  await seedRun(codex, again, { status: 'waiting-for-you', agentJob: { ...job, route: { presetId: 'cli-codex', model: 'gpt-6', tier: 'standard' } } }, ['run.started']);
  codex.advance(40_000);
  assert.equal((await today(codex)).line, 'Today Chausar spent most of its time waiting for Codex (40 s).');
});

test('two runs waiting at once are one wait; a wait from yesterday counts only from midnight', async () => {
  const env = await setup();
  const order = await business(env);
  const first = await seedRun(env, order, { status: 'waiting-for-you' }, ['run.waiting']);
  env.advance(2 * 60_000);
  const second = await seedRun(env, order, { status: 'waiting-for-you' }, ['run.waiting']);
  env.advance(3 * 60_000);
  await emit(env, 'run.step', first.id);
  env.advance(60_000);
  await emit(env, 'run.step', second.id);
  const view = await today(env);
  assert.equal(view.rows[0]!.ms, 6 * 60_000, 'the six minutes from the first wait to the last');
  assert.deepEqual(view.rows[0]!.receipt.items, [{ id: first.id, ms: 5 * 60_000 }, { id: second.id, ms: 60_000 }]);

  const long = await setup();
  const longOrder = await business(long);
  await seedRun(long, longOrder, { status: 'waiting-for-you' }, ['run.waiting']);
  // START is 15:30 in India: the next day's 01:00 there is 9.5 hours later, one hour after midnight.
  long.advance(9.5 * 3_600_000);
  const next = await today(long);
  assert.equal(next.day, '2026-10-16');
  assert.equal(next.rows[0]!.ms, 3_600_000);
  assert.equal(next.line, 'Today Chausar spent most of its time waiting for you (1 h).');
});

test('model calls are counted, not timed: their records keep no finish time', async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'prepare', 'seed.calls', tx => {
    for (const status of ['completed', 'failed', 'preview'] as const) tx.put({ ...tx.base('venture-model-call'), status } as any);
  });
  const view = await today(env);
  assert.equal(view.modelCalls, 2, 'a preview never went out');
  assert.equal(view.line, 'Today Chausar made 2 AI calls.');
});
