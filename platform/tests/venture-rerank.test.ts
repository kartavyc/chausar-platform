// Ink v2 wave 4 (4J14, Q23): preference sliders. venture.options.rerank re-orders options code already scored (the
// hook scorer's five properties) by the owner's weights, in code, with no AI call; a hard failure still goes to review.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RerankView, VentureDeps, WorkTableRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { HOOK_FLOOR, hookScore, type HookProperty } from '../runtime/venture/playbooks/youtube/checks.ts';
import { code, harness, owner, phone, seedBlueprint, seedOrder, seedRun, setup, type Env } from './venture-views-env.ts';

const HOOKS = [
  'You are losing 40 percent of viewers in the first 30 seconds, and here is why nobody tells you.',
  'Why your best video flopped before anyone watched it.',
  'Hello everyone and welcome back to the channel.',
  'Stop wasting your weekends on edits you never post.',
  'Today we talk about video.',
];

/** What the scorer's own call answered: the kept two and the others, best first, in its cleaned words. */
function answer() {
  const ranked = [...HOOKS].map(hookScore).sort((a, b) => b.verdict - a.verdict);
  return { table: 't1', kept: ranked.slice(0, 2).map(score => ({ hook: score.hook })), others: ranked.slice(2).map(score => ({ hook: score.hook })) } as never;
}

/** Models that fail the test if anything asks them: reranking never calls an AI. */
const noModels = new Proxy({}, { get: (_target, key) => (key === 'then' ? undefined : () => { throw new Error(`An AI was asked: ${String(key)}`); }) });

async function scored(env: Env, options: { withCall?: boolean } = {}) {
  const plan = await seedBlueprint(env, { price2: '1500000' });
  const { order } = await seedOrder(env, plan);
  const run = await seedRun(env, order, {
    status: 'ready-for-review',
    harness: harness({
      tableIds: ['worktable_hooks'],
      toolCalls: options.withCall === false ? [] : [{
        id: 'tc_hooks', turn: 1, tool: 'youtube.hooks', input: { hooks: HOOKS }, inputDigest: 'd', envelope: { ok: true, result: answer() }, outcome: 'succeeded',
        effect: 'compute', tier: 'code', receiptIds: [], tableIds: ['worktable_hooks'],
      }],
    }),
  });
  await ventureAction(env.deps, owner, 'prepare', 'seed.table', tx => {
    const kept = [...HOOKS].map(hookScore).sort((a, b) => b.verdict - a.verdict).slice(0, 2);
    tx.put<WorkTableRecord>({
      ...tx.base('venture-work-table'), id: 'worktable_hooks', name: 'Hooks the scorer kept', columns: ['Hook', 'Score', 'Band', 'Weakest', 'Fix'],
      rows: kept.map((score, i) => ({ id: `r${i + 1}`, cells: { Hook: score.hook, Score: String(score.verdict), Band: score.band, Weakest: score.weakest, Fix: score.fix } })),
      source: { kind: 'computed', tool: 'youtube.hooks', uploadIds: [] }, runRef: { kind: 'delivery', runId: run.id }, digest: 'd',
    } as WorkTableRecord);
    tx.put<WorkTableRecord>({
      ...tx.base('venture-work-table'), id: 'worktable_other', name: 'Edit list', columns: ['From'], rows: [],
      source: { kind: 'computed', tool: 'youtube.editList', uploadIds: [] }, runRef: { kind: 'delivery', runId: run.id }, digest: 'e',
    } as WorkTableRecord);
  });
  return run;
}

const rerank = (env: Env, payload: unknown, ctx = owner) =>
  delivery['venture.options.rerank']!({ ...env.deps, models: noModels } as unknown as VentureDeps, ctx, payload) as Promise<RerankView>;

/** What code should give: the weighted mean of the five properties, rounded half up; failures last; ties by score, then order written. */
function expected(weights: Partial<Record<HookProperty, number>>, hooks = HOOKS) {
  const sum = Object.values(weights).reduce((a, b) => a + (b ?? 0), 0);
  return hooks.map((hook, index) => {
    const score = hookScore(hook);
    const weighted = (Object.keys(score.properties) as HookProperty[]).reduce((total, key) => total + (weights[key] ?? 0) * score.properties[key], 0);
    return { hook, index, verdict: score.verdict, score: Math.floor((2 * weighted + sum) / (2 * sum)), failed: score.verdict < HOOK_FLOOR };
  }).sort((a, b) => Number(a.failed) - Number(b.failed) || b.score - a.score || b.verdict - a.verdict || a.index - b.index);
}

test('rerank: the owner\'s weights re-order every scored hook in code; failures stay, last, marked for review', async () => {
  const env = await setup();
  await scored(env);
  const before = listRecords(env.store.read(), 'venture-model-call').length;
  const weights = { stakes: 10, brevity: 2 };
  const view = await rerank(env, { questionId: 'worktable_hooks', weights });
  const want = expected(weights);
  assert.deepEqual(view.options.map(option => option.text), want.map(item => item.hook));
  assert.deepEqual(view.options.map(option => option.score), want.map(item => item.score));
  assert.deepEqual(view.options.map(option => option.failed), want.map(item => item.failed));
  assert.ok(view.options.some(option => option.failed), 'a greeting hook fails the floor');
  const firstFailed = view.options.findIndex(option => option.failed);
  assert.ok(view.options.slice(firstFailed).every(option => option.failed), 'no weight lifts a failure above a hook that passed');
  assert.deepEqual(view.options.map(option => option.label), want.map(item => `Hook ${item.index + 1}`));
  assert.deepEqual(view.options.map(option => option.id), want.map(item => `worktable_hooks.${item.index + 1}`));
  assert.ok(view.options.every(option => option.estimate === null), 'a code score is no model estimate');
  assert.equal(listRecords(env.store.read(), 'venture-model-call').length, before, 'no AI call');
  // Other weights give another order from the same scores.
  const curious = await rerank(env, { questionId: 'worktable_hooks', weights: { curiosity: 5, address: 5 } });
  assert.deepEqual(curious.options.map(option => option.text), expected({ curiosity: 5, address: 5 }).map(item => item.hook));
  // Reading is allowed from the phone; it changes nothing.
  await rerank(env, { questionId: 'worktable_hooks', weights }, phone);
});

test('rerank: without the scorer\'s call, the kept hooks in its table are re-ranked', async () => {
  const env = await setup();
  await scored(env, { withCall: false });
  const view = await rerank(env, { questionId: 'worktable_hooks', weights: { specificity: 1 } });
  const kept = [...HOOKS].map(hookScore).sort((a, b) => b.verdict - a.verdict).slice(0, 2).map(score => score.hook);
  assert.deepEqual(view.options.map(option => option.text).sort(), [...kept].sort());
});

test('rerank: weights are whole numbers from 0 to 10 on the five properties, at least one above 0; unknown options are refused', async () => {
  const env = await setup();
  await scored(env);
  const refused = (payload: unknown, expectedCode: string) => assert.rejects(rerank(env, payload), code(expectedCode), JSON.stringify(payload));
  await refused({ questionId: 'worktable_hooks', weights: { charm: 3 } }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: { stakes: 11 } }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: { stakes: 1.5 } }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: { stakes: -1 } }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: { stakes: 0, brevity: 0 } }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: {} }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: [] }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks' }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_hooks', weights: { stakes: 1 }, extra: true }, 'INVALID_VENTURE_REQUEST');
  await refused({ questionId: 'worktable_missing', weights: { stakes: 1 } }, 'QUESTION_NOT_FOUND');
  await refused({ questionId: 'worktable_other', weights: { stakes: 1 } }, 'QUESTION_NOT_FOUND');
});
