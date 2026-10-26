/**
 * The fake engine's invoices and payments, for `npm run dev:ui` and tests. It answers venture.invoice.list, .get,
 * .prepare, .issue and venture.payment.record in the engine's shapes, with the engine's refusals: a changed draft is
 * refused by its digest (APPROVAL_STALE), an issued invoice cannot be issued again (INVOICE_NOT_DRAFT), a payment over
 * the balance is refused (PAYMENT_TOO_LARGE), and a bad amount is refused (INVALID_AMOUNT). It also gives the books their
 * open invoices and period choices.
 *
 * Like the engine it keeps amounts in minor units (paise) and lets only formatted text out, so the UI never sees an
 * amount it could add up. The sample invoices follow the shared sample orders in fixtures.ts (ORDERS): INV-0039 bills
 * Boat Audio's episode 12 order (R-0416) and INV-0041 bills Mehta Traders' September books (R-0419). This desk is the
 * only one that answers venture.invoice.list, so a draft or a payment made here shows everywhere. Each list row carries
 * its total and price receipt, as the engine's list does, so no screen needs an invoice.get per row.
 */

import { RECEIPTS } from './fixtures';
import { EngineError, PAYMENT_METHODS, type BooksPeriodKey, type BooksSummaryLite, type ClientLite, type InvoiceLite, type InvoiceViewLite, type OrderLite, type PaymentLite, type PaymentMethod, type PriceFigureLite, type ReceiptLite } from './types';

/** Amounts are whole paise. The samples stay far below the largest safe integer; a typed amount past it is refused. */
interface TaxLine { key: 'cgst' | 'sgst'; label: string; minor: number }
interface Price { subtotal: number; taxes: TaxLine[] }
interface HeldInvoice {
  id: string; at: string; businessId: string; orderId: string; clientId: string; number: string | null;
  status: InvoiceLite['status']; issueDate: string | null; dueDate: string | null; dueInDays: number;
  currency: string; documentTitle: string; priceReceiptId: string; booksReceiptId: string | null; booksNote: string | null;
  description: string; price: Price; paid: number; notes: string[]; digest: string;
}
interface HeldPayment extends PaymentLite { businessId: string; amount: number }

/** What the fake needs from the engine around it. */
export interface MoneyHost {
  now: () => string;
  business: () => string;
  clients: () => readonly ClientLite[];
  orders: () => readonly OrderLite[];
  /** Tell listeners that money changed (the engine's queue.changed). */
  changed: () => void;
}

const COVERS_MORE = 'The books receipt covers more than this invoice.';
// A business not registered for tax issues a plain INVOICE with no tax note, as money/invoices.ts does.
const NOT_TAX = 'INVOICE';
const plain = (subtotal: number): Price => ({ subtotal, taxes: [] });
const nine = (subtotal: number) => Math.floor((subtotal * 9 + 50) / 100);
const gst = (subtotal: number): Price => ({ subtotal, taxes: [{ key: 'cgst', label: 'CGST at 9%', minor: nine(subtotal) }, { key: 'sgst', label: 'SGST at 9%', minor: nine(subtotal) }] });

/** What each sample order costs, as its price receipt says. */
const ORDER_PRICES: Readonly<Record<string, { price: Price; title: string; notes: string[] }>> = {
  'o-boat-14': { price: plain(3000000), title: NOT_TAX, notes: [] },
  'o-boat-12': { price: plain(2620000), title: NOT_TAX, notes: [] },
  'o-iyer-oct': { price: gst(1200000), title: 'TAX INVOICE', notes: [] },
  'o-mehta-sep': { price: gst(1600000), title: 'TAX INVOICE', notes: [] },
};

type Seed = Omit<HeldInvoice, 'digest'>;
const SEED: Seed[] = [
  {
    id: 'inv-0038', at: '2026-10-01T10:00:00.000Z', businessId: 'lumen', orderId: 'o-boat-10', clientId: 'c-boat', number: 'INV-0038', status: 'paid',
    issueDate: '2026-10-01', dueDate: '2026-10-16', dueInDays: 15, currency: 'INR', documentTitle: NOT_TAX, priceReceiptId: 'R-0391',
    booksReceiptId: null, booksNote: COVERS_MORE, description: 'Four mentions in episodes 9 and 10', price: plain(8620000), paid: 8620000, notes: [],
  },
  {
    id: 'inv-0039', at: '2026-10-14T10:00:00.000Z', businessId: 'lumen', orderId: 'o-boat-12', clientId: 'c-boat', number: 'INV-0039', status: 'issued',
    issueDate: '2026-10-14', dueDate: '2026-10-28', dueInDays: 15, currency: 'INR', documentTitle: NOT_TAX, priceReceiptId: 'R-0416',
    booksReceiptId: null, booksNote: COVERS_MORE, description: 'Two mentions in episode 12', price: plain(2620000), paid: 0, notes: [],
  },
  {
    id: 'inv-0041', at: '2026-10-21T09:00:00.000Z', businessId: 'ledgerline', orderId: 'o-mehta-sep', clientId: 'c-mehta', number: 'INV-0041', status: 'issued',
    issueDate: '2026-10-21', dueDate: '2026-11-05', dueInDays: 15, currency: 'INR', documentTitle: 'TAX INVOICE', priceReceiptId: 'R-0419',
    booksReceiptId: null, booksNote: COVERS_MORE, description: 'Monthly books for September', price: gst(1600000), paid: 0, notes: [],
  },
];
const PAYMENT_SEED: HeldPayment[] = [
  { id: 'pay-0038-1', at: '2026-10-20T16:00:00.000Z', businessId: 'lumen', invoiceId: 'inv-0038', receivedOn: '2026-10-20', method: 'bank-transfer', booksReceiptId: 'R-0402', booksNote: null, amount: 8620000 },
];
const OWN_RECEIPTS: ReceiptLite[] = [
  {
    id: 'R-0391', at: '2026-10-01T10:00:00.000Z', explanation: 'Four mentions at ₹21,550 each, no discount, priced before tax.', stale: false,
    figures: [{ key: 'unit', label: 'Per mention', display: '₹21,550.00' }, { key: 'subtotal', label: 'Four mentions', display: '₹86,200.00' }, { key: 'total', label: 'Total before tax', display: '₹86,200.00' }],
  },
];

/** The books' period choices, as the engine names them for the owner's calendar. */
export const BOOK_PERIODS: { key: BooksPeriodKey; label: string; from: string; to: string }[] = [
  { key: 'all', label: 'All time', from: '2026-08-01', to: '2026-10-21' },
  { key: 'this-month', label: 'This month', from: '2026-10-01', to: '2026-10-31' },
  { key: 'last-month', label: 'Last month', from: '2026-09-01', to: '2026-09-30' },
  { key: 'this-year', label: 'This year', from: '2026-01-01', to: '2026-12-31' },
];

/** Paise as rupees with Indian digit grouping, the way the sample figures are written: ₹1,12,400.00. */
export function inr(minor: number): string {
  const negative = minor < 0;
  const absolute = Math.abs(minor);
  const rupees = String(Math.floor(absolute / 100));
  const paise = String(absolute % 100).padStart(2, '0');
  const last = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}` : last;
  return `${negative ? '-' : ''}₹${grouped}.${paise}`;
}

function digest(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

const addDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
const totalOf = (price: Price) => price.taxes.reduce((sum, line) => sum + line.minor, price.subtotal);
const METHOD_WORDS: Record<PaymentMethod, string> = { 'bank-transfer': 'bank transfer', upi: 'UPI', card: 'card', cash: 'cash', 'payment-link': 'payment link', other: 'other' };

export class FakeMoney {
  private invoices: HeldInvoice[];
  private payments: HeldPayment[];
  private receipts: ReceiptLite[];
  private readonly host: MoneyHost;
  private draftSeq = 1;
  private numberSeq = 42;
  private receiptSeq = 450;
  private paymentSeq = 1;

  constructor(host: MoneyHost) {
    this.host = host;
    this.invoices = SEED.map((seed) => this.sealed({ ...seed, price: { ...seed.price, taxes: seed.price.taxes.map((line) => ({ ...line })) }, notes: [...seed.notes], digest: '' }));
    this.payments = PAYMENT_SEED.map((payment) => ({ ...payment }));
    this.receipts = OWN_RECEIPTS.map((receipt) => structuredClone(receipt));
  }

  static answers(method: string): boolean {
    return method === 'venture.invoice.list' || method === 'venture.invoice.get' || method === 'venture.invoice.prepare' || method === 'venture.invoice.issue' || method === 'venture.payment.record';
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.invoice.list': return this.mine().sort((a, b) => b.at.localeCompare(a.at)).map((invoice) => this.listed(invoice));
      case 'venture.invoice.get': return this.view(this.find(p.invoiceId));
      case 'venture.invoice.prepare': return this.prepare(p);
      case 'venture.invoice.issue': return this.issue(p);
      case 'venture.payment.record': return this.record(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** A receipt the money desk made or keeps (price receipts of new drafts, books receipts of issues and payments). */
  receipt(id: string): ReceiptLite | undefined {
    const receipt = this.receipts.find((r) => r.id === id);
    return receipt ? structuredClone(receipt) : undefined;
  }

  /** The books summary with this desk's open invoices and the period choices, for the period asked. */
  books(base: BooksSummaryLite, period: unknown): BooksSummaryLite {
    const key = BOOK_PERIODS.find((choice) => choice.key === period)?.key ?? 'all';
    const chosen = BOOK_PERIODS.find((choice) => choice.key === key)!;
    return { ...base, period: { from: chosen.from, to: chosen.to }, periodKey: key, periods: structuredClone(BOOK_PERIODS), today: this.today(), openInvoices: this.openInvoices() };
  }

  /** Test and demo helper: the draft changes after the owner opened it (the client asked for 30 days), so its digest changes. */
  touch(id: string): void {
    const invoice = this.invoices.find((i) => i.id === id);
    if (!invoice || invoice.status !== 'draft') throw new EngineError('INVOICE_NOT_DRAFT', 'Only a draft can change.');
    invoice.dueInDays = 30;
    this.sealed(invoice);
  }

  private today(): string { return this.host.now().slice(0, 10); }
  private mine(): HeldInvoice[] { return this.invoices.filter((i) => i.businessId === this.host.business()); }
  private clientName(id: string): string { return this.host.clients().find((c) => c.id === id)?.name ?? 'A client'; }

  private find(id: unknown): HeldInvoice {
    const invoice = this.mine().find((i) => i.id === id);
    if (!invoice) throw new EngineError('INVOICE_NOT_FOUND', 'This invoice was not found.');
    return invoice;
  }

  private sealed(invoice: HeldInvoice): HeldInvoice {
    const { digest: _old, ...rest } = invoice;
    invoice.digest = digest(rest);
    return invoice;
  }

  private lite(invoice: HeldInvoice): InvoiceLite {
    return { id: invoice.id, at: invoice.at, orderId: invoice.orderId, clientId: invoice.clientId, number: invoice.number, status: invoice.status, issueDate: invoice.issueDate, dueDate: invoice.dueDate };
  }

  /** A list row: the record plus its total and price receipt, formatted here as the engine formats them. */
  private listed(invoice: HeldInvoice): InvoiceLite {
    return { ...this.lite(invoice), total: inr(totalOf(invoice.price)), receiptId: invoice.priceReceiptId };
  }

  /** "Clients owe you" for Money at a glance: the open balances of this business, added up here as the engine does. */
  owed(): { value: string; receiptId: string } {
    const open = this.mine().filter((i) => (i.status === 'issued' || i.status === 'part-paid') && totalOf(i.price) > i.paid);
    // The engine proves this figure with its "owed" sum receipt, as money/overview.ts does.
    return { value: inr(open.reduce((sum, i) => sum + totalOf(i.price) - i.paid, 0)), receiptId: 'R-0430' };
  }

  private figures(invoice: HeldInvoice): PriceFigureLite[] {
    const total = totalOf(invoice.price);
    return [
      { key: 'subtotal', label: 'Subtotal', display: inr(invoice.price.subtotal) },
      ...invoice.price.taxes.map((line) => ({ key: line.key, label: line.label, display: inr(line.minor) })),
      { key: 'total', label: 'Total', display: inr(total) },
      { key: 'paid', label: 'Paid', display: inr(invoice.paid) },
      { key: 'balance', label: 'Balance', display: inr(total - invoice.paid) },
    ];
  }

  private view(invoice: HeldInvoice): InvoiceViewLite {
    const name = this.clientName(invoice.clientId);
    const figures = this.figures(invoice);
    const dates = invoice.issueDate && invoice.dueDate ? `Issued ${invoice.issueDate}, due ${invoice.dueDate}` : `Draft, due ${invoice.dueInDays} days after it is issued`;
    const documentText = [
      invoice.documentTitle, invoice.number ?? 'Draft', dates, `Billed to: ${name}`, '', invoice.description,
      ...figures.map((figure) => `${figure.label}: ${figure.display}`),
    ].join('\n');
    const { digest: invoiceDigest, documentTitle, priceReceiptId, booksReceiptId, booksNote, currency, dueInDays } = invoice;
    const stale = (RECEIPTS.find((r) => r.id === priceReceiptId) ?? this.receipts.find((r) => r.id === priceReceiptId))?.stale ?? false;
    return {
      invoice: { ...this.lite(invoice), currency, dueInDays, digest: invoiceDigest, documentTitle, priceReceiptId, booksReceiptId, booksNote },
      client: { id: invoice.clientId, name },
      receipt: { id: priceReceiptId, stale },
      payments: this.payments.filter((p) => p.invoiceId === invoice.id).map(({ businessId: _b, amount: _a, ...payment }) => ({ ...payment })),
      documentText,
      figures,
      notes: [...invoice.notes],
    };
  }

  private openInvoices(): BooksSummaryLite['openInvoices'] {
    return this.mine()
      .filter((i) => (i.status === 'issued' || i.status === 'part-paid') && i.number !== null && i.dueDate !== null && totalOf(i.price) > i.paid)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
      .map((i) => ({ invoiceId: i.id, number: i.number!, clientName: this.clientName(i.clientId), balanceDisplay: inr(totalOf(i.price) - i.paid), dueDate: i.dueDate! }));
  }

  private newReceipt(label: string, minor: number, explanation: string): string {
    const id = `R-0${this.receiptSeq++}`;
    this.receipts.push({ id, at: this.host.now(), explanation, stale: false, figures: [{ key: 'total', label, display: inr(minor) }] });
    return id;
  }

  /** The order's price receipt when it still holds; a fresh one when the price changed since (the engine re-prices). */
  private priceReceipt(order: OrderLite, price: Price): string {
    const held = RECEIPTS.find((r) => r.id === order.priceReceiptId) ?? this.receipts.find((r) => r.id === order.priceReceiptId);
    if (held && !held.stale) return held.id;
    const id = `R-0${this.receiptSeq++}`;
    const figures: PriceFigureLite[] = [
      { key: 'subtotal', label: 'Subtotal', display: inr(price.subtotal) },
      ...price.taxes.map((line) => ({ key: line.key, label: line.label, display: inr(line.minor) })),
      { key: 'total', label: 'Total', display: inr(totalOf(price)) },
    ];
    this.receipts.push({ id, at: this.host.now(), explanation: `Priced again for this invoice: ${order.request}.`, stale: false, figures });
    return id;
  }

  private prepare(p: Record<string, unknown>): InvoiceViewLite {
    const order = this.host.orders().find((o) => o.id === p.orderId);
    if (!order) throw new EngineError('ORDER_NOT_FOUND', 'This order was not found.');
    if (order.status === 'cancelled') throw new EngineError('INVALID_VENTURE_REQUEST', 'This order was cancelled.');
    const existing = this.mine().filter((i) => i.orderId === order.id && i.status !== 'void');
    if (existing.some((i) => i.status !== 'draft')) throw new EngineError('INVOICE_NOT_DRAFT', 'This order already has an issued invoice.');
    const priced = ORDER_PRICES[order.id];
    if (!priced) throw new EngineError('ORDER_NOT_PRICED', 'The sample engine has no price for this order.');
    const dueInDays = p.dueInDays === undefined ? 15 : p.dueInDays;
    if (typeof dueInDays !== 'number' || !Number.isInteger(dueInDays) || dueInDays < 0 || dueInDays > 90) throw new EngineError('INVALID_VENTURE_REQUEST', 'Payment terms are 0 to 90 days.');
    this.invoices = this.invoices.filter((i) => !existing.includes(i));
    const invoice = this.sealed({
      id: `inv-draft-${this.draftSeq++}`, at: this.host.now(), businessId: this.host.business(), orderId: order.id, clientId: order.clientId, number: null, status: 'draft',
      issueDate: null, dueDate: null, dueInDays, currency: 'INR', documentTitle: priced.title, priceReceiptId: this.priceReceipt(order, priced.price),
      booksReceiptId: null, booksNote: null, description: order.request, price: { subtotal: priced.price.subtotal, taxes: priced.price.taxes.map((line) => ({ ...line })) },
      paid: 0, notes: [...priced.notes], digest: '',
    });
    this.invoices.push(invoice);
    this.host.changed();
    return this.view(invoice);
  }

  private issue(p: Record<string, unknown>): InvoiceViewLite {
    const invoice = this.find(p.invoiceId);
    if (typeof p.digest !== 'string' || !p.digest) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the digest of the invoice you checked.');
    if (invoice.status !== 'draft') throw new EngineError('INVOICE_NOT_DRAFT', 'This invoice was already issued.');
    if (invoice.digest !== p.digest) throw new EngineError('APPROVAL_STALE', 'This invoice changed after you checked it. Look at it again, then issue it.');
    const today = this.today();
    invoice.number = `INV-${String(this.numberSeq++).padStart(4, '0')}`;
    invoice.status = 'issued';
    invoice.issueDate = today;
    invoice.dueDate = addDays(today, invoice.dueInDays);
    invoice.booksReceiptId = this.newReceipt('Billed', invoice.price.subtotal, `Invoice ${invoice.number} for ${this.clientName(invoice.clientId)}, before tax.`);
    this.sealed(invoice);
    this.host.changed();
    return this.view(invoice);
  }

  private record(p: Record<string, unknown>): InvoiceViewLite {
    const typed = typeof p.amount === 'string' && p.amount.length <= 40 ? p.amount.replace(/[\s,]/g, '') : '';
    if (!/^\d+(?:\.\d+)?$/.test(typed)) throw new EngineError('INVALID_AMOUNT', 'Amount must be a positive amount like 2499 or 2499.50.');
    if (typeof p.receivedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.receivedOn)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Date received must be a date like 2026-10-21.');
    if (!PAYMENT_METHODS.includes(p.method as PaymentMethod)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose how the money came in.');
    const invoice = this.find(p.invoiceId);
    if (invoice.status === 'draft') throw new EngineError('INVALID_VENTURE_REQUEST', 'Issue this invoice before you record a payment.');
    if (invoice.status === 'void') throw new EngineError('INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
    if (invoice.status === 'paid') throw new EngineError('PAYMENT_TOO_LARGE', 'This invoice is already paid in full.');
    const [whole = '0', fraction = ''] = typed.split('.');
    const digits = fraction.replace(/0+$/, '');
    if (digits.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
    if (whole.length > 13) throw new EngineError('INVALID_AMOUNT', 'That amount is too large for one payment.');
    const amount = Number.parseInt(whole, 10) * 100 + Number.parseInt(digits.padEnd(2, '0'), 10);
    if (amount <= 0) throw new EngineError('INVALID_AMOUNT', 'The amount must be above zero.');
    const total = totalOf(invoice.price);
    const balance = total - invoice.paid;
    if (amount > balance) throw new EngineError('PAYMENT_TOO_LARGE', `This is more than the balance of ${inr(balance)}.`);
    invoice.paid += amount;
    invoice.status = invoice.paid === total ? 'paid' : 'part-paid';
    const method = p.method as PaymentMethod;
    this.payments.push({
      id: `pay-new-${this.paymentSeq++}`, at: this.host.now(), businessId: invoice.businessId, invoiceId: invoice.id, receivedOn: p.receivedOn, method,
      booksReceiptId: this.newReceipt('Received', amount, `Payment for ${invoice.number ?? 'the invoice'} by ${METHOD_WORDS[method]}, received on ${p.receivedOn}.`), booksNote: null, amount,
    });
    this.sealed(invoice);
    this.host.changed();
    return this.view(invoice);
  }
}
