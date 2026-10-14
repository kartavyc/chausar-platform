/**
 * The plain database connector against real database servers. Runs only when the server settings are in
 * the environment; otherwise every case is skipped with the reason, so the offline suite stays green.
 *
 * PostgreSQL: CHAUSAR_TEST_PG_HOST, CHAUSAR_TEST_PG_PORT, CHAUSAR_TEST_PG_USER, CHAUSAR_TEST_PG_PASSWORD,
 *   CHAUSAR_TEST_PG_DB. The user must be able to create (and drop) a schema; each run seeds its own.
 * MySQL / MariaDB: CHAUSAR_TEST_MYSQL_HOST, CHAUSAR_TEST_MYSQL_PORT, CHAUSAR_TEST_MYSQL_USER,
 *   CHAUSAR_TEST_MYSQL_PASSWORD (an administrator signing in with mysql_native_password, able to create
 *   databases and users), optional CHAUSAR_TEST_MYSQL_DB (database name prefix, default chausar_live).
 *   CHAUSAR_TEST_MYSQL_TLS=1 says the server's TLS certificate is trusted by this process (for example
 *   through NODE_EXTRA_CA_CERTS) and names 127.0.0.1; it enables the caching_sha2 full-auth-over-TLS case.
 * All hosts must be loopback: the settings use ssl 'disable' except in the TLS case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes } from 'node:crypto';
import { compileRecipe, runRecipe } from '../runtime/connectors-ext/recipe.ts';
import { DECODERS } from '../runtime/connectors-ext/recipes/index.ts';
import {
  plainDbRead, plainDbImport, listTables, withPostgresSnapshot, withMysqlSnapshot, connectMysql,
  type PlainDbMapping, type PostgresConnectionConfig, type MysqlConnectionConfig, type MysqlClient,
} from '../runtime/connectors-ext/plain-db/index.ts';

const env = process.env;
const runRead = (read: Awaited<ReturnType<typeof plainDbRead>>) => runRecipe(compileRecipe(read.recipe, DECODERS), DECODERS.get('api-records')!, { records: read.records, meta: { ...read.meta } });
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, `${error?.code}: ${error?.message}`); return true; };
const suffix = randomBytes(4).toString('hex');

/** Amounts whose float sum drifts (0.1 + 0.2 + ...), and a value past float's exact integer range. */
const LIVE_ROWS: [string, string, string, string, string][] = [
  ['L-01', '2026-09-01', '0.10', 'Sale', 'C-1'],
  ['L-02', '2026-09-02', '0.20', 'Sale', 'C-2'],
  ['L-03', '2026-09-03', '0.70', 'Sale', 'C-1'],
  ['L-04', '2026-09-15', '1234567890123.45', 'Sale', 'C-3'],
  ['L-05', '2026-09-30', '-250.33', 'Sale Return', 'C-2'],
  ['L-06', '2026-10-01', '999.99', 'Sale', 'C-1'],
  ['L-07', '2026-08-31', '5.55', 'Sale', 'C-4'],
];
/** September: 0.10 + 0.20 + 0.70 + 1234567890123.45 - 250.33, exact. */
const SEPT_TOTAL = '1234567889874.12';
const SEPT_TOTAL_MINOR = '123456788987412';
const floatSeptember = LIVE_ROWS.filter(r => r[1] >= '2026-09-01' && r[1] <= '2026-09-30').reduce((sum, r) => sum + Number(r[2]), 0);

// ---------------------------------------------------------------- PostgreSQL

const pgSettings = ['HOST', 'PORT', 'USER', 'PASSWORD', 'DB'].map(k => `CHAUSAR_TEST_PG_${k}`);
const pgMissing = pgSettings.filter(k => !env[k]);
const pgSkip = pgMissing.length ? `PostgreSQL live tests need ${pgMissing.join(', ')}` : false;
const pgSchema = `chausar_live_${suffix}`;
const pgConn = (over: Partial<PostgresConnectionConfig> = {}): PostgresConnectionConfig => ({
  engine: 'postgres', host: env.CHAUSAR_TEST_PG_HOST ?? '127.0.0.1', port: Number(env.CHAUSAR_TEST_PG_PORT ?? 5432), database: env.CHAUSAR_TEST_PG_DB ?? 'postgres',
  user: env.CHAUSAR_TEST_PG_USER ?? 'postgres', ssl: 'disable', passwordRef: 'keychain:pg-live', ...over,
});
const pgCredentials = async (ref: string) => { assert.equal(ref, 'keychain:pg-live'); return env.CHAUSAR_TEST_PG_PASSWORD!; };
const pgMapping = (over: Partial<PlainDbMapping> = {}): PlainDbMapping => ({
  engine: 'postgres', table: { schema: pgSchema, name: 'sales' }, columns: { id: 'id', date: 'txn_date', amount: 'amount', kind: 'kind', customerId: 'customer' },
  kindValues: { Sale: 'invoice', 'Sale Return': 'refund' }, currency: 'INR', measure: 'money', moneyUnit: 'major', dateFormat: 'ISO', ...over,
});

async function pgAdmin() {
  const moduleName = 'pg'; const pg: any = await import(moduleName);
  const Client = pg.Client ?? pg.default.Client;
  const client = new Client({ host: env.CHAUSAR_TEST_PG_HOST, port: Number(env.CHAUSAR_TEST_PG_PORT), user: env.CHAUSAR_TEST_PG_USER, password: env.CHAUSAR_TEST_PG_PASSWORD, database: env.CHAUSAR_TEST_PG_DB });
  await client.connect();
  return client as { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> };
}
const pgCount = async () => { const admin = await pgAdmin(); try { return (await admin.query(`SELECT count(*)::text AS n FROM "${pgSchema}".sales`)).rows[0].n; } finally { await admin.end(); } };

test.describe('postgres live', { skip: pgSkip }, () => {
  test.before(async () => {
    const admin = await pgAdmin();
    try {
      await admin.query(`CREATE SCHEMA "${pgSchema}"`);
      await admin.query(`CREATE TABLE "${pgSchema}".sales (id text PRIMARY KEY, txn_date date NOT NULL, amount numeric(18,2), kind text, customer text, price double precision, qty integer, ts timestamptz, cents bigint)`);
      for (const [id, date, amount, kind, customer] of LIVE_ROWS)
        await admin.query(`INSERT INTO "${pgSchema}".sales VALUES ($1, $2, $3, $4, $5, $6, 1, ($2::date)::timestamp AT TIME ZONE 'Asia/Kolkata', ($3::numeric * 100)::bigint)`, [id, date, amount, kind, customer, Number(amount)]);
      await admin.query(`CREATE TABLE "${pgSchema}"."line items" (sku text, qty integer)`);
      await admin.query(`CREATE SEQUENCE "${pgSchema}".counter`);
    } finally { await admin.end(); }
  });
  test.after(async () => { const admin = await pgAdmin(); try { await admin.query(`DROP SCHEMA IF EXISTS "${pgSchema}" CASCADE`); } finally { await admin.end(); } });

  test('postgres live: server version is recorded', async () => {
    const version = await withPostgresSnapshot(pgConn(), { credentials: pgCredentials }, 30_000, s => s.select({ text: 'SELECT version() AS v', params: [] }));
    assert.match(version[0].v!, /^PostgreSQL \d+/);
    console.log(`# engine: ${version[0].v}`);
  });

  test('postgres live: listTables reads the catalogue, including quoted names and types', async () => {
    const tables = (await listTables(pgConn(), { credentials: pgCredentials })).filter(t => t.schema === pgSchema);
    assert.deepEqual(tables.map(t => t.name).sort(), ['line items', 'sales']);
    const sales = tables.find(t => t.name === 'sales')!;
    assert.deepEqual(sales.columns.map(c => c.name), ['id', 'txn_date', 'amount', 'kind', 'customer', 'price', 'qty', 'ts', 'cents']);
    assert.equal(sales.columns.find(c => c.name === 'amount')!.type, 'numeric');
    assert.equal(sales.columns.find(c => c.name === 'price')!.type, 'double precision');
    assert.equal(sales.columns.find(c => c.name === 'id')!.nullable, false);
  });

  test('postgres live: a period read is accepted against the database aggregate with exact NUMERIC totals', async () => {
    assert.notEqual(String(floatSeptember), SEPT_TOTAL, 'a float sum of the same amounts drifts');
    const read = await plainDbRead(pgConn(), pgMapping({ period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: pgCredentials });
    assert.deepEqual(read.meta, { declaredRowCount: '5', declaredAmount: SEPT_TOTAL, declaredAmountUnit: 'major', declaredReference: 'database-aggregate' });
    assert.deepEqual(read.records.map(r => r.id), ['L-01', 'L-02', 'L-03', 'L-04', 'L-05']);
    assert.equal(read.records[3].amount, '1234567890123.45', 'NUMERIC arrives as exact text');
    assert.equal(read.records[0].date, '2026-09-01');
    const out = runRead(read);
    assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention));
    assert.equal(out.observed.total, SEPT_TOTAL_MINOR);
    assert.equal(out.sourceTotals?.reference, 'database-aggregate');
    assert.deepEqual(out.records.map(r => r.kind), ['invoice', 'invoice', 'invoice', 'invoice', 'refund']);
    const all = await plainDbImport(pgConn(), pgMapping(), { credentials: pgCredentials });
    assert.equal(all.status, 'accepted', JSON.stringify(all.refusal));
    assert.equal(all.records.length, 7);
  });

  test('postgres live: bigint minor units, ISO-DATETIME periods on timestamptz', async () => {
    const minor = await plainDbImport(pgConn(), pgMapping({ columns: { id: 'id', date: 'txn_date', amount: 'cents', kind: 'kind' }, moneyUnit: 'minor', period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: pgCredentials });
    assert.equal(minor.status, 'accepted', JSON.stringify(minor.refusal));
    assert.equal(minor.observed.total, SEPT_TOTAL_MINOR);
    const read = await plainDbRead(pgConn(), pgMapping({ columns: { id: 'id', date: 'ts', amount: 'amount', kind: 'kind' }, dateFormat: 'ISO-DATETIME', period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: pgCredentials });
    assert.equal(read.meta.declaredRowCount, '5', 'IST midnight boundaries select exactly September');
    assert.match(read.records[0].date!, /^2026-09-01 00:00:00\+05:30$/);
  });

  test('postgres live: a double precision amount is refused before any data query', async () => {
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ columns: { id: 'id', date: 'txn_date', amount: 'price', kind: 'kind' } }), { credentials: pgCredentials }), code('DB_FLOAT_AMOUNT'));
  });

  test('postgres live: writes are impossible inside the read-only snapshot', async () => {
    const attempts = [
      `INSERT INTO "${pgSchema}".sales (id, txn_date) VALUES ('X-1', '2026-09-01')`,
      `UPDATE "${pgSchema}".sales SET amount = 0`,
      `DELETE FROM "${pgSchema}".sales`,
      `CREATE TABLE "${pgSchema}".evil (x int)`,
      `SELECT nextval('"${pgSchema}".counter')`,
    ];
    for (const sql of attempts)
      await assert.rejects(withPostgresSnapshot(pgConn(), { credentials: pgCredentials }, 30_000, s => s.select({ text: sql, params: [] })), code('DB_WRITE_REFUSED'), sql);
    // Even an attempt to leave the read-only transaction cannot write: the session default is read-only too.
    await assert.rejects(withPostgresSnapshot(pgConn(), { credentials: pgCredentials }, 30_000, async s => {
      await s.select({ text: 'COMMIT', params: [] });
      return s.select({ text: `INSERT INTO "${pgSchema}".sales (id, txn_date) VALUES ('X-2', '2026-09-01')`, params: [] });
    }), code('DB_WRITE_REFUSED'));
    assert.equal(await pgCount(), String(LIVE_ROWS.length));
  });

  test('postgres live: identifier injection is refused; unknown names are refused from the catalogue', async () => {
    const opts = { credentials: pgCredentials };
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ table: { schema: pgSchema, name: 'sales"; DROP TABLE sales; --' } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ columns: { id: 'id', date: 'txn_date', amount: 'amount) FROM pg_shadow; --', kind: 'kind' } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ table: { schema: `${pgSchema}"."sales`, name: 'sales' } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ table: { schema: pgSchema, name: 'no_such_table' } }), opts), code('DB_TABLE_UNKNOWN'));
    // A superuser could read pg_authid (password hashes); system catalogues are refused before any query.
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ table: { schema: 'pg_catalog', name: 'pg_authid' }, columns: { id: 'rolname', date: 'rolvaliduntil', amount: 'oid', kind: 'rolname', description: 'rolpassword' } }), opts), code('DB_SYSTEM_TABLE'));
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ table: { schema: 'information_schema', name: 'columns' } }), opts), code('DB_SYSTEM_TABLE'));
    assert.ok((await listTables(pgConn(), opts)).every(t => !/^pg_|^information_schema$/.test(t.schema ?? '')), 'the picker lists no system tables');
    await assert.rejects(plainDbRead(pgConn(), pgMapping({ columns: { id: 'id', date: 'txn_date', amount: 'Amount', kind: 'kind' } }), opts), code('DB_COLUMN_UNKNOWN'));
    assert.equal(await pgCount(), String(LIVE_ROWS.length));
  });

  test('postgres live: the statement time limit is enforced by the server', async () => {
    const started = Date.now();
    await assert.rejects(withPostgresSnapshot(pgConn(), { credentials: pgCredentials }, 1000, s => s.select({ text: 'SELECT CAST(pg_sleep(5) AS TEXT) AS x', params: [] })), code('DB_TIMEOUT'));
    assert.ok(Date.now() - started < 4000, 'the read stops at the limit');
  });

  test('postgres live: wrong password and unknown database are typed refusals', async () => {
    await assert.rejects(plainDbRead(pgConn(), pgMapping(), { credentials: async () => 'not-the-password' }), (e: any) => e.code === 'DB_AUTH_FAILED' && !/not-the-password/.test(e.message));
    await assert.rejects(plainDbRead(pgConn({ database: `nodb_${suffix}` }), pgMapping(), { credentials: pgCredentials }), (e: any) => ['DB_DATABASE_UNKNOWN', 'DB_AUTH_FAILED'].includes(e.code));
  });
});

// ---------------------------------------------------------------- MySQL / MariaDB

const mySettings = ['HOST', 'PORT', 'USER', 'PASSWORD'].map(k => `CHAUSAR_TEST_MYSQL_${k}`);
const myMissing = mySettings.filter(k => !env[k]);
const mySkip = myMissing.length ? `MySQL live tests need ${myMissing.join(', ')}` : false;
const myDb = `${env.CHAUSAR_TEST_MYSQL_DB ?? 'chausar_live'}_${suffix}`;
const myHost = env.CHAUSAR_TEST_MYSQL_HOST ?? '127.0.0.1', myPort = Number(env.CHAUSAR_TEST_MYSQL_PORT ?? 3306);
const myPasswords: Record<string, string> = {};
const myConn = (user: string, over: Partial<MysqlConnectionConfig> = {}): MysqlConnectionConfig => ({
  engine: 'mysql', host: myHost, port: myPort, database: myDb, user, ssl: 'disable', passwordRef: `keychain:${user}`, ...over,
});
const myCredentials = async (ref: string) => { const user = ref.replace(/^keychain:/, ''); assert.ok(user in myPasswords, ref); return myPasswords[user]; };
const myMapping = (over: Partial<PlainDbMapping> = {}): PlainDbMapping => ({
  engine: 'mysql', table: { name: 'sales' }, columns: { id: 'id', date: 'txn_date', amount: 'amount', kind: 'kind', customerId: 'customer' },
  kindValues: { Sale: 'invoice', 'Sale Return': 'refund' }, currency: 'INR', measure: 'money', moneyUnit: 'major', dateFormat: 'ISO', ...over,
});
const adminSettings = () => ({ host: myHost, port: myPort, user: env.CHAUSAR_TEST_MYSQL_USER!, password: env.CHAUSAR_TEST_MYSQL_PASSWORD!, database: 'mysql', ssl: 'disable' as const, timeoutMs: 30_000 });
async function myAdmin<T>(run: (db: MysqlClient) => Promise<T>): Promise<T> {
  const db = await connectMysql(adminSettings());
  try { return await run(db); } finally { await db.close(); }
}
const nativeUser = `cl_nat_${suffix}`, shaUser = `cl_sha_${suffix}`, shaTlsUser = `cl_tls_${suffix}`;
let mariadb = false, myVersion = '';
const myCount = () => myAdmin(async db => (await db.query(`SELECT CAST(COUNT(*) AS CHAR) FROM \`${myDb}\`.sales`)).rows[0][0]);

test.describe('mysql live', { skip: mySkip }, () => {
  test.before(async () => {
    await myAdmin(async db => {
      myVersion = String((await db.query('SELECT VERSION()')).rows[0][0]);
      mariadb = /mariadb/i.test(myVersion);
      await db.query(`CREATE DATABASE \`${myDb}\``);
      await db.query(`CREATE TABLE \`${myDb}\`.sales (id VARCHAR(20) PRIMARY KEY, txn_date DATE NOT NULL, amount DECIMAL(18,2), kind VARCHAR(20), customer VARCHAR(20), price DOUBLE, ratio FLOAT, cents BIGINT, placed_at DATETIME)`);
      await db.query(`CREATE TABLE \`${myDb}\`.\`line items\` (sku VARCHAR(20), qty INT)`);
      const values = LIVE_ROWS.map(([id, date, amount, kind, customer]) => `('${id}', '${date}', ${amount}, '${kind}', '${customer}', ${Number(amount)}, ${Number(amount)}, ${Math.round(Number(amount) * 100)}, '${date} 00:00:00')`);
      await db.query(`INSERT INTO \`${myDb}\`.sales VALUES ${values.join(', ')}`);
      const users: [string, string, string][] = [[nativeUser, 'mysql_native_password', 'nat-pass-1']];
      if (!mariadb) users.push([shaUser, 'caching_sha2_password', 'sha-pass-1'], [shaTlsUser, 'caching_sha2_password', 'sha-tls-pass']);
      for (const [user, plugin, password] of users) {
        myPasswords[user] = password;
        await db.query(mariadb ? `CREATE USER '${user}'@'%' IDENTIFIED BY '${password}'` : `CREATE USER '${user}'@'%' IDENTIFIED WITH ${plugin} BY '${password}'`);
        await db.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, DROP ON \`${myDb}\`.* TO '${user}'@'%'`);
      }
    });
    console.log(`# engine: ${myVersion}`);
  });
  test.after(async () => {
    await myAdmin(async db => {
      await db.query(`DROP DATABASE IF EXISTS \`${myDb}\``);
      for (const user of [nativeUser, shaUser, shaTlsUser]) await db.query(`DROP USER IF EXISTS '${user}'@'%'`);
    });
  });

  test('mysql live: listTables reads the connection database catalogue', async () => {
    const tables = await listTables(myConn(nativeUser), { credentials: myCredentials });
    assert.deepEqual(tables.map(t => t.name).sort(), ['line items', 'sales']);
    const sales = tables.find(t => t.name === 'sales')!;
    assert.equal(sales.schema, myDb);
    assert.deepEqual(sales.columns.map(c => c.name), ['id', 'txn_date', 'amount', 'kind', 'customer', 'price', 'ratio', 'cents', 'placed_at']);
    assert.equal(sales.columns.find(c => c.name === 'amount')!.type, 'decimal');
    assert.equal(sales.columns.find(c => c.name === 'id')!.nullable, false);
  });

  test('mysql live: mysql_native_password sign-in; a period read is accepted with exact DECIMAL totals', async () => {
    const read = await plainDbRead(myConn(nativeUser), myMapping({ period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: myCredentials });
    assert.deepEqual(read.meta, { declaredRowCount: '5', declaredAmount: SEPT_TOTAL, declaredAmountUnit: 'major', declaredReference: 'database-aggregate' });
    assert.deepEqual(read.records.map(r => r.id), ['L-01', 'L-02', 'L-03', 'L-04', 'L-05']);
    assert.equal(read.records[3].amount, '1234567890123.45');
    const out = runRead(read);
    assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention));
    assert.equal(out.observed.total, SEPT_TOTAL_MINOR);
    const all = await plainDbImport(myConn(nativeUser), myMapping(), { credentials: myCredentials });
    assert.equal(all.status, 'accepted', JSON.stringify(all.refusal));
    assert.equal(all.records.length, 7);
    const minor = await plainDbImport(myConn(nativeUser), myMapping({ columns: { id: 'id', date: 'txn_date', amount: 'cents', kind: 'kind' }, moneyUnit: 'minor', period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: myCredentials });
    assert.equal(minor.status, 'accepted', JSON.stringify(minor.refusal));
    assert.equal(minor.observed.total, SEPT_TOTAL_MINOR);
    const dt = await plainDbRead(myConn(nativeUser), myMapping({ columns: { id: 'id', date: 'placed_at', amount: 'amount', kind: 'kind' }, dateFormat: 'ISO-DATETIME', period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: myCredentials });
    assert.equal(dt.meta.declaredRowCount, '5');
  });

  test('mysql live: DOUBLE and FLOAT amounts are refused', async () => {
    for (const column of ['price', 'ratio'])
      await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ columns: { id: 'id', date: 'txn_date', amount: column, kind: 'kind' } }), { credentials: myCredentials }), code('DB_FLOAT_AMOUNT'));
  });

  test('mysql live: writes are impossible inside the read-only snapshot, even for a user allowed to write', async () => {
    const attempts = [
      `INSERT INTO sales (id, txn_date) VALUES ('X-1', '2026-09-01')`,
      'UPDATE sales SET amount = 0',
      'DELETE FROM sales',
      'CREATE TABLE evil (x INT)',
    ];
    for (const sql of attempts)
      await assert.rejects(withMysqlSnapshot(myConn(nativeUser), { credentials: myCredentials }, 30_000, s => s.select({ text: sql, params: [] })), code('DB_WRITE_REFUSED'), sql);
    // Leaving the transaction does not help: the session itself is READ ONLY.
    await assert.rejects(withMysqlSnapshot(myConn(nativeUser), { credentials: myCredentials }, 30_000, async s => {
      await s.select({ text: 'COMMIT', params: [] });
      return s.select({ text: `INSERT INTO sales (id, txn_date) VALUES ('X-2', '2026-09-01')`, params: [] });
    }), code('DB_WRITE_REFUSED'));
    assert.equal(await myCount(), String(LIVE_ROWS.length));
  });

  test('mysql live: identifier injection is refused; another database is not readable through the mapping', async () => {
    const opts = { credentials: myCredentials };
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ table: { name: 'sales`; DROP TABLE sales; --' } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ table: { name: "sales' OR '1'='1" } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ columns: { id: 'id', date: 'txn_date', amount: 'amount) FROM mysql.user; --', kind: 'kind' } }), opts), code('DB_IDENTIFIER_INVALID'));
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ table: { schema: 'mysql', name: 'user' } }), opts), code('DB_TABLE_UNKNOWN'));
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping({ table: { name: 'no_such_table' } }), opts), code('DB_TABLE_UNKNOWN'));
    await assert.rejects(plainDbRead(myConn(nativeUser, { database: 'mysql' }), myMapping({ table: { name: 'user' } }), opts), code('DB_SYSTEM_TABLE'));
    await assert.rejects(listTables(myConn(nativeUser, { database: 'information_schema' }), opts), code('DB_SYSTEM_TABLE'));
    assert.equal(await myCount(), String(LIVE_ROWS.length));
  });

  test('mysql live: wrong password is a typed refusal that never echoes server text', async () => {
    await assert.rejects(plainDbRead(myConn(nativeUser), myMapping(), { credentials: async () => 'wrong-password' }), (e: any) => e.code === 'DB_AUTH_FAILED' && !e.message.includes(nativeUser));
  });

  test('mysql live: caching_sha2_password: full auth over plain TCP is refused, TLS full auth then plain fast auth succeed', async t => {
    if (mariadb) { t.skip(`${myVersion} has no caching_sha2_password`); return; }
    // A fresh account has no cache entry: the server asks for the password itself, which plain TCP never carries.
    await assert.rejects(plainDbRead(myConn(shaUser), myMapping(), { credentials: myCredentials }), code('MYSQL_FULL_AUTH_REQUIRES_TLS'));
    await assert.rejects(plainDbRead(myConn(shaUser), myMapping(), { credentials: myCredentials }), code('MYSQL_FULL_AUTH_REQUIRES_TLS'), 'still refused: a refusal does not fill the cache');
    if (env.CHAUSAR_TEST_MYSQL_TLS !== '1') {
      // Without a trusted certificate, TLS is refused rather than downgraded.
      await assert.rejects(plainDbRead(myConn(shaTlsUser, { ssl: 'require' }), myMapping(), { credentials: myCredentials }), code('DB_TLS_FAILED'));
      t.diagnostic('CHAUSAR_TEST_MYSQL_TLS is not 1: the full-auth-over-TLS and fast-auth cases were not run');
      return;
    }
    const tls = await plainDbImport(myConn(shaTlsUser, { ssl: 'require' }), myMapping({ period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: myCredentials });
    assert.equal(tls.status, 'accepted', JSON.stringify(tls.refusal));
    assert.equal(tls.observed.total, SEPT_TOTAL_MINOR);
    // The TLS sign-in filled the server's cache; plain TCP now uses the scrambled fast path only.
    const fast = await plainDbImport(myConn(shaTlsUser), myMapping({ period: { from: '2026-09-01', to: '2026-09-30' } }), { credentials: myCredentials });
    assert.equal(fast.status, 'accepted', JSON.stringify(fast.refusal));
    // A wrong password fails the fast path; the server then asks for full auth, which plain TCP still refuses.
    await assert.rejects(plainDbRead(myConn(shaTlsUser), myMapping(), { credentials: async () => 'wrong-password' }), code('MYSQL_FULL_AUTH_REQUIRES_TLS'));
    await assert.rejects(plainDbRead(myConn(shaTlsUser, { ssl: 'require' }), myMapping(), { credentials: async () => 'wrong-password' }), code('DB_AUTH_FAILED'));
  });

  test('mysql live: the server statement time limit stops a long read and the snapshot stays usable', async () => {
    const heavy = 'SELECT CAST(COUNT(*) AS CHAR) AS n FROM information_schema.COLUMNS a, information_schema.COLUMNS b, information_schema.COLUMNS c';
    const started = Date.now();
    const after = await withMysqlSnapshot(myConn(nativeUser), { credentials: myCredentials }, 1000, async s => {
      await assert.rejects(s.select({ text: heavy, params: [] }), code('DB_TIMEOUT'));
      assert.ok(Date.now() - started < 1900, 'the server limit fired before the client wait limit');
      return s.select({ text: `SELECT CAST(COUNT(*) AS CHAR) AS n FROM sales`, params: [] });
    });
    assert.deepEqual(after, [{ n: String(LIVE_ROWS.length) }], 'the server stopped the statement; the connection was not torn down');
  });
});

// ---------------------------------------------------------------- connection time limits (no server needed beyond loopback)

const liveSkip = pgSkip && mySkip ? 'connection time-limit tests run with the live suites (set CHAUSAR_TEST_PG_* or CHAUSAR_TEST_MYSQL_*)' : false;
test('live: a server that accepts but never greets is a timeout, not a hang', { skip: liveSkip }, async () => {
  const sockets: Socket[] = [];
  const server: Server = createServer(socket => { sockets.push(socket); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  try {
    let started = Date.now();
    await assert.rejects(plainDbRead({ engine: 'mysql', host: '127.0.0.1', port, database: 'x', user: 'u', ssl: 'disable', passwordRef: 'keychain:u' }, myMapping(), { credentials: async () => 'p', timeoutMs: 1000 }), code('DB_TIMEOUT'));
    assert.ok(Date.now() - started < 3000);
    started = Date.now();
    await assert.rejects(plainDbRead(pgConn({ port }), pgMapping(), { credentials: async () => 'p', timeoutMs: 1000 }), (e: any) => ['DB_TIMEOUT', 'DB_CONNECT_FAILED'].includes(e.code));
    assert.ok(Date.now() - started < 4000);
  } finally { for (const s of sockets) s.destroy(); server.close(); }
});
