import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { Progress, WaitLine } from '../../src/parts/Progress';
import { TextProvider } from '../../src/text';
import type { EngineClient } from '../../src/engine/types';
import { cssOf } from '../helpers/css';

/**
 * One-shot C3 task 11: long work shows its steps, a still arc on the current one with elapsed time as text, a tick on a
 * done one and a failed one in words. Long kinds offer Keep working. Nothing spins, nothing loops.
 */
afterEach(() => { vi.useRealTimers(); delete document.documentElement.dataset.motion; });

const page = (client: EngineClient, node: ReactNode) => <EngineProvider client={client}><TextProvider language="en">{node}</TextProvider></EngineProvider>;
const NOW = new Date('2026-11-06T10:00:00.000Z');

async function started(kind: 'improve' | 'about', engine = new FakeEngine()) {
  vi.useFakeTimers({ now: NOW });
  const client = createFakeClient(engine);
  render(page(client, <Progress kind={kind} active landsAt="The result lands on Practice." />));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return engine;
}
const frame = (step: string, state: 'current' | 'done' | 'failed', at: string) =>
  ({ type: 'work.step' as const, businessId: 'lumen', workId: 'w1', kind: 'improve' as const, step, state, at });

describe('Progress', () => {
  it('lists the steps up front and draws nothing when nothing runs', async () => {
    await started('improve');
    expect(screen.getByText('Reading reviewed drafts')).toBeTruthy();
    expect(screen.getByText('Comparing')).toBeTruthy();
    vi.useRealTimers();
  });

  it('the current step shows its elapsed time as text, "1 min 20 s" at 80 s, also under reduced motion', async () => {
    document.documentElement.dataset.motion = 'off';
    const engine = await started('improve');
    await act(async () => { engine.emit(frame('read', 'current', NOW.toISOString())); });
    expect(document.querySelector('[data-arc]')).not.toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(80_000); });
    expect(screen.getByText('1 min 20 s')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.getByText('1 min 21 s')).toBeTruthy();
  });

  it('a done frame swaps the mark; a failed step says so in words', async () => {
    const engine = await started('improve');
    await act(async () => { engine.emit(frame('read', 'current', NOW.toISOString())); });
    const row = screen.getByText('Reading reviewed drafts').closest('li')!;
    expect(row.dataset.state).toBe('current');
    await act(async () => { engine.emit(frame('read', 'done', NOW.toISOString())); });
    expect(row.dataset.state).toBe('done');
    expect(row.querySelector('[data-arc]')).toBeNull();
    await act(async () => { engine.emit(frame('write', 'failed', NOW.toISOString())); });
    expect(screen.getByText('Writing new instructions').closest('li')!.dataset.state).toBe('failed');
    expect(screen.getByText('Writing new instructions').closest('li')!.textContent).toMatch(/Stopped|Failed/);
  });

  it('Keep working for long kinds only, and it says where the result lands', async () => {
    await started('improve');
    expect(screen.getByRole('link', { name: 'Keep working' }).getAttribute('href')).toBe('#/today');
    expect(screen.getByText(/The result lands on Practice\./)).toBeTruthy();
    vi.useRealTimers();
  });

  it('a short kind offers no Keep working', async () => {
    await started('about');
    expect(screen.queryByRole('link', { name: 'Keep working' })).toBeNull();
    vi.useRealTimers();
  });

  it('nothing shows when nothing runs', async () => {
    const client = createFakeClient(new FakeEngine());
    render(page(client, <Progress kind="improve" />));
    await act(async () => { await Promise.resolve(); });
    expect(document.querySelector('[data-progress]')).toBeNull();
  });

  it('its CSS has no animation and no transition: the one motion is the mark’s swap', () => {
    expect(cssOf('Progress.module.css')).not.toMatch(/animation|transition/);
  });
});

describe('WaitLine', () => {
  it('a still line with elapsed time, never dots', async () => {
    vi.useFakeTimers({ now: NOW });
    render(<WaitLine label="Writing" />);
    expect(screen.getByRole('status').textContent).toBe('Writing');
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(screen.getByRole('status').textContent).toBe('Writing, 8 s');
  });
});
