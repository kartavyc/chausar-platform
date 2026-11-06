// One-shot C6 task 5 (section 9 idea 30, SCREENS 95; founder decision 1): a payment receipt with a thank-you line, made
// by code from the payment record, that the owner sends on WhatsApp. Deterministic, no model: the business, the client,
// the invoice number, the amount received, the method, the date and what was left after this payment. It leaves the
// business, so every figure is the exact form (B2), read from the records; nothing is added up beyond the invoice's own
// total less what was settled up to this payment. Chausar sends nothing: WhatsApp opens with the words, and the owner
// attaches the saved file and presses send. The PDF is printed through the invoice PDF code (invoice-pdf.ts).
import { formatMinor } from '../../currency.ts';
import { check, type Context } from '../../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture, requireAppChannel } from '../records.ts';
import { whatsappLink } from '../clients/phone.ts';
import { invoiceCountry } from '../core/country-history.ts';
import { pdfOf } from '../playbooks/kit/report/pdf.ts';
import { issuedCredits, METHOD_WORDS, paymentState, settledBy } from './ledger.ts';
import { textPageHtml, type InvoicePdfView } from './invoice-pdf.ts';
import { oneLine, recordId } from './shared.ts';
import type { VentureDeps } from '../contracts.ts';

/** The same shape as an invoice's file and share words, so the desktop keeps and opens it the same way. */
export type PaymentReceiptView = InvoicePdfView;

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** venture.payment.receipt { paymentId } (read, app only): the receipt's words and its file. Nothing is written. */
export async function paymentReceipt(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PaymentReceiptView> {
  requireAppChannel(ctx, 'venture.payment.receipt');
  const body = exactPayload(payload, ['paymentId'], ['paymentId']);
  const paymentId = recordId(body.paymentId, 'Payment');
  const { state, venture } = readVenture(deps, ctx);
  const payment = listRecords(state, 'venture-payment', venture.id).find(item => item.id === paymentId);
  check(payment, 'PAYMENT_NOT_FOUND', 'This payment was not found.');
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === payment.invoiceId);
  check(invoice && invoice.number !== null, 'PAYMENT_NOT_FOUND', 'This payment was not found.');
  check(invoice.status !== 'void', 'INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
  check(paymentState(payment) === 'cleared', 'PAYMENT_NOT_CLEARED', "This cheque hasn't cleared yet. Mark it cleared first.");
  const client = listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId);
  check(client, 'CLIENT_NOT_FOUND', 'The client of this invoice was not found.');

  // In the order they came, so this receipt says what was left after this payment, however many came later.
  const cleared = listRecords(state, 'venture-payment', venture.id)
    .filter(item => item.invoiceId === invoice.id && paymentState(item) === 'cleared')
    .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.at.localeCompare(b.at));
  const position = cleared.findIndex(item => item.id === payment.id);
  const settled = cleared.slice(0, position + 1).reduce((sum, item) => sum + settledBy(item), 0n);
  const credited = issuedCredits(invoice.id, listRecords(state, 'venture-credit-note', venture.id)).reduce((sum, note) => sum + BigInt(note.amountMinor), 0n);
  const left = BigInt(invoice.totalMinor) - credited - settled;

  const country = invoiceCountry(state, venture, invoice);
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId);
  const seller = oneLine(plan?.name.value ?? venture.workingName);
  const number = invoice.number as string;
  const amount = formatMinor(payment.amountMinor, payment.currency);
  const day = formatVentureDate(payment.receivedOn, country.dateOrder);
  const how = METHOD_WORDS[payment.method];
  const leftWords = left > 0n ? `${formatMinor(String(left), invoice.currency)} is left to pay.` : 'Nothing is left to pay.';
  const text = `Thank you for your payment of ${amount} for invoice ${number}. Received on ${day}${payment.method === 'other' ? '' : ` by ${how}`}. ${leftWords}`;
  const subject = `Payment receipt for invoice ${number} from ${seller}`;

  const page = [
    'Payment receipt', '',
    `From: ${seller}`, `To: ${oneLine(client.name)}`, `Invoice: ${number}`,
    `Amount received: ${amount}`, `Received on: ${day}`, `Method: ${capital(how)}`,
    `Left to pay: ${formatMinor(String(left > 0n ? left : 0n), invoice.currency)}`, '', text,
  ].join('\n');
  const html = textPageHtml(`Payment receipt ${number}`, page);
  const printed = await pdfOf(deps, html);
  const base = `Receipt-${number.replace(/[^A-Za-z0-9-]/g, '-')}-${position + 1}`;
  const share = {
    text, subject,
    whatsappUrl: whatsappLink(client.whatsapp ?? null, text),
    mailtoUrl: `mailto:${encodeURIComponent(client.email ?? '').replace(/%40/g, '@')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`,
  };
  return printed.pdf
    ? { fileName: `${base}.pdf`, format: 'pdf', mimeType: 'application/pdf', contentBase64: Buffer.from(printed.pdf).toString('base64'), note: null, share }
    : { fileName: `${base}.html`, format: 'html', mimeType: 'text/html', contentBase64: Buffer.from(html, 'utf8').toString('base64'), note: printed.note, share };
}
