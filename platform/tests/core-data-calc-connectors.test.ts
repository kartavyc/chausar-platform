import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService, numberGuard, type CalculationReceipt } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { Engine } from '../runtime/engine.ts';
import { calcMethods } from '../runtime/core-data/calc.ts';
import { MAX_MATCH_LINES } from '../runtime/core-data/calc-connectors.ts';
import { cxState, type Envelope } from '../runtime/connectors-ext/state.ts';
import { matchPurchaseRegister } from '../runtime/connectors-ext/gst-match.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

// RP-02 and AS-19: calculator receipts for connector bank totals, GSTR-3B turnover and the GSTR-2B match. Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic connector receipts shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const north: Context = { memberId: 'nina', role: 'accountant', epoch: 1 };
const period = { from: '2026-09-01', to: '2026-09-30' };

async function setup(gstMode: 'regular' | 'composition' | 'unregistered' = 'regular') {
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'nina', name: 'Nina', role: 'accountant', active: true, epoch: 1, branches: ['north'] }); });
  const ontology = new OntologyService(store), draft = structuredClone(starterPacks[0]); draft.gstMode = gstMode; await ontology.publish(owner, draft);
  const memory = new MemoryService(store), calculator = new CalculatorService(store);
  const host: ModuleHost = { store, services: { memory, ontology, calculator }, demo: true, directory: '/tmp/x', options: {}, async call() { throw new Error('none'); } };
  const call = async (ctx: Context, method: string, payload: Record<string, unknown>): Promise<any> => { const spec = calcMethods[method]; authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host); };
  return { store, memory, calculator, call };
}
const row = (sourceId: string, entityId: string, kind: string, validFrom: string, amountMinor: string, fields: Record<string, unknown> = {}, branch = 'north'): FactInput =>
  ({ entityId, kind, validFrom, sourceId, sourceRow: 2, branch, fields: { currency: 'INR', amountMinor, ...fields } });
const statement = (sourceId: string, from: string, to: string, opening: string | null, closing: string | null, branch = 'north'): Envelope => ({
  id: `env-${sourceId}-${from}`, connectionId: null, sourceId, company: 'Synthetic', branch, group: 'bank-statements', operation: 'statement', recipeId: 'bank.synthetic', recipeVersion: '1', recipeDigest: 'd', road: 'file' as any,
  fetchedAt: '2026-10-01T00:00:00.000Z', requestedPeriod: null, period: { from, to }, status: 'accepted', refusal: null, abstention: null, checks: [], observed: { rowCount: 0, total: '0', unit: 'INR' }, sourceTotals: null,
  balances: { opening, closing }, unmappedFields: [], excludedRows: 0, contentHash: 'h', sensitivity: 'financial', notices: [], read: null, pending: null,
  committed: { importId: 'imp', at: '2026-10-01T00:00:00.000Z', rows: 0, duplicate: false }, createdBy: 'owner' });

/** A GSTIN with its real check character, so the match treats it as valid. */
function gstin(body: string): string {
  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; let sum = 0, factor = 2;
  for (let i = 13; i >= 0; i--) { const product = alphabet.indexOf(body[i]) * factor; sum += Math.floor(product / 36) + product % 36; factor = factor === 2 ? 1 : 2; }
  return body + alphabet[(36 - sum % 36) % 36];
}
const G1 = gstin('27AAAAA0000A1Z'), G2 = gstin('29BBBBB1111B1Z');
const money = (receipt: CalculationReceipt) => Object.fromEntries(receipt.figures.map(f => [f.key, f.minor]));

async function bankFixture() {
  const f = await setup();
  await f.memory.append(owner, [row('bank-1', 'b0', 'bank', '2026-08-31', '-100'), row('bank-1', 'b1', 'bank', '2026-09-01', '10000'), row('bank-1', 'b2', 'bank', '2026-09-05', '-2500'),
    row('bank-1', 'b3', 'bank', '2026-09-10', '500'), row('bank-1', 'b4', 'bank', '2026-09-11', '1')]);
  await f.store.update(s => { cxState(s).envelopes.push(statement('bank-1', '2026-08-25', '2026-09-12', '100000', '107901')); });
  return f;
}

test('bank totals: credits, debits, net and entries, with opening and closing derived from the statement\'s own balances', async () => {
  const f = await bankFixture();
  const reply = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } });
  assert.deepEqual(reply.figures, { credits: '10500', debits: '2500', net: '8000', opening: '99900', closing: '107900', entries: '3' });
  assert.deepEqual(reply.missing, {});
  const receipt: CalculationReceipt = reply.receipt;
  assert.equal(receipt.operation, 'bank_totals'); assert.deepEqual(receipt.definitions, []); assert.equal(receipt.coverage.notCounted, 0); assert.deepEqual(receipt.requestedSourceIds, ['bank-1']);
  assert.deepEqual(receipt.rows.map(r => r.amountMinor), ['10000', '-2500', '500']);
  assert.equal((receipt.figures.find(x => x.key === 'entries') as any).unit, 'count');
  numberGuard(receipt.explanation, receipt);
  assert.deepEqual(f.calculator.receipt(owner, receipt.id), receipt, 'opens through the ordinary receipt read path');
  const answer = f.store.read().answers.find(a => a.receiptId === receipt.id);
  assert.deepEqual(answer.request, { calc: 'bank_totals', sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } }); assert.equal(answer.request.operation, undefined);
  // The same question over the same facts reuses its receipt instead of storing another.
  const again = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } });
  assert.equal(again.receipt.id, receipt.id); assert.equal(f.store.read().receipts.length, 1);
});

test('bank totals: a balance no statement states is missing, never zero; a foreign entry is not counted; a broken chain is partial', async () => {
  const f = await bankFixture();
  await f.memory.append(owner, [row('bank-1', 'usd', 'bank', '2026-09-20', '1', { currency: 'USD' })]);
  const reply = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(reply.figures.closing, undefined); assert.equal(reply.missing.closing, 'absent'); assert.equal(reply.figures.opening, '99900');
  assert.equal(reply.receipt.coverage.notCounted, 1); assert.equal(reply.receipt.coverage.completeness, 'partial');
  assert.deepEqual(reply.receipt.missingFigures.map((m: any) => m.key), ['closing']);
  await f.memory.append(owner, [row('bank-1', 'late', 'bank', '2026-09-12', '50')]);
  const broken = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-12' } });
  assert.equal(broken.figures.closing, '107901'); assert.equal(broken.receipt.coverage.completeness, 'partial');
  assert.ok(broken.receipt.coverage.gaps.some((g: string) => /does not equal the closing balance/.test(g)));
  await f.store.update(s => { cxState(s).envelopes.push(statement('bank-1', '2026-08-20', '2026-09-30', '5', '5')); });
  const conflicting = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } });
  assert.equal(conflicting.missing.opening, 'unknown');
  // An entry inside the statement window that cannot be read makes the derived balance unknown, never a guess.
  await f.memory.append(owner, [row('bank-1', 'odd', 'bank', '2026-08-30', '3', { currency: 'USD' })]);
  await f.store.update(s => { cxState(s).envelopes.pop(); });
  assert.equal((await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } })).missing.opening, 'unknown');
});

test('bank totals respect source access, branch access and visibility', async () => {
  const f = await bankFixture();
  await f.memory.append(owner, [row('bank-1', 's1', 'bank', '2026-09-02', '777', {}, 'south')]);
  const own = await f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } });
  const nina = await f.call(north, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-01', to: '2026-09-10' } });
  assert.equal(own.figures.credits, '11277'); assert.equal(nina.figures.credits, '10500', 'a south entry is invisible to a north member');
  assert.notEqual(own.receipt.id, nina.receipt.id);
  assert.throws(() => f.calculator.receipt(north, own.receipt.id), { code: 'RECEIPT_FORBIDDEN' });
  await assert.rejects(f.call(north, 'coredata.bankTotals', { sourceIds: ['bank-1'], period, branch: 'south' }), { code: 'FORBIDDEN_BRANCH' });
  await assert.rejects(f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period, extra: 1 }), { code: 'INVALID_CALCULATION' });
  await assert.rejects(f.call(owner, 'coredata.bankTotals', { sourceIds: [], period }), { code: 'INVALID_SOURCE_SCOPE' });
  await assert.rejects(f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period: { from: '2026-09-30', to: '2026-09-01' } }), { code: 'INVALID_PERIOD' });
  await f.store.update(s => { s.policy.allowedSources = ['other']; });
  await assert.rejects(f.call(owner, 'coredata.bankTotals', { sourceIds: ['bank-1'], period }), { code: 'SOURCE_REVOKED' });
  assert.throws(() => f.calculator.receipt(owner, own.receipt.id), { code: 'SOURCE_REVOKED' });
});

test('GSTR-3B turnover adds outward tables only, leaves a missing table missing and sets aside duplicate months', async () => {
  const f = await setup();
  const line = (sourceId: string, table: string, taxable: string, tax: string | null, date = '2026-09-01') => row(sourceId, `gst-downloads:${date}|${table}`, 'gst_return_summary', date, taxable, { description: table, ...(tax === null ? {} : { taxMinor: tax }) });
  await f.memory.append(owner, [line('gst-3b', '3.1(a)', '500000', '90000'), line('gst-3b', '3.1(b)', '10000', '0'), line('gst-3b', '3.1(c)', '2000', null), line('gst-3b', '3.1(d)', '7000', '1260'),
    line('gst-3b', '4A-OTH', '0', '5000'), line('gst-3b', '3.1(a)', '1', '0', '2026-08-01')]);
  const reply = await f.call(owner, 'coredata.gstr3bTurnover', { sourceIds: ['gst-3b'], period });
  assert.deepEqual(reply.figures, { turnover: '512000', outwardTaxable: '500000', zeroRated: '10000', nilExempt: '2000', reverseChargeInward: '7000', outwardTax: '90000' });
  assert.deepEqual(reply.missing, { nonGst: 'absent' });
  assert.equal(reply.receipt.operation, 'gstr3b_turnover'); assert.equal(reply.receipt.valueMinor, '512000'); assert.equal(reply.receipt.coverage.countedRows, 4);
  numberGuard(reply.receipt.explanation, reply.receipt); assert.deepEqual(f.calculator.receipt(owner, reply.receipt.id), reply.receipt);
  const two = await f.call(owner, 'coredata.gstr3bTurnover', { sourceIds: ['gst-3b'], period: { from: '2026-09-01', to: '2026-10-31' } });
  assert.ok(two.receipt.coverage.gaps.some((g: string) => /Some months of this period have no GSTR-3B/.test(g)));
  await f.memory.append(owner, [line('gst-3b-copy', '3.1(a)', '400000', '72000')]);
  const dup = await f.call(owner, 'coredata.gstr3bTurnover', { sourceIds: ['gst-3b', 'gst-3b-copy'], period });
  assert.equal(dup.figures.outwardTaxable, undefined); assert.equal(dup.figures.turnover, '12000'); assert.equal(dup.receipt.coverage.unresolvedConflicts, 1); assert.equal(dup.receipt.coverage.completeness, 'partial');
  const unknownTax = await setup(); await unknownTax.memory.append(owner, [line('g', '3.1(a)', '100', null)]);
  assert.equal((await unknownTax.call(owner, 'coredata.gstr3bTurnover', { sourceIds: ['g'], period })).missing.outwardTax, 'unknown');
  const composition = await setup('composition'); await composition.memory.append(owner, [line('gst-3b', '3.1(a)', '1', '0')]);
  await assert.rejects(composition.call(owner, 'coredata.gstr3bTurnover', { sourceIds: ['gst-3b'], period }), { code: 'GST_RETURN_NOT_APPLICABLE' });
});

async function gstFixture(gstMode: 'regular' | 'composition' | 'unregistered' = 'regular') {
  const f = await setup(gstMode);
  const p = (sourceId: string, id: string, supplier: string, invoiceId: string, amount: string, tax: string | null, date = '2026-09-10') =>
    row(sourceId, `${sourceId}:${id}`, 'purchase', date, amount, { gstin: supplier, invoiceId, ...(tax === null ? {} : { taxMinor: tax }) });
  await f.memory.append(owner, [
    p('reg', 'r1', G1, 'INV-1', '10000', '1800'), p('g2b', 'g1', G1, 'inv-1 ', '10000', '1800'),
    p('reg', 'r2', G1, 'INV-2', '20000', '3600'), p('g2b', 'g2', G1, 'INV-2', '20050', '3609'),
    p('reg', 'r3', G1, 'INV-3', '30000', '5400'), p('g2b', 'g3', G1, 'INV-3', '31000', '5580'),
    p('reg', 'r4', G1, 'INV-4', '5000', '900'), p('reg', 'r5', G1, 'INV-5', '7000', null),
    p('g2b', 'g9', G2, 'INV-9', '8000', '1440'),
    p('reg', 'r10', G2, 'INV/0010', '4000', '720'), p('g2b', 'g10', G2, 'INV-10', '4000', '720'),
    p('reg', 'bad', 'NOTAGSTIN', 'INV-11', '100', '18'),
  ]);
  return f;
}

test('GSTR-2B: one group receipt and one receipt per line, keyed SUPPLIERGSTIN|INVOICE|FY, with tolerance groups', async () => {
  const f = await gstFixture();
  const reply = await f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '100' });
  assert.deepEqual(Object.keys(reply).sort(), ['lines', 'receiptId']);
  const group = f.calculator.receipt(owner, reply.receiptId);
  assert.equal(group.operation, 'gstr2b_match');
  assert.deepEqual(money(group), { booksTaxable: '76000', gstr2bTaxable: '73050', difference: '1050', matchedTaxable: '10000', inBooksOnlyTaxable: '12000', in2bOnlyTaxable: '8000', creditAtRisk: '900',
    matched: '1', withinTolerance: '1', amountDiffers: '1', inBooksOnly: '2', in2bOnly: '1', probable: '1', invalid: '1', creditAtRiskUnknownTax: '1' });
  assert.ok(group.exclusions.some(e => /GSTIN is not valid/.test(e.reason)));
  numberGuard(group.explanation, group);
  const keys = reply.lines.map((l: any) => l.key);
  assert.deepEqual(keys, [...keys].sort()); assert.equal(new Set(keys).size, 7);
  assert.deepEqual(keys, [`${G1}|INV-1|2026-27`, `${G1}|INV-2|2026-27`, `${G1}|INV-3|2026-27`, `${G1}|INV-4|2026-27`, `${G1}|INV-5|2026-27`, `${G2}|INV-9|2026-27`, `${G2}|INV/0010|2026-27`]);
  const line = (key: string) => f.calculator.receipt(owner, reply.lines.find((l: any) => l.key === key).receiptId);
  const within = line(`${G1}|INV-2|2026-27`);
  assert.equal(within.operation, 'gstr2b_line'); assert.equal(within.assumptions.group, 'within-tolerance');
  assert.deepEqual(money(within), { booksTaxable: '20000', gstr2bTaxable: '20050', difference: '50', booksTax: '3600', gstr2bTax: '3609', taxDifference: '9' });
  assert.deepEqual(within.rows.map(r => r.sourceId), ['reg', 'g2b']); numberGuard(within.explanation, within);
  assert.equal(line(`${G1}|INV-3|2026-27`).assumptions.group, 'amount-differs');
  const booksOnly = line(`${G1}|INV-5|2026-27`);
  assert.deepEqual(money(booksOnly), { booksTaxable: '7000' });
  assert.deepEqual(booksOnly.missingFigures!.map(m => [m.key, m.missing]), [['gstr2bTaxable', 'absent'], ['difference', 'not-applicable'], ['booksTax', 'unknown'], ['gstr2bTax', 'absent'], ['taxDifference', 'not-applicable']]);
  const probable = line(`${G2}|INV/0010|2026-27`); assert.equal(probable.assumptions.group, 'probable'); assert.equal(probable.assumptions.rule, 'normalised-number');
  assert.equal(line(`${G2}|INV-9|2026-27`).assumptions.group, 'gstr2b-only');
  // Counts agree with connectors-ext's own match on the same lines.
  const zero = await f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '0' });
  const strict = f.calculator.receipt(owner, zero.receiptId);
  const facts = f.store.read().facts, lines = (sourceId: string) => facts.filter(x => x.sourceId === sourceId).map(x => ({ entityId: x.id, supplierGstin: String(x.fields.gstin), invoiceNumber: String(x.fields.invoiceId), invoiceDate: x.validFrom, taxableMinor: String(x.fields.amountMinor), taxMinor: (x.fields.taxMinor as string) ?? null }));
  const direct = matchPurchaseRegister({ register: lines('reg'), gstr2b: lines('g2b'), gstMode: 'regular', period });
  assert.ok(direct.mode === 'matched');
  assert.equal(money(strict).amountDiffers, String(direct.counts.amountMismatch)); assert.equal(money(strict).withinTolerance, '0');
  assert.equal(money(strict).inBooksOnly, String(direct.counts.inBooksOnly)); assert.equal(money(strict).creditAtRisk, direct.creditAtRisk.taxMinor);
  // Asking again stores nothing new.
  const count = f.store.read().receipts.length;
  const repeat = await f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '100' });
  assert.deepEqual(repeat, reply); assert.equal(f.store.read().receipts.length, count);
});

test('GSTR-2B refusals: not applicable, empty side, too many lines, bad tolerance and source access', async () => {
  for (const mode of ['composition', 'unregistered'] as const) {
    const f = await gstFixture(mode);
    await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '0' }), { code: 'GST_MATCH_NOT_APPLICABLE' });
  }
  const f = await gstFixture();
  await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period: { from: '2026-10-01', to: '2026-10-31' }, toleranceMinor: '0' }), { code: 'GST_MATCH_SOURCES_EMPTY' });
  await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'reg', period, toleranceMinor: '0' }), { code: 'INVALID_SOURCE_SCOPE' });
  for (const toleranceMinor of ['-1', '1.5', 100, '10000001']) await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor }), { code: 'INVALID_CALCULATION' });
  await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period }), { code: 'INVALID_CALCULATION' });
  const nina = await f.call(north, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '0' });
  assert.equal(f.calculator.receipt(north, nina.receiptId).memberId, 'nina');
  await f.store.update(s => { s.policy.allowedSources = ['reg']; });
  await assert.rejects(f.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '0' }), { code: 'SOURCE_REVOKED' });
  const big = await setup();
  await big.memory.append(owner, Array.from({ length: MAX_MATCH_LINES + 1 }, (_, i) => row(i % 2 ? 'reg' : 'g2b', `p${i}`, 'purchase', '2026-09-10', '100', { gstin: G1, invoiceId: `N-${i}` })));
  await assert.rejects(big.call(owner, 'coredata.gst2bReceipt', { registerSourceId: 'reg', gstr2bSourceId: 'g2b', period, toleranceMinor: '0' }), { code: 'GST_MATCH_TOO_LARGE' });
});

test('engine: connector receipts are module methods behind the engine\'s authorization and open with receipts.get', async (t: TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-calc-connectors-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Bank Shop', passphrase: 'Synthetic bank passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  await engine.request('sources.import', { sourceId: 'bank-csv', format: 'csv',
    content: 'id,kind,date,amount,currency,branch\nE1,bank,2026-09-02,250.00,INR,main\nE2,bank,2026-09-03,-75.50,INR,main',
    recipe: { version: 1, id: 'synthetic-bank', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Bank', branches: ['main'] },
      bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' }))], allowedKinds: ['bank'], allowedStatuses: [''], onUnmapped: 'report' },
    expectedTotals: { rowCount: 2, amountMinor: '17450' } });
  const reply: any = await engine.request('coredata.bankTotals', { sourceIds: ['bank-csv'], period });
  assert.deepEqual(reply.figures, { credits: '25000', debits: '7550', net: '17450', entries: '2' });
  assert.deepEqual(reply.missing, { opening: 'absent', closing: 'absent' });
  assert.equal(reply.receipt.coverage.completeness, 'reconciled-imports');
  assert.deepEqual(await engine.request('receipts.get', { id: reply.receipt.id }), reply.receipt);
  await assert.rejects(engine.request('coredata.gst2bReceipt', { registerSourceId: 'bank-csv', gstr2bSourceId: 'none', period, toleranceMinor: '0' }), { code: 'GST_MATCH_SOURCES_EMPTY' });
});
