import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { auditEvents } from '../runtime/frame-today/activity.ts';
import { canonicalChannelDocument } from '../runtime/native/update-channel.ts';
import type { HttpRequest, HttpResponse } from '../runtime/connectors.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

const passphrase = 'Core sync jobs audit synthetic passphrase';
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => error?.code === expected;
const LESSON = 'lesson_0123abcd-0000-4000-8000-000000000001';

async function engineWith(t: any, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-sync-audit-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...options });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Core Sync Audit Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  return engine;
}
/** The activity screen's own typed events (todayx.activity / activity.ts), newest record last. */
const typed = (engine: Engine, ctx: Context = OWNER) => auditEvents(engine.vault!, ctx);
const ofType = (engine: Engine, type: string, ctx: Context = OWNER) => typed(engine, ctx).filter(event => event.type === type);

test('a decided lesson is recorded with its id, the decision and the person; a refused one is not', async t => {
  const engine = await engineWith(t);
  const decisions: string[] = [];
  engine.services.lessons = { decideLesson: async (_ctx: Context, input: any) => {
    if (input.reason === 'refuse') throw Object.assign(new Error('Synthetic refusal.'), { code: 'LESSON_REVIEW_CHANGED' });
    decisions.push(input.decision); return { candidate: { id: LESSON }, status: 'approved' };
  } };
  const payload = (decision: string, reason = 'Synthetic reason with private words.') => ({ candidate: { id: LESSON, revision: 1, digest: '0'.repeat(64) }, reviewId: 'review-1', reviewDigest: '0'.repeat(64), decision, reason });
  await assert.rejects(engine.request('memory.decideLesson', payload('approve', 'refuse')), code('LESSON_REVIEW_CHANGED'));
  assert.deepEqual(ofType(engine, 'lesson.decided'), []);
  await engine.request('memory.decideLesson', payload('approve'));
  await engine.request('memory.decideLesson', payload('Not a code'));
  const [approved, odd] = ofType(engine, 'lesson.decided');
  assert.deepEqual(approved!.values, { lesson: LESSON, outcome: 'approve' });
  assert.deepEqual(approved!.actor, { kind: 'you', name: null });
  assert.deepEqual(odd!.values, { lesson: LESSON });
  assert.ok(!JSON.stringify(engine.vault!.read().activity.filter(item => item.event === 'lesson.decided')).includes('private words'));
});

test('a finished backup is recorded; a refused one is not', async t => {
  const engine = await engineWith(t);
  const member = await engine.request('members.add', { id: 'audit-viewer', name: 'Synthetic viewer', role: 'viewer', branches: ['*'] });
  const viewer: Context = { memberId: member.id, role: 'viewer', epoch: member.epoch, channel: 'desktop' };
  await assert.rejects(engine.requestAs(viewer, 'workspace.backup', {}));
  assert.deepEqual(ofType(engine, 'vault.backup.done'), []);
  const backup = await engine.request('workspace.backup', {});
  assert.equal(backup.encrypted, true);
  const [done] = ofType(engine, 'vault.backup.done');
  assert.equal(done!.state, 'done'); assert.deepEqual(done!.values, {}); assert.deepEqual(done!.actor, { kind: 'you', name: null });
  assert.deepEqual(ofType(engine, 'vault.backup.done', viewer), [], 'only the person who backed up (and the owner) sees it');
});

test('lock and unlock never write; their marks join the record with the next change to that workspace', async t => {
  const engine = await engineWith(t);
  const revision = () => engine.vault!.readIdentity().revision;
  const before = revision(), count = engine.vault!.read().activity.length;
  await engine.request('workspace.lock');
  await engine.request('workspace.open', { folder: 'main', passphrase });
  assert.equal(revision(), before, 'a read-only lock and reopen publish no revision');
  await engine.request('workspace.status'); await engine.request('activity.list');
  assert.equal(revision(), before); assert.equal(engine.vault!.read().activity.length, count);
  await engine.request('trust.update', { send: 'shape' });
  const locked = ofType(engine, 'workspace.locked'), unlocked = ofType(engine, 'workspace.unlocked');
  assert.equal(locked.length, 1); assert.equal(unlocked.length, 1);
  assert.ok(locked[0]!.at <= unlocked[0]!.at); assert.deepEqual(locked[0]!.actor, { kind: 'you', name: null }); assert.deepEqual(locked[0]!.values, {});
  // The marks were written once.
  await engine.request('trust.update', { send: 'nothing' });
  assert.equal(ofType(engine, 'workspace.locked').length, 1);

  // A mark never lands in another workspace, and marks for another workspace are dropped.
  await engine.request('workspace.lock');
  await engine.request('workspace.create', { name: 'Core Sync Second Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'second' });
  await engine.request('trust.update', { send: 'shape' });
  assert.deepEqual(ofType(engine, 'workspace.locked'), []);
  await engine.request('workspace.lock');
  await engine.request('workspace.open', { folder: 'main', passphrase });
  await engine.request('trust.update', { send: 'shape' });
  assert.equal(ofType(engine, 'workspace.locked').length, 2, 'both locks of this workspace; the second workspace lock was dropped');
  assert.equal(ofType(engine, 'workspace.unlocked').length, 2);
});

test('an update check is recorded with its outcome only when it succeeds', async t => {
  const keys = generateKeyPairSync('ed25519'), feed = 'https://updates.example.com/stable.json', now = Date.now();
  const text = canonicalChannelDocument({ format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(now - 3600000).toISOString(), expiresAt: new Date(now + 86400000).toISOString(), releases: [] });
  let offline = true;
  const http = async (request: HttpRequest): Promise<HttpResponse> => {
    if (offline) throw new Error('Synthetic offline feed.');
    if (request.url === feed) return { status: 200, url: request.url, body: text };
    if (request.url === `${feed}.sig`) return { status: 200, url: request.url, body: sign(null, Buffer.from(text), keys.privateKey).toString('base64url') };
    return { status: 404, url: request.url, body: '' };
  };
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-sync-release-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock),
    modules: { release: { releasePublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(), channel: 'stable', feedUrl: feed, http, installRoot: join(directory, 'install') } } });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Core Sync Release Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  await assert.rejects(engine.request('release.checkUpdate', {}), code('UPDATE_FEED_UNAVAILABLE'));
  assert.deepEqual(ofType(engine, 'release.update.checked'), []);
  offline = false;
  const checked = await engine.request('release.checkUpdate', {});
  assert.equal(checked.action, 'none');
  const [event] = ofType(engine, 'release.update.checked');
  assert.deepEqual(event!.values, { status: 'none' }); assert.deepEqual(event!.actor, { kind: 'you', name: null });
});
