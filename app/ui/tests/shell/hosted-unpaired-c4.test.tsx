import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, EngineStatus } from '../../src/engine/types';

/**
 * One-shot C4 task 42 (138.b1, 138.w2, 138.f1): a browser that is not paired, or whose session ended, sees one screen in
 * place of the places: the logo, "Pair this browser", one line on how. No rail, no switcher, no Today error, no status line.
 */
function withStatus(first: EngineStatus) {
  const client = createFakeClient(new FakeEngine());
  let now = first;
  const listeners = new Set<() => void>();
  const shown: EngineClient = {
    ...client,
    transport: 'web',
    status: () => now,
    onStatus: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const change = (next: EngineStatus) => act(() => { now = next; for (const listener of listeners) listener(); });
  return { client: shown, change };
}

function expectPairScreen() {
  expect(screen.getByRole('heading', { level: 1, name: 'Pair this browser' })).toBeTruthy();
  expect(screen.getByText('Open Chausar on your computer and make a pairing link in Settings, Notifications, Phone access.')).toBeTruthy();
  expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Couldn't load/);
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByRole('link')).toBeNull();
}

describe('a browser that is not paired', () => {
  it('unpaired: one screen and nothing else; the engine is asked nothing', async () => {
    window.location.hash = '#/today';
    const { client } = withStatus({ state: 'unpaired' });
    const asked: string[] = [];
    const real = client.request.bind(client);
    client.request = ((method: string, params?: never) => { asked.push(method); return real(method as never, params as never); }) as EngineClient['request'];
    render(<App client={client} language="en" />);
    expectPairScreen();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(asked).toEqual([]);
  });

  it('a session that ended shows the same screen', () => {
    window.location.hash = '#/today';
    render(<App client={withStatus({ state: 'session-ended' }).client} language="en" />);
    expectPairScreen();
  });

  it('paired: the app as before; when the session ends mid-work, the screen takes over', async () => {
    window.location.hash = '#/today';
    const { client, change } = withStatus({ state: 'ok' });
    render(<App client={client} language="en" />);
    expect(await screen.findByRole('navigation', { name: 'Places' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Pair this browser' })).toBeNull();
    change({ state: 'session-ended' });
    expectPairScreen();
  });
});
