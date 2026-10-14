import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Router, type HostedResponse } from '../../hosted/shared/http.ts';
import { JobQueue } from '../../hosted/db/queue.ts';
import { FREE_ENTITLEMENTS } from '../../hosted/shared/auth.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';
import { authenticator, createAccountsModule } from '../../hosted/accounts/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { billingEntitlements, createBillingModule, paidEntitlements } from '../../hosted/billing/module.ts';
import { FakePaymentPartner, UnconfiguredPaymentPartner, type PartnerEvent, type PaymentPartner } from '../../hosted/billing/partner.ts';
import { RazorpayPartner, RAZORPAY_TOTAL_COUNT } from '../../hosted/billing/razorpay.ts';
import { billingConfig, type BillingConfig } from '../../hosted/billing/config.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const PEPPER = 'pepper-for-billing-tests-only-0123456789';
const DAY = 24 * 3600000;
const refusingFetch: Fetch = async () => { throw new Error('network is not allowed in tests'); };
function recordingFetch(replies: ({ status: number; body: string } | Error)[]) {
  const calls: { url: string; init: Parameters<Fetch>[1] }[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const reply = replies.shift();
    if (!reply) throw new Error('no recorded reply');
    if (reply instanceof Error) throw reply;
    return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, headers: { get: () => null }, text: async () => reply.body, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  return { fetch, calls };
}
const code = (response: { body: any }) => response.body?.error?.code;

async function setup(options: { partner?: PaymentPartner; env?: Record<string, string> } = {}) {
  const sql = await freshDatabase();
  let now = new Date('2026-10-14T10:00:00.000Z');
  const clock = () => now;
  const { config } = billingConfig(options.env ?? { BILLING_PAID_PRICE_PAISE: '49900' }, refusingFetch);
  const entitlements = billingEntitlements(sql, clock, config);
  const deps: HostedDeps = { sql, clock, queue: new JobQueue(sql, clock), fetch: refusingFetch, pepper: PEPPER, linkOrigin: 'https://link.example.invalid', authenticate: authenticator(sql, PEPPER, clock), entitlements };
  const otp = new FakeOtpProvider(), partner = options.partner ?? new FakePaymentPartner();
  const router = new Router();
  createAccountsModule(deps, { otp, entitlements }).routes(router);
  createBillingModule(deps, { partner, config }).routes(router);
  const call = (method: string, url: string, body?: unknown, token?: string): Promise<HostedResponse & { body: any }> => router.handle({
    method, url, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)),
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) },
  }) as any;
  const signIn = async (phone = '+919876543210') => {
    const started = await call('POST', '/v1/accounts/otp/start', { phone });
    return (await call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: otp.last(), deviceName: 'PC' })).body.sessionToken as string;
  };
  const send = (path: string, body: Buffer, headers: Record<string, string | undefined>) => router.handle({ method: 'POST', url: `/v1/billing/webhooks/${path}`, body, headers }) as Promise<HostedResponse & { body: any }>;
  return { sql, config, call, signIn, send, partner, advance(ms: number) { now = new Date(now.getTime() + ms); }, now: () => now };
}
const event = (eventId: string, type: PartnerEvent['type'], refs: { checkoutId?: string; subscriptionRef?: string }, currentPeriodEnd: string | null = null): PartnerEvent =>
  ({ eventId, type, checkoutId: refs.checkoutId ?? null, subscriptionRef: refs.subscriptionRef ?? null, currentPeriodEnd });

test('plans state the price as configured, and missing is words', { skip: pgSkip }, async () => {
  const unset = await setup({ env: {} });
  const token = await unset.signIn();
  assert.equal(code(await unset.call('GET', '/v1/billing/plans')), 'UNAUTHENTICATED');
  const plans = await unset.call('GET', '/v1/billing/plans', undefined, token);
  assert.equal(plans.status, 200);
  assert.deepEqual(plans.body.plans.map((p: any) => [p.plan, p.pricePaise, p.priceState, p.period]), [['free', '0', 'set', 'month'], ['paid', null, 'not-set', 'month']]);
  assert.deepEqual(plans.body.plans[0].includes, { ...FREE_ENTITLEMENTS, allowanceMonthlyPaise: null, allowanceMonthlyState: 'not-included' });
  assert.deepEqual(plans.body.plans[1].includes, {
    plan: 'paid', relay: true, backup: true, backupQuotaBytes: 2 * 1024 ** 3, backupKeep: 14, allowance: false, allowanceMonthlyPaise: null, allowanceMonthlyState: 'not-set', worker: true, monthlyMessages: 30,
  }, 'a grant that is not set is never shown as zero');
  const refused = await unset.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token);
  assert.equal(refused.status, 503); assert.equal(code(refused), 'PRICE_NOT_SET');

  const priced = await setup({ env: { BILLING_PAID_PRICE_PAISE: '49900', ALLOWANCE_MONTHLY_PAISE: '20000', BACKUP_QUOTA_BYTES: '1073741824' } });
  const paid = (await priced.call('GET', '/v1/billing/plans', undefined, await priced.signIn())).body.plans[1];
  assert.equal(paid.pricePaise, '49900'); assert.equal(paid.priceState, 'set');
  assert.equal(paid.includes.allowance, true); assert.equal(paid.includes.allowanceMonthlyPaise, '20000'); assert.equal(paid.includes.allowanceMonthlyState, 'set'); assert.equal(paid.includes.backupQuotaBytes, 1073741824);
});

test('checkout through the fake partner is idempotent by key', { skip: pgSkip }, async () => {
  const t = await setup();
  const fake = t.partner as FakePaymentPartner;
  const token = await t.signIn();
  assert.deepEqual((await t.call('GET', '/v1/billing/subscription', undefined, token)).body, { plan: 'free', status: 'none', currentPeriodEnd: null, partner: null });
  assert.equal(code(await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' })), 'UNAUTHENTICATED');
  assert.equal(code(await t.call('POST', '/v1/billing/checkout', { plan: 'free', idempotencyKey: 'key-0123456789abcdef' }, token)), 'PLAN_INVALID');
  assert.equal(code(await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'short' }, token)), 'INVALID_REQUEST');
  assert.equal(code(await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef', price: '1' }, token)), 'INVALID_REQUEST');

  const first = await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token);
  assert.equal(first.status, 200);
  assert.match(first.body.checkoutId, /^fchk_[0-9a-f-]{36}$/);
  assert.equal(first.body.checkoutUrl, `https://pay.example.invalid/checkout/${first.body.checkoutId}`);
  assert.equal(first.body.status, 'pending');
  const again = await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token);
  assert.deepEqual(again.body, first.body);
  assert.equal(fake.checkouts.size, 1);
  assert.deepEqual((await t.call('GET', '/v1/billing/subscription', undefined, token)).body, { plan: 'free', status: 'pending', currentPeriodEnd: null, partner: 'fake' });
  const [stored] = [...fake.checkouts.values()];
  assert.equal(stored.plan, 'paid'); assert.match(stored.accountId, /^acct_/);
  // Cancelling a pending checkout needs no partner call.
  assert.deepEqual((await t.call('POST', '/v1/billing/cancel', {}, token)).body, { status: 'cancelled', currentPeriodEnd: null });
  assert.deepEqual(fake.cancelled, []);
  assert.equal(code(await t.call('POST', '/v1/billing/cancel', {}, token)), 'NO_SUBSCRIPTION');
});

test('webhooks need a valid signature and apply each event once', { skip: pgSkip }, async () => {
  const t = await setup({ partner: new FakePaymentPartner('fake-secret-0123456789') });
  const fake = t.partner as FakePaymentPartner;
  const token = await t.signIn();
  const { checkoutId } = (await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token)).body;
  const activated = fake.webhook(event('evt_1', 'activated', { checkoutId, subscriptionRef: 'fsub_000001' }, '2026-11-14T10:00:00.000Z'));

  const forged = Buffer.from(activated.body.toString().replace('evt_1', 'evt_2'));
  for (const [body, headers] of [[forged, activated.headers], [activated.body, {}], [activated.body, { 'x-fake-signature': 'ab'.repeat(32) }]] as const) {
    const reply = await t.send('fake', body, headers);
    assert.equal(reply.status, 401); assert.equal(code(reply), 'WEBHOOK_SIGNATURE_INVALID');
  }
  const stranger = new FakePaymentPartner('another-secret').webhook(event('evt_1', 'activated', { checkoutId }));
  assert.equal(code(await t.send('fake', stranger.body, stranger.headers)), 'WEBHOOK_SIGNATURE_INVALID');
  assert.equal((await t.send('razorpay', activated.body, activated.headers)).status, 404, 'only the configured partner has a webhook');
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM billing_events')).rows[0].n, 0);
  assert.equal((await t.call('GET', '/v1/accounts/me', undefined, token)).body.plan, 'free');

  assert.deepEqual(await t.send('fake', activated.body, activated.headers), { status: 200, body: { received: true } });
  assert.deepEqual((await t.call('GET', '/v1/billing/subscription', undefined, token)).body, { plan: 'paid', status: 'active', currentPeriodEnd: '2026-11-14T10:00:00.000Z', partner: 'fake' });

  const cancelled = fake.webhook(event('evt_2', 'cancelled', { subscriptionRef: 'fsub_000001' }));
  assert.equal((await t.send('fake', cancelled.body, cancelled.headers)).status, 200);
  assert.deepEqual(await t.send('fake', activated.body, activated.headers), { status: 200, body: { received: true } }, 'a replay is acknowledged');
  assert.equal((await t.call('GET', '/v1/billing/subscription', undefined, token)).body.status, 'cancelled', 'and changes nothing');
  const { rows } = await t.sql.query('SELECT event_id, type, account_id FROM billing_events ORDER BY event_id');
  assert.deepEqual(rows.map(r => [r.event_id, r.type, r.account_id !== null]), [['evt_1', 'activated', true], ['evt_2', 'cancelled', true]]);

  // An event for nobody is recorded and ignored.
  const nobody = fake.webhook(event('evt_3', 'charged', { subscriptionRef: 'fsub_unknown' }));
  assert.equal((await t.send('fake', nobody.body, nobody.headers)).status, 200);
  const malformed = Buffer.from(JSON.stringify({ eventId: 'evt_4', type: 'refunded', checkoutId, subscriptionRef: null, currentPeriodEnd: null }));
  const signed = { 'x-fake-signature': createHmac('sha256', 'fake-secret-0123456789').update(malformed).digest('hex') };
  assert.equal(code(await t.send('fake', malformed, signed)), 'WEBHOOK_INVALID', 'a signed body is still checked');
});

test('entitlements move from free to paid, through the past-due grace, to cancelled', { skip: pgSkip }, async () => {
  const t = await setup();
  const fake = t.partner as FakePaymentPartner;
  const token = await t.signIn();
  const plan = async () => (await t.call('GET', '/v1/accounts/me', undefined, token)).body.entitlements;
  const deliver = async (e: PartnerEvent) => { const w = fake.webhook(e); assert.equal((await t.send('fake', w.body, w.headers)).status, 200); };
  assert.deepEqual(await plan(), { ...FREE_ENTITLEMENTS });

  const { checkoutId } = (await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token)).body;
  assert.equal((await plan()).plan, 'free', 'a pending checkout is not paid');
  await deliver(event('e1', 'activated', { checkoutId, subscriptionRef: 'fsub_000001' }, '2026-11-14T10:00:00.000Z'));
  assert.deepEqual(await plan(), paidEntitlements(t.config));
  assert.equal(code(await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-another-0123456789' }, token)), 'SUBSCRIPTION_EXISTS');

  t.advance(20 * DAY); assert.equal((await plan()).plan, 'paid');
  t.advance(11 * DAY);
  await deliver(event('e2', 'past_due', { subscriptionRef: 'fsub_000001' }));
  assert.equal((await t.call('GET', '/v1/billing/subscription', undefined, token)).body.status, 'past_due');
  t.advance(7 * DAY - 1000);
  assert.equal((await plan()).plan, 'paid', 'inside the seven-day grace');
  t.advance(1000);
  assert.equal((await plan()).plan, 'free', 'the grace has ended');
  await deliver(event('e3', 'charged', { subscriptionRef: 'fsub_000001' }, '2026-12-14T10:00:00.000Z'));
  assert.deepEqual((await t.call('GET', '/v1/billing/subscription', undefined, token)).body, { plan: 'paid', status: 'active', currentPeriodEnd: '2026-12-14T10:00:00.000Z', partner: 'fake' });

  const cancelled = await t.call('POST', '/v1/billing/cancel', {}, token);
  assert.deepEqual(cancelled.body, { status: 'cancelled', currentPeriodEnd: '2026-12-14T10:00:00.000Z' });
  assert.deepEqual(fake.cancelled, ['fsub_000001']);
  assert.equal((await plan()).plan, 'free');
  await deliver(event('e4', 'charged', { subscriptionRef: 'fsub_000001' }));
  assert.equal((await plan()).plan, 'free', 'a late charge of a cancelled subscription changes nothing');

  // A new checkout after cancelling starts a new subscription; events of the old one stay ignored.
  const next = (await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-second-0123456789' }, token)).body;
  assert.notEqual(next.checkoutId, checkoutId);
  await deliver(event('e5', 'activated', { checkoutId: next.checkoutId, subscriptionRef: 'fsub_000002' }));
  await deliver(event('e6', 'cancelled', { subscriptionRef: 'fsub_000001' }));
  assert.equal((await plan()).plan, 'paid');
  await deliver(event('e7', 'cancelled', { subscriptionRef: 'fsub_000002' }));
  assert.equal((await plan()).plan, 'free');
  assert.equal(code(await t.call('POST', '/v1/billing/cancel', {}, token)), 'NO_SUBSCRIPTION');
});

test('a subscription that would charge beside the tracked one is cancelled at the partner', { skip: pgSkip }, async () => {
  const t = await setup();
  const fake = t.partner as FakePaymentPartner;
  const token = await t.signIn();
  const deliver = async (e: PartnerEvent) => { const w = fake.webhook(e); assert.equal((await t.send('fake', w.body, w.headers)).status, 200); };
  const checkout = async (key: string) => (await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: key }, token)).body.checkoutId as string;
  const refOf = (checkoutId: string) => checkoutId.replace(/^fchk_/, 'fsub_');
  const stray = async (n: string) => t.sql.query(`INSERT INTO billing_checkouts (checkout_id, account_id, partner, plan, idempotency_key, checkout_url, subscription_ref, created_at)
    SELECT $1, account_id, 'fake', 'paid', $2, 'https://pay.example.invalid/stray', $3, now() FROM billing_checkouts LIMIT 1`, [`fchk_stray_${n}`, `key-stray-${n}-0123456789`, `fsub_stray_${n}`]);

  // A new checkout while one is pending cancels the earlier one's partner subscription; a repeat of the same key does not.
  const first = await checkout('key-first-0123456789');
  assert.deepEqual(fake.cancelled, []);
  const second = await checkout('key-second-0123456789');
  assert.deepEqual(fake.cancelled, [refOf(first)]);
  await checkout('key-second-0123456789');
  assert.deepEqual(fake.cancelled, [refOf(first)]);
  // The earlier link paid anyway: Chausar already cancelled it, so it does not come back.
  await deliver(event('s1', 'activated', { checkoutId: first, subscriptionRef: refOf(first) }));
  assert.equal((await t.call('GET', '/v1/billing/subscription', undefined, token)).body.status, 'pending');

  // A third checkout supersedes the second; paying it makes it the tracked subscription.
  const third = await checkout('key-third-0123456789');
  assert.deepEqual(fake.cancelled, [refOf(first), refOf(second)]);
  fake.cancelled.length = 0;
  await deliver(event('s2', 'activated', { checkoutId: third, subscriptionRef: refOf(third) }, '2026-11-14T10:00:00.000Z'));
  assert.deepEqual((await t.call('GET', '/v1/billing/subscription', undefined, token)).body, { plan: 'paid', status: 'active', currentPeriodEnd: '2026-11-14T10:00:00.000Z', partner: 'fake' });
  assert.deepEqual(fake.cancelled, [], 'the paid checkout is the tracked one');

  // Another subscription of this account starting or charging beside the active one is cancelled once and changes nothing here.
  await stray('two');
  await deliver(event('s3', 'activated', { checkoutId: 'fchk_stray_two', subscriptionRef: 'fsub_stray_two' }));
  await deliver(event('s4', 'charged', { checkoutId: 'fchk_stray_two', subscriptionRef: 'fsub_stray_two' }));
  assert.deepEqual(fake.cancelled, ['fsub_stray_two']);
  assert.equal((await t.sql.query('SELECT subscription_ref FROM billing_subscriptions')).rows[0].subscription_ref, refOf(third));
  assert.equal((await t.call('GET', '/v1/billing/subscription', undefined, token)).body.status, 'active');

  // Another account: a different checkout of it is paid while a newer one is pending; the pending one is cancelled at the partner.
  const otherToken = await t.signIn('+919811122233');
  const pending = (await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-other-0123456789' }, otherToken)).body.checkoutId as string;
  await t.sql.query(`INSERT INTO billing_checkouts (checkout_id, account_id, partner, plan, idempotency_key, checkout_url, subscription_ref, created_at)
    SELECT 'fchk_older_paid', account_id, 'fake', 'paid', 'key-older-0123456789', 'https://pay.example.invalid/older', 'fsub_older_paid', now() FROM billing_checkouts WHERE checkout_id = $1`, [pending]);
  fake.cancelled.length = 0;
  await deliver(event('s6', 'activated', { checkoutId: 'fchk_older_paid', subscriptionRef: 'fsub_older_paid' }));
  assert.deepEqual(fake.cancelled, [refOf(pending)]);
  assert.equal((await t.call('GET', '/v1/billing/subscription', undefined, otherToken)).body.status, 'active');

  // A partner that fails the cancel fails the webhook, so the partner's retry tries again.
  await stray('three');
  fake.cancel = async () => { throw new Error('partner down'); };
  const retried = fake.webhook(event('s5', 'charged', { checkoutId: 'fchk_stray_three', subscriptionRef: 'fsub_stray_three' }));
  assert.equal((await t.send('fake', retried.body, retried.headers)).status, 500);
  assert.equal((await t.sql.query(`SELECT count(*)::int AS n FROM billing_events WHERE event_id = 's5'`)).rows[0].n, 0, 'the event was not recorded');
});

test('without a payment partner checkout refuses with a typed code', { skip: pgSkip }, async () => {
  const t = await setup({ partner: new UnconfiguredPaymentPartner() });
  const token = await t.signIn();
  const reply = await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token);
  assert.equal(reply.status, 503); assert.equal(code(reply), 'PAYMENT_PARTNER_NOT_CONFIGURED');
  assert.equal(code(await t.send('none', Buffer.from('{}'), {})), 'PAYMENT_PARTNER_NOT_CONFIGURED');
});

const RAZORPAY = { keyId: 'rzp_test_AbCdEf123456', keySecret: 'secretsecretsecret123456', webhookSecret: 'whsec-0123456789abcdef', planId: 'plan_Pq9ZyXw8VuT7' };
test('the Razorpay client sends the exact requests and verifies webhook signatures', async () => {
  const created = { id: 'sub_00000000000001', entity: 'subscription', plan_id: RAZORPAY.planId, status: 'created', total_count: 120, short_url: 'https://rzp.io/i/AbCdEf', notes: {} };
  const { fetch, calls } = recordingFetch([
    { status: 200, body: JSON.stringify(created) },
    { status: 200, body: JSON.stringify({ ...created, status: 'cancelled' }) },
    { status: 400, body: '{"error":{"code":"BAD_REQUEST_ERROR","description":"The id provided does not exist"}}' },
    new Error('reset'),
    { status: 200, body: JSON.stringify({ ...created, short_url: 'http://rzp.io/i/AbCdEf' }) },
  ]);
  const razorpay = new RazorpayPartner(fetch, RAZORPAY, () => new Date('2026-11-14T10:05:00.000Z'));
  const auth = `Basic ${Buffer.from(`${RAZORPAY.keyId}:${RAZORPAY.keySecret}`).toString('base64')}`;
  const headers = { authorization: auth, 'content-type': 'application/json', accept: 'application/json' };

  assert.deepEqual(await razorpay.createCheckout({ accountId: 'acct_1', plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }), { checkoutId: 'sub_00000000000001', checkoutUrl: 'https://rzp.io/i/AbCdEf', subscriptionRef: 'sub_00000000000001' });
  assert.equal(calls[0].url, 'https://api.razorpay.com/v1/subscriptions');
  assert.equal(calls[0].init?.method, 'POST'); assert.deepEqual(calls[0].init?.headers, headers);
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { plan_id: RAZORPAY.planId, total_count: RAZORPAY_TOTAL_COUNT, quantity: 1, customer_notify: 1, notes: { chausar_account: 'acct_1', chausar_checkout: 'key-0123456789abcdef' } });

  await razorpay.cancel('sub_00000000000001');
  assert.equal(calls[1].url, 'https://api.razorpay.com/v1/subscriptions/sub_00000000000001/cancel');
  assert.equal(calls[1].init?.method, 'POST'); assert.deepEqual(calls[1].init?.headers, headers);
  assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { cancel_at_cycle_end: 0 });

  await assert.rejects(razorpay.cancel('sub_00000000000001'), { code: 'PAYMENT_PARTNER_FAILED', status: 502 });
  await assert.rejects(razorpay.createCheckout({ accountId: 'acct_1', plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }), { code: 'PAYMENT_PARTNER_FAILED' });
  await assert.rejects(razorpay.createCheckout({ accountId: 'acct_1', plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }), { code: 'PAYMENT_PARTNER_FAILED' }, 'a plain http checkout link is refused');
  await assert.rejects(razorpay.cancel('../x'), { code: 'SUBSCRIPTION_REF_INVALID' });

  const recorded = Buffer.from(JSON.stringify({
    entity: 'event', account_id: 'acc_BFQ7uQEaa7j2z7', event: 'subscription.charged', contains: ['subscription', 'payment'],
    payload: { subscription: { entity: { id: 'sub_00000000000001', entity: 'subscription', plan_id: RAZORPAY.planId, status: 'active', current_start: 1794650400, current_end: 1797242400 } } },
    created_at: 1794650400,
  }));
  const signature = createHmac('sha256', RAZORPAY.webhookSecret).update(recorded).digest('hex');
  const verified = razorpay.verifyWebhook(recorded, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'EvtAbc123' })!;
  assert.match(verified.eventId, /^rzp_[0-9a-f]{64}$/, 'the dedupe id comes from the signed body, not the unsigned header');
  assert.deepEqual(verified, { eventId: verified.eventId, type: 'charged', checkoutId: 'sub_00000000000001', subscriptionRef: 'sub_00000000000001', currentPeriodEnd: '2026-12-14T10:00:00.000Z' });
  assert.equal(razorpay.verifyWebhook(recorded, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'EvtOther999' })!.eventId, verified.eventId, 'a new header is the same event');
  assert.equal(razorpay.verifyWebhook(recorded, { 'x-razorpay-signature': signature })!.eventId, verified.eventId, 'the header is optional');
  assert.throws(() => razorpay.verifyWebhook(recorded, { 'x-razorpay-signature': signature, 'x-razorpay-event-id': '../x' }), { code: 'WEBHOOK_INVALID' });
  assert.throws(() => razorpay.verifyWebhook(Buffer.concat([recorded, Buffer.from(' ')]), { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'EvtAbc123' }), { code: 'WEBHOOK_SIGNATURE_INVALID', status: 401 });
  assert.throws(() => razorpay.verifyWebhook(recorded, { 'x-razorpay-event-id': 'EvtAbc123' }), { code: 'WEBHOOK_SIGNATURE_INVALID' });
  const sign = (body: Buffer) => ({ 'x-razorpay-signature': createHmac('sha256', RAZORPAY.webhookSecret).update(body).digest('hex') });
  const undated = Buffer.from(recorded.toString().replace(',"created_at":1794650400', ''));
  assert.throws(() => razorpay.verifyWebhook(undated, sign(undated)), { code: 'WEBHOOK_INVALID' }, 'created_at is required');
  const withPayment = Buffer.from(recorded.toString().replace('"payload":{', '"payload":{"payment":{"entity":{"id":"pay_Synthetic00001","entity":"payment"}},'));
  assert.notEqual(razorpay.verifyWebhook(withPayment, sign(withPayment))!.eventId, verified.eventId, 'each payment is its own event');
  const later = Buffer.from(recorded.toString().replace('1794650400}', '1794650460}'));
  assert.notEqual(razorpay.verifyWebhook(later, sign(later))!.eventId, verified.eventId);
  const stale = new RazorpayPartner(fetch, RAZORPAY, () => new Date('2026-11-17T10:00:01.000Z'));
  assert.throws(() => stale.verifyWebhook(recorded, sign(recorded)), { code: 'WEBHOOK_STALE', status: 400 }, 'older than three days');
  assert.equal(new RazorpayPartner(fetch, RAZORPAY, () => new Date('2026-11-17T09:59:00.000Z')).verifyWebhook(recorded, sign(recorded))?.type, 'charged');
  for (const [name, type] of [['subscription.activated', 'activated'], ['subscription.halted', 'past_due'], ['subscription.cancelled', 'cancelled']] as const) {
    const body = Buffer.from(recorded.toString().replace('subscription.charged', name));
    assert.equal(razorpay.verifyWebhook(body, { 'x-razorpay-signature': createHmac('sha256', RAZORPAY.webhookSecret).update(body).digest('hex'), 'x-razorpay-event-id': 'EvtAbc124' })?.type, type);
  }
  const other = Buffer.from(recorded.toString().replace('subscription.charged', 'payment.captured'));
  assert.equal(razorpay.verifyWebhook(other, { 'x-razorpay-signature': createHmac('sha256', RAZORPAY.webhookSecret).update(other).digest('hex'), 'x-razorpay-event-id': 'EvtAbc125' }), null, 'a genuine event billing does not use');
  assert.throws(() => new RazorpayPartner(fetch, { ...RAZORPAY, planId: 'x' }), { code: 'SERVER_MISCONFIGURED' });
});

test('a captured Razorpay body sent again under a new event id header changes nothing; an old one is refused', { skip: pgSkip }, async () => {
  let at = new Date('2026-10-14T10:00:00.000Z');
  const created = { id: 'sub_00000000000001', entity: 'subscription', plan_id: RAZORPAY.planId, status: 'created', total_count: 120, short_url: 'https://rzp.io/i/AbCdEf', notes: {} };
  const { fetch } = recordingFetch([{ status: 200, body: JSON.stringify(created) }]);
  const t = await setup({ partner: new RazorpayPartner(fetch, RAZORPAY, () => at) });
  const token = await t.signIn();
  assert.equal((await t.call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }, token)).status, 200);
  const signed = (event: string, createdAt: Date, headerId: string) => {
    const body = Buffer.from(JSON.stringify({ entity: 'event', account_id: 'acc_Synthetic0001', event, contains: ['subscription'],
      payload: { subscription: { entity: { id: 'sub_00000000000001', entity: 'subscription', plan_id: RAZORPAY.planId, status: 'active', current_end: Math.floor(createdAt.getTime() / 1000) + 30 * 86400 } } },
      created_at: Math.floor(createdAt.getTime() / 1000) }));
    return { body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': createHmac('sha256', RAZORPAY.webhookSecret).update(body).digest('hex'), 'x-razorpay-event-id': headerId } };
  };
  const status = async () => (await t.call('GET', '/v1/billing/subscription', undefined, token)).body.status;
  const activated = signed('subscription.activated', at, 'EvtFirst001');
  assert.equal((await t.send('razorpay', activated.body, activated.headers)).status, 200);
  assert.equal(await status(), 'active');
  at = new Date(at.getTime() + 3600000);
  const cancelled = signed('subscription.cancelled', at, 'EvtSecond02');
  assert.equal((await t.send('razorpay', cancelled.body, cancelled.headers)).status, 200);
  assert.equal(await status(), 'cancelled');
  // The captured activation, replayed under a fresh header id (or none), is the same event and is not applied again.
  for (const headerId of ['EvtReplay01', 'EvtReplay02']) assert.equal((await t.send('razorpay', activated.body, { ...activated.headers, 'x-razorpay-event-id': headerId })).status, 200);
  const { 'x-razorpay-event-id': _dropped, ...headerless } = activated.headers;
  assert.equal((await t.send('razorpay', activated.body, headerless)).status, 200);
  assert.equal(await status(), 'cancelled');
  assert.equal((await t.sql.query('SELECT count(*)::int AS n FROM billing_events')).rows[0].n, 2);
  // Days later the same captured body is refused outright.
  at = new Date(at.getTime() + 3 * DAY);
  const late = await t.send('razorpay', activated.body, { ...activated.headers, 'x-razorpay-event-id': 'EvtReplay03' });
  assert.equal(late.status, 400); assert.equal(code(late), 'WEBHOOK_STALE');
  assert.equal(await status(), 'cancelled');
});

test('the billing configuration validates money and picks the partner', async () => {
  const none = billingConfig({}, refusingFetch);
  assert.ok(none.partner instanceof UnconfiguredPaymentPartner);
  await assert.rejects(none.partner.createCheckout({ accountId: 'acct_1', plan: 'paid', idempotencyKey: 'key-0123456789abcdef' }), { code: 'PAYMENT_PARTNER_NOT_CONFIGURED', status: 503 });
  await assert.rejects(none.partner.cancel('sub_1'), { code: 'PAYMENT_PARTNER_NOT_CONFIGURED' });
  assert.deepEqual(none.config, { paidPricePaise: null, backupQuotaBytes: 2147483648, backupKeep: 14, allowanceMonthlyPaise: null, graceMs: 7 * DAY } satisfies BillingConfig);
  assert.throws(() => billingConfig({ ALLOWANCE_MONTHLY_PAISE: '0' }, refusingFetch), { code: 'SERVER_MISCONFIGURED' });
  assert.equal(paidEntitlements(none.config).allowance, false);
  assert.equal(billingConfig({ BILLING_PAID_PRICE_PAISE: '99999999999999' }, refusingFetch).config.paidPricePaise, '99999999999999');
  for (const env of [{ BILLING_PAID_PRICE_PAISE: '499.00' }, { BILLING_PAID_PRICE_PAISE: '0' }, { BILLING_PAID_PRICE_PAISE: '-1' }, { BILLING_PAID_PRICE_PAISE: '1e5' },
    { BILLING_PAID_PRICE_PAISE: '0499' }, { ALLOWANCE_MONTHLY_PAISE: '10.5' }, { BACKUP_QUOTA_BYTES: '2GiB' }, { BACKUP_QUOTA_BYTES: '99999999999999999' }, { RAZORPAY_KEY_ID: RAZORPAY.keyId }])
    assert.throws(() => billingConfig(env, refusingFetch), { code: 'SERVER_MISCONFIGURED' }, JSON.stringify(env));
  const live = billingConfig({ RAZORPAY_KEY_ID: RAZORPAY.keyId, RAZORPAY_KEY_SECRET: RAZORPAY.keySecret, RAZORPAY_WEBHOOK_SECRET: RAZORPAY.webhookSecret, RAZORPAY_PLAN_ID: RAZORPAY.planId }, refusingFetch);
  assert.ok(live.partner instanceof RazorpayPartner); assert.equal(live.partner.id, 'razorpay');
});
