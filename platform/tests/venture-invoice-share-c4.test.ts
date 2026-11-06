// One-shot C4 task 20: a share is recorded on the invoice. The desktop share and Save file call venture.invoice.shared
// after the owner's own app opened ("Opened in WhatsApp to share"), and "Mark as sent" calls it with 'marked'. Only the
// owner's mark makes the invoice sent: opening WhatsApp or a mail app is not sending, so until then it reads "Issued,
// not sent". A void or draft invoice refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceListRow, InvoiceRecord, InvoiceView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';
import { code, owner } from './venture-views-env.ts';

test('a share writes its record and its timeline line, and the invoice is still not sent', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  assert.equal(issued.sent, false, 'an issued invoice is not sent until the owner marks it');
  const after = await env.money<InvoiceView>('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'whatsapp' });
  const shares = listRecords(env.store.read(), 'venture-invoice-share');
  assert.equal(shares.length, 1);
  assert.equal(shares[0]!.invoiceId, issued.invoice.id);
  assert.equal(shares[0]!.how, 'whatsapp');
  assert.equal(after.sent, false, 'opening WhatsApp is not sending');
  const lines = (after.timeline ?? []).map(entry => entry.line);
  assert.ok(lines.includes('Opened in WhatsApp to share, 23 Oct 2026'), lines.join(' | '));
  const saved = await env.money<InvoiceView>('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'file' });
  assert.ok((saved.timeline ?? []).some(entry => entry.what === 'shared' && entry.line === 'Saved the PDF, 23 Oct 2026'));
  const mailed = await env.money<InvoiceView>('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'email' });
  assert.ok((mailed.timeline ?? []).some(entry => entry.line === 'Opened in your mail app to share, 23 Oct 2026'));
  const rows = await env.money<InvoiceListRow[]>('venture.invoice.list');
  assert.equal(rows.find(row => row.id === issued.invoice.id)!.sent, false);
});

test('Mark as sent makes it sent, on the view, the list row and the timeline', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  const marked = await env.money<InvoiceView>('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'marked' });
  assert.equal(marked.sent, true);
  assert.ok((marked.timeline ?? []).some(entry => entry.what === 'marked' && entry.line === 'You marked it sent, 23 Oct 2026'));
  const again = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: issued.invoice.id });
  assert.equal(again.sent, true);
  const rows = await env.money<InvoiceListRow[]>('venture.invoice.list');
  assert.equal(rows.find(row => row.id === issued.invoice.id)!.sent, true);
});

test('a void invoice, a draft and a made-up way refuse, and nothing is recorded', async () => {
  const env = await goalBusiness();
  const draft = await invoice(env, '1', null, true);
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: draft.invoice.id, how: 'marked' }), code('INVALID_VENTURE_REQUEST'));
  const issued = await invoice(env, '1', null);
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'sms' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'marked', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
  await ventureAction(env.deps, owner, 'admin', 'seed.void', tx => {
    const record = tx.find('venture-invoice', issued.invoice.id) as InvoiceRecord;
    return tx.replace<InvoiceRecord>({ ...record, status: 'void' });
  });
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'marked' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: 'invoice_missing', how: 'marked' }), code('INVOICE_NOT_FOUND'));
  assert.equal(listRecords(env.store.read(), 'venture-invoice-share').length, 0);
});

test('outside the app it asks for the app', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  await assert.rejects(env.money('venture.invoice.shared', { invoiceId: issued.invoice.id, how: 'marked' }, { ...owner, channel: 'mcp' } as typeof owner), code('APP_APPROVAL_REQUIRED'));
});
