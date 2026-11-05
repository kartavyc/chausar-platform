// One-shot B2 fix round 1, quality 4: an amount in the owner form keeps its sign apart from its digits ("-₹500"), so the
// numbers an explanation may state are worked out from the figure's minor units, not read off its display.
import test from 'node:test';
import assert from 'node:assert/strict';
import { figureNumbers, numberGuard, type Figure } from '../runtime/calculator.ts';
import { plainMoney } from '../runtime/owner-format.ts';

test('plainMoney is the signed plain decimal of an amount, ungrouped, with every minor digit', () => {
  assert.equal(plainMoney('-50000', 'INR'), '-500.00');
  assert.equal(plainMoney('10000000', 'INR'), '100000.00');
  assert.equal(plainMoney('5', 'INR'), '0.05');
  assert.equal(plainMoney('5000', 'JPY'), '5000');
  assert.equal(plainMoney(-1234n, 'KWD'), '-1.234');
});

test('a negative figure grounds its signed number: "It fell by -500." is allowed', () => {
  const figures: Figure[] = [
    { key: 'change', label: 'Change', minor: '-50000', display: '-₹500', unit: 'money', currency: 'INR' },
    { key: 'now', label: 'Now', minor: '150000', display: '₹1,500', unit: 'money', currency: 'INR' },
  ];
  const allowedNumbers = figureNumbers(figures);
  assert.deepEqual(numberGuard('It fell by -500, to 1,500.', { allowedNumbers }), { accepted: true, checkedNumbers: 2 });
  assert.deepEqual(numberGuard('It fell by 500.', { allowedNumbers }), { accepted: true, checkedNumbers: 1 });
  assert.throws(() => numberGuard('It fell by -600.', { allowedNumbers }), { code: 'UNGROUNDED_NUMBER' });
});
