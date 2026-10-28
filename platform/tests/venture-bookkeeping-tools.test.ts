// Harness adapters read source tables, after cfo and bankmcp (MIT ideas).
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKKEEPING_CFO_TOOLS } from '../runtime/venture/delivery/harness/tools-bookkeeping-cfo.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { setup } from './venture-views-env.ts';
import { digest, BOOKS_SOURCE_ID } from '../runtime/venture/records.ts';

async function env(content: string): Promise<ToolEnv> {
  const base = await setup();
  const contentBase64 = Buffer.from(content).toString('base64');
  return { deps: base.deps, ventureId: base.venture.id, memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year', runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-cfo-clean', episode: 1 }, files: [{ id: 'upload_ledger', name: 'ledger.csv', format: 'csv', bytes: Buffer.byteLength(content), digest: digest(contentBase64), contentBase64, clientData: false }], tables: [], receipts: [], dictionary: [], sandbox: undefined, now: base.now, allowed: [] };
}

test('CFO ratio tool reads amounts from the source file and returns usable work receipts', async () => {
  const toolEnv = await env('kind,amount\nreceivables,3000\npayables,1000\nrevenue,9000\ncosts,6000\ninventory,2000\ncash,12000\nnet-cash,-2000');
  const out = await BOOKKEEPING_CFO_TOOLS['cfo.ratios'].run(toolEnv, { table: 'f1', days: '30' });
  assert.equal(out.receipts?.[0].figures.find(row => row.key === 'dso')?.minor, '10');
  assert.ok(out.receipts?.[0].inputs.tables.length);
  assert.ok(out.receipts?.[0].steps.length);
});

test('spending and collections tools read actual rows and never contact debtors', async () => {
  const spending = await env('id,payee,on,amount,direction\na,Tool,2026-09-10,100,out\nb,Tool,2026-10-10,110,out');
  const out = await BOOKKEEPING_CFO_TOOLS['money.checkup'].run(spending, { table: 'f1', month: '2026-10', threshold: '1000' });
  assert.equal(out.receipts?.[0].figures.find(row => row.key === 'total-out')?.minor, '11000');
  const collections = await env('client,invoice,daysLate,brokenPromises,amount\nClient,INV-A,12,2,100');
  const ladder = await BOOKKEEPING_CFO_TOOLS['collections.ladder'].run(collections, { table: 'f1' });
  assert.equal((ladder.result as any).rows[0].stage, 'call');
  assert.equal((ladder.result as any).sender, 'client');
});

test('client spending threshold is consumed as stored paise without a second rupee conversion', async () => {
  const toolEnv = await env('id,payee,on,amount,direction\na,Supplier,2026-10-10,1500,out');
  toolEnv.runRef = { kind: 'delivery', runId: 'delivery_threshold' };
  toolEnv.intake = { rights: null, format: 'long', aiVoice: false, aiPresenter: false, paidPromotion: false, cutFile: null, fields: { 'large-payment-threshold': '100000' } };
  const out = await BOOKKEEPING_CFO_TOOLS['money.checkup'].run(toolEnv, { table: 'f1', month: '2026-10' });
  assert.ok((out.result as any).data.unusual.some((row: any) => row.reason === 'large' && row.amountMinor === '150000'));
});

test('CFO ratio runtime uses only the isolated client source ledger, not service-owner balances', async () => {
  const toolEnv = await env('kind,amount\nreceivables,99999\npayables,1000\nrevenue,9000\ncosts,6000\ninventory,2000\ncash,99999\nnet-cash,99999');
  const csv = 'kind,on,amount\nreceivable,2026-10-01,3000\nreceipt,2026-10-12,9000\npayment,2026-10-15,11000\nbalance,2026-10-27,12000';
  const contentBase64 = Buffer.from(csv).toString('base64');
  toolEnv.files.push({ id: 'upload_client_source', name: 'client-ledger.csv', format: 'csv', bytes: Buffer.byteLength(csv), digest: digest(contentBase64), contentBase64, clientData: false });
  // An unrelated service-owner cost is deliberately present in the real vault.
  await toolEnv.deps.store.update(state => { state.facts.push({ id: 'service-owner-cost', entityId: 'owner-company', sourceId: BOOKS_SOURCE_ID, sourceRow: 1, kind: 'cost', validFrom: '2026-10-15', validTo: null, learnedAt: '2026-10-15T00:00:00Z', supersededAt: null, fields: { currency: 'INR', amountMinor: '900000000', taxMinor: '0' } }); });
  const out = await BOOKKEEPING_CFO_TOOLS['cfo.ratios'].run(toolEnv, { table: 'f1', ledger: 'f2', asOf: '2026-10-27', days: '30' });
  assert.equal(out.receipts?.[0].figures.find(row => row.key === 'dso')?.minor, '10');
  assert.equal(out.receipts?.[0].figures.find(row => row.key === 'runway')?.minor, '6');
  assert.equal(out.receipts?.[0].inputs.tables.length, 2);
  assert.equal(out.receipts?.[0].figures.find(row => row.key === 'cash-week-1-on-time')?.minor, '1200000');
  assert.equal(out.receipts?.[0].figures.filter(row => row.key.startsWith('cash-week-')).length, 26);
  assert.ok(!JSON.stringify(out).includes('service-owner-cost'));
});

test('the collections tool applies the owner-approved ladder to client source rows', async () => {
  const toolEnv = await env('client,invoice,daysLate,brokenPromises,amount\nClient,INV-A,12,0,100');
  const { ventureAction } = await import('../runtime/venture/records.ts');
  const { owner } = await import('./venture-views-env.ts');
  await ventureAction(toolEnv.deps, owner, 'approve', 'test.ladder', tx => tx.put({ ...tx.base('venture-collection-stage'), clientId: null, ladder: [{ id: 'reminder', fromDay: 1, name: 'Reminder' }, { id: 'call', fromDay: 10, name: 'Call now' }] }));
  const out = await BOOKKEEPING_CFO_TOOLS['collections.ladder'].run(toolEnv, { table: 'f1' });
  assert.equal((out.result as any).rows[0].stage, 'call');
});
