import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, type Context } from '../runtime/contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculatorOptions } from '../runtime/calculator.ts';
import { assertCompiledSingleSum, compileSingleSum } from '../runtime/compiled-calculation.ts';
import { seedDemo } from '../runtime/ingest.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { compileDictionary, OntologyService, starterPacks, type Definition, type DictionaryDraft } from '../runtime/ontology.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Labelled local synthetic compiler/calculator cases; native SQL is qualified separately.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const period = { from: '2026-09-01', to: '2026-09-30' };
const request = (operation: string) => ({ operation, period, asOf: '2100-01-01T00:00:00Z' });
const definition = (changes: Partial<Definition> = {}): Definition => ({ name: 'bank_revenue', label: 'Revenue as receipts',
  meaning: 'An owner measure counting settled payment events as revenue.', kind: 'payment', field: 'amountMinor', currency: 'INR', nulls: 'reject', ...changes });
function draft(custom = definition()): DictionaryDraft {
  const value = structuredClone(starterPacks[0]); value.definitions.push(custom); return value;
}
function fact(id: string, fields: Record<string, unknown>, kind = 'payment'): FactInput {
  return { entityId: id, sourceId: 'synthetic-money', sourceRow: 2, kind, validFrom: '2026-09-10', branch: 'main',
    fields: { amountMinor: '999000', currency: 'INR', status: 'settled', ...fields } };
}
async function setup(value = draft(), options: CalculatorOptions = {}) {
  const store = new FixtureStateStore(), ontology = new OntologyService(store);
  const dictionary = await ontology.publish(owner, value);
  return { store, ontology, dictionary, calculator: new CalculatorService(store, options), memory: new MemoryService(store) };
}

test('published owner bank revenue has its own exact answer, receipt and compiler binding', async () => {
  const value = await setup(); await seedDemo(value.store, owner);
  // Independent demo key: invoices 100000+200000, receipts 60000+200000, delivery 100000+150000.
  for (const [operation, expected] of [['billed', '300000'], ['received', '260000'], ['earned', '250000'], ['bank_revenue', '260000']]) {
    const receipt = await value.calculator.calculate(owner, request(operation));
    assert.equal(receipt.totalMinor, expected, operation);
    assert.equal(receipt.compiledCalculation!.dictionaryHash, value.dictionary.hash);
    assert.equal(receipt.compiledCalculation!.sum.operationId, operation);
    assert.equal(receipt.compiledCalculation!.sum.dictionaryVersion, value.dictionary.version);
    assert.equal(receipt.compiledCalculation!.sum.moneyField, 'amountMinor');
    assert.ok(receipt.rows.every(row => row.measureField === 'amountMinor'));
    assert.deepEqual(value.calculator.receipt(owner, receipt.id), receipt);
  }
  assert.ok(value.calculator.catalog(owner).some(operation => operation.id === 'bank_revenue'));
  assert.equal(new Set(value.store.read().receipts.map(receipt => receipt.id)).size, 4);
});

test('alternate published tax and fee fields preserve the actual counted row values for the verifier', async () => {
  for (const [field, name] of [['taxMinor', 'tax_total'], ['feeMinor', 'platform_fees']]) {
    let projection: CalculationReceipt | undefined;
    const value = await setup(draft(definition({ name, field })), { verifier: async receipt => { projection = receipt; return { fixtureOnly: true }; } });
    await value.memory.append(owner, [fact('one', { amountMinor: '100000', [field]: '17', _fx: { numerator: '2', denominator: '1' }, _sourceCurrency: 'USD' }),
      fact('two', { amountMinor: '200000', [field]: '23' })]);
    const receipt = await value.calculator.calculate(owner, request(name));
    assert.equal(receipt.totalMinor, '40');
    assert.deepEqual(receipt.rows.map(row => [row.amountMinor, row.measureField]), [['17', field], ['23', field]]);
    assert.equal(receipt.compiledCalculation!.sum.moneyField, field);
    assert.deepEqual(projection!.rows, receipt.rows);
    assert.equal(receipt.rows[0].normalization, undefined, 'The default amount FX receipt cannot describe a different money field.');
  }
});

test('signed custom money retains large exact input encodings and applies its declared sign once', async () => {
  const value = await setup(draft(definition({ name: 'signed_fees', field: 'feeMinor', sign: -1 })));
  await value.memory.append(owner, [fact('huge', { feeMinor: '-900719925474099325', amountMinor: '1' }), fact('small', { feeMinor: '-75', amountMinor: '2' })]);
  const receipt = await value.calculator.calculate(owner, request('signed_fees'));
  assert.equal(receipt.totalMinor, '900719925474099400');
  assert.deepEqual(receipt.rows.map(row => row.amountMinor), ['-900719925474099325', '-75']);
  assert.equal(receipt.compiledCalculation!.sum.sign, -1);
  assert.ok(receipt.rows.every(row => row.measureField === 'feeMinor'));
});

test('custom missing-value policies exclude with partial coverage or reject without saving', async () => {
  for (const nulls of ['exclude', 'reject'] as const) {
    const value = await setup(draft(definition({ name: 'known_fees', field: 'feeMinor', nulls })));
    await value.memory.append(owner, [fact('known', { feeMinor: '50' }), fact('unknown', { feeMinor: null }), fact('absent', {})]);
    if (nulls === 'reject') {
      await assert.rejects(value.calculator.calculate(owner, request('known_fees')), { code: 'MISSING_MEASURE_VALUE' });
      assert.equal(value.store.read().receipts.length, 0); assert.equal(value.store.read().answers.length, 0);
    } else {
      const receipt = await value.calculator.calculate(owner, request('known_fees'));
      assert.equal(receipt.totalMinor, '50'); assert.equal(receipt.coverage.completeness, 'partial');
      assert.equal(receipt.coverage.countedRows, 1); assert.equal(receipt.coverage.excludedRows, 2);
      assert.ok(receipt.coverage.gaps.some(gap => gap.includes('not zero')));
      assert.equal(receipt.compiledCalculation!.sum.nullPolicy, 'exclude');
    }
  }
});

test('changed dictionary during verification refuses the calculation before saving any answer', async () => {
  let finish!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const value = await setup(draft(), { verifier: async () => { entered(); await waiting; return { fixtureOnly: true }; } });
  await value.memory.append(owner, [fact('payment', { amountMinor: '260000' })]);
  const pending = value.calculator.calculate(owner, request('bank_revenue')); await started;
  await value.ontology.publish(owner, draft(definition({ meaning: 'A changed owner explanation requires a newly published dictionary revision.' })));
  finish(); await assert.rejects(pending, { code: 'DICTIONARY_CHANGED' });
  assert.equal(value.store.read().receipts.length, 0); assert.equal(value.store.read().answers.length, 0);
});

test('access revocation during verification refuses the calculation before saving any answer', async () => {
  let finish!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const value = await setup(draft(), { verifier: async () => { entered(); await waiting; return { fixtureOnly: true }; } });
  await value.memory.append(owner, [fact('payment', { amountMinor: '260000' })]);
  const pending = value.calculator.calculate(owner, request('bank_revenue')); await started;
  await value.store.update(state => { state.members[0].epoch++; });
  finish(); await assert.rejects(pending, { code: 'ACCESS_REVOKED' });
  assert.equal(value.store.read().receipts.length, 0); assert.equal(value.store.read().answers.length, 0);
});

test('present missing, duplicate and tampered compiler artifacts refuse before verification', async () => {
  let opened = 0;
  const value = await setup(draft(), { verifier: async () => { opened++; return { fixtureOnly: true }; } });
  await value.memory.append(owner, [fact('payment', { amountMinor: '260000' })]);
  for (const mutation of [
    (sums: NonNullable<typeof value.dictionary.compiledSums>) => sums.filter(sum => sum.operationId !== 'bank_revenue'),
    (sums: NonNullable<typeof value.dictionary.compiledSums>) => [...sums, sums.find(sum => sum.operationId === 'bank_revenue')!],
    (sums: NonNullable<typeof value.dictionary.compiledSums>) => sums.map(sum => sum.operationId === 'bank_revenue' ? { ...sum, moneyField: 'feeMinor' } : sum),
  ]) {
    await value.store.update(state => { state.ontology.current.compiledSums = mutation(structuredClone(value.dictionary.compiledSums!)); });
    await assert.rejects(value.calculator.calculate(owner, request('bank_revenue')), { code: 'COMPILED_SUM_MISMATCH' });
  }
  assert.equal(opened, 0); assert.equal(value.store.read().receipts.length, 0);
});

test('closed artifact validation rejects executable extensions and self-consistent wrong bindings', () => {
  const dictionary = compileDictionary(draft(), 3, 'owner', '2026-09-01T00:00:00Z');
  const sum = dictionary.compiledSums!.find(artifact => artifact.operationId === 'bank_revenue')!;
  const measure = dictionary.definitions.find(item => item.name === 'bank_revenue')!;
  assertCompiledSingleSum(sum, 'bank_revenue', measure, 3);
  assert.throws(() => assertCompiledSingleSum({ ...sum, sql: 'SELECT 1' }, 'bank_revenue', measure, 3), { code: 'COMPILED_SUM_MISMATCH' });
  const { digest: ignored, ...wrong } = { ...sum, moneyField: 'feeMinor' };
  assert.throws(() => assertCompiledSingleSum({ ...wrong, digest: hash(wrong) }, 'bank_revenue', measure, 3), { code: 'COMPILED_SUM_MISMATCH' });
  assert.throws(() => assertCompiledSingleSum(sum, 'bank_revenue', measure, 4), { code: 'COMPILED_SUM_MISMATCH' });
  assert.deepEqual(compileSingleSum(dictionary.operations.find(operation => operation.id === 'bank_revenue')!, structuredClone(measure), 3), sum);
});

test('legacy dictionary and saved receipt shapes remain readable while new sums gain bindings', async () => {
  const value = await setup();
  await value.store.update(state => {
    const legacy = structuredClone(state.ontology.current); delete legacy.compiledSums;
    const { hash: ignored, ...content } = legacy; legacy.hash = hash(content); state.ontology.current = legacy;
  });
  await value.memory.append(owner, [fact('payment', { amountMinor: '260000' })]);
  const receipt = await value.calculator.calculate(owner, request('bank_revenue'));
  assert.equal(receipt.totalMinor, '260000'); assert.equal(receipt.compiledCalculation!.dictionaryHash, value.ontology.current(owner)!.hash);
  await value.store.update(state => {
    const saved = state.receipts.find(item => item.id === receipt.id); delete saved.compiledCalculation;
    saved.rows.forEach((row: { measureField?: string }) => { delete row.measureField; });
  });
  assert.equal(value.calculator.receipt(owner, receipt.id).totalMinor, '260000');
});

test('fixed composite contracts retain their receipts, and isolated special-name definitions remain simple sums', async () => {
  const value = await setup(); await seedDemo(value.store, owner);
  for (const [operation, expected] of [['net_sales', '240000'], ['margin', '130000'], ['aging', '30000']]) {
    const receipt = await value.calculator.calculate(owner, { ...request(operation), onDate: '2026-09-30' });
    assert.equal(receipt.totalMinor, expected); assert.equal(receipt.compiledCalculation, undefined);
    assert.ok(receipt.rows.every(row => row.measureField === undefined));
  }
  for (const name of ['net_sales', 'margin', 'aging', 'change', 'scenario']) {
    const single = draft(); single.definitions = [definition({ name })];
    const isolated = await setup(single); await isolated.memory.append(owner, [fact('payment', { amountMinor: '41' })]);
    const receipt = await isolated.calculator.calculate(owner, request(name));
    assert.equal(receipt.totalMinor, '41', name); assert.equal(receipt.compiledCalculation!.sum.operationId, name);
    assert.equal(receipt.figures.length, 1); assert.equal(receipt.figures[0].key, 'total');
  }
});

test('generated operation collisions refuse atomic publication and retain the previous dictionary', async () => {
  const value = await setup();
  for (const name of ['revenue', 'net_sales', 'margin', 'aging', 'change', 'scenario']) {
    await assert.rejects(value.ontology.publish(owner, draft(definition({ name }))), { code: 'RESERVED_MEASURE' });
    assert.equal(value.ontology.current(owner)!.hash, value.dictionary.hash);
    assert.equal(value.ontology.history(owner).length, 1);
  }
});
