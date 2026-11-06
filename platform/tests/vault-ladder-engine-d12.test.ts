// D12 tasks 4 to 6, through the engine: a business from an older Chausar opens at CURRENT_SCHEMA with every record kept, after a
// migration backup of the file as it was. Newer data is refused in owner words and never touched. Backups, move files and
// exports of an older version come in through the same ladder, and the file they came from never changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { CURRENT_SCHEMA } from '../runtime/migrations/ladder.ts';
import { rewriteVaultState, openEnvelope } from './helpers/seal-fixture.ts';

const PASSPHRASE = 'a long private test passphrase';
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const FOLDER = 'sample';

async function engineOn(directory: string) {
  return new Engine({ version: '0.2.0', directory, demo: true, storage: 'experimental-file', pythonExecutable: 'python', workspaceCustody: { deviceKeys: 'none', autoBackups: false } } as any);
}
async function olderBusiness(t: any, schema = 1) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ladder-engine-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const engine = await engineOn(directory);
  const made = await engine.request('workspace.create', { name: 'Sample tutoring', passphrase: PASSPHRASE, pack: 'services', folder: FOLDER }) as any;
  const folder = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && !['backups', 'custody', 'exports', 'updates', 'transfers'].includes(entry.name))[0]!.name;
  await (engine as any).store().update((state: any) => { state.activity.push({ message: 'kept record' }); });
  await engine.shutdown();
  await rewriteVaultState(join(directory, folder), PASSPHRASE, state => ({ ...state, schemaVersion: schema }));
  return { directory, folder, made };
}
const liveFile = (directory: string, folder: string) => join(directory, folder, 'authority.encrypted.json');

test('an older business opens brought up to date, after a migration backup of the file as it was, and does not migrate again', async t => {
  const { directory, folder } = await olderBusiness(t);
  const before = await readFile(liveFile(directory, folder), 'utf8');
  assert.equal(openEnvelope(before, PASSPHRASE).state.schemaVersion, 1);
  const engine = await engineOn(directory);
  t.after(() => engine.shutdown().catch(() => {}));
  await engine.request('workspace.open', { folder, passphrase: PASSPHRASE });
  assert.equal((engine as any).store().read().schemaVersion, CURRENT_SCHEMA);
  assert.equal((engine as any).store().migratedFrom, null, 'committed');
  assert.ok((engine as any).store().read().activity.some((row: any) => row.message === 'kept record'), 'every record kept');
  const onDisk = openEnvelope(await readFile(liveFile(directory, folder), 'utf8'), PASSPHRASE).state;
  assert.equal(onDisk.schemaVersion, CURRENT_SCHEMA);
  const backups = (await readdir(join(directory, 'backups'))).filter(name => name.endsWith('-migration.backup'));
  assert.equal(backups.length, 1);
  const kept = JSON.parse(await readFile(join(directory, 'backups', backups[0]!), 'utf8'));
  assert.equal(kept.backupFormat, 'chausar.backup.v1');
  assert.equal(JSON.stringify(kept.envelope), JSON.stringify(JSON.parse(before)), 'the backup is the file as it was');
  const versions = JSON.parse(await readFile(join(directory, 'custody', 'data-versions.json'), 'utf8'));
  assert.equal(versions.format, 'chausar.data-versions.v1');
  assert.equal(versions.files[backups[0]!], 1);
  assert.deepEqual(versions.live[folder].version, CURRENT_SCHEMA);
  assert.equal(versions.live[folder].from, 1);
  assert.equal(versions.live[folder].migratedBy, '0.2.0');
  assert.equal(versions.live[folder].backup, backups[0]);
  assert.match(await readFile(join(directory, 'custody', 'diagnostics.jsonl'), 'utf8'), /"op":"migration"/);
  await engine.request('workspace.lock', {});
  await engine.request('workspace.open', { folder, passphrase: PASSPHRASE });
  assert.equal((await readdir(join(directory, 'backups'))).filter(name => name.endsWith('-migration.backup')).length, 1, 'a second open does not migrate again');
});

test('newer data says DATA_NEWER only with the right key, in owner words, and the file does not change', async t => {
  const { directory, folder } = await olderBusiness(t, CURRENT_SCHEMA + 1);
  const before = sha(await readFile(liveFile(directory, folder)));
  const engine = await engineOn(directory);
  t.after(() => engine.shutdown().catch(() => {}));
  await assert.rejects(engine.request('workspace.open', { folder, passphrase: 'an entirely different long passphrase' }), (error: any) => error.code === 'UNLOCK_FAILED');
  await assert.rejects(engine.request('workspace.open', { folder, passphrase: PASSPHRASE }), (error: any) => {
    assert.equal(error.code, 'DATA_NEWER');
    assert.equal(error.message, 'This business was saved by a newer version of Chausar. Update Chausar to open it. Nothing was changed.');
    return true;
  });
  assert.equal(sha(await readFile(liveFile(directory, folder))), before);
});

test('a restore of an older backup opens at the current version, and the backup file never changes; a newer one writes nothing', async t => {
  const { directory, folder } = await olderBusiness(t);
  const backup = join(directory, 'older-copy.backup');
  const text = JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: JSON.parse(await readFile(liveFile(directory, folder), 'utf8')) });
  await writeFile(backup, text);
  const { Vault } = await import('../runtime/vault.ts');
  const target = join(directory, 'restored-here');
  const restored = await Vault.restore({ directory: target, backupFile: backup, passphrase: PASSPHRASE, storage: 'experimental-file' });
  assert.equal(restored.read().schemaVersion, CURRENT_SCHEMA);
  assert.equal(restored.migratedFrom, 1, 'the commit waits for the backup, as an open does');
  await restored.close();
  assert.equal(await readFile(backup, 'utf8'), text, 'the backup file is never rewritten');
  const newer = await rewriteVaultState(join(directory, folder), PASSPHRASE, state => ({ ...state, schemaVersion: CURRENT_SCHEMA + 1 }));
  const newerBackup = join(directory, 'newer-copy.backup');
  await writeFile(newerBackup, JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: JSON.parse(newer) }));
  const elsewhere = join(directory, 'never-made');
  await assert.rejects(Vault.restore({ directory: elsewhere, backupFile: newerBackup, passphrase: PASSPHRASE, storage: 'experimental-file' }), (error: any) => error.code === 'DATA_NEWER');
  await assert.rejects(readdir(elsewhere), { code: 'ENOENT' });
});

test('recovering an older business makes the migration backup first and writes it brought up to date', async t => {
  const { directory, folder, made } = await olderBusiness(t);
  const engine = await engineOn(directory);
  t.after(() => engine.shutdown().catch(() => {}));
  await engine.request('workspace.recover', { folder, recoveryCode: made.recoveryCode, passphrase: 'another long private test passphrase' });
  assert.equal((engine as any).store().read().schemaVersion, CURRENT_SCHEMA);
  assert.equal((engine as any).store().migratedFrom, null);
  assert.equal((await readdir(join(directory, 'backups'))).filter(name => name.endsWith('-migration.backup')).length, 1);
});

test('a reseal never changes a backup\'s data version, and an older move file peeks and opens', async t => {
  const { directory, folder } = await olderBusiness(t);
  const { Vault } = await import('../runtime/vault.ts');
  const text = JSON.stringify({ backupFormat: 'chausar.backup.v1', envelope: JSON.parse(await readFile(liveFile(directory, folder), 'utf8')) });
  assert.equal((await Vault.peekTransfer(text, PASSPHRASE))?.name, 'Sample tutoring');
  const backup = join(directory, 'older-reseal.backup');
  await writeFile(backup, text);
  const vault = await Vault.open({ directory: join(directory, folder), passphrase: PASSPHRASE, storage: 'experimental-file' });
  await vault.commitMigration(async () => {});
  await vault.rewrapPassphrase('a new long private test passphrase');
  const { resealed } = await vault.resealBackups([backup]);
  assert.deepEqual(resealed, [backup]);
  const after = openEnvelope(await readFile(backup, 'utf8'), 'a new long private test passphrase');
  assert.equal(after.state.schemaVersion, 1, 'its data version stays what it was');
  await vault.close();
});

test('the backup list says a newer backup needs a newer Chausar, and a file not in the index shows no version', async t => {
  const { directory, folder } = await olderBusiness(t);
  const engine = await engineOn(directory);
  t.after(() => engine.shutdown().catch(() => {}));
  await engine.request('workspace.open', { folder, passphrase: PASSPHRASE });
  const workspaceId = (engine as any).store().read().workspace.id;
  const made = await engine.request('workspace.backups.create', {}) as any;
  const path = join(directory, 'custody', 'data-versions.json');
  const versions = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(versions.files[made.file], CURRENT_SCHEMA);
  versions.files[made.file] = CURRENT_SCHEMA + 1;
  await writeFile(path, JSON.stringify(versions));
  const { CustodyFiles } = await import('../runtime/workspace-custody.ts');
  const views = (await new CustodyFiles(directory).backupViews(workspaceId, [])).backups;
  const newer = views.find(view => view.file === made.file)!;
  assert.deepEqual([newer.opensNow, newer.needsNewer], [false, true]);
  delete versions.files[made.file];
  await writeFile(path, JSON.stringify(versions));
  const unknown = (await new CustodyFiles(directory).backupViews(workspaceId, [])).backups.find(view => view.file === made.file)!;
  assert.equal(unknown.needsNewer, undefined);
  assert.equal(unknown.dataVersion, undefined);
});

test('at quit, the newest data on this computer counts, a closed business too', async t => {
  const { directory, folder } = await olderBusiness(t);
  const engine = await engineOn(directory);
  t.after(() => engine.shutdown().catch(() => {}));
  await engine.request('workspace.open', { folder, passphrase: PASSPHRASE });
  const path = join(directory, 'custody', 'data-versions.json');
  const versions = JSON.parse(await readFile(path, 'utf8'));
  versions.live['another-business'] = { version: CURRENT_SCHEMA + 4 };
  await writeFile(path, JSON.stringify(versions));
  assert.equal((await engine.prepareUpdateInstall({})).openDataSchema, CURRENT_SCHEMA + 4);
});
