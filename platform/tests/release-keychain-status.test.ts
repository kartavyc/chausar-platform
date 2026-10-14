import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { keychainStatus, parseKeychainManifest } from '../runtime/native/keychain-status.ts';
import { writeKeychainManifest } from '../../scripts/release/keychain-manifest.ts';

// Synthetic helper bytes; the status check only hashes them and never executes anything.
const helperBytes = Buffer.from('#!/bin/sh\necho "this synthetic helper must never run" > /dev/null\nexit 99\n');
const sha256 = createHash('sha256').update(helperBytes).digest('hex');
const executableFor = (platform: string) => platform === 'win32' ? 'chausar-keychain.exe' : 'chausar-keychain';

async function resources(t: TestContext, platform: string, manifest?: unknown, helper: Buffer | null = helperBytes): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'chausar-keychain-status-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'runtime-binaries', 'keychain');
  await mkdir(directory, { recursive: true });
  if (manifest !== undefined) await writeFile(join(directory, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
  if (helper) await writeFile(join(directory, executableFor(platform)), helper, { mode: 0o755 });
  return root;
}
const manifestFor = (platform: string, architecture = 'x64') => ({ format: 'chausar.keychain-helper.v1', platform, architecture, executable: executableFor(platform), sha256 });

test('each platform reports its provider and a present helper whose bytes match the manifest', async t => {
  const providers = { win32: 'windows-credential-manager', darwin: 'macos-keychain', linux: 'linux-libsecret' } as const;
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const resourcesPath = await resources(t, platform, manifestFor(platform, 'arm64'));
    const status = await keychainStatus({ platform, arch: 'arm64', environment: { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus' }, resourcesPath, demo: false });
    assert.equal(status.provider, providers[platform]);
    assert.equal(status.helper, 'present');
    assert.deepEqual(status.manifest, manifestFor(platform, 'arm64'));
    assert.equal(status.qualification, 'not-qualified-on-native-store');
    assert.equal(status.demo, false);
    if (platform === 'linux') assert.equal(status.sessionBus, 'ok'); else assert.equal('sessionBus' in status, false);
  }
});

test('the helper file is never executed: a non-executable synthetic file still reports present', { skip: process.platform === 'win32' }, async t => {
  const resourcesPath = await resources(t, 'linux', manifestFor('linux'));
  await chmod(join(resourcesPath, 'runtime-binaries/keychain/chausar-keychain'), 0o600);
  const status = await keychainStatus({ platform: 'linux', arch: 'x64', environment: {}, resourcesPath, demo: true });
  assert.equal(status.helper, 'present');
  assert.equal(status.sessionBus, 'missing');
  assert.equal(status.demo, true);
});

test('absent manifest or helper reports absent', async t => {
  const none = await resources(t, 'darwin', undefined, null);
  assert.deepEqual(await keychainStatus({ platform: 'darwin', arch: 'x64', environment: {}, resourcesPath: none, demo: false }),
    { provider: 'macos-keychain', helper: 'absent', manifest: null, demo: false, qualification: 'not-qualified-on-native-store' });
  const noHelper = await resources(t, 'darwin', manifestFor('darwin'), null);
  const status = await keychainStatus({ platform: 'darwin', arch: 'x64', environment: {}, resourcesPath: noHelper, demo: false });
  assert.equal(status.helper, 'absent');
  assert.deepEqual(status.manifest, manifestFor('darwin'));
});

test('strict manifest validation: extra keys, wrong target, executable name or digest form are invalid', async t => {
  const variants: unknown[] = [
    { ...manifestFor('linux'), extra: true },
    { ...manifestFor('linux'), format: 'chausar.keychain-helper.v2' },
    { ...manifestFor('linux'), platform: 'darwin' },
    { ...manifestFor('linux'), architecture: 'arm64' },
    { ...manifestFor('linux'), executable: '../../bin/sh' },
    { ...manifestFor('linux'), sha256: sha256.toUpperCase() },
    (({ sha256: _, ...rest }) => rest)(manifestFor('linux')),
    'not json', '[]', 'null',
  ];
  for (const manifest of variants) {
    const resourcesPath = await resources(t, 'linux', manifest);
    const status = await keychainStatus({ platform: 'linux', arch: 'x64', environment: {}, resourcesPath, demo: false });
    assert.equal(status.helper, 'invalid', JSON.stringify(manifest));
    assert.equal(status.manifest, null);
  }
  assert.equal(parseKeychainManifest(Buffer.from(JSON.stringify(manifestFor('linux'))), 'linux', 'ia32'), null);
});

test('a helper whose bytes differ from the pinned digest, or a symlinked helper, is invalid', async t => {
  const changed = await resources(t, 'linux', manifestFor('linux'), Buffer.from('different bytes'));
  assert.equal((await keychainStatus({ platform: 'linux', arch: 'x64', environment: {}, resourcesPath: changed, demo: false })).helper, 'invalid');
  if (process.platform === 'win32') return;
  const linked = await resources(t, 'linux', manifestFor('linux'), null);
  const real = join(linked, 'real-helper'); await writeFile(real, helperBytes);
  await symlink(real, join(linked, 'runtime-binaries/keychain/chausar-keychain'));
  assert.equal((await keychainStatus({ platform: 'linux', arch: 'x64', environment: {}, resourcesPath: linked, demo: false })).helper, 'invalid');
});

test('session bus detection accepts only a local unix address', async t => {
  const resourcesPath = await resources(t, 'linux', manifestFor('linux'));
  for (const [address, expected] of [['unix:path=/run/user/1000/bus', 'ok'], ['unix:abstract=/tmp/dbus-x,guid=0123456789abcdef0123456789abcdef', 'ok'],
    ['tcp:host=example.com,port=1', 'missing'], ['', 'missing'], ['unix:path=/a;b', 'missing'], [undefined, 'missing']] as const) {
    const status = await keychainStatus({ platform: 'linux', arch: 'x64', environment: address === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: address }, resourcesPath, demo: false });
    assert.equal(status.sessionBus, expected, String(address));
  }
});

test('unsupported platforms refuse', async () => {
  await assert.rejects(keychainStatus({ platform: 'freebsd', arch: 'x64', environment: {}, resourcesPath: '/r', demo: false }), (error: any) => error.code === 'KEYCHAIN_UNSUPPORTED');
});

test('keychain-manifest writes the exact v1 format that keychain status (and engine startup) accept', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-keychain-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const compiled = join(root, 'build-output'); await writeFile(compiled, helperBytes);
  const out = join(root, 'resources', 'runtime-binaries', 'keychain');
  const manifest = await writeKeychainManifest({ helper: compiled, platform: 'linux', architecture: 'x64', out });
  assert.deepEqual(manifest, manifestFor('linux'));
  const written = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
  assert.deepEqual(Object.keys(written).sort(), ['architecture', 'executable', 'format', 'platform', 'sha256']);
  assert.equal((await keychainStatus({ platform: 'linux', arch: 'x64', environment: {}, resourcesPath: join(root, 'resources'), demo: false })).helper, 'present');
  await assert.rejects(writeKeychainManifest({ helper: compiled, platform: 'freebsd', architecture: 'x64', out }), (error: any) => error.code === 'KEYCHAIN_MANIFEST_INVALID');
});
