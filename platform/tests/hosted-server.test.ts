// Hosted tier: the HTTP server, end to end over real sockets on this computer. Sign-in by email link, cookies,
// origin checks, the page's bearer, the method allow-list, two tenants that never meet, an event stream, and the
// venture journey through the hosted actor with synthetic recordings. No network beyond loopback, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createDecipheriv, createECDH, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedApp, type HostedAppOptions } from '../runtime/hosted/app.ts';
import { LocalVentureRuntime } from '../runtime/hosted/runtime/local.ts';
import { hostedConfig } from '../runtime/hosted/config.ts';
import { HostedCustody } from '../runtime/hosted/custody.ts';
import { FileDirectory } from '../runtime/hosted/directory.ts';
import { DEFAULT_LIMITS } from '../runtime/hosted/limits.ts';
import { DevOutbox } from '../runtime/hosted/mailer.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { createFixtureGitHubTransport } from '../runtime/venture/build/index.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';
import { hostedPushPort, OwnerWatch } from '../runtime/hosted/notify.ts';
import { NOTIFY_EVERY_MS } from '../runtime/engine.ts';
import type { VentureHostOptions } from '../runtime/venture/contracts.ts';

const ORIGIN = 'http://localhost:4399';
const HOST = 'localhost:4399';
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const API_KEY = 'sk-ant-test-not-a-real-key-0000';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: any };

function browserClient(port: number) {
  const jar = new Map<string, string>();
  let bearer: string | null = null;
  const cookieHeader = () => [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const base: Record<string, string> = { Host: HOST };
    if (method === 'POST') { base.Origin = ORIGIN; base['Content-Type'] = 'application/json'; base['Sec-Fetch-Site'] = 'same-origin'; }
    if (jar.size) base.Cookie = cookieHeader();
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { ...base, ...headers } }, res => {
      for (const line of [res.headers['set-cookie'] ?? []].flat()) {
        const [pair] = line.split(';'); const at = pair.indexOf('=');
        const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
        if (/Max-Age=0/.test(line)) jar.delete(name); else jar.set(name, value);
      }
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
  return {
    jar, send,
    get: (path: string, headers?: Record<string, string>) => send('GET', path, undefined, headers),
    post: (path: string, body: unknown = {}, headers?: Record<string, string>) => send('POST', path, body, headers),
    async signInBearer() { const reply = await send('GET', '/api/hosted/session'); assert.equal(reply.status, 200, reply.text); bearer = reply.json.token; return reply.json; },
    async rpc(method: string, payload: unknown = {}) {
      const reply = await send('POST', '/api/rpc', { method, payload }, bearer ? { Authorization: `Bearer ${bearer}` } : {});
      if (reply.json?.error) throw Object.assign(new Error(reply.json.error.message), { code: reply.json.error.code, status: reply.status });
      assert.equal(reply.status, 200, reply.text);
      return reply.json.result;
    },
    /** Opens the event stream and collects whole events until stop() is called. */
    events() {
      const seen: { event: string; data: any }[] = [];
      let buffer = '';
      const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/api/hosted/events', headers: { Host: HOST, Cookie: cookieHeader(), Accept: 'text/event-stream' } }, res => {
        res.setEncoding('utf8');
        res.on('data', chunk => {
          buffer += chunk;
          let at;
          while ((at = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, at); buffer = buffer.slice(at + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1], data = /^data: (.+)$/m.exec(block)?.[1];
            if (event && data) seen.push({ event, data: JSON.parse(data) });
          }
        });
      });
      req.on('error', () => {});
      req.end();
      return { seen, stop: () => req.destroy() };
    },
  };
}

async function startServer(t: any, limits = DEFAULT_LIMITS, extra: { push?: boolean; clock?: () => Date; net?: VentureHostOptions['net']; runtime?: HostedAppOptions['runtime'] } = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-server-'));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody);
  const outbox = new DevOutbox();
  const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
  const githubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits, version: '0.1.0-preview.1',
    modelTransport: createReplayTransport(modelFixture),
    githubTransport: store => createFixtureGitHubTransport(githubFixture, () => ({ briefId: [...store.read().conversations].reverse().find((r: any) => r.kind === 'venture-brief')?.briefId ?? '' })),
    // Ink v2 wave 4 (4G3): the web push key, made from the custody key the way startHosted makes it.
    ...(extra.push ? { push: hostedPushPort(custody, null) } : {}),
    // The app's clock and the network guard's stand-ins, when a test needs them (4G3).
    ...(extra.clock ? { clock: extra.clock } : {}), ...(extra.net ? { net: extra.net } : {}), ...(extra.runtime ? { runtime: extra.runtime } : {}),
  });
  // A small stand-in for the Ink build (app/ui/dist), listed the way startHosted lists the real one, with the real
  // service worker (app/ui/public/sw.js, which the build copies as it is).
  const inkFolder = join(folder, 'ink'); await mkdir(join(inkFolder, 'assets'), { recursive: true });
  await writeFile(join(inkFolder, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n  <title>Chausar</title>\n</head>\n<body></body>\n</html>\n');
  await writeFile(join(inkFolder, 'assets/index-abc.js'), 'export {};');
  await writeFile(join(inkFolder, 'sw.js'), await readFile(new URL('../../app/ui/public/sw.js', import.meta.url)));
  const ink = { folder: inkFolder, files: await listInkFiles(inkFolder) };
  const http = createHostedServer(app, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: limits.maxBodyBytes, ink });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(async () => { await http.close(); await rm(folder, { recursive: true, force: true }); });
  const signIn = async (email: string) => {
    const browser = browserClient(port);
    assert.equal((await browser.get('/')).status, 200);
    const asked = await browser.post('/api/auth/magic-link', { email });
    assert.equal(asked.status, 200, asked.text);
    const token = new URL(outbox.latest(email)!.link).hash.replace('#signin=', '');
    const verified = await browser.post('/api/auth/magic-link/verify', { token });
    assert.equal(verified.status, 200, verified.text);
    await browser.signInBearer();
    return browser;
  };
  return { app, port, outbox, directory, custody, signIn };
}

test('hosted mode is off unless asked for, and refuses what it cannot do safely', () => {
  assert.throws(() => hostedConfig({}), code('HOSTED_OFF'));
  assert.throws(() => hostedConfig({ CHAUSAR_HOSTED: 'yes' }, ['--dev']), code('HOSTED_OFF'));
  assert.equal(hostedConfig({}, ['--hosted', '--dev']).dev, true);
  const dev = hostedConfig({ CHAUSAR_HOSTED: '1' }, ['--dev']);
  assert.deepEqual([dev.origin, dev.rp.id, dev.listen.host, dev.mailer, dev.custody.kind, dev.tls.kind, dev.runtime, dev.storage], ['http://localhost:4320', 'localhost', '127.0.0.1', 'dev-outbox', 'dev-file', 'none', 'local', 'experimental-file']);
  const refused = (env: Record<string, string>, args: string[] = []) => assert.throws(() => hostedConfig({ CHAUSAR_HOSTED: '1', ...env }, args), code('HOSTED_CONFIG_INVALID'), JSON.stringify(env));
  const key = randomBytes(32).toString('base64url');
  refused({});
  refused({ CHAUSAR_HOSTED_ORIGIN: 'http://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key });
  refused({ CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com' });
  refused({ CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key });
  refused({ CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com/path', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' });
  refused({ CHAUSAR_HOSTED_ORIGIN: 'https://203.0.113.1', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' });
  refused({ CHAUSAR_VENTURE_RUNTIME: 'rivet' }, ['--dev']);
  refused({ CHAUSAR_HOSTED_STORAGE: 'postgres' }, ['--dev']);
  refused({ CHAUSAR_HOSTED_MAILER: 'smtp' }, ['--dev']);
  refused({ CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1', CHAUSAR_HOSTED_MAILER: 'dev-outbox' });
  const live = hostedConfig({ CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1', CHAUSAR_HOSTED_TRUST_PROXY: '1' });
  assert.deepEqual([live.tls.kind, live.trustProxy, live.mailer, live.replay], ['proxy', true, 'not-configured', null]);
  assert.equal(hostedConfig({ CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1', CHAUSAR_VENTURE_REPLAY: '1', CHAUSAR_VENTURE_MODEL_REPLAY: 'x.json' }, []).replay, null, 'recordings never stand in outside --dev');
  assert.throws(() => hostedConfig({ CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_CUSTODY_KEY: 'short' }, ['--dev']), code('CUSTODY_KEY_INVALID'));
});

test('pages and answers carry strict headers; the host, the origin and the content type are checked', async t => {
  const { port } = await startServer(t);
  const browser = browserClient(port);
  const home = await browser.get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers['content-security-policy'] as string, /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');
  assert.equal(home.headers['x-frame-options'], 'DENY');
  assert.match(String(home.headers['set-cookie']), /chausar-browser=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict/);
  assert.equal(String(home.headers['set-cookie']).includes('Secure'), false, 'plain http on localhost only, in development');
  const page = await browser.get('/app/');
  assert.match(page.text, /<meta name="chausar-mode" content="hosted">/);
  assert.equal((await browser.get('/app/assets/index-abc.js')).status, 200);
  assert.equal((await browser.get('/app/launch.js')).status, 404);
  assert.equal((await browser.get('/app')).status, 308);
  assert.equal((await browser.get('/nothing')).status, 404);
  assert.equal((await browser.get('/', { Host: 'evil.test' })).status, 403);
  assert.equal((await browser.get('/api/health')).json.mode, 'hosted-experimental');

  assert.equal((await browser.post('/api/auth/magic-link', { email: 'a@example.com' }, { Origin: 'https://evil.test' })).json.error.code, 'INVALID_ORIGIN');
  assert.equal((await browser.post('/api/auth/magic-link', { email: 'a@example.com' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await browser.post('/api/auth/magic-link', { email: 'a@example.com' }, { 'Content-Type': 'text/plain' })).json.error.code, 'INVALID_CONTENT_TYPE');
  assert.equal((await browser.post('/api/auth/magic-link', JSON.parse('{"__proto__":{"x":1},"email":"a@example.com"}'))).json.error.code, 'INVALID_REQUEST');
  assert.equal((await browser.send('PUT', '/api/rpc', {})).status, 405);
  assert.equal((await browser.post('/api/rpc', { method: 'workspace.status' })).status, 401);
  assert.equal((await browser.get('/api/hosted/session')).status, 401);
});

test('an email link signs in only the browser that asked; the page bearer works only beside its own cookie', async t => {
  const { port, outbox, signIn } = await startServer(t);
  const asker = browserClient(port), other = browserClient(port);
  await asker.get('/'); await other.get('/');
  await asker.post('/api/auth/magic-link', { email: 'owner@example.com' });
  const token = new URL(outbox.latest('owner@example.com')!.link).hash.replace('#signin=', '');
  assert.equal((await other.post('/api/auth/magic-link/verify', { token })).json.error.code, 'MAGIC_LINK_OTHER_BROWSER');
  const signed = await asker.post('/api/auth/magic-link/verify', { token });
  assert.equal(signed.status, 200);
  assert.match(String(signed.headers['set-cookie']), /chausar-session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1209600/);
  assert.equal(signed.text.includes(asker.jar.get('chausar-session')!), false, 'the session token never appears in a body');

  const me = await asker.signInBearer();
  assert.equal(me.me.user.email, 'owner@example.com');
  assert.equal(me.me.experimental, true);
  const wrong = await asker.post('/api/rpc', { method: 'workspace.status', payload: {} }, { Authorization: `Bearer ${'A'.repeat(43)}` });
  assert.equal(wrong.status, 401);
  const stranger = await signIn('stranger@example.com');
  const borrowed = await stranger.post('/api/rpc', { method: 'workspace.status', payload: {} }, { Authorization: `Bearer ${me.token}` });
  assert.equal(borrowed.status, 401, "one session's bearer is useless beside another session's cookie");

  const out = await asker.post('/api/auth/sign-out', {});
  assert.equal(out.status, 200);
  assert.equal(asker.jar.has('chausar-session'), false);
  assert.equal((await asker.get('/api/hosted/session')).status, 401);
});

test('the venture journey runs through one hosted actor per business, with key-only AI from a recording', async t => {
  const { app, directory, signIn } = await startServer(t);
  const owner = await signIn('cafe@example.com');

  assert.equal((await owner.rpc('venture.countries')).length, 15);
  assert.equal((await owner.rpc('venture.preview', { idea: IDEA, countryCode: 'IN' })).saved, false);
  const closed = await owner.rpc('workspace.status');
  assert.equal(closed.open, false);
  assert.equal(closed.hosted.email, 'cafe@example.com');

  await assert.rejects(owner.rpc('workspace.create', { name: 'Ledger Cafe Books', passphrase: 'a passphrase from the desktop', pack: 'services' }), code('INVALID_REQUEST'));
  const created = await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  assert.match(created.recoveryCode, /^CHR-/);
  assert.equal(created.experimental, true);
  const user = directory.read().users[0];
  assert.equal(user.businesses.length, 1);
  assert.equal(JSON.stringify(directory.read()).includes(created.recoveryCode), false, 'the recovery code is shown once and never kept');
  const open = await owner.rpc('workspace.status');
  assert.equal(open.open, true);
  assert.equal(open.workspace.name, 'Ledger Cafe Books');

  const stream = owner.events();
  await new Promise(resolve => setTimeout(resolve, 100));
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  for (let i = 0; i < 100 && !stream.seen.some(item => item.event === 'venture-created'); i++) await new Promise(resolve => setTimeout(resolve, 20));
  stream.stop();
  assert.ok(stream.seen.some(item => item.event === 'venture-created'), 'the page heard venture-created');

  const presets = await owner.rpc('venture.models.presets');
  assert.equal(presets.find((p: any) => p.id === 'claude-code-cli').availability, 'unavailable');
  await assert.rejects(owner.rpc('venture.models.connect', { presetId: 'claude-code-cli', consentDigest: presets.find((p: any) => p.id === 'claude-code-cli').consentDigest }), code('PRESET_UNAVAILABLE'));
  await owner.rpc('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: presets.find((p: any) => p.id === 'anthropic-haiku-5-5').consentDigest, apiKey: API_KEY, tiers: ['fast'] });
  const status = await owner.rpc('venture.models.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: presets.find((p: any) => p.id === 'anthropic-sonnet-5-5').consentDigest, apiKey: API_KEY, tiers: ['main'] });
  assert.equal(status.replay.active, true);

  const interview = await owner.rpc('venture.interview.next');
  assert.equal(interview.interview.questions.find((q: any) => q.id === 'q_1').by, 'model');
  const usage = directory.read().usage[user.tenantId] ?? [];
  assert.equal(usage.length, 1, 'the recorded cost reached the account ledger');
  assert.match(usage[0].costMicros, /^\d+$/);

  for (const [questionId, answer] of [['q_1', { choiceId: 'c_1' }], ['q_2', { text: 'WhatsApp photos and a shared folder' }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }]] as const) {
    await owner.rpc('venture.interview.answer', { questionId, answer });
  }
  const drafted = (await owner.rpc('venture.blueprint.draft')).blueprint;
  assert.equal(drafted.source, 'model');
  const updated = (await owner.rpc('venture.blueprint.update', { patch: { taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' } })).blueprint;
  const quote = await owner.rpc('venture.price.quote', { offerId: 'offer_1' });
  assert.equal(quote.totalMinor, '294882');
  assert.equal((await owner.rpc('venture.blueprint.accept', { digest: updated.digest })).blueprint.status, 'accepted');
  await assert.rejects(owner.rpc('receipts.get', { id: 'not-a-receipt' }), (error: any) => error.code !== 'HOSTED_NOT_AVAILABLE', 'receipts.get is on the hosted list');

  for (const method of ['workspace.backup', 'workspace.export', 'sources.import', 'plugins.install', 'mcp.handle', 'conversation.ask', 'workspace.restore', 'trust.get']) {
    await assert.rejects(owner.rpc(method), code('HOSTED_NOT_AVAILABLE'), method);
  }
  // Hosted keeps server custody: none of the ten keep-it-on-this-computer methods is on the hosted list.
  const { CUSTODY_METHODS } = await import('../runtime/workspace-custody-contracts.ts');
  for (const method of CUSTODY_METHODS) await assert.rejects(owner.rpc(method), code('HOSTED_NOT_AVAILABLE'), method);
  const capabilities = await owner.rpc('venture.capabilities');
  assert.equal(capabilities.find((row: any) => row.id === 'hosted-actors').state, 'unverified');
  assert.equal(app.runtime.descriptor.adapter, 'local');
});

test('two accounts never reach each other: businesses, sessions, folders and vault keys stay apart', async t => {
  const { directory, custody, signIn } = await startServer(t);
  const alice = await signIn('alice@example.com'), bob = await signIn('bob@example.com');
  const made = await alice.rpc('workspace.create', { name: 'Alice Books', pack: 'services' });
  await alice.rpc('venture.create', { idea: IDEA, countryCode: 'IN' });
  const aliceUser = directory.read().users.find(u => u.email === 'alice@example.com')!;
  const bobUser = directory.read().users.find(u => u.email === 'bob@example.com')!;
  assert.notEqual(aliceUser.tenantId, bobUser.tenantId);

  await assert.rejects(bob.rpc('venture.get'), code('VAULT_LOCKED'));
  await assert.rejects(bob.rpc('workspace.open', { businessId: made.businessId }), code('BUSINESS_NOT_FOUND'));
  assert.equal((await bob.post('/api/hosted/select', { businessId: made.businessId })).json.error.code, 'BUSINESS_NOT_FOUND');
  assert.equal((await bob.post('/api/hosted/select', { businessId: '../' + made.businessId })).json.error.code, 'BUSINESS_NOT_FOUND');
  await bob.rpc('workspace.create', { name: 'Bob Books', pack: 'services' });
  assert.equal(await bob.rpc('venture.get'), null, "Bob's business is his own empty vault");
  assert.ok((await alice.rpc('venture.get')).venture.id, "Alice's venture is still hers");

  const sealedA = aliceUser.businesses[0].sealedPassphrase;
  assert.throws(() => custody.unwrapPassphrase(bobUser.tenantId, aliceUser.businesses[0].id, sealedA), code('CUSTODY_INVALID'), "Alice's vault key never opens under Bob's tenant");
  assert.equal(typeof custody.unwrapPassphrase(aliceUser.tenantId, aliceUser.businesses[0].id, sealedA), 'string');
});

test('limits: businesses per account, rpc rate per session, and deleting a business needs its exact name', async t => {
  const { directory, signIn } = await startServer(t, { ...DEFAULT_LIMITS, businessesPerAccount: 1, rpcPerSession: { capacity: 40, refillEveryMs: 60_000 } });
  const owner = await signIn('limits@example.com');
  await owner.rpc('workspace.create', { name: 'Only One', pack: 'services' });
  await owner.rpc('workspace.lock');
  assert.equal((await owner.rpc('workspace.status')).open, false);
  await assert.rejects(owner.rpc('workspace.create', { name: 'Second', pack: 'services' }), code('LIMIT_REACHED'));
  const businessId = directory.read().users[0].businesses[0].id;
  await owner.rpc('workspace.open', { businessId });
  await assert.rejects(owner.rpc('workspace.delete', { confirmation: 'only one' }), code('CONFIRMATION_REQUIRED'));
  assert.deepEqual(await owner.rpc('workspace.delete', { confirmation: 'Only One' }), { deleted: true, copiesRemoved: 0, externalCopies: 'Copies made outside Chausar must be removed by their owner.' });
  assert.equal(directory.read().users[0].businesses.length, 0);
  assert.equal((await owner.rpc('workspace.status')).open, false);
  let limited: any = null;
  for (let i = 0; i < 60 && !limited; i++) { try { await owner.rpc('workspace.status'); } catch (error) { limited = error; } }
  assert.equal(limited?.code, 'RATE_LIMITED');
  assert.equal(limited?.status, 429);
});

// ---------------------------------------------------------------------------
// Ink v2 wave 4, package 4G3: phone alerts on the hosted app
// ---------------------------------------------------------------------------

test('phone alerts on the hosted app: the push switch and its contact come from the environment, checked (4G3)', () => {
  const key = randomBytes(32).toString('base64url');
  const live = { CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' };
  assert.deepEqual(hostedConfig(live).push, { subject: 'https://app.example.com' }, "the server's own https origin is the contact by default");
  assert.deepEqual(hostedConfig({ ...live, CHAUSAR_HOSTED_PUSH_CONTACT: 'mailto:alerts@example.com' }).push, { subject: 'mailto:alerts@example.com' });
  assert.deepEqual(hostedConfig({ CHAUSAR_HOSTED: '1' }, ['--dev']).push, { subject: null }, 'development over http has no contact rather than an invented one');
  assert.equal(hostedConfig({ ...live, CHAUSAR_HOSTED_PUSH: '0' }).push, null);
  assert.deepEqual(hostedConfig({ ...live, CHAUSAR_HOSTED_PUSH: '1' }).push, { subject: 'https://app.example.com' });
  for (const bad of [
    { CHAUSAR_HOSTED_PUSH: 'maybe' }, { CHAUSAR_HOSTED_PUSH_CONTACT: 'http://example.com' }, { CHAUSAR_HOSTED_PUSH_CONTACT: 'mailto:' },
    { CHAUSAR_HOSTED_PUSH_CONTACT: 'ftp://files.example.com' }, { CHAUSAR_HOSTED_PUSH_CONTACT: 'https://user:pw@example.com' }, { CHAUSAR_HOSTED_PUSH_CONTACT: 'mailto:a b@example.com' },
  ]) assert.throws(() => hostedConfig({ ...live, ...bad }), code('HOSTED_CONFIG_INVALID'), JSON.stringify(bad));
});

test('the push key pair comes from the custody key: the same on every server process, never written, only its public half leaves', () => {
  const master = randomBytes(32).toString('base64url');
  const one = hostedPushPort(HostedCustody.fromKey(master), 'mailto:alerts@example.com');
  const again = hostedPushPort(HostedCustody.fromKey(master), null);
  const other = hostedPushPort(HostedCustody.fromKey(randomBytes(32).toString('base64url')), null);
  assert.equal(one.publicKey, again.publicKey, 'subscriptions keep working after a restart or on another process');
  assert.notEqual(one.publicKey, other.publicKey);
  const point = Buffer.from(one.publicKey, 'base64url');
  assert.deepEqual([point.length, point[0]], [65, 4]);
  const publicKey = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: point.subarray(1, 33).toString('base64url'), y: point.subarray(33).toString('base64url') }, format: 'jwk' });
  const data = Buffer.from('header.claims');
  assert.ok(verify('sha256', data, { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(one.sign(data))));
  assert.deepEqual(Object.keys(one).sort(), ['publicKey', 'sign', 'subject'], 'nothing else rides on the port');
  assert.ok(Object.isFrozen(one));
  assert.equal(one.subject, 'mailto:alerts@example.com');
  assert.deepEqual(JSON.parse(JSON.stringify(one)), { publicKey: one.publicKey, subject: 'mailto:alerts@example.com' }, 'a log of the port shows no private half');
});

test('the owner watching: an open event stream is now, a closed one is when it closed, each business on its own (4G1, 4G3)', () => {
  let now = Date.parse('2026-10-15T10:00:00.000Z');
  const watch = new OwnerWatch(() => new Date(now));
  assert.equal(watch.at('t/b'), null);
  const first = watch.open('t/b'), second = watch.open('t/b');
  now += 60_000;
  assert.equal(watch.at('t/b'), new Date(now).toISOString());
  first(); first();
  now += 60_000;
  assert.equal(watch.at('t/b'), new Date(now).toISOString(), 'a release counts once, and one stream is still open');
  second();
  const closedAt = new Date(now).toISOString();
  assert.equal(watch.watching('t/b'), false);
  now += 5 * 60_000;
  assert.equal(watch.at('t/b'), closedAt);
  assert.equal(watch.at('t/other'), null);
  // A day after it closed, when it closed no longer matters to any alert rule: it is forgotten.
  now += 24 * 60 * 60_000;
  assert.equal(watch.at('t/b'), null);
  assert.equal(watch.size, 0, 'nothing kept for a business nobody watches');
});

test('web push through the hosted server: the key, a subscription on a known push service, the stream as watching, the tick, sw.js (4G3)', async t => {
  const { app, directory, signIn } = await startServer(t, DEFAULT_LIMITS, { push: true });
  const owner = await signIn('push@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  const { publicKey } = await owner.rpc('venture.notify.push.key');
  assert.equal(publicKey, app.options.push?.publicKey);
  const browser = createECDH('prime256v1');
  browser.generateKeys();
  const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/hosted-test', keys: { p256dh: browser.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, expirationTime: null };
  await assert.rejects(owner.rpc('venture.notify.push.subscribe', { subscription: { ...subscription, endpoint: 'https://push.example.com/x' } }), code('PUSH_ENDPOINT_REFUSED'));
  assert.equal((await owner.rpc('venture.notify.push.subscribe', { subscription })).subscribed, true);
  assert.equal((await owner.rpc('venture.notify.settings', {})).push, true);
  await assert.rejects(owner.rpc('venture.notify.relay', { url: 'https://ntfy.sh/x' }), code('TIER_UNAVAILABLE'));

  // The owner's open stream is the owner watching that business; closing it starts the two minutes of 4G1.
  const user = directory.read().users[0];
  const id = `${user.tenantId}/${user.businesses[0].id}`;
  const stream = owner.events();
  for (let i = 0; i < 200 && !app.watch.watching(id); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.watch.watching(id), true);
  stream.stop();
  for (let i = 0; i < 200 && app.watch.watching(id); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.watch.watching(id), false);
  assert.ok(app.watch.at(id), 'when the stream closed is kept for the wait');

  // The engine's tick runs for each awake business, so time alone can bring an alert while it is awake.
  assert.equal(await app.runtime.tick?.(), 1);

  const worker = await owner.get('/app/sw.js');
  assert.equal(worker.status, 200);
  assert.match(String(worker.headers['content-type']), /^text\/javascript/);
  assert.equal(worker.headers['cache-control'], 'no-store');
  assert.match(worker.text, /chausar-count/);
});

test('without a push key the hosted app says phone alerts are not set up, rather than pretending (4G3)', async t => {
  const { signIn } = await startServer(t);
  const owner = await signIn('nopush@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await assert.rejects(owner.rpc('venture.notify.push.key'), (error: any) => error.code === 'TIER_UNAVAILABLE' && /not set up on this server/.test(error.message));
});

// ---------------------------------------------------------------------------
// 4G3 review: the real chokepoint on the hosted app, a hanging push service, sessions and the tick's pace
// ---------------------------------------------------------------------------

type Captured = { url: URL; headers: Record<string, string>; body: Buffer };
/** The network guard's lookup and sender for the hosted engines: every push is kept here, nothing leaves this computer. */
function pushNetwork(hold?: Promise<void>) {
  const sent: Captured[] = [];
  return {
    sent,
    net: {
      resolve: async () => [{ address: '142.250.0.10', family: 4 as const }],
      send: async (target: { url: URL; headers: Record<string, string>; body: string | Uint8Array | undefined }) => {
        sent.push({ url: target.url, headers: target.headers, body: Buffer.from(target.body ?? '') });
        if (hold) await hold;
        return { status: 201, headers: {}, body: Buffer.alloc(0) };
      },
    },
  };
}

/** A browser's subscription and what it takes to read a push sent to it (RFC 8291). */
function pushBrowser(endpoint = 'https://fcm.googleapis.com/fcm/send/hosted-chokepoint') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  const read = (message: Buffer): string => {
    const hkdf = (salt: Buffer, ikm: Buffer, info: Buffer, length: number) => Buffer.from(hkdfSync('sha256', ikm, salt, info, length));
    const salt = message.subarray(0, 16), idLength = message[20], asPublic = message.subarray(21, 21 + idLength), sealed = message.subarray(21 + idLength);
    const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info'), Buffer.from([0]), ecdh.getPublicKey(), asPublic]), 32);
    const decipher = createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm'), Buffer.from([0])]), 16),
      hkdf(salt, ikm, Buffer.concat([Buffer.from('Content-Encoding: nonce'), Buffer.from([0])]), 12));
    decipher.setAuthTag(sealed.subarray(-16));
    const padded = Buffer.concat([decipher.update(sealed.subarray(0, -16)), decipher.final()]);
    return padded.subarray(0, padded.lastIndexOf(2)).toString('utf8');
  };
  return { subscription: { endpoint, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') }, expirationTime: null }, read };
}

/** The next 10:30 in Pune, outside quiet hours whatever the time of the run; never in the past, which the directory forgets. */
const nextMorningInPune = () => Date.now() + 86_400_000 - ((Date.now() - Date.parse('2026-01-01T05:00:00.000Z')) % 86_400_000);

const waitFor = async (done: () => boolean, what: string) => {
  for (let i = 0; i < 400 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(done(), what);
};

type Owner = Awaited<ReturnType<Awaited<ReturnType<typeof startServer>>['signIn']>>;
/** The hosted journey's AI, from the recording, and its interview answered: everything up to the plan's draft. */
async function readyToDraft(owner: Owner) {
  const presets = await owner.rpc('venture.models.presets');
  for (const [id, tiers] of [['anthropic-haiku-5-5', ['fast']], ['anthropic-sonnet-5-5', ['main']]] as const) {
    const preset = presets.find((p: any) => p.id === id);
    await owner.rpc('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest, apiKey: API_KEY, tiers });
  }
  await owner.rpc('venture.interview.next');
  for (const [questionId, answer] of [['q_1', { choiceId: 'c_1' }], ['q_2', { text: 'WhatsApp photos and a shared folder' }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }]] as const) {
    await owner.rpc('venture.interview.answer', { questionId, answer });
  }
}

test('the real chokepoint on the hosted app: the stream closes, the 2 minutes pass, the tick looks, and the push decrypts to {"count":N} (4G3)', async t => {
  let now = nextMorningInPune();
  const network = pushNetwork();
  const { app, signIn } = await startServer(t, DEFAULT_LIMITS, { push: true, clock: () => new Date(now), net: network.net });
  const owner = await signIn('chokepoint@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  const stream = owner.events();
  const user = app.options.directory.read().users[0];
  const id = `${user.tenantId}/${user.businesses[0].id}`;
  await waitFor(() => app.watch.watching(id), 'the stream is the owner watching');
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  const browser = pushBrowser();
  // The page cannot say which session asks: the hosted app adds it.
  await assert.rejects(owner.rpc('venture.notify.push.subscribe', { subscription: browser.subscription, session: 'a'.repeat(64) }), code('INVALID_REQUEST'));
  assert.equal((await owner.rpc('venture.notify.push.subscribe', { subscription: browser.subscription })).subscribed, true);
  await readyToDraft(owner);
  assert.equal(network.sent.length, 0, 'nothing goes out while the owner watches');

  stream.stop();
  await waitFor(() => !app.watch.watching(id), 'the stream closed');
  now += 30_000;
  // The plan's draft waits for the owner after they left: it waits out the 2 minutes.
  await owner.rpc('venture.blueprint.draft');
  const waiting = (await owner.rpc('venture.queue.list')).rows.filter((row: any) => row.kind !== 'locked').length;
  assert.ok(waiting > 0, 'something needs the owner');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(network.sent.length, 0, 'held for the 2 minutes after the owner looked');

  now += 3 * 60_000;
  assert.equal(await app.runtime.tick?.(), 1);
  await waitFor(() => network.sent.length === 1, 'the tick sent one push');
  const push = network.sent[0];
  assert.equal(push.url.href, browser.subscription.endpoint);
  assert.equal(push.headers.ttl, '3600');
  assert.equal(browser.read(push.body), JSON.stringify({ count: waiting }));
});

test('a push service that never answers never holds a hosted request, and the business stays awake until its push ends (4G3)', async t => {
  let release!: () => void;
  const network = pushNetwork(new Promise<void>(resolve => { release = resolve; }));
  t.after(() => release());
  let now = nextMorningInPune();
  const { app, signIn } = await startServer(t, DEFAULT_LIMITS, { push: true, net: network.net, clock: () => new Date(now) });
  const owner = await signIn('hanging@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await owner.rpc('venture.notify.push.subscribe', { subscription: pushBrowser().subscription });
  await readyToDraft(owner);
  // Nobody has the page open: the draft alerts at once, and that push never gets an answer.
  const started = Date.now();
  await owner.rpc('venture.blueprint.draft');
  await waitFor(() => network.sent.length === 1, 'the push is on its way');
  const answered = await Promise.race([owner.rpc('venture.notify.list').then(() => 'answered'), new Promise(resolve => { setTimeout(() => resolve('held'), 3_000).unref(); })]);
  assert.equal(answered, 'answered', 'the next request answers while the push waits');
  assert.ok(Date.now() - started < 3_000);
  // Idle long enough to sleep, but its push is still on the way: the vault stays open for it.
  now += DEFAULT_LIMITS.actorIdleMs + 60_000;
  assert.equal(await app.runtime.sleepIdle(), 0, 'not closed under a delivery');
  release();
  let slept = 0;
  for (let i = 0; i < 300 && slept === 0; i++) { await new Promise(resolve => setTimeout(resolve, 10)); slept = await app.runtime.sleepIdle(); }
  assert.equal(slept, 1, 'it sleeps once the delivery ended');
});

test('the hosted tick looks every minute: the engine notification gate is shorter than the 60 s housekeeping (4G3)', () => {
  assert.ok(NOTIFY_EVERY_MS < 60_000 && NOTIFY_EVERY_MS >= 50_000, String(NOTIFY_EVERY_MS));
});

test('a subscription belongs to the session that made it: signing out ends its alerts, and only that browser (4G3)', async t => {
  const network = pushNetwork();
  const { app, signIn } = await startServer(t, DEFAULT_LIMITS, { push: true, net: network.net });
  const owner = await signIn('session@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  const laptop = pushBrowser('https://fcm.googleapis.com/fcm/send/laptop');
  await owner.rpc('venture.notify.push.subscribe', { subscription: laptop.subscription });
  const phone = await signIn('session@example.com');
  await phone.rpc('workspace.open', { businessId: app.options.directory.read().users[0].businesses[0].id });
  const handset = pushBrowser('https://updates.push.services.mozilla.com/wpush/v2/handset');
  await phone.rpc('venture.notify.push.subscribe', { subscription: handset.subscription });
  await owner.post('/api/auth/sign-out', { everywhere: false });
  await app.pushSessionsEnding();
  // The laptop's subscription went with its session; the phone's stays, so removing it is removing the last one.
  assert.equal((await phone.rpc('venture.notify.settings', {})).push, true);
  assert.match((await phone.rpc('venture.notify.push.unsubscribe', { endpoint: handset.subscription.endpoint })).line, /Phone alerts are off/);
  assert.equal(network.sent.length, 0);
});


test('the Start gallery on the web app: the session\'s open business is "You run this" on its way (4J8)', async t => {
  const server = await startServer(t);
  const owner = await server.signIn('ways@example.com');
  const closed = await owner.rpc('venture.playbooks.list');
  assert.deepEqual(closed.ways.flatMap((way: any) => way.yours), [], 'no business open, none named');
  const created = await owner.rpc('workspace.create', { name: 'Lumen Studio', pack: 'services' });
  await owner.rpc('venture.create', { idea: 'Run a YouTube channel that explains personal finance in plain words', countryCode: 'IN', workingName: 'Lumen Studio' });
  const open = await owner.rpc('venture.playbooks.list');
  assert.deepEqual(open.ways.find((way: any) => way.playbook === 'youtube').yours, [{ businessId: created.businessId, name: 'Lumen Studio' }]);
  assert.deepEqual(open.ways.filter((way: any) => way.playbook !== 'youtube').flatMap((way: any) => way.yours), []);
  await assert.rejects(owner.rpc('venture.playbooks.list', { businesses: [] }), code('INVALID_VENTURE_REQUEST'));
  await owner.rpc('workspace.lock');
  assert.deepEqual((await owner.rpc('venture.playbooks.list')).ways.flatMap((way: any) => way.yours), [], 'a locked business is not named');
});

test('a signed-out browser gets nothing even when its business could not wake to delete it, and the next tick deletes it (4G3)', async t => {
  const network = pushNetwork();
  let failWakes = 1;
  // A runtime whose first attempt to end sessions fails, as a crash or a busy server would.
  const runtime: HostedAppOptions['runtime'] = options => {
    const local = new LocalVentureRuntime({ ...options, idleMs: DEFAULT_LIMITS.actorIdleMs, maxAwake: DEFAULT_LIMITS.awakeActors });
    return new Proxy(local, {
      get(target, property) {
        if (property === 'get') return (key: readonly [string, string]) => {
          const handle = target.get(key);
          return { ...handle, endPushSessions: async (hashes: readonly string[]) => {
            if (failWakes > 0) { failWakes -= 1; throw Object.assign(new Error('The server is busy right now.'), { code: 'HOSTED_BUSY' }); }
            return handle.endPushSessions!(hashes);
          } };
        };
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  const { app, signIn } = await startServer(t, DEFAULT_LIMITS, { push: true, net: network.net, runtime });
  const owner = await signIn('ended@example.com');
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await owner.rpc('venture.notify.push.subscribe', { subscription: pushBrowser().subscription });
  const phone = await signIn('ended@example.com');
  const businessId = app.options.directory.read().users[0].businesses[0].id;
  await phone.rpc('workspace.open', { businessId });
  await owner.post('/api/auth/sign-out', { everywhere: false });
  await app.pushSessionsEnding();
  // The business did not wake, so its record is still there; the account keeps the ended session, and it gets nothing.
  assert.deepEqual(app.options.directory.read().users[0].endedPushSessions?.map(item => item.pending), [[businessId]]);
  assert.equal((await phone.rpc('venture.notify.settings', {})).push, false, 'the ended browser does not count');
  // The next housekeeping round tries again, and once the business has deleted it, the account forgets the session.
  await app.retryEndedSessions();
  assert.equal(app.options.directory.read().users[0].endedPushSessions?.length ?? 0, 0);
  assert.equal(failWakes, 0);
  assert.equal(network.sent.length, 0);
});
