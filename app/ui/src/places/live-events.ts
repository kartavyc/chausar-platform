/**
 * Live refresh for place modules (core-sync-jobs, round 4): the `subscribe` prop's engine side. It asks
 * `events.subscribe` what changed since its cursor whenever the desktop says something changed (`wake`, from
 * `window.chausar.onEngineEvent`), or every five seconds while the page is visible when no wake source exists, and
 * calls each subscriber whose kinds meet an event's kinds. One request is in flight at a time; a truncated reply is
 * followed at once. Every reply is checked whole and dropped whole when anything in it is wrong. It starts with the
 * first subscriber and stops with the last; an engine without the method stops it quietly.
 */
import type { LiveEvent, LiveEventKind, PlaceRpc } from './types.ts';

export const LIVE_EVENT_KINDS: readonly LiveEventKind[] = ['activity', 'approvals', 'actions', 'jobs', 'sources', 'books', 'answers', 'trust', 'devices', 'workspace', 'lessons'];
const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);
const RESET = new Set(['VAULT_LOCKED', 'READ_INVALIDATED', 'INVALID_EVENTS_REQUEST']);
const PAGE = 200, FOLLOW = 25, FAILURES = 3;

export interface LiveEventsOptions {
  /** Poll interval without a wake source, in milliseconds (default 5000). */
  readonly pollMs?: number;
  /** True while the page is hidden; polling pauses then (default `document.hidden`). */
  readonly hidden?: () => boolean;
}
export interface LiveEvents {
  subscribe(kinds: readonly LiveEventKind[], onEvent: (event: LiveEvent) => void): () => void;
  dispose(): void;
}
type Reply = { cursor: string; events: LiveEvent[]; more: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isKind = (value: unknown): value is LiveEventKind => typeof value === 'string' && (LIVE_EVENT_KINDS as readonly string[]).includes(value);
function event(value: unknown): LiveEvent | null {
  if (!isRecord(value) || Object.keys(value).length !== 4) return null;
  const { id, at, type, kinds } = value;
  if (typeof id !== 'string' || id.length === 0 || id.length > 200 || typeof at !== 'string' || at.length > 64 || Number.isNaN(Date.parse(at))) return null;
  if (typeof type !== 'string' || !/^[a-z][a-z0-9.-]{0,63}$/.test(type)) return null;
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.length > LIVE_EVENT_KINDS.length || !kinds.every(isKind) || new Set(kinds).size !== kinds.length || !kinds.includes('activity')) return null;
  return Object.freeze({ id, at, type, kinds: Object.freeze([...kinds]) });
}
/** The whole reply, or null when any part of it is wrong. */
export function liveEventsReply(value: unknown): Reply | null {
  if (!isRecord(value) || Object.keys(value).length !== 3) return null;
  const { cursor, events, more } = value;
  if (typeof cursor !== 'string' || !/^[A-Za-z0-9_-]{1,600}$/.test(cursor) || typeof more !== 'boolean' || !Array.isArray(events) || events.length > PAGE) return null;
  const checked = events.map(event);
  return checked.every((item): item is LiveEvent => item !== null) ? { cursor, events: checked, more } : null;
}

/** The desktop's wake source, when the preload offers one. */
export function desktopWake(): ((listener: () => void) => () => void) | undefined {
  const bridge = (globalThis as { window?: { chausar?: { onEngineEvent?: unknown } } }).window?.chausar;
  const onEngineEvent = bridge?.onEngineEvent;
  if (typeof onEngineEvent !== 'function') return undefined;
  return listener => {
    try { const remove = (onEngineEvent as (callback: () => void) => unknown).call(bridge, () => listener()); return typeof remove === 'function' ? () => { try { remove(); } catch { /* gone */ } } : () => {}; }
    catch { return () => {}; }
  };
}

export function createLiveEvents(rpc: PlaceRpc, wake?: (listener: () => void) => () => void, options: LiveEventsOptions = {}): LiveEvents {
  const subscribers = new Set<{ kinds: ReadonlySet<LiveEventKind>; onEvent: (event: LiveEvent) => void }>();
  const hidden = options.hidden ?? (() => typeof document !== 'undefined' && document.hidden === true);
  let cursor: string | null = null, inFlight = false, again = false, stopped = false, disposed = false, failures = 0;
  let unwake: (() => void) | null = null, timer: ReturnType<typeof setInterval> | null = null;

  const deliver = (events: readonly LiveEvent[]) => {
    for (const item of events) for (const subscriber of [...subscribers]) {
      if (!subscribers.has(subscriber) || !item.kinds.some(kind => subscriber.kinds.has(kind))) continue;
      try { subscriber.onEvent(item); } catch { /* One screen never stops another's refresh. */ }
    }
  };
  const halt = () => { unwake?.(); unwake = null; if (timer !== null) clearInterval(timer); timer = null; };
  const active = () => !disposed && !stopped && subscribers.size > 0;
  async function round(): Promise<void> {
    if (!active()) return;
    if (inFlight) { again = true; return; }
    inFlight = true;
    try {
      for (let step = 0; step < FOLLOW && active(); step++) {
        const asked = cursor;
        const reply = liveEventsReply(await rpc.request('events.subscribe', asked === null ? {} : { after: asked }));
        if (!active() || cursor !== asked) return;
        if (reply === null) return;
        failures = 0; cursor = reply.cursor;
        if (asked === null) return;
        deliver(reply.events);
        if (!reply.more) return;
      }
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && NOT_BUILT.has(code)) { stopped = true; halt(); return; }
      if ((typeof code === 'string' && RESET.has(code)) || ++failures >= FAILURES) { cursor = null; failures = 0; }
    } finally {
      inFlight = false;
      if (again) { again = false; void round(); }
    }
  }
  const start = () => {
    if (wake) unwake = wake(() => { void round(); });
    else timer = setInterval(() => { if (!hidden()) void round(); }, options.pollMs ?? 5000);
    void round();
  };
  return {
    subscribe(kinds, onEvent) {
      if (disposed || typeof onEvent !== 'function') return () => {};
      const subscriber = { kinds: new Set(kinds.filter(isKind)), onEvent };
      if (subscriber.kinds.size === 0) return () => {};
      subscribers.add(subscriber);
      if (subscribers.size === 1 && !stopped) start();
      return () => {
        if (!subscribers.delete(subscriber) || subscribers.size > 0) return;
        halt(); cursor = null; again = false;
      };
    },
    dispose() { disposed = true; subscribers.clear(); halt(); cursor = null; },
  };
}
