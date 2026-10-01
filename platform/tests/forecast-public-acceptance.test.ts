import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, forecast, history, SOURCE } from './fixtures/forecast-public-acceptance.ts';

// Each test uses fresh encrypted synthetic storage and sequential Date-only host
// clock control. No evaluator, private state writer, model, native GUI or network.
test('public imports and receipts score individual horizons and explicit missing coverage through strict IPC', async t => {
  const f = await fixture(t), r = await history(f), input = forecast(f, r), saved = await f.evaluate(input);
  assert.equal(saved.type, 'forecast-evaluation-v1'); assert.equal(saved.qualification, 'source-evidence-backtest');
  assert.equal(saved.operation, 'earned'); assert.equal(saved.currency, 'INR'); assert.deepEqual(saved.request, input);
  assert.deepEqual(saved.origins[0].training.map(row => row.totalMinor), ['100', '200', '300']);
  assert.deepEqual(saved.folds.map(fold => [fold.horizonMonths, fold.actualMinor, fold.candidate.minor, fold.candidate.signedErrorMinor,
    fold.benchmark.minor, fold.benchmark.signedErrorMinor]), [[1, '410', '400', '-10', '300', '-110'], [3, '630', '600', '-30', '300', '-330']]);
  assert.deepEqual(saved.horizons.map(horizon => [horizon.horizonMonths, horizon.scoredOrigins, horizon.requestedOrigins,
    horizon.candidate.meanAbsoluteErrorMinor, horizon.comparison]), [
    [1, 1, 1, { numerator: '10', denominator: '1' }, 'lower-absolute-error'],
    [2, 0, 1, null, 'unscored'], [3, 1, 1, { numerator: '30', denominator: '1' }, 'lower-absolute-error']]);
  assert.deepEqual(saved.horizons[1].missingOriginIds, ['june-origin']); assert.deepEqual(saved.origins[0].missingHorizonsMonths, [2]);
  assert.equal(saved.coverage.reconciledReceiptCount, 5); assert.deepEqual(saved.uncertainty, { calibratedIntervals: false, intervalType: 'none' });
  assert.match(saved.digest, /^[a-f0-9]{64}$/); assert.equal(saved.evidencePins.length, 5);
  assert.ok(saved.evidencePins.every(pin => pin.importDigests.length > 0 && pin.factDigests.length > 0));
  assert.ok(f.h.wires.some(wire => wire.method === 'forecasts.evaluate' && wire.payload.dictionaryHash === f.dictionaryHash));
  assert.equal(f.h.rejected.length, 0); assert.ok(!f.h.calls.some(call => call.method.startsWith('models.') && call.method !== 'models.list'));
  const exact = structuredClone(saved); saved.folds[0].candidate.minor = 'caller-mutated';
  assert.deepEqual(await f.get(saved.id), exact, 'Public readback returns the retained result, not a shared response object.');
});

test('a later imported correction is excluded from operational training and separately labelled restated training', async t => {
  const f = await fixture(t), r = await history(f), initial = await f.evaluate(forecast(f, r));
  await f.importMonth(6, '320', '2026-10-02T00:00:00.000Z'); const correction = await f.calculate(6);
  const input = forecast(f, r); input.origins[0].trainingReceiptIds.push(correction.id);
  const operational = await f.evaluate(input);
  assert.deepEqual(operational.origins[0].training.map(row => row.receiptId), [r['4'].id, r['5'].id, r['6'].id]);
  assert.ok(operational.origins[0].excludedTraining.some(row => row.receiptId === correction.id && row.reason === 'after-knowledge-cut'));
  assert.equal(operational.folds[0].candidate.minor, '400');
  const restated = await f.evaluate({ ...input, mode: 'restated-diagnostic' });
  assert.equal(restated.mode, 'restated-diagnostic'); assert.match(restated.interpretation, /not historical operational performance/);
  assert.deepEqual(restated.origins[0].training.map(row => row.totalMinor), ['100', '200', '320']);
  assert.ok(restated.origins[0].excludedTraining.some(row => row.receiptId === r['6'].id && row.reason === 'older-month-revision'));
  assert.equal(restated.folds[0].candidate.minor, '426'); assert.equal(restated.folds[0].candidate.signedErrorMinor, '16');
  assert.deepEqual(restated.folds[0].candidate.exactMinor, { numerator: '1280', denominator: '3' });
  const retained = await f.get(initial.id);
  assert.equal(retained.stale, true); assert.equal(retained.digest, initial.digest); assert.equal(retained.evidenceDigest, initial.evidenceDigest);
  assert.deepEqual(retained.folds, initial.folds, 'New source evidence invalidates freshness without rewriting historical arithmetic.');
});

test('an origin refuses omitted already-known corrections and admits the current receipt at that cut', async t => {
  const f = await fixture(t), r = await history(f, { earlyCorrection: true }), input = forecast(f, r);
  input.origins[0].knowledgeCut = '2026-07-03T00:00:00.000Z';
  await assert.rejects(f.evaluate(input), { code: 'FORECAST_EVIDENCE_UNAVAILABLE' });
  input.origins[0].trainingReceiptIds.push(r.correctedJune.id);
  const saved = await f.evaluate(input);
  assert.deepEqual(saved.origins[0].training.map(row => row.totalMinor), ['100', '200', '320']);
  assert.equal(saved.folds[0].candidate.minor, '426');
  assert.ok(saved.origins[0].excludedTraining.some(row => row.receiptId === r['6'].id && row.reason === 'older-month-revision'));
});

test('availability lag changes the training window and benchmark while prediction retains calendar distance', async t => {
  const f = await fixture(t), r = await history(f), input = forecast(f, r, { availabilityLagMs: 86400000, minimumTrainingMonths: 2 });
  const saved = await f.evaluate(input);
  assert.equal(saved.origins[0].effectiveTrainingKnowledgeCut, '2026-06-30T00:00:00.000Z');
  assert.deepEqual(saved.origins[0].training.map(row => row.totalMinor), ['100', '200']);
  assert.ok(saved.origins[0].excludedTraining.some(row => row.receiptId === r['6'].id && row.reason === 'month-not-available'));
  assert.equal(saved.folds[0].candidate.minor, '400'); assert.equal(saved.folds[0].benchmark.minor, '200');
  await assert.rejects(f.evaluate({ ...input, minimumTrainingMonths: 3 }), { code: 'FORECAST_HISTORY_REQUIRED' });
  const future = await f.calculate(7, '2026-08-01T00:00:00.000Z');
  input.origins[0].trainingReceiptIds.push(future.id);
  const bounded = await f.evaluate(input);
  assert.ok(bounded.origins[0].excludedTraining.some(row => row.receiptId === future.id && row.reason === 'after-event-cutoff'));
  assert.deepEqual(bounded.folds, saved.folds, 'A later event month cannot alter this origin even when explicitly supplied.');
  const gap = forecast(f, r, { minimumTrainingMonths: 2 }); gap.origins[0].trainingReceiptIds = [r['4'].id, r['6'].id];
  await assert.rejects(f.evaluate(gap), { code: 'FORECAST_GAP' });
});

test('public receipt provenance rejects hidden customer filters, source scope mismatch and caller-supplied evidence', async t => {
  const f = await fixture(t), r = await history(f), hidden = await f.calculate(6, '2026-07-01T00:00:00.000Z', { customerId: 'customer-main' });
  assert.equal(hidden.totalMinor, '300', 'The hidden filter is refused even when it happens to produce the same total.');
  const filtered = forecast(f, r); filtered.origins[0].trainingReceiptIds[2] = hidden.id;
  await assert.rejects(f.evaluate(filtered), { code: 'FORECAST_SCOPE_MISMATCH' });
  const selectedEmpty = await f.calculate(6, '2026-07-01T00:00:00.000Z', { sourceIds: [SOURCE, 'selected-empty-source'] });
  const mismatch = forecast(f, r); mismatch.origins[0].trainingReceiptIds[2] = selectedEmpty.id;
  await assert.rejects(f.evaluate(mismatch), { code: 'FORECAST_SCOPE_MISMATCH' });
  await assert.rejects(f.request('forecasts.evaluate', { ...forecast(f, r), facts: [], receipts: [] }), { code: 'INVALID_FORECAST' });
  await assert.rejects(f.request('forecasts.get', { id: 'unavailable', facts: [] }));
  const hindsight = forecast(f, r); hindsight.origins[0].knowledgeCut = '2026-08-01T00:00:00.000Z';
  await assert.rejects(f.evaluate(hindsight), { code: 'FORECAST_KNOWLEDGE_LEAK' });
});

test('encrypted lock and new Engine reopen retain exact forecasts and recheck current source authority', async t => {
  const f = await fixture(t), r = await history(f), saved = await f.evaluate(forecast(f, r));
  const retainedReceipt = await f.request('receipts.get', { id: r['6'].id });
  await f.reopen(); assert.deepEqual(await f.get(saved.id), saved);
  assert.deepEqual(await f.request('receipts.get', { id: r['6'].id }), retainedReceipt, 'Receipt and forecast evidence both survive encrypted reopen.');
  await f.request('trust.update', { allowedSources: ['other-source'] });
  await assert.rejects(f.get(saved.id), { code: 'SOURCE_REVOKED' });
  await assert.rejects(f.evaluate(forecast(f, r)), { code: 'SOURCE_REVOKED' });
  await f.reopen(); await assert.rejects(f.get(saved.id), { code: 'SOURCE_REVOKED' });
});

test('public saved forecast readback refuses a foreign author and an actually revoked permission epoch', async t => {
  const f = await fixture(t), r = await history(f), saved = await f.evaluate(forecast(f, r));
  const member = await f.request('members.add', { name: 'Synthetic forecast reader', role: 'viewer', branches: ['main'] });
  f.as(member); await assert.rejects(f.get(saved.id), { code: 'FORECAST_FORBIDDEN' });
  f.as(); await f.request('members.revoke', { id: member.id });
  f.as(member); await assert.rejects(f.get(saved.id), { code: 'ACCESS_REVOKED' }); f.as();
  assert.deepEqual(await f.get(saved.id), saved);
});

test('exact minor units beyond Number precision survive public import, scoring and encrypted reopen', async t => {
  const f = await fixture(t), base = '900719925474099300', r = await history(f, { baseMinor: base }), saved = await f.evaluate(forecast(f, r));
  assert.equal(r['6'].totalMinor, '900719925474099600');
  assert.equal(saved.folds[0].candidate.minor, '900719925474099700'); assert.equal(saved.folds[0].candidate.signedErrorMinor, '-10');
  assert.equal(saved.folds[1].candidate.minor, '900719925474099900'); assert.equal(saved.folds[1].candidate.signedErrorMinor, '-30');
  assert.deepEqual(saved.origins[0].model.slopeMinorPerMonth, { numerator: '100', denominator: '1' });
  await f.reopen(); assert.deepEqual(await f.get(saved.id), saved);
});
