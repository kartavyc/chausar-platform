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
      { events: [], lastSeq: 7, firstSeq: 1, frames: [] },
      { events: [{ id: 'e8', seq: 8, name: 'run.done', at: '2026-10-21T10:00:00Z', data: { businessId: 'lumen', runId: '31' } }, { id: 'e9', seq: 9, name: 'invoice-issued', at: '2026-10-21T10:00:01Z', data: {} }], lastSeq: 9, firstSeq: 1, frames: [] },
      { events: [], lastSeq: 9, firstSeq: 1, frames: [] },
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
    const polled = vi.fn(async () => ({ events: [], lastSeq: 0, firstSeq: 0, frames: [] }));
    const fallback = createEventFeed({ request: polled, sse: { fetch: missing, bearer: async () => 'tok' } });
    fallback.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(polled).toHaveBeenCalledWith('venture.events', { limit: 1 });
  });
});

describe('event feed: the sequence (Ink v2 wave 4, 4G1)', () => {
  it('a pushed frame keeps its seq, and notify.new its count; a count on any other event is dropped', () => {
    let push: ((value: unknown) => void) | undefined;
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request: vi.fn() });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!({ type: 'notify.new', businessId: 'lumen', at: '2026-10-21T10:00:00Z', seq: 12, count: 3 });
    push!({ type: 'run.done', businessId: 'lumen', runId: '31', at: '2026-10-21T10:00:01Z', seq: 13, count: 3 });
    push!({ type: 'queue.changed', businessId: 'lumen', at: '2026-10-21T10:00:02Z', seq: -1 });
    expect(seen).toEqual([
      { type: 'notify.new', businessId: 'lumen', at: '2026-10-21T10:00:00Z', seq: 12, count: 3 },
      { type: 'run.done', businessId: 'lumen', runId: '31', at: '2026-10-21T10:00:01Z', seq: 13 },
      { type: 'queue.changed', businessId: 'lumen', at: '2026-10-21T10:00:02Z' },
    ]);
    stop();
  });

  it('polling replays the engine\'s frames as they were pushed, count included', async () => {
    vi.useFakeTimers();
    const frames: VentureRunEvent[] = [
      { type: 'run.done', businessId: 'main', runId: '31', at: '2026-10-21T10:00:00Z', seq: 8 },
      { type: 'notify.new', businessId: 'main', at: '2026-10-21T10:00:00Z', seq: 9, count: 2 },
    ];
    const replies = [
      { events: [], lastSeq: 7, firstSeq: 1, frames: [] },
      {
        events: [
          { id: 'e8', seq: 8, name: 'run.done', at: '2026-10-21T10:00:00Z', data: { runId: '31' } },
          { id: 'e9', seq: 9, name: 'notify.new', at: '2026-10-21T10:00:00Z', data: { count: 2 } },
          { id: 'e10', seq: 10, name: 'invoice-issued', at: '2026-10-21T10:00:01Z', data: {} },
        ],
        lastSeq: 10, firstSeq: 1, frames,
      },
    ];
    const request = vi.fn(async () => replies.shift() ?? { events: [], lastSeq: 10, firstSeq: 1, frames: [] });
    const feed = createEventFeed({ request });
    const seen: VentureRunEvent[] = [];
    feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(seen).toEqual([...frames, { type: 'queue.changed', businessId: '', at: '2026-10-21T10:00:01Z' }]);
  });
});

describe('event feed: replay after a gap or a reconnect (Ink v2 wave 4, 4G4)', () => {
  const frame = (seq: number, type: VentureRunEvent['type'] = 'run.step'): VentureRunEvent => ({ type, businessId: 'main', runId: '31', at: `2026-10-21T10:00:0${seq % 10}Z`, seq });
  const reply = (frames: VentureRunEvent[], lastSeq: number, firstSeq = 1) => ({
    events: frames.map((f) => ({ id: `e${f.seq}`, seq: f.seq!, name: f.type, at: f.at, data: { runId: f.runId } })), lastSeq, firstSeq, frames,
  });
  /** A stream that sends these frames, then stays open (or closes, when `close`). */
  const streamOf = (frames: VentureRunEvent[], close = false) => {
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
        for (const f of frames) c.enqueue(encoder.encode(`id: ${f.seq}\ndata: ${JSON.stringify(f)}\n\n`));
        if (close) c.close();
      },
    });
    return { response: new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }), end: () => controller?.close() };
  };
  const seqs = (seen: VentureRunEvent[]) => seen.map((e) => e.seq);

  it('a dropped stream opens again, asks venture.events {afterSeq} and applies the two missed frames once', async () => {
    vi.useFakeTimers();
    const first = streamOf([frame(5)], true);
    const second = streamOf([frame(8)]);
    const fetch = vi.fn().mockResolvedValueOnce(first.response).mockResolvedValueOnce(second.response);
    const request = vi.fn(async () => reply([frame(6), frame(7), frame(8)], 8));
    const feed = createEventFeed({ request, sse: { fetch, bearer: async () => 'tok' }, retryMs: 5000 });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(seqs(seen)).toEqual([5]);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('venture.events', { afterSeq: 5, limit: 100 });
    expect(seqs(seen)).toEqual([5, 6, 7, 8]);
    stop();
  });

  it('a desktop push that skips seqs replays the gap first, in order, and a frame that comes twice is applied once', async () => {
    let push: ((value: unknown) => void) | undefined;
    const request = vi.fn(async () => reply([frame(6), frame(7), frame(8)], 8));
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!(frame(5));
    push!(frame(8));
    // The frame past the gap waits for the replay, so the screens see them in order.
    expect(seqs(seen)).toEqual([5]);
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('venture.events', { afterSeq: 5, limit: 100 });
    expect(seqs(seen)).toEqual([5, 6, 7, 8]);
    push!(frame(7));
    push!(frame(9));
    expect(seqs(seen)).toEqual([5, 6, 7, 8, 9]);
    expect(request).toHaveBeenCalledTimes(1);
    stop();
  });

  it('when the log no longer holds the gap (firstSeq past it), the screens are told to read again once', async () => {
    let push: ((value: unknown) => void) | undefined;
    const request = vi.fn(async () => reply([frame(40), frame(41)], 41, 40));
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!(frame(5));
    push!(frame(41));
    await vi.waitFor(() => expect(seen).toHaveLength(4));
    expect(seen.map((e) => e.type)).toEqual(['run.step', 'queue.changed', 'run.step', 'run.step']);
    expect(seqs(seen)).toEqual([5, undefined, 40, 41]);
    stop();
  });

  it('a replay the engine does not answer tells the screens to read again once, then applies the held frame', async () => {
    let push: ((value: unknown) => void) | undefined;
    const request = vi.fn(async () => { throw new Error('offline'); });
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!(frame(5));
    push!(frame(8));
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen.map((e) => e.type)).toEqual(['run.step', 'queue.changed', 'run.step']);
    expect(seqs(seen)).toEqual([5, undefined, 8]);
    stop();
  });

  it('a page shown again before any frame came tells the screens to read again once, so a quiet Today never stays stale', async () => {
    vi.useFakeTimers();
    let hidden = false;
    let change: (() => void) | undefined;
    const fetch = vi.fn(async () => streamOf([]).response);
    const request = vi.fn();
    const feed = createEventFeed({ request, sse: { fetch, bearer: async () => 'tok' }, visibility: { hidden: () => hidden, onChange: (cb) => { change = cb; return () => {}; } } });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]);
    hidden = true; change!();
    hidden = false; change!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(seen.map((e) => e.type)).toEqual(['queue.changed']);
    expect(request).not.toHaveBeenCalled();
    stop();
  });

  it('another business\'s frames start their own count: no gap is asked for across a switch', async () => {
    let push: ((value: unknown) => void) | undefined;
    const request = vi.fn();
    const feed = createEventFeed({ onEvent: (cb) => { push = cb; return () => {}; }, request });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    push!(frame(300));
    push!({ ...frame(12), businessId: 'other' });
    push!({ ...frame(13), businessId: 'other' });
    expect(seqs(seen)).toEqual([300, 12, 13]);
    expect(request).not.toHaveBeenCalled();
    stop();
  });

  it('the web page closes its stream while hidden, so it stops counting as watching, and replays the gap when shown', async () => {
    vi.useFakeTimers();
    let hidden = false;
    const changes = new Set<() => void>();
    const visibility = { hidden: () => hidden, onChange: (cb: () => void) => { changes.add(cb); return () => { changes.delete(cb); }; } };
    const turn = (to: boolean) => { hidden = to; for (const cb of [...changes]) cb(); };
    const signals: AbortSignal[] = [];
    const responses = [streamOf([frame(5)]).response, streamOf([frame(9)]).response];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => { signals.push(init!.signal!); return responses.shift()!; });
    const request = vi.fn(async () => reply([frame(6), frame(7)], 7));
    const feed = createEventFeed({ request, sse: { fetch, bearer: async () => 'tok' }, visibility });
    const seen: VentureRunEvent[] = [];
    const stop = feed.subscribe((e) => seen.push(e));
    await vi.advanceTimersByTimeAsync(0);
    expect(seqs(seen)).toEqual([5]);
    turn(true);
    expect(signals[0]!.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(request).not.toHaveBeenCalled();
    turn(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('venture.events', { afterSeq: 5, limit: 100 });
    expect(seqs(seen)).toEqual([5, 6, 7, 9]);
    stop();
    expect(signals[1]!.aborted).toBe(true);
    expect(changes.size).toBe(0);
  });

  it('a page that opens hidden waits until it shows before it opens its stream', async () => {
    vi.useFakeTimers();
    let hidden = true;
    let change: (() => void) | undefined;
    const fetch = vi.fn(async () => streamOf([]).response);
    const feed = createEventFeed({ request: vi.fn(), sse: { fetch, bearer: async () => 'tok' }, visibility: { hidden: () => hidden, onChange: (cb) => { change = cb; return () => {}; } } });
    const stop = feed.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).not.toHaveBeenCalled();
    hidden = false;
    change!();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    stop();
  });
});
