import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';

/** C1 task 7: Settings is a grouped list with search, beside the page from 760 px, alone on a phone. */

function width(narrow: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW && narrow, media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

async function start(hash: string, { narrow = false, engine = new FakeEngine() } = {}) {
  width(narrow);
  window.location.hash = hash;
  render(<App client={createFakeClient(engine)} language="en" />);
  await act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
}

const settings = () => screen.getByRole('navigation', { name: 'Settings' });
const groups = () => within(settings()).queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const search = () => within(settings()).getByRole('searchbox', { name: 'Search settings' });
const type = async (words: string) => { await act(async () => { fireEvent.change(search(), { target: { value: words } }); }); };

afterEach(() => { vi.restoreAllMocks(); });

describe('Settings beside the page (a wide window)', () => {
  it('one nav named Settings with the four groups in order, Goals current, and no row of tabs', async () => {
    await start('#/business/goals');
    expect(await screen.findByRole('heading', { level: 1, name: 'Goals' })).toBeTruthy();
    expect(screen.getAllByRole('navigation', { name: 'Settings' })).toHaveLength(1);
    expect(groups()).toEqual(['Business', 'Work', 'Money', 'Safety']);
    expect(within(settings()).getByRole('link', { name: 'Goals' }).getAttribute('aria-current')).toBe('page');
    expect(document.querySelector('main [data-tabs]')).toBeNull();
  });

  it('#/business opens How the work is done beside the list', async () => {
    await start('#/business');
    expect(await screen.findByRole('heading', { level: 1, name: 'How the work is done' })).toBeTruthy();
    expect(within(settings()).getByRole('link', { name: 'How the work is done' }).getAttribute('aria-current')).toBe('page');
  });

  it('search filters as the owner types: a group with no match hides; no match says so; Escape clears', async () => {
    await start('#/business/goals');
    await type('pass');
    expect(groups()).toEqual(['Safety']);
    expect(within(settings()).getAllByRole('link').map((a) => a.textContent)).toEqual(['Keep this business']);
    await type('zzz');
    expect(groups()).toEqual([]);
    expect(within(settings()).getByRole('status').textContent).toBe('No setting matches that.');
    await act(async () => { fireEvent.keyDown(search(), { key: 'Escape' }); });
    expect((search() as HTMLInputElement).value).toBe('');
    expect(groups()).toEqual(['Business', 'Work', 'Money', 'Safety']);
  });

  it('Enter opens the first match', async () => {
    await start('#/business/goals');
    await type('rout');
    await act(async () => { fireEvent.keyDown(search(), { key: 'Enter' }); });
    await waitFor(() => expect(window.location.hash).toBe('#/business/routines'));
  });

  it('"model" finds AI settings in Connections', async () => {
    await start('#/business/goals');
    await type('model');
    expect(within(settings()).getByRole('link', { name: 'AI settings, in Connections' }).getAttribute('href')).toBe('#/connections/ai');
  });

  it('every page is listed at rest, Go or no go, Your rules, Old chats and Reports too; Your CA only on the CA firm playbook', async () => {
    await start('#/business/goals');
    const names = within(settings()).getAllByRole('link').map((a) => a.textContent);
    for (const name of ['Go or no go', 'Your rules', 'Old chats', 'Reports']) expect(names).toContain(name);
    expect(names).not.toContain('Your CA');
  });

  it('a CA firm lists Your CA under Money', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    await start('#/business/goals', { engine });
    await waitFor(() => expect(within(settings()).getByRole('link', { name: 'Your CA' }).getAttribute('href')).toBe('#/business/ca'));
  });
});

describe('Settings on a phone', () => {
  it('#/business is the list alone, with no page of its own', async () => {
    await start('#/business', { narrow: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(groups()).toEqual(['Business', 'Work', 'Money', 'Safety']);
    expect(screen.queryByRole('heading', { level: 1, name: 'How the work is done' })).toBeNull();
  });

  it('#/business/prices is Prices alone, with a Settings link back and no list', async () => {
    await start('#/business/prices', { narrow: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Prices' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();
    const back = document.querySelector('main [data-settings-back]')!;
    expect(back.textContent).toBe('Settings');
    expect(back.getAttribute('href')).toBe('#/business');
  });
});
