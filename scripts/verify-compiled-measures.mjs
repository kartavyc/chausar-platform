import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseCalculator } from '../platform/runtime/analytics.ts';
import { PostgresDatabaseCalculator } from '../platform/runtime/postgres-analytics.ts';
import { PostgresSnapshotAdapter } from '../platform/runtime/postgres.ts';
import { Vault } from '../platform/runtime/vault.ts';
import { CalculatorService } from '../platform/runtime/calculator.ts';
import { MemoryService } from '../platform/runtime/memory.ts';
import { OntologyService } from '../platform/runtime/ontology.ts';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { assertPristinePostgres, disposablePostgresConfiguration } from './verify-database-differential.mjs';

const OWNER = { memberId: 'owner', role: 'owner', epoch: 1 };
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
// These answers are literal, hand-worked keys. No compiler or calculator derives them.
export const independentCompiledMeasureVectors = [
  { id: 'custom-bank-sum', operation: 'bank_revenue', field: 'amountMinor', sign: 1, values: ['100', '-25', '0'], expected: '75', arithmetic: '100 - 25 + 0 = 75' },
  { id: 'negative-definition-sign', operation: 'signed_movement', field: 'amountMinor', sign: -1, values: ['100', '-25'], expected: '-75', arithmetic: '-(100 - 25) = -75' },
  { id: 'alternate-fee-field', operation: 'fee_total', field: 'feeMinor', sign: 1, values: ['125', '375'], canonical: ['100000', '70000'], expected: '500', arithmetic: 'Fees 125 + 375 = 500; canonical amounts are deliberately 100000 + 70000.' },
  { id: 'exact-above-safe-integer', operation: 'bank_revenue', field: 'amountMinor', sign: 1, values: ['900719925474099391', '9'], expected: '900719925474099400', arithmetic: '900719925474099391 + 9 = 900719925474099400' },
  { id: 'decimal-38-maximum', operation: 'bank_revenue', field: 'amountMinor', sign: 1, values: ['99999999999999999999999999999999999999'], expected: '99999999999999999999999999999999999999', arithmetic: 'One exact 38-digit value remains unchanged.' },
  { id: 'unknown-fee-excluded', operation: 'fee_total', field: 'feeMinor', sign: 1, nulls: 'exclude', values: ['125', null], canonical: ['100000', '70000'], expected: '125', counted: 1, arithmetic: 'Known fee 125; unknown fee excluded with partial coverage.' },
  { id: 'unknown-fee-rejected', operation: 'fee_total', field: 'feeMinor', sign: 1, nulls: 'reject', values: [null], canonical: ['100000'], rejectCode: 'MISSING_MEASURE_VALUE', arithmetic: 'Unknown required fee refuses before native SQL and creates no receipt.' },
];

function authoredDraft(operation, field = 'amountMinor', sign = 1, nulls = 'reject', kind = 'bank') {
  return {
    pack: 'labelled-native-measure-fixture', label: 'Synthetic custom movement definitions', currency: 'INR', gstMode: 'unregistered',
    fields: { amountMinor: 'money', feeMinor: 'money', currency: 'string', status: 'string', description: 'string' },
    definitions: [{ name: operation, label: 'Synthetic movement total', meaning: 'Exact signed imported movements only; this authored fixture does not infer sales or source qualification.', kind, field, currency: 'INR', nulls, sign }],
  };
}
function assertLiteral(receipt, expected) {
  assert.equal(receipt.valueMinor, expected); assert.equal(receipt.totalMinor, expected);
  assert.deepEqual(Object.fromEntries(receipt.figures.map(figure => [figure.key, figure.minor])), { total: expected });
}
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'COMPILED_MEASURE_QUALIFICATION_FAILED';

export async function runCompiledMeasureQualification(environment = process.env) {
  const report = { suite: 'native-compiled-single-definition-measures', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null, passed: false, checks: [], blockers: [], engines: { duckdb: 'not-executed', postgres: 'not-executed' }, scope: 'Literal authored single-definition sum vectors against JavaScript, native DuckDB and native PostgreSQL; production Engine HTTP import/catalog/run/receipt/reopen with PostgreSQL encrypted authority and default native DuckDB. No vendor, provider, enterprise, installer or full-release qualification.' };
  const record = (name, evidence, detail = {}) => report.checks.push({ name, passed: true, evidence, ...detail });
  const failure = (name, error) => report.checks.push({ name, passed: false, reason: safeCode(error) });
  const runId = `compiled-native-${randomUUID()}`;
  const slots = new Set();
  const duckdb = new DatabaseCalculator();
  let pool, postgres, currentVault, app, authorityInitialized = false, productionHttpPassed = false;
  let providerCalls = 0;
  try {
    const config = disposablePostgresConfiguration(environment);
    const runRoot = resolve(environment.CHAUSAR_QUALIFICATION_RUN_ROOT ?? '');
    const workspace = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task');
    const suffix = relative(workspace, runRoot);
    assert(suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep), 'Native traces must remain in the authorized C: workspace.');
    assert.equal((await realpath(runRoot)).toLowerCase(), runRoot.toLowerCase());
    assert(!(await lstat(runRoot)).isSymbolicLink());
    assert.equal(resolve(environment.TEMP ?? '').toLowerCase(), join(runRoot, 'temp').toLowerCase(), 'Supervisor must confine temporary artifacts to its owned run.');
    const pg = await import('pg'); const Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({ ...config, ssl: false, max: 2, connectionTimeoutMillis: 3000, query_timeout: 17000, application_name: 'chausar-compiled-measure-fixtures', options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
    await assertPristinePostgres(pool);
    const identity = await pool.query("SELECT version() AS version, current_setting('listen_addresses') AS listen_addresses, current_setting('port') AS port");
    assert.equal(identity.rows[0].listen_addresses, '127.0.0.1'); assert.equal(Number(identity.rows[0].port), config.port);
    assert.match(identity.rows[0].version, /^PostgreSQL 18\.6 /);
    record('pristine-dedicated-loopback-postgresql-identity', 'native-postgresql', { serverVersion: '18.6' });
    postgres = await PostgresDatabaseCalculator.connect({ ...config, maxConnections: 2, operationTimeoutMs: 15000 });
    for (const vector of independentCompiledMeasureVectors) {
      let phase = 'javascript-literal-answer';
      try {
        const slot = `${runId}-${vector.id}`; slots.add(slot);
        const adapter = await PostgresSnapshotAdapter.fromPool(pool, slot); authorityInitialized = true;
        currentVault = (await Vault.create({ directory: join(runRoot, 'vectors', vector.id), storage: adapter, name: 'Labelled synthetic compiled vector', passphrase: randomBytes(24).toString('hex'), demo: false })).vault;
        const dictionary = await new OntologyService(currentVault).publish(OWNER, authoredDraft(vector.operation, vector.field, vector.sign, vector.nulls));
        await new MemoryService(currentVault).append(OWNER, vector.values.map((value, index) => ({ entityId: `${vector.id}-${index}`, sourceId: `literal-${vector.id}`, sourceRow: index + 2, kind: 'bank', validFrom: '2026-09-10', branch: 'main', fields: { currency: 'INR', status: 'settled', amountMinor: vector.canonical?.[index] ?? value, ...(vector.field === 'feeMinor' ? { feeMinor: value } : {}) } })));
        const calculator = new CalculatorService(currentVault);
        const request = { operation: vector.operation, period: PERIOD, branch: 'main' };
        if (vector.rejectCode) {
          const count = currentVault.read().receipts.length;
          await assert.rejects(calculator.calculate(OWNER, request), { code: vector.rejectCode });
          assert.equal(currentVault.read().receipts.length, count);
          record(`${vector.id}:required-value-refusal`, 'javascript-contract-refusal-before-native-sql', { reason: vector.rejectCode });
          continue;
        }
        const receipt = await calculator.calculate(OWNER, request);
        assertLiteral(receipt, vector.expected);
        assert.equal(receipt.operation, vector.operation);
        assert.equal(receipt.compiledCalculation?.dictionaryHash, dictionary.hash);
        assert.equal(receipt.compiledCalculation?.sum?.moneyField, vector.field);
        assert.equal(receipt.compiledCalculation?.sum?.sign, vector.sign);
        assert.equal(receipt.compiledCalculation?.sum?.dictionaryVersion, dictionary.version);
        assert.equal(receipt.coverage.countedRows, vector.counted ?? vector.values.length);
        assert(receipt.rows.every(row => row.measureField === vector.field));
        if (vector.nulls === 'exclude') { assert.equal(receipt.coverage.completeness, 'partial'); assert.equal(receipt.coverage.excludedRows, 1); }
        if (vector.field === 'feeMinor') assert.deepEqual(receipt.rows.map(row => row.amountMinor), vector.values.filter(value => value !== null));
        record(`${vector.id}:javascript-literal-answer`, 'javascript-independent-literal-answer', { expectedMinor: vector.expected });
        for (const [engine, verifier] of [['duckdb', duckdb], ['postgres', postgres]]) {
          phase = `${engine}-literal-answer`;
          const proof = await verifier.verify(structuredClone(receipt));
          assert.equal(proof.engine, engine); assert.equal(proof.verified, true); assert.equal(proof.receiptId, receipt.id);
          report.engines[engine] = 'native-executed';
          record(`${vector.id}:${engine}-literal-answer`, `native-${engine}`, { expectedMinor: vector.expected, projectionDigest: proof.projectionDigest });
          phase = `${engine}-tampered-answer`;
          const tampered = structuredClone(receipt); tampered.figures[0].minor = String(BigInt(vector.expected) + 1n);
          await assert.rejects(verifier.verify(tampered), { code: 'SQL_RESULT_MISMATCH' });
          record(`${vector.id}:${engine}-tampered-answer`, `native-${engine}`);
        }
      } catch (error) { failure(`${vector.id}:${phase}`, error); }
      finally { try { await currentVault?.close(); currentVault = undefined; } catch (error) { failure(`${vector.id}:close-vault`, error); } }
    }

    let httpPhase = 'production-http-create';
    try {
      const directory = join(runRoot, 'production-engine');
      const name = 'Synthetic compiled bank movement qualification';
      const passphrase = randomBytes(24).toString('hex');
      const engineOptions = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL, gateway: { http: async () => { providerCalls++; throw new Error('Unexpected model request.'); }, process: async () => { providerCalls++; throw new Error('Unexpected model request.'); } } };
      const engineSlot = hash(resolve(directory, 'main')); slots.add(engineSlot);
      let engine = new Engine(engineOptions); app = createLocalServer(engine);
      let pairing = await app.listen();
      const rpc = async (method, payload = {}) => {
        const response = await fetch(`${pairing.origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairing.token}` }, body: JSON.stringify({ method, payload }), signal: AbortSignal.timeout(20000) });
        const body = await response.json();
        if (body.error) throw Object.assign(new Error('Synthetic engine request refused.'), { code: body.error.code });
        assert.equal(response.status, 200); return body.result;
      };
      const created = await rpc('workspace.create', { name, passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
      assert.equal(created.experimental, false);
      const dictionary = await rpc('ontology.publish', { draft: authoredDraft('bank_revenue') });
      const recipe = {
        version: 1, id: 'labelled-synthetic-bank-layout-v1', system: 'synthetic-bank-export', edition: 'labelled-fixture', scope: { company: name, branches: ['main'] },
        bindings: [
          { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
          { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
          { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
          { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'status', source: 'status', type: 'string', nulls: 'reject' },
          { target: 'branch', source: 'branch', type: 'string', nulls: 'reject' }, { target: 'description', source: 'description', type: 'string', nulls: 'reject' },
        ], allowedKinds: ['bank'], allowedStatuses: ['settled'], onUnmapped: 'report',
        bankLayout: { idField: 'reference', dateField: 'date', descriptionField: 'description', debitField: 'debit', creditField: 'credit', balanceField: 'balance', dateFormat: 'ISO', openingMinor: '0', closingMinor: '10025', currency: 'INR' },
      };
      // Credits 123.45 and debit 23.20 give the literal net movement 10025 minor units.
      const input = { sourceId: `synthetic-bank-${runId}`, format: 'bank-csv', content: 'reference,date,description,debit,credit,balance\nSYNTH-A,2026-09-10,Synthetic credit,,123.45,123.45\nSYNTH-B,2026-09-11,Synthetic debit,23.20,,100.25\n', recipe, expectedTotals: { rowCount: 2, amountMinor: '10025' } };
      httpPhase = 'production-http-bank-import';
      const preview = await rpc('sources.preview', input); assert.equal(preview.accepted, true); assert.equal(preview.coverage.reconciled, true); assert.equal(preview.totalsMinor, '10025');
      const imported = await rpc('sources.import', input); assert.equal(imported.totalsMinor, '10025'); assert.equal(imported.coverage.reconciled, true);
      assert.equal(imported.qualification, 'experimental');
      const catalog = (await rpc('ontology.get')).current;
      assert.equal(catalog.hash, dictionary.hash); assert(catalog.operations.some(operation => operation.id === 'bank_revenue'));
      record('production-http-author-publish-bank-import-and-catalog', 'native-postgresql-encrypted-authority-and-actual-http', { sourceQualification: 'experimental-synthetic' });
      httpPhase = 'production-http-native-custom-sum';
      const receipt = await rpc('calculation.run', { operation: 'bank_revenue', period: PERIOD, branch: 'main' });
      assertLiteral(receipt, '10025'); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
      assert.equal(receipt.databaseProof.engine, 'duckdb'); assert.equal(receipt.databaseProof.verified, true);
      assert.equal(receipt.compiledCalculation.dictionaryHash, dictionary.hash);
      assert.deepEqual((await rpc('receipts.get', { id: receipt.id })), receipt);
      const postgresProof = await postgres.verify(structuredClone(receipt)); assert.equal(postgresProof.engine, 'postgres'); assert.equal(postgresProof.verified, true);
      record('production-http-custom-bank-sum-and-native-proofs', 'production-default-native-duckdb-and-native-postgresql', { expectedMinor: '10025' });
      const persisted = await pool.query('SELECT envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [engineSlot]);
      assert.equal(persisted.rows.length, 1); for (const marker of [name, passphrase, 'SYNTH-A', 'bank_revenue']) assert(!persisted.rows[0].envelope.includes(marker));
      record('production-http-authority-keeps-synthetic-plaintext-encrypted', 'native-postgresql-encrypted-snapshot');
      httpPhase = 'production-http-reopen-retained-receipt';
      await app.close(20000); app = undefined;
      engine = new Engine(engineOptions); app = createLocalServer(engine); pairing = await app.listen();
      await rpc('workspace.open', { folder: 'main', passphrase });
      const reopened = await rpc('receipts.get', { id: receipt.id }); assert.deepEqual(reopened, receipt);
      const recalculated = await rpc('calculation.run', { operation: 'bank_revenue', period: PERIOD, branch: 'main' });
      assertLiteral(recalculated, '10025'); assert.equal(recalculated.databaseProof.engine, 'duckdb');
      assert.equal(engine.vault.read().modelReceipts.length, 0); assert.equal(providerCalls, 0);
      assert.equal(engine.vault.read().policy.send, 'nothing'); assert.equal(engine.vault.read().policy.autonomy, false);
      record('production-http-reopen-preserves-compiled-receipt-and-native-recalculation', 'native-postgresql-reopen-and-default-native-duckdb');
      await rpc('workspace.delete', { confirmation: name }); assert.equal((await pool.query('SELECT count(*)::text AS count FROM public.chausar_vault_authority WHERE slot=$1', [engineSlot])).rows[0].count, '0');
      record('production-http-owned-workspace-deletion', 'native-postgresql-encrypted-authority');
      productionHttpPassed = true;
    } catch (error) { failure(httpPhase, error); }
  } catch (error) { report.blockers.push({ engine: 'qualification', reason: safeCode(error) }); }
  finally {
    try { await app?.close(20000); } catch (error) { failure('close-owned-http-engine', error); }
    try { await currentVault?.close(); } catch (error) { failure('close-owned-vector-vault', error); }
    try { await postgres?.close(); } catch (error) { failure('close-native-postgresql-verifier', error); }
    if (pool && authorityInitialized) for (const slot of slots) {
      try { await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot=$1', [slot]); }
      catch (error) { failure('remove-run-owned-authority-slot', error); }
    }
    try { await pool?.end(); } catch (error) { failure('close-fixture-pool', error); }
  }
  report.passed = report.blockers.length === 0 && report.checks.every(check => check.passed) && report.engines.duckdb === 'native-executed' && report.engines.postgres === 'native-executed' && productionHttpPassed;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--preflight') {
    assert.equal(process.argv.length, 3);
    assert.equal(independentCompiledMeasureVectors.length, 7);
    process.stdout.write(JSON.stringify({ suite: 'compiled-measure-gate-preflight-only', nativeExecuted: false, vectors: independentCompiledMeasureVectors.map(({ id, arithmetic, expected, rejectCode }) => ({ id, arithmetic, expectedMinor: expected ?? null, rejectCode: rejectCode ?? null })) }, null, 2) + '\n');
  } else {
    assert.equal(process.argv.length, 2);
    const report = await runCompiledMeasureQualification(); process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    if (!report.passed) process.exitCode = 1;
  }
}
