import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChannelGuard, canonicalChannelDocument, rolloutBucket, selectRelease, verifyChannelDocument, type ChannelDocument, type ChannelRelease } from '../runtime/native/update-channel.ts';

// Synthetic signing keys only; no production feed is created.
const keys = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const code = (expected:string) => (error:any) => error.code === expected;
const NOW = Date.parse('2026-10-14T12:00:00.000Z'), HOUR = 3600000, DAY = 24 * HOUR;
const iso = (ms:number) => new Date(ms).toISOString();
function release(version:string, over:Partial<ChannelRelease> = {}):ChannelRelease {
  return { version, platform: 'linux', architecture: 'x64', manifestSha256: 'a'.repeat(64), rolloutPercent: 100, withdrawn: false, previewExpiresAt: null, ...over };
}
function feed(over:Partial<ChannelDocument> = {}):ChannelDocument {
  return { format: 'chausar.channel.v1', channel: 'stable', issuedAt: iso(NOW - HOUR), expiresAt: iso(NOW + 7 * DAY), releases: [release('1.0.0'), release('1.1.0')], ...over };
}
const signed = (document:ChannelDocument, key = keys.privateKey) => { const text = canonicalChannelDocument(document); return { text, signature: sign(null, Buffer.from(text), key).toString('base64url') }; };
const opts = { publicKey: keys.publicKey, channel: 'stable' as const, now: NOW };
async function directory(t:any) { const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-channel-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }

test('a signed canonical channel verifies; changed, unsigned, foreign and noncanonical documents refuse with specific codes', () => {
  const { text, signature } = signed(feed());
  assert.equal(verifyChannelDocument(text, signature, opts).releases.length, 2);
  assert.ok(Object.isFrozen(verifyChannelDocument(text, signature, opts).releases[0]));
  assert.throws(() => verifyChannelDocument(text.replace('"rolloutPercent":100', '"rolloutPercent":99'), signature, opts), code('UPDATE_FEED_SIGNATURE_INVALID'));
  assert.throws(() => verifyChannelDocument(text, '', opts), code('UPDATE_FEED_UNSIGNED'));
  assert.throws(() => verifyChannelDocument(text, signed(feed(), other.privateKey).signature, opts), code('UPDATE_FEED_SIGNATURE_INVALID'));
  assert.throws(() => verifyChannelDocument(JSON.stringify(feed(), null, 2), signature, opts), code('UPDATE_FEED_NONCANONICAL'));
  assert.throws(() => verifyChannelDocument(' '.repeat(65 * 1024), signature, opts), code('UPDATE_FEED_TOO_LARGE'));
  const extra = signed({ ...feed(), execute: 'anything' } as any);
  assert.throws(() => verifyChannelDocument(extra.text, extra.signature, opts), code('UPDATE_FEED_INVALID'));
  const preview = signed(feed({ channel: 'preview', releases: [release('1.1.0', { previewExpiresAt: iso(NOW + 30 * DAY) })] }));
  assert.throws(() => verifyChannelDocument(preview.text, preview.signature, opts), code('UPDATE_FEED_WRONG_CHANNEL'));
  assert.equal(verifyChannelDocument(preview.text, preview.signature, { ...opts, channel: 'preview' }).channel, 'preview');
  const missingExpiry = signed(feed({ channel: 'preview' }));
  assert.throws(() => verifyChannelDocument(missingExpiry.text, missingExpiry.signature, { ...opts, channel: 'preview' }), code('UPDATE_FEED_INVALID'));
  const badPercent = signed(feed({ releases: [release('1.1.0', { rolloutPercent: 12.5 })] }));
  assert.throws(() => verifyChannelDocument(badPercent.text, badPercent.signature, opts), code('UPDATE_FEED_INVALID'));
});

test('expired, overlong, future and older feeds refuse (freeze and replay protection)', async t => {
  const expired = signed(feed({ issuedAt: iso(NOW - 10 * DAY), expiresAt: iso(NOW - DAY) }));
  assert.throws(() => verifyChannelDocument(expired.text, expired.signature, opts), code('UPDATE_FEED_EXPIRED'));
  const long = signed(feed({ expiresAt: iso(NOW - HOUR + 31 * DAY) }));
  assert.throws(() => verifyChannelDocument(long.text, long.signature, opts), code('UPDATE_FEED_LIFETIME_TOO_LONG'));
  const future = signed(feed({ issuedAt: iso(NOW + DAY), expiresAt: iso(NOW + 2 * DAY) }));
  assert.throws(() => verifyChannelDocument(future.text, future.signature, opts), code('UPDATE_FEED_FROM_FUTURE'));

  const stateDirectory = await directory(t), guard = new ChannelGuard({ publicKey: keys.publicKey, channel: 'stable', stateDirectory, now: () => NOW });
  const newer = signed(feed({ issuedAt: iso(NOW - HOUR) })), older = signed(feed({ issuedAt: iso(NOW - 2 * HOUR) }));
  await guard.accept(newer.text, newer.signature);
  await guard.accept(newer.text, newer.signature); // the identical document may be fetched again
  await assert.rejects(guard.accept(older.text, older.signature), code('UPDATE_FEED_ROLLBACK'));
  const conflicting = signed(feed({ issuedAt: iso(NOW - HOUR), releases: [release('9.0.0')] }));
  await assert.rejects(guard.accept(conflicting.text, conflicting.signature), code('UPDATE_FEED_CONFLICT'));
  // Persisted across a restart: a fresh guard on the same directory still refuses the older feed.
  const restarted = new ChannelGuard({ publicKey: keys.publicKey, channel: 'stable', stateDirectory, now: () => NOW });
  await assert.rejects(restarted.accept(older.text, older.signature), code('UPDATE_FEED_ROLLBACK'));
  assert.equal((await restarted.lastAccepted())?.issuedAt, iso(NOW - HOUR));
  assert.equal(JSON.parse(await readFile(join(stateDirectory, 'channel-state.json'), 'utf8')).issuedAt, iso(NOW - HOUR));
});

test('rollout bucketing is deterministic and monotonic in the rollout percent', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `install-${String(i).padStart(4, '0')}`);
  assert.equal(rolloutBucket(ids[0], '1.1.0'), rolloutBucket(ids[0], '1.1.0'));
  for (const id of ids) assert.ok(rolloutBucket(id, '1.1.0') >= 0 && rolloutBucket(id, '1.1.0') < 100);
  let previous = new Set<string>();
  for (const percent of [0, 1, 5, 10, 25, 50, 75, 99, 100]) {
    const { text, signature } = signed(feed({ releases: [release('1.1.0', { rolloutPercent: percent })] })), document = verifyChannelDocument(text, signature, opts);
    const inside = new Set(ids.filter(installId => selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId, now: NOW }).action === 'update'));
    for (const id of previous) assert.ok(inside.has(id), 'raising the percent never removes an install');
    if (percent === 0) assert.equal(inside.size, 0);
    if (percent === 100) assert.equal(inside.size, ids.length);
    if (percent === 50) assert.ok(inside.size > 140 && inside.size < 260);
    previous = inside;
  }
  const document = feed({ releases: [release('1.1.0', { rolloutPercent: 0 })] });
  assert.deepEqual(selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId: ids[0], now: NOW }), { action: 'none', reason: 'not-in-rollout', currentVersion: '1.0.0' });
});

test('selection picks the highest eligible newer release and skips withdrawn, expired preview and other targets', () => {
  const id = 'install-selection-1';
  const document = feed({ releases: [release('1.0.0'), release('1.1.0'), release('1.2.0', { withdrawn: true }), release('2.0.0', { platform: 'win32' }), release('1.1.5', { architecture: 'arm64' })] });
  const chosen = selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId: id, now: NOW });
  assert.equal(chosen.action, 'update'); assert.equal(chosen.action === 'update' && chosen.release.version, '1.1.0');
  assert.equal(selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.1.0', installId: id, now: NOW }).action, 'none');
  const preview = feed({ channel: 'preview', releases: [release('1.3.0-preview.2', { previewExpiresAt: iso(NOW - HOUR) }), release('1.3.0-preview.1', { previewExpiresAt: iso(NOW + DAY) })] });
  const picked = selectRelease(preview, { platform: 'linux', arch: 'x64', currentVersion: '1.2.0', installId: id, now: NOW });
  assert.equal(picked.action === 'update' && picked.release.version, '1.3.0-preview.1');
  assert.throws(() => selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId: 'x', now: NOW }), code('INVALID_INSTALL_ID'));
});

test('kill switch: a withdrawn running version advises rollback to the highest older usable version', () => {
  const document = feed({ releases: [release('0.8.0'), release('0.9.0'), release('0.9.5', { withdrawn: true }), release('1.0.0', { withdrawn: true }), release('1.1.0', { rolloutPercent: 100 })] });
  assert.deepEqual(selectRelease(document, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId: 'install-kill-1', now: NOW }),
    { action: 'rollback-advised', currentVersion: '1.0.0', to: '0.9.0', release: release('0.9.0') });
  const alone = feed({ releases: [release('1.0.0', { withdrawn: true })] });
  assert.deepEqual(selectRelease(alone, { platform: 'linux', arch: 'x64', currentVersion: '1.0.0', installId: 'install-kill-1', now: NOW }),
    { action: 'rollback-advised', currentVersion: '1.0.0', to: null, release: null });
});
