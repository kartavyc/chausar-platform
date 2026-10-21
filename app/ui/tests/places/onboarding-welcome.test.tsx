import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import type { EngineClient, Transport } from '../../src/engine/types';

/** The fake engine behind a client that writes down every request. */
function start(options: FakeOptions, { transport, before }: { transport?: Transport; before?: (engine: FakeEngine) => Promise<void> } = {}) {
  window.location.hash = '#/today';
  const engine = new FakeEngine(options);
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = {
    ...fake,
    transport: transport ?? fake.transport,
    request: ((method: string, params?: Record<string, unknown>) => {
      calls.push([method, structuredClone(params ?? {})]);
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  return {
    engine, calls,
    async show() { if (before) await before(engine); render(<App client={client} language="en" />); },
  };
}

const opened = (calls: [string, Record<string, unknown>][]) => calls.filter(([m]) => m === 'workspace.open').map(([, p]) => p);
const list = () => screen.findByRole('list', { name: 'Businesses on this computer' });

describe('Welcome back: businesses on this computer, none open', () => {
  it('lists them quietly; choosing one opens it and shows the app with that business', async () => {
    const { calls, show } = start({ closed: true });
    await show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Welcome back' })).toBeTruthy();
    const names = within(await list()).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(['Lumen Studio', 'Ledgerline', 'Sitara EventsOpens with its passphrase']);
    expect(screen.queryByRole('navigation', { name: 'Places' })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ledgerline' })); });
    await screen.findByRole('navigation', { name: 'Places' });
    expect(opened(calls)).toEqual([{ folder: 'ledgerline' }]);
    await waitFor(() => expect(screen.getByRole('button', { name: /Ledgerline/ }).textContent).toContain('AI-native CA firm'));
  });

  it('a business that opens with its passphrase says so and asks for nothing here', async () => {
    const { calls, show } = start({ closed: true });
    await show();
    const sitara = await screen.findByRole('button', { name: /Sitara Events/ });
    await act(async () => { fireEvent.click(sitara); });
    expect(screen.getByText("Sitara Events opens with its passphrase. Asking for it here isn't built yet.").getAttribute('role')).toBe('status');
    expect(opened(calls)).toEqual([]);
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
  });

  it('opens the only business by itself when it opens with this computer', async () => {
    const { calls, show } = start({ closed: true, only: ['lumen'] });
    await show();
    await screen.findByRole('navigation', { name: 'Places' });
    expect(opened(calls)).toEqual([{ folder: 'lumen' }]);
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
  });

  it('never opens by itself a business the owner closed, nor one that needs its passphrase', async () => {
    const closedByOwner = start({ only: ['lumen'] }, { before: async (engine) => { await engine.request('workspace.lock'); } });
    await closedByOwner.show();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(opened(closedByOwner.calls)).toEqual([]);
  });

  it('never opens a passphrase business by itself', async () => {
    const { calls, show } = start({ closed: true, only: ['sitara'] });
    await show();
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
    expect(opened(calls)).toEqual([]);
  });

  it('starting another business goes to the one-sentence start, with a way back', async () => {
    const { show } = start({ closed: true });
    await show();
    const another = await screen.findByRole('button', { name: 'Start another business' });
    await act(async () => { fireEvent.click(another); });
    expect(await screen.findByRole('textbox', { name: 'What do you want to start?' })).toBeTruthy();
    const back = await screen.findByRole('button', { name: 'Back to your businesses' });
    await act(async () => { fireEvent.click(back); });
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('on hosted, the account\'s businesses open by their id', async () => {
    const { calls, show } = start({ closed: true, hosted: true }, { transport: 'hosted' });
    await show();
    const lumen = await screen.findByRole('button', { name: 'Lumen Studio' });
    await act(async () => { fireEvent.click(lumen); });
    await screen.findByRole('navigation', { name: 'Places' });
    expect(opened(calls)).toEqual([{ businessId: 'lumen' }]);
  });
});
