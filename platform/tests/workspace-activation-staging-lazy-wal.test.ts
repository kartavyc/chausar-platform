import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { check, hash } from '../runtime/contracts.ts';
import { Vault, type EncryptedSnapshotAdapter, type PrivateArtifactRef,
  type VaultEnvelope } from '../runtime/vault.ts';
import type { PostgresSnapshotAdapter, PostgresSnapshotLease } from '../runtime/postgres.ts';
import type { WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { WorkspaceActivationStagingInventory, type WorkspaceActivationStagingInventoryLease } from '../runtime/workspace-activation-staging-inventory.ts';

// Real Vault encryption and filesystem custody, explicitly injected journal SQL
// protocol only. These tests neither execute native SQL nor qualify activation.
const purpose = 'workspace-interchange' as const;
const budgets = { maxFiles: 64, maxBytes: 1024 * 1024, maxDepth: 8 };
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => sha(canonical(value));
const code = (expected: string) => (error: any) => error?.code === expected;
const key = (ref: Pick<PrivateArtifactRef, 'purpose' | 'id'>) => `${ref.purpose}/${ref.id}`;
const physical = async (path: string) => {
  const value = await lstat(path, { bigint: true });
  return { dev: String(value.dev), ino: String(value.ino), birthtimeNs: String(value.birthtimeNs) };
};

class InjectedJournalStorage implements EncryptedSnapshotAdapter {
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
  const root = await mkdtemp(join(tmpdir(), 'chausar-lazy-wal-protocol-'));
  let source: Vault | undefined, journal: Vault | undefined;
  t.after(async () => {
    try { await source?.close(); await journal?.close(); }
    finally {
      assert.equal(resolve(root), root);
      assert.ok(root.startsWith(join(tmpdir(), 'chausar-lazy-wal-protocol-')));
      await rm(root, { recursive: true, force: true });
    }
  });
  const sourceStorage = new InjectedJournalStorage(), journalStorage = new InjectedJournalStorage();
  source = (await Vault.create({ directory: join(root, 'main'), storage: sourceStorage,
    name: 'Synthetic lazy WAL source', passphrase: 'synthetic-protocol-passphrase-only' })).vault;
  journal = (await Vault.create({ directory: join(root, 'journal'), storage: journalStorage,
    name: 'Synthetic lazy WAL journal', passphrase: 'synthetic-protocol-passphrase-only' })).vault;
  const sourceVault = source, journalVault = journal;
  let incarnation = 0;
  const authority = () => ({ creationId: `injected_journal_creation_${incarnation}`, vaultId: journalVault.vaultId,
    revision: journalVault.read().revision, envelopeDigest: sha(JSON.stringify(journalStorage.envelope)) });
  const nativeLease: PostgresSnapshotLease = { slot: 'injected_journal_slot', active: true,
    query: async () => { throw new Error('Injected journal protocol never executes native SQL.'); },
    load: () => journalStorage.load(), commit: (value, expected) => journalStorage.commit(value, expected),
    authority: async () => authority(), assertCurrent: async expected => {
      check(canonical(authority()) === canonical(expected), 'BACKUP_ACTIVATION_JOURNAL_CHANGED', 'Injected native journal incarnation changed.');
    } };
  const adapter = { withLease: async <T>(work: (lease: PostgresSnapshotLease) => Promise<T>) => work(nativeLease) } as unknown as PostgresSnapshotAdapter;
  const custody = { withSource: async <T>(work: (lease: any) => Promise<T>) => {
    const expected = authority();
    return work({ lease: nativeLease, storage: { slot: nativeLease.slot }, authority: expected,
      assertCurrent: () => nativeLease.assertCurrent(expected) });
  } } as unknown as WorkspacePostgresCustody;
  const inventory = new WorkspaceActivationStagingInventory({ sourceVault, journalVault,
    journalAdapter: adapter, journalPostgres: custody, applicationDirectory: root, budgets });
  const path = (ref: Pick<PrivateArtifactRef, 'purpose' | 'id'>) => join(journalVault.directory, 'private-artifacts', ref.purpose, `${ref.id}.encrypted.json`);
  const put = (id: string, value: unknown, expectedDigest: string | null = null) => journalVault.writeArtifact({ id, purpose, value, expectedDigest });
  const inspect = <T>(work: (lease: WorkspaceActivationStagingInventoryLease) => Promise<T>) => sourceVault.snapshot(() => inventory.withInventory(work));
  const observe = () => {
    const reads: string[] = [], captures: string[][] = [];
    const originalRead = journalVault.readArtifact.bind(journalVault);
    const originalCapture = journalVault.captureEncryptedCustody.bind(journalVault);
    t.mock.method(journalVault, 'readArtifact', async (input: Parameters<Vault['readArtifact']>[0]) => { reads.push(key(input)); return originalRead(input); });
    t.mock.method(journalVault, 'captureEncryptedCustody', async (input: Parameters<Vault['captureEncryptedCustody']>[0]) => {
      const captured = await originalCapture(input); captures.push(captured.artifacts.map(item => key(item.ref))); return captured;
    });
    return { reads, captures, reset: () => { reads.length = 0; captures.length = 0; }, originalCapture };
  };
  return { root, source: sourceVault, journal: journalVault, inventory, nativeLease, path, put, inspect, observe,
    advanceNativeIncarnation: () => { incarnation++; } };
}

async function prepared(f: Awaited<ReturnType<typeof fixture>>) {
  const activationId = 'synthetic_prepared_activation', candidateCreationId = 'synthetic_candidate_creation';
  const targetId = 'synthetic_target', workspaceId = 'synthetic_target_workspace';
  const target = join(f.root, targetId), stageName = 'attempt_11111111-1111-4111-8111-111111111111';
  const stage = join(f.root, '.workspace-activation-control', 'staging', stageName);
  await mkdir(target); await mkdir(join(stage, 'live'), { recursive: true });
  const pin = { syntheticFixture: true }, authority = { syntheticFixture: true };
  const state = f.source.read(); state.workspace.id = workspaceId; state.revision = 0;
  const evidence = { format: 'chausar.workspace-activation-evidence.v1', inert: true, pin, syntheticFixture: true };
  const contextDigest = sha('synthetic_context');
  const reservation = { format: 'chausar.interchange-target-reservation.v1', sourceVaultId: f.source.vaultId,
    sourceWorkspaceId: f.source.read().workspace.id, targetId, workspaceId, generation: 'synthetic_generation', contextDigest,
    physical: await physical(target) };
  const reservationRef = await f.source.writeArtifact({ id: `wit_${sha(targetId)}_reservation`, purpose,
    value: reservation, expectedDigest: null });
  const claim = { format: 'chausar.activation-local-claim.v1', sourceVaultId: f.source.vaultId,
    activationId, candidateId: 'synthetic_candidate', candidateCreationId, pinDigest: digest(pin) };
  const record = { format: 'chausar.workspace-activation.v1', status: 'committed', activationId,
    candidateId: claim.candidateId, candidateCreationId, candidateDigest: sha('synthetic_candidate_digest'), pinDigest: claim.pinDigest,
    contextDigest, sourceInventoryDigest: sha('synthetic_inventory'), targetProofDigest: sha('synthetic_target_proof'), targetId,
    workspaceId, projectionDigest: sha('synthetic_projection'), authorityDigest: digest(authority), stateDigest: hash(state), evidenceDigest: digest(evidence) };
  const bootstrap = await f.put(`wal_${sha(activationId)}_bootstrap`, { record, state, authority });
  const evidenceRef = await f.put(`wal_${sha(activationId)}_evidence`, evidence);
  const files = [];
  for (const [name, ref] of [['activation-bootstrap.encrypted.json', bootstrap], ['activation-evidence.encrypted.json', evidenceRef]] as const) {
    const bytes = await readFile(f.path(ref)); await writeFile(join(stage, name), bytes, { flag: 'wx' });
    files.push({ path: name, witness: { ...await physical(join(stage, name)), bytes: bytes.length, sha256: sha(bytes) } });
  }
  const ledger = await f.put('wal_ledger_v1', { format: 'chausar.activation-local-ledger.v1', claims: [claim] });
  const candidate = await f.put(`wal_${sha(`${f.source.vaultId}:${candidateCreationId}`)}_candidate`, claim);
  const attemptValue = { format: 'chausar.activation-local-journal.v1', phase: 'prepared', sourceVaultId: f.source.vaultId,
    sourceWorkspaceId: f.source.read().workspace.id, journalVaultId: f.journal.vaultId, record, claim, reservation,
    reservationRef, staging: { name: stageName, physical: await physical(stage) }, qualification: 'test-fixture',
    files, directories: ['live'], bootstrap, evidence: evidenceRef };
  const attempt = await f.put(`wal_${sha(activationId)}_attempt`, attemptValue);
  const unrelated = await f.put(`wac_${sha('synthetic_unrelated_candidate')}_capture`, { syntheticFixture: true, unrelated: 'not a local WAL dependency' });
  const privateTrial = await f.journal.writeArtifact({ id: 'synthetic_private_trial', purpose: 'private-trial',
    value: { syntheticFixture: true, unrelated: 'different complete-capture namespace' }, expectedDigest: null });
  const orphanClaim = await f.put(`wal_${sha('synthetic_orphan_claim')}_candidate`, { syntheticFixture: true, orphan: true });
  return { activationId, attempt, attemptValue, bootstrap, evidence: evidenceRef, candidate, claim, ledger, unrelated,
    all: [bootstrap, evidenceRef, ledger, candidate, attempt, unrelated, privateTrial, orphanClaim],
    relevant: [bootstrap, evidenceRef, ledger, candidate, attempt].map(key).sort() };
}

test('lazy WAL: unrelated-only journals retain complete before/after capture and escaped-capability refusal without middle payload reads', async t => {
  const f = await fixture(t);
  const refs = [await f.put('wac_synthetic_unrelated', { syntheticFixture: true, large: 'x'.repeat(1024) }),
    await f.journal.writeArtifact({ id: 'synthetic_private_trial', purpose: 'private-trial', value: { syntheticFixture: true }, expectedDigest: null })];
  const seen = f.observe(); let escaped: WorkspaceActivationStagingInventoryLease | undefined;
  await f.inspect(async held => { escaped = held; assert.deepEqual(held.attempts, []); });
  assert.deepEqual(seen.reads, []);
  assert.equal(seen.captures.length, 2);
  for (const captured of seen.captures) assert.deepEqual(captured.sort(), refs.map(key).sort());
  await assert.rejects(escaped!.assertCurrent(), code('BACKUP_SOURCE_LEASE_REQUIRED'));
});

test('lazy WAL: actual prepared artifacts retain exact dependency reads and complete custody invariants', async t => {
  const f = await fixture(t), p = await prepared(f), seen = f.observe();
  const sourceState = hash(f.source.read()), journalState = hash(f.journal.read());

  await t.test('the middle pass reads only all five exact WAL dependencies once while both captures authenticate every artifact', async () => {
    await f.inspect(async held => { assert.equal(held.attempts.length, 1); assert.equal(held.attempts[0].phase, 'prepared'); });
    assert.deepEqual([...seen.reads].sort(), p.relevant);
    assert.equal(new Set(seen.reads).size, seen.reads.length);
    assert.equal(seen.captures.length, 2);
    for (const captured of seen.captures) assert.deepEqual([...captured].sort(), p.all.map(key).sort());
  });

  await t.test('fresh invocations reread changed ledger payloads even when both State revisions are unchanged', async () => {
    seen.reset();
    const original = await readFile(f.path(p.ledger));
    try {
      await f.put(p.ledger.id, { format: 'chausar.activation-local-ledger.v1', claims: [] }, p.ledger.valueDigest);
      assert.equal(hash(f.journal.read()), journalState);
      await assert.rejects(f.inspect(async () => { assert.fail('Changed ledger must prevent callback admission.'); }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
      assert.equal(seen.reads.filter(value => value === key(p.ledger)).length, 1);
    } finally { await writeFile(f.path(p.ledger), original); }
    seen.reset(); await f.inspect(async held => { assert.equal(held.attempts.length, 1); });
    assert.deepEqual([...seen.reads].sort(), p.relevant);
  });

  await t.test('attempted and failed records still authenticate their ledger and paired claim without opening prepared payloads', async () => {
    const original = await readFile(f.path(p.attempt)), candidateBytes = await readFile(f.path(p.candidate));
    for (const phase of ['attempted', 'failed']) {
      try {
        await f.put(p.attempt.id, { ...p.attemptValue, phase }, p.attempt.valueDigest);
        seen.reset(); await f.inspect(async held => { assert.deepEqual(held.attempts, []); });
        assert.deepEqual([...seen.reads].sort(), [p.ledger, p.attempt, p.candidate].map(key).sort());
        assert.equal(seen.captures.length, 2);
        await f.put(p.candidate.id, { ...p.claim, pinDigest: sha('synthetic_mismatched_partial_claim') }, p.candidate.valueDigest);
        await assert.rejects(f.inspect(async () => { assert.fail(`An invalid ${phase} paired claim must refuse.`); }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
      } finally {
        await writeFile(f.path(p.attempt), original); await writeFile(f.path(p.candidate), candidateBytes);
      }
    }
  });

  await t.test('each missing ledger, paired claim, bootstrap or evidence dependency prevents admission', async () => {
    for (const ref of [p.ledger, p.candidate, p.bootstrap, p.evidence]) {
      const original = await readFile(f.path(ref));
      try {
        await unlink(f.path(ref));
        await assert.rejects(f.inspect(async () => { assert.fail(`Missing ${ref.id} must refuse.`); }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
      } finally { await writeFile(f.path(ref), original); }
    }
  });

  await t.test('an authenticated attempt with a mismatched exact bootstrap ref still refuses', async () => {
    const original = await readFile(f.path(p.attempt));
    try {
      await f.put(p.attempt.id, { ...p.attemptValue, bootstrap: { ...p.bootstrap, diskBytes: p.bootstrap.diskBytes + 1 } }, p.attempt.valueDigest);
      await assert.rejects(f.inspect(async () => { assert.fail('Mismatched authenticated ref must refuse.'); }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
    } finally { await writeFile(f.path(p.attempt), original); }
  });

  await t.test('a relevant ref replacement between initial capture and lazy read cannot be served from captured plaintext', async () => {
    const original = await readFile(f.path(p.candidate));
    const capture = f.journal.captureEncryptedCustody.bind(f.journal); let first = true;
    const mock = t.mock.method(f.journal, 'captureEncryptedCustody', async (input: Parameters<Vault['captureEncryptedCustody']>[0]) => {
      const captured = await capture(input);
      if (first) { first = false; await f.put(p.candidate.id, { ...p.claim, pinDigest: sha('synthetic_changed_pin') }, p.candidate.valueDigest); }
      return captured;
    });
    try {
      await assert.rejects(f.inspect(async () => { assert.fail('Changed middle ref must prevent admission.'); }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
      assert.equal(hash(f.journal.read()), journalState);
    } finally { mock.mock.restore(); await writeFile(f.path(p.candidate), original); }
  });

  await t.test('unrelated ciphertext corruption before inventory admission is still authenticated and refused', async () => {
    const original = await readFile(f.path(p.unrelated));
    try {
      await writeFile(f.path(p.unrelated), Buffer.alloc(original.length, 0x7a));
      await assert.rejects(f.inspect(async () => { assert.fail('Complete initial capture must refuse unrelated corruption.'); }), code('ARTIFACT_AUTHENTICATION_FAILED'));
    } finally { await writeFile(f.path(p.unrelated), original); }
  });

  await t.test('awaited callbacks cannot hide unrelated authentic replacement, added refs or removed refs from final custody', async () => {
    const original = await readFile(f.path(p.unrelated));
    for (const mutation of ['replace', 'add', 'remove'] as const) {
      let added: PrivateArtifactRef | undefined;
      try {
        await assert.rejects(f.inspect(async held => {
          assert.equal(held.attempts.length, 1); await Promise.resolve();
          if (mutation === 'replace') await f.put(p.unrelated.id, { syntheticFixture: true, changed: true }, p.unrelated.valueDigest);
          if (mutation === 'add') added = await f.put('wac_synthetic_added_after_capture', { syntheticFixture: true });
          if (mutation === 'remove') await unlink(f.path(p.unrelated));
          assert.equal(hash(f.journal.read()), journalState);
        }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
      } finally {
        await writeFile(f.path(p.unrelated), original);
        if (added) await unlink(f.path(added));
      }
    }
  });

  await t.test('current native journal authority remains mandatory after awaited work', async () => {
    await assert.rejects(f.inspect(async held => {
      assert.equal(held.attempts.length, 1); await Promise.resolve(); f.advanceNativeIncarnation();
      assert.equal(hash(f.journal.read()), journalState);
    }), code('BACKUP_ACTIVATION_JOURNAL_CHANGED'));
  });
  assert.equal(hash(f.source.read()), sourceState);
});
