// One-shot C4 task 27 (83.x1): a money sum's receipt says its period and how it was counted, from the same dates the sum
// used, on the owner's calendar. The line is added when the receipt is served, so a signed receipt stays as it was signed.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { GoalView, MoneyOverview, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { DAY, goalBusiness, invoice } from './venture-goals-helpers.ts';
import { rangeWords, sumBasis } from '../runtime/venture/money/sums.ts';

test('the range reads short within a month, and names each month or year when it crosses one', () => {
  assert.equal(rangeWords('2026-11-01', '2026-11-30'), '1 to 30 Nov 2026');
  assert.equal(rangeWords('2026-11-05', '2026-11-05'), '5 Nov 2026');
  assert.equal(rangeWords('2026-10-01', '2026-11-30'), '1 Oct to 30 Nov 2026');
  assert.equal(rangeWords('2025-12-01', '2026-01-31'), '1 Dec 2025 to 31 Jan 2026');
});

test('the words for each sum; a sum with no counted period says nothing', () => {
  assert.equal(sumBasis({ type: 'received', from: '2026-11-01', to: '2026-11-30' }), 'Counted: payments dated 1 to 30 Nov 2026');
  assert.equal(sumBasis({ type: 'invoiced', month: '2026-11', which: 'issued' }), 'Counted: invoices issued 1 to 30 Nov 2026');
  assert.equal(sumBasis({ type: 'goal', month: '2026-02', goalId: 'g', day: null }), 'Counted: invoices issued 1 to 28 Feb 2026');
  assert.equal(sumBasis({ type: 'goal', month: '2026-11', goalId: 'g', day: '2026-11-12' }), 'Counted: invoices issued 1 to 12 Nov 2026');
  assert.equal(sumBasis({ type: 'owed', clientId: null }), 'Counted: invoices still open, tax included');
  assert.equal(sumBasis({ type: 'spent', month: '2026-11' }), null);
});

test('the November received sum names 1 to 30 Nov in the owner\'s zone, at 00:30 IST on 1 Nov, when it is still October in UTC', async () => {
  const env = await goalBusiness();
  // 2026-10-23T10:00Z now; 2026-10-31T19:00Z is 00:30 on 1 November in Kolkata.
  env.advance(8 * DAY + 9 * 3_600_000);
  const issued = await invoice(env, '1', null);
  await env.money('venture.payment.record', { invoiceId: issued.invoice.id, amount: '2000', receivedOn: '2026-11-01', method: 'upi' });
  const overview = await env.money<MoneyOverview>('venture.money.overview', {});
  const received = overview.lines.find(line => line.id === 'received')!;
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: received.receiptId });
  assert.equal(receipt.basis, 'Counted: payments dated 1 to 30 Nov 2026');
  // Owed says how it was counted too.
  const owed = await env.money<SumReceiptRecord>('venture.receipt.get', { id: overview.lines.find(line => line.id === 'owed')!.receiptId });
  assert.equal(owed.basis, 'Counted: invoices still open, tax included');
});

test('the invoiced figure on the goal opens a receipt that names the month', async () => {
  const env = await goalBusiness();
  await invoice(env, '1', null);
  const goals = await env.money<GoalView>('venture.goals.get', {});
  assert.ok(goals.invoiced.receiptId);
  const proof = await env.money<SumReceiptRecord>('venture.receipt.get', { id: goals.invoiced.receiptId });
  assert.equal(proof.basis, 'Counted: invoices issued 1 to 31 Oct 2026');
});

test('the line is served, not stored: the stored receipt and its digest stay as they were', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  await env.money('venture.payment.record', { invoiceId: issued.invoice.id, amount: '2000', receivedOn: '2026-10-20', method: 'upi' });
  const overview = await env.money<MoneyOverview>('venture.money.overview', {});
  const id = overview.lines.find(line => line.id === 'received')!.receiptId!;
  const stored = env.store.read().conversations.find(item => item.id === id) as unknown as SumReceiptRecord;
  assert.equal('basis' in stored, false);
  const served = await env.money<SumReceiptRecord>('venture.receipt.get', { id });
  assert.equal(served.digest, stored.digest);
  assert.equal(served.basis, 'Counted: payments dated 1 to 31 Oct 2026');
});
