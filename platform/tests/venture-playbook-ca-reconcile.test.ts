// P3-ca-firm: reconciliation of AIS, 26AS and Form 16 against the books, every difference listed with its rupee
// amount, and the differences summing by code to the gap between the totals. Also the month close on a bank ledger.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBankMonth, reconcileTaxStatements, type StatementEntry } from '../runtime/venture/playbooks/ca-firm/reconcile.ts';
import { assignIds, type StatementRow } from '../runtime/venture/build/bank.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const R = (rupees: number) => String(BigInt(rupees) * 100n);

const entries: StatementEntry[] = [
  { source: 'books', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
  { source: 'books', category: 'interest', payer: 'MUMH01234C', grossMinor: R(18_000), tdsMinor: R(2_000) },
  { source: 'form16', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
  { source: '26as', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
  { source: '26as', category: 'interest', payer: 'MUMH01234C', grossMinor: R(20_000), tdsMinor: R(2_000) },
  { source: '26as', category: 'salary', payer: 'PNEB54321D', grossMinor: R(3_00_000), tdsMinor: R(10_000) },
  { source: 'ais', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
  { source: 'ais', category: 'interest', payer: 'MUMH01234C', grossMinor: R(20_000), tdsMinor: R(2_000) },
  { source: 'ais', category: 'salary', payer: 'PNEB54321D', grossMinor: R(3_00_000), tdsMinor: R(10_000) },
  { source: 'ais', category: 'dividend', payer: 'Infosys Limited', grossMinor: R(5_000), tdsMinor: '0' },
  { source: 'ais', category: 'interest', payer: 'State Bank of India ', grossMinor: R(3_500), tdsMinor: '0' },
];

test('reconcile: every difference against the books is listed with its rupee amount', () => {
  const receipt = reconcileTaxStatements({ entries });
  assert.equal(receipt.engine, 'reconcile');
  const working = receipt.working as ReturnType<typeof reconcileTaxStatements>['working'];
  const listed = working.differences.map(item => [item.against, item.kind, item.category, item.payer, item.grossDeltaMinor, item.tdsDeltaMinor]);
  assert.deepEqual(listed, [
    ['26as', 'amount-differs', 'interest', 'MUMH01234C', R(2_000), '0'],
    ['26as', 'missing-in-books', 'salary', 'PNEB54321D', R(3_00_000), R(10_000)],
    ['ais', 'missing-in-books', 'dividend', 'infosys limited', R(5_000), '0'],
    ['ais', 'amount-differs', 'interest', 'MUMH01234C', R(2_000), '0'],
    ['ais', 'missing-in-books', 'interest', 'state bank of india', R(3_500), '0'],
    ['ais', 'missing-in-books', 'salary', 'PNEB54321D', R(3_00_000), R(10_000)],
  ]);
  for (const item of working.differences) assert.match(item.id, /^diff_[a-f0-9]{12}$/);
  // Form 16 covers salary only, and it agrees with the books.
  assert.ok(!working.differences.some(item => item.against === 'form16'));
});

test('reconcile: the named differences add up, by code, to the gap between each source and the books', () => {
  const receipt = reconcileTaxStatements({ entries });
  const working = receipt.working as ReturnType<typeof reconcileTaxStatements>['working'];
  const ais = working.ties.find(tie => tie.against === 'ais' && tie.field === 'gross')!;
  assert.deepEqual([ais.sourceTotalMinor, ais.booksTotalMinor, ais.gapMinor, ais.sumOfDifferencesMinor, ais.ties], [R(15_28_500), R(12_18_000), R(3_10_500), R(3_10_500), true]);
  for (const tie of working.ties) assert.equal(tie.ties, true, `${tie.against} ${tie.field}`);
  assert.equal(receipt.figures.find(item => item.key === 'gap-ais-gross')?.minor, R(3_10_500));
  // AIS and 26AS agree on tax deducted, so no cross-check difference.
  assert.deepEqual(working.crossChecks, []);
});

test('reconcile: AIS and 26AS that disagree on tax deducted are listed too; bad input is refused', () => {
  const receipt = reconcileTaxStatements({ entries: [
    { source: 'books', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
    { source: 'ais', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(80_000) },
    { source: '26as', category: 'salary', payer: 'MUMA12345B', grossMinor: R(12_00_000), tdsMinor: R(78_000) },
  ] });
  const working = receipt.working as ReturnType<typeof reconcileTaxStatements>['working'];
  assert.deepEqual(working.crossChecks.map(item => [item.payer, item.aisTdsMinor, item.as26TdsMinor]), [['MUMA12345B', R(80_000), R(78_000)]]);
  assert.deepEqual(working.differences.map(item => [item.against, item.kind, item.tdsDeltaMinor]), [['26as', 'tds-differs', R(-2_000)]]);
  assert.throws(() => reconcileTaxStatements({ entries: [{ ...entries[0], grossMinor: '1.5' }] }), code('TAX_INPUT_INVALID'));
  assert.throws(() => reconcileTaxStatements({ entries: [{ ...entries[0], source: 'tally' as StatementEntry['source'] }] }), code('TAX_INPUT_INVALID'));
});

test('month close: opening plus every movement equals the closing balance, or the gap is listed', () => {
  const rows: StatementRow[] = [
    { date: '2026-09-05', amountMinor: R(-12_500), currency: 'INR', counterparty: 'Mehta Paper Mart', description: 'NEFT', reference: null, balanceAfterMinor: R(87_500), source: 'statement-csv' },
    { date: '2026-09-12', amountMinor: R(20_000), currency: 'INR', counterparty: null, description: 'Cash deposit', reference: null, balanceAfterMinor: R(1_07_500), source: 'statement-csv' },
  ];
  const ledger = { accountLabel: 'HDFC current', currency: 'INR', transactions: assignIds(rows) };
  const closed = closeBankMonth({ ledger, month: '2026-09', openingMinor: R(1_00_000), closingPerStatementMinor: R(1_07_500) });
  assert.equal(closed.figures.find(item => item.key === 'closing-computed')?.minor, R(1_07_500));
  assert.equal((closed.working as ReturnType<typeof closeBankMonth>['working']).ties, true);
  const short = closeBankMonth({ ledger, month: '2026-09', openingMinor: R(1_00_000), closingPerStatementMinor: R(1_10_000) });
  const working = short.working as ReturnType<typeof closeBankMonth>['working'];
  assert.equal(working.ties, false);
  assert.equal(working.gapMinor, R(2_500));
  // The same statement imported twice counts once: the ledger keys rows by the bank's fingerprint.
  assert.equal(working.transactionIds.length, 2);
});
