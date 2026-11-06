import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';
import { assertFiguresProved } from '../helpers/ink-rules';

// C2 task 9 (REPORT row 79): Chats' search reads what was said, not only the titles, through venture.find.

async function start() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  window.location.hash = '#/chats';
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const spy = vi.spyOn(client, 'request');
  render(<App client={client} language="en" />);
  const list = await screen.findByRole('navigation', { name: 'Your chats' });
  await waitFor(() => expect(within(list).getAllByRole('link').length).toBeGreaterThan(1));
  const search = async (text: string) => { await act(async () => { fireEvent.change(within(list).getByRole('searchbox', { name: 'Search chats' }), { target: { value: text } }); }); };
  const titles = () => within(list).queryAllByRole('link').flatMap((a) => { const title = a.querySelector('[data-content]'); return title ? [title.textContent] : []; });
  return { list, search, titles, spy };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('Chats search (C2)', () => {
  it('lists a chat for a word only in its answer, with the matching line and its receipts', async () => {
    const { list, search, titles, spy } = await start();
    await search('received');
    await waitFor(() => expect(titles()).toEqual(['How much have we billed this month?']));
    await waitFor(() => expect(list.querySelector('[data-last-line]')!.textContent).toMatch(/and received/));
    expect(assertFiguresProved(list.querySelector('[data-last-line]')!).length).toBeGreaterThan(0);
    const asked = spy.mock.calls.filter(([method]) => method === 'venture.find').map(([, params]) => params);
    expect(asked).toContainEqual({ text: 'received', kinds: ['chat'], limit: 20 });
  });

  it('an unknown word says so', async () => {
    const { list, search, titles } = await start();
    await search('zzzz');
    await waitFor(() => expect(within(list).getByText('No chat has those words.')).toBeTruthy());
    expect(titles()).toEqual([]);
  });

  it('old chats that match are counted on one link to the old chats page', async () => {
    const { list, search, titles } = await start();
    await search('long episode edits');
    const link = await within(list).findByRole('link', { name: '1 old chat matches' });
    expect(link.getAttribute('href')).toBe('#/business/chats');
    expect(titles()).toEqual([]);
    expect(within(list).queryByText('No chat has those words.')).toBeNull();
  });

  it('one character filters the titles in the browser and asks nothing', async () => {
    const { search, spy } = await start();
    await search('t');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(spy.mock.calls.filter(([method]) => method === 'venture.find')).toHaveLength(0);
  });
});
