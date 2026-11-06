// Wave 6 money (6D2): the UPI payment link for an invoice, built by code from the exact balance and the invoice number,
// in NPCI's deep-link form upi://pay?pa=&pn=&am=&cu=INR&tn=&tr=. Portable, so the fake engine builds the same link.
// Paying through it is the client's act in their own UPI app; Chausar only learns of it when the owner marks it paid.
import { plainMoney } from '../../owner-format.ts';
import { qrMatrix } from './qr.ts';
import type { QrMatrix } from '../../../contract/venture/money/billing-types.ts';

/** The amount as a UPI link carries it: rupees with two decimals and no separators ('23305.00'). */
export function upiAmountText(minor: string): string {
  return plainMoney(minor, 'INR');
}

/** Percent-encodes a value for the link, keeping the @ of a UPI ID as UPI apps expect it. */
function encoded(value: string): string {
  return encodeURIComponent(value).replace(/%40/g, '@');
}

/** The payee name as the link carries it: one line, at most 50 characters. */
export function payeeText(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 50);
}

/** The upi://pay link for an amount in paise to a UPI ID, referenced by the invoice number. */
export function upiLink(input: { upiId: string; payeeName: string; amountMinor: string; reference: string }): string {
  const fields: [string, string][] = [
    ['pa', input.upiId], ['pn', payeeText(input.payeeName)], ['am', upiAmountText(input.amountMinor)], ['cu', 'INR'],
    ['tn', `Invoice ${input.reference}`], ['tr', input.reference],
  ];
  return `upi://pay?${fields.map(([key, value]) => `${key}=${encoded(value)}`).join('&')}`;
}

/** The link and its QR code. */
export function upiPayment(input: { upiId: string; payeeName: string; amountMinor: string; reference: string }): { link: string; qr: QrMatrix } {
  const link = upiLink(input);
  return { link, qr: qrMatrix(link) };
}
