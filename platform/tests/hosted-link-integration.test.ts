/**
 * The desktop module against the real hosted services: one Engine, one composed hosted app on a disposable
 * PostgreSQL, joined by an in-process fetch. Only the outside providers (SMS, payment partner, WhatsApp) are fakes.
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
import { FileBlobStore } from '../../hosted/backup/index.ts';
import { hmacHex } from '../../hosted/shared/crypto.ts';
import { hasDigit } from '../../hosted/shared/templates.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const API = 'https://api.chausar.app', APP_SECRET = 'integration-meta-app-secret', PHONE = '+919876543210';
const passphrase = 'Synthetic hosted integration passphrase';

async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-integration-')));
  const sql = await freshDatabase();
  let time = Date.parse('2026-10-14T06:00:00.000Z');
  const outbound: { url: string; body: any }[] = [];
  const providers: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); outbound.push({ url, body });
    const text = JSON.stringify({ messaging_product: 'whatsapp', contacts: [{ input: body.to, wa_id: body.to }], messages: [{ id: `wamid.HBgM${'A'.repeat(outbound.length)}` }] });
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => text, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const otp = new FakeOtpProvider(), partner = new FakePaymentPartner();
  const app = buildHosted({ HOSTED_PEPPER: 'integration-pepper-long-enough-for-the-server', LINK_ORIGIN: 'https://link.chausar.app', BILLING_PAID_PRICE_PAISE: '49900', BACKUP_QUOTA_BYTES: String(64 * 1024 * 1024) },
    sql, providers, { clock: () => new Date(time), otp, partner, blobStore: new FileBlobStore(join(directory, 'hosted-blobs')),
      relay: { whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGintegrationaccesstokenletters' }), telegram: null, mail: null, prices: { checkedOn: '2026-10-01', source: 'Synthetic rate card', perMessagePaise: { whatsapp: '13' } }, whatsappAppSecret: APP_SECRET, whatsappVerifyToken: 'verify' } });
  // The desktop's fetch reaches the hosted router in process, exactly as bytes over HTTP would.
  const bridge = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const target = new URL(url); assert.equal(target.origin, API);
    const response = await app.router.handle({ method: init.method, url: target.pathname + target.search, headers: init.headers, body: init.body === undefined ? undefined : Buffer.from(init.body) });
    const raw = Buffer.isBuffer(response.body) ? response.body : Buffer.from(typeof response.body === 'string' ? response.body : response.body === undefined ? '' : JSON.stringify(response.body));
    const headers: Record<string, string> = { 'content-length': String(raw.length), ...(Buffer.isBuffer(response.body) ? {} : { 'content-type': 'application/json' }) };
    for (const [key, value] of Object.entries(response.headers ?? {})) headers[key.toLowerCase()] = value;
    return { status: response.status, ok: response.status >= 200 && response.status < 300, headers: { get: name => headers[name.toLowerCase()] ?? null },
      text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
  };
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main', 'restored'], t.mock),
    modules: { 'hosted-link': { origin: API, linkOrigin: 'https://link.chausar.app', fetch: bridge, clock: () => new Date(time) } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Integration Shop', passphrase, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  let inbound = 0;
  const waPress = (payload: string, from = '919876543210', id = `wamid.in${++inbound}`) => {
    const raw = Buffer.from(JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550000000', phone_number_id: '106540352242922' },
      contacts: [{ profile: { name: 'Owner' }, wa_id: from }], messages: [{ from, id, timestamp: String(Math.floor(time / 1000)), type: 'button', button: { payload, text: 'Approve' }, context: { from: '15550000000', id: 'wamid.orig' } }] } }] }] }));
    return app.router.handle({ method: 'POST', url: '/v1/webhooks/whatsapp', headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${hmacHex(APP_SECRET, raw)}` }, body: raw });
  };
  return { engine, app, sql, otp, partner, outbound, rpc, waPress, advance: (ms: number) => { time += ms; } };
}

test('the desktop pairs, pays, opts in, offers an approval and applies the phone tap once, all against the real hosted services', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: f.otp.last(), deviceName: 'Shop computer' });
  const status = await f.rpc('hosted.status');
  assert.equal(status.paired, true);
  await assert.rejects(f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true }), { code: 'PLAN_REQUIRED' });

  // The owner pays; the partner's signed webhook reaches the server.
  const accountId = (await f.sql.query('SELECT id FROM accounts')).rows[0].id;
  const checkout = await f.sql.query('SELECT checkout_id FROM billing_checkouts').catch(() => ({ rows: [] as any[] }));
  assert.equal(checkout.rows.length, 0);
  const token = (f.engine.vault!.read().extensions!['hosted-link'] as any);
  assert.ok(token, 'pairing lives in the vault');
  const pay = await f.app.router.handle({ method: 'POST', url: '/v1/billing/checkout', headers: { 'content-type': 'application/json', authorization: `Bearer ${token.pairing.sessionToken}` }, body: Buffer.from(JSON.stringify({ plan: 'paid', idempotencyKey: 'integration-checkout' })) });
  assert.equal(pay.status, 200);
  const event = f.partner.webhook({ eventId: 'evt_integration', type: 'activated', checkoutId: (pay.body as any).checkoutId, subscriptionRef: 'sub_integration', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
  assert.equal((await f.app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body })).status, 200);
  const refreshed = await f.rpc('hosted.account.refresh');
  assert.equal(refreshed.plan ?? refreshed.account?.plan, 'paid', JSON.stringify(refreshed));
  assert.equal(accountId.startsWith('acct_'), true);

  // WhatsApp on, with the desktop's own opt-in wording hash.
  await assert.rejects(f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: false }), { code: 'OPT_IN_REQUIRED' });
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  const channels = await f.rpc('phone.channels.list');
  assert.equal(JSON.stringify(channels).includes('9876543210'), false, 'the phone number is shown masked');

  // A small local change gets Approve and Not now; the relay sends a fixed template with no digit.
  const prepared = await f.rpc('actions.prepare', { payload: { invoiceId: 'inv-synthetic-1', text: 'A gentle reminder draft.' } });
  const sent = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
  assert.equal(sent.buttons, 'approve-not-now-open');
  await f.app.worker.runOnce();
  const template = f.outbound.find(c => c.body.type === 'template')!;
  assert.equal(template.body.template.name, 'chausar_review_ready');
  const components = template.body.template.components;
  for (const component of components) for (const parameter of component.parameters) assert.equal(hasDigit(parameter.payload ?? parameter.text), false);
  const approve = components.find((c: any) => c.sub_type === 'quick_reply' && c.index === '0').parameters[0].payload;

  // A forwarded copy pressed from another number does nothing; the owner's press releases one envelope.
  await f.waPress(approve, '919811122233');
  assert.deepEqual((await f.rpc('phone.relay.collect')).collected, []);
  await f.waPress(approve);
  await f.waPress(approve);
  const collected = await f.rpc('phone.relay.collect');
  assert.deepEqual(collected.collected.map((c: any) => c.outcome), ['approved']);
  const action = f.engine.vault!.read().actions.find((a: any) => a.id === prepared.id);
  assert.equal(action.status, 'approved'); assert.equal(action.attempts.length, 0, 'a phone approval never executes');
  assert.deepEqual((await f.rpc('phone.relay.collect')).collected, []);
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM relay_envelopes')).rows[0].n, 0, 'collected envelopes are gone from the relay');

  // An offer pressed after thirty minutes does nothing.
  const late = await f.rpc('actions.prepare', { payload: { invoiceId: 'inv-synthetic-2', text: 'Another draft.' } });
  await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: late.id });
  await f.app.worker.runOnce();
  const lateToken = f.outbound.filter(c => c.body.type === 'template').at(-1)!.body.template.components.find((c: any) => c.index === '0' && c.sub_type === 'quick_reply').parameters[0].payload;
  f.advance(31 * 60000);
  await f.waPress(lateToken);
  assert.deepEqual((await f.rpc('phone.relay.collect')).collected, []);
  assert.equal(f.engine.vault!.read().actions.find((a: any) => a.id === late.id).status, 'prepared');

  const counts = await f.rpc('phone.messages.counts');
  assert.equal(counts.sent, 2); assert.equal(counts.budget, 30); assert.equal(counts.costPaise, '26'); assert.equal(counts.costState, 'known');
});

test('an encrypted backup goes up blind and comes back to a file the core restore opens', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: f.otp.last(), deviceName: 'Shop computer' });
  await assert.rejects(f.rpc('hosted.backup.upload'), { code: 'PLAN_REQUIRED' });
  const session = (f.engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken;
  const pay = await f.app.router.handle({ method: 'POST', url: '/v1/billing/checkout', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: Buffer.from(JSON.stringify({ plan: 'paid', idempotencyKey: 'integration-checkout' })) });
  const event = f.partner.webhook({ eventId: 'evt_backup', type: 'activated', checkoutId: (pay.body as any).checkoutId, subscriptionRef: 'sub_backup', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
  await f.app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body });
  const uploaded = await f.rpc('hosted.backup.upload');
  const listed = await f.rpc('hosted.backup.list');
  assert.equal(listed.backups.length, 1); assert.equal(listed.backups[0].backupId, uploaded.backupId);
  const workspaceId = f.engine.vault!.read().workspace.id;
  const restored = await f.rpc('hosted.backup.restore', { backupId: uploaded.backupId });
  await f.rpc('workspace.lock');
  const opened = await f.engine.request('workspace.restore', { backupFile: restored.backupFile, passphrase, folder: 'restored' });
  assert.equal(opened.workspace.id, workspaceId);
});

test('the worker and allowance screens read the server label and state through the desktop', { skip: pgSkip }, async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: f.otp.last(), deviceName: 'Shop computer' });
  const worker = await f.rpc('hosted.worker.status');
  assert.equal(worker.endToEndEncrypted, false);
  assert.match(worker.label, /not end-to-end encrypted/);
  await assert.rejects(f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true, consent: false }), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true, consent: true }), { code: 'PLAN_REQUIRED' });
  await assert.rejects(f.rpc('hosted.worker.dueDates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }] }), { code: 'PLAN_REQUIRED' });
  const session = (f.engine.vault!.read().extensions!['hosted-link'] as any).pairing.sessionToken;
  const pay = await f.app.router.handle({ method: 'POST', url: '/v1/billing/checkout', headers: { 'content-type': 'application/json', authorization: `Bearer ${session}` }, body: Buffer.from(JSON.stringify({ plan: 'paid', idempotencyKey: 'integration-checkout' })) });
  const event = f.partner.webhook({ eventId: 'evt_worker', type: 'activated', checkoutId: (pay.body as any).checkoutId, subscriptionRef: 'sub_worker', currentPeriodEnd: '2026-11-14T06:00:00.000Z' });
  await f.app.router.handle({ method: 'POST', url: '/v1/billing/webhooks/fake', headers: event.headers, body: event.body });
  const on = await f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true, consent: true });
  assert.equal(on.enabled, true);
  await assert.rejects(f.rpc('hosted.worker.dueDates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3, amount: '100' }] }), { code: 'INVALID_REQUEST' });
  assert.equal((await f.rpc('hosted.worker.dueDates', { dueDates: [{ id: 'gst', date: '2026-10-20', remindDaysBefore: 3 }] })).stored, 1);
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM worker_due_dates')).rows[0].n, 1);
  assert.deepEqual(await f.rpc('hosted.worker.deleteData'), { deleted: true });
  assert.equal((await f.sql.query('SELECT count(*)::int AS n FROM worker_due_dates')).rows[0].n, 0);
  const allowance = await f.rpc('hosted.allowance.status');
  assert.equal(allowance.pricing ?? null, null, 'no pricing table is configured: no price is invented');
});
