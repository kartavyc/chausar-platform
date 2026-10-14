import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { frameTodayModule } from '../runtime/modules/lane-frame-today.ts';
import {
  DEVICE_FILE, bitLockerFromManageBde, bitLockerFromPowerShell, diskCheck, fileVault, luksFromLsblk, readDevice, workspaceFolders, type DiskProbe,
} from '../runtime/frame-today/device.ts';
import {
  isDeviceChoices, isDiskCheckReply, isIdentityCheckReply, isRecoveryContactReply, isWorkspaceFoldersReply, TODAYX_REFUSALS,
} from '../../app/ui/src/bridge/todayx-contract.ts';

const passphrase = 'Frame today device synthetic passphrase 2026';
const code = (expected: string) => (error: any) => error?.code === expected;
const PRE_VAULT = ['todayx.identity.check', 'todayx.diskCheck', 'todayx.device.get', 'todayx.device.set', 'todayx.workspaces', 'todayx.recoveryContact.request'];

type ProbeCall = { command: string; args: readonly string[] };
function fakeProbe(outputs: Record<string, string | Error | 'hang'>, calls: ProbeCall[] = []): DiskProbe {
  return async (command, args) => {
    calls.push({ command, args });
    const key = Object.keys(outputs).find(name => command.endsWith(name));
    const out = key === undefined ? new Error('not installed') : outputs[key]!;
    if (out === 'hang') return new Promise(() => {});
    if (out instanceof Error) throw out;
    return { code: 0, stdout: out };
  };
}

async function lockedEngine(t: any, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-device-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'frame-today': options } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  return { engine, directory };
}

test('the preVault methods are exactly the ones that touch no workspace', () => {
  const marked = Object.entries(frameTodayModule.methods).filter(([, spec]) => spec.preVault === true).map(([name]) => name).sort();
  assert.deepEqual(marked, [...PRE_VAULT].sort());
  for (const name of ['todayx.recoveryContact.get', 'todayx.recoveryContact.set', 'todayx.identity.save', 'todayx.shell']) assert.notEqual(frameTodayModule.methods[name]?.preVault, true, name);
  for (const refusal of ['RECOVERY_CONTACT_INVALID', 'RECOVERY_CONTACT_RELAY_REQUIRED']) assert.ok((TODAYX_REFUSALS as readonly string[]).includes(refusal));
});

test('before any vault: format checks, disk check, device choices and the folder list work through the real dispatch', async t => {
  const { engine, directory } = await lockedEngine(t, { platform: 'darwin', diskProbe: fakeProbe({ fdesetup: 'FileVault is On.\n' }) });
  assert.equal((await engine.request('workspace.status', {})).open, false);

  const checked = await engine.request('todayx.identity.check', { fields: { pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z' } });
  assert.ok(isIdentityCheckReply(checked as unknown));
  assert.deepEqual(checked.fields.pan, { ok: true });
  assert.equal(checked.fields.gstin.problem, 'length');

  const disk = await engine.request('todayx.diskCheck', {});
  assert.ok(isDiskCheckReply(disk));
  assert.deepEqual(disk, { disk: 'encrypted', platform: 'macos', keyring: 'safe' });

  assert.deepEqual(await engine.request('todayx.device.get', {}), { language: null, view: null, saved: false });
  const saved = await engine.request('todayx.device.set', { language: 'hi', view: 'books' });
  assert.ok(isDeviceChoices(saved));
  assert.deepEqual(await engine.request('todayx.device.get', {}), { language: 'hi', view: 'books', saved: true });
  assert.deepEqual(JSON.parse(await readFile(join(directory, DEVICE_FILE), 'utf8')), { format: 'chausar.frame-today.device.v1', language: 'hi', view: 'books' });

  assert.deepEqual(await engine.request('todayx.workspaces', {}), { folders: [] });
  await assert.rejects(engine.request('todayx.recoveryContact.request', {}), code('RECOVERY_CONTACT_RELAY_REQUIRED'));
  await assert.rejects(engine.request('todayx.recoveryContact.request', { folder: '../x' }), code('INVALID_TODAYX_REQUEST'));

  // Everything else still needs an open vault: the store is never reached early.
  await assert.rejects(engine.request('todayx.recoveryContact.get', {}), code('VAULT_LOCKED'));
  await assert.rejects(engine.request('todayx.identity.save', { fields: {}, gstMode: null }), code('VAULT_LOCKED'));
  await assert.rejects(engine.request('todayx.shell', {}), code('VAULT_LOCKED'));
});

test('before any vault only the trusted local desktop is served', async t => {
  const { engine } = await lockedEngine(t, { platform: 'linux', diskProbe: fakeProbe({}) });
  for (const channel of ['phone', 'mcp'] as const) {
    for (const method of PRE_VAULT) {
      await assert.rejects(engine.requestAs({ memberId: 'owner', role: 'owner', epoch: 1, channel } as any, method, {}), code('OPEN_DESKTOP'), `${channel} ${method}`);
    }
  }
  await assert.rejects(engine.requestAs({ memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true }, 'todayx.device.get', {}), code('OPEN_DESKTOP'));
});

test('device choices are strictly validated and written atomically', async t => {
  const { engine, directory } = await lockedEngine(t);
  for (const bad of [{}, { language: 'fr', view: 'books' }, { language: 'en', view: 'wide' }, { language: 'en', view: 'books', extra: 1 }, { language: 'en' }]) {
    await assert.rejects(engine.request('todayx.device.set', bad), code('INVALID_TODAYX_REQUEST'), JSON.stringify(bad));
  }
  await assert.rejects(engine.request('todayx.device.get', { language: 'en' }), code('INVALID_TODAYX_REQUEST'));
  await Promise.all([1, 2, 3, 4, 5].map(i => engine.request('todayx.device.set', { language: i % 2 ? 'en' : 'hi', view: 'simple' })));
  // No temporary file is left beside it, and the file holds exactly one complete value.
  assert.deepEqual((await readdir(directory)).filter(name => name.includes(DEVICE_FILE)), [DEVICE_FILE]);
  assert.ok(isDeviceChoices(await engine.request('todayx.device.get', {})));

  // A malformed, oversized or linked file reads as not saved, never as a guess.
  for (const text of ['{', JSON.stringify({ format: 'chausar.frame-today.device.v1', language: 'en', view: 'books', name: 'x' }), JSON.stringify({ format: 'other', language: 'en', view: 'books' }), ' '.repeat(2048)]) {
    await writeFile(join(directory, DEVICE_FILE), text);
    assert.deepEqual(await readDevice(directory), { language: null, view: null, saved: false });
  }
  await rm(join(directory, DEVICE_FILE));
  const elsewhere = join(directory, 'elsewhere.json');
  await writeFile(elsewhere, JSON.stringify({ format: 'chausar.frame-today.device.v1', language: 'en', view: 'books' }));
  await symlink(elsewhere, join(directory, DEVICE_FILE));
  assert.deepEqual(await readDevice(directory), { language: null, view: null, saved: false });
  await assert.rejects(engine.request('todayx.device.set', { language: 'en', view: 'books' }), code('INVALID_PATH'));
});

test('the workspace list names folders only, never opens one, and unlocks the folder chosen', async t => {
  const { engine, directory } = await lockedEngine(t);
  await engine.request('workspace.create', { name: 'Second Shop', passphrase, folder: 'second', demo: true });
  await engine.request('workspace.lock', {});
  await engine.request('workspace.create', { name: 'Main Shop', passphrase, folder: 'main', demo: true });
  await engine.request('workspace.lock', {});
  // Things that are not workspaces are left out.
  for (const name of ['backups', 'exports', 'updates']) await mkdir(join(directory, name));
  await mkdir(join(directory, 'notes')); await writeFile(join(directory, 'notes', 'todo.txt'), 'synthetic');
  await mkdir(join(directory, 'bad name'));
  await writeFile(join(directory, 'loose-file'), 'x');
  await symlink(join(directory, 'second'), join(directory, 'linked'));

  const before = await readFile(join(directory, 'main', 'authority.encrypted.json'), 'utf8');
  const listed = await engine.request('todayx.workspaces', {});
  assert.ok(isWorkspaceFoldersReply(listed));
  assert.deepEqual(listed, { folders: [{ folder: 'main', main: true }, { folder: 'second', main: false }] });
  assert.equal(JSON.stringify(listed).includes('Shop'), false, 'No workspace name is read: that would need the key.');
  assert.equal(await readFile(join(directory, 'main', 'authority.encrypted.json'), 'utf8'), before);
  assert.equal((await engine.request('workspace.status', {})).open, false);
  assert.deepEqual((await workspaceFolders(join(directory, 'missing'))), []);

  // The lock screen unlocks the folder the person picked.
  const opened = await engine.request('workspace.open', { folder: listed.folders[1].folder, passphrase });
  assert.equal(opened.workspace.name, 'Second Shop');
  // After the vault opens the same methods are authorized normally.
  assert.ok(isWorkspaceFoldersReply(await engine.request('todayx.workspaces', {})));
  assert.ok(isDeviceChoices(await engine.request('todayx.device.get', {})));
});

test('the recovery contact is kept in the vault for an admin, and asking them refuses until the relay exists', async t => {
  const { engine, directory } = await lockedEngine(t);
  await engine.request('workspace.create', { name: 'Contact Shop', passphrase, folder: 'main', demo: true });
  const empty = await engine.request('todayx.recoveryContact.get', {});
  assert.ok(isRecoveryContactReply(empty));
  assert.deepEqual(empty, { contact: null, confirmation: 'relay-required' });
  for (const bad of [{}, { contact: { name: 'Asha' } }, { contact: { name: '', reach: 'x' } }, { contact: { name: 'A\nB', reach: 'x' } }, { contact: { name: 'Asha', reach: 'x'.repeat(201) } }]) {
    await assert.rejects(engine.request('todayx.recoveryContact.set', bad), (error: any) => ['INVALID_TODAYX_REQUEST', 'RECOVERY_CONTACT_INVALID'].includes(error?.code) && !String(error.message).includes('Asha'));
  }
  const saved = await engine.request('todayx.recoveryContact.set', { contact: { name: ' Asha Synthetic ', reach: 'asha@example.invalid' } });
  assert.ok(isRecoveryContactReply(saved as unknown));
  assert.equal(saved.contact.name, 'Asha Synthetic');

  const member = await engine.request('members.add', { id: 'device-viewer', name: 'Synthetic viewer', role: 'viewer', branches: ['*'] });
  const viewer = { memberId: member.id, role: 'viewer' as const, epoch: member.epoch, channel: 'desktop' as const };
  await assert.rejects(engine.requestAs(viewer, 'todayx.recoveryContact.get', {}), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'todayx.recoveryContact.set', { contact: null }), code('FORBIDDEN'));
  await assert.rejects(engine.request('todayx.recoveryContact.request', {}), code('RECOVERY_CONTACT_RELAY_REQUIRED'));

  // Only the encrypted snapshot holds the contact; no audit entry, fault report or device file names them.
  const fault = await engine.request('todayx.faultReport', {});
  assert.equal(JSON.stringify(fault).includes('Asha'), false);
  await engine.request('workspace.lock', {});
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    const files = name === 'main' ? (await readdir(path)).map(file => join(path, file)) : [path];
    for (const file of files) { try { assert.equal((await readFile(file, 'utf8')).includes('Asha'), false, file); } catch (error: any) { if (error?.code !== 'EISDIR') throw error; } }
  }
  await engine.request('workspace.open', { folder: 'main', passphrase });
  assert.equal((await engine.request('todayx.recoveryContact.get', {})).contact.reach, 'asha@example.invalid');
  assert.deepEqual(await engine.request('todayx.recoveryContact.set', { contact: null }), { contact: null, confirmation: 'relay-required' });
});

test('the disk check maps each platform tool and treats failures and timeouts as unknown', async () => {
  const at = (platform: string, outputs: Record<string, string | Error | 'hang'>, env: Record<string, string> = {}, directory = '/home/synthetic/data', calls: ProbeCall[] = []) =>
    diskCheck({ directory: platform === 'win32' ? 'D:\\Chausar\\data' : directory, platform, env, probe: fakeProbe(outputs, calls), timeoutMs: 50 });

  // Windows: PowerShell's untranslated enum first, then manage-bde, for the data directory's own drive.
  const calls: ProbeCall[] = [];
  assert.deepEqual(await at('win32', { 'powershell.exe': 'On\r\n' }, {}, '', calls), { disk: 'encrypted', platform: 'windows', keyring: 'safe' });
  assert.deepEqual(calls[0]!.args.at(-1), "(Get-BitLockerVolume -MountPoint 'D:').ProtectionStatus");
  assert.deepEqual((await at('win32', { 'powershell.exe': 'Off' })).disk, 'not-encrypted');
  assert.deepEqual((await at('win32', { 'powershell.exe': new Error('access denied'), 'manage-bde.exe': 'Volume D: [Data]\n    Protection Status:    Protection On\n' })).disk, 'encrypted');
  assert.deepEqual((await at('win32', { 'powershell.exe': 'hang', 'manage-bde.exe': '    Protection Status:    Protection Off\n' })).disk, 'not-encrypted');
  assert.deepEqual((await at('win32', { 'powershell.exe': '', 'manage-bde.exe': '    Schutzstatus:    Der Schutz ist aktiviert\n' })).disk, 'unknown');
  assert.deepEqual(await at('win32', {}), { disk: 'unknown', platform: 'windows', keyring: 'safe' });

  assert.deepEqual(await at('darwin', { fdesetup: 'FileVault is Off.\n' }), { disk: 'not-encrypted', platform: 'macos', keyring: 'safe' });
  assert.equal((await at('darwin', { fdesetup: 'hang' })).disk, 'unknown');
  assert.equal((await at('darwin', { fdesetup: 'Something else' })).disk, 'unknown');

  const tree = JSON.stringify({ blockdevices: [
    { type: 'part', mountpoint: '/boot', children: [{ type: 'disk', mountpoint: null }] },
    { type: 'lvm', mountpoint: '/', children: [{ type: 'crypt', mountpoint: null, children: [{ type: 'part', mountpoint: null }] }] },
    { type: 'part', mountpoint: '/home/synthetic/plain', children: [{ type: 'disk', mountpoint: null }] },
  ] });
  assert.deepEqual(await at('linux', { lsblk: tree }), { disk: 'encrypted', platform: 'linux', keyring: 'none' });
  assert.equal((await at('linux', { lsblk: tree }, {}, '/home/synthetic/plain/chausar')).disk, 'not-encrypted');
  assert.equal((await at('linux', { lsblk: tree }, { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1/bus' })).keyring, 'unknown');
  assert.equal((await at('linux', { lsblk: '{"blockdevices": "nope"}' })).disk, 'unknown');
  assert.equal((await at('linux', { lsblk: 'not json' })).disk, 'unknown');
  assert.equal((await at('linux', { lsblk: new Error('ENOENT') })).disk, 'unknown');
  assert.equal((await at('linux', { lsblk: 'hang' })).disk, 'unknown');
  assert.deepEqual(await at('freebsd', {}), { disk: 'unknown', platform: 'other', keyring: 'unknown' });

  // A tool that exits with an error is unknown too.
  const failing: DiskProbe = async () => ({ code: 1, stdout: 'FileVault is On.' });
  assert.equal((await diskCheck({ directory: '/x', platform: 'darwin', env: {}, probe: failing })).disk, 'unknown');
  assert.equal(bitLockerFromPowerShell(' On '), 'encrypted');
  assert.equal(bitLockerFromManageBde('Protection Status: Protection Off'), 'not-encrypted');
  assert.equal(fileVault('FileVault is On.'), 'encrypted');
  assert.equal(luksFromLsblk(JSON.stringify({ blockdevices: [] }), '/x'), 'unknown');
});
