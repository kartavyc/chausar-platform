import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildHosted } from '../../hosted/app.ts';
import type { Fetch } from '../../hosted/shared/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { FakePaymentPartner } from '../../hosted/billing/partner.ts';
import { telegramChannel } from '../../hosted/relay/channels.ts';
import { OPT_IN_TEXT, HEADLINES, hasDigit } from '../../hosted/shared/templates.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const ENV = { HOSTED_PEPPER: 'a-pepper-for-the-composed-app-test-only', LINK_ORIGIN: 'https://link.chausar.app', BILLING_PAID_PRICE_PAISE: '49900' };
const TG_SECRET = 'telegram-secret-for-app-test';

test('the composed server refuses a short pepper and a link origin with a digit', { skip: pgSkip }, async () => {
  const sql = await freshDatabase(), fetch: Fetch = async () => { throw new Error('no network'); };
  assert.throws(() => buildHosted({ ...ENV, HOSTED_PEPPER: 'short' }, sql, fetch), { code: 'SERVER_MISCONFIGURED' });
  assert.throws(() => buildHosted({ ...ENV, LINK_ORIGIN: 'https://link2.chausar.app' }, sql, fetch), { code: 'LINK_ORIGIN_INVALID' });
  assert.throws(() => buildHosted({ ...ENV, LINK_ORIGIN: 'http://link.chausar.app' }, sql, fetch), { code: 'LINK_ORIGIN_INVALID' });
});

test('end to end: sign in, pay, turn on Telegram, an approval button releases one sealed envelope, and a due date reminds once', { skip: pgSkip }, async () => {
  const sql = await freshDatabase();
  let time = new Date('2026-10-12T04:00:00Z');
  const sent: { url: string; body: any }[] = [];
  const fetch: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); sent.push({ url, body });
    const reply = url.endsWith('/answerCallbackQuery') ? { ok: true, result: true } : { ok: true, result: { message_id: sent.length, chat: { id: Number(body.chat_id), type: 'private' }, date: 1792000000 } };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(reply), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted(ENV, sql, fetch, { clock: () => time, otp, partner,
    relay: { whatsapp: null, mail: null, prices: null, telegram: telegramChannel({ botToken: '7000000001:AAHappTestTokenLettersOnly_abcdefghij' }), telegramSecret: TG_SECRET, telegramBotName: 'ChausarBot' } });
  let token = '';
  const call = async (method: string, url: string, body?: unknown, raw?: { body: Buffer; headers: Record<string, string | undefined> }) => {
    const headers: Record<string, string | undefined> = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(raw?.headers ?? {}) };
    const response = await app.router.handle({ method, url, headers, body: raw?.body ?? (body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined) });
    return { status: response.status, body: response.body as any };
  };
  assert.deepEqual((await call('GET', '/healthz')).body, { ok: true });
  assert.deepEqual((await call('GET', '/readyz')).body, { ok: true });

  // Sign in with a phone code.
  const started = await call('POST', '/v1/accounts/otp/start', { phone: '+919876543210' });
  assert.equal(started.status, 202);
  const verified = await call('POST', '/v1/accounts/otp/verify', { challengeId: started.body.challengeId, code: otp.last(), deviceName: 'Shop laptop' });
  assert.equal(verified.status, 200); token = verified.body.sessionToken;
  const me = await call('GET', '/v1/accounts/me');
  assert.equal(me.body.plan, 'free'); assert.equal(me.body.entitlements.relay, false);
  const optIn = { given: true, textSha256: createHash('sha256').update(OPT_IN_TEXT.telegram).digest('hex'), recordedAt: time.toISOString() };
  assert.equal((await call('PUT', '/v1/relay/channels/telegram', { enabled: true, optIn })).body.error.code, 'PLAN_REQUIRED');

  // Pay through the partner; its signed webhook turns the plan on.
  const checkout = await call('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'checkout-first-try' });
  assert.equal(checkout.status, 200, JSON.stringify(checkout.body));
  const event = partner.webhook({ eventId: 'evt_one', type: 'activated', checkoutId: checkout.body.checkoutId, subscriptionRef: 'sub_fake_one', currentPeriodEnd: '2026-11-12T04:00:00.000Z' });
  assert.equal((await call('POST', '/v1/billing/webhooks/fake', undefined, event)).status, 200);
  assert.equal((await call('GET', '/v1/accounts/me')).body.entitlements.relay, true);

  // Telegram: the person presses Start on the bot with the connect link.
  const channel = await call('PUT', '/v1/relay/channels/telegram', { enabled: true, optIn });
  assert.equal(channel.body.status, 'awaiting-start');
  const startToken = new URL(channel.body.connectUrl).searchParams.get('start')!;
  const chat = 777001;
  let updateId = 100;
  const tg = (update: Record<string, unknown>) => app.router.handle({ method: 'POST', url: '/v1/webhooks/telegram', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': TG_SECRET }, body: Buffer.from(JSON.stringify({ update_id: ++updateId, ...update })) });
  await tg({ message: { message_id: 1, from: { id: chat, is_bot: false, first_name: 'A' }, chat: { id: chat, type: 'private' }, date: 1792000000, text: `/start ${startToken}` } });
  assert.equal((await call('GET', '/v1/relay/channels')).body.channels.find((c: any) => c.channel === 'telegram').status, 'on');

  // A review message with Approve and Not now.
  const blob = (fill: number) => ({ format: 'chausar-relay-sealed-v1', nonce: Buffer.alloc(12, fill).toString('base64'), ciphertext: Buffer.alloc(40, fill).toString('base64') });
  const queued = await call('POST', '/v1/relay/messages', { event: 'review-ready', channel: 'telegram', idempotencyKey: 'review-message-one', offer: { approve: blob(3), notNow: blob(4) } });
  assert.equal(queued.status, 202, JSON.stringify(queued.body));
  await app.worker.runOnce();
  const message = sent.find(c => c.body.reply_markup)!;
  assert.equal(message.body.text.startsWith(HEADLINES['review-ready']), true);
  assert.equal(hasDigit(message.body.text), false);
  const approve = message.body.reply_markup.inline_keyboard.flat().find((b: any) => b.text === 'Approve').callback_data;
  const press = (from: number) => tg({ callback_query: { id: `cb${sent.length}`, from: { id: from, is_bot: false, first_name: 'A' }, message: { message_id: 2, chat: { id: from, type: 'private' } }, chat_instance: 'x', data: approve } });
  await press(999999); // a forwarded copy pressed by someone else does nothing
  assert.deepEqual((await call('GET', '/v1/relay/envelopes')).body.envelopes, []);
  await press(chat); await press(chat);
  const { envelopes } = (await call('GET', '/v1/relay/envelopes')).body;
  assert.equal(envelopes.length, 1); assert.equal(envelopes[0].decision, 'approve');
  assert.equal(envelopes[0].ciphertext, blob(3).ciphertext, 'the relay hands back the sealed bytes verbatim');
  assert.equal((await call('POST', `/v1/relay/envelopes/${envelopes[0].envelopeId}/ack`, { disposition: 'collected' })).status, 200);
  assert.deepEqual((await call('GET', '/v1/relay/envelopes')).body.envelopes, []);

  // The always-on worker: a due date two days out, reminded once, through the same budget and template.
  const job = await call('PUT', '/v1/worker/jobs/due-date-reminder', { enabled: true, consent: { notEndToEndEncrypted: true, recordedAt: time.toISOString() } });
  assert.equal(job.body.endToEndEncrypted, false, JSON.stringify(job.body));
  assert.equal((await call('PUT', '/v1/worker/due-dates', { dueDates: [{ id: 'gst-return', date: '2026-10-14', remindDaysBefore: 3 }] })).status, 200);
  for (const module of app.modules) await module.sweep?.();
  for (const module of app.modules) await module.sweep?.();
  await app.worker.runOnce(); await app.worker.runOnce();
  const reminders = sent.filter(c => c.body.text?.startsWith?.(HEADLINES['due-date-near']));
  assert.equal(reminders.length, 1);
  assert.equal(hasDigit(reminders[0].body.text), false);
  const counts = await call('GET', '/v1/relay/counts');
  assert.equal(counts.body.sent, 2); assert.equal(counts.body.budget, 30);
  assert.equal(counts.body.costPaise, null); assert.equal(counts.body.costState, 'unknown', 'no price table: the cost is unknown, never zero');
  time = new Date(time.getTime() + 60000);
});
