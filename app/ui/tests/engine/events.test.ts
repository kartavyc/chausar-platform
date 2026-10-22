import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEventFeed } from '../../src/engine/events';
import type { VentureRunEvent } from '../../src/engine/types';

afterEach(() => vi.useRealTimers());

describe('event feed', () => {
  it('desktop pushes arrive as they are; malformed ones are dropped', () => {
    let push: ((value: unknown) => void) | undefined;
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request: vi.fn() });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!({ type: 'run.step', businessId: 'lumen', runId: '31', at: '2026-10-21T10:00:00Z' });
    push!({ type: 'nonsense', businessId: 'lumen', at: 'x' });
    push!(null);
    expect(seen).toEqual([{ type: 'run.step', businessId: 'lumen', runId: '31', at: '2026-10-21T10:00:00Z' }]);
    stop();
  });

  it('without pushes it polls venture.events every 5 s from the last seen event', async () => {
    vi.useFakeTimers();
    const replies = [
      { events: [], lastSeq: 7 },
      { events: [{ id: 'e8', seq: 8, name: 'run.done', at: '2026-10-21T10:00:00Z', data: { businessId: 'lumen', runId: '31' } }, { id: 'e9', seq: 9, name: 'invoice-issued', at: '2026-10-21T10:00:01Z', data: {} }], lastSeq: 9 },
      { events: [], lastSeq: 9 },
    ];
    const request = vi.fn(async () => replies.shift()!);
    const feed = createEventFeed({ request });
    const seen: VentureRunEvent[] = [];
    feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenLastCalledWith('venture.events', { limit: 1 });
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenLastCalledWith('venture.events', { afterSeq: 7, limit: 100 });
    expect(seen).toEqual([
      { type: 'run.done', businessId: 'lumen', runId: '31', at: '2026-10-21T10:00:00Z' },
      { type: 'queue.changed', businessId: '', at: '2026-10-21T10:00:01Z' },
    ]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenLastCalledWith('venture.events', { afterSeq: 9, limit: 100 });
  });

  it('the web reads SSE from /api/events with its bearer, and falls back to polling when the server has none', async () => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: run\ndata: {"type":"run.started","businessId":"lumen","runId":"32","at":"2026-10-21T10:00:00Z"}\n\n'));
      },
    });
    const fetch = vi.fn(async () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
    const request = vi.fn();
    const feed = createEventFeed({ request, sse: { fetch, bearer: async () => 'tok' } });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledWith('/api/events', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(seen).toEqual([{ type: 'run.started', businessId: 'lumen', runId: '32', at: '2026-10-21T10:00:00Z' }]);
    expect(request).not.toHaveBeenCalled();
    stop();

    const missing = vi.fn(async () => new Response('Not found', { status: 404 }));
    const polled = vi.fn(async () => ({ events: [], lastSeq: 0 }));
    const fallback = createEventFeed({ request: polled, sse: { fetch: missing, bearer: async () => 'tok' } });
    fallback.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(polled).toHaveBeenCalledWith('venture.events', { limit: 1 });
  });
});
