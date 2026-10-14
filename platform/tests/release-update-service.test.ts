import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseManifest, type ReleaseManifest } from '../runtime/updater.ts';
import type { HttpRequest, HttpResponse } from '../runtime/connectors.ts';
import { canonicalChannelDocument, type ChannelDocument, type ChannelRelease } from '../runtime/native/update-channel.ts';
import { UpdateFeedClient, validateFeedUrl } from '../runtime/native/update-feed-client.ts';
import { UpdateService } from '../runtime/native/update-service.ts';
import { InstallLayout } from '../runtime/native/update-install.ts';

// Synthetic keys and inert artifacts only; no request leaves the process.
const keys = generateKeyPairSync('ed25519'), code = (expected:string) => (error:any) => error.code === expected;
const hash = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
const signText = (text:string) => sign(null, Buffer.from(text), keys.privateKey).toString('base64url');
const FEED = 'https://updates.example.com/stable.json', HOUR = 3600000;

test('the feed client refuses http, credentials, redirects and demo mode', async () => {
  for (const url of ['http://updates.example.com/stable.json', 'https://user:secret@updates.example.com/stable.json', 'https://127.0.0.1/stable.json', 'https://updates.example.com:8443/stable.json', 'https://updates.example.com/stable.json?x=1', 'https://localhost/stable.json', 'not a url'])
    assert.throws(() => validateFeedUrl(url), code('UPDATE_FEED_URL_REFUSED'));
  assert.equal(validateFeedUrl(FEED), FEED);
  let calls = 0;
  const demo = new UpdateFeedClient({ feedUrl: FEED, demo: true, http: async () => { calls++; return { status: 200, body: '' }; } });
  await assert.rejects(demo.fetchChannel(), code('DEMO_EXTERNAL_DISABLED')); assert.equal(calls, 0);
  const redirected = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async () => ({ status: 302, body: '' }) });
  await assert.rejects(redirected.fetchChannel(), code('UPDATE_FEED_REDIRECT_REFUSED'));
  const moved = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async r => ({ status: 200, url: 'https://elsewhere.example.com/stable.json', body: r.url }) });
  await assert.rejects(moved.fetchChannel(), code('UPDATE_FEED_REDIRECT_REFUSED'));
  const failing = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async () => { throw new Error('socket detail from outside'); } });
  await assert.rejects(failing.fetchChannel(), (error:any) => error.code === 'UPDATE_FEED_UNAVAILABLE' && !error.message.includes('socket'));
  const huge = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async r => ({ status: 200, url: r.url, body: 'x'.repeat(r.maxBytes + 1) }) });
  await assert.rejects(huge.fetchChannel(), code('UPDATE_FEED_TOO_LARGE'));
  const requests:HttpRequest[] = [];
  const ok = new UpdateFeedClient({ feedUrl: FEED, demo: false, http: async r => { requests.push(r); return { status: 200, url: r.url, body: r.url.endsWith('.sig') ? 'sig\n' : '{}' }; } });
  assert.deepEqual(await ok.fetchChannel(), { text: '{}', signature: 'sig' });
  assert.deepEqual(requests.map(r => [r.url, r.redirect, r.method]), [[FEED, 'error', 'GET'], [FEED + '.sig', 'error', 'GET']]);
  await ok.fetchManifest('1.1.0', 'linux', 'x64');
  assert.equal(requests[2].url, 'https://updates.example.com/releases/1.1.0/linux-x64.json');
});

async function world(t:any, options:{ current?:string; schema?:number; feedReleases?:(manifestSha:string)=>ChannelRelease[]; nextSchema?:number } = {}) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-service-')); t.after(() => rm(root, { recursive: true, force: true }));
  const current = options.current ?? '1.0.0', target = '1.1.0', platform = process.platform as ReleaseManifest['platform'], architecture = process.arch as ReleaseManifest['architecture'];
  const artifact = Buffer.from('Inert Chausar 1.1.0 AppImage fixture. Never execute this file.');
  const manifest:ReleaseManifest = { schemaVersion: 1, version: target, publishedAt: '2026-09-01T00:00:00.000Z', platform, architecture, url: 'https://downloads.example.com/Chausar-1.1.0.AppImage',
    sha256: hash(artifact), size: artifact.length, minEngineVersion: '0.1.0', dataSchemaVersion: options.nextSchema ?? 2, rollback: { supported: true, requiresBackup: true } };
  const manifestText = canonicalReleaseManifest(manifest), now = Date.now();
  const releases = options.feedReleases?.(hash(manifestText)) ?? [{ version: target, platform, architecture, manifestSha256: hash(manifestText), rolloutPercent: 100, withdrawn: false, previewExpiresAt: null }];
  const document:ChannelDocument = { format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(now - HOUR).toISOString(), expiresAt: new Date(now + 24 * HOUR).toISOString(), releases };
  const feedText = canonicalChannelDocument(document), manifestUrl = `https://updates.example.com/releases/${target}/${platform}-${architecture}.json`;
  const files:Record<string, string|Uint8Array> = { [FEED]: feedText, [FEED + '.sig']: signText(feedText), [manifestUrl]: manifestText, [manifestUrl + '.sig']: signText(manifestText), [manifest.url]: artifact };
  const requested:string[] = [];
  const http = async (request:HttpRequest):Promise<HttpResponse> => { requested.push(request.url); const body = files[request.url]; return body === undefined ? { status: 404, url: request.url, body: '' } : { status: 200, url: request.url, body }; };
  const installRoot = join(root, 'install'), appDataDirectory = join(root, 'app-data');
  const make = (version:string, demo = false) => new UpdateService({ publicKey: keys.publicKey, version, channel: 'stable', installRoot, appDataDirectory, feedUrl: FEED, http, installId: 'install-service-0001', demo, dataSchemaVersion: options.schema ?? 1 });
  // The running version was itself installed through the layout and committed.
  const running = Buffer.from('Inert running fixture.'), runningPath = join(root, 'running.artifact'); await writeFile(runningPath, running);
  const layout = new InstallLayout({ installRoot });
  await layout.install(runningPath, { ...manifest, version: current, url: `https://downloads.example.com/Chausar-${current}.AppImage`, sha256: hash(running), size: running.length });
  await layout.confirmHealthy(current);
  const backupBytes = Buffer.from('{"synthetic":"vault backup"}'), backupPath = join(root, 'backup.json'); await writeFile(backupPath, backupBytes);
  return { root, make, requested, files, manifest, backup: { path: backupPath, sha256: hash(backupBytes) }, installRoot };
}

test('service: check, stage, confirmed apply with a verified backup, health confirmation and rollback', async t => {
  const w = await world(t), service = w.make('1.0.0');
  await assert.rejects(service.stage(), code('UPDATE_NOT_CHECKED'));
  const checked = await service.check();
  assert.equal(checked.action, 'update');
  assert.ok(checked.action === 'update' && checked.version === '1.1.0' && checked.installMode === 'in-place-swap' && checked.backupRequired);
  const staged = await service.stage();
  assert.equal(staged.installed, false); assert.equal(staged.version, '1.1.0');
  await assert.rejects(service.apply({ confirmed: false }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(service.apply({} as any), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(service.apply({ confirmed: true }), code('BACKUP_REQUIRED'));
  await assert.rejects(service.apply({ confirmed: true, backup: { ...w.backup, sha256: '0'.repeat(64) } }), code('BACKUP_REQUIRED'));
  const applied = await service.apply({ confirmed: true, backup: w.backup });
  assert.deepEqual(applied, { applied: true, version: '1.1.0', previous: '1.0.0', state: 'trial', restartRequired: true, backupVerified: true, fromSchema: 1, toSchema: 2 });
  assert.equal((await service.status()).install?.state, 'trial');
  // The schema marker is not raised by the installer, so the older app can still open the vault after a rollback.
  assert.equal((await service.status()).dataSchema, null);
  const next = w.make('1.1.0');
  assert.equal((await next.resolveLaunch())?.version, '1.1.0');
  assert.equal((await next.confirmHealthy()).state, 'committed');
  await assert.rejects(next.rollback({ confirmed: false }), code('CONFIRMATION_REQUIRED'));
  assert.deepEqual(await next.rollback({ confirmed: true }), { rolledBack: true, from: '1.1.0', to: '1.0.0', restartRequired: true });
  assert.ok(w.requested.every(url => url.startsWith('https://')));
});

test('service: demo mode refuses before any request; a manifest not bound to the feed refuses', async t => {
  const w = await world(t);
  await assert.rejects(w.make('1.0.0', true).check(), code('DEMO_EXTERNAL_DISABLED'));
  assert.equal(w.requested.length, 0);
  const swapped = await world(t, { feedReleases: () => [{ version: '1.1.0', platform: process.platform as any, architecture: process.arch as any, manifestSha256: 'b'.repeat(64), rolloutPercent: 100, withdrawn: false, previewExpiresAt: null }] });
  await assert.rejects(swapped.make('1.0.0').check(), code('UPDATE_MANIFEST_MISMATCH'));
  const status = await swapped.make('1.0.0').status();
  assert.equal(status.candidate, null); assert.equal(status.build.usable, true); assert.equal(status.lastFeed?.channel, 'stable');
});

test('service: the kill switch advises rollback when the running version is withdrawn', async t => {
  const platform = process.platform as any, architecture = process.arch as any, base = { platform, architecture, rolloutPercent: 100, previewExpiresAt: null };
  const w = await world(t, { feedReleases: sha => [{ ...base, version: '0.9.0', manifestSha256: sha, withdrawn: false }, { ...base, version: '1.0.0', manifestSha256: sha, withdrawn: true }] });
  const result = await w.make('1.0.0').check();
  assert.equal(result.action, 'rollback-advised');
  assert.ok(result.action === 'rollback-advised' && result.to === '0.9.0' && result.previousInstalled === false);
});

test('service: a staged native installer is never applied', async t => {
  const w = await world(t, { nextSchema: 1 });
  const exe = { ...w.manifest, url: 'https://downloads.example.com/Chausar-Setup-1.1.0.exe' }, text = canonicalReleaseManifest(exe);
  const platform = process.platform, arch = process.arch, manifestUrl = `https://updates.example.com/releases/1.1.0/${platform}-${arch}.json`;
  w.files[manifestUrl] = text; w.files[manifestUrl + '.sig'] = signText(text); w.files[exe.url] = w.files[w.manifest.url];
  const now = Date.now(), document:ChannelDocument = { format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(now - HOUR / 2).toISOString(), expiresAt: new Date(now + HOUR).toISOString(),
    releases: [{ version: '1.1.0', platform: platform as any, architecture: arch as any, manifestSha256: hash(text), rolloutPercent: 100, withdrawn: false, previewExpiresAt: null }] };
  const feedText = canonicalChannelDocument(document); w.files[FEED] = feedText; w.files[FEED + '.sig'] = signText(feedText);
  const service = w.make('1.0.0'), checked = await service.check();
  assert.ok(checked.action === 'update' && checked.installMode === 'manual-native-installer-required');
  assert.equal((await service.stage()).installMode, 'manual-native-installer-required');
  await assert.rejects(service.apply({ confirmed: true }), code('NATIVE_INSTALLER_REQUIRED'));
  assert.equal(JSON.parse(await readFile(join(w.installRoot, 'current.json'), 'utf8')).version, '1.0.0');
});
