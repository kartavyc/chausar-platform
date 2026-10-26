// Chausar venture launcher, money (Ink v2 wave 4, package 4J5, M10): bills the business owes. venture.bills.add keeps
// each line with the tax name and rate the vendor charged then, and works out the tax and total in BigInt; draft,
// posted, partial, paid and overdue come from the record and the owner's calendar. venture.bills.pay records a payment
// the owner made (Chausar never moves money) and writes it to the books as a cost fact the calculator's costs count:
// for a business registered for GST, without the GST on the bill it can usually claim back (each payment's share before
// tax, the last one taking what is left so the shares add up exactly); for one not registered, the whole payment. A
// recurring bill's next one is drafted on its day (recurring.ts runs it on the engine's sweep) as an expected bill with
// the last one's lines; the real bill from the same vendor takes its place (keeping the repeat unless told), paying a
// draft posts it, and venture.bills.stop ends a repeat. billsDue serves 4J4's cash ahead; each bill payment is already a
// cost fact, so the books count it once: a bank row of the same money out is flagged as recorded (build/bank-methods.ts
// reads billPaymentList), and a bill paid after its bank row was added as a cost is recorded against that cost. The GST
// choice is kept on the bill at its first payment, and no cost is ever below zero or above the payment.
import { check, type Context, type Fact, type State } from '../../contracts.ts';
import { formatMinor } from '../../currency.ts';
import { currentVenture, exactPayload, percentBps, formatVentureDate, isoDate, listRecords, readVenture, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { addDaysUtc } from './dates.ts';
import { insertBooksFact, type BooksFactInput } from './facts.ts';
import { minorAmount, typedOrMinor } from './credits.ts';
import { taxRegistered } from './goal-plans.ts';
import { daysFrom } from './ledger.ts';
import { PAYMENT_METHODS } from './payments.ts';
import { addMonthsOn, STEP_MONTHS } from './schedule.ts';
import { recordId } from './shared.ts';
import { sumReceipt, type SumPlan } from './sums.ts';
import { TRANSFER_DAYS } from '../build/bank.ts';
import { BOOKS_SOURCE_ID } from '../records.ts';
import type {
  BillLine, BillRecord, BillResult, BillsView, BillView, IsoDate, MinorString, PaymentMethod, SumReceiptSubject, VentureDeps, VentureRecord,
} from '../contracts.ts';

/** The most lines one bill keeps, and the most expected bills one sweep drafts for one vendor. */
const MAX_LINES = 50;
const MAX_CATCH_UP = 12;

/** One line's tax at its rate, rounded half up to the minor unit. */
function lineTax(line: BillLine): bigint {
  return (BigInt(line.amountMinor) * BigInt(line.taxRateBps) + 5000n) / 10000n;
}

/** A bill's amount before tax, its tax and its total. */
export function billTotals(lines: readonly BillLine[]): { beforeTax: bigint; tax: bigint; total: bigint } {
  let beforeTax = 0n, tax = 0n;
  for (const line of lines) { beforeTax += BigInt(line.amountMinor); tax += lineTax(line); }
  return { beforeTax, tax, total: beforeTax + tax };
}

const balanceOf = (bill: BillRecord) => BigInt(bill.totalMinor) - BigInt(bill.paidMinor);
const vendorKey = (vendor: string) => vendor.trim().replace(/\s+/g, ' ').toLowerCase();

/** A bill's state on a day: a draft is expected; then paid, overdue (past its due day), partial, or posted. */
export function billState(bill: BillRecord, today: IsoDate): BillView['state'] {
  if (bill.status === 'draft') return 'draft';
  if (balanceOf(bill) <= 0n) return 'paid';
  if (daysFrom(bill.dueDate, today) > 0) return 'overdue';
  return BigInt(bill.paidMinor) > 0n ? 'partial' : 'posted';
}

/** One bill as the screens show it. */
export function billView(bill: BillRecord, today: IsoDate): BillView {
  return {
    id: bill.id, vendor: bill.vendor, billDate: bill.billDate, dueDate: bill.dueDate, total: formatMinor(bill.totalMinor, bill.currency),
    paid: formatMinor(bill.paidMinor, bill.currency), balance: formatMinor(balanceOf(bill), bill.currency), state: billState(bill, today), recurring: bill.recurring,
  };
}

/** The 'bills' subject's plan: what posted bills still owe, those due on or before a day or all of them. */
export function billsPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'bills' }>): SumPlan {
  if (subject.billId !== undefined) return oneBillPlan(state, venture, subject);
  const currency = venture.country.currency;
  const addends = listRecords(state, 'venture-bill', venture.id)
    .filter(bill => bill.status === 'posted' && bill.currency === currency && balanceOf(bill) > 0n && (subject.due === null || bill.dueDate <= subject.due))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.at.localeCompare(b.at))
    .map(bill => ({
      recordId: bill.id, label: `${bill.vendor}, due ${formatVentureDate(bill.dueDate, venture.country.dateOrder)}`,
      amount: String(balanceOf(bill)), display: formatMinor(balanceOf(bill), currency), estimate: false,
    }));
  const by = subject.due === null ? '' : ` by ${formatVentureDate(subject.due, venture.country.dateOrder)}`;
  return { subject: { ...subject }, currency, unit: 'minor', addends, words: { label: `Owed on bills${by}`, one: 'bill', many: 'bills', none: 'No bills are waiting to be paid.' } };
}

/**
 * 4J20: one bill's balance, as bills.list proves each row: each line before tax, each line's tax at the rate charged,
 * less each payment the owner recorded. A bill no longer here has no addends.
 */
function oneBillPlan(state: State, venture: VentureRecord, subject: Extract<SumReceiptSubject, { type: 'bills' }>): SumPlan {
  const bill = listRecords(state, 'venture-bill', venture.id).find(item => item.id === subject.billId);
  const currency = bill?.currency ?? venture.country.currency;
  const show = (minor: bigint) => formatMinor(minor, currency);
  const day = (iso: IsoDate) => formatVentureDate(iso, venture.country.dateOrder);
  const addends = bill ? [
    ...bill.lines.map((line, index) => ({ recordId: `${bill.id}.line-${index + 1}`, label: line.description, amount: line.amountMinor, display: show(BigInt(line.amountMinor)), estimate: false })),
    ...bill.lines.flatMap((line, index) => {
      const tax = lineTax(line);
      return tax > 0n ? [{ recordId: `${bill.id}.line-${index + 1}.tax`, label: `${line.taxName} on ${line.description}`, amount: String(tax), display: show(tax), estimate: false }] : [];
    }),
    ...bill.payments.map(payment => ({ recordId: payment.id, label: `Paid on ${day(payment.paidOn)}`, amount: String(-BigInt(payment.amountMinor)), display: show(-BigInt(payment.amountMinor)), estimate: false })),
  ] : [];
  return {
    subject: { type: 'bills', due: null, billId: subject.billId }, currency, unit: 'minor', addends,
    words: { label: bill ? `Left to pay to ${bill.vendor}` : 'Left to pay', one: 'entry', many: 'entries', none: 'This bill was not found.' },
  };
}

/** A bill still to pay, for 4J4's cash ahead. expected: a recurring bill's draft, not the real bill yet. */
export type BillDue = { billId: string; vendor: string; dueDate: IsoDate; balanceMinor: MinorString; currency: string; expected: boolean };

/** Open bills (posted, and expected drafts) due from one day to another, both included, nearest due first. */
export function billsDue(state: State, from: IsoDate, to: IsoDate): BillDue[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  return listRecords(state, 'venture-bill', venture.id)
    .filter(bill => bill.status !== 'cancelled' && balanceOf(bill) > 0n && bill.dueDate >= from && bill.dueDate <= to)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.at.localeCompare(b.at))
    .map(bill => ({ billId: bill.id, vendor: bill.vendor, dueDate: bill.dueDate, balanceMinor: String(balanceOf(bill)), currency: bill.currency, expected: bill.status === 'draft' }));
}

/** Each bill payment from one day to another, both included, with the cost fact it wrote, for 4J4's money out. */
export function billPayments(state: State, from: IsoDate, to: IsoDate): { billId: string; vendor: string; paidOn: IsoDate; amountMinor: MinorString; factId: string | null }[] {
  const venture = currentVenture(state);
  if (!venture) return [];
  return listRecords(state, 'venture-bill', venture.id).flatMap(bill => bill.payments
    .filter(payment => payment.paidOn >= from && payment.paidOn <= to)
    .map(payment => ({ billId: bill.id, vendor: bill.vendor, paidOn: payment.paidOn, amountMinor: payment.amountMinor, factId: payment.factId })));
}

/**
 * Every bill payment that wrote its own cost fact, for the bank ledger (build/bank-methods.ts): a bank row of the same
 * money out a few days apart is that payment, already in the books. A payment recorded against a bank row's own cost
 * fact is that row's already, so it is left out.
 */
export function billPaymentList(state: State, ventureId: string): { billId: string; vendor: string; paymentId: string; paidOn: IsoDate; amountMinor: MinorString; currency: string }[] {
  const own = new Set(state.facts.filter(fact => fact.kind === 'cost' && typeof fact.fields.billId === 'string').map(fact => fact.id));
  return listRecords(state, 'venture-bill', ventureId).flatMap(bill => bill.payments
    .filter(payment => payment.factId !== null && own.has(payment.factId))
    .map(payment => ({ billId: bill.id, vendor: bill.vendor, paymentId: payment.id, paidOn: payment.paidOn, amountMinor: payment.amountMinor, currency: bill.currency })));
}

/** A cost fact a bank row added for exactly this money out, a few days from the day paid, that no bill payment uses yet. */
function bankCostFor(state: State, bills: readonly BillRecord[], currency: string, amount: bigint, paidOn: IsoDate): Fact | undefined {
  const used = new Set(bills.flatMap(bill => bill.payments.map(payment => payment.factId)));
  return state.facts.find(fact => fact.kind === 'cost' && fact.sourceId === BOOKS_SOURCE_ID && !fact.supersededAt && typeof fact.fields.bankReference === 'string'
    && fact.fields.currency === currency && fact.fields.amountMinor === String(amount) && !used.has(fact.id) && Math.abs(daysFrom(fact.validFrom, paidOn)) <= TRANSFER_DAYS);
}

/** A bill's lines as a payload gives them, each with its tax name and rate as charged. */
function linesInput(value: unknown, currency: string): BillLine[] {
  check(Array.isArray(value) && value.length >= 1 && value.length <= MAX_LINES, 'INVALID_VENTURE_REQUEST', `A bill has 1 to ${MAX_LINES} lines.`);
  return value.map(item => {
    // 4J20: the amount as typed (amount, in the business's currency) or in minor units; the rate as typed (taxRate, a
    // percentage) or in basis points; one of each.
    const line = exactPayload(item, ['description', 'amount', 'amountMinor', 'taxName', 'taxRate', 'taxRateBps'], ['description', 'taxName']);
    const description = singleLine(line.description, 'A line', { min: 1, max: 200 });
    const amountMinor = String(typedOrMinor(line.amount, line.amountMinor, currency, 'A line amount'));
    check((line.taxRate === undefined) !== (line.taxRateBps === undefined), 'INVALID_TAX_RATE', 'Give the tax rate once, like 18 for 18%, or 0 for no tax.');
    if (line.taxRateBps !== undefined) check(typeof line.taxRateBps === 'string' && /^\d{1,5}$/.test(line.taxRateBps) && BigInt(line.taxRateBps) <= 10000n, 'INVALID_TAX_RATE', 'A tax rate is whole basis points from 0 to 10000, like 1800 for 18%.');
    const taxRateBps = line.taxRate !== undefined ? percentBps(line.taxRate, 'The tax rate') : String(BigInt(line.taxRateBps as string));
    check(typeof line.taxName === 'string', 'INVALID_VENTURE_REQUEST', 'Give the tax name, like GST, or leave it empty for no tax.');
    const taxName = taxRateBps === '0' && line.taxName.trim() === '' ? '' : singleLine(line.taxName, 'The tax name', { min: 1, max: 40 });
    return { description, amountMinor, taxName, taxRateBps };
  });
}

/** The cost fact of one bill payment: its share before any tax the business can claim back, by the day it was paid. */
function costFactOf(bill: BillRecord, entityId: string, cost: bigint, tax: bigint, paidOn: IsoDate, method: PaymentMethod): BooksFactInput {
  return {
    entityId, kind: 'cost', validFrom: paidOn,
    fields: { amountMinor: String(cost), taxMinor: String(tax), currency: bill.currency, description: `Bill from ${bill.vendor}`, billId: bill.id, paymentMethod: method, costType: 'bill' },
  };
}

/** The calculator's costs receipt for one day, kept only when its total is exactly this cost. A failure never undoes the payment. */
async function costReceipt(deps: VentureDeps, ctx: Context, date: IsoDate, minor: string): Promise<string | null> {
  try {
    const receipt = await deps.services.calculator.calculate(ctx, { operation: 'costs', period: { from: date, to: date } });
    return typeof receipt?.id === 'string' && receipt.totalMinor === minor ? receipt.id : null;
  } catch {
    return null;
  }
}

/**
 * venture.bills.add { vendor, lines, billDate, dueDate, recurring? } (approve, app only): a bill the business got. When
 * an expected draft from the same vendor waits, this bill takes its place and keeps its repeat, unless recurring is
 * given (null: it does not repeat). Answers the bill and the owed receipt.
 */
export async function billsAdd(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillResult> {
  requireAppChannel(ctx, 'venture.bills.add');
  const body = exactPayload(payload, ['vendor', 'lines', 'billDate', 'dueDate', 'recurring'], ['vendor', 'lines', 'billDate', 'dueDate']);
  const vendor = singleLine(body.vendor, 'The vendor', { min: 1, max: 120 }).replace(/\s+/g, ' ');
  const lines = linesInput(body.lines, readVenture(deps, ctx).venture.country.currency);
  const billDate = isoDate(body.billDate, 'Bill date');
  const dueDate = isoDate(body.dueDate, 'Due date');
  check(dueDate >= billDate, 'INVALID_VENTURE_REQUEST', 'The due date must be on or after the bill date.');
  check(body.recurring === undefined || body.recurring === null || body.recurring === 'monthly' || body.recurring === 'quarterly', 'INVALID_VENTURE_REQUEST', 'A bill repeats monthly or quarterly, or not at all.');
  const given = body.recurring as BillRecord['recurring'] | undefined;
  const stored = await ventureAction(deps, ctx, 'approve', 'bills.add', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const expected = tx.list('venture-bill').find(bill => bill.status === 'draft' && vendorKey(bill.vendor) === vendorKey(vendor));
    const fields = {
      vendor, lines, currency: venture.country.currency, billDate, dueDate, recurring: given === undefined ? (expected?.recurring ?? null) : given,
      status: 'posted' as const, totalMinor: String(billTotals(lines).total),
    };
    if (expected) return tx.replace<BillRecord>({ ...expected, ...fields });
    return tx.put<BillRecord>({ ...tx.base('venture-bill'), ...fields, paidMinor: '0', payments: [] });
  });
  const { state, venture } = readVenture(deps, ctx);
  const receipt = await sumReceipt(deps, ctx, venture.id, billsPlan(state, venture, { type: 'bills', due: null }));
  return { bill: billView(stored, localDayAt(deps.clock(), venture.country)), receiptId: receipt.id };
}

/**
 * venture.bills.pay { billId, amountMinor, paidOn, method } (approve, app only): records a payment the owner made of a
 * bill, never over what is left (BILL_PAYMENT_TOO_LARGE), as a cost fact; paying an expected draft posts it. Chausar
 * moves no money. Answers the bill and the calculator's costs receipt for that day when it is exactly this cost.
 */
export async function billsPay(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillResult> {
  requireAppChannel(ctx, 'venture.bills.pay');
  // 4J20: the payment as typed (amount, in the bill's currency) or in minor units (amountMinor), one of them.
  const body = exactPayload(payload, ['billId', 'amount', 'amountMinor', 'paidOn', 'method'], ['billId', 'paidOn', 'method']);
  const billId = recordId(body.billId, 'Bill');
  check((body.amount === undefined) !== (body.amountMinor === undefined), 'INVALID_AMOUNT', 'Give the payment once, as you would type it, like 1500 or 1500.50.');
  if (body.amountMinor !== undefined) minorAmount(body.amountMinor, 'The payment');
  const paidOn = isoDate(body.paidOn, 'Date paid');
  check(typeof body.method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(body.method), 'INVALID_VENTURE_REQUEST', 'Choose how you paid it.');
  const method = body.method as PaymentMethod;
  const done = await ventureAction(deps, ctx, 'approve', 'bills.pay', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const bill = tx.find('venture-bill', billId);
    check(bill, 'INVALID_VENTURE_REQUEST', 'This bill was not found.');
    const amount = typedOrMinor(body.amount, body.amountMinor, bill.currency, 'The payment');
    const balance = balanceOf(bill);
    check(amount <= balance, 'BILL_PAYMENT_TOO_LARGE', balance <= 0n ? 'This bill is already paid in full.' : `This is more than the ${formatMinor(balance, bill.currency)} left to pay on this bill.`);
    const { beforeTax, total } = billTotals(bill.lines);
    const left = balance - amount;
    // The GST choice of the bill's first payment holds for every payment of it, whatever the registration is later.
    const claims = bill.taxClaimed ?? taxRegistered(tx.state, venture);
    const entityId = `${bill.id}.payment-${bill.payments.length + 1}`;
    // A bank row already added this money out as a cost: the payment is recorded against that cost, never a second one.
    const banked = bankCostFor(tx.state, tx.list('venture-bill'), bill.currency, amount, paidOn);
    let cost = 0n;
    let factId: string;
    if (banked) {
      factId = banked.id;
    } else {
      cost = amount;
      if (claims && total > 0n) {
        const counted = bill.payments.reduce((sum, item) => sum + BigInt(String(tx.state.facts.find(fact => fact.id === item.factId)?.fields.amountMinor ?? '0')), 0n);
        cost = left === 0n ? beforeTax - counted : (amount * beforeTax * 2n + total) / (2n * total);
      }
      cost = cost < 0n ? 0n : cost > amount ? amount : cost;
      factId = insertBooksFact(tx, deps.store, costFactOf(bill, entityId, cost, amount - cost, paidOn, method)).id;
    }
    const next = tx.replace<BillRecord>({
      ...bill, status: 'posted', paidMinor: String(BigInt(bill.paidMinor) + amount), taxClaimed: claims,
      payments: [...bill.payments, { id: entityId, amountMinor: String(amount), paidOn, method, factId }],
    });
    return { bill: next, cost, banked: banked !== undefined, today: localDayAt(tx.now, venture.country) };
  });
  const receiptId = done.banked ? null : await costReceipt(deps, ctx, paidOn, String(done.cost));
  return { bill: billView(done.bill, done.today), ...(receiptId ? { receiptId } : {}) };
}

/**
 * venture.bills.stop { billId } (approve, app only): ends the repeat of that bill's vendor. Every bill of the repeat
 * stops repeating, and an expected bill of it that waits is cancelled: it is never shown or counted again. Answers the
 * bills as venture.bills.list does.
 */
export async function billsStop(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillsView> {
  requireAppChannel(ctx, 'venture.bills.stop');
  const body = exactPayload(payload, ['billId'], ['billId']);
  const billId = recordId(body.billId, 'Bill');
  await ventureAction(deps, ctx, 'approve', 'bills.stop', tx => {
    const bill = tx.find('venture-bill', billId);
    check(bill && bill.status !== 'cancelled', 'INVALID_VENTURE_REQUEST', 'This bill was not found.');
    const chain = tx.list('venture-bill').filter(item => item.recurring !== null && item.status !== 'cancelled' && vendorKey(item.vendor) === vendorKey(bill.vendor));
    check(chain.length > 0, 'INVALID_VENTURE_REQUEST', 'This bill does not repeat.');
    for (const item of chain) tx.replace<BillRecord>({ ...item, recurring: null, ...(item.status === 'draft' ? { status: 'cancelled' as const } : {}) });
  });
  return billsList(deps, ctx, {});
}

/** venture.bills.list {} (read): every bill, the nearest due first, and what open bills owe with its receipt. */
export async function billsList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BillsView> {
  exactPayload(payload, []);
  const { state, venture } = readVenture(deps, ctx);
  const today = localDayAt(deps.clock(), venture.country);
  const records = listRecords(state, 'venture-bill', venture.id).filter(bill => bill.status !== 'cancelled')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.billDate.localeCompare(b.billDate) || a.at.localeCompare(b.at));
  // 4J20: each bill's balance with its own receipt, so a row's amount opens how it was made.
  const bills: BillView[] = [];
  for (const bill of records) {
    const own = await sumReceipt(deps, ctx, venture.id, oneBillPlan(state, venture, { type: 'bills', due: null, billId: bill.id }));
    bills.push({ ...billView(bill, today), receiptId: own.id });
  }
  const plan = billsPlan(state, venture, { type: 'bills', due: null });
  if (!plan.addends.length) return { bills, owed: null };
  const receipt = await sumReceipt(deps, ctx, venture.id, plan);
  return { bills, owed: { display: formatMinor(receipt.totalMinor, receipt.currency), receiptId: receipt.id } };
}

/** The latest bill of each vendor whose bills repeat, with the day of the month its chain started on. */
function repeatingChains(bills: readonly BillRecord[]): { latest: BillRecord; day: number }[] {
  const chains = new Map<string, BillRecord[]>();
  for (const bill of bills) {
    if (bill.recurring === null || bill.status === 'cancelled') continue;
    const key = vendorKey(bill.vendor);
    chains.set(key, [...(chains.get(key) ?? []), bill]);
  }
  return [...chains.values()].map(chain => {
    const ordered = [...chain].sort((a, b) => a.billDate.localeCompare(b.billDate) || a.at.localeCompare(b.at));
    return { latest: ordered[ordered.length - 1], day: parseInt(ordered[0].billDate.slice(8, 10), 10) };
  });
}

/** The next bill date of a repeating chain after its latest bill. */
function nextBillDate(latest: BillRecord, day: number): IsoDate {
  return addMonthsOn(latest.billDate, STEP_MONTHS[latest.recurring as 'monthly' | 'quarterly'], day);
}

/** Whether a repeating bill's next one is due by a day: the sweep writes nothing when none is. */
export function repeatingBillsDue(state: State, venture: VentureRecord, today: IsoDate): boolean {
  return repeatingChains(listRecords(state, 'venture-bill', venture.id)).some(({ latest, day }) => latest.recurring !== null && nextBillDate(latest, day) <= today);
}

/**
 * Inside a venture transaction: drafts each repeating bill's next ones up to a day, as expected bills with the latest
 * bill's lines and the same days between bill and due date. Answers how many it drafted.
 */
export function draftDueBillsIn(tx: VentureTx, today: IsoDate): number {
  let drafted = 0;
  for (const { latest: start, day } of repeatingChains(tx.list('venture-bill'))) {
    let latest = start;
    for (let count = 0; count < MAX_CATCH_UP && latest.recurring !== null; count++) {
      const billDate = nextBillDate(latest, day);
      if (billDate > today) break;
      const gap = daysFrom(latest.billDate, latest.dueDate);
      latest = tx.put<BillRecord>({
        ...tx.base('venture-bill'), vendor: latest.vendor, lines: latest.lines.map(line => ({ ...line })), currency: latest.currency, billDate,
        dueDate: addDaysUtc(billDate, gap), recurring: latest.recurring, status: 'draft', totalMinor: String(billTotals(latest.lines).total), paidMinor: '0', payments: [],
      });
      drafted++;
    }
  }
  return drafted;
}
