// P3 money: price receipts, tax treatment, clients, orders, invoices, payments and the books.
// Every money number comes from BigInt code with a receipt; the existing calculator proves billed,
// received and earned from the facts written here. Loaded by the venture host on first use.
import { ChausarError } from '../../contracts.ts';
import type { VentureHandlerTable } from '../contracts.ts';
import { booksSummary } from './books.ts';
import { addClient, listClients } from './clients.ts';
import { getInvoice, issueInvoice, listInvoices, prepareInvoice } from './invoices.ts';
import { createOrder, deliverOrder, listOrders } from './orders.ts';
import { clearPayment, recordPayment } from './payments.ts';
import { billsAdd, billsList, billsPay, billsStop } from './bills.ts';
import { creditIssue } from './credits.ts';
import { recurringList, recurringSet } from './recurring.ts';
import { invoiceRemind } from './reminders.ts';
import { getReceipt, quotePrice } from './quote.ts';
import { listSpend, spendPolicyGet, spendPolicySet } from './spend.ts';
import { moneyOverview } from './overview.ts';
import { taxWorking } from './tax-working.ts';
import { getGoal, setGoal, suggestGoal } from './goals.ts';
import { moneyAging } from './aging.ts';
import { moneyFlow } from './flow.ts';
import { moneyCash } from './cash.ts';
import { moneyMargins } from './margins.ts';
import { moneyExport } from './export.ts';
import { receiptVerifyHandler } from '../journal/signing.ts';
import { orderContractGet, orderContractPropose, orderContractSign } from './order-contracts.ts';
import { moneyAcross } from './across.ts';

export { computePrice, type PriceInput } from './price.ts';
// 4J6: the open business's summary for the others on this computer; the host's snapshot() reads it.
export { businessSnapshot } from './across.ts';
export { taxTreatmentFor } from './tax.ts';

/** A wave 4 method whose package has not landed yet: listed, so the contract and the desktop see it, and refused. */
const notBuiltYet = async (): Promise<never> => { throw new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.'); };

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
  'venture.money.overview': moneyOverview,
  'venture.tax.working': taxWorking,
  // Ink v2 wave 4 (package 4-0 registered these; each package replaces its own lines). 4I1 goals.
  'venture.goals.get': getGoal,
  'venture.goals.set': setGoal,
  'venture.goals.suggest': suggestGoal,
  // 4J4 aging, in and out, cash, margins, the export for the CA.
  'venture.money.aging': moneyAging,
  'venture.money.flow': moneyFlow,
  'venture.money.cash': moneyCash,
  'venture.money.margins': moneyMargins,
  'venture.money.export': moneyExport,
  // 4J5 bills, credit notes, recurring invoices, reminders, clearing a payment.
  'venture.bills.add': billsAdd,
  'venture.bills.pay': billsPay,
  'venture.bills.list': billsList,
  'venture.credit.issue': creditIssue,
  'venture.invoice.recurring': recurringSet,
  'venture.invoice.recurringList': recurringList,
  'venture.invoice.remind': invoiceRemind,
  'venture.payment.clear': clearPayment,
  'venture.bills.stop': billsStop,
  // 4J6 money across businesses; 4J10 receipt signatures; 4J12 order contracts.
  'venture.money.across': moneyAcross,
  'venture.receipt.verify': receiptVerifyHandler,
  'venture.order.contract': orderContractGet,
  'venture.order.contract.propose': orderContractPropose,
  'venture.order.contract.sign': orderContractSign,
};
