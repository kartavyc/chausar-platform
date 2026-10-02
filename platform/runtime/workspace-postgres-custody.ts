import { lstat, readdir } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { check, ChausarError } from './contracts.ts';
import { safeDirectory, type EncryptedSnapshotAdapter, type VaultEnvelope } from './vault.ts';
import { PostgresSnapshotAdapter, normalizePostgresEnvelope, postgresEnvelopeDigest,
  type PostgresSnapshotLease } from './postgres.ts';

export type PostgresAuthorityIdentity = { creationId: string; vaultId: string; revision: number; envelopeDigest: string };
export type PostgresStorageIdentity = {
  storageId: string; databaseOid: string; database: string; serverAddress: string; serverPort: number; slot: string;
};
export type PostgresPhysicalTarget = { directory: string; physical: { dev: string; ino: string; birthtimeNs: string } };
export type PostgresTargetReservation = {
  format: 'chausar.postgres-target-reservation.v1'; storage: PostgresStorageIdentity;
  operationId: string; creationId: string; target: PostgresPhysicalTarget;
};
export type PostgresPublicationProof = PostgresTargetReservation & { vaultId: string; revision: number; envelopeDigest: string };
export type PostgresSourceCustodyLease = {
  readonly storage: PostgresStorageIdentity; readonly authority: PostgresAuthorityIdentity;
  readonly lease: PostgresSnapshotLease; assertCurrent(): Promise<void>;
};
export type PostgresTargetInspection = {
  status: 'absent' | 'reserved' | 'prepared' | 'committed' | 'rolled-back' | 'unknown';
  reservation?: PostgresTargetReservation; proof?: PostgresPublicationProof;
  /** Original encrypted publication evidence, even after admitted target revision advances. */
  envelope?: VaultEnvelope; currentAuthority?: PostgresAuthorityIdentity; reasonCode?: string;
};
export type WorkspacePostgresCustodyOptions = { adapter: PostgresSnapshotAdapter; targetDirectory?: string };
type CustodyRow = { slot: string; operation_id: string; creation_id: string; storage_id: string;
  phase: 'reserved' | 'prepared' | 'committed' | 'rolled-back'; target_identity: unknown;
  vault_id: string | null; revision: string | number | null; envelope_digest: string | null; envelope: unknown };

const opaque = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
function exact(value: unknown, fields: string[]): asserts value is Record<string, any> {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
    && Reflect.ownKeys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field))
    && Object.values(Object.getOwnPropertyDescriptors(value)).every(field => field.enumerable && 'value' in field),
  'POSTGRES_CUSTODY_SHAPE', 'Use complete reviewed PostgreSQL custody identities.');
}
function canonical(value: any): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
function storedEnvelope(value: unknown): VaultEnvelope {
  try { return normalizePostgresEnvelope(typeof value === 'string' ? JSON.parse(value) : value); }
  catch { throw new ChausarError('CORRUPT_VAULT', 'The retained PostgreSQL encrypted envelope is inconsistent.'); }
}
function reservation(value: PostgresTargetReservation | PostgresPublicationProof): PostgresTargetReservation {
  const fields = ['format', 'storage', 'operationId', 'creationId', 'target'];
  const publication = Object.hasOwn(value ?? {}, 'envelopeDigest');
  exact(value, [...fields, ...(publication ? ['vaultId', 'revision', 'envelopeDigest'] : [])]);
  check(value.format === 'chausar.postgres-target-reservation.v1' && opaque(value.operationId) && opaque(value.creationId),
    'POSTGRES_CUSTODY_SHAPE', 'Use exact operation and creation identities.');
  exact(value.storage, ['storageId', 'databaseOid', 'database', 'serverAddress', 'serverPort', 'slot']);
  check(opaque(value.storage.storageId) && /^\d{1,30}$/.test(value.storage.databaseOid)
    && typeof value.storage.database === 'string' && value.storage.database.length > 0
    && ['127.0.0.1', '::1'].includes(value.storage.serverAddress)
    && Number.isInteger(value.storage.serverPort) && value.storage.serverPort >= 1024 && value.storage.serverPort <= 65535
    && /^[A-Za-z0-9_.-]{1,100}$/.test(value.storage.slot), 'POSTGRES_CUSTODY_SHAPE', 'Use actual installed loopback database custody.');
  exact(value.target, ['directory', 'physical']); exact(value.target.physical, ['dev', 'ino', 'birthtimeNs']);
  check(typeof value.target.directory === 'string' && isAbsolute(value.target.directory)
    && Object.values(value.target.physical).every(field => typeof field === 'string' && /^\d{1,30}$/.test(field)),
  'POSTGRES_CUSTODY_SHAPE', 'Use exact physical target generation.');
  if (publication) {
    const proof = value as PostgresPublicationProof;
    check(opaque(proof.vaultId) && proof.revision === 0 && digest(proof.envelopeDigest),
      'POSTGRES_CUSTODY_SHAPE', 'Publication must retain exact fresh encrypted authority.');
  }
  return structuredClone({ format: value.format, storage: value.storage, operationId: value.operationId,
    creationId: value.creationId, target: value.target });
}
function proofFor(value: PostgresTargetReservation, envelope: VaultEnvelope): PostgresPublicationProof {
  return { ...structuredClone(value), vaultId: envelope.id, revision: envelope.revision, envelopeDigest: postgresEnvelopeDigest(envelope) };
}

/** Native SQL custody only. Caller holds owner/readiness, Vault and filesystem exclusion.
 * SQL publication and filesystem evidence are separate durable boundaries. */
export class WorkspacePostgresCustody {
  readonly #adapter: PostgresSnapshotAdapter;
  readonly #directory?: string;
  constructor(options: WorkspacePostgresCustodyOptions) {
    check(options?.adapter instanceof PostgresSnapshotAdapter, 'POSTGRES_CUSTODY_REQUIRED', 'Supply the installed trusted PostgreSQL adapter.');
    if (options.targetDirectory !== undefined) check(typeof options.targetDirectory === 'string' && isAbsolute(options.targetDirectory),
      'POSTGRES_TARGET_REQUIRED', 'Supply one root-owned absolute target directory.');
    this.#adapter = options.adapter;
    this.#directory = options.targetDirectory === undefined ? undefined : resolve(options.targetDirectory);
  }
  async #storage(lease: PostgresSnapshotLease): Promise<PostgresStorageIdentity> {
    const result = await lease.query(`SELECT s.storage_id, current_database() AS database, d.oid::text AS database_oid,
      inet_server_addr()::text AS server_address, inet_server_port() AS server_port
      FROM public.chausar_workspace_postgres_storage s CROSS JOIN pg_database d
      WHERE s.id = 'current' AND d.datname = current_database()`);
    check(result.rows.length === 1, 'POSTGRES_STORAGE_CHANGED', 'The installed database generation is unavailable.');
    const row = result.rows[0], identity: PostgresStorageIdentity = { storageId: row.storage_id, databaseOid: String(row.database_oid),
      database: row.database, serverAddress: row.server_address, serverPort: Number(row.server_port), slot: lease.slot };
    check(opaque(identity.storageId) && /^\d{1,30}$/.test(identity.databaseOid) && typeof identity.database === 'string'
      && identity.database.length > 0 && ['127.0.0.1', '::1'].includes(identity.serverAddress)
      && Number.isInteger(identity.serverPort) && identity.serverPort >= 1024 && identity.serverPort <= 65535,
    'POSTGRES_STORAGE_CHANGED', 'The actual installed loopback database identity is inconsistent.');
    return identity;
  }
  storageIdentity(): Promise<PostgresStorageIdentity> { return this.#adapter.withLease(lease => this.#storage(lease)); }
  withSource<T>(work: (source: PostgresSourceCustodyLease) => Promise<T>): Promise<T> {
    return this.#adapter.withLease(async lease => {
      // Admission is distinct from raw row ownership used by target recovery below.
      await lease.load();
      const storage = await this.#storage(lease), authority = await lease.authority();
      check(authority, 'POSTGRES_SOURCE_REQUIRED', 'Capture requires an actual admitted PostgreSQL source authority.');
      const expectedStorage = structuredClone(storage), expectedAuthority = structuredClone(authority);
      const assertCurrent = async () => {
        check(same(await this.#storage(lease), expectedStorage), 'POSTGRES_STORAGE_CHANGED', 'The installed database generation changed.');
        await lease.assertCurrent(expectedAuthority);
      };
      const result = await work({ storage: Object.freeze(storage), authority: Object.freeze(authority), lease, assertCurrent });
      await assertCurrent(); return result;
    });
  }
  async #physical(empty = false): Promise<PostgresPhysicalTarget> {
    check(this.#directory, 'POSTGRES_TARGET_REQUIRED', 'Target custody requires its installed physical directory.');
    let directory: string;
    try { directory = await safeDirectory(this.#directory); }
    catch (error: any) {
      if (error.code === 'ENOENT') throw new ChausarError('POSTGRES_TARGET_CHANGED', 'The reserved physical target is missing.');
      throw error;
    }
    const before = await lstat(directory, { bigint: true });
    check(before.isDirectory() && !before.isSymbolicLink(), 'POSTGRES_TARGET_CHANGED', 'Target must remain a real physical directory.');
    if (empty) check((await readdir(directory)).length === 0, 'POSTGRES_TARGET_OCCUPIED', 'The physical target must actually be empty.');
    const after = await lstat(this.#directory, { bigint: true });
    check(after.isDirectory() && !after.isSymbolicLink() && before.dev === after.dev && before.ino === after.ino
      && before.birthtimeNs === after.birthtimeNs, 'POSTGRES_TARGET_CHANGED', 'The physical target generation changed during inspection.');
    return { directory, physical: { dev: String(before.dev), ino: String(before.ino), birthtimeNs: String(before.birthtimeNs) } };
  }
  async #row(lease: PostgresSnapshotLease): Promise<CustodyRow | null> {
    const result = await lease.query(`SELECT slot, operation_id, creation_id, storage_id, phase, target_identity,
      vault_id, revision, envelope_digest, envelope FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE`, [lease.slot]);
    check(result.rows.length <= 1, 'POSTGRES_CUSTODY_SHAPE', 'A slot has multiple custody identities.');
    return result.rows[0] ?? null;
  }
  async #rawAuthority(lease: PostgresSnapshotLease): Promise<{ envelope: VaultEnvelope; identity: PostgresAuthorityIdentity } | null> {
    const result = await lease.query('SELECT revision, envelope, creation_id FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE', [lease.slot]);
    if (!result.rows.length) return null;
    const row = result.rows[0], envelope = storedEnvelope(row.envelope);
    check(opaque(row.creation_id) && String(row.revision) === String(envelope.revision), 'CORRUPT_VAULT', 'Stored authority identity is inconsistent.');
    return { envelope, identity: { creationId: row.creation_id, vaultId: envelope.id,
      revision: envelope.revision, envelopeDigest: postgresEnvelopeDigest(envelope) } };
  }
  async #assert(lease: PostgresSnapshotLease, input: PostgresTargetReservation | PostgresPublicationProof, row: CustodyRow | null) {
    const expected = reservation(input), storage = await this.#storage(lease);
    check(same(storage, expected.storage) && same(await this.#physical(), expected.target),
      'POSTGRES_TARGET_CHANGED', 'Installed database or physical target generation differs from the reservation.');
    let target: unknown = row?.target_identity;
    if (typeof target === 'string') { try { target = JSON.parse(target); } catch { target = null; } }
    check(row && row.slot === storage.slot && row.operation_id === expected.operationId && row.creation_id === expected.creationId
      && row.storage_id === storage.storageId && same(target, expected.target)
      && ['reserved', 'prepared', 'committed', 'rolled-back'].includes(row.phase),
    'POSTGRES_TARGET_CHANGED', 'The target has no exact retained operation and creation ownership.');
    if (row.envelope !== null) {
      check(['prepared', 'committed', 'rolled-back'].includes(row.phase), 'POSTGRES_TARGET_CHANGED',
        'Reserved custody cannot already contain encrypted publication evidence.');
      const envelope = storedEnvelope(row.envelope);
      const proof = proofFor(expected, envelope);
      check(envelope.revision === 0 && row.vault_id === envelope.id && String(row.revision) === String(envelope.revision)
        && row.envelope_digest === proof.envelopeDigest && (!Object.hasOwn(input, 'envelopeDigest') || same(input, proof)),
      'POSTGRES_TARGET_CHANGED', 'The retained encrypted publication differs from its exact proof.');
      return { reservation: expected, proof, envelope };
    }
    check(row.vault_id === null && row.revision === null && row.envelope_digest === null
      && ['reserved', 'rolled-back'].includes(row.phase) && !Object.hasOwn(input, 'envelopeDigest'),
    'POSTGRES_TARGET_CHANGED', 'Prepared publication evidence is incomplete.');
    return { reservation: expected };
  }
  reserve(input: { operationId: string; creationId: string }): Promise<PostgresTargetReservation> {
    exact(input, ['operationId', 'creationId']);
    check(opaque(input.operationId) && opaque(input.creationId), 'POSTGRES_CUSTODY_SHAPE', 'Supply durable operation and creation IDs.');
    return this.#adapter.withLease(async lease => {
      check(!await this.#rawAuthority(lease) && !await this.#row(lease), 'POSTGRES_TARGET_OCCUPIED', 'Use a distinct absent, never reserved authority slot.');
      const storage = await this.#storage(lease), target = await this.#physical(true);
      const result: PostgresTargetReservation = { format: 'chausar.postgres-target-reservation.v1', storage,
        operationId: input.operationId, creationId: input.creationId, target };
      const inserted = await lease.query(`INSERT INTO public.chausar_workspace_postgres_custody
        (slot, operation_id, creation_id, storage_id, phase, target_identity) VALUES ($1, $2, $3, $4, 'reserved', $5::jsonb)`,
      [lease.slot, input.operationId, input.creationId, storage.storageId, JSON.stringify(target)]);
      check(inserted.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'The exact target reservation did not persist.');
      check(same(await this.#physical(true), target) && !await this.#rawAuthority(lease),
        'POSTGRES_TARGET_CHANGED', 'The physical or SQL target became occupied during reservation.');
      return result;
    });
  }
  prepare(input: { reservation: PostgresTargetReservation; envelope: VaultEnvelope }): Promise<PostgresPublicationProof> {
    exact(input, ['reservation', 'envelope']); const expected = reservation(input.reservation);
    const envelope = normalizePostgresEnvelope(input.envelope);
    check(envelope.revision === 0, 'POSTGRES_FRESH_AUTHORITY_REQUIRED', 'Prepare only a freshly bootstrapped target authority.');
    return this.#adapter.withLease(async lease => {
      const row = await this.#row(lease); await this.#assert(lease, expected, row);
      check(row!.phase === 'reserved' && !await this.#rawAuthority(lease), 'POSTGRES_PUBLICATION_REPLAY', 'Prepare a reserved absent target exactly once.');
      check(same(await this.#physical(true), expected.target), 'POSTGRES_TARGET_CHANGED', 'Prepare requires the still empty reserved physical target.');
      const proof = proofFor(expected, envelope);
      const result = await lease.query(`UPDATE public.chausar_workspace_postgres_custody SET phase = 'prepared',
        vault_id = $2, revision = $3, envelope_digest = $4, envelope = $5::jsonb, updated_at = CURRENT_TIMESTAMP
        WHERE slot = $1 AND operation_id = $6 AND creation_id = $7 AND phase = 'reserved'`,
      [lease.slot, proof.vaultId, proof.revision, proof.envelopeDigest, JSON.stringify(envelope), proof.operationId, proof.creationId]);
      check(result.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'Exact target preparation did not persist.');
      check(same(await this.#physical(true), expected.target), 'POSTGRES_TARGET_CHANGED', 'The reserved target changed during preparation.');
      return proof;
    });
  }
  /** Constructor-only bootstrap storage for a separate filesystem staging Vault.
   * It exposes prepared ciphertext to that bootstrap, never ordinary SQL authority.
   * Vault bootstrap failure cleanup gets exact-owned deletion instead of adapter.delete. */
  createPreparedAdapter(input: PostgresTargetReservation | PostgresPublicationProof): EncryptedSnapshotAdapter {
    let expected = structuredClone(input), submittedProof: PostgresPublicationProof | undefined, rolledBack = false; reservation(expected);
    return Object.freeze({
      kind: 'postgres' as const,
      load: () => this.#adapter.withLease(async lease => {
        const row = await this.#row(lease);
        const retained = await this.#assert(lease, row?.phase === 'prepared' && submittedProof ? submittedProof : expected, row);
        if (rolledBack && row!.phase === 'rolled-back' && !await this.#rawAuthority(lease)) return null;
        check(['reserved', 'prepared'].includes(row!.phase) && !await this.#rawAuthority(lease),
          'POSTGRES_TARGET_NOT_COMMITTED', 'Bootstrap storage only exposes its exact unpublished preparation.');
        // Vault bootstrap itself performs exact readback after acknowledgement loss.
        // Bind only the locally submitted proof, never arbitrary discovered ciphertext.
        if (row!.phase === 'prepared' && submittedProof) expected = structuredClone(submittedProof);
        return retained.envelope ?? null;
      }),
      commit: async (envelope: VaultEnvelope, expectedRevision: number | null) => {
        check(expectedRevision === null, 'POSTGRES_FRESH_AUTHORITY_REQUIRED', 'Staging bootstrap creates fresh authority exactly once.');
        submittedProof = proofFor(reservation(expected), normalizePostgresEnvelope(envelope));
        const proof = await this.prepare({ reservation: reservation(expected), envelope }); expected = proof;
      },
      delete: async () => {
        const proof = submittedProof ?? expected;
        await this.rollbackPrepared(proof); expected = structuredClone(proof); rolledBack = true;
      },
      deleteIfCurrent: async (expectedEnvelope: VaultEnvelope): Promise<'deleted' | 'absent' | 'mismatch'> => {
        check(!this.#adapter.hasActiveLease, 'POSTGRES_LEASE_ACTIVE',
          'Atomic bootstrap cleanup must own its target transaction through acknowledgement.');
        const envelope = normalizePostgresEnvelope(expectedEnvelope);
        const owner = structuredClone(submittedProof ?? expected);
        const original = Object.hasOwn(owner, 'envelopeDigest') ? owner as PostgresPublicationProof : undefined;
        if (original && (original.vaultId !== envelope.id || original.revision !== envelope.revision
          || original.envelopeDigest !== postgresEnvelopeDigest(envelope))) return 'mismatch';
        const outcome = await this.#adapter.withLease(async lease => {
          let mutationAttempted = false;
          try {
            const row = await this.#row(lease);
            // A prepared capability cannot delete or adopt an ordinary SQL occupant.
            if (await this.#rawAuthority(lease)) return 'mismatch' as const;
            if (!row) {
              check(same(await this.#storage(lease), owner.storage) && same(await this.#physical(), owner.target),
                'POSTGRES_TARGET_CHANGED', 'Missing preparation must still retain its installed target generation.');
              return 'absent' as const;
            }
            const retained = await this.#assert(lease, original ?? owner, row);
            if (row.phase === 'reserved') return 'absent' as const;
            if (!original || !retained.envelope || !same(envelope, retained.envelope)) return 'mismatch' as const;
            if (row.phase === 'rolled-back') return 'absent' as const;
            if (row.phase !== 'prepared') return 'mismatch' as const;
            mutationAttempted = true;
            const removed = await lease.query(`UPDATE public.chausar_workspace_postgres_custody
              SET phase = 'rolled-back', updated_at = CURRENT_TIMESTAMP
              WHERE slot = $1 AND operation_id = $2 AND creation_id = $3 AND storage_id = $4
                AND phase = 'prepared' AND vault_id = $5 AND revision = $6
                AND envelope_digest = $7 AND envelope = $8::jsonb
                AND NOT EXISTS (SELECT 1 FROM public.chausar_vault_authority WHERE slot = $1)`,
            [lease.slot, original.operationId, original.creationId, original.storage.storageId,
              original.vaultId, original.revision, original.envelopeDigest, JSON.stringify(envelope)]);
            if (removed.rowCount === 0) return 'mismatch' as const;
            check(removed.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'Prepared cleanup has no exact SQL mutation acknowledgement.');
            check(same(await this.#storage(lease), original.storage) && same(await this.#physical(), original.target),
              'POSTGRES_TARGET_CHANGED', 'Prepared cleanup lost its installed target generation before acknowledgement.');
            check(!await this.#rawAuthority(lease), 'POSTGRES_TARGET_CHANGED', 'Prepared cleanup acquired a competing SQL authority occupant.');
            return 'deleted' as const;
          } catch (error) {
            // A deterministic ownership refusal is a mismatch; SQL/transport errors
            // keep their uncertainty and cannot acknowledge deletion or safe absence.
            if (mutationAttempted || !(error instanceof ChausarError)) throw error;
            return 'mismatch' as const;
          }
        });
        if (outcome === 'deleted' || outcome === 'absent') {
          expected = owner; rolledBack = true;
        }
        return outcome;
      },
      close: async () => {},
    });
  }
  /** Root first durably authenticates filesystem publication, then publishes SQL.
   * A thrown COMMIT acknowledgement leaves possible commit for explicit inspection. */
  publish(input: PostgresPublicationProof): Promise<void> {
    const proof = structuredClone(input); reservation(proof);
    return this.#adapter.withLease(async lease => {
      const row = await this.#row(lease), retained = await this.#assert(lease, proof, row);
      check(row!.phase === 'prepared' && retained.envelope && !await this.#rawAuthority(lease),
        'POSTGRES_PUBLICATION_REPLAY', 'Publish the exact prepared absent SQL authority once.');
      const created = await lease.query(`INSERT INTO public.chausar_vault_authority (slot, revision, envelope, creation_id)
        VALUES ($1, $2, $3::jsonb, $4)`, [lease.slot, proof.revision, JSON.stringify(retained.envelope), proof.creationId]);
      check(created.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'The exact fresh authority was not inserted.');
      const result = await lease.query(`UPDATE public.chausar_workspace_postgres_custody SET phase = 'committed', updated_at = CURRENT_TIMESTAMP
        WHERE slot = $1 AND operation_id = $2 AND creation_id = $3 AND envelope_digest = $4 AND phase = 'prepared'`,
      [lease.slot, proof.operationId, proof.creationId, proof.envelopeDigest]);
      check(result.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'The exact authority publication binding did not commit.');
      check(same(await this.#physical(), proof.target), 'POSTGRES_TARGET_CHANGED', 'The physical target generation changed during SQL publication.');
    });
  }
  /** Read-only recovery. Unknown ownership never authorizes adoption, deletion or replay. */
  inspect(input: PostgresTargetReservation | PostgresPublicationProof): Promise<PostgresTargetInspection> {
    const expected = structuredClone(input); reservation(expected);
    return this.#adapter.withLease(async lease => {
      try {
        const storage = await this.#storage(lease), target = await this.#physical();
        check(same(storage, expected.storage) && same(target, expected.target), 'POSTGRES_TARGET_CHANGED', 'Target generation changed.');
        const row = await this.#row(lease), current = await this.#rawAuthority(lease);
        if (!row) return current ? { status: 'unknown', reasonCode: 'POSTGRES_TARGET_OCCUPIED' } : { status: 'absent' };
        const retained = await this.#assert(lease, expected, row);
        if (row.phase === 'committed') {
          check(current && retained.proof && current.identity.creationId === retained.proof.creationId
            && current.identity.vaultId === retained.proof.vaultId && current.identity.revision >= retained.proof.revision
            && (current.identity.revision !== retained.proof.revision || current.identity.envelopeDigest === retained.proof.envelopeDigest),
          'POSTGRES_TARGET_CHANGED', 'Committed authority is missing, replaced or changed without revision advancement.');
          return { status: 'committed', ...retained, currentAuthority: current.identity };
        }
        check(!current, 'POSTGRES_TARGET_OCCUPIED', 'An unpublished target acquired an authority occupant.');
        return { status: row.phase, ...retained };
      } catch (error) {
        // Database/transport failures propagate; only deterministic custody refusals classify here.
        if (!(error instanceof ChausarError)) throw error;
        return { status: 'unknown', reasonCode: error.code };
      }
    });
  }
  /** Explicit recovery when reservation COMMIT lost its acknowledgement before
   * returning the full proof. Root journals these IDs BEFORE reserve; installed
   * slot/database/directory and durable exact ownership are all compared here.
   * This only inspects; it never reserves again, publishes, deletes or adopts. */
  inspectOperation(input: { operationId: string; creationId: string }): Promise<PostgresTargetInspection> {
    exact(input, ['operationId', 'creationId']);
    check(opaque(input.operationId) && opaque(input.creationId), 'POSTGRES_CUSTODY_SHAPE', 'Supply the locally retained exact operation and creation IDs.');
    return this.#adapter.withLease(async lease => {
      const row = await this.#row(lease);
      if (!row) return await this.#rawAuthority(lease)
        ? { status: 'unknown', reasonCode: 'POSTGRES_TARGET_OCCUPIED' } : { status: 'absent' };
      if (row.operation_id !== input.operationId || row.creation_id !== input.creationId)
        return { status: 'unknown', reasonCode: 'POSTGRES_TARGET_CHANGED' };
      try {
        let target = row.target_identity;
        if (typeof target === 'string') { try { target = JSON.parse(target); } catch { target = null; } }
        const expected: PostgresTargetReservation = { format: 'chausar.postgres-target-reservation.v1',
          storage: await this.#storage(lease), operationId: input.operationId, creationId: input.creationId,
          target: target as PostgresPhysicalTarget };
        reservation(expected);
        return this.inspect(expected);
      } catch (error) {
        if (!(error instanceof ChausarError)) throw error;
        return { status: 'unknown', reasonCode: error.code };
      }
    });
  }
  rollbackPrepared(input: PostgresTargetReservation | PostgresPublicationProof): Promise<void> {
    const expected = structuredClone(input); reservation(expected);
    return this.#adapter.withLease(async lease => {
      const row = await this.#row(lease); await this.#assert(lease, expected, row);
      check(['reserved', 'prepared'].includes(row!.phase) && !await this.#rawAuthority(lease),
        'POSTGRES_ROLLBACK_REFUSED', 'Rollback requires exact unpublished custody and actual absent SQL authority.');
      check(row!.phase !== 'prepared' || Object.hasOwn(expected, 'envelopeDigest'), 'POSTGRES_ROLLBACK_REFUSED',
        'Prepared rollback must retain the original exact Vault, revision and encrypted-envelope digest.');
      const result = await lease.query(`UPDATE public.chausar_workspace_postgres_custody SET phase = 'rolled-back', updated_at = CURRENT_TIMESTAMP
        WHERE slot = $1 AND operation_id = $2 AND creation_id = $3 AND phase IN ('reserved', 'prepared')`,
      [lease.slot, expected.operationId, expected.creationId]);
      check(result.rowCount === 1, 'POSTGRES_TARGET_CHANGED', 'Exact unpublished rollback did not persist.');
    });
  }
  /** Explicit known-owned rollback only; NEVER a response to possible/lost-ack commit.
   * No filesystem removal, retry, replacement adoption or unconditional adapter.delete. */
  rollbackExactPublication(input: PostgresPublicationProof): Promise<void> {
    const proof = structuredClone(input); reservation(proof);
    return this.#adapter.withLease(async lease => {
      const row = await this.#row(lease), retained = await this.#assert(lease, proof, row), current = await this.#rawAuthority(lease);
      check(row!.phase === 'committed' && retained.envelope && current && current.identity.creationId === proof.creationId
        && current.identity.vaultId === proof.vaultId && current.identity.revision === proof.revision
        && current.identity.envelopeDigest === proof.envelopeDigest, 'POSTGRES_ROLLBACK_REFUSED',
      'Only the exact still untouched published authority may be explicitly rolled back.');
      const removed = await lease.query(`DELETE FROM public.chausar_vault_authority WHERE slot = $1 AND creation_id = $2
        AND revision = $3 AND envelope->>'id' = $4 AND envelope = $5::jsonb`,
      [lease.slot, proof.creationId, proof.revision, proof.vaultId, JSON.stringify(retained.envelope)]);
      check(removed.rowCount === 1, 'POSTGRES_ROLLBACK_REFUSED', 'The conditional authority removal found a changed occupant.');
      const result = await lease.query(`UPDATE public.chausar_workspace_postgres_custody SET phase = 'rolled-back', updated_at = CURRENT_TIMESTAMP
        WHERE slot = $1 AND operation_id = $2 AND creation_id = $3 AND envelope_digest = $4 AND phase = 'committed'`,
      [lease.slot, proof.operationId, proof.creationId, proof.envelopeDigest]);
      check(result.rowCount === 1, 'POSTGRES_ROLLBACK_REFUSED', 'The exact published rollback binding changed.');
    });
  }
}
