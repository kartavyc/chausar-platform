import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { checkEnvelopes, checkFreshness, checkMatch } from '../runtime/reports-ext/connector-pages.ts';
import { Calculations } from '../runtime/reports-ext/pages.ts';
import { connectorCacheStats } from '../runtime/reports-ext/connector-cache.ts';

// Synthetic books: September sales and a purchase register whose suppliers are those of the connector fixture GSTR-2B.
const books = `id,kind,date,amount,currency,customerId,invoiceId,gstin,taxMinor
sale-1,sale,2026-09-03,90000.00,INR,customer-a,S-1,,
sale-2,sale,2026-09-18,60000.00,INR,customer-b,S-2,,
refund-1,refund,2026-09-20,1500.00,INR,customer-b,S-2,,
p1,purchase,2026-09-02,10000.00,INR,,SP/0012,29ABCDE1234F1ZW,1800.00
p2,purchase,2026-09-12,5100.00,INR,,SP/0013,29ABCDE1234F1ZW,918.00
p3,purchase,2026-09-05,20000.00,INR,,KST-101,27PQRSX5678K1ZY,3600.00
p4,purchase,2026-09-21,1000.00,INR,,45,24LMNOP4321Q1ZA,180.00
p5,purchase,2026-09-25,750.00,INR,,SP/0099,29ABCDE1234F1ZW,135.00
`;
const text = (source: string, target = source, type = 'string') => ({ target, source, type, nulls: 'omit' });
const recipe = {
  version: 1, id: 'synthetic-books', system: 'books', edition: '1', scope: { company: 'Synthetic Traders', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' },
    text('customerId'), text('invoiceId'), text('gstin'), { target: 'taxMinor', source: 'taxMinor', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'omit' },
  ],
  allowedKinds: ['sale', 'refund', 'purchase'], allowedStatuses: [''], onUnmapped: 'reject',
};
const september = { from: '2026-09-01', to: '2026-09-30' };
const fixture = (path: string) => readFile(new URL(`../../fixtures/connectors/${path}`, import.meta.url), 'utf8');
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

async function open(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-reports-cx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { 'reports-tools-trust': { clock: () => Date.parse('2026-10-14T06:00:00.000Z') } } } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Traders', passphrase: 'Synthetic reports connector passphrase 2026', demo: false, pack: 'retail' });
  return engine;
}
async function importFile(engine: Engine, recipeId: string, sourceId: string, path: string, reportTotals?: Record<string, unknown>) {
  const preview = await engine.request('connectorsx.importPreview', { recipeId, sourceId, company: 'Synthetic Traders', text: await fixture(path), ...(reportTotals ? { reportTotals } : {}) });
  assert.equal(preview.status, 'accepted', JSON.stringify(preview.refusal ?? preview.abstention));
  await engine.request('connectorsx.importCommit', { envelopeId: preview.id });
}
const page = (engine: Engine, pack: string, id: string, extra: Record<string, unknown> = {}) => engine.request('reportsx.page', { pack, page: id, period: september, ...extra });
const lineOf = (built: any, id: string) => built.sections[0].lines.find((line: any) => line.id === id);
/** Every known figure opens its receipt; every other figure is a missing state. */
async function receiptsOpen(engine: Engine, built: any) {
  for (const section of built.sections) for (const line of section.lines) {
    if (line.figure.kind === 'missing') continue;
    assert.equal(line.figure.kind, 'money'); assert.ok(built.receiptIds.includes(line.figure.receiptId));
    const receipt = await engine.request('receipts.get', { id: line.figure.receiptId });
    assert.equal(receipt.id, line.figure.receiptId); assert.ok(receipt.figures.some((f: any) => f.minor === line.figure.exact));
  }
}

test('the three connector pages say plainly that nothing is imported yet', async t => {
  const engine = await open(t);
  const { packs } = await engine.request('reportsx.packs', {});
  const state = (pack: string, id: string) => packs.find((p: any) => p.id === pack).pages.find((p: any) => p.id === id);
  assert.deepEqual(state('lender', 'gst-turnover'), { id: 'gst-turnover', title: 'GST turnover against books', state: 'not-started', reason: 'Needs a GSTR-1 or GSTR-3B return imported through the GST connector.' });
  assert.equal(state('lender', 'bank-summary').reason, 'No bank statement is imported yet.');
  assert.equal(state('ca', 'purchases-gstr2b').reason, 'Needs a GSTR-2B imported through the GST connector.');
  const bank = await page(engine, 'lender', 'bank-summary', { language: 'hi' });
  assert.equal(bank.state, 'not-started'); assert.deepEqual(bank.gaps, ['अभी तक कोई बैंक विवरण आयात नहीं हुआ है।']); assert.deepEqual(bank.receiptIds, []);
});

test('GST turnover, bank summary and purchases against GSTR-2B are built from connector imports with receipts that open', async t => {
  const engine = await open(t);
  await engine.request('sources.import', { sourceId: 'books', format: 'csv', content: books, recipe, expectedTotals: { rowCount: 8, amountMinor: '18835000' } });
  await importFile(engine, 'gst.gstr1-invoices-summary', 'gstr1-sep', 'gst-downloads/gstr1-sep-2026-with-summary.json');
  await importFile(engine, 'gst.gstr3b-supplies', 'gstr3b-sep', 'gst-downloads/gstr3b-sep-2026.json', { rowCount: 5, total: '27050000' });
  await importFile(engine, 'gst.gstr2b-b2b', 'gstr2b-sep', 'gst-downloads/gstr2b-sep-2026.json');
  await importFile(engine, 'bank.statement-csv', 'bank-hdfc', 'bank-statements/hdfc-like.csv');

  const gst = await page(engine, 'lender', 'gst-turnover');
  assert.equal(gst.state, 'ready-untested'); assert.deepEqual(gst.period, september);
  assert.deepEqual(lineOf(gst, 'gst').figure.exact, '26700000', 'GSTR-1 taxable value, from the billed calculation over the GSTR-1 source only');
  assert.deepEqual(lineOf(gst, 'gstr3b').figure, { kind: 'missing', missing: 'not-counted' });
  assert.equal(lineOf(gst, 'books').figure.exact, '14850000', 'net sales over the books only: the GST sources are left out');
  assert.ok(gst.gaps.some((gap: string) => gap.startsWith('GSTR-3B is kept as the rows of the filed return')));
  await receiptsOpen(engine, gst);
  const gstReceipt = await engine.request('receipts.get', { id: lineOf(gst, 'gst').figure.receiptId });
  assert.deepEqual(gstReceipt.sourceIds, ['gstr1-sep']);

  const bank = await page(engine, 'lender', 'bank-summary');
  assert.equal(bank.state, 'ready-untested');
  assert.deepEqual(bank.sections[0].lines.map((l: any) => [l.id, l.figure]), ['credits', 'debits', 'opening', 'closing', 'entries'].map(id => [id, { kind: 'missing', missing: 'not-counted' }]));
  assert.ok(bank.gaps[0].startsWith('The bank connector checks each statement against its own balances'));
  assert.ok(!bank.gaps.some((gap: string) => gap.startsWith('Some months')), 'September is loaded');
  const longer = await page(engine, 'lender', 'bank-summary', { period: { from: '2026-08-01', to: '2026-09-30' } });
  assert.ok(longer.gaps.includes('Some months of this period have no bank statement loaded.'));

  const match = await page(engine, 'ca', 'purchases-gstr2b');
  assert.equal(match.state, 'ready-untested');
  assert.equal(lineOf(match, 'books').figure.exact, '3685000'); assert.equal(lineOf(match, 'gstr2b').figure.exact, '4000000');
  for (const id of ['matched', 'amount-differs', 'books-only', 'gstr2b-only', 'probable', 'credit-at-risk']) assert.deepEqual(lineOf(match, id).figure, { kind: 'missing', missing: 'not-counted' }, id);
  assert.ok(match.gaps.some((gap: string) => gap.startsWith('The match from the GST connector points to invoice lines')));
  for (const words of ['Some invoices are in the books but not in GSTR-2B', 'Some invoices in GSTR-2B are not in the purchase register', 'Some invoices are in both, with different amounts', 'Some invoices may be the same'])
    assert.ok(match.gaps.some((gap: string) => gap.startsWith(words)), words);
  await receiptsOpen(engine, match);
  assert.ok(match.gaps.every((gap: string) => !/\d{3}/.test(gap)), 'gaps carry words, never connector numbers');

  const hindi = await page(engine, 'ca', 'purchases-gstr2b', { language: 'hi' });
  assert.equal(lineOf(hindi, 'gstr2b').label, 'GSTR-2B में ख़रीद');
  const { packs } = await engine.request('reportsx.packs', {});
  assert.equal(packs.find((p: any) => p.id === 'lender').pages.find((p: any) => p.id === 'gst-turnover').state, 'ready-untested');
  const file = await engine.request('reportsx.export', { pack: 'ca', page: 'purchases-gstr2b', format: 'csv', period: september });
  assert.match((await readFile(file.path, 'utf8')), /Purchases in GSTR-2B,,40000\.00,receipt_/);
});

test('the connector adapter refuses replies it cannot read', () => {
  assert.throws(() => checkEnvelopes({ items: [] }), code('CONNECTOR_REPLY_INVALID'));
  assert.throws(() => checkEnvelopes([{ sourceId: 'a', group: 'bank-statements', operation: 'x', status: 'accepted', committed: 'yes' }]), code('CONNECTOR_REPLY_INVALID'));
  assert.deepEqual(checkEnvelopes([{ sourceId: 'a', group: 'g', operation: 'o', status: 'refused', committed: null }]), [{ sourceId: 'a', group: 'g', operation: 'o', accepted: false, committed: false }]);
  assert.throws(() => checkMatch({ mode: 'matched', counts: { matched: -1 } }), code('CONNECTOR_REPLY_INVALID'));
  assert.deepEqual(checkMatch({ mode: 'not-applicable', gstMode: 'composition', reason: 'ignored outside text' }), { mode: 'not-applicable', gstMode: 'composition' });
  assert.throws(() => checkFreshness([{ months: [{ month: '2026-09', status: 'zero' }] }]), code('CONNECTOR_REPLY_INVALID'));
});

test('drawing the packs list again with nothing changed does not recalculate the connector pages; a change in data does', async t => {
  const engine = await open(t);
  await engine.request('sources.import', { sourceId: 'books', format: 'csv', content: books, recipe, expectedTotals: { rowCount: 8, amountMinor: '18835000' } });
  await importFile(engine, 'gst.gstr1-invoices-summary', 'gstr1-sep', 'gst-downloads/gstr1-sep-2026-with-summary.json');
  await importFile(engine, 'gst.gstr2b-b2b', 'gstr2b-sep', 'gst-downloads/gstr2b-sep-2026.json');
  // Connector lines name their sources; every other page's calculation runs over all sources. Count only the connector ones.
  const original = Calculations.prototype.run; let connectorRuns = 0;
  Calculations.prototype.run = function (this: Calculations, op: string, period: any, sourceIds?: string[]) { if (sourceIds) connectorRuns++; return original.call(this, op, period, sourceIds); };
  t.after(() => { Calculations.prototype.run = original; });

  const first = await engine.request('reportsx.packs', {});
  const built = connectorRuns; assert.ok(built > 0, 'the first draw calculates the connector pages');
  const before = { ...connectorCacheStats };
  const second = await engine.request('reportsx.packs', {});
  assert.equal(connectorRuns, built, 'the second draw recalculates nothing for the connector pages');
  assert.equal(connectorCacheStats.builds, before.builds); assert.equal(connectorCacheStats.hits, before.hits + 3);
  assert.deepEqual(second.packs, first.packs);
  // The page itself, over the same default period, is the kept one, and still opens its receipts.
  const kept = await engine.request('reportsx.page', { pack: 'ca', page: 'purchases-gstr2b' });
  assert.equal(connectorRuns, built); await receiptsOpen(engine, kept);
  assert.ok(kept.sections[0].lines.some((line: any) => line.figure.kind === 'money'));

  // Another language is another page: built once, then kept too.
  await engine.request('reportsx.packs', { language: 'hi' });
  const hindi = connectorRuns; assert.ok(hindi > built);
  await engine.request('reportsx.packs', { language: 'hi' });
  assert.equal(connectorRuns, hindi);

  // New data: a GSTR-3B arrives, so the connector pages are built again and the new import shows.
  await importFile(engine, 'gst.gstr3b-supplies', 'gstr3b-sep', 'gst-downloads/gstr3b-sep-2026.json', { rowCount: 5, total: '27050000' });
  await engine.request('reportsx.packs', {});
  assert.ok(connectorRuns > hindi, 'a change in data recalculates');
  const after = await page(engine, 'lender', 'gst-turnover');
  assert.deepEqual(lineOf(after, 'gstr3b').figure, { kind: 'missing', missing: 'not-counted' });
  assert.ok(after.gaps.some((gap: string) => gap.startsWith('GSTR-3B is kept as the rows of the filed return')));
  const settled = connectorRuns;
  await engine.request('reportsx.packs', {});
  assert.equal(connectorRuns, settled, 'and is kept again once built');
});
