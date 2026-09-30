import { ChausarError } from './contracts.ts';
import type { EncryptedSnapshotAdapter, VaultEnvelope } from './vault.ts';

type Client = { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>; release(): void };
export type PostgresPool = { query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>; connect(): Promise<Client>; end(): Promise<void> };
export type PostgresOptions = { host: '127.0.0.1' | '::1'; port: number; user: string; database: string; password: string; vaultSlot: string; maxConnections?: number };
/** Durable production adapter. Only authenticated ciphertext enters PostgreSQL. */
export class PostgresSnapshotAdapter implements EncryptedSnapshotAdapter {
  readonly kind = 'postgres' as const;
  #pool: PostgresPool;
  #slot: string;
  #ownPool: boolean;
  private constructor(pool: PostgresPool, vaultSlot: string, ownPool: boolean) {
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(vaultSlot)) throw new ChausarError('INVALID_SLOT', 'Use a named vault storage slot.');
    this.#pool = pool; this.#slot = vaultSlot; this.#ownPool = ownPool;
  }
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
  private async initialize() {
    await this.#pool.query(`CREATE TABLE IF NOT EXISTS chausar_vault_authority (
      slot TEXT PRIMARY KEY, revision BIGINT NOT NULL CHECK (revision >= 0),
      envelope JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
  }
  async load(): Promise<VaultEnvelope | null> {
    const result = await this.#pool.query('SELECT revision, envelope FROM chausar_vault_authority WHERE slot = $1', [this.#slot]);
    if (!result.rows.length) return null;
    const row = result.rows[0], envelope = typeof row.envelope === 'string' ? JSON.parse(row.envelope) : row.envelope;
    if (Number(row.revision) !== envelope.revision) throw new ChausarError('CORRUPT_VAULT', 'The stored authority revision is inconsistent.');
    return envelope;
  }
  async commit(envelope: VaultEnvelope, expectedRevision: number | null): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      // Advisory lock also serializes creation of a slot whose row does not yet exist.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chausar-vault:${this.#slot}`]);
      const result = await client.query('SELECT revision FROM chausar_vault_authority WHERE slot = $1 FOR UPDATE', [this.#slot]);
      const current = result.rows.length ? Number(result.rows[0].revision) : null;
      if (current !== expectedRevision) throw new ChausarError('REVISION_CONFLICT', 'The workspace changed in another writer.');
      if (expectedRevision === null) await client.query('INSERT INTO chausar_vault_authority (slot, revision, envelope) VALUES ($1, $2, $3::jsonb)', [this.#slot, envelope.revision, JSON.stringify(envelope)]);
      else await client.query('UPDATE chausar_vault_authority SET revision = $2, envelope = $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE slot = $1 AND revision = $4', [this.#slot, envelope.revision, JSON.stringify(envelope), expectedRevision]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async delete(): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`chausar-vault:${this.#slot}`]);
      await client.query('DELETE FROM chausar_vault_authority WHERE slot = $1', [this.#slot]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async close() { if (this.#ownPool) await this.#pool.end(); }
}
