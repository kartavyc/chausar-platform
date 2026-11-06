// Hosted tier, Ink v2 wave 4 (4J23, catalogue O25): starting without an account. Over real sockets on this computer: the
// off switch, a trial session and its one temporary business (one, even after a delete), the line on the session view,
// the end 7 days after the last use (an hour without a business) with the warning a day before, deletion with the vault
// and everything else the business left here, claiming by an email link (a new account or an existing one) or an
// existing account's passkey, TRIAL_LIMIT on invoices, payments, share links and alerts in the engine path, a size cap,
// AI only on the owner's own key, and the trial's own limits. No network beyond loopback, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import type { BankAccountRecord, ModelHttpRequest, ModelTransport, PaymentRecord, ShareLinkStoredRecord } from '../runtime/venture/contracts.ts';
import { HostedApp } from '../runtime/hosted/app.ts';
import { hostedConfig } from '../runtime/hosted/config.ts';
import { HostedCustody } from '../runtime/hosted/custody.ts';
import { FileDirectory } from '../runtime/hosted/directory.ts';
import { ConcurrencyGate, DEFAULT_LIMITS, RateLimiter, addressKey, type HostedLimits, type UsageEntry } from '../runtime/hosted/limits.ts';
import { DevOutbox } from '../runtime/hosted/mailer.ts';
import { hostedModelTransport } from '../runtime/hosted/models.ts';
import { hostedPushPort } from '../runtime/hosted/notify.ts';
import type { ActorKey, VentureRuntime } from '../runtime/hosted/runtime/contract.ts';
import { LocalVentureRuntime } from '../runtime/hosted/runtime/local.ts';
import { createHostedServer } from '../runtime/hosted/server.ts';
import { TRIAL_ENDED_LINE, TRIAL_ENDING_LINE, TRIAL_FULL_LINE, TRIAL_LINE, claimTrial, slideTrial } from '../runtime/hosted/trial.ts';
import { cappedSnapshotAdapter } from '../runtime/hosted/runtime/business.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import { createFixtureGitHubTransport } from '../runtime/venture/build/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { TRIAL_MONEY_LINE, TRIAL_SEND_LINE, trialRefusal, ventureAction } from '../runtime/venture/records.ts';
import { SoftAuthenticator } from './hosted-authenticator.ts';
import { CLIENT_NAME, owner as deskOwner, seedBlueprint, setup } from './venture-views-env.ts';

const ORIGIN = 'http://localhost:4397';
const HOST = 'localhost:4397';
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
// Made at run time, so nothing shaped like a provider key sits in the file.
const API_KEY = ['sk', 'ant', 'test', 'not', 'a', 'real', 'key', '0000'].join('-');
const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: any };

function browserClient(port: number, fixed: Record<string, string> = {}) {
  const jar = new Map<string, string>();
  let bearer: string | null = null;
  const send = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> => new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const base: Record<string, string> = { Host: HOST, ...fixed };
    if (method === 'POST') { base.Origin = ORIGIN; base['Content-Type'] = 'application/json'; base['Sec-Fetch-Site'] = 'same-origin'; }
    if (jar.size) base.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
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
    async session() { const reply = await send('GET', '/api/hosted/session'); assert.equal(reply.status, 200, reply.text); bearer = reply.json.token; return reply.json; },
    async rpc(method: string, payload: unknown = {}) {
      const reply = await send('POST', '/api/rpc', { method, payload }, bearer ? { Authorization: `Bearer ${bearer}` } : {});
      if (reply.json?.error) throw Object.assign(new Error(reply.json.error.message), { code: reply.json.error.code, status: reply.status });
      assert.equal(reply.status, 200, reply.text);
      return reply.json.result;
    },
    /** Opens the page's event stream (the owner watching); stop() closes it. */
    events() {
      const req = httpRequest({ host: '127.0.0.1', port, method: 'GET', path: '/api/hosted/events', headers: { Host: HOST, Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '), Accept: 'text/event-stream' } }, res => { res.resume(); });
      req.on('error', () => {});
      req.end();
      return { stop: () => req.destroy() };
    },
  };
}
type Browser = ReturnType<typeof browserClient>;

type ServerOptions = { limits?: HostedLimits; publicUrl?: string | null; push?: boolean; trials?: boolean; trustProxy?: boolean; proxyHops?: number };

async function startServer(t: any, options: ServerOptions = {}) {
  const limits = options.limits ?? DEFAULT_LIMITS;
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-trial-'));
  let nowMs = Date.now();
  const clock = () => new Date(nowMs);
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody, () => nowMs);
  const outbox = new DevOutbox();
  const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
  const githubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));
  // The recording answers every AI call; the spy keeps what each call carried, to show whose key it went out on.
  const replay = createReplayTransport(modelFixture);
  const sent: ModelHttpRequest[] = [];
  const modelTransport: ModelTransport = { replay: replay.replay, http: async request => { sent.push(structuredClone(request)); return replay.http(request); }, process: request => replay.process(request) };
  // The real local runtime, with a switch that makes one business's actions fail, as a vault that can't open would.
  const failing = new Map<string, Error>();
  const runtime = (runtimeOptions: any): VentureRuntime => {
    const real = new LocalVentureRuntime({ ...runtimeOptions, idleMs: limits.actorIdleMs, maxAwake: limits.awakeActors, clock: () => nowMs });
    return new Proxy(real, {
      get(target, prop) {
        if (prop === 'get') return (key: ActorKey) => {
          const handle = target.get(key);
          return { ...handle, action: (name: string, input: unknown, caller: any) => failing.has(key[1]) ? Promise.reject(failing.get(key[1])) : handle.action(name, input, caller) };
        };
        const value = (target as any)[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as VentureRuntime;
  };
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits, version: '0.1.0-preview.1', clock, runtime,
    modelTransport, githubTransport: () => createFixtureGitHubTransport(githubFixture, () => ({ briefId: '' })), trials: options.trials ?? true,
    ...(options.publicUrl ? { publicUrl: options.publicUrl } : {}),
    ...(options.push ? { push: hostedPushPort(custody, null) } : {}),
  });
  const http = createHostedServer(app, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: options.trustProxy ?? false, ...(options.proxyHops ? { proxyHops: options.proxyHops } : {}), maxBodyBytes: limits.maxBodyBytes });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(async () => { await http.close(); await rm(folder, { recursive: true, force: true }); });

  /** A visitor with no account: the sign-in page, then "start without an account". */
  const startTrial = async (fixed: Record<string, string> = {}): Promise<Browser & { started: any }> => {
    const browser = browserClient(port, fixed);
    assert.equal((await browser.get('/')).status, 200);
    const reply = await browser.post('/api/hosted/trial', {});
    assert.equal(reply.status, 200, reply.text);
    await browser.session();
    return Object.assign(browser, { started: reply.json });
  };
  const signIn = async (email: string, browser = browserClient(port)) => {
    assert.equal((await browser.get('/')).status, 200);
    assert.equal((await browser.post('/api/auth/magic-link', { email })).status, 200);
    const reply = await browser.post('/api/auth/magic-link/verify', { token: linkToken(email) });
    assert.equal(reply.status, 200, reply.text);
    await browser.session();
    return browser;
  };
  const linkToken = (email: string) => new URL(outbox.latest(email)!.link).hash.replace('#signin=', '');
  /** Waits for every directory change queued so far (a session's touch is written after its answer). */
  const settled = () => directory.update(() => {});
  return {
    app, port, outbox, directory, folder, sent, failing, startTrial, signIn, linkToken, settled,
    advance: (ms: number) => { nowMs += ms; }, now: () => nowMs,
  };
}

/** The plan accepted, with the owner's own key for the AI (the recording answers it). */
async function planAccepted(browser: Browser, name = 'Ledger Cafe Books') {
  const made = await browser.rpc('workspace.create', { name, pack: 'services' });
  await browser.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: name });
  const presets = await browser.rpc('venture.models.presets');
  for (const [presetId, tier] of [['anthropic-haiku-5-5', 'fast'], ['anthropic-sonnet-5-5', 'main']] as const) {
    await browser.rpc('venture.models.connect', { presetId, consentDigest: presets.find((p: any) => p.id === presetId).consentDigest, apiKey: API_KEY, tiers: [tier] });
  }
  await browser.rpc('venture.interview.next');
  for (const [questionId, answer] of [['q_1', { choiceId: 'c_1' }], ['q_2', { text: 'WhatsApp photos and a shared folder' }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }]] as const) {
    await browser.rpc('venture.interview.answer', { questionId, answer });
  }
  await browser.rpc('venture.blueprint.draft');
  const updated = (await browser.rpc('venture.blueprint.update', { patch: { taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' } })).blueprint;
  await browser.rpc('venture.blueprint.accept', { digest: updated.digest });
  return made.businessId as string;
}

/** A draft ready for review, for a client share link. */
async function readyDraft(browser: Browser): Promise<string> {
  const client = await browser.rpc('venture.client.add', { name: 'Cafe Aroma' });
  const order = await browser.rpc('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Please close my September books.' });
  const run = await browser.rpc('venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.equal(run.status, 'ready-for-review');
  return run.id;
}

const exists = (path: string) => stat(path).then(() => true, () => false);
const pushSubscription = () => {
  const browserKey = createECDH('prime256v1'); browserKey.generateKeys();
  return { endpoint: `https://fcm.googleapis.com/fcm/send/trial-${randomBytes(4).toString('hex')}`, keys: { p256dh: browserKey.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }, expirationTime: null };
};

// ---------------------------------------------------------------------------
// The switch and the settings
// ---------------------------------------------------------------------------

test('trials are off unless asked for outside development, and their limits come from the environment, checked', () => {
  const key = randomBytes(32).toString('base64url');
  const live = { CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' };
  assert.equal(hostedConfig(live).trials, false, 'off by default on a real server');
  assert.equal(hostedConfig({ CHAUSAR_HOSTED: '1' }, ['--dev']).trials, true, 'on by default in development');
  assert.equal(hostedConfig({ ...live, CHAUSAR_HOSTED_TRIALS: '1' }).trials, true);
  assert.equal(hostedConfig({ CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_TRIALS: '0' }, ['--dev']).trials, false);
  const set = hostedConfig({ ...live, CHAUSAR_HOSTED_TRIALS: '1', CHAUSAR_HOSTED_TRIALS_LIVE: '40', CHAUSAR_HOSTED_TRIAL_IDLE_DAYS: '3',
    CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS: '500000', CHAUSAR_HOSTED_TRIAL_VAULT_BYTES: '2097152' }).limits;
  assert.deepEqual([set.trialsLive, set.trialIdleMs, set.trialModelCeilingMicros, set.trialVaultBytes], [40, 3 * DAY, '500000', 2097152]);
  for (const bad of [
    { CHAUSAR_HOSTED_TRIALS: 'yes' }, { CHAUSAR_HOSTED_TRIALS_LIVE: '0' }, { CHAUSAR_HOSTED_TRIALS_LIVE: 'many' }, { CHAUSAR_HOSTED_TRIAL_IDLE_DAYS: '31' },
    { CHAUSAR_HOSTED_TRIAL_IDLE_DAYS: '1.5' }, { CHAUSAR_HOSTED_TRIAL_AI_CEILING_MICROS: '2 dollars' }, { CHAUSAR_HOSTED_TRIAL_VAULT_BYTES: '1000' },
  ]) assert.throws(() => hostedConfig({ ...live, ...bad }), code('HOSTED_CONFIG_INVALID'), JSON.stringify(bad));
});

test('with trials off the route answers HOSTED_NOT_AVAILABLE and the session view says trials: false', async t => {
  const { port, signIn } = await startServer(t, { trials: false });
  const visitor = browserClient(port);
  await visitor.get('/');
  const refused = await visitor.post('/api/hosted/trial', {});
  assert.deepEqual([refused.status, refused.json.error.code], [400, 'HOSTED_NOT_AVAILABLE']);
  const owner = await signIn('owner@example.com');
  assert.equal((await owner.session()).me.trials, false);
  // 4J21: the sign-in page asks the public health check before anyone signs in, and offers no trial start.
  assert.equal((await visitor.get('/api/health')).json.trials, false);
});

test('4J21: the public health check says trials are on, so the sign-in page can offer "Start without an account"', async t => {
  const { port } = await startServer(t);
  const visitor = browserClient(port);
  const health = await visitor.get('/api/health');
  // With how long a temporary business lasts after its last use (7 days with a business, an hour before it has one).
  assert.deepEqual(health.json, { status: 'ok', mode: 'hosted-experimental', trials: true, trialIdleDays: 7, trialEmptyMinutes: 60 });
  // Nothing about a person is in it, and no cookie is set by asking.
  assert.equal(health.headers['set-cookie'], undefined);
});

// ---------------------------------------------------------------------------
// Starting
// ---------------------------------------------------------------------------

test('POST /api/hosted/trial starts a business without an account: a trial session, one temporary business ever, the line on the session view', async t => {
  const { port, directory, startTrial, signIn, now } = await startServer(t);
  const visitor = await startTrial();
  const started = visitor.started;
  assert.deepEqual([started.created, started.user.email, started.session.method, started.session.businessId], [true, '', 'trial', null]);
  // With no business yet it lasts an hour from its last use; no warning is shown for it.
  assert.deepEqual(started.trial, { temporary: true, line: TRIAL_LINE, expiresAt: new Date(now() + HOUR).toISOString(), endsSoon: false, warning: null });
  const token = visitor.jar.get('chausar-session')!;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(JSON.stringify(started).includes(token), false, 'the session token never appears in a body');

  const view = await visitor.session();
  assert.deepEqual([view.me.trial, view.me.limits.businesses, view.me.trials], [started.trial, 1, true]);
  const [user] = directory.read().users;
  assert.deepEqual([user.email, user.passkeys.length, user.businesses.length, typeof user.trial?.expiresAt], ['', 0, 0, 'string']);
  assert.deepEqual(directory.read().sessions.map(s => [s.userId, s.method]), [[user.id, 'trial']]);
  assert.equal(directory.read().magicLinks.length, 0, 'no email anywhere');
  assert.equal(JSON.stringify(directory.read()).includes('127.0.0.1'), false, 'no network address is kept');

  // Its business: 7 days from the last use from now on. One per trial, even after deleting it.
  const made = await visitor.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  assert.equal((await visitor.rpc('workspace.status')).hosted.trial.expiresAt, new Date(now() + 7 * DAY).toISOString());
  assert.equal(directory.read().users[0].trial!.businessStartedAt, new Date(now()).toISOString());
  await visitor.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  await assert.rejects(visitor.rpc('workspace.create', { name: 'A second one', pack: 'services' }), code('TRIAL_LIMIT'));
  await visitor.rpc('workspace.delete', { confirmation: 'Ledger Cafe Books' });
  await assert.rejects(visitor.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' }), code('TRIAL_LIMIT'));
  assert.deepEqual(directory.read().users[0].businesses, []);
  assert.equal(directory.read().users[0].trial!.expiresAt, new Date(now() + HOUR).toISOString(), 'without its business it lasts an hour');
  void made;

  // The same browser asking again gets its own trial back, never a second one.
  const again = await visitor.post('/api/hosted/trial', {});
  assert.deepEqual([again.status, again.json.created, again.json.user.id], [200, false, user.id]);
  assert.equal(directory.read().users.length, 1);

  // A trial adds a passkey only once it has an email; a signed-in account starts businesses from the account.
  assert.equal((await visitor.post('/api/auth/passkey/register/options', {})).json.error.code, 'TRIAL_LIMIT');
  const owner = await signIn('owner@example.com');
  assert.equal((await owner.post('/api/hosted/trial', {})).json.error.code, 'ALREADY_SIGNED_IN');
  const stranger = browserClient(port);
  assert.equal((await stranger.post('/api/hosted/trial', { name: 'x' })).json.error.code, 'INVALID_REQUEST');
  assert.equal((await stranger.post('/api/hosted/trial', {}, { Origin: 'https://evil.test' })).json.error.code, 'INVALID_ORIGIN');
  assert.equal((await stranger.post('/api/hosted/trial/claim', { email: 'a@example.com' })).status, 401);
});

test('the trial limits: starts per network (IPv6 by /64, the address the proxy added), trials at once before a start is spent, and a slower request rate', async t => {
  // Behind a trusted proxy the address is the entry the proxy appended, never the leftmost one a browser can write.
  const proxied = await startServer(t, { trustProxy: true, limits: { ...DEFAULT_LIMITS, trialStartsPerAddress: { capacity: 2, refillEveryMs: HOUR } } });
  const from = (spoofed: string, real: string) => ({ 'X-Forwarded-For': `${spoofed}, ${real}` });
  await proxied.startTrial(from('9.9.9.9', '2001:db8:a:b::1'));
  await proxied.startTrial(from('8.8.8.8', '2001:db8:a:b:ffff:1:2:3'));
  const third = browserClient(proxied.port, from('7.7.7.7', '2001:0db8:000a:000b::9'));
  await third.get('/');
  const refused = await third.post('/api/hosted/trial', {});
  assert.deepEqual([refused.status, refused.json.error.code], [429, 'RATE_LIMITED'], 'one /64 is one network');
  assert.ok(Number(refused.headers['retry-after']) > 0);
  await proxied.startTrial(from('7.7.7.7', '2001:db8:a:c::1'));
  assert.deepEqual([addressKey('::ffff:192.0.2.7'), addressKey('2001:db8::1'), addressKey('2001:DB8:0:0:1::1'), addressKey('192.0.2.7')],
    ['192.0.2.7', '2001:db8:0:0::/64', '2001:db8:0:0::/64', '192.0.2.7']);

  // The server's room is checked before a start is spent: a full server says so, not "too many from your network".
  const full = await startServer(t, { limits: { ...DEFAULT_LIMITS, trialsLive: 1, trialStartsPerAddress: { capacity: 1, refillEveryMs: HOUR } } });
  await full.startTrial();
  const second = browserClient(full.port);
  await second.get('/');
  const busy = await second.post('/api/hosted/trial', {});
  assert.deepEqual([busy.status, busy.json.error.code], [503, 'HOSTED_BUSY']);
  assert.match(busy.json.error.message, /Sign in with your email/);

  // A trial's session asks more slowly than an account's.
  const slow = await startServer(t, { limits: { ...DEFAULT_LIMITS, trialRpcPerSession: { capacity: 3, refillEveryMs: HOUR } } });
  const visitor = await slow.startTrial();
  for (let i = 0; i < 3; i++) await visitor.rpc('workspace.status');
  await assert.rejects(visitor.rpc('workspace.status'), code('RATE_LIMITED'));
  const owner = await slow.signIn('owner@example.com');
  for (let i = 0; i < 5; i++) await owner.rpc('workspace.status');
});

test('rate buckets are swept, so a network address is held no longer than its window', () => {
  let now = 0;
  const limiter = new RateLimiter('sweep', { capacity: 2, refillEveryMs: MINUTE }, () => now);
  limiter.take('2001:db8:0:0::/64'); limiter.take('192.0.2.7'); limiter.take('192.0.2.7');
  assert.equal(limiter.size, 2);
  now += MINUTE;
  assert.equal(limiter.sweep(), 1, 'the one back to full goes');
  now += MINUTE;
  assert.deepEqual([limiter.sweep(), limiter.size], [1, 0]);
});

// ---------------------------------------------------------------------------
// The end
// ---------------------------------------------------------------------------

test('a trial ends 7 days after its last use: a day before, the session view says so; then it is deleted with its vault and all it left here', async t => {
  const { app, port, directory, folder, startTrial, advance, now, settled, signIn } = await startServer(t, { push: true });
  const visitor = await startTrial();
  const businessId = await planAccepted(visitor);
  assert.equal((await visitor.rpc('venture.notify.push.subscribe', { subscription: pushSubscription() })).subscribed, true);
  assert.equal((await visitor.post('/api/hosted/trial/claim', { email: 'later@example.com' })).status, 200, 'a claim link asked for, never opened');
  const user = directory.read().users[0];
  const id = `${user.tenantId}/${businessId}`;
  assert.ok((directory.read().usage[user.tenantId] ?? []).length > 0, 'the AI calls on the owner key are in the ledger');
  assert.equal(await exists(join(folder, 'tenants', user.tenantId, businessId)), true);
  const stream = visitor.events();
  for (let i = 0; i < 200 && !app.watch.watching(id); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(app.watch.watching(id), true);
  stream.stop();
  for (let i = 0; i < 200 && app.watch.watching(id); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(app.watch.at(id), 'when the owner last watched is kept');

  // Six days and a bit later: nothing is deleted yet, and the session view warns a day before.
  advance(6 * DAY + HOUR);
  assert.equal(await app.expireTrials(), 0);
  const soon = await visitor.session();
  assert.deepEqual([soon.me.trial.endsSoon, soon.me.trial.warning, soon.me.trial.line], [true, TRIAL_ENDING_LINE, TRIAL_LINE]);
  // That look was a use: the 7 days start again from it.
  await settled();
  assert.equal(directory.read().users[0].trial!.expiresAt, new Date(now() + 7 * DAY).toISOString());
  const later = await visitor.session();
  assert.deepEqual([later.me.trial.endsSoon, later.me.trial.warning], [false, null]);

  // 7 days with no use: the cookie opens nothing and says why, even after other changes to the directory.
  advance(7 * DAY + MINUTE);
  await signIn('someone@example.com');
  const ended = await visitor.get('/api/hosted/session');
  assert.deepEqual([ended.status, ended.json.error.message], [401, TRIAL_ENDED_LINE]);
  assert.equal(await app.expireTrials(), 1);
  const state = directory.read();
  assert.equal(state.users.some(u => u.id === user.id || u.tenantId === user.tenantId), false, 'the account, with its sealed vault keys');
  assert.equal(state.sessions.some(s => s.userId === user.id), false, 'its sessions');
  assert.equal(state.challenges.some(c => c.userId === user.id), false, 'its passkey challenges');
  assert.equal(state.magicLinks.some(link => link.claimUserId === user.id), false, 'its claim links');
  assert.equal(state.usage[user.tenantId], undefined, 'its AI usage ledger');
  assert.equal(await exists(join(folder, 'tenants', user.tenantId)), false, 'its vault (with the push subscription inside) and its tenant folder');
  assert.equal(app.runtime.state([user.tenantId, businessId]), 'asleep');
  assert.equal(app.watch.at(id), null, 'whether its owner was watching');
  assert.equal(await app.expireTrials(), 0);
  void port;
});

test('a trial with no business ends an hour after its last use; each housekeeping round ends a few at most', async t => {
  const { app, directory, startTrial, advance } = await startServer(t, { limits: { ...DEFAULT_LIMITS, trialEndsPerRound: 1 } });
  await startTrial(); await startTrial();
  advance(59 * MINUTE);
  assert.equal(await app.expireTrials(), 0);
  advance(2 * MINUTE);
  assert.equal(await app.expireTrials(), 1, 'one per round here');
  assert.equal(await app.expireTrials(), 1);
  assert.deepEqual(directory.read().users, []);
});

test('a trial being deleted can no longer be claimed or kept alive, and a vault that does not open is removed, but only for a known reason', async t => {
  const { app, directory, folder, failing, startTrial, linkToken, advance, now } = await startServer(t);
  // Ending marks the trial first: from then on a claim link signs in without keeping it, and a use does not move its end.
  const visitor = await startTrial();
  await visitor.rpc('workspace.create', { name: 'Ending Soon', pack: 'services' });
  await visitor.post('/api/hosted/trial/claim', { email: 'late@example.com' });
  const trialId = directory.read().users[0].id;
  await directory.update(state => { state.users[0].trial!.endingAt = new Date(now()).toISOString(); });
  const verified = await visitor.post('/api/auth/magic-link/verify', { token: linkToken('late@example.com') });
  assert.deepEqual([verified.status, verified.json.claimed, verified.json.created], [200, undefined, true], 'signed in, nothing kept');
  const draft = structuredClone(directory.read());
  const before = draft.users.find(u => u.id === trialId)!.trial!.expiresAt;
  slideTrial(draft, trialId, now() + DAY, DEFAULT_LIMITS);
  assert.equal(draft.users.find(u => u.id === trialId)!.trial!.expiresAt, before);
  assert.equal(claimTrial(draft, trialId, 'late@example.com', null, DEFAULT_LIMITS, now()), null);
  assert.equal(await app.expireTrials(), 1, 'a trial marked as ending is finished on the next round');
  assert.equal(directory.read().users.some(u => u.id === trialId), false);

  // A vault that fails with no known reason is tried again; one that can't be unlocked is removed from disk.
  const broken = await startTrial();
  const made = await broken.rpc('workspace.create', { name: 'Broken Vault', pack: 'services' });
  const tenant = directory.read().users.find(u => u.trial)!.tenantId;
  advance(7 * DAY + MINUTE);
  failing.set(made.businessId, new Error('socket hang up'));
  assert.equal(await app.expireTrials(), 0);
  assert.ok(directory.read().users.some(u => u.tenantId === tenant), 'kept for the next round');
  failing.set(made.businessId, new ChausarError('UNLOCK_FAILED', 'Unable to unlock vault.'));
  assert.equal(await app.expireTrials(), 1);
  assert.equal(directory.read().users.some(u => u.tenantId === tenant), false);
  assert.equal(await exists(join(folder, 'tenants', tenant)), false);
});

// ---------------------------------------------------------------------------
// Claiming
// ---------------------------------------------------------------------------

test('claiming by email link: a new email makes the trial that account, keeps the business, clears the expiry and ends its phone alerts', async t => {
  const { app, port, outbox, directory, startTrial, signIn, linkToken, advance } = await startServer(t, { push: true });
  const visitor = await startTrial();
  const made = await visitor.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await visitor.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  assert.equal((await visitor.rpc('venture.notify.push.subscribe', { subscription: pushSubscription() })).subscribed, true);
  assert.equal((await visitor.rpc('venture.notify.settings', {})).push, true);
  const trialUser = directory.read().users[0];
  const trialToken = visitor.jar.get('chausar-session')!;

  const asked = await visitor.post('/api/hosted/trial/claim', { email: ' New.Owner@Example.com ' });
  assert.deepEqual([asked.status, asked.json], [200, { sent: true, delivers: false }]);
  const mail = outbox.latest('new.owner@example.com')!;
  assert.match(mail.link, /^http:\/\/localhost:4397\/#signin=[A-Za-z0-9_-]{43}$/, 'the existing sign-in link pattern: no email and no query string');
  assert.match(mail.text, /keep the business you started/);
  const other = browserClient(port);
  await other.get('/');
  assert.equal((await other.post('/api/auth/magic-link/verify', { token: linkToken('new.owner@example.com') })).json.error.code, 'MAGIC_LINK_OTHER_BROWSER');

  const verified = await visitor.post('/api/auth/magic-link/verify', { token: linkToken('new.owner@example.com') });
  assert.equal(verified.status, 200, verified.text);
  assert.deepEqual([verified.json.claimed, verified.json.created, verified.json.session.method, verified.json.session.businessId], [true, true, 'magic-link', made.businessId]);
  const me = (await visitor.session()).me;
  assert.deepEqual([me.trial, me.user.email, me.user.businesses.map((b: any) => b.id), me.limits.businesses], [null, 'new.owner@example.com', [made.businessId], DEFAULT_LIMITS.businessesPerAccount]);
  const [user] = directory.read().users;
  assert.deepEqual([user.id, user.tenantId, user.trial, user.businesses[0].vaultTenantId], [trialUser.id, trialUser.tenantId, undefined, undefined], 'the same account and tenant: the vault stays where it is');
  assert.ok(user.verifiedAt);
  assert.equal((await visitor.rpc('venture.get')).venture.workingName, 'Ledger Cafe Books');
  // The trial session ended with the claim, and with it the phone alerts it turned on: the page turns them on again.
  await app.pushSessionsEnding();
  assert.equal((await visitor.rpc('venture.notify.settings', {})).push, false);
  const stale = browserClient(port);
  stale.jar.set('chausar-session', trialToken);
  assert.equal((await stale.get('/api/hosted/session')).status, 401);

  advance(8 * DAY);
  assert.equal(await app.expireTrials(), 0);
  assert.deepEqual(directory.read().users[0].businesses.map(b => b.id), [made.businessId]);
  const kept = await signIn('new.owner@example.com');
  assert.equal((await kept.post('/api/hosted/trial/claim', { email: 'x@example.com' })).json.error.code, 'NOT_A_TRIAL');
});

test('a trial sends at most three claim links', async t => {
  const { startTrial } = await startServer(t);
  const visitor = await startTrial();
  for (const email of ['one@example.com', 'two@example.com', 'three@example.com']) assert.equal((await visitor.post('/api/hosted/trial/claim', { email })).status, 200);
  const fourth = await visitor.post('/api/hosted/trial/claim', { email: 'four@example.com' });
  assert.deepEqual([fourth.status, fourth.json.error.code], [400, 'LIMIT_REACHED']);
});

test('claiming by email link into an existing account moves the business there: its vault stays put, it wakes from sleep, its share links and ledger follow', async t => {
  const { app, port, outbox, directory, startTrial, signIn, linkToken, advance } = await startServer(t, { publicUrl: ORIGIN, limits: { ...DEFAULT_LIMITS, businessesPerAccount: 2 } });
  const alice = await signIn('alice@example.com');
  await alice.rpc('workspace.create', { name: 'Alice Books', pack: 'services' });
  const visitor = await startTrial();
  const businessId = await planAccepted(visitor, 'Trial Studio');
  const deliveryId = await readyDraft(visitor);
  const trialUser = directory.read().users.find(u => u.trial)!;
  const trialCalls = (directory.read().usage[trialUser.tenantId] ?? []).map(entry => entry.callId);
  assert.ok(trialCalls.length > 0);

  // The answer is the same whether or not the email has an account.
  const asked = await visitor.post('/api/hosted/trial/claim', { email: 'alice@example.com' });
  assert.deepEqual(asked.json, { sent: true, delivers: false });
  const verified = await visitor.post('/api/auth/magic-link/verify', { token: linkToken('alice@example.com') });
  assert.equal(verified.status, 200, verified.text);
  const aliceUser = directory.read().users.find(u => u.email === 'alice@example.com')!;
  assert.deepEqual([verified.json.claimed, verified.json.created, verified.json.user.id, verified.json.session.businessId], [true, false, aliceUser.id, businessId]);
  const state = directory.read();
  assert.equal(state.users.some(u => u.id === trialUser.id), false, 'the trial account is gone');
  assert.equal(state.sessions.some(s => s.userId === trialUser.id), false);
  const moved = aliceUser.businesses.find(b => b.id === businessId)!;
  assert.deepEqual([aliceUser.businesses.length, moved.name, moved.vaultTenantId], [2, 'Trial Studio', trialUser.tenantId]);
  assert.deepEqual((state.usage[aliceUser.tenantId] ?? []).map(entry => entry.callId).filter(id => trialCalls.includes(id)).sort(), [...trialCalls].sort(), "the trial's AI spend counts toward the account's ceiling");
  assert.equal(state.usage[trialUser.tenantId], undefined);

  // Kept, it shares with clients like any business; its link works on the account.
  await visitor.session();
  const share = await visitor.rpc('venture.share.create', { deliveryId });
  const shareToken = /\/share\/([A-Za-z0-9_-]{32})$/.exec(share.url)![1];
  assert.equal(directory.read().shareLinks![0].tenantId, trialUser.tenantId, 'the link names the vault where it is');
  assert.equal((await browserClient(port).get(`/share/${shareToken}`)).status, 200);

  // Asleep, it wakes with the key sealed under the trial's tenant, from this browser and from Alice's other one.
  advance(DEFAULT_LIMITS.actorIdleMs + MINUTE);
  assert.ok(await app.runtime.sleepIdle() >= 1);
  assert.equal(app.runtime.state([trialUser.tenantId, businessId]), 'asleep');
  assert.equal((await browserClient(port).get(`/share/${shareToken}`)).status, 200, 'the share page wakes it');
  advance(DEFAULT_LIMITS.actorIdleMs + MINUTE);
  assert.ok(await app.runtime.sleepIdle() >= 1);
  assert.equal(app.runtime.state([trialUser.tenantId, businessId]), 'asleep');
  assert.equal((await visitor.rpc('workspace.status')).workspace.name, 'Trial Studio');
  assert.equal((await visitor.rpc('venture.get')).venture.workingName, 'Trial Studio');
  await alice.rpc('workspace.open', { businessId });
  assert.equal((await alice.rpc('venture.get')).venture.workingName, 'Trial Studio');
  advance(8 * DAY);
  assert.equal(await app.expireTrials(), 0);

  // An account at its limit can't take one more: the link stays unused until there is room.
  const again = await signIn('alice@example.com');
  const second = await startTrial();
  await second.rpc('workspace.create', { name: 'Third One', pack: 'services' });
  await second.post('/api/hosted/trial/claim', { email: 'alice@example.com' });
  const token = linkToken('alice@example.com');
  const full = await second.post('/api/auth/magic-link/verify', { token });
  assert.deepEqual([full.status, full.json.error.code], [400, 'LIMIT_REACHED']);
  await again.rpc('workspace.open', { businessId });
  await again.rpc('workspace.delete', { confirmation: 'Trial Studio' });
  assert.equal(directory.read().users.find(u => u.email === 'alice@example.com')!.businesses.length, 1, 'a moved business deletes like any other');
  assert.deepEqual(directory.read().shareLinks ?? [], []);
  const roomy = await second.post('/api/auth/magic-link/verify', { token });
  assert.deepEqual([roomy.status, roomy.json.claimed], [200, true]);
  assert.ok(outbox.messages.length >= 3);
});

test("claiming with an existing account's passkey moves the business to that account", async t => {
  const { directory, startTrial, signIn } = await startServer(t);
  const alice = await signIn('alice@example.com');
  const authenticator = new SoftAuthenticator();
  const options = await alice.post('/api/auth/passkey/register/options', {});
  assert.equal(options.status, 200, options.text);
  const registered = await alice.post('/api/auth/passkey/register/verify', { credential: authenticator.create(options.json, { origin: ORIGIN }), name: 'Laptop' });
  assert.equal(registered.status, 200, registered.text);

  const visitor = await startTrial();
  const made = await visitor.rpc('workspace.create', { name: 'Passkey Studio', pack: 'services' });
  await visitor.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Passkey Studio' });
  const trialUser = directory.read().users.find(u => u.trial)!;
  assert.equal((await alice.post('/api/hosted/trial/claim/passkey', { credential: {} })).json.error.code, 'NOT_A_TRIAL');

  const login = await visitor.post('/api/auth/passkey/login/options', {});
  assert.equal(login.status, 200, login.text);
  const claimed = await visitor.post('/api/hosted/trial/claim/passkey', { credential: authenticator.get(login.json, { origin: ORIGIN }) });
  assert.equal(claimed.status, 200, claimed.text);
  const aliceUser = directory.read().users.find(u => u.email === 'alice@example.com')!;
  assert.deepEqual([claimed.json.claimed, claimed.json.user.id, claimed.json.session.method, claimed.json.session.businessId], [true, aliceUser.id, 'passkey', made.businessId]);
  assert.equal(directory.read().users.some(u => u.id === trialUser.id), false);
  assert.equal(aliceUser.businesses.find(b => b.id === made.businessId)?.vaultTenantId, trialUser.tenantId);
  await visitor.session();
  assert.equal((await visitor.rpc('venture.get')).venture.workingName, 'Passkey Studio');
});

// ---------------------------------------------------------------------------
// What a trial can't do
// ---------------------------------------------------------------------------

test('a trial issues no invoice, records no payment and publishes or sends nothing from the server (TRIAL_LIMIT), whichever way it asks; once kept, it can', async t => {
  const { app, directory, sent, startTrial, linkToken } = await startServer(t, { publicUrl: ORIGIN });
  const visitor = await startTrial();
  const businessId = await planAccepted(visitor);
  // Every AI call the trial made went out on the owner's own key.
  assert.ok(sent.length > 0);
  assert.ok(sent.every(request => request.headers['x-api-key'] === API_KEY), 'only the key the owner connected');

  const client = await visitor.rpc('venture.client.add', { name: CLIENT_NAME });
  const order = await visitor.rpc('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Please close my September books.' });
  const draft = (await visitor.rpc('venture.invoice.prepare', { orderId: order.id, dueInDays: 15 })).invoice;
  assert.equal(draft.status, 'draft', 'a draft invoice is fine');
  await assert.rejects(visitor.rpc('venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest }), (error: any) => error.code === 'TRIAL_LIMIT' && error.message === TRIAL_MONEY_LINE);
  for (const method of ['venture.payment.record', 'venture.payment.clear', 'venture.credit.issue', 'venture.bills.pay']) await assert.rejects(visitor.rpc(method, {}), code('TRIAL_LIMIT'), method);
  for (const method of ['venture.share.create', 'venture.share.request', 'venture.bank.alerts.set']) {
    await assert.rejects(visitor.rpc(method, {}), (error: any) => error.code === 'TRIAL_LIMIT' && error.message === TRIAL_SEND_LINE, method);
  }
  // Issue on Today goes another way in; the engine's own write path refuses it there.
  const row = (await visitor.rpc('venture.queue.list')).rows.find((item: any) => item.kind === 'invoice');
  assert.ok(row);
  const decision = await visitor.rpc('venture.queue.decide', { id: row.id, digest: row.digest, action: 'issue' });
  assert.deepEqual([decision.outcome, decision.reason], ['refused', 'TRIAL_LIMIT']);
  assert.equal((await visitor.rpc('venture.invoice.get', { invoiceId: draft.id })).invoice.status, 'draft');

  // Kept by an email link, the same business issues it for real.
  await visitor.post('/api/hosted/trial/claim', { email: 'books@example.com' });
  assert.equal((await visitor.post('/api/auth/magic-link/verify', { token: linkToken('books@example.com') })).status, 200);
  await visitor.session();
  const issued = await visitor.rpc('venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest });
  assert.equal(issued.invoice.number, 'INV-0001');

  // A business no account holds counts as temporary, so its engine refuses real money rather than letting it through.
  const next = (await visitor.rpc('venture.invoice.prepare', { orderId: (await visitor.rpc('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'October too, please.' })).id, dueInDays: 15 })).invoice;
  const user = directory.read().users.find(u => u.businesses.some(b => b.id === businessId))!;
  await directory.update(state => { const owner = state.users.find(u => u.id === user.id)!; owner.businesses = owner.businesses.filter(b => b.id !== businessId); });
  await assert.rejects(app.runtime.get([user.tenantId, businessId]).action('venture.invoice.issue', { invoiceId: next.id, digest: next.digest }, { channel: 'web' }), code('TRIAL_LIMIT'));
});

test('a trial vault has a size cap in the vault store itself: a model call that would pass it is refused before it leaves', async t => {
  const limits: HostedLimits = { ...DEFAULT_LIMITS };
  const { directory, folder, sent, startTrial, signIn } = await startServer(t, { limits });
  const visitor = await startTrial();
  const made = await visitor.rpc('workspace.create', { name: 'Small Vault', pack: 'services' });
  await visitor.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Small Vault' });
  const presets = await visitor.rpc('venture.models.presets');
  for (const [presetId, tier] of [['anthropic-haiku-5-5', 'fast'], ['anthropic-sonnet-5-5', 'main']] as const) {
    await visitor.rpc('venture.models.connect', { presetId, consentDigest: presets.find((p: any) => p.id === presetId).consentDigest, apiKey: API_KEY, tiers: [tier] });
  }
  // The cap set just above what the vault holds now, as an 8 MB vault would be just before its next write.
  const tenant = directory.read().users.find(u => u.trial)!.tenantId;
  const vaultFile = join(folder, 'tenants', tenant, made.businessId, 'authority.encrypted.json');
  limits.trialVaultBytes = (await stat(vaultFile)).size + 256;
  const before = sent.length;
  await assert.rejects(visitor.rpc('venture.interview.next'), (error: any) => error.code === 'TRIAL_LIMIT' && error.message === TRIAL_FULL_LINE);
  assert.equal(sent.length, before, 'the AI call was refused before it left: its record could not be written');
  assert.ok((await stat(vaultFile)).size <= limits.trialVaultBytes, 'nothing past the cap was stored');
  // An account's business has no such cap.
  const owner = await signIn('owner@example.com');
  await owner.rpc('workspace.create', { name: 'Big Vault', pack: 'services' });
  limits.trialVaultBytes = 1_024;
  assert.ok((await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Big Vault' })).venture.id);
});

test('the capped vault store: a write that grows past the cap is refused, one that shrinks or keeps the size passes, and no cap means none', async () => {
  const stored: unknown[] = [];
  let current: any = null;
  const inner = {
    kind: 'experimental-file' as const,
    async load() { return current; },
    async commit(envelope: any) { stored.push(envelope); current = envelope; },
    async delete() { current = null; },
  };
  let cap: number | null = 1_000;
  const capped = cappedSnapshotAdapter(inner, () => cap);
  const envelope = (bytes: number) => ({ format: 'x', id: 'v', revision: 1, snapshot: { data: 'a'.repeat(bytes) } });
  await capped.commit(envelope(500) as any, null);
  await assert.rejects(capped.commit(envelope(2_000) as any, 1), (error: any) => error.code === 'TRIAL_LIMIT' && error.message === TRIAL_FULL_LINE);
  assert.equal(stored.length, 1, 'nothing reached the store');
  cap = 300;
  await capped.commit(envelope(400) as any, 1);
  await capped.commit(envelope(400) as any, 2);
  await assert.rejects(capped.commit(envelope(450) as any, 3), code('TRIAL_LIMIT'));
  cap = null;
  await capped.commit(envelope(5_000) as any, 3);
  assert.equal(stored.length, 4);
  // A store opened on a vault already past the cap may still shrink it, never grow it.
  const reopened = cappedSnapshotAdapter(inner, () => 100);
  await reopened.load();
  await reopened.commit(envelope(4_000) as any, 4);
  await assert.rejects(reopened.commit(envelope(4_100) as any, 5), code('TRIAL_LIMIT'));
});

test('behind several proxies, CHAUSAR_HOSTED_TRUST_PROXY=<hops> picks the entry that many from the right', async t => {
  const key = randomBytes(32).toString('base64url');
  const live = { CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' };
  const hops = (value?: string) => { const config = hostedConfig(value === undefined ? live : { ...live, CHAUSAR_HOSTED_TRUST_PROXY: value }); return [config.trustProxy, config.proxyHops]; };
  assert.deepEqual([hops(), hops('0'), hops('1'), hops('true'), hops('2')], [[false, 0], [false, 0], [true, 1], [true, 1], [true, 2]]);
  for (const bad of ['yes', '-1', '11', '1.5']) assert.throws(() => hostedConfig({ ...live, CHAUSAR_HOSTED_TRUST_PROXY: bad }), code('HOSTED_CONFIG_INVALID'), bad);

  // Two proxies: the browser's own address is the second entry from the right; the last is the first proxy's.
  const two = await startServer(t, { trustProxy: true, proxyHops: 2, limits: { ...DEFAULT_LIMITS, trialStartsPerAddress: { capacity: 1, refillEveryMs: HOUR } } });
  await two.startTrial({ 'X-Forwarded-For': '9.9.9.9, 198.51.100.7, 10.0.0.1' });
  const again = browserClient(two.port, { 'X-Forwarded-For': '8.8.8.8, 198.51.100.7, 10.0.0.2' });
  await again.get('/');
  assert.equal((await again.post('/api/hosted/trial', {})).status, 429, 'the same browser behind another proxy');
  await two.startTrial({ 'X-Forwarded-For': '9.9.9.9, 198.51.100.8, 10.0.0.1' });
  // One proxy: the last entry.
  const one = await startServer(t, { trustProxy: true, proxyHops: 1, limits: { ...DEFAULT_LIMITS, trialStartsPerAddress: { capacity: 1, refillEveryMs: HOUR } } });
  await one.startTrial({ 'X-Forwarded-For': '198.51.100.7, 10.0.0.1' });
  const behind = browserClient(one.port, { 'X-Forwarded-For': '198.51.100.9, 10.0.0.1' });
  await behind.get('/');
  assert.equal((await behind.post('/api/hosted/trial', {})).status, 429, 'one hop: the proxy appended 10.0.0.1 both times');
});

test("the engine's write path refuses real money, share links and alert targets while the business is temporary, and only then", async () => {
  const env = await setup();
  let temporary = true;
  const trialDeps = { ...env.deps, trial: () => temporary };
  await seedBlueprint(env, { price1: '1000000' });
  const run = (method: string, payload: unknown, deps = env.deps) => (moneyHandlers as any)[method](deps, deskOwner, payload);
  const client = await run('venture.client.add', { name: CLIENT_NAME, countryCode: 'IN', stateCode: '27' });
  const order = await run('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Monthly books for October, please.' });
  const draft = (await run('venture.invoice.prepare', { orderId: order.id, issueDate: '2026-10-01', dueInDays: 15 }, trialDeps)).invoice;
  await assert.rejects(run('venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest }, trialDeps), code('TRIAL_LIMIT'));
  await assert.rejects(ventureAction(trialDeps, deskOwner, 'admin', 'seed.payment', tx => tx.put({ ...tx.base('venture-payment'), invoiceId: draft.id } as unknown as PaymentRecord)), code('TRIAL_LIMIT'));
  await assert.rejects(ventureAction(trialDeps, deskOwner, 'admin', 'seed.share', tx => tx.put({ ...tx.base('venture-share-link') } as unknown as ShareLinkStoredRecord)), (error: any) => error.code === 'TRIAL_LIMIT' && error.message === TRIAL_SEND_LINE);
  const bank = { label: 'HDFC current', currency: 'INR', consent: null, polls: [], rules: [] };
  await assert.rejects(ventureAction(trialDeps, deskOwner, 'admin', 'seed.alerts', tx => tx.put({ ...tx.base('venture-bank-account'), ...bank, alertAddress: 'https://hooks.example.com/x' } as unknown as BankAccountRecord)), code('TRIAL_LIMIT'));
  await ventureAction(trialDeps, deskOwner, 'admin', 'seed.bank', tx => tx.put({ ...tx.base('venture-bank-account'), ...bank, alertAddress: null } as unknown as BankAccountRecord));

  temporary = false;
  assert.equal((await run('venture.invoice.issue', { invoiceId: draft.id, digest: draft.digest }, trialDeps)).invoice.number, 'INV-0001', 'kept: the same call issues it');

  const records = [
    [{ kind: 'venture-invoice', status: 'draft', number: null }, null], [{ kind: 'venture-invoice', status: 'issued', number: 'INV-0001' }, TRIAL_MONEY_LINE],
    [{ kind: 'venture-invoice', status: 'void', number: null }, null], [{ kind: 'venture-invoice', status: 'paid', number: 'INV-0002' }, TRIAL_MONEY_LINE],
    [{ kind: 'venture-payment' }, TRIAL_MONEY_LINE], [{ kind: 'venture-credit-note', status: 'waiting' }, null], [{ kind: 'venture-credit-note', status: 'issued' }, TRIAL_MONEY_LINE],
    [{ kind: 'venture-bill', payments: [], paidMinor: '0' }, null], [{ kind: 'venture-bill', payments: [{ id: 'p' }], paidMinor: '100' }, TRIAL_MONEY_LINE],
    [{ kind: 'venture-share-link' }, TRIAL_SEND_LINE], [{ kind: 'venture-file-request' }, TRIAL_SEND_LINE],
    [{ kind: 'venture-bank-account', alertAddress: 'https://hooks.example.com/x' }, TRIAL_SEND_LINE], [{ kind: 'venture-bank-account', alertAddress: null }, null],
    [{ kind: 'venture-recurring-invoice' }, null], [{ kind: 'venture-client' }, null],
  ] as const;
  for (const [record, refused] of records) assert.equal(trialRefusal(record as any), refused, JSON.stringify(record));
});

test("AI on a trial: only on the owner's own key, at the trial's own rate and monthly ceiling, keyed by the account on each call", async () => {
  const calls: ModelHttpRequest[] = [];
  const inner: ModelTransport = { replay: false, http: async request => { calls.push(request); return { status: 200, body: '{}' }; }, process: async () => ({ exitCode: 0, stdout: '' }) };
  const at = new Date();
  let temporary = true;
  let usage: UsageEntry[] = [];
  let account = `t_${'a'.repeat(24)}`;
  const trialRate = new RateLimiter('model-trial', { capacity: 2, refillEveryMs: HOUR }, () => at.getTime());
  const accountRate = new RateLimiter('model-tenant', { capacity: 1, refillEveryMs: HOUR }, () => at.getTime());
  const transport = hostedModelTransport({
    tenantId: () => account, inner, usage: () => usage, ceilingMicros: '20000000',
    rate: accountRate, gate: new ConcurrencyGate(2), clock: () => at, dispatched: () => {},
    trial: () => temporary ? { rate: trialRate, ceilingMicros: '2000000' } : null,
  });
  const request = (headers: Record<string, string>): ModelHttpRequest => ({ url: 'https://api.anthropic.com/v1/messages', method: 'POST', headers, body: '{}', timeoutMs: 1000, purpose: 'interview' as any });
  await assert.rejects(transport.http(request({ 'content-type': 'application/json' })), (error: any) => error.code === 'TRIAL_LIMIT' && /your own key/.test(error.message));
  await assert.rejects(transport.http(request({ 'x-api-key': '' })), code('TRIAL_LIMIT'));
  assert.equal(calls.length, 0, 'nothing left the server');
  await transport.http(request({ 'x-api-key': API_KEY }));
  await transport.http(request({ authorization: `Bearer ${API_KEY}` }));
  await assert.rejects(transport.http(request({ 'x-api-key': API_KEY })), code('RATE_LIMITED'), "the trial's own rate");
  assert.equal(calls.length, 2);

  // Kept: the account's rate, keyed by whichever account holds it at that call.
  temporary = false;
  usage = [{ callId: 'c1', businessId: `b_${'b'.repeat(24)}`, month: at.toISOString().slice(0, 7), costMicros: '2500000', at: at.toISOString() }];
  await transport.http(request({ 'x-api-key': API_KEY }));
  await assert.rejects(transport.http(request({ 'x-api-key': API_KEY })), code('RATE_LIMITED'));
  account = `t_${'c'.repeat(24)}`;
  await transport.http(request({ 'x-api-key': API_KEY }));
  assert.equal(calls.length, 4);
  temporary = true;
  // The ceiling is checked before the rate: a trial past its own ceiling says so.
  await assert.rejects(transport.http(request({ 'x-api-key': API_KEY })), (error: any) => error.code === 'BUDGET_REACHED' && /temporary business/.test(error.message));
});
