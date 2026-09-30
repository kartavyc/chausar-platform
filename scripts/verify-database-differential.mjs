import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseCalculator } from '../platform/runtime/analytics.ts';
import { PostgresDatabaseCalculator } from '../platform/runtime/postgres-analytics.ts';
import { PostgresSnapshotAdapter } from '../platform/runtime/postgres.ts';
import { Vault } from '../platform/runtime/vault.ts';
import { CalculatorService } from '../platform/runtime/calculator.ts';
import { MemoryService } from '../platform/runtime/memory.ts';
import { OntologyService } from '../platform/runtime/ontology.ts';
import { ImportService } from '../platform/runtime/ingest.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { databaseFixtures, fixtureOwner, fixturePeriod, assertFixtureReceipt, prepareDatabaseFixture, hugeDecimalImport, exactCurrencyImport } from '../platform/tests/database-fixtures.ts';

export class QualificationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function requireCondition(condition, code, message) { if (!condition) throw new QualificationError(code, message); }

/** Parse explicit fixture credentials without connecting, discovering defaults,
 * printing their values, or accepting driver URL options. */
export function disposablePostgresConfiguration(environment) {
  requireCondition(environment.CHAUSAR_TEST_DATABASE_DISPOSABLE === '1', 'DISPOSABLE_DATABASE_REQUIRED', 'Explicitly acknowledge a fresh disposable local database.');
  const value = environment.CHAUSAR_TEST_DATABASE_URL;
  requireCondition(typeof value === 'string' && value.length > 0 && value === value.trim() && !/[?#]/.test(value), 'INVALID_TEST_DATABASE_URL', 'Supply an explicit PostgreSQL URL with no query or fragment delimiters.');
  let url;
  try { url = new URL(value); } catch { throw new QualificationError('INVALID_TEST_DATABASE_URL', 'The explicit test database URL is invalid.'); }
  requireCondition(url.protocol === 'postgresql:', 'INVALID_TEST_DATABASE_PROTOCOL', 'Use the postgresql protocol.');
  const authority = value.slice(value.indexOf('://') + 3).split('/')[0];
  const literalHostPort = authority.slice(authority.lastIndexOf('@') + 1);
  requireCondition(['127.0.0.1', '[::1]'].includes(url.hostname) && /^(?:127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(literalHostPort), 'NON_LOOPBACK_DATABASE_REFUSED', 'Only literal loopback test database hosts are accepted.');
  requireCondition(url.pathname === '/chausar_test', 'WRONG_TEST_DATABASE', 'Only the dedicated chausar_test database is accepted.');
  requireCondition(/^\d+$/.test(url.port) && Number(url.port) >= 1024 && Number(url.port) <= 65535, 'EXPLICIT_TEST_DATABASE_PORT_REQUIRED', 'Use an explicit unprivileged test database port.');
  let user, password;
  try { user = decodeURIComponent(url.username); password = decodeURIComponent(url.password); } catch { throw new QualificationError('INVALID_TEST_DATABASE_CREDENTIALS', 'Fixture credentials must have valid URL encoding.'); }
  requireCondition(user && password && !/[\u0000\r\n]/.test(user + password), 'EXPLICIT_TEST_DATABASE_CREDENTIALS_REQUIRED', 'Explicit nonempty fixture credentials are required.');
  return { host: url.hostname === '[::1]' ? '::1' : '127.0.0.1', port: Number(url.port), user, password, database: 'chausar_test' };
}

/** Harmless read-only checks must complete before the authority adapter creates
 * a table. A mock pool can test this protocol but is never engine evidence. */
export async function assertPristinePostgres(pool) {
  const identity = await pool.query("SELECT current_database() AS database, current_setting('search_path') AS search_path");
  requireCondition(identity.rows?.length === 1 && identity.rows[0].database === 'chausar_test', 'DATABASE_IDENTITY_MISMATCH', 'The server did not identify the dedicated fixture database.');
  requireCondition(identity.rows[0].search_path === 'public', 'UNSAFE_TEST_SEARCH_PATH', 'The fixture pool must pin its search path to public.');
  const relations = await pool.query("SELECT count(*)::text AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'");
  requireCondition(relations.rows?.length === 1 && relations.rows[0].count === '0', 'POPULATED_DATABASE_REFUSED', 'The dedicated database must have no public relations, including views, sequences or indexes.');
}

const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'DATABASE_QUALIFICATION_FAILED';

export async function runDatabaseDifferential(environment = process.env) {
  const report = { suite: 'native-postgresql-duckdb-differential', passed: false, checks: [], blockers: [], engines: { duckdb: 'not-executed', postgres: 'not-executed' }, scope: 'Independent hand-worked JavaScript, native DuckDB and native PostgreSQL arithmetic; PostgreSQL encrypted Vault composition. No PGlite qualification or default-engine choice.' };
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  const failed = (name, error) => report.checks.push({ name, passed: false, reason: safeCode(error) });
  const receipts = [];
  let pool, postgres, vault, directory;
  const ownedSlots = new Set();
  let authorityInitialized = false;
  const duckdb = new DatabaseCalculator();
  let duckdbReady = false, postgresReady = false;
  try {
    for (const fixture of databaseFixtures) {
      try {
        const { calculator } = await prepareDatabaseFixture(fixture);
        if (fixture.rejectCode) {
          await assert.rejects(calculator.calculate(fixtureOwner, fixture.request), { code: fixture.rejectCode });
          record(fixture.id, 'javascript-contract-refusal', { reason: fixture.rejectCode });
        } else {
          const receipt = await calculator.calculate(fixtureOwner, fixture.request);
          assertFixtureReceipt(fixture, receipt); receipts.push({ fixture, receipt });
          record(fixture.id, 'javascript-independent-answer-key');
        }
      } catch (error) { failed(fixture.id, error); }
    }
    requireCondition(receipts.length > 0, 'NO_VALID_FIXTURE_RECEIPTS', 'No independently checked receipt was available for native qualification.');
    const smoke = receipts[0].receipt;
    try {
      const proof = await duckdb.verify(smoke);
      assert.equal(proof.engine, 'duckdb'); assert.equal(proof.verified, true);
      duckdbReady = true; report.engines.duckdb = 'native-executed';
      record('duckdb-native-smoke', 'native-duckdb');
    } catch (error) { report.blockers.push({ engine: 'duckdb', reason: safeCode(error) }); }

    let config;
    try { config = disposablePostgresConfiguration(environment); }
    catch (error) { report.blockers.push({ engine: 'postgres', reason: safeCode(error) }); }
    if (config) {
      try {
        const pg = await import('pg'); const Pool = pg.Pool ?? pg.default?.Pool;
        pool = new Pool({ ...config, max: 3, connectionTimeoutMillis: 3000, query_timeout: 17000, application_name: 'chausar-native-disposable-differential', ssl: false, options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
        await assertPristinePostgres(pool);
        const version = await pool.query('SHOW server_version');
        record('dedicated-postgresql-identity-empty-public-and-search-path', 'native-postgresql', { serverVersion: version.rows[0].server_version });
        postgres = await PostgresDatabaseCalculator.connect({ ...config, maxConnections: 2, operationTimeoutMs: 15000 });
        const proof = await postgres.verify(smoke);
        assert.equal(proof.engine, 'postgres'); assert.equal(proof.verified, true);
        postgresReady = true; report.engines.postgres = 'native-executed';
        record('postgres-native-smoke', 'native-postgresql');
      } catch (error) { report.blockers.push({ engine: 'postgres', reason: error?.code === 'ERR_MODULE_NOT_FOUND' ? 'POSTGRES_DRIVER_UNAVAILABLE' : safeCode(error) }); }
    }

    const engines = [...(duckdbReady ? [['duckdb', duckdb]] : []), ...(postgresReady ? [['postgres', postgres]] : [])];
    for (const { fixture, receipt } of receipts) {
      for (const [engine, calculator] of engines) {
        try {
          const proof = await calculator.verify(structuredClone(receipt));
          assert.equal(proof.engine, engine); assert.equal(proof.verified, true); assert.equal(proof.receiptId, receipt.id);
          record(`${engine}:${fixture.id}`, `native-${engine}`, { projectionDigest: proof.projectionDigest });
        } catch (error) { failed(`${engine}:${fixture.id}`, error); }
      }
    }

    // The invalid-receipt probes are checked by each production verifier. A
    // refusal before SQL is labelled projection validation, not native math.
    for (const [engine, calculator] of engines) {
      const agingReceipt = structuredClone(receipts.find(value => value.fixture.id === 'shop-aging').receipt);
      const invoice = agingReceipt.rows.find(row => row.kind === 'invoice');
      const duplicate = { ...invoice, factId: 'qualification-duplicate-invoice', entityId: 'different-logical-invoice' };
      agingReceipt.rows.push(duplicate); agingReceipt.rowIds.push(duplicate.factId);
      try { await assert.rejects(calculator.verify(agingReceipt), { code: 'SQL_AMBIGUOUS_INVOICE' }); record(`${engine}:duplicate-invoice-projection-refused`, 'production-projection-validation'); }
      catch (error) { failed(`${engine}:duplicate-invoice-projection-refused`, error); }
      const tampered = structuredClone(smoke);
      tampered.figures[0].minor = String(BigInt(tampered.figures[0].minor) + 1n);
      try { await assert.rejects(calculator.verify(tampered), { code: 'SQL_RESULT_MISMATCH' }); record(`${engine}:tampered-answer-refused`, `native-${engine}`); }
      catch (error) { failed(`${engine}:tampered-answer-refused`, error); }
    }

    if (duckdbReady && postgresReady) {
      try {
        directory = await mkdtemp(join(tmpdir(), 'chausar-differential-'));
        const runId = `differential-${randomUUID()}`;
        const slot = `${runId}-main`; ownedSlots.add(slot);
        const adapter = await PostgresSnapshotAdapter.fromPool(pool, slot); authorityInitialized = true;
        const passphrase = 'Disposable independent fixture passphrase 2026';
        const marker = 'plaintext-canary-native-composition';
        vault = (await Vault.create({ directory: join(directory, 'main'), storage: adapter, name: marker, passphrase, demo: true })).vault;
        await new OntologyService(vault).publish(fixtureOwner, 'ecommerce');
        const verifier = async receipt => {
          const duckdbProof = await duckdb.verify(receipt), postgresProof = await postgres.verify(receipt);
          assert.equal(duckdbProof.engine, 'duckdb'); assert.equal(postgresProof.engine, 'postgres');
          return { duckdb: duckdbProof, postgres: postgresProof };
        };
        const imports = new ImportService(vault), memory = new MemoryService(vault);
        const calculator = new CalculatorService(vault, { verifier });
        const input = hugeDecimalImport();
        const first = await imports.commit(fixtureOwner, input);
        const factsBeforeDuplicate = hash(vault.read().facts), importsBeforeDuplicate = hash(vault.read().imports);
        const duplicateImport = await imports.commit(fixtureOwner, structuredClone(input));
        assert.equal(duplicateImport.duplicate, true); assert.equal(duplicateImport.id, first.id);
        assert.equal(hash(vault.read().facts), factsBeforeDuplicate); assert.equal(hash(vault.read().imports), importsBeforeDuplicate);
        const exact = await calculator.calculate(fixtureOwner, { operation: 'earned', period: fixturePeriod, branch: 'main' });
        assert.equal(exact.totalMinor, '900719925474099400'); assert.equal(exact.coverage.completeness, 'reconciled-imports');
        record('exact-source-decimals-idempotent-import-and-native-calculator-composition', 'native-postgresql-vault-and-native-duckdb-postgresql-arithmetic');

        await imports.commit(fixtureOwner, exactCurrencyImport());
        const converted = await calculator.calculate(fixtureOwner, { operation: 'earned', period: fixturePeriod, branch: 'west' });
        assert.equal(converted.totalMinor, '85075');
        assert.deepEqual(converted.rows[0].normalization, { sourceCurrency: 'USD', targetCurrency: 'INR', rate: { numerator: '83', denominator: '1', rounding: 'exact' } });
        record('explicit-exact-currency-conversion-retains-source-lineage', 'native-postgresql-vault-and-native-duckdb-postgresql-arithmetic');

        const original = await memory.append(fixtureOwner, [{ entityId: 'historical-sale', sourceId: 'labelled-history-fixture', sourceRow: 2, kind: 'sale', validFrom: '2026-03-12', branch: 'history', fields: { amountMinor: '10000', currency: 'INR', status: 'delivered' } }], { testLearnedAt: '2026-04-01T09:00:00Z' });
        const originalBytes = JSON.stringify(original[0]);
        const historicalRequest = { operation: 'earned', branch: 'history', period: { from: '2026-03-01', to: '2026-03-31' }, asOf: '2026-04-02T00:00:00Z' };
        const then = await calculator.calculate(fixtureOwner, historicalRequest); assert.equal(then.totalMinor, '10000');
        await memory.correct(fixtureOwner, original[0].id, { amountMinor: '12000' }, { testLearnedAt: '2026-04-03T09:00:00Z' });
        assert.equal(JSON.stringify(vault.read().facts.find(row => row.id === original[0].id)), originalBytes);
        assert.equal(calculator.receipt(fixtureOwner, then.id).stale, true);
        const oldView = await calculator.calculate(fixtureOwner, historicalRequest);
        const corrected = await calculator.calculate(fixtureOwner, { ...historicalRequest, asOf: '2026-04-04T00:00:00Z' });
        assert.equal(oldView.totalMinor, '10000'); assert.equal(corrected.totalMinor, '12000');
        record('immutable-bitemporal-correction-and-stale-answer', 'native-postgresql-vault-and-native-duckdb-postgresql-arithmetic', { clock: 'explicit-labelled-demo-only' });

        const raw = await pool.query('SELECT revision::text AS revision, envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [slot]);
        assert.equal(raw.rows[0].revision, String(vault.read().revision));
        for (const plaintext of [marker, 'historical-sale', 'real-engine-exact-decimals', input.content, passphrase]) assert.ok(!raw.rows[0].envelope.includes(plaintext));
        record('authority-table-stores-encrypted-envelope-and-current-revision', 'native-postgresql-snapshot');

        const backup = join(directory, 'encrypted-backup.chausar'); await vault.backup(backup);
        const expectedFacts = hash(vault.read().facts), expectedImports = hash(vault.read().imports);
        const envelope = await adapter.load();
        const raceSlot = `${runId}-cas`; ownedSlots.add(raceSlot);
        const contender = await PostgresSnapshotAdapter.fromPool(pool, raceSlot);
        const race = await Promise.allSettled([contender.commit(envelope, null), contender.commit(envelope, null)]);
        assert.equal(race.filter(value => value.status === 'fulfilled').length, 1);
        assert.equal(race.find(value => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
        record('real-postgresql-concurrent-creation-cas', 'native-postgresql-snapshot');
        await vault.update(state => { state.activity.push({ event: 'native-cas-update-fixture' }); });
        const nextEnvelope = await adapter.load();
        assert.equal(nextEnvelope.revision, envelope.revision + 1);
        const updateRace = await Promise.allSettled([contender.commit(nextEnvelope, envelope.revision), contender.commit(nextEnvelope, envelope.revision)]);
        assert.equal(updateRace.filter(value => value.status === 'fulfilled').length, 1);
        assert.equal(updateRace.find(value => value.status === 'rejected').reason.code, 'REVISION_CONFLICT');
        assert.equal((await contender.load()).revision, nextEnvelope.revision);
        record('real-postgresql-concurrent-update-cas', 'native-postgresql-snapshot');

        await vault.close(); vault = undefined;
        vault = await Vault.open({ directory: join(directory, 'main'), storage: adapter, passphrase });
        assert.equal(hash(vault.read().facts), expectedFacts); assert.equal(hash(vault.read().imports), expectedImports);
        assert.equal((await new CalculatorService(vault, { verifier }).calculate(fixtureOwner, historicalRequest)).totalMinor, '10000');
        assert.equal((await new ImportService(vault).commit(fixtureOwner, input)).duplicate, true);
        record('reopen-preserves-claims-history-and-import-idempotency', 'native-postgresql-vault-and-native-duckdb-postgresql-arithmetic');
        await vault.close(); vault = undefined;
        const restoredSlot = `${runId}-restored`; ownedSlots.add(restoredSlot);
        const restoredAdapter = await PostgresSnapshotAdapter.fromPool(pool, restoredSlot);
        vault = await Vault.restore({ directory: join(directory, 'restored'), storage: restoredAdapter, backupFile: backup, passphrase });
        assert.equal(hash(vault.read().facts), expectedFacts); assert.equal(hash(vault.read().imports), expectedImports);
        assert.equal((await new CalculatorService(vault, { verifier }).calculate(fixtureOwner, { ...historicalRequest, asOf: '2026-04-04T00:00:00Z' })).totalMinor, '12000');
        record('encrypted-backup-restores-corrected-history-in-fresh-postgresql-slot', 'native-postgresql-vault-and-native-duckdb-postgresql-arithmetic');
        await vault.delete(); vault = undefined;
        assert.equal(await restoredAdapter.load(), null);
        record('restored-slot-deletion', 'native-postgresql-snapshot');
      } catch (error) { failed('postgresql-vault-native-calculator-composition', error); }
    } else report.blockers.push({ engine: 'composition', reason: 'BOTH_NATIVE_ENGINES_REQUIRED' });
  } catch (error) { failed('qualification-runner', error); }
  finally {
    try { await vault?.close(); } catch (error) { failed('close-fixture-vault', error); }
    if (pool && authorityInitialized) {
      for (const slot of ownedSlots) {
        try { await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot=$1', [slot]); }
        catch (error) { failed('remove-run-owned-slot', error); }
      }
    }
    try { await postgres?.close(); } catch (error) { failed('close-postgresql-calculator', error); }
    try { await pool?.end(); } catch (error) { failed('close-postgresql-fixture-pool', error); }
    if (directory) {
      try {
        const target = resolve(directory), parent = resolve(tmpdir());
        requireCondition(target.startsWith(parent + sep) && basename(target).startsWith('chausar-differential-') && !(await lstat(target)).isSymbolicLink(), 'UNSAFE_FIXTURE_CLEANUP_PATH', 'Temporary cleanup must remain in the generated fixture directory.');
        await rm(target, { recursive: true, force: true });
      } catch (error) { failed('remove-generated-local-fixture-directory', error); }
    }
  }
  report.passed = report.blockers.length === 0 && report.checks.every(check => check.passed) && duckdbReady && postgresReady;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runDatabaseDifferential();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.passed) process.exitCode = 1;
}
