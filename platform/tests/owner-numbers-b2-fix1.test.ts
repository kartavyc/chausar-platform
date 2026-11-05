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

// Quality 3: a deliverable goes to the client in the exact form. A display only stands when it has the exact shape
// ("INR 1,180.00"); an owner form written with a code ("SGD 5,000") is rebuilt from the minor units.
test('a deliverable quotes the exact form: "SGD 5,000" is rebuilt as "SGD 5,000.00", an exact display stands', async () => {
  const { renderDeliverable } = await import('../runtime/venture/delivery/deliverable.ts');
  const receipt = (display: string, minor: string, currency: string) => ({ id: `r-${currency}`, figures: [{ key: 'total', label: 'Total', display, minor, currency, unit: 'money' }] });
  const draft = (id: string) => ({ title: 'Plan', sections: [{ heading: 'Price', parts: [{ kind: 'figure', receiptId: id, figureKey: 'total' }] }], questionsForClient: [] });
  const render = (r: ReturnType<typeof receipt>) => renderDeliverable(draft(r.id) as any, [r as any], { dateOrder: 'DMY' } as any);
  assert.match(render(receipt('SGD 5,000', '500000', 'SGD')), /Total: SGD 5,000\.00/);
  assert.match(render(receipt('₹1,180', '118000', 'INR')), /Total: INR 1,180\.00/);
  // A receipt kept with no minor units (an exact display written at rest) is quoted as written.
  assert.match(render(receipt('INR 1,180.00', '0', 'INR')), /Total: INR 1,180\.00/);
  assert.match(render(receipt('JPY 5,000', '5000', 'JPY')), /Total: JPY 5,000/);
});
