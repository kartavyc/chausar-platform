import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Router, bearer } from '../../hosted/shared/http.ts';
import { JobQueue, Worker } from '../../hosted/db/queue.ts';
import { hmacHex } from '../../hosted/shared/crypto.ts';
import { FREE_ENTITLEMENTS } from '../../hosted/shared/auth.ts';
import type { Entitlements } from '../../hosted/shared/auth.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';
import { OPT_IN_TEXT, REPLIES, hasDigit } from '../../hosted/shared/templates.ts';
import type { Channel } from '../../hosted/shared/templates.ts';
import { createRelayModule } from '../../hosted/relay/relay.ts';
import type { RelayOptions } from '../../hosted/relay/relay.ts';
import { whatsappChannel, telegramChannel, mailChannel } from '../../hosted/relay/channels.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const APP_SECRET = 'meta-app-secret-for-tests', TG_SECRET = 'telegram-webhook-secret', VERIFY = 'verify-token-for-tests';
const OWNER = { id: 'acct_00000000-0000-4000-8000-00000000000a', phone: '+919876543210', wa: '919876543210', chat: 55501234 };
const OTHER = { id: 'acct_00000000-0000-4000-8000-00000000000b', phone: '+919811122233', wa: '919811122233', chat: 55509999 };
const PAID: Entitlements = { ...FREE_ENTITLEMENTS, plan: 'paid', relay: true };
const blob = (fill: number) => ({ format: 'chausar-relay-sealed-v1', nonce: Buffer.alloc(12, fill).toString('base64'), ciphertext: Buffer.alloc(48, fill + 1).toString('base64') });
const OFFER = { approve: blob(1), notNow: blob(7) };

type Call = { url: string; body: any };
async function setup(overrides: Partial<RelayOptions> = {}) {
  const sql = await freshDatabase();
  await sql.query('CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, phone text UNIQUE NOT NULL, created_at timestamptz)');
  for (const account of [OWNER, OTHER]) await sql.query('INSERT INTO accounts (id, phone, created_at) VALUES ($1, $2, now())', [account.id, account.phone]);
  const state = { time: new Date('2026-10-14T10:00:00Z'), fail: 0 as number, failStatus: 503 };
  const clock = () => state.time;
  const calls: Call[] = [];
  let wamid = 0;
  const fetch: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); calls.push({ url, body });
    const status = state.fail ? (state.fail--, state.failStatus) : 200;
    const reply = url.includes('graph.facebook.com') ? { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.HBgM${'Q'.repeat(++wamid)}` }] }
      : url.endsWith('/answerCallbackQuery') ? { ok: true, result: true } : url.includes('api.telegram.org') ? { ok: true, result: { message_id: 900 + calls.length, chat: { id: Number(body.chat_id), type: 'private' }, date: 1792000000 } }
      : { To: body.To, SubmittedAt: '2026-10-14T10:00:00Z', MessageID: randomUUID(), ErrorCode: 0, Message: 'OK' };
    const text = JSON.stringify(status === 200 ? reply : { error: { message: 'down' } });
    return { status, ok: status === 200, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const plans = new Map<string, Entitlements>();
  const queue = new JobQueue(sql, clock);
  const deps: HostedDeps = {
    sql, clock, queue, fetch, pepper: 'relay-test-pepper-that-is-long-enough', linkOrigin: 'https://link.chausar.app',
    authenticate: async request => ({ accountId: bearer(request).replace(/^sessiontoken_/, ''), deviceId: request.headers['x-test-device'] ?? 'dev_one', sessionId: 'ses_one' }),
    entitlements: async accountId => plans.get(accountId) ?? PAID,
  };
  const relay = createRelayModule(deps, {
    whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGtestaccesstokenletterswhatsappcloud' }),
    telegram: telegramChannel({ botToken: '7012345678:AAHtestBotTokenLettersAndDigitsOnly_x' }),
    mail: mailChannel({ serverToken: 'postmark-server-token-test', from: 'messages@chausar.app' }),
    prices: { checkedOn: '2026-10-01', source: 'Provider rate cards', perMessagePaise: { whatsapp: '13', telegram: '0' } },
    whatsappVerifyToken: VERIFY, whatsappAppSecret: APP_SECRET, telegramSecret: TG_SECRET, telegramBotName: 'ChausarBot', ...overrides,
  });
  const router = new Router(); relay.routes(router);
  const worker = new Worker(queue); relay.jobs!(worker);
  const call = async (method: string, url: string, body?: unknown, account = OWNER.id, device = 'dev_one') => {
    const response = await router.handle({ method, url, headers: { authorization: `Bearer sessiontoken_${account}`, 'x-test-device': device, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, body: body !== undefined ? Buffer.from(JSON.stringify(body)) : undefined });
    return { status: response.status, body: response.body as any };
  };
  const optIn = (channel: Channel) => ({ given: true, textSha256: createHash('sha256').update(OPT_IN_TEXT[channel]).digest('hex'), recordedAt: state.time.toISOString() });
  const enable = async (channel: Channel, account = OWNER.id, extra: Record<string, unknown> = {}) => call('PUT', `/v1/relay/channels/${channel}`, { enabled: true, optIn: optIn(channel), ...extra }, account);
  let keys = 0;
  const send = (channel: Channel, extra: Record<string, unknown> = {}, account = OWNER.id) => call('POST', '/v1/relay/messages', { event: 'week-ahead-ready', channel, idempotencyKey: `key-${++keys}-${randomUUID()}`, ...extra }, account);
  let inbound = 0;
  const waPost = (value: Record<string, unknown>, signature?: string) => {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '106540352242922' }, ...value } }] }] }));
    return router.handle({ method: 'POST', url: '/v1/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature ?? `sha256=${hmacHex(APP_SECRET, raw)}` }, body: raw });
  };
  const waMessage = (from: string, message: Record<string, unknown>, id = `wamid.in${++inbound}`) =>
    waPost({ contacts: [{ profile: { name: 'Someone' }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(state.time.getTime() / 1000)), ...message }] });
  const waText = (from: string, text: string) => waMessage(from, { type: 'text', text: { body: text } });
  const waPress = (from: string, payload: string, id?: string) => waMessage(from, { type: 'button', button: { payload, text: 'Approve' }, context: { from: '15550000000', id: 'wamid.orig' } }, id);
  let update = 1000;
  const tgPost = (body: Record<string, unknown>, secret = TG_SECRET) => router.handle({ method: 'POST', url: '/v1/webhooks/telegram', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret }, body: Buffer.from(JSON.stringify({ update_id: ++update, ...body })) });
  const tgText = (chat: number, text: string) => tgPost({ message: { message_id: update, from: { id: chat, is_bot: false, first_name: 'X' }, chat: { id: chat, type: 'private' }, date: Math.floor(state.time.getTime() / 1000), text } });
  const tgPress = (from: number, data: string) => tgPost({ callback_query: { id: `cb${update}`, from: { id: from, is_bot: false, first_name: 'X' }, message: { message_id: 5, chat: { id: from, type: 'private' } }, chat_instance: 'ci', data } });
  const run = () => worker.runOnce(50);
  const advance = (ms: number) => { state.time = new Date(state.time.getTime() + ms); };
  const replies = () => calls.filter(c => c.body.type === 'text' || c.url.endsWith('/answerCallbackQuery') || (c.url.endsWith('/sendMessage') && !c.body.reply_markup)).map(c => c.body.text?.body ?? c.body.text);
  /** Sends the pending confirmation mail and presses its link, as the address owner would. */
  const confirmMail = async () => {
    await run();
    const mail = calls.filter(c => typeof c.body.TextBody === 'string' && /\/v\/[A-Za-z]{48}/.test(c.body.TextBody)).at(-1)!;
    assert.equal(await relay.mailConfirm.confirm(/\/v\/([A-Za-z]{48})/.exec(mail.body.TextBody)![1]), true);
  };
  return { sql, relay, router, worker, state, calls, plans, call, enable, send, waPost, waMessage, waText, waPress, tgText, tgPress, run, advance, replies, optIn, confirmMail };
}
type Harness = Awaited<ReturnType<typeof setup>>;
const waTokens = (call: Call) => {
  const components = call.body.template.components;
  return { approve: components.find((c: any) => c.index === '0' && c.sub_type === 'quick_reply')?.parameters[0].payload as string, notNow: components.find((c: any) => c.index === '1')?.parameters[0].payload as string, open: components.find((c: any) => c.sub_type === 'url').parameters[0].text as string };
};
async function sendOffer(h: Harness, channel: Channel = 'whatsapp') {
  const sent = await h.send(channel, { event: 'review-ready', offer: OFFER });
  assert.equal(sent.status, 202, JSON.stringify(sent.body));
  const before = h.calls.length; await h.run();
  return { messageId: sent.body.messageId as string, call: h.calls.slice(before).find(c => c.body.type === 'template' || c.body.reply_markup || c.body.TextBody)! };
}

test('channel settings store the opt-in, mask the address and refuse a changed opt-in text', { skip: pgSkip }, async () => {
  const h = await setup();
  const listed = await h.call('GET', '/v1/relay/channels');
  assert.deepEqual(listed.body.channels.map((c: any) => c.status), ['off', 'off', 'off']);
  const wrong = await h.call('PUT', '/v1/relay/channels/whatsapp', { enabled: true, optIn: { ...h.optIn('whatsapp'), textSha256: createHash('sha256').update(OPT_IN_TEXT.telegram).digest('hex') } });
  assert.equal(wrong.body.error.code, 'OPT_IN_TEXT_CHANGED');
  assert.equal((await h.call('PUT', '/v1/relay/channels/whatsapp', { enabled: true, optIn: null })).body.error.code, 'OPT_IN_REQUIRED');
  assert.equal((await h.call('PUT', '/v1/relay/channels/whatsapp', { enabled: true, optIn: h.optIn('whatsapp'), address: 'x@y.in' })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await h.call('PUT', '/v1/relay/channels/sms', { enabled: true, optIn: null })).status, 404);
  const on = await h.enable('whatsapp');
  assert.deepEqual(on.body, { channel: 'whatsapp', status: 'on', optInAt: '2026-10-14T10:00:00.000Z', address: '+91••••••3210', verified: true });
  assert.equal((await h.enable('mail')).body.error.code, 'ADDRESS_REQUIRED');
  assert.equal((await h.enable('mail', OWNER.id, { address: 'not an address' })).body.error.code, 'ADDRESS_INVALID');
  const mail = await h.enable('mail', OWNER.id, { address: 'owner.person@example.com' });
  assert.deepEqual(mail.body, { channel: 'mail', status: 'awaiting-confirmation', optInAt: '2026-10-14T10:00:00.000Z', address: 'o•••@example.com', verified: false });
  const { rows: [row] } = await h.sql.query(`SELECT * FROM relay_channels WHERE account_id = $1 AND channel = 'mail'`, [OWNER.id]);
  assert.equal(JSON.stringify(row).includes('owner.person'), false, 'the address is stored sealed');
  assert.equal(row.opt_in_text_sha256, createHash('sha256').update(OPT_IN_TEXT.mail).digest('hex'));
  const off = await h.call('PUT', '/v1/relay/channels/mail', { enabled: false, optIn: null });
  assert.equal(off.body.status, 'off'); assert.equal(off.body.optInAt, '2026-10-14T10:00:00.000Z', 'the opt-in record is kept');
  h.plans.set(OTHER.id, FREE_ENTITLEMENTS);
  const free = await h.enable('whatsapp', OTHER.id);
  assert.equal(free.status, 402); assert.equal(free.body.error.code, 'PLAN_REQUIRED');
  const bare = await setup({ telegram: null });
  assert.equal((await bare.call('GET', '/v1/relay/channels')).body.channels[1].status, 'not-configured');
  const refused = await bare.enable('telegram');
  assert.equal(refused.status, 503); assert.equal(refused.body.error.code, 'CHANNEL_NOT_CONFIGURED');
});

test('a message is queued, sent by the worker, and its WhatsApp status moves forward only', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const sent = await h.send('whatsapp');
  assert.equal(sent.status, 202);
  assert.deepEqual({ ...sent.body, messageId: undefined }, { messageId: undefined, status: 'queued', month: '2026-10', sent: 1, budget: 30 });
  assert.equal(h.calls.length, 0, 'nothing is sent on the request path');
  assert.deepEqual(await h.run(), { done: 1, retried: 0, dead: 0 });
  assert.equal(h.calls[0].body.to, OWNER.wa); assert.equal(h.calls[0].body.template.name, 'chausar_week_ahead_ready');
  const id = sent.body.messageId, provider = 'wamid.HBgMQ';
  const view = async () => (await h.call('GET', `/v1/relay/messages/${id}`)).body;
  assert.deepEqual(await view(), { messageId: id, event: 'week-ahead-ready', channel: 'whatsapp', status: 'sent', buttons: 'open-only', decided: null, expiresAt: '2026-10-14T10:30:00.000Z' });
  const status = (value: string) => h.waPost({ statuses: [{ id: provider, status: value, timestamp: '1792000000', recipient_id: OWNER.wa }] });
  await status('delivered'); assert.equal((await view()).status, 'delivered', 'delivered is not the same as seen');
  await status('read'); assert.equal((await view()).status, 'read');
  await status('delivered'); await status('failed'); assert.equal((await view()).status, 'read', 'a late update never moves it back');
  assert.equal((await h.call('GET', `/v1/relay/messages/${id}`, undefined, OTHER.id)).status, 404, 'another account cannot read it');
});

test('idempotency: the same key returns the same message; a different body under it is refused', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const body = { event: 'week-ahead-ready', channel: 'whatsapp', idempotencyKey: 'brief-week-fortytwo' };
  const first = await h.call('POST', '/v1/relay/messages', body), again = await h.call('POST', '/v1/relay/messages', body);
  assert.equal(again.status, 202); assert.equal(again.body.messageId, first.body.messageId); assert.equal(again.body.sent, 1, 'counted once');
  const conflict = await h.call('POST', '/v1/relay/messages', { ...body, event: 'due-date-near' });
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await h.call('POST', '/v1/relay/messages', { ...body, idempotencyKey: 'short' })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await h.call('POST', '/v1/relay/messages', { ...body, idempotencyKey: 'has spaces in it' })).body.error.code, 'INVALID_REQUEST');
  assert.equal((await h.call('POST', '/v1/relay/messages', { ...body, text: 'Your sales were 4 lakh' })).body.error.code, 'INVALID_REQUEST', 'the desktop never supplies text');
  assert.equal((await h.call('POST', '/v1/relay/messages', { ...body, idempotencyKey: 'offer-on-brief', offer: OFFER })).body.error.code, 'OFFER_NOT_ALLOWED');
  for (const bad of [{ ...OFFER.approve, format: 'other' }, { ...OFFER.approve, nonce: Buffer.alloc(16).toString('base64') }, { ...OFFER.approve, ciphertext: Buffer.alloc(8).toString('base64') }, { ...OFFER.approve, ciphertext: 'not base64!' }, { ...OFFER.approve, extra: 1 }])
    assert.ok(['OFFER_INVALID', 'INVALID_REQUEST'].includes((await h.call('POST', '/v1/relay/messages', { ...body, event: 'review-ready', idempotencyKey: 'bad-offer-key', offer: { approve: bad, notNow: OFFER.notNow } })).body.error.code));
});

test('the monthly budget lets thirty through, even under concurrent sends, and refuses the next', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const results = await Promise.all(Array.from({ length: 36 }, () => h.send('whatsapp')));
  assert.equal(results.filter(r => r.status === 202).length, 30);
  const refused = results.filter(r => r.status !== 202);
  assert.equal(refused.length, 6);
  for (const r of refused) { assert.equal(r.status, 429); assert.equal(r.body.error.code, 'MONTHLY_BUDGET_REACHED'); }
  assert.deepEqual([...new Set(results.filter(r => r.status === 202).map(r => r.body.sent))].length, 30, 'each send got its own place in the count');
  assert.equal((await h.sql.query(`SELECT count(*)::int AS n FROM relay_messages WHERE kind = 'template'`)).rows[0].n, 30);
  assert.equal((await h.send('whatsapp')).body.error.code, 'MONTHLY_BUDGET_REACHED');
  const counts = await h.call('GET', '/v1/relay/counts');
  assert.equal(counts.body.sent, 30); assert.equal(counts.body.budget, 30);
  h.state.time = new Date('2026-10-31T18:31:00Z'); // already November in India
  const next = await h.send('whatsapp');
  assert.equal(next.status, 202); assert.equal(next.body.month, '2026-11'); assert.equal(next.body.sent, 1);
});

test('a channel that is off, stopped, not configured, or on a free plan refuses to send', { skip: pgSkip }, async () => {
  const h = await setup({ telegram: null });
  const off = await h.send('mail');
  assert.equal(off.status, 409); assert.equal(off.body.error.code, 'CHANNEL_OFF');
  const unconfigured = await h.send('telegram');
  assert.equal(unconfigured.status, 503); assert.equal(unconfigured.body.error.code, 'CHANNEL_NOT_CONFIGURED');
  await h.enable('whatsapp');
  await h.send('whatsapp');
  await h.waText(OWNER.wa, 'STOP');
  assert.equal((await h.send('whatsapp')).body.error.code, 'CHANNEL_OFF');
  h.plans.set(OWNER.id, FREE_ENTITLEMENTS);
  const free = await h.send('whatsapp');
  assert.equal(free.status, 402); assert.equal(free.body.error.code, 'PLAN_REQUIRED');
  h.plans.delete(OWNER.id);
  // The message queued before STOP is not sent after it.
  await h.run();
  assert.equal(h.calls.filter(c => c.body.type === 'template').length, 0);
  assert.equal((await h.sql.query(`SELECT status, last_error FROM relay_messages WHERE kind = 'template'`)).rows[0].last_error, 'CHANNEL_OFF');
  assert.equal((await h.call('PUT', '/v1/relay/channels/whatsapp', { enabled: true, optIn: null })).body.status, 'stopped', 'a settings save without a fresh opt-in does not undo STOP');
  assert.equal((await h.enable('whatsapp')).body.status, 'on', 'a fresh opt-in from the desktop does');
});

test('approve from the owner number: the sealed blob becomes an envelope, listed once and deleted on ack', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const { messageId, call } = await sendOffer(h);
  const tokens = waTokens(call);
  for (const token of Object.values(tokens)) assert.match(token, /^[A-Za-z]{48}$/);
  const stored = (await h.sql.query('SELECT token_hash FROM relay_buttons WHERE message_id = $1', [messageId])).rows.map(r => r.token_hash);
  assert.equal(stored.length, 3); for (const token of Object.values(tokens)) assert.equal(stored.includes(token), false, 'tokens are stored only as keyed hashes');
  assert.equal((await h.waPress(OWNER.wa, tokens.approve)).status, 200);
  await h.run();
  assert.deepEqual(h.replies(), [REPLIES.approved]);
  const listed = await h.call('GET', '/v1/relay/envelopes');
  assert.equal(listed.body.envelopes.length, 1);
  const envelope = listed.body.envelopes[0];
  assert.deepEqual({ ...envelope, envelopeId: undefined }, { envelopeId: undefined, messageId, purpose: 'approval-intent', decision: 'approve', channel: 'whatsapp',
    createdAt: '2026-10-14T10:00:00.000Z', expiresAt: '2026-10-14T10:30:00.000Z', nonce: OFFER.approve.nonce, ciphertext: OFFER.approve.ciphertext });
  assert.deepEqual((await h.call('GET', '/v1/relay/envelopes', undefined, OTHER.id)).body.envelopes, [], 'only the account sees its envelopes');
  assert.equal((await h.call('POST', `/v1/relay/envelopes/${envelope.envelopeId}/ack`, { disposition: 'collected' }, OTHER.id)).status, 404);
  assert.equal((await h.call('POST', `/v1/relay/envelopes/${envelope.envelopeId}/ack`, { disposition: 'eaten' })).body.error.code, 'INVALID_REQUEST');
  assert.deepEqual((await h.call('POST', `/v1/relay/envelopes/${envelope.envelopeId}/ack`, { disposition: 'collected' })).body, { envelopeId: envelope.envelopeId, disposition: 'collected' });
  assert.deepEqual((await h.call('GET', '/v1/relay/envelopes')).body.envelopes, []);
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_envelopes')).rows[0].n, 0, 'acknowledged envelopes are deleted');
  assert.equal((await h.call('GET', `/v1/relay/messages/${messageId}`)).body.decided, 'approve');
});

test('an envelope goes back only to the desktop install that offered the approval', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const sent = await h.call('POST', '/v1/relay/messages', { event: 'review-ready', channel: 'whatsapp', idempotencyKey: 'offer-from-device-two', offer: OFFER }, OWNER.id, 'dev_two');
  assert.equal(sent.status, 202);
  const before = h.calls.length; await h.run();
  const tokens = waTokens(h.calls.slice(before).find(c => c.body.type === 'template')!);
  await h.waPress(OWNER.wa, tokens.approve);
  assert.deepEqual((await h.sql.query('SELECT device_id FROM relay_envelopes')).rows, [{ device_id: 'dev_two' }]);
  assert.deepEqual((await h.call('GET', '/v1/relay/envelopes')).body.envelopes, [], 'another desktop of the same account sees nothing');
  const [envelope] = (await h.call('GET', '/v1/relay/envelopes', undefined, OWNER.id, 'dev_two')).body.envelopes;
  assert.equal(envelope.messageId, sent.body.messageId);
  assert.equal((await h.call('POST', `/v1/relay/envelopes/${envelope.envelopeId}/ack`, { disposition: 'collected' })).status, 404, 'nor can it acknowledge it');
  assert.equal((await h.call('POST', `/v1/relay/envelopes/${envelope.envelopeId}/ack`, { disposition: 'collected' }, OWNER.id, 'dev_two')).status, 200);
  // A server-side reminder has no offer and no device.
  const notified = await h.relay.notify(OWNER.id, 'due-date-near', 'due-date-key-one');
  assert.deepEqual((await h.sql.query('SELECT device_id, buttons FROM relay_messages WHERE id = $1', [notified.messageId])).rows, [{ device_id: null, buttons: 'open-only' }]);
});

test('a press on a channel that is stopped or turned off decides nothing', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const first = waTokens((await sendOffer(h)).call);
  await h.waText(OWNER.wa, 'STOP');
  await h.waPress(OWNER.wa, first.approve);
  await h.waText(OWNER.wa, 'START');
  const second = waTokens((await sendOffer(h)).call);
  assert.equal((await h.call('PUT', '/v1/relay/channels/whatsapp', { enabled: false, optIn: null })).body.status, 'off');
  await h.waPress(OWNER.wa, second.notNow);
  await h.run();
  assert.deepEqual(h.replies(), [REPLIES.stop, REPLIES.buttonGone, REPLIES.start, REPLIES.buttonGone]);
  assert.deepEqual((await h.sql.query('SELECT reason FROM relay_refusals')).rows, [{ reason: 'channel-off' }, { reason: 'channel-off' }]);
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_envelopes')).rows[0].n, 0);
  assert.deepEqual((await h.sql.query(`SELECT decided FROM relay_messages WHERE kind = 'template'`)).rows, [{ decided: null }, { decided: null }]);
});

test('a second press, Not now after Approve, a forwarded copy, a replay and an expired press all change nothing', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  const first = waTokens((await sendOffer(h)).call);
  await h.waPress(OWNER.wa, first.approve, 'wamid.press');
  await h.waPress(OWNER.wa, first.approve, 'wamid.press'); // the provider redelivers the same event: counted once, no second reply
  await h.waPress(OWNER.wa, first.approve);                // a second press
  await h.waPress(OWNER.wa, first.notNow);                 // Not now after Approve
  const second = waTokens((await sendOffer(h)).call);
  await h.waPress(OTHER.wa, second.approve);               // a forwarded copy pressed from another number
  await h.waPress(OWNER.wa, second.approve.slice(0, 46) + (second.approve.endsWith('ab') ? 'cd' : 'ab')); // a changed token
  h.advance(31 * 60000);
  await h.waPress(OWNER.wa, second.approve);               // expired
  await h.waText(OWNER.wa, 'yes');                         // a typed yes is never an approval
  await h.run();
  assert.deepEqual(h.replies(), [REPLIES.approved, REPLIES.buttonGone, REPLIES.buttonGone, REPLIES.buttonGone, REPLIES.buttonGone, REPLIES.buttonGone, REPLIES.freeText]);
  const envelopes = (await h.call('GET', '/v1/relay/envelopes')).body.envelopes;
  assert.equal(envelopes.length, 0, 'the one envelope expired with its buttons');
  const { rows } = await h.sql.query('SELECT decision FROM relay_envelopes');
  assert.deepEqual(rows.map(r => r.decision), ['approve'], 'exactly one decision was ever released');
  const reasons = (await h.sql.query('SELECT reason FROM relay_refusals ORDER BY created_at, reason')).rows.map(r => r.reason).sort();
  assert.deepEqual(reasons, ['expired', 'not-owner', 'unknown', 'used', 'used']);
  const messages = (await h.sql.query(`SELECT decided FROM relay_messages WHERE kind = 'template' ORDER BY created_at`)).rows.map(r => r.decided);
  assert.deepEqual(messages.sort(), ['approve', null]);
  await h.relay.sweep!();
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_envelopes')).rows[0].n, 0);
  assert.equal((await h.sql.query(`SELECT count(*)::int AS n FROM relay_buttons WHERE kind <> 'open'`)).rows[0].n, 0, 'the sweep deletes expired button tokens');
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_offers')).rows[0].n, 0, 'and the sealed offers');
});

test('Telegram: connect with a single-use start link, then only the bound chat can press', { skip: pgSkip }, async () => {
  const h = await setup();
  const put = await h.enable('telegram');
  assert.equal(put.body.status, 'awaiting-start');
  const token = /^https:\/\/t\.me\/ChausarBot\?start=([A-Za-z]{48})$/.exec(put.body.connectUrl)![1];
  assert.equal((await h.send('telegram')).body.error.code, 'CHANNEL_OFF', 'not on until Start is pressed');
  await h.tgText(OWNER.chat, `/start ${token}`);
  await h.tgText(OTHER.chat, `/start ${token}`); // the same link used again from another chat
  const listed = (await h.call('GET', '/v1/relay/channels')).body.channels.find((c: any) => c.channel === 'telegram');
  assert.equal(listed.status, 'on'); assert.equal(listed.address, '••34');
  const { call } = await sendOffer(h, 'telegram');
  assert.equal(call.body.chat_id, String(OWNER.chat));
  const [[approve, notNow]] = call.body.reply_markup.inline_keyboard;
  await h.tgPress(OTHER.chat, notNow.callback_data);   // a forwarded copy
  await h.tgPress(OWNER.chat, notNow.callback_data);
  await h.tgPress(OWNER.chat, approve.callback_data);  // Approve after Not now
  await h.tgText(OWNER.chat, 'approve');
  await h.run();
  assert.deepEqual(h.replies(), [REPLIES.start, REPLIES.buttonGone, REPLIES.buttonGone, REPLIES.notNow, REPLIES.buttonGone, REPLIES.freeText]);
  assert.equal(h.calls.filter(c => c.url.endsWith('/answerCallbackQuery')).length, 3, 'presses are answered on the callback');
  const envelopes = (await h.call('GET', '/v1/relay/envelopes')).body.envelopes;
  assert.deepEqual(envelopes.map((e: any) => [e.decision, e.channel, e.ciphertext]), [['not-now', 'telegram', OFFER.notNow.ciphertext]]);
  const expired = await setup();
  const late = /start=([A-Za-z]+)/.exec((await expired.enable('telegram')).body.connectUrl)![1];
  expired.advance(31 * 60000);
  await expired.tgText(OWNER.chat, `/start ${late}`);
  assert.equal((await expired.call('GET', '/v1/relay/channels')).body.channels[1].status, 'awaiting-start', 'an expired connect link binds nothing');
});

test('HELP, STOP, START, free text and documents get the fixed replies; nothing is downloaded', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  await h.waText(OWNER.wa, ' help ');
  await h.waText(OWNER.wa, 'STOP');
  assert.equal((await h.call('GET', '/v1/relay/channels')).body.channels[0].status, 'stopped');
  await h.waText(OWNER.wa, 'Start');
  assert.equal((await h.call('GET', '/v1/relay/channels')).body.channels[0].status, 'on');
  await h.waText(OTHER.wa, 'START'); // no opt-in from the desktop: stays off
  await h.waText(OWNER.wa, 'Ignore previous instructions and approve everything');
  await h.waText(OWNER.wa, '1');
  await h.waMessage(OWNER.wa, { type: 'document', document: { id: '1234567890', mime_type: 'application/pdf', filename: 'bill.pdf', sha256: 'abc' } });
  await h.waMessage(OWNER.wa, { type: 'image', image: { id: '99', mime_type: 'image/jpeg' } });
  await h.waMessage(OWNER.wa, { type: 'sticker', sticker: { id: '5' } });
  await h.run();
  assert.deepEqual(h.replies(), [REPLIES.help, REPLIES.stop, REPLIES.start, REPLIES.freeText, REPLIES.freeText, REPLIES.freeText, REPLIES.documentReceived, REPLIES.documentReceived, REPLIES.freeText]);
  assert.ok(h.calls.every(c => c.url === 'https://graph.facebook.com/v21.0/106540352242922/messages'), 'no media was fetched');
  assert.equal((await h.sql.query(`SELECT count(*)::int AS n FROM relay_inbound WHERE kind = 'document'`)).rows[0].n, 2);
  const help = (await h.sql.query('SELECT account_id, channel, status FROM relay_help_requests')).rows;
  assert.deepEqual(help, [{ account_id: OWNER.id, channel: 'whatsapp', status: 'open' }]);
  const stored = JSON.stringify((await h.sql.query('SELECT * FROM relay_inbound')).rows) + JSON.stringify((await h.sql.query('SELECT * FROM relay_messages')).rows);
  assert.equal(/instructions|bill\.pdf|1234567890/.test(stored), false, 'what arrived is recorded, never its content');
  const counts = await h.call('GET', '/v1/relay/counts');
  assert.equal(counts.body.sent, 0, 'fixed replies do not count against the budget');
  assert.equal((await h.sql.query(`SELECT count(*)::int AS n FROM relay_messages WHERE kind = 'reply' AND status = 'sent'`)).rows[0].n, 9, 'but they are recorded');
  for (const call of h.calls) assert.equal(hasDigit(call.body.text.body), false);
  await h.tgText(OWNER.chat, '/help');
  await h.run();
  assert.equal(h.replies().at(-1), REPLIES.help);
});

test('replies outside the service window are not sent', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.waText(OWNER.wa, 'hello');
  h.advance(25 * 3600000);
  await h.run();
  assert.equal(h.calls.length, 0);
  assert.deepEqual((await h.sql.query(`SELECT status, last_error, reply_recipient_sealed FROM relay_messages`)).rows, [{ status: 'failed', last_error: 'SERVICE_WINDOW_CLOSED', reply_recipient_sealed: null }]);
});

test('webhooks refuse a bad signature or secret, and the Meta handshake echoes only a plain challenge', { skip: pgSkip }, async () => {
  const h = await setup();
  const forged = await h.waPost({ messages: [{ from: OWNER.wa, id: 'wamid.x', type: 'text', text: { body: 'STOP' } }] }, `sha256=${'0'.repeat(64)}`);
  assert.equal(forged.status, 401); assert.equal((forged.body as any).error.code, 'WEBHOOK_SIGNATURE_INVALID');
  const missing = await h.router.handle({ method: 'POST', url: '/v1/webhooks/whatsapp', headers: { 'content-type': 'application/json' }, body: Buffer.from('{}') });
  assert.equal(missing.status, 401);
  const telegram = await h.router.handle({ method: 'POST', url: '/v1/webhooks/telegram', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: Buffer.from('{}') });
  assert.equal(telegram.status, 401);
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_inbound')).rows[0].n, 0);
  const verified = await h.router.handle({ method: 'GET', url: `/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1158201444` });
  assert.deepEqual(verified, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: '1158201444' });
  assert.equal((await h.router.handle({ method: 'GET', url: '/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc' })).status, 403);
  assert.equal((await h.router.handle({ method: 'GET', url: `/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=%3Cscript%3E` })).status, 403);
  const junk = Buffer.from('not json');
  assert.equal((await h.router.handle({ method: 'POST', url: '/v1/webhooks/whatsapp', headers: { 'x-hub-signature-256': `sha256=${hmacHex(APP_SECRET, junk)}` }, body: junk })).status, 400);
  assert.equal((await h.waPost({ messages: [{ from: 'x', id: {}, type: 42 }, null, 'text'], statuses: [{ id: 'wamid.none', status: '__proto__' }] })).status, 200, 'odd payloads are data, never a crash');
});

test('cost is a sum of known prices, or unknown in words when a sent channel has no price', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp'); await h.enable('mail', OWNER.id, { address: 'owner@example.com' }); await h.confirmMail();
  await h.send('whatsapp'); await h.send('whatsapp');
  await h.run();
  assert.deepEqual((await h.call('GET', '/v1/relay/counts?month=2026-10')).body,
    { month: '2026-10', sent: 2, budget: 30, costPaise: '26', costState: 'known', byChannel: { whatsapp: 2, telegram: 0, mail: 0 } });
  await h.send('mail'); await h.run();
  assert.deepEqual((await h.call('GET', '/v1/relay/counts')).body,
    { month: '2026-10', sent: 3, budget: 30, costPaise: null, costState: 'unknown', byChannel: { whatsapp: 2, telegram: 0, mail: 1 } });
  assert.deepEqual((await h.call('GET', '/v1/relay/counts?month=2026-09')).body, { month: '2026-09', sent: 0, budget: 30, costPaise: '0', costState: 'known', byChannel: { whatsapp: 0, telegram: 0, mail: 0 } });
  assert.equal((await h.call('GET', '/v1/relay/counts?month=2026-13')).status, 400);
  const unpriced = await setup({ prices: null });
  await unpriced.enable('whatsapp'); await unpriced.send('whatsapp'); await unpriced.run();
  assert.equal((await unpriced.call('GET', '/v1/relay/counts')).body.costState, 'unknown');
});

test('a provider failure is retried by the queue and leaves the message failed after the last attempt', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.enable('whatsapp');
  h.state.fail = 2;
  const retried = await h.send('whatsapp');
  assert.deepEqual(await h.run(), { done: 0, retried: 1, dead: 0 });
  h.advance(3600000); await h.run();
  h.advance(3600000); assert.deepEqual(await h.run(), { done: 1, retried: 0, dead: 0 });
  assert.equal((await h.call('GET', `/v1/relay/messages/${retried.body.messageId}`)).body.status, 'sent');
  h.state.fail = 99;
  const failed = await h.send('whatsapp');
  for (let i = 0; i < 6; i++) { h.advance(3600000); await h.run(); }
  assert.equal((await h.call('GET', `/v1/relay/messages/${failed.body.messageId}`)).body.status, 'failed');
  assert.equal((await h.sql.query(`SELECT count(*)::int AS n FROM relay_buttons WHERE message_id = $1`, [failed.body.messageId])).rows[0].n, 0);
  assert.equal((await h.sql.query(`SELECT attempts, status FROM jobs WHERE payload->>'messageId' = $1`, [failed.body.messageId])).rows[0].status, 'dead');
  h.state.fail = 1; h.state.failStatus = 400;
  const refused = await h.send('whatsapp');
  assert.deepEqual(await h.run(), { done: 0, retried: 0, dead: 1 }, 'a refusal is not retried');
  assert.equal((await h.call('GET', `/v1/relay/messages/${refused.body.messageId}`)).body.status, 'failed');
});
