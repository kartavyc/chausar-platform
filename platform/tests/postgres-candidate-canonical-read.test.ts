import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
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

// This fixture setup is copied from the checked-in candidate-custody protocol
// test. It retains actual Vault encryption, source snapshots and process locks;
// the native source/SQL lease remains explicitly injected protocol evidence.
async function ciphertexts(vault: Vault) {
  const directory = join(vault.directory, 'private-artifacts', purpose);
  const names = (await readdir(directory)).sort();
  const result: { name: string; bytes: Buffer }[] = [];
  for (const name of names) {
    assert.match(name, /^[A-Za-z0-9_-]{1,180}\.encrypted\.json$/);
    result.push({ name, bytes: await readFile(join(directory, name)) });
  }
  return result;
}

test('protocol: one actual candidate read validates canonical content once and preserves every retained ciphertext and pin', { timeout: 30_000 }, async t => {
  const f = await fixture(t), record = f.record('candidate_canonical_probe', 'creation_canonical_probe');
  await f.issue(record);
  const marker = JSON.parse(record.content) as { format: string; id: string };
  assert.equal(marker.format, 'chausar.workspace-import-candidate.v1');
  assert.equal(typeof marker.id, 'string');
  const before = await ciphertexts(f.journalVault), sourceBefore = f.sourceVault.read();
  f.events.length = 0;
  const original = Object.getOwnPropertyDescriptors, roots = new WeakMap<object, number>();
  let candidateRootTraversals = 0, distinctCandidateRoots = 0, overflow = false;
  const hook = t.mock.method(Object, 'getOwnPropertyDescriptors', function (this: ObjectConstructor, value: unknown) {
    // Delegate first and return the exact descriptor map. Inspect only ordinary
    // descriptor values: the observer never invokes a caller getter, alters the
    // supplied object, changes validation or invents a successful custody read.
    const descriptors = Reflect.apply(original, this, [value]) as PropertyDescriptorMap;
    if (value !== null && typeof value === 'object'
      && descriptors.format?.value === marker.format && descriptors.id?.value === marker.id) {
      candidateRootTraversals++;
      if (!roots.has(value)) {
        distinctCandidateRoots++;
        if (distinctCandidateRoots <= 4) roots.set(value, distinctCandidateRoots);
        else overflow = true;
      }
      if (candidateRootTraversals > 64) overflow = true;
    }
    return descriptors;
  });
  let actual: Awaited<ReturnType<WorkspacePostgresActivationCandidates['readCandidate']>>;
  try { actual = await f.candidates().readCandidate(interchangeOwner, record.pin.recordId); }
  finally { hook.mock.restore(); }
  assert.equal(Object.getOwnPropertyDescriptors, original, 'Restore the actual builtin before assertions and fixture cleanup.');
  assert.equal(overflow, false, 'Keep the observer bounded to one selected candidate read.');
  assert.deepEqual({ content: actual.content, pin: actual.pin }, record);
  assert.deepEqual(await ciphertexts(f.journalVault), before, 'Inspection preserves archive, pin, binding and single-use ledger ciphertext bytes.');
  assert.deepEqual(f.sourceVault.read(), sourceBefore);
  assert.equal(actual.measurement.encrypted, true);
  assert.equal(actual.measurement.qualification, 'test-fixture', 'Injected SQL is not native PostgreSQL proof.');
  assert.ok(f.events.indexOf('source-enter') < f.events.indexOf('native-enter'));
  assert.ok(f.events.indexOf('native-exit') < f.events.indexOf('source-exit'));
  assert.equal(distinctCandidateRoots, 1, 'Observe the actual freshly parsed object for exactly one read.');
  t.diagnostic(JSON.stringify({ candidateRootTraversals, distinctCandidateRoots, nativeExecution: false }));
  assert.equal(candidateRootTraversals, 1,
    'After canonical bytes equal the retained content, computing its digest must not traverse the same candidate tree again.');
});

test('protocol controls: candidate digest, noncanonical content and deep JSON still refuse without rewriting evidence', { timeout: 30_000 }, async t => {
  for (const kind of ['candidate-digest', 'noncanonical-content', 'deep-json'] as const) await t.test(kind, async sub => {
    const f = await fixture(sub), record = f.record(`candidate_${kind.replaceAll('-', '_')}`, `creation_${kind.replaceAll('-', '_')}`);
    assert.ok(record.pin.kind === 'candidate', 'The negative controls require an actual candidate issuance pin.');
    let expected = 'ACTIVATION_CANDIDATE_CHANGED';
    if (kind === 'candidate-digest') record.pin.candidateDigest = '0'.repeat(64);
    if (kind === 'noncanonical-content') record.content = JSON.stringify(JSON.parse(record.content), null, 2);
    if (kind === 'deep-json') {
      const candidate = JSON.parse(record.content);
      let deep: unknown = null;
      for (let depth = 0; depth < 70; depth++) deep = { next: deep };
      candidate.bounded_probe_extra = deep;
      record.content = JSON.stringify(candidate);
      expected = 'INTERCHANGE_LIMIT';
    }
    // Issuance performs its production final readback. A refused malformed
    // issuance remains durable evidence; it is never replaced with a success.
    await assert.rejects(f.issue(record), code(expected));
    const before = await ciphertexts(f.journalVault), sourceBefore = f.sourceVault.read();
    await assert.rejects(f.candidates().readCandidate(interchangeOwner, record.pin.recordId), code(expected));
    assert.deepEqual(await ciphertexts(f.journalVault), before);
    assert.deepEqual(f.sourceVault.read(), sourceBefore);
  });
});
