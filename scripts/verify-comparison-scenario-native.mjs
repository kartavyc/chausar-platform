import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { PostgresDatabaseCalculator } from '../platform/runtime/postgres-analytics.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { QualificationError, assertPristinePostgres, disposablePostgresConfiguration } from './verify-database-differential.mjs';
import { A, B, C, PERIOD, PRIOR, OCTOBER, PRIVATE_CELL, ROUTE, request, plan, content, figures } from '../platform/tests/fixtures/comparison-scenario-independent-acceptance.ts';

const SOURCE_COMMIT = '87c400870563b92803841d3a198cee801f7740df';
const TASK_ROOT = 'C:/Users/karta/Documents/Codex/2026-10-01/task-4';
const ENDPOINT = 'http://127.0.0.1:11434/api/chat'; // Label only: the authored gateway port opens no socket.
const PASSPHRASE = 'PUBLIC SYNTHETIC NATIVE COMPARISON SCENARIO FIXTURE ONLY 2026';
const COMPANY = 'PUBLIC SYNTHETIC native comparison shop';
const equalPath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
const safeCode = error => /^[A-Z0-9_]{1,80}$/.test(error?.code ?? '') ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'COMPARISON_SCENARIO_QUALIFICATION_FAILED';
function requireCondition(value, code, message) { if (!value) throw new QualificationError(code, message); }

async function ownedRunRoot(environment) {
  requireCondition(process.platform === 'win32', 'WINDOWS_C_FIXTURE_REQUIRED', 'The approved native profile requires Windows C: staging.');
  const value = environment.CHAUSAR_QUALIFICATION_RUN_ROOT;
  requireCondition(typeof value === 'string' && isAbsolute(value), 'QUALIFICATION_RUN_ROOT_REQUIRED', 'Supply the explicit existing task-4 C: run root.');
  const approved = await realpath(TASK_ROOT), selected = resolve(value), child = relative(approved, selected);
  requireCondition(child && !child.startsWith('..') && !isAbsolute(child) && /^C:[\\/]/i.test(selected), 'QUALIFICATION_RUN_ROOT_REFUSED', 'The fixture root must stay strictly below task-4 on C:.');
  let current = approved;
  for (const segment of child.split(/[\\/]/)) {
    current = join(current, segment); const metadata = await lstat(current);
    requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() && equalPath(await realpath(current), resolve(current)), 'QUALIFICATION_RUN_ROOT_REFUSED', 'Owned fixture directories cannot redirect writes.');
  }
  const temporaryDirectory = join(selected, 'temp'), temporaryMetadata = await lstat(temporaryDirectory);
  requireCondition(temporaryMetadata.isDirectory() && !temporaryMetadata.isSymbolicLink()
    && equalPath(await realpath(temporaryDirectory), temporaryDirectory) && equalPath(resolve(tmpdir()), temporaryDirectory), 'QUALIFICATION_TEMP_REQUIRED', 'The actual process temporary directory must be the ordinary C: run temp folder.');
  for (const name of ['TEMP', 'TMP']) requireCondition(equalPath(resolve(environment[name] ?? ''), temporaryDirectory)
    && equalPath(resolve(process.env[name] ?? ''), temporaryDirectory), 'QUALIFICATION_TEMP_REQUIRED', 'Both supplied and actual temporary paths must stay in the C: run.');
  requireCondition(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE, 'QUALIFICATION_CACHE_REFUSED', 'Disable inherited Node compile-cache writes.');
  return { approved, runRoot: selected, temporaryDirectory };
}

// The authored public fixture's exact business rows, without its mocked Date or file adapter.
function authoredImports() {
  const recipe = { version: 1, id: 'synthetic-independent-comparison-map', system: 'synthetic-csv', edition: '1',
    scope: { company: COMPANY, branches: ['main', 'west'] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'description'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject' };
  return [
    [A, [
      '00017,sale,2026-09-01,10001,INR,main,delivered',
      'A-current-end,sale,2026-09-30,20001,INR,main,delivered',
      'A-prior-start,sale,2026-08-01,12001,INR,main,delivered',
      'A-prior-end,sale,2026-08-31,7999,INR,main,delivered',
      'A-west-current,sale,2026-09-15,500000,INR,west,delivered',
      'A-west-prior,sale,2026-08-15,700000,INR,west,delivered',
      'A-large-october,sale,2026-10-01,900719925474099325,INR,main,delivered',
    ], '900719925475349327'],
    [B, ['B-prior-only,sale,2026-08-20,10000,INR,main,delivered'], '10000'],
    [C, ['C-current,sale,2026-09-10,800000,INR,main,delivered', 'C-prior,sale,2026-08-10,900000,INR,main,delivered'], '1700000'],
  ].map(([sourceId, rows, total]) => ({ sourceId, format: 'csv', recipe,
    content: ['id,kind,date,amount,currency,branch,status,description', ...rows.map(row => `${row},${PRIVATE_CELL}`)].join('\r\n'),
    expectedTotals: { rowCount: rows.length, amountMinor: total }, installation: { company: COMPANY, edition: '1' } }));
}
const comparisonKey = { current: '30002', previous: '30000', change: '2', changeBps: '0' };
const positiveKey = { baseline: '30002', scenario: '31502', change: '1500', priceChangeBps: '500' };
const negativeKey = { baseline: '30002', scenario: '28501', change: '-1501', priceChangeBps: '-500' };
function pinnedContent(value) { const { stale, staleReason, ...body } = value; return body; }

/** Root supplies the fresh local PostgreSQL lifecycle and the 240-second process cap.
 * This runner acquires nothing, installs nothing, calls no live model, and retains owned C: data. */
export async function runComparisonScenarioNativeQualification(environment = process.env) {
  const report = { suite: 'native-owner-reviewed-comparison-scenario', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null,
    sourceCommitVerification: 'supervisor-reported-exact-baseline', passed: false, checks: [], blockers: [],
    engines: { postgres: 'not-executed', duckdb: 'not-executed' },
    fixture: { source: 'platform/tests/fixtures/comparison-scenario-independent-acceptance.ts', credential: 'fixed-public-synthetic-only',
      learnedAt: 'actual-current-import-clock', asOf: 'actual-current-after-import-clock', mockedSql: false, mockedClock: false,
      sourceImmutability: 'Public selection pinned to its actual post-import cut plus exact full authoritative facts-array equality.' },
    planning: { port: 'authored-injected-ollama-response', liveModelCalls: 0, externalModelNetworkCalls: 0, authoredCalls: 0 },
    scope: 'Actual paired loopback HTTP Engine with PostgreSQL encrypted authority, default native DuckDB receipts and explicit native PostgreSQL receipt verification; independently authored arithmetic and exact owner input custody. Planning uses an authored injected port, not a live model or a model-quality qualification. No phone, GUI, deployment, vendor, arbitrary compiled transformation or default-engine selection qualification.',
    nativeReceipts: [], expectedNativeReceipts: 12, expectedAuthoredPlanningCalls: 19,
    productGaps: [{ code: 'SQL_DEFINITION_UNSUPPORTED', scope: 'comparison/scenario with earned bound to a custom money field',
      retained: true, boundary: 'Production verifier refuses before SQL; native numeric qualification here covers amountMinor only.' }],
    runtime: { node: process.version, platform: process.platform } };
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  let phase = 'native-preflight', pool, postgres, engine, app, directory, options, origin, token;
  const calls = [], retained = [];
  let response;
  try {
    requireCondition(environment.CHAUSAR_SOURCE_COMMIT === SOURCE_COMMIT, 'SOURCE_BASELINE_REQUIRED', 'The supervisor must pin the exact reviewed 87c4008 source baseline.');
    const configuration = disposablePostgresConfiguration(environment), ownership = await ownedRunRoot(environment);
    report.sourceHashes = {};
    for (const path of ['../platform/runtime/engine.ts', '../platform/runtime/gateway.ts', '../platform/runtime/conversation-calculation-arguments.ts',
      '../platform/runtime/calculator.ts', '../platform/runtime/analytics.ts', '../platform/runtime/postgres-analytics.ts',
      '../platform/tests/fixtures/comparison-scenario-independent-acceptance.ts']) {
      report.sourceHashes[path] = createHash('sha256').update(await readFile(new URL(path, import.meta.url))).digest('hex');
    }
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({ ...configuration, ssl: false, max: 1, connectionTimeoutMillis: 3000, query_timeout: 17000,
      application_name: 'chausar-native-comparison-scenario',
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000' });
    await assertPristinePostgres(pool);
    const identity = (await pool.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,inet_server_port() AS port,current_setting('server_version') AS server_version,version() AS version,current_setting('data_directory') AS data_directory")).rows;
    assert.equal(identity.length, 1); assert.equal(identity[0].database, configuration.database);
    assert.equal(identity[0].address, configuration.host); assert.equal(identity[0].port, configuration.port); assert.match(identity[0].version, /^PostgreSQL /);
    const dataDirectory = identity[0].data_directory;
    requireCondition(typeof dataDirectory === 'string' && isAbsolute(dataDirectory), 'POSTGRES_C_DATA_REQUIRED', 'The real PostgreSQL server must report its absolute data directory.');
    const selectedData = resolve(dataDirectory), child = relative(ownership.approved, selectedData);
    requireCondition(child && !child.startsWith('..') && !isAbsolute(child) && equalPath(await realpath(selectedData), selectedData)
      && !(await lstat(selectedData)).isSymbolicLink(), 'POSTGRES_C_DATA_REQUIRED', 'The actual PostgreSQL data directory must stay canonically below task-4 on C:.');
    report.environmentGuards = { runRoot: ownership.runRoot, temporaryDirectory: ownership.temporaryDirectory,
      postgresDataDirectory: selectedData, dRuntimeAccessPolicy: 'read-only-existing-files', compileCacheEnvironment: 'unset' };
    record('pristine-dedicated-literal-loopback-postgresql-identity-and-c-data', 'native-postgresql', { server: identity[0] });
    postgres = await PostgresDatabaseCalculator.connect({ ...configuration, maxConnections: 1, operationTimeoutMs: 15000, maxRows: 500 });
    directory = await mkdtemp(join(ownership.runRoot, 'native-comparison-scenario-')); report.fixture.retainedDirectory = directory;
    options = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL,
      analytics: { operationTimeoutMs: 15000, maxRows: 500 }, gateway: {
        http: async input => {
          assert.equal(input.endpoint, ENDPOINT); assert.ok(response, 'The authored planning port needs an explicit response.');
          calls.push({ endpoint: input.endpoint, body: input.body });
          return { status: 200, endpoint: input.endpoint, body: JSON.stringify({ done: response.status === 'completed',
            done_reason: response.status === 'completed' ? 'stop' : 'length', message: { role: 'assistant', content: JSON.stringify(response.wire) } }) };
        },
        process: async () => { throw new QualificationError('PLANNING_PROCESS_FORBIDDEN', 'This fixture never calls a model process.'); },
      } };
    async function start() {
      engine = new Engine(options); app = createLocalServer(engine); ({ origin, token } = await app.listen());
      assert.equal(new URL(origin).hostname, '127.0.0.1');
      const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
    }
    async function raw(method, payload = {}, bearer = token) {
      phase = method;
      const result = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
        body: JSON.stringify({ method, payload }), signal: AbortSignal.timeout(45000) });
      return { status: result.status, body: await result.json() };
    }
    async function rpc(method, payload = {}) {
      const result = await raw(method, payload);
      if (result.body.error) throw Object.assign(new Error('Synthetic native public request refused.'), { code: result.body.error.code });
      assert.equal(result.status, 200); return result.body.result;
    }
    async function refuse(method, payload, code) {
      const result = await raw(method, payload); assert.notEqual(result.status, 200); assert.equal(result.body.result, undefined);
      assert.equal(result.body.error?.code, code); return result.body.error.code;
    }
    async function review(input) {
      const before = calls.length, preview = await rpc('models.preview', input);
      assert.equal(calls.length, before); assert.equal(preview.payload.includes(PRIVATE_CELL), false);
      const approval = await rpc('models.approve', { id: preview.id });
      return { preview, approval, payload: { ...input, previewId: preview.id, approvalId: approval.id } };
    }
    async function turn(input, wire, expectedCount = 1) {
      response = { wire, status: 'completed' };
      const reviewed = await review(input), before = calls.length, answer = await rpc('conversation.ask', reviewed.payload);
      assert.equal(calls.length, before + 1); assert.equal(calls.at(-1).body, reviewed.preview.payload);
      assert.equal(answer.kind, 'grounded-conversation'); assert.equal(answer.results.length, expectedCount);
      for (const result of answer.results) assert.equal(result.error, undefined);
      assert.deepEqual((await rpc('conversation.get', { id: answer.id })).answer, answer);
      retained.push({ answer, input }); return { ...reviewed, answer, receipts: answer.results.map(result => result.answer) };
    }
    const pins = [], allImportedIds = new Set();
    let dictionary;
    async function native(receipt, literal, input, label, expectedEntities, completeness = 'reconciled-imports', importedOnly = true) {
      phase = `native-proof:${label}`;
      assert.deepEqual(figures(receipt), literal); const primary = receipt.operation === 'change' ? literal.change : literal.scenario;
      assert.equal(receipt.valueMinor, primary); assert.equal(receipt.totalMinor, primary); assert.equal(receipt.currency, 'INR');
      assert.equal(receipt.dictionaryHash, dictionary.hash); assert.equal(receipt.branch, 'main'); assert.equal(receipt.asOf, input.asOf);
      assert.deepEqual(receipt.period, input.period); assert.deepEqual(receipt.requestedSourceIds, input.sourceIds);
      assert.deepEqual(receipt.rows.map(row => row.entityId).sort(), [...expectedEntities].sort());
      assert.ok(receipt.rows.every(row => row.branch === 'main' && input.sourceIds.includes(row.sourceId)));
      assert.equal(receipt.rowIds.length, new Set(receipt.rowIds).size); assert.equal(receipt.rows.length, receipt.rowIds.length);
      if (importedOnly) assert.ok(receipt.rowIds.every(id => allImportedIds.has(id)));
      assert.equal(receipt.coverage.completeness, completeness); assert.equal(receipt.coverage.unresolvedConflicts, 0);
      if (completeness === 'reconciled-imports') assert.deepEqual(receipt.coverage.gaps, []);
      if (receipt.operation === 'change') assert.deepEqual(receipt.comparePeriod, input.comparePeriod);
      if (receipt.operation === 'scenario') assert.equal(receipt.assumptions.priceChangeBps, literal.priceChangeBps);
      assert.equal(receipt.databaseProof?.engine, 'duckdb'); assert.equal(receipt.databaseProof?.verified, true);
      assert.equal(receipt.databaseProof.receiptId, receipt.id); assert.equal(receipt.databaseProof.operation, receipt.operation);
      assert.match(receipt.databaseProof.projectionDigest, /^[a-f0-9]{64}$/);
      const pgProof = await postgres.verify(structuredClone(receipt));
      assert.equal(pgProof.engine, 'postgres'); assert.equal(pgProof.verified, true); assert.equal(pgProof.receiptId, receipt.id);
      assert.equal(pgProof.operation, receipt.operation); assert.equal(pgProof.projectionDigest, receipt.databaseProof.projectionDigest);
      assert.deepEqual(await rpc('receipts.get', { id: receipt.id }), receipt);
      pins.push(structuredClone(receipt)); report.nativeReceipts.push({ id: receipt.id, operation: receipt.operation,
        label, primaryMinor: primary, duckdb: receipt.databaseProof, postgres: pgProof });
      report.engines.postgres = 'native-executed'; report.engines.duckdb = 'native-executed';
      record(`${label}:literal-answer-source-scope-and-distinct-lineage`, 'javascript-independent-answer-key', { expectedFigures: literal, rowCount: expectedEntities.length });
      record(`${label}:default-production-duckdb-proof`, 'native-duckdb-engine-receipt', { receiptId: receipt.id, projectionDigest: receipt.databaseProof.projectionDigest });
      record(`${label}:independent-postgresql-proof`, 'native-postgresql-actual-registered-query', { receiptId: receipt.id, projectionDigest: pgProof.projectionDigest });
    }
    async function authority(label, folder = 'fixture') {
      const slot = hash(resolve(directory, folder));
      const rows = (await pool.query('SELECT revision::text AS revision,envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [slot])).rows;
      assert.equal(rows.length, 1); assert.equal(rows[0].revision, String(engine.vault.read().revision));
      for (const marker of [PASSPHRASE, COMPANY, PRIVATE_CELL, A, 'Compare September revenue with August']) assert.equal(rows[0].envelope.includes(marker), false);
      await assert.rejects(lstat(join(directory, folder, 'authority.encrypted.json')), error => error.code === 'ENOENT');
      record(`${label}:encrypted-postgresql-authority-without-file-fallback`, 'native-postgresql-ciphertext-inspection');
    }
    async function reopen(label, folder = 'fixture') {
      const oldToken = token; await rpc('workspace.lock'); await app.close(5000); app = undefined;
      await start(); await rpc('workspace.open', { folder, passphrase: PASSPHRASE });
      assert.equal(engine.vault.storageKind, 'postgres'); assert.equal((await raw('workspace.status', {}, oldToken)).status, 401);
      record(`${label}:fresh-engine-paired-http-reopen-and-new-token`, 'native-postgresql-public-http-custody');
    }

    await start();
    const created = await rpc('workspace.create', { name: COMPANY, folder: 'fixture', pack: 'ecommerce', demo: false, passphrase: PASSPHRASE });
    assert.equal(created.experimental, false); assert.equal(engine.vault.storageKind, 'postgres');
    const draft = structuredClone((await rpc('ontology.packs')).find(pack => pack.pack === 'ecommerce'));
    draft.definitions.find(definition => definition.name === 'earned').meaning = 'Independent owner convention: delivered sale value in exact minor INR by sale event date, excluding tax.';
    dictionary = await rpc('ontology.publish', { draft });
    for (const input of authoredImports()) {
      const imported = await rpc('sources.import', input); assert.equal(imported.coverage.reconciled, true);
      assert.equal(imported.totalsMinor, input.expectedTotals.amountMinor); assert.equal(imported.rowIds.length, input.expectedTotals.rowCount);
      for (const id of imported.rowIds) allImportedIds.add(id);
    }
    const cut = new Date().toISOString(); report.fixture.knowledgeCut = cut;
    await rpc('models.configure', { config: { id: ROUTE, kind: 'ollama', model: 'synthetic-independent-authored-planner', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' } });
    await rpc('trust.update', { send: 'shape' });
    const factsBefore = await rpc('memory.list', { asOf: cut }), authoritativeFactsBefore = engine.vault.read().facts;
    const base = request('change', { asOf: cut }), baselineEntities = ['00017', 'A-current-end', 'A-prior-start', 'A-prior-end', 'B-prior-only'];
    record('public-http-publish-and-reconciled-exact-synthetic-imports', 'native-postgresql-engine-composition', { importRows: allImportedIds.size });

    response = { wire: plan('change', base), status: 'completed' };
    const preview = await rpc('models.preview', base); assert.deepEqual(preview.sourceIds, [A, B]); assert.deepEqual(preview.businessContext.sourceIds, [A]);
    assert.deepEqual(content(preview).calculationParameters.comparePeriod, PRIOR); assert.equal(preview.payload.includes(PRIVATE_CELL), false);
    await refuse('conversation.ask', { ...base, previewId: preview.id }, 'OUTBOUND_APPROVAL_REQUIRED');
    const approval = await rpc('models.approve', { id: preview.id }), exact = { ...base, previewId: preview.id, approvalId: approval.id };
    await refuse('conversation.ask', { ...exact, sourceIds: [A, B, C] }, 'PREVIEW_REQUEST_CHANGED');
    await refuse('conversation.ask', { ...exact, comparePeriod: { ...PRIOR, to: '2026-08-30' } }, 'PREVIEW_REQUEST_CHANGED');
    assert.equal(calls.length, 0);
    record('comparison:owner-approval-source-and-period-tampering-refuse-before-planning', 'javascript-public-admission-contract');
    const first = await rpc('conversation.ask', exact); assert.equal(first.kind, 'grounded-conversation'); assert.equal(first.results.length, 1); assert.equal(first.results[0].error, undefined);
    assert.equal(calls.length, 1); assert.equal(calls[0].body, preview.payload); retained.push({ answer: first, input: base });
    await native(first.results[0].answer, comparisonKey, base, 'comparison-endpoints-and-prior-only-source', baselineEntities);
    await refuse('conversation.ask', exact, 'PREVIEW_NOT_FOUND');
    record('comparison:single-use-exact-approved-payload', 'javascript-public-approval-custody');

    const positiveInput = request('scenario', { asOf: cut }), positive = await turn(positiveInput, plan('scenario', positiveInput));
    await native(positive.receipts[0], positiveKey, positiveInput, 'positive-scenario-truncation', ['00017', 'A-current-end']);
    const scenarioSchema = positive.preview.schema.properties.calls.items.anyOf.find(entry => entry.properties.tool.enum.includes('calculator.calculate')
      && entry.properties.args.properties.operation.enum?.includes('scenario'));
    assert.deepEqual(scenarioSchema.properties.args.properties.assumptions.properties.priceChangeBps.enum, ['00500']);
    assert.deepEqual((await rpc('trials.savedQuestions')).find(item => item.receiptId === positive.receipts[0].id).request.assumptions, { priceChangeBps: '00500' });
    record('scenario:00500-request-bytes-persist-while-amount-proof-canonicalizes-500', 'javascript-exact-reviewed-input-custody');
    const negativeInput = request('scenario', { asOf: cut, assumptions: { priceChangeBps: '-00500' } }), negative = await turn(negativeInput, plan('scenario', negativeInput));
    await native(negative.receipts[0], negativeKey, negativeInput, 'negative-price-scenario-truncation', ['00017', 'A-current-end']);
    assert.deepEqual((await rpc('trials.savedQuestions')).find(item => item.receiptId === negative.receipts[0].id).request.assumptions, { priceChangeBps: '-00500' });
    record('scenario:minus-00500-request-bytes-persist', 'javascript-exact-reviewed-input-custody');
    const hugeInput = request('scenario', { asOf: cut, period: OCTOBER, sourceIds: [A] }), huge = await turn(hugeInput, plan('scenario', hugeInput));
    await native(huge.receipts[0], { baseline: '900719925474099325', scenario: '945755921747804291', change: '45035996273704966', priceChangeBps: '500' },
      hugeInput, 'huge-integer-scenario-fractional-minor-truncation', ['A-large-october']);

    const mixedInput = request('change', { asOf: cut, assumptions: { priceChangeBps: '00500' } });
    const mixedWire = { kind: 'execute', calls: [...plan('scenario', mixedInput).calls, ...plan('change', mixedInput).calls], clarification: null };
    const mixed = await turn(mixedInput, mixedWire, 2);
    await native(mixed.receipts[0], positiveKey, mixedInput, 'scenario-before-comparison-scenario', ['00017', 'A-current-end']);
    await native(mixed.receipts[1], comparisonKey, mixedInput, 'scenario-before-comparison-comparison', baselineEntities);
    assert.deepEqual(await rpc('memory.list', { asOf: cut }), factsBefore);
    assert.deepEqual(engine.vault.read().facts, authoritativeFactsBefore);
    record('scenario-before-comparison:disjoint-calls-use-measured-baseline-and-never-mutate-facts', 'native-engine-composition-with-javascript-order-contract');

    for (const variant of [
      { label: 'narrower-source', input: request('change', { asOf: cut, sourceIds: [A] }), key: { current: '30002', previous: '20000', change: '10002', changeBps: '5001' }, entities: baselineEntities.filter(id => id !== 'B-prior-only') },
      { label: 'explicit-empty-source-uncertainty', input: request('change', { asOf: cut, sourceIds: [] }), key: { current: '0', previous: '0', change: '0' }, entities: [], completeness: 'empty' },
      { label: 'zero-prior-omits-undefined-ratio', input: request('change', { asOf: cut, sourceIds: [A], comparePeriod: { from: '2026-07-01', to: '2026-07-31' } }), key: { current: '30002', previous: '0', change: '30002' }, entities: ['00017', 'A-current-end'] },
      { label: 'overlap-period-no-lineage-fanout', input: request('change', { asOf: cut, comparePeriod: { from: '2026-08-01', to: '2026-09-15' } }), key: { current: '30002', previous: '40001', change: '-9999', changeBps: '-2499' }, entities: baselineEntities },
    ]) {
      const value = await turn(variant.input, plan('change', variant.input));
      await native(value.receipts[0], variant.key, variant.input, variant.label, variant.entities, variant.completeness ?? 'reconciled-imports');
      if (variant.completeness === 'empty') assert.ok(value.receipts[0].coverage.gaps.some(gap => /not proof/i.test(gap)));
    }
    assert.deepEqual(await rpc('memory.list', { asOf: cut }), factsBefore);
    assert.deepEqual(engine.vault.read().facts, authoritativeFactsBefore);
    record('scenario-and-comparison:source-facts-unchanged-before-explicit-correction', 'javascript-public-source-readback');

    for (const variant of [
      { input: base, wire: plan('change', base, { comparePeriod: { ...PRIOR, to: '2026-08-30' } }) },
      { input: positiveInput, wire: plan('scenario', positiveInput, { assumptions: { priceChangeBps: '500' } }) },
      { input: positiveInput, wire: plan('scenario', positiveInput, { assumptions: { priceChangeBps: '00500', demandBps: '100' } }) },
      { input: base, wire: plan('change', base, { asOf: new Date(Date.parse(cut) + 1000).toISOString() }) },
    ]) {
      const receiptCount = engine.vault.read().receipts.length; response = { wire: variant.wire, status: 'completed' };
      const reviewed = await review(variant.input), before = calls.length;
      await refuse('conversation.ask', reviewed.payload, 'INVALID_CONVERSATION_PLAN'); assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1).body, reviewed.preview.payload); assert.equal(engine.vault.read().receipts.length, receiptCount);
      await refuse('conversation.ask', reviewed.payload, 'PREVIEW_NOT_FOUND');
    }
    record('planner:changed-period-text-assumption-extra-assumption-and-trusted-cut-refuse-without-partial-receipts', 'javascript-public-planner-admission-contract');
    const missing = request('change', { asOf: cut }); delete missing.comparePeriod;
    response = { wire: plan('change', missing), status: 'completed' }; const missingReview = await review(missing), missingCount = engine.vault.read().receipts.length;
    await refuse('conversation.ask', missingReview.payload, 'INVALID_CONVERSATION_PLAN'); assert.equal(engine.vault.read().receipts.length, missingCount);
    record('comparison:missing-owner-reviewed-period-never-unlocks-execution', 'javascript-public-planner-admission-contract');
    response = { wire: plan('change', base), status: 'incomplete' }; const incomplete = await review(base);
    await refuse('conversation.ask', incomplete.payload, 'MODEL_INCOMPLETE'); await refuse('conversation.ask', incomplete.payload, 'PREVIEW_NOT_FOUND');
    assert.equal(engine.vault.read().receipts.length, missingCount);
    record('planner:explicit-incomplete-port-response-consumes-review-without-comparison-result', 'javascript-authored-port-terminal-contract');

    const tampered = structuredClone(pins[0]); tampered.valueMinor = tampered.totalMinor = '3'; tampered.figures.find(figure => figure.key === 'change').minor = '3';
    phase = 'native-postgresql-tampered-answer'; await assert.rejects(postgres.verify(tampered), { code: 'SQL_RESULT_MISMATCH' });
    record('native-postgresql:tampered-comparison-answer-refuses', 'native-postgresql-result-mismatch');
    await authority('before-correction'); await reopen('before-correction');
    for (const item of retained) assert.deepEqual((await rpc('conversation.get', { id: item.answer.id })).answer, item.answer);
    for (const pin of pins) assert.deepEqual(await rpc('receipts.get', { id: pin.id }), pin);
    assert.deepEqual((await rpc('trials.savedQuestions')).find(item => item.receiptId === positive.receipts[0].id).request.assumptions, { priceChangeBps: '00500' });
    assert.deepEqual((await rpc('trials.savedQuestions')).find(item => item.receiptId === negative.receipts[0].id).request.assumptions, { priceChangeBps: '-00500' });
    record('native-custody:answers-receipt-proofs-and-exact-signed-assumption-inputs-survive-reopen', 'native-postgresql-public-http-readback');

    const pending = await review(base), beforeCorrectionCalls = calls.length;
    while (Date.now() <= Date.parse(cut)) await delay(1);
    const originalFact = (await rpc('memory.list')).facts.find(fact => fact.entityId === '00017'); assert.ok(originalFact);
    await rpc('memory.correct', { id: originalFact.id, fields: { amountMinor: '20001' } });
    const refusedPending = await raw('conversation.ask', pending.payload); assert.notEqual(refusedPending.status, 200);
    assert.equal(refusedPending.body.result, undefined); assert.equal(typeof refusedPending.body.error?.code, 'string'); assert.equal(calls.length, beforeCorrectionCalls);
    await refuse('conversation.get', { id: first.id }, 'CONVERSATION_NOT_FOUND');
    const old = await rpc('receipts.get', { id: pins[0].id }); assert.equal(old.stale, true); assert.deepEqual(pinnedContent(old), pinnedContent(pins[0]));
    record('correction:actual-current-learned-version-invalidates-pending-review-and-retains-old-receipt-content', 'native-postgresql-bitemporal-public-custody');
    const newCut = new Date().toISOString(), freshInput = request('change', { asOf: newCut }), fresh = await turn(freshInput, plan('change', freshInput));
    await native(fresh.receipts[0], { current: '40002', previous: '30000', change: '10002', changeBps: '3334' }, freshInput,
      'actual-current-correction-fresh-cut', baselineEntities, 'unreconciled-facts', false);
    const historical = await turn(base, plan('change', base));
    await native(historical.receipts[0], comparisonKey, base, 'actual-current-correction-retained-old-cut', baselineEntities);
    report.fixture.correctionKnowledgeCut = newCut;
    await authority('after-correction'); await reopen('after-correction');
    for (const value of [fresh, historical]) assert.deepEqual((await rpc('conversation.get', { id: value.answer.id })).answer, value.answer);
    assert.deepEqual(await rpc('receipts.get', { id: fresh.receipts[0].id }), fresh.receipts[0]);
    assert.deepEqual(await rpc('receipts.get', { id: historical.receipts[0].id }), historical.receipts[0]);
    assert.equal((await rpc('receipts.get', { id: pins[0].id })).stale, true);
    record('correction:exact-old-and-fresh-native-answer-pins-survive-second-reopen', 'native-postgresql-public-http-bitemporal-readback');
    assert.deepEqual(await rpc('actions.list'), []);
    record('fixture:no-external-actions-and-only-authored-injected-planning-port', 'javascript-controlled-port-and-action-assertion');

    // A separately owned public workspace exercises the actual admitted-failure
    // contract. Changing earned to a secondary money field is a retained SQL
    // capability gap, even though publication and generic planner admission allow it.
    await rpc('workspace.lock');
    await rpc('workspace.create', { name: COMPANY, folder: 'custom-field', pack: 'ecommerce', demo: false, passphrase: PASSPHRASE });
    const customDraft = structuredClone((await rpc('ontology.packs')).find(pack => pack.pack === 'ecommerce'));
    const customEarned = customDraft.definitions.find(definition => definition.name === 'earned');
    customEarned.field = 'feeMinor';
    customEarned.meaning = 'Explicit public synthetic owner convention: count the separately reported secondary fee amount on delivered sale events by event date, excluding tax.';
    const customDictionary = await rpc('ontology.publish', { draft: customDraft });
    const customSource = 'synthetic-native-custom-earned-field', customRecipe = structuredClone(authoredImports()[0].recipe);
    customRecipe.id = 'synthetic-native-custom-earned-field-map';
    customRecipe.bindings.push({ target: 'feeMinor', source: 'fee', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' });
    const customImport = await rpc('sources.import', { sourceId: customSource, format: 'csv', recipe: customRecipe,
      content: 'id,kind,date,amount,fee,currency,branch,status,description\nfee-current-start,sale,2026-09-01,111,10001,INR,main,delivered,Public synthetic custom field start\nfee-current-end,sale,2026-09-30,222,20001,INR,main,delivered,Public synthetic custom field end\nfee-prior,sale,2026-08-01,333,30000,INR,main,delivered,Public synthetic custom field prior',
      expectedTotals: { rowCount: 3, amountMinor: '666' } });
    assert.equal(customImport.coverage.reconciled, true); assert.equal(customImport.totalsMinor, '666');
    await rpc('models.configure', { config: { id: ROUTE, kind: 'ollama', model: 'synthetic-independent-authored-planner', endpoint: ENDPOINT, budgetMinor: '0', maxCostMinor: '0' } });
    await rpc('trust.update', { send: 'shape' });
    const customCut = new Date().toISOString(), customFacts = await rpc('memory.list', { asOf: customCut });
    const customAuthoritativeFacts = engine.vault.read().facts, failedAnswers = [];
    record('custom-field:public-dictionary-and-secondary-money-import-admitted', 'native-postgresql-public-fixture-custody');
    for (const operation of ['change', 'scenario']) {
      const customInput = request(operation, { sourceIds: [customSource], asOf: customCut });
      const local = { operation, sourceIds: customInput.sourceIds, branch: 'main', period: PERIOD, asOf: customCut,
        ...(operation === 'change' ? { comparePeriod: PRIOR } : { assumptions: { priceChangeBps: '00500' } }) };
      await refuse('calculation.run', local, 'SQL_DEFINITION_UNSUPPORTED');
      assert.equal(engine.vault.read().receipts.length, 0); assert.deepEqual(await rpc('trials.savedQuestions'), []);
      record(`custom-field:${operation}:production-engine-refuses-without-numeric-receipt`, 'production-projection-refusal-before-native-duckdb-sql', { reason: 'SQL_DEFINITION_UNSUPPORTED' });
      const unsupported = structuredClone(pins.find(pin => pin.operation === operation));
      unsupported.dictionaryHash = customDictionary.hash;
      unsupported.definitions = structuredClone(customDictionary.definitions.filter(definition => definition.name === 'earned'));
      unsupported.definitionHash = hash(unsupported.definitions);
      phase = `custom-field:${operation}:postgres-projection-refusal`;
      await assert.rejects(postgres.verify(unsupported), { code: 'SQL_DEFINITION_UNSUPPORTED' });
      record(`custom-field:${operation}:postgres-adapter-retains-same-field-boundary`, 'production-projection-refusal-before-native-postgresql-sql', { reason: 'SQL_DEFINITION_UNSUPPORTED', sqlExecutedForThisRefusal: false });
      response = { wire: plan(operation, customInput), status: 'completed' };
      const reviewed = await review(customInput), count = calls.length, historyCount = (await rpc('conversation.history')).items.length;
      const admitted = await rpc('conversation.ask', reviewed.payload);
      assert.equal(calls.length, count + 1); assert.equal(calls.at(-1).body, reviewed.preview.payload);
      assert.equal(admitted.kind, 'grounded-conversation'); assert.equal(admitted.results.length, 1);
      assert.equal(admitted.results[0].tool, 'calculator.calculate'); assert.equal(admitted.results[0].error?.code, 'SQL_DEFINITION_UNSUPPORTED');
      assert.equal(admitted.results[0].answer, undefined); assert.deepEqual(admitted.receipt.resultRefs, []);
      assert.equal(engine.vault.read().receipts.length, 0); assert.deepEqual(await rpc('trials.savedQuestions'), []);
      assert.equal((await rpc('conversation.history')).items.length, historyCount + 1);
      assert.deepEqual((await rpc('conversation.get', { id: admitted.id })).answer, admitted);
      await refuse('conversation.ask', reviewed.payload, 'PREVIEW_NOT_FOUND'); failedAnswers.push(admitted);
      record(`custom-field:${operation}:admitted-failure-retains-error-only-conversation-and-consumes-review`, 'javascript-admitted-failure-contract-with-native-postgresql-custody', { numericReceiptCommitted: false, savedErrorConversation: true });
    }
    assert.deepEqual(await rpc('memory.list', { asOf: customCut }), customFacts);
    assert.deepEqual(engine.vault.read().facts, customAuthoritativeFacts);
    await authority('custom-field', 'custom-field'); await reopen('custom-field', 'custom-field');
    for (const answer of failedAnswers) assert.deepEqual((await rpc('conversation.get', { id: answer.id })).answer, answer);
    assert.equal(engine.vault.read().receipts.length, 0); assert.deepEqual(await rpc('trials.savedQuestions'), []); assert.deepEqual(await rpc('actions.list'), []);
    record('custom-field:retained-gap-error-only-history-survives-fresh-native-engine-reopen', 'native-postgresql-public-http-custody');
  } catch (error) { report.blockers.push({ phase, reason: safeCode(error) }); }
  finally {
    report.planning.authoredCalls = calls.length;
    try { if (app) await app.close(5000); else await engine?.shutdown(); } catch (error) { report.blockers.push({ phase: 'close-owned-public-engine', reason: safeCode(error) }); }
    try { await postgres?.close(); } catch (error) { report.blockers.push({ phase: 'close-owned-postgresql-verifier', reason: safeCode(error) }); }
    try { await pool?.end(); } catch (error) { report.blockers.push({ phase: 'close-owned-inspection-pool', reason: safeCode(error) }); }
  }
  report.passed = report.blockers.length === 0 && report.checks.length > 0 && report.checks.every(check => check.passed)
    && report.nativeReceipts.length === report.expectedNativeReceipts && calls.length === report.expectedAuthoredPlanningCalls
    && report.engines.postgres === 'native-executed' && report.engines.duckdb === 'native-executed';
  return report;
}

if (process.argv[1] && equalPath(resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const report = await runComparisonScenarioNativeQualification(); console.log(JSON.stringify(report, null, 2)); process.exitCode = report.passed ? 0 : 1;
}
