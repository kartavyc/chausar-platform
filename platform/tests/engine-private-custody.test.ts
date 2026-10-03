import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import { authorize, check, ChausarError, type State, type StateStore } from '../runtime/contracts.ts';
import { ExperimentalFileSnapshotAdapter, Vault } from '../runtime/vault.ts';
import { EngineScenarioService, type EngineScenarioOptions } from '../runtime/engine-scenarios.ts';
import { createEngineLessonService } from '../runtime/engine-lessons.ts';
import { TrustService } from '../runtime/trust.ts';
import { compileDictionary, starterPacks } from '../runtime/ontology.ts';
import type { LessonEvidenceResolver, LessonTarget, LessonValue } from '../runtime/lesson-contracts.ts';
import type { ScenarioCreateRequest } from '../runtime/scenario-contracts.ts';
import { digest } from '../runtime/actions.ts';
import { fixture as lessonFixture, OWNER, pin, proposal, SYNTHETIC_QUALIFICATION } from './fixtures/lesson-fixture.ts';

// Actual serialized Vault encryption and producer adapters. Job, target and
// verifier authorities below are synthetic trusted test ports, not qualified
// evaluation, native SQL, public HTTP, model, or business-effect evidence.
const passphrase = 'Synthetic private custody transaction passphrase';
const sourceId = 'source-job';
const cut = '2026-10-03T00:00:00.000Z';
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(accept => { resolve = accept; });
  return { promise, resolve };
}
function business(state: State) {
  const { revision: ignoredRevision, lessonState: ignoredLessons, scenarioRecords: ignoredScenarios, ...retained } = state;
  return retained;
}
function request(label = 'Synthetic private price transaction'): ScenarioCreateRequest {
  return { version: 1, label, baseline: { label: 'Synthetic retained baseline', request: {
    operation: 'scenario', sourceIds: [sourceId], branch: 'main', period: { from: '2026-09-01', to: '2026-09-30' },
    assumptions: { priceChangeBps: '0' }, asOf: cut,
  } }, alternatives: [{ label: 'Synthetic alternative', priceChangeBps: '1000' }] };
}
async function fixture(t: TestContext) {
  const base = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(base, /^C:\\/i);
  const directory = await realpath(await mkdtemp(join(base, 'chausar-private-custody-')));
  assert.equal(dirname(directory), base);
  const adapter = new ExperimentalFileSnapshotAdapter(directory), trusted = lessonFixture({ evaluations: false });
  let vault = (await Vault.create({ directory, storage: adapter, passphrase, name: 'Synthetic encrypted private custody' })).vault;
  t.after(async () => {
    await vault.close();
    const actual = await realpath(directory), child = relative(base, actual);
    assert.equal(dirname(actual), base);
    assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && child.startsWith('chausar-private-custody-'));
    await rm(actual, { recursive: true, force: true });
  });
  await vault.update(state => {
    const dictionary = compileDictionary(starterPacks.find(pack => pack.pack === 'retail')!, 1, OWNER.memberId, cut);
    state.ontology = { current: dictionary, history: [dictionary] };
    state.jobs = structuredClone(trusted.workspace.jobs);
    state.facts = [{ id: 'synthetic-private-sale', entityId: 'synthetic-sale', sourceId, sourceRow: 2, kind: 'sale', branch: 'main',
      validFrom: '2026-09-10', validTo: null, learnedAt: cut, supersededAt: null,
      fields: { amountMinor: '10000', currency: 'INR', status: 'delivered' } }];
  });
  const controls: { onResolve?: (...args: Parameters<LessonEvidenceResolver>) => void;
    onValidate?: (target: LessonTarget, after: LessonValue) => void; targetRevision: number } = { targetRevision: 1 };
  const resolver: LessonEvidenceResolver = (state, ctx, ref) => {
    controls.onResolve?.(state, ctx, ref);
    const job = state.jobs.find(item => item.id === ref.id);
    check(ref.kind === 'job' && job && job.available && job.memberId === ctx.memberId && job.epoch === ctx.epoch,
      'SYNTHETIC_EVIDENCE_UNAVAILABLE', 'Resolve only the explicitly owned synthetic retained job.');
    return { pin: { kind: ref.kind, id: job.id, revision: job.revision, digest: digest(job), sourceIds: [...job.sourceIds], branchIds: [...job.branchIds] },
      available: true, sourceTainted: false, sourceMarkings: structuredClone(job.sourceMarkings), summary: job.summary };
  };
  const targets = { ...trusted.targets, authorityRevision: () => `${trusted.targets.authorityRevision()}:${controls.targetRevision}`,
    validateChange: (ctx: Parameters<typeof trusted.targets.validateChange>[0], target: LessonTarget, after: LessonValue) => {
      trusted.targets.validateChange(ctx, target, after); controls.onValidate?.(target, after);
    } };
  return { get vault() { return vault; }, adapter, directory, controls, trusted, resolver, targets,
    scenarios: (options: Partial<EngineScenarioOptions> = {}) => new EngineScenarioService(vault, { now: () => cut,
      calculatorOptions: view => ({ consumerGuard: ctx => { authorize(view, ctx); }, receiptGuard: ctx => { authorize(view, ctx); } }), ...options }),
    lessons: () => createEngineLessonService(vault, { evidenceResolver: resolver, targets }),
    async reopen() { await vault.close(); vault = await Vault.open({ directory, storage: adapter, passphrase }); },
    ciphertext: () => readFile(join(directory, 'authority.encrypted.json')),
  };
}

test('private scenario retention expiry during actual encrypted commit refuses release without replaying publication', { timeout: 10_000 }, async t => {
  const f = await fixture(t);
  await f.vault.update(state => { state.policy.retentionDays = 1; });
  const before = f.vault.read(), entered = deferred(), release = deferred();
  let clock = cut, commits = 0, releasedResult = false;
  const commit = f.adapter.commit.bind(f.adapter);
  const held = t.mock.method(f.adapter, 'commit', async (...args: Parameters<typeof f.adapter.commit>) => {
    commits++; entered.resolve(); await release.promise; return commit(...args);
  });
  const operation = f.scenarios({ now: () => clock }).create(OWNER, request());
  const refusal = assert.rejects(operation.then(value => { releasedResult = true; return value; }), code('SCENARIO_RETENTION_EXPIRED'));
  try {
    await entered.promise;
    clock = '2026-10-05T00:00:00.000Z';
  } finally { release.resolve(); }
  await refusal; held.mock.restore();
  assert.equal(commits, 1, 'Postcommit refusal must not replay arithmetic or perform another publication.');
  assert.equal(releasedResult, false);
  assert.equal(f.vault.read().revision, before.revision + 1);
  assert.equal(f.vault.read().scenarioRecords?.length, 1, 'An acknowledged encrypted commit remains retained even when its stale result is withheld.');
  assert.deepEqual(business(f.vault.read()), business(before));
});

test('private custody commit failure releases no result and preserves actual encrypted namespaces', async t => {
  for (const kind of ['scenario', 'lesson'] as const) await t.test(kind, async sub => {
    const f = await fixture(sub), before = f.vault.read(), ciphertext = await f.ciphertext();
    const refusal = new ChausarError('SYNTHETIC_COMMIT_REFUSED', 'Synthetic failure before actual encrypted publication.');
    let commitCalls = 0, releasedResult = false;
    const failed = sub.mock.method(f.adapter, 'commit', async (...args: Parameters<typeof f.adapter.commit>) => {
      commitCalls++; assert.equal(args[1], before.revision); throw refusal;
    });
    const operation = kind === 'scenario' ? f.scenarios().create(OWNER, request()) : f.lessons().propose(OWNER, proposal());
    await assert.rejects(operation.then(value => { releasedResult = true; return value; }), error => error === refusal);
    failed.mock.restore();
    assert.equal(commitCalls, 1); assert.equal(releasedResult, false);
    assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
    await f.reopen();
    assert.deepEqual(f.vault.read(), before, 'Fresh unlock must retain the old encrypted state after refused publication.');
  });
});

test('two queued exact-head scenario writes serialize and only one original head can commit', async t => {
  const f = await fixture(t), service = f.scenarios(), original = await service.create(OWNER, request());
  const alternative = original.revision.branches.find(branch => branch.role === 'alternative')!, before = f.vault.read();
  const outcomes = await Promise.allSettled([
    service.changeAssumption(OWNER, original.scenarioId, original.headRevisionId, alternative.id, '2000'),
    service.changeAssumption(OWNER, original.scenarioId, original.headRevisionId, alternative.id, '3000'),
  ]);
  const accepted = outcomes.filter(outcome => outcome.status === 'fulfilled');
  const refused = outcomes.filter(outcome => outcome.status === 'rejected');
  assert.equal(accepted.length, 1); assert.equal(refused.length, 1);
  assert.ok(code('SCENARIO_HEAD_CHANGED')(refused[0].reason));
  const current = f.vault.read(), record = current.scenarioRecords![0];
  assert.equal(current.revision, before.revision + 1); assert.equal(record.revisions.length, 2);
  assert.deepEqual(record.revisions[0], before.scenarioRecords![0].revisions[0]);
  assert.equal(record.headRevisionId, accepted[0].value.headRevisionId);
  assert.deepEqual(business(current), business(before));
});

test('private scenario captures exclude derived namespaces and detach retained callback and result aliases', async t => {
  const f = await fixture(t), lessons = f.lessons(), before = business(f.vault.read());
  await lessons.propose(OWNER, proposal({ title: 'Synthetic first private lesson marker' }));
  const views: StateStore[] = [];
  const scenarios = f.scenarios({ calculatorOptions: view => {
    views.push(view);
    return { consumerGuard: ctx => { authorize(view, ctx); }, receiptGuard: ctx => { authorize(view, ctx); } };
  } });
  const first = await scenarios.create(OWNER, request('Synthetic first private scenario marker'));
  const [second] = await Promise.all([
    scenarios.create(OWNER, request('Synthetic second private scenario marker')),
    lessons.propose(OWNER, proposal({ title: 'Synthetic second private lesson marker' })),
  ]);
  const stored = f.vault.read();
  assert.equal(stored.scenarioRecords?.length, 2); assert.equal(stored.lessonState?.lessons.length, 2);
  for (const record of stored.scenarioRecords!) for (const evidence of record.evidence) {
    assert.equal(Object.hasOwn(evidence.state, 'scenarioRecords'), false);
    assert.equal(Object.hasOwn(evidence.state, 'lessonState'), false);
  }
  assert.ok(views.length > 0);
  const callbackCopy = views[0].read(); callbackCopy.workspace.name = 'Synthetic callback alias mutation';
  callbackCopy.facts[0].fields.amountMinor = '999999';
  await assert.rejects(views[0].update(state => { state.facts = []; }), code('SCENARIO_READ_ONLY'));
  first.revision.branches[0].label = 'Synthetic returned revision alias mutation';
  second.jobs[0].status = 'ready';
  assert.deepEqual(f.vault.read(), stored, 'Neither callback aliases nor released views may change encrypted custody.');
  assert.deepEqual(business(stored), before);
  const ciphertext = (await f.ciphertext()).toString('utf8');
  for (const secret of ['Synthetic first private lesson marker', 'Synthetic first private scenario marker', passphrase])
    assert.equal(ciphertext.includes(secret), false);
});

test('actual encrypted custody refuses malformed or recursively captured private namespaces before publication', async t => {
  const f = await fixture(t);
  await f.lessons().propose(OWNER, proposal());
  await f.scenarios().create(OWNER, request());
  const stored = f.vault.read(), ciphertext = await f.ciphertext();
  assert.ok(stored.lessonState!.lessons.length > 0); assert.ok(stored.scenarioRecords!.length > 0);
  for (const namespace of ['scenarioRecords', 'lessonState'] as const) await t.test(`retained evidence containing ${namespace}`, async () => {
    await assert.rejects(f.vault.update(state => {
      Object.assign(state.scenarioRecords![0].evidence[0].state, { [namespace]: structuredClone(state[namespace]) });
    }), code('INVALID_PRIVATE_STATE'));
    assert.deepEqual(f.vault.read(), stored); assert.deepEqual(await f.ciphertext(), ciphertext);
  });
  for (const namespace of ['scenarioRecords', 'lessonState'] as const) await t.test(`malformed ${namespace}`, async () => {
    await assert.rejects(f.vault.update(state => {
      Object.assign(state, { [namespace]: { undeclaredBusinessState: state.facts } });
    }), code('INVALID_PRIVATE_STATE'));
    assert.deepEqual(f.vault.read(), stored); assert.deepEqual(await f.ciphertext(), ciphertext);
  });
});

test('imported fact fields cannot establish private source existence or additional cleanup grant roots', async t => {
  const f = await fixture(t), trust = new TrustService(f.vault);
  const fakeSource = 'synthetic-source-looking-field', fakeSources = 'synthetic-source-looking-array';
  await f.vault.update(state => {
    state.policy.allowedSources = [sourceId];
    state.facts[0].fields.sourceId = fakeSource;
    state.facts[0].fields.sourceIds = [fakeSources];
  });
  await f.lessons().propose(OWNER, proposal());
  await f.scenarios().create(OWNER, request());
  const retained = f.vault.read();
  assert.equal(retained.scenarioRecords![0].evidence[0].state.facts[0].fields.sourceId, fakeSource);
  assert.deepEqual(retained.scenarioRecords![0].evidence[0].state.facts[0].fields.sourceIds, [fakeSources]);
  const cleaned = await trust.cleanup(OWNER, new Date(cut)), after = f.vault.read();
  assert.equal(cleaned.removed, 0, 'Cleanup needs only the real retained source grant.');
  assert.deepEqual(after.facts, retained.facts); assert.deepEqual(after.imports, retained.imports);
  assert.deepEqual(after.jobs, retained.jobs); assert.deepEqual(after.ontology, retained.ontology);
  assert.deepEqual(after.scenarioRecords, retained.scenarioRecords); assert.deepEqual(after.lessonState, retained.lessonState);
  const ciphertext = await f.ciphertext();
  for (const fake of [fakeSource, fakeSources]) {
    await assert.rejects(trust.deleteSource(OWNER, fake), code('SOURCE_NOT_FOUND'));
    assert.deepEqual(f.vault.read(), after); assert.deepEqual(await f.ciphertext(), ciphertext);
  }
});

test('retention cleanup purges whole private records and episodes without refreshing their old evidence', async t => {
  await t.test('fresh scenario head does not renew its original retained cut', async sub => {
    const f = await fixture(sub);
    let clock = cut;
    const scenarios = f.scenarios({ now: () => clock }), created = await scenarios.create(OWNER, request());
    clock = '2026-10-05T00:00:00.000Z';
    await f.vault.update(state => { state.facts[0].learnedAt = clock; });
    await scenarios.recompute(OWNER, created.scenarioId, created.headRevisionId);
    await f.vault.update(state => { state.policy.retentionDays = 1; });
    const retained = f.vault.read(), record = retained.scenarioRecords![0];
    assert.equal(record.revisions.length, 2); assert.equal(record.evidence.length, 2);
    assert.equal(record.revisions[1].createdAt, clock); assert.equal(record.evidence[0].knowledgeCut, cut);
    const result = await new TrustService(f.vault).cleanup(OWNER, new Date(clock)), cleaned = f.vault.read();
    assert.equal(result.removed, 1); assert.deepEqual(cleaned.scenarioRecords, []);
    assert.deepEqual(cleaned.facts, retained.facts, 'The fresh original source row remains; only complete old private custody expires.');
    assert.deepEqual(cleaned.jobs, retained.jobs);
    assert.ok(cleaned.tombstones.some(marker => marker.kind === 'retention' && marker.privateKind === 'scenario'
      && marker.recordId === record.id && marker.digest === record.digest));
    await f.reopen(); assert.deepEqual(f.vault.read(), cleaned);
  });
  await t.test('lesson and episode age expires even while their original trusted job remains', async sub => {
    const f = await fixture(sub);
    await f.lessons().propose(OWNER, proposal());
    await f.vault.update(state => { state.policy.retentionDays = 1; });
    const retained = f.vault.read(), lessons = retained.lessonState!, originalJob = retained.jobs[0];
    assert.equal(lessons.lessons.length, 1); assert.equal(lessons.episodes.length, 1);
    const latest = Math.max(...lessons.episodes.map(episode => Date.parse(episode.recordedAt)),
      ...lessons.lessons.flatMap(lesson => [...lesson.revisions.map(candidate => Date.parse(candidate.proposedAt)),
        ...lesson.events.map(event => Date.parse(event.at))]));
    const at = new Date(latest + 2 * 86400000);
    await new TrustService(f.vault).cleanup(OWNER, at);
    const cleaned = f.vault.read();
    assert.deepEqual(cleaned.lessonState!.lessons, []); assert.deepEqual(cleaned.lessonState!.episodes, []);
    assert.deepEqual(cleaned.jobs, [originalJob], 'Undated original job custody is not silently replaced or removed.');
    for (const [kind, id] of [['lesson', lessons.lessons[0].id], ['lesson-episode', lessons.episodes[0].id]])
      assert.ok(cleaned.tombstones.some(marker => marker.kind === 'retention' && marker.privateKind === kind && marker.recordId === id));
    // Existing core retention markers may carry contentHash: undefined. The
    // ordinary Vault JSON snapshot omits that optional key; normalize only the
    // expected tombstone representation, preserving all other custody exactly.
    const expectedReopened = { ...cleaned, tombstones: JSON.parse(JSON.stringify(cleaned.tombstones)) };
    await f.reopen(); assert.deepEqual(f.vault.read(), expectedReopened);
  });
});

test('evaluation-only source deletion purges the whole lesson and its owned episodes while retaining unrelated custody', async t => {
  const f = await fixture(t), evaluationSource = 'source-eval';
  // The existing fixture explicitly registers synthetic protocol runs. Binding
  // them exercises the real lifecycle; it certifies no open or hidden suite.
  const lessons = createEngineLessonService(f.vault, {
    evidenceResolver: f.resolver, targets: f.targets, evaluations: f.trusted.evaluations,
  });
  const selected = await lessons.propose(OWNER, proposal({ title: 'Synthetic lesson with evaluation-only deletion root' }));
  const unrelated = await lessons.propose(OWNER, proposal({ title: 'Synthetic unrelated lesson sharing the retained job' }));
  const references = f.trusted.registerEvaluations(pin(selected.candidate));
  const bound = await lessons.bindEvaluations(OWNER, pin(selected.candidate), references);
  assert.equal(bound.evaluation!.open.qualification, SYNTHETIC_QUALIFICATION);
  assert.equal(bound.evaluation!.hidden.qualification, SYNTHETIC_QUALIFICATION);
  assert.deepEqual(bound.evaluation!.open.sourceIds, [evaluationSource]);
  assert.deepEqual(bound.evaluation!.hidden.sourceIds, [evaluationSource]);
  const retained = f.vault.read(), namespace = retained.lessonState!;
  assert.equal(namespace.lessons.length, 2); assert.equal(namespace.episodes.length, 2);
  const selectedRecord = namespace.lessons.find(record => record.id === selected.candidate.id)!;
  const unrelatedRecord = namespace.lessons.find(record => record.id === unrelated.candidate.id)!;
  const selectedEpisodes = namespace.episodes.filter(episode => selected.candidate.episodeIds.includes(episode.id));
  const unrelatedEpisodes = namespace.episodes.filter(episode => unrelated.candidate.episodeIds.includes(episode.id));
  assert.equal(selectedEpisodes.length, 1); assert.equal(unrelatedEpisodes.length, 1);
  for (const record of namespace.lessons) for (const candidate of record.revisions) {
    assert.deepEqual(candidate.applicability.sourceIds, [sourceId]);
    for (const evidence of candidate.evidence) assert.deepEqual(evidence.pin.sourceIds, [sourceId]);
  }
  for (const episode of namespace.episodes) assert.deepEqual(episode.evidence.pin.sourceIds, [sourceId]);
  assert.equal(retained.facts.some(fact => fact.sourceId === evaluationSource), false);
  assert.equal(retained.imports.some(imported => imported.sourceId === evaluationSource), false);
  const deletion = await new TrustService(f.vault).deleteSource(OWNER, evaluationSource), cleaned = f.vault.read();
  assert.equal(deletion.removed, 2, 'Only the selected complete lesson and its candidate-owned episode are removed.');
  assert.deepEqual(cleaned.lessonState!.lessons, [unrelatedRecord]);
  assert.deepEqual(cleaned.lessonState!.episodes, unrelatedEpisodes);
  assert.deepEqual(cleaned.jobs, retained.jobs); assert.deepEqual(cleaned.facts, retained.facts);
  for (const [kind, id] of [['lesson', selectedRecord.id], ['lesson-episode', selectedEpisodes[0].id]])
    assert.ok(cleaned.tombstones.some(marker => marker.privateKind === kind && marker.recordId === id));
  await f.reopen(); assert.deepEqual(f.vault.read(), cleaned);
});

test('zero-row requested source is a private deletion root and malformed receipt lineage cannot commit', async t => {
  const f = await fixture(t), emptySource = 'synthetic-private-request-only-source';
  await f.vault.update(state => { state.facts = []; state.jobs = []; });
  const input = request(); input.baseline.request.sourceIds = [emptySource];
  const scenarios = f.scenarios(), created = await scenarios.create(OWNER, input);
  const run = await scenarios.beginRun(OWNER, created.scenarioId, created.headRevisionId, created.revision.branches[0].rootJobId);
  const result = await scenarios.evaluate(OWNER, created.scenarioId, run.id);
  assert.equal(result.receipt.rows.length, 0); assert.deepEqual(result.receipt.requestedSourceIds, [emptySource]);
  const retained = f.vault.read(), ciphertext = await f.ciphertext();
  assert.deepEqual(retained.facts, []); assert.deepEqual(retained.imports, []); assert.deepEqual(retained.jobs, []);
  assert.ok(retained.scenarioRecords![0].evidence.every(evidence => evidence.state.facts.length === 0 && evidence.state.imports.length === 0));
  await t.test('malformed actual receipt import collection refuses encrypted publication', async () => {
    await assert.rejects(f.vault.update(state => {
      Object.assign(state.scenarioRecords![0].results[0].receipt.coverage, { importIds: 'synthetic-invalid-scalar' });
    }), code('INVALID_PRIVATE_STATE'));
    assert.deepEqual(f.vault.read(), retained); assert.deepEqual(await f.ciphertext(), ciphertext);
  });
  const deletion = await new TrustService(f.vault).deleteSource(OWNER, emptySource), cleaned = f.vault.read();
  assert.equal(deletion.sourceId, emptySource); assert.ok(deletion.removed > 0);
  assert.deepEqual(cleaned.scenarioRecords, []); assert.deepEqual(cleaned.facts, []); assert.deepEqual(cleaned.jobs, []);
  assert.ok(cleaned.tombstones.some(marker => marker.kind === 'source' && marker.sourceId === emptySource));
  await f.reopen(); assert.deepEqual(f.vault.read(), cleaned);
});

test('synthetic SQL-verifier refusal leaves the issued scenario run retryable without new run identity', async t => {
  const f = await fixture(t);
  let verifierCalls = 0;
  const scenarios = f.scenarios({ calculatorOptions: view => ({
    consumerGuard: ctx => { authorize(view, ctx); }, receiptGuard: ctx => { authorize(view, ctx); },
    verifier: async () => {
      verifierCalls++;
      if (verifierCalls === 1) throw new ChausarError('SYNTHETIC_SQL_REFUSED', 'Injected verifier refusal; no SQL is executed.');
      return { qualification: 'synthetic-protocol', nativeSqlExecuted: false };
    },
  }) });
  const created = await scenarios.create(OWNER, request()), baseline = created.revision.branches[0];
  const run = await scenarios.beginRun(OWNER, created.scenarioId, created.headRevisionId, baseline.rootJobId);
  const issued = f.vault.read(), ciphertext = await f.ciphertext();
  await assert.rejects(scenarios.evaluate(OWNER, created.scenarioId, run.id), code('SYNTHETIC_SQL_REFUSED'));
  assert.deepEqual(f.vault.read(), issued); assert.deepEqual(await f.ciphertext(), ciphertext);
  assert.equal(issued.scenarioRecords![0].evaluations[0].jobs[0].activeRunId, run.id);
  const result = await scenarios.evaluate(OWNER, created.scenarioId, run.id), saved = f.vault.read();
  assert.equal(result.runId, run.id); assert.equal(result.runDigest, run.digest);
  assert.equal(saved.scenarioRecords![0].runs.length, 1); assert.equal(saved.scenarioRecords![0].results.length, 1);
  assert.equal(saved.scenarioRecords![0].evaluations[0].jobs[0].status, 'ready');
  assert.equal(verifierCalls, 2, 'The fresh release check must not execute verification a second time.');
  assert.equal(saved.revision, issued.revision + 1); assert.deepEqual(business(saved), business(issued));
});

test('synchronous configured lesson authority withdrawal rolls back the whole encrypted transaction', async t => {
  const f = await fixture(t), before = f.vault.read(), ciphertext = await f.ciphertext();
  let withdrew = false;
  f.controls.onValidate = () => {
    if (!withdrew) { withdrew = true; f.controls.targetRevision++; }
  };
  await assert.rejects(f.lessons().propose(OWNER, proposal()), code('LESSON_AUTHORITY_CHANGED'));
  assert.equal(withdrew, true); assert.deepEqual(f.vault.read(), before); assert.deepEqual(await f.ciphertext(), ciphertext);
});

test('queued private writes recheck durable member deactivation and epoch withdrawal before callback publication', async t => {
  for (const change of ['deactivate', 'epoch'] as const) await t.test(change, async sub => {
    const f = await fixture(sub), entered = deferred(), release = deferred();
    const revocation = f.vault.update(async state => {
      entered.resolve(); await release.promise;
      if (change === 'deactivate') state.members[0].active = false;
      else state.members[0].epoch++;
    });
    await entered.promise;
    const rejected = Promise.allSettled([
      f.scenarios().create(OWNER, request()), f.lessons().propose(OWNER, proposal()),
    ]);
    release.resolve(); await revocation;
    const withdrawn = f.vault.read(), ciphertext = await f.ciphertext(), outcomes = await rejected;
    for (const outcome of outcomes) {
      assert.equal(outcome.status, 'rejected');
      if (outcome.status === 'rejected') assert.ok(code('ACCESS_REVOKED')(outcome.reason));
    }
    assert.deepEqual(f.vault.read(), withdrawn); assert.deepEqual(await f.ciphertext(), ciphertext);
    assert.equal(withdrawn.scenarioRecords, undefined); assert.equal(withdrawn.lessonState, undefined);
  });
});

test('scenario release after held publication observes member and source withdrawals queued before its fresh read', async t => {
  for (const change of ['epoch', 'source'] as const) await t.test(change, async sub => {
    const f = await fixture(sub), entered = deferred(), release = deferred(), before = f.vault.read();
    const commit = f.adapter.commit.bind(f.adapter);
    let commits = 0, releasedResult = false;
    const held = sub.mock.method(f.adapter, 'commit', async (...args: Parameters<typeof f.adapter.commit>) => {
      commits++;
      if (commits === 1) { entered.resolve(); await release.promise; }
      return commit(...args);
    });
    const operation = f.scenarios().create(OWNER, request());
    const refusal = assert.rejects(operation.then(value => { releasedResult = true; return value; }),
      code(change === 'epoch' ? 'ACCESS_REVOKED' : 'SOURCE_REVOKED'));
    await entered.promise;
    const withdraw = f.vault.update(state => {
      if (change === 'epoch') state.members[0].epoch++;
      else state.policy.allowedSources = [];
    });
    release.resolve(); await withdraw; await refusal; held.mock.restore();
    assert.equal(releasedResult, false); assert.equal(commits, 2, 'Only original publication and explicit withdrawal may commit.');
    assert.equal(f.vault.read().revision, before.revision + 2); assert.equal(f.vault.read().scenarioRecords?.length, 1);
    assert.deepEqual(f.vault.read().facts, before.facts);
  });
});

test('lesson callback and result aliases cannot mutate business state or revive an inherited microtask writer', async t => {
  const f = await fixture(t), lessons = f.lessons(), before = business(f.vault.read()), started = deferred(), release = deferred();
  const aliases: State[] = [], targetAliases: LessonTarget[] = [];
  let scheduled = false, complete!: (outcome: { readCode?: string; writeCode?: string }) => void;
  const inherited = new Promise<{ readCode?: string; writeCode?: string }>(resolve => { complete = resolve; });
  f.controls.onValidate = target => { targetAliases.push(target); };
  f.controls.onResolve = state => {
    aliases.push(state);
    assert.throws(() => { state.workspace.name = 'Synthetic attempted resolver business mutation'; }, TypeError);
    assert.throws(() => { state.jobs[0].summary = 'Synthetic attempted nested business mutation'; }, TypeError);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(async () => {
        started.resolve(); await release.promise;
        const outcome: { readCode?: string; writeCode?: string } = {};
        try { lessons.lessons(OWNER); } catch (error) { outcome.readCode = error instanceof ChausarError ? error.code : 'UNTYPED'; }
        try { await lessons.propose(OWNER, proposal()); } catch (error) { outcome.writeCode = error instanceof ChausarError ? error.code : 'UNTYPED'; }
        complete(outcome);
      });
    }
  };
  const result = await lessons.propose(OWNER, proposal()), stored = f.vault.read();
  await started.promise;
  assert.ok(aliases.length > 0); assert.ok(targetAliases.length > 0);
  for (const target of targetAliases) { target.value = 'Synthetic retained target alias mutation'; target.owner.epoch = 999; }
  result.candidate.title = 'Synthetic released result alias mutation';
  result.candidate.evidence[0].summary = 'Synthetic released evidence alias mutation';
  assert.deepEqual(f.vault.read(), stored); assert.deepEqual(business(stored), before);
  await f.vault.update(state => { state.members[0].epoch++; });
  const revoked = f.vault.read(), ciphertext = await f.ciphertext();
  release.resolve();
  assert.deepEqual(await inherited, { readCode: 'ACCESS_REVOKED', writeCode: 'REENTRANT_TRANSACTION' });
  assert.deepEqual(f.vault.read(), revoked); assert.deepEqual(await f.ciphertext(), ciphertext);
});
