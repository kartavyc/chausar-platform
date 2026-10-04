import test from 'node:test';
import assert from 'node:assert/strict';
import { hash, initialState, type State } from '../runtime/contracts.ts';
import { compileDictionary, OntologyService, starterPacks, type DictionaryDraft } from '../runtime/ontology.ts';
import { fixedTime, interchangeOwner, InterchangeFixtureStore } from './fixtures/workspace-interchange-fixture.ts';

// Synthetic data and in-memory StateStore only; no native storage or PostgreSQL.
function fixture(state = initialState('Synthetic dictionary validation')) {
  const store = new InterchangeFixtureStore(state);
  return { store, ontology: new OntologyService(store) };
}
const draft = () => structuredClone(starterPacks[0]);

test('ordinary dense frozen arrays preserve exact draft digest and authored definitions', async () => {
  const reviewed = draft(), before = structuredClone(reviewed);
  Object.freeze(reviewed.definitions);
  const f = fixture();
  const published = await f.ontology.publish(interchangeOwner, reviewed, { expectedCurrentHash: null, attemptId: 'dense_review' });
  assert.deepEqual(reviewed, before);
  assert.deepEqual(published.definitions, before.definitions);
  assert.equal(f.ontology.get(interchangeOwner, { attemptId: 'dense_review' }).attempt?.draftDigest, hash(before));
  assert.equal(f.store.writes, 1);
});

test('nonordinary arrays are refused before getters or StateStore writes', async t => {
  let getterCalls = 0;
  const cases: { name: string; mutate(value: DictionaryDraft): void }[] = [
    { name: 'sparse index', mutate(value) { delete value.definitions[1]; } },
    { name: 'accessor index', mutate(value) {
      const original = value.definitions[1];
      Object.defineProperty(value.definitions, '1', { enumerable: true, get() { getterCalls++; return original; } });
    } },
    { name: 'hidden index', mutate(value) { Object.defineProperty(value.definitions, '1', { enumerable: false }); } },
    { name: 'extra string property', mutate(value) { Object.defineProperty(value.definitions, 'extra', { value: true }); } },
    { name: 'extra symbol property', mutate(value) { Object.defineProperty(value.definitions, Symbol('extra'), { value: true }); } },
    { name: 'custom array prototype', mutate(value) { Object.setPrototypeOf(value.definitions, []); } },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture(), before = f.store.read(), reviewed = draft();
    item.mutate(reviewed);
    await assert.rejects(f.ontology.publish(interchangeOwner, reviewed, { expectedCurrentHash: null, attemptId: 'invalid_array' }), { code: 'INVALID_DICTIONARY' });
    assert.equal(getterCalls, 0);
    assert.equal(f.store.writes, 0);
    assert.deepEqual(f.store.read(), before);
  });
});

function historyState(versions: [number, number], reversed = false): State {
  const state = initialState('Synthetic ordered dictionary history');
  const history = versions.map((version, index) => compileDictionary(starterPacks[index], version, interchangeOwner.memberId, fixedTime));
  if (reversed) history.reverse();
  state.ontology = { current: history.at(-1), history, publicationAttempts: [] };
  return state;
}

test('valid ordered history remains available and accepts its exact next CAS publication', async () => {
  const f = fixture(historyState([1, 2]));
  const before = f.ontology.get(interchangeOwner, { attemptId: 'not_published' });
  assert.deepEqual(before.history.map(item => item.version), [1, 2]);
  assert.equal(before.attempt, null);
  const published = await f.ontology.publish(interchangeOwner, 'services', { expectedCurrentHash: before.current!.hash, attemptId: 'ordered_next' });
  assert.equal(published.version, 3);
  assert.deepEqual(f.ontology.get(interchangeOwner, {}).history.map(item => item.version), [1, 2, 3]);
});

test('self-hashed reversed and equal-version histories refuse lookup and publication without writes', async t => {
  for (const [name, state] of [['reversed', historyState([1, 2], true)], ['equal versions', historyState([1, 1])]] as const) {
    await t.test(name, async () => {
      const f = fixture(state), before = f.store.read();
      for (const dictionary of state.ontology.history) {
        assert.equal(dictionary.hash, hash(Object.fromEntries(Object.entries(dictionary).filter(([key]) => key !== 'hash'))));
      }
      assert.deepEqual(state.ontology.current, state.ontology.history.at(-1));
      assert.throws(() => f.ontology.get(interchangeOwner, { attemptId: 'history_lookup' }), { code: 'INVALID_DICTIONARY_RECEIPT' });
      await assert.rejects(f.ontology.publish(interchangeOwner, 'services'), { code: 'INVALID_DICTIONARY_RECEIPT' });
      assert.equal(f.store.writes, 0);
      assert.deepEqual(f.store.read(), before);
    });
  }
});

test('direct drafts and legacy or CAS wrappers preserve public publication contracts', async t => {
  const reviewed = draft();
  const cases = [
    { name: 'direct draft', payload: reviewed, pack: reviewed.pack, attemptId: undefined },
    { name: 'legacy pack', payload: { pack: 'retail' }, pack: 'retail', attemptId: undefined },
    { name: 'CAS draft', payload: { draft: reviewed, expectedCurrentHash: null, attemptId: 'wrapped_draft' }, pack: reviewed.pack, attemptId: 'wrapped_draft' },
    { name: 'CAS pack', payload: { pack: 'services', expectedCurrentHash: null, attemptId: 'wrapped_pack' }, pack: 'services', attemptId: 'wrapped_pack' },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture();
    const published = await f.ontology.publishPayload(interchangeOwner, item.payload);
    assert.equal(published.pack, item.pack);
    assert.equal(published.version, 1);
    assert.equal(f.store.writes, 1);
    const expectedDraft = starterPacks.find(value => value.pack === item.pack)!;
    assert.deepEqual(published.definitions, expectedDraft.definitions);
    if (item.attemptId) {
      const receipt = f.ontology.get(interchangeOwner, { attemptId: item.attemptId }).attempt!;
      assert.equal(receipt.draftDigest, hash(expectedDraft));
      assert.equal(receipt.expectedCurrentHash, null);
      assert.equal(receipt.dictionaryHash, published.hash);
    } else assert.deepEqual(f.store.read().ontology.publicationAttempts ?? [], []);
  });
});

test('malformed publication wrappers cannot bypass exact-key or data-only validation', async t => {
  let getterCalls = 0;
  const accessor = Object.defineProperty({}, 'pack', { enumerable: true, get() { getterCalls++; return 'ecommerce'; } });
  const cases = [
    { name: 'unknown wrapper field', payload: { pack: 'ecommerce', actor: interchangeOwner }, code: 'INVALID_DICTIONARY_OPTIONS' },
    { name: 'both draft and pack', payload: { draft: draft(), pack: 'ecommerce' }, code: 'INVALID_DICTIONARY_OPTIONS' },
    { name: 'nonstring pack', payload: { pack: 7 }, code: 'INVALID_DICTIONARY_OPTIONS' },
    { name: 'accessor wrapper', payload: accessor, code: 'INVALID_DICTIONARY_OPTIONS' },
    { name: 'undefined draft', payload: { draft: undefined }, code: 'UNKNOWN_PACK' },
  ];
  for (const item of cases) await t.test(item.name, async () => {
    const f = fixture(), before = f.store.read();
    await assert.rejects(f.ontology.publishPayload(interchangeOwner, item.payload as never), { code: item.code });
    assert.equal(getterCalls, 0);
    assert.equal(f.store.writes, 0);
    assert.deepEqual(f.store.read(), before);
  });
});
