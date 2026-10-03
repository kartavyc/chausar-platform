import assert from 'node:assert/strict';
import { test } from 'node:test';
import { digest } from '../runtime/actions.ts';
import type { Context } from '../runtime/contracts.ts';
import { createLessonEvidenceAuthority } from '../runtime/lesson-evidence.ts';
import type { LessonDecision, LessonEvaluationResult, LessonProposal } from '../runtime/lesson-contracts.ts';
import {
  ACCOUNTANT, APPLICABLE, OWNER, VIEWER, SYNTHETIC_QUALIFICATION,
  decision, evaluationDigest, fixture, pin, proposal, targetDigest,
} from './fixtures/lesson-fixture.ts';

// These fixtures qualify lifecycle protocol behavior only. No real hidden suite,
// model, business effect, timing policy, or ranking behavior is executed here.
const refuses = (action: () => unknown) => assert.rejects(async () => action());

test('synthetic job evidence reaches exact candidate, bound evaluation, human approval and applicable guidance without protected writes', async () => {
  const f = fixture();
  const protectedBefore = f.protectedHashes();
  const businessBefore = digest(f.workspace);
  const targetBefore = structuredClone(f.target);
  const input = proposal();
  const proposed = await f.service.propose(OWNER, input);

  assert.equal(proposed.status, 'proposed');
  assert.equal(proposed.candidate.kind, 'candidate-lesson');
  assert.deepEqual(proposed.candidate.change, input.change);
  assert.deepEqual(proposed.candidate.target, targetBefore);
  assert.equal(proposed.candidate.evidence[0].pin.kind, 'job');
  assert.deepEqual(proposed.candidate.evidence[0].sourceMarkings, f.workspace.jobs[0].sourceMarkings);
  assert.deepEqual(proposed.candidate.applicability, input.applicability);
  assert.deepEqual(proposed.candidate.counterexamples, input.counterexamples);
  assert.equal(f.store.read().episodes[0].kind, 'episode');
  assert.equal(f.store.read().episodes[0].evidence.pin.id, 'job-synthetic-1');
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);

  const current = pin(proposed.candidate);
  const refs = f.registerEvaluations(current);
  const bound = await f.service.bindEvaluations(OWNER, current, refs);
  assert.equal(bound.status, 'review-ready');
  assert.ok(bound.evaluation);
  assert.equal(bound.evaluation.open.qualification, SYNTHETIC_QUALIFICATION);
  assert.equal(bound.evaluation.hidden.qualification, SYNTHETIC_QUALIFICATION);
  assert.deepEqual(bound.evaluation.candidate, current);
  assert.equal(bound.evaluation.open.reference.digest, evaluationDigest(bound.evaluation.open));
  assert.equal(bound.evaluation.hidden.reference.digest, evaluationDigest(bound.evaluation.hidden));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);

  const reviewed = await f.service.review(OWNER, current);
  assert.ok(reviewed.review);
  assert.deepEqual(reviewed.review.candidate, current);
  assert.equal(reviewed.review.evaluationDigest, bound.evaluation.digest);
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  const approved = await f.service.decideLesson(OWNER, decision(reviewed));
  assert.equal(approved.status, 'approved');
  const guidance = await f.service.applicable(OWNER, APPLICABLE);
  assert.equal(guidance.length, 1);
  assert.equal(guidance[0].kind, 'personal-preference');
  assert.deepEqual(guidance[0].lesson, current);
  assert.deepEqual(guidance[0].change, { kind: input.change.kind, targetId: input.change.targetId, after: input.change.after });
  assert.equal(Object.hasOwn(guidance[0].change, 'before'), false);
  assert.deepEqual(await f.service.resolveGuidance(OWNER, [current], APPLICABLE), guidance);

  assert.deepEqual(f.target, targetBefore, 'Approving guidance does not apply or write the target preference.');
  assert.equal(digest(f.workspace), businessBefore, 'The lesson service has no business-state update port.');
  assert.deepEqual(f.protectedHashes(), protectedBefore, 'Dictionaries, recipes and published calculations retain their exact hashes.');
});

test('calculation evidence carries the exact released source markings and receipt revision', async () => {
  const f = fixture();
  const before = f.protectedHashes();
  const approved = await f.approved(proposal({
    evidence: [{ kind: 'calculation', id: 'calculation-synthetic-1' }],
    applicability: { memberId: 'owner', sourceIds: ['source-calculation'], branchIds: ['main'], conditions: { task: 'weekly-overview' } },
  }));
  assert.equal(approved.candidate.evidence[0].pin.revision, 'receipt-revision-1');
  assert.deepEqual(approved.candidate.evidence[0].sourceMarkings, f.workspace.receipts[0].sourceMarkings);
  assert.equal((await f.service.applicable(OWNER, { ...APPLICABLE, sourceIds: ['source-calculation'] })).length, 1);
  assert.deepEqual(f.protectedHashes(), before);
});

test('an absent evaluation authority cannot synthesize results or issue a review', async () => {
  const f = fixture({ evaluations: false });
  const proposed = await f.service.propose(OWNER, proposal());
  const refs = f.registerEvaluations(pin(proposed.candidate));
  await refuses(() => f.service.review(OWNER, pin(proposed.candidate)));
  await refuses(() => f.service.bindEvaluations(OWNER, pin(proposed.candidate), refs));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  assert.equal(f.store.read().lessons[0].events.some(event => event.type === 'review' || event.type === 'approve'), false);
});

test('both completed evaluation sets are required before human review or promotion', async () => {
  const f = fixture();
  const proposed = await f.service.propose(OWNER, proposal());
  const current = pin(proposed.candidate);
  const refs = f.registerEvaluations(current);
  await refuses(() => f.service.review(OWNER, current));
  await refuses(() => f.service.bindEvaluations(OWNER, current, { open: refs.open } as typeof refs));
  await refuses(() => f.service.bindEvaluations(OWNER, current, { open: refs.open, hidden: refs.open }));
  const forgedDecision = { candidate: current, reviewId: 'invented-review', reviewDigest: digest('invented'), decision: 'approve', reason: 'Synthetic fabricated approval.' } as LessonDecision;
  await refuses(() => f.service.decideLesson(OWNER, forgedDecision));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
});

for (const status of ['incomplete', 'declined'] as const) {
  test(`a ${status} synthetic hidden result blocks review and leaves no active guidance`, async () => {
    const f = fixture();
    const proposed = await f.service.propose(OWNER, proposal());
    const current = pin(proposed.candidate);
    const refs = f.registerEvaluations(current, (result, set) => { if (set === 'hidden') result.status = status; });
    const bound = await f.service.bindEvaluations(OWNER, current, refs);
    assert.equal(bound.status, 'evaluation-blocked');
    await refuses(() => f.service.review(OWNER, current));
    assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  });
}

for (const direction of ['higher-is-better', 'lower-is-better'] as const) {
  test(`${direction} regression in either supplied evaluation set blocks promotion`, async () => {
    for (const regressingSet of ['open', 'hidden'] as const) {
      const f = fixture();
      const proposed = await f.service.propose(OWNER, proposal());
      const current = pin(proposed.candidate);
      const refs = f.registerEvaluations(current, (result, set) => {
        if (set === regressingSet) {
          const metric = result.metrics.find(item => item.direction === direction)!;
          metric.after = direction === 'higher-is-better' ? metric.before - 1 : metric.before + 1;
        }
      });
      const bound = await f.service.bindEvaluations(OWNER, current, refs);
      assert.equal(bound.status, 'evaluation-blocked');
      await refuses(() => f.service.review(OWNER, current));
      assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
    }
  });
}

test('equal metrics meet the explicit supplied directions without an invented improvement threshold', async () => {
  const f = fixture();
  const proposed = await f.service.propose(OWNER, proposal());
  const current = pin(proposed.candidate);
  const refs = f.registerEvaluations(current, result => { for (const metric of result.metrics) metric.after = metric.before; });
  const bound = await f.service.bindEvaluations(OWNER, current, refs);
  assert.equal(bound.status, 'review-ready');
  const reviewed = await f.service.review(OWNER, current);
  assert.equal((await f.service.decideLesson(OWNER, decision(reviewed))).status, 'approved');
});

test('evaluation provenance binds baseline, candidate, build, configuration, comparison and qualification', async () => {
  const variants: ((result: LessonEvaluationResult) => void)[] = [
    result => { result.candidate.digest = digest('different-candidate'); },
    result => { result.treatment.candidate.revision += 1; },
    result => { result.baseline.digest = digest('different-baseline'); },
    result => { result.build = { ...result.build, digest: digest('different-build') }; },
    result => { result.configuration = { ...result.configuration, digest: digest('different-config') }; },
    result => { result.comparisonId = 'different-comparison'; },
    result => { result.metrics = []; },
    result => { result.sourceTainted = true; },
    result => { result.qualification = 'owner-qualified'; },
  ];
  for (const alter of variants) {
    const f = fixture();
    const proposed = await f.service.propose(OWNER, proposal());
    const current = pin(proposed.candidate);
    const refs = f.registerEvaluations(current, (result, set) => { if (set === 'hidden') alter(result); });
    await refuses(() => f.service.bindEvaluations(OWNER, current, refs));
    await refuses(() => f.service.review(OWNER, current));
    assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  }
});

test('open and hidden suites retain independently supplied authority and metric provenance', async () => {
  const f = fixture();
  const proposed = await f.service.propose(OWNER, proposal());
  const current = pin(proposed.candidate);
  const refs = f.registerEvaluations(current, (result, set) => {
    if (set === 'hidden') {
      result.authorityId = 'synthetic-independent-hidden-authority';
      result.metrics[0].name = 'synthetic-hidden-accuracy';
    }
  });
  const bound = await f.service.bindEvaluations(OWNER, current, refs);
  assert.equal(bound.status, 'review-ready');
  assert.notEqual(bound.evaluation!.open.authorityId, bound.evaluation!.hidden.authorityId);
  assert.notDeepEqual(bound.evaluation!.open.suite, bound.evaluation!.hidden.suite);
  assert.notDeepEqual(bound.evaluation!.open.harness, bound.evaluation!.hidden.harness);
  const reviewed = await f.service.review(OWNER, current);
  assert.equal((await f.service.decideLesson(OWNER, decision(reviewed))).status, 'approved');
});

test('a changed evaluation summary under the original run digest cannot authorize human approval', async () => {
  const f = fixture();
  const reviewed = await f.ready();
  const hidden = [...f.evaluationRuns.values()].find(run => run.set === 'hidden')!;
  hidden.metrics[0].after = 10;
  await refuses(() => f.service.decideLesson(OWNER, decision(reviewed)));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
});

test('a candidate diff, pin, or review token changed after review cannot be approved', async () => {
  for (const field of ['candidate-pin', 'review-digest', 'review-id', 'stored-after'] as const) {
    const f = fixture();
    const reviewed = await f.ready();
    const input = decision(reviewed);
    if (field === 'candidate-pin') input.candidate.digest = digest('changed-candidate');
    if (field === 'review-digest') input.reviewDigest = digest('changed-review');
    if (field === 'review-id') input.reviewId = 'other-review';
    if (field === 'stored-after') f.store.state.lessons[0].revisions[0].change.after = 'details-first';
    await refuses(() => f.service.decideLesson(OWNER, input));
    if (field !== 'stored-after') assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  }
});

test('revision preserves the prior candidate and invalidates its review and evaluation binding', async () => {
  const f = fixture();
  const reviewed = await f.ready();
  const oldDecision = decision(reviewed);
  const revised = await f.service.revise(OWNER, pin(reviewed.candidate), proposal({
    change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'overview-first', after: 'details-first' },
  }));
  assert.equal(revised.candidate.revision, reviewed.candidate.revision + 1);
  assert.notEqual(revised.candidate.digest, reviewed.candidate.digest);
  assert.equal(revised.status, 'proposed');
  assert.equal(revised.review, undefined);
  assert.equal(revised.evaluation, undefined);
  await refuses(() => f.service.decideLesson(OWNER, oldDecision));
  await refuses(() => f.service.review(OWNER, pin(reviewed.candidate)));
  await refuses(() => f.service.resolveGuidance(OWNER, [pin(reviewed.candidate)], APPLICABLE));
  const history = await f.service.history(OWNER, reviewed.candidate.id);
  assert.equal(history.revisions.length, 2);
  assert.deepEqual(history.revisions[0], reviewed.candidate);
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  const refs = f.registerEvaluations(pin(revised.candidate));
  await f.service.bindEvaluations(OWNER, pin(revised.candidate), refs);
  const currentReview = await f.service.review(OWNER, pin(revised.candidate));
  assert.equal((await f.service.decideLesson(OWNER, decision(currentReview))).status, 'approved');
});

test('current target revision and exact before value must still match through approval', async () => {
  const invalid = fixture();
  await refuses(() => invalid.service.propose(OWNER, proposal({ change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'different-current-value', after: 'receipt-first' } })));
  assert.equal(invalid.store.read().lessons.length, 0);
  const f = fixture();
  const reviewed = await f.ready();
  f.target.value = 'details-first';
  f.target.revision = 'preference-revision-2';
  f.target.digest = targetDigest(f.target);
  await refuses(() => f.service.decideLesson(OWNER, decision(reviewed)));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
});

test('target schemas, evidence scope, conditions and counterexamples are required explicit inputs', async () => {
  const variants: LessonProposal[] = [
    proposal({ change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'overview-first', after: { script: 'run' } } }),
    proposal({ evidence: [] }),
    proposal({ counterexamples: [] }),
    proposal({ applicability: { memberId: 'owner', sourceIds: ['unreferenced-source'], branchIds: ['main'], conditions: { task: 'weekly-overview' } } }),
    proposal({ applicability: { memberId: 'owner', sourceIds: ['source-job'], branchIds: ['outside'], conditions: { task: 'weekly-overview' } } }),
    proposal({ applicability: { memberId: 'owner', sourceIds: ['source-job'], branchIds: ['main'], conditions: {} } }),
    proposal({ applicability: { memberId: 'accountant', sourceIds: ['source-job'], branchIds: ['main'], conditions: { task: 'weekly-overview' } } }),
  ];
  for (const input of variants) {
    const f = fixture();
    await refuses(() => f.service.propose(OWNER, input));
    assert.deepEqual(f.store.read(), { workspaceId: 'workspace-synthetic-lessons', episodes: [], lessons: [] });
  }
});

test('episodes, procedures, business rules and protected ontology or calculation targets cannot enter personal lessons', async () => {
  for (const kind of ['episode', 'approved-procedure', 'business-rule', 'dictionary', 'recipe', 'calculation', 'published-calculation']) {
    const f = fixture();
    const before = f.protectedHashes();
    const input = proposal();
    (input.change as { kind: string }).kind = kind;
    await refuses(() => f.service.propose(OWNER, input));
    assert.equal(f.store.read().lessons.length, 0);
    assert.deepEqual(f.protectedHashes(), before);
  }
});

test('tainted contexts, evidence and source markings cannot create or approve reusable guidance', async () => {
  const context = fixture();
  await refuses(() => context.service.propose({ ...OWNER, sourceTainted: true }, proposal()));
  assert.equal(context.store.read().episodes.length, 0);
  const evidence = fixture();
  evidence.workspace.jobs[0].sourceTainted = true;
  await refuses(() => evidence.service.propose(OWNER, proposal()));
  assert.equal(evidence.store.read().episodes.length, 0);
  const markings = fixture();
  markings.workspace.jobs[0].sourceMarkings = [];
  await refuses(() => markings.service.propose(OWNER, proposal()));
  const reviewed = await context.ready();
  await refuses(() => context.service.decideLesson({ ...OWNER, sourceTainted: true }, decision(reviewed)));
  assert.deepEqual(await context.service.applicable(OWNER, APPLICABLE), []);
});

test('changed evidence revisions, summaries or markings invalidate already reviewed approval', async () => {
  for (const mutation of ['revision', 'summary', 'marking', 'taint', 'unavailable'] as const) {
    const f = fixture();
    const reviewed = await f.ready();
    const job = f.workspace.jobs[0];
    if (mutation === 'revision') job.revision = 'job-revision-2';
    if (mutation === 'summary') job.summary = 'Changed released summary.';
    if (mutation === 'marking') job.sourceMarkings[0].marking = 'Changed source classification.';
    if (mutation === 'taint') job.sourceTainted = true;
    if (mutation === 'unavailable') job.available = false;
    await refuses(() => f.service.decideLesson(OWNER, decision(reviewed)));
    assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  }
});

test('revoked current member, source, branch and evaluation-source access blocks promotion and guidance', async () => {
  const mutations = [
    (f: ReturnType<typeof fixture>) => { f.workspace.members[0].active = false; },
    (f: ReturnType<typeof fixture>) => { f.workspace.members[0].epoch += 1; },
    (f: ReturnType<typeof fixture>) => { f.workspace.policy.allowedSources = ['source-calculation', 'source-eval']; },
    (f: ReturnType<typeof fixture>) => { f.workspace.sourceRules.push({ sourceId: 'source-job', memberId: 'owner', read: false }); },
    (f: ReturnType<typeof fixture>) => { f.workspace.members[0].branches = ['other']; },
    (f: ReturnType<typeof fixture>) => { f.workspace.sourceRules.push({ sourceId: 'source-eval', memberId: 'owner', revoked: true }); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const f = fixture();
    const reviewed = await f.ready();
    mutate(f);
    await refuses(() => f.service.decideLesson(OWNER, decision(reviewed)));
    const active = fixture();
    const approved = await active.approved();
    mutate(active);
    await refuses(() => active.service.resolveGuidance(OWNER, [pin(approved.candidate)], APPLICABLE));
    if (index < 2) await refuses(() => active.service.applicable(OWNER, APPLICABLE));
    else assert.deepEqual(await active.service.applicable(OWNER, APPLICABLE), []);
  }
});

test('preparer and viewer roles cannot supply human owner approval, and owner lessons remain private', async () => {
  const f = fixture();
  const reviewed = await f.ready();
  await refuses(() => f.service.decideLesson(ACCOUNTANT, decision(reviewed)));
  await refuses(() => f.service.decideLesson(VIEWER, decision(reviewed)));
  await refuses(() => f.service.propose(VIEWER, proposal()));
  await f.service.decideLesson(OWNER, decision(reviewed));
  assert.deepEqual(await f.service.lessons(ACCOUNTANT), []);
  assert.deepEqual(await f.service.applicable(ACCOUNTANT, APPLICABLE), []);
  await refuses(() => f.service.history(ACCOUNTANT, reviewed.candidate.id));
  await refuses(() => f.service.resolveGuidance(ACCOUNTANT, [pin(reviewed.candidate)], APPLICABLE));
});

test('guidance is supplied only inside its explicit source, branch, conditions and counterexample scope', async () => {
  const f = fixture();
  const approved = await f.approved(proposal({
    counterexamples: [{ conditions: { urgency: 'high' }, reason: 'The owner specified a concise response for high urgency.' }],
  }));
  assert.equal((await f.service.applicable(OWNER, APPLICABLE)).length, 1);
  for (const context of [
    { ...APPLICABLE, branchId: 'other' },
    { ...APPLICABLE, sourceIds: ['source-calculation'] },
    { ...APPLICABLE, conditions: { task: 'another-task' } },
    { ...APPLICABLE, conditions: { task: 'weekly-overview', urgency: 'high' } },
  ]) {
    assert.deepEqual(await f.service.applicable(OWNER, context), []);
    await refuses(() => f.service.resolveGuidance(OWNER, [pin(approved.candidate)], context));
  }
});

for (const choice of ['reject', 'defer'] as const) {
  test(`human ${choice} records a distinct decision and supplies no active guidance`, async () => {
    const f = fixture();
    const reviewed = await f.ready();
    const result = await f.service.decideLesson(OWNER, decision(reviewed, choice));
    assert.equal(result.status, choice === 'reject' ? 'rejected' : 'deferred');
    assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
    await refuses(() => f.service.resolveGuidance(OWNER, [pin(reviewed.candidate)], APPLICABLE));
    assert.equal((await f.service.history(OWNER, reviewed.candidate.id)).events.at(-1)?.type, choice);
  });
}

test('retirement removes current and old-summary guidance while retaining permitted review history', async () => {
  const f = fixture();
  const approved = await f.approved();
  const oldSummaryPin = pin(approved.candidate);
  const before = await f.service.history(OWNER, approved.candidate.id);
  const protectedBefore = f.protectedHashes();
  const retired = await f.service.retire(OWNER, oldSummaryPin, 'The owner retired this synthetic preference guidance.');
  assert.equal(retired.status, 'retired');
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  await refuses(() => f.service.resolveGuidance(OWNER, [oldSummaryPin], APPLICABLE));
  const history = await f.service.history(OWNER, approved.candidate.id);
  assert.deepEqual(history.revisions, before.revisions);
  assert.deepEqual(history.events.slice(0, -1), before.events);
  assert.equal(history.events.at(-1)?.type, 'retire');
  assert.equal(history.events.at(-1)?.reason, 'The owner retired this synthetic preference guidance.');
  assert.deepEqual(await f.service.lessons(OWNER), []);
  await refuses(() => f.service.decideLesson(OWNER, decision(approved)));
  f.workspace.sourceRules.push({ sourceId: 'source-job', read: false });
  await refuses(() => f.service.history(OWNER, approved.candidate.id));
  assert.deepEqual(f.protectedHashes(), protectedBefore);
});

test('an explicitly approved successor supersedes old guidance without reviving cached summary pins', async () => {
  const f = fixture();
  const prior = await f.approved();
  const oldSummaryPin = pin(prior.candidate);
  const successorInput = proposal({
    title: 'Use detailed weekly overviews',
    change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'receipt-first', after: 'details-first' },
    supersedes: oldSummaryPin,
  });
  const successor = await f.service.propose(OWNER, successorInput);
  assert.deepEqual((await f.service.applicable(OWNER, APPLICABLE)).map(item => item.lesson), [oldSummaryPin]);
  const refs = f.registerEvaluations(pin(successor.candidate));
  await f.service.bindEvaluations(OWNER, pin(successor.candidate), refs);
  const reviewed = await f.service.review(OWNER, pin(successor.candidate));
  await f.service.decideLesson(OWNER, decision(reviewed));
  const currentGuidance = await f.service.applicable(OWNER, APPLICABLE);
  assert.deepEqual(currentGuidance.map(item => item.lesson), [pin(successor.candidate)]);
  assert.deepEqual(currentGuidance[0].change, { kind: 'personal-preference', targetId: 'preference-overview', after: 'details-first' });
  assert.equal(Object.hasOwn(currentGuidance[0].change, 'before'), false);
  assert.equal(JSON.stringify(currentGuidance).includes('receipt-first'), false, 'Superseded instruction text stays out of current context.');
  await refuses(() => f.service.resolveGuidance(OWNER, [oldSummaryPin], APPLICABLE));
  const oldHistory = await f.service.history(OWNER, prior.candidate.id);
  assert.equal(oldHistory.events.at(-1)?.type, 'supersede');
  assert.deepEqual(oldHistory.events.at(-1)?.successor, pin(successor.candidate));
});

test('returned detached candidates and history cannot mutate saved review or guidance', async () => {
  const f = fixture();
  const proposed = await f.service.propose(OWNER, proposal());
  const current = pin(proposed.candidate);
  proposed.candidate.change.after = 'details-first';
  proposed.candidate.evidence[0].sourceMarkings[0].marking = 'Injected returned mutation';
  const history = await f.service.history(OWNER, current.id);
  assert.equal(history.revisions[0].change.after, 'receipt-first');
  history.revisions[0].change.after = 'details-first';
  const secondRead = await f.service.history(OWNER, current.id);
  assert.equal(secondRead.revisions[0].change.after, 'receipt-first');
  const refs = f.registerEvaluations(current);
  await f.service.bindEvaluations(OWNER, current, refs);
  const reviewed = await f.service.review(OWNER, current);
  assert.equal((await f.service.decideLesson(OWNER, decision(reviewed))).status, 'approved');
});

test('failed updates roll back and concurrent revisions require the same immutable pin', async () => {
  const f = fixture();
  const proposed = await f.service.propose(OWNER, proposal());
  const current = pin(proposed.candidate);
  const before = f.store.read();
  await refuses(() => f.service.revise(OWNER, current, proposal({ counterexamples: [] })));
  assert.deepEqual(f.store.read(), before);
  const revisions = await Promise.allSettled([
    f.service.revise(OWNER, current, proposal({ title: 'First explicit revision' })),
    f.service.revise(OWNER, current, proposal({ title: 'Second explicit revision' })),
  ]);
  assert.equal(revisions.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(revisions.filter(result => result.status === 'rejected').length, 1);
  assert.equal((await f.service.history(OWNER, current.id)).revisions.length, 2);
});

test('workspace identity fences storage, evidence and old summary references', async () => {
  const wrongStore = fixture();
  wrongStore.store.state.workspaceId = 'workspace-another';
  const before = wrongStore.store.read();
  await assert.rejects(wrongStore.service.propose(OWNER, proposal()), { code: 'LESSON_WORKSPACE_CHANGED' });
  assert.deepEqual(wrongStore.store.read(), before);
  const changedWorkspace = fixture();
  const approved = await changedWorkspace.approved();
  changedWorkspace.workspace.workspace.id = 'workspace-another';
  await refuses(() => changedWorkspace.service.history(OWNER, approved.candidate.id));
  await refuses(() => changedWorkspace.service.lessons(OWNER));
  await refuses(() => changedWorkspace.service.applicable(OWNER, APPLICABLE));
  await refuses(() => changedWorkspace.service.resolveGuidance(OWNER, [pin(approved.candidate)], APPLICABLE));
});

test('evidence resolver receives a frozen detached workspace, actor and immutable reference', () => {
  const f = fixture();
  const businessBefore = digest(f.workspace);
  const request = { kind: 'job' as const, id: 'job-synthetic-1' };
  const authority = createLessonEvidenceAuthority(() => f.workspace, (state, context, reference) => {
    assert.notEqual(state, f.workspace);
    assert.notEqual(context, OWNER);
    assert.notEqual(reference, request);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.jobs[0]), true);
    assert.equal(Object.isFrozen(context), true);
    assert.equal(Object.isFrozen(reference), true);
    assert.throws(() => { state.jobs[0].summary = 'Resolver attempted mutation.'; }, TypeError);
    assert.throws(() => { context.memberId = 'accountant'; }, TypeError);
    assert.throws(() => { reference.id = 'different-job'; }, TypeError);
    return f.evidence.capture(context, [reference])[0];
  });
  const result = authority.capture(OWNER, [request]);
  assert.equal(result[0].pin.id, request.id);
  assert.equal(digest(f.workspace), businessBefore);
  assert.deepEqual(request, { kind: 'job', id: 'job-synthetic-1' });
});

test('evaluation source revocation prevents lesson views and history from exposing bound results', async () => {
  const f = fixture();
  const approved = await f.approved();
  f.workspace.sourceRules.push({ sourceId: 'source-eval', memberId: 'owner', read: false });
  assert.deepEqual(await f.service.lessons(OWNER), []);
  await refuses(() => f.service.history(OWNER, approved.candidate.id));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  await refuses(() => f.service.resolveGuidance(OWNER, [pin(approved.candidate)], APPLICABLE));
});

test('deferred decisions consume review tokens and rebinding evaluations requires a fresh human review', async () => {
  const f = fixture();
  const reviewed = await f.ready();
  const oldDecision = decision(reviewed);
  await f.service.decideLesson(OWNER, decision(reviewed, 'defer'));
  await refuses(() => f.service.decideLesson(OWNER, oldDecision));
  const refs = f.registerEvaluations(pin(reviewed.candidate));
  const rebound = await f.service.bindEvaluations(OWNER, pin(reviewed.candidate), refs);
  assert.equal(rebound.review, undefined);
  await refuses(() => f.service.decideLesson(OWNER, oldDecision));
  const freshReview = await f.service.review(OWNER, pin(reviewed.candidate));
  assert.notEqual(freshReview.review!.id, reviewed.review!.id);
  await refuses(() => f.service.decideLesson(OWNER, oldDecision));
  assert.equal((await f.service.decideLesson(OWNER, decision(freshReview))).status, 'approved');
});

for (const operation of ['propose', 'review', 'decideLesson'] as const) {
  for (const revoke of ['member', 'source'] as const) {
    test(`${operation} rolls back when its final target validation revokes current ${revoke} access`, async () => {
      const f = fixture();
      let run: () => Promise<unknown>;
      if (operation === 'propose') run = () => f.service.propose(OWNER, proposal());
      else if (operation === 'review') {
        const proposed = await f.service.propose(OWNER, proposal());
        const refs = f.registerEvaluations(pin(proposed.candidate));
        await f.service.bindEvaluations(OWNER, pin(proposed.candidate), refs);
        run = () => f.service.review(OWNER, pin(proposed.candidate));
      } else {
        const reviewed = await f.ready();
        run = () => f.service.decideLesson(OWNER, decision(reviewed));
      }
      const before = f.store.read();
      const validate = f.targets.validateChange;
      let validations = 0;
      const revokeAt = operation === 'propose' ? 1 : 2;
      f.targets.validateChange = (context, target, after) => {
        validate(context, target, after);
        validations += 1;
        if (validations === revokeAt) {
          if (revoke === 'member') f.workspace.members[0].active = false;
          else f.workspace.sourceRules.push({ sourceId: 'source-job', memberId: 'owner', read: false });
        }
      };
      await refuses(run);
      assert.equal(validations, revokeAt);
      assert.deepEqual(f.store.read(), before, 'No proposal, episode, review, approval or supersession may commit after callback revocation.');
    });
  }
}

test('current target authority refusal hides lesson previews, history and guidance', async () => {
  const f = fixture();
  const approved = await f.approved();
  f.targets.resolve = () => { throw new Error('Synthetic target access was revoked by its current authority.'); };
  assert.deepEqual(await f.service.lessons(OWNER), []);
  await refuses(() => f.service.history(OWNER, approved.candidate.id));
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
  await refuses(() => f.service.resolveGuidance(OWNER, [pin(approved.candidate)], APPLICABLE));
});

test('a later lesson resolver revoking an earlier source cannot release previously collected guidance or previews', async () => {
  for (const method of ['lessons', 'applicable'] as const) {
    const f = fixture();
    await f.approved();
    const later = await f.approved(proposal({
      evidence: [{ kind: 'calculation', id: 'calculation-synthetic-1' }],
      applicability: { memberId: 'owner', sourceIds: ['source-calculation'], branchIds: ['main'], conditions: { task: 'weekly-overview' } },
    }));
    const resolve = f.evaluations.resolve;
    let revoked = false;
    f.evaluations.resolve = (context, reference) => {
      const result = resolve(context, reference);
      if (!revoked && result.candidate.id === later.candidate.id && result.set === 'hidden') {
        revoked = true;
        f.workspace.sourceRules.push({ sourceId: 'source-job', memberId: 'owner', read: false });
      }
      return result;
    };
    const result = await Promise.resolve().then(() => method === 'lessons' ? f.service.lessons(OWNER) : f.service.applicable(OWNER, APPLICABLE))
      .then(value => ({ value }), error => ({ error }));
    assert.equal(revoked, true, 'The later authority callback must exercise the source revocation.');
    if ('error' in result) assert.ok(result.error instanceof Error);
    else assert.deepEqual(result.value, [], 'Previously collected source-denied previews or instructions cannot be released.');
  }
});

test('queued human decisions keep the invocation context when callers change taint and channel flags', async () => {
  const f = fixture();
  const reviewed = await f.ready();
  const before = f.store.read();
  const context: Context = { ...OWNER, channel: 'phone', sourceTainted: true };
  const pending = f.service.decideLesson(context, decision(reviewed));
  context.channel = 'desktop';
  context.sourceTainted = false;
  await refuses(() => pending);
  assert.deepEqual(f.store.read(), before, 'Queued caller mutation must not convert a tainted phone request into a human approval.');
});

test('queued proposals retain tainted invocation context after the caller clears its flags', async () => {
  const f = fixture();
  const before = f.store.read();
  const context: Context = { ...OWNER, sourceTainted: true };
  const pending = f.service.propose(context, proposal());
  context.sourceTainted = false;
  await refuses(() => pending);
  assert.deepEqual(f.store.read(), before, 'Queued caller mutation must not record tainted evidence or candidate instructions.');
});

test('retiring the approved predecessor invalidates a bound successor before human review', async () => {
  const f = fixture();
  const prior = await f.approved();
  const successor = await f.service.propose(OWNER, proposal({
    title: 'Synthetic explicitly superseding preference',
    change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'receipt-first', after: 'details-first' },
    supersedes: pin(prior.candidate),
  }));
  const refs = f.registerEvaluations(pin(successor.candidate));
  await f.service.bindEvaluations(OWNER, pin(successor.candidate), refs);
  await f.service.retire(OWNER, pin(prior.candidate), 'The owner retired the predecessor before successor review.');
  const before = f.store.read();
  await assert.rejects(f.service.review(OWNER, pin(successor.candidate)), { code: 'INVALID_SUPERSESSION' });
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.store.read().lessons.find(record => record.id === successor.candidate.id)!.events.some(event => event.type === 'review'), false);
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
});

test('changed predecessor evaluation provenance invalidates an already bound successor review', async () => {
  const f = fixture();
  const prior = await f.approved();
  const successor = await f.service.propose(OWNER, proposal({
    title: 'Synthetic explicitly superseding preference',
    change: { kind: 'personal-preference', targetId: 'preference-overview', before: 'receipt-first', after: 'details-first' },
    supersedes: pin(prior.candidate),
  }));
  const refs = f.registerEvaluations(pin(successor.candidate));
  await f.service.bindEvaluations(OWNER, pin(successor.candidate), refs);
  const priorHidden = [...f.evaluationRuns.values()].find(run => run.candidate.id === prior.candidate.id && run.set === 'hidden')!;
  priorHidden.metrics[0].after = 10;
  const before = f.store.read();
  await assert.rejects(f.service.review(OWNER, pin(successor.candidate)), { code: 'EVALUATION_CHANGED' });
  assert.deepEqual(f.store.read(), before);
  assert.equal(f.store.read().lessons.find(record => record.id === successor.candidate.id)!.events.some(event => event.type === 'review'), false);
  assert.deepEqual(await f.service.applicable(OWNER, APPLICABLE), []);
});
