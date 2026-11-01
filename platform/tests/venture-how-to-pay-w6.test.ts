// Wave 6 money (6D2): how to pay, on every invoice. The owner's UPI ID (checked as a VPA) and bank details are billing
// settings only the app can change; an issued rupee invoice gets a upi://pay link and a QR code built by code from its
// exact balance and number; the PDF and the share links open the owner's own apps; the client's copy carries no receipt id.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceView, OrderRecord } from '../runtime/venture/contracts.ts';
import type { BillingView } from '../runtime/venture/money/billing-types.ts';
import type { InvoicePdfView } from '../runtime/venture/money/invoice-pdf.ts';
import { qrMatrix } from '../runtime/venture/money/qr.ts';
import { upiLink } from '../runtime/venture/money/upi.ts';
import { goalBusiness, type GoalEnv } from './venture-goals-helpers.ts';
import { code, phone } from './venture-views-env.ts';

const LINK = 'upi://pay?pa=ledger.cafe@okaxis&pn=Ledger%20Cafe%20Books&am=23305.00&cu=INR&tn=Invoice%20INV-0001&tr=INV-0001';
const BANK = { accountName: 'Ledger Cafe Books', accountNumber: '0001 2345 6789', ifsc: 'hdfc0001234', bankName: 'HDFC Bank' };

async function issued(env: GoalEnv): Promise<InvoiceView> {
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Close the month of books.' });
  const draft = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id });
  assert.equal(draft.howToPay?.upi ?? null, null, 'a draft has no number, so no UPI link yet');
  return env.money<InvoiceView>('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
}

test('the UPI ID and bank details are checked, and only the app can change them', async () => {
  const env = await goalBusiness();
  for (const bad of ['ledgercafe', 'a@1bank', '@okaxis', 'ledger cafe@okaxis']) await assert.rejects(env.money('venture.billing.set', { upiId: bad }), code('INVALID_UPI_ID'));
  await assert.rejects(env.money('venture.billing.set', { bank: { ...BANK, ifsc: 'HDFC1234' } }), code('INVALID_BANK_DETAILS'));
  await assert.rejects(env.money('venture.billing.set', { bank: { accountName: 'X', accountNumber: '12345678' } }), code('INVALID_BANK_DETAILS'));
  await assert.rejects(env.money('venture.billing.set', { upiId: 'ledger.cafe@okaxis' }, phone), code('APP_APPROVAL_REQUIRED'));
  const view = await env.money<BillingView>('venture.billing.set', { upiId: ' Ledger.Cafe@OKAxis ', bank: BANK });
  assert.equal(view.settings.upiId, 'Ledger.Cafe@okaxis');
  assert.deepEqual(view.settings.bank, { accountName: 'Ledger Cafe Books', accountNumber: '000123456789', ifsc: 'HDFC0001234', swift: null, bankName: 'HDFC Bank' });
  assert.equal(view.razorpayLabel, 'fixture-tested');
  const cleared = await env.money<BillingView>('venture.billing.set', { upiId: null });
  assert.equal(cleared.settings.upiId, null);
  assert.deepEqual((await env.money<BillingView>('venture.billing.get')).settings.bank?.ifsc, 'HDFC0001234');
});

test('an issued invoice carries the exact UPI link, its QR code and the bank details, with no receipt id for the client', async () => {
  const env = await goalBusiness();
  await env.money('venture.billing.set', { upiId: 'ledger.cafe@okaxis', bank: BANK });
  const view = await issued(env);
  const upi = view.howToPay!.upi!;
  assert.equal(upi.link, LINK);
  assert.equal(upi.amountMinor, '2330500');
  assert.equal(upi.amount, 'INR 23,305.00');
  assert.equal(upi.reference, 'INV-0001');
  assert.equal(upi.receiptId, view.invoice.priceReceiptId, 'the owner sees the receipt mark beside the amount');
  assert.equal(upi.qr.size, upi.qr.version * 4 + 17);
  assert.deepEqual(upi.qr, qrMatrix(LINK), 'the QR code encodes exactly the link');
  assert.match(view.documentText, /How to pay\nUPI ID: ledger\.cafe@okaxis\nPay INR 23,305\.00 by UPI: upi:\/\/pay\?pa=ledger\.cafe@okaxis/);
  assert.match(view.documentText, /Bank transfer to Ledger Cafe Books, account 000123456789\nIFSC HDFC0001234, HDFC Bank/);
  assert.ok(!view.documentText.includes(view.invoice.priceReceiptId), 'no receipt id on the client copy');

  // A part payment the owner marks: the link asks for the exact balance, and the timeline says who marked it.
  const part = await env.money<InvoiceView>('venture.payment.record', { invoiceId: view.invoice.id, amount: '5000', receivedOn: '2026-10-23', method: 'upi' });
  assert.match(part.howToPay!.upi!.link, /&am=18305\.00&/);
  assert.ok(part.timeline!.some(item => item.line === 'Paid INR 5,000.00 by UPI on 23 Oct 2026, marked paid by you'));
  const paid = await env.money<InvoiceView>('venture.payment.record', { invoiceId: view.invoice.id, amount: '18305', receivedOn: '2026-10-23', method: 'upi' });
  assert.equal(paid.howToPay!.upi, null, 'nothing left to pay, no link');
});

test('a link is built from code, never a float, and a long name is cut to fit', () => {
  assert.equal(upiLink({ upiId: 'a.b@ybl', payeeName: 'Ravi  & Sons', amountMinor: '5', reference: 'INV-0002' }), 'upi://pay?pa=a.b@ybl&pn=Ravi%20%26%20Sons&am=0.05&cu=INR&tn=Invoice%20INV-0002&tr=INV-0002');
  assert.match(upiLink({ upiId: 'a.b@ybl', payeeName: 'N'.repeat(80), amountMinor: '100', reference: 'INV-0003' }), new RegExp(`pn=${'N'.repeat(50)}&am=1\\.00&`));
});

test('the PDF and share links open the owner\'s own apps; without the desktop printer the file is HTML and says why', async () => {
  const env = await goalBusiness();
  await env.money('venture.billing.set', { upiId: 'ledger.cafe@okaxis' });
  const view = await issued(env);
  await assert.rejects(env.money('venture.invoice.pdf', { invoiceId: view.invoice.id }, phone), code('APP_APPROVAL_REQUIRED'));
  const file = await env.money<InvoicePdfView>('venture.invoice.pdf', { invoiceId: view.invoice.id });
  assert.equal(file.format, 'html');
  assert.equal(file.note, 'A PDF needs the desktop app.');
  const html = Buffer.from(file.contentBase64, 'base64').toString('utf8');
  const side = view.howToPay!.upi!.qr.size + 8;
  assert.ok(html.includes(`viewBox="0 0 ${side} ${side}"`), 'the QR code is drawn as shapes, with a quiet zone of four modules');
  assert.ok(html.includes('Scan with any UPI app to pay INR 23,305.00 to ledger.cafe@okaxis'));
  assert.ok(!html.includes(view.invoice.priceReceiptId) && !/receipt/i.test(html), 'no receipt id on the client copy');
  assert.ok(file.share.whatsappUrl.startsWith('https://wa.me/?text='));
  const text = decodeURIComponent(file.share.whatsappUrl.slice('https://wa.me/?text='.length));
  assert.match(text, /Here is invoice INV-0001 for INR 23,305\.00, due on 30 Oct 2026\. The PDF is attached\./);
  assert.match(text, /You can pay by UPI to ledger\.cafe@okaxis\./);
  assert.ok(file.share.mailtoUrl.startsWith('mailto:owner@aroma.example?subject=Invoice%20INV-0001%20from%20Ledger%20Cafe%20Books&body='));

  // With the desktop's print port, the same page becomes a PDF.
  const printed: string[] = [];
  env.deps.print = { async print(request) { printed.push(request.html); return { ok: true, pdfBase64: Buffer.from('%PDF-1.7 synthetic').toString('base64') }; } };
  env.deps.host = 'desktop';
  const pdf = await env.money<InvoicePdfView>('venture.invoice.pdf', { invoiceId: view.invoice.id });
  assert.equal(pdf.format, 'pdf');
  assert.equal(pdf.fileName, 'INV-0001.pdf');
  // The printed page is the same client copy; on the desktop the practice line of experimental storage is gone.
  assert.equal(printed[0], html.replace('\nPractice invoice from an experimental Chausar build.', ''));
});
