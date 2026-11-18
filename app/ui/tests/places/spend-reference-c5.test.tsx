import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 15: one press takes the dated reference rate; the limits then name its source and day. Since fix round 4
// (real-app problem 12) a rupee business already uses it until the owner types a rate, so it is offered only in place of
// the owner's own rate.
async function open(engine: FakeEngine) {
  window.location.hash = '#/money/spend';
  render(<App client={createFakeClient(engine)} language="en" />);
  const settings = await waitFor(() => screen.getByRole('button', { name: 'Change' }).closest('section') as HTMLElement);
  return settings;
}
const offer = 'Use the reference rate of 5 Nov 2026: ₹94.3996 per US dollar';

describe('Spend settings: the reference rate', () => {
  it('offers the dated figure in place of the owner\'s own rate, and uses it', async () => {
    const engine = new FakeEngine({ now: () => '2026-11-06T11:00:00.000Z' });
    const settings = await open(engine);
    await within(settings).findByText('₹83.50 per $1 (your rate, set 15 Oct 2026)');
    await act(async () => { fireEvent.click(within(settings).getByRole('button', { name: 'Change' })); });
    await act(async () => { fireEvent.click(within(settings).getByRole('button', { name: offer })); });
    await within(settings).findByText('₹94.40 per $1 (FBIL reference rate of 5 Nov 2026)');
    // In use now, so it is not offered again.
    await act(async () => { fireEvent.click(within(settings).getByRole('button', { name: 'Change' })); });
    expect(within(settings).queryByRole('button', { name: offer })).toBeNull();
  });

  it('a rupee business with no rate of its own already uses it, named with its source and day, so nothing is offered', async () => {
    const engine = new FakeEngine({ now: () => '2026-11-06T11:00:00.000Z' });
    await engine.request('venture.spend.policy.set', { inrPerUsd: null });
    const settings = await open(engine);
    await within(settings).findByText('₹94.40 per $1 (FBIL reference rate of 5 Nov 2026)');
    await act(async () => { fireEvent.click(within(settings).getByRole('button', { name: 'Change' })); });
    expect(within(settings).queryByRole('button', { name: offer })).toBeNull();
    // The field shows the exact figure in use; saved as it stands, it stays the reference rate.
    expect((within(settings).getByLabelText('Rupees per US dollar') as HTMLInputElement).value).toBe('94.3996');
  });
});
