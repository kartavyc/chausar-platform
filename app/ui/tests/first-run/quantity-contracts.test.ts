import assert from 'node:assert/strict';
import test from 'node:test';
import { STOCK_OPERATION, quantityDefinition, validateDraft, validatePublished, validateStockFigures } from '../../src/screens/first-run/contracts.ts';
import { engine } from './fixture.ts';

/**
 * core-data round 4 (not merged in this base): a quantity definition and the `stock_on_hand`
 * operation it compiles to, with its quantity and count figures. The shapes are typed fixtures
 * of `platform/runtime/ontology.ts` `compileDictionary` and `calculator.ts` `countFigure` on
 * `claude/lane-core-data` at a24e95f: the base's own compiled starter pack, with what core-data
 * adds for an owner's draft that declares stock (kind `stock_level`, field `quantity`, unit
 * `unit`, item `sku`, balance `snapshots`, location `outletId`). Synthetic data only.
 */
const rejects = (run: () => unknown, label: string) => assert.throws(run, (error: unknown) => (error as { code?: unknown }).code === 'INVALID_REPLY', label);
type Obj = Record<string, unknown>;
const edit = <T>(value: T, change: (obj: Obj) => void): T => { const copy = structuredClone(value) as Obj; change(copy); return copy as T; };
const defs = (obj: Obj) => obj.definitions as Obj[];

const STOCK_FIELDS = { quantity: 'integer', unit: 'string', sku: 'string', outletId: 'string' } as const;
const quantityDef = (currency: string): Obj => ({
  name: 'stock_level', label: 'Stock level', meaning: 'Units of each item counted on the shelf on the count date.', kind: 'stock_level', field: 'quantity',
  currency, nulls: 'exclude', measure: 'quantity', unit: 'unit', item: 'sku', balance: 'snapshots', location: 'outletId',
});

async function stockDraft(): Promise<Obj> {
  const frozen = await engine();
  const pack = frozen.rawPack(1);
  return edit(pack, obj => { obj.fields = { ...(obj.fields as Obj), ...STOCK_FIELDS }; obj.definitions = [...defs(obj), quantityDef(obj.currency as string)]; });
}

/** The base compiler's output for the money part, plus what core-data's compiler adds for the quantity definition. */
async function stockPublished(): Promise<Obj> {
  const frozen = await engine();
  const pack = frozen.rawPack(1);
  const compiled = frozen.compileRaw(pack, 1, 'member_fixture', '2026-10-15T00:00:00.000Z');
  return edit(compiled, obj => {
    const quantity = quantityDef(obj.currency as string);
    obj.fields = { ...(obj.fields as Obj), ...STOCK_FIELDS };
    obj.schema = { ...(obj.schema as Obj), ...STOCK_FIELDS };
    obj.definitions = [...defs(obj), quantity];
    obj.operations = [...(obj.operations as Obj[]), { id: 'stock_on_hand', label: 'Stock on hand', type: 'stock', definitions: ['stock_level'], parameters: ['asOf', 'branch', 'onDate'] }];
    const checks = obj.checks as { nullRules: Obj };
    checks.nullRules = { ...checks.nullRules, stock_level: 'exclude' };
  });
}

test('a quantity definition is accepted in a draft and a published dictionary, with its one stock_on_hand operation', async () => {
  const draft = validateDraft(await stockDraft());
  const quantity = quantityDefinition(draft.definitions);
  assert.equal(quantity?.name, 'stock_level');
  assert.equal(quantity?.balance, 'snapshots');
  assert.equal(quantityDefinition(validateDraft((await engine()).rawPack(1)).definitions), null);
  validateDraft(edit(await stockDraft(), obj => { const q = defs(obj).at(-1)!; delete q.location; q.balance = 'movements'; }));

  const published = validatePublished(await stockPublished());
  const stock = published.operations.find(item => item.type === 'stock');
  assert.deepEqual({ id: stock?.id, definitions: stock?.definitions, parameters: stock?.parameters }, { id: STOCK_OPERATION.id, definitions: ['stock_level'], parameters: [...STOCK_OPERATION.parameters] });
  // No compiled sum for the quantity definition: the compiled sums are the money sums only.
  assert.ok(!(published.compiledSums ?? []).some(sum => sum.definitionName === 'stock_level'));
});

test('quantity definitions with a wrong shape are refused', async () => {
  const draft = await stockDraft();
  const last = (change: (q: Obj, draft: Obj) => void) => edit(draft, obj => change(defs(obj).at(-1)!, obj));
  rejects(() => validateDraft(last(q => { q.field = 'unit'; })), 'the quantity field must be an integer field');
  rejects(() => validateDraft(last((_q, obj) => { (obj.fields as Obj).quantity = 'money'; })), 'a money field is not a quantity');
  rejects(() => validateDraft(last(q => { q.unit = 'quantity'; })), 'the unit must be a string field');
  rejects(() => validateDraft(last(q => { q.item = 'missingField'; })), 'the item must be a declared field');
  rejects(() => validateDraft(last(q => { q.location = 'quantity'; })), 'the location must be a string field');
  rejects(() => validateDraft(last(q => { delete q.unit; })), 'a unit is required');
  rejects(() => validateDraft(last(q => { delete q.item; })), 'an item is required');
  rejects(() => validateDraft(last(q => { delete q.balance; })), 'a balance rule is required');
  rejects(() => validateDraft(last(q => { q.balance = 'average'; })), 'only movements or snapshots');
  rejects(() => validateDraft(last(q => { q.sign = 1; })), 'a quantity is never signed');
  rejects(() => validateDraft(last(q => { q.measure = 'weight'; })), 'only money or quantity');
  rejects(() => validateDraft(last(q => { q.currency = 'USD'; })), 'the dictionary currency still applies');
  rejects(() => validateDraft(last((q, obj) => { obj.definitions = [...defs(obj), { ...q, name: 'second_stock' }]; })), 'at most one quantity definition');
  rejects(() => validateDraft(edit(draft, obj => { defs(obj)[0]!.unit = 'unit'; })), 'a money definition names no unit');
  rejects(() => validateDraft(edit(draft, obj => { defs(obj)[0]!.balance = 'movements'; })), 'a money definition names no balance');
  validateDraft(edit(draft, obj => { defs(obj)[0]!.measure = 'money'; }));
});

test('the stock operation is exact: its id, its one quantity definition, its parameters, and only with a quantity definition', async () => {
  const published = await stockPublished();
  const stockOp = (change: (op: Obj, obj: Obj) => void) => edit(published, obj => change((obj.operations as Obj[]).find(op => op.type === 'stock')!, obj));
  rejects(() => validatePublished(stockOp(op => { op.id = 'stock'; })), 'only stock_on_hand is a stock operation');
  rejects(() => validatePublished(stockOp(op => { op.parameters = ['period', 'asOf', 'branch']; })), 'stock is on a date, never a period');
  rejects(() => validatePublished(stockOp(op => { op.definitions = [defs(published)[0]!.name]; })), 'stock reads the quantity definition');
  rejects(() => validatePublished(stockOp(op => { op.definitions = ['stock_level', defs(published)[0]!.name]; })), 'stock reads nothing else');
  rejects(() => validatePublished(stockOp((op, obj) => { obj.operations = (obj.operations as Obj[]).filter(item => item !== op); })), 'a quantity definition always compiles to stock on hand');
  rejects(() => validatePublished(stockOp(op => { op.type = 'sum'; })), 'a sum may not read the quantity definition');
  rejects(() => validatePublished(edit(published, obj => {
    (obj.operations as Obj[]).push({ id: 'stock_total', label: 'Stock total', type: 'sum', definitions: ['stock_level'], parameters: [] });
  })), 'no money operation reads a quantity');
  const frozen = await engine();
  rejects(() => validatePublished(edit(frozen.compileRaw(frozen.rawPack(1), 1, 'member_fixture'), obj => {
    (obj.operations as Obj[]).push({ id: 'stock_on_hand', label: 'Stock on hand', type: 'stock', definitions: [defs(obj)[0]!.name], parameters: ['asOf', 'branch', 'onDate'] });
  })), 'no stock operation without a quantity definition');
});

test('BK-08 example and usedFrom on a definition are accepted when exact and refused otherwise', async () => {
  const draft = await stockDraft();
  const first = (change: (d: Obj) => void) => edit(draft, obj => change(defs(obj)[0]!));
  validateDraft(first(d => { d.usedFrom = '2026-04-01'; d.example = { rows: [{ label: 'Invoice 1', amountMinor: '1000', counted: true }, { label: 'Cancelled', amountMinor: '500', counted: false, reason: 'Cancelled orders do not count.' }], resultMinor: String(1000 * ((d.sign as number | undefined) ?? 1)) }; }));
  rejects(() => validateDraft(first(d => { d.usedFrom = '2026-02-30'; })), 'a calendar day');
  rejects(() => validateDraft(first(d => { d.example = { rows: [{ label: 'Invoice 1', amountMinor: '1000', counted: true }], resultMinor: '999' }; })), 'the result is the counted rows');
  rejects(() => validateDraft(first(d => { d.example = { rows: [{ label: 'Left out', amountMinor: '10', counted: false }], resultMinor: '0' }; })), 'a row left out says why');
  rejects(() => validateDraft(first(d => { d.example = { rows: [], resultMinor: '0' }; })), 'one to twelve rows');
});

const item = (sku: string, minor: string, unit = 'pcs') => ({ key: `item:${sku}`, label: sku, minor, display: `${minor} ${unit}`, unit: 'quantity', quantityUnit: unit });
const countOf = (key: 'items' | 'itemsNotShown', minor: number, label = 'Items') => ({ key, label, minor: String(minor), display: String(minor), unit: 'count' });
const total = (minor: string, unit = 'pcs') => ({ key: 'total', label: 'Stock on hand, all items', minor, display: `${minor} ${unit}`, unit: 'quantity', quantityUnit: unit });

test('stock on hand figures: quantity with its unit, or a count, in the calculator order', () => {
  const figures = validateStockFigures([item('SKU-1', '12'), item('SKU-2', '-3'), countOf('items', 2), total('9')]);
  assert.equal(figures.length, 4);
  assert.ok(Object.isFrozen(figures) && Object.isFrozen(figures[0]));
  validateStockFigures([item('SKU-1', '12', 'kg'), item('SKU-2', '3', 'pcs'), countOf('items', 2)]);
  validateStockFigures([countOf('items', 0)]);
  const many = Array.from({ length: 100 }, (_, index) => item(`SKU-${String(index).padStart(3, '0')}`, '1'));
  validateStockFigures([...many, countOf('items', 103), total('103'), countOf('itemsNotShown', 3)]);
  validateStockFigures([...many, countOf('items', 101), countOf('itemsNotShown', 1)]);
});

test('stock on hand figures with a wrong shape are refused', () => {
  rejects(() => validateStockFigures([{ ...item('SKU-1', '12'), quantityUnit: undefined }, countOf('items', 1), total('12')].map(f => JSON.parse(JSON.stringify(f)))), 'a quantity carries its unit');
  rejects(() => validateStockFigures([item('SKU-1', '12'), { ...countOf('items', 1), quantityUnit: 'pcs' }, total('12')]), 'a count has no unit');
  rejects(() => validateStockFigures([{ ...item('SKU-1', '12'), unit: 'money', currency: 'INR' }, countOf('items', 1)]), 'never money');
  rejects(() => validateStockFigures([item('SKU-1', '1.5'), countOf('items', 1), total('1.5')]), 'whole numbers only');
  rejects(() => validateStockFigures([item('SKU-1', '12'), countOf('items', 1), total('13')]), 'the total is the exact sum');
  rejects(() => validateStockFigures([item('SKU-1', '12'), countOf('items', 1)]), 'one unit means a total');
  rejects(() => validateStockFigures([item('SKU-1', '12', 'kg'), item('SKU-2', '3'), countOf('items', 2), total('15')]), 'units are never added');
  rejects(() => validateStockFigures([item('SKU-2', '3'), item('SKU-1', '12'), countOf('items', 2), total('15')]), 'items in order');
  rejects(() => validateStockFigures([item('SKU-1', '3'), item('SKU-1', '3'), countOf('items', 2), total('6')]), 'each item once');
  rejects(() => validateStockFigures([item('SKU-1', '12'), countOf('items', 2), total('12')]), 'the count is the items');
  rejects(() => validateStockFigures([countOf('items', 1), item('SKU-1', '12'), total('12')]), 'items come first');
  rejects(() => validateStockFigures([item('SKU-1', '12'), total('12'), countOf('items', 1)]), 'the count before the total');
  rejects(() => validateStockFigures([item('SKU-1', '12'), countOf('items', 1), total('12'), countOf('itemsNotShown', 0)]), 'items not shown only past 100');
  rejects(() => validateStockFigures([{ ...item('SKU-1', '12'), display: '12 kg' }, countOf('items', 1), total('12')]), 'the display is the quantity in its unit');
  rejects(() => validateStockFigures([{ ...item('SKU-1', '12'), label: 'SKU-9' }, countOf('items', 1), total('12')]), 'the label is the item');
  rejects(() => validateStockFigures([{ ...item('SKU-1', '12'), extra: true }, countOf('items', 1), total('12')]), 'exact keys');
  rejects(() => validateStockFigures([item('SKU-1', '12')]), 'the item count is always there');
  const many = Array.from({ length: 101 }, (_, index) => item(`SKU-${String(index).padStart(3, '0')}`, '1'));
  rejects(() => validateStockFigures([...many, countOf('items', 101), countOf('itemsNotShown', 0)]), 'at most 100 item figures');
});
