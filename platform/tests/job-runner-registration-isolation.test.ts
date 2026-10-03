import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionService } from '../runtime/actions.ts';
import { createEngineJobRunner } from '../runtime/engine-jobs.ts';
import { InvoiceFollowUpHost } from '../runtime/invoice-follow-up.ts';
import { JobService, type Job, type JobConfig } from '../runtime/jobs.ts';
import { customerId, invoiceId, owner, seedInvoiceFixture, sourceIds, type InvoiceFixtureStore } from './invoice-follow-up.fixture.ts';

// Separate installed hosts share only labelled synthetic authority and receipts.
// No model, native database, account, network transport or delivery is installed.
const lifecycle = { awake: true, windowOpen: true, backgroundEnabled: false };
const iso = (store: InvoiceFixtureStore) => new Date(store.clock()).toISOString();
function hosts(store: InvoiceFixtureStore) {
  const invoices = new InvoiceFollowUpHost(store, {
    clock: store.clock, workerId: 'synthetic-invoice-host', maxActiveJobs: 8, leaseMs: 1000,
    approvalTtlMs: 60000, dailyCap: 5, perCustomerDailyCap: 1,
    dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
    simulatedStepCostMinor: '1', simulatedSendCostMinor: '20',
  });
  const jobs = new JobService(store, { clock: store.clock });
  const generic = createEngineJobRunner(store, jobs, new ActionService(store), {}, {
    clock: store.clock, workerId: 'synthetic-generic-host', maxActiveJobs: 8, leaseMs: 1000,
    networkAvailable: () => false,
  });
  jobs.deliverableGuard = (context, job) => generic.canRelease(context, job);
  return { invoices, jobs, generic };
}
function mandate(store: InvoiceFixtureStore): JobConfig {
  return {
    ownerId: owner.memberId, goal: 'Review only the selected synthetic invoice with retained balance proof',
    budgetMinor: '100', reserveMinor: '20', stopRule: { maxRuns: 2, deadline: '2026-10-08T12:00:00.000Z' },
    nextRunAt: iso(store), intervalMs: 86400000, catchup: 'latest', graceMs: 0,
    requiresApproval: true, sourceIds: [...sourceIds],
    limits: { modelUnits: 0, durationMs: 20000, actionExposureMinor: '0' },
    testedRoutes: [], allowedActions: [], background: false,
  };
}
async function invoice(host: InvoiceFollowUpHost, store: InvoiceFixtureStore) {
  const job = await host.dispatch(owner, 'invoiceFollowUp.create', {
    ...mandate(store), allowedActions: ['simulated-invoice-reminder.send'],
    input: {
      targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:one' }],
      acceptanceTest: 'Show the selected balance and explain missing customer consent', reviewAt: '2026-10-07T12:00:00.000Z',
      calculation: { reserveMinor: '10', durationMs: 5000 }, preparation: { reserveMinor: '10', durationMs: 5000 },
    },
  }) as Job;
  await host.dispatch(owner, 'invoiceFollowUp.approve', { id: job.id, digest: job.digest });
  return job;
}
async function calculation(host: ReturnType<typeof hosts>['generic'], store: InvoiceFixtureStore) {
  const job = await host.create(owner, {
    ...mandate(store), type: 'calculation-set',
    input: { requests: [{ id: 'billed', input: { operation: 'billed', asOf: iso(store) }, reserveMinor: '10', durationMs: 5000 }] },
  });
  await host.jobs.approve(owner, job.id, job.digest);
  return job;
}
const saved = (store: InvoiceFixtureStore, id: string) => store.read().jobs.find((job: Job) => job.id === id) as Job;

test('each scheduler skips another installed host type while completing its own due work', async () => {
  const store = await seedInvoiceFixture(), f = hosts(store);
  // Invoice comes first in the common job list, reproducing the starvation case.
  const otherHostJob = await invoice(f.invoices, store);
  const ownJob = await calculation(f.generic, store);
  const invoiceBefore = saved(store, otherHostJob.id);

  const genericResults = await f.generic.tick(owner, lifecycle);
  assert.deepEqual(genericResults.map(job => job.id), [ownJob.id]);
  assert.equal(genericResults[0].status, 'awaiting-acceptance');
  assert.equal(genericResults[0].spentMinor, '0');
  assert.deepEqual(saved(store, otherHostJob.id), invoiceBefore);
  assert.equal(store.read().receipts.length, 1);
  const calculationResult = (genericResults[0].deliverable as { result: { calculations: { value: { receiptId: string; valueMinor: string } }[] } }).result.calculations[0];
  assert.equal(calculationResult.value.valueMinor, '10000');
  assert.equal(store.read().receipts[0].id, calculationResult.value.receiptId);
  const genericBefore = saved(store, ownJob.id);

  const invoiceResults = await f.invoices.dispatch(owner, 'invoiceFollowUp.tick', lifecycle) as Job[];
  assert.deepEqual(invoiceResults.map(job => job.id), [otherHostJob.id]);
  assert.equal(invoiceResults[0].status, 'awaiting-acceptance');
  assert.deepEqual(saved(store, ownJob.id), genericBefore);
  const view = await f.invoices.dispatch(owner, 'invoiceFollowUp.read', { id: otherHostJob.id }) as {
    job: Job; reminders: unknown[]; outcomes: unknown[];
  };
  const invoiceResult = (view.job.deliverable as { result: { invoices: { balance: { receiptId: string; outstandingMinor: string }; reminder: { reason: string } }[] } }).result.invoices[0];
  assert.equal(invoiceResult.balance.outstandingMinor, '7500');
  assert.equal(invoiceResult.reminder.reason, 'customer-opt-in-required');
  assert.equal(store.read().receipts.length, 2);
  assert.notEqual(invoiceResult.balance.receiptId, calculationResult.value.receiptId);
  assert.deepEqual(view.reminders, []); assert.deepEqual(view.outcomes, []);
  assert.deepEqual(store.read().actions, []); assert.deepEqual(store.read().modelReceipts, []);
});

test('exclusive generic restart recovers installed and untyped work while preserving another host lease', async () => {
  const store = await seedInvoiceFixture(), f = hosts(store);
  const otherHostJob = await invoice(f.invoices, store);
  const ownJob = await calculation(f.generic, store);
  const legacyJob = await f.jobs.create(owner, { ...mandate(store), type: 'owner-brief' });
  await f.jobs.approve(owner, legacyJob.id, legacyJob.digest);
  await f.invoices.jobs.acquire(owner, otherHostJob.id, 'synthetic-other-host-before-crash', 1000);
  await f.jobs.acquire(owner, ownJob.id, 'synthetic-installed-before-crash', 1000);
  await f.jobs.acquire(owner, legacyJob.id, 'synthetic-legacy-before-crash', 1000);
  const reopened = store.restart(), restarted = hosts(reopened);
  const invoiceBefore = saved(reopened, otherHostJob.id);
  assert.equal(invoiceBefore.status, 'running'); assert.equal(invoiceBefore.reservedMinor, '20');

  assert.deepEqual(await restarted.generic.recoverInterrupted(owner), { recovered: [ownJob.id, legacyJob.id] });
  assert.deepEqual(saved(reopened, otherHostJob.id), invoiceBefore);
  for (const id of [ownJob.id, legacyJob.id]) {
    const recovered = saved(reopened, id);
    assert.equal(recovered.status, 'scheduled'); assert.equal(recovered.reservedMinor, '0');
    assert.equal(recovered.lease, undefined); assert.equal(recovered.ledger.at(-1)?.event, 'process-interrupted');
  }

  // Its own host subsequently reclaims the invoice reservation exactly once.
  assert.deepEqual(await restarted.invoices.dispatch(owner, 'invoiceFollowUp.recover', {}), { recovered: [] });
  const recoveredInvoice = saved(reopened, otherHostJob.id);
  assert.equal(recoveredInvoice.status, 'scheduled'); assert.equal(recoveredInvoice.reservedMinor, '0');
  assert.equal(recoveredInvoice.lease, undefined);
  assert.equal(recoveredInvoice.ledger.at(-1)?.event, 'process-interrupted');
  const invoiceAfter = structuredClone(recoveredInvoice);
  assert.deepEqual(await restarted.generic.recoverInterrupted(owner), { recovered: [] });
  assert.deepEqual(saved(reopened, otherHostJob.id), invoiceAfter);
  assert.deepEqual(reopened.read().receipts, []); assert.deepEqual(reopened.read().actions, []);
});
