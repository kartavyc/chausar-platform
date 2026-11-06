import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

// C5 task 11: after the token, Find me reads the chat that sent /start; "Is this you: Kartavy?" and Yes saves the bot
// with that chat id. Nothing is saved before Yes.
const NOW = '2026-10-23T13:35:00.000Z';
const TOKEN = ['4815', '16234'].join('') + ':' + 'Fx'.repeat(9) + 'q'.repeat(17);

describe('Telegram: Find me', () => {
  it('finds the chat, asks Is this you, and Yes saves it', async () => {
    window.location.hash = '#/business/notifications';
    const client = createFakeClient(new FakeEngine({ now: () => NOW }));
    const calls: [string, unknown][] = [];
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => { calls.push([method, params]); return request(method as never, params as never); }) as EngineClient['request'];
    render(<ClockProvider now={() => new Date(NOW)}><App client={client} language="en" /></ClockProvider>);
    const section = (await screen.findByText('How alerts reach you', { selector: 'h2' })).closest('section') as HTMLElement;
    const fold = (await within(section).findByText('Telegram alerts', { selector: 'summary' })).closest('details') as HTMLDetailsElement;
    fold.open = true;
    fireEvent(fold, new Event('toggle'));
    await within(fold).findByText('No Telegram bot is set. Alerts can go to your own bot as a count only.');
    expect(within(fold).queryByLabelText('Your chat id')).toBeNull();
    fireEvent.change(within(fold).getByLabelText('Bot token'), { target: { value: TOKEN } });
    fireEvent.click(within(fold).getByRole('button', { name: 'Find me' }));
    await within(fold).findByText('Is this you: Kartavy?');
    expect(calls.filter(([m]) => m === 'venture.notify.telegram.findChat').map(([, p]) => p)).toEqual([{ token: TOKEN }]);
    expect(calls.filter(([m, p]) => m === 'venture.notify.telegram' && p && Object.keys(p as object).length > 0)).toEqual([]);
    fireEvent.click(within(fold).getByRole('button', { name: 'Yes, save' }));
    await within(fold).findByText('Alerts go to your Telegram bot as a count only, like "3 things wait for you".');
    expect(calls.filter(([m]) => m === 'venture.notify.telegram').map(([, p]) => p)).toContainEqual({ bot: { token: TOKEN, chatId: '7000123456' } });
  });
});
