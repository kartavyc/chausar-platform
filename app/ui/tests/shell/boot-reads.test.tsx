// 15 Nov 2026 (the first walk of the built Windows app): at every start the window asked the engine for business data
// before any business was open (venture.get, queue.list, chief.threads and 15 more), and each was refused VAULT_LOCKED.
// The app's frame is mounted, hidden, while the start-up check runs, and each of its places asked at once. Now what
// the frame asks about a business waits for the check's answer (engine/reads.ts holdBusinessReads): with a business open
// it goes out then, in the order asked; with none it is never sent. A business that is already open still comes up
// with one mount and nothing asked twice, and a business that is locked later still says so.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { createStatusStore } from '../../src/engine/client';
import type { EngineClient } from '../../src/engine/types';

afterEach(() => { cleanup(); window.location.hash = ''; });

/** The client, with every request and how it ended kept: [method, 'ok' or the refusal's code]. */
function watched(engine: FakeEngine) {
  const raw = createFakeClient(engine);
  const asked: [string, string][] = [];
  const request = ((method: string, params?: unknown) => {
    const entry: [string, string] = [method, 'waiting'];
    asked.push(entry);
    const sent = (raw.request as (method: string, params?: unknown) => Promise<unknown>)(method, params);
    sent.then(() => { entry[1] = 'ok'; }, (error: { code?: string }) => { entry[1] = error?.code ?? 'failed'; });
    return sent;
  }) as EngineClient['request'];
  const client = new Proxy(raw, { get: (target, property, receiver) => (property === 'request' ? request : Reflect.get(target, property, receiver)) });
  return { client, asked, refused: () => asked.filter(([, how]) => how === 'VAULT_LOCKED').map(([method]) => method) };
}
const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe('the first screen asks for no business data', () => {
  it('a computer with no business: the first run shows and nothing was refused VAULT_LOCKED', async () => {
    const w = watched(new FakeEngine({ fresh: true }));
    render(<App client={w.client} language="en" />);
    await screen.findByRole('heading', { level: 1 });
    await settle();
    expect(w.refused()).toEqual([]);
    const business = w.asked.map(([method]) => method).filter((method) => /^venture\.(get|queue|chief|layout|owner|goals|away|delivery|journal|ideas|apps|feedback|runs|team|notify|books)\b/.test(method));
    expect(business).toEqual([]);
  });

  it('a locked business: Welcome back asks for its passphrase, and nothing was refused VAULT_LOCKED on the way', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.lock', {});
    const w = watched(engine);
    render(<App client={w.client} language="en" />);
    await screen.findByRole('heading', { name: 'Welcome back' });
    await settle();
    expect(w.refused()).toEqual([]);
  });

  it('an open business comes up as before: the frame is there at once, and its reads go out once, after the check', async () => {
    const w = watched(new FakeEngine());
    window.location.hash = '#/today';
    render(<App client={w.client} language="en" />);
    // The frame is mounted with the first render, as it always was: nothing waits to be drawn.
    expect(document.querySelector('nav')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('main#main h1')).not.toBeNull());
    await settle();
    expect(w.refused()).toEqual([]);
    const methods = w.asked.map(([method]) => method);
    expect(methods[0]).toBe('app.preferences.get');
    expect(methods.indexOf('workspace.status')).toBeLessThan(methods.indexOf('venture.get'));
    // One mount: each of these reads went out once, not once hidden and once shown.
    for (const once of ['venture.get', 'venture.team.list', 'venture.notify.list']) expect(methods.filter((method) => method === once).length, once).toBe(1);
    expect(w.asked.find(([method]) => method === 'venture.get')?.[1]).toBe('ok');
  });

  // Found by the screenshot walk on 15 Nov 2026: the development app runs in React's strict mode, which mounts, unmounts
  // and mounts again. The unmount refused everything the hidden frame had asked, so with a business open Today said
  // "Couldn't load what needs you: This business is closed. Open it first." and the walk's own cases could not run.
  it('in strict mode an open business still comes up: nothing the frame asked is refused as closed', async () => {
    const w = watched(new FakeEngine());
    window.location.hash = '#/today';
    render(<React.StrictMode><App client={w.client} language="en" /></React.StrictMode>);
    await screen.findByRole('heading', { level: 1 });
    await settle();
    expect(screen.queryByText(/This business is closed/)).toBeNull();
    await waitFor(() => expect(w.asked.some(([method, how]) => method === 'venture.queue.list' && how === 'ok')).toBe(true));
  });

  it('a business that opens by itself: nothing is refused, and what the hidden frame asked is answered once it is open', async () => {
    const engine = new FakeEngine({ only: ['lumen'] });
    await engine.request('workspace.lock', {});
    // The one business here, closed (a restart, not the owner's own close), opening with this computer: the check opens it.
    (engine as unknown as { closedByOwner: boolean }).closedByOwner = false;
    const w = watched(engine);
    window.location.hash = '#/today';
    render(<App client={w.client} language="en" />);
    await waitFor(() => expect(w.asked.find(([method]) => method === 'venture.get')?.[1]).toBe('ok'));
    await settle();
    expect(w.refused()).toEqual([]);
    const methods = w.asked.map(([method]) => method);
    expect(methods.indexOf('workspace.open')).toBeLessThan(methods.indexOf('venture.get'));
    expect(methods.filter((method) => method === 'venture.get').length).toBe(1);
  });

  // Found on the first real run on this Mac (15 Nov 2026): the list of businesses could not be read (the folder was
  // reached through a link), so the check failed after the engine had already said no business is open. What the
  // hidden places had asked was then sent after all, and refused.
  it('the check fails after the engine said no business is open: what waited is not sent', async () => {
    const w = watched(new FakeEngine({ fresh: true }));
    const client = new Proxy(w.client, { get: (target, property, receiver) => (property === 'request'
      ? (method: string, params?: unknown) => (method === 'workspace.list' ? Promise.reject(Object.assign(new Error('Vault paths cannot traverse symbolic links or files.'), { code: 'UNSAFE_PATH' })) : (target.request as (method: string, params?: unknown) => Promise<unknown>)(method, params))
      : Reflect.get(target, property, receiver)) }) as EngineClient;
    render(<App client={client} language="en" />);
    await waitFor(() => expect(document.querySelector('[data-boot]')).toBeNull());
    await settle();
    expect(w.asked.map(([method]) => method)).toContain('workspace.status');
    expect(w.asked.map(([method]) => method).filter((method) => /^venture\.(get|queue\.list|chief\.threads|layout\.get|owner\.get|goals\.get)$/.test(method))).toEqual([]);
    // The app is on screen now with no business behind it (the check failed), so a read a place starts later is the
    // engine's to refuse; of the eighteen that waited, none was sent.
    expect(w.refused().length).toBeLessThanOrEqual(1);
  });

  it('a business locked later still says so: the refusal reaches the place that asked', async () => {
    const engine = new FakeEngine();
    const w = watched(engine);
    window.location.hash = '#/today';
    render(<App client={w.client} language="en" />);
    await waitFor(() => expect(document.querySelector('main#main h1')).not.toBeNull());
    await settle();
    // Locked behind the window's back (another window, say): the next read is refused, and it is not swallowed.
    await engine.request('workspace.lock', {});
    await expect(w.client.request('venture.get', {} as never)).rejects.toMatchObject({ code: 'VAULT_LOCKED' });
  });

  // 15 Nov 2026 (the installed Windows build): the desktop now opens its window before the engine has started. The page
  // begins as usual, then hears "starting"; what it asked is waiting in the desktop. It says "Chausar is starting." on
  // an otherwise empty window, asks nothing about a business, and goes on by itself once the engine is up.
  describe('a window opened before the engine has started', () => {
    function slowStart(engine: FakeEngine) {
      const w = watched(engine);
      const status = createStatusStore({ state: 'ok' });
      let up: () => void = () => {};
      const started = new Promise<void>((resolve) => { up = resolve; });
      const sent: string[] = [];
      const client = new Proxy(w.client, { get: (target, property, receiver) => {
        if (property === 'transport') return 'desktop';
        if (property === 'status') return () => status.get();
        if (property === 'onStatus') return (listener: Parameters<typeof status.subscribe>[0]) => status.subscribe(listener);
        // The desktop holds each request until the engine has started.
        if (property === 'request') return (method: string, params?: unknown) => { sent.push(method); return started.then(() => (target.request as (method: string, params?: unknown) => Promise<unknown>)(method, params)); };
        return Reflect.get(target, property, receiver);
      } }) as EngineClient;
      return { w, client, status, up, sent };
    }

    it('says Chausar is starting with nothing else on screen, then shows the first run, and nothing is refused', async () => {
      const { w, client, status, up, sent } = slowStart(new FakeEngine({ fresh: true }));
      const { container } = render(<App client={client} language="en" />);
      await act(async () => { status.set({ state: 'starting' }); });
      expect((await screen.findByRole('status')).textContent).toBe('Chausar is starting.');
      await settle();
      // The app's frame stays hidden behind the line: no rail and no place with nothing behind them.
      expect(container.querySelector('[data-boot]')).not.toBeNull();
      expect(sent.filter((method) => method.startsWith('venture.'))).toEqual([]);
      up();
      await act(async () => { status.set({ state: 'ok' }); });
      await screen.findByRole('heading', { level: 1, name: 'Connect your AI' }, { timeout: 4000 });
      await settle();
      expect(w.refused()).toEqual([]);
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('with a business open, the app comes up once the engine is up, each read asked once', async () => {
      const { w, client, status, up } = slowStart(new FakeEngine());
      window.location.hash = '#/today';
      render(<App client={client} language="en" />);
      await act(async () => { status.set({ state: 'starting' }); });
      await settle();
      up();
      await act(async () => { status.set({ state: 'ok' }); });
      await waitFor(() => expect(w.asked.find(([method]) => method === 'venture.get')?.[1]).toBe('ok'));
      await waitFor(() => expect(document.querySelector('[data-boot]')).toBeNull());
      await settle();
      expect(w.refused()).toEqual([]);
      expect(w.asked.filter(([method]) => method === 'venture.get').length).toBe(1);
    });
  });
});
