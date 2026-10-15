import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { desktopSyncOptions } from '../runtime/core-sync-jobs/desktop-sync.ts';
import { deviceIdentity, readEnrolment, readPendingJoin, writePendingJoin } from '../runtime/core-sync-jobs/device-files.ts';

// Two engines on one machine stand in for two computers; they share a synthetic local folder. Nothing leaves the machine.
const passphrase = 'Synthetic two computer sync passphrase';
const code = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-devices-'));
  const engines = new Set<Engine>();
  t.after(async () => { for (const engine of engines) await engine.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const office = join(root, 'office'), laptop = join(root, 'laptop'), shared = join(root, 'shared');
  await mkdir(shared);
  let offsetMs = 0; const clock = () => new Date(Date.now() + offsetMs);
  async function start(directory: string, sync = true) {
    const options = sync ? await desktopSyncOptions(directory, false, clock) : undefined;
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(options ? { sync: options } : {}) });
    engines.add(engine); return engine;
  }
  async function restart(engine: Engine, directory: string, folder = 'main') {
    await engine.close(); engines.delete(engine);
    const next = await start(directory); await next.request('workspace.open', { folder, passphrase }); return next;
  }
  return { root, office, laptop, shared, start, restart, advance: (ms: number) => { offsetMs += ms; } };
}

test('a second computer joins through the shared folder, receives the pen, and the first becomes read only', async t => {
  const f = await fixture(t);
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Two Computers', passphrase, demo: false, pack: 'ecommerce' });
  // Before set-up there is no machine list and no pen.
  const before = await a.request('devices.list', {});
  assert.equal(before.devices.length, 0); assert.equal(before.configured, false); assert.equal(before.readOnly, false);
  await assert.rejects(a.request('sync.setup', { on: true }), code('DEVICE_NOT_ENROLLED'));

  const setUp = await a.request('sync.setup', { transport: 'folder', folder: f.shared, deviceName: 'Office desk' });
  assert.equal(setUp.restartRequired, true); assert.equal(setUp.devices.length, 1); assert.equal(setUp.devices[0].holdsPen, true);
  assert.equal(setUp.syncOn, false, 'sync stays off until the owner turns it on');
  assert.deepEqual((await readdir(f.shared)).sort(), ['devices', 'store']);
  const key = await stat(join(f.office, '.chausar-device', 'signing-key.pem'));
  if (process.platform !== 'win32') assert.equal(key.mode & 0o077, 0, 'the signing key is readable by this user only');
  await assert.rejects(a.request('sync.setup', { on: true }), code('SYNC_RESTART_REQUIRED'));

  a = await f.restart(a, f.office);
  const officeId = (await deviceIdentity(f.office))!.identity.deviceId;
  let pen = await a.request('devices.pen', {});
  assert.equal(pen.configured, true); assert.equal(pen.thisComputerHolds, true); assert.equal(pen.readOnly, false); assert.equal(pen.holder.id, officeId);
  await a.request('trust.update', { retentionDays: 120 }); // the pen holder writes as before
  await assert.rejects(a.request('sync.writer.review', { expectedFence: 1, expectedStateDigest: 'a'.repeat(64), deviceId: officeId, memberId: 'owner', epoch: 1, expiresAt: new Date(Date.now() + 60000).toISOString(), reason: 'x' }), code('SYNC_PEN_MANAGED'));
  const on = await a.request('sync.setup', { on: true }); assert.equal(on.syncOn, true);

  // FR-14 on the new computer: no workspace is open yet.
  let b = await f.start(f.laptop, false);
  await assert.rejects(b.request('devices.join', { step: 'request', folder: join(f.root, 'nowhere') }), code('DEVICE_FOLDER_UNAVAILABLE'));
  const asked = await b.request('devices.join', { step: 'request', folder: f.shared, deviceName: 'Laptop' });
  assert.match(asked.code, /^\d{6}$/); assert.equal(asked.state, 'waiting');
  assert.equal((await b.request('devices.join', { step: 'finish' })).state, 'waiting');

  // On the computer already in: the same code, compared, then approved.
  const waiting = await a.request('seats.inviteVerify', {});
  assert.equal(waiting.requests.length, 1); assert.equal(waiting.requests[0].code, asked.code); assert.equal(waiting.requests[0].name, 'Laptop');
  const wrong = asked.code === '000000' ? '000001' : '000000';
  await assert.rejects(a.request('seats.inviteVerify', { requestId: asked.requestId, code: wrong, approve: true }), code('DEVICE_JOIN_CODE_MISMATCH'));
  const approved = await a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true });
  assert.equal(approved.approved, true);
  assert.equal((await a.request('seats.inviteVerify', {})).requests.length, 0, 'a used request is no longer offered');

  const ready = await b.request('devices.join', { step: 'finish' });
  assert.equal(ready.state, 'ready');
  const enrolment = await readEnrolment(f.laptop); assert.equal(enrolment?.syncOn, true);
  await b.request('workspace.restore', { backupFile: ready.backupFile, passphrase, folder: 'main' });
  b = await f.restart(b, f.laptop);
  const laptopId = (await deviceIdentity(f.laptop))!.identity.deviceId;
  const onLaptop = await b.request('devices.list', {});
  assert.equal(onLaptop.readOnly, true); assert.equal(onLaptop.pen.holder.id, officeId);
  assert.deepEqual(onLaptop.devices.map((d: any) => [d.name, d.thisComputer, d.holdsPen]).sort(), [['Laptop', true, false], ['Office desk', false, true]]);
  await assert.rejects(b.request('trust.update', { retentionDays: 30 }), code('SYNC_READ_ONLY_DEVICE'));
  await assert.rejects(b.request('devices.handOver', { toDeviceId: officeId, confirm: true }), code('SYNC_READ_ONLY_DEVICE'));

  // Hand over the pen: the office computer becomes read only, and the laptop takes over after reading the folder.
  await assert.rejects(a.request('devices.handOver', { toDeviceId: laptopId }), code('CONFIRMATION_REQUIRED'));
  const handed = await a.request('devices.handOver', { toDeviceId: laptopId, confirm: true });
  assert.equal(handed.published, true); assert.equal(handed.thisComputerHolds, false); assert.deepEqual(handed.handOver, { to: laptopId, published: true });
  await assert.rejects(a.request('trust.update', { retentionDays: 60 }), code('SYNC_READ_ONLY_DEVICE'));

  const read = await b.request('devices.read', { passphrase });
  assert.equal(read.upToDate, false); assert.match(read.folder, /^synced-\d+-[a-f0-9]{8}$/);
  b = await f.restart(b, f.laptop, read.folder);
  pen = await b.request('devices.pen', {});
  assert.equal(pen.thisComputerHolds, true); assert.equal(pen.kind, 'hand-over');
  await b.request('trust.update', { retentionDays: 45 });
  assert.equal((await b.request('devices.read', { passphrase })).upToDate, true);
  const seen = await a.request('devices.list', {});
  assert.ok(seen.devices.find((d: any) => d.id === laptopId).lastReadAt, 'the office computer sees when the laptop last read the folder');

  // Removing: never the pen holder, never this computer; the key does not change.
  await assert.rejects(b.request('devices.remove', { deviceId: laptopId, confirm: true }), code('DEVICE_IS_THIS_COMPUTER'));
  const removed = await b.request('devices.remove', { deviceId: officeId, confirm: true });
  assert.deepEqual(removed, { removed: true, deviceId: officeId, keyChanged: false, keyChange: 'VAULT_REKEY_NOT_BUILT', copiesStay: true });
  const after = await b.request('devices.list', {});
  assert.equal(after.devices.find((d: any) => d.id === officeId).state, 'removed');
  await assert.rejects(b.request('devices.handOver', { toDeviceId: officeId, confirm: true }), code('DEVICE_NOT_FOUND'));
});

test('a computer that is not in cannot take part, and joining refuses bad input', async t => {
  const f = await fixture(t);
  const a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Join Refusals', passphrase, demo: false, pack: 'ecommerce' });
  await assert.rejects(a.request('sync.setup', { transport: 'folder', folder: 'relative/path' }), code('INVALID_DEVICE_REQUEST'));
  await assert.rejects(a.request('sync.setup', { transport: 'carrier-pigeon' }), code('INVALID_DEVICE_REQUEST'));
  await assert.rejects(a.request('devices.handOver', { toDeviceId: 'device_x', confirm: true }), code('SYNC_RESTART_REQUIRED'));
  const b = await f.start(f.laptop, false);
  // The folder was never set up by a computer that is in.
  await assert.rejects(b.request('devices.join', { step: 'request', folder: f.shared }), code('DEVICE_FOLDER_NOT_SET_UP'));
  await assert.rejects(b.request('devices.join', { step: 'finish' }), code('DEVICE_JOIN_NOT_STARTED'));
  await assert.rejects(b.request('devices.join', { step: 'fly' }), code('INVALID_DEVICE_REQUEST'));
  const phone: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'phone' };
  await assert.rejects(b.requestAs(phone, 'devices.join', { step: 'request', folder: f.shared }), code('OPEN_DESKTOP'));
  // A folder holding something else is refused.
  await mkdir(join(f.shared, 'store'), { recursive: true }); await mkdir(join(f.shared, 'store', 'other'));
  await assert.rejects(a.request('sync.setup', { transport: 'folder', folder: f.shared }), code('DEVICE_FOLDER_IN_USE'));
});

test('a refused request ends the join on the new computer', async t => {
  const f = await fixture(t);
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Refused Join', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'folder', folder: f.shared });
  a = await f.restart(a, f.office);
  const b = await f.start(f.laptop, false);
  const asked = await b.request('devices.join', { step: 'request', folder: f.shared });
  // Approving needs sync on.
  await assert.rejects(a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true }), code('SYNC_OFF'));
  assert.deepEqual(await a.request('seats.inviteVerify', { requestId: asked.requestId, approve: false }), { refused: true, requestId: asked.requestId });
  assert.equal((await b.request('devices.join', { step: 'finish' })).state, 'refused');
  await assert.rejects(b.request('devices.join', { step: 'finish' }), code('DEVICE_JOIN_NOT_STARTED'));
  assert.equal((await a.request('seats.inviteVerify', {})).requests.length, 0);
});

test('an enrolled computer without a pen in its copy and an older copy stay read only', async t => {
  const f = await fixture(t);
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Stale Copy', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'folder', folder: f.shared, deviceName: 'Office desk' });
  const backup = await a.request('workspace.backup', {});
  a = await f.restart(a, f.office);
  await a.request('sync.setup', { on: true });
  const laptop = await f.start(f.laptop, false);
  const asked = await laptop.request('devices.join', { step: 'request', folder: f.shared });
  await a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true });
  const laptopId = (await deviceIdentity(f.laptop))!.identity.deviceId;
  await a.request('devices.handOver', { toDeviceId: laptopId, confirm: true });
  // The office computer restores its own older backup, in which it still held the pen: the floor keeps it read only.
  const name = backup.path.split(/[\\/]/).at(-1);
  await a.request('workspace.lock', {});
  await a.request('workspace.restore', { backupFile: name, passphrase, folder: 'older' });
  const pen = await a.request('devices.pen', {});
  assert.equal(pen.holder.name, 'Office desk'); assert.equal(pen.thisComputerHolds, false); assert.equal(pen.readOnly, true);
  await assert.rejects(a.request('trust.update', { retentionDays: 10 }), code('SYNC_PEN_STALE_COPY'));
});

test('taking the pen when its holder cannot be reached is experimental and signed by the taker', async t => {
  const f = await fixture(t);
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Take Over', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'folder', folder: f.shared, deviceName: 'Office desk' });
  a = await f.restart(a, f.office); await a.request('sync.setup', { on: true });
  await assert.rejects(a.request('devices.takePen', { confirm: true }), code('PEN_ALREADY_HELD'));
  let b = await f.start(f.laptop, false);
  const asked = await b.request('devices.join', { step: 'request', folder: f.shared, deviceName: 'Laptop' });
  await a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true });
  const ready = await b.request('devices.join', { step: 'finish' });
  await b.request('workspace.restore', { backupFile: ready.backupFile, passphrase, folder: 'main' });
  b = await f.restart(b, f.laptop);
  await assert.rejects(b.request('devices.takePen', {}), code('CONFIRMATION_REQUIRED'));
  const taken = await b.request('devices.takePen', { confirm: true });
  assert.equal(taken.thisComputerHolds, true); assert.equal(taken.kind, 'take-over'); assert.equal(taken.experimental, true); assert.equal(taken.lateChanges, 'settle-by-hand');
  await b.request('trust.update', { retentionDays: 33 });
});

test('a join request that nobody approved in time expires on the new computer', async t => {
  const f = await fixture(t);
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Expired Join', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'folder', folder: f.shared });
  const b = await f.start(f.laptop, false);
  await b.request('devices.join', { step: 'request', folder: f.shared });
  const pending = (await readPendingJoin(f.laptop))!;
  await writePendingJoin(f.laptop, { ...pending, expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal((await b.request('devices.join', { step: 'finish' })).state, 'expired');
  assert.equal(await readPendingJoin(f.laptop), null);
});

test('the installed app gets sync options only on an enrolled computer, never in demo', async t => {
  const f = await fixture(t);
  assert.equal(await desktopSyncOptions(f.office, false), undefined, 'no enrolment: the app starts as before');
  const a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Worker Options', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'drive', deviceName: 'Office desk' });
  assert.equal(await desktopSyncOptions(f.office, true), undefined, 'demo never syncs');
  const options = (await desktopSyncOptions(f.office, false))!;
  assert.equal(options.enabled, false); assert.equal(options.transport, undefined, 'Drive is attached later by hosted-link');
  assert.equal(options.deviceId, (await deviceIdentity(f.office))!.identity.deviceId); assert.equal(options.signerId, options.deviceId);
  assert.equal(options.writerAdmission?.workspaceId, a.vault!.read().workspace.id); assert.equal(options.writerAdmission?.vaultId, a.vault!.vaultId);
});

test('a reader trusts a machine that joined after its copy, through the approver\'s signed acceptance', async t => {
  const f = await fixture(t), third = join(f.root, 'third');
  let a = await f.start(f.office, false);
  await a.request('workspace.create', { name: 'Synthetic Three Computers', passphrase, demo: false, pack: 'ecommerce' });
  await a.request('sync.setup', { transport: 'folder', folder: f.shared, deviceName: 'Office desk' });
  a = await f.restart(a, f.office); await a.request('sync.setup', { on: true });
  async function join_(directory: string, name: string) {
    let engine = await f.start(directory, false);
    const asked = await engine.request('devices.join', { step: 'request', folder: f.shared, deviceName: name });
    await a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true });
    const ready = await engine.request('devices.join', { step: 'finish' });
    await engine.request('workspace.restore', { backupFile: ready.backupFile, passphrase, folder: 'main' });
    engine = await f.restart(engine, directory);
    return { engine, id: (await deviceIdentity(directory))!.identity.deviceId };
  }
  const b = await join_(f.laptop, 'Laptop');           // B's copy knows the office and the laptop only
  let c = await join_(third, 'Shop counter');
  await a.request('devices.handOver', { toDeviceId: c.id, confirm: true });
  const read = await c.engine.request('devices.read', { passphrase });
  c.engine = await f.restart(c.engine, third, read.folder);
  await c.engine.request('trust.update', { retentionDays: 77 });
  await assert.rejects(c.engine.request('devices.send', { confirm: true }), code('SYNC_LEASE_WAIT'));
  f.advance(61_000); // the office computer's publication lease runs out
  await assert.rejects(b.engine.request('devices.send', { confirm: true }), code('SYNC_READ_ONLY_DEVICE'));
  const sent = await c.engine.request('devices.send', { confirm: true }); assert.equal(sent.sent, true);
  const caught = await b.engine.request('devices.read', { passphrase });
  assert.equal(caught.upToDate, false, 'the laptop reads the copy the shop counter signed');
  const opened = await f.restart(b.engine, f.laptop, caught.folder);
  assert.equal((await opened.request('devices.pen', {})).holder.name, 'Shop counter');
});
