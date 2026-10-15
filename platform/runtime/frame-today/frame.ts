/**
 * The frame-today read models: shell banners, the status line, capabilities, worth a look,
 * first run, help, the fault report and the phone message counts. Every reply is built from
 * engine state or another engine method called as the same caller; a fact the engine does not
 * hold yet is left out (a banner) or stated as a missing state, never invented.
 */
import { createRequire } from 'node:module';
import { authorize, check, now, type Context, type State } from '../contracts.ts';
import { moduleState, peekModuleState, type ModuleHost } from '../modules/types.ts';
import { moduleMethods } from '../modules/registry.ts';
import { auditEvents, visibleAudit } from './activity.ts';
import type { IdentityCard } from './identity.ts';
import type { IdeaState } from './idea.ts';
import type { RecoveryContact } from './recovery.ts';
import type { CashEntry } from './cash.ts';

export const MODULE_ID = 'frame-today';
export type FrameState = {
  clock: { date: string; setAt: string } | null;
  autoLockMinutes: number;
  /** Per member: when that seat last dismissed the jobs-paused banner. */
  jobsPausedDismissedAt: Record<string, string>;
  identity: IdentityCard | null;
  /** FR-11: the founder's idea, as typed. Absent in workspaces written before it existed. */
  idea?: IdeaState | null;
  /** FR-13/SH-02: the person the owner names to help recover the vault. Kept only in the vault. */
  recoveryContact: RecoveryContact | null;
  /** TD-01: the daily closing row. Off until an admin turns it on. */
  dailyClosing?: boolean;
  /** SH-08: the last update this workspace applied, from which version, and when; cleared when dismissed. */
  update?: { version: string; from: string; at: string } | null;
  /** TD-02: each business day's cash as the owner told it (todayx.cash.save). Absent until told. */
  cash?: Record<string, CashEntry>;
};
export const initFrame = (): FrameState => ({ clock: null, autoLockMinutes: 10, jobsPausedDismissedAt: {}, identity: null, idea: null, recoveryContact: null, dailyClosing: false });
export const frameOf = (state: State): FrameState => ({ ...initFrame(), ...peekModuleState<FrameState>(state, MODULE_ID) });
export async function updateFrame<T>(host: ModuleHost, ctx: Context, permission: 'read' | 'prepare' | 'admin', change: (frame: FrameState, state: State) => T): Promise<T> {
  return host.store.update(state => {
    authorize({ read: () => state, update: host.store.update.bind(host.store) }, ctx, permission);
    const frame = moduleState(state, MODULE_ID, initFrame);
    frame.jobsPausedDismissedAt ??= {};
    return change(frame, state);
  });
}

/** A source whose oldest read is older than this many days makes the status line say stale. */
export const STALE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;
const isoDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export const validDay = isoDay;
const isIso = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[0-9:.]+Z?)?$/.test(value) && !Number.isNaN(Date.parse(value));
/** Business "today": the demo clock in a demo workspace that has set it, otherwise the real UTC date. */
export function businessToday(state: State): string {
  const frame = frameOf(state);
  return state.workspace.demo && frame.clock ? frame.clock.date : now().slice(0, 10);
}
async function quiet<T>(work: () => Promise<T> | T): Promise<T | null> { try { return await work(); } catch { return null; } }

/* ------------------------------------------------------------------ shell */

/** Another machine holds the one-writer pen: only from a configured sync writer admission. */
export async function penHolder(host: ModuleHost): Promise<string | null> {
  const status: any = await quiet(() => host.call('sync.writer.status', {}));
  return status?.available === true && status.readonly === true && status.reason === 'SYNC_WRITER_DEVICE_MISMATCH'
    && typeof status.grant?.deviceId === 'string' ? status.grant.deviceId : null;
}

/** Jobs that missed their time while Chausar was closed: catch-up skips, or runs overdue with background off. */
async function jobsPausedSince(host: ModuleHost): Promise<string | null> {
  const [types, jobs]: any[] = await Promise.all([quiet(() => host.call('jobs.types', {})), quiet(() => host.call('jobs.list', {}))]);
  if (!Array.isArray(jobs)) return null;
  const background = types?.lifecycle?.backgroundEnabled === true, at = Date.now();
  let latest: string | null = null;
  const note = (time: unknown) => { if (isIso(time) && (latest === null || time > latest)) latest = time; };
  for (const job of jobs) {
    for (const entry of Array.isArray(job?.ledger) ? job.ledger : []) if (entry?.event === 'catchup-skipped') note(entry.at);
    if (!background && job?.status === 'scheduled' && isIso(job.nextRunAt) && Date.parse(job.nextRunAt) < at) note(job.nextRunAt);
  }
  return latest;
}

/** A method another lane serves: its reply, `absent` when no lane registers it, or null when it failed. */
const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);
export async function optional(host: ModuleHost, method: string, payload: Record<string, unknown> = {}): Promise<{ absent: true } | { absent: false; value: any } | null> {
  try { return { absent: false, value: await host.call(method, payload) }; }
  catch (error: any) { return ABSENT.has(error?.code) ? { absent: true } : null; }
}
const valueOf = (reply: Awaited<ReturnType<typeof optional>>): any => reply && !reply.absent ? reply.value : null;
const title = (text: unknown): text is string => typeof text === 'string' && text.trim().length > 0 && text.length <= 200 && !/[\u0000-\u001f]/.test(text);

/**
 * SH-03 "Chausar is driving": the driving lane's `session.status`, while a session holds a window. These are the
 * lane's own active states (`driving/session.ts` ACTIVE); `step-failed`, like `stopped` and `done`, has ended and
 * stays the last status until the next session, so it shows no banner.
 */
const DRIVING = new Set(['driving', 'sign-in', 'paused-by-you']);
export async function drivingNow(host: ModuleHost) {
  const status = valueOf(await optional(host, 'session.status'));
  return DRIVING.has(status?.state) && title(status?.window?.title) ? { kind: 'driving' as const, program: status.window.title as string } : null;
}

/** SH-03 "Sending is closed": work-books' `approvals.afterRestore`. Only the actions this caller may see are counted. */
async function sendingClosed(host: ModuleHost) {
  const restore = valueOf(await optional(host, 'approvals.afterRestore'));
  if (restore?.sendingClosed !== true) return null;
  const seen = Array.isArray(restore.items) ? restore.items.length : 0;
  return { kind: 'sending-closed' as const, restoredFrom: isIso(restore.restoredFrom) ? restore.restoredFrom as string : null, unchecked: seen > 0 ? String(seen) : null };
}

/** SH-03 "No connection": core-gateway-auth's `network.online`. Absent, it never shows. */
async function noConnection(host: ModuleHost) {
  return valueOf(await optional(host, 'network.online'))?.online === false ? { kind: 'no-connection' as const } : null;
}

/**
 * SH-03/SH-08 "Update needed": the release lane's `release.status` (an expired preview build, a withdrawn
 * release, or a vault a newer build wrote). The core `updates.status` is read only when release is absent.
 */
export async function updateNeeded(host: ModuleHost) {
  const release = await optional(host, 'release.status');
  if (release === null) return null;
  if (!release.absent) {
    const status = release.value;
    // A newer app wrote this data: said whatever the update channel. Without a configured channel nothing else shows.
    if (status?.vaultCompatible === false) return { kind: 'update-needed' as const, reason: 'vault-newer' as const, date: null };
    if (status?.configured === false) return null;
    if (status?.withdrawn === true) return { kind: 'update-needed' as const, reason: 'withdrawn' as const, date: null };
    if (status?.build?.updateNeeded === true || status?.build?.usable === false) return { kind: 'update-needed' as const, reason: 'expired' as const, date: isIso(status.build.expiresAt) ? status.build.expiresAt as string : null };
    return null;
  }
  const status: any = await quiet(() => host.call('updates.status', {}));
  const reason = status?.state === 'expired' || status?.expired === true ? 'expired' : status?.state === 'withdrawn' || status?.withdrawn === true ? 'withdrawn' : null;
  if (!reason) return null;
  const date = typeof status.date === 'string' && isIso(status.date) ? status.date : typeof status.expiresAt === 'string' && isIso(status.expiresAt) ? status.expiresAt : null;
  return { kind: 'update-needed' as const, reason, date };
}

export async function shell(ctx: Context, host: ModuleHost) {
  const state = host.store.read(), frame = frameOf(state), demo = state.workspace.demo === true;
  const clock = demo && frame.clock ? { mode: 'demo' as const, date: frame.clock.date } : { mode: 'real' as const };
  const banners: unknown[] = [];
  // Each source belongs to another lane: one that is absent or fails shows no banner, never an error.
  const [drive, holder, sending, paused, update, offline] = await Promise.all([drivingNow(host), penHolder(host), sendingClosed(host), jobsPausedSince(host), updateNeeded(host), noConnection(host)]);
  if (drive) banners.push(drive);
  if (clock.mode === 'demo') banners.push({ kind: 'demo-clock', date: clock.date });
  if (holder) banners.push({ kind: 'read-only', holder });
  if (sending) banners.push(sending);
  const dismissed = frame.jobsPausedDismissedAt[ctx.memberId];
  if (paused && (!dismissed || paused > dismissed)) banners.push({ kind: 'jobs-paused' });
  if (update) banners.push(update);
  if (offline) banners.push(offline);
  return { workspace: { demo }, clock, banners, autoLockMinutes: frame.autoLockMinutes };
}

export function addDays(day: string, days: number) { return new Date(Date.parse(day) + days * DAY_MS).toISOString().slice(0, 10); }

/* ------------------------------------------------------------------ status line */

/** When each visible source was read: its import time, else the newest learned time of its rows. */
function readTimes(state: State, sources: readonly any[]): string[] {
  const learned = new Map(state.facts.map(fact => [fact.id, fact.learnedAt]));
  return sources.flatMap(source => {
    if (isIso(source?.at)) return [source.at];
    const times = (Array.isArray(source?.rowIds) ? source.rowIds : []).map((id: string) => learned.get(id)).filter(isIso).sort();
    return times.length ? [times.at(-1)!] : [];
  });
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
/** Outbound audit kinds besides model requests: connector pages read and learning exports attempted. */
const OUTBOUND_EVENTS = new Set(['connector.page-captured', 'learning.export-attempt']);
/** Count of things that left this computer, optionally only on one UTC day. */
export function leftCount(state: State, day?: string): number {
  const local = (routeId: unknown) => {
    const route = state.routes.find(item => item.id === routeId);
    if (route?.kind !== 'ollama') return false;
    try { return LOOPBACK.has(new URL(route.endpoint ?? 'http://127.0.0.1').hostname); } catch { return false; }
  };
  const on = (at: unknown) => isIso(at) && (day === undefined || at.startsWith(day));
  return state.modelReceipts.filter(r => r?.kind === 'model-preview' && on(r.dispatchedAt) && !local(r.routeId)).length
    + state.activity.filter(item => OUTBOUND_EVENTS.has(item.event) && on(item.at)).length;
}

export async function status(ctx: Context, host: ModuleHost) {
  const state = host.store.read();
  const listed: any = await quiet(() => host.call('sources.list', {}));
  const times = Array.isArray(listed) ? readTimes(state, listed).sort() : [];
  const reference = Date.parse(businessToday(state)) + DAY_MS;
  const sources = times.length === 0 ? { state: 'none' as const } : {
    state: reference - Date.parse(times[0]!) > STALE_AFTER_DAYS * DAY_MS ? 'stale' as const : 'fresh' as const,
    count: String(times.length), oldestReadAt: times[0]!, newestReadAt: times.at(-1)! };
  const routes: any = await quiet(() => host.call('models.list', {}));
  const route = Array.isArray(routes) ? routes.find(item => item?.enabled !== false) : undefined;
  const model = route ? { state: 'ready' as const, routeLabel: String(route.label ?? route.model ?? route.kind), sendLevel: state.policy.send } : { state: 'none' as const };
  const holder = await penHolder(host);
  let third: { kind: 'left-today'; calls: string } | { kind: 'nothing-left' } | { kind: 'holds-pen'; holder: string } | { kind: 'unknown' };
  if (holder) third = { kind: 'holds-pen', holder };
  else if (!Array.isArray(state.modelReceipts) || !Array.isArray(state.activity)) third = { kind: 'unknown' };
  else { const calls = leftCount(state, now().slice(0, 10)); third = calls > 0 ? { kind: 'left-today', calls: String(calls) } : { kind: 'nothing-left' }; }
  return { sources, model, third };
}

/* ------------------------------------------------------------------ capabilities */

type Family = { group: string; day: number; expect?: readonly string[]; lane?: string };
/** Method families and the build-plan day each arrives (docs/specs/CHAUSAR-LIVE-BUILD-PLAN.md, section 4; LANES.md section 6). */
const FAMILIES: readonly Family[] = [
  { group: 'today', day: 1 }, { group: 'todayx', day: 1 },
  { group: 'approvals', day: 7, expect: ['list', 'get', 'approve', 'notNow', 'change', 'drop', 'group', 'approveGroup', 'practice'] },
  { group: 'books', day: 2 }, { group: 'writeback', day: 7, expect: ['catalogue', 'prepare', 'execute', 'readBack', 'reconcile', 'practice'] },
  { group: 'connectorsx', day: 4, expect: ['systems', 'connect', 'read', 'freshness'] }, { group: 'jobsx', day: 7 },
  { group: 'procedures', day: 8, expect: ['list', 'get', 'propose', 'approve', 'route', 'runs'] }, { group: 'learningx', day: 8 },
  { group: 'hosted', day: 9 }, { group: 'phone', day: 9, lane: 'hosted-link' }, { group: 'release', day: 10 }, { group: 'modelsx', day: 8 },
  { group: 'reportsx', day: 5 }, { group: 'trustx', day: 6 }, { group: 'askx', day: 5 },
  { group: 'actions', day: 7 }, { group: 'jobs', day: 7 }, { group: 'sources', day: 1 }, { group: 'models', day: 1 }, { group: 'trust', day: 6 },
  { group: 'reports', day: 5 }, { group: 'plugins', day: 9 }, { group: 'mcp', day: 9 },
];

let coreMethods: readonly string[] | null = null;
/** The engine's core method registry, as the desktop allowlist declares it. */
function core(): readonly string[] {
  if (coreMethods) return coreMethods;
  try { coreMethods = [...createRequire(import.meta.url)('../../../app/desktop/ipc-contract.cjs').METHODS]; } catch { coreMethods = []; }
  return coreMethods!;
}

export function capabilities() {
  const lane = [...moduleMethods.entries()];
  const all = new Set([...core(), ...lane.map(([name]) => name)]);
  return { groups: FAMILIES.map(family => {
    const prefix = `${family.group}.`, names = [...all].filter(name => name.startsWith(prefix));
    let state: 'live' | 'partial' | 'missing' = names.length === 0 ? 'missing' : 'live';
    if (state === 'live' && family.expect && !family.expect.every(name => all.has(prefix + name))) state = 'partial';
    if (state === 'live' && family.lane && !lane.some(([name, spec]) => name.startsWith(prefix) && spec.module === family.lane)) state = 'partial';
    return { group: family.group, state, day: family.day, methods: String(names.length) };
  }) };
}

/* ------------------------------------------------------------------ first run */

const STEPS = ['you', 'vault', 'model', 'books', 'meanings', 'answer'] as const;
export async function firstRun(ctx: Context, host: ModuleHost) {
  const state = host.store.read(), frame = frameOf(state);
  const sources: any = await quiet(() => host.call('sources.list', {}));
  const routes: any = await quiet(() => host.call('models.list', {}));
  const dictionary = await quiet(() => host.services.ontology?.current(ctx));
  const done: Record<typeof STEPS[number], boolean> = {
    you: frame.identity !== null,
    // The engine serves module methods only while a workspace vault is open.
    vault: true,
    model: Array.isArray(routes) && routes.some(route => route?.enabled !== false),
    books: Array.isArray(sources) && sources.length > 0,
    meanings: !!dictionary,
    answer: state.receipts.some(receipt => typeof receipt?.operation === 'string' && typeof receipt?.id === 'string'),
  };
  const blocked = !done.vault ? 'no-vault' : !done.books ? 'no-source' : !done.meanings ? 'meanings-unpublished' : !done.answer ? 'no-answer' : 'nothing';
  const leftThisComputer = !Array.isArray(state.modelReceipts) ? 'unknown' : leftCount(state) > 0 ? 'something' : 'nothing';
  return { steps: Object.fromEntries(STEPS.map(step => [step, done[step] ? 'done' : 'not-done'])), blocked, leftThisComputer, firstMissing: STEPS.find(step => !done[step]) ?? null };
}

/* worth a look: ./worth.ts (every kind, round 4). */

/* ------------------------------------------------------------------ help, fault report, phone */

export const help = () => ({ offline: {
  works: ['books-answers', 'receipts', 'calculation-menu', 'meanings', 'local-checks', 'exports', 'lock'],
  waits: ['plain-questions', 'model-requests', 'scheduled-reads', 'sending', 'connector-reads', 'updates', 'phone-messages'],
} });

const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;
const KIND = /^[a-z][a-z0-9-]{0,40}$/;
/** SH-11: kinds and codes only. No names, amounts, file names, cell values or questions can reach it. */
export async function faultReport(ctx: Context, host: ModuleHost) {
  const status: any = await quiet(() => host.call('workspace.status', {}));
  check(typeof status?.version === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(status.version), 'FAULT_REPORT_UNAVAILABLE', 'The app version could not be read for the fault report.');
  const recent = auditEvents(host.store, ctx).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  const eventKinds = [...new Set(recent.map(event => event.type))];
  const routes: any = await quiet(() => host.call('models.list', {}));
  const routeHealth = (Array.isArray(routes) ? routes : []).map(route => ({
    kind: typeof route?.kind === 'string' && KIND.test(route.kind) ? route.kind : 'other',
    state: route?.enabled === false ? 'off' : String(route?.kind ?? '').endsWith('-cli') ? 'cli-unverified' : route?.credentialConfigured ? 'ready' : 'no-credential' }));
  const codes: string[] = [];
  // Only what this caller may see: the gateway's receipts for this seat and the same audit records `todayx.activity` shows it.
  const receipts: readonly any[] = (() => { try { return host.services.gateway?.receipts(ctx) ?? []; } catch { return []; } })();
  for (const receipt of receipts.slice(-50)) if (typeof receipt?.errorCode === 'string' && CODE.test(receipt.errorCode)) codes.push(receipt.errorCode);
  for (const item of visibleAudit(host.store, ctx).slice(-50)) for (const key of ['reasonCode', 'errorCode']) {
    const code = item?.details?.[key];
    if (typeof code === 'string' && CODE.test(code)) codes.push(code);
    // Lower-case reason tokens (for example an import refused for 'reconciliation') become codes.
    else if (typeof code === 'string' && KIND.test(code)) codes.push(code.toUpperCase().replaceAll('-', '_'));
  }
  return { appVersion: status.version, os: process.platform, eventKinds, routeHealth, errorCodes: [...new Set(codes)].slice(-20), createdAt: now() };
}

const CHANNELS = ['whatsapp', 'telegram', 'mail'] as const;
const COUNT = /^(0|[1-9][0-9]{0,30})$/;
/**
 * PH-01..PH-03. Channels are `not-built` until the hosted-link lane registers its methods.
 * Reads `phone.channels.list` (a channel is on when the desktop has it enabled) and
 * `phone.messages.counts` (`sent`, `desktopBudget`); counts need a paired link, so they stay unknown otherwise.
 */
export async function phoneMessages(host: ModuleHost) {
  const built = [...moduleMethods.values()].some(spec => spec.module === 'hosted-link');
  let channels = CHANNELS.map(channel => ({ channel, state: built ? 'off' : 'not-built' }));
  let sentThisMonth: string | null = null;
  let monthlyBudget = '30';
  if (built && moduleMethods.has('phone.channels.list')) {
    const reply: any = await quiet(() => host.call('phone.channels.list', {}));
    const listed = Array.isArray(reply?.channels) ? reply.channels : [];
    channels = CHANNELS.map(channel => ({ channel, state: listed.find((item: any) => item?.channel === channel)?.desktop?.enabled === true ? 'on' : 'off' }));
  }
  if (built && moduleMethods.has('phone.messages.counts') && !host.demo) {
    const counts: any = await quiet(() => host.call('phone.messages.counts', {}));
    if (Number.isSafeInteger(counts?.sent) && COUNT.test(String(counts.sent))) sentThisMonth = String(counts.sent);
    if (Number.isSafeInteger(counts?.desktopBudget) && COUNT.test(String(counts.desktopBudget))) monthlyBudget = String(counts.desktopBudget);
  }
  return { channels, kinds: ['week-ahead', 'review', 'document', 'due-date'], sentThisMonth, monthlyBudget };
}
