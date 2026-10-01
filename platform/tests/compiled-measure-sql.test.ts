import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, hash, type State, type StateStore, type Context } from '../runtime/contracts.ts';
import { compileSingleSum } from '../runtime/compiled-calculation.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import { MemoryService } from '../runtime/memory.ts';
import { CalculatorService, type CalculationReceipt } from '../runtime/calculator.ts';
import { DatabaseCalculator, type SQLConnection, type SQLDialect } from '../runtime/analytics.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
class Store implements StateStore {
  state = initialState('Explicit synthetic custom measure SQL fixture', true);
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
async function customReceipt(operation = 'owner_fees') {
  const store = new Store(), ontology = new OntologyService(store);
  const draft = structuredClone(starterPacks[0]);
  draft.definitions = [{ name: operation, label: 'Owner declared fee sum', meaning: 'Sum explicit fee values on settled payment facts only.', kind: 'payment', field: 'feeMinor', currency: 'INR', nulls: 'reject', sign: -1 }];
  await ontology.publish(owner, draft);
  await new MemoryService(store).append(owner, [
    { entityId: 'one', sourceId: 'synthetic-only', sourceRow: 2, kind: 'payment', validFrom: '2026-09-03', branch: 'main', fields: { amountMinor: '100000', feeMinor: '900719925474099391', currency: 'INR', status: 'settled' } },
    { entityId: 'two', sourceId: 'synthetic-only', sourceRow: 3, kind: 'payment', validFrom: '2026-09-04', branch: 'main', fields: { amountMinor: '200000', feeMinor: '9', currency: 'INR', status: 'settled' } },
  ]);
  return new CalculatorService(store).calculate(owner, { operation, period: { from: '2026-09-01', to: '2026-09-30' } });
}
function injected(answer = '-900719925474099400', sqlDialect: SQLDialect = 'duckdb') {
  const calls: { sql: string; parameters: (string | number | null)[] }[] = []; let opened = 0, closed = 0;
  const connection: SQLConnection = { async execute(sql, parameters = []) { calls.push({ sql, parameters: [...parameters] }); return sql.startsWith('WITH ') ? [{ total: answer }] : []; }, close() { closed++; } };
  const database = new DatabaseCalculator({ sqlDialect, connectionFactory: async () => { opened++; return connection; } });
  return { database, calls, counts: () => ({ opened, closed }) };
}

test('compiler-bound owner money field enters parameterized SQL exactly; injected evidence is labelled', async () => {
  const receipt = await customReceipt();
  assert.equal(receipt.totalMinor, '-900719925474099400');
  assert.deepEqual(receipt.rows.map(row => row.amountMinor), ['900719925474099391', '9']);
  assert.ok(receipt.rows.every(row => row.measureField === 'feeMinor'));
  for (const dialect of ['duckdb', 'postgres'] as const) {
    const fixture = injected(undefined, dialect), proof = await fixture.database.verify(receipt);
    assert.equal(proof.engine, 'injected-sql'); assert.equal(proof.compiledDigest, receipt.compiledCalculation!.sum.digest);
    assert.ok(fixture.calls.some(call => call.sql.startsWith('INSERT INTO receipt_rows') && call.parameters[2] === '900719925474099391'));
    assert.deepEqual(fixture.calls.at(-1)!.parameters, ['owner_fees']);
    assert.ok(fixture.calls.every(call => !call.sql.includes('owner_fees')));
    assert.equal(fixture.calls.at(-1)!.sql.includes('HUGEINT'), dialect === 'duckdb');
    assert.deepEqual(fixture.counts(), { opened: 1, closed: 1 });
  }
});

test('a published simple sum named margin retains compiler type rather than implicit composite semantics', async () => {
  const receipt = await customReceipt('margin'), fixture = injected();
  const proof = await fixture.database.verify(receipt);
  assert.equal(proof.compiledDigest, receipt.compiledCalculation!.sum.digest);
  assert.deepEqual(fixture.calls.at(-1)!.parameters, ['margin']);
  assert.ok(!fixture.calls.at(-1)!.sql.includes('contribution'));
});

test('missing, changed or foreign compiler bindings refuse before acquiring SQL', async () => {
  const base = await customReceipt();
  const mutations: ((receipt: CalculationReceipt) => void)[] = [
    receipt => { delete receipt.compiledCalculation; },
    receipt => { receipt.compiledCalculation!.dictionaryHash = '0'.repeat(64); },
    receipt => { receipt.ontologyVersion++; },
    receipt => { receipt.definitionHash = '0'.repeat(64); },
    receipt => { receipt.compiledCalculation!.sum.moneyField = 'amountMinor'; },
    receipt => { receipt.compiledCalculation!.sum.sign = 1; },
    receipt => { receipt.compiledCalculation!.sum.digest = '0'.repeat(64); },
    receipt => { receipt.rows[0].measureField = 'amountMinor'; },
    receipt => { receipt.operation = 'SELECT arbitrary'; },
    receipt => { (receipt.compiledCalculation!.sum as any).execute = 'arbitrary executable syntax'; },
    receipt => { receipt.definitions[0].field = 'otherField'; },
  ];
  for (const mutate of mutations) {
    const receipt = structuredClone(base), fixture = injected(); mutate(receipt);
    await assert.rejects(fixture.database.verify(receipt));
    assert.deepEqual(fixture.counts(), { opened: 0, closed: 0 });
  }
});

test('wrong projected money or independent SQL answer refuses without a verified result', async () => {
  const receipt = await customReceipt(), fixture = injected('300000');
  await assert.rejects(fixture.database.verify(receipt), { code: 'SQL_RESULT_MISMATCH' });
  assert.deepEqual(fixture.counts(), { opened: 1, closed: 1 });
  const overflow = structuredClone(receipt); overflow.rows[0].amountMinor = '9'.repeat(38); overflow.rows[1].amountMinor = '9';
  await assert.rejects(injected().database.verify(overflow), { code: 'SQL_PRECISION_LIMIT' });
});

test('a wrong answer inside the 38-digit boundary reaches SQL; overflow refuses before acquisition', async () => {
  const receipt = await customReceipt();
  receipt.definitions[0].sign = 1;
  receipt.definitionHash = hash(receipt.definitions);
  receipt.compiledCalculation!.sum = compileSingleSum({ id: receipt.operation, label: 'Boundary fixture', type: 'sum', definitions: ['owner_fees'], parameters: [] }, receipt.definitions[0], receipt.ontologyVersion);
  const maximum = '9'.repeat(38);
  receipt.rows[0].amountMinor = maximum; receipt.rows[1].amountMinor = '0';
  receipt.valueMinor = receipt.totalMinor = maximum;
  receipt.figures[0].minor = String(BigInt(maximum) - 1n);
  const inside = injected(maximum);
  await assert.rejects(inside.database.verify(receipt), { code: 'SQL_RESULT_MISMATCH' });
  assert.deepEqual(inside.counts(), { opened: 1, closed: 1 });
  receipt.figures[0].minor = String(BigInt(maximum) + 1n);
  const overflow = injected(maximum);
  await assert.rejects(overflow.database.verify(receipt), { code: 'SQL_PROJECTION_INVALID' });
  assert.deepEqual(overflow.counts(), { opened: 0, closed: 0 });
});
