// Ink v2 wave 5, package 5A5 (P11): a client report's share link on the hosted tier, over real sockets on this
// computer. The owner renders a report of a ready draft and shares it; the hosted directory keeps only the token's
// hash; /share/<token> shows the report read only, with no form and no script; rotate moves the page to a new token
// and the old one opens nothing; disable stops it and drops the index entry. No network beyond loopback, no paid calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedApp } from '../runtime/hosted/app.ts';
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
const API_KEY = ['sk', 'ant', 'test', 'not', 'a', 'real', 'key'].join('-');
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

test('a report link on /share/<token>: hashed in the directory, read only, rotated to a new token, then turned off', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-hosted-report-'));
  const custody = HostedCustody.fromKey(randomBytes(32).toString('base64url'));
  const directory = await FileDirectory.open(folder, custody);
  const outbox = new DevOutbox();
  const modelFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/model-replay.json', import.meta.url), 'utf8'));
  const githubFixture = JSON.parse(await readFile(new URL('./fixtures/venture/e2e/github-sync.json', import.meta.url), 'utf8'));
  const app = new HostedApp({
    root: folder, rp: { id: 'localhost', name: 'Chausar', origin: ORIGIN }, directory, custody, mailer: outbox, limits: DEFAULT_LIMITS, version: '0.1.0-preview.1',
    modelTransport: createReplayTransport(modelFixture), githubTransport: () => createFixtureGitHubTransport(githubFixture, () => ({ briefId: '' })), publicUrl: ORIGIN,
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

  // The journey to a draft ready for review (as hosted-share.test.ts makes it).
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
  const client = await owner.rpc('venture.client.add', { name: 'Cafe Aroma' });
  const order = await owner.rpc('venture.order.create', { clientId: client.id, offerId: 'offer_1', request: 'Please close my September books.' });
  const run = await owner.rpc('venture.delivery.run', { orderId: order.id, useTemplate: true });
  assert.equal(run.status, 'ready-for-review');

  // Hosted makes the HTML only, and says a PDF needs the desktop app.
  const report = await owner.rpc('venture.report.render', { runId: run.id });
  assert.deepEqual(report.files.map((file: any) => file.format), ['html']);
  assert.deepEqual(report.notes, ['A PDF needs the desktop app.']);

  const made = await owner.rpc('venture.report.share', { reportId: report.id, from: '2026-01-01', to: '2026-12-31' });
  const token = /^http:\/\/localhost:4398\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url)?.[1];
  assert.ok(token, made.url);
  const index = directory.read().shareLinks ?? [];
  assert.equal(index.length, 1);
  assert.equal(index[0].tokenHash, createHash('sha256').update(token).digest('hex'));
  assert.equal(JSON.stringify(directory.read()).includes(token), false, 'the directory keeps the hash, never the token');

  const page = await send(port, 'GET', `/share/${token}`, undefined, {});
  assert.equal(page.status, 200, page.text);
  assert.ok(page.text.includes('Ledger Cafe Books shared a report with you. Read only.'));
  assert.equal(/<script|<form|<img/i.test(page.text), false, 'read only: no script, no form, no pixel');
  assert.equal(page.text.includes(token), false, 'the page never repeats the token');

  const rotated = await owner.rpc('venture.report.shareRotate', { shareId: made.id });
  const fresh = /\/share\/([A-Za-z0-9_-]{32})$/.exec(rotated.url)?.[1];
  assert.ok(fresh && fresh !== token);
  assert.equal((await send(port, 'GET', `/share/${token}`, undefined, {})).status, 404, 'the old token opens nothing');
  assert.equal((await send(port, 'GET', `/share/${fresh}`, undefined, {})).status, 200);
  assert.equal((directory.read().shareLinks ?? []).length, 1);

  const off = await owner.rpc('venture.report.shareDisable', { shareId: made.id });
  assert.equal(off.state, 'disabled');
  assert.deepEqual(directory.read().shareLinks, []);
  assert.equal((await send(port, 'GET', `/share/${fresh}`, undefined, {})).status, 404);
});
