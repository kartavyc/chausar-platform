/**
 * Wave 6 money (6D1 to 6D4) for the fake engine: the owner's billing settings, how a client pays an invoice (the UPI link
 * and its QR code, bank details, a Razorpay Payment Link), the invoice file and its share links, and cutting an order into
 * parts. The rules, codes and words come from the engine's own portable modules (money/billing-rules.ts, upi.ts,
 * invoice-parts.ts), so the fake answers exactly as the engine does. Razorpay is fixture-tested in the engine; the fake
 * never reaches it and makes a sample link.
 */

import { billingChange, billingWith } from '../../../../platform/shared/venture/money/billing-rules.ts';
import { upiPayment } from '../../../../platform/shared/venture/money/upi.ts';
import type { BillingSettings } from '../../../../platform/runtime/venture/money/billing-types';
import { EngineError, type BillingView, type HowToPayLite } from './types';

const KEY_ID = /^rzp_(test|live)_[A-Za-z0-9]{8,32}$/;
const KEY_SECRET = /^[A-Za-z0-9]{12,64}$/;

export const FAKE_6D_METHODS: readonly string[] = ['venture.billing.get', 'venture.billing.set', 'venture.invoice.pdf', 'venture.invoice.payLink', 'venture.payment.receipt'];

/** A Payment Link the fake made: the engine's fields, minus amounts the UI could add up. */
export interface FakePayLink { id: string; shortUrl: string; status: 'created' | 'partially_paid' | 'expired' | 'cancelled' | 'paid'; checkedAt: string | null; amount: number; currency: string }

/** The owner's billing settings per business, with the engine's defaults and checks. */
export class FakeBilling {
  private readonly saved = new Map<string, BillingSettings>();

  of(business: string): BillingSettings { return billingWith(this.saved.get(business)); }

  view(business: string): BillingView {
    return { settings: structuredClone(this.of(business)), defaults: { dueInDays: 7, reminderDays: [3, 10, 30] }, razorpayLabel: 'fixture-tested' };
  }

  /** venture.billing.set: the same fields, checks and words as money/billing.ts; keys are checked and never kept here. */
  set(business: string, p: Record<string, unknown>, now: string): BillingView {
    const allowed = ['dueInDays', 'terms', 'reminderDays', 'upiId', 'payeeName', 'bank', 'razorpayKeys'];
    if (Object.keys(p).some((key) => !allowed.includes(key))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
    const { razorpayKeys: keys, ...patch } = p;
    let account: BillingSettings['razorpay'] | undefined;
    if (keys === null) account = null;
    else if (keys !== undefined) {
      const given = (keys ?? {}) as Record<string, unknown>;
      if (!keys || typeof keys !== 'object' || Object.keys(given).sort().join(',') !== 'keyId,keySecret') throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
      if (typeof given.keyId !== 'string' || !KEY_ID.test(given.keyId.trim())) throw new EngineError('INVALID_VENTURE_REQUEST', 'Paste the Key Id from your Razorpay dashboard. It starts with rzp_test_ or rzp_live_.');
      if (typeof given.keySecret !== 'string' || !KEY_SECRET.test(given.keySecret.trim())) throw new EngineError('INVALID_VENTURE_REQUEST', 'Paste the Key Secret from your Razorpay dashboard.');
      const keyId = given.keyId.trim();
      account = { mode: keyId.startsWith('rzp_live_') ? 'live' : 'test', keyHint: keyId.slice(-4), savedAt: now };
    }
    let next: BillingSettings;
    try { next = billingChange(this.of(business), patch); } catch (error) { throw asEngine(error); }
    if (account !== undefined) next.razorpay = account;
    this.saved.set(business, next);
    return this.view(business);
  }
}

/** The engine's checks throw its own error class; the fake answers with EngineError, the same code and words. */
export function asEngine(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  const known = error as { code?: unknown; message?: unknown };
  return new EngineError(typeof known.code === 'string' ? known.code : 'INVALID_VENTURE_REQUEST', typeof known.message === 'string' ? known.message : 'This request was refused.');
}

/** The input how-to-pay needs from one fake invoice. */
export interface PayInput {
  id: string; number: string | null; status: string; currency: string; balance: number; balanceText: string; priceReceiptId: string; sellerName: string;
  payLink?: FakePayLink; digest: (value: unknown) => string;
}

/** The fake's digest of a Payment Link to approve: the invoice, its number, and the exact balance and currency. */
export function payLinkDigest(input: Pick<PayInput, 'id' | 'number' | 'balance' | 'currency' | 'digest'>): string {
  return input.digest({ kind: 'razorpay-payment-link', invoiceId: input.id, number: input.number, amountMinor: String(input.balance), currency: input.currency });
}

/** Whether a link for the balance can be made now, as how-to-pay.ts payLinkOpen says. */
export function payLinkOpen(input: Pick<PayInput, 'number' | 'status' | 'balance' | 'currency' | 'payLink'>): boolean {
  if (input.number === null || (input.status !== 'issued' && input.status !== 'part-paid')) return false;
  if (input.balance <= 0 || (input.currency === 'INR' && input.balance < 100)) return false;
  return !input.payLink || input.payLink.status === 'expired' || input.payLink.status === 'cancelled';
}

/** How the client pays, as how-to-pay.ts builds it, or null when the owner set no way to pay. */
export function howToPay(settings: BillingSettings, input: PayInput): HowToPayLite | null {
  if (!settings.upiId && !settings.bank && !settings.razorpay && !input.payLink) return null;
  const open = input.number !== null && (input.status === 'issued' || input.status === 'part-paid') && input.balance > 0;
  let upi: HowToPayLite['upi'] = null;
  let upiNote: string | null = null;
  if (settings.upiId) {
    if (input.currency !== 'INR') upiNote = `UPI takes rupees only, so this invoice in ${input.currency} shows your bank details instead.`;
    else if (input.status === 'draft') upiNote = 'The UPI link and QR code are made when you issue this invoice.';
    else if (open) {
      const payeeName = settings.payeeName ?? input.sellerName;
      const made = upiPayment({ upiId: settings.upiId, payeeName, amountMinor: String(input.balance), reference: input.number! });
      upi = { id: settings.upiId, payeeName, link: made.link, qr: made.qr, amount: input.balanceText, reference: input.number!, receiptId: input.priceReceiptId };
    }
  }
  const offer = settings.razorpay && payLinkOpen(input) ? { amount: input.balanceText, currency: input.currency, digest: payLinkDigest(input), label: 'fixture-tested' as const } : null;
  const link = input.payLink ? { id: input.payLink.id, shortUrl: input.payLink.shortUrl, status: input.payLink.status, checkedAt: input.payLink.checkedAt, label: 'fixture-tested' as const } : null;
  return { upi, bank: settings.bank ? { ...settings.bank } : null, upiNote, payLink: link, payLinkOffer: offer };
}

/** The "How to pay" lines of the client's copy, as how-to-pay.ts howToPayLines writes them. */
export function howToPayLines(view: HowToPayLite | null): string[] {
  if (!view) return [];
  const lines: string[] = [];
  if (view.upi) lines.push(`UPI ID: ${view.upi.id}`, `Pay ${view.upi.amount} by UPI: ${view.upi.link}`);
  if (view.payLink && (view.payLink.status === 'created' || view.payLink.status === 'partially_paid')) lines.push(`Pay online: ${view.payLink.shortUrl}`);
  if (view.bank) {
    lines.push(`Bank transfer to ${view.bank.accountName}, account ${view.bank.accountNumber}`);
    const codes = [view.bank.ifsc ? `IFSC ${view.bank.ifsc}` : null, view.bank.swift ? `SWIFT ${view.bank.swift}` : null, view.bank.bankName].filter((part): part is string => part !== null);
    if (codes.length) lines.push(codes.join(', '));
  }
  return lines.length ? ['How to pay', ...lines] : [];
}

/** The words the owner sends with the file, as invoice-pdf.ts writes them. */
export function shareWords(input: { client: string; number: string; balance: string; due: string | null; seller: string; email: string | null; howToPay: HowToPayLite | null }) {
  const lines = [`Hello ${input.client},`, '', `Here is invoice ${input.number} for ${input.balance}${input.due ? `, due on ${input.due}` : ''}. The PDF is attached.`];
  if (input.howToPay?.upi) lines.push(`You can pay by UPI to ${input.howToPay.upi.id}.`);
  if (input.howToPay?.payLink && (input.howToPay.payLink.status === 'created' || input.howToPay.payLink.status === 'partially_paid')) lines.push(`Or pay online: ${input.howToPay.payLink.shortUrl}`);
  const bank = input.howToPay?.bank;
  if (bank) lines.push(`Bank transfer: ${bank.accountName}, account ${bank.accountNumber}${bank.ifsc ? `, IFSC ${bank.ifsc}` : ''}${bank.swift ? `, SWIFT ${bank.swift}` : ''}.`);
  lines.push('', 'Thank you,', input.seller);
  const subject = `Invoice ${input.number} from ${input.seller}`;
  const text = lines.join('\n');
  return {
    subject, text, whatsappUrl: `https://wa.me/?text=${encodeURIComponent(text)}`,
    mailtoUrl: `mailto:${encodeURIComponent(input.email ?? '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
}

/** The page the file is made from, as invoice-pdf.ts makes it (the fake has no printer, so the file is this page). */
export function fakeInvoiceHtml(title: string, documentText: string): string {
  const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title></head><body><pre>${escape(documentText)}</pre></body></html>`;
}

/** UTF-8 text as base64, in the browser and in tests. */
export function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}
