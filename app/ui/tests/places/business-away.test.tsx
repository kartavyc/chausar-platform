import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * The business menu's Pause all, Stop all and Away, and the Away page (W4 package 4F3; catalogue O4). Pause all and
 * Stop all ask a second time; Stop all says how many runs stop. The Away page shows the engine's code-built list and a
 * reply the owner pastes into their own mail app: Chausar sends nothing.
 */

type Call = { method: string; params: unknown };

async function start(hash: string, before?: (engine: FakeEngine) => Promise<unknown>) {
  window.location.hash = hash;
  const engine = new FakeEngine({ now: () => '2026-10-23T08:00:00.000Z' });
  await before?.(engine);
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => { calls.push({ method, params }); return request(method, params as never); }) as typeof client.request;
  render(<ClockProvider now={() => new Date('2026-10-23T13:30:00.000+05:30')}><App client={client} language="en" /></ClockProvider>);
  await screen.findByRole('heading', { level: 1 });
  return { engine, calls };
}

const settle = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); }); await settle(); };
const of = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.params);
const openMenu = async () => {
  await click(screen.getAllByRole('button', { name: /Switch business/ })[0]!);
  return screen.getByRole('dialog', { name: /Lumen Studio/ });
};

describe('The business menu: Pause all, Stop all, Away', () => {
  it('lists Pause all, Stop all and Away; Pause all asks once more, then says what the engine did', async () => {
    const { calls } = await start('#/today');
    const menu = await openMenu();
    expect(within(menu).getByRole('button', { name: 'Pause all' })).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Stop all' })).toBeTruthy();
    expect(within(menu).getByRole('link', { name: 'Away' }).getAttribute('href')).toBe('#/business/away');
    await click(within(menu).getByRole('button', { name: 'Pause all' }));
    expect(of(calls, 'venture.business.pause')).toEqual([]);
    const ask = within(menu).getByRole('group', { name: 'Pause all? No new work starts until you unpause. Runs already going finish the step in progress, then wait until you unpause.' });
    expect(document.activeElement).toBe(within(ask).getByRole('button', { name: 'Not now' }));
    await click(within(ask).getByRole('button', { name: 'Pause all' }));
    expect(of(calls, 'venture.business.pause')).toEqual([{ paused: true }]);
    expect(await within(menu).findByText('Paused. No new work starts until you unpause.')).toBeTruthy();
    // The focus goes back to the menu item, which now reads Unpause; the engine's paused line shows under it.
    expect(document.activeElement).toBe(within(menu).getByRole('button', { name: 'Unpause' }));
    expect(within(menu).getByText('Paused by you. No new work starts until you unpause.')).toBeTruthy();
    await click(within(menu).getByRole('button', { name: 'Unpause' }));
    expect(of(calls, 'venture.business.pause')).toEqual([{ paused: true }, { paused: false }]);
    expect(await within(menu).findByText('Unpaused. Stopped runs stay stopped until you resume them.')).toBeTruthy();
  });

  it("Stop all asks once more, then says how many runs stopped with the engine's own count", async () => {
    const { calls } = await start('#/today');
    await settle();
    const menu = await openMenu();
    await click(within(menu).getByRole('button', { name: 'Stop all' }));
    const ask = await within(menu).findByRole('group', { name: 'Stop all? 3 runs stop, and no new work starts until you unpause. Finished steps are kept.' });
    await click(within(ask).getByRole('button', { name: 'Stop all' }));
    expect(of(calls, 'venture.business.pause')).toEqual([{ paused: true, stopRunning: true }]);
    expect(await within(menu).findByText('Paused. 3 runs are stopping or stopped.')).toBeTruthy();
  });

  it('reads Paused from the engine after a reload: the menu offers Unpause, not Pause all', async () => {
    await start('#/today', (engine) => engine.request('venture.business.pause', { paused: true }));
    const menu = await openMenu();
    expect(await within(menu).findByRole('button', { name: 'Unpause' })).toBeTruthy();
    expect(within(menu).queryByRole('button', { name: 'Pause all' })).toBeNull();
  });
});

describe('Business > Away', () => {
  it("sets the days away and shows the engine's list and a reply to paste, with Copy", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { calls } = await start('#/business/away');
    expect(screen.getByRole('heading', { level: 1, name: 'Away' })).toBeTruthy();
    expect(await screen.findByText('You are not away. Set the days you will be away and Chausar lists what falls due.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('First day away'), { target: { value: '2026-10-28' } });
    fireEvent.change(screen.getByLabelText('Last day away'), { target: { value: '2026-11-05' } });
    await click(screen.getByRole('button', { name: 'Set the days' }));
    expect(of(calls, 'venture.away.set')).toEqual([{ from: '2026-10-28', to: '2026-11-05' }]);
    expect(await screen.findByText(/^Away from 28 Oct 2026 to 05 Nov 2026\./)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Keeps running' })).toBeTruthy();
    expect(screen.getByText('While you are away, no new work starts on its own. Routines you set prepare runs that wait for you on Today.')).toBeTruthy();
    // The engine's line says how many wait; the page does not say it twice. The list names the client.
    expect(screen.getAllByText(/things? waits? for you/).length).toBe(1);
    expect(screen.getByText(/'s payment for .+ is due\./)).toBeTruthy();
    expect(screen.getByText('Backups of this business')).toBeTruthy();
    const reply = screen.getByRole('region', { name: 'A reply for your own mail app' });
    expect(within(reply).getByText('Chausar sends nothing. Copy this into the auto-reply of your own mail app.')).toBeTruthy();
    const quoted = reply.querySelector('[data-content]')!;
    expect(quoted.textContent).toContain('I am away from 28 Oct 2026 to 05 Nov 2026 and back on 06 Nov 2026.');
    await click(within(reply).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('I am away from 28 Oct 2026'));
    expect(await within(reply).findByText('Copied')).toBeTruthy();
    assertInkRules();
  });

  it('says what the engine refused, in its words', async () => {
    await start('#/business/away');
    await screen.findByText(/You are not away/);
    fireEvent.change(screen.getByLabelText('First day away'), { target: { value: '2026-10-30' } });
    fireEvent.change(screen.getByLabelText('Last day away'), { target: { value: '2026-10-28' } });
    await click(screen.getByRole('button', { name: 'Set the days' }));
    expect(await screen.findByText(/The first day away comes before the last\./)).toBeTruthy();
  });

  it('is one of the business pages', async () => {
    await start('#/business/away');
    const pages = screen.getByRole('navigation', { name: /pages/i });
    expect(within(pages).getByRole('link', { name: 'Away' }).getAttribute('href')).toBe('#/business/away');
  });
});
