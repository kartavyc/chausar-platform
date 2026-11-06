// C5 tasks 19 to 23, through the real Engine with file storage and a memory key store: the store-size meter, backups
// labelled by what happened, importing an exported copy, the readable-copy note, and backups copied to a drive or folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { CustodyFiles } from '../runtime/workspace-custody.ts';
import { memoryDeviceKeyStore, type DeviceKeyStore } from '../runtime/device-custody.ts';
import { ventureAction, currentVenture } from '../runtime/venture/records.ts';
import { recordDecision } from '../runtime/venture/journal/decisions.ts';

const PASSPHRASE = 'a long owner passphrase here';
const HOUR = 3_600_000;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
type Clock = { now: number };

async function folder(t: any, prefix = 'chausar-c5-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function engineAt(t: any, directory: string, options: { keys?: DeviceKeyStore; clock?: Clock } = {}) {
  const clock = options.clock;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    workspaceCustody: { deviceKeys: options.keys ?? memoryDeviceKeyStore(), autoBackups: true, ...(clock ? { clock: () => clock.now } : {}) } });
  t.after(() => engine.close().catch(() => {}));
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask };
}
async function allFiles(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await allFiles(path)); else out.push(path);
  }
  return out;
}

// ------------------------------------------------------------------ task 19

test('task 19: custody says how big the business is and the ceiling', async t => {
  const { engine, ask } = engineAt(t, await folder(t));
  await ask('workspace.create', { name: 'Meter Shop', pack: 'services', folder: null });
  const business = (await ask('workspace.custody.get')).business;
  assert.equal(business.storeLimit, 32 * 1024 * 1024);
  assert.equal(business.storeBytes, Buffer.byteLength(JSON.stringify(engine.vault!.read())));
  await ask('trust.update', { retentionDays: 40 });
  const after = (await ask('workspace.custody.get')).business;
  assert.equal(after.storeBytes, Buffer.byteLength(JSON.stringify(engine.vault!.read())));
});

// ------------------------------------------------------------------ task 20

test('task 20: each backup says what came just before it while the business is open; locked it says nothing, and nothing about it is on disk', async t => {
  const directory = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = engineAt(t, directory, { clock });
  await ask('workspace.create', { name: 'Label Shop', pack: 'services', folder: null, passphrase: PASSPHRASE });
  const quiet = await ask('workspace.backups.create');
  assert.equal(quiet.after, undefined, 'nothing has happened yet');

  // A decision on the record, naming a client, the way the app writes one.
  clock.now += 1000;
  await seedVentureDecision(engine, 'You drafted the Bakery Rosetta reply', clock);
  clock.now += HOUR;
  const labelled = await ask('workspace.backups.create');
  assert.equal(labelled.after, 'you decided: You drafted the Bakery Rosetta reply');
  const listed = await ask('workspace.backups.list');
  assert.equal(listed.backups.find((item: any) => item.file === labelled.file).after, labelled.after);
  assert.equal(listed.backups.find((item: any) => item.file === quiet.file).after, undefined, 'a backup older than the decision does not name it');

  await ask('workspace.lock');
  const locked = await ask('workspace.backups.list');
  assert.ok(locked.backups.length >= 2);
  for (const backup of locked.backups) assert.equal(backup.after, undefined);
  for (const path of await allFiles(directory)) {
    if (/authority|\.backup$|\.vault$/.test(path)) continue;
    assert.ok(!(await readFile(path, 'utf8').catch(() => '')).includes('Rosetta'), `${path} holds a business word`);
  }
});

/** Puts a venture on the vault with one recorded decision. */
async function seedVentureDecision(engine: Engine, reason: string, clock: Clock) {
  const deps: any = { store: engine.vault, clock: () => new Date(clock.now), publish: () => {}, host: 'test', demo: true };
  const member = engine.vault!.read().members[0] as any;
  const ctx: any = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  await ventureAction(deps, ctx, 'admin', 'seed.venture', (tx: any) => tx.put({
    ...tx.base('venture-record'), idea: 'Books for bakeries.', ideaDigest: 'd', workingName: 'Label Shop', country: { code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india', tax: {}, paymentRails: [], dateOrder: 'day-month-year', complianceNotes: [] },
    serviceType: 'bookkeeping', status: 'blueprint', launchStage: 'rehearsal', blueprintId: null, acceptedBlueprintId: null, playbookId: null, invoiceSequence: 0, updatedAt: tx.now,
  }), { create: true });
  assert.ok(currentVenture(engine.vault!.read()));
  await ventureAction(deps, ctx, 'prepare', 'seed.decision', (tx: any) => recordDecision(tx, { subject: 'test', action: 'test', ruleId: null, rowId: null, reason }));
}

// ------------------------------------------------------------------ task 21

async function exportedBusiness(t: any, directory: string, keys: DeviceKeyStore) {
  const { ask } = engineAt(t, directory, { keys });
  const created = await ask('workspace.create', { name: 'Copy Shop', pack: 'services', folder: null, passphrase: PASSPHRASE });
  await ask('trust.update', { retentionDays: 45 });
  const encrypted = await ask('workspace.export', { confirmed: true });
  const readable = await ask('workspace.export', { confirmed: true, plaintext: true });
  return { ask, created, encrypted, readable };
}

test('task 21: export, delete, import: the business opens with its records; a tampered byte and a readable copy are refused', async t => {
  const directory = await folder(t), elsewhere = await folder(t), keys = memoryDeviceKeyStore();
  const { ask, encrypted, readable } = await exportedBusiness(t, directory, keys);
  const copyPath = join(elsewhere, 'my-copy.vault');
  await writeFile(copyPath, await readFile(encrypted.path));
  const readablePath = join(elsewhere, 'readable.json');
  await writeFile(readablePath, await readFile(readable.path));
  await ask('workspace.delete', { confirmation: 'Copy Shop' });
  assert.deepEqual((await ask('workspace.list')).businesses, []);

  await assert.rejects(ask('workspace.import', { file: readablePath }), (error: any) => {
    assert.equal(error.code, 'IMPORT_READABLE');
    assert.equal(error.message, "A readable copy can't come back in, since anyone could have changed it. Use the encrypted copy.");
    return true;
  });
  await assert.rejects(ask('workspace.import', { file: 'relative.vault' }), code('INVALID_PATH'));
  const notOurs = join(elsewhere, 'other.vault');
  await writeFile(notOurs, '{"hello":"world"}');
  await assert.rejects(ask('workspace.import', { file: notOurs }), code('IMPORT_INVALID'));

  await assert.rejects(ask('workspace.import', { file: copyPath }), code('PASSPHRASE_REQUIRED'));
  await assert.rejects(ask('workspace.import', { file: copyPath, passphrase: 'a wrong passphrase for it' }), code('UNLOCK_FAILED'));

  const original = JSON.parse(await readFile(copyPath, 'utf8'));
  const tamperedPath = join(elsewhere, 'tampered.vault');
  const data: string = original.envelope.snapshot.data ?? original.envelope.snapshot.ciphertext;
  const flipped = { ...original, envelope: { ...original.envelope, snapshot: { ...original.envelope.snapshot, ...(original.envelope.snapshot.data ? { data: `${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}` } : { ciphertext: `${data[0] === 'A' ? 'B' : 'A'}${data.slice(1)}` }) } } };
  await writeFile(tamperedPath, JSON.stringify(flipped));
  await assert.rejects(ask('workspace.import', { file: tamperedPath, passphrase: PASSPHRASE }), (error: any) => { assert.ok(['UNLOCK_FAILED', 'IMPORT_INVALID'].includes(error.code), error.code); return true; });
  assert.deepEqual((await ask('workspace.list')).businesses, [], 'a refused copy leaves nothing behind');

  const opened = await ask('workspace.import', { file: copyPath, passphrase: PASSPHRASE });
  assert.equal(opened.workspace.name, 'Copy Shop');
  assert.equal(opened.unlock, 'passphrase');
  assert.equal((await ask('workspace.list')).businesses.length, 1);
});

test('task 21: a copy of a business already here offers restore, which makes a safety copy first; from Welcome it opens the business too', async t => {
  const directory = await folder(t), elsewhere = await folder(t), keys = memoryDeviceKeyStore();
  const { ask, encrypted } = await exportedBusiness(t, directory, keys);
  const copyPath = join(elsewhere, 'my-copy.vault');
  await writeFile(copyPath, await readFile(encrypted.path));
  await ask('trust.update', { retentionDays: 90 });

  await assert.rejects(ask('workspace.import', { file: copyPath }), (error: any) => {
    assert.equal(error.code, 'IMPORT_ALREADY_HERE');
    assert.equal(error.message, 'This business is already on this computer. Restore it from this copy instead?');
    return true;
  });
  const before = (await readdir(join(directory, 'backups')).catch(() => [])).filter(name => name.endsWith('-safety.backup')).length;
  const restored = await ask('workspace.import', { file: copyPath, restore: true });
  assert.equal(restored.workspace.name, 'Copy Shop');
  assert.equal((await readdir(join(directory, 'backups'))).filter(name => name.endsWith('-safety.backup')).length, before + 1, 'a safety copy first');

  // From Welcome back: it opens the business, then does the same.
  await ask('workspace.lock');
  await assert.rejects(ask('workspace.import', { file: copyPath }), code('IMPORT_ALREADY_HERE'));
  await assert.rejects(ask('workspace.import', { file: copyPath, restore: true }), code('PASSPHRASE_REQUIRED'));
  const again = await ask('workspace.import', { file: copyPath, restore: true, passphrase: PASSPHRASE });
  assert.equal(again.workspace.name, 'Copy Shop');
  assert.equal(again.folder, 'copy-shop');
});

test('task 21: inside another business the copy waits until that one is closed; a recovery code brings it onto this computer', async t => {
  const first = await folder(t), elsewhere = await folder(t);
  const source = engineAt(t, first);
  const made = await source.ask('workspace.create', { name: 'Other Shop', pack: 'services', folder: null });
  const coded = await source.ask('workspace.custody.recoveryCode');
  const encrypted = await source.ask('workspace.export', { confirmed: true });
  const copyPath = join(elsewhere, 'copy.vault');
  await writeFile(copyPath, await readFile(encrypted.path));
  void made;

  const second = await folder(t);
  const { ask } = engineAt(t, second);
  await ask('workspace.create', { name: 'Open Shop', pack: 'services', folder: null });
  await assert.rejects(ask('workspace.import', { file: copyPath, recoveryCode: coded.recoveryCode }), code('IMPORT_CLOSE_FIRST'));
  await ask('workspace.lock');
  const opened = await ask('workspace.import', { file: copyPath, recoveryCode: coded.recoveryCode });
  assert.equal(opened.workspace.name, 'Other Shop');
  assert.equal(opened.unlock, 'this-computer');
  await ask('workspace.lock');
  assert.equal((await ask('workspace.list')).businesses.find((item: any) => item.name === 'Other Shop').opens, 'with-this-computer');
});

// ------------------------------------------------------------------ task 22

test('task 22: a readable export notes kind and time only; Delete removes exactly that file and Keep it dismisses it for good', async t => {
  const directory = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = engineAt(t, directory, { clock });
  void engine;
  const created = await ask('workspace.create', { name: 'Readable Rosetta Shop', pack: 'services', folder: null });
  await ask('workspace.export', { confirmed: true });
  const first = await ask('workspace.export', { confirmed: true, plaintext: true });
  clock.now += 1000;
  const second = await ask('workspace.export', { confirmed: true, plaintext: true });
  const custody = new CustodyFiles(directory), id = created.workspace.id;
  const port = { readableExports: () => custody.readableExports(id), keepReadable: (file: string) => custody.keepReadable(file), deleteReadable: (file: string) => custody.deleteReadable(file) };
  const notes = JSON.parse(await readFile(join(directory, 'custody', 'exports.json'), 'utf8'));
  assert.deepEqual(notes.readable.map((note: any) => Object.keys(note).sort()), [['at', 'file', 'kept'], ['at', 'file', 'kept']]);
  assert.ok(!JSON.stringify(notes).includes('Rosetta'), 'no business words beside the vault');
  const names = (await port.readableExports()).map((item: any) => item.file);
  assert.deepEqual(names, [first.path, second.path].map((path: string) => path.split(/[\\/]/).pop()));
  await port.keepReadable(names[0]!);
  assert.deepEqual((await port.readableExports()).map((item: any) => item.file), [names[1]!]);
  await port.deleteReadable(names[1]!);
  assert.deepEqual(await port.readableExports(), []);
  assert.ok(!(await readdir(join(directory, 'exports'))).includes(names[1]!));
  assert.ok((await readdir(join(directory, 'exports'))).includes(names[0]!), 'Keep it leaves the file');
  await assert.rejects(port.deleteReadable('chausar-other-1.json'), code('EXPORT_NOT_FOUND'));
  // A file gone by itself drops its row quietly.
  const third = await ask('workspace.export', { confirmed: true, plaintext: true });
  await rm(third.path);
  assert.deepEqual(await port.readableExports(), []);
});

// ------------------------------------------------------------------ task 23

test('task 23: after an automatic backup the newest goes to the chosen folder, ciphertext only, keeping 5; a missing folder says so and the next tick copies', async t => {
  const directory = await folder(t), drive = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') }, keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys, clock });
  await ask('workspace.create', { name: 'Drive Rosetta Shop', pack: 'services', folder: null });
  assert.equal((await ask('workspace.custody.get')).business.backups.copy, null);
  await assert.rejects(ask('workspace.backups.copyTo', { folder: 'relative/path', confirmed: true }), code('INVALID_PATH'));
  await assert.rejects(ask('workspace.backups.copyTo', { folder: drive }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(ask('workspace.backups.copyTo', { folder: join(directory, 'backups'), confirmed: true }), code('INVALID_PATH'));
  const set = await ask('workspace.backups.copyTo', { folder: drive, confirmed: true });
  assert.equal(set.copy.folderName, drive.split(/[\\/]/).pop());
  assert.equal(JSON.stringify(set).includes(directory), false, 'the view never names this computer\'s paths beyond the folder name');

  await engine.tick();
  let copied = await readdir(drive);
  assert.equal(copied.length, 1);
  assert.match(copied[0], /-auto\.backup$/);
  const text = await readFile(join(drive, copied[0]), 'utf8');
  assert.equal(JSON.parse(text).backupFormat, 'chausar.backup.v1');
  assert.ok(!text.includes('Rosetta'), 'only ciphertext lands there');
  let view = (await ask('workspace.custody.get')).business.backups.copy;
  assert.equal(view.problem, null);
  assert.equal(view.lastCopiedAt, new Date(clock.now).toISOString());

  // The drive unplugged: the problem in words, then the next tick copies.
  await rm(drive, { recursive: true, force: true });
  await ask('trust.update', { retentionDays: 30 });
  clock.now += AUTO_GAP; await engine.tick();
  view = (await ask('workspace.custody.get')).business.backups.copy;
  assert.equal(view.problem, "The drive isn't plugged in. The next copy goes when it is.");
  await mkdir(drive);
  await writeFile(join(drive, 'owner-notes.txt'), 'mine');
  clock.now += 1000; await engine.tick();
  view = (await ask('workspace.custody.get')).business.backups.copy;
  assert.equal(view.problem, null);
  assert.equal((await readdir(drive)).filter(name => name.endsWith('.backup')).length, 1);

  // Rotation keeps the newest 5 of this business and touches nothing else.
  await writeFile(join(drive, 'chausar-someone-else-1-auto.backup'), 'x');
  for (let i = 0; i < 7; i++) {
    await ask('trust.update', { retentionDays: 31 + i });
    clock.now += AUTO_GAP; await engine.tick();
  }
  copied = await readdir(drive);
  assert.equal(copied.filter(name => name.endsWith('.backup') && !name.includes('someone-else')).length, 5);
  assert.ok(copied.includes('owner-notes.txt'));
  assert.ok(copied.includes('chausar-someone-else-1-auto.backup'));

  // The setting stays with the business across closing and opening.
  await ask('workspace.lock');
  await ask('workspace.open', { folder: 'drive-rosetta-shop' });
  assert.equal((await ask('workspace.custody.get')).business.backups.copy.folderName, drive.split(/[\\/]/).pop());

  // Turned off: no more copies.
  const off = await ask('workspace.backups.copyTo', { folder: null, confirmed: true });
  assert.equal(off.copy, null);
});

const AUTO_GAP = 3 * 60_000;

test('task 23: the copy on the drive opens on another computer with the recovery code', async t => {
  const directory = await folder(t), drive = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = engineAt(t, directory, { clock });
  await ask('workspace.create', { name: 'Far Shop', pack: 'services', folder: null });
  const coded = await ask('workspace.custody.recoveryCode');
  await ask('workspace.backups.copyTo', { folder: drive, confirmed: true });
  await engine.tick();
  clock.now += HOUR;
  const [name] = await readdir(drive);
  assert.ok(name);

  const fresh = engineAt(t, await folder(t));
  const opened = await fresh.ask('workspace.import', { file: join(drive, name), recoveryCode: coded.recoveryCode });
  assert.equal(opened.workspace.name, 'Far Shop');
});
