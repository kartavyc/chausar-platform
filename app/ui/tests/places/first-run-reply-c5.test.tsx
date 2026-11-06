import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 6: after About you, the AI's own short reply when there is one, marked as your AI's words; with no AI, the
// fixed line as before.
const CA = "I'm a CA with six years in audit and want to do books and GST for small shops near me.";

function start(engine: FakeEngine) {
  window.location.hash = '#/today';
  render(<App client={createFakeClient(engine)} language="en" />);
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }
async function tell() {
  const box = await screen.findByRole('textbox', { name: 'Tell Chausar about your work' });
  fireEvent.change(box, { target: { value: CA } });
  await press('Send');
  return screen.findByRole('region', { name: 'Talk to Chausar' });
}

afterEach(() => { vi.restoreAllMocks(); });

describe('About you: the first reply', () => {
  it('with the AI, shows its reply marked as your AI\'s words', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    start(engine);
    await press('Use Codex');
    const chat = await tell();
    const reply = await within(chat).findByText('You work in Money and tax. I suggested offers to start; change any of them on the right.');
    expect(reply.closest('[data-by="ai"]')).not.toBeNull();
    expect(within(chat).getByText('Your AI')).toBeTruthy();
    expect(within(chat).queryByText(/Here is a first plan/)).toBeNull();
  }, 20000);

  it('with no AI, the fixed line', async () => {
    start(new FakeEngine({ fresh: true }));
    await press('Skip for now: use templates');
    const chat = await tell();
    expect(await within(chat).findByText('No AI is connected, so this plan comes from templates for Money and tax.')).toBeTruthy();
    expect(within(chat).queryByText('Your AI')).toBeNull();
  }, 20000);
});
