import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { skipAi } from './first-run-steps';

/**
 * Work outside the listed fields. When the owner's AI reads work that fits none of them, the engine answers with no
 * field, the AI's offers and the owner's own words as the idea (core/about.ts). The plan is kept as it is: there is no
 * list of professions to pick from, the side-work question is still asked, and the plan starts from the owner's words.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk wholesale orders from cafes and hotels in Pune.';
const READ = {
  family: null, profession: null, country: null, evidence: null, idea: POTTER, source: 'ai',
  offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes' }, { name: 'Hotel tableware', line: 'Bowls and mugs made in batches' }],
  reply: 'You make pottery by hand and want bulk orders. Where are you based?',
  way: {
    customer: 'Independent cafes and small hotels in Pune that buy tableware in bulk.',
    reach: 'A list of cafes found from public listings, then a first message you send to each owner.',
    teamDoes: 'Finds the cafes, drafts each message and quote, and keeps track of who replied.',
    youDo: 'Make the samples, set the prices, send each message and take the calls.',
    firstWeek: ['Decide the set sizes and your price for each offer.', 'Approve the first list of cafes.', 'Send the first five messages.'],
  },
};

function start() {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine({ fresh: true }));
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (method === 'venture.about.read') return Promise.resolve(structuredClone(READ));
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('first run: work outside the listed fields', () => {
  it('keeps the plan with no field, skips the profession list, asks the side-work question, and starts from the owner words', async () => {
    const { calls } = start();
    const box = await skipAi();
    fireEvent.change(box, { target: { value: POTTER } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    expect(await screen.findByText('You make pottery by hand and want bulk orders. Where are you based?')).toBeTruthy();
    // No field is picked, and the card says a field can still be picked; the offers are the AI's.
    const field = screen.getByRole('combobox', { name: 'Field' }) as HTMLSelectElement;
    expect(field.value).toBe('');
    expect(screen.getByText('Cafe mug sets')).toBeTruthy();
    // The way to earn the AI proposed shows under the offers, in its own words, marked as the AI's.
    const way = screen.getByRole('region', { name: 'How you earn' });
    for (const label of ['Who pays', 'How you reach them', 'Your team does', 'You do', 'First week']) expect(within(way).getByText(label)).toBeTruthy();
    expect(within(way).getByText(READ.way.customer).hasAttribute('data-content')).toBe(true);
    expect(within(way).getAllByRole('listitem').map((item) => item.textContent)).toEqual(READ.way.firstWeek);
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    // Straight to the side-work question: there is no "Which of these are you?" for work outside the list.
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(screen.queryByText('Which of these are you?')).toBeNull();
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'own-work' });
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.create')?.[1]).toMatchObject({ idea: POTTER, countryCode: 'IN' });
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toMatchObject({ profession: 'own-work', sideWork: 'not-sure' });
    // The way is kept with the business once it exists, so Chats can plan from it.
    expect(calls.find(([method, params]) => method === 'venture.owner.set' && 'way' in params)?.[1]).toEqual({ way: READ.way });
    // No field was kept, so none is written to the owner's profile.
    expect(calls.filter(([method, params]) => method === 'venture.owner.set' && 'familyId' in params)).toEqual([]);
  });

  it('a read with no field and no idea still cannot be kept: the owner picks a field or says more', async () => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) { return { ...original.call(this), timeZone: 'Asia/Kolkata' }; });
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.about.read'
      ? Promise.resolve({ family: null, profession: null, offers: [], country: null, evidence: null, idea: null, source: 'ai' })
      : fake.request(method as never, params as never))) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    const box = await skipAi();
    fireEvent.change(box, { target: { value: 'I am not sure what I can do yet, please help.' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    expect(keep.hasAttribute('disabled') || keep.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
