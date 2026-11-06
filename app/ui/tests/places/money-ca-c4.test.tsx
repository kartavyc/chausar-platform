import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

/*
 * One-shot C4 task 24 (founder decision 2's default): Books becomes "For your CA": the page at the same address, with
 * Share with your CA at its top and Invite your accountant beside it; one sheet with two ways, Export for your CA and Make a
 * link, the second only where links work (never on the desktop); after saving, how many files, which folder and Show in
 * folder. C1's Money More menu is not in this tree: the page stays a tab until C1 moves it.
 */

const NOW = '2026-10-21T11:00:00.000Z';

function start(hash: string, extra: Partial<EngineClient> = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => NOW });
  const client: EngineClient = { ...createFakeClient(engine), ...extra };
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
}
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const sheet = () => screen.findByRole('complementary', { name: 'Share with your CA' });

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('C4 T24: For your CA', () => {
  it('the Books page is named For your CA, at the same address, with both ways in at its top', async () => {
    start('#/money/books');
    const nav = await screen.findByRole('navigation', { name: 'Money' });
    const tab = within(nav).getByRole('link', { name: 'For your CA' });
    expect(tab.getAttribute('href')).toBe('#/money/books');
    expect(tab.getAttribute('aria-current')).toBe('page');
    expect(within(nav).queryByRole('link', { name: 'Books' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Share with your CA' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Invite your accountant' })).toBeTruthy();
  });

  it('Money at a glance no longer has its own export: the one way in is For your CA', async () => {
    start('#/money');
    await screen.findByRole('region', { name: 'AI spend this month' });
    expect(screen.queryByRole('button', { name: /Export for your CA/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Export for your CA/ })).toBeNull();
  });

  it('on the web the one sheet has two ways: Export for your CA and Make a link, saying how long a link lasts', async () => {
    start('#/money/books');
    await click(await screen.findByRole('button', { name: 'Share with your CA' }));
    const panel = await sheet();
    expect(within(panel).getByRole('heading', { name: 'Share with your CA' })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: /^Export for your CA/ })).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Make a link' })).toBeTruthy();
    expect(panel.textContent).toContain('Lasts 7 days. You can take it back.');
  });

  it('the name of the downloaded file is in owner words, and the signed receipts follow it', async () => {
    const made: Blob[] = [];
    URL.createObjectURL = vi.fn((blob: Blob) => { made.push(blob); return 'blob:export'; }) as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) { names.push(this.download); });
    start('#/money/books?sheet=accountant:books');
    const panel = await sheet();
    await click(within(panel).getByRole('button', { name: /^Export for your CA/ }));
    await waitFor(() => expect(names).toEqual(['Lumen Studio, sales, Oct 2026.csv']));
    await click(await within(panel).findByRole('button', { name: 'Download the signed receipts' }));
    expect(names[1]).toBe('Lumen Studio, receipts, Oct 2026.json');
  });

  it('on the desktop there is no link and no invite; the saved line says how many files and where, with Show in folder', async () => {
    const show = vi.fn(async () => {});
    const save = vi.fn(async () => ({ saved: true as const, name: 'Lumen Studio, sales, Oct 2026.csv', receipts: 'r.json', readme: 'm.txt', count: 3, folder: 'Documents', id: 'abc', line: 'Saved.' }));
    start('#/money/books', { saveMoneyExport: save, showSavedExport: show });
    expect(screen.queryByRole('button', { name: 'Invite your accountant' })).toBeNull();
    await click(await screen.findByRole('button', { name: 'Share with your CA' }));
    const panel = await sheet();
    expect(within(panel).queryByRole('button', { name: 'Make a link' })).toBeNull();
    await click(within(panel).getByRole('button', { name: /^Export for your CA/ }));
    expect(save).toHaveBeenCalledWith('2026-10');
    expect(await within(panel).findByText('Saved 3 files to Documents. Chausar did not send them anywhere.')).toBeTruthy();
    expect(panel.textContent).not.toMatch(/[A-Z]:\\/);
    await click(within(panel).getByRole('button', { name: 'Show in folder' }));
    expect(show).toHaveBeenCalledWith('abc');
  });

  it('a cancelled save says nothing; a month chosen in the sheet is the month saved', async () => {
    const save = vi.fn(async (_month: string) => null);
    start('#/money/books?sheet=accountant:books', { saveMoneyExport: save });
    const panel = await sheet();
    await act(async () => { fireEvent.change(within(panel).getByRole('combobox', { name: 'Month' }), { target: { value: '2026-09' } }); });
    await click(within(panel).getByRole('button', { name: /^Export for your CA/ }));
    expect(save).toHaveBeenCalledWith('2026-09');
    expect(within(panel).queryByRole('status')).toBeNull();
  });
});
