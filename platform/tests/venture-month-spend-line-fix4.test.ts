// Your AI's "This month" line follows the business's currency (found on Windows, 17 Nov 2026: an Indore business read
// "This month: $0.00" on Connections while Money showed its AI spend in rupees at the reference rate).
import assert from 'node:assert/strict';
import test from 'node:test';
import { monthSpendLine, type Rupees } from '../runtime/venture/money/spend.ts';

const reference: Rupees = { rate: { perUsd: '943996', setOn: '2026-11-05', source: 'FBIL reference rate' }, dateOrder: 'day-month-year', leads: true };

test('a rupee business reads its month of AI spend in rupees first, with the dollars and the rate beside', () => {
  assert.equal(monthSpendLine('0', reference, false), '₹0 ($0.00 at ₹94.40 per $1)');
  assert.equal(monthSpendLine('1000000', reference, false), '₹94.40 ($1.00 at ₹94.40 per $1)');
  assert.equal(monthSpendLine('1000000', reference, true), '₹94.40 (estimate) ($1.00 at ₹94.40 per $1)');
});

test('when dollars lead, the rupees sit beside them', () => {
  assert.equal(monthSpendLine('1000000', { ...reference, leads: false }, false), '$1.00 (₹94.40 at ₹94.40 per $1)');
});

test('with no rupee rate the line stays as the providers bill it', () => {
  assert.equal(monthSpendLine('0', null, false), '$0.00');
  assert.equal(monthSpendLine('40000', null, true), '$0.04 (estimate)');
});
