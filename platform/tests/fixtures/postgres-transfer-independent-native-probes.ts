import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

/** Trusted, synthetic C-fixture configuration only. This module creates no data or pool. */
export type NativeProbeRelation = Readonly<{ schema: string; table: string }>;
export type PostgresNativeProbeOptions = {
  pool: Pool;
  expectedDatabase: string;
  dedicatedRow: NativeProbeRelation & Readonly<{ keyColumn: string; keyValue: string | number }>;
  censusRelations: readonly NativeProbeRelation[];
  statementTimeoutMs?: number;
  observeTimeoutMs?: number;
  totalTimeoutMs?: number;
  maxRowsPerRelation?: number;
  maxTotalRows?: number;
  maxCatalogEntries?: number;
  maxBytes?: number;
};
type Identity = Readonly<{ backendId: number; database: string; databaseOid: string; serverAt: string }>;
export type NativeProbeEvent = Readonly<{ phase: string; at: string; sqlState: string | null }>;
export type NativeShareLockEvidence = Readonly<{
  kind: 'native-share-lock-contender';
  status: 'acquired-after-release' | 'failed';
  database: string;
  relation: NativeProbeRelation;
  heldBackendId: number;
  observer: Identity | null;
  contender: Identity | null;
  blockingBackendIds: readonly number[];
  blockedServerAt: string | null;
  events: readonly NativeProbeEvent[];
  elapsedMs: number;
  sqlState: string | null;
}>;
export type NativeCensusEvidence = Readonly<{
  kind: 'native-catalog-and-selected-rows';
  scope: 'actual-user-catalog-and-explicit-constructor-relations';
  identity: Identity;
  catalog: Readonly<{ schemas: readonly QueryResultRow[]; relations: readonly QueryResultRow[];
    columns: readonly QueryResultRow[]; constraints: readonly QueryResultRow[]; indexes: readonly QueryResultRow[] }>;
  catalogFingerprint: string;
  rowFingerprints: readonly Readonly<{ relation: NativeProbeRelation; oid: string; rows: number; bytes: number; digest: string }>[];
  fingerprint: string;
  startedAt: string;
  finishedAt: string;
  sqlState: null;
}>;
export class PostgresNativeProbeError extends Error {
  readonly evidence: NativeShareLockEvidence;
  constructor(message: string, evidence: NativeShareLockEvidence) {
    super(message); this.name = 'PostgresNativeProbeError'; this.evidence = evidence;
  }
}
export class PostgresNativeCensusError extends Error {
  readonly evidence: Readonly<{ kind: 'native-census-failure'; identity: Identity | null;
    startedAt: string; finishedAt: string; sqlState: string | null }>;
  constructor(evidence: PostgresNativeCensusError['evidence']) {
    super('Independent native census failed; inspect bounded evidence only.');
    this.name = 'PostgresNativeCensusError'; this.evidence = immutable(evidence);
  }
}

const timestamp = () => new Date().toISOString();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
function sqlState(error: unknown): string | null {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null;
}
function requireValue(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function integer(value: number, min: number, max: number, name: string): number {
  requireValue(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid bounded ${name}.`); return value;
}
function identifier(value: string): string {
  requireValue(typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && Buffer.byteLength(value, 'utf8') <= 63, 'Use an exact PostgreSQL identifier of at most 63 bytes.');
  return `"${value.replaceAll('"', '""')}"`;
}
const relationSql = (relation: NativeProbeRelation) => `${identifier(relation.schema)}.${identifier(relation.table)}`;
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
async function bounded<T>(work: Promise<T>, deadline: number, label: string): Promise<T> {
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) {
    void work.catch(() => {});
    throw new Error(`Native probe deadline expired: ${label}.`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Native probe deadline expired: ${label}.`)), remaining);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function connect(pool: Pool, deadline: number): Promise<PoolClient> {
  // A late successful checkout after a deadline is destroyed, never leaked into the pool.
  let abandoned = false;
  const checkout = pool.connect().then(client => {
    if (abandoned) { client.release(true); throw new Error('Native probe checkout completed after its deadline.'); }
    return client;
  });
  try { return await bounded(checkout, deadline, 'pool checkout'); }
  catch (error) { abandoned = true; throw error; }
}
async function query<R extends QueryResultRow = QueryResultRow>(client: PoolClient, deadline: number,
  text: string, values?: unknown[]): Promise<R[]> {
  requireValue(performance.now() < deadline, 'Native SQL statement deadline expired before dispatch.');
  return (await bounded(client.query<R>(text, values), deadline, 'SQL statement')).rows;
}
async function configure(client: PoolClient, deadline: number, statementMs: number, readOnly: boolean): Promise<void> {
  await query(client, deadline, readOnly ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY' : 'BEGIN');
  await query(client, deadline, `SELECT set_config('statement_timeout', $1, true),
    set_config('lock_timeout', $1, true), set_config('idle_in_transaction_session_timeout', $2, true)`,
  [`${statementMs}ms`, `${Math.ceil(deadline - performance.now())}ms`]);
}
async function identity(client: PoolClient, deadline: number, expectedDatabase: string): Promise<Identity> {
  const rows = await query(client, deadline, `SELECT pg_backend_pid() AS backend_id,
    current_database() AS database, d.oid::text AS database_oid, clock_timestamp()::text AS server_at
    FROM pg_database d WHERE d.datname = current_database()`);
  requireValue(rows.length === 1 && rows[0]!.database === expectedDatabase, 'Probe connection reached a different database.');
  requireValue(Number.isInteger(rows[0]!.backend_id) && rows[0]!.backend_id > 0
    && /^\d+$/.test(rows[0]!.database_oid), 'Native database/backend identity is unavailable.');
  return immutable({ backendId: rows[0]!.backend_id, database: rows[0]!.database,
    databaseOid: rows[0]!.database_oid, serverAt: rows[0]!.server_at });
}
async function release(client: PoolClient | undefined, deadline: number): Promise<void> {
  if (!client) return;
  try {
    await bounded(client.query('ROLLBACK'), Math.max(deadline, performance.now() + 1000), 'rollback cleanup');
    client.release();
  } catch { client.release(true); }
}

/** No injected query ports: actual pg clients, native locks/catalog and immutable observations. */
export function createPostgresTransferNativeProbes(options: PostgresNativeProbeOptions) {
  requireValue(options.pool instanceof Pool, 'Supply a real independent pg Pool.');
  requireValue(typeof options.expectedDatabase === 'string' && options.expectedDatabase.length > 0, 'Name the dedicated synthetic database.');
  integer(options.pool.options.connectionTimeoutMillis ?? 0, 1, 10_000, 'pool connection timeout');
  integer(options.pool.options.max ?? 0, 2, 100, 'independent pool capacity');
  const statementMs = integer(options.statementTimeoutMs ?? 5000, 100, 10_000, 'statement timeout');
  const observeMs = integer(options.observeTimeoutMs ?? 1500, 50, 5000, 'blocked observation timeout');
  const totalMs = integer(options.totalTimeoutMs ?? 15_000, 1000, 30_000, 'total timeout');
  requireValue(observeMs < statementMs && totalMs > statementMs + observeMs, 'Observation must finish before the lock/total deadlines.');
  const maxRows = integer(options.maxRowsPerRelation ?? 10_000, 1, 50_000, 'rows per relation');
  const maxTotalRows = integer(options.maxTotalRows ?? 50_000, 1, 100_000, 'total rows');
  const maxCatalogEntries = integer(options.maxCatalogEntries ?? 2000, 1, 10_000, 'catalog entries per category');
  const maxBytes = integer(options.maxBytes ?? 8_000_000, 1024, 32_000_000, 'census bytes');
  const pool = options.pool, expectedDatabase = options.expectedDatabase;
  const dedicatedRow = immutable(structuredClone(options.dedicatedRow));
  const dedicatedSql = relationSql(dedicatedRow), keySql = identifier(dedicatedRow.keyColumn);
  requireValue(typeof dedicatedRow.keyValue === 'string' || Number.isSafeInteger(dedicatedRow.keyValue), 'Supply the exact existing synthetic row key.');
  requireValue(options.censusRelations.length > 0 && options.censusRelations.length <= 64, 'Supply 1..64 explicit census relations.');
  const censusRelations = immutable(structuredClone(options.censusRelations));
  const names = censusRelations.map(relationSql);
  requireValue(new Set(names).size === names.length, 'Census relations must be unique.');

  return Object.freeze({
    /** Invoke while real capture is paused after acquiring its SHARE locks.
     * releaseCapture must release that held capture; this is lock-only, not an admitted State write. */
    async probeShareLock(input: { heldBackendId: number; releaseCapture: () => Promise<void> }): Promise<NativeShareLockEvidence> {
      integer(input.heldBackendId, 1, 2_147_483_647, 'held backend ID');
      requireValue(typeof input.releaseCapture === 'function', 'Supply the host-owned capture release callback.');
      const start = performance.now(), deadline = start + totalMs;
      const events: NativeProbeEvent[] = [];
      const event = (phase: string, state: string | null = null) => events.push({ phase, at: timestamp(), sqlState: state });
      let observerClient: PoolClient | undefined, contenderClient: PoolClient | undefined;
      let observer: Identity | null = null, contender: Identity | null = null, blockedServerAt: string | null = null;
      let blockingBackendIds: number[] = [], lockSettled = false;
      const evidence = (status: NativeShareLockEvidence['status'], state: string | null) => immutable({
        kind: 'native-share-lock-contender' as const, status, database: expectedDatabase,
        relation: { schema: dedicatedRow.schema, table: dedicatedRow.table }, heldBackendId: input.heldBackendId,
        observer, contender, blockingBackendIds: [...blockingBackendIds], blockedServerAt,
        events: [...events], elapsedMs: performance.now() - start, sqlState: state,
      });
      try {
        observerClient = await connect(pool, deadline); contenderClient = await connect(pool, deadline);
        await configure(observerClient, deadline, statementMs, false);
        await configure(contenderClient, deadline, statementMs, false);
        observer = await identity(observerClient, deadline, expectedDatabase);
        contender = await identity(contenderClient, deadline, expectedDatabase);
        requireValue(observer.backendId !== contender.backendId && contender.backendId !== input.heldBackendId
          && observer.backendId !== input.heldBackendId && observer.databaseOid === contender.databaseOid,
        'Observer/contender must be independent same-database backends.');
        const owner = await query(observerClient, deadline,
          'SELECT datid::text AS database_oid FROM pg_stat_activity WHERE pid = $1', [input.heldBackendId]);
        requireValue(owner.length === 1 && owner[0]!.database_oid === observer.databaseOid, 'Held backend is not live in this same database.');
        event('contender-issued');
        // ROW EXCLUSIVE is the writer-class table lock that conflicts with SHARE.
        // No UPDATE/dead tuples or logical data changes are needed to prove this boundary.
        const lock = query(contenderClient, deadline, `LOCK TABLE ${dedicatedSql} IN ROW EXCLUSIVE MODE`)
          .then(() => { lockSettled = true; event('contender-acquired'); return null; }, error => {
            lockSettled = true; event('contender-refused', sqlState(error)); return error;
          });
        const observeDeadline = Math.min(deadline, performance.now() + observeMs);
        let blocked = false;
        while (performance.now() < observeDeadline) {
          await query(observerClient, deadline, 'SELECT pg_stat_clear_snapshot()');
          const rows = await query(observerClient, deadline, `SELECT clock_timestamp()::text AS server_at,
            pg_blocking_pids($1::integer) AS blockers,
            EXISTS (SELECT 1 FROM pg_locks WHERE pid = $1 AND relation = to_regclass($3)
              AND mode = 'RowExclusiveLock' AND NOT granted) AS waiting_writer,
            EXISTS (SELECT 1 FROM pg_locks WHERE pid = $2 AND relation = to_regclass($3)
              AND mode = 'ShareLock' AND granted) AS held_share,
            (SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1) AS wait_type`,
          [contender.backendId, input.heldBackendId, dedicatedSql]);
          const row = rows[0]!;
          blockingBackendIds = Array.isArray(row.blockers) ? row.blockers.map(Number) : [];
          if (row.waiting_writer === true && row.held_share === true && row.wait_type === 'Lock'
            && blockingBackendIds.includes(input.heldBackendId) && !lockSettled) {
            blocked = true; blockedServerAt = row.server_at; event('native-block-confirmed'); break;
          }
          if (lockSettled) break;
          await delay(20);
        }
        if (!blocked) {
          // Destroying the contender aborts its transaction even if the server is still waiting.
          contenderClient.release(true); contenderClient = undefined;
          const refusal = await lock;
          throw refusal ?? new Error('Native contender did not remain blocked by the held SHARE lock.');
        }
        event('capture-release-requested');
        await bounded(Promise.resolve().then(input.releaseCapture), deadline, 'held capture release');
        event('capture-released');
        const refusal = await lock; if (refusal) throw refusal;
        const rows = await query(contenderClient, deadline,
          `SELECT count(*)::text AS rows FROM ${dedicatedSql} WHERE ${keySql} = $1`, [dedicatedRow.keyValue]);
        requireValue(rows.length === 1 && rows[0]!.rows === '1', 'The caller-owned dedicated row must still exist exactly once.');
        await query(contenderClient, deadline, 'ROLLBACK'); event('contender-rolled-back');
        await query(observerClient, deadline, 'ROLLBACK'); event('observer-rolled-back');
        return evidence('acquired-after-release', null);
      } catch (error) {
        event('probe-failed', sqlState(error));
        throw new PostgresNativeProbeError('Independent native SHARE-lock probe failed.', evidence('failed', sqlState(error)));
      } finally {
        await release(contenderClient, deadline); await release(observerClient, deadline);
      }
    },

    /** Logical source fingerprint, not original physical JSONB bytes or complete payload recovery.
     * Catalog is actual user namespace metadata; row coverage is exactly censusRelations. */
    async readCensus(): Promise<NativeCensusEvidence> {
      const startedAt = timestamp(), deadline = performance.now() + totalMs;
      let client: PoolClient | undefined;
      let connectionIdentity: Identity | null = null;
      try {
        client = await connect(pool, deadline); await configure(client, deadline, statementMs, true);
        connectionIdentity = await identity(client, deadline, expectedDatabase);
        const schemas = await query(client, deadline, `SELECT nspname AS schema, oid::text AS oid,
          nspowner::text AS owner, nspacl::text AS acl FROM pg_namespace
          WHERE nspname <> 'information_schema' AND nspname !~ '^pg_' ORDER BY nspname COLLATE "C" LIMIT $1`, [maxCatalogEntries + 1]);
        const relations = await query(client, deadline, `SELECT n.nspname AS schema, c.relname AS name,
          c.oid::text AS oid, c.relkind AS kind, c.relpersistence AS persistence, c.relowner::text AS owner,
          c.relrowsecurity AS row_security, c.relforcerowsecurity AS force_row_security, c.relacl::text AS acl
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'
          ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", c.oid LIMIT $1`, [maxCatalogEntries + 1]);
        const columns = await query(client, deadline, `SELECT n.nspname AS schema, c.relname AS relation,
          a.attnum AS ordinal, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
          a.attnotnull AS not_null, a.attidentity AS identity, a.attgenerated AS generated,
          d.oid IS NOT NULL AS has_default,
          encode(sha256(convert_to(coalesce(pg_get_expr(d.adbin,d.adrelid),''),'UTF8')),'hex') AS default_digest
          FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
          LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
          WHERE a.attnum>0 AND NOT a.attisdropped AND n.nspname<>'information_schema' AND n.nspname !~ '^pg_'
          ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",a.attnum LIMIT $1`, [maxCatalogEntries + 1]);
        const constraints = await query(client, deadline, `SELECT n.nspname AS schema, c.relname AS relation,
          k.conname AS name, k.contype AS type,
          encode(sha256(convert_to(pg_get_constraintdef(k.oid,true),'UTF8')),'hex') AS definition_digest
          FROM pg_constraint k JOIN pg_namespace n ON n.oid=k.connamespace LEFT JOIN pg_class c ON c.oid=k.conrelid
          WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_'
          ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",k.conname COLLATE "C",k.oid LIMIT $1`, [maxCatalogEntries + 1]);
        const indexes = await query(client, deadline, `SELECT n.nspname AS schema, c.relname AS relation,
          i.relname AS name, encode(sha256(convert_to(pg_get_indexdef(i.oid),'UTF8')),'hex') AS definition_digest,
          x.indisvalid AS valid, x.indisready AS ready
          FROM pg_index x JOIN pg_class c ON c.oid=x.indrelid JOIN pg_class i ON i.oid=x.indexrelid
          JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname<>'information_schema' AND n.nspname !~ '^pg_'
          ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",i.relname COLLATE "C" LIMIT $1`, [maxCatalogEntries + 1]);
        const catalog = { schemas, relations, columns, constraints, indexes };
        requireValue(Object.values(catalog).every(rows => rows.length <= maxCatalogEntries),
          'Native catalog entry budget exceeded; no partial fingerprint is returned.');
        const catalogFingerprint = sha(JSON.stringify(catalog));
        let bytes = Buffer.byteLength(JSON.stringify(catalog)), totalRows = 0;
        requireValue(bytes <= maxBytes, 'Native catalog exceeds the explicit byte budget.');
        const rowFingerprints: { relation: NativeProbeRelation; oid: string; rows: number; bytes: number; digest: string }[] = [];
        for (const relation of censusRelations) {
          const actual = relations.filter(row => row.schema === relation.schema && row.name === relation.table);
          requireValue(actual.length === 1 && ['r', 'p', 'm'].includes(actual[0]!.kind), 'Explicit census relation is missing or not a retained table.');
          await query(client, deadline, "SELECT set_config('row_security', 'off', true)");
          const rows = await query(client, deadline, `SELECT row_hash,row_bytes FROM (SELECT
            encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_hash,
            octet_length(convert_to(to_jsonb(t)::text,'UTF8'))::text AS row_bytes FROM ${relationSql(relation)} t) fingerprints
            ORDER BY row_hash COLLATE "C",row_bytes COLLATE "C" LIMIT $1`, [maxRows + 1]);
          totalRows += rows.length;
          requireValue(rows.length <= maxRows && totalRows <= maxTotalRows, 'Native census row budget exceeded; no partial fingerprint is returned.');
          const relationBytes = rows.reduce((sum, row) => {
            requireValue(typeof row.row_hash === 'string' && /^[a-f0-9]{64}$/.test(row.row_hash)
              && /^\d+$/.test(row.row_bytes) && Number.isSafeInteger(Number(row.row_bytes)), 'Native row fingerprint is inconsistent.');
            return sum + Number(row.row_bytes);
          }, 0);
          const text = JSON.stringify(rows);
          bytes += relationBytes; requireValue(bytes <= maxBytes, 'Native census byte budget exceeded; no partial fingerprint is returned.');
          rowFingerprints.push({ relation: structuredClone(relation), oid: actual[0]!.oid,
            rows: rows.length, bytes: relationBytes, digest: sha(text) });
        }
        rowFingerprints.sort((a,b) => relationSql(a.relation).localeCompare(relationSql(b.relation), 'en'));
        await query(client, deadline, 'ROLLBACK');
        return immutable({ kind: 'native-catalog-and-selected-rows' as const,
          scope: 'actual-user-catalog-and-explicit-constructor-relations' as const, identity: connectionIdentity,
          catalog, catalogFingerprint, rowFingerprints, fingerprint: sha(JSON.stringify({ catalogFingerprint, rowFingerprints })),
          startedAt, finishedAt: timestamp(), sqlState: null });
      } catch (error) {
        throw new PostgresNativeCensusError({ kind: 'native-census-failure', identity: connectionIdentity,
          startedAt, finishedAt: timestamp(), sqlState: sqlState(error) });
      } finally { await release(client, deadline); }
    },
  });
}
