import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, realpath, readFile, readdir, rm, mkdir, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, relative, isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {Engine, type EngineOptions} from '../runtime/engine.ts';
import {createLocalServer} from '../runtime/server.ts';
import {Vault} from '../runtime/vault.ts';
import {workspaceBackupV2Bytes, validateWorkspaceBackupV2, type WorkspaceBackupV2Budgets} from '../runtime/workspace-backup-v2.ts';
import {inspectWorkspaceInterchange, readHistoricalWorkspaceState} from '../runtime/workspace-interchange.ts';
import type {Binding, ImportInput} from '../runtime/ingest.ts';
import {descendants, dialogFor, find, harness, hasText, namedButton} from './fixtures/conversation-acceptance-renderer.ts';

// Real loopback HTTP, encrypted Vault and local files. Every business/credential is
// newly authored synthetic evidence; no native SQL, GUI, vendor or provider call.
const passphrase = 'Synthetic public archive passphrase only';
const sourceId = 'synthetic-public-archive-source';
const secret = 'Synthetic private archive evidence 617843';
const input: ImportInput = {sourceId, format: 'csv',
  content: 'id,kind,date,amount,currency,branch,status\nI1,invoice,2026-09-02,100.00,INR,main,issued',
  recipe: {version: 1, id: 'synthetic-public-archive-recipe', system: 'synthetic-csv', edition: '1',
    scope: {company: 'Synthetic archive', branches: ['main']}, bindings: [
      {target: 'entityId', source: 'id', type: 'string', nulls: 'reject'},
      {target: 'kind', source: 'kind', type: 'string', nulls: 'reject'},
      {target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject'},
      {target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject'},
      ...['currency', 'branch', 'status'].map((target): Binding => ({target, source: target, type: 'string', nulls: 'reject'})),
    ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject'},
  expectedTotals: {rowCount: 1, amountMinor: '10000'}};
const budgets: WorkspaceBackupV2Budgets = {maxArchiveUtf8Bytes: 4_000_000, maxEntryBytes: 1_000_000,
  maxTotalEntryBytes: 2_000_000, maxEntries: 100, maxJsonDepth: 64, maxJsonNodes: 30_000};
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const artifactId = (id: string) => 'wb2_' + sha(id) + '_archive';
const create = {destinationId: 'public_archive', confirmed: true};

async function fixture(t: TestContext, options: Partial<EngineOptions> = {}) {
  const base = await realpath(tmpdir()); if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-backup-public-')));
  let providerCalls = 0;
  const timings: {method: string; elapsedMs: number; status?: number; code?: string}[] = [];
  let pending: {method: string; started: number} | undefined;
  const createEngine = () => new Engine({directory, storage: 'experimental-file', demo: true,
    backupCustody: {budgets, filesystemBudgets: {maxFiles: 100, maxBytes: 4_000_000, maxDepth: 16}},
    gateway: {http: async () => {providerCalls++; throw Error('Synthetic fixture forbids a live provider.');}}, ...options});
  let engine = createEngine(), app = createLocalServer(engine);
  t.after(async () => {
    t.diagnostic(JSON.stringify({requests: timings, pending: pending && {method: pending.method, elapsedMs: Date.now() - pending.started}}));
    await app.close(); const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base); assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-public-'));
    await rm(actual, {recursive: true, force: true}); assert.equal(providerCalls, 0);
  });
  let {origin, token} = await app.listen();
  const raw = async (method: string, payload: unknown = {}) => {
    const started = Date.now(); pending = {method, started};
    const response = await fetch(origin + '/api/rpc', {method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: {'content-type': 'application/json', authorization: 'Bearer ' + token}, body: JSON.stringify({method, payload})});
    const body = await response.json() as any, elapsedMs = Date.now() - started;
    timings.push({method, elapsedMs, status: response.status, ...(body.error ? {code: body.error.code} : {})});
    assert.ok(elapsedMs < 30_000, `${method} exceeded the unchanged per-request deadline.`);
    pending = undefined; return {status: response.status, body};
  };
  const rpc = async (method: string, payload: unknown = {}) => {const response = await raw(method, payload);
    assert.equal(response.status, 200, response.body.error?.code || 'Expected successful synthetic RPC'); return response.body.result;};
  const refuse = async (method: string, payload: unknown, codes?: string[]) => {const response = await raw(method, payload);
    assert.notEqual(response.status, 200); if (codes) assert.ok(codes.includes(response.body.error?.code), response.body.error?.code);};
  await rpc('workspace.create', {name: 'Synthetic public archive', passphrase, pack: 'retail', demo: false});
  await rpc('sources.import', input);
  const vault = () => engine.vault!;
  const capture = () => vault().snapshot(() => vault().captureEncryptedCustody({maxArtifacts: 99, maxEntryBytes: 1_000_000, maxTotalEntryBytes: 2_000_000}));
  const reopen = async () => {await rpc('workspace.lock'); await rpc('workspace.open', {passphrase});};
  const restart = async () => {
    await app.close(); engine = createEngine(); app = createLocalServer(engine);
    ({origin, token} = await app.listen()); await rpc('workspace.open', {passphrase});
  };
  const retained = async (id: string) => (await vault().readArtifact({id: artifactId(id), purpose: 'workspace-interchange'})).value as {content: string};
  return {directory, get engine() {return engine;}, rpc, raw, refuse, vault, capture, reopen, restart, retained};
}
function publicMetadata(value: unknown) {
  const text = JSON.stringify(value); assert.equal(text.includes(passphrase), false); assert.equal(text.includes(secret), false);
  for (const forbidden of ['authorityBase64', 'dataBase64', 'ciphertext', 'recoveryCode', 'passphrase', 'tokenHash']) assert.equal(text.includes('"' + forbidden + '"'), false);
}

test('actual public backup then semantic export composes through inert restore and fresh Engine restart', {timeout: 120_000}, async t => {
  const f = await fixture(t);
  const receipt = await f.rpc('calculation.run', {operation: 'billed', sourceIds: [sourceId], asOf: new Date(Date.now() + 1).toISOString()});
  assert.equal(receipt.totalMinor, '10000');
  const state = f.vault().read(), before = await f.capture();
  const backup = await f.rpc('workspace.backup.v2.create', create);
  assert.equal(backup.fullWorkspacePortable, false); publicMetadata(backup);
  const backupRead = await f.rpc('workspace.backup.v2.read', {backupId: backup.recordId});
  assert.equal(backupRead.sourcePin.authority.sha256, sha(before.authority));
  const restoredInput = {backupId: backup.recordId, targetId: 'composition_inert', reviewedDigest: backup.archiveDigest};
  const restored = await f.rpc('workspace.backup.v2.restoreInert', {...restoredInput, confirmed: true});
  const inertPath = join(f.directory, restoredInput.targetId, 'backup.inert.json');
  const inertBytes = await readFile(inertPath), retainedBackup = await f.retained(backup.recordId);
  const exported = await f.rpc('workspace.interchange.export', {destinationId: 'after_backup', confirmed: true});
  assert.equal(exported.inert, true); publicMetadata(exported);
  await f.rpc('workspace.backup.v2.create', {...create, destinationId: 'after_export_backup'});
  const candidate = await f.rpc('workspace.interchange.prepare', {exportId: exported.recordId,
    candidateId: 'after_backup_candidate', targetId: 'composition_empty'});
  const review = {candidateId: candidate.recordId, reviewedDigest: candidate.reviewedDigest};
  assert.deepEqual(await f.rpc('workspace.interchange.review', review), candidate);
  assert.deepEqual(await readdir(join(f.directory, 'composition_empty')), []);
  const refs = await f.vault().listArtifacts({purpose: 'workspace-interchange'});
  await f.refuse('workspace.backup.v2.create', {...create, destinationId: 'unqualified_candidate_backup'}, ['BACKUP_INVENTORY_INCOMPLETE']);
  assert.deepEqual(await f.vault().listArtifacts({purpose: 'workspace-interchange'}), refs,
    'Backup still requires its separately qualified activation profile to admit a semantic target reservation.');
  assert.deepEqual(f.vault().read(), state);
  await f.restart();
  assert.deepEqual(f.vault().read(), state);
  assert.deepEqual(await f.rpc('workspace.backup.v2.read', {backupId: backup.recordId}), backupRead);
  assert.deepEqual((await f.rpc('workspace.backup.v2.inspectRestored', restoredInput)).receipt, restored);
  assert.deepEqual(await f.rpc('workspace.interchange.review', review), candidate);
  const reopenedExport = await f.rpc('workspace.interchange.export', {destinationId: 'after_backup_restarted', confirmed: true});
  assert.equal(reopenedExport.packageDigest, exported.packageDigest);
  assert.deepEqual(await f.rpc('receipts.get', {id: receipt.id}), receipt);
  assert.deepEqual(await readFile(inertPath), inertBytes);
  assert.deepEqual(await f.retained(backup.recordId), retainedBackup);
  assert.deepEqual(f.vault().read(), state);
  const diagnostics = await f.rpc('workspace.interchange.diagnostics');
  assert.equal(diagnostics.fullWorkspacePortabilityQualified, false);
});

test('actual public interchange keeps backup control ownership constructor-only and refuses unowned artifacts', {timeout: 30_000}, async t => {
  const f = await fixture(t), backup = await f.rpc('workspace.backup.v2.create', create);
  await f.refuse('workspace.interchange.export', {destinationId: 'injected_control', confirmed: true,
    backupControlCustody: {}}, ['INVALID_INTERCHANGE_REQUEST']);
  await f.vault().writeArtifact({id: 'wb2_unowned_archive', purpose: 'workspace-interchange',
    value: {synthetic: 'An unknown artifact is not granted backup ownership.'}, expectedDigest: null});
  const refs = await f.vault().listArtifacts({purpose: 'workspace-interchange'}), state = f.vault().read();
  await f.refuse('workspace.interchange.export', {destinationId: 'unowned_control_export', confirmed: true}, ['INTERCHANGE_CUSTODY_INCOMPLETE']);
  assert.deepEqual(await f.vault().listArtifacts({purpose: 'workspace-interchange'}), refs);
  assert.deepEqual(f.vault().read(), state);
  assert.equal((await f.rpc('workspace.backup.v2.read', {backupId: backup.recordId})).summary.archiveDigest, backup.archiveDigest);
});

test('actual public interchange still refuses revoked historical source authority after backup', {timeout: 30_000}, async t => {
  const f = await fixture(t);
  await f.rpc('workspace.backup.v2.create', create);
  await f.vault().update(state => {state.facts = []; state.imports = []; state.sourceRules.push({sourceId, revoked: true});});
  const refs = await f.vault().listArtifacts({purpose: 'workspace-interchange'}), state = f.vault().read();
  await f.refuse('workspace.interchange.export', {destinationId: 'revoked_historical_backup_export', confirmed: true}, ['SOURCE_REVOKED']);
  assert.deepEqual(await f.vault().listArtifacts({purpose: 'workspace-interchange'}), refs);
  assert.deepEqual(f.vault().read(), state);
});

for (const retained of [false, true]) test(`actual public backup/export/restore/restart retains ${retained ? 'present-empty v2 namespaces' : 'legacy v1 namespace absence'}`, {timeout: 30_000}, async t => {
  const f = await fixture(t);
  if (retained) await f.vault().update(state => {
    state.scenarioRecords = [];
    state.lessonState = {workspaceId: state.workspace.id, episodes: [], lessons: []};
  });
  const state = f.vault().read(), member = state.members.find(item => item.id === 'owner')!;
  const context = {memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' as const};
  const backup = await f.rpc('workspace.backup.v2.create', create);
  const exported = await f.rpc('workspace.interchange.export', {destinationId: 'namespace_export', confirmed: true});
  assert.equal(exported.inventory.stores, retained ? 28 : 26);
  const saved = await f.engine.services.interchangeLocal.ports.custody.read(context, exported.recordId);
  const archive = inspectWorkspaceInterchange(saved.content);
  assert.equal(archive.format, `chausar.workspace-interchange.v${retained ? 2 : 1}`);
  assert.equal(archive.inventory.profile.id, `chausar.persisted-state.v${retained ? 2 : 1}`);
  assert.deepEqual(readHistoricalWorkspaceState(archive), state);
  for (const name of ['scenarioRecords', 'lessonState']) assert.equal(Object.hasOwn(readHistoricalWorkspaceState(archive), name), retained);
  const restoredInput = {backupId: backup.recordId, targetId: 'namespace_inert', reviewedDigest: backup.archiveDigest};
  const restored = await f.rpc('workspace.backup.v2.restoreInert', {...restoredInput, confirmed: true});
  const inertPath = join(f.directory, restoredInput.targetId, 'backup.inert.json'), inert = await readFile(inertPath);
  const priorEngine = f.engine;
  await f.restart(); assert.notEqual(f.engine, priorEngine);
  assert.deepEqual(f.vault().read(), state);
  assert.deepEqual(await f.engine.services.interchangeLocal.ports.custody.read(context, exported.recordId), saved);
  assert.deepEqual((await f.rpc('workspace.backup.v2.inspectRestored', restoredInput)).receipt, restored);
  const reopened = await f.rpc('workspace.interchange.export', {destinationId: 'namespace_export_restarted', confirmed: true});
  assert.equal(reopened.packageDigest, exported.packageDigest);
  assert.equal(reopened.inventory.stores, retained ? 28 : 26);
  assert.deepEqual(await readFile(inertPath), inert);
  assert.equal(backup.fullWorkspacePortable, false);
  assert.equal((await f.rpc('workspace.interchange.diagnostics')).fullWorkspacePortabilityQualified, false);
});

test('actual public archive captures empty private namespaces and reopens exact authenticated readback', async t => {
  const f = await fixture(t), before = await f.capture(), originalState = f.vault().read();
  assert.equal(before.artifacts.length, 0);
  const made = await f.rpc('workspace.backup.v2.create', create); publicMetadata(made);
  assert.equal(made.recordId, create.destinationId); assert.equal(made.fullWorkspacePortable, false);
  assert.equal(made.measurement.qualification, 'encrypted-local-host'); assert.equal(made.entries, 1);
  const read = await f.rpc('workspace.backup.v2.read', {backupId: made.recordId}); publicMetadata(read);
  assert.equal(read.summary.archiveDigest, made.archiveDigest); assert.equal(read.sourcePin.authority.sha256, sha(before.authority));
  assert.deepEqual(f.vault().read(), originalState, 'Custody artifacts do not fabricate a new business authority revision.');
  const bytes = workspaceBackupV2Bytes(validateWorkspaceBackupV2((await f.retained(made.recordId)).content, read.sourcePin, budgets), budgets);
  assert.deepEqual(Buffer.from(bytes.authority), Buffer.from(before.authority));
  await f.reopen(); assert.deepEqual(await f.rpc('workspace.backup.v2.read', {backupId: made.recordId}), read);
});

test('all private status records and prior backup ciphertext survive exact public source-pin readback', async t => {
  const f = await fixture(t);
  for (const status of ['active', 'discarded', 'promoting', 'promoted']) await f.vault().writeArtifact({
    id: 'synthetic_trial_' + status, purpose: 'private-trial', value: {type: 'private-trial-issued-binding-v1', status, secret}, expectedDigest: null});
  await f.vault().writeArtifact({id: 'synthetic_interchange_tombstone', purpose: 'workspace-interchange',
    value: {format: 'chausar.interchange-local-binding.v1', state: 'discarded', secret}, expectedDigest: null});
  await f.rpc('workspace.backup.v2.create', create);
  const before = await f.capture(), second = await f.rpc('workspace.backup.v2.create', {...create, destinationId: 'public_archive_second'});
  const read = await f.rpc('workspace.backup.v2.read', {backupId: second.recordId});
  assert.equal(read.sourcePin.artifacts.length, before.artifacts.length);
  const bytes = workspaceBackupV2Bytes(validateWorkspaceBackupV2((await f.retained(second.recordId)).content, read.sourcePin, budgets), budgets);
  for (const original of before.artifacts) {
    const saved = bytes.artifacts.find(item => item.ref.id === original.ref.id && item.ref.purpose === original.ref.purpose);
    assert.ok(saved); assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(original.bytes));
  }
  assert.ok(read.sourcePin.artifacts.some((item: any) => item.id === artifactId(create.destinationId)));
  publicMetadata(read);
});

test('public inert restore and nonce-free explicit inspection retain exact complete bytes after reopen', async t => {
  const f = await fixture(t), made = await f.rpc('workspace.backup.v2.create', create);
  const payload = {backupId: made.recordId, targetId: 'public_closed_copy', reviewedDigest: made.archiveDigest};
  await f.refuse('workspace.backup.v2.restoreInert', {...payload, confirmed: false}, ['CONFIRMATION_REQUIRED']);
  const receipt = await f.rpc('workspace.backup.v2.restoreInert', {...payload, confirmed: true}); publicMetadata(receipt);
  assert.deepEqual(await readdir(join(f.directory, payload.targetId)), ['backup.inert.json']);
  const container = JSON.parse(await readFile(join(f.directory, payload.targetId, 'backup.inert.json'), 'utf8'));
  assert.equal(container.content, (await f.retained(made.recordId)).content);
  await assert.rejects(Vault.open({directory: join(f.directory, payload.targetId), storage: 'experimental-file', passphrase}));
  const inspected = await f.rpc('workspace.backup.v2.inspectRestored', payload);
  assert.deepEqual(inspected.receipt, receipt); publicMetadata(inspected);
  await f.reopen(); assert.deepEqual(await f.rpc('workspace.backup.v2.inspectRestored', payload), inspected);
  await f.refuse('workspace.backup.v2.restoreInert', {...payload, confirmed: true}, ['BACKUP_TARGET_EXISTS']);
  await f.refuse('workspace.backup.v2.readRestored', {...payload, creationId: 'restore_wrong'}, ['BACKUP_TARGET_CHANGED']);
});

test('unreviewed payloads, replaced target and current epoch changes refuse without another archive/copy', async t => {
  const f = await fixture(t);
  await f.refuse('workspace.backup.v2.create', {...create, budgets}, ['INVALID_BACKUP_REQUEST']);
  await f.refuse('workspace.backup.v2.create', {...create, destinationId: '../outside'});
  const made = await f.rpc('workspace.backup.v2.create', create);
  await f.refuse('workspace.backup.v2.create', create, ['BACKUP_OUTPUT_EXISTS']);
  const payload = {backupId: made.recordId, targetId: 'public_tampered_copy', reviewedDigest: made.archiveDigest};
  await f.refuse('workspace.backup.v2.restoreInert', {...payload, reviewedDigest: '0'.repeat(64), confirmed: true}, ['BACKUP_REVIEW_CHANGED']);
  await f.rpc('workspace.backup.v2.restoreInert', {...payload, confirmed: true});
  await writeFile(join(f.directory, payload.targetId, 'unclassified.txt'), 'Synthetic unexpected custody');
  await f.refuse('workspace.backup.v2.inspectRestored', payload, ['BACKUP_TARGET_CHANGED']);
  await f.vault().update(state => {state.members.find(member => member.id === 'owner')!.epoch++;});
  await f.refuse('workspace.backup.v2.read', {backupId: made.recordId});
});

test('actual unqualified managed sources require held admission and still fail the semantic consumer gate', async t => {
  const f = await fixture(t);
  await f.vault().update(state => {state.imports.push({id: 'synthetic_unqualified_capture', type: 'connector-capture-v1', sourceId});});
  await f.refuse('workspace.backup.v2.create', create, ['BACKUP_HELD_READINESS_REQUIRED']);
  await mkdir(join(f.directory, 'unclassified-synthetic-sibling'));
  // Explicitly labelled host-admission fixture; it does not qualify a vendor or a live lease.
  f.engine.options.backupCustody = {...f.engine.options.backupCustody,
    withCompleteOwner: async (_context, _historical, work) => work(() => {})};
  await f.refuse('workspace.backup.v2.create', create, ['SOURCE_NOT_READY', 'CONNECTOR_SOURCE_NOT_READY', 'CONSUMER_SOURCE_NOT_READY']);
});

test('actual renderer and strict preload IPC publish one encrypted archive and read a closed copy through real HTTP', async t => {
  const f = await fixture(t), h = await harness({mount: true, dispatch: (method, payload) => f.rpc(method, payload)});
  h.renderer.state.workspace = f.vault().read().workspace;
  h.renderer.state.status = await f.rpc('workspace.status');
  await h.renderer.showWorkspace();
  await namedButton(dialogFor(h.body, 'Your workspace'), 'Encrypted archive').dispatch('click');
  let dialog = dialogFor(h.body, 'Encrypted archive');
  const control = (label: string) => find(dialog, node => node.tagName === 'input' && node.attributes['aria-label'] === label);
  const form = (label: string) => find(dialog, node => node.tagName === 'form' && hasText(node, label));
  const consent = (node: ReturnType<typeof form>) => find(node, child => child.tagName === 'input' && child.attributes.type === 'checkbox');
  const createForm = form('Create encrypted archive once');
  control('New archive ID').value = create.destinationId;
  await createForm.dispatch('submit');
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.create').length, 0);
  consent(createForm).checked = true;
  await createForm.dispatch('submit');
  const reviewed = await f.rpc('workspace.backup.v2.read', {backupId: create.destinationId});
  publicMetadata(reviewed);
  assert.equal(control('Reviewed archive digest').value, reviewed.summary.archiveDigest);
  assert.equal(control('Reviewed archive digest').attributes.readonly, '');
  const copyForm = form('Create closed copy once'), targetId = 'public_renderer_closed_copy';
  control('New closed copy ID').value = targetId; consent(copyForm).checked = true;
  await copyForm.dispatch('submit');
  assert.ok(hasText(dialog, 'Closed encrypted copy verified. It remains inert and has not become an active workspace.'));
  const copied = await f.rpc('workspace.backup.v2.inspectRestored', {backupId: create.destinationId, targetId, reviewedDigest: reviewed.summary.archiveDigest});
  const container = JSON.parse(await readFile(join(f.directory, targetId, 'backup.inert.json'), 'utf8'));
  assert.equal(container.content, (await f.retained(create.destinationId)).content);
  assert.deepEqual(copied.sourcePin, reviewed.sourcePin);
  assert.equal(control('Exact copy creation ID').value, copied.receipt.creationId);
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.create').length, 1);
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.restoreInert').length, 1);
  assert.deepEqual(h.calls.find(call => call.method === 'workspace.backup.v2.restoreInert').payload,
    {backupId: create.destinationId, targetId, reviewedDigest: reviewed.summary.archiveDigest, confirmed: true});
  dialog.close(); await dialog.dispatch('close'); await f.reopen();
  await h.renderer.showWorkspace();
  await namedButton(dialogFor(h.body, 'Your workspace'), 'Encrypted archive').dispatch('click');
  dialog = dialogFor(h.body, 'Encrypted archive');
  control('Copy archive ID').value = create.destinationId; control('Existing copy ID').value = targetId;
  assert.equal(control('Existing copy archive digest').value, ''); assert.equal(control('Exact copy creation ID').value, '');
  await form('Inspect existing closed copy').dispatch('submit');
  assert.equal(control('Exact copy creation ID').value, copied.receipt.creationId);
  assert.ok(hasText(dialog, 'Closed encrypted copy verified. It remains inert and has not become an active workspace.'));
  await namedButton(dialog, 'Read exact copy receipt').dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'workspace.backup.v2.restoreInert').length, 1);
  assert.equal(h.calls.some(call => /activate/.test(call.method)), false);
  assert.equal(h.rejected.length, 0, 'Actual strict structured-clone IPC routes every request to the real HTTP Engine.');
  assert.deepEqual(await readdir(join(f.directory, targetId)), ['backup.inert.json']);
  assert.equal(descendants(dialog).some(node => node.attributes.type === 'password'), false);
});
