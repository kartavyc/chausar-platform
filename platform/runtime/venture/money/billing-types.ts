import type { BankDetails, BillingSettings, RazorpayAccount, QrMatrix, InvoicePart, MinorText } from '../../../contract/venture/money/billing-types.ts';
export type { BankDetails, BillingSettings, RazorpayAccount, QrMatrix, InvoicePart, MinorText } from '../../../contract/venture/money/billing-types.ts';
// Wave 6 money (6D1 to 6D4): the shapes of the owner's billing settings, an invoice's part of its order, how a client
// pays (UPI link and QR, bank details, a Razorpay Payment Link) and a foreign-currency order price. Types only, so the
// contracts and the fake engine import them without loading engine code.
export type IsoDateText = string;


/** The owner's bank account, as typed. ifsc for India, swift for clients abroad; both optional beside the number. */


/** Which Razorpay account the saved keys are for; the keys themselves live only in protected storage. */


/**
 * The owner's billing settings (6D1, 6D2), kept on the business. Absent fields read as the defaults: one final invoice due
 * in 7 days, reminders 3, 10 and 30 days late, no terms line, no UPI ID or bank details.
 */


/** venture.billing.get's answer: the settings with the defaults filled in, and the honest label of each way to pay. */
export type BillingView = {
  settings: BillingSettings;
  defaults: { dueInDays: number; reminderDays: number[] };
  /** Razorpay is built against recorded responses from its public docs and has not run on a real account yet. */
  razorpayLabel: 'fixture-tested';
};

/**
 * What part of its order an invoice bills (6D1). advance and milestone take a share in basis points of the order's amount
 * before tax; partial an amount before tax the owner typed; final the exact rest. basisReceiptId is the receipt of the
 * whole order these parts are cut from; earlierMinor what issued invoices on the order billed before this one.
 */


/** How much of an order is billed (6D1): every figure from code, beside the invoices that make it. */
export type OrderBilledView = {
  orderTotalMinor: MinorText; billedMinor: MinorText; leftMinor: MinorText;
  orderTotal: string; billed: string; left: string; invoices: number;
};

/** A QR code drawn by code: size modules a side, each row a string of '1' (dark) and '0' (light). */


/** A Razorpay Payment Link the owner made for an invoice (6D3). */
export type PayLinkState = {
  id: string; shortUrl: string; amountMinor: MinorText; currency: string; status: 'created' | 'partially_paid' | 'expired' | 'cancelled' | 'paid';
  createdAt: string; checkedAt: string | null; recordedPaymentIds: string[]; journalId: string | null;
};

/**
 * How the client pays one invoice (6D2, 6D3), all built by code from the invoice's balance. upi: only for an issued INR
 * invoice with money left and a UPI ID saved; its amount is the balance figure, as the receipt marks it. The client's copy
 * never carries a receipt id; receiptId here is for the owner's screen.
 */
export type HowToPayView = {
  upi: { id: string; payeeName: string; link: string; qr: QrMatrix; amountMinor: MinorText; amount: string; reference: string; receiptId: string } | null;
  bank: BankDetails | null;
  /** Why there is no UPI link, in plain words, when the owner has a UPI ID but this invoice cannot use it. */
  upiNote: string | null;
  payLink: (PayLinkState & { label: 'fixture-tested' }) | null;
  /** What creating a Payment Link for the balance would ask the owner to approve, when one can be made now. */
  payLinkOffer: { amountMinor: MinorText; amount: string; currency: string; digest: string; label: 'fixture-tested' } | null;
};

/** An order priced in the client's own currency (6D4): the owner's own price, never converted. */
export type ForeignPrice = { currency: string; unitPriceMinor: MinorText };

/** The engine's HTTPS port for payment providers (6D3). Tests pass recorded responses; absent: the real fetch. */
export type PaymentHttp = (request: { method: 'GET' | 'POST'; url: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; body: string }>;
