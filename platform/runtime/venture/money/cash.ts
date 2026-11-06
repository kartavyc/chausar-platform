// Chausar venture launcher, money (Ink v2 wave 4, package 4J4, M9): cash over the next 13 weeks (venture.money.cash).
// Today (the owner's calendar) starts from the latest balance on each imported bank statement, as reported in its row,
// and what the owner recorded after it (payments typed in, bills paid by typing them: a bank row's own money is in its
// balance already). Every week ahead is projected, never presented as what will happen, and its receipt says so: open
// invoices come in on their due dates, late ones in the first week (or never, in the second scenario); bills go out on
// their due dates, overdue ones in the first week; a repeating bill comes again at the same amount; and the usual costs
// are the average of the last 3 full months' money out, bills left out because each bill is counted from its record.
// The assumptions are listed and carried by every figure that rests on them. A line that never falls says nothing
// about running out. Money in BigInt minor units; per mille scaled in code from the lowest to the highest point.
import type { Context, State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture } from '../records.ts';
import type {
  BillRecord, CashIssueView, CashItemView, CashLowest, CashPointView, CashView, IsoDate, KindedFigure, SumReceiptRecord, SumReceiptSubject, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { addDaysUtc, calendarMonth, todayLocal } from './dates.ts';
import { previousMonth } from './goal-plans.ts';
import { daysFrom, paymentState } from './ledger.ts';
import { billsDue, billTotals } from './bills.ts';
import { addMonthsOn, STEP_MONTHS } from './schedule.ts';
import { aiSpendOut, costsOut, shortMonth } from './flow.ts';
import { localDayAt } from '../local-day.ts';
import { openInvoices, planTotal, sumReceipt, type Addend, type SumPlan } from './sums.ts';
import { assumptionFigure, basisOf, calculatedFigure, countOf, moneyCountry, notCountedOf, otherCurrency, reportedFigure } from './figure-kinds.ts';
import { closingRow } from '../build/bank.ts';

/** Weeks ahead; the next-weeks list looks this many days ahead. */
const WEEKS = 13;
const NEXT_DAYS = 21;
const MAX_REPEATS = 12;

/** on: the day the forecast counts it (the first week for late and overdue ones); due: its own due date. */
type Flow = { addend: Addend; on: IsoDate; due: IsoDate; direction: 'in' | 'out'; late: boolean; overdue: boolean; line: string };
type Balance = { account: string; importId: string; transactionId: string; on: IsoDate; minor: bigint };

/**
 * Each account's closing balance on or before a day, in the business's currency: the newest row of its latest day
 * with a balance, whatever order the statement listed that day in (build/bank.ts closingRow). missing: accounts whose
 * statements have no balance; elsewhere: accounts in another currency. The opening leaves both out and says so.
 */
function bankBalances(state: State, venture: VentureRecord, asOf: IsoDate): { balances: Balance[]; missing: number; elsewhere: number } {
  const imports = listRecords(state, 'venture-bank-import', venture.id);
  const balances: Balance[] = [];
  let missing = 0, elsewhere = 0;
  for (const account of listRecords(state, 'venture-bank-account', venture.id)) {
    if (account.currency !== venture.country.currency) { elsewhere += 1; continue; }
    const rows = imports.filter(entry => entry.accountId === account.id)
      .flatMap(item => item.transactions.filter(row => row.date <= asOf && row.currency === account.currency).map(row => ({ ...row, importId: item.id })));
    const closing = closingRow(rows);
    if (closing && closing.balanceAfterMinor !== null) {
      balances.push({ account: account.label, importId: closing.importId, transactionId: closing.id, on: closing.date, minor: BigInt(closing.balanceAfterMinor) });
    } else missing += 1;
  }
  return { balances, missing, elsewhere };
}

/** The day the statements stop: the latest of the accounts' balance days. */
const bankDay = (balances: readonly Balance[]): IsoDate => balances.reduce((day, balance) => (balance.on > day ? balance.on : day), balances[0].on);

/** What was recorded after the statement up to today: payments typed in (in) and costs not from a bank row (out). */
function recordedSince(state: State, venture: VentureRecord, after: IsoDate, asOf: IsoDate): Addend[] {
  if (after >= asOf) return [];
  const { currency, dateOrder } = venture.country;
  const numbers = new Map(listRecords(state, 'venture-invoice', venture.id).map(invoice => [invoice.id, invoice.number]));
  const ins = listRecords(state, 'venture-payment', venture.id)
    .filter(payment => paymentState(payment) === 'cleared' && !payment.bankTransactionId && payment.currency === currency && payment.receivedOn > after && payment.receivedOn <= asOf)
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at))
    .map(payment => ({
      recordId: payment.id, label: `Recorded since your statement: ${numbers.get(payment.invoiceId) ?? 'an invoice'}, ${formatVentureDate(payment.receivedOn, dateOrder)}`,
      amount: payment.amountMinor, display: formatMinor(payment.amountMinor, currency), estimate: false,
    }));
  const outs = costsOut(state, venture, addDaysUtc(after, 1), asOf).filter(cost => typeof cost.fact.fields.bankReference !== 'string').map(cost => {
    const words = typeof cost.fact.fields.description === 'string' && cost.fact.fields.description.trim() ? cost.fact.fields.description.trim() : 'A cost';
    return { recordId: cost.fact.id, label: `Recorded since your statement: ${words}, ${formatVentureDate(cost.fact.validFrom, dateOrder)}`, amount: String(-cost.cash), display: formatMinor(-cost.cash, currency), estimate: false };
  });
  return [...ins, ...outs];
}

const vendorKey = (vendor: string) => vendor.trim().replace(/\s+/g, ' ').toLowerCase();

/** The next bills of each repeating chain after its latest one (posted or expected), due up to a day: an assumption. */
function repeatsUpTo(state: State, venture: VentureRecord, until: IsoDate): { vendor: string; billDate: IsoDate; dueDate: IsoDate; minor: bigint; recurring: 'monthly' | 'quarterly' }[] {
  const chains = new Map<string, BillRecord[]>();
  for (const bill of listRecords(state, 'venture-bill', venture.id)) {
    if (bill.recurring === null || bill.status === 'cancelled' || bill.currency !== venture.country.currency) continue;
    chains.set(vendorKey(bill.vendor), [...(chains.get(vendorKey(bill.vendor)) ?? []), bill]);
  }
  const repeats = [];
  for (const chain of chains.values()) {
    const ordered = [...chain].sort((a, b) => a.billDate.localeCompare(b.billDate) || a.at.localeCompare(b.at));
    const latest = ordered[ordered.length - 1];
    if (latest.recurring === null) continue;
    const day = parseInt(ordered[0].billDate.slice(8, 10), 10), gap = daysFrom(latest.billDate, latest.dueDate), step = STEP_MONTHS[latest.recurring];
    let billDate = addMonthsOn(latest.billDate, step, day);
    for (let count = 0; count < MAX_REPEATS; count++) {
      const dueDate = addDaysUtc(billDate, gap);
      if (dueDate > until) break;
      repeats.push({ vendor: latest.vendor, billDate, dueDate, minor: billTotals(latest.lines).total, recurring: latest.recurring });
      billDate = addMonthsOn(billDate, step, day);
    }
  }
  return repeats;
}

/** The 3 full months before today's month, with what went out in each (bills left out) and AI spend at the owner's rate. */
function usualCosts(state: State, venture: VentureRecord, asOf: IsoDate): { total: bigint; months: number; names: string[]; aiLeftOut: boolean } {
  const start = localDayAt(venture.at, venture.country);
  const names: string[] = [];
  let month = asOf.slice(0, 7), total = 0n, months = 0, aiLeftOut = false;
  for (let index = 0; index < 3; index++) {
    month = previousMonth(month);
    const { from, to } = calendarMonth(month);
    const costs = costsOut(state, venture, from, to).filter(cost => !cost.bill);
    const ai = aiSpendOut(state, venture, month);
    if (!ai.counted) aiLeftOut = true;
    const spent = costs.reduce((sum, cost) => sum + cost.cash, 0n) + ai.addends.reduce((sum, addend) => sum + BigInt(addend.amount), 0n);
    if (costs.length || ai.addends.length || to >= start) months += 1;
    total += spent;
    names.unshift(month);
  }
  return { total, months, names, aiLeftOut };
}

/** 'Jul, Aug and Sep 2026', or each with its year when the years differ. */
function monthsWords(months: readonly string[]): string {
  const sameYear = months.every(month => month.slice(0, 4) === months[0].slice(0, 4));
  const parts = months.map(month => (sameYear ? shortMonth(month).slice(0, 3) : shortMonth(month)));
  const listed = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return sameYear ? `${listed} ${months[0].slice(0, 4)}` : listed;
}

/** The usual costs over a number of weeks: the 3 months' money out times 3 times weeks over 13 times months, half up. */
function usualFor(usual: { total: bigint; months: number }, weeks: number): bigint {
  if (usual.months === 0 || weeks <= 0) return 0n;
  const over = 13n * BigInt(usual.months);
  return (usual.total * 3n * BigInt(weeks) * 2n + over) / (2n * over);
}

/** Everything that comes in or goes out from today to the end of the 13 weeks, in one scenario, with its day. */
function flowsAhead(state: State, venture: VentureRecord, asOf: IsoDate, until: IsoDate, scenario: 'on-time' | 'late-unpaid'): Flow[] {
  const { currency, dateOrder } = venture.country;
  const day = (iso: IsoDate) => formatVentureDate(iso, dateOrder);
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const flows: Flow[] = [];
  for (const invoice of openInvoices(state, venture.id)) {
    if (invoice.currency !== currency || invoice.dueDate === null || invoice.dueDate > until) continue;
    const late = invoice.dueDate <= asOf;
    if (late && scenario === 'late-unpaid') continue;
    const client = names.get(invoice.clientId) ?? 'a client';
    flows.push({
      addend: {
        recordId: invoice.id, label: late ? `${invoice.number} from ${client}, late since ${day(invoice.dueDate)}, counted in the first week` : `${invoice.number} from ${client}, due ${day(invoice.dueDate)}`,
        amount: invoice.balanceMinor, display: formatMinor(invoice.balanceMinor, currency), estimate: false,
      },
      on: late ? addDaysUtc(asOf, 1) : invoice.dueDate, due: invoice.dueDate, direction: 'in', late, overdue: false, line: `Due from ${client} on ${day(invoice.dueDate)}`,
    });
  }
  for (const bill of billsDue(state, '1900-01-01', until)) {
    if (bill.currency !== currency) continue;
    const overdue = bill.dueDate <= asOf;
    const words = overdue ? `overdue since ${day(bill.dueDate)}` : `due ${day(bill.dueDate)}`;
    flows.push({
      addend: { recordId: bill.billId, label: `Bill from ${bill.vendor}, ${words}${bill.expected ? ', expected' : ''}`, amount: String(-BigInt(bill.balanceMinor)), display: formatMinor(-BigInt(bill.balanceMinor), currency), estimate: bill.expected },
      on: overdue ? addDaysUtc(asOf, 1) : bill.dueDate, due: bill.dueDate, direction: 'out', late: false, overdue, line: `Bill from ${bill.vendor}, ${words}${bill.expected ? ' (expected)' : ''}`,
    });
  }
  for (const repeat of repeatsUpTo(state, venture, until)) {
    if (repeat.dueDate <= asOf) continue;
    flows.push({
      addend: {
        recordId: `repeat:${vendorKey(repeat.vendor)}:${repeat.billDate}`, label: `Bill from ${repeat.vendor}, expected ${day(repeat.billDate)} and due ${day(repeat.dueDate)} (repeats ${repeat.recurring})`,
        amount: String(-repeat.minor), display: formatMinor(-repeat.minor, currency), estimate: true,
      },
      on: repeat.dueDate, due: repeat.dueDate, direction: 'out', late: false, overdue: false, line: `Bill from ${repeat.vendor}, due ${day(repeat.dueDate)} (expected, repeats ${repeat.recurring})`,
    });
  }
  return flows;
}

/** The `cash` receipt's addends: today's balance and what was recorded since, then what comes in and goes out up to the week. */
export function cashPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'cash' }>): SumPlan {
  const country = moneyCountry(venture);
  const { asOf, week, scenario } = subject;
  const { balances } = bankBalances(state, venture, asOf);
  const statements: Addend[] = balances.map(balance => ({
    recordId: `${balance.importId}:${balance.transactionId}`, label: `${balance.account}, balance on ${formatVentureDate(balance.on, country.dateOrder)} from your statement`,
    amount: String(balance.minor), display: formatMinor(balance.minor, country.currency), estimate: false,
  }));
  if (scenario === 'bank') {
    return {
      subject: { type: 'cash', asOf, week: asOf, scenario }, currency: country.currency, unit: 'minor', addends: statements,
      words: { label: 'In the bank on your statements', one: 'statement balance', many: 'statement balances', none: 'No bank statement with a balance.' },
    };
  }
  const opening: Addend[] = balances.length ? [...statements, ...recordedSince(state, venture, bankDay(balances), asOf)] : [];
  // Every amount ahead is projected: taken on its due date, never known. Each is marked so, and the receipt says so.
  const ahead = week > asOf ? flowsAhead(state, venture, asOf, week, scenario).filter(flow => flow.on <= week).map(flow => ({ ...flow.addend, estimate: true })) : [];
  const weeks = Math.floor(daysFrom(asOf, week) / 7);
  const usual = usualCosts(state, venture, asOf);
  const usualMinor = usualFor(usual, weeks);
  const costs: Addend[] = usualMinor > 0n ? [{
    recordId: `usual:${usual.names.join(',')}`, label: `Usual costs for ${weeks} ${weeks === 1 ? 'week' : 'weeks'}, at the average of what went out in ${monthsWords(usual.names)}`,
    amount: String(-usualMinor), display: formatMinor(-usualMinor, country.currency), estimate: true,
  }] : [];
  const shown = formatVentureDate(week, country.dateOrder);
  return {
    // A week ahead is a projection as a whole: even today's balance in it is only carried forward, so every amount is marked.
    subject: { type: 'cash', asOf, week, scenario }, currency: country.currency, unit: 'minor',
    addends: [...opening, ...ahead, ...costs].map(addend => (week > asOf ? { ...addend, estimate: true } : addend)),
    words: {
      label: week === asOf ? 'In the bank today' : `Projected ${balances.length ? 'cash in the week to' : 'in and out by'} ${shown}${scenario === 'late-unpaid' ? ', if the late invoices never pay' : ''}`,
      one: 'amount', many: 'amounts', none: 'Nothing to add up.',
    },
    estimateWords: 'Projected: every amount ahead is taken on its due date (clients paying on time, bills paid on time), and the usual costs and repeating bills are assumptions.',
  };
}

/** Per mille of the chart's scale, from its lowest point (zero at most) to its highest. */
function scale(values: readonly bigint[]): { at: (value: bigint) => number; zero: number | null } {
  const lo = values.reduce((min, value) => (value < min ? value : min), 0n);
  const hi = values.reduce((max, value) => (value > max ? value : max), lo);
  const range = hi - lo;
  const at = (value: bigint) => (range === 0n ? (value > 0n ? 1000 : 0) : countOf(((value - lo) * 1000n) / range));
  return { at, zero: lo < 0n ? at(0n) : null };
}

/**
 * 4J20: the level lines of the cash line, on round amounts (1, 2 or 5 times a power of ten in minor units): the largest
 * step that gives at least two levels other than zero from the scale's floor (zero at most) to its top, each at its per
 * mille of the scale, zero among them when the scale goes below it. Worked out in BigInt; nothing for a flat scale.
 */
function levelTicks(values: readonly bigint[], currency: string): { permille: number; label: string }[] {
  const lo = values.reduce((min, value) => (value < min ? value : min), 0n);
  const hi = values.reduce((max, value) => (value > max ? value : max), lo);
  const range = hi - lo;
  if (range <= 0n) return [];
  const steps: bigint[] = [];
  for (let power = 1n; power <= range; power *= 10n) steps.push(power, power * 2n, power * 5n);
  const ceil = (a: bigint, b: bigint) => (a >= 0n ? (a + b - 1n) / b : -(-a / b));
  const floor = (a: bigint, b: bigint) => (a >= 0n ? a / b : -((-a + b - 1n) / b));
  for (const step of steps.reverse()) {
    const levels: bigint[] = [];
    for (let k = ceil(lo, step); k <= floor(hi, step); k += 1n) levels.push(k * step);
    if (levels.filter(level => level !== 0n).length < 2) continue;
    return levels.filter(level => level !== 0n || lo < 0n).map(level => ({ permille: countOf(((level - lo) * 1000n) / range), label: formatMinor(level, currency) }));
  }
  return [];
}

/**
 * venture.money.cash {} (read): what is in the bank today and the 13 weeks ahead, projected if clients pay on time,
 * the lowest week in that case and if the late invoices never pay, the assumptions, and what is due in or out in the
 * next three weeks. Without a bank statement there is no line, only the words to import one.
 */
export async function moneyCash(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CashView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const country = moneyCountry(venture);
  const asOf = todayLocal(deps.clock, country);
  const day = (iso: IsoDate) => formatVentureDate(iso, country.dateOrder);
  const weeks = Array.from({ length: WEEKS + 1 }, (_, k) => addDaysUtc(asOf, 7 * k));
  const until = weeks[WEEKS];
  const receipt = (week: IsoDate, scenario: 'on-time' | 'late-unpaid' = 'on-time'): Promise<SumReceiptRecord> =>
    sumReceipt(deps, ctx, venture.id, cashPlan(state, venture, { type: 'cash', asOf, week, scenario }));
  const weekOf = (on: IsoDate) => weeks[Math.min(WEEKS, Math.max(1, Math.ceil(daysFrom(asOf, on) / 7)))];

  // The next three weeks by date (overdue bills first), each proved by its week's receipt, which names it.
  const onTime = flowsAhead(state, venture, asOf, until, 'on-time');
  const soon = onTime.filter(flow => !flow.late && (flow.overdue || flow.due <= addDaysUtc(asOf, NEXT_DAYS)))
    .sort((a, b) => a.due.localeCompare(b.due) || a.line.localeCompare(b.line));
  const nextWeeks: CashItemView[] = [];
  for (const flow of soon) {
    const proof = await receipt(weekOf(flow.on));
    const minor = BigInt(flow.addend.amount);
    nextWeeks.push({
      on: flow.due, line: flow.line, direction: flow.direction,
      amount: { display: formatMinor(minor < 0n ? -minor : minor, country.currency), receiptId: proof.id, kind: 'calculated', source: { from: 'receipt', receiptId: proof.id }, projected: true },
    });
  }

  // 4J20: each draft issued today, the week its money falls due on its terms, and its total as its price receipt priced it.
  const names = new Map(listRecords(state, 'venture-client', venture.id).map(client => [client.id, client.name]));
  const ifIssued: CashIssueView[] = listRecords(state, 'venture-invoice', venture.id)
    .filter(invoice => invoice.status === 'draft' && invoice.currency === country.currency && BigInt(invoice.totalMinor) > 0n && addDaysUtc(asOf, invoice.dueInDays) <= until)
    .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))
    .map(invoice => {
      const due = addDaysUtc(asOf, invoice.dueInDays);
      return {
        invoiceId: invoice.id, client: names.get(invoice.clientId) ?? 'A client', due, week: weekOf(due),
        amount: { display: formatMinor(invoice.totalMinor, invoice.currency), receiptId: invoice.priceReceiptId, kind: 'calculated' as const, source: { from: 'receipt' as const, receiptId: invoice.priceReceiptId }, projected: true as const },
      };
    });

  // What the forecast counts and what it leaves out: money in another currency, and invoices with no due date.
  const open = openInvoices(state, venture.id);
  const forecastBasis = basisOf(
    [`Open invoices and bills in ${country.currency}, each on its due date`, 'Usual costs from the last 3 full months, bills left out'],
    notCountedOf([
      otherCurrency(open.filter(invoice => invoice.currency !== country.currency).length, 'open invoice', 'open invoices', country.currency),
      otherCurrency(billsDue(state, '1900-01-01', until).filter(bill => bill.currency !== country.currency).length, 'bill', 'bills', country.currency),
      { count: open.filter(invoice => invoice.currency === country.currency && invoice.dueDate === null).length, one: 'open invoice with no due date', many: 'open invoices with no due date' },
    ]),
  );
  const { balances, missing, elsewhere } = bankBalances(state, venture, asOf);
  if (!balances.length) {
    return {
      bank: null, opening: null, points: [], lowest: { onTime: null, ifLateNeverPay: null }, usualCosts: null, assumptions: [], nextWeeks, ifIssued, ticks: [],
      basis: forecastBasis, line: 'Import a bank statement to see cash ahead.',
    };
  }

  // The assumptions, in words, carried by every projected figure.
  const lateCount = onTime.filter(flow => flow.late).length;
  const usual = usualCosts(state, venture, asOf);
  const weekly = usualFor(usual, 1);
  const usualLine = usual.months === 0 || usual.total === 0n
    ? 'No money went out in the last 3 months, so no usual costs are taken.'
    : `Usual costs of ${formatMinor(weekly, country.currency)} a week: the average of what went out in ${monthsWords(usual.names)}, bills left out because they are counted above.`;
  const assumptions = [
    `Starts from your bank balance on ${day(bankDay(balances))}, with what you recorded since.`,
    'Clients pay open invoices on their due dates.',
    ...(lateCount ? [`The ${lateCount} late ${lateCount === 1 ? 'invoice is' : 'invoices are'} paid in the first week.`] : []),
    ...(onTime.some(flow => flow.direction === 'out') ? ['Bills are paid on their due dates; overdue ones in the first week.'] : []),
    ...(onTime.some(flow => flow.addend.estimate && flow.direction === 'out') ? ['Repeating bills come again at the same amount.'] : []),
    usualLine,
    ...(usual.aiLeftOut ? [`AI spend is left out: ${country.currency === 'INR' ? 'no rupee rate set' : `no rate from US dollars to ${country.currency}`}.`] : []),
  ];

  const openingReceipt = await receipt(asOf);
  const accountsBasis = basisOf([`Bank balances in ${country.currency} from your statements`, 'Recorded since: payments you typed in and bills you paid'], notCountedOf([
    { count: missing, one: 'bank account with no balance on its statement', many: 'bank accounts with no balance on their statements' },
    otherCurrency(elsewhere, 'bank account', 'bank accounts', country.currency),
  ]));
  const opening = calculatedFigure(openingReceipt, { basis: accountsBasis });
  // The statements alone, with their own receipt: one row is reported as the file gave it; two or more are added by code.
  const bankReceipt = await sumReceipt(deps, ctx, venture.id, cashPlan(state, venture, { type: 'cash', asOf, week: asOf, scenario: 'bank' }));
  const only = balances.length === 1 ? balances[0] : null;
  const bank = {
    ...(only
      ? reportedFigure(formatMinor(only.minor, country.currency), bankReceipt.id, { recordId: only.importId, row: only.transactionId, line: `Closing balance on your ${only.account} statement, ${day(only.on)}` })
      : calculatedFigure(bankReceipt, { basis: accountsBasis })),
    on: bankDay(balances),
  };

  const forecasts: { figure: KindedFigure; minor: bigint }[] = [{ figure: opening, minor: BigInt(openingReceipt.totalMinor) }];
  for (const week of weeks.slice(1)) {
    const proof = await receipt(week);
    forecasts.push({ figure: calculatedFigure(proof, { projected: true, uses: assumptions }), minor: BigInt(proof.totalMinor) });
  }
  const { at, zero } = scale(forecasts.map(item => item.minor));
  const points: CashPointView[] = weeks.map((week, k) => ({
    week, label: k === 0 ? 'Today' : `Week to ${day(week)}`, actual: k === 0 ? opening : null, forecast: forecasts[k].figure,
    actualPermille: k === 0 ? at(forecasts[0].minor) : null, forecastPermille: at(forecasts[k].minor),
  }));

  const lowestOf = (values: readonly bigint[]) => values.reduce((best, value, index) => (index > 0 && (best === 0 || value < values[best]) ? index : best), 0);
  const minors = forecasts.map(item => item.minor);
  // 4Z2: a lowest week is named only when it falls below today's cash; one at or above it would read higher than the
  // bank balance beside it, so there is none, and the line says cash does not fall below today's.
  const low = lowestOf(minors);
  const dips = minors[low] < minors[0];
  const onTimeLow: CashLowest | null = dips ? { ...forecasts[low].figure, week: weeks[low], line: 'Lowest week, if clients pay on time' } : null;
  let lateLow: CashLowest | null = null;
  if (lateCount) {
    const totals = weeks.map(week => planTotal(cashPlan(state, venture, { type: 'cash', asOf, week, scenario: 'late-unpaid' })));
    const index = lowestOf(totals);
    if (totals[index] < minors[0]) {
      const proof = await receipt(weeks[index], 'late-unpaid');
      lateLow = { ...calculatedFigure(proof, { projected: true, uses: assumptions.filter(line => !line.startsWith(`The ${lateCount} late`)) }), week: weeks[index], line: `If the ${lateCount} late ${lateCount === 1 ? 'one never pays' : 'ones never pay'}` };
    }
  }

  const below = minors.findIndex((value, index) => index > 0 && value < 0n);
  const falls = minors.some((value, index) => index > 0 && value < minors[index - 1]);
  const line = below > 0 ? `Projected, if clients pay on time: cash goes below zero in the week to ${day(weeks[below])}.`
    : !falls ? `Projected, if clients pay on time: cash does not fall in the next ${WEEKS} weeks.`
      : !onTimeLow ? `Projected, if clients pay on time: cash does not fall below today's balance in the next ${WEEKS} weeks.`
        : `Projected, if clients pay on time: the lowest week is the week to ${day(weeks[low])}, at ${onTimeLow.display}.`;
  const usualFigure = usual.months === 0 || usual.total === 0n ? null : assumptionFigure(formatMinor(weekly, country.currency), (await receipt(weeks[1])).id, usualLine);
  return {
    bank, opening, points, lowest: { onTime: onTimeLow, ifLateNeverPay: lateLow }, usualCosts: usualFigure, assumptions, nextWeeks, ifIssued,
    ticks: levelTicks(forecasts.map(item => item.minor), country.currency), basis: forecastBasis, line,
  };
}
