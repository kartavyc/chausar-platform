import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService, convertMinor, NO_RATE_REASON, NOT_COUNTED_GAP, numberGuard, ratesOf } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { Engine } from '../runtime/engine.ts';
import { calcMethods } from '../runtime/core-data/calc.ts';
import { rateMethods } from '../runtime/work-books/books-rates.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';

// BK-19: owner-entered exchange rates applied by the calculator, and the not-counted count on every receipt. Synthetic data only.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic FX shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const period = { from: '2026-09-01', to: '2026-09-30' };

async function setup(options: ConstructorParameters<typeof CalculatorService>[1] = {}) {
  const store = new TestStore(); const ontology = new OntologyService(store); await ontology.publish(owner, 'ecommerce');
  const memory = new MemoryService(store), calculator = new CalculatorService(store, options);
  const host: ModuleHost = { store, services: { memory, ontology, calculator }, demo: true, directory: '/tmp/x', options: {}, async call() { throw new Error('none'); } };
  const setRate = async (currency: string, on: string, units: string, per: string) => { authorize(store, owner, 'admin'); return rateMethods['books.setRate'].handler(owner, { currency, on, rate: { units, per }, source: 'Synthetic bank board rate' }, host); };
  return { store, memory, calculator, setRate };
}
const fact = (entityId: string, kind: string, amountMinor: string, fields: Record<string, unknown> = {}, validFrom = '2026-09-02'): FactInput =>
  ({ entityId, kind, validFrom, sourceId: 'books', sourceRow: 2, branch: 'main', fields: { currency: 'INR', amountMinor, ...fields } });

test('the work-books rate table is registered as the calculator rate reader at module load', async () => {
  assert.ok(calcMethods['coredata.bankTotals']);
  const f = await setup(); await f.setRate('USD', '2026-09-02', '832150', '10000');
  assert.deepEqual(ratesOf(f.store.read()).map(r => [r.currency, r.on, r.units, r.per]), [['USD', '2026-09-02', '832150', '10000']]);
});

test('conversion is exact BigInt with a declared half-away-from-zero rounding', () => {
  assert.equal(convertMinor(10000n, 'USD', 'INR', { units: '832150', per: '10000' }), 832150n);
  assert.equal(convertMinor(1n, 'USD', 'INR', { units: '832150', per: '10000' }), 83n); // 83.215 paise
  assert.equal(convertMinor(3n, 'USD', 'INR', { units: '832150', per: '10000' }), 250n); // 249.645 paise
  assert.equal(convertMinor(-3n, 'USD', 'INR', { units: '832150', per: '10000' }), -250n);
  assert.equal(convertMinor(1n, 'USD', 'INR', { units: '1', per: '2' }), 1n); // exactly half a paisa rounds away from zero
  assert.equal(convertMinor(-1n, 'USD', 'INR', { units: '1', per: '2' }), -1n);
  assert.equal(convertMinor(1n, 'USD', 'INR', { units: '1', per: '200' }), 0n);
  assert.equal(convertMinor(1n, 'JPY', 'INR', { units: '56', per: '100' }), 56n); // yen has no minor unit
  assert.equal(convertMinor(1000n, 'KWD', 'INR', { units: '270', per: '1' }), 27000n); // three-digit minor unit
  assert.equal(convertMinor(900719925474099391n, 'USD', 'INR', { units: '832150', per: '10000' }), 74953408598327180822n); // beyond float precision (checked independently)
  assert.throws(() => convertMinor(1n, 'USD', 'INR', { units: '0', per: '1' }), { code: 'INVALID_EXCHANGE_RATE' });
});

test('a foreign row converts with the rate dated on its own day, keeping the source amount and the rate on the receipt row', async () => {
  const f = await setup(); await f.setRate('USD', '2026-09-02', '832150', '10000');
  await f.memory.append(owner, [fact('usd-sale', 'sale', '10000', { currency: 'USD' }), fact('inr-sale', 'sale', '5000')]);
  const receipt = await f.calculator.calculate(owner, { operation: 'earned', period });
  assert.equal(receipt.valueMinor, '837150'); assert.equal(receipt.coverage.notCounted, 0); assert.equal(receipt.coverage.completeness, 'unreconciled-facts');
  const row = receipt.rows.find(r => r.entityId === 'usd-sale')!;
  assert.equal(row.amountMinor, '832150'); assert.equal(row.sourceAmountMinor, '10000');
  assert.deepEqual(row.normalization, { sourceCurrency: 'USD', targetCurrency: 'INR', rate: { units: '832150', per: '10000', on: '2026-09-02', source: 'Synthetic bank board rate', rounding: 'half-up' } });
  assert.equal(receipt.rows.find(r => r.entityId === 'inr-sale')!.normalization, undefined);
  assert.deepEqual(f.calculator.receipt(owner, receipt.id), receipt);
});

test('a row with no rate for its date is not counted, with its reason, the count and a gap; no nearest-date rule', async () => {
  const f = await setup(); await f.setRate('USD', '2026-09-02', '832150', '10000');
  await f.memory.append(owner, [fact('usd-next-day', 'sale', '10000', { currency: 'USD' }, '2026-09-03'), fact('eur', 'sale', '700', { currency: 'EUR' }), fact('inr-sale', 'sale', '5000')]);
  const receipt = await f.calculator.calculate(owner, { operation: 'earned', period });
  assert.equal(receipt.valueMinor, '5000'); assert.equal(receipt.coverage.notCounted, 2); assert.equal(receipt.coverage.completeness, 'partial');
  assert.deepEqual(receipt.exclusions.filter(e => e.reason === NO_RATE_REASON).length, 2);
  assert.ok(receipt.coverage.gaps.includes(NOT_COUNTED_GAP)); assert.ok(receipt.explanation.includes(NOT_COUNTED_GAP));
  assert.ok(receipt.allowedNumbers.includes('2'));
  assert.deepEqual(numberGuard('Two amounts, 2 in all, were not counted.', receipt), { accepted: true, checkedNumbers: 1 });
  assert.throws(() => numberGuard('7 amounts were not counted.', receipt), { code: 'UNGROUNDED_NUMBER' });
  // The receipt opens through the ordinary read path; excluded rows are checked as visible rows too.
  assert.equal(f.calculator.receipt(owner, receipt.id).coverage.notCounted, 2);
  // Entering the missing rate counts it on the next calculation.
  await f.setRate('USD', '2026-09-03', '830000', '10000');
  const after = await f.calculator.calculate(owner, { operation: 'earned', period });
  assert.equal(after.valueMinor, String(5000 + 830000)); assert.equal(after.coverage.notCounted, 1);
});

test('every receipt carries notCounted, zero when nothing was set aside; rows converted when read keep their behaviour', async () => {
  const f = await setup();
  await f.memory.append(owner, [
    fact('read-converted', 'sale', '83215', { _fx: { numerator: '832150', denominator: '10000', rounding: 'half-up' }, _sourceCurrency: 'USD' }),
    fact('inv', 'invoice', '1000', { invoiceId: 'I-1', customerId: 'C-1', dueDate: '2026-09-15' }), fact('pay', 'payment', '400', { invoiceId: 'I-1', customerId: 'C-1' }),
    fact('ref', 'refund', '100'), fact('cost', 'cost', '200'), fact('buy', 'purchase', '300'),
  ]);
  for (const request of [{ operation: 'earned', period }, { operation: 'revenue', period }, { operation: 'net_sales', period }, { operation: 'margin', period }, { operation: 'billed', period },
    { operation: 'received', period }, { operation: 'purchases', period }, { operation: 'aging', onDate: '2026-09-30' }, { operation: 'change', period, comparePeriod: { from: '2026-08-01', to: '2026-08-31' } },
    { operation: 'scenario', period, assumptions: { priceChangeBps: '500' } }]) {
    const receipt = await f.calculator.calculate(owner, request as any);
    assert.equal(receipt.coverage.notCounted, 0, request.operation);
    assert.ok(!receipt.coverage.gaps.includes(NOT_COUNTED_GAP), request.operation); assert.equal(f.calculator.receipt(owner, receipt.id).coverage.notCounted, 0);
  }
  const earned = await f.calculator.calculate(owner, { operation: 'earned', period });
  const row = earned.rows.find(r => r.entityId === 'read-converted')!;
  assert.equal(row.amountMinor, '83215'); assert.equal(row.sourceAmountMinor, undefined);
  assert.deepEqual(row.normalization, { sourceCurrency: 'USD', targetCurrency: 'INR', rate: { numerator: '832150', denominator: '10000', rounding: 'half-up' } });
});

test('aging uses converted invoice and payment amounts; unknown or malformed currencies still refuse', async () => {
  const f = await setup(); await f.setRate('USD', '2026-09-02', '800000', '10000');
  await f.memory.append(owner, [fact('inv', 'invoice', '1000', { currency: 'USD', invoiceId: 'I-1', customerId: 'C-1', dueDate: '2026-09-10' }),
    fact('pay', 'payment', '10000', { invoiceId: 'I-1', customerId: 'C-1' })]);
  const aging = await f.calculator.calculate(owner, { operation: 'aging', onDate: '2026-09-30' });
  assert.equal(aging.figures.find(x => x.key === 'outstanding')!.minor, String(80000 - 10000));
  assert.equal(aging.figures.find(x => x.key === 'days1to30')!.minor, '70000');
  const bad = await setup();
  await bad.memory.append(owner, [fact('odd', 'sale', '1', { currency: 'usd' })]);
  await assert.rejects(bad.calculator.calculate(owner, { operation: 'earned', period }), { code: 'CURRENCY_MISMATCH' });
  const mixed = await setup();
  await mixed.memory.append(owner, [fact('fx-but-foreign', 'sale', '1', { currency: 'USD', _fx: { numerator: '1', denominator: '1', rounding: 'exact' } })]);
  await assert.rejects(mixed.calculator.calculate(owner, { operation: 'earned', period }), { code: 'CURRENCY_MISMATCH' });
});

test('engine: a rate entered with books.setRate is applied by calculation.run and the receipt opens with receipts.get', async (t: TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-calc-fx-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic FX Shop', passphrase: 'Synthetic fx passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  await engine.request('sources.import', { sourceId: 'fx-books', format: 'csv',
    content: 'id,kind,date,amount,currency,branch,status\nI1,invoice,2026-09-02,100.00,INR,main,issued\nI2,invoice,2026-09-02,50.00,INR,main,issued',
    recipe: { version: 1, id: 'synthetic-fx', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic FX', branches: ['main'] },
      bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' }))], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'report' },
    expectedTotals: { rowCount: 2, amountMinor: '15000' } });
  const listed: any = await engine.request('memory.list', {});
  const target = listed.facts.find((f: any) => f.entityId === 'I2').id;
  await engine.request('memory.correct', { id: target, fields: { currency: 'USD', amountMinor: '5000' } });
  const before: any = await engine.request('calculation.run', { operation: 'billed', period });
  assert.equal(before.coverage.notCounted, 1); assert.equal(before.valueMinor, '10000');
  await engine.request('books.setRate', { currency: 'USD', on: '2026-09-02', rate: { units: '83', per: '1' }, source: 'Synthetic rate card' });
  const after: any = await engine.request('calculation.run', { operation: 'billed', period });
  assert.equal(after.coverage.notCounted, 0); assert.equal(after.valueMinor, String(10000 + 5000 * 83));
  assert.deepEqual(await engine.request('receipts.get', { id: after.id }), after);
});
