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
import type {Binding, ImportInput} from '../runtime/ingest.ts';
import {preloadBridge} from './fixtures/preload-bridge.ts';

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
  const engine = new Engine({directory, storage: 'experimental-file', demo: true,
    backupCustody: {budgets, filesystemBudgets: {maxFiles: 100, maxBytes: 4_000_000, maxDepth: 16}},
    gateway: {http: async () => {providerCalls++; throw Error('Synthetic fixture forbids a live provider.');}}, ...options});
  const app = createLocalServer(engine);
  t.after(async () => {
    await app.close(); const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base); assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-backup-public-'));
    await rm(actual, {recursive: true, force: true}); assert.equal(providerCalls, 0);
  });
  const {origin, token} = await app.listen();
  const raw = async (method: string, payload: unknown = {}) => {
    const response = await fetch(origin + '/api/rpc', {method: 'POST', headers: {'content-type': 'application/json', authorization: 'Bearer ' + token},
      body: JSON.stringify({method, payload})}); return {status: response.status, body: await response.json() as any};
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
  const retained = async (id: string) => (await vault().readArtifact({id: artifactId(id), purpose: 'workspace-interchange'})).value as {content: string};
  return {directory, engine, rpc, raw, refuse, vault, capture, reopen, retained};
}
function publicMetadata(value: unknown) {
  const text = JSON.stringify(value); assert.equal(text.includes(passphrase), false); assert.equal(text.includes(secret), false);
  for (const forbidden of ['authorityBase64', 'dataBase64', 'ciphertext', 'recoveryCode', 'passphrase', 'tokenHash']) assert.equal(text.includes('"' + forbidden + '"'), false);
}

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

// What the desktop checked before it called a closed copy verified: the archive summary, its source pin and the copy
// receipt all agree on the managed IDs, digest, entries and the inert, root-only activation.
function verifiedSummary(summary: any, backupId: string) {
  assert.equal(summary.recordId, backupId); assert.match(summary.archiveDigest, /^[a-f0-9]{64}$/);
  assert.equal(summary.fullWorkspacePortable, false); assert.equal(summary.inert, true); assert.equal(summary.activation, 'root-only');
  assert.equal(summary.scope, 'authority-and-all-typed-private-artifacts'); assert.ok(Array.isArray(summary.namespaces));
  assert.ok(Array.isArray(summary.externalKeyRequirements)); assert.ok(summary.source);
  assert.ok(Number.isSafeInteger(summary.entries)); assert.ok(Number.isSafeInteger(summary.encryptedEntryBytes));
}
function verifiedArchive(record: any, backupId: string) {
  const summary = record.summary, pin = record.sourcePin;
  verifiedSummary(summary, backupId);
  assert.equal(pin.format, 'chausar.backup-source-pin.v2'); assert.equal(pin.scope, summary.scope); assert.equal(pin.fullWorkspacePortable, false);
  assert.deepEqual(pin.source, summary.source); assert.deepEqual(pin.namespaces, summary.namespaces);
  assert.deepEqual(pin.externalKeyRequirements, summary.externalKeyRequirements);
}
function verifiedReceipt(receipt: any, summary: any, pin: any, targetId: string, creationId?: string) {
  assert.equal(receipt.targetId, targetId); assert.match(receipt.creationId, /^[A-Za-z0-9_-]{1,100}$/);
  if (creationId) assert.equal(receipt.creationId, creationId);
  assert.equal(receipt.archiveDigest, summary.archiveDigest); assert.deepEqual(receipt.sourcePin, pin);
  assert.equal(receipt.entries, summary.entries); assert.equal(receipt.bytes, summary.encryptedEntryBytes);
  assert.equal(receipt.inert, true); assert.equal(receipt.activation, 'root-only');
}

test('the desktop preload and strict IPC publish one encrypted archive and read a closed copy through real HTTP', async t => {
  const f = await fixture(t), bridge = await preloadBridge({dispatch: (method, payload) => f.rpc(method, payload)});
  const request = bridge.request;
  // The desktop's sequence: create once, read the archive back, read it again just before the copy, copy once, read the copy.
  const made = await request('workspace.backup.v2.create', {destinationId: create.destinationId, confirmed: true});
  verifiedSummary(made, create.destinationId);
  const reviewed = await request('workspace.backup.v2.read', {backupId: create.destinationId});
  publicMetadata(reviewed); verifiedArchive(reviewed, create.destinationId);
  assert.equal(made.archiveDigest, reviewed.summary.archiveDigest);
  const targetId = 'public_preload_closed_copy', reviewedDigest = reviewed.summary.archiveDigest;
  assert.deepEqual(await request('workspace.backup.v2.read', {backupId: create.destinationId}), reviewed);
  const receipt = await request('workspace.backup.v2.restoreInert', {backupId: create.destinationId, targetId, reviewedDigest, confirmed: true});
  verifiedReceipt(receipt, reviewed.summary, reviewed.sourcePin, targetId);
  const restored = await request('workspace.backup.v2.readRestored', {backupId: create.destinationId, targetId, creationId: receipt.creationId, reviewedDigest});
  verifiedArchive(restored, create.destinationId); verifiedReceipt(restored.receipt, reviewed.summary, reviewed.sourcePin, targetId, receipt.creationId);
  assert.deepEqual(restored.summary, reviewed.summary); assert.deepEqual(restored.sourcePin, reviewed.sourcePin); assert.deepEqual(restored.receipt, receipt);
  const copied = await f.rpc('workspace.backup.v2.inspectRestored', {backupId: create.destinationId, targetId, reviewedDigest});
  const container = JSON.parse(await readFile(join(f.directory, targetId, 'backup.inert.json'), 'utf8'));
  assert.equal(container.content, (await f.retained(create.destinationId)).content);
  assert.deepEqual(copied.sourcePin, reviewed.sourcePin);
  assert.equal(receipt.creationId, copied.receipt.creationId);
  assert.equal(bridge.calls.filter(call => call.method === 'workspace.backup.v2.create').length, 1);
  assert.equal(bridge.calls.filter(call => call.method === 'workspace.backup.v2.restoreInert').length, 1);
  assert.deepEqual(bridge.calls.find(call => call.method === 'workspace.backup.v2.restoreInert').payload,
    {backupId: create.destinationId, targetId, reviewedDigest: reviewed.summary.archiveDigest, confirmed: true});
  await f.reopen();
  // After a restart the desktop holds only the two IDs: it reads the archive for its digest, inspects the copy, then
  // reads the exact receipt by its creation ID. None of these creates, retries or activates anything.
  const archive = await request('workspace.backup.v2.read', {backupId: create.destinationId});
  verifiedArchive(archive, create.destinationId);
  const inspected = await request('workspace.backup.v2.inspectRestored', {backupId: create.destinationId, targetId, reviewedDigest: archive.summary.archiveDigest});
  verifiedArchive(inspected, create.destinationId); assert.equal(inspected.summary.archiveDigest, archive.summary.archiveDigest);
  assert.deepEqual(inspected.sourcePin, archive.sourcePin); verifiedReceipt(inspected.receipt, inspected.summary, inspected.sourcePin, targetId);
  assert.equal(inspected.receipt.creationId, copied.receipt.creationId);
  const exact = await request('workspace.backup.v2.readRestored', {backupId: create.destinationId, targetId, creationId: inspected.receipt.creationId, reviewedDigest: archive.summary.archiveDigest});
  verifiedArchive(exact, create.destinationId); verifiedReceipt(exact.receipt, exact.summary, exact.sourcePin, targetId, copied.receipt.creationId);
  assert.equal(bridge.calls.filter(call => call.method === 'workspace.backup.v2.restoreInert').length, 1);
  assert.equal(bridge.calls.some(call => /activate/.test(call.method)), false);
  assert.equal(bridge.rejected.length, 0, 'Actual strict structured-clone IPC routes every request to the real HTTP Engine.');
  assert.deepEqual(await readdir(join(f.directory, targetId)), ['backup.inert.json']);
});
