import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { Engine } from '../source/platform/runtime/engine.ts';
import { createLocalServer } from '../source/platform/runtime/server.ts';
import type { InvoiceHostOptions } from '../source/platform/runtime/invoice-follow-up.ts';
import type { ImportInput, MappingRecipe } from '../source/platform/runtime/ingest.ts';

// Prepared for the parent to run; this review has not imported or executed it.
// Adapted from the pinned invoice-follow-up-engine-public.test.ts fixture.
// Only public synthetic CSV/Engine HTTP operations create and delete evidence.
// The final read inspects the actual encrypted Vault's retained authority state.
const NAME = 'SYNTHETIC invoice source deletion regression';
const PASSWORD = 'SYNTHETIC disposable deletion regression passphrase';
const BOOKS = 'synthetic-deletion-invoice-books';
const BANK = 'synthetic-deletion-invoice-bank';
const TARGET = { invoiceId: 'synthetic-invoice-one', customerId: 'synthetic-customer-one', invoiceLink: 'synthetic-invoice:one' };
const DAY_MS = 86_400_000;

function importInput(sourceId: string, rows: string[], amountMinor: string): ImportInput {
  const recipe: MappingRecipe = {
    version: 1, id: `${sourceId}-explicit-v1`, system: 'synthetic-csv', edition: 'synthetic-fixture',
    scope: { company: NAME, branches: ['main'] }, bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
      { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' },
      ...['currency', 'customerId', 'invoiceId', 'status', 'branch'].map(field => ({
        target: field, source: field, type: 'string' as const, nulls: 'reject' as const,
      })),
      { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
      { target: 'paymentEntityId', source: 'paymentEntityId', type: 'string', nulls: 'omit' },
    ], allowedKinds: ['invoice', 'payment', 'bank_line'], allowedStatuses: ['unpaid', 'settled', 'matched'], onUnmapped: 'reject',
  };
  return { sourceId, format: 'csv', recipe, expectedTotals: { rowCount: rows.length, amountMinor },
    content: 'id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,branch,paymentEntityId\n' + rows.join('\n') };
}

test('public source deletion purges retained invoice operation amounts with their contributing source', { timeout: 25_000 }, async t => {
  const base = resolve(tmpdir());
  assert.equal(parse(base).root.toLowerCase(), 'c:\\', 'This disposable regression is restricted to the approved C: temporary workspace.');
  const prefix = 'chausar-invoice-source-deletion-';
  const directory = await mkdtemp(join(base, prefix));
  const syntheticNow = Date.now() + 60_000;
  const clock = () => syntheticNow;
  const iso = () => new Date(clock()).toISOString();
  let providerCalls = 0;
  const policy: InvoiceHostOptions = { clock, workerId: 'synthetic-deletion-invoice-worker', maxActiveJobs: 8, leaseMs: 1000,
    approvalTtlMs: 60_000, dailyCap: 5, perCustomerDailyCap: 1,
    dayKey: instant => new Date(instant).toISOString().slice(0, 10), stopWord: 'STOP',
    simulatedStepCostMinor: '1', simulatedSendCostMinor: '20' };
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', invoiceFollowUp: policy,
    gateway: { http: async () => { providerCalls++; throw new Error('Synthetic deletion regression must never dispatch a model.'); } } });
  const app = createLocalServer(engine);
  t.after(async () => {
    await app.close(5000);
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child)
      && child.startsWith(prefix) && target.startsWith(join(base, prefix)), 'Cleanup must remain in this owned temporary child.');
    await rm(target, { recursive: true, force: true });
  });
  const { origin, token } = await app.listen();
  assert.equal(new URL(origin).hostname, '127.0.0.1');
  async function rpc(method: string, payload: unknown = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as { error?: unknown; result: any };
    assert.equal(response.status, 200); assert.equal(body.error, undefined, JSON.stringify(body.error));
    return body.result;
  }
  const invoice = (method: string, payload: unknown = {}) => rpc(`invoiceFollowUp.${method}`, payload);
  await rpc('workspace.create', { name: NAME, folder: 'fixture', passphrase: PASSWORD, demo: true, pack: 'ecommerce' });
  const current = (await rpc('ontology.get')).current;
  const draft = Object.fromEntries(['pack', 'label', 'currency', 'gstMode', 'fields', 'definitions'].map(key => [key, current[key]]));
  await rpc('ontology.publish', { draft: { ...draft, fields: { ...current.fields, paymentEntityId: 'string' } } });
  await rpc('sources.import', importInput(BOOKS, [
    'synthetic-invoice-one,invoice,2026-09-01,10000,INR,synthetic-customer-one,synthetic-invoice-one,2026-09-30,unpaid,main,',
    'synthetic-payment-one,payment,2026-09-30,2500,INR,synthetic-customer-one,synthetic-invoice-one,,settled,main,',
  ], '12500'));
  await rpc('sources.import', importInput(BANK, [
    'synthetic-bank-one,bank_line,2026-09-30,2500,INR,synthetic-customer-one,synthetic-invoice-one,,matched,main,synthetic-payment-one',
  ], '2500'));
  await rpc('trust.update', { autonomy: true });
  const job = await invoice('create', { ownerId: 'owner', goal: 'Review one SYNTHETIC invoice before deleting its source',
    budgetMinor: '500', reserveMinor: '20', sourceIds: [BOOKS, BANK], requiresApproval: true,
    stopRule: { maxRuns: 1, deadline: new Date(clock() + 3 * DAY_MS).toISOString() }, nextRunAt: iso(), intervalMs: DAY_MS,
    catchup: 'latest', graceMs: 0, limits: { modelUnits: 0, durationMs: 20_000, actionExposureMinor: '0' },
    allowedActions: ['simulated-invoice-reminder.send'], testedRoutes: [], background: false,
    input: { targets: [TARGET], acceptanceTest: 'Retain the exact unpaid balance and ask for missing synthetic customer consent.',
      reviewAt: new Date(clock() + DAY_MS).toISOString(), calculation: { reserveMinor: '10', durationMs: 2000 },
      preparation: { reserveMinor: '10', durationMs: 2000 } } });
  await invoice('approve', { id: job.id, digest: job.digest });
  assert.equal((await invoice('run', { id: job.id })).status, 'awaiting-acceptance');
  const before = engine.vault!.read();
  const operations = before.answers.filter(answer => answer.kind === 'invoice-job-operation-v1' && answer.key.startsWith(`${job.id}:revision:`));
  assert.equal(operations.length, 2);
  assert.ok(operations.some(operation => operation.settlement.result.value.outstandingMinor === '7500'
    && operation.settlement.result.value.collectedMinor === '2500'), 'The retained operation must contain the independently expected synthetic amounts.');
  const operationIds = new Set(operations.map(operation => operation.id));
  const receiptIds = new Set(before.answers.filter(answer => answer.kind === 'invoice-balance-proof-v1' && answer.jobId === job.id)
    .map(proof => proof.receiptId));
  assert.equal(receiptIds.size, 1);
  assert.equal(before.actions.length, 0, 'No reminder is prepared without synthetic customer consent.');
  await rpc('sources.delete', { id: BOOKS });
  const after = engine.vault!.read();
  assert.ok(!after.facts.some(fact => fact.sourceId === BOOKS));
  assert.ok(!after.jobs.some(retained => retained.id === job.id));
  assert.ok(!after.receipts.some(receipt => receiptIds.has(receipt.id)));
  assert.equal(providerCalls, 0);
  assert.deepEqual(after.answers.filter(answer => operationIds.has(answer.id)), [],
    'Source deletion must purge the derived invoice operation amounts, not only their receipt/proof/job records.');
});
