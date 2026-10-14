import { check, ChausarError } from '../../contracts.ts';
import { resolvePassword, validateNetworkConnection, CATALOGUE_LIMIT } from './sql.ts';
import type { PgClientConfig, PgClientFactory, PgLikeClient, PlainDbOptions, PlainDbRow, SnapshotSession } from './types.ts';

/** Postgres error classes to fixed codes. Server text (which can name tables or values) is never passed on. */
export function postgresFailure(error: unknown): ChausarError {
  if (error instanceof ChausarError) return error;
  const code = typeof (error as any)?.code === 'string' ? (error as any).code as string : '';
  if (code === '28P01' || code === '28000') return new ChausarError('DB_AUTH_FAILED', 'The database did not accept the user name or password.');
  if (code === '57014') return new ChausarError('DB_TIMEOUT', 'The database read took longer than its time limit.');
  if (code === '25006') return new ChausarError('DB_WRITE_REFUSED', 'The database refused a write inside the read-only snapshot.');
  if (code === '42501') return new ChausarError('DB_PERMISSION_DENIED', 'This database user may not read that table.');
  if (code === '42P01' || code === '42703' || code === '3F000') return new ChausarError('DB_IDENTIFIER_UNKNOWN', 'The table or column is not in the database.');
  if (code === '3D000') return new ChausarError('DB_DATABASE_UNKNOWN', 'The database does not exist on that server.');
  if (['ECONNREFUSED', 'ENOTFOUND', 'EHOSTUNREACH', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(code)) return new ChausarError('DB_CONNECT_FAILED', 'The database server could not be reached.');
  if (/^08/.test(code)) return new ChausarError('DB_CONNECT_FAILED', 'The database server could not be reached.');
  // The driver's own time limits (connection and query read) carry no code; the message is matched, never passed on.
  if (!code && /timeout|timed out/i.test(String((error as any)?.message ?? ''))) return new ChausarError('DB_TIMEOUT', 'The database read took longer than its time limit.');
  return new ChausarError('DB_QUERY_FAILED', 'The database refused the read query.');
}

async function defaultFactory(): Promise<PgClientFactory> {
  const moduleName = 'pg'; const pg: any = await import(moduleName);
  const Client = pg.Client ?? pg.default?.Client;
  check(typeof Client === 'function', 'DB_DRIVER_MISSING', 'The Postgres driver is not installed.');
  return (config: PgClientConfig) => new Client(config) as PgLikeClient;
}

const text = (value: unknown): string | null => value === null || value === undefined ? null : typeof value === 'string' ? value : String(value);

/**
 * One read-only snapshot: REPEATABLE READ READ ONLY, statement timeout, IST business dates, then ROLLBACK.
 * The session also starts with default_transaction_read_only so nothing outside the snapshot can write.
 */
export async function withPostgresSnapshot<T>(connection: unknown, options: PlainDbOptions, timeoutMs: number, run: (session: SnapshotSession) => Promise<T>): Promise<T> {
  const c = validateNetworkConnection(connection, 'postgres');
  const password = await resolvePassword(options, c.passwordRef);
  const factory = options.createPostgresClient ?? await defaultFactory();
  const config: PgClientConfig = {
    host: c.host, port: c.port, database: c.database, user: c.user, password,
    ssl: c.ssl === 'require' ? { rejectUnauthorized: true, servername: /^[0-9.:]+$/.test(c.host) ? undefined : c.host } : false,
    connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs + 1000, statement_timeout: timeoutMs,
    application_name: 'chausar-plain-read', options: '-c default_transaction_read_only=on',
  };
  if (config.ssl && config.ssl.servername === undefined) delete config.ssl.servername;
  const client = factory(config);
  let connected = false, began = false;
  const query = async (sql: string, params: unknown[] = []) => {
    try { return await client.query(sql, params); } catch (error) { throw postgresFailure(error); }
  };
  try {
    try { await client.connect(); connected = true; } catch (error) {
      const failure = postgresFailure(error);
      // A connection that fails without a server code (closed, refused mid-handshake) is a connection failure, not a query failure.
      throw failure.code === 'DB_QUERY_FAILED' ? new ChausarError('DB_CONNECT_FAILED', 'The database server could not be reached.') : failure;
    }
    await query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); began = true;
    await query('SET TRANSACTION READ ONLY');
    await query(`SET LOCAL statement_timeout = ${Math.trunc(timeoutMs)}`);
    await query(`SET LOCAL TIME ZONE 'Asia/Kolkata'`);
    await query(`SET LOCAL DateStyle = 'ISO, YMD'`);
    const session: SnapshotSession = {
      async catalogue(table) {
        const sql = 'SELECT table_schema, table_name, column_name, data_type, is_nullable FROM information_schema.columns'
          + (table ? ' WHERE table_schema = $1 AND table_name = $2' : ` WHERE table_schema NOT IN ('pg_catalog', 'information_schema')`)
          + ` ORDER BY table_schema, table_name, ordinal_position LIMIT ${CATALOGUE_LIMIT + 1}`;
        const result = await query(sql, table ? [table.schema ?? 'public', table.name] : []);
        check(result.rows.length <= CATALOGUE_LIMIT, 'DB_CATALOGUE_LIMIT', 'The database lists more columns than a table picker shows.');
        return result.rows.map(row => ({ schema: text(row.table_schema), table: String(row.table_name), column: { name: String(row.column_name), type: String(row.data_type), nullable: row.is_nullable === 'YES' } }));
      },
      async select(bound) {
        const result = await query(bound.text, bound.params);
        return result.rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, text(value)])) as PlainDbRow);
      },
    };
    return await run(session);
  } finally {
    if (began) await client.query('ROLLBACK').catch(() => undefined);
    if (connected) await client.end().catch(() => undefined);
  }
}
