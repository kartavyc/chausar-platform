import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { BillView, CreditNoteView, InvoiceLite, InvoiceViewLite, MoneyFigure, OutreachView, QueueDecision, QueueList, RecurringInvoiceView } from '../../src/engine/types';

/**
 * The fake engine answers the 4J5 money methods as the engine does (money/bills.ts, credits.ts, payments.ts,
 * reminders.ts, recurring.ts): the same codes, shapes and order, never NOT_BUILT_YET. The sample invoice INV-0039 bills
 * Boat Audio ₹26,200.00 with no tax, due 28 Oct 2026.
 */
const NOW = '2026-10-23T10:00:00.000Z';
const engineAt = () => new FakeEngine({ now: () => NOW });
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;
const sample = async (engine: FakeEngine) => (await ask<InvoiceLite[]>(engine, 'venture.invoice.list')).find((invoice) => invoice.number === 'INV-0039')!;
const LINES = [{ description: 'Laptop repair', amountMinor: '500000', taxName: 'GST', taxRateBps: '1800' }, { description: 'Courier', amountMinor: '12000', taxName: '', taxRateBps: '0' }];

describe('fake engine: bills, payments and credits, recurring invoices and reminders (4J5)', () => {
  it('bills: the total is the lines and their tax; over the balance is refused; the list is nearest due first with owed; stop ends a repeat', async () => {
    const engine = engineAt();
    // 500000 + (500000 x 1800 + 5000) / 10000 = 590000, and 12000: 602000 (₹6,020.00).
    const added = await ask<{ bill: BillView; receiptId?: string }>(engine, 'venture.bills.add', { vendor: 'Metro Repairs', lines: LINES, billDate: '2026-10-20', dueDate: '2026-10-30' });
    expect(added.bill).toMatchObject({ vendor: 'Metro Repairs', total: '₹6,020.00', paid: '₹0.00', balance: '₹6,020.00', state: 'posted', recurring: null });
    expect(added.receiptId).toBeTruthy();
    await expect(ask(engine, 'venture.bills.add', { vendor: 'Metro Repairs', lines: [], billDate: '2026-10-20', dueDate: '2026-10-30' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(ask(engine, 'venture.bills.add', { vendor: 'Metro Repairs', lines: [{ ...LINES[0], taxRateBps: '10001' }], billDate: '2026-10-20', dueDate: '2026-10-30' })).rejects.toMatchObject({ code: 'INVALID_TAX_RATE' });
    await expect(ask(engine, 'venture.bills.pay', { billId: added.bill.id, amountMinor: '602001', paidOn: '2026-10-23', method: 'upi' })).rejects.toMatchObject({ code: 'BILL_PAYMENT_TOO_LARGE' });
    const part = await ask<{ bill: BillView }>(engine, 'venture.bills.pay', { billId: added.bill.id, amountMinor: '301000', paidOn: '2026-10-23', method: 'upi' });
    expect(part.bill).toMatchObject({ paid: '₹3,010.00', balance: '₹3,010.00', state: 'partial' });
    const later = await ask<{ bill: BillView }>(engine, 'venture.bills.add', { vendor: 'Cloud Host', lines: [{ description: 'Hosting', amountMinor: '250000', taxName: '', taxRateBps: '0' }], billDate: '2026-10-01', dueDate: '2026-10-10', recurring: 'monthly' });
    expect(later.bill.state).toBe('overdue');
    const list = await ask<{ bills: BillView[]; owed: MoneyFigure | null }>(engine, 'venture.bills.list');
    expect(list.bills.map((bill) => bill.vendor)).toEqual(['Cloud Host', 'Metro Repairs']);
    expect(list.owed?.display).toBe('₹5,510.00'); // 250000 + 301000
    expect(await ask(engine, 'venture.receipt.get', { id: list.owed!.receiptId })).toMatchObject({ figures: [{ display: '₹5,510.00' }] });
    engine.money.expectBill('Cloud Host', '2026-11-01', '2026-11-10');
    const stopped = await ask<{ bills: BillView[] }>(engine, 'venture.bills.stop', { billId: later.bill.id });
    expect(stopped.bills.map((bill) => [bill.vendor, bill.recurring])).toEqual([['Cloud Host', null], ['Metro Repairs', null]]);
    await expect(ask(engine, 'venture.bills.stop', { billId: later.bill.id })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });

  it('a cheque waits to clear and holds its amount; clearing it pays the invoice; TDS rides beside the cash', async () => {
    const engine = engineAt();
    const invoice = await sample(engine);
    const cheque = await ask<InvoiceViewLite>(engine, 'venture.payment.record', { invoiceId: invoice.id, amount: '20000', tds: { section: '194J', amount: '2000' }, receivedOn: '2026-10-21', method: 'cheque' });
    expect(cheque.payments.at(-1)).toMatchObject({ method: 'cheque', state: 'pending', booksReceiptId: null, tds: { section: '194J' } });
    expect(cheque.next).toEqual({ action: 'clear', line: 'A cheque for ₹20,000.00 is waiting to clear, with TDS ₹2,000.00 under 194J. Mark it cleared once it is in your bank.' });
    expect(cheque.figures.find((figure) => figure.key === 'balance')?.display).toBe('₹26,200.00');
    // 2620000 - 2200000 held = 420000 free: a payment of ₹4,200.01 is refused.
    await expect(ask(engine, 'venture.payment.record', { invoiceId: invoice.id, amount: '4200.01', receivedOn: '2026-10-22', method: 'upi' })).rejects.toMatchObject({ code: 'PAYMENT_TOO_LARGE' });
    const cleared = await ask<InvoiceViewLite>(engine, 'venture.payment.clear', { paymentId: cheque.payments.at(-1)!.id });
    expect(cleared.payments.at(-1)).toMatchObject({ state: 'cleared', receivedOn: '2026-10-23', chequeOn: '2026-10-21' });
    expect(cleared.figures.find((figure) => figure.key === 'balance')?.display).toBe('₹4,200.00');
    await expect(ask(engine, 'venture.payment.clear', { paymentId: cheque.payments.at(-1)!.id })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(ask(engine, 'venture.payment.record', { amount: '10', allocations: [{ invoiceId: invoice.id, amount: '11' }], receivedOn: '2026-10-22', method: 'upi' })).rejects.toMatchObject({ code: 'PAYMENT_TOO_LARGE' });
  });

  it('a credit note waits on Today as a card; Issue there takes it off the balance in the engine\'s words', async () => {
    const engine = engineAt();
    const invoice = await sample(engine);
    const view = await ask<InvoiceViewLite>(engine, 'venture.invoice.get', { invoiceId: invoice.id });
    await expect(ask(engine, 'venture.credit.issue', { invoiceId: invoice.id, amountMinor: '2620001', reason: 'Too much.', digest: view.invoice.digest })).rejects.toMatchObject({ code: 'CREDIT_TOO_LARGE' });
    await expect(ask(engine, 'venture.credit.issue', { invoiceId: invoice.id, amountMinor: '100', reason: 'Too much.', digest: 'stale' })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const asked = await ask<{ creditNote: CreditNoteView }>(engine, 'venture.credit.issue', { invoiceId: invoice.id, amountMinor: '262000', reason: 'One mention was dropped.', digest: view.invoice.digest });
    expect(asked.creditNote).toMatchObject({ state: 'waiting', amount: '₹2,620.00', number: null, line: 'Waiting on Today for you to issue it.' });
    const row = (await ask<QueueList>(engine, 'venture.queue.list', { scope: 'all' })).rows.find((item) => item.id === asked.creditNote.rowId)!;
    expect(row).toMatchObject({ kind: 'invoice', title: 'Credit note for Boat Audio on INV-0039', change: { before: '₹26,200.00', after: '₹23,580.00' } });
    const done = await ask<QueueDecision>(engine, 'venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' });
    expect(done).toEqual({ outcome: 'done', line: 'Issued credit note CN-0001. Boat Audio now owes ₹23,580.00 on INV-0039.' });
    const after = await ask<InvoiceViewLite>(engine, 'venture.invoice.get', { invoiceId: invoice.id });
    expect(after.figures.filter((figure) => ['credited', 'balance'].includes(figure.key)).map((figure) => figure.display)).toEqual(['₹2,620.00', '₹23,580.00']);
    expect(after.credits?.map((credit) => [credit.number, credit.state])).toEqual([['CN-0001', 'issued']]);
  });

  it('a reminder is a draft the owner sends; a schedule is kept with its line; an issued order is invoiced once', async () => {
    const engine = engineAt();
    const invoice = await sample(engine);
    const reminder = await ask<{ draft: OutreachView; receiptId?: string }>(engine, 'venture.invoice.remind', { invoiceId: invoice.id });
    expect(reminder.draft).toMatchObject({ kind: 'reminder', channel: 'email', subject: 'Payment reminder: INV-0039', sent: null, footer: null });
    expect(reminder.draft.text).toContain('INV-0039, dated 2026-10-14, is due on 2026-10-28. ₹26,200.00 is still to pay.');
    expect(reminder.receiptId).toBeTruthy();
    const set = await ask<{ recurring: RecurringInvoiceView }>(engine, 'venture.invoice.recurring', { clientId: invoice.clientId, offerId: 'offer_1', frequency: 'monthly', startOn: '2026-11-01' });
    expect(set.recurring).toMatchObject({ frequency: 'monthly', startOn: '2026-11-01', nextOn: '2026-11-01', end: null });
    await expect(ask(engine, 'venture.invoice.recurring', { clientId: invoice.clientId, offerId: 'offer_2', frequency: 'monthly', startOn: '2026-10-01' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    expect((await ask<{ items: RecurringInvoiceView[] }>(engine, 'venture.invoice.recurringList')).items.map((item) => item.id)).toEqual([set.recurring.id]);
    await expect(ask(engine, 'venture.invoice.prepare', { orderId: invoice.orderId })).rejects.toMatchObject({ code: 'QUOTE_ALREADY_INVOICED' });
    expect((await ask<InvoiceLite[]>(engine, 'venture.invoice.list')).find((item) => item.id === invoice.id)?.next?.action).toBe('wait');
  });
});
