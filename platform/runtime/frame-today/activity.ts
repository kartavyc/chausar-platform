/**
 * `todayx.activity`: the workspace record as typed events, newest first. Each audit record and
 * each model request becomes one event with a stable `type` code and plain values (ids, codes,
 * digits). Free text in a record (a reason, an endpoint, a question) never reaches a value.
 */
import { check, authorize, type Context, type State, type StateStore } from '../contracts.ts';
import { sourceAllowed } from '../trust.ts';
import { canSeeFact } from '../memory.ts';

export type ActivityState = 'done' | 'waiting-for-you' | 'waiting-for-network' | 'unsure' | 'stopped-by-rule';
export const ACTIVITY_STATES: readonly ActivityState[] = ['done', 'waiting-for-you', 'waiting-for-network', 'unsure', 'stopped-by-rule'];
export type ActorKind = 'chausar' | 'you' | 'person' | 'job';
export type ActivityEvent = {
  id: string; at: string; type: string; state: ActivityState; actor: { kind: ActorKind; name: string | null };
  values: Record<string, string>; costPaise: string | null; route: string | null; tainted: boolean;
  proof: { kind: 'receipt' | 'action' | 'model-request' | 'none'; id: string | null };
  /** The page that opens for an action or a model request, as a place hash. */
  opens?: string;
};
export const PAGE_SIZE = 50;

/**
 * Audit event → the type codes the screen has sentences for (format/sentences.ts). Unlisted
 * events keep their own dotted code when it is safe; the screen gives those a fallback sentence.
 */
const TYPES: Record<string, string> = {
  'source.imported': 'import.done', 'connector.capture-published': 'source.read', 'connector.page-captured': 'source.read',
  'source.import-refused': 'source.refused', 'calculation.completed': 'answer.receipt',
  'action.prepared': 'action.prepared', 'action.approved': 'action.approved', 'action.settled': 'action.done', 'action.reconciled': 'action.read-back',
  'action.interrupted': 'action.unknown', 'action.deleted-while-executing': 'action.unknown',
  'job.step-dispatched': 'job.step', 'job.step-settled': 'job.step', 'job.step-unknown': 'job.step', 'job.cancelled': 'job.stopped',
  'dictionary.published': 'dictionary.published', 'trust.member.created': 'member.joined', 'auth.invitation.accepted': 'member.joined',
};
/** Model dispatch audits duplicate the model receipts, which carry route and cost. */
const SKIPPED = new Set(['model.dispatch.prepared', 'model.dispatch.completed']);
const STATES: Record<string, ActivityState> = {
  'source.import-refused': 'stopped-by-rule', 'plugin.refused': 'stopped-by-rule', 'action.prepared': 'waiting-for-you',
  'action.interrupted': 'unsure', 'action.deleted-while-executing': 'unsure', 'job.step-unknown': 'unsure', 'job.interrupted': 'unsure',
};
/** Record detail keys → the value keys the sentences use. Other keys never reach a value. */
const VALUE_KEYS: Record<string, string> = {
  sourceId: 'source', rowCount: 'rows', routeId: 'route', actionId: 'action', connector: 'system', jobId: 'job', version: 'version',
  lessonId: 'lesson', receiptId: 'receipt', importId: 'import', operation: 'operation', outcome: 'outcome', status: 'status', reasonCode: 'reason', pack: 'pack',
};
const SAFE_VALUE = /^(?:[A-Za-z][A-Za-z0-9]*_[0-9a-f-]{8,64}|[A-Z][A-Z0-9_]{1,63}|[a-z][a-z0-9-]{0,40}|-?(?:0|[1-9][0-9]{0,30}))$/;
const SAFE_TYPE = /^[a-z][a-z0-9.-]{0,63}$/;

function values(details: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(details)) {
    const name = Object.hasOwn(VALUE_KEYS, key) ? VALUE_KEYS[key]! : null;
    if (name === null) continue;
    const text = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : typeof value === 'string' ? value : null;
    if (text !== null && text.length <= 80 && SAFE_VALUE.test(text)) out[name] = text;
  }
  return out;
}

/** The same visibility rule as `activity.list`: owners with every branch see everything, others their own records. */
export function visibleAudit(store: StateStore, ctx: Context, state: State = store.read()) {
  const member = authorize(store, ctx);
  return state.activity.filter(item => {
    const details = item.details ?? {};
    const sourceIds = details.sourceId ? [details.sourceId] : details.sourceIds;
    if (Array.isArray(sourceIds) && !sourceIds.every((id: string) => sourceAllowed(state, ctx, id) && state.facts.filter(f => f.sourceId === id).every(f => canSeeFact(store, ctx, f)))) return false;
    return (member.role === 'owner' && member.branches.includes('*')) || details.memberId === ctx.memberId;
  });
}

function actor(state: State, ctx: Context, details: Record<string, any>): ActivityEvent['actor'] {
  if (typeof details.jobId === 'string') return { kind: 'job', name: null };
  if (typeof details.memberId !== 'string') return { kind: 'chausar', name: null };
  if (details.memberId === ctx.memberId) return { kind: 'you', name: null };
  return { kind: 'person', name: state.members.find(m => m.id === details.memberId)?.name ?? null };
}

export function auditEvents(store: StateStore, ctx: Context): ActivityEvent[] {
  const state = store.read();
  return visibleAudit(store, ctx, state).filter(item => typeof item.event === 'string' && !SKIPPED.has(item.event)).flatMap(item => {
    const type = TYPES[item.event] ?? item.event;
    if (!SAFE_TYPE.test(type) || typeof item.at !== 'string') return [];
    const details = (item.details ?? {}) as Record<string, any>;
    const proof: ActivityEvent['proof'] = typeof details.receiptId === 'string' && type === 'answer.receipt' ? { kind: 'receipt', id: details.receiptId }
      : typeof details.actionId === 'string' ? { kind: 'action', id: details.actionId } : { kind: 'none', id: null };
    const vals = values(details);
    // A joining member's name, as written, for "<name> joined".
    if (item.event === 'trust.member.created') { const name = state.members.find(m => m.id === details.id)?.name; if (typeof name === 'string') vals.name = name; }
    return [{ id: String(item.id), at: item.at, type, state: STATES[item.event] ?? 'done', actor: actor(state, ctx, details), values: vals,
      costPaise: null, route: null, tainted: details.taintedSource === true || details.sourceTainted === true, proof,
      ...(proof.kind === 'action' ? { opens: '#/work/actions' } : {}) }];
  });
}

const digits = (value: unknown) => typeof value === 'string' && /^(0|[1-9][0-9]{0,30})$/.test(value) ? value : null;

/** Model requests from the gateway's visible receipts, with the route and recorded cost. */
export function modelEvents(state: State, ctx: Context, receipts: readonly any[]): ActivityEvent[] {
  return receipts.filter(r => r?.kind === 'model-preview' && typeof r.id === 'string').map(r => {
    const route = state.routes.find(item => item.id === r.routeId);
    const dispatched = typeof r.dispatchedAt === 'string';
    const status: ActivityState = r.status === 'completed' || r.status === 'failed' ? 'done' : r.status === 'dispatching' ? 'unsure' : r.approvalRequired ? 'waiting-for-you' : 'done';
    const vals: Record<string, string> = { status: String(r.status) };
    if (route && typeof route.kind === 'string' && SAFE_VALUE.test(route.kind)) vals.route = route.kind;
    if (typeof r.purpose === 'string' && SAFE_VALUE.test(r.purpose)) vals.purpose = r.purpose;
    if (typeof r.errorCode === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(r.errorCode)) vals.errorCode = r.errorCode;
    const memberId = r.memberId;
    return { id: r.id, at: dispatched ? r.dispatchedAt : r.createdAt ?? r.at, type: 'model.request', state: status,
      actor: memberId === ctx.memberId ? { kind: 'you', name: null } : typeof memberId === 'string' ? { kind: 'person', name: state.members.find(m => m.id === memberId)?.name ?? null } : { kind: 'chausar', name: null },
      values: vals, costPaise: dispatched ? digits(r.actualCostMinor) ?? digits(r.costReservedMinor) : null,
      route: route ? String(route.kind) : null,
      // Rows from imported files, a business context or a tainted caller mean the run read outside text.
      tainted: (Array.isArray(r.factIds) && r.factIds.length > 0) || (Array.isArray(r.rowIds) && r.rowIds.length > 0) || r.sourceTainted === true,
      proof: { kind: 'model-request', id: r.id }, opens: '#/trust/network' } satisfies ActivityEvent;
  }).filter(event => typeof event.at === 'string');
}

type Cursor = { at: string; id: string };
const encode = (cursor: Cursor) => Buffer.from(JSON.stringify([cursor.at, cursor.id])).toString('base64url');
function decode(text: unknown): Cursor {
  check(typeof text === 'string' && text.length <= 400, 'INVALID_TODAYX_REQUEST', 'Use the cursor from the previous page.');
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.from(text, 'base64url').toString('utf8')); } catch { parsed = null; }
  check(Array.isArray(parsed) && parsed.length === 2 && parsed.every(item => typeof item === 'string'), 'INVALID_TODAYX_REQUEST', 'Use the cursor from the previous page.');
  return { at: parsed[0], id: parsed[1] };
}
const newerFirst = (a: Cursor, b: Cursor) => a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;

/** `actor` is a named person's or job's name as written, otherwise an actor kind. */
export type ActivityFilter = { cursor?: string; state?: ActivityState; actor?: string; day?: string };
export function activityFilter(payload: Record<string, unknown>): ActivityFilter {
  const allowed = ['cursor', 'state', 'actor', 'day'];
  check(Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_TODAYX_REQUEST', 'Use only cursor, state, actor and day.');
  check(payload.state === undefined || (ACTIVITY_STATES as readonly unknown[]).includes(payload.state), 'INVALID_TODAYX_REQUEST', 'Choose a known activity state.');
  check(payload.actor === undefined || (typeof payload.actor === 'string' && payload.actor.length > 0 && payload.actor.length <= 200), 'INVALID_TODAYX_REQUEST', 'Choose an actor by name or kind.');
  check(payload.day === undefined || (typeof payload.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.day) && !Number.isNaN(Date.parse(payload.day))), 'INVALID_TODAYX_REQUEST', 'Give the day as YYYY-MM-DD.');
  if (payload.cursor !== undefined) decode(payload.cursor);
  return payload as ActivityFilter;
}

export function activityPage(events: readonly ActivityEvent[], filter: ActivityFilter) {
  const matching = events.filter(e => (!filter.state || e.state === filter.state) && (!filter.actor || (e.actor.name ?? e.actor.kind) === filter.actor || e.actor.kind === filter.actor) && (!filter.day || e.at.startsWith(filter.day)))
    .sort(newerFirst);
  const after = filter.cursor === undefined ? null : decode(filter.cursor);
  const rest = after ? matching.filter(e => newerFirst(e, after) > 0) : matching;
  const page = rest.slice(0, PAGE_SIZE);
  return { events: page, nextCursor: rest.length > PAGE_SIZE ? encode(page.at(-1)!) : null, total: String(matching.length) };
}
