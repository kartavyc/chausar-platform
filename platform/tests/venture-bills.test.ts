// Ink v2 wave 4, package 4J5 (M10): bills the business owes. A bill keeps each line's tax name and rate as it was; its
// states draft, posted, partial, paid and overdue come from its records and the owner's calendar; a payment the owner
// made is recorded, never sent, and becomes a cost fact the calculator's costs count; billsDue serves 4J4's cash ahead.
// A recurring bill's next one is drafted on schedule as an expected bill. Every amount is worked out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context, State } from '../runtime/contracts.ts';
import type { BankLedgerView, BillRecord, BillResult, BillsView, SumReceiptRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { billsDue } from '../runtime/venture/money/bills.ts';
import { runMoneySchedules } from '../runtime/venture/money/recurring.ts';
import { handlers as buildHandlers } from '../runtime/venture/build/index.ts';
import { DAY, goalBusiness } from './venture-goals-helpers.ts';
import { code, owner, phone, seedBlueprint } from './venture-views-env.ts';

/**
 * Metro Repairs' bill: a laptop repair of INR 5,000.00 with GST at 18% and a courier of INR 120.00 with no tax.
 * Tax on the repair = (500000 x 1800 + 5000) / 10000 = 90000 (INR 900.00); total 500000 + 90000 + 12000 = 602000
 * (INR 6,020.00). Before tax: 500000 + 12000 = 512000.
 */
const REPAIR = { description: 'Laptop repair', amountMinor: '500000', taxName: 'GST', taxRateBps: '1800' };
const COURIER = { description: 'Courier', amountMinor: '12000', taxName: '', taxRateBps: '0' };

async function business(options: { taxAssumed?: boolean } = {}) {
  const env = await goalBusiness(options);
  const bill = (payload: Record<string, unknown>, ctx: Context = owner) => env.money<BillResult>('venture.bills.add', payload, ctx);
  const pay = (billId: string, amountMinor: string, paidOn: string, ctx: Context = owner) =>
    env.money<BillResult>('venture.bills.pay', { billId, amountMinor, paidOn, method: 'upi' }, ctx);
  return { ...env, bill, pay };
}

test('bills.add keeps each line with its tax name and rate, works out the total in code and answers with the owed receipt', async () => {
  const env = await business();
  const added = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  assert.deepEqual(
    [added.bill.vendor, added.bill.billDate, added.bill.dueDate, added.bill.total, added.bill.paid, added.bill.balance, added.bill.state, added.bill.recurring],
    ['Metro Repairs', '2026-10-20', '2026-10-30', 'INR 6,020.00', 'INR 0.00', 'INR 6,020.00', 'posted', null],
  );
  const record = listRecords(env.store.read(), 'venture-bill').find(item => item.id === added.bill.id)!;
  assert.deepEqual(record.lines, [REPAIR, COURIER]);
  assert.deepEqual([record.totalMinor, record.paidMinor, record.currency, record.status], ['602000', '0', 'INR', 'posted']);
  // The receipt: what is owed on open bills, the one bill of INR 6,020.00.
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: added.receiptId });
  assert.deepEqual([receipt.totalMinor, receipt.addends.map(item => [item.label, item.amount])], ['602000', [['Metro Repairs, due 30 Oct 2026', '602000']]]);

  // A second bill: owed is now both. 250000 x 1200 = 300,000,000; + 5000, / 10000 = 30000; total 280000. 602000 + 280000 = 882000.
  const second = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: 'GST', taxRateBps: '1200' }], billDate: '2026-10-21', dueDate: '2026-11-05' });
  assert.equal(second.bill.total, 'INR 2,800.00');
  const list = await env.money<BillsView>('venture.bills.list');
  assert.deepEqual(list.bills.map(item => item.vendor), ['Metro Repairs', 'Cloud Host'], 'the nearest due date first');
  assert.equal(list.owed?.display, 'INR 8,820.00');
  const owed = await env.money<SumReceiptRecord>('venture.receipt.get', { id: list.owed!.receiptId });
  assert.equal(owed.totalMinor, '882000');
});

test('bills.add is the owner\'s inside the app and refuses lines it cannot keep', async () => {
  const env = await business();
  const ok = { vendor: 'Metro Repairs', lines: [REPAIR], billDate: '2026-10-20', dueDate: '2026-10-30' };
  await assert.rejects(env.bill(ok, phone), code('APP_APPROVAL_REQUIRED'));
  for (const [patch, expected] of [
    [{ vendor: '' }, 'INVALID_VENTURE_REQUEST'],
    [{ lines: [] }, 'INVALID_VENTURE_REQUEST'],
    [{ lines: [{ ...REPAIR, amountMinor: '-5' }] }, 'INVALID_AMOUNT'],
    [{ lines: [{ ...REPAIR, amountMinor: '0' }] }, 'INVALID_AMOUNT'],
    [{ lines: [{ ...REPAIR, amountMinor: '12.50' }] }, 'INVALID_AMOUNT'],
    [{ lines: [{ ...REPAIR, taxRateBps: '10001' }] }, 'INVALID_TAX_RATE'],
    [{ lines: [{ ...REPAIR, taxName: '' }] }, 'INVALID_VENTURE_REQUEST'],
    [{ lines: [{ ...REPAIR, extra: 'x' }] }, 'INVALID_VENTURE_REQUEST'],
    [{ dueDate: '2026-10-19' }, 'INVALID_VENTURE_REQUEST'],
    [{ recurring: 'weekly' }, 'INVALID_VENTURE_REQUEST'],
  ] as const) await assert.rejects(env.bill({ ...ok, ...patch }), code(expected), JSON.stringify(patch));
  assert.equal(listRecords(env.store.read(), 'venture-bill').length, 0);
});

test('states come from the records: posted, overdue after the due day, partial, then paid; a payment over the balance is refused', async () => {
  const env = await business();
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  await assert.rejects(env.pay(bill.id, '100', '2026-10-23', phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.pay(bill.id, '602001', '2026-10-23'), code('BILL_PAYMENT_TOO_LARGE')); // one paisa over 602000
  await assert.rejects(env.pay(bill.id, '0', '2026-10-23'), code('INVALID_AMOUNT'));
  await assert.rejects(env.pay('bill_missing', '100', '2026-10-23'), code('INVALID_VENTURE_REQUEST'));

  env.advance(8 * DAY); // 31 October in Kolkata: a day after the due day
  assert.equal((await env.money<BillsView>('venture.bills.list')).bills[0].state, 'overdue');
  // Half: 301000 of 602000. Left 301000; still overdue (late comes before part paid).
  const half = await env.pay(bill.id, '301000', '2026-10-31');
  assert.deepEqual([half.bill.paid, half.bill.balance, half.bill.state], ['INR 3,010.00', 'INR 3,010.00', 'overdue']);
  await assert.rejects(env.pay(bill.id, '301001', '2026-10-31'), code('BILL_PAYMENT_TOO_LARGE'));
  const rest = await env.pay(bill.id, '301000', '2026-10-31');
  assert.deepEqual([rest.bill.paid, rest.bill.balance, rest.bill.state], ['INR 6,020.00', 'INR 0.00', 'paid']);
  await assert.rejects(env.pay(bill.id, '1', '2026-10-31'), code('BILL_PAYMENT_TOO_LARGE'));

  // Paid before its due day and only in part: partial.
  const early = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '100000', taxName: '', taxRateBps: '0' }], billDate: '2026-10-25', dueDate: '2026-11-20' });
  const part = await env.pay(early.bill.id, '40000', '2026-10-31');
  assert.equal(part.bill.state, 'partial');
  assert.deepEqual(listRecords(env.store.read(), 'venture-bill').find(item => item.id === early.bill.id)!.payments.map(item => [item.amountMinor, item.paidOn, item.method]), [['40000', '2026-10-31', 'upi']]);
});

test('a bill payment is a cost fact without the GST you can claim back, and the calculator\'s costs receipt counts it', async () => {
  const env = await business();
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  // 301000 of 602000 before tax: (301000 x 512000 x 2 + 602000) / (2 x 602000) = 256000 (256,000.5 rounded down by the half up rule
  // on the doubled numerator); tax 301000 - 256000 = 45000.
  const half = await env.pay(bill.id, '301000', '2026-10-23');
  const facts = () => env.store.read().facts.filter(fact => fact.kind === 'cost');
  assert.deepEqual(facts().map(fact => [fact.fields.amountMinor, fact.fields.taxMinor, fact.validFrom, fact.fields.billId]), [['256000', '45000', '2026-10-23', bill.id]]);
  const receipt = env.deps.services.calculator.receipt(owner, half.receiptId!);
  assert.deepEqual([receipt.operation, receipt.totalMinor], ['costs', '256000']);
  // The last payment takes what is left before tax, so the two add up exactly: 512000 - 256000 = 256000; tax 301000 - 256000 = 45000.
  await env.pay(bill.id, '301000', '2026-10-24');
  assert.deepEqual(facts().map(fact => fact.fields.amountMinor), ['256000', '256000']);
  assert.deepEqual(facts().map(fact => fact.fields.taxMinor), ['45000', '45000']);
  const bills = listRecords(env.store.read(), 'venture-bill');
  assert.ok(bills[0].payments.every(item => typeof item.factId === 'string' && facts().some(fact => fact.id === item.factId)));
});

test('a business not registered for GST counts the whole payment as its cost', async () => {
  const env = await business({ taxAssumed: true });
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR], billDate: '2026-10-20', dueDate: '2026-10-30' });
  // Total 500000 + 90000 = 590000; the GST is a cost here, not something to claim back.
  await env.pay(bill.id, '590000', '2026-10-23');
  assert.deepEqual(env.store.read().facts.filter(fact => fact.kind === 'cost').map(fact => [fact.fields.amountMinor, fact.fields.taxMinor]), [['590000', '0']]);
});

test('billsDue: open bills due in the window, nearest first, with their balances; paid ones are left out', async () => {
  const env = await business();
  const a = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR], billDate: '2026-10-20', dueDate: '2026-10-30' });
  const b = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: '', taxRateBps: '0' }], billDate: '2026-10-21', dueDate: '2026-10-27' });
  const c = await env.bill({ vendor: 'Paper Co', lines: [{ description: 'Paper', amountMinor: '10000', taxName: '', taxRateBps: '0' }], billDate: '2026-10-21', dueDate: '2026-12-15' });
  await env.pay(a.bill.id, '90000', '2026-10-23'); // 590000 - 90000 = 500000 left
  const d = await env.bill({ vendor: 'Done Ltd', lines: [{ description: 'Done', amountMinor: '5000', taxName: '', taxRateBps: '0' }], billDate: '2026-10-21', dueDate: '2026-10-28' });
  await env.pay(d.bill.id, '5000', '2026-10-23');
  const due = billsDue(env.store.read(), '2026-10-23', '2026-11-30');
  assert.deepEqual(due.map(item => [item.billId, item.vendor, item.dueDate, item.balanceMinor, item.expected]), [
    [b.bill.id, 'Cloud Host', '2026-10-27', '250000', false],
    [a.bill.id, 'Metro Repairs', '2026-10-30', '500000', false],
  ]);
  assert.ok(!due.some(item => item.billId === c.bill.id));
});

test('a recurring bill: its next one is drafted on its day as an expected bill, once; the real one takes its place; paying a draft posts it', async () => {
  const env = await business();
  const first = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: 'GST', taxRateBps: '1800' }], billDate: '2026-10-01', dueDate: '2026-10-10', recurring: 'monthly' });
  assert.equal(first.bill.recurring, 'monthly');
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 }, 'November has not come yet');

  env.advance(9 * DAY); // 1 November in Kolkata
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 1 });
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 }, 'never twice');
  const draft = listRecords(env.store.read(), 'venture-bill').find(item => item.id !== first.bill.id) as BillRecord;
  assert.deepEqual([draft.status, draft.billDate, draft.dueDate, draft.vendor, draft.recurring, draft.totalMinor], ['draft', '2026-11-01', '2026-11-10', 'Cloud Host', 'monthly', '295000']);
  // 250000 x 1800: 45000 tax, total 295000, copied from October's lines as they were.
  assert.deepEqual(draft.lines, [{ description: 'Hosting', amountMinor: '250000', taxName: 'GST', taxRateBps: '1800' }]);
  const listed = (await env.money<BillsView>('venture.bills.list')).bills.find(item => item.id === draft.id)!;
  assert.equal(listed.state, 'draft');
  assert.deepEqual(billsDue(env.store.read(), '2026-11-01', '2026-11-30').map(item => [item.billId, item.expected]), [[draft.id, true]]);

  // The real November bill came for a little more: it takes the draft's place (the same bill, now posted). 260000 x 1800: 46800, total 306800.
  const real = await env.bill({ vendor: 'cloud host', lines: [{ description: 'Hosting', amountMinor: '260000', taxName: 'GST', taxRateBps: '1800' }], billDate: '2026-11-01', dueDate: '2026-11-12', recurring: 'monthly' });
  assert.equal(real.bill.id, draft.id);
  assert.deepEqual([real.bill.state, real.bill.total, real.bill.dueDate], ['posted', 'INR 3,068.00', '2026-11-12']);
  assert.equal(listRecords(env.store.read(), 'venture-bill').length, 2);

  // December's draft, paid as it is: paying it confirms it.
  env.advance(30 * DAY); // 1 December
  await runMoneySchedules(env.deps, owner);
  const december = listRecords(env.store.read(), 'venture-bill').find(item => item.billDate === '2026-12-01')!;
  assert.equal(december.status, 'draft');
  const paid = await env.pay(december.id, december.totalMinor, '2026-12-01');
  assert.equal(paid.bill.state, 'paid');
  assert.equal(listRecords(env.store.read(), 'venture-bill').find(item => item.id === december.id)!.status, 'posted');
});

// ---------------------------------------------------------------------------
// The integrator's review (4J5): bill payments counted once, repeats kept and stopped, the GST choice kept
// ---------------------------------------------------------------------------

type BuildHandler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const build = <T>(env: { deps: VentureDeps }, method: string, payload: unknown = {}) => (buildHandlers as Record<string, BuildHandler>)[method](env.deps, owner, payload) as Promise<T>;
const statement = (...rows: string[]) => `Date,Description,Amount,Counterparty\n${rows.join('\n')}\n`;
const costsOf = (env: { store: { read(): State } }) => env.store.read().facts.filter(fact => fact.kind === 'cost');

test('a bank row that pays a bill you recorded is flagged as recorded, and adding it as a cost is refused, so costs are not doubled', async () => {
  const env = await business();
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  await env.pay(bill.id, '602000', '2026-10-23'); // one cost fact of 512000, the GST you can claim back left out
  await build(env, 'venture.bank.import', { csv: statement('2026-10-24,NEFT METRO REPAIRS,-6020.00,Metro Repairs', '2026-10-30,NEFT METRO REPAIRS,-6020.00,Metro Repairs'), account: 'HDFC current' });
  const [near, far] = (await build<BankLedgerView>(env, 'venture.bank.ledger')).rows;
  assert.equal(near.flag, 'Already recorded as your payment of the Metro Repairs bill on 23 Oct 2026.');
  assert.equal(far.flag, null, 'seven days later is not the same payment');
  await assert.rejects(build(env, 'venture.bank.apply', { transactionId: near.id, as: 'cost' }), code('BANK_ALREADY_APPLIED'));
  assert.equal(costsOf(env).length, 1);
  const costs = await env.deps.services.calculator.calculate(owner, { operation: 'costs', period: { from: '2026-10-01', to: '2026-10-31' } });
  assert.equal(costs.totalMinor, '512000');
  await build(env, 'venture.bank.apply', { transactionId: near.id, as: 'skip' }); // skipping it is still the owner's choice
});

test('a bill paid after its bank row was added as a cost is recorded against that cost, never as a second one', async () => {
  const env = await business();
  await build(env, 'venture.bank.import', { csv: statement('2026-10-23,NEFT METRO REPAIRS,-6020.00,Metro Repairs'), account: 'HDFC current' });
  const [row] = (await build<BankLedgerView>(env, 'venture.bank.ledger')).rows;
  await build(env, 'venture.bank.apply', { transactionId: row.id, as: 'cost' }); // a cost fact of 602000, from the bank
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  const paid = await env.pay(bill.id, '602000', '2026-10-24');
  assert.equal(paid.bill.state, 'paid');
  assert.equal(costsOf(env).length, 1, 'the bank row already counts it');
  const stored = listRecords(env.store.read(), 'venture-bill')[0];
  assert.equal(stored.payments[0].factId, costsOf(env)[0].id);
});

test('a real bill taking an expected one\'s place keeps its repeat unless told; bills.stop ends a repeat and its expected bill', async () => {
  const env = await business();
  const first = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: 'GST', taxRateBps: '1800' }], billDate: '2026-10-01', dueDate: '2026-10-10', recurring: 'monthly' });
  env.advance(9 * DAY); // 1 November: November's expected bill
  await runMoneySchedules(env.deps, owner);
  const real = await env.bill({ vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '260000', taxName: 'GST', taxRateBps: '1800' }], billDate: '2026-11-01', dueDate: '2026-11-12' });
  assert.deepEqual([real.bill.state, real.bill.recurring], ['posted', 'monthly'], 'no recurring given: the expected bill\'s repeat stays');
  env.advance(30 * DAY); // 1 December: December's expected bill
  await runMoneySchedules(env.deps, owner);
  const december = listRecords(env.store.read(), 'venture-bill').find(item => item.billDate === '2026-12-01')!;
  assert.equal(december.status, 'draft');

  await assert.rejects(env.money('venture.bills.stop', { billId: real.bill.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.money('venture.bills.stop', { billId: 'bill_missing' }), code('INVALID_VENTURE_REQUEST'));
  const stopped = await env.money<BillsView>('venture.bills.stop', { billId: first.bill.id });
  assert.deepEqual(stopped.bills.map(item => [item.billDate, item.recurring]), [['2026-10-01', null], ['2026-11-01', null]], 'the expected December bill is gone');
  assert.equal(listRecords(env.store.read(), 'venture-bill').find(item => item.id === december.id)!.status, 'cancelled');
  assert.deepEqual(billsDue(env.store.read(), '2026-12-01', '2026-12-31'), []);
  env.advance(31 * DAY); // 1 January: nothing repeats any more
  assert.deepEqual(await runMoneySchedules(env.deps, owner), { invoices: 0, bills: 0 });
  await assert.rejects(env.money('venture.bills.stop', { billId: first.bill.id }), code('INVALID_VENTURE_REQUEST'));
  // A bill added with recurring null says it does not repeat.
  const once = await env.bill({ vendor: 'Paper Co', lines: [{ description: 'Paper', amountMinor: '10000', taxName: '', taxRateBps: '0' }], billDate: '2027-01-01', dueDate: '2027-01-05', recurring: null });
  assert.equal(once.bill.recurring, null);
});

test('the GST choice is kept on a bill when it is first paid, so a registration change later never makes a cost negative', async () => {
  // Registered when first paid: 256000 of 301000 is the cost (as above); unregistered later, the last payment still takes the
  // rest before tax, 512000 - 256000 = 256000, never 301000 and never less than zero.
  const env = await business();
  const { bill } = await env.bill({ vendor: 'Metro Repairs', lines: [REPAIR, COURIER], billDate: '2026-10-20', dueDate: '2026-10-30' });
  await env.pay(bill.id, '301000', '2026-10-23');
  assert.equal(listRecords(env.store.read(), 'venture-bill')[0].taxClaimed, true);
  await seedBlueprint(env, { version: 2, taxAssumed: true });
  await env.pay(bill.id, '301000', '2026-10-24');
  assert.deepEqual(costsOf(env).map(fact => fact.fields.amountMinor), ['256000', '256000']);

  // Not registered when first paid: 100000 of 590000 is all cost; registered later, the rest is all cost too: 490000.
  const other = await business({ taxAssumed: true });
  const second = await other.bill({ vendor: 'Metro Repairs', lines: [REPAIR], billDate: '2026-10-20', dueDate: '2026-10-30' });
  await other.pay(second.bill.id, '100000', '2026-10-23');
  assert.equal(listRecords(other.store.read(), 'venture-bill')[0].taxClaimed, false);
  await seedBlueprint(other, { version: 2 });
  await other.pay(second.bill.id, '490000', '2026-10-24');
  assert.deepEqual(costsOf(other).map(fact => [fact.fields.amountMinor, fact.fields.taxMinor]), [['100000', '0'], ['490000', '0']]);
});
