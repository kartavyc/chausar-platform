import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { authorize, check, ChausarError, hash } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import { Vault, type EncryptedSnapshotAdapter, type VaultEnvelope } from '../runtime/vault.ts';
import { WorkspaceInterchangeHost } from '../runtime/workspace-interchange-host.ts';
import { createWorkspaceInterchangeLocalPorts } from '../runtime/workspace-interchange-local.ts';
import { interchangeDigest, readHistoricalWorkspaceState } from '../runtime/workspace-interchange.ts';
import { WorkspaceActivationHost, type WorkspaceActivationPolicy } from '../runtime/workspace-activation.ts';
import { createWorkspaceActivationPostgresPorts, type WorkspaceActivationPostgresOptions } from '../runtime/workspace-activation-postgres.ts';
import type { PostgresAuthorityIdentity, PostgresPublicationProof, PostgresStorageIdentity,
  PostgresTargetInspection, PostgresTargetReservation, WorkspacePostgresCustody } from '../runtime/workspace-postgres-custody.ts';
import { deterministicShopState, fixedTime, interchangeOwner } from './fixtures/workspace-interchange-fixture.ts';

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

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate C-drive scratch before every fixture write.');
  const applicationDirectory = await realpath(await mkdtemp(join(base, 'chausar-activation-postgres-')));
  assert.equal(dirname(applicationDirectory), base);
  const sourceStorage = new EncryptedMemoryStorage(), target = new InjectedTargetCustody();
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
    passphrase, storage: 'experimental-file', demo: true })).vault;
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
    return { sourceVault: sourceVault!, journalVault: journalVault!, applicationDirectory, nativeSource,
      source: { withSource: (context, expected, work) => interchange.ports.withSource(context, expected, async lease => {
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
      journalVault = await Vault.open({ directory: join(applicationDirectory, 'journal'), storage: 'experimental-file', passphrase });
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

test('PostgreSQL activation authenticates actual fresh Vault encryption and preserved evidence after later target revision and reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate();
  assert.equal(summary.status, 'committed'); assert.equal(summary.qualification, 'test-fixture');
  assert.equal(f.counts().preparedOpenDenied, 1); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  assert.ok(f.leaseOrder.length >= 4); assert.equal(f.leaseOrder.length % 4, 0);
  for (let offset = 0; offset < f.leaseOrder.length; offset += 4)
    assert.deepEqual(f.leaseOrder.slice(offset, offset + 4), ['root-enter', 'native-enter', 'native-exit', 'root-exit']);
  const read = await f.custody.ports.readback(interchangeOwner, { activationId: summary.activationId });
  assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.deepEqual(readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive), f.sourceInitial);
  assert.equal(read.evidence.content, f.candidate.content); assert.deepEqual(read.evidence.pin, f.candidate.pin);
  assert.equal(read.state.revision, 0); assert.deepEqual(read.state.members, [read.authority.owner]);
  assert.deepEqual(read.state.sessions, []); assert.deepEqual(read.state.routes, []);
  assert.notEqual(read.authority.owner.id, interchangeOwner.memberId); assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
  const files = await treeBytes(f.targetPath());
  assert.equal(read.ciphertextBytes, Object.values(files).reduce((sum, bytes) => sum + Buffer.from(bytes, 'base64').length, 0)
    + Buffer.byteLength(JSON.stringify(f.target.original)) + Buffer.byteLength(JSON.stringify(f.target.current)),
    'Measurement includes filesystem ciphertext, retained original SQL ciphertext and independently authenticated current SQL ciphertext.');
  assert.equal(summary.ciphertextBytes, read.ciphertextBytes);
  for (const bytes of Object.values(files).map(value => Buffer.from(value, 'base64'))) {
    assert.equal(bytes.includes(Buffer.from('synthetic_old_session_token')), false);
    assert.equal(bytes.includes(Buffer.from('demo-export')), false);
  }
  const live = await f.openTarget();
  try { await live.update(state => { state.activity.push({ id: 'later_target_revision', at: fixedTime }); }); }
  finally { await live.close(); }
  assert.equal(f.target.current!.revision, 1); assert.equal(f.target.original!.revision, 0);
  await f.reopen(); const resolved = await f.host.resolve(interchangeOwner, { activationId: summary.activationId });
  assert.equal(resolved.status, 'committed'); assert.deepEqual(await treeBytes(f.targetPath()), files);
  if (resolved.status === 'committed') {
    assert.equal(resolved.ciphertextBytes, Object.values(files).reduce((sum, bytes) => sum + Buffer.from(bytes, 'base64').length, 0)
      + Buffer.byteLength(JSON.stringify(f.target.original)) + Buffer.byteLength(JSON.stringify(f.target.current)));
    assert.ok(resolved.ciphertextBytes > read.ciphertextBytes, 'Later authority is independently measured while original publication stays immutable.');
  }
  assert.equal(f.counts().prepared, 1); assert.equal(f.target.publishCalls, 1); assert.ok(f.counts().nativeAssertions > 1);
  assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
  t.diagnostic(JSON.stringify({ nativePostgresQualified: false, sqlCustody: 'injected-test-fixture',
    actualVaultEncryption: true, realBootstrapAndOpen: true, sourceAndJournalReopened: true,
    ordinaryPreparedOpenRefused: true, currentTargetRevision: 1, originalPublicationRevision: 0, ciphertextBytes: read.ciphertextBytes }));
});

test('failure before SQL publication retains prepared target, refuses ordinary open and never retries across reopen', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.beforePublish = async () => { throw new Error('Synthetic boundary before SQL publication.'); };
  await assert.rejects(f.activate('activation_before_sql'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.current, undefined);
  await assert.rejects(f.openTarget()); const files = await treeBytes(f.targetPath()); await f.reopen();
  const resolved = await f.host.resolve(interchangeOwner, { activationId: 'activation_before_sql' });
  assert.equal(resolved.status, 'unknown'); assert.equal(resolved.reasonCode, 'ACTIVATION_POSTGRES_PREPARED');
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const journal = await f.journalVault.readArtifact({ id: pgAttemptId('activation_before_sql'), purpose });
  assert.equal((journal.value as { phase: string }).phase, 'prepared');
});

test('lost SQL commit acknowledgement resolves exact committed evidence after reopen without publication replay', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.afterPublish = async () => { throw new Error('Synthetic lost SQL commit acknowledgement.'); };
  await assert.rejects(f.activate('activation_sql_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'committed');
  const journalBefore = await f.journalVault.readArtifact({ id: pgAttemptId('activation_sql_ack_lost'), purpose });
  assert.equal((journalBefore.value as { phase: string }).phase, 'prepared');
  const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_sql_ack_lost' })).status, 'committed');
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const journalAfter = await f.journalVault.readArtifact({ id: pgAttemptId('activation_sql_ack_lost'), purpose });
  assert.equal(journalAfter.valueDigest, journalBefore.valueDigest, 'Read-only recovery never writes a new acknowledgement marker.');
  await assert.rejects(f.activate('activation_sql_ack_replay'), code('ACTIVATION_TARGET_CHANGED'));
  assert.equal(f.target.publishCalls, 1); assert.equal(f.counts().prepared, 1);
});

test('lost final SQL journal acknowledgement resolves committed custody and preserves single-use claims', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.journalVault.writeArtifact.bind(f.journalVault); let lost = false;
  f.journalVault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id === pgAttemptId('activation_journal_ack_lost') && (input.value as { phase?: string }).phase === 'committed') {
      lost = true; throw new Error('Synthetic durable PostgreSQL journal acknowledgement lost.');
    }
    return result;
  };
  await assert.rejects(f.activate('activation_journal_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_journal_ack_lost' })).status, 'committed');
  await assert.rejects(f.activate('activation_journal_replay'), code('ACTIVATION_TARGET_CHANGED'));
  assert.deepEqual(await treeBytes(f.targetPath()), files); assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
});

test('a competing SQL occupant before publish survives refused activation and read-only restart', { timeout: 30_000 }, async t => {
  const f = await fixture(t); let occupant: VaultEnvelope | undefined;
  f.target.beforePublish = async () => {
    occupant = { ...clone(f.target.original!), id: 'synthetic_competing_occupant' };
    f.target.current = clone(occupant); f.target.currentCreationId = 'competing_creation';
  };
  await assert.rejects(f.activate('activation_competing'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(f.target.current, occupant); const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_competing' })).status, 'unknown');
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
});

test('replaced committed SQL incarnation remains unknown and retained', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_replaced_sql'), files = await treeBytes(f.targetPath());
  f.target.currentCreationId = 'replacement_creation'; const occupant = clone(f.target.current);
  await f.reopen(); assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
});

test('native source revision mismatch refuses before target reservation', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.setNativeRevisionOffset(1);
  await assert.rejects(f.activate('activation_stale_native'), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
  assert.equal(f.target.reserveCalls, 0); assert.equal(f.target.publishCalls, 0); assert.equal(f.counts().prepared, 0);
  assert.deepEqual(await readdir(f.targetPath()), []); assert.deepEqual(f.sourceVault.read(), f.sourceInitial);
});

test('restart authenticates source incarnation and repeats current owner readiness after awaited inspection', { timeout: 40_000 }, async t => {
  await t.test('source slot ABA', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_source_aba'); f.replaceSourceCreation(); await f.reopen();
    await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('ACTIVATION_POSTGRES_SOURCE_CHANGED'));
    assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  });
  await t.test('late root readiness revoked', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_root_fence');
    f.onInspection(async () => { f.setReady(false); });
    await assert.rejects(f.host.resolve(interchangeOwner, { activationId: summary.activationId }), code('INTERCHANGE_NOT_READY'));
    f.setReady(true); f.onInspection();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'committed');
    assert.equal(f.target.publishCalls, 1);
  });
});

test('changed original SQL envelope or physical evidence refuses recovery and retains modified material', { timeout: 40_000 }, async t => {
  await t.test('changed retained SQL envelope', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_altered_envelope');
    f.target.original!.snapshot.data = f.target.original!.snapshot.data.replace(/^./, value => value === 'A' ? 'B' : 'A');
    const changed = clone(f.target.original); await f.reopen();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(f.target.original, changed); assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
  await t.test('changed encrypted publication file', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_altered_file');
    const path = join(f.targetPath(), sqlFile), bytes = await readFile(path); bytes[bytes.length - 2] ^= 1; await writeFile(path, bytes);
    await f.reopen(); assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(await readFile(path), bytes); assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
  await t.test('byte-identical encrypted publication file replacement', async subtest => {
    const f = await fixture(subtest), summary = await f.activate('activation_replaced_sidecar');
    const path = join(f.targetPath(), sqlFile), bytes = await readFile(path), before = await lstat(path, { bigint: true });
    const replacement = join(f.targetPath(), 'live', 'replacement-postgres-envelope.encrypted.json');
    assert.equal(dirname(replacement), dirname(path)); await writeFile(replacement, bytes, { flag: 'wx' });
    const fresh = await lstat(replacement, { bigint: true });
    assert.notDeepEqual({ dev: String(fresh.dev), ino: String(fresh.ino), birthtimeNs: String(fresh.birthtimeNs) },
      { dev: String(before.dev), ino: String(before.ino), birthtimeNs: String(before.birthtimeNs) });
    await unlink(path); await rename(replacement, path); const files = await treeBytes(f.targetPath());
    assert.deepEqual(await readFile(path), bytes); await f.reopen();
    assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'unknown');
    assert.deepEqual(await treeBytes(f.targetPath()), files); assert.deepEqual(await readFile(path), bytes);
    assert.equal(f.target.deleteCalls, 0); assert.equal(f.target.publishCalls, 1);
  });
});

test('filesystem publication failure leaves prepared SQL inaccessible with both encrypted attempt records', { timeout: 30_000 }, async t => {
  const f = await fixture(t), original = f.sourceVault.withCustodyWriterAdmission.bind(f.sourceVault);
  f.sourceVault.withCustodyWriterAdmission = async _work => original(async () => { throw new Error('Synthetic boundary before filesystem links.'); });
  await assert.rejects(f.activate('activation_before_files'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.publishCalls, 0);
  for (const id of [pgAttemptId('activation_before_files'), localAttemptId('activation_before_files')]) {
    const retained = await f.journalVault.readArtifact({ id, purpose }); assert.equal((retained.value as { phase: string }).phase, 'prepared');
  }
  assert.deepEqual(await readdir(f.targetPath()), []); await f.reopen();
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: 'activation_before_files' })).status, 'unknown');
  for (const activationId of ['activation_before_files', 'activation_before_files_replay'])
    await assert.rejects(f.activate(activationId), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.target.deleteCalls, 0); assert.equal(f.counts().prepared, 1);
});

test('lost SQL reservation acknowledgement remains reserved after exact read-only operation inspection', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.afterReserve = async () => { throw new Error('Synthetic durable reserve acknowledgement lost.'); };
  await assert.rejects(f.activate('activation_reserve_ack_lost'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(f.target.phase, 'reserved'); assert.equal(f.counts().prepared, 0); assert.equal(f.target.publishCalls, 0);
  const journal = await f.journalVault.readArtifact({ id: pgAttemptId('activation_reserve_ack_lost'), purpose });
  assert.equal((journal.value as { phase: string }).phase, 'attempted');
  assert.deepEqual(await readdir(f.targetPath()), []); await f.reopen();
  const result = await f.host.resolve(interchangeOwner, { activationId: 'activation_reserve_ack_lost' });
  assert.equal(result.status, 'unknown'); assert.equal(result.reasonCode, 'ACTIVATION_POSTGRES_RESERVED');
  assert.deepEqual(await readdir(f.targetPath()), []); assert.equal(f.target.reserveCalls, 1); assert.equal(f.target.deleteCalls, 0);
  const after = await f.journalVault.readArtifact({ id: pgAttemptId('activation_reserve_ack_lost'), purpose });
  assert.equal(after.valueDigest, journal.valueDigest, 'Recovery classifies exact reserved custody without changing durable attempts.');
});

test('already occupied SQL target refuses activation without removing its occupant or publishing physical files', { timeout: 30_000 }, async t => {
  const f = await fixture(t); f.target.current = f.sourceEnvelope;
  const occupant = clone(f.target.current);
  await assert.rejects(f.activate('activation_occupied_sql'), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await readdir(f.targetPath()), []);
  assert.equal(f.counts().prepared, 0); assert.equal(f.target.publishCalls, 0); assert.equal(f.target.deleteCalls, 0);
});

test('lost filesystem committed-marker acknowledgement keeps SQL prepared and resolves unknown without publishing', { timeout: 30_000 }, async t => {
  const f = await fixture(t), activationId = 'activation_filesystem_ack_lost';
  const original = f.journalVault.writeArtifact.bind(f.journalVault); let lost = false;
  f.journalVault.writeArtifact = async input => {
    const result = await original(input);
    if (input.id === localAttemptId(activationId) && (input.value as { phase?: string }).phase === 'committed') {
      lost = true; throw new Error('Synthetic durable filesystem committed-marker acknowledgement lost.');
    }
    return result;
  };
  await assert.rejects(f.activate(activationId), code('ACTIVATION_COMMIT_UNKNOWN'));
  assert.equal(lost, true); assert.equal(f.target.phase, 'prepared'); assert.equal(f.target.publishCalls, 0);
  const local = await f.journalVault.readArtifact({ id: localAttemptId(activationId), purpose });
  assert.equal((local.value as { phase: string }).phase, 'committed');
  const pg = await f.journalVault.readArtifact({ id: pgAttemptId(activationId), purpose });
  assert.equal((pg.value as { phase: string }).phase, 'prepared');
  const files = await treeBytes(f.targetPath()); await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId }),
    { status: 'unknown', activationId, reasonCode: 'ACTIVATION_POSTGRES_PREPARED' });
  await assert.rejects(f.openTarget()); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.publishCalls, 0); assert.equal(f.target.deleteCalls, 0); assert.equal(f.counts().prepared, 1);
  assert.equal((await f.journalVault.readArtifact({ id: pgAttemptId(activationId), purpose })).valueDigest, pg.valueDigest);
});

test('SQL inspection transport failure resolves exact unknown and leaves committed material intact', { timeout: 30_000 }, async t => {
  const f = await fixture(t), summary = await f.activate('activation_inspection_transport');
  const files = await treeBytes(f.targetPath()), occupant = clone(f.target.current);
  const original = f.target.inspect.bind(f.target);
  f.target.inspect = async () => { throw new Error('Synthetic read-only SQL inspection transport failure.'); };
  await f.reopen();
  assert.deepEqual(await f.host.resolve(interchangeOwner, { activationId: summary.activationId }),
    { status: 'unknown', activationId: summary.activationId, reasonCode: 'ACTIVATION_POSTGRES_INSPECTION_UNKNOWN' });
  assert.deepEqual(f.target.current, occupant); assert.deepEqual(await treeBytes(f.targetPath()), files);
  assert.equal(f.target.publishCalls, 1); assert.equal(f.target.deleteCalls, 0);
  f.target.inspect = original;
  assert.equal((await f.host.resolve(interchangeOwner, { activationId: summary.activationId })).status, 'committed');
  assert.equal(f.target.publishCalls, 1);
});

test('injected prepared cleanup retains exact-owned tombstones and refuses changed custody or occupants', { timeout: 30_000 }, async t => {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const root = await realpath(await mkdtemp(join(base, 'chausar-activation-cleanup-')));
  assert.equal(dirname(root), base);
  const memory = new EncryptedMemoryStorage();
  let vault: Vault | undefined;
  t.after(async () => {
    await vault?.close();
    const actual = await realpath(root);
    assert.equal(dirname(actual), base); assert.match(actual.split(/[\\/]/).at(-1)!, /^chausar-activation-cleanup-/);
    await rm(actual, { recursive: true, force: true });
  });
  vault = (await Vault.create({ directory: join(root, 'envelope'), name: 'Injected cleanup ciphertext fixture',
    storage: memory, passphrase, demo: true })).vault;
  const envelope = clone(memory.envelope!); await vault.close();
  async function prepared(label: string, commit = true) {
    const target = new InjectedTargetCustody(); target.directory = join(root, label); await mkdir(target.directory);
    const reserved = await target.reserve({ operationId: `fixture_${label}`, creationId: `fixture_${label}` });
    const adapter = target.createPreparedAdapter(reserved);
    if (commit) await adapter.commit(clone(envelope), null);
    return { target, adapter };
  }
  const reserved = await prepared('reserved', false);
  assert.equal(await reserved.adapter.deleteIfCurrent!(clone(envelope)), 'absent');
  assert.equal(reserved.target.phase, 'reserved'); assert.equal(reserved.target.deleteCalls, 0);
  const owned = await prepared('owned'), original = clone(owned.target.original), proof = clone(owned.target.proof);
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'deleted');
  assert.equal(owned.target.phase, 'rolled-back'); assert.equal(owned.target.deleteCalls, 1);
  assert.deepEqual(owned.target.original, original); assert.deepEqual(owned.target.proof, proof);
  assert.equal(await owned.adapter.load(), null);
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'absent');
  assert.equal(owned.target.deleteCalls, 1); assert.deepEqual(owned.target.original, original);
  owned.target.original!.snapshot.data += '_changed_tombstone';
  await assert.rejects(owned.adapter.load());
  assert.equal(await owned.adapter.deleteIfCurrent!(clone(envelope)), 'mismatch');
  assert.equal(owned.target.deleteCalls, 1);
  const callerOwned = await prepared('caller_owned', false), callerReservation = clone(callerOwned.target.reservation!);
  const captured = callerOwned.target.createPreparedAdapter(callerReservation);
  callerReservation.creationId = 'mutated_caller_creation';
  await captured.commit(clone(envelope), null);
  assert.equal(callerOwned.target.proof!.creationId, callerOwned.target.reservation!.creationId);
  assert.equal(await captured.deleteIfCurrent!(clone(envelope)), 'deleted');
  const cases: { label: string; change(target: InjectedTargetCustody, expected: VaultEnvelope): void }[] = [
    { label: 'wrong_expected_ciphertext', change: (_target, expected) => { expected.snapshot.data += '_different'; } },
    { label: 'ordinary_occupant', change: target => { target.current = { ...clone(envelope), id: 'competing_fixture_vault' }; target.currentCreationId = 'competing_fixture_creation'; } },
    { label: 'ordinary_incarnation_without_ciphertext', change: target => { target.currentCreationId = 'competing_fixture_creation'; } },
    { label: 'replaced_proof', change: target => { target.proof!.creationId = 'competing_fixture_creation'; } },
    { label: 'replaced_reservation', change: target => { target.reservation!.operationId = 'competing_fixture_operation'; } },
    { label: 'changed_retained_ciphertext', change: target => { target.original!.snapshot.data += '_different'; } },
    { label: 'committed_phase', change: target => { target.phase = 'committed'; } },
    { label: 'changed_storage', change: target => { target.storage.slot = 'competing_fixture_slot'; } },
  ];
  for (const item of cases) {
    const { target, adapter } = await prepared(item.label), expected = clone(envelope); item.change(target, expected);
    const before = clone({ phase: target.phase, reservation: target.reservation, proof: target.proof, original: target.original,
      current: target.current, currentCreationId: target.currentCreationId, deleteCalls: target.deleteCalls });
    assert.equal(await adapter.deleteIfCurrent!(expected), 'mismatch', item.label);
    assert.deepEqual({ phase: target.phase, reservation: target.reservation, proof: target.proof, original: target.original,
      current: target.current, currentCreationId: target.currentCreationId, deleteCalls: target.deleteCalls }, before, item.label);
  }
  const changedPhysical = await prepared('changed_physical');
  await rename(changedPhysical.target.directory, changedPhysical.target.directory + '_retained');
  await mkdir(changedPhysical.target.directory);
  assert.equal(await changedPhysical.adapter.deleteIfCurrent!(clone(envelope)), 'mismatch');
  assert.equal(changedPhysical.target.phase, 'prepared'); assert.equal(changedPhysical.target.deleteCalls, 0);
  t.diagnostic(JSON.stringify({ nativePostgresQualified: false, cleanupCustody: 'injected-test-fixture',
    exactOwnedCleanup: true, retainedCiphertextTombstone: true, changedOccupantsPreserved: true }));
});
