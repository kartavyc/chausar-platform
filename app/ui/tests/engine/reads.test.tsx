import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { EngineProvider, useResource } from '../../src/engine/context';
import { EngineError, type EngineClient, type QueueList, type VentureRunEvent } from '../../src/engine/types';

/**
 * One-shot B3 task 2: one read store per client. Two places reading the same method and params share one request and
 * one answer; an event any reader accepts loads the shared entry once; a stale reply is dropped; an error keeps the
 * last answer; an entry nobody reads is dropped, so reading it again makes a fresh request.
 */
type Call = { method: string; params: unknown; resolve: (value: unknown) => void; reject: (error: unknown) => void };

function standIn() {
  const calls: Call[] = [];
  const listeners = new Set<(event: VentureRunEvent) => void>();
  const client: EngineClient = {
    transport: 'fake',
    request: ((method: string, params?: unknown) => new Promise((resolve, reject) => { calls.push({ method, params, resolve, reject }); })) as EngineClient['request'],
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    status: () => ({ state: 'ok' }),
    onStatus: () => () => {},
  };
  const of = (method: string) => calls.filter((call) => call.method === method);
  const answer = async (call: Call, value: unknown) => { await act(async () => { call.resolve(value); }); };
  const fail = async (call: Call, error: unknown) => { await act(async () => { call.reject(error); }); };
  const emit = (event: VentureRunEvent) => act(() => { for (const listener of [...listeners]) listener(event); });
  return { client, calls, of, answer, fail, emit, listeners };
}

const queue = (needsYou: number): QueueList => ({ rows: [], summary: '', needsYou, businesses: 1 });
const changed: VentureRunEvent = { type: 'queue.changed', businessId: 'lumen', at: '2026-11-06T10:00:00.000Z' };

function Count({ name, refreshOn }: { name: string; refreshOn?: (event: VentureRunEvent) => boolean }) {
  const list = useResource('venture.queue.list', { scope: 'all' }, refreshOn ? { refreshOn } : {});
  return (
    <p data-testid={name}>
      {list.data ? String(list.data.needsYou) : 'none'}
      {list.error ? ` error:${list.error.code}` : ''}
      <button type="button" onClick={list.reload}>reload {name}</button>
    </p>
  );
}

describe('the read store (B3)', () => {
  it('two readers of the same thing make one request and show the same answer; reload from one updates both', async () => {
    const engine = standIn();
    render(<EngineProvider client={engine.client}><Count name="rail" /><Count name="today" /></EngineProvider>);
    expect(engine.of('venture.queue.list')).toHaveLength(1);
    await engine.answer(engine.calls[0]!, queue(4));
    expect(screen.getByTestId('rail').textContent).toContain('4');
    expect(screen.getByTestId('today').textContent).toContain('4');
    act(() => { screen.getByRole('button', { name: 'reload rail' }).click(); });
    expect(engine.of('venture.queue.list')).toHaveLength(2);
    await engine.answer(engine.calls[1]!, queue(3));
    expect(screen.getByTestId('rail').textContent).toContain('3');
    expect(screen.getByTestId('today').textContent).toContain('3');
  });

  it('an event one reader accepts and the other refuses loads the shared entry once, and both see the new answer', async () => {
    const engine = standIn();
    render(
      <EngineProvider client={engine.client}>
        <Count name="rail" refreshOn={(event) => event.type === 'queue.changed'} />
        <Count name="today" refreshOn={() => false} />
      </EngineProvider>,
    );
    await engine.answer(engine.calls[0]!, queue(4));
    engine.emit(changed);
    expect(engine.of('venture.queue.list')).toHaveLength(2);
    await engine.answer(engine.calls[1]!, queue(2));
    expect(screen.getByTestId('rail').textContent).toContain('2');
    expect(screen.getByTestId('today').textContent).toContain('2');
    engine.emit({ type: 'run.step', businessId: 'lumen', runId: 'r1', at: changed.at });
    expect(engine.of('venture.queue.list')).toHaveLength(2);
  });

  it('a reload asked for while one is on its way runs once more after it, and the older reply is dropped', async () => {
    const engine = standIn();
    render(<EngineProvider client={engine.client}><Count name="rail" /></EngineProvider>);
    await engine.answer(engine.calls[0]!, queue(5));
    engine.emit(changed);
    engine.emit(changed);
    engine.emit(changed);
    // One load at a time: the second and third ask for one more after it.
    expect(engine.of('venture.queue.list')).toHaveLength(2);
    await engine.answer(engine.calls[1]!, queue(4));
    expect(screen.getByTestId('rail').textContent).toContain('5');
    expect(engine.of('venture.queue.list')).toHaveLength(3);
    await engine.answer(engine.calls[2]!, queue(1));
    expect(screen.getByTestId('rail').textContent).toContain('1');
    expect(engine.of('venture.queue.list')).toHaveLength(3);
  });

  it('an error keeps the last answer', async () => {
    const engine = standIn();
    render(<EngineProvider client={engine.client}><Count name="rail" /></EngineProvider>);
    await engine.answer(engine.calls[0]!, queue(4));
    engine.emit(changed);
    await engine.fail(engine.calls[1]!, new EngineError('ENGINE_OFFLINE', 'Chausar isn\'t answering.'));
    expect(screen.getByTestId('rail').textContent).toContain('4');
    expect(screen.getByTestId('rail').textContent).toContain('error:ENGINE_OFFLINE');
  });

  it('when every reader leaves, the entry goes: mounting again makes a fresh request; StrictMode reuses it', async () => {
    const engine = standIn();
    const view = render(<StrictMode><EngineProvider client={engine.client}><Count name="rail" /></EngineProvider></StrictMode>);
    expect(engine.of('venture.queue.list')).toHaveLength(1);
    await engine.answer(engine.calls[0]!, queue(4));
    view.unmount();
    await act(async () => { await Promise.resolve(); });
    expect(engine.listeners.size).toBe(0);
    render(<EngineProvider client={engine.client}><Count name="rail" /></EngineProvider>);
    expect(engine.of('venture.queue.list')).toHaveLength(2);
    expect(screen.getByTestId('rail').textContent).toContain('none');
  });

  it('a place swapped for another reading the same thing reads afresh; one whose read is on its way shares it', async () => {
    const engine = standIn();
    let swap = () => {};
    function Swapper() {
      const [which, setWhich] = useState<'a' | 'b'>('a');
      swap = () => setWhich('b');
      return which === 'a' ? <Count key="a" name="a" /> : <Count key="b" name="b" />;
    }
    render(<EngineProvider client={engine.client}><Swapper /></EngineProvider>);
    await engine.answer(engine.calls[0]!, queue(4));
    act(() => swap());
    await act(async () => { await Promise.resolve(); });
    expect(engine.of('venture.queue.list')).toHaveLength(2);
    await engine.answer(engine.calls[1]!, queue(2));
    expect(screen.getByTestId('b').textContent).toContain('2');
  });

  it('only read methods compile', () => {
    function Wrong() {
      // @ts-expect-error B3: a write is never read through useResource.
      useResource('venture.payment.record', { invoiceId: 'x', amount: '1', receivedOn: '2026-11-06', method: 'upi' });
      return null;
    }
    expect(typeof Wrong).toBe('function');
  });
});
