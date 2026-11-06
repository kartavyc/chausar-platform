// D4 task 5: while the desktop starts, the status line says how far it has come, in owner words. No step counter, no fake
// percentage: the line changes only when a real phase arrives, and a request that gave up waiting shows the same waiting
// line, not the offline one.
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextProvider } from '../../src/text';
import { createEngineClient, type ChausarBridge } from '../../src/engine/client';
import { StatusLine } from '../../src/parts/StatusLine';
import type { EngineStatus } from '../../src/engine/types';

const line = (status: EngineStatus) => {
  const { unmount } = render(<TextProvider language="en"><StatusLine status={status} transport="desktop" /></TextProvider>);
  const words = screen.getByRole('status').textContent;
  unmount();
  return words;
};

describe('D4: start-up progress', () => {
  it('each phase has its line, and no phase the plain one', () => {
    expect(line({ state: 'starting' })).toMatch('Chausar is starting.');
    expect(line({ state: 'starting', phase: 'window-shown' })).toMatch('Chausar is starting.');
    expect(line({ state: 'starting', phase: 'engine-forked' })).toMatch('Starting Chausar.');
    expect(line({ state: 'starting', phase: 'loaded' })).toMatch('Opening your businesses.');
  });

  it('the client keeps the phase while starting, and ready ends it', () => {
    let push: ((status: { healthy: boolean; state: string; phase?: string }) => void) | undefined;
    const bridge: ChausarBridge = { request: vi.fn(async () => ({})), onEngineStatus: callback => { push = callback; return () => {}; } } as never;
    const client = createEngineClient({ bridge });
    push!({ healthy: false, state: 'starting' });
    expect(client.status()).toEqual({ state: 'starting' });
    push!({ healthy: false, state: 'starting', phase: 'loaded' });
    expect(client.status()).toEqual({ state: 'starting', phase: 'loaded' });
    push!({ healthy: true, state: 'ready' });
    expect(client.status()).toEqual({ state: 'ok' });
  });

  it('a request that gave up waiting shows the starting line, not the offline one, and keeps the phase it had', async () => {
    let push: ((status: { healthy: boolean; state: string; phase?: string }) => void) | undefined;
    const refused = Object.assign(new Error('Chausar is still starting. Try again in a moment.'), { code: 'ENGINE_STARTING', owner: true });
    const bridge: ChausarBridge = { request: vi.fn(async () => { throw refused; }), onEngineStatus: callback => { push = callback; return () => {}; } } as never;
    const client = createEngineClient({ bridge });
    await expect(client.request('workspace.status', {} as never)).rejects.toMatchObject({ code: 'ENGINE_STARTING' });
    expect(client.status()).toEqual({ state: 'starting' });
    push!({ healthy: false, state: 'starting', phase: 'loaded' });
    await expect(client.request('workspace.status', {} as never)).rejects.toMatchObject({ code: 'ENGINE_STARTING' });
    expect(client.status()).toEqual({ state: 'starting', phase: 'loaded' });
  });

  it('a start that failed is still the offline line', async () => {
    const bridge: ChausarBridge = { request: vi.fn(async () => { throw Object.assign(new Error('It did not start.'), { code: 'ENGINE_START_FAILED' }); }) } as never;
    const client = createEngineClient({ bridge });
    await expect(client.request('workspace.status', {} as never)).rejects.toMatchObject({ code: 'ENGINE_START_FAILED' });
    expect(client.status()).toEqual({ state: 'offline' });
  });
});
