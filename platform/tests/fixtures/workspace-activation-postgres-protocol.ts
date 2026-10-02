import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { authorize, check, ChausarError, hash, type Context } from '../../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../../runtime/ingest.ts';
import { Vault, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../../runtime/vault.ts';
import { WorkspaceInterchangeHost } from '../../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../../runtime/workspace-interchange-local.ts';
import { interchangeDigest, readHistoricalWorkspaceState } from '../../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type WorkspaceActivationPolicy } from '../../runtime/workspace-activation.ts';
import { createWorkspaceActivationPostgresPorts, type WorkspaceActivationPostgresOptions } from '../../runtime/workspace-activation-postgres.ts';
import type { PostgresAuthorityIdentity, PostgresPublicationProof, PostgresStorageIdentity,
  PostgresTargetInspection, PostgresTargetReservation, WorkspacePostgresCustody } from '../../runtime/workspace-postgres-custody.ts';
import { deterministicShopState, fixedTime, interchangeOwner } from './workspace-interchange-fixture.ts';

// Injected SQL protocol only. Vault ciphertext, candidate inventory, local target
// exclusion/publication and the encrypted file journal are actual implementations.
// These tests do not qualify native SQL, Engine, receipts or crash/power-loss recovery.
const purpose = 'workspace-interchange' as const;
const passphrase = 'synthetic PostgreSQL activation fixture passphrase';
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
const clone = <T>(value: T): T => structuredClone(value);
const pgAttemptId = (activationId: string) => `wpg_${sha(activationId)}_attempt`;
const localAttemptId = (activationId: string) => `wal_${sha(activationId)}_attempt`;
const sqlFile = 'live/postgres-publication.encrypted.json';
const storageIdentity = (slot: string): PostgresStorageIdentity => ({ storageId: 'fixture_database_generation',
  databaseOid: '16384', database: 'synthetic_activation_fixture', serverAddress: '127.0.0.1', serverPort: 15432, slot });
const authority = (creationId: string, envelope: VaultEnvelope): PostgresAuthorityIdentity => ({ creationId,
  vaultId: envelope.id, revision: envelope.revision, envelopeDigest: sha(JSON.stringify(envelope)) });

class EncryptedMemoryStorage implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  envelope: VaultEnvelope | null = null;
  async load() { return clone(this.envelope); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null) {
    check((this.envelope?.revision ?? null) === expectedRevision, 'REVISION_CONFLICT', 'Fixture encrypted CAS revision changed.');
    this.envelope = clone(envelope);
  }
  async delete() { this.envelope = null; }
}

class InjectedTargetCustody {
  readonly storage = storageIdentity('target_fixture');
  directory = '';
  reservation?: PostgresTargetReservation;
  proof?: PostgresPublicationProof;
  original?: VaultEnvelope;
  current?: VaultEnvelope;
  currentCreationId?: string;
  phase: PostgresTargetInspection['status'] = 'absent';
  reserveCalls = 0;
  publishCalls = 0;
  deleteCalls = 0;
  afterReserve?: () => Promise<void>;
  beforePublish?: () => Promise<void>;
  afterPublish?: () => Promise<void>;
  async storageIdentity() { return clone(this.storage); }
  async reserve(input: { operationId: string; creationId: string }) {
    this.reserveCalls++;
    check(this.phase === 'absent' && !this.current, 'POSTGRES_TARGET_OCCUPIED', 'Fixture SQL target already has an occupant.');
    assert.deepEqual(await readdir(this.directory), [], 'SQL reservation also proves an actual empty physical target.');
    const stat = await lstat(this.directory, { bigint: true });
    this.reservation = { format: 'chausar.postgres-target-reservation.v1', storage: clone(this.storage), ...input,
      target: { directory: this.directory, physical: { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) } } };
    this.phase = 'reserved'; await this.afterReserve?.(); return clone(this.reservation);
  }
  createPreparedAdapter(reservation: PostgresTargetReservation): EncryptedSnapshotAdapter {
    assert.deepEqual(reservation, this.reservation);
    const owner = clone(reservation);
    let submittedProof: PostgresPublicationProof | undefined, rolledBack = false;
    return { kind: 'postgres', load: async () => {
      assert.deepEqual(this.reservation, owner);
      if (submittedProof) {
        assert.deepEqual(this.proof, submittedProof);
        assert.ok(this.original);
        assert.equal(this.original.id, submittedProof.vaultId);
        assert.equal(this.original.revision, submittedProof.revision);
        assert.equal(sha(JSON.stringify(this.original)), submittedProof.envelopeDigest);
      }
      assert.equal(this.current, undefined, 'Prepared storage never reads an ordinary occupant.');
      if (rolledBack && this.phase === 'rolled-back') return null;
      assert.ok(['reserved', 'prepared'].includes(this.phase));
      return clone(this.original ?? null);
    }, commit: async (envelope, expected) => {
      assert.equal(this.phase, 'reserved'); assert.equal(expected, null); assert.equal(envelope.revision, 0);
      assert.deepEqual(this.reservation, owner);
      this.original = clone(envelope); this.proof = { ...clone(owner), vaultId: envelope.id,
        revision: envelope.revision, envelopeDigest: sha(JSON.stringify(envelope)) }; this.phase = 'prepared';
      submittedProof = clone(this.proof);
    }, deleteIfCurrent: async (expectedEnvelope): Promise<'deleted' | 'absent' | 'mismatch'> => {
      // Injected atomic CAS: inspect physical custody first, then compare and
      // change the in-memory row without an intervening await. Retain the
      // original ciphertext/proof as the exact-owned rollback tombstone.
      let stat;
      try { stat = await lstat(owner.target.directory, { bigint: true }); } catch { return 'mismatch'; }
      if (!stat.isDirectory() || stat.isSymbolicLink() || this.directory !== owner.target.directory
        || interchangeDigest(this.storage) !== interchangeDigest(owner.storage)
        || interchangeDigest({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }) !== interchangeDigest(owner.target.physical)
        || this.current !== undefined || this.currentCreationId !== undefined) return 'mismatch';
      if (submittedProof && (submittedProof.vaultId !== expectedEnvelope.id || submittedProof.revision !== expectedEnvelope.revision
        || submittedProof.envelopeDigest !== sha(JSON.stringify(expectedEnvelope)))) return 'mismatch';
      if (!this.reservation) return this.phase === 'absent' && !this.original && !this.proof ? 'absent' : 'mismatch';
      if (interchangeDigest(this.reservation) !== interchangeDigest(owner)) return 'mismatch';
      if (this.phase === 'reserved' && !this.original && !this.proof) return 'absent';
      if (!submittedProof || !this.proof || !this.original
        || interchangeDigest(this.proof) !== interchangeDigest(submittedProof)
        || JSON.stringify(this.original) !== JSON.stringify(expectedEnvelope)) return 'mismatch';
      if (this.phase === 'rolled-back') { rolledBack = true; return 'absent'; }
      if (this.phase !== 'prepared') return 'mismatch';
      this.phase = 'rolled-back'; rolledBack = true; this.deleteCalls++; return 'deleted';
    }, delete: async () => { this.deleteCalls++; throw new Error('Fixture refuses unsolicited prepared rollback.'); } };
  }
  ordinaryAdapter(): EncryptedSnapshotAdapter {
    return { kind: 'postgres', load: async () => {
      check(this.phase === 'committed', 'POSTGRES_TARGET_NOT_COMMITTED', 'Prepared SQL never becomes ordinary authority.');
      check(this.current && this.currentCreationId === this.proof?.creationId && this.current.id === this.proof?.vaultId,
        'POSTGRES_TARGET_REPLACED', 'Fixture committed slot incarnation changed.');
      return clone(this.current!);
    }, commit: async (envelope, expected) => {
      const current = await this.ordinaryAdapter().load();
      assert.equal(current!.revision, expected); assert.equal(envelope.id, current!.id);
      this.current = clone(envelope);
    }, delete: async () => { this.deleteCalls++; throw new Error('Fixture refuses unconditional target deletion.'); } };
  }
  async publish(proof: PostgresPublicationProof) {
    this.publishCalls++; assert.deepEqual(proof, this.proof); assert.equal(this.phase, 'prepared');
    await this.beforePublish?.();
    check(!this.current, 'POSTGRES_TARGET_OCCUPIED', 'A competing fixture occupant survives refused publication.');
    this.current = clone(this.original!); this.currentCreationId = proof.creationId; this.phase = 'committed';
    await this.afterPublish?.();
  }
  async inspect(reservationOrProof: PostgresTargetReservation | PostgresPublicationProof): Promise<PostgresTargetInspection> {
    assert.ok(this.reservation);
    const value = { format: reservationOrProof.format, storage: reservationOrProof.storage,
      operationId: reservationOrProof.operationId, creationId: reservationOrProof.creationId, target: reservationOrProof.target };
    if (interchangeDigest(value) !== interchangeDigest(this.reservation)) return { status: 'unknown' };
    if (this.current && (this.currentCreationId !== this.proof?.creationId || this.current.id !== this.proof?.vaultId)) return { status: 'unknown' };
    return { status: this.phase, reservation: clone(this.reservation), ...(this.proof ? { proof: clone(this.proof) } : {}),
      ...(this.original ? { envelope: clone(this.original) } : {}),
      ...(this.phase === 'committed' && this.current ? { currentAuthority: authority(this.currentCreationId!, this.current) } : {}) };
  }
  async inspectOperation(input: { operationId: string; creationId: string }): Promise<PostgresTargetInspection> {
    if (!this.reservation) return { status: this.current ? 'unknown' : 'absent' };
    if (input.operationId !== this.reservation.operationId || input.creationId !== this.reservation.creationId) return { status: 'unknown' };
    return this.inspect(this.reservation);
  }
}

type FixtureOptions = {
  sourceStorage?: EncryptedMemoryStorage;
  journalStorage?: EncryptedSnapshotAdapter | 'experimental-file';
  withSource?: WorkspaceActivationPostgresOptions['source']['withSource'];
  onDiagnostic?: WorkspaceActivationPostgresOptions['onDiagnostic'];
};
async function fixture(t: TestContext, overrides: FixtureOptions = {}) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate C-drive scratch before every fixture write.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-activation-postgres-')));
  assert.equal(dirname(applicationDirectory), base);
  const sourceStorage = overrides.sourceStorage ?? new EncryptedMemoryStorage(), target = new InjectedTargetCustody();
  const journalStorage = overrides.journalStorage ?? 'experimental-file';
  let sourceVault: Vault | undefined, journalVault: Vault | undefined;
  t.after(async () => {
    await sourceVault?.close(); await journalVault?.close();
    const actual = await realpath(applicationDirectory);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-activation-postgres-/);
    await rm(actual, { recursive: true, force: true });
  });
  sourceVault = (await Vault.create({ directory: join(applicationDirectory, 'source'), name: 'Synthetic PostgreSQL source',
    passphrase, storage: sourceStorage, demo: true })).vault;
  journalVault = (await Vault.create({ directory: join(applicationDirectory, 'journal'), name: 'Synthetic PostgreSQL activation journal',
    passphrase, storage: journalStorage, demo: true })).vault;
  await sourceVault.update(draft => {
    const state = deterministicShopState(); state.workspace.id = draft.workspace.id;
    const input = { sourceId: 'demo-export', format: 'csv' as const, content: demoCsv, recipe: demoRecipe,
      expectedTotals: { rowCount: 10, amountMinor: '1230000' } };
    state.imports[0].retainedInput = { version: 1, generation: 1, input, digest: hash(input) };
    state.sessions.push({ id: 'historical_session', token: 'synthetic_old_session_token' });
    state.routes.push({ id: 'historical_route', approved: true }); Object.assign(draft, state);
  });
  let ready = true, rootHeld = 0, nativeHeld = 0, nativeAssertions = 0, prepared = 0, inspected = 0, preparedOpenDenied = 0;
  let sourceCreationId = 'fixture_source_creation', nativeRevisionOffset = 0;
  let inspectionHook: (() => Promise<void>) | undefined;
  const leaseOrder: string[] = [];
  const completeOwner = async () => { check(ready, 'INTERCHANGE_NOT_READY', 'Fixture consumer readiness revoked.'); };
  const localInterchange = () => createWorkspaceInterchangeLocalPorts({ vault: sourceVault!, applicationDirectory,
    qualification: 'test-fixture', assertCompleteOwner: completeOwner });
  let interchange = localInterchange();
  const exportHost = new WorkspaceInterchangeHost(interchange.ports);
  await exportHost.export(interchangeOwner, { destinationId: 'export_fixture', confirmed: true });
  const issued = await exportHost.prepare(interchangeOwner, { exportId: 'export_fixture', candidateId: 'candidate_fixture', targetId: 'target_fixture' });
  const candidate = await interchange.ports.custody.read(interchangeOwner, 'candidate_fixture');
  const sourceInitial = sourceVault.read();
  const nativeSource = {
    storageIdentity: async () => storageIdentity('source'),
    withSource: async <T>(work: (lease: any) => Promise<T>): Promise<T> => {
      assert.equal(rootHeld, 1, 'Native SQL custody starts only inside the already-held root Vault snapshot.');
      assert.equal(nativeHeld, 0); leaseOrder.push('native-enter'); nativeHeld++;
      const retained = { ...authority(sourceCreationId, sourceStorage.envelope!), revision: sourceVault!.read().revision + nativeRevisionOffset };
      const assertCurrent = async () => {
        nativeAssertions++; assert.equal(rootHeld, 1); assert.equal(nativeHeld, 1);
        assert.deepEqual(retained, { ...authority(sourceCreationId, sourceStorage.envelope!), revision: sourceVault!.read().revision + nativeRevisionOffset });
      };
      try { const result = await work({ storage: storageIdentity('source'), authority: retained, assertCurrent });
        await assertCurrent(); return result;
      } finally { nativeHeld--; leaseOrder.push('native-exit'); }
    },
  } as unknown as WorkspacePostgresCustody;
  const policy: WorkspaceActivationPolicy = { approvedSyntheticWorkspaceIds: [sourceInitial.workspace.id],
    allowedSyntheticSourceIds: ['demo-export'], retentionDays: 90,
    budgets: { maxCandidateBytes: 4 * 1024 * 1024, maxArtifactBytes: 4 * 1024 * 1024,
      maxArtifacts: 100, maxFacts: 100, maxRecords: 1000 } };
  function options(): WorkspaceActivationPostgresOptions {
    return { sourceVault: sourceVault!, journalVault: journalVault!, applicationDirectory, nativeSource, onDiagnostic: overrides.onDiagnostic,
      source: { withSource: (context, expected, work) => (overrides.withSource ?? interchange.ports.withSource)(context, expected, async lease => {
        assert.equal(rootHeld, 0); rootHeld++; leaseOrder.push('root-enter');
        try { return await work(lease); } finally { rootHeld--; leaseOrder.push('root-exit'); }
      }) },
      candidates: { read: (context, id) => interchange.ports.custody.read(context, id),
        withCandidate: (context, id, work) => interchange.withRecordReader(context, id, work) },
      targetCustody: async (id, directory) => {
        assert.equal(id, 'target_fixture'); assert.equal(directory, join(applicationDirectory, id));
        assert.equal(rootHeld, 1); assert.equal(nativeHeld, 1);
        target.directory = directory; return target as unknown as WorkspacePostgresCustody;
      },
      bootstrap: {
        allocateAuthority: async (_context, empty) => {
          const memberId = `fresh_owner_${randomUUID()}`;
          return { workspaceId: empty.workspaceId,
            owner: { id: memberId, name: 'Fresh synthetic owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
            context: { memberId, role: 'owner', epoch: 1, channel: 'desktop' },
            sessionAuthorityId: `fresh_session_${randomUUID()}`, createdAt: fixedTime };
        },
        prepare: async ({ stagingDirectory, publication, storage }) => {
          prepared++; assert.equal(target.phase, 'reserved'); assert.equal(target.current, undefined);
          const liveDirectory = join(stagingDirectory, 'live');
          const boot = await Vault.createBootstrap({ directory: liveDirectory, storage, passphrase,
            state: publication.state, expectedStateDigest: publication.record.stateDigest,
            expectedWorkspaceId: publication.state.workspace.id, expectedOwnerId: publication.authority.owner.id,
            budgets: { maxStateBytes: 4 * 1024 * 1024, maxJsonDepth: 40, maxJsonNodes: 100_000, maxRecords: 10_000 } });
          assert.deepEqual(boot.vault.read(), publication.state); await boot.vault.close();
          assert.equal(target.current, undefined);
          await assert.rejects(target.ordinaryAdapter().load(), code('POSTGRES_TARGET_NOT_COMMITTED'));
          await assert.rejects(Vault.open({ directory: liveDirectory, storage: target.ordinaryAdapter(), passphrase }));
          preparedOpenDenied++; return { liveFiles: [], qualification: 'test-fixture' };
        },
        inspect: async ({ targetDirectory, publication, inspection }) => {
          inspected++; assert.equal(rootHeld, 1); assert.equal(nativeHeld, 1);
          assert.ok(['prepared', 'committed'].includes(inspection.status)); assert.ok(inspection.envelope);
          const adapter: EncryptedSnapshotAdapter = { kind: 'postgres',
            load: () => inspection.status === 'prepared' ? Promise.resolve(clone(inspection.envelope!)) : target.ordinaryAdapter().load(),
            commit: async () => { throw new Error('Read-only current-live inspection cannot publish.'); },
            delete: async () => { throw new Error('Read-only current-live inspection cannot delete.'); } };
          const live = await Vault.open({ directory: join(targetDirectory, 'live'), storage: adapter, passphrase });
          let authorityCiphertextBytes = 0;
          try {
            const state = live.read(); assert.equal(state.workspace.id, publication.state.workspace.id);
            assert.deepEqual(state.members, [publication.authority.owner]); authorize(live, publication.authority.context, 'admin');
            if (state.revision === 0) assert.deepEqual(state, publication.state);
            else assert.ok(state.revision > publication.state.revision);
            if (inspection.status === 'committed') assert.deepEqual(inspection.currentAuthority, authority(target.currentCreationId!, target.current!));
            authorityCiphertextBytes = await live.snapshot(async () => (await live.captureEncryptedCustody({ maxArtifacts: 100,
              maxEntryBytes: 4 * 1024 * 1024, maxTotalEntryBytes: 8 * 1024 * 1024 })).authority.byteLength);
          } finally { await live.close(); }
          await inspectionHook?.();
          return { authorityCiphertextBytes, authorityKind: 'adapter-issued-envelope' };
        },
      }, budgets: { maxFiles: 30, maxBytes: 8 * 1024 * 1024, maxDepth: 5 } };
  }
  const activationCustody = () => createWorkspaceActivationPostgresPorts(options());
  let custody = activationCustody(), host = new WorkspaceActivationHost(custody.ports, policy);
  const request = { candidateId: 'candidate_fixture', reviewedDigest: issued.reviewedDigest };
  return { applicationDirectory, target, candidate, sourceInitial, request, leaseOrder,
    get sourceVault() { return sourceVault!; }, get journalVault() { return journalVault!; },
    get sourceEnvelope() { return clone(sourceStorage.envelope!); },
    get host() { return host; }, get custody() { return custody; }, targetPath: () => custody.targetPath('target_fixture'),
    counts: () => ({ prepared, inspected, preparedOpenDenied, nativeAssertions }),
    setReady: (value: boolean) => { ready = value; }, setNativeRevisionOffset: (value: number) => { nativeRevisionOffset = value; },
    replaceSourceCreation: () => { sourceCreationId = 'replacement_source_creation'; },
    onInspection: (hook?: () => Promise<void>) => { inspectionHook = hook; },
    async activate(activationId = 'activation_fixture') {
      const review = await host.review(interchangeOwner, request);
      return host.activate(interchangeOwner, { ...request, projectionDigest: review.projectionDigest, activationId, confirmed: true });
    },
    async openTarget() { return Vault.open({ directory: join(custody.targetPath('target_fixture'), 'live'), storage: target.ordinaryAdapter(), passphrase }); },
    async reopen() {
      await sourceVault!.close(); await journalVault!.close();
      sourceVault = await Vault.open({ directory: join(applicationDirectory, 'source'), storage: sourceStorage, passphrase });
      journalVault = await Vault.open({ directory: join(applicationDirectory, 'journal'), storage: journalStorage, passphrase });
      interchange = localInterchange(); custody = activationCustody(); host = new WorkspaceActivationHost(custody.ports, policy);
    },
  };
}

async function treeBytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const visit = async (directory: string, prefix: string) => {
    for (const name of (await readdir(directory)).sort()) {
      const path = join(directory, name), key = `${prefix}${name}`, stat = await lstat(path);
      assert.equal(stat.isSymbolicLink(), false);
      if (stat.isDirectory()) await visit(path, `${key}/`); else result[key] = (await readFile(path)).toString('base64');
    }
  };
  await visit(root, ''); return result;
}

export { purpose, passphrase, sha, code, clone, pgAttemptId, localAttemptId, sqlFile, storageIdentity, authority, EncryptedMemoryStorage, InjectedTargetCustody, fixture, treeBytes };
