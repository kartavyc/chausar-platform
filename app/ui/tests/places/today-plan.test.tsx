import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { NARROW } from '../../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ChatConsentView, ChiefPlanStep, ChiefPlanView, EngineClient, RoutineView } from '../../src/engine/types';
import { REVIEW_WORDS } from '../../../../platform/runtime/venture/chief/plan-view';
import { setComputerZone } from '../../../../platform/runtime/owner-format';
import { priceAndAcceptPlan } from '../helpers/accepted-plan';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';
import { moveId, type PlanMove } from '../../../../platform/runtime/venture/chief/plan-core';
import { stepView } from '../../../../platform/runtime/venture/chief/plan-view';

/*
 * The chief's standing plan on Today (venture.chief.plan.get; ChiefPlan.tsx): the chief's line for today, the one next
 * best step with its one primary, and this week's moves with their states, beside the goal card. The daily review is
 * offered once, filled in, and switched on by one press; its time and Chausar's own daily AI allowance change in a
 * sheet. Every word is the engine's.
 */

// The review says where its time is only when that is not where this computer is: the tests' computer is in India.
setComputerZone('Asia/Kolkata');
/** 19:05 in Kolkata on Friday 23 October 2026. */
const NOW = '2026-10-23T13:35:00.000Z';
const at = () => new Date(2026, 9, 23, 19, 5);

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const settleHash = async () => { await act(async () => { window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

function stubWidth(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW && narrow, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}
afterEach(() => { vi.restoreAllMocks(); });

type Asked = (method: string, params: unknown) => Promise<unknown>;
type Override = Partial<Record<string, (params: unknown, asked: Asked) => unknown>>;

async function start({ engine = new FakeEngine({ now: () => NOW }), override = {}, narrow = false }: { engine?: FakeEngine; override?: Override; narrow?: boolean } = {}) {
  stubWidth(narrow);
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake);
  const calls: [string, unknown][] = [];
  const asked: Asked = (method, params) => request(method as never, params as never) as Promise<unknown>;
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      const answer = override[method];
      return answer ? answer(params, asked) : asked(method, params);
    }) as EngineClient['request'],
  };
  window.location.hash = '#/today';
  render(<ClockProvider now={at}><App client={client} language="en" /></ClockProvider>);
  await settle();
  return { client, calls, engine };
}

/** A business just made on a fresh computer, open on Today: nothing accepted yet, and the review still to be offered. */
async function freshEngine(): Promise<FakeEngine> {
  const engine = new FakeEngine({ fresh: true, now: () => NOW });
  await engine.request('workspace.create', { name: 'Clay Corner', pack: 'services' });
  await engine.request('venture.create', { idea: 'Handmade pottery sold in bulk to cafes and small hotels', countryCode: 'IN' });
  return engine;
}

const week = () => screen.findByRole('region', { name: 'This week' });
const planWith = (change: (view: ChiefPlanView) => ChiefPlanView) => async (_params: unknown, asked: Asked) => change(await asked('venture.chief.plan.get', {}) as ChiefPlanView);
const step = (over: Partial<ChiefPlanStep>): ChiefPlanStep => ({ kind: 'clear', title: 'Nothing needs you right now.', line: null, action: null, agent: null, figure: null, goalAfterPercent: null, by: 'records', also: null, ...over });

describe('Today: the chief\'s plan beside the goal', () => {
  it('shows the chief\'s line for today, this week\'s moves with their states, and the daily review in one line', async () => {
    await start();
    const plan = await week();
    const said = document.querySelector('main [data-chief-line]')!;
    expect(said.textContent).toBe('Approvals are holding up the next episode, so start there.');
    expect(said.querySelector('[data-estimate]')).toBeNull();
    // In order: the chief's line, the one next best step, then the week.
    const tile = document.querySelector('main [data-next-step]')!;
    expect(said.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tile.compareDocumentPosition(plan) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const moves = within(plan).getAllByRole('listitem');
    expect(moves.map((move) => [move.getAttribute('data-state'), move.querySelector('span:nth-of-type(2)')?.textContent])).toEqual([
      ['done', 'Record the next episode.'], ['waiting', 'Set your prices'], ['waiting', 'Reply to the sponsors who wrote back.'], ['planned', "Plan next month's episodes."],
    ]);
    // A state that asks something of the owner is shown in words; the others are said aloud only.
    expect(within(moves[1]!).getByText('Waiting on you').className).not.toBe('sr-only');
    expect(within(moves[0]!).getByText('Done').className).toBe('sr-only');
    expect(within(moves[3]!).getByText('Planned').className).toBe('sr-only');
    // A move the records check has no tick of the owner's; the owner's own moves do.
    expect(within(moves[1]!).queryByRole('button')).toBeNull();
    expect(within(moves[2]!).getByRole('button', { name: 'Mark done: Reply to the sponsors who wrote back.' })).toBeTruthy();
    expect(plan.textContent).toContain('Daily review at 8:00 am.');
    expect(within(plan).getByRole('button', { name: 'Change the daily review' }).textContent).toBe('Change');
    // The plan sits in the goal's row, with the step's tile above the week.
    const row = plan.parentElement!.parentElement!;
    expect(row.querySelector('[data-next-step]')).not.toBeNull();
    expect(row.querySelector('section[data-card][data-state]')).not.toBeNull();
    assertInkRules(document.body);
  });

  it('the owner ticks a move done, and the plan reads again from the engine', async () => {
    const { calls } = await start();
    const plan = await week();
    await act(async () => { fireEvent.click(within(plan).getByRole('button', { name: 'Mark done: Reply to the sponsors who wrote back.' })); });
    await settle();
    const sent = calls.filter(([method]) => method === 'venture.chief.plan.move');
    expect(sent).toHaveLength(1);
    expect((sent[0]![1] as { to: string }).to).toBe('done');
    const moves = within(await week()).getAllByRole('listitem');
    expect(moves.map((move) => move.getAttribute('data-state'))).toEqual(['done', 'waiting', 'done', 'planned']);
    // Done by hand can be planned again, and a planned move dropped.
    expect(within(moves[2]!).getByRole('button', { name: 'Plan again: Reply to the sponsors who wrote back.' })).toBeTruthy();
    await act(async () => { fireEvent.click(within(moves[3]!).getByRole('button', { name: "Drop: Plan next month's episodes." })); });
    await settle();
    expect(within(await week()).getAllByRole('listitem')[3]!.getAttribute('data-state')).toBe('dropped');
  });

  it('the mark and the chief\'s words stay on one row when the words wrap: the mark never sits alone on a line', async () => {
    await start();
    await week();
    const said = document.querySelector('main [data-chief-line]')!;
    // The mark, then one box that holds every word (and the estimate label when there is one), which wraps inside itself.
    expect([...said.children].map((child) => child.tagName.toLowerCase())).toEqual(['svg', 'span']);
    const css = readFileSync(join(import.meta.dirname, '../../src/places/today/ChiefPlan.module.css'), 'utf8');
    const rule = /\.say \{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toMatch(/flex-wrap: nowrap/);
    expect(rule).not.toMatch(/flex-wrap: wrap/);
  });

  it('a line the owner\'s AI wrote with a number in it is labelled a model estimate', async () => {
    await start({ override: { 'venture.chief.plan.get': planWith((view) => ({ ...view, line: { text: 'Three cafes are worth a quote today.', estimate: true, by: 'ai' } })) } });
    await week();
    const said = document.querySelector('main [data-chief-line]')!;
    expect(said.textContent).toContain('Three cafes are worth a quote today.');
    expect(said.querySelector('[data-estimate]')?.textContent).toMatch(/model estimate/i);
  });

  it('a step the owner does themselves is ticked from the step; with nothing left it says so and has no button', async () => {
    const first = await start({
      override: { 'venture.chief.plan.get': planWith((view) => ({ ...view, next: step({ kind: 'move', title: 'Reply to the sponsors who wrote back.', action: { id: 'done', label: 'Done', moveId: 'mv_sample_2' }, by: 'chief' }) })) },
    });
    const tile = await screen.findByRole('region', { name: 'Reply to the sponsors who wrote back.' });
    assertOnePrimary(tile);
    await act(async () => { fireEvent.click(within(tile).getByRole('button', { name: /^Done/ })); });
    await settle();
    expect(first.calls.filter(([method]) => method === 'venture.chief.plan.move').map(([, params]) => params)).toEqual([{ id: 'mv_sample_2', to: 'done' }]);
    document.body.innerHTML = '';
    await start({ override: { 'venture.chief.plan.get': planWith((view) => ({ ...view, next: step({ line: 'Chausar looks again at its next daily review.' }) })) } });
    const clear = await screen.findByRole('region', { name: 'Nothing needs you right now.' });
    expect(clear.textContent).toContain('Chausar looks again at its next daily review.');
    expect(within(clear).queryByRole('button')).toBeNull();
  });

  it('setup cards that also wait are one quiet line under the step, never the step itself', async () => {
    const also = { line: 'Also waiting: Confirm your tax, Keep this business.', rowIds: ['q-setup-prices', 'q-setup-keep'], titles: ['Confirm your tax', 'Keep this business'] };
    await start({
      override: { 'venture.chief.plan.get': planWith((view) => ({ ...view, next: step({ kind: 'move', title: 'Approve the first list of cafes.', action: { id: 'done', label: 'Done', moveId: 'mv_sample_2' }, also }) })) },
    });
    const tile = await screen.findByRole('region', { name: 'Approve the first list of cafes.' });
    assertOnePrimary(tile);
    const line = tile.querySelector('[data-also-waiting]');
    expect(line?.textContent).toBe('Also waiting: Confirm your tax, Keep this business.');
    expect(line?.querySelector('button, a')).toBeNull();
  });

  it('on a phone the step folds into the goal card and the week follows it', async () => {
    await start({ narrow: true });
    const goal = await screen.findByRole('region', { name: 'October goal' });
    await waitFor(() => expect(goal.querySelector('[data-next-folded]')).not.toBeNull());
    // The sample has clients, so the card waiting on the owner leads its offer with no price; the setup card waits beside it.
    expect(goal.querySelector('[data-next-folded]')!.textContent).toContain('Sponsor slot price');
    expect(goal.querySelector('[data-next-folded] [data-also-waiting]')?.textContent).toBe('Also waiting: Connect your AI.');
    assertOnePrimary(goal);
    const plan = await week();
    expect(within(plan).getAllByRole('listitem')).toHaveLength(4);
    expect(document.querySelectorAll('[data-next-step]')).toHaveLength(0);
    // The chief's line leads, above the goal card.
    const said = document.querySelector('main [data-chief-line]')!;
    expect(said.compareDocumentPosition(goal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Today: the daily review, offered once and switched on by one press', () => {
  it('a new business is offered it, filled in; Turn on switches it on, makes its routine and the offer goes', async () => {
    const engine = await freshEngine();
    const { calls } = await start({ engine });
    const plan = await week();
    const offer = plan.querySelector<HTMLElement>('[data-review-offer]')!;
    expect(offer.textContent).toContain('Let Chausar plan each morning');
    expect(offer.textContent).toContain('Every day at 8:00 am Chausar reads your records, updates your plan and may put ideas on Today for you to approve.');
    expect(offer.textContent).toContain('It never sends, spends or changes a price.');
    // The step holds the card's one filled button; the offer's own are plain.
    expect(offer.querySelector('[data-variant="primary"]')).toBeNull();
    await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Turn on' })); });
    await settle();
    expect(calls.filter(([method]) => method === 'venture.chief.review.set').map(([, params]) => params)).toEqual([{ on: true }]);
    const after = await week();
    expect(after.querySelector('[data-review-offer]')).toBeNull();
    expect(after.textContent).toContain('Daily review at 8:00 am.');
    const routines = (await engine.request('venture.routines.list', {}) as { routines: RoutineView[] }).routines;
    expect(routines.filter((routine) => routine.review === 'daily' && routine.on)).toHaveLength(1);
  });

  it('Not now answers it for good: the review stays off, and the line says so with Change beside it', async () => {
    const engine = await freshEngine();
    const { calls } = await start({ engine });
    const offer = (await week()).querySelector<HTMLElement>('[data-review-offer]')!;
    await act(async () => { fireEvent.click(within(offer).getByRole('button', { name: 'Not now' })); });
    await settle();
    expect(calls.filter(([method]) => method === 'venture.chief.review.set').map(([, params]) => params)).toEqual([{ on: false }]);
    const after = await week();
    expect(after.querySelector('[data-review-offer]')).toBeNull();
    expect(after.textContent).toContain('Daily review is off.');
    expect(within(after).getByRole('button', { name: 'Change the daily review' })).toBeTruthy();
  });

  it('Change opens its sheet: the time and how often Chausar may ask the AI on its own, saved by one approval', async () => {
    const { calls } = await start();
    await act(async () => { fireEvent.click(within(await week()).getByRole('button', { name: 'Change the daily review' })); });
    await settleHash();
    await settle();
    const form = await screen.findByRole('form', { name: 'Daily review' });
    const sheet = form.closest('[data-sheet]')!;
    expect(sheet.textContent).toContain('Every day at 8:00 am');
    expect(sheet.textContent).not.toContain('Asia/Kolkata');
    expect((within(form).getByRole('checkbox', { name: 'Review my business every day' }) as HTMLInputElement).checked).toBe(true);
    const time = within(form).getByLabelText('Time') as HTMLInputElement;
    const runs = within(form).getByLabelText('Times a day Chausar may ask your AI on its own') as HTMLInputElement;
    expect([time.value, runs.value]).toEqual(['08:00', '3']);
    expect(form.textContent).toContain('Chausar may ask your AI on its own up to 3 times a day');
    fireEvent.change(time, { target: { value: '07:30' } });
    fireEvent.change(runs, { target: { value: '2' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save' })); });
    await settle();
    const saved = calls.filter(([method]) => method === 'venture.chief.review.set').map(([, params]) => params as { on: boolean; time: string; runsPerDay: number });
    expect(saved).toHaveLength(1);
    expect([saved[0]!.on, saved[0]!.time, saved[0]!.runsPerDay]).toEqual([true, '07:30', 2]);
    await waitFor(async () => expect((await week()).textContent).toContain('Daily review at 7:30 am.'));
  });
});

/*
 * The daily review and the chat consent (the Mac run of 14 Nov 2026). With an AI connected and the consent missing,
 * Turn on shows the consent in place, in the engine's own words behind "What's sent": one button agrees and turns the
 * review on (the consent Chats records, then the switch), the other turns it on from records only. Afterwards the one
 * line that asks for the consent shows only while the engine sends it, with Agree beside it.
 */
describe('Today: the daily review asks for the chat consent in place', () => {
  /** A new business whose plan is accepted and priced, with the owner's own AI connected and no chat consent yet. */
  async function readyWithAi(): Promise<FakeEngine> {
    const engine = await freshEngine();
    const client = createFakeClient(engine);
    for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'project' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) await client.request('venture.interview.answer', { questionId, answer });
    await priceAndAcceptPlan(engine, await client.request('venture.blueprint.draft', { useTemplate: true }), '100');
    await client.request('venture.models.connect', { presetId: 'openai-gpt-6-luna', consentDigest: 'consent-openai', apiKey: ['test', 'key', 'value'].join('-'), tiers: ['fast', 'main'] } as never);
    return engine;
  }
  const consentOf = async (engine: FakeEngine) => (await engine.request('venture.chief.threads', {}) as { consent: ChatConsentView }).consent;
  const sent = (calls: [string, unknown][]) => calls.filter(([method]) => method === 'venture.chief.review.set' || method === 'venture.chats.consent');
  const press = async (within_: HTMLElement, name: string) => { await act(async () => { fireEvent.click(within(within_).getByRole('button', { name })); }); await settle(); };

  it('Turn on shows the consent in place; Agree and turn on records it and switches the review on', async () => {
    const engine = await readyWithAi();
    const needed = await consentOf(engine);
    const { calls } = await start({ engine });
    let offer = (await week()).querySelector<HTMLElement>('[data-review-offer]')!;
    expect(offer.querySelector('[data-consent-words]')).toBeNull();
    await press(offer, 'Turn on');
    // Nothing is sent or switched yet: the same offer now holds the consent, whole, behind "What's sent".
    expect(sent(calls)).toEqual([]);
    offer = (await week()).querySelector<HTMLElement>('[data-review-offer]')!;
    expect(offer.textContent).toContain('Let Chausar plan each morning');
    const words = offer.querySelector<HTMLElement>('[data-consent-words]')!;
    expect(within(words).getByText("What's sent")).toBeTruthy();
    expect(words.querySelector('details')!.open).toBe(false);
    expect(words.textContent).toContain(needed.text!);
    expect(within(offer).queryByRole('button', { name: 'Turn on' })).toBeNull();
    assertOnePrimary(document.querySelector('main')!);
    await press(offer, 'Agree and turn on');
    expect(sent(calls)).toEqual([['venture.chats.consent', { digest: needed.digest }], ['venture.chief.review.set', { on: true }]]);
    const after = await week();
    expect(after.querySelector('[data-review-offer]')).toBeNull();
    expect(after.querySelector('[data-review-consent]')).toBeNull();
    expect(after.textContent).toContain('Daily review at 8:00 am.');
    // One recorded consent: Chats does not ask again.
    expect((await consentOf(engine)).state).toBe('given');
    // The first review asked the AI at once.
    expect(document.querySelector('main [data-chief-line]')!.textContent).toBe('Start with what waits for you on Today.');
    assertInkRules(document.body);
  });

  it('declined, the review still turns on from records and says so in one line; Agree there runs the held review', async () => {
    const engine = await readyWithAi();
    const needed = await consentOf(engine);
    const { calls } = await start({ engine });
    await press((await week()).querySelector<HTMLElement>('[data-review-offer]')!, 'Turn on');
    await press((await week()).querySelector<HTMLElement>('[data-review-offer]')!, 'Turn on, records only');
    expect(sent(calls)).toEqual([['venture.chief.review.set', { on: true }]]);
    let plan = await week();
    expect(plan.querySelector('[data-review-offer]')).toBeNull();
    const held = plan.querySelector<HTMLElement>('[data-review-consent]')!;
    expect(held.textContent).toContain(REVIEW_WORDS.consent);
    expect(held.textContent).toContain(needed.text!);
    expect(plan.textContent).toContain('Daily review at 8:00 am.');
    expect(within(plan).getByRole('button', { name: 'Change the daily review' })).toBeTruthy();
    assertInkRules(document.body);
    await press(held, 'Agree');
    expect(sent(calls).at(-1)).toEqual(['venture.chats.consent', { digest: needed.digest }]);
    plan = await week();
    expect(plan.querySelector('[data-review-consent]')).toBeNull();
    expect(plan.textContent).not.toContain(REVIEW_WORDS.consent);
    expect(document.querySelector('main [data-chief-line]')!.textContent).toBe('Start with what waits for you on Today.');
  });

  it('the line and its consent never show while the review is off, or once the consent is given', async () => {
    const engine = await readyWithAi();
    await engine.request('venture.chief.review.set', { on: true });
    await engine.request('venture.chief.review.set', { on: false });
    await start({ engine });
    const plan = await week();
    expect(plan.querySelector('[data-review-consent]')).toBeNull();
    expect(plan.textContent).not.toContain(REVIEW_WORDS.consent);
    expect(plan.textContent).toContain('Daily review is off.');
  });

  it('with no AI connected the offer says it plans from your records, and Turn on works at once', async () => {
    const engine = await freshEngine();
    const { calls } = await start({ engine });
    const offer = (await week()).querySelector<HTMLElement>('[data-review-offer]')!;
    expect(offer.textContent).toContain('It plans from your records until you connect an AI.');
    await press(offer, 'Turn on');
    expect(sent(calls)).toEqual([['venture.chief.review.set', { on: true }]]);
    expect((await week()).querySelector('[data-review-consent]')).toBeNull();
  });
});

/*
 * A first-week move about finding customers opens Find customers (found by running the real app, 15 Nov 2026). The kept
 * first week said "Build a list of possible cafes in Pune" and the step offered only Done. The engine's plan now gives
 * that step the way to the capability that does it (chief/plan-view.ts stepView, which the fake plans with too).
 */
describe('Today: a first-week move that finds customers opens Find customers', () => {
  const WAY = {
    customer: 'Cafe owners in Pune who buy tableware in bulk.', reach: 'A list of cafes near Koregaon Park, then a first message you send to each one.',
    teamDoes: 'Drafts each message and quote.', youDo: 'Make the pieces, set the prices and send each message.',
    firstWeek: ['Build a list of possible cafes in Pune', 'Photograph three sample sets.'],
  };
  /** The week's moves as the plan holds them once the way is kept, and the step the engine's own stepView gives the first. */
  const finds: PlanMove = { id: moveId(WAY.firstWeek[0]!), text: WAY.firstWeek[0]!, source: 'way', state: 'waiting', at: NOW, by: 'records' };
  const other: PlanMove = { id: moveId(WAY.firstWeek[1]!), text: WAY.firstWeek[1]!, source: 'way', state: 'planned', at: NOW, by: 'records' };
  const stepOf = (move: PlanMove) => stepView({ kind: 'move', moveId: move.id, title: move.text }, { rows: [], ranked: null, moves: [finds, other], reviewOn: false });

  it('the step is that move, and its one button opens the Find customers sheet with the brief from the way', async () => {
    expect(stepOf(finds)).toMatchObject({ kind: 'move', title: WAY.firstWeek[0], action: { id: 'go', label: 'Find customers', link: '#/clients/pipeline?sheet=find:new' }, by: 'records' });
    const engine = await freshEngine();
    await engine.request('venture.owner.set', { way: WAY });
    await start({ engine, override: { 'venture.chief.plan.get': planWith((view) => ({ ...view, next: stepOf(finds) })) } });
    const next = (await screen.findByText('Next best step')).closest('section') as HTMLElement;
    await waitFor(() => expect(next.textContent).toContain(WAY.firstWeek[0]));
    expect(next.textContent).toContain('Chausar looks only after you approve the search.');
    expect(within(next).queryByRole('button', { name: 'Done' })).toBeNull();
    await act(async () => { fireEvent.click(within(next).getByRole('button', { name: 'Find customers' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await settle();
    expect(window.location.hash).toBe('#/clients/pipeline?sheet=find:new');
    expect(await screen.findByRole('complementary', { name: 'Find customers' })).toBeTruthy();
    // The brief the sheet opens with is the one the engine seeds from the kept way.
    const view = await engine.request('venture.leads.find.view', {}) as { brief: { who: string; place: string } | null };
    expect(view.brief).toMatchObject({ who: WAY.customer, place: 'Pune' });
  });

  it('any other move of the week keeps Done', () => {
    expect(stepOf(other).action).toEqual({ id: 'done', label: 'Done', moveId: other.id });
  });
});
