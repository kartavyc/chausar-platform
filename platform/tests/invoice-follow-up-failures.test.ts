import test from 'node:test';
import assert from 'node:assert/strict';
import type { PreparedAction } from '../runtime/actions.ts';
import type { Context } from '../runtime/contracts.ts';
import { InvoiceFollowUpHost, invoiceConnectorId, type InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import type { Job } from '../runtime/jobs.ts';
import { MemoryService } from '../runtime/memory.ts';
import { appendPayment, customerId, invoiceId, InvoiceFixtureStore, owner, seedInvoiceFixture, sourceIds } from './invoice-follow-up.fixture.ts';

// Labelled synthetic state, cost and delivery only. Fault hooks exercise the
// public contract around local commits; they never call a customer transport.
type InvoiceRead = { job: Job; reminders: PreparedAction[]; outcomes: Array<Record<string, any>> };
const options = (store: InvoiceFixtureStore): InvoiceHostOptions => ({
  clock: store.clock, workerId: 'synthetic-invoice-failure-worker', maxActiveJobs: 8, leaseMs: 1000,
  approvalTtlMs: 60000, dailyCap: 10, perCustomerDailyCap: 10,
  dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20',
});
const hostFor = (store: InvoiceFixtureStore) => new InvoiceFollowUpHost(store, options(store));
const dispatch = <T>(host: InvoiceFollowUpHost, method: string, request: unknown = {}, context: Context = owner) =>
  host.dispatch(context, `invoiceFollowUp.${method}`, request) as Promise<T>;
const savedJob = (store: InvoiceFixtureStore, id: string): Job => store.read().jobs.find(job => job.id === id);
const records = (store: InvoiceFixtureStore, kind: string) => store.read().answers.filter(answer => answer.kind === kind);
const configuration = (store: InvoiceFixtureStore) => ({
  goal: 'Review this synthetic invoice balance and prepare an individually approved reminder', ownerId: owner.memberId,
  budgetMinor: '500', reserveMinor: '20', sourceIds, requiresApproval: false,
  stopRule: { maxRuns: 3, deadline: new Date(store.clock() + 86400000).toISOString() },
  nextRunAt: new Date(store.clock()).toISOString(), intervalMs: 60000, catchup: 'latest', graceMs: 0,
  limits: { modelUnits: 0, durationMs: 10000, actionExposureMinor: '0' },
  allowedActions: [`${invoiceConnectorId}.send`], testedRoutes: [], background: false,
  input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:invoice-one' }],
    acceptanceTest: 'Review the retained balance receipt and resolve the individual reminder without treating sent as paid.',
    reviewAt: new Date(store.clock() + 3600000).toISOString(),
    calculation: { reserveMinor: '10', durationMs: 2000 }, preparation: { reserveMinor: '10', durationMs: 2000 } },
});
async function consent(host: InvoiceFollowUpHost, store: InvoiceFixtureStore, status: 'yes' | 'no' | 'stopped', requestId = 'synthetic-initial-consent') {
  return dispatch(host, 'consent.record', { requestId, customerId, channel: 'simulation',
    destination: 'synthetic-customer:customer-one', status, sourceId: sourceIds[0],
    evidence: `Synthetic customer observation: ${status}.`, at: new Date(store.clock()).toISOString() });
}
async function fixture(extraCustomer = false) {
  const store = await seedInvoiceFixture();
  if (extraCustomer) await new MemoryService(store).append(owner, [{
    entityId: 'invoice-other-customer', sourceId: sourceIds[0], sourceRow: 4, kind: 'invoice',
    validFrom: '2026-09-01', branch: 'main', fields: { invoiceId: 'invoice-other-customer', customerId: 'customer-two',
      amountMinor: '1000', currency: 'INR', dueDate: '2026-09-30', status: 'unpaid', description: 'Synthetic second customer for reviewed identity change.' },
  }], { testLearnedAt: new Date(store.clock()).toISOString() });
  const host = hostFor(store); await consent(host, store, 'yes');
  const job = await dispatch<Job>(host, 'create', configuration(store));
  return { store, host, job };
}
async function prepared(extraCustomer = false) {
  const f = await fixture(extraCustomer);
  const result = await dispatch<Job>(f.host, 'run', { id: f.job.id });
  assert.equal(result.status, 'awaiting-acceptance', JSON.stringify(result.ledger));
  const state = await dispatch<InvoiceRead>(f.host, 'read', { id: f.job.id });
  assert.equal(state.reminders.length, 1, JSON.stringify(state));
  const action = state.reminders[0]; assert.equal(action.status, 'prepared');
  assert.equal(result.spentMinor, '2'); assert.equal(result.reservedMinor, '0');
  return { ...f, action };
}
async function approve(f: Awaited<ReturnType<typeof prepared>>) {
  return dispatch<PreparedAction>(f.host, 'reminder.approve', { id: f.action.id, digest: f.action.digest });
}
function noDelivery(store: InvoiceFixtureStore, id: string) {
  assert.equal(records(store, 'invoice-simulated-delivery-v1').length, 0);
  const job = savedJob(store, id); assert.equal(job.spentMinor, '2'); assert.equal(job.reservedMinor, '0');
  assert.equal(store.read().actions[0].attempts.length, 0);
}

test('invoice failure: lost response after the simulated sent commit reconciles after restart without a resend or second charge', async () => {
  const f = await prepared(); await approve(f); let lost = false;
  f.store.afterCommit = state => {
    if (!lost && state.answers.some(answer => answer.kind === 'invoice-simulated-delivery-v1' && answer.status === 'sent')) {
      lost = true; f.store.afterCommit = undefined; throw new Error('Synthetic lost response after committed simulated delivery.');
    }
  };
  const unknown = await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(lost, true); assert.equal(unknown.status, 'unknown'); assert.equal(unknown.attempts.length, 1);
  assert.equal(records(f.store, 'invoice-simulated-delivery-v1')[0].status, 'sent');
  assert.equal(savedJob(f.store, f.job.id).spentMinor, '22'); assert.equal(savedJob(f.store, f.job.id).reservedMinor, '0');
  assert.equal((await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id })).status, 'unknown');
  const restarted = f.store.restart(), host = hostFor(restarted);
  await dispatch(host, 'recover');
  const verified = await dispatch<PreparedAction>(host, 'reminder.reconcile', { id: f.action.id });
  assert.equal(verified.status, 'verified'); assert.equal(verified.businessSuccess, false);
  assert.deepEqual(verified.readback?.data, { mode: 'simulation', sent: true, paid: false, sentAt: records(restarted, 'invoice-simulated-delivery-v1')[0].sentAt });
  await dispatch(host, 'reminder.execute', { id: f.action.id });
  const state = await dispatch<InvoiceRead>(host, 'read', { id: f.job.id });
  assert.equal(state.reminders[0].attempts.length, 1); assert.equal(state.outcomes.length, 1);
  assert.equal(state.outcomes[0].status, 'sent'); assert.equal(state.job.spentMinor, '22'); assert.equal(state.job.reservedMinor, '0');
  assert.equal(state.job.ledger.filter(entry => entry.event === 'invoice-sent').length, 1);
  assert.equal(records(restarted, 'invoice-paid-v1').length, 0);
});

for (const stepId of ['balance-0', 'prepare-0']) test(`invoice failure: failed ${stepId} runner settlement retains the saved operation and recovers without duplicate proof or action`, async () => {
  const f = await fixture(); let failed = false;
  f.store.failBeforeCommit = state => {
    if (!failed && state.jobs.some(job => job.id === f.job.id && job.execution?.attempts.some((attempt: { stepId: string; status: string }) => attempt.stepId === stepId && attempt.status === 'verified'))) {
      failed = true; f.store.failBeforeCommit = undefined; throw new Error('Synthetic runner settlement persistence failure.');
    }
  };
  const unknown = await dispatch<Job>(f.host, 'run', { id: f.job.id });
  assert.equal(failed, true); assert.equal(unknown.status, 'outcome-unknown');
  assert.equal(unknown.spentMinor, stepId === 'balance-0' ? '0' : '1');
  assert.equal(unknown.reservedMinor, stepId === 'balance-0' ? '20' : '19');
  assert.equal(unknown.execution!.attempts.at(-1)!.status, 'unknown');
  const before = f.store.read();
  assert.equal(before.receipts.length, 1); assert.equal(records(f.store, 'invoice-balance-proof-v1').length, 1);
  assert.equal(before.actions.length, stepId === 'balance-0' ? 0 : 1);
  assert.equal((await dispatch<Job>(f.host, 'run', { id: f.job.id })).status, 'outcome-unknown');
  assert.equal(f.store.read().receipts.length, 1); assert.equal(f.store.read().actions.length, before.actions.length);
  const restarted = f.store.restart(), host = hostFor(restarted); await dispatch(host, 'recover');
  const reconciled = await dispatch<Job>(host, 'reconcile', { id: f.job.id });
  assert.equal(reconciled.status, 'scheduled'); assert.equal(reconciled.reservedMinor, '0');
  const completed = await dispatch<Job>(host, 'run', { id: f.job.id });
  assert.equal(completed.status, 'awaiting-acceptance'); assert.equal(completed.spentMinor, '2'); assert.equal(completed.reservedMinor, '0');
  assert.equal(completed.execution!.attempts.length, 2);
  const retainedOperation = before.answers.find(answer => answer.kind === 'invoice-job-operation-v1' && answer.key.endsWith(`:step:${stepId}`));
  assert.ok(retainedOperation);
  assert.equal(completed.execution!.attempts.find(attempt => attempt.stepId === stepId)!.reconciliationId, retainedOperation.id);
  assert.equal(restarted.read().receipts.length, 1); assert.equal(restarted.read().receipts[0].id, before.receipts[0].id);
  assert.equal(records(restarted, 'invoice-balance-proof-v1').length, 1);
  assert.equal(records(restarted, 'invoice-job-operation-v1').length, 2); assert.equal(restarted.read().actions.length, 1);
  if (before.actions.length) assert.equal(restarted.read().actions[0].id, before.actions[0].id);
  assert.equal(records(restarted, 'invoice-simulated-delivery-v1').length, 0);
});

for (const alreadyApproved of [false, true]) test(`invoice failure: cancelling the mandate ${alreadyApproved ? 'after approval' : 'before approval'} prevents a reminder`, async () => {
  const f = await prepared(); if (alreadyApproved) await approve(f);
  assert.equal((await dispatch<Job>(f.host, 'cancel', { id: f.job.id })).status, 'cancelled');
  if (!alreadyApproved) await assert.rejects(approve(f), { code: 'INVOICE_MANDATE_STOPPED' });
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: alreadyApproved ? 'INVOICE_MANDATE_STOPPED' : 'APPROVAL_REQUIRED' });
  noDelivery(f.store, f.job.id);
});

for (const status of ['no', 'stopped'] as const) test(`invoice failure: customer consent ${status} after individual approval refuses delivery`, async () => {
  const f = await prepared(); await approve(f);
  await consent(f.host, f.store, status, `synthetic-consent-${status}`);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: 'INVOICE_OPT_IN_REQUIRED' });
  noDelivery(f.store, f.job.id);
});

test('invoice failure: an expired individual approval refuses delivery and requires a fresh explicit approval', async () => {
  const f = await prepared(); await approve(f); f.store.advance(options(f.store).approvalTtlMs);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: 'INVOICE_APPROVAL_EXPIRED' });
  const expired = await dispatch<InvoiceRead>(f.host, 'read', { id: f.job.id });
  assert.equal(expired.reminders[0].status, 'prepared'); assert.equal(expired.reminders[0].approval, undefined);
  assert.equal(records(f.store, 'invoice-reminder-approval-v1').length, 0); noDelivery(f.store, f.job.id);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: 'APPROVAL_REQUIRED' });
  const fresh = await approve(f); assert.equal(fresh.status, 'approved'); assert.equal(fresh.digest, f.action.digest);
  assert.equal(records(f.store, 'invoice-reminder-approval-v1')[0].approvedAt, new Date(f.store.clock()).toISOString());
  const sent = await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.businessSuccess, false);
  assert.equal(sent.attempts.length, 1); assert.equal(records(f.store, 'invoice-simulated-delivery-v1').length, 1);
  assert.equal(savedJob(f.store, f.job.id).spentMinor, '22'); assert.equal(savedJob(f.store, f.job.id).reservedMinor, '0');
});

for (const revoked of ['source', 'owner'] as const) test(`invoice failure: ${revoked} revocation denies invoice payload and delivery methods`, async () => {
  const f = await prepared(); await approve(f);
  await f.store.update(state => {
    if (revoked === 'source') state.sourceRules.push({ sourceId: sourceIds[1], memberId: owner.memberId, read: false });
    else state.members.find(member => member.id === owner.memberId)!.epoch++;
  });
  const code = revoked === 'source' ? 'SOURCE_REVOKED' : 'ACCESS_REVOKED';
  for (const [method, request] of [
    ['read', { id: f.job.id }], ['reminder.approve', { id: f.action.id, digest: f.action.digest }],
    ['reminder.execute', { id: f.action.id }], ['reminder.reconcile', { id: f.action.id }],
  ] as const) await assert.rejects(dispatch(f.host, method, request), { code });
  noDelivery(f.store, f.job.id);
});

test('invoice failure: a changed invoice amount makes the approved exact preview stale and refuses delivery', async () => {
  const f = await prepared(); await approve(f); f.store.advance(1);
  const previous = f.store.read().facts.find(fact => fact.entityId === invoiceId)!;
  await new MemoryService(f.store).append(owner, [{ entityId: invoiceId, sourceId: previous.sourceId, sourceRow: previous.sourceRow,
    kind: previous.kind, validFrom: previous.validFrom, branch: previous.branch,
    fields: { ...previous.fields, amountMinor: '12000' } }], { testLearnedAt: new Date(f.store.clock()).toISOString() });
  assert.equal(f.store.read().receipts[0].stale, true);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), error =>
    ['INVOICE_PROOF_CHANGED', 'INVOICE_EVIDENCE_CHANGED'].includes((error as { code: string }).code));
  noDelivery(f.store, f.job.id);
});

test('invoice failure: a reviewed customer merge makes the approved exact target stale and refuses delivery', async () => {
  const f = await prepared(true); await approve(f);
  await new MemoryService(f.store).merge(owner, [customerId, 'customer-two'], 'customer-two');
  assert.equal(f.store.read().merges.length, 1); assert.equal(f.store.read().receipts[0].stale, true);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), error =>
    ['INVOICE_PROOF_CHANGED', 'INVOICE_EVIDENCE_CHANGED'].includes((error as { code: string }).code));
  noDelivery(f.store, f.job.id);
});

test('invoice failure: lost delivery admission response keeps exposure reserved until exclusive restart and cannot replay', async () => {
  const f = await prepared(); await approve(f); let lost = false;
  f.store.afterCommit = state => {
    if (!lost && state.answers.some(answer => answer.kind === 'invoice-simulated-delivery-v1' && answer.status === 'reserved')) {
      lost = true; f.store.afterCommit = undefined; throw new Error('Synthetic lost response after delivery admission.');
    }
  };
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), /Synthetic lost response after delivery admission/);
  assert.equal(lost, true); assert.equal(savedJob(f.store, f.job.id).reservedMinor, '20');
  assert.equal(savedJob(f.store, f.job.id).spentMinor, '2'); assert.equal(f.store.read().actions[0].attempts.length, 0);
  await assert.rejects(dispatch(f.host, 'reminder.execute', { id: f.action.id }), { code: 'INVOICE_DELIVERY_PENDING' });
  assert.equal(savedJob(f.store, f.job.id).reservedMinor, '20');
  const restarted = f.store.restart(), host = hostFor(restarted);
  const recovery = await dispatch<{ recovered: string[] }>(host, 'recover');
  assert.deepEqual(recovery.recovered, [records(restarted, 'invoice-simulated-delivery-v1')[0].id]);
  const state = await dispatch<InvoiceRead>(host, 'read', { id: f.job.id });
  assert.equal(state.job.reservedMinor, '0'); assert.equal(state.job.spentMinor, '2');
  assert.equal(state.reminders[0].status, 'cancelled'); assert.equal(state.reminders[0].attempts.length, 0);
  assert.equal(state.outcomes[0].status, 'not-sent'); assert.equal(state.outcomes[0].reason, 'exclusive-host-restart-no-local-effect');
  await assert.rejects(dispatch(host, 'reminder.execute', { id: f.action.id }), { code: 'APPROVAL_REQUIRED' });
  await dispatch(host, 'recover'); assert.equal(savedJob(restarted, f.job.id).reservedMinor, '0');
  assert.equal(savedJob(restarted, f.job.id).ledger.filter(entry => entry.event === 'invoice-not-sent').length, 1);
  assert.equal(records(restarted, 'invoice-simulated-delivery-v1').filter(record => record.status === 'sent').length, 0);
});

test('invoice failure: simultaneous execution of the same approved reminder commits one send and one charge', async () => {
  const f = await prepared(); await approve(f);
  const results = await Promise.allSettled([
    dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id }),
    dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id }),
  ]);
  assert.ok(results.some(result => result.status === 'fulfilled'));
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'INVOICE_DELIVERY_PENDING');
  const state = await dispatch<InvoiceRead>(f.host, 'read', { id: f.job.id });
  assert.equal(state.reminders[0].status, 'verified'); assert.equal(state.reminders[0].attempts.length, 1);
  assert.equal(state.outcomes.length, 1); assert.equal(state.outcomes[0].status, 'sent');
  assert.equal(state.job.spentMinor, '22'); assert.equal(state.job.reservedMinor, '0');
  assert.equal(state.job.ledger.filter(entry => entry.event === 'invoice-sent').length, 1);
  assert.equal(records(f.store, 'invoice-paid-v1').length, 0);
});

test('invoice failure: changed payment evidence cannot erase the historical sent readback of a lost response', async () => {
  const f = await prepared(); await approve(f); let lost = false;
  f.store.afterCommit = state => {
    if (!lost && state.answers.some(answer => answer.kind === 'invoice-simulated-delivery-v1' && answer.status === 'sent')) {
      lost = true; f.store.afterCommit = undefined; throw new Error('Synthetic lost sent response before a new payment observation.');
    }
  };
  const unknown = await dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  assert.equal(unknown.status, 'unknown'); f.store.advance(1); await appendPayment(f.store);
  assert.equal(f.store.read().receipts[0].stale, true);
  const restarted = f.store.restart(), host = hostFor(restarted); await dispatch(host, 'recover');
  const verified = await dispatch<PreparedAction>(host, 'reminder.reconcile', { id: f.action.id });
  assert.equal(verified.status, 'verified'); assert.equal(verified.businessSuccess, false);
  assert.equal((verified.readback!.data as { sent: boolean; paid: boolean }).sent, true);
  assert.equal((verified.readback!.data as { sent: boolean; paid: boolean }).paid, false);
  assert.equal((await dispatch<PreparedAction>(host, 'reminder.execute', { id: f.action.id })).status, 'verified');
  const state = await dispatch<InvoiceRead>(host, 'read', { id: f.job.id });
  assert.equal(state.outcomes.length, 1); assert.equal(state.outcomes[0].status, 'sent');
  assert.equal(state.job.spentMinor, '22'); assert.equal(state.job.reservedMinor, '0');
  assert.equal(state.reminders[0].attempts.length, 1); assert.equal(records(restarted, 'invoice-paid-v1').length, 0);
});

test('invoice failure: recovery refuses an active same-host reminder attempt without releasing its delivery reservation', async () => {
  const f = await prepared(); await approve(f);
  let enter!: () => void, release!: () => void, held = false;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const update = f.store.update.bind(f.store);
  f.store.update = async change => {
    const result = await update(change);
    if (!held && f.store.read().actions.some(action => action.id === f.action.id && action.status === 'executing')) {
      held = true; enter(); await released;
    }
    return result;
  };
  const running = dispatch<PreparedAction>(f.host, 'reminder.execute', { id: f.action.id });
  await entered;
  try {
    await assert.rejects(dispatch(f.host, 'recover'), { code: 'INVOICE_HOST_BUSY' });
    assert.equal(savedJob(f.store, f.job.id).reservedMinor, '20');
    assert.equal(records(f.store, 'invoice-simulated-delivery-v1')[0].status, 'reserved');
    assert.equal(f.store.read().actions[0].status, 'executing'); assert.equal(f.store.read().actions[0].attempts.length, 1);
  } finally { release(); }
  const sent = await running; assert.equal(sent.status, 'verified'); assert.equal(sent.attempts.length, 1);
  assert.equal(savedJob(f.store, f.job.id).reservedMinor, '0'); assert.equal(savedJob(f.store, f.job.id).spentMinor, '22');
  assert.equal(records(f.store, 'invoice-simulated-delivery-v1')[0].status, 'sent');
});
