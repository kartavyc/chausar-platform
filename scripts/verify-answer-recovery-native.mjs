import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../platform/runtime/engine.ts';
import { hash } from '../platform/runtime/contracts.ts';
import { QualificationError, disposablePostgresConfiguration, assertPristinePostgres } from './verify-database-differential.mjs';

const FILE = fileURLToPath(import.meta.url);
const SOURCE_COMMIT = '1dc19b856380951aea49b7143ed4b5617130c06b';
const TASK_ROOT = resolve('C:/Users/karta/Documents/Codex/2026-10-01/task-4');
const FIXTURE_PASSPHRASE = 'Public synthetic native answer recovery fixture passphrase only';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
// Explicit synthetic scope, not an inferred legacy cutoff or an actual historical replay.
const CHOSEN_AS_OF = '2100-01-01T00:00:00.000Z';
const SOURCE_ID = 'synthetic-native-answer-recovery-register';
const RESTORED_FOLDER = 'restored_recovery';
const folded = value => process.platform === 'win32' ? value.toLowerCase() : value;
const requireCondition = (condition, code, message) => {
  if (!condition) throw new QualificationError(code, message);
};

async function qualificationRoot(environment) {
  const value = environment.CHAUSAR_QUALIFICATION_RUN_ROOT;
  requireCondition(typeof value === 'string' && value.length > 0 && isAbsolute(value), 'QUALIFICATION_RUN_ROOT_REQUIRED', 'Provide the explicit C-drive task-4 qualification root.');
  const selected = resolve(value), root = resolve(TASK_ROOT);
  requireCondition(process.platform === 'win32' && /^C:\\/i.test(selected) && folded(selected).startsWith(folded(root + sep)),
    'QUALIFICATION_RUN_ROOT_INVALID', 'The run root must be strictly inside the approved C-drive task-4 directory.');
  const physical = await realpath(selected), metadata = await lstat(selected);
  requireCondition(metadata.isDirectory() && !metadata.isSymbolicLink() && folded(physical) === folded(selected),
    'QUALIFICATION_RUN_ROOT_INVALID', 'Use an existing canonical qualification directory without a symlink.');
  const temporary = resolve(tmpdir()), expectedTemporary = join(physical, 'temp');
  for (const name of ['TEMP', 'TMP']) {
    requireCondition(typeof environment[name] === 'string' && folded(resolve(environment[name])) === folded(expectedTemporary)
      && typeof process.env[name] === 'string' && folded(resolve(process.env[name])) === folded(expectedTemporary),
    'QUALIFICATION_TEMP_ROOT_INVALID', 'Both supplied and actual TEMP/TMP must use the canonical C-drive run root temp directory.');
  }
  requireCondition(!environment.NODE_COMPILE_CACHE && !process.env.NODE_COMPILE_CACHE,
    'QUALIFICATION_COMPILE_CACHE_REFUSED', 'The supervisor must disable inherited Node compile-cache writes.');
  const physicalTemporary = await realpath(temporary), temporaryMetadata = await lstat(temporary);
  requireCondition(folded(temporary) === folded(expectedTemporary) && folded(physicalTemporary) === folded(expectedTemporary)
    && temporaryMetadata.isDirectory() && !temporaryMetadata.isSymbolicLink(),
  'QUALIFICATION_TEMP_ROOT_INVALID', 'The supervisor must set TEMP and TMP to the run root temp directory.');
  return physical;
}

function sourceInput() {
  return {
    sourceId: SOURCE_ID, format: 'csv',
    content: 'id,kind,date,amount,tax,currency,branch,status\nI1,invoice,2026-09-02,100.00,10.00,INR,main,issued\nHUGE,invoice,2026-09-03,9007199254740993.91,0.09,INR,large,issued\n',
    recipe: {
      version: 1, id: 'synthetic-native-answer-recovery-recipe', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic Native Recovery', branches: ['main', 'large'] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' })),
      ],
      allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject',
    },
    expectedTotals: { rowCount: 2, amountMinor: '900719925474109391' },
  };
}

function originalRecords(state, answerId, receiptId) {
  const answer = state.answers.find(value => value.id === answerId);
  const receipt = state.receipts.find(value => value.id === receiptId);
  assert.ok(answer && receipt);
  return { answer, receipt };
}
function nativeProof(receipt) {
  assert.equal(receipt.databaseProof?.verified, true);
  assert.equal(receipt.databaseProof?.engine, 'duckdb');
}

/** Root supplies a freshly recreated chausar_test and supervises the process.
 * This function does not provision a database, launch a server, install packages,
 * modify process/global settings, call a model, or select a product default.
 * Only the direct CLI entry emits the single JSON report.
 */
export async function runAnswerRecoveryNativeQualification(environment = process.env) {
  const report = {
    suite: 'native-postgresql-storage-duckdb-answer-recovery',
    sourceCommit: environment.CHAUSAR_SOURCE_COMMIT ?? null,
    foundationCommit: SOURCE_COMMIT, sourceCommitVerification: 'supervisor-reported-exact-baseline',
    passed: false, checks: [], blockers: [], node: process.version,
    engines: { postgresStorage: 'not-executed', duckdbArithmetic: 'not-executed' },
    publicSurface: 'Engine.request; no HTTP transport, renderer or installed desktop qualification',
    fixtureConstruction: 'Public workspace creation/import/native calculation, then an explicitly labelled actual Vault.update removes only the saved request asOf to author synthetic legacy state. Recovery uses unchanged public routes.',
    scope: 'Saved-answer fresh recovery, encrypted PostgreSQL snapshot persistence, native DuckDB arithmetic, exact retries, identity-preserving v1 snapshot restore, and typed PostgreSQL v2 archive/activation refusal boundaries.',
    modelCalls: 0, fullScopeQualified: false, productionDefaultSelected: false,
    unsupportedBoundaries: [
      { feature: 'complete encrypted v2 PostgreSQL archive', code: 'BACKUP_STORAGE_PROFILE_REQUIRED' },
      { feature: 'fresh-authority PostgreSQL activation', code: 'ACTIVATION_ROOT_REQUIRED' },
      { feature: 'v1 snapshot backup with managed private artifacts', code: 'ARTIFACT_BACKUP_REQUIRED' },
      { feature: 'historical reconstruction or retirement of the preserved unpinned original', status: 'not-granted-by-fresh-recovery' },
    ],
    limitations: [
      'PostgreSQL persists encrypted snapshots; this suite does not qualify persistent normalized relational business claims.',
      'A successful v1 restore preserves historical workspace/owner identity; it is not fresh activation.',
      'No crash/power-loss, PGlite, OS cross-process authority or live provider/credential qualification.',
      'The coordinator must enforce the external process ceiling and recreate the disposable database between runners.',
    ],
  };
  const started = Date.now();
  const record = (name, evidence, details = {}) => report.checks.push({ name, passed: true, evidence, ...details });
  const failure = (name, error) => {
    const reason = typeof error?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(error.code)
      ? error.code : error?.name === 'AssertionError' ? 'ASSERTION_FAILED' : 'NATIVE_RECOVERY_FAILED';
    report.checks.push({ name, passed: false, reason });
    return reason;
  };
  let pool, engine, configuration, directory;
  let providerCalls = 0, stage = 'fixture-preflight';
  const ownedSlots = new Set();
  try {
    requireCondition(environment.CHAUSAR_SOURCE_COMMIT === SOURCE_COMMIT, 'SOURCE_COMMIT_PIN_REQUIRED', 'The supervisor must pin the exact published source baseline.');
    configuration = disposablePostgresConfiguration(environment);
    const root = await qualificationRoot(environment);
    const pg = await import('pg'), Pool = pg.Pool ?? pg.default?.Pool;
    pool = new Pool({
      ...configuration, max: 2, connectionTimeoutMillis: 5000, query_timeout: 17000,
      application_name: 'chausar-native-recovery-qualification', ssl: false,
      options: '-c search_path=public -c statement_timeout=15000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000',
    });
    await assertPristinePostgres(pool);
    const identity = (await pool.query("SELECT version() AS version,host(inet_server_addr()) AS host_address,inet_server_port() AS port,current_setting('data_directory') AS data_directory")).rows;
    requireCondition(identity.length === 1 && identity[0].host_address === configuration.host && identity[0].port === configuration.port,
      'DATABASE_ADDRESS_IDENTITY_MISMATCH', 'The actual server must identify the explicitly selected loopback address and port.');
    requireCondition(typeof identity[0].data_directory === 'string' && isAbsolute(identity[0].data_directory),
      'DATABASE_DATA_DIRECTORY_INVALID', 'The actual PostgreSQL cluster must declare its absolute task-owned C-drive data directory.');
    const dataDirectory = resolve(identity[0].data_directory), dataMetadata = await lstat(dataDirectory);
    requireCondition(/^C:\\/i.test(dataDirectory) && folded(dataDirectory).startsWith(folded(TASK_ROOT + sep))
      && folded(await realpath(dataDirectory)) === folded(dataDirectory) && dataMetadata.isDirectory() && !dataMetadata.isSymbolicLink(),
    'DATABASE_DATA_DIRECTORY_INVALID', 'The actual PostgreSQL data directory must be canonical and strictly inside the approved C-drive task-4 workspace.');
    report.engines.postgresStorage = { version: identity[0].version, database: 'chausar_test' };
    report.environmentGuards = { ownedWorkspace: TASK_ROOT, runRoot: root, temporaryDirectory: join(root, 'temp'),
      postgresDataDirectory: dataDirectory, compileCacheEnvironment: 'unset', dRuntimeAccessPolicy: 'read-only-existing-files' };
    record('strict-disposable-loopback-pristine-database', 'actual-postgresql-read-only-preflight',
      { host: identity[0].host_address, port: identity[0].port, dataDirectory });
    directory = join(root, 'answer-recovery');
    await mkdir(directory); // Refuse an existing directory instead of adopting its contents.
    assert.equal(dirname(await realpath(directory)), root);
    report.directory = directory;
    const options = {
      directory, storage: 'postgres', postgresUrl: environment.CHAUSAR_TEST_DATABASE_URL, demo: false,
      gateway: { http: async () => { providerCalls++; throw Error('Live model calls are forbidden in the synthetic native recovery suite.'); } },
    };
    engine = new Engine(options);
    stage = 'public-postgresql-workspace-and-source';
    ownedSlots.add(hash(join(directory, 'main')));
    await engine.request('workspace.create', { name: 'Synthetic Native Recovery', folder: 'main', pack: 'retail', passphrase: FIXTURE_PASSPHRASE, demo: false });
    assert.equal(engine.vault.storageKind, 'postgres');
    const input = sourceInput(), imported = await engine.request('sources.import', input);
    assert.equal(imported.coverage.reconciled, true);
    assert.equal(imported.totalsMinor, '900719925474109391');
    const importedFacts = hash(engine.vault.read().facts), importedRows = hash(engine.vault.read().imports);
    const duplicate = await engine.request('sources.import', structuredClone(input));
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.id, imported.id);
    assert.equal(hash(engine.vault.read().facts), importedFacts);
    assert.equal(hash(engine.vault.read().imports), importedRows);
    record('public-exact-source-import-and-duplicate-no-op', 'real-postgresql-vault-public-import', { totalMinor: imported.totalsMinor });

    stage = 'native-duckdb-original-and-large-exact-calculations';
    const request = { operation: 'billed', period: PERIOD, sourceIds: [SOURCE_ID], branch: 'main', asOf: CHOSEN_AS_OF };
    const originalReceipt = await engine.request('calculation.run', request);
    assert.equal(originalReceipt.totalMinor, '10000'); nativeProof(originalReceipt);
    const large = await engine.request('calculation.run', { ...request, branch: 'large' });
    assert.equal(large.totalMinor, '900719925474099391'); nativeProof(large);
    report.engines.duckdbArithmetic = 'actual-native-worker-receipt-proof-duckdb';
    const originalAnswer = engine.vault.read().answers.find(value => value.receiptId === originalReceipt.id);
    assert.ok(originalAnswer);
    record('public-native-original-and-above-safe-integer', 'real-postgresql-snapshot-and-default-native-duckdb-worker', { originalMinor: '10000', exactLargeMinor: large.totalMinor });

    stage = 'explicit-synthetic-legacy-fixture-construction';
    // Same explicit legacy authoring seam as answer-recovery-public.test.ts.
    // No recovery route mutates/removes a historical cutoff in production.
    await engine.vault.update(state => {
      const saved = state.answers.find(value => value.id === originalAnswer.id);
      assert.equal(saved.request.asOf, CHOSEN_AS_OF);
      delete saved.request.asOf;
    });
    const importedInvoice = engine.vault.read().facts.find(value => value.entityId === 'I1' && value.sourceId === SOURCE_ID);
    await engine.request('memory.correct', { id: importedInvoice.id, fields: { amountMinor: '25000' } });
    const originalBytes = JSON.stringify(originalRecords(engine.vault.read(), originalAnswer.id, originalReceipt.id));
    record('labelled-synthetic-unpinned-legacy-and-public-correction', 'explicit-fixture-vault-update-plus-public-memory-correct', { preservedOriginalMinor: '10000', currentCorrectedMinor: '25000' });

    stage = 'public-recovery-review-prepare';
    const review = await engine.request('answers.recovery.review', { answerId: originalAnswer.id });
    assert.equal(review.status, 'new-time-scope-required');
    assert.equal(review.historicalReplay, false);
    assert.equal(Object.hasOwn(review.originalRequest, 'asOf'), false);
    const timeScope = { asOf: CHOSEN_AS_OF, period: PERIOD, comparePeriod: null, onDate: null };
    const declaration = { answerId: originalAnswer.id, source: review.source, reviewedEvidencePin: review.reviewedEvidencePin, timeScope, confirmedNewCalculation: true };
    const beforeInvalid = engine.vault.read();
    const missingScope = { ...timeScope }; delete missingScope.asOf;
    await assert.rejects(engine.request('answers.recovery.prepare', { ...declaration, timeScope: missingScope }), { code: 'INVALID_ANSWER_RECOVERY' });
    assert.deepEqual(engine.vault.read(), beforeInvalid);
    const issued = await engine.request('answers.recovery.prepare', declaration);
    assert.equal(issued.status, 'prepared');
    assert.equal(issued.preparation.request.asOf, CHOSEN_AS_OF);
    assert.deepEqual(issued.preparation.request.period, PERIOD);
    assert.deepEqual(issued.preparation.request.sourceIds, [SOURCE_ID]);
    assert.equal(issued.preparation.request.branch, 'main');
    record('public-explicit-scope-preparation-and-refusal-atomicity', 'real-postgresql-vault-public-recovery', { chosenAsOf: CHOSEN_AS_OF });

    stage = 'public-native-recovery-concurrent-exact-execution';
    const execute = { newRequestId: issued.newRequestId, preparationDigest: issued.preparationDigest };
    const before = engine.vault.read();
    const [fresh, concurrent] = await Promise.all([
      engine.request('answers.recovery.execute', execute),
      engine.request('answers.recovery.execute', execute),
    ]);
    assert.deepEqual(concurrent, fresh);
    const after = engine.vault.read();
    assert.equal(fresh.status, 'completed');
    assert.equal(fresh.receipt.totalMinor, '25000'); nativeProof(fresh.receipt);
    assert.equal(fresh.receipt.asOf, CHOSEN_AS_OF);
    assert.equal(fresh.lineage.historicalReplay, false); assert.equal(fresh.lineage.grantsAuthority, false);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.receipts.length, before.receipts.length + 1);
    assert.equal(after.answers.length, before.answers.length + 1);
    assert.notEqual(fresh.answer.id, originalAnswer.id);
    assert.notEqual(fresh.receipt.id, originalReceipt.id);
    assert.equal(JSON.stringify(originalRecords(after, originalAnswer.id, originalReceipt.id)), originalBytes);
    assert.deepEqual(await engine.request('answers.recovery.execute', execute), fresh);
    assert.deepEqual(engine.vault.read(), after);
    record('public-native-exact-recovery-one-cas-and-retry-no-op', 'actual-postgresql-cas-native-duckdb-public-recovery', { originalMinor: '10000', freshMinor: '25000', revisionDelta: 1, concurrentRequests: 2 });

    stage = 'postgresql-authority-ciphertext-inspection';
    const stored = await pool.query('SELECT revision::text AS revision, envelope::text AS envelope FROM public.chausar_vault_authority WHERE slot=$1', [hash(join(directory, 'main'))]);
    assert.equal(stored.rows[0].revision, String(after.revision));
    for (const plaintext of [SOURCE_ID, FIXTURE_PASSPHRASE, input.content, fresh.answer.id, fresh.receipt.id]) assert.equal(stored.rows[0].envelope.includes(plaintext), false);
    record('real-postgresql-stores-encrypted-recovery-authority', 'actual-postgresql-ciphertext-table-query');

    stage = 'new-engine-reopen-and-exact-issued-result-readback';
    await engine.request('workspace.lock'); await engine.close();
    engine = new Engine(options);
    await engine.request('workspace.open', { folder: 'main', passphrase: FIXTURE_PASSPHRASE });
    assert.deepEqual(engine.vault.read(), after);
    assert.deepEqual(await engine.request('answers.recovery.get', { newRequestId: issued.newRequestId }), fresh);
    assert.deepEqual((await engine.request('answers.recovery.list', { answerId: originalAnswer.id })).items, [fresh]);
    const reopenedBytes = hash(engine.vault.read());
    assert.deepEqual(await engine.request('answers.recovery.execute', execute), fresh);
    assert.equal(hash(engine.vault.read()), reopenedBytes);
    assert.equal(JSON.stringify(originalRecords(engine.vault.read(), originalAnswer.id, originalReceipt.id)), originalBytes);
    record('new-engine-postgresql-reopen-get-list-execute-idempotency', 'actual-postgresql-unlock-new-engine-public-recovery-readback');

    stage = 'ordinary-encrypted-v1-snapshot-backup-restore-and-reopen';
    const stateBeforeBackup = engine.vault.read(), identityBefore = engine.vault.vaultId;
    const backup = await engine.request('workspace.backup');
    assert.equal(backup.encrypted, true);
    const actualBackup = resolve(backup.path), backupRoot = join(directory, 'backups');
    const backupRelative = relative(backupRoot, actualBackup);
    assert.ok(backupRelative && !isAbsolute(backupRelative) && !backupRelative.startsWith('..') && backupRelative.endsWith('.backup'));
    const backupText = await readFile(actualBackup, 'utf8'), backupEnvelope = JSON.parse(backupText);
    assert.equal(backupEnvelope.backupFormat, 'chausar.backup.v1');
    for (const plaintext of [SOURCE_ID, FIXTURE_PASSPHRASE, input.content]) assert.equal(backupText.includes(plaintext), false);
    await engine.request('workspace.lock');
    ownedSlots.add(hash(join(directory, RESTORED_FOLDER)));
    await engine.request('workspace.restore', { backupFile: basename(backup.path), folder: RESTORED_FOLDER, passphrase: FIXTURE_PASSPHRASE });
    assert.equal(engine.vault.storageKind, 'postgres');
    assert.equal(engine.vault.vaultId, identityBefore);
    assert.deepEqual(engine.vault.read(), stateBeforeBackup);
    assert.deepEqual(await engine.request('answers.recovery.get', { newRequestId: issued.newRequestId }), fresh);
    await engine.request('workspace.lock'); await engine.close();
    engine = new Engine(options);
    await engine.request('workspace.open', { folder: RESTORED_FOLDER, passphrase: FIXTURE_PASSPHRASE });
    assert.deepEqual(engine.vault.read(), stateBeforeBackup);
    assert.deepEqual(await engine.request('answers.recovery.execute', execute), fresh);
    assert.deepEqual(engine.vault.read(), stateBeforeBackup);
    record('public-encrypted-v1-backup-separate-postgresql-slot-restore-and-new-engine-reopen', 'actual-encrypted-backup-postgresql-snapshot-restore', { sameHistoricalIdentity: true, freshActivation: false, encryptedBackupBytes: Buffer.byteLength(backupText) });

    stage = 'native-published-custom-money-field-fresh-recovery';
    const currentDictionary = (await engine.request('ontology.get')).current;
    const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions']
      .map(key => [key, structuredClone(currentDictionary[key])]));
    const billed = draft.definitions.find(value => value.name === 'billed');
    billed.field = 'taxMinor';
    billed.meaning = 'Synthetic native current dictionary counts only explicitly imported invoice tax.';
    const published = await engine.request('ontology.publish', { draft });
    const currentOriginalBytes = JSON.stringify(originalRecords(engine.vault.read(), originalAnswer.id, originalReceipt.id));
    const taxReview = await engine.request('answers.recovery.review', { answerId: originalAnswer.id });
    const taxIssued = await engine.request('answers.recovery.prepare', {
      answerId: originalAnswer.id, source: taxReview.source, reviewedEvidencePin: taxReview.reviewedEvidencePin,
      timeScope, confirmedNewCalculation: true,
    });
    const beforeTaxExecute = engine.vault.read();
    const taxFresh = await engine.request('answers.recovery.execute', { newRequestId: taxIssued.newRequestId, preparationDigest: taxIssued.preparationDigest });
    assert.equal(taxFresh.receipt.totalMinor, '1000'); nativeProof(taxFresh.receipt);
    assert.equal(taxFresh.receipt.dictionaryHash, published.hash);
    assert.equal(taxFresh.receipt.compiledCalculation?.sum.moneyField, 'taxMinor');
    assert.equal(engine.vault.read().revision, beforeTaxExecute.revision + 1);
    assert.equal(JSON.stringify(originalRecords(engine.vault.read(), originalAnswer.id, originalReceipt.id)), currentOriginalBytes);
    await assert.rejects(engine.request('answers.recovery.get', { newRequestId: issued.newRequestId }),
      error => ['ANSWER_RECOVERY_SOURCE_CHANGED', 'ANSWER_RECOVERY_RESULT_CHANGED'].includes(error?.code));
    record('native-compiled-tax-field-current-meaning-and-conservative-old-readback-refusal', 'actual-postgresql-vault-native-duckdb-compiled-money-field-public-recovery',
      { originalInvoiceMinor: '10000', correctedNetMinor: '25000', freshCurrentTaxMinor: '1000', moneyField: 'taxMinor' });

    stage = 'postgresql-complete-archive-and-activation-refusal-boundaries';
    const boundaryState = engine.vault.read();
    const boundaries = [
      ['workspace.backup.v2.create', { destinationId: 'synthetic_native_archive', confirmed: true }, 'BACKUP_STORAGE_PROFILE_REQUIRED'],
      ['workspace.backup.v2.read', { backupId: 'synthetic_native_archive' }, 'BACKUP_STORAGE_PROFILE_REQUIRED'],
      ['workspace.backup.v2.restoreInert', { backupId: 'synthetic_native_archive', targetId: 'synthetic_native_inert', reviewedDigest: '0'.repeat(64), confirmed: true }, 'BACKUP_STORAGE_PROFILE_REQUIRED'],
      ['workspace.backup.v2.diagnostics', {}, 'BACKUP_STORAGE_PROFILE_REQUIRED'],
      ['workspace.activation.target.create', { targetId: 'synthetic_native_target', confirmed: true }, 'ACTIVATION_ROOT_REQUIRED'],
      ['workspace.activation.review', { candidateId: 'synthetic_native_candidate', reviewedDigest: '0'.repeat(64) }, 'ACTIVATION_ROOT_REQUIRED'],
      ['workspace.activation.execute', { candidateId: 'synthetic_native_candidate', reviewedDigest: '0'.repeat(64), projectionDigest: '0'.repeat(64), activationId: 'synthetic_native_activation', confirmed: true }, 'ACTIVATION_ROOT_REQUIRED'],
      ['workspace.activation.get', { activationId: 'synthetic_native_activation' }, 'ACTIVATION_ROOT_REQUIRED'],
    ];
    for (const [method, payload, code] of boundaries) {
      await assert.rejects(engine.request(method, payload), { code });
      assert.deepEqual(engine.vault.read(), boundaryState);
      record(method + '-postgresql-boundary', 'actual-postgresql-public-typed-refusal-no-authority-write', { code });
    }
    stage = 'snapshot-only-backup-private-artifact-refusal';
    // Trusted fixture construction creates a genuine encrypted typed artifact;
    // it does not masquerade as public trial evaluation or complete archive support.
    await engine.vault.writeArtifact({
      purpose: 'private-trial', id: 'native_recovery_snapshot_backup_boundary', expectedDigest: null,
      value: { syntheticFixture: true, retainedMarker: 'Public synthetic native private-artifact backup boundary' },
    });
    await assert.rejects(engine.request('workspace.backup'), { code: 'ARTIFACT_BACKUP_REQUIRED' });
    await assert.rejects(engine.request('workspace.export', { confirmed: true, plaintext: false }), { code: 'ARTIFACT_BACKUP_REQUIRED' });
    assert.deepEqual(engine.vault.read(), boundaryState);
    record('postgresql-v1-backup-and-export-refuse-managed-private-artifact-omission', 'real-encrypted-typed-artifact-and-public-refusals', { code: 'ARTIFACT_BACKUP_REQUIRED', artifactConstruction: 'trusted-labelled-synthetic-vault-write' });
    assert.equal(providerCalls, 0);
    record('no-live-model-or-external-provider-calls', 'installed-throwing-model-http-guard', { calls: providerCalls });
  } catch (error) {
    const reason = failure(stage, error);
    report.blockers.push({ stage, reason });
  } finally {
    try { await engine?.close(); } catch (error) { failure('close-native-recovery-engine', error); }
    if (pool && ownedSlots.size > 0) {
      try {
        const relation = (await pool.query("SELECT to_regclass('public.chausar_vault_authority')::text AS relation")).rows[0].relation;
        if (relation !== null) for (const slot of ownedSlots) await pool.query('DELETE FROM public.chausar_vault_authority WHERE slot=$1', [slot]);
      } catch (error) {
        failure('delete-only-owned-disposable-authority-slot', error);
      }
    }
    try { await pool?.end(); } catch (error) { failure('close-disposable-postgresql-inspection-pool', error); }
    report.modelCalls = providerCalls;
    report.ownedDisposableSlots = [...ownedSlots];
    report.retainedSyntheticFilesystem = directory ?? null;
    report.elapsedMs = Date.now() - started;
    report.passed = report.checks.length > 0 && report.checks.every(value => value.passed) && report.blockers.length === 0 && providerCalls === 0;
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(FILE)) {
  const report = await runAnswerRecoveryNativeQualification(process.env);
  process.stdout.write(JSON.stringify(report) + '\n');
  process.exitCode = report.passed ? 0 : 1;
}
