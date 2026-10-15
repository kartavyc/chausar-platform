/**
 * Chausar is driving (WK-14, experimental). A thin pass-through to the driving lane's `session.*`
 * (`platform/runtime/modules/lane-driving.ts` on `claude/lane-driving`: status, windows, start,
 * resume, stop). Without that lane every method answers `{ available: false }` and the screen
 * shows "not built yet". Nothing here drives anything.
 *
 * The rules travel with every start request and are checked again on every reply: one window
 * only, read and export only, never a password, a one-time code or a captcha.
 */
import { check } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';

const STATES = ['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done'] as const;
const STEP_STATES = ['done', 'running', 'failed'] as const;
export type DrivingState = typeof STATES[number];
export type DrivingStep = { at: string; text: string; state: typeof STEP_STATES[number] };
export type DrivingStatus = { state: DrivingState; window: { id: string; title: string } | null; steps: DrivingStep[]; reason: string | null;
  /** Round 4, the driving lane's real `session.status`: the files the session exported (kept a day for the connectors lane). */
  exports?: { id: string; name: string; bytes: number }[] };
export type DrivingWindow = { id: string; title: string; app: string };
export const DRIVING_RULES = Object.freeze({ windows: 1, mode: 'read-export', typesSecrets: false } as const);

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f]/.test(value);
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
function exact(payload: unknown, keys: string[]) {
  check(record(payload) && Object.keys(payload).every(k => keys.includes(k)) && keys.every(k => Object.hasOwn(payload, k)), 'INVALID_DRIVING_REQUEST', 'Use only the declared request fields.');
}

/** A session reply checked field by field. A reply that does not fit is refused, never drawn. */
function status(value: unknown): DrivingStatus {
  check(record(value) && (STATES as readonly unknown[]).includes(value.state) && Array.isArray(value.steps) && value.steps.length <= 200, 'INVALID_SESSION_REPLY', 'The driving session sent a reply that does not fit.');
  const w = value.window;
  check(w === null || w === undefined || (record(w) && text(w.id, 200) && text(w.title)), 'INVALID_SESSION_REPLY', 'The driving session sent a reply that does not fit.');
  const steps = value.steps.map((s: unknown) => {
    check(record(s) && instant(s.at) && text(s.text, 1000) && (STEP_STATES as readonly unknown[]).includes(s.state), 'INVALID_SESSION_REPLY', 'The driving session sent a reply that does not fit.');
    return { at: s.at, text: s.text, state: s.state };
  });
  const exports = (Array.isArray(value.exports) ? value.exports : []).filter((x: unknown) => record(x) && text(x.id, 200) && text(x.name, 200) && Number.isSafeInteger(x.bytes) && (x.bytes as number) >= 0)
    .slice(0, 50).map((x: any) => ({ id: x.id as string, name: x.name as string, bytes: x.bytes as number }));
  return { state: value.state, window: w ? { id: w.id, title: w.title } : null, steps, reason: text(value.reason) ? value.reason : null, ...(exports.length ? { exports } : {}) };
}
function windows(value: unknown): DrivingWindow[] {
  check(record(value) && Array.isArray(value.windows) && value.windows.length <= 100, 'INVALID_SESSION_REPLY', 'The driving session sent a reply that does not fit.');
  return value.windows.map((x: unknown) => {
    check(record(x) && text(x.id, 200) && text(x.title) && text(x.app, 200), 'INVALID_SESSION_REPLY', 'The driving session sent a reply that does not fit.');
    return { id: x.id, title: x.title, app: x.app };
  });
}
const absent = { available: false as const, rules: DRIVING_RULES };
async function passThrough(host: ModuleHost, method: string, payload: Record<string, unknown>) {
  const result = await optionalCall(host, method, payload);
  return result.available ? { available: true as const, rules: DRIVING_RULES, status: status(result.value) } : absent;
}

export const workDrivingMethods: Readonly<Record<string, MethodSpec>> = {
  /** The session now, and the windows Chausar may use. */
  'approvals.drivingStatus': { permission: 'read', async handler(_ctx, payload, host) {
    exact(payload, []);
    const now = await optionalCall(host, 'session.status', {});
    if (!now.available) return absent;
    const list = await optionalCall(host, 'session.windows', {});
    // The driving lane answers `{ windows: [], available: false, code, reason }` where this computer cannot be driven (DRIVER_UNAVAILABLE).
    const driver = list.available && record(list.value) && list.value.available === false
      ? { available: false as const, code: text(list.value.code, 80) && /^[A-Z][A-Z0-9_]*$/.test(list.value.code) ? list.value.code : 'DRIVER_UNAVAILABLE' } : { available: true as const, code: null };
    return { available: true as const, rules: DRIVING_RULES, status: status(now.value), windows: list.available ? windows(list.value) : [], driver };
  } },
  /** Start driving one window, read and export only. Starting is the owner's decision. */
  'approvals.drivingStart': { permission: 'approve', async handler(_ctx, payload, host) {
    exact(payload, ['windowId']);
    check(text(payload.windowId, 200), 'INVALID_DRIVING_REQUEST', 'Choose one window.');
    const reply = await passThrough(host, 'session.start', { windowId: payload.windowId, mode: DRIVING_RULES.mode, typesSecrets: false });
    // One window only: a session that reports another window is refused.
    check(!reply.available || reply.status.window === null || reply.status.window.id === payload.windowId, 'SESSION_WINDOW_CHANGED', 'The session is not on the window you chose.');
    return reply;
  } },
  /** Continue after "You moved the mouse. Paused." or after signing in yourself. */
  'approvals.drivingContinue': { permission: 'approve', async handler(_ctx, payload, host) {
    exact(payload, []); return passThrough(host, 'session.resume', {});
  } },
  /** Stop. Ctrl Alt Pause and the tray do the same outside the app. */
  'approvals.drivingStop': { permission: 'prepare', async handler(_ctx, payload, host) {
    exact(payload, []); return passThrough(host, 'session.stop', {});
  } },
};
