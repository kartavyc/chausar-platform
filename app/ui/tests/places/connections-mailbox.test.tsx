import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

// Connections: the read-only mailbox and the calendar's private address (Ink v2 wave 4, package 4E4, from the
// engine's 4E3). The app password never outlives the click (W1's U15 rule): outside any form, autocomplete off, and
// cleared in a finally. An account that allows only Google or Microsoft sign-in cannot connect this way. Both are
// desktop only: the hosted app says so.

type Fake = ReturnType<typeof createFakeClient>;

async function start(options: { client?: (fake: Fake) => EngineClient } = {}) {
  window.location.hash = '#/connections';
  const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const spy = vi.spyOn(fake, 'request');
  render(<App client={options.client ? options.client(fake) : fake} language="en" />);
  return { spy };
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method) as [string, unknown][];
/** The mailbox card with its form opened (simple first: the form is one step away, behind Connect your mailbox). */
const mailbox = async () => {
  const card = await screen.findByRole('region', { name: 'Your mailbox' });
  const open = within(card).queryByRole('button', { name: 'Connect your mailbox' });
  if (open) await act(async () => { fireEvent.click(open); });
  return card;
};
const calendarCard = async () => {
  const card = await screen.findByRole('region', { name: 'Your calendar' });
  const open = within(card).queryByRole('button', { name: 'Add the address' });
  if (open) await act(async () => { fireEvent.click(open); });
  return card;
};
const type = (element: HTMLElement, value: string) => fireEvent.change(element, { target: { value } });

describe('Connections: the mailbox', () => {
  it('the app password field is outside any form, autocomplete off, and says it is kept only while the app is open', async () => {
    await start();
    const card = await mailbox();
    const password = within(card).getByLabelText('App password') as HTMLInputElement;
    expect(password.type).toBe('password');
    expect(password.getAttribute('autocomplete')).toBe('off');
    expect(password.closest('form')).toBeNull();
    expect(card.textContent).toContain("Make one in your mail account's security settings. Chausar keeps it only while the app is open.");
    expect(card.querySelector('[data-oauth-line]')?.textContent).toBe("An account that allows only Google or Microsoft sign-in can't connect this way. Record replies by hand instead.");
    expect(card.textContent).toContain('It never sends mail or marks it read.');
    assertInkRules(document.body);
  });

  it('an OAuth-only account is refused in the engine words, and the password is cleared all the same', async () => {
    const { spy } = await start();
    const card = await mailbox();
    type(within(card).getByLabelText('Mail server'), 'outlook.office365.com');
    type(within(card).getByLabelText('Your mail address'), 'owner@lumen.example');
    type(within(card).getByLabelText('App password'), 'abcd efgh ijkl mnop');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Connect read-only' })); });
    await settle();
    expect(calls(spy, 'venture.mailbox.connect').at(-1)![1]).toEqual({ host: 'outlook.office365.com', port: 993, user: 'owner@lumen.example', appPassword: 'abcd efgh ijkl mnop' });
    expect(within(card).getByRole('alert').textContent).toBe("This account only allows Google or Microsoft sign-in, so it can't connect this way. Use an app password, or keep recording replies by hand.");
    expect((within(card).getByLabelText('App password') as HTMLInputElement).value).toBe('');
  });

  it('connects read-only, shows the engine line and last read, reads new mail, and disconnects after a second ask', async () => {
    const { spy } = await start();
    const card = await mailbox();
    type(within(card).getByLabelText('Mail server'), 'imap.zoho.in');
    type(within(card).getByLabelText('Your mail address'), 'owner@lumen.example');
    type(within(card).getByLabelText('App password'), 'abcd efgh ijkl mnop');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Connect read-only' })); });
    await settle();
    expect(card.querySelector('[data-mailbox-line]')?.textContent).toBe('Reading owner@lumen.example on imap.zoho.in, read-only. Not read yet. Chausar never sends mail or marks it read.');
    // The form is gone once connected, so the password is not on the page at all.
    expect(within(card).queryByLabelText('App password')).toBeNull();
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Read new mail' })); });
    await settle();
    expect(calls(spy, 'venture.mailbox.sync')).toHaveLength(1);
    expect(within(card).getByText('2 new messages from people you know: 2 need you on Today.')).toBeTruthy();
    expect(card.querySelector('[data-mailbox-line]')?.textContent).toMatch(/Last read 23 Oct 2026 at 15:30\./);
    fireEvent.click(within(card).getByRole('button', { name: 'Disconnect' }));
    expect(calls(spy, 'venture.mailbox.disconnect')).toHaveLength(0);
    await act(async () => { fireEvent.click(within(within(card).getByText(/Chausar stops reading this mailbox/).parentElement!).getByRole('button', { name: 'Disconnect' })); });
    await settle();
    expect(calls(spy, 'venture.mailbox.disconnect')).toHaveLength(1);
    expect(card.querySelector('[data-mailbox-line]')?.textContent).toBe('Disconnected. Mail Chausar already read stays with your pipeline; nothing more is read.');
  });

  it('on the hosted app the mailbox and calendar say they are desktop only, and offer nothing', async () => {
    await start({ client: (fake) => ({ ...fake, transport: 'hosted' }) });
    const card = await screen.findByRole('region', { name: 'Your mailbox' });
    expect(within(card).queryByRole('button', { name: 'Connect your mailbox' })).toBeNull();
    expect(card.querySelector('[data-desktop-only]')?.textContent).toBe('Connect your mailbox in the desktop app. It reads your mail on your computer.');
    expect(within(card).queryByLabelText('App password')).toBeNull();
    const calendar = await screen.findByRole('region', { name: 'Your calendar' });
    expect(calendar.querySelector('[data-desktop-only]')).not.toBeNull();
  });
});

describe('Connections: the calendar address', () => {
  it('keeps the private address out of any form, reads it, says so in the engine words, and can remove it', async () => {
    const { spy } = await start();
    const card = await calendarCard();
    const url = within(card).getByLabelText('Private address') as HTMLInputElement;
    expect(url.closest('form')).toBeNull();
    expect(url.getAttribute('autocomplete')).toBe('off');
    type(url, 'https://calendar.google.com/calendar/ical/owner/private-abc/basic.ics');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Read my calendar' })); });
    await settle();
    expect(calls(spy, 'venture.network.calendar').at(-1)![1]).toEqual({ url: 'https://calendar.google.com/calendar/ical/owner/private-abc/basic.ics' });
    // Once read, the field closes: the private address is not left on the page.
    expect(within(card).queryByLabelText('Private address')).toBeNull();
    expect(card.querySelector('[data-calendar-line]')?.textContent).toBe('Read just now: 1 call with people you know lately or today.');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Remove' })); });
    await settle();
    expect(calls(spy, 'venture.network.calendar').at(-1)![1]).toEqual({ url: '' });
    await waitFor(() => expect(card.querySelector('[data-calendar-line]')?.textContent).toBe('No calendar address. Chausar reads no calendar.'));
  });

  it('a refused address says the engine words', async () => {
    await start();
    const card = await calendarCard();
    type(within(card).getByLabelText('Private address'), 'http://example.in/cal.ics');
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Read my calendar' })); });
    await settle();
    expect(within(card).getByRole('alert').textContent).toBe("Use your calendar's private address, the one that starts with https:// or webcal:// and ends in .ics.");
  });
});

describe('Connections: the mailbox and calendar read on load (from the network sources)', () => {
  it('a mailbox and an address set before the page opened show their state, with no password or address on the page', async () => {
    window.location.hash = '#/connections';
    const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
    await fake.request('venture.mailbox.connect', { host: 'imap.zoho.in', port: 993, user: 'owner@lumen.example', appPassword: 'abcd efgh ijkl mnop' });
    await fake.request('venture.network.calendar', { url: 'https://calendar.google.com/calendar/ical/owner/private-abc/basic.ics' });
    render(<App client={fake} language="en" />);
    const card = await screen.findByRole('region', { name: 'Your mailbox' });
    await waitFor(() => expect(card.querySelector('[data-mailbox-line]')?.textContent).toBe('Reading owner@lumen.example on imap.zoho.in, read-only. Not read yet. Chausar never sends mail or marks it read.'));
    expect(within(card).getByRole('button', { name: 'Read new mail' })).toBeTruthy();
    const calendar = await screen.findByRole('region', { name: 'Your calendar' });
    expect(calendar.querySelector('[data-calendar-line]')?.textContent).toBe('Read just now: 1 call with people you know lately or today.');
    expect(calendar.querySelector('[data-next-read]')?.textContent).toMatch(/^Next read /);
    expect(document.body.textContent).not.toContain('abcd efgh');
    expect(document.body.textContent).not.toContain('private-abc');
  });
});

describe('Connections: after a restart the mailbox asks for its password again', () => {
  it('shows the password field in place of Read new mail when the engine says the password left its shelf', async () => {
    window.location.hash = '#/connections';
    const fake = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
    const base = fake.request.bind(fake) as (m: string, p?: unknown) => Promise<unknown>;
    fake.request = (async (m: string, p?: unknown) => {
      const answer = await base(m, p);
      if (m !== 'venture.network.sources') return answer;
      return {
        ...(answer as object),
        mailbox: { connected: true, host: 'imap.zoho.in', user: 'owner@lumen.example', lastSync: '2026-10-22T10:00:00.000Z', line: 'Chausar keeps your app password only while the app is open. Type it again under Connections to read new mail.', needsPassword: true },
      };
    }) as EngineClient['request'];
    render(<App client={fake} language="en" />);
    const card = await screen.findByRole('region', { name: 'Your mailbox' });
    await waitFor(() => expect(within(card).getByLabelText('App password')).toBeTruthy());
    expect(within(card).queryByRole('button', { name: 'Read new mail' })).toBeNull();
    expect((within(card).getByLabelText('Mail server') as HTMLInputElement).value).toBe('imap.zoho.in');
    expect(card.querySelector('[data-mailbox-line]')?.textContent).toContain('Type it again under Connections');
  });
});
