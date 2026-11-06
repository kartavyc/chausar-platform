import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { createFakeClient, FakeEngine } from '../../src/engine/fake';
import { placesFor, prefetchPlaces, type PlaceModule } from '../../src/shell/places';

const state = vi.hoisted(() => ({ places: {} as Record<string, PlaceModule> }));
vi.mock('../../src/shell/places', async (original) => ({
  ...await original<typeof import('../../src/shell/places')>(),
  PLACES: new Proxy({}, { get: (_target, key) => state.places[String(key)] }),
}));
const Today = () => <h1>The loaded page</h1>;
function open(load: () => Promise<PlaceModule>) {
  state.places = placesFor('lazy', { '../places/today/index.tsx': load });
  return render(<App client={createFakeClient(new FakeEngine())} language="en" />);
}
beforeEach(() => { window.location.hash = '#/today'; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); delete document.documentElement.dataset.motion; });
describe('D9 lazy places', () => {
  it('keeps the shell visible while a still placeholder waits for the page', async () => {
    let finish!: (module: PlaceModule) => void;
    const load = vi.fn(() => new Promise<PlaceModule>(resolve => { finish = resolve; }));
    open(load);
    expect(document.querySelector('nav')).not.toBeNull();
    expect(document.querySelector('[data-chunk-loading][aria-busy="true"]')).not.toBeNull();
    expect(document.querySelector('main h1')).toBeNull();
    await act(async () => { await Promise.resolve(); finish({ Place: Today }); });
    expect(await screen.findByRole('heading', { name: 'The loaded page' })).toBeTruthy();
    expect(document.querySelector('[data-chunk-loading]')).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('a rejected chunk shows owner words and Try again actually loads again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const load = vi.fn<() => Promise<PlaceModule>>().mockRejectedValueOnce(new Error('private chunk URL')).mockResolvedValue({ Place: Today });
    open(load);
    expect(await screen.findByText("This page didn't load.")).toBeTruthy();
    expect(screen.queryByText('private chunk URL')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Try again$/ }));
    expect(await screen.findByRole('heading', { name: 'The loaded page' })).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('the placeholder remains still with owner motion off', async () => {
    document.documentElement.dataset.motion = 'off';
    open(() => new Promise<PlaceModule>(() => undefined));
    await waitFor(() => expect(document.querySelector('[data-chunk-loading] [data-skeleton]')).not.toBeNull());
    expect(document.querySelector('[data-chunk-loading] h1')).toBeNull();
    expect(document.querySelector('[data-chunk-loading] [data-arrived]')).toBeNull();
  });
});

it('prefetches only navigation places once, after paint and an idle callback', async () => {
  let paint!: FrameRequestCallback, idle!: IdleRequestCallback;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { paint = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('requestIdleCallback', vi.fn((callback: IdleRequestCallback) => { idle = callback; return 2; }));
  vi.stubGlobal('cancelIdleCallback', vi.fn());
  const names = ['today', 'chats', 'team', 'work', 'clients', 'money', 'apps', 'connections', 'business', 'onboarding', 'approve'];
  const loaders = Object.fromEntries(names.map(name => [`../places/${name}/index.tsx`, vi.fn(async () => ({ Place: Today }))]));
  const stop = prefetchPlaces(loaders);
  expect(Object.values(loaders).every(load => load.mock.calls.length === 0)).toBe(true);
  paint(0);
  expect(Object.values(loaders).every(load => load.mock.calls.length === 0)).toBe(true);
  idle({ didTimeout: false, timeRemaining: () => 50 });
  await act(async () => { await Promise.resolve(); });
  for (const name of names) expect(loaders[`../places/${name}/index.tsx`]).toHaveBeenCalledTimes(['business', 'onboarding', 'approve'].includes(name) ? 0 : 1);
  stop();
  const stopAgain = prefetchPlaces(loaders);
  paint(1); idle({ didTimeout: false, timeRemaining: () => 50 });
  await act(async () => { await Promise.resolve(); });
  expect(loaders['../places/money/index.tsx']).toHaveBeenCalledTimes(1);
  stopAgain();
});
