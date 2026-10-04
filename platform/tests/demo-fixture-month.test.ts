import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { demoCsv, demoCsvForMonth, parseCsv, seedDemo } from '../runtime/ingest.ts';
import { Engine } from '../runtime/engine.ts';

const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
class MemoryStore implements StateStore {
  state = initialState('Synthetic fixture calendar regression', true);
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const next = this.read(), result = await change(next); next.revision++; this.state = next; return result;
  }
}

test('explicit preview months preserve authored values and shift both business dates and due dates', () => {
  const original = parseCsv(demoCsv);
  for (const [month, firstDate, firstDue, priorDate] of [
    ['2026-10', '2026-10-03', '2026-10-10', '2026-09-20'],
    ['2027-01', '2027-01-03', '2027-01-10', '2026-12-20'],
    ['2028-02', '2028-02-03', '2028-02-10', '2028-01-20'],
  ] as const) {
    const shifted = parseCsv(demoCsvForMonth(month)); assert.equal(shifted.length, 10);
    assert.equal(shifted[0]?.date, firstDate); assert.equal(shifted[0]?.dueDate, firstDue);
    assert.equal(shifted[9]?.date, priorDate);
    for (const [index, row] of shifted.entries()) {
      for (const key of Object.keys(row)) if (!['date', 'dueDate'].includes(key)) assert.equal(row[key], original[index]?.[key], `${month}: changed authored ${key}`);
    }
  }
  assert.equal(demoCsvForMonth('2026-09'), demoCsv, 'The authored fixture must remain byte-identical for its original month.');
});

test('ordinary seed remains fixed and explicit calendar copies use the same reconciled import authority', async () => {
  for (const month of [undefined, '2027-01']) {
    const store = new MemoryStore(); const imported = await seedDemo(store, owner, month);
    assert.equal(imported.coverage.importedRows, 10); assert.equal(imported.totalsMinor, '1230000');
    assert.equal(store.state.imports[0]?.sourceId, 'demo-export');
    assert.equal(store.state.facts.find(fact => fact.entityId === 'inv-1')?.validFrom, month ? '2027-01-03' : '2026-09-03');
    assert.equal(store.state.facts.find(fact => fact.entityId === 'inv-1')?.fields.dueDate, month ? '2027-01-10' : '2026-09-10');
    assert.equal(store.state.facts.find(fact => fact.entityId === 'sale-aug')?.validFrom, month ? '2026-12-20' : '2026-08-20');
  }
});

test('invalid calendar input and unlabelled workspaces cannot write a synthetic import', async () => {
  for (const month of ['', '2026-00', '2026-13', '2026-1', '2026-10-01', '0000-01']) {
    const store = new MemoryStore(), before = store.read();
    await assert.rejects(seedDemo(store, owner, month), { code: 'INVALID_REQUEST' });
    assert.deepEqual(store.state, before);
  }
  const store = new MemoryStore(); store.state.workspace.demo = false; const before = store.read();
  await assert.rejects(seedDemo(store, owner, '2026-10'), { code: 'DEMO_ONLY' });
  assert.deepEqual(store.state, before);
});

test('the fixture-month option requires immutable synthetic launch authority before workspace creation', async () => {
  const engine = new Engine({ demo: false, directory: join(tmpdir(), 'synthetic-fixture-month-never-created') });
  engine.options.demo = true;
  await assert.rejects(engine.request('workspace.create', { name: 'Synthetic month refusal', demo: true, demoFixtureMonth: '2026-10', passphrase: 'synthetic-not-used-passphrase' }), { code: 'DEMO_ONLY' });
  assert.equal(engine.vault, null);
  await engine.shutdown();
});
