import { createHash } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { audit, check, type Context, type State } from '../contracts.ts';
import { BUILT_IN_PLANS, describePlan, planFor, type Plan } from '../driving/plans.ts';
import { selectDriver } from '../driving/select.ts';
import { DrivingController, EXPORT_NAME, type DrivingState, type SessionRecord } from '../driving/session.ts';
import { moduleState, peekModuleState, type EngineModule, type ModuleHost } from './types.ts';

/**
 * The driving lane: WK-14 "Chausar is driving" (experimental). `session.*` drives one window
 * on this computer, read and export only, through the desktop driver in this engine process;
 * the desktop main process draws the always-on-top strip and the tray Stop from the
 * `driving-status` messages sent here. Exports a session makes are kept for a day for the
 * connectors lane to read in (`session.exports`, `session.readExport`). Only the owning lane
 * edits this file.
 */
const RULES = Object.freeze({ windows: 1, mode: 'read-export', typesSecrets: false } as const);
const EXPORT_TTL_MS = 24 * 60 * 60_000;
const HISTORY_LIMIT = 50;

type StoredExport = { id: string; sessionId: string; name: string; mediaType: string; bytes: number; sha256: string; at: string };
type StoredSession = Omit<SessionRecord, 'exports' | 'workspaceId'> & { exports: StoredExport[] };
type DrivingStore = { sessions: StoredSession[]; exports: StoredExport[] };
const init = (): DrivingStore => ({ sessions: [], exports: [] });

const REQUEST = 'INVALID_SESSION_REQUEST';
function exact(payload: Record<string, any>, allowed: string[], required: string[] = []) {
  check(Object.keys(payload).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(payload, key)), REQUEST, 'Use only the declared request fields.');
}
const id = (value: unknown, prefix: string) => typeof value === 'string' && value.length <= 80 && new RegExp(`^${prefix}_[a-f0-9]{18}$`).test(value);

/** Finished sessions wait here until a request with that workspace open records them. */
const pending: SessionRecord[] = [];

function controller(host: ModuleHost): DrivingController {
  const value = host.options.controller;
  check(value instanceof DrivingController, 'DRIVER_UNAVAILABLE', 'Driving is not available here.');
  return value;
}
function plans(host: ModuleHost): readonly Plan[] { return controller(host).options.plans; }
/** The open workspace's id, or null while locked. */
function openWorkspace(host: ModuleHost): string | null {
  try { return host.store.read().workspace.id; } catch { return null; }
}
const strip = (item: StoredExport): StoredExport => ({ id: item.id, sessionId: item.sessionId, name: item.name, mediaType: item.mediaType, bytes: item.bytes, sha256: item.sha256, at: item.at });
const fresh = (item: StoredExport, at = Date.now()) => Date.parse(item.at) + EXPORT_TTL_MS > at;

/** Records finished sessions for the open workspace and forgets expired exports. Housekeeping: a read-only workspace keeps them waiting. */
async function settle(host: ModuleHost, workspaceId: string | null): Promise<void> {
  if (workspaceId === null) return;
  try { await record(host, workspaceId); } catch { /* recorded on a later request */ }
}
async function record(host: ModuleHost, workspaceId: string): Promise<void> {
  const mine = pending.filter(record => record.workspaceId === workspaceId);
  const stored = peekModuleState<DrivingStore>(host.store.read(), 'driving');
  const expired = stored?.exports.some(item => !fresh(item)) ?? false;
  if (mine.length === 0 && !expired) return;
  await host.store.update(state => {
    check(state.workspace.id === workspaceId, 'DRIVING_WORKSPACE_CHANGED', 'The workspace changed. Open it again.');
    const store = moduleState(state, 'driving', init);
    for (const record of mine) {
      if (store.sessions.some(s => s.id === record.id)) continue;
      const exports = record.exports.map(item => strip(item));
      store.sessions.unshift({ ...structuredClone({ id: record.id, memberId: record.memberId, window: record.window, plan: record.plan, startedAt: record.startedAt, endedAt: record.endedAt, state: record.state, reason: record.reason, steps: record.steps }), exports });
      store.exports.push(...exports);
      audit(state, 'driving.session', { sessionId: record.id, plan: record.plan, state: record.state, exports: exports.length });
    }
    store.sessions.splice(HISTORY_LIMIT);
    store.exports = store.exports.filter(item => fresh(item));
  });
  for (const record of mine) pending.splice(pending.indexOf(record), 1);
  const kept = new Set((peekModuleState<DrivingStore>(host.store.read(), 'driving')?.exports ?? []).map(item => item.sessionId));
  await controller(host).sweep(workspaceId, sessionId => kept.has(sessionId) || pending.some(record => record.id === sessionId)).catch(() => 0);
}

function publicStatus(c: DrivingController, record: SessionRecord | null) {
  if (!record) return { state: 'idle' as DrivingState, window: null, steps: [], reason: null, sessionId: null, plan: null, startedAt: null, exports: [], stopKey: c.stopKey };
  return { state: record.state, window: { id: record.window.id, title: record.window.title }, steps: record.steps.map(step => ({ ...step })), reason: record.reason,
    sessionId: record.id, plan: record.plan, startedAt: record.startedAt, exports: record.exports.map(item => ({ id: item.id, name: item.name, bytes: item.bytes })), stopKey: c.stopKey };
}
/** A session belongs to the workspace it started in: any other open workspace, or none, stops it. */
function guard(host: ModuleHost, workspaceId: string | null) {
  const active = controller(host).active;
  if (active && active.workspaceId !== workspaceId) controller(host).stop('lock');
}
function exportFor(host: ModuleHost, exportId: unknown): StoredExport & { path: string } {
  check(id(exportId, 'export'), REQUEST, 'Choose one of the listed exports.');
  const state = host.store.read();
  const item = peekModuleState<DrivingStore>(state, 'driving')?.exports.find(x => x.id === exportId && fresh(x));
  check(item && EXPORT_NAME.test(item.name) && id(item.sessionId, 'drive'), 'EXPORT_NOT_FOUND', 'That export is no longer kept.');
  return { ...item, path: join(resolve(controller(host).options.exportRoot), state.workspace.id, item.sessionId, item.name) };
}
function person(ctx: Context) {
  // Only a person at this computer starts driving: never a phone, an assistant or anything that read outside text.
  check((ctx.channel ?? 'desktop') === 'desktop' && ctx.sourceTainted !== true, 'TAINTED_REQUEST', 'Only you, at this computer, can start Chausar driving.');
}

export const drivingModule: EngineModule = {
  id: 'driving',
  hostOptions({ directory, demo, env }) {
    const exportRoot = join(resolve(directory), 'driving-exports');
    const desktop = env.CHAUSAR_DESKTOP_DRIVER === '1' && !demo && typeof process.send === 'function';
    let stopKey = 'Ctrl Alt Pause';
    const notify = (state: DrivingState, active: boolean) => { if (desktop && process.connected) process.send!({ kind: 'driving-status', state, active, stopKey }, () => {}); };
    const unavailable = demo ? { code: 'DRIVER_UNAVAILABLE', reason: 'Synthetic demo mode keeps driving other programs turned off.' }
      : env.CHAUSAR_DESKTOP_DRIVER !== '1' ? { code: 'DRIVER_UNAVAILABLE', reason: 'Driving works only in the installed desktop app.' } : undefined;
    const driver = unavailable ? null : selectDriver({ platform: process.platform, env, excludePids: [process.pid, process.ppid] });
    stopKey = driver?.stopKey ?? stopKey;
    const made = new DrivingController({ driver, exportRoot, plans: BUILT_IN_PLANS, notify,
      unavailable: unavailable ?? (driver ? undefined : { code: 'DRIVER_UNAVAILABLE', reason: 'This computer\'s desktop cannot be driven: it needs X11 on Linux, Windows or macOS.' }) });
    if (desktop) {
      // The strip and tray reach the session directly over the worker channel, so a busy or
      // closing engine never refuses Stop. Continue is a person's click on the strip or tray.
      process.on('message', (message: any) => {
        if (message === null || typeof message !== 'object' || message.kind !== 'driving-control' || Object.keys(message).length !== 2) return;
        if (message.action === 'stop') made.stop('person');
        else if (message.action === 'resume') { try { made.resume(); } catch { /* nothing paused */ } }
      });
      // The desktop going away stops driving at once.
      process.on('disconnect', () => made.stop('person'));
    }
    return { controller: made };
  },
  purge(state: State, reason) {
    const store = peekModuleState<DrivingStore>(state, 'driving');
    if (!store || reason.cutoff === undefined) return 0;
    const before = store.sessions.length + store.exports.length;
    store.sessions = store.sessions.filter(s => Date.parse(s.endedAt ?? s.startedAt) >= reason.cutoff!);
    store.exports = store.exports.filter(e => Date.parse(e.at) >= reason.cutoff!);
    return before - store.sessions.length - store.exports.length;
  },
  methods: {
    /** Whether Chausar can drive a window on this computer, and the rules it keeps. */
    'session.driver': { permission: 'read', preVault: true, async handler(_ctx, payload, host) {
      exact(payload, []);
      const c = controller(host); const a = await c.availability();
      return { platform: c.platform, available: a.ok, code: a.code, reason: a.reason, stopKey: c.stopKey, rules: RULES };
    } },
    /** The windows a person may choose from (never Chausar's own). */
    'session.windows': { permission: 'read', async handler(ctx, payload, host) {
      exact(payload, []);
      // Window titles on this desktop are for the seats that may start driving.
      if (!['owner', 'cofounder'].includes(ctx.role)) return { windows: [], available: false, code: 'FORBIDDEN', reason: 'An owner chooses the window.' };
      // No driver here: an empty list with the reason, so the WK-14 screen draws instead of failing.
      const a = await controller(host).availability();
      if (!a.ok) return { windows: [], available: false, code: a.code, reason: a.reason };
      const list = await controller(host).windows();
      return { windows: list.map(w => ({ id: w.id, title: w.title, app: w.app })), available: true, code: null, reason: null };
    } },
    /** The session now. Also stops a session whose workspace has locked or changed. */
    'session.status': { permission: 'read', preVault: true, async handler(_ctx, payload, host) {
      exact(payload, []);
      const workspaceId = openWorkspace(host);
      guard(host, workspaceId);
      await settle(host, workspaceId);
      return publicStatus(controller(host), controller(host).status(workspaceId));
    } },
    /** Start driving one window, read and export only. Starting is an owner's decision. */
    'session.start': { permission: 'approve', async handler(ctx, payload, host) {
      exact(payload, ['windowId', 'mode', 'typesSecrets', 'plan'], ['windowId', 'mode', 'typesSecrets']);
      // Demo mode keeps every outside program untouched; only a trusted test host may drive a synthetic window there.
      check(!host.demo || host.options.allowDemo === true, 'DEMO_EXTERNAL_DISABLED', 'Synthetic demo mode keeps driving other programs turned off.');
      person(ctx);
      check(payload.mode === RULES.mode && payload.typesSecrets === false, REQUEST, 'Chausar only reads and exports, and never types a secret.');
      check(typeof payload.windowId === 'string' && payload.windowId.length <= 200, REQUEST, 'Choose one window.');
      check(payload.plan === undefined || (typeof payload.plan === 'string' && payload.plan.length <= 64), REQUEST, 'Choose one of the listed plans.');
      const plan = planFor(plans(host), payload.plan ?? 'window.picture');
      const workspaceId = openWorkspace(host);
      check(workspaceId, 'DRIVING_WORKSPACE_CHANGED', 'Open the workspace first.');
      await settle(host, workspaceId);
      const record = await controller(host).start({ windowId: payload.windowId, plan, workspaceId, memberId: ctx.memberId,
        probe: () => openWorkspace(host) === workspaceId, finished: done => { pending.push(done); pending.splice(0, Math.max(0, pending.length - 20)); } });
      return publicStatus(controller(host), record);
    } },
    /** Stop. Anyone at this computer may stop, even before a workspace is open. */
    'session.stop': { permission: 'read', preVault: true, async handler(_ctx, payload, host) {
      exact(payload, []);
      controller(host).stop('person');
      const workspaceId = openWorkspace(host);
      await settle(host, workspaceId);
      return publicStatus(controller(host), controller(host).status(workspaceId));
    } },
    /** Continue after "You moved the mouse. Paused." or after signing in. */
    'session.resume': { permission: 'approve', async handler(ctx, payload, host) {
      exact(payload, []); person(ctx);
      const workspaceId = openWorkspace(host); guard(host, workspaceId);
      return publicStatus(controller(host), controller(host).resume());
    } },
    /** What Chausar can export by driving, and from which program. */
    'session.plans': { permission: 'read', async handler(_ctx, payload, host) {
      exact(payload, ['group']);
      check(payload.group === undefined || (typeof payload.group === 'string' && payload.group.length <= 60), REQUEST, 'Name one connector group.');
      return { plans: plans(host).filter(p => payload.group === undefined || p.groups.includes(payload.group)).map(describePlan) };
    } },
    /** Earlier sessions in this workspace, newest first. */
    'session.history': { permission: 'read', async handler(_ctx, payload, host) {
      exact(payload, []);
      await settle(host, openWorkspace(host));
      const store = peekModuleState<DrivingStore>(host.store.read(), 'driving');
      return { sessions: (store?.sessions ?? []).map(s => ({ id: s.id, window: { title: s.window.title, app: s.window.app }, plan: s.plan, startedAt: s.startedAt, endedAt: s.endedAt,
        state: s.state, reason: s.reason, steps: s.steps.map(step => ({ ...step })), exports: s.exports.map(e => ({ id: e.id, name: e.name, bytes: e.bytes })) })) };
    } },
    /** Exports waiting to be read in (kept for a day). */
    'session.exports': { permission: 'read', async handler(_ctx, payload, host) {
      exact(payload, ['sessionId']);
      check(payload.sessionId === undefined || id(payload.sessionId, 'drive'), REQUEST, 'Name one session.');
      await settle(host, openWorkspace(host));
      const store = peekModuleState<DrivingStore>(host.store.read(), 'driving');
      return { exports: (store?.exports ?? []).filter(e => fresh(e) && (payload.sessionId === undefined || e.sessionId === payload.sessionId)).map(strip) };
    } },
    /** One export's content, checked against its digest: text for text formats, base64 otherwise. */
    'session.readExport': { permission: 'prepare', async handler(_ctx, payload, host) {
      exact(payload, ['exportId'], ['exportId']);
      const item = exportFor(host, payload.exportId);
      let bytes: Buffer;
      try { bytes = await readFile(item.path); } catch { check(false, 'EXPORT_NOT_FOUND', 'That export is no longer kept.'); }
      check(bytes.length === item.bytes && createHash('sha256').update(bytes).digest('hex') === item.sha256, 'EXPORT_CHANGED', 'The export changed on disk after Chausar kept it. Export it again.');
      const textual = /^(text\/|application\/(xml|json))/.test(item.mediaType);
      let text: string | null = null;
      if (textual) { try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { text = null; } }
      return { ...strip(item), ...(text !== null ? { text } : { base64: bytes.toString('base64') }) };
    } },
    /** Delete one export now. */
    'session.discardExport': { permission: 'prepare', async handler(_ctx, payload, host) {
      exact(payload, ['exportId'], ['exportId']);
      const item = exportFor(host, payload.exportId);
      await unlink(item.path).catch(() => {});
      await host.store.update(state => {
        const store = moduleState(state, 'driving', init);
        store.exports = store.exports.filter(e => e.id !== item.id);
        audit(state, 'driving.exportDiscarded', { exportId: item.id, sessionId: item.sessionId });
      });
      try { await stat(item.path); check(false, 'EXPORT_NOT_FOUND', 'The export could not be deleted.'); } catch (error) { if ((error as any)?.code === 'EXPORT_NOT_FOUND') throw error; }
      return { discarded: true };
    } },
  },
};

