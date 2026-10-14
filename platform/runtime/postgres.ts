import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { ChausarError } from './contracts.ts';
import type { EncryptedSnapshotAdapter, VaultEnvelope } from './vault.ts';

export type PostgresQueryResult = { rows: any[]; rowCount?: number | null; command?: string };
export type PostgresClient = { query(sql: string, values?: unknown[]): Promise<PostgresQueryResult>; release(): void };
export type PostgresPool = { query(sql: string, values?: unknown[]): Promise<PostgresQueryResult>; connect(): Promise<PostgresClient>; end(): Promise<void> };
export type PostgresOptions = { host: '127.0.0.1' | '::1'; port: number; user: string; database: string; password: string; vaultSlot: string; maxConnections?: number };
/** Trusted enterprise-server host only: a database on another host, reached over verified TLS.
 * The certificate is checked against the pinned CA (PEM) and the server name; there is no plaintext or `prefer` fallback. */
export type PostgresRemoteTls = { ca: string; servername?: string };
export type PostgresRemoteOptions = Omit<PostgresOptions, 'host'> & { host: string; remoteTls: PostgresRemoteTls };
export type PostgresAuthority = { creationId: string; vaultId: string; revision: number; envelopeDigest: string };
/** Trusted constructor capability. The transaction and its locks outlive every awaited callback operation. */
export type PostgresSnapshotLease = {
  readonly slot: string; readonly active: boolean;
  query(sql: string, values?: unknown[]): Promise<PostgresQueryResult>;
  load(): Promise<VaultEnvelope | null>;
  commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void>;
  authority(): Promise<PostgresAuthority | null>;
  assertCurrent(expected: PostgresAuthority): Promise<void>;
};
function exactObjectFields(value: unknown, fields: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).length !== fields.length || !fields.every(field => Object.hasOwn(value, field))
    || Object.values(Object.getOwnPropertyDescriptors(value)).some(field => !field.enumerable || !('value' in field)))
    throw new ChausarError('CORRUPT_VAULT', 'The stored encrypted envelope shape is inconsistent.');
}
function orderedCiphertext(value: unknown): VaultEnvelope['snapshot'] {
  exactObjectFields(value, ['nonce', 'tag', 'data']);
  if (typeof value.nonce !== 'string' || typeof value.tag !== 'string' || typeof value.data !== 'string')
    throw new ChausarError('CORRUPT_VAULT', 'The stored ciphertext fields are inconsistent.');
  return { nonce: value.nonce, tag: value.tag, data: value.data };
}
function orderedWrapper(value: unknown): VaultEnvelope['passphrase'] {
  exactObjectFields(value, ['salt', 'kdf', 'ciphertext']);
  if (typeof value.salt !== 'string' || value.kdf !== 'scrypt-32768-8-1') throw new ChausarError('CORRUPT_VAULT', 'The stored key wrapper fields are inconsistent.');
  return { salt: value.salt, kdf: value.kdf, ciphertext: orderedCiphertext(value.ciphertext) };
}
/** JSONB changes insertion order. Reconstruct only the complete known v1 layout,
 * preserving every encrypted value and the existing wrapper AAD serialization.
 * This never decrypts, sorts, or rewrites State. Unknown fields fail closed. */
export function normalizePostgresEnvelope(value: unknown): VaultEnvelope {
  exactObjectFields(value, ['format', 'id', 'revision', 'passphrase', 'recovery', 'snapshot']);
  if (value.format !== 'chausar.vault.v1' || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0)
    throw new ChausarError('CORRUPT_VAULT', 'The stored encrypted envelope identity or revision is inconsistent.');
  return { format: value.format, id: value.id, revision: value.revision as number,
    passphrase: orderedWrapper(value.passphrase), recovery: orderedWrapper(value.recovery), snapshot: orderedCiphertext(value.snapshot) };
}
export function postgresEnvelopeDigest(envelope: VaultEnvelope): string {
  return createHash('sha256').update(JSON.stringify(normalizePostgresEnvelope(envelope))).digest('hex');
}
function validateRevision(envelope: VaultEnvelope, expectedRevision: number | null) {
  if (!envelope || !Number.isSafeInteger(envelope.revision) || envelope.revision < 0
    || (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || envelope.revision !== expectedRevision + 1)))
    throw new ChausarError('INVALID_REVISION', 'A replacement snapshot must advance its expected revision by exactly one.');
}
type CustodyOrigin = {
  operationId: string; creationId: string; storageId: string; vaultId: string; revision: number;
  envelopeDigest: string; targetJson: string;
};
type EnvelopeOrigin = { creationId: string; custody: CustodyOrigin | null | undefined };
function custodyOrigin(row: any): CustodyOrigin | undefined {
  try {
    if (!row || !['committed', 'rolled-back'].includes(row.phase)
      || !['operation_id', 'creation_id', 'storage_id', 'vault_id'].every(field => typeof row[field] === 'string' && row[field].length > 0)) return;
    const envelope = normalizePostgresEnvelope(typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope);
    const target = typeof row.target_identity === 'string' ? JSON.parse(row.target_identity) : row.target_identity;
    // Match the existing physical-target contract without importing its custody
    // manager (which depends on this adapter). Unknown proof grants no ownership.
    exactObjectFields(target, ['directory', 'physical']);
    exactObjectFields(target.physical, ['dev', 'ino', 'birthtimeNs']);
    if (typeof target.directory !== 'string' || !isAbsolute(target.directory)
      || !Object.values(target.physical).every(field => typeof field === 'string' && /^\d{1,30}$/.test(field))) return;
    if (envelope.revision !== 0 || row.vault_id !== envelope.id || String(row.revision) !== String(envelope.revision)
      || row.envelope_digest !== postgresEnvelopeDigest(envelope) || !target || typeof target !== 'object' || Array.isArray(target)) return;
    return { operationId: row.operation_id, creationId: row.creation_id, storageId: row.storage_id, vaultId: row.vault_id,
      revision: envelope.revision, envelopeDigest: row.envelope_digest, targetJson: JSON.stringify(target) };
  } catch { return; }
}
function sameCustodyOrigin(left: CustodyOrigin | undefined, right: CustodyOrigin): boolean {
  return !!left && left.operationId === right.operationId && left.creationId === right.creationId
    && left.storageId === right.storageId && left.vaultId === right.vaultId && left.revision === right.revision
    && left.envelopeDigest === right.envelopeDigest && left.targetJson === right.targetJson;
}
/** Durable production adapter. Only authenticated ciphertext enters PostgreSQL. */
export class PostgresSnapshotAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  #pool: PostgresPool;
  #slot: string;
  #ownPool: boolean;
  #leaseScope = new AsyncLocalStorage<PostgresSnapshotLease>();
  #slotCreationId?: string;
  #slotVaultId?: string;
  #slotStorageId?: string;
  #slotCustodyOrigin: CustodyOrigin | null | undefined;
  #envelopeOrigins = new Map<string, EnvelopeOrigin>();
  private constructor(pool: PostgresPool, vaultSlot: string, ownPool: boolean) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(vaultSlot)) throw new ChausarError('INVALID_SLOT', 'Use a named vault storage slot.');
    this.#pool = pool; this.#slot = vaultSlot; this.#ownPool = ownPool;
  }
  get slot(): string { return this.#slot; }
  get hasActiveLease(): boolean { return this.#leaseScope.getStore()?.active === true; }
  private static validateOptions(options: PostgresOptions) {
    if (!['127.0.0.1', '::1'].includes(options.host) || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || !options.user || !options.database || !options.password) throw new ChausarError('INVALID_POSTGRES_CONFIG', 'Provide explicit loopback database configuration and credentials.');
  }
  private static validateRemoteOptions(options: PostgresRemoteOptions) {
    const tls = options.remoteTls, pem = /^-----BEGIN CERTIFICATE-----\r?\n[A-Za-z0-9+/=\r\n]+-----END CERTIFICATE-----\s*/;
    const name = (value: unknown) => typeof value === 'string' && value.length <= 253 && /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/.test(value);
    if (!tls || typeof tls !== 'object' || typeof tls.ca !== 'string' || tls.ca.length > 256 * 1024 || !pem.test(tls.ca) || (tls.servername !== undefined && !name(tls.servername)))
      throw new ChausarError('POSTGRES_TLS_REQUIRED', 'A remote database needs verified TLS with a pinned certificate authority.');
    if (typeof options.host !== 'string' || !(name(options.host) || /^[0-9a-fA-F:.]{2,39}$/.test(options.host)) || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || !options.user || !options.database || !options.password) throw new ChausarError('INVALID_POSTGRES_CONFIG', 'Provide explicit database host, port and credentials.');
  }
  static async connect(options: PostgresOptions | PostgresRemoteOptions): Promise<PostgresSnapshotAdapter> {
    if ('remoteTls' in options) return PostgresSnapshotAdapter.connectRemote(options);
    PostgresSnapshotAdapter.validateOptions(options);
    const moduleName = 'pg'; const pg = await import(moduleName), Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password, max: options.maxConnections ?? 3, connectionTimeoutMillis: 5000, application_name: 'chausar-vault', ssl: false });
    try {
      const adapter = new PostgresSnapshotAdapter(pool, options.vaultSlot, true);
      await adapter.initialize(); return adapter;
    } catch (error) { await pool.end(); throw error; }
  }
  private static async connectRemote(options: PostgresRemoteOptions): Promise<PostgresSnapshotAdapter> {
    PostgresSnapshotAdapter.validateRemoteOptions(options);
    const ssl = { ca: options.remoteTls.ca, rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(options.remoteTls.servername ? { servername: options.remoteTls.servername } : {}) };
    const moduleName = 'pg'; const pg = await import(moduleName), Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password, max: options.maxConnections ?? 3, connectionTimeoutMillis: 5000, application_name: 'chausar-vault', ssl });
    try {
      const adapter = new PostgresSnapshotAdapter(pool, options.vaultSlot, true);
      await adapter.initialize(); return adapter;
    } catch (error) { await pool.end(); throw error; }
  }
  /** Dependency injection for a managed trusted pool and deterministic adapter tests. */
  static async fromPool(pool: PostgresPool, vaultSlot: string): Promise<PostgresSnapshotAdapter> {
    const adapter = new PostgresSnapshotAdapter(pool, vaultSlot, false); await adapter.initialize(); return adapter;
  }
  async #schemaState(connection: Pick<PostgresPool, 'query'>) {
    const result = await connection.query(`SELECT
      to_regclass('public.chausar_vault_authority') IS NOT NULL AS authority_table,
      to_regclass('public.chausar_workspace_postgres_storage') IS NOT NULL AS storage_table,
      to_regclass('public.chausar_workspace_postgres_custody') IS NOT NULL AS custody_table,
      EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.chausar_vault_authority')
        AND attname = 'creation_id' AND NOT attisdropped) AS creation_column`);
    const row = result.rows[0];
    return { authority: row?.authority_table === true, storage: row?.storage_table === true,
      custody: row?.custody_table === true, creation: row?.creation_column === true };
  }
  private async initialize() {
    const installed = (state: { authority: boolean; storage: boolean; custody: boolean; creation: boolean }) => state.authority && state.storage && state.custody && state.creation;
    if (installed(await this.#schemaState(this.#pool))) return;
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', ['chausar-postgres-schema-v1']);
      // Recheck after the schema lock: another initializer may have installed it.
      const state = await this.#schemaState(client);
      if (!state.authority) await client.query(`CREATE TABLE IF NOT EXISTS public.chausar_vault_authority (
        slot TEXT PRIMARY KEY, revision BIGINT NOT NULL CHECK (revision >= 0),
        envelope JSONB NOT NULL, creation_id TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      else if (!state.creation) await client.query('ALTER TABLE public.chausar_vault_authority ADD COLUMN IF NOT EXISTS creation_id TEXT NOT NULL DEFAULT gen_random_uuid()::text');
      if (!state.storage) await client.query(`CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_storage (
        id TEXT PRIMARY KEY CHECK (id = 'current'), storage_id TEXT NOT NULL
      )`);
      await client.query("INSERT INTO public.chausar_workspace_postgres_storage (id, storage_id) VALUES ('current', gen_random_uuid()::text) ON CONFLICT DO NOTHING");
      if (!state.custody) await client.query(`CREATE TABLE IF NOT EXISTS public.chausar_workspace_postgres_custody (
        slot TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, creation_id TEXT NOT NULL UNIQUE,
        storage_id TEXT NOT NULL, phase TEXT NOT NULL CHECK (phase IN ('reserved', 'prepared', 'committed', 'rolled-back')),
        target_identity JSONB NOT NULL, vault_id TEXT, revision BIGINT, envelope_digest TEXT, envelope JSONB,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async #authority(client: PostgresClient): Promise<{ creationId: string; envelope: VaultEnvelope } | null> {
    const result = await client.query('SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE', [this.#slot]);
    if (!result.rows.length) return null;
    const row = result.rows[0]; let envelope: VaultEnvelope;
    try { envelope = normalizePostgresEnvelope(typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope); }
    catch { throw new ChausarError('CORRUPT_VAULT', 'The stored encrypted envelope is inconsistent.'); }
    if (typeof row.creation_id !== 'string' || !row.creation_id.length || String(row.revision) !== String(envelope.revision))
      throw new ChausarError('CORRUPT_VAULT', 'The stored authority identity or revision is inconsistent.');
    return { creationId: row.creation_id, envelope };
  }
  async #admit(client: PostgresClient, current: { creationId: string; envelope: VaultEnvelope } | null, replacement?: VaultEnvelope) {
    const result = await client.query('SELECT phase, creation_id, vault_id, operation_id, storage_id, revision, envelope_digest, envelope, target_identity FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE', [this.#slot]);
    if (!result.rows.length) return null;
    const custody = result.rows[0];
    if (custody.phase !== 'committed' || !current || current.creationId !== custody.creation_id
      || current.envelope.id !== custody.vault_id || (replacement && replacement.id !== custody.vault_id))
      throw new ChausarError('POSTGRES_TARGET_NOT_COMMITTED', 'Ordinary authority access requires this exact committed target publication.');
    return custody;
  }
  async #storageGeneration(client: PostgresClient): Promise<string | null> {
    const result = await client.query("SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id = 'current' FOR SHARE");
    const storageId = result.rows[0]?.storage_id;
    return result.rows.length === 1 && typeof storageId === 'string' && storageId.length ? storageId : null;
  }
  #remember(current: { creationId: string; envelope: VaultEnvelope }, custody: any, storageId: string) {
    const origin = custody ? custodyOrigin(custody) : null;
    const custodyChanged = this.#slotCustodyOrigin === null ? origin !== null
      : this.#slotCustodyOrigin === undefined ? origin !== undefined
      : !sameCustodyOrigin(origin ?? undefined, this.#slotCustodyOrigin);
    if ((this.#slotCreationId !== undefined && current.creationId !== this.#slotCreationId)
      || (this.#slotVaultId !== undefined && current.envelope.id !== this.#slotVaultId)
      || (this.#slotCreationId !== undefined && custodyChanged))
      throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'This adapter retains a different PostgreSQL slot or Vault incarnation. Install a fresh adapter for a new generation.');
    if (custody && !origin)
      throw new ChausarError('POSTGRES_TARGET_NOT_COMMITTED', 'Ordinary authority access requires a complete original committed publication proof.');
    if (origin && origin.storageId !== storageId)
      throw new ChausarError('POSTGRES_STORAGE_CHANGED', 'The committed publication belongs to a different PostgreSQL database generation.');
    // Retain the original publication independently of current ciphertext and
    // digest-cache eviction. Admitted absence is also an immutable binding.
    if (this.#slotCreationId === undefined) this.#slotCustodyOrigin = origin;
    this.#slotCreationId ??= current.creationId;
    this.#slotVaultId ??= current.envelope.id;
    this.#slotStorageId ??= storageId;
    const digest = postgresEnvelopeDigest(current.envelope);
    // Never rebind identical ciphertext to a recreated occupant. Eviction remains
    // safe because the independent sticky slot incarnation is never replaced.
    if (!this.#envelopeOrigins.has(digest)) {
      this.#envelopeOrigins.set(digest, { creationId: current.creationId, custody: origin });
      if (this.#envelopeOrigins.size > 64) {
        const oldest = this.#envelopeOrigins.keys().next().value;
        if (oldest !== undefined) this.#envelopeOrigins.delete(oldest);
      }
    }
  }
  #requireDeletionOrigin() {
    if (this.#slotCreationId === undefined || this.#slotVaultId === undefined
      || this.#slotStorageId === undefined || this.#slotCustodyOrigin === undefined)
      throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'Deletion requires a previously admitted PostgreSQL workspace incarnation.');
  }
  /** Reentrant calls reuse the held client and transaction. When joining a Vault,
   * acquire Vault.snapshot before this SQL lease so queued writes cannot invert lock order. */
  async withLease<T>(work: (lease: PostgresSnapshotLease) => Promise<T>): Promise<T> {
    return this.#runLease(work);
  }
  async #runLease<T>(work: (lease: PostgresSnapshotLease) => Promise<T>, staleGeneration?: () => T): Promise<T> {
    const retained = this.#leaseScope.getStore();
    if (retained) {
      if (!retained.active) throw new ChausarError('POSTGRES_LEASE_INACTIVE', 'The PostgreSQL snapshot lease has been released.');
      return work(retained);
    }
    const client = await this.#pool.connect();
    let active = true, transactionFailed = false, storageId = '';
    const assertActive = () => { if (!active) throw new ChausarError('POSTGRES_LEASE_INACTIVE', 'The PostgreSQL snapshot lease has been released.'); };
    const transactionClient: PostgresClient = {
      async query(sql, values) {
        assertActive();
        try { return await client.query(sql, values); }
        catch (error) { transactionFailed = true; throw error; }
      }, release() { throw new ChausarError('POSTGRES_LEASE_TRANSACTION_CONTROL', 'The held snapshot lease owns its client.'); }
    };
    const guarded = async <T>(work: () => Promise<T>): Promise<T> => { assertActive(); const result = await work(); assertActive(); return result; };
    const authority = async (): Promise<PostgresAuthority | null> => {
      const current = await this.#authority(transactionClient);
      const custody = await this.#admit(transactionClient, current);
      if (current) this.#remember(current, custody, storageId);
      return current ? { creationId: current.creationId, vaultId: current.envelope.id, revision: current.envelope.revision,
        envelopeDigest: postgresEnvelopeDigest(current.envelope) } : null;
    };
    const lease: PostgresSnapshotLease = Object.freeze({
      slot: this.#slot, get active() { return active; },
      query: (sql: string, values?: unknown[]) => guarded(async () => {
        // Only this adapter owns transaction boundaries. Constructor callers may issue ordinary SQL.
        const controls = sql.replace(/'([^']|'')*'|"([^"]|"")*"|--[^\r\n]*|\/\*[\s\S]*?\*\//g, ' ');
        if (/(?:^|;)\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|END|ROLLBACK|ABORT|PREPARE\s+TRANSACTION)\b/i.test(controls))
          throw new ChausarError('POSTGRES_LEASE_TRANSACTION_CONTROL', 'The held snapshot lease owns its transaction boundaries.');
        return transactionClient.query(sql, values);
      }),
      load: () => guarded(async () => {
        const current = await this.#authority(transactionClient), custody = await this.#admit(transactionClient, current);
        if (current) this.#remember(current, custody, storageId);
        return current?.envelope ?? null;
      }),
      commit: (envelope: VaultEnvelope, expectedRevision: number | null) => guarded(async () => {
        validateRevision(envelope, expectedRevision);
        const normalized = normalizePostgresEnvelope(envelope), current = await this.#authority(transactionClient);
        const custody = await this.#admit(transactionClient, current, normalized);
        if ((this.#slotCreationId !== undefined && current?.creationId !== this.#slotCreationId)
          || (this.#slotVaultId !== undefined && current?.envelope.id !== this.#slotVaultId))
          throw new ChausarError('REVISION_CONFLICT', 'The retained PostgreSQL slot or Vault incarnation is absent or replaced.');
        if (current && normalized.id !== current.envelope.id)
          throw new ChausarError('REVISION_CONFLICT', 'A replacement snapshot cannot replace its existing Vault identity.');
        if (current) this.#remember(current, custody, storageId);
        if ((current?.envelope.revision ?? null) !== expectedRevision) throw new ChausarError('REVISION_CONFLICT', 'The workspace changed in another writer.');
        if (expectedRevision === null) await transactionClient.query('INSERT INTO public.chausar_vault_authority (slot, revision, envelope) VALUES ($1, $2, $3::jsonb)', [this.#slot, normalized.revision, JSON.stringify(normalized)]);
        else {
          const result = await transactionClient.query(`UPDATE public.chausar_vault_authority SET revision = $2, envelope = $3::jsonb, updated_at = CURRENT_TIMESTAMP
            WHERE slot = $1 AND revision = $4 AND creation_id = $5 AND envelope->>'id' = $6 AND envelope = $7::jsonb`,
          [this.#slot, normalized.revision, JSON.stringify(normalized), expectedRevision, current!.creationId, current!.envelope.id, JSON.stringify(current!.envelope)]);
          if (result.rowCount !== undefined && result.rowCount !== 1) throw new ChausarError('REVISION_CONFLICT', 'The workspace changed in another writer.');
        }
        const readback = await this.#authority(transactionClient), readbackCustody = await this.#admit(transactionClient, readback, normalized);
        if (!readback || JSON.stringify(readback.envelope) !== JSON.stringify(normalized))
          throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'The proposed encrypted authority did not read back exactly.');
        // Retain creation ownership before COMMIT: acknowledgement loss must not
        // cause later cleanup to learn a replacement occupant's generation.
        this.#remember(readback, readbackCustody, storageId);
      }),
      authority: () => guarded(authority),
      assertCurrent: (expected: PostgresAuthority) => guarded(async () => {
        const actual = await authority();
        if (!expected || !actual || actual.creationId !== expected.creationId || actual.vaultId !== expected.vaultId
          || actual.revision !== expected.revision || actual.envelopeDigest !== expected.envelopeDigest)
          throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'The retained PostgreSQL authority has changed.');
      })
    });
    try {
      await client.query('BEGIN');
      // Advisory lock also serializes creation of a slot whose row does not yet exist.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chausar-vault:${this.#slot}`]);
      // SHARE blocks an independent non-key generation UPDATE through COMMIT.
      // Acquire it before the authority and custody locks in every outer lease.
      const observedStorageId = await this.#storageGeneration(client);
      const generationCurrent = observedStorageId !== null
        && (this.#slotStorageId === undefined || observedStorageId === this.#slotStorageId);
      if (!generationCurrent && !staleGeneration)
        throw new ChausarError('POSTGRES_STORAGE_CHANGED', 'The admitted PostgreSQL database generation is absent or replaced.');
      storageId = observedStorageId ?? '';
      if (generationCurrent)
        await client.query('SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE', [this.#slot]);
      // Exact cleanup may return a logical mismatch without running its callback.
      // Both outcomes still use the ordinary COMMIT acknowledgement checks.
      const result = generationCurrent ? await this.#leaseScope.run(lease, () => work(lease)) : staleGeneration!();
      active = false;
      if (transactionFailed) throw new ChausarError('POSTGRES_TRANSACTION_ABORTED', 'A failed SQL operation prevents this snapshot transaction from committing.');
      const committed = await client.query('COMMIT');
      if (committed.command !== undefined && committed.command !== 'COMMIT')
        throw new ChausarError('POSTGRES_TRANSACTION_ABORTED', 'PostgreSQL did not commit this snapshot transaction.');
      return result;
    } catch (error) { active = false; await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { active = false; client.release(); }
  }
  async load(): Promise<VaultEnvelope | null> { return this.withLease(lease => lease.load()); }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void> {
    validateRevision(envelope, expectedRevision);
    return this.withLease(lease => lease.commit(envelope, expectedRevision));
  }
  async withDeletionAdmission<T>(expectedEnvelope: VaultEnvelope, work: () => Promise<T>): Promise<T> {
    this.#requireDeletionOrigin();
    const expected = JSON.stringify(normalizePostgresEnvelope(expectedEnvelope));
    return this.withLease(async lease => {
      const current = await lease.load();
      if (!current || JSON.stringify(current) !== expected)
        throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'The retained encrypted Vault authority changed before deletion.');
      return work();
    });
  }
  /** Atomic exact-owned bootstrap cleanup. Reads here never establish ownership;
   * only a previously admitted observation or our own mutation can do that.
   * Cleanup owns its outer transaction: call it outside an already-held target lease. */
  async deleteIfCurrent(expectedEnvelope: VaultEnvelope): Promise<'deleted' | 'absent' | 'mismatch'> {
    if (this.hasActiveLease) throw new ChausarError('POSTGRES_LEASE_ACTIVE', 'Exact cleanup must own its outer PostgreSQL transaction.');
    const expected = normalizePostgresEnvelope(expectedEnvelope), expectedJson = JSON.stringify(expected);
    const expectedDigest = postgresEnvelopeDigest(expected), origin = this.#envelopeOrigins.get(expectedDigest);
    return this.#runLease<'deleted' | 'absent' | 'mismatch'>(async lease => {
      const authority = await lease.query('SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE', [this.#slot]);
      const custodyResult = await lease.query('SELECT phase, creation_id, vault_id, operation_id, storage_id, revision, envelope_digest, envelope, target_identity FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE', [this.#slot]);
      const current = authority.rows[0], custody = custodyResult.rows[0];
      if (!current) {
        if (!custody) return 'absent';
        return custody.phase === 'rolled-back' && origin?.custody
          && sameCustodyOrigin(custodyOrigin(custody), origin.custody) && origin.custody.envelopeDigest === expectedDigest
          && origin.custody.revision === expected.revision && origin.custody.vaultId === expected.id
          && origin.creationId === this.#slotCreationId ? 'absent' : 'mismatch';
      }
      if (!origin || origin.creationId !== this.#slotCreationId || current.creation_id !== origin.creationId
        || String(current.revision) !== String(expected.revision)) return 'mismatch';
      let actual: VaultEnvelope;
      try { actual = normalizePostgresEnvelope(typeof current.envelope === 'string' ? JSON.parse(current.envelope) : current.envelope); }
      catch { return 'mismatch'; }
      if (actual.id !== expected.id || JSON.stringify(actual) !== expectedJson) return 'mismatch';
      if (origin.custody === undefined || (origin.custody === null && custody)) return 'mismatch';
      if (origin.custody && (!custody || custody.phase !== 'committed'
        || !sameCustodyOrigin(custodyOrigin(custody), origin.custody) || origin.custody.envelopeDigest !== expectedDigest
        || origin.custody.revision !== expected.revision || origin.custody.vaultId !== expected.id
        || origin.custody.creationId !== origin.creationId)) return 'mismatch';
      const binding = origin.custody;
      const predicate = binding ? `AND EXISTS (SELECT 1 FROM public.chausar_workspace_postgres_custody
          WHERE slot = $1 AND operation_id = $6 AND creation_id = $2 AND storage_id = $7 AND phase = 'committed'
          AND vault_id = $4 AND revision = $3 AND envelope_digest = $8 AND envelope = $5::jsonb AND target_identity = $9::jsonb)`
        : 'AND NOT EXISTS (SELECT 1 FROM public.chausar_workspace_postgres_custody WHERE slot = $1)';
      const values: unknown[] = [lease.slot, origin.creationId, expected.revision, expected.id, expectedJson];
      if (binding) values.push(binding.operationId, binding.storageId, binding.envelopeDigest, binding.targetJson);
      const removed = await lease.query(`DELETE FROM public.chausar_vault_authority WHERE slot = $1 AND creation_id = $2
        AND revision = $3 AND envelope->>'id' = $4 AND envelope = $5::jsonb ${predicate}`, values);
      if (removed.rowCount === 0) return 'mismatch';
      if (removed.rowCount !== 1)
        throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'Conditional deletion was not exactly acknowledged; its transaction must roll back.');
      if (origin.custody) {
        const binding = origin.custody, tombstone = await lease.query(`UPDATE public.chausar_workspace_postgres_custody SET phase = 'rolled-back', updated_at = CURRENT_TIMESTAMP
          WHERE slot = $1 AND operation_id = $2 AND creation_id = $3 AND storage_id = $4 AND phase = 'committed'
          AND vault_id = $5 AND revision = $6 AND envelope_digest = $7 AND envelope = $8::jsonb AND target_identity = $9::jsonb`,
        [lease.slot, binding.operationId, binding.creationId, binding.storageId, binding.vaultId, binding.revision,
          binding.envelopeDigest, expectedJson, binding.targetJson]);
        if (tombstone.rowCount !== 1)
          throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'Exact cleanup custody changed; the deletion transaction must roll back.');
      }
      return 'deleted';
    }, () => 'mismatch');
  }
  /** Legacy workspace deletion. Activation cleanup must use an exact-owned custody capability instead. */
  async delete(): Promise<void> {
    this.#requireDeletionOrigin();
    await this.withLease(async lease => {
      if (!await lease.load())
        throw new ChausarError('POSTGRES_AUTHORITY_CHANGED', 'The previously admitted PostgreSQL workspace is absent.');
      await lease.query('DELETE FROM public.chausar_vault_authority WHERE slot = $1', [this.#slot]);
    });
  }
  async close() {
    const retained = this.#leaseScope.getStore();
    if (retained) throw new ChausarError(retained.active ? 'POSTGRES_LEASE_ACTIVE' : 'POSTGRES_LEASE_INACTIVE', 'Close PostgreSQL storage outside its snapshot lease.');
    if (this.#ownPool) await this.#pool.end();
  }
}
