import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, lstat, writeFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { preflightWorkspaceActivationStaging, WorkspaceActivationStagingInventory,
  type WorkspaceActivationStagingAttempt, type WorkspaceActivationStagingInventoryLease } from '../runtime/workspace-activation-staging-inventory.ts';
import { Vault, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../runtime/vault.ts';
import type { PostgresSnapshotAdapter, PostgresSnapshotLease } from '../runtime/postgres.ts';
import type { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';

// These are explicitly metadata-only protocol fixtures. They do not supply an
// authenticated journal capability, exercise native SQL or qualify activation.
const budgets = { maxFiles: 64, maxBytes: 1024 * 1024, maxDepth: 8 };
const names = ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json', 'live/postgres-publication.encrypted.json'];
const code = (expected: string) => (error: any) => error?.code === expected;
const physical = async (path: string) => { const value = await lstat(path, { bigint: true });
  return { dev: String(value.dev), ino: String(value.ino), birthtimeNs: String(value.birthtimeNs) }; };
async function removeFixtureRoot(root: string) {
  assert.equal(resolve(root), root);
  assert.ok(root.startsWith(join(tmpdir(), 'chausar-staging-')));
  await rm(root, { recursive: true, force: true });
}
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-staging-metadata-'));
  t.after(() => removeFixtureRoot(root));
  const name = 'attempt_11111111-1111-4111-8111-111111111111';
  const stage = join(root, '.workspace-activation-control', 'staging', name), target = join(root, 'target_metadata_fixture');
  await mkdir(join(stage, 'live', 'main'), { recursive: true }); await mkdir(target);
  const files: { path: string; witness: { dev: string; ino: string; birthtimeNs: string; bytes: number; sha256: string } }[] = [];
  for (const path of names) {
    const bytes = Buffer.from('explicit metadata-only fixture ' + path);
    await writeFile(join(stage, path), bytes, { flag: 'wx' });
    files.push({ path, witness: { ...await physical(join(stage, path)), bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') } });
  }
  const attempt: WorkspaceActivationStagingAttempt = { activationId: 'metadata_fixture_activation', phase: 'prepared',
    staging: { name, directory: stage, physical: await physical(stage) },
    target: { targetId: 'target_metadata_fixture', directory: target, physical: await physical(target) },
    directories: ['live', 'live/main'], files };
  const inspect = (attempts: readonly WorkspaceActivationStagingAttempt[] = [attempt], limits = budgets) =>
    preflightWorkspaceActivationStaging({ applicationDirectory: root, attempts, budgets: limits });
  const publish = async (selected: readonly string[] = names) => {
    await mkdir(join(target, 'live', 'main'), { recursive: true });
    for (const path of selected) await rename(join(stage, path), join(target, path));
  };
  return { root, stage, target, attempt, inspect, publish };
}

test('metadata fixture: prepared full stage plus empty reserved target grants exact immutable paths', async t => {
  const f = await fixture(t), layout = await f.inspect();
  assert.deepEqual(layout.states, [{ name: f.attempt.staging.name, phase: 'prepared', location: 'stage' }]);
  assert.equal(layout.files.length, 3); assert.equal(layout.expectedFiles.size, 3);
  assert.ok(layout.controlledRoots.includes(f.target)); await layout.assertCurrent();
});
test('metadata fixture: prepared empty skeleton plus complete reserved target retains prepared status', async t => {
  const f = await fixture(t); await f.publish(); const layout = await f.inspect();
  assert.equal(layout.states[0].phase, 'prepared'); assert.equal(layout.states[0].location, 'target');
  assert.deepEqual([...layout.expectedFiles.keys()].sort(), names.map(path => join(f.target, path)).sort());
  await layout.assertCurrent();
});
test('metadata fixture: partial staged/published mixtures refuse without becoming commitment', async t => {
  const f = await fixture(t); await f.publish([names[0]]);
  await assert.rejects(f.inspect(), code('BACKUP_ACTIVATION_STAGING_UNRESOLVED'));
});
test('metadata fixture: unknown attempt names refuse before their contents can be examined', async t => {
  const f = await fixture(t), unknown = join(f.root, '.workspace-activation-control', 'staging', 'unissued');
  await mkdir(unknown); await writeFile(join(unknown, 'credential-never-admitted'), 'not read by metadata preflight');
  await assert.rejects(f.inspect(), code('BACKUP_ACTIVATION_STAGING_UNBOUND'));
});
test('metadata fixture: unknown encrypted-looking path and changed physical generation both refuse', async t => {
  const f = await fixture(t); await writeFile(join(f.stage, 'live', 'extra.encrypted.json'), 'unissued');
  await assert.rejects(f.inspect(), code('BACKUP_ACTIVATION_STAGING_UNBOUND'));
  await rm(join(f.stage, 'live', 'extra.encrypted.json'));
  await rename(join(f.stage, names[0]), join(f.stage, names[0] + '.retained'));
  await writeFile(join(f.stage, names[0]), 'changed generation');
  await assert.rejects(f.inspect(), code('BACKUP_ACTIVATION_CUSTODY_CHANGED'));
});
test('metadata fixture: committed staging ignores legitimate current target writer/private files', async t => {
  const f = await fixture(t); await f.publish();
  await writeFile(join(f.target, 'live', 'main', 'writer.lock'), 'current fixture writer');
  await mkdir(join(f.target, 'live', 'main', 'private-artifacts'), { recursive: true });
  await writeFile(join(f.target, 'live', 'main', 'private-artifacts', 'new.encrypted.json'), 'current fixture private ciphertext');
  const layout = await f.inspect([{ ...f.attempt, phase: 'committed' }]);
  assert.equal(layout.files.length, 0); assert.equal(layout.expectedFiles.size, 0);
  assert.ok(!layout.controlledRoots.includes(f.target)); assert.equal(layout.states[0].phase, 'committed');
  await layout.assertCurrent();
});
test('metadata fixture: aggregate byte and metadata-entry budgets refuse', async t => {
  const f = await fixture(t), sum = f.attempt.files.reduce((n, file) => n + file.witness.bytes, 0);
  await assert.rejects(f.inspect([f.attempt], { ...budgets, maxBytes: sum - 1 }), code('BACKUP_LIMIT'));
  await assert.rejects(f.inspect([f.attempt], { ...budgets, maxFiles: 4 }), code('BACKUP_LIMIT'));
});
test('metadata fixture: retained metadata guard detects changes after path issuance', async t => {
  const f = await fixture(t), layout = await f.inspect();
  await writeFile(join(f.stage, 'live', 'late.encrypted.json'), 'late unissued');
  await assert.rejects(layout.assertCurrent(), code('BACKUP_ACTIVATION_STAGING_UNBOUND'));
});
test('metadata fixture: same-inode same-size ciphertext writes change the retained metadata fence', async t => {
  const f = await fixture(t), layout = await f.inspect(), file = layout.files[0];
  const before = await physical(file.path);
  await writeFile(file.path, Buffer.alloc(file.witness.bytes, 0x7a));
  assert.deepEqual(await physical(file.path), before);
  assert.equal((await lstat(file.path)).size, file.witness.bytes);
  await assert.rejects(layout.assertCurrent(), code('BACKUP_ACTIVATION_CUSTODY_CHANGED'));
});

class InjectedProtocolStorage implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  envelope: VaultEnvelope | null = null;
  async load() { return structuredClone(this.envelope); }
  async commit(envelope: VaultEnvelope, expected: number | null) {
    assert.equal(this.envelope?.revision ?? null, expected); this.envelope = structuredClone(envelope);
  }
  async delete() { this.envelope = null; }
  async close() {}
}
async function journalProtocolFixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-staging-journal-protocol-'));
  let source: Vault | undefined, journal: Vault | undefined;
  t.after(async () => { try { await source?.close(); await journal?.close(); } finally { await removeFixtureRoot(root); } });
  const sourceStorage = new InjectedProtocolStorage(), journalStorage = new InjectedProtocolStorage();
  source = (await Vault.create({ directory: join(root, 'main'), storage: sourceStorage,
    name: 'Explicit injected source fixture', passphrase: 'synthetic-fixture-passphrase-only' })).vault;
  journal = (await Vault.create({ directory: join(root, 'journal'), storage: journalStorage,
    name: 'Explicit injected journal fixture', passphrase: 'synthetic-fixture-passphrase-only' })).vault;
  let mismatchedLease = false;
  const authority = () => ({ creationId: 'injected_journal_creation', vaultId: journal!.vaultId, revision: journal!.read().revision,
    envelopeDigest: createHash('sha256').update(JSON.stringify(journalStorage.envelope)).digest('hex') });
  const nativeLease: PostgresSnapshotLease = { slot: 'injected_journal_slot', active: true,
    query: async () => { throw new Error('This explicitly injected protocol fixture never executes native SQL.'); },
    load: () => journalStorage.load(), commit: (value, expected) => journalStorage.commit(value, expected),
    authority: async () => authority(), assertCurrent: async expected => { assert.deepEqual(authority(), expected); } };
  const adapter = { withLease: async <T>(work: (lease: PostgresSnapshotLease) => Promise<T>) => work(nativeLease) } as unknown as PostgresSnapshotAdapter;
  const custody = { withSource: async <T>(work: (lease: any) => Promise<T>) => {
    const expected = authority(); return work({ lease: mismatchedLease ? { ...nativeLease } : nativeLease,
      storage: { slot: nativeLease.slot }, authority: expected,
      assertCurrent: async () => { assert.deepEqual(authority(), expected); } });
  } } as unknown as WorkspacePostgresCustody;
  const inventory = new WorkspaceActivationStagingInventory({ sourceVault: source, journalVault: journal,
    journalAdapter: adapter, journalPostgres: custody, applicationDirectory: root, budgets });
  return { root, source, journal, inventory, mismatch: () => { mismatchedLease = true; } };
}

test('actual Vault crypto with injected journal protocol: identity and bounded envelope accounting retain callback custody', async t => {
  const f = await journalProtocolFixture(t);
  f.inventory.assertBinding(f.source, f.root);
  assert.throws(() => f.inventory.assertBinding(f.journal, f.root), code('BACKUP_ACTIVATION_SCOPE'));
  let escaped: WorkspaceActivationStagingInventoryLease | undefined;
  await f.source.snapshot(() => f.inventory.withInventory(async held => {
    escaped = held; assert.deepEqual(held.attempts, []); assert.ok(held.journalAuthorityBytes > 0);
    assert.equal(held.journalArtifactBytes, 0); await held.assertCurrent();
  }));
  await assert.rejects(escaped!.assertCurrent(), code('BACKUP_SOURCE_LEASE_REQUIRED'));
});
test('actual Vault crypto with injected journal protocol: another transaction object cannot authenticate the journal', async t => {
  const f = await journalProtocolFixture(t); f.mismatch();
  await assert.rejects(f.source.snapshot(() => f.inventory.withInventory(async () => {})), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
});
test('actual Vault crypto with injected journal protocol: oversized reservation refuses before malformed contents are decrypted', async t => {
  const f = await journalProtocolFixture(t), directory = join(f.source.directory, 'private-artifacts', 'workspace-interchange');
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `wit_${'a'.repeat(64)}_reservation.encrypted.json`), Buffer.alloc(budgets.maxBytes + 1, 0));
  await assert.rejects(f.source.snapshot(() => f.inventory.withInventory(async () => {})), code('BACKUP_LIMIT'));
});
