/**
 * Screen driving (Work, experimental): the replies of the driving lane's `session.*` methods,
 * checked field by field before anything is drawn. Every check returns the typed reply or
 * null; a reply of any other shape is refused whole, never drawn in part. Window titles,
 * program names, file names and the engine's reasons are outside text: they are kept as
 * plain strings and drawn as text only.
 */
import type { Address } from '../../app/presentation.ts';
import { assertISOInstant } from '../../bridge/validate.ts';

/** The sub-place this lane adds under Work. */
export const SCREEN_DRIVING_SUB = 'screen-driving';
/** WK-14, owned by the Work screens: where a session is started. */
export const DRIVING_ADDRESS: Address = { place: 'work', sub: 'driving' };

export const handlesScreenDriving = (address: Address): boolean => address.place === 'work' && address.sub === SCREEN_DRIVING_SUB;

export const METHODS = {
  driver: 'session.driver',
  status: 'session.status',
  plans: 'session.plans',
  history: 'session.history',
  exports: 'session.exports',
  stop: 'session.stop',
  discardExport: 'session.discardExport',
} as const;

export const PLATFORMS = ['x11', 'windows-uia', 'macos-ax', 'fake'] as const;
export type Platform = (typeof PLATFORMS)[number];
export const SESSION_STATES = ['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done'] as const;
export type SessionState = (typeof SESSION_STATES)[number];
export const ACTIVE_STATES: readonly SessionState[] = ['driving', 'sign-in', 'paused-by-you'];
export const STEP_STATES = ['done', 'running', 'failed'] as const;
export type StepState = (typeof STEP_STATES)[number];
export const PLAN_STATUSES = ['experimental', 'tested-synthetic'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface DriverReply {
  readonly platform: Platform | null;
  readonly available: boolean;
  readonly code: string | null;
  readonly reason: string | null;
  readonly stopKey: string;
  readonly rules: { readonly windows: 1; readonly mode: 'read-export'; readonly typesSecrets: false };
}
export interface Step { readonly at: string; readonly text: string; readonly state: StepState }
export interface ExportFile { readonly id: string; readonly name: string; readonly bytes: number }
export interface StatusReply {
  readonly state: SessionState;
  readonly window: { readonly id: string; readonly title: string } | null;
  readonly steps: readonly Step[];
  readonly reason: string | null;
  readonly sessionId: string | null;
  readonly plan: string | null;
  readonly startedAt: string | null;
  readonly exports: readonly ExportFile[];
}
export interface Plan {
  readonly id: string;
  readonly title: string;
  readonly app: string;
  readonly groups: readonly string[];
  readonly produces: string;
  readonly status: PlanStatus;
  readonly steps: readonly string[];
}
export interface PlansReply { readonly plans: readonly Plan[] }
export interface PastSession {
  readonly id: string;
  readonly window: { readonly title: string; readonly app: string };
  readonly plan: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly state: SessionState;
  readonly reason: string | null;
  readonly steps: readonly Step[];
  readonly exports: readonly ExportFile[];
}
export interface HistoryReply { readonly sessions: readonly PastSession[] }
export interface WaitingExport {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly at: string;
  readonly sha256: string;
}
export interface ExportsReply { readonly exports: readonly WaitingExport[] }

/* ------------------------------------------------------------------ checks */

const MAX_LIST = 500;
const MAX_TEXT = 2000;

class Refused extends Error {}
const refuse = (): never => { throw new Refused('INVALID_REPLY'); };
const rec = (v: unknown): Record<string, unknown> => (typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : refuse());
/** Exactly these keys, plus the named optional ones: any other field is a shape this screen does not know. */
const keys = (v: unknown, names: readonly string[], optional: readonly string[] = []): Record<string, unknown> => {
  const r = rec(v);
  if (!names.every(n => Object.prototype.hasOwnProperty.call(r, n)) || !Object.keys(r).every(k => names.includes(k) || optional.includes(k))) refuse();
  return r;
};
const text = (v: unknown, max = MAX_TEXT): string => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v : refuse());
/** A window title as the program wrote it: outside text, possibly empty. */
const title = (v: unknown): string => (typeof v === 'string' && v.length <= 500 ? v : refuse());
const id = (v: unknown): string => (typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v) ? v : refuse());
const maybe = <T>(v: unknown, check: (x: unknown) => T): T | null => (v === null ? null : check(v));
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T => (typeof v === 'string' && (list as readonly string[]).includes(v) ? v as T : refuse());
const list = <T>(v: unknown, check: (x: unknown) => T): T[] => (Array.isArray(v) && v.length <= MAX_LIST ? v.map(check) : refuse());
const instant = (v: unknown): string => { try { assertISOInstant(v); return v; } catch { return refuse(); } };
const bytes = (v: unknown): number => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : refuse());
const code = (v: unknown): string => (typeof v === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(v) ? v : refuse());

const step = (v: unknown): Step => {
  const r = keys(v, ['at', 'text', 'state']);
  return { at: instant(r['at']), text: text(r['text']), state: oneOf(r['state'], STEP_STATES) };
};
const exportFile = (v: unknown): ExportFile => {
  const r = keys(v, ['id', 'name', 'bytes']);
  return { id: id(r['id']), name: text(r['name'], 255), bytes: bytes(r['bytes']) };
};

const guard = <T>(read: () => T): T | null => { try { return read(); } catch (error) { if (error instanceof Refused) return null; throw error; } };

export function checkDriver(reply: unknown): DriverReply | null {
  return guard(() => {
    const r = keys(reply, ['platform', 'available', 'code', 'reason', 'stopKey', 'rules']);
    const rules = keys(r['rules'], ['windows', 'mode', 'typesSecrets']);
    // The rules are fixed: a reply that names any other rule is not one this screen may draw.
    if (rules['windows'] !== 1 || rules['mode'] !== 'read-export' || rules['typesSecrets'] !== false) refuse();
    if (typeof r['available'] !== 'boolean') refuse();
    const available = r['available'] as boolean;
    const platform = maybe(r['platform'], v => oneOf(v, PLATFORMS));
    const why = maybe(r['code'], code);
    const reason = maybe(r['reason'], v => text(v, 500));
    // Available needs a driver; unavailable needs its plain reason.
    if (available && platform === null) refuse();
    if (!available && reason === null) refuse();
    return { platform, available, code: why, reason, stopKey: text(r['stopKey'], 64), rules: { windows: 1, mode: 'read-export', typesSecrets: false } };
  });
}

export function checkStatus(reply: unknown): StatusReply | null {
  return guard(() => {
    // `stopKey` may ride along (the engine repeats it); this screen reads the stop key from `session.driver`.
    const r = keys(reply, ['state', 'window', 'steps', 'reason', 'sessionId', 'plan', 'startedAt', 'exports'], ['stopKey']);
    if ('stopKey' in r) text(r['stopKey'], 64);
    const window = maybe(r['window'], v => { const w = keys(v, ['id', 'title']); return { id: text(w['id'], 200), title: title(w['title']) }; });
    return {
      state: oneOf(r['state'], SESSION_STATES),
      window,
      steps: list(r['steps'], step),
      reason: maybe(r['reason'], v => text(v, 500)),
      sessionId: maybe(r['sessionId'], id),
      plan: maybe(r['plan'], id),
      startedAt: maybe(r['startedAt'], instant),
      exports: list(r['exports'], exportFile),
    };
  });
}

export function checkPlans(reply: unknown): PlansReply | null {
  return guard(() => {
    const r = keys(reply, ['plans']);
    return {
      plans: list(r['plans'], v => {
        // `verified` (whether the plan was run against the real program) may ride along beside its label.
        const p = keys(v, ['id', 'title', 'app', 'groups', 'produces', 'status', 'steps'], ['verified']);
        if ('verified' in p && typeof p['verified'] !== 'boolean') refuse();
        return { id: id(p['id']), title: text(p['title'], 200), app: text(p['app'], 200), groups: list(p['groups'], g => text(g, 100)),
          produces: text(p['produces'], 500), status: oneOf(p['status'], PLAN_STATUSES), steps: list(p['steps'], s => text(s, 500)) };
      }),
    };
  });
}

export function checkHistory(reply: unknown): HistoryReply | null {
  return guard(() => {
    const r = keys(reply, ['sessions']);
    const sessions = list(r['sessions'], v => {
      const h = keys(v, ['id', 'window', 'plan', 'startedAt', 'endedAt', 'state', 'reason', 'steps', 'exports']);
      const w = keys(h['window'], ['title', 'app']);
      return { id: id(h['id']), window: { title: title(w['title']), app: text(w['app'], 200) }, plan: id(h['plan']), startedAt: instant(h['startedAt']),
        endedAt: maybe(h['endedAt'], instant), state: oneOf(h['state'], SESSION_STATES), reason: maybe(h['reason'], v2 => text(v2, 500)),
        steps: list(h['steps'], step), exports: list(h['exports'], exportFile) };
    });
    // Newest first, by the instant each started; the engine's order is not relied on.
    return { sessions: [...sessions].sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt)) };
  });
}

export function checkExports(reply: unknown): ExportsReply | null {
  return guard(() => {
    const r = keys(reply, ['exports']);
    return {
      exports: list(r['exports'], v => {
        const e = keys(v, ['id', 'sessionId', 'name', 'mediaType', 'bytes', 'at', 'sha256']);
        const mediaType = typeof e['mediaType'] === 'string' && /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(e['mediaType']) && e['mediaType'].length <= 127 ? e['mediaType'] : refuse();
        const sha256 = typeof e['sha256'] === 'string' && /^[0-9a-f]{64}$/.test(e['sha256']) ? e['sha256'] : refuse();
        return { id: id(e['id']), sessionId: id(e['sessionId']), name: text(e['name'], 255), mediaType, bytes: bytes(e['bytes']), at: instant(e['at']), sha256 };
      }),
    };
  });
}

/* ------------------------------------------------------------------ refusals */

export const NOT_BUILT_CODES: readonly string[] = ['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE'];
/** The short code an engine refusal carries, or REQUEST_FAILED. Never the raw message. */
export function codeOf(error: unknown): string {
  const c = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof c === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(c) ? c : 'REQUEST_FAILED';
}
export const isNotBuilt = (error: unknown): boolean => NOT_BUILT_CODES.includes(codeOf(error));
