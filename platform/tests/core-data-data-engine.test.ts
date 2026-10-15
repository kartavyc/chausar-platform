import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, type State } from '../runtime/contracts.ts';
import { Engine } from '../runtime/engine.ts';
import { readRegister, registerKey } from '../runtime/core-data/deletion-register.ts';
import { preparedExportNames, preparedExportPurge, rememberPreparedExports } from '../runtime/core-data/prepared-exports.ts';

// Data operations through the real engine: the workspace time zone (TD-04), workspace delete removing prepared exports
// (WK-02), and deletions re-applied after a restore (WK-15). Synthetic data only.

const csv = `id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,order-a,2026-09-15,unpaid,First invoice,main
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,order-a,,settled,Settled receipt,main
invoice-b,invoice,2026-09-04,500.00,INR,customer-b,invoice-b,order-b,2026-09-20,unpaid,Second invoice,west
`;
const recipe = {
  version: 1, id: 'synthetic-data-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Data Shop', branches: ['main', 'west'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'orderId', 'status', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment'], allowedStatuses: ['settled', 'unpaid'], onUnmapped: 'reject',
};
const NAME = 'Synthetic Data Shop', PASSPHRASE = 'Synthetic data operations passphrase 2026';
const code = (value: string) => (error: unknown) => (error as { code?: string }).code === value;
async function engineFor(t: { after(fn: () => Promise<void>): void }, demoWorkspace: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-engine-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', demoWorkspace ? { name: NAME, passphrase: PASSPHRASE, demo: true }
    : { name: NAME, passphrase: PASSPHRASE, demo: false, pack: 'ecommerce', folder: 'main' });
  return { engine, directory };
}

test('TD-04: the workspace time zone is stored, served by workspace.timeZone and by ui.context', async t => {
  const { engine } = await engineFor(t, false);
  assert.deepEqual(await engine.request('workspace.timeZone', {}), { timeZone: null });
  assert.equal((await engine.request('ui.context', {})).timeZone, null);
  for (const bad of ['Mars/Olympus', '', 'x'.repeat(101), 42]) await assert.rejects(engine.request('workspace.setTimeZone', { timeZone: bad }), code('INVALID_TIME_ZONE'));
  await assert.rejects(engine.request('workspace.setTimeZone', { timeZone: 'Asia/Kolkata', extra: 1 }), code('INVALID_TIME_ZONE'));
  assert.deepEqual(await engine.request('workspace.setTimeZone', { timeZone: 'Asia/Kolkata' }), { timeZone: 'Asia/Kolkata' });
  assert.deepEqual(await engine.request('workspace.timeZone', {}), { timeZone: 'Asia/Kolkata' });
  assert.equal((await engine.request('ui.context', {})).timeZone, 'Asia/Kolkata');
  const activity = (await engine.request('activity.list', {})).items;
  assert.ok(activity.some((item: any) => item.event === 'workspace.timeZone.set'));
});

test('WK-02 exports: workspace delete removes the prepared files this workspace made and nothing else', async t => {
  const { engine, directory } = await engineFor(t, true);
  const gst = await engine.request('writeback.connect', { system: 'gst-portal', label: 'Practice GST', environment: 'practice', account: { gstin: '27ABCDE1234F1Z5' } });
  const prepared = await engine.request('writeback.prepare', { connectionId: gst.id, action: 'return.file', intentId: 'gst-2026-09', payload: { gstin: '27ABCDE1234F1Z5', period: '2026-09', form: 'GSTR-3B' } });
  const out = await engine.request('approvals.exportPrepared', { id: `writeback:${prepared.id}` });
  assert.equal(out.files.length, 2);
  // Files the workspace did not make: a name of the same shape and an unrelated file.
  const stranger = 'chausar-prepared-20200101-000000Z-strangerfile-prepared.json';
  await writeFile(join(directory, 'exports', stranger), '{}'); await writeFile(join(directory, 'exports', 'notes.txt'), 'kept');
  const deleted = await engine.request('workspace.delete', { confirmation: NAME });
  for (const file of out.files) assert.ok(deleted.copiesRemoved.includes(`exports/${file.name}`), file.name);
  assert.deepEqual((await readdir(join(directory, 'exports'))).sort(), ['notes.txt', stranger].sort());
});

test('WK-02 exports: names are kept in private state, validated, and never followed out of the exports folder', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-exports-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const state: State = initialState('Synthetic exports', true);
  const good = 'chausar-prepared-20261014-101010Z-abcdef123456-2-checklist.txt';
  state.activity.push({ id: 'e1', at: '2026-10-14T10:10:10.000Z', event: 'approvals.exported', details: { files: [good, '../escape-prepared.json', 'chausar-prepared-20261014-101010Z-abc-51-prepared.json', '/etc/passwd'] } });
  assert.deepEqual(preparedExportNames(state), [good]);
  assert.equal(rememberPreparedExports(state), 1);
  state.activity = []; // a keep period trims the activity log
  assert.deepEqual(preparedExportNames(state), [good]);
  const { mkdir } = await import('node:fs/promises'); await mkdir(join(directory, 'exports', good), { recursive: true });
  assert.deepEqual(await preparedExportPurge(state, directory)(), [], 'a folder under that name is left alone');
});

test('WK-15 through the engine: a customer deletion comes back with a restored backup and is deleted again; a source deletion is registered', async t => {
  const { engine, directory } = await engineFor(t, false);
  await engine.request('sources.import', { sourceId: 'shop-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 3, amountMinor: '380000' } });
  const plan = await engine.request('deletion.customerPlan', { id: 'customer-a' });
  assert.equal(plan.stores[0].count, 2);
  const backup = await engine.request('workspace.backup', {});
  const report = await engine.request('deletion.customer', { id: 'customer-a', confirmation: 'customer-a' });
  assert.deepEqual(report.rows[0], { store: 'facts', count: 2, remaining: 0, state: 'deleted', reason: null });
  // The original file kept with the import is a sealed copy: named honestly, not changed.
  assert.deepEqual(report.elsewhere.map((e: any) => [e.store, e.count, e.state]), [['source-files', 1, 'not-possible'], ['decisions', 0, 'nothing-held']]);
  assert.equal((await engine.request('memory.list')).facts.some((f: any) => f.fields.customerId === 'customer-a'), false);
  assert.equal((await engine.request('deletion.pending', {})).total, 0);

  await engine.request('workspace.lock');
  await engine.request('workspace.restore', { folder: 'restored', backupFile: backup.path, passphrase: PASSPHRASE });
  assert.equal((await engine.request('memory.list')).facts.some((f: any) => f.fields.customerId === 'customer-a'), true, 'the older vault brought it back');
  assert.deepEqual((await engine.request('deletion.pending', {})).kinds, [{ kind: 'customer', cameBack: 1 }, { kind: 'source', cameBack: 0 }]);
  await assert.rejects(engine.request('deletion.reapply', { confirmation: 'customer-a' }), code('CONFIRMATION_REQUIRED'));
  const again = await engine.request('deletion.reapply', { confirmation: NAME });
  assert.equal(again.complete, true); assert.deepEqual(again.kinds[0], { kind: 'customer', cameBack: 1, deleted: 1, remaining: 0, state: 'deleted', reason: null });
  assert.equal((await engine.request('memory.list')).facts.some((f: any) => f.fields.customerId === 'customer-a'), false);

  await engine.request('sources.delete', { id: 'shop-export' });
  const id = engine.vault!.read().workspace.id;
  const entries = readRegister(directory, id);
  assert.deepEqual(entries.map(e => e.kind).sort(), ['customer', 'source']);
  assert.equal(entries.find(e => e.kind === 'source')!.key, registerKey(id, 'source', 'shop-export'));
});
