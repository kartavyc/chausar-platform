// Routines (Ink v2 wave 4, package 4J13; catalogue A12): schedules stored as once, interval or calendar with a time
// zone, never cron text; prompts that stand on their own (ROUTINE_NOT_STANDALONE); an agent's routine never touches the
// owner's (ROUTINE_NOT_YOURS); the runner's states (missed with a count, the catch-up window, no overlap, only the
// latest missed occurrence after a restart, interrupted never run again, skipped while paused); a routine never
// approves anything: each run parks on Today, an unanswered one counts as no after 24 hours; the chief's Weekly review
// answers into a pinned chat; history says delivered, never done.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { ConnectorCheckRecord, RoutineInput, RoutineRecord, RoutineRunRecord, RoutineRunsView, RoutinesView, RoutineView } from '../runtime/venture/contracts.ts';
import { currentVenture, listRecords, ventureAction } from '../runtime/venture/records.ts';
import { nextOccurrence, occurrencesBetween, removeRoutine, saveRoutine, weeklyReview, whenWords } from '../runtime/venture/agents/routines.ts';
import { ROUTINE_WORDS, routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { sweepWholeJournal } from '../runtime/venture/build/journal-sweep.ts';
import { chatRoute } from '../runtime/venture/agents/consent.ts';
import { answer, chatConsent, chiefBusiness, scriptChief, text, type ChiefEnv } from './venture-chief-helpers.ts';
import { askingRun, said, scriptChat } from './venture-agent-helpers.ts';
import { NOW, owner } from './venture-judge-helpers.ts';

const phone: Context = { ...owner, channel: 'phone' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const MIN = 60_000;
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
const PROMPT = 'Tell me which videos are waiting on me and what each one needs from me.';
const hourly = (name = 'Check in', agent: string | null = null): RoutineInput => ({ name, agent, prompt: PROMPT, on: true, schedule: { kind: 'interval', everyMinutes: 60, from: NOW } });

/** A row for the chat tier's AI in a connection check, as Check connections writes it (4J7). */
async function checked(env: ChiefEnv): Promise<void> {
  const route = chatRoute(env.models.status());
  assert.ok(route);
  await ventureAction(env.deps, owner, 'prepare', 'test.check', tx => tx.put<ConnectorCheckRecord>({
    ...tx.base('venture-connector-check'), rows: [{ connectorId: `model:${route.presetId}`, outcome: 'answered', line: 'Your key answered.', account: null, expiresOn: null }],
  }));
}
const setRaw = (env: ChiefEnv, routine: unknown, ctx: Context = owner) => env.agents('venture.routines.set', { routine }, ctx) as Promise<{ routine: RoutineView }>;
async function set(env: ChiefEnv, routine: unknown, ctx: Context = owner): Promise<{ routine: RoutineView }> {
  if (!listRecords(env.store.read(), 'venture-connector-check').length) await checked(env);
  return setRaw(env, routine, ctx);
}
const runsOf = (env: ChiefEnv, id: string) => env.agents('venture.routines.runs', { id }) as Promise<RoutineRunsView>;
const tick = (env: ChiefEnv) => routineTick(env.deps, owner);
const routineRows = async (env: ChiefEnv) => (await env.call('venture.queue.list')).rows.filter((row: any) => row.id.startsWith('routine:'));

test('a schedule is once, every so many minutes, or days at a time in a named zone, never cron text; the owner sets it in the app', async () => {
  const env = await chiefBusiness();
  const venture = currentVenture(env.store.read())!;
  const review = weeklyReview(venture);
  assert.deepEqual(review.schedule, { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' });
  await assert.rejects(set(env, review, phone), code('APP_APPROVAL_REQUIRED'));
  const { routine } = await set(env, review);
  assert.equal(routine.when, 'Every Monday 09:00, Asia/Kolkata');
  // NOW is Wednesday 21 October, 15:30 in India: the next Monday 09:00 there is 03:30 UTC on the 26th.
  assert.equal(routine.next, '2026-10-26T03:30:00.000Z');
  assert.match(routine.line, /waits for your approval on Today/);
  const listed = await env.agents('venture.routines.list') as RoutinesView;
  assert.deepEqual(listed.routines.map(item => item.id), [routine.id]);
  const stored = listRecords(env.store.read(), 'venture-routine')[0];
  assert.deepEqual([stored.setBy, stored.schedule.kind], ['owner', 'calendar']);

  for (const schedule of [
    { kind: 'cron', expression: '0 9 * * 1' },
    { kind: 'calendar', weekdays: [1], time: '0 9 * * 1', timeZone: 'Asia/Kolkata' },
    { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata', cron: '0 9 * * 1' },
    { kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Mars/Olympus' },
    { kind: 'calendar', weekdays: [0], time: '09:00', timeZone: 'Asia/Kolkata' },
    { kind: 'interval', everyMinutes: 5, from: NOW },
    { kind: 'once', at: 'next monday' },
    '0 9 * * 1',
  ]) {
    await assert.rejects(set(env, { ...review, schedule }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(schedule));
  }
  assert.equal(whenWords({ kind: 'calendar', weekdays: [1, 2, 3, 4, 5], time: '18:30', timeZone: 'Europe/London' }, venture), 'Every weekday 18:30, Europe/London');
  assert.equal(whenWords({ kind: 'calendar', weekdays: [1, 4], time: '07:00', timeZone: 'Asia/Kolkata' }, venture), 'Every Monday and Thursday 07:00, Asia/Kolkata');
  assert.equal(whenWords({ kind: 'interval', everyMinutes: 120, from: NOW }, venture), 'Every 2 hours, from 21 Oct 2026, 15:30, Asia/Kolkata');
  assert.equal(whenWords({ kind: 'once', at: NOW }, venture), 'Once, 21 Oct 2026, 15:30, Asia/Kolkata');
});

test('a routine is switched on only for an AI connection Check connections looked at: ROUTINE_NEEDS_CHECK; off needs none', async () => {
  const env = await chiefBusiness();
  await assert.rejects(setRaw(env, hourly()), code('ROUTINE_NEEDS_CHECK'));
  const off = await setRaw(env, { ...hourly(), on: false });
  assert.equal(off.routine.line, 'Off. Nothing runs.');
  await checked(env);
  const on = await setRaw(env, { ...hourly(), id: off.routine.id, on: true });
  assert.equal(on.routine.on, true);
});

test('a routine runs without the chat, so a prompt that leans on one is refused: ROUTINE_NOT_STANDALONE', async () => {
  const env = await chiefBusiness();
  for (const prompt of ['Send me the same summary as above, please.', 'Do this one again every week.', 'Write the report like before.', 'Pehle jaisa weekly report banao.', 'ऊपर वाला काम फिर से करो, हर हफ्ते।']) {
    await assert.rejects(set(env, { ...hourly(), prompt }), code('ROUTINE_NOT_STANDALONE'), prompt);
  }
  await assert.rejects(set(env, { ...hourly(), prompt: `Check the key ${'sk_' + 'live_' + 'a1B2c3D4e5F6g7H8i9J0k1L2'} still works.` }), code('CHAT_KEY_REFUSED'));
  await assert.rejects(set(env, { ...hourly(), agent: 'nobody' }), code('INVALID_VENTURE_REQUEST'));
  assert.deepEqual(listRecords(env.store.read(), 'venture-routine'), [], 'nothing refused is kept');
  const { routine } = await set(env, hourly());
  assert.ok(routine.id);
});

test("an agent's or the chief's routine can never change or remove the owner's: ROUTINE_NOT_YOURS", async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly());
  const change = (by: RoutineRecord['setBy']) => ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, { ...hourly('Renamed'), id: routine.id }, by));
  await assert.rejects(change('agent'), code('ROUTINE_NOT_YOURS'));
  await assert.rejects(change('chief'), code('ROUTINE_NOT_YOURS'));
  await assert.rejects(ventureAction(env.deps, owner, 'approve', 'test.routine', tx => removeRoutine(tx, routine.id, 'agent')), code('ROUTINE_NOT_YOURS'));
  // An agent's own routine: the agent may change it, and so may the owner, after which it is the owner's.
  const mine = await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, hourly('Agent check', 'story-editor'), 'agent'));
  await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, { ...hourly('Agent check again', 'story-editor'), id: mine.id }, 'agent'));
  const taken = await set(env, { ...hourly('Owner now', 'story-editor'), id: mine.id });
  assert.equal(listRecords(env.store.read(), 'venture-routine').find(item => item.id === taken.routine.id)!.setBy, 'owner');
  await assert.rejects(ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, { ...hourly('Agent again', 'story-editor'), id: mine.id }, 'agent')), code('ROUTINE_NOT_YOURS'));
  const removed = await env.agents('venture.routines.remove', { id: routine.id });
  assert.deepEqual(removed, { removed: true, line: 'Check in is removed. Its history stays.' });
  assert.equal((await env.agents('venture.routines.list') as RoutinesView).routines.some(item => item.id === routine.id), false);
});

test('a due run parks on Today and never approves itself; a new occurrence while it waits is skipped; 24 hours unanswered counts as no', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly());
  env.setNow(at(30 * MIN));
  await tick(env);
  assert.equal(listRecords(env.store.read(), 'venture-routine-run').length, 0, 'nothing is due yet');

  env.setNow(at(70 * MIN));
  await tick(env);
  await tick(env);
  let runs = (await runsOf(env, routine.id)).runs;
  assert.deepEqual(runs.map(run => [run.dueAt, run.state, run.line]), [[at(60 * MIN), 'needs-input', ROUTINE_WORDS.waiting]], 'one run, parked once');
  const rows = await routineRows(env);
  assert.equal(rows.length, 1, 'one card on Today, so one notification');
  assert.equal(rows[0].kind, 'proposal');
  assert.equal(rows[0].title, 'Check in is due');
  assert.match(rows[0].line, /Nothing changes until you approve\.$/);
  assert.deepEqual(rows[0].actions.map((item: any) => [item.id, item.label, item.primary]), [['deny', 'Not now', false], ['approve', 'Run it', true]]);
  assert.equal(listRecords(env.store.read(), 'venture-model-call').filter(call => call.purpose === 'chief-chat').length, 0, 'nothing went to the AI on its own');

  env.setNow(at(130 * MIN));
  await tick(env);
  runs = (await runsOf(env, routine.id)).runs;
  assert.deepEqual(runs.map(run => run.state), ['skipped', 'needs-input'], 'newest first: the overlap is skipped');
  assert.equal(runs[0].line, ROUTINE_WORDS.overlap);

  env.setNow(at(70 * MIN + 24 * 60 * MIN + MIN));
  await tick(env);
  runs = (await runsOf(env, routine.id)).runs;
  const parked = runs.find(run => run.dueAt === at(60 * MIN))!;
  assert.deepEqual([parked.state, parked.line], ['skipped', ROUTINE_WORDS.noAnswer]);
  assert.equal((await routineRows(env)).some((row: any) => row.id.includes(parked.id)), false, 'its card is gone');
  const decision = (await env.call('venture.decisions.list')).decisions.find((item: any) => item.subject === `routine:${parked.id}`);
  assert.equal(decision.who, 'timeout');
  assert.equal(decision.line, 'No answer in time: Check in waited 24 hours for your approval, so it did not run.');
  assert.ok(runs.every(run => !/\bdone\b/i.test(run.line)), 'history never says done');
});

test('missed occurrences: one missed run with the count; only the latest inside the 60-minute window runs', async () => {
  const env = await chiefBusiness();
  const daily = await set(env, { name: 'Morning look', agent: null, prompt: PROMPT, on: true, schedule: { kind: 'calendar', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '09:00', timeZone: 'Asia/Kolkata' } });
  // Closed from Wednesday afternoon to Saturday 11:00 in India: Thursday, Friday and Saturday 09:00 all passed, the last two hours ago.
  env.setNow('2026-10-24T05:30:00.000Z');
  await tick(env);
  const missed = (await runsOf(env, daily.routine.id)).runs;
  assert.deepEqual(missed.map(run => [run.state, run.line, run.dueAt]), [['missed', 'Missed 3 times while Chausar was closed.', '2026-10-24T03:30:00.000Z']]);
  assert.equal(listRecords(env.store.read(), 'venture-routine-run').find(run => run.state === 'missed')!.missed, 3);

  // A quarter-hourly routine, closed 50 minutes: three occurrences, the newest 5 minutes ago. Only it runs.
  const start = Date.parse('2026-10-24T05:30:00.000Z');
  const quarter = await set(env, { name: 'Inbox look', agent: null, prompt: PROMPT, on: true, schedule: { kind: 'interval', everyMinutes: 15, from: new Date(start).toISOString() } });
  env.setNow(new Date(start + 50 * MIN).toISOString());
  await tick(env);
  const runs = (await runsOf(env, quarter.routine.id)).runs;
  assert.deepEqual(runs.map(run => [run.state, run.dueAt]), [['needs-input', new Date(start + 45 * MIN).toISOString()], ['missed', new Date(start + 30 * MIN).toISOString()]]);
  assert.equal(runs[1].line, 'Missed 2 times while Chausar was closed.');
});

test('paused: a due run is skipped with "Paused by you"; a run a crash left running is interrupted and never run again', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly());
  await env.call('venture.business.pause', { paused: true });
  env.setNow(at(61 * MIN));
  await tick(env);
  let runs = (await runsOf(env, routine.id)).runs;
  assert.deepEqual(runs.map(run => [run.state, run.line]), [['skipped', 'Skipped: Paused by you.']]);
  await env.call('venture.business.pause', { paused: false });

  // A sweep of an earlier engine process claimed the next one and died before parking it.
  await ventureAction(env.deps, owner, 'prepare', 'test.crash', tx => tx.put<RoutineRunRecord>({
    ...tx.base('venture-routine-run'), routineId: routine.id, dueAt: at(120 * MIN), state: 'running', line: ROUTINE_WORDS.running, missed: 0, runId: null, threadId: null,
  }));
  env.setNow(at(125 * MIN));
  await tick(env);
  runs = (await runsOf(env, routine.id)).runs;
  assert.deepEqual(runs.map(run => [run.dueAt, run.state]), [[at(120 * MIN), 'interrupted'], [at(60 * MIN), 'skipped']], 'interrupted, and that occurrence is not run again');
  assert.equal(runs[0].line, ROUTINE_WORDS.interrupted);
  await tick(env);
  assert.equal((await runsOf(env, routine.id)).runs.length, 2);
});

test('Not now skips the run; nothing is sent', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly());
  env.setNow(at(61 * MIN));
  await tick(env);
  const [row] = await routineRows(env);
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'deny' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  const [run] = (await runsOf(env, routine.id)).runs;
  assert.deepEqual([run.state, run.line], ['skipped', ROUTINE_WORDS.notNow]);
  assert.equal((await routineRows(env)).length, 0);
});

test("the chief's Weekly review: Run it sends the prompt as the owner's own message, and the answer lands in a pinned chat; delivered", async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChief(env, [answer([text('This week two videos went out and one waits on your notes.')])]);
  const { routine } = await set(env, weeklyReview(currentVenture(env.store.read())!));
  env.setNow('2026-10-26T03:35:00.000Z');
  await sweepWholeJournal(env.deps, owner); // the engine's sweep runs the routines
  const [row] = await routineRows(env);
  assert.equal(row.title, 'Weekly review is due');
  assert.equal(row.agent, 'Chausar');
  assert.match(row.line, /The answer goes to your Weekly review chat with Chausar\./);
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  const thread = listRecords(env.store.read(), 'venture-chief-thread').find(item => item.routine === routine.id)!;
  assert.deepEqual([thread.title, thread.pinned], ['Weekly review', true]);
  const messages = listRecords(env.store.read(), 'venture-chief-message').filter(message => message.threadId === thread.id);
  assert.deepEqual(messages.map(message => message.from), ['owner', 'chief']);
  assert.equal(messages[0].text, weeklyReview(currentVenture(env.store.read())!).prompt);
  assert.match(messages[1].text, /two videos went out/);
  const [run] = (await runsOf(env, routine.id)).runs;
  assert.deepEqual([run.state, run.line], ['completed', 'Delivered to your Weekly review chat with Chausar.']);
  assert.equal((await routineRows(env)).length, 0);
});

test("an agent's routine: Run it posts the prompt in the agent's chat through the chat consent; without it the run keeps waiting", async () => {
  const env = await chiefBusiness();
  scriptChat(env, { answer: () => ({ parts: [said('Two videos wait on your notes.')] }) });
  const { routine } = await set(env, hourly('Editor check', 'story-editor'));
  env.setNow(at(61 * MIN));
  await tick(env);
  let [row] = await routineRows(env);
  assert.equal(row.agent, 'Story editor');
  const refused = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'CHAT_CONSENT_REQUIRED']);
  assert.equal(listRecords(env.store.read(), 'venture-model-call').filter(call => call.purpose === 'agent-chat').length, 0, 'nothing went to the AI');
  let [run] = (await runsOf(env, routine.id)).runs;
  assert.equal(run.state, 'needs-input', 'nothing was sent, so it still waits');
  await chatConsent(env);
  [row] = await routineRows(env);
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  [run] = (await runsOf(env, routine.id)).runs;
  assert.deepEqual([run.state, run.line], ['completed', "Delivered to Story editor's chat."]);
  const thread = await env.agents('venture.agents.thread.list', { agent: 'story-editor' });
  assert.ok(JSON.stringify(thread).includes(PROMPT));
});

// ---------------------------------------------------------------------------
// Review follow-ups (4J13)
// ---------------------------------------------------------------------------

test('away: a routine keeps running while the owner is away; its run still waits on Today', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly());
  await env.call('venture.away.set', { from: '2026-10-21', to: '2026-10-25' });
  env.setNow(at(61 * MIN));
  await tick(env);
  const [run] = (await runsOf(env, routine.id)).runs;
  assert.deepEqual([run.state, run.line], ['needs-input', ROUTINE_WORDS.waiting]);
  const away = await env.call('venture.away.get');
  assert.ok(away.keepsRunning.includes('Routine: Check in'), JSON.stringify(away.keepsRunning));
  assert.doesNotMatch(away.line, /Routines wait/);
});

test('only routines the owner set run: one an agent saved never parks', async () => {
  const env = await chiefBusiness();
  await checked(env);
  const theirs = await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, hourly('Agent check', 'story-editor'), 'agent'));
  env.setNow(at(61 * MIN));
  await tick(env);
  assert.deepEqual(listRecords(env.store.read(), 'venture-routine-run').filter(run => run.routineId === theirs.id), []);
});

test('one routine that fails is recorded on that routine; the others still run', async () => {
  const env = await chiefBusiness();
  const good = await set(env, hourly('Good one'));
  const broken = await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => tx.put<RoutineRecord>({
    ...tx.base('venture-routine'), name: 'Broken', agent: null, setBy: 'owner', prompt: PROMPT, on: true, removedAt: null,
    schedule: { kind: 'calendar', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '09:00', timeZone: 'Not/AZone' },
  }));
  env.setNow(at(61 * MIN));
  await tick(env);
  assert.equal((await runsOf(env, good.routine.id)).runs[0].state, 'needs-input');
  const [failed] = (await runsOf(env, broken.id)).runs;
  assert.equal(failed.state, 'failed');
  assert.match(failed.line, /^Could not run: /);
  await tick(env);
  assert.equal((await runsOf(env, broken.id)).runs.length, 1, 'recorded once, not on every sweep');
});

test('an agent no longer on the team: skipped; a once time already past is refused; the card says when it runs out', async () => {
  const env = await chiefBusiness();
  await checked(env);
  const gone = await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => tx.put<RoutineRecord>({
    ...tx.base('venture-routine'), name: 'Gone agent', agent: 'left-the-team', setBy: 'owner', prompt: PROMPT, on: true, removedAt: null, schedule: hourly().schedule,
  }));
  await assert.rejects(setRaw(env, { ...hourly(), schedule: { kind: 'once', at: at(-MIN) } }), code('INVALID_VENTURE_REQUEST'));
  const once = await setRaw(env, { ...hourly('Once'), schedule: { kind: 'once', at: at(30 * MIN) } });
  env.setNow(at(61 * MIN));
  await tick(env);
  assert.deepEqual((await runsOf(env, gone.id)).runs.map(run => [run.state, run.line]), [['skipped', ROUTINE_WORDS.gone]]);
  const [parked] = (await runsOf(env, once.routine.id)).runs;
  assert.equal(parked.state, 'needs-input');
  const row = (await routineRows(env)).find((item: any) => item.id.includes(parked.id));
  const stored = listRecords(env.store.read(), 'venture-routine-run').find(run => run.id === parked.id)!;
  assert.equal(row.meta.expiresAt, new Date(Date.parse(stored.at) + 24 * 60 * MIN).toISOString());
});

test('Run it checks the AI connection again: a connection never checked keeps the run waiting (ROUTINE_NEEDS_CHECK)', async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  const { routine } = await set(env, hourly());
  env.setNow(at(61 * MIN));
  await tick(env);
  // The chat tier's AI changed to one Check connections never looked at.
  const status = env.models.status.bind(env.models);
  env.models.status = () => { const view = status(); return { ...view, tiers: { ...view.tiers, main: { ...view.tiers.main, presetId: 'openai-gpt-6-luna', model: 'gpt-6-luna' } } }; };
  const [row] = await routineRows(env);
  const refused = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.deepEqual([refused.outcome, refused.reason], ['refused', 'ROUTINE_NEEDS_CHECK']);
  const [run] = (await runsOf(env, routine.id)).runs;
  assert.equal(run.state, 'needs-input', 'nothing was sent, so it still waits');
});

test("Run it on an agent's routine never answers the agent's waiting question and never drafts a standing order or a note", async () => {
  const env = await chiefBusiness();
  await chatConsent(env);
  scriptChat(env, { answer: () => ({ parts: [said('One episode waits on your answer about its length.')] }) });
  const asked = await askingRun(env);
  const prompt = 'From now on, tell me every Monday which episodes wait on me. Remember that I like short lists.';
  const { routine } = await set(env, { ...hourly('Producer check', 'producer'), prompt });
  env.setNow(at(61 * MIN));
  await tick(env);
  const [row] = await routineRows(env);
  const decided = await env.call('venture.queue.decide', { id: row.id, digest: row.digest, action: 'approve' });
  assert.equal(decided.outcome, 'done', JSON.stringify(decided));
  const run = (await env.call('venture.delivery.list')).find((item: any) => item.id === asked.id);
  assert.equal(run.status, 'needs-answer', 'the question still waits for the owner');
  assert.equal(run.harness.handoffs.at(-1).answer, null);
  assert.deepEqual(listRecords(env.store.read(), 'venture-agent-proposal'), [], 'no standing order or note proposal');
  const messages = listRecords(env.store.read(), 'venture-agent-message').filter(message => message.agent === 'producer');
  assert.deepEqual(messages.map(message => message.from), ['owner', 'agent']);
  assert.equal(messages[0].text, prompt);
  assert.equal((await runsOf(env, routine.id)).runs[0].state, 'completed');
});

test('prompts that stand on their own pass, words like above-average and from earlier today included', async () => {
  const env = await chiefBusiness();
  for (const prompt of [
    'Find the above-average videos this week and tell me why they did well.',
    'Do the same thing for every new client each Monday: a short welcome note.',
    'Summarise the emails from earlier today about sponsorships.',
    'Make the thumbnails look like that brand guide in my files: bright, plain, one word.',
  ]) {
    const { routine } = await set(env, { ...hourly(), prompt });
    assert.ok(routine.id, prompt);
  }
});

test('time zones: days are walked on the local calendar; a skipped time runs as the clock jumps, a doubled time once, the first', () => {
  const daily = (time: string, timeZone: string) => ({ kind: 'calendar' as const, weekdays: [1, 2, 3, 4, 5, 6, 7], time, timeZone });
  // London springs forward on 28 March 2027: 09:00 is 09:00 UTC the day before, 08:00 UTC from that day.
  const london = occurrencesBetween(daily('09:00', 'Europe/London'), Date.parse('2027-03-26T12:00:00Z'), Date.parse('2027-03-29T12:00:00Z'));
  assert.deepEqual(london, { count: 3, latest: '2027-03-29T08:00:00.000Z', previous: '2027-03-28T08:00:00.000Z' });
  assert.equal(nextOccurrence(daily('09:00', 'Europe/London'), Date.parse('2027-03-27T09:30:00Z')), '2027-03-28T08:00:00.000Z');
  // 01:30 does not happen in London that day: it runs at 02:30, when the clock has jumped (01:30 UTC).
  assert.equal(nextOccurrence({ kind: 'calendar', weekdays: [7], time: '01:30', timeZone: 'Europe/London' }, Date.parse('2027-03-27T12:00:00Z')), '2027-03-28T01:30:00.000Z');
  // New York springs forward on 14 March 2027: 09:00 is 14:00 UTC the day before and 13:00 UTC that day; 02:30 runs at 03:30 EDT.
  const york = occurrencesBetween(daily('09:00', 'America/New_York'), Date.parse('2027-03-12T20:00:00Z'), Date.parse('2027-03-14T20:00:00Z'));
  assert.deepEqual(york, { count: 2, latest: '2027-03-14T13:00:00.000Z', previous: '2027-03-13T14:00:00.000Z' });
  assert.equal(nextOccurrence({ kind: 'calendar', weekdays: [7], time: '02:30', timeZone: 'America/New_York' }, Date.parse('2027-03-13T12:00:00Z')), '2027-03-14T07:30:00.000Z');
  // London falls back on 25 October 2026: 01:30 happens twice; the routine runs once, at the first.
  const doubled = { kind: 'calendar' as const, weekdays: [7], time: '01:30', timeZone: 'Europe/London' };
  assert.equal(nextOccurrence(doubled, Date.parse('2026-10-24T12:00:00Z')), '2026-10-25T00:30:00.000Z');
  assert.equal(occurrencesBetween(doubled, Date.parse('2026-10-25T00:30:00Z'), Date.parse('2026-10-25T03:00:00Z')).count, 0, 'not again an hour later');
  // India has no clock changes: every Monday 09:00 is 03:30 UTC.
  assert.equal(nextOccurrence({ kind: 'calendar', weekdays: [1], time: '09:00', timeZone: 'Asia/Kolkata' }, Date.parse(NOW)), '2026-10-26T03:30:00.000Z');
});

test("a once routine whose time has passed can still be switched off or edited; only a new or changed time must be ahead", async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, { ...hourly('One time'), schedule: { kind: 'once', at: at(30 * MIN) } });
  env.setNow(at(2 * 60 * MIN));
  const off = await setRaw(env, { ...hourly('One time'), id: routine.id, on: false, schedule: { kind: 'once', at: at(30 * MIN) } });
  assert.equal(off.routine.on, false);
  const renamed = await setRaw(env, { ...hourly('One time, renamed'), id: routine.id, on: false, schedule: { kind: 'once', at: at(30 * MIN) } });
  assert.equal(renamed.routine.name, 'One time, renamed');
  await assert.rejects(setRaw(env, { ...hourly('One time'), id: routine.id, on: true, schedule: { kind: 'once', at: at(60 * MIN) } }), code('INVALID_VENTURE_REQUEST'), 'a changed time in the past');
});

test('away lists only the routines the owner set as running', async () => {
  const env = await chiefBusiness();
  await set(env, hourly('Mine'));
  await ventureAction(env.deps, owner, 'approve', 'test.routine', tx => saveRoutine(tx, hourly('Theirs', 'story-editor'), 'agent'));
  await env.call('venture.away.set', { from: '2026-10-21', to: '2026-10-25' });
  const away = await env.call('venture.away.get');
  assert.ok(away.keepsRunning.includes('Routine: Mine'));
  assert.ok(!away.keepsRunning.includes('Routine: Theirs'), JSON.stringify(away.keepsRunning));
});

test('4J22a: the list carries each routine\'s prompt, so the owner can turn it off, on or change it with the same words', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, hourly('Inbox look'));
  assert.equal(routine.prompt, PROMPT);
  const listed = await env.agents('venture.routines.list') as RoutinesView;
  assert.equal(listed.routines[0]!.prompt, PROMPT);
  // Off and back on, sent back as the list gave it: same id, same words, only on changed.
  const { id, name, agent, prompt, schedule } = listed.routines[0]!;
  const off = await set(env, { id, name, agent, prompt, schedule, on: false });
  assert.deepEqual([off.routine.id, off.routine.on, off.routine.prompt, off.routine.line], [id, false, PROMPT, 'Off. Nothing runs.']);
  const changed = await set(env, { id, name: 'Inbox look, mornings', agent, prompt: `${PROMPT} Keep it short.`, schedule, on: true });
  assert.deepEqual([changed.routine.name, changed.routine.prompt, changed.routine.on], ['Inbox look, mornings', `${PROMPT} Keep it short.`, true]);
  assert.equal(listRecords(env.store.read(), 'venture-routine').filter(record => record.removedAt === null).length, 1);
});

test('4J22a: only a role that may change routines reads their prompts; a viewer sees the schedule without the words', async () => {
  const env = await chiefBusiness();
  await set(env, hourly('Inbox look'));
  await env.store.update((state: any) => { state.members.push({ id: 'viewer', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
  const seen = await env.agents('venture.routines.list', {}, viewer) as RoutinesView;
  assert.equal(seen.routines.length, 1);
  assert.equal('prompt' in seen.routines[0]!, false);
  assert.equal((await env.agents('venture.routines.list') as RoutinesView).routines[0]!.prompt, PROMPT);
});

test('4J22a: Forget erases a routine prompt (and name) that names the person, and switches the routine off', async () => {
  const env = await chiefBusiness();
  const { routine } = await set(env, { ...hourly('Ask about Kabir Rao'), prompt: 'Tell me whether Kabir Rao has replied to the proposal this week.' });
  const { eraseRoutinesNaming } = await import('../runtime/venture/agents/routines.ts');
  const { ERASED_NAMED } = await import('../runtime/venture/agents/notes.ts');
  await ventureAction(env.deps, owner, 'approve', 'test.forget', tx => eraseRoutinesNaming(tx, (text: unknown) => typeof text === 'string' && /Kabir Rao/.test(text)));
  const stored = listRecords(env.store.read(), 'venture-routine').find(item => item.id === routine.id)!;
  assert.deepEqual([stored.prompt, stored.on], [ERASED_NAMED, false]);
  assert.doesNotMatch(stored.name, /Kabir/);
});
