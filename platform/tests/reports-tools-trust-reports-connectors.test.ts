import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { checkCoreTotals, checkEnvelopes, checkFreshness, checkGst2b, checkMatch } from '../runtime/reports-ext/connector-pages.ts';
import { moduleMethods, type RegisteredMethod } from '../runtime/modules/registry.ts';
import { check, type Context } from '../runtime/contracts.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
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
    assert.ok(['money', 'count'].includes(line.figure.kind)); assert.ok(built.receiptIds.includes(line.figure.receiptId));
    const receipt = await engine.request('receipts.get', { id: line.figure.receiptId });
    assert.equal(receipt.id, line.figure.receiptId); assert.ok(receipt.figures.some((f: any) => f.minor === line.figure.exact));
  }
}

// ---- A fake core-data (coredata.bankTotals, coredata.gstr3bTurnover, coredata.gst2bReceipt) ----
// Registered for one test and put back after, so these tests hold whether or not core-data is merged. Each fake receipt
// is a copy of a real calculator receipt over the requested sources with the figures core-data's contract names, stored
// in state.receipts as core-data stores its own (calc-receipts.ts storeReceipts), so receipts.get opens it.
type Handler = (ctx: Context, payload: Record<string, any>, host: ModuleHost) => unknown;
type CoreMethod = 'coredata.bankTotals' | 'coredata.gstr3bTurnover' | 'coredata.gst2bReceipt';
const absent: Handler = () => check(false, 'UNKNOWN_METHOD', 'The requested operation is not available.');
function fakeCore(t: any, handlers: Partial<Record<CoreMethod, Handler>> = {}) {
  const map = moduleMethods as Map<string, RegisteredMethod>; const calls: { method: string; payload: any }[] = [];
  for (const method of ['coredata.bankTotals', 'coredata.gstr3bTurnover', 'coredata.gst2bReceipt'] as const) {
    const before = map.get(method); const handler = handlers[method] ?? absent;
    map.set(method, Object.freeze({ permission: 'read' as const, module: 'core-data-fake',
      handler: (ctx: Context, payload: Record<string, any>, host: ModuleHost) => { calls.push({ method, payload: structuredClone(payload) }); return handler(ctx, payload, host); } }));
    t.after(() => { if (before) map.set(method, before); else map.delete(method); });
  }
  return calls;
}
let fakeId = 0;
type FakeFigure = [key: string, minor: string, unit?: 'money' | 'count'];
async function fakeReceipt(ctx: Context, host: ModuleHost, sourceIds: string[], period: any, operation: string, figures: FakeFigure[], missingFigures: [string, string][] = [], assumptions: Record<string, unknown> = {}) {
  const base = await host.services.calculator.calculate(ctx, { operation: 'purchases', period, sourceIds });
  const receipt = { ...structuredClone(base), id: `receipt_fakecore_${++fakeId}`, operation, stale: false, assumptions,
    figures: figures.map(([key, minor, unit = 'money']) => ({ key, label: key, minor, display: minor, unit, ...(unit === 'money' ? { currency: 'INR' } : {}) })),
    missingFigures: missingFigures.map(([key, missing]) => ({ key, label: key, missing, reason: 'Synthetic.' })),
    coverage: { ...base.coverage, completeness: 'reconciled-imports', gaps: [`Synthetic ${operation} gap.`] } };
  await host.store.update(state => { state.receipts.push(structuredClone(receipt) as any); });
  return receipt;
}
const totalsReply = (receipt: any) => ({ receipt, figures: Object.fromEntries(receipt.figures.map((f: any) => [f.key, f.minor])),
  missing: Object.fromEntries(receipt.missingFigures.map((m: any) => [m.key, m.missing])) });
async function importAll(engine: Engine) {
  await engine.request('sources.import', { sourceId: 'books', format: 'csv', content: books, recipe, expectedTotals: { rowCount: 8, amountMinor: '18835000' } });
  await importFile(engine, 'gst.gstr1-invoices-summary', 'gstr1-sep', 'gst-downloads/gstr1-sep-2026-with-summary.json');
  await importFile(engine, 'gst.gstr3b-supplies', 'gstr3b-sep', 'gst-downloads/gstr3b-sep-2026.json', { rowCount: 5, total: '27050000' });
  await importFile(engine, 'gst.gstr2b-b2b', 'gstr2b-sep', 'gst-downloads/gstr2b-sep-2026.json');
  await importFile(engine, 'bank.statement-csv', 'bank-hdfc', 'bank-statements/hdfc-like.csv');
}

test('with core-data: every bank, GSTR-3B and GSTR-2B figure opens its receipt; counts are counts and missing figures are words', async t => {
  const engine = await open(t);
  const calls = fakeCore(t, {
    'coredata.bankTotals': async (ctx, p, host) => totalsReply(await fakeReceipt(ctx, host, p.sourceIds, p.period, 'bank_totals',
      [['credits', '500000'], ['debits', '120000'], ['net', '380000'], ['entries', '7', 'count']], [['opening', 'absent'], ['closing', 'unknown']])),
    'coredata.gstr3bTurnover': async (ctx, p, host) => totalsReply(await fakeReceipt(ctx, host, p.sourceIds, p.period, 'gstr3b_turnover',
      [['turnover', '27000000'], ['outwardTaxable', '25000000'], ['zeroRated', '2000000'], ['reverseChargeInward', '50000'], ['outwardTax', '4500000']], [['nilExempt', 'absent'], ['nonGst', 'absent']])),
    'coredata.gst2bReceipt': async (ctx, p, host) => {
      const sources = [p.registerSourceId, p.gstr2bSourceId];
      const group = await fakeReceipt(ctx, host, sources, p.period, 'gstr2b_match', [['booksTaxable', '3685000'], ['gstr2bTaxable', '4000000'], ['creditAtRisk', '13500'],
        ['matched', '2', 'count'], ['withinTolerance', '0', 'count'], ['amountDiffers', '1', 'count'], ['inBooksOnly', '1', 'count'], ['in2bOnly', '0', 'count'],
        ['probable', '0', 'count'], ['invalid', '0', 'count'], ['creditAtRiskUnknownTax', '0', 'count']]);
      const lineOne = async (key: string, group: string, figures: FakeFigure[], missing: [string, string][]) =>
        ({ key, receiptId: (await fakeReceipt(ctx, host, sources, p.period, 'gstr2b_line', figures, missing, { key, group, toleranceMinor: '0' })).id });
      return { receiptId: group.id, lines: [
        await lineOne('27PQRSX5678K1ZY|KST-101|2026-27', 'matched', [['booksTaxable', '2000000'], ['gstr2bTaxable', '2000000'], ['difference', '0']], []),
        await lineOne('29ABCDE1234F1ZW|SP/0013|2026-27', 'amount-differs', [['booksTaxable', '510000'], ['gstr2bTaxable', '500000'], ['difference', '-10000']], []),
        await lineOne('29ABCDE1234F1ZW|SP/0099|2026-27', 'books-only', [['booksTaxable', '75000']], [['gstr2bTaxable', 'absent'], ['difference', 'not-applicable']]),
      ] };
    },
  });
  await importAll(engine);

  const bank = await page(engine, 'lender', 'bank-summary');
  assert.equal(bank.state, 'ready-tested');
  assert.deepEqual(calls.find(c => c.method === 'coredata.bankTotals')!.payload, { sourceIds: ['bank-hdfc'], period: september });
  assert.equal(lineOf(bank, 'credits').figure.exact, '500000'); assert.equal(lineOf(bank, 'credits').figure.kind, 'money');
  assert.equal(lineOf(bank, 'net').figure.exact, '380000');
  assert.deepEqual([lineOf(bank, 'entries').figure.kind, lineOf(bank, 'entries').figure.exact], ['count', '7']);
  assert.deepEqual(lineOf(bank, 'opening').figure, { kind: 'missing', missing: 'absent' });
  assert.deepEqual(lineOf(bank, 'closing').figure, { kind: 'missing', missing: 'unknown' });
  assert.ok(!bank.gaps.some((gap: string) => gap.startsWith('The bank connector checks')), 'no longer not counted');
  await receiptsOpen(engine, bank);

  const gst = await page(engine, 'lender', 'gst-turnover');
  assert.equal(gst.state, 'ready-tested', 'no line is left not counted, so the page can be tested');
  assert.equal(lineOf(gst, 'gstr3b').figure.exact, '27000000'); assert.equal(lineOf(gst, 'gstr3b').figure.measure.key, 'turnover');
  const parts = gst.sections.find((s: any) => s.id === 'gstr3b');
  assert.equal(parts.lines.find((l: any) => l.id === 'reverseChargeInward').figure.exact, '50000');
  assert.match(parts.lines.find((l: any) => l.id === 'reverseChargeInward').label, /not turnover/);
  assert.deepEqual(parts.lines.find((l: any) => l.id === 'nilExempt').figure, { kind: 'missing', missing: 'absent' });
  assert.ok(!gst.gaps.some((gap: string) => gap.startsWith('GSTR-3B is kept as the rows')));
  await receiptsOpen(engine, gst);

  const match = await page(engine, 'ca', 'purchases-gstr2b');
  assert.deepEqual(calls.find(c => c.method === 'coredata.gst2bReceipt')!.payload, { registerSourceId: 'books', gstr2bSourceId: 'gstr2b-sep', period: september, toleranceMinor: '0' });
  assert.equal(match.state, 'ready-tested');
  assert.equal(lineOf(match, 'books').figure.exact, '3685000'); assert.equal(lineOf(match, 'credit-at-risk').figure.kind, 'money');
  assert.deepEqual([lineOf(match, 'amount-differs').figure.kind, lineOf(match, 'amount-differs').figure.exact], ['count', '1']);
  assert.deepEqual([lineOf(match, 'within-tolerance').figure.kind, lineOf(match, 'within-tolerance').figure.exact], ['count', '0']);
  for (const words of ['Some invoices are in the books but not in GSTR-2B', 'Some invoices are in both, with different amounts', 'Invoices are matched exactly'])
    assert.ok(match.gaps.some((gap: string) => gap.startsWith(words)), words);
  assert.ok(!match.gaps.some((gap: string) => gap.startsWith('Some invoices in GSTR-2B are not')));
  const invoices = match.sections.find((s: any) => s.id === 'invoices');
  assert.deepEqual(invoices.lines.map((l: any) => [l.label, l.figure.exact, l.figure.measure.key]), [
    ['29ABCDE1234F1ZW · SP/0013 · 2026-27: amount differs', '-10000', 'difference'],
    ['29ABCDE1234F1ZW · SP/0099 · 2026-27: in the books only', '75000', 'booksTaxable']]);
  await receiptsOpen(engine, match);
  assert.equal(match.receiptIds.length, 3, 'the group receipt and the two invoices shown');
  const hindi = await page(engine, 'ca', 'purchases-gstr2b', { language: 'hi' });
  assert.match(hindi.sections.find((s: any) => s.id === 'invoices').lines[0].label, /राशि अलग है$/);
});

test('with core-data: a business that is not GST-regular reads in words; refusals leave figures unknown, never zero', async t => {
  const engine = await open(t);
  fakeCore(t, {
    'coredata.gstr3bTurnover': () => check(false, 'GST_RETURN_NOT_APPLICABLE', 'A composition or unregistered business files no GSTR-3B outward supplies table.'),
    'coredata.bankTotals': () => check(false, 'SOURCE_REVOKED', 'Synthetic refusal.'),
    'coredata.gst2bReceipt': () => check(false, 'GST_MATCH_TOO_LARGE', 'Synthetic refusal.'),
  });
  await importAll(engine);
  const gst = await page(engine, 'lender', 'gst-turnover');
  assert.notEqual(gst.state, 'not-started');
  assert.deepEqual(lineOf(gst, 'gstr3b').figure, { kind: 'missing', missing: 'not-applicable' });
  assert.ok(gst.gaps.some((gap: string) => gap.startsWith('A composition or unregistered business files no GSTR-3B')));
  const bank = await page(engine, 'lender', 'bank-summary');
  assert.equal(bank.state, 'not-started');
  for (const line of bank.sections[0].lines) assert.deepEqual(line.figure, { kind: 'missing', missing: 'unknown' }, line.id);
  assert.ok(bank.gaps.includes('The calculation of the bank totals was refused, so they are not shown.'));
  const match = await page(engine, 'ca', 'purchases-gstr2b');
  assert.equal(lineOf(match, 'books').figure.kind, 'money');
  assert.deepEqual(lineOf(match, 'matched').figure, { kind: 'missing', missing: 'unknown' });
  assert.ok(match.gaps.some((gap: string) => gap.startsWith('There are too many purchase lines')));
  const blocked = fakeCore(t, { 'coredata.gst2bReceipt': () => check(false, 'GST_MATCH_NOT_APPLICABLE', 'Synthetic.') });
  const notApplicable = await page(engine, 'ca', 'purchases-gstr2b', { language: 'hi' });
  assert.ok(blocked.length === 1); assert.equal(notApplicable.state, 'not-started');
  assert.ok(notApplicable.gaps.includes('कंपोज़िशन या बिना पंजीकरण वाला व्यवसाय ख़रीद का GSTR-2B से मिलान नहीं करता।'));
});

test('the core-data adapter refuses replies it cannot read', () => {
  const receipt = { id: 'r1', operation: 'bank_totals', figures: [{ key: 'credits', minor: '10' }, { key: 'entries', minor: '3' }], coverage: { gaps: [] } };
  const keys = { credits: 'money', entries: 'count', opening: 'money' } as const;
  assert.deepEqual(checkCoreTotals({ receipt, figures: { credits: '10', entries: '3' }, missing: { opening: 'absent' } }, keys).figures,
    { credits: { exact: '10', unit: 'money' }, entries: { exact: '3', unit: 'count' }, opening: 'absent' });
  assert.equal(checkCoreTotals({ receipt, figures: { credits: '10' }, missing: {} }, keys).figures.opening, 'unknown', 'a key given nowhere is unknown, not zero');
  assert.throws(() => checkCoreTotals({ receipt, figures: { credits: '11' }, missing: {} }, keys), code('COREDATA_REPLY_INVALID'), 'a figure must be the receipt\'s own');
  assert.throws(() => checkCoreTotals({ receipt, figures: { credits: 10 }, missing: {} }, keys), code('COREDATA_REPLY_INVALID'), 'money is a paise string');
  assert.throws(() => checkCoreTotals({ receipt: { ...receipt, figures: [{ key: 'entries', minor: '-3' }] }, figures: { entries: '-3' }, missing: {} }, keys), code('COREDATA_REPLY_INVALID'));
  assert.throws(() => checkCoreTotals({ receipt, figures: {}, missing: { opening: 'zero' } }, keys), code('COREDATA_REPLY_INVALID'));
  assert.throws(() => checkCoreTotals({ figures: {}, missing: {} }, keys), code('COREDATA_REPLY_INVALID'));
  assert.deepEqual(checkGst2b({ receiptId: 'r1', lines: [{ key: 'A|B|2026-27', receiptId: 'r2', extra: 'dropped' }] }), { receiptId: 'r1', lines: [{ key: 'A|B|2026-27', receiptId: 'r2' }] });
  assert.throws(() => checkGst2b({ receiptId: 'r1', lines: [{ key: 'no-separators', receiptId: 'r2' }] }), code('COREDATA_REPLY_INVALID'));
});

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

test('before core-data: GST turnover, bank summary and purchases against GSTR-2B are built from connector imports with receipts that open', async t => {
  const engine = await open(t); fakeCore(t);
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
  const engine = await open(t); fakeCore(t);
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
