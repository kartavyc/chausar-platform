import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';
import { assertInkRules } from '../helpers/ink-rules';

// Chat states (wave 6, package 6G1, D42): a chat's head offers Pin, Snooze (presets the engine works out) and Settle,
// each with Undo; a chat that waits for the owner cannot be snoozed or settled; snoozed chats sit at the end of the list;
// settled chats leave it for Settled chats in the business menu, where the owner reopens them and picks the quiet days.

const NOW = '2026-10-23T10:00:00.000Z';

async function start(hash: string) {
  window.location.hash = hash;
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
  const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
  const spy = vi.spyOn(fake, 'request');
  render(<App client={fake} language="en" />);
  return { spy };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p);
const chatList = () => screen.getByRole('navigation', { name: 'Your chats' });

describe('a chat\'s head: Pin, Snooze and Settle, each with Undo', () => {
  it('Snooze offers the engine\'s presets; picking one moves the chat to Snoozed, and Undo puts it back', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-titles');
    const snooze = await within(await screen.findByRole('group', { name: 'Chat actions' })).findByRole('button', { name: 'Snooze' });
    await act(async () => { fireEvent.click(snooze); });
    const menu = await screen.findByRole('group', { name: 'Snooze until' });
    const presets = within(menu).getAllByRole('button');
    expect(presets.map((button) => button.querySelector('[data-preset]')!.textContent)).toEqual(['In 3 hours', 'Tomorrow', 'Next Monday']);
    expect(presets.every((button) => button.querySelector('time')?.getAttribute('dateTime'))).toBe(true);
    await act(async () => { fireEvent.click(presets[1]!); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state')).toEqual([{ threadId: 'chiefthread-titles', state: 'snoozed', preset: 'tomorrow' }]);
    const status = await screen.findByRole('status', { name: 'Chat change' });
    expect(status.textContent).toContain('Snoozed until 24 Oct 2026, 9:00 am. It comes back early if it needs you.');
    await waitFor(() => expect(within(chatList()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today', 'Last week', 'Snoozed']));
    await act(async () => { fireEvent.click(within(status).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state').at(-1)).toEqual({ threadId: 'chiefthread-titles', state: 'active' });
    await waitFor(() => expect(screen.getByRole('status', { name: 'Chat change' }).textContent).toContain('Back in your chats.'));
    await waitFor(() => expect(within(chatList()).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Today', 'This week', 'Last week']));
    assertInkRules(document.body);
  });

  it('Settle takes the chat out of the list into Settled chats; Reopen shows on its head; Undo brings it back', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-trailer');
    const actions = await screen.findByRole('group', { name: 'Chat actions' });
    await waitFor(() => expect(within(chatList()).getByRole('link', { name: '1 old chat' })).toBeTruthy());
    await act(async () => { fireEvent.click(within(actions).getByRole('button', { name: 'Move to old chats' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state')).toEqual([{ threadId: 'chiefthread-trailer', state: 'settled' }]);
    expect((await screen.findByRole('status', { name: 'Chat change' })).textContent).toContain('Moved to old chats. It stays there until you open it again.');
    await waitFor(() => expect(within(chatList()).queryByText('@Editor cut a short trailer for episode 14')).toBeNull());
    const link = within(chatList()).getByRole('link', { name: '2 old chats' });
    expect(link.getAttribute('href')).toBe('#/business/chats');
    await waitFor(() => expect(within(screen.getByRole('group', { name: 'Chat actions' })).getByRole('button', { name: 'Reopen' })).toBeTruthy());
    await act(async () => { fireEvent.click(within(screen.getByRole('status', { name: 'Chat change' })).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state').at(-1)).toEqual({ threadId: 'chiefthread-trailer', state: 'active' });
    await waitFor(() => expect(within(chatList()).getByText('@Editor cut a short trailer for episode 14')).toBeTruthy());
  });

  it('a chat that waits for the owner: Snooze and Settle are locked, say why, and ask the engine nothing', async () => {
    const { spy } = await start('#/chats?thread=chiefthread-billed');
    const actions = await screen.findByRole('group', { name: 'Chat actions' });
    await settle();
    const snooze = within(actions).getByRole('button', { name: 'Snooze' });
    const settleButton = within(actions).getByRole('button', { name: 'Move to old chats' });
    expect(snooze.getAttribute('aria-disabled')).toBe('true');
    expect(settleButton.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { fireEvent.click(settleButton); });
    expect(screen.getByText('This chat is waiting for you. Answer it or decide its step first.')).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Snooze until' })).toBeNull();
    expect(calls(spy, 'venture.chief.thread.state')).toEqual([]);
  });
});

describe('Settled chats (Business, from the business menu)', () => {
  it('lists the settled chats with why; Reopen with Undo; the quiet days with Undo', async () => {
    const { spy } = await start('#/business/chats');
    expect(await screen.findByRole('heading', { level: 1, name: 'Old chats' })).toBeTruthy();
    const list = await screen.findByRole('list', { name: 'Old chats' });
    const row = within(list).getByRole('listitem');
    const open = within(row).getByRole('link', { name: 'Which offer should the channel page lead with?' });
    expect(open.getAttribute('href')).toBe('#/chats?thread=chiefthread-offer');
    expect(within(row).getByText('Moved here on 18 Oct after 7 quiet days')).toBeTruthy();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Reopen' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state')).toEqual([{ threadId: 'chiefthread-offer', state: 'active' }]);
    const status = await screen.findByRole('status', { name: 'Chat change' });
    expect(status.textContent).toContain('Back in your chats.');
    await waitFor(() => expect(screen.getByText('No old chats. A chat moves here after its quiet days, or when you move it.')).toBeTruthy());
    await act(async () => { fireEvent.click(within(status).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state').at(-1)).toEqual({ threadId: 'chiefthread-offer', state: 'settled' });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Old chats' })).getByText('You moved it here on 23 Oct')).toBeTruthy());

    const days = screen.getByRole('combobox', { name: 'Move quiet chats to old chats' }) as HTMLSelectElement;
    expect(days.value).toBe('7');
    expect([...days.options].map((option) => option.textContent)).toEqual(['After 3 quiet days', 'After 7 quiet days', 'After 14 quiet days', 'After 30 quiet days', 'Never']);
    await act(async () => { fireEvent.change(days, { target: { value: '0' } }); });
    await settle();
    expect(calls(spy, 'venture.chief.settle.set')).toEqual([{ days: 0 }]);
    const said = screen.getByRole('status', { name: 'Chat change' });
    expect(said.textContent).toContain('Chats never settle on their own.');
    await act(async () => { fireEvent.click(within(said).getByRole('button', { name: 'Undo' })); });
    await settle();
    expect(calls(spy, 'venture.chief.settle.set').at(-1)).toEqual({ days: 7 });
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Move quiet chats to old chats' }) as HTMLSelectElement).value).toBe('7'));
    assertInkRules(document.body);
  });

  it('Settings lists Old chats, under Work (C1: the business menu leads to Settings)', async () => {
    await start('#/business/goals');
    const nav = await screen.findByRole('navigation', { name: 'Settings' });
    expect(within(nav).getByRole('link', { name: 'Old chats' }).getAttribute('href')).toBe('#/business/chats');
  });
});

describe('Old chats from the Chats list (C1 task 12)', () => {
  async function startWith(settled: 'none' | 'empty') {
    window.location.hash = '#/chats';
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    const fake = createFakeClient(new FakeEngine({ now: () => NOW }));
    const request = fake.request.bind(fake);
    vi.spyOn(fake, 'request').mockImplementation((async (method: string, params?: unknown) => {
      const answer = await request(method as never, params as never) as Record<string, unknown>;
      if (method !== 'venture.chief.threads') return answer;
      return settled === 'none' ? { ...answer, settled: [] } : { ...answer, groups: [], settled: [] };
    }) as typeof fake.request);
    render(<App client={fake} language="en" />);
    await settle();
  }

  it('with chats and none settled, the list head links to Old chats in Settings', async () => {
    await startWith('none');
    const link = await within(chatList()).findByRole('link', { name: 'Old chats' });
    expect(link.getAttribute('href')).toBe('#/business/chats');
  });

  it('with no chat ever, there is no link', async () => {
    await startWith('empty');
    await waitFor(() => expect(within(chatList()).getByText(/./, { selector: 'p' })).toBeTruthy());
    expect(within(chatList()).queryByRole('link', { name: /old chat/i })).toBeNull();
  });
});

/* One-shot C4 task 8: "Pick a time" sends the instant of the owner's own day and time; a time already past shows the
 * engine's refusal in place. The business is in India, so 9:00 am on 24 October is 03:30 UTC on any computer. */
describe('Snooze: Pick a time (C4 task 8)', () => {
  async function openPick() {
    const { spy } = await start('#/chats?thread=chiefthread-titles');
    const snooze = await within(await screen.findByRole('group', { name: 'Chat actions' })).findByRole('button', { name: 'Snooze' });
    await act(async () => { fireEvent.click(snooze); });
    await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'Pick a time' })); });
    const form = screen.getByRole('form', { name: 'Pick a time' });
    return { spy, form };
  }

  it('9:00 am tomorrow in Asia/Kolkata is sent as its instant', async () => {
    const { spy, form } = await openPick();
    fireEvent.change(within(form).getByLabelText('Day'), { target: { value: '2026-10-24' } });
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '09:00' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Snooze' })); });
    await settle();
    expect(calls(spy, 'venture.chief.thread.state')).toEqual([{ threadId: 'chiefthread-titles', state: 'snoozed', until: '2026-10-24T03:30:00.000Z' }]);
    expect((await screen.findByRole('status', { name: 'Chat change' })).textContent).toContain('Snoozed until 24 Oct 2026, 9:00 am.');
  });

  it('a time already past shows the engine\'s refusal in place', async () => {
    const { form } = await openPick();
    fireEvent.change(within(form).getByLabelText('Day'), { target: { value: '2026-10-22' } });
    fireEvent.change(within(form).getByLabelText('Time'), { target: { value: '09:00' } });
    await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Snooze' })); });
    await settle();
    expect(within(form).getByRole('alert').textContent).toBe('Pick a time that is still ahead.');
  });
});
