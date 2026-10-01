import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import type { PrivateTrialChange, PrivateTrialEvaluation } from '../runtime/private-trial-contracts.ts';
import { fixture, selectSavedAnswers, saveScenario, assertReplay, assertScenarioReplay, assertCandidateReceipt, assertNoForkSnapshot,
  assertUnchangedAuthority, assertReviewedDictionary, receiptContent, historicalReceiptContent, CUT, SOURCE,
  type Fixture } from './fixtures/private-trials-public-acceptance.ts';

// Pending committed endpoint join. Names and summary fields below were supplied
// by the coordinator; verify all bindings against the frozen candidate before execution.
// These are actual public requests, with no host proof or private State fixture.
const typedRefusal = (error: unknown) => Boolean(error && typeof error === 'object'
  && typeof (error as { code?: unknown }).code === 'string'
  && typeof (error as { message?: unknown }).message === 'string');

async function stage(f: Fixture, receipts: CalculationReceipt[] = f.receipts, change: PrivateTrialChange = f.change) {
  const savedAnswerIds = await selectSavedAnswers(f, receipts);
  assert.equal(savedAnswerIds.length, receipts.length); assert.equal(new Set(savedAnswerIds).size, receipts.length);
  const before = await f.evidence(), setupDisk = await f.disk(), started = performance.now();
  const expectedCreatedAt = new Date().toISOString();
  const created = await f.request('trials.create', { version: 1, savedAnswerIds, change });
  const createElapsedMs = performance.now() - started; assertNoForkSnapshot(created);
  assert.equal(created.status, 'created'); assert.equal(created.createdAt, expectedCreatedAt);
  assert.equal(created.interpretation, 'restated-private-diagnostic'); assert.deepEqual(created.savedAnswerIds, savedAnswerIds);
  assert.equal(created.baselinePin.dictionaryHash, f.dictionary.hash);
  assert.match(created.trialId, /^[A-Za-z0-9_.:-]{1,200}$/); assert.match(created.forkDigest, /^[a-f0-9]{64}$/);
  assert.equal(created.evaluationDigest, null); assert.ok(created.cost.forkDiskBytes > 0);
  assert.ok(created.cost.bindingDiskBytes > 0);
  assert.equal(created.cost.totalDiskBytes, created.cost.forkDiskBytes + created.cost.evaluationDiskBytes + created.cost.bindingDiskBytes);
  const forkDisk = await f.disk(); assert.ok(forkDisk.bytes > setupDisk.bytes);
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId }); assertNoForkSnapshot(evaluated);
  assert.equal(evaluated.status, 'evaluated'); assert.equal(evaluated.trialId, created.trialId);
  assert.ok(evaluated.evaluation); const evaluation = evaluated.evaluation as PrivateTrialEvaluation;
  assert.equal(evaluation.trialId, created.trialId); assert.equal(evaluation.forkDigest, created.forkDigest);
  assert.equal(evaluated.evaluationDigest, evaluation.digest);
  assert.deepEqual(evaluated.baselinePin, created.baselinePin); assert.deepEqual(evaluated.candidatePin, created.candidatePin);
  assert.ok(evaluated.cost.evaluationDiskBytes > 0);
  assert.equal(evaluated.cost.totalDiskBytes, evaluated.cost.forkDiskBytes + evaluated.cost.evaluationDiskBytes + evaluated.cost.bindingDiskBytes);
  const evaluationDisk = await f.disk(); assert.ok(evaluationDisk.bytes > forkDisk.bytes);
  return { savedAnswerIds, before, created, evaluated, evaluation, setupDisk, forkDisk, evaluationDisk, createElapsedMs };
}
async function promotion(f: Fixture, value: Awaited<ReturnType<typeof stage>>, strategy = 'prospective') {
  const impact = await f.request('trials.impact', { trialId: value.created.trialId, strategy });
  assert.equal(impact.trialId, value.created.trialId); assert.equal(impact.evaluationDigest, value.evaluation.digest);
  assert.equal(impact.strategy, strategy); assert.equal(impact.complete, true);
  assert.ok(impact.historicalReceiptIdsToPreserve.includes(f.receipts[0].id));
  return { impact, payload: { trialId: value.created.trialId, evaluationDigest: value.evaluation.digest,
    strategy, acknowledgedImpactDigest: impact.digest } };
}

test('public private definition trial replays three saved requests and exact large receipts without changing live authority', async t => {
  const f = await fixture(t), value = await stage(f);
  assertReplay(f, value.evaluation, value.savedAnswerIds, value.created.candidatePin);
  const read = await f.request('trials.get', { trialId: value.created.trialId }); assertNoForkSnapshot(read);
  assert.deepEqual(read.evaluation, value.evaluation); await assertUnchangedAuthority(f, value.before);
  assert.ok(value.evaluation.comparisons.every(comparison => comparison.request.asOf === CUT));
  assert.ok(!f.h.calls.some(call => call.method.startsWith('models.') && call.method !== 'models.list'));
});

test('public trial preserves saved textual scenario assumptions while both receipts use normalized exact arithmetic', async t => {
  const f = await fixture(t), scenario = await saveScenario(f), value = await stage(f, [scenario.receipt]);
  assertScenarioReplay(value.evaluation, scenario, value.savedAnswerIds[0], value.created.candidatePin);
  await f.reopen(); const read = await f.request('trials.get', { trialId: value.created.trialId });
  assert.deepEqual(read.evaluation, value.evaluation);
  assertScenarioReplay(read.evaluation, scenario, value.savedAnswerIds[0], value.created.candidatePin);
});

test('trial ciphertext custody survives new Engine reopen and managed discard removes artifacts with measured disk costs', async t => {
  const f = await fixture(t), value = await stage(f);
  await f.reopen(); const reopened = await f.request('trials.get', { trialId: value.created.trialId });
  assert.deepEqual(reopened.evaluation, value.evaluation); assertNoForkSnapshot(reopened);
  const beforeDiscard = await f.disk(), started = performance.now();
  const createdFiles = value.forkDisk.files.filter(file => !value.setupDisk.files.some(before => before.path === file.path));
  const forkFiles = createdFiles.filter(file => file.bytes === value.created.cost.forkDiskBytes);
  assert.equal(forkFiles.length, 1, 'Public fork byte cost must match an actual new ciphertext file.');
  const evaluationFiles = value.evaluationDisk.files.filter(file => !value.forkDisk.files.some(before => before.path === file.path));
  assert.equal(evaluationFiles.length, 1, 'Evaluation must create one independently retained ciphertext artifact.');
  assert.equal(evaluationFiles[0].bytes, value.evaluated.cost.evaluationDiskBytes);
  const discarded = await f.request('trials.discard', { trialId: value.created.trialId }), discardElapsedMs = performance.now() - started;
  assert.equal(discarded.cleanupComplete, true); assert.ok(discarded.removedDiskBytes > 0);
  assert.ok(discarded.retainedTombstoneDiskBytes >= 0);
  const afterDiscard = await f.disk(); assert.ok(afterDiscard.bytes < beforeDiscard.bytes);
  const removedFiles = [...forkFiles, ...evaluationFiles];
  assert.ok(removedFiles.every(file => !afterDiscard.files.some(after => after.path === file.path)),
    'Discard must remove the specific fork and evaluation artifacts, not merely reduce net workspace bytes.');
  assert.equal(discarded.removedDiskBytes, removedFiles.reduce((bytes, file) => bytes + file.bytes, 0));
  assert.deepEqual(discarded.failedArtifactIds, []);
  const retainedFiles = afterDiscard.files.filter(file => !value.setupDisk.files.some(before => before.path === file.path));
  assert.equal(retainedFiles.length, 1); assert.equal(retainedFiles[0].bytes, discarded.retainedTombstoneDiskBytes);
  await assert.rejects(f.request('trials.get', { trialId: value.created.trialId }), typedRefusal);
  await assert.rejects(f.request('trials.evaluate', { trialId: value.created.trialId }), typedRefusal);
  await f.reopen(); await assert.rejects(f.request('trials.get', { trialId: value.created.trialId }), typedRefusal);
  await assertUnchangedAuthority(f, value.before);
  t.diagnostic(JSON.stringify({ qualification: 'synthetic-experimental-encrypted-custody', createElapsedMs: value.createElapsedMs,
    discardElapsedMs, setupDiskBytes: value.setupDisk.bytes, createdDiskBytes: value.forkDisk.bytes,
    evaluatedDiskBytes: value.evaluationDisk.bytes, removedDiskBytes: discarded.removedDiskBytes,
    retainedTombstoneDiskBytes: discarded.retainedTombstoneDiskBytes, remainingDiskBytes: afterDiscard.bytes }));
});

test('public trial reads, evaluation and promotion recheck revoked current source authority after encrypted reopen', async t => {
  const f = await fixture(t), value = await stage(f), review = await promotion(f, value);
  await f.request('trust.update', { allowedSources: ['other-source'] }); await f.reopen();
  for (const method of ['trials.get', 'trials.evaluate']) await assert.rejects(f.request(method, { trialId: value.created.trialId }), typedRefusal);
  await assert.rejects(f.request('trials.promote', review.payload), typedRefusal);
  assert.equal((await f.request('ontology.get')).current.hash, f.dictionary.hash);
  assert.deepEqual((await f.request('trust.get')).allowedSources, ['other-source']);
  assert.deepEqual(await f.request('sources.list'), []);
});

test('a real source correction stales an acknowledged trial and refused publication leaves correction evidence unchanged', async t => {
  const f = await fixture(t), value = await stage(f), review = await promotion(f, value);
  const fact = value.before.facts.facts.find((row: any) => row.entityId === 'huge'); assert.ok(fact);
  await f.request('memory.correct', { id: fact.id, fields: { amountMinor: '900719925474099326' } });
  const corrected = await f.evidence();
  assert.deepEqual(corrected.receipts.map(historicalReceiptContent), f.receipts.map(historicalReceiptContent));
  assert.ok(corrected.receipts.every(receipt => receipt.stale), 'Ordinary source correction marks existing receipts stale.');
  assert.equal(corrected.facts.facts.find((row: any) => row.entityId === 'huge').fields.amountMinor, '900719925474099326');
  for (const method of ['trials.get', 'trials.evaluate']) await assert.rejects(f.request(method, { trialId: value.created.trialId }), typedRefusal);
  await assert.rejects(f.request('trials.promote', review.payload), typedRefusal);
  await assertUnchangedAuthority(f, corrected);
});

test('a real trial author owns saved receipts and an actually revoked author epoch cannot reopen that private trial', async t => {
  const f = await fixture(t, 'definition', 'cofounder'), value = await stage(f); assert.ok(f.author);
  assert.equal(value.created.memberId, f.author.id); assert.equal(value.created.epoch, f.author.epoch);
  assert.ok(f.receipts.every(receipt => receipt.memberId === f.author!.id));
  f.as(); await assert.rejects(f.request('trials.get', { trialId: value.created.trialId }), typedRefusal);
  await f.request('members.revoke', { id: f.author.id }); f.as(f.author);
  await assert.rejects(f.request('trials.get', { trialId: value.created.trialId }), { code: 'ACCESS_REVOKED' });
  await assert.rejects(f.request('trials.evaluate', { trialId: value.created.trialId }), { code: 'ACCESS_REVOKED' }); f.as();
});

test('exact impact acknowledgement is required and delayed review cannot silently change the reviewed publication hash', async t => {
  const f = await fixture(t), value = await stage(f), review = await promotion(f, value);
  await assert.rejects(f.request('trials.promote', { ...review.payload, acknowledgedImpactDigest: 'unacknowledged' }), typedRefusal);
  await assert.rejects(f.request('trials.promote', { trialId: value.created.trialId, evaluationDigest: value.evaluation.digest,
    strategy: 'prospective' }), typedRefusal);
  await assertUnchangedAuthority(f, value.before);
  f.advance(1000);
  const activatedAt = new Date().toISOString(), published = await f.request('trials.promote', review.payload);
  assert.equal(published.trialId, value.created.trialId); assert.equal(published.status, 'promoted');
  const current = await f.request('ontology.get'); assertReviewedDictionary(f, current.current, value.created.candidatePin);
  assert.equal(current.current.publishedAt, value.created.createdAt,
    'Reviewed compilation metadata is preserved separately from later operational activation.');
  const events = (await f.request('activity.list')).items.filter((event: any) => event.event === 'private-trial.published'
    && event.details.publicationId === published.publicationId);
  assert.equal(events.length, 1); assert.equal(events[0].details.trialId, value.created.trialId);
  assert.equal(events[0].details.candidatePin, value.created.candidatePin.stateDigest);
  assert.equal(events[0].details.activatedAt, activatedAt); assert.equal(events[0].at, activatedAt);
  assert.notEqual(activatedAt, current.current.publishedAt);
  for (const receipt of f.receipts) assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
});

test('competing reviewed definition promotions admit one atomic activation and duplicate promotion cannot publish again', async t => {
  const f = await fixture(t), left = await stage(f); assert.equal(f.change.type, 'definition');
  if (f.change.type !== 'definition') throw new Error('Expected definition trial.');
  const alternative: PrivateTrialChange = { ...f.change, replacement: { ...f.change.replacement, sign: -1,
    meaning: 'Synthetic alternative: negative explicitly imported invoice tax, by invoice date.' } };
  const right = await stage(f, f.receipts, alternative), leftReview = await promotion(f, left), rightReview = await promotion(f, right);
  const before = await f.request('ontology.get');
  const outcomes = await Promise.allSettled([f.request('trials.promote', leftReview.payload), f.request('trials.promote', rightReview.payload)]);
  assert.equal(outcomes.filter(outcome => outcome.status === 'fulfilled').length, 1, 'One current base authorizes exactly one competing activation.');
  const winner = outcomes[0].status === 'fulfilled' ? left : right;
  const current = await f.request('ontology.get'); assert.equal(current.history.length, before.history.length + 1);
  const expectedFixture = outcomes[0].status === 'fulfilled' ? f : { ...f, change: alternative };
  assertReviewedDictionary(expectedFixture, current.current, winner.created.candidatePin);
  for (const receipt of f.receipts) {
    const retained = await f.request('receipts.get', { id: receipt.id });
    assert.deepEqual(retained, receipt, 'Atomic publication preserves immutable historical receipt bodies.');
  }
  const payload = outcomes[0].status === 'fulfilled' ? leftReview.payload : rightReview.payload;
  await assert.rejects(f.request('trials.promote', payload), typedRefusal);
  assert.deepEqual(await f.request('ontology.get'), current, 'A duplicate promotion cannot create another dictionary revision.');
});

test('public recipe trial replays complete reordered import generations and preserves controls without claiming producer retraction', async t => {
  const f = await fixture(t, 'recipe', undefined, { reorderedCapture: true }); assert.ok(f.reordered);
  assert.deepEqual((await f.request('sources.list')).map((record: any) => record.id).sort(), [f.imported.id, f.reordered.id].sort());
  assert.deepEqual(f.receipts[0].coverage.importIds.slice().sort(), [f.imported.id, f.reordered.id].sort());
  const value = await stage(f); assertReplay(f, value.evaluation, value.savedAnswerIds, value.created.candidatePin, 'recipe');
  const pinnedRecipes = value.created.baselinePin.recipes.filter((entry: any) => entry.sourceId === SOURCE);
  assert.equal(pinnedRecipes.length, 1); assert.match(pinnedRecipes[0].generationsDigest, /^[a-f0-9]{64}$/);
  assert.equal(value.evaluation.comparisons[0].candidate.status, 'calculated');
  if (value.evaluation.comparisons[0].candidate.status !== 'calculated') throw new Error('Expected candidate cancellation interpretation.');
  assert.equal(value.evaluation.comparisons[0].candidate.receipt.coverage.countedRows, 1);
  assert.equal((await f.request('memory.list')).facts.length, 2, 'Private interpretation leaves both live source facts unchanged.');
  await assertUnchangedAuthority(f, value.before); await f.reopen();
  assert.deepEqual((await f.request('trials.get', { trialId: value.created.trialId })).evaluation, value.evaluation);
});

test('a recipe money-unit change that violates actual source controls stays refused and cannot promote', async t => {
  const f = await fixture(t, 'recipe'); assert.equal(f.change.type, 'recipe');
  if (f.change.type !== 'recipe') throw new Error('Expected recipe trial.');
  const invalid = structuredClone(f.change); invalid.replacement.bindings.find(binding => binding.target === 'amountMinor')!.moneyUnit = 'major';
  const value = await stage(f, f.receipts, invalid);
  assert.ok(value.evaluation.comparisons.every(comparison => comparison.baseline.status === 'calculated'
    && comparison.candidate.status === 'refused' && comparison.totalDeltaMinor === null));
  const review = await promotion(f, value);
  await assert.rejects(f.request('trials.promote', review.payload), { code: 'TRIAL_PROMOTION_REFUSED' });
  await assertUnchangedAuthority(f, value.before);
});

test('successive public recipe publications reduce counted invoices from two to one to zero while retaining two source facts and historical cuts', async t => {
  const f = await fixture(t, 'recipe'), first = await stage(f), firstReview = await promotion(f, first);
  assertReplay(f, first.evaluation, first.savedAnswerIds, first.created.candidatePin, 'recipe');
  assert.equal(f.receipts[0].coverage.countedRows, 2); assert.equal(f.receipts[0].totalMinor, '30000');
  f.advance(1000); const firstCut = new Date().toISOString();
  const firstPublished = await f.request('trials.promote', firstReview.payload); assert.equal(firstPublished.status, 'promoted');
  const firstFacts = (await f.request('memory.list')).facts;
  assert.equal(firstFacts.length, 2);
  assert.deepEqual(firstFacts.map((fact: any) => [fact.entityId, fact.fields.status]).sort(),
    [['one', 'settled'], ['two', 'cancelled']]);
  const freshRequests = f.requests.map(request => ({ ...request, asOf: firstCut }));
  const freshReceipts: CalculationReceipt[] = [];
  for (const request of freshRequests) freshReceipts.push(await f.request('calculation.run', request));
  assert.deepEqual(freshReceipts.map(receipt => receipt.totalMinor), ['10000', '0', '0']);
  assert.equal(freshReceipts[0].coverage.countedRows, 1);
  assert.equal(f.change.type, 'recipe'); if (f.change.type !== 'recipe') throw new Error('Expected recipe publication.');
  const nextChange = structuredClone(f.change);
  nextChange.replacement.bindings.find(binding => binding.target === 'status')!.values!.OPEN = 'cancelled';
  const fresh = { ...f, requests: freshRequests, receipts: freshReceipts, change: nextChange };
  const second = await stage(fresh), secondReview = await promotion(fresh, second);
  assert.deepEqual(second.evaluation.comparisons.map(comparison => comparison.request), freshRequests);
  for (const [index, comparison] of second.evaluation.comparisons.entries()) {
    assert.equal(comparison.baseline.status, 'calculated'); assert.equal(comparison.candidate.status, 'calculated');
    if (comparison.baseline.status !== 'calculated' || comparison.candidate.status !== 'calculated') throw new Error('Expected second paired recipe receipts.');
    assert.deepEqual(receiptContent(comparison.baseline.receipt), receiptContent(freshReceipts[index]));
    assertCandidateReceipt(comparison.candidate.receipt, freshReceipts[index], freshRequests[index], second.created.candidatePin);
    assert.equal(comparison.candidate.receipt.totalMinor, '0');
    assert.equal(comparison.totalDeltaMinor, index === 0 ? '-10000' : '0');
  }
  f.advance(1000); const secondCut = new Date().toISOString();
  const secondPublished = await f.request('trials.promote', secondReview.payload); assert.equal(secondPublished.status, 'promoted');
  assert.notEqual(secondPublished.publicationId, firstPublished.publicationId);
  const currentRequest = { ...f.requests[0], asOf: secondCut };
  const current = await f.request('calculation.run', currentRequest);
  assert.equal(current.totalMinor, '0'); assert.equal(current.coverage.countedRows, 0);
  const secondFacts = (await f.request('memory.list')).facts;
  assert.equal(secondFacts.length, 2); assert.ok(secondFacts.every((fact: any) => fact.fields.status === 'cancelled'));
  const historical = await f.request('calculation.run', f.requests[0]);
  assert.equal(historical.asOf, CUT); assert.equal(historical.totalMinor, '30000'); assert.equal(historical.coverage.countedRows, 2);
  for (const receipt of [...f.receipts, ...freshReceipts]) assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
  assert.equal((await f.request('ontology.get')).current.hash, f.dictionary.hash);
  await f.reopen(); const reopened = await f.request('calculation.run', currentRequest);
  assert.equal(reopened.totalMinor, '0'); assert.equal(reopened.coverage.countedRows, 0);
  assert.equal((await f.request('memory.list')).facts.length, 2);
  for (const receipt of f.receipts) assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
  t.diagnostic('Counted invoice reduction 2→1→0 under two actual recipe publications; two source facts remain. This does not establish a producer relation shrinking to justified empty.');
});
