import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { HostedError } from '../shared/errors.ts';

export type Row = Record<string, any>;
/** The one database port every hosted service uses. Production wires `pg`; tests use a disposable PostgreSQL. */
export interface Sql {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
  /** Runs `work` in one transaction. Nested calls reuse the outer transaction. */
  transaction<T>(work: (sql: Sql) => Promise<T>): Promise<T>;
}
type PgClient = { query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>; release?(): void };
type PgPool = PgClient & { connect(): Promise<PgClient & { release(): void }>; end(): Promise<void> };

function bound(client: PgClient, inTransaction: boolean): Sql {
  const sql: Sql = {
    async query(text, params = []) { const result = await client.query(text, [...params]); return { rows: result.rows, rowCount: result.rowCount ?? 0 }; },
    async transaction(work) { if (inTransaction) return work(sql); throw new HostedError('SERVER_ERROR', 'Transactions need a pool.', 500); },
  };
  return sql;
}
export function pgSql(pool: PgPool): Sql & { end(): Promise<void> } {
  return {
    async query(text, params = []) { const result = await pool.query(text, [...params]); return { rows: result.rows, rowCount: result.rowCount ?? 0 }; },
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await work(bound(client, true));
        await client.query('COMMIT'); return result;
      } catch (error) { try { await client.query('ROLLBACK'); } catch { /* the connection is discarded below */ } throw error; }
      finally { client.release(); }
    },
    end: () => pool.end(),
  };
}
export async function connect(url: string, max = 10): Promise<Sql & { end(): Promise<void> }> {
  const { default: pg } = await import('pg');
  return pgSql(new pg.Pool({ connectionString: url, max, application_name: 'chausar-hosted' }) as unknown as PgPool);
}

/** Applies `migrations/*.sql` in name order, once each, under an advisory lock. A changed applied file is refused. */
export async function migrate(sql: Sql, directory = new URL('./migrations/', import.meta.url)): Promise<string[]> {
  const names = (await readdir(directory)).filter(name => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return sql.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock(7316220241)');
    await tx.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const applied = new Map((await tx.query<{ name: string; digest: string }>('SELECT name, digest FROM schema_migrations')).rows.map(r => [r.name, r.digest]));
    const done: string[] = [];
    for (const name of names) {
      const text = await readFile(new URL(name, directory), 'utf8');
      const digest = createHash('sha256').update(text).digest('hex');
      if (applied.has(name)) { if (applied.get(name) !== digest) throw new HostedError('MIGRATION_CHANGED', 'An applied migration was edited. Add a new migration instead.', 500); continue; }
      await tx.query(text);
      await tx.query('INSERT INTO schema_migrations (name, digest) VALUES ($1, $2)', [name, digest]);
      done.push(name);
    }
    return done;
  });
}
