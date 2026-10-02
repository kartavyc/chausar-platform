import assert from 'node:assert/strict';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { createLocalServer } from '../platform/runtime/server.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { PostgresInvestigationSearch, INVESTIGATION_SEARCH_METHOD } from '../platform/runtime/investigation-search.ts';
import { assertPristinePostgres, disposablePostgresConfiguration } from './verify-database-differential.mjs';

/** Task-owned adaptation of scripts/verify-investigations-native.mjs at
 * 1dc19b856380951aea49b7143ed4b5617130c06b. The original coordinator-specific
 * harness is unchanged. This copy retains its native fixtures and public HTTP
 * checks; only fixture ownership, source reporting and credential setup differ.
 * Root supplies and supervises the disposable PostgreSQL server. Existing D:
 * runtimes are read-only; run data, temporary files and reports belong on C:. */
const FOUNDATION_COMMIT = '1dc19b856380951aea49b7143ed4b5617130c06b';
const OWNED_WORKSPACE = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
const PUBLIC_FIXTURE_PASSPHRASE = 'Public synthetic investigation qualification fixture only 2026';
const JULY = { from: '2026-07-01', to: '2026-07-31' }, AUGUST = { from: '2026-08-01', to: '2026-08-31' }, SEPTEMBER = { from: '2026-09-01', to: '2026-09-30' };
const MONEY_SOURCE = 'synthetic-private-invoice-and-payment-export', PRODUCT_SOURCE = 'synthetic-native-products';
const METHOD = INVESTIGATION_SEARCH_METHOD;
const bounds = { maxDocuments: 100, maxTextBytes: 262144, maxMatches: 100 };
const searchRequest = query => ({ method: METHOD, query, bounds });
const code = error => typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'NATIVE_INVESTIGATION_QUALIFICATION_FAILED';
const literalTotal = (receipt, expected) => { assert.equal(receipt.totalMinor, expected); assert.equal(receipt.valueMinor, expected); assert.equal(receipt.databaseProof?.engine, 'duckdb'); assert.equal(receipt.databaseProof?.verified, true); };

function syntheticImport(name, product = false) {
  const strings = ['currency', 'branch', 'status', 'description', ...(product ? ['sku', 'unit'] : [])];
  return {
    sourceId: product ? PRODUCT_SOURCE : MONEY_SOURCE, format: 'csv',
    content: product ? 'id,kind,date,amount,currency,branch,status,description,quantity,sku,unit\nproduct-baseline,sale,2026-08-03,1.00,INR,main,delivered,Synthetic delivered baseline,10,product-a,item\nproduct-comparison,sale,2026-09-03,2.40,INR,main,delivered,Synthetic delivered comparison,20,product-a,item\n'
      : 'id,kind,date,amount,currency,branch,status,description\njuly-invoice,invoice,2026-07-02,500.00,INR,main,issued,Synthetic invoice evidence\njuly-payment,payment,2026-07-03,300.00,INR,main,settled,Synthetic collection evidence\naugust-invoice,invoice,2026-08-02,700.00,INR,main,issued,Synthetic counterevidence\naugust-payment,payment,2026-08-03,150.00,INR,main,settled,Synthetic collection row\n',
    recipe: {
      version: 1, id: product ? 'synthetic-native-product-counts' : 'synthetic-native-investigation-money', system: 'synthetic-csv', edition: '1', scope: { company: name, branches: ['main'] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...strings.map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
        ...(product ? [{ target: 'quantity', source: 'quantity', type: 'integer', nulls: 'reject' }] : []),
      ], allowedKinds: product ? ['sale'] : ['invoice', 'payment'], allowedStatuses: product ? ['delivered'] : ['issued', 'settled'], onUnmapped: 'reject',
    }, expectedTotals: { rowCount: product ? 2 : 4, amountMinor: product ? '340' : '165000' },
  };
}

export async function runInvestigationsCNativeQualification(environment = process.env) {
  const report = { suite: 'c-owned-native-private-investigations-journals-and-search', sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null, foundation: { commit: FOUNDATION_COMMIT, script: 'scripts/verify-investigations-native.mjs' }, sourceCommitVerification: 'supervisor-reported-exact-baseline', fixtureCredential: 'fixed-public-synthetic-only', passed: false, checks: [], blockers: [], engines: { postgres: 'not-executed', duckdb: 'not-executed' }, scope: 'Synthetic production Engine HTTP with PostgreSQL encrypted authority, default native DuckDB calculations, owner-declared descriptive bridge, persisted private investigation and journal, actual PostgreSQL simple-token search, reopen and lineage deletion. C-owned fixture writes and existing read-only runtimes only. No provider, vendor, enterprise, installer, causal or full-release qualification.' };
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  let pool, search, app, engine, engineSlot;
  let providerCalls = 0, phase = 'native-preflight';
  try {
    assert.equal(environment.CHAUSAR_SOURCE_COMMIT, FOUNDATION_COMMIT, 'Supervisor must pin the exact published source baseline.');
    const configuration = disposablePostgresConfiguration(environment);
    assert(typeof environment.CHAUSAR_QUALIFICATION_RUN_ROOT === 'string' && isAbsolute(environment.CHAUSAR_QUALIFICATION_RUN_ROOT), 'Supply an explicit absolute task-owned C: run root.');
    const runRoot = resolve(environment.CHAUSAR_QUALIFICATION_RUN_ROOT);
    const suffix = relative(OWNED_WORKSPACE, runRoot);
    assert(suffix && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + sep), 'Fixture writes must remain below the task-4 C: workspace.');
    assert.equal((await realpath(runRoot)).toLowerCase(), runRoot.toLowerCase());
    assert((await lstat(runRoot)).isDirectory() && !(await lstat(runRoot)).isSymbolicLink());
    const temporaryDirectory = join(runRoot, 'temp');
    for (const name of ['TEMP', 'TMP']) {
      assert.equal(resolve(environment[name] ?? '').toLowerCase(), temporaryDirectory.toLowerCase(), 'Both Windows temporary paths must stay in the owned C: run.');
      assert.equal(resolve(process.env[name] ?? '').toLowerCase(), temporaryDirectory.toLowerCase(), 'The actual process must use the same C: temporary paths.');
    }
    assert.equal((await realpath(temporaryDirectory)).toLowerCase(), temporaryDirectory.toLowerCase());
    assert((await lstat(temporaryDirectory)).isDirectory() && !(await lstat(temporaryDirectory)).isSymbolicLink());
    assert(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE, 'Disable inherited Node compile-cache writes before launching this runner.');
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({ ...configuration, ssl: false, max: 1, connectionTimeoutMillis: 3000, query_timeout: 17000, options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000' });
    await assertPristinePostgres(pool);
    // inet::text includes its network mask; host(inet) yields the literal address being pinned.
    const identityReadback = await pool.query("SELECT inet_server_addr()::text AS raw_address,host(inet_server_addr()) AS host_address,inet_server_port() AS port,current_setting('data_directory') AS data_directory");
    assert.equal(identityReadback.rows.length, 1); assert.equal(identityReadback.rows[0].host_address, configuration.host);
    assert.equal(identityReadback.rows[0].port, configuration.port);
    assert(typeof identityReadback.rows[0].data_directory === 'string' && isAbsolute(identityReadback.rows[0].data_directory));
    const dataDirectory = resolve(identityReadback.rows[0].data_directory), dataSuffix = relative(OWNED_WORKSPACE, dataDirectory);
    assert(dataSuffix && !isAbsolute(dataSuffix) && dataSuffix !== '..' && !dataSuffix.startsWith('..' + sep), 'The actual PostgreSQL cluster must keep its writes below task-4 on C:.');
    assert.equal((await realpath(dataDirectory)).toLowerCase(), dataDirectory.toLowerCase());
    report.environmentGuards = { ownedWorkspace: OWNED_WORKSPACE, runRoot, temporaryDirectory, postgresDataDirectory: dataDirectory, dRuntimeAccessPolicy: 'read-only-existing-files', compileCacheEnvironment: 'unset' };
    record('native-literal-address-identity-readback', 'native-postgresql-actual-identity', identityReadback.rows[0]);
    search = await PostgresInvestigationSearch.connect({ ...configuration, maxConnections: 1, operationTimeoutMs: 15000 });
    const documents = [
      { id: 'oracle-investigation', kind: 'investigation', revision: 1, digest: hash('oracle-investigation-v1'), text: 'Saffron reserve investigation and rare orchid.' },
      { id: 'oracle-journal', kind: 'journal', revision: 2, digest: hash('oracle-journal-v2'), text: 'Saffron reserve decision and private notes.' },
      { id: 'oracle-other', kind: 'investigation', revision: 1, digest: hash('oracle-other-v1'), text: 'Separate copper inquiry.' },
    ];
    const projection = { complete: true, expectedDocuments: documents.length, documents };
    for (const [query, expected] of [['SAFFRON reserve', ['oracle-investigation', 'oracle-journal']], ['rare orchid', ['oracle-investigation']], ['unfindable', []]]) {
      phase = 'native-search-literal-oracle';
      const answer = await search.search(projection, searchRequest(query));
      assert.equal(answer.engine, 'postgres'); assert.equal(answer.serverIdentity.serverVersion, '18.6');
      assert.deepEqual(answer.matches.map(match => match.id), expected); assert.equal(answer.completeness.documents, 3);
      report.engines.postgres = 'native-executed';
      record(`native-simple-token-oracle:${expected.length}-matches`, 'native-postgresql-actual-token-search', { matchedDocuments: expected.length });
    }
    await assert.rejects(search.search(projection, { ...searchRequest('saffron'), bounds: { ...bounds, maxMatches: 1 } }), { code: 'SEARCH_MATCH_LIMIT' });
    await assert.rejects(search.search(projection, searchRequest('!!!')), { code: 'SEARCH_EMPTY_TERMS' });
    const empty = await search.search({ complete: true, expectedDocuments: 0, documents: [] }, searchRequest('saffron'));
    assert.equal(empty.completeness.documents, 0); assert.deepEqual(empty.matches, []);
    await assertPristinePostgres(pool);
    record('native-search-overflow-empty-terms-and-empty-authorized-corpus', 'native-postgresql-no-persistent-public-index');
    await search.close(); search = undefined;

    const directory = join(runRoot, 'production-investigations'), name = 'Synthetic private investigation qualification';
    const passphrase = PUBLIC_FIXTURE_PASSPHRASE; engineSlot = hash(resolve(directory, 'main'));
    const engineOptions = { directory, demo: false, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL, gateway: { http: async () => { providerCalls++; throw new Error('Unexpected provider call.'); }, process: async () => { providerCalls++; throw new Error('Unexpected provider call.'); } } };
    const start = async () => { engine = new Engine(engineOptions); app = createLocalServer(engine); return await app.listen(); };
    let pairing = await start();
    const raw = async (method, payload = {}) => {
      const response = await fetch(`${pairing.origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pairing.token}` }, body: JSON.stringify({ method, payload }), signal: AbortSignal.timeout(20000) });
      return { status: response.status, body: await response.json() };
    };
    const rpc = async (method, payload = {}) => { const result = await raw(method, payload); if (result.body.error) throw Object.assign(new Error('Synthetic native Engine request refused.'), { code: result.body.error.code }); assert.equal(result.status, 200); return result.body.result; };
    phase = 'production-http-create-author-and-import';
    const created = await rpc('workspace.create', { name, passphrase, demo: false, pack: 'ecommerce', folder: 'main' }); assert.equal(created.experimental, false);
    const dictionaryDraft = structuredClone((await rpc('ontology.packs')).find(pack => pack.pack === 'ecommerce'));
    dictionaryDraft.definitions.find(definition => definition.name === 'received').meaning = 'Owner-authored synthetic convention: count separately imported settled payment amounts by settlement date; no collection cause is inferred.';
    dictionaryDraft.definitions.find(definition => definition.name === 'billed').meaning = 'Owner-authored synthetic convention: count separately imported issued invoices excluding tax by invoice event date; collections are distinct.';
    const dictionary = await rpc('ontology.publish', { draft: dictionaryDraft });
    const moneyImport = await rpc('sources.import', syntheticImport(name));
    const productImport = await rpc('sources.import', syntheticImport(name, true));
    assert.equal(moneyImport.coverage.reconciled, true); assert.equal(productImport.coverage.reconciled, true);
    const asOf = new Date().toISOString();
    phase = 'production-native-underlying-bridge-measurements';
    const baseline = await rpc('calculation.run', { operation: 'earned', period: AUGUST, asOf, branch: 'main' }); literalTotal(baseline, '100');
    const comparison = await rpc('calculation.run', { operation: 'earned', period: SEPTEMBER, asOf, branch: 'main' }); literalTotal(comparison, '240');
    const profile = await rpc('analysis.bridge.publish', { id: 'synthetic-products', expectedRevision: 0, definition: {
      label: 'Explicit synthetic product convention', dictionaryHash: dictionary.hash, operationId: 'earned', moneyDefinitionHash: hash(dictionary.definitions.find(definition => definition.name === 'earned')),
      quantityField: 'quantity', quantityMeaning: 'Explicit authored delivered item count encoded as a whole integer.', quantityScale: 0,
      identityFields: ['sku'], identityMeaning: 'Exact product SKU across monthly cuts with one fact per product per period.', grain: 'one-fact-per-product-period',
      unitField: 'unit', unit: 'item', unitMeaning: 'One delivered retail piece with no package conversion.', factorRule: 'realized-average-net-amount-per-unit',
      method: 'separate-interaction', rounding: 'truncate-toward-zero-minor', incompleteCoverage: 'partial', scope: { branch: 'main', sourceIds: [PRODUCT_SOURCE] },
    } });
    const bridge = await rpc('analysis.bridge.run', { profileId: profile.id, profileRevision: profile.revision, baselineReceiptId: baseline.id, comparisonReceiptId: comparison.id });
    assert.equal(bridge.qualification, 'declared-experimental'); assert.equal(bridge.sourceQualification, 'source-unqualified');
    assert.equal(bridge.result.measuredDeltaMinor, '140');
    for (const [key, expected] of Object.entries({ volumeMinor: '100', priceMinor: '20', interactionMinor: '20', scopeAddedMinor: '0', scopeRemovedMinor: '0' })) assert.equal(bridge.result.contributions[key], expected);
    for (const key of ['missingFactorMinor', 'roundingMinor', 'totalMinor']) assert.equal(bridge.result.residual[key], '0');
    report.engines.duckdb = 'native-executed';
    record('production-owner-declared-bridge-with-native-money-receipts', 'native-duckdb-receipts-and-declared-experimental-javascript-bridge', { baselineMinor: '100', comparisonMinor: '240', changeMinor: '140' });

    phase = 'production-private-investigation-create-and-pause';
    const forReceipt = await rpc('calculation.run', { operation: 'received', period: AUGUST, asOf, branch: 'main' }); literalTotal(forReceipt, '15000');
    const againstReceipt = await rpc('calculation.run', { operation: 'billed', period: AUGUST, asOf, branch: 'main' }); literalTotal(againstReceipt, '70000');
    let investigation = await rpc('investigations.create', { objective: 'Saffron inquiry: why did August collections fall? Keep measurements separate from owner guesses.', branch: 'main', asOf, sourceIds: [MONEY_SOURCE],
      steps: [{ id: 'july-collections', label: 'Measure settled July collections', request: { operation: 'received', period: JULY } }, { id: 'august-collections', label: 'Measure settled August collections', request: { operation: 'received', period: AUGUST } }, { id: 'august-invoices', label: 'Retain separately reported August invoices as counterevidence', request: { operation: 'billed', period: AUGUST } }],
      hypotheses: [{ id: 'timing-guess', text: 'Owner guess: payment timing might explain the decrease; rising invoice value does not establish the cause.', uncertainty: 'unresolved', forReceiptIds: [forReceipt.id], againstReceiptIds: [againstReceipt.id] }], budget: { maxSteps: 3, maxReceiptRows: 100, maxContextBytes: 16384 } });
    investigation = await rpc('investigations.advance', { id: investigation.id, expectedRevision: investigation.revision });
    const firstReceiptId = investigation.steps[0].receipt.receiptId; literalTotal(await rpc('receipts.get', { id: firstReceiptId }), '30000');
    investigation = await rpc('investigations.pause', { id: investigation.id, expectedRevision: investigation.revision, reason: 'Explicit synthetic owner pause before remaining measurements.' });
    const journalContent = { text: 'Saffron decision: retain present collection terms pending explicit owner review.', options: [{ id: 'keep', label: 'Keep terms', reason: 'Observe the imported collection evidence first.', evidence: [{ receiptId: forReceipt.id, figureKey: 'total' }] }], assumptions: [{ id: 'lag', text: 'Payment timing remains unverified.', status: 'unverified', evidence: [] }], selectedOptionId: 'keep', ownerId: 'owner', branch: 'main',
      expectedOutcome: { description: 'Review separately measured collections.', measure: 'received', population: 'Imported main branch collections', baseline: { receiptId: forReceipt.id, figureKey: 'total' }, window: SEPTEMBER, maturityDate: '2026-10-15', lagRule: 'Owner review after the declared maturity date.', uncertainty: ['No causal conclusion is established.'] }, reviewDate: '2026-10-15', hypotheses: ['Payment timing remains an owner hypothesis.'] };
    const draft = await rpc('decisions.journal.draft', { content: journalContent });
    const journal = await rpc('decisions.journal.confirm', { draft, reviewedDigest: draft.digest });
    phase = 'production-native-search-across-private-services';
    const before = await rpc('research.search', searchRequest('SAFFRON'));
    assert.equal(before.engine, 'postgres'); assert.equal(before.serverIdentity.serverVersion, '18.6');
    assert.deepEqual(before.matches.map(match => `${match.kind}:${match.id}`).sort(), [`investigation:${investigation.id}`, `journal:${journal.id}`].sort());
    assert.equal(before.scope, 'current-authorized-valid-investigations-and-journals');
    record('production-native-search-finds-authorized-investigation-and-journal', 'native-postgresql-and-actual-engine-http', { matchedDocuments: 2 });
    await app.close(20000); app = undefined; pairing = await start(); await rpc('workspace.open', { folder: 'main', passphrase });
    phase = 'production-postgresql-reopen-and-resume';
    assert.deepEqual(await rpc('investigations.get', { id: investigation.id }), investigation);
    const reopenedSearch = await rpc('research.search', searchRequest('saffron')); assert.deepEqual(reopenedSearch.matches, before.matches); assert.equal(reopenedSearch.projectionDigest, before.projectionDigest);
    investigation = await rpc('investigations.resume', { id: investigation.id, expectedRevision: investigation.revision });
    for (const expected of ['15000', '70000']) { investigation = await rpc('investigations.advance', { id: investigation.id, expectedRevision: investigation.revision }); const pin = investigation.steps.filter(step => step.state === 'completed').at(-1).receipt; literalTotal(await rpc('receipts.get', { id: pin.receiptId }), expected); }
    assert.equal(investigation.status, 'complete'); assert.equal(investigation.steps[0].receipt.receiptId, firstReceiptId);
    assert.equal(engine.vault.read().receipts.filter(receipt => receipt.id === firstReceiptId).length, 1);
    const capsule = await rpc('investigations.capsule', { id: investigation.id }); assert.equal(capsule.completeness, 'complete-persisted-plan'); assert.equal(capsule.hypotheses[0].uncertainty, 'unresolved'); assert.equal(capsule.hypotheses[0].causalStatus, 'not-established-cause');
    const expectedCapsule = new Map([[forReceipt.id, '15000'], [againstReceipt.id, '70000'], ...investigation.steps.map((step, index) => [step.receipt.receiptId, ['30000', '15000', '70000'][index]])]);
    assert.deepEqual(capsule.measurements.map(measurement => measurement.receiptId).sort(), [...expectedCapsule.keys()].sort());
    for (const measurement of capsule.measurements) assert.equal(measurement.figures.find(figure => figure.key === 'total').minor, expectedCapsule.get(measurement.receiptId));
    const page = await rpc('investigations.drilldown', { id: investigation.id, receiptId: forReceipt.id, offset: 0, limit: 1 }); assert.equal(page.rows[0].amountMinor, '15000'); assert.equal(page.completeness, 'bounded-receipt-page');
    assert.deepEqual(await rpc('analysis.bridge.get', { id: bridge.id }), bridge);
    record('production-reopen-resume-capsule-drilldown-and-bridge-readback', 'native-postgresql-encrypted-reopen-and-default-native-duckdb', { julyCollectionsMinor: '30000', augustCollectionsMinor: '15000', augustInvoicesMinor: '70000' });
    const persisted = await pool.query('SELECT envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [engineSlot]); assert.equal(persisted.rows.length, 1);
    for (const marker of [name, passphrase, 'Saffron inquiry', 'Saffron decision', 'product-a']) assert(!persisted.rows[0].envelope.includes(marker));
    phase = 'production-source-erasure-and-search-release';
    await rpc('sources.delete', { id: MONEY_SOURCE });
    assert.equal((await raw('investigations.get', { id: investigation.id })).body.error.code, 'INVESTIGATION_NOT_FOUND');
    const afterDeletion = await rpc('research.search', searchRequest('saffron')); assert.deepEqual(afterDeletion.matches, []); assert.equal(afterDeletion.completeness.documents, 0);
    assert.equal((await rpc('decisions.list')).some(decision => decision.id === journal.id), false);
    await rpc('sources.delete', { id: PRODUCT_SOURCE });
    assert.equal((await raw('analysis.bridge.get', { id: bridge.id })).body.error.code, 'BRIDGE_UNAVAILABLE');
    assert.equal(providerCalls, 0); assert.equal(engine.vault.read().modelReceipts.length, 0); assert.equal(engine.vault.read().policy.send, 'nothing');
    record('production-lineage-deletion-removes-searchable-private-documents', 'native-postgresql-and-actual-engine-http');
    await rpc('workspace.delete', { confirmation: name });
    assert.equal((await pool.query('SELECT count(*)::text AS count FROM public.chausar_vault_authority WHERE slot=$1', [engineSlot])).rows[0].count, '0');
    record('production-owned-workspace-deletion', 'native-postgresql-encrypted-authority');
  } catch (error) { report.checks.push({ name: phase, passed: false, reason: code(error) }); }
  finally {
    try { await app?.close(20000); } catch (error) { report.checks.push({ name: 'close-owned-http-engine', passed: false, reason: code(error) }); }
    try { await search?.close(); } catch (error) { report.checks.push({ name: 'close-owned-native-search', passed: false, reason: code(error) }); }
    if (pool && engineSlot) try { await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot=$1', [engineSlot]); } catch (error) { report.checks.push({ name: 'remove-owned-authority-slot', passed: false, reason: code(error) }); }
    try { await pool?.end(); } catch (error) { report.checks.push({ name: 'close-fixture-pool', passed: false, reason: code(error) }); }
  }
  report.passed = report.checks.every(check => check.passed) && report.engines.postgres === 'native-executed' && report.engines.duckdb === 'native-executed' && report.checks.some(check => check.name === 'production-owned-workspace-deletion');
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--preflight') { assert.equal(process.argv.length, 3); process.stdout.write(JSON.stringify({ suite: 'c-owned-private-investigations-native-preparation-only', nativeExecuted: false, foundation: { commit: FOUNDATION_COMMIT, script: 'scripts/verify-investigations-native.mjs' }, ownedWorkspace: OWNED_WORKSPACE, fixtureCredential: 'fixed-public-synthetic-only', method: METHOD, literalMinorValues: ['100', '240', '140', '30000', '15000', '70000'], sourceQualification: 'synthetic-experimental' }, null, 2) + '\n'); }
  else { assert.equal(process.argv.length, 2); const report = await runInvestigationsCNativeQualification(); process.stdout.write(JSON.stringify(report, null, 2) + '\n'); if (!report.passed) process.exitCode = 1; }
}
