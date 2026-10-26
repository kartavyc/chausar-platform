// Ink v2 wave 4, package 4J4 (M9, M13, M14): cash over the next 13 weeks. It starts from the latest balance on an
// imported bank statement (reported, with its file and row) and what the owner recorded since; the forecast is projected
// and says so: open invoices come in on their due dates (late ones in the first week, or never), bills go out on theirs
// (overdue ones in the first week), a repeating bill comes again at the same amount, and the usual costs are the
// average of the last 3 months' money out, bills left out because they are counted from the bills. Each week has its
// receipt; the assumptions are listed; a line that never falls says nothing about running out. Every amount is worked
// out by hand in a comment.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CashView, SumReceiptRecord } from '../runtime/venture/contracts.ts';
import { goalBusiness, invoice, type GoalEnv } from './venture-goals-helpers.ts';
import { bankCosts, foreignInvoice } from './venture-money-env.ts';
import { closingRow } from '../runtime/venture/build/bank.ts';
import { code } from './venture-views-env.ts';

const RENT = (month: string, balance: string) => `2026-${month}-10,OFFICE RENT,-13000.00,Landlord,${balance}`;

/**
 * Today is Friday 23 Oct 2026 in Kolkata; week k ends on 23 Oct + 7k days.
 * - The statement: rent of INR 13,000.00 on 10 Jul, 10 Aug and 10 Sep (added as costs), and a deposit on 18 Oct that
 *   leaves 10000000 (INR 100,000.00) in the bank.
 * - Recorded since the statement: INR 1,000.00 received on 20 Oct. Opening: 10000000 + 100000 = 10100000.
 * - Open invoices, 2330500 each (INR 23,305.00): one due 16 Sep (late), one due 25 Oct less the 1,000.00 paid
 *   (2230500), one due 4 Nov (week 2).
 * - Bills: Metro Repairs 602000, due 10 Oct and unpaid (overdue, week 1); Cloud Host 280000 (250000 + 12% GST), billed
 *   21 Oct, due 5 Nov (week 2), repeating monthly: again on 21 Nov, due 6 Dec (week 7), and 21 Dec, due 5 Jan (week 11).
 * - Usual costs: Jul to Sep sent out 1300000 x 3 = 3900000, over 3 months; a week is 3900000 x 3 / (13 x 3) = 300000.
 */
async function cashBusiness() {
  const env = await goalBusiness();
  await bankCosts(env, [RENT('07', '120000.00'), RENT('08', '107000.00'), RENT('09', '94000.00'), '2026-10-18,CLIENT DEPOSIT,6000.00,Someone,100000.00']);
  const late = await invoice(env, '1', '2026-09-01');
  const soon = await invoice(env, '1', '2026-10-10');
  await env.money('venture.payment.record', { invoiceId: soon.invoice.id, amount: '1000.00', receivedOn: '2026-10-20', method: 'upi' });
  const next = await invoice(env, '1', '2026-10-20');
  await env.money('venture.bills.add', { vendor: 'Metro Repairs', billDate: '2026-10-01', dueDate: '2026-10-10', lines: [{ description: 'Laptop repair', amountMinor: '602000', taxName: '', taxRateBps: '0' }] });
  await env.money('venture.bills.add', {
    vendor: 'Cloud Host', billDate: '2026-10-21', dueDate: '2026-11-05', recurring: 'monthly', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: 'GST', taxRateBps: '1200' }],
  });
  return { env, late, soon, next };
}

/**
 * On time, week by week: week 1 +2330500 +2230500 -602000 -300000 = +3659000 -> 13759000; week 2 +2330500 -280000
 * -300000 = +1750500 -> 15509500; weeks 3 to 6 -300000 each -> 14309500; week 7 -580000 -> 13729500; weeks 8 to 10
 * -> 12829500; week 11 -580000 -> 12249500; week 12 -> 11949500; week 13 -> 11649500.
 */
const ON_TIME = [10100000, 13759000, 15509500, 15209500, 14909500, 14609500, 14309500, 13729500, 13429500, 13129500, 12829500, 12249500, 11949500, 11649500];

test('cash: 13 weeks from the bank balance, projected and labelled so, the lowest weeks with receipts and the assumptions listed', async () => {
  const { env } = await cashBusiness();
  const view = await env.money<CashView>('venture.money.cash');
  assert.deepEqual([view.bank?.display, view.bank?.on, view.bank?.kind, view.bank?.source.from], ['INR 100,000.00', '2026-10-18', 'reported', 'file']);
  assert.match(view.bank?.source.from === 'file' ? view.bank.source.line : '', /HDFC current/);
  assert.deepEqual([view.opening?.display, view.opening?.kind, view.opening?.projected], ['INR 101,000.00', 'calculated', undefined]);
  assert.equal(view.points.length, 14);
  assert.deepEqual(view.points.map(point => point.week), Array.from({ length: 14 }, (_, k) => new Date(Date.UTC(2026, 9, 23 + 7 * k)).toISOString().slice(0, 10)));
  assert.deepEqual([view.points[0].label, view.points[1].label, view.points[13].label], ['Today', 'Week to 30 Oct 2026', 'Week to 22 Jan 2027']);
  // Actual is today only; the forecast runs from today on, each week projected with its own receipt.
  assert.equal(view.points[0].actual?.display, 'INR 101,000.00');
  assert.ok(view.points.slice(1).every(point => point.actual === null && point.actualPermille === null));
  const minor = (display: string | undefined) => Number((display ?? '').replace(/[^0-9-]/g, ''));
  assert.deepEqual(view.points.map(point => minor(point.forecast?.display)), ON_TIME);
  assert.ok(view.points.slice(1).every(point => point.forecast?.projected === true && point.forecast.kind === 'calculated'));
  assert.ok(view.points.slice(1).every(point => point.forecast?.uses?.includes('Clients pay open invoices on their due dates.')));
  // Per mille of the highest week, 15509500: 10100000 x 1000 / 15509500 = 651.2 -> 651; the lowest week 751.1 -> 751.
  assert.deepEqual([view.points[0].actualPermille, view.points[0].forecastPermille, view.points[2].forecastPermille, view.points[13].forecastPermille], [651, 651, 1000, 751]);
  // 4J20: level lines on round amounts, two or three of them, from the scale's floor (0) to its top (15509500): steps of
  // 5000000 give 5000000, 10000000 and 15000000, at 322.3 -> 322, 644.7 -> 644 and 967.1 -> 967 per mille; no zero line
  // while the scale stays above zero.
  assert.deepEqual(view.ticks, [{ permille: 322, label: 'INR 50,000.00' }, { permille: 644, label: 'INR 100,000.00' }, { permille: 967, label: 'INR 150,000.00' }]);

  // 4Z2: the lowest week ahead (week 13, 11649500) stays above today's 10100000, so no lowest week is named for it.
  assert.equal(view.lowest.onTime, null);
  // If the late one never pays: 11649500 - 2330500 = 9319000, below today's 10100000.
  assert.deepEqual([view.lowest.ifLateNeverPay?.display, view.lowest.ifLateNeverPay?.line], ['INR 93,190.00', 'If the 1 late one never pays']);
  const week13 = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.points[13].forecast!.receiptId });
  assert.deepEqual(week13.subject, { type: 'cash', asOf: '2026-10-23', week: '2027-01-22', scenario: 'on-time' });
  assert.equal(week13.totalMinor, '11649500');
  assert.equal(week13.estimate, true, 'the usual costs and the repeating bill are assumptions');
  // 10000000 + 100000 + 2330500 + 2230500 + 2330500 - 602000 - 280000 - 280000 - 280000 - 3900000 = 11649500.
  assert.deepEqual(week13.addends.map(addend => addend.amount), ['10000000', '100000', '2330500', '2230500', '2330500', '-602000', '-280000', '-280000', '-280000', '-3900000']);
  assert.match(week13.explanation, /Projected/);

  assert.deepEqual([view.usualCosts?.display, view.usualCosts?.kind], ['INR 3,000.00', 'assumption']);
  assert.deepEqual(view.assumptions, [
    'Starts from your bank balance on 18 Oct 2026, with what you recorded since.',
    'Clients pay open invoices on their due dates.',
    'The 1 late invoice is paid in the first week.',
    'Bills are paid on their due dates; overdue ones in the first week.',
    'Repeating bills come again at the same amount.',
    'Usual costs of INR 3,000.00 a week: the average of what went out in Jul, Aug and Sep 2026, bills left out because they are counted above.',
  ]);
  // The next three weeks by date, each proved by its week's receipt.
  assert.deepEqual(view.nextWeeks.map(item => [item.on, item.direction, item.line, item.amount.display]), [
    ['2026-10-10', 'out', 'Bill from Metro Repairs, overdue since 10 Oct 2026', 'INR 6,020.00'],
    ['2026-10-25', 'in', `Due from Cafe Aroma Demo on 25 Oct 2026`, 'INR 22,305.00'],
    ['2026-11-04', 'in', `Due from Cafe Aroma Demo on 04 Nov 2026`, 'INR 23,305.00'],
    ['2026-11-05', 'out', 'Bill from Cloud Host, due 05 Nov 2026', 'INR 2,800.00'],
  ]);
  assert.equal(view.nextWeeks[0].amount.receiptId, view.points[1].forecast?.receiptId);
  assert.equal(view.nextWeeks[3].amount.receiptId, view.points[2].forecast?.receiptId);
  assert.equal(view.line, "Projected, if clients pay on time: cash does not fall below today's balance in the next 13 weeks.");
});

test('4Z2: a lowest week is named only when it falls below today, so it never reads above the bank balance', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,5000.00']);
  await invoice(env, '1', '2026-10-20');
  // 500000 today, then 500000 + 2330500 = 2830500 from week 2 on: cash only rises, so no lowest week and the line says so.
  const rising = await env.money<CashView>('venture.money.cash');
  assert.equal(rising.lowest.onTime, null);
  assert.equal(rising.lowest.ifLateNeverPay, null);
  assert.equal(rising.line, 'Projected, if clients pay on time: cash does not fall in the next 13 weeks.');
  // A bill of 600000 due 9 Nov (week 3): 2830500 - 600000 = 2230500, still above today's 500000: still no lowest week.
  await env.money('venture.bills.add', { vendor: 'Print Works', billDate: '2026-10-20', dueDate: '2026-11-09', lines: [{ description: 'Banners', amountMinor: '600000', taxName: '', taxRateBps: '0' }] });
  const above = await env.money<CashView>('venture.money.cash');
  assert.equal(above.lowest.onTime, null);
  assert.equal(above.line, "Projected, if clients pay on time: cash does not fall below today's balance in the next 13 weeks.");
  // A second bill of 2000000 the same day: 2230500 - 2000000 = 230500, below today's 500000: that week is the lowest.
  await env.money('venture.bills.add', { vendor: 'Stage Hire', billDate: '2026-10-20', dueDate: '2026-11-09', lines: [{ description: 'Stage', amountMinor: '2000000', taxName: '', taxRateBps: '0' }] });
  const dips = await env.money<CashView>('venture.money.cash');
  assert.deepEqual([dips.lowest.onTime?.display, dips.lowest.onTime?.week, dips.lowest.onTime?.projected], ['INR 2,305.00', '2026-11-13', true]);
  assert.equal(dips.line, 'Projected, if clients pay on time: the lowest week is the week to 13 Nov 2026, at INR 2,305.00.');
});

test('a line that never falls says nothing about running out; one that falls below zero says the week, with a zero line', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,5000.00']);
  await invoice(env, '1', '2026-10-20');
  const rising = await env.money<CashView>('venture.money.cash');
  assert.equal(rising.line, 'Projected, if clients pay on time: cash does not fall in the next 13 weeks.');
  assert.equal(rising.lowest.ifLateNeverPay, null, 'no late invoices, so no second scenario');
  assert.ok(!/run out|below zero/.test(rising.line));
  // 500000 + 2330500 = 2830500, then a bill of 4000000 due 9 Nov (week 3): 2830500 - 4000000 = -1169500.
  await env.money('venture.bills.add', { vendor: 'Print Works', billDate: '2026-10-20', dueDate: '2026-11-09', lines: [{ description: 'Banners', amountMinor: '4000000', taxName: '', taxRateBps: '0' }] });
  const falling = await env.money<CashView>('venture.money.cash');
  assert.equal(falling.line, 'Projected, if clients pay on time: cash goes below zero in the week to 13 Nov 2026.');
  assert.equal(falling.lowest.onTime?.display, 'INR -11,695.00');
  // The scale runs from -1169500 to 2830500 (4000000): zero sits at 1169500 x 1000 / 4000000 = 292.3 -> 292.
  // 4J20: with steps of 1000000 the levels are -1000000, 0, 1000000 and 2000000: (x + 1169500) x 1000 / 4000000 is 42.3,
  // 292.3, 542.3 and 792.3 per mille; zero is among them.
  assert.deepEqual(falling.ticks, [
    { permille: 42, label: 'INR -10,000.00' }, { permille: 292, label: 'INR 0.00' }, { permille: 542, label: 'INR 10,000.00' }, { permille: 792, label: 'INR 20,000.00' },
  ]);
  assert.equal(falling.points[3].forecastPermille, 0);
});

test('without a bank statement there is no line, only the import words; the next three weeks still list with receipts', async () => {
  const env: GoalEnv = await goalBusiness();
  await invoice(env, '1', '2026-10-20');
  const view = await env.money<CashView>('venture.money.cash');
  assert.deepEqual([view.bank, view.opening, view.points, view.lowest.onTime, view.lowest.ifLateNeverPay, view.usualCosts, view.assumptions],
    [null, null, [], null, null, null, []]);
  assert.equal(view.line, 'Import a bank statement to see cash ahead.');
  assert.equal(view.nextWeeks.length, 1);
  const receipt = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.nextWeeks[0].amount.receiptId });
  assert.equal(receipt.totalMinor, '2330500');
  await assert.rejects(env.money('venture.money.cash', { asOf: '2026-10-23' }), code('INVALID_VENTURE_REQUEST'));
});

test('the bank figure: one statement row is reported with its own receipt; two accounts add up to a calculated figure', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,100000.00']);
  const one = await env.money<CashView>('venture.money.cash');
  assert.notEqual(one.bank?.receiptId, one.opening?.receiptId, 'the bank balance has its own receipt');
  const own = await env.money<SumReceiptRecord>('venture.receipt.get', { id: one.bank!.receiptId });
  assert.deepEqual([own.subject, own.totalMinor, own.addends.length], [{ type: 'cash', asOf: '2026-10-23', week: '2026-10-23', scenario: 'bank' }, '10000000', 1]);
  assert.deepEqual([one.bank?.kind, one.bank?.display], ['reported', 'INR 100,000.00']);
  await bankCosts(env, ['2026-10-19,TRANSFER IN,2500.00,Someone,2500.00'], 'SBI savings');
  const two = await env.money<CashView>('venture.money.cash');
  // 10000000 + 250000 = 10250000, added by code from two statements.
  assert.deepEqual([two.bank?.kind, two.bank?.display, two.bank?.source], ['calculated', 'INR 102,500.00', { from: 'receipt', receiptId: two.bank?.receiptId }]);
  assert.equal((await env.money<SumReceiptRecord>('venture.receipt.get', { id: two.bank!.receiptId })).addends.length, 2);
});

test('a day\'s closing balance is its newest row, whatever order the statement lists the day in', async () => {
  for (const rows of [
    ['2026-10-18,CARD,-1000.00,Shop,99000.00', '2026-10-18,DEPOSIT,5000.00,Someone,100000.00'],
    ['2026-10-18,DEPOSIT,5000.00,Someone,100000.00', '2026-10-18,CARD,-1000.00,Shop,99000.00'],
  ]) {
    const env = await goalBusiness();
    await bankCosts(env, rows);
    // 95000 + 5000 = 100000, then 100000 - 1000 = 99000: the card payment came last that day.
    assert.equal((await env.money<CashView>('venture.money.cash')).bank?.display, 'INR 99,000.00', rows[0]);
  }
});

test('every week ahead is projected and its receipt says so; what the forecast leaves out is listed', async () => {
  const env = await goalBusiness();
  await bankCosts(env, ['2026-10-18,CLIENT DEPOSIT,6000.00,Someone,5000.00']);
  const sale = await invoice(env, '1', '2026-10-20');
  await foreignInvoice(env, sale.invoice);
  await foreignInvoice(env, sale.invoice, { currency: 'INR', number: 'INV-0099', dueDate: null });
  const view = await env.money<CashView>('venture.money.cash');
  // Week 2 holds only the invoice due 4 Nov, taken as paid on its due date: still projected, still an estimate.
  const week2 = await env.money<SumReceiptRecord>('venture.receipt.get', { id: view.points[2].forecast!.receiptId });
  assert.equal(week2.estimate, true);
  assert.match(week2.figures[0].label, /^Projected cash in the week to 06 Nov 2026/);
  assert.ok(week2.addends.slice(1).every(addend => /due/.test(addend.label)));
  assert.ok(view.points.slice(1).every(point => point.forecast?.estimate === true && point.forecast.projected === true));
  assert.equal(view.points[0].actual?.estimate, undefined, 'today is no estimate');
  assert.deepEqual(view.basis.notCounted, { count: 2, line: '2 not counted: 1 open invoice in another currency, with no rate to INR; 1 open invoice with no due date' });
  assert.ok(view.assumptions.includes('Clients pay open invoices on their due dates.'));
});

test('closingRow: the newest row of the latest day by its balances, the last listed only when the balances cannot tell', () => {
  const row = (date: string, amountMinor: string, balanceAfterMinor: string | null) => ({ date, amountMinor, balanceAfterMinor });
  const deposit = row('2026-10-18', '500000', '10000000'), card = row('2026-10-18', '-100000', '9900000'), older = row('2026-10-17', '0', '9500000');
  assert.equal(closingRow([older, card, deposit]), card, 'newest first in the file');
  assert.equal(closingRow([older, deposit, card]), card, 'oldest first in the file');
  assert.equal(closingRow([older, row('2026-10-19', '100', null)]), older, 'a row with no balance is never the closing one');
  const a = row('2026-10-18', '100', '5000'), b = row('2026-10-18', '200', '7000');
  assert.equal(closingRow([a, b]), b, 'two rows whose balances do not chain: the last listed');
  assert.equal(closingRow([]), null);
});
