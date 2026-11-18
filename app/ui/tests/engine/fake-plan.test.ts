import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { QUEUE } from '../../src/engine/fixtures';
import { priceAndAcceptPlan } from '../helpers/accepted-plan';
import { EngineError, type ChatConsentView, type ChiefPlanView, type QueueList, type RoutineView, type VentureViewLite } from '../../src/engine/types';
import { setComputerZone } from '../../../../platform/runtime/owner-format';
import { MOVE_STATE_LABEL } from '../../../../platform/runtime/venture/chief/plan-core';
import { DAILY_REVIEW_PROMPT, REVIEW_LINE, REVIEW_OFFER_TITLE, REVIEW_WORDS, STEP_WORDS } from '../../../../platform/runtime/venture/chief/plan-view';

/*
 * The fake engine's standing plan (fake-plan.ts) answers as the engine's does (platform/runtime/venture/chief/plan.ts,
 * review.ts): the same shapes, codes and words. It decides with the engine's own plan-core.ts and words with its
 * plan-view.ts, so these tests hold the fake's part: the facts it reads, what it keeps, and what it refuses.
 */

// The review says where its time is only when that is not where this computer is: the tests' computer is in India.
setComputerZone('Asia/Kolkata');
const NOW = '2026-10-23T13:35:00.000Z';
const plan = (engine: FakeEngine) => engine.request('venture.chief.plan.get', {}) as Promise<ChiefPlanView>;
type RoutinesView = { routines: RoutineView[] };
/** The plan's two writes answer with the plan, as the engine's do. */
const move = (engine: FakeEngine, params: unknown) => engine.request('venture.chief.plan.move', params) as Promise<ChiefPlanView>;
const review = (engine: FakeEngine, params: unknown) => engine.request('venture.chief.review.set', params) as Promise<ChiefPlanView>;
const setRoutine = (engine: FakeEngine, routine: unknown) => engine.request('venture.routines.set', { routine }) as Promise<{ routine: RoutineView }>;
const refusal = async (work: Promise<unknown>) => ((await work.catch((error: unknown) => error)) as EngineError).code;

/** A business just made on a fresh computer: its plan drafted, nothing accepted or priced yet. */
async function fresh() {
  const engine = new FakeEngine({ fresh: true, now: () => NOW });
  await engine.request('workspace.create', { name: 'Clay Corner', pack: 'services' });
  await engine.request('venture.create', { idea: 'Handmade pottery sold in bulk to cafes and small hotels', countryCode: 'IN' });
  return engine;
}

describe('fake engine: the chief\'s standing plan', () => {
  it('the sample has its week, its daily review on, and one next best step decided by code', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const view = await plan(engine);
    expect(Object.keys(view).sort()).toEqual(['goal', 'line', 'moves', 'next', 'review', 'weekOf']);
    expect(view.weekOf).toBe('2026-10-19');
    expect(view.line).toEqual({ text: 'Approvals are holding up the next episode, so start there.', estimate: false, by: 'ai' });
    // One offer on the accepted plan has no price: its setup move leads what is still to do, and the records tick it.
    expect(view.moves.map((move) => [move.text, move.state, move.label, move.can])).toEqual([
      ['Record the next episode.', 'done', MOVE_STATE_LABEL.done, ['planned']],
      ['Set your prices', 'waiting', MOVE_STATE_LABEL.waiting, []],
      ['Reply to the sponsors who wrote back.', 'waiting', MOVE_STATE_LABEL.waiting, ['done', 'dropped']],
      ["Plan next month's episodes.", 'planned', MOVE_STATE_LABEL.planned, ['done', 'dropped']],
    ]);
    // By the engine's rule a business with clients is not held behind a new offer's price: the card that waits on the
    // owner with the most money at stake is the step, and the setup card (connect an AI) only waits beside it.
    expect(view.next).toMatchObject({ kind: 'row', title: 'Sponsor slot price', action: { id: 'row', label: 'Approve', rowId: 'q-price-sponsor' }, by: 'records' });
    expect(view.next.also).toEqual({ line: 'Also waiting: Connect your AI.', rowIds: ['q-setup-ai'], titles: ['Connect your AI'] });
    // With nothing waiting on Today the step is to price the offer, and no setup card is named beside it.
    const quiet = await plan(new FakeEngine({ now: () => NOW, queue: [] }));
    expect(quiet.next).toEqual({
      kind: 'offer', title: 'Set your price for Shorts from your long video.', line: STEP_WORDS.offer,
      action: { id: 'go', label: 'Set prices', link: '#/business/prices' }, agent: null, figure: null, goalAfterPercent: null, by: 'records', also: null,
    });
    // A setup card never leads the week: alone on Today it waits beside the sample's own move.
    const housekeeping = await plan(new FakeEngine({ now: () => NOW, queue: QUEUE.filter((row) => row.id === 'q-setup-ai') }));
    expect([housekeeping.next.kind, housekeeping.next.also?.line]).toEqual(['offer', 'Also waiting: Connect your AI.']);
    expect(view.review).toMatchObject({ on: true, offer: null, time: '08:00', timeZone: 'Asia/Kolkata', when: 'Every day at 8:00 am', next: '2026-10-24T02:30:00.000Z', line: 'Daily review at 8:00 am.', note: null });
    expect(view.review.last).toEqual({ at: '2026-10-23T02:30:00.000Z', line: REVIEW_WORDS.withAi(0), by: 'ai' });
    expect(view.review.ownUse).toMatchObject({ runsPerDay: 3, usedRuns: 1, capMicros: '250000', cap: '$0.25', capTyped: '0.25' });
    expect(view.goal).toMatchObject({ month: '2026-10', state: 'set' });
    // The setup progress on venture.get is the same count: accepted, not yet all priced.
    const venture = await engine.request('venture.get', {}) as VentureViewLite;
    expect([venture.done, venture.total]).toEqual([1, 2]);
  });

  it('the daily review is a routine in Routines, with the engine\'s words, and only its time or switch can change', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const listed = (await engine.request('venture.routines.list', {}) as RoutinesView).routines.find((routine) => routine.review === 'daily')!;
    expect([listed.name, listed.prompt, listed.when, listed.line]).toEqual(['Daily review', DAILY_REVIEW_PROMPT, 'Every day at 8:00 am', `Next 24 Oct 2026, 8:00 am. ${REVIEW_LINE}`]);
    const routine = { id: listed.id, name: listed.name, agent: null, schedule: listed.schedule, on: true };
    expect(await refusal(setRoutine(engine, { ...routine, prompt: 'Send every client a discount today.' }))).toBe('INVALID_VENTURE_REQUEST');
    const moved = await setRoutine(engine, { ...routine, prompt: listed.prompt!, schedule: { ...listed.schedule, time: '07:30' } });
    expect(moved.routine.review).toBe('daily');
    expect((await plan(engine)).review.time).toBe('07:30');
  });

  it('the owner ticks, drops and plans again a move of their own; anything else is refused as the engine refuses it', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const before = await plan(engine);
    const [done, setup, waiting, planned] = before.moves;
    const after = await move(engine, { id: waiting!.id, to: 'done' });
    expect(after.moves.map((move) => move.state)).toEqual(['done', 'waiting', 'done', 'planned']);
    expect((await move(engine, { id: planned!.id, to: 'dropped' })).moves[3]!.state).toBe('dropped');
    expect((await move(engine, { id: done!.id, to: 'planned' })).moves[0]!.state).toBe('waiting');
    for (const bad of [{ id: 'mv_nope', to: 'done' }, { id: waiting!.id, to: 'done' }, { id: setup!.id, to: 'done' }, { id: waiting!.id, to: 'proposed' }, { id: waiting!.id }, { id: waiting!.id, to: 'done', extra: 1 }]) {
      expect(await refusal(move(engine, bad))).toBe('INVALID_VENTURE_REQUEST');
    }
  });

  it('a new business starts from the records: accept the plan first, with the review offered once and nothing on Today for it', async () => {
    const engine = await fresh();
    let view = await plan(engine);
    expect([view.next.kind, view.next.title, view.next.by]).toEqual(['offer', 'Read your plan and accept it.', 'records']);
    // No plan is drafted yet, so there is no plan card on Today to press: the step goes where the plan is.
    expect(view.next.action).toEqual({ id: 'go', label: 'Open your plan', link: '#/business/plan' });
    expect(view.moves.slice(0, 2).map((move) => [move.text, move.state, move.can])).toEqual([['Accept your plan', 'waiting', []], ['Set your prices', 'planned', []]]);
    expect(view.line).toEqual({ text: 'First, get what you sell ready.', estimate: false, by: 'records' });
    expect(view.review.on).toBe(false);
    expect(view.review.offer?.title).toBe(REVIEW_OFFER_TITLE);
    expect(view.review.offer?.line).toMatch(/^Every day at 8:00 am Chausar reads your records, updates your plan and may put ideas on Today for you to approve\. .*It never sends, spends or changes a price\.$/);
    const rows = (await engine.request('venture.queue.list', { scope: 'current' }) as QueueList).rows;
    expect(rows.some((row) => row.title === REVIEW_OFFER_TITLE)).toBe(false);
    expect(((await engine.request('venture.get', {})) as VentureViewLite).done).toBe(0);
    // One approval switches it on, makes its routine and runs the first review at once, from the records here.
    view = await review(engine, { on: true });
    expect([view.review.on, view.review.offer, view.review.line]).toEqual([true, null, 'Daily review at 8:00 am.']);
    expect(view.review.last).toMatchObject({ line: REVIEW_WORDS.fromRecords, by: 'records' });
    expect((await engine.request('venture.routines.list', {}) as RoutinesView).routines.filter((routine) => routine.review === 'daily')).toHaveLength(1);
    // Off again: the routine stays, switched off, and the offer is not made again.
    view = await review(engine, { on: false });
    expect([view.review.on, view.review.offer, view.review.line, view.review.next]).toEqual([false, null, 'Daily review is off.', null]);
  });

  it('Not now answers the offer for good and makes no routine; the settings are checked as the engine checks them', async () => {
    const engine = await fresh();
    const declined = await review(engine, { on: false });
    expect([declined.review.on, declined.review.offer, declined.review.routineId]).toEqual([false, null, null]);
    expect((await engine.request('venture.routines.list', {}) as RoutinesView).routines.some((routine) => routine.review === 'daily')).toBe(false);
    for (const bad of [{}, { on: 'yes' }, { on: true, time: '8am' }, { on: true, runsPerDay: 25 }, { on: true, runsPerDay: 1.5 }, { on: true, extra: 1 }]) {
      expect(await refusal(review(engine, bad))).toBe('INVALID_VENTURE_REQUEST');
    }
    expect(await refusal(review(engine, { on: true, cap: 'lots' }))).toBe('INVALID_AMOUNT');
    const set = await review(engine, { on: true, time: '09:15', runsPerDay: 0, cap: '0.5' });
    expect([set.review.time, set.review.when, set.review.ownUse.runsPerDay, set.review.ownUse.capMicros]).toEqual(['09:15', 'Every day at 9:15 am', 0, '500000']);
    expect(set.review.ownUse.line).toBe('Chausar never asks your AI on its own.');
  });

  it('with nothing open it refuses, as the engine does', async () => {
    const engine = new FakeEngine({ fresh: true, now: () => NOW });
    expect(await refusal(plan(engine))).toBe('VAULT_LOCKED');
  });
});

/*
 * The chat consent and the daily review, as chief/plan.ts reviewView and chief/review.ts answer (the Mac run of
 * 14 Nov 2026): the offer carries the consent in place, the line that asks for it shows only while it is true, and a
 * review held for the consent runs once the consent is given.
 */
describe('fake engine: the daily review and the chat consent', () => {
  type Threads = { consent: ChatConsentView };
  const consentOf = async (engine: FakeEngine) => (await engine.request('venture.chief.threads', {}) as Threads).consent;
  const agree = async (engine: FakeEngine) => engine.request('venture.chats.consent', { digest: (await consentOf(engine)).digest });

  /** The owner's own AI on both tiers, as Connections connects it; the key is built here, never a real one. */
  const connectAi = (client: ReturnType<typeof createFakeClient>) => client.request('venture.models.connect', { presetId: 'openai-gpt-6-luna', consentDigest: 'consent-openai', apiKey: ['test', 'key', 'value'].join('-'), tiers: ['fast', 'main'] } as never);

  /** A new business with its plan accepted and priced (what is sold is ready), and the owner's own AI connected or not. */
  async function ready(ai = true) {
    const engine = await fresh();
    const client = createFakeClient(engine);
    for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'project' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) await client.request('venture.interview.answer', { questionId, answer });
    await priceAndAcceptPlan(engine, await client.request('venture.blueprint.draft', { useTemplate: true }), '100');
    if (ai) await connectAi(client);
    return engine;
  }

  it('once what is sold is ready a setup card never leads: the week\'s move is the step and the card waits beside it', async () => {
    // No AI connected, so "Connect your AI" waits on Today, with the recovery code: both are housekeeping.
    const engine = await ready(false);
    const view = await plan(engine);
    const setup = (await engine.request('venture.queue.list', { scope: 'current' }) as QueueList).rows.filter((row) => row.kind === 'setup');
    expect(setup.length).toBeGreaterThan(0);
    expect([view.next.kind, view.next.title]).toEqual(['move', 'Add your first client']);
    expect(view.next.also).toEqual({ line: `Also waiting: ${setup.map((row) => row.title).join(', ')}.`, rowIds: setup.map((row) => row.id), titles: setup.map((row) => row.title) });
  });

  it('the offer carries the consent Chats shows; agreeing first and turning on asks the AI at once', async () => {
    const engine = await ready();
    const needed = await consentOf(engine);
    expect(needed.state).toBe('needed');
    let view = await plan(engine);
    expect(view.review.offer).not.toBeNull();
    expect(view.review.consent).toEqual(needed);
    expect(view.review.note).toBeNull();
    await agree(engine);
    view = await review(engine, { on: true });
    expect([view.review.on, view.review.consent, view.review.note, view.review.last?.by]).toEqual([true, null, null, 'ai']);
    expect((await consentOf(engine)).state).toBe('given');
  });

  it('turned on without the consent it plans from records and says so only while that is true; the consent later runs the held review', async () => {
    const engine = await ready();
    let view = await review(engine, { on: true });
    expect([view.review.on, view.review.note, view.review.last?.line, view.review.last?.by]).toEqual([true, REVIEW_WORDS.consent, REVIEW_WORDS.fromRecords, 'records']);
    expect(view.review.consent?.state).toBe('needed');
    view = await review(engine, { on: false });
    expect([view.review.note, view.review.consent]).toEqual([null, null]);
    view = await review(engine, { on: true });
    expect(view.review.note).toBe(REVIEW_WORDS.consent);
    const heard: string[] = [];
    engine.subscribe((event) => { heard.push(event.type); });
    await agree(engine);
    view = await plan(engine);
    expect([view.review.note, view.review.consent, view.review.last?.by, view.review.last?.line]).toEqual([null, null, 'ai', REVIEW_WORDS.withAi(0)]);
    expect(view.review.ownUse.usedRuns).toBe(1);
    expect(heard).toContain('queue.changed');
    // Agreeing again runs nothing more.
    await agree(engine);
    expect((await plan(engine)).review.ownUse.usedRuns).toBe(1);
  });

  it('a consent given while the review is off runs nothing', async () => {
    const engine = await ready();
    await agree(engine);
    expect((await plan(engine)).review.last).toBeNull();
  });

  it('with no AI connected the offer says it plans from your records, and Turn on still works', async () => {
    const engine = await ready(false);
    let view = await plan(engine);
    expect(view.review.offer?.line).toBe('Every day at 8:00 am Chausar reads your records, updates your plan and may put ideas on Today for you to approve. It plans from your records until you connect an AI. It never sends, spends or changes a price.');
    expect(view.review.consent).toBeNull();
    view = await review(engine, { on: true });
    expect([view.review.on, view.review.note, view.review.consent, view.review.last?.line]).toEqual([true, null, null, REVIEW_WORDS.fromRecords]);
  });

  it('an AI connected while what is sold is not ready: the offer carries the consent, and no line asks for it afterwards', async () => {
    const engine = await fresh();
    const client = createFakeClient(engine);
    await connectAi(client);
    expect((await plan(engine)).review.consent?.state).toBe('needed');
    const view = await review(engine, { on: true });
    expect([view.review.note, view.review.consent]).toEqual([null, null]);
  });
});
