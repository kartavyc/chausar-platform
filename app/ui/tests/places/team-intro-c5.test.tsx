import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 1: Team introduces each agent once, with the engine's code-written line, until Got it.
describe('Team introduces each agent once', () => {
  it('shows one line per agent not met, and after Got it they stay gone on a reload', async () => {
    window.location.hash = '#/team';
    const engine = new FakeEngine({ newTeam: true });
    const client = createFakeClient(engine);
    render(<App client={client} language="en" />);
    const intro = await screen.findByRole('region', { name: 'New on your team' });
    const lines = within(intro).getAllByRole('listitem').map((item) => item.textContent);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((line) => !/^Keeper\b/.test(line ?? ''))).toBe(true);
    await act(async () => { fireEvent.click(within(intro).getByRole('button', { name: 'Got it' })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByRole('region', { name: 'New on your team' })).toBeNull();
    cleanup();
    render(<App client={createFakeClient(engine)} language="en" />);
    await screen.findByRole('heading', { level: 1, name: 'Team' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByRole('region', { name: 'New on your team' })).toBeNull();
  });

  it('a team already met shows no lines', async () => {
    window.location.hash = '#/team';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    await screen.findByRole('heading', { level: 1, name: 'Team' });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(screen.queryByRole('region', { name: 'New on your team' })).toBeNull();
  });
});
