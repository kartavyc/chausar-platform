import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Acceptance proposal only. There is deliberately no constructor adapter here.
// The coordinator supplies a tracked, reviewed wrapper at the exact final pin.
const CONTRACT = 'chausar.postgres-transfer-acceptance-profile.v1';
const budgets = {maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 4_000_000,
  maxTotalEntryBytes: 6_000_000, maxEntries: 100, maxJsonDepth: 128, maxJsonNodes: 100_000};
const captureBudgets = {maxArtifacts: 100, maxEntryBytes: 4_000_000, maxTotalEntryBytes: 6_000_000};
const operations = ['billed', 'received', 'earned'];
const questions = ['What was billed?', 'What was received?', 'What was earned?'];
const totals = ['300000', '260000', '250000'];
const sha = value => createHash('sha256').update(value).digest('hex');
const artifactId = (prefix, id, part) => `${prefix}_${sha(id)}_${part}`;
const fail = code => {throw Object.assign(new Error(code), {code});};
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const stateDigest = state => sha(canonical(state));
const counts = state => Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length]));
const refFence = capture => capture.artifacts.map(item => ({ref: item.ref, sha256: sha(Buffer.from(item.bytes)), bytes: item.bytes.length}))
  .sort((a, b) => canonical(a.ref).localeCompare(canonical(b.ref)));
let completedCases = [];

async function execute(message) {
  assert.equal(message.contractVersion, CONTRACT);
  assert.ok(['primary-before-reopen', 'primary-after-reopen', 'isolated-prepared-open'].includes(message.phase));
  const root = message.sourcePin.sourceRoot;
  const load = name => import(pathToFileURL(join(root, 'platform', 'runtime', name)).href);
  const [{Engine}, {Vault}, {createLocalServer}, {demoCsv, demoRecipe}, v2, interchange, postgres] = await Promise.all([
    load('engine.ts'), load('vault.ts'), load('server.ts'), load('ingest.ts'), load('workspace-backup-v2.ts'), load('workspace-interchange.ts'), load('postgres.ts')]);
  const wrapper = await import(pathToFileURL(message.profilePath).href);
  assert.equal(wrapper.contractVersion, CONTRACT);
  const abort = new AbortController();
  const profile = await wrapper.constructTransferProfile({sourcePin: message.sourcePin, descriptor: message.descriptor,
    credentials: message.credentials, phase: message.phase, signal: abort.signal});
  if (!profile || !['enableCapabilities', 'currentSourceContext', 'captureSourceCustody', 'authenticateSourceCustody', 'readNativeSlot',
    'seedPublicHistory', 'withPreparedStage', 'close', 'diagnostics'].every(name => typeof profile[name] === 'function')) {
    fail('REAL_CONSTRUCTOR_PROFILE_HOOKS_REQUIRED');
  }
  assert.ok(profile.sourceEngine instanceof Engine, 'Use the actual Engine class from the pinned source.');
  assert.ok(profile.journalVault instanceof Vault, 'Use the actual encrypted journal Vault.');
  assert.equal(profile.journalVault.storageKind, 'postgres');
  const apps = new Set(), cases = [], observations = [];
  const probePools = new Map();
  const fixture = message.descriptor.fixtures?.[message.phase === 'isolated-prepared-open' ? 'prepared' : 'primary'];
  if (!fixture?.databases || new Set(Object.values(fixture.databases)).size !== 3
    || !['source','journal','target'].every(role => /^[a-z][a-z0-9_]{0,62}$/.test(fixture.databases[role] ?? ''))) fail('THREE_ISOLATED_NATIVE_DATABASES_REQUIRED');
  const connection = message.descriptor.connection;
  if (!connection || connection.host !== '127.0.0.1' || !Number.isInteger(connection.port)
    || connection.port < 1024 || connection.port > 65535 || typeof connection.user !== 'string'
    || typeof connection.password !== 'string') fail('OWNED_LOOPBACK_NATIVE_CONNECTION_REQUIRED');
  const mark = id => {const value = {id, passed: true}; cases.push(value); completedCases.push(value);};
  const assertNoProviders = async () => {
    const diagnostic = await profile.diagnostics();
    for (const key of ['providerCalls', 'externalEffectCalls', 'automaticDispatchCalls']) assert.equal(diagnostic[key], 0, key);
  };
  function nativeEngine(engine) {
    assert.ok(engine instanceof Engine); assert.equal(engine.options.storage, 'postgres');
    assert.notEqual(engine.options.demo, true, 'File-demo authority is forbidden in this native flow.');
    assert.equal(engine.options.sync, undefined);
    // Committed Engine launch deliberately keeps credentials/URLs opaque and
    // selects its real native adapter via constructor admission (Engine:398).
    if (engine.options.postgresUrl) {
      const url = new URL(engine.options.postgresUrl);
      assert.ok(['postgresql:', 'postgres:'].includes(url.protocol));
      assert.equal(url.hostname, connection.host); assert.equal(Number(url.port || 5432), connection.port);
      assert.ok(Object.values(fixture.databases).includes(decodeURIComponent(url.pathname.slice(1))));
    }
  }
  nativeEngine(profile.sourceEngine);
  const nativeVersion = 'PostgreSQL 18.6';
  function nativePool(role) {
    assert.ok(['source','journal','target'].includes(role));
    if (!probePools.has(role)) {
      const pg = createRequire(join(root, 'package.json'))('pg');
      probePools.set(role, new pg.Pool({...connection, database: fixture.databases[role], max: 1,
        connectionTimeoutMillis: 5000, query_timeout: 5000, statement_timeout: 5000,
        application_name: 'chausar-synthetic-transfer-acceptance'}));
    }
    return probePools.get(role);
  }
  async function witness(engine) {
    nativeEngine(engine);
    const observed = await profile.readNativeSlot(engine);
    assert.ok(observed && typeof observed.slot === 'string' && observed.slot.length > 0);
    assert.ok(['source','target'].includes(observed.databaseRole));
    const pool = nativePool(observed.databaseRole);
    // SQL is fixed, parametrized, and bypasses any wrapper's claimed adapter result.
    const row = (await pool.query('SELECT creation_id, revision, envelope FROM public.chausar_vault_authority WHERE slot=$1', [observed.slot])).rows[0];
    assert.ok(row, 'The actual PostgreSQL authority row must exist.');
    assert.equal(String(row.revision), String(observed.revision));
    assert.equal(row.envelope.id, observed.vaultId);
    assert.equal(row.creation_id, observed.creationId);
    assert.equal(postgres.postgresEnvelopeDigest(row.envelope), observed.envelopeDigest);
    const storage = (await pool.query("SELECT storage_id FROM public.chausar_workspace_postgres_storage WHERE id='current'")).rows[0];
    assert.equal(storage.storage_id, observed.storageId);
    assert.equal(engine.vault.storageKind, 'postgres');
    assert.equal(engine.vault.vaultId, observed.vaultId);
    assert.equal(String(engine.vault.read().revision), String(row.revision));
    observations.push({databaseRole: observed.databaseRole, slotDigest: sha(observed.slot), creationId: observed.creationId,
      storageId: observed.storageId, envelopeDigest: observed.envelopeDigest, revision: String(row.revision), vaultId: observed.vaultId});
    return observed;
  }
  async function http(engine) {
    const app = createLocalServer(engine), {origin, token} = await app.listen();
    assert.ok(['127.0.0.1', '[::1]', '::1'].includes(new URL(origin).hostname));
    const raw = async (method, payload = {}, credential = token) => {
      const response = await fetch(`${origin}/api/rpc`, {method: 'POST', signal: AbortSignal.timeout(10000),
        headers: {'content-type': 'application/json', authorization: `Bearer ${credential}`},
        body: JSON.stringify({method, payload})});
      return {status: response.status, body: await response.json()};
    };
    const rpc = async (method, payload = {}) => {
      const response = await raw(method, payload);
      if (response.status !== 200) fail(`PUBLIC_RPC_${method.toUpperCase().replaceAll('.', '_')}_${response.body.error?.code ?? 'FAILED'}`);
      return response.body.result;
    };
    const refuse = async (method, payload, codes, credential = token) => {
      const response = await raw(method, payload, credential);
      assert.notEqual(response.status, 200); assert.ok(codes.includes(response.body.error?.code), `${method} did not make the required refusal.`);
      for (const secret of [...Object.values(message.credentials), token]) assert.equal(JSON.stringify(response.body).includes(secret), false);
      return response;
    };
    const result = {app, engine, token, rpc, refuse}; apps.add(result); return result;
  }
  async function close(app) {await app.app.close(); apps.delete(app);}
  async function artifact(vault, prefix, id, part) {
    const read = await vault.readArtifact({id: artifactId(prefix, id, part), purpose: 'workspace-interchange'});
    assert.ok(read && read.value && typeof read.value.content === 'string'); return read.value.content;
  }
  function exactCapture(original, retained) {
    assert.deepEqual(Buffer.from(retained.authority), Buffer.from(original.authority));
    assert.equal(retained.artifacts.length, original.artifacts.length);
    for (const item of original.artifacts) {
      const saved = retained.artifacts.find(entry => entry.ref.id === item.ref.id && entry.ref.purpose === item.ref.purpose);
      assert.ok(saved); assert.deepEqual(saved.ref, item.ref); assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(item.bytes));
    }
  }
  async function freshReceipts(target, checkpoint, previousIds) {
    const output = [];
    for (let index = 0; index < operations.length; index++) {
      const {operation, ...filters} = checkpoint.requests[index];
      const answer = await target.rpc('conversation.ask', {question: questions[index], ...filters});
      assert.equal(answer.supported, true); const receipt = answer.receipt;
      assert.equal(receipt.operation, operation); assert.equal(receipt.totalMinor, totals[index]);
      assert.equal(receipt.memberId, checkpoint.activated.ownerContext.memberId);
      assert.equal(receipt.epoch, checkpoint.activated.ownerContext.epoch);
      assert.equal(previousIds.has(receipt.id), false); previousIds.add(receipt.id);
      assert.equal(interchange.compareRecalculatedReceipt({...checkpoint.baseline[index],
        memberId: receipt.memberId, epoch: receipt.epoch}, receipt).equivalent, true);
      assert.deepEqual(await target.rpc('receipts.get', {id: receipt.id}), receipt);
      output.push(receipt);
    }
    await witness(target.engine); return output;
  }
  function assertFreshProjection(fresh, historical, activated) {
    assert.equal(fresh.workspace.id, activated.workspaceId); assert.notEqual(fresh.workspace.id, historical.workspace.id);
    assert.equal(fresh.members.length, 1); assert.equal(fresh.members[0].id, activated.ownerContext.memberId);
    assert.notEqual(fresh.members[0].id, historical.members.find(member => member.role === 'owner')?.id);
    assert.deepEqual(fresh.policy, {send: 'nothing', autonomy: false, allowedSources: ['demo-export'], retentionDays: 90, sharing: false});
    for (const name of ['ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones']) assert.deepEqual(fresh[name], historical[name]);
    assert.deepEqual(fresh.sourceRules, []);
    for (const name of ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts', 'activity',
      'conversations', 'routes', 'sessions', 'unsupported', 'schedules']) assert.deepEqual(fresh[name], [], `${name} is historical, not fresh authority.`);
  }
  const receiptMetadata = receipts => receipts.map(receipt => ({id: receipt.id, operation: receipt.operation,
    totalMinor: receipt.totalMinor, memberId: receipt.memberId, epoch: receipt.epoch}));
  try {
    const version = (await nativePool('source').query('SELECT version() AS version, current_database() AS database')).rows[0];
    assert.match(version.version, /^PostgreSQL 18\.6(?:[,\s(]|$)/);
    const source = await http(profile.sourceEngine);
    if (message.phase === 'primary-after-reopen') {
      const checkpoint = message.checkpoint;
      assert.ok(checkpoint && checkpoint.activated && checkpoint.sourceHistoryDigest && checkpoint.firstReceipts.length === 3);
      await source.rpc('workspace.open', {passphrase: message.credentials.source});
      await profile.enableCapabilities({historicalState: source.engine.vault.read(), policy: checkpoint.policy, reopen: true});
      await source.rpc('workspace.lock'); await source.rpc('workspace.open', {passphrase: message.credentials.source});
      await witness(source.engine);
      assert.equal(stateDigest(source.engine.vault.read()), checkpoint.sourceHistoryDigest);
      const candidateText = await artifact(profile.journalVault, 'wac', checkpoint.ids.candidateId, 'archive');
      assert.equal(sha(candidateText), checkpoint.candidateDigest);
      const historical = interchange.readHistoricalWorkspaceState(JSON.parse(candidateText).archive);
      assert.equal(stateDigest(historical), checkpoint.sourceHistoryDigest);
      assert.deepEqual(refFence(await profile.captureSourceCustody(captureBudgets)), checkpoint.sourceArtifactFence);
      const resolved = await source.rpc('workspace.activation.get', {activationId: checkpoint.ids.activationId});
      const immutable = value => {const {ciphertextBytes, ...rest} = value; return rest;};
      assert.deepEqual(immutable(resolved), immutable(checkpoint.activated)); assert.ok(resolved.ciphertextBytes > 0);
      await source.refuse('workspace.activation.execute', checkpoint.execute,
        ['ACTIVATION_SINGLE_USE', 'INTERCHANGE_TARGET_CHANGED', 'ACTIVATION_TARGET_NOT_EMPTY', 'INTERCHANGE_TARGET_NOT_EMPTY']);
      mark('fresh-process-source-journal-reopen-single-use');
      const target = await http(await source.engine.activatedWorkspaceEngine(profile.currentSourceContext(), checkpoint.ids.activationId));
      await target.rpc('workspace.open', {passphrase: message.credentials.target});
      await target.refuse('workspace.status', {}, ['UNAUTHENTICATED'], source.token);
      await target.refuse('workspace.status', {}, ['UNAUTHENTICATED'], checkpoint.firstToken);
      for (const receipt of checkpoint.firstReceipts) assert.deepEqual(await target.rpc('receipts.get', {id: receipt.id}), receipt);
      const previous = new Set([...checkpoint.baseline, ...checkpoint.firstReceipts].map(receipt => receipt.id));
      const receipts = await freshReceipts(target, checkpoint, previous);
      assert.equal(new Set([...checkpoint.firstReceipts, ...receipts].map(receipt => receipt.id)).size, 6);
      assert.equal(target.engine.vault.read().jobs.length, 0); assert.equal(target.engine.vault.read().modelReceipts.length, 0);
      await close(target); mark('three-new-question-receipts-after-process-reopen');
      assert.equal(stateDigest(source.engine.vault.read()), checkpoint.sourceHistoryDigest);
      assert.equal(sha(await artifact(profile.journalVault, 'wac', checkpoint.ids.candidateId, 'archive')), checkpoint.candidateDigest);
      mark('source-history-and-authenticated-candidate-unchanged-after-reopen');
      await assertNoProviders();
      return {passed: true, workerPid: process.pid, cases, nativeVersion, receipts: receiptMetadata(receipts), nativeObservations: observations};
    }
    const isolated = message.phase === 'isolated-prepared-open', prefix = isolated ? 'prepared' : 'primary';
    const ids = Object.fromEntries(['materialId', 'backupId', 'inertTargetId', 'targetId', 'candidateId', 'activationId']
      .map(name => [name, `synthetic_${prefix}_${name}`]));
    await source.rpc('workspace.create', {name: `Synthetic native transfer ${prefix}`, passphrase: message.credentials.source, pack: 'retail', demo: false});
    await source.rpc('sources.import', {sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: demoRecipe,
      expectedTotals: {rowCount: 10, amountMinor: '1230000'}});
    const asOf = new Date(Math.max(...source.engine.vault.read().facts.map(fact => Date.parse(fact.learnedAt))) + 1).toISOString();
    const requests = operations.map(operation => ({operation, sourceIds: ['demo-export'], period: {from: '2026-09-01', to: '2026-09-30'}, asOf}));
    const baseline = [];
    for (let index = 0; index < requests.length; index++) {
      const {operation, ...filters} = requests[index];
      const answer = await source.rpc('conversation.ask', {question: questions[index], ...filters});
      assert.equal(answer.supported, true); assert.equal(answer.receipt.operation, operation);
      assert.equal(answer.receipt.totalMinor, totals[index]); baseline.push(answer.receipt);
    }
    // The wrapper supplies bounded public RPC seed payloads, NEVER a State writer.
    const steps = await profile.seedPublicHistory({baseline, requests});
    if (!Array.isArray(steps) || steps.length < 2 || steps.length > 8) fail('BOUNDED_PUBLIC_HISTORY_STEPS_REQUIRED');
    for (const step of steps) {
      assert.ok(['decisions.create', 'jobs.create', 'jobs.pause', 'jobs.cancel'].includes(step.method));
      if (step.method === 'jobs.create') assert.equal(step.payload.type, 'owner-brief');
      await source.rpc(step.method, step.payload);
    }
    for (const name of ['facts', 'imports', 'receipts', 'answers', 'decisions', 'jobs']) assert.ok(source.engine.vault.read()[name].length > 0, name);
    const policy = {approvedSyntheticWorkspaceIds: [source.engine.vault.read().workspace.id], allowedSyntheticSourceIds: ['demo-export'], retentionDays: 90,
      budgets: {maxCandidateBytes: 16_000_000, maxArtifactBytes: 12_000_000, maxArtifacts: 100, maxFacts: 100, maxRecords: 1000}};
    await profile.enableCapabilities({historicalState: source.engine.vault.read(), policy, reopen: false});
    await source.rpc('workspace.lock'); await source.rpc('workspace.open', {passphrase: message.credentials.source});
    await witness(source.engine); mark('actual-native-source-public-import-questions-and-nonempty-history');
    const material = await source.rpc('workspace.interchange.export', {destinationId: ids.materialId, confirmed: true});
    const historical = source.engine.vault.read();
    const original = await profile.captureSourceCustody(captureBudgets);
    assert.equal(original.storageKind, 'postgres'); assert.equal(original.authorityKind, 'adapter-issued-envelope');
    assert.deepEqual(original.state, historical);
    assert.deepEqual(await profile.authenticateSourceCustody(original, captureBudgets), historical);
    await witness(source.engine);
    for (const part of ['archive', 'pin', 'commit']) assert.ok(original.artifacts.some(item => item.ref.id === artifactId('wic', ids.materialId, part)));
    const made = await source.rpc('workspace.backup.v2.create', {destinationId: ids.backupId, confirmed: true});
    const reviewedBackup = await source.rpc('workspace.backup.v2.read', {backupId: ids.backupId});
    assert.equal(reviewedBackup.sourcePin.fullWorkspacePortable, false);
    const backupText = await artifact(source.engine.vault, 'wb2', ids.backupId, 'archive');
    const retained = v2.workspaceBackupV2Bytes(v2.validateWorkspaceBackupV2(backupText, reviewedBackup.sourcePin, budgets), budgets);
    exactCapture(original, retained);
    const inert = await source.rpc('workspace.backup.v2.restoreInert', {backupId: ids.backupId, targetId: ids.inertTargetId,
      reviewedDigest: made.archiveDigest, confirmed: true});
    const reservation = await source.rpc('workspace.activation.target.create', {targetId: ids.targetId, confirmed: true});
    assert.equal(reservation.authorityRecords, 0); assert.ok(reservation.stores.every(store => store.records === 0));
    const selection = {...ids, inertCreationId: inert.creationId, reviewedArchiveDigest: made.archiveDigest, confirmed: true};
    delete selection.activationId;
    await source.refuse('workspace.backup.activation.prepare', {...selection, reviewedArchiveDigest: '0'.repeat(64)}, ['INTERCHANGE_REVIEW_CHANGED']);
    const bridge = await source.rpc('workspace.backup.activation.prepare', selection);
    assert.equal(bridge.fullWorkspacePortable, false); assert.equal(bridge.scope, 'authority-and-all-typed-private-artifacts');
    assert.deepEqual(await source.rpc('workspace.backup.activation.inspect', {candidateId: ids.candidateId}), bridge);
    const candidateText = await artifact(profile.journalVault, 'wac', ids.candidateId, 'archive'), candidate = JSON.parse(candidateText);
    assert.deepEqual(interchange.readHistoricalWorkspaceState(candidate.archive), historical);
    const saved = candidate.archive.artifacts.find(item => item.manifest.id === 'backup_activation_provenance_v1');
    assert.ok(saved);
    const provenance = JSON.parse(Buffer.from(interchange.retainedArtifactBytes(saved)).toString('utf8'));
    assert.equal(provenance.backup.content, backupText); assert.equal(provenance.inert.content, backupText);
    exactCapture(original, v2.workspaceBackupV2Bytes(v2.validateWorkspaceBackupV2(provenance.backup.content, provenance.backup.pin.sourcePin, budgets), budgets));
    mark('export-before-capture-v2-ciphertexts-all-state-private-artifacts-and-inert-provenance');
    const request = {candidateId: ids.candidateId, reviewedDigest: bridge.reviewedDigest};
    await source.refuse('workspace.activation.review', {...request, reviewedDigest: '0'.repeat(64)}, ['INTERCHANGE_REVIEW_CHANGED']);
    await source.refuse('workspace.activation.review', {...request, policy}, ['INVALID_ACTIVATION_REQUEST']);
    const review = await source.rpc('workspace.activation.review', request);
    const execute = {...request, projectionDigest: review.projectionDigest, activationId: ids.activationId, confirmed: true};
    await source.refuse('workspace.activation.execute', {...execute, confirmed: false}, ['CONFIRMATION_REQUIRED']);
    await source.refuse('workspace.activation.execute', {...execute, projectionDigest: '0'.repeat(64)}, ['ACTIVATION_PROJECTION_CHANGED']);
    mark('review-and-exact-confirmation-projection-refusals');
    if (isolated) {
      let observed = 0;
      // The reviewed wrapper must pause REAL publication after durable prepare.
      // observer data cannot be fabricated; its native target row is probed below.
      await profile.withPreparedStage({execute, dispatch: () => source.rpc('workspace.activation.execute', execute)}, async stage => {
        observed++; assert.equal(stage.phase, 'prepared'); assert.equal(stage.persisted, true);
        assert.equal(stage.activationId, ids.activationId); assert.equal(stage.targetId, ids.targetId);
        assert.equal(stage.projectionDigest, review.projectionDigest); assert.ok(stage.stageBindingDigest?.match(/^[0-9a-f]{64}$/));
        const publication = stage.finalSlotPublicationWitness;
        assert.ok(publication && publication.authenticated === true && publication.durable === true,
          'A staged authority row alone is not a durable final-slot publication binding.');
        assert.equal(publication.phase, 'prepared'); assert.equal(publication.activationId, ids.activationId);
        assert.equal(publication.targetId, ids.targetId); assert.equal(publication.projectionDigest, review.projectionDigest);
        assert.equal(publication.stageBindingDigest, stage.stageBindingDigest);
        assert.ok(typeof publication.finalLiveSlot === 'string' && publication.finalLiveSlot.length > 0);
        assert.ok(stage.normalTargetEngine instanceof Engine); assert.equal(stage.normalTargetEngine.options.workspaceStorageAdmission, undefined);
        assert.equal(stage.normalTargetEngine.options.postgresWorkspace, undefined, 'Prove ordinary admission without the transfer profile.');
        assert.ok(stage.preparedWitness, 'Observe actual unpublished custody at the reserved FINAL live slot.');
        const prepared = stage.preparedWitness;
        assert.equal(prepared.databaseRole, 'target'); assert.equal(prepared.slot, publication.finalLiveSlot);
        const targetPool = nativePool('target');
        const row = (await targetPool.query('SELECT * FROM public.chausar_workspace_postgres_custody WHERE slot=$1', [prepared.slot])).rows[0];
        assert.ok(row); assert.equal(row.phase, 'prepared'); assert.equal(row.operation_id, prepared.operationId);
        assert.equal(row.creation_id, prepared.creationId); assert.equal(row.storage_id, prepared.storageId);
        assert.equal(row.vault_id, prepared.vaultId); assert.equal(String(row.revision), '0');
        assert.equal(row.envelope_digest, prepared.envelopeDigest);
        assert.equal(postgres.postgresEnvelopeDigest(row.envelope), prepared.envelopeDigest);
        assert.equal((await targetPool.query('SELECT slot FROM public.chausar_vault_authority WHERE slot=$1', [prepared.slot])).rows.length, 0,
          'Prepared ciphertext remains in custody, not ordinary authority.');
        observations.push({databaseRole: 'target', phase: 'prepared', finalSlotDigest: sha(prepared.slot),
          creationId: prepared.creationId, storageId: prepared.storageId, envelopeDigest: prepared.envelopeDigest});
        const admissionRequests = stage.ordinaryAdmissionRequests;
        assert.ok(Array.isArray(admissionRequests) && admissionRequests.length === 4,
          'Supply valid create/open/recover/restore payloads; incorrect credential fixtures are not admission proof.');
        assert.deepEqual(admissionRequests.map(item => item.method).sort(),
          ['workspace.create', 'workspace.open', 'workspace.recover', 'workspace.restore'].sort());
        const ordinary = await http(stage.normalTargetEngine);
        for (const admission of admissionRequests) {
          assert.match(admission.expectedCode, /^[A-Z][A-Z0-9_]+$/);
          assert.equal(admission.expectedCode, 'POSTGRES_TARGET_NOT_COMMITTED', 'A ordinary adapter implements this exact unpublished-target refusal.');
          assert.ok(!['VAULT_NOT_FOUND', 'WORKSPACE_NOT_FOUND', 'DATABASE_REQUIRED', 'LOCKED', 'BAD_PASSPHRASE',
            'INVALID_PASSPHRASE', 'INVALID_RECOVERY', 'INVALID_BACKUP'].includes(admission.expectedCode),
            'Use the exact implemented publication-admission refusal, never absence or invalid input.');
          await ordinary.refuse(admission.method, admission.payload, [admission.expectedCode]);
          assert.ok(ordinary.engine.vault == null);
        }
        await close(ordinary);
      });
      assert.equal(observed, 1); mark('durably-prepared-native-target-refuses-ordinary-create-open-recover-restore');
      await assertNoProviders();
      return {passed: true, workerPid: process.pid, cases, nativeVersion, nativeObservations: observations};
    }
    const activated = await source.rpc('workspace.activation.execute', execute);
    assert.equal(activated.status, 'committed'); assert.ok(activated.ciphertextBytes > 0);
    assert.equal(activated.workspaceId, review.workspaceId); assert.notEqual(activated.ownerContext.memberId, 'owner');
    assert.deepEqual(await source.rpc('workspace.activation.get', {activationId: ids.activationId}), activated);
    assert.deepEqual(source.engine.vault.read(), historical);
    mark('native-single-use-activation-committed-with-source-history-preserved');
    const target = await http(await source.engine.activatedWorkspaceEngine(profile.currentSourceContext(), ids.activationId));
    nativeEngine(target.engine);
    await target.rpc('workspace.open', {passphrase: message.credentials.target});
    await target.refuse('workspace.status', {}, ['UNAUTHENTICATED'], source.token);
    assertFreshProjection(target.engine.vault.read(), historical, activated);
    assert.notEqual(target.engine.vault.vaultId, original.vaultId);
    for (const name of ['gateway', 'sync', 'durableJobs', 'connectorCredentials', 'connectorRuntime', 'workspaceActivation']) assert.equal(target.engine.options[name], undefined);
    mark('fresh-native-owner-and-inert-historical-authority');
    const checkpoint = {ids, policy, execute, activated, requests, baseline, firstReceipts: [], firstToken: target.token,
      candidateDigest: sha(candidateText), sourceHistoryDigest: stateDigest(historical), sourceArtifactFence: null};
    const receipts = await freshReceipts(target, checkpoint, new Set(baseline.map(receipt => receipt.id)));
    checkpoint.firstReceipts = receipts;
    await close(target); mark('three-new-public-target-question-calculation-receipts');
    await source.refuse('workspace.activation.execute', execute,
      ['ACTIVATION_SINGLE_USE', 'INTERCHANGE_TARGET_CHANGED', 'ACTIVATION_TARGET_NOT_EMPTY', 'INTERCHANGE_TARGET_NOT_EMPTY']);
    assert.equal(stateDigest(source.engine.vault.read()), checkpoint.sourceHistoryDigest);
    // Backup administrative artifacts are not part of the original business-state
    // capture. Fence the ACTUAL complete current custody for process reopen.
    checkpoint.sourceArtifactFence = refFence(await profile.captureSourceCustody(captureBudgets));
    await assertNoProviders();
    return {passed: true, workerPid: process.pid, cases, checkpoint, nativeVersion, receipts: receiptMetadata(receipts),
      sourceHistory: {sha256: checkpoint.sourceHistoryDigest, collectionCounts: counts(historical), comparison: 'all State fields'},
      sourceArtifacts: {originalAuthoritySha256: sha(Buffer.from(original.authority)), originalPrivateArtifacts: refFence(original),
        currentPrivateArtifacts: checkpoint.sourceArtifactFence, comparison: 'exact refs and ciphertext bytes'}, nativeObservations: observations};
  } finally {
    abort.abort();
    const closed = await Promise.allSettled([...apps].map(app => app.app.close()));
    const rest = await Promise.allSettled([Promise.resolve().then(() => profile.close()), ...[...probePools.values()].map(pool => pool.end())]);
    if ([...closed, ...rest].some(result => result.status === 'rejected')) fail('OWNED_WORKER_CLEANUP_FAILED');
  }
}

process.once('message', async message => {
  try {
    const result = await execute(message);
    // Checkpoints and synthetic bearer stay IPC-only; the supervisor writes only
    // digests/counts/receipt metadata. No credentials or ciphertexts are logged.
    process.send?.({type: 'result', result}, () => {process.disconnect?.();});
  } catch (error) {
    const failureCode = typeof error?.code === 'string' && /^[A-Z0-9_.-]+$/.test(error.code) ? error.code : 'NATIVE_ACCEPTANCE_ASSERTION_FAILED';
    const frame = typeof error.stack === 'string' ? error.stack.split('\n').map(line =>
      /\/(platform\/(?:runtime|tests)\/[A-Za-z0-9_./-]+\.(?:ts|mjs)):(\d+):(\d+)/.exec(line)).find(Boolean) : undefined;
    const failureLocation = frame ? frame[1] + ':' + frame[2] + ':' + frame[3] : undefined;
    process.exitCode = 1; process.send?.({type: 'result', result: {passed: false, failureCode, failureLocation, cases: completedCases}}, () => {process.disconnect?.();});
  }
});
