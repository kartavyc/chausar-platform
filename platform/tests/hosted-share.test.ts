// Hosted tier: the client share page (/share/<token>) over real sockets on this computer. The owner makes a link from a
// ready draft; a client with no account reads it and answers once through a same-origin form; the page carries a strict
// policy with no scripts; misses look alike; revoking stops it. No network beyond loopback, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

const ORIGIN = 'http://localhost:4398';
const HOST = 'localhost:4398';
const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune, done by AI helpers with me checking every report.';
const API_KEY = 'sk-ant-test-not-a-real-key-0000';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
type Reply = { status: number; headers: IncomingHttpHeaders; text: string; json: any };

function send(port: number, method: string, path: string, body: string | undefined, headers: Record<string, string>): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: { Host: HOST, ...headers } }, res => {
      let text = ''; res.setEncoding('utf8');
      res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let json: any = null; try { json = JSON.parse(text); } catch { /* html */ } resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

/** A signed-in owner's browser: cookies, the page bearer and /api/rpc. */
function ownerBrowser(port: number) {
  const jar = new Map<string, string>();
  let bearer: string | null = null;
  const go = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const headers: Record<string, string> = { ...extra };
    if (method === 'POST') Object.assign(headers, { Origin: ORIGIN, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' });
    if (jar.size) headers.Cookie = [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
    const reply = await send(port, method, path, body === undefined ? undefined : JSON.stringify(body), headers);
    for (const line of [reply.headers['set-cookie'] ?? []].flat()) {
      const [pair] = line.split(';'); const at = pair.indexOf('=');
      if (/Max-Age=0/.test(line)) jar.delete(pair.slice(0, at).trim()); else jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    return reply;
  };
  return {
    go,
    async bearer() { const reply = await go('GET', '/api/hosted/session'); assert.equal(reply.status, 200, reply.text); bearer = reply.json.token; },
    async rpc(method: string, payload: unknown = {}) {
      const reply = await go('POST', '/api/rpc', { method, payload }, bearer ? { Authorization: `Bearer ${bearer}` } : {});
      if (reply.json?.error) throw Object.assign(new Error(reply.json.error.message), { code: reply.json.error.code });
      assert.equal(reply.status, 200, reply.text);
      return reply.json.result;
    },
  };
}

async function startServer(t: any, publicUrl: string | null) {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-share-'));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody);
  const outbox = new DevOutbox();
  const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
  const githubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits: DEFAULT_LIMITS, version: '0.1.0-preview.1',
    modelTransport: createReplayTransport(modelFixture), githubTransport: () => createFixtureGitHubTransport(githubFixture, () => ({ briefId: '' })), publicUrl,
  });
  const http = createHostedServer(app, { origin: ORIGIN, tls: { kind: 'none' }, trustProxy: false, maxBodyBytes: DEFAULT_LIMITS.maxBodyBytes });
  const { port } = await http.listen('127.0.0.1', 0);
  t.after(async () => { await http.close(); await rm(folder, { recursive: true, force: true }); });
  const owner = ownerBrowser(port);
  assert.equal((await owner.go('GET', '/')).status, 200);
  assert.equal((await owner.go('POST', '/api/auth/magic-link', { email: 'owner@ledger.example' })).status, 200);
  const signin = new URL(outbox.latest('owner@ledger.example')!.link).hash.replace('#signin=', '');
  assert.equal((await owner.go('POST', '/api/auth/magic-link/verify', { token: signin })).status, 200);
  await owner.bearer();
  return { port, owner, directory };
}

/** The journey to a draft ready for review: plan accepted, a client, an order, and a template draft. */
async function readyDraft(owner: ReturnType<typeof ownerBrowser>): Promise<string> {
  await owner.rpc('workspace.create', { name: 'Ledger Cafe Books', pack: 'services' });
  await owner.rpc('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Ledger Cafe Books' });
  const presets = await owner.rpc('venture.models.presets');
  for (const [presetId, tier] of [['anthropic-haiku-5-5', 'fast'], ['anthropic-sonnet-5-5', 'main']] as const) {
    await owner.rpc('venture.models.connect', { presetId, consentDigest: presets.find((p: any) => p.id === presetId).consentDigest, apiKey: API_KEY, tiers: [tier] });
  }
  await owner.rpc('venture.interview.next');
  for (const [questionId, answer] of [['q_1', { choiceId: 'c_1' }], ['q_2', { text: 'WhatsApp photos and a shared folder' }], ['q_pricing_model', { choiceId: 'monthly' }],
    ['q_price', { amount: '2,499' }], ['q_tax', { yes: true }], ['q_tax_rate', { rate: '18' }]] as const) {
    await owner.rpc('venture.interview.answer', { questionId, answer });
  }
  await owner.rpc('venture.blueprint.draft');
  const updated = (await owner.rpc('venture.blueprint.update', { patch: { taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' } })).blueprint;
  await owner.rpc('venture.blueprint.accept', { digest: updated.digest });
  const client = await owner.rpc('venture.client.add', { name: 'Cafe Aroma <Demo> & Co' });
  const order = await owner.rpc('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Please close my September books.' });
  const run = await owner.rpc('venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.equal(run.status, 'ready-for-review');
  return run.id;
}

const form = (port: number, path: string, body: string, headers: Record<string, string> = {}) =>
  send(port, 'POST', path, body, { Origin: ORIGIN, 'Content-Type': 'application/x-www-form-urlencoded', 'Sec-Fetch-Site': 'same-origin', ...headers });

test('CHAUSAR_PUBLIC_URL is this server origin or nothing', () => {
  const key = randomBytes(32).toString('base64url');
  const live = { CHAUSAR_HOSTED: '1', CHAUSAR_HOSTED_ORIGIN: 'https://app.example.com', CHAUSAR_HOSTED_CUSTODY_KEY: key, CHAUSAR_HOSTED_TLS_PROXY: '1' };
  assert.equal(hostedConfig(live).publicUrl, null);
  assert.equal(hostedConfig({ ...live, CHAUSAR_PUBLIC_URL: 'https://app.example.com/' }).publicUrl, 'https://app.example.com');
  for (const value of ['https://other.example.com', 'https://app.example.com/share', 'not a url', 'https://user@app.example.com']) {
    assert.throws(() => hostedConfig({ ...live, CHAUSAR_PUBLIC_URL: value }), code('HOSTED_CONFIG_INVALID'), value);
  }
});

test('a client reads the draft on /share/<token> with no account and answers once through the page form', async t => {
  const { port, owner, directory } = await startServer(t, ORIGIN);
  const deliveryId = await readyDraft(owner);
  const made = await owner.rpc('venture.share.create', { deliveryId });
  const match = /^http:\/\/localhost:4398\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url);
  assert.ok(match, made.url);
  const token = match[1], path = `/share/${token}`;
  const index = directory.read().shareLinks ?? [];
  assert.equal(index.length, 1);
  assert.deepEqual(Object.keys(index[0]).sort(), ['businessId', 'expiresAt', 'linkId', 'tenantId', 'tokenHash']);
  assert.equal(index[0].tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(directory.read()).includes(token), false, 'the directory keeps the hash, never the token');

  // The page: no cookies, strict policy, no script, every field escaped.
  const page = await send(port, 'GET', path, undefined, {});
  assert.equal(page.status, 200, page.text);
  assert.match(String(page.headers['content-type']), /^text\/html/);
  const policy = String(page.headers['content-security-policy']);
  assert.match(policy, /^default-src 'none'; style-src 'sha256-[A-Za-z0-9+/=]+'; img-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'$/);
  assert.equal(page.headers['set-cookie'], undefined, 'the share page sets no cookie');
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.equal(/<script/i.test(page.text), false);
  assert.equal(page.text.includes(token), false, 'the page never repeats the token');
  assert.ok(page.text.includes('Ledger Cafe Books shared a draft with you. Read only.'));
  assert.ok(page.text.includes('<form method="post">'));
  const digest = /name="digest" value="([a-f0-9]{64})"/.exec(page.text)?.[1];
  assert.ok(digest);
  const style = /<style>([^<]*)<\/style>/.exec(page.text)![1];
  assert.ok(policy.includes(`'sha256-${createHash('sha256').update(style).digest('base64')}'`), 'the one inline style is the hashed one');

  // Answers that do not come from the page are refused before anything is recorded.
  assert.equal((await form(port, path, `decision=approved&digest=${digest}`, { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await form(port, path, `decision=approved&digest=${digest}`, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await send(port, 'POST', path, JSON.stringify({ decision: 'approved', digest }), { Origin: ORIGIN, 'Content-Type': 'application/json' })).status, 400);
  assert.equal((await form(port, path, `decision=approved&decision=changes&digest=${digest}`)).status, 400);
  assert.equal((await form(port, path, `decision=approved&digest=${'f'.repeat(64)}`)).status, 409, 'a digest the page did not show is stale');

  const answered = await form(port, path, `decision=changes&digest=${digest}&comment=${encodeURIComponent('Add the <GST> total & the date')}`);
  assert.equal(answered.status, 200, answered.text);
  assert.ok(answered.text.includes('Thank you. Your answer is recorded.'));
  assert.ok(answered.text.includes('Add the &lt;GST&gt; total &amp; the date'), 'the comment comes back escaped');
  assert.equal(answered.text.includes('<form'), false, 'once answered, the form is gone');
  const again = await form(port, path, `decision=approved&digest=${digest}`);
  assert.equal(again.status, 409);
  assert.ok(again.text.includes('An answer was already recorded on this draft.'));
  const { links } = await owner.rpc('venture.share.list', { deliveryId });
  assert.equal(links[0].reason, 'Your client asked for changes. Add the <GST> total & the date');
  assert.equal(links[0].url, null);

  // Misses look alike; revoking stops the page and drops the index entry.
  for (const miss of [`/share/${'B'.repeat(32)}`, '/share/short', '/share', `/share/${token}/more`]) {
    const reply = await send(port, 'GET', miss, undefined, {});
    assert.equal(reply.status, 404, miss);
    assert.ok(reply.text.includes('This link does not open.'), miss);
  }
  await owner.rpc('venture.share.revoke', { id: made.id });
  assert.deepEqual(directory.read().shareLinks, []);
  assert.equal((await send(port, 'GET', path, undefined, {})).status, 404);
  assert.equal((await form(port, path, `decision=approved&digest=${digest}`)).status, 404);
  await assert.rejects(owner.rpc('venture.share.revoke', { id: 'share_missing' }), code('SHARE_NOT_FOUND'));
});

test('without CHAUSAR_PUBLIC_URL a hosted link gets no address and nothing is indexed', async t => {
  const { port, owner, directory } = await startServer(t, null);
  const deliveryId = await readyDraft(owner);
  const made = await owner.rpc('venture.share.create', { deliveryId });
  assert.equal(made.url, null);
  assert.match(made.reason, /hosted Chausar with a public address/);
  assert.deepEqual(directory.read().shareLinks ?? [], []);
  assert.equal((await send(port, 'GET', `/share/${'C'.repeat(32)}`, undefined, {})).status, 404);
});
