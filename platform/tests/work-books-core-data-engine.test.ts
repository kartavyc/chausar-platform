import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

// Through the real engine with the merged core-data lane: deleting one customer (BK-20) and a meaning's
// worked example and date used (BK-08). Synthetic data only.
const csv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,order-a,2026-09-15,unpaid,First invoice,main
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,order-a,,settled,Settled receipt,main
invoice-b,invoice,2026-09-04,500.00,INR,customer-b,invoice-b,order-b,2026-09-20,unpaid,Second invoice,main
`;
const recipe = {
  version: 1, id: 'synthetic-core-data-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Core Shop', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment', 'sale'], allowedStatuses: ['settled', 'delivered', 'unpaid'], onUnmapped: 'reject',
};

async function open(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-work-books-core-data-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Core Shop', passphrase: 'Synthetic core passphrase 2026', demo: false, pack: 'ecommerce', folder: 'main' });
  await engine.request('sources.import', { sourceId: 'shop-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 3, amountMinor: '380000' } });
  return engine;
}

test('BK-20 with the real core-data: the plan comes from deletion.customerPlan and one customer\'s core rows are deleted', async t => {
  const engine = await open(t);
  const plan = await engine.request('records.deletionPlan', { id: 'customer-a' });
  assert.equal(plan.coreDeletion.available, true); assert.equal(plan.coreDeletion.planFrom, 'core');
  const facts = plan.stores.find((s: any) => s.store === 'facts');
  assert.ok(facts && facts.count >= 2, 'customer-a holds two facts');
  await assert.rejects(engine.request('records.delete', { id: 'customer-a', confirmation: 'customer-b' }), (e: any) => typeof e.code === 'string');
  const report = await engine.request('records.delete', { id: 'customer-a', confirmation: 'customer-a' });
  assert.equal(report.rows.find((r: any) => r.store === 'facts').state, 'deleted');
  assert.ok(report.derived, 'core-data reports what it changed around the deletion');
  const left = await engine.request('records.search', { kind: 'customer' });
  assert.deepEqual(left.records.map((r: any) => r.id), ['customer-b'], 'only the other customer remains');
});

test('BK-08 with the real core-data: a draft carries a worked example and the date used, and they publish with the word', async t => {
  const engine = await open(t);
  const meanings = await engine.request('books.meanings', {});
  const word = meanings.words.find((w: any) => w.name === 'billed');
  const current = (await engine.request('books.meaning', { name: 'billed' })).word;
  const draft = await engine.request('books.draft', { name: 'billed', definition: { label: current.label, meaning: current.meaning, kind: current.kind, field: current.field, nulls: current.nulls,
    example: { rows: [{ label: 'Invoice one', amountMinor: '220000', counted: true }, { label: 'A cancelled invoice', amountMinor: '5000', counted: false, reason: 'Cancelled before delivery.' }], resultMinor: '220000' },
    usedFrom: '2026-04-01' } });
  assert.ok(word); assert.equal(draft.extras, 'published-with', 'the merged compiler accepts the extras');
  const published = await engine.request('books.publish', { draftId: draft.id, digest: draft.digest });
  assert.ok(published.version >= 2);
  const after = (await engine.request('books.meaning', { name: 'billed' })).word;
  assert.equal(after.usedFrom, '2026-04-01');
  assert.equal(after.example.resultMinor, '220000'); assert.equal(after.example.rows.length, 2);
});

test('WK-14 with the real driving lane: the status and the window list come from session.*; this computer cannot be driven here', async t => {
  const engine = await open(t);
  const status = await engine.request('approvals.drivingStatus', {});
  assert.equal(status.available, true, 'the driving lane is installed');
  assert.equal(status.status.state, 'idle');
  assert.deepEqual(status.rules, { windows: 1, mode: 'read-export', typesSecrets: false });
  // No desktop driver in this test process: the lane says so with a code, and nothing can start.
  assert.equal(status.driver.available, false); assert.match(status.driver.code, /^[A-Z][A-Z0-9_]+$/);
  assert.deepEqual(status.windows, []);
  await assert.rejects(engine.request('approvals.drivingStart', { windowId: 'window-1' }), (e: any) => typeof e.code === 'string');
  assert.equal((await engine.request('approvals.drivingStop', {})).status.state, 'idle', 'stop is idempotent');
});
