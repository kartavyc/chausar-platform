import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { ServiceRunner } from '../runtime/native/background-service.ts';

const code = (expected: string) => (error: any) => error.code === expected;
const publicKey = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString();

async function fixture(t: any, release: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-release-module-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls: string[][] = [];
  const runner: ServiceRunner = async (command, args) => { calls.push([command, ...args]); return { code: 0, stdout: 'active\n', stderr: '' }; };
  const engine = new Engine({ directory: join(directory, 'data'), demo: true, storage: 'experimental-file', modules: { release: {
    platform: 'linux', homeDirectory: join(directory, 'home'), uid: 1000, appExecutable: '/opt/Chausar/chausar', serviceRunner: runner, ...release } } });
  await engine.request('workspace.create', { name: 'Synthetic release shop', passphrase: 'synthetic-release-passphrase', demo: true });
  return { directory, engine, calls };
}

test('release.status reports an unconfigured update channel without failing', async t => {
  const { engine } = await fixture(t);
  const status = await engine.request('release.status');
  assert.equal(status.configured, false);
  assert.equal(status.version, '0.1.0-preview.1');
  assert.equal(status.dataSchema, null);
  await assert.rejects(engine.request('release.applyUpdate', { confirmed: true }), code('UPDATES_UNAVAILABLE'));
});

test('a configured channel exposes build expiry, keeps external checks off in demo, and waits for confirmation', async t => {
  const { engine, directory } = await fixture(t, { releasePublicKey: publicKey, channel: 'preview', previewExpiresAt: '2099-01-01T00:00:00.000Z', feedUrl: 'https://updates.example.com/preview/feed.json' });
  const status = await engine.request('release.status');
  assert.equal(status.configured, true);
  assert.equal(status.channel, 'preview');
  assert.equal(status.build.usable, true);
  assert.match(await readFile(join(directory, 'data', 'release', 'install-id'), 'utf8'), /^[A-Za-z0-9_-]{8,128}$/);
  await assert.rejects(engine.request('release.checkUpdate'), code('DEMO_EXTERNAL_DISABLED'));
  await assert.rejects(engine.request('release.applyUpdate', {}), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(engine.request('release.applyUpdate', { confirmed: true }), code('UPDATE_NOT_STAGED'));
  await assert.rejects(engine.request('release.rollback', {}), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(engine.request('release.rollback', { confirmed: true }), code('ROLLBACK_UNAVAILABLE'));
});

test('an expired preview build says an update is needed', async t => {
  const { engine } = await fixture(t, { releasePublicKey: publicKey, channel: 'preview', previewExpiresAt: '2020-01-01T00:00:00.000Z' });
  const status = await engine.request('release.status');
  assert.equal(status.build.usable, false);
  assert.equal(status.build.updateNeeded, true);
});

test('the background service plans, installs only on confirmation, and refuses tainted requests', async t => {
  const { engine, calls, directory } = await fixture(t);
  const plan = await engine.request('service.plan');
  assert.equal(plan.mechanism, 'linux-systemd-user');
  assert.equal(plan.elevation, 'none');
  assert.equal(calls.length, 0);
  await assert.rejects(engine.request('service.install', {}), code('CONFIRMATION_REQUIRED'));
  const owner = engine.bootstrapContext();
  await assert.rejects(engine.requestAs({ ...owner, sourceTainted: true }, 'service.install', { confirmed: true }), code('TAINTED_RELEASE_REQUEST'));
  await assert.rejects(engine.requestAs({ ...owner, channel: 'phone' }, 'service.status', {}), code('OPEN_DESKTOP'));
  const installed = await engine.request('service.install', { confirmed: true });
  assert.equal(installed.installed, true);
  assert.ok(calls.some(call => call.join(' ').includes('enable')));
  const unit = await readFile(join(directory, 'home', '.config', 'systemd', 'user', 'chausar-background.service'), 'utf8');
  assert.match(unit, /--background/);
  await engine.request('service.uninstall', { confirmed: true });
});

test('a viewer can read release status but cannot change the installed app', async t => {
  const { engine } = await fixture(t);
  const owner = engine.bootstrapContext();
  const viewer = await engine.requestAs(owner, 'members.add', { name: 'Synthetic viewer', role: 'viewer' });
  const ctx = { memberId: viewer.id, role: 'viewer' as const, epoch: viewer.epoch, channel: 'desktop' as const };
  assert.equal((await engine.requestAs(ctx, 'release.status', {})).configured, false);
  await assert.rejects(engine.requestAs(ctx, 'service.install', { confirmed: true }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(ctx, 'native.keychainStatus', {}), code('FORBIDDEN'));
});

test('keychain status reads the helper manifest without running anything', async t => {
  const { engine, directory } = await fixture(t, { resourcesPath: join(tmpdir(), 'chausar-no-resources'), environment: {} });
  const status = await engine.request('native.keychainStatus');
  assert.equal(status.provider, 'linux-libsecret');
  assert.equal(status.helper, 'absent');
  assert.equal(status.qualification, 'not-qualified-on-native-store');
  assert.ok(directory);
});

test('the bundled database status needs the installed runtime', async t => {
  const { engine } = await fixture(t);
  await assert.rejects(engine.request('native.databaseStatus'), code('DATABASE_RUNTIME_UNAVAILABLE'));
});
