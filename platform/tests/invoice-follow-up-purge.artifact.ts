import assert from 'node:assert/strict';
import { digest, type PreparedAction } from '../runtime/actions.ts';
import type { State } from '../runtime/contracts.ts';
import { InvoiceFollowUpHost, invoiceConnectorId, type InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import { invoiceOperationalTombstone, prepareInvoicePurge } from '../runtime/invoice-follow-up-lineage.ts';
import type { Job, JobConfig } from '../runtime/jobs.ts';
import { TrustService } from '../runtime/trust.ts';
import { customerId, invoiceId, InvoiceFixtureStore, owner, seedInvoiceFixture, sourceIds, syntheticNow } from './invoice-follow-up.fixture.ts';

// Runnable source-contract evidence only. All state, costs and delivery are
// synthetic; this does not qualify the shared Engine/Trust/Vault purge join.
const dayMs = 86400000;
const derivedKinds = ['invoice-balance-proof-v1', 'invoice-job-operation-v1', 'invoice-reminder-approval-v1',
  'invoice-simulated-delivery-v1', 'invoice-paid-v1'];
const records = (state: State, kind: string) => state.answers.filter(answer => answer.kind === kind);
const iso = (store: InvoiceFixtureStore) => new Date(store.clock()).toISOString();
const options = (store: InvoiceFixtureStore): InvoiceHostOptions => ({
  clock: store.clock, workerId: 'synthetic-invoice-purge-worker', maxActiveJobs: 8, leaseMs: 1000,
  approvalTtlMs: 60000, dailyCap: 10, perCustomerDailyCap: 10,
  dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20',
});
const hostFor = (store: InvoiceFixtureStore) => new InvoiceFollowUpHost(store, options(store));
const call = <T = unknown>(host: InvoiceFollowUpHost, method: string, request: unknown = {}) =>
  host.dispatch(owner, `invoiceFollowUp.${method}`, request) as Promise<T>;
const counts = (state: State) => ({
  derivedPayloads: state.answers.filter(answer => derivedKinds.includes(answer.kind)).length,
  mandates: state.jobs.filter(job => job.type === 'invoice-follow-up').length,
  previews: state.actions.filter(action => action.connector === invoiceConnectorId).length,
});
function opaque(marker: Record<string, any>) {
  assert.match(marker.identity, /^[a-f0-9]{64}$/);
  for (const field of ['id', 'key', 'sourceId', 'sourceIds', 'factIds', 'invoiceId', 'customerId', 'jobId',
    'actionId', 'proofId', 'payload', 'text', 'settlement']) assert.equal(Object.hasOwn(marker, field), false);
  const serialized = JSON.stringify(marker);
  for (const value of [invoiceId, customerId, ...sourceIds, 'synthetic-invoice:purge-test', '7500', '10000'])
    assert.equal(serialized.includes(value), false);
}
async function fixture(oldFacts = false) {
  const store = await seedInvoiceFixture(new InvoiceFixtureStore(undefined, oldFacts ? syntheticNow - 2 * dayMs : syntheticNow));
  if (oldFacts) store.advance(2 * dayMs);
  const host = hostFor(store), trust = new TrustService(store);
  await trust.updatePolicy(owner, { retentionDays: 1 });
  await call(host, 'consent.record', { requestId: 'synthetic-purge-opt-in', customerId, channel: 'simulation',
    destination: 'synthetic-customer:purge-test', status: 'yes', sourceId: sourceIds[0],
    evidence: 'Synthetic affirmative customer opt-in for purge regression.', at: iso(store) });
  const config: JobConfig = {
    ownerId: owner.memberId, goal: 'Review the synthetic invoice with retained proof and individually approve its reminder',
    budgetMinor: '500', reserveMinor: '20', sourceIds: [...sourceIds], requiresApproval: false,
    stopRule: { maxRuns: 3, deadline: new Date(store.clock() + 7 * dayMs).toISOString() },
    nextRunAt: iso(store), intervalMs: 60000, catchup: 'latest', graceMs: 0,
    limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
    allowedActions: [`${invoiceConnectorId}.send`], testedRoutes: [], background: false,
    input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:purge-test' }],
      acceptanceTest: 'Review exact source evidence and resolve each reminder separately from payment.',
      reviewAt: new Date(store.clock() + dayMs).toISOString(),
      calculation: { reserveMinor: '10', durationMs: 2000 }, preparation: { reserveMinor: '10', durationMs: 2000 } },
  };
  const job = await call<Job>(host, 'create', config);
  return { store, host, trust, job };
}

const sent = await fixture();
assert.equal((await call<Job>(sent.host, 'run', { id: sent.job.id })).status, 'awaiting-acceptance');
const action = sent.store.read().actions[0] as PreparedAction;
await call(sent.host, 'reminder.approve', { id: action.id, digest: action.digest });
assert.equal((await call<PreparedAction>(sent.host, 'reminder.execute', { id: action.id })).status, 'verified');
// Reconstruct only the original operation journals' missing lineage. Proofs,
// approval pins and exact previews remain unchanged in this cloned fixture.
const legacy = new InvoiceFixtureStore(sent.store.snapshot(), sent.store.clock());
await legacy.update(state => {
  for (const operation of records(state, 'invoice-job-operation-v1')) {
    delete operation.sourceIds; delete operation.factIds; delete operation.at;
    delete operation.settlement.result.value.sourceIds;
    delete operation.settlement.result.value.factIds;
    delete operation.settlement.result.value.at;
  }
});
const joined = legacy.restart(), beforeJoined = counts(joined.read());
// These legacy payloads exist before the mandatory Trust purge, not afterward.
// The original unjoined failure is preserved in its historical checkpoint.
const residue = records(joined.read(), 'invoice-job-operation-v1');
assert.equal(residue.length, 2);
const balance = residue.find(record => record.key.endsWith(':step:balance-0'))!.settlement.result.value;
const preparation = residue.find(record => record.key.endsWith(':step:prepare-0'))!.settlement.result.value;
assert.deepEqual({ outstandingMinor: balance.outstandingMinor, collectedMinor: balance.collectedMinor, outcome: balance.outcome },
  { outstandingMinor: '7500', collectedMinor: '2500', outcome: 'open' });
assert.ok(balance.proofId); assert.equal(preparation.proofId, balance.proofId); assert.equal(preparation.actionId, action.id);
await new TrustService(joined).deleteSource(owner, sourceIds[1]);
const afterJoined = counts(joined.read());
assert.deepEqual(afterJoined, { derivedPayloads: 0, mandates: 0, previews: 0 });
const joinedMarkers = joined.read().tombstones.filter(invoiceOperationalTombstone);
for (const marker of joinedMarkers) opaque(marker);
const joinedAccounting = joinedMarkers.find(marker => marker.kind === 'invoice-mandate-accounting-v1')!;
assert.equal(joinedAccounting.spentMinor, '22'); assert.equal(joinedAccounting.reservedMinor, '0');
const joinedMarkerCounts = { operations: joinedMarkers.filter(marker => marker.kind === 'invoice-operation-no-resend-v1').length,
  deliveries: joinedMarkers.filter(marker => marker.kind === 'invoice-delivery-no-resend-v1').length,
  mandates: joinedMarkers.filter(marker => marker.kind === 'invoice-mandate-accounting-v1').length };
assert.deepEqual(joinedMarkerCounts, { operations: 2, deliveries: 1, mandates: 1 });
await assert.rejects(call(hostFor(joined), 'reminder.execute', { id: action.id }), { code: 'NOT_FOUND' });

const beforeHelper = counts(legacy.read());
await legacy.update(state => {
  const proof = records(state, 'invoice-balance-proof-v1')[0], preview = state.actions[0];
  const approval = records(state, 'invoice-reminder-approval-v1')[0];
  const pins = structuredClone({ proof, payload: preview.payload, previewDigest: preview.digest, approvalDigest: approval.digest });
  assert.equal(preview.payload.proofDigest, digest(proof)); assert.equal(approval.digest, preview.digest);
  assert.deepEqual(prepareInvoicePurge(state, { sourceId: sourceIds[1] }, iso(legacy)), { answersRemoved: 5, mandatesRemoved: 1 });
  assert.deepEqual({ proof, payload: preview.payload, previewDigest: preview.digest, approvalDigest: approval.digest }, pins);
});
await new TrustService(legacy).deleteSource(owner, sourceIds[1]);
const afterHelper = counts(legacy.read());
assert.deepEqual(afterHelper, { derivedPayloads: 0, mandates: 0, previews: 0 });
const markers = legacy.read().tombstones.filter(invoiceOperationalTombstone);
for (const marker of markers) opaque(marker);
const accounting = markers.find(marker => marker.kind === 'invoice-mandate-accounting-v1')!;
assert.equal(accounting.spentMinor, '22'); assert.equal(accounting.reservedMinor, '0');
const operationMarkers = markers.filter(marker => marker.kind === 'invoice-operation-no-resend-v1');
assert.equal(operationMarkers.length, 2); assert.ok(operationMarkers.every(marker => marker.spentMinor === '1'));
const deliveryMarkers = markers.filter(marker => marker.kind === 'invoice-delivery-no-resend-v1');
assert.equal(deliveryMarkers.length, 1); assert.equal(deliveryMarkers[0].costMinor, '20');

const uncertain = await fixture(true); let settlementLost = false;
uncertain.store.failBeforeCommit = state => {
  if (!settlementLost && state.jobs.some(job => job.id === uncertain.job.id && job.execution?.attempts.some(
    (attempt: any) => attempt.stepId === 'balance-0' && attempt.status === 'verified'))) {
    settlementLost = true; uncertain.store.failBeforeCommit = undefined;
    throw new Error('Synthetic lost runner settlement after invoice operation commit.');
  }
};
const unknown = await call<Job>(uncertain.host, 'run', { id: uncertain.job.id });
assert.equal(settlementLost, true); assert.equal(unknown.status, 'outcome-unknown');
assert.equal(unknown.spentMinor, '0'); assert.equal(unknown.reservedMinor, '20');
assert.equal(records(uncertain.store.read(), 'invoice-job-operation-v1').length, 1);
await uncertain.store.update(state => {
  prepareInvoicePurge(state, { expiredFactIds: state.facts.map(fact => fact.id),
    cutoff: new Date(uncertain.store.clock() - dayMs).toISOString() }, iso(uncertain.store));
});
await uncertain.trust.cleanup(owner, new Date(uncertain.store.clock()));
assert.deepEqual(counts(uncertain.store.read()), { derivedPayloads: 0, mandates: 0, previews: 0 });
const restarted = uncertain.store.restart(), recoveredHost = hostFor(restarted);
await call(recoveredHost, 'recover');
const postRestartRequests: Record<string, string> = {};
for (const method of ['read', 'reconcile', 'run']) {
  await assert.rejects(call(recoveredHost, method, { id: uncertain.job.id }), { code: 'NOT_FOUND' });
  postRestartRequests[method] = 'NOT_FOUND';
}
const held = restarted.read().tombstones.find(marker => marker.kind === 'invoice-mandate-accounting-v1')!;
opaque(held); assert.equal(held.spentMinor, '0'); assert.equal(held.reservedMinor, '20');
assert.equal(held.status, 'outcome-unknown');
assert.equal(restarted.read().facts.length, 0);

console.log(JSON.stringify({ artifact: 'invoice-follow-up-purge-synthetic-v2', qualification: 'source-contract-only',
  legacyBeforePurge: { operationPayloads: residue.length, outstandingMinor: balance.outstandingMinor,
    collectedMinor: balance.collectedMinor, outcome: balance.outcome, balanceProofReferencePresent: Boolean(balance.proofId),
    preparationProofReferencePresent: preparation.proofId === balance.proofId },
  joinedTrustPurge: { before: beforeJoined, after: afterJoined, opaqueMarkers: joinedMarkerCounts,
    mandateAccounting: { spentMinor: joinedAccounting.spentMinor, reservedMinor: joinedAccounting.reservedMinor },
    erasedActionRetry: 'NOT_FOUND' },
  helperThenTrust: { before: beforeHelper, after: afterHelper, proofAndPreviewPinsUnchanged: true,
    opaqueMarkers: { operations: operationMarkers.length, deliveries: deliveryMarkers.length, mandates: 1 },
    mandateAccounting: { spentMinor: accounting.spentMinor, reservedMinor: accounting.reservedMinor },
    separateProviderCosts: { operationSpentMinor: operationMarkers.map(marker => marker.spentMinor), deliveryCostMinor: deliveryMarkers[0].costMinor } },
  lostRunnerSettlement: { before: { status: unknown.status, spentMinor: unknown.spentMinor, reservedMinor: unknown.reservedMinor },
    after: { ...counts(restarted.read()), status: held.status, spentMinor: held.spentMinor, reservedMinor: held.reservedMinor },
    opaqueAccountingPreserved: true, postRestartRequests },
}, null, 2));
