import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State } from '../runtime/contracts.ts';
import { InvoiceFollowUpHost, invoiceConnectorId, type InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import { invoiceDeliveryTombstone, invoiceOperationTombstone, invoiceOperationalTombstone,
  invoiceMandateTombstone, prepareInvoicePurge, rememberInvoiceDelivery, rememberInvoiceOperation } from '../runtime/invoice-follow-up-lineage.ts';
import type { PreparedAction } from '../runtime/actions.ts';
import type { Job } from '../runtime/jobs.ts';
import type { ProviderSettlement } from '../runtime/job-protocol.ts';
import { customerId, invoiceId, InvoiceFixtureStore, owner, seedInvoiceFixture, sourceIds } from './invoice-follow-up.fixture.ts';

// Supplemental synthetic transaction tests. The purge suite exercises the
// authorized Trust joins; these cases isolate atomic opaque marker retention.
const options = (store: InvoiceFixtureStore): InvoiceHostOptions => ({ clock: store.clock,
  workerId: 'synthetic-invoice-tombstone-worker', maxActiveJobs: 8, leaseMs: 1000,
  approvalTtlMs: 60000, dailyCap: 5, perCustomerDailyCap: 1, stopWord: 'STOP',
  dayKey: instant => new Date(instant).toISOString().slice(0, 10),
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20' });
const hostFor = (store: InvoiceFixtureStore) => new InvoiceFollowUpHost(store, options(store));
const call = <T>(host: InvoiceFollowUpHost, method: string, input: unknown = {}, context: Context = owner) =>
  host.dispatch(context, `invoiceFollowUp.${method}`, input) as Promise<T>;
const records = (state: State, kind: string) => state.answers.filter(record => record.kind === kind);
const markers = (state: State) => state.tombstones.filter(invoiceOperationalTombstone);
const storedJob = (store: InvoiceFixtureStore, id: string): Job => store.read().jobs.find(job => job.id === id);
function opaque(marker: Record<string, unknown>) {
  assert.match(String(marker.identity), /^[a-f0-9]{64}$/);
  for (const name of ['key', 'id', 'sourceId', 'sourceIds', 'factIds', 'invoiceId', 'customerId', 'jobId', 'actionId', 'payload', 'text', 'settlement']) {
    assert.equal(Object.hasOwn(marker, name), false, `Opaque marker retains ${name}`);
  }
  assert.doesNotMatch(JSON.stringify(marker), /invoice-one|customer-one|synthetic-books|synthetic-bank|synthetic-invoice:|synthetic-customer:|"7500"|"10000"|75\.00/);
}
async function fixture() {
  const store = await seedInvoiceFixture(), host = hostFor(store), at = new Date(store.clock()).toISOString();
  await call(host, 'consent.record', { requestId: 'synthetic-marker-opt-in', customerId, channel: 'simulation',
    destination: 'synthetic-customer:one', status: 'yes', sourceId: sourceIds[0], evidence: 'Synthetic opt-in', at });
  const job = await call<Job>(host, 'create', { ownerId: owner.memberId,
    goal: 'Review synthetic invoice proof and resolve an individually approved reminder', budgetMinor: '500', reserveMinor: '20',
    sourceIds, requiresApproval: false, stopRule: { maxRuns: 3, deadline: '2026-10-08T12:00:00.000Z' },
    nextRunAt: at, intervalMs: 86400000, catchup: 'latest', graceMs: 0,
    limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    allowedActions: [`${invoiceConnectorId}.send`], testedRoutes: [], background: false,
    input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:one' }],
      acceptanceTest: 'Show receipt proof and resolve the individual reminder without treating sent as paid.',
      reviewAt: '2026-10-07T12:00:00.000Z', calculation: { reserveMinor: '10', durationMs: 2000 },
      preparation: { reserveMinor: '10', durationMs: 2000 } } });
  return { store, host, job };
}
async function prepared() {
  const f = await fixture(); assert.equal((await call<Job>(f.host, 'run', { id: f.job.id })).status, 'awaiting-acceptance');
  const action = f.store.read().actions[0] as PreparedAction;
  await call(f.host, 'reminder.approve', { id: action.id, digest: action.digest });
  return { ...f, action };
}

test('invoice opaque operation marker and proof roll back together when their provider commit fails', async () => {
  const f = await fixture(); let checked = false;
  f.store.failBeforeCommit = draft => {
    const operation = records(draft, 'invoice-job-operation-v1').find(record => record.key.endsWith(':step:balance-0'));
    if (!operation || checked) return;
    checked = true; f.store.failBeforeCommit = undefined;
    assert.ok(invoiceOperationTombstone(draft, operation.key)); assert.equal(draft.receipts.length, 1);
    assert.equal(records(draft, 'invoice-balance-proof-v1').length, 1);
    throw new Error('Labelled synthetic rejection before invoice marker/proof commit.');
  };
  const unknown = await call<Job>(f.host, 'run', { id: f.job.id });
  assert.equal(checked, true); assert.equal(unknown.status, 'outcome-unknown');
  const saved = f.store.read(); assert.equal(saved.receipts.length, 0);
  assert.equal(records(saved, 'invoice-balance-proof-v1').length, 0);
  assert.equal(records(saved, 'invoice-job-operation-v1').length, 0); assert.equal(markers(saved).length, 0);
  const readback = await call<Job>(f.host, 'reconcile', { id: f.job.id });
  assert.equal(readback.status, 'paused'); assert.equal(readback.spentMinor, '0'); assert.equal(readback.reservedMinor, '0');
  assert.equal(readback.execution!.attempts[0].status, 'absent');
});

test('invoice lost provider response retains one opaque marker and exact proof pins remain valid through readback and delivery', async () => {
  const f = await fixture(); let committed: State | undefined;
  f.store.afterCommit = state => {
    if (records(state, 'invoice-job-operation-v1').length !== 1) return;
    committed = state; f.store.afterCommit = undefined;
    const operation = records(state, 'invoice-job-operation-v1')[0], marker = invoiceOperationTombstone(state, operation.key);
    assert.ok(marker); assert.equal(marker.requestDigest, operation.requestDigest); assert.equal(marker.spentMinor, '1'); opaque(marker);
    throw new Error('Labelled synthetic response loss after atomic invoice operation commit.');
  };
  const unknown = await call<Job>(f.host, 'run', { id: f.job.id });
  assert.ok(committed); assert.equal(unknown.status, 'outcome-unknown');
  assert.equal(unknown.spentMinor, '0'); assert.equal(unknown.reservedMinor, '20');
  const originalProof = records(committed, 'invoice-balance-proof-v1')[0];
  const operation = records(committed, 'invoice-job-operation-v1')[0];
  assert.equal(typeof operation.settlement.result.value.proofDigest, 'string');
  const copy = f.store.restart(), host = hostFor(copy); await call(host, 'recover');
  const reconciled = await call<Job>(host, 'reconcile', { id: f.job.id });
  assert.equal(reconciled.spentMinor, '1'); assert.equal(reconciled.reservedMinor, '0');
  const completed = await call<Job>(host, 'run', { id: f.job.id });
  assert.equal(completed.status, 'awaiting-acceptance'); assert.equal(completed.spentMinor, '2');
  assert.equal(copy.read().receipts.length, 1); assert.equal(records(copy.read(), 'invoice-job-operation-v1').length, 2);
  assert.deepEqual(records(copy.read(), 'invoice-balance-proof-v1')[0], originalProof);
  assert.equal(host.runner.canRelease(owner, storedJob(copy, f.job.id)), true);
  const action = copy.read().actions[0] as PreparedAction, pinnedPayload = structuredClone(action.payload), pinnedDigest = action.digest;
  await call(host, 'reminder.approve', { id: action.id, digest: action.digest });
  const sent = await call<PreparedAction>(host, 'reminder.execute', { id: action.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.businessSuccess, false);
  assert.deepEqual(sent.payload, pinnedPayload); assert.equal(sent.digest, pinnedDigest);
  assert.deepEqual(records(copy.read(), 'invoice-balance-proof-v1')[0], originalProof);
  assert.equal(host.runner.canRelease(owner, storedJob(copy, f.job.id)), true);
  assert.equal(markers(copy.read()).length, 3); for (const marker of markers(copy.read())) opaque(marker);
  assert.equal((await call<Job>(host, 'accept', { id: f.job.id })).status, 'accepted');
});

test('invoice delivery reservation and opaque marker have one atomic commit boundary', async () => {
  const f = await prepared(); let checked = false;
  f.store.failBeforeCommit = state => {
    const delivery = records(state, 'invoice-simulated-delivery-v1')[0]; if (!delivery || checked) return;
    checked = true; f.store.failBeforeCommit = undefined;
    const marker = invoiceDeliveryTombstone(state, delivery.key); assert.ok(marker); assert.equal(marker.outcome, 'reserved');
    assert.equal(marker.payloadDigest, delivery.payloadDigest); opaque(marker);
    assert.equal(state.jobs.find(job => job.id === f.job.id).reservedMinor, '20');
    throw new Error('Labelled synthetic rejection before delivery reservation/marker commit.');
  };
  await assert.rejects(call(f.host, 'reminder.execute', { id: f.action.id }), /reservation\/marker commit/);
  assert.equal(checked, true); const saved = f.store.read();
  assert.equal(records(saved, 'invoice-simulated-delivery-v1').length, 0);
  assert.equal(invoiceDeliveryTombstone(saved, f.action.idempotencyKey), undefined);
  assert.equal(saved.actions[0].attempts.length, 0); assert.equal(storedJob(f.store, f.job.id).reservedMinor, '0');
  assert.equal(storedJob(f.store, f.job.id).spentMinor, '2');
  const sent = await call<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.attempts.length, 1);
  assert.equal(invoiceDeliveryTombstone(f.store.read(), f.action.idempotencyKey).outcome, 'sent');
});

test('invoice failed sent commit preserves known absence and updates the retained opaque delivery marker without charging', async () => {
  const f = await prepared(); let checked = false;
  f.store.failBeforeCommit = state => {
    const delivery = records(state, 'invoice-simulated-delivery-v1')[0]; if (delivery?.status !== 'sent' || checked) return;
    checked = true; f.store.failBeforeCommit = undefined;
    assert.equal(invoiceDeliveryTombstone(state, delivery.key).outcome, 'sent');
    assert.equal(state.jobs.find(job => job.id === f.job.id).spentMinor, '22');
    throw new Error('Labelled synthetic rejection before sent effect/marker commit.');
  };
  const uncertain = await call<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(checked, true); assert.equal(uncertain.status, 'unknown');
  const saved = f.store.read(), marker = invoiceDeliveryTombstone(saved, f.action.idempotencyKey);
  assert.equal(records(saved, 'invoice-simulated-delivery-v1')[0].status, 'not-sent');
  assert.equal(marker.outcome, 'not-sent'); opaque(marker);
  assert.equal(storedJob(f.store, f.job.id).spentMinor, '2'); assert.equal(storedJob(f.store, f.job.id).reservedMinor, '0');
  assert.equal(storedJob(f.store, f.job.id).ledger.filter(entry => entry.event === 'invoice-sent').length, 0);
  const rejected = await call<PreparedAction>(f.host, 'reminder.reconcile', { id: f.action.id });
  assert.equal(rejected.status, 'rejected'); assert.equal(rejected.readback?.absent, true);
  assert.equal(invoiceDeliveryTombstone(f.store.read(), f.action.idempotencyKey).identity, marker.identity);
});

test('invoice erased operation payload keeps uncertain exposure and its committed key refuses re-dispatch', async () => {
  const f = await fixture(); let committed: State | undefined;
  f.store.afterCommit = state => {
    if (!records(state, 'invoice-job-operation-v1').length) return;
    committed = state; f.store.afterCommit = undefined;
    throw new Error('Labelled synthetic loss before runner settlement.');
  };
  await call(f.host, 'run', { id: f.job.id }); assert.ok(committed);
  const record = records(committed, 'invoice-job-operation-v1')[0];
  committed.answers = committed.answers.filter(answer => answer.kind !== 'invoice-job-operation-v1');
  const marker = invoiceOperationTombstone(committed, record.key); assert.ok(marker); opaque(marker);
  const restored = new InvoiceFixtureStore(committed, f.store.clock()), host = hostFor(restored);
  await call(host, 'recover'); const unknown = await call<Job>(host, 'reconcile', { id: f.job.id });
  assert.equal(unknown.status, 'outcome-unknown'); assert.equal(unknown.reservedMinor, '20'); assert.equal(unknown.spentMinor, '0');
  assert.equal(unknown.execution!.attempts[0].status, 'unknown');

  // Re-create the original admitted dispatch snapshot, including its exact
  // persisted attempt, to prove the trusted provider cannot recreate the key.
  const dispatchStore = new InvoiceFixtureStore(committed, f.store.clock()), dispatchHost = hostFor(dispatchStore);
  const provider = dispatchHost.runner.providers.get('invoice-local-preparation')!;
  assert.equal(provider.kind, 'read-only'); if (provider.kind !== 'read-only') throw new Error('Expected local invoice provider.');
  const execution = dispatchStore.read().jobs.find(job => job.id === f.job.id).execution;
  await assert.rejects(provider.dispatch({ key: record.key, step: execution.plan.steps[0], context: owner,
    signal: new AbortController().signal, inputs: {} }), { code: 'INVOICE_OPERATION_ERASED' });
  assert.equal(dispatchStore.read().receipts.length, 1); assert.equal(records(dispatchStore.read(), 'invoice-job-operation-v1').length, 0);
  assert.deepEqual(invoiceOperationTombstone(dispatchStore.read(), record.key), marker);
});

const syntheticDelivery = { key: 'synthetic-delivery-key-one', payloadDigest: 'a'.repeat(64), status: 'reserved',
  costMinor: '20', at: '2026-10-01T11:59:00.000Z' };

test('invoice opaque delivery marker keeps sent consumption when an older reservation is replayed', () => {
  const state = initialState('Synthetic monotonic delivery markers', true);
  rememberInvoiceDelivery(state, syntheticDelivery);
  rememberInvoiceDelivery(state, { ...syntheticDelivery, status: 'sent', sentAt: '2026-10-01T12:00:00.000Z' });
  const sent = structuredClone(invoiceDeliveryTombstone(state, syntheticDelivery.key));
  rememberInvoiceDelivery(state, syntheticDelivery);
  assert.deepEqual(invoiceDeliveryTombstone(state, syntheticDelivery.key), sent);
  assert.equal(sent.outcome, 'sent'); assert.equal(sent.costMinor, '20');
  assert.equal(markers(state).length, 1); opaque(sent);
});

test('invoice opaque delivery marker refuses contradictory terminal outcomes', () => {
  const state = initialState('Synthetic conflicting delivery markers', true);
  rememberInvoiceDelivery(state, { ...syntheticDelivery, status: 'sent' });
  const sent = structuredClone(invoiceDeliveryTombstone(state, syntheticDelivery.key));
  assert.throws(() => rememberInvoiceDelivery(state, { ...syntheticDelivery, status: 'not-sent' }), { code: 'INVOICE_DELIVERY_CONFLICT' });
  assert.deepEqual(invoiceDeliveryTombstone(state, syntheticDelivery.key), sent);
  const absent = initialState('Synthetic conflicting absence markers', true);
  rememberInvoiceDelivery(absent, { ...syntheticDelivery, status: 'not-sent' });
  assert.throws(() => rememberInvoiceDelivery(absent, { ...syntheticDelivery, status: 'sent' }), { code: 'INVOICE_DELIVERY_CONFLICT' });
  assert.equal(invoiceDeliveryTombstone(absent, syntheticDelivery.key).outcome, 'not-sent');
});

test('invoice opaque delivery marker refuses a changed cost under the same key and payload digest', () => {
  const state = initialState('Synthetic immutable delivery cost', true);
  rememberInvoiceDelivery(state, syntheticDelivery);
  const original = structuredClone(invoiceDeliveryTombstone(state, syntheticDelivery.key));
  assert.throws(() => rememberInvoiceDelivery(state, { ...syntheticDelivery, costMinor: '21' }), { code: 'INVOICE_DELIVERY_CONFLICT' });
  assert.deepEqual(invoiceDeliveryTombstone(state, syntheticDelivery.key), original);
});

test('invoice opaque operation marker refuses changed settlement cost even when the request digest is unchanged', () => {
  const state = initialState('Synthetic immutable operation cost', true), key = 'synthetic-operation-key-one', requestDigest = 'b'.repeat(64);
  const settlement: ProviderSettlement = { result: { value: { mode: 'simulation' }, informationClass: 'observation',
    evidenceIds: ['synthetic-proof'], sourceTainted: true }, spentMinor: '1', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' };
  rememberInvoiceOperation(state, key, requestDigest, settlement, '2026-10-01T12:00:00.000Z');
  const original = structuredClone(invoiceOperationTombstone(state, key));
  assert.throws(() => rememberInvoiceOperation(state, key, requestDigest, { ...settlement, spentMinor: '2' },
    '2026-10-01T12:01:00.000Z'), { code: 'JOB_OPERATION_CONFLICT' });
  assert.deepEqual(invoiceOperationTombstone(state, key), original); assert.equal(markers(state).length, 1); opaque(original);
});

test('invoice repeated purge of a restored whole older snapshot preserves established opaque accounting', async () => {
  const f = await fixture(), previous = f.store.snapshot();
  assert.equal(previous.jobs[0].spentMinor, '0'); assert.equal(previous.jobs[0].status, 'scheduled');
  await call(f.host, 'run', { id: f.job.id }); const action = f.store.read().actions[0] as PreparedAction;
  await call(f.host, 'reminder.approve', { id: action.id, digest: action.digest });
  await call(f.host, 'reminder.execute', { id: action.id });
  assert.equal(storedJob(f.store, f.job.id).spentMinor, '22');
  const at = new Date(f.store.clock()).toISOString();
  await f.store.update(state => prepareInvoicePurge(state, { sourceId: sourceIds[0] }, at));
  const purged = f.store.read(), established = structuredClone(invoiceMandateTombstone(purged, f.job.id));
  assert.equal(purged.jobs.length, 0); assert.equal(established.spentMinor, '22'); assert.equal(established.reservedMinor, '0');
  opaque(established);

  // The owner restores the whole prior payload snapshot while preserving the
  // separately retained purge markers before any recovery or scheduling.
  previous.tombstones = structuredClone(purged.tombstones);
  const restored = new InvoiceFixtureStore(previous, f.store.clock());
  assert.equal(restored.read().jobs[0].spentMinor, '0');
  const repeated = await restored.update(state => prepareInvoicePurge(state, { sourceId: sourceIds[0] },
    new Date(restored.clock() + 60000).toISOString()));
  assert.equal(repeated.mandatesRemoved, 1); assert.equal(restored.read().jobs.length, 0);
  assert.deepEqual(invoiceMandateTombstone(restored.read(), f.job.id), established);
  assert.equal(restored.read().actions.length, 0);
  assert.equal(records(restored.read(), 'invoice-job-operation-v1').length, 0);
  const host = hostFor(restored); assert.deepEqual(await call(host, 'recover'), { recovered: [] });
  assert.deepEqual(await call(host, 'tick', { awake: true, windowOpen: true, backgroundEnabled: false }), []);
  assert.deepEqual(invoiceMandateTombstone(restored.read(), f.job.id), established);
});

test('invoice restored purged never-run mandate is refused through public and job APIs and skipped by tick', async () => {
  const f = await fixture(), previous = f.store.snapshot(), at = new Date(f.store.clock()).toISOString();
  assert.equal(previous.jobs[0].status, 'scheduled'); assert.equal(previous.jobs[0].runs, 0);
  await f.store.update(state => prepareInvoicePurge(state, { sourceId: sourceIds[0] }, at));
  assert.equal(f.store.read().jobs.length, 0);
  previous.tombstones = structuredClone(f.store.read().tombstones);
  const restored = new InvoiceFixtureStore(previous, f.store.clock()), host = hostFor(restored);
  const marker = invoiceMandateTombstone(restored.read(), f.job.id); assert.ok(marker); opaque(marker);
  await assert.rejects(call(host, 'read', { id: f.job.id }), { code: 'INVOICE_MANDATE_ERASED' });
  await assert.rejects(call(host, 'run', { id: f.job.id }), { code: 'INVOICE_MANDATE_ERASED' });
  await assert.rejects(host.runner.run(owner, f.job.id), { code: 'INVOICE_MANDATE_ERASED' });
  assert.throws(() => host.jobs.find(restored.read(), f.job.id), { code: 'INVOICE_MANDATE_ERASED' });
  assert.deepEqual(host.jobs.list(owner), []);
  assert.deepEqual(await call(host, 'tick', { awake: true, windowOpen: true, backgroundEnabled: false }), []);
  const saved = restored.read(); assert.equal(saved.jobs[0].status, 'scheduled'); assert.equal(saved.jobs[0].runs, 0);
  assert.equal(saved.jobs[0].spentMinor, '0'); assert.equal(saved.jobs[0].reservedMinor, '0');
  assert.equal(saved.jobs[0].lease, undefined); assert.equal(saved.jobs[0].execution, undefined);
  assert.equal(saved.receipts.length, 0); assert.equal(saved.actions.length, 0);
  assert.equal(records(saved, 'invoice-job-operation-v1').length, 0); assert.equal(markers(saved).length, 1);
});
