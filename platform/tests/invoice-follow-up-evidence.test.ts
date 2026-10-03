import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context, Fact } from '../runtime/contracts.ts';
import { InvoiceFollowUpHost, type InvoiceHostOptions, type InvoiceProof } from '../runtime/invoice-follow-up.ts';
import type { Job, JobConfig } from '../runtime/jobs.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { appendPayment, customerId, invoiceId, owner, seedInvoiceFixture, sourceIds, type InvoiceFixtureStore } from './invoice-follow-up.fixture.ts';

// Synthetic evidence qualification through the invoice public contract. No
// financial system, model, delivery transport or native database is involved.
const dayMs = 86_400_000;
const iso = (store: InvoiceFixtureStore) => new Date(store.clock()).toISOString();
const options = (store: InvoiceFixtureStore): InvoiceHostOptions => ({ clock: store.clock,
  workerId: 'synthetic-invoice-evidence-worker', maxActiveJobs: 8, leaseMs: 1000,
  approvalTtlMs: 60000, dailyCap: 20, perCustomerDailyCap: 1,
  dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
  simulatedStepCostMinor: '1', simulatedSendCostMinor: '20' });
const config = (store: InvoiceFixtureStore, scope = sourceIds): JobConfig => ({
  goal: 'Follow a synthetic invoice and prove its open and bank-collected amounts',
  input: { targets: [{ invoiceId, customerId, invoiceLink: 'synthetic-invoice:one' }],
    acceptanceTest: 'Keep a sent reminder separate from proven payment', reviewAt: '2026-10-07T12:00:00.000Z',
    calculation: { reserveMinor: '10', durationMs: 5000 }, preparation: { reserveMinor: '10', durationMs: 5000 } },
  budgetMinor: '500', reserveMinor: '20', stopRule: { maxRuns: 7, deadline: '2026-10-08T12:00:00.000Z' },
  nextRunAt: iso(store), intervalMs: dayMs, catchup: 'latest', graceMs: 0, requiresApproval: false,
  sourceIds: [...scope], limits: { modelUnits: 0, durationMs: 20000, actionExposureMinor: '0' },
  allowedActions: ['simulated-invoice-reminder.send'], testedRoutes: [], background: false });
type InvoiceResult = { invoices: { balance: { proofId: string; receiptId: string; outstandingMinor: string;
  collectedMinor: string; outcome: string; reasons: string[] }; reminder: { skipped?: boolean; reason?: string; question?: string | null } }[] };
const result = (job: Job) => (job.deliverable as { result: InvoiceResult }).result.invoices[0];
const dispatch = <T = unknown>(host: InvoiceFollowUpHost, method: string, request: unknown = {}, context: Context = owner) =>
  host.dispatch(context, `invoiceFollowUp.${method}`, request) as Promise<T>;
const records = (store: InvoiceFixtureStore, kind: string) => store.read().answers.filter(answer => answer.kind === kind);
const factInput = (fact: Fact, patch: Partial<FactInput> = {}): FactInput => ({ entityId: fact.entityId,
  sourceId: fact.sourceId, sourceRow: fact.sourceRow, kind: fact.kind, validFrom: fact.validFrom,
  validTo: fact.validTo, branch: fact.branch, fields: structuredClone(fact.fields), ...patch });
const append = (store: InvoiceFixtureStore, facts: FactInput[]) => new MemoryService(store).append(owner, facts, { testLearnedAt: iso(store) });
const consentInput = (store: InvoiceFixtureStore) => ({ requestId: 'synthetic-evidence-consent', customerId,
  channel: 'simulation', destination: 'synthetic-customer:one', status: 'yes', sourceId: sourceIds[0],
  evidence: 'Synthetic customer opt-in evidence', at: iso(store) });
async function run(store: InvoiceFixtureStore, scope = sourceIds) {
  const host = new InvoiceFollowUpHost(store, options(store));
  await dispatch(host, 'consent.record', consentInput(store));
  const job = await dispatch<Job>(host, 'create', config(store, scope));
  const delivered = await dispatch<Job>(host, 'run', { id: job.id });
  assert.equal(delivered.status, 'awaiting-acceptance');
  const invoice = result(delivered);
  const proof = records(store, 'invoice-balance-proof-v1').find(record => record.id === invoice.balance.proofId) as InvoiceProof;
  assert.ok(proof);
  return { host, job, delivered, invoice, proof };
}

test('invoice evidence: a future bank event cannot establish collection before the aging observation date', async () => {
  const store = await seedInvoiceFixture(); await appendPayment(store);
  const bank = store.read().facts.find(fact => fact.entityId === 'bank-line-one')!;
  await append(store, [factInput(bank, { validFrom: '2026-10-02' })]);
  const f = await run(store);
  assert.equal(f.invoice.balance.outstandingMinor, '0'); assert.equal(f.invoice.balance.collectedMinor, '7500');
  assert.equal(f.invoice.balance.outcome, 'cleared-unconfirmed');
  assert.deepEqual(f.invoice.balance.reasons, ['books-payment-needs-exact-bank-match']);
  assert.deepEqual(f.proof.bankFactIds.map(id => store.read().facts.find(fact => fact.id === id)!.entityId), ['bank-line-two']);
  assert.equal(records(store, 'invoice-paid-v1').length, 0); assert.equal(store.read().actions.length, 0);
  const receipt = store.read().receipts.find(receipt => receipt.id === f.invoice.balance.receiptId)!;
  assert.equal(receipt.assumptions.onDate, '2026-10-01');
  await dispatch(f.host, 'accept', { id: f.job.id, repeat: true }); store.advance(dayMs);
  const later = result(await dispatch<Job>(f.host, 'run', { id: f.job.id }));
  assert.equal(later.balance.collectedMinor, '10000'); assert.equal(later.balance.outcome, 'paid');
  assert.equal(records(store, 'invoice-paid-v1').length, 1);
});

test('invoice evidence: two bank lines claiming one books payment cannot establish paid', async () => {
  const store = await seedInvoiceFixture(); await appendPayment(store);
  const bank = store.read().facts.find(fact => fact.entityId === 'bank-line-one')!;
  await append(store, [factInput(bank, { entityId: 'bank-line-one-duplicate', sourceRow: 4 })]);
  const f = await run(store);
  assert.equal(f.invoice.balance.outstandingMinor, '0'); assert.equal(f.invoice.balance.collectedMinor, '7500');
  assert.equal(f.invoice.balance.outcome, 'cleared-unconfirmed');
  assert.deepEqual(f.invoice.balance.reasons, ['books-payment-needs-exact-bank-match']);
  assert.equal(f.proof.bankFactIds.length, 1); assert.equal(records(store, 'invoice-paid-v1').length, 0);
  assert.equal(store.read().actions.length, 0);
});

test('invoice evidence: conflicting in-scope bank claims cannot establish paid', async () => {
  const store = await seedInvoiceFixture(); await appendPayment(store);
  const bank = store.read().facts.find(fact => fact.entityId === 'bank-line-one')!;
  const otherSource = 'synthetic-bank-conflict';
  await append(store, [factInput(bank, { sourceId: otherSource, sourceRow: 4,
    fields: { ...bank.fields, amountMinor: '9999' } })]);
  const f = await run(store, [...sourceIds, otherSource]);
  assert.equal(f.invoice.balance.collectedMinor, '7500'); assert.equal(f.invoice.balance.outcome, 'cleared-unconfirmed');
  assert.ok(f.invoice.balance.reasons.includes('books-payment-needs-exact-bank-match'));
  assert.equal(records(store, 'invoice-paid-v1').length, 0); assert.equal(store.read().actions.length, 0);
});

test('invoice evidence: an out-of-scope conflicting bank claim cannot poison the selected-source match', async () => {
  const store = await seedInvoiceFixture(); await appendPayment(store);
  const bank = store.read().facts.find(fact => fact.entityId === 'bank-line-one')!;
  await append(store, [factInput(bank, { sourceId: 'synthetic-bank-outside-mandate', sourceRow: 4,
    fields: { ...bank.fields, amountMinor: '9999' } })]);
  const f = await run(store);
  assert.equal(f.invoice.balance.outstandingMinor, '0'); assert.equal(f.invoice.balance.collectedMinor, '10000');
  assert.equal(f.invoice.balance.outcome, 'paid'); assert.deepEqual(f.invoice.balance.reasons, []);
  assert.equal(f.proof.bankFactIds.length, 2);
  for (const id of f.proof.bankFactIds) assert.equal(store.read().facts.find(fact => fact.id === id)!.sourceId, sourceIds[1]);
  assert.equal(records(store, 'invoice-paid-v1').length, 1); assert.equal(store.read().actions.length, 0);
});

test('invoice evidence: credit clearance remains distinct from a bank-proven payment', async () => {
  const store = await seedInvoiceFixture();
  await append(store, [{ entityId: 'synthetic-credit-note', sourceId: sourceIds[0], sourceRow: 4,
    kind: 'refund', validFrom: '2026-10-01', branch: 'main', fields: { invoiceId, customerId,
      amountMinor: '7500', currency: 'INR', status: 'settled', description: 'Synthetic credit note; no cash received.' } }]);
  const f = await run(store);
  assert.equal(f.invoice.balance.outstandingMinor, '0'); assert.equal(f.invoice.balance.collectedMinor, '2500');
  assert.equal(f.invoice.balance.outcome, 'cleared-unconfirmed'); assert.equal(f.invoice.reminder.reason, 'cleared-unconfirmed');
  assert.equal(f.invoice.reminder.skipped, true); assert.equal(f.proof.paymentFactIds.length, 1);
  assert.equal(records(store, 'invoice-paid-v1').length, 0); assert.equal(store.read().actions.length, 0);
  assert.equal(f.delivered.ledger.filter(entry => entry.event === 'invoice-paid').length, 0);
});

test('invoice evidence: a disputed invoice asks its owner and creates no reminder', async () => {
  const store = await seedInvoiceFixture(); const invoice = store.read().facts.find(fact => fact.entityId === invoiceId)!;
  await append(store, [factInput(invoice, { fields: { ...invoice.fields, disputed: true } })]);
  const f = await run(store);
  assert.equal(f.invoice.balance.outstandingMinor, '7500'); assert.equal(f.invoice.balance.outcome, 'needs-review');
  assert.ok(f.invoice.balance.reasons.includes('disputed-invoice'));
  assert.equal(f.invoice.reminder.skipped, true); assert.equal(f.invoice.reminder.reason, 'needs-review');
  assert.match(f.invoice.reminder.question!, /Review.*disputed.*before contacting/);
  assert.equal(store.read().actions.length, 0); assert.equal(records(store, 'invoice-simulated-delivery-v1').length, 0);
  assert.equal(records(store, 'invoice-paid-v1').length, 0);
});

test('invoice public guards: simulation methods refuse a workspace whose demo authority was removed', async () => {
  const store = await seedInvoiceFixture(), host = new InvoiceFollowUpHost(store, options(store));
  await store.update(state => { state.workspace.demo = false; }); const before = store.read();
  for (const [method, request] of [['create', config(store)], ['consent.record', consentInput(store)],
    ['tick', { awake: true, windowOpen: true, backgroundEnabled: false }]] as const) {
    await assert.rejects(dispatch(host, method, request), { code: 'INVOICE_SIMULATION_ONLY' });
  }
  assert.deepEqual(store.read(), before);
});

test('invoice public guards: source-tainted input cannot create a mandate or record opt-in', async () => {
  const store = await seedInvoiceFixture(), host = new InvoiceFollowUpHost(store, options(store));
  const tainted = { ...owner, sourceTainted: true };
  await assert.rejects(dispatch(host, 'create', config(store), tainted), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(dispatch(host, 'consent.record', consentInput(store), tainted), { code: 'APP_APPROVAL_REQUIRED' });
  assert.equal(store.read().jobs.length, 0); assert.equal(records(store, 'invoice-opt-in-v1').length, 0);
});

test('invoice public guards: explicit host limits and declared request fields are required', async () => {
  const store = await seedInvoiceFixture();
  for (const patch of [{ approvalTtlMs: 0 }, { dailyCap: 0 }, { perCustomerDailyCap: 0 }, { stopWord: 'STOP;SEND' }]) {
    assert.throws(() => new InvoiceFollowUpHost(store, { ...options(store), ...patch }), { code: 'INVOICE_POLICY_REQUIRED' });
  }
  const host = new InvoiceFollowUpHost(store, options(store));
  await assert.rejects(dispatch(host, 'create', { ...config(store), realDelivery: true }), { code: 'INVALID_INVOICE_REQUEST' });
  await assert.rejects(dispatch(host, 'consent.record', { ...consentInput(store), destination: 'customer@example.test' }), { code: 'INVALID_INVOICE_REQUEST' });
  await assert.rejects(dispatch(host, 'tick', { awake: true, windowOpen: true, backgroundEnabled: false, sendAnyway: true }), { code: 'INVALID_INVOICE_REQUEST' });
  assert.equal(store.read().jobs.length, 0); assert.equal(records(store, 'invoice-opt-in-v1').length, 0);
});
