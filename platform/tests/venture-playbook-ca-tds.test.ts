// P3-ca-firm: the TDS working for common sections, from the versioned section table: thresholds by payment, by
// year and by month, the higher rate without a PAN, catch-up at the crossing payment, and the challan list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tdsWorking, type TdsPayment } from '../runtime/venture/playbooks/ca-firm/tds.ts';
import type { CaReceipt } from '../runtime/venture/playbooks/ca-firm/receipt.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const R = (rupees: number) => String(BigInt(rupees) * 100n);
const fig = (receipt: CaReceipt, key: string) => {
  const found = receipt.figures.find(item => item.key === key);
  assert.ok(found, `no figure ${key}: ${receipt.figures.map(item => item.key).join(', ')}`);
  return found.minor;
};

const payments: TdsPayment[] = [
  { id: 'c1', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2025-05-10', amountMinor: R(25_000) },
  { id: 'c2', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2025-07-12', amountMinor: R(28_000) },
  { id: 'c3', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2025-09-15', amountMinor: R(35_000) },
  { id: 'c4', payee: 'Sharma Builders', pan: 'AAAFS1234K', payeeKind: 'firm', section: '194C', date: '2025-11-20', amountMinor: R(20_000) },
  { id: 'j1', payee: 'Dr Mehta', pan: 'ABCPM1234D', payeeKind: 'individual', section: '194J-professional', date: '2025-06-01', amountMinor: R(40_000) },
  { id: 'j2', payee: 'Dr Mehta', pan: 'ABCPM1234D', payeeKind: 'individual', section: '194J-professional', date: '2025-08-01', amountMinor: R(20_000) },
  { id: 'r1', payee: 'Gupta Estates', pan: null, payeeKind: 'individual', section: '194I-building', date: '2025-04-05', amountMinor: R(60_000) },
  { id: 'h1', payee: 'Ravi Agents', pan: 'AAAPR4321K', payeeKind: 'individual', section: '194H', date: '2026-03-10', amountMinor: R(25_000) },
];

test('tds working: each payment, the threshold that applies, the rate and the amount to deduct', () => {
  const receipt = tdsWorking({ financialYear: '2025-26', payments });
  assert.equal(receipt.engine, 'tds-working');
  const working = receipt.working as ReturnType<typeof tdsWorking>['working'];
  const row = (id: string) => working.payments.find(item => item.id === id)!;
  // 194C: nothing until a single bill passes 30,000, then 2% for a firm on that bill.
  assert.deepEqual([row('c1').tdsMinor, row('c2').tdsMinor], ['0', '0']);
  assert.deepEqual([row('c3').rateBps, row('c3').tdsMinor, row('c3').deductOn], ['200', R(700), '2025-09-15']);
  // The yearly 1,00,000 is passed in November: that payment carries the catch-up on the earlier bills.
  assert.deepEqual([row('c1').deductOn, row('c2').deductOn, row('c4').deductOn], ['2025-11-20', '2025-11-20', '2025-11-20']);
  assert.equal(BigInt(row('c1').dueMinor) + BigInt(row('c2').dueMinor) + BigInt(row('c4').dueMinor), 1_460_00n);
  // 194J professional: the 50,000 year threshold is crossed in August; 10% on 60,000.
  assert.equal(BigInt(row('j1').dueMinor) + BigInt(row('j2').dueMinor), 6_000_00n);
  assert.equal(row('j1').deductOn, '2025-08-01');
  // 194I: rent above 50,000 for the month, and no PAN: the rate in the Act, the rate in force or 20%, whichever is highest.
  assert.deepEqual([row('r1').rateBps, row('r1').tdsMinor], ['2000', R(12_000)]);
  assert.match(row('r1').note, /no PAN/i);
  assert.equal(row('h1').tdsMinor, R(500));
  assert.equal(fig(receipt, 'tds-194C'), R(2_160));
  assert.equal(fig(receipt, 'tds-194J-professional'), R(6_000));
  assert.equal(fig(receipt, 'tds-194I-building'), R(12_000));
  assert.equal(fig(receipt, 'tds-194H'), R(500));
  assert.equal(fig(receipt, 'tds-total'), R(20_660));
});

test('tds working: the challan list by section and month with the deposit due date', () => {
  const receipt = tdsWorking({ financialYear: '2025-26', payments });
  const working = receipt.working as ReturnType<typeof tdsWorking>['working'];
  assert.deepEqual(working.challans.map(item => [item.section, item.month, item.depositDue, item.tdsMinor]), [
    ['194I-building', '2025-04', '2025-05-07', R(12_000)],
    ['194J-professional', '2025-08', '2025-09-07', R(6_000)],
    ['194C', '2025-09', '2025-10-07', R(700)],
    ['194C', '2025-11', '2025-12-07', R(1_460)],
    ['194H', '2026-03', '2026-04-30', R(500)],
  ]);
});

test('tds working: a PAN that does not fit the payee kind is flagged, and refusals are named', () => {
  const flagged = tdsWorking({ financialYear: '2025-26', payments: [{ ...payments[0], payeeKind: 'company' }] });
  const working = flagged.working as ReturnType<typeof tdsWorking>['working'];
  assert.equal(working.findings.length, 1);
  assert.match(working.findings[0], /fourth letter/i);
  assert.throws(() => tdsWorking({ financialYear: '2025-26', payments: [{ ...payments[0], section: '195' as TdsPayment['section'] }] }), code('NOT_MODELLED'));
  assert.throws(() => tdsWorking({ financialYear: '2025-26', payments: [{ ...payments[0], date: '2026-04-01' }] }), code('TAX_INPUT_INVALID'));
  assert.throws(() => tdsWorking({ financialYear: '2025-26', payments: [{ ...payments[0], amountMinor: '-5' }] }), code('TAX_INPUT_INVALID'));
});
