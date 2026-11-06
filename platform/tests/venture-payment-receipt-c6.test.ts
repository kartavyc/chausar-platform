// One-shot C6 task 5 (section 9 idea 30, SCREENS 95): a thank-you receipt for one payment, made by code from the
// payment record, that the owner sends on WhatsApp. Chausar sends nothing: the words open in the owner's WhatsApp and
// the owner attaches the saved file. Every figure is the exact form (it leaves the business), from the records.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceView } from '../runtime/venture/contracts.ts';
import type { PaymentReceiptView } from '../runtime/venture/money/payment-receipt.ts';
import { formatMinor } from '../runtime/currency.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { code, phone } from './venture-views-env.ts';
import { net } from './venture-network-env.ts';
import { goalBusiness, invoice } from './venture-goals-helpers.ts';

type Env = Awaited<ReturnType<typeof goalBusiness>>;
const pay = (env: Env, view: InvoiceView, amount: string, method = 'upi') =>
  env.money<InvoiceView>('venture.payment.record', { invoiceId: view.invoice.id, amount, receivedOn: '2026-10-23', method });
const html = (file: PaymentReceiptView) => Buffer.from(file.contentBase64, 'base64').toString('utf8');

test('a payment that clears the invoice: its figures, the invoice, the date, the method and "Nothing is left to pay."', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  const paid = await pay(env, issued, '23305.00');
  const payment = paid.payments[0]!;
  const file = await env.money<PaymentReceiptView>('venture.payment.receipt', { paymentId: payment.id });
  const amount = formatMinor(payment.amountMinor, payment.currency);
  assert.equal(amount, 'INR 23,305.00');
  assert.equal(file.share.text, `Thank you for your payment of ${amount} for invoice ${issued.invoice.number}. Received on 23 Oct 2026 by UPI. Nothing is left to pay.`);
  assert.equal(file.fileName, `Receipt-${issued.invoice.number}-1.html`, 'no desktop printer here, so the same page as HTML');
  assert.equal(file.note, 'A PDF needs the desktop app.');
  const page = html(file);
  for (const line of ['Payment receipt', 'Ledger Cafe Books', 'Cafe Aroma Demo', `Invoice: ${issued.invoice.number}`, `Amount received: ${amount}`, 'Received on: 23 Oct 2026', 'Method: UPI', 'Left to pay: INR 0.00', file.share.text])
    assert.ok(page.includes(line), `the page holds "${line}"`);
  assert.ok(!/R-\d|receipt_|sumr/i.test(page.replace('Payment receipt', '')), 'no internal receipt id on the client copy');
  assert.ok(file.share.whatsappUrl.startsWith('https://wa.me/?text='), 'no number on the client: the owner picks the chat');
  assert.equal(decodeURIComponent(file.share.whatsappUrl.slice('https://wa.me/?text='.length)), file.share.text);
});

test('a part payment says what is left; the second payment of the invoice is numbered 2; the client\'s number opens their chat', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  const first = (await pay(env, issued, '20000.00')).payments[0]!;
  const one = await env.money<PaymentReceiptView>('venture.payment.receipt', { paymentId: first.id });
  assert.match(one.share.text, /Thank you for your payment of INR 20,000\.00 for invoice INV-\d+\. Received on 23 Oct 2026 by UPI\. INR 3,305\.00 is left to pay\.$/);
  const second = (await pay(env, issued, '3305.00', 'cash')).payments.find(item => item.id !== first.id)!;
  await net(env, 'venture.crm.client.edit', { clientId: env.client.id, field: 'phone', value: '98765 43210' });
  const two = await env.money<PaymentReceiptView>('venture.payment.receipt', { paymentId: second.id });
  assert.match(two.share.text, /INR 3,305\.00 .* by cash\. Nothing is left to pay\.$/);
  assert.equal(two.fileName, `Receipt-${issued.invoice.number}-2.html`);
  assert.ok(two.share.whatsappUrl.startsWith('https://wa.me/919876543210?text='));
  // The first receipt still says what was left after it, not after the later payment.
  assert.match((await env.money<PaymentReceiptView>('venture.payment.receipt', { paymentId: first.id })).share.text, /INR 3,305\.00 is left to pay\.$/);
});

test('refused: a payment not in this business, a cheque not cleared yet, a cancelled invoice, and outside the app', async () => {
  const env = await goalBusiness();
  const issued = await invoice(env, '1', null);
  await assert.rejects(env.money('venture.payment.receipt', { paymentId: 'payment_nobody' }), code('PAYMENT_NOT_FOUND'));
  await assert.rejects(env.money('venture.payment.receipt', { paymentId: 'x', extra: 1 }), code('INVALID_VENTURE_REQUEST'));
  const cheque = (await env.money<InvoiceView>('venture.payment.record', { invoiceId: issued.invoice.id, amount: '1000.00', receivedOn: '2026-10-23', method: 'cheque' })).payments[0]!;
  await assert.rejects(env.money('venture.payment.receipt', { paymentId: cheque.id }), code('PAYMENT_NOT_CLEARED'));
  const paid = (await pay(env, issued, '500.00')).payments.find(item => item.id !== cheque.id)!;
  await assert.rejects(env.money('venture.payment.receipt', { paymentId: paid.id }, phone), code('APP_APPROVAL_REQUIRED'));
  await env.store.update(state => { const record = state.conversations.find((item: any) => item.id === issued.invoice.id); record.status = 'void'; });
  await assert.rejects(env.money('venture.payment.receipt', { paymentId: paid.id }), code('INVALID_VENTURE_REQUEST'));
  assert.equal(listRecords(env.store.read(), 'venture-payment').length, 2, 'reading a receipt writes no payment');
});
