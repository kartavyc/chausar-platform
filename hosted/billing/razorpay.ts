import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, sameHex } from '../shared/crypto.ts';
import type { Fetch } from '../shared/module.ts';
import { isEventId, signatureInvalid, type Checkout, type CheckoutInput, type PartnerEvent, type PartnerEventType, type PaymentPartner, type WebhookHeaders } from './partner.ts';

export type RazorpaySettings = { keyId: string; keySecret: string; webhookSecret: string; planId: string };
const API = 'https://api.razorpay.com/v1';
/** Monthly cycles a subscription may run before the person subscribes again (Razorpay requires a count). */
export const RAZORPAY_TOTAL_COUNT = 120;
const isSubscriptionId = (value: unknown): value is string => typeof value === 'string' && /^sub_[A-Za-z0-9]{6,32}$/.test(value);
const EVENTS: Readonly<Record<string, PartnerEventType>> = Object.freeze({
  'subscription.activated': 'activated', 'subscription.charged': 'charged',
  'subscription.pending': 'past_due', 'subscription.halted': 'past_due',
  'subscription.cancelled': 'cancelled', 'subscription.completed': 'cancelled',
});
const failed = () => new HostedError('PAYMENT_PARTNER_FAILED', 'The payment partner did not complete the request.', 502);

/**
 * Razorpay Subscriptions. Founder step: a live Razorpay account (KYC done), a monthly plan created at the price in
 * BILLING_PAID_PRICE_PAISE, and a webhook pointed at /v1/billing/webhooks/razorpay with the subscription events.
 */
export class RazorpayPartner implements PaymentPartner {
  readonly id = 'razorpay';
  readonly #fetch: Fetch; readonly #settings: RazorpaySettings;
  constructor(fetch: Fetch, settings: RazorpaySettings) {
    check(/^rzp_(live|test)_[A-Za-z0-9]{8,32}$/.test(settings.keyId), 'SERVER_MISCONFIGURED', 'The Razorpay key id is not valid.', 500);
    check(/^[A-Za-z0-9]{16,64}$/.test(settings.keySecret), 'SERVER_MISCONFIGURED', 'The Razorpay key secret is not valid.', 500);
    check(typeof settings.webhookSecret === 'string' && settings.webhookSecret.length >= 16 && settings.webhookSecret.length <= 256, 'SERVER_MISCONFIGURED', 'The Razorpay webhook secret is not valid.', 500);
    check(/^plan_[A-Za-z0-9]{6,32}$/.test(settings.planId), 'SERVER_MISCONFIGURED', 'The Razorpay plan id is not valid.', 500);
    this.#fetch = fetch; this.#settings = settings;
  }
  async #post(path: string, payload: unknown): Promise<any> {
    let status = 0, text = '';
    try {
      const reply = await this.#fetch(`${API}${path}`, {
        method: 'POST',
        headers: { authorization: `Basic ${Buffer.from(`${this.#settings.keyId}:${this.#settings.keySecret}`).toString('base64')}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(20000),
      });
      status = reply.status; text = await reply.text();
    } catch { throw failed(); }
    if (status !== 200) throw failed();
    try { const body = JSON.parse(text); if (body && typeof body === 'object') return body; } catch { /* refused below */ }
    throw failed();
  }
  async createCheckout(input: CheckoutInput): Promise<Checkout> {
    const body = await this.#post('/subscriptions', {
      plan_id: this.#settings.planId, total_count: RAZORPAY_TOTAL_COUNT, quantity: 1, customer_notify: 1,
      notes: { chausar_account: input.accountId, chausar_checkout: input.idempotencyKey },
    });
    const url = typeof body.short_url === 'string' && body.short_url.length <= 2048 ? URL.parse(body.short_url) : null;
    if (!isSubscriptionId(body.id) || body.status !== 'created' || url?.protocol !== 'https:') throw failed();
    // Razorpay creates the subscription with the checkout: its id is both.
    return { checkoutId: body.id, checkoutUrl: url.href, subscriptionRef: body.id };
  }
  async cancel(subscriptionRef: string): Promise<void> {
    check(isSubscriptionId(subscriptionRef), 'SUBSCRIPTION_REF_INVALID', 'The subscription reference is not valid.', 500);
    const body = await this.#post(`/subscriptions/${subscriptionRef}/cancel`, { cancel_at_cycle_end: 0 });
    if (body.id !== subscriptionRef || body.status !== 'cancelled') throw failed();
  }
  /** `x-razorpay-signature` is the hex HMAC-SHA256 of the raw body under the webhook secret. */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): PartnerEvent | null {
    if (!sameHex(hmacHex(this.#settings.webhookSecret, rawBody), headers['x-razorpay-signature'] ?? '')) throw signatureInvalid();
    let value: any;
    try { value = JSON.parse(rawBody.toString('utf8')); } catch { value = undefined; }
    const eventId = headers['x-razorpay-event-id'];
    check(value && typeof value === 'object' && typeof value.event === 'string' && isEventId(eventId), 'WEBHOOK_INVALID', 'The webhook body is not valid.');
    const type = Object.hasOwn(EVENTS, value.event) ? EVENTS[value.event] : undefined;
    if (!type) return null;
    const entity = value.payload?.subscription?.entity;
    const end = entity?.current_end;
    check(isSubscriptionId(entity?.id) && (end === null || end === undefined || (Number.isSafeInteger(end) && end > 0)), 'WEBHOOK_INVALID', 'The webhook body is not valid.');
    return { eventId, type, checkoutId: entity.id, subscriptionRef: entity.id, currentPeriodEnd: typeof end === 'number' ? new Date(end * 1000).toISOString() : null };
  }
}
