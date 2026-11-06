import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 15: one press takes the dated reference rate; the limits then name its source and day.
describe('Spend settings: the reference rate', () => {
  it('offers the dated figure and uses it', async () => {
    const engine = new FakeEngine({ now: () => '2026-11-06T11:00:00.000Z' });
    await engine.request('venture.spend.policy.set', { inrPerUsd: null });
    window.location.hash = '#/money/spend';
    render(<App client={createFakeClient(engine)} language="en" />);
    const settings = await waitFor(() => screen.getByRole('button', { name: 'Change' }).closest('section') as HTMLElement);
    await act(async () => { fireEvent.click(within(settings).getByRole('button', { name: 'Change' })); });
    const use = within(settings).getByRole('button', { name: 'Use the reference rate of 5 Nov 2026: ₹94.3996 per US dollar' });
    await act(async () => { fireEvent.click(use); });
    await within(settings).findByText(/FBIL reference rate of 5 Nov 2026/);
  });
});
