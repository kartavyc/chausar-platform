import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { CalculatorService } from '../runtime/calculator.ts';
import { ChausarError, type Context, type Fact, type State, type StateStore } from '../runtime/contracts.ts';
import { ForecastService } from '../runtime/forecast-service.ts';
import type { ForecastRequest } from '../runtime/forecast-contracts.ts';
import { MemoryService } from '../runtime/memory.ts';
import { compileDictionary, OntologyService, starterPacks } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import { Vault } from '../runtime/vault.ts';
import { FixtureStateStore, fixtureOwner } from './database-fixtures.ts';

// Synthetic source receipts establish JavaScript/source contract behavior only.
// No fixture import or experimental file snapshot qualifies a native database,
// live source, deployed forecast method or calibrated prediction interval.
const owner = fixtureOwner;
const sourceId = 'forecast-synthetic-sales';
const base = 900719925474099300n;
const retainedFailure = (error: unknown) => error instanceof ChausarError && (/^(FORECAST_|RECEIPT_)/.test(error.code) || error.code === 'INVALID_FORECAST_EVIDENCE');
const errorCode = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

class CommitHookStore implements StateStore {
  readonly underlying = new FixtureStateStore();
  beforeCommit?: (state: State) => void;
  currentDraft: State | undefined;
  read() { return this.underlying.read(); }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    return this.underlying.update(async state => {
      const hook = this.beforeCommit; this.beforeCommit = undefined;
      hook?.(state); this.currentDraft = state;
      try { return await change(state); } finally { this.currentDraft = undefined; }
    });
  }
}

async function setup(store: StateStore = new FixtureStateStore()) {
  const memory = new MemoryService(store), calculator = new CalculatorService(store);
  const dictionary = compileDictionary(starterPacks.find(pack => pack.pack === 'retail')!, 1, owner.memberId, '2026-01-01T00:00:00.000Z');
  await store.update(state => {
    state.workspace.demo = true;
    state.ontology = { current: dictionary, history: [dictionary] };
  });
  const months = [
    { from: '2026-04-01', to: '2026-04-30', learnedAt: '2026-05-01T00:00:00.000Z', delta: 0n },
    { from: '2026-05-01', to: '2026-05-31', learnedAt: '2026-06-01T00:00:00.000Z', delta: 100n },
    { from: '2026-06-01', to: '2026-06-30', learnedAt: '2026-07-01T00:00:00.000Z', delta: 200n },
    { from: '2026-07-01', to: '2026-07-31', learnedAt: '2026-08-01T00:00:00.000Z', delta: 310n },
    { from: '2026-09-01', to: '2026-09-30', learnedAt: '2026-10-01T00:00:00.000Z', delta: 540n },
  ];
  const facts: Fact[] = [], receiptIds: string[] = [];
  for (const [index, month] of months.entries()) {
    const [fact] = await memory.append(owner, [{
      entityId: `synthetic-sale-${month.from}`, sourceId, sourceRow: index + 1,
      kind: 'sale', validFrom: month.to, branch: 'main',
      fields: { amountMinor: String(base + month.delta), currency: 'INR', status: 'settled' },
    }], { testLearnedAt: month.learnedAt });
    facts.push(fact);
    await store.update(state => {
      // Explicitly synthetic reconciliation supplied for source-contract tests.
      state.imports.push({ id: `synthetic-forecast-import-${index}`, sourceId, rowIds: [fact.id], coverage: { reconciled: true }, state: 'committed', reconciliation: { matched: true }, factIds: [fact.id], qualification: 'source-fixture' });
    });
    const receipt = await calculator.calculate(owner, { operation: 'earned', sourceIds: [sourceId], branch: 'main', period: { from: month.from, to: month.to }, asOf: month.learnedAt });
    assert.equal(receipt.coverage.completeness, 'reconciled-imports');
    receiptIds.push(receipt.id);
  }
  const request: ForecastRequest = {
    version: 1, mode: 'operational-as-known', operation: 'earned', dictionaryHash: dictionary.hash,
    sourceIds: [sourceId], branch: 'main', horizonsMonths: [1, 3], cadenceMonths: 1,
    minimumTrainingMonths: 3, method: 'linear-trend-v1', benchmark: 'last-observed-v1', availabilityLagMs: 0,
    origins: [{ id: 'june-origin', eventCutoff: '2026-06-30', knowledgeCut: '2026-07-01T00:00:00.000Z', trainingReceiptIds: receiptIds.slice(0, 3), targets: [{ horizonMonths: 1, receiptId: receiptIds[3] }, { horizonMonths: 3, receiptId: receiptIds[4] }] }],
  };
  return { store, memory, calculator, dictionary, facts, receiptIds, request, forecasts: new ForecastService(store) };
}

test('forecast service stores exact source backtests in State.answers with independently scored horizons', async () => {
  const value = await setup();
  const saved = await value.forecasts.evaluate(owner, value.request);
  assert.equal(saved.type, 'forecast-evaluation-v1');
  assert.equal(saved.qualification, 'source-evidence-backtest');
  assert.equal(saved.memberId, owner.memberId); assert.equal(saved.epoch, owner.epoch);
  assert.deepEqual(saved.uncertainty, { calibratedIntervals: false, intervalType: 'none' });
  assert.equal(saved.folds.find(fold => fold.horizonMonths === 1)!.candidate.minor, String(base + 300n));
  assert.equal(saved.folds.find(fold => fold.horizonMonths === 1)!.candidate.signedErrorMinor, '-10');
  assert.equal(saved.folds.find(fold => fold.horizonMonths === 3)!.candidate.minor, String(base + 500n));
  assert.equal(saved.folds.find(fold => fold.horizonMonths === 3)!.candidate.signedErrorMinor, '-40');
  assert.deepEqual(saved.horizons.map(horizon => [horizon.horizonMonths, horizon.scoredOrigins, horizon.candidate.sumAbsoluteErrorMinor]), [[1, 1, '10'], [3, 1, '40']]);
  assert.ok(saved.receiptIds.every(id => value.receiptIds.includes(id)));
  assert.equal(saved.evidencePins.length, 5); assert.match(saved.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(value.store.read().answers.find(answer => answer.id === saved.id), saved);
  assert.deepEqual(value.forecasts.get(owner, saved.id), saved);
  saved.folds[0].candidate.minor = 'tampered-return';
  const reopened = value.forecasts.get(owner, saved.id); reopened.request.sourceIds.length = 0;
  assert.equal(value.forecasts.get(owner, saved.id).folds[0].candidate.minor, String(base + 300n));
  assert.deepEqual(value.forecasts.get(owner, saved.id).request.sourceIds, [sourceId]);
});

test('saved forecast survives encrypted experimental-file close and reopen', { timeout: 15000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-forecast-source-test-'));
  // Native PowerShell/Python cleanup is not used; verify this exact test-created
  // child stays under the temporary root before recursive removal.
  assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
  let activeVault: Vault | undefined;
  t.after(async () => {
    try { await activeVault?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const passphrase = 'synthetic forecast fixture passphrase only';
  const options = { directory, storage: 'experimental-file' as const, passphrase };
  const { vault } = await Vault.create({ ...options, name: 'Synthetic forecast evidence fixture' });
  activeVault = vault;
  const value = await setup(vault), saved = await value.forecasts.evaluate(owner, value.request);
  const raw = await readFile(join(directory, 'authority.encrypted.json'), 'utf8');
  for (const plaintext of [sourceId, saved.id, saved.requestDigest, saved.folds[0].candidate.minor, passphrase]) assert.ok(!raw.includes(plaintext));
  await vault.close();
  activeVault = undefined;
  const reopened = await Vault.open(options); activeVault = reopened;
  assert.deepEqual(new ForecastService(reopened).get(owner, saved.id), saved);
  assert.ok(reopened.read().answers.some(answer => answer.id === saved.id));
});

test('later correction and dictionary publication preserve retained historical forecast digests', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.memory.correct(owner, value.facts[0].id, { amountMinor: '17' }, { testLearnedAt: '2026-10-01T00:00:01.000Z' });
  await new OntologyService(value.store).publish(owner, 'services');
  const reopened = value.forecasts.get(owner, saved.id);
  assert.equal(reopened.stale, true);
  assert.equal(reopened.digest, saved.digest); assert.equal(reopened.evidenceDigest, saved.evidenceDigest);
  assert.deepEqual(reopened.folds, saved.folds); assert.equal(reopened.dictionaryHash, value.dictionary.hash);
  const reevaluated = await value.forecasts.evaluate(owner, value.request);
  assert.equal(reevaluated.evidenceDigest, saved.evidenceDigest); assert.deepEqual(reevaluated.folds, saved.folds);
  assert.ok(reevaluated.coverage.staleHistoricalReceiptIds.length > 0);
});

test('service labels a restated diagnostic evaluation explicitly', async () => {
  const value = await setup(); value.request.mode = 'restated-diagnostic';
  const saved = await value.forecasts.evaluate(owner, value.request);
  assert.equal(saved.mode, 'restated-diagnostic'); assert.match(saved.interpretation, /restated|diagnostic/i);
  assert.ok(saved.origins.every(origin => origin.interpretation === 'restated-diagnostic'));
});

const accessChanges: { name: string; mutate: (state: State) => void; code: string }[] = [
  { name: 'policy source grant', mutate: state => { state.policy.allowedSources = ['different-source']; }, code: 'SOURCE_REVOKED' },
  { name: 'source access rule', mutate: state => { state.sourceRules.push({ sourceId, allow: false }); }, code: 'SOURCE_REVOKED' },
  { name: 'source tombstone', mutate: state => { state.tombstones.push({ kind: 'source', sourceId }); }, code: 'SOURCE_REVOKED' },
  { name: 'branch grant', mutate: state => { state.members[0].branches = ['different-branch']; }, code: 'FORBIDDEN_BRANCH' },
  { name: 'member activation', mutate: state => { state.members[0].active = false; }, code: 'ACCESS_REVOKED' },
  { name: 'permission epoch', mutate: state => { state.members[0].epoch++; }, code: 'ACCESS_REVOKED' },
];
for (const scenario of accessChanges) test(`forecast evaluate and get fail closed after current ${scenario.name} changes`, async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(scenario.mutate);
  assert.throws(() => value.forecasts.get(owner, saved.id), errorCode(scenario.code));
  await assert.rejects(value.forecasts.evaluate(owner, value.request), errorCode(scenario.code));
});

test('another currently authorized member cannot reopen private owner forecast evidence', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  const other: Context = { memberId: 'forecast-other', role: 'viewer', epoch: 1 };
  await value.store.update(state => { state.members.push({ id: other.memberId, role: other.role, epoch: other.epoch, name: 'Synthetic viewer', active: true, branches: ['*'] }); });
  assert.throws(() => value.forecasts.get(other, saved.id), retainedFailure);
});

const missingEvidence: { name: string; mutate: (state: State, value: Awaited<ReturnType<typeof setup>>) => void }[] = [
  { name: 'retained training receipt', mutate: (state, value) => { state.receipts = state.receipts.filter(receipt => receipt.id !== value.receiptIds[0]); } },
  { name: 'retained target receipt', mutate: (state, value) => { state.receipts = state.receipts.filter(receipt => receipt.id !== value.receiptIds[3]); } },
  { name: 'referenced reconciliation import', mutate: (state, value) => {
    const importId = state.receipts.find(receipt => receipt.id === value.receiptIds[0]).coverage.importIds[0];
    state.imports = state.imports.filter(record => record.id !== importId);
  } },
  { name: 'dictionary history', mutate: state => { state.ontology = null; } },
  { name: 'calculation request provenance', mutate: (state, value) => { state.answers = state.answers.filter(answer => answer.receiptId !== value.receiptIds[0]); } },
  { name: 'retained fact', mutate: (state, value) => { state.facts = state.facts.filter(fact => fact.id !== value.facts[0].id); } },
];
for (const scenario of missingEvidence) test(`forecast evaluate and get reject unavailable ${scenario.name}`, async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(state => scenario.mutate(state, value));
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
  await assert.rejects(value.forecasts.evaluate(owner, value.request), retainedFailure);
});

for (const deleted of ['deletedAt', 'tombstone'] as const) test(`saved forecast rejects current fact ${deleted} despite retained receipt rows`, async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(state => {
    if (deleted === 'deletedAt') state.facts.find(fact => fact.id === value.facts[0].id)!.deletedAt = '2026-10-01T00:00:02.000Z';
    else state.tombstones.push({ kind: 'fact', factId: value.facts[0].id, deletedAt: '2026-10-01T00:00:02.000Z' });
  });
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
  await assert.rejects(value.forecasts.evaluate(owner, value.request), retainedFailure);
});

test('retained evidence mutation cannot silently rewrite a saved forecast', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(state => { state.facts.find(fact => fact.id === value.facts[0].id)!.fields.amountMinor = '19'; });
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
  assert.equal(value.store.read().answers.find(answer => answer.id === saved.id).digest, saved.digest);
});

test('forecast evaluate and get reject a referenced import whose reconciliation was revoked', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(state => {
    const importId = state.receipts.find(receipt => receipt.id === value.receiptIds[0]).coverage.importIds[0];
    state.imports.find(record => record.id === importId).coverage.reconciled = false;
  });
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
  await assert.rejects(value.forecasts.evaluate(owner, value.request), retainedFailure);
});

test('saved forecast pins its retained source import content digest', async () => {
  const value = await setup();
  await value.store.update(state => {
    state.imports.find(record => record.rowIds.includes(value.facts[0].id)).contentHash = 'synthetic-original-source-report';
  });
  const saved = await value.forecasts.evaluate(owner, value.request);
  await value.store.update(state => {
    state.imports.find(record => record.rowIds.includes(value.facts[0].id)).contentHash = 'synthetic-changed-source-report';
  });
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
  assert.equal(value.store.read().answers.find(answer => answer.id === saved.id).evidenceDigest, saved.evidenceDigest);
});

test('source deletion cascades through persisted forecast lineage in State.answers', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  const deletion = await new TrustService(value.store).deleteSource(owner, sourceId);
  assert.ok(deletion.removed >= value.facts.length);
  assert.ok(!value.store.read().answers.some(answer => answer.id === saved.id));
  assert.throws(() => value.forecasts.get(owner, saved.id), retainedFailure);
});

for (const scenario of accessChanges) test(`forecast commit rejects atomic draft ${scenario.name} revocation`, async () => {
  const store = new CommitHookStore(), value = await setup(store);
  const before = store.read().answers.length; store.beforeCommit = scenario.mutate;
  await assert.rejects(value.forecasts.evaluate(owner, value.request), errorCode(scenario.code));
  assert.equal(store.read().answers.length, before);
});

test('forecast commit invokes the host receipt guard and rolls back on its draft rejection', async () => {
  const store = new CommitHookStore(), value = await setup(store);
  let readChecks = 0, draftChecks = 0;
  const guarded = new ForecastService(store, { receiptGuard(ctx, receipt) {
    assert.equal(ctx.memberId, owner.memberId); assert.ok(value.receiptIds.includes(receipt.id));
    if (store.currentDraft) {
      draftChecks++;
      throw new ChausarError('FORECAST_FIXTURE_HOST_REVOKED', 'Synthetic host guard rejects this atomic commit.');
    }
    readChecks++;
  } });
  const before = store.read().answers.length;
  await assert.rejects(guarded.evaluate(owner, value.request), errorCode('FORECAST_FIXTURE_HOST_REVOKED'));
  assert.equal(readChecks, 0); assert.ok(draftChecks >= 1);
  assert.equal(store.read().answers.length, before);
});

test('forecast reopening invokes the configured host receipt guard for retained receipts', async () => {
  const value = await setup(), saved = await value.forecasts.evaluate(owner, value.request);
  const checks: string[] = [];
  const guarded = new ForecastService(value.store, { receiptGuard(_ctx, receipt) { checks.push(receipt.id); } });
  guarded.get(owner, saved.id);
  assert.deepEqual([...new Set(checks)].sort(), [...value.receiptIds].sort());
  const rejecting = new ForecastService(value.store, { receiptGuard() { throw new ChausarError('FORECAST_FIXTURE_HOST_REVOKED', 'Synthetic host receipt guard.'); } });
  assert.throws(() => rejecting.get(owner, saved.id), errorCode('FORECAST_FIXTURE_HOST_REVOKED'));
});

test('queued forecast commit detaches caller request before update starts', async () => {
  const store = new CommitHookStore(), value = await setup(store);
  const original = structuredClone(value.request);
  store.beforeCommit = () => {
    value.request.origins[0].id = 'caller-mutated-origin';
    value.request.origins[0].trainingReceiptIds.length = 0;
    value.request.sourceIds[0] = 'caller-mutated-source';
  };
  const saved = await value.forecasts.evaluate(owner, value.request);
  assert.deepEqual(saved.request, original);
  assert.equal(saved.origins[0].id, 'june-origin');
  assert.deepEqual(value.forecasts.get(owner, saved.id).request, original);
});
