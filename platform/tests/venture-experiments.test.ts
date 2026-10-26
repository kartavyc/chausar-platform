// Ink v2 wave 4, package 4J16 (catalogue Q16): an improvement run records each change it tries as an experiment: one
// hypothesis, one change, a control (the old version on the same practice cases, with its window), a budget cap, and
// stop and roll-back rules. Only with a real control may the result say what the change did; without one it reads
// "observed". Candidates are reviewed at most N at a time, oldest first, and a change that was tried against a real
// control and did not help is not tried again until its retry spacing has passed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ventureAction } from '../runtime/venture/records.ts';
import {
  EXPERIMENT_BUDGET_MICROS, EXPERIMENT_CANDIDATES, RETRY_SPACING_DAYS, budgetReached, experimentResult, reviewQueue,
} from '../runtime/venture/delivery/experiments.ts';
import { business, owner, plainDraft, PLAIN_IDEA, type Business } from './venture-judge-helpers.ts';

const SECTIONS_GUIDANCE = 'Use every required heading once, in the order given.';
const proposal = { level: 'harness', hypothesis: 'Every heading once should fix missing sections.', op: 'guidance.add', stepId: 'draft', value: SECTIONS_GUIDANCE, expectedFixes: ['missing-section'], likelyRegressions: ['A longer reply.'] };

/** Drafts skip their last heading unless the guidance asks for every one (helps: true), or always (helps: false). */
function improvable(env: Business, helps: boolean) {
  env.models.respond.delivery = task => {
    const draft = plainDraft(task) as { sections: unknown[] };
    return helps && (task.input as { guidance?: string[] }).guidance?.includes(SECTIONS_GUIDANCE) ? draft : { ...draft, sections: draft.sections.slice(0, -1) };
  };
  env.models.respond.improve = () => proposal;
}
async function seeded(env: Business, count = 2) {
  await env.call('venture.delivery.playbook');
  await ventureAction(env.deps, owner, 'prepare', 'seed.signals', tx => {
    for (let index = 0; index < count; index += 1) tx.put({ ...tx.base('venture-signal'), source: 'owner-rejected', runId: 'delivery_x', reason: 'missing-section', scenarioId: null });
  });
}

test('the result says what the change did only against a control; without one it is observed', () => {
  const gate = { wins: 2, losses: 0, ties: 3 };
  const controlled = experimentResult({ kind: 'parent-on-same-cases', cases: 5 }, gate);
  assert.equal(controlled.kind, 'caused');
  assert.match(controlled.line, /old version as the control on the same 5 practice cases/);
  assert.match(controlled.line, /won 2, lost 0 and tied 3/);
  const uncontrolled = experimentResult(null, gate);
  assert.equal(uncontrolled.kind, 'observed');
  assert.match(uncontrolled.line, /^Observed only/);
  assert.doesNotMatch(uncontrolled.line, /caus|made|because/i);
});

test('candidates are reviewed at most N at a time, oldest first, with retry spacing', () => {
  assert.equal(RETRY_SPACING_DAYS, 7);
  const now = Date.parse('2026-10-21T10:00:00.000Z');
  const day = 86_400_000;
  const items = Array.from({ length: EXPERIMENT_CANDIDATES + 5 }, (_, index) => ({ id: `c${index}`, at: new Date(now - (100 - index) * day).toISOString(), triedAt: null as string | null }));
  items[0].triedAt = new Date(now - 2 * day).toISOString(); // tried two days ago: waits
  items[1].triedAt = new Date(now - 8 * day).toISOString(); // tried eight days ago: may go again
  const queue = reviewQueue([...items].reverse(), { max: EXPERIMENT_CANDIDATES, now, spacingDays: RETRY_SPACING_DAYS });
  assert.equal(queue.length, EXPERIMENT_CANDIDATES);
  assert.equal(queue[0].id, 'c1');
  assert.ok(!queue.some(item => item.id === 'c0'));
  assert.deepEqual(queue.map(item => item.id), [...queue].sort((a, b) => (a.at < b.at ? -1 : 1)).map(item => item.id));
  assert.equal(budgetReached(EXPERIMENT_BUDGET_MICROS, EXPERIMENT_BUDGET_MICROS), true);
  assert.equal(budgetReached('0', EXPERIMENT_BUDGET_MICROS), false);
});

test('an improvement run records each change as an experiment: hypothesis, change, control and window, budget, stop and roll-back rules', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env, true);
  const run = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(run.status, 'kept-candidate');
  const experiment = run.rounds[0].experiment;
  assert.ok(experiment, JSON.stringify(run.rounds[0]));
  assert.equal(experiment.hypothesis, proposal.hypothesis);
  assert.match(experiment.change, /heading/i);
  assert.equal(experiment.control.kind, 'parent-on-same-cases');
  assert.equal(experiment.control.playbookHash, run.parentHash);
  assert.equal(experiment.control.cases, run.rounds[0].gate.cases.length);
  assert.ok(experiment.control.window.from <= experiment.control.window.to);
  assert.equal(experiment.budget.capMicros, EXPERIMENT_BUDGET_MICROS);
  assert.ok(experiment.stopRules.some((line: string) => /budget/.test(line)));
  assert.ok(experiment.stopRules.some((line: string) => /newly fail/.test(line)));
  assert.match(experiment.rollbackRule, /go back/);
  assert.equal(experiment.result.kind, 'caused');

  // With built-in templates both versions write the same draft: no real control, so the result is only observed.
  const plain = await business(PLAIN_IDEA);
  await seeded(plain);
  improvable(plain, true);
  const templated = await plain.call('venture.improve.run', { useTemplate: true, maxRounds: 1 });
  assert.equal(templated.rounds[0].experiment.control, null);
  assert.equal(templated.rounds[0].experiment.result.kind, 'observed');
});

test('a change tried against a real control that did not help waits its retry spacing before it is tried again', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env, false);
  const first = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(first.status, 'kept-parent', JSON.stringify(first.rounds.map((round: any) => round.gate?.reason)));
  const again = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(again.status, 'incomplete');
  assert.match(again.incompleteReason, /tried in the last 7 days/);
  // After the spacing it is tried again.
  env.setNow('2026-10-29T10:00:00.000Z');
  const later = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.notEqual(later.status, 'incomplete', later.incompleteReason);
});

test('with a control and no case won or lost, the result is no effect, never caused', () => {
  const none = experimentResult({ kind: 'parent-on-same-cases', cases: 5 }, { wins: 0, losses: 0, ties: 5 });
  assert.equal(none.kind, 'no-effect');
  assert.match(none.line, /made no difference on the same 5 practice cases/);
  assert.equal(experimentResult({ kind: 'parent-on-same-cases', cases: 5 }, { wins: 0, losses: 1, ties: 4 }).kind, 'caused');
});

test('an improvement run stops between rehearsal episodes once its budget is spent, and says so in rupees at your rate', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env, true);
  await ventureAction(env.deps, owner, 'approve', 'seed.policy', tx => tx.put({
    ...tx.base('venture-spend-policy'), capMicros: null, askAboveMicros: null, rates: [], rupeeRate: { perUsd: '835000', setOn: '2026-10-15' },
  } as never));
  // A budget of 250 micro-dollars: the proposal and the first practice episode use it up.
  const run = await env.call('venture.improve.run', { maxRounds: 2, budgetMicros: '250' });
  assert.equal(run.status, 'incomplete');
  assert.match(run.incompleteReason, /reached its budget of ₹0\.02 at ₹83\.50 per \$1/);
  assert.equal(run.rounds.length, 1);
  assert.equal(run.rounds[0].gate, null, 'a change cut short is not judged');
  assert.ok(BigInt(run.costMicros) < 2000n, run.costMicros);
  // A budget above the most a run may spend is refused.
  await assert.rejects(env.call('venture.improve.run', { budgetMicros: '9000000000' }), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
});

test('the proposer reads past signals whose reason waits its retry spacing, so newer signals reach it', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env, false);
  const first = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(first.status, 'kept-parent');
  // A newer signal with another reason arrives: it is what the next run tries, not the waiting one.
  // (The newest signal is held back for the gate, so two arrive.)
  await ventureAction(env.deps, owner, 'prepare', 'seed.signal', tx => { for (const runId of ['delivery_y', 'delivery_z']) tx.put({ ...tx.base('venture-signal'), source: 'owner-edited', runId, reason: 'tone', scenarioId: null }); });
  env.models.respond.improve = () => ({ ...proposal, hypothesis: 'Plain short sentences fix the tone.', value: 'Write short plain sentences, warm and direct, with no hype.', expectedFixes: ['tone'] });
  const again = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(again.rounds[0].diagnosis.chosen?.reason, 'tone');
  assert.ok(!again.rounds[0].diagnosis.clusters.some((cluster: any) => cluster.reason === 'missing-section'), 'the waiting reason is left out of the pool');
});

test('old signals no playbook change can fix (calculator or dictionary) never fill the proposer\'s slots', async () => {
  const env = await business(PLAIN_IDEA);
  await env.call('venture.delivery.playbook');
  // Twenty-five old wrong numbers (the calculator's, never a prompt's), then a dozen missing sections.
  await ventureAction(env.deps, owner, 'prepare', 'seed.signals', tx => {
    for (let index = 0; index < 25; index += 1) tx.put({ ...tx.base('venture-signal'), at: new Date(Date.parse('2026-09-01T10:00:00.000Z') + index * 60_000).toISOString(), source: 'owner-rejected', runId: 'delivery_x', reason: 'wrong-number', scenarioId: null });
    for (let index = 0; index < 12; index += 1) tx.put({ ...tx.base('venture-signal'), source: 'owner-rejected', runId: 'delivery_y', reason: 'missing-section', scenarioId: null });
  });
  improvable(env, true);
  const run = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(run.rounds[0].diagnosis.chosen?.reason, 'missing-section', JSON.stringify(run.rounds[0].diagnosis));
  assert.ok(!run.rounds[0].diagnosis.clusters.some((cluster: any) => cluster.reason === 'wrong-number'));
});

test('4J22a: an experiment with a control carries its lift from the same paired cases, worked out by code, a model estimate', async () => {
  const { experimentOf } = await import('../runtime/venture/delivery/experiments.ts');
  const { LIFT_NOT_ENOUGH } = await import('../runtime/venture/delivery/lift.ts');
  const score = (passed: boolean) => ({ passed, checksPassed: passed ? 3 : 2, checksRun: 3, judgeYes: passed ? 1 : 0, critical: null, firstFailure: null });
  const cases = (pairs: [boolean, boolean][]) => pairs.map(([parent, candidate], i) => ({ scenarioId: `s${i}`, set: 'rehearsal' as const, parent: score(parent), candidate: score(candidate), winner: parent === candidate ? 'tie' as const : candidate ? 'candidate' as const : 'parent' as const }));
  const patch = { id: 'patch-1', note: { hypothesis: 'Headings help.', expectedFixes: [], likelyRegressions: [] } } as any;
  const window = { from: '2026-10-01T00:00:00.000Z', to: '2026-10-20T00:00:00.000Z' };
  const few = experimentOf({ patch, change: 'Adds a heading.', parentHash: 'h', sameDrafts: false, window, spentMicros: '0', maxRounds: 1,
    gate: { cases: cases([[false, true], [true, true]]), wins: 1, losses: 0, ties: 1, candidateCritical: 0, newBlockFailures: 0, decision: 'keep-candidate', reason: '' } });
  assert.ok(few.lift);
  assert.equal(few.lift.line, LIFT_NOT_ENOUGH);
  assert.equal(few.lift.cases, 2);
  assert.match(few.lift.digest, /^[0-9a-f]{64}$/);
  const many = experimentOf({ patch, change: 'Adds a heading.', parentHash: 'h', sameDrafts: false, window, spentMicros: '0', maxRounds: 1,
    gate: { cases: cases(Array.from({ length: 8 }, () => [false, true] as [boolean, boolean])), wins: 8, losses: 0, ties: 0, candidateCritical: 0, newBlockFailures: 0, decision: 'keep-candidate', reason: '' } });
  assert.equal(many.lift!.direction, 'better');
  assert.equal(many.lift!.estimate, true);
  // The screen labels the model estimate once, from estimate; the line leaves lift.ts's sentence out.
  assert.match(many.lift!.line, /The change likely helps\.$/);
  // No control, no lift: nothing to compare.
  const none = experimentOf({ patch, change: 'Adds a heading.', parentHash: 'h', sameDrafts: true, window, spentMicros: '0', maxRounds: 1, gate: null });
  assert.equal(none.lift, null);
});
