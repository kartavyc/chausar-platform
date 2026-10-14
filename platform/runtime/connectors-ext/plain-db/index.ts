import { check, ChausarError } from '../../contracts.ts';
import { BUILT_IN_DECODERS } from '../decoders.ts';
import { compileRecipe, runRecipe, type Decoder } from '../recipe.ts';
import type { RecipeOutcome } from '../types.ts';
import { buildQueries, checkAgainstCatalogue, isSystemCatalogue, limits, recipeFor, SYSTEM_CATALOGUE_REFUSAL, validateMapping } from './sql.ts';
import { withPostgresSnapshot } from './postgres.ts';
import { withMysqlSnapshot } from './mysql.ts';
import { validateSqliteConnection, withSqliteSnapshot } from './sqlite.ts';
import type { PlainDbConnection, PlainDbOptions, PlainDbRead, PlainDbRow, PlainDbTable, SnapshotSession } from './types.ts';

export * from './types.ts';
export { buildQueries, checkAgainstCatalogue, isSystemCatalogue, DIALECTS, identifierShape, mysqlLiteral, recipeFor, validateMapping, ROW_LIMIT_MAX } from './sql.ts';
export { withPostgresSnapshot, postgresFailure } from './postgres.ts';
export { withSqliteSnapshot, openSqliteReadOnly, validateSqliteConnection } from './sqlite.ts';
export { withMysqlSnapshot, connectMysql, nativePasswordScramble, cachingSha2Scramble, mysqlErrorCode, lenencInt, MYSQL_LIMITS, type MysqlClient, type MysqlResult, type MysqlClientOptions } from './mysql.ts';

const decoders: ReadonlyMap<string, Decoder> = new Map(BUILT_IN_DECODERS.map(decoder => [decoder.id, decoder]));

function engineOf(connection: unknown): PlainDbConnection['engine'] {
  const engine = (connection as any)?.engine;
  check(engine === 'postgres' || engine === 'mysql' || engine === 'sqlite', 'DB_CONNECTION_INVALID', 'Choose postgres, mysql or sqlite.');
  return engine;
}
function withSnapshot<T>(connection: unknown, options: PlainDbOptions, run: (session: SnapshotSession) => Promise<T>): Promise<T> {
  const { timeoutMs } = limits(options), engine = engineOf(connection);
  if (engine === 'postgres') return withPostgresSnapshot(connection, options, timeoutMs, run);
  if (engine === 'mysql') return withMysqlSnapshot(connection, options, timeoutMs, run);
  return withSqliteSnapshot(connection, timeoutMs, run);
}
/** Identifies one source table for record identity: engine, server or file, database and table. Never a credential. */
function sourceKey(connection: PlainDbConnection, schema: string | null, table: string): string {
  if (connection.engine === 'sqlite') return JSON.stringify(['sqlite', connection.path, table]);
  return JSON.stringify([connection.engine, connection.host, connection.port, connection.database, schema, table]);
}

/** Tables and columns with their types, from the database's own catalogue, for a picker. Read-only. */
export async function listTables(connection: PlainDbConnection, options: PlainDbOptions = {}): Promise<PlainDbTable[]> {
  return withSnapshot(connection, options, async session => {
    const tables = new Map<string, PlainDbTable>();
    for (const entry of await session.catalogue()) {
      if (isSystemCatalogue(engineOf(connection), engineOf(connection) === 'sqlite' ? entry.table : entry.schema ?? '')) continue;
      const key = JSON.stringify([entry.schema, entry.table]);
      if (!tables.has(key)) tables.set(key, { schema: entry.schema, name: entry.table, columns: [] });
      tables.get(key)!.columns.push(entry.column);
    }
    return [...tables.values()];
  });
}

/**
 * Reads one mapped table inside one read-only snapshot: the database's COUNT and SUM first, then every
 * row as text, ordered by id. More rows than the limit is refused from the COUNT, never truncated.
 * The caller runs runRecipe(compileRecipe(recipe, DECODERS), DECODERS.get('api-records'), { records, meta }).
 */
export async function plainDbRead(connection: PlainDbConnection, mappingInput: unknown, options: PlainDbOptions = {}): Promise<PlainDbRead> {
  const mapping = validateMapping(mappingInput), { rowLimit } = limits(options);
  check(engineOf(connection) === mapping.engine, 'DB_ENGINE_MISMATCH', 'The mapping and the connection are for different database engines.');
  if (mapping.engine === 'sqlite') validateSqliteConnection(connection);
  let schema: string | null = null;
  if (mapping.engine === 'postgres') schema = mapping.table.schema ?? 'public';
  else if (mapping.engine === 'mysql') { check(mapping.table.schema === undefined || mapping.table.schema === (connection as any).database, 'DB_TABLE_UNKNOWN', 'A MySQL table is read from the connection\'s own database.'); schema = (connection as any).database; }
  else check(mapping.table.schema === undefined || mapping.table.schema === 'main', 'DB_TABLE_UNKNOWN', 'A SQLite table is read from the main database.');
  check(!isSystemCatalogue(mapping.engine, mapping.engine === 'sqlite' ? mapping.table.name : schema!), ...SYSTEM_CATALOGUE_REFUSAL);
  const recipe = recipeFor(mapping, sourceKey(connection, schema, mapping.table.name));
  compileRecipe(recipe, decoders);
  return withSnapshot(connection, options, async session => {
    const catalogue = (await session.catalogue({ schema, name: mapping.table.name }))
      .filter(entry => entry.table === mapping.table.name && (mapping.engine !== 'postgres' || entry.schema === schema)).map(entry => entry.column);
    const columns = checkAgainstCatalogue(mapping, catalogue);
    const queries = buildQueries(mapping, columns, rowLimit);
    const aggregate = await session.select(queries.aggregate);
    check(aggregate.length === 1, 'DB_AGGREGATE_INVALID', 'The database did not return its own total.');
    const count = aggregate[0].row_count, sum = aggregate[0].measure_total;
    check(typeof count === 'string' && /^\d{1,18}$/.test(count), 'DB_AGGREGATE_INVALID', 'The database did not return its own row count.');
    check(sum === null || (typeof sum === 'string' && /^-?\d{1,30}(?:\.\d{1,12})?$/.test(sum)), 'DB_AGGREGATE_INVALID', 'The database total is not exact decimal text.');
    check(BigInt(count) <= BigInt(rowLimit), 'DB_ROW_LIMIT', 'The table has more rows in this period than one read accepts. Choose a shorter period.');
    const rows = await session.select(queries.rows);
    check(rows.length <= rowLimit, 'DB_ROW_LIMIT', 'The table has more rows in this period than one read accepts. Choose a shorter period.');
    const records: PlainDbRow[] = rows.map(row => {
      const keys = Object.keys(row);
      check(keys.length === queries.aliases.length && queries.aliases.every(alias => Object.hasOwn(row, alias)), 'DB_RESULT_SHAPE', 'The database returned columns the read did not ask for.');
      return Object.fromEntries(queries.aliases.map(alias => {
        const value = row[alias];
        check(value === null || typeof value === 'string', 'DB_RESULT_SHAPE', 'The database returned a value that is not text.');
        return [alias, value];
      }));
    });
    const meta: PlainDbRead['meta'] = { declaredRowCount: String(BigInt(count)), declaredAmountUnit: mapping.measure === 'money' ? mapping.moneyUnit : 'minor', declaredReference: 'database-aggregate' };
    if (sum !== null) meta.declaredAmount = sum;
    return { records, meta, recipe };
  });
}

/** Convenience: read, then check the rows against the same snapshot's aggregate with the recipe engine. */
export async function plainDbImport(connection: PlainDbConnection, mapping: unknown, options: PlainDbOptions = {}): Promise<RecipeOutcome> {
  const read = await plainDbRead(connection, mapping, options);
  return runRecipe(compileRecipe(read.recipe, decoders), decoders.get('api-records')!, { records: read.records, meta: { ...read.meta } });
}

export function isPlainDbError(error: unknown): error is ChausarError { return error instanceof ChausarError && /^(DB_|MYSQL_|PLAIN_DB_)/.test(error.code); }
