// Goals (Ink v2 wave 4, package 4I1): the owner's monthly goal counts money invoiced before tax, not cash received and
// not profit. Progress, pace, days left and "ready to issue" are worked out in code with sum receipts; a suggested goal
// is a model estimate and never becomes a goal on its own. Clock: 23 October 2026, 15:30 in Asia/Kolkata.
// Every expected amount is worked out by hand in a comment, never by the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, type Context } from '../runtime/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import type {
  CreditNoteRecord, GoalRecord, GoalSuggestion, GoalView, InvoiceRecord, ModelOutcome, ModelTask, SumReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { code, owner, phone } from './venture-views-env.ts';
import { CLIENT, DAY, goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';

const get = (env: GoalEnv, payload: unknown = {}, ctx: Context = owner) => env.money<GoalView>('venture.goals.get', payload, ctx);
const receipt = (env: GoalEnv, id: string | null) => env.money<SumReceiptRecord>('venture.receipt.get', { id });
const rows = (record: SumReceiptRecord) => record.addends.map(item => [item.label, item.amount]);
const headline = (record: SumReceiptRecord) => `${record.figures[0].label} ${record.figures[0].display}`;

/** Changes one stored invoice's fields directly, as a later package or a void would. */
async function patchInvoice(env: GoalEnv, id: string, patch: Partial<InvoiceRecord>) {
  await ventureAction(env.deps, owner, 'admin', 'seed.invoice', tx => { tx.replace({ ...tx.find('venture-invoice', id)!, ...patch }); });
}

/** A credit note record as 4J5 will store it (its package has not landed): written directly. */
async function creditNote(env: GoalEnv, fields: Pick<CreditNoteRecord, 'invoiceId' | 'amountMinor' | 'status' | 'number' | 'issuedAt'>) {
  await ventureAction(env.deps, owner, 'admin', 'seed.credit', tx => {
    tx.put<CreditNoteRecord>({ ...tx.base('venture-credit-note'), currency: 'INR', reason: 'Part of the month was not needed.', digest: 'credit-digest', ...fields });
  });
}

test('goals.set keeps a month\'s goal inside the app, for the owner; refusals write nothing; a newer goal is the one in use', async () => {
  const env = await goalBusiness();
  const view = await env.money<GoalView>('venture.goals.set', { month: '2026-10', amountMinor: '15000000' });
  assert.equal(view.month, '2026-10');
  assert.equal(view.state, 'set');
  assert.equal(view.goal?.display, 'INR 150,000.00');
  const [goal] = listRecords(env.store.read(), 'venture-goal');
  assert.deepEqual([goal.month, goal.amountMinor, goal.currency, goal.by], ['2026-10', '15000000', 'INR', 'owner']);
  // Today's goal card reads again: queue.changed in the same commit, and published after it.
  assert.equal(listRecords(env.store.read(), 'venture-event').at(-1)?.name, 'queue.changed');
  assert.ok(env.published.at(-1)?.some(event => event.name === 'queue.changed'));

  await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amountMinor: '15000000' }, phone), code('APP_APPROVAL_REQUIRED'));
  await env.store.update(state => {
    state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] });
    state.members.push({ id: 'ca', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  });
  for (const ctx of [{ memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' }, { memberId: 'ca', role: 'accountant', epoch: 1, channel: 'desktop' }] as Context[]) {
    await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amountMinor: '15000000' }, ctx), code('FORBIDDEN'), ctx.role);
    assert.equal((await get(env, {}, ctx)).goal?.display, 'INR 150,000.00', `${ctx.role} may read it`);
  }
  for (const amountMinor of ['0', '-15000000', '1500.50', '1.5e7', '', ' 15000000', '0150', '1000000000000000', 15000000, null]) {
    await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amountMinor }), code('GOAL_INVALID'), String(amountMinor));
  }
  // Fifteen digits is the most a goal may have; twelve months ahead is the furthest.
  const december = await env.money<GoalView>('venture.goals.set', { month: '2026-12', amountMinor: '999999999999999' });
  assert.equal(december.goal?.display, 'INR 9,999,999,999,999.99');
  await env.money('venture.goals.set', { month: '2027-10', amountMinor: '100' });
  await assert.rejects(env.money('venture.goals.set', { month: '2026-09', amountMinor: '15000000' }), code('GOAL_MONTH_PAST'));
  for (const month of ['2026-13', 'October', '2026-1', 202610, '1999-12', '2027-11']) {
    await assert.rejects(env.money('venture.goals.set', { month, amountMinor: '15000000' }), code('INVALID_VENTURE_REQUEST'), String(month));
  }
  await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amountMinor: '100', extra: true }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.goals.set', { month: '2026-10' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-goal').length, 3, 'refusals write nothing');

  // A newer goal for the same month is the one in use; the old one stays in the records as history, and its receipts
  // read stale: the goal in use is part of what they add up, even when the amount is the same.
  env.advance(60_000);
  const newer = await env.money<GoalView>('venture.goals.set', { month: '2026-10', amountMinor: '12000000' });
  assert.equal(newer.goal?.display, 'INR 120,000.00');
  assert.equal((await receipt(env, view.goal!.receiptId)).stale, true);
  env.advance(60_000);
  const same = await env.money<GoalView>('venture.goals.set', { month: '2026-10', amountMinor: '12000000' });
  assert.equal((await receipt(env, newer.goal!.receiptId)).stale, true);
  assert.equal((await receipt(env, newer.paceReceiptId)).stale, true);
  assert.equal((await receipt(env, same.goal!.receiptId)).stale, false);
  assert.deepEqual(listRecords(env.store.read(), 'venture-goal').filter(item => item.month === '2026-10').map(item => item.amountMinor), ['15000000', '12000000', '12000000']);
  assert.equal((await get(env, { month: '2026-12' })).goal?.display, 'INR 9,999,999,999,999.99', 'December does not touch October');

  // A goal kept in another currency than the business's books is refused, never shown as if it were rupees.
  await ventureAction(env.deps, owner, 'admin', 'seed.goal', tx => { tx.put<GoalRecord>({ ...tx.base('venture-goal'), month: '2026-11', amountMinor: '500000', currency: 'USD', by: 'owner' }); });
  await assert.rejects(get(env, { month: '2026-11' }), code('CURRENCY_CONFLICT'));
});

test('goals.set takes the goal as the owner typed it (4I2): read in the business currency in BigInt, as payments read theirs', async () => {
  const env = await goalBusiness();
  // INR has two decimals: "1,50,000.50" is 150000 rupees and 50 paise, 15000050 paise; grouping commas and spaces go.
  const typed = await env.money<GoalView>('venture.goals.set', { month: '2026-10', amount: '1,50,000.50' });
  assert.equal(typed.goal?.display, 'INR 150,000.50');
  assert.equal(listRecords(env.store.read(), 'venture-goal').at(-1)?.amountMinor, '15000050');
  // " 1 50 000 " is 150000 rupees, 15000000 paise; "2000.5" is 200050 paise; "0007" is 700 paise.
  for (const [amount, minor] of [[' 1 50 000 ', '15000000'], ['2000.5', '200050'], ['0007', '700']] as const) {
    await env.money('venture.goals.set', { month: '2026-11', amount });
    assert.equal(listRecords(env.store.read(), 'venture-goal').at(-1)?.amountMinor, minor, amount);
  }
  const kept = listRecords(env.store.read(), 'venture-goal').length;
  // Three decimals is a fraction of a paisa; zero, signs, exponents, symbols, words and 16 digits are not a goal.
  for (const amount of ['1500.505', '0', '0.00', '-150000', '1.5e5', '₹150000', 'abc', '', '.5', '10000000000000', 150000, null]) {
    await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amount }), code('GOAL_INVALID'), String(amount));
  }
  await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amount: '150000', amountMinor: '15000000' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.goals.set', { month: '2026-10', amount: '150000' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.money('venture.goals.set', { month: '2026-09', amount: '150000' }), code('GOAL_MONTH_PAST'));
  assert.equal(listRecords(env.store.read(), 'venture-goal').length, kept, 'refusals write nothing');
});

test('goals.get: invoiced before tax this month, ready to issue, pace, days left and received so far, each with its receipt', async () => {
  const env = await goalBusiness();
  // September: 2 months on 30 Sep, before tax 2 x 1975000 = 3950000. September's, not October's.
  const september = await invoice(env, '2', '2026-09-30');
  // October: 4 months on 1 Oct, before tax 4 x 1975000 = 7900000 (with GST 4 x 2330500 = 9322000), and 2 months on 20 Oct (3950000).
  const first = await invoice(env, '4', '2026-10-01');
  const second = await invoice(env, '2', '2026-10-20');
  // A draft dated today, 1 month: 1975000 before tax, ready to issue. A draft dated in September is not October's.
  const ready = await invoice(env, '1', '2026-10-23', true);
  await invoice(env, '1', '2026-09-29', true);
  // INR 50,000.00 came in on 10 Oct against the first October invoice (it stays part-paid and still counts as invoiced);
  // INR 10,000.00 came in on 30 Sep against September's.
  await env.money('venture.payment.record', { invoiceId: first.invoice.id, amount: '50000.00', receivedOn: '2026-10-10', method: 'upi' });
  await env.money('venture.payment.record', { invoiceId: september.invoice.id, amount: '10000.00', receivedOn: '2026-09-30', method: 'upi' });
  const set = await env.money<GoalView>('venture.goals.set', { month: '2026-10', amountMinor: '15000000' });
  const goalId = listRecords(env.store.read(), 'venture-goal')[0].id;

  const view = await get(env);
  assert.deepEqual(view, { ...set, next: view.next, briefing: view.briefing }, 'set answers with the same view get gives');
  assert.deepEqual([view.month, view.state, view.goal?.display], ['2026-10', 'set', 'INR 150,000.00']);
  // Invoiced: 7900000 + 3950000 = 11850000 (INR 118,500.00); 11850000 x 1000 / 15000000 = 790.
  assert.equal(view.invoiced.display, 'INR 118,500.00');
  assert.equal(view.invoicedPermille, 790);
  // Ready: 1975000 (INR 19,750.00); 1975000 x 1000 / 15000000 = 131.66, floored to 131.
  assert.equal(view.ready.display, 'INR 19,750.00');
  assert.equal(view.readyPermille, 131);
  // Pace: day 23 of 31, 23 x 1000 / 31 = 741.93, floored to 741. Days left: 31 - 23 = 8; not the last day.
  assert.deepEqual([view.elapsedDays, view.monthDays, view.daysLeft, view.lastDay, view.pacePermille, view.pace], [23, 31, 8, false, 741, 'ahead']);
  // Still to invoice: 15000000 - 11850000 = 3150000 (INR 31,500.00). Received this month: INR 50,000.00.
  assert.equal(view.stillToInvoice?.display, 'INR 31,500.00');
  assert.equal(view.receivedSoFar.display, 'INR 50,000.00');
  assert.equal(view.lastMonth, null);
  assert.equal(view.line, '79% of your October 2026 goal invoiced, before tax. Today\'s pace is 74%, so you are ahead.');
  // 4I2: the percents as whole numbers for the screen to word (11850000 x 100 / 15000000 = 79; 741 / 10 = 74), not past
  // the goal, and how far ahead of today's pace with the pace receipt (INR 7,209.67, worked out below).
  assert.deepEqual([view.invoicedPercent, view.pacePercent, view.past, view.pastBy], [79, 74, false, null]);
  assert.deepEqual(view.paceBy, { display: 'INR 7,209.67', receiptId: view.paceReceiptId });

  const invoiced = await receipt(env, view.invoiced.receiptId);
  assert.deepEqual(invoiced.subject, { type: 'invoiced', month: '2026-10', which: 'issued' });
  assert.deepEqual(invoiced.addends.map(item => item.recordId), [first.invoice.id, second.invoice.id]);
  assert.deepEqual(rows(invoiced), [[`INV-0002 for ${CLIENT}`, '7900000'], [`INV-0003 for ${CLIENT}`, '3950000']]);
  assert.equal(headline(invoiced), 'Invoiced in October 2026, before tax INR 118,500.00');
  assert.equal(invoiced.stale, false);
  const readyReceipt = await receipt(env, view.ready.receiptId);
  assert.deepEqual(readyReceipt.subject, { type: 'invoiced', month: '2026-10', which: 'ready' });
  assert.deepEqual(rows(readyReceipt), [[`Draft for ${CLIENT}, dated 23 Oct 2026`, '1975000']]);
  // The goal's receipt: the goal in use, less each invoice before tax, is what is still to invoice.
  const still = await receipt(env, view.goal!.receiptId);
  assert.deepEqual(still.subject, { type: 'goal', month: '2026-10', goalId, day: null });
  assert.deepEqual(rows(still), [['Your goal for October 2026', '15000000'], [`Less INV-0002 for ${CLIENT}`, '-7900000'], [`Less INV-0003 for ${CLIENT}`, '-3950000']]);
  assert.equal(headline(still), 'Still to invoice toward the goal INR 31,500.00');
  assert.equal(view.stillToInvoice?.receiptId, still.id);
  // Today's pace has its own receipt, one for each day: 15000000 x 23 / 31 = 11,129,032.26, rounded up to 11129033
  // (whole paise, so "ahead" means at or past it); 11850000 - 11129033 = 720967 (INR 7,209.67) ahead.
  const pace = await receipt(env, view.paceReceiptId);
  assert.notEqual(pace.id, still.id);
  assert.deepEqual(pace.subject, { type: 'goal', month: '2026-10', goalId, day: '2026-10-23' });
  assert.deepEqual(rows(pace), [
    [`INV-0002 for ${CLIENT}`, '7900000'], [`INV-0003 for ${CLIENT}`, '3950000'],
    ['Less today\'s pace: day 23 of 31 of the INR 150,000.00 goal', '-11129033'],
  ]);
  assert.equal(headline(pace), 'Ahead of today\'s pace (day 23 of 31) by INR 7,209.67');
  const received = await receipt(env, view.receivedSoFar.receiptId);
  assert.deepEqual(received.subject, { type: 'received', from: '2026-10-01', to: '2026-10-31' });
  assert.equal(received.totalMinor, '5000000');

  // Issuing the ready draft: the old receipts read stale and the new figures carry new receipts.
  await env.money('venture.invoice.issue', { invoiceId: ready.invoice.id, digest: ready.invoice.digest });
  for (const id of [view.invoiced.receiptId, still.id, pace.id]) assert.equal((await receipt(env, id)).stale, true, String(id));
  const after = await get(env);
  // 11850000 + 1975000 = 13825000; x 1000 / 15000000 = 921.66, floored to 921. Nothing is ready now: an empty sum
  // shows zero with no receipt, and none is written.
  assert.equal(after.invoicedPermille, 921);
  assert.equal(after.readyPermille, 0);
  assert.deepEqual(after.ready, { display: 'INR 0.00', receiptId: null });
  assert.notEqual(after.invoiced.receiptId, view.invoiced.receiptId);
  const emptyReady = listRecords(env.store.read(), 'venture-sum-receipt').filter(item => item.subject.type === 'invoiced' && item.subject.which === 'ready' && item.addends.length === 0);
  assert.equal(emptyReady.length, 0);

  // Past the goal: 2 more months, 13825000 + 3950000 = 17775000; x 100 / 15000000 = 118.5, floored to 118. The bar
  // is full, nothing is still to invoice, and the goal's receipt says how far past: 17775000 - 15000000 = 2775000.
  await invoice(env, '2', '2026-10-23');
  const past = await get(env);
  assert.deepEqual([past.invoicedPermille, past.readyPermille, past.stillToInvoice, past.pace], [1000, 0, null, 'ahead']);
  assert.equal(past.line, 'Past the goal: 118% of your October 2026 goal invoiced, before tax.');
  // 4I2: past the goal, with how far past (17775000 - 15000000 = 2775000) and the goal's own receipt; 118 percent.
  assert.deepEqual([past.past, past.invoicedPercent], [true, 118]);
  assert.deepEqual(past.pastBy, { display: 'INR 27,750.00', receiptId: past.goal!.receiptId });
  const beyond = await receipt(env, past.goal!.receiptId);
  assert.equal(headline(beyond), 'Past the goal by INR 27,750.00');
  assert.deepEqual(beyond.addends.map(item => item.amount), ['7900000', '3950000', '1975000', '3950000', '-15000000']);
  assert.equal(beyond.addends.at(-1)?.label, 'Less your goal for October 2026');
});

test('what counts: void invoices are left out; discounts and issued credit notes come off, before tax, by the owner\'s day', async () => {
  const env = await goalBusiness();
  // INV-0001: 4 months on 1 Oct, before tax 7900000, total with GST 9322000.
  const a = await invoice(env, '4', '2026-10-01');
  // INV-0002: 2 months on 20 Oct, subtotal 3950000, given a discount of 395000: before tax 3950000 - 395000 = 3555000.
  const b = await invoice(env, '2', '2026-10-20');
  await patchInvoice(env, b.invoice.id, { discountMinor: '395000' });
  // INV-0003: 1 month on 21 Oct, then voided: left out.
  const c = await invoice(env, '1', '2026-10-21');
  await patchInvoice(env, c.invoice.id, { status: 'void' });
  // Credit notes on INV-0001, before tax in the invoice's own proportion, 7900000 of 9322000:
  // CN-0001, 2330500 issued 22 Oct: 2330500 x 7900000 / 9322000 = 1975000.
  // CN-0002, 466100 issued 19:00 UTC on 30 Sep, which is 00:30 on 1 Oct in Kolkata: 466100 x 7900000 / 9322000 = 395000.
  // A credit note still waiting, and one issued on 30 Sep by the owner's day, are not October's.
  await creditNote(env, { invoiceId: a.invoice.id, amountMinor: '2330500', status: 'issued', number: 'CN-0001', issuedAt: '2026-10-22T06:00:00.000Z' });
  await creditNote(env, { invoiceId: a.invoice.id, amountMinor: '466100', status: 'issued', number: 'CN-0002', issuedAt: '2026-09-30T19:00:00.000Z' });
  await creditNote(env, { invoiceId: a.invoice.id, amountMinor: '1000000', status: 'waiting', number: null, issuedAt: null });
  await creditNote(env, { invoiceId: a.invoice.id, amountMinor: '1000000', status: 'issued', number: 'CN-0000', issuedAt: '2026-09-30T10:00:00.000Z' });
  await env.money('venture.goals.set', { month: '2026-10', amountMinor: '15000000' });

  const view = await get(env);
  // 7900000 + 3555000 - 395000 - 1975000 = 9085000 (INR 90,850.00); x 1000 / 15000000 = 605.66, floored to 605.
  assert.equal(view.invoiced.display, 'INR 90,850.00');
  assert.equal(view.invoicedPermille, 605);
  const invoiced = await receipt(env, view.invoiced.receiptId);
  assert.deepEqual(rows(invoiced), [
    [`INV-0001 for ${CLIENT}`, '7900000'], [`INV-0002 for ${CLIENT}`, '3555000'],
    ['Less credit note CN-0002 on INV-0001', '-395000'], ['Less credit note CN-0001 on INV-0001', '-1975000'],
  ]);
  assert.ok(!invoiced.addends.some(item => item.recordId === c.invoice.id), 'the void invoice is left out');
  // Still to invoice: 15000000 - 9085000 = 5915000.
  const still = await receipt(env, view.goal!.receiptId);
  assert.deepEqual(rows(still), [
    ['Your goal for October 2026', '15000000'], [`Less INV-0001 for ${CLIENT}`, '-7900000'], [`Less INV-0002 for ${CLIENT}`, '-3555000'],
    ['Credit note CN-0002 on INV-0001', '395000'], ['Credit note CN-0001 on INV-0001', '1975000'],
  ]);
  assert.equal(headline(still), 'Still to invoice toward the goal INR 59,150.00');
  // Behind today's pace: 9085000 x 31 = 281,635,000 is less than 15000000 x 23 = 345,000,000. The pace receipt says by
  // how much: 11129033 - 9085000 = 2044033 (INR 20,440.33).
  assert.equal(view.pace, 'behind');
  const pace = await receipt(env, view.paceReceiptId);
  assert.equal(headline(pace), 'Behind today\'s pace (day 23 of 31) by INR 20,440.33');
  assert.deepEqual(rows(pace), [
    ['Today\'s pace: day 23 of 31 of the INR 150,000.00 goal', '11129033'], [`Less INV-0001 for ${CLIENT}`, '-7900000'], [`Less INV-0002 for ${CLIENT}`, '-3555000'],
    ['Credit note CN-0002 on INV-0001', '395000'], ['Credit note CN-0001 on INV-0001', '1975000'],
  ]);
  assert.equal(view.line, '60% of your October 2026 goal invoiced, before tax. Today\'s pace is 74%, so you are behind.');
});

test('goals.get with no goal: last month with its receipt, no suggestion, the bar parts left out, no receipt for an empty sum', async () => {
  const env = await goalBusiness();
  // September: 2 months, before tax 2 x 1975000 = 3950000 (INR 39,500.00).
  await invoice(env, '2', '2026-09-30');
  const before = listRecords(env.store.read(), 'venture-sum-receipt').length;
  const view = await get(env);
  assert.equal(view.state, 'unset');
  for (const field of ['goal', 'stillToInvoice', 'invoicedPermille', 'readyPermille', 'pace', 'paceReceiptId', 'invoicedPercent', 'pastBy', 'paceBy'] as const) assert.equal(view[field], null, field);
  assert.deepEqual([view.elapsedDays, view.monthDays, view.daysLeft, view.pacePermille, view.pacePercent, view.past], [23, 31, 8, 741, 74, false]);
  assert.deepEqual(view.invoiced, { display: 'INR 0.00', receiptId: null });
  assert.deepEqual(view.receivedSoFar, { display: 'INR 0.00', receiptId: null });
  assert.equal(view.lastMonth?.display, 'INR 39,500.00');
  const last = await receipt(env, view.lastMonth!.receiptId);
  assert.deepEqual(last.subject, { type: 'invoiced', month: '2026-09', which: 'issued' });
  assert.equal(last.totalMinor, '3950000');
  assert.equal(listRecords(env.store.read(), 'venture-sum-receipt').length, before + 1, 'only last month\'s sum was written');
  assert.equal(view.line, 'No goal for October 2026 yet. Set one to see how the month is going.');
  assert.equal(Object.hasOwn(view, 'suggestion'), false, 'get never suggests');
});

test('goals.suggest: the owner\'s AI reads the plan\'s offers and prices only, and its figure is a model estimate; null otherwise', async () => {
  const env = await goalBusiness();
  await invoice(env, '2', '2026-10-01');
  const tasks: ModelTask<unknown>[] = [];
  let answer: unknown = { amount: '150000' };
  let by: 'model' | 'template' = 'model';
  env.models.generate = (async <T>(_ctx: Context, task: ModelTask<T>): Promise<ModelOutcome<T>> => {
    tasks.push(task as ModelTask<unknown>);
    return { value: task.validate(answer), by, callId: 'call_1', presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', costMicros: '900', priceConfirmed: true };
  }) as typeof env.models.generate;
  const suggest = (month = '2026-10') => env.money<GoalSuggestion | null>('venture.goals.suggest', { month });

  // No AI connected, or an AI that cannot be used right now: no suggestion, and nothing is sent anywhere.
  assert.equal(await suggest(), null);
  env.models.connected = true;
  env.models.usable = false;
  assert.equal(await suggest(), null);
  assert.equal(tasks.length, 0);

  env.models.usable = true;
  // 150000 whole rupees is 15000000 paise.
  assert.deepEqual(await suggest(), {
    // 4I2: typed is the same amount as the owner would type it, for the goal field.
    amountMinor: '15000000', display: 'INR 150,000.00', estimate: true, typed: '150000.00',
    line: 'A model estimate from your offers and prices. Change it to what you aim for.',
  });
  const [task] = tasks;
  assert.equal(task.purpose, 'goal-suggest');
  assert.equal(task.containsClientData, false);
  const sent = JSON.stringify(task.input);
  assert.match(sent, /Monthly books/);
  assert.match(sent, /19750\.00/);
  for (const secret of [CLIENT, 'aroma.example', 'INV-', 'Catch up clean up']) assert.ok(!sent.includes(secret), `${secret} was sent`);
  assert.equal(listRecords(env.store.read(), 'venture-goal').length, 0, 'a suggestion is never a goal on its own');

  // Anything but a whole amount in plain digits is refused, and a figure past fifteen digits in paise too.
  for (const raw of [{ amount: '1.5 lakh' }, { amount: '0' }, { amount: '-5' }, { amount: 150000 }, { amount: '150000', why: 'x' }, { amount: '99999999999999' }, null]) {
    assert.throws(() => task.validate(raw), code('MODEL_OUTPUT_REJECTED'), JSON.stringify(raw));
  }
  // A refused answer, or a template's, is no suggestion.
  answer = { amount: 'about a lakh' };
  assert.equal(await suggest(), null);
  answer = { amount: '150000' };
  by = 'template';
  assert.equal(await suggest(), null);

  await assert.rejects(suggest('2026-09'), code('GOAL_MONTH_PAST'));
  await assert.rejects(suggest('2027-11'), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.goals.suggest', {}), code('INVALID_VENTURE_REQUEST'));

  // A plan with no priced offer gives nothing to suggest from: null, and no call.
  const unpriced = await goalBusiness({ price: null });
  unpriced.models.connected = true;
  let calls = 0;
  unpriced.models.generate = (async () => { calls += 1; throw new ChausarError('NO_MODEL_CONNECTED', 'Not used here.'); }) as typeof unpriced.models.generate;
  assert.equal(await unpriced.money('venture.goals.suggest', { month: '2026-10' }), null);
  assert.equal(calls, 0);
});

test('goals.get reads the month on the owner\'s calendar: 23:30 on 31 Oct is October\'s last day, 00:15 on 1 Nov is November', async () => {
  const env = await goalBusiness({ taxAssumed: true });
  await env.money('venture.goals.set', { month: '2026-11', amountMinor: '5000000' });
  // 18:00 UTC on 31 Oct is 23:30 in Kolkata: an invoice made now is dated 31 Oct. No tax: 1 month is 1975000.
  env.advance(8 * DAY + 8 * 3_600_000);
  await invoice(env, '1', null);
  const october = await get(env);
  assert.equal(october.month, '2026-10');
  assert.equal(october.invoiced.display, 'INR 19,750.00');
  assert.deepEqual([october.elapsedDays, october.monthDays, october.daysLeft, october.lastDay, october.pacePermille], [31, 31, 0, true, 1000]);
  // 45 minutes later it is 00:15 on 1 November in Kolkata, though UTC still says 31 October.
  env.advance(45 * 60_000);
  await invoice(env, '2', null);
  const november = await get(env);
  assert.equal(november.month, '2026-11');
  // 2 x 1975000 = 3950000; x 1000 / 5000000 = 790. Day 1 of 30: 1 x 1000 / 30 = 33.3, floored to 33; 29 days left.
  // 3950000 x 30 = 118,500,000 is more than 5000000 x 1, so ahead.
  assert.equal(november.invoiced.display, 'INR 39,500.00');
  assert.deepEqual([november.elapsedDays, november.monthDays, november.daysLeft, november.lastDay, november.pacePermille, november.invoicedPermille, november.pace], [1, 30, 29, false, 33, 790, 'ahead']);
  // Simple first: a business not registered for tax sees no tax words.
  assert.equal(november.line, '79% of your November 2026 goal invoiced. Today\'s pace is 3%, so you are ahead.');
  assert.equal(headline(await receipt(env, november.invoiced.receiptId)), 'Invoiced in November 2026 INR 39,500.00');
  // October is over: read whole, no pace to keep, and no next step for it.
  const over = await get(env, { month: '2026-10' });
  assert.deepEqual([over.invoiced.display, over.daysLeft, over.lastDay, over.pace, over.next, over.briefing], ['INR 19,750.00', 0, false, null, null, null]);
  // Twenty-four months back and twelve ahead of November 2026 are the furthest a goal is read.
  await get(env, { month: '2024-11' });
  await get(env, { month: '2027-11' });
  for (const payload of [{ month: '2024-10' }, { month: '2027-12' }, { month: '2026-13' }, { month: 'Nov' }, { extra: 1 }]) {
    await assert.rejects(get(env, payload), code('INVALID_VENTURE_REQUEST'), JSON.stringify(payload));
  }
});

test('the three goal methods through VentureHost.request: the app-only check, the owner\'s goal, and no AI', async () => {
  const env = await goalBusiness();
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test', workspace: env.workspace });
  try {
    await assert.rejects(host.request(phone, 'venture.goals.set', { month: '2026-10', amountMinor: '15000000' }), code('APP_APPROVAL_REQUIRED'));
    const set = await host.request(owner, 'venture.goals.set', { month: '2026-10', amountMinor: '15000000' }) as GoalView;
    assert.deepEqual([set.state, set.goal?.display], ['set', 'INR 150,000.00']);
    const read = await host.request(phone, 'venture.goals.get', {}) as GoalView;
    assert.deepEqual([read.month, read.goal?.display, read.pacePermille], ['2026-10', 'INR 150,000.00', 741]);
    // The engine's own model port, with no AI connected: no suggestion.
    assert.equal(await host.request(owner, 'venture.goals.suggest', { month: '2026-10' }), null);
  } finally {
    host.close();
  }
});
