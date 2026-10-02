import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, lstat, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../platform/runtime/engine.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { assertPristinePostgres, disposablePostgresConfiguration, QualificationError } from './verify-database-differential.mjs';

// Public generated business fixtures only. This is not a user credential.
const PUBLIC_FIXTURE_PASSPHRASE = 'PUBLIC SYNTHETIC WORKFLOW QUALIFICATION PASSPHRASE 2026';
const TASK_ROOT = 'C:/Users/karta/Documents/Codex/2026-10-01/task-4';
const FOUNDATION_COMMIT = '1dc19b856380951aea49b7143ed4b5617130c06b';
const sourceHeader = 'id,kind,date,amount,currency,branch,status,description';
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'WORKFLOW_QUALIFICATION_FAILED';
function requireCondition(value, code, message) { if (!value) throw new QualificationError(code, message); }
function equalPath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }

async function ownedRoot(environment) {
  requireCondition(process.platform === 'win32', 'WINDOWS_C_FIXTURE_REQUIRED', 'This approved fixture profile requires Windows C: staging.');
  requireCondition(/^C:[\\/]/i.test(resolve(tmpdir())), 'C_TEMP_REQUIRED', 'Configure the executing process temporary directory on C: before running this gate.');
  const value = environment.CHAUSAR_QUALIFICATION_RUN_ROOT;
  requireCondition(typeof value === 'string' && isAbsolute(value), 'WORKFLOW_ROOT_REQUIRED', 'Supply an explicit existing workflow fixture root under the approved task-4 directory.');
  const approved = await realpath(TASK_ROOT), selected = resolve(value), child = relative(approved, selected);
  requireCondition(equalPath(selected, approved) || (child && !child.startsWith('..') && !isAbsolute(child)), 'WORKFLOW_ROOT_REFUSED', 'The workflow root must remain inside the approved task-4 directory.');
  // Check every component so a junction cannot redirect owned writes to another drive.
  const segments = child ? child.split(/[\\/]/) : [];
  let current = approved;
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current);
    requireCondition(info.isDirectory() && !info.isSymbolicLink(), 'WORKFLOW_ROOT_REFUSED', 'The selected workflow root must contain only existing ordinary directories.');
    requireCondition(equalPath(await realpath(current), resolve(current)), 'WORKFLOW_ROOT_REFUSED', 'The selected workflow root cannot redirect writes.');
  }
  requireCondition(/^C:[\\/]/i.test(selected), 'WORKFLOW_ROOT_REFUSED', 'The workflow root must be on C:.');
  const temporaryDirectory = join(selected, 'temp');
  for (const name of ['TEMP', 'TMP']) {
    requireCondition(equalPath(resolve(environment[name] ?? ''), temporaryDirectory)
      && equalPath(resolve(process.env[name] ?? ''), temporaryDirectory), 'C_TEMP_REQUIRED', 'Both process temporary paths must stay inside the supervised C: run.');
  }
  const temporaryInfo = await lstat(temporaryDirectory);
  requireCondition(temporaryInfo.isDirectory() && !temporaryInfo.isSymbolicLink()
    && equalPath(await realpath(temporaryDirectory), temporaryDirectory), 'C_TEMP_REQUIRED', 'The temporary directory must be an existing ordinary C: run directory.');
  requireCondition(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE, 'NODE_CACHE_REFUSED', 'The executing process must not inherit a Node compile cache.');
  return { runRoot: selected, temporaryDirectory, approved };
}
function recipe(id, company, kinds, statuses) {
  return { version: 1, id, system: 'public-synthetic-csv', edition: '1', scope: { company, branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: kinds, allowedStatuses: statuses, onUnmapped: 'reject' };
}
function importInput(sourceId, mapping, rows, expectedMinor) {
  return { sourceId, format: 'csv', recipe: mapping, content: [sourceHeader, ...rows].join('\n'),
    expectedTotals: { rowCount: rows.length, amountMinor: expectedMinor } };
}
function month(offset, reference) {
  const from = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + offset, 1));
  const next = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: new Date(next.getTime() - 86400000).toISOString().slice(0, 10) };
}
function receiptPin(receipt) {
  return { id: receipt.id, operation: receipt.operation, totalMinor: receipt.totalMinor, figures: receipt.figures,
    currency: receipt.currency, period: receipt.period, asOf: receipt.asOf, dictionaryHash: receipt.dictionaryHash,
    definitionHash: receipt.definitionHash, requestedSourceIds: receipt.requestedSourceIds, rowIds: receipt.rowIds,
    rows: receipt.rows, databaseProof: receipt.databaseProof };
}

/** Root supervises the fresh local PostgreSQL lifecycle. This script installs nothing,
 * starts no database/server/provider, and retains only run-owned C: fixture directories. */
export async function runWorkflowNativeQualification(environment = process.env) {
  const report = { suite: 'native-engine-postgresql-duckdb-workflows', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null,
    sourceCommitVerification: 'supervisor-reported-exact-baseline', foundationCommit: FOUNDATION_COMMIT,
    passed: false, checks: [], blockers: [],
    engines: { postgres: 'not-executed', duckdb: 'not-executed' }, runtime: { node: process.version, platform: process.platform },
    scope: 'Synthetic public Engine routes, PostgreSQL encrypted authority and default native DuckDB receipt proofs; exact JavaScript forecast/alert/job answers. No HTTP server, GUI, provider, predictive-accuracy, external notification, or production-release qualification.',
    fixtures: { passphrase: 'fixed-public-synthetic-fixture', sourceKind: 'authored-synthetic-csv', learnedAt: 'actual-current-import-clock',
      forecastKnowledge: 'restated-diagnostic with current-known historical months; operational hindsight explicitly refused; no historically backdated import clock', retainedDirectory: null },
    nativeReceiptIds: [], completedFeatures: [] };
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  let phase = 'native-preflight';
  const failed = (name, error) => report.checks.push({ name, passed: false, phase, reason: safeCode(error) });
  let pool, directory;
  const handles = new Set(), nativeIds = new Set();
  let providerCalls = 0;
  try {
    requireCondition(environment.CHAUSAR_SOURCE_COMMIT === FOUNDATION_COMMIT, 'SOURCE_BASELINE_REQUIRED', 'The supervisor must pin the exact reviewed source baseline.');
    const configuration = disposablePostgresConfiguration(environment);
    const ownership = await ownedRoot(environment);
    report.sourceHashes = {};
    for (const path of ['../platform/runtime/engine.ts', '../platform/runtime/analytics.ts', '../platform/runtime/calculator.ts',
      '../platform/runtime/forecast-service.ts', '../platform/runtime/alerts.ts', '../platform/runtime/engine-jobs.ts', '../platform/runtime/job-goals.ts']) {
      report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
    }
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({ ...configuration, max: 2, ssl: false, connectionTimeoutMillis: 3000, query_timeout: 17000,
      application_name: 'chausar-native-workflow-fixture',
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
    await assertPristinePostgres(pool);
    const identity = (await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version') AS server_version,version() AS version,current_setting('data_directory') AS data_directory")).rows;
    assert.equal(identity.length, 1); assert.equal(identity[0].database, configuration.database);
    assert.equal(identity[0].address, configuration.host); assert.equal(identity[0].port, configuration.port);
    assert.ok(identity[0].version.startsWith('PostgreSQL '));
    const dataDirectory = identity[0].data_directory;
    requireCondition(typeof dataDirectory === 'string' && isAbsolute(dataDirectory), 'POSTGRES_C_DATA_REQUIRED', 'The actual native PostgreSQL cluster must report its absolute C: data directory.');
    const selectedData = resolve(dataDirectory), dataChild = relative(ownership.approved, selectedData);
    requireCondition(dataChild && !dataChild.startsWith('..') && !isAbsolute(dataChild)
      && equalPath(await realpath(selectedData), selectedData), 'POSTGRES_C_DATA_REQUIRED', 'The actual PostgreSQL cluster must keep writes below task-4 on C:.');
    requireCondition(!(await lstat(selectedData)).isSymbolicLink(), 'POSTGRES_C_DATA_REQUIRED', 'The actual PostgreSQL cluster cannot redirect writes.');
    report.environmentGuards = { runRoot: ownership.runRoot, temporaryDirectory: ownership.temporaryDirectory,
      postgresDataDirectory: selectedData, dRuntimeAccessPolicy: 'read-only-existing-files', compileCacheEnvironment: 'unset' };
    directory = await mkdtemp(join(ownership.runRoot, 'native-workflows-')); report.fixtures.retainedDirectory = directory;
    report.engines.postgres = 'native-executed';
    record('dedicated-pristine-native-postgresql-identity', 'native-postgresql', { server: identity[0] });

    async function feature(folder) {
      const options = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL,
        analytics: { operationTimeoutMs: 15000, maxRows: 500 },
        durableJobs: { workerId: 'public-synthetic-native-workflows', maxActiveJobs: 12, leaseMs: 120000, networkAvailable: () => false },
        gateway: { http: async () => { providerCalls++; throw new QualificationError('PROVIDER_DISPATCH_FORBIDDEN', 'This fixture never dispatches a model.'); } } };
      let engine = new Engine(options); handles.add(engine);
      const rpc = (method, payload = {}) => { phase = `${folder}:${method}`; return engine.request(method, payload); };
      await rpc('workspace.create', { folder, name: `PUBLIC SYNTHETIC NATIVE ${folder.toUpperCase()}`, passphrase: PUBLIC_FIXTURE_PASSPHRASE, demo: false, pack: 'ecommerce' });
      assert.equal(engine.vault.storageKind, 'postgres');
      const packs = await rpc('ontology.packs');
      const draft = structuredClone(packs.find(pack => pack.pack === 'ecommerce'));
      assert.ok(draft);
      for (const definition of draft.definitions) definition.meaning += ' Public synthetic workflow qualification: amounts are explicit INR minor units, not a live source or causal explanation.';
      const dictionary = await rpc('ontology.publish', { draft });
      const slot = hash(resolve(directory, folder));
      const noDispatch = async () => {
        assert.equal(providerCalls, 0); assert.deepEqual(await rpc('actions.list'), []);
        assert.deepEqual((await rpc('activity.list')).modelReceipts, []);
      };
      const authority = async () => {
        const rows = (await pool.query('SELECT revision::text AS revision,envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [slot])).rows;
        assert.equal(rows.length, 1); assert.equal(rows[0].revision, String(engine.vault.read().revision));
        for (const plaintext of [PUBLIC_FIXTURE_PASSPHRASE, `PUBLIC SYNTHETIC NATIVE ${folder.toUpperCase()}`, 'public-native-workflow']) assert.ok(!rows[0].envelope.includes(plaintext));
        await assert.rejects(lstat(join(directory, folder, 'authority.encrypted.json')), error => error.code === 'ENOENT');
        record(`${folder}:encrypted-authority-is-postgresql`, 'native-postgresql-ciphertext-inspection');
      };
      const reopen = async () => {
        await rpc('workspace.lock'); await engine.close(); handles.delete(engine);
        engine = new Engine(options); handles.add(engine);
        await rpc('workspace.open', { folder, passphrase: PUBLIC_FIXTURE_PASSPHRASE });
        assert.equal(engine.vault.storageKind, 'postgres');
        record(`${folder}:lock-and-fresh-engine-reopen`, 'native-postgresql-engine-reopen');
      };
      const nativeReceipt = async (receipt, expected, sourceId, imported, label) => {
        assert.equal(receipt.valueMinor, expected); assert.equal(receipt.totalMinor, expected);
        assert.equal(receipt.currency, 'INR'); assert.equal(receipt.dictionaryHash, dictionary.hash);
        assert.equal(receipt.branch, 'main'); assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
        assert.deepEqual(receipt.sourceIds, [sourceId]); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
        assert.equal(receipt.coverage.unresolvedConflicts, 0); assert.deepEqual(receipt.coverage.gaps, []);
        assert.ok(receipt.rowIds.length > 0 && receipt.rowIds.every(id => imported.rowIds.includes(id)));
        assert.equal(receipt.databaseProof?.engine, 'duckdb'); assert.equal(receipt.databaseProof?.verified, true);
        assert.equal(receipt.databaseProof.receiptId, receipt.id); assert.equal(receipt.databaseProof.operation, receipt.operation);
        assert.match(receipt.databaseProof.projectionDigest, /^[a-f0-9]{64}$/);
        assert.deepEqual(await rpc('receipts.get', { id: receipt.id }), receipt);
        nativeIds.add(receipt.id); report.engines.duckdb = 'native-executed';
        record(`${folder}:${label}:literal-amount`, 'javascript-independent-answer-key', { expectedMinor: expected });
        record(`${folder}:${label}:native-proof`, 'native-duckdb-engine-receipt', { receiptId: receipt.id, operation: receipt.operation,
          projectionDigest: receipt.databaseProof.projectionDigest });
        return receiptPin(receipt);
      };
      return { rpc, dictionary, noDispatch, authority, reopen, nativeReceipt, current: () => engine };
    }

    async function qualifyForecast() {
      const f = await feature('forecast'), sourceId = 'public-native-workflow-forecast';
      const reference = new Date(), months = [-8, -7, -6, -5, -3].map(offset => month(offset, reference));
      const values = ['10000', '20000', '30000', '45000', '62000'];
      const imported = await f.rpc('sources.import', importInput(sourceId,
        recipe('public-native-forecast-v1', 'PUBLIC SYNTHETIC NATIVE FORECAST', ['invoice'], ['issued']),
        months.map((period, i) => `month-${period.from},invoice,${period.from.slice(0, 8)}15,${values[i]},INR,main,issued,Public synthetic monthly source`), '167000'));
      assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 5);
      const knowledgeCut = new Date().toISOString(), receipts = [], pins = [];
      assert.ok(imported.at <= knowledgeCut);
      for (let i = 0; i < months.length; i++) {
        const receipt = await f.rpc('calculation.run', { operation: 'billed', sourceIds: [sourceId], branch: 'main', period: months[i], asOf: knowledgeCut });
        pins.push(await f.nativeReceipt(receipt, values[i], sourceId, imported, `month-${i + 1}`)); receipts.push(receipt);
      }
      const request = { version: 1, mode: 'restated-diagnostic', operation: 'billed', dictionaryHash: f.dictionary.hash,
        sourceIds: [sourceId], branch: 'main', horizonsMonths: [1, 3], cadenceMonths: 1, minimumTrainingMonths: 3,
        method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0,
        origins: [{ id: 'public-current-known-historical-origin', eventCutoff: months[2].to, knowledgeCut,
          trainingReceiptIds: receipts.slice(0, 3).map(receipt => receipt.id),
          targets: [{ horizonMonths: 1, receiptId: receipts[3].id }, { horizonMonths: 3, receiptId: receipts[4].id }] }] };
      await assert.rejects(f.rpc('forecasts.evaluate', { ...request, mode: 'operational-as-known' }), { code: 'FORECAST_KNOWLEDGE_LEAK' });
      record('forecast:current-known-hindsight-cannot-claim-operational-origin', 'javascript-workflow-contract-refusal', { reason: 'FORECAST_KNOWLEDGE_LEAK' });
      const saved = await f.rpc('forecasts.evaluate', request);
      assert.equal(saved.type, 'forecast-evaluation-v1'); assert.equal(saved.qualification, 'source-evidence-backtest');
      assert.equal(saved.mode, 'restated-diagnostic'); assert.match(saved.interpretation, /not historical operational performance/);
      assert.deepEqual(saved.folds.map(fold => [fold.horizonMonths, fold.actualMinor, fold.candidate.minor,
        fold.candidate.signedErrorMinor, fold.candidate.absoluteErrorMinor, fold.candidate.squaredErrorMinor, fold.benchmark.minor]),
      [[1, '45000', '40000', '-5000', '5000', '25000000', '30000'], [3, '62000', '60000', '-2000', '2000', '4000000', '30000']]);
      assert.deepEqual(saved.uncertainty, { calibratedIntervals: false, intervalType: 'none' });
      assert.match(saved.digest, /^[a-f0-9]{64}$/); assert.deepEqual(await f.rpc('forecasts.get', { id: saved.id }), saved);
      record('forecast:hand-worked-linear-trend-and-errors', 'javascript-independent-answer-key');
      await f.authority(); await f.noDispatch(); await f.reopen();
      assert.deepEqual(await f.rpc('forecasts.get', { id: saved.id }), saved);
      for (const pin of pins) assert.deepEqual(receiptPin(await f.rpc('receipts.get', { id: pin.id })), pin);
      assert.equal(f.current().vault.read().answers.filter(answer => answer.type === 'forecast-evaluation-v1').length, 1);
      record('forecast:saved-evaluation-and-native-receipt-pins-survive-reopen', 'native-postgresql-engine-persistence');
      await f.noDispatch(); report.completedFeatures.push('forecast');
    }

    async function qualifyAlerts() {
      const f = await feature('alerts'), sourceId = 'public-native-workflow-alerts', period = month(-1, new Date());
      const mapping = recipe('public-native-alert-v1', 'PUBLIC SYNTHETIC NATIVE ALERTS', ['sale'], ['delivered']);
      let ordinal = 0, lastCut = 0;
      const pins = [];
      async function measurement(value) {
        ordinal++;
        const imported = await f.rpc('sources.import', importInput(sourceId, mapping,
          [`observed-sale,sale,${period.from.slice(0, 8)}10,${value},INR,main,delivered,Public synthetic observation ${ordinal}`], value));
        assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 1);
        while (Date.now() <= lastCut) await delay(1);
        lastCut = Date.now(); const asOf = new Date(lastCut).toISOString();
        assert.ok(imported.at <= asOf);
        const receipt = await f.rpc('calculation.run', { operation: 'earned', sourceIds: [sourceId], branch: 'main', period, asOf });
        pins.push(await f.nativeReceipt(receipt, value, sourceId, imported, `observation-${ordinal}`)); return receipt;
      }
      const baseline = await measurement('5000');
      let alert = await f.rpc('alerts.create', { conditionId: 'public-native-earned-limit', label: 'Public synthetic earned threshold',
        baselineReceiptId: baseline.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' }, sourceIds: [sourceId],
        periodMode: 'fixed', direction: 'above', activateMinor: '10000', clearMinor: '8000',
        activation: { observations: 2, durationMs: 0 }, clearance: { observations: 2, durationMs: 0 },
        severity: { initial: 'warning', criticalMinor: '20000', downgrade: 'on-clear' }, reopening: 'same-episode',
        maxEvidenceAgeMs: 3600000, maxObservationGapMs: 3600000 });
      assert.equal(alert.status, 'draft');
      alert = await f.rpc('alerts.publish', { id: alert.id, expectedRevision: alert.revision });
      async function observe(value, observationId) {
        const receipt = await measurement(value), payload = { id: alert.id, expectedRevision: alert.revision,
          observationId, observedAt: receipt.asOf, receiptId: receipt.id };
        const evaluatedAt = new Date().toISOString();
        assert.ok(receipt.asOf <= evaluatedAt && receipt.createdAt <= evaluatedAt);
        const result = await f.rpc('alerts.evaluate', payload); alert = result.alert; return { ...result, payload };
      }
      assert.deepEqual((await observe('11000', 'breach-first')).notices, []);
      const opening = await observe('12000', 'breach-sustained');
      assert.deepEqual(opening.notices.map(notice => notice.transition), ['opened']);
      assert.equal(alert.episodes.length, 1); const episodeId = alert.episodes[0].id;
      const duplicate = await f.rpc('alerts.evaluate', opening.payload);
      assert.equal(duplicate.duplicate, true); assert.deepEqual(duplicate.notices, []); assert.deepEqual(duplicate.alert, alert);
      assert.deepEqual((await observe('21000', 'critical')).notices.map(notice => notice.transition), ['escalated']);
      assert.equal(alert.episodes[0].severity, 'critical');
      assert.deepEqual((await observe('9000', 'band')).notices, []); assert.equal(alert.episodes[0].status, 'open');
      assert.deepEqual((await observe('7000', 'clear-first')).notices, []);
      assert.deepEqual((await observe('7200', 'clear-sustained')).notices.map(notice => notice.transition), ['cleared']);
      assert.equal(alert.episodes[0].status, 'cleared');
      assert.deepEqual((await observe('11000', 'reopen-first')).notices, []);
      assert.deepEqual((await observe('12000', 'reopen-sustained')).notices.map(notice => notice.transition), ['reopened']);
      assert.equal(alert.episodes.length, 1); assert.equal(alert.episodes[0].id, episodeId);
      assert.equal(alert.episodes[0].reopenCount, 1); assert.equal(alert.episodes[0].status, 'open');
      assert.ok(alert.notices.every(notice => notice.delivery === 'local-only'));
      record('alerts:literal-threshold-persistence-hysteresis-and-local-episode-transitions', 'javascript-workflow-state');
      assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert);
      await f.authority(); await f.noDispatch(); await f.reopen();
      assert.deepEqual(await f.rpc('alerts.get', { id: alert.id }), alert);
      assert.deepEqual(await f.rpc('alerts.list'), [alert]);
      for (const pin of pins) assert.deepEqual(receiptPin(await f.rpc('receipts.get', { id: pin.id })), pin);
      const replay = await f.rpc('alerts.evaluate', opening.payload);
      assert.equal(replay.duplicate, true); assert.deepEqual(replay.notices, []);
      record('alerts:saved-episode-and-native-receipt-pins-survive-reopen', 'native-postgresql-engine-persistence');
      await f.noDispatch(); report.completedFeatures.push('alerts');
    }

    async function qualifyJobs() {
      const f = await feature('jobs'), sourceId = 'public-native-workflow-jobs';
      const imported = await f.rpc('sources.import', importInput(sourceId,
        recipe('public-native-jobs-v1', 'PUBLIC SYNTHETIC NATIVE JOBS', ['invoice', 'payment'], ['issued', 'settled']), [
          'july-invoice,invoice,2026-07-02,50000,INR,main,issued,Public synthetic July invoice',
          'july-payment,payment,2026-07-03,30000,INR,main,settled,Public synthetic July payment',
          'august-invoice,invoice,2026-08-02,70000,INR,main,issued,Public synthetic August invoice',
          'august-payment,payment,2026-08-03,15000,INR,main,settled,Public synthetic August payment',
        ], '165000'));
      assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 4);
      await f.rpc('trust.update', { autonomy: true, send: 'nothing' });
      assert.equal((await f.rpc('jobs.types')).configured, true);
      const cut = new Date().toISOString(), ids = ['july-collections', 'august-collections'];
      const periods = [{ from: '2026-07-01', to: '2026-07-31' }, { from: '2026-08-01', to: '2026-08-31' }];
      const job = await f.rpc('jobs.create', { type: 'calculation-set', goal: 'Measure explicitly selected synthetic July and August settled collections',
        input: { requests: ids.map((id, i) => ({ id, input: { operation: 'received', sourceIds: [sourceId], branch: 'main', period: periods[i], asOf: cut }, reserveMinor: '1', durationMs: 30000 })) },
        sourceIds: [sourceId], budgetMinor: '10', reserveMinor: '2', limits: { modelUnits: 0, durationMs: 120000, actionExposureMinor: '0' },
        stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 300000).toISOString() }, nextRunAt: cut, intervalMs: 60000, graceMs: 0,
        catchup: 'latest', background: false, testedRoutes: [], allowedActions: [], requiresApproval: false });
      assert.deepEqual((await f.rpc('jobs.progress', { id: job.id })).remainingStepIds, ids);
      const completed = await f.rpc('jobs.run', { id: job.id });
      assert.equal(completed.status, 'awaiting-acceptance');
      const calculations = completed.deliverable.result.calculations;
      assert.deepEqual(calculations.map(value => value.id), ids);
      assert.deepEqual(calculations.map(value => value.value.valueMinor), ['30000', '15000']);
      assert.equal(completed.execution.attempts.length, 2); assert.ok(completed.execution.attempts.every(attempt => attempt.status === 'verified'));
      assert.equal(completed.spentMinor, '0'); assert.equal(completed.reservedMinor, '0');
      assert.equal(completed.execution.meters.modelUnits, 0); assert.equal(completed.execution.meters.actionExposureMinor, '0');
      const pins = [];
      for (let i = 0; i < calculations.length; i++) {
        const step = calculations[i];
        assert.equal(step.informationClass, 'computation'); assert.equal(step.sourceTainted, true);
        assert.deepEqual(step.evidenceIds, [step.value.receiptId]);
        const receipt = await f.rpc('receipts.get', { id: step.value.receiptId });
        assert.equal(receipt.asOf, cut); assert.deepEqual(receipt.period, periods[i]);
        assert.ok(completed.execution.attempts.some(attempt => attempt.key === receipt.jobOperation?.key));
        pins.push(await f.nativeReceipt(receipt, ['30000', '15000'][i], sourceId, imported, ids[i]));
      }
      record('jobs:literal-collections-and-no-model-or-action-budget-use', 'javascript-independent-answer-key');
      const receiptCount = f.current().vault.read().receipts.length;
      await f.authority(); await f.noDispatch(); await f.reopen();
      assert.deepEqual((await f.rpc('jobs.list')).find(value => value.id === job.id), completed);
      for (const pin of pins) assert.deepEqual(receiptPin(await f.rpc('receipts.get', { id: pin.id })), pin);
      assert.equal((await f.rpc('jobs.run', { id: job.id })).status, 'awaiting-acceptance');
      assert.equal(f.current().vault.read().receipts.length, receiptCount);
      assert.equal((await f.rpc('jobs.accept', { id: job.id })).status, 'accepted');
      assert.equal((await f.rpc('jobs.run', { id: job.id })).status, 'accepted');
      assert.equal(f.current().vault.read().receipts.length, receiptCount);
      record('jobs:persisted-result-exact-retry-and-acceptance-survive-reopen', 'native-postgresql-engine-persistence');
      await f.authority(); await f.reopen();
      const accepted = (await f.rpc('jobs.list')).find(value => value.id === job.id);
      assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.deliverable, completed.deliverable);
      assert.equal((await f.rpc('jobs.run', { id: job.id })).status, 'accepted');
      assert.equal(f.current().vault.read().receipts.length, receiptCount);
      record('jobs:accepted-result-retained-across-second-fresh-engine-reopen', 'native-postgresql-engine-persistence');
      await f.noDispatch(); report.completedFeatures.push('durable-jobs');
    }

    for (const [name, run] of [['forecast', qualifyForecast], ['alerts', qualifyAlerts], ['durable-jobs', qualifyJobs]]) {
      try { await run(); }
      catch (error) { failed(`${name}:qualification`, error); }
    }
    assert.equal(providerCalls, 0);
    record('all-features:no-model-provider-dispatch-or-external-action', 'javascript-no-dispatch-assertion');
  } catch (error) { report.blockers.push({ phase, reason: safeCode(error) }); }
  finally {
    for (const engine of handles) { try { await engine.close(); } catch (error) { failed('close-owned-feature-engine', error); } }
    try { await pool?.end(); } catch (error) { failed('close-owned-inspection-pool', error); }
  }
  report.nativeReceiptIds = [...nativeIds];
  report.passed = report.blockers.length === 0 && report.checks.length > 0 && report.checks.every(check => check.passed)
    && report.engines.postgres === 'native-executed' && report.engines.duckdb === 'native-executed'
    && report.completedFeatures.length === 3 && nativeIds.size >= 16;
  return report;
}

if (process.argv[1] && equalPath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const report = await runWorkflowNativeQualification();
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.passed ? 0 : 1;
}
