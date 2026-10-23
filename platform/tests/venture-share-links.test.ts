// Client share links (venture/build/share-links.ts): venture.share.create, .list and .revoke, and the two trusted entry
// points the hosted /share/<token> page uses. The token is shown once and only its sha256 is kept; the address is real
// only on the hosted web server with a public address; the client's answer goes through the social approvals module.
// No network: the hosted page itself is tested in hosted-share.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { DeliveryRunRecord, ShareLinkView, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { SHARE_WORDS, shareDecide, sharePage } from '../runtime/venture/build/share-links.ts';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { code, owner, seedBlueprint, seedOrder, seedRun, setup, type Env } from './venture-views-env.ts';

const PUBLIC = 'https://app.example.com';
const TEXT = 'Monthly report for Cafe Aroma.\n\nEverything matched <except> two bills & one refund.';
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown = {}, ctx: Context = owner) => (build as Record<string, Handler>)[method](deps, ctx, payload) as Promise<T>;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const hosted = (env: Env): VentureDeps => ({ ...env.deps, host: 'hosted-web', publicUrl: PUBLIC });

async function readyRun(env: Env, fields: Partial<DeliveryRunRecord> = {}) {
  const plan = await seedBlueprint(env);
  const { order, client } = await seedOrder(env, plan);
  const run = await seedRun(env, order, {
    status: 'ready-for-review', servedBy: 'template', renderedText: TEXT,
    deliverable: { title: 'September books', sections: [], questionsForClient: [] }, checks: [{ check: 'house-style', passed: true, detail: 'ok' }], ...fields,
  });
  return { run, order, client };
}

test('share methods are build methods; create and revoke are app-only and reach the engine and the desktop', async () => {
  for (const method of ['venture.share.create', 'venture.share.list', 'venture.share.revoke'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'build', method);
    assert.equal(typeof (build as Record<string, unknown>)[method], 'function', method);
  }
  assert.deepEqual(['venture.share.create', 'venture.share.list', 'venture.share.revoke'].filter(method => APP_ONLY_METHODS.includes(method as never)), ['venture.share.create', 'venture.share.revoke']);
  const [ipc, engine] = await Promise.all([readFile(new URL('../../app/desktop/ipc-contract.cjs', import.meta.url), 'utf8'), readFile(new URL('../runtime/engine.ts', import.meta.url), 'utf8')]);
  for (const method of ['venture.share.create', 'venture.share.list', 'venture.share.revoke']) {
    assert.ok(ipc.includes(`'${method}'`), `the desktop allows ${method}`);
    assert.ok(engine.includes(`case '${method}':`), `the engine routes ${method}`);
  }
  assert.equal(engine.includes("case 'venture.share.page'"), false, 'the page entry points are not methods');
});

test('without a public address a link is kept, says why it has no address, and nothing opens it', async () => {
  const env = await setup();
  const { run, client } = await readyRun(env);
  const made = await call<ShareLinkView>(env.deps, 'venture.share.create', { deliveryId: run.id });
  assert.deepEqual(made, { id: made.id, url: null, reason: SHARE_WORDS.notServed, expiresAt: '2026-10-22T10:00:00.000Z' });
  const [record] = listRecords(env.store.read(), 'venture-share-link');
  assert.equal(record.served, false);
  assert.equal(record.text, TEXT);
  assert.equal(record.title, 'September books');
  assert.equal(record.clientId, client.id);
  assert.match(record.tokenHash, /^[a-f0-9]{64}$/);
  assert.match(record.draftDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(await call(env.deps, 'venture.share.list'), { links: [made], shares: [made] });
  assert.deepEqual((await call<{ links: ShareLinkView[] }>(env.deps, 'venture.share.list', { deliveryId: 'delivery_other' })).links, []);
  // Not served: even the right token would open nothing, and a desktop build never makes an address.
  assert.equal(await sharePage(hosted(env), owner, 'A'.repeat(32)), null);
});

test('on the hosted web server the address carries the token once; the vault keeps only its sha256', async () => {
  const env = await setup();
  const { run } = await readyRun(env);
  const deps = hosted(env);
  const made = await call<ShareLinkView>(deps, 'venture.share.create', { deliveryId: run.id, expiresInHours: 48 });
  const match = /^https:\/\/app\.example\.com\/share\/([A-Za-z0-9_-]{32})$/.exec(made.url ?? '');
  assert.ok(match, made.url ?? 'no url');
  const token = match[1];
  assert.equal(made.reason, undefined);
  assert.equal(made.expiresAt, '2026-10-17T10:00:00.000Z');
  const stored = JSON.stringify(env.store.read());
  assert.equal(stored.includes(token), false, 'the token is never stored');
  assert.ok(stored.includes(sha256(token)));
  const [listed] = (await call<{ links: ShareLinkView[] }>(deps, 'venture.share.list')).links;
  assert.deepEqual(listed, { id: made.id, url: null, reason: SHARE_WORDS.shownOnce, expiresAt: made.expiresAt });

  // The page: read only, the exact text, and the client's answer once.
  const page = await sharePage(deps, owner, token);
  assert.ok(page);
  assert.deepEqual([page.businessName, page.title, page.text, page.expires, page.decision], ['Ledger Cafe Books', 'September books', TEXT, '17 Oct 2026', null]);
  assert.equal(await sharePage(deps, owner, `${token.slice(0, 31)}x`), null, 'a wrong token opens nothing');
  await assert.rejects(shareDecide(deps, owner, token, { decision: 'approved', digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(shareDecide(deps, owner, token, { decision: 'maybe', digest: page.digest }), code('INVALID_VENTURE_REQUEST'));
  const answered = await shareDecide(deps, owner, token, { decision: 'changes', comment: 'Please add the GST total.', digest: page.digest });
  assert.deepEqual(answered?.decision, { decision: 'changes', comment: 'Please add the GST total.' });
  await assert.rejects(shareDecide(deps, owner, token, { decision: 'approved', digest: page.digest }), code('ALREADY_DECIDED'));
  const [record] = listRecords(env.store.read(), 'venture-share-link');
  assert.equal(record.state, 'closed');
  assert.deepEqual(record.decisions.map(item => [item.decision, item.via, item.digest]), [['changes', 'share-link', page.digest]]);
  assert.equal((await call<{ links: ShareLinkView[] }>(deps, 'venture.share.list')).links[0].reason, `${SHARE_WORDS.changes} Please add the GST total.`);
  assert.equal((await sharePage(deps, owner, token))?.decision?.decision, 'changes', 'an answered link still shows the answer');

  // Revoking stops the page at once; revoking again changes nothing.
  const revoked = await call<ShareLinkView>(deps, 'venture.share.revoke', { id: made.id });
  assert.deepEqual(revoked, { id: made.id, url: null, reason: SHARE_WORDS.revoked, expiresAt: made.expiresAt, revoked: true });
  assert.equal(await sharePage(deps, owner, token), null);
  assert.deepEqual(await call(deps, 'venture.share.revoke', { id: made.id }), revoked);
});

test('an ended link opens nothing and says so in the list', async () => {
  const env = await setup();
  const { run } = await readyRun(env);
  const deps = hosted(env);
  const made = await call<ShareLinkView>(deps, 'venture.share.create', { deliveryId: run.id, expiresInHours: 1 });
  const token = made.url!.slice(-32);
  assert.ok(await sharePage(deps, owner, token));
  env.advance(3_600_000);
  assert.equal(await sharePage(deps, owner, token), null);
  assert.equal(await shareDecide(deps, owner, token, { decision: 'approved', digest: 'a'.repeat(64) }), null);
  assert.equal((await call<{ links: ShareLinkView[] }>(deps, 'venture.share.list')).links[0].reason, SHARE_WORDS.ended);
});

test('only a draft the owner could accept, or did accept or edit, can be shared; the edited text is what the link shows', async () => {
  const env = await setup();
  const { order } = await readyRun(env);
  const seed = (fields: Partial<DeliveryRunRecord>) => seedRun(env, order, { status: 'ready-for-review', servedBy: 'template', renderedText: TEXT, ...fields });
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: (await seed({ status: 'waiting-for-you' })).id }), code('DELIVERY_NOT_READY'));
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: (await seed({ practice: true })).id }), code('PRACTICE_DRAFT'));
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: (await seed({ checks: [{ check: 'house-style', passed: false, detail: 'It has an em dash.' }] })).id }), code('DELIVERY_NOT_READY'));
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: (await seed({ renderedText: '  ' })).id }), code('DELIVERY_NOT_READY'));
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: 'delivery_missing' }), code('DELIVERY_NOT_FOUND'));
  const edited = await seed({ status: 'edited', editedText: 'The text the owner changed.', verdict: { choice: 'edited', reason: 'tone', at: env.now() } });
  for (const hours of [0, 721, 1.5, '24']) await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: edited.id, expiresInHours: hours }), code('INVALID_VENTURE_REQUEST'), String(hours));
  await assert.rejects(call(env.deps, 'venture.share.create', { deliveryId: edited.id, extra: true }), code('INVALID_VENTURE_REQUEST'));
  await call(env.deps, 'venture.share.create', { deliveryId: edited.id });
  assert.equal(listRecords(env.store.read(), 'venture-share-link').at(-1)!.text, 'The text the owner changed.');
  await assert.rejects(call(env.deps, 'venture.share.revoke', { id: 'share_missing' }), code('SHARE_NOT_FOUND'));
});

test('the local server on this computer answers 404 for every /share address', async t => {
  const path = await mkdtemp(join(tmpdir(), 'chausar-share-local-'));
  const engine = new Engine({ directory: path, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine);
  const { origin } = await app.listen();
  t.after(async () => { await app.close(); await rm(path, { recursive: true, force: true }); });
  for (const address of ['/share', `/share/${'A'.repeat(32)}`, '/share/x/y']) {
    assert.equal((await fetch(`${origin}${address}`)).status, 404, address);
    assert.equal((await fetch(`${origin}${address}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'decision=approved' })).status, 404, address);
  }
});
