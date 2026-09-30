import test from 'node:test';
import assert from 'node:assert/strict';
import { PostgresDatabaseCalculator, type PostgresAnalyticalPool } from '../runtime/postgres-analytics.ts';
import { PostgresSnapshotAdapter, type PostgresPool } from '../runtime/postgres.ts';
import { DatabaseCalculator } from '../runtime/analytics.ts';
import { databaseFixtures, prepareDatabaseFixture, fixtureOwner } from './database-fixtures.ts';

function poolFixture(answer: Record<string, unknown>, options: { fail?: boolean; hang?: boolean; initializationFail?: boolean; hangBegin?: boolean; hangRollback?: boolean } = {}) {
  const calls: { sql: string; values: unknown[] }[] = []; const releases: (Error | undefined)[] = []; let ended = false; let connected = 0;
  const client = {
    async query(sql: string, values: unknown[] = []) {
      calls.push({ sql, values });
      if (sql === 'BEGIN' && options.initializationFail) throw new Error('injected begin failure');
      if ((sql === 'BEGIN' && options.hangBegin) || (sql === 'ROLLBACK' && options.hangRollback)) return await new Promise<never>(() => {});
      if (sql.startsWith('WITH ')) {
        if (options.hang) return await new Promise<never>(() => {});
        if (options.fail) throw Object.assign(new Error('injected statement deadline'), { code: '57014' });
        return { rows: [answer] };
      }
      return { rows: [] };
    },
    release(error?: Error) { releases.push(error); },
  };
  const pool: PostgresAnalyticalPool = { async connect() { connected++; return client; }, async end() { ended = true; } };
  return { pool, client, calls, releases, connected: () => connected, ended: () => ended };
}
async function input(id: string) {
  const fixture = databaseFixtures.find(f => f.id === id)!;
  assert.ok(fixture, id);
  const { calculator } = await prepareDatabaseFixture(fixture);
  return { fixture, receipt: await calculator.calculate(fixtureOwner, fixture.request) };
}

test('injected PostgreSQL adapter compiles exact registered SQL for every successful answer-key fixture without a native engine claim', async () => {
  for (const fixture of databaseFixtures.filter(f => f.expected)) {
    const { calculator } = await prepareDatabaseFixture(fixture);
    const receipt = await calculator.calculate(fixtureOwner, fixture.request);
    const answer = { ...fixture.expected!.figures } as Record<string, unknown>;
    if (fixture.request.operation === 'margin' && !Object.hasOwn(answer, 'marginBps')) answer.marginBps = null;
    if (fixture.request.operation === 'change' && !Object.hasOwn(answer, 'changeBps')) answer.changeBps = null;
    const mock = poolFixture(answer); const database = PostgresDatabaseCalculator.fromPool(mock.pool);
    const proof = await database.verify(receipt);
    assert.equal(proof.engine, 'injected-sql', fixture.id);
    assert.equal(mock.calls[0].sql, 'BEGIN');
    assert.equal(mock.calls[1].sql, 'SET LOCAL search_path TO pg_temp');
    assert.deepEqual(mock.calls[2].values, ['15000']);
    assert.equal(mock.calls.filter(call => call.sql.startsWith('CREATE TEMP TABLE')).length, 2);
    assert.ok(mock.calls.filter(call => call.sql.startsWith('CREATE TEMP TABLE')).every(call => call.sql.endsWith('ON COMMIT DROP')));
    const query = mock.calls.find(call => call.sql.startsWith('WITH '))!;
    assert.ok(!query.sql.includes('//') && !query.sql.includes('HUGEINT') && !query.sql.includes('date_diff('), fixture.id);
    if (['margin','change','scenario'].includes(fixture.request.operation)) assert.ok(query.sql.includes('div('), fixture.id);
    if (fixture.request.operation === 'aging') assert.ok(query.sql.includes('NOT EXISTS'), 'Unmatched credits must be included independently of invoice balances.');
    assert.equal(mock.calls.at(-1)!.sql, 'ROLLBACK');
    assert.deepEqual(mock.releases, [undefined]);
    await database.close(); assert.equal(mock.ended(), false, 'Injected pools remain caller-owned.');
    await assert.rejects(database.verify(receipt), { code: 'POSTGRES_CLOSED' });
  }
});

test('PostgreSQL injected mismatch and server timeout roll back; a parent timeout discards the active client', async () => {
  const successful = databaseFixtures.find(f => f.expected && f.request.operation === 'earned' && f.facts.length > 0)!;
  const { receipt } = await input(successful.id);
  for (const mode of [{ fail: false }, { fail: true }]) {
    const mock = poolFixture({ total: '999999' }, mode);
    await assert.rejects(PostgresDatabaseCalculator.fromPool(mock.pool).verify(receipt), { code: mode.fail ? 'SQL_TIMEOUT' : 'SQL_RESULT_MISMATCH' });
    assert.equal(mock.calls.at(-1)!.sql, 'ROLLBACK'); assert.equal(mock.releases.length, 1);
  }
  const timed = poolFixture({}, { hang: true });
  await assert.rejects(PostgresDatabaseCalculator.fromPool(timed.pool, { operationTimeoutMs: 50 }).verify(receipt), { code: 'SQL_TIMEOUT' });
  assert.equal(timed.releases.length, 1); assert.ok(timed.releases[0] instanceof Error);
  const broken = poolFixture({}, { initializationFail: true });
  await assert.rejects(PostgresDatabaseCalculator.fromPool(broken.pool).verify(receipt), /injected begin failure/);
  assert.equal(broken.calls.at(-1)!.sql, 'BEGIN'); assert.equal(broken.releases.length, 1); assert.ok(broken.releases[0] instanceof Error);
});

test('the PostgreSQL deadline covers pool acquisition, BEGIN and rollback; late clients are discarded', { timeout: 1500 }, async () => {
  const successful = databaseFixtures.find(f => f.expected && f.request.operation === 'earned' && f.facts.length > 0)!;
  const { receipt } = await input(successful.id);
  for (const mode of [{ hangBegin: true }, { hangRollback: true }]) {
    const mock = poolFixture(successful.expected!.figures, mode);
    await assert.rejects(PostgresDatabaseCalculator.fromPool(mock.pool, { operationTimeoutMs: 50 }).verify(receipt), { code: 'SQL_TIMEOUT' });
    assert.equal(mock.releases.length, 1); assert.ok(mock.releases[0] instanceof Error);
  }
  const late = poolFixture(successful.expected!.figures);
  let arrive!: (client: typeof late.client) => void;
  const pool: PostgresAnalyticalPool = { connect: () => new Promise(resolve => { arrive = resolve; }), async end() {} };
  await assert.rejects(PostgresDatabaseCalculator.fromPool(pool, { operationTimeoutMs: 50 }).verify(receipt), { code:'SQL_TIMEOUT' });
  arrive(late.client); await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.calls.length, 0, 'A late client cannot start a transaction.');
  assert.equal(late.releases.length, 1); assert.ok(late.releases[0] instanceof Error);
});

test('PostgreSQL malformed projections and connection configuration refuse before an engine opens', async () => {
  const successful = databaseFixtures.find(f => f.expected && f.request.operation === 'earned' && f.facts.length > 0)!;
  const { receipt } = await input(successful.id); const mock = poolFixture({});
  const database = PostgresDatabaseCalculator.fromPool(mock.pool);
  const bad = structuredClone(receipt); bad.rows[0].amountMinor = '1.5';
  await assert.rejects(database.verify(bad), { code: 'SQL_PROJECTION_INVALID' }); assert.equal(mock.connected(), 0);
  await assert.rejects(PostgresDatabaseCalculator.connect({ host: 'remote.invalid', port: 5432, user: 'fixture', database: 'chausar_test', password: 'fixture' } as any), { code: 'INVALID_POSTGRES_CONFIG' });
  await assert.rejects(PostgresDatabaseCalculator.connect({ host: '127.0.0.1', port: 5432, user: 'fixture', database: 'chausar_test', password: 'fixture', maxConnections: 0 }), { code: 'INVALID_POSTGRES_CONFIG' });
  assert.throws(() => new DatabaseCalculator({ sqlDialect: 'postgres' }), { code: 'SQL_DIALECT_UNSUPPORTED' });
});

test('PostgreSQL authority refuses unchanged, regressing, skipped and unsafe revisions before issuing a transaction', async () => {
  let connected = 0;
  const pool: PostgresPool = { async query() { return { rows: [] }; }, async connect() { connected++; throw new Error('must not connect'); }, async end() {} };
  const adapter = await PostgresSnapshotAdapter.fromPool(pool, 'fixture-cas');
  for (const [revision, expected] of [[9,9],[8,9],[11,9],[-1,null],[Number.MAX_SAFE_INTEGER + 1,null],[10,NaN]]) await assert.rejects(adapter.commit({ revision } as any, expected), { code: 'INVALID_REVISION' });
  assert.equal(connected, 0);
});

test('PostgreSQL authority rejects revisions beyond JavaScript precision and pins the public authority table', async () => {
  const calls: string[] = [];
  const pool: PostgresPool = {
    async query(sql) { calls.push(sql); return sql.startsWith('SELECT') ? { rows: [{ revision: '9007199254740993', envelope: { revision: 9007199254740992 } }] } : { rows: [] }; },
    async connect() { throw new Error('must not connect'); }, async end() {},
  };
  const adapter = await PostgresSnapshotAdapter.fromPool(pool, 'fixture-load');
  await assert.rejects(adapter.load(), { code: 'CORRUPT_VAULT' });
  assert.ok(calls.every(sql => sql.includes('public.chausar_vault_authority')));
});
