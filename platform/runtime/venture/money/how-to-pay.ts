// Wave 6 money (6D2, 6D3): how a client pays one invoice. Everything is built by code from the invoice's balance and the
// owner's billing settings: the UPI link and its QR code (rupee invoices only, issued, with money left), the bank details,
// a Razorpay Payment Link already made, and what making one would ask the owner to approve. The client's copy of the
// invoice lists the ways to pay without any internal receipt id; the owner's screen keeps the receipt mark.
import { formatMinor } from '../../currency.ts';
import { formatMoney } from '../../owner-format.ts';
import { digest } from '../records.ts';
import { billingOf } from './billing.ts';
import { upiPayment } from './upi.ts';
import type { HowToPayView } from './billing-types.ts';
import type { CountryProfile, InvoiceRecord, VentureRecord } from '../contracts.ts';
import type { State } from '../../contracts.ts';

/** Razorpay's smallest Payment Link in rupees is INR 1.00 (100 paise). */
const RAZORPAY_MIN_INR = 100n;

/** The digest the owner approves to make a Payment Link: the invoice, its number, and the exact balance and currency. */
export function payLinkDigest(invoice: Pick<InvoiceRecord, 'id' | 'number' | 'balanceMinor' | 'currency'>): string {
  return digest({ kind: 'razorpay-payment-link', invoiceId: invoice.id, number: invoice.number, amountMinor: invoice.balanceMinor, currency: invoice.currency });
}

/** Whether a Payment Link for this invoice's balance can be made now: issued, money left, no live link for it already. */
export function payLinkOpen(invoice: InvoiceRecord): boolean {
  if (invoice.number === null || (invoice.status !== 'issued' && invoice.status !== 'part-paid')) return false;
  const balance = BigInt(invoice.balanceMinor);
  if (balance <= 0n || (invoice.currency === 'INR' && balance < RAZORPAY_MIN_INR)) return false;
  const link = invoice.payLink;
  return !link || link.status === 'expired' || link.status === 'cancelled';
}

/** How the client pays this invoice, or null when the owner has set up no way to pay yet. */
export function howToPayOf(state: State, venture: VentureRecord, invoice: InvoiceRecord, sellerName: string): HowToPayView | null {
  void state;
  const billing = billingOf(venture);
  if (!billing.upiId && !billing.bank && !billing.razorpay && !invoice.payLink) return null;
  const open = invoice.number !== null && (invoice.status === 'issued' || invoice.status === 'part-paid') && BigInt(invoice.balanceMinor) > 0n;
  let upi: HowToPayView['upi'] = null;
  let upiNote: string | null = null;
  if (billing.upiId) {
    if (invoice.currency !== 'INR') upiNote = `UPI takes rupees only, so this invoice in ${invoice.currency} shows your bank details instead.`;
    else if (invoice.status === 'draft') upiNote = 'The UPI link and QR code are made when you issue this invoice.';
    else if (open) {
      const payeeName = billing.payeeName ?? sellerName;
      const reference = invoice.number as string;
      const made = upiPayment({ upiId: billing.upiId, payeeName, amountMinor: invoice.balanceMinor, reference });
      upi = { id: billing.upiId, payeeName, link: made.link, qr: made.qr, amountMinor: invoice.balanceMinor, amount: formatMoney(invoice.balanceMinor, 'INR'), reference, receiptId: invoice.priceReceiptId };
    }
  }
  const offer = billing.razorpay && payLinkOpen(invoice)
    ? { amountMinor: invoice.balanceMinor, amount: formatMoney(invoice.balanceMinor, invoice.currency), currency: invoice.currency, digest: payLinkDigest(invoice), label: 'fixture-tested' as const }
    : null;
  return { upi, bank: billing.bank, upiNote, payLink: invoice.payLink ? { ...invoice.payLink, label: 'fixture-tested' } : null, payLinkOffer: offer };
}

/** The "How to pay" lines of the client's copy: no receipt ids, only what the client needs to pay, in the exact form (it leaves the app). */
export function howToPayLines(view: HowToPayView | null, country: CountryProfile): string[] {
  void country;
  if (!view) return [];
  const lines: string[] = [];
  if (view.upi) lines.push(`UPI ID: ${view.upi.id}`, `Pay ${formatMinor(view.upi.amountMinor, 'INR')} by UPI: ${view.upi.link}`);
  if (view.payLink && (view.payLink.status === 'created' || view.payLink.status === 'partially_paid')) lines.push(`Pay online: ${view.payLink.shortUrl}`);
  if (view.bank) {
    const bank = view.bank;
    lines.push(`Bank transfer to ${bank.accountName}, account ${bank.accountNumber}`);
    const codes = [bank.ifsc ? `IFSC ${bank.ifsc}` : null, bank.swift ? `SWIFT ${bank.swift}` : null, bank.bankName].filter((part): part is string => part !== null);
    if (codes.length) lines.push(codes.join(', '));
  }
  return lines.length ? ['How to pay', ...lines] : [];
}
