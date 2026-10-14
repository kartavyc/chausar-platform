import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect as netConnect, type Server, type Socket } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { compileRecipe, runRecipe } from '../runtime/connectors-ext/recipe.ts';
import { DECODERS } from '../runtime/connectors-ext/recipes/index.ts';
import {
  plainDbRead, plainDbImport, listTables, openSqliteReadOnly, connectMysql, nativePasswordScramble, cachingSha2Scramble, lenencInt,
  type PlainDbMapping, type PgClientConfig, type PostgresConnectionConfig, type MysqlConnectionConfig, type SqliteConnectionConfig,
} from '../runtime/connectors-ext/plain-db/index.ts';

const WRITES = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COMMIT|COPY|REPLACE|MERGE|LOAD|ATTACH|VACUUM)\b/i;
const runRead = (read: Awaited<ReturnType<typeof plainDbRead>>) => runRecipe(compileRecipe(read.recipe, DECODERS), DECODERS.get('api-records')!, { records: read.records, meta: { ...read.meta } });
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, `${error?.code}: ${error?.message}`); return true; };

// ---------------------------------------------------------------- SQLite: real node:sqlite, read-only handle

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chausar-plain-db-')));
test.after(() => rmSync(dir, { recursive: true, force: true }));
function sqliteFile(name: string, rows: [string, string | null, number | null, string, string][], extra = ''): SqliteConnectionConfig {
  const path = join(dir, name), db = new DatabaseSync(path);
  db.exec(`CREATE TABLE sales (id TEXT PRIMARY KEY, txn_date TEXT, amount_minor INTEGER, kind TEXT, customer TEXT, price REAL, major_text TEXT); ${extra}`);
  const insert = db.prepare('INSERT INTO sales (id, txn_date, amount_minor, kind, customer, price, major_text) VALUES (?, ?, ?, ?, ?, 1.5, ?)');
  for (const [id, date, amount, kind, customer] of rows) insert.run(id, date, amount, kind, customer, amount === null ? null : (amount / 100).toFixed(2));
  db.close();
  return { engine: 'sqlite', path };
}
const sqliteRows: [string, string | null, number | null, string, string][] = [
  ['S-2', '2026-09-04', 25050, 'Sale', 'C-2'], ['S-1', '2026-09-03', 100000, 'Sale', 'C-1'], ['S-3', '2026-10-01', -10000, 'Sale Return', 'C-1'],
];
const sqliteMapping = (over: Partial<PlainDbMapping> = {}): PlainDbMapping => ({
  engine: 'sqlite', table: { name: 'sales' }, columns: { id: 'id', date: 'txn_date', amount: 'amount_minor', kind: 'kind', customerId: 'customer' },
  kindValues: { Sale: 'invoice', 'Sale Return': 'refund' }, currency: 'INR', measure: 'money', moneyUnit: 'minor', dateFormat: 'ISO', ...over,
});

test('sqlite: a period read is accepted against the database aggregate from the same snapshot', async () => {
  const conn = sqliteFile('ok.db', sqliteRows);
  const before = createHash('sha256').update(readFileSync(conn.path)).digest('hex');
  const read = await plainDbRead(conn, sqliteMapping({ period: { from: '2026-09-01', to: '2026-09-30' } }));
  assert.deepEqual(read.meta, { declaredRowCount: '2', declaredAmount: '125050', declaredAmountUnit: 'minor', declaredReference: 'database-aggregate' });
  assert.deepEqual(read.records.map(r => r.id), ['S-1', 'S-2'], 'ordered by id, period filter applied in the database');
  assert.equal(read.records[0].amount, '100000');
  const out = runRead(read);
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal ?? out.abstention));
  assert.equal(out.observed.total, '125050');
  assert.equal(out.sourceTotals?.reference, 'database-aggregate');
  assert.deepEqual(out.checks.filter(c => c.id.startsWith('source')).map(c => c.status), ['passed', 'passed']);
  assert.equal(out.records[0].fields.customerId, 'C-1');
  const all = await plainDbImport(conn, sqliteMapping());
  assert.equal(all.status, 'accepted');
  assert.equal(all.observed.total, '115050');
  assert.deepEqual(all.records.map(r => r.kind).sort(), ['invoice', 'invoice', 'refund']);
  const after = createHash('sha256').update(readFileSync(conn.path)).digest('hex');
  assert.equal(after, before, 'reading never changes the database file');
});

test('sqlite: major-unit decimal text and a constant kind', async () => {
  const conn = sqliteFile('major.db', sqliteRows);
  const out = await plainDbImport(conn, sqliteMapping({ columns: { id: 'id', date: 'txn_date', amount: 'major_text' }, kindValues: undefined, constantKind: 'invoice', moneyUnit: 'major' }));
  // SQLite sums decimal text as a float; here it prints exactly, and the exact row parse agrees with it.
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal));
  assert.equal(out.observed.total, '115050');
  const minor = await plainDbImport(conn, sqliteMapping({ columns: { id: 'id', date: 'txn_date', amount: 'amount_minor' }, kindValues: undefined, constantKind: 'invoice' }));
  assert.equal(minor.status, 'accepted');
});

test('sqlite: a NULL amount is refused as missing, never read as zero', async () => {
  const conn = sqliteFile('null.db', [...sqliteRows, ['S-4', '2026-09-05', null, 'Sale', 'C-3']]);
  const read = await plainDbRead(conn, sqliteMapping());
  assert.equal(read.records.find(r => r.id === 'S-4')!.amount, null);
  assert.equal(read.meta.declaredRowCount, '4');
  const out = runRead(read);
  assert.equal(out.status, 'refused');
  assert.equal(out.refusal?.code, 'MISSING_AMOUNT');
});

test('sqlite: unknown and injection-shaped identifiers are refused before any data query', async () => {
  const conn = sqliteFile('ident.db', sqliteRows);
  await assert.rejects(plainDbRead(conn, sqliteMapping({ table: { name: 'no_such_table' } })), code('DB_TABLE_UNKNOWN'));
  await assert.rejects(plainDbRead(conn, sqliteMapping({ columns: { id: 'id', date: 'txn_date', amount: 'missing_column', kind: 'kind' } })), code('DB_COLUMN_UNKNOWN'));
  await assert.rejects(plainDbRead(conn, sqliteMapping({ table: { name: 'sales"; DROP TABLE sales; --' } })), code('DB_IDENTIFIER_INVALID'));
  await assert.rejects(plainDbRead(conn, sqliteMapping({ columns: { id: 'id', date: 'txn_date', amount: 'amount_minor) FROM sales; --', kind: 'kind' } })), code('DB_IDENTIFIER_INVALID'));
  await assert.rejects(plainDbRead(conn, sqliteMapping({ table: { name: "sales' OR '1'='1" } })), code('DB_IDENTIFIER_INVALID'));
  await assert.rejects(plainDbRead(conn, { ...sqliteMapping(), sql: 'SELECT 1' }), code('PLAIN_DB_MAPPING_INVALID'));
  await assert.rejects(plainDbRead(conn, sqliteMapping({ columns: { id: 'id', date: 'txn_date', amount: 'price', kind: 'kind' } })), code('DB_FLOAT_AMOUNT'));
  const out = await plainDbImport(conn, sqliteMapping());
  assert.equal(out.records.length, 3, 'the table is untouched');
});

test('sqlite: more rows than the limit is refused from the COUNT, never truncated', async () => {
  const conn = sqliteFile('limit.db', sqliteRows);
  await assert.rejects(plainDbRead(conn, sqliteMapping(), { rowLimit: 2 }), code('DB_ROW_LIMIT'));
  const read = await plainDbRead(conn, sqliteMapping(), { rowLimit: 3 });
  assert.equal(read.records.length, 3);
});

test('sqlite: the connector handle cannot write, and paths must be absolute regular files', async () => {
  const conn = sqliteFile('ro.db', sqliteRows);
  const db = openSqliteReadOnly(conn);
  assert.throws(() => db.exec(`INSERT INTO sales (id) VALUES ('X')`), /readonly|read-only|query_only|attempt to write/i);
  assert.throws(() => db.exec('DELETE FROM sales'));
  assert.throws(() => db.exec('CREATE TABLE t (x)'));
  db.close();
  const link = join(dir, 'link.db'); symlinkSync(conn.path, link);
  await assert.rejects(plainDbRead({ engine: 'sqlite', path: link }, sqliteMapping()), code('DB_PATH_INVALID'));
  await assert.rejects(plainDbRead({ engine: 'sqlite', path: 'relative.db' }, sqliteMapping()), code('DB_PATH_INVALID'));
  await assert.rejects(plainDbRead({ engine: 'sqlite', path: join(dir, 'missing.db') }, sqliteMapping()), code('DB_PATH_INVALID'));
  await assert.rejects(plainDbRead({ engine: 'sqlite', path: dir }, sqliteMapping()), code('DB_PATH_INVALID'));
  await assert.rejects(plainDbRead(conn, { ...sqliteMapping(), engine: 'postgres' } as PlainDbMapping), code('DB_ENGINE_MISMATCH'));
});

test('sqlite: listTables reads tables and column types from the catalogue', async () => {
  const conn = sqliteFile('list.db', sqliteRows, 'CREATE TABLE "line items" (sku TEXT, qty INTEGER);');
  const tables = await listTables(conn);
  assert.deepEqual(tables.map(t => t.name), ['line items', 'sales']);
  const sales = tables.find(t => t.name === 'sales')!;
  assert.deepEqual(sales.columns.slice(0, 3), [{ name: 'id', type: 'TEXT', nullable: true }, { name: 'txn_date', type: 'TEXT', nullable: true }, { name: 'amount_minor', type: 'INTEGER', nullable: true }]);
  const count = await plainDbImport(conn, { engine: 'sqlite', table: { name: 'line items' }, columns: { id: 'sku', date: 'sku', quantity: 'qty' }, constantKind: 'stock', measure: 'count', moneyUnit: 'minor', dateFormat: 'ISO' });
  assert.equal(count.status, 'refused', 'an empty table is refused');
});

// ---------------------------------------------------------------- Postgres: injected fake pg client

type Canned = { aggregate?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; fail?: { at: RegExp; error: unknown } };
function fakePg(canned: Canned) {
  const log: { text: string; params: unknown[] }[] = []; const state = { config: null as PgClientConfig | null, ended: false, connected: false };
  const factory = (config: PgClientConfig) => {
    state.config = config;
    return {
      async connect() { state.connected = true; },
      async end() { state.ended = true; },
      async query(text: string, params: unknown[] = []) {
        log.push({ text, params });
        if (canned.fail && canned.fail.at.test(text)) throw canned.fail.error;
        if (/information_schema\.columns/.test(text)) return { rows: [
          { table_schema: 'public', table_name: 'sales', column_name: 'id', data_type: 'text', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'sales', column_name: 'invoice_date', data_type: 'date', is_nullable: 'NO' },
          { table_schema: 'public', table_name: 'sales', column_name: 'net_amount', data_type: 'numeric', is_nullable: 'YES' },
          { table_schema: 'public', table_name: 'sales', column_name: 'rate', data_type: 'double precision', is_nullable: 'YES' },
        ] };
        if (/^SELECT CAST\(COUNT\(\*\)/.test(text)) return { rows: canned.aggregate ?? [{ row_count: '2', measure_total: '1250.50' }] };
        if (/^SELECT CAST\("id"/.test(text)) return { rows: canned.rows ?? [{ id: 'P-1', date: '2026-09-03', amount: '1000.00' }, { id: 'P-2', date: '2026-09-04', amount: '250.50' }] };
        return { rows: [] };
      },
    };
  };
  return { factory, log, state };
}
const pgConn: PostgresConnectionConfig = { engine: 'postgres', host: 'db.example.internal', port: 5432, database: 'books', user: 'reader', ssl: 'require', passwordRef: 'keychain:pg-books' };
const pgMapping = (over: Partial<PlainDbMapping> = {}): PlainDbMapping => ({
  engine: 'postgres', table: { name: 'sales' }, columns: { id: 'id', date: 'invoice_date', amount: 'net_amount' }, constantKind: 'invoice', currency: 'INR',
  measure: 'money', moneyUnit: 'major', dateFormat: 'ISO', period: { from: '2026-09-01', to: '2026-09-30' }, ...over,
});
const credentials = async (ref: string) => { assert.equal(ref, 'keychain:pg-books'); return 'pg-password-from-keychain'; };

test('postgres: one READ ONLY repeatable-read snapshot, quoted identifiers, bound values, no writes', async () => {
  const pg = fakePg({});
  const read = await plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: pg.factory, rowLimit: 100 });
  const out = runRead(read);
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal));
  assert.equal(out.observed.total, '125050');
  const texts = pg.log.map(q => q.text);
  assert.equal(texts[0], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(texts[1], 'SET TRANSACTION READ ONLY');
  assert.match(texts[2], /^SET LOCAL statement_timeout = \d+$/);
  assert.equal(texts.at(-1), 'ROLLBACK');
  assert.ok(texts.every(t => !WRITES.test(t)), 'no statement writes or commits');
  const aggregate = pg.log.find(q => q.text.startsWith('SELECT CAST(COUNT(*)'))!;
  assert.equal(aggregate.text, 'SELECT CAST(COUNT(*) AS TEXT) AS "row_count", CAST(SUM("net_amount") AS TEXT) AS "measure_total" FROM "public"."sales" WHERE "invoice_date" >= $1 AND "invoice_date" <= $2');
  assert.deepEqual(aggregate.params, ['2026-09-01', '2026-09-30']);
  const rows = pg.log.find(q => q.text.startsWith('SELECT CAST("id"'))!;
  assert.equal(rows.text, 'SELECT CAST("id" AS TEXT) AS "id", CAST("invoice_date" AS TEXT) AS "date", CAST("net_amount" AS TEXT) AS "amount" FROM "public"."sales" WHERE "invoice_date" >= $1 AND "invoice_date" <= $2 ORDER BY "id" LIMIT $3');
  assert.deepEqual(rows.params, ['2026-09-01', '2026-09-30', 101]);
  assert.deepEqual(pg.log.find(q => /information_schema/.test(q.text))!.params, ['public', 'sales']);
  assert.equal(pg.state.config!.password, 'pg-password-from-keychain');
  assert.deepEqual(pg.state.config!.ssl, { rejectUnauthorized: true, servername: 'db.example.internal' });
  assert.match(pg.state.config!.options, /default_transaction_read_only=on/);
  assert.equal(pg.state.ended, true);
  assert.ok(!JSON.stringify(read).includes('pg-password-from-keychain'));
});

test('postgres: an aggregate that differs from the rows is refused', async () => {
  const total = runRead(await plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: fakePg({ aggregate: [{ row_count: '2', measure_total: '1250.51' }] }).factory }));
  assert.equal(total.refusal?.code, 'SOURCE_TOTAL_MISMATCH');
  const rows = runRead(await plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: fakePg({ aggregate: [{ row_count: '3', measure_total: '1250.50' }] }).factory }));
  assert.equal(rows.refusal?.code, 'SOURCE_ROW_MISMATCH');
  const nulls = runRead(await plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: fakePg({ rows: [{ id: 'P-1', date: '2026-09-03', amount: '1250.50' }, { id: 'P-2', date: '2026-09-04', amount: null }] }).factory }));
  assert.equal(nulls.refusal?.code, 'MISSING_AMOUNT');
});

test('postgres: the row limit is decided from the COUNT before rows are fetched', async () => {
  const pg = fakePg({ aggregate: [{ row_count: '50001', measure_total: '1' }] });
  await assert.rejects(plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: pg.factory }), code('DB_ROW_LIMIT'));
  assert.ok(!pg.log.some(q => q.text.startsWith('SELECT CAST("id"')), 'rows are never fetched and truncated');
  assert.equal(pg.log.at(-1)!.text, 'ROLLBACK');
});

test('postgres: settings, credentials and server errors are refused with fixed sentences', async () => {
  const pg = fakePg({});
  await assert.rejects(plainDbRead({ ...pgConn, ssl: 'disable' }, pgMapping(), { credentials, createPostgresClient: pg.factory }), code('DB_TLS_REQUIRED'));
  await plainDbRead({ ...pgConn, host: '127.0.0.1', ssl: 'disable' }, pgMapping(), { credentials, createPostgresClient: pg.factory });
  await assert.rejects(plainDbRead({ ...pgConn, password: 'inline' } as any, pgMapping(), { credentials, createPostgresClient: pg.factory }), code('DB_CONNECTION_INVALID'));
  await assert.rejects(plainDbRead(pgConn, pgMapping(), { createPostgresClient: pg.factory }), code('DB_CREDENTIAL_REQUIRED'));
  await assert.rejects(plainDbRead(pgConn, pgMapping({ columns: { id: 'id', date: 'invoice_date', amount: 'rate' } }), { credentials, createPostgresClient: pg.factory }), code('DB_FLOAT_AMOUNT'));
  await assert.rejects(plainDbRead(pgConn, pgMapping({ columns: { id: 'id', date: 'invoice_date', amount: 'gross' } }), { credentials, createPostgresClient: pg.factory }), code('DB_COLUMN_UNKNOWN'));
  const secret = 'permission denied for table secret_payroll_2026';
  await assert.rejects(plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: fakePg({ fail: { at: /^SELECT CAST\(COUNT/, error: Object.assign(new Error(secret), { code: '42501' }) } }).factory }),
    (error: any) => error.code === 'DB_PERMISSION_DENIED' && !error.message.includes('secret_payroll'));
  await assert.rejects(plainDbRead(pgConn, pgMapping(), { credentials, createPostgresClient: fakePg({ fail: { at: /^SELECT CAST\(COUNT/, error: Object.assign(new Error('cannot execute INSERT in a read-only transaction'), { code: '25006' }) } }).factory }), code('DB_WRITE_REFUSED'));
});

test('postgres: ISO-DATETIME and epoch periods bind exact half-open bounds', async () => {
  const pg = fakePg({ rows: [{ id: 'P-1', date: '2026-09-03 10:00:00+05:30', amount: '1000.00' }, { id: 'P-2', date: '2026-09-30 23:59:00+05:30', amount: '250.50' }] });
  const out = runRead(await plainDbRead(pgConn, pgMapping({ dateFormat: 'ISO-DATETIME' }), { credentials, createPostgresClient: pg.factory }));
  assert.equal(out.status, 'accepted', JSON.stringify(out.refusal));
  assert.deepEqual(pg.log.find(q => q.text.startsWith('SELECT CAST(COUNT'))!.params, ['2026-09-01', '2026-10-01']);
  await assert.rejects(plainDbRead(pgConn, pgMapping({ dateFormat: 'EPOCH-S-IST' }), { credentials, createPostgresClient: fakePg({}).factory }), code('DB_DATE_COLUMN_TYPE'));
  await assert.rejects(plainDbRead(pgConn, pgMapping({ period: { from: '2026-09-30', to: '2026-09-01' } }), { credentials, createPostgresClient: pg.factory }), code('PLAIN_DB_PERIOD_INVALID'));
});

// ---------------------------------------------------------------- MySQL: in-process fake server over loopback

const CAPS = 0x1 | 0x8 | 0x200 | 0x2000 | 0x8000 | 0x80000;
const frame = (seq: number, payload: Buffer) => { const h = Buffer.alloc(4); h.writeUIntLE(payload.length, 0, 3); h[3] = seq; return Buffer.concat([h, payload]); };
const lstr = (value: string | null) => value === null ? Buffer.from([0xfb]) : Buffer.concat([lenencInt(Buffer.byteLength(value)), Buffer.from(value)]);
const OK = Buffer.from([0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]);
const EOF = Buffer.from([0xfe, 0x00, 0x00, 0x02, 0x00]);
const ERR = (errno: number, message: string) => { const b = Buffer.alloc(3); b[0] = 0xff; b.writeUInt16LE(errno, 1); return Buffer.concat([b, Buffer.from('#42000' + message)]); };
type Reply = { ok: true } | { err: number; message: string } | { columns: string[]; rows: (string | null)[][] } | { raw: Buffer };
type FakeMysql = { port: number; queries: string[]; received: Buffer[]; quit: boolean; close(): Promise<void> };
async function fakeMysql(plugin: 'mysql_native_password' | 'caching_sha2_password', password: string, answer: (sql: string) => Reply, sha2: 'fast' | 'full' = 'fast'): Promise<FakeMysql> {
  const state: FakeMysql = { port: 0, queries: [], received: [], quit: false, close: async () => undefined };
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket: Socket) => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    const scramble = Buffer.from(randomBytes(20).map(b => (b % 94) + 33));
    const greeting = Buffer.alloc(0), caps = Buffer.alloc(2), capsHigh = Buffer.alloc(2), id = Buffer.alloc(4);
    caps.writeUInt16LE(CAPS & 0xffff); capsHigh.writeUInt16LE(CAPS >>> 16); id.writeUInt32LE(7);
    socket.write(frame(0, Buffer.concat([greeting, Buffer.from([10]), Buffer.from('8.0.99-fake\0'), id, scramble.subarray(0, 8), Buffer.from([0]), caps, Buffer.from([45, 2, 0]), capsHigh,
      Buffer.from([21]), Buffer.alloc(10), scramble.subarray(8), Buffer.from([0]), Buffer.from(plugin + '\0')])));
    let buffer = Buffer.alloc(0), phase: 'auth' | 'full-auth' | 'command' = 'auth';
    socket.on('data', chunk => {
      state.received.push(chunk);
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUIntLE(0, 3)) {
        const length = buffer.readUIntLE(0, 3), seq = buffer[3], payload = buffer.subarray(4, 4 + length); buffer = buffer.subarray(4 + length);
        if (phase === 'auth') {
          let at = 32; const userEnd = payload.indexOf(0, at); at = userEnd + 1;
          const authLength = payload[at]; const auth = payload.subarray(at + 1, at + 1 + authLength);
          const expected = plugin === 'mysql_native_password' ? nativePasswordScramble(password, scramble) : cachingSha2Scramble(password, scramble);
          if (!auth.equals(expected)) { socket.write(frame(seq + 1, ERR(1045, "Access denied for user 'reader'@'secret-host'"))); socket.end(); return; }
          if (plugin === 'caching_sha2_password' && sha2 === 'fast') { socket.write(frame(seq + 1, Buffer.from([0x01, 0x03]))); socket.write(frame(seq + 2, OK)); phase = 'command'; }
          else if (plugin === 'caching_sha2_password') { socket.write(frame(seq + 1, Buffer.from([0x01, 0x04]))); phase = 'full-auth'; }
          else { socket.write(frame(seq + 1, OK)); phase = 'command'; }
          continue;
        }
        if (phase === 'full-auth') { socket.write(frame(seq + 1, OK)); phase = 'command'; continue; }
        if (payload[0] === 0x01) { state.quit = true; socket.end(); return; }
        if (payload[0] !== 0x03) { socket.write(frame(1, ERR(1047, 'Unknown command'))); continue; }
        const sql = payload.subarray(1).toString('utf8'); state.queries.push(sql);
        const reply = answer(sql);
        if ('ok' in reply) socket.write(frame(1, OK));
        else if ('err' in reply) socket.write(frame(1, ERR(reply.err, reply.message)));
        else if ('raw' in reply) socket.write(reply.raw);
        else {
          let s = 1; const out = [frame(s++, lenencInt(reply.columns.length))];
          for (const name of reply.columns) out.push(frame(s++, Buffer.concat([lstr('def'), lstr('shop'), lstr('t'), lstr('t'), lstr(name), lstr(name), Buffer.from([0x0c, 45, 0]), Buffer.alloc(4), Buffer.from([0xfd, 0, 0, 0]), Buffer.alloc(2)])));
          out.push(frame(s++, EOF));
          for (const row of reply.rows) out.push(frame(s++, Buffer.concat(row.map(lstr))));
          out.push(frame(s++, EOF));
          socket.write(Buffer.concat(out));
        }
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  state.port = (server.address() as any).port;
  state.close = () => new Promise<void>(resolve => { server.close(() => resolve()); for (const socket of sockets) socket.destroy(); });
  return state;
}
const shopCatalogue = { columns: ['TABLE_NAME', 'COLUMN_NAME', 'DATA_TYPE', 'IS_NULLABLE'], rows: [['orders', 'order_no', 'varchar', 'NO'], ['orders', 'placed_on', 'date', 'NO'], ['orders', 'total', 'decimal', 'YES'], ['orders', 'kind', 'varchar', 'NO']] };
function shopAnswer(rows: (string | null)[][], aggregate: (string | null)[] = ['2', '1250.50']) {
  return (sql: string): Reply => {
    if (/information_schema\.COLUMNS/.test(sql)) return shopCatalogue;
    if (/^SELECT CAST\(COUNT/.test(sql)) return { columns: ['row_count', 'measure_total'], rows: [aggregate] };
    if (/^SELECT CAST\(`order_no`/.test(sql)) return { columns: ['id', 'date', 'amount', 'kind'], rows };
    return { ok: true };
  };
}
const shopRows: (string | null)[][] = [['O-1', '2026-09-03', '1000.00', 'order'], ['O-2', '2026-09-04', '250.50', 'order']];
const mysqlConn = (port: number): MysqlConnectionConfig => ({ engine: 'mysql', host: '127.0.0.1', port, database: 'shop', user: 'reader', ssl: 'disable', passwordRef: 'keychain:shop' });
const mysqlMapping: PlainDbMapping = { engine: 'mysql', table: { name: 'orders' }, columns: { id: 'order_no', date: 'placed_on', amount: 'total', kind: 'kind' }, kindValues: { order: 'invoice' },
  currency: 'INR', measure: 'money', moneyUnit: 'major', dateFormat: 'ISO', period: { from: '2026-09-01', to: '2026-09-30' } };
const mysqlCredentials = async () => 'shop-pass';

test('mysql: native-password sign-in, one READ ONLY consistent snapshot, quoted identifiers, checked literals', async () => {
  const server = await fakeMysql('mysql_native_password', 'shop-pass', shopAnswer(shopRows));
  try {
    let used = false;
    const read = await plainDbRead(mysqlConn(server.port), mysqlMapping, { credentials: mysqlCredentials, createMysqlSocket: target => { used = true; return netConnect(target); } });
    assert.ok(used, 'the injected socket factory is used');
    const out = runRead(read);
    assert.equal(out.status, 'accepted', JSON.stringify(out.refusal));
    assert.equal(out.observed.total, '125050');
    assert.ok(server.queries.includes('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT'));
    assert.ok(server.queries.indexOf('SET SESSION TRANSACTION READ ONLY') < server.queries.indexOf('START TRANSACTION READ ONLY, WITH CONSISTENT SNAPSHOT'));
    assert.equal(server.queries.at(-1), 'ROLLBACK');
    assert.ok(server.queries.every(q => !WRITES.test(q)));
    assert.ok(server.queries.includes("SELECT CAST(COUNT(*) AS CHAR) AS `row_count`, CAST(SUM(`total`) AS CHAR) AS `measure_total` FROM `orders` WHERE `placed_on` >= '2026-09-01' AND `placed_on` <= '2026-09-30'"));
    assert.ok(server.queries.includes("SELECT CAST(`order_no` AS CHAR) AS `id`, CAST(`placed_on` AS CHAR) AS `date`, CAST(`total` AS CHAR) AS `amount`, CAST(`kind` AS CHAR) AS `kind` FROM `orders` WHERE `placed_on` >= '2026-09-01' AND `placed_on` <= '2026-09-30' ORDER BY `order_no` LIMIT 50001"));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(server.quit, true, 'COM_QUIT is sent');
    assert.ok(!Buffer.concat(server.received).includes(Buffer.from('shop-pass')), 'the password never crosses the wire');
  } finally { await server.close(); }
});

test('mysql: aggregate mismatch, NULL amounts and row-limit overflow are refused', async () => {
  for (const [aggregate, rows, expected] of [
    [['2', '1250.00'], shopRows, 'SOURCE_TOTAL_MISMATCH'],
    [['3', '1250.50'], shopRows, 'SOURCE_ROW_MISMATCH'],
    [['2', '1000.00'], [shopRows[0], ['O-2', '2026-09-04', null, 'order']], 'MISSING_AMOUNT'],
  ] as const) {
    const server = await fakeMysql('mysql_native_password', 'shop-pass', shopAnswer(rows as any, aggregate as any));
    try { assert.equal(runRead(await plainDbRead(mysqlConn(server.port), mysqlMapping, { credentials: mysqlCredentials })).refusal?.code, expected); }
    finally { await server.close(); }
  }
  const server = await fakeMysql('mysql_native_password', 'shop-pass', shopAnswer(shopRows, ['9', '1']));
  try {
    await assert.rejects(plainDbRead(mysqlConn(server.port), mysqlMapping, { credentials: mysqlCredentials, rowLimit: 5 }), code('DB_ROW_LIMIT'));
    assert.ok(!server.queries.some(q => q.startsWith('SELECT CAST(`order_no`')));
  } finally { await server.close(); }
});

test('mysql: caching_sha2 fast auth works; full auth over plain TCP is refused without sending the password', async () => {
  const fast = await fakeMysql('caching_sha2_password', 'sha-pass', sql => sql === 'SELECT 1' ? { columns: ['1'], rows: [['1']] } : { ok: true });
  try {
    const db = await connectMysql({ host: '127.0.0.1', port: fast.port, user: 'reader', password: 'sha-pass', database: 'shop', ssl: 'disable', timeoutMs: 2000 });
    assert.deepEqual(await db.query('SELECT 1'), { columns: ['1'], rows: [['1']] });
    await db.close();
  } finally { await fast.close(); }
  const full = await fakeMysql('caching_sha2_password', 'sha-pass', () => ({ ok: true }), 'full');
  try {
    await assert.rejects(connectMysql({ host: '127.0.0.1', port: full.port, user: 'reader', password: 'sha-pass', database: 'shop', ssl: 'disable', timeoutMs: 2000 }), code('MYSQL_FULL_AUTH_REQUIRES_TLS'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(!Buffer.concat(full.received).includes(Buffer.from('sha-pass')), 'no clear-text password was sent');
  } finally { await full.close(); }
});

test('mysql: server errors map to typed codes and never echo server text', async () => {
  const wrong = await fakeMysql('mysql_native_password', 'right-pass', () => ({ ok: true }));
  try {
    await assert.rejects(plainDbRead(mysqlConn(wrong.port), mysqlMapping, { credentials: mysqlCredentials }), (e: any) => e.code === 'DB_AUTH_FAILED' && !/secret-host|reader/.test(e.message));
  } finally { await wrong.close(); }
  const denied = await fakeMysql('mysql_native_password', 'shop-pass', sql => /^SELECT CAST\(COUNT/.test(sql) ? { err: 1142, message: "SELECT command denied to user for table 'payroll_secret'" } : shopAnswer(shopRows)(sql));
  try {
    await assert.rejects(plainDbRead(mysqlConn(denied.port), mysqlMapping, { credentials: mysqlCredentials }), (e: any) => e.code === 'DB_PERMISSION_DENIED' && !e.message.includes('payroll'));
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(denied.queries.at(-1), 'ROLLBACK', 'the snapshot is rolled back after a server error');
  } finally { await denied.close(); }
  const infile = await fakeMysql('mysql_native_password', 'shop-pass', sql => sql === 'SELECT 1' ? { raw: frame(1, Buffer.concat([Buffer.from([0xfb]), Buffer.from('/etc/passwd')])) } : { ok: true });
  try {
    const db = await connectMysql({ host: '127.0.0.1', port: infile.port, user: 'reader', password: 'shop-pass', database: 'shop', ssl: 'disable', timeoutMs: 2000 });
    await assert.rejects(db.query('SELECT 1'), code('MYSQL_LOCAL_INFILE_REFUSED'));
    await db.close();
  } finally { await infile.close(); }
  const huge = await fakeMysql('mysql_native_password', 'shop-pass', sql => sql === 'SELECT 1' ? { raw: Buffer.from([0xff, 0xff, 0xff, 0x01]) } : { ok: true });
  try {
    const db = await connectMysql({ host: '127.0.0.1', port: huge.port, user: 'reader', password: 'shop-pass', database: 'shop', ssl: 'disable', timeoutMs: 2000 });
    await assert.rejects(db.query('SELECT 1'), code('MYSQL_PACKET_TOO_LARGE'));
  } finally { await huge.close(); }
  const silent = await fakeMysql('mysql_native_password', 'shop-pass', sql => sql === 'SELECT 1' ? { raw: Buffer.alloc(0) } : { ok: true });
  try {
    const db = await connectMysql({ host: '127.0.0.1', port: silent.port, user: 'reader', password: 'shop-pass', database: 'shop', ssl: 'disable', timeoutMs: 1000 });
    await assert.rejects(db.query('SELECT 1'), code('DB_TIMEOUT'));
  } finally { await silent.close(); }
});

test('mysql: TLS is required off this machine, and identifiers are checked before any connection', async () => {
  await assert.rejects(plainDbRead({ ...mysqlConn(3306), host: 'shop.example.internal' }, mysqlMapping, { credentials: mysqlCredentials }), code('DB_TLS_REQUIRED'));
  await assert.rejects(plainDbRead(mysqlConn(3306), { ...mysqlMapping, table: { name: 'orders`; DROP TABLE orders; --' } }, { credentials: mysqlCredentials }), code('DB_IDENTIFIER_INVALID'));
  await assert.rejects(plainDbRead(mysqlConn(3306), { ...mysqlMapping, table: { schema: 'other', name: 'orders' } }, { credentials: mysqlCredentials }), code('DB_TABLE_UNKNOWN'));
});
