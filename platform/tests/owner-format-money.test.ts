import test from 'node:test';
import assert from 'node:assert/strict';
import { currencySign, formatCount, formatMoney, formatMoneyRange, HOLDS_MONEY, MONEY_TEXT, typedMoney } from '../runtime/owner-format.ts';

// One-shot B2 task 1: the owner form of an amount. The exact form (currency.ts formatMinor) is unchanged and stays for
// files, links, receipts and text code reads back.

/** The whole text is one money match, so the screens' money rule finds the amount exactly as written. */
function wholeMatch(text: string) {
  const found = [...text.matchAll(MONEY_TEXT)].map(m => m[0]);
  assert.deepEqual(found, [text], `MONEY_TEXT reads "${text}" as ${JSON.stringify(found)}`);
  assert.ok(HOLDS_MONEY.test(text), `HOLDS_MONEY misses "${text}"`);
}

test('rupees: the sign, Indian grouping, paise only when the amount has some', () => {
  for (const [minor, words] of [
    ['200000', '₹2,000'], ['200050', '₹2,000.50'], ['10000000', '₹1,00,000'], ['1234567890', '₹1,23,45,678.90'],
    ['0', '₹0'], ['-50000', '-₹500'], ['12500000', '₹1,25,000'], ['5', '₹0.05'],
  ] as const) {
    assert.equal(formatMoney(minor, 'INR'), words);
    assert.equal(formatMoney(BigInt(minor), 'INR'), words);
    wholeMatch(words);
  }
});

test('dollars and euros take their sign with western grouping; every other currency keeps its code', () => {
  for (const [minor, currency, words] of [
    ['500000', 'USD', '$5,000'], ['123', 'USD', '$1.23'], ['500000', 'EUR', '€5,000'], ['10000000', 'USD', '$100,000'],
    ['500000', 'SGD', 'SGD 5,000'], ['5000', 'JPY', 'JPY 5,000'], ['-500000', 'AED', '-AED 5,000'], ['1234', 'KWD', 'KWD 1.234'],
  ] as const) {
    assert.equal(formatMoney(minor, currency), words);
    wholeMatch(words);
  }
  assert.throws(() => formatMoney('100', 'XYZ'), { code: 'INVALID_CURRENCY' });
  assert.equal(currencySign('INR'), '₹');
  assert.equal(currencySign('USD'), '$');
  assert.equal(currencySign('EUR'), '€');
  assert.equal(currencySign('GBP'), null);
});

test('a range shows paise at both ends when either end has some', () => {
  assert.equal(formatMoneyRange('300000', '1200000', 'INR'), '₹3,000 to ₹12,000');
  assert.equal(formatMoneyRange('300050', '1200000', 'INR'), '₹3,000.50 to ₹12,000.00');
  for (const range of ['₹3,000 to ₹12,000', '₹3,000.50 to ₹12,000.00']) {
    assert.deepEqual([...range.matchAll(MONEY_TEXT)].map(m => m[0]), range.split(' to '));
  }
});

test('an amount the owner typed reads in the owner form, from its text alone', () => {
  assert.equal(typedMoney('2000', 'INR'), '₹2,000');
  assert.equal(typedMoney('2000.5', 'INR'), '₹2,000.50');
  assert.equal(typedMoney('2000.00', 'INR'), '₹2,000');
  assert.equal(typedMoney('100000', 'INR'), '₹1,00,000');
  assert.equal(typedMoney(' 0050 ', 'USD'), '$50');
  assert.equal(typedMoney('5000', 'SGD'), 'SGD 5,000');
  for (const text of ['2e3', '1,2,3', '', 'abc', '2000.505', '.5', '2000.']) assert.equal(typedMoney(text, 'INR'), null, text);
  assert.equal(typedMoney('2000', 'XYZ'), null);
  for (const words of ['₹2,000', '₹2,000.50', '₹1,00,000', '$50', 'SGD 5,000']) wholeMatch(words);
});

test('the money pattern still finds the exact form, for receipts and text code reads back', () => {
  for (const text of ['INR 2,000.00', 'USD 0.0042', 'INR -500.00', 'GBP 10.00']) wholeMatch(text);
  assert.equal(HOLDS_MONEY.test('Sent 3 drafts'), false);
});

test('counts: Indian grouping for an Indian business, western elsewhere', () => {
  assert.equal(formatCount(100000, 'IN'), '1,00,000');
  assert.equal(formatCount(100000, 'US'), '100,000');
  assert.equal(formatCount(1200, 'IN'), '1,200');
  assert.equal(formatCount(0, 'XX'), '0');
  assert.equal(formatCount(12345678, 'IN'), '1,23,45,678');
});

test('AI cost in the owner form: own plan, free, under a cent, cents, and an unconfirmed price says estimate (B2 task 6a)', async () => {
  const { formatCost, formatRate } = await import('../runtime/owner-format.ts');
  assert.equal(formatCost('0', { ownPlan: true }), 'On your own AI plan');
  assert.equal(formatCost('0', { paidCalls: false }), 'Free');
  assert.equal(formatCost('0'), 'Free');
  assert.equal(formatCost('0', { paidCalls: true }), '$0.00');
  assert.equal(formatCost('4200'), 'under $0.01');
  assert.equal(formatCost('5000'), '$0.01'); // half a cent rounds up, as the lead figures always did
  assert.equal(formatCost('421300'), '$0.42');
  assert.equal(formatCost('425000'), '$0.43');
  assert.equal(formatCost('421300', { estimate: true }), '$0.42 (estimate)');
  assert.equal(formatCost('1234567890000'), '$1,234,567.89');
  assert.equal(formatRate('1500'), '$0.0015');
  assert.equal(formatRate('3000000'), '$3.00');
  assert.equal(formatRate('3250000'), '$3.25');
  assert.equal(formatRate('120'), '$0.0001');
  for (const words of ['$0.42', '$0.0015', '$3.00', '$1,234,567.89']) assert.deepEqual([...words.matchAll(MONEY_TEXT)].map(m => m[0]), [words]);
  assert.throws(() => formatCost('-1'), { code: 'INVALID_AMOUNT' });
});

test('a typed amount may carry grouping commas the owner writes, western or Indian, but not stray ones (B2 task 8)', async () => {
  const { typedMoney } = await import('../runtime/owner-format.ts');
  assert.equal(typedMoney('26,200', 'INR'), '₹26,200');
  assert.equal(typedMoney('1,25,000', 'INR'), '₹1,25,000');
  assert.equal(typedMoney('125,000.50', 'INR'), '₹1,25,000.50');
  assert.equal(typedMoney('1,2,3', 'INR'), null);
  assert.equal(typedMoney('12,00', 'INR'), null);
});
