// C5 task 32, the wiring: main's side of install on quit. Real folders under the temp folder; stand-ins for the dialog, the
// file manager and the engine, so nothing shows on screen and nothing runs. app/desktop/updates.cjs itself is lane two's,
// with its own tests; here is what calls it.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseManifest, type ReleaseManifest } from '../runtime/updater.ts';

const require = createRequire(import.meta.url);
const { createUpdateWiring, updateEnvironment, updateMetadata } = require('../../app/desktop/update-wiring.cjs');
const realUpdates = require('../../app/desktop/updates.cjs');
const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const FILE = Buffer.from('the new release, a stand-in that is never run');

function manifestFor(platform: string, bytes = FILE): ReleaseManifest {
  return { schemaVersion: 1, version: '0.2.0', publishedAt: '2026-11-01T00:00:00.000Z', platform: platform as ReleaseManifest['platform'], architecture: 'x64', url: 'https://downloads.example.com/chausar.bin', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, minEngineVersion: '0.0.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
}
const signatureOf = (manifest: ReleaseManifest) => sign(null, Buffer.from(canonicalReleaseManifest(manifest)), keys.privateKey).toString('base64url');

async function setup(t: TestContext, options: { platform?: string; publisher?: string | null; appImage?: string | null; updates?: any; staged?: boolean; prepare?: any; metadata?: any } = {}) {
  const userData = await mkdtemp(join(await realpath(tmpdir()), 'chausar-wiring-c5-'));
  t.after(() => rm(userData, { recursive: true, force: true }));
  const folder = join(userData, 'updates'), stage = join(folder, 'stage'), platform = options.platform ?? 'win32';
  await mkdir(stage, { recursive: true });
  const manifest = manifestFor(platform), artifactPath = join(stage, 'release-0.2.0-abc.artifact');
  if (options.staged !== false) {
    await writeFile(artifactPath, FILE);
    await writeFile(join(stage, 'pending-release.json'), JSON.stringify({ manifest, signature: signatureOf(manifest), artifactPath, installed: false }));
  }
  const log: unknown[] = [], shown: string[] = [], boxes: any[] = [], lines: any[] = [];
  const installs: any[] = [];
  const updates = options.updates ?? { ...realUpdates, installOnQuit: async (input: any) => { installs.push(input); return { state: 'installed', version: '0.2.0' }; } };
  const engine = { state: 'ready', prepareUpdateInstall: async (input: unknown) => { log.push(['prepare', input]); return options.prepare ?? { busy: false, openDataSchema: 1, backup: 'made' }; } };
  const wiring = createUpdateWiring({
    metadata: options.metadata ?? { chausarUpdatePublicKey: publicKey, chausarUpdateFeed: 'https://downloads.example.com/feed.json', chausarWindowsPublisher: options.publisher === undefined ? 'Chausar' : options.publisher ?? '' },
    userData, packaged: true, version: '0.1.0', platform, appImage: options.appImage ?? null, updates, engine: () => engine,
    dialog: { showMessageBox: async (settings: any) => { boxes.push(settings); return { response: 0 }; } }, shell: { showItemInFolder: (path: string) => { shown.push(path); } },
    note: (line: unknown) => { lines.push(line); },
  });
  return { wiring, folder, stage, manifest, artifactPath, log, installs, shown, boxes, lines, engine };
}

test('no key in the build: nothing here touches the disk, and the worker hears empty values and the folder', async t => {
  assert.equal(updateMetadata({}, { packaged: true }), null);
  assert.equal(updateMetadata({ chausarUpdatePublicKey: '  ' }, { packaged: true }), null);
  assert.equal(updateMetadata({ chausarUpdatePublicKey: publicKey }, { packaged: false }), null, 'a development run');
  assert.equal(updateMetadata({ chausarUpdatePublicKey: publicKey, chausarPreview: true }, { packaged: true }), null, 'a preview');
  assert.deepEqual(updateEnvironment({ chausarReleaseChannel: 'beta' }, { userData: '/owned', packaged: true }), { CHAUSAR_UPDATES_DIRECTORY: join('/owned', 'updates'), CHAUSAR_UPDATE_CHANNEL: 'beta', CHAUSAR_UPDATE_PUBLIC_KEY: '', CHAUSAR_UPDATE_FEED: '', CHAUSAR_WINDOWS_PUBLISHER: '' });
  assert.deepEqual(updateEnvironment({ chausarUpdatePublicKey: publicKey, chausarUpdateFeed: 'https://x.example/f', chausarWindowsPublisher: 'Chausar' }, { userData: '/owned', packaged: true }), { CHAUSAR_UPDATES_DIRECTORY: join('/owned', 'updates'), CHAUSAR_UPDATE_CHANNEL: 'stable', CHAUSAR_UPDATE_PUBLIC_KEY: publicKey, CHAUSAR_UPDATE_FEED: 'https://x.example/f', CHAUSAR_WINDOWS_PUBLISHER: 'Chausar' });
  const { wiring, folder, log } = await setup(t, { metadata: {} });
  assert.equal(wiring.enabled, false);
  await wiring.beforeStart();
  assert.equal(await wiring.prepareQuit(), null);
  assert.deepEqual(log, []);
  assert.deepEqual((await readdir(folder)).sort(), ['stage'], 'no boot marker');
  await assert.rejects(wiring.showInstaller('staged'), (error: any) => error.code === 'UPDATES_NOT_SET_UP');
});

test('at the start: the boot marker is written, old private copies go, and ready plus first paint clear the marker', async t => {
  const { wiring, folder, stage } = await setup(t);
  await writeFile(join(stage, 'chausar-update-0123456789abcdef.exe'), 'old');
  await writeFile(join(stage, 'keep-this.exe'), 'not ours');
  await wiring.beforeStart();
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'boot.json'), 'utf8')).attempts, 1);
  const names = await readdir(stage);
  assert.equal(names.includes('chausar-update-0123456789abcdef.exe'), false);
  assert.equal(names.includes('keep-this.exe'), true);
  await wiring.noteReady();
  assert.ok((await readdir(folder)).includes('boot.json'), 'ready alone is not enough');
  await wiring.notePaint();
  await wiring.settled();
  assert.equal((await readdir(folder)).includes('boot.json'), false);
});

// The updater wiring (LANE2-C review 2 and fix round 3): an installer copy still in use stays; a kept release is never trusted
// as it lies on disk.
test('at the start: an old copy still in use stays until a later start, and the start goes on', async t => {
  const { folder, stage } = await setup(t);
  await writeFile(join(stage, 'chausar-update-00000000000000aa.exe'), 'running');
  await writeFile(join(stage, 'chausar-update-00000000000000bb.exe'), 'finished');
  const fsp = require('node:fs/promises');
  const wiring = createUpdateWiring({
    metadata: { chausarUpdatePublicKey: publicKey }, userData: join(folder, '..'), packaged: true, version: '0.1.0', platform: 'win32', appImage: null, updates: realUpdates, engine: () => null, dialog: {}, shell: {},
    fs: { ...fsp, unlink: async (path: string) => { if (path.endsWith('aa.exe')) throw Object.assign(new Error('in use'), { code: 'EBUSY' }); return fsp.unlink(path); } },
  });
  await wiring.beforeStart();
  const names = await readdir(stage);
  assert.equal(names.includes('chausar-update-00000000000000aa.exe'), true, 'the one running stays');
  assert.equal(names.includes('chausar-update-00000000000000bb.exe'), false);
  assert.equal(JSON.parse(await readFile(join(folder, 'boot.json'), 'utf8')).attempts, 1, 'the start went on');
});

test('a kept release that no longer checks out is never offered or shown: a changed byte, or a changed signature', async t => {
  const old = manifestFor('win32', Buffer.from('the release before'));
  for (const spoil of ['installer', 'signature'] as const) {
    const { wiring, boxes, shown, folder, lines } = await setup(t);
    const previous = join(folder, 'previous');
    await mkdir(previous, { recursive: true });
    await writeFile(join(previous, 'manifest.json'), JSON.stringify(old));
    await writeFile(join(previous, 'signature'), spoil === 'signature' ? `${'A'.repeat(86)}\n` : `${signatureOf(old)}\n`);
    await writeFile(join(previous, 'installer'), spoil === 'installer' ? 'the release befor!' : 'the release before');
    for (let count = 0; count < 3; count += 1) await wiring.beforeStart();
    await wiring.settled();
    assert.deepEqual(shown, [], spoil);
    assert.equal(boxes[0].message, "This version didn't start.", spoil);
    assert.deepEqual(boxes[0].buttons, ['OK'], spoil);
    assert.equal(lines.some(line => line.op === 'failed-boot' && line.previous === null), true, spoil);
    await assert.rejects(wiring.showInstaller('previous'), (error: any) => error.code === 'UPDATE_NOT_VERIFIED', spoil);
  }
});

test('nothing else in the desktop app reads the kept releases', async () => {
  const { readdir: list, readFile: read } = await import('node:fs/promises');
  const folder = new URL('../../app/desktop/', import.meta.url);
  for (const name of (await list(folder)).filter(file => file.endsWith('.cjs'))) {
    if (['updates.cjs', 'update-wiring.cjs', 'rollback.cjs'].includes(name)) continue;
    const text = await read(new URL(name, folder), 'utf8');
    assert.ok(!text.includes("'previous'") && !text.includes("'installed'"), name);
  }
});

test('a start that never reached paint counts; the third calls the hook once with the plain words', async t => {
  const { wiring, boxes, lines, shown, folder } = await setup(t);
  await wiring.beforeStart(); await wiring.beforeStart(); await wiring.beforeStart();
  await wiring.settled();
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].message, "This version didn't start.");
  assert.deepEqual(boxes[0].buttons, ['OK'], 'no previous release is kept, so no button promises one');
  assert.deepEqual(shown, []);
  assert.equal(lines.some(line => line.op === 'failed-boot' && line.version === '0.1.0'), true);
  await wiring.beforeStart();
  await wiring.settled();
  assert.equal(boxes.length, 1, 'once');
  assert.equal(JSON.parse(await readFile(join(folder, 'boot.json'), 'utf8')).attempts, 4);
});

test('at the failed start, with a kept previous release, Show installer checks it again and shows a named copy', async t => {
  const { wiring, boxes, shown, folder } = await setup(t);
  const old = manifestFor('win32', Buffer.from('the release before'));
  const previous = join(folder, 'previous');
  await mkdir(previous, { recursive: true });
  await writeFile(join(previous, 'manifest.json'), JSON.stringify(old));
  await writeFile(join(previous, 'signature'), `${signatureOf(old)}\n`);
  await writeFile(join(previous, 'installer'), 'the release before');
  for (let count = 0; count < 3; count += 1) await wiring.beforeStart();
  await wiring.settled();
  assert.equal(boxes[0].message, "This version didn't start. Install the previous one:");
  assert.deepEqual(boxes[0].buttons, ['Show installer', 'Not now']);
  assert.equal(shown.length, 1);
  assert.match(shown[0]!, /Chausar-0\.2\.0-setup\.exe$/);
  assert.equal(await readFile(shown[0]!, 'utf8'), 'the release before');
});

test('Show installer re-hashes and re-checks the signature right before use: a changed file is refused and nothing shows', async t => {
  const { wiring, shown, artifactPath, stage, folder, manifest } = await setup(t);
  const path = await wiring.showInstaller('staged');
  assert.deepEqual(shown, [path]);
  assert.match(path, /Chausar-0\.2\.0-setup\.exe$/);
  assert.equal(await readFile(path, 'utf8'), FILE.toString());
  await writeFile(artifactPath, 'changed on disk, the same length as the old file.'.padEnd(FILE.length).slice(0, FILE.length));
  await assert.rejects(wiring.showInstaller('staged'), (error: any) => error.code === 'UPDATE_NOT_VERIFIED');
  assert.equal(shown.length, 1);
  await assert.rejects(wiring.showInstaller('previous'), (error: any) => error.code === 'UPDATE_NOT_VERIFIED', 'none kept');
  // A signature by another key is refused too.
  const other = generateKeyPairSync('ed25519');
  await writeFile(artifactPath, FILE);
  await writeFile(join(stage, 'pending-release.json'), JSON.stringify({ manifest, signature: sign(null, Buffer.from(canonicalReleaseManifest(manifest)), other.privateKey).toString('base64url'), artifactPath }));
  await assert.rejects(wiring.showInstaller('staged'), (error: any) => error.code === 'UPDATE_NOT_VERIFIED');
  assert.equal(shown.length, 1);
  assert.ok((await readdir(folder)).includes('show'));
  for (const bad of ['installed', '../x', null]) await assert.rejects(wiring.showInstaller(bad), (error: any) => error.code === 'INVALID_REQUEST', String(bad));
});

test('quit: the engine makes the safety copy before it stops, and a failed copy stops the install through beforeInstall', async t => {
  const { wiring, installs, log, folder, artifactPath, manifest } = await setup(t);
  const prepared = await wiring.prepareQuit();
  assert.deepEqual(log, [['prepare', { backup: true }]]);
  assert.deepEqual(await wiring.installAfterStop(prepared), { state: 'installed', version: '0.2.0' });
  const input = installs[0];
  assert.equal(input.staged.artifactPath, artifactPath);
  assert.equal(input.staged.manifest.version, manifest.version);
  assert.equal(input.publicKey, publicKey);
  assert.equal(input.windowsPublisher, 'Chausar');
  assert.equal(input.openDataSchema, 1);
  assert.equal(input.updatesFolder, folder);
  assert.equal(input.platform, 'win32');
  assert.equal(await input.isBusy(), false);
  await input.beforeInstall();
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'last-install.json'), 'utf8')), { version: '0.2.0', state: 'installed' });

  for (const [backup, stops] of [['failed', true], ['none-open', false]] as const) {
    const again = await setup(t, { prepare: { busy: false, openDataSchema: null, backup } });
    await again.wiring.installAfterStop(await again.wiring.prepareQuit());
    const hook = again.installs[0].beforeInstall();
    if (stops) await assert.rejects(hook, (error: any) => error.code === 'SAFETY_BACKUP_FAILED'); else await hook;
  }
  const busy = await setup(t, { prepare: { busy: true, openDataSchema: 1, backup: 'skipped' } });
  await busy.wiring.installAfterStop(await busy.wiring.prepareQuit());
  assert.equal(await busy.installs[0].isBusy(), true);
});

test('quit asks for no copy and hashes nothing where nothing could install: nothing staged, Windows with no publisher, a Mac, a Linux run that is no AppImage', async t => {
  for (const options of [{ staged: false }, { publisher: null }, { platform: 'darwin' }, { platform: 'linux', appImage: null }]) {
    const { wiring, log, installs, folder } = await setup(t, options as any);
    const prepared = await wiring.prepareQuit();
    assert.equal(prepared, null, JSON.stringify(options));
    assert.deepEqual(await wiring.installAfterStop(prepared), null);
    assert.deepEqual([log, installs], [[], []]);
    assert.equal((await readdir(folder)).includes('last-install.json'), false);
  }
  const linux = await setup(t, { platform: 'linux', appImage: '/owned/Chausar.AppImage' });
  const prepared = await linux.wiring.prepareQuit();
  await linux.wiring.installAfterStop(prepared);
  assert.equal(linux.installs[0].appImage, '/owned/Chausar.AppImage');
});

test('an engine that cannot answer at quit installs nothing', async t => {
  const { wiring, engine, installs } = await setup(t);
  engine.state = 'failed';
  const prepared = await wiring.prepareQuit();
  assert.equal(prepared, null);
  engine.state = 'ready';
  engine.prepareUpdateInstall = async () => { throw new Error('gone'); };
  assert.equal(await wiring.prepareQuit(), null);
  assert.deepEqual(installs, []);
});

test('what main found at the last quit is kept for the row, and the running version clears nothing it should not', async t => {
  const updates = { ...realUpdates, installOnQuit: async () => ({ state: 'needs-signing', version: '0.2.0' }) };
  const { wiring, folder } = await setup(t, { updates });
  await wiring.installAfterStop(await wiring.prepareQuit());
  assert.deepEqual(JSON.parse(await readFile(join(folder, 'last-install.json'), 'utf8')), { version: '0.2.0', state: 'needs-signing' });
});

test('updates.jsonl goes through diagnostics.cjs: names only, and it rotates like the others', async t => {
  const { folder, manifest, artifactPath } = await setup(t, { platform: 'darwin' });
  const answer = await realUpdates.installOnQuit({ staged: { manifest, signature: signatureOf(manifest), artifactPath }, publicKey, platform: 'darwin', updatesFolder: folder, isBusy: async () => false });
  assert.equal(answer.state, 'manual');
  const [line] = (await readFile(join(folder, 'updates.jsonl'), 'utf8')).trim().split('\n').map(text => JSON.parse(text));
  assert.deepEqual({ op: line.op, state: line.state, version: line.version }, { op: 'install-on-quit', state: 'manual', version: '0.2.0' });
  const source = await readFile(new URL('../../app/desktop/updates.cjs', import.meta.url), 'utf8');
  assert.match(source, /require\('\.\/diagnostics\.cjs'\)/);
  assert.equal(source.includes('appendFile'), false);
});
