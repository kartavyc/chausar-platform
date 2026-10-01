import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDescriptiveBridge, DESCRIPTIVE_BRIDGE_REVISION } from '../runtime/descriptive-bridge.ts';
import type { BridgeFactorRow, DescriptiveBridgeInput, DescriptiveBridgeResult } from '../runtime/descriptive-bridge.ts';

const row = (key: string, amountMinor: string, quantity: string | null, unit: string | null = 'each'): BridgeFactorRow => ({ key, amountMinor, quantity, unit });
const input = (baseline: BridgeFactorRow[], comparison: BridgeFactorRow[]): DescriptiveBridgeInput => ({
  baseline, comparison, quantityScale: 0, method: 'separate-interaction', factorRule: 'realized-average-net-amount-per-unit',
  rounding: 'truncate-toward-zero-minor', incompleteCoverage: 'partial',
});
function assertReconciles(result: DescriptiveBridgeResult) {
  assert.notEqual(result.status, 'refused'); assert.ok(result.contributions); assert.ok(result.residual);
  const displayed = Object.values(result.contributions).reduce((sum, amount) => sum + BigInt(amount), 0n);
  assert.equal(displayed + BigInt(result.residual.totalMinor), BigInt(result.measuredDeltaMinor));
  assert.equal(BigInt(result.residual.missingFactorMinor) + BigInt(result.residual.roundingMinor), BigInt(result.residual.totalMinor));
  for (const product of result.products) {
    const contribution = product.contributions ? Object.values(product.contributions).reduce((sum, amount) => sum + BigInt(amount), 0n) : 0n;
    assert.equal(contribution + BigInt(product.residual.totalMinor), BigInt(product.measuredDeltaMinor));
  }
}

test('literal oracle: 10 units at 10 becoming 20 at 12 separately retains interaction', () => {
  const result = computeDescriptiveBridge(input([row('widget', '100', '10')], [row('widget', '240', '20')]));
  assert.equal(result.implementationRevision, DESCRIPTIVE_BRIDGE_REVISION);
  assert.equal(result.status, 'complete'); assert.equal(result.baselineTotalMinor, '100');
  assert.equal(result.comparisonTotalMinor, '240'); assert.equal(result.measuredDeltaMinor, '140');
  assert.deepEqual(result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
  assert.deepEqual(result.residual, { missingFactorMinor: '0', roundingMinor: '0', totalMinor: '0' });
  assert.deepEqual(result.products[0].exact, {
    baselinePriceMinorPerUnit: { numerator: '10', denominator: '1' }, comparisonPriceMinorPerUnit: { numerator: '12', denominator: '1' },
    volumeMinor: { numerator: '100', denominator: '1' }, priceMinor: { numerator: '20', denominator: '1' }, interactionMinor: { numerator: '20', denominator: '1' },
  });
  assertReconciles(result);
});

test('added and removed products contribute signed scope amounts separately from common-product factors', () => {
  const result = computeDescriptiveBridge(input(
    [row('common', '100', '10'), row('removed', '30', null, null)],
    [row('common', '240', '20'), row('added', '50', null, null)],
  ));
  assert.equal(result.status, 'complete'); assert.equal(result.measuredDeltaMinor, '160');
  assert.deepEqual(result.contributions, { volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '50', scopeRemovedMinor: '-30' });
  assert.deepEqual(result.products.map(product => [product.key, product.population, product.status]), [
    ['added', 'added', 'scope'], ['common', 'common', 'decomposed'], ['removed', 'removed', 'scope'],
  ]);
  assert.equal(result.products[0].exact, null); assert.equal(result.products[2].exact, null); assertReconciles(result);
  const signed = computeDescriptiveBridge(input([row('removed', '-30', '3')], [row('added', '-50', '5')]));
  assert.equal(signed.measuredDeltaMinor, '-20'); assert.equal(signed.contributions?.scopeRemovedMinor, '30');
  assert.equal(signed.contributions?.scopeAddedMinor, '-50'); assertReconciles(signed);
});

test('negative fractional contributions truncate toward zero and retain a separate rounding residual', () => {
  const result = computeDescriptiveBridge(input([row('fractional', '5', '3')], [row('fractional', '3', '2')]));
  assert.equal(result.status, 'complete'); assert.equal(result.measuredDeltaMinor, '-2');
  assert.deepEqual(result.contributions, { volumeMinor: '-1', priceMinor: '0', interactionMinor: '0', scopeAddedMinor: '0', scopeRemovedMinor: '0' });
  assert.deepEqual(result.residual, { missingFactorMinor: '0', roundingMinor: '-1', totalMinor: '-1' });
  assert.deepEqual(result.products[0].exact, {
    baselinePriceMinorPerUnit: { numerator: '5', denominator: '3' }, comparisonPriceMinorPerUnit: { numerator: '3', denominator: '2' },
    volumeMinor: { numerator: '-5', denominator: '3' }, priceMinor: { numerator: '-1', denominator: '2' }, interactionMinor: { numerator: '1', denominator: '6' },
  });
  assertReconciles(result);
  const signed = computeDescriptiveBridge(input([row('signed', '-5', '3')], [row('signed', '-3', '2')]));
  assert.equal(signed.contributions?.volumeMinor, '1'); assert.equal(signed.residual?.roundingMinor, '1'); assertReconciles(signed);
});

test('declared scaled quantities preserve arithmetic while exact unit prices retain their scale', () => {
  const unscaled = input([row('widget', '100', '10')], [row('widget', '240', '20')]);
  const scaled = { ...input([row('widget', '100', '100000')], [row('widget', '240', '200000')]), quantityScale: 4 };
  const result = computeDescriptiveBridge(scaled);
  assert.deepEqual(result.contributions, computeDescriptiveBridge(unscaled).contributions);
  assert.deepEqual(result.products[0].exact?.baselinePriceMinorPerUnit, { numerator: '10', denominator: '1' });
  assert.deepEqual(result.products[0].exact?.comparisonPriceMinorPerUnit, { numerator: '12', denominator: '1' }); assertReconciles(result);
  const fractions = computeDescriptiveBridge({ ...input([row('fraction', '10', '125')], [row('fraction', '20', '250')]), quantityScale: 2 });
  assert.deepEqual(fractions.products[0].exact?.baselinePriceMinorPerUnit, { numerator: '8', denominator: '1' });
  assert.equal(fractions.contributions?.volumeMinor, '10'); assertReconciles(fractions);
});

test('amounts and quantities larger than Number precision retain exact totals and small changes', () => {
  const result = computeDescriptiveBridge(input(
    [row('large', '900719925474099312345678901234567890', '9007199254740993')],
    [row('large', '900719925474099312345678901234567895', '9007199254740993')],
  ));
  assert.equal(result.baselineTotalMinor, '900719925474099312345678901234567890');
  assert.equal(result.comparisonTotalMinor, '900719925474099312345678901234567895');
  assert.equal(result.measuredDeltaMinor, '5'); assert.equal(result.contributions?.priceMinor, '5');
  assert.equal(result.contributions?.volumeMinor, '0'); assert.equal(result.contributions?.interactionMinor, '0'); assertReconciles(result);
});

test('row permutations preserve canonical products, contributions, residual and coverage diagnostics', () => {
  const baseline = [row('known', '100', '10'), row('fractional', '5', '3'), row('removed', '30', '3'), row('unknown', '8', null)];
  const comparison = [row('known', '240', '20'), row('fractional', '3', '2'), row('added', '50', '5'), row('unknown', '11', '1')];
  const original = computeDescriptiveBridge({ ...input(baseline, comparison), coverageGaps: ['source:incomplete', 'branch:uncovered'] });
  const permuted = computeDescriptiveBridge({ ...input([...baseline].reverse(), [...comparison].reverse()), coverageGaps: ['branch:uncovered', 'source:incomplete'] });
  assert.deepEqual(original, permuted); assert.equal(original.status, 'partial'); assertReconciles(original);
});

test('each common product is rounded before summation and rounding is reconciled explicitly', () => {
  const result = computeDescriptiveBridge(input([row('a', '5', '3'), row('b', '5', '3')], [row('a', '3', '2'), row('b', '3', '2')]));
  assert.equal(result.measuredDeltaMinor, '-4'); assert.equal(result.contributions?.volumeMinor, '-2');
  assert.equal(result.contributions?.priceMinor, '0'); assert.equal(result.residual?.roundingMinor, '-2'); assertReconciles(result);
});

test('missing, zero and incompatible common factors remain unknown and enter missing-factor residual', () => {
  const cases: [BridgeFactorRow, BridgeFactorRow, string][] = [
    [row('unknown', '8', null), row('unknown', '11', '1'), 'baseline:unknown:missing-quantity'],
    [row('unknown', '8', '0'), row('unknown', '11', '1'), 'baseline:unknown:zero-quantity'],
    [row('unknown', '8', '1'), row('unknown', '11', null), 'comparison:unknown:missing-quantity'],
    [row('unknown', '8', '1', null), row('unknown', '11', '1'), 'baseline:unknown:missing-unit'],
    [row('unknown', '8', '1'), row('unknown', '11', '1', null), 'comparison:unknown:missing-unit'],
    [row('unknown', '8', '1', 'each'), row('unknown', '11', '1', 'kg'), 'common:unknown:unit-mismatch'],
  ];
  for (const [before, after, gap] of cases) {
    const result = computeDescriptiveBridge(input([row('known', '100', '10'), before], [row('known', '240', '20'), after]));
    assert.equal(result.status, 'partial'); assert.ok(result.gaps.includes(gap)); assert.equal(result.measuredDeltaMinor, '143');
    assert.deepEqual(result.residual, { missingFactorMinor: '3', roundingMinor: '0', totalMinor: '3' });
    const unknown = result.products.find(product => product.key === 'unknown')!;
    assert.equal(unknown.status, 'missing-factors'); assert.equal(unknown.exact, null); assert.equal(unknown.contributions, null); assertReconciles(result);
  }
});

test('missing-factor and rounding residuals remain separately visible even when they offset', () => {
  const result = computeDescriptiveBridge(input([row('fractional', '5', '3'), row('unknown', '8', null)], [row('fractional', '3', '2'), row('unknown', '9', '1')]));
  assert.deepEqual(result.residual, { missingFactorMinor: '1', roundingMinor: '-1', totalMinor: '0' });
  assert.equal(result.status, 'partial'); assert.equal(result.measuredDeltaMinor, '-1'); assertReconciles(result);
});

test('explicit coverage gaps and empty populations cannot silently produce a complete bridge', () => {
  const completeRows = input([row('known', '100', '10')], [row('known', '240', '20')]);
  const gap = computeDescriptiveBridge({ ...completeRows, coverageGaps: ['source:partial', 'source:partial'] });
  assert.equal(gap.status, 'partial'); assert.deepEqual(gap.gaps, ['source:partial']); assertReconciles(gap);
  const empty = computeDescriptiveBridge(input([], []));
  assert.equal(empty.status, 'partial'); assert.deepEqual(empty.gaps, ['baseline:empty-population', 'comparison:empty-population']); assertReconciles(empty);
  const emptyBefore = computeDescriptiveBridge(input([], [row('added', '50', '5')]));
  assert.equal(emptyBefore.status, 'partial'); assert.equal(emptyBefore.contributions?.scopeAddedMinor, '50'); assertReconciles(emptyBefore);
  const emptyAfter = computeDescriptiveBridge(input([row('removed', '30', '3')], []));
  assert.equal(emptyAfter.status, 'partial'); assert.equal(emptyAfter.contributions?.scopeRemovedMinor, '-30'); assertReconciles(emptyAfter);
});

test('refuse policy returns measured totals and gaps without a released decomposition', () => {
  for (const candidate of [
    input([row('unknown', '8', '0')], [row('unknown', '11', '1')]),
    { ...input([row('known', '100', '10')], [row('known', '240', '20')]), coverageGaps: ['source:incomplete'] },
    input([], [row('added', '50', '5')]),
  ]) {
    const result = computeDescriptiveBridge({ ...candidate, incompleteCoverage: 'refuse' });
    assert.equal(result.status, 'refused'); assert.equal(result.contributions, null); assert.equal(result.residual, null);
    assert.deepEqual(result.products, []); assert.ok(result.gaps.length > 0);
    assert.equal(BigInt(result.comparisonTotalMinor) - BigInt(result.baselineTotalMinor), BigInt(result.measuredDeltaMinor));
  }
});

test('duplicate product identities are refused rather than merged or overwritten', () => {
  assert.throws(() => computeDescriptiveBridge(input([row('same', '10', '1'), row('same', '20', '2')], [row('same', '30', '3')])), { code: 'BRIDGE_INPUT_INVALID' });
  assert.throws(() => computeDescriptiveBridge(input([row('same', '10', '1')], [row('same', '20', '2'), row('same', '30', '3')])), { code: 'BRIDGE_INPUT_INVALID' });
});

test('the kernel requires a closed explicit contract and bounds exact input sizes', () => {
  const valid = input([row('known', '100', '10')], [row('known', '240', '20')]);
  const { quantityScale: _scale, ...missingScale } = valid;
  const invalid = [
    { ...valid, method: 'ordered' }, { ...valid, factorRule: 'price-field' }, { ...valid, rounding: 'half-up' },
    { ...valid, incompleteCoverage: 'guess' }, missingScale, { ...valid, quantityScale: -1 }, { ...valid, quantityScale: 7 },
    { ...valid, quantityScale: 0.5 }, { ...valid, inferred: true },
    { ...valid, baseline: [row('', '100', '10')] }, { ...valid, baseline: [row(' key', '100', '10')] },
    { ...valid, baseline: [row('key', '1e2', '10')] }, { ...valid, baseline: [row('key', '1.5', '10')] },
    { ...valid, baseline: [row('key', '-0', '10')] }, { ...valid, baseline: [row('key', '01', '10')] },
    { ...valid, baseline: [row('key', '100', '-1')] }, { ...valid, baseline: [row('key', '100', '1.2')] },
    { ...valid, baseline: [row('key', '100', '10', '')] }, { ...valid, baseline: [{ ...row('key', '100', '10'), price: '10' }] },
    { ...valid, baseline: [row('k'.repeat(513), '100', '10')] }, { ...valid, baseline: [row('key', '1'.repeat(257), '10')] },
    { ...valid, baseline: [row('key', '100', '1'.repeat(257))] }, { ...valid, baseline: [row('key', '100', '10', 'u'.repeat(129))] },
    { ...valid, baseline: Array.from({ length: 10_001 }, (_, index) => row(`key${index}`, '100', '10')) },
    { ...valid, coverageGaps: [''] }, { ...valid, coverageGaps: ['x'.repeat(513)] },
  ];
  for (const candidate of invalid) assert.throws(() => computeDescriptiveBridge(candidate as DescriptiveBridgeInput), { code: 'BRIDGE_INPUT_INVALID' });
});

test('the pure kernel does not mutate declared rows or coverage gaps', () => {
  const declared = input([row('known', '100', '10')], [row('known', '240', '20')]);
  declared.coverageGaps = ['source:partial']; const before = structuredClone(declared);
  Object.freeze(declared.baseline[0]); Object.freeze(declared.comparison[0]);
  Object.freeze(declared.baseline); Object.freeze(declared.comparison); Object.freeze(declared.coverageGaps); Object.freeze(declared);
  computeDescriptiveBridge(declared); assert.deepEqual(declared, before);
});
