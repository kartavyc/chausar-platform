import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, selectSavedAnswers, assertUnchangedAuthority, type Fixture } from './fixtures/private-trials-public-acceptance.ts';

// Bind and run only after the parent imports the frozen public endpoint join.
// Every request uses the fixture's actual preload and strict IPC boundary.
const typedRefusal = (error: unknown) => Boolean(error && typeof error === 'object'
  && typeof (error as { code?: unknown }).code === 'string'
  && typeof (error as { message?: unknown }).message === 'string');

async function create(f: Fixture) {
  const savedAnswerIds = await selectSavedAnswers(f);
  const created = await f.request('trials.create', { version: 1, savedAnswerIds, change: f.change });
  assert.equal(created.status, 'created'); assert.equal(created.evaluationDigest, null);
  assert.match(created.trialId, /^[A-Za-z0-9_.:-]{1,200}$/);
  assert.deepEqual(created.savedAnswerIds, savedAnswerIds);
  return { created, savedAnswerIds };
}

test('strict trial create and promotion reject malformed or extra host-authority fields without changing live evidence', async t => {
  const f = await fixture(t), before = await f.evidence(), { created, savedAnswerIds } = await create(f);
  const input = { version: 1, savedAnswerIds, change: f.change };
  for (const payload of [
    { ...input, version: 2 },
    { ...input, candidate: {} },
    { ...input, memberId: 'caller-supplied-authority' },
  ]) {
    await assert.rejects(f.request('trials.create', payload), typedRefusal);
    await assertUnchangedAuthority(f, before);
  }
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId });
  assert.equal(evaluated.status, 'evaluated'); assert.match(evaluated.evaluationDigest, /^[a-f0-9]{64}$/);
  const impact = await f.request('trials.impact', { trialId: created.trialId, strategy: 'prospective' });
  assert.equal(impact.complete, true); assert.match(impact.digest, /^[a-f0-9]{64}$/);
  const promotion = { trialId: created.trialId, evaluationDigest: evaluated.evaluationDigest,
    strategy: 'prospective', acknowledgedImpactDigest: impact.digest };
  for (const payload of [
    { ...promotion, strategy: 'automatic' },
    { ...promotion, candidatePin: created.candidatePin },
    { ...promotion, epoch: 1 },
  ]) {
    await assert.rejects(f.request('trials.promote', payload), typedRefusal);
    await assertUnchangedAuthority(f, before);
  }
});

test('real receipt identifiers cannot substitute for authenticated saved answer identifiers', async t => {
  const f = await fixture(t), before = await f.evidence(), { created, savedAnswerIds } = await create(f);
  const receiptIds = f.receipts.map(receipt => receipt.id);
  assert.ok(receiptIds.every(id => !savedAnswerIds.includes(id)));
  await assert.rejects(f.request('trials.create', { version: 1, savedAnswerIds: receiptIds, change: f.change }), typedRefusal);
  const retained = await f.request('trials.list'); assert.ok(Array.isArray(retained));
  assert.deepEqual(retained.map(trial => trial.trialId), [created.trialId]);
  await assertUnchangedAuthority(f, before);
});

test('an unevaluated public trial cannot publish with caller-supplied evaluation and impact digests', async t => {
  const f = await fixture(t), before = await f.evidence(), { created } = await create(f);
  assert.equal((await f.request('trials.get', { trialId: created.trialId })).evaluationDigest, null);
  await assert.rejects(f.request('trials.promote', { trialId: created.trialId,
    evaluationDigest: '0'.repeat(64), strategy: 'prospective', acknowledgedImpactDigest: '0'.repeat(64) }), typedRefusal);
  const retained = await f.request('trials.get', { trialId: created.trialId });
  assert.equal(retained.status, 'created');
  assert.equal(retained.forkDigest, created.forkDigest); assert.equal(retained.evaluationDigest, null);
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId });
  assert.equal(evaluated.status, 'evaluated'); assert.match(evaluated.evaluationDigest, /^[a-f0-9]{64}$/);
  await assertUnchangedAuthority(f, before);
});

test('workspace lock refuses trial get list and evaluation while reopen retains the original trial and exact saved requests', async t => {
  const f = await fixture(t), before = await f.evidence(), { created, savedAnswerIds } = await create(f);
  const evaluated = await f.request('trials.evaluate', { trialId: created.trialId });
  assert.equal(evaluated.status, 'evaluated');
  assert.deepEqual(evaluated.evaluation.comparisons.map((comparison: any) => comparison.request), f.requests);
  assert.equal((await f.request('workspace.lock')).locked, true);
  for (const method of ['trials.get', 'trials.list', 'trials.evaluate']) {
    await assert.rejects(f.request(method, method === 'trials.list' ? {} : { trialId: created.trialId }), typedRefusal);
  }
  await f.reopen();
  const retained = await f.request('trials.get', { trialId: created.trialId });
  assert.equal(retained.trialId, created.trialId); assert.equal(retained.forkDigest, created.forkDigest);
  assert.equal(retained.evaluationDigest, evaluated.evaluationDigest);
  assert.deepEqual(retained.savedAnswerIds, savedAnswerIds); assert.deepEqual(retained.evaluation, evaluated.evaluation);
  assert.deepEqual(await selectSavedAnswers(f), savedAnswerIds);
  const listed = await f.request('trials.list'); assert.ok(Array.isArray(listed));
  assert.deepEqual(listed.map(trial => trial.trialId), [created.trialId]);
  await assertUnchangedAuthority(f, before);
});
