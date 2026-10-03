import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { independentPeriod, independentSources } from '../platform/tests/fixtures/alert-brief-independent-public-acceptance.ts';
import { assertPristinePostgres, disposablePostgresConfiguration, QualificationError } from './verify-database-differential.mjs';

/** Native adaptation of the public alert-brief journeys at the exact source below.
 * The imported public fixture constants bind its source identities and period;
 * its experimental-file host and JavaScript-only calculator are never invoked.
 * Root supplies a fresh PostgreSQL server. This runner installs nothing, starts
 * no database service, and writes only run-owned synthetic fixtures on C:.
 * SQL below inspects real authority rows; calculations use Engine's default
 * native DuckDB verifier. Alert/brief projection remains deterministic JavaScript. */
const FOUNDATION_COMMIT = '87c400870563b92803841d3a198cee801f7740df';
const FOUNDATION_TREE = '84658363a35be7f31a148d676fdea18ec3669e68';
const TASK_ROOT = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
const PUBLIC_FIXTURE_PASSPHRASE = 'PUBLIC SYNTHETIC ALERT BRIEF QUALIFICATION PASSPHRASE 2026';
const EXPECTED_CHECKS = 19;
const EXPIRES_MS = 10000;
const HTTP_DEADLINE_MS = 65000;
const ANALYTICS_DEADLINE_MS = 10000;
const REPORT_EXPECTATIONS = { billed: '0', received: '0', net_sales: '12000', margin: '12000', aging: '0' };
const safeCode = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
  ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'ALERT_BRIEF_NATIVE_QUALIFICATION_FAILED';
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const childPath = (parent, target) => { const suffix = relative(parent, target); return suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep); };
function requireCondition(value, code, message) { if (!value) throw new QualificationError(code, message); }

async function canonicalDirectory(path, approved) {
  const selected = resolve(path);
  requireCondition(childPath(approved, selected), 'C_FIXTURE_OWNERSHIP_REQUIRED', 'Fixture directories must be strictly below the approved C: task workspace.');
  let current = approved;
  for (const segment of relative(approved, selected).split(/[\\/]/)) {
    current = join(current, segment);
    const info = await lstat(current);
    requireCondition(info.isDirectory() && !info.isSymbolicLink() && samePath(await realpath(current), resolve(current)),
      'C_FIXTURE_OWNERSHIP_REQUIRED', 'Fixture directories must be existing canonical ordinary directories.');
  }
  return selected;
}
async function ownedRoot(environment) {
  requireCondition(process.platform === 'win32', 'WINDOWS_C_FIXTURE_REQUIRED', 'This profile requires supervised Windows C: fixtures.');
  const approved = await realpath(TASK_ROOT);
  requireCondition(samePath(approved, TASK_ROOT) && /^C:[\\/]/i.test(approved), 'C_FIXTURE_OWNERSHIP_REQUIRED', 'The approved task root cannot redirect writes.');
  requireCondition(typeof environment.CHAUSAR_QUALIFICATION_RUN_ROOT === 'string' && isAbsolute(environment.CHAUSAR_QUALIFICATION_RUN_ROOT),
    'C_FIXTURE_ROOT_REQUIRED', 'Supply an explicit existing absolute supervised C: run directory.');
  const runRoot = await canonicalDirectory(environment.CHAUSAR_QUALIFICATION_RUN_ROOT, approved);
  const temporaryDirectory = await canonicalDirectory(join(runRoot, 'temp'), approved);
  for (const name of ['TEMP', 'TMP']) requireCondition(samePath(resolve(environment[name] ?? ''), temporaryDirectory)
    && samePath(resolve(process.env[name] ?? ''), temporaryDirectory), 'C_TEMP_REQUIRED', 'Both actual and supplied Windows temporary paths must be the supervised C: temp directory.');
  requireCondition(samePath(resolve(tmpdir()), temporaryDirectory), 'C_TEMP_REQUIRED', 'Node temporary files must use the same supervised C: temp directory.');
  requireCondition(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE, 'NODE_CACHE_REFUSED', 'Unset Node compile cache before launching this runner.');
  return { approved, runRoot, temporaryDirectory };
}

export async function runAlertBriefNativeQualification(environment = process.env) {
  const report = { suite: 'native-public-alert-brief-current-evidence', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null,
    sourceCommitVerification: 'supervisor-reported-exact-baseline', foundationCommit: FOUNDATION_COMMIT, foundationTree: FOUNDATION_TREE,
    passed: false, checks: [], blockers: [], engines: { postgres: 'not-executed', duckdb: 'not-executed' },
    runtime: { node: process.version, platform: process.platform }, expectedChecks: EXPECTED_CHECKS,
    fixtureBasis: ['platform/tests/fixtures/alert-brief-independent-public-acceptance.ts', 'platform/tests/alert-brief-additional-independent-public-acceptance.test.ts', 'docs/alert-brief-freshness.md'],
    fixtures: { passphrase: 'fixed-public-synthetic-fixture', sourceKind: 'experimental-synthetic-csv', learnedAt: 'actual-current-import-clock',
      alertExpiryMs: EXPIRES_MS, observationGapMs: 3600000, clock: 'actual-host-clock-no-forged-time', retainedDirectory: null },
    deadlines: { httpRequestMs: HTTP_DEADLINE_MS, analyticsOperationMs: ANALYTICS_DEADLINE_MS, inspectionPoolQueryMs: 17000,
      inspectionPoolStatementMs: 15000, inspectionPoolLockMs: 5000, closeHttpMs: 20000, expiryWaitCeilingMs: 12000, externalSupervisorMs: 240000,
      enginePersistence: 'Engine adapter has no per-query client timer; supervisor server-wide SQL deadlines are checked through a separate connection without session options.' },
    nativeReceiptIds: [], completedJourneys: [], scope: 'Actual paired loopback HTTP and production Engine; PostgreSQL encrypted authority persistence, native DuckDB receipt arithmetic, and deterministic JavaScript alert/brief projection. Synthetic inputs only; no PostgreSQL arithmetic claim, provider, live connector, GUI, delivery or release qualification.',
    limitations: ['Day-long policy retention expiry is not accelerated or qualified by this actual-clock run.',
      'Writer-candidate freshness races and competing PostgreSQL writers require a separate controlled native concurrency gate.',
      'Logical authority-row readback does not establish unchanged physical database pages, WAL or filesystem bytes.'] };
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  let phase = 'native-preflight', pool, directory, providerCalls = 0;
  const hosts = new Set(), nativeIds = new Set();
  try {
    requireCondition(environment.CHAUSAR_SOURCE_COMMIT === FOUNDATION_COMMIT, 'SOURCE_BASELINE_REQUIRED', 'The supervisor must pin the exact published 87c4008 source.');
    const ownership = await ownedRoot(environment), configuration = disposablePostgresConfiguration(environment);
    report.sourceHashes = {};
    for (const path of [...report.fixtureBasis, 'platform/runtime/engine.ts', 'platform/runtime/jobs.ts', 'platform/runtime/reports.ts',
      'platform/runtime/alerts.ts', 'platform/runtime/alerts-contracts.ts', 'platform/runtime/conversation-history.ts', 'platform/runtime/analytics.ts', 'platform/runtime/postgres.ts']) {
      report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL('../' + path, import.meta.url))).digest('hex');
    }
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool, Client = pg.Client ?? pg.default?.Client;
    pool = new Pool({ ...configuration, ssl: false, max: 2, connectionTimeoutMillis: 3000, query_timeout: 17000,
      application_name: 'public-synthetic-alert-brief-native', options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
    await assertPristinePostgres(pool);
    const identities = (await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version') AS server_version,current_setting('listen_addresses') AS listen_addresses,current_setting('data_directory') AS data_directory")).rows;
    assert.equal(identities.length, 1); const identity = identities[0];
    assert.equal(identity.database, 'chausar_test'); assert.equal(identity.address, configuration.host); assert.equal(identity.address, '127.0.0.1');
    assert.equal(identity.port, configuration.port); assert.equal(identity.listen_addresses, '127.0.0.1'); assert.equal(identity.server_version, '18.6');
    assert.ok(typeof identity.data_directory === 'string' && isAbsolute(identity.data_directory));
    const dataDirectory = await canonicalDirectory(identity.data_directory, ownership.approved);
    // The application adapter does not inherit this inspection pool's options.
    // Read default settings through an actual connection with no session options.
    const deadlineClient = new Client({ ...configuration, ssl: false, options: '', connectionTimeoutMillis: 3000, query_timeout: 5000 });
    try {
      await deadlineClient.connect();
      const defaults = (await deadlineClient.query("SELECT name,setting::int AS milliseconds FROM pg_settings WHERE name IN ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout') ORDER BY name")).rows;
      const values = Object.fromEntries(defaults.map(row => [row.name, row.milliseconds]));
      for (const [name, ceiling] of [['statement_timeout', 15000], ['lock_timeout', 5000], ['idle_in_transaction_session_timeout', 15000]])
        requireCondition(Number.isSafeInteger(values[name]) && values[name] > 0 && values[name] <= ceiling,
          'SUPERVISED_SERVER_DEADLINES_REQUIRED', 'Production Engine persistence requires bounded supervisor server-wide SQL defaults.');
      report.deadlines.actualServerDefaultsMs = values;
    } finally { await deadlineClient.end(); }
    report.environmentGuards = { runRoot: ownership.runRoot, temporaryDirectory: ownership.temporaryDirectory, postgresDataDirectory: dataDirectory,
      dRuntimeAccessPolicy: 'read-only-existing-files', compileCacheEnvironment: 'unset' };
    directory = await mkdtemp(join(ownership.runRoot, 'native-alert-brief-')); report.fixtures.retainedDirectory = directory;
    report.engines.postgres = 'native-executed'; record('pristine-dedicated-native-postgresql-identity', 'native-postgresql-actual-query', { server: identity });

    async function host(folder) {
      const name = 'PUBLIC SYNTHETIC NATIVE ALERT BRIEF ' + folder.toUpperCase();
      const options = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL,
        analytics: { operationTimeoutMs: ANALYTICS_DEADLINE_MS, maxRows: 500 }, gateway: {
          http: async () => { providerCalls++; throw new QualificationError('PROVIDER_DISPATCH_FORBIDDEN', 'Synthetic qualification forbids provider dispatch.'); },
          process: async () => { providerCalls++; throw new QualificationError('PROVIDER_DISPATCH_FORBIDDEN', 'Synthetic qualification forbids model processes.'); } } };
      let engine, server, pairing, dictionary, lastCut = 0;
      const start = async () => {
        engine = new Engine(options); server = createLocalServer(engine); pairing = await server.listen();
        assert.equal(new URL(pairing.origin).hostname, '127.0.0.1');
        const response = await fetch(`${pairing.origin}/api/session`, { headers: { authorization: `Bearer ${pairing.token}` }, signal: AbortSignal.timeout(20000) });
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), { token: pairing.token });
      };
      const close = async () => { if (server) { await server.close(20000); server = undefined; } else await engine?.close(); };
      const h = { close }; hosts.add(h); await start();
      const raw = async (method, payload = {}, bearer = pairing.token) => {
        phase = `${folder}:${method}`;
        const response = await fetch(`${pairing.origin}/api/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
          body: JSON.stringify({ method, payload }), signal: AbortSignal.timeout(HTTP_DEADLINE_MS) });
        return { status: response.status, body: await response.json() };
      };
      const rpc = async (method, payload = {}, bearer = pairing.token) => {
        const response = await raw(method, payload, bearer);
        if (response.body.error) throw new QualificationError(response.body.error.code, 'Synthetic public RPC refused.');
        assert.equal(response.status, 200); return response.body.result;
      };
      const refusal = async (method, payload, expectedCode, bearer = pairing.token) => {
        const before = engine.vault.read(), authorityBefore = await authorityRow();
        const response = await raw(method, payload, bearer);
        assert.notEqual(response.status, 200); assert.equal(response.body.result, undefined); assert.equal(response.body.error.code, expectedCode);
        assert.deepEqual(engine.vault.read(), before, 'Public refusal preserves the exact authority snapshot.');
        assert.deepEqual(await authorityRow(), authorityBefore, 'Public refusal preserves the actual persisted logical authority row.');
      };
      await rpc('workspace.create', { folder, name, passphrase: PUBLIC_FIXTURE_PASSPHRASE, demo: false, pack: 'ecommerce' });
      assert.equal(engine.vault.storageKind, 'postgres');
      dictionary = await rpc('ontology.publish', { pack: 'ecommerce' }); await rpc('trust.update', { send: 'nothing', autonomy: true });
      const slot = hash(resolve(directory, folder));
      async function authorityRow() {
        const rows = (await pool.query('SELECT revision::text AS revision,envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [slot])).rows;
        assert.equal(rows.length, 1); assert.equal(rows[0].revision, String(engine.vault.read().revision));
        for (const marker of [PUBLIC_FIXTURE_PASSPHRASE, name, 'INDEPENDENT PRIVATE A SALES', 'INDEPENDENT_SYNTHETIC_a']) assert.ok(!rows[0].envelope.includes(marker));
        await assert.rejects(lstat(join(directory, folder, 'authority.encrypted.json')), error => error.code === 'ENOENT');
        return rows[0];
      }
      const nextCut = async () => { const deadline = performance.now() + 1000; while (Date.now() <= lastCut) { requireCondition(performance.now() < deadline, 'HOST_CLOCK_PROGRESS_REQUIRED', 'The real host clock must progress within one second.'); await delay(1); } lastCut = Date.now(); return new Date(lastCut).toISOString(); };
      const nativeReceipt = async (receipt, expected, allowedSources, bearer = pairing.token) => {
        assert.equal(receipt.valueMinor, expected); assert.equal(receipt.totalMinor, expected); assert.equal(receipt.currency, 'INR');
        assert.equal(receipt.dictionaryHash, dictionary.hash); assert.equal(receipt.databaseProof?.engine, 'duckdb'); assert.equal(receipt.databaseProof?.verified, true);
        assert.equal(receipt.databaseProof.receiptId, receipt.id); assert.equal(receipt.databaseProof.operation, receipt.operation);
        assert.match(receipt.databaseProof.projectionDigest, /^[a-f0-9]{64}$/);
        assert.deepEqual(receipt.requestedSourceIds, allowedSources); assert.ok(receipt.sourceIds.every(id => allowedSources.includes(id)));
        assert.deepEqual(await rpc('receipts.get', { id: receipt.id }, bearer), receipt); nativeIds.add(receipt.id); report.engines.duckdb = 'native-executed';
        return receipt;
      };
      const importSale = async (which, minor) => {
        assert.ok(['5000', '9000', '12000'].includes(minor));
        const sourceId = independentSources[which], amount = { '5000': '50.00', '9000': '90.00', '12000': '120.00' }[minor];
        const startedAt = Date.now();
        const imported = await rpc('sources.import', { sourceId, format: 'csv', content: 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n'
          + `${which}-sale,sale,2026-09-09,${amount},INR,${which}-customer,${which}-invoice,${which}-order,,delivered,INDEPENDENT_SYNTHETIC_${which},main\n`,
          expectedTotals: { rowCount: 1, amountMinor: minor } });
        assert.equal(imported.qualification, 'experimental'); assert.equal(imported.coverage.reconciled, true); assert.equal(imported.totalsMinor, minor);
        for (const id of imported.rowIds) { const learnedAt = Date.parse(engine.vault.read().facts.find(fact => fact.id === id).learnedAt); assert.ok(learnedAt >= startedAt && learnedAt <= Date.now(), 'Synthetic fact knowledge timestamps come from this actual current import, without backdating.'); }
        return imported;
      };
      const measurement = async (which, minor, bearer = pairing.token) => {
        await importSale(which, minor);
        return nativeReceipt(await rpc('calculation.run', { operation: 'earned', branch: 'main', sourceIds: [independentSources[which]], period: independentPeriod, asOf: await nextCut() }, bearer), minor, [independentSources[which]], bearer);
      };
      const condition = async (which, maxEvidenceAgeMs = 3600000, bearer = pairing.token) => {
        const baseline = await measurement(which, '5000', bearer);
        const draft = await rpc('alerts.create', { conditionId: 'independent-condition-' + which, label: 'INDEPENDENT PRIVATE ' + which.toUpperCase() + ' SALES',
          baselineReceiptId: baseline.id, figureKey: 'total', unit: { kind: 'money', currency: 'INR' }, sourceIds: [independentSources[which]], periodMode: 'fixed', direction: 'above',
          activateMinor: '10000', clearMinor: '8000', activation: { observations: 1, durationMs: 0 }, clearance: { observations: 1, durationMs: 0 },
          severity: { initial: 'warning', downgrade: 'on-clear' }, reopening: 'same-episode', maxEvidenceAgeMs, maxObservationGapMs: 3600000 }, bearer);
        const published = await rpc('alerts.publish', { id: draft.id, expectedRevision: draft.revision }, bearer);
        const receipt = await measurement(which, '12000', bearer);
        const evaluated = await rpc('alerts.evaluate', { id: published.id, expectedRevision: published.revision,
          observationId: 'independent-breach-' + which, observedAt: receipt.asOf, receiptId: receipt.id }, bearer);
        assert.equal(evaluated.duplicate, false); assert.equal(evaluated.alert.episodes.length, 1);
        assert.equal(evaluated.alert.episodes[0].status, 'open'); assert.equal(evaluated.alert.episodes[0].severity, 'warning'); assert.equal(evaluated.alert.episodes[0].uncertain, false);
        return { alert: evaluated.alert, receipt };
      };
      const reportReceipts = async (brief, allowedSources, expectedSales = '12000', bearer = pairing.token) => {
        assert.equal(brief.report.sections.length, 5); assert.equal(brief.report.receiptIds.length, 5);
        assert.deepEqual(brief.report.sections.map(section => section.title), Object.keys(REPORT_EXPECTATIONS));
        const receipts = [];
        for (const section of brief.report.sections) {
          const receipt = await rpc('receipts.get', { id: section.receiptId }, bearer);
          const expected = ['net_sales', 'margin'].includes(section.title) ? expectedSales : REPORT_EXPECTATIONS[section.title];
          await nativeReceipt(receipt, expected, allowedSources, bearer); assert.equal(receipt.stale, false); receipts.push(receipt);
        }
        assert.deepEqual([...new Set([...brief.report.receiptIds, ...brief.alerts.receiptIds])].sort(), [...brief.receiptIds].sort());
        return receipts;
      };
      const delivered = async (which, alertId, bearer = pairing.token) => {
        const job = await rpc('jobs.create', { type: 'owner-brief', goal: 'Prepare the exact independent synthetic source brief', sourceIds: [independentSources[which]],
          budgetMinor: '100', reserveMinor: '10', requiresApproval: true, intervalMs: 60000, graceMs: 0, catchup: 'latest',
          stopRule: { maxRuns: 2, deadline: new Date(Date.now() + 180000).toISOString() } }, bearer);
        assert.equal((await rpc('jobs.run', { id: job.id }, bearer)).status, 'approval-blocked');
        const approved = await rpc('jobs.approve', { id: job.id, digest: job.digest }, bearer); assert.equal(approved.approval.digest, job.digest); assert.equal(approved.approval.revision, job.revision);
        const result = await rpc('jobs.run', { id: job.id }, bearer);
        assert.equal(result.status, 'awaiting-acceptance'); assert.equal(result.deliverable.kind, 'brief');
        const brief = result.deliverable.result; assert.equal(brief.alerts.configured, true); assert.equal(brief.alerts.evaluated, false);
        assert.deepEqual(brief.alerts.scope, { branch: null, sourceIds: [independentSources[which]] });
        assert.deepEqual(brief.alerts.items.map(item => item.alertId), alertId ? [alertId] : []);
        if (alertId) assert.deepEqual(brief.alerts.items[0].evidence, { state: 'current', issues: [] });
        const receipts = await reportReceipts(brief, [independentSources[which]], '12000', bearer);
        return { job: result, receipts };
      };
      const retainedJob = id => structuredClone(engine.vault.read().jobs.find(job => job.id === id));
      const retainedAlerts = () => structuredClone(engine.vault.read().answers.filter(answer => answer.kind === 'business-alert-v1'));
      const currentCache = async job => {
        const before = engine.vault.read(), authorityBefore = await authorityRow();
        assert.deepEqual((await rpc('jobs.list')).find(item => item.id === job.id).deliverable, job.deliverable);
        assert.deepEqual(engine.vault.read(), before); assert.deepEqual(await authorityRow(), authorityBefore);
      };
      const withheld = async id => { const listed = (await rpc('jobs.list')).find(job => job.id === id); assert.ok(listed); assert.equal(listed.deliverable, undefined); };
      const restart = async () => { await rpc('workspace.lock'); await close(); await start(); await rpc('workspace.open', { folder, passphrase: PUBLIC_FIXTURE_PASSPHRASE }); assert.equal(engine.vault.storageKind, 'postgres'); };
      const member = async () => { const invitation = await rpc('auth.invite', { name: 'PUBLIC SYNTHETIC BRIEF COFOUNDER', role: 'cofounder', branches: ['main'] }); return rpc('auth.accept', { token: invitation.token }); };
      const noDispatch = () => { const state = engine.vault.read(); assert.equal(providerCalls, 0); assert.equal(state.modelReceipts.length, 0); assert.equal(state.actions.length, 0); assert.equal(state.schedules.length, 0); assert.equal(state.policy.send, 'nothing'); };
      return { rpc, refusal, nextCut, measurement, importSale, condition, reportReceipts, delivered, retainedJob, retainedAlerts, currentCache, withheld, restart, member, authorityRow, noDispatch, snapshot: () => engine.vault.read() };
    }

    async function currentJourney() {
      const f = await host('current'), known = await f.condition('a'), { job, receipts } = await f.delivered('a', known.alert.id);
      record('current-private-alert-and-five-native-report-receipts', 'native-duckdb-arithmetic-and-javascript-public-brief', { reportReceiptIds: receipts.map(receipt => receipt.id), expectedSalesMinor: '12000' });
      const retained = f.retainedAlerts(); await f.currentCache(job); assert.deepEqual(f.retainedAlerts(), retained);
      record('current-cache-reads-preserve-snapshot-and-postgresql-authority-row', 'native-postgresql-logical-row-and-public-read');
      await f.restart(); await f.currentCache(job); assert.deepEqual(f.retainedAlerts(), retained);
      const accepted = await f.rpc('jobs.accept', { id: job.id }); assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.deliverable, job.deliverable);
      assert.equal(f.retainedJob(job.id).ledger.filter(item => item.event === 'accepted').length, 1);
      record('current-cache-reopen-and-exact-owner-acceptance', 'native-postgresql-reopen-and-public-http');
      await f.restart(); const read = (await f.rpc('jobs.list')).find(item => item.id === job.id);
      assert.equal(read.status, 'accepted'); assert.deepEqual(read.deliverable, job.deliverable); assert.equal(f.retainedJob(job.id).ledger.filter(item => item.event === 'accepted').length, 1);
      for (const receipt of receipts) assert.deepEqual(await f.rpc('receipts.get', { id: receipt.id }), receipt);
      record('accepted-result-and-single-acceptance-ledger-survive-second-reopen', 'native-postgresql-persistence');
      f.noDispatch(); report.completedJourneys.push('current');
    }
    async function expiryJourney() {
      const f = await host('expiry'), known = await f.condition('a', EXPIRES_MS), { job } = await f.delivered('a', known.alert.id);
      const alerts = f.retainedAlerts(), retained = f.retainedJob(job.id), authority = await f.authorityRow();
      const expiration = Math.min(Date.parse(known.receipt.asOf), Date.parse(known.receipt.createdAt)) + EXPIRES_MS;
      const waitMs = expiration - Date.now() + 100;
      requireCondition(waitMs > 0 && waitMs <= 12000, 'INITIAL_CURRENT_EVIDENCE_WINDOW_MISSED', 'The native brief must complete inside its real ten-second current-evidence window.');
      const waitStartedAt = new Date().toISOString(); await delay(waitMs);
      assert.deepEqual(f.retainedAlerts(), alerts); assert.deepEqual(await f.authorityRow(), authority);
      record('actual-host-clock-only-ten-second-alert-receipt-expiry', 'actual-host-clock-and-native-postgresql-unchanged-logical-row', { waitMs, waitStartedAt, readAt: new Date().toISOString() });
      await f.withheld(job.id);
      for (const repeat of [false, true]) await f.refusal('jobs.accept', { id: job.id, repeat }, 'JOB_EVIDENCE_REVOKED');
      assert.deepEqual(f.retainedJob(job.id), retained); assert.deepEqual(f.retainedAlerts(), alerts);
      record('expired-cache-acceptance-and-repeat-refuse-without-consuming-run', 'public-http-refusal-and-native-postgresql-logical-row');
      await f.restart(); await f.withheld(job.id); await f.refusal('jobs.accept', { id: job.id, repeat: true }, 'JOB_EVIDENCE_REVOKED');
      const brief = await f.rpc('reports.brief', { period: independentPeriod, sourceIds: [independentSources.a], onDate: '2026-09-01' });
      await f.reportReceipts(brief, [independentSources.a]);
      const item = brief.alerts.items[0]; assert.equal(item.revision, known.alert.revision); assert.deepEqual(item.episodes, known.alert.episodes);
      assert.equal(item.evidence.state, 'uncertain'); assert.ok(item.evidence.issues.includes('expired-evidence')); assert.ok(!item.evidence.issues.includes('observation-gap'));
      assert.notEqual(brief.alerts.pin, job.deliverable.result.alerts.pin); assert.deepEqual(f.retainedAlerts(), alerts); assert.deepEqual(f.retainedJob(job.id), retained);
      record('expired-reopen-and-past-briefing-date-preserve-open-history', 'native-postgresql-reopen-native-duckdb-report-and-javascript-uncertainty');
      f.noDispatch(); report.completedJourneys.push('expiry');
    }
    async function correctionJourney() {
      const f = await host('correction'); await f.measurement('a', '12000');
      const { job, receipts } = await f.delivered('a'); const retained = f.retainedJob(job.id), savedPin = job.deliverable.result.alerts.pin;
      assert.deepEqual(job.deliverable.result.alerts.items, []);
      record('report-only-correction-baseline-has-five-current-native-receipts', 'native-duckdb-independent-literal-answer', { expectedSalesMinor: '12000', alertItems: 0 });
      await f.importSale('a', '9000');
      for (const old of receipts) { const read = await f.rpc('receipts.get', { id: old.id }); assert.equal(read.stale, true); assert.deepEqual(read.figures, old.figures); assert.deepEqual(read.rows, old.rows); assert.equal(read.valueMinor, old.valueMinor); }
      const fresh = await f.rpc('reports.brief', { period: independentPeriod, sourceIds: [independentSources.a] });
      await f.reportReceipts(fresh, [independentSources.a], '9000'); assert.equal(fresh.alerts.pin, savedPin);
      await f.withheld(job.id); assert.deepEqual(f.retainedJob(job.id), retained);
      record('stale-historical-report-is-withheld-despite-unchanged-empty-alert-pin', 'native-duckdb-current-9000-vs-retained-12000-and-public-read', { invalidation: 'replacement-import', historicalMinor: '12000', currentMinor: '9000' });
      for (const repeat of [false, true]) await f.refusal('jobs.accept', { id: job.id, repeat }, 'JOB_EVIDENCE_REVOKED');
      await f.restart(); await f.withheld(job.id); await f.refusal('jobs.accept', { id: job.id, repeat: true }, 'JOB_EVIDENCE_REVOKED');
      assert.deepEqual(f.retainedJob(job.id), retained);
      record('stale-report-refusals-and-reopen-preserve-old-run-budget-and-schedule', 'native-postgresql-persistence-and-public-http-refusal');
      f.noDispatch(); report.completedJourneys.push('correction');
    }
    async function scopeJourney() {
      const f = await host('scope'), b = await f.condition('b'), a = await f.condition('a'), { job } = await f.delivered('a', a.alert.id);
      const saved = structuredClone(job.deliverable), retainedA = await f.rpc('alerts.get', { id: a.alert.id });
      assert.ok(!JSON.stringify(saved.result).includes('INDEPENDENT PRIVATE B SALES'));
      for (const id of saved.result.receiptIds) { const receipt = await f.rpc('receipts.get', { id }); assert.ok(!receipt.sourceIds.includes(independentSources.b)); assert.ok(!(receipt.requestedSourceIds ?? []).includes(independentSources.b)); }
      const wholeBefore = await f.rpc('reports.brief', { period: independentPeriod });
      const section = wholeBefore.report.sections.find(item => item.title === 'net_sales');
      const combined = await f.rpc('receipts.get', { id: section.receiptId }); assert.equal(combined.valueMinor, '24000'); assert.equal(combined.databaseProof.engine, 'duckdb'); assert.equal(combined.databaseProof.verified, true); nativeIds.add(combined.id);
      record('source-a-12000-and-independent-source-b-12000-total-24000-only-unscoped', 'native-duckdb-independent-two-source-answer-key');
      const changed = await f.rpc('alerts.evaluate', { id: b.alert.id, expectedRevision: b.alert.revision, observationId: 'independent-b-now-unavailable',
        observedAt: await f.nextCut(), missingReason: 'Independent source B observation unavailable.' });
      assert.equal(changed.alert.revision, b.alert.revision + 1); assert.deepEqual(await f.rpc('alerts.get', { id: a.alert.id }), retainedA);
      const whole = await f.rpc('reports.brief', { period: independentPeriod });
      assert.equal(whole.alerts.items.find(item => item.alertId === b.alert.id).evidence.state, 'uncertain'); assert.notEqual(whole.alerts.pin, wholeBefore.alerts.pin);
      await f.currentCache(job);
      record('outside-mandate-unavailable-b-observation-preserves-current-a-cache', 'public-http-javascript-scope-pin-and-native-postgresql-read');
      await f.restart(); await f.currentCache(job);
      const accepted = await f.rpc('jobs.accept', { id: job.id }); assert.equal(accepted.status, 'accepted'); assert.deepEqual(accepted.deliverable, saved);
      assert.equal(f.retainedJob(job.id).ledger.filter(item => item.event === 'accepted').length, 1);
      record('exact-source-a-cache-survives-reopen-and-remains-acceptable', 'native-postgresql-persistence-and-public-owner-acceptance');
      f.noDispatch(); report.completedJourneys.push('scope');
    }
    async function withdrawalJourney() {
      const f = await host('withdrawal'), known = await f.condition('a'), { job } = await f.delivered('a', known.alert.id);
      const retained = f.retainedJob(job.id), alerts = f.retainedAlerts(); await f.authorityRow();
      record('source-withdrawal-starts-from-native-current-private-brief', 'native-duckdb-receipts-and-native-postgresql-authority');
      await f.rpc('trust.update', { allowedSources: [] });
      for (let i = 0; i < 2; i++) {
        assert.ok(!(await f.rpc('jobs.list')).some(item => item.id === job.id)); await f.refusal('jobs.accept', { id: job.id }, 'SOURCE_REVOKED');
        assert.deepEqual(f.retainedJob(job.id), retained); assert.deepEqual(f.retainedAlerts(), alerts);
        if (i === 0) await f.restart();
      }
      const brief = await f.rpc('reports.brief', { period: independentPeriod }); assert.deepEqual(brief.alerts.items, []); assert.deepEqual(brief.alerts.receiptIds, []);
      assert.ok(!JSON.stringify(brief).includes('INDEPENDENT PRIVATE A SALES'));
      record('withdrawn-source-hides-cache-and-refuses-acceptance-across-reopen', 'native-postgresql-retained-history-and-public-source-refusal');
      f.noDispatch(); report.completedJourneys.push('withdrawal');
    }
    async function epochJourney() {
      const f = await host('epoch'), cofounder = await f.member(), known = await f.condition('a', 3600000, cofounder.token), { job } = await f.delivered('a', known.alert.id, cofounder.token);
      const retained = f.retainedJob(job.id); assert.equal(retained.ownerId, cofounder.member.id); assert.equal(retained.ownerEpoch, 1);
      record('cofounder-native-private-brief-is-pinned-to-owner-epoch', 'native-duckdb-receipts-and-native-postgresql-private-mandate');
      const revoked = await f.rpc('members.revoke', { id: cofounder.member.id }); assert.equal(revoked.epoch, 2); assert.equal(revoked.active, false);
      await f.refusal('jobs.list', {}, 'UNAUTHENTICATED', cofounder.token); await f.refusal('jobs.accept', { id: job.id }, 'UNAUTHENTICATED', cofounder.token);
      assert.ok(!(await f.rpc('jobs.list')).some(item => item.id === job.id)); await f.refusal('jobs.accept', { id: job.id }, 'JOB_OWNER_REQUIRED'); await f.refusal('receipts.get', { id: known.receipt.id }, 'RECEIPT_FORBIDDEN');
      await f.restart(); await f.refusal('jobs.list', {}, 'UNAUTHENTICATED', cofounder.token); await f.refusal('jobs.accept', { id: job.id }, 'JOB_OWNER_REQUIRED');
      assert.deepEqual(f.retainedJob(job.id), retained);
      record('revoked-session-and-workspace-owner-takeover-refuse-across-reopen', 'native-postgresql-retained-private-history-and-public-http-refusal');
      f.noDispatch(); report.completedJourneys.push('epoch');
    }
    for (const [name, run] of [['current', currentJourney], ['expiry', expiryJourney], ['correction', correctionJourney], ['scope', scopeJourney], ['withdrawal', withdrawalJourney], ['epoch', epochJourney]]) {
      try { await run(); } catch (error) { report.checks.push({ name: name + ':qualification', passed: false, phase, reason: safeCode(error) }); }
    }
    assert.equal(providerCalls, 0); record('all-journeys-have-no-provider-model-action-or-notification-dispatch', 'synthetic-provider-port-traps-and-authority-state-assertions');
  } catch (error) { report.blockers.push({ phase, reason: safeCode(error) }); }
  finally {
    for (const h of hosts) try { await h.close(); } catch (error) { report.checks.push({ name: 'close-owned-http-engine', passed: false, reason: safeCode(error) }); }
    try { await pool?.end(); } catch (error) { report.checks.push({ name: 'close-owned-inspection-pool', passed: false, reason: safeCode(error) }); }
  }
  report.nativeReceiptIds = [...nativeIds];
  report.passed = report.blockers.length === 0 && report.checks.length === EXPECTED_CHECKS && report.checks.every(check => check.passed)
    && report.completedJourneys.length === 6 && report.engines.postgres === 'native-executed' && report.engines.duckdb === 'native-executed';
  return report;
}
if (process.argv[1] && samePath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  assert.equal(process.argv.length, 2); const report = await runAlertBriefNativeQualification();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n'); process.exitCode = report.passed ? 0 : 1;
}
