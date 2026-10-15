/**
 * Work, round 4 (docs/lanes/work-books.md, "Round 4 contracts"). Each part reads another lane's
 * method only when the method registry (or a trusted host's `hasMethod`) lists it; a mutating
 * method is never probed. A part whose method is absent answers a typed "not built" state.
 *
 *  - WK-09: jobs-ext's ready-made jobs (`jobsx.types`), proposed with `jobsx.propose { template }`
 *    and read back with `jobsx.card { proposalId }`; the card waits in the queue as `proposal:<id>`.
 *  - WK-02: practice for a core action. Its operation is never run: the registered operation's
 *    own `validate` checks a copy of the exact prepared request, and the reply says what it would do.
 *  - WK-02 / writeback: the second ask by each approver's own secret (core-gateway-auth's
 *    `auth.approvalSecret.status` / `verify`), else the typed amount.
 *  - WK-12: the reminders view, write-back's caps in its own time zone (`writeback.caps`).
 *  - WK-15: `deletion.reapply` (core-data) after a restore.
 *  - WK-08 / WK-16: child task results (`jobs.children`) and a core person step done
 *    (`jobs.personStep.done`), both core-sync-jobs.
 */
import { check, ChausarError } from '../contracts.ts';
import type { Context } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import type { Job } from '../jobs.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { installed } from './work-jobs-sheet.ts';
import { env, flatten, rowOf, steps, type Env, type Step } from './work-queue.ts';
import { isReminderView, wbDetail } from './work-writeback.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const strings = (value: unknown, max = 2000): string[] => Array.isArray(value) ? value.filter((s): s is string => str(s, max)) : [];
const UNSIGNED = /^(0|[1-9]\d{0,29})$/;
const PAISE = /^[1-9]\d{0,17}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const DAY = 86_400_000;
const instant = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const day = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

// ---------- WK-09: jobs-ext's ready-made jobs ----------

export type MissedRun = 'skip' | 'run-once-on-wake' | 'run-all';
const FROM_JOBSX: Readonly<Record<string, MissedRun>> = { skip: 'skip', once: 'run-once-on-wake', all: 'run-all' };
const TO_JOBSX: Readonly<Record<MissedRun, string>> = { skip: 'skip', 'run-once-on-wake': 'once', 'run-all': 'all' };
export type LaneTemplate = {
  id: string; title: string; goal: string; doneWhen: string; every: 'day' | 'week' | 'month' | null; intervalMs: number; stepsPerDelivery: number;
  missedRun: MissedRun; budget: { minor: string }; actions: string[]; steps: { kind: string; title: string; needsModel: boolean }[];
  needsModel: boolean; experimental: boolean; available: boolean; code: string | null;
};
/** jobs-ext's "a job in your own words" is the one-sentence path; it is not listed twice. */
const SENTENCE_TEMPLATE = 'agent-task';
const everyOf = (ms: number) => ms === DAY ? 'day' as const : ms === 7 * DAY ? 'week' as const : ms >= 28 * DAY && ms <= 31 * DAY ? 'month' as const : null;

/** One `jobsx.types` row, field by field; a row that does not fit is left out. */
export function laneTemplateOf(t: unknown): LaneTemplate | null {
  if (!record(t) || !str(t.id, 120) || !ID.test(t.id) || t.id === SENTENCE_TEMPLATE || !str(t.title) || !str(t.goal, 2000) || !str(t.finishedWhen, 2000)) return null;
  if (!count(t.intervalMs) || !count(t.stepsPerDelivery) || typeof t.budgetMinor !== 'string' || !PAISE.test(t.budgetMinor) || typeof t.missedRule !== 'string' || !Object.hasOwn(FROM_JOBSX, t.missedRule)) return null;
  const stepRows = (Array.isArray(t.steps) ? t.steps : []).filter((s: unknown) => record(s) && str(s.kind, 40) && str(s.title, 2000) && typeof s.needsModel === 'boolean')
    .map((s: any) => ({ kind: s.kind as string, title: s.title as string, needsModel: s.needsModel as boolean }));
  return {
    id: t.id, title: t.title, goal: t.goal, doneWhen: t.finishedWhen, every: everyOf(t.intervalMs), intervalMs: t.intervalMs, stepsPerDelivery: t.stepsPerDelivery,
    missedRun: FROM_JOBSX[t.missedRule], budget: { minor: t.budgetMinor }, actions: strings(t.allowedActions, 200), steps: stepRows,
    needsModel: stepRows.some(s => s.needsModel), experimental: t.experimental === true, available: t.available === true,
    code: t.available === true ? null : str(t.code, 80) && /^[A-Z][A-Z0-9_]*$/.test(t.code) ? t.code : 'TEMPLATE_NOT_AVAILABLE',
  };
}
/** `jobsx.types`, read only when installed. A refused read leaves the list empty, never guessed. */
export async function laneTemplates(host: ModuleHost): Promise<{ available: boolean; templates: LaneTemplate[]; activeJobs: number | null; activeJobCap: number | null }> {
  if (!(await installed(host, 'jobsx.types')) || !(await installed(host, 'jobsx.propose'))) return { available: false, templates: [], activeJobs: null, activeJobCap: null };
  let reply: unknown;
  try { reply = await host.call('jobsx.types', {}); } catch { return { available: true, templates: [], activeJobs: null, activeJobCap: null }; }
  const rows = record(reply) && Array.isArray(reply.templates) ? reply.templates : [];
  return { available: true, templates: rows.map(laneTemplateOf).filter((t): t is LaneTemplate => t !== null).slice(0, 50),
    activeJobs: record(reply) && count(reply.activeJobs) ? reply.activeJobs : null, activeJobCap: record(reply) && count(reply.activeJobCap) ? reply.activeJobCap : null };
}

/**
 * `approvals.proposeJob { laneTemplate, budgetMinor?, missedRun? }`: jobs-ext makes a card (a proposal, not a job)
 * from its own ready-made job. The card is read back with `jobsx.card { proposalId }` and must carry the same digest.
 */
export async function proposeLaneTemplate(host: ModuleHost, payload: Record<string, any>) {
  check(Object.keys(payload).every(k => ['laneTemplate', 'budgetMinor', 'missedRun'].includes(k)), 'INVALID_JOB_PROPOSAL', 'Use only the declared request fields.');
  check(str(payload.laneTemplate, 120) && ID.test(payload.laneTemplate), 'TEMPLATE_NOT_FOUND', 'Choose one of the ready-made jobs.');
  const lane = await laneTemplates(host);
  if (!lane.available) throw new ChausarError('LANE_TEMPLATES_NOT_BUILT', 'Ready-made jobs from job extensions are not built yet.');
  const template = lane.templates.find(t => t.id === payload.laneTemplate); check(template, 'TEMPLATE_NOT_FOUND', 'Choose one of the ready-made jobs.');
  if (!template.available) throw new ChausarError(template.code ?? 'TEMPLATE_NOT_AVAILABLE', 'This ready-made job cannot start in this workspace yet.');
  const budgetMinor = payload.budgetMinor;
  check(budgetMinor === undefined || (typeof budgetMinor === 'string' && PAISE.test(budgetMinor) && BigInt(budgetMinor) <= BigInt(template.budget.minor) * 10n),
    'INVALID_BUDGET', 'The budget is whole paise, more than zero and at most ten times the ready-made budget.');
  check(payload.missedRun === undefined || Object.hasOwn(TO_JOBSX, payload.missedRun), 'INVALID_SCHEDULE', 'A missed run is skipped, run once on wake, or every missed one is run.');
  const overrides = { ...(budgetMinor !== undefined ? { budgetMinor } : {}), ...(payload.missedRun !== undefined ? { missedRule: TO_JOBSX[payload.missedRun as MissedRun] } : {}) };
  const reply = await host.call('jobsx.propose', { template: template.id, ...(Object.keys(overrides).length ? { overrides } : {}) });
  check(record(reply) && reply.status === 'proposed' && str(reply.id, 200) && ID.test(reply.id) && str(reply.digest, 200) && reply.digest.length >= 8, 'INVALID_JOB_REPLY', 'The proposed job could not be read back.');
  // The card as jobs-ext keeps it: the same digest the approval sheet binds.
  if (await installed(host, 'jobsx.card')) {
    const card = await host.call('jobsx.card', { proposalId: reply.id });
    check(record(card) && card.digest === reply.digest && record(card.card), 'INVALID_JOB_REPLY', 'The proposed job could not be read back.');
  }
  return { id: `proposal:${reply.id}`, proposal: { id: reply.id as string, digest: reply.digest as string }, laneTemplate: template.id };
}

// ---------- WK-02: practice for a core action ----------

/**
 * A core action's practice never runs its operation: a registered operation's `execute` acts on
 * the real workspace or outside system (the built-in local draft writes the real store), so it
 * cannot be pointed at a copy. The operation's own `validate` checks a copy of the exact
 * prepared request; the reply shows that request and what doing it would do. Nothing is sent.
 */
export function corePractice(e: Env, action: PreparedAction) {
  const none = (code: string) => ({ practice: true as const, available: false, steps: steps(), wouldSend: null, code });
  if (action.status !== 'prepared') return none('PRACTICE_NOT_AVAILABLE');
  const operation = (e.host.services.actions?.registry as Map<string, { operations: Record<string, { validate?: unknown }> }> | undefined)?.get(action.connector)?.operations?.[action.operation];
  if (!operation || typeof operation.validate !== 'function') return none('PRACTICE_NOT_AVAILABLE');
  let refused: string | null = null;
  try { (operation.validate as (payload: unknown) => unknown)(structuredClone(action.payload)); }
  catch (error) { refused = error instanceof ChausarError ? error.code : 'INVALID_ACTION'; }
  const written = action.impact === 'message' ? [action.payload.text, action.payload.body, action.payload.message].find((v): v is string => typeof v === 'string') ?? null : null;
  const localDraft = action.connector === 'local' && action.operation === 'reminder-draft';
  const practiced: Step[] = steps(['done', action.createdAt], [refused ? 'stopped-by-rule' : 'done', null]);
  return {
    practice: true as const, available: true, mode: 'checked-not-run' as const, steps: practiced, wouldSend: written, requests: 0,
    outcome: refused ? 'refused' : localDraft ? 'would-create-local-draft' : 'checked-not-run', ...(refused ? { code: refused } : {}),
    request: flatten(action.payload),
  };
}

// ---------- Second ask: each approver's own secret (core-gateway-auth) ----------

/** Whether this approver has their own approval secret. Read only when both methods are installed. */
export async function ownSecret(host: ModuleHost): Promise<boolean> {
  if (!(await installed(host, 'auth.approvalSecret.status')) || !(await installed(host, 'auth.approvalSecret.verify'))) return false;
  try { const reply = await host.call('auth.approvalSecret.status', {}); return record(reply) && reply.set === true; } catch { return false; }
}
/**
 * A core money action (core-gateway-auth): when `secondAsk.grant` is installed the approver answers with a secret
 * instead of the typed amount: the owner's vault passphrase or a co-founder's own approval secret, as
 * `secondAsk.status` (caller only) says. Without `secondAsk.grant` the typed amount stays.
 */
export async function coreSecondAsk(host: ModuleHost, ctx: Context): Promise<{ by: 'typed-amount' | 'passphrase'; whose?: 'own-secret' | 'vault-passphrase' }> {
  if (!(await installed(host, 'secondAsk.grant'))) return { by: 'typed-amount' };
  let whose: 'own-secret' | 'vault-passphrase' = ctx.role === 'owner' ? 'vault-passphrase' : 'own-secret';
  if (await installed(host, 'secondAsk.status')) {
    try {
      const reply = await host.call('secondAsk.status', {});
      const said = record(reply) ? reply.expects ?? reply.kind : undefined;
      if (said === 'passphrase' || said === 'vault-passphrase') whose = 'vault-passphrase';
      else if (said === 'member-secret' || said === 'approval-secret' || said === 'own-secret') whose = 'own-secret';
    } catch { /* the role decides */ }
  }
  return { by: 'passphrase', whose };
}
/**
 * `secondAsk.grant { target: { kind: 'action', id, digest }, secret }` → `{ granted: true, expiresAt }`: a single-use,
 * five-minute grant for exactly this action and digest, asked just before the approval. The secret is never kept;
 * `SECOND_ASK_LOCKED` and a wrong secret pass through as core-gateway-auth refuses them.
 */
export async function grantSecondAsk(host: ModuleHost, raw: string, digest: string, secret: unknown): Promise<void> {
  check(typeof secret === 'string' && secret.length >= 1 && secret.length <= 1024, 'REAUTH_REQUIRED', 'Type your passphrase or approval secret to approve this.');
  const reply = await host.call('secondAsk.grant', { target: { kind: 'action', id: raw, digest }, secret });
  check(record(reply) && reply.granted === true, 'REAUTH_FAILED', 'The second ask was not granted. Nothing was approved.');
}

// ---------- WK-12: write-back's caps in its own time zone ----------

export type CapsDay = { timeZone: string | null; today: string | null; preparedToday: number | null; sentToday: number | null; perCustomer: number | null; perDay: number | null };
const zoneOk = (zone: unknown): zone is string => { if (!str(zone, 64)) return false; try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } };
/** `writeback.caps` (read): `{ settings: { reminderCapPerCustomer, reminderCapPerDay }, timeZone, today, now, counts: { preparedToday, sentToday, customersToday } }`. */
export async function capsDay(host: ModuleHost): Promise<CapsDay | null> {
  if (!(await installed(host, 'writeback.caps'))) return null;
  let reply: unknown;
  try { reply = await host.call('writeback.caps', {}); } catch { return null; }
  if (!record(reply)) return null;
  const settings = record(reply.settings) ? reply.settings : {}; const counts = record(reply.counts) ? reply.counts : {};
  return { timeZone: zoneOk(reply.timeZone) ? reply.timeZone : null, today: day(reply.today) ? reply.today : null,
    preparedToday: count(counts.preparedToday) ? counts.preparedToday : null, sentToday: count(counts.sentToday) ? counts.sentToday : null,
    perCustomer: count(settings.reminderCapPerCustomer) ? settings.reminderCapPerCustomer : null, perDay: count(settings.reminderCapPerDay) ? settings.reminderCapPerDay : null };
}
/** The Books record a write-back customer id names, when it is one (`records.get` as the same caller). */
export async function bookRecordOf(host: ModuleHost, customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  try { const view = await host.call('records.get', { id: customerId }); return record(view) && str(view.id, 200) ? view.id : null; } catch { return null; }
}

// ---------- WK-08: child task results (core-sync-jobs) ----------

export type ChildTask = { id: string; title: string; state: string; result: { done: string[]; open: string[]; receiptIds: string[] } | null };
/** `jobs.children { id }` → `{ items: ChildTask[] }`. A child without a result says so; it is never made up. */
export async function childTasks(host: ModuleHost, job: Job): Promise<{ available: false } | { available: true; items: ChildTask[] }> {
  if (!(await installed(host, 'jobs.children'))) return { available: false };
  let reply: unknown;
  try { reply = await host.call('jobs.children', { id: job.id }); } catch { return { available: false }; }
  const items = (record(reply) && Array.isArray(reply.items) ? reply.items : []).filter((c: unknown) => record(c) && str(c.id, 200) && str(c.title, 2000) && str(c.state, 80)).slice(0, 200)
    .map((c: any) => ({ id: c.id as string, title: c.title as string, state: c.state as string,
      result: record(c.result) ? { done: strings(c.result.done), open: strings(c.result.open), receiptIds: strings(c.result.receiptIds, 200) } : null }));
  return { available: true, items };
}

/** WK-08 meters, per route: a local model is priced at zero with its minutes; a route not on the card's tested list is drawn as untested. */
export type RouteMeter = { routeId: string; spent: { minor: string } | { missing: 'not-counted' }; minutes: number | null; basis: 'measured' | 'estimate' | 'zero'; tested: boolean };
export function laneRoutes(raw: unknown): { routes: RouteMeter[]; untestedStop: { at: string; reason: string } | null } {
  if (!record(raw)) return { routes: [], untestedStop: null };
  const tested = strings(raw.testedRoutes, 200);
  const facts = record(raw.facts) ? raw.facts : {}; const budget = record(facts.budget) ? facts.budget : {}; const meters = record(budget.meters) ? budget.meters : {};
  const routes = (Array.isArray(meters.model) ? meters.model : []).filter((m: unknown) => record(m) && str(m.routeId, 200)).slice(0, 50).map((m: any): RouteMeter => ({
    routeId: m.routeId, spent: typeof m.costMinor === 'string' && UNSIGNED.test(m.costMinor) ? { minor: m.costMinor } : { missing: 'not-counted' },
    minutes: count(m.minutes) ? m.minutes : null, basis: m.basis === 'zero' ? 'zero' : m.basis === 'estimate' ? 'estimate' : 'measured', tested: tested.includes(m.routeId),
  }));
  const stop = record(raw.stoppedBy) && raw.stoppedBy.rule === 'untested-route' && instant(raw.stoppedBy.at) && str(raw.stoppedBy.reason, 2000) ? { at: raw.stoppedBy.at as string, reason: raw.stoppedBy.reason as string } : null;
  return { routes, untestedStop: stop };
}
/** A core job's routes: a route whose kind is a local model is priced at zero (no minutes are recorded per route by the core). */
export function coreRoutes(e: Env, job: Job): RouteMeter[] {
  const known = Array.isArray(e.state.routes) ? e.state.routes as { id?: unknown; kind?: unknown }[] : [];
  return [...(job.testedRoutes ?? [])].slice(0, 50).map(routeId => {
    const local = known.some(r => r.id === routeId && r.kind === 'ollama');
    return { routeId, spent: local ? { minor: '0' } : { missing: 'not-counted' as const }, minutes: null, basis: local ? 'zero' as const : 'measured' as const, tested: true };
  });
}

// ---------- WK-16: a core person step done (core-sync-jobs) ----------

/** `jobs.personStep.done { id, stepId }` marks the step; the core ledger then carries `{ event: 'person-step-done', stepId, by }`. */
export async function corePersonStepDone(e: Env, job: Job, stepId: string) {
  if (!(await installed(e.host, 'jobs.personStep.done'))) throw new ChausarError('PERSON_STEP_NOT_BUILT', 'Marking a step done is not built yet.');
  await e.host.call('jobs.personStep.done', { id: job.id, stepId });
  const after = (e.host.services.jobs?.list(e.ctx) as Job[] | undefined)?.find(j => j.id === job.id);
  const entry = after?.ledger.find(l => l.event === 'person-step-done' && (l as { stepId?: unknown }).stepId === stepId) as (Job['ledger'][number] & { by?: unknown }) | undefined;
  check(entry, 'INVALID_JOB_REPLY', 'The step could not be read back.');
  const by = str(entry.by, 200) ? e.state.members.find(m => m.id === entry.by)?.name ?? entry.by : null;
  return { jobId: job.id, stepId, done: true, doneAt: entry.at, doneBy: by };
}

// ---------- Methods ----------

function empty(payload: unknown) { check(record(payload) && Object.keys(payload).length === 0, 'INVALID_APPROVAL', 'Send an empty request.'); }

export const workR4Methods: Readonly<Record<string, MethodSpec>> = {
  /**
   * WK-12, the reminders view: the write connections a reminder can go through, today's caps in
   * write-back's own time zone, and the reminders prepared so far. Prepare one with `approvals.prepareReminder`.
   */
  'approvals.reminders': { permission: 'read', async handler(ctx: Context, payload, host) {
    empty(payload);
    if (!(await installed(host, 'writeback.followUp.prepare'))) return { available: false as const };
    const e = await env(ctx, host);
    let connections: { id: string; label: string; system: 'mail' | 'whatsapp'; environment: string }[] = [];
    if (await installed(host, 'writeback.connections')) {
      try {
        const reply = await host.call('writeback.connections', {});
        connections = (Array.isArray(reply) ? reply : record(reply) && Array.isArray(reply.connections) ? reply.connections : []).filter((c: unknown) => record(c) && str(c.id, 200) && ID.test(c.id) && (c.system === 'mail' || c.system === 'whatsapp') && !c.revokedAt)
          .slice(0, 50).map((c: any) => ({ id: c.id, label: str(c.label, 100) ? c.label : c.id, system: c.system, environment: ['live', 'sandbox', 'practice'].includes(c.environment) ? c.environment : 'live' }));
      } catch { connections = []; }
    }
    const items = e.wb.views.filter(v => isReminderView(e.state, v)).map(v => rowOf(wbDetail(e, v))).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 200);
    return { available: true as const, connections, caps: await capsDay(host), items };
  } },
  /** WK-15: delete again what a restore brought back (core-data `deletion.reapply`). Never probed. */
  'approvals.reapplyDeletions': { permission: 'approve', async handler(_ctx, payload, host) {
    empty(payload);
    if (!(await installed(host, 'deletion.reapply'))) throw new ChausarError('DELETION_REAPPLY_NOT_BUILT', 'Deleting again what a restore brought back is not built yet.');
    const reply = await host.call('deletion.reapply', {});
    check(record(reply) && count(reply.reapplied), 'INVALID_DELETION_REPLY', 'The deletions could not be read back.');
    return { reapplied: reply.reapplied as number };
  } },
};
