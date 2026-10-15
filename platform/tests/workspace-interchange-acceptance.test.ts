import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { CalculatorService, type CalculationRequest } from '../runtime/calculator.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import {
  captureWorkspaceInterchange, compareRecalculatedReceipt, encodeWorkspaceInterchange,
  interchangeDigest, readHistoricalWorkspaceState,
} from '../runtime/workspace-interchange.ts';
import { artifactsFor, deterministicShopState, emptyTarget, fixedTime, interchangeOwner, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';

// SOURCE FIXTURE ONLY: no Engine, Vault, native database, GUI, external models or real files.
test('empty-target inert import preserves historical evidence and three hand-worked bench answers/receipts', async t => {
  const source = deterministicShopState();
  const previous = { ...structuredClone(source.facts[0]), id: 'fact_historical_invoice', learnedAt: '2026-09-20T00:00:00.000Z',
    fields: { ...source.facts[0].fields, amountMinor: '90000' }, supersededAt: fixedTime };
  source.facts.unshift(previous);
  source.actions.push({ id: 'historical_action', status: 'approved', approval: { token: 'synthetic-never-executable' } });
  source.jobs.push({ id: 'historical_job', status: 'running', lease: 'synthetic-historical-lease' });
  source.sessions.push({ id: 'historical_session', memberId: 'owner', tokenHash: 'synthetic-token-hash' });
  source.plugins.push({ id: 'historical_plugin', capabilities: ['historical-only'], wasm: 'synthetic-inert' });
  source.routes.push({ id: 'historical_route', provider: 'synthetic-no-dispatch' });
  source.tombstones.push({ id: 'historical_tombstone', factId: 'removed_fixture', deletedAt: '2026-09-25T00:00:00.000Z' });
  source.conversations.push({ id: 'historical_conversation', text: 'पुराना प्रमाण =1+1', receiptIds: [] });
  const sourceStore = new InterchangeFixtureStore(source);
  const calculator = new CalculatorService(sourceStore);
  // Independent minor-unit answer key: invoices 100000+200000; payments 60000+200000; deliveries 100000+150000.
  const bench: [CalculationRequest, string][] = [];
  const expected = ['300000', '260000', '250000'];
  const operations = ['billed', 'received', 'earned'];
  for (let index = 0; index < operations.length; index++) bench.push([{ operation: operations[index], sourceIds: ['demo-export'],
    period: { from: '2026-09-01', to: '2026-09-30' }, asOf: fixedTime }, expected[index]]);
  const originals = [];
  for (const [request, answer] of bench) {
    const receipt = await calculator.calculate(interchangeOwner, request); assert.equal(receipt.totalMinor, answer);
    assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    originals.push(receipt);
  }
  const saved = sourceStore.read(); const sourceWrites = sourceStore.writes;
  const started = performance.now();
  const capture = captureWorkspaceInterchange(saved, artifactsFor(saved));
  const wire = encodeWorkspaceInterchange(capture.package);
  const target = emptyTarget(); const targetBefore = structuredClone(target);
  let accessChecks = 0;
  const candidates = new WorkspaceImportCandidateService({
    source: () => ({ ready: true, inventory: capture.inventory }), target: () => target,
    assertCompleteRead: () => { accessChecks++; },
  });
  const candidate = candidates.prepare(interchangeOwner, { text: wire, targetId: target.targetId });
  const reviewed = candidates.review(interchangeOwner, { id: candidate.id, reviewedDigest: interchangeDigest(candidate) });
  assert.equal(reviewed.inert, true); assert.equal(reviewed.activation, 'root-only'); assert.equal(accessChecks, 2);
  assert.equal(sourceStore.writes, sourceWrites); assert.deepEqual(sourceStore.read(), saved); assert.deepEqual(target, targetBefore);
  const imported = readHistoricalWorkspaceState(reviewed.archive);
  assert.deepEqual(imported, JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(imported.receipts.map(receipt => ({ id: receipt.id, createdAt: receipt.createdAt })),
    originals.map(receipt => ({ id: receipt.id, createdAt: receipt.createdAt })));
  assert.deepEqual(imported.facts, saved.facts); assert.deepEqual(imported.tombstones, saved.tombstones);
  for (const store of ['actions', 'jobs', 'sessions', 'plugins', 'routes', 'conversations'] as const) assert.deepEqual(imported[store], saved[store]);
  // Detached isolated source-only sandbox; root activation is a separate integration gate.
  const importedStore = new InterchangeFixtureStore(imported);
  const importedCalculator = new CalculatorService(importedStore);
  assert.deepEqual(new OntologyService(importedStore).current(interchangeOwner), new OntologyService(sourceStore).current(interchangeOwner));
  for (let index = 0; index < bench.length; index++) {
    const retained = importedCalculator.receipt(interchangeOwner, originals[index].id);
    assert.deepEqual(retained, JSON.parse(JSON.stringify(originals[index])));
    const recalculated = await importedCalculator.calculate(interchangeOwner, bench[index][0]);
    assert.equal(recalculated.totalMinor, bench[index][1]); assert.notEqual(recalculated.id, originals[index].id);
    const comparison = compareRecalculatedReceipt(originals[index], recalculated);
    assert.equal(comparison.equivalent, true, JSON.stringify(comparison));
    assert.deepEqual(comparison.ignoredFields, ['id', 'createdAt', 'provenance']);
  }
  const costs = { sourceOnly: true, qualifiedNative: false, packageBytes: Buffer.byteLength(wire),
    retainedArtifactBytes: capture.inventory.artifacts.reduce((total, artifact) => total + artifact.bytes, 0),
    candidateBytes: Buffer.byteLength(JSON.stringify(candidate)), measuredMs: Math.ceil(performance.now() - started),
    historicalStores: capture.inventory.stores.length, benchAnswers: 3 };
  t.diagnostic(JSON.stringify(costs));
});

test('receipt equivalence requires exact semantics beyond only id and creation timestamp', async () => {
  const store = new InterchangeFixtureStore(deterministicShopState());
  const receipt = await new CalculatorService(store).calculate(interchangeOwner, { operation: 'earned', asOf: fixedTime,
    period: { from: '2026-09-01', to: '2026-09-30' } });
  const equivalent = { ...receipt, id: 'new_fixture_receipt', createdAt: '2026-10-02T00:00:00.000Z' };
  assert.equal(compareRecalculatedReceipt(receipt, equivalent).equivalent, true);
  for (const field of Object.keys(receipt).filter(field => !['id', 'createdAt'].includes(field))) {
    const altered: any = structuredClone(equivalent); delete altered[field];
    const result = compareRecalculatedReceipt(receipt, altered);
    assert.equal(result.equivalent, false, field); assert.ok(result.changedFields.includes(field), field);
  }
  const changedAsOf = { ...equivalent, asOf: '2026-10-02T00:00:00.000Z' };
  assert.deepEqual(compareRecalculatedReceipt(receipt, changedAsOf).changedFields, ['asOf']);
  const changedCoverage = structuredClone(equivalent); changedCoverage.coverage.completeness = 'partial';
  assert.deepEqual(compareRecalculatedReceipt(receipt, changedCoverage).changedFields, ['coverage']);
});
