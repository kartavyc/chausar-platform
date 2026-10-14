/**
 * Delivery statuses for the business's own WhatsApp Business messages (the writeback lane's read-back), and phone.verify:
 * one Engine and the composed hosted app on a disposable PostgreSQL, joined by an in-process fetch. Synthetic secrets only.
 */
import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { buildHosted } from '../../hosted/app.ts';
import type { Fetch } from '../../hosted/shared/module.ts';
import { FakeOtpProvider } from '../../hosted/accounts/otp.ts';
import { FakePaymentPartner } from '../../hosted/billing/partner.ts';
import { whatsappChannel } from '../../hosted/relay/channels.ts';
import { hmacHex } from '../../hosted/shared/crypto.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const API = 'https://api.chausar.app', PHONE = '+919876543210', OTHER_PHONE = '+919811122233';
const OWNER_SECRET = 'synthetic-owner-app-secret', OTHER_SECRET = 'synthetic-other-app-secret';
const passphrase = 'Synthetic hosted statuses passphrase';

async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-statuses-')));
  const sql = await freshDatabase();
  let time = Date.parse('2026-10-14T06:00:00.000Z');
  const providers: Fetch = async (_url, init = {}) => {
    const body = JSON.parse(String(init.body));
    const text = JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: 'wamid.HBgMRELAY' }] });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted({ HOSTED_PEPPER: 'statuses-pepper-long-enough-for-the-server', LINK_ORIGIN: 'https://link.chausar.app', BILLING_PAID_PRICE_PAISE: '49900' },
    sql, providers, { clock: () => new Date(time), otp, partner, blobStore: null,
      relay: { whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGintegrationaccesstokenletters' }), telegram: null, mail: null, prices: null, apiOrigin: API } });
  const bridge = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const target = new URL(url); assert.equal(target.origin, API);
    const response = await app.router.handle({ method: init.method, url: target.pathname + target.search, headers: init.headers, body: init.body === undefined ? undefined : Buffer.from(init.body) });
    const raw = Buffer.from(typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
    const headers: Record<string, string> = { 'content-length': String(raw.length), 'content-type': 'application/json' };
    return { status: response.status, ok: response.status >= 200 && response.status < 300, headers: { get: name => headers[name.toLowerCase()] ?? null },
      text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock),
    modules: { 'hosted-link': { origin: API, linkOrigin: 'https://link.chausar.app', fetch: bridge, clock: () => new Date(time) } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Statuses Shop', passphrase, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  const handle = (method: string, url: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => app.router.handle({ method, url,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : Buffer.from(JSON.stringify(body)) });
  let paid = 0;
  const pay = async (token: string) => {
    const checkout = await handle('POST', '/v1/billing/checkout', { plan: 'paid', idempotencyKey: `statuses-checkout-${++paid}` }, token);
    const event = partner.webhook({ eventId: `evt_statuses_${paid}`, type: 'activated', checkoutId: (checkout.body as any).checkoutId, subscriptionRef: `sub_statuses_${paid}`, currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
    assert.equal((await app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body })).status, 200);
  };
  const pairDesktop = async () => {
    const started = await rpc('hosted.pair.start', { phone: PHONE });
    await rpc('hosted.pair.finish', { challengeId: started.challengeId, code: otp.last(), deviceName: 'Shop computer' });
    const token = (engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken as string;
    await pay(token); return token;
  };
  const otherAccount = async () => {
    const started = await handle('POST', '/v1/accounts/otp/start', { phone: OTHER_PHONE });
    const verified = await handle('POST', '/v1/accounts/otp/verify', { challengeId: (started.body as any).challengeId, code: otp.last(), deviceName: 'Other computer' });
    const token = (verified.body as any).sessionToken as string; await pay(token); return token;
  };
  /** One Meta callback to a hook, signed with the given app secret. */
  const callback = (hookUrl: string, secret: string, value: Record<string, unknown>) => {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '555000111' }, ...value } }] }] }));
    return app.router.handle({ method: 'POST', url: new URL(hookUrl).pathname, headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${hmacHex(secret, raw)}` }, body: raw });
  };
  return { engine, app, sql, rpc, handle, pairDesktop, otherAccount, callback, advance: (ms: number) => { time += ms; } };
}
const status = (id: string, value: string, reference: string | null, timestamp = '1791950000') =>
  ({ id, status: value, timestamp, recipient_id: '919800000001', ...(reference === null ? {} : { biz_opaque_callback_data: reference }) });

test('a business registers its own WhatsApp hook; signed status callbacks are kept for that account only and read back by the writeback-shaped call', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await assert.rejects(f.rpc('hosted.messageStatuses', { reference: 'CHS-0123456789ABCDEF', messageId: null }), { code: 'HOSTED_NOT_PAIRED' });
  await f.pairDesktop();
  await assert.rejects(f.rpc('hosted.businessHook.set', { appSecret: 'short' }), { code: 'APP_SECRET_INVALID' });
  const hook = await f.rpc('hosted.businessHook.set', { appSecret: OWNER_SECRET });
  assert.deepEqual(Object.keys(hook).sort(), ['hookUrl', 'verifyToken']);
  assert.match(hook.hookUrl, /^https:\/\/api\.chausar\.app\/v1\/webhooks\/whatsapp-business\/[A-Za-z]{48}$/);
  assert.match(hook.verifyToken, /^[A-Za-z]+$/);
  const path = new URL(hook.hookUrl).pathname;
  const stored = JSON.stringify((await f.sql.query('SELECT * FROM relay_business_hooks')).rows);
  assert.equal(stored.includes(OWNER_SECRET) || stored.includes(hook.verifyToken) || stored.includes(path.split('/').at(-1)!), false, 'secret sealed, tokens only as keyed hashes');

  // The Meta verify handshake for this hook only.
  const verified = await f.handle('GET', `${path}?hub.mode=subscribe&hub.verify_token=${hook.verifyToken}&hub.challenge=8812345`);
  assert.deepEqual([verified.status, verified.body], [200, '8812345']);
  assert.equal((await f.handle('GET', `${path}?hub.mode=subscribe&hub.verify_token=Wrongtoken&hub.challenge=1`)).status, 403);

  const otherToken = await f.otherAccount();
  const other = (await f.handle('PUT', '/v1/relay/business-hook', { appSecret: OTHER_SECRET }, otherToken)).body as any;
  assert.equal((await f.handle('GET', `${new URL(other.hookUrl).pathname}?hub.mode=subscribe&hub.verify_token=${hook.verifyToken}&hub.challenge=1`)).status, 403, 'one hook\'s verify token does not verify another');

  const ref = 'CHS-0123456789ABCDEF';
  // Signed with the owner's secret: statuses kept, the customer's message ignored.
  const accepted = await f.callback(hook.hookUrl, OWNER_SECRET, {
    contacts: [{ profile: { name: 'Customer Name' }, wa_id: '919800000001' }],
    messages: [{ from: '919800000001', id: 'wamid.customer', timestamp: '1791950100', type: 'text', text: { body: 'Please cancel my order of rupees 4500' } }],
    statuses: [status('wamid.BIZ=one', 'sent', ref, '1791950000'), status('wamid.BIZ=one', 'delivered', ref, '1791950050'), status('wamid.BIZ=one', 'delivered', ref, '1791950050'),
      status('wamid.BIZ=two', 'read', null), status('wamid.BIZ=three', 'read', 'has spaces in it'), status('wamid.BIZ=four', 'seen', ref), { id: '<script>', status: 'sent', biz_opaque_callback_data: ref }] });
  assert.equal(accepted.status, 200);
  // The wrong signature, an unknown hook, and one account's secret on another's hook are all refused.
  assert.equal((await f.callback(hook.hookUrl, OTHER_SECRET, { statuses: [status('wamid.FORGED', 'read', ref)] })).status, 401);
  assert.equal((await f.callback(`${API}/v1/webhooks/whatsapp-business/${'Q'.repeat(48)}`, OWNER_SECRET, { statuses: [status('wamid.FORGED', 'read', ref)] })).status, 401);
  const unsigned = await f.handle('POST', path, { entry: [] });
  assert.equal(unsigned.status, 401);
  // The other account's hook, with its own secret and the same reference, stores under the other account.
  assert.equal((await f.callback(other.hookUrl, OTHER_SECRET, { statuses: [status('wamid.OTHER', 'delivered', ref)] })).status, 200);

  // The writeback lane's call: host.call('hosted.messageStatuses', { reference, messageId }).
  const mine = await f.engine.requestAs(owner, 'hosted.messageStatuses', { reference: ref, messageId: null });
  assert.deepEqual(mine, [
    { messageId: 'wamid.BIZ=one', status: 'sent', at: '2026-10-14T03:53:20.000Z', reference: ref },
    { messageId: 'wamid.BIZ=one', status: 'delivered', at: '2026-10-14T03:54:10.000Z', reference: ref }]);
  assert.deepEqual(await f.rpc('hosted.messageStatuses', { reference: 'CHS-NOTHINGHERE', messageId: 'wamid.BIZ=one' }), mine, 'found by message id too');
  const theirs = (await f.handle('GET', `/v1/relay/business-statuses?reference=${ref}`, undefined, otherToken)).body as any;
  assert.deepEqual(theirs.statuses.map((s: any) => s.messageId), ['wamid.OTHER'], 'each account lists only its own');
  await assert.rejects(f.rpc('hosted.messageStatuses', { reference: ref }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.rpc('hosted.messageStatuses', { reference: ref, messageId: null, extra: 1 }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.rpc('hosted.messageStatuses', { reference: 'has spaces', messageId: null }), { code: 'REFERENCE_INVALID' });
  assert.equal(((await f.handle('GET', '/v1/relay/business-statuses?reference=CHS-A&other=1', undefined, otherToken)).body as any).error.code, 'INVALID_REQUEST');

  // Nothing but the status line is stored anywhere.
  for (const table of ['relay_business_statuses', 'relay_business_hooks', 'relay_inbound', 'relay_messages', 'jobs']) {
    const dump = JSON.stringify((await f.sql.query(`SELECT * FROM ${table}`)).rows);
    assert.equal(/cancel|4500|Customer Name|919800000001|wamid\.customer|synthetic-owner|synthetic-other/.test(dump), false, `${table} holds no message content`);
  }
  assert.deepEqual((await f.sql.query('SELECT DISTINCT account_id FROM relay_business_statuses ORDER BY account_id')).rows.length, 2);

  // Rotating the hook stops the old URL; statuses are kept thirty days, then swept.
  const rotated = await f.rpc('hosted.businessHook.set', { appSecret: OWNER_SECRET });
  assert.notEqual(rotated.hookUrl, hook.hookUrl);
  assert.equal((await f.callback(hook.hookUrl, OWNER_SECRET, { statuses: [status('wamid.LATE', 'read', ref)] })).status, 401);
  assert.equal((await f.callback(rotated.hookUrl, OWNER_SECRET, { statuses: [status('wamid.BIZ=one', 'read', ref, '1791950090')] })).status, 200);
  assert.equal((await f.rpc('hosted.messageStatuses', { reference: ref, messageId: null })).at(-1).status, 'read');
  for (const module of f.app.modules) await module.sweep?.();
  assert.equal((await f.rpc('hosted.messageStatuses', { reference: ref, messageId: null })).length, 3, 'kept within thirty days');
  // Thirty-one days on (the received times are moved back, so the desktop session stays valid).
  await f.sql.query(`UPDATE relay_business_statuses SET received_at = received_at - interval '31 days'`);
  for (const module of f.app.modules) await module.sweep?.();
  assert.deepEqual(await f.rpc('hosted.messageStatuses', { reference: ref, messageId: null }), []);
});

test('phone.verify is true only once the relay confirmed the channel', { skip: pgSkip }, async t => {
  const f = await setup(t);
  await assert.rejects(f.rpc('phone.verify', { channel: 'whatsapp' }), { code: 'HOSTED_NOT_PAIRED' });
  await f.pairDesktop();
  await assert.rejects(f.rpc('phone.verify', { channel: 'telegram' }), { code: 'INVALID_REQUEST' });
  await assert.rejects(f.rpc('phone.verify', { channel: 'mail', extra: true }), { code: 'INVALID_REQUEST' });
  assert.deepEqual(await f.rpc('phone.verify', { channel: 'whatsapp' }), { verified: false });
  assert.deepEqual(await f.rpc('phone.verify', { channel: 'mail' }), { verified: false });
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  assert.deepEqual(await f.rpc('phone.verify', { channel: 'whatsapp' }), { verified: true }, 'on for the OTP-verified phone');
  // The account's verified phone changes: the opt-in no longer matches it.
  await f.sql.query(`UPDATE accounts SET phone = '+919811100000'`);
  assert.deepEqual(await f.rpc('phone.verify', { channel: 'whatsapp' }), { verified: false });
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: false, optIn: false });
  assert.deepEqual(await f.rpc('phone.verify', { channel: 'whatsapp' }), { verified: false });
});
