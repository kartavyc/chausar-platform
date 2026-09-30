import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import { engineJobOptions } from '../runtime/engine-jobs.ts';
import type { Context } from '../runtime/contracts.ts';
import type { ProviderRequest } from '../runtime/job-runner.ts';

// These are labelled synthetic host settings, not published product or spending caps.
const fixturePolicy = { workerId: 'synthetic-engine-fixture', maxActiveJobs: 12, leaseMs: 1000, networkAvailable: () => false };
const passphrase = 'Synthetic-job-fixture-passphrase';
const period = { from: '2026-09-01', to: '2026-09-30' };
const sourceId = 'synthetic-jobs-shop';
function input(source = sourceId, branch = 'main', amount = '2200.00', id = 'invoice-one') {
  return { sourceId: source, format: 'csv',
    content: `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n${id},invoice,2026-09-02,${amount},INR,synthetic-customer,${id},synthetic-order,2026-09-15,unpaid,Synthetic fixture only,${branch}\n`,
    expectedTotals: { rowCount: 1, amountMinor: String(BigInt(amount.replace('.', ''))) },
    recipe: { version: 1, id: 'synthetic-job-shop-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic job shop', branches: [branch] },
      bindings: [
        { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
        ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
        { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
      ], allowedKinds: ['invoice'], allowedStatuses: ['unpaid'], onUnmapped: 'reject',
    },
  };
}
function config(patch: Record<string, unknown> = {}) {
  return { type: 'calculation-set', goal: 'Calculate the explicitly selected synthetic invoice total',
    input: { requests: [{ id: 'invoices', input: { operation: 'billed', period }, reserveMinor: '1', durationMs: 2000 }] },
    sourceIds: [sourceId], budgetMinor: '10', reserveMinor: '2', limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    stopRule: { maxRuns: 1, deadline: new Date(Date.now() + 60000).toISOString() },
    intervalMs: 60000, graceMs: 0, catchup: 'latest', background: false, testedRoutes: [], allowedActions: [], ...patch };
}
async function fixture(t: any, configured = true, jobPolicy = fixturePolicy) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-engine-jobs-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(configured ? { durableJobs: jobPolicy } : {}) });
  t.after(async () => {
    await engine.shutdown(); assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(directory.split(/[\\/]/).at(-1)!.startsWith('chausar-engine-jobs-')); await rm(directory, { recursive: true, force: true });
  });
  await engine.request('workspace.create', { name: 'Synthetic job shop', passphrase, demo: false });
  await engine.request('sources.import', input()); await engine.request('trust.update', { autonomy: true });
  return { engine, directory };
}

test('public HTTP RPC imports synthetic data and delivers real local calculation/evidence/action previews', async t => {
  const { engine } = await fixture(t); const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); });
  async function rpc(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any; assert.equal(response.status, 200, `${method}: ${JSON.stringify(body.error)}`); return body.result;
  }
  // A second source must never contribute to a mandate that names only the first.
  await rpc('sources.import', input('synthetic-other-source', 'main', '9000.00', 'other-invoice'));
  const job = await rpc('jobs.create', config());
  assert.deepEqual((await rpc('jobs.progress', { id: job.id })).remainingStepIds, ['invoices']);
  const delivered = await rpc('jobs.run', { id: job.id }); assert.equal(delivered.status, 'awaiting-acceptance');
  const calculation = delivered.deliverable.result.calculations[0]; assert.equal(calculation.value.valueMinor, '220000');
  const receipt = await rpc('receipts.get', { id: calculation.value.receiptId });
  assert.deepEqual(receipt.sourceIds, [sourceId]); assert.equal(receipt.coverage.completeness, 'reconciled-imports');
  assert.equal(receipt.valueMinor, '220000'); assert.equal(receipt.jobOperation.key, delivered.execution.attempts[0].key);
  assert.equal(delivered.execution.attempts[0].settlement, undefined, 'Intermediate settlements stay behind the release guard.');
  assert.deepEqual((await rpc('jobs.progress', { id: job.id })).remainingStepIds, []);
  const evidence = await rpc('jobs.create', config({ type: 'evidence-review', input: { records: [{ id: 'invoice-proof', input: { receiptId: receipt.id }, reserveMinor: '1', durationMs: 2000 }] } }));
  const reviewed = await rpc('jobs.run', { id: evidence.id }); assert.equal(reviewed.deliverable.result.records[0].informationClass, 'observation');
  assert.equal(reviewed.deliverable.result.records[0].value.receiptId, receipt.id);
  const preparation = await rpc('jobs.create', config({ type: 'action-preparation', allowedActions: ['local.reminder-draft'],
    input: { actions: [{ id: 'reminder', input: { connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'invoice-one', text: 'Synthetic draft only; no recipient or delivery.' } }, reserveMinor: '1', durationMs: 2000 }] } }));
  const prepared = await rpc('jobs.run', { id: preparation.id });
  assert.equal(prepared.deliverable.result.businessSuccess, false);
  const actionId = prepared.deliverable.result.actions[0].value.actionId;
  const action = (await rpc('actions.list')).find((item: any) => item.id === actionId);
  assert.equal(action.status, 'prepared'); assert.equal(action.approval, undefined); assert.equal(action.attempts.length, 0);
  assert.equal(engine.vault!.read().conversations.filter(item => item.kind === 'reminder-draft').length, 0, 'The runner never executes the draft operation.');
  assert.equal((await rpc('jobs.accept', { id: job.id })).status, 'accepted');
  assert.equal((await rpc('jobs.accept', { id: evidence.id })).status, 'accepted');
  assert.equal((await rpc('jobs.accept', { id: preparation.id })).status, 'accepted');
});

test('lost settlement reopens with atomic operation readback and never recalculates the receipt', async t => {
  const { engine } = await fixture(t); const job = await engine.request('jobs.create', config());
  const vault = engine.vault!; const update = vault.update.bind(vault); let fail = true;
  vault.update = change => update(async state => {
    const value = await change(state);
    if (fail && state.jobs.some(item => item.id === job.id && item.execution?.attempts.some((attempt: any) => attempt.status === 'verified'))) { fail = false; throw new Error('Labelled synthetic settlement commit loss'); }
    return value;
  });
  const unresolved = await engine.request('jobs.run', { id: job.id });
  assert.equal(unresolved.status, 'outcome-unknown'); assert.equal(unresolved.reservedMinor, '2');
  const before = vault.read().receipts.filter(item => item.jobOperation?.key === unresolved.execution.attempts[0].key);
  assert.equal(before.length, 1); assert.equal(before[0].jobOperation.settlement.result.value.valueMinor, '220000');
  await engine.request('workspace.lock'); await engine.request('workspace.open', { passphrase });
  const resolved = await engine.request('jobs.reconcile', { id: job.id }); assert.equal(resolved.reservedMinor, '0');
  const completed = await engine.request('jobs.run', { id: job.id }); assert.equal(completed.status, 'awaiting-acceptance');
  assert.equal(completed.deliverable.result.calculations[0].value.receiptId, before[0].id);
  assert.equal(engine.vault!.read().receipts.filter(item => item.jobOperation).length, 1);
  assert.equal(completed.spentMinor, '0'); assert.equal(completed.execution.attempts.length, 1);
  assert.equal(completed.execution.attempts[0].reconciliationId, before[0].id);
});

test('exclusive reopen recovers an interrupted reservation before any scheduler dispatch', async t => {
  const { engine } = await fixture(t); const job = await engine.request('jobs.create', config());
  await engine.services.jobs.acquire(engine.context, job.id, 'synthetic-crashed-worker', 1000);
  assert.equal(engine.vault!.read().jobs[0].status, 'running');
  await engine.request('workspace.lock'); await engine.request('workspace.open', { passphrase });
  const reopened = (await engine.request('jobs.list'))[0]; assert.equal(reopened.status, 'scheduled'); assert.equal(reopened.reservedMinor, '0');
  assert.ok(reopened.ledger.some((item: any) => item.event === 'process-interrupted'));
  assert.deepEqual(await engine.tick(), [], 'Unknown host lifecycle never dispatches after reopening.');
  assert.equal((await engine.request('jobs.run', { id: job.id })).status, 'awaiting-acceptance');
});

test('scheduler uses pinned scoped owners, truthful lifecycle and private result release', async t => {
  const { engine } = await fixture(t);
  const member = await engine.request('members.add', { name: 'Synthetic main cofounder', role: 'cofounder', branches: ['main'] });
  const ownerContext: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
  const job = await engine.requestAs(ownerContext, 'jobs.create', config({ goal: 'Private synthetic cofounder invoice analysis' }));
  await assert.rejects(engine.request('jobs.run', { id: job.id }), { code: 'JOB_OWNER_REQUIRED' });
  await assert.rejects(engine.requestAs({ ...ownerContext, channel: 'phone' }, 'jobs.create', config()), { code: 'APP_APPROVAL_REQUIRED' });
  assert.deepEqual(await engine.tick(), []);
  engine.updateJobLifecycle({ awake: false, windowOpen: true, backgroundEnabled: false }); assert.deepEqual(await engine.tick(), []);
  engine.updateJobLifecycle({ awake: true, windowOpen: false, backgroundEnabled: false }); assert.deepEqual(await engine.tick(), []);
  engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  assert.deepEqual(await engine.tick(), [{ id: job.id, status: 'awaiting-acceptance' }]);
  assert.deepEqual(await engine.request('jobs.list'), []);
  const scoped = (await engine.requestAs(ownerContext, 'jobs.list'))[0];
  assert.equal(scoped.deliverable.result.calculations[0].value.valueMinor, '220000');
  await engine.request('trust.update', { allowedSources: [] });
  await assert.rejects(engine.requestAs(ownerContext, 'jobs.accept', { id: job.id }), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(await engine.requestAs(ownerContext, 'jobs.list'), []);
});

test('typed amendment and cancellation use public RPC and fence the exact objective', async t => {
  const { engine } = await fixture(t); const job = await engine.request('jobs.create', config());
  const amended = await engine.request('jobs.amend', { id: job.id, config: config({ goal: 'Review synthetic receivable aging', input: { requests: [{ id: 'aging', input: { operation: 'aging', onDate: '2026-09-30' }, reserveMinor: '1', durationMs: 2000 }] } }) });
  assert.equal(amended.revision, 2); assert.equal(amended.status, 'paused');
  await engine.request('jobs.resume', { id: job.id });
  const done = await engine.request('jobs.run', { id: job.id }); assert.equal(done.deliverable.objectiveRevision, 2);
  assert.equal(done.deliverable.result.calculations[0].value.operation, 'aging');
  const other = await engine.request('jobs.create', config());
  assert.equal((await engine.request('jobs.cancel', { id: other.id })).status, 'cancelled');
  assert.equal((await engine.request('jobs.run', { id: other.id })).status, 'cancelled');
  assert.equal(engine.vault!.read().receipts.filter(item => item.jobOperation).length, 1);
});

test('acceptance checks the release guard inside the same serialized transaction', async t => {
  const { engine } = await fixture(t); const job = await engine.request('jobs.create', config());
  await engine.request('jobs.run', { id: job.id });
  const update = engine.vault!.update.bind(engine.vault!); let changed = false;
  // Inject a committed evidence change between Engine preflight and JobService's queued mutation.
  engine.vault!.update = async change => {
    if (!changed) { changed = true; await update(state => { for (const item of state.receipts) item.stale = true; }); }
    return update(change);
  };
  await assert.rejects(engine.request('jobs.accept', { id: job.id }), { code: 'JOB_EVIDENCE_REVOKED' });
  assert.equal(engine.vault!.read().jobs[0].status, 'awaiting-acceptance');
  assert.equal((await engine.request('jobs.list'))[0].deliverable, undefined);
});

test('explicit job policy is required through Engine and process entry points', async t => {
  const { engine } = await fixture(t, false);
  assert.equal((await engine.request('jobs.types')).configured, false);
  await assert.rejects(engine.request('jobs.create', config()), { code: 'JOB_POLICY_REQUIRED' });
  assert.equal(engineJobOptions({}), undefined);
  assert.throws(() => engineJobOptions({ CHAUSAR_JOB_WORKER_ID: 'synthetic' }), { code: 'INVALID_JOB_RUNNER' });
  assert.equal(engineJobOptions({ CHAUSAR_JOB_WORKER_ID: 'synthetic', CHAUSAR_JOB_MAX_ACTIVE: '3', CHAUSAR_JOB_LEASE_MS: '1000' })!.maxActiveJobs, 3);
});

test('configured active ceilings are enforced through Engine and cancellation frees resolved capacity', async t => {
  const { engine } = await fixture(t, true, { ...fixturePolicy, maxActiveJobs: 1 });
  const first = await engine.request('jobs.create', config());
  await assert.rejects(engine.request('jobs.create', config()), { code: 'ACTIVE_JOB_LIMIT' });
  await assert.rejects(engine.request('jobs.create', config({ type: 'owner-brief' })), { code: 'ACTIVE_JOB_LIMIT' });
  await engine.request('jobs.cancel', { id: first.id });
  assert.equal((await engine.request('jobs.create', config())).status, 'scheduled');
});

test('stalled provider readback is bounded, keeps uncertainty and never redispatches', async t => {
  const { engine } = await fixture(t); const runner = engine.services.jobRunner;
  const provider = runner.providers.get('local-calculation'); let dispatches = 0; let signal: AbortSignal | undefined;
  provider.dispatch = async () => { dispatches++; throw new Error('Labelled synthetic acknowledgement loss'); };
  provider.reconcile = async (request: ProviderRequest) => { signal = request.signal; return new Promise(() => {}); };
  const job = await engine.request('jobs.create', config({ input: { requests: [{ id: 'invoices', input: { operation: 'billed', period }, reserveMinor: '1', durationMs: 100 }] } }));
  assert.equal((await engine.request('jobs.run', { id: job.id })).status, 'outcome-unknown');
  await assert.rejects(engine.request('jobs.reconcile', { id: job.id }), { code: 'JOB_READBACK_TIMEOUT' });
  assert.equal(signal!.aborted, true); const saved = engine.vault!.read().jobs[0];
  assert.equal(saved.status, 'outcome-unknown'); assert.equal(saved.reservedMinor, '2'); assert.equal(saved.spentMinor, '0');
  assert.equal((await engine.request('jobs.run', { id: job.id })).status, 'outcome-unknown'); assert.equal(dispatches, 1);
});

test('cancellation and shutdown drain a stalled admitted provider without releasing uncertain capacity', async t => {
  const { engine } = await fixture(t); const runner = engine.services.jobRunner;
  const provider = runner.providers.get('local-calculation'); let entered!: () => void; let signal: AbortSignal | undefined;
  let start = new Promise<void>(accept => { entered = accept; });
  provider.dispatch = async (request: ProviderRequest) => { signal = request.signal; entered(); return new Promise((_accept, refuse) => { request.signal.addEventListener('abort', () => refuse(new Error('Labelled synthetic provider honoured cancellation')), { once: true }); }); };
  const job = await engine.request('jobs.create', config()); const run = engine.request('jobs.run', { id: job.id }); await start;
  assert.equal((await engine.request('jobs.cancel', { id: job.id })).status, 'cancelled');
  assert.equal((await run).status, 'cancelled'); assert.equal(signal!.aborted, true);
  assert.equal(engine.vault!.read().jobs[0].reservedMinor, '2');
  start = new Promise<void>(accept => { entered = accept; });
  const next = await engine.request('jobs.create', config()); const pending = engine.request('jobs.run', { id: next.id }); await start;
  await assert.rejects(engine.close(), { code: 'VAULT_BUSY' });
  const stopping = engine.shutdown(); assert.equal((await pending).status, 'outcome-unknown'); await stopping;
  assert.equal(engine.vault, null); assert.equal(signal!.aborted, true);
  const reopened = new Engine({ directory: engine.options.directory, demo: true, storage: 'experimental-file', durableJobs: fixturePolicy });
  try {
    await reopened.request('workspace.open', { passphrase });
    const held = (await reopened.request('jobs.list')).find((item: any) => item.id === next.id);
    assert.equal(held.status, 'outcome-unknown'); assert.equal(held.reservedMinor, '2');
  } finally { await reopened.shutdown(); }
});

test('local HTTP shutdown interrupts an admitted RPC before waiting for HTTP draining', async t => {
  const { engine } = await fixture(t); const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { if (app.server.listening) await app.close(); });
  let entered!: () => void; const start = new Promise<void>(accept => { entered = accept; });
  engine.services.jobRunner.providers.get('local-calculation').dispatch = async () => { entered(); return new Promise(() => {}); };
  const job = await engine.request('jobs.create', config());
  const rpc = fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method: 'jobs.run', payload: { id: job.id } }) });
  await start; const closing = app.close(1000);
  const response = await rpc; assert.equal(response.status, 200);
  assert.equal((await response.json() as any).result.status, 'outcome-unknown');
  await closing; assert.equal(engine.vault, null); assert.equal(app.server.listening, false);
});

test('an over-duration local calculation cannot persist an unreconcilable settlement', async t => {
  const { engine } = await fixture(t); const job = await engine.request('jobs.create', config());
  const real = Date.now(); let calls = 0;
  const clock = t.mock.method(Date, 'now', () => real + (calls++ === 0 ? 0 : 2001));
  const unresolved = await engine.request('jobs.run', { id: job.id }); clock.mock.restore();
  assert.equal(unresolved.status, 'outcome-unknown');
  assert.equal(unresolved.execution.attempts[0].reason, 'JOB_STEP_EXCEEDS_LIMITS');
  assert.equal(engine.vault!.read().receipts.length, 0, 'The receipt and invalid operation settlement roll back together.');
  const readback = await engine.request('jobs.reconcile', { id: job.id });
  assert.equal(readback.status, 'paused'); assert.equal(readback.reservedMinor, '0'); assert.equal(readback.spentMinor, '0');
  assert.equal(readback.execution.attempts[0].status, 'absent');
});
