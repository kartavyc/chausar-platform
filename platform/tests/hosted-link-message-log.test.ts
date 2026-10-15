/**
 * TR-09/TL-09, the log of messages whose result was lost, and mail STOP from authenticated senders only. The desktop
 * module runs against the real composed hosted app on a disposable PostgreSQL, joined by an in-process fetch that
 * can lose a request before or after the server sees it. Only the outside providers are fakes. Synthetic data only.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { HostedClient } from '../runtime/hosted-link/client.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { RECHECK_AFTER_MS, RECHECKS_PER_TICK } from '../runtime/hosted-link/message-log.ts';
import { hostedLinkModule } from '../runtime/modules/lane-hosted-link.ts';
import { buildHosted } from '../../hosted/app.ts';
import type { Fetch } from '../../hosted/shared/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { FakePaymentPartner } from '../../hosted/billing/partner.ts';
import { mailChannel, whatsappChannel } from '../../hosted/relay/channels.ts';
import { postmarkInbound } from '../../hosted/relay/mail-inbound.ts';
import { MAIL_TEXT, REPLIES } from '../../hosted/shared/templates.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const API = 'https://api.chausar.app', APP_SECRET = 'message-log-meta-app-secret', PHONE = '+919876543210';
const INBOUND = { user: 'postmark-inbound', password: 'synthetic-inbound-password' };
const OWNER_MAIL = 'owner.person@example.com';
const basic = `Basic ${Buffer.from(`${INBOUND.user}:${INBOUND.password}`).toString('base64')}`;
const receivedSpf = (envelope: string, result = 'Pass') => ({ Name: 'Received-SPF', Value: `${result} (sender SPF authorized) identity=mailfrom; client-ip=192.0.2.10; envelope-from=${envelope}` });
type Mode = 'deliver' | 'lose-request' | 'lose-reply';

async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-message-log-')));
  const sql = await freshDatabase();
  let time = Date.parse('2026-10-14T06:00:00.000Z');
  const outbound: { url: string; body: any }[] = [];
  const providers: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); outbound.push({ url, body });
    const reply = url.startsWith('https://api.postmarkapp.com/') ? { To: body.To, MessageID: randomUUID(), ErrorCode: 0, Message: 'OK' }
      : { messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.HBgM${'A'.repeat(outbound.length)}` }] };
    const text = JSON.stringify(reply);
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted({ HOSTED_PEPPER: 'message-log-pepper-long-enough-for-the-server', LINK_ORIGIN: 'https://link.chausar.app', BILLING_PAID_PRICE_PAISE: '49900' },
    sql, providers, { clock: () => new Date(time), otp, partner, blobStore: null,
      relay: { whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGmessagelogaccesstokenletters' }), telegram: null,
        mail: mailChannel({ serverToken: 'postmark-server-token-test', from: 'messages@chausar.app' }), prices: null, whatsappAppSecret: APP_SECRET, whatsappVerifyToken: 'verify',
        mailInbound: { postmark: postmarkInbound(INBOUND) } } });
  const state: { mode: Mode; relayCalls: string[] } = { mode: 'deliver', relayCalls: [] };
  // The desktop's fetch reaches the hosted router in process. A message send can be lost before the server sees it,
  // or after the server queued it (the reply never comes back).
  const bridge = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const target = new URL(url); assert.equal(target.origin, API);
    if (target.pathname.startsWith('/v1/relay/messages')) state.relayCalls.push(`${init.method} ${target.pathname.replace(/[0-9a-f]{64}$/, '<key>')}`);
    const losing = init.method === 'POST' && target.pathname === '/v1/relay/messages' ? state.mode : 'deliver';
    if (losing === 'lose-request') throw new Error('connection reset');
    const response = await app.router.handle({ method: init.method, url: target.pathname + target.search, headers: init.headers, body: init.body === undefined ? undefined : Buffer.from(init.body) });
    if (losing === 'lose-reply') throw new Error('connection reset');
    const raw = Buffer.from(typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
    const headers: Record<string, string> = { 'content-length': String(raw.length), 'content-type': 'application/json' };
    return { status: response.status, ok: response.status >= 200 && response.status < 300, headers: { get: name => headers[name.toLowerCase()] ?? null },
      text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock),
    modules: { 'hosted-link': { origin: API, linkOrigin: 'https://link.chausar.app', fetch: bridge, clock: () => new Date(time) } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Message Log Shop', passphrase: 'Synthetic message log passphrase', pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  const started = await rpc('hosted.pair.start', { phone: PHONE });
  await rpc('hosted.pair.finish', { challengeId: started.challengeId, code: otp.last(), deviceName: 'Shop computer' });
  const vault = () => engine.vault!.read().extensions!['hosted-link'] as any;
  const session = vault().pairing.sessionToken as string;
  const api = async (method: string, url: string, body?: unknown, token = session) => {
    const response = await app.router.handle({ method, url, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
    return { status: response.status, body: response.body as any };
  };
  const pay = await api('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: 'message-log-checkout' });
  const event = partner.webhook({ eventId: 'evt_message_log', type: 'activated', checkoutId: pay.body.checkoutId, subscriptionRef: 'sub_message_log', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
  await app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body });
  await rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  const relayMessages = async () => (await sql.query(`SELECT count(*)::int AS n FROM relay_messages WHERE kind = 'template'`)).rows[0].n as number;
  const tick = () => engine.withContext(owner, () => hostedLinkModule.tick!(owner, engine.moduleHost('hosted-link', owner), { awake: true, windowOpen: true, backgroundEnabled: false } as any));
  return { engine, app, sql, otp, outbound, state, rpc, api, vault, relayMessages, tick, advance: (ms: number) => { time += ms; } };
}
type Harness = Awaited<ReturnType<typeof setup>>;
/** A send whose result is lost: the bridge drops the request or the reply. */
async function lostSend(f: Harness, mode: Exclude<Mode, 'deliver'>, payload: Record<string, unknown>) {
  f.state.mode = mode;
  try { await assert.rejects(f.rpc('phone.messages.send', payload), { code: 'HOSTED_UNREACHABLE' }); } finally { f.state.mode = 'deliver'; }
  return f.vault().messages.at(-1);
}

test('a send whose reply was lost is listed as lost, and a check finds it at the relay without sending anything', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const entry = await lostSend(f, 'lose-reply', { event: 'week-ahead-ready', channel: 'whatsapp' });
  assert.equal(entry.status, 'unknown');
  assert.equal(await f.relayMessages(), 1, 'the relay did queue it');
  const log = await f.rpc('phone.messages.log', { filter: 'lost' });
  assert.equal(log.lost, 1);
  assert.deepEqual(log.messages, [{ id: entry.id, event: 'week-ahead-ready', channel: 'whatsapp', status: 'unknown', at: entry.at, buttons: 'open-only', errorCode: null, checkedAt: null }]);
  const text = JSON.stringify(await f.rpc('phone.messages.log'));
  for (const secret of [entry.idempotencyKey, f.vault().pairing.sessionToken, f.vault().relayKey]) assert.equal(text.includes(secret), false, 'no key, token or sealed blob in the log');
  await assert.rejects(f.rpc('phone.messages.log', { filter: 'some' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.rpc('phone.messages.log', { filter: 'lost', extra: 1 }), { code: 'INVALID_REQUEST' });

  const providerCalls = f.outbound.length, posts = f.state.relayCalls.filter(c => c.startsWith('POST')).length;
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'phone' }, 'phone.messages.check', { id: entry.id }), { code: 'OPEN_DESKTOP' });
  await assert.rejects(f.rpc('phone.messages.check', { id: 'message_not_here' }), { code: 'MESSAGE_NOT_IN_LOG' });
  await assert.rejects(f.rpc('phone.messages.check', {}), { code: 'INVALID_REQUEST' });
  const checked = await f.rpc('phone.messages.check', { id: entry.id });
  assert.equal(checked.status, 'queued'); assert.equal(checked.sendAgain, false); assert.equal(typeof checked.checkedAt, 'string');
  assert.equal(f.vault().messages.at(-1).messageId, (await f.sql.query('SELECT id FROM relay_messages')).rows[0].id);
  await f.app.worker.runOnce(20);
  assert.equal((await f.rpc('phone.messages.check', { id: entry.id })).status, 'sent', 'a later check copies the relay status');
  assert.equal(f.state.relayCalls.filter(c => c.startsWith('POST')).length, posts, 'a check never posts a message');
  assert.equal(f.outbound.length, providerCalls + 1, 'only the original message reached the provider, once');
  assert.equal(await f.relayMessages(), 1);
  assert.deepEqual(await f.rpc('phone.messages.log', { filter: 'lost' }), { messages: [], lost: 0 });
});

test('a send the relay never received becomes not-sent; sending again is explicit, with a new key and freshly sealed buttons', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const action = await f.rpc('actions.prepare', { payload: { invoiceId: 'inv-synthetic-1', text: 'A gentle reminder draft.' } });
  const payload = { event: 'review-ready', channel: 'whatsapp', actionId: action.id };
  const lost = await lostSend(f, 'lose-request', payload);
  assert.equal(lost.status, 'unknown'); assert.equal(lost.buttons, 'approve-not-now-open'); assert.ok(lost.pendingOffer, 'the blobs are kept for a same-key retry');
  assert.equal(await f.relayMessages(), 0);
  // A plain retry of an unknown entry reuses its key and its blobs (the relay deduplicates it); losing it again keeps it unknown.
  const again = await lostSend(f, 'lose-request', payload);
  assert.equal(again.id, lost.id); assert.equal(f.vault().messages.length, 1);

  // Right after the attempt "not received" proves nothing (the post may still be on its way): it stays unknown.
  await assert.rejects(f.rpc('phone.messages.check', { id: lost.id }), { code: 'MESSAGE_CHECK_TOO_SOON' });
  assert.equal(f.vault().messages.find((m: any) => m.id === lost.id).status, 'unknown');
  f.advance(RECHECK_AFTER_MS);
  const checked = await f.rpc('phone.messages.check', { id: lost.id });
  assert.deepEqual({ status: checked.status, sendAgain: checked.sendAgain, errorCode: checked.errorCode }, { status: 'not-sent', sendAgain: true, errorCode: null });
  const stored = f.vault().messages.find((m: any) => m.id === lost.id);
  assert.equal(stored.pendingOffer, undefined, 'the sealed blobs are dropped');
  const voided = f.vault().offers.find((o: any) => o.offerId === lost.offerId);
  assert.deepEqual({ used: voided.used, outcome: voided.outcome }, { used: true, outcome: 'not-sent' });
  assert.equal(await f.relayMessages(), 0, 'the check sent nothing');
  assert.equal((await f.rpc('phone.messages.log', { filter: 'lost' })).lost, 0, 'not-sent is settled, not lost');

  // Sending again: a new entry, a new key, a new offer; the not-sent entry is never resent with its old blobs.
  const sent = await f.rpc('phone.messages.send', payload);
  assert.equal(sent.retried, false); assert.notEqual(sent.offer.offerId, lost.offerId);
  const fresh = f.vault().messages.at(-1);
  assert.notEqual(fresh.id, lost.id); assert.notEqual(fresh.idempotencyKey, lost.idempotencyKey); assert.equal(fresh.status, 'queued');
  assert.equal(f.vault().messages.find((m: any) => m.id === lost.id).status, 'not-sent');
  const offers = (await f.sql.query('SELECT approve_ciphertext FROM relay_offers')).rows.map((r: any) => r.approve_ciphertext);
  assert.deepEqual(offers.length, 1); assert.notEqual(offers[0], lost.pendingOffer.approve.ciphertext);
  // A relay refusal is failed (lost) at once; a check confirms the relay never stored it.
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: false, optIn: false });
  await assert.rejects(f.rpc('phone.messages.send', { event: 'due-date-near', channel: 'whatsapp' }), { code: 'CHANNEL_OFF' });
  const failed = await f.rpc('phone.messages.log', { filter: 'lost' });
  assert.equal(failed.lost, 1); assert.deepEqual([failed.messages[0].status, failed.messages[0].errorCode], ['failed', 'CHANNEL_OFF']);
  assert.equal((await f.rpc('phone.messages.check', { id: failed.messages[0].id })).status, 'not-sent');
});

test('the relay lookup answers only for the caller\'s own account, and only its own MESSAGE_NOT_FOUND means never received', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const entry = await lostSend(f, 'lose-reply', { event: 'week-ahead-ready', channel: 'whatsapp' });
  const own = await f.api('GET', `/v1/relay/messages/by-key/${entry.idempotencyKey}`);
  assert.equal(own.status, 200); assert.deepEqual(Object.keys(own.body).sort(), ['messageId', 'status']); assert.equal(own.body.status, 'queued');
  assert.equal((await f.api('GET', '/v1/relay/messages/by-key/short')).body.error.code, 'INVALID_REQUEST');
  assert.equal((await f.api('GET', `/v1/relay/messages/by-key/${'b'.repeat(64)}`)).body.error.code, 'MESSAGE_NOT_FOUND');
  assert.equal((await f.app.router.handle({ method: 'GET', url: `/v1/relay/messages/by-key/${entry.idempotencyKey}`, headers: {} })).status, 401);
  // A second account cannot see the first account's message by its key.
  const start = await f.app.router.handle({ method: 'POST', url: '/v1/accounts/otp/start', headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ phone: '+919811122233' })) });
  const verified = await f.app.router.handle({ method: 'POST', url: '/v1/accounts/otp/verify', headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ challengeId: (start.body as any).challengeId, code: f.otp.last(), deviceName: 'Other computer' })) });
  const other = await f.api('GET', `/v1/relay/messages/by-key/${entry.idempotencyKey}`, undefined, (verified.body as any).sessionToken);
  assert.equal(other.status, 404); assert.equal(other.body.error.code, 'MESSAGE_NOT_FOUND');

  // The client: a 404 from a server without this route (or a proxy) is never read as "never received".
  const fake = (status: number, body: unknown) => new HostedClient({ origin: API, fetch: async () => {
    const raw = JSON.stringify(body);
    return { status, ok: status >= 200 && status < 300, headers: { get: () => null }, text: async () => raw, arrayBuffer: async () => new ArrayBuffer(0) };
  } });
  const token = 'sessiontoken_synthetic_letters';
  assert.equal(await fake(404, { error: { code: 'MESSAGE_NOT_FOUND', message: 'x' } }).messageByKey(token, 'c'.repeat(64)), null);
  await assert.rejects(fake(404, { error: { code: 'NOT_FOUND', message: 'Nothing is here.' } }).messageByKey(token, 'c'.repeat(64)), { code: 'HOSTED_REQUEST_FAILED' });
  await assert.rejects(fake(502, 'Bad gateway').messageByKey(token, 'c'.repeat(64)), { code: 'HOSTED_UNREACHABLE' });
  await assert.rejects(fake(200, { messageId: 'msg_x', status: 'lost' }).messageByKey(token, 'c'.repeat(64)), { code: 'HOSTED_REPLY_INVALID' });
  await assert.rejects(fake(200, { messageId: 'msg_x', status: 'sent', extra: 1 }).messageByKey(token, 'c'.repeat(64)), { code: 'HOSTED_REPLY_INVALID' });
  assert.deepEqual(await fake(200, { messageId: 'msg_x', status: 'delivered' }).messageByKey(token, 'c'.repeat(64)), { messageId: 'msg_x', status: 'delivered' });
  // Lookups made straight on the relay change nothing on the desktop.
  f.state.mode = 'deliver';
  const desktop = await f.rpc('phone.messages.log');
  assert.equal(desktop.messages[0].checkedAt, null);
});

test('the tick re-checks unknown entries older than a few minutes, a bounded number at a time, and never resends', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const events = ['week-ahead-ready', 'document-received', 'due-date-near'];
  const lost: any[] = [];
  for (const channel of ['whatsapp', 'telegram', 'mail']) for (const event of events) lost.push(await lostSend(f, 'lose-request', { event, channel }));
  assert.equal(lost.length, 9);
  assert.ok(lost.length > RECHECKS_PER_TICK);
  const unknown = () => f.vault().messages.filter((m: any) => m.status === 'unknown').length;
  await f.tick();
  assert.equal(unknown(), 9, 'nothing younger than the wait is checked');
  f.advance(RECHECK_AFTER_MS + 1000);
  const recent = await lostSend(f, 'lose-reply', { event: 'review-ready', channel: 'whatsapp' });
  const before = f.state.relayCalls.filter(c => c.startsWith('POST')).length;
  const first = await f.tick();
  assert.equal(unknown(), 10 - RECHECKS_PER_TICK);
  assert.deepEqual((first.find((r: any) => r.messagesChecked) as any).messagesChecked, Array(RECHECKS_PER_TICK).fill({ status: 'not-sent' }));
  await f.tick();
  assert.equal(unknown(), 1, 'the rest on the next tick; the recent one waits');
  assert.equal(f.vault().messages.find((m: any) => m.id === recent.id).status, 'unknown');
  f.advance(RECHECK_AFTER_MS + 1000);
  await f.tick();
  assert.equal(f.vault().messages.find((m: any) => m.id === recent.id).status, 'queued', 'the reply was lost, the relay had it');
  assert.equal(f.state.relayCalls.filter(c => c.startsWith('POST')).length, before, 'ticks never post a message');
  assert.equal(f.state.relayCalls.filter(c => c.startsWith('GET /v1/relay/messages/by-key/')).length, 10);
  assert.equal(f.vault().messages.every((m: any) => typeof m.checkedAt === 'string'), true);
});

test('a retry moves the wait on: neither a check nor the tick reads "not received" as not-sent until a few minutes after the last attempt', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const payload = { event: 'week-ahead-ready', channel: 'whatsapp' };
  const lost = await lostSend(f, 'lose-request', payload);
  assert.equal(lost.lastAttemptAt, lost.at);
  f.advance(RECHECK_AFTER_MS - 60_000);
  const retried = await lostSend(f, 'lose-request', payload);
  assert.equal(retried.id, lost.id); assert.ok(Date.parse(retried.lastAttemptAt) > Date.parse(lost.at), 'the retry refreshed the last attempt');
  f.advance(2 * 60_000); // past the wait counted from the first send, inside it counted from the retry
  const lookups = () => f.state.relayCalls.filter(c => c.startsWith('GET /v1/relay/messages/by-key/')).length;
  await f.tick();
  assert.equal(lookups(), 0, 'the tick waits from the last attempt');
  await assert.rejects(f.rpc('phone.messages.check', { id: lost.id }), { code: 'MESSAGE_CHECK_TOO_SOON' });
  assert.equal(lookups(), 1);
  const stored = f.vault().messages.find((m: any) => m.id === lost.id);
  assert.deepEqual([stored.status, stored.checkedAt], ['unknown', undefined], 'a too-soon check records nothing');
  // The relay already has it (the reply of the retry was lost): a check right away says so, the wait does not apply.
  const delivered = await lostSend(f, 'lose-reply', { event: 'due-date-near', channel: 'whatsapp' });
  assert.equal((await f.rpc('phone.messages.check', { id: delivered.id })).status, 'queued');
  f.advance(RECHECK_AFTER_MS);
  const checked = await f.rpc('phone.messages.check', { id: lost.id });
  assert.deepEqual([checked.status, checked.sendAgain], ['not-sent', true]);
});

test('entries keep the account they were sent under: after pairing with another account they are never looked up or made not-sent', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const payload = { event: 'week-ahead-ready', channel: 'whatsapp' };
  const lost = await lostSend(f, 'lose-reply', payload);
  const firstAccount = f.vault().pairing.accountId;
  assert.equal(lost.accountId, firstAccount);
  await f.rpc('hosted.unpair');
  const started = await f.rpc('hosted.pair.start', { phone: '+919811122233' });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: f.otp.last(), deviceName: 'Shop computer' });
  assert.notEqual(f.vault().pairing.accountId, firstAccount);
  f.advance(RECHECK_AFTER_MS + 1000);
  const lookups = () => f.state.relayCalls.filter(c => c.startsWith('GET /v1/relay/messages/by-key/')).length;
  await f.tick();
  assert.equal(lookups(), 0, 'the tick never asks the new account about the old one\'s key');
  let stored = f.vault().messages.find((m: any) => m.id === lost.id);
  assert.deepEqual([stored.status, stored.errorCode], ['unknown', 'MESSAGE_OTHER_PAIRING']);
  await assert.rejects(f.rpc('phone.messages.check', { id: lost.id }), { code: 'MESSAGE_OTHER_PAIRING' });
  assert.equal(lookups(), 0);
  stored = f.vault().messages.find((m: any) => m.id === lost.id);
  assert.equal(stored.status, 'unknown', 'never not-sent');
  const row = (await f.rpc('phone.messages.log')).messages.find((m: any) => m.id === lost.id);
  assert.deepEqual([row.status, row.errorCode], ['unknown', 'MESSAGE_OTHER_PAIRING']);
});

test('mail STOP acts only from an authenticated sender: a forged From changes nothing, an authenticated STOP stops mail', { skip: pgSkip }, async t => {
  const f = await setup(t);
  // The desktop turns mail on; the address is confirmed through the link page.
  assert.equal((await f.rpc('phone.channels.set', { channel: 'mail', enabled: true, optIn: true, address: OWNER_MAIL })).status, 'awaiting-confirmation');
  await f.app.worker.runOnce(20);
  const confirmation = f.outbound.filter(c => c.body.Subject === MAIL_TEXT.confirmHeadline).at(-1)!;
  const token = /\/v\/([A-Za-z]{48})/.exec(confirmation.body.TextBody)![1];
  assert.equal((await f.app.router.handle({ method: 'POST', url: `/v/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: Buffer.alloc(0) })).status, 200);
  const mailStatus = async () => (await f.rpc('phone.channels.list')).channels.find((c: any) => c.channel === 'mail').relay.status;
  assert.equal(await mailStatus(), 'on');

  let n = 0;
  const inbound = (text: string, headers: unknown[] | undefined) => f.app.router.handle({ method: 'POST', url: '/v1/webhooks/mail/postmark', headers: { 'content-type': 'application/json', authorization: basic },
    body: Buffer.from(JSON.stringify({ From: `Owner Person <${OWNER_MAIL}>`, FromFull: { Email: OWNER_MAIL, Name: 'Owner Person' }, To: 'reply@chausar.app', Subject: 'Re: The week ahead is ready.',
      TextBody: text, StrippedTextReply: text, MessageID: `inbound-${++n}-${randomUUID()}`, ...(headers === undefined ? {} : { Headers: headers }) })) });
  // Forged: no authentication, SPF failing, SPF passing for another domain, two SPF headers.
  for (const headers of [undefined, [receivedSpf(OWNER_MAIL, 'Fail')], [receivedSpf('someone@attacker.example.net')], [receivedSpf(OWNER_MAIL), receivedSpf(OWNER_MAIL)]])
    assert.equal((await inbound('STOP', headers)).status, 200);
  await f.app.worker.runOnce(20);
  assert.equal(await mailStatus(), 'on', 'a forged STOP stops nothing');
  const sent = await f.rpc('phone.messages.send', { event: 'week-ahead-ready', channel: 'mail' });
  assert.equal(sent.status, 'queued', 'mail still goes out');
  const replies = () => f.outbound.filter(c => c.body.Subject === MAIL_TEXT.replySubject).map(c => c.body.TextBody);
  assert.equal(replies().every(text => text === REPLIES.freeText), true, 'a forged STOP only gets the free-text reply');

  // Authenticated: SPF passes for the From address's own domain.
  assert.equal((await inbound('STOP', [receivedSpf(OWNER_MAIL)])).status, 200);
  await f.app.worker.runOnce(20);
  assert.equal(await mailStatus(), 'stopped');
  assert.equal(replies().at(-1), REPLIES.stop);
  await assert.rejects(f.rpc('phone.messages.send', { event: 'due-date-near', channel: 'mail' }), { code: 'CHANNEL_OFF' });
  const log = await f.rpc('phone.messages.log');
  assert.deepEqual(log.messages.map((m: any) => [m.channel, m.status, m.errorCode]), [['mail', 'failed', 'CHANNEL_OFF'], ['mail', 'queued', null]]);
});
