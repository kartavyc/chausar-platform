import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../runtime/contracts.ts';
import { evaluateForecast } from '../runtime/forecast-evaluation.ts';
import type { ForecastRequest } from '../runtime/forecast-contracts.ts';
import { addForecastMonth, sourceForecastFixture } from './forecast-test-fixtures.ts';

// Synthetic source qualification only. All answer keys below are literal independent
// arithmetic; these tests do not establish live forecast accuracy or native execution.

test('source backtest evaluates individual one and three month horizons with exact errors and evidence pins', () => {
  const fixture = sourceForecastFixture();
  const before = structuredClone(fixture);
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.equal(result.qualification, 'source-evidence-backtest');
  assert.equal(result.mode, 'operational-as-known');
  assert.deepEqual(result.folds.map(fold => [fold.horizonMonths, fold.targetPeriod, fold.actualMinor]), [
    [1, { from: '2026-04-01', to: '2026-04-30' }, '40'],
    [3, { from: '2026-06-01', to: '2026-06-30' }, '60'],
  ]);
  assert.deepEqual(result.folds.map(fold => [fold.candidate.minor, fold.candidate.signedErrorMinor, fold.candidate.absoluteErrorMinor, fold.candidate.squaredErrorMinor]), [
    ['40', '0', '0', '0'], ['60', '0', '0', '0'],
  ]);
  assert.deepEqual(result.folds.map(fold => [fold.benchmark.minor, fold.benchmark.signedErrorMinor, fold.benchmark.absoluteErrorMinor, fold.benchmark.squaredErrorMinor]), [
    ['30', '-10', '10', '100'], ['30', '-30', '30', '900'],
  ]);
  assert.deepEqual(result.horizons.map(value => [value.horizonMonths, value.scoredOrigins, value.candidate.sumAbsoluteErrorMinor, value.benchmark.sumAbsoluteErrorMinor]), [[1, 1, '0', '10'], [3, 1, '0', '30']]);
  assert.equal(result.methods.target, 'individual-calendar-month');
  assert.equal(result.methods.rounding, 'truncate-toward-zero');
  assert.ok(result.methods.methodRevision.length > 0);
  assert.ok(result.methods.benchmarkRevision.length > 0);
  assert.deepEqual(result.uncertainty, { calibratedIntervals: false, intervalType: 'none' });
  assert.ok(result.limitations.length > 0);
  assert.equal(result.evidencePins.length, 5);
  for (const pin of result.evidencePins) {
    const entry = fixture.evidence.receipts.find(value => value.receipt.id === pin.receiptId)!;
    const { stale: _stale, staleReason: _reason, ...immutableReceipt } = entry.receipt;
    assert.equal(pin.receiptDigest, hash(immutableReceipt));
    assert.equal(pin.calculationRequestDigest, hash(entry.request));
    assert.equal(pin.factDigests.length, 1);
    const { deletedAt: _deleted, supersededAt: _superseded, ...immutableFact } = fixture.evidence.facts.find(fact => fact.id === pin.factDigests[0].factId)!;
    assert.equal(pin.factDigests[0].digest, hash(immutableFact));
    assert.equal(pin.importDigests.length, 1);
    assert.equal(pin.importDigests[0].digest, hash(fixture.evidence.imports.find(imported => imported.id === pin.importDigests[0].importId)));
  }
  assert.match(result.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(evaluateForecast(fixture.request, fixture.evidence), result, 'Source replay is deterministic.');
  assert.deepEqual(fixture, before, 'Evaluation must not mutate caller requests or trusted evidence.');
});

test('mutable historical stale and supersession flags do not alter immutable evidence pins or arithmetic', () => {
  const fixture = sourceForecastFixture();
  const result = evaluateForecast(fixture.request, fixture.evidence);
  fixture.evidence.receipts[0].receipt.stale = true;
  fixture.evidence.receipts[0].receipt.staleReason = 'Synthetic later correction notification.';
  fixture.evidence.facts[0].supersededAt = '2026-08-01T00:00:00.000Z';
  const after = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(after.evidencePins, result.evidencePins);
  assert.deepEqual(after.folds, result.folds);
  assert.deepEqual(after.coverage.staleHistoricalReceiptIds, ['training-1']);
});

test('later-known correction is excluded from an operational origin and included only in a labelled restated diagnostic', () => {
  const fixture = sourceForecastFixture();
  const original = fixture.evidence.receipts.find(value => value.receipt.id === 'training-2')!;
  const correction = addForecastMonth(fixture, { id: 'february-late-correction', month: '2026-02', amountMinor: '100',
    entityId: original.receipt.rows[0].entityId, learnedAt: '2026-04-09T00:00:00.000Z', asOf: '2026-04-10T00:00:00.000Z' });
  fixture.request.origins[0].trainingReceiptIds.push(correction.receipt.id);
  const operational = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(operational.origins[0].training.map(value => value.totalMinor), ['10', '20', '30']);
  assert.deepEqual(operational.origins[0].excludedTraining, [{ receiptId: correction.receipt.id, reason: 'after-knowledge-cut' }]);
  assert.deepEqual(operational.folds.map(value => value.candidate.minor), ['40', '60']);
  const restated = evaluateForecast({ ...fixture.request, mode: 'restated-diagnostic' }, fixture.evidence);
  assert.equal(restated.mode, 'restated-diagnostic');
  assert.match(restated.interpretation, /restat|diagnostic/i);
  assert.equal(restated.origins[0].interpretation, 'restated-diagnostic');
  assert.deepEqual(restated.origins[0].training.map(value => value.totalMinor), ['10', '100', '30']);
  assert.deepEqual(restated.folds.map(value => value.candidate.minor), ['66', '86']);
  assert.deepEqual(restated.folds.map(value => value.candidate.exactMinor), [{ numerator: '200', denominator: '3' }, { numerator: '260', denominator: '3' }]);
  assert.deepEqual(restated.origins[0].excludedTraining, [{ receiptId: original.receipt.id, reason: 'older-month-revision' }]);
});

test('latest available receipt revision wins independently of caller receipt ordering', () => {
  const fixture = sourceForecastFixture();
  const original = fixture.evidence.receipts.find(value => value.receipt.id === 'training-2')!;
  const revised = addForecastMonth(fixture, { id: 'february-known-revision', month: '2026-02', amountMinor: '22',
    entityId: original.receipt.rows[0].entityId, learnedAt: '2026-03-10T00:00:00.000Z', asOf: '2026-03-15T00:00:00.000Z' });
  fixture.request.origins[0].trainingReceiptIds = [revised.receipt.id, 'training-3', 'training-1', 'training-2'];
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(result.origins[0].training.map(value => value.receiptId), ['training-1', revised.receipt.id, 'training-3']);
  assert.deepEqual(result.origins[0].excludedTraining, [{ receiptId: original.receipt.id, reason: 'older-month-revision' }]);
  assert.equal(result.folds[0].candidate.minor, '40');
  assert.deepEqual(result.folds[0].candidate.exactMinor, { numerator: '122', denominator: '3' });
});

test('availability lag shifts training to the latest complete available month and retains actual target coordinates', () => {
  const fixture = sourceForecastFixture();
  fixture.request.origins[0].knowledgeCut = '2026-04-01T00:00:00.000Z';
  fixture.request.availabilityLagMs = 2 * 86_400_000;
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.equal(result.origins[0].effectiveTrainingKnowledgeCut, '2026-03-30T00:00:00.000Z');
  assert.deepEqual(result.origins[0].training.map(value => value.receiptId), ['training-1', 'training-2']);
  assert.deepEqual(result.folds.map(value => value.candidate.minor), ['40', '60'], 'April is two months after the last available February observation.');
  assert.deepEqual(result.folds.map(value => value.benchmark.minor), ['20', '20']);
});

test('partial target coverage cannot qualify an unscored horizon', () => {
  const fixture = sourceForecastFixture();
  fixture.request.origins[0].targets = [{ horizonMonths: 1, receiptId: 'target-april' }];
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(result.origins[0].missingHorizonsMonths, [3]);
  assert.equal(result.folds.length, 1);
  const three = result.horizons.find(value => value.horizonMonths === 3)!;
  assert.equal(three.scoredOrigins, 0);
  assert.equal(three.requestedOrigins, 1);
  assert.deepEqual(three.missingOriginIds, ['march-origin']);
  assert.equal(three.comparison, 'unscored');
  assert.equal(three.candidate.meanAbsoluteErrorMinor, null);
  assert.equal(three.benchmark.meanSquaredErrorMinor, null);
  assert.equal(result.coverage.scoredHorizons, 1);
});

test('horizon summaries aggregate their own folds across origins rather than pooling the horizons', () => {
  const fixture = sourceForecastFixture();
  const may = addForecastMonth(fixture, { id: 'target-may', month: '2026-05', amountMinor: '55' });
  fixture.request.origins.push({ id: 'april-origin', eventCutoff: '2026-04-30', knowledgeCut: '2026-05-03T00:00:00.000Z',
    trainingReceiptIds: ['training-1', 'training-2', 'training-3', 'target-april'], targets: [{ horizonMonths: 1, receiptId: may.receipt.id }] });
  const result = evaluateForecast(fixture.request, fixture.evidence);
  const one = result.horizons.find(value => value.horizonMonths === 1)!;
  const three = result.horizons.find(value => value.horizonMonths === 3)!;
  assert.equal(one.scoredOrigins, 2);
  assert.equal(one.candidate.sumAbsoluteErrorMinor, '5');
  assert.deepEqual(one.candidate.meanAbsoluteErrorMinor, { numerator: '5', denominator: '2' });
  assert.equal(one.benchmark.sumAbsoluteErrorMinor, '25');
  assert.equal(three.scoredOrigins, 1);
  assert.equal(three.benchmark.sumAbsoluteErrorMinor, '30');
  assert.deepEqual(three.missingOriginIds, ['april-origin']);
});

test('BigInt trend, predictions and squared errors remain exact above the Number safe integer limit', () => {
  const fixture = sourceForecastFixture(['900719925474099391', '900719925474099401', '900719925474099411']);
  fixture.request.horizonsMonths = [1];
  fixture.request.origins[0].targets = [{ horizonMonths: 1, receiptId: 'target-april' }];
  const target = fixture.evidence.receipts.find(value => value.receipt.id === 'target-april')!;
  target.receipt.totalMinor = '900719925474099420'; target.receipt.valueMinor = '900719925474099420';
  target.receipt.rows[0].amountMinor = '900719925474099420'; target.receipt.figures[0].minor = '900719925474099420';
  fixture.evidence.facts.find(value => value.id === target.receipt.rowIds[0])!.fields.amountMinor = '900719925474099420';
  const fold = evaluateForecast(fixture.request, fixture.evidence).folds[0];
  assert.equal(fold.candidate.minor, '900719925474099421');
  assert.deepEqual(fold.candidate.exactMinor, { numerator: '900719925474099421', denominator: '1' });
  assert.equal(fold.candidate.signedErrorMinor, '1');
  assert.equal(fold.candidate.squaredErrorMinor, '1');
  assert.equal(fold.benchmark.signedErrorMinor, '-9');
  assert.equal(fold.benchmark.squaredErrorMinor, '81');
});

test('negative fractional predictions truncate toward zero while preserving the exact rational', () => {
  const fixture = sourceForecastFixture(['0', '-1', '-1']);
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(result.folds.map(value => value.candidate.exactMinor), [{ numerator: '-5', denominator: '3' }, { numerator: '-8', denominator: '3' }]);
  assert.deepEqual(result.folds.map(value => value.candidate.minor), ['-1', '-2']);
  assert.deepEqual(result.folds.map(value => value.candidate.signedErrorMinor), ['-41', '-62']);
  assert.deepEqual(result.folds.map(value => value.candidate.squaredErrorMinor), ['1681', '3844']);
});

test('training must cover consecutive complete months and end at the latest available month', () => {
  for (const trainingReceiptIds of [['training-1', 'training-3'], ['training-1', 'training-2'], ['training-3']]) {
    const fixture = sourceForecastFixture(); fixture.request.origins[0].trainingReceiptIds = trainingReceiptIds;
    assert.throws(() => evaluateForecast(fixture.request, fixture.evidence), `Training ${trainingReceiptIds.join(',')} is not a qualified origin window.`);
  }
});

test('an unavailable named origin receipt is rejected even when another receipt could fill its month', () => {
  const fixture = sourceForecastFixture(); fixture.request.origins[0].trainingReceiptIds.push('missing-receipt');
  assert.throws(() => evaluateForecast(fixture.request, fixture.evidence));
});

test('target receipt must describe the exact future single month for its independent horizon', () => {
  const fixture = sourceForecastFixture();
  fixture.request.origins[0].targets[0].receiptId = 'target-june';
  assert.throws(() => evaluateForecast(fixture.request, fixture.evidence));
  fixture.request.origins[0].targets[0].receiptId = 'target-april';
  const target = fixture.evidence.receipts.find(value => value.receipt.id === 'target-june')!;
  target.receipt.period = { from: '2026-04-01', to: '2026-06-30' }; target.request.period = structuredClone(target.receipt.period);
  assert.throws(() => evaluateForecast(fixture.request, fixture.evidence), 'Cumulative three month totals cannot serve as month three targets.');
});

test('historically unavailable dictionary and definition/currency/scope mismatches are rejected', () => {
  const changes: ((fixture: ReturnType<typeof sourceForecastFixture>) => void)[] = [
    fixture => { fixture.evidence.dictionary.publishedAt = '2026-04-03T00:00:00.000Z'; },
    fixture => { fixture.evidence.receipts[0].receipt.dictionaryHash = 'other-dictionary'; },
    fixture => { fixture.evidence.receipts[0].receipt.definitionHash = 'other-definition'; },
    fixture => { fixture.evidence.receipts[0].receipt.currency = 'USD'; },
    fixture => { fixture.evidence.receipts[0].receipt.branch = 'other'; },
    fixture => { fixture.evidence.receipts[0].receipt.requestedSourceIds = ['other']; },
    fixture => { delete fixture.evidence.receipts[0].receipt.requestedSourceIds; },
    fixture => { fixture.evidence.receipts[0].request.customerId = 'hidden-customer'; },
    fixture => { fixture.evidence.receipts[0].request.orderId = 'hidden-order'; },
    fixture => { fixture.evidence.receipts[0].request.sourceIds = ['other']; },
    fixture => { fixture.evidence.receipts[0].receipt.definitions[0].meaning = 'A different accounting definition.'; },
  ];
  for (const change of changes) { const fixture = sourceForecastFixture(); change(fixture); assert.throws(() => evaluateForecast(fixture.request, fixture.evidence)); }
});

test('receipt gap, partial/empty/unreconciled completeness and unresolved conflicts fail closed', () => {
  const changes: ((fixture: ReturnType<typeof sourceForecastFixture>) => void)[] = [
    fixture => { fixture.evidence.receipts[0].receipt.coverage.gaps.push('Unknown source month completeness.'); },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.completeness = 'partial'; },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.completeness = 'empty'; },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.completeness = 'unreconciled-facts'; },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.unresolvedConflicts = 1; },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.countedRows = 2; },
  ];
  for (const change of changes) { const fixture = sourceForecastFixture(); change(fixture); assert.throws(() => evaluateForecast(fixture.request, fixture.evidence)); }
});

test('retained reconciliation evidence must exist and reconcile the actual receipt rows within the source scope', () => {
  const changes: ((fixture: ReturnType<typeof sourceForecastFixture>) => void)[] = [
    fixture => { fixture.evidence.imports = fixture.evidence.imports.slice(1); },
    fixture => { fixture.evidence.imports[0].coverage.reconciled = false; },
    fixture => { fixture.evidence.imports[0].rowIds = []; },
    fixture => { fixture.evidence.imports[0].sourceId = 'outside-source'; },
    fixture => { fixture.evidence.imports.push(structuredClone(fixture.evidence.imports[0])); },
    fixture => { fixture.evidence.receipts[0].receipt.coverage.importIds = []; },
  ];
  for (const change of changes) { const fixture = sourceForecastFixture(); change(fixture); assert.throws(() => evaluateForecast(fixture.request, fixture.evidence)); }
});

test('reconciliation reports are pinned so a retained report revision changes evidence without changing literal arithmetic', () => {
  const fixture = sourceForecastFixture();
  const before = evaluateForecast(fixture.request, fixture.evidence);
  fixture.evidence.imports[0].label = 'Revised synthetic retained reconciliation description.';
  const after = evaluateForecast(fixture.request, fixture.evidence);
  assert.notEqual(after.evidenceDigest, before.evidenceDigest);
  assert.notDeepEqual(after.evidencePins, before.evidencePins);
  assert.deepEqual(after.folds, before.folds);
});

test('equivalent complete calendar periods accept either property insertion order', () => {
  const fixture = sourceForecastFixture();
  for (const entry of fixture.evidence.receipts) {
    const { from, to } = entry.receipt.period!;
    entry.receipt.period = { to, from };
    entry.request.period = { to, from };
  }
  assert.deepEqual(evaluateForecast(fixture.request, fixture.evidence).folds.map(value => value.candidate.minor), ['40', '60']);
});

test('original calculation cut may be omitted or use an equivalent offset while a different provided cut is rejected', () => {
  for (const representation of ['omitted', 'equivalent-offset']) {
    const fixture = sourceForecastFixture();
    for (const entry of fixture.evidence.receipts) {
      if (representation === 'omitted') delete entry.request.asOf;
      else entry.request.asOf = new Date(Date.parse(entry.receipt.asOf) + 19_800_000).toISOString().replace('Z', '+05:30');
    }
    const result = evaluateForecast(fixture.request, fixture.evidence);
    assert.deepEqual(result.folds.map(value => value.candidate.minor), ['40', '60']);
    assert.equal(result.origins[0].training[0].asOf, '2026-02-01T00:00:00.000Z', 'The normalized receipt cut remains authoritative.');
  }
  const mismatch = sourceForecastFixture();
  mismatch.evidence.receipts[0].request.asOf = '2026-02-01T00:00:00.001Z';
  assert.throws(() => evaluateForecast(mismatch.request, mismatch.evidence));
});

test('missing or altered retained evidence and forged totals cannot be accepted from receipt claims', () => {
  const changes: ((fixture: ReturnType<typeof sourceForecastFixture>) => void)[] = [
    fixture => { fixture.evidence.facts = fixture.evidence.facts.slice(1); },
    fixture => { fixture.evidence.facts[0].deletedAt = '2026-08-01T00:00:00.000Z'; },
    fixture => { fixture.evidence.facts[0].fields.amountMinor = '999'; },
    fixture => { fixture.evidence.facts[0].fields.currency = 'USD'; },
    fixture => { fixture.evidence.facts[0].learnedAt = '2026-03-01T00:00:00.000Z'; },
    fixture => { fixture.evidence.receipts[0].receipt.rows[0].sourceRow = 3; },
    fixture => { fixture.evidence.receipts[0].receipt.rows[0].amountMinor = '999'; },
    fixture => { fixture.evidence.receipts[0].receipt.totalMinor = '999'; },
    fixture => { fixture.evidence.receipts[0].receipt.valueMinor = '999'; },
    fixture => { fixture.evidence.receipts[0].receipt.rowIds = []; },
  ];
  for (const change of changes) { const fixture = sourceForecastFixture(); change(fixture); assert.throws(() => evaluateForecast(fixture.request, fixture.evidence)); }
});

test('replay notices a later source version already known at receipt time when the receipt hides it', () => {
  const fixture = sourceForecastFixture();
  const original = fixture.evidence.facts[0];
  fixture.evidence.facts.push({ ...structuredClone(original), id: 'known-correction-hidden-from-receipt', learnedAt: '2026-01-25T00:00:00.000Z', fields: { ...original.fields, amountMinor: '99' } });
  assert.throws(() => evaluateForecast(fixture.request, fixture.evidence));
});

test('historical source precedence may resolve equivalent entity claims but a later publication cannot rescue an old receipt', () => {
  const fixture = sourceForecastFixture();
  fixture.request.sourceIds.push('other-source');
  for (const entry of fixture.evidence.receipts) { entry.receipt.requestedSourceIds!.push('other-source'); entry.request.sourceIds!.push('other-source'); }
  const original = fixture.evidence.facts[0];
  fixture.evidence.facts.push({ ...structuredClone(original), id: 'conflicting-other-source', sourceId: 'other-source', fields: { ...original.fields, amountMinor: '999' } });
  fixture.evidence.sourceRules.push({ kind: 'invoice', sourceIds: ['forecast-source', 'other-source'], at: '2026-01-01T00:00:00.000Z' });
  assert.equal(evaluateForecast(fixture.request, fixture.evidence).folds[0].candidate.minor, '40');
  fixture.evidence.sourceRules[0].at = '2026-02-02T00:00:00.000Z';
  assert.throws(() => evaluateForecast(fixture.request, fixture.evidence));
});

test('operational origin knowledge must precede target month close even when a late correction is retained', () => {
  const fixture = sourceForecastFixture();
  const original = fixture.evidence.receipts.find(value => value.receipt.id === 'training-2')!;
  const correction = addForecastMonth(fixture, { id: 'hindsight-february-correction', month: '2026-02', amountMinor: '100',
    entityId: original.receipt.rows[0].entityId, learnedAt: '2026-04-09T00:00:00.000Z', asOf: '2026-04-10T00:00:00.000Z' });
  fixture.request.origins[0].trainingReceiptIds.push(correction.receipt.id);
  for (const knowledgeCut of ['2026-05-01T00:00:00.000Z', '2026-07-02T00:00:00.000Z']) {
    fixture.request.origins[0].knowledgeCut = knowledgeCut;
    assert.throws(() => evaluateForecast(fixture.request, fixture.evidence), 'Closed target months cannot qualify as a historical operational forecast.');
  }
  const diagnostic = evaluateForecast({ ...fixture.request, mode: 'restated-diagnostic' }, fixture.evidence);
  assert.equal(diagnostic.mode, 'restated-diagnostic');
  assert.match(diagnostic.interpretation, /restat|diagnostic/i);
  assert.deepEqual(diagnostic.origins[0].training.map(value => value.totalMinor), ['10', '100', '30']);
});

test('operational origin can occur within a target month before its complete outcome is known', () => {
  const fixture = sourceForecastFixture();
  fixture.request.origins[0].knowledgeCut = '2026-04-30T23:59:59.999Z';
  const result = evaluateForecast(fixture.request, fixture.evidence);
  assert.deepEqual(result.folds.map(value => value.candidate.minor), ['40', '60']);
});

test('same-cadence sequential origins reject regressing or equal knowledge cuts', () => {
  for (const [firstCut, secondCut] of [
    ['2026-06-01T00:00:00.000Z', '2026-05-03T00:00:00.000Z'],
    ['2026-05-03T00:00:00.000Z', '2026-05-03T00:00:00.000Z'],
  ]) {
    const fixture = sourceForecastFixture();
    fixture.request.horizonsMonths = [3];
    fixture.request.origins[0].knowledgeCut = firstCut;
    fixture.request.origins[0].targets = [{ horizonMonths: 3, receiptId: 'target-june' }];
    const july = addForecastMonth(fixture, { id: 'target-july', month: '2026-07', amountMinor: '70' });
    fixture.request.origins.push({ id: 'april-origin', eventCutoff: '2026-04-30', knowledgeCut: secondCut,
      trainingReceiptIds: ['training-1', 'training-2', 'training-3', 'target-april'], targets: [{ horizonMonths: 3, receiptId: july.receipt.id }] });
    assert.throws(() => evaluateForecast(fixture.request, fixture.evidence), 'Advancing event cutoffs cannot reuse or move backward in recorded knowledge.');
  }
});

test('unrelated record-kind precedence publication does not alter forecast evidence or evaluation digests', () => {
  const fixture = sourceForecastFixture();
  const before = evaluateForecast(fixture.request, fixture.evidence);
  fixture.evidence.sourceRules.push({ kind: 'payment', sourceIds: ['forecast-source', 'unrelated-payment-source'], at: '2026-01-01T00:00:00.000Z' });
  const after = evaluateForecast(fixture.request, fixture.evidence);
  assert.equal(after.sourceRulesDigest, before.sourceRulesDigest);
  assert.equal(after.evidenceDigest, before.evidenceDigest);
  assert.equal(after.digest, before.digest);
  assert.deepEqual(after.folds, before.folds);
});

test('versioned request validation rejects malformed methods, horizons, cutoffs and undeclared fields', () => {
  const invalid: unknown[] = [
    { version: 2 }, { mode: 'operational' }, { method: 'other-method' }, { benchmark: 'other-benchmark' },
    { horizonsMonths: [] }, { horizonsMonths: [1, 1] }, { horizonsMonths: [0] }, { horizonsMonths: [1.5] },
    { cadenceMonths: 0 }, { minimumTrainingMonths: 1 }, { availabilityLagMs: -1 }, { availabilityLagMs: 0.5 },
    { sourceIds: [] }, { sourceIds: ['forecast-source', 'forecast-source'] }, { intervalConfidence: 0.95 },
  ];
  for (const value of invalid) {
    const fixture = sourceForecastFixture();
    assert.throws(() => evaluateForecast({ ...fixture.request, ...value as object } as ForecastRequest, fixture.evidence));
  }
  for (const value of [{ eventCutoff: '2026-03-30' }, { knowledgeCut: 'not-a-time' }, { knowledgeCut: '2026-04-02' }]) {
    const fixture = sourceForecastFixture(); Object.assign(fixture.request.origins[0], value);
    assert.throws(() => evaluateForecast(fixture.request, fixture.evidence));
  }
});
