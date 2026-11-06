// Chausar venture launcher, money (Ink v2 wave 4, package 4J5): what an invoice's payments and credit notes say, read
// from records only. A payment recorded before 4J5 has no state and reads as cleared. A pending cheque and a waiting
// credit note hold their amounts against the balance until the cheque clears or the note is issued, so no other
// payment or credit can take the same money. TDS the client deducted settles the invoice beside the cash. Days are
// counted on 'YYYY-MM-DD' text only; money in BigInt minor units.
import type { CreditNoteRecord, InvoiceRecord, IsoDate, PaymentMethod, PaymentRecord } from '../contracts.ts';

/** The words for how money came in, as a sentence says them ("by UPI", "by cheque"). */
export const METHOD_WORDS: Readonly<Record<PaymentMethod, string>> = Object.freeze({
  'bank-transfer': 'bank transfer', upi: 'UPI', card: 'card', cash: 'cash', 'payment-link': 'payment link', other: 'another way', cheque: 'cheque',
});

/** Pending while a cheque waits to clear; every other payment, and every one recorded before 4J5, is cleared. */
export function paymentState(payment: Pick<PaymentRecord, 'state'>): 'pending' | 'cleared' {
  return payment.state ?? 'cleared';
}

/** How much of an invoice one payment settles: the money that came in and any TDS the client deducted. */
export function settledBy(payment: Pick<PaymentRecord, 'amountMinor' | 'tds'>): bigint {
  return BigInt(payment.amountMinor) + BigInt(payment.tds?.amountMinor ?? '0');
}

/** What pending cheques and waiting credit notes hold on an invoice, leaving out one credit note when asked. */
export function heldOn(invoiceId: string, payments: readonly PaymentRecord[], credits: readonly CreditNoteRecord[], exceptCreditId: string | null = null): bigint {
  let held = 0n;
  for (const payment of payments) if (payment.invoiceId === invoiceId && paymentState(payment) === 'pending') held += settledBy(payment);
  for (const note of credits) if (note.invoiceId === invoiceId && note.status === 'waiting' && note.id !== exceptCreditId) held += BigInt(note.amountMinor);
  return held;
}

/** The part of an invoice's balance nothing holds: what a new payment or credit note may take. */
export function freeBalance(invoice: Pick<InvoiceRecord, 'id' | 'balanceMinor'>, payments: readonly PaymentRecord[], credits: readonly CreditNoteRecord[], exceptCreditId: string | null = null): bigint {
  return BigInt(invoice.balanceMinor) - heldOn(invoice.id, payments, credits, exceptCreditId);
}

/** Credit notes issued on an invoice, oldest first. */
export function issuedCredits(invoiceId: string, credits: readonly CreditNoteRecord[]): CreditNoteRecord[] {
  return credits.filter(note => note.invoiceId === invoiceId && note.status === 'issued' && note.issuedAt !== null)
    .sort((a, b) => (a.issuedAt as string).localeCompare(b.issuedAt as string) || a.id.localeCompare(b.id));
}

/** What issued credit notes took off an invoice. */
export function creditedOn(invoiceId: string, credits: readonly CreditNoteRecord[]): bigint {
  return issuedCredits(invoiceId, credits).reduce((total, note) => total + BigInt(note.amountMinor), 0n);
}

const DAY_MS = 86_400_000;

/** A calendar day as a whole day count, for differences only. */
export function dayCount(iso: IsoDate): number {
  return Math.floor(Date.parse(`${iso}T00:00:00.000Z`) / DAY_MS);
}

/** Whole days from one day to a later one: 16 Oct to 23 Oct is 7; an earlier day is below zero. */
export function daysFrom(from: IsoDate, to: IsoDate): number {
  return dayCount(to) - dayCount(from);
}

/** "1 day late", "22 days late". */
export function lateWords(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'} late`;
}
