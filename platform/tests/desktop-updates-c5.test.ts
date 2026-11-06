// C5 task 32 (the module half): app/desktop/updates.cjs installs a verified, staged update when the owner quits, and
// keeps the boot marker that D12's automatic rollback reads. Linux swaps the AppImage by rename; Windows runs the staged
// NSIS installer only when its Authenticode signature is valid and from the pinned publisher (stubbed here: nothing is
// run, nothing is signed, nothing is downloaded); with no certificate yet the state is needs-signing. Keys are made here.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { constants as fsConstants } from 'node:fs';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fsp, { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
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
  assert.equal(runs.length, 1); assert.deepEqual(runs[0][1], ['/S', '--updated']);
  assert.notEqual(runs[0][0], release.artifactPath, 'a private copy runs, never the staged path');
  assert.match(runs[0][0], /\.exe$/);
  assert.deepEqual(await readFile(runs[0][0]), NEW);
  assert.deepEqual(await readFile(join(root, 'updates', 'installed', 'installer')), NEW);
});

// Fix round 1 (review MEDIUM-3): the file that runs is a private copy made after the safety backup, hashed against the
// signed manifest and signature-checked itself, right before it runs. A staged file changed during the backup never runs.
test('Windows: a staged file rewritten during the backup is not run, and the signature is read again on the copy that runs', async t => {
  const root = await folder(t), release = await staged(root, 'win32'), runs: string[] = [], read: string[] = [];
  const spawnInstaller = (path: string) => { runs.push(path); };
  const signatureOf = async (path: string) => { read.push(path); return { status: 'Valid', publisher: 'Chausar Technologies' }; };
  const swapped = await updates.installOnQuit({ staged: release, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf, spawnInstaller, isBusy: neverBusy, updatesFolder: join(root, 'updates'),
    beforeInstall: async () => { await writeFile(release.artifactPath, 'a different program put here during the backup'); } });
  assert.equal(swapped.state, 'not-verified');
  assert.equal(runs.length, 0);
  await assert.rejects(readFile(join(root, 'updates', 'installed', 'installer')), 'nothing unverified is kept as the installed release');
  assert.deepEqual((await readdir(join(root, 'stage'))).filter(name => name.endsWith('.exe')), [], 'no private copy is left behind');
  const again = await staged(join(root, 'again'), 'win32');
  let calls = 0;
  const lateUnsigned = async (path: string) => { read.push(path); return ++calls === 1 ? { status: 'Valid', publisher: 'Chausar Technologies' } : { status: 'NotSigned', publisher: null }; };
  const late = await updates.installOnQuit({ staged: again, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf: lateUnsigned, spawnInstaller, isBusy: neverBusy });
  assert.equal(late.state, 'needs-signing'); assert.equal(runs.length, 0);
  const ok = await staged(join(root, 'ok'), 'win32');
  read.length = 0;
  assert.equal((await updates.installOnQuit({ staged: ok, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf, spawnInstaller, isBusy: neverBusy })).state, 'installer-started');
  assert.equal(read.at(-1), runs.at(-1), 'the last signature read is of the exact file that runs');
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
  await updates.clearBoot(folderPath);
  const lines = (await readFile(join(folderPath, 'updates.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(lines.filter(line => line.code === 'LOCAL_FILE_NEWER' && line.step === 'boot').length, 1);
  await writeFile(file, '{broken');
  assert.equal((await updates.startBoot(folderPath, '0.2.0')).attempts, 1);
  const noted: any[] = [];
  const words = await updates.onFailedBoot({ version: '0.2.0', previous: '0.1.0' }, { note: (line: any) => noted.push(line) });
  assert.equal(words, 'This version didn\'t start. Install the previous one:');
  assert.deepEqual(noted.map(line => [line.op, line.version, line.previous]), [['failed-boot', '0.2.0', '0.1.0']]);
});

// Fix round 2 (review 2, MEDIUM-1): with the updates folder set, as in the real call, keeping the release copies the whole
// installer. A copy rewritten while it is being kept must not run: the hash and the signature of the file that runs are
// the very last steps before it starts. The rewrite is done by a stand-in copyFile; nothing is run.
test('Windows: a private copy rewritten while the release is kept is not run, and nothing is kept as installed', async t => {
  const root = await folder(t), release = await staged(root, 'win32'), runs: string[] = [];
  const original = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (from: string, to: string, mode?: number) => {
    await original(from, to, mode);
    if (/[\\/]\.installed-[0-9a-f]+[\\/]installer$/.test(to)) await writeFile(from, 'EVIL: bytes put in place while the release was kept');
  });
  const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf: async () => ({ status: 'Valid', publisher: 'Chausar Technologies' }), spawnInstaller: (path: string) => { runs.push(path); }, isBusy: neverBusy, updatesFolder: join(root, 'updates') });
  assert.equal(result.state, 'not-verified');
  assert.deepEqual(runs, []);
  await assert.rejects(readFile(join(root, 'updates', 'installed', 'installer')), 'nothing unverified is kept as the installed release');
  assert.deepEqual((await readdir(join(root, 'updates'))).filter(name => name.startsWith('.installed-')), [], 'no half-kept folder is left');
});

// Fix round 2 (review 2, LOW-3): the late publisher check on the copy, and the copy never written over an existing file.
test('Windows: a copy whose late signature names another publisher does not run, and is removed', async t => {
  const root = await folder(t), release = await staged(root, 'win32'), runs: string[] = [];
  let reads = 0;
  const signatureOf = async () => ++reads === 1 ? { status: 'Valid', publisher: 'Chausar Technologies' } : { status: 'Valid', publisher: 'Someone Else' };
  const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf, spawnInstaller: (path: string) => { runs.push(path); }, isBusy: neverBusy, updatesFolder: join(root, 'updates') });
  assert.equal(result.state, 'publisher-mismatch'); assert.equal(reads, 2); assert.deepEqual(runs, []);
  assert.deepEqual((await readdir(join(root, 'stage'))).filter(name => name.startsWith('chausar-update-')), []);
  assert.deepEqual((await readdir(join(root, 'updates'))).filter(name => name.startsWith('.installed-') || name === 'installed'), []);
});

test('Windows: the private copy is made with an exclusive create, so it never writes over a file already there', async t => {
  const root = await folder(t), release = await staged(root, 'win32'), modes: Array<number | undefined> = [];
  const original = fsp.copyFile;
  t.mock.method(fsp, 'copyFile', async (from: string, to: string, mode?: number) => {
    if (/chausar-update-[0-9a-f]+\.exe$/.test(to)) modes.push(mode);
    return original(from, to, mode);
  });
  const result = await updates.installOnQuit({ staged: release, publicKey, platform: 'win32', windowsPublisher: 'Chausar Technologies', signatureOf: async () => ({ status: 'Valid', publisher: 'Chausar Technologies' }), spawnInstaller: () => {}, isBusy: neverBusy });
  assert.equal(result.state, 'installer-started');
  assert.deepEqual(modes, [fsConstants.COPYFILE_EXCL]);
  const taken = join(root, 'taken.exe');
  await writeFile(taken, 'already here');
  await assert.rejects(original(release.artifactPath, taken, fsConstants.COPYFILE_EXCL), (error: any) => error.code === 'EEXIST');
  assert.equal(await readFile(taken, 'utf8'), 'already here');
});
