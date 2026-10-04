import assert from 'node:assert/strict';
import test from 'node:test';
import { ChausarError, initialState, type State } from '../runtime/contracts.ts';
import { compileDictionary, OntologyService, starterPacks } from '../runtime/ontology.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest,
  inspectWorkspaceInterchange, readHistoricalWorkspaceState, validateWorkspaceInterchange, workspaceStateProfile,
} from '../runtime/workspace-interchange.ts';
import {
  INTERCHANGE_FORMAT, RETAINED_INTERCHANGE_FORMAT, RETAINED_ONTOLOGY_NAMESPACES, RETAINED_STATE_PROFILE, STATE_PROFILE,
  type ArtifactCapture, type WorkspaceInterchange,
} from '../runtime/workspace-interchange-contracts.ts';
import { interchangeOwner, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';

// Pure codecs and in-memory service StateStore fixtures. No Vault, credentials,
// native database, browser, provider or recovery-control operation.
const refuses = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
const refusesOntology = (error: unknown) => error instanceof ChausarError && error.code.startsWith('INVALID_DICTIONARY');
const cut = '2026-10-01T00:00:00.000Z';
function legacyState(): State {
  const state = initialState('Synthetic fixed ontology codec reference', true);
  state.workspace.id = 'workspace_fixed_profile_source'; state.workspace.createdAt = cut;
  const dictionary = compileDictionary(starterPacks[0], 1, 'owner', cut);
  state.ontology = { current: dictionary, history: [dictionary] };
  return state;
}
function artifacts(state: State): ArtifactCapture {
  return { complete: true, enumerationId: 'fixed_enumeration',
    generation: { workspaceId: state.workspace.id, revision: state.revision, captureId: 'fixed_capture' },
    categories: workspaceStateProfile().artifactCategories, artifacts: [] };
}
function wire(state: State) { return encodeWorkspaceInterchange(captureWorkspaceInterchange(state, artifacts(state)).package); }
function reseal(packed: WorkspaceInterchange): string {
  const { digest: _old, ...unsigned } = packed;
  packed.digest = interchangeDigest(unsigned); return canonicalInterchangeJson(packed);
}
async function publishedState(): Promise<State> {
  const store = new InterchangeFixtureStore(legacyState()), ontology = new OntologyService(store);
  await ontology.publish(interchangeOwner, starterPacks[1], {
    attemptId: 'exact_live_attempt', expectedCurrentHash: ontology.current(interchangeOwner)!.hash,
  });
  return store.read();
}
function inertState(published: State): State {
  const state = structuredClone(published), origin = state.workspace.id;
  state.workspace.id = 'workspace_fresh_profile_source';
  state.ontology.historicalPublicationEvidence = [{ workspaceId: origin,
    publicationAttempts: structuredClone(state.ontology.publicationAttempts) }];
  delete state.ontology.publicationAttempts;
  return state;
}

test('ontology-absent legacy and original scenario/lesson profiles keep exact prior bytes and digests', () => {
  // Captured from the unchanged c4 codec with this fixed source and empty
  // original artifact inventory; these pins predate ontology profile metadata.
  const references = [
    { names: [], digest: '31ec64f936c5bc6e47a21e16de48e642b3a3aa8d08ef72b569542bd170d75ace', bytes: 60210 },
    { names: ['scenarioRecords'], digest: '48e4db65034105c998f780430ce854b30d387e2686b2b68ccd79e817b45d8ae8', bytes: 60778 },
    { names: ['lessonState'], digest: '60373e3676cac6dada45b76e2af6d6ae0824b980c8b8d6597d169d3f0f37afb1', bytes: 60846 },
    { names: ['scenarioRecords', 'lessonState'], digest: 'd611737c587c247c952cf130a1982d46100b772446c6420af4b533b193cab9bb', bytes: 61414 },
  ];
  for (const reference of references) {
    const state = legacyState();
    if (reference.names.includes('scenarioRecords')) state.scenarioRecords = [];
    if (reference.names.includes('lessonState')) state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
    const packed = captureWorkspaceInterchange(state, artifacts(state)).package;
    assert.equal(packed.digest, reference.digest); assert.equal(Buffer.byteLength(encodeWorkspaceInterchange(packed)), reference.bytes);
    assert.equal(Object.hasOwn(packed.inventory.profile, 'ontologyNamespaces'), false);
    assert.equal(packed.format, reference.names.length ? RETAINED_INTERCHANGE_FORMAT : INTERCHANGE_FORMAT);
  }
  assert.deepEqual(workspaceStateProfile({}).ontologyNamespaces, undefined);
  assert.deepEqual(workspaceStateProfile().ontologyNamespaces, [...RETAINED_ONTOLOGY_NAMESPACES]);
  assert.equal(workspaceStateProfile().stores.length, 28);
});

test('nested ontology profiles preserve exact namespace presence including empty live and inert evidence', async t => {
  const published = await publishedState(), inert = inertState(published);
  const emptyLive = legacyState(); emptyLive.ontology.publicationAttempts = [];
  const emptyInert = legacyState(); emptyInert.ontology.historicalPublicationEvidence = [];
  const emptyOrigin = legacyState(); emptyOrigin.ontology.historicalPublicationEvidence = [{ workspaceId: 'empty_origin_workspace', publicationAttempts: [] }];
  const both = structuredClone(inert); both.ontology.publicationAttempts = [];
  const deferred = initialState('Synthetic deferred profile'); deferred.workspace.id = 'workspace_deferred_profile';
  deferred.ontology = { current: null, history: [], firstRunReviewRequired: true };
  const cases = [
    ['published', published], ['empty published', emptyLive], ['inert origin', inert], ['empty inert', emptyInert],
    ['empty origin record', emptyOrigin], ['live and inert', both], ['deferred review', deferred],
  ] as const;
  for (const [name, original] of cases) for (const privateNames of [[], ['scenarioRecords'], ['lessonState'], ['scenarioRecords', 'lessonState']]) {
    await t.test(`${name}; ${privateNames.join(',') || 'no private stores'}`, () => {
      const state = structuredClone(original);
      if (privateNames.includes('scenarioRecords')) state.scenarioRecords = [];
      if (privateNames.includes('lessonState')) state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
      const capture = captureWorkspaceInterchange(state, artifacts(state)), text = encodeWorkspaceInterchange(capture.package);
      const accepted = validateWorkspaceInterchange(text, capture.inventory), restored = readHistoricalWorkspaceState(accepted);
      const declared = RETAINED_ONTOLOGY_NAMESPACES.filter(namespace => Object.hasOwn(state.ontology, namespace));
      assert.equal(accepted.format, RETAINED_INTERCHANGE_FORMAT); assert.equal(accepted.inventory.profile.id, RETAINED_STATE_PROFILE);
      assert.deepEqual(accepted.inventory.profile.ontologyNamespaces, declared);
      assert.equal(accepted.inventory.profile.stores.length, 26 + privateNames.length);
      assert.deepEqual(restored, state); assert.equal(JSON.stringify(restored.ontology), JSON.stringify(state.ontology));
      assert.equal(encodeWorkspaceInterchange(accepted), text);
    });
  }
});

test('profile inspection refuses missing, unknown, duplicate, unordered or falsely declared ontology metadata', async t => {
  const initial = await publishedState(), capture = captureWorkspaceInterchange(initial, artifacts(initial));
  const mutations: [string, (packed: WorkspaceInterchange) => void][] = [
    ['missing metadata', packed => { delete packed.inventory.profile.ontologyNamespaces; }],
    ['empty metadata', packed => { packed.inventory.profile.ontologyNamespaces = []; }],
    ['unknown metadata', packed => { packed.inventory.profile.ontologyNamespaces = ['unknown'] as never; }],
    ['duplicate metadata', packed => { packed.inventory.profile.ontologyNamespaces = ['publicationAttempts', 'publicationAttempts']; }],
    ['wrong declared presence', packed => { packed.inventory.profile.ontologyNamespaces = ['firstRunReviewRequired']; }],
    ['unordered metadata', packed => { packed.inventory.profile.ontologyNamespaces = ['publicationAttempts', 'historicalPublicationEvidence']; }],
    ['extra profile field', packed => { Object.assign(packed.inventory.profile, { namespacePolicy: 'accept-all' }); }],
    ['legacy downgrade', packed => { delete packed.inventory.profile.ontologyNamespaces; packed.inventory.profile.id = STATE_PROFILE; packed.format = INTERCHANGE_FORMAT; }],
  ];
  for (const [name, mutate] of mutations) await t.test(name, () => {
    const packed = structuredClone(capture.package); mutate(packed);
    assert.throws(() => inspectWorkspaceInterchange(reseal(packed)), refuses('INTERCHANGE_PROFILE'));
  });
  const state = await publishedState(), original = captureWorkspaceInterchange(state, artifacts(state));
  delete state.ontology.publicationAttempts;
  const downgraded = wire(state);
  assert.equal(inspectWorkspaceInterchange(downgraded).format, INTERCHANGE_FORMAT);
  assert.throws(() => validateWorkspaceInterchange(downgraded, original.inventory), refuses('INTERCHANGE_AUTHORITY_CHANGED'));
});

test('modern ontology wrappers validate exact data and refuse unknown or forged retained evidence', async t => {
  const published = await publishedState();
  const changes: [string, (state: State) => void][] = [
    ['unknown wrapper key', state => { state.ontology.unreviewedAuthority = []; }],
    ['undefined live namespace', state => { state.ontology.publicationAttempts = undefined; }],
    ['undefined inert namespace', state => { state.ontology.historicalPublicationEvidence = undefined; }],
    ['deferred marker mixed with published evidence', state => { state.ontology.firstRunReviewRequired = true; }],
    ['wrong live workspace', state => { state.ontology.publicationAttempts[0].workspaceId = 'another_workspace'; }],
    ['duplicate live attempts', state => { state.ontology.publicationAttempts.push(structuredClone(state.ontology.publicationAttempts[0])); }],
    ['unlinked history', state => { state.ontology.history.pop(); }],
    ['unknown receipt field', state => { state.ontology.publicationAttempts[0].approvedByFreshOwner = true; }],
  ];
  for (const [name, mutate] of changes) await t.test(name, () => {
    const state = structuredClone(published); mutate(state);
    assert.throws(() => captureWorkspaceInterchange(state, artifacts(state)), refusesOntology);
  });
  const inherited = inertState(published);
  for (const [name, mutate] of [
    ['origin equals live workspace', (state: State) => { state.ontology.historicalPublicationEvidence[0].workspaceId = state.workspace.id; }],
    ['duplicate origin', (state: State) => { state.ontology.historicalPublicationEvidence.push(structuredClone(state.ontology.historicalPublicationEvidence[0])); }],
    ['rewritten origin receipt', (state: State) => { state.ontology.historicalPublicationEvidence[0].publicationAttempts[0].workspaceId = state.workspace.id; }],
  ] as const) await t.test(name, () => {
    const state = structuredClone(inherited); mutate(state);
    assert.throws(() => captureWorkspaceInterchange(state, artifacts(state)), refusesOntology);
  });
});

test('scenario evidence cuts validate their own exact ontology profile and original workspace binding', async t => {
  const published = await publishedState(), inherited = inertState(published);
  const deferred = initialState('Synthetic deferred evidence cut');
  deferred.workspace.id = 'workspace_deferred_evidence_cut';
  deferred.ontology = { current: null, history: [], firstRunReviewRequired: true };
  for (const [name, historical] of [['published', published], ['inherited', inherited], ['deferred', deferred]] as const) await t.test(name, () => {
    const source = legacyState(); source.workspace.id = 'workspace_different_current_source';
    source.scenarioRecords = [{ evidence: [{ state: historical }] }] as never;
    const capture = captureWorkspaceInterchange(source, artifacts(source));
    assert.equal(Object.hasOwn(capture.inventory.profile, 'ontologyNamespaces'), false);
    const restored = readHistoricalWorkspaceState(validateWorkspaceInterchange(encodeWorkspaceInterchange(capture.package), capture.inventory));
    assert.equal(JSON.stringify(restored.scenarioRecords), JSON.stringify(source.scenarioRecords));
    const cutState = restored.scenarioRecords![0].evidence[0].state;
    assert.deepEqual(cutState.ontology, historical.ontology); assert.notEqual(cutState.workspace.id, restored.workspace.id);
    if (name === 'published') {
      assert.equal(cutState.ontology.publicationAttempts[0].workspaceId, historical.workspace.id);
      cutState.ontology.publicationAttempts[0].workspaceId = restored.workspace.id;
      assert.throws(() => captureWorkspaceInterchange(restored, artifacts(restored)), refusesOntology);
    }
  });
  const recursive = legacyState(), cutState = structuredClone(published); cutState.scenarioRecords = [];
  recursive.scenarioRecords = [{ evidence: [{ state: cutState }] }] as never;
  assert.throws(() => captureWorkspaceInterchange(recursive, artifacts(recursive)), refuses('INTERCHANGE_STATE'));
});
