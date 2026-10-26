// Ink v2 wave 4, package 4J20 (the money views on screen asked the engine for these): amounts the owner types reach
// credit.issue and the bills methods as typed text, read in the currency they are in (as payment.record's amount is);
// and the figures the Money screens show carry their own receipts: what the late invoices owe, each bill's balance, a
// credit note's amount, how late an invoice is on invoice.get, and what issuing a draft today would bring in, by week.
// Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AcrossMoneyView, AgingView, BillResult, BillsView, CashView, CreditNoteView, InvoiceView, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { bankCosts, issueCredit, paidCall } from './venture-money-env.ts';
import { code } from './venture-views-env.ts';

/** Each invoice is INR 19,750.00 before tax plus GST 18%: 2330500 (INR 23,305.00), due 15 days after issue. Today is 23 Oct 2026. */
test('credit.issue takes the amount as typed, read in the invoice currency; never both forms, nor more places than the currency has', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', '2026-10-01');
  const base = { invoiceId: issued.invoice.id, reason: 'Two sessions were not held.', digest: issued.invoice.digest };
  // '2,330.50' is 233050 paise.
  const asked = await env.money<{ creditNote: CreditNoteView }>('venture.credit.issue', { ...base, amount: '2,330.50' });
  assert.equal(asked.creditNote.amount, 'INR 2,330.50');
  await assert.rejects(env.money('venture.credit.issue', { ...base, amount: '10', amountMinor: '1000' }), code('INVALID_AMOUNT'));
  await assert.rejects(env.money('venture.credit.issue', { ...base, amount: '10.555' }), code('INVALID_AMOUNT'));
  await assert.rejects(env.money('venture.credit.issue', base), code('INVALID_AMOUNT'));
});

test('bills.add and bills.pay take amounts and the tax rate as typed; each bill on bills.list opens the receipt of its balance', async () => {
  const env = await goalBusiness();
  // INR 5,000.00 at 18%: tax (500000 x 1800 + 5000) / 10000 = 90000; with a courier of 120.00: 500000 + 90000 + 12000 = 602000.
  const added = await env.money<BillResult>('venture.bills.add', {
    vendor: 'Metro Repairs', billDate: '2026-10-20', dueDate: '2026-10-30',
    lines: [{ description: 'Laptop repair', amount: '5,000', taxName: 'GST', taxRate: '18' }, { description: 'Courier', amount: '120.00', taxName: '', taxRate: '0' }],
  });
  assert.equal(added.bill.total, 'INR 6,020.00');
  // Paid 1,000.50 typed: 602000 - 100050 = 501950 left.
  const paid = await env.money<BillResult>('venture.bills.pay', { billId: added.bill.id, amount: '1,000.50', paidOn: '2026-10-22', method: 'upi' });
  assert.equal(paid.bill.balance, 'INR 5,019.50');
  await assert.rejects(env.money('venture.bills.pay', { billId: added.bill.id, amount: '1', amountMinor: '100', paidOn: '2026-10-22', method: 'upi' }), code('INVALID_AMOUNT'));
  await assert.rejects(env.money('venture.bills.add', { vendor: 'X', billDate: '2026-10-20', dueDate: '2026-10-30', lines: [{ description: 'Y', amount: '1', taxName: 'GST', taxRate: '101' }] }), code('INVALID_TAX_RATE'));
  const list = await env.money<BillsView>('venture.bills.list');
  const row = list.bills.find(bill => bill.id === added.bill.id)!;
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: row.receiptId! });
  assert.deepEqual(receipt.subject, { type: 'bills', due: null, billId: added.bill.id });
  // 500000 + 12000 + 90000 - 100050 = 501950, the row's balance.
  assert.deepEqual(receipt.addends.map(addend => [addend.label, addend.amount]), [['Laptop repair', '500000'], ['Courier', '12000'], ['GST on Laptop repair', '90000'], ['Paid on 22 Oct 2026', '-100050']]);
  assert.equal(receipt.totalMinor, '501950');
  assert.equal(receipt.figures[0]!.display, row.balance);
});

test('aging sends what the late invoices owe with its own receipt; invoice.get says how late, as the list row does', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-10-20');
  const late = await invoice(env, '1', '2026-10-01');
  const later = await invoice(env, '1', '2026-09-01');
  const view = await env.money<AgingView>('venture.money.aging');
  // Two late (due 16 Oct and 16 Sep): 2330500 x 2 = 4661000 (INR 46,610.00).
  assert.equal(view.late?.display, 'INR 46,610.00');
  assert.notEqual(view.late?.receiptId, view.total.receiptId);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.late!.receiptId });
  assert.deepEqual(receipt.subject, { type: 'aging', asOf: '2026-10-23', late: true });
  assert.deepEqual(receipt.addends.map(addend => addend.recordId), [later.invoice.id, late.invoice.id]);
  const got = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: late.invoice.id });
  assert.deepEqual(got.late, { days: 7, line: '7 days late' });
  // With nothing late, no late figure.
  const fresh = await goalBusiness();
  await invoice(fresh, '1', '2026-10-20');
  assert.equal((await fresh.money<AgingView>('venture.money.aging')).late, null);
});

test('a credit note opens the receipt of its amount: the balance less it while it waits, the balance with it once issued', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', '2026-10-01');
  const asked = await env.money<{ creditNote: CreditNoteView }>('venture.credit.issue', { invoiceId: issued.invoice.id, amount: '500', reason: 'Two sessions were not held.', digest: issued.invoice.digest });
  const waiting = await env.money<SumReceiptRecord>('venture.receipt.get', { id: asked.creditNote.receiptId! });
  // 2330500 now, less 50000: 2280500 after.
  assert.equal(waiting.totalMinor, '2280500');
  assert.ok(waiting.addends.some(addend => addend.amount === '-50000'));
  await issueCredit(env, issued, '100000');
  const view = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: issued.invoice.id });
  const done = view.credits!.find(note => note.state === 'issued')!;
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: done.receiptId! });
  // 2330500 - 100000 = 2230500 left; the issued note is one of its addends, and the receipt holds.
  assert.equal(receipt.totalMinor, '2230500');
  assert.ok(receipt.addends.some(addend => addend.amount === '-100000'));
  assert.equal(receipt.stale, false);
});

test('cash ahead says what issuing each draft today brings in and in which week, proved by the draft price receipt', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,100000.00']);
  const draft = await invoice(env, '1', null, true);
  const view = await env.money<CashView>('venture.money.cash');
  // Issued on 23 Oct with 15 days' terms: due 7 Nov, in the week to 13 Nov (23 Oct + 21 days); 2330500.
  assert.deepEqual(view.ifIssued.map(item => [item.invoiceId, item.client, item.due, item.week, item.amount.display, item.amount.receiptId, item.amount.projected]), [
    [draft.invoice.id, 'Cafe Aroma Demo', '2026-11-07', '2026-11-13', 'INR 23,305.00', draft.invoice.priceReceiptId, true],
  ]);
});

test('money across businesses gives the open business spend in rupees at the owner rate, with the rate in words; none without a rate', async () => {
  const env = await goalBusiness();
  await paidCall(env, '1500000');
  const before = await env.money<AcrossMoneyView>('venture.money.across');
  assert.equal(before.businesses[0]!.spendRupees, undefined);
  await env.money('venture.spend.policy.set', { inrPerUsd: '83.50' });
  const view = await env.money<AcrossMoneyView>('venture.money.across');
  // USD 1.5000 at 83.50: 1500000 micros x 83.50 = 125.25 rupees (INR 125.25 as ₹125.25).
  assert.equal(view.businesses[0]!.spendRupees, '₹125.25');
  assert.match(view.businesses[0]!.spendRate!, /^₹83\.50 per \$1 \(your rate, set /);
});
