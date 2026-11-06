// Payments against issued invoices. The owner types the amount, or a bank statement row gives it (venture.bank.apply);
// Chausar parses it exactly in the invoice currency, checks it against the balance by BigInt, and writes a payment fact
// for the books. Both go through recordPaymentMinor, so a bank row and a typed payment follow one path.
import { check, type Context } from '../../contracts.ts';
import { decimalMinor, formatMinor } from '../../currency.ts';
import { activateTerm, amountText, exactPayload, isoDate, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { booksReceiptFor, RECEIVED_COVERS_MORE } from './books.ts';
import { insertBooksFact, paymentFact } from './facts.ts';
import { invoiceView } from './invoices.ts';
import { recordId } from './shared.ts';
import type { InvoiceRecord, InvoiceView, IsoDate, MinorString, PaymentMethod, PaymentRecord, VentureDeps } from '../contracts.ts';

export const PAYMENT_METHODS: readonly PaymentMethod[] = Object.freeze(['bank-transfer', 'upi', 'card', 'cash', 'payment-link', 'other'] as const);

export type PaymentInput = {
  invoiceId: string;
  /** The owner's typed amount, read in the invoice currency, or exact minor units from a bank statement row. */
  amount: { typed: string } | { minor: MinorString };
  receivedOn: IsoDate;
  method: PaymentMethod;
  /** The bank statement row the payment comes from; absent when the owner typed it. */
  bankTransactionId?: string;
};
export type RecordedPayment = { paymentId: string; orderId: string; amountMinor: MinorString };

/**
 * Inside a venture transaction: records one payment of an issued invoice and its books fact, and moves the invoice's
 * paid and balance figures. Refuses a draft, a cancelled or paid invoice, a zero amount and more than the balance.
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
  const amount = 'typed' in input.amount ? BigInt(decimalMinor(input.amount.typed, invoice.currency)) : BigInt(input.amount.minor);
  check(amount > 0n, 'INVALID_AMOUNT', 'The amount must be above zero.');
  const balance = BigInt(invoice.balanceMinor);
  check(amount <= balance, 'PAYMENT_TOO_LARGE', `This is more than the balance of ${formatMinor(balance, invoice.currency)}.`);

  const base = tx.base('venture-payment');
  const fact = insertBooksFact(tx, deps.store, paymentFact(base.id, invoice, String(amount), receivedOn, method));
  const payment: PaymentRecord = {
    ...base, invoiceId: invoice.id, amountMinor: String(amount), currency: invoice.currency, receivedOn, method,
    factId: fact.id, booksReceiptId: null, booksNote: null, ...(input.bankTransactionId ? { bankTransactionId: input.bankTransactionId } : {}),
  };
  const stored = tx.put(payment);
  const left = balance - amount;
  const next: InvoiceRecord = {
    ...invoice, paidMinor: String(BigInt(invoice.paidMinor) + amount), balanceMinor: String(left), status: left === 0n ? 'paid' : 'part-paid',
  };
  tx.replace(next);
  activateTerm(tx, 'payment', { recordId: stored.id, kind: 'venture-payment' });
  tx.emit('payment-recorded', { invoiceId: invoice.id, paymentId: stored.id });
  return { paymentId: stored.id, orderId: invoice.orderId, amountMinor: stored.amountMinor };
}

/**
 * venture.payment.record (level prepare, app only, evidence). Records the payment and its fact in one
 * transaction; after the commit, asks the calculator for the received receipt of that day and order.
 */
export async function recordPayment(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.payment.record');
  const body = exactPayload(payload, ['invoiceId', 'amount', 'receivedOn', 'method'], ['invoiceId', 'amount', 'receivedOn', 'method']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  const typed = amountText(body.amount, 'Amount');
  const receivedOn = isoDate(body.receivedOn, 'Date received');
  check(typeof body.method === 'string' && (PAYMENT_METHODS as readonly string[]).includes(body.method), 'INVALID_VENTURE_REQUEST', 'Choose how the money came in.');
  const method = body.method as PaymentMethod;

  const recorded = await ventureAction(deps, ctx, 'prepare', 'payment.record', tx => recordPaymentMinor(tx, deps, { invoiceId, amount: { typed }, receivedOn, method }));

  const books = await booksReceiptFor(deps, ctx, 'received', receivedOn, recorded.orderId, recorded.amountMinor, RECEIVED_COVERS_MORE);
  return ventureAction(deps, ctx, 'prepare', 'payment.books', tx => {
    const venture = tx.venture;
    check(venture, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const payment = tx.find('venture-payment', recorded.paymentId);
    check(payment, 'INVALID_VENTURE_REQUEST', 'This payment was not found.');
    tx.replace({ ...payment, booksReceiptId: books.receiptId, booksNote: books.note });
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    return invoiceView(tx.state, venture, invoice, deps);
  });
}
