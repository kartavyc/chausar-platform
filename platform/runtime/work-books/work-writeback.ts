/**
 * Work over write-back (WK-01..WK-06, WK-12, WK-15). Write-back actions live in their own
 * ActionService registry (`writeback.*`), so the core `actions.list` never shows them. This file
 * reads them through `writeback.ledger` / `writeback.get` as the same caller and turns each view
 * into the one queue's `ApprovalDetail` and the one record's `ActionView`, with typed ids
 * `writeback:<actionId>`. Every mutation goes through a `writeback.*` method; nothing here writes
 * another lane's state.
 *
 * The reminder notes (WK-12) are a small fixed list of payment rules with their sources and the
 * date they were checked. They are written here by hand, never by a model, and are shown to the
 * owner only, each marked "not legal advice".
 */
import { check } from '../contracts.ts';
import type { State } from '../contracts.ts';
import type { PreparedAction } from '../actions.ts';
import type { ModuleHost } from '../modules/types.ts';
import { optionalCall } from './adapters.ts';
import type { Amount, ApprovalDetail, ApprovalRow, ActionView, CatalogueEntry, CatalogueKind, CatalogueRow, Env, Step, StepState } from './work-queue.ts';
import { finish, flatten, isoAt, isReadOnly, steps, expired } from './work-queue.ts';

const record = (value: unknown): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = 400): value is string => typeof value === 'string' && value.length > 0 && value.length <= max;
const INTEGER = /^(0|-?[1-9]\d*)$/;
const minor = (value: unknown): Amount | null => typeof value === 'string' && INTEGER.test(value) ? { minor: value } : null;
const STATUSES = ['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'] as const;
const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'] as const;
export const FOLLOW_UP = 'invoice-follow-up';

export const SYSTEM_TITLES: Readonly<Record<string, string>> = {
  tally: 'Tally', 'zoho-books': 'Zoho Books', razorpay: 'Razorpay', shopify: 'Shopify', 'google-workspace': 'Google Workspace',
  whatsapp: 'WhatsApp Business', mail: 'Your own mail server', 'gst-portal': 'GST portal',
};
export const systemTitle = (system: string) => SYSTEM_TITLES[system] ?? system;

/** One write-back view as `writeback.ledger` / `writeback.get` give it, checked field by field. */
export type WbView = {
  id: string; system: string; action: string; title: string; digest: string; revision: number; status: typeof STATUSES[number];
  connection: { id: string; label: string; environment: string; removed: boolean } | null; practice: boolean;
  kind: CatalogueKind; tier: 1 | 2 | 'prepare-only'; alwaysWaits: boolean; expiresAt: string | null;
  target: { label: string; ref: string | null };
  steps: { name: string; state: string; turn: string; at: string | null }[];
  readBack: { outcome: string | null; reason: string | null; comparison: { name: string; expected: unknown; observed: unknown; match: boolean }[] | null; settledBy: 'person' | 'system' | null } | null;
  businessSuccess: boolean | null; externalId: string | null; notices: { kind: string; at: string }[];
  approval: { kind: string; waitsBecause: string; change: { asWritten?: string; fields?: { name: string; before: string; after: string }[] }; needsSecondAsk: boolean; can: string[]; preparedBy: { kind: 'job' | 'person'; name: string }; reauth: 'passphrase' | null };
};

export function parseView(value: unknown): WbView | null {
  if (!record(value) || !text(value.id, 200) || !text(value.system, 80) || !text(value.action, 80) || !text(value.title) || !text(value.digest, 200)
    || !Number.isSafeInteger(value.revision) || !STATUSES.includes(value.status) || !record(value.approval) || !Array.isArray(value.steps)) return null;
  const a = value.approval;
  const kind: CatalogueKind | null = ['inside-undoable', 'seen-outside', 'money', 'cannot-undo'].includes(value.kind) ? value.kind : null;
  const tier = value.tier === 1 || value.tier === 2 || value.tier === 'prepare-only' ? value.tier : null;
  if (!kind || tier === null) return null;
  const change: WbView['approval']['change'] = {};
  if (record(a.change) && typeof a.change.asWritten === 'string') change.asWritten = a.change.asWritten.slice(0, 4000);
  if (record(a.change) && Array.isArray(a.change.fields)) change.fields = a.change.fields.filter(record).slice(0, 200).map((f: any) => ({ name: String(f.name ?? '').slice(0, 400), before: String(f.before ?? '').slice(0, 4000), after: String(f.after ?? '').slice(0, 4000) }));
  const rb = record(value.readBack) ? value.readBack : null;
  return {
    id: value.id, system: value.system, action: value.action, title: value.title, digest: value.digest, revision: value.revision, status: value.status,
    connection: record(value.connection) && text(value.connection.id, 200) ? { id: value.connection.id, label: String(value.connection.label ?? ''), environment: String(value.connection.environment ?? ''), removed: value.connection.removed === true } : null,
    practice: value.practice === true, kind, tier, alwaysWaits: value.alwaysWaits === true, expiresAt: typeof value.expiresAt === 'string' ? value.expiresAt : null,
    target: record(value.target) && typeof value.target.label === 'string' ? { label: value.target.label.slice(0, 400), ref: typeof value.target.ref === 'string' ? value.target.ref : null } : { label: '', ref: null },
    steps: value.steps.filter(record).map((s: any) => ({ name: String(s.name), state: String(s.state), turn: String(s.turn), at: typeof s.at === 'string' ? s.at : null })),
    readBack: rb ? { outcome: typeof rb.outcome === 'string' ? rb.outcome : null, reason: typeof rb.reason === 'string' ? rb.reason : null,
      comparison: Array.isArray(rb.comparison) ? rb.comparison.filter(record).map((c: any) => ({ name: String(c.name), expected: c.expected, observed: c.observed, match: c.match === true })) : null,
      settledBy: rb.settledBy === 'person' || rb.settledBy === 'system' ? rb.settledBy : null } : null,
    businessSuccess: typeof value.businessSuccess === 'boolean' ? value.businessSuccess : null, externalId: typeof value.externalId === 'string' ? value.externalId : null,
    notices: Array.isArray(value.notices) ? value.notices.filter(record).map((n: any) => ({ kind: String(n.kind), at: String(n.at) })) : [],
    approval: {
      kind: String(a.kind), waitsBecause: record(a.waitsBecause) && typeof a.waitsBecause.text === 'string' ? a.waitsBecause.text.slice(0, 400) : '', change,
      needsSecondAsk: a.needsSecondAsk === true, can: Array.isArray(a.can) ? a.can.filter((c: unknown) => typeof c === 'string') : [],
      preparedBy: record(a.preparedBy) && a.preparedBy.kind === 'job' ? { kind: 'job', name: String(a.preparedBy.name ?? '') } : { kind: 'person', name: record(a.preparedBy) ? String(a.preparedBy.name ?? '') : '' },
      // Re-authentication is passed through only when write-back declares it on the view.
      reauth: a.reauth === 'passphrase' || (record(a.reauth) && a.reauth.kind === 'passphrase') ? 'passphrase' : null,
    },
  };
}

export type WbEnv = { available: boolean; views: WbView[] };
/** The caller's write-back record, newest first, or `{ available: false }` when the lane is absent. */
export async function loadWriteback(host: ModuleHost): Promise<WbEnv> {
  const reply = await optionalCall<unknown>(host, 'writeback.ledger', { limit: 1000 });
  if (!reply.available) return { available: false, views: [] };
  return { available: true, views: (Array.isArray(reply.value) ? reply.value : []).map(parseView).filter((v): v is WbView => v !== null) };
}
export const findView = (e: Env, raw: string) => { const view = e.wb.views.find(v => v.id === raw); check(view, 'NOT_FOUND', 'Approval not found.'); return view; };
/** The stored action for a view the caller may see (the view came from the caller's own ledger). */
const stored = (state: State, id: string) => (state.actions as PreparedAction[]).find(a => a.id === id && a.connector?.startsWith('wb-'));
const envelope = (state: State, id: string): Record<string, any> => { const p = stored(state, id)?.payload; return record(p) ? p : {}; };
const memberName = (state: State, id: string | undefined) => state.members.find(m => m.id === id)?.name ?? null;

const TIER = { 1: 'tier-1', 2: 'tier-2', 'prepare-only': 'prepare-only' } as const;
function kindOf(view: WbView): ApprovalRow['kind'] {
  if (view.tier === 'prepare-only') return 'prepare-only';
  return view.kind === 'money' ? 'money' : view.kind === 'seen-outside' ? 'message' : 'record-change';
}
function reasonOf(view: WbView): string {
  if (view.kind === 'money') return 'always-waits:money';
  if (view.kind === 'seen-outside') return 'always-waits:message';
  if (view.kind === 'cannot-undo') return 'always-waits:irreversible';
  return view.alwaysWaits ? 'always-waits:irreversible' : 'autonomy-off';
}
function amountOf(state: State, view: WbView): Amount | null {
  const e = envelope(state, view.id); const p = record(e.payload) ? e.payload : {};
  const found = minor(p.amountMinor) ?? minor(p.priceMinor) ?? (record(e.evidence) && record(e.evidence.detail) ? minor(e.evidence.detail.outstandingMinor) : null);
  return found ?? (view.kind === 'money' ? { missing: 'unknown' } : null);
}
const createdOf = (state: State, view: WbView) => stored(state, view.id)?.createdAt ?? view.steps[0]?.at ?? isoAt(0);

export function wbRow(e: Env, view: WbView): ApprovalRow {
  const by = view.approval.preparedBy;
  const name = by.kind === 'job' ? 'Invoice follow-up' : memberName(e.state, by.name) ?? (by.name || null);
  return {
    id: `writeback:${view.id}`, source: 'writeback', kind: kindOf(view), tier: TIER[view.tier], title: view.title,
    touches: view.target.label ? `${systemTitle(view.system)}: ${view.target.label}` : systemTitle(view.system), amount: amountOf(e.state, view),
    preparedBy: name === null ? null : { kind: by.kind, name }, createdAt: createdOf(e.state, view), expiresAt: view.expiresAt, state: view.status, practice: view.practice,
  };
}

/** The five write-back steps in the queue's words. */
function stepsOf(view: WbView, isExpired: boolean): Step[] {
  const map = (name: string, state: string): StepState => {
    if (state === 'done') return 'done';
    if (state === 'unknown') return 'unsure';
    if (state === 'skipped') return 'stopped-by-rule';
    if (state === 'current') return name === 'approved' ? (isExpired ? 'stopped-by-rule' : 'waiting-for-you') : 'waiting-for-network';
    if (name === 'done' && view.status === 'approved') return 'waiting-for-you';
    return 'not-reached';
  };
  return NAMES.map(name => { const s = view.steps.find(x => x.name === name); return { name, state: s ? map(name, s.state) : 'not-reached', at: s?.at ?? null }; });
}

/** A mail body can be rewritten from the sheet; everything else is changed by preparing it again. */
export function changeable(e: Env, view: WbView) {
  const env0 = envelope(e.state, view.id);
  return view.system === 'mail' && view.action === 'smtp.send' && !env0.evidence && view.approval.can.includes('change');
}
/** `{ asWritten }` from the sheet becomes the mail body; any other payload goes to write-back as it is. */
export function changedPayload(e: Env, view: WbView, payload: Record<string, unknown>) {
  if (Object.keys(payload).length === 1 && typeof payload.asWritten === 'string') {
    check(changeable(e, view), 'CHANGE_NOT_AVAILABLE', 'This item cannot be changed here. Prepare it again.');
    return { ...envelope(e.state, view.id).payload, body: payload.asWritten };
  }
  return payload;
}

export type WbExtra = {
  system: string; action: string; systemTitle: string; catalogueKind: CatalogueKind; waitsBecause: string;
  connection: { label: string; environment: string; removed: boolean } | null;
  notices: { kind: string; at: string }[]; externalId: string | null; settledBy: 'person' | 'system' | null;
};
const extraOf = (view: WbView): WbExtra => ({
  system: view.system, action: view.action, systemTitle: systemTitle(view.system), catalogueKind: view.kind, waitsBecause: view.approval.waitsBecause,
  connection: view.connection ? { label: view.connection.label, environment: view.connection.environment, removed: view.connection.removed } : null,
  notices: view.notices.slice(-20), externalId: view.externalId, settledBy: view.readBack?.settledBy ?? null,
});

export function wbDetail(e: Env, view: WbView, reminder?: Reminder): ApprovalDetail {
  const row = wbRow(e, view); const prepareOnly = view.tier === 'prepare-only';
  const last = view.notices.at(-1);
  const reminderBlocked = reminder?.blocked && view.status === 'prepared' ? reminder.blocked : null;
  const blocked: ApprovalDetail['blocked'] | undefined = view.status === 'unknown' ? { kind: 'unsure', code: 'OUTCOME_UNKNOWN' }
    : view.status === 'cancelled' && last?.kind === 'cancelled-evidence' ? { kind: 'prepare-blocked', code: 'EVIDENCE_CHANGED' }
    : reminderBlocked ? { kind: 'prepare-blocked', code: reminderBlocked.code }
    : view.status === 'prepared' && (last?.kind === 'prepared-again' || view.revision > 1) ? { kind: 'changed', code: 'PREPARED_AGAIN' } : undefined;
  const detail = finish(e, row, {
    digest: view.digest, revision: view.revision, reason: reasonOf(view), change: { ...view.approval.change },
    steps: stepsOf(view, expired(e, row)), prepareOnly, needsSecondAsk: view.approval.needsSecondAsk, ...(blocked ? { blocked } : {}),
  }, { change: changeable(e, view), approve: view.approval.can.includes('approve') && !reminderBlocked });
  const out: ApprovalDetail = { ...detail, writeback: extraOf(view) };
  if (view.approval.needsSecondAsk) out.secondAsk = { by: view.approval.reauth === 'passphrase' ? 'passphrase' : 'typed-amount' };
  if (reminder) out.reminder = reminder;
  return out;
}

export function wbActionView(e: Env, view: WbView): ActionView {
  const row = wbRow(e, view); const action = stored(e.state, view.id); const env0 = envelope(e.state, view.id);
  const show = (v: unknown) => v === null || v === undefined ? null : typeof v === 'string' ? v : JSON.stringify(v);
  const readBack = view.readBack?.comparison ? view.readBack.comparison.map(c => ({ field: c.name, asked: show(c.expected) ?? '', found: show(c.observed), same: c.match })) : null;
  const unknown = view.status === 'unknown'; const approver = !isReadOnly(e);
  const att = attestation(e.state, view.id);
  const finished = view.steps.find(s => s.name === 'recorded')?.at ?? view.steps.find(s => s.name === 'read-back')?.at ?? null;
  return {
    id: row.id, system: view.system, action: view.action, title: view.title, touches: row.touches, amount: row.amount, state: view.status,
    steps: stepsOf(view, expired(e, row)), approvedBy: action?.approval ? memberName(e.state, action.approval.memberId) ?? action.approval.memberId : null,
    channel: e.work.channels[view.id] ?? null, request: flatten(record(env0.payload) ? env0.payload : {}), readBack, rule: reasonOf(view), attestation: att,
    wouldHaveDone: view.tier === 1 && e.state.policy.autonomy ? 'done' : 'waited', createdAt: row.createdAt,
    settledAt: ['verified', 'rejected', 'unknown'].includes(view.status) ? finished : null,
    can: e.ctx.role === 'viewer' ? [] : [...(view.status === 'approved' ? ['execute' as const] : []), ...(unknown ? ['reconcile' as const] : []), ...(unknown && approver ? ['resolve' as const] : [])],
    writeback: extraOf(view),
  };
}
/** A person's word ("It was sent" / "It was not sent"), from write-back's record of who said it. */
function attestation(state: State, id: string): ActionView['attestation'] {
  const wb = state.extensions?.writeback as { attestations?: { actionId: string; memberId: string; said: string; at: string }[] } | undefined;
  const last = (Array.isArray(wb?.attestations) ? wb.attestations : []).filter(a => a?.actionId === id).at(-1);
  if (!last || !['sent', 'not-sent'].includes(last.said)) return null;
  return { by: memberName(state, last.memberId) ?? last.memberId, said: last.said === 'sent' ? 'was-sent' : 'was-not-sent', at: last.at };
}

/** `writeback.practice` on a prepared action, in the queue's practice shape. Nothing is sent. */
export function practiceReply(value: unknown) {
  check(record(value) && Array.isArray(value.steps) && value.steps.length >= 1 && value.sent === 0, 'INVALID_PRACTICE_RESULT', 'The practice run did not return its steps.');
  const first = value.steps[0]; check(record(first) && typeof first.outcome === 'string', 'INVALID_PRACTICE_RESULT', 'The practice run did not return its steps.');
  const outcome = first.outcome as string;
  const by: Record<string, [StepState, StepState, StepState, StepState, StepState]> = {
    'would-be-done': ['done', 'done', 'done', 'done', 'done'],
    'would-be-not-sure': ['done', 'done', 'unsure', 'unsure', 'not-reached'],
    'would-not-happen': ['done', 'done', 'stopped-by-rule', 'done', 'not-reached'],
    'already-done': ['done', 'not-reached', 'not-reached', 'done', 'not-reached'],
    'prepare-only': ['done', 'not-reached', 'not-reached', 'not-reached', 'not-reached'],
  };
  const states = by[outcome] ?? ['done', 'stopped-by-rule', 'not-reached', 'not-reached', 'not-reached'];
  const preview = record(first.preview) ? first.preview : null;
  const wouldSend = preview && typeof preview.asWritten === 'string' ? preview.asWritten.slice(0, 4000)
    : preview && Array.isArray(preview.fields) ? preview.fields.filter(record).map((f: any) => `${f.name}: ${f.before} → ${f.after}`).join('\n').slice(0, 4000) : null;
  return {
    practice: true as const, available: true, steps: steps(...states.map(s => [s, null] as [StepState, null])), wouldSend,
    outcome, requests: Array.isArray(first.requests) ? first.requests.length : 0, ...(typeof first.code === 'string' ? { code: first.code } : {}),
  };
}

// ---------- Catalogue (the real writeback.catalogue row) ----------

const hours = (n: number) => n % 24 === 0 ? `${n / 24} day${n === 24 ? '' : 's'}` : `${n} hour${n === 1 ? '' : 's'}`;
export type WbCatalogueEntry = CatalogueEntry & { reversal: string | null; undo: string | null };
/** One `writeback.catalogue` row as the catalogue screen draws it, or null when a written field is missing. */
export function catalogueFromWriteback(row: unknown): WbCatalogueEntry | null {
  if (!record(row) || !text(row.system, 80) || !text(row.action, 80) || !text(row.title) || !['live', 'experimental', 'prepare-only', 'not-yet'].includes(row.status)
    || !['inside-undoable', 'seen-outside', 'money', 'cannot-undo'].includes(row.kind) || !(row.tier === 1 || row.tier === 2 || row.tier === 'prepare-only')
    || !text(row.idempotency, 2000) || !text(row.readBack, 2000)) return null;
  const connections = Array.isArray(row.connections) ? row.connections.filter(record).filter((c: any) => text(c.id, 200)).slice(0, 50).map((c: any) => ({ id: String(c.id), label: String(c.label ?? '').slice(0, 100), environment: ['live', 'sandbox', 'practice'].includes(c.environment) ? c.environment as 'live' | 'sandbox' | 'practice' : 'live', read: c.read === true, write: c.write === true })) : [];
  const qualification = ['synthetic-tested', 'sandbox-verified', 'live-verified', 'unqualified'].includes(row.qualification) ? row.qualification as CatalogueRow['qualification'] : null;
  return {
    system: row.system, systemTitle: systemTitle(row.system), action: row.action, title: row.title, kind: row.kind, waits: row.alwaysWaits === true || row.kind !== 'inside-undoable',
    status: row.status, source: 'writeback', qualification, writeScore: typeof row.writeScore === 'string' ? row.writeScore.slice(0, 20) : null,
    description: text(row.waitsBecause, 2000) ? row.waitsBecause : '', idempotency: row.idempotency, readBack: row.readBack,
    retryWindow: Number.isSafeInteger(row.retryWindowHours) && row.retryWindowHours > 0 ? hours(row.retryWindowHours) : null,
    tier: row.tier === 1 ? 'tier-1' : 'tier-2', expires: typeof row.expiresOn === 'string' && /^\d{4}-\d\d-\d\d$/.test(row.expiresOn) ? row.expiresOn : null, readStatus: null,
    waitsBecause: text(row.waitsBecause, 2000) ? row.waitsBecause : null, plannedStatus: ['live', 'experimental', 'prepare-only', 'not-yet'].includes(row.plannedStatus) ? row.plannedStatus : null,
    businessReference: text(row.businessReference, 2000) ? row.businessReference : null,
    approvalLifetime: Number.isSafeInteger(row.approvalLifetimeHours) && row.approvalLifetimeHours > 0 ? hours(row.approvalLifetimeHours) : null,
    reviewedOn: typeof row.reviewedOn === 'string' && /^\d{4}-\d\d-\d\d$/.test(row.reviewedOn) ? row.reviewedOn : null,
    installed: row.installed === true, connections, grants: connections.filter(c => c.write).length,
    // The real catalogue states a reversal in words; it is shown, and is an action only when it names one.
    reversal: typeof row.reversal === 'string' && /^[a-z][A-Za-z0-9.-]{0,79}$/.test(row.reversal) ? row.reversal : null, undo: text(row.reversal, 2000) ? row.reversal : null,
  };
}

// ---------- WK-12: reminders to customers ----------

/** Payment rules shown to the owner under a reminder. Fixed text, each with its source and the day it was checked. */
export const PAYMENT_NOTES = Object.freeze([
  Object.freeze({
    id: 'msmed-45-days',
    text: Object.freeze({
      en: 'A buyer must pay a micro or small enterprise supplier within the agreed time, and never later than 45 days after accepting the goods or services. Paid late, the buyer owes compound interest at three times the bank rate notified by the Reserve Bank of India.',
      hi: 'खरीदार को सूक्ष्म या लघु उद्यम आपूर्तिकर्ता को तय समय में, और माल या सेवा स्वीकार करने के 45 दिन के भीतर, भुगतान करना होता है। देर से भुगतान पर भारतीय रिज़र्व बैंक की अधिसूचित बैंक दर के तीन गुना पर चक्रवृद्धि ब्याज देना होता है।',
    }),
    source: 'Micro, Small and Medium Enterprises Development Act, 2006, sections 15 and 16',
    checkedOn: '2026-10-14',
  }),
  Object.freeze({
    id: 'it-43b-h',
    text: Object.freeze({
      en: 'A buyer may deduct an amount owed to a micro or small enterprise only in the year it is actually paid, when it is paid later than the time allowed by the MSMED Act.',
      hi: 'सूक्ष्म या लघु उद्यम को देय रकम, अगर MSMED अधिनियम की समय-सीमा के बाद चुकाई जाए, तो खरीदार उसे केवल उसी वर्ष घटा सकता है जिसमें वह वास्तव में चुकाई गई।',
    }),
    source: 'Income-tax Act, 1961, section 43B(h), inserted by the Finance Act, 2023',
    checkedOn: '2026-10-14',
  }),
]);
export type PaymentNote = { id: string; text: { en: string; hi: string }; source: string; checkedOn: string; notLegalAdvice: true };
export type Reminder = {
  customerId: string | null; invoiceId: string | null; channel: 'email' | 'whatsapp' | null;
  asWritten: string | null; invoiceLink: string | null; outstanding: Amount | null;
  /** For the owner only: null for every other seat. */
  notes: PaymentNote[] | null;
  agreement: { channel: 'email' | 'whatsapp'; answer: 'yes' | 'no' | 'not-asked'; source: string | null; on: string | null }[];
  stoppedOn: string | null;
  caps: { perCustomer: number; perDay: number; day: string | null; preparedOnDay: number; customerOnDay: number; reached: boolean; customerReached: boolean } | null;
  blocked: { code: string; reason: string } | null;
};
const LINK = /https:\/\/[^\s<>"']{1,500}/;
const isReminderView = (state: State, view: WbView) => {
  const e = envelope(state, view.id);
  return (record(e.evidence) && e.evidence.kind === FOLLOW_UP) || (view.system === 'zoho-books' && view.action === 'invoice.paymentReminder');
};
/** The reminder facts for one write-back reminder, read from write-back's own consents and limits. */
export async function reminderOf(e: Env, view: WbView): Promise<Reminder | undefined> {
  if (!isReminderView(e.state, view)) return undefined;
  const env0 = envelope(e.state, view.id); const detail = record(env0.evidence) && record(env0.evidence.detail) ? env0.evidence.detail : {};
  const customerId = text(detail.customerId, 100) ? detail.customerId : null;
  const channel = detail.channel === 'email' || detail.channel === 'whatsapp' ? detail.channel : view.system === 'mail' ? 'email' : view.system === 'whatsapp' ? 'whatsapp' : null;
  const asWritten = view.approval.change.asWritten ?? null;
  const consents = customerId ? await optionalCall<unknown>(e.host, 'writeback.followUp.consents', {}) : { available: false as const };
  const settings = await optionalCall<unknown>(e.host, 'writeback.settings', {});
  const mine = consents.available && Array.isArray(consents.value) ? consents.value.filter(record).filter((c: any) => c.customerId === customerId) : [];
  const latest = (ch: 'email' | 'whatsapp') => mine.filter((c: any) => c.channel === ch).at(-1) as Record<string, any> | undefined;
  const agreement = (['email', 'whatsapp'] as const).map(ch => {
    const c = latest(ch);
    if (!c) return { channel: ch, answer: 'not-asked' as const, source: null, on: null };
    const recorder = memberName(e.state, c.recordedBy);
    return { channel: ch, answer: c.answer === 'yes' ? 'yes' as const : c.answer === 'not-asked' ? 'not-asked' as const : 'no' as const,
      source: text(c.sourceId, 100) ? c.sourceId : recorder ? `Told by ${recorder}` : null, on: typeof c.observedOn === 'string' ? c.observedOn : null };
  });
  const lastStop = mine.filter((c: any) => c.answer === 'stopped').at(-1) as Record<string, any> | undefined;
  const current = channel ? latest(channel) : undefined;
  const stoppedOn = current?.answer === 'stopped' ? String(current.observedOn) : lastStop && !mine.some((c: any) => c.answer === 'yes' && c.at > lastStop.at) ? String(lastStop.observedOn) : null;
  let caps: Reminder['caps'] = null;
  if (settings.available && record(settings.value) && Number.isSafeInteger(settings.value.reminderCapPerDay) && Number.isSafeInteger(settings.value.reminderCapPerCustomer)) {
    const day = typeof detail.day === 'string' ? detail.day : null;
    const live = (e.state.actions as PreparedAction[]).filter(a => a.connector?.startsWith('wb-') && !['cancelled', 'rejected'].includes(a.status)
      && record(a.payload) && record((a.payload as any).evidence) && (a.payload as any).evidence.kind === FOLLOW_UP && (a.payload as any).evidence.detail?.day === day);
    const preparedOnDay = day ? live.length : 0, customerOnDay = day ? live.filter(a => (a.payload as any).evidence.detail.customerId === customerId).length : 0;
    const perDay = settings.value.reminderCapPerDay as number, perCustomer = settings.value.reminderCapPerCustomer as number;
    caps = { perCustomer, perDay, day, preparedOnDay, customerOnDay, reached: preparedOnDay >= perDay, customerReached: customerOnDay >= perCustomer };
  }
  const blocked = customerId && channel && current?.answer === 'stopped' ? { code: 'FOLLOW_UP_STOPPED', reason: 'No reminder: this customer asked to stop.' }
    : customerId && channel && current?.answer !== 'yes' ? { code: 'FOLLOW_UP_NO_CONSENT', reason: 'No reminder: this customer has not agreed to reminders.' } : null;
  return {
    customerId, invoiceId: text(detail.invoiceId, 100) ? detail.invoiceId : null, channel, asWritten, invoiceLink: asWritten ? LINK.exec(asWritten)?.[0] ?? null : null,
    outstanding: minor(detail.outstandingMinor),
    notes: e.ctx.role === 'owner' ? PAYMENT_NOTES.map(n => ({ id: n.id, text: { en: n.text.en, hi: n.text.hi }, source: n.source, checkedOn: n.checkedOn, notLegalAdvice: true as const })) : null,
    agreement, stoppedOn, caps, blocked,
  };
}

/** Write-back refusals that mean "blocked at prepare", with their plain reason. */
export const REMINDER_BLOCKS: Readonly<Record<string, string>> = {
  FOLLOW_UP_NO_CONSENT: 'No reminder: this customer has not agreed to reminders.',
  FOLLOW_UP_STOPPED: 'No reminder: this customer asked to stop.',
  FOLLOW_UP_DAILY_CAP: 'The reminder limit for today is reached. The rest wait until tomorrow.',
  FOLLOW_UP_NOTHING_DUE: 'Nothing is due on this invoice.',
  FOLLOW_UP_NEEDS_REVIEW: 'This invoice is disputed or its records are incomplete. Look at it first.',
};
