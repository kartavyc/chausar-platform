import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { KEEPER_JOINS } from '../../../../platform/runtime/venture/agents/order-agents-core';
import { answerSideWork, skipAi } from './first-run-steps';

/**
 * The newest Windows build with a real AI (15 Nov 2026, third round), step 2:
 *   - a potter whose AI had written a plan ("Pune Handmade Pottery", pottery offers, a way, a team) picked "Creative
 *     work" in the Field list, and the whole card became that field's template ("Creative studio", Video edits);
 *   - the team card showed "dept.operations", "dept.marketing" and "dept.production" as words;
 *   - Keeper joined the team at acceptance and was listed nowhere before;
 *   - "Rename the first offer to ..." was answered "I couldn't rename it here" and never reached the engine.
 * A pick now only sets the field when there is a plan (the AI's, or offers the owner typed); the field's starting
 * examples come only when there is no plan yet.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes and hotels in Pune.';
const agent = (name: string, job: string, duties: string[], reads: string[], department: string) => ({ name, job, duties, reads, department, digest: teamCardDigest({ name, job, duties, reads, department } as never) });
const TEAM = [
  agent('Lead finder', 'Keeps your list of possible cafe customers.', ['Lists possible cafe customers'], ['clients', 'trackers'], 'marketing'),
  agent('Order coordinator', 'Keeps pottery order details in one place for you.', ['Tracks pottery order status for you'], ['orders', 'notes'], 'operations'),
  agent('Quote helper', 'Drafts quotes for your approval.', ['Drafts a quote for each enquiry'], ['plan', 'clients'], 'production'),
];
const OFFERS = [
  { name: 'Handmade pottery for cafes', line: 'Handmade mugs and bowls made in bulk for cafes.', unit: 'piece' },
  { name: 'Handmade pottery for hotels', line: 'Handmade mugs and bowls made in bulk for hotels.', unit: 'piece' },
];
const WAY = {
  customer: 'Cafes and hotels in Pune pay for handmade mugs and bowls in bulk.',
  reach: 'A list of cafes and hotels in Pune, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make the pottery, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.'],
};
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai', callId: 'modelcall_about_1',
  offers: OFFERS, reply: 'You make pottery by hand and want bulk orders. How many pieces can you make a month?', way: WAY, team: TEAM,
  orderAgents: [{ name: 'Delivery agent', does: 'Drafts the reply to each order for you to check.' }], needs: ['payments'], name: 'Pune Handmade Pottery',
};

type Call = [string, Record<string, unknown>];
function start(reads: unknown[] | null) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  let at = 0;
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (reads && method === 'venture.about.read') return Promise.resolve(structuredClone(reads[Math.min(at++, reads.length - 1)]));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}
async function plan(words = POTTER) {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: words } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  return keep;
}
const field = () => screen.getByRole('combobox', { name: 'Field' }) as HTMLSelectElement;
const pick = async (id: string) => { await act(async () => { fireEvent.change(field(), { target: { value: id } }); }); await waitFor(() => expect(field().value).toBe(id)); };
const names = () => [...document.querySelectorAll('[data-offer-name]')].map((item) => item.textContent);
const nameBox = () => document.querySelector<HTMLInputElement>('[data-plan-name]')!;

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: picking a field by hand keeps the plan', () => {
  it('after the AI wrote a plan, a pick only sets the field: the name, offers, way and team stay', async () => {
    const { calls } = start([READ]);
    const keep = await plan();
    await waitFor(() => expect(nameBox().value).toBe('Pune Handmade Pottery'));
    expect(field().value).toBe('');
    await pick('creative');
    // Nothing of the field's template reached the card.
    expect(nameBox().value).toBe('Pune Handmade Pottery');
    expect(names()).toEqual(OFFERS.map((offer) => offer.name));
    expect(screen.queryByText('Video edits')).toBeNull();
    expect(screen.queryByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeNull();
    expect(screen.getByText(WAY.reach)).toBeTruthy();
    const team = screen.getByRole('region', { name: 'Your team' });
    for (const card of TEAM) expect(within(team).getByText(card.name)).toBeTruthy();
    expect(within(team).getByText('Delivery agent')).toBeTruthy();
    // The unit the AI suggested for each offer holds too.
    expect((screen.getByRole('combobox', { name: 'How Handmade pottery for cafes is priced' }) as HTMLSelectElement).value).toBe('piece');

    // What hangs on the field follows it: the profession question is asked for the picked field, and it is recorded.
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    expect(await screen.findByText('Which of these are you?')).toBeTruthy();
    await answerSideWork();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    // The kept plan is the AI's own, word for word, under the owner's field.
    const draft = calls.find(([method]) => method === 'venture.blueprint.draft')![1] as { shown: { name: string; by: string; offers: unknown[] } };
    expect(draft.shown.name).toBe('Pune Handmade Pottery');
    expect(draft.shown.by).toBe('model');
    expect(draft.shown.offers).toEqual(OFFERS);
    expect(calls.find(([method]) => method === 'venture.create')?.[1]).toMatchObject({ idea: POTTER });
    const sets = calls.filter(([method]) => method === 'venture.owner.set').map(([, params]) => params);
    expect(sets).toContainEqual({ familyId: 'creative' });
    expect(sets).toContainEqual({ way: WAY });
    expect(sets).toContainEqual({ needs: ['payments'] });
    expect((calls.find(([method]) => method === 'venture.agents.hire.team')![1] as { agents: { name: string }[] }).agents.map((card) => card.name)).toEqual(TEAM.map((card) => card.name));
  }, 30000);

  it('a profession the AI read for another field does not follow the plan into the picked one', async () => {
    start([{ ...READ, family: { id: 'writing', label: 'Writing and translation', line: 'Words.' }, profession: { id: 'translator', label: 'Translator' } }]);
    const keep = await plan();
    await waitFor(() => expect(field().value).toBe('writing'));
    await pick('creative');
    expect(names()).toEqual(OFFERS.map((offer) => offer.name));
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    expect(await screen.findByText('Which of these are you?')).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Translator', checked: true })).toBeNull();
  }, 20000);

  it('offers the owner typed with no AI stay as typed: a pick sets the field and brings no examples', async () => {
    const { calls } = start(null);
    await plan();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Offer 1' }), { target: { value: 'Cafe mug sets' } });
    await pick('creative');
    expect((screen.getByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement).value).toBe('Cafe mug sets');
    expect(screen.queryByText('Video edits')).toBeNull();
    expect(screen.queryByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeNull();
    // The field is the plan's now, so the next message carries it and the typed offer with it.
    const box = screen.getByRole('textbox', { name: 'Message Chausar' });
    fireEvent.change(box, { target: { value: 'Most of my buyers are cafes.' } });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read')).toHaveLength(2));
    const sent = calls.filter(([method]) => method === 'venture.about.read')[1]![1] as { before: { plan: { familyId: string; offers: { name: string }[] } } };
    expect(sent.before.plan.familyId).toBe('creative');
    expect(sent.before.plan.offers.map((offer) => offer.name)).toEqual(['Cafe mug sets']);
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Offer 1' }) as HTMLInputElement).value).toBe('Cafe mug sets'));
    expect(field().value).toBe('creative');
    expect(screen.queryByText('Video edits')).toBeNull();
  }, 20000);

  it('with no plan yet (no AI, nothing typed) a pick still brings the field\'s starting examples', async () => {
    start(null);
    await plan();
    await screen.findByRole('textbox', { name: 'Offer 1' });
    await pick('creative');
    await waitFor(() => expect(names()).toContain('Video edits'));
    expect(screen.getByText('These are starting examples. Untick or rename any of them, or add your own.')).toBeTruthy();
  }, 20000);
});

describe('first run: the team on the plan card', () => {
  it('names each agent\'s department in words, never as a key', async () => {
    start([READ]);
    await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    expect(within(team).getByText('Marketing')).toBeTruthy();
    expect(within(team).getByText('Operations')).toBeTruthy();
    expect(within(team).getByText('Production')).toBeTruthy();
    expect(team.textContent).not.toMatch(/dept\./);
  }, 20000);

  it('lists Keeper with the agents that join when the plan is accepted, with what it does', async () => {
    start([READ]);
    await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    const keeper = within(team).getByText('Keeper').closest('li')!;
    expect(within(keeper).getByText(KEEPER_JOINS.does)).toBeTruthy();
    expect(within(keeper).getByText('Joins when you accept your plan')).toBeTruthy();
  }, 20000);
});

describe('first run: an offer rename asked in the chat', () => {
  it('goes to the engine, which renames that offer; it is not taken for a business rename', async () => {
    const renamed = { ...READ, offers: [{ ...OFFERS[0], name: 'Cafe mug sets' }, OFFERS[1]], reply: 'I renamed Handmade pottery for cafes to Cafe mug sets. The plan looks ready to keep.' };
    const { calls } = start([READ, renamed]);
    await plan();
    await waitFor(() => expect(names()).toEqual(OFFERS.map((offer) => offer.name)));
    const box = screen.getByRole('textbox', { name: 'Message Chausar' });
    fireEvent.change(box, { target: { value: 'Rename the first offer to Cafe mug sets.' } });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read')).toHaveLength(2));
    expect((calls.filter(([method]) => method === 'venture.about.read')[1]![1] as { text: string }).text).toBe('Rename the first offer to Cafe mug sets.');
    expect(await screen.findByText(renamed.reply)).toBeTruthy();
    expect(screen.queryByText('I couldn\'t rename it here. Type the name on the right.')).toBeNull();
    await waitFor(() => expect(names()).toEqual(['Cafe mug sets', OFFERS[1]!.name]));
    expect(nameBox().value).toBe('Pune Handmade Pottery');
  }, 20000);
});
