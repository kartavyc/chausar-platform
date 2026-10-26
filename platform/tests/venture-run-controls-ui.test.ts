// Ink v2 wave 4, package 4F3: what the screens read from the run controls. venture.get says whether the business is
// paused (since when, with the engine's line), so the business menu offers Pause all or Unpause after a reload; the
// scope's spend cap carries a receipt, so the run sheet's scope line is proved.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { RunDetail, VentureView } from '../runtime/venture/contracts.ts';
import { getVenture } from '../runtime/venture/core/venture.ts';
import { getReceipt } from '../runtime/venture/money/quote.ts';
import { DONE, READ, call, getRun, owner, scriptTurns, setup, startRun, stop } from './venture-run-controls-env.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import type { DeliveryRunView } from '../runtime/venture/contracts.ts';

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

test("the scope's spend cap carries a receipt that states the cap", async () => {
  const env = await setup();
  const run = await startRun(env, [READ, DONE]);
  const detail: RunDetail = await getRun(env, run.id);
  assert.ok(detail.scope, 'the run has a scope');
  const receiptId = detail.scope!.capReceiptId;
  assert.ok(receiptId, 'the cap has a receipt');
  const receipt = await getReceipt(env.deps, owner, { id: receiptId });
  assert.equal(receipt.id, receiptId);
  assert.ok(JSON.stringify(receipt).includes(detail.scope!.cap), 'the receipt states the same cap');
});

test('Resume refuses a stopped run that a newer run of the same order replaced, in plain words', async () => {
  const env = await setup();
  const run = await startRun(env, [READ, DONE]);
  await stop(env, run.id);
  scriptTurns(env, [READ, DONE]);
  const again = await call<DeliveryRunView>(env, 'venture.delivery.run', { orderId: run.orderId });
  assert.notEqual(again.id, run.id);
  await assert.rejects(call(env, 'venture.runs.resume', { runId: run.id }), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'RUN_SUPERSEDED');
    assert.equal(error.message, 'A newer run of this order replaced this one, so it cannot be resumed. Open the newer run instead.');
    return true;
  });
});

test("the scope's cap carries the rupee view at the owner's rate, in the view and on its receipt", async () => {
  const env = await setup();
  await ventureAction(env.deps, owner, 'admin', 'seed.rate', tx => tx.put({
    ...tx.base('venture-spend-policy'), capMicros: null, askAboveMicros: null, rates: [], rupeeRate: { perUsd: '835000', setOn: '2026-10-15' },
  } as never));
  const run = await startRun(env, [READ, DONE]);
  const scope = (await getRun(env, run.id)).scope!;
  assert.match(scope.capRupees ?? '', /^₹[\d,]+\.\d{2}$/);
  assert.match(scope.capRate ?? '', /per \$1 \(your rate, set/);
  const receipt = await getReceipt(env.deps, owner, { id: scope.capReceiptId });
  assert.ok(JSON.stringify(receipt).includes(scope.capRupees!), 'the receipt states the same rupees');
});
