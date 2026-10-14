/**
 * Zoho Books v3 write adapters. Base URL by data centre (in, com, eu, com.au, jp, ca, sa);
 * OAuth access token from the credential broker as `Zoho-oauthtoken`. Amounts go on the wire as
 * rupee decimals converted exactly from paise and come back through `toPaise`.
 */
import { check } from '../../contracts.ts';
import { json, wire } from '../http.ts';
import { account, effectReference, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, Observation, Preparation, SystemAdapters, WireObject } from '../types.ts';
import { date, email, integer, list, oneOf, optionalText, paise, record, rupees, str, text, toPaise } from '../validate.ts';

const ID = /^[0-9]{1,30}$/;
function base(ctx: AdapterContext) {
  const dc = account(ctx, 'dataCenter', /^(in|com|eu|com\.au|jp|ca|sa)$/);
  return `https://www.zohoapis.${dc}/books/v3`;
}
async function call(ctx: AdapterContext, method: 'GET' | 'POST' | 'PUT', path: string, query: Record<string, string> = {}, body?: WireObject) {
  const org = account(ctx, 'organizationId', ID);
  const url = new URL(`${base(ctx)}${path}`); url.searchParams.set('organization_id', org);
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const response = await ctx.http(wire(method, url.toString(), { authorization: `Zoho-oauthtoken ${await secret(ctx, 'accessToken')}` }, body));
  const parsed = json(response);
  check(parsed && parsed.code === 0, 'WRITE_SYSTEM_REFUSED', 'Zoho Books refused the request.');
  return parsed;
}
/** Paise to the decimal number Zoho expects; refuses any value that would not round-trip exactly. */
function decimal(minor: string): number { const value = Number(rupees(minor)); check(toPaise(value) === minor, 'INVALID_AMOUNT', 'The amount cannot be sent exactly.'); return value; }

type Line = { name: string; description?: string; quantity: number; rateMinor: string };
function lines(value: unknown): Line[] {
  return list(value, 50, item => {
    const line = record(item, ['name', 'quantity', 'rateMinor'], ['description']);
    return { name: text(line.name, 200), ...(line.description === undefined ? {} : { description: text(line.description, 2000) }), quantity: integer(line.quantity, 1, 1000000), rateMinor: paise(line.rateMinor) };
  });
}
const wireLines = (items: Line[]) => items.map(line => ({ name: line.name, ...(line.description ? { description: line.description } : {}), quantity: line.quantity, rate: decimal(line.rateMinor) }));
const observedLines = (items: any[]) => (Array.isArray(items) ? items : []).map(item => ({ name: str(item.name), quantity: Number(item.quantity), rateMinor: toPaise(item.rate) }));
const linePreview = (items: Line[]) => items.map((line, index) => ({ name: `Line ${index + 1}`, before: '', after: `${line.name} × ${line.quantity} at ₹${rupees(line.rateMinor)}` }));
function absent(preview: Preparation['preview'], target: Preparation['target'], command: WireObject, postconditions: WireObject): Preparation {
  return { before: null, command, postconditions, preview, target, sourceVersion: null, alreadyApplied: null };
}
function applied(found: any, externalId: string, observed: WireObject): Observation {
  return found ? { outcome: 'confirmed-applied', observed, externalId, businessSuccess: true } : { outcome: 'inconclusive', reason: 'The record was not found by its reference yet.' };
}

type Invoice = { customerId: string; date: string; dueDate?: string; lines: Line[]; notes?: string };
const invoiceCreateDraft: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['customerId', 'date', 'lines'], ['dueDate', 'notes']);
    return { customerId: text(p.customerId, 30, ID), date: date(p.date), ...(p.dueDate === undefined ? {} : { dueDate: date(p.dueDate) }), lines: lines(p.lines), ...(p.notes === undefined ? {} : { notes: text(p.notes, 2000) }) } as Invoice;
  },
  async prepare(ctx, p: Invoice, key) {
    const reference = effectReference(key);
    const customer = (await call(ctx, 'GET', `/contacts/${p.customerId}`)).contact;
    check(customer && customer.contact_id === p.customerId, 'WRITE_TARGET_NOT_FOUND', 'The customer is not in this Zoho Books organisation.');
    const existing = (await call(ctx, 'GET', '/invoices', { reference_number: reference })).invoices ?? [];
    const command = { customer_id: p.customerId, date: p.date, ...(p.dueDate ? { due_date: p.dueDate } : {}), reference_number: reference, line_items: wireLines(p.lines), ...(p.notes ? { notes: p.notes } : {}) };
    const preparation = absent({ fields: [{ name: 'Customer', before: '', after: str(customer.contact_name) }, { name: 'Date', before: '', after: p.date }, ...linePreview(p.lines), { name: 'Status', before: '', after: 'draft' }] },
      { label: `Draft invoice for ${str(customer.contact_name)}`, ref: null }, command, { customer_id: p.customerId, reference_number: reference, status: 'draft', lines: p.lines.map(l => ({ name: l.name, quantity: l.quantity, rateMinor: l.rateMinor })) });
    if (existing.length) preparation.alreadyApplied = { externalId: str(existing[0].invoice_id) };
    return preparation;
  },
  async do(ctx, _p, preparation) {
    const created = (await call(ctx, 'POST', '/invoices', {}, preparation.command)).invoice;
    return { outcome: 'provider-claims-applied', externalId: str(created?.invoice_id) || null, data: { invoiceNumber: str(created?.invoice_number) } };
  },
  async readBack(ctx, _p, preparation) {
    const found = ((await call(ctx, 'GET', '/invoices', { reference_number: str(preparation.command.reference_number) })).invoices ?? []);
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one invoice carries this reference.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No invoice carries this reference yet.' };
    const invoice = (await call(ctx, 'GET', `/invoices/${found[0].invoice_id}`)).invoice;
    return applied(invoice, str(invoice.invoice_id), { customer_id: str(invoice.customer_id), reference_number: str(invoice.reference_number), status: str(invoice.status), lines: observedLines(invoice.line_items), totalMinor: toPaise(invoice.total) });
  },
};

type Reminder = { invoiceId: string; to: string[]; subject: string; body: string };
const invoicePaymentReminder: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['invoiceId', 'to', 'subject', 'body']);
    return { invoiceId: text(p.invoiceId, 30, ID), to: list(p.to, 5, email), subject: text(p.subject, 200), body: text(p.body, 5000) } as Reminder;
  },
  async prepare(ctx, p: Reminder, key) {
    const reference = effectReference(key);
    const invoice = (await call(ctx, 'GET', `/invoices/${p.invoiceId}`)).invoice;
    check(invoice && invoice.invoice_id === p.invoiceId, 'WRITE_TARGET_NOT_FOUND', 'The invoice is not in this Zoho Books organisation.');
    check(!['paid', 'void', 'draft'].includes(str(invoice.status)), 'WRITE_PRECONDITION_FAILED', 'Only a sent, unpaid invoice gets a reminder.');
    const body = `${p.body}\n\nRef: ${reference}`;
    const comments = (await call(ctx, 'GET', `/invoices/${p.invoiceId}/comments`)).comments ?? [];
    const prior = comments.find((c: any) => str(c.description).includes(reference));
    return { before: { status: str(invoice.status), balanceMinor: toPaise(invoice.balance) }, command: { to_mail_ids: p.to, subject: p.subject, body },
      postconditions: { invoice_id: p.invoiceId, reference }, preview: { asWritten: `To: ${p.to.join(', ')}\nSubject: ${p.subject}\n\n${body}` },
      target: { label: `Invoice ${str(invoice.invoice_number)}`, ref: p.invoiceId }, sourceVersion: str(invoice.last_modified_time) || null, alreadyApplied: prior ? { externalId: str(prior.comment_id) || null } : null };
  },
  async do(ctx, p: Reminder, preparation) {
    await call(ctx, 'POST', `/invoices/${p.invoiceId}/paymentreminder`, {}, preparation.command);
    return { outcome: 'accepted', externalId: null, data: null };
  },
  async readBack(ctx, p: Reminder, preparation) {
    const reference = str(preparation.postconditions.reference);
    const found = ((await call(ctx, 'GET', `/invoices/${p.invoiceId}/comments`)).comments ?? []).filter((c: any) => str(c.description).includes(reference));
    if (found.length > 1) return { outcome: 'conflicting', reason: 'The reminder appears more than once.' };
    return applied(found[0], str(found[0]?.comment_id), { invoice_id: p.invoiceId, reference });
  },
};

type Payment = { customerId: string; invoiceId: string; amountMinor: string; date: string; mode: string; bankReference?: string };
const paymentRecord: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['customerId', 'invoiceId', 'amountMinor', 'date', 'mode'], ['bankReference']);
    return { customerId: text(p.customerId, 30, ID), invoiceId: text(p.invoiceId, 30, ID), amountMinor: paise(p.amountMinor), date: date(p.date), mode: oneOf(p.mode, ['banktransfer', 'cash', 'cheque', 'upi', 'creditcard'] as const), ...(p.bankReference === undefined ? {} : { bankReference: text(p.bankReference, 100) }) } as Payment;
  },
  async prepare(ctx, p: Payment, key) {
    const reference = effectReference(key);
    const invoice = (await call(ctx, 'GET', `/invoices/${p.invoiceId}`)).invoice;
    check(invoice && invoice.customer_id === p.customerId, 'WRITE_TARGET_NOT_FOUND', 'The invoice does not belong to this customer.');
    const balance = toPaise(invoice.balance);
    check(BigInt(balance) >= BigInt(p.amountMinor), 'WRITE_PRECONDITION_FAILED', 'The payment is larger than what is still due on the invoice.');
    const existing = (await call(ctx, 'GET', '/customerpayments', { reference_number: reference })).customerpayments ?? [];
    const command = { customer_id: p.customerId, payment_mode: p.mode, amount: decimal(p.amountMinor), date: p.date, reference_number: reference, ...(p.bankReference ? { description: `Bank reference ${p.bankReference}` } : {}), invoices: [{ invoice_id: p.invoiceId, amount_applied: decimal(p.amountMinor) }] };
    return { before: { balanceMinor: balance, status: str(invoice.status) }, command, postconditions: { reference_number: reference, amountMinor: p.amountMinor, date: p.date, invoice_id: p.invoiceId },
      preview: { fields: [{ name: 'Invoice', before: str(invoice.invoice_number), after: str(invoice.invoice_number) }, { name: 'Amount received', before: '', after: `₹${rupees(p.amountMinor)}` }, { name: 'Still due', before: `₹${rupees(balance)}`, after: `₹${rupees((BigInt(balance) - BigInt(p.amountMinor)).toString())}` }, { name: 'Date', before: '', after: p.date }] },
      target: { label: `Payment on invoice ${str(invoice.invoice_number)}`, ref: p.invoiceId }, sourceVersion: str(invoice.last_modified_time) || null, alreadyApplied: existing.length ? { externalId: str(existing[0].payment_id) } : null };
  },
  async do(ctx, _p, preparation) {
    const payment = (await call(ctx, 'POST', '/customerpayments', {}, preparation.command)).payment;
    return { outcome: 'provider-claims-applied', externalId: str(payment?.payment_id) || null, data: null };
  },
  async readBack(ctx, _p, preparation) {
    const found = (await call(ctx, 'GET', '/customerpayments', { reference_number: str(preparation.postconditions.reference_number) })).customerpayments ?? [];
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one payment carries this reference.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No payment carries this reference yet.' };
    const payment = (await call(ctx, 'GET', `/customerpayments/${found[0].payment_id}`)).payment;
    const applied0 = (payment.invoices ?? [])[0];
    return applied(payment, str(payment.payment_id), { reference_number: str(payment.reference_number), amountMinor: toPaise(payment.amount), date: str(payment.date), invoice_id: str(applied0?.invoice_id) });
  },
};

type ContactNew = { name: string; type: 'customer' | 'vendor'; email?: string };
const contactCreate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['name', 'type'], ['email']);
    return { name: text(p.name, 200), type: oneOf(p.type, ['customer', 'vendor'] as const), ...(p.email === undefined ? {} : { email: email(p.email) }) } as ContactNew;
  },
  async prepare(ctx, p: ContactNew) {
    const existing = ((await call(ctx, 'GET', '/contacts', { contact_name: p.name })).contacts ?? []).filter((c: any) => c.contact_name === p.name);
    const command = { contact_name: p.name, contact_type: p.type, ...(p.email ? { contact_persons: [{ email: p.email, is_primary_contact: true }] } : {}) };
    return { before: null, command, postconditions: { contact_name: p.name, contact_type: p.type, ...(p.email ? { email: p.email } : {}) },
      preview: { fields: [{ name: 'Name', before: '', after: p.name }, { name: 'Type', before: '', after: p.type }, ...(p.email ? [{ name: 'Email', before: '', after: p.email }] : [])] },
      target: { label: `New ${p.type} ${p.name}`, ref: null }, sourceVersion: null, alreadyApplied: existing.length ? { externalId: str(existing[0].contact_id) } : null };
  },
  async do(ctx, _p, preparation) {
    const contact = (await call(ctx, 'POST', '/contacts', {}, preparation.command)).contact;
    return { outcome: 'provider-claims-applied', externalId: str(contact?.contact_id) || null, data: null };
  },
  async readBack(ctx, p: ContactNew) {
    const found = ((await call(ctx, 'GET', '/contacts', { contact_name: p.name })).contacts ?? []).filter((c: any) => c.contact_name === p.name);
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one contact has this name.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No contact has this name yet.' };
    const contact = (await call(ctx, 'GET', `/contacts/${found[0].contact_id}`)).contact;
    return applied(contact, str(contact.contact_id), { contact_name: str(contact.contact_name), contact_type: str(contact.contact_type), ...(p.email ? { email: str(contact.email) } : {}) });
  },
};

const CHANGEABLE = ['email', 'phone', 'payment_terms_label', 'notes'] as const;
type ContactChange = { contactId: string; changes: Record<string, string> };
const contactUpdate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['contactId', 'changes']);
    const changes = record(p.changes, [], CHANGEABLE); check(Object.keys(changes).length > 0, 'INVALID_WRITE_PAYLOAD', 'Name at least one field to change.');
    const clean: Record<string, string> = {};
    for (const [field, value] of Object.entries(changes)) clean[field] = field === 'email' ? email(value) : text(value, 500);
    return { contactId: text(p.contactId, 30, ID), changes: clean } as ContactChange;
  },
  async prepare(ctx, p: ContactChange) {
    const contact = (await call(ctx, 'GET', `/contacts/${p.contactId}`)).contact;
    check(contact && contact.contact_id === p.contactId, 'WRITE_TARGET_NOT_FOUND', 'The contact is not in this organisation.');
    const before: WireObject = {}; for (const field of Object.keys(p.changes)) before[field] = str(contact[field]);
    const same = Object.entries(p.changes).every(([field, value]) => before[field] === value);
    return { before, command: { ...p.changes }, postconditions: { ...p.changes }, preview: { fields: Object.entries(p.changes).map(([name, after]) => ({ name, before: str(before[name]), after })) },
      target: { label: `Contact ${str(contact.contact_name)}`, ref: p.contactId }, sourceVersion: str(contact.last_modified_time) || null, alreadyApplied: same ? { externalId: p.contactId } : null };
  },
  async do(ctx, p: ContactChange, preparation) {
    const current = (await call(ctx, 'GET', `/contacts/${p.contactId}`)).contact;
    check(Object.keys(p.changes).every(field => str(current[field]) === str(preparation.before?.[field])), 'WRITE_PRECONDITION_FAILED', 'The contact changed after the preview. Prepare it again.');
    await call(ctx, 'PUT', `/contacts/${p.contactId}`, {}, preparation.command);
    return { outcome: 'provider-claims-applied', externalId: p.contactId, data: null };
  },
  async readBack(ctx, p: ContactChange) {
    const contact = (await call(ctx, 'GET', `/contacts/${p.contactId}`)).contact;
    const observed: WireObject = {}; for (const field of Object.keys(p.changes)) observed[field] = str(contact[field]);
    return Object.entries(p.changes).every(([field, value]) => observed[field] === value) ? { outcome: 'confirmed-applied', observed, externalId: p.contactId, businessSuccess: true } : { outcome: 'inconclusive', reason: 'The contact does not show the new values yet.' };
  },
};

type Bill = { vendorId: string; billNumber: string; date: string; dueDate?: string; lines: Line[]; photoReference?: string };
const billCreateFromPhoto: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['vendorId', 'billNumber', 'date', 'lines'], ['dueDate', 'photoReference']);
    return { vendorId: text(p.vendorId, 30, ID), billNumber: text(p.billNumber, 100), date: date(p.date), ...(p.dueDate === undefined ? {} : { dueDate: date(p.dueDate) }), lines: lines(p.lines), ...(p.photoReference === undefined ? {} : { photoReference: optionalText(p.photoReference, 200)! }) } as Bill;
  },
  async prepare(ctx, p: Bill, key) {
    const reference = effectReference(key);
    const vendor = (await call(ctx, 'GET', `/contacts/${p.vendorId}`)).contact;
    check(vendor && vendor.contact_type === 'vendor', 'WRITE_TARGET_NOT_FOUND', 'The vendor is not in this organisation.');
    const sameNumber = ((await call(ctx, 'GET', '/bills', { vendor_id: p.vendorId, bill_number: p.billNumber })).bills ?? []).filter((b: any) => b.bill_number === p.billNumber && b.vendor_id === p.vendorId);
    const ours = (await call(ctx, 'GET', '/bills', { reference_number: reference })).bills ?? [];
    check(!sameNumber.length || ours.length, 'WRITE_PRECONDITION_FAILED', 'A bill from this vendor already has this number.');
    const command = { vendor_id: p.vendorId, bill_number: p.billNumber, date: p.date, ...(p.dueDate ? { due_date: p.dueDate } : {}), reference_number: reference, line_items: wireLines(p.lines) };
    return { before: null, command, postconditions: { vendor_id: p.vendorId, bill_number: p.billNumber, reference_number: reference, lines: p.lines.map(l => ({ name: l.name, quantity: l.quantity, rateMinor: l.rateMinor })) },
      preview: { fields: [{ name: 'Vendor', before: '', after: str(vendor.contact_name) }, { name: 'Bill number', before: '', after: p.billNumber }, { name: 'Date', before: '', after: p.date }, ...linePreview(p.lines)] },
      target: { label: `Bill ${p.billNumber} from ${str(vendor.contact_name)}`, ref: null }, sourceVersion: null, alreadyApplied: ours.length ? { externalId: str(ours[0].bill_id) } : null };
  },
  async do(ctx, _p, preparation) {
    const bill = (await call(ctx, 'POST', '/bills', {}, preparation.command)).bill;
    return { outcome: 'provider-claims-applied', externalId: str(bill?.bill_id) || null, data: null };
  },
  async readBack(ctx, _p, preparation) {
    const found = (await call(ctx, 'GET', '/bills', { reference_number: str(preparation.postconditions.reference_number) })).bills ?? [];
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one bill carries this reference.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No bill carries this reference yet.' };
    const bill = (await call(ctx, 'GET', `/bills/${found[0].bill_id}`)).bill;
    return applied(bill, str(bill.bill_id), { vendor_id: str(bill.vendor_id), bill_number: str(bill.bill_number), reference_number: str(bill.reference_number), lines: observedLines(bill.line_items) });
  },
};

export const zohoBooksAdapters: SystemAdapters = Object.freeze({
  'invoice.createDraft': invoiceCreateDraft, 'invoice.paymentReminder': invoicePaymentReminder, 'payment.record': paymentRecord,
  'contact.create': contactCreate, 'contact.update': contactUpdate, 'bill.createFromPhoto': billCreateFromPhoto,
});
