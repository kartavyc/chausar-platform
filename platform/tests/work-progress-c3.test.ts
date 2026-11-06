// One-shot C3 task 9: which step long work is on. Each handler says when a step starts and ends; the frames carry no
// seq and nothing is written to a vault or the event log for them; venture.work.list reads the live job for a page
// opened mid-job, and nothing after, also after a handler throws.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ventureAction } from '../runtime/venture/records.ts';
import { NO_WORK, WorkProgress, type WorkStepEvent } from '../runtime/work-progress.ts';
import { WORK_STEPS } from '../runtime/venture/views/work-steps.ts';
import { LoginDesk } from '../runtime/venture/models/login.ts';
import { engineFor } from './fixtures/venture/compose-unit/harness.ts';
import { business, owner, plainDraft, PLAIN_IDEA, type Business } from './venture-judge-helpers.ts';

const FIXED = new Date('2026-11-06T10:00:00.000Z');

function watch(env: Business, businessId = 'main') {
  const frames: WorkStepEvent[] = [];
  const progress = new WorkProgress((event) => frames.push(event), () => FIXED);
  (env.deps as { work?: unknown }).work = { begin: (kind: string, steps: readonly string[]) => progress.begin(kind as never, steps, { businessId }) };
  return { frames, progress };
}

const proposal = { level: 'harness', hypothesis: 'Every heading once should fix missing sections.', op: 'guidance.add', stepId: 'draft', value: 'Use every required heading once, in the order given.' };
function improvable(env: Business) {
  env.models.respond.delivery = (task) => {
    const draft = plainDraft(task) as { sections: unknown[] };
    return (task.input as { guidance?: string[] }).guidance?.includes(proposal.value) ? draft : { ...draft, sections: draft.sections.slice(0, -1) };
  };
  env.models.respond.improve = () => proposal;
}
async function seeded(env: Business) {
  await env.call('venture.delivery.playbook');
  await ventureAction(env.deps, owner, 'prepare', 'seed.signals', (tx) => {
    for (let index = 0; index < 2; index += 1) tx.put({ ...tx.base('venture-signal'), source: 'owner-rejected', runId: 'delivery_x', reason: 'missing-section', scenarioId: null } as never);
  });
}

test('a job lists its steps, moves them, ends, and never throws into its handler', () => {
  const frames: WorkStepEvent[] = [];
  const progress = new WorkProgress((event) => { frames.push(event); throw new Error('a listener failed'); }, () => FIXED);
  const work = progress.begin('about', ['read', 'field'], { businessId: 'a' });
  assert.deepEqual(progress.list('a')[0]!.steps, [{ id: 'read', state: 'waiting' }, { id: 'field', state: 'waiting' }]);
  work.step('read', 'current');
  work.step('read', 'done');
  assert.deepEqual(progress.list('a')[0]!.steps[0], { id: 'read', state: 'done' });
  assert.deepEqual(frames.map((frame) => [frame.step, frame.state]), [['read', 'current'], ['read', 'done']]);
  assert.ok(frames.every((frame) => !('seq' in frame)));
  assert.deepEqual(progress.list('b'), []);
  work.end();
  assert.deepEqual(progress.list('a'), []);
  work.step('field', 'current');
  assert.equal(frames.length, 2, 'an ended job says nothing more');
  NO_WORK.step('x', 'done');
  NO_WORK.end();
});

test('one live job per kind per business: a new one replaces the old, and the old one goes quiet', () => {
  const frames: WorkStepEvent[] = [];
  const progress = new WorkProgress((event) => frames.push(event), () => FIXED);
  const first = progress.begin('improve', ['read'], { businessId: 'a' });
  const second = progress.begin('improve', ['read'], { businessId: 'a' });
  first.step('read', 'current');
  assert.equal(frames.length, 0);
  first.end();
  assert.equal(progress.list('a').length, 1);
  second.end();
  assert.deepEqual(progress.list('a'), []);
});

test('venture.improve.run sends its steps in order, each current then done, and only its own commit moves the log', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env);
  const { frames, progress } = watch(env);
  let during = 0;
  const respond = env.models.respond.improve!;
  env.models.respond.improve = (task) => { during = progress.list('main').length; return respond(task); };
  const before = env.store.read().conversations.length;
  const run = await env.call('venture.improve.run', { maxRounds: 1 });
  assert.equal(run.status, 'kept-candidate');
  assert.equal(during, 1, 'the job is listed while it runs');
  assert.deepEqual(progress.list('main'), [], 'and not after');
  const ids = WORK_STEPS.improve.map((step) => step.id);
  assert.deepEqual(frames.map((frame) => [frame.step, frame.state]), ids.flatMap((id) => [[id, 'current'], [id, 'done']]));
  assert.ok(frames.every((frame) => frame.kind === 'improve' && !('seq' in frame) && frame.at === FIXED.toISOString()));
  // The steps write nothing: what the run wrote is its own commit, as it was before.
  assert.ok(env.store.read().conversations.length > before);
  assert.ok(!JSON.stringify(env.store.read()).includes('work.step'));
});

test('a handler that throws ends its job too, and the step it stopped on says it failed', async () => {
  const env = await business(PLAIN_IDEA);
  await seeded(env);
  improvable(env);
  const { progress } = watch(env);
  const store = env.deps.store as { update: unknown };
  const update = store.update;
  store.update = () => { throw new Error('the disk went away'); };
  await assert.rejects(env.call('venture.improve.run', { maxRounds: 1 }));
  store.update = update;
  assert.deepEqual(progress.list('main'), []);
  const frames: WorkStepEvent[] = [];
  const own = new WorkProgress((event) => frames.push(event), () => FIXED);
  const work = own.begin('about', ['read'], { businessId: 'a' });
  work.step('read', 'current');
  work.failCurrent();
  assert.deepEqual(frames.map((frame) => frame.state), ['current', 'failed']);
});

test('the tool check says one step per tool, the fast one done first', async () => {
  const frames: WorkStepEvent[] = [];
  const progress = new WorkProgress((event) => frames.push(event), () => FIXED);
  const desk = new LoginDesk({
    claudeTerms: 'accepted', statusCacheMs: 0, locate: () => null,
    work: { begin: (kind, steps) => progress.begin(kind, steps, { businessId: '' }) },
  });
  await desk.tools();
  const steps = frames.map((frame) => frame.step);
  assert.deepEqual([...new Set(steps)].sort(), ['claude-code', 'codex']);
  assert.ok(frames.every((frame) => frame.kind === 'ai-tools'));
  assert.equal(frames.filter((frame) => frame.state === 'done').length, 2);
  assert.deepEqual(progress.list(''), []);
});

test('venture.simulation.run sends one step per practice client, with passed matching the record', async () => {
  const env = await business(PLAIN_IDEA);
  await env.call('venture.delivery.playbook');
  const { frames } = watch(env);
  const run = await env.call('venture.simulation.run', { episodes: 1 });
  const done = frames.filter((frame) => frame.state === 'done');
  assert.ok(done.length >= 1);
  assert.deepEqual(done.map((frame) => frame.step), run.scenarioIds);
  for (const frame of done) {
    const passed = run.episodes.filter((episode: { scenarioId: string }) => episode.scenarioId === frame.step).every((episode: { passed: boolean }) => episode.passed);
    assert.equal(frame.passed, passed, frame.step);
  }
  assert.deepEqual(frames.filter((frame) => frame.state === 'current').map((frame) => frame.step), run.scenarioIds);
});

test('through the engine: about.read sends its three steps with no business open, venture.work.list answers, and no frame has a seq', async (t) => {
  const { engine } = await engineFor(t);
  const frames: any[] = [];
  engine.onVentureEvent((event) => frames.push(event));
  assert.deepEqual(await engine.request('venture.work.list', {}), { work: [] });
  await engine.request('venture.about.read', { text: 'I tutor maths to school students on weekends in Pune, India.' });
  const steps = frames.filter((frame) => frame.type === 'work.step');
  assert.deepEqual(steps.map((frame) => [frame.step, frame.state]), WORK_STEPS.about.flatMap((step) => [[step.id, 'current'], [step.id, 'done']]));
  assert.ok(steps.every((frame) => frame.kind === 'about' && frame.businessId === '' && !('seq' in frame)));
  assert.deepEqual(await engine.request('venture.work.list', {}), { work: [] });
  await assert.rejects(engine.request('venture.work.list', { extra: 1 }), { code: 'INVALID_VENTURE_REQUEST' });
});
