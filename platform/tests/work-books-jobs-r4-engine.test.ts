import test from 'node:test';
import assert from 'node:assert/strict';
import { DAY, fixture } from './jobs-ext-fixture.ts';

// Through the real engine with the merged jobs-ext lane, in demo mode and on a labelled test clock, everything
// through approvals.*: a ready-made lane job proposed from Start a job and approved by its digest, its question
// answered, a step for a person marked done, the delivered result accepted, an edit as a new card and the
// missed-run rule. Synthetic invoices only (platform/tests/jobs-ext-fixture.ts).

test('a ready-made lane job runs end to end through approvals.*: question, person step, accept', async t => {
  const { ui, engine, clock } = await fixture(t);
  await ui('trust.update', { autonomy: true });
  await ui('jobsx.consent.record', { customerId: 'cust-a', channel: 'mail', agreed: true, source: 'Synthetic signed form' });
  await ui('jobsx.consent.record', { customerId: 'cust-b', channel: 'mail', agreed: true, source: 'Synthetic signed form' });
  const templates = await ui('approvals.jobTemplates');
  assert.equal(templates.lane.available, true);
  const byId = Object.fromEntries(templates.lane.templates.map((t: any) => [t.id, t]));
  assert.ok(byId['receivables-week'] && byId['cash-position'] && byId['weekly-close']);
  assert.equal(byId['agent-task'], undefined, 'a job in your own words is the one-sentence path');
  assert.equal(byId['receivables-week'].stepsPerDelivery, 7);

  // Start a job: a ready-made lane job is a card, approved by its exact digest in the one queue.
  const proposed = await ui('approvals.proposeJob', { laneTemplate: 'receivables-week' });
  assert.match(proposed.id, /^proposal:/);
  const sheet = await ui('approvals.get', { id: proposed.id });
  assert.equal(sheet.source, 'proposal'); assert.equal(sheet.digest, proposed.proposal.digest); assert.equal(sheet.job.missedRun, 'run-once-on-wake');
  const approved = await ui('approvals.approve', { id: proposed.id, digest: sheet.digest });
  assert.equal(approved.state, 'verified'); assert.match(approved.approvedJobId, /^job:/);
  const jobId = approved.approvedJobId.slice(4);

  // Day one: the long-overdue invoice asks a question, answered through approvals.answerQuestion.
  await engine.tick();
  let job = await ui('approvals.job', { id: jobId });
  assert.equal(job.manage.answer, 'jobsx');
  const question = job.jobsx.questions[0];
  assert.deepEqual(question.options, ['remind', 'stop', 'call']);
  await assert.rejects(ui('approvals.answerQuestion', { jobId, questionId: question.id, option: 'pay' }), { code: 'INVALID_ANSWER' });
  const answer = await ui('approvals.answerQuestion', { jobId, questionId: question.id, option: 'call' });
  assert.equal(answer.answer, 'call');

  // Day two: the answer becomes a step for a person, marked done through approvals.personStepDone.
  clock.now += DAY; await engine.tick();
  job = await ui('approvals.job', { id: jobId });
  const step = job.timeline.find((s: any) => s.kind === 'person');
  assert.ok(step, 'the person step leads the time line'); assert.equal(step.canDone, true); assert.equal(job.manage.personStep, 'jobsx');
  const done = await ui('approvals.personStepDone', { jobId, stepId: step.stepId });
  assert.equal(done.done, true);
  await assert.rejects(ui('approvals.personStepDone', { jobId, stepId: step.stepId }), (e: any) => ['NOT_FOUND', 'PERSON_STEP_ALREADY_DONE'].includes(e.code));

  // The missed-run rule: "every missed one" is unsuitable for daily rounds; skip is applied at once.
  assert.equal(job.missedRule.runAll, 'unsuitable');
  await assert.rejects(ui('approvals.setMissedRule', { id: jobId, rule: 'run-all' }), { code: 'MISSED_RULE_UNSUITABLE' });
  const rule = await ui('approvals.setMissedRule', { id: jobId, rule: 'skip' });
  assert.deepEqual([rule.missedRun, rule.via, rule.waitsForApproval], ['skip', 'jobsx', false]);

  // The rest of the week, then the delivered result waits as acceptance:<id> and is accepted by its digest.
  for (let day = 3; day <= 7; day++) { clock.now += DAY; await engine.tick(); }
  job = await ui('approvals.job', { id: jobId });
  assert.ok(job.acceptance, 'the week waits for the owner');
  assert.equal(job.manage.accept, 'jobsx');
  const accepted = await ui('approvals.approve', { id: job.acceptance.id, digest: job.acceptance.digest });
  assert.equal(accepted.state, 'verified');
  assert.equal((await ui('jobs.list')).find((j: any) => j.id === jobId).status, 'accepted');
});

test('edit is a new card through jobs-ext; a delivering job offers every missed run; Start a job refuses an unavailable template', async t => {
  const { ui } = await fixture(t);
  await ui('trust.update', { autonomy: true });
  const proposed = await ui('approvals.proposeJob', { laneTemplate: 'cash-position', budgetMinor: '6000' });
  const sheet = await ui('approvals.get', { id: proposed.id });
  assert.deepEqual(sheet.amount, { minor: '6000' });
  const jobId = (await ui('approvals.approve', { id: proposed.id, digest: sheet.digest })).approvedJobId.slice(4);
  const job = await ui('approvals.job', { id: jobId });
  assert.equal(job.missedRule.runAll, 'offered', 'cash position delivers every run');
  assert.ok(Array.isArray(job.routes)); assert.equal(job.untestedStop, null);
  const edit = await ui('approvals.editJob', { id: jobId, config: { budgetMinor: '9000' } });
  assert.deepEqual([edit.via, edit.waitsFor], ['jobsx', 'proposal']);
  const listed = await ui('approvals.jobs');
  assert.ok(listed.proposals.items.some((p: any) => p.id === edit.proposal.id && p.replacesJobId === jobId), 'the edit waits as a proposal naming the job it replaces');
  const editSheet = await ui('approvals.get', { id: `proposal:${edit.proposal.id}` });
  assert.equal(editSheet.what.kind, 'change-job');
  await ui('approvals.approve', { id: editSheet.id, digest: editSheet.digest });
  assert.equal((await ui('jobs.list')).find((j: any) => j.id === jobId).status, 'stopped', 'the approved card replaces the job');
  // stock-check needs a quantity calculation this workspace has not published.
  const stock = (await ui('approvals.jobTemplates')).lane.templates.find((t: any) => t.id === 'stock-check');
  if (stock && !stock.available) await assert.rejects(ui('approvals.proposeJob', { laneTemplate: 'stock-check' }), { code: stock.code });
});
