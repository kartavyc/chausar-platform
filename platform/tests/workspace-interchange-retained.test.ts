import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { authorize, check, ChausarError, hash, type State } from '../runtime/contracts.ts';
import { createEngineLessonService } from '../runtime/engine-lessons.ts';
import { sourceAccess } from '../runtime/actions.ts';
import { TrustService } from '../runtime/trust.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange, inspectWorkspaceInterchange,
  interchangeDigest, readHistoricalWorkspaceState, validateWorkspaceInterchange, workspaceStateProfile,
} from '../runtime/workspace-interchange.ts';
import { WorkspaceInterchangeHost, type WorkspaceInterchangeHostPorts } from '../runtime/workspace-interchange-host.ts';
import {
  INTERCHANGE_FORMAT, RETAINED_INTERCHANGE_FORMAT, RETAINED_STATE_PROFILE, STATE_PROFILE,
} from '../runtime/workspace-interchange-contracts.ts';
import { artifactsFor, deterministicShopState, emptyTarget } from './fixtures/workspace-interchange-fixture.ts';
import { pin } from './fixtures/lesson-fixture.ts';
import {
  retainedApplicable, retainedInterchangeFixture, retainedOwner, retainedSource,
} from './fixtures/workspace-interchange-retained-fixture.ts';

// Functional synthetic service/codec fixtures only. Encrypted Vault operations
// are actual Node custody; no native SQL, browser, provider or full-product claim.
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
type Fixture = Awaited<ReturnType<typeof retainedInterchangeFixture>>;
function reseal(value: ReturnType<typeof inspectWorkspaceInterchange>) {
  const { digest: ignored, ...body } = value;
  value.digest = interchangeDigest(body);
  return canonicalInterchangeJson(value);
}

/** Existing Host orchestration with current real scenario/lesson release gates.
 * Explicit open output stays in test memory. These ports certify no installed
 * LOCAL CONTROL inventory, archive custody, target activation or native host. */
function guardedHost(f: Fixture, lessonService = f.lessons()) {
  const outputs = new Map<string, string>();
  let releases = 0;
  const unused = async (): Promise<never> => { throw Error('This fixture admits only explicit in-memory open export.'); };
  const ports: WorkspaceInterchangeHostPorts = {
    async withSource(context, _expected, work) {
      return f.vault.snapshot(async state => {
        const identity = f.vault.readIdentity();
        return work({ ready: true, state, artifacts: artifactsFor(state),
          async assertCompleteOwner(ctx, historical) {
            const member = authorize(f.store, ctx, 'admin');
            check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Complete test export requires current owner scope.');
            sourceAccess(f.vault.read(), ctx, [...new Set(historical.facts.map(fact => fact.sourceId))]);
            const scenarioCurrent = f.scenarios().assertInterchangeRead(ctx, historical);
            if (historical.lessonState) lessonService.assertInterchangeRead(ctx, historical.lessonState,
              { at: f.exportClock, days: f.vault.read().policy.retentionDays });
            scenarioCurrent();
            releases++;
          },
          async assertCurrent() {
            assert.deepEqual(f.vault.readIdentity(), identity);
            assert.deepEqual(context, retainedOwner);
          },
        });
      });
    },
    withTarget: unused,
    custody: { create: unused, read: unused, remove: unused },
    plaintext: {
      async create(_context, input, assertCurrent) {
        await assertCurrent();
        assert.equal(outputs.has(input.destinationId), false);
        outputs.set(input.destinationId, input.text);
        await assertCurrent();
        return { utf8Bytes: Buffer.byteLength(input.text), creationId: input.creationId };
      },
      async remove(_context, input) { outputs.delete(input.destinationId); },
    },
  };
  const host = new WorkspaceInterchangeHost(ports);
  return { outputs, releases: () => releases,
    async export(destinationId = 'synthetic_retained_open') {
      return host.exportPlaintext(retainedOwner, { destinationId, confirmed: true });
    },
  };
}

test('namespace absence stays exact legacy v1; empty presence explicitly selects versioned v2', () => {
  for (const present of [[], ['scenarioRecords'], ['lessonState'], ['scenarioRecords', 'lessonState']]) {
    const state = deterministicShopState();
    if (present.includes('scenarioRecords')) state.scenarioRecords = [];
    if (present.includes('lessonState')) state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
    const capture = captureWorkspaceInterchange(state, artifactsFor(state));
    assert.equal(capture.package.format, present.length ? RETAINED_INTERCHANGE_FORMAT : INTERCHANGE_FORMAT);
    assert.equal(capture.inventory.profile.id, present.length ? RETAINED_STATE_PROFILE : STATE_PROFILE);
    assert.deepEqual(capture.inventory.profile, workspaceStateProfile(state));
    assert.equal(capture.inventory.stores.length, 26 + present.length);
    const wire = encodeWorkspaceInterchange(capture.package);
    const accepted = validateWorkspaceInterchange(wire, capture.inventory);
    assert.equal(encodeWorkspaceInterchange(accepted), wire);
    const restored = readHistoricalWorkspaceState(accepted);
    assert.deepEqual(restored, state);
    for (const name of ['scenarioRecords', 'lessonState']) assert.equal(Object.hasOwn(restored, name), present.includes(name));
    if (present.includes('scenarioRecords')) assert.equal(capture.inventory.stores.find(store => store.name === 'scenarioRecords')!.records, 0);
    if (present.includes('lessonState')) assert.equal(capture.inventory.stores.find(store => store.name === 'lessonState')!.records, 1);
  }
  assert.equal(workspaceStateProfile().stores.length, 28, 'Fresh target enumeration must include both known retained namespaces.');
});

test('version/profile mismatches, unknown namespaces and malformed empty namespaces still refuse', () => {
  const legacy = deterministicShopState();
  const extended: State = { ...legacy, scenarioRecords: [], lessonState: { workspaceId: legacy.workspace.id, episodes: [], lessons: [] } };
  for (const unknown of [[], undefined]) {
    const state = { ...extended, unknownRetainedNamespace: unknown } as State;
    assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_STORES'));
  }
  for (const bad of [{ workspaceId: extended.workspace.id, episodes: [], lessons: [], hidden: [] },
    { workspaceId: 'different-workspace', episodes: [], lessons: [] }, undefined, null]) {
    const state = { ...extended, lessonState: bad } as State;
    assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), error => error instanceof ChausarError
      && ['INTERCHANGE_STORES', 'INTERCHANGE_STATE'].includes(error.code));
  }
  for (const bad of [undefined, null, {}]) {
    const state = { ...extended, scenarioRecords: bad } as State;
    assert.throws(() => captureWorkspaceInterchange(state, artifactsFor(state)), code('INTERCHANGE_STORES'));
  }
  for (const state of [legacy, extended]) {
    const packed = captureWorkspaceInterchange(state, artifactsFor(state)).package;
    packed.format = state === legacy ? RETAINED_INTERCHANGE_FORMAT : INTERCHANGE_FORMAT;
    assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), code('INTERCHANGE_FORMAT'));
  }
  const packed = captureWorkspaceInterchange(extended, artifactsFor(extended)).package;
  packed.inventory.profile.stores.push({ name: 'unknownRetainedNamespace', kind: 'collection' });
  assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), code('INTERCHANGE_PROFILE'));
});

test('legacy archives retain exact legacy target-proof compatibility; v2 requires retained namespace enumeration', () => {
  const legacy = deterministicShopState(), extended: State = { ...legacy, scenarioRecords: [],
    lessonState: { workspaceId: legacy.workspace.id, episodes: [], lessons: [] } };
  const target = emptyTarget();
  target.profile = workspaceStateProfile(legacy);
  target.stores = target.profile.stores.map(store => ({ name: store.name, records: 0 }));
  assert.equal(target.stores.length, 26);
  const legacyCapture = captureWorkspaceInterchange(legacy, artifactsFor(legacy));
  const extendedCapture = captureWorkspaceInterchange(extended, artifactsFor(extended));
  let currentCapture = legacyCapture;
  const service = new WorkspaceImportCandidateService({
    source: () => ({ ready: true, inventory: currentCapture.inventory }), target: () => target,
    assertCompleteRead(context, historical) {
      const member = authorize({ read: () => historical, update: async () => { throw Error('Candidate history is inert.'); } }, context, 'admin');
      assert.equal(member.role, 'owner'); assert.ok(member.branches.includes('*'));
      sourceAccess(historical, context, historical.facts.map(fact => fact.sourceId));
    },
  });
  const prepared = service.prepare(retainedOwner, { text: encodeWorkspaceInterchange(legacyCapture.package), targetId: target.targetId });
  assert.equal(prepared.archive.format, INTERCHANGE_FORMAT);
  assert.deepEqual(service.review(retainedOwner, { id: prepared.id, reviewedDigest: interchangeDigest(prepared) }), prepared);
  currentCapture = extendedCapture;
  assert.throws(() => service.prepare(retainedOwner, { text: encodeWorkspaceInterchange(extendedCapture.package), targetId: target.targetId }),
    code('INTERCHANGE_PROFILE'));
  target.profile = workspaceStateProfile();
  target.stores = target.profile.stores.map(store => ({ name: store.name, records: 0 }));
  const supported = service.prepare(retainedOwner, { text: encodeWorkspaceInterchange(extendedCapture.package), targetId: target.targetId });
  assert.equal(supported.archive.format, RETAINED_INTERCHANGE_FORMAT);
  assert.deepEqual(service.review(retainedOwner, { id: supported.id, reviewedDigest: interchangeDigest(supported) }), supported);
});

test('capture refuses malformed State accessors before any getter can run', () => {
  const state = deterministicShopState(), artifacts = artifactsFor(state), workspace = state.workspace;
  let getterRuns = 0;
  Object.defineProperty(state, 'workspace', { enumerable: true, configurable: true,
    get() { getterRuns++; return workspace; } });
  assert.throws(() => captureWorkspaceInterchange(state, artifacts), code('INTERCHANGE_JSON'));
  assert.equal(getterRuns, 0);
});

test('real scenario and approved lesson export/read retain exact nested JSON, lifecycle history, answers and pins', async t => {
  const f = await retainedInterchangeFixture(t), original = f.vault.read(), host = guardedHost(f);
  assert.equal(original.scenarioRecords!.length, 1); assert.equal(original.lessonState!.lessons.length, 1);
  const record = original.scenarioRecords![0], lesson = original.lessonState!.lessons[0];
  assert.equal(record.revisions.length, 2); assert.equal(record.comparisons.length, 1); assert.equal(record.results.length, 3);
  // Existing demo source has main-branch earned sales 100000 + 300000;
  // the fixture alternatives independently imply +10% and +20% answers.
  assert.deepEqual(record.results.map(result => result.receipt.totalMinor), ['400000', '440000', '480000']);
  assert.equal(new Set(record.revisions[0].branches.map(branch => branch.id)).size, 3);
  assert.equal(f.populated!.approved.status, 'approved');
  assert.equal(f.lessons().applicable(retainedOwner, retainedApplicable).length, 1);
  const summary = await host.export();
  assert.equal(summary.encrypted, false); assert.ok(host.releases() >= 4);
  const wire = host.outputs.get('synthetic_retained_open')!, capture = f.capture();
  const accepted = validateWorkspaceInterchange(wire, capture.inventory), historical = readHistoricalWorkspaceState(accepted);
  assert.equal(accepted.format, RETAINED_INTERCHANGE_FORMAT);
  assert.equal(JSON.stringify(historical.scenarioRecords), JSON.stringify(original.scenarioRecords));
  assert.equal(JSON.stringify(historical.lessonState), JSON.stringify(original.lessonState));
  assert.equal(hash(historical.scenarioRecords), hash(original.scenarioRecords));
  assert.equal(hash(historical.lessonState), hash(original.lessonState));
  assert.deepEqual(historical.scenarioRecords![0].results.map(result => result.receipt.totalMinor), record.results.map(result => result.receipt.totalMinor));
  assert.deepEqual(historical.scenarioRecords![0].comparisons[0].requiredJobs, record.comparisons[0].requiredJobs);
  assert.deepEqual(historical.lessonState!.lessons[0].events, lesson.events);
  assert.equal(encodeWorkspaceInterchange(accepted), wire);
  assert.deepEqual(f.vault.read(), original, 'Export and release checks cannot write retained custody.');
  const ciphertext = await readFile(join(f.directory, 'authority.encrypted.json'), 'utf8');
  assert.equal(ciphertext.includes(record.label), false); assert.equal(ciphertext.includes(f.populated!.approved.candidate.title), false);
});

test('ordinary encrypted reopen preserves scenario selections, lesson guidance and subsequent exact export', async t => {
  const f = await retainedInterchangeFixture(t), first = f.populated!.historical;
  const before = f.vault.read(), view = await f.scenarios().reopen(retainedOwner, first.scenarioId, first.revision.id);
  const guidance = f.lessons().applicable(retainedOwner, retainedApplicable), wire = encodeWorkspaceInterchange(f.capture().package);
  await f.reopen();
  assert.equal(JSON.stringify(f.vault.read()), JSON.stringify(before));
  assert.deepEqual(await f.scenarios().reopen(retainedOwner, first.scenarioId, first.revision.id), view);
  assert.deepEqual(f.lessons().applicable(retainedOwner, retainedApplicable), guidance);
  const host = guardedHost(f); await host.export();
  assert.equal(host.outputs.get('synthetic_retained_open'), wire);
});

test('historical scenario cuts require their original source and recipe bodies after current import removal', async t => {
  const f = await retainedInterchangeFixture(t), historicalOnly = f.vault.read();
  historicalOnly.imports = []; historicalOnly.facts = [];
  assert.ok(historicalOnly.scenarioRecords![0].evidence[0].state.imports.length > 0);
  for (const missing of ['source_demo', 'recipe_demo']) {
    const artifacts = artifactsFor(historicalOnly);
    artifacts.artifacts = artifacts.artifacts.filter(item => item.id !== missing);
    assert.throws(() => captureWorkspaceInterchange(historicalOnly, artifacts), code('INTERCHANGE_IMPORT_MATERIAL'));
  }
  const capture = captureWorkspaceInterchange(historicalOnly, artifactsFor(historicalOnly));
  const restored = readHistoricalWorkspaceState(validateWorkspaceInterchange(encodeWorkspaceInterchange(capture.package), capture.inventory));
  assert.deepEqual(restored.imports, []);
  assert.equal(JSON.stringify(restored.scenarioRecords), JSON.stringify(historicalOnly.scenarioRecords));
});

test('public source deletion purges both namespaces to explicit empties that round trip and reopen', async t => {
  const f = await retainedInterchangeFixture(t), trust = new TrustService(f.store);
  await trust.deleteSource(retainedOwner, retainedSource);
  await trust.deleteSource(retainedOwner, 'source-job');
  const state = f.vault.read();
  assert.deepEqual(state.scenarioRecords, []);
  assert.deepEqual(state.lessonState, { workspaceId: state.workspace.id, episodes: [], lessons: [] });
  const host = guardedHost(f); await host.export();
  const restored = readHistoricalWorkspaceState(inspectWorkspaceInterchange(host.outputs.get('synthetic_retained_open')!));
  assert.deepEqual(restored.scenarioRecords, []); assert.deepEqual(restored.lessonState, state.lessonState);
  assert.equal(Object.hasOwn(restored, 'scenarioRecords'), true); assert.equal(Object.hasOwn(restored, 'lessonState'), true);
  await f.reopen(); assert.deepEqual(f.vault.read().scenarioRecords, []); assert.deepEqual(f.vault.read().lessonState, state.lessonState);
});

test('changed scenario artifacts cannot pass real retained release checks during export', async t => {
  const f = await retainedInterchangeFixture(t), host = guardedHost(f);
  await f.vault.update(state => { state.scenarioRecords![0].label = 'Synthetic changed retained label'; });
  await assert.rejects(host.export(), code('SCENARIO_ARTIFACT_CHANGED'));
  assert.equal(host.outputs.size, 0);
});

test('a later scenario readiness callback cannot withdraw an earlier scenario receipt during the same export read', async t => {
  const f = await retainedInterchangeFixture(t), first = f.vault.read().scenarioRecords![0];
  const firstReceipt = first.results[0].receipt.id, secondCut = '2026-10-03T01:00:00.000Z';
  f.setClock(secondCut);
  await f.scenarios().create(retainedOwner, { version: 1, label: 'Synthetic second scenario readiness withdrawal',
    baseline: { label: 'Second retained baseline', request: { ...first.revisions[0].jobs[0].authoredRequest, asOf: secondCut } },
    alternatives: [{ label: 'Second retained alternative', priceChangeBps: '1000' }] });
  let ready = true, generation = 1, firstReceiptReads = 0, withdrawals = 0;
  f.scenarioOptions.discoveryAuthorityRevision = () => String(generation);
  f.scenarioOptions.calculatorOptions = view => ({
    consumerGuard(context, request) {
      authorize(view, context);
      if (request.asOf === secondCut && ready) { ready = false; generation++; withdrawals++; }
    },
    receiptGuard(context, receipt) {
      authorize(view, context);
      if (receipt.id === firstReceipt) {
        check(ready, 'SOURCE_NOT_READY', 'The first retained receipt was withdrawn by a later scenario readiness callback.');
        firstReceiptReads++;
      }
    },
  });
  const host = guardedHost(f);
  await assert.rejects(host.export(), error => error instanceof ChausarError
    && ['SCENARIO_AUTHORITY_CHANGED', 'SOURCE_NOT_READY'].includes(error.code));
  assert.ok(firstReceiptReads > 0, 'The earlier receipt was actually checked before withdrawal.');
  assert.equal(withdrawals, 1); assert.equal(ready, false);
  assert.equal(host.releases(), 0, 'The same complete-read pass must refuse before accepting any namespace release.');
  assert.equal(host.outputs.size, 0);
});

test('lesson evidence callbacks cannot withdraw previously checked scenario readiness before export release', async t => {
  const f = await retainedInterchangeFixture(t), firstReceipt = f.vault.read().scenarioRecords![0].results[0].receipt.id;
  let ready = true, generation = 1, firstReceiptReads = 0, withdrawals = 0;
  f.scenarioOptions.discoveryAuthorityRevision = () => String(generation);
  f.scenarioOptions.calculatorOptions = view => ({
    consumerGuard(context) { authorize(view, context); },
    receiptGuard(context, receipt) {
      authorize(view, context);
      if (receipt.id === firstReceipt) {
        check(ready, 'SOURCE_NOT_READY', 'A lesson evidence callback withdrew this retained scenario receipt.');
        firstReceiptReads++;
      }
    },
  });
  const originalResolver = f.lessonOptions.evidenceResolver;
  f.lessonOptions.evidenceResolver = (state, context, reference) => {
    const result = originalResolver(state, context, reference);
    if (ready) { ready = false; generation++; withdrawals++; }
    return result;
  };
  const host = guardedHost(f);
  await assert.rejects(host.export(), error => error instanceof ChausarError
    && ['SCENARIO_AUTHORITY_CHANGED', 'SOURCE_NOT_READY'].includes(error.code));
  assert.ok(firstReceiptReads > 0); assert.equal(withdrawals, 1); assert.equal(ready, false);
  assert.equal(host.releases(), 0, 'Scenario authority must remain current through the lesson read in the same pass.');
  assert.equal(host.outputs.size, 0);
});

test('changed lesson source evidence cannot pass real exact-evidence release checks during export', async t => {
  const f = await retainedInterchangeFixture(t), host = guardedHost(f);
  await f.vault.update(state => { state.jobs.find(job => job.id === 'job-synthetic-1')!.summary += ' changed'; });
  await assert.rejects(host.export(), code('LESSON_EVIDENCE_CHANGED'));
  assert.equal(host.outputs.size, 0);
});

test('canonical-equivalent nested key reordering cannot substitute exact retained custody', async t => {
  const f = await retainedInterchangeFixture(t), historical = f.vault.read();
  const assumptions = historical.scenarioRecords![0].results[0].receipt.assumptions;
  historical.scenarioRecords![0].results[0].receipt.assumptions = Object.fromEntries(Object.entries(assumptions).reverse());
  assert.equal(interchangeDigest(historical.scenarioRecords), interchangeDigest(f.vault.read().scenarioRecords));
  assert.notEqual(JSON.stringify(historical.scenarioRecords), JSON.stringify(f.vault.read().scenarioRecords));
  assert.throws(() => f.scenarios().assertInterchangeRead(retainedOwner, historical), code('SCENARIO_ARTIFACT_CHANGED'));
});

test('retired lessons remain exact exportable history and retain their historical evaluation checks', async t => {
  const f = await retainedInterchangeFixture(t), lesson = f.lessons();
  await lesson.retire(retainedOwner, pin(f.populated!.approved.candidate), 'Synthetic explicit retirement after review.');
  assert.deepEqual(lesson.lessons(retainedOwner), []);
  assert.deepEqual(lesson.applicable(retainedOwner, retainedApplicable), []);
  const original = f.vault.read().lessonState!, host = guardedHost(f);
  await host.export();
  const restored = readHistoricalWorkspaceState(inspectWorkspaceInterchange(host.outputs.get('synthetic_retained_open')!));
  assert.equal(JSON.stringify(restored.lessonState), JSON.stringify(original));
  const result = [...f.protocol.evaluationRuns.values()][0]; result.metrics[0].after += 1;
  f.protocol.evaluationRuns.set(result.reference.id, result);
  await assert.rejects(guardedHost(f).export(), code('EVALUATION_CHANGED'));
});

for (const sourceId of [retainedSource, 'source-job', 'source-eval']) {
  test(`revoked ${sourceId} evidence still retained in custody refuses export`, async t => {
    const f = await retainedInterchangeFixture(t), host = guardedHost(f);
    // Keep original custody to exercise current release refusal independently
    // from public source deletion, which correctly purges the namespaces.
    await f.vault.update(state => { state.sourceRules.push({ id: 'synthetic-revocation', sourceId, revoked: true }); });
    assert.equal(f.vault.read().scenarioRecords!.length, 1); assert.equal(f.vault.read().lessonState!.lessons.length, 1);
    await assert.rejects(host.export(), code('SOURCE_REVOKED'));
    assert.equal(host.outputs.size, 0);
  });
}

test('expired retained evidence refuses export through the existing retention gates', async t => {
  const f = await retainedInterchangeFixture(t), host = guardedHost(f);
  f.setClock('2100-01-01T00:00:00.000Z');
  await assert.rejects(host.export(), code('SCENARIO_RETENTION_EXPIRED'));
  assert.equal(host.outputs.size, 0);
});

test('expired lesson lifecycle refuses export independently from scenario retention', async t => {
  const f = await retainedInterchangeFixture(t), host = guardedHost(f);
  await f.vault.update(state => { state.scenarioRecords = []; });
  f.setClock('2100-01-01T00:00:00.000Z');
  await assert.rejects(host.export(), code('LESSON_RETENTION_EXPIRED'));
  assert.equal(host.outputs.size, 0);
});

test('changed completed evaluation bodies refuse export of an otherwise approved lesson', async t => {
  const f = await retainedInterchangeFixture(t), host = guardedHost(f);
  const result = [...f.protocol.evaluationRuns.values()][0];
  result.metrics[0].after += 1;
  f.protocol.evaluationRuns.set(result.reference.id, result);
  await assert.rejects(host.export(), code('EVALUATION_CHANGED'));
  assert.equal(host.outputs.size, 0);
});

test('unsupported installed scenario evidence and absent evaluation authority stay unsupported for export', async t => {
  const f = await retainedInterchangeFixture(t);
  const missingEvaluations = createEngineLessonService(f.store, { ...f.lessonOptions, evaluations: undefined });
  const noEvaluations = guardedHost(f, missingEvaluations);
  await assert.rejects(noEvaluations.export(), code('EVALUATION_AUTHORITY_REQUIRED'));
  assert.equal(noEvaluations.outputs.size, 0);
  f.scenarioOptions.calculatorOptions = () => ({
    consumerGuard() { throw new ChausarError('SOURCE_NOT_READY', 'This synthetic source has no installed readiness evidence.'); },
    receiptGuard() { throw new ChausarError('SOURCE_NOT_READY', 'This synthetic receipt has no installed readiness evidence.'); },
  });
  const noScenarioEvidence = guardedHost(f);
  await assert.rejects(noScenarioEvidence.export(), code('SOURCE_NOT_READY'));
  assert.equal(noScenarioEvidence.outputs.size, 0);
});
