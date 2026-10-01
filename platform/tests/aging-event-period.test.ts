import test from 'node:test';
import assert from 'node:assert/strict';
import {CalculatorService} from '../runtime/calculator.ts';
import {DatabaseCalculator} from '../runtime/analytics.ts';
import {MemoryService, type FactInput} from '../runtime/memory.ts';
import {OntologyService} from '../runtime/ontology.ts';
import {FixtureStateStore, fixtureOwner} from './database-fixtures.ts';

// Authored synthetic business arithmetic. SQL ports below are explicitly injected
// fixtures; no native database, provider, vendor or historical receipt is qualified.
const period = {from: '2026-09-01', to: '2026-09-30'};
const request = {operation: 'aging', period, asOf: '2100-01-01T00:00:00Z', onDate: '2026-11-01'};
function event(entityId: string, kind: string, amountMinor: string, date: string, invoiceId = entityId): FactInput {
  return {entityId, sourceId: 'synthetic-aging-scope', sourceRow: 2, kind, validFrom: date, branch: 'main',
    fields: {amountMinor, currency: 'INR', status: 'settled', invoiceId, customerId: 'C', ...(kind === 'invoice' ? {dueDate: '2026-09-15'} : {})}};
}
async function fixture() {
  const store = new FixtureStateStore(); await new OntologyService(store).publish(fixtureOwner, 'retail');
  await new MemoryService(store).append(fixtureOwner, [
    event('start', 'invoice', '100', '2026-09-01'), event('end', 'invoice', '200', '2026-09-30'),
    event('before', 'invoice', '400', '2026-08-31'), event('after', 'invoice', '800', '2026-10-01'),
    event('paid', 'payment', '25', '2026-09-02', 'start'), event('credit', 'refund', '10', '2026-09-30', 'end'),
    event('later-paid', 'payment', '30', '2026-10-01', 'end'), event('earlier-credit', 'refund', '5', '2026-08-31', 'start'),
  ]);
  return {store, calculator: new CalculatorService(store)};
}

test('inclusive aging event period binds invoice, payment and credit rows while omitted period explicitly counts all dates', async () => {
  const f = await fixture(), scoped = await f.calculator.calculate(fixtureOwner, request);
  assert.equal(scoped.totalMinor, '265'); assert.deepEqual(scoped.period, period);
  assert.deepEqual(scoped.rows.map(row => row.entityId).sort(), ['credit', 'end', 'paid', 'start']);
  assert.equal(scoped.figures.find(value => value.key === 'days31to60')!.minor, '265');
  assert.equal(scoped.figures.find(value => value.key === 'unallocated')!.minor, '0');
  assert.equal(scoped.coverage.countedRows, 4);
  const outside = f.store.read().facts.filter(row => ['before', 'after', 'later-paid', 'earlier-credit'].includes(row.entityId));
  assert.deepEqual(scoped.exclusions.map(row => row.rowId).sort(), outside.map(row => row.id).sort());
  const all = await f.calculator.calculate(fixtureOwner, {...request, period: undefined});
  assert.equal(all.totalMinor, '1430'); assert.equal(all.period, null); assert.equal(all.coverage.countedRows, 8);
  assert.deepEqual(await f.calculator.receipt(fixtureOwner, scoped.id), scoped, 'A later calculation does not rewrite the scoped receipt.');
});

test('aging observation date further bounds a declared inclusive event period', async () => {
  const f = await fixture(), receipt = await f.calculator.calculate(fixtureOwner, {...request, onDate: '2026-09-15'});
  assert.equal(receipt.totalMinor, '75'); assert.deepEqual(receipt.rows.map(row => row.entityId).sort(), ['paid', 'start']);
  assert.equal(receipt.figures.find(value => value.key === 'notDue')!.minor, '75');
});

test('an in-period payment for an excluded invoice remains unallocated and an earlier observation date counts no events', async () => {
  const f = await fixture();
  await new MemoryService(f.store).append(fixtureOwner, [event('orphan-in-scope', 'payment', '20', '2026-09-01', 'before')]);
  const scoped = await f.calculator.calculate(fixtureOwner, request);
  assert.equal(scoped.totalMinor, '265'); assert.equal(scoped.figures.find(value => value.key === 'unallocated')!.minor, '20');
  assert.equal(scoped.rows.some(row => row.entityId === 'before'), false);
  const earlier = await f.calculator.calculate(fixtureOwner, {...request, onDate: '2026-08-31'});
  assert.equal(earlier.totalMinor, '0'); assert.deepEqual(earlier.rows, []);
  assert.equal(earlier.coverage.completeness, 'empty');
});

test('SQL projection refuses aging lineage outside its declared period before opening any connection', async () => {
  const f = await fixture(), receipt = await f.calculator.calculate(fixtureOwner, request);
  let opened = 0;
  const database = new DatabaseCalculator({connectionFactory: async () => {opened++; throw Error('Synthetic fixture must not open a native database.');}});
  for (const index of [0, 1, 2, 3]) {
    const altered = structuredClone(receipt); altered.rows[index].validFrom = '2026-10-01';
    await assert.rejects(database.verify(altered), {code: 'SQL_PROJECTION_INVALID'});
  }
  assert.equal(opened, 0);
});
