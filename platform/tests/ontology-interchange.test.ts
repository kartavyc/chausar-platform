import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState, type State } from '../runtime/contracts.ts';
import { OntologyService, starterPacks } from '../runtime/ontology.ts';
import {
  canonicalInterchangeJson, captureWorkspaceInterchange, encodeWorkspaceInterchange, interchangeDigest,
  inspectWorkspaceInterchange, readHistoricalWorkspaceState, validateWorkspaceInterchange, workspaceStateProfile,
} from '../runtime/workspace-interchange.ts';
import { WorkspaceImportCandidateService } from '../runtime/workspace-import-candidate.ts';
import {
  WorkspaceActivationHost, type AuthenticatedActivationCandidate, type WorkspaceActivationPorts,
} from '../runtime/workspace-activation.ts';
import {
  artifactsFor, deterministicShopState, emptyTarget, interchangeOwner, InterchangeFixtureStore,
} from './fixtures/workspace-interchange-fixture.ts';

// SOURCE FIXTURES ONLY: pure codecs and declared in-memory host ports. No Vault,
// credentials, native storage, browser, PostgreSQL, network or fresh authority publication.
const code = (expected: string) => (error: unknown) => error instanceof ChausarError && error.code === expected;

async function publicationState(): Promise<State> {
  const store = new InterchangeFixtureStore(deterministicShopState());
  const ontology = new OntologyService(store), baseline = ontology.current(interchangeOwner)!;
  const published = await ontology.publish(interchangeOwner, starterPacks[1], {
    attemptId: 'retained_dictionary_attempt', expectedCurrentHash: baseline.hash,
  });
  await ontology.publish(interchangeOwner, starterPacks[2]);
  const state = store.read();
  assert.equal(state.ontology.publicationAttempts.length, 1);
  assert.equal(state.ontology.publicationAttempts[0].dictionaryHash, published.hash);
  assert.equal(state.ontology.publicationAttempts[0].version, 2);
  assert.equal(state.ontology.current.version, 3);
  return state;
}

function deferredState(): State {
  const state = initialState('Synthetic deferred dictionary source');
  state.workspace.id = 'workspace_synthetic_source';
  // Decoded source fixture matching Vault's initial deferred revision-zero
  // snapshot. The service/Engine fixtures separately verify its encrypted commit.
  state.ontology = { current: null, history: [], firstRunReviewRequired: true };
  assert.equal(state.revision, 0);
  assert.deepEqual(state.learning, []); assert.deepEqual(state.activity, []);
  return state;
}

test('deferred review marker survives exact interchange readback and independent pin rejects coherent removal', async t => {
  const state = deferredState();
  const capture = captureWorkspaceInterchange(state, artifactsFor(state));
  const accepted = validateWorkspaceInterchange(encodeWorkspaceInterchange(capture.package), capture.inventory);
  assert.deepEqual(readHistoricalWorkspaceState(accepted).ontology, state.ontology);
  assert.equal(accepted.stores.find(store => store.manifest.name === 'ontology')!.text, JSON.stringify(state.ontology));
  assert.deepEqual(JSON.parse(accepted.readable.definitions), state.ontology);
  for (const [name, mutate] of [
    ['removed marker', (copy: State) => { delete copy.ontology.firstRunReviewRequired; }],
    ['disabled marker', (copy: State) => { copy.ontology.firstRunReviewRequired = false; }],
  ] as const) await t.test(name, () => {
    const copy = structuredClone(state); mutate(copy);
    const rewritten = encodeWorkspaceInterchange(captureWorkspaceInterchange(copy, artifactsFor(copy)).package);
    assert.doesNotThrow(() => inspectWorkspaceInterchange(rewritten));
    assert.throws(() => validateWorkspaceInterchange(rewritten, capture.inventory), code('INTERCHANGE_AUTHORITY_CHANGED'));
  });
  const activation = activationReview(readHistoricalWorkspaceState(accepted));
  await assert.rejects(activation.review(), code('ACTIVATION_DICTIONARY'));
  assert.equal(activation.counts().allocations, 0); assert.equal(activation.counts().commits, 0);
  assert.ok(activation.counts().guards > 0);
});

test('reconstructed deferred source requires exact reviewed attempt before its first retained v1 publication', async () => {
  const state = deferredState();
  const capture = captureWorkspaceInterchange(state, artifactsFor(state));
  const retained = readHistoricalWorkspaceState(validateWorkspaceInterchange(encodeWorkspaceInterchange(capture.package), capture.inventory));
  const store = new InterchangeFixtureStore(retained), ontology = new OntologyService(store);
  assert.deepEqual(ontology.get(interchangeOwner, {}), { current: null, history: [] });
  await assert.rejects(ontology.publish(interchangeOwner, starterPacks[0]), code('DICTIONARY_REVIEW_REQUIRED'));
  await assert.rejects(ontology.publish(interchangeOwner, starterPacks[0], { expectedCurrentHash: null }), code('DICTIONARY_REVIEW_REQUIRED'));
  assert.deepEqual(store.read(), retained); assert.equal(store.writes, 0);
  const dictionary = await ontology.publish(interchangeOwner, starterPacks[0], {
    expectedCurrentHash: null, attemptId: 'first_reviewed_dictionary_attempt',
  });
  assert.equal(dictionary.version, 1);
  const published = store.read();
  assert.equal(Object.hasOwn(published.ontology, 'firstRunReviewRequired'), false);
  assert.equal(published.ontology.publicationAttempts.length, 1);
  assert.equal(published.ontology.publicationAttempts[0].expectedCurrentHash, null);
  assert.equal(published.ontology.publicationAttempts[0].dictionaryHash, dictionary.hash);
  const complete = captureWorkspaceInterchange(published, artifactsFor(published));
  assert.deepEqual(readHistoricalWorkspaceState(validateWorkspaceInterchange(encodeWorkspaceInterchange(complete.package), complete.inventory)), published);
});

test('legacy interchange retains publication receipts, exact dictionary history and original actor bindings', async () => {
  const state = await publicationState(), profileBefore = workspaceStateProfile();
  const capture = captureWorkspaceInterchange(state, artifactsFor(state));
  const wire = encodeWorkspaceInterchange(capture.package);
  const accepted = validateWorkspaceInterchange(wire, capture.inventory);
  const historical = readHistoricalWorkspaceState(accepted);
  assert.deepEqual(historical.ontology, state.ontology);
  assert.equal(accepted.stores.find(store => store.manifest.name === 'ontology')!.text, JSON.stringify(state.ontology));
  assert.deepEqual(JSON.parse(accepted.readable.definitions).publicationAttempts, state.ontology.publicationAttempts);
  assert.deepEqual(historical.ontology.publicationAttempts[0], {
    attemptId: 'retained_dictionary_attempt', workspaceId: state.workspace.id,
    memberId: interchangeOwner.memberId, epoch: interchangeOwner.epoch,
    draftDigest: state.ontology.publicationAttempts[0].draftDigest,
    expectedCurrentHash: state.ontology.history[0].hash,
    dictionaryHash: state.ontology.history[1].hash, version: 2,
  });
  assert.deepEqual(workspaceStateProfile(), profileBefore);
  assert.equal(encodeWorkspaceInterchange(accepted), wire);
  historical.ontology.publicationAttempts[0].memberId = 'detached_mutation';
  assert.deepEqual(readHistoricalWorkspaceState(accepted).ontology, state.ontology);
});

test('independently pinned interchange refuses receipt removal and coherent origin or publication rewrites', async t => {
  const state = await publicationState();
  const original = captureWorkspaceInterchange(state, artifactsFor(state));
  const changes: [string, (copy: State) => void][] = [
    ['missing receipt namespace', copy => { delete copy.ontology.publicationAttempts; }],
    ['empty receipt namespace', copy => { copy.ontology.publicationAttempts = []; }],
    ['attempt identity', copy => { copy.ontology.publicationAttempts[0].attemptId = 'different_attempt'; }],
    ['fresh workspace', copy => { copy.ontology.publicationAttempts[0].workspaceId = 'fresh_workspace'; }],
    ['fresh owner', copy => { copy.ontology.publicationAttempts[0].memberId = 'fresh_owner'; }],
    ['fresh epoch', copy => { copy.ontology.publicationAttempts[0].epoch++; }],
    ['draft digest', copy => { copy.ontology.publicationAttempts[0].draftDigest = 'a'.repeat(64); }],
    ['reviewed baseline', copy => { copy.ontology.publicationAttempts[0].expectedCurrentHash = null; }],
    ['later dictionary', copy => { copy.ontology.publicationAttempts[0].dictionaryHash = copy.ontology.current.hash; }],
    ['later version', copy => { copy.ontology.publicationAttempts[0].version++; }],
  ];
  for (const [name, change] of changes) await t.test(name, () => {
    const copy = structuredClone(state); change(copy);
    // Recapture recomputes every internal checksum. Structural consistency does
    // not replace independently retained source provenance.
    const rewritten = encodeWorkspaceInterchange(captureWorkspaceInterchange(copy, artifactsFor(copy)).package);
    assert.doesNotThrow(() => inspectWorkspaceInterchange(rewritten));
    assert.throws(() => validateWorkspaceInterchange(rewritten, original.inventory), code('INTERCHANGE_AUTHORITY_CHANGED'));
  });
});

function activationReview(state: State) {
  const capture = captureWorkspaceInterchange(state, artifactsFor(state)), target = emptyTarget();
  const candidate = new WorkspaceImportCandidateService({
    source: () => ({ ready: true, inventory: capture.inventory }), target: () => target, assertCompleteRead: () => {},
  }).prepare(interchangeOwner, { text: canonicalInterchangeJson(capture.package), targetId: target.targetId });
  const retained: AuthenticatedActivationCandidate = {
    content: canonicalInterchangeJson(candidate),
    pin: { format: 'chausar.interchange-custody-pin.v1', kind: 'candidate', recordId: 'receipt_candidate',
      creationId: 'receipt_candidate_creation', contextDigest: interchangeDigest(interchangeOwner), inventory: capture.inventory,
      packageDigest: candidate.packageDigest, candidateDigest: interchangeDigest(candidate), target },
    measurement: { encrypted: true, archiveCiphertextBytes: 1, inventoryPinCiphertextBytes: 1, qualification: 'test-fixture' },
  };
  let allocations = 0, commits = 0, guards = 0;
  const ports: WorkspaceActivationPorts = {
    custody: { async read() { return structuredClone(retained); } },
    async withTransaction(_context, _input, work) {
      return work({
        source: { ready: true, state: structuredClone(state), artifacts: artifactsFor(state),
          async assertCompleteOwner(context) { authorize(new InterchangeFixtureStore(state), context, 'admin'); },
          async assertCurrent() {} },
        target: structuredClone(target), async readCandidate() { return structuredClone(retained); },
        async assertCurrent() { guards++; },
        async allocateAuthority() { allocations++; throw new Error('Fresh authority must not be allocated.'); },
        async commit() { commits++; throw new Error('Receipt-bearing ontology must not publish.'); },
        async readback() { return { status: 'unknown', activationId: 'unpublished', reasonCode: 'TEST_UNPUBLISHED' }; },
      });
    },
    async readback() { return { status: 'unknown', activationId: 'unpublished', reasonCode: 'TEST_UNPUBLISHED' }; },
  };
  const host = new WorkspaceActivationHost(ports, {
    approvedSyntheticWorkspaceIds: [state.workspace.id], allowedSyntheticSourceIds: ['demo-export'],
    budgets: { maxCandidateBytes: 8_000_000, maxArtifactBytes: 1_000_000, maxArtifacts: 64, maxFacts: 1000, maxRecords: 10_000 },
    retentionDays: 90,
  });
  return { review: () => host.review(interchangeOwner, {
    candidateId: 'receipt_candidate', reviewedDigest: interchangeDigest(candidate),
  }), counts: () => ({ allocations, commits, guards }) };
}

test('existing fresh-owner activation explicitly refuses the unreviewed publication receipt namespace', async t => {
  const state = await publicationState();
  for (const retained of [state.ontology.publicationAttempts, []]) await t.test(retained.length ? 'retained attempts' : 'empty attempts', async () => {
    const copy = structuredClone(state); copy.ontology.publicationAttempts = retained;
    const activation = activationReview(copy);
    await assert.rejects(activation.review(), code('ACTIVATION_DICTIONARY'));
    assert.equal(activation.counts().allocations, 0); assert.equal(activation.counts().commits, 0);
    assert.ok(activation.counts().guards > 0);
    assert.deepEqual(copy.ontology.publicationAttempts, retained);
  });
});
