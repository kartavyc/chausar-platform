// Wave 6 money (6D2): an issued invoice as a PDF the owner saves and sends, and the share links that open the owner's
// own WhatsApp (wa.me with the words filled in) or mail app (a mailto link to the client). The owner attaches the PDF and
// presses send; Chausar sends nothing. The PDF is printed from the client's copy (document.ts) and the UPI QR code drawn
// as shapes, through the desktop's print port (playbooks/kit/report/pdf.ts); without one the file is the same page as
// HTML and says why. The client's copy carries no internal receipt id.
import { formatMinor } from '../../currency.ts';
import { check, type Context } from '../../contracts.ts';
import { exactPayload, formatVentureDate, listRecords, readVenture, requireAppChannel } from '../records.ts';
import { whatsappLink } from '../clients/phone.ts';
import { pdfOf } from '../playbooks/kit/report/pdf.ts';
import { invoiceView } from './invoices.ts';
import { oneLine, recordId } from './shared.ts';
import type { QrMatrix } from './billing-types.ts';
import type { InvoiceView, VentureDeps } from '../contracts.ts';

export type InvoicePdfView = {
  fileName: string;
  format: 'pdf' | 'html';
  mimeType: 'application/pdf' | 'text/html';
  contentBase64: string;
  /** Why the file is HTML and not a PDF, in plain words; null for a PDF. */
  note: string | null;
  /** The owner's own apps: WhatsApp with the words filled in, and the mail app to the client. Nothing is sent by Chausar. */
  share: { text: string; subject: string; whatsappUrl: string; mailtoUrl: string };
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A QR code as SVG squares with a quiet zone of four modules, black on white. */
export function qrSvg(qr: QrMatrix, sizePx = 176): string {
  const side = qr.size + 8;
  const cells: string[] = [];
  qr.rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '1') cells.push(`M${x + 4} ${y + 4}h1v1h-1z`); });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges"><rect width="${side}" height="${side}" fill="#ffffff"/><path fill="#000000" d="${cells.join('')}"/></svg>`;
}

/** A plain page of written lines, what a document's PDF is printed from (the invoice; one-shot C6's payment receipt). */
export function textPageHtml(title: string, text: string, extra = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>`
    + 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px}pre{font-family:Consolas,"Courier New",monospace;font-size:12px;line-height:1.5;white-space:pre-wrap}'
    + 'figure{margin:24px 0 0}figcaption{font-size:12px;margin-top:8px}</style></head><body>'
    + `<pre>${escapeHtml(text)}</pre>${extra}</body></html>`;
}

/** The invoice page the PDF is printed from: the client's copy as written, and the UPI QR code when there is one. */
export function invoiceHtml(view: InvoiceView): string {
  const title = `${view.invoice.documentTitle} ${view.invoice.number ?? 'DRAFT'}`;
  const qr = view.howToPay?.upi
    ? `<figure><div>${qrSvg(view.howToPay.upi.qr)}</div><figcaption>Scan with any UPI app to pay ${escapeHtml(formatMinor(view.howToPay.upi.amountMinor, 'INR'))} to ${escapeHtml(view.howToPay.upi.id)}</figcaption></figure>`
    : '';
  return textPageHtml(title, view.documentText, qr);
}

/** The words the owner sends with the PDF, by template: every figure and date from the invoice, never a receipt id. */
function shareWords(view: InvoiceView, sellerName: string): { subject: string; text: string } {
  const { invoice } = view;
  // The client's words leave the app, so the exact form (B2): the PDF's own font has no rupee sign either.
  const owed = view.figures.find(figure => figure.key === 'balance');
  const balance = owed ? formatMinor(owed.minor, owed.currency ?? invoice.currency) : '';
  const due = invoice.dueDate ? `, due on ${formatVentureDate(invoice.dueDate, (view.country ?? { dateOrder: 'day-month-year' }).dateOrder)}` : '';
  const lines = [`Hello ${oneLine(view.client.name)},`, '', `Here is invoice ${invoice.number} for ${balance}${due}. The PDF is attached.`];
  if (view.howToPay?.upi) lines.push(`You can pay by UPI to ${view.howToPay.upi.id}.`);
  if (view.howToPay?.payLink && (view.howToPay.payLink.status === 'created' || view.howToPay.payLink.status === 'partially_paid')) lines.push(`Or pay online: ${view.howToPay.payLink.shortUrl}`);
  if (view.howToPay?.bank) lines.push(`Bank transfer: ${view.howToPay.bank.accountName}, account ${view.howToPay.bank.accountNumber}${view.howToPay.bank.ifsc ? `, IFSC ${view.howToPay.bank.ifsc}` : ''}${view.howToPay.bank.swift ? `, SWIFT ${view.howToPay.bank.swift}` : ''}.`);
  lines.push('', 'Thank you,', oneLine(sellerName));
  return { subject: `Invoice ${invoice.number} from ${oneLine(sellerName)}`, text: lines.join('\n') };
}

/** venture.invoice.pdf { invoiceId } (prepare, app only): the PDF (or HTML) of an issued invoice and its share links. */
export async function invoicePdf(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoicePdfView> {
  requireAppChannel(ctx, 'venture.invoice.pdf');
  const body = exactPayload(payload, ['invoiceId'], ['invoiceId']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  const { state, venture } = readVenture(deps, ctx);
  const invoice = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === invoiceId);
  check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  check(invoice.number !== null && invoice.status !== 'draft', 'INVALID_VENTURE_REQUEST', 'Issue this invoice before you share it.');
  check(invoice.status !== 'void', 'INVALID_VENTURE_REQUEST', 'This invoice was cancelled.');
  const view = invoiceView(state, venture, invoice, deps);
  const html = invoiceHtml(view);
  const printed = await pdfOf(deps, html);
  const plan = listRecords(state, 'venture-blueprint', venture.id).find(item => item.id === venture.acceptedBlueprintId);
  const words = shareWords(view, plan?.name.value ?? venture.workingName);
  const email = view.client.email ?? '';
  const share = {
    ...words,
    // One-shot C6: to the client's own chat when the client has a number (clients/phone.ts), else the owner picks.
    whatsappUrl: whatsappLink(listRecords(state, 'venture-client', venture.id).find(item => item.id === invoice.clientId)?.whatsapp ?? null, words.text),
    mailtoUrl: `mailto:${encodeURIComponent(email).replace(/%40/g, '@')}?subject=${encodeURIComponent(words.subject)}&body=${encodeURIComponent(words.text)}`,
  };
  const base = (invoice.number as string).replace(/[^A-Za-z0-9-]/g, '-');
  return printed.pdf
    ? { fileName: `${base}.pdf`, format: 'pdf', mimeType: 'application/pdf', contentBase64: Buffer.from(printed.pdf).toString('base64'), note: null, share }
    : { fileName: `${base}.html`, format: 'html', mimeType: 'text/html', contentBase64: Buffer.from(html, 'utf8').toString('base64'), note: printed.note, share };
}
