import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { NARROW } from '../../src/shell/useNarrow';

// C5 task 5: a reply written without an AI carries its next step as a button. "Connect your AI" opens Connections.
const NOW = '2026-10-23T10:00:00.000Z';
const settle = async () => { await act(async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0)); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };

function stubWidth() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === NARROW ? false : false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
}

describe('Connect your AI under a reply written without one', () => {
  it('in an agent chat, the template answer has the button, and it opens Connections', async () => {
    window.location.hash = '#/team?sheet=agent:researcher&tab=chat';
    render(<App client={createFakeClient(new FakeEngine({ now: () => NOW }))} language="en" />);
    const panel = await screen.findByRole('complementary', { name: 'Researcher' });
    await within(panel).findByRole('log');
    const box = within(panel).getByRole('textbox', { name: 'Message Researcher' });
    await act(async () => { fireEvent.change(box, { target: { value: 'How is it going?' } }); });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
    await settle();
    const button = await within(panel).findByRole('button', { name: 'Connect your AI' });
    await act(async () => { fireEvent.click(button); });
    await settle();
    expect(window.location.hash.startsWith('#/connections')).toBe(true);
  });

  it('in Chats, an answer from the records with no AI has the button; with an AI there is none', async () => {
    stubWidth();
    const engine = new FakeEngine({ now: () => NOW });
    engine.chatWithoutAi();
    window.location.hash = '#/chats';
    render(<App client={createFakeClient(engine)} language="en" />);
    const box = await screen.findByRole('textbox', { name: 'Ask Chausar' }) as HTMLTextAreaElement;
    await act(async () => { fireEvent.change(box, { target: { value: 'How is money this month?' } }); });
    await act(async () => { fireEvent.submit(box.closest('form')!); });
    await settle();
    const log = await screen.findByRole('log');
    const button = await waitFor(() => within(log).getByRole('button', { name: 'Connect your AI' }));
    await act(async () => { fireEvent.click(button); });
    await settle();
    expect(window.location.hash.startsWith('#/connections')).toBe(true);
  });
});
