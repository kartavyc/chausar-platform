// The chief's standing plan through the engine (chief/plan.ts, plan-view.ts, review.ts, own-use.ts): one plan per
// business with exactly one next best step; code alone moves it when the records do (no model call); the daily review
// is switched on by one owner approval and then runs with none, reading and proposing only; Chausar's own daily AI
// allowance holds it back in one line; and the chief's chat answers from the same plan Today shows.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { ChausarError } from '../runtime/contracts.ts';
import type { ChiefPlanView, ModelTask, QueueRow, RoutinesView } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers as coreHandlers } from '../runtime/venture/core/index.ts';
import { handlers as chiefHandlers } from '../runtime/venture/chief/index.ts';
import { handlers as moneyHandlers } from '../runtime/venture/money/index.ts';
import { DAILY_REVIEW_PROMPT, REVIEW_LINE, dailyReviewOf } from '../runtime/venture/agents/routines.ts';
import { routineDue, routineTick } from '../runtime/venture/agents/routine-runner.ts';
import { OWN_USE_DEFAULT, REVIEW_OFFER_TITLE, REVIEW_WORDS, reviewWhen } from '../runtime/venture/chief/plan-view.ts';
import { setComputerZone } from '../runtime/owner-format.ts';
import { planBookOf } from '../runtime/venture/models/plan-book.ts';
import { REVIEW_TOOLS, reviewSettled, runReview, reviewTask, validateReview } from '../runtime/venture/chief/review.ts';
import { assertSchemaSafe } from '../runtime/venture/models/schema.ts';
import { answer, chatConsent, chiefBusiness, proposal, scriptChief, text, tools, type ChiefEnv } from './venture-chief-helpers.ts';
import { owner } from './venture-judge-helpers.ts';
import { call as viewCall, seedBlueprint, setup, type Env } from './venture-views-env.ts';

// The review says where its time is only when that is not where this computer is: the tests' computer is in India.
setComputerZone('Asia/Kolkata');
const phone: Context = { ...owner, channel: 'phone' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };
const WAY = {
  customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
  reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
  teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the samples, set the prices, send each message and take the calls.',
  firstWeek: ['Photograph three sample sets.', 'Approve the first list of cafes.', 'Send the first five messages.'],
};

/** The views business (no AI connected) with the core, money and chief handlers beside the views ones. */
function plain(env: Env) {
  const table = { ...coreHandlers, ...moneyHandlers, ...chiefHandlers } as Record<string, (deps: Env['deps'], ctx: Context, payload: unknown) => Promise<any>>;
  const ask = (method: string, payload: unknown = {}, ctx: Context = owner): Promise<any> => table[method]!(env.deps, ctx, payload);
  const plan = () => ask('venture.chief.plan.get') as Promise<ChiefPlanView>;
  return { ask, plan };
}
const moves = (view: ChiefPlanView) => view.moves.map(move => [move.text, move.state]);
/** The test business was set up through the engine, so its plan already holds the setup the records finished. */
const SETUP_DONE = [['Accept your plan', 'done'], ['Set your prices', 'done'], ['Add your first client', 'done']];
/** The moves after that setup: the week the test is about. */
const week = (view: ChiefPlanView) => { assert.deepEqual(moves(view).slice(0, 3), SETUP_DONE); return view.moves.slice(3); };
const weekStates = (view: ChiefPlanView) => week(view).map(move => [move.text, move.state]);

/** The YouTube business with both tiers an AI, the chat consent given, and the review's calls going to the chat tier's AI. */
async function reviewBusiness(options: { consent?: boolean } = {}) {
  const env = await chiefBusiness();
  const preview = env.models.preview;
  env.models.preview = async (ctx, task) => {
    const made = await preview(ctx, task);
    if (!made || task.purpose !== 'chief-review') return made;
    const tier = env.models.status().tiers.main;
    return { ...made, presetId: tier.presetId, model: tier.model };
  };
  if (options.consent !== false) await chatConsent(env);
  const plan = () => env.chief('venture.chief.plan.get') as Promise<ChiefPlanView>;
  const rows = async () => (await env.call('venture.queue.list')).rows as QueueRow[];
  const decide = async (row: QueueRow, action: string) => env.call('venture.queue.decide', { id: row.id, digest: row.digest, action });
  const tick = () => routineTick(env.deps, owner);
  return { ...env, plan, rows, decide, tick };
}
type ReviewEnv = Awaited<ReturnType<typeof reviewBusiness>>;
const said = (over: Record<string, unknown> = {}) => ({ line: 'Today is about your open orders.', done: [], moves: [], proposals: [], ...over });
/** Scripts the review's calls in order; returns the tasks it sent. */
function scriptReview(env: ChiefEnv, turns: unknown[]): ModelTask<any>[] {
  const tasks: ModelTask<any>[] = [];
  const queue = [...turns];
  env.models.respond['chief-review'] = task => {
    tasks.push(task);
    assert.ok(queue.length, 'the review asked the AI more times than this test scripted');
    return queue.shift();
  };
  return tasks;
}
/** Switches the review on as the offer's one press does, and waits for the first review it starts. */
async function turnOn(env: ReviewEnv): Promise<void> {
  await env.chief('venture.chief.review.set', { on: true });
  await reviewSettled(env.deps);
}

test('with no AI connected the plan works from code alone: finish what is sold, then the week, each record moving it at once', async () => {
  const env = await setup();
  const { ask, plan } = plain(env);
  // No plan yet: the step is to accept it, and the week starts with the setup.
  let view = await plan();
  assert.deepEqual([view.next.kind, view.next.title, view.next.by], ['offer', 'Read your plan and accept it.', 'records']);
  assert.deepEqual(view.next.action, { id: 'go', label: 'Open your plan', link: '#/business/plan' });
  assert.deepEqual(moves(view).slice(0, 2), [['Accept your plan', 'waiting'], ['Set your prices', 'planned']]);
  assert.deepEqual(view.line, { text: 'First, get what you sell ready.', estimate: false, by: 'records' });
  // The plan is drafted: its card on Today is the step, pressed there.
  assert.equal(listRecords(env.store.read(), 'venture-chief-plan').length, 0, 'reading the plan stores nothing');
  const draft = await seedBlueprint(env, { status: 'draft' });
  view = await plan();
  const card = (await viewCall<{ rows: QueueRow[] }>(env, 'venture.queue.list')).rows.find(row => row.kind === 'plan')!;
  assert.deepEqual(view.next.action, { id: 'row', label: 'Accept', rowId: card.id });
  // Accepted, one offer still without a price: the step names it, and nothing else outranks it.
  await ask('venture.blueprint.accept', { digest: draft.digest });
  view = await plan();
  assert.deepEqual([view.next.kind, view.next.title], ['offer', 'Set your price for Catch up clean up.']);
  assert.deepEqual(view.next.action, { id: 'go', label: 'Set prices', link: '#/business/prices' });
  assert.equal(view.next.line, 'Chausar looks for customers only once this is done.');
  assert.deepEqual(moves(view).slice(0, 2), [['Accept your plan', 'done'], ['Set your prices', 'waiting']]);
  // Priced and accepted again: ready.
  const priced = await ask('venture.blueprint.update', { patch: { offers: [{ id: 'offer_2', unitPrice: '5000' }] } });
  await ask('venture.blueprint.accept', { digest: priced.blueprint.digest });
  view = await plan();
  // Ready: the step is the week's first open move. The card to connect an AI is housekeeping: it waits beside the step.
  assert.deepEqual([view.next.kind, view.next.title], ['move', 'Add your first client']);
  assert.deepEqual(view.next.action, { id: 'go', label: 'Add a client', link: '#/clients' });
  assert.match(view.next.also?.line ?? '', /^Also waiting: .*Connect your AI/);
  assert.deepEqual(moves(view), [['Accept your plan', 'done'], ['Set your prices', 'done'], ['Add your first client', 'waiting'], ['Send your first invoice', 'planned'], ['Record your first payment', 'planned']]);
  assert.equal(view.line.text, '2 of 5 moves done this week.');
  // A client added moves the plan too.
  await ask('venture.client.add', { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });
  assert.deepEqual(moves(await plan()).slice(2), [['Add your first client', 'done'], ['Send your first invoice', 'waiting'], ['Record your first payment', 'planned']]);
  // Each of those writes kept the plan in its own commit, as one record; reading it stored nothing, and the stub port
  // would have thrown on any send, so no model was ever asked.
  const stored = listRecords(env.store.read(), 'venture-chief-plan');
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0]!.moves.map(move => [move.id, move.state, move.by]).slice(0, 3), [['mv_accept_plan', 'done', 'records'], ['mv_set_prices', 'done', 'records'], ['mv_first_client', 'done', 'records']]);
});

test('the way to earn the owner kept is the week: the owner ticks a move, and the next one is theirs at once', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: WAY });
  let view = await env.plan();
  // The way's first week replaced the first invoice and payment that stood in for it; what the records finished stays.
  assert.deepEqual(weekStates(view), [[WAY.firstWeek[0], 'waiting'], [WAY.firstWeek[1], 'planned'], [WAY.firstWeek[2], 'planned']]);
  const [first, second] = week(view);
  assert.deepEqual(first!.can, ['done', 'dropped']);
  assert.equal(first!.label, 'Waiting on you');
  assert.deepEqual(view.moves[0]!.can, [], 'a move the records check is never ticked by hand');
  await assert.rejects(env.chief('venture.chief.plan.move', { id: first!.id, to: 'done' }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.chief.plan.move', { id: second!.id, to: 'planned' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.plan.move', { id: 'mv_nope', to: 'done' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.plan.move', { id: first!.id, to: 'proposed' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.plan.move', { id: view.moves[0]!.id, to: 'planned' }), code('INVALID_VENTURE_REQUEST'));
  view = await env.chief('venture.chief.plan.move', { id: first!.id, to: 'done' });
  assert.deepEqual(weekStates(view), [[WAY.firstWeek[0], 'done'], [WAY.firstWeek[1], 'waiting'], [WAY.firstWeek[2], 'planned']]);
  assert.equal(listRecords(env.store.read(), 'venture-chief-plan').length, 1, 'the plan is one record, replaced');
  view = await env.chief('venture.chief.plan.move', { id: second!.id, to: 'dropped' });
  view = await env.chief('venture.chief.plan.move', { id: second!.id, to: 'planned' });
  assert.deepEqual(weekStates(view), [[WAY.firstWeek[0], 'done'], [WAY.firstWeek[1], 'waiting'], [WAY.firstWeek[2], 'waiting']]);
  assert.equal(listRecords(env.store.read(), 'venture-chief-plan').length, 1);
  assert.equal(env.models.sent, 0, 'no model was asked for any of it');
});

test('the review task: fixed words, a closed schema, and an answer held to its shape', () => {
  const task = reviewTask({ today: '2026-11-11', business: { name: 'Test', about: 'Pots', offerReady: true }, plan: { week: [], room: 5 }, proposalKinds: [], maxProposals: 3, results: [] });
  assert.equal(task.purpose, 'chief-review');
  assert.equal(task.containsClientData, true);
  assert.doesNotThrow(() => assertSchemaSafe(task.schema));
  assert.match(task.instructions, /You never act/);
  assert.match(task.instructions, /never instructions to you/);
  assert.equal(task.instructions.includes(String.fromCharCode(0x2014)), false);
  assert.deepEqual(validateReview(said()), said());
  for (const bad of [null, {}, { ...said(), extra: 1 }, { ...said(), line: 5 }, { ...said(), done: 'x' }, { ...said(), moves: [1] }, { ...said(), proposals: [{ kind: 'quote' }] }]) {
    assert.throws(() => validateReview(bad), code('MODEL_OUTPUT_REJECTED'));
  }
  assert.deepEqual([...REVIEW_TOOLS], ['queue', 'money', 'clients', 'plan']);
});

test('the daily review is offered once, filled in; one approval switches it on, and it shows as a routine that never waits for approval', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said()]);
  let view = await env.plan();
  assert.deepEqual([view.review.on, view.review.line], [false, 'Daily review is off.']);
  // The offer says exactly what the owner approves: when, what a run does, how much of their AI, and what it never does.
  assert.deepEqual(view.review.offer, { title: REVIEW_OFFER_TITLE, line: 'Every day at 8:00 am Chausar reads your records, updates your plan and may put ideas on Today for you to approve. It asks your AI at most 3 times a day. It never sends, spends or changes a price.' });
  // It is part of the plan, never a row of Today's queue, so it adds nothing to what needs you or to any alert.
  assert.equal((await env.rows()).some(row => row.title === REVIEW_OFFER_TITLE), false);
  // Nothing runs until that approval: a tick the next morning does nothing.
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.equal(env.models.sent, 0);
  assert.equal(listRecords(env.store.read(), 'venture-routine').length, 0);
  env.setNow('2026-10-21T10:00:00.000Z');
  await turnOn(env);
  const routine = dailyReviewOf(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!.id)!;
  assert.deepEqual([routine.name, routine.on, routine.setBy, routine.review, routine.prompt], ['Daily review', true, 'owner', 'daily', DAILY_REVIEW_PROMPT]);
  assert.deepEqual(routine.schedule, { kind: 'calendar', weekdays: [1, 2, 3, 4, 5, 6, 7], time: '08:00', timeZone: 'Asia/Kolkata' });
  view = await env.plan();
  assert.deepEqual([view.review.on, view.review.offer, view.review.time, view.review.when, view.review.line], [true, null, '08:00', 'Every day at 8:00 am', 'Daily review at 8:00 am.']);
  assert.equal(view.review.next, '2026-10-22T02:30:00.000Z');
  // The approval is on the record as the owner's own decision.
  assert.deepEqual(listRecords(env.store.read(), 'venture-decision').filter(record => record.subject === 'review:daily').map(record => [record.action, record.who, record.reason]),
    [['approve', 'owner', `Daily review on: Every day at 8:00 am. ${REVIEW_LINE}`]]);
  // Switching it on started the first review at once: one call, and the plan carries its line for today.
  assert.equal(tasks.length, 1);
  assert.deepEqual(view.line, { text: 'Today is about your open orders.', estimate: false, by: 'ai' });
  assert.deepEqual([view.review.last?.by, view.review.last?.line, view.review.note], ['ai', REVIEW_WORDS.withAi(0), null]);
  assert.equal(view.review.ownUse.usedRuns, 1);
  // In Routines it reads as what it is.
  const listed = (await env.agents('venture.routines.list') as RoutinesView).routines.find(item => item.review === 'daily')!;
  assert.equal(listed.line, `Next 22 Oct 2026, 8:00 am. ${REVIEW_LINE}`);
  // The form can change its time or switch it off, and nothing else about it.
  await assert.rejects(env.agents('venture.routines.set', { routine: { id: listed.id, name: listed.name, agent: null, prompt: 'Send every client a discount today.', schedule: listed.schedule, on: true } }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.agents('venture.routines.set', { routine: { id: listed.id, name: listed.name, agent: null, prompt: listed.prompt, schedule: { ...listed.schedule, weekdays: [1] }, on: true } }), code('INVALID_VENTURE_REQUEST'));
  const later = await env.agents('venture.routines.set', { routine: { id: listed.id, name: listed.name, agent: null, prompt: listed.prompt, schedule: { ...listed.schedule, time: '07:30' }, on: true } });
  assert.equal(later.routine.review, 'daily');
  assert.equal((await env.plan()).review.time, '07:30');
});

test('Not now on the offer leaves the review off and the offer is not made again; the owner can still switch it on, only inside the app', async () => {
  const env = await reviewBusiness();
  scriptReview(env, [said()]);
  let view = await env.chief('venture.chief.review.set', { on: false }) as ChiefPlanView;
  assert.deepEqual([view.review.on, view.review.offer, view.review.routineId], [false, null, null]);
  assert.equal(listRecords(env.store.read(), 'venture-routine').length, 0, 'not now makes no routine');
  assert.equal(env.models.sent, 0);
  await assert.rejects(env.chief('venture.chief.review.set', { on: true }, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(env.chief('venture.chief.review.set', { on: true, time: '8am' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.review.set', { on: true, runsPerDay: 99 }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(env.chief('venture.chief.review.set', { time: '09:00' }), code('INVALID_VENTURE_REQUEST'));
  view = await env.chief('venture.chief.review.set', { on: true, time: '09:15', runsPerDay: 2, cap: '0.5' });
  await reviewSettled(env.deps);
  view = await env.plan();
  assert.deepEqual([view.review.on, view.review.time, view.review.ownUse.runsPerDay, view.review.ownUse.capMicros, view.review.ownUse.cap], [true, '09:15', 2, '500000', '$0.50']);
  assert.equal(listRecords(env.store.read(), 'venture-decision').filter(record => record.subject === 'review:daily').at(-1)!.reason, `Daily review on: Every day at 9:15 am. ${REVIEW_LINE}`);
  view = await env.chief('venture.chief.review.set', { on: false });
  assert.deepEqual([view.review.on, view.review.next, view.review.line], [false, null, 'Daily review is off.']);
});

test('a day\'s run needs no approval: the tick runs it, it reads through the read tools, and what it wants done becomes cards the owner decides', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: WAY });
  const firstMove = week(await env.plan())[0]!;
  const tasks = scriptReview(env, [said(), said({
    line: 'Three cafes are worth a quote today.', done: [firstMove.id, 'mv_unknown'],
    moves: ['Call the two cafes that asked for samples.', 'Charge ₹500 a mug from now on.', 'See https://example.com for leads.'],
    proposals: [proposal('quote', { offerId: 'offer_1' }), proposal('start-run', { orderId: 'order_missing' }), proposal('brief-agent', { agent: 'story-editor', text: 'Tidy the notes.' })],
  })]);
  await turnOn(env);
  const sentAfterFirst = env.models.sent;
  // The next morning, five minutes after its time: the tick runs it. Nothing waits on Today for a go-ahead.
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.equal(env.models.sent, sentAfterFirst + 1, 'one call for the day');
  assert.equal((await env.rows()).some(row => row.id.startsWith('routine:')), false, 'no run of it ever waits for approval');
  const routine = dailyReviewOf(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!.id)!;
  const run = listRecords(env.store.read(), 'venture-routine-run').filter(item => item.routineId === routine.id).at(-1)!;
  assert.deepEqual([run.state, run.line, run.dueAt], ['completed', REVIEW_WORDS.withAi(1), '2026-10-22T02:30:00.000Z']);
  // What the AI was given: the four read tools' results, the week, the kinds it may propose (never a brief), under the chat consent.
  const input = tasks[1]!.input as any;
  assert.deepEqual(input.results.map((result: any) => result.tool), ['queue', 'money', 'clients', 'plan']);
  assert.deepEqual(input.plan.week.map((move: any) => [move.move, move.state]), [...SETUP_DONE, [WAY.firstWeek[0], 'waiting'], [WAY.firstWeek[1], 'planned'], [WAY.firstWeek[2], 'planned']]);
  assert.equal(input.plan.week[3].id, firstMove.id);
  assert.equal(input.plan.room, 2);
  assert.equal(input.maxProposals, 3);
  assert.equal(input.business.offerReady, true);
  assert.deepEqual(input.business.way, WAY);
  assert.equal(input.proposalKinds.some((item: any) => item.kind === 'brief-agent'), false);
  assert.ok(input.proposalKinds.some((item: any) => item.kind === 'quote'));
  assert.equal(env.models.consents.at(-1), 'approved-preview');
  // The plan after it: the done move is done, the plain new move is in, the priced and linked ones were left out, and
  // the one proposal that passed the gate is a card on Today and a move in state proposed. The brief was never posted.
  let view = await env.plan();
  const quote = week(view)[4]!;
  assert.deepEqual(weekStates(view), [
    [WAY.firstWeek[0], 'done'], [WAY.firstWeek[1], 'waiting'], [WAY.firstWeek[2], 'planned'], ['Call the two cafes that asked for samples.', 'planned'],
    [quote.text, 'proposed'],
  ]);
  assert.match(quote.text, /^Work out a quote for /);
  // The AI's line states a number, so it shows as a model estimate.
  assert.deepEqual(view.line, { text: 'Three cafes are worth a quote today.', estimate: true, by: 'ai' });
  const cards = (await env.rows()).filter(row => row.kind === 'proposal');
  assert.equal(cards.length, 1);
  assert.equal(quote.rowId, cards[0]!.id);
  assert.deepEqual([view.next.kind, view.next.action], ['row', { id: 'row', label: 'Approve', rowId: cards[0]!.id }]);
  assert.equal(listRecords(env.store.read(), 'venture-agent-message').some(message => /Tidy the notes/.test(message.text)), false);
  assert.equal(listRecords(env.store.read(), 'venture-event').filter(event => event.name === 'proposal.created').length, 1, 'the card is announced once');
  // Nothing left the business and nothing was spent beyond the AI calls: no outside action, no payment, no price change.
  assert.equal(listRecords(env.store.read(), 'venture-journal-entry').length, 0);
  // The owner approves the card: the move is done at once, by code, with no model call.
  const before = env.models.sent;
  assert.equal((await env.decide(cards[0]!, 'approve')).outcome, 'done');
  view = await env.plan();
  assert.equal(week(view)[4]!.state, 'done');
  assert.equal(env.models.sent, before);
});

test('a card the owner sets aside drops its move, and the review does not raise the same thing again that week', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said({ proposals: [proposal('quote', { offerId: 'offer_1' })] }), said({ proposals: [proposal('quote', { offerId: 'offer_1' })] })]);
  await turnOn(env);
  const card = (await env.rows()).find(row => row.kind === 'proposal')!;
  assert.equal((await env.decide(card, 'deny')).outcome, 'done');
  let view = await env.plan();
  assert.equal(view.moves.find(move => /^Work out a quote/.test(move.text))!.state, 'dropped');
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.equal(tasks.length, 2);
  assert.equal((await env.rows()).some(row => row.kind === 'proposal'), false, 'the same proposal is not raised again');
  view = await env.plan();
  assert.equal(view.review.last?.line, REVIEW_WORDS.withAi(0));
});

test('Chausar\'s own daily allowance: used up, the review says so in one line, plans from the records and asks again the next day', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said(), said({ line: 'A new day.' })]);
  assert.deepEqual(OWN_USE_DEFAULT, { runsPerDay: 3, capMicros: '250000' });
  await env.chief('venture.chief.review.set', { on: true, runsPerDay: 1 });
  await reviewSettled(env.deps);
  assert.equal(tasks.length, 1);
  // A second review the same day (the owner's day, in India): the allowance is used.
  const held = await runReview(env.deps, owner);
  assert.deepEqual(held, { line: 'Chausar asked your AI 1 time today, the most you allow it on its own. Chausar planned from your records and looks again tomorrow.', by: 'records', raised: 0 });
  assert.equal(tasks.length, 1, 'nothing more was asked');
  let view = await env.plan();
  assert.equal(view.review.note, held.line);
  assert.deepEqual([view.review.ownUse.usedRuns, view.review.ownUse.runsPerDay, view.review.ownUse.keyed], [1, 1, true]);
  assert.equal(view.review.ownUse.line, 'Chausar may ask your AI on its own up to 1 time a day, at most $0.25 a day. 1 used today.');
  assert.equal(view.line.by, 'records', 'the line for the day is code\'s again');
  // The next morning it asks again.
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.equal(tasks.length, 2);
  view = await env.plan();
  assert.deepEqual([view.line.text, view.review.note, view.review.ownUse.usedRuns], ['A new day.', null, 1]);
  // Zero means never on its own.
  await env.chief('venture.chief.review.set', { on: true, runsPerDay: 0 });
  assert.equal((await runReview(env.deps, owner)).line, 'You set Chausar to never ask your AI on its own. Chausar planned from your records and looks again tomorrow.');
});

test('on a key the day\'s limit holds a call before it is sent, and what a sent call cost counts against the day', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said()]);
  // The call would cost more than the day's limit: it is never sent.
  env.models.estimateFor = task => (task.purpose === 'chief-review' ? '900000' : '1000');
  await env.chief('venture.chief.review.set', { on: true, cap: '0.25' });
  await reviewSettled(env.deps);
  assert.equal(tasks.length, 0);
  let view = await env.plan();
  assert.equal(view.review.note, 'One more call would pass Chausar\'s own limit of $0.25 for today. Chausar planned from your records and looks again tomorrow.');
  // A cheaper call goes, and what it cost counts against the day.
  env.models.estimateFor = null;
  assert.equal((await runReview(env.deps, owner)).by, 'ai');
  assert.equal(listRecords(env.store.read(), 'venture-chief-plan').at(-1)!.ownUse.micros, '200');
  // The AI itself failing leaves the review to the records, in plain words.
  env.models.failNextSend = new ChausarError('MODEL_FAILED', 'The provider is down.');
  env.models.respond['chief-review'] = () => said();
  const failed = await runReview(env.deps, owner);
  assert.deepEqual([failed.by, failed.line], ['records', REVIEW_WORDS.failed]);
  view = await env.plan();
  assert.equal(view.review.ownUse.usedRuns, 3, 'a call that went out counts, answered or not');
});

test('the AI is never asked while what is sold is not ready, without the chat consent, with no AI, or while paused', async () => {
  // No consent: one line says how to let the AI help.
  const unasked = await reviewBusiness({ consent: false });
  scriptReview(unasked, []);
  await unasked.chief('venture.chief.review.set', { on: true });
  await reviewSettled(unasked.deps);
  assert.equal((await unasked.plan()).review.note, REVIEW_WORDS.consent);
  assert.equal(unasked.models.sent, 0);
  // No AI on the chat tier: the records alone, and no note.
  const bare = await reviewBusiness();
  scriptReview(bare, []);
  bare.models.main = 'template';
  const outcome = await runReview(bare.deps, owner);
  assert.deepEqual(outcome, { line: REVIEW_WORDS.fromRecords, by: 'records', raised: 0 });
  assert.equal((await bare.plan()).review.note, null);
  // Not ready: the views business with an accepted plan and an offer without a price, an AI connected.
  const env = await setup();
  await seedBlueprint(env);
  env.models.connected = true;
  const { ask, plan } = plain(env);
  await ask('venture.chief.review.set', { on: true });
  await reviewSettled(env.deps);
  const view = await plan();
  assert.deepEqual([view.next.kind, view.review.last?.line, view.review.note], ['offer', REVIEW_WORDS.fromRecords, null]);
  assert.equal(listRecords(env.store.read(), 'venture-proposal').length, 0, 'nothing is proposed before what is sold is ready');
});

test('opened later the same day the review still runs; a day Chausar was closed is missed, never run late', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said(), said(), said()]);
  await turnOn(env);
  const routine = dailyReviewOf(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!.id)!;
  const runs = () => listRecords(env.store.read(), 'venture-routine-run').filter(item => item.routineId === routine.id).map(item => [item.state, item.dueAt]);
  // 22 October, 6:10 pm in India: ten hours late, the same day.
  env.setNow('2026-10-22T12:40:00.000Z');
  await env.tick();
  assert.deepEqual(runs(), [['completed', '2026-10-22T02:30:00.000Z']]);
  // Closed all of the 23rd; opened at 9:00 am on the 24th: the 23rd is missed, the 24th runs.
  env.setNow('2026-10-24T03:30:00.000Z');
  await env.tick();
  assert.deepEqual(runs(), [['completed', '2026-10-22T02:30:00.000Z'], ['missed', '2026-10-23T02:30:00.000Z'], ['completed', '2026-10-24T02:30:00.000Z']]);
  assert.equal(tasks.length, 3);
  // Opened after midnight on the 26th: the 25th is over, so it is missed and nothing runs for it.
  env.setNow('2026-10-25T19:00:00.000Z');
  await env.tick();
  assert.deepEqual(runs().at(-1), ['missed', '2026-10-25T02:30:00.000Z']);
  assert.equal(tasks.length, 3);
});

test('fix round 7: a review time moved to later today runs today, inside the daily allowance, and counts as one more use', async () => {
  const env = await reviewBusiness();
  const tasks = scriptReview(env, [said(), said(), said()]);
  // 22 October, 4:47 pm in India: switched on, the first review runs at once.
  env.setNow('2026-10-22T11:17:00.000Z');
  await turnOn(env);
  assert.equal(tasks.length, 1);
  assert.equal((await env.plan()).review.ownUse.usedRuns, 1);
  // 4:58 pm: the owner moves it to 5:01 pm. The next time is today, not tomorrow.
  env.setNow('2026-10-22T11:28:00.000Z');
  await env.chief('venture.chief.review.set', { on: true, time: '17:01' });
  const routine = dailyReviewOf(env.store.read(), listRecords(env.store.read(), 'venture-record')[0]!.id)!;
  assert.equal((await env.plan()).review.next, '2026-10-22T11:31:00.000Z');
  // The engine's tick sweeps as soon as that time has come, not at its next five-minute sweep.
  env.setNow('2026-10-22T11:30:00.000Z');
  assert.equal(routineDue(env.store.read(), Date.parse('2026-10-22T11:30:00.000Z')), false);
  // 5:03 pm: the sweep runs it, the second of the three a day the owner allows.
  env.setNow('2026-10-22T11:33:00.000Z');
  assert.equal(routineDue(env.store.read(), Date.parse('2026-10-22T11:33:00.000Z')), true);
  await env.tick();
  assert.equal(routineDue(env.store.read(), Date.parse('2026-10-22T11:33:00.000Z')), false);
  const runs = listRecords(env.store.read(), 'venture-routine-run').filter(item => item.routineId === routine.id).map(item => [item.state, item.dueAt]);
  assert.deepEqual(runs, [['completed', '2026-10-22T11:31:00.000Z']]);
  assert.equal(tasks.length, 2);
  assert.equal((await env.plan()).review.ownUse.usedRuns, 2);
  // Off and on again from Today's sheet starts one review at once, the third of three.
  await env.chief('venture.chief.review.set', { on: false });
  await turnOn(env);
  assert.equal(tasks.length, 3);
  assert.equal((await env.plan()).review.ownUse.usedRuns, 3);
});

test('the chief\'s chat is given the standing plan, so what to do next is the step Today shows', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: WAY });
  const view = await env.plan();
  const tasks = scriptChief(env, [answer([text('Turn on the daily review first.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I do next?' });
  const plan = (tasks[0]!.input as any).plan;
  assert.deepEqual(plan.next, { step: view.next.title, why: view.next.line });
  assert.deepEqual(plan.week, view.moves.map(move => ({ move: move.text, state: move.label })));
  assert.equal(plan.today, view.line.text);
  assert.equal(plan.goal, view.goal.line);
  const { CHIEF_INSTRUCTIONS } = await import('../runtime/venture/chief/answer.ts');
  assert.match(CHIEF_INSTRUCTIONS, /answer from plan\.next first/);
});

test('the day\'s line is a model estimate only for a number of the AI\'s own, never for one the plan already holds', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: WAY });
  // "five" is the owner's own week ("Send the first five messages."): said again, it is not an estimate.
  scriptReview(env, [said({ line: 'The five messages are the thing to send today.' }), said({ line: 'About twelve cafes are worth a message today.' })]);
  await turnOn(env);
  assert.deepEqual((await env.plan()).line, { text: 'The five messages are the thing to send today.', estimate: false, by: 'ai' });
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.deepEqual((await env.plan()).line, { text: 'About twelve cafes are worth a message today.', estimate: true, by: 'ai' });
});

// Found live on Windows, 15 Nov 2026: three owners asked "What should I do first this week to get my first customer?"
// and were told "Confirm tax first", while the customer search the review had just raised was never named.
test('the week leads a setup card, and the chat is given the customer search on Today by its title, with the setup cards as also waiting', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: WAY });
  env.deps.workspace = {
    current: () => ({ id: 'biz_open', name: 'Test Business' }), recovery: async () => 'not-made',
    businesses: async () => [{ id: 'biz_open', name: 'Test Business', opens: 'with-this-computer', openedAt: null }],
  };
  // Before any card: setup cards wait (to keep a recovery code here), yet the step is the week's own first move.
  let view = await env.plan();
  const setupCards = (await env.rows()).filter(row => row.kind === 'setup');
  assert.ok(setupCards.length >= 1, 'this business has a setup card waiting');
  assert.deepEqual([view.next.kind, view.next.title], ['move', WAY.firstWeek[0]]);
  assert.deepEqual(view.next.also, { line: `Also waiting: ${setupCards.map(row => row.title).join(', ')}.`, rowIds: setupCards.map(row => row.id), titles: setupCards.map(row => row.title) });
  // The review raises a search for customers: a decision on real work, so it is the step. The review itself is not
  // shown the setup cards (seen live, 15 Nov 2026: its line for the day said "tax confirmation still waiting on you").
  const reviews = scriptReview(env, [said({ proposals: [proposal('find-customers', { text: 'cafes in Pune', quantity: '20' })] })]);
  await turnOn(env);
  const queued = (reviews[0]!.input as any).results.find((item: any) => item.tool === 'queue').data.cards as { kind: string }[];
  assert.deepEqual(queued.filter(card => card.kind === 'setup'), [], 'housekeeping is not the review\'s to plan');
  view = await env.plan();
  const TITLE = 'Find possible customers: cafes in Pune';
  assert.deepEqual([view.next.kind, view.next.title], ['row', TITLE]);
  assert.equal(view.next.also?.line, `Also waiting: ${setupCards.map(row => row.title).join(', ')}.`);
  // The chat reads that card by its title (a kind of place and a city, never a client), as a move waiting for approval.
  const chat = scriptChief(env, [tools('queue'), answer([text('Approve the search on Today.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I do first this week to get my first customer?' });
  const plan = (chat[0]!.input as any).plan;
  // The kinds of place the plan's own customers are, as the map names them, so a search is proposed for one of them.
  assert.deepEqual((chat[0]!.input as any).business.mapKinds, ['cafes', 'hotels']);
  assert.equal(plan.next.step, TITLE);
  assert.deepEqual(plan.week.find((move: any) => move.state === 'On Today for your approval'), { move: TITLE, state: 'On Today for your approval' });
  assert.equal(plan.also, view.next.also?.line);
  const cards = ((chat[1]!.input as any).results[0].data.cards as { kind: string; title: string }[]);
  assert.ok(cards.some(card => card.kind === 'proposal' && card.title === TITLE), 'the queue tool names the search too');
  const { CHIEF_INSTRUCTIONS } = await import('../runtime/venture/chief/answer.ts');
  // The instruction: the owner's question first; a setup card never ahead of it; a waiting search named with its approval;
  // a labelled estimate rather than a refusal; never a figure of its own as fact, never the owner's price set for them.
  for (const words of [
    /plan\.also/, /housekeeping and block nothing/, /bring in plan\.next only when it bears on the question/,
    /waits on Today for the owner's approval/, /has no card: never say it waits on Today/, /do not refuse/, /say plainly that it is your estimate/,
    /Never state a figure of your own as a fact/, /Prices are the owner's to set/,
  ]) assert.match(CHIEF_INSTRUCTIONS, words);
  assert.doesNotMatch(CHIEF_INSTRUCTIONS, /never name a different next step|\u2014/);
});

test('a client\'s name never enters the plan through the AI, and a card\'s title never reaches the AI through the plan', async () => {
  const env = await reviewBusiness();
  const { AI_PLAN_WORDS } = await import('../runtime/venture/chief/plan.ts');
  const tasks = scriptReview(env, [
    said({ line: 'Asha Rao is waiting on her quote.', moves: ['Call Asha Rao about the samples.', 'Tidy the price list.'], proposals: [proposal('quote', { offerId: 'offer_1' })] }),
    said(),
  ]);
  await turnOn(env);
  let view = await env.plan();
  // The line and the move that named the client were not kept; the plain move was, and code wrote the day's line.
  assert.equal(view.line.by, 'records');
  assert.deepEqual(view.moves.filter(move => move.state === 'planned' || move.state === 'waiting').map(move => move.text), ['Send your first invoice', 'Record your first payment', 'Tidy the price list.']);
  assert.equal(JSON.stringify(listRecords(env.store.read(), 'venture-chief-plan')).includes('Asha'), false);
  // The card's move keeps no copy of the card's title; the owner reads the title from the proposal itself.
  const kept = listRecords(env.store.read(), 'venture-chief-plan').at(-1)!.moves.find(move => move.proposalId)!;
  assert.equal(kept.text, AI_PLAN_WORDS.move);
  assert.match(view.moves.find(move => move.id === kept.id)!.text, /^Work out a quote for /);
  // The next day's review is given the card's move as a card, not by its title.
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  const week = (tasks[1]!.input as any).plan.week as { move: string; state: string }[];
  assert.deepEqual(week.filter(move => move.state === 'proposed').map(move => move.move), [AI_PLAN_WORDS.move]);
  // And the chat is told that a card waits, without the card's words, unless it may read that card.
  const chat = scriptChief(env, [answer([text('Decide the card first.')])]);
  await env.chief('venture.chief.thread.send', { text: 'What should I do next?' });
  const plan = (chat[0]!.input as any).plan;
  assert.equal(plan.next.step, AI_PLAN_WORDS.card);
  assert.ok(plan.week.some((move: any) => move.move === AI_PLAN_WORDS.move));
  view = await env.plan();
  assert.match(view.next.title, /^Work out a quote for /, 'the owner still reads the card by its title');
});

test('on the owner\'s Codex plan nothing is priced: only the count holds, and a plan the tool says is used up waits', async () => {
  const env = await reviewBusiness({ consent: false });
  // The chat tier is the owner's own Codex on this computer.
  const status = env.models.status.bind(env.models);
  env.models.status = () => { const now = status(); return { ...now, tiers: { ...now.tiers, main: { ...now.tiers.main, presetId: 'codex-cli', model: 'codex' } } }; };
  await chatConsent(env);
  const tasks = scriptReview(env, [said(), said()]);
  await turnOn(env);
  assert.equal(tasks.length, 1);
  let view = await env.plan();
  assert.deepEqual([view.review.ownUse.keyed, view.review.ownUse.usedRuns], [false, 1]);
  assert.equal(view.review.ownUse.line, 'Chausar may ask your AI on its own up to 3 times a day. 1 used today.');
  assert.equal(listRecords(env.store.read(), 'venture-chief-plan').at(-1)!.ownUse.micros, '0', 'a plan run is counted, never priced');
  // Codex said the plan is used up: the review waits for it, in one line, and asks nothing.
  planBookOf(env.deps.store).failed('codex', 'usage-limit', env.deps.clock().toISOString());
  const held = await runReview(env.deps, owner);
  assert.deepEqual([held.by, held.line], ['records', 'Your Codex plan is used up. Chausar planned from your records and looks again tomorrow.']);
  assert.equal(tasks.length, 1);
  view = await env.plan();
  assert.equal(view.review.note, held.line);
  assert.equal(view.review.ownUse.usedRuns, 1, 'a review that asked nothing uses none of the day\'s allowance');
});

// ---------------------------------------------------------------------------------------------------------------
// The chat consent and the daily review (the Mac run of 14 Nov 2026): the offer carries the consent in place, the
// "agree" line shows only while it is true, and a review held for the consent runs once the consent is given.
// ---------------------------------------------------------------------------------------------------------------

const chatConsentOf = async (env: ReviewEnv) => (await env.agents('venture.agents.thread.list', { agent: 'story-editor' })).consent;
const consents = (env: ReviewEnv) => listRecords(env.store.read(), 'venture-chat-consent');

test('the offer carries the chat consent while it is missing: the same words and digest Chats shows', async () => {
  const env = await reviewBusiness({ consent: false });
  scriptReview(env, [said()]);
  const needed = await chatConsentOf(env);
  assert.equal(needed.state, 'needed');
  let view = await env.plan();
  assert.ok(view.review.offer);
  assert.deepEqual(view.review.consent, needed, 'the consent Chats would show, whole');
  assert.equal(view.review.note, null, 'the review is off, so nothing says it plans from records only');
  // One button agrees and turns it on: the consent Chats records, then the switch. The first review asks the AI.
  await env.agents('venture.chats.consent', { digest: view.review.consent!.digest });
  await turnOn(env);
  view = await env.plan();
  assert.deepEqual([view.review.on, view.review.consent, view.review.note, view.review.last?.by], [true, null, null, 'ai']);
  assert.equal(env.models.sent, 1);
  assert.equal(consents(env).length, 1, 'one recorded consent');
  assert.equal((await chatConsentOf(env)).state, 'given', 'so Chats does not ask again');
});

test('turned on without the consent the review plans from records and says so in one line, only while that is true', async () => {
  const env = await reviewBusiness({ consent: false });
  const tasks = scriptReview(env, [said()]);
  await turnOn(env);
  let view = await env.plan();
  assert.equal(env.models.sent, 0, 'the consent gate holds');
  assert.deepEqual([view.review.on, view.review.note, view.review.last?.line, view.review.last?.by], [true, REVIEW_WORDS.consent, REVIEW_WORDS.fromRecords, 'records']);
  assert.equal(view.review.consent?.state, 'needed');
  assert.ok(!/[\u2014\u2013]/.test(REVIEW_WORDS.consent));
  // Switched off: the line and the consent go, at once.
  view = await env.chief('venture.chief.review.set', { on: false });
  assert.deepEqual([view.review.on, view.review.note, view.review.consent], [false, null, null]);
  // On again, still without the consent: the line is back, and still nothing was sent.
  await turnOn(env);
  view = await env.plan();
  assert.deepEqual([view.review.note, view.review.consent?.state], [REVIEW_WORDS.consent, 'needed']);
  assert.equal(env.models.sent, 0);
  // The consent is given later, from Chats or anywhere: today's review was held for it, so one review runs now.
  await env.agents('venture.chats.consent', { digest: view.review.consent!.digest });
  await reviewSettled(env.deps);
  assert.equal(tasks.length, 1, 'one review ran when the consent was given, not at 8:00 the next day');
  view = await env.plan();
  assert.deepEqual([view.review.note, view.review.consent, view.review.last?.by, view.review.last?.line], [null, null, 'ai', REVIEW_WORDS.withAi(0)]);
  assert.deepEqual(view.line, { text: 'Today is about your open orders.', estimate: false, by: 'ai' });
  assert.equal(view.review.ownUse.usedRuns, 1);
  // Agreeing again changes nothing and runs nothing more.
  await env.agents('venture.chats.consent', { digest: (await chatConsentOf(env)).digest });
  await reviewSettled(env.deps);
  assert.equal(tasks.length, 1);
  assert.equal(consents(env).length, 1);
});

test('a consent given while no review waits for it runs nothing, and the held review stays inside the daily allowance', async () => {
  // The review is off: the consent is only the consent.
  const off = await reviewBusiness({ consent: false });
  scriptReview(off, []);
  await off.agents('venture.chats.consent', { digest: (await chatConsentOf(off)).digest });
  await reviewSettled(off.deps);
  assert.equal(off.models.sent, 0);
  assert.equal((await off.plan()).review.last, null);
  // The owner allows Chausar no AI use of its own: the held review runs again, from the records, and says why.
  const none = await reviewBusiness({ consent: false });
  scriptReview(none, []);
  await none.chief('venture.chief.review.set', { on: true, runsPerDay: 0 });
  await reviewSettled(none.deps);
  assert.equal((await none.plan()).review.note, REVIEW_WORDS.consent);
  await none.agents('venture.chats.consent', { digest: (await chatConsentOf(none)).digest });
  await reviewSettled(none.deps);
  assert.equal(none.models.sent, 0);
  assert.equal((await none.plan()).review.note, 'You set Chausar to never ask your AI on its own. Chausar planned from your records and looks again tomorrow.');
});

test('with no AI connected the offer says the plan works from your records, and Turn on still works', async () => {
  const env = await setup();
  await seedBlueprint(env, { price2: '1500000' });
  const { ask, plan } = plain(env);
  let view = await plan();
  assert.equal(view.review.offer?.line, 'Every day at 8:00 am Chausar reads your records, updates your plan and may put ideas on Today for you to approve. It plans from your records until you connect an AI. It never sends, spends or changes a price.');
  assert.equal(view.review.consent, null);
  await ask('venture.chief.review.set', { on: true });
  await reviewSettled(env.deps);
  view = await plan();
  assert.deepEqual([view.review.on, view.review.offer, view.review.note, view.review.consent, view.review.last?.line], [true, null, null, null, REVIEW_WORDS.fromRecords]);
});

test('an AI connected while what is sold is not ready: the offer still carries the consent, and no line asks for it afterwards', async () => {
  const env = await setup();
  await seedBlueprint(env);
  env.models.connected = true;
  const { ask, plan } = plain(env);
  let view = await plan();
  assert.equal(view.review.consent?.state, 'needed');
  await ask('venture.chief.review.set', { on: true });
  await reviewSettled(env.deps);
  view = await plan();
  assert.deepEqual([view.next.kind, view.review.note, view.review.consent], ['offer', null, null], 'the AI is not asked before what is sold is ready, so nothing says agree and it will be');
});

test('when the review runs is said in the owner\'s words: the time, and the place only when the computer is somewhere else', async () => {
  assert.equal(reviewWhen('08:00', 'Asia/Kolkata', 'Asia/Kolkata'), 'Every day at 8:00 am');
  // The same place under its older name is the same place.
  assert.equal(reviewWhen('08:00', 'Asia/Kolkata', 'Asia/Calcutta'), 'Every day at 8:00 am');
  assert.equal(reviewWhen('20:30', 'Asia/Kolkata', 'America/New_York'), 'Every day at 8:30 pm, Kolkata time');
  assert.equal(reviewWhen('08:00', 'America/New_York', 'Asia/Kolkata'), 'Every day at 8:00 am, New York time');
  assert.equal(reviewWhen('08:00', 'Asia/Kolkata', null), 'Every day at 8:00 am, Kolkata time', 'a computer that cannot say where it is');
  const env = await reviewBusiness();
  scriptReview(env, [said()]);
  setComputerZone('Europe/London');
  try {
    await turnOn(env);
    assert.equal((await env.plan()).review.when, 'Every day at 8:00 am, Kolkata time');
    assert.equal(listRecords(env.store.read(), 'venture-decision').filter(record => record.subject === 'review:daily').at(-1)!.reason, `Daily review on: Every day at 8:00 am, Kolkata time. ${REVIEW_LINE}`);
    // The hosted app runs on a server, which is not where the owner is: the place is always said.
    setComputerZone('Asia/Kolkata');
    env.deps.host = 'hosted-web';
    assert.equal((await env.plan()).review.when, 'Every day at 8:00 am, Kolkata time');
  } finally { setComputerZone('Asia/Kolkata'); }
});

// Fix round 6 (17 Nov 2026): with the plan accepted and every price set, the daily review's AI did not propose the
// customer search, though the week's own step 3 was "Prepare a list of offices and event planners to review", and the
// owner had to start it from Clients. The founder's rule: finding customers is proposed only once the plan is accepted
// and the service is final, and only as a card the owner approves. When that holds, no search has run or waits, and
// the week has a step about finding customers, code raises the card itself from the plan's own words, on that step.
const CAKES = {
  customer: 'Offices and event planners pay for custom cakes and cupcakes for meetings and events.',
  reach: 'Find offices and event planners in Indore through public business listings and contacts you provide.',
  teamDoes: 'Finds possible office and event planner customers and keeps lead records.',
  youDo: 'Set each price, bake the cakes and send each message yourself.',
  firstWeek: ['Choose pickup or delivery arrangements.', 'Prepare a list of offices and event planners to review.', 'Review and approve outreach messages, then send them yourself.'],
};
const FIND_STEP = CAKES.firstWeek[1]!;
const CAKES_TITLE = 'Find possible customers: company offices in Indore';
const searchCards = (env: ReviewEnv) => listRecords(env.store.read(), 'venture-proposal').filter(record => record.proposalKind === 'find-customers');
const findMoves = (view: ChiefPlanView) => view.moves.filter(move => move.text === FIND_STEP || move.text === CAKES_TITLE).map(move => [move.text, move.state]);

test('the review proposes the customer search on the week\'s own step when its AI left it out, and never runs it', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: CAKES });
  const tasks = scriptReview(env, [said(), said()]);
  await turnOn(env);
  assert.equal(tasks.length, 1);
  assert.deepEqual(searchCards(env).map(card => [card.title, card.status, card.source]), [[CAKES_TITLE, 'raised', 'chief']]);
  assert.ok((await env.rows()).some(row => row.kind === 'proposal' && row.title === CAKES_TITLE), 'the card waits on Today');
  assert.deepEqual(listRecords(env.store.read(), 'venture-lead-search'), [], 'nothing is searched before the owner approves');
  const view = await env.plan();
  // The step itself stands for the card, and reads as the card does: no second move is added for it.
  assert.deepEqual(findMoves(view), [[CAKES_TITLE, 'proposed']]);
  assert.equal(view.review.last?.line, REVIEW_WORDS.withAi(1));
  // The next day the card still waits: it is not raised again.
  env.setNow('2026-10-22T02:35:00.000Z');
  await env.tick();
  assert.equal(tasks.length, 2);
  assert.equal(searchCards(env).length, 1);
});

test('a search the AI proposes itself stands on the week\'s step too, and is the only one', async () => {
  const env = await reviewBusiness();
  await env.call('venture.owner.set', { way: CAKES });
  scriptReview(env, [said({ proposals: [proposal('find-customers', { text: 'company offices in Indore', quantity: '' })] })]);
  await turnOn(env);
  assert.deepEqual(searchCards(env).map(card => card.title), [CAKES_TITLE]);
  assert.deepEqual(findMoves(await env.plan()), [[CAKES_TITLE, 'proposed']]);
});

test('code proposes no search once one ran, or when the week has no step about finding customers', async () => {
  const ran = await reviewBusiness();
  await ran.call('venture.owner.set', { way: CAKES });
  await ventureAction(ran.deps, owner, 'prepare', 'seed.search', tx => { tx.put({ ...tx.base('venture-lead-search'), proposalId: 'proposal_x', state: 'done' } as never); });
  scriptReview(ran, [said()]);
  await turnOn(ran);
  assert.deepEqual(searchCards(ran), []);
  const other = await reviewBusiness();
  await other.call('venture.owner.set', { way: { ...CAKES, firstWeek: ['Choose pickup or delivery arrangements.'] } });
  scriptReview(other, [said()]);
  await turnOn(other);
  assert.deepEqual(searchCards(other), []);
});
