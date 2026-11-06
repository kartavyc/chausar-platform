// C7 task 5: routines wait for the AI plan to reset. A used-up plan at Run it sends nothing and parks the run as queued
// with the reset; the sweep after the reset brings it back to Today with a fresh 24 hours; a crash sweep never marks it
// interrupted; the owner's pause point (50 to 95 percent) holds a run at or over it; unknown never holds a run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError } from '../runtime/contracts.ts';
import type { RoutineRunRecord } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { planBookOf } from '../runtime/venture/models/plan-book.ts';
import { fromCodexLimits } from '../runtime/venture/models/plan-meter.ts';
import { validateAiSettings, defaultAiSettings } from '../runtime/venture/agent-runtime/settings.ts';
import type { ChiefEnv } from './venture-chief-helpers.ts';
import { scriptChat } from './venture-agent-helpers.ts';
import { owner } from './venture-judge-helpers.ts';

import { MIN, at, codexBusiness } from './venture-c7-helpers.ts';

const runs = (env: ChiefEnv) => listRecords(env.store.read(), 'venture-routine-run');
async function due(env: ChiefEnv, ms = 61 * MIN) {
  env.setNow(at(ms));
  await routineTick(env.deps, owner);
  const row = (await env.call('venture.queue.list')).rows.find((item: any) => item.id.startsWith('routine:'));
  assert.ok(row, 'the run waits on Today');
  return row;
}
const runIt = (env: ChiefEnv, row: any) => env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
const codexAt = (env: ChiefEnv, used: number, resetIso: string) =>
  planBookOf(env.store).note(fromCodexLimits({ rateLimits: { primary: { usedPercent: used, windowDurationMins: 300, resetsAt: Math.floor(Date.parse(resetIso) / 1000) } } }, env.deps.clock().toISOString()));

test('a used-up plan at Run it sends nothing and parks the run as queued with the reset', async () => {
  const env = await codexBusiness();
  const row = await due(env);
  codexAt(env, 100, at(3 * 60 * MIN));
  await runIt(env, row);
  assert.equal(env.aiCalls(), 0, 'nothing went to the AI');
  const run = runs(env).at(-1)!;
  assert.equal(run.state, 'queued');
  assert.deepEqual(run.waitsFor, { cli: 'codex', resetsAt: at(3 * 60 * MIN) });
  assert.match(run.line, /^Waits for your Codex plan to reset at .+\. Nothing was sent\.$/);
  // A crash sweep does not take a waiting run for one a crash cut.
  await routineTick(env.deps, owner);
  assert.equal(runs(env).at(-1)!.state, 'queued');
  // After the reset the sweep puts it back on Today, with a fresh 24 hours.
  env.setNow(at(3 * 60 * MIN + MIN));
  await routineTick(env.deps, owner);
  const back = runs(env).find(item => item.id === run.id)!;
  assert.equal(back.state, 'needs-input');
  assert.equal(back.parkedAt, at(3 * 60 * MIN + MIN));
  const again = (await env.call('venture.queue.list')).rows.filter((item: any) => item.id.startsWith('routine:'));
  assert.equal(again.length, 1);
  env.setNow(at(3 * 60 * MIN + MIN + 23 * 60 * MIN));
  await routineTick(env.deps, owner);
  assert.equal(runs(env).find(item => item.id === run.id)!.state, 'needs-input', 'its 24 hours count from when it came back');
});

test('a usage-limit failure at Run it parks the run instead of failing it; with no reset known it looks again in 30 minutes', async () => {
  const env = await codexBusiness();
  const row = await due(env);
  scriptChat(env, { answer: () => { throw new ChausarError('AI_USAGE_LIMIT', 'Codex has used up your plan for now.'); } });
  await runIt(env, row).catch(() => undefined);
  const run: RoutineRunRecord = runs(env).at(-1)!;
  assert.equal(run.state, 'queued');
  assert.deepEqual(run.waitsFor, { cli: 'codex', resetsAt: null });
  assert.equal(run.line, 'Waits for your Codex plan. Chausar looks again every 30 minutes.');
  env.setNow(at(61 * MIN + 31 * MIN));
  await routineTick(env.deps, owner);
  assert.equal(runs(env).find(item => item.id === run.id)!.state, 'needs-input');
});

test("the owner's pause point holds a run at or over it, not under it; unknown never holds a run", async () => {
  const env = await codexBusiness();
  await ventureAction(env.deps, owner, 'approve', 'test.settings', tx => {
    tx.replace({ ...tx.venture!, aiSettings: { ...defaultAiSettings(), planPause: 90 } });
  });
  let row = await due(env);
  codexAt(env, 80, at(3 * 60 * MIN));
  await runIt(env, row);
  assert.equal(env.aiCalls(), 1, '80 percent is under the pause point');
  row = await due(env, 2 * 60 * MIN + MIN);
  codexAt(env, 92, at(3 * 60 * MIN));
  await runIt(env, row);
  assert.equal(env.aiCalls(), 1, '92 percent is over it');
  assert.equal(runs(env).at(-1)!.state, 'queued');
  const fresh = await codexBusiness();
  await runIt(fresh, await due(fresh));
  assert.equal(fresh.aiCalls(), 1, 'nothing reported never holds a run');
});

test('the pause point is left out by default and only 50 to 95', () => {
  assert.equal(validateAiSettings(defaultAiSettings()).planPause, undefined);
  assert.equal(validateAiSettings({ ...defaultAiSettings(), planPause: 70 }).planPause, 70);
  assert.equal(validateAiSettings({ ...defaultAiSettings(), planPause: null }).planPause, null);
  for (const bad of [40, 96, 70.5, '70']) assert.throws(() => validateAiSettings({ ...defaultAiSettings(), planPause: bad }), { code: 'INVALID_VENTURE_REQUEST' });
});
