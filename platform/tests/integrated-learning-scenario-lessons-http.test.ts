import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { digest, sourceAccess } from '../runtime/actions.ts';
import type { DatabaseVerification } from '../runtime/analytics.ts';
import type { Context, StateStore } from '../runtime/contracts.ts';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import type { EngineLessonOptions } from '../runtime/engine-lessons.ts';
import type { ImportInput, MappingRecipe } from '../runtime/ingest.ts';
import type { LessonView } from '../runtime/lesson-contracts.ts';
import type { ScenarioCreateRequest, ScenarioView } from '../runtime/scenario-contracts.ts';
import { createLocalServer } from '../runtime/server.ts';
import { decision, fixture as lessonProtocol, pin, proposal, SYNTHETIC_QUALIFICATION } from './fixtures/lesson-fixture.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';

// Real loopback HTTP and encrypted Vault custody; PostgreSQL admission/storage,
// SQL reduction, personal targets and evaluation runs are injected SYNTHETIC
// protocols. These cases do not qualify native SQL, real suites or a provider.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const SOURCE = 'PRIVATE_PRIMARY_SOURCE_86041';
const OTHER_SOURCE = 'PRIVATE_UNSELECTED_SOURCE_86042';
const PASSPHRASE = 'Synthetic integrated HTTP passphrase 86041';
const PERIOD = { from: '2026-09-01', to: '2026-09-30' };
const RECIPE: MappingRecipe = {
  version: 1, id: 'PRIVATE_RECIPE_86041', system: 'synthetic-csv', edition: '1',
  scope: { company: 'PRIVATE_COMPANY_86041', branches: ['main'] },
  bindings: [
    { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
    { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
    { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
    { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
    ...['currency', 'branch', 'status', 'description'].map(target => ({ target, source: target, type: 'string' as const, nulls: 'reject' as const })),
  ], allowedKinds: ['sale'], allowedStatuses: ['delivered'], onUnmapped: 'reject',
};
function sales(firstAmount = '100.01'): ImportInput {
  return { sourceId: SOURCE, format: 'csv', recipe: RECIPE,
    content: 'id,kind,date,amount,currency,branch,status,description\n' +
      `PRIVATE_ENTITY_10001,sale,2026-09-10,${firstAmount},INR,main,delivered,PRIVATE_PRIMARY_CELL_86041\n` +
      'PRIVATE_ENTITY_9,sale,2026-09-11,0.09,INR,main,delivered,PRIVATE_PRIMARY_CELL_86041\n',
    expectedTotals: { rowCount: 2, amountMinor: firstAmount === '200.01' ? '20010' : '10010' } };
}
const otherSales: ImportInput = { sourceId: OTHER_SOURCE, format: 'csv', recipe: RECIPE,
  content: 'id,kind,date,amount,currency,branch,status,description\nPRIVATE_OTHER_ENTITY,sale,2026-09-12,1.00,INR,main,delivered,PRIVATE_SECONDARY_CELL_86042\n',
  expectedTotals: { rowCount: 1, amountMinor: '100' } };
function scenarioInput(): ScenarioCreateRequest {
  return { version: 1, label: 'Synthetic retained price comparison',
    baseline: { label: 'Measured baseline', request: { operation: 'scenario', sourceIds: [SOURCE], branch: 'main', period: PERIOD, assumptions: { priceChangeBps: '00' } } },
    alternatives: [{ label: 'Equal display label', priceChangeBps: '1000' }, { label: 'Equal display label', priceChangeBps: '2000' }] };
}

async function fixture(t: TestContext, options: { lessons?: boolean; evaluations?: boolean } = {}) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i, 'Synthetic custody stays on C.');
  const directory = await realpath(await mkdtemp(join(base, 'chausar-integrated-http-')));
  assert.equal(dirname(directory), base);
  const protocol = lessonProtocol();
  let engine: Engine, server: ReturnType<typeof createLocalServer>, origin = '', token = '', providerCalls = 0;
  const storage = installSyntheticProductionStorage(directory, ['integration'], t.mock);
  const lessonOptions: EngineLessonOptions = {
    targets: protocol.targets,
    evidenceResolver(state, context, reference) {
      assert.equal(reference.kind, 'calculation', 'Only an actual Engine calculation is admitted by this synthetic evidence port.');
      const view: StateStore = { read: () => structuredClone(state), update: async () => { throw Error('Lesson evidence has no write capability.'); } };
      const receipt = engine.services.conversationHistory.currentReceipt(context, reference.id, view);
      return { pin: { kind: 'calculation', id: receipt.id, revision: digest(receipt), digest: digest(receipt), sourceIds: [...receipt.sourceIds], branchIds: [receipt.branch ?? 'main'] },
        available: true, sourceTainted: false,
        sourceMarkings: receipt.sourceIds.map((sourceId: string) => ({ sourceId, marking: 'SYNTHETIC imported calculation fixture, classified safe only by this test protocol.' })),
        summary: 'SYNTHETIC retained Engine calculation; no real evaluation or provider qualification.' };
    },
    ...(options.evaluations === false ? {} : { evaluations: { ...protocol.evaluations,
      assertSourceAccess(context: Context, sourceIds: string[]) { sourceAccess(engine.vault!.read(), context, sourceIds); } } }),
  };
  const engineOptions: EngineOptions = { directory, ...storage,
    gateway: { http: async () => { providerCalls++; throw Error('A provider call is forbidden in this synthetic fixture.'); } },
    ...(options.lessons === false ? {} : { lessons: lessonOptions }) };
  async function start(withLessons = options.lessons !== false) {
    engine = new Engine({ ...engineOptions, lessons: withLessons ? lessonOptions : undefined });
    server = createLocalServer(engine);
    const launch = await server.listen(); origin = launch.origin;
    assert.equal(new URL(origin).hostname, '127.0.0.1');
    const paired = await fetch(`${origin}/api/session`, { headers: { authorization: `Bearer ${launch.token}` } });
    assert.equal(paired.status, 200); token = (await paired.json() as { token: string }).token;
    assert.equal(token, launch.token);
  }
  t.after(async () => {
    // Register before listening/pairing so failed fixture admission still joins
    // the owned listener or Engine before removing its synthetic directory.
    if (server) await server.close(5000);
    else if (engine) await engine.shutdown(5000);
    const target = await realpath(directory), child = relative(base, target);
    assert.equal(dirname(target), base);
    assert.ok(child && !child.startsWith('..') && !isAbsolute(child) && child.startsWith('chausar-integrated-http-'));
    assert.equal(providerCalls, 0);
    await rm(target, { recursive: true, force: true });
  });
  await start();
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  }
  async function rpc(method: string, payload: unknown = {}, bearer = token) {
    const response = await raw(method, payload, bearer);
    assert.equal(response.body.error, undefined, JSON.stringify(response.body)); assert.equal(response.status, 200);
    return response.body.result;
  }
  async function refuse(method: string, payload: unknown, code: string, bearer = token) {
    const response = await raw(method, payload, bearer);
    assert.notEqual(response.status, 200); assert.equal(response.body.result, undefined);
    assert.equal(response.body.error?.code, code, JSON.stringify(response.body)); return response;
  }
  await rpc('workspace.create', { name: 'Synthetic integrated fixture', folder: 'integration', pack: 'ecommerce', demo: false, passphrase: PASSPHRASE });
  assert.equal(engine!.vault!.read().workspace.demo, false);
  async function reopen(withLessons = options.lessons !== false) {
    const previous = engine!, previousToken = token;
    await rpc('workspace.lock'); await server.close(5000); await start(withLessons);
    assert.notEqual(engine, previous, 'Reopen uses a separate fresh Engine instance, not a reused service graph.');
    await refuse('workspace.status', {}, 'UNAUTHENTICATED', previousToken);
    await rpc('workspace.open', { folder: 'integration', passphrase: PASSPHRASE });
  }
  async function complete(original: ScenarioView, bearer = token): Promise<ScenarioView> {
    let view: ScenarioView = await rpc('scenarios.reopen', { scenarioId: original.scenarioId, revisionId: original.revision.id }, bearer);
    for (let step = 0; step <= view.revision.jobs.length; step++) {
      if (view.jobs.every(job => job.status === 'ready')) { assert.equal(view.status, 'complete'); return view; }
      const job = view.revision.jobs.find(candidate => view.jobs.find(item => item.jobId === candidate.id)?.status !== 'ready' &&
        candidate.dependsOn.every(id => view.jobs.find(item => item.jobId === id)?.status === 'ready'));
      assert.ok(job, 'The finite required graph has a topological next job.');
      const run = await rpc('scenarios.beginRun', { scenarioId: view.scenarioId, revisionId: view.revision.id, jobId: job.id }, bearer);
      await rpc('scenarios.evaluate', { scenarioId: view.scenarioId, runId: run.id }, bearer);
      view = await rpc('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id }, bearer);
    }
    assert.fail('Every required job must complete within the finite graph bound.');
  }
  async function prepareLesson() {
    const receipt = await rpc('calculation.run', { operation: 'earned', sourceIds: [SOURCE], branch: 'main', period: PERIOD });
    assert.equal(receipt.totalMinor, '10010');
    // The ordinary calculation legitimately persists its receipt and answer.
    // Capture that business baseline before any private lesson lifecycle write.
    const calculationBusiness = engine!.vault!.read();
    const proposed = await engine!.services.lessons!.propose(OWNER, proposal({
      rationale: 'SYNTHETIC explicit owner fixture choice; this is not inferred from duplicate imports.',
      evidence: [{ kind: 'calculation', id: receipt.id }],
      applicability: { memberId: 'owner', sourceIds: [SOURCE], branchIds: ['main'], conditions: { task: 'weekly-overview' } },
    }));
    const references = protocol.registerEvaluations(pin(proposed.candidate), result => { result.sourceIds = [SOURCE]; });
    return { proposed, references, receipt, calculationBusiness };
  }
  async function approveLesson() {
    const { proposed, references, calculationBusiness } = await prepareLesson();
    assert.equal((await rpc('memory.lessons'))[0].status, 'proposed');
    await assert.rejects(engine!.services.lessons!.review(OWNER, pin(proposed.candidate)), { code: 'LESSON_EVALUATION_BLOCKED' });
    await engine!.services.lessons!.bindEvaluations(OWNER, pin(proposed.candidate), references);
    assert.equal((await rpc('memory.lessons'))[0].status, 'review-ready');
    const reviewed = await engine!.services.lessons!.review(OWNER, pin(proposed.candidate));
    await refuse('memory.decideLesson', { ...decision(reviewed), reviewDigest: '0'.repeat(64) }, 'LESSON_REVIEW_CHANGED');
    const approved: LessonView = await rpc('memory.decideLesson', decision(reviewed));
    assert.equal(approved.status, 'approved');
    for (const set of ['open', 'hidden'] as const) assert.equal(approved.evaluation![set].qualification, SYNTHETIC_QUALIFICATION);
    assert.equal(protocol.target.value, 'overview-first', 'Approving inert guidance does not execute a personal-target change.');
    return { approved, calculationBusiness };
  }
  return { get engine() { return engine!; }, rpc, raw, refuse, reopen, complete, prepareLesson, approveLesson, protocol,
    ciphertext: () => readFile(join(directory, 'integration', 'authority.encrypted.json'), 'utf8'), providerCalls: () => providerCalls };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
function totals(view: ScenarioView): string[] {
  return view.revision.branches.map(branch => {
    const job = view.jobs.find(item => item.jobId === branch.rootJobId); assert.ok(job);
    const result = view.results.find(item => item.runId === (job.runId ?? job.retainedRunId)); assert.ok(result);
    const proof = result.receipt.databaseProof as DatabaseVerification;
    assert.equal(proof?.verified, true, 'The actual production verifier path must accept the independently reduced injected SQL result.');
    assert.equal(proof.engine, 'injected-sql'); assert.equal(proof.receiptId, result.receipt.id);
    return result.receipt.totalMinor;
  });
}
const applicability = { branchId: 'main', sourceIds: [SOURCE], conditions: { task: 'weekly-overview' } };
async function canonical(f: Fixture) { return (await f.rpc('learning.list')).filter((event: any) => event.type === 'decision'); }

test('public canonical import, value-free preview, scenarios and approved lessons survive encrypted fresh Engine reopen and are purged by public source deletion', { timeout: 120000 }, async t => {
  const f = await fixture(t), imported = await f.rpc('sources.import', sales());
  assert.equal(imported.totalsMinor, '10010'); assert.equal(imported.qualification, 'experimental');
  const [event] = await canonical(f); assert.equal(event.recordVersion, 1); assert.equal(event.memberId, 'owner'); assert.equal(event.epoch, 1);
  assert.deepEqual(event.sourceIds, [SOURCE]); assert.deepEqual(event.rowIds, [...imported.rowIds].sort());
  assert.deepEqual(event.importIdentity, { id: imported.id, sourceId: SOURCE, branches: ['main'], format: 'csv', contentHash: imported.contentHash,
    recipeHash: imported.recipeHash, outcome: 'accepted', qualification: 'experimental' });
  const { recordIntegrity, ...record } = event; assert.equal(recordIntegrity, digest(record)); assert.equal(event.integrity, digest(event.input));
  const preview = await f.rpc('learning.preview', { ids: [event.id] });
  const expected = { schema: 'chausar.structure.v1', events: [{ kind: 'mapping', choice: 'accepted', reasonCode: 'reconciliation', fields: [
    { name: 'amount', type: 'decimal' }, { name: 'branch', type: 'string' }, { name: 'currency', type: 'string' }, { name: 'date', type: 'date' },
    { name: 'description', type: 'string' }, { name: 'status', type: 'string' },
  ], reportShape: 'ledger' }] };
  assert.deepEqual(preview.payload, expected); assert.deepEqual(preview.rowIds, [...imported.rowIds].sort());
  for (const value of ['PRIVATE_', '10010', '100.01', '2026-09-10', 'INR', 'main', 'delivered']) assert.equal(JSON.stringify(preview.payload).includes(value), false, value);
  assert.equal((await f.rpc('trust.get')).policy.sharing, false);
  await f.refuse('learning.consent', { id: preview.id, digest: preview.digest }, 'SHARING_DISABLED');
  await f.refuse('learning.share', { id: 'unconfigured' }, 'EXPORT_UNAVAILABLE');
  const view: ScenarioView = await f.rpc('scenarios.create', scenarioInput()), ready = await f.complete(view);
  assert.notEqual(view.revision.branches[1].id, view.revision.branches[2].id);
  assert.deepEqual(totals(ready), ['10010', '11011', '12012']);
  const comparison = await f.rpc('scenarios.finalize', { scenarioId: view.scenarioId, expectedHeadRevisionId: view.revision.id });
  assert.equal(comparison.noAction, true); assert.equal(comparison.requiredJobs.length, 3);
  const business = f.engine.vault!.read();
  assert.deepEqual(business.answers, []); assert.deepEqual(business.receipts, []);
  const { approved, calculationBusiness } = await f.approveLesson();
  assert.equal(f.engine.services.lessons!.applicable(OWNER, applicability).length, 1);
  const after = f.engine.vault!.read(); assert.deepEqual(after.facts, business.facts); assert.deepEqual(after.ontology, business.ontology);
  assert.equal(calculationBusiness.answers.length, 1); assert.equal(calculationBusiness.receipts.length, 1);
  assert.deepEqual(after.answers, calculationBusiness.answers); assert.deepEqual(after.receipts, calculationBusiness.receipts);
  assert.deepEqual(after.actions, business.actions);
  const encrypted = await f.ciphertext();
  for (const value of ['PRIVATE_PRIMARY_CELL_86041', SOURCE, PASSPHRASE, approved.candidate.title]) assert.equal(encrypted.includes(value), false, value);
  await f.reopen();
  assert.deepEqual((await canonical(f))[0], event);
  assert.deepEqual((await f.rpc('learning.preview', { ids: [event.id] })).payload, expected);
  const reopened: ScenarioView = await f.rpc('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id });
  assert.deepEqual(reopened, readyWithComparison(ready, comparison));
  assert.deepEqual((await f.rpc('memory.lessons'))[0], approved);
  assert.equal(f.engine.services.lessons!.applicable(OWNER, applicability).length, 1);
  await f.rpc('sources.delete', { id: SOURCE });
  assert.deepEqual(await canonical(f), []); assert.deepEqual(await f.rpc('memory.lessons'), []);
  assert.ok(!f.engine.vault!.read().learning.some(item => [event.id, preview.id].includes(item.id)));
  assert.deepEqual(f.engine.vault!.read().scenarioRecords, []);
  assert.deepEqual(f.engine.vault!.read().lessonState?.lessons, []); assert.deepEqual(f.engine.vault!.read().lessonState?.episodes, []);
  await f.refuse('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id }, 'SCENARIO_UNAVAILABLE');
  await f.refuse('sources.import', sales(), 'SOURCE_REVOKED');
  await f.reopen(); assert.deepEqual(await canonical(f), []); assert.deepEqual(await f.rpc('memory.lessons'), []);
  assert.equal(f.providerCalls(), 0);
});
function readyWithComparison(view: ScenarioView, comparison: ScenarioView['comparisons'][number]): ScenarioView {
  return { ...view, comparisons: [...view.comparisons, comparison] };
}

test('public scenario graph and assumption changes fence the exact head; retained history stays fixed until explicit recompute, and revoked unselected snapshot sources withhold everything', { timeout: 120000 }, async t => {
  const f = await fixture(t); await f.rpc('sources.import', sales()); await f.rpc('sources.import', otherSales);
  const first: ScenarioView = await f.rpc('scenarios.create', scenarioInput()), firstReady = await f.complete(first);
  const firstComparison = await f.rpc('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: first.revision.id });
  const branch = first.revision.branches[1];
  const graph: ScenarioView = await f.rpc('scenarios.addAnalysis', { scenarioId: first.scenarioId, expectedHeadRevisionId: first.revision.id,
    input: { branchId: branch.id, label: 'Required child', request: { ...scenarioInput().baseline.request, assumptions: { priceChangeBps: '1000' } }, dependsOn: [branch.rootJobId], usesBranchAssumptions: true } });
  assert.equal(graph.revision.mode, 'graph-change'); assert.equal(graph.revision.jobs.length, 4);
  await f.refuse('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: first.revision.id }, 'SCENARIO_HEAD_CHANGED');
  await f.complete(graph);
  const changed: ScenarioView = await f.rpc('scenarios.changeAssumption', { scenarioId: first.scenarioId, expectedHeadRevisionId: graph.revision.id, branchId: branch.id, priceChangeBps: '2500' });
  assert.equal(changed.revision.mode, 'assumption-change');
  await f.refuse('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: graph.revision.id }, 'SCENARIO_HEAD_CHANGED');
  const changedReady = await f.complete(changed); assert.deepEqual(totals(changedReady), ['10010', '12512', '12012']);
  const child = changed.revision.jobs.find(job => job.label === 'Required child')!;
  const childState = changedReady.jobs.find(job => job.jobId === child.id)!;
  assert.equal(changedReady.results.find(result => result.runId === childState.runId)!.receipt.totalMinor, '12512');
  await f.rpc('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: changed.revision.id });
  await f.rpc('sources.import', sales('200.01'));
  const retained: ScenarioView = await f.rpc('scenarios.reopen', { scenarioId: first.scenarioId, revisionId: first.revision.id });
  assert.equal(retained.headRevisionId, changed.revision.id);
  assert.deepEqual(retained.revision, firstReady.revision); assert.deepEqual(retained.jobs, firstReady.jobs);
  assert.deepEqual(retained.results, firstReady.results); assert.deepEqual(retained.comparisons, [firstComparison]);
  assert.deepEqual(totals(retained), ['10010', '11011', '12012']);
  const recomputed: ScenarioView = await f.rpc('scenarios.recompute', { scenarioId: first.scenarioId, expectedHeadRevisionId: changed.revision.id });
  assert.equal(recomputed.revision.mode, 'current-state-recompute'); assert.notEqual(recomputed.revision.evidenceId, changed.revision.evidenceId);
  assert.notEqual(recomputed.revision.evidenceDigest, changed.revision.evidenceDigest);
  const currentReady = await f.complete(recomputed); assert.deepEqual(totals(currentReady), ['20010', '25012', '24012']);
  await f.refuse('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: changed.revision.id }, 'SCENARIO_HEAD_CHANGED');
  assert.equal((await f.rpc('scenarios.finalize', { scenarioId: first.scenarioId, expectedHeadRevisionId: recomputed.revision.id })).noAction, true);
  await f.refuse('scenarios.reopen', { scenarioId: first.scenarioId, revisionId: first.revision.id, custody: f.engine.vault!.read().scenarioRecords }, 'INVALID_SCENARIO');
  const retainedRecord = f.engine.vault!.read().scenarioRecords!;
  assert.equal(retainedRecord.length, 1);
  assert.ok(retainedRecord[0].evidence.every(item => item.state.facts.some(fact => fact.sourceId === OTHER_SOURCE)),
    'The unselected source really belongs to every retained whole snapshot.');
  await f.rpc('trust.update', { allowedSources: [SOURCE] });
  assert.deepEqual(f.engine.vault!.read().scenarioRecords, [], 'Grant denial physically purges the entire private graph, not selected results only.');
  for (const revisionId of [first.revision.id, recomputed.revision.id]) {
    const denied = await f.refuse('scenarios.reopen', { scenarioId: first.scenarioId, revisionId }, 'SCENARIO_UNAVAILABLE');
    assert.equal(JSON.stringify(denied.body).includes('PRIVATE_SECONDARY_CELL_86042'), false);
  }
  await f.reopen();
  assert.deepEqual(f.engine.vault!.read().scenarioRecords, []);
  await f.refuse('scenarios.reopen', { scenarioId: first.scenarioId, revisionId: recomputed.revision.id }, 'SCENARIO_UNAVAILABLE');
});

test('public scenario custody remains private to its author and a revoked author session releases no retained comparison', { timeout: 120000 }, async t => {
  const f = await fixture(t); await f.rpc('sources.import', sales());
  const invitation = await f.rpc('auth.invite', { name: 'Synthetic scenario author', role: 'cofounder', branches: ['main'] });
  const member = await f.rpc('auth.accept', { token: invitation.token });
  const view: ScenarioView = await f.rpc('scenarios.create', scenarioInput(), member.token), ready = await f.complete(view, member.token);
  assert.deepEqual(totals(ready), ['10010', '11011', '12012']);
  await f.rpc('scenarios.finalize', { scenarioId: view.scenarioId, expectedHeadRevisionId: view.revision.id }, member.token);
  await f.refuse('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id }, 'SCENARIO_FORBIDDEN');
  await f.rpc('members.revoke', { id: member.member.id });
  const denied = await f.refuse('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id }, 'UNAUTHENTICATED', member.token);
  assert.equal(denied.status, 401); assert.equal(JSON.stringify(denied.body).includes('10010'), false);
  await f.refuse('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id }, 'SCENARIO_FORBIDDEN');
});

test('lesson approval needs the exact human app review, persisted journals fail closed without installed authorities, and retirement removes applicability without changing the target', { timeout: 120000 }, async t => {
  const f = await fixture(t); await f.rpc('sources.import', sales()); const { approved } = await f.approveLesson();
  const guidance = f.engine.services.lessons!.applicable(OWNER, applicability); assert.equal(guidance.length, 1);
  assert.deepEqual(guidance[0].change, { kind: 'personal-preference', targetId: 'preference-overview', after: 'receipt-first' });
  assert.deepEqual(f.engine.services.lessons!.applicable(OWNER, { ...applicability, conditions: { task: 'urgent-summary' } }), []);
  // Direct trusted service negative: an MCP channel cannot perform the human
  // review/decision. This is deliberately not claimed as an HTTP MCP test.
  await assert.rejects(f.engine.services.lessons!.decideLesson({ ...OWNER, channel: 'mcp' }, decision(approved)), { code: 'APP_LESSON_REVIEW_REQUIRED' });
  await f.reopen(false); const journal = structuredClone(f.engine.vault!.read().lessonState);
  await f.refuse('memory.lessons', {}, 'LESSON_AUTHORITY_REQUIRED');
  await f.refuse('memory.decideLesson', decision(approved), 'LESSON_AUTHORITY_REQUIRED');
  assert.deepEqual(f.engine.vault!.read().lessonState, journal);
  await f.reopen(true); assert.equal((await f.rpc('memory.lessons'))[0].status, 'approved');
  assert.equal(f.engine.services.lessons!.applicable(OWNER, applicability).length, 1);
  const retired = await f.engine.services.lessons!.retire(OWNER, pin(approved.candidate), 'Synthetic owner explicitly retired this test guidance.');
  assert.equal(retired.status, 'retired'); assert.deepEqual(await f.rpc('memory.lessons'), []);
  assert.deepEqual(f.engine.services.lessons!.applicable(OWNER, applicability), []);
  assert.equal(f.protocol.target.value, 'overview-first');
  const events = f.engine.vault!.read().lessonState!.lessons[0].events;
  assert.deepEqual(events.map(event => event.type), ['proposal', 'evaluation', 'review', 'approve', 'retire']);
  await f.reopen(); assert.deepEqual(await f.rpc('memory.lessons'), []);
  assert.deepEqual(f.engine.services.lessons!.applicable(OWNER, applicability), []);
});

test('an absent evaluation authority and the default unconfigured Engine cannot invent reviews or promote lessons', { timeout: 120000 }, async t => {
  const f = await fixture(t, { evaluations: false }); await f.rpc('sources.import', sales());
  const { proposed, references } = await f.prepareLesson();
  await assert.rejects(f.engine.services.lessons!.bindEvaluations(OWNER, pin(proposed.candidate), references), { code: 'EVALUATION_AUTHORITY_REQUIRED' });
  await assert.rejects(f.engine.services.lessons!.review(OWNER, pin(proposed.candidate)), { code: 'LESSON_EVALUATION_BLOCKED' });
  await f.refuse('memory.decideLesson', { candidate: pin(proposed.candidate), reviewId: 'fabricated-review', reviewDigest: '0'.repeat(64), decision: 'approve', reason: 'Synthetic invented review must refuse.' }, 'LESSON_REVIEW_CHANGED');
  assert.equal((await f.rpc('memory.lessons'))[0].status, 'proposed');
  assert.deepEqual(f.engine.vault!.read().lessonState!.lessons[0].events.map(event => event.type), ['proposal']);
  assert.deepEqual(f.engine.services.lessons!.applicable(OWNER, applicability), []);
  await f.reopen(false); await f.refuse('memory.lessons', {}, 'LESSON_AUTHORITY_REQUIRED');
});

test('a fresh default Engine lists no lessons and refuses public promotion without a trusted lesson authority', { timeout: 120000 }, async t => {
  const f = await fixture(t, { lessons: false }); assert.deepEqual(await f.rpc('memory.lessons'), []);
  await f.refuse('memory.decideLesson', { candidate: { id: 'fabricated-candidate', revision: 1, digest: '0'.repeat(64) }, reviewId: 'fabricated-review', reviewDigest: '0'.repeat(64), decision: 'approve', reason: 'Synthetic unauthorized promotion attempt.' }, 'LESSON_AUTHORITY_REQUIRED');
  assert.equal(f.engine.vault!.read().lessonState, undefined);
  assert.equal(f.providerCalls(), 0);
});
