/**
 * Read models for Work (WK-01..WK-06, WK-15): the one approvals queue, the approval sheet, the
 * five steps, the actions record and the catalogue. Everything here is derived from the
 * prepared request itself (actions, jobs, dictionary drafts, lessons), never from model text.
 */
import { check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { PreparedAction, Operation } from '../actions.ts';
import type { Job } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import { invoiceConnectorId, invoiceJobType } from '../invoice-follow-up.ts';
import { optionalCall } from './adapters.ts';
import { peekSection } from './state.ts';

export type Amount = { minor: string } | { missing: 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted' };
export type Source = 'action' | 'job' | 'release' | 'lesson' | 'acceptance';
export type Tier = 'tier-2' | 'tier-1' | 'prepare-only';
export type RowState = PreparedAction['status'];
export type ApprovalRow = {
  id: string; source: Source; kind: 'message' | 'record-change' | 'money' | 'prepare-only' | 'job' | 'group'; tier: Tier;
  title: string; touches: string | null; amount: Amount | null; preparedBy: { kind: 'person' | 'job' | 'chausar'; name: string } | null;
  createdAt: string; expiresAt: string | null; state: RowState; practice: boolean;
};
export type StepName = 'prepared' | 'approved' | 'done' | 'read-back' | 'recorded';
export type StepState = 'done' | 'waiting-for-you' | 'waiting-for-network' | 'unsure' | 'stopped-by-rule' | 'not-reached';
export type Step = { name: StepName; state: StepState; at: string | null };
export type Can = 'approve' | 'notNow' | 'change' | 'drop' | 'reconcile';
export type ApprovalDetail = ApprovalRow & {
  digest: string; revision: number; reason: string;
  change: { asWritten?: string; fields?: { name: string; before: string; after: string }[] };
  voucher?: { type: string; number: string | null; date: string; lines: { ledger: string; debit: Amount | null; credit: Amount | null }[]; note: 'prepare-only' };
  job?: JobCard; steps: Step[]; can: Can[]; readOnly: boolean; prepareOnly: boolean; needsSecondAsk: boolean;
  blocked?: { kind: 'expired' | 'owner-approves' | 'unsure' | 'changed' | 'prepare-blocked'; code: string };
  snoozedUntil?: string;
};
export type JobCard = {
  id: string; goal: string; doneWhen: string; owner: string; budget: Amount; reserve: Amount; spent: Amount;
  stopRule: { maxRuns: number; deadline: string }; actions: string[]; testedRoutes: string[]; reviewOn: string | null;
  missedRun: 'skip' | 'run-once-on-wake'; runsOn: 'this-computer'; runs: number; lastRunAt: string | null; nextRunAt: string | null;
  untrustedInstructions: boolean; digest: string; revision: number;
};
export type ActionView = {
  id: string; system: string; action: string; title: string; touches: string | null; amount: Amount | null; state: RowState; steps: Step[];
  approvedBy: string | null; channel: 'desktop' | 'phone' | 'mcp' | null; request: Record<string, string>;
  readBack: { field: string; asked: string; found: string | null; same: boolean }[] | null; rule: string;
  attestation: Attestation | null; wouldHaveDone: 'waited' | 'done' | null; createdAt: string; settledAt: string | null;
  can: ('execute' | 'reconcile' | 'resolve' | 'reverse')[];
};
export type CatalogueKind = 'inside-undoable' | 'seen-outside' | 'money' | 'cannot-undo';
export type CatalogueRow = { system: string; systemTitle: string; action: string; title: string; kind: CatalogueKind; waits: boolean; status: 'live' | 'experimental' | 'prepare-only' | 'not-yet'; source: 'core' | 'writeback' };
export type CatalogueEntry = CatalogueRow & { description: string; idempotency: string; readBack: string; retryWindow: string | null; tier: 'tier-1' | 'tier-2'; expires: string | null; readStatus: string | null };
type Attestation = { by: string; said: 'was-sent' | 'was-not-sent'; at: string };

/** The work section of the lane namespace. Every key is keyed by the raw action or job id it describes. */
export type WorkState = {
  snoozes: Record<string, Record<string, string>>;           // memberId -> typed id -> until
  opened: Record<string, number>;                            // `${memberId} ${typed id}` -> when the sheet opened
  pace: { memberId: string; at: number; ms: number | null }[];
  attestations: Record<string, Attestation>;                 // actionId -> told by owner
  channels: Record<string, 'desktop' | 'phone' | 'mcp'>;     // actionId -> channel it was approved through
  revisedAt: Record<string, string>;                         // actionId -> last "prepared again"
  wanted: { id: string; system: string; text: string; at: string; by: string }[];
};
export const initWork = (): WorkState => ({ snoozes: {}, opened: {}, pace: [], attestations: {}, channels: {}, revisedAt: {}, wanted: [] });
export function normalizeWork(value: WorkState): WorkState { const base = initWork(); for (const key of Object.keys(base) as (keyof WorkState)[]) if (!Object.hasOwn(value, key)) (value as any)[key] = base[key]; return value; }
export const readWork = (state: State): WorkState => normalizeWork(structuredClone(peekSection<WorkState>(state, 'work') ?? initWork()));

const HOUR = 3600000, DAY = 24 * HOUR;
const READ_ONLY_ROLES: readonly Context['role'][] = ['viewer', 'accountant'];
const STEP_NAMES: readonly StepName[] = ['prepared', 'approved', 'done', 'read-back', 'recorded'];
const TIER_ORDER: Record<Tier, number> = { 'tier-2': 0, 'tier-1': 1, 'prepare-only': 2 };
const INTEGER = /^(0|-?[1-9]\d*)$/;

export const nowMs = (host: ModuleHost): number => typeof host.options.clock === 'function' ? Number((host.options.clock as () => number)()) : Date.now();
export const isoAt = (ms: number) => new Date(ms).toISOString();
const text = (value: unknown, max = 200): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const minorAmount = (value: unknown): Amount | null => typeof value === 'string' && INTEGER.test(value) ? { minor: value } : null;
const memberName = (state: State, id: string | undefined) => state.members.find(m => m.id === id)?.name ?? null;
export const steps = (...states: [StepState, string | null][]): Step[] => STEP_NAMES.map((name, i) => ({ name, state: states[i]?.[0] ?? 'not-reached', at: states[i]?.[1] ?? null }));

/** Typed queue ids: `action:<id>`, `job:<id>`, `release:<draftId>`, `lesson:<id>`, `acceptance:<jobId>`. */
export function parseId(value: unknown): { source: Source; raw: string } {
  check(typeof value === 'string' && value.length <= 240, 'INVALID_APPROVAL', 'Use a typed approval id.');
  const match = /^(action|job|release|lesson|acceptance):([A-Za-z0-9_.:-]{1,200})$/.exec(value);
  check(match, 'INVALID_APPROVAL', 'Use a typed approval id.');
  return { source: match[1] as Source, raw: match[2] };
}

/** Flattened request fields as text, for the sheet and the record. */
export function flatten(value: unknown, prefix = '', out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (Object.keys(out).length >= 200) return out;
  if (depth < 6 && (record(value) || Array.isArray(value))) {
    for (const [key, item] of Object.entries(value)) flatten(item, prefix ? `${prefix}.${key}` : key, out, depth + 1);
    return out;
  }
  if (prefix) out[prefix] = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
  return out;
}

// ---------- Catalogue (core + writeback) ----------

const IMPACT_KIND: Record<Operation['impact'], CatalogueKind> = { reversible: 'inside-undoable', message: 'seen-outside', money: 'money', destructive: 'cannot-undo' };
const KINDS: readonly CatalogueKind[] = ['inside-undoable', 'seen-outside', 'money', 'cannot-undo'];
const STATUSES: readonly CatalogueRow['status'][] = ['live', 'experimental', 'prepare-only', 'not-yet'];
export type Catalogue = { entries: Map<string, CatalogueEntry & { reversal: string | null }>; writeback: boolean };
const key = (system: string, action: string) => `${system}\u0000${action}`;

/** Reads `writeback.catalogue` when installed. Rows that do not carry the written fields are left out, never guessed. */
export async function catalogue(ctx: Context, host: ModuleHost): Promise<Catalogue> {
  const entries: Catalogue['entries'] = new Map();
  for (const connector of host.services.actions.catalogue(ctx) as { id: string; title: string; operations: { id: string; title: string; description: string; impact: Operation['impact']; idempotency: string; readback: string }[] }[]) {
    if (connector.id === invoiceConnectorId) continue;
    for (const op of connector.operations) entries.set(key(connector.id, op.id), {
      system: connector.id, systemTitle: connector.title, action: op.id, title: op.title, kind: IMPACT_KIND[op.impact], waits: op.impact !== 'reversible', status: 'live', source: 'core',
      description: op.description, idempotency: op.idempotency, readBack: op.readback, retryWindow: null, tier: op.impact === 'reversible' ? 'tier-1' : 'tier-2', expires: null, readStatus: null, reversal: null,
    });
  }
  const outside = await optionalCall<unknown>(host, 'writeback.catalogue', {});
  if (outside.available) {
    const rows = Array.isArray(outside.value) ? outside.value : record(outside.value) && Array.isArray(outside.value.rows) ? outside.value.rows : [];
    for (const row of rows) {
      if (!record(row) || !text(row.system, 80) || !text(row.action, 80) || !text(row.title) || !STATUSES.includes(row.status as any)) continue;
      const kind = KINDS.includes(row.kind as any) ? row.kind as CatalogueKind : typeof row.impact === 'string' && Object.hasOwn(IMPACT_KIND, row.impact) ? IMPACT_KIND[row.impact as Operation['impact']] : null;
      if (!kind) continue;
      const core = entries.get(key(row.system, row.action)); const opt = (v: unknown, fallback: string | null) => text(v, 2000) ? v : fallback;
      entries.set(key(row.system, row.action), {
        system: row.system, systemTitle: opt(row.systemTitle, core?.systemTitle ?? row.system)!, action: row.action, title: row.title, kind,
        waits: kind !== 'inside-undoable' || row.waits === true, status: row.status as CatalogueRow['status'], source: 'writeback',
        description: opt(row.description, core?.description ?? '')!, idempotency: opt(row.idempotency, core?.idempotency ?? '')!, readBack: opt(row.readBack, core?.readBack ?? '')!,
        retryWindow: opt(row.retryWindow, null), tier: kind === 'inside-undoable' && row.tier !== 'tier-2' ? 'tier-1' : 'tier-2',
        expires: opt(row.expires, null), readStatus: opt(row.readStatus, null), reversal: opt(row.reversal, null),
      });
    }
  }
  return { entries, writeback: outside.available };
}
export const catalogueRow = ({ system, systemTitle, action, title, kind, waits, status, source }: CatalogueEntry): CatalogueRow => ({ system, systemTitle, action, title, kind, waits, status, source });
export const catalogueEntry = ({ reversal, ...entry }: CatalogueEntry & { reversal: string | null }): CatalogueEntry => entry;

// ---------- Queue ----------

export type Env = { ctx: Context; host: ModuleHost; state: State; work: WorkState; catalogue: Catalogue; now: number };
export async function env(ctx: Context, host: ModuleHost): Promise<Env> {
  const cat = await catalogue(ctx, host); const state = host.store.read();
  return { ctx, host, state, work: readWork(state), catalogue: cat, now: nowMs(host) };
}
const readOnly = (e: Env) => READ_ONLY_ROLES.includes(e.ctx.role);
const snoozedUntil = (e: Env, id: string) => { const until = e.work.snoozes[e.ctx.memberId]?.[id]; return until && Date.parse(until) > e.now ? until : undefined; };

export function visibleActions(e: Env): PreparedAction[] { return (e.host.services.actions.list(e.ctx) as PreparedAction[]).filter(a => a.connector !== invoiceConnectorId); }
export function visibleJobs(e: Env): Job[] { return e.host.services.jobs ? (e.host.services.jobs.list(e.ctx) as Job[]).filter(j => j.type !== invoiceJobType) : []; }

/** A job waits for approval when its mandate needs a yes for the current exact revision, or the scheduler held it for one. */
export function jobNeedsApproval(job: Job): boolean {
  if (!['scheduled', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait', 'paused'].includes(job.status) || job.deliverable !== undefined) return false;
  const current = job.approval?.digest === job.digest && job.approval.revision === job.revision;
  return job.status === 'approval-blocked' || (job.requiresApproval && !current);
}

type Draft = { id: string; name: string; author: string; createdAt: string; state: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; change: string; digest: string };
/** Dictionary drafts are written by the Books side; they are read defensively and malformed ones are skipped. */
export function drafts(state: State): Draft[] {
  const books = peekSection<{ drafts?: unknown }>(state, 'books');
  return (Array.isArray(books?.drafts) ? books.drafts : []).filter((d): d is Draft => record(d) && text(d.id) && text(d.name) && typeof d.author === 'string' && typeof d.createdAt === 'string' && typeof d.state === 'string' && typeof d.digest === 'string' && typeof d.change === 'string' && (d.before === null || record(d.before)) && (d.after === null || record(d.after)));
}
type Lesson = { candidate: { id: string; revision: number; digest: string; title: string; proposedAt: string; change: { kind: string; targetId: string; before: unknown; after: unknown } }; status: string; review?: { id: string; digest: string } };
export function lessons(e: Env): Lesson[] {
  if (!e.host.services.lessons) return [];
  return (e.host.services.lessons.lessons(e.ctx) as Lesson[]).filter(l => record(l?.candidate) && text(l.candidate.id));
}

function expiresAt(e: Env, action: PreparedAction): string {
  const base = Math.max(Date.parse(action.createdAt), Date.parse(e.work.revisedAt[action.id] ?? action.createdAt));
  return isoAt(base + (action.impact === 'message' ? DAY : 7 * DAY));
}
export const expired = (e: Env, row: ApprovalRow) => row.state === 'prepared' && row.expiresAt !== null && Date.parse(row.expiresAt) <= e.now;

const ACTION_KIND: Record<Operation['impact'], ApprovalRow['kind']> = { message: 'message', money: 'money', destructive: 'record-change', reversible: 'record-change' };
const TARGET_FIELDS = ['to', 'recipient', 'customerName', 'customerId', 'supplierId', 'invoiceId', 'recordId', 'target'];
function actionRow(e: Env, action: PreparedAction): ApprovalRow & { entry: (CatalogueEntry & { reversal: string | null }) | undefined } {
  const entry = e.catalogue.entries.get(key(action.connector, action.operation));
  const prepareOnly = entry?.status === 'prepare-only';
  const target = TARGET_FIELDS.map(f => action.payload[f]).find(v => text(v));
  const system = entry?.systemTitle ?? action.connector;
  const name = memberName(e.state, action.createdBy);
  return {
    id: `action:${action.id}`, source: 'action', kind: prepareOnly ? 'prepare-only' : ACTION_KIND[action.impact],
    tier: prepareOnly ? 'prepare-only' : action.impact === 'reversible' ? 'tier-1' : 'tier-2',
    title: entry?.title ?? `${action.connector} ${action.operation}`, touches: target ? `${system}: ${target}` : system,
    amount: minorAmount(action.payload.amountMinor), preparedBy: name ? { kind: 'person', name } : { kind: 'chausar', name: 'Chausar' },
    createdAt: action.createdAt, expiresAt: expiresAt(e, action), state: action.status, practice: false, entry,
  };
}
function actionRule(action: PreparedAction, entry: CatalogueEntry | undefined): string {
  if (action.impact === 'money') return 'always-waits:money';
  if (action.impact === 'message') return 'always-waits:message';
  if (action.impact === 'destructive') return entry?.kind === 'cannot-undo' && !/delete|remove/i.test(action.operation) ? 'always-waits:irreversible' : 'always-waits:delete';
  return entry?.kind === 'cannot-undo' ? 'always-waits:irreversible' : 'autonomy-off';
}
export function actionSteps(action: PreparedAction, isExpired: boolean): Step[] {
  const attempt = action.attempts[0]; const approved: [StepState, string | null] = action.approval ? ['done', action.approval.at] : ['not-reached', null];
  switch (action.status) {
    case 'prepared': return steps(['done', action.createdAt], [isExpired ? 'stopped-by-rule' : 'waiting-for-you', null]);
    case 'approved': return steps(['done', action.createdAt], approved, ['waiting-for-you', null]);
    case 'executing': return steps(['done', action.createdAt], approved, ['waiting-for-network', attempt?.startedAt ?? null]);
    case 'unknown': return steps(['done', action.createdAt], approved, ['unsure', attempt?.finishedAt ?? null], [action.readback ? 'unsure' : 'not-reached', null]);
    case 'verified': { const at = attempt?.finishedAt ?? null; return steps(['done', action.createdAt], approved, ['done', at], ['done', at], ['done', at]); }
    case 'rejected': { const at = attempt?.finishedAt ?? null; return steps(['done', action.createdAt], approved, ['stopped-by-rule', at], ['done', at], ['done', at]); }
    case 'blocked': return steps(['done', action.createdAt], ['stopped-by-rule', null]);
    default: return steps(['done', action.createdAt], ['not-reached', null]);
  }
}
function changeOf(action: PreparedAction): ApprovalDetail['change'] {
  const p = action.payload; const out: ApprovalDetail['change'] = {};
  if (action.impact === 'message') { const written = [p.text, p.body, p.message].find(v => typeof v === 'string'); if (typeof written === 'string') out.asWritten = written; }
  if (record(p.before) && record(p.after)) {
    const before = flatten(p.before), after = flatten(p.after);
    out.fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().map(name => ({ name, before: before[name] ?? '', after: after[name] ?? '' }));
  } else out.fields = Object.entries(flatten(p)).map(([name, after]) => ({ name, before: '', after }));
  return out;
}
function voucherOf(action: PreparedAction): ApprovalDetail['voucher'] {
  const v = action.payload.voucher;
  if (!record(v) || !text(v.type, 80) || !(v.number === null || v.number === undefined || text(v.number, 80)) || typeof v.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.date) || !Array.isArray(v.lines)) return undefined;
  const lines = v.lines.filter(record).filter(l => text(l.ledger)).map(l => ({ ledger: l.ledger as string, debit: minorAmount(l.debitMinor), credit: minorAmount(l.creditMinor) }));
  return { type: v.type, number: (v.number as string | undefined) ?? null, date: v.date, lines, note: 'prepare-only' };
}
function canFor(e: Env, row: ApprovalRow, prepareOnly: boolean, extra: { change: boolean; approve: boolean }): Can[] {
  if (readOnly(e)) return [];
  if (row.state === 'unknown') return ['reconcile'];
  if (row.state === 'approved' && row.source === 'action') return ['drop'];
  if (row.state !== 'prepared') return [];
  if (expired(e, row)) return extra.change ? ['change', 'drop'] : ['drop'];
  return [...(!prepareOnly && extra.approve ? ['approve' as const] : []), 'notNow', ...(extra.change ? ['change' as const] : []), 'drop'];
}
function finish(e: Env, row: ApprovalRow, rest: Omit<ApprovalDetail, keyof ApprovalRow | 'readOnly' | 'snoozedUntil' | 'blocked' | 'can'> & { blocked?: ApprovalDetail['blocked'] }, extra: { change: boolean; approve: boolean }): ApprovalDetail {
  const detail: ApprovalDetail = { ...row, ...rest, can: canFor(e, row, rest.prepareOnly, extra), readOnly: readOnly(e) };
  if (expired(e, row)) detail.blocked = { kind: 'expired', code: 'APPROVAL_EXPIRED' };
  else if (row.state === 'prepared' && e.ctx.role === 'accountant') detail.blocked = { kind: 'owner-approves', code: 'OWNER_APPROVES' };
  else if (rest.blocked) detail.blocked = rest.blocked;
  else delete detail.blocked;
  const until = snoozedUntil(e, row.id); if (until) detail.snoozedUntil = until;
  return detail;
}

export function actionDetail(e: Env, action: PreparedAction): ApprovalDetail {
  const { entry, ...row } = actionRow(e, action); const prepareOnly = row.tier === 'prepare-only';
  const voucher = voucherOf(action);
  const blocked: ApprovalDetail['blocked'] | undefined = action.status === 'unknown' ? { kind: 'unsure', code: 'OUTCOME_UNKNOWN' } : action.status === 'blocked' ? { kind: 'prepare-blocked', code: text(action.blockedReason, 80) && /^[A-Z][A-Z0-9_]*$/.test(action.blockedReason) ? action.blockedReason : 'PREPARE_BLOCKED' } : action.revision > 1 && action.status === 'prepared' ? { kind: 'changed', code: 'PREPARED_AGAIN' } : undefined;
  return finish(e, row, {
    digest: action.digest, revision: action.revision, reason: actionRule(action, entry), change: changeOf(action), ...(voucher && prepareOnly ? { voucher } : {}),
    steps: actionSteps(action, expired(e, row)), prepareOnly, needsSecondAsk: action.impact === 'money', ...(blocked ? { blocked } : {}),
  }, { change: true, approve: true });
}

export function jobCard(state: State, job: Job): JobCard {
  const last = [...job.ledger].reverse().find(l => ['delivered', 'reserved'].includes(l.event));
  const terminal = ['cancelled', 'stopped', 'accepted', 'revoked'].includes(job.status);
  return {
    id: job.id, goal: job.goal, doneWhen: 'When its owner accepts the result.', owner: memberName(state, job.ownerId) ?? job.ownerId,
    budget: { minor: job.budgetMinor }, reserve: { minor: job.reserveMinor }, spent: { minor: job.spentMinor }, stopRule: { maxRuns: job.stopRule.maxRuns, deadline: job.stopRule.deadline },
    actions: [...(job.allowedActions ?? [])], testedRoutes: [...(job.testedRoutes ?? [])], reviewOn: null, missedRun: job.catchup === 'skip' ? 'skip' : 'run-once-on-wake', runsOn: 'this-computer',
    runs: job.runs, lastRunAt: last?.at ?? null, nextRunAt: terminal ? null : job.nextRunAt, untrustedInstructions: false, digest: job.digest, revision: job.revision,
  };
}
export function jobDetail(e: Env, job: Job, acceptance: boolean): ApprovalDetail {
  const waiting = acceptance ? job.status === 'awaiting-acceptance' : jobNeedsApproval(job);
  const state: RowState = waiting ? 'prepared' : job.status === 'cancelled' ? 'cancelled' : acceptance && job.status === 'accepted' ? 'verified' : ['stopped', 'revoked'].includes(job.status) ? 'blocked' : 'approved';
  const owner = memberName(e.state, job.ownerId) ?? job.ownerId;
  const row: ApprovalRow = {
    id: `${acceptance ? 'acceptance' : 'job'}:${job.id}`, source: acceptance ? 'acceptance' : 'job', kind: 'job', tier: 'tier-2',
    title: acceptance ? `Accept result: ${job.goal}` : `Start job: ${job.goal}`, touches: job.allowedActions?.length ? job.allowedActions.join(', ') : null,
    amount: { minor: acceptance ? job.spentMinor : job.budgetMinor }, preparedBy: acceptance ? { kind: 'job', name: job.goal } : { kind: 'person', name: owner },
    createdAt: job.createdAt, expiresAt: null, state, practice: false,
  };
  const at = (event: string) => [...job.ledger].reverse().find(l => l.event === event)?.at ?? null;
  const jobSteps = acceptance
    ? steps(['done', job.createdAt], ['done', at('approved')], ['done', at('delivered')], [state === 'prepared' ? 'waiting-for-you' : state === 'verified' ? 'done' : 'not-reached', at('accepted')], [state === 'verified' ? 'done' : 'not-reached', at('accepted')])
    : steps(['done', job.createdAt], [state === 'prepared' ? 'waiting-for-you' : state === 'approved' ? 'done' : 'not-reached', state === 'approved' ? at('approved') : null]);
  const stale = !acceptance && waiting && job.approval !== undefined && job.approval.digest !== job.digest;
  return finish(e, row, {
    digest: job.digest, revision: job.revision, reason: acceptance ? 'acceptance' : 'job-approval', change: { fields: [{ name: 'goal', before: '', after: job.goal }] },
    job: jobCard(e.state, job), steps: jobSteps, prepareOnly: false, needsSecondAsk: false, ...(stale ? { blocked: { kind: 'changed' as const, code: 'PREVIEW_CHANGED' } } : {}),
  }, { change: !acceptance, approve: true });
}
const DEFINITION_FIELDS = ['label', 'meaning', 'kind', 'field', 'nulls', 'sign'];
export function releaseDetail(e: Env, draft: Draft): ApprovalDetail {
  const state: RowState = ['draft', 'cosigned'].includes(draft.state) ? 'prepared' : draft.state === 'published' ? 'verified' : draft.state === 'discarded' ? 'cancelled' : 'blocked';
  const row: ApprovalRow = {
    id: `release:${draft.id}`, source: 'release', kind: 'record-change', tier: 'tier-2', title: `Publish meaning: ${draft.name}`, touches: `Dictionary: ${draft.name}`,
    amount: null, preparedBy: draft.author ? { kind: 'person', name: draft.author } : null, createdAt: draft.createdAt, expiresAt: null, state, practice: false,
  };
  const value = (d: Record<string, unknown> | null, f: string) => d && d[f] !== undefined ? (typeof d[f] === 'string' ? d[f] as string : JSON.stringify(d[f])) : '';
  const fields = DEFINITION_FIELDS.map(name => ({ name, before: value(draft.before, name), after: value(draft.after, name) })).filter(f => f.before !== f.after);
  return finish(e, row, {
    digest: draft.digest, revision: 1, reason: 'release-cosign', change: { asWritten: draft.change, fields },
    steps: state === 'verified' ? steps(['done', draft.createdAt], ['done', null], ['done', null], ['not-reached', null], ['done', null]) : steps(['done', draft.createdAt], [state === 'prepared' ? 'waiting-for-you' : 'not-reached', null]),
    prepareOnly: false, needsSecondAsk: false,
  }, { change: true, approve: true });
}
export function lessonDetail(e: Env, lesson: Lesson): ApprovalDetail {
  const c = lesson.candidate; const state: RowState = lesson.status === 'approved' ? 'verified' : ['rejected', 'retired', 'superseded'].includes(lesson.status) ? 'cancelled' : 'prepared';
  const row: ApprovalRow = {
    id: `lesson:${c.id}`, source: 'lesson', kind: 'record-change', tier: 'tier-1', title: 'Review a learned preference', touches: text(c.change?.kind, 80) ? `Preference: ${c.change.kind}` : null,
    amount: null, preparedBy: { kind: 'chausar', name: 'Chausar' }, createdAt: typeof c.proposedAt === 'string' ? c.proposedAt : isoAt(0), expiresAt: null, state, practice: false,
  };
  const show = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  return finish(e, row, {
    digest: c.digest, revision: c.revision, reason: 'lesson-review', change: { fields: [{ name: text(c.change?.targetId) ? c.change.targetId : 'value', before: show(c.change?.before), after: show(c.change?.after) }] },
    steps: state === 'verified' ? steps(['done', row.createdAt], ['done', null], ['done', null], ['not-reached', null], ['done', null]) : steps(['done', row.createdAt], [state === 'prepared' && lesson.review ? 'waiting-for-you' : 'not-reached', null]),
    prepareOnly: false, needsSecondAsk: false, ...(state === 'prepared' && !lesson.review ? { blocked: { kind: 'prepare-blocked' as const, code: 'LESSON_REVIEW_PENDING' } } : {}),
  }, { change: false, approve: lesson.review !== undefined });
}

/** Every item waiting in the queue, before snoozes and expiry are applied. */
export function queue(e: Env): ApprovalDetail[] {
  const items: ApprovalDetail[] = [];
  for (const action of visibleActions(e)) if (action.status === 'prepared') items.push(actionDetail(e, action));
  for (const job of visibleJobs(e)) {
    if (jobNeedsApproval(job)) items.push(jobDetail(e, job, false));
    if (job.status === 'awaiting-acceptance') items.push(jobDetail(e, job, true));
  }
  for (const draft of drafts(e.state)) if (draft.state === 'draft' || draft.state === 'cosigned') items.push(releaseDetail(e, draft));
  for (const lesson of lessons(e)) if (lesson.status === 'review-ready') items.push(lessonDetail(e, lesson));
  return items;
}
export const order = (a: ApprovalRow, b: ApprovalRow) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function rowOf(detail: ApprovalDetail): ApprovalRow {
  const { id, source, kind, tier, title, touches, amount, preparedBy, createdAt, expiresAt, state, practice } = detail;
  return { id, source, kind, tier, title, touches, amount, preparedBy, createdAt, expiresAt, state, practice };
}
export function snoozed(e: Env, id: string) { return snoozedUntil(e, id) !== undefined; }

/** Resolves any typed id the caller may see, waiting or not. */
export function detail(e: Env, id: string): ApprovalDetail {
  const { source, raw } = parseId(id);
  if (source === 'action') { const action = visibleActions(e).find(a => a.id === raw); check(action, 'NOT_FOUND', 'Approval not found.'); return actionDetail(e, action); }
  if (source === 'job' || source === 'acceptance') { const job = visibleJobs(e).find(j => j.id === raw); check(job, 'NOT_FOUND', 'Approval not found.'); return jobDetail(e, job, source === 'acceptance'); }
  if (source === 'release') { const draft = drafts(e.state).find(d => d.id === raw); check(draft, 'NOT_FOUND', 'Approval not found.'); return releaseDetail(e, draft); }
  const lesson = lessons(e).find(l => l.candidate.id === raw); check(lesson, 'NOT_FOUND', 'Approval not found.'); return lessonDetail(e, lesson);
}

// ---------- Actions record (WK-04, WK-05, WK-15) ----------

export function actionView(e: Env, action: PreparedAction): ActionView {
  const { entry, ...row } = actionRow(e, action); const request = flatten(action.payload);
  let readBack: ActionView['readBack'] = null;
  if (action.readback) {
    const data = action.readback.data; const found = { ...(record(data) && record(data.payload) ? flatten(data.payload) : {}), ...flatten(data) };
    readBack = Object.entries(request).map(([field, asked]) => { const value = Object.hasOwn(found, field) ? found[field] : null; return { field, asked, found: value, same: value === asked }; });
  }
  const unknown = action.status === 'unknown'; const approver = !READ_ONLY_ROLES.includes(e.ctx.role);
  return {
    id: row.id, system: action.connector, action: action.operation, title: row.title, touches: row.touches, amount: row.amount, state: action.status,
    steps: actionSteps(action, expired(e, row)), approvedBy: action.approval ? memberName(e.state, action.approval.memberId) ?? action.approval.memberId : null,
    channel: e.work.channels[action.id] ?? null, request, readBack, rule: actionRule(action, entry), attestation: e.work.attestations[action.id] ?? null,
    wouldHaveDone: action.impact === 'reversible' && entry?.kind !== 'cannot-undo' && e.state.policy.autonomy ? 'done' : 'waited',
    createdAt: action.createdAt, settledAt: ['verified', 'rejected', 'unknown'].includes(action.status) ? action.attempts[0]?.finishedAt ?? null : null,
    can: e.ctx.role === 'viewer' ? [] : [
      ...(action.status === 'approved' ? ['execute' as const] : []), ...(unknown ? ['reconcile' as const] : []), ...(unknown && approver ? ['resolve' as const] : []),
      ...(action.status === 'verified' && approver && entry?.reversal ? ['reverse' as const] : []),
    ],
  };
}
export function findAction(e: Env, id: unknown): PreparedAction {
  const { source, raw } = parseId(id); check(source === 'action', 'INVALID_APPROVAL', 'Use an action id.');
  const action = visibleActions(e).find(a => a.id === raw); check(action, 'NOT_FOUND', 'Action not found.'); return action;
}
export { key as catalogueKey, readOnly as isReadOnly };
