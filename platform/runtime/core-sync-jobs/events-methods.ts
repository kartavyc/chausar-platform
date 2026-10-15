/**
 * `events.subscribe` (round 4, core-sync-jobs; SH-01, TD-01, TD-03, TD-04, WK-01, WK-04, WK-07, BK-01): what changed
 * since a cursor, as typed event codes a screen may see, so it knows which of its reads to refresh.
 *
 * Request `{ kinds?: Kind[]; after?: string }`. Without `after` the reply is the current head cursor and no events: the
 * starting point. With `after` it is up to 200 events after that cursor, oldest first, whose kinds meet the requested
 * kinds (every kind when omitted), and `more: true` when more remain. The reply is immediate: the engine never holds a
 * request open waiting for change (a held request would keep the vault from locking). The desktop pushes a bare
 * sequence number when something changed (`EngineEventBus`); other hosts poll.
 *
 * Visibility and typing are `activity.list`'s, through `auditEvents` (frame-today/activity.ts): a member sees only the
 * records that rule allows, as safe type codes. Values, names and amounts never travel here.
 *
 * The cursor is opaque: the workspace and the last delivered record's time and id. Records are read in the order they
 * were written. When the cursor's record is gone (retention trimmed it, or it is no longer visible) the events from
 * its time on are delivered again rather than missed. A cursor from another workspace, a malformed cursor or an unknown
 * kind refuses `INVALID_EVENTS_REQUEST`.
 */
import { check } from '../contracts.ts';
import { auditEvents, type ActivityEvent } from '../frame-today/activity.ts';
import type { MethodSpec } from '../modules/types.ts';

export type Kind = 'activity' | 'approvals' | 'actions' | 'jobs' | 'sources' | 'books' | 'answers' | 'trust' | 'devices' | 'workspace' | 'lessons';
export const KINDS: readonly Kind[] = ['activity', 'approvals', 'actions', 'jobs', 'sources', 'books', 'answers', 'trust', 'devices', 'workspace', 'lessons'];
export type LiveEvent = { id: string; at: string; type: string; kinds: Kind[] };
export const EVENTS_PAGE = 200;

const RULES: readonly [RegExp, readonly Kind[]][] = [
  [/^action\./, ['actions', 'approvals']], [/^job\./, ['jobs', 'approvals']],
  [/^(?:import|source|connector)\./, ['sources', 'books']], [/^dictionary\./, ['books', 'approvals']],
  [/^(?:answer\.|calculation)/, ['answers']], [/^(?:member|trust|auth)\./, ['trust']],
  [/^(?:sync|device)\./, ['devices']], [/^(?:workspace|vault|release)\./, ['workspace']], [/^lesson\./, ['lessons', 'approvals']],
];
/** Every event is `activity`; its type adds the kinds of the screens it touches. */
export function eventKinds(type: string): Kind[] {
  const kinds: Kind[] = ['activity'];
  for (const [pattern, added] of RULES) if (pattern.test(type)) for (const kind of added) if (!kinds.includes(kind)) kinds.push(kind);
  return kinds;
}

type Cursor = { workspaceId: string; at: string; id: string };
function invalid(condition: unknown, message: string): asserts condition { check(condition, 'INVALID_EVENTS_REQUEST', message); }
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify(['e1', cursor.workspaceId, cursor.at, cursor.id])).toString('base64url');
function decode(text: unknown): Cursor {
  invalid(typeof text === 'string' && text.length > 0 && text.length <= 600 && /^[A-Za-z0-9_-]+$/.test(text), 'Use the cursor from the previous reply.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { parsed = null; }
  invalid(Array.isArray(parsed) && parsed.length === 4 && parsed[0] === 'e1' && parsed.slice(1).every(item => typeof item === 'string' && item.length <= 200), 'Use the cursor from the previous reply.');
  return { workspaceId: parsed[1], at: parsed[2], id: parsed[3] };
}
function request(payload: Record<string, unknown>): { kinds: readonly Kind[]; after: Cursor | null } {
  invalid(Object.keys(payload).every(key => key === 'kinds' || key === 'after'), 'Use only kinds and after.');
  const kinds = payload.kinds;
  invalid(kinds === undefined || (Array.isArray(kinds) && kinds.length > 0 && kinds.length <= KINDS.length && kinds.every(kind => (KINDS as readonly unknown[]).includes(kind))), 'Choose known event kinds.');
  return { kinds: (kinds as Kind[] | undefined) ?? KINDS, after: payload.after === undefined ? null : decode(payload.after) };
}

export function subscribeEvents(events: readonly ActivityEvent[], workspaceId: string, payload: Record<string, unknown>) {
  const { kinds, after } = request(payload);
  const head = (event: ActivityEvent | undefined, fallback: Cursor) => encode(event ? { workspaceId, at: event.at, id: event.id } : fallback);
  if (after === null) return { cursor: head(events.at(-1), { workspaceId, at: '', id: '' }), events: [] as LiveEvent[], more: false };
  invalid(after.workspaceId === workspaceId, 'Start again from the current workspace.');
  const index = after.id === '' ? -1 : events.findIndex(event => event.id === after.id);
  const rest = after.id === '' ? events : index >= 0 ? events.slice(index + 1) : events.filter(event => event.at >= after.at && event.id !== after.id);
  const delivered: LiveEvent[] = [];
  let last: ActivityEvent | undefined, more = false;
  for (const event of rest) {
    const eventKindsList = eventKinds(event.type);
    if (eventKindsList.some(kind => kinds.includes(kind))) {
      if (delivered.length === EVENTS_PAGE) { more = true; break; }
      delivered.push({ id: event.id, at: event.at, type: event.type, kinds: eventKindsList });
    }
    last = event;
  }
  return { cursor: last ? head(last, after) : encode(after), events: delivered, more };
}

export const eventMethods: Record<string, MethodSpec> = {
  'events.subscribe': { permission: 'read', phone: false, handler(ctx, payload, host) {
    return subscribeEvents(auditEvents(host.store, ctx), host.store.read().workspace.id, payload);
  } },
};
