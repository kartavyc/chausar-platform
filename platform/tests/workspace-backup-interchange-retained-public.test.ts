import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { digest, sourceAccess } from '../runtime/actions.ts';
import type { Context, StateStore } from '../runtime/contracts.ts';
import { Engine, type EngineOptions } from '../runtime/engine.ts';
import type { EngineLessonOptions } from '../runtime/engine-lessons.ts';
import { demoCsv, demoRecipe } from '../runtime/ingest.ts';
import type { LessonView } from '../runtime/lesson-contracts.ts';
import type { ScenarioCreateRequest, ScenarioView } from '../runtime/scenario-contracts.ts';
import { createLocalServer } from '../runtime/server.ts';
import { workspaceBackupV2Bytes, validateWorkspaceBackupV2, type WorkspaceBackupV2Budgets } from '../runtime/workspace-backup-v2.ts';
import { readHistoricalWorkspaceState, validateWorkspaceInterchange } from '../runtime/workspace-interchange.ts';
import { RETAINED_INTERCHANGE_FORMAT, RETAINED_STATE_PROFILE } from '../runtime/workspace-interchange-contracts.ts';
import { decision, fixture as lessonProtocol, pin, proposal, SYNTHETIC_QUALIFICATION } from './fixtures/lesson-fixture.ts';

// Actual loopback HTTP, Engine services and encrypted experimental-file custody.
// Scenario arithmetic, personal targets and evaluation runs are synthetic source
// evidence. No native SQL, provider, browser or complete portability is qualified.
const OWNER: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const SOURCE = 'demo-export';
const PASSPHRASE = 'Synthetic populated backup interchange passphrase';
const PERIOD = { from: '2026-01-01', to: '2026-12-31' };
const APPLICABLE = { branchId: 'main', sourceIds: [SOURCE], conditions: { task: 'weekly-overview' } };
const budgets: WorkspaceBackupV2Budgets = { maxArchiveUtf8Bytes: 8_000_000, maxEntryBytes: 4_000_000,
  maxTotalEntryBytes: 6_000_000, maxEntries: 100, maxJsonDepth: 128, maxJsonNodes: 100_000 };
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const backupArtifact = (id: string) => `wb2_${sha(id)}_archive`;

async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-retained-public-composition-')));
  const protocol = lessonProtocol();
  let engine: Engine, server: ReturnType<typeof createLocalServer> | undefined;
  let origin = '', token = '', providerCalls = 0;
  const timings: {method: string; elapsedMs: number; status?: number; code?: string}[] = [];
  let pending: {method: string; started: number} | undefined;
  const lessons: EngineLessonOptions = {
    targets: protocol.targets,
    evidenceResolver(state, context, reference) {
      assert.equal(reference.kind, 'calculation', 'Only the actual Engine calculation is synthetic lesson evidence.');
      const view: StateStore = { read: () => structuredClone(state), update: async () => { throw Error('Evidence resolution is read only.'); } };
      const receipt = engine.services.conversationHistory.currentReceipt(context, reference.id, view);
      return { pin: { kind: 'calculation', id: receipt.id, revision: digest(receipt), digest: digest(receipt),
        sourceIds: [...receipt.sourceIds], branchIds: [receipt.branch ?? 'main'] }, available: true, sourceTainted: false,
      sourceMarkings: receipt.sourceIds.map((sourceId: string) => ({ sourceId, marking: 'SYNTHETIC imported calculation admitted only by this test evidence port.' })),
      summary: 'SYNTHETIC exact Engine calculation; no actual model or evaluation qualification.' };
    },
    evaluations: { ...protocol.evaluations,
      assertSourceAccess(context, sourceIds) { sourceAccess(engine.vault!.read(), context, sourceIds); } },
  };
  const options: EngineOptions = { directory, demo: true, storage: 'experimental-file',
    backupCustody: { budgets, filesystemBudgets: { maxFiles: 100, maxBytes: 12_000_000, maxDepth: 16 } },
    gateway: { http: async () => { providerCalls++; throw Error('This source fixture forbids provider transport.'); } } };
  async function start(withLessons = true) {
    engine = new Engine({ ...options, lessons: withLessons ? lessons : undefined });
    server = createLocalServer(engine);
    const launch = await server.listen(); origin = launch.origin; token = launch.token;
    assert.equal(new URL(origin).hostname, '127.0.0.1');
  }
  t.after(async () => {
    t.diagnostic(JSON.stringify({requests: timings, pending: pending && {method: pending.method, elapsedMs: Date.now() - pending.started}}));
    if (server) await server.close(5000);
    else if (engine!) await engine!.shutdown(5000);
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-retained-public-composition-'));
    await rm(actual, { recursive: true, force: true }); assert.equal(providerCalls, 0);
  });
  async function raw(method: string, payload: unknown = {}, bearer = token) {
    const started = Date.now(); pending = {method, started};
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', signal: AbortSignal.timeout(30_000),
      headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any;
    timings.push({method, elapsedMs: Date.now() - started, status: response.status, ...(body.error ? {code: body.error.code} : {})});
    assert.ok(Date.now() - started < 30_000, `${method} exceeded the unchanged per-request deadline.`);
    pending = undefined;
    return { status: response.status, body };
  }
  async function rpc(method: string, payload: unknown = {}) {
    const result = await raw(method, payload);
    assert.equal(result.body.error, undefined, JSON.stringify(result.body)); assert.equal(result.status, 200);
    return result.body.result;
  }
  async function refuse(method: string, payload: unknown, code: string, bearer = token) {
    const result = await raw(method, payload, bearer);
    assert.notEqual(result.status, 200); assert.equal(result.body.result, undefined);
    assert.equal(result.body.error?.code, code, JSON.stringify(result.body));
  }
  await start();
  await rpc('workspace.create', { name: 'Synthetic populated transfer history', pack: 'retail', demo: false, passphrase: PASSPHRASE });
  await rpc('sources.import', { sourceId: SOURCE, format: 'csv', content: demoCsv, recipe: demoRecipe,
    expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  async function complete(original: ScenarioView): Promise<ScenarioView> {
    let view: ScenarioView = await rpc('scenarios.reopen', { scenarioId: original.scenarioId, revisionId: original.revision.id });
    for (let step = 0; step <= view.revision.jobs.length; step++) {
      if (view.jobs.every(job => job.status === 'ready')) return view;
      const job = view.revision.jobs.find(candidate => view.jobs.find(item => item.jobId === candidate.id)?.status !== 'ready'
        && candidate.dependsOn.every(id => view.jobs.find(item => item.jobId === id)?.status === 'ready'));
      assert.ok(job, 'The finite service-produced scenario graph must have a next job.');
      const run = await rpc('scenarios.beginRun', { scenarioId: view.scenarioId, revisionId: view.revision.id, jobId: job.id });
      await rpc('scenarios.evaluate', { scenarioId: view.scenarioId, runId: run.id });
      view = await rpc('scenarios.reopen', { scenarioId: view.scenarioId, revisionId: view.revision.id });
    }
    return assert.fail('The finite scenario graph must complete within its job count.');
  }
  async function populate() {
    const asOf = new Date(Math.max(...engine.vault!.read().facts.map(fact => Date.parse(fact.learnedAt))) + 1).toISOString();
    const request: ScenarioCreateRequest = { version: 1, label: 'Synthetic exact retained comparison',
      baseline: { label: 'Measured retained baseline', request: { operation: 'scenario', sourceIds: [SOURCE], branch: 'main',
        period: PERIOD, assumptions: { priceChangeBps: '00' }, asOf } },
      alternatives: [{ label: 'Same display label', priceChangeBps: '1000' }, { label: 'Same display label', priceChangeBps: '2000' }] };
    const original: ScenarioView = await rpc('scenarios.create', request);
    const completed = await complete(original);
    assert.deepEqual(completed.results.map(result => result.receipt.totalMinor), ['400000', '440000', '480000']);
    await rpc('scenarios.finalize', { scenarioId: original.scenarioId, expectedHeadRevisionId: original.revision.id });
    await rpc('scenarios.changeAssumption', { scenarioId: original.scenarioId, expectedHeadRevisionId: original.revision.id,
      branchId: original.revision.branches[1].id, priceChangeBps: '3000' });
    const historical: ScenarioView = await rpc('scenarios.reopen', { scenarioId: original.scenarioId, revisionId: original.revision.id });
    const receipt = await rpc('calculation.run', { operation: 'earned', sourceIds: [SOURCE], branch: 'main', period: PERIOD, asOf });
    assert.equal(receipt.totalMinor, '400000');
    const proposed = await engine.services.lessons!.propose(OWNER, proposal({ evidence: [{ kind: 'calculation', id: receipt.id }],
      rationale: 'SYNTHETIC explicit owner choice based on this exact Engine receipt.',
      applicability: { memberId: 'owner', sourceIds: [SOURCE], branchIds: ['main'], conditions: APPLICABLE.conditions } }));
    const references = protocol.registerEvaluations(pin(proposed.candidate), result => { result.sourceIds = [SOURCE]; });
    await engine.services.lessons!.bindEvaluations(OWNER, pin(proposed.candidate), references);
    const reviewed = await engine.services.lessons!.review(OWNER, pin(proposed.candidate));
    const approved: LessonView = await rpc('memory.decideLesson', decision(reviewed));
    assert.equal(approved.status, 'approved');
    for (const set of ['open', 'hidden'] as const) assert.equal(approved.evaluation![set].qualification, SYNTHETIC_QUALIFICATION);
    assert.equal(protocol.target.value, 'overview-first', 'Approving guidance cannot execute its target change.');
    return { historical, receipt, approved };
  }
  async function restart(withLessons = true) {
    const previous = engine, previousToken = token;
    await rpc('workspace.lock'); await server!.close(5000); await start(withLessons);
    assert.notEqual(engine, previous, 'Reopen must use a fresh Engine and service graph.');
    await refuse('workspace.status', {}, 'UNAUTHENTICATED', previousToken);
    await rpc('workspace.open', { passphrase: PASSPHRASE });
  }
  const capture = () => engine.vault!.snapshot(() => engine.vault!.captureEncryptedCustody({ maxArtifacts: 99,
    maxEntryBytes: budgets.maxEntryBytes, maxTotalEntryBytes: budgets.maxTotalEntryBytes }));
  const backupText = async (id: string) => (await engine.vault!.readArtifact({ id: backupArtifact(id), purpose: 'workspace-interchange' })).value as { content: string };
  const semantic = (id: string) => engine.services.interchangeLocal.ports.custody.read(OWNER, id);
  return { directory, get engine() { return engine; }, protocol, rpc, refuse, populate, restart, capture, backupText, semantic };
}

test('populated private history composes through public backup, semantic export, inert restore and fresh Engine reopen', { timeout: 180_000 }, async t => {
  const f = await fixture(t), populated = await f.populate(), state = f.engine.vault!.read();
  assert.equal(state.scenarioRecords!.length, 1); assert.equal(state.lessonState!.lessons.length, 1);
  assert.equal(state.scenarioRecords![0].revisions.length, 2); assert.equal(state.scenarioRecords![0].comparisons.length, 1);
  assert.equal(state.lessonState!.lessons[0].events.at(-1)!.type, 'approve');
  const guidance = f.engine.services.lessons!.applicable(OWNER, APPLICABLE);
  assert.equal(guidance.length, 1);
  const original = await f.capture();
  const backup = await f.rpc('workspace.backup.v2.create', { destinationId: 'populated_backup', confirmed: true });
  assert.equal(backup.fullWorkspacePortable, false);
  const backupRead = await f.rpc('workspace.backup.v2.read', { backupId: backup.recordId });
  const savedBackup = await f.backupText(backup.recordId);
  const bytes = workspaceBackupV2Bytes(validateWorkspaceBackupV2(savedBackup.content, backupRead.sourcePin, budgets), budgets);
  assert.deepEqual(Buffer.from(bytes.authority), Buffer.from(original.authority));
  assert.equal(bytes.artifacts.length, original.artifacts.length);
  for (const item of original.artifacts) {
    const retained = bytes.artifacts.find(value => value.ref.id === item.ref.id && value.ref.purpose === item.ref.purpose);
    assert.ok(retained); assert.deepEqual(retained.ref, item.ref); assert.deepEqual(Buffer.from(retained.bytes), Buffer.from(item.bytes));
  }
  const exported = await f.rpc('workspace.interchange.export', { destinationId: 'populated_after_backup', confirmed: true });
  assert.equal(exported.inventory.stores, 28);
  const semantic = await f.semantic(exported.recordId);
  const archive = validateWorkspaceInterchange(semantic.content, semantic.pin.inventory);
  assert.equal(archive.format, RETAINED_INTERCHANGE_FORMAT); assert.equal(archive.inventory.profile.id, RETAINED_STATE_PROFILE);
  assert.equal(archive.stores.find(store => store.manifest.name === 'scenarioRecords')!.manifest.records, 1);
  assert.equal(archive.stores.find(store => store.manifest.name === 'lessonState')!.manifest.records, 1);
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'source-originals' && item.text === demoCsv));
  assert.ok(archive.artifacts.some(item => item.manifest.category === 'mapping-recipes' && item.text === JSON.stringify(demoRecipe)));
  const historical = readHistoricalWorkspaceState(archive);
  assert.deepEqual(historical, state);
  assert.equal(JSON.stringify(historical.scenarioRecords), JSON.stringify(state.scenarioRecords), 'Scenario nested order, IDs, revisions, evidence and receipt pins remain exact.');
  assert.equal(JSON.stringify(historical.lessonState), JSON.stringify(state.lessonState), 'Lesson nested order, episodes, lifecycle events and semantic pins remain exact.');
  const restoreInput = { backupId: backup.recordId, targetId: 'populated_inert', reviewedDigest: backup.archiveDigest };
  const restored = await f.rpc('workspace.backup.v2.restoreInert', { ...restoreInput, confirmed: true });
  const restoredRead = await f.rpc('workspace.backup.v2.readRestored', { ...restoreInput, creationId: restored.creationId });
  assert.deepEqual(restoredRead.receipt, restored); assert.deepEqual(restoredRead.sourcePin, backupRead.sourcePin);
  const inertPath = join(f.directory, restoreInput.targetId, 'backup.inert.json'), inertBytes = await readFile(inertPath);
  assert.equal(JSON.parse(inertBytes.toString('utf8')).content, savedBackup.content);
  assert.equal(JSON.stringify(f.engine.vault!.read()), JSON.stringify(state));
  const sourceCiphertext = await readFile(join(f.engine.vault!.directory, 'authority.encrypted.json'), 'utf8');
  assert.equal(sourceCiphertext.includes(state.scenarioRecords![0].label), false);
  assert.equal(sourceCiphertext.includes(populated.approved.candidate.title), false);
  await f.restart();
  assert.equal(JSON.stringify(f.engine.vault!.read()), JSON.stringify(state), 'Fresh same-owner Engine reopen retains exact custody.');
  assert.deepEqual(await f.rpc('workspace.backup.v2.read', { backupId: backup.recordId }), backupRead);
  assert.deepEqual(await f.rpc('workspace.backup.v2.inspectRestored', restoreInput), restoredRead);
  assert.deepEqual(await f.semantic(exported.recordId), semantic);
  assert.deepEqual(await f.rpc('scenarios.reopen', { scenarioId: populated.historical.scenarioId, revisionId: populated.historical.revision.id }), populated.historical);
  assert.deepEqual((await f.rpc('memory.lessons'))[0], populated.approved);
  assert.deepEqual(f.engine.services.lessons!.applicable(OWNER, APPLICABLE), guidance);
  assert.deepEqual(await f.rpc('receipts.get', { id: populated.receipt.id }), populated.receipt);
  const afterReopen = await f.rpc('workspace.interchange.export', { destinationId: 'populated_after_restart', confirmed: true });
  assert.equal(afterReopen.packageDigest, exported.packageDigest);
  assert.equal((await f.semantic(afterReopen.recordId)).content, semantic.content);
  assert.deepEqual(await readFile(inertPath), inertBytes); assert.deepEqual(await f.backupText(backup.recordId), savedBackup);
  assert.equal(JSON.stringify(f.engine.vault!.read()), JSON.stringify(state));
  assert.equal((await f.rpc('workspace.interchange.diagnostics')).fullWorkspacePortabilityQualified, false);
});

test('fresh Engine without installed lesson authority refuses release of populated backup and semantic history', { timeout: 90_000 }, async t => {
  const f = await fixture(t); await f.populate();
  const backup = await f.rpc('workspace.backup.v2.create', { destinationId: 'retained_authority_backup', confirmed: true });
  await f.restart(false);
  const state = f.engine.vault!.read(), refs = await f.engine.vault!.listArtifacts({ purpose: 'workspace-interchange' });
  await f.refuse('workspace.backup.v2.read', { backupId: backup.recordId }, 'LESSON_AUTHORITY_REQUIRED');
  await f.refuse('workspace.backup.v2.create', { destinationId: 'unsupported_retained_backup', confirmed: true }, 'LESSON_AUTHORITY_REQUIRED');
  await f.refuse('workspace.interchange.export', { destinationId: 'unsupported_retained_export', confirmed: true }, 'LESSON_AUTHORITY_REQUIRED');
  assert.equal(JSON.stringify(f.engine.vault!.read()), JSON.stringify(state));
  assert.deepEqual(await f.engine.vault!.listArtifacts({ purpose: 'workspace-interchange' }), refs);
});

test('changed current lesson evaluation refuses both backup and semantic release after an earlier authenticated backup', { timeout: 90_000 }, async t => {
  const f = await fixture(t); await f.populate();
  const backup = await f.rpc('workspace.backup.v2.create', { destinationId: 'evaluation_original_backup', confirmed: true });
  const state = f.engine.vault!.read(), refs = await f.engine.vault!.listArtifacts({ purpose: 'workspace-interchange' });
  const completed = [...f.protocol.evaluationRuns.values()][0]; assert.ok(completed);
  completed.metrics[0].after += 1; f.protocol.evaluationRuns.set(completed.reference.id, completed);
  await f.refuse('workspace.backup.v2.read', { backupId: backup.recordId }, 'EVALUATION_CHANGED');
  await f.refuse('workspace.backup.v2.create', { destinationId: 'changed_evaluation_backup', confirmed: true }, 'EVALUATION_CHANGED');
  await f.refuse('workspace.interchange.export', { destinationId: 'changed_evaluation_export', confirmed: true }, 'EVALUATION_CHANGED');
  assert.equal(JSON.stringify(f.engine.vault!.read()), JSON.stringify(state));
  assert.deepEqual(await f.engine.vault!.listArtifacts({ purpose: 'workspace-interchange' }), refs);
});
