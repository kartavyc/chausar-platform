import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { skipAi } from './first-run-steps';

/**
 * What three owners saw in the real app on Windows (15 Nov 2026), on the plan card of About you and on Prices: every
 * price was "per project"; a potter's business was named "Service business"; the owner never saw the agents that do
 * each order until they joined on acceptance; and every proposed agent was in Operations. The card now shows each
 * offer's unit, which the owner changes; never starts from the plan's label; lists the agents that do each order as
 * joining when the plan is accepted; and names each proposed agent's department.
 */
const TRANSLATOR = 'I translate between Hindi and English and make subtitles for videos. I am in Bhopal and want steady work from YouTube creators.';
const agent = (name: string, job: string, duties: string[], reads: string[], department: string) => ({ name, job, duties, reads, department, digest: teamCardDigest({ name, job, duties, reads, department } as never) });
const WAY = {
  customer: 'YouTube creators pay for translation and subtitles.',
  reach: 'A list of creators you check, then a first message you send to each one.',
  teamDoes: 'Drafts each message and keeps track of leads.',
  youDo: 'Set your own prices, check every draft and send every message.',
  firstWeek: ['Decide what each offer covers and your price for it.', 'Approve the first list of creators.'],
};
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: TRANSLATOR, source: 'ai',
  offers: [{ name: 'Hindi-English translation', line: 'Translate scripts between Hindi and English.' }, { name: 'Video subtitles', line: 'Create subtitles for videos.', unit: 'minute' }],
  reply: 'You translate and make subtitles. Do you have sample work?',
  name: 'Bhopal Translation and Subtitles',
  way: WAY,
  team: [agent('Asha', 'Keeps prospect follow up organized for you.', ['Lists potential creator clients from public sources', 'Tracks lead follow ups'], ['clients', 'trackers'], 'sales')],
  orderAgents: [{ name: 'Translator', does: 'Drafts each source block with the locked glossary.' }, { name: 'Checker', does: 'Reads meaning and flags uncertainty without changing the source.' }],
};

type Call = [string, Record<string, unknown>];
function start(read: unknown = READ, next?: unknown) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: Call[] = [];
  let reads = 0;
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(reads++ === 0 || next === undefined ? read : next));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}
async function plan() {
  const box = await skipAi();
  fireEvent.change(box, { target: { value: TRANSLATOR } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  const keep = await screen.findByRole('button', { name: 'Keep this plan' });
  await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
  return keep;
}
afterEach(() => { vi.restoreAllMocks(); });

describe('About you: the unit each offer is priced in', () => {
  it('shows the unit the AI suggested for each offer, and the owner changes it on the card', async () => {
    const { calls } = start();
    const keep = await plan();
    const translation = screen.getByRole('combobox', { name: 'How Hindi-English translation is priced' }) as HTMLSelectElement;
    const subtitles = screen.getByRole('combobox', { name: 'How Video subtitles is priced' }) as HTMLSelectElement;
    expect([translation.value, subtitles.value]).toEqual(['project', 'minute']);
    expect(within(subtitles).getAllByRole('option').map((option) => option.textContent)).toEqual(['per project', 'per month', 'per year', 'per hour', 'per visit', 'per piece', 'per set', 'per minute', 'per word', 'per page']);
    fireEvent.change(translation, { target: { value: 'piece' } });
    expect(translation.value).toBe('piece');
    // A follow-up tells the engine the unit on the card, and the kept plan is saved with it.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Chausar' }), { target: { value: 'I can work on forty minutes of video a day.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read').length).toBe(2));
    const before = calls.filter(([method]) => method === 'venture.about.read')[1]![1].before as { plan: { offers: { name: string; unit?: string }[] } };
    expect(before.plan.offers.map((offer) => [offer.name, offer.unit])).toEqual([['Hindi-English translation', 'piece'], ['Video subtitles', 'minute']]);
    expect(keep).toBeTruthy();
  });

  it('keeping the plan saves each offer in the unit the card showed', async () => {
    const { calls } = start();
    const keep = await plan();
    fireEvent.change(screen.getByRole('combobox', { name: 'How Hindi-English translation is priced' }), { target: { value: 'piece' } });
    await act(async () => { fireEvent.click(keep); });
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 });
    const draft = calls.find(([method]) => method === 'venture.blueprint.draft')![1] as { shown: { offers: { name: string; unit?: string }[] } };
    expect(draft.shown.offers.map((offer) => [offer.name, offer.unit])).toEqual([['Hindi-English translation', 'piece'], ['Video subtitles', 'minute']]);
  });
});

describe('About you: one team on the card', () => {
  it('lists the agents that will do each order, said to join when the plan is accepted, and each proposed agent\'s department', async () => {
    start();
    await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    const proposed = team.querySelector('[data-team-agent]') as HTMLElement;
    expect(within(proposed).getByText('Asha')).toBeTruthy();
    expect(within(proposed).getByText('Sales and clients')).toBeTruthy();
    const order = [...team.querySelectorAll('[data-order-agent]')] as HTMLElement[];
    expect(order.map((item) => item.querySelector('[data-content]')!.textContent)).toEqual(['Translator', 'Checker']);
    expect(within(order[0]!).getByText('Drafts each source block with the locked glossary.')).toBeTruthy();
    for (const item of order) expect(within(item).getByText('Joins when you accept your plan')).toBeTruthy();
    expect(within(team).getByText('They do each order')).toBeTruthy();
    // No way to leave one out: they come with the plan, not with this card.
    expect(within(order[0]!).queryByRole('button')).toBeNull();
  });

  it('shows who does each order even when the AI proposed no agent', async () => {
    start({ ...READ, team: undefined });
    await plan();
    const team = screen.getByRole('region', { name: 'Your team' });
    expect(team.querySelector('[data-team-agent]')).toBeNull();
    expect(team.querySelectorAll('[data-order-agent]').length).toBe(2);
  });
});

describe('About you: the business name', () => {
  it('never starts from the plan\'s label for work outside the listed fields, and never sends a label back as the name', async () => {
    const { calls } = start({ ...READ, name: undefined });
    await plan();
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    await waitFor(() => expect(calls.some(([method]) => method === 'venture.preview')).toBe(true));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(name.value).toBe('Hindi-English translation');
    expect(name.value).not.toBe('Service business');
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Chausar' }), { target: { value: 'I also know Marathi.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read').length).toBe(2));
    const before = calls.filter(([method]) => method === 'venture.about.read')[1]![1].before as { plan: { name: string | null } };
    expect(before.plan.name).toBeNull();
  });

  it('sends the AI\'s own name, or the one the owner typed, with a follow-up', async () => {
    const { calls } = start();
    await plan();
    const name = screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    expect(name.value).toBe('Bhopal Translation and Subtitles');
    fireEvent.change(name, { target: { value: 'Bhopal Subtitles' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message Chausar' }), { target: { value: 'I also know Marathi.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.about.read').length).toBe(2));
    const before = calls.filter(([method]) => method === 'venture.about.read')[1]![1].before as { plan: { name: string | null; team: { name: string; department?: string }[] } };
    expect(before.plan.name).toBe('Bhopal Subtitles');
    expect(before.plan.team.map((item) => [item.name, item.department])).toEqual([['Asha', 'sales']]);
    // The owner's own name stays on the card whatever the next answer proposes.
    expect((screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Bhopal Subtitles');
  });
});

describe('Prices: the unit an offer is priced in', () => {
  it('shows each offer\'s unit as a choice, and a change goes to the engine as the unit alone', async () => {
    window.location.hash = '#/business/prices';
    const fake = createFakeClient(new FakeEngine());
    const calls: Call[] = [];
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    const plan = await fake.request('venture.blueprint.get', {});
    const offer = plan!.blueprint.offers[0]!;
    const unit = await screen.findByRole('combobox', { name: `How ${offer.name.value} is priced` }) as HTMLSelectElement;
    expect(unit.value).toBe(offer.pricing.quantityUnit);
    await act(async () => { fireEvent.change(unit, { target: { value: 'visit' } }); });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.blueprint.update').map(([, params]) => params.patch)).toContainEqual({ offers: [{ id: offer.id, unit: 'visit' }] }));
    await waitFor(() => expect((screen.getByRole('combobox', { name: `How ${offer.name.value} is priced` }) as HTMLSelectElement).value).toBe('visit'));
  });
});
