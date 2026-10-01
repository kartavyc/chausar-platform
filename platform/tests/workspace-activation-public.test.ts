import assert from 'node:assert/strict';
import test, {type TestContext} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {Engine, type EngineOptions} from '../runtime/engine.ts';
import {createLocalServer} from '../runtime/server.ts';
import {Vault, type VaultEnvelope, type VaultEncryptedCustodyCapture} from '../runtime/vault.ts';
import {demoCsv, demoRecipe} from '../runtime/ingest.ts';
import {hash} from '../runtime/contracts.ts';
import type {CalculationReceipt, CalculationRequest} from '../runtime/calculator.ts';
import type {WorkspaceActivationPolicy, WorkspaceActivationSummary} from '../runtime/workspace-activation.ts';
import type {WorkspaceBackupActivationReview, WorkspaceBackupActivationProvenance} from '../runtime/workspace-backup-activation.ts';
import {validateWorkspaceBackupV2, workspaceBackupV2Bytes, type WorkspaceBackupV2Budgets} from '../runtime/workspace-backup-v2.ts';
import {compareRecalculatedReceipt, readHistoricalWorkspaceState, retainedArtifactBytes} from '../runtime/workspace-interchange.ts';
import type {WorkspaceImportCandidate} from '../runtime/workspace-interchange-contracts.ts';

// Actual loopback HTTP, real source/journal/target experimental-file Vaults and
// actual local activation publication. All data and credentials are synthetic.
// No provider/inference, automatic job dispatch, native SQL, GUI or user vault.
const sourcePassphrase = 'Synthetic public source credential only';
const journalPassphrase = 'Synthetic separate journal credential only';
const targetPassphrase = 'Synthetic fresh target credential only';
const historicalSecret = 'Synthetic inert private runtime 731590';
const historicalToken = 'synthetic historical session token 648721';
const sourceId = 'demo-export';
const materialId = 'public_activation_material';
const backupId = 'public_activation_backup';
const inertTargetId = 'public_activation_inert';
const targetId = 'public_activation_target';
const candidateId = 'public_activation_candidate';
const activationId = 'public_activation_once';
const budgets: WorkspaceBackupV2Budgets = {maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 4_000_000,
  maxTotalEntryBytes: 6_000_000, maxEntries: 100, maxJsonDepth: 128, maxJsonNodes: 100_000};
const captureBudgets = {maxArtifacts: 100, maxEntryBytes: 4_000_000, maxTotalEntryBytes: 6_000_000};
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const artifactId = (prefix: string, id: string, part: string) => `${prefix}_${sha(id)}_${part}`;
const inertStores = ['receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'plugins', 'modelReceipts',
  'activity', 'conversations', 'routes', 'sessions', 'unsupported', 'schedules'] as const;

function metadata(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of [sourcePassphrase, journalPassphrase, targetPassphrase, historicalSecret, historicalToken]) {
    assert.equal(text.includes(secret), false, 'Public metadata must not disclose a retained secret.');
  }
  for (const key of ['content', 'evidence', 'authorityBase64', 'dataBase64', 'ciphertext', 'passphrase',
    'recoveryCode', 'recoveryKit', 'tokenHash', 'directory']) {
    assert.equal(text.includes(`"${key}"`), false, `Public metadata must omit ${key}.`);
  }
}

async function http(engine: Engine) {
  const app = createLocalServer(engine), {origin, token} = await app.listen();
  const raw = async (method: string, payload: unknown = {}, credential = token) => {
    const response = await fetch(`${origin}/api/rpc`, {method: 'POST',
      headers: {'content-type': 'application/json', authorization: `Bearer ${credential}`},
      body: JSON.stringify({method, payload})});
    return {status: response.status, body: await response.json() as any};
  };
  const rpc = async <T = any>(method: string, payload: unknown = {}): Promise<T> => {
    const response = await raw(method, payload);
    assert.equal(response.status, 200, `${method}: ${response.body.error?.code ?? 'RPC failed'} ${response.body.error?.message ?? ''}`);
    return response.body.result as T;
  };
  const refuse = async (method: string, payload: unknown, codes: string[]) => {
    const response = await raw(method, payload);
    assert.notEqual(response.status, 200, `${method} must refuse.`);
    assert.ok(codes.includes(response.body.error?.code), `${method}: ${response.body.error?.code}`);
    metadata(response.body);
  };
  return {app, engine, origin, token, raw, rpc, refuse};
}
type Http = Awaited<ReturnType<typeof http>>;

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Validate synthetic C-drive scratch before writes.');
  const directory = await realpath(await mkdtemp(join(base, 'chausar-activation-public-')));
  assert.equal(dirname(directory), base);
  const apps = new Set<Http>();
  let journal: Vault | undefined;
  let providerCalls = 0;
  const sourceOptions: EngineOptions = {directory, demo: true, storage: 'experimental-file',
    backupCustody: {budgets, filesystemBudgets: {maxFiles: 100, maxBytes: 8_000_000, maxDepth: 16}},
    gateway: {http: async () => {providerCalls++; throw Error('Synthetic fixture forbids a provider request.');}}};
  let source = await http(new Engine(sourceOptions)); apps.add(source);
  t.after(async () => {
    for (const app of apps) await app.app.close();
    await journal?.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-activation-public-'));
    await rm(actual, {recursive: true, force: true});
    assert.equal(providerCalls, 0);
  });
  await source.rpc('workspace.create', {name: 'Synthetic public activation shop', passphrase: sourcePassphrase,
    pack: 'retail', demo: false});
  await source.rpc('sources.import', {sourceId, format: 'csv', content: demoCsv, recipe: demoRecipe,
    expectedTotals: {rowCount: 10, amountMinor: '1230000'}});
  const knowledgeCut = new Date(Math.max(...source.engine.vault!.read().facts.map(fact => Date.parse(fact.learnedAt))) + 1).toISOString();
  const requests: CalculationRequest[] = ['billed', 'received', 'earned'].map(operation => ({operation,
    sourceIds: [sourceId], period: {from: '2026-09-01', to: '2026-09-30'}, asOf: knowledgeCut}));
  const baseline: CalculationReceipt[] = [];
  for (const request of requests) baseline.push(await source.rpc<CalculationReceipt>('calculation.run', request));
  assert.deepEqual(baseline.map(receipt => receipt.totalMinor), ['300000', '260000', '250000']);
  await source.engine.vault!.update(state => {
    state.policy.send = 'shape'; state.policy.autonomy = true; state.policy.sharing = true;
    for (const name of ['answers', 'decisions', 'actions', 'jobs', 'learning', 'modelReceipts',
      'conversations', 'routes', 'schedules', 'unsupported'] as const) {
      state[name].push({id: `synthetic_historical_${name}`, status: 'queued', secret: historicalSecret});
    }
    state.sessions.push({id: 'synthetic_historical_session', tokenHash: hash(historicalToken), memberId: 'owner',
      epoch: 1, secret: historicalSecret});
    const moduleBase64 = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]).toString('base64');
    state.plugins.push({id: 'synthetic_historical_plugin', moduleBase64, moduleDigest: hash(JSON.stringify(moduleBase64)),
      enabled: false, secret: historicalSecret});
  });
  await source.engine.vault!.writeArtifact({id: 'synthetic_historical_trial-binding', purpose: 'private-trial',
    value: {version: 1, type: 'private-trial-issued-binding-v1', trialId: 'synthetic_historical_trial',
      workspaceId: source.engine.vault!.read().workspace.id, memberId: 'owner', status: 'discarded',
      fork: null, evaluation: null, secret: historicalSecret}, expectedDigest: null});
  const discarded = await source.rpc('workspace.interchange.export', {destinationId: 'synthetic_discarded_history', confirmed: true});
  await source.rpc('workspace.interchange.discard', {recordId: 'synthetic_discarded_history', reviewedDigest: discarded.packageDigest});
  const historical = source.engine.vault!.read();
  // The independently committed export MUST precede the v2 encrypted capture.
  const material = await source.rpc('workspace.interchange.export', {destinationId: materialId, confirmed: true});
  metadata(material);
  const original = await source.engine.vault!.snapshot(() => source.engine.vault!.captureEncryptedCustody(captureBudgets));
  const made = await source.rpc('workspace.backup.v2.create', {destinationId: backupId, confirmed: true});
  metadata(made);
  const reviewedBackup = await source.rpc('workspace.backup.v2.read', {backupId}); metadata(reviewedBackup);
  const inert = await source.rpc('workspace.backup.v2.restoreInert', {backupId, targetId: inertTargetId,
    reviewedDigest: made.archiveDigest, confirmed: true}); metadata(inert);
  const container = JSON.parse(await readFile(join(directory, inertTargetId, 'backup.inert.json'), 'utf8'));
  assert.deepEqual(await readdir(join(directory, inertTargetId)), ['backup.inert.json']);
  const archiveRead = await source.engine.vault!.readArtifact({id: artifactId('wb2', backupId, 'archive'), purpose: 'workspace-interchange'});
  const archiveText = (archiveRead.value as {content: string}).content;
  assert.equal(container.content, archiveText);
  const archiveBytes = workspaceBackupV2Bytes(validateWorkspaceBackupV2(archiveText, reviewedBackup.sourcePin, budgets), budgets);
  assertOriginalCiphertexts(original, archiveBytes);
  for (const part of ['archive', 'pin', 'commit']) assert.ok(original.artifacts.some(item =>
    item.ref.id === artifactId('wic', materialId, part) && item.ref.purpose === 'workspace-interchange'));
  const policy: WorkspaceActivationPolicy = {approvedSyntheticWorkspaceIds: [historical.workspace.id],
    allowedSyntheticSourceIds: [sourceId], retentionDays: 90,
    budgets: {maxCandidateBytes: 16_000_000, maxArtifactBytes: 12_000_000, maxArtifacts: 100, maxFacts: 100, maxRecords: 1000}};
  const selection = {backupId, materialId, inertTargetId, inertCreationId: inert.creationId, candidateId,
    targetId, reviewedArchiveDigest: made.archiveDigest, confirmed: true};
  const openJournal = async () => {
    journal = await Vault.open({directory: join(directory, 'journal'), passphrase: journalPassphrase, storage: 'experimental-file'});
  };
  const install = (inputPolicy = policy) => {
    source.engine.options.workspaceActivation = {journalVault: journal!, policy: inputPolicy,
      targetPassphrase: async authority => {
        assert.notEqual(authority.workspaceId, historical.workspace.id);
        assert.notEqual(authority.owner.id, 'owner');
        return targetPassphrase;
      }};
  };
  const reattach = async () => {await source.rpc('workspace.lock'); await source.rpc('workspace.open', {passphrase: sourcePassphrase});};
  return {directory, historical, original, archiveText, archiveBytes, reviewedBackup, baseline, requests, policy, selection,
    get source() {return source;}, get journal() {return journal!;}, install, reattach,
    async enable() {
      journal = (await Vault.create({directory: join(directory, 'journal'), name: 'Synthetic separate activation journal',
        passphrase: journalPassphrase, storage: 'experimental-file', demo: true})).vault;
      install(); await reattach();
    },
    async target() {
      const engine = await source.engine.activatedWorkspaceEngine(source.engine.bootstrapContext(), activationId);
      for (const option of ['gateway', 'sync', 'durableJobs', 'connectorCredentials', 'connectorRuntime', 'workspaceActivation'] as const) {
        assert.equal(engine.options[option], undefined, `Fresh target must not inherit ${option}.`);
      }
      const result = await http(engine); apps.add(result); return result;
    },
    async close(app: Http) {await app.app.close(); apps.delete(app);},
    async restart() {
      await source.app.close(); apps.delete(source); await journal!.close();
      await openJournal();
      source = await http(new Engine(sourceOptions)); apps.add(source);
      install(); await source.rpc('workspace.open', {passphrase: sourcePassphrase});
    },
  };
}

function assertOriginalCiphertexts(original: VaultEncryptedCustodyCapture,
  retained: ReturnType<typeof workspaceBackupV2Bytes>) {
  assert.deepEqual(Buffer.from(retained.authority), Buffer.from(original.authority));
  assert.equal(retained.artifacts.length, original.artifacts.length);
  for (const item of original.artifacts) {
    const saved = retained.artifacts.find(entry => entry.ref.id === item.ref.id && entry.ref.purpose === item.ref.purpose);
    assert.ok(saved); assert.deepEqual(saved.ref, item.ref);
    assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(item.bytes));
  }
}

async function retainedCandidate(journal: Vault) {
  const retained = await journal.readArtifact({id: artifactId('wac', candidateId, 'archive'), purpose: 'workspace-interchange'});
  return (retained.value as {content: string}).content;
}

async function assertCurrentMeasurement(directory: string, actual: WorkspaceActivationSummary,
  initial: WorkspaceActivationSummary) {
  metadata(actual);
  const {ciphertextBytes: currentBytes, ...currentBinding} = actual;
  const {ciphertextBytes: initialBytes, ...initialBinding} = initial;
  assert.deepEqual(currentBinding, initialBinding, 'Every immutable activation summary field must survive live revisions.');
  const files = ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json',
    join('live', 'main', 'authority.encrypted.json')];
  const ciphertexts = await Promise.all(files.map(file => readFile(join(directory, targetId, file))));
  assert.equal(currentBytes, ciphertexts.reduce((total, bytes) => total + bytes.length, 0),
    'Readback must report the actual current immutable evidence and live authority ciphertext bytes.');
  assert.ok(currentBytes > 0);
  assert.ok(currentBytes > initialBytes, 'New retained receipts and answers must increase measured live ciphertext.');
}

async function freshReceipts(target: Http, baseline: CalculationReceipt[], requests: CalculationRequest[],
  owner: WorkspaceActivationSummary['ownerContext'], previousIds: Set<string>) {
  const result: CalculationReceipt[] = [];
  for (let index = 0; index < requests.length; index++) {
    const {operation, ...filters} = requests[index];
    const answer = await target.rpc<{supported: boolean; receipt: CalculationReceipt}>('conversation.ask', {
      question: ['What was billed?', 'What was received?', 'What was earned?'][index], ...filters});
    assert.equal(answer.supported, true);
    const receipt = answer.receipt;
    assert.equal(receipt.operation, operation);
    assert.equal(receipt.totalMinor, ['300000', '260000', '250000'][index]);
    assert.equal(receipt.memberId, owner.memberId); assert.equal(receipt.epoch, owner.epoch);
    assert.equal(previousIds.has(receipt.id), false); previousIds.add(receipt.id);
    const changed = compareRecalculatedReceipt(baseline[index], receipt).changedFields;
    assert.deepEqual(changed, ['memberId'], 'Only independently allocated owner authority changes the receipt semantics.');
    const reauthorized = {...baseline[index], memberId: owner.memberId, epoch: owner.epoch};
    assert.equal(compareRecalculatedReceipt(reauthorized, receipt).equivalent, true);
    assert.deepEqual(await target.rpc('receipts.get', {id: receipt.id}), receipt);
    result.push(receipt);
  }
  return result;
}

test('actual public inert archive activates a fresh Vault/Engine and produces three new receipts before and after restart',
  {timeout: 180_000}, async t => {
    const f = await fixture(t);
    await t.test('trusted root capability and bounded explicit public payloads are required', async () => {
      await f.source.refuse('workspace.activation.target.create', {targetId, confirmed: true}, ['ACTIVATION_ROOT_REQUIRED']);
      await f.enable();
      await f.source.refuse('workspace.activation.target.create', {targetId, confirmed: false}, ['CONFIRMATION_REQUIRED']);
      await f.source.refuse('workspace.activation.target.create', {targetId, confirmed: true, directory: '../unreviewed'}, ['INVALID_ACTIVATION_REQUEST']);
      assert.deepEqual(await readdir(f.journal.directory), ['authority.encrypted.json', 'writer.lock']);
    });
    const targetReservation = await f.source.rpc('workspace.activation.target.create', {targetId, confirmed: true});
    metadata(targetReservation);
    assert.equal(targetReservation.authorityRecords, 0);
    assert.ok(targetReservation.stores.every((store: {records: number}) => store.records === 0));
    assert.deepEqual(await f.source.rpc('workspace.activation.target.get', {targetId}), targetReservation);
    await f.source.refuse('workspace.backup.activation.prepare', {...f.selection, reviewedArchiveDigest: '0'.repeat(64)}, ['INTERCHANGE_REVIEW_CHANGED']);
    const bridge = await f.source.rpc<WorkspaceBackupActivationReview>('workspace.backup.activation.prepare', f.selection);
    metadata(bridge);
    assert.equal(bridge.scope, 'authority-and-all-typed-private-artifacts'); assert.equal(bridge.fullWorkspacePortable, false);
    assert.deepEqual(bridge.namespaces, f.reviewedBackup.sourcePin.namespaces);
    assert.deepEqual(bridge.externalKeyRequirements, f.reviewedBackup.sourcePin.externalKeyRequirements);
    assert.equal(bridge.measurement.qualification, 'encrypted-local-host');
    assert.ok(bridge.measurement.archiveCiphertextBytes > 0 && bridge.measurement.inventoryPinCiphertextBytes > 0);
    const inspected = await f.source.rpc('workspace.backup.activation.inspect', {candidateId});
    assert.deepEqual(inspected, bridge); metadata(inspected);
    const candidateText = await retainedCandidate(f.journal), candidate = JSON.parse(candidateText) as WorkspaceImportCandidate;
    const history = readHistoricalWorkspaceState(candidate.archive);
    assert.deepEqual(history, f.historical);
    const retainedProvenance = candidate.archive.artifacts.find(item => item.manifest.id === 'backup_activation_provenance_v1');
    assert.ok(retainedProvenance);
    const provenance = JSON.parse(Buffer.from(retainedArtifactBytes(retainedProvenance)).toString('utf8')) as WorkspaceBackupActivationProvenance;
    assert.equal(provenance.backup.content, f.archiveText);
    assert.equal(provenance.inert.content, f.archiveText);
    assert.deepEqual(provenance.backup.pin.sourcePin, f.reviewedBackup.sourcePin);
    assertOriginalCiphertexts(f.original, workspaceBackupV2Bytes(validateWorkspaceBackupV2(provenance.backup.content,
      provenance.backup.pin.sourcePin, budgets), budgets));
    for (const name of inertStores) assert.deepEqual(history[name], f.historical[name]);
    const request = {candidateId, reviewedDigest: bridge.reviewedDigest};
    await t.test('explicit synthetic source scope and exact projection review refuse without publication', async () => {
      f.install({...f.policy, allowedSyntheticSourceIds: ['synthetic_unapproved_source']}); await f.reattach();
      await f.source.refuse('workspace.activation.review', request, ['ACTIVATION_SOURCE_PROFILE']);
      assert.deepEqual(await readdir(join(f.directory, targetId)), []);
      f.install(); await f.reattach();
      await f.source.refuse('workspace.activation.review', {...request, reviewedDigest: '0'.repeat(64)}, ['INTERCHANGE_REVIEW_CHANGED']);
      await f.source.refuse('workspace.activation.review', {...request, policy: f.policy}, ['INVALID_ACTIVATION_REQUEST']);
      assert.equal(await retainedCandidate(f.journal), candidateText);
    });
    const review = await f.source.rpc('workspace.activation.review', request); metadata(review);
    assert.equal(review.facts, 10); assert.notEqual(review.workspaceId, f.historical.workspace.id);
    const execute = {...request, projectionDigest: review.projectionDigest, activationId, confirmed: true};
    await f.source.refuse('workspace.activation.execute', {...execute, confirmed: false}, ['CONFIRMATION_REQUIRED']);
    await f.source.refuse('workspace.activation.execute', {...execute, projectionDigest: '0'.repeat(64)}, ['ACTIVATION_PROJECTION_CHANGED']);
    assert.deepEqual(await readdir(join(f.directory, targetId)), []);
    const activated = await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.execute', execute); metadata(activated);
    assert.equal(activated.status, 'committed'); assert.equal(activated.qualification, 'encrypted-local-host');
    assert.ok(activated.ciphertextBytes > 0); assert.equal(activated.workspaceId, review.workspaceId);
    assert.notEqual(activated.ownerContext.memberId, 'owner');
    assert.deepEqual(await f.source.rpc('workspace.activation.get', {activationId}), activated);
    assert.deepEqual(f.source.engine.vault!.read(), f.historical, 'Activation must preserve the complete source authority.');
    const target = await f.target();
    assert.notEqual(target.token, f.source.token);
    await target.rpc('workspace.open', {passphrase: targetPassphrase});
    const refusedOld = await target.raw('workspace.status', {}, f.source.token);
    assert.equal(refusedOld.status, 401); assert.equal(refusedOld.body.error?.code, 'UNAUTHENTICATED');
    assert.equal(JSON.stringify(refusedOld.body).includes(f.source.token), false); metadata(refusedOld.body);
    const fresh = target.engine.vault!.read();
    assert.equal(fresh.revision, 0); assert.equal(fresh.workspace.id, activated.workspaceId);
    assert.equal(target.engine.bootstrapContext().memberId, activated.ownerContext.memberId);
    assert.equal(fresh.members.length, 1); assert.deepEqual(fresh.members[0].branches, ['*']);
    assert.equal(fresh.members[0].id, activated.ownerContext.memberId);
    assert.notEqual(target.engine.vault!.vaultId, f.original.vaultId);
    assert.deepEqual(fresh.policy, {send: 'nothing', autonomy: false, allowedSources: [sourceId], retentionDays: 90, sharing: false});
    for (const store of ['ontology', 'facts', 'imports', 'conflicts', 'merges', 'tombstones'] as const) {
      assert.deepEqual(fresh[store], f.historical[store]);
    }
    assert.deepEqual(fresh.sourceRules, []);
    for (const store of inertStores) assert.deepEqual(fresh[store], [], `${store} history must remain inert.`);
    assert.deepEqual(await target.engine.vault!.listArtifacts({purpose: 'private-trial'}), []);
    assert.deepEqual(await target.engine.vault!.listArtifacts({purpose: 'workspace-interchange'}), []);
    const oldEnvelope = JSON.parse(Buffer.from(f.original.authority).toString('utf8')) as VaultEnvelope;
    const targetEnvelope = JSON.parse(await readFile(join(target.engine.vault!.directory, 'authority.encrypted.json'), 'utf8')) as VaultEnvelope;
    assert.notEqual(targetEnvelope.id, oldEnvelope.id);
    assert.notDeepEqual(targetEnvelope.passphrase, oldEnvelope.passphrase);
    assert.notDeepEqual(targetEnvelope.recovery, oldEnvelope.recovery);
    const receiptIds = new Set(f.baseline.map(receipt => receipt.id));
    const first = await freshReceipts(target, f.baseline, f.requests, activated.ownerContext, receiptIds);
    assert.equal(target.engine.vault!.read().jobs.length, 0); assert.equal(target.engine.vault!.read().modelReceipts.length, 0);
    // Live Vaults have exclusive writers. Close before source readback or launch inspection.
    const firstToken = target.token; await f.close(target);
    await t.test('single-use activation identity survives source/journal restart and historical sessions stay refused', async () => {
      await f.source.refuse('workspace.activation.execute', execute, ['ACTIVATION_SINGLE_USE', 'INTERCHANGE_TARGET_CHANGED', 'ACTIVATION_TARGET_NOT_EMPTY', 'INTERCHANGE_TARGET_NOT_EMPTY']);
      await f.restart();
      await assertCurrentMeasurement(f.directory, await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.get', {activationId}), activated);
      assert.equal(await retainedCandidate(f.journal), candidateText);
      await f.source.refuse('workspace.activation.execute', execute, ['ACTIVATION_SINGLE_USE', 'INTERCHANGE_TARGET_CHANGED', 'ACTIVATION_TARGET_NOT_EMPTY', 'INTERCHANGE_TARGET_NOT_EMPTY']);
    });
    const restarted = await f.target();
    assert.notEqual(restarted.token, firstToken); assert.notEqual(restarted.token, f.source.token);
    await restarted.rpc('workspace.open', {passphrase: targetPassphrase});
    for (const token of [firstToken, historicalToken]) {
      const refusal = await restarted.raw('workspace.status', {}, token);
      assert.equal(refusal.status, 401); assert.equal(refusal.body.error?.code, 'UNAUTHENTICATED');
      assert.equal(JSON.stringify(refusal.body).includes(token), false); metadata(refusal.body);
    }
    assert.deepEqual(restarted.engine.vault!.read().facts, fresh.facts);
    assert.deepEqual(restarted.engine.vault!.read().imports, fresh.imports);
    for (const receipt of first) assert.deepEqual(await restarted.rpc('receipts.get', {id: receipt.id}), receipt);
    const second = await freshReceipts(restarted, f.baseline, f.requests, activated.ownerContext, receiptIds);
    assert.equal(new Set([...first, ...second].map(receipt => receipt.id)).size, 6);
    const after = restarted.engine.vault!.read();
    assert.equal(after.receipts.length, 6); assert.equal(after.jobs.length, 0); assert.equal(after.modelReceipts.length, 0);
    assert.deepEqual(after.sessions, []); assert.deepEqual(after.routes, []);
    await f.close(restarted);
    await assertCurrentMeasurement(f.directory, await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.get', {activationId}), activated);
    assert.equal(await retainedCandidate(f.journal), candidateText);
  });

test('actual owned export change during bootstrap refuses acknowledgement while retaining the committed activation',
  {timeout: 180_000}, async t => {
    const f = await fixture(t);
    await f.enable();
    const exportsDirectory = join(f.directory, 'exports');
    await mkdir(exportsDirectory, {recursive: true});
    assert.equal(dirname(await realpath(exportsDirectory)), f.directory);
    const exportPath = join(exportsDirectory, `chausar-${f.historical.workspace.id}-731590.json`);
    const before = '{"fixture":"synthetic-namespace-before"}\n';
    const changed = '{"fixture":"synthetic-namespace-change"}\n';
    assert.equal(Buffer.byteLength(before), Buffer.byteLength(changed));
    assert.notEqual(sha(before), sha(changed));
    await writeFile(exportPath, before, {flag: 'wx'});
    assert.equal(dirname(await realpath(exportPath)), await realpath(exportsDirectory));
    await f.source.rpc('workspace.activation.target.create', {targetId, confirmed: true});
    const bridge = await f.source.rpc<WorkspaceBackupActivationReview>('workspace.backup.activation.prepare', f.selection);
    metadata(bridge);
    const candidateText = await retainedCandidate(f.journal);
    const candidateCiphertextPath = join(f.journal.directory, 'private-artifacts', 'workspace-interchange',
      `${artifactId('wac', candidateId, 'archive')}.encrypted.json`);
    const backupCiphertextPath = join(f.source.engine.vault!.directory, 'private-artifacts', 'workspace-interchange',
      `${artifactId('wb2', backupId, 'archive')}.encrypted.json`);
    const inertContainerPath = join(f.directory, inertTargetId, 'backup.inert.json');
    const originalCandidateCiphertext = await readFile(candidateCiphertextPath);
    const originalBackupCiphertext = await readFile(backupCiphertextPath);
    const originalInertContainer = await readFile(inertContainerPath);
    const request = {candidateId, reviewedDigest: bridge.reviewedDigest};
    const review = await f.source.rpc('workspace.activation.review', request); metadata(review);
    assert.equal(await readFile(exportPath, 'utf8'), before);
    const capability = f.source.engine.options.workspaceActivation;
    assert.ok(capability);
    let changes = 0, credentialCalls = 0;
    f.source.engine.options.workspaceActivation = {...capability, targetPassphrase: async authority => {
      credentialCalls++;
      const credential = await capability.targetPassphrase(authority);
      if (changes === 0) {
        assert.equal(await readFile(exportPath, 'utf8'), before);
        await writeFile(exportPath, changed);
        changes++;
      }
      return credential;
    }};
    // Attach captures trusted constructor capabilities; no RPC installs the callback.
    await f.reattach();
    const execute = {...request, projectionDigest: review.projectionDigest, activationId, confirmed: true};
    await f.source.refuse('workspace.activation.execute', execute, ['ACTIVATION_COMMIT_UNKNOWN']);
    assert.ok(credentialCalls > 0); assert.equal(changes, 1);
    assert.equal(await readFile(exportPath, 'utf8'), changed);
    assert.deepEqual(await readFile(candidateCiphertextPath), originalCandidateCiphertext);
    assert.deepEqual(await readFile(backupCiphertextPath), originalBackupCiphertext);
    assert.deepEqual(await readFile(inertContainerPath), originalInertContainer);
    assert.equal(await retainedCandidate(f.journal), candidateText);
    const backup = await f.source.engine.vault!.readArtifact({id: artifactId('wb2', backupId, 'archive'), purpose: 'workspace-interchange'});
    assert.equal((backup.value as {content: string}).content, f.archiveText);
    assertOriginalCiphertexts(f.original, workspaceBackupV2Bytes(validateWorkspaceBackupV2(f.archiveText,
      f.reviewedBackup.sourcePin, budgets), budgets));
    assert.deepEqual(f.source.engine.vault!.read(), f.historical);
    const attempt = await f.journal.readArtifact({id: artifactId('wal', activationId, 'attempt'), purpose: 'workspace-interchange'});
    const committed = attempt.value as {phase: string; record: {activationId: string; candidateId: string;
      candidateCreationId: string; targetId: string; projectionDigest: string; workspaceId: string}};
    assert.equal(committed.phase, 'committed', 'Boundary refusal must retain the actual committed journal.');
    assert.equal(committed.record.activationId, activationId); assert.equal(committed.record.candidateId, candidateId);
    assert.equal(committed.record.candidateCreationId, bridge.candidateCreationId);
    assert.equal(committed.record.targetId, targetId); assert.equal(committed.record.projectionDigest, review.projectionDigest);
    assert.equal(committed.record.workspaceId, review.workspaceId);
    const targetDirectory = join(f.directory, targetId);
    assert.deepEqual((await readdir(targetDirectory)).sort(),
      ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json', 'live'].sort());
    const paths = ['activation-bootstrap.encrypted.json', 'activation-evidence.encrypted.json',
      join('live', 'main', 'authority.encrypted.json')];
    const targetCiphertexts = await Promise.all(paths.map(path => readFile(join(targetDirectory, path))));
    assert.ok(targetCiphertexts.every(bytes => bytes.length > 0));
    for (const [index, part] of ['bootstrap', 'evidence'].entries()) {
      const retained = await readFile(join(f.journal.directory, 'private-artifacts', 'workspace-interchange',
        `${artifactId('wal', activationId, part)}.encrypted.json`));
      assert.deepEqual(targetCiphertexts[index], retained, 'Published inert files must retain exact authenticated journal ciphertext.');
    }
    // The changed owned export is now stable. Inspection starts a new boundary;
    // it authenticates the retained commit without replaying or rolling it back.
    const resolved = await f.source.rpc<WorkspaceActivationSummary>('workspace.activation.get', {activationId}); metadata(resolved);
    assert.equal(resolved.status, 'committed'); assert.equal(resolved.activationId, activationId);
    assert.equal(resolved.targetId, targetId); assert.equal(resolved.candidateId, candidateId);
    assert.equal(resolved.projectionDigest, review.projectionDigest); assert.equal(resolved.workspaceId, review.workspaceId);
    assert.equal(resolved.ciphertextBytes, targetCiphertexts.reduce((total, bytes) => total + bytes.length, 0));
    await f.source.refuse('workspace.activation.execute', execute, ['INTERCHANGE_TARGET_NOT_EMPTY']);
    assert.equal(changes, 1);
    await f.restart();
    assert.deepEqual(await f.source.rpc('workspace.activation.get', {activationId}), resolved);
    assert.equal(await retainedCandidate(f.journal), candidateText);
    assert.equal(await readFile(exportPath, 'utf8'), changed);
    assert.deepEqual(await readFile(backupCiphertextPath), originalBackupCiphertext);
    assert.deepEqual(await readFile(candidateCiphertextPath), originalCandidateCiphertext);
    const reopenedAttempt = await f.journal.readArtifact({id: attempt.id, purpose: 'workspace-interchange'});
    assert.deepEqual(reopenedAttempt, attempt);
    await f.source.refuse('workspace.activation.execute', execute, ['INTERCHANGE_TARGET_NOT_EMPTY']);
  });
