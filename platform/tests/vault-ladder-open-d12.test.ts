// D12 task 4: opening a business runs the ladder. Newer data answers DATA_NEWER only after the key opened it (a wrong
// passphrase still says UNLOCK_FAILED and learns nothing), and the file is never touched. Older data is brought up to
// date in memory; nothing is written until commitMigration has had the untouched file backed up, and every other write
// waits (MIGRATION_PENDING). The real ladder has no step yet, so a test-only step from 0 to 1 stands in below it.
// The engine's workspace.open wiring (the migration backup in backups/, diagnostics, data-versions.json) and the owner
// words come after the rebase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vault } from '../runtime/vault.ts';
import { CURRENT_SCHEMA, STEPS, type LadderStep } from '../runtime/migrations/ladder.ts';
import { openEnvelope, readVaultState, rewriteVaultState } from './helpers/seal-fixture.ts';

const passphrase = 'a long private test passphrase';
const options = (directory: string) => ({ directory, storage: 'experimental-file' as const, passphrase });
const sha = async (directory: string) => createHash('sha256').update(await readFile(join(directory, 'authority.encrypted.json'))).digest('hex');
/** Below the real ladder: version 0 data gains a default, keeping every record. */
const ZERO_ONE: LadderStep = { from: 0, to: 1, name: '0000-to-0001 (test)', run: state => ({ ...state, schemaVersion: 1, activity: [...state.activity, { message: 'brought up to date' }] }) };
const steps = [ZERO_ONE, ...STEPS];

async function vaultAt(t: any, change: (state: any) => any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-vault-ladder-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { vault } = await Vault.create({ ...options(directory), name: 'Sample tutoring' });
  await vault.update(state => { state.activity.push({ message: 'kept record' }); });
  await vault.close();
  await rewriteVaultState(directory, passphrase, change);
  return directory;
}

test('newer data with the right passphrase says DATA_NEWER with both numbers, and the file is unchanged', async t => {
  const directory = await vaultAt(t, state => ({ ...state, schemaVersion: CURRENT_SCHEMA + 1 }));
  const before = await sha(directory);
  await assert.rejects(Vault.open(options(directory)), (error: any) => {
    assert.equal(error.code, 'DATA_NEWER');
    assert.deepEqual([error.found, error.supported], [CURRENT_SCHEMA + 1, CURRENT_SCHEMA]);
    return true;
  });
  assert.equal(await sha(directory), before);
});

test('a wrong passphrase on newer data still says UNLOCK_FAILED and learns nothing about the version', async t => {
  const directory = await vaultAt(t, state => ({ ...state, schemaVersion: CURRENT_SCHEMA + 1 }));
  await assert.rejects(Vault.open({ ...options(directory), passphrase: 'an entirely different long passphrase' }), (error: any) => error.code === 'UNLOCK_FAILED' && !/version/i.test(error.message));
});

test('data at the current version opens with nothing to migrate, every time', async t => {
  const directory = await vaultAt(t, state => state);
  for (let round = 0; round < 2; round++) {
    const vault = await Vault.open(options(directory));
    assert.equal(vault.migratedFrom, null);
    await vault.update(state => { state.activity.push({ message: `round ${round}` }); });
    await vault.close();
  }
});

test('older data opens brought up to date in memory; the file waits for the backup, then one commit', async t => {
  const directory = await vaultAt(t, state => ({ ...state, schemaVersion: 0 }));
  const untouched = await readFile(join(directory, 'authority.encrypted.json'), 'utf8');
  const vault = await Vault.open({ ...options(directory), migrationSteps: steps });
  t.after(() => vault.close());
  assert.equal(vault.migratedFrom, 0);
  assert.equal(vault.read().schemaVersion, CURRENT_SCHEMA);
  assert.deepEqual(vault.read().activity.map((item: any) => item.message), ['kept record', 'brought up to date']);
  assert.equal(await readFile(join(directory, 'authority.encrypted.json'), 'utf8'), untouched, 'nothing written on open');
  await assert.rejects(vault.update(state => { state.activity.push({ message: 'too early' }); }), (error: any) => error.code === 'MIGRATION_PENDING');

  const backups: string[] = [];
  assert.deepEqual(await vault.commitMigration(async text => { backups.push(text); }), { from: 0, to: CURRENT_SCHEMA });
  assert.deepEqual(backups, [untouched], 'the backup holds the untouched file, byte for byte');
  assert.equal(openEnvelope(backups[0], passphrase).state.schemaVersion, 0, 'and opens to the old data');
  assert.equal(vault.migratedFrom, null);
  const written = await readVaultState(directory, passphrase);
  assert.equal(written.schemaVersion, CURRENT_SCHEMA);
  assert.equal(written.revision, JSON.parse(untouched).revision + 1);
  await vault.update(state => { state.activity.push({ message: 'after' }); });
  await vault.close();
  const again = await Vault.open(options(directory));
  assert.equal(again.migratedFrom, null, 'a second open does not migrate again');
  await again.close();
});

test('a backup that fails leaves the file as it was and the migration pending', async t => {
  const directory = await vaultAt(t, state => ({ ...state, schemaVersion: 0 }));
  const before = await sha(directory);
  const vault = await Vault.open({ ...options(directory), migrationSteps: steps });
  t.after(() => vault.close());
  await assert.rejects(vault.commitMigration(async () => { throw new Error('disk full'); }), (error: any) => error.code === 'DATA_MIGRATION_FAILED' && /Your business is unchanged/.test(error.message));
  assert.equal(await sha(directory), before);
  assert.equal(vault.migratedFrom, 0);
});

test('a step that throws answers DATA_MIGRATION_FAILED and leaves the file unchanged', async t => {
  const directory = await vaultAt(t, state => ({ ...state, schemaVersion: 0 }));
  const before = await sha(directory);
  const broken: LadderStep = { ...ZERO_ONE, run: () => { throw new Error('a shape it cannot read'); } };
  await assert.rejects(Vault.open({ ...options(directory), migrationSteps: [broken, ...STEPS] }), (error: any) => error.code === 'DATA_MIGRATION_FAILED');
  assert.equal(await sha(directory), before);
  const vault = await Vault.open({ ...options(directory), migrationSteps: steps });
  assert.equal(vault.migratedFrom, 0, 'the lock was released; the business opens again');
  await vault.close();
});

test('no host passes test steps: migrationSteps is for tests only', async () => {
  const areas = (await readdir(new URL('../runtime/engine/', import.meta.url))).filter(file => file.endsWith('.ts')).map(file => `engine/${file}`);
  for (const file of ['worker.ts', 'server.ts', 'hosted/server.ts', 'engine.ts', ...areas]) {
    assert.doesNotMatch(await readFile(new URL(`../runtime/${file}`, import.meta.url), 'utf8'), /migrationSteps/, file);
  }
});
