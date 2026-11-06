import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { WORK_POLL_MS, useWork } from '../../src/engine/useWork';
import { TextProvider } from '../../src/text';
import type { EngineClient } from '../../src/engine/types';

/**
 * One-shot C3 task 10: the screens hear the steps. A page opened mid-job reads where it is from venture.work.list, the
 * next frames move it on, and with no push the list is read again at the poll's pace.
 */
afterEach(() => { vi.useRealTimers(); });

function Watch({ active = false, kind = 'improve' }: { active?: boolean; kind?: 'improve' | 'about' }) {
  const work = useWork(kind, { active });
  return (
    <ol data-live={work.live ? '' : undefined}>
      {work.steps.map((step) => <li key={step.id} data-state={step.state}>{step.label}</li>)}
    </ol>
  );
}
const page = (client: EngineClient, node: ReactNode) => <EngineProvider client={client}><TextProvider language="en">{node}</TextProvider></EngineProvider>;
const stateOf = (label: string) => screen.getByText(label).getAttribute('data-state');

describe('useWork', () => {
  it('draws nothing at rest and asks for nothing more', async () => {
    const client = createFakeClient(new FakeEngine());
    const spy = vi.spyOn(client, 'request');
    render(page(client, <Watch />));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('venture.work.list', {}));
    expect(document.querySelector('[data-live]')).toBeNull();
    expect(spy.mock.calls.filter(([method]) => method === 'venture.work.list')).toHaveLength(1);
  });

  it('active: the kind’s steps show before the first frame', async () => {
    const client = createFakeClient(new FakeEngine());
    render(page(client, <Watch active />));
    expect(document.querySelector('[data-live]')).not.toBeNull();
    expect(stateOf('Reading reviewed drafts')).toBe('waiting');
    expect(stateOf('Comparing')).toBe('waiting');
  });

  it('a frame moves a step on; another kind’s frame does nothing; a step mounted mid-job shows from the list', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    render(page(client, <Watch active />));
    await act(async () => {
      engine.emit({ type: 'work.step', businessId: 'lumen', workId: 'w1', kind: 'improve', step: 'read', state: 'done', at: '2026-11-06T10:00:00.000Z' });
      engine.emit({ type: 'work.step', businessId: 'lumen', workId: 'w1', kind: 'improve', step: 'write', state: 'current', at: '2026-11-06T10:00:01.000Z' });
      engine.emit({ type: 'work.step', businessId: 'lumen', workId: 'w2', kind: 'rehearse', step: 'test', state: 'done', at: '2026-11-06T10:00:01.000Z' });
    });
    expect(stateOf('Reading reviewed drafts')).toBe('done');
    expect(stateOf('Writing new instructions')).toBe('current');
    expect(stateOf('Testing them')).toBe('waiting');
  });

  it('mounting while the fake’s job runs shows the steps so far from the list', async () => {
    const engine = new FakeEngine({ workDelayMs: 300 });
    const client = createFakeClient(engine);
    const running = client.request('venture.about.read', { text: 'I tutor maths to school students on weekends.' });
    await waitFor(async () => expect((await client.request('venture.work.list', {})).work.length).toBe(1));
    render(page(client, <Watch kind="about" />));
    await waitFor(() => expect(document.querySelector('[data-live]')).not.toBeNull());
    await waitFor(() => expect(stateOf('Drafting what you sell')).toBe('done'), { timeout: 3000 });
    await running;
  });

  it('with no push, the list is read again at each poll tick while work is waited on', async () => {
    vi.useFakeTimers();
    const client = createFakeClient(new FakeEngine());
    const spy = vi.spyOn(client, 'request');
    render(page(client, <Watch active />));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const reads = () => spy.mock.calls.filter(([method]) => method === 'venture.work.list').length;
    const first = reads();
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_POLL_MS); });
    expect(reads()).toBe(first + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(WORK_POLL_MS); });
    expect(reads()).toBe(first + 2);
  });
});
