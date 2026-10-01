import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import { Vault } from '../runtime/vault.ts';
import { createLocalServer } from '../runtime/server.ts';
import { FileSyncTransport, type FileSyncTransportOptions } from '../runtime/sync-file-transport.ts';
import { reconcileSyncPublication } from '../runtime/sync-publication-recovery.ts';
import { FileSyncWriterAdmission, type SyncWriterState, type SyncWriterStatus } from '../runtime/sync-writer-admission.ts';
import type { Binding, ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { Context, State } from '../runtime/contracts.ts';
import type { JobConfig } from '../runtime/jobs.ts';

// Synthetic local source, money, keys, host policy and controllable time only.
// These tests use real encrypted experimental-file vaults and loopback HTTP;
// they do not qualify remote devices, cloud folders, native storage or live sources.
const passphrase = 'Synthetic public sync engine fixture passphrase';
const sourceId = 'synthetic-public-sync-books';
const deviceId = 'synthetic-sync-source-device';
const signerId = 'synthetic-sync-source-signer';
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };
const importInput: ImportInput & { recipe: MappingRecipe } = {
  sourceId, format: 'csv',
  content: 'id,kind,date,amount,currency,branch,status,description\nsynthetic-invoice,invoice,2026-09-01,100.00,INR,main,issued,Synthetic billed amount\nsynthetic-payment-one,payment,2026-09-02,60.00,INR,main,settled,Synthetic first collection\nsynthetic-payment-two,payment,2026-09-03,40.00,INR,main,settled,Synthetic second collection',
  recipe: {
    version: 1, id: 'synthetic-public-sync-money', system: 'synthetic-csv', edition: '1',
    scope: { company: 'Synthetic Public Sync', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status', 'description'].map((field): Binding => ({ target: field, source: field, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment'], allowedStatuses: ['issued', 'settled'], onUnmapped: 'reject',
  }, expectedTotals: { rowCount: 3, amountMinor: '20000' },
};
const errorCode = (expected: string) => (error: unknown) => (error as { code?: string }).code === expected;

class ObservedFileTransport extends FileSyncTransport {
  publications = 0;
  loseAcknowledgment = false;
  #publishing = false;
  constructor(options: Omit<FileSyncTransportOptions, 'fault'>) {
    let installed!: ObservedFileTransport;
    super({ ...options, fault: point => {
      if (point === 'after-state-commit' && installed.#publishing && installed.loseAcknowledgment) {
        throw new Error('Labelled synthetic publication acknowledgement loss');
      }
    } });
    installed = this;
  }
  async put(input: Parameters<FileSyncTransport['put']>[0]) {
    this.publications++; this.#publishing = true;
    try { return await super.put(input); }
    finally { this.#publishing = false; }
  }
}

function deferred() {
  let resolvePromise!: () => void;
  return { promise: new Promise<void>(done => { resolvePromise = done; }), resolve: () => resolvePromise() };
}

async function fixture(t: TestContext, options: { jobs?: boolean; missingAdmission?: boolean } = {}) {
  const temporaryRoot = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(temporaryRoot, /^C:\\/i, 'All fixture writes must remain on C.');
  const directory = await mkdtemp(join(temporaryRoot, 'chausar-sync-engine-'));
  const engines = new Set<Engine>(), apps = new Set<ReturnType<typeof createLocalServer>>();
  let timeMs = Date.now(), providerCalls = 0;
  const clock = () => new Date(timeMs);
  const hostPolicy = { workerId: 'synthetic-sync-job-worker', maxActiveJobs: 4, leaseMs: 10000,
    networkAvailable: () => false, clock: () => timeMs };
  const baseOptions = (hostDirectory: string): EngineOptions => ({
    directory: hostDirectory, demo: true, storage: 'experimental-file',
    ...(options.jobs ? { durableJobs: hostPolicy } : {}),
    gateway: { http: async () => { providerCalls++; throw new Error('The sync fixture must not call a model provider.'); } },
  });
  const engineFor = (hostDirectory: string, sync?: EngineOptions['sync']) => {
    const engine = new Engine({ ...baseOptions(hostDirectory), ...(sync ? { sync } : {}) }); engines.add(engine); return engine;
  };
  t.after(async () => {
    for (const app of apps) await app.close();
    for (const engine of engines) await engine.close();
    const target = resolve(directory), child = relative(temporaryRoot, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-sync-engine-'));
    await rm(target, { recursive: true, force: true });
  });
  const sourceDirectory = join(directory, 'source-host'), bootstrap = engineFor(sourceDirectory);
  await bootstrap.request('workspace.create', { name: 'Synthetic Public Sync', passphrase, demo: false, pack: 'ecommerce' });
  const imported = await bootstrap.request('sources.import', importInput);
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 3);
  const receipt = await bootstrap.request('calculation.run', { operation: 'received', period, branch: 'main' });
  assert.equal(receipt.valueMinor, '10000'); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  let job: any;
  if (options.jobs) {
    await bootstrap.request('trust.update', { autonomy: true, send: 'nothing' });
    const config: JobConfig = { type: 'calculation-set', goal: 'Measure synthetic September collections exactly',
      input: { requests: [{ id: 'synthetic-collections', input: { operation: 'received', period, branch: 'main' }, reserveMinor: '1', durationMs: 2000 }] },
      sourceIds: [sourceId], budgetMinor: '10', reserveMinor: '1', limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
      stopRule: { maxRuns: 1, deadline: new Date(timeMs + 300000).toISOString() }, nextRunAt: clock().toISOString(),
      intervalMs: 60000, graceMs: 0, catchup: 'latest', background: false, testedRoutes: [], allowedActions: [] };
    job = await bootstrap.request('jobs.create', config);
  }
  const initial = bootstrap.vault!.read(), workspaceId = initial.workspace.id, vaultId = bootstrap.vault!.vaultId;
  await bootstrap.close();
  const transportDirectory = join(directory, 'encrypted-transport'), admissionDirectory = join(directory, 'source-writer');
  await mkdir(transportDirectory); await mkdir(admissionDirectory);
  // Generated keys are labelled fixture identities, retained across all reopenings.
  const keys = generateKeyPairSync('ed25519');
  const transport = new ObservedFileTransport({ directory: transportDirectory, workspaceId, vaultId, clock });
  const admission = new FileSyncWriterAdmission({ directory: admissionDirectory, workspaceId, vaultId, deviceId, clock });
  const sync: EngineOptions['sync'] = { transport, enabled: !options.missingAdmission, mode: 'single-writer', workspaceId,
    deviceId, signerId, signingKey: keys.privateKey,
    trustedSigners: { [signerId]: { publicKey: keys.publicKey, memberId: 'owner', epoch: 1 } },
    clock, leaseTtlMs: 60000, ...(options.missingAdmission ? {} : { writerAdmission: admission }) };
  const engine = engineFor(sourceDirectory, sync);
  await engine.request('workspace.open', { folder: 'main', passphrase });
  async function http(target: Engine) {
    const app = createLocalServer(target); apps.add(app); const { origin, token } = await app.listen();
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(paired.status, 200); assert.deepEqual(await paired.json(), { token });
    const raw = async (method: string, payload: unknown = {}) => {
      const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: {
        'content-type': 'application/json', authorization: `Bearer ${token}`,
      }, body: JSON.stringify({ method, payload }) });
      return { status: response.status, body: await response.json() as any };
    };
    const rpc = async (method: string, payload: unknown = {}) => {
      const response = await raw(method, payload);
      assert.equal(response.status, 200, `${method}: ${JSON.stringify(response.body)}`);
      assert.equal(response.body.error, undefined); return response.body.result;
    };
    const refused = async (method: string, payload: unknown, expected: string) => {
      const response = await raw(method, payload);
      assert.notEqual(response.status, 200, `${method} must refuse ${expected}`);
      assert.equal(response.body.result, undefined); assert.equal(response.body.error.code, expected); return response;
    };
    return { raw, rpc, refused, close: async () => { await app.close(); apps.delete(app); } };
  }
  async function review(target = engine, reviewedDevice = deviceId, ttlMs = 60000) {
    const status: SyncWriterStatus = await target.request('sync.writer.status');
    return target.request('sync.writer.review', { expectedFence: status.fence, expectedStateDigest: status.localStateDigest,
      deviceId: reviewedDevice, memberId: 'owner', epoch: 1, expiresAt: new Date(timeMs + ttlMs).toISOString(),
      reason: 'Explicit synthetic owner review of this local writer and current state.' });
  }
  return { directory, sourceDirectory, engine, engineFor, http, review, initial, imported, receipt, job,
    workspaceId, vaultId, admission, admissionDirectory, transport, sync, clock,
    advance: (ms: number) => { timeMs += ms; }, providerCalls: () => providerCalls };
}

test('public sync joins reviewed writer admission to encrypted publication and explicit staged restore', async t => {
  const f = await fixture(t), first = await f.engine.request('sync.writer.status');
  assert.equal(first.readonly, true); assert.equal(first.reason, 'SYNC_WRITER_REVIEW_REQUIRED');
  const untouched = f.engine.vault!.read();
  await assert.rejects(f.engine.request('trust.update', { autonomy: true }), errorCode('SYNC_WRITER_REVIEW_REQUIRED'));
  assert.deepEqual(f.engine.vault!.read(), untouched);
  const admitted = await f.review(); assert.equal(admitted.readonly, false); assert.equal(admitted.fence, 1);
  const source = await f.http(f.engine);
  const status = await source.rpc('sync.status'); assert.equal(status.enabled, true); assert.equal(status.deviceId, deviceId);
  const identity = await source.rpc('sync.identity'); assert.equal(identity.signerId, signerId);
  const preview = await source.rpc('sync.preview'), approval = await source.rpc('sync.approve', { id: preview.id });
  const publication = await source.rpc('sync.push', { previewId: preview.id, approvalId: approval.id });
  assert.equal(publication.receipt.status, 'completed'); assert.equal(publication.receipt.payloadBase64, undefined);
  const snapshot = (await f.transport.get(publication.head.recordHash))!;
  assert.equal(snapshot.ciphertextDigest, preview.digest); assert.equal(snapshot.vaultId, f.vaultId);
  const encrypted = Buffer.from(snapshot.ciphertextBase64, 'base64').toString('utf8');
  assert.equal(JSON.parse(encrypted).backupFormat, 'chausar.backup.v1');
  assert.equal(encrypted.includes('synthetic-payment-one'), false); assert.equal(f.transport.publications, 1);
  const liveSource = f.engine.vault!.read();

  const receiverDirectory = join(f.directory, 'receiver-host'), receiverBootstrap = f.engineFor(receiverDirectory);
  await receiverBootstrap.request('workspace.create', { name: 'Synthetic Staging Receiver', passphrase, demo: false, pack: 'ecommerce' });
  const receiverState = receiverBootstrap.vault!.read(), receiverVaultId = receiverBootstrap.vault!.vaultId;
  await receiverBootstrap.close();
  const control = join(f.directory, 'receiver-writer'); await mkdir(control);
  const receiverDevice = 'synthetic-sync-receiver-device', receiverKeys = generateKeyPairSync('ed25519');
  const receiverAdmission = new FileSyncWriterAdmission({ directory: control, workspaceId: receiverState.workspace.id,
    vaultId: receiverVaultId, deviceId: receiverDevice, clock: f.clock });
  const receiver = f.engineFor(receiverDirectory, { ...f.sync, writerAdmission: receiverAdmission,
    deviceId: receiverDevice, signerId: 'synthetic-sync-receiver-signer', signingKey: receiverKeys.privateKey });
  await receiver.request('workspace.open', { folder: 'main', passphrase });
  await f.review(receiver, receiverDevice);
  const receiving = await f.http(receiver), staged = await receiving.rpc('sync.pull', {
    folder: 'staged-source', passphrase, expectedWorkspaceId: f.workspaceId,
  });
  assert.equal(staged.liveAuthorityChanged, false); assert.equal(staged.directory, join(receiverDirectory, 'staged-source'));
  assert.equal(receiver.vault!.read().workspace.id, receiverState.workspace.id);
  assert.equal(receiver.vault!.read().facts.length, 0); assert.deepEqual(f.engine.vault!.read(), liveSource);
  await receiving.rpc('workspace.lock'); await receiving.close();

  // The receiver's grant is never rebound to the restored source. Open explicitly
  // under the original source-bound port after closing the staging authority.
  const inspector = f.engineFor(receiverDirectory, f.sync);
  await inspector.request('workspace.open', { folder: 'staged-source', passphrase });
  assert.equal(inspector.vault!.vaultId, f.vaultId); assert.equal(inspector.vault!.read().workspace.id, f.workspaceId);
  assert.deepEqual(inspector.vault!.read().facts, f.initial.facts);
  assert.deepEqual(await inspector.request('receipts.get', { id: f.receipt.id }), f.receipt);
  assert.equal(inspector.vault!.read().receipts.length, 1);
  await inspector.request('workspace.lock');
  assert.deepEqual(f.engine.vault!.read(), liveSource); assert.equal(f.providerCalls(), 0);
});

test('public handover makes the former device read-only and direct Vault.update cannot bypass it', async t => {
  const f = await fixture(t); await f.review(); const source = await f.http(f.engine);
  const current = await source.rpc('sync.writer.status');
  const handedOver = await source.rpc('sync.writer.review', { expectedFence: current.fence, expectedStateDigest: current.localStateDigest,
    deviceId: 'synthetic-sync-next-device', memberId: 'owner', epoch: 1, expiresAt: new Date(f.clock().getTime() + 60000).toISOString(),
    reason: 'Explicit synthetic handover to the next device.' });
  assert.equal(handedOver.fence, current.fence + 1); assert.equal(handedOver.readonly, true);
  assert.equal(handedOver.reason, 'SYNC_WRITER_DEVICE_MISMATCH');
  const before = f.engine.vault!.read();
  await source.refused('trust.update', { autonomy: true }, 'SYNC_WRITER_DEVICE_MISMATCH');
  await assert.rejects(f.engine.vault!.update(state => { state.policy.autonomy = true; }), errorCode('SYNC_WRITER_DEVICE_MISMATCH'));
  await source.refused('sync.enable', { enabled: false }, 'SYNC_WRITER_DEVICE_MISMATCH');
  assert.deepEqual(f.engine.vault!.read(), before); assert.equal(f.transport.publications, 0);
  assert.deepEqual(await source.rpc('receipts.get', { id: f.receipt.id }), f.receipt); assert.equal(f.providerCalls(), 0);
  await source.close();
  const nextDevice = 'synthetic-sync-next-device', nextKeys = generateKeyPairSync('ed25519');
  const nextAdmission = new FileSyncWriterAdmission({ directory: f.admissionDirectory, workspaceId: f.workspaceId,
    vaultId: f.vaultId, deviceId: nextDevice, clock: f.clock });
  const next = f.engineFor(f.sourceDirectory, { ...f.sync, writerAdmission: nextAdmission, deviceId: nextDevice,
    signerId: 'synthetic-sync-next-signer', signingKey: nextKeys.privateKey });
  await next.request('workspace.open', { folder: 'main', passphrase });
  assert.equal((await next.request('sync.writer.status')).readonly, false);
  await next.request('trust.update', { autonomy: true });
  assert.equal(next.vault!.read().policy.autonomy, true);
  assert.deepEqual(await next.request('receipts.get', { id: f.receipt.id }), f.receipt);
});

test('writer expiry is rechecked before encrypted commit and rejects subsequent public mutations', async t => {
  const f = await fixture(t); await f.review(f.engine, deviceId, 1000);
  const before = f.engine.vault!.read();
  await assert.rejects(f.engine.vault!.update(async state => {
    state.policy.autonomy = true; await Promise.resolve(); f.advance(1001);
  }), errorCode('SYNC_WRITER_EXPIRED'));
  assert.deepEqual(f.engine.vault!.read(), before);
  const source = await f.http(f.engine), status = await source.rpc('sync.writer.status');
  assert.equal(status.readonly, true); assert.equal(status.reason, 'SYNC_WRITER_EXPIRED');
  await source.refused('trust.update', { autonomy: true }, 'SYNC_WRITER_EXPIRED');
  assert.deepEqual(f.engine.vault!.read(), before); assert.equal(f.providerCalls(), 0);
});

test('a queued public job authority commit cannot proceed after owner-reviewed handover', async t => {
  const f = await fixture(t, { jobs: true }); await f.review(); const source = await f.http(f.engine);
  const before = f.engine.vault!.read(), entered = deferred(), released = deferred();
  const originalRun = f.admission.run.bind(f.admission);
  // Pause one queued authority commit before entering the real file admission
  // transaction. Handover remains possible, then the real guard decides the write.
  f.admission.run = async <T>(input: SyncWriterState, work: (assertCurrent: () => void) => Promise<{ result: T; committedState: State }>): Promise<T> => {
    entered.resolve(); await released.promise; return originalRun(input, work);
  };
  const pending = source.raw('jobs.run', { id: f.job.id });
  try {
    await Promise.race([entered.promise, pending.then(() => assert.fail('The public job returned before reaching writer admission.'))]);
    const current = await source.rpc('sync.writer.status');
    await source.rpc('sync.writer.review', { expectedFence: current.fence, expectedStateDigest: current.localStateDigest,
      deviceId: 'synthetic-sync-next-job-device', memberId: 'owner', epoch: 1,
      expiresAt: new Date(f.clock().getTime() + 60000).toISOString(), reason: 'Synthetic handover while a job commit is queued.' });
    released.resolve(); const refused = await pending;
    if (refused.body.error) assert.equal(refused.body.error.code, 'SYNC_WRITER_DEVICE_MISMATCH');
    else { assert.equal(refused.status, 200); assert.equal(refused.body.result.status, 'scheduled'); }
  } finally { released.resolve(); f.admission.run = originalRun; await pending; }
  assert.deepEqual(f.engine.vault!.read(), before);
  assert.equal(f.engine.vault!.read().jobs[0].execution, undefined);
  assert.equal(f.engine.vault!.read().receipts.length, 1); assert.equal(f.providerCalls(), 0);
});

test('configured sync without admission stays read-only and refuses enabling or direct mutation', async t => {
  const f = await fixture(t, { missingAdmission: true }), source = await f.http(f.engine);
  const status = await source.rpc('sync.writer.status'); assert.equal(status.readonly, true);
  assert.equal(status.reason, 'SYNC_WRITER_ADMISSION_REQUIRED');
  const before = f.engine.vault!.read();
  await source.refused('trust.update', { autonomy: true }, 'SYNC_WRITER_ADMISSION_REQUIRED');
  await source.refused('sync.enable', { enabled: true }, 'SYNC_WRITER_ADMISSION_REQUIRED');
  await assert.rejects(f.engine.vault!.update(state => { state.policy.autonomy = true; }), errorCode('SYNC_WRITER_ADMISSION_REQUIRED'));
  assert.deepEqual(f.engine.vault!.read(), before); assert.equal((await source.rpc('sync.status')).enabled, false);
});

test('writer review requires an untainted desktop admin and exact reviewed fence', async t => {
  const f = await fixture(t), current = await f.engine.request('sync.writer.status');
  const review = { expectedFence: current.fence, expectedStateDigest: current.localStateDigest,
    deviceId, memberId: 'owner', epoch: 1, expiresAt: new Date(f.clock().getTime() + 60000).toISOString(), reason: 'Synthetic reviewed writer.' };
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'phone' }, 'sync.writer.review', review), errorCode('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.engine.requestAs({ ...owner, sourceTainted: true }, 'sync.writer.review', review), errorCode('APP_APPROVAL_REQUIRED'));
  await assert.rejects(f.engine.request('sync.writer.review', { ...review, inferred: true }), errorCode('INVALID_SYNC_REQUEST'));
  const admitted = await f.engine.request('sync.writer.review', review); assert.equal(admitted.readonly, false);
  await assert.rejects(f.engine.request('sync.writer.review', review), errorCode('SYNC_WRITER_CAS_CONFLICT'));
  assert.equal((await f.engine.request('sync.writer.status')).fence, 1);
  const before = f.engine.vault!.read();
  await assert.rejects(f.engine.requestAs({ ...owner, channel: 'phone' }, 'trust.update', { autonomy: true }), errorCode('SYNC_WRITER_ACTOR_MISMATCH'));
  await assert.rejects(f.engine.requestAs({ ...owner, sourceTainted: true }, 'trust.update', { autonomy: true }), errorCode('SYNC_WRITER_ACTOR_MISMATCH'));
  assert.deepEqual(f.engine.vault!.read(), before);
});

test('closing drains an accepted asynchronous writer update and preserves admission on reopen', async t => {
  const f = await fixture(t); await f.review();
  const before = await f.engine.request('sync.writer.status'), vault = f.engine.vault!;
  const entered = deferred(), released = deferred();
  const update = vault.update(async state => {
    state.policy.autonomy = true; entered.resolve(); await released.promise;
    return 'synthetic-admitted-update';
  });
  await entered.promise;
  const closing = f.engine.close();
  assert.throws(() => vault.read(), errorCode('VAULT_CLOSED'));
  released.resolve();
  assert.equal(await update, 'synthetic-admitted-update'); await closing;

  const reopened = f.engineFor(f.sourceDirectory, f.sync);
  await reopened.request('workspace.open', { folder: 'main', passphrase });
  const status = await reopened.request('sync.writer.status');
  assert.equal(reopened.vault!.read().policy.autonomy, true);
  assert.equal(status.readonly, false); assert.equal(status.reason, null);
  assert.equal(status.stateDigest, status.localStateDigest);
  assert.notEqual(status.stateDigest, before.stateDigest);
  assert.equal(status.fence, before.fence);
  assert.deepEqual(await reopened.request('receipts.get', { id: f.receipt.id }), f.receipt);
  assert.equal(f.providerCalls(), 0);
});

test('closing drains an accepted asynchronous update in ordinary local mode', async t => {
  const f = await fixture(t); await f.engine.close();
  const local = f.engineFor(f.sourceDirectory);
  await local.request('workspace.open', { folder: 'main', passphrase });
  const vault = local.vault!, entered = deferred(), released = deferred();
  const expected = vault.read(); expected.policy.autonomy = true; expected.revision++;
  const update = vault.update(async state => {
    state.policy.autonomy = true; entered.resolve(); await released.promise;
    return 'synthetic-local-update';
  });
  await entered.promise;
  const closing = local.close();
  assert.throws(() => vault.read(), errorCode('VAULT_CLOSED'));
  released.resolve();
  assert.equal(await update, 'synthetic-local-update'); await closing;

  const reopened = await Vault.open({ directory: join(f.sourceDirectory, 'main'), passphrase, storage: 'experimental-file' });
  try { assert.deepEqual(reopened.read(), expected); }
  finally { await reopened.close(); }
  assert.equal(f.providerCalls(), 0);
});

test('public volatile sync configuration rolls back if writer admission expires after the setting change', async t => {
  const f = await fixture(t); await f.review();
  const preview = await f.engine.request('sync.preview');
  const approval = await f.engine.request('sync.approve', { id: preview.id });
  await f.engine.request('sync.push', { previewId: preview.id, approvalId: approval.id });

  const receiverDirectory = join(f.directory, 'configuration-receiver-host');
  const bootstrap = f.engineFor(receiverDirectory);
  await bootstrap.request('workspace.create', { name: 'Synthetic Configuration Receiver', passphrase, demo: false, pack: 'ecommerce' });
  const receiverState = bootstrap.vault!.read(), receiverVaultId = bootstrap.vault!.vaultId;
  await bootstrap.close();
  const control = join(f.directory, 'configuration-receiver-writer'); await mkdir(control);
  const receiverDevice = 'synthetic-configuration-receiver-device', keys = generateKeyPairSync('ed25519');
  const admission = new FileSyncWriterAdmission({ directory: control, workspaceId: receiverState.workspace.id,
    vaultId: receiverVaultId, deviceId: receiverDevice, clock: f.clock });
  const receiver = f.engineFor(receiverDirectory, { ...f.sync, writerAdmission: admission,
    deviceId: receiverDevice, signerId: 'synthetic-configuration-receiver-signer', signingKey: keys.privateKey });
  await receiver.request('workspace.open', { folder: 'main', passphrase });
  await f.review(receiver, receiverDevice);
  const receiving = await f.http(receiver), before = receiver.vault!.read();
  const originalRun = admission.run.bind(admission);
  const expireAfterConfiguration = async (method: string, payload: unknown) => {
    // The real file admission keeps its lock and final boundary checks. Advance only
    // after the public setting mutates, before its authority-record publication.
    admission.run = async <T>(input: SyncWriterState, work: (assertCurrent: () => void) => Promise<{ result: T; committedState: State }>): Promise<T> =>
      originalRun(input, async assertCurrent => { const output = await work(assertCurrent); f.advance(60001); return output; });
    try { await receiving.refused(method, payload, 'SYNC_WRITER_EXPIRED'); }
    finally { admission.run = originalRun; }
    assert.deepEqual(receiver.vault!.read(), before);
  };
  await expireAfterConfiguration('sync.enable', { enabled: false });
  assert.equal((await receiving.rpc('sync.status')).enabled, true);
  await f.review(receiver, receiverDevice);

  const replacement = generateKeyPairSync('ed25519');
  await expireAfterConfiguration('sync.trust', { signerId, memberId: 'owner', epoch: 1,
    publicKey: replacement.publicKey.export({ format: 'pem', type: 'spki' }).toString() });
  await f.review(receiver, receiverDevice);
  const staged = await receiving.rpc('sync.pull', { folder: 'configuration-staged-source', passphrase,
    expectedWorkspaceId: f.workspaceId });
  assert.equal(staged.liveAuthorityChanged, false);
  assert.equal(staged.receipt.workspaceId, f.workspaceId);
  assert.equal(receiver.vault!.read().workspace.id, receiverState.workspace.id);
  assert.equal(receiver.vault!.read().facts.length, 0);
  assert.equal(f.transport.publications, 1); assert.equal(f.providerCalls(), 0);
});

test('lost public publication acknowledgment reconciles exact retained metadata without retry or approval reset', async t => {
  const f = await fixture(t); await f.review(); const source = await f.http(f.engine);
  const preview = await source.rpc('sync.preview'), approval = await source.rpc('sync.approve', { id: preview.id });
  f.transport.loseAcknowledgment = true;
  await source.refused('sync.push', { previewId: preview.id, approvalId: approval.id }, 'SYNC_FAILED');
  const state = f.engine.vault!.read(), failed = state.modelReceipts.find(item => item.id === preview.id)!;
  assert.equal(failed.status, 'failed'); assert.equal(failed.remoteOutcome, 'unknown-until-head-reconciliation');
  assert.equal(failed.payloadBase64, undefined); assert.equal(state.modelReceipts.find(item => item.id === approval.id)!.used, true);
  const result = await reconcileSyncPublication(f.transport, { recordHash: failed.recordHash, workspaceId: failed.workspaceId,
    vaultId: failed.vaultId, revision: failed.revision, sequence: failed.sequence, fence: failed.fence, expectedHeadHash: failed.expectedHeadHash });
  assert.equal(result.status, 'published'); assert.equal(result.reason, 'HEAD_MATCH'); assert.equal(result.automaticResubmission, false);
  const readback = await source.rpc('sync.reconcile', { previewId: preview.id });
  assert.equal(readback.status, 'published'); assert.equal(readback.reason, 'HEAD_MATCH');
  assert.equal(readback.automaticResubmission, false); assert.equal(readback.readOnly, true); assert.equal(readback.receiptUpdated, false);
  assert.deepEqual(readback.observedHead, result.observedHead);
  assert.equal(f.transport.publications, 1); assert.deepEqual(f.engine.vault!.read(), state);
  await source.refused('sync.push', { previewId: preview.id, approvalId: approval.id }, 'PREVIEW_NOT_FOUND');
  assert.equal(f.transport.publications, 1); assert.equal(f.engine.vault!.read().modelReceipts.find(item => item.id === approval.id)!.used, true);
  assert.equal(f.providerCalls(), 0);
});
