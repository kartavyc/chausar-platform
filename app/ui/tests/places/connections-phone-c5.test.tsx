import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
    // While the engine listens for a phone, the row offers Stop; pressed, the code goes and the engine is off.
    fireEvent.click(within(row).getByRole('button', { name: 'Stop phone access' }));
    await waitFor(() => expect(within(row).queryByRole('button', { name: 'Stop phone access' })).toBeNull());
    expect(within(row).queryByRole('img')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Pair your phone' })).toBeTruthy();
  });

  // Found on the real app, 16 November 2026: a link made earlier left the engine listening with no Stop anywhere.
  it('opened while phone access is on, the row says so in the engine words and offers Stop, without the code', async () => {
    window.location.hash = '#/connections';
    const now = '2026-11-06T10:00:00.000Z';
    const engine = new FakeEngine({ now: () => now });
    await createFakeClient(engine).request('venture.phone.access', { action: 'link', via: 'wifi' });
    render(<ClockProvider now={() => new Date(now)}><App client={createFakeClient(engine)} language="en" /></ClockProvider>);
    const row = await screen.findByRole('region', { name: 'Your phone' });
    await within(row).findByText('Phone access is on: a pairing link is waiting and no phone is paired. It turns off by itself when the link runs out.');
    expect(within(row).queryByRole('img')).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: 'Stop phone access' }));
    await within(row).findByText('Use Chausar on your phone over this Wi-Fi.');
    expect(within(row).queryByRole('button', { name: 'Stop phone access' })).toBeNull();
    expect((await createFakeClient(engine).request('venture.phone.access', {})).on).toBe(false);
  });
});
