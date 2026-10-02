import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { ChausarError } from './contracts.ts';
import type { EncryptedSnapshotAdapter, VaultEnvelope } from './vault.ts';

export type PostgresQueryResult = { rows: any[]; rowCount?: number | null; command?: string };
export type PostgresClient = { query(sql: string, values?: unknown[]): Promise<PostgresQueryResult>; release(): void };
export type PostgresPool = { query(sql: string, values?: unknown[]): Promise<PostgresQueryResult>; connect(): Promise<PostgresClient>; end(): Promise<void> };
export type PostgresOptions = { host: '127.0.0.1' | '::1'; port: number; user: string; database: string; password: string; vaultSlot: string; maxConnections?: number };
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
/** Durable production adapter. Only authenticated ciphertext enters PostgreSQL. */
export class PostgresSnapshotAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  #pool: PostgresPool;
  #slot: string;
  #ownPool: boolean;
  #leaseScope = new AsyncLocalStorage<PostgresSnapshotLease>();
  private constructor(pool: PostgresPool, vaultSlot: string, ownPool: boolean) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(vaultSlot)) throw new ChausarError('INVALID_SLOT', 'Use a named vault storage slot.');
    this.#pool = pool; this.#slot = vaultSlot; this.#ownPool = ownPool;
  }
  get slot(): string { return this.#slot; }
  private static validateOptions(options: PostgresOptions) {
    if (!['127.0.0.1', '::1'].includes(options.host) || !Number.isInteger(options.port) || options.port < 1024 || options.port > 65535 || !options.user || !options.database || !options.password) throw new ChausarError('INVALID_POSTGRES_CONFIG', 'Provide explicit loopback database configuration and credentials.');
  }
  static async connect(options: PostgresOptions): Promise<PostgresSnapshotAdapter> {
    PostgresSnapshotAdapter.validateOptions(options);
    const moduleName = 'pg'; const pg = await import(moduleName), Pool = pg.Pool ?? pg.default?.Pool;
    const pool = new Pool({ host: options.host, port: options.port, user: options.user, database: options.database, password: options.password, max: options.maxConnections ?? 3, connectionTimeoutMillis: 5000, application_name: 'chausar-vault', ssl: false });
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
    const result = await client.query('SELECT phase, creation_id, vault_id FROM public.chausar_workspace_postgres_custody WHERE slot = $1 FOR UPDATE', [this.#slot]);
    if (!result.rows.length) return;
    const custody = result.rows[0];
    if (custody.phase !== 'committed' || !current || current.creationId !== custody.creation_id
      || current.envelope.id !== custody.vault_id || (replacement && replacement.id !== custody.vault_id))
      throw new ChausarError('POSTGRES_TARGET_NOT_COMMITTED', 'Ordinary authority access requires this exact committed target publication.');
  }
  /** Reentrant calls reuse the held client and transaction. When joining a Vault,
   * acquire Vault.snapshot before this SQL lease so queued writes cannot invert lock order. */
  async withLease<T>(work: (lease: PostgresSnapshotLease) => Promise<T>): Promise<T> {
    const retained = this.#leaseScope.getStore();
    if (retained) {
      if (!retained.active) throw new ChausarError('POSTGRES_LEASE_INACTIVE', 'The PostgreSQL snapshot lease has been released.');
      return work(retained);
    }
    const client = await this.#pool.connect();
    let active = true, transactionFailed = false;
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
      await this.#admit(transactionClient, current);
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
      load: () => guarded(async () => { const current = await this.#authority(transactionClient); await this.#admit(transactionClient, current); return current?.envelope ?? null; }),
      commit: (envelope: VaultEnvelope, expectedRevision: number | null) => guarded(async () => {
        validateRevision(envelope, expectedRevision);
        const normalized = normalizePostgresEnvelope(envelope), current = await this.#authority(transactionClient);
        await this.#admit(transactionClient, current, normalized);
        if ((current?.envelope.revision ?? null) !== expectedRevision) throw new ChausarError('REVISION_CONFLICT', 'The workspace changed in another writer.');
        if (expectedRevision === null) await transactionClient.query('INSERT INTO public.chausar_vault_authority (slot, revision, envelope) VALUES ($1, $2, $3::jsonb)', [this.#slot, normalized.revision, JSON.stringify(normalized)]);
        else {
          const result = await transactionClient.query('UPDATE public.chausar_vault_authority SET revision = $2, envelope = $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE slot = $1 AND revision = $4', [this.#slot, normalized.revision, JSON.stringify(normalized), expectedRevision]);
          if (result.rowCount !== undefined && result.rowCount !== 1) throw new ChausarError('REVISION_CONFLICT', 'The workspace changed in another writer.');
        }
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
      await client.query('SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE', [this.#slot]);
      const result = await this.#leaseScope.run(lease, () => work(lease));
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
  /** Legacy workspace deletion. Activation cleanup must use an exact-owned custody capability instead. */
  async delete(): Promise<void> {
    await this.withLease(async lease => { await lease.query('DELETE FROM public.chausar_vault_authority WHERE slot = $1', [this.#slot]); });
  }
  async close() {
    const retained = this.#leaseScope.getStore();
    if (retained) throw new ChausarError(retained.active ? 'POSTGRES_LEASE_ACTIVE' : 'POSTGRES_LEASE_INACTIVE', 'Close PostgreSQL storage outside its snapshot lease.');
    if (this.#ownPool) await this.#pool.end();
  }
}
