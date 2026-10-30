import test from 'node:test';
import assert from 'node:assert/strict';
import { CalculatorService } from '../runtime/calculator.ts';
import { DatabaseCalculator } from '../runtime/analytics.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { FixtureStateStore } from './database-fixtures.ts';
import type { Context } from '../runtime/contracts.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const request = { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, asOf: '2100-01-01T00:00:00Z' };
async function setup() {
  const store = new FixtureStateStore();
  await new OntologyService(store).publish(owner, 'retail');
  await new MemoryService(store).append(owner, ['INR', 'USD'].map((currency, index) => ({
    sourceId: 'synthetic-country-history', entityId: `invoice-${currency}`, sourceRow: index + 2, kind: 'invoice',
    validFrom: '2026-09-10', branch: 'main', fields: { amountMinor: index ? '250' : '10000', currency, status: 'issued' },
  })));
  return { store, calculator: new CalculatorService(store) };
}

test('explicit currency scopes never add unlike money or rewrite historical facts and published definitions', async () => {
  const { store, calculator } = await setup();
  const facts = structuredClone(store.read().facts);
  await assert.rejects(calculator.calculate(owner, request), { code: 'CURRENCY_MISMATCH' });
  for (const [currency, total] of [['INR', '10000'], ['USD', '250']]) {
    const receipt = await calculator.calculate(owner, { ...request, currency });
    assert.equal(receipt.totalMinor, total);
    assert.equal(receipt.currency, currency);
    assert.equal(receipt.requestedCurrency, currency);
    assert.deepEqual(receipt.rows.map(row => row.currency), [currency]);
    assert.equal(receipt.definitions[0].currency, 'INR');
    assert.equal(receipt.compiledCalculation!.sum.currency, 'INR');
    assert.equal(receipt.exclusions.filter(row => /currency/.test(row.reason)).length, 1);
    assert.match(receipt.explanation, /Other currencies were excluded/);
    assert.equal(store.read().answers.at(-1)!.request.currency, currency);
  }
  assert.deepEqual(store.read().facts, facts);
  for (const currency of ['', 'usd', 'ZZZ', null, 123]) await assert.rejects(calculator.calculate(owner, { ...request, currency } as never), { code: 'INVALID_CURRENCY' });
});

test('SQL verification retains the published compiler binding and checks every explicitly scoped row currency', async () => {
  const { calculator } = await setup();
  const receipt = await calculator.calculate(owner, { ...request, currency: 'USD' });
  const database = new DatabaseCalculator({ connectionFactory: async () => ({
    execute: async sql => /^(?:WITH|SELECT) /.test(sql) ? [{ total: '250' }] : [], close() {},
  }) });
  assert.equal((await database.verify(receipt)).verified, true);
  for (const alter of [
    (value: typeof receipt) => { value.requestedCurrency = 'INR'; },
    (value: typeof receipt) => { value.rows[0].currency = 'INR'; },
    (value: typeof receipt) => { delete value.rows[0].currency; },
  ]) {
    const changed = structuredClone(receipt); alter(changed);
    await assert.rejects(database.verify(changed), { code: 'SQL_PROJECTION_INVALID' });
  }
});

test('the real SQL verifier computes an explicitly scoped foreign-currency receipt', async () => {
  const { calculator } = await setup();
  const receipt = await calculator.calculate(owner, { ...request, currency: 'USD' });
  assert.equal((await new DatabaseCalculator().verify(receipt)).verified, true);
});
