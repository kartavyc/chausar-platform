import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Router, bearer } from '../../hosted/shared/http.ts';
import type { HostedResponse } from '../../hosted/shared/http.ts';
import { JobQueue, Worker } from '../../hosted/db/queue.ts';
import { FREE_ENTITLEMENTS } from '../../hosted/shared/auth.ts';
import type { Fetch, HostedDeps } from '../../hosted/shared/module.ts';
import { LINK_PAGE, OPT_IN_TEXT } from '../../hosted/shared/templates.ts';
import { createRelayModule } from '../../hosted/relay/relay.ts';
import { mailChannel, whatsappChannel } from '../../hosted/relay/channels.ts';
import { createLinkPages, LINK_PAGE_HEADERS, linkPage } from '../../hosted/link/pages.ts';
import { postgresAvailable, freshDatabase, closeDatabases } from './hosted-link-pg.ts';

after(closeDatabases);
const pgSkip = postgresAvailable();
const OWNER = 'acct_00000000-0000-4000-8000-00000000000a';
const CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const blob = (fill: number) => ({ format: 'chausar-relay-sealed-v1', nonce: Buffer.alloc(12, fill).toString('base64'), ciphertext: Buffer.alloc(32, fill + 1).toString('base64') });

async function setup() {
  const sql = await freshDatabase();
  await sql.query('CREATE TABLE IF NOT EXISTS accounts (id text PRIMARY KEY, phone text UNIQUE NOT NULL, created_at timestamptz)');
  await sql.query('INSERT INTO accounts (id, phone, created_at) VALUES ($1, $2, now())', [OWNER, '+919876543210']);
  const state = { time: new Date('2026-10-14T10:00:00Z') };
  const clock = () => state.time, queue = new JobQueue(sql, clock), sent: any[] = [];
  const fetch: Fetch = async (url, init = {}) => {
    const body = JSON.parse(String(init.body)); sent.push({ url, body });
    const reply = url.includes('graph.facebook.com') ? { messages: [{ id: `wamid.${'A'.repeat(sent.length)}` }] } : { To: body.To, MessageID: randomUUID(), ErrorCode: 0, Message: 'OK' };
    return { status: 200, ok: true, headers: { get: () => null }, text: async () => JSON.stringify(reply), arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const deps: HostedDeps = { sql, clock, queue, fetch, pepper: 'link-test-pepper-that-is-long-enough!', linkOrigin: 'https://link.chausar.app',
    authenticate: async request => ({ accountId: bearer(request).replace(/^sessiontoken_/, ''), deviceId: 'dev_one', sessionId: 'ses_one' }),
    entitlements: async () => ({ ...FREE_ENTITLEMENTS, plan: 'paid', relay: true }) };
  const relay = createRelayModule(deps, { whatsapp: whatsappChannel({ phoneNumberId: '106540352242922', accessToken: 'EAAGtestaccesstokenletterswhatsappcloud' }),
    telegram: null, mail: mailChannel({ serverToken: 'postmark-server-token-test', from: 'messages@chausar.app' }), prices: null });
  const router = new Router(); relay.routes(router); createLinkPages(deps, relay.buttons, relay.mailConfirm).routes(router);
  const worker = new Worker(queue); relay.jobs!(worker);
  const api = async (method: string, url: string, body: unknown) => (await router.handle({ method, url, headers: { authorization: `Bearer sessiontoken_${OWNER}`, 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify(body)) })).body as any;
  const optIn = (channel: 'mail' | 'whatsapp') => ({ given: true, textSha256: createHash('sha256').update(OPT_IN_TEXT[channel]).digest('hex'), recordedAt: state.time.toISOString() });
  await api('PUT', '/v1/relay/channels/mail', { enabled: true, optIn: optIn('mail'), address: 'owner@example.com' });
  await api('PUT', '/v1/relay/channels/whatsapp', { enabled: true, optIn: optIn('whatsapp') });
  const page = (method: string, path: string) => router.handle({ method, url: path, headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}, body: Buffer.alloc(0) });
  // Mail turns on only once its address is confirmed through the one-time link in the confirmation mail.
  await worker.runOnce();
  const confirmToken = /\/v\/([A-Za-z]{48})/.exec(sent.at(-1).body.TextBody)![1];
  assert.equal((await page('POST', `/v/${confirmToken}`)).status, 200);
  /**
   * Mail no longer takes an offer; this stands in for one queued before that change: an Open-only review message whose row
   * is turned into an offer before dispatch. Returns the tokens read back from the mail body.
   */
  const mailOffer = async () => {
    const queued = await api('POST', '/v1/relay/messages', { event: 'review-ready', channel: 'mail', idempotencyKey: `mail-${randomUUID()}` });
    await sql.query(`UPDATE relay_messages SET buttons = 'approve-not-now-open' WHERE id = $1`, [queued.messageId]);
    await sql.query('INSERT INTO relay_offers (message_id, approve_nonce, approve_ciphertext, not_now_nonce, not_now_ciphertext, expires_at) SELECT id, $2, $3, $4, $5, expires_at FROM relay_messages WHERE id = $1',
      [queued.messageId, blob(1).nonce, blob(1).ciphertext, blob(5).nonce, blob(5).ciphertext]);
    await worker.runOnce();
    const text: string = sent.at(-1).body.TextBody;
    return { open: /\/l\/([A-Za-z]{48})/.exec(text)![1], approve: /Approve: https:\/\/link\.chausar\.app\/b\/([A-Za-z]{48})/.exec(text)![1], notNow: /Not now: https:\/\/link\.chausar\.app\/b\/([A-Za-z]{48})/.exec(text)![1] };
  };
  const envelopes = async () => (await api('GET', '/v1/relay/envelopes', {})).envelopes as any[];
  return { sql, state, sent, router, worker, api, page, mailOffer, envelopes };
}
const flip = (token: string) => token.slice(0, 20) + (token[20] === 'a' ? 'b' : 'a') + (token[21] === 'a' ? 'b' : 'a') + token.slice(22);
function assertPlainPage(response: HostedResponse, status: number, line: string) {
  assert.equal(response.status, status);
  assert.deepEqual(response.headers, { ...LINK_PAGE_HEADERS });
  assert.equal(response.headers!['content-type'], 'text/html; charset=utf-8');
  assert.equal(response.headers!['content-security-policy'], CSP);
  assert.equal(response.headers!['x-robots-tag'], 'noindex'); assert.equal(response.headers!['referrer-policy'], 'no-referrer'); assert.equal(response.headers!['cache-control'], 'no-store');
  const html = String(response.body);
  assert.ok(html.includes(`<p class="mark">Chausar</p><p>${line}</p>`), html);
  assert.equal(/<script|\son[a-z]+=|javascript:/i.test(html), false, 'no scripts');
  return html;
}

test('the page is the wordmark and one line, with nothing but catalogue text', () => {
  const html = linkPage(LINK_PAGE.open);
  assert.match(html, /^<!doctype html>/); assert.ok(html.includes('<title>Chausar</title>'));
  assert.throws(() => linkPage('<b>injected</b>'));
});

test('Open the app hands over to the desktop and decides nothing; a changed or old link no longer works', { skip: pgSkip }, async () => {
  const h = await setup();
  const tokens = await h.mailOffer();
  const html = assertPlainPage(await h.page('GET', `/l/${tokens.open}`), 200, LINK_PAGE.open);
  assert.ok(html.includes('href="chausar://open/approvals"'));
  assertPlainPage(await h.page('GET', `/l/${tokens.open}`), 200, LINK_PAGE.open);
  assertPlainPage(await h.page('GET', `/l/${flip(tokens.open)}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('GET', '/l/short'), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('GET', `/l/${tokens.approve}`), 410, LINK_PAGE.gone);
  assert.deepEqual(await h.envelopes(), [], 'opening decided nothing');
  h.state.time = new Date(h.state.time.getTime() + 8 * 86400000);
  assertPlainPage(await h.page('GET', `/l/${tokens.open}`), 410, LINK_PAGE.gone);
});

test('a mail approval link: GET only shows the confirm button (scanners consume nothing), POST decides once', { skip: pgSkip }, async () => {
  const h = await setup();
  const tokens = await h.mailOffer();
  for (let i = 0; i < 3; i++) {
    const html = assertPlainPage(await h.page('GET', `/b/${tokens.approve}`), 200, LINK_PAGE.confirmApprove);
    assert.ok(html.includes('<form method="post"><button type="submit">Approve</button></form>'));
    assert.equal((html.match(/<button/g) ?? []).length, 1, 'one form button');
    assert.equal(/ciphertext|nonce|AQEB|msg_|env_/.test(html), false, 'the page shows no action data');
  }
  assertPlainPage(await h.page('GET', `/b/${tokens.notNow}`), 200, LINK_PAGE.confirmNotNow);
  assert.deepEqual(await h.envelopes(), [], 'GET consumed nothing');
  assertPlainPage(await h.page('GET', `/b/${flip(tokens.approve)}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${flip(tokens.approve)}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${tokens.approve}`), 200, LINK_PAGE.done);
  const [envelope] = await h.envelopes();
  assert.deepEqual([envelope.decision, envelope.channel, envelope.nonce, envelope.ciphertext], ['approve', 'mail', blob(1).nonce, blob(1).ciphertext]);
  assertPlainPage(await h.page('POST', `/b/${tokens.approve}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('GET', `/b/${tokens.approve}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('GET', `/b/${tokens.notNow}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${tokens.notNow}`), 410, LINK_PAGE.gone);
  assert.equal((await h.envelopes()).length, 1, 'one decision per message');
  const late = await h.mailOffer();
  h.state.time = new Date(h.state.time.getTime() + 31 * 60000);
  assertPlainPage(await h.page('GET', `/b/${late.notNow}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${late.notNow}`), 410, LINK_PAGE.gone);
});

test('mail is never offered Approve and Not now: a forwarded mail would carry them to anyone', { skip: pgSkip }, async () => {
  const h = await setup();
  const refused = await h.router.handle({ method: 'POST', url: '/v1/relay/messages', headers: { authorization: `Bearer sessiontoken_${OWNER}`, 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ event: 'review-ready', channel: 'mail', idempotencyKey: 'mail-offer-key', offer: { approve: blob(1), notNow: blob(5) } })) });
  assert.equal(refused.status, 400); assert.equal((refused.body as any).error.code, 'OFFER_NOT_ALLOWED');
  assert.equal((await h.sql.query('SELECT count(*)::int AS n FROM relay_messages')).rows[0].n, 0);
  const open = await h.api('POST', '/v1/relay/messages', { event: 'review-ready', channel: 'mail', idempotencyKey: 'mail-open-key' });
  assert.equal(open.status, 'queued');
  await h.worker.runOnce();
  const text: string = h.sent.at(-1).body.TextBody;
  assert.match(text, /\/l\/[A-Za-z]{48}/); assert.equal(/\/b\//.test(text), false, 'only Open the app');
});

test('a mail link pressed after the channel is stopped decides nothing', { skip: pgSkip }, async () => {
  const h = await setup();
  const tokens = await h.mailOffer();
  await h.sql.query(`UPDATE relay_channels SET status = 'stopped', stopped_at = now() WHERE channel = 'mail'`);
  assertPlainPage(await h.page('GET', `/b/${tokens.approve}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${tokens.approve}`), 410, LINK_PAGE.gone);
  assert.deepEqual((await h.sql.query('SELECT reason FROM relay_refusals')).rows, [{ reason: 'channel-off' }]);
  assert.deepEqual(await h.envelopes(), []);
});

test('a chat button token cannot be used as a mail link', { skip: pgSkip }, async () => {
  const h = await setup();
  await h.api('POST', '/v1/relay/messages', { event: 'review-ready', channel: 'whatsapp', idempotencyKey: 'whatsapp-offer-key', offer: { approve: blob(1), notNow: blob(5) } });
  await h.worker.runOnce();
  const approve = h.sent.at(-1).body.template.components[0].parameters[0].payload;
  assertPlainPage(await h.page('GET', `/b/${approve}`), 410, LINK_PAGE.gone);
  assertPlainPage(await h.page('POST', `/b/${approve}`), 410, LINK_PAGE.gone);
  assert.deepEqual((await h.sql.query('SELECT reason FROM relay_refusals')).rows, [{ reason: 'wrong-channel' }]);
  assert.deepEqual(await h.envelopes(), []);
});
