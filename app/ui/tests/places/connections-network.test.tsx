import { describe, expect, it } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// Connections, "Your network" (Ink v2 wave 4, package 4D4): one card per kind of file the owner imported, each with its
// honest mode (Reads, from a file you import: nothing is fetched), how many people it gave and when it came in, from
// venture.network.sources. With nothing imported it says so and points to the Network tab.

async function start(prepare?: (engine: FakeEngine) => Promise<unknown>) {
  window.location.hash = '#/connections';
  const engine = new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' });
  await prepare?.(engine);
  render(<App client={createFakeClient(engine)} language="en" />);
  return (await screen.findByRole('heading', { level: 2, name: 'Your network' }, { timeout: 4000 })).closest('section') as HTMLElement;
}
const settle = () => act(async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

describe('Connections: Your network', () => {
  it('one card per imported kind with its honest mode, its count and date line, and the old-file line', async () => {
    const tile = await start();
    await waitFor(() => expect(tile.querySelectorAll('[data-network-source]').length).toBe(4));
    const cards = [...tile.querySelectorAll<HTMLElement>('[data-network-source]')];
    expect(cards.map((card) => card.getAttribute('data-network-source'))).toEqual(['linkedin-connections', 'vcard', 'calendar-ics', 'mail-headers']);
    const vcard = cards[1]!;
    expect(within(vcard).getByText('Phone contacts')).toBeTruthy();
    expect(within(vcard).getByText('Reads')).toBeTruthy();
    expect(within(vcard).getByText('4 people, imported 10 Aug 2026.')).toBeTruthy();
    expect(within(vcard).getByText('Imported 2 months ago. Export a new copy to catch new contacts.')).toBeTruthy();
    expect(within(tile).getByRole('link', { name: 'Import in Clients' }).getAttribute('href')).toBe('#/clients/network');
  });

  it('a business with nothing imported says so', async () => {
    const tile = await start((engine) => engine.request('workspace.open', { folder: 'ledgerline' }));
    await settle();
    await waitFor(() => expect(within(tile).getByText('Nothing imported yet.')).toBeTruthy());
    expect(tile.querySelectorAll('[data-network-source]').length).toBe(0);
  });
});
