// Ink v2 wave 4, package 4F3: what the screens read from the run controls. venture.get says whether the business is
// paused (since when, with the engine's line), so the business menu offers Pause all or Unpause after a reload; the
// stopped job cannot resume after a newer job replaced it.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { VentureView } from '../runtime/venture/contracts.ts';
import { findRecord } from '../runtime/venture/records.ts';
import { getVenture } from '../runtime/venture/core/venture.ts';
import { call, owner, setup, startNativeDraft, stop } from './venture-run-controls-env.ts';

const PAUSED_LINE = 'Paused by you. No new work starts until you unpause.';

test('venture.get says the business is paused, since when, in the engine words; unpaused, it says nothing', async () => {
  const env = await setup();
  const before = await getVenture(env.deps, owner, {}) as VentureView;
  assert.equal(before.paused, undefined, 'never paused: no field');
  await call(env, 'venture.business.pause', { paused: true });
  const paused = await getVenture(env.deps, owner, {}) as VentureView;
  assert.equal(paused.paused?.line, PAUSED_LINE);
  assert.match(paused.paused?.since ?? '', /^\d{4}-\d{2}-\d{2}T/);
  // Pausing again keeps the first moment it was paused.
  await call(env, 'venture.business.pause', { paused: true });
  assert.equal((await getVenture(env.deps, owner, {}) as VentureView).paused?.since, paused.paused?.since);
  await call(env, 'venture.business.pause', { paused: false });
  assert.equal((await getVenture(env.deps, owner, {}) as VentureView).paused, undefined);
});

test('Resume refuses a stopped run that a newer run of the same order replaced, in plain words', async () => {
  const env = await setup();
  const observations: unknown[] = [];
  const run = await startNativeDraft(env, { observe: (name, data) => { if (name === 'tool_error') observations.push(data); } });
  assert.equal(run.status, 'ready-for-review', JSON.stringify(observations));
  await stop(env, run.id);
  const order = findRecord(env.store.read(), 'venture-order', run.orderId)!;
  const again = await startNativeDraft(env, { order });
  assert.notEqual(again.id, run.id);
  await assert.rejects(call(env, 'venture.runs.resume', { runId: run.id }), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'RUN_SUPERSEDED');
    assert.equal(error.message, 'A newer job for this order replaced this one, so it cannot be resumed. Open the newer job instead.');
    return true;
  });
});
