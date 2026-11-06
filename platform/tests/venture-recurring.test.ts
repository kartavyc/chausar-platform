// Ink v2 wave 4, package 4J5 (M12): recurring invoices and reminders. A schedule drafts each due date's invoice as a
// Today row the owner issues, never issued by itself; missed days are caught up on the engine's sweep. A reminder is a
// draft the owner sends from their own app (4E2 hands it off); one is due on the days the owner picks, 3, 10 and 30 days
// late unless a schedule says otherwise. Every invoice has one next action by its state and a short timeline.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  BlueprintRecord, InvoiceView, OutreachRecord, OutreachView, QueueList, RecurringInvoiceView, RecurringInvoicesView, SumReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { runMoneySchedules } from '../runtime/venture/money/recurring.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { DAY, goalBusiness, invoice } from './venture-goals-helpers.ts';
import { call, code, owner, phone } from './venture-views-env.ts';

// The business: 23 October 2026, 15:30 in Kolkata. INR 19,750.00 a month before tax; with CGST and SGST at 9% each
// (177750 each) a month is 2330500 (INR 23,305.00).

async function business(options: { price?: string | null } = {}) {
  const env = await goalBusiness(options);
  const schedule = (payload: Record<string, unknown>, ctx: Context = owner) =>
    env.money<{ recurring: RecurringInvoiceView }>('venture.invoice.recurring', { clientId: env.client.id, offerId: 'offer_1', frequency: 'monthly', ...payload }, ctx);
  const remind = (invoiceId: string, ctx: Context = owner) => env.money<{ draft: OutreachView; receiptId?: string }>('venture.invoice.remind', { invoiceId }, ctx);
  const get = (invoiceId: string) => env.money<InvoiceView>('venture.invoice.get', { invoiceId });
  const drafts = () => listRecords(env.store.read(), 'venture-invoice').filter(item => item.status === 'draft');
  return { ...env, schedule, remind, get, drafts };
}

test('venture.invoice.recurring sets one schedule per client and offer, inside the app, and refuses what it cannot keep', async () => {
  const env = await business();
  const set = await env.schedule({ startOn: '2026-11-01' });
  assert.deepEqual([set.recurring.frequency, set.recurring.startOn, set.recurring.end, set.recurring.nextOn, set.recurring.clientId, set.recurring.offerId],
    ['monthly', '2026-11-01', null, '2026-11-01', env.client.id, 'offer_1']);
  assert.equal(set.recurring.line, 'Monthly books for Cafe Aroma Demo, every month from 01 Nov 2026. Next draft on 01 Nov 2026, for you to check and issue.');
  assert.equal(env.drafts().length, 0, 'nothing is drafted before its day');
  for (const [payload, expected] of [
    [{ startOn: '2026-11-01', clientId: 'client_missing' }, 'CLIENT_NOT_FOUND'],
    [{ startOn: '2026-11-01', offerId: 'offer_9' }, 'OFFER_NOT_FOUND'],
    [{ startOn: '2026-11-01', offerId: 'offer_2' }, 'PRICE_REQUIRED'],
    [{ startOn: '2026-10-22' }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', end: '2026-10-31' }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', frequency: 'weekly' }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', reminderDays: [0] }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', reminderDays: [10, 3] }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', reminderDays: [3, 3] }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', reminderDays: [3, 400] }, 'INVALID_VENTURE_REQUEST'],
    [{ startOn: '2026-11-01', taxInclusive: 'yes' }, 'INVALID_VENTURE_REQUEST'],
  ] as const) await assert.rejects(env.schedule(payload), code(expected), JSON.stringify(payload));
  await assert.rejects(env.schedule({ startOn: '2026-11-01' }, phone), code('APP_APPROVAL_REQUIRED'));

  // The same client and offer again changes that schedule; it never makes a second one.
  const changed = await env.schedule({ startOn: '2026-11-05', frequency: 'quarterly', end: '2027-11-05', reminderDays: [5, 20] });
  assert.equal(changed.recurring.id, set.recurring.id);
  assert.deepEqual([changed.recurring.frequency, changed.recurring.nextOn, changed.recurring.end], ['quarterly', '2026-11-05', '2027-11-05']);
  assert.equal(changed.recurring.line, 'Monthly books for Cafe Aroma Demo, every 3 months from 05 Nov 2026 until 05 Nov 2027, 3 months each. Next draft on 05 Nov 2026, for you to check and issue.');
  const list = await env.money<RecurringInvoicesView>('venture.invoice.recurringList');
  assert.deepEqual(list.items.map(item => item.id), [set.recurring.id]);
  assert.deepEqual(listRecords(env.store.read(), 'venture-recurring-invoice')[0].reminderDays, [5, 20]);
});

test('each due date makes a draft invoice on Today, never issued by itself, and only once', async () => {
  const env = await business();
  const set = await env.schedule({ startOn: '2026-11-01' });
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 });
  env.advance(9 * DAY); // 1 November, 15:30 in Kolkata
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 1, bills: 0 });
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 }, 'never twice');
  const [draft] = env.drafts();
  assert.deepEqual([draft.status, draft.number, draft.issueDate, draft.dueDate, draft.totalMinor], ['draft', null, '2026-11-01', '2026-11-16', '2330500']);
  const order = listRecords(env.store.read(), 'venture-order').find(item => item.id === draft.orderId)!;
  assert.deepEqual([order.clientId, order.offerId, order.quantity, order.request], [env.client.id, 'offer_1', '1', 'From your monthly schedule: Monthly books, dated 01 Nov 2026.']);
  const record = listRecords(env.store.read(), 'venture-recurring-invoice').find(item => item.id === set.recurring.id)!;
  assert.equal(record.nextOn, '2026-12-01');
  assert.deepEqual(record.made, [{ on: '2026-11-01', orderId: order.id, invoiceId: draft.id }]);
  const row = (await call<QueueList>(env, 'venture.queue.list')).rows.find(item => item.kind === 'invoice')!;
  assert.equal(row.title, 'Invoice for Cafe Aroma Demo');
  assert.deepEqual(row.actions.map(item => [item.id, item.secondAsk ?? false]), [['read', false], ['issue', true]]);
  assert.equal(listRecords(env.store.read(), 'venture-invoice').filter(item => item.status !== 'draft').length, 0);
});

test('missed days are caught up, each draft dated its own day; a schedule keeps its day of the month and stops at its end', async () => {
  const env = await business();
  await env.schedule({ startOn: '2026-10-31' });
  env.advance(74 * DAY); // 5 January 2027
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 3, bills: 0 });
  assert.deepEqual(env.drafts().map(item => item.issueDate), ['2026-10-31', '2026-11-30', '2026-12-31']);
  assert.equal(listRecords(env.store.read(), 'venture-recurring-invoice')[0].nextOn, '2027-01-31');

  // Quarterly, ending on 30 April: 31 Oct, 31 Jan, then 30 April (April has 30 days), then no more.
  const quarterly = await business();
  const set = await quarterly.schedule({ startOn: '2026-10-31', frequency: 'quarterly', end: '2027-04-30' });
  quarterly.advance(400 * DAY);
  assert.deepEqual(await runMoneySchedules(quarterly.deps, owner), { invoices: 3, bills: 0 });
  // A monthly offer billed every 3 months is 3 months each: 5925000 before tax; CGST and SGST (5925000 x 1800 + 10000) / 20000
  // = 533250 each; total 5925000 + 1066500 = 6991500.
  assert.deepEqual(quarterly.drafts().map(item => [item.issueDate, item.totalMinor]), [['2026-10-31', '6991500'], ['2027-01-31', '6991500'], ['2027-04-30', '6991500']]);
  const record = listRecords(quarterly.store.read(), 'venture-recurring-invoice').find(item => item.id === set.recurring.id)!;
  assert.equal(record.nextOn, null);
  assert.equal((await quarterly.money<RecurringInvoicesView>('venture.invoice.recurringList')).items[0].line,
    'Monthly books for Cafe Aroma Demo, every 3 months from 31 Oct 2026 until 30 Apr 2027, 3 months each. Finished: 3 drafted.');
});

/** Accepts a new plan version whose first offer has `price` (null: no price), as blueprint.ts would digest it. */
async function priceOffer(env: Awaited<ReturnType<typeof business>>, price: string | null) {
  await ventureAction(env.deps, owner, 'admin', 'seed.price', tx => {
    const current = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const next: BlueprintRecord = {
      ...current, ...tx.base('venture-blueprint'), version: current.version + 1, status: 'accepted', digest: '',
      offers: current.offers.map(offer => offer.id === 'offer_1'
        ? { ...offer, pricing: { ...offer.pricing, unitPriceMinor: price, unitPriceLabel: price === null ? 'not-set' : 'told-by-you' } } : offer),
    };
    const { id: _id, at: _at, digest: _digest, status: _status, ...rest } = next;
    next.digest = digest(rest);
    tx.put(next);
    tx.touch({ blueprintId: next.id, acceptedBlueprintId: next.id });
  });
}

test('a schedule that cannot draft says why on its line and is tried again on the next sweep, never skipped', async () => {
  const env = await business();
  await env.schedule({ startOn: '2026-11-01' });
  await priceOffer(env, null);
  env.advance(9 * DAY); // 1 November
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 });
  const [item] = (await env.money<RecurringInvoicesView>('venture.invoice.recurringList')).items;
  assert.equal(item.nextOn, '2026-11-01');
  assert.equal(item.line, 'Monthly books for Cafe Aroma Demo, every month from 01 Nov 2026. The draft for 01 Nov 2026 cannot be made yet: Set your price for Monthly books first.');
  await priceOffer(env, '1975000');
  env.advance(DAY);
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 1, bills: 0 });
  assert.deepEqual(env.drafts().map(draft => draft.issueDate), ['2026-11-01'], 'dated its own day, not the day it could be made');
});

test('a schedule that starts today drafts today\'s at once; the engine\'s sweep drafts the rest', async () => {
  const env = await business();
  await env.schedule({ startOn: '2026-10-23' });
  assert.deepEqual(env.drafts().map(item => item.issueDate), ['2026-10-23']);
  env.advance(9 * DAY); // 1 November: nothing yet, the next is 23 November
  await sweepWholeJournal(env.deps, owner);
  assert.equal(env.drafts().length, 1);
  env.advance(22 * DAY); // 23 November
  await sweepWholeJournal(env.deps, owner);
  assert.deepEqual(env.drafts().map(item => item.issueDate), ['2026-10-23', '2026-11-23']);
});

test('venture.invoice.remind drafts a reminder for you to send yourself; nothing is sent', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01'); // INV-0001, due 16 October: 7 days late on 23 October
  assert.deepEqual((await env.get(issued.invoice.id)).next, { action: 'remind', line: '7 days late. Draft a reminder.' });
  await assert.rejects(env.remind(issued.invoice.id, phone), code('APP_APPROVAL_REQUIRED'));
  const { draft, receiptId } = await env.remind(issued.invoice.id);
  assert.deepEqual([draft.kind, draft.channel, draft.to, draft.subject, draft.footer, draft.sent, draft.opportunityId, draft.blurb, draft.counter],
    ['reminder', 'email', 'owner@aroma.example', 'Payment reminder: INV-0001', null, null, null, null, null]);
  assert.equal(draft.text, [
    'Hello Cafe Aroma Demo,',
    '',
    'This is a reminder that invoice INV-0001, dated 01 Oct 2026, was due on 16 Oct 2026. INR 23,305.00 is still to pay.',
    '',
    'If you have already paid, thank you, and please ignore this note.',
    '',
    'Ledger Cafe Books',
  ].join('\n'));
  const record = listRecords(env.store.read(), 'venture-outreach')[0] as OutreachRecord;
  assert.deepEqual([record.outreachKind, record.invoiceId, record.by, record.basis, record.sent, record.digest], ['reminder', issued.invoice.id, 'owner', 'existing-contact', null, draft.digest]);
  // The amount in it has its receipt: the invoice's total less what was paid and credited, here nothing.
  assert.equal((await env.money<SumReceiptRecord>('venture.receipt.get', { id: receiptId! })).totalMinor, '2330500');
  assert.deepEqual((await env.get(issued.invoice.id)).next, { action: 'remind', line: '7 days late. Your reminder is drafted: open it and send it yourself.', draftId: draft.id });

  // The owner taps "I sent it" (4E2 records it): the invoice waits again.
  await ventureAction(env.deps, owner, 'admin', 'seed.sent', tx => {
    const stored = tx.find('venture-outreach', draft.id)!;
    tx.replace({ ...stored, sent: { at: tx.now, channel: 'own-mailbox', recordedAt: tx.now, recordedBy: 'owner' } });
  });
  assert.deepEqual((await env.get(issued.invoice.id)).next, { action: 'wait', line: '7 days late. You sent a reminder on 23 Oct 2026.' });
  env.advance(3 * DAY); // 26 October: 10 days late, the second reminder day
  assert.deepEqual((await env.get(issued.invoice.id)).next, { action: 'remind', line: '10 days late. Draft a reminder.' });
});

test('a reminder before the due day says when it is due; drafts, paid invoices and waiting cheques are not reminded', async () => {
  const env = await business();
  const soon = await invoice(env, '1', '2026-10-20'); // due 4 November
  const { draft } = await env.remind(soon.invoice.id);
  assert.match(draft.text, /This is a reminder that invoice INV-0001, dated 20 Oct 2026, is due on 04 Nov 2026\. INR 23,305\.00 is still to pay\./);
  const unsent = await invoice(env, '1', '2026-10-21', true);
  await assert.rejects(env.remind(unsent.invoice.id), code('INVALID_VENTURE_REQUEST'));
  const paid = await invoice(env, '1', '2026-10-01');
  await env.money('venture.payment.record', { invoiceId: paid.invoice.id, amount: '23305', receivedOn: '2026-10-20', method: 'upi' });
  await assert.rejects(env.remind(paid.invoice.id), code('INVALID_VENTURE_REQUEST'));
  const cheque = await invoice(env, '1', '2026-10-02');
  await env.money('venture.payment.record', { invoiceId: cheque.invoice.id, amount: '23305', receivedOn: '2026-10-20', method: 'cheque' });
  await assert.rejects(env.remind(cheque.invoice.id), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.remind('invoice_missing'), code('INVOICE_NOT_FOUND'));
});

test('reminder days: 3, 10 and 30 days late unless the invoice\'s schedule picked its own', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-06'); // due 21 October: 2 days late on 23 October
  assert.deepEqual((await env.get(issued.invoice.id)).next, { action: 'wait', line: '2 days late. A reminder is due on 24 Oct 2026.' });

  const own = await business();
  await own.schedule({ startOn: '2026-10-23', reminderDays: [5, 20] });
  const [draft] = own.drafts(); // dated 23 October, due 7 November
  await own.money('venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest });
  own.advance(18 * DAY); // 10 November: 3 days late, not yet the 5th day
  assert.deepEqual((await own.get(draft.id)).next, { action: 'wait', line: '3 days late. A reminder is due on 12 Nov 2026.' });
  own.advance(2 * DAY);
  assert.deepEqual((await own.get(draft.id)).next, { action: 'remind', line: '5 days late. Draft a reminder.' });
});

test('every invoice has one next action by its state and a short timeline: issued, paid, waiting cheques, credits, reminders', async () => {
  const env = await business();
  const fresh = await invoice(env, '1', '2026-10-23', true);
  assert.deepEqual([(await env.get(fresh.invoice.id)).next, (await env.get(fresh.invoice.id)).timeline], [{ action: 'issue', line: 'Check it and issue it.' }, []]);
  const issuedNow = await env.money<InvoiceView>('venture.invoice.issue', { invoiceId: fresh.invoice.id, digest: fresh.invoice.digest });
  assert.deepEqual(issuedNow.next, { action: 'wait', line: 'Awaiting payment, due 07 Nov 2026.' });
  assert.deepEqual(issuedNow.timeline?.map(item => item.line), ['Issued on 23 Oct 2026', 'Awaiting payment, due 07 Nov 2026']);

  const late = await invoice(env, '1', '2026-10-01');
  const id = late.invoice.id;
  await env.money('venture.payment.record', { invoiceId: id, amount: '5000', receivedOn: '2026-10-05', method: 'upi' });
  const asked = await env.money<{ creditNote: { rowId: string } }>('venture.credit.issue', { invoiceId: id, amountMinor: '233050', reason: 'A week was not needed.', digest: late.invoice.digest });
  const row = (await call<QueueList>(env, 'venture.queue.list')).rows.find(item => item.id === asked.creditNote.rowId)!;
  await call(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' });
  const { draft } = await env.remind(id);
  await ventureAction(env.deps, owner, 'admin', 'seed.sent', tx => {
    const stored = tx.find('venture-outreach', draft.id)!;
    tx.replace({ ...stored, sent: { at: tx.now, channel: 'own-mailbox', recordedAt: tx.now, recordedBy: 'owner' } });
  });
  await env.money('venture.payment.record', { invoiceId: id, amount: '1000', receivedOn: '2026-10-12', method: 'cheque' });
  const view = await env.get(id);
  // Left: 2330500 - 500000 - 233050 = 1597450 (INR 15,974.50); the cheque for 100000 waits.
  assert.deepEqual(view.timeline?.map(item => [item.what, item.on, item.line]), [
    ['issued', '2026-10-01', 'Issued on 01 Oct 2026'],
    ['paid', '2026-10-05', 'Paid INR 5,000.00 by UPI on 05 Oct 2026'],
    ['cheque', '2026-10-12', 'Cheque for INR 1,000.00 received on 12 Oct 2026, waiting to clear'],
    ['credited', '2026-10-23', 'Credit note CN-0001 for INR 2,330.50 on 23 Oct 2026'],
    ['reminded', '2026-10-23', 'Reminder sent on 23 Oct 2026'],
    ['awaiting', '2026-10-16', 'Awaiting INR 15,974.50, due 16 Oct 2026'],
  ]);
  assert.deepEqual(view.next, { action: 'clear', line: 'A cheque for INR 1,000.00 is waiting to clear. Mark it cleared once it is in your bank.' });
  const listed = (await env.money<(InvoiceView['invoice'] & { next?: unknown })[]>('venture.invoice.list')).find(item => item.id === id)!;
  assert.deepEqual(listed.next, view.next);

  const settled = await invoice(env, '1', '2026-10-02');
  const done = await env.money<InvoiceView>('venture.payment.record', { invoiceId: settled.invoice.id, amount: '23305', receivedOn: '2026-10-09', method: 'bank-transfer' });
  assert.deepEqual(done.next, { action: 'none', line: 'Paid in full.' });
  assert.deepEqual(done.timeline?.map(item => item.line), ['Issued on 02 Oct 2026', 'Paid INR 23,305.00 by bank transfer on 09 Oct 2026', 'Paid in full']);
});

// ---------------------------------------------------------------------------
// The integrator's review (4J5): editing a running schedule, and the sweep through the host
// ---------------------------------------------------------------------------

test('changing a running schedule keeps its start and its day of the month, and never drafts a period twice', async () => {
  const env = await business();
  const set = await env.schedule({ startOn: '2026-10-23' }); // drafts 23 October at once
  env.advance(31 * DAY); // 23 November
  await runMoneySchedules(env.deps, owner);
  env.advance(DAY); // 24 November: the start is in the past now
  const kept = await env.schedule({ startOn: '2026-10-23', end: '2027-06-30', reminderDays: [5] });
  assert.deepEqual([kept.recurring.id, kept.recurring.startOn, kept.recurring.nextOn, kept.recurring.end], [set.recurring.id, '2026-10-23', '2026-12-23', '2027-06-30']);
  assert.deepEqual(env.drafts().map(item => item.issueDate), ['2026-10-23', '2026-11-23'], 'nothing drafted again');
  const quarterly = await env.schedule({ startOn: '2026-10-23', frequency: 'quarterly' });
  assert.equal(quarterly.recurring.nextOn, '2027-01-23', 'the first quarter day after the last draft, on the same day of the month');
  await assert.rejects(env.schedule({ startOn: '2026-11-01' }), code('INVALID_VENTURE_REQUEST'), 'a changed start must be today or later');
  const moved = await env.schedule({ startOn: '2026-12-05' });
  assert.deepEqual([moved.recurring.startOn, moved.recurring.nextOn], ['2026-12-05', '2026-12-05']);
  await runMoneySchedules(env.deps, owner);
  assert.equal(env.drafts().length, 2);
});

test('the engine\'s sweep through VentureHost.sweepJournal, with the engine\'s base context, drafts what is due', async () => {
  const env = await business();
  await env.schedule({ startOn: '2026-11-01' });
  env.advance(9 * DAY); // 1 November
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test', workspace: env.workspace });
  try {
    // The engine's #baseContext: the owner on this computer.
    const moved = await host.sweepJournal({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' });
    assert.equal(typeof moved, 'number');
  } finally {
    host.close();
  }
  assert.deepEqual(env.drafts().map(item => item.issueDate), ['2026-11-01']);
});
