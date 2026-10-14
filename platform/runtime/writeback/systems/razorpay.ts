/**
 * Razorpay v1 write adapters. HTTP Basic auth with the key id and key secret from the credential
 * broker. Amounts go on the wire as integer paise (a JSON number) converted from the paise string
 * with a safe-integer check, and come back the same way: never through a float.
 */
import { check } from '../../contracts.ts';
import { json, wire } from '../http.ts';
import { effectReference, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, Observation, SystemAdapters, WireObject } from '../types.ts';
import { email, instant, paise, phone, record, rupees, str, text } from '../validate.ts';

const BASE = 'https://api.razorpay.com/v1';
const PAYMENT = /^pay_[A-Za-z0-9]{14}$/;
async function call(ctx: AdapterContext, method: 'GET' | 'POST', path: string, query: Record<string, string> = {}, body?: WireObject, headers: Record<string, string> = {}) {
  const url = new URL(`${BASE}${path}`); for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const basic = Buffer.from(`${await secret(ctx, 'keyId')}:${await secret(ctx, 'keySecret')}`, 'utf8').toString('base64');
  return json(await ctx.http(wire(method, url.toString(), { authorization: `Basic ${basic}`, ...headers }, body)));
}
/** Paise string to the integer Razorpay expects; refuses anything beyond a safe integer. */
function wireAmount(minor: string): number { const value = Number(minor); check(Number.isSafeInteger(value) && String(value) === minor, 'INVALID_AMOUNT', 'The amount cannot be sent exactly.'); return value; }
/** Integer paise from Razorpay back to a paise string. */
function fromWire(value: unknown): string { check(Number.isSafeInteger(value) && (value as number) >= 0, 'WRITE_REPLY_INVALID', 'The system sent an amount Chausar cannot read exactly.'); return String(value); }
function noNotify(value: unknown) { check(!(value !== null && typeof value === 'object' && Object.hasOwn(value, 'notify')), 'INVALID_WRITE_PAYLOAD', 'Chausar never lets Razorpay message the customer.'); }

type Customer = { name: string; email?: string; contact?: string };
type Link = { amountMinor: string; description: string; customer: Customer; expireBy?: string };
const linksByReference = async (ctx: AdapterContext, reference: string) => ((await call(ctx, 'GET', '/payment_links', { reference_id: reference })).payment_links ?? []).filter((l: any) => l.reference_id === reference);
const paymentLinkCreate: ActionAdapter<any> = {
  validate(payload) {
    noNotify(payload); const p = record(payload, ['amountMinor', 'description', 'customer'], ['expireBy']);
    noNotify(p.customer); const c = record(p.customer, ['name'], ['email', 'contact']);
    const amountMinor = paise(p.amountMinor); wireAmount(amountMinor);
    return { amountMinor, description: text(p.description, 2048), customer: { name: text(c.name, 100), ...(c.email === undefined ? {} : { email: email(c.email) }), ...(c.contact === undefined ? {} : { contact: phone(c.contact) }) }, ...(p.expireBy === undefined ? {} : { expireBy: instant(p.expireBy) }) } as Link;
  },
  async prepare(ctx, p: Link, key) {
    const reference = effectReference(key);
    if (p.expireBy) check(Date.parse(p.expireBy) >= Date.parse(ctx.clock()) + 16 * 60 * 1000, 'WRITE_PRECONDITION_FAILED', 'A payment link must stay open for at least sixteen minutes.');
    const existing = await linksByReference(ctx, reference);
    const customer = { name: p.customer.name, ...(p.customer.email ? { email: p.customer.email } : {}), ...(p.customer.contact ? { contact: `+${p.customer.contact}` } : {}) };
    const command = { amount: wireAmount(p.amountMinor), currency: 'INR', accept_partial: false, reference_id: reference, description: p.description, customer, notify: { sms: false, email: false }, reminder_enable: false, ...(p.expireBy ? { expire_by: Math.floor(Date.parse(p.expireBy) / 1000) } : {}) };
    return { before: null, command, postconditions: { reference_id: reference, amountMinor: p.amountMinor, currency: 'INR', description: p.description },
      preview: { fields: [{ name: 'Customer', before: '', after: p.customer.name }, { name: 'Amount', before: '', after: `₹${rupees(p.amountMinor)}` }, { name: 'Description', before: '', after: p.description }, { name: 'Notifications', before: '', after: 'off' }, ...(p.expireBy ? [{ name: 'Expires', before: '', after: p.expireBy }] : [])] },
      target: { label: `Payment link for ${p.customer.name}`, ref: null }, sourceVersion: null, alreadyApplied: existing.length ? { externalId: str(existing[0].id) } : null };
  },
  async do(ctx, _p, preparation) {
    const link = await call(ctx, 'POST', '/payment_links', {}, preparation.command);
    return { outcome: 'provider-claims-applied', externalId: str(link?.id) || null, data: { shortUrl: str(link?.short_url) } };
  },
  async readBack(ctx, _p, preparation): Promise<Observation> {
    const found = await linksByReference(ctx, str(preparation.postconditions.reference_id));
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one payment link carries this reference.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No payment link carries this reference yet.' };
    const link = found[0];
    return { outcome: 'confirmed-applied', observed: { reference_id: str(link.reference_id), amountMinor: fromWire(link.amount), currency: str(link.currency), description: str(link.description), status: str(link.status) }, externalId: str(link.id), businessSuccess: link.status === 'created' };
  },
};

type Refund = { paymentId: string; amountMinor: string; note?: string };
const refundsByReceipt = async (ctx: AdapterContext, paymentId: string, receipt: string) => ((await call(ctx, 'GET', `/payments/${paymentId}/refunds`)).items ?? []).filter((r: any) => r.receipt === receipt);
async function payment(ctx: AdapterContext, paymentId: string) {
  const found = await call(ctx, 'GET', `/payments/${paymentId}`);
  check(found && found.id === paymentId, 'WRITE_TARGET_NOT_FOUND', 'The payment is not in this Razorpay account.');
  return { status: str(found.status), amountMinor: fromWire(found.amount), refundedMinor: fromWire(found.amount_refunded ?? 0) };
}
const refundCreate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['paymentId', 'amountMinor'], ['note']);
    const amountMinor = paise(p.amountMinor); wireAmount(amountMinor);
    return { paymentId: text(p.paymentId, 18, PAYMENT), amountMinor, ...(p.note === undefined ? {} : { note: text(p.note, 255) }) } as Refund;
  },
  async prepare(ctx, p: Refund, key) {
    const receipt = effectReference(key);
    const prior = await refundsByReceipt(ctx, p.paymentId, receipt);
    const before = await payment(ctx, p.paymentId);
    const left = BigInt(before.amountMinor) - BigInt(before.refundedMinor);
    if (!prior.length) {
      check(before.status === 'captured', 'WRITE_PRECONDITION_FAILED', 'Only a captured payment can be refunded.');
      check(BigInt(p.amountMinor) <= left, 'WRITE_PRECONDITION_FAILED', 'The refund is larger than what is left to refund on the payment.');
    }
    const command = { amount: wireAmount(p.amountMinor), speed: 'normal', receipt, notes: (p.note ? { note: p.note } : {}) as WireObject };
    return { before, command, postconditions: { receipt, amountMinor: p.amountMinor, payment_id: p.paymentId },
      preview: { fields: [{ name: 'Payment', before: p.paymentId, after: p.paymentId }, { name: 'Refund', before: '', after: `₹${rupees(p.amountMinor)}` }, { name: 'Left to refund', before: `₹${rupees(left.toString())}`, after: prior.length ? `₹${rupees(left.toString())}` : `₹${rupees((left - BigInt(p.amountMinor)).toString())}` }, { name: 'Speed', before: '', after: 'normal' }] },
      target: { label: `Refund on payment ${p.paymentId}`, ref: p.paymentId }, sourceVersion: before.refundedMinor, alreadyApplied: prior.length ? { externalId: str(prior[0].id) } : null };
  },
  async do(ctx, p: Refund, preparation, key) {
    check(/^[\x21-\x7e]{1,200}$/.test(key), 'INVALID_WRITE_PAYLOAD', 'The effect key cannot be sent as a header.');
    const current = await payment(ctx, p.paymentId);
    check(current.status === 'captured' && current.refundedMinor === str(preparation.before?.refundedMinor), 'WRITE_PRECONDITION_FAILED', 'The payment changed after the preview. Prepare it again.');
    const refund = await call(ctx, 'POST', `/payments/${p.paymentId}/refund`, {}, preparation.command, { 'x-refund-idempotency': key });
    return { outcome: 'provider-claims-applied', externalId: str(refund?.id) || null, data: { status: str(refund?.status) } };
  },
  async readBack(ctx, p: Refund, preparation): Promise<Observation> {
    const found = await refundsByReceipt(ctx, p.paymentId, str(preparation.postconditions.receipt));
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one refund carries this receipt.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No refund carries this receipt yet.' };
    const refund = found[0];
    return { outcome: 'confirmed-applied', observed: { receipt: str(refund.receipt), amountMinor: fromWire(refund.amount), payment_id: str(refund.payment_id), status: str(refund.status) }, externalId: str(refund.id), businessSuccess: refund.status !== 'failed' };
  },
};

export const razorpayAdapters: SystemAdapters = Object.freeze({ 'paymentLink.create': paymentLinkCreate, 'refund.create': refundCreate });
