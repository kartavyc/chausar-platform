import test from 'node:test';
import assert from 'node:assert/strict';
import { ChausarError, initialState, type State } from '../runtime/contracts.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { proveEmptyWorkspaceTarget, WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import { captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest, workspaceStateProfile } from '../runtime/workspace-interchange.ts';
import { artifactsFor, deterministicShopState, emptyTarget, interchangeOwner, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';

// Pure historical codec and root-port fixtures. No filesystem, credentials,
// native storage, listener, provider or backup-control operation.
function oldRetainedTarget() {
  const target = emptyTarget();
  delete target.profile.ontologyNamespaces;
  return target;
}
function prepare(state: State, target = oldRetainedTarget()) {
  const capture = captureWorkspaceInterchange(state, artifactsFor(state));
  const service = new WorkspaceImportCandidateService({
    source: () => ({ ready: true, inventory: capture.inventory }), target: () => structuredClone(target),
    assertCompleteRead: () => {},
  });
  const candidate = service.prepare(interchangeOwner, { text: encodeWorkspaceInterchange(capture.package), targetId: target.targetId });
  return { candidate, service, capture, target };
}
const refused = (error: unknown) => error instanceof ChausarError && error.code === 'INTERCHANGE_PROFILE';

test('exact pre-ontology c4 target proof still prepares and reviews each original retained source profile', () => {
  for (const names of [[], ['scenarioRecords'], ['lessonState'], ['scenarioRecords', 'lessonState']]) {
    const state = deterministicShopState();
    if (names.includes('scenarioRecords')) state.scenarioRecords = [];
    if (names.includes('lessonState')) state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
    const result = prepare(state), before = structuredClone(result.target);
    assert.equal(Object.hasOwn(result.capture.inventory.profile, 'ontologyNamespaces'), false);
    assert.equal(result.candidate.targetProofDigest, interchangeDigest(result.target));
    assert.deepEqual(result.service.review(interchangeOwner, { id: result.candidate.id, reviewedDigest: interchangeDigest(result.candidate) }), result.candidate);
    assert.deepEqual(result.target, before, 'Old target proof fields and pins are never rewritten.');
  }
});

test('old target capabilities refuse every modern ontology source, including empty namespace presence', async () => {
  const store = new InterchangeFixtureStore(deterministicShopState()), ontology = new OntologyService(store);
  await ontology.publish(interchangeOwner, ontology.packs()[1], { expectedCurrentHash: ontology.current(interchangeOwner)!.hash, attemptId: 'old_capability_refusal' });
  const published = store.read(), empty = deterministicShopState(); empty.ontology.publicationAttempts = [];
  const historical = structuredClone(published), origin = historical.workspace.id;
  historical.workspace.id = 'workspace_distinct_historical_source';
  historical.ontology.historicalPublicationEvidence = [{ workspaceId: origin, publicationAttempts: historical.ontology.publicationAttempts }];
  delete historical.ontology.publicationAttempts;
  const deferred = initialState('Synthetic deferred target proof');
  deferred.ontology = { current: null, history: [], firstRunReviewRequired: true };
  for (const state of [published, empty, historical, deferred]) {
    assert.throws(() => prepare(state), refused);
    const result = prepare(state, emptyTarget());
    assert.deepEqual(result.service.review(interchangeOwner, { id: result.candidate.id, reviewedDigest: interchangeDigest(result.candidate) }), result.candidate);
  }
});

test('compatibility admits only exact old target profiles and preserves legacy-only source limits', () => {
  const legacy = emptyTarget(); legacy.profile = workspaceStateProfile({});
  legacy.stores = legacy.profile.stores.map(store => ({ name: store.name, records: 0 }));
  const state = deterministicShopState(); assert.doesNotThrow(() => prepare(state, legacy));
  state.scenarioRecords = [];
  assert.throws(() => prepare(state, legacy), refused);
  for (const mutate of [
    (target: ReturnType<typeof oldRetainedTarget>) => { target.profile.stores.pop(); },
    (target: ReturnType<typeof oldRetainedTarget>) => { Object.assign(target.profile, { authorityMigration: true }); },
    (target: ReturnType<typeof oldRetainedTarget>) => { target.profile.ontologyNamespaces = ['publicationAttempts']; },
  ]) {
    const target = oldRetainedTarget(); mutate(target);
    assert.throws(() => proveEmptyWorkspaceTarget(target), refused);
  }
});
