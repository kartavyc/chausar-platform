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
import { auditEvents } from './activity.ts';
import type { IdentityCard } from './identity.ts';
import type { IdeaState } from './idea.ts';

export const MODULE_ID = 'frame-today';
export type FrameState = {
  clock: { date: string; setAt: string } | null;
  autoLockMinutes: number;
  /** Per member: when that seat last dismissed the jobs-paused banner. */
  jobsPausedDismissedAt: Record<string, string>;
  identity: IdentityCard | null;
  /** FR-11: the founder's idea, as typed. Absent in workspaces written before it existed. */
  idea?: IdeaState | null;
};
export const initFrame = (): FrameState => ({ clock: null, autoLockMinutes: 10, jobsPausedDismissedAt: {}, identity: null, idea: null });
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

/** `updates.status` reports expiry or withdrawal only once the release lane adds it; until then this stays empty. */
async function updateNeeded(host: ModuleHost) {
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
  // 'driving' (screen control) and 'no-connection' have no engine state yet, so they never show.
  if (clock.mode === 'demo') banners.push({ kind: 'demo-clock', date: clock.date });
  const holder = await penHolder(host);
  if (holder) banners.push({ kind: 'read-only', holder });
  // 'sending-closed' needs a restore record with unchecked actions; the engine keeps none yet.
  const paused = await jobsPausedSince(host), dismissed = frame.jobsPausedDismissedAt[ctx.memberId];
  if (paused && (!dismissed || paused > dismissed)) banners.push({ kind: 'jobs-paused' });
  const update = await updateNeeded(host);
  if (update) banners.push(update);
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

/* ------------------------------------------------------------------ worth a look */

export async function worthALook(ctx: Context, host: ModuleHost) {
  const state = host.store.read();
  const sources: any = await quiet(() => host.call('sources.list', {}));
  if (!Array.isArray(sources) || sources.length === 0) return { rows: [], state: 'not-loaded-yet' as const };
  const rows: { id: string; kind: string; subject: string | null; at: string | null; opens: string | null }[] = [];
  for (const event of auditEvents(host.store, ctx)) if (event.type === 'source.refused')
    rows.push({ id: event.id, kind: 'file-refused', subject: event.values.source ?? null, at: event.at, opens: '#/books/sources' });
  const due: any = await quiet(() => host.call('decisions.journal.due', { dueOn: businessToday(state) }));
  for (const decision of Array.isArray(due) ? due : []) if (typeof decision?.id === 'string')
    rows.push({ id: decision.id, kind: 'decision-due', subject: typeof decision.text === 'string' && decision.text.length <= 200 ? decision.text : null,
      at: isIso(decision.reviewDate) ? decision.reviewDate : null, opens: '#/ask/decisions' });
  const jobs: any = await quiet(() => host.call('jobs.list', {}));
  for (const job of Array.isArray(jobs) ? jobs : []) for (const [index, entry] of (Array.isArray(job?.ledger) ? job.ledger : []).entries())
    if (entry?.event === 'catchup-skipped' && typeof job.id === 'string') rows.push({ id: `${job.id}:${index}`, kind: 'missed-while-asleep', subject: null, at: isIso(entry.at) ? entry.at : null, opens: '#/work/jobs' });
  // Approvals carry no expiry and updates.status reports no ready release yet: those kinds stay empty.
  rows.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const setup = await firstRun(ctx, host);
  // "Setup not finished" always keeps a place when first run is incomplete.
  const picked = setup.firstMissing ? [{ id: `setup-${setup.firstMissing}`, kind: 'setup', subject: null, at: null, opens: '#/first-run' }, ...rows] : rows;
  return { rows: picked.slice(0, 5), state: 'ready' as const };
}

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
  const state = host.store.read();
  const recent = auditEvents(host.store, ctx).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  const eventKinds = [...new Set(recent.map(event => event.type))];
  const routes: any = await quiet(() => host.call('models.list', {}));
  const routeHealth = (Array.isArray(routes) ? routes : []).map(route => ({
    kind: typeof route?.kind === 'string' && KIND.test(route.kind) ? route.kind : 'other',
    state: route?.enabled === false ? 'off' : String(route?.kind ?? '').endsWith('-cli') ? 'cli-unverified' : route?.credentialConfigured ? 'ready' : 'no-credential' }));
  const codes: string[] = [];
  for (const receipt of state.modelReceipts.slice(-50)) if (typeof receipt?.errorCode === 'string' && CODE.test(receipt.errorCode)) codes.push(receipt.errorCode);
  for (const item of state.activity.slice(-50)) for (const key of ['reasonCode', 'errorCode']) {
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
