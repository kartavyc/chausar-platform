// The bell and the notification centre (Ink v2 wave 4, package 4G4; spec 5.7, catalogue O12; D's `.ib .dot` and the
// phone's `.tib`). The bell sits in every page header's tools and in the phone's top bar, says how many are new in its
// name only ("Notifications, 2 new"), and opens the centre: the items with their times, newest first, the morning
// digest, Mark all read, and a way to the settings. An item opens its approval on the standalone page.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { NARROW } from '../../src/shell/useNarrow';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, NotificationView, VentureRunEvent } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const NOW = () => '2026-10-23T13:35:00.000Z';

function stubPhone() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

function start(hash = '#/today', engine = new FakeEngine({ now: NOW }), language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'];
  const view = render(<App client={client} language={language} />);
  return { client, engine, calls, ...view };
}
const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const tools = () => screen.getByRole('group', { name: 'Page tools' });
const centre = () => document.querySelector<HTMLElement>('[data-centre]')?.closest<HTMLElement>('[data-sheet]') ?? null;

afterEach(() => { vi.restoreAllMocks(); });

describe('the bell', () => {
  it('sits in the page header\'s tools on every place, says how many are new in its name, and shows a dot, never a number', async () => {
    start('#/work');
    const bell = await within(tools()).findByRole('button', { name: 'Notifications, 2 new' });
    expect(bell.querySelector('[data-dot]')).not.toBeNull();
    expect(bell.textContent).toBe('');
    expect(bell.getAttribute('aria-expanded')).toBe('false');
    for (const hash of ['#/today', '#/team', '#/money', '#/business/plan']) {
      await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); });
      await settle();
      expect(within(tools()).getByRole('button', { name: /^Notifications/ })).toBeTruthy();
    }
  }, 20_000);

  it('opens the centre: each item with its time, newest first, and the morning digest', async () => {
    start('#/work');
    fireEvent.click(await within(tools()).findByRole('button', { name: 'Notifications, 2 new' }));
    await waitFor(() => expect(centre()).not.toBeNull());
    const sheet = centre()!;
    expect(within(sheet).getByRole('heading', { name: 'Notifications' })).toBeTruthy();
    const items = within(await within(sheet).findByRole('list', { name: 'Notifications' })).getAllByRole('listitem');
    expect(items).toHaveLength(7);
    expect(items[0]!.textContent).toContain('Thumbnail set');
    expect(items[0]!.querySelector('time')?.getAttribute('datetime')).toBe('2026-10-21T10:06:00.000Z');
    expect(items[0]!.hasAttribute('data-unread')).toBe(true);
    expect(items[2]!.hasAttribute('data-unread')).toBe(false);
    expect(within(items[0]!).getByText('New')).toBeTruthy();
    // The digest the engine wrote in code, in its own words.
    expect(within(sheet).getByText(/^Today: 7 need you \(/)).toBeTruthy();
    expect(within(sheet).getByRole('link', { name: 'Notification settings' }).getAttribute('href')).toBe('#/business/notifications');
    expect(within(tools()).getByRole('button', { name: /^Notifications/ }).getAttribute('aria-expanded')).toBe('true');
    assertInkRules(document.body);
  });

  it('Mark all read reads them all through the engine, and the bell loses its dot', async () => {
    const { calls } = start('#/work');
    fireEvent.click(await within(tools()).findByRole('button', { name: 'Notifications, 2 new' }));
    await waitFor(() => expect(centre()).not.toBeNull());
    fireEvent.click(within(centre()!).getByRole('button', { name: 'Mark all read' }));
    await waitFor(() => expect(calls).toContainEqual(['venture.notify.read', { all: true }]));
    const bell = await within(tools()).findByRole('button', { name: 'Notifications' });
    expect(bell.querySelector('[data-dot]')).toBeNull();
    expect(within(centre()!).queryByRole('button', { name: 'Mark all read' })).toBeNull();
    expect(within(centre()!).getByText('Nothing new.')).toBeTruthy();
  });

  it('an item opens its approval on the approval page and is marked read', async () => {
    const { calls } = start('#/work');
    fireEvent.click(await within(tools()).findByRole('button', { name: 'Notifications, 2 new' }));
    await waitFor(() => expect(centre()).not.toBeNull());
    const first = within(centre()!).getAllByRole('link').find((a) => a.textContent?.includes('Post to X'))!;
    expect(first.getAttribute('href')).toBe('#/approve/post:linkedin-ep13:v1');
    fireEvent.click(first);
    await waitFor(() => expect(calls.some(([method, params]) => method === 'venture.notify.read' && Array.isArray((params as { ids?: string[] }).ids))).toBe(true));
  });

  it('reads again when the engine says the centre changed', async () => {
    const { engine } = start('#/work');
    await within(tools()).findByRole('button', { name: 'Notifications, 2 new' });
    await act(async () => { await engine.request('venture.notify.read', { all: true }); });
    const event: VentureRunEvent = { type: 'notify.new', businessId: 'lumen', at: NOW() };
    await act(async () => { engine.emit(event); });
    await within(tools()).findByRole('button', { name: 'Notifications' });
  });

  it('with nothing to tell, the centre says so plainly', async () => {
    start('#/work', new FakeEngine({ now: NOW, queue: [] }));
    fireEvent.click(await within(tools()).findByRole('button', { name: 'Notifications' }));
    await waitFor(() => expect(centre()).not.toBeNull());
    expect(within(centre()!).getByText('Nothing here yet. When something needs you, it shows here.')).toBeTruthy();
    expect(within(centre()!).queryByRole('list', { name: 'Notifications' })).toBeNull();
  });

  it('on a phone it sits in the top bar, with no border', async () => {
    stubPhone();
    start('#/team');
    const bar = document.querySelector<HTMLElement>('header[data-top-bar]')!;
    const bell = await within(bar).findByRole('button', { name: 'Notifications, 2 new' });
    expect(bell.getAttribute('data-look')).toBe('bare');
    expect(screen.queryByRole('group', { name: 'Page tools' })?.querySelector('[data-look="outlined"]') ?? null).toBeNull();
  });

  it('in Hindi', async () => {
    start('#/work', new FakeEngine({ now: NOW }), 'hi');
    fireEvent.click(await screen.findByRole('button', { name: /^सूचनाएँ/ }));
    await waitFor(() => expect(centre()).not.toBeNull());
    expect(within(centre()!).getByRole('button', { name: 'सब पढ़ा हुआ करें' })).toBeTruthy();
  });

  it('the bell and the centre read one shared list, say a new count aloud once it goes up, and word every kind', async () => {
    const state = { unread: 1, items: [] as NotificationView[] };
    const engine = new FakeEngine({ now: NOW });
    window.location.hash = '#/work';
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    let lists = 0;
    client.request = (async (method: string, params?: unknown) => {
      if (method === 'venture.notify.list') { lists += 1; return { items: structuredClone(state.items), unread: state.unread, digest: null }; }
      return request(method as never, params as never);
    }) as EngineClient['request'];
    render(<App client={client} language="en" />);
    await within(tools()).findByRole('button', { name: 'Notifications, 1 new' });
    const live = document.querySelector<HTMLElement>('[data-bell-live]')!;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.className).toContain('sr-only');
    expect(live.textContent).toBe('');
    state.unread = 3;
    state.items = (['followup', 'reply', 'notice', 'proposal'] as const).map((kind, i) => ({ id: `n${i}`, rowId: `r${i}`, kind, title: `Item ${i}`, at: NOW(), read: false }));
    await act(async () => { engine.emit({ type: 'notify.new', businessId: 'lumen', at: NOW() }); });
    await within(tools()).findByRole('button', { name: 'Notifications, 3 new' });
    expect(live.textContent).toBe('Notifications, 3 new');
    fireEvent.click(within(tools()).getByRole('button', { name: 'Notifications, 3 new' }));
    await waitFor(() => expect(centre()).not.toBeNull());
    const items = within(await within(centre()!).findByRole('list', { name: 'Notifications' })).getAllByRole('listitem');
    expect(items.map((item) => item.querySelector('[data-kind]')?.textContent)).toEqual(['Follow-up', 'Reply', 'Notice', 'Proposal']);
    expect(items[0]!.querySelector('[data-sep]')?.getAttribute('aria-hidden')).toBe('true');
    // One read serves the bell and the centre together.
    lists = 0;
    await act(async () => { engine.emit({ type: 'notify.new', businessId: 'lumen', at: NOW() }); });
    await settle();
    expect(lists).toBe(1);
    state.unread = 2;
    await act(async () => { engine.emit({ type: 'notify.new', businessId: 'lumen', at: NOW() }); });
    await within(tools()).findByRole('button', { name: 'Notifications, 2 new' });
    expect(live.textContent).toBe('Notifications, 3 new');
  });
});
