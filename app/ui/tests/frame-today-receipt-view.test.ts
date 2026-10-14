import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptViewFromEvidence } from '../src/bridge/receipt-view.ts';
import type { CalculationReceiptEvidence } from '../src/bridge/presentation.ts';
import { receiptEvidenceFixture } from './fixtures.ts';

const options = { language: 'en', timeZone: 'Asia/Kolkata' } as const;

test('receipt view keeps every amount exact and formats it with the format module', () => {
  const view = receiptViewFromEvidence(receiptEvidenceFixture(), options);
  assert.equal(view.receiptId, 'receipt_fixture');
  assert.equal(view.calculation, 'margin');
  assert.deepEqual(view.period, { from: '1 Sep 2026', to: '30 Sep 2026' });
  assert.equal(view.asKnownOn, '1 Oct 2026, 14:30');
  const contribution = view.totals.find((t) => t.key === 'contribution');
  assert.deepEqual(contribution?.figure, { kind: 'money', exact: '275', display: '₹2.75', receiptId: 'receipt_fixture', labels: [] });
  const margin = view.totals.find((t) => t.key === 'marginBps');
  assert.equal(margin?.figure.kind, 'percent');
  assert.equal(margin?.figure.kind === 'percent' ? margin.figure.display : '', '34.4%');
  assert.equal(view.totals.length, 6);
});

test('rows read are the rows counted and the rows left out, with one group per reason', () => {
  const fixture = receiptEvidenceFixture();
  const evidence: CalculationReceiptEvidence = {
    ...fixture,
    exclusions: [
      { rowId: 'a', reason: 'Outside the period.' },
      { rowId: 'b', reason: 'Cancelled.' },
      { rowId: 'c', reason: 'Outside the period.' },
    ],
    coverage: { ...fixture.coverage, countedRows: 214, excludedRows: 3 },
  };
  const view = receiptViewFromEvidence(evidence, options);
  assert.deepEqual(view.workedOut.rowsRead, { exact: '217', display: '217' });
  assert.deepEqual(view.rowsCounted, { exact: '214', display: '214' });
  assert.deepEqual(view.leftOut, [
    { reason: 'Outside the period.', rows: { exact: '2', display: '2' } },
    { reason: 'Cancelled.', rows: { exact: '1', display: '1' } },
  ]);
  assert.equal(view.workedOut.totalChecked, true);
});

test('money far beyond the float range stays exact', () => {
  const fixture = receiptEvidenceFixture();
  const huge = '123456789012345678901234567890';
  const view = receiptViewFromEvidence({ ...fixture, figures: [{ key: 'big', label: 'Big', minor: huge, display: 'x', unit: 'money', currency: 'INR' }] }, options);
  const figure = view.totals[0]?.figure;
  assert.equal(figure?.kind, 'money');
  if (figure?.kind !== 'money') return;
  assert.equal(figure.exact, huge);
  assert.equal(figure.display, '₹1,23,45,67,89,01,23,45,67,89,01,23,45,678.90');
});

test('small print carries only what the engine supplied; nothing is invented', () => {
  const view = receiptViewFromEvidence(receiptEvidenceFixture(), options);
  assert.deepEqual(view.smallPrint, { source: { names: 'source_orders, source_costs' } });
  assert.equal(view.workedOut.question, undefined);
  const none = receiptViewFromEvidence({ ...receiptEvidenceFixture(), sourceIds: [] }, options);
  assert.deepEqual(none.smallPrint, {});
  const asked = receiptViewFromEvidence(receiptEvidenceFixture(), { ...options, question: '  What did we keep?  ' });
  assert.equal(asked.workedOut.question, 'What did we keep?');
});

test('an empty or uncounted receipt shows no amount; a stale one is labelled and not checked', () => {
  const fixture = receiptEvidenceFixture();
  const empty = receiptViewFromEvidence({ ...fixture, coverage: { ...fixture.coverage, completeness: 'empty' } }, options);
  assert.ok(empty.totals.every((t) => t.figure.kind === 'missing'));
  assert.equal(empty.workedOut.totalChecked, false);
  const stale = receiptViewFromEvidence({ ...fixture, stale: true }, options);
  assert.equal(stale.statement, 'stale');
  assert.equal(stale.workedOut.totalChecked, false);
  const figure = stale.totals[0]?.figure;
  assert.deepEqual(figure?.kind === 'money' ? figure.labels : null, ['stale']);
  const noPeriod = receiptViewFromEvidence({ ...fixture, period: null }, options);
  assert.equal('period' in noPeriod, false);
});

test('another currency keeps the engine display as written and an ISO date has no time', () => {
  const fixture = receiptEvidenceFixture();
  const view = receiptViewFromEvidence({ ...fixture, asOf: '2026-09-30', figures: [{ key: 'usd', label: 'USD', minor: '1050', display: 'USD 10.50', unit: 'money', currency: 'USD' }] }, { ...options, language: 'hi' });
  const figure = view.totals[0]?.figure;
  assert.equal(figure?.kind === 'money' ? figure.display : null, 'USD 10.50');
  assert.equal(figure?.kind === 'money' ? figure.asWritten : null, 'USD');
  assert.ok(!view.asKnownOn.includes(','));
});
