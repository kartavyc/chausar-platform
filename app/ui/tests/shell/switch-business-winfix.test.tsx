import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { EngineProvider, useEngine, useResource } from '../../src/engine/context';
import { holdReads } from '../../src/engine/reads';
import { SWITCH_RETRY_MS, switchBusiness } from '../../src/shell/switchBusiness';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient, type VentureRunEvent } from '../../src/engine/types';

/**
 * Seen in the real app on Windows (15 Nov 2026): switching businesses could drop the owner at "Welcome back" with
 * both businesses refusing to open. The request log shows workspace.lock answering, then the window's own reads for
 * the business being left (and the reads every write sets off) arriving in the gap, and the workspace.open 0.2 s later
 * answering VAULT_BUSY. Switching is one operation now: the window stops asking before it locks, asks nothing between
 * the lock and the open, tries an open the engine calls busy again, and when it still cannot open says why on Welcome
 * back, where every business can be opened.
 */
type Call = [string, unknown];
function start(change?: (method: string, plain: () => Promise<unknown>) => Promise<unknown> | undefined) {
  window.location.hash = '#/today';
  const fake = createFakeClient(new FakeEngine());
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => {
    calls.push([method, params]);
    const plain = () => fake.request(method as never, params as never) as Promise<unknown>;
    return change?.(method, plain) ?? plain();
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { calls, client };
}
async function switchTo(name: RegExp, from = /Lumen Studio/) {
  const rail = screen.getByRole('navigation', { name: 'Places' });
  await act(async () => { fireEvent.click(await within(rail).findByRole('button', { name: from })); });
  const menu = await screen.findByRole('dialog');
  await act(async () => { fireEvent.click(await within(menu).findByRole('button', { name })); });
}
const between = (calls: Call[], first: string, second: string) => {
  const from = calls.findIndex(([method]) => method === first);
  const to = calls.findIndex(([method], index) => index > from && method === second);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return calls.slice(from + 1, to).map(([method]) => method);
};

describe('switching businesses', () => {
  it('asks the business being left for nothing once the switch starts, and nothing at all between the lock and the open', async () => {
    const { calls } = start();
    await screen.findByRole('navigation', { name: 'Places' });
    await switchTo(/Ledgerline/);
    expect(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Ledgerline/ }, { timeout: 4000 })).toBeTruthy();
    expect(between(calls, 'workspace.lock', 'workspace.open')).toEqual([]);
    // The reads after the open are the new business's own.
    const after = calls.slice(calls.findIndex(([method]) => method === 'workspace.open') + 1).map(([method]) => method);
    expect(after).toContain('venture.get');
  });

  it('an open the engine calls busy is tried again, and the owner lands in the business, never on Welcome back', async () => {
    let refused = 0;
    const { calls } = start((method) => {
      if (method !== 'workspace.open' || refused >= 2) return undefined;
      refused += 1;
      return Promise.reject(new EngineError('VAULT_BUSY', 'Chausar is opening or closing a business. Try again in a moment.'));
    });
    await screen.findByRole('navigation', { name: 'Places' });
    await switchTo(/Ledgerline/);
    // The frame is drawn again once the other business is open; the rail then names it.
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /Ledgerline/ })).toBeTruthy(), { timeout: 6000 });
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    expect(calls.filter(([method]) => method === 'workspace.open')).toHaveLength(3);
    expect(calls.filter(([method]) => method === 'workspace.lock')).toHaveLength(1);
    expect(SWITCH_RETRY_MS.length).toBeGreaterThanOrEqual(3);
  });

  it('an open that stays refused says why on Welcome back, where both businesses can be opened', async () => {
    start((method) => (method === 'workspace.open' && !screen.queryByRole('heading', { name: 'Welcome back' })
      ? Promise.reject(new EngineError('VAULT_BUSY', 'Chausar is still busy with a backup in this business. Wait for it to finish, then try again.')) : undefined));
    await screen.findByRole('navigation', { name: 'Places' });
    await switchTo(/Ledgerline/);
    expect(await screen.findByRole('heading', { name: 'Welcome back' }, { timeout: 6000 })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('still busy with a backup');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lumen Studio/ })); });
    expect(await within(await screen.findByRole('navigation', { name: 'Places' })).findByRole('button', { name: /Lumen Studio/ })).toBeTruthy();
  });

  it('a lock the engine refuses leaves the owner where they were, reading again', async () => {
    const { calls } = start((method) => (method === 'workspace.lock' ? Promise.reject(new EngineError('VAULT_BUSY', 'Chausar is still busy with a chat reply in this business. Wait for it to finish, then try again.')) : undefined));
    await screen.findByRole('navigation', { name: 'Places' });
    await switchTo(/Ledgerline/);
    expect((await screen.findByRole('alert')).textContent).toContain('still busy with a chat reply');
    expect(calls.map(([method]) => method)).not.toContain('workspace.open');
    // The reads held for the switch go on: a change in the business reaches the page again.
    const before = calls.filter(([method]) => method === 'venture.get').length;
    await act(async () => { await calls.length; });
    await waitFor(() => expect(calls.filter(([method]) => method === 'venture.get').length).toBeGreaterThanOrEqual(before));
    expect(screen.getByRole('navigation', { name: 'Places' })).toBeTruthy();
  });
});

describe('Welcome back: a business the engine calls busy for a moment still opens', () => {
  it('tries the open again instead of leaving the owner on a list where nothing opens', async () => {
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ closed: true }));
    const calls: string[] = [];
    let refused = 0;
    const client: EngineClient = { ...fake, request: ((method: string, params?: unknown) => {
      calls.push(method);
      if (method === 'workspace.open' && refused < 2) { refused += 1; return Promise.reject(new EngineError('VAULT_BUSY', 'Chausar is opening or closing a business. Try again in a moment.')); }
      return fake.request(method as never, params as never);
    }) as EngineClient['request'] };
    render(<App client={client} language="en" />);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Lumen Studio/ })); });
    await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Places' })).getByRole('button', { name: /Lumen Studio/ })).toBeTruthy(), { timeout: 6000 });
    expect(calls.filter((method) => method === 'workspace.open')).toHaveLength(3);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the read store while a business is being left (holdReads)', () => {
  function standIn() {
    const calls: { method: string; resolve: (value: unknown) => void }[] = [];
    const listeners = new Set<(event: VentureRunEvent) => void>();
    const client: EngineClient = {
      transport: 'fake',
      request: ((method: string) => new Promise((resolve) => { calls.push({ method, resolve }); })) as EngineClient['request'],
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      status: () => ({ state: 'ok' }),
      onStatus: () => () => {},
    };
    const emit = () => act(() => { for (const listener of [...listeners]) listener({ type: 'queue.changed', businessId: 'lumen', at: '2026-11-15T10:00:00.000Z' }); });
    return { client, calls, emit };
  }
  let held: ReturnType<typeof holdReads> | null = null;
  function Reader() {
    const client = useEngine();
    const venture = useResource('venture.get', {});
    return (
      <p>
        <span data-testid="name">{venture.data ? venture.data.venture.workingName : 'none'}</span>
        <button type="button" onClick={() => { held = holdReads(client); }}>hold</button>
        <button type="button" onClick={venture.reload}>reload</button>
      </p>
    );
  }
  const answer = (call: { resolve: (value: unknown) => void }, name: string) => act(async () => { call.resolve({ venture: { id: 'v', workingName: name, serviceType: null }, done: 0, total: 2 }); });

  it('sends nothing while held, whatever asks; released, it reads once; dropped, it reads nothing for the business that is gone', async () => {
    const engine = standIn();
    render(<EngineProvider client={engine.client}><Reader /></EngineProvider>);
    expect(engine.calls).toHaveLength(1);
    await answer(engine.calls[0]!, 'Lumen Studio');
    act(() => { screen.getByRole('button', { name: 'hold' }).click(); });
    engine.emit();
    engine.emit();
    act(() => { screen.getByRole('button', { name: 'reload' }).click(); });
    expect(engine.calls).toHaveLength(1);
    // What the page shows stays: no loading flash, no error.
    expect(screen.getByTestId('name').textContent).toBe('Lumen Studio');
    act(() => { held!.release(); });
    expect(engine.calls).toHaveLength(2);
    await answer(engine.calls[1]!, 'Lumen Studio');

    act(() => { screen.getByRole('button', { name: 'hold' }).click(); });
    engine.emit();
    act(() => { held!.drop(); });
    expect(engine.calls).toHaveLength(2);
    // After a drop the store reads as ever again.
    engine.emit();
    expect(engine.calls).toHaveLength(3);
  });

  it('switchBusiness holds the reads, locks, opens, and tries a busy open again', async () => {
    const sent: string[] = [];
    let opens = 0;
    const listeners = new Set<(event: VentureRunEvent) => void>();
    const client: EngineClient = {
      transport: 'fake',
      request: ((method: string) => {
        sent.push(method);
        if (method === 'workspace.open' && opens++ === 0) return Promise.reject(new EngineError('VAULT_BUSY', 'Busy.'));
        return Promise.resolve(method === 'workspace.lock' ? { locked: true } : {});
      }) as EngineClient['request'],
      subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
      status: () => ({ state: 'ok' }),
      onStatus: () => () => {},
    };
    const outcome = await switchBusiness(client, { folder: 'ledgerline' }, { wait: async () => {} });
    expect(outcome).toEqual({ opened: true });
    expect(sent).toEqual(['workspace.lock', 'workspace.open', 'workspace.open']);
  });
});
