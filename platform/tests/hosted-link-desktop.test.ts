import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import * as desktopTemplates from '../runtime/hosted-link/templates.ts';
import * as hostedTemplates from '../../hosted/shared/templates.ts';
import { HostedClient, hostedOrigin } from '../runtime/hosted-link/client.ts';
import type { FetchReply } from '../runtime/hosted-link/client.ts';
import { newKey, openIntent, sealIntent, unwrapBackup, wrapBackup } from '../runtime/hosted-link/seal.ts';
import { AllowanceRouteClient, LABELS } from '../runtime/hosted-link/service.ts';
import { hostedLinkModule } from '../runtime/modules/lane-hosted-link.ts';
import { initialState } from '../runtime/contracts.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Synthetic only: an in-memory hosted server written to hosted/API.md, a fake clock and a local Engine.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const ORIGIN = 'https://relay.chausar.test';
const passphrase = 'Synthetic hosted link desktop passphrase';
const PHONE = '+919876543210';
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const START = Date.parse('2026-10-14T06:00:00.000Z');

type Call = { method: string; url: string; headers: Record<string, string>; body: string | Buffer | undefined };
function reply(status: number, body: unknown, headers: Record<string, string> = {}): FetchReply {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  const all: Record<string, string> = { 'content-length': String(raw.length), ...headers };
  return { status, ok: status >= 200 && status < 300, headers: { get: name => all[name.toLowerCase()] ?? null },
    text: async () => raw.toString('utf8'), arrayBuffer: async () => raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length) as ArrayBuffer };
}
const refuse = (status: number, code: string) => reply(status, { error: { code, message: 'Refused by the synthetic server with outside words 12345.' } });
const exact = (value: any, required: string[], optional: string[] = []) => !!value && typeof value === 'object' && Object.keys(value).every(k => required.includes(k) || optional.includes(k)) && required.every(k => Object.hasOwn(value, k));

/** The hosted contract, in memory. Only what the desktop calls. */
class FakeHosted {
  calls: Call[] = [];
  now: () => number;
  challenges = new Map<string, { phone: string; code: string }>();
  sessions = new Map<string, { accountId: string; deviceId: string }>();
  revoked: string[] = [];
  channels: Record<string, { status: string; optInAt: string | null; address: string | null }> = {
    whatsapp: { status: 'off', optInAt: null, address: null }, telegram: { status: 'off', optInAt: null, address: null }, mail: { status: 'off', optInAt: null, address: null } };
  channelBodies: any[] = [];
  messages = new Map<string, any>();
  keys = new Map<string, any>();
  envelopes = new Map<string, any>();
  acks: { envelopeId: string; disposition: string }[] = [];
  backups = new Map<string, { bytes: Buffer; createdAt: string }>();
  allowanceBodies: string[] = [];
  allowanceReplyText = '';
  workerBodies: any[] = [];
  /** 'drop-after' processes the request and then loses the reply. */
  network: 'ok' | 'down' | 'drop-after' = 'ok';
  #n = 0;
  constructor(now: () => number) { this.now = now; }
  id(prefix: string) { return `${prefix}_${(++this.#n).toString().padStart(8, '0')}${randomBytes(4).toString('hex')}`; }
  iso(offset = 0) { return new Date(this.now() + offset).toISOString(); }
  fetch = async (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array }): Promise<FetchReply> => {
    const body = init.body === undefined ? undefined : typeof init.body === 'string' ? init.body : Buffer.from(init.body);
    this.calls.push({ method: init.method, url, headers: { ...init.headers }, body });
    if (this.network === 'down') throw new TypeError('fetch failed');
    const result = this.route(init.method, new URL(url), init.headers, body);
    if (this.network === 'drop-after') { this.network = 'ok'; throw new TypeError('socket hang up'); }
    return result;
  };
  route(method: string, url: URL, headers: Record<string, string>, raw: string | Buffer | undefined): FetchReply {
    assert.equal(url.origin, ORIGIN);
    const path = url.pathname, json = () => JSON.parse(String(raw));
    if (method === 'POST' && path === '/v1/accounts/otp/start') {
      const b = json(); if (!exact(b, ['phone']) || !/^\+91\d{10}$/.test(b.phone)) return refuse(400, 'INVALID_REQUEST');
      const challengeId = this.id('otp'); this.challenges.set(challengeId, { phone: b.phone, code: '246810' });
      return reply(202, { challengeId, expiresAt: this.iso(600000) });
    }
    if (method === 'POST' && path === '/v1/accounts/otp/verify') {
      const b = json(); if (!exact(b, ['challengeId', 'code', 'deviceName'])) return refuse(400, 'INVALID_REQUEST');
      const challenge = this.challenges.get(b.challengeId); if (!challenge || challenge.code !== b.code) return refuse(401, 'OTP_INVALID');
      const sessionToken = randomBytes(32).toString('base64url'), deviceId = this.id('device');
      this.sessions.set(sessionToken, { accountId: 'account_synthetic', deviceId }); this.challenges.delete(b.challengeId);
      return reply(200, { accountId: 'account_synthetic', deviceId, sessionToken, expiresAt: this.iso(90 * 86400000) });
    }
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(headers.authorization ?? '');
    const session = match ? this.sessions.get(match[1]) : undefined;
    if (!session) return refuse(401, 'UNAUTHENTICATED');
    let m: RegExpExecArray | null;
    if (method === 'GET' && path === '/v1/accounts/me') return reply(200, { accountId: session.accountId, phone: '+91******3210', plan: 'paid',
      entitlements: { plan: 'paid', relay: true, backup: true, backupQuotaBytes: 1073741824, backupKeep: 7, allowance: true, allowanceMonthlyPaise: '50000', worker: true, monthlyMessages: 30 },
      devices: [{ deviceId: session.deviceId, deviceName: 'Shop computer', createdAt: this.iso(), lastSeenAt: null, current: true }] });
    if (method === 'POST' && (m = /^\/v1\/accounts\/devices\/([^/]+)\/revoke$/.exec(path))) {
      for (const [token, value] of this.sessions) if (value.deviceId === m[1]) this.sessions.delete(token);
      this.revoked.push(m[1]); return reply(200, { deviceId: m[1], revokedAt: this.iso() });
    }
    if (method === 'GET' && path === '/v1/relay/channels') return reply(200, { channels: Object.entries(this.channels).map(([channel, row]) => ({ channel, ...row })) });
    if (method === 'PUT' && (m = /^\/v1\/relay\/channels\/(whatsapp|telegram|mail)$/.exec(path))) {
      const b = json(), channel = m[1] as hostedTemplates.Channel; this.channelBodies.push(b);
      if (!exact(b, ['enabled', 'optIn'], ['address'])) return refuse(400, 'INVALID_REQUEST');
      if (b.enabled) {
        if (!exact(b.optIn, ['given', 'textSha256', 'recordedAt']) || b.optIn.given !== true) return refuse(400, 'INVALID_REQUEST');
        if (b.optIn.textSha256 !== sha256(hostedTemplates.OPT_IN_TEXT[channel])) return refuse(409, 'OPT_IN_TEXT_CHANGED');
        this.channels[channel] = { status: channel === 'telegram' ? 'awaiting-start' : 'on', optInAt: b.optIn.recordedAt, address: b.address ? 'o***@example.test' : null };
        return reply(200, { channel, ...this.channels[channel], ...(channel === 'telegram' ? { connectUrl: 'https://t.me/ChausarBot?start=AbcDefGhi' } : {}) });
      }
      this.channels[channel] = { ...this.channels[channel], status: 'off' }; return reply(200, { channel, ...this.channels[channel] });
    }
    if (method === 'POST' && path === '/v1/relay/messages') {
      const b = json();
      if (!exact(b, ['event', 'channel', 'idempotencyKey'], ['offer'])) return refuse(400, 'INVALID_REQUEST');
      if (b.offer !== undefined) {
        const blob = (s: any) => exact(s, ['format', 'nonce', 'ciphertext']) && s.format === 'chausar-relay-sealed-v1' && Buffer.from(s.nonce, 'base64').length === 12
          && Buffer.from(s.ciphertext, 'base64').length >= 16 && Buffer.from(s.ciphertext, 'base64').length <= 4096;
        if (b.event !== 'review-ready' || !exact(b.offer, ['approve', 'notNow']) || !blob(b.offer.approve) || !blob(b.offer.notNow)) return refuse(400, 'INVALID_REQUEST');
      }
      const known = this.keys.get(b.idempotencyKey); if (known) return reply(202, known);
      if (this.channels[b.channel]?.status !== 'on') return refuse(409, 'CHANNEL_OFF');
      if (this.messages.size >= 30) return refuse(429, 'MONTHLY_BUDGET_REACHED');
      const messageId = this.id('msg'), month = this.iso().slice(0, 7);
      this.messages.set(messageId, { ...b, queuedAt: this.now(), decided: null });
      const answer = { messageId, status: 'queued', month, sent: this.messages.size, budget: 30 }; this.keys.set(b.idempotencyKey, answer);
      return reply(202, answer);
    }
    if (method === 'GET' && path === '/v1/relay/counts') {
      const by = { whatsapp: 0, telegram: 0, mail: 0 } as Record<string, number>; for (const message of this.messages.values()) by[message.channel]++;
      return reply(200, { month: url.searchParams.get('month'), sent: this.messages.size, budget: 30, costPaise: null, costState: 'unknown', byChannel: by });
    }
    if (method === 'GET' && path === '/v1/relay/envelopes') return reply(200, { envelopes: [...this.envelopes.values()] });
    if (method === 'POST' && (m = /^\/v1\/relay\/envelopes\/([^/]+)\/ack$/.exec(path))) {
      const b = json(); if (!exact(b, ['disposition']) || !this.envelopes.has(m[1])) return refuse(404, 'NOT_FOUND');
      this.envelopes.delete(m[1]); this.acks.push({ envelopeId: m[1], disposition: b.disposition }); return reply(200, { envelopeId: m[1], disposition: b.disposition });
    }
    if (method === 'PUT' && (m = /^\/v1\/backups\/(bk_[0-9a-f]{32})$/.exec(path))) {
      const bytes = raw as Buffer;
      if (headers['content-type'] !== 'application/octet-stream' || !Buffer.isBuffer(bytes)) return refuse(415, 'INVALID_REQUEST');
      if (sha256(bytes) !== headers['x-chausar-sha256']) return refuse(400, 'BACKUP_DIGEST_MISMATCH');
      if (!bytes.subarray(0, 8).equals(Buffer.from('CHSBK1\0\0', 'latin1'))) return refuse(400, 'BACKUP_FORMAT_INVALID');
      if (this.backups.has(m[1])) return refuse(409, 'BACKUP_EXISTS');
      const createdAt = this.iso(); this.backups.set(m[1], { bytes, createdAt });
      return reply(201, { backupId: m[1], sizeBytes: bytes.length, sha256: sha256(bytes), createdAt });
    }
    if (method === 'GET' && path === '/v1/backups') return reply(200, { backups: [...this.backups].map(([backupId, b]) => ({ backupId, sizeBytes: b.bytes.length, sha256: sha256(b.bytes), createdAt: b.createdAt })),
      quotaBytes: 1073741824, usedBytes: [...this.backups.values()].reduce((sum, b) => sum + b.bytes.length, 0), keep: 7 });
    if (method === 'GET' && (m = /^\/v1\/backups\/(bk_[0-9a-f]{32})$/.exec(path))) {
      const b = this.backups.get(m[1]); if (!b) return refuse(404, 'NOT_FOUND');
      return reply(200, b.bytes, { 'content-type': 'application/octet-stream', 'x-chausar-sha256': sha256(b.bytes) });
    }
    if (method === 'GET' && path === '/v1/allowance') return reply(200, { month: this.iso().slice(0, 7), grantPaise: '50000', spentPaise: '1200', reservedPaise: '0', balancePaise: '48800',
      pricing: { checkedOn: '2026-10-01', fxPaisePerUsd: '8400', source: 'Synthetic price list' }, models: [{ route: 'anthropic', model: 'claude-synthetic' }] });
    if (method === 'POST' && path === '/v1/allowance/complete') {
      this.allowanceBodies.push(String(raw)); const b = json();
      if (!exact(b, ['requestId', 'route', 'model', 'messages', 'maxOutputTokens'], ['system'])) return refuse(400, 'INVALID_REQUEST');
      this.allowanceReplyText = `{ "requestId": "${b.requestId}", "text": "The answer is in the receipt.",\n  "usage": { "inputTokens": 12, "outputTokens": 7 }, "costPaise": "3", "balancePaise": "48797", "route": "${b.route}", "model": "${b.model}", "pricingCheckedOn": "2026-10-01" }`;
      return reply(200, this.allowanceReplyText);
    }
    if (method === 'GET' && path === '/v1/worker') return reply(200, { endToEndEncrypted: false, label: 'Not end-to-end encrypted. The server does the work, so it can read what each job uses.',
      jobs: [{ type: 'due-date-reminder', title: 'Due date reminders', enabled: false, consentAt: null, uses: 'Due dates you send' }] });
    if (method === 'PUT' && (m = /^\/v1\/worker\/jobs\/([a-z-]+)$/.exec(path))) {
      const b = json(); this.workerBodies.push(b);
      if (!exact(b, ['enabled', 'consent']) || (b.enabled && !(exact(b.consent, ['notEndToEndEncrypted', 'recordedAt']) && b.consent.notEndToEndEncrypted === true))) return refuse(400, 'INVALID_REQUEST');
      return reply(200, { endToEndEncrypted: false, label: 'Not end-to-end encrypted. The server does the work, so it can read what each job uses.', type: m[1], title: 'Due date reminders', enabled: b.enabled, consentAt: b.enabled ? b.consent.recordedAt : null, uses: 'Due dates you send' });
    }
    return refuse(404, 'NOT_FOUND');
  }
  /** A button press: the relay releases the matching sealed blob as an envelope. */
  press(messageId: string, decision: 'approve' | 'not-now', options: { tamper?: boolean } = {}) {
    const message = this.messages.get(messageId); assert.ok(message?.offer, 'The message carries buttons.');
    const blob = decision === 'approve' ? message.offer.approve : message.offer.notNow;
    let ciphertext = blob.ciphertext;
    if (options.tamper) { const bytes = Buffer.from(ciphertext, 'base64'); bytes[0] ^= 1; ciphertext = bytes.toString('base64'); }
    const envelopeId = this.id('env');
    this.envelopes.set(envelopeId, { envelopeId, messageId, purpose: 'approval-intent', decision, channel: message.channel, createdAt: this.iso(),
      expiresAt: new Date(message.queuedAt + 30 * 60000).toISOString(), nonce: blob.nonce, ciphertext });
    return envelopeId;
  }
}

async function setup(t: TestContext, options: { configured?: boolean; demo?: boolean } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'chausar-hosted-link-desktop-')));
  let time = START;
  const server = new FakeHosted(() => time);
  const modules = options.configured === false ? undefined : { 'hosted-link': { origin: ORIGIN, fetch: server.fetch, clock: () => new Date(time) } };
  const engine = options.demo ? new Engine({ directory, demo: true, storage: 'experimental-file', modules })
    : new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main', 'restored'], t.mock), modules });
  t.after(async () => { try { await engine.shutdown(); } finally { await rm(directory, { recursive: true, force: true }); } });
  await engine.requestAs(owner, 'workspace.create', { name: 'Synthetic Hosted Link Shop', passphrase, demo: !!options.demo, pack: 'services' });
  const rpc = (method: string, payload: Record<string, unknown> = {}) => engine.requestAs(owner, method, payload);
  return { directory, engine, server, rpc, advance: (ms: number) => { time += ms; } };
}
async function paired(t: TestContext) {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '246810', deviceName: 'Shop computer' });
  await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  return f;
}
const prepare = async (f: Awaited<ReturnType<typeof setup>>, invoiceId = 'inv-synthetic-1') =>
  f.rpc('actions.prepare', { payload: { invoiceId, text: 'A gentle reminder draft.' } });
const action = (f: Awaited<ReturnType<typeof setup>>, id: string) => f.engine.vault!.read().actions.find((a: any) => a.id === id);
const activity = (f: Awaited<ReturnType<typeof setup>>, event: string) => f.engine.vault!.read().activity.filter((a: any) => a.event === event);
const tokenOf = (f: Awaited<ReturnType<typeof setup>>) => [...f.server.sessions.keys()][0];

test('the desktop template catalogue is identical to the hosted one', () => {
  assert.deepEqual(Object.keys(desktopTemplates).sort(), Object.keys(hostedTemplates).sort());
  for (const [name, value] of Object.entries(hostedTemplates)) {
    const mine = (desktopTemplates as Record<string, unknown>)[name];
    if (typeof value === 'function') assert.equal(String(mine), String(value), name);
    else assert.deepEqual(mine, value, name);
  }
});

test('without an origin the module answers status and refuses every hosted call', async t => {
  const f = await setup(t, { configured: false });
  const status = await f.rpc('hosted.status');
  assert.equal(status.configured, false); assert.equal(status.paired, false);
  assert.deepEqual(status.labels, LABELS);
  assert.equal(status.labels.backup, 'Encrypted on this computer before upload. Chausar\'s server cannot open it.');
  for (const [method, payload] of [['hosted.pair.start', { phone: PHONE }], ['phone.messages.send', { event: 'week-ahead-ready', channel: 'mail' }], ['hosted.backup.upload', {}],
    ['phone.templates.preview', {}], ['hosted.worker.status', {}], ['phone.relay.collect', {}]] as const)
    await assert.rejects(f.rpc(method, payload), { code: 'HOSTED_NOT_CONFIGURED' }, method);
  assert.equal((await f.rpc('phone.channels.list')).stale, true);
});

test('demo mode refuses every method that reaches the hosted service', async t => {
  const f = await setup(t, { demo: true });
  assert.equal((await f.rpc('hosted.status')).configured, true);
  for (const method of ['hosted.pair.start', 'hosted.pair.finish', 'hosted.account.refresh', 'phone.channels.set', 'phone.messages.send', 'phone.messages.counts',
    'phone.relay.collect', 'hosted.backup.upload', 'hosted.backup.list', 'hosted.backup.restore', 'hosted.allowance.status', 'hosted.worker.status', 'hosted.worker.set'])
    await assert.rejects(f.rpc(method, {}), { code: 'DEMO_EXTERNAL_DISABLED' }, method);
  assert.equal(f.server.calls.length, 0);
});

test('pairing stores the session in the vault only, and unpairing revokes and forgets it', async t => {
  const f = await setup(t);
  assert.throws(() => hostedOrigin('http://relay.chausar.test'), { code: 'HOSTED_ORIGIN_INVALID' });
  assert.throws(() => hostedOrigin('https://user:secret@relay.chausar.test'), { code: 'HOSTED_ORIGIN_INVALID' });
  assert.throws(() => hostedOrigin('https://relay.chausar.test/?x=y'), { code: 'HOSTED_ORIGIN_INVALID' });
  await assert.rejects(f.rpc('hosted.pair.start', { phone: '9876543210' }), { code: 'INVALID_PHONE' });
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await assert.rejects(f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '000000', deviceName: 'Shop computer' }), { code: 'OTP_INVALID' });
  const done = await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '246810', deviceName: 'Shop computer' });
  assert.equal(done.paired, true);
  const token = tokenOf(f); assert.ok(token);
  const status = await f.rpc('hosted.status');
  assert.equal(status.paired, true); assert.equal(status.pairing.phoneMasked, '+91******3210');
  const account = await f.rpc('hosted.account.refresh');
  assert.equal(account.plan, 'paid'); assert.equal(account.entitlements.monthlyMessages, 30);
  assert.equal((await f.rpc('hosted.status')).account.plan, 'paid');
  // The token never appears in a URL, a reply or the activity ledger.
  for (const call of f.server.calls) assert.equal(call.url.includes(token), false);
  assert.equal(JSON.stringify([done, status, account]).includes(token), false);
  assert.equal(JSON.stringify(f.engine.vault!.read().activity).includes(token), false);
  const state = f.engine.vault!.read().extensions!['hosted-link'] as any;
  assert.equal(state.pairing.sessionToken, token); assert.equal(Buffer.from(state.relayKey, 'base64').length, 32);
  const gone = await f.rpc('hosted.unpair');
  assert.deepEqual(gone, { paired: false, serverRevoked: true, credentialsForgotten: true });
  assert.equal(f.server.revoked.length, 1);
  const after = f.engine.vault!.read().extensions!['hosted-link'] as any;
  assert.equal(after.pairing, null); assert.equal(after.relayKey, null);
  await assert.rejects(f.rpc('phone.messages.send', { event: 'week-ahead-ready', channel: 'whatsapp' }), { code: 'HOSTED_NOT_PAIRED' });
  // Unpair forgets local credentials even when the server cannot be reached.
  const again = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: again.challengeId, code: '246810', deviceName: 'Shop computer' });
  f.server.network = 'down';
  assert.equal((await f.rpc('hosted.unpair')).serverRevoked, false);
  assert.equal((await f.rpc('hosted.status')).paired, false);
});

test('a hosted refusal keeps only known codes and never the server message', async t => {
  const f = await setup(t);
  const client = new HostedClient({ origin: ORIGIN, fetch: async () => refuse(429, 'OTP_RATE_LIMITED') });
  await assert.rejects(client.otpStart(PHONE), (error: any) => error.code === 'OTP_RATE_LIMITED' && !/\d/.test(error.message));
  const odd = new HostedClient({ origin: ORIGIN, fetch: async () => refuse(400, 'SOMETHING_ELSE') });
  await assert.rejects(odd.otpStart(PHONE), { code: 'HOSTED_REQUEST_FAILED' });
  const extra = new HostedClient({ origin: ORIGIN, fetch: async () => reply(202, { challengeId: 'otp_x', expiresAt: '2026-10-14T06:10:00.000Z', extra: true }) });
  await assert.rejects(extra.otpStart(PHONE), { code: 'HOSTED_REPLY_INVALID' });
  const huge = new HostedClient({ origin: ORIGIN, fetch: async () => reply(202, 'x'.repeat(1024 * 1024 + 1)) });
  await assert.rejects(huge.otpStart(PHONE), { code: 'HOSTED_REPLY_INVALID' });
  f.server.network = 'down';
  await assert.rejects(f.rpc('hosted.pair.start', { phone: PHONE }), { code: 'HOSTED_UNREACHABLE' });
});

test('a channel turns on only with the ticked opt-in, sent as the hash of the desktop wording', async t => {
  const f = await setup(t);
  const started = await f.rpc('hosted.pair.start', { phone: PHONE });
  await f.rpc('hosted.pair.finish', { challengeId: started.challengeId, code: '246810', deviceName: 'Shop computer' });
  await assert.rejects(f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: false }), { code: 'OPT_IN_REQUIRED' });
  await assert.rejects(f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true, address: 'owner@example.test' }), { code: 'INVALID_ADDRESS' });
  assert.equal(f.server.channelBodies.length, 0);
  const row = await f.rpc('phone.channels.set', { channel: 'whatsapp', enabled: true, optIn: true });
  assert.equal(row.status, 'on');
  assert.equal(f.server.channelBodies[0].optIn.textSha256, sha256(hostedTemplates.OPT_IN_TEXT.whatsapp));
  const telegram = await f.rpc('phone.channels.set', { channel: 'telegram', enabled: true, optIn: true });
  assert.equal(telegram.status, 'awaiting-start'); assert.match(telegram.connectUrl, /^https:\/\/t\.me\//);
  await f.rpc('phone.channels.set', { channel: 'mail', enabled: true, optIn: true, address: 'owner@example.test' });
  const listed = await f.rpc('phone.channels.list');
  assert.equal(listed.stale, false);
  assert.deepEqual(listed.channels.map((c: any) => [c.channel, c.desktop.enabled, c.relay.status]), [['whatsapp', true, 'on'], ['telegram', true, 'awaiting-start'], ['mail', true, 'on']]);
  f.server.network = 'down';
  const cached = await f.rpc('phone.channels.list');
  assert.equal(cached.stale, true); assert.equal(cached.channels[0].relay.status, 'on');
});

test('the message preview shows the exact text of every message and contains no digit', async t => {
  const f = await setup(t);
  const preview = await f.rpc('phone.templates.preview');
  assert.doesNotMatch(JSON.stringify(preview), /[0-9]/);
  const whatsapp = preview.channels.find((c: any) => c.channel === 'whatsapp');
  const review = whatsapp.messages.find((m: any) => m.event === 'review-ready');
  assert.equal(review.body, `Something is ready for your review.\n${ORIGIN}/l/${'x'.repeat(48)}`);
  assert.deepEqual(review.buttons, ['Approve', 'Not now', 'Open the app']);
  const mail = preview.channels.find((c: any) => c.channel === 'mail').messages[0];
  assert.ok(mail.body.endsWith(hostedTemplates.MAIL_FOOTER));
  assert.equal(preview.replies.freeText, hostedTemplates.REPLIES.freeText);
});

test('only a small undoable change inside the workspace gets Approve and Not now', async t => {
  const f = await paired(t);
  const plain = await f.rpc('phone.messages.send', { event: 'week-ahead-ready', channel: 'whatsapp' });
  assert.equal(plain.buttons, 'open-only'); assert.equal(plain.reason, null);
  await assert.rejects(f.rpc('phone.messages.send', { event: 'week-ahead-ready', channel: 'whatsapp', actionId: 'x' }), { code: 'INVALID_REQUEST' });
  const eligible = await prepare(f);
  const offered = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: eligible.id });
  assert.equal(offered.buttons, 'approve-not-now-open'); assert.ok(offered.offer.offerId);
  assert.equal(Date.parse(offered.offer.expiresAt) - START, 30 * 60000);
  assert.ok(f.server.messages.get(offered.messageId).offer);
  for (const [impact, reason] of [['money', 'money'], ['message', 'message-to-outsiders'], ['destructive', 'deleting-or-cannot-undo']]) {
    const prepared = await prepare(f, `inv-${impact}`);
    await f.engine.vault!.update(state => { state.actions.find((a: any) => a.id === prepared.id).impact = impact; });
    const sent = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
    assert.equal(sent.buttons, 'open-only'); assert.equal(sent.reason, reason); assert.equal(sent.offer, null);
    assert.equal(f.server.messages.get(sent.messageId).offer, undefined);
  }
  const outside = await prepare(f, 'inv-outside');
  await f.engine.vault!.update(state => { state.actions.find((a: any) => a.id === outside.id).connector = 'zoho-books'; });
  assert.equal((await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: outside.id })).reason, 'outside-workspace');
  assert.equal((await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: 'group_synthetic' })).reason, 'not-a-single-action');
  const counts = await f.rpc('phone.messages.counts');
  assert.equal(counts.month, '2026-10'); assert.equal(counts.sent, 7); assert.equal(counts.budget, 30);
  assert.equal(counts.costPaise, null); assert.equal(counts.costState, 'unknown');
});

test('a lost reply leaves the message unknown and a retry reuses the same idempotency key', async t => {
  const f = await paired(t);
  const prepared = await prepare(f);
  f.server.network = 'drop-after';
  await assert.rejects(f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id }), { code: 'HOSTED_UNREACHABLE' });
  const log = (f.engine.vault!.read().extensions!['hosted-link'] as any).messages;
  assert.equal(log.at(-1).status, 'unknown');
  const retried = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
  assert.equal(retried.retried, true);
  const posts = f.server.calls.filter(c => c.method === 'POST' && c.url.endsWith('/v1/relay/messages')).map(c => JSON.parse(String(c.body)));
  assert.equal(posts.length, 2); assert.equal(posts[0].idempotencyKey, posts[1].idempotencyKey);
  assert.deepEqual(posts[0].offer, posts[1].offer);
  assert.equal(f.server.messages.size, 1);
  assert.equal((f.engine.vault!.read().extensions!['hosted-link'] as any).messages.at(-1).status, 'queued');
});

test('sealed approvals cannot be read without the key and refuse a flipped byte', () => {
  const key = newKey(), intent = { v: 1 as const, offerId: 'offer_a', actionId: 'action_a', digest: 'd'.repeat(64), decision: 'approve' as const, expiresAt: '2026-10-14T06:30:00.000Z' };
  const sealed = sealIntent(key, 'account_synthetic', intent);
  assert.equal(sealed.format, 'chausar-relay-sealed-v1'); assert.equal(Buffer.from(sealed.nonce, 'base64').length, 12);
  assert.equal(Buffer.from(sealed.ciphertext, 'base64').toString('utf8').includes('action_a'), false);
  assert.deepEqual(openIntent(key, 'account_synthetic', 'approve', sealed), intent);
  assert.throws(() => openIntent(newKey(), 'account_synthetic', 'approve', sealed), { code: 'SEALED_INVALID' });
  assert.throws(() => openIntent(key, 'account_other', 'approve', sealed), { code: 'SEALED_INVALID' });
  assert.throws(() => openIntent(key, 'account_synthetic', 'not-now', sealed), { code: 'SEALED_INVALID' });
  const bytes = Buffer.from(sealed.ciphertext, 'base64');
  for (const index of [0, bytes.length - 1]) {
    const flipped = Buffer.from(bytes); flipped[index] ^= 1;
    assert.throws(() => openIntent(key, 'account_synthetic', 'approve', { nonce: sealed.nonce, ciphertext: flipped.toString('base64') }), { code: 'SEALED_INVALID' });
  }
});

test('a relayed Approve approves exactly once, records the channel and never executes', async t => {
  const f = await paired(t);
  const prepared = await prepare(f);
  const sent = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
  const tampered = f.server.press(sent.messageId, 'approve', { tamper: true });
  const first = f.server.press(sent.messageId, 'approve');
  const result = await f.rpc('phone.relay.collect');
  assert.deepEqual(result.collected.map((c: any) => [c.envelopeId, c.outcome, c.acked]), [[tampered, 'invalid', true], [first, 'approved', true]]);
  assert.deepEqual(f.server.acks.map(a => a.disposition), ['invalid', 'collected']);
  const approved = action(f, prepared.id);
  assert.equal(approved.status, 'approved'); assert.equal(approved.attempts.length, 0); assert.equal(approved.approval.digest, prepared.digest);
  assert.equal(f.engine.vault!.read().conversations.filter((c: any) => c.kind === 'reminder-draft').length, 0);
  assert.deepEqual(activity(f, 'hosted.relay.approved').map((a: any) => a.details), [{ actionId: prepared.id, digest: prepared.digest, channel: 'whatsapp' }]);
  assert.equal(activity(f, 'action.approved').length, 1);
  // A replayed blob under a new envelope does nothing.
  f.server.press(sent.messageId, 'approve');
  const replay = await f.rpc('phone.relay.collect');
  assert.equal(replay.collected[0].outcome, 'replayed');
  assert.equal(activity(f, 'action.approved').length, 1); assert.equal(action(f, prepared.id).status, 'approved');
  assert.deepEqual((await f.rpc('phone.relay.collect')).collected, []);
});

test('Not now leaves the action prepared and records the decision', async t => {
  const f = await paired(t);
  const prepared = await prepare(f);
  const sent = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
  f.server.press(sent.messageId, 'not-now');
  assert.equal((await f.rpc('phone.relay.collect')).collected[0].outcome, 'not-now');
  assert.equal(action(f, prepared.id).status, 'prepared');
  assert.deepEqual(activity(f, 'hosted.relay.notNow').map((a: any) => a.details), [{ actionId: prepared.id, digest: prepared.digest, channel: 'whatsapp' }]);
  f.server.press(sent.messageId, 'approve');
  assert.equal((await f.rpc('phone.relay.collect')).collected[0].outcome, 'replayed');
  assert.equal(action(f, prepared.id).status, 'prepared');
});

test('an expired offer and a changed action digest do nothing', async t => {
  const f = await paired(t);
  const late = await prepare(f, 'inv-late');
  const lateMessage = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: late.id });
  f.advance(31 * 60000);
  f.server.press(lateMessage.messageId, 'approve');
  const expired = await f.rpc('phone.relay.collect');
  assert.equal(expired.collected[0].outcome, 'expired'); assert.equal(f.server.acks.at(-1)!.disposition, 'expired');
  assert.equal(action(f, late.id).status, 'prepared');

  const changed = await prepare(f, 'inv-changed');
  const changedMessage = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: changed.id });
  const revised = await f.rpc('actions.revise', { id: changed.id, payload: { invoiceId: 'inv-changed', text: 'A different reminder draft.' } });
  assert.notEqual(revised.digest, changed.digest);
  f.server.press(changedMessage.messageId, 'approve');
  const refused = await f.rpc('phone.relay.collect');
  assert.equal(refused.collected[0].outcome, 'refused'); assert.equal(refused.collected[0].reason, 'action-changed');
  assert.equal(action(f, changed.id).status, 'prepared'); assert.equal(action(f, changed.id).approval, undefined);
  assert.equal(activity(f, 'action.approved').length, 0);
});

test('the scheduled tick collects relay decisions only while paired and configured', async t => {
  const f = await paired(t);
  const prepared = await prepare(f);
  const sent = await f.rpc('phone.messages.send', { event: 'review-ready', channel: 'whatsapp', actionId: prepared.id });
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  f.server.press(sent.messageId, 'approve');
  assert.deepEqual(await f.engine.tick(), [], 'Nothing runs while autonomy is off.');
  assert.equal(action(f, prepared.id).status, 'prepared');
  await f.rpc('trust.update', { autonomy: true });
  const ran = await f.engine.tick();
  assert.ok(ran.some((r: any) => r.module === 'hosted-link'));
  assert.equal(action(f, prepared.id).status, 'approved'); assert.equal(action(f, prepared.id).attempts.length, 0);
});

test('backup upload and restore round trip produces a file workspace.restore opens', async t => {
  const f = await paired(t);
  const uploaded = await f.rpc('hosted.backup.upload');
  assert.match(uploaded.backupId, /^bk_[0-9a-f]{32}$/); assert.equal(uploaded.label, LABELS.backup);
  const stored = f.server.backups.get(uploaded.backupId)!.bytes;
  assert.ok(stored.subarray(0, 8).equals(Buffer.from('CHSBK1\0\0', 'latin1')));
  assert.equal(stored.includes('chausar.backup.v1'), false);
  const put = f.server.calls.find(c => c.method === 'PUT' && c.url.includes('/v1/backups/'))!;
  assert.equal(put.headers['x-chausar-sha256'], sha256(stored));
  const listed = await f.rpc('hosted.backup.list');
  assert.equal(listed.backups.length, 1); assert.equal(listed.backups[0].madeHere, true); assert.equal(listed.keyHeldHere, true);
  const restored = await f.rpc('hosted.backup.restore', { backupId: uploaded.backupId });
  const local = await readFile(join(f.directory, 'backups', uploaded.localBackupFile));
  assert.ok((await readFile(join(f.directory, 'backups', restored.backupFile))).equals(local));
  await assert.rejects(f.rpc('hosted.backup.restore', { backupId: uploaded.backupId, backupKey: newKey() }), { code: 'BACKUP_KEY_MISMATCH' });
  const exported = await f.rpc('hosted.backup.exportKey');
  assert.equal(exported.secret, true);
  assert.ok(unwrapBackup(exported.backupKey, 'account_synthetic', uploaded.backupId, stored).equals(local));
  assert.throws(() => unwrapBackup(exported.backupKey, 'account_synthetic', `bk_${'0'.repeat(32)}`, stored), { code: 'BACKUP_KEY_MISMATCH' });
  assert.ok(wrapBackup(exported.backupKey, 'a', 'b', Buffer.from('x')).length > 36);
  const workspaceId = f.engine.vault!.read().workspace.id;
  await f.rpc('workspace.lock');
  const opened = await f.engine.request('workspace.restore', { backupFile: restored.backupFile, passphrase, folder: 'restored' });
  assert.equal(opened.workspace.id, workspaceId);
});

test('the allowance route client keeps the exact request and reply word for word', async t => {
  const f = await paired(t);
  const status = await f.rpc('hosted.allowance.status');
  assert.equal(status.balancePaise, '48800');
  const client = new AllowanceRouteClient({ client: new HostedClient({ origin: ORIGIN, fetch: f.server.fetch }), sessionToken: () => tokenOf(f) });
  const done = await client.complete({ requestId: 'req_synthetic_one', route: 'anthropic', model: 'claude-synthetic', messages: [{ role: 'user', content: 'Choose a calculation.' }], maxOutputTokens: 200 });
  assert.equal(done.text, 'The answer is in the receipt.'); assert.equal(done.costPaise, '3');
  assert.deepEqual(done.usage, { inputTokens: 12, outputTokens: 7 });
  assert.equal(done.receipt.requestBody, f.server.allowanceBodies[0]);
  assert.equal(done.receipt.replyBody, f.server.allowanceReplyText);
  await assert.rejects(client.complete({ route: 'anthropic', model: 'claude-synthetic', messages: [], maxOutputTokens: 200 }), { code: 'INVALID_REQUEST' });
});

test('an always-on job turns on only with consent and the server label is shown verbatim', async t => {
  const f = await paired(t);
  const worker = await f.rpc('hosted.worker.status');
  assert.equal(worker.endToEndEncrypted, false);
  assert.equal(worker.label, 'Not end-to-end encrypted. The server does the work, so it can read what each job uses.');
  await assert.rejects(f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true }), { code: 'CONSENT_REQUIRED' });
  await assert.rejects(f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true, consent: 'yes' }), { code: 'CONSENT_REQUIRED' });
  assert.equal(f.server.workerBodies.length, 0);
  const on = await f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: true, consent: true });
  assert.equal(on.enabled, true); assert.equal(f.server.workerBodies[0].consent.notEndToEndEncrypted, true);
  const off = await f.rpc('hosted.worker.set', { type: 'due-date-reminder', enabled: false });
  assert.equal(off.enabled, false); assert.equal(f.server.workerBodies[1].consent, null);
});

test('purge drops only offers whose action was removed', () => {
  const state = initialState('Synthetic purge');
  state.actions.push({ id: 'action_kept' });
  state.extensions = { 'hosted-link': { offers: [{ offerId: 'offer_a', actionId: 'action_kept' }, { offerId: 'offer_b', actionId: 'action_gone' }] } };
  assert.equal(hostedLinkModule.purge!(state, { sourceIds: [], removedIds: new Set(['action_gone']), at: '2026-10-14T06:00:00.000Z' }), 1);
  assert.deepEqual((state.extensions['hosted-link'] as any).offers.map((o: any) => o.offerId), ['offer_a']);
  assert.equal(hostedLinkModule.purge!(initialState('Empty'), { sourceIds: ['books'], removedIds: new Set(), at: '2026-10-14T06:00:00.000Z' }), 0);
});
