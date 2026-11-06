// One-shot C4 (T20): a share of an issued invoice, recorded on the invoice. The desktop share and Save file call
// venture.invoice.shared after the owner's own app opened or the file was saved; "Mark as sent" calls it with 'marked'.
// Chausar never says "Sent" on its own: opening WhatsApp or a mail app is not sending, so only the owner's mark makes
// the invoice sent. A draft has nothing to share yet and a void invoice is cancelled: both refuse.
import { check, type Context } from '../../contracts.ts';
import type { InvoiceRecord, InvoiceShareHow, InvoiceShareRecord, InvoiceView, VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, readVenture, requireAppChannel, ventureAction } from '../records.ts';
import { recordId } from './shared.ts';
import { invoiceView } from './invoices.ts';

const HOWS: readonly InvoiceShareHow[] = ['whatsapp', 'email', 'file', 'marked'];

/** Why this invoice can't take a share, or null. */
function refusal(invoice: InvoiceRecord): string | null {
  if (invoice.status === 'void') return 'This invoice is cancelled, so there is nothing to send.';
  if (invoice.status === 'draft' || invoice.number === null) return 'Issue this invoice first, then share it.';
  return null;
}

/** venture.invoice.shared (level prepare, app only): records one share or the owner's mark, and answers the invoice. */
export async function invoiceShared(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InvoiceView> {
  requireAppChannel(ctx, 'venture.invoice.shared');
  const body = exactPayload(payload, ['invoiceId', 'how'], ['invoiceId', 'how']);
  const invoiceId = recordId(body.invoiceId, 'Invoice');
  check(typeof body.how === 'string' && (HOWS as readonly string[]).includes(body.how), 'INVALID_VENTURE_REQUEST', 'Say how it was shared: whatsapp, email, file or marked.');
  const how = body.how as InvoiceShareHow;
  const { state, venture } = readVenture(deps, ctx);
  const found = listRecords(state, 'venture-invoice', venture.id).find(item => item.id === invoiceId);
  check(found, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
  return ventureAction(deps, ctx, 'prepare', 'invoice.shared', tx => {
    const current = tx.venture;
    check(current, 'VENTURE_NOT_FOUND', 'Start a business first.');
    const invoice = tx.find('venture-invoice', invoiceId);
    check(invoice, 'INVOICE_NOT_FOUND', 'This invoice was not found.');
    const refused = refusal(invoice);
    check(refused === null, 'INVALID_VENTURE_REQUEST', refused ?? '');
    tx.put<InvoiceShareRecord>({ ...tx.base('venture-invoice-share'), invoiceId, how });
    tx.emit('queue.changed', { invoiceId });
    return invoiceView(tx.state, current, invoice, deps);
  });
}
