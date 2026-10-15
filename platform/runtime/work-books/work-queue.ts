/**
 * Read models for Work (WK-01..WK-06, WK-15): the one approvals queue, the approval sheet, the
 * five steps, the actions record and the catalogue. Everything here is derived from the
 * prepared request itself (actions, jobs, dictionary drafts, lessons), never from model text.
 */
import { check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { PreparedAction, Operation } from '../actions.ts';
import type { Job } from '../jobs.ts';
import type { ModuleHost } from '../modules/types.ts';
import { invoiceConnectorId, invoiceJobType } from '../invoice-follow-up.ts';
import { optionalCall } from './adapters.ts';
import { peekSection } from './state.ts';
import { loadWriteback, wbDetail, findView, catalogueFromWriteback } from './work-writeback.ts';
import type { WbEnv, WbExtra, Reminder } from './work-writeback.ts';

export type Amount = { minor: string } | { missing: 'absent' | 'null' | 'unknown' | 'withheld' | 'not-applicable' | 'not-loaded-yet' | 'not-counted' };
export type Source = 'action' | 'job' | 'release' | 'lesson' | 'acceptance' | 'writeback' | 'bill' | 'proposal';
import { billVisible, storedBills, type StoredBill } from './books-bill.ts';
import { loadLaneProposals, proposalDetail, type LaneProposal } from './work-jobs-lane.ts';
export type Tier = 'tier-2' | 'tier-1' | 'prepare-only';
export type RowState = PreparedAction['status'];
export type ApprovalRow = {
  id: string; source: Source; kind: 'message' | 'record-change' | 'money' | 'prepare-only' | 'job' | 'group'; tier: Tier;
  title: string; touches: string | null; amount: Amount | null; preparedBy: { kind: 'person' | 'job' | 'chausar'; name: string } | null;
  createdAt: string; expiresAt: string | null; state: RowState; practice: boolean;
  /** What the row is, as a fixed kind and the name it is about, so a screen can say it in its own language (the title stays the English line). */
  what?: { kind: WhatKind; name: string | null };
};
export type WhatKind = 'start-job' | 'change-job' | 'accept-result' | 'publish-meaning' | 'review-lesson' | 'bill-zoho' | 'bill-tally';
export type StepName = 'prepared' | 'approved' | 'done' | 'read-back' | 'recorded';
export type StepState = 'done' | 'waiting-for-you' | 'waiting-for-network' | 'unsure' | 'stopped-by-rule' | 'not-reached';
export type Step = { name: StepName; state: StepState; at: string | null };
export type Can = 'approve' | 'notNow' | 'change' | 'drop' | 'reconcile';
export type ApprovalDetail = ApprovalRow & {
  digest: string; revision: number; reason: string;
  /** `key`: a fixed line of this lane's own (the acceptance sentence), so a screen can say it in its language. */
  change: { asWritten?: string; key?: 'acceptance'; fields?: { name: string; before: string; after: string }[] };
  voucher?: { type: string; number: string | null; date: string; lines: { ledger: string; debit: Amount | null; credit: Amount | null }[]; note: 'prepare-only' };
  job?: JobCard; steps: Step[]; can: Can[]; readOnly: boolean; prepareOnly: boolean; needsSecondAsk: boolean;
  blocked?: { kind: 'expired' | 'owner-approves' | 'unsure' | 'changed' | 'prepare-blocked'; code: string };
  snoozedUntil?: string;
  /** Write-back items only: the system, the catalogue's own reason, the connection and the notices. */
  writeback?: WbExtra;
  /** How the second ask is drawn: the typed amount, or a passphrase when write-back asks for one. */
  secondAsk?: { by: 'typed-amount' | 'passphrase'; whose?: 'own-secret' | 'vault-passphrase'; setFirst?: true; lockedUntil?: string };
  /** WK-12: a reminder to a customer, with its agreement, limits and (owner only) payment notes. */
  reminder?: Reminder;
  /** After approving a jobs-ext proposal: the queue id of the job it made. */
  approvedJobId?: string;
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
  writeback?: WbExtra;
  /** After a write-back execute that did not send: expired, prepared again, or cancelled because its evidence changed. */
  notice?: { kind: string; message: string };
};
export type CatalogueKind = 'inside-undoable' | 'seen-outside' | 'money' | 'cannot-undo';
export type CatalogueRow = { system: string; systemTitle: string; action: string; title: string; kind: CatalogueKind; waits: boolean; status: 'live' | 'experimental' | 'prepare-only' | 'not-yet'; source: 'core' | 'writeback';
  /** Write-back rows: how far the write-back recipe was tested, and its score (kept apart from reading). */
  qualification?: 'synthetic-tested' | 'sandbox-verified' | 'live-verified' | 'unqualified' | null; writeScore?: string | null };
export type CatalogueEntry = CatalogueRow & { description: string; idempotency: string; readBack: string; retryWindow: string | null; tier: 'tier-1' | 'tier-2'; expires: string | null; readStatus: string | null;
  waitsBecause?: string | null; plannedStatus?: CatalogueRow['status'] | null; businessReference?: string | null; approvalLifetime?: string | null; reviewedOn?: string | null;
  installed?: boolean; connections?: { id: string; label: string; environment: 'live' | 'sandbox' | 'practice'; read: boolean; write: boolean }[]; grants?: number; undo?: string | null };
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
  executing: Record<string, { at: number; token: string }>;  // actionId -> execution reservation held while ActionService.execute runs
};
export const initWork = (): WorkState => ({ snoozes: {}, opened: {}, pace: [], attestations: {}, channels: {}, revisedAt: {}, wanted: [], executing: {} });
/** The pace and opened-sheet logs are bounded so they cannot grow without limit. */
export const LOG_KEEP = 200;
export function boundLogs(work: WorkState): number {
  let removed = 0;
  if (work.pace.length > LOG_KEEP) { removed += work.pace.length - LOG_KEEP; work.pace = work.pace.slice(-LOG_KEEP); }
  const opened = Object.entries(work.opened);
  if (opened.length > LOG_KEEP) for (const [k] of opened.sort((a, b) => a[1] - b[1]).slice(0, opened.length - LOG_KEEP)) { delete work.opened[k]; removed += 1; }
  return removed;
}
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

/** Typed queue ids: `action:<id>`, `job:<id>`, `release:<draftId>`, `lesson:<id>`, `acceptance:<jobId>`, `writeback:<actionId>`, `bill:<billId>`, `proposal:<jobs-ext proposal id>`. */
export function parseId(value: unknown): { source: Source; raw: string } {
  check(typeof value === 'string' && value.length <= 240, 'INVALID_APPROVAL', 'Use a typed approval id.');
  const match = /^(action|job|release|lesson|acceptance|writeback|bill|proposal):([A-Za-z0-9_.:-]{1,200})$/.exec(value);
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
      qualification: null, writeScore: null,
    });
  }
  const outside = await optionalCall<unknown>(host, 'writeback.catalogue', {});
  if (outside.available) {
    const rows = Array.isArray(outside.value) ? outside.value : record(outside.value) && Array.isArray(outside.value.rows) ? outside.value.rows : [];
    for (const row of rows) {
      const entry = catalogueFromWriteback(row);
      if (entry) entries.set(key(entry.system, entry.action), entry);
    }
  }
  return { entries, writeback: outside.available };
}
export const catalogueRow = ({ system, systemTitle, action, title, kind, waits, status, source, qualification, writeScore }: CatalogueEntry): CatalogueRow => ({ system, systemTitle, action, title, kind, waits, status, source, qualification: qualification ?? null, writeScore: writeScore ?? null });
export const catalogueEntry = ({ reversal, ...entry }: CatalogueEntry & { reversal: string | null }): CatalogueEntry => entry;

// ---------- Queue ----------

/** `proposals`: jobs-ext's proposed cards, loaded only where the queue or a `proposal:` item needs them (`withProposals`). */
export type Env = { ctx: Context; host: ModuleHost; state: State; work: WorkState; catalogue: Catalogue; now: number; wb: WbEnv; proposals?: LaneProposal[] };
export async function env(ctx: Context, host: ModuleHost): Promise<Env> {
  const cat = await catalogue(ctx, host); const wb = await loadWriteback(host); const state = host.store.read();
  return { ctx, host, state, work: readWork(state), catalogue: cat, now: nowMs(host), wb };
}
/** The environment with jobs-ext's proposals, for the queue and for a `proposal:` id (any other id needs none). */
export async function withProposals(ctx: Context, host: ModuleHost, id?: unknown): Promise<Env> {
  const e = await env(ctx, host);
  if (id === undefined || (typeof id === 'string' && id.startsWith('proposal:'))) e.proposals = await loadLaneProposals(host);
  return e;
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
type Entry = (CatalogueEntry & { reversal: string | null }) | undefined;
/** The catalogue row (core or writeback) says this operation always waits. */
const catalogueWaits = (entry: Entry) => entry !== undefined && (['cannot-undo', 'money', 'seen-outside'].includes(entry.kind) || entry.tier === 'tier-2');
/** The stronger of the core impact and the catalogue row: tier-2 when either says the action always waits. */
export function actionTier(e: Env, action: PreparedAction): 'tier-1' | 'tier-2' {
  return action.impact === 'reversible' && !catalogueWaits(e.catalogue.entries.get(key(action.connector, action.operation))) ? 'tier-1' : 'tier-2';
}
function actionKind(action: PreparedAction, entry: Entry): ApprovalRow['kind'] {
  if (action.impact !== 'reversible') return ACTION_KIND[action.impact];
  return entry?.kind === 'money' ? 'money' : entry?.kind === 'seen-outside' ? 'message' : 'record-change';
}
const TARGET_FIELDS = ['to', 'recipient', 'customerName', 'customerId', 'supplierId', 'invoiceId', 'recordId', 'target'];
function actionRow(e: Env, action: PreparedAction): ApprovalRow & { entry: Entry } {
  const entry = e.catalogue.entries.get(key(action.connector, action.operation));
  const prepareOnly = entry?.status === 'prepare-only'; const kind = actionKind(action, entry);
  const amount = minorAmount(action.payload.amountMinor);
  const target = TARGET_FIELDS.map(f => action.payload[f]).find(v => text(v));
  const system = entry?.systemTitle ?? action.connector;
  const name = memberName(e.state, action.createdBy);
  return {
    id: `action:${action.id}`, source: 'action', kind: prepareOnly ? 'prepare-only' : kind,
    tier: prepareOnly ? 'prepare-only' : actionTier(e, action),
    title: entry?.title ?? `${action.connector} ${action.operation}`, touches: target ? `${system}: ${target}` : system,
    amount: amount ?? (kind === 'money' ? { missing: 'unknown' } : null), preparedBy: name ? { kind: 'person', name } : { kind: 'chausar', name: 'Chausar' },
    createdAt: action.createdAt, expiresAt: expiresAt(e, action), state: action.status, practice: false, entry,
  };
}
function actionRule(action: PreparedAction, entry: Entry): string {
  if (action.impact === 'money' || (action.impact === 'reversible' && entry?.kind === 'money')) return 'always-waits:money';
  if (action.impact === 'message' || (action.impact === 'reversible' && entry?.kind === 'seen-outside')) return 'always-waits:message';
  if (action.impact === 'destructive') return entry?.kind === 'cannot-undo' && !/delete|remove/i.test(action.operation) ? 'always-waits:irreversible' : 'always-waits:delete';
  return catalogueWaits(entry) ? 'always-waits:irreversible' : 'autonomy-off';
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
  if (row.state === 'approved' && (row.source === 'action' || row.source === 'writeback')) return ['drop'];
  if (row.state !== 'prepared') return [];
  if (expired(e, row)) return extra.change ? ['change', 'drop'] : ['drop'];
  return [...(!prepareOnly && extra.approve ? ['approve' as const] : []), 'notNow', ...(extra.change ? ['change' as const] : []), 'drop'];
}
export function finish(e: Env, row: ApprovalRow, rest: Omit<ApprovalDetail, keyof ApprovalRow | 'readOnly' | 'snoozedUntil' | 'blocked' | 'can'> & { blocked?: ApprovalDetail['blocked'] }, extra: { change: boolean; approve: boolean }): ApprovalDetail {
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
    steps: actionSteps(action, expired(e, row)), prepareOnly, needsSecondAsk: row.kind === 'money', ...(blocked ? { blocked } : {}),
  }, { change: true, approve: true });
}

export function jobCard(state: State, job: Job): JobCard {
  const last = [...job.ledger].reverse().find(l => ['delivered', 'reserved'].includes(l.event));
  const terminal = ['cancelled', 'stopped', 'accepted', 'revoked'].includes(job.status);
  return {
    id: job.id, goal: job.goal, doneWhen: 'When its owner accepts the result.', owner: memberName(state, job.ownerId) ?? job.ownerId,
    budget: { minor: job.budgetMinor }, reserve: { minor: job.reserveMinor }, spent: { minor: job.spentMinor }, stopRule: { maxRuns: job.stopRule.maxRuns, deadline: job.stopRule.deadline },
    // Round 4 (core-sync-jobs): a review date on the core job (`reviewDate`, YYYY-MM-DD) when the core serves one.
    actions: [...(job.allowedActions ?? [])], testedRoutes: [...(job.testedRoutes ?? [])], reviewOn: reviewDateOf(job), missedRun: job.catchup === 'skip' ? 'skip' : 'run-once-on-wake', runsOn: 'this-computer',
    runs: job.runs, lastRunAt: last?.at ?? null, nextRunAt: terminal ? null : job.nextRunAt, untrustedInstructions: false, digest: job.digest, revision: job.revision,
  };
}
const reviewDateOf = (job: Job): string | null => { const d = (job as { reviewDate?: unknown }).reviewDate; return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null; };
/**
 * The exact reference core `jobs.accept` checks: the job's objective digest and revision plus the
 * digest of the stored deliverable. The deliverable is read from workspace state (the caller's job
 * view may withhold it); only its digest leaves this function.
 */
export function acceptanceReference(e: Env, job: Job): { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string } {
  const stored = (e.state.jobs as Job[]).find(j => j.id === job.id)?.deliverable;
  return { kind: 'job-acceptance', id: job.id, revision: job.revision, digest: job.digest, deliverableDigest: digest(stored === undefined ? null : stored) };
}
/** The acceptance item's digest binds the objective, its revision and the deliverable together. */
export const acceptanceDigest = (ref: ReturnType<typeof acceptanceReference>) => digest({ job: ref.digest, revision: ref.revision, deliverable: ref.deliverableDigest });
function acceptanceChange(job: Job): ApprovalDetail['change'] {
  const d = job.deliverable; const receipts = record(d) && Array.isArray(d.receiptIds) ? d.receiptIds.filter(r => typeof r === 'string').length : null;
  return {
    asWritten: 'The job delivered a result. Accepting it closes this run.', key: 'acceptance',
    fields: [{ name: 'goal', before: '', after: job.goal }, { name: 'receipts', before: '', after: receipts === null ? 'not shown here' : String(receipts) }],
  };
}
export function jobDetail(e: Env, job: Job, acceptance: boolean): ApprovalDetail {
  const waiting = acceptance ? job.status === 'awaiting-acceptance' : jobNeedsApproval(job);
  const sentBack = acceptance && job.status === 'paused' && job.ledger.at(-1)?.event === 'rejected';
  const state: RowState = waiting ? 'prepared' : job.status === 'cancelled' ? 'cancelled' : acceptance && job.status === 'accepted' ? 'verified' : sentBack ? 'rejected' : ['stopped', 'revoked'].includes(job.status) ? 'blocked' : 'approved';
  const owner = memberName(e.state, job.ownerId) ?? job.ownerId;
  const row: ApprovalRow = {
    id: `${acceptance ? 'acceptance' : 'job'}:${job.id}`, source: acceptance ? 'acceptance' : 'job', kind: 'job', tier: 'tier-2',
    title: acceptance ? `Accept result: ${job.goal}` : `Start job: ${job.goal}`, what: { kind: acceptance ? 'accept-result' : 'start-job', name: job.goal }, touches: job.allowedActions?.length ? job.allowedActions.join(', ') : null,
    amount: { minor: acceptance ? job.spentMinor : job.budgetMinor }, preparedBy: acceptance ? { kind: 'job', name: job.goal } : { kind: 'person', name: owner },
    createdAt: job.createdAt, expiresAt: null, state, practice: false,
  };
  const at = (event: string) => [...job.ledger].reverse().find(l => l.event === event)?.at ?? null;
  const jobSteps = acceptance
    ? steps(['done', job.createdAt], ['done', at('approved')], ['done', at('delivered')], [state === 'prepared' ? 'waiting-for-you' : state === 'verified' ? 'done' : 'not-reached', at('accepted')], [state === 'verified' ? 'done' : 'not-reached', at('accepted')])
    : steps(['done', job.createdAt], [state === 'prepared' ? 'waiting-for-you' : state === 'approved' ? 'done' : 'not-reached', state === 'approved' ? at('approved') : null]);
  const stale = !acceptance && waiting && job.approval !== undefined && job.approval.digest !== job.digest;
  return finish(e, row, {
    digest: acceptance ? acceptanceDigest(acceptanceReference(e, job)) : job.digest, revision: job.revision, reason: acceptance ? 'acceptance' : 'job-approval',
    change: acceptance ? acceptanceChange(job) : { fields: [{ name: 'goal', before: '', after: job.goal }] },
    job: jobCard(e.state, job), steps: jobSteps, prepareOnly: false, needsSecondAsk: false, ...(stale ? { blocked: { kind: 'changed' as const, code: 'PREVIEW_CHANGED' } } : {}),
  }, { change: !acceptance, approve: true });
}
const DEFINITION_FIELDS = ['label', 'meaning', 'kind', 'field', 'nulls', 'sign'];
export function releaseDetail(e: Env, draft: Draft): ApprovalDetail {
  const state: RowState = ['draft', 'cosigned'].includes(draft.state) ? 'prepared' : draft.state === 'published' ? 'verified' : draft.state === 'discarded' ? 'cancelled' : 'blocked';
  const row: ApprovalRow = {
    id: `release:${draft.id}`, source: 'release', kind: 'record-change', tier: 'tier-2', title: `Publish meaning: ${draft.name}`, what: { kind: 'publish-meaning', name: draft.name }, touches: `Dictionary: ${draft.name}`,
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
    id: `lesson:${c.id}`, source: 'lesson', kind: 'record-change', tier: 'tier-1', title: 'Review a learned preference', what: { kind: 'review-lesson', name: null }, touches: text(c.change?.kind, 80) ? `Preference: ${c.change.kind}` : null,
    amount: null, preparedBy: { kind: 'chausar', name: 'Chausar' }, createdAt: typeof c.proposedAt === 'string' ? c.proposedAt : isoAt(0), expiresAt: null, state, practice: false,
  };
  const show = (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  return finish(e, row, {
    digest: c.digest, revision: c.revision, reason: 'lesson-review', change: { fields: [{ name: text(c.change?.targetId) ? c.change.targetId : 'value', before: show(c.change?.before), after: show(c.change?.after) }] },
    steps: state === 'verified' ? steps(['done', row.createdAt], ['done', null], ['done', null], ['not-reached', null], ['done', null]) : steps(['done', row.createdAt], [state === 'prepared' && lesson.review ? 'waiting-for-you' : 'not-reached', null]),
    prepareOnly: false, needsSecondAsk: false, ...(state === 'prepared' && !lesson.review ? { blocked: { kind: 'prepare-blocked' as const, code: 'LESSON_REVIEW_PENDING' } } : {}),
  }, { change: false, approve: lesson.review !== undefined });
}

/**
 * A bill read from a photo (WK-13): a Zoho Books booking prepared through writeback waits as a
 * tier-1 change bound to the writeback digest; without a connection it is a prepare-only Tally
 * purchase voucher. Built from the stored prepared bill, never from the text on the photo alone.
 */
export function billDetail(e: Env, bill: StoredBill): ApprovalDetail {
  const zoho = bill.route === 'zoho-books' && bill.writeback !== null; const name = memberName(e.state, bill.memberId) ?? bill.by;
  // A Zoho booking's state and digest are write-back's, read live from the caller's write-back record when it is there.
  const live = liveBill(e, bill);
  const row: ApprovalRow = {
    id: `bill:${bill.id}`, source: 'bill', kind: zoho ? 'record-change' : 'prepare-only', tier: zoho ? 'tier-1' : 'prepare-only',
    title: zoho ? `Book a bill read from a photo: ${bill.supplier}` : `Purchase voucher from a bill photo: ${bill.supplier}`, what: { kind: zoho ? 'bill-zoho' : 'bill-tally', name: bill.supplier }, touches: `${zoho ? 'Zoho Books' : 'Tally'}: ${bill.supplier}`,
    amount: minorAmount(bill.totalMinor), preparedBy: { kind: 'person', name }, createdAt: bill.createdAt,
    expiresAt: zoho ? isoAt(Date.parse(bill.createdAt) + 7 * DAY) : null, state: live.state, practice: false,
  };
  const fields = [{ name: 'Supplier', before: '', after: bill.supplier }, { name: 'Bill number', before: '', after: bill.billNumber }, { name: 'Date', before: '', after: bill.date },
    ...bill.lines.map((l, i) => ({ name: `Line ${i + 1}`, before: '', after: `${l.description} × ${l.quantity}: ${l.amountMinor} paise` })),
    ...bill.tax.map(t => ({ name: t.name, before: '', after: `${t.amountMinor} paise` })), { name: 'Total', before: '', after: `${bill.totalMinor} paise` }];
  const voucher = !zoho && bill.voucher ? { type: bill.voucher.type, number: bill.voucher.number, date: bill.voucher.date, note: 'prepare-only' as const,
    lines: bill.voucher.lines.map(l => ({ ledger: l.ledger, debit: minorAmount(l.debitMinor), credit: minorAmount(l.creditMinor) })) } : undefined;
  const waiting = row.state === 'prepared';
  return finish(e, row, {
    digest: live.digest, revision: live.revision, reason: 'autonomy-off', change: { fields }, ...(voucher ? { voucher } : {}),
    steps: steps(['done', bill.createdAt], [waiting ? (zoho && !expired(e, row) ? 'waiting-for-you' : zoho ? 'stopped-by-rule' : 'not-reached') : row.state === 'cancelled' ? 'not-reached' : 'done', null],
      ...(['verified', 'unknown', 'rejected'].includes(row.state) ? [[row.state === 'unknown' ? 'unsure' : 'done', null] as [StepState, null]] : [])),
    prepareOnly: !zoho, needsSecondAsk: false,
  }, { change: false, approve: zoho });
}

/** The bill's state and digest: from the write-back view behind a Zoho booking when the caller's record has it, else as stored. */
function liveBill(e: Env, bill: StoredBill): { state: RowState; digest: string; revision: number } {
  const view = bill.route === 'zoho-books' && bill.writeback ? e.wb.views.find(v => v.id === bill.writeback!.id) : undefined;
  return view ? { state: view.status, digest: view.digest, revision: view.revision } : { state: bill.state, digest: bill.digest, revision: 1 };
}
/** Stored bills the caller may see (books-bill.ts `billVisible`), with write-back view access standing in for a Zoho booking. */
export function visibleBills(e: Env): StoredBill[] {
  const ids = new Set(e.wb.views.map(v => v.id));
  return storedBills(e.state).filter(b => billVisible(e.state, e.ctx, b, ids));
}
/** Write-back views that back a stored bill: the `bill:` item is the one to act on, so the view is not listed twice. */
function billBacked(e: Env): Set<string> {
  return new Set(storedBills(e.state).map(b => b.writeback?.id).filter((id): id is string => typeof id === 'string'));
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
  const backed = billBacked(e);
  for (const view of e.wb.views) if (view.status === 'prepared' && !backed.has(view.id)) items.push(wbDetail(e, view));
  for (const bill of visibleBills(e)) if (liveBill(e, bill).state === 'prepared') items.push(billDetail(e, bill));
  for (const proposal of e.proposals ?? []) items.push(proposalDetail(e, proposal));
  return items;
}
export const order = (a: ApprovalRow, b: ApprovalRow) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function rowOf(detail: ApprovalDetail): ApprovalRow {
  const { id, source, kind, tier, title, touches, amount, preparedBy, createdAt, expiresAt, state, practice, what } = detail;
  return { id, source, kind, tier, title, touches, amount, preparedBy, createdAt, expiresAt, state, practice, ...(what ? { what } : {}) };
}
export function snoozed(e: Env, id: string) { return snoozedUntil(e, id) !== undefined; }

/** Resolves any typed id the caller may see, waiting or not. */
export function detail(e: Env, id: string): ApprovalDetail {
  const { source, raw } = parseId(id);
  if (source === 'action') { const action = visibleActions(e).find(a => a.id === raw); check(action, 'NOT_FOUND', 'Approval not found.'); return actionDetail(e, action); }
  if (source === 'job' || source === 'acceptance') { const job = visibleJobs(e).find(j => j.id === raw); check(job, 'NOT_FOUND', 'Approval not found.'); return jobDetail(e, job, source === 'acceptance'); }
  if (source === 'writeback') return wbDetail(e, findView(e, raw));
  if (source === 'release') { const draft = drafts(e.state).find(d => d.id === raw); check(draft, 'NOT_FOUND', 'Approval not found.'); return releaseDetail(e, draft); }
  if (source === 'proposal') { const proposal = (e.proposals ?? []).find(p => p.id === raw); check(proposal, 'NOT_FOUND', 'Approval not found.'); return proposalDetail(e, proposal); }
  if (source === 'bill') { const bill = visibleBills(e).find(b => b.id === raw); check(bill, 'NOT_FOUND', 'Approval not found.'); return billDetail(e, bill); }
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
    wouldHaveDone: actionTier(e, action) === 'tier-1' && e.state.policy.autonomy ? 'done' : 'waited',
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
