/**
 * Run and queue events. Three sources, best first:
 *   1. desktop: the preload bridge pushes them (`window.chausar.onEvent`);
 *   2. web: server-sent events from GET /api/events, read with fetch so the bearer travels in a header, never in the
 *      address;
 *   3. otherwise, or when either of those is missing or drops: poll `venture.events` every 5 s.
 * Polled venture events become run events when their name is one; any other new event becomes `queue.changed`, so
 * the screens that listen refresh.
 */

import type { VentureEventsResult, VentureRunEvent, VentureRunEventType } from './types';

const RUN_EVENT_TYPES: readonly VentureRunEventType[] = ['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed'];
export const POLL_MS = 5000;

export interface FeedDeps {
  onEvent?: ((callback: (value: unknown) => void) => () => void) | undefined;
  request: (method: 'venture.events', params: { afterSeq?: number; limit?: number }) => Promise<VentureEventsResult>;
  sse?: { fetch: (url: string, init?: RequestInit) => Promise<Response>; bearer: () => Promise<string | null> } | undefined;
  pollMs?: number;
}

export interface EventFeed {
  subscribe(listener: (event: VentureRunEvent) => void): () => void;
}

/** A pushed event, checked field by field. Anything else is dropped. */
export function readRunEvent(value: unknown): VentureRunEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !RUN_EVENT_TYPES.includes(v.type as VentureRunEventType)) return null;
  if (typeof v.businessId !== 'string' || typeof v.at !== 'string') return null;
  const event: VentureRunEvent = { type: v.type as VentureRunEventType, businessId: v.businessId, at: v.at };
  if (typeof v.runId === 'string') event.runId = v.runId;
  return event;
}

function fromVentureEvent(record: VentureEventsResult['events'][number]): VentureRunEvent {
  const data = record.data && typeof record.data === 'object' ? (record.data as Record<string, unknown>) : {};
  const businessId = typeof data.businessId === 'string' ? data.businessId : '';
  if (RUN_EVENT_TYPES.includes(record.name as VentureRunEventType)) {
    const event: VentureRunEvent = { type: record.name as VentureRunEventType, businessId, at: record.at };
    if (typeof data.runId === 'string') event.runId = data.runId;
    return event;
  }
  return { type: 'queue.changed', businessId, at: record.at };
}

export function createEventFeed(deps: FeedDeps): EventFeed {
  const listeners = new Set<(event: VentureRunEvent) => void>();
  const emit = (event: VentureRunEvent) => { for (const listener of [...listeners]) listener(event); };
  let stop: (() => void) | null = null;

  function poll(): () => void {
    let lastSeq: number | undefined;
    let busy = false;
    let stopped = false;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const reply = await deps.request('venture.events', lastSeq === undefined ? { limit: 1 } : { afterSeq: lastSeq, limit: 100 });
        if (stopped) return;
        if (lastSeq !== undefined) for (const record of reply.events) emit(fromVentureEvent(record));
        lastSeq = reply.lastSeq;
      } catch {
        // The status line reports a lost engine; polling just tries again.
      } finally {
        busy = false;
      }
    };
    void tick();
    const timer = setInterval(() => { void tick(); }, deps.pollMs ?? POLL_MS);
    return () => { stopped = true; clearInterval(timer); };
  }

  function sse(source: NonNullable<FeedDeps['sse']>): () => void {
    const abort = new AbortController();
    let fallback: (() => void) | null = null;
    const toPolling = () => { if (!abort.signal.aborted && !fallback) fallback = poll(); };
    void (async () => {
      try {
        const bearer = await source.bearer();
        if (!bearer) return toPolling();
        const response = await source.fetch('/api/events', {
          method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: abort.signal,
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${bearer}` },
        });
        if (!response.ok || !response.body || !(response.headers.get('Content-Type') ?? '').includes('text/event-stream')) return toPolling();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            try {
              const event = readRunEvent(JSON.parse(data));
              if (event) emit(event);
            } catch {
              // A malformed message is dropped; the next one may be fine.
            }
          }
        }
        toPolling();
      } catch {
        toPolling();
      }
    })();
    return () => { abort.abort(); fallback?.(); };
  }

  function start() {
    if (deps.onEvent) {
      const off = deps.onEvent((value) => { const event = readRunEvent(value); if (event) emit(event); });
      return () => off();
    }
    if (deps.sse) return sse(deps.sse);
    return poll();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      if (!stop) stop = start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && stop) { stop(); stop = null; }
      };
    },
  };
}
