// Ink v2 wave 2, package 2D: imported bank statements feed the books. Transfers between the owner's own accounts are
// paired and never count as income or spending; a money-in row that names an issued invoice by whole word is suggested as
// its payment; the owner records it as a payment, adds money out as a cost, or skips it, once per row, inside the app.
// Every amount below is worked out by hand in a comment, never by the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  BankApplyResult, BankImportResult, BankLedgerView, BooksSummary, InvoiceRecord, QueueDecision, QueueList, VentureDeps,
} from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { handlers as viewHandlers } from '../runtime/venture/views/index.ts';
import { code, owner, phone, seedBlueprint, setup, type Env } from './venture-views-env.ts';

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const TABLES = [buildHandlers, moneyHandlers, viewHandlers] as Record<string, Handler | undefined>[];
function run<T>(env: Env, method: string, payload: unknown = {}, ctx: Context = owner): Promise<T> {
  const handler = TABLES.map(table => table[method]).find(Boolean);
  assert.ok(handler, `no handler for ${method}`);
  return handler(env.deps, ctx, payload) as Promise<T>;
}

const HEADER = 'Date,Description,Amount,Counterparty\n';
const statement = (...rows: string[]) => `${HEADER}${rows.join('\n')}\n`;
const importInto = (env: Env, account: string, csv: string) => run<BankImportResult>(env, 'venture.bank.import', { csv, account });
const ledger = (env: Env, payload: Record<string, unknown> = {}) => run<BankLedgerView>(env, 'venture.bank.ledger', payload);
const rowOf = (view: BankLedgerView, description: string) => {
  const found = view.rows.find(row => row.description === description);
  assert.ok(found, `no ledger row ${description}`);
  return found;
};

/**
 * One issued invoice, INV-0007: 10,000.00 a month with GST at 18% split CGST and SGST in Maharashtra (state 27 on both
 * sides). Each half = 1000000 x 900 / 10000 = 90000; tax 180000; total 1000000 + 180000 = 1180000 (INR 11,800.00).
 */
async function invoiceSeven(env: Env): Promise<InvoiceRecord> {
  await seedBlueprint(env, { price1: '1000000' });
  const client = await run<{ id: string }>(env, 'venture.client.add', { name: 'Asha Rao Studio', countryCode: 'IN', stateCode: '27' });
  const order = await run<{ id: string }>(env, 'venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Monthly books for October, please.' });
  await ventureAction(env.deps, owner, 'admin', 'seed.sequence', tx => { tx.touch({ invoiceSequence: 6 }); });
  const draft = await run<{ invoice: InvoiceRecord }>(env, 'venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 });
  const issued = await run<{ invoice: InvoiceRecord }>(env, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
  assert.equal(issued.invoice.number, 'INV-0007');
  assert.equal(issued.invoice.balanceMinor, '1180000');
  return issued.invoice;
}

test('the four new bank methods answer, and the two that change the books need the app', async () => {
  const env = await setup();
  for (const method of ['venture.bank.ledger', 'venture.bank.alerts.get']) await run(env, method, {});
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: 'fp_0000000000000000', as: 'skip' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(run(env, 'venture.bank.alerts.set', { account: 'HDFC current', rules: [] }, phone), code('APP_APPROVAL_REQUIRED'));
});

test('own transfers: opposite amounts in two own accounts at most two days apart pair once; a named own account is a transfer too', async () => {
  const env = await setup();
  await importInto(env, 'HDFC current', statement(
    '2026-10-03,TRANSFER OUT,-20000.00,',
    '2026-10-05,CAFE SUPPLIES,-1500.00,Metro Wholesale',
    '2026-10-06,MOVE TO SAVINGS,-3000.00,SBI savings a/c',
    '2026-10-10,LONE OUT,-7000.00,',
    '2026-10-20,EDGE OUT,-5000.00,',
  ));
  await importInto(env, 'SBI savings', statement(
    '2026-10-04,TRANSFER IN,20000.00,',
    '2026-10-06,TRANSFER IN AGAIN,20000.00,',
    '2026-10-13,LONE IN,7000.00,',
    '2026-10-22,EDGE IN,5000.00,',
  ));
  const view = await ledger(env);
  assert.deepEqual(view.accounts.map(account => account.label), ['HDFC current', 'SBI savings']);
  const out = rowOf(view, 'TRANSFER OUT'), into = rowOf(view, 'TRANSFER IN');
  assert.deepEqual([out.classification, into.classification], ['own-transfer', 'own-transfer']);
  assert.equal(out.pairedWith, into.id);
  assert.equal(into.pairedWith, out.id);
  assert.deepEqual([out.direction, out.amount, out.dateDisplay, into.direction, into.amount], ['out', 'INR 20,000.00', '03 Oct 2026', 'in', 'INR 20,000.00']);
  // The second 20,000.00 has nothing left to pair with: the one it could have paired with is taken.
  const later = rowOf(view, 'TRANSFER IN AGAIN');
  assert.deepEqual([later.classification, later.pairedWith], ['money-in', null]);
  // A lone opposite row three days away is not a transfer; exactly two days apart is.
  assert.deepEqual([rowOf(view, 'LONE OUT').classification, rowOf(view, 'LONE IN').classification], ['money-out', 'money-in']);
  assert.equal(rowOf(view, 'EDGE OUT').pairedWith, rowOf(view, 'EDGE IN').id);
  // The counterparty names the owner's own SBI savings account (two words): a transfer, with nothing to pair it with.
  const named = rowOf(view, 'MOVE TO SAVINGS');
  assert.deepEqual([named.classification, named.pairedWith], ['own-transfer', null]);
  assert.equal(rowOf(view, 'CAFE SUPPLIES').classification, 'money-out');

  for (const as of ['payment', 'cost'] as const) {
    await assert.rejects(run(env, 'venture.bank.apply', { transactionId: out.id, as }), code('BANK_OWN_TRANSFER'));
    await assert.rejects(run(env, 'venture.bank.apply', { transactionId: named.id, as }), code('BANK_OWN_TRANSFER'));
  }
  // The ledger narrows to one account or one month.
  assert.deepEqual((await ledger(env, { account: 'sbi SAVINGS' })).rows.map(row => row.description), ['TRANSFER IN', 'TRANSFER IN AGAIN', 'LONE IN', 'EDGE IN']);
  assert.equal((await ledger(env, { month: '2026-09' })).rows.length, 0);
  await assert.rejects(ledger(env, { month: '2026-13' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(ledger(env, { account: 'Nowhere' }), code('BANK_ACCOUNT_NOT_FOUND'));
  assert.match(view.provider, /No bank provider is linked yet/);
});

test('a one-word account label names a transfer only when the counterparty is exactly that label: SBI is not SBI Cards', async () => {
  const env = await setup();
  await importInto(env, 'SBI', statement('2026-10-01,OPENING CREDIT,100.00,'));
  await importInto(env, 'HDFC current', statement(
    '2026-10-05,CARD BILL,-4000.00,SBI Cards',
    '2026-10-06,TOP UP,-3000.00,sbi',
  ));
  const view = await ledger(env);
  assert.equal(rowOf(view, 'CARD BILL').classification, 'money-out');
  assert.deepEqual([rowOf(view, 'TOP UP').classification, rowOf(view, 'TOP UP').pairedWith], ['own-transfer', null]);
});

test('a transfer whose second leg arrives after the first was added as a cost: the new leg is a transfer, the recorded one is flagged', async () => {
  const env = await setup();
  await importInto(env, 'HDFC current', statement('2026-10-03,TRANSFER OUT,-20000.00,'));
  const [first] = (await ledger(env)).rows;
  assert.equal(first.classification, 'money-out');
  await run(env, 'venture.bank.apply', { transactionId: first.id, as: 'cost' });
  await importInto(env, 'SBI savings', statement('2026-10-04,TRANSFER IN,20000.00,'));
  const view = await ledger(env);
  const out = rowOf(view, 'TRANSFER OUT'), into = rowOf(view, 'TRANSFER IN');
  assert.deepEqual([out.classification, out.decided, out.pairedWith], ['applied', 'cost', into.id]);
  assert.match(out.flag ?? '', /between your own accounts/);
  assert.deepEqual([into.classification, into.pairedWith], ['own-transfer', out.id]);
  for (const as of ['payment', 'cost'] as const) await assert.rejects(run(env, 'venture.bank.apply', { transactionId: into.id, as }), code('BANK_OWN_TRANSFER'));
});

test('a part payment the owner typed is not suggested again when the same money arrives on the statement', async () => {
  const env = await setup();
  const invoice = await invoiceSeven(env);
  // The owner typed 5,000.00 by UPI on 5 Oct; the statement shows the same 5,000.00 that day, and a second one.
  await run(env, 'venture.payment.record', { invoiceId: invoice.id, amount: '5000.00', receivedOn: '2026-10-05', method: 'upi' });
  await importInto(env, 'HDFC current', statement(
    '2026-10-05,UPI INV-0007 ASHA,5000.00,',
    '2026-10-05,UPI INV-0007 ASHA AGAIN,5000.00,',
  ));
  const view = await ledger(env);
  const typed = rowOf(view, 'UPI INV-0007 ASHA');
  assert.deepEqual([typed.classification, typed.suggestion], ['money-in', null]);
  assert.equal(typed.flag, 'Already recorded as a payment of INV-0007.');
  // One typed payment covers one statement row: the second 5,000.00 is a payment of its own.
  // 1180000 - 500000 = 680000 left, so 500000 more leaves 180000 (INR 1,800.00).
  const again = rowOf(view, 'UPI INV-0007 ASHA AGAIN');
  assert.equal(again.classification, 'suggested-payment');
  assert.equal(again.suggestion?.line, 'Pays part of INV-0007. INR 1,800.00 would be left.');
  const today = (await run<QueueList>(env, 'venture.queue.list', {})).rows.filter(row => row.kind === 'bank');
  assert.equal(today.length, 1, 'only the second row asks to be recorded');
  assert.match(today[0].title, /INR 5,000\.00 from 05 Oct 2026/);
});

test('the same statement file is never imported into a second account; one row both files share keeps its own id per account', async () => {
  const env = await setup();
  const csv = statement('2026-10-05,CAFE SUPPLIES,-1500.00,Metro Wholesale');
  await importInto(env, 'HDFC current', csv);
  await assert.rejects(importInto(env, 'Petty cash', csv), (error: any) => {
    assert.equal(error.code, 'BANK_STATEMENT_INVALID');
    assert.equal(error.message, 'This file is already imported into HDFC current. Import each statement into its own account.');
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-bank-import').length, 1);
  // A different file that holds one identical row: two rows, each with its account's id; deciding one leaves the other.
  await importInto(env, 'Petty cash', statement('2026-10-05,CAFE SUPPLIES,-1500.00,Metro Wholesale', '2026-10-06,TEA,-40.00,'));
  const rows = (await ledger(env)).rows.filter(row => row.description === 'CAFE SUPPLIES');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.ok(rows.every(row => row.id.startsWith(`${row.accountId}:`)));
  await run(env, 'venture.bank.apply', { transactionId: rows[0].id, as: 'cost' });
  assert.deepEqual((await ledger(env)).rows.filter(row => row.description === 'CAFE SUPPLIES').map(row => row.decided), ['cost', null]);
});

test('off the app channel the ledger leaves out descriptions and counterparties', async () => {
  const env = await setup();
  await importInto(env, 'HDFC current', statement('2026-10-05,RENT TO MR SHARMA,-25000.00,R Sharma'));
  const inApp = await ledger(env);
  assert.deepEqual([inApp.rows[0].description, inApp.rows[0].counterparty], ['RENT TO MR SHARMA', 'R Sharma']);
  for (const ctx of [phone, { ...owner, channel: 'mcp' as const }, { ...owner, sourceTainted: true }]) {
    const away = await run<BankLedgerView>(env, 'venture.bank.ledger', {}, ctx);
    assert.deepEqual([away.rows[0].description, away.rows[0].counterparty, away.rows[0].amount], [null, null, 'INR 25,000.00']);
    assert.ok(!JSON.stringify(away).includes('Sharma'));
  }
});

test('invoice match by whole word: full and part payments are suggested, a longer number and money out never are', async () => {
  const env = await setup();
  const invoice = await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement(
    '2026-10-04,NEFT/INV-0007/Asha Rao,11800.00,',
    '2026-10-04,NEFT/INV-00071/Someone Else,11800.00,',
    '2026-10-05,UPI part payment,5000.00,inv-0007',
    '2026-10-06,REFUND INV-0007,-11800.00,',
  ));
  const view = await ledger(env);
  const full = rowOf(view, 'NEFT/INV-0007/Asha Rao');
  assert.equal(full.classification, 'suggested-payment');
  assert.deepEqual(full.suggestion, { invoiceId: invoice.id, number: 'INV-0007', line: 'Pays INV-0007 in full.' });
  assert.deepEqual([rowOf(view, 'NEFT/INV-00071/Someone Else').classification, rowOf(view, 'NEFT/INV-00071/Someone Else').suggestion], ['money-in', null]);
  // 1180000 - 500000 = 680000 (INR 6,800.00) would be left.
  const part = rowOf(view, 'UPI part payment');
  assert.equal(part.classification, 'suggested-payment');
  assert.equal(part.suggestion?.line, 'Pays part of INV-0007. INR 6,800.00 would be left.');
  const refund = rowOf(view, 'REFUND INV-0007');
  assert.deepEqual([refund.classification, refund.suggestion], ['money-out', null]);
  assert.equal(view.line, '4 transactions in 1 account. 2 transactions look like an invoice payment.');
});

test('venture.bank.apply as payment goes through the payment path once; the books show exactly that much more received', async () => {
  const env = await setup();
  const invoice = await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement(
    '2026-10-04,NEFT/INV-0007/Asha Rao,11800.00,',
    '2026-10-05,UPI part payment INV-0007,5000.00,',
    '2026-10-06,RENT OCTOBER,-25000.00,',
  ));
  const view = await ledger(env);
  const full = rowOf(view, 'NEFT/INV-0007/Asha Rao');
  const before = await run<BooksSummary>(env, 'venture.books.summary', { from: '2026-10-01', to: '2026-10-31' });
  const receivedBefore = BigInt(before.figures.find(f => f.operation === 'received')!.minor);

  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: full.id, as: 'payment', invoiceId: invoice.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const applied = await run<BankApplyResult>(env, 'venture.bank.apply', { transactionId: full.id, as: 'payment', invoiceId: invoice.id });
  assert.deepEqual([applied.row.classification, applied.row.decided], ['applied', 'payment']);
  assert.match(applied.line, /INV-0007/);
  assert.ok(applied.receiptId, 'the calculator receipt for the received money');

  const state = env.store.read();
  const [payment] = listRecords(state, 'venture-payment');
  assert.deepEqual([payment.amountMinor, payment.method, payment.receivedOn, payment.bankTransactionId, payment.invoiceId], ['1180000', 'bank-transfer', '2026-10-04', full.id, invoice.id]);
  assert.equal(payment.booksReceiptId, applied.receiptId);
  assert.equal(listRecords(state, 'venture-invoice').find(item => item.id === invoice.id)!.status, 'paid');
  const [match] = listRecords(state, 'venture-bank-match');
  assert.deepEqual([match.transactionId, match.as, match.invoiceId, match.paymentId], [full.id, 'payment', invoice.id, payment.id]);

  // Received goes up by exactly 1180000 (INR 11,800.00), with the calculator's receipt.
  const after = await run<BooksSummary>(env, 'venture.books.summary', { from: '2026-10-01', to: '2026-10-31' });
  const received = after.figures.find(f => f.operation === 'received')!;
  assert.equal(BigInt(received.minor) - receivedBefore, 1180000n);
  assert.equal(env.deps.services.calculator.receipt(owner, received.receiptId).totalMinor, received.minor);

  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: full.id, as: 'payment', invoiceId: invoice.id }), code('BANK_ALREADY_APPLIED'));
  // The invoice is paid now, so the part payment is more than its balance.
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: rowOf(view, 'UPI part payment INV-0007').id, as: 'payment', invoiceId: invoice.id }), code('PAYMENT_TOO_LARGE'));
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: rowOf(view, 'RENT OCTOBER').id, as: 'payment', invoiceId: invoice.id }), code('BANK_NOT_MONEY_IN'));
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: 'fp_0000000000000000', as: 'payment', invoiceId: invoice.id }), code('BANK_TRANSACTION_NOT_FOUND'));
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: full.id, as: 'refund' }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-payment').length, 1, 'nothing else was recorded');
});

test('venture.bank.apply as cost writes one cost fact the calculator counts; skip records the decision and the row stops being suggested', async () => {
  const env = await setup();
  await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement(
    '2026-10-06,RENT OCTOBER,-25000.00,Landlord',
    '2026-10-07,NEFT INV-0007,11800.00,',
  ));
  const view = await ledger(env);
  const rent = rowOf(view, 'RENT OCTOBER'), money = rowOf(view, 'NEFT INV-0007');
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: money.id, as: 'cost' }), code('BANK_NOT_MONEY_OUT'));

  const cost = await run<BankApplyResult>(env, 'venture.bank.apply', { transactionId: rent.id, as: 'cost' });
  assert.deepEqual([cost.row.classification, cost.row.decided], ['applied', 'cost']);
  const facts = env.store.read().facts.filter(fact => fact.kind === 'cost');
  assert.equal(facts.length, 1);
  // The statement's -2500000 is a cost of +2500000 (INR 25,000.00) on the row's date.
  assert.deepEqual([facts[0].validFrom, facts[0].fields.amountMinor, facts[0].fields.currency, facts[0].fields.description], ['2026-10-06', '2500000', 'INR', 'RENT OCTOBER']);
  const counted = await env.deps.services.calculator.calculate(owner, { operation: 'costs', period: { from: '2026-10-06', to: '2026-10-06' } });
  assert.equal(counted.totalMinor, '2500000');
  assert.equal(env.deps.services.calculator.receipt(owner, cost.receiptId!).totalMinor, '2500000');
  const [match] = listRecords(env.store.read(), 'venture-bank-match');
  assert.deepEqual([match.as, match.factId, match.paymentId], ['cost', facts[0].id, null]);

  const skipped = await run<BankApplyResult>(env, 'venture.bank.apply', { transactionId: money.id, as: 'skip' });
  assert.deepEqual([skipped.row.classification, skipped.row.decided, skipped.row.suggestion], ['skipped', 'skip', null]);
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: money.id, as: 'payment' }), code('BANK_ALREADY_APPLIED'));
  const today = await run<QueueList>(env, 'venture.queue.list', {});
  assert.equal(today.rows.filter(row => row.kind === 'bank').length, 0, 'a skipped row is never suggested on Today');
});

test('Today: each suggested match is one bank row, decided through venture.queue.decide; own transfers make no row', async () => {
  const env = await setup();
  const invoice = await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement(
    '2026-10-03,TRANSFER OUT,-11800.00,',
    '2026-10-04,NEFT/INV-0007/Asha Rao,11800.00,',
  ));
  await importInto(env, 'SBI savings', statement('2026-10-04,TRANSFER IN,11800.00,'));
  const today = await run<QueueList>(env, 'venture.queue.list', {});
  const bank = today.rows.filter(row => row.kind === 'bank');
  assert.equal(bank.length, 1, 'the transfer pair makes no row');
  const [row] = bank;
  assert.equal(row.title, 'Record INR 11,800.00 from 04 Oct 2026 as payment of INV-0007?');
  assert.equal(row.line, 'Pays INV-0007 in full.');
  assert.deepEqual(row.actions.map(item => [item.id, item.label, item.primary]), [['deny', 'Not this', false], ['approve', 'Record payment', true]]);

  const decided = await run<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', decided.line);
  assert.ok(decided.receiptId);
  const [payment] = listRecords(env.store.read(), 'venture-payment');
  assert.deepEqual([payment.invoiceId, payment.amountMinor, payment.method], [invoice.id, '1180000', 'bank-transfer']);
  assert.equal((await run<QueueList>(env, 'venture.queue.list', {})).rows.filter(item => item.kind === 'bank').length, 0);
});

test('Today: Not this leaves the books alone, and the row stays in the ledger for the owner to decide there', async () => {
  const env = await setup();
  await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement('2026-10-04,NEFT/INV-0007/Asha Rao,11800.00,'));
  const [row] = (await run<QueueList>(env, 'venture.queue.list', {})).rows.filter(item => item.kind === 'bank');
  const decided = await run<QueueDecision>(env, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'deny' });
  assert.equal(decided.outcome, 'done');
  assert.equal(listRecords(env.store.read(), 'venture-payment').length, 0);
  assert.equal(listRecords(env.store.read(), 'venture-bank-match').length, 0);
  assert.equal((await ledger(env)).rows[0].classification, 'suggested-payment');
  assert.equal((await run<QueueList>(env, 'venture.queue.list', {})).rows.filter(item => item.kind === 'bank').length, 0);
});

test('money in that names no invoice: the owner picks one; more than its balance is refused, the rest is recorded with its receipt', async () => {
  const env = await setup();
  const invoice = await invoiceSeven(env);
  await importInto(env, 'HDFC current', statement('2026-10-08,IMPS FROM ASHA,12000.00,', '2026-10-09,UPI FROM ASHA,800.00,'));
  const view = await ledger(env);
  const large = rowOf(view, 'IMPS FROM ASHA'), small = rowOf(view, 'UPI FROM ASHA');
  assert.deepEqual([large.classification, large.suggestion, small.classification], ['money-in', null, 'money-in']);
  // 1200000 is more than INV-0007's balance of 1180000.
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: large.id, as: 'payment', invoiceId: invoice.id }), (error: any) => {
    assert.equal(error.code, 'PAYMENT_TOO_LARGE');
    assert.match(error.message, /INR 11,800\.00/);
    return true;
  });
  assert.equal(listRecords(env.store.read(), 'venture-bank-match').length, 0, 'a refusal records nothing');
  await assert.rejects(run(env, 'venture.bank.apply', { transactionId: small.id, as: 'payment' }), code('INVALID_VENTURE_REQUEST'));
  const paid = await run<BankApplyResult>(env, 'venture.bank.apply', { transactionId: small.id, as: 'payment', invoiceId: invoice.id });
  assert.deepEqual([paid.row.classification, paid.row.decided], ['applied', 'payment']);
  assert.ok(paid.receiptId);
  // 1180000 - 80000 = 1100000 (INR 11,000.00) left on the invoice.
  assert.equal(listRecords(env.store.read(), 'venture-invoice').find(item => item.id === invoice.id)!.balanceMinor, '1100000');
  const skipped = await run<BankApplyResult>(env, 'venture.bank.apply', { transactionId: large.id, as: 'skip' });
  assert.equal(skipped.row.classification, 'skipped');
});
