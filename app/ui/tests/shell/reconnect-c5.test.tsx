// C5 task 29: while the desktop restarts its worker the status line waits quietly, a refused request changes nothing, and
// once the worker is back the start-up check runs again, since a new worker has no business open.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { createEngineClient, type ChausarBridge } from '../../src/engine/client';
import { StatusLine } from '../../src/parts/StatusLine';
import { BootScreen } from '../../src/places/onboarding/BootScreen';
import type { EngineStatus } from '../../src/engine/types';

describe('task 29: reconnecting', () => {
  it('the desktop says reconnecting; a refused request leaves it, and ready ends it', async () => {
    let push: ((status: { healthy: boolean; state: string }) => void) | undefined;
    const bridge: ChausarBridge = { request: vi.fn(async () => { throw Object.assign(new Error('Chausar is reconnecting. Try again in a moment.'), { code: 'ENGINE_UNAVAILABLE' }); }), onEngineStatus: (callback) => { push = callback; return () => {}; } };
    const client = createEngineClient({ bridge });
    push!({ healthy: false, state: 'reconnecting' });
    expect(client.status()).toEqual({ state: 'reconnecting' });
    await expect(client.request('workspace.status', {} as never)).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(client.status()).toEqual({ state: 'reconnecting' });
    push!({ healthy: true, state: 'ready' });
    expect(client.status()).toEqual({ state: 'ok' });
  });

  it('the line waits, not alarms', () => {
    render(<TextProvider language="en"><StatusLine status={{ state: 'reconnecting' }} transport="desktop" /></TextProvider>);
    expect(screen.getByRole('status').textContent).toMatch('Reconnecting to Chausar...');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('once the worker is back, the start-up check runs again', async () => {
    let state: EngineStatus = { state: 'ok' };
    const listeners = new Set<(status: EngineStatus) => void>();
    const client = Object.assign(createFakeClient(new FakeEngine()), { status: () => state, onStatus: (listener: (status: EngineStatus) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } });
    const request = vi.spyOn(client, 'request');
    const set = (next: EngineStatus) => { state = next; act(() => { for (const listener of listeners) listener(next); }); };
    render(<TextProvider language="en"><EngineProvider client={client}><BootScreen status={null}>{() => <p>The app</p>}</BootScreen></EngineProvider></TextProvider>);
    await waitFor(() => expect(request).toHaveBeenCalledWith('workspace.status', {}));
    await act(async () => { await Promise.resolve(); });
    const checks = () => request.mock.calls.filter(([method]) => method === 'workspace.status').length;
    const before = checks();
    set({ state: 'reconnecting' });
    expect(checks()).toBe(before);
    set({ state: 'ok' });
    await waitFor(() => expect(checks()).toBeGreaterThan(before));
  });
});
