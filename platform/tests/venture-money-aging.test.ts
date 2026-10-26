// Ink v2 wave 4, package 4J4 (M9, M13, M14): what clients owe on open invoices, in five buckets by days late from the
// due date on the owner's calendar (Asia/Kolkata here). Balances count tax, as the invoices do (the books' aging note).
// Each bucket has its count, its amount and its share of the total in per mille (floored in BigInt); the buckets add up
// to the total exactly, and one aging sum receipt lists every invoice with its bucket. venture.invoice.list rows say how
// late an open invoice is. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgingView, InvoiceListRow, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { issueCredit } from './venture-money-env.ts';
import { code, owner } from './venture-views-env.ts';

/**
 * Today is 23 Oct 2026 in Kolkata. Each invoice is one month at INR 19,750.00 before tax plus GST 18%: 2330500
 * (INR 23,305.00), due 15 days after issue.
 * - issued 20 Oct, due 4 Nov: not due yet.
 * - issued 1 Oct, due 16 Oct: 7 days late; INR 1,000.00 paid, so 2330500 - 100000 = 2230500 is left.
 * - issued 1 Sep, due 16 Sep: 37 days late (14 days of September after the 16th, and 23 of October).
 * - issued 1 Jul, due 16 Jul: 99 days late (15 + 31 + 30 + 23).
 * Total 2330500 x 3 + 2230500 = 9222000 (INR 92,220.00).
 */
async function owed() {
  const env = await goalBusiness();
  const notDue = await invoice(env, '1', '2026-10-20');
  const week = await invoice(env, '1', '2026-10-01');
  const month = await invoice(env, '1', '2026-09-01');
  const old = await invoice(env, '1', '2026-07-01');
  await env.money('venture.payment.record', { invoiceId: week.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  return { env, notDue, week, month, old };
}

test('aging puts each open balance in one of five buckets, with counts, amounts and per mille, and the buckets add up exactly', async () => {
  const { env, notDue, week, month, old } = await owed();
  const view = await env.money<AgingView>('venture.money.aging');
  assert.equal(view.asOf, '2026-10-23');
  assert.deepEqual(view.buckets.map(bucket => [bucket.id, bucket.label, bucket.count, bucket.countLine, bucket.amount.display]), [
    ['not-due', 'Not due yet', 1, '1 invoice', 'INR 23,305.00'],
    ['1-30', '1 to 30 days late', 1, '1 invoice', 'INR 22,305.00'],
    ['31-60', '31 to 60 days late', 1, '1 invoice', 'INR 23,305.00'],
    ['61-90', '61 to 90 days late', 0, 'None', 'INR 0.00'],
    ['over-90', 'Over 90 days late', 1, '1 invoice', 'INR 23,305.00'],
  ]);
  // 2330500 x 1000 / 9222000 = 252.7 -> 252; 2230500 x 1000 / 9222000 = 241.8 -> 241; an empty bucket is 0.
  assert.deepEqual(view.buckets.map(bucket => bucket.permille), [252, 241, 252, 0, 252]);
  assert.equal(view.total.display, 'INR 92,220.00');
  assert.equal(view.total.kind, 'calculated');
  assert.deepEqual(view.total.source, { from: 'receipt', receiptId: view.total.receiptId });
  assert.deepEqual(view.total.basis, {
    filters: ['Invoices in INR issued by 23 Oct 2026, tax included, less what was paid or credited by then', 'Days late from the due date, as of 23 Oct 2026 in Asia/Kolkata'],
    truncated: false, notCounted: null,
  });
  // Every bucket is proved by the same one receipt, which lists each invoice and its bucket.
  assert.ok(view.buckets.every(bucket => bucket.amount.receiptId === view.total.receiptId && bucket.amount.kind === 'calculated'));
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.total.receiptId });
  assert.equal(receipt.totalMinor, '9222000');
  assert.deepEqual(receipt.subject, { type: 'aging', asOf: '2026-10-23' });
  assert.deepEqual(receipt.addends.map(addend => [addend.recordId, addend.label, addend.amount]), [
    [old.invoice.id, `${old.invoice.number} for Cafe Aroma Demo, over 90 days late`, '2330500'],
    [month.invoice.id, `${month.invoice.number} for Cafe Aroma Demo, 31 to 60 days late`, '2330500'],
    [week.invoice.id, `${week.invoice.number} for Cafe Aroma Demo, 1 to 30 days late`, '2230500'],
    [notDue.invoice.id, `${notDue.invoice.number} for Cafe Aroma Demo, not due yet`, '2330500'],
  ]);
  // The buckets add up to the total exactly: 2330500 + 2230500 + 2330500 + 0 + 2330500 = 9222000.
  const byBucket = new Map<string, bigint>();
  for (const addend of receipt.addends) { const bucket = addend.label.slice(addend.label.indexOf(', ') + 2); byBucket.set(bucket, (byBucket.get(bucket) ?? 0n) + BigInt(addend.amount)); }
  assert.equal([...byBucket.values()].reduce((sum, amount) => sum + amount, 0n), BigInt(receipt.totalMinor));
  // Oldest due first, with the lateness in words.
  assert.deepEqual(view.invoices.map(row => [row.number, row.bucket, row.late?.line ?? null, row.balance.display]), [
    [old.invoice.number, 'over-90', '99 days late', 'INR 23,305.00'],
    [month.invoice.number, '31-60', '37 days late', 'INR 23,305.00'],
    [week.invoice.number, '1-30', '7 days late', 'INR 22,305.00'],
    [notDue.invoice.number, 'not-due', null, 'INR 23,305.00'],
  ]);
  assert.equal(view.line, 'INR 92,220.00 is owed on 4 open invoices as of 23 Oct 2026. 3 of them are late.');
});

test('aging as of another day moves an invoice past its due date into 1 to 30 days late; a read writes one receipt per sum', async () => {
  const { env } = await owed();
  const first = await env.money<AgingView>('venture.money.aging');
  const again = await env.money<AgingView>('venture.money.aging');
  assert.equal(again.total.receiptId, first.total.receiptId, 'the same sum opens the same receipt');
  // 5 Nov: the one due on 4 Nov is 1 day late; the one due 16 Oct is 20 days late (still 1 to 30); 16 Sep is 50; 16 Jul is 112.
  const later = await env.money<AgingView>('venture.money.aging', { asOf: '2026-11-05' });
  assert.deepEqual(later.buckets.map(bucket => bucket.count), [0, 2, 1, 0, 1]);
  assert.deepEqual(later.invoices.map(row => row.late?.days ?? null), [112, 50, 20, 1]);
  assert.equal(later.invoices[3].late?.line, '1 day late');
  assert.notEqual(later.total.receiptId, first.total.receiptId, 'another day is another receipt');
  await assert.rejects(env.money('venture.money.aging', { asOf: '23 Oct' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.money.aging', { asOf: '2026-10-23', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
});

test('a payment makes the old aging receipt read stale; nothing owed answers empty buckets and a plain line', async () => {
  const { env, old } = await owed();
  const before = await env.money<AgingView>('venture.money.aging');
  await env.money('venture.payment.record', { invoiceId: old.invoice.id, amount: '23305.00', receivedOn: '2026-10-23', method: 'upi' });
  const stale = await env.money<SumReceiptRecord>('venture.receipt.get', { id: before.total.receiptId });
  assert.equal(stale.stale, true);
  const after = await env.money<AgingView>('venture.money.aging');
  assert.equal(after.total.display, 'INR 68,915.00'); // 9222000 - 2330500 = 6891500
  assert.equal(after.buckets[4].count, 0);

  const empty = await goalBusiness();
  const none = await empty.money<AgingView>('venture.money.aging');
  assert.deepEqual(none.buckets.map(bucket => [bucket.count, bucket.permille, bucket.amount.display]), Array(5).fill([0, 0, 'INR 0.00']));
  assert.equal(none.total.display, 'INR 0.00');
  assert.deepEqual(none.invoices, []);
  assert.equal(none.line, 'Nothing is owed on open invoices.');
});

test('invoice.list rows say how late an open invoice is, on the owner\'s calendar; paid, draft and not-due rows do not', async () => {
  const { env, notDue, week, old } = await owed();
  await invoice(env, '1', '2026-10-22', true);
  const rows = await env.money<InvoiceListRow[]>('venture.invoice.list');
  const late = (id: string) => rows.find(row => row.id === id)?.late;
  assert.deepEqual(late(old.invoice.id), { days: 99, line: '99 days late' });
  assert.deepEqual(late(week.invoice.id), { days: 7, line: '7 days late' });
  assert.equal(late(notDue.invoice.id), undefined);
  assert.ok(rows.filter(row => row.status === 'draft').every(row => row.late === undefined));
});

test('aging as of an earlier day is what was owed then: later invoices left out, later payments and credit notes added back', async () => {
  const { env, notDue, week, month, old } = await owed();
  // Today (23 Oct): the old one is paid in full and the September one gets a credit note of 233050 (10%).
  await env.money('venture.payment.record', { invoiceId: old.invoice.id, amount: '23305.00', receivedOn: '2026-10-22', method: 'upi' });
  await issueCredit(env, month, '233050');
  const today = await env.money<AgingView>('venture.money.aging');
  // 2330500 (not due) + 2230500 + (2330500 - 233050 = 2097450) = 6658450; the paid one is gone.
  assert.deepEqual([today.total.display, today.invoices.map(row => row.number)], ['INR 66,584.50', [month.invoice.number, week.invoice.number, notDue.invoice.number]]);
  // As of 1 Oct: the one issued on 20 Oct did not exist; the INR 1,000.00 of 20 Oct, the payment of 22 Oct and the credit
  // note of 23 Oct had not happened. Due 16 Oct: not due; due 16 Sep: 15 days late; due 16 Jul: 15 + 31 + 30 + 1 = 77.
  const then = await env.money<AgingView>('venture.money.aging', { asOf: '2026-10-01' });
  assert.deepEqual(then.invoices.map(row => [row.number, row.bucket, row.late?.days ?? null, row.balance.display]), [
    [old.invoice.number, '61-90', 77, 'INR 23,305.00'],
    [month.invoice.number, '1-30', 15, 'INR 23,305.00'],
    [week.invoice.number, 'not-due', null, 'INR 23,305.00'],
  ]);
  assert.deepEqual(then.buckets.map(bucket => bucket.count), [1, 1, 0, 1, 0]);
  assert.equal(then.total.display, 'INR 69,915.00'); // 2330500 x 3 = 6991500
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: then.total.receiptId });
  assert.deepEqual([receipt.subject, receipt.totalMinor, receipt.stale], [{ type: 'aging', asOf: '2026-10-01' }, '6991500', false]);
  assert.equal(then.total.basis?.filters[0], 'Invoices in INR issued by 01 Oct 2026, tax included, less what was paid or credited by then');
  // A later day is not changed by the past one; asking for the future still counts what is owed now.
  assert.equal((await env.money<AgingView>('venture.money.aging', { asOf: '2026-12-01' })).total.display, 'INR 66,584.50');
});

test('a business still choosing its country gets no invoice rows and no overview lines, never a guess (NOTES 32)', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', '2026-10-01');
  await ventureAction(env.deps, owner, 'admin', 'seed.country', tx => { tx.touch({ country: null } as never); });
  assert.deepEqual(await env.money('venture.invoice.list'), []);
  assert.deepEqual(await env.money('venture.money.overview'), { lines: [] });
});

test('a business still choosing its country is refused in words, never given a guessed currency', async () => {
  const env = await goalBusiness();
  await ventureAction(env.deps, owner, 'admin', 'seed.country', tx => { tx.touch({ country: null } as never); });
  for (const [method, payload] of [['venture.money.aging', {}], ['venture.money.flow', {}], ['venture.money.cash', {}], ['venture.money.margins', { month: '2026-10' }]] as const) {
    await assert.rejects(env.money(method, payload), (error: { code?: string; message?: string }) =>
      error.code === 'INVALID_VENTURE_REQUEST' && error.message === 'Choose the country of your business first, so Chausar knows its currency.', method);
  }
});
