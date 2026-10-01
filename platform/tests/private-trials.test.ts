import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, type State } from '../runtime/contracts.ts';
import { ImportService } from '../runtime/ingest.ts';
import { PrivateTrialService, privateTrialReceiptDifferences } from '../runtime/private-trials.ts';
import type { PrivateTrialEvaluation, PrivateTrialHost, PrivateTrialPromotionRequest, PrivateTrialRequest, PrivateTrialStrategy } from '../runtime/private-trial-contracts.ts';
import {
  CLOCK, CUT, OWNER, SyntheticTrialStore, definitionChange, recipeFixture, saveQuestions, savedRequest,
  syntheticFact, syntheticHost,
} from './fixtures/private-trial-fixture.ts';

// Source-only acceptance: all evidence, clocks, identities and authority stores are synthetic.
// Passing these checks does not qualify Vault custody, native arithmetic, a GUI, models or live connectors.
async function setup() {
  const store = new SyntheticTrialStore(); const savedAnswerIds = await saveQuestions(store);
  const fixture = syntheticHost(store); const service = new PrivateTrialService(fixture.live, fixture.host);
  const request: PrivateTrialRequest = { version: 1, savedAnswerIds, change: definitionChange(store) };
  return { store, fixture, service, request };
}
async function evaluated(value: Awaited<ReturnType<typeof setup>>) {
  const fork = value.fixture.retainFork(await value.service.create(OWNER, value.request));
  const evaluation = value.fixture.retainEvaluation(await value.service.evaluate(OWNER, fork.id));
  return { fork, evaluation };
}
function totals(evaluation: PrivateTrialEvaluation) {
  return evaluation.comparisons.map(comparison => {
    assert.equal(comparison.baseline.status, 'calculated'); assert.equal(comparison.candidate.status, 'calculated');
    if (comparison.baseline.status !== 'calculated' || comparison.candidate.status !== 'calculated') throw new Error('Expected calculated synthetic receipts.');
    return [comparison.baseline.receipt.totalMinor, comparison.candidate.receipt.totalMinor, comparison.totalDeltaMinor];
  });
}
function promotion(value: Awaited<ReturnType<typeof setup>>, trialId: string, evaluationDigest: string, strategy: PrivateTrialStrategy): PrivateTrialPromotionRequest {
  const impact = value.service.promotionImpact(OWNER, trialId, strategy);
  return { trialId, evaluationDigest, strategy, acknowledgedImpactDigest: impact.digest };
}
function isRefusal(error: unknown): boolean { return error instanceof Error && typeof (error as Error & { code?: string }).code === 'string'; }
function reseal(record: { digest: string }) { const { digest: ignored, ...body } = record; record.digest = hash(body); }

test('receipt comparison keeps exact JSON pointers, absence/null distinction and identity-only classification', () => {
  assert.deepEqual(privateTrialReceiptDifferences(
    { id: 'baseline', createdAt: 'old-time', nested: { 'amount/~': '900719925474099400' }, retainedNull: null, figures: [{ minor: '1' }] },
    { id: 'candidate', createdAt: 'new-time', nested: { 'amount/~': '100' }, newNull: null, figures: [{ minor: '2' }] },
  ), [
    { path: '/id', baselinePresent: true, candidatePresent: true, baseline: 'baseline', candidate: 'candidate', category: 'receipt-identity' },
    { path: '/createdAt', baselinePresent: true, candidatePresent: true, baseline: 'old-time', candidate: 'new-time', category: 'receipt-identity' },
    { path: '/nested/amount~1~0', baselinePresent: true, candidatePresent: true, baseline: '900719925474099400', candidate: '100', category: 'meaning-or-evidence' },
    { path: '/retainedNull', baselinePresent: true, candidatePresent: false, baseline: null, candidate: null, category: 'meaning-or-evidence' },
    { path: '/figures/0/minor', baselinePresent: true, candidatePresent: true, baseline: '1', candidate: '2', category: 'meaning-or-evidence' },
    { path: '/newNull', baselinePresent: false, candidatePresent: true, baseline: null, candidate: null, category: 'meaning-or-evidence' },
  ]);
});

test('definition trial replays three identical saved requests with exact large integer differences and unchanged live authority', async () => {
  const value = await setup(); const before = value.store.read(); const updates = value.store.updates;
  const { fork, evaluation } = await evaluated(value);
  assert.equal(fork.workspaceId, before.workspace.id); assert.equal(fork.memberId, OWNER.memberId); assert.equal(fork.epoch, OWNER.epoch);
  assert.equal(fork.createdAt, CLOCK); assert.equal(fork.interpretation, 'restated-private-diagnostic');
  assert.equal(fork.baselinePin.dictionaryVersion, 7); assert.equal(fork.candidatePin.dictionaryVersion, 8);
  assert.equal(fork.baselinePin.dictionaryHash, before.ontology.current.hash);
  assert.notEqual(fork.baselinePin.dictionaryHash, fork.candidatePin.dictionaryHash);
  assert.equal(fork.baselinePin.factsDigest, fork.candidatePin.factsDigest);
  assert.equal(fork.baselinePin.importsDigest, fork.candidatePin.importsDigest);
  assert.equal(fork.baselinePin.sourceRulesDigest, fork.candidatePin.sourceRulesDigest);
  assert.equal(fork.baselinePin.identityDigest, fork.candidatePin.identityDigest);
  const baselineDefinitions = fork.baseline.ontology.current.definitions as { name: string }[];
  const candidateDefinitions = fork.candidate.ontology.current.definitions as { name: string }[];
  assert.deepEqual(baselineDefinitions.filter(item => item.name !== 'billed'), candidateDefinitions.filter(item => item.name !== 'billed'));
  assert.equal(fork.candidate.ontology.current.definitions.find((item: { name: string }) => item.name === 'billed').field, 'taxMinor');
  assert.deepEqual(fork.savedRequests.map(item => item.request), before.answers.map(item => item.request));
  assert.deepEqual(evaluation.comparisons.map(item => item.request), before.answers.map(item => item.request));
  assert.deepEqual(evaluation.comparisons.map(item => item.requestDigest), fork.savedRequests.map(item => item.requestDigest));
  // Hand worked: 900719925474099325 + 75 = 900719925474099400; 30 + 70 = 100.
  assert.deepEqual(totals(evaluation), [['900719925474099400', '100', '-900719925474099300'], ['7000', '7000', '0'], ['12500', '12500', '0']]);
  assert.ok(evaluation.comparisons[0].differences.some(item => item.path === '/totalMinor' && item.baseline === '900719925474099400' && item.candidate === '100' && item.category === 'meaning-or-evidence'));
  assert.equal(evaluation.comparisons[0].meaningChanged, true);
  assert.deepEqual(evaluation.comparisons[0].figures, [{ key: 'total', baselineMinor: '900719925474099400', candidateMinor: '100', deltaMinor: '-900719925474099300' }]);
  assert.equal(evaluation.qualification, 'isolated-source-replay'); assert.equal(evaluation.interpretation, 'restated-private-diagnostic');
  assert.deepEqual(fork.restrictions, { actions: false, outbound: false, liveAuthorityWrites: false, nativeQualification: false });
  assert.equal(fork.cost.diskBytes, null); assert.ok(fork.cost.serializedForkBytes > 0); assert.ok(fork.cost.preparationElapsedMs >= 0);
  assert.equal(evaluation.cost.diskBytes, null); assert.ok(evaluation.cost.serializedReceiptBytes > 0); assert.ok(evaluation.cost.evaluationElapsedMs >= 0);
  assert.equal(fork.cost.serializedForkBytes, Buffer.byteLength(JSON.stringify(fork)));
  assert.equal(evaluation.cost.serializedReceiptBytes, Buffer.byteLength(JSON.stringify(evaluation.comparisons)));
  assert.ok(evaluation.limitations.length > 0);
  assert.deepEqual(value.service.read(OWNER, fork.id), evaluation);
  assert.deepEqual(value.store.read(), before); assert.equal(value.store.updates, updates);
  assert.ok(value.fixture.calls.some(call => call.side === 'candidate' && call.dictionaryHash === fork.candidatePin.dictionaryHash));
});

test('historical source precedence restates the saved knowledge cuts instead of silently moving questions to the trial clock', async () => {
  const store = new SyntheticTrialStore();
  store.state.facts = [
    syntheticFact('claim-A', 'invoice', '10000', { entityId: 'shared-invoice', sourceId: 'A' }),
    syntheticFact('claim-B', 'invoice', '20000', { entityId: 'shared-invoice', sourceId: 'B' }),
  ];
  store.state.sourceRules = [{ id: 'synthetic-rule-A', kind: 'invoice', sourceIds: ['A', 'B'], at: '2026-09-01T00:00:00.000Z', by: 'owner' }];
  const cuts = ['2026-09-10T00:00:00.000Z', '2026-09-20T00:00:00.000Z', CUT];
  const savedAnswerIds = await saveQuestions(store, cuts.map(asOf => savedRequest('billed', { asOf, sourceIds: ['A', 'B'] })));
  const fixture = syntheticHost(store); const service = new PrivateTrialService(fixture.live, fixture.host); const before = store.read();
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: { type: 'source-precedence', kind: 'invoice', sourceIds: ['B', 'A'] } }));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.deepEqual(totals(evaluation), cuts.map(() => ['10000', '20000', '10000']));
  assert.deepEqual(evaluation.comparisons.map(item => item.request.asOf), cuts);
  assert.equal(fork.candidate.sourceRules.at(-1).at, cuts[0]);
  for (const comparison of evaluation.comparisons) {
    assert.equal(comparison.candidate.status, 'calculated');
    if (comparison.candidate.status === 'calculated') assert.deepEqual(comparison.candidate.receipt.rowIds, ['claim-B']);
  }
  assert.deepEqual(store.read(), before);
});

test('recipe trial remaps cancellation while preserving the reconciled source total and original fact identities', async () => {
  const input = recipeFixture(); const savedAnswerIds = await saveQuestions(input.store);
  const fixture = syntheticHost(input.store, input.evidence); const service = new PrivateTrialService(fixture.live, fixture.host); const before = input.store.read();
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.deepEqual(totals(evaluation), [['30000', '10000', '-20000'], ['0', '0', '0'], ['0', '0', '0']]);
  assert.equal(fork.candidateMappingRefusal, null);
  assert.equal(fork.baselinePin.recipes.length, 1); assert.equal(fork.candidatePin.recipes.length, 1);
  assert.notEqual(fork.baselinePin.recipes[0].digest, fork.candidatePin.recipes[0].digest);
  assert.deepEqual(fork.candidate.facts.map(fact => fact.id), before.facts.map(fact => fact.id));
  assert.equal(fork.candidate.imports[0].totalsMinor, '30000'); assert.equal(fork.candidate.imports[0].coverage.reconciled, true);
  const comparison = evaluation.comparisons[0];
  if (comparison.candidate.status !== 'calculated') throw new Error('Expected cancellation-remapped receipt.');
  assert.deepEqual(comparison.candidate.receipt.rowIds, ['synthetic-mapped-1']);
  assert.ok(comparison.candidate.receipt.exclusions.some(item => item.rowId === 'synthetic-mapped-2' && /cancelled/.test(item.reason)));
  assert.deepEqual(input.store.read(), before);
});

test('candidate recipe reconciliation refusal remains explicit and cannot become a promotion proposal', async () => {
  const input = recipeFixture();
  if (input.change.type !== 'recipe') throw new Error('Expected recipe change.');
  input.change.replacement.bindings.find(binding => binding.target === 'amountMinor')!.moneyUnit = 'major';
  const savedAnswerIds = await saveQuestions(input.store); const fixture = syntheticHost(input.store, input.evidence);
  const service = new PrivateTrialService(fixture.live, fixture.host); const before = input.store.read();
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }));
  assert.ok(fork.candidateMappingRefusal?.errors.some(error => error.code === 'SOURCE_TOTAL_MISMATCH'));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.ok(evaluation.comparisons.every(item => item.baseline.status === 'calculated' && item.candidate.status === 'refused' && item.totalDeltaMinor === null));
  assert.throws(() => service.proposePromotion(OWNER, { trialId: fork.id, evaluationDigest: evaluation.digest, strategy: 'prospective', acknowledgedImpactDigest: 'unacknowledged' }), isRefusal);
  assert.deepEqual(input.store.read(), before);
});

test('complete recipe replay preserves deduplicated claim identities across every retained export generation', async () => {
  const input = recipeFixture();
  const second = structuredClone(input.evidence.captures[0]);
  second.importId = 'synthetic-retained-import-2'; second.generation = 2;
  second.input.content = 'id,date,amount,status\r\nI-2,2026-09-11,20000,CANCEL\r\nI-1,2026-09-10,10000,OPEN\r\n';
  second.factIds.reverse();
  input.evidence.captures.push(second);
  input.store.state.imports.push({ ...structuredClone(input.store.state.imports[0]), id: second.importId, generation: 2, contentHash: hash(second.input.content), rowIds: second.factIds });
  const savedAnswerIds = await saveQuestions(input.store); const fixture = syntheticHost(input.store, input.evidence);
  const service = new PrivateTrialService(fixture.live, fixture.host); const before = input.store.read();
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.deepEqual(totals(evaluation), [['30000', '10000', '-20000'], ['0', '0', '0'], ['0', '0', '0']]);
  assert.equal(fork.recipeEvidence[0].captures.length, 2);
  assert.deepEqual(fork.candidate.imports.map(item => item.rowIds), [['synthetic-mapped-1', 'synthetic-mapped-2'], ['synthetic-mapped-2', 'synthetic-mapped-1']]);
  assert.equal(fork.candidate.facts.length, 2, 'Retained exports do not multiply deduplicated evidence claims.');
  assert.deepEqual(fork.candidate.facts.map(fact => fact.sourceRow), before.facts.map(fact => fact.sourceRow), 'Export occurrence positions do not rewrite producer-owned fact identity.');
  assert.deepEqual(input.store.read(), before);
});

test('historical captures replay their own retained recipe versions before the one candidate replacement', async () => {
  const input = recipeFixture(); const current = input.evidence.captures[0];
  current.generation = 2; input.store.state.imports[0].generation = 2;
  const historical = structuredClone(current); historical.importId = 'synthetic-historical-recipe-import'; historical.generation = 1;
  historical.input.recipe!.ignoredFields = ['historical-unused-field'];
  const oldPreview = new ImportService(input.store).preview(OWNER, historical.input); assert.equal(oldPreview.accepted, true);
  const oldFacts = oldPreview.facts.map((fact, index) => ({ ...fact, id: `synthetic-historical-claim-${index + 1}`, validTo: fact.validTo ?? null, learnedAt: '2026-09-01T00:00:00.000Z', supersededAt: null }));
  historical.factIds = oldFacts.map(fact => fact.id); input.store.state.facts.unshift(...oldFacts);
  input.store.state.imports.unshift({ ...structuredClone(input.store.state.imports[0]), id: historical.importId, generation: 1, recipeHash: oldPreview.recipeHash, rowIds: historical.factIds });
  input.evidence.captures.unshift(historical);
  const savedAnswerIds = await saveQuestions(input.store); const fixture = syntheticHost(input.store, input.evidence);
  const service = new PrivateTrialService(fixture.live, fixture.host); const before = input.store.read();
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.deepEqual(totals(evaluation), [['30000', '10000', '-20000'], ['0', '0', '0'], ['0', '0', '0']]);
  assert.equal(fork.candidate.facts.length, 4); assert.equal(fork.recipeEvidence[0].captures.length, 2);
  assert.deepEqual(input.store.read(), before);
});

test('recipe custody must cover every generation and exactly match retained import/fact evidence', async () => {
  const corruptions: { change: (evidence: ReturnType<typeof recipeFixture>['evidence']) => void; code: string }[] = [
    { change: evidence => { evidence.captures[0].input.content += 'I-3,2026-09-12,1,OPEN\n'; }, code: 'TRIAL_RECIPE_CUSTODY_CHANGED' },
    { change: evidence => { evidence.captures[0].factIds.reverse(); }, code: 'TRIAL_RECIPE_CUSTODY_CHANGED' },
    { change: evidence => { evidence.captures[0].generation = 2; }, code: 'TRIAL_RECIPE_CUSTODY_CHANGED' },
    { change: evidence => { evidence.captures = []; }, code: 'TRIAL_RECIPE_CUSTODY_REQUIRED' },
    { change: evidence => { evidence.captures[0].input.expectedTotals = { rowCount: 2, amountMinor: '99999' }; }, code: 'TRIAL_RECIPE_CUSTODY_CHANGED' },
    { change: evidence => { (evidence.captures[0] as { complete: boolean }).complete = false; }, code: 'TRIAL_INCOMPLETE_GENERATION' },
  ];
  for (const corrupt of corruptions) {
    const input = recipeFixture(); const savedAnswerIds = await saveQuestions(input.store); corrupt.change(input.evidence);
    const fixture = syntheticHost(input.store, input.evidence); const service = new PrivateTrialService(fixture.live, fixture.host);
    await assert.rejects(service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }), { code: corrupt.code });
  }
  const input = recipeFixture(); const savedAnswerIds = await saveQuestions(input.store);
  input.store.state.imports.push({ ...structuredClone(input.store.state.imports[0]), id: 'unrepresented-generation', generation: 2 });
  const fixture = syntheticHost(input.store, input.evidence); const service = new PrivateTrialService(fixture.live, fixture.host);
  await assert.rejects(service.create(OWNER, { version: 1, savedAnswerIds, change: input.change }), { code: 'TRIAL_INCOMPLETE_GENERATION' });
});

test('saved requests must retain explicit matching knowledge cuts and aging dates', async () => {
  const mutations = [
    { change: (state: State) => { delete state.answers[0].request.asOf; }, code: 'TRIAL_UNPINNED_REQUEST' },
    { change: (state: State) => { state.answers[0].request.asOf = '2026-09-01T00:00:00.000Z'; }, code: 'TRIAL_UNPINNED_REQUEST' },
    { change: (state: State) => { state.answers[0].request.operation = 'received'; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.receipts[0].stale = true; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.answers[0].stale = true; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.receipts[0].dictionaryHash = 'old-dictionary'; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.answers[0].request.period = { from: '2026-08-01', to: '2026-08-31' }; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.answers[0].request.comparePeriod = { from: '2026-08-01', to: '2026-08-31' }; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.answers[0].request.branch = 'other-branch'; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
    { change: (state: State) => { state.answers[0].request.sourceIds = ['synthetic-register', 'other-source']; }, code: 'TRIAL_SAVED_REQUEST_CHANGED' },
  ];
  for (const mutate of mutations) {
    const value = await setup(); mutate.change(value.store.state);
    await assert.rejects(value.service.create(OWNER, value.request), { code: mutate.code });
  }
  const store = new SyntheticTrialStore();
  const savedAnswerIds = await saveQuestions(store, [savedRequest('aging', { onDate: '2026-09-30' })]);
  delete store.state.answers[0].request.onDate;
  const fixture = syntheticHost(store); const service = new PrivateTrialService(fixture.live, fixture.host);
  await assert.rejects(service.create(OWNER, { version: 1, savedAnswerIds, change: definitionChange(store) }), { code: 'TRIAL_SAVED_REQUEST_CHANGED' });
  for (const [request, change] of [
    [savedRequest('aging', { onDate: '2026-09-30' }), (state: State) => { state.answers[0].request.onDate = '2026-09-29'; }],
    [savedRequest('scenario', { assumptions: { priceChangeBps: '1000' } }), (state: State) => { state.answers[0].request.assumptions.priceChangeBps = '2000'; }],
  ] as const) {
    const scoped = new SyntheticTrialStore(); const ids = await saveQuestions(scoped, [request]); change(scoped.state);
    const scopedFixture = syntheticHost(scoped); const scopedService = new PrivateTrialService(scopedFixture.live, scopedFixture.host);
    await assert.rejects(scopedService.create(OWNER, { version: 1, savedAnswerIds: ids, change: definitionChange(scoped) }), { code: 'TRIAL_SAVED_REQUEST_CHANGED' });
  }
});

test('scenario replay preserves the exact saved textual assumption while checking its normalized receipt value', async () => {
  const store = new SyntheticTrialStore();
  const savedAnswerIds = await saveQuestions(store, [savedRequest('scenario', { assumptions: { priceChangeBps: '00500' } })]);
  const fixture = syntheticHost(store); const service = new PrivateTrialService(fixture.live, fixture.host);
  const fork = fixture.retainFork(await service.create(OWNER, { version: 1, savedAnswerIds, change: definitionChange(store) }));
  const evaluation = fixture.retainEvaluation(await service.evaluate(OWNER, fork.id));
  assert.equal(evaluation.comparisons[0].request.assumptions?.priceChangeBps, '00500');
  assert.deepEqual(totals(evaluation), [['13125', '13125', '0']]);
});

test('trial request accepts exactly one typed data change and no outbound/action execution fields', async () => {
  const value = await setup(); const before = value.store.read();
  const invalid = [
    { ...value.request, version: 2 }, { ...value.request, savedAnswerIds: [] },
    { ...value.request, savedAnswerIds: [value.request.savedAnswerIds[0], value.request.savedAnswerIds[0]] },
    { ...value.request, outbound: true }, { ...value.request, action: { type: 'publish' } },
    { ...value.request, change: [value.request.change] },
    { ...value.request, change: { ...value.request.change, script: 'arbitrary-code' } },
    { ...value.request, change: { type: 'definition', name: 'billed', replacement: { ...definitionChange(value.store).replacement, name: 'received' } } },
  ];
  for (const request of invalid) await assert.rejects(value.service.create(OWNER, request as PrivateTrialRequest), isRefusal);
  await assert.rejects(value.service.create({ ...OWNER, sourceTainted: true }, value.request), { code: 'TRIAL_TAINTED_CONTEXT' });
  assert.deepEqual(value.store.read(), before);
});

test('both consumer and receipt readiness guards are mandatory on each view', async () => {
  for (const absent of ['consumerGuard', 'receiptGuard'] as const) {
    const value = await setup();
    const host: PrivateTrialHost = { ...value.fixture.host, calculatorGuards: (view, context) => {
      const guards = value.fixture.host.calculatorGuards(view, context);
      delete (guards as Partial<typeof guards>)[absent]; return guards;
    } };
    const service = new PrivateTrialService(value.fixture.live, host);
    await assert.rejects(service.create(OWNER, value.request), { code: 'TRIAL_READINESS_REQUIRED' });
  }
  const value = await setup(); let verifierCalls = 0;
  const host: PrivateTrialHost = { ...value.fixture.host, calculatorGuards: (view, context) => ({
    ...value.fixture.host.calculatorGuards(view, context), verifier: async () => { verifierCalls++; return {}; },
  }) };
  const service = new PrivateTrialService(value.fixture.live, host);
  await assert.rejects(service.create(OWNER, value.request), { code: 'TRIAL_READINESS_REQUIRED' });
  assert.equal(verifierCalls, 0, 'The private source evaluator has no database/native verifier port.');
  const asyncHost: PrivateTrialHost = { ...value.fixture.host, calculatorGuards: (view, context) => ({
    ...value.fixture.host.calculatorGuards(view, context), consumerGuard: async () => {},
  }) };
  await assert.rejects(new PrivateTrialService(value.fixture.live, asyncHost).create(OWNER, value.request), { code: 'TRIAL_READINESS_REQUIRED' });
});

test('candidate readiness uses candidate semantics, including changed definition before evaluation', async () => {
  const value = await setup();
  value.fixture.controls.consumerHook = (view, context) => {
    if (context.side === 'candidate') {
      const billed = view.read().ontology.current.definitions.find((item: { name: string }) => item.name === 'billed');
      assert.equal(billed.field, 'taxMinor'); assert.equal(value.store.read().ontology.current.definitions[0].field, 'amountMinor');
    }
  };
  const fork = value.fixture.retainFork(await value.service.create(OWNER, value.request));
  value.fixture.controls.blocked = { phase: 'evaluate', side: 'candidate', kind: 'consumer' };
  await assert.rejects(value.service.evaluate(OWNER, fork.id), { code: 'SYNTHETIC_READINESS_REVOKED' });
  assert.ok(value.fixture.calls.some(call => call.phase === 'evaluate' && call.side === 'candidate' && call.kind === 'consumer'));
});

test('artifact authentication cannot return an unawaited promise at the trial use boundary', async () => {
  const value = await setup(); const { fork } = await evaluated(value);
  const host: PrivateTrialHost = { ...value.fixture.host, assertArtifactAuthentic: async () => {} };
  const service = new PrivateTrialService(value.fixture.live, host);
  await assert.rejects(service.evaluate(OWNER, fork.id), { code: 'TRIAL_READINESS_REQUIRED' });
  assert.throws(() => service.read(OWNER, fork.id), { code: 'TRIAL_READINESS_REQUIRED' });
});

test('read and promotion recheck both current baseline and candidate readiness guards', async () => {
  for (const phase of ['read', 'promote'] as const) {
    for (const side of ['baseline', 'candidate'] as const) {
      for (const kind of ['consumer', 'receipt'] as const) {
        const value = await setup(); const { fork, evaluation } = await evaluated(value);
        const request = promotion(value, fork.id, evaluation.digest, 'prospective');
        value.fixture.controls.blocked = { phase, side, kind };
        if (phase === 'read') assert.throws(() => value.service.read(OWNER, fork.id), { code: 'SYNTHETIC_READINESS_REVOKED' });
        else assert.throws(() => value.service.proposePromotion(OWNER, request), { code: 'SYNTHETIC_READINESS_REVOKED' });
      }
    }
  }
});

test('permission epoch, source and branch revocation block evaluation, reads and promotion', async () => {
  const mutations = [
    { change: (state: State) => { state.members[0].epoch++; }, code: 'ACCESS_REVOKED' },
    { change: (state: State) => { state.members[0].active = false; }, code: 'ACCESS_REVOKED' },
    { change: (state: State) => { state.policy.allowedSources = ['unrelated-source']; }, code: 'SOURCE_REVOKED' },
    { change: (state: State) => { state.sourceRules.push({ sourceId: 'synthetic-register', revoked: true }); }, code: 'SOURCE_REVOKED' },
    { change: (state: State) => { state.members[0].branches = ['other-branch']; }, code: 'FORBIDDEN_BRANCH' },
  ];
  for (const mutate of mutations) {
    const value = await setup(); const { fork, evaluation } = await evaluated(value);
    const request = promotion(value, fork.id, evaluation.digest, 'prospective'); mutate.change(value.store.state);
    await assert.rejects(value.service.evaluate(OWNER, fork.id), { code: mutate.code });
    assert.throws(() => value.service.read(OWNER, fork.id), { code: mutate.code });
    assert.throws(() => value.service.proposePromotion(OWNER, request), { code: mutate.code });
  }
});

test('changed dictionary, fact, import, source rule, identity and saved evidence pin refuse a stale base', async () => {
  const mutations = [
    (state: State) => { state.ontology.current.definitions[0].meaning += ' Changed live meaning.'; },
    (state: State) => { state.facts[0].fields.amountMinor = '1'; },
    (state: State) => { state.imports.push({ id: 'new-live-import', rowIds: ['invoice-huge'] }); },
    (state: State) => { state.sourceRules.push({ kind: 'invoice', sourceIds: ['synthetic-register'], at: CLOCK }); },
    (state: State) => { state.merges.push({ id: 'live-merge', type: 'merge', entityIds: ['C', 'C2'], targetId: 'C', at: CLOCK }); },
    (state: State) => { state.receipts[0].totalMinor = '1'; },
    (state: State) => { state.answers[0].request.asOf = CLOCK; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = await setup(); const { fork, evaluation } = await evaluated(value);
    const request = promotion(value, fork.id, evaluation.digest, 'prospective'); mutate(value.store.state);
    const code = index < 5 ? 'TRIAL_STALE_BASE' : 'TRIAL_SAVED_REQUEST_CHANGED';
    await assert.rejects(value.service.evaluate(OWNER, fork.id), { code });
    assert.throws(() => value.service.read(OWNER, fork.id), { code });
    assert.throws(() => value.service.proposePromotion(OWNER, request), { code });
  }
});

test('promotion requires explicit strategy and complete acknowledged restatement impact while preserving historical receipts', async () => {
  const value = await setup(); const before = value.store.read(); const { fork, evaluation } = await evaluated(value);
  const prospective = value.service.promotionImpact(OWNER, fork.id, 'prospective');
  const retrospective = value.service.promotionImpact(OWNER, fork.id, 'retrospective');
  assert.equal(prospective.strategy, 'prospective'); assert.equal(retrospective.strategy, 'retrospective');
  assert.notEqual(prospective.digest, retrospective.digest); assert.notEqual(prospective.restatement, retrospective.restatement);
  assert.deepEqual(retrospective.historicalReceiptIdsToPreserve, before.receipts.map(item => item.id));
  assert.ok(retrospective.affectedSavedAnswerIds.includes(before.answers[0].id));
  assert.deepEqual(retrospective.affectedArtifactIds, ['synthetic-dependent-report']);
  assert.deepEqual(retrospective.rebuildArtifactIds, ['synthetic-dependent-report']);
  assert.throws(() => value.service.proposePromotion(OWNER, { trialId: fork.id, evaluationDigest: evaluation.digest, strategy: 'retrospective', acknowledgedImpactDigest: prospective.digest }), { code: 'TRIAL_IMPACT_NOT_ACKNOWLEDGED' });
  assert.throws(() => value.service.proposePromotion(OWNER, { trialId: fork.id, evaluationDigest: 'changed-evaluation', strategy: 'prospective', acknowledgedImpactDigest: prospective.digest }), { code: 'TRIAL_PROMOTION_REFUSED' });
  assert.throws(() => value.service.proposePromotion(OWNER, { trialId: fork.id, evaluationDigest: evaluation.digest, acknowledgedImpactDigest: prospective.digest } as PrivateTrialPromotionRequest), { code: 'TRIAL_RESTATEMENT_REQUIRED' });
  for (const strategy of ['prospective', 'retrospective'] as const) {
    const proposal = value.service.proposePromotion(OWNER, promotion(value, fork.id, evaluation.digest, strategy));
    assert.equal(proposal.type, 'private-trial-promotion-proposal-v1'); assert.equal(proposal.requiresAtomicHostPublication, true);
    assert.equal(proposal.evaluationDigest, evaluation.digest); assert.deepEqual(proposal.change, fork.change);
    assert.equal(proposal.impact.strategy, strategy); value.service.assertPromotionCurrent(OWNER, proposal);
  }
  assert.deepEqual(value.store.read(), before);
});

test('active dependency work or incomplete inventory blocks promotion and current-proposal authorization', async () => {
  const value = await setup(); const { fork, evaluation } = await evaluated(value);
  const request = promotion(value, fork.id, evaluation.digest, 'prospective');
  const proposal = value.service.proposePromotion(OWNER, request);
  value.fixture.controls.impact.activeWorkIds = ['synthetic-running-investigation'];
  assert.throws(() => value.service.proposePromotion(OWNER, promotion(value, fork.id, evaluation.digest, 'prospective')), { code: 'TRIAL_ACTIVE_WORK' });
  assert.throws(() => value.service.assertPromotionCurrent(OWNER, proposal), isRefusal);
  value.fixture.controls.impact.activeWorkIds = [];
  (value.fixture.controls.impact as { complete: boolean }).complete = false;
  assert.throws(() => value.service.promotionImpact(OWNER, fork.id, 'prospective'), { code: 'TRIAL_IMPACT_REQUIRED' });
});

test('resealing incomplete or changed comparison data cannot authorize a promotion', async () => {
  const value = await setup(); const { fork, evaluation } = await evaluated(value);
  const retained = value.fixture.custody.get(fork.id)!;
  retained.evaluation!.comparisons = []; reseal(retained.evaluation!);
  assert.throws(() => value.service.read(OWNER, fork.id), { code: 'SYNTHETIC_ARTIFACT_UNAUTHENTIC' });
  retained.evaluation = structuredClone(evaluation);
  retained.evaluation.comparisons[0].request.operation = 'received'; reseal(retained.evaluation);
  assert.throws(() => value.service.read(OWNER, fork.id), { code: 'SYNTHETIC_ARTIFACT_UNAUTHENTIC' });
});

test('a restricted branch cannot receive a full fork containing hidden branchless history', async () => {
  const value = await setup(); value.store.state.members[0].branches = ['main'];
  const hidden = syntheticFact('hidden-unscoped-invoice', 'invoice', '1'); delete hidden.branch;
  value.store.state.facts.push(hidden);
  await assert.rejects(value.service.create(OWNER, value.request), { code: 'TRIAL_SCOPE_UNAVAILABLE' });
});

test('forks remove live action/model/workflow records without executing anything or changing policy authority', async () => {
  const value = await setup();
  value.store.state.actions = [{ id: 'synthetic-unexecuted-action', status: 'prepared' }];
  value.store.state.jobs = [{ id: 'synthetic-unexecuted-job', status: 'pending' }];
  value.store.state.routes = [{ id: 'synthetic-model-route' }];
  value.store.state.modelReceipts = [{ id: 'synthetic-model-record' }];
  value.store.state.policy.send = 'samples'; value.store.state.policy.autonomy = true; value.store.state.policy.sharing = true;
  const before = value.store.read(); const updates = value.store.updates; const { fork } = await evaluated(value);
  for (const side of ['baseline', 'candidate'] as const) {
    assert.deepEqual(fork[side].actions, []); assert.deepEqual(fork[side].jobs, []);
    assert.deepEqual(fork[side].routes, []); assert.deepEqual(fork[side].modelReceipts, []);
    assert.deepEqual(fork[side].policy, before.policy);
  }
  assert.deepEqual(value.store.read(), before); assert.equal(value.store.updates, updates);
});

test('retained fork/evaluation and promotion tampering is refused and snapshots remain detached from live authority', async () => {
  const value = await setup(); const before = value.store.read(); const { fork, evaluation } = await evaluated(value);
  const proposal = value.service.proposePromotion(OWNER, promotion(value, fork.id, evaluation.digest, 'prospective'));
  const changedProposal = structuredClone(proposal); changedProposal.impact.strategy = 'retrospective';
  assert.throws(() => value.service.assertPromotionCurrent(OWNER, changedProposal), isRefusal);
  const retained = value.fixture.custody.get(fork.id)!;
  retained.evaluation!.comparisons[0].totalDeltaMinor = '999';
  assert.throws(() => value.service.read(OWNER, fork.id), isRefusal);
  retained.evaluation = structuredClone(evaluation); retained.fork.candidate.facts[0].fields.taxMinor = '999';
  await assert.rejects(value.service.evaluate(OWNER, fork.id), isRefusal);
  fork.baseline.facts[0].fields.amountMinor = '0'; fork.candidate.facts[0].fields.taxMinor = '0';
  assert.deepEqual(value.store.read(), before); assert.equal(hash(before), hash(value.store.read()));
});
