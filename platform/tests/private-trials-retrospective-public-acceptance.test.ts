import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { fixture, selectSavedAnswers, assertReplay, assertNoForkSnapshot,
  assertReviewedDictionary } from './fixtures/private-trials-public-acceptance.ts';

// Execute only after the parent binds these requests to the frozen public join.
const typedRefusal = (error: unknown) => Boolean(error && typeof error === 'object'
  && typeof (error as { code?: unknown }).code === 'string'
  && typeof (error as { message?: unknown }).message === 'string');

test('delayed retrospective publication retains new and original receipts with public interpretation context across reopen and source revocation', async t => {
  const f = await fixture(t), savedAnswerIds = await selectSavedAnswers(f);
  const originalAnswers: any[] = await f.request('trials.savedQuestions');
  const originalReceipts: any[] = await Promise.all(originalAnswers.map(answer => f.request('receipts.get', { id: answer.receiptId })));
  const inherited = originalAnswers.filter(answer => !savedAnswerIds.includes(answer.id));
  t.diagnostic(JSON.stringify({ qualification: 'actual-renderer-context-load',
    inheritedSavedRequests: inherited.map(answer => ({ operation: answer.request.operation,
      requestedAsOf: answer.request.asOf ?? null,
      resolvedAsOf: originalReceipts.find(receipt => receipt.id === answer.receiptId).asOf })) }));
  const baselineFacts: any[] = (await f.request('memory.list')).facts;
  assert.ok(Array.isArray(baselineFacts));
  const baselineById = new Map(baselineFacts.map(fact => {
    const original = structuredClone(fact);
    // memory.list adds this undefined query projection; custody retains raw Facts.
    if (Object.hasOwn(original.fields, 'customerId') && original.fields.customerId === undefined) delete original.fields.customerId;
    return [original.id, original] as const;
  }));
  const created = await f.request('trials.create', { version: 1, savedAnswerIds, change: f.change });
  assert.equal(created.status, 'created'); assert.deepEqual(created.savedAnswerIds, savedAnswerIds);
  assertNoForkSnapshot(created);
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId });
  assert.equal(evaluated.status, 'evaluated'); assertNoForkSnapshot(evaluated);
  assertReplay(f, evaluated.evaluation, savedAnswerIds, created.candidatePin);
  const impact = await f.request('trials.impact', { trialId: created.trialId, strategy: 'retrospective' });
  assert.equal(impact.complete, true); assert.equal(impact.strategy, 'retrospective');
  assert.deepEqual([...impact.rebuildArtifactIds].sort(), originalAnswers.map(answer => answer.id).sort());
  assert.ok(f.receipts.every(receipt => impact.historicalReceiptIdsToPreserve.includes(receipt.id)));
  f.advance(1000); assert.ok(Date.now() > Date.parse(created.createdAt));
  const promoted = await f.request('trials.promote', { trialId: created.trialId,
    evaluationDigest: evaluated.evaluationDigest, strategy: 'retrospective', acknowledgedImpactDigest: impact.digest });
  assert.equal(promoted.status, 'promoted'); assert.equal(promoted.trialId, created.trialId);
  assert.match(promoted.publicationId, /^[A-Za-z0-9_-]{1,160}$/);
  assertReviewedDictionary(f, (await f.request('ontology.get')).current, created.candidatePin);

  const originalIds = f.receipts.map(receipt => receipt.id), allOriginalIds = originalReceipts.map(receipt => receipt.id);
  const answers = await f.request('trials.savedQuestions');
  assert.ok(Array.isArray(answers));
  const fresh = answers.filter((answer: any) => !allOriginalIds.includes(answer.receiptId));
  assert.equal(fresh.length, impact.rebuildArtifactIds.length);
  const selected = f.requests.map(request => {
    const matches = fresh.filter((answer: any) => isDeepStrictEqual(answer.request, request));
    assert.equal(matches.length, 1, 'Each exact original saved request receives one new restated receipt.');
    assert.ok(!savedAnswerIds.includes(matches[0].id)); return matches[0];
  });
  assert.equal(new Set(selected.map(answer => answer.receiptId)).size, 3);
  const totals = ['100', '7000', '12500'], receipts: any[] = [], contexts: any[] = [];
  for (const [index, answer] of selected.entries()) {
    const receipt = await f.request('receipts.get', { id: answer.receiptId });
    assert.equal(receipt.id, answer.receiptId); assert.equal(receipt.totalMinor, totals[index]);
    assert.equal(receipt.dictionaryHash, created.candidatePin.dictionaryHash);
    assert.equal(receipt.ontologyVersion, created.candidatePin.dictionaryVersion);
    assert.equal(receipt.asOf, f.requests[index].asOf); assert.equal(receipt.operation, f.requests[index].operation);
    assert.deepEqual(receipt.rowIds, f.receipts[index].rowIds);
    assert.deepEqual(receipt.restatement, { version: 1, interpretation: 'restated-private-diagnostic',
      trialId: created.trialId, forkDigest: created.forkDigest, candidateStateDigest: created.candidatePin.stateDigest,
      publicationId: promoted.publicationId, originalAnswerId: savedAnswerIds[index], originalReceiptId: originalIds[index] });
    const context = await f.request('trials.receiptContext', { receiptId: receipt.id });
    assertNoForkSnapshot(context);
    assert.equal(context.receiptId, receipt.id); assert.equal(context.interpretation, 'restated-private-diagnostic');
    assert.deepEqual(context.originalReceipt, f.receipts[index]);
    assert.equal(context.forkDigest, created.forkDigest); assert.deepEqual(context.candidatePin, created.candidatePin);
    assert.deepEqual(context.change, f.change);
    assert.deepEqual(context.rows.map((row: any) => row.factId), receipt.rowIds);
    for (const row of context.rows) {
      const original = baselineById.get(row.factId); assert.ok(original);
      assert.deepEqual(row.original, original);
      assert.deepEqual(row.restated, original, 'A definition restatement changes meaning while retaining the same imported source facts.');
    }
    assert.deepEqual(await f.request('receipts.get', { id: originalIds[index] }), f.receipts[index]);
    receipts.push(receipt); contexts.push(context);
  }

  await f.reopen();
  for (const receipt of originalReceipts) assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
  for (const [index, receipt] of receipts.entries()) {
    assert.deepEqual(await f.request('receipts.get', { id: receipt.id }), receipt);
    assert.deepEqual(await f.request('receipts.get', { id: originalIds[index] }), f.receipts[index]);
    const context = await f.request('trials.receiptContext', { receiptId: receipt.id });
    assertNoForkSnapshot(context); assert.deepEqual(context, contexts[index]);
  }
  await f.request('trust.update', { allowedSources: ['other-source'] });
  for (const receipt of receipts) {
    await assert.rejects(f.request('trials.receiptContext', { receiptId: receipt.id }), typedRefusal);
  }
});
