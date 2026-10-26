// Ink v2 wave 4, package 4J5 (M11, M17 data): payments and credits. A cheque is pending until the owner clears it or a
// bank row pays it, and only cleared money counts as received; one payment can be split across invoices, never over its
// amount or a balance; a credit note is asked for, waits on Today, and only the owner's issue there (a second ask, the
// always-ask floor) links it to its invoice, takes it off the balance and off the goal; an order's quote becomes one
// invoice once. clientStatement gives 4J7's "What you owe us" page its figures with receipts. Amounts worked out by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context, State } from '../runtime/contracts.ts';
import type {
  BankImportResult, BankLedgerView, CreditNoteView, GoalView, InvoiceView, OrderRecord, QueueDecision, QueueList, QueueRow, SumReceiptRecord,
  VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { receivedPlan } from '../runtime/venture/money/sums.ts';
import { clientStatement, statementReceipts } from '../runtime/venture/money/statement.ts';
import { moneyRows } from '../runtime/venture/money/credits.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { VentureHost } from '../runtime/venture/host.ts';
import { DAY, goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { call, code, owner, phone } from './venture-views-env.ts';

const REASON = 'Two days of the month were not needed.';

async function business() {
  const env = await goalBusiness();
  const credit = (payload: Record<string, unknown>, ctx: Context = owner) => env.money<{ creditNote: CreditNoteView }>('venture.credit.issue', payload, ctx);
  const rows = async () => (await call<QueueList>(env, 'venture.queue.list')).rows;
  const rowOf = async (id: string | null): Promise<QueueRow> => {
    const found = (await rows()).find(row => row.id === id);
    assert.ok(found, `no Today row ${id}`);
    return found;
  };
  const decide = (row: QueueRow, action: string, ctx: Context = owner) => call<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action }, ctx);
  const get = (invoiceId: string) => env.money<InvoiceView>('venture.invoice.get', { invoiceId });
  const pay = (payload: Record<string, unknown>, ctx: Context = owner) => env.money<InvoiceView>('venture.payment.record', payload, ctx);
  const build = <T>(method: string, payload: unknown) =>
    (buildHandlers as Record<string, (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>>)[method](env.deps, owner, payload) as Promise<T>;
  return { ...env, credit, rows, rowOf, decide, get, pay, build };
}

// One month is INR 19,750.00 before tax; GST at 18% split CGST and SGST (177750 each) makes 2330500 (INR 23,305.00).

test('a credit note waits on Today; issuing it there numbers it, links it, takes it off the balance and the goal, once', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.money('venture.goals.set', { month: '2026-10', amountMinor: '5000000' });
  // 10% of the total: 233050 (INR 2,330.50).
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest });
  assert.deepEqual([asked.creditNote.state, asked.creditNote.number, asked.creditNote.amount, asked.creditNote.invoiceId, asked.creditNote.reason],
    ['waiting', null, 'INR 2,330.50', issued.invoice.id, REASON]);
  assert.equal(asked.creditNote.line, 'Waiting on Today for you to issue it.');
  const row = await env.rowOf(asked.creditNote.rowId);
  assert.equal(row.kind, 'invoice');
  assert.equal(row.title, 'Credit note for Cafe Aroma Demo on INV-0001');
  assert.equal(row.line, `Takes INR 2,330.50 off what Cafe Aroma Demo owes. Reason: ${REASON}`);
  // 2330500 - 233050 = 2097450 (INR 20,974.50).
  assert.deepEqual(row.change, { label: 'Left to pay on INV-0001', before: 'INR 23,305.00', after: 'INR 20,974.50', receiptId: `credit-balance:${asked.creditNote.id}` });
  assert.deepEqual(row.actions, [{ id: 'deny', label: 'Cancel it', primary: false }, { id: 'issue', label: 'Issue credit note', primary: true, secondAsk: true }]);
  // Nothing changed while it waits.
  assert.equal((await env.get(issued.invoice.id)).invoice.balanceMinor, '2330500');
  assert.equal((await env.money<GoalView>('venture.goals.get')).invoiced.display, 'INR 19,750.00');

  // Off the app the decision is refused and nothing happens.
  await assert.rejects(env.decide(row, 'issue', phone), code('APP_APPROVAL_REQUIRED'));
  const done = await env.decide(row, 'issue');
  assert.deepEqual([done.outcome, done.line], ['done', 'Issued credit note CN-0001. Cafe Aroma Demo now owes INR 20,974.50 on INV-0001.']);
  const note = listRecords(env.store.read(), 'venture-credit-note')[0];
  assert.deepEqual([note.status, note.number, note.invoiceId, note.issuedAt], ['issued', 'CN-0001', issued.invoice.id, env.now()]);
  const after = await env.get(issued.invoice.id);
  assert.deepEqual([after.invoice.balanceMinor, after.invoice.status], ['2097450', 'issued']);
  assert.deepEqual(after.credits?.map(item => [item.number, item.amount, item.state]), [['CN-0001', 'INR 2,330.50', 'issued']]);
  // The books: a refund fact of its share before tax. 233050 x 1975000 / 2330500 = 197500 exactly; tax 233050 - 197500 = 35550.
  const refunds = env.store.read().facts.filter(fact => fact.kind === 'refund');
  assert.deepEqual(refunds.map(fact => [fact.fields.amountMinor, fact.fields.taxMinor, fact.fields.invoiceId, fact.validFrom]), [['197500', '35550', issued.invoice.id, '2026-10-23']]);
  // The goal: 1975000 - 197500 = 1777500 invoiced before tax (INR 17,775.00), the credit note a line of its receipt.
  const goal = await env.money<GoalView>('venture.goals.get');
  assert.equal(goal.invoiced.display, 'INR 17,775.00');
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: goal.invoiced.receiptId! });
  assert.deepEqual(receipt.addends.map(item => [item.label, item.amount]), [['INV-0001 for Cafe Aroma Demo', '1975000'], ['Less credit note CN-0001 on INV-0001', '-197500']]);

  assert.deepEqual([(await env.decide(row, 'issue')).reason], ['ALREADY_DECIDED']);
  assert.ok(!(await env.rows()).some(item => item.id === row.id));
  const second = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '100', reason: 'One more.', digest: issued.invoice.digest });
  await env.decide(await env.rowOf(second.creditNote.rowId), 'issue');
  assert.equal(listRecords(env.store.read(), 'venture-credit-note').at(-1)!.number, 'CN-0002');
});

test('credit.issue refuses what it cannot honestly ask for', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  const draft = await invoice(env, '1', '2026-10-02', true);
  const ok = { invoiceId: issued.invoice.id, amountMinor: '100000', reason: REASON, digest: issued.invoice.digest };
  await assert.rejects(env.credit(ok, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.credit({ ...ok, digest: 'abc123' }), code('APPROVAL_STALE'));
  await assert.rejects(env.credit({ ...ok, invoiceId: 'invoice_missing' }), code('INVOICE_NOT_FOUND'));
  await assert.rejects(env.credit({ ...ok, invoiceId: draft.invoice.id, digest: draft.invoice.digest }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.credit({ ...ok, amountMinor: '0' }), code('INVALID_AMOUNT'));
  await assert.rejects(env.credit({ ...ok, amountMinor: '10.5' }), code('INVALID_AMOUNT'));
  await assert.rejects(env.credit({ ...ok, reason: '' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.credit({ ...ok, amountMinor: '2330501' }), code('CREDIT_TOO_LARGE')); // one paisa over the balance
  // A waiting credit note holds its amount: 2330500 - 2000000 = 330500 left to credit.
  await env.credit({ ...ok, amountMinor: '2000000' });
  await assert.rejects(env.credit({ ...ok, amountMinor: '330501' }), code('CREDIT_TOO_LARGE'));
  // And a payment cannot take what it holds either.
  await assert.rejects(env.pay({ invoiceId: issued.invoice.id, amount: '3305.01', receivedOn: '2026-10-20', method: 'upi' }), code('PAYMENT_TOO_LARGE'));
  assert.equal(listRecords(env.store.read(), 'venture-credit-note').length, 1);
});

test('cancelling a credit note on Today changes nothing; after a payment the old card is stale and the new one shows the new balance', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest });
  const cancelled = await env.decide(await env.rowOf(asked.creditNote.rowId), 'deny');
  assert.equal(cancelled.line, 'Cancelled. Nothing changed on INV-0001.');
  assert.equal(listRecords(env.store.read(), 'venture-credit-note')[0].status, 'cancelled');
  assert.equal((await env.get(issued.invoice.id)).invoice.balanceMinor, '2330500');
  assert.equal(env.store.read().facts.filter(fact => fact.kind === 'refund').length, 0);

  // Asked for 2000000 with 2330500 owed; then the client paid the 330500 it does not hold, leaving 2000000.
  const big = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '2000000', reason: REASON, digest: issued.invoice.digest });
  const before = await env.rowOf(big.creditNote.rowId);
  assert.deepEqual(before.change, { label: 'Left to pay on INV-0001', before: 'INR 23,305.00', after: 'INR 3,305.00', receiptId: `credit-balance:${big.creditNote.id}` });
  await env.pay({ invoiceId: issued.invoice.id, amount: '3305', receivedOn: '2026-10-20', method: 'upi' });
  const stale = await env.decide(before, 'issue');
  assert.equal(stale.outcome, 'stale');
  assert.deepEqual(stale.latest?.change, { label: 'Left to pay on INV-0001', before: 'INR 20,000.00', after: 'INR 0.00', receiptId: `credit-balance:${big.creditNote.id}` });
  assert.equal(listRecords(env.store.read(), 'venture-credit-note')[1].status, 'waiting', 'a stale click issued nothing');
  const done = await env.decide(stale.latest!, 'issue');
  assert.equal(done.line, 'Issued credit note CN-0001. INV-0001 is settled.');
  // Review 2.3: a credit note that brings the balance to nothing settles the invoice, as a payment in full would.
  assert.deepEqual([(await env.get(issued.invoice.id)).invoice.balanceMinor, (await env.get(issued.invoice.id)).invoice.status], ['0', 'paid']);
});

test('an order\'s quote becomes one invoice, once', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await assert.rejects(env.money('venture.invoice.prepare', { orderId: issued.invoice.orderId }), code('QUOTE_ALREADY_INVOICED'));
  assert.equal(listRecords(env.store.read(), 'venture-invoice').length, 1);
});

test('a cheque is pending until you clear it: not received, not in the books, but held against the balance', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  const id = issued.invoice.id;
  const cheque = await env.pay({ invoiceId: id, amount: '23,305', receivedOn: '2026-10-20', method: 'cheque' });
  assert.deepEqual([cheque.payments[0].state, cheque.payments[0].factId, cheque.invoice.balanceMinor, cheque.invoice.status], ['pending', null, '2330500', 'issued']);
  assert.equal(env.store.read().facts.filter(fact => fact.kind === 'payment').length, 0);
  assert.equal(receivedPlan(env.store.read(), env.venture, '2026-10-01', '2026-10-31').addends.length, 0, 'only cleared money is received');
  await assert.rejects(env.pay({ invoiceId: id, amount: '1', receivedOn: '2026-10-21', method: 'upi' }), code('PAYMENT_TOO_LARGE'));
  assert.equal(cheque.next?.action, 'clear');

  await assert.rejects(env.money('venture.payment.clear', { paymentId: cheque.payments[0].id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.money('venture.payment.clear', { paymentId: 'payment_missing' }), code('INVALID_VENTURE_REQUEST'));
  const cleared = await env.money<InvoiceView>('venture.payment.clear', { paymentId: cheque.payments[0].id });
  const payment = cleared.payments[0];
  // Cleared today, 23 October on the owner's calendar: the money counts from that day.
  assert.deepEqual([payment.state, payment.receivedOn, payment.chequeOn, cleared.invoice.balanceMinor, cleared.invoice.status], ['cleared', '2026-10-23', '2026-10-20', '0', 'paid']);
  const facts = env.store.read().facts.filter(fact => fact.kind === 'payment');
  assert.deepEqual(facts.map(fact => [fact.fields.amountMinor, fact.validFrom, fact.fields.paymentMethod]), [['2330500', '2026-10-23', 'cheque']]);
  assert.equal(env.deps.services.calculator.receipt(owner, payment.booksReceiptId!).totalMinor, '2330500');
  assert.equal(receivedPlan(env.store.read(), env.venture, '2026-10-01', '2026-10-31').addends.length, 1);
  await assert.rejects(env.money('venture.payment.clear', { paymentId: payment.id }), code('INVALID_VENTURE_REQUEST'));
});

test('a payment recorded before 4J5 has no state and reads as cleared: received, and in the timeline as paid', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: issued.invoice.id, amount: '5000', receivedOn: '2026-10-05', method: 'upi' });
  const [payment] = listRecords(env.store.read(), 'venture-payment');
  assert.equal(Object.hasOwn(payment, 'state'), false, 'stored as every payment was before');
  assert.deepEqual(receivedPlan(env.store.read(), env.venture, '2026-10-05', '2026-10-05').addends.map(item => item.amount), ['500000']);
  assert.deepEqual((await env.get(issued.invoice.id)).timeline?.map(item => item.what), ['issued', 'paid', 'awaiting']);
});

test('a bank row that pays a pending cheque clears it, never a second payment', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: issued.invoice.id, amount: '23305', receivedOn: '2026-10-18', method: 'cheque' });
  await env.build<BankImportResult>('venture.bank.import', { csv: 'Date,Description,Amount,Counterparty\n2026-10-22,CHQ DEP INV-0001,23305.00,Cafe Aroma Demo\n', account: 'HDFC current' });
  const row = (await env.build<BankLedgerView>('venture.bank.ledger', {})).rows[0];
  await env.build('venture.bank.apply', { transactionId: row.id, as: 'payment', invoiceId: issued.invoice.id });
  const payments = listRecords(env.store.read(), 'venture-payment');
  assert.equal(payments.length, 1);
  assert.deepEqual([payments[0].state, payments[0].receivedOn, payments[0].chequeOn, payments[0].bankTransactionId], ['cleared', '2026-10-22', '2026-10-18', row.id]);
  assert.equal((await env.get(issued.invoice.id)).invoice.status, 'paid');
});

test('one payment split across invoices: each part its own record, never more than the payment or a balance', async () => {
  const env = await business();
  const a = await invoice(env, '1', '2026-10-01');
  const b = await invoice(env, '1', '2026-10-02');
  const split = (amount: string, parts: { invoiceId: string; amount: string }[]) => env.pay({ amount, allocations: parts, receivedOn: '2026-10-20', method: 'bank-transfer' });
  await assert.rejects(split('30000', [{ invoiceId: a.invoice.id, amount: '23305' }, { invoiceId: b.invoice.id, amount: '6696' }]), code('PAYMENT_TOO_LARGE')); // parts 30001 > 30000
  await assert.rejects(split('30000', [{ invoiceId: a.invoice.id, amount: '23305.01' }, { invoiceId: b.invoice.id, amount: '6694.99' }]), code('PAYMENT_TOO_LARGE')); // over INV-0001's balance
  await assert.rejects(split('30000', [{ invoiceId: a.invoice.id, amount: '23305' }, { invoiceId: b.invoice.id, amount: '6694' }]), code('INVALID_AMOUNT')); // parts 29999 < 30000
  await assert.rejects(split('30000', [{ invoiceId: a.invoice.id, amount: '15000' }, { invoiceId: a.invoice.id, amount: '15000' }]), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.pay({ invoiceId: a.invoice.id, amount: '30000', allocations: [{ invoiceId: a.invoice.id, amount: '30000' }], receivedOn: '2026-10-20', method: 'upi' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-payment').length, 0, 'a refused split writes nothing');

  // 3000000 = 2330500 for INV-0001 in full and 669500 for INV-0002, leaving 2330500 - 669500 = 1661000.
  const view = await split('30000', [{ invoiceId: a.invoice.id, amount: '23305' }, { invoiceId: b.invoice.id, amount: '6695' }]);
  assert.equal(view.invoice.id, a.invoice.id);
  const payments = listRecords(env.store.read(), 'venture-payment');
  assert.deepEqual(payments.map(item => [item.invoiceId, item.amountMinor, item.split?.totalMinor]), [[a.invoice.id, '2330500', '3000000'], [b.invoice.id, '669500', '3000000']]);
  assert.equal(payments[0].split?.groupId, payments[1].split?.groupId);
  assert.deepEqual([(await env.get(a.invoice.id)).invoice.status, (await env.get(b.invoice.id)).invoice.balanceMinor], ['paid', '1661000']);
  const received = receivedPlan(env.store.read(), env.venture, '2026-10-20', '2026-10-20');
  assert.deepEqual(received.addends.map(item => item.amount), ['2330500', '669500']);
});

test('a cheque split across invoices waits as one: clearing it clears every part', async () => {
  const env = await business();
  const a = await invoice(env, '1', '2026-10-01');
  const b = await invoice(env, '1', '2026-10-02');
  await env.pay({ amount: '46610', allocations: [{ invoiceId: a.invoice.id, amount: '23305' }, { invoiceId: b.invoice.id, amount: '23305' }], receivedOn: '2026-10-21', method: 'cheque' });
  const parts = listRecords(env.store.read(), 'venture-payment');
  assert.deepEqual(parts.map(item => item.state), ['pending', 'pending']);
  assert.deepEqual([(await env.get(a.invoice.id)).invoice.balanceMinor, (await env.get(b.invoice.id)).invoice.balanceMinor], ['2330500', '2330500']);
  const cleared = await env.money<InvoiceView>('venture.payment.clear', { paymentId: parts[1].id });
  assert.equal(cleared.invoice.id, b.invoice.id);
  assert.deepEqual(listRecords(env.store.read(), 'venture-payment').map(item => [item.state, item.receivedOn, item.chequeOn]), [['cleared', '2026-10-23', '2026-10-21'], ['cleared', '2026-10-23', '2026-10-21']]);
  assert.deepEqual([(await env.get(a.invoice.id)).invoice.status, (await env.get(b.invoice.id)).invoice.status], ['paid', 'paid']);
  assert.equal(env.store.read().facts.filter(fact => fact.kind === 'payment').length, 2);
});

/** A second client with an issued invoice of their own, to prove a statement shows one client only. */
async function otherClient(env: GoalEnv) {
  const other = await env.money<{ id: string }>('venture.client.add', { name: 'Brew Lab Demo', countryCode: 'IN', stateCode: '27' });
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: other.id, offerId: 'offer_1', request: 'Close the month of books.' });
  const prepared = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-03' });
  return env.money<InvoiceView>('venture.invoice.issue', { invoiceId: prepared.invoice.id, digest: prepared.invoice.digest });
}

test('clientStatement: one client\'s open invoices, paid so far and credit notes, each total with its receipt', async () => {
  const env = await business();
  const a = await invoice(env, '1', '2026-09-01'); // INV-0001, due 16 Sep
  const b = await invoice(env, '1', '2026-10-01'); // INV-0002, due 16 Oct
  await invoice(env, '1', '2026-10-05', true); // a draft: never on a statement
  await otherClient(env); // INV-0003, someone else's
  await env.pay({ invoiceId: a.invoice.id, amount: '23305', receivedOn: '2026-09-20', method: 'upi' }); // INV-0001 paid in full
  await env.pay({ invoiceId: b.invoice.id, amount: '5000', receivedOn: '2026-10-10', method: 'upi' }); // 500000 of INV-0002
  await env.pay({ invoiceId: b.invoice.id, amount: '1000', receivedOn: '2026-10-12', method: 'cheque' }); // pending: not paid yet
  const asked = await env.credit({ invoiceId: b.invoice.id, amountMinor: '233050', reason: REASON, digest: b.invoice.digest });
  await env.decide(await env.rowOf(asked.creditNote.rowId), 'issue');

  const statement = clientStatement(env.store.read(), env.client.id, '2026-10-23');
  assert.deepEqual([statement.client.name, statement.currency, statement.asOf], ['Cafe Aroma Demo', 'INR', '2026-10-23']);
  // INV-0002: 2330500 - 500000 paid - 233050 credited = 1597450 (INR 15,974.50).
  assert.deepEqual(statement.open.map(item => [item.number, item.dueDate, item.total, item.paid, item.credited, item.balance, item.late]),
    [['INV-0002', '2026-10-16', 'INR 23,305.00', 'INR 5,000.00', 'INR 2,330.50', 'INR 15,974.50', '7 days late']]);
  assert.deepEqual(statement.paid.map(item => [item.number, item.receivedOn, item.amount]), [['INV-0001', '2026-09-20', 'INR 23,305.00'], ['INV-0002', '2026-10-10', 'INR 5,000.00']]);
  assert.deepEqual(statement.waiting.map(item => [item.number, item.amount, item.line]), [['INV-0002', 'INR 1,000.00', 'Cheque received on 12 Oct 2026, waiting to clear.']]);
  assert.deepEqual(statement.credits.map(item => [item.number, item.invoiceNumber, item.amount, item.reason]), [['CN-0001', 'INV-0002', 'INR 2,330.50', REASON]]);
  assert.deepEqual([statement.owed.display, statement.paidTotal.display, statement.creditedTotal.display], ['INR 15,974.50', 'INR 28,305.00', 'INR 2,330.50']);
  assert.ok(!JSON.stringify(statement).includes('Brew Lab Demo'), 'another client never shows');

  const sealed = await statementReceipts(env.deps, owner, statement);
  const total = async (id: string) => (await env.money<SumReceiptRecord>('venture.receipt.get', { id })).totalMinor;
  // 2330500 + 500000 = 2830500 paid; 233050 credited; 1597450 owed.
  assert.deepEqual([await total(sealed.owed), await total(sealed.paid), await total(sealed.credited)], ['1597450', '2830500', '233050']);
  assert.throws(() => clientStatement(env.store.read(), 'client_missing', '2026-10-23'), code('CLIENT_NOT_FOUND'));
});

// ---------------------------------------------------------------------------
// The integrator's review (4J5)
// ---------------------------------------------------------------------------

test('a payment shows on Today as the client paid until you mark it seen; a cheque only once it clears; a week on it is gone', async () => {
  const env = await business();
  const a = await invoice(env, '1', '2026-10-01');
  const b = await invoice(env, '1', '2026-10-02');
  const paidRows = async () => (await env.rows()).filter(row => row.id.startsWith('paid:'));
  await env.pay({ invoiceId: a.invoice.id, amount: '5000', receivedOn: '2026-10-20', method: 'upi' });
  const [row] = await paidRows();
  const payment = listRecords(env.store.read(), 'venture-payment')[0];
  assert.deepEqual([row.kind, row.title, row.line], ['notice', 'Cafe Aroma Demo paid INV-0001', 'Part paid by UPI on 20 Oct 2026. The rest is still to pay.']);
  assert.deepEqual(row.change, { label: 'Received', after: 'INR 5,000.00', receiptId: payment.booksReceiptId });
  assert.deepEqual(row.actions, [{ id: 'later', label: 'Later', primary: false }, { id: 'approve', label: 'Seen', primary: true }]);
  assert.equal((await env.decide(row, 'approve')).line, 'Marked as seen.');
  assert.equal((await paidRows()).length, 0);
  // A credit note that settles the rest (2330500 - 500000 = 1830500) changes the words, never brings the seen row back.
  const rest = await env.credit({ invoiceId: a.invoice.id, amountMinor: '1830500', reason: REASON, digest: a.invoice.digest });
  await env.decide(await env.rowOf(rest.creditNote.rowId), 'issue');
  assert.equal((await paidRows()).length, 0, 'a seen row stays seen');

  await env.pay({ invoiceId: b.invoice.id, amount: '23305', receivedOn: '2026-10-21', method: 'cheque' });
  assert.equal((await paidRows()).length, 0, 'a cheque waiting to clear is not money in yet');
  const cheque = listRecords(env.store.read(), 'venture-payment').find(item => item.state === 'pending')!;
  await env.money('venture.payment.clear', { paymentId: cheque.id });
  const [cleared] = await paidRows();
  assert.deepEqual([cleared.title, cleared.line], ['Cafe Aroma Demo paid INV-0002', 'Paid in full by cheque, cleared on 23 Oct 2026.']);
  env.advance(8 * DAY);
  assert.equal((await paidRows()).length, 0, 'a week on, it has left Today');
  // A business still in its interview has no country: the money source has nothing to say.
  assert.deepEqual(moneyRows(env.deps, owner, env.store.read(), { ...env.venture, country: null } as never), []);
});

test('a payment row keeps its id when a credit note settles the rest, and says the invoice was settled with a credit note', async () => {
  const env = await business();
  const a = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: a.invoice.id, amount: '5000', receivedOn: '2026-10-20', method: 'upi' });
  const [before] = (await env.rows()).filter(row => row.id.startsWith('paid:'));
  const rest = await env.credit({ invoiceId: a.invoice.id, amountMinor: '1830500', reason: REASON, digest: a.invoice.digest });
  await env.decide(await env.rowOf(rest.creditNote.rowId), 'issue');
  const [after] = (await env.rows()).filter(row => row.id.startsWith('paid:'));
  assert.equal(after.id, before.id);
  assert.equal(after.line, 'Part paid by UPI on 20 Oct 2026. The invoice was settled with a credit note.');
});

test('a deposit that pays a cheque waiting on an invoice is suggested as that cheque, and recording it clears the cheque', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: issued.invoice.id, amount: '23305', receivedOn: '2026-10-21', method: 'cheque' });
  await env.build<BankImportResult>('venture.bank.import', { csv: 'Date,Description,Amount,Counterparty\n2026-10-22,CHQ DEP INV-0001,23305.00,Cafe Aroma Demo\n', account: 'HDFC current' });
  const [row] = (await env.build<BankLedgerView>('venture.bank.ledger', {})).rows;
  assert.deepEqual([row.classification, row.flag, row.suggestion?.line], ['suggested-payment', null, 'Pays the cheque waiting on INV-0001.']);
  const bankRow = (await env.rows()).find(item => item.kind === 'bank')!;
  await env.decide(bankRow, 'approve');
  const payments = listRecords(env.store.read(), 'venture-payment');
  assert.deepEqual(payments.map(item => [item.state, item.receivedOn, item.chequeOn]), [['cleared', '2026-10-22', '2026-10-21']]);
});

test('a credit note that settles an invoice makes it paid, and Total, Paid, Credited and Balance add up on the view and the document', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: issued.invoice.id, amount: '13305', receivedOn: '2026-10-05', method: 'upi' }); // 1330500 paid, 1000000 left
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '1000000', reason: REASON, digest: issued.invoice.digest });
  await env.decide(await env.rowOf(asked.creditNote.rowId), 'issue');
  const view = await env.get(issued.invoice.id);
  assert.equal(view.invoice.status, 'paid');
  // 1330500 + 1000000 + 0 = 2330500.
  assert.deepEqual(view.figures.filter(item => ['total', 'paid', 'credited', 'balance'].includes(item.key)).map(item => [item.key, item.label, item.display]), [
    ['total', 'Total', 'INR 23,305.00'], ['paid', 'Paid', 'INR 13,305.00'], ['credited', 'Credited', 'INR 10,000.00'], ['balance', 'Balance', 'INR 0.00'],
  ]);
  assert.match(view.documentText, /\nTotal {2}INR 23,305\.00\nPaid {2}INR 13,305\.00\nCredited {2}INR 10,000\.00\nBalance {2}INR 0\.00\n/);
  assert.deepEqual(view.next, { action: 'none', line: 'Settled: paid and credited.' });
});

test('a cheque with TDS shows the cheque\'s own amount, the TDS named apart, on your views and on the client\'s statement', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  // The cheque is 2133000 (INR 21,330.00); the client deducted 197500 (INR 1,975.00) under 194J.
  const view = await env.pay({ invoiceId: issued.invoice.id, amount: '21330', tds: { section: '194J', amount: '1975' }, receivedOn: '2026-10-20', method: 'cheque' });
  assert.equal(view.next?.line, 'A cheque for INR 21,330.00 is waiting to clear, with TDS INR 1,975.00 under 194J. Mark it cleared once it is in your bank.');
  assert.equal(view.timeline?.find(item => item.what === 'cheque')?.line, 'Cheque for INR 21,330.00 received on 20 Oct 2026, waiting to clear, and TDS INR 1,975.00 under 194J');
  const statement = clientStatement(env.store.read(), env.client.id, '2026-10-23');
  assert.deepEqual(statement.waiting.map(item => [item.number, item.amount, item.tds, item.line]), [['INV-0001', 'INR 21,330.00', 'TDS INR 1,975.00 under 194J', 'Cheque received on 20 Oct 2026, waiting to clear.']]);
});

test('issuing a credit note goes through the action journal: one entry, applied once, bound to the note and the balance shown', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest });
  const row = await env.rowOf(asked.creditNote.rowId);
  await env.decide(row, 'issue');
  const entries = listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.action === 'credit.issue');
  assert.deepEqual(entries.map(entry => [entry.state, entry.subject, entry.target]), [['applied', asked.creditNote.id, 'Cafe Aroma Demo']]);
  assert.equal(entries[0].journal.at(-1)?.line, 'Issued credit note CN-0001. Cafe Aroma Demo now owes INR 20,974.50 on INV-0001.');
});

test('a balance that changes between the click and the claim is caught at the claim: nothing is issued and the card comes back', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest });
  const row = await env.rowOf(asked.creditNote.rowId);
  // A payment lands after the journal claimed the issue and before its commit, as a second window of the app could.
  const store = env.store as unknown as { update: (work: (state: State) => unknown) => Promise<unknown> };
  const update = store.update.bind(store);
  let paidBetween = false;
  store.update = async work => {
    const claimed = listRecords(env.store.read(), 'venture-journal-entry').some(entry => entry.action === 'credit.issue' && entry.state === 'approved' && entry.claimedAt !== null);
    if (claimed && !paidBetween) {
      paidBetween = true;
      await env.pay({ invoiceId: issued.invoice.id, amount: '1000', receivedOn: '2026-10-20', method: 'upi' });
    }
    return update(work);
  };
  const decision = await env.decide(row, 'issue');
  store.update = update;
  assert.equal(paidBetween, true);
  assert.equal(decision.outcome, 'stale');
  assert.equal(listRecords(env.store.read(), 'venture-credit-note')[0].status, 'waiting');
  assert.equal(env.store.read().facts.filter(fact => fact.kind === 'refund').length, 0);
  assert.deepEqual(listRecords(env.store.read(), 'venture-journal-entry').filter(entry => entry.action === 'credit.issue').map(entry => entry.state), ['rejected']);
  // The new card, with the new balance (2330500 - 100000 = 2230500), issues it.
  assert.equal(decision.latest?.change?.before, 'INR 22,305.00');
  assert.equal((await env.decide(decision.latest!, 'issue')).outcome, 'done');
});

test('the credit card\'s balances carry the invoice\'s balance receipt: its total, less what was paid, less this credit note', async () => {
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  await env.pay({ invoiceId: issued.invoice.id, amount: '5000', receivedOn: '2026-10-20', method: 'upi' });
  const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest });
  const row = await env.rowOf(asked.creditNote.rowId);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: row.change!.receiptId! });
  // 2330500 - 500000 = 1830500 now (INR 18,305.00); less 233050: 1597450 after (INR 15,974.50).
  assert.deepEqual(receipt.figures.map(item => [item.key, item.label, item.display]), [['balance', 'Left to pay on INV-0001 now', 'INR 18,305.00'], ['total', 'Left to pay after this credit note', 'INR 15,974.50']]);
  assert.deepEqual(receipt.addends.map(item => [item.label, item.amount]), [['INV-0001 total', '2330500'], ['Less paid on INV-0001, 20 Oct 2026', '-500000'], ['Less this credit note, waiting for you to issue it', '-233050']]);
  assert.equal(receipt.stale, false);
  await env.decide(row, 'issue');
  assert.equal((await env.money<SumReceiptRecord>('venture.receipt.get', { id: row.change!.receiptId! })).stale, true);
});

test('credit notes that credit an invoice in full add up exactly before tax: the last one takes the rest', async () => {
  // Shares of 100, 100 and 2330300 at 1975000 / 2330500 are 85, 85 and 1974831, one paisa over 1975000 together; the last
  // takes the rest instead: 1975000 - 85 - 85 = 1974830.
  const env = await business();
  const issued = await invoice(env, '1', '2026-10-01');
  for (const amountMinor of ['100', '100', '2330300']) {
    const asked = await env.credit({ invoiceId: issued.invoice.id, amountMinor, reason: REASON, digest: issued.invoice.digest });
    await env.decide(await env.rowOf(asked.creditNote.rowId), 'issue');
  }
  assert.deepEqual(env.store.read().facts.filter(fact => fact.kind === 'refund').map(fact => fact.fields.amountMinor), ['85', '85', '1974830']);
  assert.equal((await env.money<GoalView>('venture.goals.get')).invoiced.display, 'INR 0.00');
});

test('through VentureHost.request: issue an invoice, record a payment, ask for a credit note and issue it on Today', async () => {
  const env = await business();
  const host = new VentureHost(env.store, env.deps.services, { demo: true, storage: 'experimental-file', clock: env.deps.clock, host: 'test', workspace: env.workspace });
  try {
    const order = await host.request(owner, 'venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Close the month of books.' }) as OrderRecord;
    const draft = await host.request(owner, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01' }) as InvoiceView;
    const issued = await host.request(owner, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest }) as InvoiceView;
    await host.request(owner, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '5000', receivedOn: '2026-10-20', method: 'upi' });
    await assert.rejects(host.request(phone, 'venture.credit.issue', { invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest }), code('APP_APPROVAL_REQUIRED'));
    const asked = await host.request(owner, 'venture.credit.issue', { invoiceId: issued.invoice.id, amountMinor: '233050', reason: REASON, digest: issued.invoice.digest }) as { creditNote: CreditNoteView };
    const row = (await host.request(owner, 'venture.queue.list', {}) as QueueList).rows.find(item => item.id === asked.creditNote.rowId)!;
    const done = await host.request(owner, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' }) as QueueDecision;
    assert.equal(done.outcome, 'done');
    // 2330500 - 500000 - 233050 = 1597450.
    assert.equal((await host.request(owner, 'venture.invoice.get', { invoiceId: issued.invoice.id }) as InvoiceView).invoice.balanceMinor, '1597450');
  } finally {
    host.close();
  }
});
