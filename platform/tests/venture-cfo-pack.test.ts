// CFO sums, after cfo (MIT ideas); calculator expectations are worked examples.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cfoRatios, cfoScenarios } from '../runtime/venture/money/cfo-sums.ts';
import { questionRoute, financeFindings } from '../runtime/venture/playbooks/bookkeeping-cfo/cfo.ts';

test('ratios and cash cycle use integer calculator receipts; positive flow has no runway', () => {
  const pack = cfoRatios({ receivablesMinor: '300000', payablesMinor: '100000', revenueMinor: '900000', costsMinor: '600000', inventoryMinor: '200000', cashMinor: '1200000', netCashMinor: '-200000', days: 30 });
  assert.equal(pack.dso.value, '10');
  assert.equal(pack.dpo.value, '5');
  assert.equal(pack.cashCycle.value, '15');
  assert.equal(pack.runway?.value, '6');
  assert.ok(pack.dso.receipt.formula.includes('revenue'));
  assert.equal(cfoRatios({ receivablesMinor: '0', payablesMinor: '0', revenueMinor: '100', costsMinor: '20', inventoryMinor: '0', cashMinor: '200', netCashMinor: '80', days: 30 }).runway, null);
});

test('scenario columns state assumptions and every cell carries its own calculation evidence', () => {
  const rows = cfoScenarios({ revenueMinor: '100000', costsMinor: '60000', cashMinor: '200000', assumption: 'Owner expects the same monthly costs.' }, [{ id: 'base', revenueBps: 10000, costBps: 10000, assumption: 'Sales unchanged.' }, { id: 'downside', revenueBps: 5000, costBps: 10000, assumption: 'Sales halve.' }, { id: 'upside', revenueBps: 12000, costBps: 10000, assumption: 'Sales rise.' }]);
  assert.equal(rows[1].profit.value, '-10000');
  assert.equal(rows[1].cash.value, '190000');
  assert.equal(rows[1].runway?.value, '20');
  assert.equal(rows[0].runway, null);
  for (const row of rows) for (const cell of [row.revenue, row.profit, row.cash, row.runway].filter(Boolean)) assert.ok(cell?.receipt.inputs.length);
  assert.deepEqual(questionRoute('Can I afford a hire?'), ['business-case', 'costs', 'cash', 'scenarios', 'memo']);
  assert.deepEqual(questionRoute('Why is cash falling?'), ['cash-flow', 'working-capital', 'ageing', 'payables']);
});

test('finance checks reject unlabelled figures, investment advice and debtor contact', () => {
  assert.deepEqual(financeFindings('Calculated: cash is on receipt. The client reviews and sends reminders.'), []);
  assert.ok(financeFindings('Invest in mutual funds.').includes('spending-only'));
  assert.ok(financeFindings('Cash is ₹500.').includes('figure-labelled'));
  assert.ok(financeFindings('Send this directly to the debtor.').includes('no-debtor-contact'));
});

test('draft checks screen titles, headings and client questions as well as prose', async () => {
  const { bookkeepingChecks } = await import('../runtime/venture/playbooks/bookkeeping-cfo/cfo.ts');
  const base = { flagship: 'bookkeeping-cfo', offerKey: 'cfo-pack', servedBy: 'model' as const, request: 'A spending report.', intake: null, files: [], receipts: [], known: [], mode: 'rehearsal' as const, today: '2026-10-27', dateOrder: 'day-month-year' as const };
  for (const deliverable of [
    { title: 'Invest in mutual funds.', sections: [{ heading: 'Finance note', parts: [] }], questionsForClient: [] },
    { title: 'Finance note', sections: [{ heading: 'Cash is ₹500.', parts: [] }], questionsForClient: [] },
    { title: 'Finance note', sections: [{ heading: 'Finance note', parts: [] }], questionsForClient: ['Send this directly to the debtor.'] },
  ]) assert.ok(bookkeepingChecks({ ...base, deliverable }).some(row => row.outcome === 'fail'));
});

test('the real bookkeeping draft gate checks source ledgers even when the model skipped the calculator', async () => {
  const { bookkeepingChecks } = await import('../runtime/venture/playbooks/bookkeeping-cfo/cfo.ts');
  const { BOOKKEEPING_CFO_DEFINITION } = await import('../runtime/venture/playbooks/bookkeeping-cfo/definition.ts');
  const input = { flagship: 'bookkeeping-cfo', offerKey: 'money-checkup', servedBy: 'model', request: 'Review spending.', intake: null, receipts: [], known: [], mode: 'rehearsal', today: '2026-10-27', dateOrder: 'day-month-year', deliverable: { title: 'Finance note', sections: [{ heading: 'Finance note', parts: [{ kind: 'text', ref: '', text: 'Please review the source.' }] }], questionsForClient: [] } } as const;
  for (const practice of BOOKKEEPING_CFO_DEFINITION.practice.filter(row => row.kind !== 'pushy')) {
    const files = practice.files.map((file, index) => ({ id: `source_${index}`, name: file.name, format: 'csv' as const, bytes: file.text.length, digest: file.text, contentBase64: Buffer.from(file.text).toString('base64'), clientData: false }));
    const checks = bookkeepingChecks({ ...input, files, deliverable: structuredClone(input.deliverable) } as any);
    assert.equal(checks.some(row => row.check === 'ledger-valid' && row.outcome === 'fail'), practice.kind === 'messy');
  }
});
