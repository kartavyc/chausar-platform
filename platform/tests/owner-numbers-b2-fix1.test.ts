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
  assert.match(render(receipt('SGD 5,000', '500000', 'SGD')), /SGD 5,000\.00 in total/);
  assert.match(render(receipt('₹1,180', '118000', 'INR')), /INR 1,180\.00 in total/);
  // A receipt kept with no minor units (an exact display written at rest) is quoted as written.
  assert.match(render(receipt('INR 1,180.00', '0', 'INR')), /INR 1,180\.00 in total/);
  assert.match(render(receipt('JPY 5,000', '5000', 'JPY')), /JPY 5,000 in total/);
});

// Quality 1: a count groups as the business's country does. A US business reads "441,000 tokens", never "4,41,000".
test('model receipt usage words group by the business country: "441,000 tokens" in the US, "4,41,000" in India', async () => {
  const { usageWords } = await import('../runtime/venture/money/model-receipt.ts');
  assert.equal(usageWords({ inputTokens: 441000, outputTokens: 1200 }, 'US'), '441,000 tokens in, 1,200 out');
  assert.equal(usageWords({ inputTokens: 441000, outputTokens: 1200 }, 'IN'), '4,41,000 tokens in, 1,200 out');
  const { coverageView } = await import('../runtime/venture/delivery/coverage.ts');
  assert.equal(coverageView(120000, 150000, 'rows', 'read', undefined, 'US').line, '120,000 of 150,000 rows read');
  assert.equal(coverageView(120000, 150000, 'rows', 'read', undefined, 'IN').line, '1,20,000 of 1,50,000 rows read');
});

test("under venture/, a count names the business's country: no formatCount(..., 'IN') outside rupee amounts", async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative, sep } = await import('node:path');
  const root = join(import.meta.dirname, '../runtime/venture');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : []; });
  // Rupee amounts group the Indian way wherever the business is, as formatMoney does.
  const RUPEES: Record<string, string> = {
    'core/professions.ts': 'a rupee amount', 'core/ways.ts': 'a rupee amount', 'money/spend.ts': 'the rupee rate per dollar',
  };
  const found = walk(root).map(path => relative(root, path).split(sep).join('/')).filter(f => !Object.hasOwn(RUPEES, f))
    .filter(f => readFileSync(join(root, f), 'utf8').split('\n').some(line => /formatCount\(.*,\s*'IN'\)/.test(line)));
  assert.deepEqual(found, []);
});

// Quality 10: an unconfirmed price is a priced route, so nothing spent on it reads "$0.00 (estimate)", never "Free (estimate)".
test('a persona test on a key with an unconfirmed price never reads "Free (estimate)"', async () => {
  const { costDisplay } = await import('../runtime/venture/models/cost.ts');
  assert.equal(costDisplay('0', false), '$0.00 (estimate)');
  assert.equal(costDisplay('0', true), 'Free');
  assert.equal(costDisplay('0', true, 'template'), 'Free');
});

// Quality 12: the edges the review probed.
test('owner-format edges: "-0" is zero, a negative rupee word leads with its sign, a day that is not on the calendar stays as written', async () => {
  const { typedMoney, formatDay } = await import('../runtime/owner-format.ts');
  const { rupeeWords } = await import('../runtime/venture/core/professions.ts');
  assert.equal(typedMoney('-0', 'INR'), '₹0');
  assert.equal(typedMoney('-0.00', 'INR'), '₹0');
  assert.equal(rupeeWords('-50000'), '-₹500');
  assert.equal(formatDay('2026-02-31', 'Asia/Kolkata'), '2026-02-31');
  assert.equal(formatDay('2026-02-28', 'Asia/Kolkata'), '28 Feb 2026');
});

// Quality 9: an ISO time with no zone is not an instant (it would read in the computer's zone).
test('a time with no Z or offset is not an instant: it comes back as written', async () => {
  const { formatTime, formatDay } = await import('../runtime/owner-format.ts');
  assert.equal(formatTime('2026-11-02T19:11:00', 'Asia/Kolkata'), '2026-11-02T19:11:00');
  assert.equal(formatTime('2026-11-02T19:11:00Z', 'Asia/Kolkata'), '12:41 am');
  assert.equal(formatTime('2026-11-02T19:11:00+00:00', 'Asia/Kolkata'), '12:41 am');
  assert.equal(formatDay('2026-11-02T19:11:00', 'Asia/Kolkata'), '2026-11-02T19:11:00');
});
