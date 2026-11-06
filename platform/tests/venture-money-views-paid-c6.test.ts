// One-shot C6 task 4 (section 9 idea 30, SCREENS 94): "Paid in full". For the month on screen, when at least one invoice
// was issued in it and none has a balance left: "All October invoices paid", with a receipt code made from the records
// that lists those invoices and their payments. An invoice whose balance is zero says paidInFull: true.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoalView, InvoiceView, MoneyOverview, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';

// PRICE in venture-goals-helpers: INR 23,305.00 a month, tax included, for the client in state 27.
const pay = (env: Awaited<ReturnType<typeof goalBusiness>>, view: InvoiceView, amount = '23305.00') =>
  env.money<InvoiceView>('venture.payment.record', { invoiceId: view.invoice.id, amount, receivedOn: '2026-10-23', method: 'upi' });
const receipt = (env: Awaited<ReturnType<typeof goalBusiness>>, id: string) =>
  listRecords(env.store.read(), 'venture-sum-receipt').find(item => item.id === id) as SumReceiptRecord;

test('two October invoices, one paid: nothing; both paid: the line, and its receipt names both invoices and their payments', async () => {
  const env = await goalBusiness();
  assert.equal((await env.money<GoalView>('venture.goals.get', {})).paidInFull, null, 'nothing invoiced, nothing paid in full');
  const first = await invoice(env, '1', null), second = await invoice(env, '1', null);
  const firstPaid = await pay(env, first);
  assert.equal(firstPaid.paidInFull, true, 'an invoice with nothing left says so');
  assert.equal((await env.money<InvoiceView>('venture.invoice.get', { invoiceId: second.invoice.id })).paidInFull, false);
  assert.equal((await env.money<GoalView>('venture.goals.get', {})).paidInFull, null, 'one still open');
  await pay(env, second, '20000.00');
  assert.equal((await env.money<GoalView>('venture.goals.get', {})).paidInFull, null, 'a part payment leaves a balance');
  await pay(env, second, '3305.00');
  const goals = await env.money<GoalView>('venture.goals.get', {});
  assert.equal(goals.paidInFull?.line, 'All October invoices paid');
  const made = receipt(env, goals.paidInFull!.receiptId);
  const labels = made.addends.map(addend => addend.label).join('\n');
  for (const number of [first.invoice.number, second.invoice.number]) assert.ok(labels.includes(`${number} total`) && labels.includes(`Less paid on ${number}`), labels);
  assert.equal(made.figures[0].minor, '0', 'nothing left to pay');
  const overview = await env.money<MoneyOverview>('venture.money.overview', {});
  assert.equal(overview.paidInFull?.line, 'All October invoices paid', 'Money\'s overview says the same for this month');
});

test("an unpaid September invoice does not change October's line, and September says nothing", async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-09-20');
  const october = await invoice(env, '1', null);
  await pay(env, october);
  assert.equal((await env.money<GoalView>('venture.goals.get', {})).paidInFull?.line, 'All October invoices paid');
  assert.equal((await env.money<GoalView>('venture.goals.get', { month: '2026-09' })).paidInFull, null);
});
