// Hosted tier: an in-memory stand-in for the PostgreSQL the hosted server talks to. It answers only the exact statements
// the sealed directory and the vault adapter send, with the same rules a real server applies to them: compare-and-set
// updates, a unique slot per row, advisory locks held until commit, BIGINT revisions read back as text and JSONB that
// reorders object keys. It is a protocol fixture, never evidence about PostgreSQL itself. The tests that need a real
// server run only when CHAUSAR_TEST_POSTGRES_URL is set.
import { DIRECTORY_SQL } from '../runtime/hosted/directory.ts';
import { VAULT_TABLE_SQL, type PostgresPool } from '../runtime/postgres.ts';

// The vault adapter's statements (platform/runtime/postgres.ts). Its advisory lock is the same statement as the directory's.
const VAULT_SQL = Object.freeze({
  load: 'SELECT revision, envelope FROM public.chausar_vault_authority WHERE slot = $1',
  current: 'SELECT revision FROM public.chausar_vault_authority WHERE slot = $1 FOR UPDATE',
  insert: 'INSERT INTO public.chausar_vault_authority (slot, revision, envelope) VALUES ($1, $2, $3::jsonb)',
  update: 'UPDATE public.chausar_vault_authority SET revision = $2, envelope = $3::jsonb, updated_at = CURRENT_TIMESTAMP WHERE slot = $1 AND revision = $4',
  delete: 'DELETE FROM public.chausar_vault_authority WHERE slot = $1',
});

/** PostgreSQL JSONB keeps keys shorter-first, then in byte order, not in insertion order. */
export function jsonbOrder(value: any): any {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, child]) => [key, jsonbOrder(child)]));
  return value;
}

type Result = { rows: any[]; rowCount: number };

export type PostgresStandIn = {
  pool: PostgresPool;
  directoryRows: Map<string, { revision: number; sealed: string }>;
  vaultRows: Map<string, { revision: number; envelope: any }>;
  /** Runs before each statement. Tests use it to let another server write in between. */
  before: ((sql: string, values: unknown[]) => Promise<void> | void) | null;
  /** While set, every statement fails with it, like a database that went away. */
  failWith: Error | null;
  /** Compare-and-set writes that found another revision. */
  conflicts: number;
  ended: boolean;
};

export function createPostgresStandIn(): PostgresStandIn {
  const locks = new Map<string, Promise<void>>();
  const standIn: PostgresStandIn = {
    pool: null as unknown as PostgresPool,
    directoryRows: new Map(), vaultRows: new Map(), before: null, failWith: null, conflicts: 0, ended: false,
  };

  /** Waits for the key's lock and returns its release, like pg_advisory_xact_lock until COMMIT or ROLLBACK. */
  const lock = async (key: string): Promise<() => void> => {
    while (locks.has(key)) await locks.get(key);
    let release!: () => void;
    locks.set(key, new Promise<void>(resolve => { release = () => { locks.delete(key); resolve(); }; }));
    return release;
  };

  const run = async (sql: string, values: unknown[] = [], held?: (release: () => void) => void): Promise<Result> => {
    if (standIn.ended) throw new Error('Cannot use a pool after calling end on the pool');
    await standIn.before?.(sql, values);
    if (standIn.failWith) throw standIn.failWith;
    const slot = String(values[0]);
    switch (sql) {
      case 'BEGIN': case 'COMMIT': case 'ROLLBACK': case DIRECTORY_SQL.table: case VAULT_TABLE_SQL: return { rows: [], rowCount: 0 };
      case DIRECTORY_SQL.schemaLock: {
        const release = await lock(slot);
        if (held) held(release); else release();
        return { rows: [{}], rowCount: 1 };
      }
      case DIRECTORY_SQL.load: {
        const row = standIn.directoryRows.get(slot);
        return row ? { rows: [{ revision: String(row.revision), sealed: row.sealed }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      case DIRECTORY_SQL.revision: {
        const row = standIn.directoryRows.get(slot);
        return row ? { rows: [{ revision: String(row.revision) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      case DIRECTORY_SQL.insert: {
        if (standIn.directoryRows.has(slot)) { standIn.conflicts++; return { rows: [], rowCount: 0 }; }
        standIn.directoryRows.set(slot, { revision: Number(values[1]), sealed: String(values[2]) });
        return { rows: [], rowCount: 1 };
      }
      case DIRECTORY_SQL.swap: {
        const row = standIn.directoryRows.get(slot);
        if (!row || row.revision !== Number(values[3])) { standIn.conflicts++; return { rows: [], rowCount: 0 }; }
        standIn.directoryRows.set(slot, { revision: Number(values[1]), sealed: String(values[2]) });
        return { rows: [], rowCount: 1 };
      }
      case VAULT_SQL.load: {
        const row = standIn.vaultRows.get(slot);
        return row ? { rows: [{ revision: String(row.revision), envelope: jsonbOrder(structuredClone(row.envelope)) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      case VAULT_SQL.current: {
        const row = standIn.vaultRows.get(slot);
        return row ? { rows: [{ revision: String(row.revision) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      case VAULT_SQL.insert: {
        if (standIn.vaultRows.has(slot)) throw Object.assign(new Error('duplicate key value violates unique constraint "chausar_vault_authority_pkey"'), { code: '23505' });
        standIn.vaultRows.set(slot, { revision: Number(values[1]), envelope: JSON.parse(String(values[2])) });
        return { rows: [], rowCount: 1 };
      }
      case VAULT_SQL.update: {
        const row = standIn.vaultRows.get(slot);
        if (!row || row.revision !== Number(values[3])) { standIn.conflicts++; return { rows: [], rowCount: 0 }; }
        standIn.vaultRows.set(slot, { revision: Number(values[1]), envelope: JSON.parse(String(values[2])) });
        return { rows: [], rowCount: 1 };
      }
      case VAULT_SQL.delete: return { rows: [], rowCount: standIn.vaultRows.delete(slot) ? 1 : 0 };
      default: throw new Error(`The PostgreSQL stand-in does not know this statement: ${sql.slice(0, 80)}`);
    }
  };

  standIn.pool = {
    query: (sql, values) => run(sql, values),
    async connect() {
      if (standIn.ended) throw new Error('Cannot use a pool after calling end on the pool');
      const releases: (() => void)[] = [];
      const releaseAll = () => { for (const release of releases.splice(0)) release(); };
      return {
        async query(sql: string, values?: unknown[]) {
          const result = await run(sql, values, release => releases.push(release));
          if (sql === 'COMMIT' || sql === 'ROLLBACK') releaseAll();
          return result;
        },
        release: releaseAll,
      };
    },
    async end() { standIn.ended = true; },
  };
  return standIn;
}
