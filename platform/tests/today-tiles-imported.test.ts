import test from 'node:test';
import assert from 'node:assert/strict';
import { CalculatorService, type CalculationReceipt, type CalculationRequest } from '../runtime/calculator.ts';
import { ChausarError, hash, type Context, type StateStore } from '../runtime/contracts.ts';
import { EngineConnectorService, type EngineConnectorProfile } from '../runtime/engine-connectors.ts';
import { defaultRecipe, ImportService, type ImportInput } from '../runtime/ingest.ts';
import { MemoryService, type Period } from '../runtime/memory.ts';
import { OntologyService, starterPacks, type DictionaryDraft } from '../runtime/ontology.ts';
import { TodayTilesService } from '../runtime/today-tiles.ts';
import type { TodayTileConfiguration, TodayTileValue, TodayTilesRequest } from '../runtime/today-tiles-contracts.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Synthetic source reports exercise real import, ontology, calculator and current
// connector guards. This suite establishes no provider, native SQL or durability qualification.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const asOf = '2100-01-01T00:00:00.000Z';
const period: Period = { from: '2026-09-01', to: '2026-09-30' };
const priorPeriod: Period = { from: '2026-08-01', to: '2026-08-31' };
const firstHalf: Period = { from: '2026-09-01', to: '2026-09-15' };
const secondHalf: Period = { from: '2026-09-16', to: '2026-09-30' };
type SourceRow = { id: string; kind: string; date: string; amountMinor: string; branch?: string; currency?: string; status?: string };
const row = (id: string, amountMinor: string, date = '2026-09-10', kind = 'sale'): SourceRow => ({ id, amountMinor, date, kind });
const configured = (changes: Partial<TodayTileConfiguration> = {}): TodayTileConfiguration => ({
  id: 'earned-explicit', label: 'Explicit earned revenue', operation: 'earned', figureKey: 'total', period,
  buckets: [
    { id: 'first-half', label: 'September 1–15', period: firstHalf },
    { id: 'second-half', label: 'September 16–30', period: secondHalf },
  ], ...changes,
});
function source(sourceId: string, rows: SourceRow[], expectedMinor: string, currency = 'INR'): ImportInput {
  const recipe = defaultRecipe();
  const binding = recipe.bindings.find(value => value.target === 'amountMinor')!;
  binding.moneyUnit = 'minor'; binding.currency = currency;
  const content = 'id,kind,date,amount,currency,status,branch\n' + rows.map(value =>
    [value.id, value.kind, value.date, value.amountMinor, value.currency ?? currency, value.status ?? 'settled', value.branch ?? 'main'].join(',')).join('\n') + '\n';
  return { sourceId, format: 'csv', recipe, content, expectedTotals: { rowCount: rows.length, amountMinor: expectedMinor } };
}
type Controls = {
  afterReceiptSaved?: (count: number, store: FixtureStateStore) => Promise<void>;
  onConsumer?: (request: CalculationRequest) => void;
  onReceipt?: (receipt: CalculationReceipt, count: number) => void;
  onVerify?: (receipt: CalculationReceipt) => void | Promise<void>;
};
async function setup(options: { draft?: DictionaryDraft; verifier?: boolean } = {}) {
  const underlying = new FixtureStateStore(), controls: Controls = {};
  const store: StateStore = {
    read: underlying.read.bind(underlying),
    update: async change => {
      const before = underlying.read().receipts.length, result = await underlying.update(change);
      const after = underlying.read().receipts.length;
      if (after > before) await controls.afterReceiptSaved?.(after, underlying);
      return result;
    },
  };
  const ontology = new OntologyService(store);
  await ontology.publish(owner, options.draft ?? 'ecommerce');
  const connectors = new EngineConnectorService(store), verified: CalculationReceipt[] = [], opened: string[] = [];
  const calculator = new CalculatorService(store, {
    consumerGuard: (ctx, request) => { connectors.assertCalculationReady(ctx, request); controls.onConsumer?.(request); },
    receiptGuard: (ctx, receipt) => { connectors.assertReceiptReady(ctx, receipt); controls.onReceipt?.(receipt, store.read().receipts.length); },
    ...(options.verifier === false ? {} : { verifier: async (receipt: CalculationReceipt) => {
      verified.push(structuredClone(receipt)); await controls.onVerify?.(receipt);
      return { kind: 'labelled-synthetic-test-port', nativeQualified: false };
    } }),
  });
  const originalOpen = calculator.receipt.bind(calculator);
  calculator.receipt = (ctx, id) => { opened.push(id); return originalOpen(ctx, id); };
  const service = new TodayTilesService(calculator), imports = new ImportService(store);
  const request = (tiles = [configured()], scope = { sourceIds: ['books'], branch: 'main' as string | null }): TodayTilesRequest => ({
    dictionaryHash: ontology.current(owner)!.hash, asOf, scope, tiles,
  });
  return { store, underlying, controls, ontology, connectors, calculator, service, imports, verified, opened, request };
}
function assertReceiptValue(value: TodayTileValue, calculator: CalculatorService, expected: string, key = 'total') {
  assert.ok(value.receiptId); assert.ok(value.figure); assert.ok(value.definition); assert.ok(value.coverage);
  const opened = calculator.receipt(owner, value.receiptId);
  assert.equal(value.figure.minor, expected);
  assert.deepEqual(value.figure, opened.figures.find(figure => figure.key === key));
  assert.deepEqual(value.coverage, opened.coverage);
  assert.equal(value.definition.dictionaryHash, opened.dictionaryHash);
  assert.equal(value.definition.ontologyVersion, opened.ontologyVersion);
  assert.equal(value.definition.definitionHash, opened.definitionHash);
  assert.equal(value.definition.definitionHash, hash(value.definition.definitions));
  assert.deepEqual(value.definition.definitions, opened.definitions);
  return opened;
}

test('imported exact large money produces receipt-backed figures and every explicit chart bucket', async () => {
  const value = await setup();
  const imported = await value.imports.commit(owner, source('books', [
    row('huge', '900719925474099391', '2026-09-01'), row('nine', '9', '2026-09-30'),
  ], '900719925474099400'));
  const request = value.request(), result = await value.service.build(owner, request), tile = result.tiles[0];
  assert.equal(result.version, 1); assert.equal(result.atomic, false); assert.equal(result.verification, 'configured');
  assert.equal(result.asOf, asOf); assert.deepEqual(result.scope, request.scope);
  assert.deepEqual(result.dictionary, { hash: request.dictionaryHash, version: 1 });
  assert.equal(tile.value.status, 'available');
  assert.deepEqual(tile.points.map(point => ({ id: point.id, label: point.label, period: point.period })), request.tiles[0].buckets);
  const finalReopenedIds = [...value.opened];
  assert.deepEqual(finalReopenedIds, [tile.value.receiptId, ...tile.points.map(point => point.value.receiptId)],
    'The service itself reopened every primary and point receipt before returning.');
  const receipts = [
    assertReceiptValue(tile.value, value.calculator, '900719925474099400'),
    assertReceiptValue(tile.points[0].value, value.calculator, '900719925474099391'),
    assertReceiptValue(tile.points[1].value, value.calculator, '9'),
  ];
  assert.equal(tile.value.figure!.display, 'INR 9,007,199,254,740,994.00');
  assert.equal(new Set(receipts.map(receipt => receipt.id)).size, 3);
  assert.deepEqual(value.verified.map(receipt => receipt.id), receipts.map(receipt => receipt.id));
  for (const receipt of receipts) {
    assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    assert.deepEqual(receipt.coverage.importIds, [imported.id]);
    assert.deepEqual(receipt.requestedSourceIds, ['books']); assert.equal(receipt.branch, 'main'); assert.equal(receipt.asOf, asOf);
    assert.ok(finalReopenedIds.includes(receipt.id), 'Every point and primary receipt is opened under current access.');
  }
});

test('imported negative contribution and truncated basis points copy calculator figures and economic gaps', async () => {
  const value = await setup();
  await value.imports.commit(owner, source('books', [row('sale', '3'), row('refund-explicit-zero', '0', '2026-09-10', 'refund'), row('cost', '4', '2026-09-10', 'cost')], '7'));
  const result = await value.service.build(owner, value.request([
    configured({ id: 'contribution', operation: 'margin', figureKey: 'contribution', buckets: [] }),
    configured({ id: 'margin-bps', operation: 'margin', figureKey: 'marginBps', buckets: [] }),
  ]));
  for (const tile of result.tiles) {
    assert.equal(tile.value.status, 'partial');
    assert.ok(tile.value.gaps.some(gap => /imported costs only/.test(gap.message)));
    assert.equal(tile.value.definition!.operationType, 'margin');
  }
  assertReceiptValue(result.tiles[0].value, value.calculator, '-1', 'contribution');
  assertReceiptValue(result.tiles[1].value, value.calculator, '-3333', 'marginBps');
  assert.equal(result.tiles[1].value.figure!.unit, 'basis-points');
  assert.equal(result.tiles[1].value.figure!.display, '-3333 bps');
  assert.equal(Object.hasOwn(result.tiles[1].value.figure!, 'currency'), false);
});

test('no counted facts stay unavailable while an explicitly imported reconciled zero is available', async () => {
  const empty = await setup(), emptyResult = await empty.service.build(owner, empty.request([configured({ buckets: [] })]));
  const emptyValue = emptyResult.tiles[0].value;
  assert.equal(emptyValue.status, 'unavailable'); assert.equal(emptyValue.figure, null); assert.ok(emptyValue.receiptId);
  assert.equal(emptyValue.coverage!.completeness, 'empty'); assert.equal(emptyValue.coverage!.countedRows, 0);
  assert.ok(emptyValue.gaps.some(gap => gap.code === 'DEFINITION_EVIDENCE_EMPTY' && gap.definitionName === 'earned'));
  const zero = await setup(); await zero.imports.commit(owner, source('books', [row('reconciled-zero', '0')], '0'));
  const result = await zero.service.build(owner, zero.request([configured({ buckets: [] })]));
  assert.equal(result.tiles[0].value.status, 'available');
  assert.equal(assertReceiptValue(result.tiles[0].value, zero.calculator, '0').coverage.countedRows, 1);
  assert.deepEqual(result.tiles[0].value.gaps, []);
});

test('empty chart intervals remain explicit unavailable gaps without interpolation', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('one', '10', '2026-09-01'), row('last', '20', '2026-09-30')], '30'));
  const buckets = [
    { id: 'one', label: 'First day', period: { from: '2026-09-01', to: '2026-09-01' } },
    { id: 'empty', label: 'Explicit empty middle', period: { from: '2026-09-02', to: '2026-09-29' } },
    { id: 'last', label: 'Last day', period: { from: '2026-09-30', to: '2026-09-30' } },
  ];
  const result = await value.service.build(owner, value.request([configured({ buckets })])), points = result.tiles[0].points;
  assert.deepEqual(points.map(point => point.value.figure?.minor ?? null), ['10', null, '20']);
  assert.deepEqual(points.map(point => point.period), buckets.map(bucket => bucket.period));
  assert.equal(points[1].value.status, 'unavailable'); assert.ok(points[1].value.receiptId);
});

test('a compound contribution lacks evidence when an unimported definition would otherwise calculate as zero', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('sale', '3'), row('cost', '4', '2026-09-10', 'cost')], '7'));
  const result = await value.service.build(owner, value.request([configured({ operation: 'margin', figureKey: 'contribution', buckets: [] })]));
  assert.equal(result.tiles[0].value.status, 'unavailable'); assert.equal(result.tiles[0].value.figure, null);
  assert.ok(result.tiles[0].value.gaps.some(gap => gap.code === 'DEFINITION_EVIDENCE_EMPTY' && gap.definitionName === 'refunds'));
  assert.equal(value.calculator.receipt(owner, result.tiles[0].value.receiptId!).figures.find(figure => figure.key === 'contribution')!.minor, '-1');
});

test('an undefined ratio is unavailable even with reconciled evidence for all definitions', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('sale', '3'), row('refund', '3', '2026-09-10', 'refund'), row('cost', '1', '2026-09-10', 'cost')], '7'));
  const result = await value.service.build(owner, value.request([configured({ operation: 'margin', figureKey: 'marginBps', buckets: [] })]));
  const output = result.tiles[0].value;
  assert.equal(output.status, 'unavailable'); assert.equal(output.figure, null); assert.ok(output.receiptId);
  assert.ok(output.gaps.some(gap => gap.code === 'FIGURE_UNAVAILABLE'));
  assert.equal(output.gaps.some(gap => gap.code === 'DEFINITION_EVIDENCE_EMPTY'), false);
});

test('partial imported conflicts retain measured figures and unavailable all-conflict points', async () => {
  const value = await setup();
  await value.imports.commit(owner, source('books', [row('known', '5', '2026-09-01'), row('conflicting', '100', '2026-09-30')], '105'));
  await value.imports.commit(owner, source('bank', [row('conflicting', '90', '2026-09-30')], '90'));
  const result = await value.service.build(owner, value.request([configured()], { sourceIds: ['books', 'bank'], branch: 'main' }));
  const tile = result.tiles[0];
  assert.equal(tile.value.status, 'partial'); assertReceiptValue(tile.value, value.calculator, '5');
  assert.equal(tile.value.coverage!.unresolvedConflicts, 1);
  assert.ok(tile.value.gaps.some(gap => /Unresolved source conflicts/.test(gap.message)));
  assert.equal(tile.points[0].value.status, 'available'); assertReceiptValue(tile.points[0].value, value.calculator, '5');
  assert.equal(tile.points[1].value.status, 'unavailable'); assert.equal(tile.points[1].value.figure, null);
  assert.equal(tile.points[1].value.coverage!.unresolvedConflicts, 1);
});

test('unknown corrected imported amounts never become known zero and retain partial coverage', async () => {
  const draft = structuredClone(starterPacks[0]); draft.definitions.find(definition => definition.name === 'earned')!.nulls = 'exclude';
  const value = await setup({ draft });
  const imported = await value.imports.commit(owner, source('books', [row('known-zero', '0'), row('unknown', '9')], '9'));
  const original = value.store.read().facts.find(fact => fact.entityId === 'unknown')!;
  await new MemoryService(value.store).correct(owner, original.id, { amountMinor: null });
  const result = await value.service.build(owner, value.request([configured({ buckets: [] })]));
  const output = result.tiles[0].value;
  assert.equal(output.status, 'partial'); assertReceiptValue(output, value.calculator, '0');
  assert.equal(output.coverage!.countedRows, 1); assert.equal(output.coverage!.excludedRows, 2);
  assert.ok(output.coverage!.importIds.includes(imported.id));
  assert.ok(output.gaps.some(gap => /unknown.*not zero/.test(gap.message)));
});

test('unconverted and unsupported currencies return explicit unavailable values without receipts', async () => {
  const foreign = await setup(); await foreign.imports.commit(owner, source('books', [row('foreign-correction', '100')], '100'));
  await new MemoryService(foreign.store).correct(owner, foreign.store.read().facts[0].id, { currency: 'USD' });
  const foreignResult = await foreign.service.build(owner, foreign.request([configured({ buckets: [] })]));
  assert.equal(foreignResult.tiles[0].value.figure, null); assert.equal(foreignResult.tiles[0].value.receiptId, null);
  assert.equal(foreignResult.tiles[0].value.gaps[0].code, 'CURRENCY_MISMATCH');
  const unsupported = await setup(); await unsupported.imports.commit(owner, source('books', [row('unsupported-correction', '100')], '100'));
  const draft = structuredClone(starterPacks[0]); draft.currency = 'ZZZ'; draft.definitions.forEach(definition => { definition.currency = 'ZZZ'; });
  await unsupported.ontology.publish(owner, draft);
  await new MemoryService(unsupported.store).correct(owner, unsupported.store.read().facts[0].id, { currency: 'ZZZ' });
  await assert.rejects(unsupported.imports.commit(owner, source('unsupported-import', [row('unqualified-currency', '100')], '100', 'ZZZ')), { code: 'INVALID_CURRENCY' });
  const result = await unsupported.service.build(owner, unsupported.request([configured({ buckets: [] })]));
  assert.equal(result.tiles[0].value.status, 'unavailable'); assert.equal(result.tiles[0].value.figure, null); assert.equal(result.tiles[0].value.receiptId, null);
  assert.equal(result.tiles[0].value.gaps[0].code, 'INVALID_CURRENCY'); assert.equal(unsupported.verified.length, 0);
});

test('earned comparison uses the existing change receipt with exact signed basis points', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('current', '2'), row('previous', '3', '2026-08-10')], '5'));
  const comparison = { operation: 'change', figureKey: 'changeBps', period: priorPeriod };
  const result = await value.service.build(owner, value.request([configured({ operation: 'revenue', buckets: [], comparison })]));
  assertReceiptValue(result.tiles[0].value, value.calculator, '2');
  assert.deepEqual({ operation: result.tiles[0].comparison!.operation, figureKey: result.tiles[0].comparison!.figureKey, period: result.tiles[0].comparison!.period }, comparison);
  const receipt = assertReceiptValue(result.tiles[0].comparison!.value, value.calculator, '-3333', 'changeBps');
  assert.equal(receipt.operation, 'change'); assert.deepEqual(receipt.period, period); assert.deepEqual(receipt.comparePeriod, priorPeriod);
  assert.deepEqual(Object.fromEntries(receipt.figures.map(figure => [figure.key, figure.minor])), { current: '2', previous: '3', change: '-1', changeBps: '-3333' });
  assert.equal(result.tiles[0].comparison!.value.status, 'available');
});

test('custom earned money bindings produce primary, point and comparison receipts from the published field', async () => {
  const draft = structuredClone(starterPacks[0]); draft.fields.recognizedMinor = 'money';
  draft.definitions.find(definition => definition.name === 'earned')!.field = 'recognizedMinor';
  const value = await setup({ draft });
  const input = source('books', [row('current', '999'), row('prior', '999', '2026-08-10')], '1998');
  input.recipe!.bindings.push({ target: 'recognizedMinor', source: 'recognized', type: 'money', moneyUnit: 'minor', currency: 'INR', nulls: 'reject' });
  input.content = 'id,kind,date,amount,currency,status,branch,recognized\ncurrent,sale,2026-09-10,999,INR,settled,main,2\nprior,sale,2026-08-10,999,INR,settled,main,3\n';
  await value.imports.commit(owner, input);
  const request = value.request([configured({ buckets: [{ id: 'known', label: 'Explicit September recognition', period: firstHalf }],
    comparison: { operation: 'change', figureKey: 'change', period: priorPeriod } })]);
  const result = await value.service.build(owner, request), tile = result.tiles[0];
  assertReceiptValue(tile.value, value.calculator, '2'); assertReceiptValue(tile.points[0].value, value.calculator, '2');
  const comparison = assertReceiptValue(tile.comparison!.value, value.calculator, '-1', 'change');
  assert.equal(comparison.figures.find(figure => figure.key === 'changeBps')!.minor, '-3333');
  for (const receipt of value.verified) {
    assert.ok(receipt.rows.every(row => row.measureField === 'recognizedMinor'));
    assert.equal(receipt.definitions[0].field, 'recognizedMinor');
    assert.ok(receipt.rows.every(row => row.amountMinor !== '999'), 'Neither chart nor comparison silently binds amountMinor.');
  }
});

test('an empty comparison side does not establish zero change or a ratio', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('current', '2')], '2'));
  const result = await value.service.build(owner, value.request([configured({ buckets: [], comparison: { operation: 'change', figureKey: 'change', period: priorPeriod } })]));
  const comparison = result.tiles[0].comparison!.value;
  assert.equal(comparison.status, 'unavailable'); assert.equal(comparison.figure, null); assert.ok(comparison.receiptId);
  assert.ok(comparison.gaps.some(gap => gap.code === 'DEFINITION_EVIDENCE_EMPTY' && gap.period?.from === priorPeriod.from));
});

test('billed, received and contribution comparisons remain unsupported without comparison algebra', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [
    row('invoice', '9', '2026-09-10', 'invoice'), row('payment', '8', '2026-09-10', 'payment'), row('sale', '7'),
    row('refund', '0', '2026-09-10', 'refund'), row('cost', '2', '2026-09-10', 'cost'),
  ], '26'));
  const result = await value.service.build(owner, value.request([
    configured({ id: 'billed', operation: 'billed', buckets: [], comparison: { operation: 'change', figureKey: 'change', period: priorPeriod } }),
    configured({ id: 'received', operation: 'received', buckets: [], comparison: { operation: 'change', figureKey: 'change', period: priorPeriod } }),
    configured({ id: 'contribution', operation: 'margin', figureKey: 'contribution', buckets: [], comparison: { operation: 'change', figureKey: 'change', period: priorPeriod } }),
  ]));
  for (const tile of result.tiles) {
    assert.equal(tile.comparison!.value.status, 'unavailable'); assert.equal(tile.comparison!.value.figure, null);
    assert.equal(tile.comparison!.value.receiptId, null); assert.equal(tile.comparison!.value.gaps[0].code, 'UNSUPPORTED_TILE_COMPARISON');
  }
  assert.deepEqual(value.verified.map(receipt => receipt.operation), ['billed', 'received', 'margin']);
  assertReceiptValue(result.tiles[2].value, value.calculator, '5', 'contribution');
});

test('one declared historical knowledge cut and source/branch scope apply to every returned receipt', async () => {
  const value = await setup();
  await value.imports.commit(owner, source('books', [row('first', '10', '2026-09-01'), row('last', '20', '2026-09-30'), { ...row('outside-branch', '900'), branch: 'west' }], '930'));
  await value.imports.commit(owner, source('bank', [row('first', '999', '2026-09-01')], '999'));
  const historicalCut = value.store.read().facts.find(fact => fact.entityId === 'last')!.learnedAt;
  const first = value.store.read().facts.find(fact => fact.entityId === 'first' && fact.sourceId === 'books')!;
  await new MemoryService(value.store).correct(owner, first.id, { amountMinor: '100' }, { testLearnedAt: asOf });
  const request = value.request(); request.asOf = historicalCut;
  const result = await value.service.build(owner, request);
  assertReceiptValue(result.tiles[0].value, value.calculator, '30');
  assert.deepEqual(result.tiles[0].points.map(point => point.value.figure?.minor), ['10', '20']);
  for (const receipt of value.verified) {
    assert.equal(receipt.asOf, historicalCut); assert.equal(receipt.branch, 'main'); assert.deepEqual(receipt.requestedSourceIds, ['books']);
    assert.ok(receipt.rows.every(row => row.sourceId === 'books' && row.branch === 'main'));
    assert.equal(receipt.coverage.unresolvedConflicts, 0);
  }
});

test('explicit null branch and empty source selections retain their declared scope without outside evidence', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('main', '10'), { ...row('west', '20'), branch: 'west' }], '30'));
  const allBranches = await value.service.build(owner, value.request([configured({ buckets: [] })], { sourceIds: ['books'], branch: null }));
  const allReceipt = assertReceiptValue(allBranches.tiles[0].value, value.calculator, '30');
  assert.equal(allReceipt.branch, null); assert.deepEqual(allBranches.scope, { sourceIds: ['books'], branch: null });
  const empty = await value.service.build(owner, value.request([configured({ buckets: [] })], { sourceIds: [], branch: null }));
  const output = empty.tiles[0].value;
  assert.equal(output.status, 'unavailable'); assert.equal(output.figure, null); assert.ok(output.receiptId);
  const receipt = value.calculator.receipt(owner, output.receiptId);
  assert.deepEqual(receipt.requestedSourceIds, []); assert.equal(receipt.branch, null);
  assert.deepEqual(receipt.rows, []); assert.deepEqual(receipt.exclusions, []); assert.deepEqual(receipt.coverage.importIds, []);
  assert.equal(receipt.coverage.completeness, 'empty');
});

test('final receipt opening reauthorizes every offscreen point after all calculations', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('first', '10', '2026-09-01'), row('last', '20', '2026-09-30')], '30'));
  let offscreenId: string | undefined;
  value.controls.onReceipt = (receipt, savedCount) => {
    if (receipt.period?.from === firstHalf.from && receipt.period.to === firstHalf.to) {
      offscreenId = receipt.id;
      if (savedCount === 3) throw new ChausarError('OFFSCREEN_POINT_REVOKED', 'Labelled synthetic current receipt authority denies this point.');
    }
  };
  await assert.rejects(value.service.build(owner, value.request()), { code: 'OFFSCREEN_POINT_REVOKED' });
  assert.equal(value.store.read().receipts.length, 3, 'Sequential calculations are retained before final current authorization denies assembly.');
  assert.ok(offscreenId); assert.ok(value.opened.includes(offscreenId));
  assert.equal(value.verified.length, 3);
});

test('authority, source, facts and definitions changing after the final point fail the assembly fence', async t => {
  const cases = [
    { name: 'permission epoch', code: 'ACCESS_REVOKED', mutate: async (store: FixtureStateStore) => { await store.update(state => { state.members[0].epoch++; }); } },
    { name: 'selected source revocation', code: 'SOURCE_REVOKED', mutate: async (store: FixtureStateStore) => { await store.update(state => { state.sourceRules.push({ sourceId: 'books', revoked: true }); }); } },
    { name: 'source facts', code: 'TODAY_TILES_INPUT_CHANGED', mutate: async (store: FixtureStateStore) => { await new MemoryService(store).append(owner, [{ sourceId: 'books', sourceRow: 2, entityId: 'arrived-after-final-point', kind: 'sale', validFrom: '2026-09-20', branch: 'main', fields: { amountMinor: '1', currency: 'INR', status: 'settled' } }]); } },
    { name: 'source precedence', code: 'TODAY_TILES_INPUT_CHANGED', mutate: async (store: FixtureStateStore) => { await new MemoryService(store).setSourcePrecedence(owner, 'sale', ['books', 'bank']); } },
    { name: 'published definitions', code: 'TODAY_TILES_DEFINITION_CHANGED', mutate: async (store: FixtureStateStore) => { await new OntologyService(store).publish(owner, 'retail'); } },
    { name: 'authority policy', code: 'TODAY_TILES_INPUT_CHANGED', mutate: async (store: FixtureStateStore) => { await store.update(state => { state.policy.retentionDays++; }); } },
  ];
  for (const entry of cases) await t.test(entry.name, async () => {
    const value = await setup(); await value.imports.commit(owner, source('books', [row('first', '10', '2026-09-01'), row('last', '20', '2026-09-30')], '30'));
    value.controls.afterReceiptSaved = async (count, store) => { if (count === 3) await entry.mutate(store); };
    await assert.rejects(value.service.build(owner, value.request()), { code: entry.code });
    assert.equal(value.store.read().receipts.length, 3, 'A failed sequential assembly does not claim atomic rollback.');
  });
});

test('real connector consumer and receipt guards reject reconciled imports without the installed managed-source capture', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('one', '10')], '10'));
  const saved = (await value.service.build(owner, value.request([configured({ buckets: [] })]))).tiles[0].value.receiptId!;
  const applicability = { applicationVersion: '1', edition: 'synthetic', module: 'sales', configuration: 'today-explicit-import', deploymentProfile: 'synthetic' };
  const readOperation = { connectorId: 'today-synthetic', connectorVersion: '1', operationId: 'read-sales', kind: 'read' as const, transport: 'api' as const, applicability };
  const profile: EngineConnectorProfile = {
    id: 'today-synthetic-sales', title: 'Synthetic managed-source readiness', sourceId: 'books', companyId: 'synthetic-today-company',
    domain: { company: 'Demo Shop', dataset: 'sales', branches: ['main'], period }, environment: 'synthetic', syntheticFixture: true,
    readOperation, importOperation: { ...readOperation, operationId: 'import-sales', kind: 'import', transport: 'file' },
    readImplementationDigest: hash('synthetic-today-read'), importImplementationDigest: hash('synthetic-today-import'),
    maximumSourceAgeMs: 60_000, contentTypes: ['application/json'],
    decoder: { id: 'synthetic-today-json', version: '1', schemaSha256: hash('synthetic-today-schema'), identityNamespace: 'synthetic-today-sales',
      identityFields: ['id'], resourceIdentityFields: ['id'], businessFields: ['id'], deliveryFields: [], revisionOrder: { kind: 'unqualified' },
      decode: () => { throw new Error('No transport or decoder execution is authorized by this source-only suite.'); } },
    reader: { operation: readOperation, environment: 'synthetic', mode: 'api', sideEffects: 'none', retrySafety: 'single-attempt', retryOwner: 'dispatcher',
      requiredAuthScopes: [], pagination: { kind: 'none' }, readPage: async () => { throw new Error('No provider execution is authorized by this source-only suite.'); } },
  };
  const connectors = new EngineConnectorService(value.store, { profiles: [profile] });
  const calculator = new CalculatorService(value.store, {
    consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
    receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt), verifier: value.calculator.verifier,
  });
  assert.throws(() => calculator.receipt(owner, saved), { code: 'SOURCE_NOT_READY' });
  await assert.rejects(new TodayTilesService(calculator).build(owner, value.request([configured({ buckets: [] })])), { code: 'SOURCE_NOT_READY' });
  assert.equal(value.store.read().receipts.length, 1); assert.equal(value.verified.length, 1);
});

test('an installed verifier failure on the final point propagates and retains only earlier sequential receipts', async () => {
  const value = await setup(); await value.imports.commit(owner, source('books', [row('first', '10', '2026-09-01'), row('last', '20', '2026-09-30')], '30'));
  value.controls.onVerify = receipt => {
    if (receipt.period?.from === secondHalf.from) throw new ChausarError('SYNTHETIC_VERIFIER_DENIED', 'The installed labelled synthetic verifier rejected this exact point.');
  };
  await assert.rejects(value.service.build(owner, value.request()), { code: 'SYNTHETIC_VERIFIER_DENIED' });
  assert.equal(value.verified.length, 3); assert.equal(value.store.read().receipts.length, 2);
  assert.equal(value.opened.length, 0, 'No aggregate current receipt fence runs after a failed computation.');
});

test('replacing an installed guard or verifier after the final point denies host identity changes', async t => {
  for (const component of ['consumerGuard', 'receiptGuard', 'verifier'] as const) await t.test(component, async () => {
    const value = await setup(); await value.imports.commit(owner, source('books', [row('first', '10', '2026-09-01'), row('last', '20', '2026-09-30')], '30'));
    value.controls.afterReceiptSaved = async count => {
      if (count !== 3) return;
      if (component === 'consumerGuard') value.calculator.consumerGuard = (ctx, request) => value.connectors.assertCalculationReady(ctx, request);
      else if (component === 'receiptGuard') value.calculator.receiptGuard = (ctx, receipt) => value.connectors.assertReceiptReady(ctx, receipt);
      else value.calculator.verifier = async () => ({ kind: 'different-labelled-synthetic-verifier', nativeQualified: false });
    };
    await assert.rejects(value.service.build(owner, value.request()), { code: 'TODAY_TILES_CALCULATOR_REQUIRED' });
    assert.equal(value.store.read().receipts.length, 3);
  });
});

test('definition pins, explicit configuration and installed guard requirements fail before computation', async () => {
  const value = await setup();
  assert.throws(() => new TodayTilesService(new CalculatorService(value.store)), { code: 'TODAY_TILES_CALCULATOR_REQUIRED' });
  const stale = value.request(); await value.ontology.publish(owner, 'retail');
  await assert.rejects(value.service.build(owner, stale), { code: 'TODAY_TILES_DEFINITION_CHANGED' });
  const valid = value.request([configured({ buckets: [] })]);
  const malformed: unknown[] = [
    { ...valid, asOf: '2100-01-01T00:00:00Z' }, { ...valid, asOf: undefined }, { ...valid, scope: { branch: 'main' } },
    { ...valid, scope: { sourceIds: ['books', 'books'], branch: 'main' } }, { ...valid, tiles: [] },
    { ...valid, tiles: [{ ...configured(), buckets: [{ id: 'outside', label: 'Outside period', period: priorPeriod }] }] },
    { ...valid, tiles: [{ ...configured(), buckets: [{ id: 'a', label: 'A', period: firstHalf }, { id: 'b', label: 'B', period: firstHalf }] }] },
    { ...valid, timezone: 'Etc/UTC' },
  ];
  for (const input of malformed) await assert.rejects(value.service.build(owner, input as TodayTilesRequest), { code: 'TODAY_TILES_INVALID_REQUEST' });
  assert.equal(value.verified.length, 0); assert.equal(value.store.read().receipts.length, 0);
});

test('missing verifier is disclosed and unsupported main calculations supply no invented figures', async () => {
  const value = await setup({ verifier: false }); await value.imports.commit(owner, source('books', [row('one', '10')], '10'));
  const result = await value.service.build(owner, value.request([
    configured({ id: 'earned', buckets: [] }), configured({ id: 'scenario', operation: 'scenario', figureKey: 'scenario', buckets: [] }),
  ]));
  assert.equal(result.verification, 'not-configured'); assertReceiptValue(result.tiles[0].value, value.calculator, '10');
  assert.equal(result.tiles[1].value.status, 'unavailable'); assert.equal(result.tiles[1].value.figure, null);
  assert.equal(result.tiles[1].value.receiptId, null); assert.equal(result.tiles[1].value.gaps[0].code, 'UNSUPPORTED_TILE_OPERATION');
});
