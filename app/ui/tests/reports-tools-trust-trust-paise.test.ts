import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paiseToTyped, rupeesToPaise, wholeNumber } from '../src/screens/trust/paise.ts';

test('rupees become whole paise by string handling', () => {
  assert.equal(rupeesToPaise('1,234.50'), '123450');
  assert.equal(rupeesToPaise('0.5'), '50');
  assert.equal(rupeesToPaise('0.05'), '5');
  assert.equal(rupeesToPaise('0'), '0');
  assert.equal(rupeesToPaise('12'), '1200');
  assert.equal(rupeesToPaise(' ₹ 1,23,456.7 '), '12345670');
  assert.equal(rupeesToPaise('123,456'), '12345600');
  assert.equal(rupeesToPaise('999999999999999.99'), '99999999999999999');
});

test('a third decimal, a sign, an exponent and odd grouping are refused', () => {
  for (const bad of ['1.234', '-5', '-0.5', '+5', '1e3', '1E3', '1.5e2', '', '.5', '5.', '1,2,3', '12,34', '1,234,56', 'abc', '0x10', 'Infinity', 'NaN', '1 000']) {
    assert.equal(rupeesToPaise(bad), null, bad);
  }
});

test('whole numbers and typed values', () => {
  assert.equal(wholeNumber('20'), 20);
  assert.equal(wholeNumber('2.5'), null);
  assert.equal(wholeNumber('-1'), null);
  assert.equal(wholeNumber('1e3'), null);
  assert.equal(paiseToTyped('123450'), '1234.50');
  assert.equal(paiseToTyped('5'), '0.05');
  assert.equal(paiseToTyped('100000'), '1000');
});
