import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

function start(hash = '#/today', language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine());
  const view = render(<App client={client} language={language} />);
  return { client, ...view };
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

describe('shell', () => {
  it('shows the rail with the business, six places and the needs-you count, and says the data is a sample', async () => {
    start();
    const nav = screen.getByRole('navigation', { name: 'Places' });
    await waitFor(() => expect(within(nav).getByText('Lumen Studio')).toBeTruthy());
    expect(within(nav).getByText('YouTube channel · switch')).toBeTruthy();
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/team', '#/work', '#/clients', '#/money', '#/connections']);
    expect(links[0]!.getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(links[0]!.textContent).toMatch(/^Today12, 12 need you$/));
    expect(screen.getByRole('status').textContent).toBe('Sample data. Nothing here is real.');
  });

  it('moves between places by the address', async () => {
    start();
    await go('#/team');
    expect(screen.getByRole('heading', { level: 1, name: 'Team' })).toBeTruthy();
    expect(within(screen.getByRole('navigation')).getByRole('link', { name: 'Team' }).getAttribute('aria-current')).toBe('page');
    await go('#/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Today' })).toBeTruthy();
  });

  it('opens a run beside the page, focuses its title, and Esc returns focus to the row that opened it', async () => {
    start();
    const opener = await screen.findByRole('button', { name: 'Cutting shorts from episode 13' });
    opener.focus();
    await act(async () => { fireEvent.click(opener); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary', { name: 'Cutting shorts from episode 13' });
    expect(window.location.hash).toBe('#/today?sheet=run%3A31');
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole('heading', { level: 2 })));
    expect(screen.getByRole('main').contains(opener)).toBe(true);
    await act(async () => { fireEvent.keyDown(document.activeElement!, { key: 'Escape' }); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('shows a receipt from the address, and says so for a sheet nobody provides', async () => {
    start('#/money?sheet=receipt:R-0415');
    const sheet = await screen.findByRole('complementary', { name: 'R-0415' });
    await waitFor(() => expect(sheet.textContent).toContain('₹30,000.00'));
    await go('#/money?sheet=nobody:mehta');
    expect(await screen.findByRole('complementary', { name: "This can't be shown here." })).toBeTruthy();
  });

  it('switches business from the business menu', async () => {
    start();
    const button = await screen.findByRole('button', { name: /Lumen Studio/ });
    fireEvent.click(button);
    const menu = await screen.findByRole('group', { name: 'Business menu for Lumen Studio' });
    const ledgerline = await within(menu).findByRole('button', { name: 'Ledgerline' });
    expect(within(menu).getByRole('button', { name: /Lumen Studio/ }).hasAttribute('disabled')).toBe(true);
    expect(within(menu).getByText('Locked')).toBeTruthy();
    await act(async () => { fireEvent.click(ledgerline); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Ledgerline/ }).textContent).toContain('AI-native CA firm · switch'));
    expect(screen.queryByRole('group', { name: /Business menu/ })).toBeNull();
  });

  it('decides a row on Today against the engine and shrinks it to its receipt line', async () => {
    start();
    const row = (await screen.findByText('Which title for episode 15?')).closest('li')!;
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Later' })); });
    await waitFor(() => expect(screen.getByText(/Moved to later/)).toBeTruthy());
  });

  it('speaks Hindi when asked', async () => {
    start('#/today', 'hi');
    expect(await screen.findByRole('heading', { level: 1, name: 'आज' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /टीम/ })).toBeTruthy();
  });
});
