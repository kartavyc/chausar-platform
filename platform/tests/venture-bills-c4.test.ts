// One-shot C4 task 22: a bill due today says so (on the owner's own day), raises one Today notice whose only action is
// Open and which leaves once it is paid, carries what it is for, and a new bill's due date defaults to the vendor's
// last terms (the days between bill date and due date on that vendor's newest bill), else 15 days after the bill date.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BillResult, BillsView, QueueList } from '../runtime/venture/contracts.ts';
import { goalBusiness } from './venture-goals-helpers.ts';
import { call } from './venture-views-env.ts';

const HOUR = 3_600_000;
const SUPPLIES = { description: 'Printer paper and ink', amountMinor: '250000', taxName: '', taxRateBps: '0' };

async function business() {
  const env = await goalBusiness(); // 2026-10-23T10:00:00Z: 15:30 on 23 Oct in Kolkata
  const add = (payload: Record<string, unknown>) => env.money<BillResult>('venture.bills.add', payload);
  const billRows = async () => (await call<QueueList>(env, 'venture.queue.list')).rows.filter(row => row.notice?.probe === 'bill');
  return { ...env, add, billRows };
}

test('due today is the owner\'s day: at 00:30 in Kolkata a bill due that day is due today, not yesterday', async () => {
  const env = await business();
  const added = await env.add({ vendor: 'Sharma Traders', lines: [SUPPLIES], billDate: '2026-10-10', dueDate: '2026-10-24' });
  assert.equal(added.bill.dueToday, false, 'due tomorrow on the owner\'s day');
  env.advance(9 * HOUR); // 2026-10-23T19:00:00Z: 00:30 on 24 Oct in Kolkata, still the 23rd in UTC
  const list = await env.money<BillsView>('venture.bills.list');
  assert.equal(list.bills[0]!.dueToday, true);
  assert.equal(list.bills[0]!.state, 'posted');
});

test('a bill due today raises one Today notice, Open only, which leaves once the bill is paid', async () => {
  const env = await business();
  assert.deepEqual(await env.billRows(), [], 'no bill, no notice');
  const added = await env.add({ vendor: 'Sharma Traders', lines: [SUPPLIES], billDate: '2026-10-09', dueDate: '2026-10-23' });
  const rows = await env.billRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.title, 'A bill to Sharma Traders is due today.');
  assert.deepEqual(rows[0]!.actions.map(action => action.id), ['open']);
  assert.equal(rows[0]!.notice?.link, '#/money/bills');
  // Still one row when asked again.
  assert.equal((await env.billRows()).length, 1);
  await env.money('venture.bills.pay', { billId: added.bill.id, amountMinor: '250000', paidOn: '2026-10-23', method: 'upi' });
  assert.deepEqual(await env.billRows(), [], 'paid: the notice leaves');
});

test('an overdue bill says when it was due; a bill due later raises nothing', async () => {
  const env = await business();
  await env.add({ vendor: 'Cloud Host', lines: [SUPPLIES], billDate: '2026-10-01', dueDate: '2026-10-20' });
  await env.add({ vendor: 'Metro Repairs', lines: [SUPPLIES], billDate: '2026-10-20', dueDate: '2026-11-04' });
  const rows = await env.billRows();
  assert.deepEqual(rows.map(row => row.title), ['A bill to Cloud Host was due on 20 Oct 2026.']);
});

test('a bill carries what it is for: its line, or its first line and how many more', async () => {
  const env = await business();
  const one = await env.add({ vendor: 'Sharma Traders', lines: [SUPPLIES], billDate: '2026-10-10', dueDate: '2026-10-30' });
  assert.equal(one.bill.purpose, 'Printer paper and ink');
  const two = await env.add({ vendor: 'Metro Repairs', lines: [SUPPLIES, { ...SUPPLIES, description: 'Courier' }], billDate: '2026-10-10', dueDate: '2026-10-30' });
  assert.equal(two.bill.purpose, 'Printer paper and ink, and 1 more');
  // A line named only for the vendor says nothing more than the vendor: no purpose.
  const same = await env.add({ vendor: 'Cloud Host', lines: [{ ...SUPPLIES, description: 'Cloud Host' }], billDate: '2026-10-10', dueDate: '2026-10-30' });
  assert.equal(same.bill.purpose, null);
});

test('with no due date, a bill takes the vendor\'s last terms, else 15 days after its bill date', async () => {
  const env = await business();
  const first = await env.add({ vendor: 'Sharma Traders', lines: [SUPPLIES], billDate: '2026-10-10' });
  assert.equal(first.bill.dueDate, '2026-10-25', 'no earlier bill from Sharma Traders: 15 days');
  await env.add({ vendor: 'Sharma Traders', lines: [SUPPLIES], billDate: '2026-10-12', dueDate: '2026-11-11' }); // 30 days
  const next = await env.add({ vendor: '  sharma   traders ', lines: [SUPPLIES], billDate: '2026-10-20' });
  assert.equal(next.bill.dueDate, '2026-11-19', 'the newest Sharma Traders bill gave 30 days');
  const list = await env.money<BillsView>('venture.bills.list');
  assert.equal(list.terms?.find(item => item.vendor.toLowerCase() === 'sharma traders')?.days, 30);
  assert.equal(list.defaultDueDays, 15);
});
