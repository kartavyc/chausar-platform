/** A stateful Zoho Books v3 organisation in memory: contacts, invoices, comments, customer payments, bills. */
import { readFileSync } from 'node:fs';
import { HttpFake, body, reply, type Route } from '../http-fake.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';
import { rupees, toPaise } from '../../runtime/writeback/validate.ts';

type Rec = Record<string, any>;
export type ZohoSeed = { organizationId: string; token: string; contacts: Rec[]; invoices: Rec[] };
export const zohoSeed: ZohoSeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/zoho-books.json', import.meta.url), 'utf8'));

export class ZohoBooksFake extends HttpFake {
  readonly system = 'zoho-books' as const;
  readonly organizationId: string; readonly token: string;
  contacts: Rec[]; invoices: Rec[]; comments: Rec[] = []; payments: Rec[] = []; bills: Rec[] = [];
  #next = 9000; #clock: () => string;
  constructor(seed: ZohoSeed = zohoSeed, clock: () => string = () => new Date().toISOString()) {
    super(); this.organizationId = seed.organizationId; this.token = seed.token; this.#clock = clock;
    this.contacts = structuredClone(seed.contacts); this.invoices = structuredClone(seed.invoices);
  }
  #id() { return `46000000${this.#next++}`; }
  protected authorized(request: WireRequest) {
    return request.headers.authorization === `Zoho-oauthtoken ${this.token}` && new URL(request.url).searchParams.get('organization_id') === this.organizationId;
  }
  #ok(payload: Rec, status = 200) { return reply(status, { code: 0, message: 'success', ...payload }); }
  #missing() { return reply(404, { code: 1002, message: 'Resource does not exist.' }); }
  #balance(invoice: Rec) {
    const paid = this.payments.flatMap(p => p.invoices).filter((a: Rec) => a.invoice_id === invoice.invoice_id).reduce((n: bigint, a: Rec) => n + BigInt(toPaise(a.amount_applied)), 0n);
    return BigInt(toPaise(invoice.total)) - paid;
  }
  #invoiceView(invoice: Rec) {
    const balance = this.#balance(invoice);
    const status = invoice.status === 'draft' || invoice.status === 'void' ? invoice.status : balance <= 0n ? 'paid' : invoice.status === 'paid' ? 'sent' : invoice.status;
    return { ...invoice, status, balance: Number(rupees(balance.toString())) };
  }
  #total(lines: Rec[]) { return Number(rupees(lines.reduce((n, l) => n + BigInt(toPaise(l.rate)) * BigInt(l.quantity), 0n).toString())); }
  protected routes(): Route[] {
    return [
      { method: 'GET', path: /^\/books\/v3\/contacts$/, write: false, handle: (_r, _m, url) => {
        const name = url.searchParams.get('contact_name');
        return this.#ok({ contacts: this.contacts.filter(c => !name || c.contact_name === name) });
      } },
      { method: 'GET', path: /^\/books\/v3\/contacts\/(\d+)$/, write: false, handle: (_r, m) => { const c = this.contacts.find(x => x.contact_id === m[1]); return c ? this.#ok({ contact: c }) : this.#missing(); } },
      { method: 'POST', path: /^\/books\/v3\/contacts$/, write: true, handle: request => {
        const b = body(request);
        if (this.contacts.some(c => c.contact_name === b.contact_name)) return reply(400, { code: 3062, message: 'Contact name already exists.' });
        const contact = { contact_id: this.#id(), contact_name: b.contact_name, contact_type: b.contact_type, email: b.contact_persons?.[0]?.email ?? '', last_modified_time: this.#clock() };
        this.contacts.push(contact); return this.#ok({ contact }, 201);
      } },
      { method: 'PUT', path: /^\/books\/v3\/contacts\/(\d+)$/, write: true, handle: (request, m) => {
        const c = this.contacts.find(x => x.contact_id === m[1]); if (!c) return this.#missing();
        Object.assign(c, body(request), { last_modified_time: this.#clock() }); return this.#ok({ contact: c });
      } },
      { method: 'GET', path: /^\/books\/v3\/invoices$/, write: false, handle: (_r, _m, url) => {
        const ref = url.searchParams.get('reference_number');
        return this.#ok({ invoices: this.invoices.filter(i => ref === null || i.reference_number === ref).map(i => this.#invoiceView(i)) });
      } },
      { method: 'GET', path: /^\/books\/v3\/invoices\/(\d+)$/, write: false, handle: (_r, m) => { const i = this.invoices.find(x => x.invoice_id === m[1]); return i ? this.#ok({ invoice: this.#invoiceView(i) }) : this.#missing(); } },
      { method: 'POST', path: /^\/books\/v3\/invoices$/, write: true, handle: request => {
        const b = body(request); if (!this.contacts.some(c => c.contact_id === b.customer_id)) return reply(400, { code: 1002, message: 'Customer does not exist.' });
        const invoice = { invoice_id: this.#id(), invoice_number: `INV-${String(this.invoices.length + 1).padStart(6, '0')}`, customer_id: b.customer_id, customer_name: this.contacts.find(c => c.contact_id === b.customer_id)!.contact_name,
          date: b.date, due_date: b.due_date ?? b.date, reference_number: b.reference_number ?? '', status: 'draft', line_items: b.line_items, total: this.#total(b.line_items), last_modified_time: this.#clock() };
        this.invoices.push(invoice); return this.#ok({ invoice: this.#invoiceView(invoice) }, 201);
      } },
      { method: 'GET', path: /^\/books\/v3\/invoices\/(\d+)\/comments$/, write: false, handle: (_r, m) => this.#ok({ comments: this.comments.filter(c => c.invoice_id === m[1]) }) },
      { method: 'POST', path: /^\/books\/v3\/invoices\/(\d+)\/paymentreminder$/, write: true, handle: (request, m) => {
        const i = this.invoices.find(x => x.invoice_id === m[1]); if (!i) return this.#missing();
        const b = body(request); this.comments.push({ comment_id: this.#id(), invoice_id: m[1], comment_type: 'system', description: `Payment reminder sent to ${(b.to_mail_ids ?? []).join(', ')}. ${b.body ?? ''}`, date: this.#clock().slice(0, 10) });
        return this.#ok({ message: 'Your payment reminder has been sent.' });
      } },
      { method: 'GET', path: /^\/books\/v3\/customerpayments$/, write: false, handle: (_r, _m, url) => {
        const ref = url.searchParams.get('reference_number'); return this.#ok({ customerpayments: this.payments.filter(p => ref === null || p.reference_number === ref) });
      } },
      { method: 'GET', path: /^\/books\/v3\/customerpayments\/(\d+)$/, write: false, handle: (_r, m) => { const p = this.payments.find(x => x.payment_id === m[1]); return p ? this.#ok({ payment: p }) : this.#missing(); } },
      { method: 'POST', path: /^\/books\/v3\/customerpayments$/, write: true, handle: request => {
        const b = body(request); const invoice = this.invoices.find(i => i.invoice_id === b.invoices?.[0]?.invoice_id);
        if (!invoice || invoice.customer_id !== b.customer_id) return reply(400, { code: 1002, message: 'Invoice does not exist.' });
        if (this.#balance(invoice) < BigInt(toPaise(b.amount))) return reply(400, { code: 24016, message: 'Amount applied exceeds the balance.' });
        const payment = { payment_id: this.#id(), customer_id: b.customer_id, payment_mode: b.payment_mode, amount: b.amount, date: b.date, reference_number: b.reference_number ?? '', description: b.description ?? '', invoices: b.invoices };
        this.payments.push(payment); return this.#ok({ payment }, 201);
      } },
      { method: 'GET', path: /^\/books\/v3\/bills$/, write: false, handle: (_r, _m, url) => {
        const ref = url.searchParams.get('reference_number'), vendor = url.searchParams.get('vendor_id'), number = url.searchParams.get('bill_number');
        return this.#ok({ bills: this.bills.filter(b => (ref === null || b.reference_number === ref) && (vendor === null || b.vendor_id === vendor) && (number === null || b.bill_number === number)) });
      } },
      { method: 'GET', path: /^\/books\/v3\/bills\/(\d+)$/, write: false, handle: (_r, m) => { const b = this.bills.find(x => x.bill_id === m[1]); return b ? this.#ok({ bill: b }) : this.#missing(); } },
      { method: 'POST', path: /^\/books\/v3\/bills$/, write: true, handle: request => {
        const b = body(request); if (!this.contacts.some(c => c.contact_id === b.vendor_id && c.contact_type === 'vendor')) return reply(400, { code: 1002, message: 'Vendor does not exist.' });
        const bill = { bill_id: this.#id(), vendor_id: b.vendor_id, bill_number: b.bill_number, date: b.date, reference_number: b.reference_number ?? '', line_items: b.line_items, total: this.#total(b.line_items), status: 'open' };
        this.bills.push(bill); return this.#ok({ bill }, 201);
      } },
    ];
  }
  prime(payload: WireObject, before: WireObject | null) {
    const p = payload as Rec;
    for (const id of [p.customerId, p.vendorId, p.contactId].filter(Boolean)) if (!this.contacts.some(c => c.contact_id === id)) this.contacts.push({ contact_id: id, contact_name: `Practice contact ${id}`, contact_type: p.vendorId === id ? 'vendor' : 'customer', email: '', ...(p.contactId === id && before ? before : {}), last_modified_time: '2026-01-01T00:00:00.000Z' });
    if (p.invoiceId && !this.invoices.some(i => i.invoice_id === p.invoiceId)) {
      const balance = before?.balanceMinor ? Number(rupees(String(before.balanceMinor))) : 1000;
      this.invoices.push({ invoice_id: p.invoiceId, invoice_number: `INV-P-${p.invoiceId.slice(-4)}`, customer_id: p.customerId ?? this.contacts[0]?.contact_id, date: '2026-01-01', due_date: '2026-01-15', reference_number: '', status: String(before?.status ?? 'overdue'), line_items: [{ name: 'Practice line', quantity: 1, rate: balance }], total: balance, last_modified_time: '2026-01-01T00:00:00.000Z' });
    }
  }
  snapshot(): WireObject { return structuredClone({ contacts: this.contacts, invoices: this.invoices.map(i => this.#invoiceView(i)), comments: this.comments, payments: this.payments, bills: this.bills }) as WireObject; }
}
