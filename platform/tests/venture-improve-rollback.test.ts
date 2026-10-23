// Going back a playbook version (Ink v2 wave 2, package 2C1, catalogue Q2): after the owner adopts a version an
// improvement run kept, venture.improve.rollback points the business back at the version it was made from. The
// adopted version stays stored (versions are never overwritten), the run that kept it is not offered again, and the
// owner's approval is bound to the version in use as they saw it. A plan change since makes the older version stale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, findRecord, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { business, code, owner, phone, plainDraft, PLAIN_IDEA, type Business } from './venture-judge-helpers.ts';

const SECTIONS_GUIDANCE = 'Use every required heading once, in the order given.';

/** Drafts skip their last heading unless the writing step's guidance asks for every one; the AI proposes that guidance. */
function improvable(env: Business) {
  env.models.respond.delivery = task => {
    const draft = plainDraft(task) as { sections: unknown[] };
    return (task.input as { guidance?: string[] }).guidance?.includes(SECTIONS_GUIDANCE) ? draft : { ...draft, sections: draft.sections.slice(0, -1) };
  };
  env.models.respond.improve = () => ({
    level: 'harness', hypothesis: 'Every heading once should fix missing sections.', op: 'guidance.add', stepId: 'draft', value: SECTIONS_GUIDANCE,
    expectedFixes: ['missing-section'], likelyRegressions: ['A longer reply.'],
  });
}

async function adopted(env: Business) {
  const parent = await env.call('venture.delivery.playbook');
  await ventureAction(env.deps, owner, 'prepare', 'seed.signals', tx => {
    for (let index = 0; index < 2; index += 1) tx.put({ ...tx.base('venture-signal'), source: 'owner-rejected', runId: 'delivery_x', reason: 'missing-section', scenarioId: null });
  });
  improvable(env);
  const run = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(run.status, 'kept-candidate', JSON.stringify(run.rounds.map((round: any) => [round.refused, round.gate?.reason])));
  const candidate = await env.call('venture.improve.adopt', { runId: run.id, digest: run.digest });
  return { parent, candidate, run };
}

const playbookIdOf = (env: Business) => listRecords(env.store.read(), 'venture-record')[0].playbookId;

test('rollback: the owner goes back to the version the adopted one was made from; the adopted one stays stored', async () => {
  const env = await business(PLAIN_IDEA);
  const { parent, candidate, run } = await adopted(env);
  assert.equal(candidate.parentId, parent.id);
  assert.equal(playbookIdOf(env), candidate.id);
  // What the Practice page shows and sends: the version in use, and how to go back from it.
  const before = await env.call('venture.improve.status');
  assert.deepEqual(before.inUse, {
    playbookId: candidate.id, version: candidate.version, hash: candidate.hash, origin: 'improvement',
    rollback: { playbookId: parent.id, version: parent.version, digest: candidate.hash },
  });
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id, digest: candidate.hash }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id, digest: 'e'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: candidate.id, digest: candidate.hash }), code('ROLLBACK_NOTHING'));
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id, digest: 'not-a-digest' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id }), code('INVALID_VENTURE_REQUEST'));
  const stored = structuredClone(findRecord(env.store.read(), 'venture-playbook', candidate.id));

  const back = await env.call('venture.improve.rollback', { playbookId: parent.id, digest: candidate.hash });
  assert.equal(back.id, parent.id);
  assert.equal(back.hash, parent.hash);
  assert.equal(playbookIdOf(env), parent.id);
  assert.deepEqual(findRecord(env.store.read(), 'venture-playbook', candidate.id), stored, 'the adopted version stays stored as it was');
  const event = listRecords(env.store.read(), 'venture-event').filter(item => item.name === 'playbook-adopted').at(-1)!;
  assert.deepEqual(event.data, { playbookId: parent.id, version: parent.version, hash: parent.hash, rolledBack: true, fromPlaybookId: candidate.id });
  assert.ok(findRecord(env.store.read(), 'venture-improvement-run', run.id)!.rolledBack, 'the run that kept it says it was rolled back');

  const status = await env.call('venture.improve.status');
  assert.equal(status.activePlaybookId, parent.id);
  assert.deepEqual(status.inUse, { playbookId: parent.id, version: parent.version, hash: parent.hash, origin: 'plan', rollback: null });
  assert.equal(status.candidate, null, 'a version the owner went back from is not offered again');
  await assert.rejects(env.call('venture.improve.adopt', { runId: run.id, digest: run.digest }), code('CANDIDATE_STALE'));
  assert.equal((await env.call('venture.delivery.playbook')).id, parent.id, 'runs use the older version again');
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id, digest: parent.hash }), code('ROLLBACK_NOTHING'), 'nothing to go back from now');
});

test('rollback: refused when the version in use is not from an improvement run, or when the plan changed since', async () => {
  const fresh = await business(PLAIN_IDEA);
  const current = await fresh.call('venture.delivery.playbook');
  await assert.rejects(fresh.call('venture.improve.rollback', { playbookId: current.id, digest: current.hash }), code('ROLLBACK_NOTHING'));

  const env = await business(PLAIN_IDEA);
  const { parent, candidate } = await adopted(env);
  await ventureAction(env.deps, owner, 'admin', 'seed.plan-change', tx => {
    const plan = tx.list('venture-blueprint').find(item => item.id === tx.venture!.acceptedBlueprintId)!;
    const changed = tx.put({ ...plan, ...tx.base('venture-blueprint'), version: plan.version + 1, digest: digest({ changedFrom: plan.digest }) });
    tx.touch({ acceptedBlueprintId: changed.id, blueprintId: changed.id });
  });
  assert.equal((await env.call('venture.improve.status')).inUse.rollback, null, 'the older version no longer fits the plan');
  await assert.rejects(env.call('venture.improve.rollback', { playbookId: parent.id, digest: candidate.hash }), (error: any) => {
    assert.equal(error.code, 'ROLLBACK_STALE');
    assert.match(error.message, /plan changed/);
    return true;
  });
  assert.equal(playbookIdOf(env), candidate.id, 'nothing changed');
});

test('rollback after a grant top-up: the topped-up version goes back too, and the run that kept it is not offered again', async () => {
  const env = await business(PLAIN_IDEA);
  const { parent, candidate, run } = await adopted(env);
  // The adopted version as an older build stored it, without a tool this build grants: the next read tops it up.
  await ventureAction(env.deps, owner, 'admin', 'seed.older-grants', tx => {
    const stored = tx.find('venture-playbook', candidate.id)!;
    tx.replace({ ...stored, steps: stored.steps.map(step => step.id === 'gather' ? { ...step, tools: (step.tools ?? []).filter(tool => tool !== 'dictionary.browse') } : step) });
  });
  const topped = await env.call('venture.delivery.playbook');
  assert.notEqual(topped.id, candidate.id, 'a top-up is a new version');
  assert.equal(topped.origin, 'improvement');
  assert.equal(topped.parentId, parent.id);
  const status = await env.call('venture.improve.status');
  assert.deepEqual(status.inUse.rollback, { playbookId: parent.id, version: parent.version, digest: topped.hash });
  await env.call('venture.improve.rollback', { playbookId: parent.id, digest: topped.hash });
  assert.ok(findRecord(env.store.read(), 'venture-improvement-run', run.id)!.rolledBack, 'the run is found through the version chain');
  assert.equal((await env.call('venture.improve.status')).candidate, null, 'its old candidate is not offered again');
  await assert.rejects(env.call('venture.improve.adopt', { runId: run.id, digest: run.digest }), code('CANDIDATE_STALE'));
});
