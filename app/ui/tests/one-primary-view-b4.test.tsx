import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/shell/App';
import { ClockProvider } from '../src/shell/clock';
import { NARROW } from '../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../src/engine/fake';
import { QUEUE, SETUP_ROWS } from '../src/engine/fixtures';
import type { EngineClient, GoalView } from '../src/engine/types';
import { assertOnePrimary, assertOnePrimaryPerView } from './helpers/ink-rules';
import { PLACES, RECEIPTED, type PlaceAtRest } from './helpers/places';

/**
 * One-shot B4 task 2: one filled button per view. The walk opens each place at rest at desktop width and at 375 px and
 * holds the rule on what is there. Each place task adds its id to WALK; task 23 checks the list holds every place.
 */

const WALK: readonly string[] = ['today', 'business', 'work/ideas', 'onboarding'];

const NOW = '2026-10-23T13:35:00.000Z';
const at = () => new Date(NOW);
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

function stubWidth(phone: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW && phone, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}
afterEach(() => { vi.restoreAllMocks(); });

type Answer = (asked: (method: string, params: unknown) => Promise<unknown>) => unknown;

function clientFor(engine: FakeEngine, answers: Readonly<Record<string, Answer>> = {}): EngineClient {
  const fake = createFakeClient(engine);
  const request = fake.request.bind(fake) as unknown as (method: string, params: unknown) => Promise<unknown>;
  return {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      const answer = answers[method];
      return answer ? answer(request) : request(method, params);
    }) as EngineClient['request'],
  };
}

async function open(hash: string, phone: boolean, client: EngineClient) {
  stubWidth(phone);
  window.location.hash = hash;
  const { container } = render(<ClockProvider now={at}><App client={client} language="en" /></ClockProvider>);
  await waitFor(() => {
    expect(container.querySelector('[data-boot]')).toBeNull();
    expect(container.querySelector('main h1')).not.toBeNull();
  }, { timeout: 5000 });
  await settle();
}

const placeClient = (place: PlaceAtRest) => clientFor(new FakeEngine({ now: () => NOW }), place.receipted ? { 'venture.money.overview': () => structuredClone(RECEIPTED) } : {});
const filled = () => [...document.querySelectorAll<HTMLButtonElement>('main [data-variant="primary"]')]
  .filter((button) => !button.hasAttribute('data-locked') && !button.disabled && !button.closest('details:not([open])'));
const cardOf = (id: string) => document.querySelector<HTMLElement>(`main [data-row-id="${id}"]`)!;
const nextIs = (rowId: string, title: string) => ({
  'venture.goals.get': async (asked: (method: string, params: unknown) => Promise<unknown>) => {
    const view = await asked('venture.goals.get', {}) as GoalView;
    return { ...view, next: { rowId, title, agent: null, line: '', figure: null, goalAfter: null, goalAfterPercent: null } };
  },
});

describe('one filled primary per view: the walk', () => {
  it('walks only places that exist', () => {
    const known = PLACES.map((place) => place.id);
    for (const id of WALK) expect(known).toContain(id);
  });

  for (const id of WALK) {
    const place = PLACES.find((p) => p.id === id)!;
    it.each([['desktop', false], ['375 px', true]] as const)(`%s: ${id} shows at most one filled button`, async (_width, phone) => {
      await open(place.hash, phone, placeClient(place));
      assertOnePrimaryPerView();
      assertOnePrimary();
    });
  }
});

describe("Today's one filled button", () => {
  it.each([['desktop', false], ['375 px', true]] as const)('%s: the next best step holds it; every card, setup rows too, draws its primary as a secondary', async (_width, phone) => {
    const engine = new FakeEngine({ now: () => NOW, queue: [...QUEUE, ...SETUP_ROWS] });
    await open('#/today', phone, clientFor(engine));
    assertOnePrimaryPerView();
    expect(filled().map((button) => button.textContent)).toEqual(['Approve']);
    expect(filled()[0]!.closest('[data-row-id]')).toBeNull();
    const needs = screen.getByRole('region', { name: 'Needs you' });
    const primaries = [...needs.querySelectorAll<HTMLElement>('[data-key="primary"]')];
    expect(primaries.length).toBeGreaterThan(0);
    for (const primary of primaries) expect(primary.dataset.variant, primary.textContent ?? '').toBe('secondary');
    for (const id of ['q-setup-ai', 'q-setup-prices', 'q-setup-keep']) expect(cardOf(id).querySelector('[data-key="primary"]'), id).not.toBeNull();
  });

  it("no next step: the first card that can be pressed holds it, and a locked one is passed over", async () => {
    const engine = new FakeEngine({ now: () => NOW, queue: QUEUE.filter((row) => row.id === 'run:d-ep14:review-1' || row.id === 'q-price-sponsor' || row.id === 'q-question-title') });
    const client = clientFor(engine, { 'venture.goals.get': async (asked) => ({ ...(await asked('venture.goals.get', {}) as GoalView), next: null }) });
    await open('#/today', false, client);
    assertOnePrimaryPerView();
    expect(screen.queryByText('Next best step')).toBeNull();
    expect(cardOf('q-price-sponsor').querySelector<HTMLElement>('[data-key="primary"]')!.dataset.variant).toBe('primary');
    expect(cardOf('q-question-title').querySelector<HTMLElement>('[data-key="primary"]')!.dataset.variant).toBe('secondary');
    expect(cardOf('run:d-ep14:review-1').querySelector<HTMLElement>('[data-key="primary"]')!.dataset.variant).toBe('secondary');
  });

  it('a quiet card still decides: its primary opens its own second ask, whose confirm is filled while it asks', async () => {
    await open('#/today', false, clientFor(new FakeEngine({ now: () => NOW })));
    const card = cardOf('q-price-sponsor');
    await act(async () => { fireEvent.click(card.querySelector<HTMLElement>('[data-key="primary"]')!); });
    await settle();
    expect(card.querySelector<HTMLElement>('[data-confirm]')!.dataset.variant).toBe('primary');
  });

  it('with no goal, Set a goal is a secondary', async () => {
    const client = clientFor(new FakeEngine({ now: () => NOW }));
    await client.request('workspace.lock', {});
    await client.request('workspace.open', { folder: 'ledgerline' });
    await open('#/today', false, client);
    const goal = await screen.findByRole('region', { name: 'October goal' });
    expect(within(goal).getByRole('button', { name: 'Set a goal' }).getAttribute('data-variant')).toBe('secondary');
    assertOnePrimaryPerView();
  });
});

describe('the next best step says each thing once', () => {
  it('has no Open when its primary is Connect: the row has nothing to look at', async () => {
    await open('#/today', false, clientFor(new FakeEngine({ now: () => NOW }), nextIs('q-setup-ai', 'Connect your AI')));
    const next = await screen.findByRole('region', { name: 'Connect your AI' });
    expect(within(next).queryByRole('button', { name: 'Open' })).toBeNull();
    expect(within(next).getByRole('button', { name: 'Connect' }).getAttribute('data-variant')).toBe('primary');
  });

  it('keeps Open when there is a thing to look at, and its locked primary is not filled', async () => {
    await open('#/today', false, clientFor(new FakeEngine({ now: () => NOW }), nextIs('run:d-ep14:review-1', 'Episode 14 is cut')));
    const next = await screen.findByRole('region', { name: 'Episode 14 is cut' });
    expect(within(next).getByRole('button', { name: 'Open' })).toBeTruthy();
    expect(within(next).getByRole('button', { name: /^Approve/ }).hasAttribute('data-locked')).toBe(true);
    expect(filled()).toHaveLength(0);
    assertOnePrimaryPerView();
  });
});
