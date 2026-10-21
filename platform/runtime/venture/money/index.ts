// P3 money: price receipts, tax treatment, clients, orders, invoices, payments and the books.
// Every money number comes from BigInt code with a receipt; the existing calculator proves billed,
// received and earned from the facts written here. Loaded by the venture host on first use.
import type { VentureHandlerTable } from '../contracts.ts';
import { booksSummary } from './books.ts';
import { addClient, listClients } from './clients.ts';
import { getInvoice, issueInvoice, listInvoices, prepareInvoice } from './invoices.ts';
import { createOrder, deliverOrder, listOrders } from './orders.ts';
import { recordPayment } from './payments.ts';
import { getReceipt, quotePrice } from './quote.ts';
import { listSpend, spendPolicyGet, spendPolicySet } from './spend.ts';

export { computePrice, type PriceInput } from './price.ts';
export { taxTreatmentFor } from './tax.ts';

export const handlers: VentureHandlerTable = {
  'venture.price.quote': quotePrice,
  'venture.receipt.get': getReceipt,
  'venture.client.add': addClient,
  'venture.client.list': listClients,
  'venture.order.create': createOrder,
  'venture.order.list': listOrders,
  'venture.order.deliver': deliverOrder,
  'venture.invoice.prepare': prepareInvoice,
  'venture.invoice.issue': issueInvoice,
  'venture.invoice.get': getInvoice,
  'venture.invoice.list': listInvoices,
  'venture.payment.record': recordPayment,
  'venture.books.summary': booksSummary,
  'venture.spend.list': listSpend,
  'venture.spend.policy.get': spendPolicyGet,
  'venture.spend.policy.set': spendPolicySet,
};
