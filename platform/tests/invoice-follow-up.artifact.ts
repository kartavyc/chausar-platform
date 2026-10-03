import assert from 'node:assert/strict';
import { InvoiceFollowUpHost } from '../runtime/invoice-follow-up.ts';
import type { Job, JobConfig } from '../runtime/jobs.ts';
import type { PreparedAction } from '../runtime/actions.ts';
import { appendPayment, customerId, invoiceId, owner, seedInvoiceFixture, sourceIds } from './invoice-follow-up.fixture.ts';

// A reproducible local artifact; every record and every price below is synthetic.
const store = await seedInvoiceFixture();
const host = new InvoiceFollowUpHost(store, { clock: store.clock, workerId: 'synthetic-artifact-worker', maxActiveJobs: 8,
  leaseMs: 1000, approvalTtlMs: 60000, dailyCap: 5, perCustomerDailyCap: 1,
  dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20' });
const call = <T = unknown>(method: string, request: unknown = {}) => host.dispatch(owner, `invoiceFollowUp.${method}`, request) as Promise<T>;
await call('consent.record', { requestId: 'artifact-opt-in', customerId, channel: 'simulation', destination: 'synthetic-customer:one',
  status: 'yes', sourceId: sourceIds[0], evidence: 'Labelled synthetic opt-in', at: new Date(store.clock()).toISOString() });
const config: JobConfig = { ownerId: owner.memberId, goal: 'Follow the synthetic invoice for a week and show collected and open amounts with proof',
  input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:one' }], acceptanceTest: 'Show collected and open amounts with proof',
    reviewAt: '2026-10-07T12:00:00.000Z', calculation: { reserveMinor: '10', durationMs: 5000 }, preparation: { reserveMinor: '10', durationMs: 5000 } },
  budgetMinor: '500', reserveMinor: '20', stopRule: { maxRuns: 7, deadline: '2026-10-08T12:00:00.000Z' },
  nextRunAt: new Date(store.clock()).toISOString(), intervalMs: 86400000, catchup: 'latest', graceMs: 0, requiresApproval: false,
  sourceIds, limits: { modelUnits: 0, durationMs: 20000, actionExposureMinor: '0' },
  allowedActions: ['simulated-invoice-reminder.send'], testedRoutes: [], background: false };
const job = await call<Job>('create', config), week: unknown[] = [];
for (let day = 1; day <= 7; day++) {
  const delivered = await call<Job>('run', { id: job.id });
  const invoice = (delivered.deliverable as any).result.invoices[0];
  week.push({ day, at: new Date(store.clock()).toISOString(), outstandingMinor: invoice.balance.outstandingMinor,
    collectedMinor: invoice.balance.collectedMinor, outcome: invoice.balance.outcome, receiptId: invoice.balance.receiptId });
  if (day === 1) {
    const action = store.read().actions[0] as PreparedAction;
    await call('reminder.approve', { id: action.id, digest: action.digest });
    const sent = await call<PreparedAction>('reminder.execute', { id: action.id }); assert.equal(sent.businessSuccess, false);
  }
  await call('accept', { id: job.id, repeat: day < 7 });
  if (day < 7) store.advance(86400000);
  if (day === 1) await appendPayment(store);
}
const state = store.read(), final = state.jobs[0] as Job;
assert.equal(final.status, 'accepted'); assert.equal(final.spentMinor, '34'); assert.equal(final.reservedMinor, '0');
const cappedStore = await seedInvoiceFixture(), cappedHost = new InvoiceFollowUpHost(cappedStore, {
  ...host.options, clock: cappedStore.clock, simulatedStepCostMinor: '250' });
const cappedCall = <T = unknown>(method: string, request: unknown = {}) => cappedHost.dispatch(owner, `invoiceFollowUp.${method}`, request) as Promise<T>;
await cappedCall('consent.record', { requestId: 'artifact-cap-opt-in', customerId, channel: 'simulation', destination: 'synthetic-customer:one',
  status: 'yes', sourceId: sourceIds[0], evidence: 'Labelled synthetic opt-in', at: new Date(cappedStore.clock()).toISOString() });
const capped = await cappedCall<Job>('create', { ...config, reserveMinor: '500', input: { ...(config.input as Record<string, unknown>),
  calculation: { reserveMinor: '250', durationMs: 5000 }, preparation: { reserveMinor: '250', durationMs: 5000 } } });
await cappedCall('run', { id: capped.id }); const unsent = cappedStore.read().actions[0] as PreparedAction;
await cappedCall('reminder.approve', { id: unsent.id, digest: unsent.digest });
await assert.rejects(cappedCall('reminder.execute', { id: unsent.id }), { code: 'JOB_BUDGET_EXHAUSTED' });
const stopped = cappedStore.read().jobs[0] as Job;
assert.equal(stopped.status, 'budget-blocked'); assert.equal(stopped.spentMinor, '500');
console.log(JSON.stringify({ artifact: 'invoice-follow-up-synthetic-week-v1', mode: 'simulation', week,
  outcomes: state.answers.filter(a => ['invoice-simulated-delivery-v1', 'invoice-paid-v1'].includes(a.kind)).map(a => ({
    outcome: a.kind === 'invoice-paid-v1' ? 'paid' : a.status, at: a.sentAt ?? a.at, receiptId: a.receiptId ?? null,
    booksPayments: a.paymentFactIds?.length ?? 0, bankMatches: a.bankFactIds?.length ?? 0 })),
  status: final.status, runs: final.runs, budgetMinor: final.budgetMinor, spentMinor: final.spentMinor, reservedMinor: final.reservedMinor,
  fiveRupeeStop: { status: stopped.status, budgetMinor: stopped.budgetMinor, spentMinor: stopped.spentMinor,
    reservedMinor: stopped.reservedMinor, unfinished: ['individually approved reminder remains unsent'],
    ledgerEvent: stopped.ledger.at(-1)?.event, deliveryAttempts: cappedStore.read().actions[0].attempts.length } }, null, 2));
