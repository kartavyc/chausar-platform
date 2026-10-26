// Payments against issued invoices. The owner types the amount, or a bank statement row gives it (venture.bank.apply);
// Chausar parses it exactly in the invoice currency, checks it against the balance by BigInt, and writes a payment fact
// for the books. Both go through recordPaymentMinor, so a bank row and a typed payment follow one path.
// Ink v2 wave 4 (4J5, M11, M15): a cheque is pending until the owner clears it (venture.payment.clear) or a bank row
// pays it; only cleared money is received, so a pending cheque has no books fact and leaves the balance as it is, but
// holds its amount so nothing else takes it. One payment can be split across invoices: each part is its own record,
// the parts add up to the payment exactly, and none goes over its invoice's free balance. TDS the client deducted (India
// only) is kept on the payment with its section and settles the invoice beside the cash; it is not money received.
import { check, type Context } from '../../contracts.ts';
import { decimalMinor, formatMinor } from '../../currency.ts';
import { activateTerm, amountText, exactPayload, isoDate, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { booksReceiptFor, RECEIVED_COVERS_MORE } from './books.ts';
import { insertBooksFact, paymentFact, type BooksFactInput } from './facts.ts';
import { invoiceView } from './invoices.ts';
import { freeBalance, paymentState, settledBy } from './ledger.ts';
import { recordId } from './shared.ts';
import { tdsSection } from './tax-kinds.ts';
import type { InvoiceRecord, InvoiceView, IsoDate, MinorString, PaymentMethod, PaymentRecord, VentureDeps } from '../contracts.ts';

export const PAYMENT_METHODS: readonly PaymentMethod[] = Object.freeze(['bank-transfer', 'upi', 'card', 'cash', 'payment-link', 'other', 'cheque'] as const);
/** The most invoices one payment is split across. */
const MAX_PARTS = 20;

type Amount = { typed: string } | { minor: MinorString };
export type PaymentInput = {
  invoiceId: string;
  /** The owner's typed amount, read in the invoice currency, or exact minor units from a bank statement row. */
  amount: Amount;
  receivedOn: IsoDate;
  method: PaymentMethod;
  /** The bank statement row the payment comes from; absent when the owner typed it. */
  bankTransactionId?: string;
  /** TDS the client deducted, read like amount (India only). */
  tds?: { section: string; amount: Amount };
  /** One part of a payment split across invoices. */
  split?: { groupId: string; totalMinor: MinorString };
};
export type RecordedPayment = { paymentId: string; orderId: string; amountMinor: MinorString };
/** A payment the books can now count, for its receipt after the commit. */
type Counted = { paymentId: string; orderId: string; amountMinor: MinorString; date: IsoDate };

function minorOf(amount: Amount, currency: string): bigint {
  return 'typed' in amount ? BigInt(decimalMinor(amount.typed, currency)) : BigInt(amount.minor);
}

/** The payment fact, with the TDS beside it when the client deducted some. */
function factOf(paymentId: string, invoice: InvoiceRecord, amountMinor: MinorString, on: IsoDate, method: PaymentMethod, tds: PaymentRecord['tds'] | null): BooksFactInput {
  const fact = paymentFact(paymentId, invoice, amountMinor, on, method);
  return tds ? { ...fact, fields: { ...fact.fields, tdsMinor: tds.amountMinor, tdsSection: tds.section } } : fact;
}

/** Moves an invoice's paid and balance figures by what a payment settles. */
function settleInvoice(tx: VentureTx, invoice: InvoiceRecord, settles: bigint): void {
  const left = BigInt(invoice.balanceMinor) - settles;
  check(left >= 0n, 'PAYMENT_TOO_LARGE', `This is more than the balance of ${formatMinor(invoice.balanceMinor, invoice.currency)}.`);
  tx.replace<InvoiceRecord>({ ...invoice, paidMinor: String(BigInt(invoice.paidMinor) + settles), balanceMinor: String(left), status: left === 0n ? 'paid' : 'part-paid' });
}

/**
 * Inside a venture transaction: clears a pending cheque, and every other part of the same split payment, on a day.
 * Each part gets its books fact and moves its invoice; the cheque's own day stays as chequeOn. A bank row that paid it
 * is kept on the part it matched.
 */
export function clearIn(tx: VentureTx, deps: VentureDeps, payment: PaymentRecord, on: IsoDate, bankTransactionId?: string): Counted[] {
  const group = payment.split
    ? tx.list('venture-payment').filter(item => item.split?.groupId === payment.split?.groupId && paymentState(item) === 'pending')
    : [payment];
  const counted: Counted[] = [];
  for (const part of group) {
    const invoice = tx.find('venture-invoice', part.invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'The invoice of this payment was not found.');
    const fact = insertBooksFact(tx, deps.store, factOf(part.id, invoice, part.amountMinor, on, part.method, part.tds ?? null));
    settleInvoice(tx, invoice, settledBy(part));
    tx.replace<PaymentRecord>({
      ...part, state: 'cleared', chequeOn: part.receivedOn, receivedOn: on, factId: fact.id, clearedBy: tx.ctx.memberId, clearedAt: tx.now,
      ...(bankTransactionId && part.id === payment.id ? { bankTransactionId } : {}),
    });
    tx.emit('payment-recorded', { invoiceId: invoice.id, paymentId: part.id });
    counted.push({ paymentId: part.id, orderId: invoice.orderId, amountMinor: part.amountMinor, date: on });
  }
  return counted;
}

/**
 * Inside a venture transaction: records one payment of an issued invoice and, once it counts, its books fact, and moves
 * the invoice's paid and balance figures. Refuses a draft, a cancelled or paid invoice, a zero amount and more than the
 * balance that nothing holds. A cheque the owner typed is pending; a bank row that pays a cheque still waiting on this
 * invoice, for exactly its amount, clears that cheque instead of recording a second payment.
 */
export function recordPaymentMinor(tx: VentureTx, deps: VentureDeps, input: PaymentInput): RecordedPayment {
  const { invoiceId, receivedOn, method } = input;
  const venture = tx.venture;
  check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
  const invoice = tx.find('venture-invoice', invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  check(invoice.status !== 'draft', 'INVALID_VENTURE_REQUEST', 'Issue this invoice before you record a payment.');
  check(invoice.status !== 'void', 'INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
  check(invoice.status !== 'paid', 'PAYMENT_TOO_LARGE', 'This invoice is already paid in full.');
  const amount = minorOf(input.amount, invoice.currency);
  check(amount > 0n, 'INVALID_AMOUNT', 'The amount must be above zero.');
  const payments = tx.list('venture-payment');

  if (input.bankTransactionId && !input.tds && !input.split) {
    const cheque = payments.find(item => item.invoiceId === invoice.id && paymentState(item) === 'pending' && !item.split && !item.tds && BigInt(item.amountMinor) === amount);
    if (cheque) {
      clearIn(tx, deps, cheque, receivedOn, input.bankTransactionId);
      return { paymentId: cheque.id, orderId: invoice.orderId, amountMinor: cheque.amountMinor };
    }
  }

  let tds: PaymentRecord['tds'] | null = null;
  if (input.tds) {
    check(venture.country.code === 'IN', 'INVALID_VENTURE_REQUEST', 'TDS is an Indian withholding. Record only the money that came in.');
    const withheld = minorOf(input.tds.amount, invoice.currency);
    check(withheld > 0n, 'INVALID_AMOUNT', 'The TDS must be above zero.');
    tds = { section: input.tds.section, amountMinor: String(withheld) };
  }
  const settles = amount + BigInt(tds?.amountMinor ?? '0');
  const balance = BigInt(invoice.balanceMinor);
  const free = freeBalance(invoice, payments, tx.list('venture-credit-note'));
  check(settles <= free, 'PAYMENT_TOO_LARGE', free === balance
    ? `This is more than the balance of ${formatMinor(balance, invoice.currency)}.`
    : `This is more than the ${formatMinor(free, invoice.currency)} free to pay: a cheque or a credit note waiting holds the rest of the ${formatMinor(balance, invoice.currency)} balance.`);

  const pending = method === 'cheque' && !input.bankTransactionId;
  const base = tx.base('venture-payment');
  const fact = pending ? null : insertBooksFact(tx, deps.store, factOf(base.id, invoice, String(amount), receivedOn, method, tds));
  const payment: PaymentRecord = {
    ...base, invoiceId: invoice.id, amountMinor: String(amount), currency: invoice.currency, receivedOn, method,
    factId: fact?.id ?? null, booksReceiptId: null, booksNote: null, ...(input.bankTransactionId ? { bankTransactionId: input.bankTransactionId } : {}),
    ...(pending ? { state: 'pending' as const } : {}), ...(input.split ? { split: { ...input.split } } : {}), ...(tds ? { tds } : {}),
  };
  const stored = tx.put(payment);
  if (!pending) settleInvoice(tx, invoice, settles);
  activateTerm(tx, 'payment', { recordId: stored.id, kind: 'venture-payment' });
  tx.emit('payment-recorded', { invoiceId: invoice.id, paymentId: stored.id });
  return { paymentId: stored.id, orderId: invoice.orderId, amountMinor: stored.amountMinor };
}

/** TDS as a payload gives it: the section the client named and the amount, typed. */
function tdsInput(value: unknown): { section: string; amount: { typed: string } } {
  const body = exactPayload(value, ['section', 'amount'], ['section', 'amount']);
  return { section: tdsSection(body.section), amount: { typed: amountText(body.amount, 'TDS') } };
}

/** The parts of a split payment as a payload gives them: one per invoice, each typed. */
function partsInput(value: unknown): { invoiceId: string; typed: string }[] {
  check(Array.isArray(value) && value.length >= 1 && value.length <= MAX_PARTS, 'INVALID_VENTURE_REQUEST', `Split a payment across 1 to ${MAX_PARTS} invoices.`);
  const parts = value.map(item => {
    const part = exactPayload(item, ['invoiceId', 'amount'], ['invoiceId', 'amount']);
    return { invoiceId: recordId(part.invoiceId, 'Invoice'), typed: amountText(part.amount, 'Amount') };
  });
  check(new Set(parts.map(part => part.invoiceId)).size === parts.length, 'INVALID_VENTURE_REQUEST', 'Name each invoice once.');
  return parts;
}

/** The calculator's received receipt for each payment the books can now count, kept on the payment. After a commit. */
async function sealBooks(deps: VentureDeps, ctx: Context, counted: readonly Counted[]): Promise<void> {
  if (!counted.length) return;
  const books: { id: string; receiptId: string | null; note: string | null }[] = [];
  for (const item of counted) books.push({ id: item.paymentId, ...await booksReceiptFor(deps, ctx, 'received', item.date, item.orderId, item.amountMinor, RECEIVED_COVERS_MORE) });
  await ventureAction(deps, ctx, 'prepare', 'payment.books', tx => {
    for (const item of books) {
      const payment = tx.find('venture-payment', item.id);
      check(payment, 'INVALID_VENTURE_REQUEST', 'This payment was not found.');
      tx.replace({ ...payment, booksReceiptId: item.receiptId, booksNote: item.note });
    }
  });
}

/** The view of one invoice as it is now. Reads only. */
function viewOf(deps: VentureDeps, ctx: Context, invoiceId: string): InvoiceView {
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  return invoiceView(state, venture, invoice, deps);
}

/**
 * venture.payment.record { invoiceId | allocations, amount, receivedOn, method, tds? } (level prepare, app only,
 * evidence). Records the payment (or each part of a split one) and its fact in one transaction; after the commit, asks
 * the calculator for the received receipt of each part the books count now. Answers the (first) invoice's view.
 */
export async function recordPayment(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.payment.record');
  const body = exactPayload(payload, ['invoiceId', 'amount', 'receivedOn', 'method', 'allocations', 'tds'], ['amount', 'receivedOn', 'method']);
  check((body.invoiceId === undefined) !== (body.allocations === undefined), 'INVALID_VENTURE_REQUEST', 'Name one invoice, or split the payment across invoices, not both.');
  const typed = amountText(body.amount, 'Amount');
  const receivedOn = isoDate(body.receivedOn, 'Date received');
  check(typeof body.method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(body.method), 'INVALID_VENTURE_REQUEST', 'Choose how the money came in.');
  const method = body.method as PaymentMethod;
  check(body.tds === undefined || body.allocations === undefined, 'INVALID_VENTURE_REQUEST', 'TDS goes on a payment of one invoice.');
  const tds = body.tds === undefined ? null : tdsInput(body.tds);
  const parts = body.allocations === undefined ? null : partsInput(body.allocations);
  const invoiceId = parts ? parts[0].invoiceId : recordId(body.invoiceId, 'Invoice');

  const recorded = await ventureAction(deps, ctx, 'prepare', 'payment.record', tx => {
    if (!parts) return [recordPaymentMinor(tx, deps, { invoiceId, amount: { typed }, receivedOn, method, ...(tds ? { tds } : {}) })];
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const currency = venture.country.currency;
    const total = BigInt(decimalMinor(typed, currency));
    const minors = parts.map(part => ({ invoiceId: part.invoiceId, minor: BigInt(decimalMinor(part.typed, currency)) }));
    const sum = minors.reduce((added, part) => added + part.minor, 0n);
    check(sum <= total, 'PAYMENT_TOO_LARGE', `The parts add up to ${formatMinor(sum, currency)}, more than the payment of ${formatMinor(total, currency)}.`);
    check(sum === total, 'INVALID_AMOUNT', `The parts add up to ${formatMinor(sum, currency)}; the payment is ${formatMinor(total, currency)}. Give every part of it an invoice.`);
    const split = { groupId: tx.base('venture-payment').id, totalMinor: String(total) };
    return minors.map(part => {
      const invoice = tx.find('venture-invoice', part.invoiceId);
      check(!invoice || invoice.currency === currency, 'CURRENCY_CONFLICT', `This business keeps its books in ${currency}.`);
      return recordPaymentMinor(tx, deps, { invoiceId: part.invoiceId, amount: { minor: String(part.minor) }, receivedOn, method, split });
    });
  });

  const stored = listRecords(deps.store.read(), 'venture-payment');
  const counted = recorded.filter(item => {
    const payment = stored.find(record => record.id === item.paymentId);
    return payment !== undefined && paymentState(payment) === 'cleared';
  }).map(item => ({ ...item, date: receivedOn }));
  await sealBooks(deps, ctx, counted);
  return viewOf(deps, ctx, invoiceId);
}

/**
 * venture.payment.clear { paymentId } (approve, app only): the owner says a pending cheque reached the bank today, on
 * their calendar. It and the other parts of its split payment count from that day: books facts, balances, receipts.
 */
export async function clearPayment(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.payment.clear');
  const body = exactPayload(payload, ['paymentId'], ['paymentId']);
  const paymentId = recordId(body.paymentId, 'Payment');
  const result = await ventureAction(deps, ctx, 'approve', 'payment.clear', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const payment = tx.find('venture-payment', paymentId);
    check(payment, 'INVALID_VENTURE_REQUEST', 'This payment was not found.');
    check(paymentState(payment) === 'pending', 'INVALID_VENTURE_REQUEST', 'This payment has already cleared.');
    return { invoiceId: payment.invoiceId, counted: clearIn(tx, deps, payment, localDayAt(tx.now, venture.country)) };
  });
  await sealBooks(deps, ctx, result.counted);
  return viewOf(deps, ctx, result.invoiceId);
}
