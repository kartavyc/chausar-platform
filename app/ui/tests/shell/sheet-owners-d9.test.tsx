import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { BASE_SHEETS, SHEET_OWNERS, type SheetComponent } from '../../src/shell/sheets';
import { sheetsFor, type PlaceModule } from '../../src/shell/places';

const state = vi.hoisted(() => ({ sheets: {} as Record<string, SheetComponent> }));
vi.mock('../../src/shell/places', async (original) => ({
  ...await original<typeof import('../../src/shell/places')>(),
  SHEETS: new Proxy({}, { get: (_target, key) => state.sheets[String(key)] }),
}));
const modules = import.meta.glob<PlaceModule>('../../src/places/*/index.tsx', { eager: true });
afterEach(() => vi.restoreAllMocks());
describe('D9 sheet owners', () => {
  it('lists every exported sheet exactly once with no base or invented kind', () => {
    const actual: Record<string, string> = {};
    for (const [path, module] of Object.entries(modules)) {
      for (const kind of Object.keys(module.sheets ?? {})) {
        expect(actual[kind], kind).toBeUndefined();
        expect(BASE_SHEETS[kind], kind).toBeUndefined();
        actual[kind] = path.split('/').at(-2)!;
      }
    }
    expect(SHEET_OWNERS).toEqual(actual);
  });
  it.each(['money', 'today'])('a deep link from %s loads an invoice through its Money owner', async (place) => {
    let finish!: (module: PlaceModule) => void;
    const load = vi.fn(() => new Promise<PlaceModule>(resolve => { finish = resolve; }));
    state.sheets = sheetsFor('lazy', { '../places/money/index.tsx': load });
    window.location.hash = `#/${place}?sheet=invoice:inv-0038`;
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    expect(document.querySelector('[data-chunk-loading]')).not.toBeNull();
    await act(async () => { await Promise.resolve(); });
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => { finish(modules['../../src/places/money/index.tsx']!); });
    expect(await screen.findByRole('complementary', { name: 'INV-0038' })).toBeTruthy();
  });
  it('an unknown kind still uses the shell unknown sheet without loading a place', async () => {
    const load = vi.fn<() => Promise<PlaceModule>>();
    state.sheets = sheetsFor('lazy', { '../places/money/index.tsx': load });
    window.location.hash = '#/today?sheet=unknown:missing';
    render(<App client={createFakeClient(new FakeEngine())} language="en" />);
    expect(await screen.findByRole('complementary', { name: "This can't be shown here." })).toBeTruthy();
    expect(load).not.toHaveBeenCalled();
  });
});
