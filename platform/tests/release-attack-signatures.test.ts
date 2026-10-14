import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, readFile, rename, symlink, writeFile, rm, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ReleaseUpdater, canonicalReleaseManifest, releasePublicKey } from '../runtime/updater.ts';
import { ChannelGuard, canonicalChannelDocument, selectRelease, verifyChannelDocument, type ChannelDocument } from '../runtime/native/update-channel.ts';
import { UpdateFeedClient } from '../runtime/native/update-feed-client.ts';
import { copyVerifiedPrivate } from '../runtime/native/update-files.ts';
import { FEED, HOUR, code, entry, hash, keys, releaseManifest, signText, temporary, world } from './fixtures/release-attack-world.ts';

// Adversarial review of the signed update path. Every test is one attack; passing means the attack is refused.
const artifact = Buffer.from('A synthetic artifact; this file must never be executed.');
const base = releaseManifest('1.1.0', artifact);
const canonicalText = canonicalReleaseManifest(base);
const updater = (stageDirectory:string, http?:any) => new ReleaseUpdater({ publicKey: keys.publicKey, version: '1.0.0', stageDirectory, http });
const NOW = Date.now();
const doc = (over:Partial<ChannelDocument> = {}):ChannelDocument => ({ format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(NOW - HOUR).toISOString(), expiresAt: new Date(NOW + 24 * HOUR).toISOString(), releases: [entry('1.1.0', hash(canonicalText))], ...over });
const channelOptions = { publicKey: keys.publicKey, channel: 'stable' as const, now: NOW };

/** Encodes Ed25519 S + L: the classic malleated signature that a lax verifier also accepts. */
function malleate(signature:string):string {
  const bytes = Buffer.from(signature, 'base64url'), L = (1n << 252n) + 27742317777372353535851937790883648493n;
  let s = 0n; for (let i = 31; i >= 0; i--) s = (s << 8n) | BigInt(bytes[32 + i]);
  const t = s + L; for (let i = 0; i < 32; i++) bytes[32 + i] = Number((t >> BigInt(8 * i)) & 0xffn);
  return bytes.toString('base64url');
}

test('attack: a validly signed manifest text with a duplicate key is refused as noncanonical', async t => {
  const u = updater(await temporary(t)), text = canonicalText.replace('{"architecture":', '{"architecture":"ia32","architecture":');
  assert.throws(() => u.verify(text, signText(text)), code('NONCANONICAL_MANIFEST'));
  const channelText = canonicalChannelDocument(doc()).replace('{"channel":"stable"', '{"channel":"preview","channel":"stable"');
  assert.throws(() => verifyChannelDocument(channelText, signText(channelText), channelOptions), code('UPDATE_FEED_NONCANONICAL'));
});

test('attack: unicode escapes, alternate number forms, whitespace and a byte-order mark are refused', async t => {
  const u = updater(await temporary(t));
  const variants = [
    canonicalText.replace('"version":"1.1.0"', '"version":"\\u0031.1.0"'),
    canonicalText.replace(`"size":${base.size}`, `"size":${base.size}.0`),
    canonicalText.replace(`"size":${base.size}`, `"size":${base.size}e0`),
    canonicalText.replace('"dataSchemaVersion":1', '"dataSchemaVersion":1.0'),
    canonicalText.replace('"schemaVersion":1', '"schemaVersion": 1'),
    '﻿' + canonicalText,
    canonicalText + '\n',
  ];
  // A leading byte-order mark is not JSON at all; the others parse but differ from the canonical payload.
  for (const text of variants) assert.throws(() => u.verify(text, signText(text)), (error:any) => error.code === (text.startsWith('\ufeff') ? 'INVALID_MANIFEST' : 'NONCANONICAL_MANIFEST'));
  const feed = canonicalChannelDocument(doc());
  for (const text of [feed.replace('"rolloutPercent":100', '"rolloutPercent":1e2'), feed.replace('"format":"chausar.channel.v1"', '"format":"chausar\\u002echannel.v1"'), feed + ' '])
    assert.throws(() => verifyChannelDocument(text, signText(text), channelOptions), code('UPDATE_FEED_NONCANONICAL'));
});

test('attack: a malleated Ed25519 signature (S + L) is refused for manifests and feeds', async t => {
  const u = updater(await temporary(t)), signature = signText(canonicalText);
  assert.equal(u.verify(canonicalText, signature).version, '1.1.0');
  assert.throws(() => u.verify(canonicalText, malleate(signature)), code('INVALID_RELEASE_SIGNATURE'));
  const feed = canonicalChannelDocument(doc());
  assert.throws(() => verifyChannelDocument(feed, malleate(signText(feed)), channelOptions), code('UPDATE_FEED_SIGNATURE_INVALID'));
});

test('attack: padded, standard-alphabet and noncanonical-trailing-bit base64 signatures are refused', async t => {
  const u = updater(await temporary(t)), signature = signText(canonicalText), bytes = Buffer.from(signature, 'base64url');
  const padded = bytes.toString('base64'), standard = bytes.toString('base64').replace(/=+$/, '');
  // The last character carries two unused bits; flipping them decodes to the same 64 bytes.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', last = alphabet.indexOf(signature.at(-1)!);
  const trailing = signature.slice(0, -1) + alphabet[last ^ 1];
  assert.deepEqual(Buffer.from(trailing, 'base64url'), bytes);
  for (const variant of [padded, standard.includes('+') || standard.includes('/') ? standard : signature.slice(0, -1) + '+', trailing, signature + '\n', ' ' + signature.slice(1)])
    assert.throws(() => u.verify(canonicalText, variant), code('INVALID_RELEASE_SIGNATURE'));
  const feed = canonicalChannelDocument(doc()), feedSignature = signText(feed), feedLast = alphabet.indexOf(feedSignature.at(-1)!);
  for (const variant of [Buffer.from(feedSignature, 'base64url').toString('base64'), feedSignature.slice(0, -1) + alphabet[feedLast ^ 1]])
    assert.throws(() => verifyChannelDocument(feed, variant, channelOptions), code('UPDATE_FEED_SIGNATURE_INVALID'));
});

test('attack: key confusion — X25519, RSA, a private Ed25519 key as text or KeyObject — is refused for manifests and feeds', async t => {
  const stageDirectory = await temporary(t), x25519 = generateKeyPairSync('x25519'), rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const candidates:any[] = [
    x25519.publicKey, x25519.publicKey.export({ type: 'spki', format: 'pem' }),
    rsa.publicKey.export({ type: 'spki', format: 'pem' }),
    keys.privateKey, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    'not a key', '',
  ];
  for (const publicKey of candidates) {
    assert.throws(() => releasePublicKey(publicKey), code('INVALID_UPDATE_KEY'));
    assert.throws(() => new ReleaseUpdater({ publicKey, version: '1.0.0', stageDirectory }), code('INVALID_UPDATE_KEY'));
    assert.throws(() => new ChannelGuard({ publicKey, channel: 'stable', stateDirectory: stageDirectory }), code('INVALID_UPDATE_KEY'));
    const feed = canonicalChannelDocument(doc());
    assert.throws(() => verifyChannelDocument(feed, signText(feed), { ...channelOptions, publicKey }), code('INVALID_UPDATE_KEY'));
  }
  assert.equal(releasePublicKey(keys.publicKey.export({ type: 'spki', format: 'pem' }) as string).asymmetricKeyType, 'ed25519');
});

test('attack: a feed signed by the right key for the other channel, or a manifest for another platform, is refused', async t => {
  const preview = doc({ channel: 'preview', releases: [entry('1.1.0', hash(canonicalText), { previewExpiresAt: new Date(NOW + 48 * HOUR).toISOString() })] });
  const text = canonicalChannelDocument(preview);
  assert.throws(() => verifyChannelDocument(text, signText(text), channelOptions), code('UPDATE_FEED_WRONG_CHANNEL'));
  const otherPlatform = process.platform === 'linux' ? 'darwin' : 'linux';
  const foreign = doc({ releases: [entry('9.0.0', 'c'.repeat(64), { platform: otherPlatform })] }), foreignText = canonicalChannelDocument(foreign);
  const verified = verifyChannelDocument(foreignText, signText(foreignText), channelOptions);
  assert.equal(selectRelease(verified, { platform: process.platform, arch: process.arch, currentVersion: '1.0.0', installId: 'install-attack-0001', now: NOW }).action, 'none');
  const wrong = { ...base, platform: otherPlatform as any }, wrongText = canonicalReleaseManifest(wrong), u = updater(await temporary(t));
  assert.throws(() => u.verify(wrongText, signText(wrongText)), code('INCOMPATIBLE_PLATFORM'));
});

test('attack: a signed feed replayed as a manifest, or a signed manifest replayed as a feed, is refused (one key, disjoint schemas)', async t => {
  const feed = canonicalChannelDocument(doc()), u = updater(await temporary(t));
  assert.throws(() => u.verify(feed, signText(feed)), code('INVALID_MANIFEST'));
  assert.throws(() => verifyChannelDocument(canonicalText, signText(canonicalText), channelOptions), code('UPDATE_FEED_INVALID'));
});

test('attack: a valid feed served with an older validly signed manifest of the same version is refused', async t => {
  const w = await world(t);
  // The publisher once signed different 1.1.0 contents; the feed names the current ones by digest.
  w.serveManifest({ ...w.manifest, publishedAt: '2026-08-01T00:00:00.000Z' });
  await assert.rejects(w.make('1.0.0').check(), code('UPDATE_MANIFEST_MISMATCH'));
  // A validly signed manifest for a lower version, named by a feed, still cannot downgrade the running app.
  const old = releaseManifest('0.9.0', w.artifact), oldText = w.serveManifest(old);
  w.publish([entry('1.1.0', 'd'.repeat(64)), entry('0.9.0', hash(oldText))]);
  const result = await w.make('1.0.0').check().catch(error => error);
  assert.ok(result.code === 'UPDATE_MANIFEST_MISMATCH' || result.action === 'none');
  assert.throws(() => updater(join(w.root, 'stage-direct')).verify(oldText, signText(oldText)), code('RELEASE_DOWNGRADE_REFUSED'));
});

test('attack: a manifest location outside the feed folder, or a non-canonical artifact URL, is refused', async t => {
  const client = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async () => { throw new Error('must not be called'); } });
  for (const version of ['../../evil', '1.1.0/../../x', 'https://evil.example.com/a', '1.1.0?x=1', '1.1.0#a'])
    assert.throws(() => client.fetchManifest(version, 'linux', 'x64'), code('INVALID_VERSION'));
  const u = updater(await temporary(t));
  for (const url of ['https://downloads.example.com/a/../Chausar.AppImage', 'https://DOWNLOADS.example.com/Chausar.AppImage', 'https://downloads.example.com:443/Chausar.AppImage', 'https://downloads.example.com/Chausar.AppImage#x', 'https://u:p@downloads.example.com/Chausar.AppImage', 'https://[::1]/Chausar.AppImage', 'https://downloads.internal/Chausar.AppImage']) {
    const moved = { ...base, url }, text = canonicalReleaseManifest(moved);
    assert.throws(() => u.verify(text, signText(text)), code('INVALID_RELEASE_URL'));
  }
});

test('attack: an oversized or redirected artifact download is refused before anything is staged', async t => {
  const stageDirectory = await temporary(t), signature = signText(canonicalText), seen:any[] = [];
  const big = updater(stageDirectory, async (request:any) => { seen.push(request); return { status: 200, url: request.url, body: Buffer.concat([artifact, Buffer.from('x')]) }; });
  await assert.rejects(big.stage(canonicalText, signature), code('RELEASE_HASH_MISMATCH'));
  assert.equal(seen[0].maxBytes, base.size); assert.equal(seen[0].redirect, 'error');
  const redirected = updater(stageDirectory, async () => ({ status: 200, url: 'https://mirror.example.com/x.AppImage', body: artifact }));
  await assert.rejects(redirected.stage(canonicalText, signature), code('RELEASE_FETCH_REFUSED'));
  const status302 = updater(stageDirectory, async (request:any) => ({ status: 302, url: request.url, body: '' }));
  await assert.rejects(status302.stage(canonicalText, signature), code('RELEASE_FETCH_REFUSED'));
  const feed = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async (request:any) => ({ status: 200, url: request.url, body: Buffer.alloc(request.maxBytes + 1, 0x20) }) });
  await assert.rejects(feed.fetchChannel(), code('UPDATE_FEED_TOO_LARGE'));
  assert.ok((await lstat(join(stageDirectory, 'pending-release.json')).catch(() => null)) === null);
});

test('attack: swapping the staged artifact between stage and apply is caught by the install re-hash', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage();
  const pending = JSON.parse(await readFile(join(w.installRoot, 'staging', 'pending-release.json'), 'utf8'));
  await writeFile(pending.artifactPath, Buffer.from('Swapped bytes of the same length as the inert fixture artifact!!').subarray(0, w.artifact.length));
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('INSTALL_ARTIFACT_MISMATCH'));
  // Replaced by a symbolic link to the genuine bytes: still refused (no links are followed).
  const genuine = join(w.root, 'genuine.artifact'); await writeFile(genuine, w.artifact); await rm(pending.artifactPath); await symlink(genuine, pending.artifactPath);
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('INSTALL_ARTIFACT_MISMATCH'));
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.0.0');
});

test('attack: a pending record pointing outside staging, or at an older signed release, is refused', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await service.check(); await service.stage();
  const path = join(w.installRoot, 'staging', 'pending-release.json'), pending = JSON.parse(await readFile(path, 'utf8'));
  const outside = join(w.root, 'outside.artifact'); await writeFile(outside, w.artifact);
  await writeFile(path, JSON.stringify({ ...pending, artifactPath: outside }));
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('UNSAFE_UPDATE_PATH'));
  const old = releaseManifest('0.9.0', w.artifact);
  await writeFile(path, JSON.stringify({ ...pending, manifest: canonicalReleaseManifest(old), signature: signText(canonicalReleaseManifest(old)) }));
  await assert.rejects(service.apply({ confirmed: true, backup: w.backup }), code('RELEASE_DOWNGRADE_REFUSED'));
  // A corrupt record never echoes its bytes in an error message.
  await writeFile(path, '{"secret-looking-content": ');
  await assert.rejects(updater(join(w.installRoot, 'staging'), async (r:any) => ({ status: 200, url: r.url, body: artifact })).stage(canonicalText, signText(canonicalText)),
    (error:any) => error.code === 'UNSAFE_STAGE' && !error.message.includes('secret'));
});

test('attack: symbolic links for the stage folder or install versions folder are refused', async t => {
  const root = await temporary(t), real = join(root, 'real'); await mkdir(real);
  await symlink(real, join(root, 'stage'));
  const u = updater(join(root, 'stage'), async (r:any) => ({ status: 200, url: r.url, body: artifact }));
  await assert.rejects(u.stage(canonicalText, signText(canonicalText)), (error:any) => ['UNSAFE_PATH', 'UNSAFE_STAGE'].includes(error.code));
  const w = await world(t), versions = join(w.installRoot, 'versions');
  await rename(versions, join(w.root, 'versions-moved')); await symlink(join(w.root, 'versions-moved'), versions);
  await assert.rejects(w.layout.pointer(), code('UNSAFE_PATH'));
});

test('attack: "__proto__" keys in manifests, feeds and saved state are refused and pollute nothing', async t => {
  const u = updater(await temporary(t));
  const polluted = canonicalText.replace('{"architecture"', '{"__proto__":{"polluted":true},"architecture"');
  assert.throws(() => u.verify(polluted, signText(polluted)), (error:any) => ['INVALID_MANIFEST', 'NONCANONICAL_MANIFEST'].includes(error.code));
  const feed = canonicalChannelDocument(doc()).replace('{"architecture"', '{"__proto__":{"polluted":true},"architecture"');
  assert.throws(() => verifyChannelDocument(feed, signText(feed), channelOptions), (error:any) => ['UPDATE_FEED_INVALID', 'UPDATE_FEED_NONCANONICAL'].includes(error.code));
  const w = await world(t);
  await mkdir(join(w.appDataDirectory, 'release'), { recursive: true, mode: 0o700 });
  await writeFile(join(w.appDataDirectory, 'release', 'version-schemas.json'), '{"versions":{"__proto__":{"polluted":true}}}');
  await writeFile(join(w.appDataDirectory, 'release', 'data-schema.json'), JSON.stringify({ dataSchemaVersion: 2, writtenBy: '1.1.0', at: new Date().toISOString() }));
  await writeFile(join(w.installRoot, 'current.json'), JSON.stringify({ version: '1.0.0', previous: '0.9.0', state: 'committed', attempts: 0, swappedAt: new Date().toISOString() }));
  await mkdir(join(w.installRoot, 'versions', '0.9.0'));
  await assert.rejects(w.make('1.0.0').rollback({ confirmed: true }), code('VERSION_SCHEMA_LEDGER_INVALID'));
  assert.equal(({} as any).polluted, undefined);
});

test('attack: the swap-after-hash window is closed by copying the verified bytes privately before unpacking', async t => {
  const root = await temporary(t), source = join(root, 'staged.artifact'), copy = join(root, 'copy.artifact');
  await writeFile(source, artifact);
  assert.deepEqual(await copyVerifiedPrivate(source, copy, { sha256: hash(artifact), size: artifact.length }, 'INSTALL_ARTIFACT_MISMATCH', 'x'), { sha256: hash(artifact), size: artifact.length });
  assert.deepEqual(await readFile(copy), artifact);
  if (process.platform !== 'win32') assert.equal((await lstat(copy)).mode & 0o777, 0o600);
  // Once copied, changing the staged file cannot change what is unpacked; a wrong source never leaves a copy behind.
  await writeFile(source, Buffer.alloc(artifact.length, 0x41));
  assert.deepEqual(await readFile(copy), artifact);
  const second = join(root, 'second.artifact');
  await assert.rejects(copyVerifiedPrivate(source, second, { sha256: hash(artifact), size: artifact.length }, 'INSTALL_ARTIFACT_MISMATCH', 'x'), code('INSTALL_ARTIFACT_MISMATCH'));
  assert.equal(await lstat(second).catch(() => null), null);
  // An existing destination (or a planted link) is never overwritten or removed.
  await assert.rejects(copyVerifiedPrivate(join(root, 'copy.artifact'), copy, { sha256: hash(artifact), size: artifact.length }, 'INSTALL_ARTIFACT_MISMATCH', 'x'), (error:any) => error.code === 'EEXIST');
  assert.deepEqual(await readFile(copy), artifact);
  const link = join(root, 'link.artifact'); await symlink(copy, link);
  await assert.rejects(copyVerifiedPrivate(link, join(root, 'third'), { sha256: hash(artifact), size: artifact.length }, 'INSTALL_ARTIFACT_MISMATCH', 'x'), code('INSTALL_ARTIFACT_MISMATCH'));
});
