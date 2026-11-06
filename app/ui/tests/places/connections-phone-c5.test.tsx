import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// C5 task 3: Connections pairs the phone by its QR code; the minutes come from the engine's expiresAt.
describe('Connections: Your phone', () => {
  it('Pair your phone shows the code and how long it works, from the fake engine\'s expiry', async () => {
    window.location.hash = '#/connections';
    const now = '2026-11-06T10:00:00.000Z';
    render(<ClockProvider now={() => new Date(now)}><App client={createFakeClient(new FakeEngine({ now: () => now }))} language="en" /></ClockProvider>);
    const row = await screen.findByRole('region', { name: 'Your phone' });
    expect(within(row).queryByRole('img')).toBeNull();
    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Pair your phone' })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(within(row).getByRole('img', { name: 'Code to scan with your phone' })).toBeTruthy();
    expect(row.textContent).toContain('Works for 10 minutes.');
    expect(within(row).getByRole('button', { name: 'Make a new code' })).toBeTruthy();
  });
});
