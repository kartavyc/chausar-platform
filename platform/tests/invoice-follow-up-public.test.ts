import test from 'node:test';
import assert from 'node:assert/strict';
import { InvoiceFollowUpHost, type InvoiceHostOptions } from '../runtime/invoice-follow-up.ts';
import type { PreparedAction } from '../runtime/actions.ts';
import type { Job, JobConfig } from '../runtime/jobs.ts';
import { MemoryService } from '../runtime/memory.ts';
import { appendPayment, customerId, invoiceId, owner, seedInvoiceFixture, sourceIds, type InvoiceFixtureStore } from './invoice-follow-up.fixture.ts';

// Public source-contract acceptance with labelled synthetic state/time/costs.
// These checks exercise no vendor, model, real customer or native database.
const dayMs = 86_400_000;
const iso = (store: InvoiceFixtureStore) => new Date(store.clock()).toISOString();
function options(store: InvoiceFixtureStore, patch: Partial<InvoiceHostOptions> = {}): InvoiceHostOptions {
  return { clock: store.clock, workerId: 'synthetic-worker', maxActiveJobs: 8, leaseMs: 1000,
    approvalTtlMs: 60000, dailyCap: 5, perCustomerDailyCap: 1,
    dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
    simulatedStepCostMinor: '1', simulatedSendCostMinor: '20', ...patch };
}
function config(store: InvoiceFixtureStore, patch: Partial<JobConfig> = {}): JobConfig {
  return { goal: 'Follow the selected synthetic invoice for one week and show collected and open amounts with proof',
    input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:one' }],
      acceptanceTest: 'Show collected and open amounts with proof', reviewAt: '2026-10-07T12:00:00.000Z',
      calculation: { reserveMinor: '10', durationMs: 5000 }, preparation: { reserveMinor: '10', durationMs: 5000 } },
    budgetMinor: '500', reserveMinor: '20', stopRule: { maxRuns: 7, deadline: '2026-10-08T12:00:00.000Z' },
    nextRunAt: iso(store), intervalMs: dayMs, catchup: 'latest', graceMs: 0, requiresApproval: false,
    sourceIds: [...sourceIds], limits: { modelUnits: 0, durationMs: 20000, actionExposureMinor: '0' },
    allowedActions: ['simulated-invoice-reminder.send'], testedRoutes: [], background: false, ...patch };
}
type InvoiceView = { job: Job; progress: { remainingStepIds: string[] }; reminders: PreparedAction[];
  outcomes: { kind: string; status?: string; at: string; sentAt?: string; paymentFactIds?: string[]; bankFactIds?: string[] }[] };
type InvoiceResult = { mode: string; businessSuccess: boolean; invoices: { balance: {
  receiptId: string; proofId: string; outstandingMinor: string; collectedMinor: string; outcome: string;
}; reminder: { actionId?: string; skipped?: boolean; reason?: string } }[] };
const result = (job: Job) => (job.deliverable as { result: InvoiceResult }).result;
async function consent(host: InvoiceFollowUpHost, store: InvoiceFixtureStore, id = customerId, destination = 'synthetic-customer:one') {
  return host.dispatch(owner, 'invoiceFollowUp.consent.record', { requestId: `synthetic-opt-in-${id}`, customerId: id,
    channel: 'simulation', destination, status: 'yes', sourceId: sourceIds[0], evidence: 'Synthetic opt-in', at: iso(store) });
}
async function fixture(patch: Partial<InvoiceHostOptions> = {}) {
  const store = await seedInvoiceFixture(), host = new InvoiceFollowUpHost(store, options(store, patch));
  const call = <T = unknown>(method: string, request: unknown = {}) => host.dispatch(owner, `invoiceFollowUp.${method}`, request) as Promise<T>;
  return { store, host, call, read: (id: string) => call<InvoiceView>('read', { id }) };
}

test('public invoice mandate carries a synthetic week from approved delivery to separately evidenced payment', async () => {
  const f = await fixture(); await consent(f.host, f.store);
  const job = await f.call<Job>('create', config(f.store));
  assert.equal(job.type, 'invoice-follow-up'); assert.equal(job.ownerId, owner.memberId);
  assert.equal(job.budgetMinor, '500'); assert.equal(job.stopRule.maxRuns, 7);
  assert.equal(job.plan!.children.length, 2); assert.equal(job.plan!.obligations.length, 1);
  const first = await f.call<Job>('run', { id: job.id });
  assert.equal(first.status, 'awaiting-acceptance'); assert.equal(first.runs, 1);
  const open = result(first).invoices[0];
  assert.equal(open.balance.outstandingMinor, '7500'); assert.equal(open.balance.collectedMinor, '2500');
  assert.equal(open.balance.outcome, 'open'); assert.ok(open.balance.receiptId);
  assert.equal(result(first).businessSuccess, false);
  const preview = (await f.read(job.id)).reminders[0];
  assert.equal(preview.status, 'prepared'); assert.equal(preview.attempts.length, 0); assert.equal(preview.approval, undefined);
  assert.match(String(preview.payload.text), /75\.00/); assert.match(String(preview.payload.text), /synthetic-invoice:one/);
  assert.match(String(preview.payload.text), /STOP/);
  await f.call('reminder.approve', { id: preview.id, digest: preview.digest });
  const sent = await f.call<PreparedAction>('reminder.execute', { id: preview.id });
  assert.equal(sent.status, 'verified'); assert.equal(sent.businessSuccess, false);
  assert.deepEqual(sent.readback!.data, { mode: 'simulation', sent: true, paid: false, sentAt: iso(f.store) });
  let publicView = await f.read(job.id);
  assert.equal(publicView.outcomes.filter(item => item.kind === 'invoice-simulated-delivery-v1').length, 1);
  assert.equal(publicView.outcomes.filter(item => item.kind === 'invoice-paid-v1').length, 0);
  assert.equal(result(publicView.job).invoices[0].balance.outcome, 'open');
  await f.call('accept', { id: job.id, repeat: true });

  f.store.advance(dayMs); await appendPayment(f.store);
  for (let day = 2; day <= 7; day++) {
    const delivered = await f.call<Job>('run', { id: job.id });
    assert.equal(delivered.status, 'awaiting-acceptance'); assert.equal(delivered.runs, day);
    const paid = result(delivered).invoices[0];
    assert.equal(paid.balance.outstandingMinor, '0'); assert.equal(paid.balance.collectedMinor, '10000');
    assert.equal(paid.balance.outcome, 'paid'); assert.equal(paid.reminder.skipped, true); assert.equal(paid.reminder.reason, 'paid');
    await f.call('accept', { id: job.id, repeat: day < 7 });
    if (day < 7) f.store.advance(dayMs);
  }
  publicView = await f.read(job.id);
  assert.equal(publicView.job.status, 'accepted'); assert.equal(publicView.job.runs, 7);
  assert.equal(publicView.job.spentMinor, '34'); assert.equal(publicView.job.reservedMinor, '0');
  assert.equal(publicView.reminders.length, 1);
  const paid = publicView.outcomes.filter(item => item.kind === 'invoice-paid-v1');
  assert.equal(paid.length, 1); assert.equal(paid[0].paymentFactIds!.length, 2); assert.equal(paid[0].bankFactIds!.length, 2);
  assert.equal(paid[0].at, '2026-10-02T12:00:00.000Z');
  assert.equal(publicView.outcomes.find(item => item.kind === 'invoice-simulated-delivery-v1')!.sentAt, '2026-10-01T12:00:00.000Z');
  assert.equal(f.store.read().modelReceipts.length, 0);
});

test('public invoice mandate without customer opt-in returns proof and prepares no reminder', async () => {
  const f = await fixture(), job = await f.call<Job>('create', config(f.store));
  const delivered = await f.call<Job>('run', { id: job.id });
  assert.equal(delivered.status, 'awaiting-acceptance');
  assert.equal(result(delivered).invoices[0].balance.outstandingMinor, '7500');
  assert.equal(result(delivered).invoices[0].reminder.skipped, true);
  assert.equal(result(delivered).invoices[0].reminder.reason, 'customer-opt-in-required');
  const publicView = await f.read(job.id); assert.deepEqual(publicView.reminders, []); assert.deepEqual(publicView.outcomes, []);
  assert.equal((await f.call<Job>('accept', { id: job.id })).status, 'accepted');
});

test('public invoice previews each require an exact approval and retrying approval or execution preserves one effect', async () => {
  const f = await fixture();
  await new MemoryService(f.store).append(owner, [{ entityId: 'invoice-two', sourceId: sourceIds[0], sourceRow: 4,
    kind: 'invoice', validFrom: '2026-09-01', branch: 'main', fields: { invoiceId: 'invoice-two', customerId: 'customer-two',
      amountMinor: '12000', currency: 'INR', dueDate: '2026-09-30', status: 'unpaid' } }], { testLearnedAt: iso(f.store) });
  await consent(f.host, f.store); await consent(f.host, f.store, 'customer-two', 'synthetic-customer:two');
  const base = config(f.store), input = base.input as { targets: unknown[] };
  const job = await f.call<Job>('create', { ...base, reserveMinor: '40', input: { ...input,
    targets: [...input.targets, { invoiceId: 'invoice-two', customerId: 'customer-two', invoiceLink: 'synthetic-invoice:two' }] } });
  await f.call('run', { id: job.id }); const [first, second] = (await f.read(job.id)).reminders;
  assert.equal((await f.read(job.id)).reminders.length, 2);
  await assert.rejects(f.call('reminder.execute', { id: first.id }), { code: 'APPROVAL_REQUIRED' });
  await assert.rejects(f.call('reminder.approve', { id: first.id, digest: second.digest }), { code: 'PREVIEW_CHANGED' });
  const approved = await f.call<PreparedAction>('reminder.approve', { id: first.id, digest: first.digest });
  assert.deepEqual(await f.call('reminder.approve', { id: first.id, digest: first.digest }), approved);
  assert.equal(f.store.read().answers.filter(item => item.kind === 'invoice-reminder-approval-v1' && item.actionId === first.id).length, 1);
  await assert.rejects(f.call('reminder.execute', { id: second.id }), { code: 'APPROVAL_REQUIRED' });
  const sent = await f.call<PreparedAction>('reminder.execute', { id: first.id });
  assert.deepEqual(await f.call('reminder.execute', { id: first.id }), sent);
  assert.equal(sent.attempts.length, 1); assert.equal(sent.businessSuccess, false);
  assert.equal((await f.read(job.id)).outcomes.filter(item => item.status === 'sent').length, 1);
  await assert.rejects(f.call('accept', { id: job.id }), { code: 'INVOICE_REMINDERS_UNRESOLVED' });
  await f.call('reminder.approve', { id: second.id, digest: second.digest }); await f.call('reminder.execute', { id: second.id });
  assert.equal((await f.call<Job>('accept', { id: job.id })).status, 'accepted');
  assert.equal((await f.read(job.id)).outcomes.filter(item => item.status === 'sent').length, 2);
});

test('public repeated run of a delivered invoice mandate preserves its occurrence without duplicate calculations or previews', async () => {
  const f = await fixture(); await consent(f.host, f.store); const job = await f.call<Job>('create', config(f.store));
  await f.call('run', { id: job.id }); const before = f.store.read();
  const repeated = await f.call<Job>('run', { id: job.id });
  assert.equal(repeated.status, 'awaiting-acceptance'); assert.equal(repeated.runs, 1);
  assert.equal(f.store.read().receipts.length, before.receipts.length); assert.equal(f.store.read().actions.length, before.actions.length);
  assert.equal((await f.read(job.id)).job.spentMinor, '2');
  await assert.rejects(f.call('accept', { id: job.id }), { code: 'INVOICE_REMINDERS_UNRESOLVED' });
  const preview = (await f.read(job.id)).reminders[0]; await f.call('reminder.cancel', { id: preview.id });
  assert.equal((await f.call<Job>('accept', { id: job.id })).status, 'accepted');
  assert.deepEqual((await f.read(job.id)).outcomes, []);
});

test('public lost delivery response remains unresolved until readback after a copied-store restart', async () => {
  const f = await fixture(); await consent(f.host, f.store); const job = await f.call<Job>('create', config(f.store));
  await f.call('run', { id: job.id }); const preview = (await f.read(job.id)).reminders[0];
  await f.call('reminder.approve', { id: preview.id, digest: preview.digest });
  f.store.afterCommit = state => { if (state.answers.some(item => item.kind === 'invoice-simulated-delivery-v1' && item.status === 'sent')) {
    f.store.afterCommit = undefined; throw new Error('Labelled synthetic delivery response loss');
  } };
  const uncertain = await f.call<PreparedAction>('reminder.execute', { id: preview.id });
  assert.equal(uncertain.status, 'unknown'); assert.equal(uncertain.attempts.length, 1);
  await assert.rejects(f.call('accept', { id: job.id }), { code: 'INVOICE_REMINDERS_UNRESOLVED' });
  const copy = f.store.restart(), restarted = new InvoiceFollowUpHost(copy, options(copy));
  await restarted.dispatch(owner, 'invoiceFollowUp.recover', {});
  const reused = await restarted.dispatch(owner, 'invoiceFollowUp.reminder.execute', { id: preview.id }) as PreparedAction;
  assert.equal(reused.status, 'unknown'); assert.equal(reused.attempts.length, 1);
  const settled = await restarted.dispatch(owner, 'invoiceFollowUp.reminder.reconcile', { id: preview.id }) as PreparedAction;
  assert.equal(settled.status, 'verified'); assert.equal(settled.businessSuccess, false);
  const publicView = await restarted.dispatch(owner, 'invoiceFollowUp.read', { id: job.id }) as InvoiceView;
  assert.equal(publicView.outcomes.filter(item => item.status === 'sent').length, 1); assert.equal(publicView.job.spentMinor, '22');
  assert.equal(publicView.job.reservedMinor, '0');
  assert.equal((await restarted.dispatch(owner, 'invoiceFollowUp.accept', { id: job.id }) as Job).status, 'accepted');
});

test('public latest and skip catch-up honor sleep and preserve one fresh occurrence after restart', async () => {
  const f = await fixture(); await consent(f.host, f.store);
  const latest = await f.call<Job>('create', config(f.store)), skip = await f.call<Job>('create', config(f.store, { catchup: 'skip' }));
  f.store.advance(3 * dayMs);
  assert.deepEqual(await f.call('tick', { awake: false, windowOpen: true, backgroundEnabled: true }), []);
  assert.deepEqual(await f.call('tick', { awake: true, windowOpen: false, backgroundEnabled: false }), []);
  assert.equal(f.store.read().receipts.length, 0);
  const copy = f.store.restart(), host = new InvoiceFollowUpHost(copy, options(copy));
  await host.dispatch(owner, 'invoiceFollowUp.recover', {});
  const ran = await host.dispatch(owner, 'invoiceFollowUp.tick', { awake: true, windowOpen: true, backgroundEnabled: false }) as Job[];
  const caught = ran.find(item => item.id === latest.id)!;
  assert.equal(caught.status, 'awaiting-acceptance'); assert.equal(caught.runs, 1);
  assert.equal((caught.deliverable as { scheduledFor: string }).scheduledFor, latest.nextRunAt);
  const proof = result(caught).invoices[0].balance;
  assert.equal(copy.read().receipts.find(item => item.id === proof.receiptId).asOf, iso(copy));
  const skipped = ran.find(item => item.id === skip.id)!;
  assert.equal(skipped.status, 'scheduled'); assert.equal(skipped.runs, 0); assert.equal(skipped.nextRunAt, '2026-10-05T12:00:00.000Z');
  assert.equal(copy.read().actions.length, 1); assert.equal(copy.read().receipts.length, 1);
  assert.deepEqual(await host.dispatch(owner, 'invoiceFollowUp.tick', { awake: true, windowOpen: true, backgroundEnabled: false }), []);
});

test('public background lifecycle runs only an explicitly enabled invoice job when its window is closed', async () => {
  const f = await fixture();
  const foreground = await f.call<Job>('create', config(f.store)), background = await f.call<Job>('create', config(f.store, { background: true }));
  assert.deepEqual(await f.call('tick', { awake: true, windowOpen: false, backgroundEnabled: false }), []);
  const ran = await f.call<Job[]>('tick', { awake: true, windowOpen: false, backgroundEnabled: true });
  assert.deepEqual(ran.map(item => item.id), [background.id]); assert.equal(ran[0].status, 'awaiting-acceptance');
  assert.equal((await f.read(foreground.id)).job.status, 'scheduled');
});

test('public resource admission and shared budget prevent additional invoice work or simulated delivery', async () => {
  const f = await fixture({ simulatedStepCostMinor: '10' }); await consent(f.host, f.store);
  await assert.rejects(f.call('create', config(f.store, { reserveMinor: '19' })), { code: 'JOB_PLAN_EXCEEDS_LIMITS' });
  await assert.rejects(f.call('create', config(f.store, { limits: { modelUnits: 0, durationMs: 9999, actionExposureMinor: '0' } })), { code: 'JOB_PLAN_EXCEEDS_LIMITS' });
  const job = await f.call<Job>('create', config(f.store, { budgetMinor: '20' }));
  await f.call('run', { id: job.id }); const preview = (await f.read(job.id)).reminders[0];
  await f.call('reminder.approve', { id: preview.id, digest: preview.digest });
  await assert.rejects(f.call('reminder.execute', { id: preview.id }), { code: 'JOB_BUDGET_EXHAUSTED' });
  const blocked = await f.read(job.id); assert.equal(blocked.job.status, 'budget-blocked');
  assert.equal(blocked.job.spentMinor, '20'); assert.equal(blocked.job.reservedMinor, '0');
  assert.equal(blocked.reminders[0].attempts.length, 0); assert.deepEqual(blocked.outcomes, []);

  const g = await fixture({ simulatedStepCostMinor: '10' });
  const repeating = await g.call<Job>('create', config(g.store, { budgetMinor: '20' }));
  await g.call('run', { id: repeating.id }); await g.call('accept', { id: repeating.id, repeat: true });
  g.store.advance(dayMs); const receipts = g.store.read().receipts.length;
  assert.equal((await g.call<Job>('run', { id: repeating.id })).status, 'budget-blocked');
  assert.equal(g.store.read().receipts.length, receipts); assert.equal((await g.read(repeating.id)).job.spentMinor, '20');
});

test('public invoice stop deadline admits no calculation or reminder after expiry', async () => {
  const f = await fixture(); await consent(f.host, f.store); const job = await f.call<Job>('create', config(f.store));
  f.store.advance(7 * dayMs);
  const stopped = await f.call<Job>('run', { id: job.id }); assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.runs, 0); assert.equal(stopped.spentMinor, '0');
  assert.deepEqual((await f.read(job.id)).reminders, []); assert.equal(f.store.read().receipts.length, 0);
  assert.equal(stopped.ledger.at(-1)!.event, 'stop-rule');
});

test('public five-rupee mandate records its budget stop and names the unsent reminder', async () => {
  const f = await fixture({ simulatedStepCostMinor: '250' }); await consent(f.host, f.store);
  const base = config(f.store), input = base.input as Record<string, unknown>;
  const job = await f.call<Job>('create', { ...base, budgetMinor: '500', reserveMinor: '500', input: { ...input,
    calculation: { reserveMinor: '250', durationMs: 5000 }, preparation: { reserveMinor: '250', durationMs: 5000 } } });
  await f.call('run', { id: job.id }); const action = (await f.read(job.id)).reminders[0];
  await f.call('reminder.approve', { id: action.id, digest: action.digest });
  await assert.rejects(f.call('reminder.execute', { id: action.id }), { code: 'JOB_BUDGET_EXHAUSTED' });
  const stopped = await f.read(job.id);
  assert.equal(stopped.job.status, 'budget-blocked'); assert.equal(stopped.job.spentMinor, '500');
  assert.equal(stopped.job.reservedMinor, '0'); assert.equal(stopped.reminders[0].id, action.id);
  assert.equal(stopped.reminders[0].attempts.length, 0); assert.deepEqual(stopped.outcomes, []);
  assert.ok(stopped.job.ledger.some(line => line.event === 'invoice-budget-stopped' && line.reason === action.id));
});

test('public mandate approval and pause controls reuse the existing authority interface', async () => {
  const f = await fixture(), job = await f.call<Job>('create', config(f.store, { requiresApproval: true }));
  assert.equal((await f.call<Job>('run', { id: job.id })).status, 'approval-blocked');
  await assert.rejects(f.call('approve', { id: job.id, digest: 'wrong' }), { code: 'PREVIEW_CHANGED' });
  await f.call('approve', { id: job.id, digest: job.digest });
  assert.equal((await f.call<Job>('pause', { id: job.id })).status, 'paused');
  assert.equal((await f.call<Job>('resume', { id: job.id })).status, 'scheduled');
  assert.equal((await f.call<Job>('run', { id: job.id })).status, 'awaiting-acceptance');
  assert.equal(f.store.read().actions.length, 0);
});

test('public customer reminder cap is shared by distinct mandates and records the refused action', async () => {
  const f = await fixture(); await consent(f.host, f.store);
  const first = await f.call<Job>('create', config(f.store)), second = await f.call<Job>('create', config(f.store));
  await f.call('run', { id: first.id }); await f.call('run', { id: second.id });
  const a = (await f.read(first.id)).reminders[0], b = (await f.read(second.id)).reminders[0];
  await f.call('reminder.approve', { id: a.id, digest: a.digest }); await f.call('reminder.approve', { id: b.id, digest: b.digest });
  await f.call('reminder.execute', { id: a.id });
  await assert.rejects(f.call('reminder.execute', { id: b.id }), { code: 'INVOICE_DAILY_CAP' });
  const refused = await f.read(second.id);
  assert.equal(refused.job.spentMinor, '2'); assert.equal(refused.job.reservedMinor, '0');
  assert.equal(refused.reminders[0].attempts.length, 0); assert.deepEqual(refused.outcomes, []);
  assert.ok(refused.job.ledger.some(line => line.event === 'invoice-daily-cap-stopped' && line.reason === b.id));
});

test('public invoice lifecycle leaves other installed jobs and actions untouched in the shared store', async () => {
  const f = await fixture(), invoice = await f.call<Job>('create', config(f.store));
  await f.store.update(state => {
    state.jobs.push({ ...structuredClone(invoice), id: 'other-scheduled', type: 'calculation-set' });
    state.jobs.push({ ...structuredClone(invoice), id: 'other-running', type: 'private-investigation', status: 'running' });
    state.actions.push({ id: 'other-action', connector: 'other-connector', operation: 'send', payload: {}, status: 'executing', attempts: [{ outcome: 'executing' }] });
  });
  const before = f.store.read();
  const ran = await f.call<Job[]>('tick', { awake: true, windowOpen: true, backgroundEnabled: false });
  assert.deepEqual(ran.map(job => job.id), [invoice.id]);
  await f.call('recover');
  const after = f.store.read();
  assert.deepEqual(after.jobs.filter(job => job.type !== 'invoice-follow-up'), before.jobs.filter(job => job.type !== 'invoice-follow-up'));
  assert.deepEqual(after.actions.find(action => action.id === 'other-action'), before.actions.find(action => action.id === 'other-action'));
});
