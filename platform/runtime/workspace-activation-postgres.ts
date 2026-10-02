import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { authorize, check, type Context } from './contracts.ts';
import { acquireProcessLock } from './process-lock.ts';
import { safeDirectory, Vault, type EncryptedSnapshotAdapter, type PrivateArtifactRef } from './vault.ts';
import { canonicalInterchangeJson, interchangeDigest, validateWorkspaceInterchange } from './workspace-interchange.ts';
import { WorkspaceActivationLocalCustody, type WorkspaceActivationLocalOptions } from './workspace-activation-local.ts';
import type { AuthenticatedActivationCandidate, WorkspaceActivationCommit, WorkspaceActivationPorts } from './workspace-activation.ts';
import type { WorkspaceBackupActivationLease, WorkspaceBackupActivationPorts } from './workspace-backup-activation.ts';
import type { WorkspaceInterchangeCustodyRecord } from './workspace-interchange-host.ts';
import type { WorkspacePostgresCustody, PostgresTargetReservation, PostgresPublicationProof, PostgresTargetInspection, PostgresSourceCustodyLease, PostgresStorageIdentity } from './workspace-postgres-custody.ts';

const purpose = 'workspace-interchange' as const;
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const same = (left: unknown, right: unknown) => canonicalInterchangeJson(left) === canonicalInterchangeJson(right);
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const attemptId = (id: string) => `wpg_${sha(id)}_attempt`;
const candidateId = (id: string, part: string) => `wac_${sha(id)}_${part}`;
const ENVELOPE = 'live/postgres-publication.encrypted.json';
const reference = ({ id, purpose, valueDigest, diskBytes }: PrivateArtifactRef): PrivateArtifactRef => ({ id, purpose, valueDigest, diskBytes });
async function completed(work: () => Promise<void>) {
  check(await work() === undefined, 'ACTIVATION_ROOT_GUARD', 'Trusted custody guards must complete without returning admission data.');
}
function owner(vault: Vault, context: Context) {
  check(context.channel === 'desktop' && !context.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Use the current untainted desktop owner.');
  const member = authorize(vault, context, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Use the current unrestricted source owner.');
}
async function find(vault: Vault, id: string) {
  try { return await vault.readArtifact({ id, purpose }); }
  catch (error: any) { if (error.code === 'ARTIFACT_NOT_FOUND') return null; throw error; }
}
type Physical = { dev: string; ino: string; birthtimeNs: string };
const physical = (stat: { dev: bigint; ino: bigint; birthtimeNs: bigint }): Physical => ({ dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) });
async function ciphertextHash(path: string, maxBytes: number, expected: Physical) {
  const before = await lstat(path, { bigint: true });
  check(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= BigInt(maxBytes) && same(physical(before), expected),
    'ACTIVATION_POSTGRES_CIPHERTEXT_CHANGED', 'Original ciphertext requires a bounded regular singly owned file.');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const stat = await file.stat({ bigint: true }), bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
    check(stat.dev === before.dev && stat.ino === before.ino && stat.birthtimeNs === before.birthtimeNs,
      'ACTIVATION_POSTGRES_CIPHERTEXT_CHANGED', 'Ciphertext physical generation changed before opening.');
    while (length < bytes.length) { const read = await file.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
    const after = await file.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    check(length === Number(before.size) && [after, current].every(value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n
      && value.dev === before.dev && value.ino === before.ino && value.birthtimeNs === before.birthtimeNs && value.size === before.size
      && value.mtimeNs === before.mtimeNs && value.ctimeNs === before.ctimeNs),
    'ACTIVATION_POSTGRES_CIPHERTEXT_CHANGED', 'Ciphertext bytes or physical generation changed during measurement.');
    return sha(bytes.subarray(0, length));
  } finally { await file.close(); }
}

/** Root capabilities only. The existing local publisher owns physical fences and
 * the single-use ledger; A owns SQL identity, preparation, publication and inspection. */
export type WorkspaceActivationPostgresOptions = Omit<WorkspaceActivationLocalOptions, 'bootstrap'> & {
  nativeSource: WorkspacePostgresCustody;
  targetCustody(targetId: string, targetDirectory: string): Promise<WorkspacePostgresCustody>;
  bootstrap: {
    allocateAuthority: WorkspaceActivationLocalOptions['bootstrap']['allocateAuthority'];
    prepare(input: { stagingDirectory: string; publication: WorkspaceActivationCommit; storage: EncryptedSnapshotAdapter }):
      Promise<{ liveFiles: string[]; qualification: 'test-fixture' | 'encrypted-local-host' }>;
    /** Authenticate exact prepared ciphertext during staging, and actual current
     * committed authority/lineage during readback. Never publish, retry or attach. */
    inspect(input: { targetDirectory: string; publication: WorkspaceActivationCommit; inspection: PostgresTargetInspection }):
      Promise<{ authorityCiphertextBytes: number; authorityKind: 'adapter-issued-envelope' }>;
  };
};
type PostgresJournal = {
  format: 'chausar.activation-postgres-journal.v1'; phase: 'attempted' | 'reserved' | 'prepared' | 'committed';
  sourceVaultId: string; journalVaultId: string; contextDigest: string;
  publicationDigest: string; record: WorkspaceActivationCommit['record'];
  sourceStorage: PostgresStorageIdentity; sourceCreationId: string; sourceAuthorityDigest: string;
  operationId: string; creationId: string; targetStorage: PostgresStorageIdentity;
  reservation: PostgresTargetReservation | null; proof: PostgresPublicationProof | null; envelopeSha256: string | null;
  envelopePhysical: Physical | null;
};

/** Filesystem evidence commits first; SQL publication follows once. Any uncertain
 * boundary is retained for explicit inspection. There is deliberately no rollback. */
export class WorkspaceActivationPostgresCustody {
  readonly ports: WorkspaceActivationPorts;
  readonly #options: WorkspaceActivationPostgresOptions;
  readonly #local: WorkspaceActivationLocalCustody;
  readonly #native = new AsyncLocalStorage<PostgresSourceCustodyLease>();
  readonly #recovery = new AsyncLocalStorage<{ context: Context; sqlBytes: number; activationId?: string; reasonCode?: string }>();
  readonly #publication = new AsyncLocalStorage<{ context: Context; publication: WorkspaceActivationCommit; preparing: boolean }>();
  constructor(options: WorkspaceActivationPostgresOptions) {
    check(options?.sourceVault instanceof Vault && options.sourceVault.storageKind === 'postgres'
      && options.journalVault instanceof Vault && options.sourceVault.vaultId !== options.journalVault.vaultId
      && typeof options.nativeSource?.withSource === 'function' && typeof options.targetCustody === 'function'
      && typeof options.bootstrap?.prepare === 'function' && typeof options.bootstrap?.inspect === 'function',
    'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Install actual PostgreSQL source custody and separate fresh target/bootstrap capabilities.');
    this.#options = { ...options, budgets: structuredClone(options.budgets) };
    this.#local = new WorkspaceActivationLocalCustody({ ...options,
      source: { withSource: (context, expected, work, candidateId) => options.source.withSource(context, expected, source =>
        options.nativeSource.withSource(native => this.#native.run(native, async () => {
          check(native.authority.vaultId === options.sourceVault.vaultId && native.authority.revision === source.state.revision,
            'ACTIVATION_POSTGRES_SOURCE_CHANGED', 'Native source authority must fence this exact supplied Vault and revision.');
          const recovery = this.#recovery.getStore();
          if (recovery?.activationId) {
            const retained = await find(options.journalVault, attemptId(recovery.activationId));
            if (retained) this.#validateJournal(context, recovery.activationId, retained.value as PostgresJournal);
          }
          const result = await work(source);
          if (recovery?.activationId && (result as any)?.status !== 'committed') await this.#classify(context, recovery.activationId);
          return result;
        })), candidateId) },
      bootstrap: {
      allocateAuthority: options.bootstrap.allocateAuthority,
      prepare: input => this.#prepare(input), inspect: input => this.#inspect(input),
    } });
    this.ports = { custody: this.#local.ports.custody,
      withTransaction: (context, input, work) => this.#recovery.run({ context: structuredClone(context), sqlBytes: 0 }, () =>
        this.#local.ports.withTransaction(context, input, async lease => {
          const native = this.#native.getStore();
          check(native, 'ACTIVATION_POSTGRES_ROOT_GUARD', 'Retain the native lease inside the already-held Vault snapshot.');
          return work({ ...lease, commit: async publication => {
            const value = structuredClone(publication), ctx = structuredClone(context);
            await this.#publication.run({ context: ctx, publication: value, preparing: true }, () => lease.commit(value));
            await completed(() => lease.source.assertCurrent()); await completed(() => native.assertCurrent());
            const retained = await this.#journal(ctx, value), journal = retained.value;
            check(journal.phase === 'prepared' && journal.proof, 'ACTIVATION_POSTGRES_UNRESOLVED', 'Exact prepared SQL proof must survive complete filesystem publication.');
            const target = await this.#target(value.record.targetId);
            await target.publish(structuredClone(journal.proof));
            await this.#sql(value, journal, true);
            await options.journalVault.writeArtifact({ id: retained.ref.id, purpose, expectedDigest: retained.ref.valueDigest,
              value: { ...journal, phase: 'committed' } });
            await completed(() => native.assertCurrent());
          } });
        })),
      readback: (context, input) => this.#recovery.run({ context: structuredClone(context), activationId: input.activationId, sqlBytes: 0 }, async () => {
        owner(options.sourceVault, context);
        // Local inspection calls #inspect under its retained source/target/candidate
        // fences. SQL commitment alone cannot escape as a committed target.
        const result = await this.#local.ports.readback(context, input);
        const measured = this.#recovery.getStore()!;
        if (result.status === 'committed') {
          check(measured.sqlBytes > 0, 'ACTIVATION_POSTGRES_UNRESOLVED', 'Complete held SQL authentication must precede committed readback.');
          const ciphertextBytes = result.ciphertextBytes + measured.sqlBytes;
          if (ciphertextBytes > this.#options.budgets.maxBytes) return { status: 'unknown' as const, activationId: input.activationId, reasonCode: 'ACTIVATION_LIMIT' };
          return { ...result, ciphertextBytes };
        }
        return measured.reasonCode ? { status: 'unknown' as const, activationId: input.activationId, reasonCode: measured.reasonCode } : result;
      }),
    };
    // Immediate readback uses the same exact combined measurement as restart.
    const transaction = this.ports.withTransaction;
    this.ports.withTransaction = (context, input, work) => transaction(context, input, lease => work({ ...lease,
      readback: async () => {
        const result = await lease.readback();
        if (result.status !== 'committed') return result;
        const measured = this.#recovery.getStore();
        check(measured && measured.sqlBytes > 0, 'ACTIVATION_POSTGRES_UNRESOLVED', 'Exact held native authority measurement is required.');
        const ciphertextBytes = result.ciphertextBytes + measured.sqlBytes;
        check(ciphertextBytes <= this.#options.budgets.maxBytes, 'ACTIVATION_LIMIT', 'Complete filesystem and native envelope custody exceeds its declared byte budget.');
        return { ...result, ciphertextBytes };
      },
    }));
  }
  targetPath(targetId: string) { return this.#local.targetPath(targetId); }
  async #target(targetId: string) {
    const target = await this.#options.targetCustody(targetId, this.targetPath(targetId));
    check(target && ['reserve', 'createPreparedAdapter', 'publish', 'inspect', 'inspectOperation', 'storageIdentity'].every(name => typeof (target as any)[name] === 'function'),
      'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Root must resolve one actual installed target custody capability.');
    const storage = await target.storageIdentity(), source = this.#native.getStore()?.storage;
    check(source, 'ACTIVATION_POSTGRES_ROOT_GUARD', 'Target resolution requires the retained native source lease.');
    check(!(storage.storageId === source.storageId && storage.databaseOid === source.databaseOid
      && storage.serverAddress === source.serverAddress && storage.serverPort === source.serverPort && storage.slot === source.slot),
    'ACTIVATION_POSTGRES_TARGET_OCCUPIED', 'Target must be a distinct SQL authority slot.');
    return target;
  }
  #validateJournal(context: Context, activationId: string, journal: PostgresJournal) {
    const native = this.#native.getStore();
    check(journal && same(Object.keys(journal).sort(), ['contextDigest', 'creationId', 'envelopePhysical', 'envelopeSha256', 'format', 'journalVaultId', 'operationId', 'phase', 'proof', 'publicationDigest', 'record', 'reservation', 'sourceAuthorityDigest', 'sourceCreationId', 'sourceStorage', 'sourceVaultId', 'targetStorage'])
      && journal.format === 'chausar.activation-postgres-journal.v1' && ['attempted', 'reserved', 'prepared', 'committed'].includes(journal.phase)
      && journal.sourceVaultId === this.#options.sourceVault.vaultId && journal.journalVaultId === this.#options.journalVault.vaultId
      && journal.record.activationId === activationId && journal.contextDigest === interchangeDigest(context)
      && /^[a-f0-9]{64}$/.test(journal.publicationDigest)
      && journal.operationId === 'activation_' + activationId && /^publication_[a-f0-9-]{36}$/.test(journal.creationId)
      && /^[a-f0-9]{64}$/.test(journal.sourceAuthorityDigest)
      && (journal.phase === 'attempted' ? journal.reservation === null && journal.proof === null && journal.envelopeSha256 === null && journal.envelopePhysical === null
        : journal.phase === 'reserved' ? journal.reservation !== null && journal.proof === null && journal.envelopeSha256 === null && journal.envelopePhysical === null
        : journal.reservation !== null && journal.proof !== null && /^[a-f0-9]{64}$/.test(journal.envelopeSha256 ?? '') && journal.envelopePhysical
          && same(Object.keys(journal.envelopePhysical).sort(), ['birthtimeNs', 'dev', 'ino'])
          && Object.values(journal.envelopePhysical).every(value => typeof value === 'string' && /^\d{1,30}$/.test(value))),
    'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'Retain the exact source incarnation, owner, journal, phase and publication binding.');
    check(native && same(journal.sourceStorage, native.storage) && journal.sourceCreationId === native.authority.creationId
      && journal.sourceAuthorityDigest === interchangeDigest(native.authority),
    'ACTIVATION_POSTGRES_SOURCE_CHANGED', 'Current source storage, slot incarnation or encrypted authority differs from the retained publication.');
  }
  async #journal(context: Context, publication: WorkspaceActivationCommit) {
    const retained = await find(this.#options.journalVault, attemptId(publication.record.activationId));
    check(retained, 'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'The independently encrypted SQL attempt is absent.');
    const value = retained.value as PostgresJournal; this.#validateJournal(context, publication.record.activationId, value);
    const complete = { record: publication.record, state: publication.state, evidence: publication.evidence, authority: publication.authority };
    check(same(value.record, publication.record) && value.publicationDigest === interchangeDigest(complete),
      'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'SQL proof must bind the exact complete immutable publication.');
    return { value, ref: reference(retained) };
  }
  async #prepare(input: Parameters<WorkspaceActivationLocalOptions['bootstrap']['prepare']>[0]) {
    const active = this.#publication.getStore(), publication = input.publication;
    check(active?.preparing && same(active.publication, publication), 'ACTIVATION_POSTGRES_ROOT_GUARD', 'Bootstrap requires the exact held publication callback.');
    const target = await this.#target(publication.record.targetId);
    const native = this.#native.getStore()!;
    let journal: PostgresJournal = { format: 'chausar.activation-postgres-journal.v1', phase: 'attempted',
      sourceVaultId: this.#options.sourceVault.vaultId, journalVaultId: this.#options.journalVault.vaultId,
      contextDigest: interchangeDigest(active.context), publicationDigest: interchangeDigest(publication), record: structuredClone(publication.record),
      sourceStorage: structuredClone(native.storage), sourceCreationId: native.authority.creationId,
      sourceAuthorityDigest: interchangeDigest(native.authority),
      operationId: 'activation_' + publication.record.activationId, creationId: 'publication_' + randomUUID(), targetStorage: await target.storageIdentity(),
      reservation: null, proof: null, envelopeSha256: null, envelopePhysical: null };
    let ref = await this.#options.journalVault.writeArtifact({ id: attemptId(publication.record.activationId), purpose, value: journal, expectedDigest: null });
    const reservation = await target.reserve({ operationId: journal.operationId, creationId: journal.creationId });
    check(reservation.operationId === journal.operationId && reservation.creationId === journal.creationId && same(reservation.storage, journal.targetStorage),
      'ACTIVATION_POSTGRES_TARGET_CHANGED', 'SQL reservation must bind the independently journaled target storage and chosen identities.');
    await this.#physical(publication.record.targetId, reservation);
    journal = { ...journal, phase: 'reserved', reservation };
    ref = await this.#options.journalVault.writeArtifact({ id: ref.id, purpose, value: journal, expectedDigest: ref.valueDigest });
    const prepared = await this.#options.bootstrap.prepare({ ...input, storage: target.createPreparedAdapter(reservation) });
    check(prepared && same(Object.keys(prepared).sort(), ['liveFiles', 'qualification']) && Array.isArray(prepared.liveFiles)
      && !prepared.liveFiles.includes(ENVELOPE) && ['test-fixture', 'encrypted-local-host'].includes(prepared.qualification),
    'ACTIVATION_POSTGRES_BOOTSTRAP_REQUIRED', 'Fresh root bootstrap must return its complete closed filesystem manifest.');
    const inspection = await target.inspect(reservation);
    check(inspection.status === 'prepared' && inspection.proof && inspection.envelope && inspection.envelope.revision === 0
      && inspection.proof.vaultId !== this.#options.sourceVault.vaultId && inspection.proof.vaultId !== this.#options.journalVault.vaultId,
    'ACTIVATION_POSTGRES_BOOTSTRAP_REQUIRED', 'Only exact unpublished fresh SQL ciphertext can back this target.');
    await safeDirectory(join(input.stagingDirectory, 'live'));
    const raw = JSON.stringify(inspection.envelope), file = await open(join(input.stagingDirectory, ENVELOPE), 'wx', 0o600);
    try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
    journal = { ...journal, phase: 'prepared', proof: inspection.proof, envelopeSha256: sha(raw),
      envelopePhysical: physical(await lstat(join(input.stagingDirectory, ENVELOPE), { bigint: true })) };
    await this.#options.journalVault.writeArtifact({ id: ref.id, purpose, value: journal, expectedDigest: ref.valueDigest });
    return { liveFiles: [...prepared.liveFiles, ENVELOPE], qualification: prepared.qualification };
  }
  async #sql(publication: WorkspaceActivationCommit, journal: PostgresJournal, committed: boolean) {
    check(journal.proof && journal.reservation && /^[a-f0-9]{64}$/.test(journal.envelopeSha256 ?? '')
      && same(journal.reservation, { format: journal.proof.format, storage: journal.proof.storage, operationId: journal.proof.operationId,
        creationId: journal.proof.creationId, target: journal.proof.target })
      && journal.proof.operationId === journal.operationId && journal.proof.creationId === journal.creationId
      && same(journal.proof.storage, journal.targetStorage),
    'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'Exact original prepared ciphertext proof is required.');
    await this.#physical(publication.record.targetId, journal.proof);
    const inspection = await (await this.#target(publication.record.targetId)).inspect(journal.proof);
    const recovery = this.#recovery.getStore();
    if (recovery && inspection.status !== 'committed') recovery.reasonCode = `ACTIVATION_POSTGRES_${inspection.status.toUpperCase()}`;
    check((committed ? inspection.status === 'committed' : ['prepared', 'committed'].includes(inspection.status))
      && same(inspection.proof, journal.proof) && inspection.envelope && sha(JSON.stringify(inspection.envelope)) === journal.envelopeSha256,
    'ACTIVATION_POSTGRES_UNRESOLVED', 'SQL state, creation, proof and original ciphertext must authenticate independently.');
    return inspection;
  }
  async #physical(targetId: string, reservation: PostgresTargetReservation) {
    check(reservation.target.directory === this.targetPath(targetId), 'ACTIVATION_POSTGRES_TARGET_CHANGED', 'SQL custody must bind the exact managed physical target.');
    const stat = await lstat(reservation.target.directory, { bigint: true });
    check(stat.isDirectory() && !stat.isSymbolicLink()
      && same(reservation.target.physical, { dev: String(stat.dev), ino: String(stat.ino), birthtimeNs: String(stat.birthtimeNs) }),
    'ACTIVATION_POSTGRES_TARGET_CHANGED', 'The SQL reservation physical generation differs from the filesystem target.');
  }
  async #classify(context: Context, activationId: string) {
    const recovery = this.#recovery.getStore()!, retained = await find(this.#options.journalVault, attemptId(activationId));
    if (!retained) return;
    const journal = retained.value as PostgresJournal; this.#validateJournal(context, activationId, journal);
    const directory = await safeDirectory(join(this.#options.applicationDirectory, '.workspace-interchange-control', 'targets'), true);
    const lock = await acquireProcessLock(join(directory, sha(this.targetPath(journal.record.targetId)) + '.lock'),
      { busyCode: 'ACTIVATION_BUSY', changedCode: 'ACTIVATION_LOCK_CHANGED' });
    try {
      const target = await this.#target(journal.record.targetId);
      check(same(await target.storageIdentity(), journal.targetStorage), 'ACTIVATION_POSTGRES_TARGET_CHANGED', 'Installed target storage differs from the retained attempt.');
      const inspection = journal.reservation ? await target.inspect(journal.proof ?? journal.reservation)
        : await target.inspectOperation({ operationId: journal.operationId, creationId: journal.creationId });
      if (inspection.status !== 'committed') recovery.reasonCode = `ACTIVATION_POSTGRES_${inspection.status.toUpperCase()}`;
    } catch { recovery.reasonCode = 'ACTIVATION_POSTGRES_INSPECTION_UNKNOWN'; }
    finally { await lock.release(); }
  }
  async #inspect(input: Parameters<WorkspaceActivationLocalOptions['bootstrap']['inspect']>[0]) {
    const active = this.#publication.getStore(), context = active?.context ?? this.#recovery.getStore()?.context;
    // Recovery is admitted by the source context, never the newly allocated target context.
    const retained = await find(this.#options.journalVault, attemptId(input.publication.record.activationId));
    check(retained, 'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'The SQL publication binding is absent.');
    const journal = retained.value as PostgresJournal;
    const allowedPrepared = active?.preparing === true && same(active.publication, input.publication);
    check(journal.sourceVaultId === this.#options.sourceVault.vaultId && journal.journalVaultId === this.#options.journalVault.vaultId
      && same(journal.record, input.publication.record) && journal.publicationDigest === interchangeDigest(input.publication),
    'ACTIVATION_POSTGRES_JOURNAL_CHANGED', 'Current filesystem custody requires the exact independently bound SQL publication.');
    check(context, 'ACTIVATION_POSTGRES_ROOT_GUARD', 'Inspection requires current source admission under retained custody.');
    this.#validateJournal(context, input.publication.record.activationId, journal);
    const before = await this.#sql(input.publication, journal, !allowedPrepared);
    check(journal.envelopePhysical && await ciphertextHash(join(input.targetDirectory, ENVELOPE), this.#options.budgets.maxBytes, journal.envelopePhysical) === journal.envelopeSha256,
      'ACTIVATION_POSTGRES_CIPHERTEXT_CHANGED', 'The original SQL ciphertext file changed.');
    const measurement = await this.#options.bootstrap.inspect({ ...input, inspection: structuredClone(before) });
    check(measurement && same(Object.keys(measurement).sort(), ['authorityCiphertextBytes', 'authorityKind'])
      && measurement.authorityKind === 'adapter-issued-envelope' && Number.isSafeInteger(measurement.authorityCiphertextBytes)
      && measurement.authorityCiphertextBytes > 0 && measurement.authorityCiphertextBytes <= this.#options.budgets.maxBytes,
    'ACTIVATION_POSTGRES_MEASUREMENT', 'Root must measure the authenticated current adapter-issued envelope, without claiming physical JSONB bytes.');
    const after = await this.#sql(input.publication, journal, !allowedPrepared);
    check(same(before, after) && await ciphertextHash(join(input.targetDirectory, ENVELOPE), this.#options.budgets.maxBytes, journal.envelopePhysical) === journal.envelopeSha256,
      'ACTIVATION_POSTGRES_CUSTODY_CHANGED', 'SQL or physical evidence changed during current-live authentication.');
    if (this.#recovery.getStore() && after.status === 'committed') this.#recovery.getStore()!.sqlBytes =
      Buffer.byteLength(JSON.stringify(after.envelope)) + measurement.authorityCiphertextBytes;
  }
}
export function createWorkspaceActivationPostgresPorts(options: WorkspaceActivationPostgresOptions) { return new WorkspaceActivationPostgresCustody(options); }

type CandidateClaim = { id: string; creationId: string; sourceVaultId: string; contextDigest: string; sourceStorageDigest: string; sourceCreationId: string; sourceAuthorityDigest: string; recordDigest: string };
type CandidateBinding = CandidateClaim & { format: 'chausar.activation-postgres-candidate-binding.v1'; phase: 'preparing' | 'committed';
  qualification: 'test-fixture' | 'encrypted-local-host'; archive: PrivateArtifactRef | null; pin: PrivateArtifactRef | null };
export type WorkspacePostgresActivationCandidateOptions = Pick<WorkspaceActivationPostgresOptions,
  'sourceVault' | 'journalVault' | 'applicationDirectory' | 'source' | 'nativeSource'> & { maxCandidateBytes: number };
export type WorkspacePostgresBackupActivationOriginals = {
  withTransaction<T>(context: Context, selection: Parameters<WorkspaceBackupActivationPorts['withTransaction']>[1],
    work: (lease: Omit<WorkspaceBackupActivationLease, 'createCandidate' | 'readCandidate'>) => Promise<T>): Promise<T>;
};

/** Independently encrypted issuance, separate from historical/source artifacts.
 * Candidate record and creation IDs are atomically consumed before any payload write. */
export class WorkspacePostgresActivationCandidates {
  readonly #options: WorkspacePostgresActivationCandidateOptions;
  constructor(options: WorkspacePostgresActivationCandidateOptions) {
    check(options?.sourceVault instanceof Vault && options.sourceVault.storageKind === 'postgres'
      && options.journalVault instanceof Vault && options.sourceVault !== options.journalVault && options.sourceVault.vaultId !== options.journalVault.vaultId
      && Number.isSafeInteger(options.maxCandidateBytes) && options.maxCandidateBytes > 0 && options.maxCandidateBytes <= 64 * 1024 * 1024,
    'ACTIVATION_POSTGRES_ROOT_REQUIRED', 'Candidate issuance requires actual separate source/journal custody and an explicit complete byte budget.');
    this.#options = { ...options };
  }
  async #lock<T>(id: string, work: () => Promise<T>) {
    check(idPattern.test(id), 'ACTIVATION_SHAPE', 'Use one candidate identity.');
    const directory = await safeDirectory(join(this.#options.applicationDirectory, '.workspace-interchange-control', 'records'), true);
    const lock = await acquireProcessLock(join(directory, sha(this.#options.sourceVault.vaultId + ':' + id) + '.lock'),
      { busyCode: 'ACTIVATION_BUSY', changedCode: 'ACTIVATION_LOCK_CHANGED' });
    try { return await work(); } finally { await lock.release(); }
  }
  async #ledger() {
    const saved = await find(this.#options.journalVault, 'wpg_candidate_ledger_v1');
    const ledger = saved?.value as { format: string; claims: CandidateClaim[] } ?? { format: 'chausar.activation-postgres-candidate-ledger.v1', claims: [] };
    check(ledger && same(Object.keys(ledger).sort(), ['claims', 'format']) && ledger.format === 'chausar.activation-postgres-candidate-ledger.v1'
      && Array.isArray(ledger.claims) && ledger.claims.length <= 4096 && ledger.claims.every(v => v
        && same(Object.keys(v).sort(), ['contextDigest', 'creationId', 'id', 'recordDigest', 'sourceAuthorityDigest', 'sourceCreationId', 'sourceStorageDigest', 'sourceVaultId'])
        && [v.id, v.creationId, v.sourceVaultId].every(id => typeof id === 'string' && idPattern.test(id))
        && typeof v.sourceCreationId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v.sourceCreationId)
        && [v.contextDigest, v.sourceStorageDigest, v.sourceAuthorityDigest, v.recordDigest].every(value => /^[a-f0-9]{64}$/.test(value)))
      && new Set(ledger.claims.map(v => v.id)).size === ledger.claims.length && new Set(ledger.claims.map(v => v.creationId)).size === ledger.claims.length,
    'ACTIVATION_CANDIDATE_CHANGED', 'Durable candidate identity consumption must remain complete and distinct.');
    return { saved, ledger };
  }
  async #read(context: Context, id: string, native: PostgresSourceCustodyLease): Promise<AuthenticatedActivationCandidate> {
    owner(this.#options.sourceVault, context);
    const saved = await find(this.#options.journalVault, candidateId(id, 'binding')), binding = saved?.value as CandidateBinding;
    check(binding && same(Object.keys(binding).sort(), ['archive', 'contextDigest', 'creationId', 'format', 'id', 'phase', 'pin', 'qualification', 'recordDigest', 'sourceAuthorityDigest', 'sourceCreationId', 'sourceStorageDigest', 'sourceVaultId'])
      && binding.format === 'chausar.activation-postgres-candidate-binding.v1' && binding.phase === 'committed'
      && binding.sourceVaultId === this.#options.sourceVault.vaultId && binding.id === id && binding.contextDigest === interchangeDigest(context)
      && binding.archive && binding.pin && ['test-fixture', 'encrypted-local-host'].includes(binding.qualification),
    'ACTIVATION_CANDIDATE_UNAVAILABLE', 'An exact independently committed candidate issuance is required.');
    check(binding.sourceStorageDigest === interchangeDigest(native.storage) && binding.sourceCreationId === native.authority.creationId
      && binding.sourceAuthorityDigest === interchangeDigest(native.authority)
      && native.authority.vaultId === this.#options.sourceVault.vaultId && native.authority.revision === this.#options.sourceVault.read().revision,
    'ACTIVATION_POSTGRES_SOURCE_CHANGED', 'Candidate custody belongs to another native source incarnation.');
    const { ledger } = await this.#ledger();
    check(ledger.claims.some(v => v.id === id && v.creationId === binding.creationId && v.sourceVaultId === binding.sourceVaultId
      && v.contextDigest === binding.contextDigest && v.sourceStorageDigest === binding.sourceStorageDigest && v.sourceCreationId === binding.sourceCreationId
      && v.sourceAuthorityDigest === binding.sourceAuthorityDigest
      && v.recordDigest === binding.recordDigest),
    'ACTIVATION_CANDIDATE_CHANGED', 'Exact paired issuance identities are absent.');
    const archive = await this.#options.journalVault.readArtifact(binding.archive), pin = await this.#options.journalVault.readArtifact(binding.pin);
    check(same(reference(archive), binding.archive) && same(reference(pin), binding.pin), 'ACTIVATION_CANDIDATE_CHANGED', 'Independent encrypted archive/pin references changed.');
    const a = archive.value as any, p = pin.value as any;
    check(a && p && same(Object.keys(a).sort(), ['content', 'creationId', 'format', 'recordId']) && same(Object.keys(p).sort(), ['format', 'pin', 'recordId'])
      && a.format === 'chausar.activation-candidate-archive.v1' && p.format === 'chausar.activation-candidate-pin.v1'
      && a.recordId === id && p.recordId === id && a.creationId === binding.creationId && p.pin?.kind === 'candidate'
      && p.pin.creationId === binding.creationId && p.pin.recordId === id && p.pin.contextDigest === binding.contextDigest
      && typeof a.content === 'string' && Buffer.byteLength(a.content) <= this.#options.maxCandidateBytes,
    'ACTIVATION_CANDIDATE_CHANGED', 'Bounded candidate payload and exact issuance must agree.');
    const parsed = JSON.parse(a.content), historical = validateWorkspaceInterchange(canonicalInterchangeJson(parsed.archive), p.pin.inventory);
    check(interchangeDigest({ content: a.content, pin: p.pin }) === binding.recordDigest
      && canonicalInterchangeJson(parsed) === a.content && interchangeDigest(parsed) === p.pin.candidateDigest
      && historical.digest === p.pin.packageDigest && parsed.packageDigest === historical.digest && same(historical.inventory, p.pin.inventory),
    'ACTIVATION_CANDIDATE_CHANGED', 'Complete candidate content differs from its independent issuance pin.');
    return { content: a.content, pin: structuredClone(p.pin), measurement: { encrypted: true,
      archiveCiphertextBytes: archive.diskBytes, inventoryPinCiphertextBytes: pin.diskBytes, qualification: binding.qualification } };
  }
  readCandidateHeld(context: Context, id: string) { return this.withCandidate(context, id, read => read()); }
  readCandidate(context: Context, id: string) {
    return this.#options.source.withSource(context, null, () => this.readCandidateHeld(context, id));
  }
  withCandidate<T>(context: Context, id: string, work: (read: () => Promise<AuthenticatedActivationCandidate>) => Promise<T>) {
    return this.#options.nativeSource.withSource(native => this.#lock(id, () => work(() => this.#read(context, id, native))));
  }
  async #create(context: Context, record: WorkspaceInterchangeCustodyRecord, guard: () => Promise<void>, qualification: CandidateBinding['qualification'], native: PostgresSourceCustodyLease) {
    const id = record.pin.recordId;
    check(record.pin.kind === 'candidate' && idPattern.test(id) && idPattern.test(record.pin.creationId)
      && record.pin.contextDigest === interchangeDigest(context) && Buffer.byteLength(record.content) <= this.#options.maxCandidateBytes,
    'ACTIVATION_CANDIDATE_CHANGED', 'Issue one complete bounded candidate for the exact current owner.');
    owner(this.#options.sourceVault, context); const { saved, ledger } = await this.#ledger();
    check(ledger.claims.length < 4096 && !ledger.claims.some(v => v.id === id || v.creationId === record.pin.creationId),
      'ACTIVATION_SINGLE_USE', 'Candidate IDs and creation instances remain consumed after every durable attempt.');
    await completed(guard);
    check(native.authority.vaultId === this.#options.sourceVault.vaultId && native.authority.revision === this.#options.sourceVault.read().revision,
      'ACTIVATION_POSTGRES_SOURCE_CHANGED', 'Issuance requires the exact currently held native source.');
    const claim: CandidateClaim = { id, creationId: record.pin.creationId, sourceVaultId: this.#options.sourceVault.vaultId, contextDigest: interchangeDigest(context),
      sourceStorageDigest: interchangeDigest(native.storage), sourceCreationId: native.authority.creationId,
      sourceAuthorityDigest: interchangeDigest(native.authority), recordDigest: interchangeDigest(record) };
    await this.#options.journalVault.writeArtifact({ id: 'wpg_candidate_ledger_v1', purpose, expectedDigest: saved?.valueDigest ?? null,
      value: { ...ledger, claims: [...ledger.claims, claim] } });
    let binding: CandidateBinding = { ...claim, format: 'chausar.activation-postgres-candidate-binding.v1', phase: 'preparing', qualification, archive: null, pin: null };
    const initial = await this.#options.journalVault.writeArtifact({ id: candidateId(id, 'binding'), purpose, expectedDigest: null, value: binding });
    const archive = await this.#options.journalVault.writeArtifact({ id: candidateId(id, 'archive'), purpose, expectedDigest: null,
      value: { format: 'chausar.activation-candidate-archive.v1', recordId: id, creationId: claim.creationId, content: record.content } });
    const pin = await this.#options.journalVault.writeArtifact({ id: candidateId(id, 'pin'), purpose, expectedDigest: null,
      value: { format: 'chausar.activation-candidate-pin.v1', recordId: id, pin: record.pin } });
    await completed(guard); binding = { ...binding, phase: 'committed', archive, pin };
    await this.#options.journalVault.writeArtifact({ id: initial.id, purpose, expectedDigest: initial.valueDigest, value: binding });
    return (await this.#read(context, id, native)).measurement;
  }
  backupActivationPorts(originals: WorkspacePostgresBackupActivationOriginals): WorkspaceBackupActivationPorts {
    return { custody: { read: (context, id) => this.readCandidate(context, id) },
      withTransaction: (context, selection, work) => originals.withTransaction(context, selection,
        lease => this.#options.nativeSource.withSource(native => this.withCandidate(context, selection.candidateId, read => work({ ...lease,
          createCandidate: async (record, guard) => {
            const backup = await lease.readBackup(), material = await lease.readMaterial();
            const qualification = [backup.measurement.qualification, material.measurement.qualification].includes('test-fixture') ? 'test-fixture' : 'encrypted-local-host';
            return this.#create(context, record, guard, qualification, native);
          }, readCandidate: read,
        })))),
    };
  }
}
