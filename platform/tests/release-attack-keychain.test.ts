import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { keychainStatus, parseKeychainManifest } from '../runtime/native/keychain-status.ts';
import { loadEngineKeychain, validKeychainHelperManifest } from '../runtime/engine-keychain-host.ts';
import { PlatformKeychain } from '../runtime/platform-keychain.ts';
import { writeKeychainManifest } from '../../scripts/release/keychain-manifest.ts';

// Keychain custody attacks. Synthetic helper bytes only; nothing here starts a helper or touches an OS credential store.
const SECRET_DIR = 'private-customer-folder-7f3a';
const helperFor = (marker:string) => Buffer.from(`#!/bin/sh\ntouch '${marker}'\nexit 0\n`);
const sha = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const exe = (platform:string) => platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain';
async function folder(t:TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-keychain-attack-')); t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, SECRET_DIR, 'runtime-binaries', 'keychain'); await mkdir(directory, { recursive: true });
  return { root, resources: join(root, SECRET_DIR), directory };
}
const good = (platform:string, architecture:string, sha256 = 'a'.repeat(64)) => ({ format: 'chausar.keychain-helper.v1', platform, architecture, executable: exe(platform), sha256 });

/** Enrollment path with a stub verifier: succeeds exactly when the host accepts the manifest. No process is spawned. */
async function enrollAccepts(manifest:unknown, platform:NodeJS.Platform, architecture:string):Promise<boolean> {
  let spawned = false;
  try {
    await loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(resolve(tmpdir()), 'chausar-resources', 'runtime-binaries', 'keychain', 'manifest.json') }, {
      readKeychainManifest: async () => Buffer.from(typeof manifest === 'string' ? manifest : JSON.stringify(manifest)),
      keychainPlatform: platform, keychainArchitecture: architecture,
      keychainProcess: { verifyExecutable: async () => {}, spawnProcess: (() => { spawned = true; throw new Error('never'); }) as any },
    });
    return true;
  } catch (error:any) { assert.equal(error.code, 'KEYCHAIN_MANIFEST_INVALID'); return false; }
  finally { assert.equal(spawned, false); }
}

test('attack: status and enrollment cannot disagree about a manifest (one shared validator)', async () => {
  const cases:Array<[unknown, NodeJS.Platform, string]> = [];
  for (const platform of ['win32', 'darwin', 'linux'] as const) for (const architecture of ['x64', 'arm64']) {
    const base = good(platform, architecture);
    cases.push([base, platform, architecture]);
    cases.push([{ ...base, architecture: architecture === 'x64' ? 'arm64' : 'x64' }, platform, architecture]);
    cases.push([{ ...base, platform: platform === 'linux' ? 'darwin' : 'linux' }, platform, architecture]);
    cases.push([{ ...base, executable: '../chausar-keychain' }, platform, architecture]);
    cases.push([{ ...base, executable: '/usr/bin/env' }, platform, architecture]);
    cases.push([{ ...base, executable: 'C:\\Windows\\System32\\cmd.exe' }, platform, architecture]);
    cases.push([{ ...base, executable: exe(platform) + '\u0000' }, platform, architecture]);
    cases.push([{ ...base, sha256: 'A'.repeat(64) }, platform, architecture]);
    cases.push([{ ...base, sha256: 'a'.repeat(63) }, platform, architecture]);
    cases.push([{ ...base, extra: true }, platform, architecture]);
    cases.push([JSON.stringify(base).replace('{', '{"__proto__":{"executable":"/bin/sh"},'), platform, architecture]);
    cases.push([JSON.stringify(base).replace('"format"', '"format":"x","format"'), platform, architecture]);
    cases.push([[base], platform, architecture]);
    cases.push(['null', platform, architecture]);
  }
  cases.push([good('linux', 'ia32'), 'linux', 'ia32']);
  cases.push([good('freebsd', 'x64'), 'freebsd' as any, 'x64']);
  for (const [manifest, platform, architecture] of cases) {
    const bytes = Buffer.from(typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    const status = parseKeychainManifest(bytes, platform, architecture) !== null;
    assert.equal(await enrollAccepts(manifest, platform, architecture), status, `diverged on ${bytes.toString()}`);
    assert.equal(validKeychainHelperManifest(JSON.parse(bytes.toString()), platform, architecture), status);
  }
});

test('attack: status never runs the helper, even when its pin matches', { skip: process.platform === 'win32' }, async t => {
  const { root, resources, directory } = await folder(t), marker = join(root, 'helper-ran'), helper = helperFor(marker);
  await writeFile(join(directory, 'chausar-keychain'), helper, { mode: 0o755 });
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(good(process.platform, process.arch, sha(helper))));
  const status = await keychainStatus({ platform: process.platform, arch: process.arch, environment: {}, resourcesPath: resources, demo: false });
  assert.equal(status.helper, 'present');
  await assert.rejects(access(marker));
});

test('attack: symbolic links for the manifest or helper are reported invalid and refused at enrollment', { skip: process.platform === 'win32' }, async t => {
  const { root, resources, directory } = await folder(t), helper = helperFor(join(root, 'ran'));
  const elsewhere = join(root, 'elsewhere'); await mkdir(elsewhere);
  await writeFile(join(elsewhere, 'manifest.json'), JSON.stringify(good(process.platform, process.arch, sha(helper))));
  await symlink(join(elsewhere, 'manifest.json'), join(directory, 'manifest.json'));
  assert.equal((await keychainStatus({ platform: process.platform, arch: process.arch, environment: {}, resourcesPath: resources, demo: false })).helper, 'invalid');
  await assert.rejects(loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(directory, 'manifest.json') }), (error:any) => error.code === 'KEYCHAIN_MANIFEST_INVALID' && !error.message.includes(SECRET_DIR));
  await rm(join(directory, 'manifest.json'));
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(good(process.platform, process.arch, sha(helper))));
  await writeFile(join(elsewhere, 'chausar-keychain'), helper, { mode: 0o755 });
  await symlink(join(elsewhere, 'chausar-keychain'), join(directory, 'chausar-keychain'));
  assert.equal((await keychainStatus({ platform: process.platform, arch: process.arch, environment: {}, resourcesPath: resources, demo: false })).helper, 'invalid');
});

test('attack: a helper that fails its pin checks (writable mode, wrong header) is refused before any spawn', { skip: process.platform === 'win32' || !['x64', 'arm64'].includes(process.arch) }, async t => {
  const { directory } = await folder(t), helper = Buffer.from('not a native binary'), path = join(directory, 'chausar-keychain');
  await writeFile(path, helper, { mode: 0o775 });
  let spawned = false;
  await assert.rejects(PlatformKeychain.create({ platform: process.platform, architecture: process.arch, executable: path, sha256: sha(helper),
    spawnProcess: (() => { spawned = true; throw new Error('never'); }) as any }), (error:any) => error.code === 'KEYCHAIN_UNAVAILABLE' && !error.message.includes(SECRET_DIR) && !error.message.includes(path));
  assert.equal(spawned, false);
});

test('attack: custody errors never carry paths, helper output or secret bytes', async t => {
  const { directory } = await folder(t);
  await assert.rejects(loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(directory, 'manifest.json') }), (error:any) => error.code === 'KEYCHAIN_MANIFEST_INVALID' && !error.message.includes(SECRET_DIR));
  await assert.rejects(loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(directory, 'not-the-manifest.json') }), (error:any) => error.code === 'KEYCHAIN_MANIFEST_INVALID' && !error.message.includes(SECRET_DIR));
  await writeFile(join(directory, 'manifest.json'), `{"secret":"${'s3cr3t'.repeat(4)}"}`);
  await assert.rejects(loadEngineKeychain({ CHAUSAR_KEYCHAIN_MANIFEST: join(directory, 'manifest.json') }), (error:any) => !error.message.includes('s3cr3t') && !error.message.includes(SECRET_DIR));
  await assert.rejects(PlatformKeychain.create({ platform: process.platform, architecture: process.arch, executable: join(directory, 'missing'), sha256: 'a'.repeat(64) }),
    (error:any) => error.code === 'KEYCHAIN_UNAVAILABLE' && !error.message.includes(SECRET_DIR));
});

test('attack: a link planted in the release output folder cannot redirect the pinned helper or manifest', { skip: process.platform === 'win32' }, async t => {
  const { root, directory } = await folder(t), compiled = join(root, 'compiled-helper'), victim = join(root, 'victim');
  await writeFile(compiled, Buffer.from('synthetic compiled helper bytes')); await writeFile(victim, 'untouched');
  await symlink(victim, join(directory, 'chausar-keychain'));
  await assert.rejects(writeKeychainManifest({ helper: compiled, platform: 'linux', architecture: 'x64', out: directory }), (error:any) => error.code === 'KEYCHAIN_HELPER_INVALID');
  await rm(join(directory, 'chausar-keychain'));
  await link(victim, join(directory, 'manifest.json'));
  await assert.rejects(writeKeychainManifest({ helper: compiled, platform: 'linux', architecture: 'x64', out: directory }), (error:any) => error.code === 'KEYCHAIN_HELPER_INVALID');
  await rm(join(directory, 'manifest.json'));
  const manifest = await writeKeychainManifest({ helper: compiled, platform: 'linux', architecture: 'x64', out: directory });
  assert.equal(manifest.sha256, sha(Buffer.from('synthetic compiled helper bytes')));
});
