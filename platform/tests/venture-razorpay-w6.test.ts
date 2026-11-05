// Wave 6 money (6D3): Razorpay Payment Links on the owner's own account, fixture-tested. The founder skipped Razorpay, so
// these responses are recorded from the shapes in Razorpay's public API docs (create a standard payment link, fetch a
// payment link by id) with synthetic values; keys are built at runtime so nothing here looks like a real key. Creating a
// link needs the owner's approval of its exact digest; checking records each captured payment once, with its receipt.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { InvoiceView, OrderRecord, PaymentRecord } from '../runtime/venture/contracts.ts';
import type { BillingView, PaymentHttp } from '../runtime/venture/money/billing-types.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { goalBusiness, type GoalEnv } from './venture-goals-helpers.ts';
import { code, phone } from './venture-views-env.ts';

const KEY_ID = ['rzp', 'test', 'Synthetic0Key1'].join('_');
const KEY_SECRET = ['synthetic', 'secret', 'value', '0042'].join('');
const LINK_ID = 'plink_SyntheticLink01';

/** A memory stand-in for the computer's protected key storage. */
function memoryCredentials() {
  const saved = new Map<string, string>();
  return { saved, port: { async get(scope: string, name: string) { return saved.get(`${scope}/${name}`) ?? null; }, async set(scope: string, name: string, value: string) { saved.set(`${scope}/${name}`, value); }, async delete(scope: string, name: string) { saved.delete(`${scope}/${name}`); } } };
}

/** A payment link as Razorpay's docs show it, with synthetic values. */
function link(fields: Record<string, unknown> = {}) {
  return {
    accept_partial: false, amount: 2330500, amount_paid: 0, callback_method: '', callback_url: '', cancelled_at: 0, created_at: 1792735200,
    currency: 'INR', customer: { name: 'Cafe Aroma Demo' }, description: 'Invoice INV-0001 from Ledger Cafe Books', expire_by: 1795327200, expired_at: 0,
    first_min_partial_amount: 0, id: LINK_ID, notes: { invoice: 'INV-0001' }, notify: { email: false, sms: false }, payments: null,
    reference_id: 'INV-0001', reminder_enable: false, reminders: [], short_url: 'https://rzp.io/i/Synth01', status: 'created', updated_at: 1792735200,
    upi_link: false, user_id: '', ...fields,
  };
}
// 2026-10-24T05:00:00Z, 10:30 in Kolkata.
const PAID_AT = 1792818000;
const PAID = link({ status: 'paid', amount_paid: 2330500, payments: [{ amount: 2330500, created_at: PAID_AT, method: 'upi', payment_id: 'pay_SyntheticPay01', plink_id: LINK_ID, status: 'captured', updated_at: PAID_AT }] });

type Call = Parameters<PaymentHttp>[0];
function recorded(answers: { status: number; body: unknown }[]): { calls: Call[]; http: PaymentHttp } {
  const calls: Call[] = [];
  return { calls, http: async request => { calls.push(request); const next = answers.shift(); assert.ok(next, 'an answer was recorded for this call'); return { status: next.status, body: JSON.stringify(next.body) }; } };
}

async function issued(env: GoalEnv): Promise<InvoiceView> {
  const order = await env.money<OrderRecord>('venture.order.create', { clientId: env.client.id, offerId: 'offer_1', request: 'Close the month of books.' });
  const draft = await env.money<InvoiceView>('venture.invoice.prepare', { orderId: order.id });
  return env.money<InvoiceView>('venture.invoice.issue', { invoiceId: draft.invoice.id, digest: draft.invoice.digest });
}

test('the keys go to protected storage only, and nothing is made without them', async () => {
  const env = await goalBusiness();
  const view = await issued(env);
  await assert.rejects(env.money('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'check' }), code('RAZORPAY_NOT_CONNECTED'));
  const keys = memoryCredentials();
  await assert.rejects(env.money('venture.billing.set', { razorpayKeys: { keyId: KEY_ID, keySecret: KEY_SECRET } }), code('CREDENTIAL_UNAVAILABLE'));
  env.deps.credentials = keys.port;
  await assert.rejects(env.money('venture.billing.set', { razorpayKeys: { keyId: 'key_123', keySecret: KEY_SECRET } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.money('venture.billing.set', { razorpayKeys: { keyId: KEY_ID, keySecret: KEY_SECRET } }, phone), code('APP_APPROVAL_REQUIRED'));
  const billing = await env.money<BillingView>('venture.billing.set', { razorpayKeys: { keyId: KEY_ID, keySecret: KEY_SECRET } });
  assert.deepEqual({ mode: billing.settings.razorpay?.mode, keyHint: billing.settings.razorpay?.keyHint }, { mode: 'test', keyHint: 'Key1' });
  assert.equal(keys.saved.size, 1);
  assert.ok(!JSON.stringify(env.store.read()).includes(KEY_SECRET), 'the secret never reaches the business file');
  const forgot = await env.money<BillingView>('venture.billing.set', { razorpayKeys: null });
  assert.equal(forgot.settings.razorpay, null);
  assert.equal(keys.saved.size, 0);
});

test('a payment link is made only on the exact approval, then polling records the payment once with its receipt', async () => {
  const env = await goalBusiness();
  env.deps.credentials = memoryCredentials().port;
  await env.money('venture.billing.set', { razorpayKeys: { keyId: KEY_ID, keySecret: KEY_SECRET } });
  const view = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: (await issued(env)).invoice.id });
  const offer = view.howToPay!.payLinkOffer!;
  assert.deepEqual({ amount: offer.amount, currency: offer.currency, label: offer.label }, { amount: '₹23,305', currency: 'INR', label: 'fixture-tested' });
  const answers = recorded([{ status: 200, body: link() }, { status: 200, body: link() }, { status: 200, body: PAID }, { status: 200, body: PAID }]);
  env.deps.paymentHttp = answers.http;
  await assert.rejects(env.money('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'create', digest: 'other0digest' }), code('APPROVAL_STALE'));
  await assert.rejects(env.money('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'create', digest: offer.digest }, phone), code('APP_APPROVAL_REQUIRED'));
  assert.equal(answers.calls.length, 0, 'nothing reached Razorpay before the approval');

  const made = await env.money<InvoiceView>('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'create', digest: offer.digest });
  const [create] = answers.calls;
  assert.equal(create!.method, 'POST');
  assert.equal(create!.url, 'https://api.razorpay.com/v1/payment_links/');
  assert.equal(create!.headers.authorization, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString('base64')}`);
  const sent = JSON.parse(create!.body!);
  assert.deepEqual({ amount: sent.amount, currency: sent.currency, notify: sent.notify, partial: sent.accept_partial }, { amount: 2330500, currency: 'INR', notify: { sms: false, email: false }, partial: false });
  assert.equal(made.invoice.payLink?.id, LINK_ID);
  assert.equal(made.howToPay?.payLink?.label, 'fixture-tested');
  assert.equal(made.howToPay?.payLinkOffer, null, 'one live link per balance');
  assert.match(made.documentText, /Pay online: https:\/\/rzp\.io\/i\/Synth01/);
  const entry = listRecords(env.store.read(), 'venture-journal-entry').find(item => item.subject.startsWith(`razorpay-link:${view.invoice.id}`));
  assert.equal(entry?.state, 'applied');
  assert.ok(!JSON.stringify(env.store.read()).includes(KEY_SECRET));

  // Not paid yet: nothing recorded.
  const waiting = await env.money<InvoiceView>('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'check' });
  assert.equal(answers.calls[1]!.url, `https://api.razorpay.com/v1/payment_links/${LINK_ID}`);
  assert.equal(waiting.payments.length, 0);
  // Paid: one payment, its exact amount, on the owner's day, with its books receipt.
  const paid = await env.money<InvoiceView>('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'check' });
  assert.equal(paid.invoice.status, 'paid');
  assert.equal(paid.invoice.payLink?.status, 'paid');
  const payments = listRecords(env.store.read(), 'venture-payment') as PaymentRecord[];
  assert.deepEqual(payments.map(p => [p.amountMinor, p.method, p.receivedOn]), [['2330500', 'payment-link', '2026-10-24']]);
  assert.ok(payments[0]!.booksReceiptId || payments[0]!.booksNote, 'the payment has its books receipt or the reason');
  await env.money('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'check' });
  assert.equal(listRecords(env.store.read(), 'venture-payment').length, 1, 'a payment is recorded once');
});

test('a link Razorpay refuses is not kept, and its words are shown', async () => {
  const env = await goalBusiness();
  env.deps.credentials = memoryCredentials().port;
  await env.money('venture.billing.set', { razorpayKeys: { keyId: KEY_ID, keySecret: KEY_SECRET } });
  const view = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: (await issued(env)).invoice.id });
  env.deps.paymentHttp = recorded([{ status: 400, body: { error: { code: 'BAD_REQUEST_ERROR', description: 'The api key provided is invalid', source: 'NA', step: 'NA', reason: 'NA', metadata: {} } } }]).http;
  await assert.rejects(env.money('venture.invoice.payLink', { invoiceId: view.invoice.id, action: 'create', digest: view.howToPay!.payLinkOffer!.digest }),
    (error: any) => error?.code === 'RAZORPAY_FAILED' && /Razorpay refused the link \(400\)\. Razorpay said: The api key provided is invalid/.test(error.message));
  const after = await env.money<InvoiceView>('venture.invoice.get', { invoiceId: view.invoice.id });
  assert.equal(after.invoice.payLink, undefined);
});

test('the desktop key store accepts the Razorpay key name, so the keys reach protected storage for real', async () => {
  const { validate } = await import('../runtime/venture/models/credential-contract.cjs');
  assert.doesNotThrow(() => validate('workspace_1', 'payments:razorpay', JSON.stringify({ keyId: KEY_ID, keySecret: KEY_SECRET }), true));
  assert.throws(() => validate('workspace_1', 'payments:other', 'x', true), { code: 'CREDENTIAL_INVALID' });
});
