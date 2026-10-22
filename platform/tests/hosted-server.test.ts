// Hosted tier: the HTTP server, end to end over real sockets on this computer. Sign-in by email link, cookies,
// origin checks, the page's bearer, the method allow-list, two tenants that never meet, an event stream, and the
// venture journey through the hosted actor with synthetic recordings. No network beyond loopback, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedApp } from '../runtime/hosted/app.ts';
import { hostedConfig } from '../runtime/hosted/config.ts';
import { HostedCustody } from '../runtime/hosted/custody.ts';
import { FileDirectory } from '../runtime/hosted/directory.ts';
import { DEFAULT_LIMITS } from '../runtime/hosted/limits.ts';
import { DevOutbox } from '../runtime/hosted/mailer.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { createFixtureGitHubTransport } from '../runtime/venture/build/index.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';

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

async function startServer(t: any, limits = DEFAULT_LIMITS) {
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
  });
  // A small stand-in for the Ink build (app/ui/dist), listed the way startHosted lists the real one.
  const inkFolder = join(folder, 'ink'); await mkdir(join(inkFolder, 'assets'), { recursive: true });
  await writeFile(join(inkFolder, 'index.html'), '<!doctype html>\n<html lang="en">\n<head>\n  <title>Chausar</title>\n</head>\n<body></body>\n</html>\n');
  await writeFile(join(inkFolder, 'assets/index-abc.js'), 'export {};');
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
