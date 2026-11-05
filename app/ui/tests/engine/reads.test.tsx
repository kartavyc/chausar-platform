import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { EngineProvider, useEngine, useResource } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { App } from '../../src/shell/App';
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

/**
 * B3 task 3: a write refreshes what it changes. A read and a quiet call send nothing more; a write that answers, or
 * times out (the engine may have done it), reads again every entry whose readers accept a queue change, once; any
 * other refusal changes nothing.
 */
function Reader({ name, method, refreshOn }: { name: string; method: 'venture.invoice.list' | 'venture.order.list'; refreshOn: (event: VentureRunEvent) => boolean }) {
  const list = useResource(method, {}, { refreshOn });
  return <p data-testid={name}>{list.data ? 'read' : 'none'}</p>;
}

function Writer({ grab }: { grab: (client: EngineClient) => void }) {
  grab(useEngine());
  return null;
}

describe('a write refreshes what it changes (B3)', () => {
  async function mounted() {
    const engine = standIn();
    let client: EngineClient | null = null;
    render(
      <EngineProvider client={engine.client}>
        <Reader name="invoices" method="venture.invoice.list" refreshOn={(event) => event.type === 'queue.changed'} />
        <Reader name="orders" method="venture.order.list" refreshOn={() => false} />
        <Writer grab={(c) => { client = c; }} />
      </EngineProvider>,
    );
    await engine.answer(engine.of('venture.invoice.list')[0]!, []);
    await engine.answer(engine.of('venture.order.list')[0]!, []);
    const send = (method: string, params: unknown) => (client!.request as (m: string, p: unknown) => Promise<unknown>)(method, params);
    const last = () => engine.calls.at(-1)!;
    return { engine, send, last };
  }

  it('a recorded payment reads the invoices again once, and not a place that refuses queue changes', async () => {
    const { engine, send, last } = await mounted();
    const sent = send('venture.payment.record', { invoiceId: 'inv-1', amount: '10', receivedOn: '2026-11-06', method: 'upi' });
    expect(engine.of('venture.invoice.list')).toHaveLength(1);
    await engine.answer(last(), { ok: true });
    await act(async () => { await sent; });
    expect(engine.of('venture.invoice.list')).toHaveLength(2);
    expect(engine.of('venture.order.list')).toHaveLength(1);
  });

  it('a read sent with request, and a quiet call, read nothing again', async () => {
    const { engine, send, last } = await mounted();
    const read = send('venture.queue.list', { scope: 'all' });
    await engine.answer(last(), { rows: [] });
    await act(async () => { await read; });
    const autosave = send('venture.settings.draft', { form: 'owner', values: {} });
    await engine.answer(last(), { ok: true });
    await act(async () => { await autosave; });
    const look = send('venture.connectors.check', { last: true });
    await engine.answer(last(), { ok: true });
    await act(async () => { await look; });
    const poll = send('venture.invoice.payLink', { invoiceId: 'inv-1', action: 'check' });
    await engine.answer(last(), { ok: true });
    await act(async () => { await poll; });
    expect(engine.of('venture.invoice.list')).toHaveLength(1);
  });

  it('a refused write reads nothing again; a timed-out one does, since the engine may have done it', async () => {
    const { engine, send, last } = await mounted();
    const refused = send('venture.payment.record', { invoiceId: 'inv-1', amount: '10', receivedOn: '2026-11-06', method: 'upi' }).catch(() => 'refused');
    await engine.fail(last(), new EngineError('PAYMENT_TOO_LARGE', 'This is more than the balance.'));
    await act(async () => { await refused; });
    expect(engine.of('venture.invoice.list')).toHaveLength(1);
    const timed = send('venture.payment.record', { invoiceId: 'inv-1', amount: '10', receivedOn: '2026-11-06', method: 'upi' }).catch(() => 'timed out');
    await engine.fail(last(), new EngineError('REQUEST_TIMEOUT', 'Chausar took too long to answer.'));
    await act(async () => { await timed; });
    expect(engine.of('venture.invoice.list')).toHaveLength(2);
  });

  it('the store\'s own signal never reaches the engine\'s event listeners', async () => {
    const { engine, send, last } = await mounted();
    const heard: VentureRunEvent[] = [];
    engine.listeners.add((event) => heard.push(event));
    const sent = send('venture.client.add', { name: 'Test Client One' });
    await engine.answer(last(), { id: 'c-1' });
    await act(async () => { await sent; });
    expect(heard).toEqual([]);
  });
});

/**
 * B3 task 3: at rest nothing loops. Once the first reads settle on Today, an autosaved settings form, Money, Apps with
 * a pinned app and Connections, waiting again sends nothing: no quiet call is taken for a write that reads again.
 */
describe('at rest, nothing loops (B3)', () => {
  const NOW = '2026-10-26T13:05:00.000Z';
  const settle = async () => { for (let i = 0; i < 8; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

  async function open(hash: string) {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.apps.pin', { app: 'miniapp_sample', pinned: true }).catch(() => undefined);
    const fake = createFakeClient(engine);
    const calls: string[] = [];
    const client: EngineClient = {
      ...fake,
      request: ((method: string, params?: unknown) => { calls.push(method); return fake.request(method as never, params as never); }) as EngineClient['request'],
    };
    window.location.hash = hash;
    render(<App client={client} language="en" />);
    await settle();
    return calls;
  }

  for (const hash of ['#/today', '#/money', '#/apps', '#/connections']) {
    it(`${hash} sends nothing more once it has settled`, async () => {
      const calls = await open(hash);
      await settle();
      const before = calls.length;
      await settle();
      expect(calls.slice(before)).toEqual([]);
    });
  }

  it('a settings form keeps its draft as it is typed, and then sends nothing more', async () => {
    const calls = await open('#/business/owner');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: 'Kart' } });
    await waitFor(() => expect(calls).toContain('venture.settings.draft'), { timeout: 3000 });
    await settle();
    const before = calls.length;
    await settle();
    expect(calls.slice(before)).toEqual([]);
  });
});
