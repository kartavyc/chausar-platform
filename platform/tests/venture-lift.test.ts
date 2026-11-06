// With and without a change on paired rehearsal cases (Ink v2 wave 4, package 4J15, catalogue Q12). Code pairs the
// practice cases, counts the ones only one side passed and runs the exact McNemar test in BigInt; below the
// significance the cases can reach it says so and draws no conclusion. A model that judged the cases makes the line a
// model estimate, and every answer carries its receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Episode, SimulationRunRecord } from '../runtime/venture/contracts.ts';
import { LIFT_NOT_ENOUGH, liftOf, mcnemarExact, pairedCases, type PairedCase } from '../runtime/venture/delivery/lift.ts';
import { digest } from '../runtime/venture/records.ts';

const cases = (onlyWith: number, onlyWithout: number, both = 0, neither = 0, by: PairedCase['by'] = 'code'): PairedCase[] => [
  ...Array.from({ length: onlyWith }, (_, i) => ({ id: `w${i}`, without: false, with: true, by })),
  ...Array.from({ length: onlyWithout }, (_, i) => ({ id: `o${i}`, without: true, with: false, by })),
  ...Array.from({ length: both }, (_, i) => ({ id: `b${i}`, without: true, with: true, by })),
  ...Array.from({ length: neither }, (_, i) => ({ id: `n${i}`, without: false, with: false, by })),
];

test('mcnemarExact: the two-sided exact p as a fraction, in BigInt, capped at one', () => {
  // n = 9, k = 1: (C(9,0) + C(9,1)) = 10, p = 2 x 10 / 512.
  assert.deepEqual(mcnemarExact(8, 1), { numerator: 20n, denominator: 512n });
  assert.deepEqual(mcnemarExact(1, 8), { numerator: 20n, denominator: 512n }, 'the same either way round');
  // n = 6, all one way: p = 2 / 64.
  assert.deepEqual(mcnemarExact(6, 0), { numerator: 2n, denominator: 64n });
  // n = 7, k = 3: 1 + 7 + 21 + 35 = 64, twice that is 128 of 128, so p is one.
  assert.deepEqual(mcnemarExact(4, 3), { numerator: 1n, denominator: 1n });
  assert.deepEqual(mcnemarExact(0, 0), { numerator: 1n, denominator: 1n });
  assert.throws(() => mcnemarExact(-1, 2), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  assert.throws(() => mcnemarExact(1.5, 2), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
});

test('lift: below the significance the cases can reach, it says so and draws no conclusion', () => {
  // Five cases that all went one way: the smallest p five can give is 2 / 32, above 0.05.
  const few = liftOf(cases(5, 0, 20, 3));
  assert.equal(few.reachable, false);
  assert.equal(few.significant, false);
  assert.equal(few.line, LIFT_NOT_ENOUGH);
  assert.equal(LIFT_NOT_ENOUGH, 'Not enough practice cases to tell yet.');
  assert.equal(few.pDisplay, null, 'no p is shown when none could count');
  assert.deepEqual([few.onlyWith, few.onlyWithout, few.bothPassed, few.bothFailed, few.cases], [5, 0, 20, 3, 28]);
  assert.equal(liftOf([]).line, LIFT_NOT_ENOUGH);
});

test('lift: six cases one way is reachable and significant; a mixed split is reachable but tells nothing', () => {
  const six = liftOf(cases(6, 0));
  assert.equal(six.reachable, true);
  assert.equal(six.significant, true);
  assert.equal(six.pDisplay, '0.031');
  assert.match(six.line, /^With the change, 6 practice cases passed that failed without it, and 0 failed that passed without it \(p about 0\.031\)\./);
  const worse = liftOf(cases(1, 8));
  assert.equal(worse.significant, true);
  assert.equal(worse.direction, 'worse');
  assert.match(worse.line, /worse/);
  const mixed = liftOf(cases(4, 3, 2));
  assert.equal(mixed.reachable, true);
  assert.equal(mixed.significant, false);
  assert.equal(mixed.pDisplay, '1.000');
  assert.match(mixed.line, /no clear difference/);
});

test('lift: a model that judged the cases makes it a model estimate; the receipt holds every input and its digest', () => {
  const judged = liftOf(cases(8, 1, 0, 0, 'model'));
  assert.equal(judged.estimate, true);
  assert.match(judged.line, /Model estimate:/);
  const byCode = liftOf(cases(8, 1));
  assert.equal(byCode.estimate, false);
  assert.doesNotMatch(byCode.line, /estimate/i);
  const receipt = byCode.receipt;
  assert.equal(receipt.rule, 'Exact McNemar test, two-sided, on the paired cases where only one side passed.');
  assert.equal(receipt.inputs.length, 9);
  assert.deepEqual(receipt.result, { onlyWith: 8, onlyWithout: 1, pNumerator: '20', pDenominator: '512', alpha: '5/100', significant: true });
  const { digest: seen, ...body } = receipt;
  assert.equal(seen, digest(body), 'the digest covers everything else in the receipt');
  assert.throws(() => liftOf([{ id: 'a', without: true, with: true, by: 'code' }, { id: 'a', without: true, with: false, by: 'code' }]), (error: any) => error.code === 'INVALID_VENTURE_REQUEST', 'a case counts once');
});

function run(episodes: Partial<Episode>[]): SimulationRunRecord {
  return {
    id: 'sim', kind: 'venture-simulation-run', ventureId: 'v', memberId: 'owner', epoch: 1, at: '2026-10-26T10:00:00.000Z', playbookId: 'p', playbookHash: 'h',
    scenarioIds: [], passed: true, summary: { scenarios: 0, passed: 0, failed: 0 }, costMicros: '0', costDisplay: 'USD 0.0000',
    startedAt: '2026-10-26T10:00:00.000Z', finishedAt: '2026-10-26T10:00:00.000Z', modelMode: 'template',
    episodes: episodes.map(item => ({ scenarioId: 's', index: 0, turns: [], deliverable: null, renderedText: null, checks: [], judge: [], passed: false, ...item })) as Episode[],
  } as unknown as SimulationRunRecord;
}

test('pairedCases: rehearsal episodes are paired by practice client and episode; unpaired ones are left out; a judged one is a model case', () => {
  const without = run([{ scenarioId: 'clean', index: 0, passed: false }, { scenarioId: 'messy', index: 0, passed: true }, { scenarioId: 'gone', index: 0, passed: true }]);
  const withChange = run([
    { scenarioId: 'clean', index: 0, passed: true, judge: [{ question: 'goal-met', answer: 'yes', reason: 'ok', callId: 'c1' }] as Episode['judge'] },
    { scenarioId: 'messy', index: 0, passed: true },
  ]);
  const paired = pairedCases(without, withChange);
  assert.deepEqual(paired, [
    { id: 'clean#0', without: false, with: true, by: 'model' },
    { id: 'messy#0', without: true, with: true, by: 'code' },
  ]);
});
