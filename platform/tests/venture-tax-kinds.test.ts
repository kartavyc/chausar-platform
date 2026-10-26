// Ink v2 wave 4, package 4J5 (M15): Indian invoice tax kinds. Normal GST keeps the rate charged on each line; TDS the
// client deducts is recorded on the payment with its section and settles the invoice pending the certificate, without
// counting as money received; a tax-included price is split by code into the amount before tax and the tax, in BigInt,
// with the rule on the receipt; a rate change shows a banner on drafts only, and recalculating is the owner's choice. A
// business not registered for GST sees none of it: a plain invoice. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlueprintRecord, InvoiceView, OrderRecord, PriceReceiptRecord } from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { receivedPlan } from '../runtime/venture/money/sums.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { code, owner } from './venture-views-env.ts';

async function order(env: GoalEnv, payload: Record<string, unknown> = {}, clientId = env.client.id) {
  return env.money<OrderRecord>('venture.order.create', { clientId, offerId: 'offer_1', request: 'Close the month of books.', ...payload });
}
const prepare = (env: GoalEnv, orderId: string, extra: Record<string, unknown> = {}) => env.money<InvoiceView>('venture.invoice.prepare', { orderId, issueDate: '2026-10-20', ...extra });

test('normal GST: each line keeps the rate charged; a business not registered gets a plain invoice with no GST at all', async () => {
  const env = await goalBusiness();
  const draft = await prepare(env, (await order(env)).id);
  assert.deepEqual(draft.invoice.lines, [{ description: 'Monthly books', quantity: '1', unitMinor: '1975000', amountMinor: '1975000', taxRateBps: '1800' }]);
  assert.deepEqual(draft.invoice.taxLines.map(line => [line.label, line.minor]), [['CGST at 9%', '177750'], ['SGST at 9%', '177750']]);

  const plain = await goalBusiness({ taxAssumed: true });
  const view = await prepare(plain, (await order(plain, { taxInclusive: true })).id);
  // Not registered: no tax, and "tax included" changes nothing: the price is the total.
  assert.deepEqual([view.invoice.documentTitle, view.invoice.taxLines, view.invoice.totalMinor, view.invoice.lines[0].description], ['INVOICE', [], '1975000', 'Monthly books']);
  assert.equal(view.invoice.lines[0].taxRateBps, '0');
});

test('TDS the client deducts settles the invoice pending the certificate, and is never counted as money received', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', '2026-10-01');
  const id = issued.invoice.id;
  const pay = (extra: Record<string, unknown>) => env.money<InvoiceView>('venture.payment.record', { invoiceId: id, receivedOn: '2026-10-20', method: 'bank-transfer', ...extra });
  // TDS at 10% on the amount before tax: 1975000 x 1000 / 10000 = 197500 (INR 1,975.00). Cash: 2330500 - 197500 = 2133000.
  await assert.rejects(pay({ amount: '21330.01', tds: { section: '194J', amount: '1975' } }), code('PAYMENT_TOO_LARGE')); // 2133001 + 197500 > 2330500
  await assert.rejects(pay({ amount: '21330', tds: { section: '', amount: '1975' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(pay({ amount: '21330', tds: { section: '194J; drop', amount: '1975' } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(pay({ amount: '21330', tds: { section: '194J', amount: '0' } }), code('INVALID_AMOUNT'));
  await assert.rejects(pay({ amount: '21330', tds: { section: '194J' } }), code('INVALID_VENTURE_REQUEST'));
  const view = await pay({ amount: '21,330', tds: { section: '194J', amount: '1,975' } });
  assert.deepEqual([view.invoice.paidMinor, view.invoice.balanceMinor, view.invoice.status], ['2330500', '0', 'paid']);
  assert.deepEqual([view.payments[0].amountMinor, view.payments[0].tds], ['2133000', { section: '194J', amountMinor: '197500' }]);
  assert.ok(view.notes.includes('TDS INR 1,975.00 under 194J, to be shown on the client\'s TDS certificate.'));
  assert.deepEqual(view.timeline?.map(item => item.line).slice(1, 2), ['Paid INR 21,330.00 by bank transfer on 20 Oct 2026, and TDS INR 1,975.00 under 194J to be shown on the client\'s TDS certificate']);
  // Received is the cash: 2133000. The books' payment fact says the same, with the TDS beside it.
  assert.deepEqual(receivedPlan(env.store.read(), env.venture, '2026-10-20', '2026-10-20').addends.map(item => item.amount), ['2133000']);
  const fact = env.store.read().facts.find(item => item.kind === 'payment')!;
  assert.deepEqual([fact.fields.amountMinor, fact.fields.tdsMinor, fact.fields.tdsSection], ['2133000', '197500', '194J']);
  assert.equal(env.deps.services.calculator.receipt(owner, view.payments[0].booksReceiptId!).totalMinor, '2133000');
});

test('a tax-included price is split in BigInt into the amount before tax and the tax, with the rule on the receipt', async () => {
  // INR 999.00 with GST included. Before tax per unit: (99900 x 10000 x 2 + 11800) / (2 x 11800) = 84661 (84,661.52 down);
  // tax 99900 - 84661 = 15239; CGST (15239 + 1) / 2 = 7620, SGST 15239 - 7620 = 7619. The total stays 99900.
  const env = await goalBusiness({ price: '99900' });
  const made = await order(env, { taxInclusive: true });
  assert.equal(made.taxInclusive, true);
  const receipt = await env.money<PriceReceiptRecord>('venture.receipt.get', { id: made.priceReceiptId });
  assert.equal(receipt.inputs.taxInclusive, true);
  assert.deepEqual(receipt.figures.map(item => [item.key, item.minor]), [
    ['unit', '99900'], ['subtotal', '84661'], ['discount', '0'], ['taxable', '84661'], ['cgst', '7620'], ['sgst', '7619'], ['tax', '15239'], ['total', '99900'],
  ]);
  assert.equal(receipt.figures[0].label, 'Price per month, GST included');
  assert.ok(receipt.steps.some(step => step.rule === 'tax included in the price: the amount before tax per unit is the price times 10000 over 10000 plus the rate, rounded half up to the minor unit, times the quantity; the tax is the rest, so the total stays the price'));
  assert.ok(receipt.steps.some(step => step.rule === 'CGST is half the tax, rounded half up to the minor unit; SGST is the rest, so the two add up to the tax exactly'));
  assert.equal(receipt.explanation, '1 x month at INR 999.00 with GST included: INR 846.61 before tax, CGST at 9% (INR 76.20) and SGST at 9% (INR 76.19) = INR 999.00.');

  const view = await prepare(env, made.id);
  assert.deepEqual(view.invoice.lines, [{ description: 'Monthly books (price includes GST)', quantity: '1', unitMinor: '84661', amountMinor: '84661', taxRateBps: '1800' }]);
  assert.deepEqual([view.invoice.subtotalMinor, view.invoice.taxMinor, view.invoice.totalMinor], ['84661', '15239', '99900']);
  assert.deepEqual(view.invoice.taxLines.map(line => line.minor), ['7620', '7619']);

  // Two months: 84661 x 2 = 169322 before tax; 199800 - 169322 = 30478 tax; 15239 each. A client in Karnataka pays IGST: one line of 30478.
  const two = await prepare(env, (await order(env, { taxInclusive: true, quantity: '2' })).id);
  assert.deepEqual([two.invoice.lines[0].amountMinor, two.invoice.taxMinor, two.invoice.totalMinor], ['169322', '30478', '199800']);
  const karnataka = await env.money<{ id: string }>('venture.client.add', { name: 'Blr Bakes Demo', countryCode: 'IN', stateCode: '29' });
  const igst = await prepare(env, (await order(env, { taxInclusive: true, quantity: '2' }, karnataka.id)).id);
  assert.deepEqual(igst.invoice.taxLines.map(line => [line.label, line.minor]), [['IGST at 18%', '30478']]);
  await assert.rejects(order(env, { taxInclusive: 'yes' }), code('INVALID_VENTURE_REQUEST'));
});

/** Accepts a new plan version whose GST rate is `rateBps` (0: not registered), as blueprint.ts would digest it. */
async function acceptRate(env: GoalEnv, rateBps: string) {
  await ventureAction(env.deps, owner, 'admin', 'seed.rate', tx => {
    const current = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const registered = rateBps !== '0';
    const next: BlueprintRecord = {
      ...current, ...tx.base('venture-blueprint'), version: current.version + 1, status: 'accepted', digest: '',
      backOffice: { ...current.backOffice, taxRateBps: rateBps, taxRegistered: { ...current.backOffice.taxRegistered, value: registered }, taxRateBy: registered ? 'told-by-you' : 'not-registered' },
    };
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = next;
    next.digest = digest(rest);
    tx.put(next);
    tx.touch({ blueprintId: next.id, acceptedBlueprintId: next.id });
  });
}

test('a rate change shows on drafts only; a draft keeps the rate charged until you draft it again', async () => {
  const env = await goalBusiness();
  const draft = await prepare(env, (await order(env)).id);
  const issued = await invoice(env, '1', '2026-10-01');
  assert.equal(draft.rateChange, undefined);
  await acceptRate(env, '1200');
  const again = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: draft.invoice.id });
  assert.deepEqual(again.rateChange, { charged: '1800', now: '1200', line: 'GST is 12% now. This draft keeps 18%, the rate when it was drafted. Draft it again to use 12%.' });
  assert.deepEqual([again.invoice.taxRateBps, again.invoice.totalMinor], ['1800', '2330500'], 'nothing is recalculated on its own');
  assert.equal((await env.money<InvoiceView>('venture.invoice.get', { invoiceId: issued.invoice.id })).rateChange, undefined, 'an issued invoice keeps its rate');
  // The owner drafts it again: 1975000 x 1200 = 2,370,000,000; CGST and SGST (+ 10000) / 20000 = 118500 each; total 2212000.
  const redone = await prepare(env, draft.invoice.orderId);
  assert.deepEqual([redone.invoice.id, redone.invoice.taxRateBps, redone.invoice.totalMinor, redone.rateChange], [draft.invoice.id, '1200', '2212000', undefined]);

  await acceptRate(env, '0');
  assert.equal((await env.money<InvoiceView>('venture.invoice.get', { invoiceId: redone.invoice.id })).rateChange?.line,
    'This business does not charge GST now. This draft keeps 12%, the rate when it was drafted. Draft it again to leave GST off.');
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 2);
});

test('a tax-included split a minor unit off the rate: the line takes the difference when that is exact, else the receipt says why', async () => {
  // INR 100.01 with GST included, 2 months. Per unit before tax (10001 x 10000 x 2 + 11800) / 23600 = 8475; x 2 = 16950,
  // which leaves 20002 - 16950 = 3052 of tax, one more than 16950 x 18% (30,510,000 + 5000, / 10000 = 3051). The line takes
  // the paisa: 16951 before tax, 3051 of tax (16951 x 1800 = 30,511,800; + 5000, / 10000 = 3051); CGST 1526, SGST 1525.
  const env = await goalBusiness({ price: '10001' });
  const view = await prepare(env, (await order(env, { taxInclusive: true, quantity: '2' })).id);
  assert.deepEqual([view.invoice.lines[0].unitMinor, view.invoice.lines[0].amountMinor, view.invoice.subtotalMinor, view.invoice.taxMinor, view.invoice.totalMinor], ['8475', '16951', '16951', '3051', '20002']);
  assert.deepEqual(view.invoice.taxLines.map(line => line.minor), ['1526', '1525']);
  const receipt = await env.money<PriceReceiptRecord>('venture.receipt.get', { id: view.invoice.priceReceiptId });
  assert.ok(receipt.steps.some(step => step.rule === 'the per-unit rounding was 1 minor unit off; it is on the line, so the tax is the amount before tax times the rate, rounded half up'));
  // The document says it too, under the line: 2 x 8475 = 16950, not the 16951 the line shows.
  assert.match(view.documentText, / {2}2 x INR 84\.75 {2}INR 169\.51\nUnit price shown rounded; the line total is exact\.\n/);
  assert.doesNotMatch(view.documentText, /minor unit|rounded half up/, 'the client\'s document says it plainly');
  const exact = await prepare(env, (await order(env, { taxInclusive: true, quantity: '1' })).id);
  assert.doesNotMatch(exact.documentText, /Unit price shown rounded/, 'a line that multiplies exactly has no note');

  // INR 100.00 with GST included: 8475 before tax leaves 1525 of tax, while 8475 x 18% rounds to 1526; no amount before tax
  // gives exactly 10000 (8474 gives 8474 + 1525 = 9999; 8475 gives 8475 + 1526 = 10001), so the tax stays the rest, and says so.
  const flat = await goalBusiness({ price: '10000' });
  const one = await prepare(flat, (await order(flat, { taxInclusive: true })).id);
  assert.deepEqual([one.invoice.lines[0].amountMinor, one.invoice.taxMinor, one.invoice.totalMinor], ['8475', '1525', '10000']);
  const why = await flat.money<PriceReceiptRecord>('venture.receipt.get', { id: one.invoice.priceReceiptId });
  assert.ok(why.steps.some(step => step.rule === 'no amount before tax gives exactly this price at this rate, so the tax is the rest of the price: 1 minor unit off the amount before tax times the rate'));
});
