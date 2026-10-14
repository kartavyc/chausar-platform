import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import * as reports from '../../app/ui/src/screens/reports/validate.ts';
import * as tools from '../../app/ui/src/screens/tools/validate.ts';
import * as trust from '../../app/ui/src/screens/trust/validate.ts';

// The real engine's replies, read through each screen's own validator: the two sides of
// the reportsx.* / trustx.* contract must agree. Synthetic records only.
const csv = `id,kind,date,amount,currency,customerId,invoiceId,dueDate,status,description
sale-a,sale,2026-09-03,1250.25,INR,customer-a,invoice-a,,delivered,Delivered goods
cost-a,cost,2026-09-03,500.00,INR,customer-a,invoice-a,,settled,Goods cost
invoice-a,invoice,2026-09-02,2200.00,INR,customer-a,invoice-a,2026-09-15,unpaid,Invoice
payment-a,payment,2026-09-06,1100.00,INR,customer-a,invoice-a,,settled,Settled receipt
`;
const recipe = {
  version: 1, id: 'synthetic-contract-v1', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Contract Co', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    ...['customerId', 'invoiceId', 'status', 'description'].map(name => ({ target: name, source: name, type: 'string', nulls: 'omit' })),
    { target: 'dueDate', source: 'dueDate', type: 'date', dateFormat: 'ISO', nulls: 'omit' },
  ],
  allowedKinds: ['invoice', 'payment', 'sale', 'cost'], allowedStatuses: ['settled', 'delivered', 'unpaid'], onUnmapped: 'reject',
};
const september = { from: '2026-09-01', to: '2026-09-30' };

test('every reportsx and trustx reply passes the validator of the screen that draws it', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-rtt-contract-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'reports-tools-trust': { clock: () => Date.parse('2026-10-14T06:00:00.000Z') } } });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Contract Co', passphrase: 'Synthetic contract passphrase 2026', demo: false, pack: 'ecommerce' });
  await engine.request('sources.import', { sourceId: 'synthetic-contract-source', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 4, amountMinor: '505025' } });
  const call = (method: string, payload: Record<string, unknown> = {}) => engine.request(method, payload);
  const failures: string[] = [];
  const pass = async (method: string, payload: Record<string, unknown>, validate: (reply: unknown) => unknown) => {
    const reply = await call(method, payload);
    try { validate(reply); } catch (error) { failures.push(`${method} ${(error as { path?: string }).path ?? (error as Error).message}`); }
    return reply as any;
  };

  // Reports
  const packs = await pass('reportsx.packs', {}, reports.validatePacks);
  for (const pack of packs.packs) for (const page of pack.pages) {
    for (const language of ['en', 'hi']) await pass('reportsx.page', { pack: pack.id, page: page.id, language, period: september }, reports.validatePage);
  }
  for (const format of ['csv', 'xlsx', 'html']) await pass('reportsx.export', { pack: 'lender', page: 'key-financials', format, period: september }, reports.validateExportedFile);
  await pass('reportsx.weekAhead', {}, reports.validateWeekAhead);
  await pass('reportsx.friday', {}, reports.validateFriday);
  await pass('reportsx.rhythm', {}, reports.validateRhythm);
  await pass('reportsx.setRhythm', { dailyClosing: true }, reports.validateRhythm);
  await pass('reportsx.setDueProfile', { kind: 'trader', gstMode: 'regular', state: 'MH' }, reports.validateDueProfile);
  await pass('reportsx.due', {}, reports.validateDue);
  await pass('reportsx.exportAll', { confirmed: true }, reports.validateExportRecord);
  await pass('reportsx.exports', {}, reports.validateExports);
  const receiptId = (await call('reportsx.page', { pack: 'lender', page: 'key-financials', period: september })).receiptIds[0];
  await pass('reportsx.askPerson', { question: 'Why did sales fall?', reason: 'Not yet', receiptId }, reports.validateAskPerson);

  // Trust
  await pass('trustx.rules', {}, trust.validateRules);
  await pass('trustx.markings', {}, trust.validateMarkings);
  await pass('trustx.setMarking', { kind: 'confidential', target: { type: 'source', sourceId: 'synthetic-contract-source' }, on: true }, trust.validateMarkings);
  await pass('trustx.sendLevels', {}, trust.validateSendLevels);
  await pass('trustx.setSend', { level: 'shape' }, trust.validateChange);
  await pass('trustx.pendingChanges', {}, trust.validatePending);
  await pass('trustx.keep', {}, trust.validateKeep);
  await pass('trustx.autonomy', {}, trust.validateAutonomy);
  await pass('trustx.setAutonomy', { preset: 'routine' }, trust.validateAutonomy);
  await pass('trustx.seats', {}, trust.validateSeats);
  await pass('trustx.invite', { seat: 'accountant', name: 'Synthetic Accountant' }, trust.validateInvite);
  await pass('trustx.models', {}, trust.validateModels);
  await pass('trustx.network', {}, trust.validateNetwork);
  await pass('trustx.plantCanary', {}, trust.validatePlanted);
  await pass('trustx.record', {}, trust.validateRecord);
  await pass('trustx.verifyRecord', {}, trust.validateVerify);
  await pass('trustx.sharing', {}, trust.validateSharing);
  await pass('trustx.cleanSample', { text: 'GSTIN 27AAPFU0939F1ZV, call 9876543210' }, trust.validateCleaned);
  await pass('trustx.vault', {}, trust.validateVault);
  await pass('trustx.backupNow', {}, trust.validateBackup);
  await pass('trustx.hosted', {}, trust.validateHosted);
  await pass('trustx.agreements', {}, trust.validateAgreements);
  await pass('trustx.deleteSource', { sourceId: 'synthetic-contract-source', confirmation: 'synthetic-contract-source' }, trust.validateDeletion);
  await pass('trustx.deletions', {}, trust.validateDeletions);

  // Tools
  await pass('trustx.assistants', {}, tools.assistants);
  await pass('trustx.setAssistants', { on: true }, tools.assistants);
  await pass('trustx.plugins', {}, tools.plugins);
  await pass('trustx.languagePacks', {}, tools.languagePacks);
  assert.deepEqual(failures, []);
});
