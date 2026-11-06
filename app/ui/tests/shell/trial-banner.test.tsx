import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * The hosted trial banner (W4 4J21, from 4J23): a business started on the hosted app without an account shows, above
 * every place, the server's line "This business is temporary until you add your email." and, in its last day, the
 * server's warning; Add email asks for the address and sends the claim link (POST /api/hosted/trial/claim), which keeps
 * the business on that account. A business kept on an account, or one on this computer, shows no banner.
 */

function start(options: FakeOptions, { hosted = true }: { hosted?: boolean } = {}) {
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine(options));
  const client: EngineClient = { ...fake, transport: hosted ? 'hosted' : fake.transport };
  render(<App client={client} language="en" />);
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('the trial banner', () => {
  it('a temporary business: the server\'s line, and Add email', async () => {
    start({ trial: 'temporary' });
    const banner = await screen.findByRole('region', { name: 'Temporary business' });
    expect(banner.closest('main')).not.toBeNull();
    expect(banner.textContent).toContain('This business is temporary until you add your email.');
    expect(banner.querySelector('[data-trial-warning]')).toBeNull();
    expect(within(banner).getByRole('button', { name: 'Add email' })).toBeTruthy();
    assertInkRules();
  });

  it('in its last day, the server\'s warning too', async () => {
    start({ trial: 'ending' });
    const banner = await screen.findByRole('region', { name: 'Temporary business' });
    expect(banner.querySelector('[data-trial-warning]')?.textContent).toBe('This business will be deleted within a day unless you add your email.');
  });

  it('Add email sends the claim link to the address typed, and says to open it in this browser', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ sent: true, delivers: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    start({ trial: 'temporary' });
    const banner = await screen.findByRole('region', { name: 'Temporary business' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Add email' }));
    fireEvent.change(within(banner).getByRole('textbox', { name: 'Your email' }), { target: { value: 'owner@example.com' } });
    await act(async () => { fireEvent.click(within(banner).getByRole('button', { name: 'Send the link' })); });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/hosted/trial/claim');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(String(init.body))).toEqual({ email: 'owner@example.com' });
    expect(await within(banner).findByText('Check your email, and open the link in this browser to keep this business.')).toBeTruthy();
  });

  it('a refusal shows the server\'s words', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'LIMIT_REACHED', message: 'This business has asked for 3 links already. Use the last one.' } }), { status: 429, headers: { 'Content-Type': 'application/json' } })));
    start({ trial: 'temporary' });
    const banner = await screen.findByRole('region', { name: 'Temporary business' });
    fireEvent.click(within(banner).getByRole('button', { name: 'Add email' }));
    fireEvent.change(within(banner).getByRole('textbox', { name: 'Your email' }), { target: { value: 'owner@example.com' } });
    await act(async () => { fireEvent.click(within(banner).getByRole('button', { name: 'Send the link' })); });
    expect((await within(banner).findByRole('alert')).textContent).toBe('This business has asked for 3 links already. Use the last one.');
  });

  it("reads the hosted session's `me` (client.hostedMe), so the banner follows the server's own trial view", async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ hosted: true }));
    const trial = { temporary: true as const, line: 'This business is temporary until you add your email.', expiresAt: '2026-11-02T10:00:00.000Z', endsSoon: true, warning: 'This business will be deleted within a day unless you add your email.' };
    const hostedMe = vi.fn(async () => ({ trials: true, trial }));
    const client: EngineClient = { ...fake, transport: 'hosted', hostedMe };
    render(<App client={client} language="en" />);
    const banner = await screen.findByRole('region', { name: 'Temporary business' });
    expect(hostedMe).toHaveBeenCalled();
    expect(banner.querySelector('[data-trial-warning]')?.textContent).toBe(trial.warning);
  });

  it('no banner for a business kept on an account, or on this computer', async () => {
    start({ hosted: true });
    await screen.findByRole('heading', { level: 1 });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Temporary business' })).toBeNull());
    document.body.innerHTML = '';
    start({}, { hosted: false });
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('region', { name: 'Temporary business' })).toBeNull();
  });
});
