import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { CATALOGUES } from '../../src/text';

/**
 * One-shot B1 (A5 notes line 28; hands-on row 5; SCREENS shots 1 to 4): the first run's words. The stepper names steps,
 * never a state ("Using templates"); step 1 says what is sent once, in one line, with each tool's full consent behind a
 * closed "What's sent" fold; step 2 asks in plain words; the keep wait says what it does.
 */
function start(engine = new FakeEngine({ fresh: true })) {
  window.location.hash = '#/today';
  render(<App client={createFakeClient(engine)} language="en" />);
  return engine;
}
async function press(name: string | RegExp) { const button = await screen.findByRole('button', { name }, { timeout: 4000 }); await act(async () => { fireEvent.click(button); }); }

afterEach(() => { vi.restoreAllMocks(); });

describe('first run words (B1)', () => {
  it('after Skip, step 1 reads "No AI yet", and step 2 asks in plain words', async () => {
    start();
    await press('Skip for now: use templates');
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' })).toBeTruthy();
    expect(screen.getByText('Tell Chausar about your work, or pick a field.')).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Setup steps' });
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['No AI yet', '2Your work', '3Your business']);
    expect(document.body.textContent).not.toContain('Using templates');
  });

  it('step 1 says what is sent once; each signed-in tool keeps its full consent in a closed fold', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    start(engine);
    expect(await screen.findByText('Signed in', {}, { timeout: 4000 })).toBeTruthy();
    const main = screen.getByRole('main');
    expect(within(main).getAllByText("Chausar sends your idea, answers and plan to the AI you pick, never your books, keys or client details. It runs on your plan and its limits. Anything that sends, posts, pays or changes a price waits for your tap.")).toHaveLength(1);
    const fold = within(main).getByText("What's sent").closest('details')!;
    expect(fold).toBeTruthy();
    expect(fold.open).toBe(false);
    expect(fold.textContent).toContain('Chausar will run Codex on this computer');
    expect(main.textContent).not.toContain('What Chausar sends:');
  });

  it('the keep wait says what it does, in plain words', () => {
    expect(CATALOGUES.en['onboarding.step.plan']).toBe('Setting up your business from a ready-made plan.');
  });
});
