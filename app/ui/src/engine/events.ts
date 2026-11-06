/**
 * Run and queue events. Three sources, best first:
 *   1. desktop: the preload bridge pushes them (`window.chausar.onEvent`);
 *   2. web: server-sent events from GET /api/events, read with fetch so the bearer travels in a header, never in the
 *      address;
 *   3. otherwise, or when either of those is missing or drops: poll `venture.events` every 5 s.
 * Polled venture events become run events when their name is one; any other new event becomes `queue.changed`, so
 * the screens that listen refresh.
 *
 * Ink v2 wave 4 (4G4, W3's U20): every frame carries its place in the open business's log (`seq`). A frame that comes
 * after a gap (a push that skipped seqs, or a stream that dropped and opened again) makes the feed ask
 * `venture.events {afterSeq}` for what it missed and apply those frames, each once: a frame that arrives twice (on the
 * stream and in the replay) is applied the first time only. When the log no longer holds the gap (`firstSeq` past it),
 * the screens are told to read again with one `queue.changed`. On the web, a hidden page closes its stream, so the
 * owner stops counting as watching it (alerts outside the app wait while the owner watches); it opens again, and
 * replays the gap, when the page shows.
 */

import type { VentureEventsResult, VentureRunEvent, VentureRunEventType } from './types';

const RUN_EVENT_TYPES: readonly VentureRunEventType[] = ['run.started', 'run.step', 'run.waiting', 'run.done', 'run.failed', 'queue.changed',
  // Ink v2 wave 4 (VENTURE_RUN_EVENT_TYPES in the engine): ids only; notify.new also carries a count.
  'agent.message', 'chief.message', 'proposal.created', 'notify.new', 'pipeline.changed', 'run.stopped', 'run.call', 'keeper.ran'];
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const POLL_MS = 5000;
/** How long a dropped stream waits before it opens again: the server's own `retry: 5000`. */
export const RETRY_MS = 5000;
/** One replay reads at most this many pages of missed events, 100 each. */
const REPLAY_PAGES = 10;
const PAGE = 100;
/** How many recent seqs the feed remembers, so a frame that comes twice is applied once. */
const SEEN_MAX = 500;

/** Whether the page is hidden, and a way to hear when that changes (the web page's visibility). */
export interface PageVisibility {
  hidden(): boolean;
  onChange(callback: () => void): () => void;
}

export interface FeedDeps {
  onEvent?: ((callback: (value: unknown) => void) => () => void) | undefined;
  request: (method: 'venture.events', params: { afterSeq?: number; limit?: number }) => Promise<VentureEventsResult>;
  sse?: { fetch: (url: string, init?: RequestInit) => Promise<Response>; bearer: () => Promise<string | null> } | undefined;
  pollMs?: number;
  /** The web page's visibility: while hidden, the stream stays closed (4G4). Left out, the stream stays open. */
  visibility?: PageVisibility | undefined;
  /** How long a dropped stream waits before it opens again. Left out, RETRY_MS. */
  retryMs?: number;
}

export interface EventFeed {
  subscribe(listener: (event: VentureRunEvent) => void): () => void;
}

/** The browser page's visibility, for the web feed. */
export function pageVisibility(doc: Document = document): PageVisibility {
  return {
    hidden: () => doc.visibilityState === 'hidden',
    onChange: (callback) => {
      doc.addEventListener('visibilitychange', callback);
      return () => doc.removeEventListener('visibilitychange', callback);
    },
  };
}

/** A pushed event, checked field by field: seq when whole, count on notify.new alone. Anything else is dropped. */
export function readRunEvent(value: unknown): VentureRunEvent | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.type !== 'string' || !RUN_EVENT_TYPES.includes(v.type as VentureRunEventType)) return null;
  if (typeof v.businessId !== 'string' || typeof v.at !== 'string') return null;
  const event: VentureRunEvent = { type: v.type as VentureRunEventType, businessId: v.businessId, at: v.at };
  if (typeof v.runId === 'string') event.runId = v.runId;
  if (whole(v.seq)) event.seq = v.seq;
  if (v.type === 'notify.new' && whole(v.count)) event.count = v.count;
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

/** Where a page of the log leaves off: its last event when more follow, else the log's last seq. */
function nextCursor(reply: VentureEventsResult): number {
  const last = reply.events.at(-1)?.seq;
  return last !== undefined && last < reply.lastSeq ? last : reply.lastSeq;
}

type StreamEnd = 'aborted' | 'refused' | 'dropped';

export function createEventFeed(deps: FeedDeps): EventFeed {
  const listeners = new Set<(event: VentureRunEvent) => void>();
  const emit = (event: VentureRunEvent) => { for (const listener of [...listeners]) listener(event); };
  let stop: (() => void) | null = null;
  /** Bumped each time the feed stops, so a replay still under way from before applies nothing. */
  let generation = 0;

  // Where the feed is in the open business's log: whose log, the newest seq applied, and the recent seqs applied.
  let business: string | null = null;
  let lastSeq: number | undefined;
  let seen = new Set<number>();

  /**
   * Applies one event, once. A frame of another business starts that business's count afresh (each business keeps its
   * own log). A frame past a gap asks for the gap, unless it came in a replay or a poll, which read the log in order.
   */
  function deliver(event: VentureRunEvent, inOrder = false): void {
    if (event.seq === undefined) { emit(event); return; }
    if (event.businessId !== business) { business = event.businessId; lastSeq = undefined; seen = new Set(); }
    if (seen.has(event.seq)) return;
    // A frame past a gap, or one that comes while a replay reads the log, waits until the replay ends, so the screens
    // see every frame in order.
    if (!inOrder && replaying) { held.push(event); return; }
    if (!inOrder && lastSeq !== undefined && event.seq > lastSeq + 1) {
      held.push(event);
      void replay(lastSeq);
      return;
    }
    seen.add(event.seq);
    if (seen.size > SEEN_MAX) seen = new Set([...seen].slice(-SEEN_MAX / 2));
    lastSeq = lastSeq === undefined ? event.seq : Math.max(lastSeq, event.seq);
    emit(event);
  }

  /** Tells every screen to read again: what was missed cannot be replayed (trimmed, or the engine did not answer). */
  const readAgain = (at: string) => emit({ type: 'queue.changed', businessId: business ?? '', at });
  const now = () => new Date().toISOString();

  let replaying: Promise<void> | null = null;
  let again: number | null = null;
  let held: VentureRunEvent[] = [];

  /** Reads what the log holds after `afterSeq` and applies its frames once. One replay at a time; a second waits. */
  function replay(afterSeq: number): Promise<void> {
    if (replaying) {
      again = again === null ? afterSeq : Math.min(again, afterSeq);
      return replaying;
    }
    const mine = generation;
    replaying = (async () => {
      let next: number | null = afterSeq;
      while (next !== null) {
        let from = next;
        next = null;
        try {
          for (let page = 0; page < REPLAY_PAGES; page += 1) {
            const reply = await deps.request('venture.events', { afterSeq: from, limit: PAGE });
            if (mine !== generation) return;
            const first = reply.events[0];
            // The log was trimmed past the gap: what is missing cannot be replayed, so every screen reads again.
            if (page === 0 && first && reply.firstSeq > from + 1) readAgain(first.at);
            for (const frame of reply.frames ?? []) {
              const event = readRunEvent(frame);
              if (event) deliver(event, true);
            }
            const cursor = nextCursor(reply);
            if (cursor >= reply.lastSeq || cursor <= from) break;
            from = cursor;
          }
        } catch {
          // The engine did not answer: the screens read again once; the next gap or reconnect asks again.
          if (mine === generation) readAgain(now());
        }
        if (mine !== generation) return;
        if (again !== null) { next = again; again = null; }
      }
    })().finally(() => {
      replaying = null;
      // The frames that came meanwhile, in the order they came; any the replay already applied are skipped.
      const waiting = held;
      held = [];
      if (mine === generation) for (const event of waiting) deliver(event, true);
    });
    return replaying;
  }

  function poll(): () => void {
    // A feed that already knows where it is (a stream that fell back to polling) goes on from there.
    let cursor: number | undefined = lastSeq;
    let busy = false;
    let stopped = false;
    const tick = async () => {
      if (busy || stopped) return;
      busy = true;
      try {
        const reply = await deps.request('venture.events', cursor === undefined ? { limit: 1 } : { afterSeq: cursor, limit: PAGE });
        if (stopped) return;
        if (cursor === undefined) {
          // The first look only learns where the log is; what happened before the page opened is not news.
          cursor = reply.lastSeq;
          return;
        }
        // A run event replays as the engine's own frame (seq, and count on notify.new), else as before.
        const frames = new Map((reply.frames ?? []).map((frame) => [frame.seq, frame]));
        for (const record of reply.events) {
          const event = readRunEvent(frames.get(record.seq));
          if (event) deliver(event, true); else emit(fromVentureEvent(record));
        }
        cursor = nextCursor(reply);
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
    let ended = false;
    let stream: AbortController | null = null;
    let fallback: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const close = () => {
      stream?.abort();
      stream = null;
      if (timer) { clearTimeout(timer); timer = null; }
    };
    const toPolling = () => {
      if (ended || fallback) return;
      close();
      fallback = poll();
    };

    /** Reads one stream until it ends. `resume`: replay what was missed first, once the server has answered. */
    async function read(abort: AbortController, resume: boolean): Promise<StreamEnd> {
      let live = false;
      try {
        const bearer = await source.bearer();
        if (abort.signal.aborted) return 'aborted';
        if (!bearer) return 'refused';
        const response = await source.fetch('/api/events', {
          method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: abort.signal,
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${bearer}` },
        });
        if (abort.signal.aborted) return 'aborted';
        if (!response.ok || !response.body || !(response.headers.get('Content-Type') ?? '').includes('text/event-stream')) return 'refused';
        live = true;
        // Back after a drop or a hidden spell: replay what was missed, or, before any frame came, read everything again.
        if (resume) {
          if (lastSeq !== undefined) await replay(lastSeq);
          else readAgain(now());
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (abort.signal.aborted) return 'aborted';
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const data = block.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            try {
              const event = readRunEvent(JSON.parse(data));
              if (event) deliver(event);
            } catch {
              // A malformed message is dropped; the next one may be fine.
            }
          }
        }
        return 'dropped';
      } catch {
        if (abort.signal.aborted) return 'aborted';
        return live ? 'dropped' : 'refused';
      }
    }

    /** Opens the stream, unless the page is hidden (it opens when shown) or the feed fell back to polling. */
    function open(resume: boolean) {
      if (ended || fallback || stream || deps.visibility?.hidden()) return;
      const abort = new AbortController();
      stream = abort;
      void read(abort, resume).then((end) => {
        if (end === 'aborted' || ended) return;
        if (stream === abort) stream = null;
        // A server with no stream (or a session without one) is polled; a stream that dropped opens again after a while.
        if (end === 'refused') return toPolling();
        timer = setTimeout(() => { timer = null; open(true); }, deps.retryMs ?? RETRY_MS);
      });
    }

    const offVisibility = deps.visibility?.onChange(() => {
      if (deps.visibility!.hidden()) close();
      else open(true);
    });
    open(false);
    return () => {
      ended = true;
      close();
      offVisibility?.();
      fallback?.();
    };
  }

  function start() {
    if (deps.onEvent) {
      const off = deps.onEvent((value) => { const event = readRunEvent(value); if (event) deliver(event); });
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
        if (listeners.size === 0 && stop) {
          stop();
          stop = null;
          generation += 1;
          held = [];
        }
      };
    },
  };
}
