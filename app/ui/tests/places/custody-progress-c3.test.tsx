import { afterEach, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';

afterEach(() => { vi.useRealTimers(); });

it('a pending backup reports elapsed time on its button and clears it after the answer', async () => {
  const fake = createFakeClient(new FakeEngine());
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const client: EngineClient = { ...fake, request: (async (method: string, params: unknown) => {
    if (method === 'workspace.backups.create') await pending;
    return fake.request(method as never, params as never);
  }) as EngineClient['request'] };
  window.location.hash = '#/business/keep';
  const view = render(<App client={client} language="en" />);
  try {
    const button = await screen.findByRole('button', { name: 'Back up now' });
    vi.useFakeTimers();
    await act(async () => { fireEvent.click(button); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(button.textContent).toMatch(/Backing up, 2 s/);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { finish(); await vi.advanceTimersByTimeAsync(1); });
    expect(button.textContent).toBe('Back up now');
  } finally {
    finish();
    vi.useRealTimers();
    view.unmount();
  }
});