import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, lstat, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { Vault, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspaceActivationStagingInventory } from '../runtime/workspace-activation-staging-inventory.ts';
import type { PostgresSnapshotAdapter, PostgresSnapshotLease } from '../runtime/postgres.ts';
import type { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';

// Actual Vault encryption and C-only files, based on the existing staging
// protocol fixture. SQL/native exclusion is authored offline protocol evidence;
// query() throws if invoked. No native PostgreSQL qualification is claimed.
const purpose = 'workspace-interchange' as const;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const physical = async (path: string) => {
  const stat = await lstat(path, { bigint: true });
  return { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) };
};
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
async function fixture(t: TestContext) {
  const scratch = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(scratch, /^C:[\\/]/i);
  const root = await realpath(await mkdtemp(join(scratch, 'chausar-identity-reads-')));
  assert.equal(dirname(root), scratch);
  let source: Vault | undefined, journal: Vault | undefined;
  t.after(async () => {
    try { await source?.close(); await journal?.close(); }
    finally {
      const actual = await realpath(root), child = relative(scratch, actual);
      assert.equal(dirname(actual), scratch);
      assert.ok(child.startsWith('chausar-identity-reads-') && !child.startsWith('..') && !isAbsolute(child));
      await rm(actual, { recursive: true, force: true });
    }
  });
  const sourceStorage = new InjectedProtocolStorage(), journalStorage = new InjectedProtocolStorage();
  source = (await Vault.create({ directory: join(root, 'main'), storage: sourceStorage,
    name: 'Synthetic identity read source', passphrase: 'synthetic-identity-read-passphrase' })).vault;
  journal = (await Vault.create({ directory: join(root, 'journal'), storage: journalStorage,
    name: 'Synthetic identity read journal', passphrase: 'synthetic-identity-read-passphrase' })).vault;
  const sourceVault = source, journalVault = journal;
  const authority = () => ({ creationId: 'injected_identity_journal_creation', vaultId: journalVault.vaultId,
    revision: journalVault.read().revision, envelopeDigest: sha(JSON.stringify(journalStorage.envelope)) });
  const nativeLease: PostgresSnapshotLease = { slot: 'injected_identity_journal_slot', active: true,
    query: async () => { throw new Error('Offline identity fixture must never execute SQL.'); },
    load: () => journalStorage.load(), commit: (value, expected) => journalStorage.commit(value, expected),
    authority: async () => authority(), assertCurrent: async expected => { assert.deepEqual(authority(), expected); } };
  const adapter = { withLease: async <T>(work: (lease: PostgresSnapshotLease) => Promise<T>) => work(nativeLease) } as unknown as PostgresSnapshotAdapter;
  const custody = { withSource: async <T>(work: (lease: unknown) => Promise<T>) => {
    const expected = authority(); return work({ lease: nativeLease, storage: { slot: nativeLease.slot }, authority: expected,
      assertCurrent: async () => { assert.deepEqual(authority(), expected); } });
  } } as unknown as WorkspacePostgresCustody;
  const inventory = new WorkspaceActivationStagingInventory({ sourceVault, journalVault, journalAdapter: adapter,
    journalPostgres: custody, applicationDirectory: root, budgets: { maxFiles: 64, maxBytes: 1024 * 1024, maxDepth: 8 } });
  const claims: Record<string, unknown>[] = [];
  const seed = async (index: number) => {
    const targetId = `target_identity_${index}`, activationId = `identity_activation_${index}`, candidateId = `identity_candidate_${index}`;
    const candidateCreationId = `identity_creation_${index}`, targetDirectory = join(root, targetId);
    await mkdir(targetDirectory);
    const sourceWorkspaceId = sourceVault.read().workspace.id;
    const reservation = { format: 'chausar.interchange-target-reservation.v1', sourceVaultId: sourceVault.vaultId,
      sourceWorkspaceId, targetId, workspaceId: `workspace_identity_${index}`, generation: `generation_identity_${index}`,
      contextDigest: sha(`identity_context_${index}`), physical: await physical(targetDirectory) };
    const reservationRef = await sourceVault.writeArtifact({ id: `wit_${sha(targetId)}_reservation`, purpose,
      value: reservation, expectedDigest: null });
    const claim = { format: 'chausar.activation-local-claim.v1', sourceVaultId: sourceVault.vaultId,
      activationId, candidateId, candidateCreationId, pinDigest: sha(`identity_pin_${index}`) };
    const record = { format: 'chausar.workspace-activation.v1', status: 'committed', activationId, candidateId, candidateCreationId,
      candidateDigest: sha(`identity_candidate_${index}`), pinDigest: claim.pinDigest, contextDigest: reservation.contextDigest,
      sourceInventoryDigest: sha(`identity_source_${index}`), targetProofDigest: sha(`identity_target_${index}`),
      targetId, workspaceId: reservation.workspaceId, projectionDigest: sha(`identity_projection_${index}`),
      authorityDigest: sha(`identity_authority_${index}`), stateDigest: sha(`identity_state_${index}`), evidenceDigest: sha(`identity_evidence_${index}`) };
    await journalVault.writeArtifact({ id: `wal_${sha(`${sourceVault.vaultId}:${candidateCreationId}`)}_candidate`, purpose,
      value: claim, expectedDigest: null });
    await journalVault.writeArtifact({ id: `wal_${sha(activationId)}_attempt`, purpose, expectedDigest: null,
      value: { format: 'chausar.activation-local-journal.v1', phase: 'failed', sourceVaultId: sourceVault.vaultId,
        sourceWorkspaceId, journalVaultId: journalVault.vaultId, record, claim, reservation, reservationRef } });
    claims.push(claim);
    let expectedDigest: string | null = null;
    if (claims.length > 1) expectedDigest = (await journalVault.readArtifact({ id: 'wal_ledger_v1', purpose })).valueDigest;
    await journalVault.writeArtifact({ id: 'wal_ledger_v1', purpose, expectedDigest,
      value: { format: 'chausar.activation-local-ledger.v1', claims } });
  };
  const unrelated = await journalVault.writeArtifact({ id: 'unrelated_identity_guard', purpose,
    value: { synthetic: true, phase: 'discarded' }, expectedDigest: null });
  return { root, source: sourceVault, journal: journalVault, sourceStorage, inventory, seed, unrelated };
}
async function ciphertexts(vault: Vault) {
  const directory = join(vault.directory, 'private-artifacts', purpose), files: { name: string; bytes: Buffer }[] = [];
  for (const name of (await readdir(directory)).sort()) {
    assert.match(name, /^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/);
    files.push({ name, bytes: await readFile(join(directory, name)) });
  }
  return files;
}
async function measure(t: TestContext, f: Awaited<ReturnType<typeof fixture>>, records: number) {
  const sourceBefore = f.source.read(), sourceBytes = await ciphertexts(f.source), journalBytes = await ciphertexts(f.journal);
  const read = f.source.read, capture = f.journal.captureEncryptedCustody;
  let fullStateReads = 0;
  const completeCaptures: { artifactCount: number; unrelatedPresent: boolean }[] = [];
  const readHook = t.mock.method(f.source, 'read', function (this: Vault) {
    fullStateReads++; return Reflect.apply(read, this, []);
  });
  const captureHook = t.mock.method(f.journal, 'captureEncryptedCustody', async function (this: Vault, ...args: Parameters<Vault['captureEncryptedCustody']>) {
    const actual = await Reflect.apply(capture, this, args);
    completeCaptures.push({ artifactCount: actual.artifacts.length,
      unrelatedPresent: actual.artifacts.some(item => item.ref.id === f.unrelated.id) });
    return actual;
  });
  try {
    await f.source.snapshot(() => f.inventory.withInventory(async held => {
      assert.deepEqual(held.attempts, [], 'Failed durable WAL records grant no staged paths.');
      assert.ok(held.journalAuthorityBytes > 0 && held.journalArtifactBytes > 0);
    }));
  } finally { captureHook.mock.restore(); readHook.mock.restore(); }
  assert.equal(f.source.read, read); assert.equal(f.journal.captureEncryptedCustody, capture);
  assert.equal(completeCaptures.length, 2, 'Keep both complete independently authenticated journal captures.');
  for (const observed of completeCaptures) {
    assert.equal(observed.artifactCount, 2 * records + 2, 'Both captures include every WAL, paired claim, ledger and unrelated artifact.');
    assert.equal(observed.unrelatedPresent, true);
  }
  assert.deepEqual(await ciphertexts(f.source), sourceBytes);
  assert.deepEqual(await ciphertexts(f.journal), journalBytes);
  assert.deepEqual(f.source.read(), sourceBefore);
  return { records, fullStateReads, completeCaptures };
}

test('offline encrypted staging: scalar reservation and WAL identities do not add whole-State reads', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await f.seed(1); const one = await measure(t, f, 1);
  for (const index of [2, 3, 4]) await f.seed(index);
  const four = await measure(t, f, 4);
  t.diagnostic(JSON.stringify({ one, four, nativeExecution: false }));
  assert.equal(four.fullStateReads, one.fullStateReads,
    'More authenticated scalar identities must not create more full State reads; complete source-state fences remain.');
  assert.equal(one.fullStateReads, 2, 'Retain the initial and final complete source State fences.');
});

test('offline encrypted staging controls: same-revision journal mutation and accepted source-state mutation refuse at final fences', { timeout: 30_000 }, async t => {
  for (const kind of ['journal-artifact', 'source-state'] as const) await t.test(kind, async sub => {
    const f = await fixture(sub); await f.seed(1);
    const before = f.source.read(), journalRevision = f.journal.read().revision;
    let completeCaptures = 0;
    const capture = f.journal.captureEncryptedCustody;
    const hook = sub.mock.method(f.journal, 'captureEncryptedCustody', async function (this: Vault, ...args: Parameters<Vault['captureEncryptedCustody']>) {
      completeCaptures++; return Reflect.apply(capture, this, args);
    });
    try {
      const inspect = () => f.inventory.withInventory(async () => {
        if (kind === 'journal-artifact') await f.journal.writeArtifact({ id: f.unrelated.id, purpose,
          expectedDigest: f.unrelated.valueDigest, value: { synthetic: true, phase: 'changed_discarded' } });
        else await f.source.update(state => { state.workspace.name = 'Actually accepted newer source State'; });
      });
      // The artifact control holds the normal outer source queue. The source
      // control isolates this staging capability without that additional queue,
      // allowing an actual accepted update between its before/after fences.
      await assert.rejects(kind === 'journal-artifact' ? f.source.snapshot(inspect) : inspect(), { code: 'BACKUP_ACTIVATION_JOURNAL_CHANGED' });
    } finally { hook.mock.restore(); }
    assert.equal(f.journal.read().revision, journalRevision, 'Inert artifact writes need not advance State revision.');
    if (kind === 'journal-artifact') {
      assert.equal(completeCaptures, 2, 'An unrelated artifact participates in both complete authenticated captures.');
      assert.deepEqual(f.source.read(), before);
      assert.notEqual((await f.journal.readArtifact(f.unrelated)).valueDigest, f.unrelated.valueDigest);
    } else {
      assert.equal(completeCaptures, 1, 'The complete source-state check refuses before the journal after-fence is needed.');
      assert.equal(f.source.read().revision, before.revision + 1);
      assert.equal(f.source.read().workspace.name, 'Actually accepted newer source State');
    }
  });
});

type Identity = Readonly<{ vaultId: string; workspaceId: string; revision: number }>;
type IdentityVault = Vault & { readIdentity(): Identity };
test('offline encrypted Vault identity: fresh detached scalars and closing or closed refusal follow actual accepted updates', { timeout: 30_000 }, async t => {
  const f = await fixture(t), vault = f.source as IdentityVault;
  assert.equal(typeof vault.readIdentity, 'function', 'The trusted scalar accessor is required alongside the staging performance regression.');
  const state = vault.read(), first = vault.readIdentity();
  assert.deepEqual(Object.keys(first).sort(), ['revision', 'vaultId', 'workspaceId']);
  assert.deepEqual(first, { vaultId: vault.vaultId, workspaceId: state.workspace.id, revision: state.revision });
  Reflect.set(first, 'workspaceId', 'caller_mutation'); Reflect.set(first, 'revision', -1);
  assert.equal(vault.readIdentity().workspaceId, state.workspace.id);
  assert.equal(vault.readIdentity().revision, state.revision);
  await vault.update(draft => { draft.workspace.name = 'Actually accepted identity update'; });
  assert.equal(vault.readIdentity().revision, state.revision + 1);
  assert.equal(vault.readIdentity().workspaceId, state.workspace.id);
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(yes => { entered = yes; }), gate = new Promise<void>(yes => { release = yes; });
  const original = f.sourceStorage.commit;
  const hook = t.mock.method(f.sourceStorage, 'commit', async function (this: InjectedProtocolStorage, ...args: Parameters<InjectedProtocolStorage['commit']>) {
    entered(); await gate; return Reflect.apply(original, this, args);
  });
  const accepted = vault.update(draft => { draft.workspace.name = 'Accepted update before closing'; });
  try {
    await started; const closing = vault.close();
    assert.throws(() => vault.readIdentity(), { code: 'VAULT_CLOSED' });
    release(); await accepted; await closing;
    assert.throws(() => vault.readIdentity(), { code: 'VAULT_CLOSED' });
    assert.equal(f.sourceStorage.envelope!.revision, state.revision + 2, 'Closing drains the already accepted update.');
  } finally { release(); await accepted.catch(() => {}); hook.mock.restore(); }
});
