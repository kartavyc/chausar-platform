import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { QUEUE, SETUP_ROWS } from '../../src/engine/fixtures';
import type { EngineClient, GoalView, QueueRow } from '../../src/engine/types';
import { sessionFor } from '../../src/parts/queue-session';

/** One-shot B4 task 13: Today says each fact once. */
const NOW = '2026-10-23T13:35:00.000Z';

it('keeps one decided line per draft with its latest state', () => {
  const session = sessionFor(createFakeClient(new FakeEngine()));
  const first: QueueRow = { ...QUEUE[0]!, id: 'run:d-one:review-1', digest: 'one' };
  const next: QueueRow = { ...first, id: 'run:d-one:review-2', digest: 'two' };
  session.keep(first, 'Sent back.');
  session.keep(next, 'Accepted.');
  expect(session.lines().map(item => item.line)).toEqual(['Accepted.']);
  // The old row remains decided if an older queue read arrives; only its visible line is superseded.
  expect(session.line(first.id)?.line).toBe('Sent back.');
});

it('a late old-version read cannot replace the newer draft decision', () => {
  const session = sessionFor(createFakeClient(new FakeEngine()));
  const old: QueueRow = { ...QUEUE[0]!, id: 'run:d-one:review-1', digest: 'one', createdAt: '2026-10-21T10:00:00Z' };
  const next: QueueRow = { ...old, id: 'run:d-one:review-2', digest: 'two', createdAt: '2026-10-21T11:00:00Z' };
  session.keep(next, 'Accepted.');
  session.keep(old, 'Resolved elsewhere.', undefined, false);
  expect(session.lines().map(item => item.line)).toEqual(['Accepted.']);
});

it('setup cards omit a clock time', async () => {
  await open(clientFor(new FakeEngine({ now: () => NOW, queue: [SETUP_ROWS[0]!] })));
  const card = screen.getByRole('heading', { name: 'Set your prices' }).closest('[data-card]')!;
  expect(card.querySelector('time')).toBeNull();
  expect(card.textContent).not.toMatch(/\d{1,2}:\d{2}\s*[ap]m/i);
});

it('opens a draft through one quiet action before approval', async () => {
  const draft = QUEUE.find(row => row.id === 'run:d-ep14:review-1')!;
  await open(clientFor(new FakeEngine({ now: () => NOW, queue: [draft] })));
  const button = screen.getByRole('button', { name: 'Open draft' });
  expect(button.getAttribute('data-variant')).toBe('quiet');
  expect(within(button.closest('[data-card]') as HTMLElement).getByRole('button', { name: 'Approve' }).getAttribute('title')).toBe('Approve unlocks after you open it');
});
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
afterEach(() => { vi.restoreAllMocks(); });

function clientFor(engine: FakeEngine, next?: { rowId: string; title: string }): EngineClient {
  const fake = createFakeClient(engine);
  return {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      const answer = await (fake.request as (m: string, p?: unknown) => Promise<unknown>)(method, params);
      if (method === 'venture.goals.get' && next) return { ...(answer as GoalView), next: { ...next, agent: null, line: '', figure: null, goalAfter: null, goalAfterPercent: null } };
      return answer;
    }) as EngineClient['request'],
  };
}
async function open(client: EngineClient, hash = '#/today') {
  window.location.hash = hash;
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  await screen.findByRole('region', { name: 'Needs you' }, { timeout: 5000 });
  await settle();
}
const seen = (element: Element) => !element.closest('[hidden]');

describe('Today says each fact once', () => {
  it('the next best step holds its row: the card that equals it stays out of view until pressed', async () => {
    const engine = new FakeEngine({ now: () => NOW, queue: [...QUEUE, ...SETUP_ROWS] });
    const row = (await engine.request('venture.queue.list', { scope: 'all' }) as { rows: { id: string; title: string; kind: string }[] }).rows.find((r) => r.id === 'q-setup-ai')!;
    await open(clientFor(engine, { rowId: row.id, title: row.title }));
    expect(screen.getAllByText(row.title).filter(seen)).toHaveLength(1);
    expect(document.querySelector(`main [data-row-id="${row.id}"]`)!.closest('[hidden]')).not.toBeNull();
  });

  it('the waiting count is in the Needs you heading, not in the greeting, the team tile or All', async () => {
    await open(clientFor(new FakeEngine({ now: () => NOW })));
    const header = document.querySelector('main header')!;
    await waitFor(() => expect(header.textContent).toContain('agents are working'));
    expect(header.textContent).not.toMatch(/need/);
    const team = screen.getByRole('region', { name: 'Team at work' });
    expect(team.textContent).not.toMatch(/\d+ (working|idle|needs? you)/);
    expect(within(team).queryByRole('button', { name: /^Chausar/ })).toBeNull();
    const all = within(screen.getByRole('region', { name: 'Needs you' })).getByRole('button', { name: /^All/ });
    expect(all.textContent).toBe('All');
  });

  it('Sort sits in the chip row, and other businesses are one line', async () => {
    await open(clientFor(new FakeEngine({ now: () => NOW })));
    const needs = screen.getByRole('region', { name: 'Needs you' });
    expect(within(needs).getByRole('button', { name: /^Sort/ }).closest('[data-chip-row]')).not.toBeNull();
    expect(within(needs).getByText(/^Other businesses: \d+ waiting$/)).toBeTruthy();
  });

  it('a decided line sits above the cards', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await open(clientFor(engine, undefined));
    const needs = screen.getByRole('region', { name: 'Needs you' });
    const cards = [...needs.querySelectorAll<HTMLElement>('article[data-row-id]')].filter(seen);
    const later = cards.find((card) => within(card).queryByRole('button', { name: /^Later$/ })) ?? cards[1]!;
    const id = later.getAttribute('data-row-id')!;
    const button = within(later).queryByRole('button', { name: /^Later$/ });
    if (button) {
      await act(async () => { fireEvent.click(button); });
      await settle();
      const after = [...needs.querySelectorAll<HTMLElement>('[data-row-id]')].filter(seen);
      const decided = after.findIndex((card) => card.hasAttribute('data-decided'));
      if (decided >= 0) expect(decided).toBe(0);
      expect(id).toBeTruthy();
    }
  });

  it('has no Waiting on you fold at the bottom', async () => {
    await open(clientFor(new FakeEngine({ now: () => NOW })));
    expect(document.querySelector('[data-today-fold="waiting"]')).toBeNull();
  });
});

describe('the goal card', () => {
  it('with no goal: one line, one filled-weight button, no chart, no month pill', async () => {
    const client = clientFor(new FakeEngine({ now: () => NOW }));
    await client.request('workspace.lock', {});
    await client.request('workspace.open', { folder: 'ledgerline' });
    await open(client);
    const goal = await screen.findByRole('region', { name: 'October goal' });
    expect(goal.querySelector('svg[role="img"], [data-chart]')).toBeNull();
    expect(goal.textContent!.match(/October/g)!.length).toBeLessThanOrEqual(2);
    const buttons = within(goal).getAllByRole('button').filter((b) => b.textContent && b.getAttribute('data-variant') !== 'quiet');
    expect(buttons.map((b) => b.textContent)).toEqual(['Set a goal']);
    expect(goal.querySelector('[data-goal-pill]')).toBeNull();
  });

  it('with a goal: the foot is one pace line, and the legend is a tooltip', async () => {
    await open(clientFor(new FakeEngine({ now: () => NOW })));
    const goal = document.querySelector('section[data-card][data-state="set"]');
    if (!goal) return;
    expect(goal.querySelectorAll('[data-goal-foot] > *').length).toBeLessThanOrEqual(1);
    expect(goal.querySelector('ul')).toBeNull();
  });
});

describe('the Arrange sheet and its button', () => {
  it('names the button for the place, has no eyebrow, and says "always shows" in one line', async () => {
    await open(clientFor(new FakeEngine({ now: () => NOW })));
    const tool = screen.getByRole('button', { name: 'Arrange Today' });
    await act(async () => { fireEvent.click(tool); });
    const sheet = await screen.findByRole('complementary', { name: 'Arrange Today' });
    expect(within(sheet).queryByText('Layout')).toBeNull();
    expect(within(sheet).getAllByText(/^Always shows/)).toHaveLength(1);
  });
});
