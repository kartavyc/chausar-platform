import { randomBytes } from 'node:crypto';
import { HostedError, check } from '../shared/errors.ts';
import { hmacHex, newId, sameHex } from '../shared/crypto.ts';

export type CheckoutInput = { accountId: string; plan: 'paid'; idempotencyKey: string };
/** `subscriptionRef`: the partner subscription the checkout already created, when the partner makes one before payment. */
export type Checkout = { checkoutId: string; checkoutUrl: string; subscriptionRef?: string | null };
export const PARTNER_EVENT_TYPES = ['activated', 'charged', 'past_due', 'cancelled'] as const;
export type PartnerEventType = typeof PARTNER_EVENT_TYPES[number];
/** A verified partner event. At least one of `checkoutId` and `subscriptionRef` names the subscription. */
export type PartnerEvent = { eventId: string; type: PartnerEventType; checkoutId: string | null; subscriptionRef: string | null; currentPeriodEnd: string | null };
export type WebhookHeaders = Record<string, string | undefined>;

/** The payment partner seam. Money moves only at the partner; Chausar keeps the subscription state it reports. */
export interface PaymentPartner {
  /** Lower-case letters; the webhook path is `/v1/billing/webhooks/<id>`. */
  readonly id: string;
  createCheckout(input: CheckoutInput): Promise<Checkout>;
  cancel(subscriptionRef: string): Promise<void>;
  /** Throws WEBHOOK_SIGNATURE_INVALID on a bad signature. Returns null for a genuine event billing does not act on. */
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): PartnerEvent | null;
}

export const isPartnerRef = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{6,128}$/.test(value);
export const isEventId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.-]{1,128}$/.test(value);
export const isIsoTime = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) && !Number.isNaN(Date.parse(value));
export const signatureInvalid = () => new HostedError('WEBHOOK_SIGNATURE_INVALID', 'The webhook signature is not valid.', 401);
const eventInvalid = () => new HostedError('WEBHOOK_INVALID', 'The webhook body is not valid.', 400);

/** Refuses every call: no live partner account is configured on this server. */
export class UnconfiguredPaymentPartner implements PaymentPartner {
  readonly id = 'none';
  #refuse(): never { throw new HostedError('PAYMENT_PARTNER_NOT_CONFIGURED', 'Payments are not set up on this server.', 503); }
  async createCheckout(_input: CheckoutInput): Promise<Checkout> { this.#refuse(); }
  async cancel(_subscriptionRef: string): Promise<void> { this.#refuse(); }
  verifyWebhook(_rawBody: Buffer, _headers: WebhookHeaders): PartnerEvent | null { this.#refuse(); }
}

/**
 * Tests and demo only. Keeps checkouts in memory (idempotent by key) and signs its own webhook bodies with
 * HMAC-SHA256 in `x-fake-signature`, so tests can send valid and forged events.
 */
export class FakePaymentPartner implements PaymentPartner {
  readonly id = 'fake';
  readonly #secret: string;
  readonly checkouts = new Map<string, CheckoutInput & Checkout>();
  readonly cancelled: string[] = [];
  constructor(secret = randomBytes(32).toString('hex')) { this.#secret = secret; }
  async createCheckout(input: CheckoutInput): Promise<Checkout> {
    const key = `${input.accountId}:${input.idempotencyKey}`, existing = this.checkouts.get(key);
    if (existing) return { checkoutId: existing.checkoutId, checkoutUrl: existing.checkoutUrl, subscriptionRef: existing.subscriptionRef };
    const checkoutId = newId('fchk'), checkoutUrl = `https://pay.example.invalid/checkout/${checkoutId}`, subscriptionRef = checkoutId.replace(/^fchk_/, 'fsub_');
    this.checkouts.set(key, { ...input, checkoutId, checkoutUrl, subscriptionRef });
    return { checkoutId, checkoutUrl, subscriptionRef };
  }
  async cancel(subscriptionRef: string) { this.cancelled.push(subscriptionRef); }
  /** A webhook as the partner would send it. */
  webhook(event: PartnerEvent): { body: Buffer; headers: WebhookHeaders } {
    const body = Buffer.from(JSON.stringify(event));
    return { body, headers: { 'content-type': 'application/json', 'x-fake-signature': hmacHex(this.#secret, body) } };
  }
  verifyWebhook(rawBody: Buffer, headers: WebhookHeaders): PartnerEvent {
    if (!sameHex(hmacHex(this.#secret, rawBody), headers['x-fake-signature'] ?? '')) throw signatureInvalid();
    let value: any;
    try { value = JSON.parse(rawBody.toString('utf8')); } catch { throw eventInvalid(); }
    const valid = value && typeof value === 'object' && Object.keys(value).sort().join() === 'checkoutId,currentPeriodEnd,eventId,subscriptionRef,type'
      && isEventId(value.eventId) && PARTNER_EVENT_TYPES.includes(value.type)
      && (value.checkoutId === null || isPartnerRef(value.checkoutId)) && (value.subscriptionRef === null || isPartnerRef(value.subscriptionRef))
      && (value.checkoutId !== null || value.subscriptionRef !== null) && (value.currentPeriodEnd === null || isIsoTime(value.currentPeriodEnd));
    check(valid, 'WEBHOOK_INVALID', 'The webhook body is not valid.');
    return { eventId: value.eventId, type: value.type, checkoutId: value.checkoutId, subscriptionRef: value.subscriptionRef, currentPeriodEnd: value.currentPeriodEnd };
  }
}
