import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, lstat, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { PGlite } from '@electric-sql/pglite';
import { DatabaseCalculator } from '../platform/runtime/analytics.ts';
import { CalculatorService } from '../platform/runtime/calculator.ts';
import { ImportService } from '../platform/runtime/ingest.ts';
import { decimalMinor } from '../platform/runtime/currency.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { databaseFixtures, fixtureOwner, fixturePeriod, prepareDatabaseFixture, assertFixtureReceipt, hugeDecimalImport, exactCurrencyImport } from '../platform/tests/database-fixtures.ts';

// PGlite is deliberately supplied through the injected-SQL interface. The
// queries below run real WASM; FixtureStateStore is not a persistence adapter.
export async function runPGliteCQualification(environment = process.env) {
  const report = { suite: 'actual-pglite-c-fixture-qualification', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null, passed: false, checks: [], blockers: [], engines: { pglite: 'not-executed' }, adapterProofLabel: 'injected-sql', defaultEngineSelected: false, productionQualified: false, limitations: ['Application fixture selection/import uses an explicitly labelled in-memory FixtureStateStore.', 'PGlite has no qualified product authority adapter, encrypted-backup composition or production selection.', 'Independent-instance CAS probe is in one process; cross-process ownership and crash/power-loss recovery remain unqualified.'] };
  const code = error => /^[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'PGLITE_QUALIFICATION_FAILED';
  const record = (name, evidence, detail = {}) => report.checks.push({ name, passed: true, evidence, ...detail });
  const test = async (name, evidence, action) => {
    try { record(name, evidence, await action() ?? {}); }
    catch (error) { report.checks.push({ name, passed: false, reason: code(error) }); }
  };
  let db, durable, second, reopened;
  try {
    assert.equal(report.sourceCommit, '1dc19b856380951aea49b7143ed4b5617130c06b');
    const workspace = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
    const root = resolve(environment.CHAUSAR_QUALIFICATION_RUN_ROOT ?? '');
    const suffix = relative(workspace, root);
    assert(suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep));
    assert.equal((await realpath(root)).toLowerCase(), root.toLowerCase());
    assert(!(await lstat(root)).isSymbolicLink());
    const temporary = join(root, 'temp');
    for (const name of ['TEMP', 'TMP']) {
      assert.equal(resolve(environment[name] ?? '').toLowerCase(), temporary.toLowerCase());
      assert.equal(resolve(process.env[name] ?? '').toLowerCase(), temporary.toLowerCase());
    }
    assert.equal(resolve(tmpdir()).toLowerCase(), temporary.toLowerCase());
    assert.equal((await realpath(temporary)).toLowerCase(), temporary.toLowerCase());
    assert((await lstat(temporary)).isDirectory() && !(await lstat(temporary)).isSymbolicLink());
    assert(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE);
    const dataRoot = join(root, 'pglite-fixtures'); await mkdir(dataRoot);
    report.generatedDataRoot = dataRoot;
    const packageFile = new URL('../node_modules/@electric-sql/pglite/package.json', import.meta.url);
    const metadata = JSON.parse(await readFile(packageFile, 'utf8'));
    assert.equal(metadata.version, '0.5.8'); report.packageVersion = metadata.version;
    report.sourceHashes = {};
    for (const path of ['../platform/runtime/analytics.ts', '../platform/tests/database-fixtures.ts']) report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
    db = new PGlite(); await db.waitReady;
    const version = (await db.query("SELECT version() AS version, current_setting('server_version') AS server_version")).rows[0];
    assert.match(version.version, /^PostgreSQL /);
    report.engines.pglite = 'actual-wasm-executed'; record('actual-wasm-identity', 'actual-pglite-query', version);
    let queries = 0;
    const verifier = new DatabaseCalculator({ sqlDialect: 'postgres', operationTimeoutMs: 5000, connectionFactory: async signal => {
      assert.equal(signal.aborted, false); await db.query('BEGIN');
      try { await db.exec("SET LOCAL search_path TO pg_temp; SET LOCAL statement_timeout TO '4000ms'"); }
      catch (error) { await db.query('ROLLBACK'); throw error; }
      return { async execute(sql, parameters = []) { assert.equal(signal.aborted, false); queries++; return (await db.query(sql, parameters)).rows; }, async close() { await db.query('ROLLBACK'); } };
    } });
    let accepted = 0, refusals = 0;
    for (const fixture of databaseFixtures) await test(fixture.id, fixture.rejectCode ? 'javascript-contract-refusal-before-sql' : 'literal-answer-and-actual-pglite-query', async () => {
      const { calculator } = await prepareDatabaseFixture(fixture);
      if (fixture.rejectCode) { await assert.rejects(calculator.calculate(fixtureOwner, fixture.request), { code: fixture.rejectCode }); refusals++; return { reason: fixture.rejectCode }; }
      const receipt = await calculator.calculate(fixtureOwner, fixture.request); assertFixtureReceipt(fixture, receipt);
      const proof = await verifier.verify(receipt); assert.equal(proof.engine, 'injected-sql'); assert.equal(proof.verified, true); accepted++;
      return { expectedMinor: fixture.expected.primary, arithmetic: fixture.arithmetic, projectionDigest: proof.projectionDigest };
    });
    report.corpus = { fixtures: databaseFixtures.length, acceptedActualSql: accepted, refusedBeforeSql: refusals, expectedAccepted: databaseFixtures.filter(fixture => !fixture.rejectCode).length };
    await test('tampered-answer-refused', 'actual-pglite-result-mismatch', async () => {
      const { calculator } = await prepareDatabaseFixture(databaseFixtures.find(fixture => fixture.id === 'sum-above-javascript-safe-integer'));
      const receipt = await calculator.calculate(fixtureOwner, databaseFixtures.find(fixture => fixture.id === 'sum-above-javascript-safe-integer').request);
      receipt.valueMinor = String(BigInt(receipt.valueMinor) + 1n); receipt.totalMinor = receipt.valueMinor; receipt.figures[0].minor = receipt.valueMinor;
      await assert.rejects(verifier.verify(receipt), { code: 'SQL_RESULT_MISMATCH' });
    });
    await test('exact-import-idempotency-and-currency', 'in-memory-application-import-with-actual-pglite-arithmetic', async () => {
      const { store } = await prepareDatabaseFixture(databaseFixtures.find(fixture => fixture.id === 'empty-selection-is-a-coverage-gap'));
      const imports = new ImportService(store), calculator = new CalculatorService(store, { verifier: receipt => verifier.verify(receipt) });
      const input = hugeDecimalImport(), first = await imports.commit(fixtureOwner, input);
      const before = { facts: hash(store.read().facts), imports: hash(store.read().imports) };
      const duplicate = await imports.commit(fixtureOwner, structuredClone(input)); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.id, first.id);
      assert.deepEqual({ facts: hash(store.read().facts), imports: hash(store.read().imports) }, before);
      const exact = await calculator.calculate(fixtureOwner, { operation: 'earned', period: fixturePeriod, branch: 'main' }); assert.equal(exact.totalMinor, '900719925474099400');
      await imports.commit(fixtureOwner, exactCurrencyImport());
      const fx = await calculator.calculate(fixtureOwner, { operation: 'earned', period: fixturePeriod, branch: 'west' }); assert.equal(fx.totalMinor, '85075');
      return { exactMinor: exact.totalMinor, convertedMinor: fx.totalMinor, appStateDurability: 'not-tested' };
    });
    await test('currency-exponents-and-missing-state', 'actual-pglite-numeric-null-query-and-exact-parser', async () => {
      assert.equal(decimalMinor('1', 'JPY'), '1'); assert.equal(decimalMinor('1.001', 'KWD'), '1001');
      const result = (await db.query("SELECT COUNT(amount)::text AS known, COUNT(*)::text AS selected, COALESCE(SUM(amount),0)::text AS total FROM (VALUES (NULL::NUMERIC(38,0)),(0::NUMERIC(38,0))) v(amount)")).rows[0];
      assert.deepEqual(result, { known: '1', selected: '2', total: '0' }); return result;
    });
    await test('temporary-projections-rolled-back', 'actual-pglite-catalog-query', async () => {
      assert.equal((await db.query("SELECT count(*)::text AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname LIKE 'pg_temp_%' AND c.relname IN ('receipt_rows','receipt_definitions')")).rows[0].count, '0');
    });
    report.verifierSqlExecuteCalls = queries; await db.close(); db = undefined;
    const path = join(dataRoot, 'ownership'); durable = new PGlite(path); await durable.waitReady;
    await durable.exec('CREATE TABLE counter (id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, value INTEGER NOT NULL); INSERT INTO counter VALUES (1,0,0)');
    await test('same-instance-cas', 'actual-filesystem-wasm-serialized-transactions', async () => {
      const attempts = await Promise.all([0, 1].map(() => durable.transaction(tx => tx.query('UPDATE counter SET revision=revision+1,value=value+1 WHERE id=1 AND revision=0 RETURNING revision'))));
      assert.equal(attempts.filter(result => result.rows.length === 1).length, 1);
    });
    await durable.close(); durable = new PGlite(path); await durable.waitReady;
    await test('orderly-close-and-reopen', 'actual-new-wasm-instance-filesystem-readback', async () => {
      assert.deepEqual((await durable.query('SELECT revision,value FROM counter WHERE id=1')).rows[0], { revision: 1, value: 1 });
    });
    await durable.query('UPDATE counter SET revision=0,value=0 WHERE id=1');
    second = new PGlite(path); await second.waitReady;
    const observation = { sameProcess: true, separateWasmInstances: true, initialViews: [(await durable.query('SELECT revision,value FROM counter WHERE id=1')).rows[0], (await second.query('SELECT revision,value FROM counter WHERE id=1')).rows[0]] };
    assert.deepEqual(observation.initialViews, [{ revision: 0, value: 0 }, { revision: 0, value: 0 }]);
    const attempts = await Promise.allSettled([durable, second].map(engine => engine.query('UPDATE counter SET revision=revision+1,value=value+1 WHERE id=1 AND revision=0 RETURNING revision,value')));
    observation.writers = attempts.map(result => result.status === 'fulfilled' ? { status: result.status, rows: result.value.rows } : { status: result.status, reason: code(result.reason) });
    observation.acknowledgedWriters = attempts.filter(result => result.status === 'fulfilled' && result.value.rows.length === 1).length;
    await second.close(); second = undefined; await durable.close(); durable = undefined;
    reopened = new PGlite(path); await reopened.waitReady; observation.cleanReopen = (await reopened.query('SELECT revision,value FROM counter WHERE id=1')).rows[0];
    await reopened.close(); reopened = undefined; report.independentWriterObservation = observation;
    await test('independent-instance-directory-ownership', 'actual-two-wasm-instance-same-directory-cas', async () => {
      assert.equal(observation.acknowledgedWriters, 1, 'One revision may have at most one acknowledged writer.');
      assert.deepEqual(observation.cleanReopen, { revision: 1, value: 1 });
    });
    if (observation.acknowledgedWriters > 1) report.blockers.push({ code: 'UNSAFE_INDEPENDENT_INSTANCE_CAS', acknowledgedWriters: observation.acknowledgedWriters, retainedRevision: observation.cleanReopen.revision, retainedValue: observation.cleanReopen.value });
  } catch (error) { report.blockers.push({ code: code(error), message: String(error.message).slice(0, 900) }); }
  finally { for (const connection of [db, second, durable, reopened]) if (connection) try { await connection.close(); } catch (error) { report.blockers.push({ code: code(error) }); } }
  report.passed = report.blockers.length === 0 && report.checks.length > 0 && report.checks.every(check => check.passed) && report.corpus?.acceptedActualSql === report.corpus?.expectedAccepted;
  return report;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const report = await runPGliteCQualification(); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exitCode = report.passed ? 0 : 1; }
