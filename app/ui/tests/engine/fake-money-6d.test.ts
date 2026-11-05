import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { BillingView, InvoicePdfView, InvoiceViewLite } from '../../src/engine/types';

/**
 * The fake engine answers wave 6's money (6D1 to 6D4) as the engine does: several invoices per order that never pass its
 * total (money/invoice-parts.ts), due in 7 days by default, the owner's billing settings with the engine's checks
 * (billing-rules.ts), the UPI link and QR code from the exact balance (upi.ts), the file and its share links
 * (invoice-pdf.ts), and Razorpay links on the exact approval (razorpay.ts, fixture-tested). Boat Audio's order o-boat-14
 * is ₹30,000 with no tax.
 */
const NOW = '2026-10-23T10:00:00.000Z';
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: configurable invoices and how to pay (6D)', () => {
  it('an advance and the final invoice add up to the order; nothing bills past it; the default is due in 7 days', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14', part: { kind: 'advance', percent: '100' } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    // 40% of 3000000 = 1200000 (₹12,000).
    const advance = await ask<InvoiceViewLite>(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14', part: { kind: 'advance', percent: '40' } });
    expect(advance.invoice.part).toEqual({ kind: 'advance', label: 'Advance' });
    expect(advance.invoice.dueInDays).toBe(7);
    expect(advance.figures.find((figure) => figure.key === 'total')?.display).toBe('₹12,000');
    const issued = await ask<InvoiceViewLite>(engine, 'venture.invoice.issue', { invoiceId: advance.invoice.id, digest: advance.invoice.digest });
    expect(issued.invoice.dueDate).toBe('2026-10-30');
    expect(issued.billed).toEqual({ orderTotal: '₹30,000', billed: '₹12,000', left: '₹18,000', invoices: 1 });
    await expect(ask(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14', part: { kind: 'partial', amount: '18000.01' } })).rejects.toMatchObject({ code: 'ORDER_OVER_INVOICED' });
    const rest = await ask<InvoiceViewLite>(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14' });
    expect(rest.invoice.part).toEqual({ kind: 'final', label: 'Final invoice' });
    expect(rest.figures.find((figure) => figure.key === 'total')?.display).toBe('₹18,000');
    await ask(engine, 'venture.invoice.issue', { invoiceId: rest.invoice.id, digest: rest.invoice.digest });
    await expect(ask(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14' })).rejects.toMatchObject({ code: 'QUOTE_ALREADY_INVOICED', message: 'This order is billed in full already. Change the order before you bill more.' });
  });

  it('billing settings are checked as the engine checks them, and an issued invoice carries the exact UPI link', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.billing.set', { upiId: 'boat audio@okaxis' })).rejects.toMatchObject({ code: 'INVALID_UPI_ID' });
    await expect(ask(engine, 'venture.billing.set', { bank: { accountName: 'Lumen', accountNumber: '12345678' } })).rejects.toMatchObject({ code: 'INVALID_BANK_DETAILS' });
    const saved = await ask<BillingView>(engine, 'venture.billing.set', { upiId: 'lumen.studio@okaxis', reminderDays: [5] });
    expect(saved.settings).toMatchObject({ upiId: 'lumen.studio@okaxis', dueInDays: 7, reminderDays: [5], razorpay: null });
    const draft = await ask<InvoiceViewLite>(engine, 'venture.invoice.prepare', { orderId: 'o-boat-14' });
    expect(draft.howToPay?.upi).toBeNull();
    expect(draft.howToPay?.upiNote).toBe('The UPI link and QR code are made when you issue this invoice.');
    const issued = await ask<InvoiceViewLite>(engine, 'venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
    expect(issued.howToPay?.upi?.link).toBe(`upi://pay?pa=lumen.studio@okaxis&pn=${encodeURIComponent(issued.howToPay!.upi!.payeeName)}&am=30000.00&cu=INR&tn=Invoice%20${issued.invoice.number}&tr=${issued.invoice.number}`);
    expect(issued.howToPay?.upi?.qr.size).toBe(issued.howToPay!.upi!.qr.version * 4 + 17);
    expect(issued.documentText).toMatch(/How to pay\nUPI ID: lumen\.studio@okaxis/);
    const paid = await ask<InvoiceViewLite>(engine, 'venture.payment.record', { invoiceId: issued.invoice.id, amount: '10000', receivedOn: '2026-10-23', method: 'upi' });
    expect(paid.howToPay?.upi?.link).toMatch(/&am=20000\.00&/);
    expect(paid.timeline?.some((entry) => entry.line.endsWith(', marked paid by you'))).toBe(true);
  });

  it('the file is HTML with the reason, the share links open the owner\'s apps, and a payment link needs keys and the exact approval', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const list = await ask<{ id: string; number: string | null }[]>(engine, 'venture.invoice.list');
    const sample = list.find((invoice) => invoice.number === 'INV-0039')!;
    const file = await ask<InvoicePdfView>(engine, 'venture.invoice.pdf', { invoiceId: sample.id });
    expect(file).toMatchObject({ format: 'html', fileName: 'INV-0039.html', note: 'A PDF needs the desktop app.' });
    expect(file.share.whatsappUrl.startsWith('https://wa.me/?text=')).toBe(true);
    expect(decodeURIComponent(file.share.whatsappUrl)).toMatch(/Here is invoice INV-0039 for INR 26,200\.00, due on 2026-10-28\. The PDF is attached\./);
    await expect(ask(engine, 'venture.invoice.payLink', { invoiceId: sample.id, action: 'check' })).rejects.toMatchObject({ code: 'RAZORPAY_NOT_CONNECTED' });
    await ask(engine, 'venture.billing.set', { razorpayKeys: { keyId: ['rzp', 'test', 'Sample0Key9'].join('_'), keySecret: 'samplesecretvalue1' } });
    const offered = await ask<InvoiceViewLite>(engine, 'venture.invoice.get', { invoiceId: sample.id });
    expect(offered.howToPay?.payLinkOffer).toMatchObject({ amount: '₹26,200', label: 'fixture-tested' });
    await expect(ask(engine, 'venture.invoice.payLink', { invoiceId: sample.id, action: 'create', digest: 'other0' })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const made = await ask<InvoiceViewLite>(engine, 'venture.invoice.payLink', { invoiceId: sample.id, action: 'create', digest: offered.howToPay!.payLinkOffer!.digest });
    expect(made.howToPay?.payLink).toMatchObject({ status: 'created', label: 'fixture-tested' });
    expect(made.howToPay?.payLinkOffer).toBeNull();
  });
});
