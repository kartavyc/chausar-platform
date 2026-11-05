// C5 task 32 (the module half): app/desktop/updates.cjs installs a verified, staged update when the owner quits, and
// keeps the boot marker that D12's automatic rollback reads. Linux swaps the AppImage by rename; Windows runs the staged
// NSIS installer only when its Authenticode signature is valid and from the pinned publisher (stubbed here: nothing is
// run, nothing is signed, nothing is downloaded); with no certificate yet the state is needs-signing. Keys are made here.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalReleaseManifest, type ReleaseManifest } from '../runtime/updater.ts';

const require = createRequire(import.meta.url);
const updates = require('../../app/desktop/updates.cjs');
const keys = generateKeyPairSync('ed25519'), publicKey = keys.publicKey.export({ format: 'pem', type: 'spki' }).toString();
const NEW = Buffer.from('the new release; a stand-in that is never run');

async function folder(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-updates-c5-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
function manifestFor(platform: ReleaseManifest['platform'], bytes = NEW, extra: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return { schemaVersion: 1, version: '0.2.0', publishedAt: '2026-11-01T00:00:00.000Z', platform, architecture: 'x64', url: 'https://downloads.example.com/chausar.bin', sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, minEngineVersion: '0.0.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true }, ...extra };
}
async function staged(root: string, platform: ReleaseManifest['platform'], options: { bytes?: Buffer; manifest?: ReleaseManifest; key?: any } = {}) {
  const artifactPath = join(root, 'stage', 'release-0.2.0.artifact'), manifest = options.manifest ?? manifestFor(platform);
  await mkdir(join(root, 'stage'), { recursive: true });
  await writeFile(artifactPath, options.bytes ?? NEW);
  return { manifest, signature: sign(null, Buffer.from(canonicalReleaseManifest(manifest)), options.key ?? keys.privateKey).toString('base64url'), artifactPath };
}
async function appImage(root: string) {
  const path = join(root, 'apps', 'Chausar.AppImage');
  await mkdir(join(root, 'apps'), { recursive: true });
  await writeFile(path, 'the old AppImage');
  await chmod(path, 0o755);
  return path;
}
const neverBusy = () => false;

test('Linux: the AppImage is replaced by the verified file by rename, keeping its mode, and the release is kept', async t => {
  const root = await folder(t), app = await appImage(root), before = (await stat(app)).mode, release = await staged(root, 'linux');
  const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'linux', appImage: app, isBusy: neverBusy, updatesFolder: join(root, 'updates') });
  assert.equal(result.state, 'installed');
  assert.deepEqual(await readFile(app), NEW);
  assert.equal((await stat(app)).mode, before);
  assert.deepEqual(await readdir(join(root, 'apps')), ['Chausar.AppImage']);
  assert.equal(JSON.parse(await readFile(join(root, 'updates', 'installed', 'manifest.json'), 'utf8')).version, '0.2.0');
});

test('Linux: a failed rename leaves the old AppImage whole and no temporary file behind', async t => {
  const root = await folder(t), app = await appImage(root), release = await staged(root, 'linux');
  const fs = { rename: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
  const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'linux', appImage: app, isBusy: neverBusy, fs });
  assert.equal(result.state, 'failed');
  assert.equal(await readFile(app, 'utf8'), 'the old AppImage');
  assert.deepEqual(await readdir(join(root, 'apps')), ['Chausar.AppImage']);
});

test('nothing is used unless it is verified: a changed byte, another key or another platform', async t => {
  const root = await folder(t), app = await appImage(root), stranger = generateKeyPairSync('ed25519');
  const cases = [
    await staged(join(root, 'a'), 'linux', { bytes: Buffer.from('the new release; a stand-in that is never ruN') }),
    await staged(join(root, 'b'), 'linux', { key: stranger.privateKey }),
    await staged(join(root, 'c'), 'win32'),
  ];
  for (const release of cases) {
    const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'linux', appImage: app, isBusy: neverBusy });
    assert.equal(result.state, 'not-verified');
    assert.equal(await readFile(app, 'utf8'), 'the old AppImage');
  }
});

test('Windows: unsigned or no certificate gives needs-signing, the wrong publisher refuses, the pinned one runs /S --updated', async t => {
  const root = await folder(t), release = await staged(root, 'win32'), runs: Array<[string, string[]]> = [];
  const spawnInstaller = (path: string, args: string[]) => { runs.push([path, args]); };
  const at = (windowsPublisher: string | null, answer: { status: string; publisher: string | null }, updatesFolder?: string) =>
    updates.installOnQuit({ staged: release, publicKey, platform: 'win32', windowsPublisher, signatureOf: async () => answer, spawnInstaller, isBusy: neverBusy, updatesFolder });
  assert.equal((await at(null, { status: 'Valid', publisher: 'Chausar Technologies' })).state, 'needs-signing');
  assert.equal((await at('Chausar Technologies', { status: 'NotSigned', publisher: null })).state, 'needs-signing');
  assert.equal((await at('Chausar Technologies', { status: 'HashMismatch', publisher: 'Chausar Technologies' })).state, 'needs-signing');
  assert.equal((await at('Chausar Technologies', { status: 'Valid', publisher: 'Someone Else' })).state, 'publisher-mismatch');
  assert.equal(runs.length, 0);
  assert.equal((await at('Chausar Technologies', { status: 'Valid', publisher: 'Chausar Technologies' }, join(root, 'updates'))).state, 'installer-started');
  assert.deepEqual(runs, [[release.artifactPath, ['/S', '--updated']]]);
  assert.deepEqual(await readFile(join(root, 'updates', 'installed', 'installer')), NEW);
});

test('never during a busy run, never over newer data, and macOS stays manual', async t => {
  const root = await folder(t), runs: unknown[] = [], spawnInstaller = () => { runs.push(1); };
  const win = await staged(root, 'win32'), signatureOf = async () => ({ status: 'Valid', publisher: 'Chausar Technologies' });
  assert.equal((await updates.installOnQuit({ staged: win, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf, spawnInstaller, isBusy: () => true })).state, 'busy');
  assert.equal((await updates.installOnQuit({ staged: win, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf, spawnInstaller, isBusy: neverBusy, openDataSchema: 2 })).state, 'data-newer');
  assert.equal(runs.length, 0);
  const mac = await staged(join(root, 'mac'), 'darwin');
  assert.equal((await updates.installOnQuit({ staged: mac, publicKey, platform: 'darwin', isBusy: neverBusy })).state, 'manual');
  const linux = await staged(join(root, 'linux'), 'linux');
  assert.equal((await updates.installOnQuit({ staged: linux, publicKey, platform: 'linux', appImage: undefined, isBusy: neverBusy })).state, 'manual');
  assert.equal((await updates.installOnQuit({ staged: null, publicKey, platform: 'linux', isBusy: neverBusy })).state, 'nothing');
});

test('the install hands the staged release to the D12 hook first, and a refusal there installs nothing', async t => {
  const root = await folder(t), app = await appImage(root), release = await staged(root, 'linux'), seen: string[] = [];
  const refused = await updates.installOnQuit({ staged: release, publicKey, platform: 'linux', appImage: app, isBusy: neverBusy, beforeInstall: async (given: any) => { seen.push(given.manifest.version); throw new Error('no safety copy'); } });
  assert.equal(refused.state, 'failed'); assert.deepEqual(seen, ['0.2.0']);
  assert.equal(await readFile(app, 'utf8'), 'the old AppImage');
});

test('a second update keeps the one installed last time as the previous release', async t => {
  const root = await folder(t), app = await appImage(root), folderPath = join(root, 'updates');
  assert.equal((await updates.installOnQuit({ staged: await staged(join(root, 'one'), 'linux'), publicKey, platform: 'linux', appImage: app, isBusy: neverBusy, updatesFolder: folderPath })).state, 'installed');
  const next = Buffer.from('the release after that'), manifest = manifestFor('linux', next, { version: '0.3.0' });
  assert.equal((await updates.installOnQuit({ staged: await staged(join(root, 'two'), 'linux', { bytes: next, manifest }), publicKey, platform: 'linux', appImage: app, isBusy: neverBusy, updatesFolder: folderPath })).state, 'installed');
  assert.equal(JSON.parse(await readFile(join(folderPath, 'previous', 'manifest.json'), 'utf8')).version, '0.2.0');
  assert.deepEqual(await readFile(join(folderPath, 'previous', 'installer')), NEW);
  assert.equal(JSON.parse(await readFile(join(folderPath, 'installed', 'manifest.json'), 'utf8')).version, '0.3.0');
  assert.equal(await updates.previousVersion(folderPath), '0.2.0');
});

test('the boot marker counts starts of one version; the third start calls onFailedBoot once; a clear resets it', async t => {
  const folderPath = join(await folder(t), 'updates'), calls: unknown[] = [];
  const onFailedBoot = (input: unknown) => { calls.push(input); };
  assert.equal((await updates.startBoot(folderPath, '0.2.0', { onFailedBoot })).attempts, 1);
  assert.equal((await updates.startBoot(folderPath, '0.2.0', { onFailedBoot })).attempts, 2);
  assert.equal(calls.length, 0);
  assert.equal((await updates.startBoot(folderPath, '0.2.0', { onFailedBoot })).failed, true);
  assert.deepEqual(calls, [{ version: '0.2.0', previous: null }]);
  await updates.startBoot(folderPath, '0.2.0', { onFailedBoot });
  assert.equal(calls.length, 1, 'never reported twice for one version');
  await updates.clearBoot(folderPath);
  assert.equal((await updates.startBoot(folderPath, '0.2.0', { onFailedBoot })).attempts, 1);
  assert.equal((await updates.startBoot(folderPath, '0.3.0', { onFailedBoot })).attempts, 1, 'another version starts its own count');
});

test('a boot marker from a newer Chausar is left alone, a broken one is replaced, and the default hook only notes', async t => {
  const folderPath = join(await folder(t), 'updates'), file = join(folderPath, 'boot.json');
  await mkdir(folderPath, { recursive: true });
  const newer = JSON.stringify({ format: 'chausar.boot.v2', version: '0.9.0', attempts: 7 });
  await writeFile(file, newer);
  assert.equal((await updates.startBoot(folderPath, '0.2.0')).attempts, 0);
  assert.equal(await readFile(file, 'utf8'), newer);
  await writeFile(file, '{broken');
  assert.equal((await updates.startBoot(folderPath, '0.2.0')).attempts, 1);
  const noted: any[] = [];
  const words = await updates.onFailedBoot({ version: '0.2.0', previous: '0.1.0' }, { note: (line: any) => noted.push(line) });
  assert.equal(words, 'This version didn\'t start. Install the previous one:');
  assert.deepEqual(noted.map(line => [line.op, line.version, line.previous]), [['failed-boot', '0.2.0', '0.1.0']]);
});
