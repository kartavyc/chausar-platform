import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { encryptAgile, xlsx } from './core-data-workbook-fixture.ts';

const passphrase = 'Synthetic workbook vault passphrase 2026';
const password = 'Fixture-Excel-Password-7731';
const header = ['id', 'kind', 'date', 'amount', 'currency', 'customerId', 'invoiceId', 'status', 'branch'];
const rows = [header, ['sale-a', 'sale', '2026-09-03', '1250.25', 'INR', 'customer-a', 'invoice-a', 'delivered', 'main'], ['sale-b', 'sale', '2026-09-04', '799.75', 'INR', 'customer-b', 'invoice-b', 'delivered', 'main']];
const recipe = {
  version: 1, id: 'encrypted-workbook-v1', system: 'independent-xlsx', edition: '1', scope: { company: 'Encrypted Workbook Business', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'status', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
  ],
  allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
};
async function files(directory: string): Promise<string[]> {
  const out: string[] = []; for (const name of await readdir(directory)) { const path = join(directory, name); if ((await stat(path)).isDirectory()) out.push(...await files(path)); else out.push(path); } return out;
}

test('sources.workbook* open an encrypted workbook with a one-time password that leaves no trace', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-workbook-')); const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Encrypted Workbook Business', passphrase, demo: false, folder: 'main' });
  const bytesBase64 = encryptAgile(xlsx(rows, 'Sales'), password).toString('base64');
  const input = { sourceId: 'encrypted-sales', bytesBase64, recipe, expectedTotals: { rowCount: 2, amountMinor: '205000' } };
  await assert.rejects(engine.request('sources.workbookPreview', input), { code: 'PASSWORD_REQUIRED' });
  await assert.rejects(engine.request('sources.workbookPreview', { ...input, password: 'not-the-password' }), { code: 'WRONG_PASSWORD' });
  await assert.rejects(engine.request('sources.workbookImport', input), { code: 'PASSWORD_REQUIRED' });
  await assert.rejects(engine.request('sources.workbook', { bytesBase64, password: 7 }), { code: 'WORKBOOK_PASSWORD_INVALID' });
  assert.deepEqual((await engine.request('sources.workbook', { bytesBase64, password })).sheets[0].rows, rows);
  const preview = await engine.request('sources.workbookPreview', { ...input, password });
  assert.equal(preview.accepted, true);
  const imported = await engine.request('sources.workbookImport', { ...input, password, sheet: 'Sales' });
  assert.equal(imported.rowIds.length, 2); assert.notEqual(imported.duplicate, true);
  // The same workbook, encrypted again under a fresh salt, is the same content: a duplicate, not a new import.
  assert.equal((await engine.request('sources.workbookImport', { ...input, bytesBase64: encryptAgile(xlsx(rows, 'Sales'), password).toString('base64'), password })).duplicate, true);
  const facts = (await engine.request('memory.list')).facts; assert.equal(facts.length, 2);
  // No trace of the password in state (imports, retained inputs, activity, audit, learning) or on disk.
  const state = JSON.stringify((engine as any).vault.read());
  for (const needle of [password, Buffer.from(password).toString('base64'), Buffer.from(password, 'utf16le').toString('base64'), Buffer.from(password).toString('hex')]) assert.equal(state.includes(needle), false);
  assert.equal(/"password"/i.test(state), false);
  await engine.request('workspace.lock');
  for (const path of await files(directory)) { const bytes = await readFile(path); assert.equal(bytes.includes(Buffer.from(password)), false); assert.equal(bytes.includes(Buffer.from(password, 'utf16le')), false); }
});
