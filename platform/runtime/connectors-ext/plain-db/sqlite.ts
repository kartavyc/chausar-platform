import { lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { check, ChausarError } from '../../contracts.ts';
import { CATALOGUE_LIMIT } from './sql.ts';
import type { PlainDbRow, SnapshotSession, SqliteConnectionConfig } from './types.ts';

export function validateSqliteConnection(input: unknown): SqliteConnectionConfig {
  check(input !== null && typeof input === 'object' && !Array.isArray(input), 'DB_CONNECTION_INVALID', 'A SQLite connection names one database file.');
  const c = input as Record<string, unknown>;
  check(Object.keys(c).every(key => key === 'engine' || key === 'path'), 'DB_CONNECTION_INVALID', 'A SQLite connection names one database file.');
  check(c.engine === 'sqlite', 'DB_ENGINE_MISMATCH', 'The mapping and the connection are for different database engines.');
  check(typeof c.path === 'string' && c.path.length <= 4096 && !c.path.includes('\0') && isAbsolute(c.path) && !/^file:/i.test(c.path), 'DB_PATH_INVALID', 'A SQLite database is an absolute file path.');
  let stat;
  try { stat = lstatSync(c.path as string); } catch { throw new ChausarError('DB_PATH_INVALID', 'The SQLite database file does not exist.'); }
  check(!stat.isSymbolicLink(), 'DB_PATH_INVALID', 'A SQLite database path must not be a symbolic link.');
  check(stat.isFile(), 'DB_PATH_INVALID', 'A SQLite database path must be a regular file.');
  return { engine: 'sqlite', path: c.path as string };
}

/** Opens the file read-only, with extensions off and query_only on. Writes fail inside SQLite itself. */
export function openSqliteReadOnly(connection: unknown, timeoutMs = 30_000): DatabaseSync {
  const c = validateSqliteConnection(connection);
  let db: DatabaseSync;
  try { db = new DatabaseSync(c.path, { readOnly: true, timeout: timeoutMs, allowExtension: false } as any); }
  catch { throw new ChausarError('DB_OPEN_FAILED', 'The SQLite database file could not be opened read-only.'); }
  try { db.exec('PRAGMA query_only = ON'); } catch { db.close(); throw new ChausarError('DB_OPEN_FAILED', 'The SQLite database file could not be opened read-only.'); }
  return db;
}

const text = (value: unknown): string | null => value === null || value === undefined ? null : typeof value === 'string' ? value : String(value);
const failure = (error: unknown) => error instanceof ChausarError ? error
  : /readonly|read-only|query_only/i.test(String((error as any)?.message ?? '')) ? new ChausarError('DB_WRITE_REFUSED', 'The database refused a write inside the read-only snapshot.')
    : new ChausarError('DB_QUERY_FAILED', 'The database refused the read query.');

/** One deferred read transaction over a read-only handle, always rolled back. */
export async function withSqliteSnapshot<T>(connection: unknown, timeoutMs: number, run: (session: SnapshotSession) => Promise<T>): Promise<T> {
  const db = openSqliteReadOnly(connection, timeoutMs);
  let began = false;
  const all = (sql: string, params: (string | number)[]) => { try { return db.prepare(sql).all(...params) as Record<string, unknown>[]; } catch (error) { throw failure(error); } };
  try {
    try { db.exec('BEGIN'); began = true; } catch (error) { throw failure(error); }
    const session: SnapshotSession = {
      async catalogue(table) {
        const tables = table
          ? all(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?`, [table.name])
          : all(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' ORDER BY name LIMIT ${CATALOGUE_LIMIT + 1}`, []);
        const out: { schema: string | null; table: string; column: { name: string; type: string; nullable: boolean } }[] = [];
        for (const row of tables) {
          const name = String(row.name);
          for (const column of all('SELECT name, type, "notnull" AS not_null FROM pragma_table_info(?) ORDER BY cid', [name]))
            out.push({ schema: null, table: name, column: { name: String(column.name), type: String(column.type ?? ''), nullable: Number(column.not_null) === 0 } });
          check(out.length <= CATALOGUE_LIMIT, 'DB_CATALOGUE_LIMIT', 'The database lists more columns than a table picker shows.');
        }
        return out;
      },
      async select(bound) {
        return all(bound.text, bound.params).map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, text(value)])) as PlainDbRow);
      },
    };
    return await run(session);
  } finally {
    if (began) { try { db.exec('ROLLBACK'); } catch { /* the handle closes regardless */ } }
    db.close();
  }
}
