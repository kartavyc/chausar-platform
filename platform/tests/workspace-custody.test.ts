// Keeping the vault key on this computer, the business list, automatic backups and moving a business,
// through the real Engine with experimental file storage and a temp folder (KEYCHAIN-SPEC 13.1).
// The key store is an injected memory store (two instances are two computers). The checks against this computer's
// real key store (Windows DPAPI) are a qualification run, qualification/device-keys-real.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { Vault, wrappersDigestOf } from '../runtime/vault.ts';
import { memoryDeviceKeyStore, type DeviceKeyStore } from '../runtime/device-custody.ts';
import { AUTO_BACKUP, CUSTODY_WORDS, TRANSFER } from '../runtime/workspace-custody-contracts.ts';
import { keepBackups, makeTransferCode, normalizeTransferCode, parseBackupName, slugFolder } from '../runtime/workspace-custody.ts';
import { createReplayTransport } from '../runtime/venture/models/index.ts';
import type { ModelPreset, ModelReplayFixture } from '../runtime/venture/contracts.ts';
import type { AiOptionsView, ComposeDecision, ComposedPlan } from '../runtime/venture/onboarding-contracts.ts';

const PASSPHRASE = 'a long owner passphrase here';
const OTHER = 'another long owner passphrase';
const HOUR = 3_600_000;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.stack ?? error?.message); return true; };
type Clock = { now: number };

/** A memory store that also remembers every secret it was handed, so the secrets scan can look for them. */
function spyStore(inner = memoryDeviceKeyStore()) {
  const secrets: string[] = []; let failUnprotect = false;
  const store: DeviceKeyStore & { items(): number } = {
    scheme: inner.scheme, items: inner.items, probe: inner.probe, forget: inner.forget,
    protect: async (vaultId, secret) => { secrets.push(secret.toString('base64url')); return inner.protect(vaultId, secret); },
    unprotect: async record => failUnprotect ? null : inner.unprotect(record),
  };
  return { store, secrets, failOpens(value: boolean) { failUnprotect = value; } };
}
async function folder(t: any, prefix = 'chausar-custody-') {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function engineAt(t: any, directory: string, options: { keys?: DeviceKeyStore | 'none' | 'os' | null; clock?: Clock; venture?: any } = {}) {
  const clock = options.clock;
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file',
    ...(options.keys === null ? {} : { workspaceCustody: { deviceKeys: options.keys ?? memoryDeviceKeyStore(), autoBackups: true, ...(clock ? { clock: () => clock.now } : {}) } }),
    ...(options.venture ? { venture: options.venture } : {}) });
  t.after(() => engine.close().catch(() => {}));
  const ask = (method: string, payload: Record<string, unknown> = {}): Promise<any> => engine.request(method, payload);
  return { engine, ask };
}
async function files(directory: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...await files(path)); else out.push(path);
  }
  return out;
}
const backupsOf = async (directory: string) => (await readdir(join(directory, 'backups')).catch(() => [] as string[])).sort();

test('create without a passphrase: this computer keeps the key, the folder is named from the business, it reopens with no typing', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { ask } = engineAt(t, directory, { keys });
  const created = await ask('workspace.create', { name: 'Night Shift Walkers', pack: 'services', folder: null });
  assert.deepEqual([created.unlock, created.recoveryCode, created.recoveryKit, created.folder, created.experimental], ['this-computer', null, null, 'night-shift-walkers', true]);
  assert.equal(created.workspace.name, 'Night Shift Walkers');
  const card = JSON.parse(await readFile(join(directory, 'custody', 'cards', 'night-shift-walkers.json'), 'utf8'));
  assert.deepEqual([card.format, card.state, card.unlock, card.recovery, card.pending, card.name], ['chausar.vault-card.v1', 'ready', 'this-computer', 'not-made', null, 'Night Shift Walkers']);
  const record = JSON.parse(await readFile(join(directory, 'custody', 'keys', `${card.vaultId}.json`), 'utf8'));
  assert.deepEqual([record.format, record.scheme, record.vaultId], ['chausar.device-key.v1', 'memory', card.vaultId]);
  assert.equal(keys.items(), 1);
  assert.deepEqual(await ask('workspace.status').then(status => [status.unlock, status.closedByOwner]), ['this-computer', false]);

  await ask('workspace.lock');
  assert.equal((await ask('workspace.status')).closedByOwner, true);
  const second = await ask('workspace.create', { name: 'Night Shift Walkers', pack: 'services', folder: null });
  assert.equal(second.folder, 'night-shift-walkers-2', 'the same name gets -2');
  await ask('workspace.lock');

  const opened = await ask('workspace.open', { folder: 'night-shift-walkers' });
  assert.equal(opened.workspace.name, 'Night Shift Walkers');
  assert.equal((await ask('workspace.status')).closedByOwner, false);
  await ask('workspace.lock');
  const list = await ask('workspace.list');
  assert.equal(list.complete, true);
  assert.deepEqual(list.businesses.map((row: any) => [row.folder, row.name, row.opens, row.unlock, row.recovery, row.listedFrom]), [
    ['night-shift-walkers', 'Night Shift Walkers', 'with-this-computer', 'this-computer', 'not-made', 'card'],
    ['night-shift-walkers-2', 'Night Shift Walkers', 'with-this-computer', 'this-computer', 'not-made', 'card'],
  ]);
  await assert.rejects(ask('workspace.open', { folder: 'no-such-business' }), code('PASSPHRASE_REQUIRED'), 'no card and no envelope: it needs a passphrase');
  assert.deepEqual(slugFolder('  Café & Co!! ', []), 'caf-co');
  assert.equal(slugFolder('???', []), 'business');
  assert.equal(slugFolder('Backups', []), 'business', 'a reserved name is never a business folder');
});

test('with no protected storage: create without a passphrase says why in plain words; with a passphrase it works as today', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory, { keys: 'none' });
  await assert.rejects(ask('workspace.create', { name: 'Plain Bakers', pack: 'services', folder: null }), (error: any) =>
    error.code === 'DEVICE_KEYS_UNAVAILABLE' && error.reason === 'not-configured' && error.message === CUSTODY_WORDS.unavailable['not-configured']);
  assert.deepEqual(await readdir(directory), [], 'nothing written');
  const view = await ask('workspace.custody.get');
  assert.deepEqual([view.computer.available, view.computer.reason, view.computer.where, view.computer.checked, view.business], [false, 'not-configured', CUSTODY_WORDS.unavailable['not-configured'], false, null]);
  const created = await ask('workspace.create', { name: 'Plain Bakers', pack: 'services', folder: null, passphrase: PASSPHRASE });
  assert.equal(created.unlock, 'passphrase'); assert.match(created.recoveryCode, /^CHR-/);
  const card = JSON.parse(await readFile(join(directory, 'custody', 'cards', 'plain-bakers.json'), 'utf8'));
  assert.deepEqual([card.unlock, card.recovery], ['passphrase', 'made']);
  // Without workspaceCustody at all: today's behaviour, and no custody files.
  const bare = await folder(t), plain = engineAt(t, bare, { keys: null });
  await assert.rejects(plain.ask('workspace.create', { name: 'Old Shop', pack: 'services' }), (error: any) => error.code === 'DEVICE_KEYS_UNAVAILABLE' && error.reason === 'not-configured');
  await plain.ask('workspace.create', { name: 'Old Shop', pack: 'services', passphrase: PASSPHRASE });
  assert.deepEqual((await readdir(bare)).sort(), ['main']);
  assert.equal('closedByOwner' in await plain.ask('workspace.status'), false, 'the status shape is unchanged without custody');
});

test('an old passphrase vault is listed from its folder; opening it with the passphrase writes its card', async t => {
  const directory = await folder(t);
  const old = engineAt(t, directory, { keys: null });
  await old.ask('workspace.create', { name: 'Old Passphrase Shop', pack: 'services', passphrase: PASSPHRASE });
  await old.engine.close();
  const { ask } = engineAt(t, directory);
  const before = await ask('workspace.list');
  assert.deepEqual(before.businesses, [{ folder: 'main', name: null, demo: null, unlock: 'passphrase', opens: 'needs-passphrase', recovery: 'unknown', openedAt: null, listedFrom: 'folder' }]);
  await assert.rejects(ask('workspace.open', { folder: 'main' }), (error: any) => error.code === 'PASSPHRASE_REQUIRED' && error.message === CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED);
  await ask('workspace.open', { folder: 'main', passphrase: PASSPHRASE });
  await ask('workspace.lock');
  const after = await ask('workspace.list');
  assert.deepEqual(after.businesses.map((row: any) => [row.folder, row.name, row.unlock, row.opens, row.recovery, row.listedFrom]),
    [['main', 'Old Passphrase Shop', 'passphrase', 'needs-passphrase', 'made', 'card']]);
});

test('Lock with a passphrase: open needs it, the key is forgotten, a recovery code comes back once, old backups need the passphrase', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { ask } = engineAt(t, directory, { keys });
  const created = await ask('workspace.create', { name: 'Lock Me', pack: 'services', folder: null });
  const manual = await ask('workspace.backups.create');
  assert.deepEqual([manual.kind, manual.opensNow, manual.name], ['manual', true, 'Lock Me']);
  await assert.rejects(ask('workspace.custody.passphraseOn', { passphrase: 'short' }), code('WEAK_PASSPHRASE'));
  const on = await ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  assert.match(on.recoveryCode, /^CHR-[A-Za-z0-9_-]{43}$/);
  assert.deepEqual([on.custody.business.unlock, on.custody.business.recovery], ['passphrase', 'made']);
  assert.equal(keys.items(), 0, 'the computer key is forgotten');
  await assert.rejects(readFile(join(directory, 'custody', 'keys', `${JSON.parse(await readFile(join(directory, 'custody', 'cards', 'lock-me.json'), 'utf8')).vaultId}.json`)), (error: any) => error.code === 'ENOENT');
  const listed = (await ask('workspace.backups.list')).backups;
  assert.ok(listed.length >= 2 && listed.every((row: any) => row.opensNow), 'every managed backup was resealed');
  assert.ok(listed.some((row: any) => row.kind === 'safety'), 'a safety copy came first');
  await assert.rejects(ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE }), code('CUSTODY_UNCHANGED'));
  await ask('workspace.lock');
  await assert.rejects(ask('workspace.open', { folder: created.folder }), code('PASSPHRASE_REQUIRED'));
  assert.equal((await ask('workspace.list')).businesses[0].opens, 'needs-passphrase');
  await ask('workspace.open', { folder: created.folder, passphrase: PASSPHRASE });
  await ask('workspace.lock');
  await ask('workspace.recover', { folder: created.folder, recoveryCode: on.recoveryCode, passphrase: OTHER });
  await ask('workspace.lock');
  await assert.rejects(ask('workspace.restore', { backupFile: manual.file, folder: null }), code('PASSPHRASE_REQUIRED'));
  await assert.rejects(ask('workspace.restore', { backupFile: manual.file, folder: null, passphrase: PASSPHRASE }), code('UNLOCK_FAILED'));
  const restored = await ask('workspace.restore', { backupFile: manual.file, folder: null, passphrase: OTHER });
  assert.equal(restored.folder, 'lock-me-restored', 'the old backup was resealed to the newest passphrase');
});

test('Stop asking for the passphrase: a wrong one changes nothing; the right one goes back to this computer', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { ask } = engineAt(t, directory, { keys });
  await ask('workspace.create', { name: 'Toggle Shop', pack: 'services', folder: null, passphrase: PASSPHRASE });
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: OTHER }), (error: any) => error.code === 'PASSPHRASE_WRONG' && error.message === CUSTODY_WORDS.errors.PASSPHRASE_WRONG);
  assert.equal((await ask('workspace.custody.get')).business.unlock, 'passphrase');
  assert.equal(keys.items(), 0);
  const off = await ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE });
  assert.equal(off.custody.business.unlock, 'this-computer');
  assert.equal(keys.items(), 1);
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE }), code('CUSTODY_UNCHANGED'));
  await ask('workspace.lock');
  await ask('workspace.open', { folder: 'toggle-shop' });
  assert.equal((await ask('workspace.status')).unlock, 'this-computer');
});

test('Make a recovery code: the new code opens, the old one does not; with a passphrase it asks for it first', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory);
  await ask('workspace.create', { name: 'Code Shop', pack: 'services', folder: null });
  const first = await ask('workspace.custody.recoveryCode');
  assert.equal(first.custody.business.recovery, 'made');
  const second = await ask('workspace.custody.recoveryCode');
  assert.notEqual(first.recoveryCode, second.recoveryCode);
  await ask('workspace.lock');
  await assert.rejects(ask('workspace.recover', { folder: 'code-shop', recoveryCode: first.recoveryCode }), code('UNLOCK_FAILED'));
  await ask('workspace.recover', { folder: 'code-shop', recoveryCode: second.recoveryCode });
  assert.equal((await ask('workspace.status')).unlock, 'this-computer', 'recovering with no passphrase stays on this computer');
  await ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  await assert.rejects(ask('workspace.custody.recoveryCode'), code('PASSPHRASE_WRONG'));
  await assert.rejects(ask('workspace.custody.recoveryCode', { passphrase: OTHER }), code('PASSPHRASE_WRONG'));
  assert.match((await ask('workspace.custody.recoveryCode', { passphrase: PASSPHRASE })).recoveryCode, /^CHR-/);
});

test('automatic backups: on a schedule while changed, after important changes with bursts coalesced, on close; manual copies survive; delete removes it all', async t => {
  const directory = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') }, keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys, clock });
  const created = await ask('workspace.create', { name: 'Backup Shop', pack: 'services', folder: null });
  const auto = async () => (await backupsOf(directory)).filter(name => name.endsWith('-auto.backup'));
  await engine.tick();
  assert.equal((await auto()).length, 1, 'a business with no backup gets one at the first tick');
  clock.now += HOUR; await engine.tick();
  assert.equal((await auto()).length, 1, 'no change, no backup');
  await ask('trust.update', { retentionDays: 30 });
  clock.now += 1000; await engine.tick();
  assert.equal((await auto()).length, 2, 'an important change: the next tick writes one');
  await ask('trust.update', { retentionDays: 31 }); await ask('trust.update', { retentionDays: 32 });
  clock.now += 30_000; await engine.tick();
  assert.equal((await auto()).length, 2, 'within two minutes of the last backup, the burst waits');
  clock.now += AUTO_BACKUP.minGapMs; await engine.tick(); await engine.tick();
  assert.equal((await auto()).length, 3, 'the burst became one backup');
  await engine.vault!.update(state => { state.activity.push({ id: 'quiet', at: new Date().toISOString(), event: 'quiet.change', details: {} }); });
  clock.now += HOUR; await engine.tick();
  assert.equal((await auto()).length, 3, 'an ordinary change waits for the six-hour schedule');
  clock.now += AUTO_BACKUP.everyMs; await engine.tick();
  assert.equal((await auto()).length, 4, 'six hours with a change writes one');
  const view = (await ask('workspace.custody.get')).business;
  assert.deepEqual([view.backups.auto, view.backups.count, view.backups.lastError, view.backups.nextDueAt], [true, 4, null, null]);
  const manual = await ask('workspace.backups.create');
  await ask('trust.update', { retentionDays: 40 });
  clock.now += 1000; await ask('workspace.lock');
  assert.equal((await auto()).length, 5, 'closing after a change writes one');
  assert.ok((await backupsOf(directory)).includes(manual.file), 'manual copies are never rotated away');
  for (const name of await backupsOf(directory)) assert.ok(parseBackupName(name), name);

  await ask('workspace.open', { folder: created.folder });
  const removed = await ask('workspace.delete', { confirmation: 'Backup Shop' });
  assert.ok(removed.copiesRemoved.filter((path: string) => path.startsWith('backups/')).length >= 6);
  assert.deepEqual(await backupsOf(directory), []);
  assert.deepEqual(await readdir(join(directory, 'custody', 'cards')), []);
  assert.deepEqual(await readdir(join(directory, 'custody', 'keys')), []);
  assert.equal(keys.items(), 0);
  assert.deepEqual((await ask('workspace.list')).businesses, []);
});

test('rotation keeps exactly the 10 newest, the newest of 14 UTC days and of 8 ISO weeks, 5 safety copies, and every manual copy', () => {
  const start = Date.parse('2025-10-18T00:00:00.000Z'), now = Date.parse('2026-10-18T12:00:00.000Z'), files: { name: string; kind: 'auto' | 'manual' | 'safety'; at: number }[] = [];
  for (let at = start; at <= now; at += 6 * HOUR) files.push({ name: `chausar-ws-${at}-auto.backup`, kind: 'auto', at });
  for (let i = 0; i < 9; i++) files.push({ name: `chausar-ws-${start + i * 1000 + 1}-safety.backup`, kind: 'safety', at: start + i * 1000 + 1 });
  files.push({ name: `chausar-ws-${start + 7}.backup`, kind: 'manual', at: start + 7 }, { name: `chausar-ws-${start + 8}-manual.backup`, kind: 'manual', at: start + 8 });
  const { keep, remove } = keepBackups(files, now);
  assert.equal(keep.length + remove.length, files.length);
  const auto = files.filter(file => file.kind === 'auto').sort((a, b) => b.at - a.at);
  const expected = new Set(auto.slice(0, 10).map(file => file.name));
  const day = (ms: number) => Math.floor(ms / 86_400_000), week = (ms: number) => Math.floor((day(ms) + 3) / 7);
  const seenDays = new Set<number>(), seenWeeks = new Set<number>();
  for (const file of auto) {
    if (day(now) - day(file.at) < 14 && !seenDays.has(day(file.at))) { seenDays.add(day(file.at)); expected.add(file.name); }
    if (week(now) - week(file.at) < 8 && !seenWeeks.has(week(file.at))) { seenWeeks.add(week(file.at)); expected.add(file.name); }
  }
  assert.deepEqual(keep.filter(name => name.endsWith('-auto.backup')).sort(), [...expected].sort());
  assert.ok(expected.size <= 32, 'at most about 32 automatic files');
  assert.deepEqual(keep.filter(name => name.endsWith('-safety.backup')).sort(), files.filter(file => file.kind === 'safety').sort((a, b) => b.at - a.at).slice(0, 5).map(file => file.name).sort());
  for (const name of [`chausar-ws-${start + 7}.backup`, `chausar-ws-${start + 8}-manual.backup`]) assert.ok(keep.includes(name), name);
  // The newest of the week starting Monday 12 October 2026 is kept (an ISO week boundary).
  assert.ok(keep.includes(`chausar-ws-${Date.parse('2026-10-11T18:00:00.000Z')}-auto.backup`), 'Sunday is the last day of its ISO week');
});

test('restore a backup inside an open business: the state goes back, the revision goes up, a safety copy comes first', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory);
  await ask('workspace.create', { name: 'Restore Shop', pack: 'services', folder: null });
  await ask('trust.update', { retentionDays: 30 });
  const copy = await ask('workspace.backups.create');
  await ask('trust.update', { retentionDays: 60 });
  const before = (await ask('workspace.status')).workspace;
  await assert.rejects(ask('workspace.backups.restore', { file: copy.file }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(ask('workspace.backups.restore', { file: '../escape.backup', confirmed: true }), code('BACKUP_NOT_FOUND'));
  const result = await ask('workspace.backups.restore', { file: copy.file, confirmed: true });
  assert.equal(result.restoredFrom.file, copy.file);
  assert.equal(result.safety.kind, 'safety');
  assert.equal((await ask('trust.get')).retentionDays, 30, 'the state went back');
  assert.equal(result.workspace.id, before.id);
  const engineRevision = (await ask('workspace.backups.list')).backups.find((row: any) => row.file === result.safety.file).revision;
  assert.ok(engineRevision > copy.revision, 'the safety copy holds the later state');
  // Another business's backup in the same folder is refused.
  await ask('workspace.lock');
  await ask('workspace.create', { name: 'Second Shop', pack: 'services', folder: null });
  await assert.rejects(ask('workspace.backups.restore', { file: copy.file, confirmed: true }), (error: any) => error.code === 'BACKUP_OTHER_BUSINESS' && error.message === CUSTODY_WORDS.errors.BACKUP_OTHER_BUSINESS);
  const list = (await ask('workspace.backups.list')).backups;
  assert.ok(list.every((row: any) => row.name === 'Second Shop'), 'with a business open, only its own backups are listed');
  await ask('workspace.lock');
  assert.deepEqual(new Set((await ask('workspace.backups.list')).backups.map((row: any) => row.name)), new Set(['Restore Shop', 'Second Shop']), 'before opening, every business');
});

test('moving to another computer: one file and one code; a wrong code is refused; afterwards the code no longer opens it', async t => {
  const here = await folder(t, 'chausar-move-a-'), there = await folder(t, 'chausar-move-b-');
  const a = engineAt(t, here, { keys: memoryDeviceKeyStore() }), b = engineAt(t, there, { keys: memoryDeviceKeyStore() });
  await a.ask('workspace.create', { name: 'Moving Shop', pack: 'services', folder: null });
  const { recoveryCode } = await a.ask('workspace.custody.recoveryCode');
  await a.ask('trust.update', { retentionDays: 77 });
  const exported = await a.ask('workspace.transfer.export');
  assert.match(exported.transferCode, /^CHT-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{24}$/);
  assert.match(exported.fileName, /^chausar-move-\d{4}-\d{2}-\d{2}\.backup$/);
  assert.equal(exported.bytes, Buffer.byteLength(exported.text));
  assert.ok(!exported.text.includes('Moving Shop') && !exported.text.includes(exported.transferCode));
  assert.deepEqual(JSON.parse(exported.text).transfer.recovery, 'made');
  assert.deepEqual(await readdir(join(here, 'backups')).catch(() => []), [], 'the engine keeps no copy of the move file');

  await assert.rejects(b.ask('workspace.transfer.import', { fileText: exported.text, transferCode: makeTransferCode() }), (error: any) => error.code === 'TRANSFER_CODE_WRONG' && error.message === CUSTODY_WORDS.errors.TRANSFER_CODE_WRONG);
  await assert.rejects(b.ask('workspace.transfer.import', { fileText: '{"not":"a move file"}', transferCode: exported.transferCode }), code('TRANSFER_INVALID'));
  await assert.rejects(b.ask('workspace.transfer.import', { fileText: 'x'.repeat(TRANSFER.maxTextChars + 1), transferCode: exported.transferCode }), code('TRANSFER_TOO_LARGE'));
  assert.deepEqual((await readdir(there)).filter(name => !['custody', 'transfers'].includes(name)), [], 'no folder is made for a refused move');
  const typed = exported.transferCode.toLowerCase().replace(/^cht-/, '').replace(/(.{4})/g, '$1 ').replace(/0/g, 'o');
  const moved = await b.ask('workspace.transfer.import', { fileText: exported.text, transferCode: typed });
  assert.equal(moved.unlock, 'this-computer'); assert.match(moved.folder, /^moved-[a-f0-9]{6}$/);
  assert.equal((await b.ask('trust.get')).retentionDays, 77);
  assert.deepEqual(await readdir(join(there, 'transfers')), [], 'the uploaded file is deleted after the import');
  await b.ask('workspace.lock');
  await assert.rejects(b.ask('workspace.transfer.import', { fileText: exported.text, transferCode: exported.transferCode }), code('TRANSFER_SAME_BUSINESS'));
  await assert.rejects(Vault.open({ directory: join(there, moved.folder), storage: 'experimental-file', passphrase: exported.transferCode }), code('UNLOCK_FAILED'));
  await b.ask('workspace.open', { folder: moved.folder });
  assert.equal((await b.ask('workspace.list')).businesses[0].name, 'Moving Shop');
  await b.ask('workspace.lock');
  await b.ask('workspace.recover', { folder: moved.folder, recoveryCode });
  // In passphrase mode the move needs the passphrase.
  await b.ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  await assert.rejects(b.ask('workspace.transfer.export'), code('PASSPHRASE_WRONG'));
  assert.match((await b.ask('workspace.transfer.export', { passphrase: PASSPHRASE })).transferCode, /^CHT-/);
  assert.equal(normalizeTransferCode('CHT-ABCD'), null);
});

test('a key store that has lost the key gives DEVICE_KEY_FAILED; the recovery code brings the business back to this computer', async t => {
  const directory = await folder(t), spy = spyStore();
  const { ask } = engineAt(t, directory, { keys: spy.store });
  await ask('workspace.create', { name: 'Lost Key', pack: 'services', folder: null });
  const { recoveryCode } = await ask('workspace.custody.recoveryCode');
  await ask('workspace.lock');
  spy.failOpens(true);
  await assert.rejects(ask('workspace.open', { folder: 'lost-key' }), (error: any) => error.code === 'DEVICE_KEY_FAILED' && error.message === CUSTODY_WORDS.errors.DEVICE_KEY_FAILED);
  await ask('workspace.recover', { folder: 'lost-key', recoveryCode });
  assert.equal((await ask('workspace.status')).unlock, 'this-computer');
  await ask('workspace.lock');
  spy.failOpens(false);
  await ask('workspace.open', { folder: 'lost-key' });
  assert.equal(spy.secrets.length, 2, 'the recovery made a fresh computer secret');
});

test('the silent onboarding create: connect, compose, create with folder null and no passphrase, then venture.create adopts the plan', async t => {
  const dog = JSON.parse(await readFile(new URL('./fixtures/venture/onboarding/dog-walking-gb.json', import.meta.url), 'utf8')) as ModelReplayFixture & { text: string };
  const directory = await folder(t), clock = { now: Date.parse('2026-10-18T09:00:00.000Z') };
  const { engine, ask } = engineAt(t, directory, { clock, venture: { host: 'test', modelTransport: createReplayTransport(dog), sandbox: { process: async () => { throw new Error('docker not found'); } } } });
  const options = await ask('venture.ai.options') as AiOptionsView;
  const preset = (id: ModelPreset['id']) => options.presets.find(item => item.id === id)!;
  const KEY = 'sk-ant-test-custody-not-a-real-key-0001';
  await ask('venture.ai.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: preset('anthropic-haiku-5-5').consentDigest, apiKey: KEY });
  await ask('venture.ai.connect', { presetId: 'anthropic-sonnet-5-5', consentDigest: preset('anthropic-sonnet-5-5').consentDigest, apiKey: KEY });
  const decision = await ask('venture.compose.decide', { text: dog.text, countryCode: 'GB' }) as ComposeDecision;
  const plan = await ask('venture.compose.fill', { composeId: decision.composeId }) as ComposedPlan;
  const created = await ask('workspace.create', { name: plan.name.value, pack: 'services', folder: null });
  assert.equal(created.unlock, 'this-computer');
  const view = await ask('venture.create', { idea: dog.text, countryCode: 'GB', workingName: plan.name.value, composeId: plan.composeId, composedDigest: plan.digest });
  assert.equal(view.venture.workingName, plan.name.value);
  await engine.tick();
  assert.equal((await backupsOf(directory)).filter(name => name.endsWith('-auto.backup')).length, 1);
  for (const file of await files(directory)) assert.equal((await readFile(file)).includes(KEY), false, file);
});

test('device sync needs a passphrase: a this-computer business refuses sync.enable', async t => {
  const { ask } = engineAt(t, await folder(t));
  await ask('workspace.create', { name: 'No Sync', pack: 'services', folder: null });
  await assert.rejects(ask('sync.enable', { enabled: true }), (error: any) => error.code === 'SYNC_NEEDS_PASSPHRASE' && error.message === CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
});

test('the app-only custody methods refuse a tainted or non-desktop context', async t => {
  const { engine, ask } = engineAt(t, await folder(t));
  await ask('workspace.create', { name: 'App Only', pack: 'services', folder: null });
  const owner = engine.bootstrapContext();
  for (const method of ['workspace.custody.passphraseOn', 'workspace.custody.passphraseOff', 'workspace.custody.recoveryCode', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export']) {
    await assert.rejects(engine.requestAs({ ...owner, sourceTainted: true }, method, {}), code('APP_APPROVAL_REQUIRED'), method);
    await assert.rejects(engine.requestAs({ ...owner, channel: 'phone' as any }, method, {}), code('APP_APPROVAL_REQUIRED'), method);
  }
});

test('secrets scan: no computer secret or passphrase anywhere; recovery and move codes only in the result that made them', async t => {
  const directory = await folder(t), there = await folder(t, 'chausar-scan-b-'), spy = spyStore();
  const { engine, ask } = engineAt(t, directory, { keys: spy.store });
  const b = engineAt(t, there, { keys: memoryDeviceKeyStore() });
  const results: { method: string; text: string }[] = [], errors: string[] = [];
  const call = async (target: typeof ask, method: string, payload: Record<string, unknown> = {}) => {
    try { const result = await target(method, payload); results.push({ method, text: JSON.stringify(result) }); return result; }
    catch (error: any) { errors.push(JSON.stringify({ code: error.code, message: error.message, reason: error.reason, stack: error.stack })); return null; }
  };
  await call(ask, 'workspace.create', { name: 'Scan Shop', pack: 'services', folder: null });
  await call(ask, 'workspace.custody.get'); await call(ask, 'workspace.backups.create');
  const made = await call(ask, 'workspace.custody.recoveryCode');
  const exported = await call(ask, 'workspace.transfer.export');
  await call(ask, 'workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  await call(ask, 'workspace.custody.passphraseOff', { passphrase: OTHER });
  await call(ask, 'workspace.custody.passphraseOff', { passphrase: PASSPHRASE });
  await call(ask, 'workspace.backups.list'); await call(ask, 'workspace.list'); await call(ask, 'workspace.status');
  await engine.tick();
  const audit = JSON.stringify(engine.vault!.read().activity);
  await call(ask, 'workspace.lock');
  await call(ask, 'workspace.open', { folder: 'missing-folder' });
  await call(b.ask, 'workspace.transfer.import', { fileText: exported.text, transferCode: 'CHT-WRONGWRONGWRONGWRONGWRONG' });
  await call(b.ask, 'workspace.transfer.import', { fileText: exported.text, transferCode: exported.transferCode });
  assert.ok(spy.secrets.length >= 2);
  const disk = (await Promise.all([...await files(directory), ...await files(there)].map(file => readFile(file, 'utf8')))).join('\n');
  const everywhere = [...results.map(item => item.text), ...errors, audit, disk].join('\n');
  for (const secret of [...spy.secrets, PASSPHRASE, OTHER]) assert.equal(everywhere.includes(secret), false, 'a secret leaked');
  for (const [secret, method] of [[made.recoveryCode, 'workspace.custody.recoveryCode'], [exported.transferCode, 'workspace.transfer.export']]) {
    const holders = results.filter(item => item.text.includes(secret)).map(item => item.method);
    assert.deepEqual(holders, [method], `${method}: only the result that made it`);
    assert.equal([...errors, audit, disk].join('\n').includes(secret), false);
  }
});

// ---------------------------------------------------------------- real Windows DPAPI on this computer

// ---------------------------------------------------------------- a lock change cut short, and the review's other fixes

const readCard = async (directory: string, folderName: string) => JSON.parse(await readFile(join(directory, 'custody', 'cards', `${folderName}.json`), 'utf8'));
const keyFileExists = (directory: string, vaultId: string) => readFile(join(directory, 'custody', 'keys', `${vaultId}.json`)).then(() => true, () => false);
const diskFault = (code: string) => Object.assign(new Error(`${code}: the disk refused`), { code });
/** Lets the first call through and makes every later one fail, as when the disk fills or a rename keeps failing. */
function failAfterFirst<T extends (...args: any[]) => Promise<any>>(work: T, code = 'ENOSPC'): T {
  let calls = 0;
  return (async (...args: any[]) => { if (++calls > 1) throw diskFault(code); return work(...args); }) as T;
}

test('turning the passphrase on, cut short after the rewrap: put back in place; if even that fails, the passphrase opens it and the next open settles the card', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys });
  const { folder: name } = await ask('workspace.create', { name: 'Cut Short', pack: 'services', folder: null });

  // A failure after the rewrap (here the recovery code's commit) puts the vault back with the computer secret.
  let vault = (engine as any).vault;
  vault.rewrapRecovery = async () => { throw diskFault('EPERM'); };
  await assert.rejects(ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE }), /EPERM/);
  let card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending, card.recovery, card.wrappersDigest], ['this-computer', null, 'not-made', vault.wrappersDigest]);
  assert.equal((await ask('workspace.custody.get')).business.unlock, 'this-computer');
  assert.equal(keys.items(), 1);
  await ask('workspace.lock');
  assert.equal((await ask('workspace.list')).businesses[0].opens, 'with-this-computer');
  await ask('workspace.open', { folder: name });

  // Now the undo fails too, as after a crash: the vault opens only with the passphrase, and the card says so.
  vault = (engine as any).vault;
  vault.rewrapRecovery = async () => { throw diskFault('EPERM'); };
  vault.rewrapPassphrase = failAfterFirst(vault.rewrapPassphrase.bind(vault));
  await assert.rejects(ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE }), /EPERM/);
  card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending], ['this-computer', 'to-passphrase'], 'the marker stays on the card');
  await ask('workspace.lock');
  const row = (await ask('workspace.list')).businesses[0];
  assert.deepEqual([row.folder, row.opens], [name, 'needs-passphrase'], 'Welcome back shows the passphrase field for it');
  await assert.rejects(ask('workspace.open', { folder: name }), (error: any) => error.code === 'PASSPHRASE_REQUIRED' && error.message === CUSTODY_WORDS.errors.PASSPHRASE_REQUIRED,
    'not DEVICE_KEY_FAILED: the passphrase is the way in now');
  await ask('workspace.open', { folder: name, passphrase: PASSPHRASE });
  card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending, card.recovery], ['passphrase', null, 'not-made'], 'the next open settled the card');
  assert.equal((await ask('workspace.status')).unlock, 'passphrase');
  assert.equal(keys.items(), 0, 'and forgot the computer key');
  assert.equal(await keyFileExists(directory, card.vaultId), false);
  assert.ok((await ask('workspace.backups.list')).backups.every((backup: any) => backup.opensNow), 'and resealed the backups');
});

test('turning the passphrase off, cut short: a failed card write is undone with the typed passphrase; after a crash the computer key opens it, typed or not', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys });
  const { folder: name } = await ask('workspace.create', { name: 'Off Cut', pack: 'services', folder: null, passphrase: PASSPHRASE });
  const files = (engine as any).custodyFiles(), writeCard = files.writeCard.bind(files);
  const refuseThisComputerCards = () => { files.writeCard = async (card: any) => { if (card.unlock === 'this-computer') throw diskFault('EPERM'); return writeCard(card); }; };

  // The card write after the rewrap fails: the typed passphrase puts the vault back, and the new key goes.
  refuseThisComputerCards();
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE }), /EPERM/);
  files.writeCard = writeCard;
  let card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending], ['passphrase', null]);
  assert.equal(keys.items(), 0); assert.equal(await keyFileExists(directory, card.vaultId), false);
  await ask('workspace.lock');
  await assert.rejects(ask('workspace.open', { folder: name }), code('PASSPHRASE_REQUIRED'));
  await ask('workspace.open', { folder: name, passphrase: PASSPHRASE });

  // As after a crash: the rewrap reached the disk and nothing after it did.
  const crash = () => {
    const vault = (engine as any).vault;
    vault.rewrapPassphrase = failAfterFirst(vault.rewrapPassphrase.bind(vault));
    refuseThisComputerCards();
  };
  crash();
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE }), /EPERM/);
  files.writeCard = writeCard;
  card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending], ['passphrase', 'to-this-computer']);
  assert.equal(keys.items(), 1, 'the key record stays until the change is settled');
  await ask('workspace.lock');
  assert.equal((await ask('workspace.list')).businesses[0].opens, 'with-this-computer');
  await ask('workspace.open', { folder: name });
  card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending], ['this-computer', null], 'opening with no passphrase tried the key record and settled the card');

  // The same crash once more, then the owner types the old passphrase: the computer key still gets in.
  await ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  crash();
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE }), /EPERM/);
  files.writeCard = writeCard;
  await ask('workspace.lock');
  await ask('workspace.open', { folder: name, passphrase: PASSPHRASE });
  assert.equal((await ask('workspace.status')).unlock, 'this-computer');
  assert.deepEqual([(await readCard(directory, name)).unlock, (await readCard(directory, name)).pending], ['this-computer', null]);
});

test('with no recovery code yet, a safety copy that fails stops the lock change before anything changes', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys });
  const { folder: name } = await ask('workspace.create', { name: 'No Copy', pack: 'services', folder: null });
  const vault = (engine as any).vault, digest = vault.wrappersDigest;
  vault.backup = async () => { throw Object.assign(new Error('Snapshot-only backup cannot omit managed private artifacts.'), { code: 'ARTIFACT_BACKUP_REQUIRED' }); };
  await assert.rejects(ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE }), (error: any) =>
    error.code === 'SAFETY_BACKUP_FAILED' && error.message === CUSTODY_WORDS.lock.safetyBackupFailed);
  const card = await readCard(directory, name);
  assert.deepEqual([card.unlock, card.pending, vault.wrappersDigest, keys.items()], ['this-computer', null, digest, 1], 'nothing changed');
  assert.match((await ask('workspace.custody.get')).business.backups.lastError, /private artifacts/);
  // With a recovery code made, the safety copy is best effort again.
  await ask('workspace.custody.recoveryCode');
  const on = await ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  assert.deepEqual([on.custody.business.unlock, on.recoveryCode], ['passphrase', null]);
});

test('encrypted exports are resealed with the backups; a copy restored with a recovery code never unlocks the original passphrase backups', async t => {
  const directory = await folder(t);
  const { ask } = engineAt(t, directory);
  await ask('workspace.create', { name: 'Export Shop', pack: 'services', folder: null });
  const sealed = (await ask('workspace.export', { confirmed: true })).path, plain = (await ask('workspace.export', { confirmed: true, plaintext: true })).path;
  const plainBefore = await readFile(plain, 'utf8');
  await ask('workspace.custody.passphraseOn', { passphrase: PASSPHRASE });
  const card = await readCard(directory, 'export-shop');
  assert.equal(wrappersDigestOf(JSON.parse(await readFile(sealed, 'utf8')).envelope), card.wrappersDigest, 'the .vault export opens the way the business opens now');
  assert.equal(await readFile(plain, 'utf8'), plainBefore, 'a plaintext export is left alone');
  await ask('workspace.lock');
  const opened = await Vault.restore({ directory: join(directory, 'check-export'), backupFile: sealed, passphrase: PASSPHRASE, storage: 'experimental-file' });
  assert.equal(opened.read().workspace.name, 'Export Shop'); await opened.close();

  // The original is locked with a passphrase; a copy is restored before opening with the recovery code alone.
  const other = await folder(t), second = engineAt(t, other);
  const created = await second.ask('workspace.create', { name: 'Locked Original', pack: 'services', folder: null, passphrase: PASSPHRASE });
  const backup = await second.ask('workspace.backups.create');
  await second.ask('workspace.lock');
  const original = await readCard(other, created.folder);
  const restored = await second.ask('workspace.restore', { backupFile: backup.file, folder: null, recoveryCode: created.recoveryCode });
  assert.equal(restored.folder, 'locked-original-restored');
  assert.equal((await second.ask('workspace.status')).unlock, 'this-computer');
  await second.ask('workspace.custody.recoveryCode');
  const header = JSON.parse(await readFile(join(other, 'backups', backup.file), 'utf8')).envelope;
  assert.equal(wrappersDigestOf(header), original.wrappersDigest, "the original's backups keep its passphrase");
  await second.ask('workspace.lock');
  await assert.rejects(second.ask('workspace.restore', { backupFile: backup.file, folder: null }), code('DEVICE_KEY_FAILED'), "this computer's login doesn't open them");
  await second.ask('workspace.restore', { backupFile: backup.file, folder: null, passphrase: PASSPHRASE });
});

test('turning the passphrase off is refused while device sync is on', async t => {
  const directory = await folder(t), keys = memoryDeviceKeyStore();
  const { engine, ask } = engineAt(t, directory, { keys });
  await ask('workspace.create', { name: 'Synced Shop', pack: 'services', folder: null, passphrase: PASSPHRASE });
  const sync = (engine as any).services.sync, status = sync.status.bind(sync);
  sync.status = (context: any) => ({ ...status(context), enabled: true });
  await assert.rejects(ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE }), (error: any) =>
    error.code === 'SYNC_NEEDS_PASSPHRASE' && error.message === CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
  assert.deepEqual([(await ask('workspace.custody.get')).business.unlock, keys.items()], ['passphrase', 0]);
  sync.status = status;
  assert.equal((await ask('workspace.custody.passphraseOff', { passphrase: PASSPHRASE })).custody.business.unlock, 'this-computer');
});

test("when this computer's protected storage doesn't answer, opening says so in its own words, and a later try works", async t => {
  const directory = await folder(t), inner = memoryDeviceKeyStore();
  let down = false;
  const keys: DeviceKeyStore = { scheme: inner.scheme, protect: inner.protect, unprotect: inner.unprotect, forget: inner.forget,
    probe: async () => down ? { available: false, reason: 'failed' } : inner.probe() };
  const { ask } = engineAt(t, directory, { keys });
  const { folder: name } = await ask('workspace.create', { name: 'Slow Start', pack: 'services', folder: null });
  await ask('workspace.lock');
  down = true;
  await assert.rejects(ask('workspace.open', { folder: name }), (error: any) =>
    error.code === 'DEVICE_KEY_FAILED' && error.reason === 'failed' && error.message === CUSTODY_WORDS.lock.keyNotAnswering && !/asks for a passphrase/.test(error.message));
  down = false;
  assert.equal((await ask('workspace.open', { folder: name })).workspace.name, 'Slow Start');
});

test('a business named like an old vault slot with no card takes the next name instead of failing', async t => {
  const directory = await folder(t);
  const old = engineAt(t, directory, { keys: null });
  await old.ask('workspace.create', { name: 'Main', pack: 'services', passphrase: PASSPHRASE });
  await old.engine.close();
  const { engine, ask } = engineAt(t, directory);
  // On PostgreSQL storage the old slot has no folder on disk, so nothing marks the name as taken.
  (engine as any).custodyFiles().takenFolders = async () => [];
  const created = await ask('workspace.create', { name: 'Main', pack: 'services', folder: null });
  assert.equal(created.folder, 'main-2');
  assert.equal(await readFile(join(directory, 'custody', 'cards', 'main.json')).then(() => true, () => false), false, 'the creating card for the taken slot was removed');
  assert.equal((await ask('workspace.status')).workspace.name, 'Main');
});

test('a move whose attach fails stays listed with the right way in, and opens later with no passphrase', async t => {
  const here = await folder(t, 'chausar-move-a-'), there = await folder(t, 'chausar-move-b-');
  const a = engineAt(t, here, { keys: memoryDeviceKeyStore() }), b = engineAt(t, there, { keys: memoryDeviceKeyStore() });
  await a.ask('workspace.create', { name: 'Half Moved', pack: 'services', folder: null });
  const exported = await a.ask('workspace.transfer.export');
  (b.engine as any).attach = async () => { throw new Error('attach failed'); };
  await assert.rejects(b.ask('workspace.transfer.import', { fileText: exported.text, transferCode: exported.transferCode }), /attach failed/);
  delete (b.engine as any).attach;
  const { businesses } = await b.ask('workspace.list');
  assert.equal(businesses.length, 1);
  assert.deepEqual([businesses[0].name, businesses[0].opens, businesses[0].unlock, businesses[0].listedFrom], ['Half Moved', 'with-this-computer', 'this-computer', 'card']);
  await assert.rejects(b.ask('workspace.transfer.import', { fileText: exported.text, transferCode: exported.transferCode }), code('TRANSFER_SAME_BUSINESS'));
  assert.equal((await b.ask('workspace.open', { folder: businesses[0].folder })).workspace.name, 'Half Moved');
});
