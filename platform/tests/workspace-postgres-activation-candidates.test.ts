import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, check, ChausarError, type Context } from '../runtime/contracts.ts';
import { acquireProcessLock } from '../runtime/process-lock.ts';
import { safeDirectory, Vault, type EncryptedSnapshotAdapter, type PrivateArtifactRef, type VaultEnvelope } from '../runtime/vault.ts';
import { canonicalInterchangeJson, captureWorkspaceInterchange, interchangeDigest } from '../runtime/workspace-interchange.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import type { WorkspaceInterchangeCustodyRecord } from '../runtime/workspace-interchange-host.ts';
import type { WorkspaceBackupActivationLease, WorkspaceBackupActivationSelection } from '../runtime/workspace-backup-activation.ts';
import { WorkspacePostgresActivationCandidates, type WorkspacePostgresActivationCandidateOptions,
  type WorkspacePostgresBackupActivationOriginals } from '../runtime/workspace-activation-postgres.ts';
import type { PostgresSourceCustodyLease, WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { artifactsFor, deterministicShopState, emptyTarget, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

// Real Vault encryption and filesystem custody; injected SQL exclusion only.
// This file is protocol-fixture evidence, never native PostgreSQL qualification.
const purpose = 'workspace-interchange' as const;
const passphrase = 'Synthetic PostgreSQL activation candidate custody passphrase';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const candidateArtifactId = (id: string, part: string) => `wac_${sha(id)}_${part}`;
const reference = ({ id, purpose, valueDigest, diskBytes }: PrivateArtifactRef): PrivateArtifactRef => ({ id, purpose, valueDigest, diskBytes });
type Qualification = 'test-fixture' | 'encrypted-local-host';

class EncryptedMemoryAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  envelope: VaultEnvelope | null = null;
  async load() { return structuredClone(this.envelope); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
    check((this.envelope?.revision ?? null) === expectedRevision, 'REVISION_CONFLICT', 'Synthetic encrypted authority changed.');
    this.envelope = structuredClone(envelope);
  }
  async delete() { this.envelope = null; }
}

async function fixture(t: TestContext) {
  const scratch = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(scratch, /^C:[\\/]/i, 'Validate canonical C scratch before creating any mutable fixture.');
  const applicationDirectory = await realpath(await mkdtemp(join(scratch, 'chausar-postgres-candidate-')));
  assert.equal(dirname(applicationDirectory), scratch);
  const vaults = new Set<Vault>();
  t.after(async () => {
    for (const vault of vaults) await vault.close();
    const actual = await realpath(applicationDirectory), child = relative(scratch, actual);
    assert.equal(dirname(actual), scratch);
    assert.ok(child && child.startsWith('chausar-postgres-candidate-') && !child.startsWith('..') && !isAbsolute(child));
    await rm(actual, { recursive: true, force: true });
  });
  const adapter = new EncryptedMemoryAdapter();
  const sourceVault = (await Vault.create({ directory: join(applicationDirectory, 'source'), name: 'Synthetic PG source',
    passphrase, storage: adapter, demo: true })).vault;
  vaults.add(sourceVault);
  await sourceVault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id; Object.assign(draft, state);
  });
  let journalVault = (await Vault.create({ directory: join(applicationDirectory, 'journal'), name: 'Synthetic candidate journal',
    passphrase, storage: 'experimental-file', demo: true })).vault;
  vaults.add(journalVault);
  const faults = { ready: true, sourceCreationId: 'source_creation_fixture_1', storageId: 'storage_fixture_1',
    backupQualification: 'test-fixture' as Qualification, materialQualification: 'test-fixture' as Qualification };
  const events: string[] = [];
  const sourceScope = new AsyncLocalStorage<boolean>(), nativeScope = new AsyncLocalStorage<PostgresSourceCustodyLease>();
  const storageIdentity = () => ({ storageId: faults.storageId, databaseOid: '16384', database: 'synthetic_fixture',
    serverAddress: '127.0.0.1', serverPort: 54321, slot: 'synthetic_source' });
  const nativeAuthority = () => ({ creationId: faults.sourceCreationId, vaultId: sourceVault.vaultId,
    revision: sourceVault.read().revision, envelopeDigest: sha(JSON.stringify(adapter.envelope)) });
  const admit = (context: Context) => {
    check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Use the synthetic desktop owner.');
    const member = authorize(sourceVault, context, 'admin');
    check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Use complete current owner access.');
    check(faults.ready, 'INTERCHANGE_NOT_READY', 'Synthetic source readiness was withdrawn.');
  };
  const source: WorkspacePostgresActivationCandidateOptions['source'] = {
    withSource: (context, expected, work) => sourceVault.snapshot(async state => sourceScope.run(true, async () => {
      events.push('source-enter');
      try {
        admit(context);
        const artifacts = artifactsFor(state), capture = captureWorkspaceInterchange(state, artifacts);
        if (expected) assert.deepEqual(expected, capture.inventory);
        const assertCurrent = async () => {
          admit(context); assert.deepEqual(sourceVault.read(), state, 'Retain actual Vault snapshot custody through every awaited operation.');
        };
        const result = await work({ state, artifacts, ready: true, assertCurrent,
          assertCompleteOwner: async (current, historical) => {
            admit(current); assert.equal(historical.workspace.id, state.workspace.id);
          } });
        await assertCurrent(); return result;
      } finally { events.push('source-exit'); }
    })),
  };
  const nativeSource = {
    async storageIdentity() { return storageIdentity(); },
    async withSource<T>(work: (lease: PostgresSourceCustodyLease) => Promise<T>): Promise<T> {
      assert.equal(sourceScope.getStore(), true, 'The real Vault snapshot queue must precede the native lease.');
      const retained = nativeScope.getStore();
      if (retained) { const result = await work(retained); await retained.assertCurrent(); return result; }
      events.push('native-enter');
      const storage = storageIdentity(), authority = nativeAuthority();
      const assertCurrent = async () => {
        check(canonicalInterchangeJson(storageIdentity()) === canonicalInterchangeJson(storage)
          && canonicalInterchangeJson(nativeAuthority()) === canonicalInterchangeJson(authority),
        'ACTIVATION_POSTGRES_SOURCE_CHANGED', 'Synthetic native storage or source creation changed under exclusion.');
      };
      const lease = { storage, authority, assertCurrent, lease: {
        slot: storage.slot, active: true, load: () => adapter.load(), authority: async () => nativeAuthority(),
        assertCurrent: async () => assertCurrent(),
      } } as unknown as PostgresSourceCustodyLease;
      try { return await nativeScope.run(lease, async () => { const result = await work(lease); await assertCurrent(); return result; }); }
      finally { events.push('native-exit'); }
    },
  } as unknown as WorkspacePostgresCustody;
  const selection = (candidateId: string): WorkspaceBackupActivationSelection & { mode: 'prepare' } => ({
    backupId: 'backup_fixture', materialId: 'material_fixture', inertTargetId: 'inert_fixture',
    inertCreationId: 'inert_creation_fixture', candidateId, targetId: emptyTarget().targetId, mode: 'prepare',
  });
  const originalCalls = { backup: 0, material: 0 };
  let originalLease: Omit<WorkspaceBackupActivationLease, 'createCandidate' | 'readCandidate'> | undefined;
  const originals: WorkspacePostgresBackupActivationOriginals = {
    withTransaction: (context, _selection, work) => source.withSource(context, null, async held => {
      events.push('originals-held');
      originalLease = { currentState: held.state, target: emptyTarget(), assertCurrent: held.assertCurrent,
        assertCompleteOwner: held.assertCompleteOwner,
        readBackup: async () => {
          originalCalls.backup++; return { measurement: { encrypted: true, archiveCiphertextBytes: 100,
            pinCiphertextBytes: 100, qualification: faults.backupQualification } } as Awaited<ReturnType<WorkspaceBackupActivationLease['readBackup']>>;
        },
        readMaterial: async () => {
          originalCalls.material++; return { measurement: { encrypted: true, archiveCiphertextBytes: 100,
            inventoryPinCiphertextBytes: 100, qualification: faults.materialQualification } } as Awaited<ReturnType<WorkspaceBackupActivationLease['readMaterial']>>;
        },
        readInert: async () => { throw new Error('Original inert authentication is outside these direct candidate-custody tests.'); },
        authenticateArchive: async () => { throw new Error('Original archive authentication is outside these direct candidate-custody tests.'); },
        authenticateMaterial: async () => { throw new Error('Original material authentication is outside these direct candidate-custody tests.'); },
      };
      return work(originalLease);
    }),
  };
  const candidates = () => new WorkspacePostgresActivationCandidates({ sourceVault, journalVault, applicationDirectory, source, nativeSource,
    maxCandidateBytes: 4 * 1024 * 1024 });
  function record(id = 'candidate_fixture', creationId = 'candidate_creation_fixture', changedTarget = false): WorkspaceInterchangeCustodyRecord {
    const state = sourceVault.read(), capture = captureWorkspaceInterchange(state, artifactsFor(state)), target = emptyTarget();
    if (changedTarget) target.generation = 'coherently_changed_empty_generation';
    const service = new WorkspaceImportCandidateService({ source: () => ({ ready: true, inventory: capture.inventory }),
      target: () => target, assertCompleteRead: () => {} });
    const candidate = service.prepare(interchangeOwner, { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
    return { content: canonicalInterchangeJson(candidate), pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate',
      recordId: id, creationId, contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory,
      packageDigest: candidate.packageDigest, candidateDigest: interchangeDigest(candidate), target } };
  }
  const issue = (value: WorkspaceInterchangeCustodyRecord, guard: () => Promise<void> = async () => {},
    custody = candidates(), context = interchangeOwner) => custody.backupActivationPorts(originals).withTransaction(context,
    selection(value.pin.recordId), async lease => {
      assert.equal(lease.assertCurrent, originalLease!.assertCurrent, 'Candidate composition preserves the root lease capability.');
      return lease.createCandidate(value, guard);
    });
  async function reopenJournal() {
    await journalVault.close(); vaults.delete(journalVault);
    journalVault = await Vault.open({ directory: join(applicationDirectory, 'journal'), passphrase, storage: 'experimental-file' });
    vaults.add(journalVault); return journalVault;
  }
  const lockPath = (id: string) => join(applicationDirectory, '.workspace-interchange-control', 'records', `${sha(`${sourceVault.vaultId}:${id}`)}.lock`);
  return { applicationDirectory, sourceVault, get journalVault() { return journalVault; }, faults, events, source,
    originals, originalCalls, selection, candidates, record, issue, reopenJournal, lockPath };
}

test('candidate ciphertext, exact paired issuance and original lease survive journal reopen with source-before-SQL lock order', async t => {
  const f = await fixture(t), record = f.record(), sourceBefore = f.sourceVault.read(), custody = f.candidates();
  let guarded = 0;
  const read = await custody.backupActivationPorts(f.originals).withTransaction(interchangeOwner, f.selection(record.pin.recordId), async lease => {
    const measured = await lease.createCandidate(record, async () => { guarded++; await lease.assertCurrent(); });
    const read = await lease.readCandidate();
    assert.deepEqual(read.measurement, measured); return read;
  });
  assert.equal(guarded, 2); assert.equal(read.measurement.encrypted, true); assert.equal(read.measurement.qualification, 'test-fixture');
  assert.deepEqual({ content: read.content, pin: read.pin }, record);
  assert.ok(read.measurement.archiveCiphertextBytes > 0 && read.measurement.inventoryPinCiphertextBytes > 0);
  assert.equal(f.originalCalls.backup, 1); assert.equal(f.originalCalls.material, 1);
  assert.ok(f.events.indexOf('source-enter') < f.events.indexOf('native-enter'));
  assert.ok(f.events.indexOf('native-exit') < f.events.indexOf('source-exit'));
  for (const part of ['archive', 'pin'] as const) {
    const path = join(f.journalVault.directory, 'private-artifacts', purpose, `${candidateArtifactId(record.pin.recordId, part)}.encrypted.json`);
    const bytes = await readFile(path);
    assert.equal(bytes.length, part === 'archive' ? read.measurement.archiveCiphertextBytes : read.measurement.inventoryPinCiphertextBytes);
    assert.ok(!bytes.toString().includes('workspace_synthetic_empty_target'), 'Candidate values remain encrypted at rest.');
    assert.ok(!bytes.toString().includes(record.content));
  }
  assert.deepEqual(f.sourceVault.read(), sourceBefore); assert.deepEqual(await f.sourceVault.listArtifacts({ purpose }), []);
  await f.reopenJournal(); const reopened = f.candidates();
  f.events.length = 0;
  assert.deepEqual(await reopened.readCandidate(interchangeOwner, record.pin.recordId), read);
  assert.ok(f.events.indexOf('source-enter') < f.events.indexOf('native-enter'));
  await assert.rejects(f.issue(f.record(record.pin.recordId, 'different_creation'), undefined, reopened), code('ACTIVATION_SINGLE_USE'));
  await assert.rejects(f.issue(f.record('different_candidate', record.pin.creationId), undefined, reopened), code('ACTIVATION_SINGLE_USE'));
});

test('a lost ledger acknowledgement durably consumes both IDs before payloads and refuses replay after reopen', async t => {
  const f = await fixture(t), record = f.record(), original = f.journalVault.writeArtifact.bind(f.journalVault);
  f.journalVault.writeArtifact = async input => {
    const ref = await original(input);
    if (input.id === 'wpg_candidate_ledger_v1') throw new ChausarError('TEST_LOST_LEDGER_ACK', 'Synthetic acknowledgement lost after durable encrypted ledger write.');
    return ref;
  };
  await assert.rejects(f.issue(record), code('TEST_LOST_LEDGER_ACK'));
  f.journalVault.writeArtifact = original;
  assert.deepEqual((await f.journalVault.listArtifacts({ purpose })).map(v => v.id), ['wpg_candidate_ledger_v1']);
  await f.reopenJournal(); const custody = f.candidates();
  await assert.rejects(custody.readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_CANDIDATE_UNAVAILABLE'));
  await assert.rejects(f.issue(f.record(record.pin.recordId, 'new_creation'), undefined, custody), code('ACTIVATION_SINGLE_USE'));
  await assert.rejects(f.issue(f.record('new_candidate', record.pin.creationId), undefined, custody), code('ACTIVATION_SINGLE_USE'));
  assert.deepEqual((await f.journalVault.listArtifacts({ purpose })).map(v => v.id), ['wpg_candidate_ledger_v1']);
});

test('coherently changed archive, pin and binding cannot adopt a candidate against the original durable claim', async t => {
  const f = await fixture(t), record = f.record(); await f.issue(record);
  const changed = f.record(record.pin.recordId, record.pin.creationId, true);
  assert.notEqual(changed.content, record.content);
  const rewrite = async (part: string, value: unknown) => {
    const saved = await f.journalVault.readArtifact({ id: candidateArtifactId(record.pin.recordId, part), purpose });
    return f.journalVault.writeArtifact({ id: saved.id, purpose, value, expectedDigest: saved.valueDigest });
  };
  const archive = await rewrite('archive', { format: 'chausar.activation-candidate-archive.v1', recordId: record.pin.recordId,
    creationId: record.pin.creationId, content: changed.content });
  const pin = await rewrite('pin', { format: 'chausar.activation-candidate-pin.v1', recordId: record.pin.recordId, pin: changed.pin });
  const saved = await f.journalVault.readArtifact({ id: candidateArtifactId(record.pin.recordId, 'binding'), purpose });
  await rewrite('binding', { ...(saved.value as object), archive: reference(archive), pin: reference(pin), recordDigest: interchangeDigest(changed) });
  await f.reopenJournal();
  await assert.rejects(f.candidates().readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_CANDIDATE_CHANGED'));
});

test('current owner, epoch and readiness admission refuse candidate reads before encrypted journal access', async t => {
  const f = await fixture(t), record = f.record(); await f.issue(record);
  const custody = f.candidates(), original = f.journalVault.readArtifact.bind(f.journalVault); let reads = 0;
  f.journalVault.readArtifact = async input => { reads++; return original(input); };
  await assert.rejects(custody.readCandidate({ ...interchangeOwner, epoch: 2 }, record.pin.recordId), code('ACCESS_REVOKED'));
  await assert.rejects(custody.readCandidate({ ...interchangeOwner, channel: 'phone' }, record.pin.recordId), code('APP_APPROVAL_REQUIRED'));
  f.faults.ready = false;
  await assert.rejects(custody.readCandidate(interchangeOwner, record.pin.recordId), code('INTERCHANGE_NOT_READY'));
  f.faults.ready = true;
  await f.sourceVault.update(state => { state.members[0].active = false; });
  await assert.rejects(custody.readCandidate(interchangeOwner, record.pin.recordId), code('ACCESS_REVOKED'));
  assert.equal(reads, 0, 'Current root admission precedes reading historical candidate artifacts.');
  f.journalVault.readArtifact = original;
});

test('source slot ABA and storage-generation replacement refuse retained candidate admission', async t => {
  const f = await fixture(t), record = f.record(); await f.issue(record); await f.reopenJournal();
  const before = await f.journalVault.listArtifacts({ purpose }), originalCreation = f.faults.sourceCreationId;
  f.faults.sourceCreationId = 'same_envelope_recreated_slot';
  await assert.rejects(f.candidates().readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
  f.faults.sourceCreationId = originalCreation; f.faults.storageId = 'recreated_database_generation';
  await assert.rejects(f.candidates().readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
  assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), before, 'Inspection never rewrites or adopts retained issuance.');
});

test('candidate process exclusion is retained through the callback and held readers do not reacquire the candidate lock', async t => {
  const f = await fixture(t), record = f.record(); await f.issue(record);
  const custody = f.candidates(), lockDirectory = await safeDirectory(dirname(f.lockPath(record.pin.recordId)), true);
  assert.equal(lockDirectory, dirname(f.lockPath(record.pin.recordId)));
  const lock = await acquireProcessLock(f.lockPath(record.pin.recordId));
  try { await assert.rejects(custody.readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_BUSY')); }
  finally { await lock.release(); }
  await f.source.withSource(interchangeOwner, null, () => custody.withCandidate(interchangeOwner, record.pin.recordId, async read => {
    assert.deepEqual(await read(), await read(), 'A supplied held reader must read under the existing lock.');
    await assert.rejects(custody.readCandidateHeld(interchangeOwner, record.pin.recordId), code('ACTIVATION_BUSY'));
    await assert.rejects(acquireProcessLock(f.lockPath(record.pin.recordId), { busyCode: 'TEST_CANDIDATE_HELD' }), code('TEST_CANDIDATE_HELD'));
  }));
});

test('publication guard failure preserves the preparing candidate and consumed identities without issuing committed admission', async t => {
  const f = await fixture(t), record = f.record(); let guards = 0;
  await assert.rejects(f.issue(record, async () => {
    if (++guards === 2) throw new ChausarError('TEST_CURRENT_GUARD_REVOKED', 'Synthetic authority revoked at candidate publication.');
  }), code('TEST_CURRENT_GUARD_REVOKED'));
  assert.equal(guards, 2);
  const before = await f.journalVault.listArtifacts({ purpose }); assert.equal(before.length, 4);
  const binding = await f.journalVault.readArtifact({ id: candidateArtifactId(record.pin.recordId, 'binding'), purpose });
  assert.equal((binding.value as { phase: string }).phase, 'preparing');
  await f.reopenJournal(); const custody = f.candidates();
  await assert.rejects(custody.readCandidate(interchangeOwner, record.pin.recordId), code('ACTIVATION_CANDIDATE_UNAVAILABLE'));
  await assert.rejects(f.issue(record, undefined, custody), code('ACTIVATION_SINGLE_USE'));
  assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), before);
});

test('a noncompleting guard refuses before durable consumption and fixture original qualification remains truthful', async t => {
  const f = await fixture(t), record = f.record();
  await assert.rejects(f.issue(record, async () => true as never), code('ACTIVATION_ROOT_GUARD'));
  assert.deepEqual(await f.journalVault.listArtifacts({ purpose }), []);
  f.faults.backupQualification = 'encrypted-local-host';
  assert.equal((await f.issue(record)).qualification, 'test-fixture');
  f.faults.backupQualification = 'test-fixture'; f.faults.materialQualification = 'encrypted-local-host';
  assert.equal((await f.issue(f.record('other_candidate', 'other_creation'))).qualification, 'test-fixture');
});
