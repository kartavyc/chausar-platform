// Ink v2 wave 4, package 4J4 (M9, M13, M14): money in and out by month. In is cleared payments, tax included; Out is
// the books' cost facts at what left the bank (a bill payment's cost fact and its claimable GST together, a bank row's
// cost as it was) and AI spend at the owner's own rupee rate, labelled with that rate; without a rate the AI spend is
// left out and the month says so. Bill payments are already cost facts, so they count once. What was left is In less
// Out. Each figure has its own sum receipt; bars are per mille of the largest month; a month with nothing recorded is
// null, never zero. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BooksSummary, FlowView, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { bankCosts, foreignPayment, paidCall } from './venture-money-env.ts';
import { code } from './venture-views-env.ts';

/**
 * September: INV paid in full on 20 Sep, 2330500 (INR 23,305.00) in; rent of INR 1,500.00 out from the bank statement.
 * October: INR 1,000.00 in on 20 Oct; Metro Repairs' bill paid in full on 5 Oct, 602000 (INR 6,020.00) out: its cost
 * fact holds 512000 before GST and 90000 of GST the business can claim back, and both left the bank; and US$1.50 of AI.
 */
async function months() {
  const env = await goalBusiness();
  const september = await invoice(env, '1', '2026-09-01');
  await env.money('venture.payment.record', { invoiceId: september.invoice.id, amount: '23305.00', receivedOn: '2026-09-20', method: 'upi' });
  const october = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: october.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  await bankCosts(env, ['2026-09-10,OFFICE RENT,-1500.00,Landlord,50000.00']);
  const bill = await env.money<{ bill: { id: string } }>('venture.bills.add', {
    vendor: 'Metro Repairs', billDate: '2026-10-01', dueDate: '2026-10-10',
    lines: [{ description: 'Laptop repair', amountMinor: '500000', taxName: 'GST', taxRateBps: '1800' }, { description: 'Courier', amountMinor: '12000', taxName: '', taxRateBps: '0' }],
  });
  await env.money('venture.bills.pay', { billId: bill.bill.id, amountMinor: '602000', paidOn: '2026-10-05', method: 'upi' });
  await paidCall(env);
  return env;
}

test('flow: six months of in, out and what was left, the AI spend at the owner\'s rate labelled with it, each with its receipt', async () => {
  const env = await months();
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const view = await env.money<FlowView>('venture.money.flow', { months: 6 });
  assert.deepEqual(view.months.map(month => month.month), ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
  for (const empty of view.months.slice(0, 4)) {
    assert.deepEqual([empty.in, empty.out, empty.left, empty.inPermille, empty.outPermille, empty.receiptId], [null, null, null, null, null, null], empty.month);
  }
  const [september, october] = view.months.slice(4);
  // September: 2330500 in, 150000 out, 2330500 - 150000 = 2180500 left.
  assert.deepEqual([september.label, september.in?.display, september.out?.display, september.left?.display], ['Sep 2026', 'INR 23,305.00', 'INR 1,500.00', 'INR 21,805.00']);
  // October: US$1.50 at 83.50: 1500000 x 835000 = 1,252,500,000,000; + 50,000,000, / 100,000,000 = 12525 (INR 125.25).
  // Out 602000 + 12525 = 614525 (INR 6,145.25); in 100000; left 100000 - 614525 = -514525.
  assert.deepEqual([october.label, october.in?.display, october.out?.display, october.left?.display], ['Oct 2026 so far', 'INR 1,000.00', 'INR 6,145.25', 'INR -5,145.25']);
  assert.deepEqual(october.out?.uses, ['₹83.50 per $1 (your rate, set 23 Oct 2026)']);
  assert.equal(october.note, null);
  // Bars per mille of the largest, 2330500: 150000 x 1000 / 2330500 = 64.3 -> 64; 100000 -> 42.9 -> 42; 614525 -> 263.6 -> 263.
  assert.deepEqual([september.inPermille, september.outPermille, october.inPermille, october.outPermille], [1000, 64, 42, 263]);
  // Each figure is calculated, with its own receipt; the month's receiptId is the left figure's.
  for (const figure of [september.in, september.out, september.left, october.in, october.out, october.left]) {
    assert.deepEqual([figure?.kind, figure?.source], ['calculated', { from: 'receipt', receiptId: figure?.receiptId }]);
  }
  assert.equal(october.receiptId, october.left?.receiptId);
  const out = await env.money<SumReceiptRecord>('venture.receipt.get', { id: october.out!.receiptId });
  assert.deepEqual(out.subject, { type: 'flow', month: '2026-10', part: 'out' });
  assert.deepEqual(out.addends.map(addend => addend.amount), ['602000', '12525'], 'the bill once, at what left the bank, and the AI spend in rupees');
  assert.match(out.addends[1].label, /at ₹83\.50 per \$1 \(your rate, set 23 Oct 2026\)/);
  const left = await env.money<SumReceiptRecord>('venture.receipt.get', { id: october.left!.receiptId });
  assert.deepEqual([left.totalMinor, left.addends.map(addend => addend.amount)], ['-514525', ['100000', '-602000', '-12525']]);
  assert.deepEqual(view.basis.notCounted, null);
  assert.equal(view.line, 'Money in and out for the last 6 months, tax included. AI spend counts at ₹83.50 per $1 (your rate, set 23 Oct 2026).');
});

test('flow without a rupee rate leaves the AI spend out and says so on the month and in the basis', async () => {
  const env = await months();
  const view = await env.money<FlowView>('venture.money.flow', {});
  assert.equal(view.months.length, 6, 'six months unless asked');
  const october = view.months[5];
  assert.equal(october.out?.display, 'INR 6,020.00');
  assert.equal(october.out?.uses, undefined);
  assert.equal(october.note, 'AI spend not counted: no rupee rate set');
  assert.deepEqual(view.basis.notCounted, { count: 1, line: '1 not counted: 1 paid AI call with no rupee rate set' });
  assert.equal(view.line, 'Money in and out for the last 6 months, tax included. AI spend is not counted: no rupee rate set.');
});

test('flow counts a bill paid against its bank row once, and only cleared money in', async () => {
  const env = await goalBusiness();
  // The bank row of the bill's money out came first and was added as a cost; paying the bill records it against that cost.
  await bankCosts(env, ['2026-10-04,METRO REPAIRS,-6020.00,Metro Repairs,40000.00']);
  const bill = await env.money<{ bill: { id: string } }>('venture.bills.add', {
    vendor: 'Metro Repairs', billDate: '2026-10-01', dueDate: '2026-10-10', lines: [{ description: 'Laptop repair', amountMinor: '602000', taxName: '', taxRateBps: '0' }],
  });
  await env.money('venture.bills.pay', { billId: bill.bill.id, amountMinor: '602000', paidOn: '2026-10-05', method: 'upi' });
  // A cheque that has not cleared is not money in yet.
  const sale = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: sale.invoice.id, amount: '5000.00', receivedOn: '2026-10-21', method: 'cheque' });
  const october = (await env.money<FlowView>('venture.money.flow', { months: 1 })).months[0];
  assert.deepEqual([october.in, october.out?.display], [null, 'INR 6,020.00']);
  await assert.rejects(env.money('venture.money.flow', { months: 0 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.money.flow', { months: 25 }), code('INVALID_VENTURE_REQUEST'));
});

test('books.summary takes a month as its period and gives the month before with its receipts, for last month\'s comparison', async () => {
  const env = await months();
  // September: billed 1975000 (before tax), received 2330500. October: billed 1975000, received 100000.
  const october = await env.money<BooksSummary>('venture.books.summary', { period: '2026-10' });
  assert.deepEqual([october.period, october.periodKey, october.month], [{ from: '2026-10-01', to: '2026-10-31' }, 'custom', '2026-10']);
  assert.deepEqual(october.figures.map(figure => [figure.operation, figure.minor]), [['billed', '1975000'], ['received', '100000'], ['earned', '0']]);
  assert.deepEqual([october.previous?.month, october.previous?.label, october.previous?.period], ['2026-09', 'September 2026', { from: '2026-09-01', to: '2026-09-30' }]);
  assert.deepEqual(october.previous?.figures.map(figure => [figure.operation, figure.minor, figure.display]), [['billed', '1975000', 'INR 19,750.00'], ['received', '2330500', 'INR 23,305.00'], ['earned', '0', 'INR 0.00']]);
  assert.ok(october.previous?.figures.every(figure => typeof figure.receiptId === 'string' && figure.receiptId.length > 0));
  // This month is a whole month too; all time and this year are not.
  assert.equal((await env.money<BooksSummary>('venture.books.summary', { period: 'this-month' })).previous?.month, '2026-09');
  assert.equal((await env.money<BooksSummary>('venture.books.summary', { period: 'all' })).previous, null);
  assert.equal((await env.money<BooksSummary>('venture.books.summary', {})).previous, null);
  await assert.rejects(env.money('venture.books.summary', { period: '2026-13' }), code('INVALID_VENTURE_REQUEST'));
});

test('flow: each AI call in rupees at the rate of the day, half up, a held call marked estimate, a payment in another currency counted out', async () => {
  const env = await goalBusiness();
  await paidCall(env, '1500000');
  await paidCall(env, '500000');
  await paidCall(env, '300000', 'reserved');
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const sale = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: sale.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  await foreignPayment(env, '2026-10-21');
  const view = await env.money<FlowView>('venture.money.flow', { months: 1 });
  const out = view.months[0].out!;
  // One call at a time, half up: 1500000 x 835000 -> 12525; 500000 -> 4175; the held 300000 -> 250,500,000,000 + 50,000,000,
  // / 100,000,000 = 2505. 12525 + 4175 + 2505 = 19205 (INR 192.05), the same rule margins use.
  assert.deepEqual([out.display, out.estimate], ['INR 192.05', true]);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: out.receiptId });
  assert.deepEqual(receipt.addends.map(addend => addend.amount), ['12525', '4175', '2505']);
  // Each addend names its own spend record, so a receipt check and a link still find it; the rate sits beside it.
  const calls = listRecords(env.store.read(), 'venture-spend').map(record => record.id);
  assert.deepEqual(receipt.addends.map(addend => [calls.includes(addend.recordId), addend.rupeeRate]), [[true, '835000'], [true, '835000'], [true, '835000']]);
  // The spend records keep no rupee rate of their own, so the rate is today's, and the basis says so.
  assert.ok(view.basis.filters.includes('AI spend in rupees at your rate today, ₹83.50 per $1 (your rate, set 23 Oct 2026): Chausar keeps no rate for the day of each call'));
  assert.equal(receipt.estimate, true);
  assert.equal(view.months[0].in?.estimate, undefined, 'cleared money in is no estimate');
  assert.deepEqual(view.basis.notCounted, { count: 1, line: '1 not counted: 1 payment in another currency, with no rate to INR' });
  // A new rate, even one that rounds every call to the same paise (83.5001: 1500000 x 835001 -> 12525 still), makes the
  // receipt made at the old one read stale, and it still names the rate it used.
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.5001' });
  const old = await env.money<SumReceiptRecord>('venture.receipt.get', { id: out.receiptId });
  assert.equal(old.stale, true);
  assert.match(old.addends[0].label, /₹83\.50 per \$1/);
});
