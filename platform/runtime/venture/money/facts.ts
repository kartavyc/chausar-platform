// Facts the venture writes into the books, so the existing calculator proves billed, received and earned.
// Written only inside a venture transaction with insertFacts (the one write helper allowed there).
import { check, type Fact, type StateStore } from '../../contracts.ts';
import { currentAccess, insertFacts, type FactInput } from '../../memory.ts';
import { BOOKS_SOURCE_ID, stateView, type VentureTx } from '../records.ts';
import type { ClientRecord, InvoiceRecord, IsoDate, MinorString, OrderRecord, PaymentMethod } from '../contracts.ts';

export type BooksFactInput = Omit<FactInput, 'sourceId' | 'sourceRow'>;

/** 1 plus the number of facts already in the books source. */
export function nextBooksRow(state: { facts: Fact[] }): number {
  return 1 + state.facts.filter(f => f.sourceId === BOOKS_SOURCE_ID).length;
}

/**
 * Checks that the member may write to the books source, then inserts one fact learned at the transaction's time.
 * Returns the stored fact.
 */
export function insertBooksFact(tx: VentureTx, store: StateStore, input: BooksFactInput): Fact {
  currentAccess(stateView(tx.state, store), tx.ctx, undefined, BOOKS_SOURCE_ID);
  const fact: FactInput = { ...input, sourceId: BOOKS_SOURCE_ID, sourceRow: nextBooksRow(tx.state) };
  const created = insertFacts(tx.state, [fact], tx.now);
  check(created.length === 1, 'INVALID_VENTURE_REQUEST', 'This entry is already in the books.');
  return created[0];
}

/** Invoice fact: billed counts amountMinor, which leaves tax out. */
export function invoiceFact(invoice: InvoiceRecord, client: ClientRecord, taxableMinor: MinorString, description: string): BooksFactInput {
  check(invoice.issueDate !== null && invoice.dueDate !== null, 'INVALID_VENTURE_REQUEST', 'This invoice needs an issue date and a due date.');
  return {
    entityId: invoice.id,
    kind: 'invoice',
    validFrom: invoice.issueDate,
    fields: {
      amountMinor: taxableMinor,
      taxMinor: invoice.taxMinor,
      currency: invoice.currency,
      customerId: client.id,
      customerName: client.name,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      dueDate: invoice.dueDate,
      status: 'unpaid',
      description,
    },
  };
}

/** Payment fact: received counts amountMinor, the cash that came in with tax. */
export function paymentFact(paymentId: string, invoice: InvoiceRecord, amountMinor: MinorString, receivedOn: IsoDate, method: PaymentMethod): BooksFactInput {
  return {
    entityId: paymentId,
    kind: 'payment',
    validFrom: receivedOn,
    fields: {
      amountMinor,
      currency: invoice.currency,
      customerId: invoice.clientId,
      invoiceId: invoice.id,
      orderId: invoice.orderId,
      status: 'settled',
      paymentMethod: method,
    },
  };
}

/** Sale fact: earned counts amountMinor, the order's amount before tax, by delivery date. */
export function saleFact(order: OrderRecord, client: ClientRecord, taxableMinor: MinorString, currency: string, deliveredOn: IsoDate, description: string): BooksFactInput {
  return {
    entityId: order.id,
    kind: 'sale',
    validFrom: deliveredOn,
    fields: {
      amountMinor: taxableMinor,
      currency,
      customerId: client.id,
      orderId: order.id,
      status: 'delivered',
      description,
    },
  };
}
