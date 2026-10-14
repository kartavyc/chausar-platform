/** A stateful Razorpay v1 account in memory: payments, refunds and payment links, with Basic auth. */
import { readFileSync } from 'node:fs';
import { HttpFake, body, reply, type Route } from '../http-fake.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';

type Rec = Record<string, any>;
export type RazorpaySeed = { keyId: string; keySecret: string; payments: Rec[]; refunds: Rec[]; paymentLinks: Rec[] };
export const razorpaySeed: RazorpaySeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/razorpay.json', import.meta.url), 'utf8'));

export class RazorpayFake extends HttpFake {
  readonly system = 'razorpay' as const;
  readonly keyId: string; readonly keySecret: string;
  payments: Rec[]; refunds: Rec[]; paymentLinks: Rec[];
  /** X-Refund-Idempotency key to the refund it created, and the request it was created for. */
  idempotency = new Map<string, { refundId: string; request: string }>();
  #next = 1000; #clock: () => string;
  constructor(seed: RazorpaySeed = razorpaySeed, clock: () => string = () => new Date().toISOString()) {
    super(); this.keyId = seed.keyId; this.keySecret = seed.keySecret; this.#clock = clock;
    this.payments = structuredClone(seed.payments); this.refunds = structuredClone(seed.refunds); this.paymentLinks = structuredClone(seed.paymentLinks ?? []);
  }
  #id(prefix: string) { return `${prefix}_PRACTICE${String(this.#next++).padStart(6, '0')}`; }
  #now() { return Math.floor(Date.parse(this.#clock()) / 1000); }
  protected authorized(request: WireRequest) { return request.headers.authorization === `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`, 'utf8').toString('base64')}`; }
  #bad(description: string) { return reply(400, { error: { code: 'BAD_REQUEST_ERROR', description, source: 'business', step: 'payment_initiation', reason: 'input_validation_failed' } }); }
  #missing() { return reply(400, { error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } }); }
  #amount(value: unknown) { return Number.isSafeInteger(value) && (value as number) > 0; }
  protected routes(): Route[] {
    return [
      { method: 'GET', path: /^\/v1\/payment_links$/, write: false, handle: (_r, _m, url) => {
        const ref = url.searchParams.get('reference_id'); const links = this.paymentLinks.filter(l => ref === null || l.reference_id === ref);
        return reply(200, { payment_links: links, count: links.length });
      } },
      { method: 'GET', path: /^\/v1\/payment_links\/(plink_\w+)$/, write: false, handle: (_r, m) => { const l = this.paymentLinks.find(x => x.id === m[1]); return l ? reply(200, l) : this.#missing(); } },
      { method: 'POST', path: /^\/v1\/payment_links$/, write: true, handle: request => {
        const b = body(request);
        if (!this.#amount(b.amount) || b.amount < 100) return this.#bad('The amount must be at least INR 1.00.');
        if (b.currency !== 'INR') return this.#bad('The currency is not supported.');
        if (typeof b.reference_id === 'string' && this.paymentLinks.some(l => l.reference_id === b.reference_id)) return this.#bad(`Payment Link with reference id ${b.reference_id} already exists`);
        const id = this.#id('plink');
        const link = { id, entity: 'payment_link', amount: b.amount, amount_paid: 0, currency: b.currency, accept_partial: Boolean(b.accept_partial), reference_id: b.reference_id ?? '', description: b.description ?? '', customer: b.customer ?? {},
          notify: { sms: b.notify?.sms ?? true, email: b.notify?.email ?? true }, reminder_enable: b.reminder_enable ?? true, expire_by: b.expire_by ?? 0, status: 'created', short_url: `https://rzp.io/i/${id.slice(-8)}`, created_at: this.#now() };
        this.paymentLinks.push(link); return reply(200, link);
      } },
      { method: 'GET', path: /^\/v1\/payments\/(pay_\w+)$/, write: false, handle: (_r, m) => { const p = this.payments.find(x => x.id === m[1]); return p ? reply(200, p) : this.#missing(); } },
      { method: 'GET', path: /^\/v1\/payments\/(pay_\w+)\/refunds$/, write: false, handle: (_r, m) => {
        if (!this.payments.some(x => x.id === m[1])) return this.#missing();
        const items = this.refunds.filter(r => r.payment_id === m[1]); return reply(200, { entity: 'collection', count: items.length, items });
      } },
      { method: 'POST', path: /^\/v1\/payments\/(pay_\w+)\/refund$/, write: true, handle: (request, m) => {
        const payment = this.payments.find(x => x.id === m[1]); if (!payment) return this.#missing();
        const key = request.headers['x-refund-idempotency'], b = body(request), fingerprint = JSON.stringify([m[1], b.amount, b.receipt ?? null]);
        if (key) { const seen = this.idempotency.get(key); if (seen) return seen.request === fingerprint ? reply(200, this.refunds.find(r => r.id === seen.refundId)) : this.#bad('The idempotency key was used for a different request.'); }
        if (payment.status !== 'captured') return this.#bad('The payment has not been captured.');
        if (!this.#amount(b.amount)) return this.#bad('The refund amount is invalid.');
        if (b.amount > payment.amount - payment.amount_refunded) return this.#bad('The refund amount provided is greater than amount captured.');
        const refund = { id: this.#id('rfnd'), entity: 'refund', payment_id: payment.id, amount: b.amount, currency: payment.currency, receipt: b.receipt ?? null, notes: b.notes ?? {}, status: 'processed', speed_requested: b.speed ?? 'normal', speed_processed: 'normal', created_at: this.#now() };
        this.refunds.push(refund); payment.amount_refunded += b.amount;
        payment.refund_status = payment.amount_refunded === payment.amount ? 'full' : 'partial'; if (payment.amount_refunded === payment.amount) payment.status = 'refunded';
        if (key) this.idempotency.set(key, { refundId: refund.id, request: fingerprint });
        return reply(200, refund);
      } },
    ];
  }
  prime(payload: WireObject, before: WireObject | null) {
    const p = payload as Rec;
    if (p.paymentId && !this.payments.some(x => x.id === p.paymentId)) {
      const amount = before?.amountMinor ? Number(before.amountMinor) : 100000, refunded = before?.refundedMinor ? Number(before.refundedMinor) : 0;
      this.payments.push({ id: p.paymentId, entity: 'payment', amount, currency: 'INR', status: String(before?.status ?? 'captured'), amount_refunded: refunded, refund_status: refunded ? 'partial' : null, captured: true, method: 'upi', description: 'Practice payment', created_at: this.#now() });
    }
  }
  snapshot(): WireObject { return structuredClone({ payments: this.payments, refunds: this.refunds, paymentLinks: this.paymentLinks }) as WireObject; }
}
