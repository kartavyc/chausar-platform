import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseFixtures, fixtureOwner, assertFixtureReceipt, prepareDatabaseFixture, hugeDecimalImport, exactCurrencyImport } from './database-fixtures.ts';
import { disposablePostgresConfiguration, assertPristinePostgres } from '../../scripts/verify-database-differential.mjs';
import { ImportService } from '../runtime/ingest.ts';

for (const fixture of databaseFixtures) {
  test(`independent JavaScript answer key: ${fixture.id}`, async () => {
    const { calculator } = await prepareDatabaseFixture(fixture);
    if (fixture.rejectCode) await assert.rejects(calculator.calculate(fixtureOwner, fixture.request), { code: fixture.rejectCode });
    else assertFixtureReceipt(fixture, await calculator.calculate(fixtureOwner, fixture.request));
  });
}

test('exact decimal import reconciles the independent source total and repeated batch adds no claim', async () => {
  const fixture = databaseFixtures.find(value => value.id === 'empty-selection-is-a-coverage-gap')!;
  const { store, calculator } = await prepareDatabaseFixture(fixture);
  const imports = new ImportService(store), input = hugeDecimalImport();
  const original = await imports.commit(fixtureOwner, input), before = store.read();
  const repeated = await imports.commit(fixtureOwner, structuredClone(input));
  assert.equal(repeated.duplicate, true); assert.equal(repeated.id, original.id);
  assert.deepEqual(store.read().facts, before.facts); assert.deepEqual(store.read().imports, before.imports);
  assert.equal((await calculator.calculate(fixtureOwner, fixture.request)).totalMinor, '900719925474099400');
});

test('explicit exact currency conversion preserves source and rate in receipt lineage', async () => {
  const fixture = databaseFixtures.find(value => value.id === 'empty-selection-is-a-coverage-gap')!;
  const { store, calculator } = await prepareDatabaseFixture(fixture);
  await new ImportService(store).commit(fixtureOwner, exactCurrencyImport());
  const receipt = await calculator.calculate(fixtureOwner, { ...fixture.request, branch: 'west' });
  assert.equal(receipt.totalMinor, '85075');
  assert.deepEqual(receipt.rows[0].normalization, { sourceCurrency: 'USD', targetCurrency: 'INR', rate: { numerator: '83', denominator: '1', rounding: 'exact' } });
});

const validUrl = 'postgresql://fixture:independent-password@127.0.0.1:15432/chausar_test';
const configuration = (url = validUrl, disposable = '1') => ({ CHAUSAR_TEST_DATABASE_DISPOSABLE: disposable, CHAUSAR_TEST_DATABASE_URL: url });

test('disposable database acknowledgement is exact and mandatory before URL access', () => {
  for (const value of [undefined, '', '0', 'true', 'yes']) {
    assert.throws(() => disposablePostgresConfiguration({ CHAUSAR_TEST_DATABASE_URL: validUrl, CHAUSAR_TEST_DATABASE_DISPOSABLE: value }), { code: 'DISPOSABLE_DATABASE_REQUIRED' });
  }
  assert.throws(() => disposablePostgresConfiguration({ get CHAUSAR_TEST_DATABASE_URL() { throw Error('URL must not be accessed'); } }), { code: 'DISPOSABLE_DATABASE_REQUIRED' });
});

test('literal loopback hosts, dedicated database and explicit port boundaries', () => {
  for (const host of ['localhost', '127.0.0.2', 'example.com', '127.0.0.1.example.com', '[::2]', '127.1', '2130706433', '0177.0.0.1', '0x7f000001', '127.000.000.001', '%31%32%37.0.0.1', '[0:0:0:0:0:0:0:1]']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace('127.0.0.1', host))), { code: 'NON_LOOPBACK_DATABASE_REFUSED' });
  }
  for (const database of ['postgres', 'chausar', '', 'chausar_test/other', '%63hausar_test']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace('chausar_test', database))), { code: 'WRONG_TEST_DATABASE' });
  }
  for (const port of ['', '0', '1023']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace(':15432', port ? `:${port}` : ''))), { code: 'EXPLICIT_TEST_DATABASE_PORT_REQUIRED' });
  }
  for (const port of ['65536', '15.5', 'abc']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace(':15432', `:${port}`))), { code: 'INVALID_TEST_DATABASE_URL' });
  }
  for (const host of ['127.0.0.1', '[::1]']) for (const port of [1024, 65535]) {
    const parsed = disposablePostgresConfiguration(configuration(validUrl.replace('127.0.0.1', host).replace('15432', String(port))));
    assert.equal(parsed.host, host === '[::1]' ? '::1' : host); assert.equal(parsed.port, port);
  }
});

test('driver query options, fragments and even empty URL delimiters are refused', () => {
  for (const suffix of ['?', '#', '?sslmode=disable', '#ignored', '?host=remote.example']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl + suffix)), { code: 'INVALID_TEST_DATABASE_URL' });
  }
  assert.throws(() => disposablePostgresConfiguration(configuration(` ${validUrl}`)), { code: 'INVALID_TEST_DATABASE_URL' });
  assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace('postgresql:', 'postgres:'))), { code: 'INVALID_TEST_DATABASE_PROTOCOL' });
  assert.throws(() => disposablePostgresConfiguration(configuration('not a URL')), { code: 'INVALID_TEST_DATABASE_URL' });
});

test('explicit credentials are decoded as data and never echoed by refusal messages', () => {
  for (const authentication of ['', 'fixture', ':password', 'fixture:']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace('fixture:independent-password', authentication))), { code: 'EXPLICIT_TEST_DATABASE_CREDENTIALS_REQUIRED' });
  }
  for (const authentication of ['fixture:%00password', 'fixture:%0Apassword', 'fixture:%ZZ']) {
    assert.throws(() => disposablePostgresConfiguration(configuration(validUrl.replace('fixture:independent-password', authentication))));
  }
  const parsed = disposablePostgresConfiguration(configuration(validUrl.replace('independent-password', 'encoded%3F%23password')));
  assert.equal(parsed.password, 'encoded?#password');
  const secret = 'never-print-this-password';
  try { disposablePostgresConfiguration(configuration(validUrl.replace('independent-password', secret) + '?unsafe=1')); assert.fail('Expected refusal'); }
  catch (error: any) { assert.ok(!error.message.includes(secret)); }
});

// These managed-pool protocol mocks establish the safety preflight only. They
// execute no PostgreSQL and cannot be counted as native engine qualification.
test('preflight checks actual database identity before any relation check', async () => {
  const calls: string[] = [];
  const pool = { async query(sql: string) { calls.push(sql); return { rows: [{ database: 'postgres', search_path: 'public' }] }; } };
  await assert.rejects(assertPristinePostgres(pool), { code: 'DATABASE_IDENTITY_MISMATCH' });
  assert.equal(calls.length, 1); assert.ok(calls.every(sql => !/CREATE|INSERT|DELETE|DROP/i.test(sql)));
});

test('preflight refuses unknown search paths before any adapter initialization', async () => {
  for (const search_path of ['$user, public', 'private', 'public, private', 'pg_temp, public', undefined]) {
    let calls = 0;
    await assert.rejects(assertPristinePostgres({ async query() { calls++; return { rows: [{ database: 'chausar_test', search_path }] }; } }), { code: 'UNSAFE_TEST_SEARCH_PATH' });
    assert.equal(calls, 1);
  }
});

test('preflight counts every public relation and refuses nonempty or malformed replies', async () => {
  for (const count of ['1', '9', '01', '-1', undefined, 0]) {
    const calls: string[] = [];
    await assert.rejects(assertPristinePostgres({ async query(sql: string) {
      calls.push(sql);
      return calls.length === 1 ? { rows: [{ database: 'chausar_test', search_path: 'public' }] } : { rows: [{ count }] };
    } }), { code: 'POPULATED_DATABASE_REFUSED' });
    assert.equal(calls.length, 2); assert.match(calls[1], /pg_catalog\.pg_class/); assert.match(calls[1], /pg_catalog\.pg_namespace/);
    assert.ok(!/relkind\s*=|information_schema\.tables|CREATE|DELETE|DROP/i.test(calls[1]));
  }
});

test('preflight accepts only exact pristine replies and fails closed on read errors', async () => {
  let calls = 0;
  await assertPristinePostgres({ async query() { return ++calls === 1 ? { rows: [{ database: 'chausar_test', search_path: 'public' }] } : { rows: [{ count: '0' }] }; } });
  assert.equal(calls, 2);
  const failure = Object.assign(new Error('Harmless fixture read failure'), { code: 'FIXTURE_READ_FAILED' });
  await assert.rejects(assertPristinePostgres({ async query() { throw failure; } }), failure);
  await assert.rejects(assertPristinePostgres({ async query() { return { rows: [] }; } }), { code: 'DATABASE_IDENTITY_MISMATCH' });
});
