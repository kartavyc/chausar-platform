import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ChausarError, type Context, type State } from '../runtime/contracts.ts';
import { OntologyService, starterPacks, type Dictionary } from '../runtime/ontology.ts';
import { Vault } from '../runtime/vault.ts';
import { encodeWorkspaceInterchange, interchangeDigest, readHistoricalWorkspaceState, validateWorkspaceInterchange } from '../runtime/workspace-interchange.ts';
import { ontologyRetainedActivationFixture, openOntologyActivatedTarget } from './fixtures/ontology-retained-activation-fixture.ts';
import { retainedInterchangeFixture, retainedOwner } from './fixtures/workspace-interchange-retained-fixture.ts';

// Actual serialized encrypted Node Vault custody and retained service fixtures.
// No native/browser/PostgreSQL, credential provider, local backup control or CI.
const refusal = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
type RetainedFixture = Awaited<ReturnType<typeof retainedInterchangeFixture>>;
function completeRead(source: RetainedFixture) {
  return (context: Context, historical: State) => {
    const scenarioCurrent = source.scenarios().assertInterchangeRead(context, historical);
    if (historical.lessonState) source.lessons().assertInterchangeRead(context, historical.lessonState,
      { at: source.exportClock, days: source.vault.read().policy.retentionDays });
    scenarioCurrent();
  };
}
function historicalFrom(source: ReturnType<RetainedFixture['capture']>) {
  const text = encodeWorkspaceInterchange(source.package);
  const archive = validateWorkspaceInterchange(text, source.inventory);
  assert.equal(encodeWorkspaceInterchange(archive), text);
  return readHistoricalWorkspaceState(archive);
}

test('receipt publications on both sides of retained scenario capture survive exact backup and encrypted source reopen', async t => {
  for (const order of ['publication before scenario capture', 'publication after scenario capture'] as const) await t.test(order, async sub => {
    const source = await retainedInterchangeFixture(sub, { populate: false }), ontology = () => new OntologyService(source.store);
    const beforeScenario = order === 'publication before scenario capture';
    const baseline = ontology().current(retainedOwner)!;
    const options = { expectedCurrentHash: baseline.hash, attemptId: 'joined_retained_original_attempt' };
    let published: Dictionary;
    if (beforeScenario) published = await ontology().publish(retainedOwner, starterPacks[0], options);
    await source.populate();
    if (!beforeScenario) published = await ontology().publish(retainedOwner, starterPacks[0], options);
    const captured = source.capture(), before = source.vault.read(), historical = historicalFrom(captured);
    assert.deepEqual(historical, before);
    for (const name of ['ontology', 'scenarioRecords', 'lessonState'] as const)
      assert.equal(JSON.stringify(historical[name]), JSON.stringify(before[name]));
    assert.deepEqual(historical.ontology.publicationAttempts, before.ontology.publicationAttempts);
    assert.equal(before.scenarioRecords!.length, 1); assert.equal(before.lessonState!.lessons.length, 1);
    for (const cut of historical.scenarioRecords![0].evidence) {
      assert.equal(Object.hasOwn(cut.state.ontology, 'publicationAttempts'), beforeScenario);
      if (beforeScenario) assert.deepEqual(cut.state.ontology.publicationAttempts, before.ontology.publicationAttempts);
    }
    const later = await ontology().publish(retainedOwner, starterPacks[0], {
      expectedCurrentHash: published!.hash, attemptId: 'joined_retained_later_attempt',
    });
    assert.equal(later.version, published!.version + 1);
    const after = source.capture();
    assert.throws(() => validateWorkspaceInterchange(encodeWorkspaceInterchange(captured.package), after.inventory), refusal('INTERCHANGE_AUTHORITY_CHANGED'));
    assert.deepEqual(historicalFrom(captured), before, 'An independently pinned earlier cut stays exact after a later publication.');
    const state = source.vault.read(), ciphertext = await readFile(join(source.directory, 'authority.encrypted.json'));
    await source.reopen();
    assert.equal(JSON.stringify(source.vault.read()), JSON.stringify(state));
    const result = ontology().get(retainedOwner, { attemptId: options.attemptId });
    assert.deepEqual(result.attempt, before.ontology.publicationAttempts[0]);
    assert.equal(result.current?.hash, later.hash);
    assert.deepEqual(await ontology().publish(retainedOwner, starterPacks[0], options), published!);
    assert.equal(JSON.stringify(source.vault.read()), JSON.stringify(state));
    assert.deepEqual(await readFile(join(source.directory, 'authority.encrypted.json')), ciphertext);
    assert.deepEqual(historicalFrom(source.capture()), state);
  });
});

test('fresh-owner activation retains exact original receipts as inert evidence and refuses attribution or replay across reopen', async t => {
  const source = await retainedInterchangeFixture(t), ontology = new OntologyService(source.store);
  const baseline = ontology.current(retainedOwner)!;
  const oldOptions = { expectedCurrentHash: baseline.hash, attemptId: 'joined_origin_reviewed_attempt' };
  const first = await ontology.publish(retainedOwner, starterPacks[0], oldOptions);
  await ontology.publish(retainedOwner, starterPacks[0], {
    expectedCurrentHash: first.hash, attemptId: 'joined_origin_identical_later_attempt',
  });
  const original = source.vault.read(), activation = ontologyRetainedActivationFixture(() => source.vault.read(), completeRead(source));
  const { review, summary } = await activation.activate(), read = activation.readback();
  assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
  assert.equal(read.evidence.content, activation.candidateRead().content);
  const historical = readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive);
  assert.deepEqual(historical, original);
  for (const name of ['ontology', 'scenarioRecords', 'lessonState'] as const)
    assert.equal(JSON.stringify(historical[name]), JSON.stringify(original[name]));
  assert.equal(Object.hasOwn(read.state.ontology, 'publicationAttempts'), false);
  assert.equal(Object.hasOwn(read.state.ontology, 'firstRunReviewRequired'), false);
  assert.deepEqual(read.state.ontology.historicalPublicationEvidence,
    [{ workspaceId: original.workspace.id, publicationAttempts: original.ontology.publicationAttempts }]);
  assert.deepEqual(read.state.ontology.current, original.ontology.current);
  assert.deepEqual(read.state.ontology.history, original.ontology.history);
  assert.deepEqual(review.ontologyDisposition, {
    format: 'chausar.ontology-historical-projection.v1', sourceWorkspaceId: original.workspace.id,
    sourceOntologyDigest: interchangeDigest(original.ontology), publicationAttempts: 'inert-origin-evidence', historicalPublicationEvidence: 'absent',
  });
  assert.equal(review.inertStores.includes('ontology.publicationAttempts'), true);
  for (const name of ['scenarioRecords', 'lessonState'] as const) {
    assert.equal(Object.hasOwn(read.state, name), false);
    assert.equal(review.inertStores.includes(name), true);
  }
  assert.equal(summary.projectionDigest, review.projectionDigest);
  assert.deepEqual(await activation.host().resolve(retainedOwner, { activationId: summary.activationId }), summary);
  const target = await openOntologyActivatedTarget(t, read), fresh = summary.ownerContext;
  for (const phase of ['created', 'reopened'] as const) {
    if (phase === 'reopened') await target.reopen();
    const service = new OntologyService(target.vault), before = target.vault.read(), ciphertext = await target.ciphertext();
    assert.equal(Object.hasOwn(service.get(fresh, {}), 'attempt'), false);
    assert.equal(service.get(fresh, { attemptId: 'joined_missing_origin_attempt' }).attempt, null);
    for (const receipt of original.ontology.publicationAttempts) {
      assert.throws(() => service.get(fresh, { attemptId: receipt.attemptId }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
      await assert.rejects(service.publish(fresh, starterPacks[0], {
        expectedCurrentHash: before.ontology.current.hash, attemptId: receipt.attemptId,
      }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
    }
    assert.throws(() => service.get(retainedOwner, { attemptId: oldOptions.attemptId }), refusal('ACCESS_REVOKED'));
    assert.equal(JSON.stringify(target.vault.read()), JSON.stringify(before));
    assert.deepEqual(await target.ciphertext(), ciphertext, 'Refused historical IDs cannot mutate target history, learning, audit or encrypted snapshot.');
  }
  const targetService = new OntologyService(target.vault), inert = structuredClone(target.vault.read().ontology.historicalPublicationEvidence);
  const freshOptions = { expectedCurrentHash: targetService.current(fresh)!.hash, attemptId: 'joined_fresh_reviewed_attempt' };
  const freshDictionary = await targetService.publish(fresh, starterPacks[0], freshOptions);
  assert.equal(freshDictionary.version, original.ontology.current.version + 1);
  const receipt = targetService.get(fresh, { attemptId: freshOptions.attemptId }).attempt!;
  assert.equal(receipt.workspaceId, summary.workspaceId); assert.equal(receipt.memberId, fresh.memberId); assert.equal(receipt.epoch, fresh.epoch);
  assert.deepEqual(target.vault.read().ontology.historicalPublicationEvidence, inert);
  await target.reopen();
  const reopened = new OntologyService(target.vault), stored = target.vault.read(), ciphertext = await target.ciphertext();
  assert.deepEqual(reopened.get(fresh, { attemptId: freshOptions.attemptId }).attempt, receipt);
  assert.deepEqual(await reopened.publish(fresh, starterPacks[0], freshOptions), freshDictionary);
  assert.deepEqual(target.vault.read(), stored); assert.deepEqual(await target.ciphertext(), ciphertext);
  assert.throws(() => reopened.get(fresh, { attemptId: oldOptions.attemptId }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  assert.deepEqual(reopened.get(fresh, {}).history.slice(0, original.ontology.history.length), original.ontology.history);
  assert.equal(activation.counts().commits, 1); assert.equal(activation.counts().allocations, 1);

  const second = ontologyRetainedActivationFixture(() => target.vault.read(), () => {}, {
    sourceContext: fresh, targetWorkspaceId: 'workspace_synthetic_second_target', freshOwnerId: 'fresh_second_ontology_owner',
  });
  const secondReview = (await second.activate()).review, twice = second.readback();
  assert.equal(twice.status, 'committed'); if (twice.status !== 'committed') return;
  assert.deepEqual(secondReview.ontologyDisposition, {
    format: 'chausar.ontology-historical-projection.v1', sourceWorkspaceId: summary.workspaceId,
    sourceOntologyDigest: interchangeDigest(target.vault.read().ontology), publicationAttempts: 'inert-origin-evidence', historicalPublicationEvidence: 'preserved',
  });
  assert.deepEqual(readHistoricalWorkspaceState(JSON.parse(twice.evidence.content).archive), target.vault.read());
  assert.equal(Object.hasOwn(twice.state.ontology, 'publicationAttempts'), false);
  assert.deepEqual(twice.state.ontology.historicalPublicationEvidence, [...inert,
    { workspaceId: summary.workspaceId, publicationAttempts: [receipt] }]);
  const secondTarget = await openOntologyActivatedTarget(t, twice), secondFresh = twice.authority.context;
  await secondTarget.reopen(); const twiceService = new OntologyService(secondTarget.vault);
  for (const attemptId of [oldOptions.attemptId, freshOptions.attemptId]) {
    assert.throws(() => twiceService.get(secondFresh, { attemptId }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
    await assert.rejects(twiceService.publish(secondFresh, starterPacks[0], {
      expectedCurrentHash: twiceService.current(secondFresh)!.hash, attemptId,
    }), refusal('DICTIONARY_ATTEMPT_AUTHORITY'));
  }
});

test('activation preserves legacy receipt absence and explicit empty modern receipt evidence distinctly', async t => {
  for (const present of [false, true]) await t.test(present ? 'explicit empty receipt namespace' : 'legacy receipt absence', async sub => {
    const source = await retainedInterchangeFixture(sub, { populate: false });
    if (present) await source.vault.update(state => { state.ontology.publicationAttempts = []; });
    const original = source.vault.read(), activation = ontologyRetainedActivationFixture(() => source.vault.read());
    const { review } = await activation.activate(), read = activation.readback();
    assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
    const historical = readHistoricalWorkspaceState(JSON.parse(read.evidence.content).archive);
    assert.equal(Object.hasOwn(historical.ontology, 'publicationAttempts'), present);
    assert.equal(Object.hasOwn(read.state.ontology, 'publicationAttempts'), false);
    assert.equal(Object.hasOwn(read.state.ontology, 'historicalPublicationEvidence'), present);
    if (present) {
      assert.deepEqual(read.state.ontology.historicalPublicationEvidence, [{ workspaceId: original.workspace.id, publicationAttempts: [] }]);
      assert.deepEqual(review.ontologyDisposition, {
        format: 'chausar.ontology-historical-projection.v1', sourceWorkspaceId: original.workspace.id,
        sourceOntologyDigest: interchangeDigest(original.ontology), publicationAttempts: 'inert-origin-evidence', historicalPublicationEvidence: 'absent',
      });
    } else {
      assert.equal(Object.hasOwn(review, 'ontologyDisposition'), false);
      assert.deepEqual(read.state.ontology, original.ontology);
    }
    const target = await openOntologyActivatedTarget(sub, read); await target.reopen();
    assert.deepEqual(target.vault.read().ontology, read.state.ontology);
    assert.equal(new OntologyService(target.vault).get(read.authority.context, { attemptId: 'joined_empty_missing_attempt' }).attempt, null);
  });
});

test('deferred source backup and encrypted reopen retain review state while activation refuses an unpublished policy', async t => {
  for (const retained of [false, true]) await t.test(retained ? 'empty scenario and lesson namespaces' : 'no scenario or lesson namespaces', async sub => {
    const directory = await mkdtemp(join(await realpath(tmpdir()), 'chausar-ontology-retained-deferred-'));
    const passphrase = 'Synthetic deferred retained source passphrase';
    let vault = (await Vault.create({ directory, storage: 'experimental-file', passphrase,
      name: 'Synthetic deferred retained source', dictionaryMode: 'deferred' })).vault;
    const restored: Vault[] = [];
    sub.after(async () => {
      await vault.close(); for (const handle of restored) await handle.close();
      await rm(directory, { recursive: true, force: true });
    });
    if (retained) await vault.update(state => {
      state.scenarioRecords = []; state.lessonState = { workspaceId: state.workspace.id, episodes: [], lessons: [] };
    });
    const state = vault.read();
    assert.deepEqual(state.ontology, { current: null, history: [], firstRunReviewRequired: true });
    assert.deepEqual(state.learning, []); assert.deepEqual(state.activity, []);
    const beforeBackup = join(directory, 'before-review.chausar-backup');
    await vault.backup(beforeBackup);
    assert.equal((await readFile(beforeBackup, 'utf8')).includes('firstRunReviewRequired'), false);
    const beforeRestore = await Vault.restore({ directory: join(directory, 'before-review-restored'),
      storage: 'experimental-file', passphrase, backupFile: beforeBackup });
    restored.push(beforeRestore);
    assert.deepEqual(beforeRestore.read(), state);
    await assert.rejects(new OntologyService(beforeRestore).publish(retainedOwner, starterPacks[0]), refusal('DICTIONARY_REVIEW_REQUIRED'));
    const restoredDeferred = ontologyRetainedActivationFixture(() => beforeRestore.read());
    await assert.rejects(restoredDeferred.host().review(retainedOwner, restoredDeferred.request), refusal('ACTIVATION_DICTIONARY'));
    assert.equal(restoredDeferred.counts().allocations, 0); assert.equal(restoredDeferred.counts().commits, 0);
    const activation = ontologyRetainedActivationFixture(() => vault.read());
    const archive = JSON.parse(activation.candidateRead().content).archive;
    assert.deepEqual(readHistoricalWorkspaceState(archive), state);
    assert.equal(JSON.stringify(readHistoricalWorkspaceState(archive).ontology), JSON.stringify(state.ontology));
    const ciphertext = await readFile(join(directory, 'authority.encrypted.json'));
    await vault.close(); vault = await Vault.open({ directory, storage: 'experimental-file', passphrase });
    assert.equal(JSON.stringify(vault.read()), JSON.stringify(state));
    await assert.rejects(activation.host().review(retainedOwner, activation.request), refusal('ACTIVATION_DICTIONARY'));
    assert.equal(activation.counts().allocations, 0); assert.equal(activation.counts().commits, 0);
    assert.deepEqual(vault.read(), state); assert.deepEqual(await readFile(join(directory, 'authority.encrypted.json')), ciphertext);
    const service = new OntologyService(vault);
    await assert.rejects(service.publish(retainedOwner, starterPacks[0]), refusal('DICTIONARY_REVIEW_REQUIRED'));
    const firstOptions = {
      expectedCurrentHash: null, attemptId: 'joined_deferred_first_reviewed_attempt',
    };
    const first = await service.publish(retainedOwner, starterPacks[0], firstOptions);
    assert.equal(first.version, 1); assert.equal(Object.hasOwn(vault.read().ontology, 'firstRunReviewRequired'), false);
    const afterBackup = join(directory, 'after-review.chausar-backup');
    await vault.backup(afterBackup);
    assert.equal((await readFile(afterBackup, 'utf8')).includes(firstOptions.attemptId), false);
    const afterRestoreDirectory = join(directory, 'after-review-restored');
    let afterRestore = await Vault.restore({ directory: afterRestoreDirectory, storage: 'experimental-file', passphrase, backupFile: afterBackup });
    restored.push(afterRestore);
    assert.deepEqual(afterRestore.read(), vault.read());
    const restoredSnapshot = afterRestore.read(), restoredCiphertext = await readFile(join(afterRestoreDirectory, 'authority.encrypted.json'));
    const restoredService = new OntologyService(afterRestore);
    assert.deepEqual(restoredService.get(retainedOwner, { attemptId: firstOptions.attemptId }).attempt,
      vault.read().ontology.publicationAttempts[0]);
    assert.deepEqual(await restoredService.publish(retainedOwner, starterPacks[0], firstOptions), first);
    assert.deepEqual(afterRestore.read(), restoredSnapshot);
    assert.deepEqual(await readFile(join(afterRestoreDirectory, 'authority.encrypted.json')), restoredCiphertext);
    await afterRestore.close();
    afterRestore = await Vault.open({ directory: afterRestoreDirectory, storage: 'experimental-file', passphrase });
    restored.push(afterRestore);
    assert.deepEqual(afterRestore.read(), restoredSnapshot);
    assert.deepEqual(readHistoricalWorkspaceState(archive).ontology, state.ontology,
      'The earlier deferred backup remains historical after the explicit reviewed publication.');
    const published = ontologyRetainedActivationFixture(() => afterRestore.read());
    await published.activate(); const read = published.readback();
    assert.equal(read.status, 'committed'); if (read.status !== 'committed') return;
    assert.equal(Object.hasOwn(read.state.ontology, 'firstRunReviewRequired'), false);
    assert.equal(Object.hasOwn(read.state.ontology, 'publicationAttempts'), false);
    assert.equal(read.state.ontology.historicalPublicationEvidence[0].publicationAttempts[0].dictionaryHash, first.hash);
  });
});
