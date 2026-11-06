// C5 task 31: the daily check and the background download. Stand-ins only: a feed made and signed here, a download seam, a
// fake clock. Never in the first 10 minutes after start, never while a run is busy, once a day, and only while the owner
// leaves Check daily on. With no key or no feed, a plain state and nothing faked.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseFeed, canonicalReleaseManifest, type DownloadResponse, type ReleaseFeed, type ReleaseManifest } from '../runtime/updater.ts';
import { UpdateService, followingDownload, readFeedFrom, updateCheckDue, updatesOptionsFrom, type UpdateServiceOptions } from '../runtime/update-service.ts';
import { Engine } from '../runtime/engine.ts';
import { noNet } from './helpers/no-net.ts';

test.beforeEach(t => noNet(t));

const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const FILE = Buffer.from('the new release, a stand-in that is never run');
const MINUTE = 60_000, HOUR = 60 * MINUTE;
const sig = (text: string) => sign(null, Buffer.from(text), keys.privateKey).toString('base64url');

function manifest(version = '0.2.0'): ReleaseManifest {
  return { schemaVersion: 1, version, publishedAt: '2026-11-01T00:00:00.000Z', platform: process.platform as ReleaseManifest['platform'], architecture: process.arch as ReleaseManifest['architecture'], url: 'https://downloads.example.com/chausar.bin', sha256: createHash('sha256').update(FILE).digest('hex'), size: FILE.length, minEngineVersion: '0.0.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
}
function feedOf(version = '0.2.0', overrides: Partial<ReleaseFeed> = {}) {
  const m = manifest(version);
  const feed: ReleaseFeed = { schemaVersion: 1, channel: 'beta', rolloutPercent: 100, expiresAt: '2099-01-01T00:00:00.000Z', releases: [{ manifest: m, signature: sig(canonicalReleaseManifest(m)) }], ...overrides };
  const text = canonicalReleaseFeed(feed);
  return { text, signature: sig(text) };
}
async function setup(t: TestContext, extra: Partial<UpdateServiceOptions> = {}) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-update-service-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = Date.parse('2026-11-06T10:00:00.000Z'), busy = false;
  const reads: string[] = [], downloads: string[] = [];
  let answer: () => Promise<{ text: string; signature: string }> = async () => feedOf();
  const service = new UpdateService({
    publicKey, feedUrl: 'https://downloads.example.com/{channel}/feed.json', directory, version: '0.1.0', channel: 'beta', windowsCertificateThumbprint: null, platform: 'linux', appImage: '/owned/Chausar.AppImage',
    clock: () => now, isBusy: () => busy,
    readFeed: async url => { reads.push(url); return answer(); },
    download: async request => { downloads.push(request.url); return { status: 200, url: request.url, headers: {}, body: (async function* () { yield FILE; })() }; },
    ...extra,
  });
  return { service, directory, reads, downloads, advance: (ms: number) => { now += ms; }, setBusy: (value: boolean) => { busy = value; }, setFeed: (value: () => Promise<{ text: string; signature: string }>) => { answer = value; } };
}

test('the daily rule: not in the first 10 minutes, not while busy, not when off, once a day', () => {
  const base = { now: 100 * HOUR, startedAt: 90 * HOUR, lastCheckAt: null, lastResult: null, daily: true, busy: false };
  assert.equal(updateCheckDue(base), true);
  assert.equal(updateCheckDue({ ...base, startedAt: base.now - 9 * MINUTE }), false, 'the first 10 minutes');
  assert.equal(updateCheckDue({ ...base, startedAt: base.now - 10 * MINUTE }), true);
  assert.equal(updateCheckDue({ ...base, busy: true }), false, 'a run is busy');
  assert.equal(updateCheckDue({ ...base, daily: false }), false, 'the owner turned it off');
  assert.equal(updateCheckDue({ ...base, lastCheckAt: base.now - 23 * HOUR }), false, 'once a day');
  assert.equal(updateCheckDue({ ...base, lastCheckAt: base.now - 24 * HOUR }), true);
  assert.equal(updateCheckDue({ ...base, lastCheckAt: base.now - 2 * HOUR, lastResult: 'cut' }), true, 'a cut download goes on sooner');
  assert.equal(updateCheckDue({ ...base, lastCheckAt: base.now - 30 * MINUTE, lastResult: 'cut' }), false);
});

test('no key or no feed: a plain state, a check does nothing, and the tick never asks anything', async t => {
  for (const missing of [{ publicKey: null }, { feedUrl: null }]) {
    const { service, reads, advance } = await setup(t, missing);
    const view = await service.view();
    assert.deepEqual([view.state, view.configured, view.installMode], ['not-set-up', false, 'manual-native-installer-required']);
    assert.equal((await service.checkNow()).state, 'not-set-up');
    advance(HOUR);
    await service.tick();
    await service.settled();
    assert.deepEqual(reads, []);
  }
});

test('the tick checks after ten minutes, staging the release in the background; a second tick that day asks nothing', async t => {
  const { service, reads, downloads, advance, directory } = await setup(t);
  assert.equal((await service.view()).state, 'idle');
  await service.tick();
  await service.settled();
  assert.deepEqual(reads, [], 'not in the first minutes');
  advance(10 * MINUTE);
  await service.tick();
  await service.settled();
  assert.deepEqual(reads, ['https://downloads.example.com/beta/feed.json']);
  assert.deepEqual(downloads, ['https://downloads.example.com/chausar.bin']);
  const view = await service.view();
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.target, { version: '0.2.0', bytes: FILE.length });
  assert.equal(view.lastCheckedAt, '2026-11-06T10:10:00.000Z');
  assert.ok((await readdir(join(directory, 'stage'))).includes('pending-release.json'));
  advance(HOUR);
  await service.tick();
  await service.settled();
  assert.equal(reads.length, 1);
  advance(24 * HOUR);
  await service.tick();
  await service.settled();
  assert.equal(reads.length, 2, 'the next day');
});

test('while a run is busy the tick waits; turning Check daily off stops it; the setting and the channel are kept', async t => {
  const { service, reads, advance, setBusy, directory } = await setup(t);
  advance(HOUR);
  setBusy(true);
  await service.tick();
  await service.settled();
  assert.deepEqual(reads, []);
  setBusy(false);
  const off = await service.settings({ daily: false });
  assert.equal(off.daily, false);
  await service.tick();
  await service.settled();
  assert.deepEqual(reads, []);
  assert.equal((await service.settings({ channel: 'stable' })).channel, 'stable');
  const again = new UpdateService({ publicKey, feedUrl: 'https://downloads.example.com/feed.json', directory, version: '0.1.0', channel: 'beta', windowsCertificateThumbprint: null, clock: () => 0, isBusy: () => false, platform: 'linux' });
  const kept = await again.view();
  assert.deepEqual([kept.daily, kept.channel], [false, 'stable']);
  for (const bad of [{}, { daily: 'no' }, { channel: 'nightly' }, { daily: true, path: 'C:/x' }, null]) await assert.rejects(service.settings(bad), (error: any) => error.code === 'INVALID_UPDATE_SETTINGS', JSON.stringify(bad));
});

test('Check now runs at once, even in the first minutes, and answers while it works', async t => {
  let release!: () => void;
  const gate = new Promise<void>(accept => { release = accept; });
  const held = await setup(t);
  held.setFeed(async () => { await gate; return feedOf(); });
  const view = await held.service.checkNow();
  assert.equal(view.state, 'checking');
  assert.equal((await held.service.checkNow()).state, 'checking', 'one check at a time');
  release();
  await held.service.settled();
  assert.equal((await held.service.view()).state, 'ready');
  assert.deepEqual(held.reads.length, 1);
});

test('nothing newer reads up to date; a refused feed says why in the engine\'s own words; a lost connection in plain words', async t => {
  const { service, setFeed, advance } = await setup(t);
  setFeed(async () => feedOf('0.1.0'));
  await service.checkNow();
  await service.settled();
  assert.equal((await service.view()).state, 'up-to-date');
  setFeed(async () => ({ ...feedOf(), signature: sig('another text') }));
  await service.checkNow();
  await service.settled();
  const refused = await service.view();
  assert.equal(refused.state, 'failed');
  assert.equal(refused.reason, 'The update feed signature is invalid.');
  setFeed(async () => feedOf('0.2.0', { expiresAt: '2020-01-01T00:00:00.000Z' }));
  await service.checkNow();
  await service.settled();
  assert.match((await service.view()).reason!, /clock may be wrong/);
  setFeed(async () => { throw new Error('getaddrinfo ENOTFOUND C:\\secret-marker'); });
  advance(MINUTE);
  await service.checkNow();
  await service.settled();
  const lost = await service.view();
  assert.equal(lost.state, 'failed');
  assert.equal(lost.reason, "Chausar couldn't reach the update feed. It tries again tomorrow.");
});

test('a release already waiting still reads ready when a later check could not reach the feed', async t => {
  const { service, setFeed, advance } = await setup(t);
  await service.checkNow();
  await service.settled();
  assert.equal((await service.view()).state, 'ready');
  setFeed(async () => { throw new Error('offline'); });
  advance(25 * HOUR);
  await service.tick();
  await service.settled();
  assert.equal((await service.view()).state, 'ready');
});

test('a cut download keeps its part: the view says how far, and the next check goes on from there', async t => {
  let cut = true;
  const asked: Record<string, string>[] = [];
  const { service, advance } = await setup(t, { download: async (request): Promise<DownloadResponse> => {
    asked.push(request.headers);
    const half = FILE.subarray(10);
    if (cut) return { status: 200, url: request.url, headers: {}, body: (async function* () { yield FILE.subarray(0, 10); throw new Error('cut'); })() };
    return { status: 206, url: request.url, headers: { 'content-range': `bytes 10-${FILE.length - 1}/${FILE.length}` }, body: (async function* () { yield half; })() };
  } });
  await service.checkNow();
  await service.settled();
  const stopped = await service.view();
  assert.equal(stopped.state, 'failed');
  assert.match(stopped.reason!, /continues from there/);
  assert.equal(stopped.downloadedBytes, 10);
  cut = false;
  advance(HOUR + MINUTE);
  advance(10 * MINUTE);
  await service.tick();
  await service.settled();
  assert.equal(asked.at(-1)!.Range, 'bytes=10-');
  assert.equal((await service.view()).state, 'ready');
});

test('what a staged release reads depends on this computer: needs signing, ready, or by hand; a finished one is cleared', async t => {
  const stageIt = async (extra: Partial<UpdateServiceOptions>) => {
    const made = await setup(t, extra);
    await made.service.checkNow();
    await made.service.settled();
    return made;
  };
  assert.equal((await (await stageIt({ platform: 'win32', windowsCertificateThumbprint: null })).service.view()).state, 'needs-signing');
  assert.equal((await (await stageIt({ platform: 'win32', windowsCertificateThumbprint: 'A'.repeat(40) })).service.view()).state, 'ready');
  assert.equal((await (await stageIt({ platform: 'darwin' })).service.view()).state, 'manual');
  assert.equal((await (await stageIt({ platform: 'linux', appImage: null })).service.view()).state, 'manual');
  // What main found at the last quit counts for that same version.
  const found = await stageIt({ platform: 'win32', windowsCertificateThumbprint: 'A'.repeat(40) });
  await writeFile(join(found.directory, 'last-install.json'), JSON.stringify({ version: '0.2.0', state: 'needs-signing' }));
  assert.equal((await found.service.view()).state, 'needs-signing');
  await writeFile(join(found.directory, 'last-install.json'), JSON.stringify({ version: '0.2.0', state: 'data-newer' }));
  assert.equal((await found.service.view()).state, 'data-newer');
  // The next start runs the new version: the staged copy has done its work and goes.
  const done = await stageIt({ platform: 'linux' });
  const after = new UpdateService({ publicKey, feedUrl: 'https://downloads.example.com/feed.json', directory: done.directory, version: '0.2.0', channel: 'beta', windowsCertificateThumbprint: null, clock: () => 0, isBusy: () => false, platform: 'linux', appImage: '/owned/Chausar.AppImage' });
  assert.equal((await after.view()).state, 'idle');
  assert.deepEqual((await readdir(join(done.directory, 'stage'))).filter(name => name.includes('release')), []);
});

test('the feed and the release may redirect only to the release hosts, and the feed read is bounded', async () => {
  const hops: string[] = [];
  const fetcher = async (url: string, init: any) => {
    hops.push(url);
    assert.equal(init.redirect, 'manual');
    if (url === 'https://github.com/o/r/releases/latest/download/feed.json') return new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/feed' } });
    if (url === 'https://github.com/o/r/releases/latest/download/feed.json.sig') return new Response('sig-text', { status: 200 });
    if (url === 'https://release-assets.githubusercontent.com/feed') return new Response('feed-text', { status: 200 });
    if (url === 'https://github.com/o/r/bad') return new Response(null, { status: 302, headers: { location: 'https://evil.example.org/x' } });
    if (url === 'https://github.com/o/r/http') return new Response(null, { status: 302, headers: { location: 'http://github.com/x' } });
    if (url === 'https://github.com/o/r/big') return new Response('x'.repeat(1024 * 1024 + 1), { status: 200 });
    if (url === 'https://github.com/o/r/loop') return new Response(null, { status: 302, headers: { location: 'https://github.com/o/r/loop' } });
    return new Response(Buffer.from('bytes'), { status: 206, headers: { 'content-range': 'bytes 3-7/8' } });
  };
  assert.deepEqual(await readFeedFrom('https://github.com/o/r/releases/latest/download/feed.json', fetcher as never), { text: 'feed-text', signature: 'sig-text' });
  await assert.rejects(readFeedFrom('https://github.com/o/r/bad', fetcher as never), (error: any) => error.code === 'UPDATE_REDIRECT_REFUSED');
  await assert.rejects(readFeedFrom('https://github.com/o/r/http', fetcher as never), (error: any) => error.code === 'UPDATE_REDIRECT_REFUSED');
  await assert.rejects(readFeedFrom('https://github.com/o/r/big', fetcher as never), (error: any) => error.code === 'UPDATE_FEED_TOO_BIG');
  await assert.rejects(readFeedFrom('https://github.com/o/r/loop', fetcher as never), (error: any) => error.code === 'UPDATE_REDIRECT_REFUSED');
  const answer = await followingDownload({ url: 'https://github.com/o/r/file', headers: { Range: 'bytes=3-' }, idleTimeoutMs: 1000, redirect: 'error' }, fetcher as never);
  assert.equal(answer.status, 206);
  assert.equal(answer.headers!['content-range'], 'bytes 3-7/8');
  assert.equal(answer.url, undefined, 'the hop is the host\'s business; the signed hash decides');
  const chunks: Uint8Array[] = [];
  for await (const chunk of answer.body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'bytes');
  assert.ok(hops.includes('https://github.com/o/r/file'));
});

test('the worker reads its update settings from what main hands it', () => {
  assert.equal(updatesOptionsFrom({}), undefined, 'no folder, no service: older hosts stay as they were');
  const options = updatesOptionsFrom({ CHAUSAR_UPDATES_DIRECTORY: '/owned/updates', CHAUSAR_UPDATE_PUBLIC_KEY: 'key', CHAUSAR_UPDATE_FEED: 'https://github.com/x', CHAUSAR_UPDATE_CHANNEL: 'beta', CHAUSAR_WINDOWS_CERTIFICATE_THUMBPRINT: 'A'.repeat(40), APPIMAGE: '/owned/a.AppImage' });
  assert.deepEqual(options, { directory: '/owned/updates', publicKey: 'key', feedUrl: 'https://github.com/x', channel: 'beta', windowsCertificateThumbprint: 'A'.repeat(40), appImage: '/owned/a.AppImage' });
  assert.deepEqual(updatesOptionsFrom({ CHAUSAR_UPDATES_DIRECTORY: '/owned/updates', CHAUSAR_UPDATE_PUBLIC_KEY: '', CHAUSAR_UPDATE_CHANNEL: 'other' }), { directory: '/owned/updates', publicKey: null, feedUrl: null, channel: 'stable', windowsCertificateThumbprint: null, appImage: null });
});

// The engine answers these three before the vault check, beside workspace.custody.get.
test('the engine answers updates.status, updates.settings and updates.check with no business open', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-update-engine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_000_000;
  const reads: string[] = [];
  const engine = new Engine({ version: '0.1.0', directory, demo: true, storage: 'experimental-file', updates: { publicKey, feedUrl: 'https://downloads.example.com/feed.json', directory: join(directory, 'updates'), channel: 'beta', windowsCertificateThumbprint: null, platform: 'linux', appImage: '/owned/a.AppImage', clock: () => now, readFeed: async url => { reads.push(url); return feedOf('0.1.0'); } } });
  t.after(() => engine.shutdown());
  const status = await engine.request('updates.status', {});
  assert.deepEqual([status.state, status.version, status.channel, status.daily, status.configured], ['idle', '0.1.0', 'beta', true, true]);
  assert.equal((await engine.request('updates.settings', { daily: false })).daily, false);
  assert.equal((await engine.request('updates.settings', { daily: true })).daily, true);
  await engine.tick();
  assert.deepEqual(reads, [], 'not in the first ten minutes');
  now += 10 * MINUTE;
  await engine.tick();
  await new Promise(accept => setImmediate(accept));
  for (let wait = 0; wait < 50 && reads.length === 0; wait += 1) await new Promise(accept => setTimeout(accept, 5));
  assert.equal(reads.length, 1, 'the tick checks after ten minutes');
  const checked = await engine.request('updates.check', {});
  assert.ok(['checking', 'up-to-date'].includes(checked.state));
  await assert.rejects(engine.request('updates.settings', { daily: 'x' }), (error: any) => error.code === 'INVALID_UPDATE_SETTINGS');
  const unset = new Engine({ version: '0.1.0', directory: join(directory, 'other'), demo: true, storage: 'experimental-file' });
  t.after(() => unset.shutdown());
  await mkdir(join(directory, 'other'), { recursive: true });
  assert.equal((await unset.request('updates.status', {})).state, 'not-set-up');
  for (let wait = 0; wait < 200 && ['checking', 'downloading'].includes((await engine.request('updates.status', {})).state); wait += 1) await new Promise(accept => setTimeout(accept, 5));
});

// C5 task 32: at quit, main's own route: the engine says if a run is busy, and makes the safety copy while the vault is open.
test('prepareUpdateInstall: no business is none-open; an open one gets a safety copy; a busy run or no ask makes none', async t => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-update-prepare-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = new Engine({ version: '0.1.0', directory, demo: true, storage: 'experimental-file', workspaceCustody: { deviceKeys: 'none', autoBackups: false } });
  t.after(() => engine.shutdown());
  assert.deepEqual(await engine.prepareUpdateInstall({ backup: true }), { busy: false, openDataSchema: null, backup: 'none-open' });
  await engine.request('workspace.create', { name: 'SYNTHETIC update business', folder: 'fixture', passphrase: 'SYNTHETIC disposable update passphrase', demo: false, pack: 'ecommerce' });
  assert.deepEqual(await engine.prepareUpdateInstall({}), { busy: false, openDataSchema: 2, backup: 'skipped' });
  assert.deepEqual(await engine.prepareUpdateInstall({ backup: true }), { busy: false, openDataSchema: 2, backup: 'made' });
  const backups = await engine.request('workspace.backups.list', {});
  assert.equal(backups.backups.filter((backup: { kind: string }) => backup.kind === 'safety').length, 1);
  await engine.request('workspace.lock', {});
});

test('on the local server, only the owner on this computer changes how it updates; a paired phone may read', async () => {
  const { BOOTSTRAP_ONLY_METHODS } = await import('../runtime/server.ts');
  assert.ok(BOOTSTRAP_ONLY_METHODS.includes('updates.settings'));
  assert.ok(BOOTSTRAP_ONLY_METHODS.includes('updates.check'));
  assert.ok(!BOOTSTRAP_ONLY_METHODS.includes('updates.status'));
});
