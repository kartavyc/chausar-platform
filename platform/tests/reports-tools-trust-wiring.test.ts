import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { initialState } from '../runtime/contracts.ts';
import type { Context } from '../runtime/contracts.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { modelsView } from '../runtime/trust-ext/tools-network.ts';
import { mailSeed } from '../fakes/mail/index.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// The trust screens over the merged hosted-link and writeback lanes: a synthetic hosted relay in memory,
// writeback's practice mail fake, and synthetic customers only.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const ORIGIN = 'https://relay.chausar.test';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

function reply(status: number, body: unknown): FetchReply {
  const raw = Buffer.from(JSON.stringify(body));
  const headers: Record<string, string> = { 'content-length': String(raw.length) };
  return { status, ok: status < 300, headers: { get: name => headers[name.toLowerCase()] ?? null }, text: async () => raw.toString('utf8'),
    arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
}
/** Only the hosted calls these tests make, in the shapes of hosted/API.md. */
function fakeRelay() {
  const channels: Record<string, { status: string; optInAt: string | null; address: null }> = {
    whatsapp: { status: 'off', optInAt: null, address: null }, telegram: { status: 'off', optInAt: null, address: null }, mail: { status: 'off', optInAt: null, address: null } };
  let sent = 0;
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const path = new URL(url).pathname, now = new Date().toISOString(), json = () => JSON.parse(String(init.body)); let m: RegExpExecArray | null;
    if (init.method === 'POST' && path === '/v1/accounts/otp/start') return reply(202, { challengeId: 'otp_synthetic_challenge', expiresAt: new Date(Date.now() + 600000).toISOString() });
    if (init.method === 'POST' && path === '/v1/accounts/otp/verify')
      return reply(200, { accountId: 'account_synthetic', deviceId: 'device_synthetic', sessionToken: randomBytes(32).toString('base64url'), expiresAt: new Date(Date.now() + 86400000).toISOString() });
    if (init.method === 'GET' && path === '/v1/relay/channels') return reply(200, { channels: Object.entries(channels).map(([channel, row]) => ({ channel, ...row })) });
    if (init.method === 'PUT' && (m = /^\/v1\/relay\/channels\/(whatsapp|telegram|mail)$/.exec(path))) {
      const b = json(); channels[m[1]] = { status: b.enabled ? 'on' : 'off', optInAt: b.enabled ? b.optIn.recordedAt : channels[m[1]].optInAt, address: null };
      return reply(200, { channel: m[1], ...channels[m[1]] });
    }
    if (init.method === 'POST' && path === '/v1/relay/messages') return reply(202, { messageId: `msg_synthetic_${++sent}`, status: 'queued', month: now.slice(0, 7), sent, budget: 30 });
    if (init.method === 'PUT' && (m = /^\/v1\/backups\/(bk_[0-9a-f]{32})$/.exec(path))) {
      const bytes = Buffer.from(init.body as Uint8Array); return reply(201, { backupId: m[1], sizeBytes: bytes.length, sha256: sha256(bytes), createdAt: now });
    }
    return reply(404, { error: { code: 'NOT_FOUND', message: 'Not found.' } });
  };
  return { fetch, channels };
}

async function setup(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-rtt-wiring-')));
  const relay = fakeRelay();
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules: { 'hosted-link': { origin: ORIGIN, fetch: relay.fetch } } });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Wiring Shop', passphrase: 'Synthetic trust wiring passphrase', demo: false, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload) as Promise<any>;
  return { engine, relay, rpc };
}

test('a relay message, a hosted backup and a writeback change are in the network ledger and read in plain words in the record', async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: '+919876543210' });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '246810', deviceName: 'Shop computer' });
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  await f.rpc('phone.messages.send', { event: 'week-ahead-ready', channel: 'whatsapp' });
  await f.rpc('hosted.backup.upload');

  const user = mailSeed.users[0], smtp = mailSeed.smtp[0];
  const mail = await f.rpc('writeback.connect', { system: 'mail', label: 'Practice mail', environment: 'practice', account: { smtpHost: smtp.host, smtpPort: String(smtp.port), smtpSecurity: smtp.security, from: user.address,
    imapHost: mailSeed.imap.host, imapPort: String(mailSeed.imap.port), sentFolder: 'Sent' } });
  await f.rpc('writeback.grant', { connectionId: mail.id, write: ['smtp.send'] });
  const prepared = await f.rpc('writeback.prepare', { connectionId: mail.id, action: 'smtp.send', intentId: 'wiring-1', payload: { to: ['accounts@customer.example'], subject: 'Synthetic', body: 'Synthetic body' } });
  const waiting = (await f.rpc('trustx.network', { kind: 'action' })).items;
  assert.equal(waiting.length, 1); assert.equal(waiting[0].outcome, 'waiting'); assert.match(waiting[0].why, /Waiting for your yes\.$/);
  await f.rpc('writeback.approve', { id: prepared.id, digest: prepared.digest });
  assert.equal((await f.rpc('writeback.execute', { id: prepared.id })).word, 'done');

  const network = await f.rpc('trustx.network');
  const phone = network.items.filter((i: any) => i.kind === 'phone');
  assert.equal(phone.length, 1); assert.equal(phone[0].destination, 'WhatsApp, through the Chausar relay'); assert.equal(phone[0].outcome, 'allowed');
  const backup = network.items.filter((i: any) => i.destination === 'Chausar hosted backup');
  assert.equal(backup.length, 1); assert.equal(backup[0].kind, 'sync');
  const actions = network.items.filter((i: any) => i.kind === 'action');
  assert.equal(actions.length, 1, 'writeback actions are listed once, from its ledger');
  assert.deepEqual({ id: actions[0].id, destination: actions[0].destination, outcome: actions[0].outcome, why: actions[0].why },
    { id: prepared.id, destination: 'Practice copy of Your mail server, on this computer', outcome: 'allowed', why: 'Send an email from your own mail server. Done and read back.' });
  assert.ok(!JSON.stringify(network).includes('accounts@customer.example'), 'the ledger names no recipient');

  const what = (await f.rpc('trustx.record')).items.map((i: any) => i.what);
  for (const words of ['Connected an outside system for writing', 'Changed what may be written to an outside system', 'Prepared a change in an outside system',
    'Sent a message through the Chausar relay', 'Uploaded a locked backup', 'Turned a phone channel on or off', 'Paired this computer with the Chausar relay'])
    assert.ok(what.includes(words), words);
  assert.ok(what.every((w: string) => !/^(writeback|hosted)\./.test(w)), 'every writeback and hosted event reads in words');
});

test('phone opt-ins and reminder consents are agreements, withdrawn through the lane that owns them', async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: '+919876543210' });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '246810', deviceName: 'Shop computer' });
  await f.rpc('phone.channels.set', { channel: 'telegram', enabled: true, optIn: true });
  await f.rpc('writeback.followUp.consent', { requestId: 'consent-synthetic-1', customerId: 'cust-synthetic-1', channel: 'email', destination: 'accounts@customer.example', answer: 'yes', observedOn: '2026-10-01' });

  let items = (await f.rpc('trustx.agreements')).items;
  const reminder = items.find((i: any) => i.person === 'Customer cust-synthetic-1');
  assert.deepEqual({ purpose: reminder.purpose, withdrawnAt: reminder.withdrawnAt }, { purpose: 'Receive payment reminders by mail', withdrawnAt: null });
  const telegram = items.find((i: any) => i.id === 'phone-telegram');
  assert.deepEqual({ person: telegram.person, purpose: telegram.purpose, withdrawnAt: telegram.withdrawnAt }, { person: 'The owner', purpose: 'Receive Chausar messages on Telegram', withdrawnAt: null });
  assert.ok(items.every((i: any) => Object.keys(i).sort().join() === 'at,id,person,purpose,withdrawnAt'), 'no destination or channel detail leaves the lane');

  items = (await f.rpc('trustx.withdraw', { id: reminder.id })).items;
  assert.ok(items.find((i: any) => i.id === reminder.id).withdrawnAt);
  const consents = await f.rpc('writeback.followUp.consents');
  assert.deepEqual(consents.map((c: any) => c.answer), ['yes', 'stopped']);
  await f.rpc('trustx.withdraw', { id: reminder.id }); assert.equal((await f.rpc('writeback.followUp.consents')).length, 2, 'withdrawing twice records once');

  items = (await f.rpc('trustx.withdraw', { id: 'phone-telegram' })).items;
  assert.ok(items.find((i: any) => i.id === 'phone-telegram').withdrawnAt); assert.equal(f.relay.channels.telegram.status, 'off');
});

test('voice minutes and month spend come from models-ext meters when they answer, and are not counted until then', async t => {
  const f = await setup(t);
  const models = await f.rpc('trustx.models');
  // models-ext is merged and measures voice: a fresh workspace has used none.
  assert.equal(models.voice.minutesThisMonth, 0); assert.equal(models.spendThisMonthMinor, '0');

  const state = initialState('Synthetic meters', true);
  const host = (meters: unknown): any => ({ store: { read: () => state }, services: { gateway: { listRoutes: () => [], receipts: () => [] } }, demo: true, directory: '', options: {},
    call: async (method: string) => { assert.equal(method, 'modelsx.meters'); if (meters instanceof Error) throw meters; return meters; } });
  const answered = await modelsView(owner, host({ month: { month: '2026-10', voiceMinutesMs: 2_550_000, spendMinor: '012345' } }));
  assert.equal(answered.voice.minutesThisMonth, 42.5); assert.equal(answered.spendThisMonthMinor, '12345');
  const viewer = await modelsView({ ...owner, role: 'viewer' }, host({ month: { month: '2026-10', voiceMinutesMs: 180_000, spendMinor: '500' } }));
  assert.equal(viewer.spendThisMonthMinor, null, 'spend stays with owner and cofounder');
  for (const odd of [{ month: { voiceMinutesMs: -1, spendMinor: 12 } }, { month: { voiceMinutesMs: 1.5 } }, { month: null }, null]) {
    const view = await modelsView(owner, host(odd)); assert.equal(view.voice.minutesThisMonth, null); assert.equal(view.spendThisMonthMinor, '0');
  }
  // A fault in another lane's meters never stops the Models screen: minutes stay not counted and spend is summed here.
  const faulted = await modelsView(owner, host(new TypeError('a fault in the meters')));
  assert.equal(faulted.voice.minutesThisMonth, null); assert.equal(faulted.spendThisMonthMinor, '0');
});
