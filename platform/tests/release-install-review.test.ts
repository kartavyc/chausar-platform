import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ReleaseManifest } from '../runtime/updater.ts';
import { InstallLayout, MAX_TRIAL_LAUNCHES, type Unpack } from '../runtime/native/update-install.ts';
import { DataGuard, VersionSchemaLedger } from '../runtime/native/update-data-guard.ts';
import { resolveInstalledLaunch } from '../runtime/native/update-service.ts';
import { Engine } from '../runtime/engine.ts';

// Review findings on the install layout: private artifact copy, rollback checks under the lock, the launcher's
// data-schema rule, hard links, and the marker rising only after an automatic confirmation.
const code = (expected:string) => (error:any) => error.code === expected;
const hash = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
async function directory(t:any) { const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-review-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function artifact(root:string, version:string, body = `Inert Chausar ${version} archive fixture.`) {
  const path = join(root, `staged-${version}.tar.gz`); await writeFile(path, body);
  const manifest:ReleaseManifest = { schemaVersion: 1, version, publishedAt: '2026-09-01T00:00:00.000Z', platform: process.platform as any, architecture: process.arch as any,
    url: `https://downloads.example.com/chausar-${version}-linux-x64.tar.gz`, sha256: hash(body), size: Buffer.byteLength(body), minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
  return { path, manifest, body };
}
/** Copies the archive bytes it is handed into one file, so the test sees exactly what was unpacked. */
const recordingUnpack = (seen:string[], after?:(path:string)=>Promise<void>):Unpack => async (path, destination) => {
  seen.push(path); const bytes = await readFile(path); await after?.(path); await writeFile(join(destination, 'payload'), bytes);
};

test('install unpacks a private, hash-checked copy; swapping the staged file after the check changes nothing', async t => {
  const root = await directory(t), seen:string[] = [], a = await artifact(root, '1.0.0');
  const layout = new InstallLayout({ installRoot: join(root, 'install'), unpack: recordingUnpack(seen, async () => { await writeFile(a.path, 'attacker bytes swapped in after hashing'); }) });
  const installed = await layout.install(a.path, a.manifest);
  assert.equal(seen.length, 1);
  assert.match(seen[0], /[\\/]versions[\\/]\.partial-artifact-[0-9a-f-]{36}$/);
  await assert.rejects(lstat(seen[0]), code('ENOENT'));
  assert.equal(await readFile(join(installed.directory, 'payload'), 'utf8'), a.body);
  // A staged file already changed before the copy refuses, and leaves no copy or partial folder behind.
  await layout.confirmHealthy('1.0.0');
  const b = await artifact(root, '1.1.0'); await writeFile(b.path, 'changed after signing, same length?');
  await assert.rejects(layout.install(b.path, b.manifest), code('INSTALL_ARTIFACT_MISMATCH'));
  assert.deepEqual((await readdir(join(root, 'install', 'versions'))).filter(name => name.startsWith('.')), []);
});

test('rollback and the automatic trial rollback ask canReturnTo inside the install lock', async t => {
  const root = await directory(t), installRoot = join(root, 'install'), layout = new InstallLayout({ installRoot, unpack: recordingUnpack([]) });
  for (const version of ['1.0.0', '1.1.0']) { const a = await artifact(root, version); await layout.install(a.path, a.manifest); if (version === '1.0.0') await layout.confirmHealthy(version); }
  const asked:Array<[string, boolean]> = [];
  const locked = async (version:string) => { asked.push([version, (await lstat(join(installRoot, 'install.lock'))).isFile()]); return false; };
  for (let launch = 1; launch <= MAX_TRIAL_LAUNCHES + 2; launch++) {
    const decision = await layout.resolveLaunch({ canReturnTo: locked });
    assert.equal(decision?.version, '1.1.0'); assert.equal(decision?.rolledBack, false);
    assert.equal(decision?.rollbackUnavailable, launch > MAX_TRIAL_LAUNCHES);
  }
  // The count stops one past the limit, so the pointer stays valid however often it is launched.
  assert.equal(JSON.parse(await readFile(join(installRoot, 'current.json'), 'utf8')).attempts, MAX_TRIAL_LAUNCHES + 1);
  assert.deepEqual(asked, [['1.0.0', true], ['1.0.0', true]]);
  await assert.rejects(layout.rollback({ canReturnTo: locked }), code('ROLLBACK_UNAVAILABLE'));
  await assert.rejects(layout.rollback({ canReturnTo: async () => { throw Object.assign(new Error('typed'), { code: 'ROLLBACK_TARGET_WITHDRAWN' }); } }), code('ROLLBACK_TARGET_WITHDRAWN'));
  assert.equal(asked.at(-1)?.[1], true);
  assert.equal((await layout.rollback({ canReturnTo: async () => true })).to, '1.0.0');
});

test('the launcher entry never rolls back past a raised data-schema marker, and not at all without the app data record', async t => {
  const root = await directory(t), installRoot = join(root, 'install'), appData = join(root, 'app-data');
  const layout = new InstallLayout({ installRoot, unpack: recordingUnpack([]) });
  const prepare = async () => {
    await rm(installRoot, { recursive: true, force: true });
    for (const version of ['1.0.0', '1.1.0']) { const a = await artifact(root, version); await layout.install(a.path, a.manifest); if (version === '1.0.0') await layout.confirmHealthy(version); }
  };
  // No app-data.json: the schema cannot be checked, so the trial stays current.
  await prepare();
  for (let launch = 0; launch <= MAX_TRIAL_LAUNCHES; launch++) await resolveInstalledLaunch({ installRoot });
  assert.deepEqual([(await layout.pointer())?.version, (await layout.pointer())?.state], ['1.1.0', 'trial']);
  // With the record and no migration: the automatic rollback happens on the third launch.
  await prepare();
  await writeFile(join(installRoot, 'app-data.json'), JSON.stringify({ appDataDirectory: appData }));
  await new VersionSchemaLedger({ appDataDirectory: appData }).record([['1.0.0', 1], ['1.1.0', 2]]);
  for (let launch = 1; launch < MAX_TRIAL_LAUNCHES; launch++) await resolveInstalledLaunch({ installRoot });
  assert.equal((await resolveInstalledLaunch({ installRoot }))?.version, '1.1.0');
  const third = await resolveInstalledLaunch({ installRoot });
  assert.deepEqual([third?.version, third?.rolledBack], ['1.0.0', true]);
  // After 1.1.0 migrated the vault (marker 2), 1.0.0 must not run again automatically.
  await prepare();
  await new DataGuard({ appDataDirectory: appData }).recordSchema(2, '1.1.0');
  for (let launch = 1; launch <= MAX_TRIAL_LAUNCHES + 1; launch++) {
    const decision = await resolveInstalledLaunch({ installRoot });
    assert.deepEqual([decision?.version, decision?.rolledBack, decision?.rollbackUnavailable], ['1.1.0', false, launch > MAX_TRIAL_LAUNCHES]);
  }
  await writeFile(join(installRoot, 'app-data.json'), JSON.stringify({ appDataDirectory: 'relative/path' }));
  await assert.rejects(resolveInstalledLaunch({ installRoot }), code('INSTALL_DATA_LINK_INVALID'));
});

test('unpacked content with a hard link refuses', { skip: process.platform === 'win32' }, async t => {
  const root = await directory(t), outside = join(root, 'outside.txt'); await writeFile(outside, 'shared inode');
  const layout = new InstallLayout({ installRoot: join(root, 'install'), unpack: async (_path, destination) => { await mkdir(join(destination, 'app')); await link(outside, join(destination, 'app', 'linked')); } });
  const a = await artifact(root, '1.0.0');
  await assert.rejects(layout.install(a.path, a.manifest), code('INSTALL_UNSAFE_CONTENT'));
  assert.equal(await readFile(outside, 'utf8'), 'shared inode');
});

test('the automatic confirmation raises the data-schema marker only for the confirmed running version', async t => {
  const root = await directory(t), installRoot = join(root, 'install'), layout = new InstallLayout({ installRoot, unpack: recordingUnpack([]) });
  for (const version of ['1.0.0', '1.1.0']) { const a = await artifact(root, version); await layout.install(a.path, a.manifest); if (version === '1.0.0') await layout.confirmHealthy(version); }
  const engineFor = async (version:string, name:string) => {
    const engine = new Engine({ directory: join(root, name, 'data'), version, demo: true, storage: 'experimental-file', modules: { release: { installRoot, dataSchemaVersion: 2 } } });
    await engine.request('workspace.create', { name: 'Synthetic marker shop', passphrase: 'synthetic-marker-passphrase', demo: true });
    return engine;
  };
  // An older copy that is not the version on trial confirms nothing and raises nothing.
  const other = await engineFor('1.0.0', 'other');
  assert.equal((await other.request('release.status')).trial, 'other-version');
  assert.equal(await new DataGuard({ appDataDirectory: join(root, 'other', 'data') }).marker(), null);
  // A phone or tainted request never confirms.
  const running = await engineFor('1.1.0', 'running'), owner = running.bootstrapContext();
  assert.equal((await running.requestAs({ ...owner, sourceTainted: true }, 'release.status', {})).trial, null);
  assert.equal((await layout.pointer())?.state, 'trial');
  assert.equal(await new DataGuard({ appDataDirectory: join(root, 'running', 'data') }).marker(), null);
  assert.equal((await running.request('release.status')).trial, 'confirmed');
  assert.equal((await layout.pointer())?.state, 'committed');
  const marker = await new DataGuard({ appDataDirectory: join(root, 'running', 'data') }).marker();
  assert.deepEqual([marker?.dataSchemaVersion, marker?.writtenBy], [2, '1.1.0']);
});
