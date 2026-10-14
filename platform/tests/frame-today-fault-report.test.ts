import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { isFaultReport, isActivityReply } from '../../app/ui/src/bridge/todayx-contract.ts';

const recipe = {
  version: 1, id: 'frame-fault-fixture-v1', system: 'fixture-csv', edition: '1', scope: { company: 'Kiran Secret Traders', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'description', 'branch'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
  ],
  allowedKinds: ['sale', 'payment'], allowedStatuses: ['settled'], onUnmapped: 'reject',
};

test('the fault report carries kinds and codes only, never names, amounts, file names, cell values or questions', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-fault-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Kiran Secret Traders', passphrase: 'Frame fault synthetic passphrase 2026', demo: true, pack: 'ecommerce', folder: 'main' });

  const secrets = ['Kiran', 'Secret', 'Meera Confidential', 'ledger-march-private.csv', 'SECRETCELLVALUE', 'customer-hidden-77', 'SECRETQUESTION', '9876543', '98765.43', 'AAPFU0939F', 'private-route-label'];
  await engine.request('members.add', { id: 'frame-person', name: 'Meera Confidential', role: 'accountant', branches: ['*'] });
  await engine.request('todayx.identity.save', { fields: { pan: 'AAPFU0939F' }, gstMode: null });
  const content = 'id,kind,date,amount,currency,customerId,description,branch\nrow-1,sale,2026-09-03,98765.43,INR,customer-hidden-77,SECRETCELLVALUE,main\n';
  await engine.request('sources.import', { sourceId: 'ledger-march-private.csv', format: 'csv', content, recipe, expectedTotals: { rowCount: 1, amountMinor: '9876543' } });
  await assert.rejects(engine.request('sources.import', { sourceId: 'ledger-march-private.csv', format: 'csv', content: content + 'row-2,sale,2026-09-04,1.00,INR,customer-hidden-77,SECRETCELLVALUE,main\n', recipe, expectedTotals: { rowCount: 9, amountMinor: '9876543' } }));
  await engine.request('conversation.ask', { question: 'How much did SECRETQUESTION Kiran pay?' }).catch(() => null);
  await engine.request('models.configure', { kind: 'ollama', model: 'private-route-label', label: 'private-route-label', endpoint: 'http://127.0.0.1:11434' }).catch(() => null);

  const report = await engine.request('todayx.faultReport', {});
  assert.ok(isFaultReport(report), JSON.stringify(report));
  assert.equal(report.os, process.platform);
  assert.ok(report.eventKinds.includes('import.done'));
  assert.ok(report.eventKinds.includes('source.refused'));
  assert.ok(report.errorCodes.includes('RECONCILIATION'));
  const text = JSON.stringify(report);
  for (const secret of secrets) assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, `fault report leaked ${secret}`);
  // Every string is a kind or a code: no spaces, no free text.
  for (const value of [...report.eventKinds, ...report.routeHealth.flatMap((r: any) => [r.kind, r.state]), ...report.errorCodes]) assert.match(value, /^[A-Za-z0-9._-]+$/);

  // The activity record names ids and digits, never the cell values or the question.
  const activity = await engine.request('todayx.activity', {});
  assert.ok(isActivityReply(activity));
  const record = JSON.stringify(activity);
  for (const secret of ['SECRETCELLVALUE', 'SECRETQUESTION', 'customer-hidden-77', 'AAPFU0939F']) assert.equal(record.includes(secret), false, `activity leaked ${secret}`);
});
