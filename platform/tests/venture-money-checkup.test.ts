// Spending check-up after bankmcp (MIT ideas), expectations independent of implementation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyCheckup, validateLedger } from '../runtime/venture/playbooks/bookkeeping-cfo/checkup.ts';

const rows = [
  { id: 'jan', payee: 'Tool', on: '2026-01-10', amountMinor: '10000', direction: 'out' as const },
  { id: 'feb', payee: 'Tool', on: '2026-02-10', amountMinor: '11000', direction: 'out' as const },
  { id: 'mar', payee: 'Tool', on: '2026-03-10', amountMinor: '12000', direction: 'out' as const },
  { id: 'dup', payee: 'Tool', on: '2026-03-12', amountMinor: '12000', direction: 'out' as const },
  { id: 'new', payee: 'New supplier', on: '2026-03-15', amountMinor: '50000', direction: 'out' as const },
];

test('subscriptions show cadence, latest cost, yearly cost and a rise; unusual items stay evidenced', () => {
  const checkup = moneyCheckup(rows, '2026-03', '40000');
  assert.equal(checkup.subscriptions[0].cadence, 'monthly');
  assert.equal(checkup.subscriptions[0].latestMinor, '12000');
  assert.equal(checkup.subscriptions[0].yearlyMinor, '144000');
  assert.equal(checkup.subscriptions[0].riseMinor, '1000');
  assert.equal(checkup.totalOutMinor, '74000');
  assert.ok(checkup.unusual.some(row => row.reason === 'duplicate' && row.rowIds.includes('dup')));
  assert.ok(checkup.unusual.some(row => row.reason === 'large' && row.rowIds.includes('new')));
  assert.ok(checkup.unusual.some(row => row.reason === 'first-payee' && row.rowIds.includes('new')));
  assert.equal(checkup.savings.length, 3);
  assert.ok(checkup.savings.every(row => row.rowIds.length));
});

test('yearly subscriptions and first newly observed subscriptions are distinguished from history', () => {
  const yearly = moneyCheckup([
    { id: 'a', payee: 'Annual', on: '2025-03-10', amountMinor: '9000', direction: 'out' },
    { id: 'b', payee: 'Annual', on: '2026-03-10', amountMinor: '9000', direction: 'out' },
  ], '2026-03', '40000');
  assert.equal(yearly.subscriptions[0].cadence, 'yearly');
  assert.equal(yearly.subscriptions[0].yearlyMinor, '9000');
  assert.equal(yearly.subscriptions[0].new, true);
});

test('duplicate imports and sign-flipped ledgers are caught during rehearsal', () => {
  assert.deepEqual(validateLedger(rows), []);
  assert.ok(validateLedger([...rows, { ...rows[0] }]).some(finding => finding.code === 'DUPLICATE_IMPORT'));
  assert.ok(validateLedger([{ ...rows[0], amountMinor: '-10000' }]).some(finding => finding.code === 'LEDGER_SIGN_FLIPPED'));
});
