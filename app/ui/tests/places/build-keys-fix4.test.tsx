import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { OnlineSellerDesk } from '../../src/places/work/desks/OnlineSellerDesk';

/*
 * Fix round 4 (sample-data item 3): Settings, Website build logged React's "Encountered two children with the same key"
 * when "Save as a file" was pressed for Lovable or for Replit. A repeated key can drop or repeat a row. The test presses
 * what the tour pressed and fails on that warning, whichever list it names.
 */
const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
afterEach(() => { vi.restoreAllMocks(); });

function watchKeys() {
  const warned: string[] = [];
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { warned.push(args.map(String).join(' ')); });
  return () => warned.filter((line) => /same key|unique "key"/.test(line));
}

describe('Website build: no list repeats a key', () => {
  it('saving the brief as a file for Lovable, then for Replit, and again, logs no duplicate key', async () => {
    Object.assign(URL, { createObjectURL: () => 'blob:brief', revokeObjectURL: () => undefined });
    const repeated = watchKeys();
    window.location.hash = '#/business/build';
    const engine = new FakeEngine();
    render(<App client={createFakeClient(engine)} language="en" />);
    await screen.findByRole('button', { name: /Save as a file for Lovable/ });
    await settle();
    for (const name of [/Save as a file for Lovable/, /Save as a file for Replit/, /Save as a file for Lovable/, /Save as a file for Replit/]) {
      const button = await screen.findByRole('button', { name });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      await act(async () => { fireEvent.click(button); });
      await settle();
      expect(repeated(), String(name)).toEqual([]);
    }
    // The sample answers as the engine does: every handover has its own id, the one the sample began with included.
    const ids = (await engine.request('venture.build.status', {}) as { handoffs: { id: string }[] }).handoffs.map((handoff) => handoff.id);
    expect(ids.length).toBe(5);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

/*
 * The same warning came once on the online seller's desk: with Seller operations and Store connections both open, the
 * two sections sat side by side under one key (the chosen order's id), so React could not tell them apart.
 */
describe('Seller desk: no list repeats a key', () => {
  it('Seller operations and Store connections open together log no duplicate key, with an order chosen or none', async () => {
    for (const engine of [new FakeEngine(), new FakeEngine({ fresh: true })]) {
      const repeated = watchKeys();
      const view = render(<TextProvider language="en"><EngineProvider client={createFakeClient(engine)}><OnlineSellerDesk /></EngineProvider></TextProvider>);
      await screen.findByRole('region', { name: 'Seller desk' });
      await settle();
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Seller operations' })); });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Store connections' })); });
      await settle();
      expect(screen.getAllByRole('region', { name: /^(Seller operations|Store connections)$/ }).length).toBe(2);
      expect(repeated()).toEqual([]);
      view.unmount();
      vi.restoreAllMocks();
    }
  });
});
