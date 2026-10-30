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
 *
 * Ink v2 wave 4 (4J5): a cheque is pending until venture.payment.clear (it holds its amount, and only cleared money is
 * paid); one payment can be split across invoices (allocations) and TDS the client deducted rides on a payment; a
 * credit note asked for with venture.credit.issue waits on Today as an 'invoice' row, and Issue there (fake.ts decide)
 * takes it off the balance; reminders are drafts the owner sends (venture.invoice.remind); recurring schedules are kept
 * (the sample engine has no clock running, so it drafts nothing by itself); bills live in fake-bills.ts. Each invoice
 * view carries its next step, its timeline and its credit notes, as the engine's does.
 */

import { BUSINESSES, RECEIPTS } from './fixtures';
import { FakeBills, FAKE_4J5_BILL_METHODS } from './fake-bills';
import { FakeMoneyViews, FAKE_4J20_METHODS } from './fake-money-views';
import {
  EngineError, PAYMENT_METHODS, type BooksPeriodKey, type BooksSummaryLite, type ClientLite, type CreditNoteView, type InvoiceLite, type InvoiceNext,
  type InvoiceTimelineEntry, type InvoiceViewLite, type OrderLite, type OutreachView, type PaymentLite, type PaymentMethod, type PriceFigureLite,
  type QueueRow, type ReceiptLite, type RecurringInvoiceView,
} from './types';

/** Amounts are whole paise. The samples stay far below the largest safe integer; a typed amount past it is refused. */
interface TaxLine { key: 'cgst' | 'sgst'; label: string; minor: number }
interface Price { subtotal: number; taxes: TaxLine[] }
interface HeldInvoice {
  id: string; at: string; businessId: string; orderId: string; clientId: string; number: string | null;
  status: InvoiceLite['status']; issueDate: string | null; dueDate: string | null; dueInDays: number;
  currency: string; documentTitle: string; priceReceiptId: string; booksReceiptId: string | null; booksNote: string | null;
  description: string; price: Price; paid: number; notes: string[]; digest: string;
  /** 4J5: what issued credit notes took off. */
  credited?: number;
}
interface HeldPayment extends PaymentLite { businessId: string; amount: number; tdsAmount?: number }
interface HeldCredit { id: string; at: string; businessId: string; invoiceId: string; amount: number; reason: string; status: 'waiting' | 'issued' | 'cancelled'; number: string | null }
interface HeldSchedule extends RecurringInvoiceView { businessId: string }

/** What the fake needs from the engine around it. */
export interface MoneyHost {
  now: () => string;
  business: () => string;
  clients: () => readonly ClientLite[];
  orders: () => readonly OrderLite[];
  /** Tell listeners that money changed (the engine's queue.changed). */
  changed: () => void;
  /** 4J5: Today's rows, shared with the other desks, and the fake's digest, for the credit note cards. */
  rows?: () => QueueRow[];
  setRows?: (rows: QueueRow[]) => void;
  digest?: (value: unknown) => string;
  /** 4J20: another desk's answer (the spend settings' rupee rate), for the money views. */
  ask?: (method: string, params: Record<string, unknown>) => unknown;
}

/**
 * 4J20: what the money views read (fake-money-views.ts): the open business's invoices, payments, credit notes and bills,
 * in paise. The fake's only; no screen sees it.
 */
export interface MoneyLedger {
  invoices: { id: string; number: string | null; clientId: string; client: string; status: InvoiceLite['status']; issueDate: string | null; dueDate: string | null; currency: string; subtotal: number; tax: number; total: number; balance: number; priceReceiptId: string; description: string; dueInDays: number }[];
  payments: { id: string; at: string; invoiceId: string; receivedOn: string; method: PaymentMethod; amount: number; state: 'pending' | 'cleared'; tds: { section: string; amount: number } | null; booksReceiptId: string | null }[];
  credits: { id: string; invoiceId: string; amount: number; status: 'waiting' | 'issued' | 'cancelled'; number: string | null; at: string; reason: string }[];
  bills: ReturnType<FakeBills['ledger']>;
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
const METHOD_WORDS: Record<PaymentMethod, string> = { 'bank-transfer': 'bank transfer', upi: 'UPI', card: 'card', cash: 'cash', 'payment-link': 'payment link', other: 'other', cheque: 'cheque' };
/** The methods a payment may name: the sheet's list, and a cheque (4J5), which waits to clear. */
const METHODS: readonly PaymentMethod[] = [...PAYMENT_METHODS, 'cheque'];
/** The engine's 4J5 invoice and payment methods this desk answers, beside fake-bills.ts's bills. */
const FAKE_4J5_MONEY_METHODS: readonly string[] = ['venture.payment.clear', 'venture.credit.issue', 'venture.invoice.remind', 'venture.invoice.recurring', 'venture.invoice.recurringList'];
const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);
/** "300000" or "3000.00" as paise, or null when it is not an amount. */
const paiseOf = (value: unknown): number | null => {
  const typed = typeof value === 'string' && value.length <= 40 ? value.replace(/[\s,]/g, '') : '';
  if (!/^\d+(?:\.\d+)?$/.test(typed)) return null;
  const [whole = '0', fraction = ''] = typed.split('.');
  const digits = fraction.replace(/0+$/, '');
  if (digits.length > 2 || whole.length > 13) return null;
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(digits.padEnd(2, '0'), 10);
};

export class FakeMoney {
  private invoices: HeldInvoice[];
  private payments: HeldPayment[];
  private receipts: ReceiptLite[];
  private readonly host: MoneyHost;
  private draftSeq = 1;
  private numberSeq = 42;
  private receiptSeq = 450;
  private paymentSeq = 1;
  private credits: HeldCredit[] = [];
  private schedules: HeldSchedule[] = [];
  private reminders: { id: string; invoiceId: string; at: string }[] = [];
  private creditSeq = 1;
  private readonly bills: FakeBills;
  /** 4J20: aging, in and out, cash ahead, margins and the CA export, read from this desk's records. */
  private readonly views: FakeMoneyViews;

  constructor(host: MoneyHost) {
    this.host = host;
    this.views = new FakeMoneyViews({
      now: () => host.now(), business: () => host.business(), ledger: () => this.ledger(), ask: (method, p) => host.ask?.(method, p),
      name: () => BUSINESSES.find((b) => b.id === host.business())?.name ?? '',
    });
    this.invoices = SEED.map((seed) => this.sealed({ ...seed, price: { ...seed.price, taxes: seed.price.taxes.map((line) => ({ ...line })) }, notes: [...seed.notes], digest: '' }));
    this.payments = PAYMENT_SEED.map((payment) => ({ ...payment }));
    this.receipts = OWN_RECEIPTS.map((receipt) => structuredClone(receipt));
    this.bills = new FakeBills({ now: () => host.now(), business: () => host.business() });
  }

  static answers(method: string): boolean {
    return method === 'venture.invoice.list' || method === 'venture.invoice.get' || method === 'venture.invoice.prepare' || method === 'venture.invoice.issue' || method === 'venture.payment.record'
      || FAKE_4J5_MONEY_METHODS.includes(method) || FAKE_4J5_BILL_METHODS.includes(method) || FAKE_4J20_METHODS.includes(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    if (FAKE_4J5_BILL_METHODS.includes(method)) return this.bills.request(method, p);
    if (FAKE_4J20_METHODS.includes(method)) return this.views.request(method, p);
    switch (method) {
      case 'venture.invoice.list': return this.mine().sort((a, b) => b.at.localeCompare(a.at)).map((invoice) => this.listed(invoice));
      case 'venture.invoice.get': return this.view(this.find(p.invoiceId));
      case 'venture.invoice.prepare': return this.prepare(p);
      case 'venture.invoice.issue': return this.issue(p);
      case 'venture.payment.record': return this.record(p);
      case 'venture.payment.clear': return this.clear(p);
      case 'venture.credit.issue': return this.askCredit(p);
      case 'venture.invoice.remind': return this.remind(p);
      case 'venture.invoice.recurring': return this.schedule(p);
      case 'venture.invoice.recurringList': return { items: this.schedules.filter((s) => s.businessId === this.host.business()).map(({ businessId: _b, ...view }) => ({ ...view })) };
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** A receipt the money desk made or keeps (price receipts of new drafts, books receipts of issues and payments, bills). */
  receipt(id: string): ReceiptLite | undefined {
    const receipt = this.receipts.find((r) => r.id === id);
    if (!receipt && id.startsWith('credit-note:')) return this.creditReceipt(id);
    return receipt ? structuredClone(receipt) : this.bills.receipt(id) ?? this.views.receipt(id);
  }

  /** 4J20: a credit note's receipt: its invoice's balance less it while it waits, the balance with it once issued. */
  private creditReceipt(id: string): ReceiptLite | undefined {
    const credit = this.credits.find((c) => `credit-note:${c.id}` === id);
    const invoice = credit && this.invoices.find((i) => i.id === credit.invoiceId);
    if (!credit || !invoice) return undefined;
    const balance = this.balance(invoice);
    const waiting = credit.status === 'waiting';
    const after = waiting ? balance - credit.amount : balance;
    const explanation = waiting
      ? `Left to pay on ${invoice.number} now: ${inr(balance)}, its total less what was paid and credited. Less this credit note of ${inr(credit.amount)}: ${inr(after)} left after it.`
      : `Left to pay on ${invoice.number} now: ${inr(balance)}, its total less what was paid and credited, this credit note ${credit.number} of ${inr(credit.amount)} among the credits.`;
    return { id, at: credit.at, explanation, stale: credit.status === 'cancelled', figures: [{ key: 'total', label: waiting ? 'Left to pay after this credit note' : `Left to pay on ${invoice.number} now`, display: inr(after) }] };
  }

  /** 4J20: the open business's money in paise, for the views desk (fake-money-views.ts). */
  ledger(): MoneyLedger {
    const mine = this.host.business();
    return {
      invoices: this.mine().map((i) => ({
        id: i.id, number: i.number, clientId: i.clientId, client: this.clientName(i.clientId), status: i.status, issueDate: i.issueDate, dueDate: i.dueDate, currency: i.currency,
        subtotal: i.price.subtotal, tax: i.price.taxes.reduce((sum, line) => sum + line.minor, 0), total: totalOf(i.price), balance: this.balance(i),
        priceReceiptId: i.priceReceiptId, description: i.description, dueInDays: i.dueInDays,
      })),
      payments: this.payments.filter((p) => p.businessId === mine).map((p) => ({
        id: p.id, at: p.at, invoiceId: p.invoiceId, receivedOn: p.receivedOn, method: p.method, amount: p.amount, state: p.state === 'pending' ? 'pending' as const : 'cleared' as const,
        tds: p.tds ? { section: p.tds.section, amount: p.tdsAmount ?? 0 } : null, booksReceiptId: p.booksReceiptId,
      })),
      credits: this.credits.filter((c) => c.businessId === mine).map((c) => ({ id: c.id, invoiceId: c.invoiceId, amount: c.amount, status: c.status, number: c.number, at: c.at, reason: c.reason })),
      bills: this.bills.ledger(),
    };
  }

  /** Test and demo helper: an expected bill of a repeat, as the engine's sweep drafts it on its day. */
  expectBill(vendor: string, billDate: string, dueDate: string) { return this.bills.expect(vendor, billDate, dueDate); }

  /** The books summary with this desk's open invoices and the period choices, for the period asked. */
  books(base: BooksSummaryLite, period: unknown): BooksSummaryLite {
    // 4J4: a month like 2026-09 is a period too; its figures come from this desk's records (fake-money-views.ts).
    if (typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      const month = this.views.booksMonth(period);
      return {
        ...base, period: month.period, figures: month.figures, periodKey: 'custom', periods: structuredClone(BOOK_PERIODS), today: this.today(), openInvoices: this.openInvoices(),
        month: period, previous: this.views.booksMonth(month.before).asPrevious,
      };
    }
    const key = BOOK_PERIODS.find((choice) => choice.key === period)?.key ?? 'all';
    const chosen = BOOK_PERIODS.find((choice) => choice.key === key)!;
    // 4J4: a whole month (this month, last month) also sends the month before it, each figure with its receipt.
    const whole = key === 'this-month' || key === 'last-month';
    const month = whole ? this.views.booksMonth(chosen.from.slice(0, 7)) : null;
    return {
      ...base, period: { from: chosen.from, to: chosen.to }, periodKey: key, periods: structuredClone(BOOK_PERIODS), today: this.today(), openInvoices: this.openInvoices(),
      ...(month ? { month: chosen.from.slice(0, 7) } : {}), previous: month ? this.views.booksMonth(month.before).asPrevious : null,
    };
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

  /** A list row: the record plus its total, price receipt and next step, formatted here as the engine formats them. */
  private listed(invoice: HeldInvoice): InvoiceLite {
    return { ...this.lite(invoice), total: inr(totalOf(invoice.price)), receiptId: invoice.priceReceiptId, next: this.next(invoice), ...this.late(invoice) };
  }

  /** 4J4: an open invoice past its due day says how late it is (money/aging.ts lateOf), on list rows only. */
  private late(invoice: HeldInvoice): { late?: { days: number; line: string } } {
    if ((invoice.status !== 'issued' && invoice.status !== 'part-paid') || !invoice.number || !invoice.dueDate || this.balance(invoice) <= 0) return {};
    const days = daysBetween(invoice.dueDate, this.today());
    return days > 0 ? { late: { days, line: `${days} ${days === 1 ? 'day' : 'days'} late` } } : {};
  }

  /** "Clients owe you" for Money at a glance: the open balances of this business, added up here as the engine does. */
  owed(): { value: string; receiptId: string } {
    const open = this.mine().filter((i) => (i.status === 'issued' || i.status === 'part-paid') && this.balance(i) > 0);
    // The engine proves this figure with its "owed" sum receipt, as money/overview.ts does.
    return { value: inr(open.reduce((sum, i) => sum + this.balance(i), 0)), receiptId: 'R-0430' };
  }

  /** What is left to pay: the total less what was paid and what credit notes took off. */
  private balance(invoice: HeldInvoice): number { return totalOf(invoice.price) - invoice.paid - (invoice.credited ?? 0); }
  /** What a new payment or credit note may take: the balance less pending cheques and waiting credit notes. */
  private free(invoice: HeldInvoice): number {
    const held = this.payments.filter((p) => p.invoiceId === invoice.id && p.state === 'pending').reduce((sum, p) => sum + p.amount + (p.tdsAmount ?? 0), 0)
      + this.credits.filter((c) => c.invoiceId === invoice.id && c.status === 'waiting').reduce((sum, c) => sum + c.amount, 0);
    return this.balance(invoice) - held;
  }

  private figures(invoice: HeldInvoice): PriceFigureLite[] {
    const total = totalOf(invoice.price);
    return [
      { key: 'subtotal', label: 'Subtotal', display: inr(invoice.price.subtotal) },
      ...invoice.price.taxes.map((line) => ({ key: line.key, label: line.label, display: inr(line.minor) })),
      { key: 'total', label: 'Total', display: inr(total) },
      { key: 'paid', label: 'Paid', display: inr(invoice.paid) },
      ...((invoice.credited ?? 0) > 0 ? [{ key: 'credited', label: 'Credited', display: inr(invoice.credited ?? 0) }] : []),
      { key: 'balance', label: 'Balance', display: inr(this.balance(invoice)) },
    ];
  }

  /** The invoice's one next step by its state, as money/invoice-states.ts words it (reminders on 3, 10 and 30 days late). */
  private next(invoice: HeldInvoice): InvoiceNext {
    if (invoice.status === 'draft') return { action: 'issue', line: 'Check it and issue it.' };
    if (invoice.status === 'void') return { action: 'none', line: 'Cancelled.' };
    if (this.balance(invoice) <= 0) return { action: 'none', line: (invoice.credited ?? 0) > 0 ? (invoice.paid > 0 ? 'Settled: paid and credited.' : 'Settled by credit notes.') : 'Paid in full.' };
    const waiting = this.payments.filter((p) => p.invoiceId === invoice.id && p.state === 'pending');
    if (waiting.length) {
      const tds = waiting.length === 1 && waiting[0]!.tds ? `, with TDS ${inr(waiting[0]!.tdsAmount ?? 0)} under ${waiting[0]!.tds.section}` : '';
      const amount = inr(waiting.reduce((sum, p) => sum + p.amount, 0));
      return waiting.length === 1
        ? { action: 'clear', line: `A cheque for ${amount} is waiting to clear${tds}. Mark it cleared once it is in your bank.` }
        : { action: 'clear', line: `${waiting.length} cheques for ${amount} are waiting to clear. Mark each cleared once it is in your bank.` };
    }
    if (!invoice.dueDate) return { action: 'wait', line: 'Awaiting payment.' };
    const late = daysBetween(invoice.dueDate, this.today());
    if (late <= 0) return { action: 'wait', line: `Awaiting payment, due ${invoice.dueDate}.` };
    const words = `${late} ${late === 1 ? 'day' : 'days'} late`;
    const reached = [3, 10, 30].filter((day) => day <= late);
    if (!reached.length) return { action: 'wait', line: `${words}. A reminder is due on ${addDays(invoice.dueDate, 3)}.` };
    const from = addDays(invoice.dueDate, reached.at(-1)!);
    const drafted = this.reminders.filter((r) => r.invoiceId === invoice.id && r.at.slice(0, 10) >= from).at(-1);
    return drafted
      ? { action: 'remind', line: `${words}. Your reminder is drafted: open it and send it yourself.`, draftId: drafted.id }
      : { action: 'remind', line: `${words}. Draft a reminder.` };
  }

  /** The invoice's short timeline, as money/invoice-states.ts builds it: events by date, then where it stands. */
  private timeline(invoice: HeldInvoice): InvoiceTimelineEntry[] {
    if (invoice.status === 'draft' || !invoice.issueDate) return [];
    const events: InvoiceTimelineEntry[] = [{ what: 'issued', on: invoice.issueDate, line: `Issued on ${invoice.issueDate}` }];
    for (const p of this.payments.filter((item) => item.invoiceId === invoice.id)) {
      const tds = p.tds ? `, and TDS ${inr(p.tdsAmount ?? 0)} under ${p.tds.section}` : '';
      events.push(p.state === 'pending'
        ? { what: 'cheque', on: p.receivedOn, line: `Cheque for ${inr(p.amount)} received on ${p.receivedOn}, waiting to clear${tds}` }
        : { what: 'paid', on: p.receivedOn, line: `Paid ${inr(p.amount)} by ${METHOD_WORDS[p.method]} on ${p.receivedOn}${p.tds ? `, and TDS ${inr(p.tdsAmount ?? 0)} under ${p.tds.section} to be shown on the client's TDS certificate` : ''}` });
    }
    for (const c of this.credits.filter((item) => item.invoiceId === invoice.id && item.status === 'issued')) events.push({ what: 'credited', on: c.at.slice(0, 10), line: `Credit note ${c.number} for ${inr(c.amount)} on ${c.at.slice(0, 10)}` });
    for (const r of this.reminders.filter((item) => item.invoiceId === invoice.id)) events.push({ what: 'reminder', on: r.at.slice(0, 10), line: `Reminder drafted on ${r.at.slice(0, 10)}, not sent yet` });
    events.sort((a, b) => a.on.localeCompare(b.on));
    if (this.balance(invoice) <= 0) return [...events, { what: 'settled', on: events.at(-1)!.on, line: (invoice.credited ?? 0) > 0 ? 'Settled: paid and credited' : 'Paid in full' }];
    const due = invoice.dueDate ?? invoice.issueDate;
    return [...events, { what: 'awaiting', on: due, line: invoice.paid > 0 || (invoice.credited ?? 0) > 0 ? `Awaiting ${inr(this.balance(invoice))}, due ${due}` : `Awaiting payment, due ${due}` }];
  }

  private creditView(credit: HeldCredit): CreditNoteView {
    const invoice = this.invoices.find((i) => i.id === credit.invoiceId);
    const line = credit.status === 'waiting' ? 'Waiting on Today for you to issue it.' : credit.status === 'cancelled' ? 'Cancelled. Nothing changed.'
      : `Issued on ${credit.at.slice(0, 10)}. Takes ${inr(credit.amount)} off ${invoice?.number ?? 'its invoice'}.`;
    // 4J20: the receipt that names the note's amount (credits.ts creditNoteReceipt), while it waits or once issued.
    const receiptId = credit.status === 'cancelled' ? null : `credit-note:${credit.id}`;
    return { id: credit.id, invoiceId: credit.invoiceId, amount: inr(credit.amount), reason: credit.reason, state: credit.status, number: credit.number, rowId: credit.status === 'waiting' ? `credit:${credit.id}:open` : null, line, receiptId };
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
      next: this.next(invoice),
      timeline: this.timeline(invoice),
      credits: this.credits.filter((c) => c.invoiceId === invoice.id).map((c) => this.creditView(c)),
      ...this.late(invoice),
    };
  }

  private openInvoices(): BooksSummaryLite['openInvoices'] {
    return this.mine()
      .filter((i) => (i.status === 'issued' || i.status === 'part-paid') && i.number !== null && i.dueDate !== null && this.balance(i) > 0)
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
      .map((i) => ({ invoiceId: i.id, number: i.number!, clientName: this.clientName(i.clientId), balanceDisplay: inr(this.balance(i)), dueDate: i.dueDate! }));
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
    if (order.internal) throw new EngineError('INTERNAL_ORDER', 'Your own shop work has no customer invoice.');
    if (order.status === 'cancelled') throw new EngineError('INVALID_VENTURE_REQUEST', 'This order was cancelled.');
    const existing = this.mine().filter((i) => i.orderId === order.id && i.status !== 'void');
    // 4J5 (M11): an order's quote becomes one invoice, once.
    if (existing.some((i) => i.status !== 'draft')) throw new EngineError('QUOTE_ALREADY_INVOICED', "This order's quote is on an issued invoice already. One order becomes one invoice, once.");
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

  /**
   * venture.payment.record: one invoice (with any TDS the client deducted), or one payment split across invoices
   * (allocations) that must add up to the amount exactly. A cheque waits to clear; nothing it holds can be paid twice.
   */
  private record(p: Record<string, unknown>): InvoiceViewLite {
    if ((p.invoiceId === undefined) === (p.allocations === undefined)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Name one invoice, or split the payment across invoices, not both.');
    if (p.tds !== undefined && p.allocations !== undefined) throw new EngineError('INVALID_VENTURE_REQUEST', 'TDS goes on a payment of one invoice.');
    if (p.allocations === undefined) return this.recordOne(p, p.invoiceId, null);
    const total = paiseOf(p.amount);
    if (total === null) throw new EngineError('INVALID_AMOUNT', 'Amount must be a positive amount like 2499 or 2499.50.');
    const parts = Array.isArray(p.allocations) ? (p.allocations as Record<string, unknown>[]) : [];
    if (!parts.length || parts.length > 20) throw new EngineError('INVALID_VENTURE_REQUEST', 'Split a payment across 1 to 20 invoices.');
    if (new Set(parts.map((part) => part.invoiceId)).size !== parts.length) throw new EngineError('INVALID_VENTURE_REQUEST', 'Name each invoice once.');
    const minors = parts.map((part) => paiseOf(part.amount));
    if (minors.some((minor) => minor === null)) throw new EngineError('INVALID_AMOUNT', 'Each part must be a positive amount like 2499 or 2499.50.');
    const sum = minors.reduce((added: number, minor) => added + (minor ?? 0), 0);
    if (sum > total) throw new EngineError('PAYMENT_TOO_LARGE', `The parts add up to ${inr(sum)}, more than the payment of ${inr(total)}.`);
    if (sum < total) throw new EngineError('INVALID_AMOUNT', `The parts add up to ${inr(sum)}; the payment is ${inr(total)}. Give every part of it an invoice.`);
    for (const [index, part] of parts.entries()) {
      const invoice = this.find(part.invoiceId);
      if (minors[index]! > this.free(invoice)) throw new EngineError('PAYMENT_TOO_LARGE', `This is more than the balance of ${inr(this.balance(invoice))}.`);
    }
    const groupId = `split-${this.paymentSeq}`;
    const typed = (minor: number) => `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;
    const views = parts.map((part, index) => this.recordOne({ ...p, amount: typed(minors[index]!) }, part.invoiceId, groupId));
    return views[0]!;
  }

  private recordOne(p: Record<string, unknown>, invoiceId: unknown, groupId: string | null): InvoiceViewLite {
    const typed = typeof p.amount === 'string' && p.amount.length <= 40 ? p.amount.replace(/[\s,]/g, '') : '';
    if (!/^\d+(?:\.\d+)?$/.test(typed)) throw new EngineError('INVALID_AMOUNT', 'Amount must be a positive amount like 2499 or 2499.50.');
    if (typeof p.receivedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.receivedOn)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Date received must be a date like 2026-10-21.');
    if (!METHODS.includes(p.method as PaymentMethod)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose how the money came in.');
    const invoice = this.find(invoiceId);
    if (invoice.status === 'draft') throw new EngineError('INVALID_VENTURE_REQUEST', 'Issue this invoice before you record a payment.');
    if (invoice.status === 'void') throw new EngineError('INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
    if (invoice.status === 'paid') throw new EngineError('PAYMENT_TOO_LARGE', 'This invoice is already paid in full.');
    const [whole = '0', fraction = ''] = typed.split('.');
    const digits = fraction.replace(/0+$/, '');
    if (digits.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
    if (whole.length > 13) throw new EngineError('INVALID_AMOUNT', 'That amount is too large for one payment.');
    const amount = Number.parseInt(whole, 10) * 100 + Number.parseInt(digits.padEnd(2, '0'), 10);
    if (amount <= 0) throw new EngineError('INVALID_AMOUNT', 'The amount must be above zero.');
    let tds: { section: string; amount: number } | null = null;
    if (p.tds !== undefined) {
      const given = (p.tds ?? {}) as Record<string, unknown>;
      const section = typeof given.section === 'string' ? given.section.trim() : '';
      if (!/^[A-Za-z0-9][A-Za-z0-9 ().,/-]{0,39}$/.test(section)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Give the TDS section as the client wrote it, like 194J.');
      const withheld = paiseOf(given.amount);
      if (withheld === null || withheld <= 0) throw new EngineError('INVALID_AMOUNT', 'The TDS must be above zero.');
      tds = { section, amount: withheld };
    }
    const balance = this.balance(invoice);
    const free = this.free(invoice);
    if (amount + (tds?.amount ?? 0) > free) throw new EngineError('PAYMENT_TOO_LARGE', free === balance ? `This is more than the balance of ${inr(balance)}.` : `This is more than the ${inr(free)} free to pay: a cheque or a credit note waiting holds the rest of the ${inr(balance)} balance.`);
    const method = p.method as PaymentMethod;
    const pending = method === 'cheque';
    if (!pending) this.settle(invoice, amount + (tds?.amount ?? 0));
    this.payments.push({
      id: `pay-new-${this.paymentSeq++}`, at: this.host.now(), businessId: invoice.businessId, invoiceId: invoice.id, receivedOn: p.receivedOn, method,
      booksReceiptId: pending ? null : this.newReceipt('Received', amount, `Payment for ${invoice.number ?? 'the invoice'} by ${METHOD_WORDS[method]}, received on ${p.receivedOn}.`), booksNote: null, amount,
      ...(pending ? { state: 'pending' as const } : {}), ...(groupId ? { split: { groupId } } : {}), ...(tds ? { tds: { section: tds.section }, tdsAmount: tds.amount } : {}),
    });
    this.sealed(invoice);
    this.host.changed();
    return this.view(invoice);
  }

  /** Moves an invoice's paid figure and its status by what a payment settles. */
  private settle(invoice: HeldInvoice, settles: number): void {
    invoice.paid += settles;
    invoice.status = this.balance(invoice) <= 0 ? 'paid' : 'part-paid';
  }

  /** venture.payment.clear: a pending cheque (and the other parts of its split payment) counts from today. */
  private clear(p: Record<string, unknown>): InvoiceViewLite {
    const payment = this.payments.find((item) => item.id === p.paymentId && item.businessId === this.host.business());
    if (!payment) throw new EngineError('INVALID_VENTURE_REQUEST', 'This payment was not found.');
    if (payment.state !== 'pending') throw new EngineError('INVALID_VENTURE_REQUEST', 'This payment has already cleared.');
    const group = payment.split ? this.payments.filter((item) => item.split?.groupId === payment.split?.groupId && item.state === 'pending') : [payment];
    for (const part of group) {
      const invoice = this.find(part.invoiceId);
      this.settle(invoice, part.amount + (part.tdsAmount ?? 0));
      Object.assign(part, { state: 'cleared' as const, chequeOn: part.receivedOn, receivedOn: this.today(), booksReceiptId: this.newReceipt('Received', part.amount, `A cheque for ${invoice.number ?? 'the invoice'}, cleared on ${this.today()}.`) });
      this.sealed(invoice);
    }
    this.host.changed();
    return this.view(this.find(payment.invoiceId));
  }

  /** venture.credit.issue: asks for a credit note on an issued invoice; it waits on Today as an 'invoice' card. */
  private askCredit(p: Record<string, unknown>): { creditNote: CreditNoteView } {
    const invoice = this.find(p.invoiceId);
    // 4J20: the amount as typed (amount) or in minor units (amountMinor), one of them, as the engine's typedOrMinor.
    if ((p.amount === undefined) === (p.amountMinor === undefined)) throw new EngineError('INVALID_AMOUNT', 'Give the credit once, as you would type it, like 1500 or 1500.50.');
    const typed = p.amount === undefined ? null : paiseOf(p.amount);
    if (p.amount !== undefined && (typed === null || typed <= 0)) throw new EngineError('INVALID_AMOUNT', 'The credit must be a positive amount like 2499 or 2499.50.');
    if (p.amountMinor !== undefined && (typeof p.amountMinor !== 'string' || !/^(0|[1-9]\d{0,13})$/.test(p.amountMinor) || p.amountMinor === '0')) throw new EngineError('INVALID_AMOUNT', 'The credit must be a whole amount in minor units, above zero.');
    const reason = typeof p.reason === 'string' ? p.reason.trim().replace(/\s+/g, ' ') : '';
    if (reason.length < 3 || reason.length > 300) throw new EngineError('INVALID_VENTURE_REQUEST', 'The reason must be between 3 and 300 characters.');
    if (typeof p.digest !== 'string' || !p.digest) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the digest of the invoice you checked.');
    if (invoice.status === 'draft' || !invoice.number) throw new EngineError('INVALID_VENTURE_REQUEST', 'This invoice is still a draft. Change the draft instead of crediting it.');
    if (invoice.digest !== p.digest) throw new EngineError('APPROVAL_STALE', 'This invoice changed after you checked it. Look at it again.');
    const amount = typed ?? Number.parseInt(p.amountMinor as string, 10);
    const free = this.free(invoice);
    if (amount > free) throw new EngineError('CREDIT_TOO_LARGE', free <= 0 ? `Nothing is left to credit on ${invoice.number}.` : `A credit note can be at most ${inr(free)} on ${invoice.number}: what is owed and not held by a cheque or another credit note.`);
    const credit: HeldCredit = { id: `cn-${this.creditSeq++}`, at: this.host.now(), businessId: invoice.businessId, invoiceId: invoice.id, amount, reason, status: 'waiting', number: null };
    this.credits.push(credit);
    if (this.host.rows && this.host.setRows && this.host.digest) {
      const name = this.clientName(invoice.clientId);
      const balance = this.balance(invoice);
      const seed: Omit<QueueRow, 'digest'> = {
        id: `credit:${credit.id}:open`, businessId: invoice.businessId, businessName: invoice.businessId, kind: 'invoice', createdAt: credit.at,
        title: `Credit note for ${name} on ${invoice.number}`, line: `Takes ${inr(amount)} off what ${name} owes. Reason: ${reason}`,
        change: { label: `Left to pay on ${invoice.number}`, before: inr(balance), after: inr(balance - amount) }, viewRef: { kind: 'file', id: invoice.id },
        actions: [{ id: 'deny', label: 'Cancel it', primary: false }, { id: 'issue', label: 'Issue credit note', primary: true, secondAsk: true }],
      };
      this.host.setRows([...this.host.rows(), { ...seed, digest: this.host.digest(seed) } as QueueRow]);
    }
    this.host.changed();
    return { creditNote: this.creditView(credit) };
  }

  /** Issue or Cancel on a credit note's card (fake.ts decide calls this for 'credit:' rows): the engine's line. */
  decideCredit(rowId: string, action: string): string | null {
    const credit = this.credits.find((c) => rowId === `credit:${c.id}:open`);
    if (!credit || credit.status !== 'waiting') return null;
    const invoice = this.find(credit.invoiceId);
    if (action === 'deny') {
      credit.status = 'cancelled';
      return `Cancelled. Nothing changed on ${invoice.number}.`;
    }
    credit.status = 'issued';
    credit.number = `CN-${String(this.credits.filter((c) => c.status === 'issued').length).padStart(4, '0')}`;
    invoice.credited = (invoice.credited ?? 0) + credit.amount;
    if (this.balance(invoice) <= 0) invoice.status = 'paid';
    this.sealed(invoice);
    this.host.changed();
    return this.balance(invoice) <= 0 ? `Issued credit note ${credit.number}. ${invoice.number} is settled.`
      : `Issued credit note ${credit.number}. ${this.clientName(invoice.clientId)} now owes ${inr(this.balance(invoice))} on ${invoice.number}.`;
  }

  /** venture.invoice.remind: a draft the owner sends from their own app; nothing is sent. */
  private remind(p: Record<string, unknown>): { draft: OutreachView; receiptId?: string } {
    const invoice = this.find(p.invoiceId);
    if (invoice.status === 'draft' || !invoice.number) throw new EngineError('INVALID_VENTURE_REQUEST', 'Issue this invoice before you remind anyone about it.');
    if (this.balance(invoice) <= 0) throw new EngineError('INVALID_VENTURE_REQUEST', 'This invoice has nothing left to pay.');
    if (this.payments.some((item) => item.invoiceId === invoice.id && item.state === 'pending')) throw new EngineError('INVALID_VENTURE_REQUEST', 'A cheque for this invoice is waiting to clear. Clear it before you remind them.');
    const name = this.clientName(invoice.clientId);
    const email = this.host.clients().find((c) => c.id === invoice.clientId)?.email ?? null;
    const late = invoice.dueDate !== null && invoice.dueDate < this.today();
    const text = [
      `Hello ${name},`, '',
      `This is a reminder that invoice ${invoice.number}, dated ${invoice.issueDate}, ${late ? 'was' : 'is'} due on ${invoice.dueDate}. ${inr(this.balance(invoice))} is still to pay.`, '',
      'If you have already paid, thank you, and please ignore this note.',
    ].join('\n');
    const id = `reminder-${this.reminders.length + 1}`;
    this.reminders.push({ id, invoiceId: invoice.id, at: this.host.now() });
    const receiptId = this.newReceipt(`Left to pay on ${invoice.number}`, this.balance(invoice), `${invoice.number}: its total less what was paid and credited.`);
    this.host.changed();
    return {
      draft: { id, opportunityId: null, kind: 'reminder', channel: 'email', to: email, subject: `Payment reminder: ${invoice.number}`, text, blurb: null, footer: null, lints: [], counter: null, sent: null, digest: digest(text) },
      receiptId,
    };
  }

  /** venture.invoice.recurring: one schedule per client and offer, from today or later; the sample engine drafts nothing by itself. */
  private schedule(p: Record<string, unknown>): { recurring: RecurringInvoiceView } {
    if (typeof p.clientId !== 'string' || !this.host.clients().some((c) => c.id === p.clientId)) throw new EngineError('CLIENT_NOT_FOUND', 'Add this client first.');
    if (typeof p.offerId !== 'string' || !p.offerId) throw new EngineError('OFFER_NOT_FOUND', 'Your plan has no such offer.');
    if (p.frequency !== 'monthly' && p.frequency !== 'quarterly') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose monthly or quarterly.');
    if (typeof p.startOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.startOn)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Start date must be a date like 2026-10-15.');
    if (p.end !== undefined && (typeof p.end !== 'string' || p.end < p.startOn)) throw new EngineError('INVALID_VENTURE_REQUEST', 'The end date must be on or after the start date.');
    const existing = this.schedules.find((s) => s.businessId === this.host.business() && s.clientId === p.clientId && s.offerId === p.offerId);
    if ((!existing || existing.startOn !== p.startOn) && p.startOn < this.today()) throw new EngineError('INVALID_VENTURE_REQUEST', 'Start today or later. Draft earlier invoices one by one.');
    const client = this.host.clients().find((c) => c.id === p.clientId)!.name;
    const every = p.frequency === 'monthly' ? 'every month' : 'every 3 months';
    const until = typeof p.end === 'string' ? ` until ${p.end}` : '';
    const view: RecurringInvoiceView = {
      id: existing?.id ?? `recurring-${this.schedules.length + 1}`, clientId: p.clientId, offerId: p.offerId, frequency: p.frequency, startOn: p.startOn,
      end: typeof p.end === 'string' ? p.end : null, nextOn: p.startOn, line: `Your offer for ${client}, ${every} from ${p.startOn}${until}. Next draft on ${p.startOn}, for you to check and issue.`,
    };
    if (existing) Object.assign(existing, view); else this.schedules.push({ ...view, businessId: this.host.business() });
    return { recurring: view };
  }
}
