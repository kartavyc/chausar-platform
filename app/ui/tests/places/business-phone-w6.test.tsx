// Wave 6 packages 6F6 and 6F7 (D35) on Business > Notifications, on this computer: Telegram alerts from the owner's own
// bot (count only by default, titles opt-in, a test alert, remove) and phone access (a one-time pairing link with its QR
// code, stop). Both sit in closed folds under "How alerts reach you", so the page at rest stays within its words. Every
// state shown is the engine's answer, in its words; the hosted app shows neither.
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const NOW = '2026-10-23T13:35:00.000Z';
// Built at runtime: no string shaped like a real bot token sits in the source.
const TOKEN = ['4815', '16234'].join('') + ':' + 'Fx'.repeat(9) + 'q'.repeat(17);

function start(options: { hosted?: boolean } = {}) {
  window.location.hash = '#/business/notifications';
  const client = createFakeClient(new FakeEngine({ now: () => NOW, hosted: options.hosted ?? false }));
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
    fireEvent.click(within(fold).getByRole('button', { name: 'Remove bot' }));
    await within(fold).findByText('No Telegram bot is set. Alerts can go to your own bot as a count only.');
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
    fireEvent.click(within(fold).getByRole('button', { name: 'Stop phone access' }));
    await waitFor(() => expect(said(calls, 'venture.phone.access')).toContainEqual({ action: 'stop' }));
    await within(fold).findByText('Phone access is off. Make a pairing link to open Chausar on your phone.');
    assertInkRules(document.body);
  });

  it('the hosted app shows neither', async () => {
    start({ hosted: true });
    const section = await reach();
    await waitFor(() => expect(within(section).queryByText('Telegram alerts')).toBeNull());
    expect(within(section).queryByText('Phone access')).toBeNull();
  });
});
