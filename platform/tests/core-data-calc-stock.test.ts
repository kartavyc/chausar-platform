import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService, numberGuard, type CountFigure } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { compileDictionary, OntologyService, starterPacks, type Definition, type DictionaryDraft } from '../runtime/ontology.ts';
import { stockOnHand } from '../runtime/stock-on-hand.ts';
import { TEMPLATES } from '../runtime/jobs-ext/templates.ts';

// Quantity measure kind and stock on hand (jobs-ext stock check). Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic stock shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const movements: Definition = { name: 'stock', label: 'Stock', meaning: 'Goods moved into (positive) or out of (negative) the shop, by movement date.', kind: 'stock_move', field: 'quantity', currency: 'INR', nulls: 'reject',
  measure: 'quantity', unit: 'unit', item: 'sku', balance: 'movements' };
const snapshots: Definition = { name: 'stock', label: 'Stock', meaning: 'Counted stock per item and outlet on the count date, as the inventory report states.', kind: 'stock_level', field: 'quantity', currency: 'INR', nulls: 'exclude',
  measure: 'quantity', unit: 'unit', item: 'sku', balance: 'snapshots', location: 'outletId' };
const draft = (extra: Definition[], pack = 'retail'): DictionaryDraft => { const base = structuredClone(starterPacks.find(p => p.pack === pack)!); base.definitions.push(...structuredClone(extra)); return base; };
async function setup(definition: Definition, options: ConstructorParameters<typeof CalculatorService>[1] = {}) {
  const store = new TestStore(); await new OntologyService(store).publish(owner, draft([definition]));
  return { store, memory: new MemoryService(store), calculator: new CalculatorService(store, options) };
}
const move = (entityId: string, sku: string, quantity: number | string | null, unit: string, validFrom: string, kind = 'stock_move', fields: Record<string, unknown> = {}): FactInput =>
  ({ entityId, kind, validFrom, sourceId: 'stock', sourceRow: 2, branch: 'main', fields: { sku, unit, quantity, ...fields } });

test('quantity definitions validate strictly; money definitions are unchanged', () => {
  const ok = compileDictionary(draft([movements]));
  const stock = ok.operations.find(o => o.id === 'stock_on_hand')!;
  assert.deepEqual(stock, { id: 'stock_on_hand', label: 'Stock on hand', type: 'stock', definitions: ['stock'], parameters: ['asOf', 'branch', 'onDate'] });
  assert.ok(!ok.operations.some(o => o.id === 'stock'), 'a quantity is never a money sum');
  assert.ok(!ok.compiledSums!.some(s => s.definitionName === 'stock'));
  const plain = compileDictionary(structuredClone(starterPacks.find(p => p.pack === 'retail')!), 1, 'owner', ok.publishedAt);
  assert.deepEqual(ok.operations.filter(o => o.id !== 'stock_on_hand'), plain.operations); assert.deepEqual(ok.compiledSums, plain.compiledSums);
  assert.equal(compileDictionary(draft([snapshots])).operations.at(-1)!.id, 'stock_on_hand');
  const bad = (change: Partial<Definition> & Record<string, unknown>, remove: string[] = []) => {
    const d: any = { ...movements, ...change }; for (const key of remove) delete d[key];
    assert.throws(() => compileDictionary(draft([d])), { code: 'INVALID_DEFINITION' }, JSON.stringify(change));
  };
  bad({ field: 'amountMinor' }); bad({ field: 'customerName' }); bad({ unit: 'quantity' }); bad({}, ['unit']); bad({}, ['item']); bad({}, ['balance']);
  bad({ balance: 'average' as any }); bad({ location: 'missingField' }); bad({ sign: -1 }); bad({ currency: 'USD' }); bad({ measure: 'weight' as any });
  assert.throws(() => compileDictionary(draft([movements, { ...movements, name: 'stock_two' }])), { code: 'INVALID_DEFINITION' });
  // A money definition cannot carry quantity bindings, explicit or not.
  const money = structuredClone(starterPacks[0]); (money.definitions[0] as any).item = 'sku';
  assert.throws(() => compileDictionary(money), { code: 'INVALID_DEFINITION' });
  const explicit = structuredClone(starterPacks[0]); explicit.definitions[0].measure = 'money'; assert.ok(compileDictionary(explicit).operations.length > 0);
  // A money definition may not take the generated stock calculation name.
  assert.throws(() => compileDictionary(draft([movements, { ...starterPacks[0].definitions[0], name: 'stock_on_hand' }])), { code: 'RESERVED_MEASURE' });
  // A quantity definition named like a money measure does not enable compound money calculations.
  const lonely = structuredClone(starterPacks[0]); lonely.definitions = [{ ...movements, name: 'earned' }];
  assert.deepEqual(compileDictionary(lonely).operations.map(o => o.id), ['stock_on_hand']);
});

test('the jobs-ext stock check requires exactly the generated operation', () => {
  const template = TEMPLATES.find(t => t.id === 'stock-check')!;
  assert.deepEqual(template.requires.operations, ['stock_on_hand']);
  assert.ok(template.requires.operations.every(op => compileDictionary(draft([movements])).operations.some(o => o.id === op)));
});

test('stock on hand from signed movements, per item, as of a date; units are never added together', async () => {
  const f = await setup(movements);
  await f.memory.append(owner, [move('m1', 'SKU-A', 10, 'pcs', '2026-09-01'), move('m2', 'SKU-A', '-3', 'pcs', '2026-09-05'), move('m3', 'SKU-A', 2, 'pcs', '2026-09-20'),
    move('m4', 'SKU-B', 5, 'kg', '2026-09-02'), move('m5', 'SKU-C', 1, 'pcs', '2026-09-02'), move('m6', 'SKU-C', 1, 'box', '2026-09-03'),
    move('m7', 'SKU-A', 100, 'pcs', '2026-09-04', 'stock_move', { status: 'cancelled' }), move('m8', '', 4, 'pcs', '2026-09-04')]);
  const receipt = await f.calculator.calculate(owner, { operation: 'stock_on_hand', onDate: '2026-09-10' });
  const figures = receipt.figures as unknown as CountFigure[];
  assert.deepEqual(figures.map(x => [x.key, x.minor, x.unit, x.quantityUnit ?? null]), [['item:SKU-A', '7', 'quantity', 'pcs'], ['item:SKU-B', '5', 'quantity', 'kg'], ['items', '2', 'count', null]]);
  assert.equal(receipt.figures[0].display, '7 pcs'); assert.equal(receipt.valueMinor, '12');
  assert.ok(receipt.coverage.gaps.includes('Items are in different units, so there is no stock total across all items.'));
  assert.equal(receipt.coverage.notCounted, 0); assert.equal(receipt.assumptions.onDate, '2026-09-10'); assert.equal(receipt.assumptions.balance, 'movements');
  const reasons = Object.fromEntries(receipt.exclusions.map(e => [e.rowId, e.reason]));
  const id = (entityId: string) => f.store.read().facts.find(x => x.entityId === entityId)!.id;
  assert.match(reasons[id('m5')], /different units/); assert.match(reasons[id('m6')], /different units/); assert.match(reasons[id('m7')], /cancelled/); assert.match(reasons[id('m8')], /no usable item/);
  assert.deepEqual(receipt.rows.map(r => [r.entityId, r.amountMinor, r.measureField, r.item, r.quantityUnit]).sort(), [['m1', '10', 'quantity', 'SKU-A', 'pcs'], ['m2', '-3', 'quantity', 'SKU-A', 'pcs'], ['m4', '5', 'quantity', 'SKU-B', 'kg']]);
  assert.ok(!receipt.rowIds.includes(id('m3')), 'a movement after the date is not counted');
  numberGuard(receipt.explanation, receipt); assert.deepEqual(f.calculator.receipt(owner, receipt.id), receipt);
  const one = await setup(movements); await one.memory.append(owner, [move('a', 'X', 3, 'pcs', '2026-09-01'), move('b', 'Y', 4, 'pcs', '2026-09-01')]);
  const total = await one.calculator.calculate(owner, { operation: 'stock_on_hand', onDate: '2026-09-02' });
  assert.deepEqual((total.figures as unknown as CountFigure[]).find(x => x.key === 'total'), { key: 'total', label: 'Stock on hand, all items', minor: '7', display: '7 pcs', unit: 'quantity', quantityUnit: 'pcs' });
});

test('stock on hand from dated counts: the latest count per item and location, never two counts of one day', async () => {
  const f = await setup(snapshots);
  await f.memory.append(owner, [move('a-x-1', 'SKU-A', 10, 'units', '2026-09-01', 'stock_level', { outletId: 'X' }), move('a-y', 'SKU-A', 4, 'units', '2026-09-03', 'stock_level', { outletId: 'Y' }),
    move('a-x-2', 'SKU-A', 8, 'units', '2026-09-05', 'stock_level', { outletId: 'X' }), move('b-1', 'SKU-B', 2, 'units', '2026-09-04', 'stock_level', { outletId: 'X' }),
    move('b-2', 'SKU-B', 3, 'units', '2026-09-04', 'stock_level', { outletId: 'X' }), move('c', 'SKU-C', null, 'units', '2026-09-04', 'stock_level', { outletId: 'X' })]);
  const late = await f.calculator.calculate(owner, { operation: 'stock_on_hand', onDate: '2026-09-10' });
  assert.deepEqual(late.figures.map(x => [x.key, x.minor]), [['item:SKU-A', '12'], ['items', '1'], ['total', '12']]);
  assert.equal(late.coverage.completeness, 'partial', 'an unknown count is partial coverage, not zero');
  assert.ok(late.exclusions.some(e => /same day cannot be told apart/.test(e.reason)));
  const early = await f.calculator.calculate(owner, { operation: 'stock_on_hand', onDate: '2026-09-04' });
  assert.equal(early.figures.find(x => x.key === 'item:SKU-A')!.minor, '14');
  const pure = stockOnHand(f.store.read().facts, snapshots); assert.deepEqual(pure.items.map(i => [i.item, String(i.quantity)]), [['SKU-A', '12']]);
});

test('stock on hand refuses periods, rejects missing required quantities and never carries a database proof', async () => {
  let verified = 0;
  const f = await setup(movements, { verifier: async () => { verified++; throw Object.assign(new Error('SQL'), { code: 'SQL_OPERATION_UNSUPPORTED' }); } });
  await f.memory.append(owner, [move('m1', 'SKU-A', 10, 'pcs', '2026-09-01')]);
  await assert.rejects(f.calculator.calculate(owner, { operation: 'stock_on_hand', period: { from: '2026-09-01', to: '2026-09-30' } }), { code: 'INVALID_CALCULATION' });
  await assert.rejects(f.calculator.calculate(owner, { operation: 'stock_on_hand', customerId: 'C' }), { code: 'INVALID_CALCULATION' });
  await assert.rejects(f.calculator.calculate(owner, { operation: 'stock_on_hand', onDate: '2026-02-30' }), { code: 'INVALID_STOCK_DATE' });
  const receipt = await f.calculator.calculate(owner, { operation: 'stock_on_hand' });
  assert.equal(receipt.databaseProof, undefined); assert.equal(verified, 0); assert.equal(receipt.figures[0].minor, '10');
  await f.memory.append(owner, [move('m2', 'SKU-A', null, 'pcs', '2026-09-02')]);
  await assert.rejects(f.calculator.calculate(owner, { operation: 'stock_on_hand' }), { code: 'MISSING_MEASURE_VALUE' });
  const g = await setup(movements); await g.memory.append(owner, [move('m1', 'SKU-A', 1.5, 'pcs', '2026-09-01')]);
  await assert.rejects(g.calculator.calculate(owner, { operation: 'stock_on_hand' }), { code: 'INVALID_QUANTITY' });
  const money = await g.calculator.calculate(owner, { operation: 'earned', period: { from: '2026-09-01', to: '2026-09-30' } });
  assert.equal(money.coverage.countedRows, 0, 'stock movements are never money');
});
