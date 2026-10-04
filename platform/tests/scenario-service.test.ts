import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, authorize, check, hash, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import type { CalculationRequest } from '../runtime/calculator.ts';
import { defaultRecipe, ImportService } from '../runtime/ingest.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import { MemoryService } from '../runtime/memory.ts';
import type { ScenarioCreateRequest, ScenarioHost, ScenarioRecord, ScenarioRunResult, ScenarioView } from '../runtime/scenario-contracts.ts';
import { ScenarioService } from '../runtime/scenario-service.ts';

// Synthetic JavaScript contract fixtures only: no native/database/browser,
// persistence qualification, provider, execution, credentials or new model.
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const sourceId = 'scenario-synthetic-sales';
const period = { from: '2026-09-01', to: '2026-09-30' };
const refusal = (error: unknown) => error instanceof ChausarError && /^SCENARIO_/.test(error.code);
const validationRefusal = (error: unknown) => error instanceof ChausarError && /^(SCENARIO_|INVALID_|UNKNOWN_CALCULATION)/.test(error.code);
const baselineRequest = (extra: Partial<CalculationRequest> = {}): CalculationRequest => ({
  operation: 'scenario', sourceIds: [sourceId], branch: 'main', period,
  assumptions: { priceChangeBps: '00' }, ...extra,
});
const createRequest = (request = baselineRequest()): ScenarioCreateRequest => ({
  version: 1, label: 'Synthetic retained price comparison', baseline: { label: 'Measured baseline', request },
  alternatives: [{ label: 'Same label', priceChangeBps: '1000' }, { label: 'Same label', priceChangeBps: '2000' }],
});
const measuredRequest = (): CalculationRequest => ({ operation: 'earned', sourceIds: [sourceId], branch: 'main', period });

class SyntheticStore implements StateStore {
  state = initialState('Synthetic scenario revision contracts', true);
  writes = 0;
  constructor() {
    const dictionary = compileDictionary(starterPacks.find(pack => pack.pack === 'retail')!, 1, owner.memberId, '2026-01-01T00:00:00.000Z');
    this.state.ontology = { current: dictionary, history: [dictionary] };
  }
  read() { return structuredClone(this.state); }
  mutate(change: (state: State) => void) { change(this.state); this.state.revision++; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> {
    const draft = this.read(), result = await change(draft);
    draft.revision++; this.state = draft; this.writes++; return result;
  }
}

class SyntheticScenarioHost implements ScenarioHost {
  readonly records = new Map<string, ScenarioRecord>();
  readonly authentic = new Set<string>();
  readonly guardCalls: { phase: 'calculate' | 'reopen'; type: 'request' | 'receipt'; dictionaryHash: string }[] = [];
  time = '2100-01-01T00:00:00.000Z';
  rejectNextRetention = false;
  nextConsumerGuard?: () => void;
  nextRetention?: () => void;
  blockedReceiptId?: string;
  ready = true;
  now() { return this.time; }
  resolveScenario(ctx: Context, id: string) {
    const record = this.records.get(id);
    check(record, 'SCENARIO_NOT_FOUND', 'Synthetic retained scenario is unavailable.');
    check(record.memberId === ctx.memberId && record.epoch === ctx.epoch, 'SCENARIO_FORBIDDEN', 'Synthetic private artifact belongs to another member or epoch.');
    return structuredClone(record);
  }
  assertArtifactAuthentic(_ctx: Context, digest: string) {
    check(this.authentic.has(digest), 'SCENARIO_UNAUTHENTIC', 'Synthetic artifact was not retained by this host.');
  }
  retainScenario(ctx: Context, expectedDigest: string | null, record: ScenarioRecord) {
    check(record.memberId === ctx.memberId && record.epoch === ctx.epoch, 'SCENARIO_FORBIDDEN', 'Synthetic custody identity mismatch.');
    const prior = this.records.get(record.id);
    check(expectedDigest === null ? !prior : prior?.digest === expectedDigest, 'SCENARIO_CAS_CONFLICT', 'Synthetic atomic digest comparison failed.');
    if (this.rejectNextRetention) {
      this.rejectNextRetention = false;
      throw new ChausarError('SCENARIO_CAS_CONFLICT', 'Synthetic competing retention won the atomic comparison.');
    }
    this.records.set(record.id, structuredClone(record));
    for (const artifact of [record, ...record.evidence, ...record.revisions, ...record.runs, ...record.results, ...record.comparisons]) this.authentic.add(artifact.digest);
    for (const result of record.results) this.authentic.add(result.receiptDigest);
    const callback = this.nextRetention; this.nextRetention = undefined; callback?.();
  }
  calculatorGuards(view: StateStore, phase: 'calculate' | 'reopen') {
    const record = (ctx: Context, type: 'request' | 'receipt') => {
      authorize(view, ctx);
      check(this.ready, 'SCENARIO_NOT_READY', 'Synthetic publication/readiness guard refused.');
      const dictionary = view.read().ontology?.current ?? view.read().ontology;
      check(dictionary?.hash, 'SCENARIO_NOT_READY', 'Synthetic published dictionary is required.');
      this.guardCalls.push({ phase, type, dictionaryHash: dictionary.hash });
    };
    return {
      consumerGuard: (ctx: Context) => { record(ctx, 'request'); const callback = this.nextConsumerGuard; this.nextConsumerGuard = undefined; callback?.(); },
      receiptGuard: (ctx: Context, receipt: ScenarioRunResult['receipt']) => {
        record(ctx, 'receipt');
        check(receipt.id !== this.blockedReceiptId, 'SCENARIO_NOT_READY', 'Synthetic exact retained receipt is unavailable.');
      },
    };
  }
}

const csvHeader = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch\n';
async function importSales(store: SyntheticStore, firstAmount = '100.01', id = sourceId) {
  const input = {
    sourceId: id, format: 'csv' as const, recipe: defaultRecipe(),
    content: csvHeader + `first,sale,2026-09-10,${firstAmount},INR,C,I1,O1,,delivered,Synthetic first sale,main\nsmall,sale,2026-09-11,0.09,INR,C,I2,O2,,delivered,Synthetic nine minor units,main\n`,
    expectedTotals: { rowCount: 2, amountMinor: firstAmount === '200.01' ? '20010' : '10010' },
  };
  const imports = new ImportService(store), preview = imports.preview(owner, input);
  assert.equal(preview.accepted, true);
  return imports.commit(owner, input);
}
async function setup(withImport = true) {
  const store = new SyntheticStore(), host = new SyntheticScenarioHost();
  const imported = withImport ? await importSales(store) : undefined;
  const service = new ScenarioService({ read: store.read.bind(store) }, host);
  return { store, host, imported, service };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
function stateFor(view: ScenarioView, jobId: string) {
  const found = view.jobs.find(job => job.jobId === jobId);
  assert.ok(found, `Required job ${jobId} has a ledger state.`); return found;
}
async function runJob(value: Fixture, view: ScenarioView, jobId: string) {
  const run = value.service.beginRun(owner, view.scenarioId, view.revision.id, jobId);
  return value.service.evaluate(owner, view.scenarioId, run.id);
}
async function complete(value: Fixture, original: ScenarioView) {
  let view = value.service.reopen(owner, original.scenarioId, original.revision.id);
  for (let pass = 0; pass <= view.revision.jobs.length; pass++) {
    if (view.jobs.every(job => job.status === 'ready')) return view;
    const available = view.revision.jobs.find(job => stateFor(view, job.id).status !== 'ready'
      && job.dependsOn.every(id => stateFor(view, id).status === 'ready'));
    assert.ok(available, 'Synthetic required graph has an executable topological next job.');
    await runJob(value, view, available.id);
    view = value.service.reopen(owner, view.scenarioId, view.revision.id);
  }
  assert.fail('All finite required jobs must finish.');
}
function resultFor(value: Fixture, scenarioId: string, view: ScenarioView, jobId: string): ScenarioRunResult {
  const runId = stateFor(view, jobId).runId ?? stateFor(view, jobId).retainedRunId;
  const result = value.host.records.get(scenarioId)!.results.find(result => result.runId === runId);
  assert.ok(result); return result;
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, canonical(child)])) : value;
function reseal<T extends { digest: string }>(value: T): T {
  const { digest: ignored, ...body } = value; value.digest = hash(canonical(body)); return value;
}
function alteredRecord(value: Fixture, id: string, change: (record: ScenarioRecord) => void) {
  const record = value.host.records.get(id)!;
  change(record);
  for (const item of [...record.revisions, ...record.runs, ...record.results, ...record.comparisons]) reseal(item);
  reseal(record); value.host.authentic.add(record.digest);
}

test('discovery descriptions expose exact same-label revisions and preserve partial, running, stale and reused history', async () => {
  const value = await setup(), first = value.service.create(owner, createRequest()), second = value.service.create(owner, createRequest());
  const metadata = value.service.describe(owner, first.scenarioId, first.revision.id);
  assert.deepEqual(Object.keys(metadata).sort(), ['createdAt', 'isHead', 'label', 'noAction', 'revisionId', 'revisionMode', 'scenarioId', 'status']);
  assert.equal(metadata.label, value.service.describe(owner, second.scenarioId, second.revision.id).label);
  assert.notEqual(metadata.scenarioId, second.scenarioId);
  assert.equal(metadata.status, 'partial'); assert.equal(metadata.isHead, true); assert.equal(metadata.noAction, true);
  const issued = value.service.beginRun(owner, first.scenarioId, first.revision.id, first.revision.branches[0].rootJobId);
  assert.equal(value.service.describe(owner, first.scenarioId, first.revision.id).status, 'partial');
  await value.service.evaluate(owner, first.scenarioId, issued.id); await complete(value, first);
  const changed = value.service.changeAssumption(owner, first.scenarioId, first.revision.id, first.revision.branches[1].id, '3000');
  assert.equal(value.service.describe(owner, first.scenarioId, changed.revision.id).status, 'partial');
  assert.deepEqual(value.service.describe(owner, first.scenarioId, first.revision.id), { ...metadata, status: 'complete', isHead: false });
  assert.deepEqual(value.service.reopen(owner, first.scenarioId, first.revision.id).revision, first.revision);
  await complete(value, changed); value.service.finalize(owner, first.scenarioId, changed.revision.id);
  assert.equal(value.service.describe(owner, first.scenarioId, changed.revision.id).status, 'complete');
  const recomputed = value.service.recompute(owner, first.scenarioId, changed.revision.id);
  assert.equal(value.service.describe(owner, first.scenarioId, recomputed.revision.id).status, 'partial');
});

test('discovery descriptions preserve independent reused descendants and retained stale original vectors', async () => {
  const value = await setup(), first = value.service.create(owner, createRequest()), branch = first.revision.branches[1];
  const graph = value.service.addAnalysis(owner, first.scenarioId, first.revision.id, {
    branchId: branch.id, label: 'Independent child', request: measuredRequest(), dependsOn: [], usesBranchAssumptions: false,
  });
  const independent = graph.revision.jobs.find(item => item.label === 'Independent child')!;
  const descendant = value.service.addAnalysis(owner, first.scenarioId, graph.revision.id, {
    branchId: branch.id, label: 'Reused descendant', request: measuredRequest(), dependsOn: [independent.id], usesBranchAssumptions: false,
  });
  await complete(value, descendant); value.service.finalize(owner, first.scenarioId, descendant.revision.id);
  const changed = value.service.changeAssumption(owner, first.scenarioId, descendant.revision.id, branch.id, '2500');
  assert.equal(value.service.describe(owner, first.scenarioId, changed.revision.id).status, 'partial');
  await complete(value, changed); value.service.finalize(owner, first.scenarioId, changed.revision.id);
  assert.equal(value.service.describe(owner, first.scenarioId, changed.revision.id).status, 'complete');
});

test('discovery descriptions refuse sealed invalid graph hashes, evaluation manifests and mixed ready selections', async t => {
  for (const invalid of ['input digest', 'missing evaluation job', 'mixed ready run', 'false reuse', 'mixed receipt', 'parent cycle'] as const) await t.test(invalid, async () => {
    const value = await setup(), first = value.service.create(owner, createRequest()); await complete(value, first);
    alteredRecord(value, first.scenarioId, record => {
      if (invalid === 'input digest') record.revisions[0].jobs[0].inputDigest = 'a'.repeat(64);
      if (invalid === 'missing evaluation job') record.evaluations[0].jobs.pop();
      if (invalid === 'mixed ready run') record.evaluations[0].jobs[0].runId = record.evaluations[0].jobs[1].runId;
      if (invalid === 'false reuse') record.evaluations[0].jobs[0].reusedFromRevisionId = first.revision.id;
      if (invalid === 'mixed receipt') {
        record.results[0].receipt = structuredClone(record.results[1].receipt);
        record.results[0].receiptDigest = hash(canonical(record.results[0].receipt));
      }
      if (invalid === 'parent cycle') record.revisions[0].parentRevisionId = first.revision.id;
    });
    assert.throws(() => value.service.describe(owner, first.scenarioId, first.revision.id),
      { code: ['missing evaluation job', 'parent cycle'].includes(invalid) ? 'SCENARIO_GRAPH_INVALID' : 'SCENARIO_VECTOR_MISMATCH' });
  });
});

test('discovery comparison manifests keep their own immutable run pins after a later coherent ledger selection', async () => {
  const value = await setup(), first = value.service.create(owner, createRequest()); await complete(value, first);
  const comparison = value.service.finalize(owner, first.scenarioId, first.revision.id);
  alteredRecord(value, first.scenarioId, record => {
    const state = record.evaluations[0].jobs[0], previous = record.runs.find(item => item.id === state.runId)!;
    const run = reseal({ ...structuredClone(previous), id: `${previous.id}_later` });
    const receipt = structuredClone(record.results.find(item => item.runId === previous.id)!.receipt); receipt.id += '_later';
    const result = reseal({ ...structuredClone(record.results.find(item => item.runId === previous.id)!), runId: run.id,
      runDigest: run.digest, receipt, receiptDigest: hash(canonical(receipt)) });
    record.runs.push(run); record.results.push(result); state.runId = run.id;
  });
  assert.equal(value.service.describe(owner, first.scenarioId, first.revision.id).status, 'complete');
  assert.deepEqual(value.service.reopen(owner, first.scenarioId, first.revision.id).comparisons, [comparison]);
  value.host.blockedReceiptId = comparison.requiredJobs[0].receiptId;
  assert.equal(value.service.reopen(owner, first.scenarioId, first.revision.id).status, 'complete', 'The immutable comparison receipt is outside the later ledger selection.');
  assert.throws(() => value.service.describe(owner, first.scenarioId, first.revision.id), { code: 'SCENARIO_NOT_READY' });
  delete value.host.blockedReceiptId;
  alteredRecord(value, first.scenarioId, record => {
    record.comparisons[0].requiredJobs[0].runId = record.comparisons[0].requiredJobs[1].runId;
  });
  assert.throws(() => value.service.describe(owner, first.scenarioId, first.revision.id), { code: 'SCENARIO_VECTOR_MISMATCH' });
});

test('discovery refuses an aging receipt substituted from a different exact observation date', async () => {
  const value = await setup(), first = value.service.create(owner, createRequest()), branch = first.revision.branches[1];
  const early = value.service.addAnalysis(owner, first.scenarioId, first.revision.id, {
    branchId: branch.id, label: 'Early aging', request: { ...measuredRequest(), operation: 'aging', onDate: '2026-09-15' },
    dependsOn: [], usesBranchAssumptions: false,
  });
  const late = value.service.addAnalysis(owner, first.scenarioId, early.revision.id, {
    branchId: branch.id, label: 'Late aging', request: { ...measuredRequest(), operation: 'aging', onDate: '2026-09-30' },
    dependsOn: [], usesBranchAssumptions: false,
  });
  const ready = await complete(value, late);
  assert.equal(value.service.describe(owner, first.scenarioId, late.revision.id).status, 'complete');
  const earlyJob = ready.revision.jobs.find(item => item.label === 'Early aging')!, lateJob = ready.revision.jobs.find(item => item.label === 'Late aging')!;
  const earlyResult = resultFor(value, first.scenarioId, ready, earlyJob.id), lateResult = resultFor(value, first.scenarioId, ready, lateJob.id);
  assert.notEqual(earlyResult.receipt.assumptions.onDate, lateResult.receipt.assumptions.onDate);
  alteredRecord(value, first.scenarioId, record => {
    const original = record.results.find(item => item.runId === earlyResult.runId)!;
    original.receipt = structuredClone(lateResult.receipt); original.receiptDigest = lateResult.receiptDigest;
  });
  assert.throws(() => value.service.describe(owner, first.scenarioId, late.revision.id), { code: 'SCENARIO_VECTOR_MISMATCH' });
});

test('discovery refuses altered receipt rows, actual sources, exclusions and import lineage outside exact original evidence', async t => {
  for (const invalid of ['unknown revoked row', 'unknown actual source', 'unknown row pin', 'unknown exclusion', 'unknown import'] as const)
    await t.test(invalid, async () => {
      const value = await setup(), first = value.service.create(owner, createRequest()); await complete(value, first);
      value.store.mutate(state => { state.sourceRules.push({ sourceId: 'revoked-external-source', revoked: true }); });
      alteredRecord(value, first.scenarioId, record => {
        const result = record.results[0], receipt = result.receipt;
        if (invalid === 'unknown revoked row') {
          receipt.rows[0] = { ...receipt.rows[0], factId: 'external-private-row', sourceId: 'revoked-external-source' };
          receipt.rowIds = receipt.rows.map(row => row.factId); receipt.sourceIds = [...new Set(receipt.rows.map(row => row.sourceId))];
        }
        if (invalid === 'unknown actual source') receipt.sourceIds.push('revoked-external-source');
        if (invalid === 'unknown row pin') receipt.rowIds[0] = 'external-private-row';
        if (invalid === 'unknown exclusion') receipt.exclusions.push({ rowId: 'external-private-row', reason: 'Synthetic inaccessible retained exclusion' });
        if (invalid === 'unknown import') receipt.coverage.importIds.push('external-private-import');
        result.receiptDigest = hash(canonical(receipt));
      });
      assert.throws(() => value.service.describe(owner, first.scenarioId, first.revision.id), { code: 'SCENARIO_VECTOR_MISMATCH' });
    });
});

test('discovery lineage checks preserve compound calculator receipts using a published custom money field', async () => {
  const value = await setup(), draft = structuredClone(starterPacks.find(pack => pack.pack === 'retail')!);
  draft.fields.feeMinor = 'money'; draft.definitions.find(item => item.name === 'earned')!.field = 'feeMinor';
  const dictionary = compileDictionary(draft, 2, owner.memberId, '2026-01-01T00:00:01.000Z');
  value.store.mutate(state => {
    state.ontology = { current: dictionary, history: [...state.ontology.history, dictionary] };
    for (const fact of state.facts) fact.fields.feeMinor = '5';
  });
  const first = value.service.create(owner, createRequest()), ready = await complete(value, first);
  assert.ok(ready.results.every(result => result.receipt.rows.every(row => row.measureField === 'feeMinor')));
  assert.equal(value.service.describe(owner, first.scenarioId, first.revision.id).status, 'complete');
});

test('discovery metadata is withheld after source, account and callback revocation', async t => {
  for (const change of ['source', 'account', 'callback'] as const) await t.test(change, async () => {
    const value = await setup(), first = value.service.create(owner, createRequest());
    if (change === 'account') value.store.mutate(state => { state.members[0].active = false; });
    else if (change === 'source') value.store.mutate(state => { state.sourceRules.push({ sourceId, revoked: true }); });
    else value.host.nextConsumerGuard = () => value.store.mutate(state => { state.sourceRules.push({ sourceId, revoked: true }); });
    assert.throws(() => value.service.describe(owner, first.scenarioId, first.revision.id),
      { code: change === 'account' ? 'ACCESS_REVOKED' : 'SOURCE_REVOKED' });
  });
});

test('import → same-label alternatives → changed assumption rejects a late mixed-revision descendant; retained history and explicit current recomputation stay separate', async () => {
  const value = await setup(), liveBefore = value.store.read(), writesBefore = value.store.writes;
  const initial = value.service.create(owner, createRequest()), initialSnapshot = structuredClone(initial.revision);
  const [baseline, changed, other] = initial.revision.branches;
  assert.equal(baseline.role, 'baseline'); assert.equal(changed.label, other.label); assert.notEqual(changed.id, other.id);
  assert.notEqual(changed.assumptionRevisionId, other.assumptionRevisionId);
  const initialReady = await complete(value, initial);
  assert.equal(resultFor(value, initial.scenarioId, initialReady, baseline.rootJobId).receipt.totalMinor, '10010');
  assert.equal(resultFor(value, initial.scenarioId, initialReady, changed.rootJobId).receipt.totalMinor, '11011');
  assert.equal(resultFor(value, initial.scenarioId, initialReady, other.rootJobId).receipt.totalMinor, '12012');
  assert.deepEqual(resultFor(value, initial.scenarioId, initialReady, baseline.rootJobId).receipt.coverage.importIds, [value.imported!.id]);
  const initialComparison = value.service.finalize(owner, initial.scenarioId, initial.revision.id);
  const graph1 = value.service.addAnalysis(owner, initial.scenarioId, initial.revision.id, {
    branchId: changed.id, label: 'Required child', request: baselineRequest({ assumptions: { priceChangeBps: '1000' } }),
    dependsOn: [changed.rootJobId], usesBranchAssumptions: true,
  });
  const child = graph1.revision.jobs.find(job => job.label === 'Required child')!;
  const childReady = await complete(value, graph1);
  const graph2 = value.service.addAnalysis(owner, initial.scenarioId, graph1.revision.id, {
    branchId: changed.id, label: 'Required late descendant', request: baselineRequest({ assumptions: { priceChangeBps: '1000' } }),
    dependsOn: [child.id], usesBranchAssumptions: true,
  });
  const descendant = graph2.revision.jobs.find(job => job.label === 'Required late descendant')!;
  const issued = value.service.beginRun(owner, initial.scenarioId, graph2.revision.id, descendant.id);
  assert.equal(issued.revisionId, graph2.revision.id);
  assert.equal(issued.dependencies[0].jobId, child.id);
  assert.equal(issued.dependencies[0].runId, stateFor(childReady, child.id).runId);
  const revised = value.service.changeAssumption(owner, initial.scenarioId, graph2.revision.id, changed.id, '2500');
  assert.equal(revised.revision.mode, 'assumption-change'); assert.equal(revised.revision.parentRevisionId, graph2.revision.id);
  for (const id of [changed.rootJobId, child.id, descendant.id]) assert.equal(stateFor(revised, id).status, 'stale');
  for (const id of [baseline.rootJobId, other.rootJobId]) assert.equal(stateFor(revised, id).status, 'ready');
  const late = await value.service.evaluate(owner, initial.scenarioId, issued.id);
  assert.equal(late.runId, issued.id); assert.equal(late.receipt.totalMinor, '11011');
  assert.throws(() => value.service.finalize(owner, initial.scenarioId, revised.revision.id), refusal);
  assert.throws(() => value.service.finalize(owner, initial.scenarioId, graph2.revision.id), refusal);
  const oldGraph = value.service.reopen(owner, initial.scenarioId, graph2.revision.id);
  assert.equal(stateFor(oldGraph, descendant.id).status, 'ready');
  const revisedReady = await complete(value, revised), comparison = value.service.finalize(owner, initial.scenarioId, revised.revision.id);
  assert.equal(comparison.requiredJobs.length, revised.revision.jobs.length);
  assert.equal(comparison.noAction, true);
  for (const pin of comparison.requiredJobs) {
    const job = revisedReady.revision.jobs.find(job => job.id === pin.jobId)!;
    assert.equal(pin.inputDigest, job.inputDigest); assert.equal(pin.requestDigest, job.requestDigest);
    assert.equal(pin.receiptDigest, resultFor(value, initial.scenarioId, revisedReady, job.id).receiptDigest);
    if ([changed.rootJobId, child.id, descendant.id].includes(job.id)) assert.equal(pin.runRevisionId, revised.revision.id);
  }
  const retained = value.service.reopen(owner, initial.scenarioId, initial.revision.id);
  assert.equal(retained.mode, 'retained-revision'); assert.deepEqual(retained.revision, initialSnapshot);
  assert.deepEqual(retained.comparisons, [initialComparison]);
  assert.equal(resultFor(value, initial.scenarioId, retained, baseline.rootJobId).receipt.totalMinor, '10010');
  assert.deepEqual(value.store.read(), liveBefore); assert.equal(value.store.writes, writesBefore, 'Scenario evaluation never writes to the live workspace.');

  await importSales(value.store, '200.01'); value.host.time = '2100-01-01T00:00:01.000Z';
  assert.equal(resultFor(value, initial.scenarioId, value.service.reopen(owner, initial.scenarioId, revised.revision.id), changed.rootJobId).receipt.totalMinor, '12512');
  const current = value.service.recompute(owner, initial.scenarioId, revised.revision.id);
  assert.equal(current.revision.mode, 'current-state-recompute'); assert.equal(current.revision.parentRevisionId, revised.revision.id);
  assert.notEqual(current.revision.evidenceId, revised.revision.evidenceId); assert.notEqual(current.revision.evidenceDigest, revised.revision.evidenceDigest);
  assert.notEqual(current.revision.id, revised.revision.id);
  assert.ok(current.jobs.every(job => job.status === 'stale' || job.status === 'pending'));
  const currentReady = await complete(value, current);
  assert.equal(resultFor(value, initial.scenarioId, currentReady, baseline.rootJobId).receipt.totalMinor, '20010');
  assert.equal(resultFor(value, initial.scenarioId, currentReady, changed.rootJobId).receipt.totalMinor, '25012');
  assert.equal(value.service.finalize(owner, initial.scenarioId, current.revision.id).noAction, true);
  assert.deepEqual(value.service.reopen(owner, initial.scenarioId, initial.revision.id).revision, initialSnapshot);
  assert.equal(value.host.records.get(initial.scenarioId)!.comparisons.length, 3);

  value.store.mutate(state => { state.sourceRules.push({ sourceId, revoked: true }); });
  assert.throws(() => value.service.reopen(owner, initial.scenarioId, initial.revision.id), { code: 'SOURCE_REVOKED' });
  assert.throws(() => value.service.reopen(owner, initial.scenarioId, current.revision.id), { code: 'SOURCE_REVOKED' });
  assert.throws(() => value.service.recompute(owner, initial.scenarioId, current.revision.id), { code: 'SOURCE_REVOKED' });
  value.store.mutate(state => { state.sourceRules = []; state.members[0].active = false; });
  assert.throws(() => value.service.reopen(owner, initial.scenarioId, initial.revision.id), { code: 'ACCESS_REVOKED' });
});

test('an independent calculator job is reused while dependent descendants invalidate transitively', async () => {
  const value = await setup(), initial = value.service.create(owner, createRequest()), branch = initial.revision.branches[1];
  const independentGraph = value.service.addAnalysis(owner, initial.scenarioId, initial.revision.id, {
    branchId: branch.id, label: 'Independent measured earned', request: measuredRequest(),
    dependsOn: [], usesBranchAssumptions: false,
  });
  const childGraph = value.service.addAnalysis(owner, initial.scenarioId, independentGraph.revision.id, {
    branchId: branch.id, label: 'Measured dependency child', request: measuredRequest(),
    dependsOn: [branch.rootJobId], usesBranchAssumptions: false,
  });
  const child = childGraph.revision.jobs.find(job => job.label === 'Measured dependency child')!;
  const graph = value.service.addAnalysis(owner, initial.scenarioId, childGraph.revision.id, {
    branchId: branch.id, label: 'Measured dependency grandchild', request: measuredRequest(),
    dependsOn: [child.id], usesBranchAssumptions: false,
  });
  const grandchild = graph.revision.jobs.find(job => job.label === 'Measured dependency grandchild')!;
  const ready = await complete(value, graph), independent = graph.revision.jobs.find(job => job.label === 'Independent measured earned')!;
  const before = resultFor(value, initial.scenarioId, ready, independent.id);
  const changed = value.service.changeAssumption(owner, initial.scenarioId, graph.revision.id, branch.id, '3000');
  assert.equal(stateFor(changed, independent.id).status, 'ready');
  assert.equal(changed.revision.jobs.find(job => job.id === independent.id)!.inputDigest, independent.inputDigest);
  assert.equal(resultFor(value, initial.scenarioId, changed, independent.id).receipt.id, before.receipt.id);
  for (const id of [branch.rootJobId, child.id, grandchild.id]) {
    assert.equal(stateFor(changed, id).status, 'stale');
    assert.notEqual(changed.revision.jobs.find(job => job.id === id)!.inputDigest, graph.revision.jobs.find(job => job.id === id)!.inputDigest);
  }
  assert.deepEqual(changed.revision.jobs.find(job => job.id === child.id)!.request, child.request, 'A dependency invalidates its unchanged measured request.');
  const completeChanged = await complete(value, changed), comparison = value.service.finalize(owner, initial.scenarioId, changed.revision.id);
  const pin = comparison.requiredJobs.find(job => job.jobId === independent.id)!;
  assert.equal(pin.receiptId, before.receipt.id); assert.equal(pin.reusedFromRevisionId, graph.revision.id);
  assert.equal(resultFor(value, initial.scenarioId, completeChanged, branch.rootJobId).receipt.totalMinor, '13013');
});

test('authored lexical requests, effective request pins and detached return values retain their exact identities', async () => {
  const value = await setup(), authored = baselineRequest({ asOf: '2100-01-01T00:00:00Z' });
  const input = createRequest(authored); input.alternatives[0].priceChangeBps = '01000';
  const view = value.service.create(owner, input), savedRevision = structuredClone(view.revision), baseline = view.revision.branches[0], alternative = view.revision.branches[1];
  const baselineJob = view.revision.jobs.find(job => job.id === baseline.rootJobId)!;
  assert.deepEqual(baselineJob.authoredRequest, authored);
  // Literal sorted-key SHA-256 answer keys for the exact authored and resolved
  // request bytes; receipt normalization must not replace the authored lexeme.
  assert.equal(baselineJob.authoredRequestDigest, hash({ asOf: '2100-01-01T00:00:00Z', assumptions: { priceChangeBps: '00' }, branch: 'main', operation: 'scenario', period, sourceIds: [sourceId] }));
  assert.equal(baselineJob.requestDigest, hash({ asOf: '2100-01-01T00:00:00.000Z', assumptions: { priceChangeBps: '00' }, branch: 'main', operation: 'scenario', period, sourceIds: [sourceId] }));
  assert.equal(view.revision.jobs.find(job => job.id === alternative.rootJobId)!.authoredRequest.assumptions!.priceChangeBps, '01000');
  input.baseline.request.assumptions!.priceChangeBps = '9000'; input.alternatives[0].priceChangeBps = '9000';
  view.revision.branches[0].label = 'Mutated return'; view.revision.jobs[0].request.assumptions!.priceChangeBps = '9000';
  assert.deepEqual(value.service.reopen(owner, view.scenarioId, savedRevision.id).revision, savedRevision);
  const ready = await complete(value, value.service.reopen(owner, view.scenarioId, savedRevision.id));
  const result = resultFor(value, view.scenarioId, ready, alternative.rootJobId);
  assert.equal(result.receipt.assumptions.priceChangeBps, '1000', 'Calculator normalizes its receipt without rewriting the lexical request.');
  const reopened = value.service.reopen(owner, view.scenarioId, savedRevision.id); reopened.results[0].receipt.totalMinor = 'tampered-return';
  assert.equal(resultFor(value, view.scenarioId, value.service.reopen(owner, view.scenarioId, savedRevision.id), alternative.rootJobId).receipt.totalMinor, '11011');
});

test('all required jobs gate finalization even when root alternatives are complete', async () => {
  const value = await setup(), initial = value.service.create(owner, createRequest()); await complete(value, initial);
  const branch = initial.revision.branches[1], graph = value.service.addAnalysis(owner, initial.scenarioId, initial.revision.id, {
    branchId: branch.id, label: 'Additional required analysis', request: baselineRequest({ assumptions: { priceChangeBps: '1000' } }),
    dependsOn: [branch.rootJobId], usesBranchAssumptions: true,
  });
  assert.throws(() => value.service.finalize(owner, initial.scenarioId, graph.revision.id), refusal);
  await complete(value, graph); assert.equal(value.service.finalize(owner, initial.scenarioId, graph.revision.id).requiredJobs.length, 4);
});

test('empty and unreconciled evidence retain uncertainty and no-action semantics', async () => {
  const empty = await setup(false), view = empty.service.create(owner, createRequest(baselineRequest({ sourceIds: ['explicit-empty-source'] })));
  const ready = await complete(empty, view);
  for (const job of ready.revision.jobs) {
    const receipt = resultFor(empty, view.scenarioId, ready, job.id).receipt;
    assert.equal(receipt.totalMinor, '0'); assert.equal(receipt.coverage.completeness, 'empty');
    assert.match(receipt.explanation, /empty selection is not proof/);
    assert.deepEqual(receipt.requestedSourceIds, ['explicit-empty-source']);
    assert.deepEqual(receipt.rows, []); assert.deepEqual(receipt.coverage.importIds, []);
    assert.equal(receipt.assumptions.volume, 'Held constant'); assert.match(String(receipt.assumptions.status), /Scenario only/);
  }
  const comparison = empty.service.finalize(owner, view.scenarioId, view.revision.id);
  assert.equal(comparison.noAction, true); assert.ok(comparison.limitations.some(value => /empty|coverage/i.test(value)));
  empty.store.mutate(state => { state.sourceRules.push({ sourceId: 'explicit-empty-source', revoked: true }); });
  assert.throws(() => empty.service.reopen(owner, view.scenarioId, view.revision.id), { code: 'SOURCE_REVOKED' });

  const direct = await setup(false);
  await new MemoryService(direct.store).append(owner, [{ sourceId, entityId: 'direct-only', sourceRow: 2, kind: 'sale', validFrom: '2026-09-10', branch: 'main', fields: { amountMinor: '3', currency: 'INR', status: 'settled' } }]);
  const directView = direct.service.create(owner, createRequest()), directReady = await complete(direct, directView);
  assert.ok(directReady.results.every(result => result.receipt.coverage.completeness === 'unreconciled-facts'));
  assert.ok(directReady.results.every(result => result.receipt.coverage.gaps.some(gap => /not reconciled/.test(gap))));
  assert.ok(direct.service.finalize(owner, directView.scenarioId, directView.revision.id).limitations.some(value => /coverage gaps|source completeness/i.test(value)));
  assert.deepEqual(direct.store.read().actions, []); assert.deepEqual(direct.store.read().jobs, []);
});

test('reviewed receipts exclude outside sources while complete retained input custody conservatively withholds after any retained source revocation', async () => {
  const value = await setup(); await importSales(value.store, '100.01', 'outside-source');
  const view = value.service.create(owner, createRequest()), ready = await complete(value, view);
  for (const result of ready.results) {
    assert.ok(result.receipt.rows.every(row => row.sourceId === sourceId));
    assert.deepEqual(result.receipt.sourceIds, [sourceId]);
    const sourceRows = new Set(value.store.read().facts.filter(fact => fact.sourceId === sourceId).map(fact => fact.id));
    assert.ok(result.receipt.exclusions.every(exclusion => sourceRows.has(exclusion.rowId)));
  }
  assert.ok(value.host.records.get(view.scenarioId)!.evidence[0].state.facts.some(fact => fact.sourceId === 'outside-source'), 'This host-only slice deliberately retains the complete input snapshot.');
  value.store.mutate(state => { state.sourceRules.push({ sourceId: 'outside-source', revoked: true }); });
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), { code: 'SOURCE_REVOKED' });
  assert.throws(() => value.service.finalize(owner, view.scenarioId, view.revision.id), { code: 'SOURCE_REVOKED' });
});

test('excluded selected-source evidence and source tombstones are checked when reopening', async () => {
  const value = await setup();
  await new MemoryService(value.store).append(owner, [{ sourceId, entityId: 'outside-period', sourceRow: 9, kind: 'sale', validFrom: '2026-08-01', branch: 'main', fields: { amountMinor: '999', currency: 'INR', status: 'settled' } }]);
  const view = value.service.create(owner, createRequest()), ready = await complete(value, view);
  const excluded = ready.results[0].receipt.exclusions.find(exclusion => /Outside the requested/.test(exclusion.reason)); assert.ok(excluded);
  value.store.mutate(state => { state.tombstones.push({ factId: excluded.rowId }); });
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), refusal);
});

for (const change of [
  { name: 'member deactivation', mutate: (state: State) => { state.members[0].active = false; }, code: 'ACCESS_REVOKED' },
  { name: 'member epoch', mutate: (state: State) => { state.members[0].epoch++; }, code: 'ACCESS_REVOKED' },
  { name: 'branch grant', mutate: (state: State) => { state.members[0].branches = ['other-branch']; }, code: 'SCENARIO_EVIDENCE_UNAVAILABLE' },
  { name: 'source policy', mutate: (state: State) => { state.policy.allowedSources = ['other-source']; }, code: 'SOURCE_REVOKED' },
  { name: 'source tombstone', mutate: (state: State) => { state.tombstones.push({ kind: 'source', sourceId }); }, code: 'SOURCE_REVOKED' },
]) test(`retained and current scenario access is withheld after ${change.name}`, async () => {
  const value = await setup(), view = value.service.create(owner, createRequest()), ready = await complete(value, view);
  value.store.mutate(change.mutate);
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), { code: change.code });
  assert.throws(() => value.service.finalize(owner, view.scenarioId, view.revision.id), { code: change.code });
  assert.throws(() => value.service.recompute(owner, view.scenarioId, view.revision.id), { code: change.code });
  assert.equal(ready.status, 'complete');
});

test('another currently authorized member cannot reopen private retained revisions', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest());
  const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1 };
  value.store.mutate(state => { state.members.push({ id: accountant.memberId, name: 'Synthetic accountant', role: accountant.role, epoch: 1, active: true, branches: ['*'] }); });
  assert.throws(() => value.service.reopen(accountant, view.scenarioId, view.revision.id), refusal);
});

test('same-member current role and source grants apply to retained evaluation while original source precedence remains pinned', async () => {
  const value = await setup(), otherSource = 'precedence-synthetic-sales';
  await importSales(value.store, '200.01', otherSource);
  value.store.mutate(state => {
    state.sourceRules.push({ sourceId, roles: ['owner'] }, { sourceId: otherSource, roles: ['owner'] },
      { kind: 'sale', sourceIds: [sourceId, otherSource], at: '2000-01-01T00:00:00.000Z' });
  });
  const view = value.service.create(owner, createRequest(baselineRequest({ sourceIds: [sourceId, otherSource] })));
  const retainedRevision = structuredClone(view.revision);
  const currentContext: Context = { memberId: owner.memberId, role: 'accountant', epoch: owner.epoch };
  value.store.mutate(state => {
    state.members[0].role = 'accountant';
    state.sourceRules = [
      { sourceId, roles: ['accountant'] }, { sourceId: otherSource, roles: ['accountant'] },
      { kind: 'sale', sourceIds: [otherSource, sourceId], at: '2099-01-01T00:00:00.000Z' },
    ];
  });
  const liveBefore = value.store.read(), writesBefore = value.store.writes;
  assert.deepEqual(value.service.reopen(currentContext, view.scenarioId, view.revision.id).revision, retainedRevision);
  const expectedByBranch = ['10010', '11011', '12012'];
  for (const [index, branch] of view.revision.branches.entries()) {
    const run = value.service.beginRun(currentContext, view.scenarioId, view.revision.id, branch.rootJobId);
    const result = await value.service.evaluate(currentContext, view.scenarioId, run.id);
    assert.equal(result.receipt.totalMinor, expectedByBranch[index], 'Current grants cannot silently turn retained evidence empty or apply current precedence.');
    assert.ok(result.receipt.rows.every(row => row.sourceId === sourceId));
    assert.equal(result.receipt.memberId, owner.memberId); assert.equal(result.receipt.epoch, owner.epoch);
    assert.ok(result.receipt.exclusions.length > 0, 'The original precedence decision and competing-source exclusions remain visible.');
  }
  assert.equal(value.service.reopen(currentContext, view.scenarioId, view.revision.id).status, 'complete');
  assert.equal(value.service.finalize(currentContext, view.scenarioId, view.revision.id).noAction, true);
  value.host.time = '2100-01-01T00:00:01.000Z';
  const recomputed = value.service.recompute(currentContext, view.scenarioId, view.revision.id), expectedRecomputed = ['20010', '22011', '24012'];
  assert.equal(recomputed.revision.mode, 'current-state-recompute');
  assert.notEqual(recomputed.revision.evidenceDigest, view.revision.evidenceDigest);
  for (const [index, branch] of recomputed.revision.branches.entries()) {
    const run = value.service.beginRun(currentContext, view.scenarioId, recomputed.revision.id, branch.rootJobId);
    const result = await value.service.evaluate(currentContext, view.scenarioId, run.id);
    assert.equal(result.receipt.totalMinor, expectedRecomputed[index], 'Explicit current-state recomputation adopts the separately captured new precedence.');
    assert.ok(result.receipt.rows.every(row => row.sourceId === otherSource));
  }
  assert.equal(value.service.finalize(currentContext, view.scenarioId, recomputed.revision.id).noAction, true);
  const reopenedOld = value.service.reopen(currentContext, view.scenarioId, view.revision.id);
  assert.deepEqual(reopenedOld.revision, retainedRevision);
  assert.equal(resultFor(value, view.scenarioId, reopenedOld, view.revision.branches[0].rootJobId).receipt.totalMinor, '10010');
  assert.deepEqual(value.store.read(), liveBefore); assert.equal(value.store.writes, writesBefore);
  value.store.mutate(state => { state.sourceRules.find(rule => rule.sourceId === sourceId)!.roles = ['cofounder']; });
  assert.throws(() => value.service.reopen(currentContext, view.scenarioId, view.revision.id), { code: 'SOURCE_REVOKED' });
  assert.throws(() => value.service.reopen(currentContext, view.scenarioId, recomputed.revision.id), { code: 'SOURCE_REVOKED' });
});

test('access revocation while awaiting calculator completion withholds a new retained result', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest()), run = value.service.beginRun(owner, view.scenarioId, view.revision.id, view.revision.branches[0].rootJobId);
  const pending = value.service.evaluate(owner, view.scenarioId, run.id);
  value.store.mutate(state => { state.sourceRules.push({ sourceId, revoked: true }); });
  await assert.rejects(pending, { code: 'SOURCE_REVOKED' });
  assert.equal(value.host.records.get(view.scenarioId)!.results.length, 0);
  assert.deepEqual(value.store.read().receipts, []); assert.deepEqual(value.store.read().answers, []);
});

test('source revocation inside a synchronous consumer guard withholds a retained view', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest()); await complete(value, view);
  const before = structuredClone(value.host.records.get(view.scenarioId));
  value.host.nextConsumerGuard = () => value.store.mutate(state => { state.sourceRules.push({ sourceId, revoked: true }); });
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), { code: 'SOURCE_REVOKED' });
  assert.deepEqual(value.host.records.get(view.scenarioId), before);
});

test('member revocation inside a synchronous custody callback prevents a newly retained result from escaping', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest());
  const run = value.service.beginRun(owner, view.scenarioId, view.revision.id, view.revision.branches[0].rootJobId);
  value.host.nextRetention = () => value.store.mutate(state => { state.members[0].active = false; });
  await assert.rejects(value.service.evaluate(owner, view.scenarioId, run.id), { code: 'ACCESS_REVOKED' });
  assert.equal(value.host.records.get(view.scenarioId)!.results.length, 1, 'The synchronous host may have retained an append before callback revocation; current access still withholds it.');
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), { code: 'ACCESS_REVOKED' });
  assert.deepEqual(value.store.read().receipts, []); assert.deepEqual(value.store.read().answers, []);
});

test('explicit empty source scope keeps a distinct request identity from omitted full-source scope', async () => {
  const value = await setup(), allSources = baselineRequest(); Reflect.deleteProperty(allSources, 'sourceIds');
  const full = value.service.create(owner, createRequest(allSources));
  const empty = value.service.create(owner, createRequest(baselineRequest({ sourceIds: [] })));
  const fullRoot = full.revision.jobs.find(job => job.id === full.revision.branches[0].rootJobId)!;
  const emptyRoot = empty.revision.jobs.find(job => job.id === empty.revision.branches[0].rootJobId)!;
  assert.equal(Object.hasOwn(fullRoot.authoredRequest, 'sourceIds'), false); assert.deepEqual(emptyRoot.authoredRequest.sourceIds, []);
  assert.notEqual(fullRoot.authoredRequestDigest, emptyRoot.authoredRequestDigest); assert.notEqual(fullRoot.requestDigest, emptyRoot.requestDigest);
  const fullReady = await complete(value, full), emptyReady = await complete(value, empty);
  const fullReceipt = resultFor(value, full.scenarioId, fullReady, fullRoot.id).receipt;
  const emptyReceipt = resultFor(value, empty.scenarioId, emptyReady, emptyRoot.id).receipt;
  assert.equal(fullReceipt.totalMinor, '10010'); assert.equal(Object.hasOwn(fullReceipt, 'requestedSourceIds'), false);
  assert.equal(emptyReceipt.totalMinor, '0'); assert.deepEqual(emptyReceipt.requestedSourceIds, []);
  assert.deepEqual(emptyReceipt.rows, []); assert.deepEqual(emptyReceipt.rowIds, []); assert.deepEqual(emptyReceipt.sourceIds, []);
  assert.deepEqual(emptyReceipt.exclusions, []); assert.deepEqual(emptyReceipt.coverage.importIds, []);
  assert.equal(emptyReceipt.coverage.completeness, 'empty'); assert.match(emptyReceipt.explanation, /empty selection is not proof/);
});

test('head advance during awaited completion retains the issued revision without finalizing a mixed graph', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest()), branch = view.revision.branches[1];
  const run = value.service.beginRun(owner, view.scenarioId, view.revision.id, branch.rootJobId);
  const pending = value.service.evaluate(owner, view.scenarioId, run.id);
  const changed = value.service.changeAssumption(owner, view.scenarioId, view.revision.id, branch.id, '5000');
  const result = await pending;
  assert.equal(result.receipt.totalMinor, '11011');
  assert.equal(stateFor(value.service.reopen(owner, view.scenarioId, view.revision.id), branch.rootJobId).status, 'ready');
  assert.equal(stateFor(value.service.reopen(owner, view.scenarioId, changed.revision.id), branch.rootJobId).status, 'stale');
  assert.throws(() => value.service.finalize(owner, view.scenarioId, changed.revision.id), refusal);
});

test('atomic retention refusal leaves no published result or overwritten revision', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest());
  const run = value.service.beginRun(owner, view.scenarioId, view.revision.id, view.revision.branches[0].rootJobId);
  const before = structuredClone(value.host.records.get(view.scenarioId)); value.host.rejectNextRetention = true;
  await assert.rejects(value.service.evaluate(owner, view.scenarioId, run.id), { code: 'SCENARIO_CAS_CONFLICT' });
  assert.deepEqual(value.host.records.get(view.scenarioId), before);
  assert.deepEqual(value.store.read().receipts, []);
});

test('missing custody authentication, altered pins and missing retained artifacts fail closed', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest());
  const record = value.host.records.get(view.scenarioId)!;
  value.host.authentic.delete(record.digest);
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), refusal);
  value.host.authentic.add(record.digest);
  record.revisions[0].jobs[0].request.assumptions!.priceChangeBps = '8000';
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), refusal);
  value.host.records.delete(view.scenarioId);
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), refusal);
});

test('required calculator readiness guards see retained snapshots and refuse unavailable publication', async () => {
  const value = await setup(), view = value.service.create(owner, createRequest());
  const dictionaryHash = value.store.read().ontology.current.hash; await complete(value, view);
  assert.ok(value.host.guardCalls.some(call => call.phase === 'calculate' && call.type === 'request'));
  assert.ok(value.host.guardCalls.some(call => call.phase === 'reopen' && call.type === 'receipt'));
  assert.ok(value.host.guardCalls.every(call => call.dictionaryHash === dictionaryHash));
  value.host.ready = false;
  assert.throws(() => value.service.reopen(owner, view.scenarioId, view.revision.id), { code: 'SCENARIO_NOT_READY' });
});

test('undeclared models, implicit assumptions and invalid revision/dependency scope are rejected', async () => {
  const value = await setup();
  const missingBaselineRequest = createRequest(); Reflect.deleteProperty(missingBaselineRequest.baseline, 'request');
  const invalid: ScenarioCreateRequest[] = [
    missingBaselineRequest,
    createRequest(baselineRequest({ asOf: 'not-an-instant' })),
    createRequest({ ...baselineRequest(), operation: 'earned', assumptions: undefined }),
    createRequest(baselineRequest({ assumptions: { priceChangeBps: '1' } })),
    createRequest(baselineRequest({ assumptions: undefined })),
    { ...createRequest(), alternatives: [{ label: 'Missing explicit assumption', priceChangeBps: undefined as unknown as string }] },
    { ...createRequest(), alternatives: [{ label: 'Unspecified model', priceChangeBps: '1000', demandModel: 'invented' } as ScenarioCreateRequest['alternatives'][number]] },
  ];
  for (const request of invalid) assert.throws(() => value.service.create(owner, request), validationRefusal);
  const view = value.service.create(owner, createRequest()), [baseline, branch, other] = view.revision.branches;
  assert.throws(() => value.service.changeAssumption(owner, view.scenarioId, view.revision.id, baseline.id, '1000'), refusal);
  assert.throws(() => value.service.changeAssumption(owner, view.scenarioId, 'unknown-revision', branch.id, '1000'), refusal);
  for (const overrides of [
    { branchId: 'missing-branch' },
    { dependsOn: ['missing-job'] }, { dependsOn: [other.rootJobId] },
    { dependsOn: [branch.rootJobId, branch.rootJobId] },
    { request: baselineRequest({ assumptions: { priceChangeBps: '2000' } }) },
    { request: baselineRequest({ assumptions: { priceChangeBps: '1000' }, asOf: '2099-01-01T00:00:00Z' }) },
    { request: baselineRequest({ sourceIds: ['different-source'], assumptions: { priceChangeBps: '1000' } }) },
    { request: baselineRequest({ assumptions: { priceChangeBps: '1000' }, period: { from: '2026-08-01', to: '2026-08-31' } }) },
    { usesBranchAssumptions: false },
  ]) assert.throws(() => value.service.addAnalysis(owner, view.scenarioId, view.revision.id, {
    branchId: branch.id, label: 'Invalid synthetic analysis', request: baselineRequest({ assumptions: { priceChangeBps: '1000' } }), dependsOn: [], usesBranchAssumptions: true, ...overrides,
  }), validationRefusal);
  assert.equal(value.host.records.get(view.scenarioId)!.revisions.length, 1);
});
