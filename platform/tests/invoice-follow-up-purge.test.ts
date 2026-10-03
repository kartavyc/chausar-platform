import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, type PreparedAction } from '../runtime/actions.ts';
import { InvoiceFollowUpHost, invoiceConnectorId, type InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import { invoiceOperationalTombstone, prepareInvoicePurge } from '../runtime/invoice-follow-up-lineage.ts';
import type { Job } from '../runtime/jobs.ts';
import { MemoryService } from '../runtime/memory.ts';
import { TrustService } from '../runtime/trust.ts';
import { appendPayment, customerId, invoiceId, InvoiceFixtureStore, owner, seedInvoiceFixture, sourceIds, syntheticNow } from './invoice-follow-up.fixture.ts';

// Unit/source-contract purge regressions use labelled synthetic state, clocks,
// costs and deterministic delivery. They do not establish the shared Engine join.
const dayMs = 86400000;
const derivedKinds = ['invoice-balance-proof-v1', 'invoice-job-operation-v1', 'invoice-reminder-approval-v1',
  'invoice-simulated-delivery-v1', 'invoice-paid-v1'];
const iso = (store: InvoiceFixtureStore) => new Date(store.clock()).toISOString();
const records = (store: InvoiceFixtureStore, kind: string) => store.read().answers.filter(answer => answer.kind === kind);
const derived = (store: InvoiceFixtureStore) => store.read().answers.filter(answer => derivedKinds.includes(answer.kind));
const options = (store: InvoiceFixtureStore): InvoiceHostOptions => ({
  clock: store.clock, workerId: 'synthetic-invoice-purge-worker', maxActiveJobs: 8, leaseMs: 1000,
  approvalTtlMs: 60000, dailyCap: 10, perCustomerDailyCap: 10,
  dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20',
});
const hostFor = (store: InvoiceFixtureStore) => new InvoiceFollowUpHost(store, options(store));
const dispatch = <T>(host: InvoiceFollowUpHost, method: string, request: unknown = {}) =>
  host.dispatch(owner, `invoiceFollowUp.${method}`, request) as Promise<T>;
function config(store: InvoiceFixtureStore) {
  return { ownerId: owner.memberId, goal: 'Review the synthetic invoice with retained proof and individually approve its reminder',
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
}
async function fixture(oldFacts = false, unusedScopedFact = false) {
  const store = await seedInvoiceFixture(new InvoiceFixtureStore(undefined, oldFacts ? syntheticNow - 2 * dayMs : syntheticNow));
  if (oldFacts) store.advance(2 * dayMs);
  if (unusedScopedFact) await new MemoryService(store).append(owner, [{ entityId: 'invoice-outside-selected-customer',
    sourceId: sourceIds[0], sourceRow: 4, kind: 'invoice', validFrom: '2026-09-01', branch: 'main',
    fields: { invoiceId: 'invoice-outside-selected-customer', customerId: 'another-synthetic-customer',
      amountMinor: '3300', currency: 'INR', dueDate: '2026-09-30', status: 'unpaid' },
  }], { testLearnedAt: iso(store) });
  const host = hostFor(store), trust = new TrustService(store);
  await trust.updatePolicy(owner, { retentionDays: 1 });
  await dispatch(host, 'consent.record', { requestId: 'synthetic-purge-opt-in', customerId, channel: 'simulation',
    destination: 'synthetic-customer:purge-test', status: 'yes', sourceId: sourceIds[0],
    evidence: 'Synthetic affirmative customer opt-in for purge regression.', at: iso(store) });
  const job = await dispatch<Job>(host, 'create', config(store));
  return { store, host, trust, job };
}
async function prepared(oldFacts = false, unusedScopedFact = false) {
  const f = await fixture(oldFacts, unusedScopedFact);
  const result = await dispatch<Job>(f.host, 'run', { id: f.job.id });
  assert.equal(result.status, 'awaiting-acceptance', JSON.stringify(result.ledger));
  const action = f.store.read().actions[0] as PreparedAction;
  assert.ok(action); await dispatch(f.host, 'reminder.approve', { id: action.id, digest: action.digest });
  return { ...f, action };
}
async function sentAndPaid() {
  const f = await prepared();
  assert.equal((await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id })).status, 'verified');
  await dispatch(f.host, 'accept', { id: f.job.id, repeat: true });
  f.store.advance(60000); await appendPayment(f.store);
  assert.equal((await dispatch<Job>(f.host, 'run', { id: f.job.id })).status, 'awaiting-acceptance');
  assert.equal(records(f.store, 'invoice-paid-v1').length, 1);
  return f;
}
async function lostRunnerSettlement() {
  const f = await fixture(true); let lost = false;
  f.store.failBeforeCommit = state => {
    if (!lost && state.jobs.some(job => job.id === f.job.id && job.execution?.attempts.some((attempt: any) => attempt.stepId === 'balance-0' && attempt.status === 'verified'))) {
      lost = true; f.store.failBeforeCommit = undefined; throw new Error('Synthetic lost runner settlement after invoice operation commit.');
    }
  };
  const unknown = await dispatch<Job>(f.host, 'run', { id: f.job.id });
  assert.equal(lost, true); assert.equal(unknown.status, 'outcome-unknown');
  assert.equal(unknown.spentMinor, '0'); assert.equal(unknown.reservedMinor, '20');
  assert.equal(records(f.store, 'invoice-job-operation-v1').length, 1);
  return { ...f, key: unknown.execution!.attempts[0].key };
}
function opaqueAccounting(marker: Record<string, any>, spentMinor: string, reservedMinor: string) {
  assert.match(marker.identity, /^[a-f0-9]{64}$/); assert.equal(marker.spentMinor, spentMinor);
  assert.equal(marker.reservedMinor, reservedMinor);
  const serialized = JSON.stringify(marker);
  for (const privateValue of [invoiceId, customerId, ...sourceIds, 'synthetic-invoice:purge-test', '7500', '10000'])
    assert.equal(serialized.includes(privateValue), false, `Opaque accounting unexpectedly contains ${privateValue}`);
}

test('invoice purge: every current derived record and embedded result carries complete source, fact and date lineage', async () => {
  const f = await prepared(false, true);
  await dispatch(f.host, 'reminder.execute', { id: f.action.id });
  const allFactIds = f.store.read().facts.map(fact => fact.id).sort();
  assert.equal(allFactIds.length, 4, 'Include scope facts outside the selected customer, since scope identity depends on them.');
  const current = derived(f.store); assert.equal(current.length, 5);
  for (const artifact of current) {
    assert.deepEqual(artifact.sourceIds, [...sourceIds].sort(), artifact.kind);
    assert.deepEqual(artifact.factIds, allFactIds, artifact.kind); assert.equal(artifact.at, iso(f.store), artifact.kind);
    if (artifact.kind === 'invoice-job-operation-v1') {
      assert.deepEqual(artifact.settlement.result.value.sourceIds, artifact.sourceIds);
      assert.deepEqual(artifact.settlement.result.value.factIds, artifact.factIds);
      assert.equal(artifact.settlement.result.value.at, artifact.at);
    }
  }
  const saved = f.store.read().jobs.find(job => job.id === f.job.id)!;
  const invoice = saved.deliverable.result.invoices[0];
  for (const result of [invoice.balance, invoice.reminder]) {
    assert.deepEqual(result.sourceIds, [...sourceIds].sort()); assert.deepEqual(result.factIds, allFactIds); assert.equal(result.at, iso(f.store));
  }
  await dispatch(f.host, 'accept', { id: f.job.id, repeat: true }); f.store.advance(60000); await appendPayment(f.store);
  await dispatch(f.host, 'run', { id: f.job.id });
  const paid = records(f.store, 'invoice-paid-v1')[0];
  assert.ok(paid); assert.deepEqual(paid.sourceIds, [...sourceIds].sort());
  assert.deepEqual(paid.factIds, f.store.read().facts.map(fact => fact.id).sort()); assert.equal(paid.at, iso(f.store));
});

test('invoice purge: reminder lineage includes its separately sourced pinned customer consent', async () => {
  const f = await fixture(), consentSource = 'synthetic-consent-observation';
  await new MemoryService(f.store).append(owner, [{ entityId: 'synthetic-opt-in-row', sourceId: consentSource, sourceRow: 1,
    kind: 'customer_consent', validFrom: '2026-10-01', branch: 'main',
    fields: { customerId, status: 'yes', description: 'Synthetic separately imported opt-in observation.' },
  }], { testLearnedAt: iso(f.store) });
  await dispatch(f.host, 'consent.record', { requestId: 'synthetic-separately-sourced-opt-in', customerId, channel: 'simulation',
    destination: 'synthetic-customer:purge-test', status: 'yes', sourceId: consentSource,
    evidence: 'Synthetic affirmative consent held separately from invoice and bank sources.', at: iso(f.store) });
  const delivered = await dispatch<Job>(f.host, 'run', { id: f.job.id }); assert.equal(delivered.status, 'awaiting-acceptance');
  const action = f.store.read().actions[0] as PreparedAction;
  await dispatch(f.host, 'reminder.approve', { id: action.id, digest: action.digest });
  await dispatch(f.host, 'reminder.execute', { id: action.id });
  const preparation = records(f.store, 'invoice-job-operation-v1').find(record => record.key.endsWith(':step:prepare-0'))!;
  for (const artifact of [preparation, ...records(f.store, 'invoice-reminder-approval-v1'), ...records(f.store, 'invoice-simulated-delivery-v1')]) {
    assert.deepEqual(artifact.sourceIds, [...sourceIds, consentSource].sort());
    assert.deepEqual(artifact.factIds, f.store.read().facts.map(fact => fact.id).sort()); assert.equal(artifact.at, iso(f.store));
  }
  assert.deepEqual(preparation.settlement.result.value.sourceIds, [...sourceIds, consentSource].sort());
  assert.deepEqual(f.store.read().actions[0].sourceIds, [...sourceIds, consentSource].sort());
  await f.trust.deleteSource(owner, consentSource);
  assert.equal(records(f.store, 'invoice-reminder-approval-v1').length, 0);
  assert.equal(records(f.store, 'invoice-simulated-delivery-v1').length, 0);
  assert.equal(f.store.read().answers.some(answer => answer.kind === 'invoice-job-operation-v1' && answer.key.endsWith(':step:prepare-0')), false);
  assert.equal(f.store.read().actions.length, 0); assert.equal(f.store.read().jobs.length, 0);
});

for (const sourceId of sourceIds) test(`invoice purge: deleting ${sourceId} directly removes amounts, proof references, approval and delivery records`, async () => {
  const f = await sentAndPaid();
  assert.equal(records(f.store, 'invoice-job-operation-v1').length, 4);
  assert.equal(records(f.store, 'invoice-job-operation-v1')[0].settlement.result.value.outstandingMinor, '7500');
  await f.store.update(state => { state.answers.push({ kind: 'synthetic-unrelated-answer', sourceId: 'synthetic-unrelated', amountMinor: '33', at: iso(f.store) }); });
  await f.trust.deleteSource(owner, sourceId);
  assert.deepEqual(derived(f.store), []);
  assert.equal(f.store.read().jobs.length, 0); assert.equal(f.store.read().actions.length, 0);
  assert.equal(records(f.store, 'synthetic-unrelated-answer').length, 1);
  assert.equal(records(f.store, 'invoice-opt-in-v1').length, sourceId === sourceIds[0] ? 0 : 1);
  await assert.rejects(dispatch(f.host, 'read', { id: f.job.id }), { code: 'NOT_FOUND' });
});

test('invoice purge: date retention directly removes old operation amounts and all dependent invoice payloads', async () => {
  const f = await sentAndPaid(), cleanupAt = new Date(f.store.clock() + 2 * dayMs);
  await f.store.update(state => { state.answers.push({ kind: 'synthetic-unrelated-answer', sourceId: 'synthetic-unrelated', at: cleanupAt.toISOString() }); });
  await f.trust.cleanup(owner, cleanupAt);
  assert.equal(f.store.read().facts.length, 0); assert.deepEqual(derived(f.store), []);
  assert.equal(records(f.store, 'invoice-opt-in-v1').length, 0); assert.equal(records(f.store, 'synthetic-unrelated-answer').length, 1);
  assert.equal(f.store.read().jobs.length, 0); assert.equal(f.store.read().actions.length, 0);
});

test('invoice purge: fact retention directly removes recent derived payloads whose evidence has expired', async () => {
  const f = await prepared(true);
  await dispatch(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(records(f.store, 'invoice-job-operation-v1')[0].at, iso(f.store));
  const oldFactIds = f.store.read().facts.map(fact => fact.id);
  await f.trust.cleanup(owner, new Date(f.store.clock()));
  assert.equal(f.store.read().facts.length, 0); assert.deepEqual(derived(f.store), []);
  assert.equal(records(f.store, 'invoice-opt-in-v1').length, 1, 'A current consent observation is not expired solely because invoice evidence expired.');
  assert.equal(f.store.read().jobs.length, 0, 'Stored deliverable lineage propagates evidence expiry to the invoice mandate.');
  assert.equal(f.store.read().actions.length, 0); assert.equal(f.store.read().receipts.length, 0);
  const remaining = JSON.stringify({ answers: f.store.read().answers, jobs: f.store.read().jobs });
  for (const id of oldFactIds) assert.equal(remaining.includes(id), false);
});

test('invoice purge: lineage does not change an approved proof pin or the exact action digest', async () => {
  const f = await prepared(); const before = f.store.read(), proof = records(f.store, 'invoice-balance-proof-v1')[0];
  assert.equal(f.action.payload.proofDigest, digest(proof));
  const approval = records(f.store, 'invoice-reminder-approval-v1')[0]; assert.equal(approval.digest, f.action.digest);
  await f.store.update(state => { prepareInvoicePurge(state, { sourceId: 'synthetic-unrelated' }, iso(f.store)); });
  assert.deepEqual(records(f.store, 'invoice-balance-proof-v1')[0], proof);
  assert.deepEqual(f.store.read().actions[0], before.actions[0]);
  assert.deepEqual(records(f.store, 'invoice-reminder-approval-v1')[0], approval);
  const sent = await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.digest, f.action.digest); assert.equal(sent.payload.proofDigest, digest(proof));
});

test('invoice purge: the explicit purge helper removes legacy records without rewriting historical proof or approval pins', async () => {
  const f = await prepared(); await dispatch(f.host, 'reminder.execute', { id: f.action.id });
  await f.store.update(state => {
    for (const artifact of state.answers.filter(answer => ['invoice-job-operation-v1', 'invoice-reminder-approval-v1', 'invoice-simulated-delivery-v1'].includes(answer.kind))) {
      delete artifact.sourceIds; delete artifact.factIds;
      if (artifact.kind !== 'invoice-simulated-delivery-v1') delete artifact.at;
      if (artifact.kind === 'invoice-job-operation-v1') {
        delete artifact.settlement.result.value.sourceIds; delete artifact.settlement.result.value.factIds; delete artifact.settlement.result.value.at;
      }
    }
  });
  // Establish the legacy payload precondition before current Trust applies its
  // mandatory purge hook. The original unjoined defect is retained separately.
  const joinedLegacy = f.store.restart();
  const rawLegacy = records(joinedLegacy, 'invoice-job-operation-v1'); assert.equal(rawLegacy.length, 2);
  const balanceResidue = rawLegacy.find(record => record.key.endsWith(':step:balance-0'))!.settlement.result.value;
  const preparationResidue = rawLegacy.find(record => record.key.endsWith(':step:prepare-0'))!.settlement.result.value;
  assert.deepEqual({ outstandingMinor: balanceResidue.outstandingMinor, collectedMinor: balanceResidue.collectedMinor, outcome: balanceResidue.outcome },
    { outstandingMinor: '7500', collectedMinor: '2500', outcome: 'open' });
  assert.equal(typeof balanceResidue.proofId, 'string'); assert.ok(balanceResidue.proofId.length > 0);
  assert.equal(preparationResidue.proofId, balanceResidue.proofId); assert.equal(preparationResidue.actionId, f.action.id);
  await new TrustService(joinedLegacy).deleteSource(owner, sourceIds[1]);
  assert.deepEqual(derived(joinedLegacy), []);
  assert.equal(joinedLegacy.read().jobs.length, 0); assert.equal(joinedLegacy.read().actions.length, 0);
  const joinedAccounting = joinedLegacy.read().tombstones.filter(marker => marker.kind === 'invoice-mandate-accounting-v1');
  assert.equal(joinedAccounting.length, 1); opaqueAccounting(joinedAccounting[0], '22', '0');
  assert.equal(joinedAccounting[0].budgetMinor, f.job.budgetMinor);
  assert.equal(joinedLegacy.read().tombstones.filter(marker => marker.kind === 'invoice-operation-no-resend-v1').length, 2);
  assert.equal(joinedLegacy.read().tombstones.filter(marker => marker.kind === 'invoice-delivery-no-resend-v1').length, 1);
  await assert.rejects(dispatch(hostFor(joinedLegacy), 'reminder.execute', { id: f.action.id }), { code: 'NOT_FOUND' });
  await f.store.update(state => {
    const proof = state.answers.find(answer => answer.kind === 'invoice-balance-proof-v1')!;
    const action = state.actions[0], approval = state.answers.find(answer => answer.kind === 'invoice-reminder-approval-v1')!;
    const pins = { proof: structuredClone(proof), payload: structuredClone(action.payload), actionDigest: action.digest, approvalDigest: approval.digest };
    const removed = prepareInvoicePurge(state, { sourceId: sourceIds[1] }, iso(f.store));
    assert.equal(removed.mandatesRemoved, 1); assert.equal(removed.answersRemoved, 5);
    assert.deepEqual(proof, pins.proof); assert.deepEqual(action.payload, pins.payload);
    assert.equal(action.digest, pins.actionDigest); assert.equal(approval.digest, pins.approvalDigest);
  });
  await f.trust.deleteSource(owner, sourceIds[1]);
  assert.deepEqual(derived(f.store), []); assert.equal(f.store.read().jobs.length, 0); assert.equal(f.store.read().actions.length, 0);
  const markers = f.store.read().tombstones.filter(marker => marker.kind === 'invoice-mandate-accounting-v1');
  assert.equal(markers.length, 1); opaqueAccounting(markers[0], '22', '0');
  assert.equal(f.store.read().tombstones.filter(marker => marker.kind === 'invoice-operation-no-resend-v1').length, 2);
  assert.equal(f.store.read().tombstones.filter(marker => marker.kind === 'invoice-delivery-no-resend-v1').length, 1);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: 'NOT_FOUND' });
});

test('invoice purge: direct cleanup after lost settlement fences the erased mandate and preserves its exact unknown cost', async () => {
  const f = await lostRunnerSettlement(); const record = records(f.store, 'invoice-job-operation-v1')[0];
  assert.equal(record.settlement.spentMinor, '1');
  await f.trust.cleanup(owner, new Date(f.store.clock()));
  assert.equal(records(f.store, 'invoice-job-operation-v1').length, 0); assert.equal(f.store.read().facts.length, 0);
  const marker = f.store.read().tombstones.find(item => item.kind === 'invoice-operation-no-resend-v1');
  assert.ok(marker); assert.equal(marker.requestDigest, record.requestDigest); assert.equal(marker.spentMinor, '1');
  assert.equal(JSON.stringify(marker).includes(f.key), false); assert.equal(JSON.stringify(marker).includes(invoiceId), false);
  const accounting = f.store.read().tombstones.filter(item => item.kind === 'invoice-mandate-accounting-v1');
  assert.equal(accounting.length, 1); opaqueAccounting(accounting[0], '0', '20');
  assert.equal(accounting[0].budgetMinor, f.job.budgetMinor); assert.equal(accounting[0].status, 'outcome-unknown');
  assert.equal(JSON.stringify(accounting[0]).includes(f.job.id), false);
  assert.equal(f.store.read().jobs.length, 0); assert.equal(f.store.read().actions.length, 0);
  const retainedMarkers = f.store.read().tombstones.filter(invoiceOperationalTombstone);
  const restarted = f.store.restart(), host = hostFor(restarted); await dispatch(host, 'recover');
  for (let retry = 0; retry < 2; retry++) {
    for (const method of ['read', 'reconcile', 'run'])
      await assert.rejects(dispatch(host, method, { id: f.job.id }), { code: 'NOT_FOUND' });
    assert.deepEqual(restarted.read().tombstones.filter(invoiceOperationalTombstone), retainedMarkers);
    assert.equal(restarted.read().jobs.length, 0);
  }
  assert.equal(records(restarted, 'invoice-job-operation-v1').length, 0); assert.equal(records(restarted, 'invoice-balance-proof-v1').length, 0);
  assert.equal(restarted.read().actions.length, 0); assert.equal(restarted.read().receipts.length, 0);
});

test('invoice purge: helper fencing after lost settlement removes payloads and preserves exact unknown cost in opaque accounting', async () => {
  const f = await lostRunnerSettlement(), factIds = f.store.read().facts.map(fact => fact.id);
  await f.store.update(state => {
    prepareInvoicePurge(state, { expiredFactIds: factIds, cutoff: new Date(f.store.clock() - dayMs).toISOString() }, iso(f.store));
  });
  await f.trust.cleanup(owner, new Date(f.store.clock()));
  assert.equal(f.store.read().facts.length, 0); assert.deepEqual(derived(f.store), []);
  assert.equal(f.store.read().jobs.length, 0); assert.equal(f.store.read().actions.length, 0);
  const accounting = f.store.read().tombstones.filter(marker => marker.kind === 'invoice-mandate-accounting-v1');
  assert.equal(accounting.length, 1); opaqueAccounting(accounting[0], '0', '20'); assert.equal(accounting[0].status, 'outcome-unknown');
  const restarted = f.store.restart(), host = hostFor(restarted); await dispatch(host, 'recover');
  for (const method of ['read', 'reconcile', 'run']) await assert.rejects(dispatch(host, method, { id: f.job.id }), { code: 'NOT_FOUND' });
  opaqueAccounting(restarted.read().tombstones.find(marker => marker.kind === 'invoice-mandate-accounting-v1')!, '0', '20');
  assert.equal(restarted.read().jobs.length, 0); assert.equal(records(restarted, 'invoice-job-operation-v1').length, 0);
});
