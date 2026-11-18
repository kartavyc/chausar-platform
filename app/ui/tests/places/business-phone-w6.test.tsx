// Wave 6 packages 6F6 and 6F7 (D35) on Business > Notifications, on this computer: Telegram alerts from the owner's own
// bot (count only by default, titles opt-in, a test alert, remove) and phone access (a one-time pairing link with its QR
// code, stop). Both sit in one fold under "How alerts reach you", so the page at rest stays within its words; while the
// engine says phone access is on, its words and Stop show above the fold, open or closed. Every state shown is the
// engine's answer, in its words, read again while it is on; the hosted app shows neither.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { PHONE_POLL_MS } from '../../src/engine/usePhoneAccess';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const NOW = '2026-10-23T13:35:00.000Z';
// Built at runtime: no string shaped like a real bot token sits in the source.
const TOKEN = ['4815', '16234'].join('') + ':' + 'Fx'.repeat(9) + 'q'.repeat(17);

function start(options: { hosted?: boolean; engine?: FakeEngine } = {}) {
  window.location.hash = '#/business/notifications';
  const client = createFakeClient(options.engine ?? new FakeEngine({ now: () => NOW, hosted: options.hosted ?? false }));
  const calls: [string, unknown][] = [];
  const request = client.request.bind(client);
  client.request = (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'];
  render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
  return { calls };
}
const said = (calls: [string, unknown][], method: string) => calls.filter(([m]) => m === method).map(([, p]) => p);
async function reach(): Promise<HTMLElement> {
  const heading = await screen.findByText('How alerts reach you', { selector: 'h2' });
  return heading.closest('section') as HTMLElement;
}
async function openFold(section: HTMLElement, name: string): Promise<HTMLElement> {
  // C4 task 39: one fold holds both, open by default while nothing is set up.
  const summary = await within(section).findByText('Get alerts on your phone', { selector: 'summary' });
  const fold = summary.closest('details') as HTMLDetailsElement;
  await waitFor(() => expect(fold.open).toBe(true));
  return (await within(fold).findByRole('heading', { name })).closest('section') as HTMLElement;
}

describe('Telegram alerts and phone access on this computer', () => {
  it('Telegram: saves the bot to protected storage, count only by default, titles opt-in, a test alert, remove', async () => {
    const { calls } = start();
    const fold = await openFold(await reach(), 'Telegram alerts');
    await within(fold).findByText('No Telegram bot is set. Alerts can go to your own bot as a count only.');
    const token = within(fold).getByLabelText('Bot token') as HTMLInputElement;
    expect(token.type).toBe('password');
    fireEvent.change(token, { target: { value: 'not a token' } });
    // C5 task 11: the chat id is found by Find me; typing it is the manual path, in its own fold.
    fireEvent.click(within(fold).getByText('Type the chat id yourself', { selector: 'summary' }));
    fireEvent.change(within(fold).getByLabelText('Your chat id'), { target: { value: '7000123456' } });
    fireEvent.click(within(fold).getByRole('button', { name: 'Save bot' }));
    await within(fold).findByText(/^Couldn't save: Paste the bot token BotFather gave you\./);
    fireEvent.change(token, { target: { value: TOKEN } });
    fireEvent.click(within(fold).getByRole('button', { name: 'Save bot' }));
    await within(fold).findByText('Alerts go to your Telegram bot as a count only, like "3 things wait for you".');
    expect(said(calls, 'venture.notify.telegram')).toContainEqual({ bot: { token: TOKEN, chatId: '7000123456' } });
    // The token leaves the page once saved.
    expect(token.value).toBe('');

    fireEvent.click(within(fold).getByRole('checkbox', { name: 'Add titles to alerts' }));
    await within(fold).findByText('Alerts go to your Telegram bot with the titles of what waits. Titles can name clients.');
    fireEvent.click(within(fold).getByRole('button', { name: 'Send a test alert' }));
    await within(fold).findByText('Telegram took the test alert.');
    expect(said(calls, 'venture.notify.telegram')).toContainEqual({ test: true });
    // Removing forgets the token, so it asks once first.
    fireEvent.click(within(fold).getByRole('button', { name: 'Remove bot' }));
    const ask = (await within(fold).findByText("Chausar forgets your bot's token and chat id, and alerts stop going to Telegram. To get them again, you paste the token again.")).closest('[data-second-ask]') as HTMLElement;
    expect(said(calls, 'venture.notify.telegram')).not.toContainEqual({ bot: null });
    fireEvent.click(within(ask).getByRole('button', { name: 'Remove bot' }));
    await within(fold).findByText('No Telegram bot is set. Alerts can go to your own bot as a count only.');
    expect(said(calls, 'venture.notify.telegram')).toContainEqual({ bot: null });
    assertInkRules(document.body);
  });

  it('phone access: a one-time pairing link with its QR code, then stop', async () => {
    const { calls } = start();
    const fold = await openFold(await reach(), 'Phone access');
    await within(fold).findByText('Phone access is off. Make a pairing link to open Chausar on your phone.');
    fireEvent.click(within(fold).getByRole('button', { name: 'Make a pairing link' }));
    await within(fold).findByText('Open this link on your phone within 10 minutes. It works once.');
    expect(within(fold).getByText(/^http:\/\/192\.168\.1\.20:\d+\/#pair=/)).toBeTruthy();
    expect(within(fold).getByRole('img', { name: 'Pairing link as a QR code' })).toBeTruthy();
    expect(said(calls, 'venture.phone.access')).toContainEqual({ action: 'link', via: 'wifi' });
    // The fold stays open with the link in it, and Stop sits above the fold, where it shows whatever the fold does.
    const section = await reach();
    const stop = await within(section).findByRole('button', { name: 'Stop phone access' });
    expect(within(fold).queryByRole('button', { name: 'Stop phone access' })).toBeNull();
    expect((fold.closest('details') as HTMLDetailsElement).open).toBe(true);
    assertInkRules(document.body);
    fireEvent.click(stop);
    await waitFor(() => expect(said(calls, 'venture.phone.access')).toContainEqual({ action: 'stop' }));
    await within(fold).findByText('Phone access is off. Make a pairing link to open Chausar on your phone.');
    expect(within(fold).queryByText(/#pair=/)).toBeNull();
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Stop phone access' })).toBeNull());
    assertInkRules(document.body);
  });

  // Found on the real app, 16 November 2026: with a link made, a later visit showed the fold closed and no Stop at all,
  // while the engine went on listening.
  it('phone access that is on says so and offers Stop when the page is opened later, with the fold closed', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await createFakeClient(engine).request('venture.phone.access', { action: 'link', via: 'wifi' });
    const { calls } = start({ engine });
    const section = await reach();
    await within(section).findByText('Phone access is on: a pairing link is waiting and no phone is paired. It turns off by itself when the link runs out.');
    const fold = (await within(section).findByText('Get alerts on your phone', { selector: 'summary' })).closest('details') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    // The link itself is shown only once, to whoever made it.
    expect(within(section).queryByText(/#pair=/)).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Stop phone access' }));
    await waitFor(() => expect(said(calls, 'venture.phone.access')).toContainEqual({ action: 'stop' }));
    await waitFor(() => expect(within(section).queryByRole('button', { name: 'Stop phone access' })).toBeNull());
    expect(within(section).queryByText(/^Phone access is on/)).toBeNull();
    expect((await createFakeClient(engine).request('venture.phone.access', {})).on).toBe(false);
    assertInkRules(document.body);
  });

  it('a link nobody used runs out: the page reads the engine again, and the link and Stop go', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let now = NOW;
      const engine = new FakeEngine({ now: () => now });
      const { calls } = start({ engine });
      const section = await reach();
      const fold = await openFold(section, 'Phone access');
      fireEvent.click(within(fold).getByRole('button', { name: 'Make a pairing link' }));
      await within(fold).findByText(/^http:\/\/192\.168\.1\.20:\d+\/#pair=/);
      await within(section).findByRole('button', { name: 'Stop phone access' });
      // Nine minutes on, it is still on: the page asked the engine, and the engine said so.
      now = new Date(Date.parse(NOW) + 9 * 60_000).toISOString();
      const reads = () => said(calls, 'venture.phone.access').filter((params) => JSON.stringify(params) === '{}').length;
      const before = reads();
      await act(async () => { await vi.advanceTimersByTimeAsync(PHONE_POLL_MS + 100); });
      expect(reads()).toBeGreaterThan(before);
      expect(within(fold).getByText(/#pair=/)).toBeTruthy();
      expect(within(section).getByRole('button', { name: 'Stop phone access' })).toBeTruthy();
      // The link runs out unused: the engine closes the listener, and the page says what the engine says.
      now = new Date(Date.parse(NOW) + 10 * 60_000).toISOString();
      await act(async () => { await vi.advanceTimersByTimeAsync(PHONE_POLL_MS + 100); });
      await within(fold).findByText('Phone access is off. Make a pairing link to open Chausar on your phone.');
      expect(within(fold).queryByText(/#pair=/)).toBeNull();
      expect(within(fold).queryByRole('img', { name: 'Pairing link as a QR code' })).toBeNull();
      expect(within(section).queryByRole('button', { name: 'Stop phone access' })).toBeNull();
      // Off, the page stops asking.
      const after = reads();
      await act(async () => { await vi.advanceTimersByTimeAsync(3 * PHONE_POLL_MS); });
      expect(reads()).toBe(after);
    } finally { vi.useRealTimers(); }
  });

  it('the hosted app shows neither', async () => {
    start({ hosted: true });
    const section = await reach();
    await waitFor(() => expect(within(section).queryByText('Telegram alerts')).toBeNull());
    expect(within(section).queryByText('Phone access')).toBeNull();
  });
});
