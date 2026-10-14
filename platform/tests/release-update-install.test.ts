import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, rm, realpath, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReleaseManifest } from '../runtime/updater.ts';
import { InstallLayout, artifactKind, type Unpack } from '../runtime/native/update-install.ts';

const code = (expected:string) => (error:any) => error.code === expected;
const hash = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function directory(t:any) { const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-install-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
/** An inert artifact file plus a manifest that describes it; nothing is ever executed. */
async function artifact(root:string, version:string, extension = 'AppImage') {
  const bytes = Buffer.from(`Inert Chausar ${version} fixture. Never execute this file.`), path = join(root, `staged-${version}.artifact`);
  await writeFile(path, bytes);
  const manifest:ReleaseManifest = { schemaVersion: 1, version, publishedAt: '2026-09-01T00:00:00.000Z', platform: process.platform as any, architecture: process.arch as any,
    url: `https://downloads.example.com/Chausar-${version}.${extension}`, sha256: hash(bytes), size: bytes.length, minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  return { path, manifest, bytes };
}
const pointer = async (root:string) => JSON.parse(await readFile(join(root, 'install', 'current.json'), 'utf8'));
async function installed(t:any, versions:string[]) {
  const root = await directory(t), layout = new InstallLayout({ installRoot: join(root, 'install') });
  for (const version of versions) { const a = await artifact(root, version); await layout.install(a.path, a.manifest); await layout.confirmHealthy(version); }
  return { root, layout };
}

test('install unpacks into versions/<version>, verifies the copy and starts a trial', async t => {
  const root = await directory(t), layout = new InstallLayout({ installRoot: join(root, 'install'), now: () => Date.parse('2026-10-14T00:00:00.000Z') });
  const a = await artifact(root, '1.0.0'), result = await layout.install(a.path, a.manifest);
  assert.equal(result.state, 'trial'); assert.equal(result.previous, null);
  assert.deepEqual(await readFile(join(result.directory, 'Chausar-1.0.0.AppImage')), a.bytes);
  assert.deepEqual(await pointer(root), { version: '1.0.0', previous: null, state: 'trial', attempts: 0, swappedAt: '2026-10-14T00:00:00.000Z' });
  assert.ok(!(await readdir(join(root, 'install'))).some(name => name.endsWith('.tmp') || name === 'install.lock'));
  await assert.rejects(layout.install(a.path, a.manifest), code('INSTALL_ALREADY_CURRENT'));
  const b = await artifact(root, '1.1.0');
  await assert.rejects(layout.install(b.path, b.manifest), code('INSTALL_TRIAL_PENDING'));
  await writeFile(b.path, 'changed after signing');
  await layout.confirmHealthy('1.0.0');
  await assert.rejects(layout.install(b.path, b.manifest), code('INSTALL_ARTIFACT_MISMATCH'));
});

test('NSIS, MSI and dmg installers refuse NATIVE_INSTALLER_REQUIRED before anything is unpacked', async t => {
  const root = await directory(t); let calls = 0;
  const layout = new InstallLayout({ installRoot: join(root, 'install'), unpack: async () => { calls++; } });
  for (const extension of ['exe', 'msi', 'dmg', 'pkg']) {
    const a = await artifact(root, '1.0.0', extension);
    await assert.rejects(layout.install(a.path, a.manifest), code('NATIVE_INSTALLER_REQUIRED'));
  }
  assert.equal(calls, 0);
  assert.throws(() => artifactKind('https://downloads.example.com/chausar.deb'), code('UNSUPPORTED_ARTIFACT'));
  assert.equal(artifactKind('https://downloads.example.com/chausar-1.0.0-linux-x64.tar.gz').kind, 'tar');
  assert.equal(artifactKind('https://downloads.example.com/chausar-1.0.0-win-x64.zip').kind, 'zip');
});

test('the pointer swap is atomic: a crash between the temporary write and the rename leaves the previous pointer intact', async t => {
  const { root } = await installed(t, ['1.0.0']), before = await readFile(join(root, 'install', 'current.json'), 'utf8');
  const crashing = new InstallLayout({ installRoot: join(root, 'install'), hooks: { pointer: { beforeRename: async temporary => {
    assert.equal(JSON.parse(await readFile(temporary, 'utf8')).version, '1.1.0'); // the new pointer is fully durable in the temporary file
    throw Object.assign(new Error('simulated power loss'), { code: 'SIMULATED_CRASH' });
  } } } });
  const b = await artifact(root, '1.1.0');
  await assert.rejects(crashing.install(b.path, b.manifest), code('SIMULATED_CRASH'));
  assert.equal(await readFile(join(root, 'install', 'current.json'), 'utf8'), before);
  const launch = await new InstallLayout({ installRoot: join(root, 'install') }).resolveLaunch();
  assert.equal(launch?.version, '1.0.0'); assert.equal(launch?.state, 'committed'); assert.equal(launch?.rolledBack, false);
});

test('a trial that is not confirmed within two launches is rolled back automatically on the third', async t => {
  const { root, layout } = await installed(t, ['1.0.0']), b = await artifact(root, '1.1.0');
  await layout.install(b.path, b.manifest);
  const first = await layout.resolveLaunch(), second = await layout.resolveLaunch();
  assert.deepEqual([first?.version, first?.attempts, first?.rolledBack], ['1.1.0', 1, false]);
  assert.deepEqual([second?.version, second?.attempts, second?.rolledBack], ['1.1.0', 2, false]);
  const third = await layout.resolveLaunch();
  assert.equal(third?.version, '1.0.0'); assert.equal(third?.rolledBack, true); assert.equal(third?.rolledBackFrom, '1.1.0'); assert.equal(third?.state, 'committed');
  assert.deepEqual({ ...(await pointer(root)), swappedAt: 'x' }, { version: '1.0.0', previous: null, state: 'committed', attempts: 0, swappedAt: 'x' });
  await assert.rejects(layout.rollback(), code('ROLLBACK_UNAVAILABLE'));
});

test('confirmHealthy commits the trial; only the installed version may confirm', async t => {
  const { root, layout } = await installed(t, ['1.0.0']), b = await artifact(root, '1.1.0');
  await layout.install(b.path, b.manifest); await layout.resolveLaunch();
  await assert.rejects(layout.confirmHealthy('1.0.0'), code('INSTALL_VERSION_MISMATCH'));
  const committed = await layout.confirmHealthy('1.1.0');
  assert.equal(committed.state, 'committed'); assert.equal(committed.attempts, 0); assert.equal(committed.previous, '1.0.0');
  for (let i = 0; i < 5; i++) assert.equal((await layout.resolveLaunch())?.version, '1.1.0');
});

test('rollback flips the pointer to the previous version and refuses without one', async t => {
  const { root, layout } = await installed(t, ['1.0.0', '1.1.0']);
  const result = await layout.rollback();
  assert.deepEqual([result.from, result.to], ['1.1.0', '1.0.0']);
  assert.deepEqual([(await pointer(root)).version, (await pointer(root)).previous, (await pointer(root)).state], ['1.0.0', '1.1.0', 'committed']);
  const fresh = await directory(t);
  await assert.rejects(new InstallLayout({ installRoot: join(fresh, 'install') }).rollback(), code('ROLLBACK_UNAVAILABLE'));
  await rm(join(root, 'install', 'versions', '1.1.0'), { recursive: true });
  await assert.rejects(layout.rollback(), code('ROLLBACK_UNAVAILABLE'));
});

test('at most two old versions are kept; older ones and leftovers are pruned', async t => {
  const { root } = await installed(t, ['1.0.0', '1.1.0', '1.2.0', '1.3.0']);
  assert.deepEqual((await readdir(join(root, 'install', 'versions'))).sort(), ['1.1.0', '1.2.0', '1.3.0']);
  assert.equal((await pointer(root)).previous, '1.2.0');
});

test('unsafe unpacked content and empty unpacks refuse and leave no version directory', async t => {
  const root = await directory(t), a = await artifact(root, '1.0.0', 'tar.gz');
  const escaping:Unpack = async (_artifact, destination) => { await writeFile(join(destination, 'app'), 'x'); await symlink('../../../../etc/passwd', join(destination, 'link')); };
  await assert.rejects(new InstallLayout({ installRoot: join(root, 'install'), unpack: escaping }).install(a.path, a.manifest), code('INSTALL_UNSAFE_CONTENT'));
  await assert.rejects(new InstallLayout({ installRoot: join(root, 'install'), unpack: async () => {} }).install(a.path, a.manifest), code('INSTALL_INCOMPLETE'));
  assert.deepEqual(await readdir(join(root, 'install', 'versions')), []);
  await assert.rejects(readFile(join(root, 'install', 'current.json')), (error:any) => error.code === 'ENOENT');
});

test('the default unpacker extracts a tar.gz archive with the system tar', { skip: spawnSync('tar', ['--version']).status !== 0 }, async t => {
  const root = await directory(t), source = join(root, 'source'); await mkdir(join(source, 'resources'), { recursive: true });
  await writeFile(join(source, 'chausar'), 'inert launcher fixture'); await writeFile(join(source, 'resources', 'app.txt'), 'inert resource');
  const archive = join(root, 'staged.artifact');
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', source, '.'], { shell: false }).status, 0);
  const bytes = await readFile(archive), manifest:ReleaseManifest = { schemaVersion: 1, version: '1.0.0', publishedAt: '2026-09-01T00:00:00.000Z', platform: process.platform as any, architecture: process.arch as any,
    url: 'https://downloads.example.com/chausar-1.0.0-linux-x64.tar.gz', sha256: hash(bytes), size: bytes.length, minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  const result = await new InstallLayout({ installRoot: join(root, 'install') }).install(archive, manifest);
  assert.equal(await readFile(join(result.directory, 'resources', 'app.txt'), 'utf8'), 'inert resource');
});
