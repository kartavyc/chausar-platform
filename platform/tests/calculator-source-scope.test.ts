import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CalculatorService, type CalculationRequest, type CalculatorOptions } from '../runtime/calculator.ts';
import { type Context, type StateStore } from '../runtime/contracts.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { Vault } from '../runtime/vault.ts';
import { FixtureStateStore } from './database-fixtures.ts';

// Labelled synthetic source-scope regressions; these do not qualify any connector/provider/database.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const period = { from: '2026-09-01', to: '2026-09-30' };
const request = (extra: Partial<CalculationRequest> = {}): CalculationRequest => ({ operation: 'billed', period, asOf: '2100-01-01T00:00:00Z', ...extra });
function fact(sourceId: string, entityId: string, amountMinor: string, changes: Partial<FactInput> = {}): FactInput {
  return { sourceId, entityId, sourceRow: 2, kind: 'invoice', validFrom: '2026-09-10', branch: 'main', fields: { amountMinor, currency: 'INR', status: 'settled' }, ...changes };
}
async function setup(options: CalculatorOptions = {}, store: StateStore = new FixtureStateStore()) {
  await new OntologyService(store).publish(owner, 'retail');
  return { store, memory: new MemoryService(store), calculator: new CalculatorService(store, options) };
}
function assertOnlySource(receipt: Awaited<ReturnType<CalculatorService['calculate']>>, store: StateStore, sourceId: string) {
  assert.deepEqual(receipt.requestedSourceIds, [sourceId]);
  assert.ok(receipt.rows.every(row => row.sourceId === sourceId));
  const allowedRows = new Set(store.read().facts.filter(row => row.sourceId === sourceId).map(row => row.id));
  assert.ok(receipt.exclusions.every(row => allowedRows.has(row.rowId)));
}

test('reviewed A scope produces 10000 while the legacy full-source calculation produces 30000', async () => {
  const value = await setup();
  await value.memory.append(owner, [fact('A', 'invoice-a', '10000'), fact('B', 'invoice-b', '20000')]);
  const scoped = await value.calculator.calculate(owner, request({ sourceIds: ['A'] }));
  const full = await value.calculator.calculate(owner, request());
  assert.equal(scoped.totalMinor, '10000'); assert.equal(full.totalMinor, '30000');
  assertOnlySource(scoped, value.store, 'A');
  assert.equal(scoped.coverage.selectedRows, 1); assert.equal(scoped.coverage.countedRows, 1);
  assert.equal(Object.hasOwn(full, 'requestedSourceIds'), false, 'Legacy unscoped receipt shape is retained.');
  assert.deepEqual(value.calculator.receipt(owner, scoped.id), scoped);
});

test('an unselected conflicting source cannot erase A or disclose its conflicting row in exclusions', async () => {
  const value = await setup();
  await value.memory.append(owner, [fact('A', 'same-invoice', '10000'), fact('B', 'same-invoice', '20000')]);
  const full = await value.calculator.calculate(owner, request());
  assert.equal(full.totalMinor, '0'); assert.equal(full.coverage.unresolvedConflicts, 1);
  const scoped = await value.calculator.calculate(owner, request({ sourceIds: ['A'] }));
  assert.equal(scoped.totalMinor, '10000'); assert.equal(scoped.coverage.unresolvedConflicts, 0);
  assert.deepEqual(scoped.exclusions, []); assertOnlySource(scoped, value.store, 'A');
});

test('source precedence and source corrections resolve only among reviewed sources', async () => {
  const value = await setup();
  const initial = await value.memory.append(owner, [fact('A', 'same-invoice', '10000'), fact('B', 'same-invoice', '20000')], { testLearnedAt: '2026-09-11T00:00:00Z' });
  await value.memory.correct(owner, initial[0].id, { amountMinor: '15000' }, { testLearnedAt: '2026-09-12T00:00:00Z' });
  await value.memory.setSourcePrecedence(owner, 'invoice', ['B', 'A']);
  const scoped = await value.calculator.calculate(owner, request({ sourceIds: ['A'] }));
  assert.equal(scoped.totalMinor, '15000'); assertOnlySource(scoped, value.store, 'A');
  assert.deepEqual(scoped.exclusions, [{ rowId: initial[0].id, reason: 'Superseded source version.' }]);
  const both = await value.calculator.calculate(owner, request({ sourceIds: ['A', 'B'] }));
  assert.equal(both.totalMinor, '20000'); assert.deepEqual(both.requestedSourceIds, ['A', 'B']);
  assert.equal(both.coverage.unresolvedConflicts, 0);
});

test('current and comparison period totals exclude conflicting outside-source evidence', async () => {
  const value = await setup();
  await value.memory.append(owner, [
    fact('A', 'current', '10000', { kind: 'sale' }), fact('B', 'current', '500000', { kind: 'sale' }),
    fact('A', 'prior', '4000', { kind: 'sale', validFrom: '2026-08-10' }), fact('B', 'prior', '900000', { kind: 'sale', validFrom: '2026-08-10' }),
  ]);
  const scoped = await value.calculator.calculate(owner, request({ sourceIds: ['A'], operation: 'change', comparePeriod: { from: '2026-08-01', to: '2026-08-31' } }));
  assert.equal(scoped.totalMinor, '6000');
  assert.deepEqual(Object.fromEntries(scoped.figures.map(figure => [figure.key, figure.minor])), { current: '10000', previous: '4000', change: '6000', changeBps: '15000' });
  assert.equal(scoped.coverage.countedRows, 2); assert.equal(scoped.coverage.unresolvedConflicts, 0);
  assertOnlySource(scoped, value.store, 'A');
});

test('aging cannot pay a reviewed invoice with an unselected source payment', async () => {
  const value = await setup();
  await value.memory.append(owner, [
    fact('A', 'invoice', '10000', { fields: { amountMinor: '10000', currency: 'INR', status: 'settled', invoiceId: 'I', customerId: 'C', dueDate: '2026-09-15' } }),
    fact('A', 'payment-a', '3000', { kind: 'payment', fields: { amountMinor: '3000', currency: 'INR', status: 'settled', invoiceId: 'I', customerId: 'C' } }),
    fact('B', 'payment-b', '7000', { kind: 'payment', fields: { amountMinor: '7000', currency: 'INR', status: 'settled', invoiceId: 'I', customerId: 'C' } }),
  ]);
  const scoped = await value.calculator.calculate(owner, request({ sourceIds: ['A'], operation: 'aging', onDate: '2026-09-30' }));
  assert.equal(scoped.totalMinor, '7000'); assert.equal(scoped.figures.find(figure => figure.key === 'unallocated')!.minor, '0');
  assertOnlySource(scoped, value.store, 'A');
  const full = await value.calculator.calculate(owner, request({ operation: 'aging', onDate: '2026-09-30' }));
  assert.equal(full.totalMinor, '0');
});

test('scenario and margin arithmetic retain only the reviewed source measures', async () => {
  const value = await setup();
  await value.memory.append(owner, [fact('A', 'sale-a', '10000', { kind: 'sale' }), fact('A', 'cost-a', '2000', { kind: 'cost' }), fact('B', 'sale-b', '900000', { kind: 'sale' }), fact('B', 'cost-b', '800000', { kind: 'cost' })]);
  const scenario = await value.calculator.calculate(owner, request({ sourceIds: ['A'], operation: 'scenario', assumptions: { priceChangeBps: '1000' } }));
  assert.equal(scenario.totalMinor, '11000'); assertOnlySource(scenario, value.store, 'A');
  const margin = await value.calculator.calculate(owner, request({ sourceIds: ['A'], operation: 'margin' }));
  assert.equal(margin.totalMinor, '8000'); assertOnlySource(margin, value.store, 'A');
});

test('explicit empty source scope has empty coverage and no outside row, exclusion or import lineage', async () => {
  const value = await setup();
  const rows = await value.memory.append(owner, [fact('A', 'conflict', '10000'), fact('B', 'conflict', '20000')]);
  await value.store.update(state => { state.imports.push({ id: 'outside-import', rowIds: rows.map(row => row.id), coverage: { reconciled: true } }); });
  const empty = await value.calculator.calculate(owner, request({ sourceIds: [] }));
  assert.equal(empty.totalMinor, '0'); assert.deepEqual(empty.requestedSourceIds, []);
  assert.deepEqual(empty.rows, []); assert.deepEqual(empty.rowIds, []); assert.deepEqual(empty.sourceIds, []); assert.deepEqual(empty.exclusions, []);
  assert.deepEqual(empty.coverage.importIds, []); assert.equal(empty.coverage.completeness, 'empty');
  assert.equal(empty.coverage.selectedRows, 0); assert.equal(empty.coverage.excludedRows, 0); assert.equal(empty.coverage.unresolvedConflicts, 0);
  assert.match(empty.explanation, /empty selection is not proof/);
});

test('source scope refuses malformed, duplicate and oversized identifiers before verification', async () => {
  let verifierCalls = 0; const value = await setup({ verifier: async () => { verifierCalls++; return { syntheticFixture: true }; } });
  const invalid: unknown[] = [null, {}, 'A', ['A', 'A'], [''], [' A'], ['A/B'], [42], Array(1), ['A'.repeat(201)], Array.from({ length: 65 }, (_, index) => `source-${index}`)];
  for (const sourceIds of invalid) await assert.rejects(value.calculator.calculate(owner, request({ sourceIds: sourceIds as string[] })), { code: 'INVALID_SOURCE_SCOPE' });
  assert.equal(verifierCalls, 0); assert.equal(value.store.read().receipts.length, 0);
  const accepted = await value.calculator.calculate(owner, request({ sourceIds: Array.from({ length: 64 }, (_, index) => `source-${index}`) }));
  assert.equal(accepted.requestedSourceIds!.length, 64); assert.equal(accepted.coverage.completeness, 'empty');
});

test('an explicitly selected denied source refuses even with no matching facts', async () => {
  let verifierCalls = 0; const value = await setup({ verifier: async () => { verifierCalls++; return { syntheticFixture: true }; } });
  await value.store.update(state => { state.policy.allowedSources = ['A']; });
  await assert.rejects(value.calculator.calculate(owner, request({ sourceIds: ['denied-empty'] })), { code: 'SOURCE_REVOKED' });
  assert.equal(verifierCalls, 0); assert.equal(value.store.read().receipts.length, 0);
});

test('revoking a selected source during async verification prevents saving even for empty coverage', async () => {
  let finish!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const value = await setup({ verifier: async () => { entered(); await waiting; return { syntheticFixture: true }; } });
  const pending = value.calculator.calculate(owner, request({ sourceIds: ['empty-A'] })); await started;
  await value.store.update(state => { state.sourceRules.push({ sourceId: 'empty-A', revoked: true }); });
  finish(); await assert.rejects(pending, { code: 'SOURCE_REVOKED' });
  assert.equal(value.store.read().receipts.length, 0); assert.equal(value.store.read().answers.length, 0);
});

test('scope checks use the atomic commit state, including zero-row source revocation', async () => {
  const underlying = new FixtureStateStore(); let revokeOnNextUpdate = false;
  const store: StateStore = { read: underlying.read.bind(underlying), update: change => underlying.update(state => {
    if (revokeOnNextUpdate) { state.sourceRules.push({ sourceId: 'empty-A', revoked: true }); revokeOnNextUpdate = false; }
    return change(state);
  }) };
  const value = await setup({}, store); revokeOnNextUpdate = true;
  await assert.rejects(value.calculator.calculate(owner, request({ sourceIds: ['empty-A'] })), { code: 'SOURCE_REVOKED' });
  assert.equal(store.read().receipts.length, 0); assert.equal(store.read().answers.length, 0);
});

test('caller mutation during verification cannot change the retained reviewed scope', async () => {
  let finish!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; }), started = new Promise<void>(resolve => { entered = resolve; });
  const value = await setup({ verifier: async () => { entered(); await waiting; return { syntheticFixture: true }; } });
  await value.memory.append(owner, [fact('A', 'a', '10000'), fact('B', 'b', '20000')]);
  const input = request({ sourceIds: ['A'] }); const pending = value.calculator.calculate(owner, input); await started;
  input.sourceIds![0] = 'B'; input.operation = 'received'; finish();
  const result = await pending; assert.equal(result.totalMinor, '10000'); assertOnlySource(result, value.store, 'A');
  assert.deepEqual(value.store.read().answers[0].request.sourceIds, ['A']); assert.equal(result.operation, 'billed');
});

test('saved scope rechecks a requested source with empty rows', async () => {
  const value = await setup();
  const saved = await value.calculator.calculate(owner, request({ sourceIds: ['empty-A'] }));
  assert.deepEqual(value.calculator.receipt(owner, saved.id), saved);
  await value.store.update(state => { state.sourceRules.push({ sourceId: 'empty-A', revoked: true }); });
  assert.throws(() => value.calculator.receipt(owner, saved.id), { code: 'SOURCE_REVOKED' });
});

test('scoped exact BigInt receipt and lineage survive an encrypted fixture close/reopen and still check current access', async () => {
  const prefix = join(tmpdir(), 'chausar-source-scope-'); const directory = await mkdtemp(prefix);
  let vault: Vault | undefined;
  try {
    const created = await Vault.create({ directory, storage: 'experimental-file', passphrase: 'Synthetic scope fixture only', name: 'Synthetic scope reopen', demo: true }); vault = created.vault;
    const value = await setup({}, vault);
    await value.memory.append(owner, [fact('A', 'huge', '900719925474099391'), fact('A', 'small', '9'), fact('B', 'outside', '999')]);
    const saved = await value.calculator.calculate(owner, request({ sourceIds: ['A'] }));
    assert.equal(saved.totalMinor, '900719925474099400'); assertOnlySource(saved, vault, 'A');
    assert.deepEqual(value.calculator.receipt(owner, saved.id), saved); await vault.close(); vault = undefined;
    vault = await Vault.open({ directory, storage: 'experimental-file', passphrase: 'Synthetic scope fixture only' });
    const reopened = new CalculatorService(vault); assert.deepEqual(reopened.receipt(owner, saved.id), saved);
    await vault.update(state => { state.policy.allowedSources = ['B']; });
    assert.throws(() => reopened.receipt(owner, saved.id), { code: 'SOURCE_REVOKED' });
  } finally {
    await vault?.close();
    assert.ok(resolve(directory).startsWith(resolve(prefix)), 'Only the owned temporary fixture can be removed.');
    await rm(directory, { recursive: true, force: true });
  }
});
