import { authorize, check, ChausarError, type Context, type State, type StateStore } from './contracts.ts';
import { strictLocal, type CalendarRules } from './calendar-zone.ts';
import { canSeeFact, currentAccess, validDate } from './memory.ts';
import { assertSourceAccess, sourceAllowed } from './trust.ts';
import { assertLearningDecisionRecord, REASON_CODES, type LearningDecision, type LearningService } from './learning.ts';
import type { CalculatorService } from './calculator.ts';
import { current, sourceAccess, type ActionService } from './actions.ts';
import type { ReportService } from './reports.ts';
import type { JobService } from './jobs.ts';
import type { ImportFormat } from './ingest.ts';

/** Display scope is explicit; this read neither chooses a zone nor schedules work. */
export interface TodayEventsRequest { readonly date: string; readonly timeZone: string }
export type TodayEventActor = { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'not-recorded' };
type EventBase = { readonly id: string; readonly at: string; readonly actor: TodayEventActor };
export type TodayActionKind = 'action.prepared' | 'action.revised' | 'action.approved' | 'action.attempt' | 'action.settled' | 'action.reconciled' | 'action.cancelled' | 'action.interrupted';
export type TodayActionOutcome = 'prepared' | 'approved' | 'executing' | 'verified' | 'unknown' | 'rejected' | 'blocked' | 'cancelled';
export type TodayDecisionOutcome = 'accepted' | 'rejected' | 'continue' | 'completed';
export type TodayDayEvent = EventBase & (
  | { readonly kind: 'source.imported'; readonly args: { readonly sourceId: string; readonly format: ImportFormat; readonly rowCount: number; readonly qualification: 'experimental' }; readonly reference: { readonly kind: 'import'; readonly importId: string; readonly sourceId: string } }
  | { readonly kind: 'source.import-refused'; readonly args: { readonly sourceId: string; readonly reasonCode: typeof REASON_CODES[number]; readonly qualification: 'experimental' }; readonly reference: { readonly kind: 'import-refusal'; readonly learningEventId: string } }
  | { readonly kind: 'calculation.completed'; readonly args: { readonly operation: string; readonly stale: boolean }; readonly reference: { readonly kind: 'receipt'; readonly receiptId: string } }
  | { readonly kind: TodayActionKind; readonly args: { readonly connector: string; readonly operation: string; readonly outcome?: TodayActionOutcome; readonly businessSuccess?: boolean | null }; readonly reference: { readonly kind: 'action'; readonly actionId: string } }
  | { readonly kind: 'decision.created' | 'decision.revised'; readonly args: { readonly revision?: number }; readonly reference: { readonly kind: 'decision'; readonly decisionId: string } }
  | { readonly kind: 'decision.reviewed'; readonly args: { readonly outcome: TodayDecisionOutcome; readonly revision?: number }; readonly reference: { readonly kind: 'decision'; readonly decisionId: string } }
  | { readonly kind: 'job.delivered'; readonly args: { readonly spentMinor: string }; readonly reference: { readonly kind: 'job-delivery'; readonly jobId: string } }
);
export type TodayEventsReason = 'CALENDAR_RULES_UNAVAILABLE' | 'AUTHORITY_RESOLVER_UNAVAILABLE' | 'UNSUPPORTED_EVENT_KIND' | 'EVENT_EVIDENCE_UNRESOLVED' | 'ACTOR_NOT_RECORDED' | 'PROJECTION_CAPABILITY_PARTIAL';
export interface TodayDayEvents {
  readonly date: string;
  readonly timeZone: string;
  /** Calendar revision identifies the installed display rules, not scheduling qualification. */
  readonly calendarRevision: string | null;
  readonly events: readonly TodayDayEvent[];
  /** Count only the complete authorized supported set, before its six-mark cut. */
  readonly total: number;
  readonly state: { readonly kind: 'complete' | 'partial' | 'unavailable'; readonly reasonCodes: readonly TodayEventsReason[] };
}

/** Constructor-only current services. Their existing access and readiness guards
 * must remain installed. No IPC caller can supply these ports or a raw audit list. */
export interface TodayEventServices {
  readonly learning?: LearningService;
  readonly calculator?: CalculatorService;
  readonly actions?: ActionService;
  readonly reports?: ReportService;
  readonly jobs?: JobService;
}
export interface TodayEventsOptions { readonly store: StateStore; readonly rules?: CalendarRules; readonly services?: TodayEventServices }
type Data = Record<string, unknown>;
type AuditRecord = { id: string; at: string; event: string; details: Data };
type Resolution = { kind: 'visible'; event: TodayDayEvent } | { kind: 'hidden' } | { kind: 'unresolved'; reason: TodayEventsReason };
type Held = { workspaceId: string; context: Context; request: TodayEventsRequest };
type ReadCache = { learning?: ReturnType<LearningService['list']>; actions?: ReturnType<ActionService['list']>; decisions?: ReturnType<ReportService['decisions']>; jobs?: ReturnType<JobService['list']> };
const actionKinds: readonly string[] = ['action.prepared', 'action.revised', 'action.approved', 'action.attempt', 'action.settled', 'action.reconciled', 'action.cancelled', 'action.interrupted'];
const outcomes: readonly string[] = ['prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'];
const decisionOutcomes: readonly string[] = ['accepted', 'rejected', 'continue', 'completed'];
const formats: readonly string[] = ['csv', 'tally-xml', 'zoho-json', 'gst-json', 'bank-csv', 'shopify-json', 'xlsx'];
// Learning is ancillary to its import/refusal, and observation/read records are
// not new business activity. Unknown families are explicitly partial below.
const ancillary = new Set(['learning.logged']);
const record = (value: unknown): value is Data => typeof value === 'object' && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
function instant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
    && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const entry of Object.values(value)) freeze(entry); Object.freeze(value); }
  return value;
}
const unresolved = (reason: TodayEventsReason = 'EVENT_EVIDENCE_UNRESOLVED'): Resolution => ({ kind: 'unresolved', reason });
const hidden: Resolution = { kind: 'hidden' };
const absentActor: TodayEventActor = { kind: 'not-recorded' };
const accessErrors = new Set(['ACCESS_REVOKED', 'FORBIDDEN', 'FORBIDDEN_BRANCH', 'BRANCH_FORBIDDEN', 'SOURCE_REVOKED', 'RECEIPT_FORBIDDEN', 'ACTION_FORBIDDEN', 'LEARNING_FORBIDDEN']);
for (const code of ['BRIDGE_BRANCH_FORBIDDEN', 'WRITE_READBACK_REVOKED', 'WRITE_AUTH_EXPIRED']) accessErrors.add(code);

/** Pure read orchestration over real current authority services. Synchronous
 * resolvers allow one release fence; held results must pass release after awaits. */
export class TodayEventsService {
  readonly #store: StateStore;
  readonly #rules?: CalendarRules;
  readonly #services: TodayEventServices;
  readonly #held = new WeakMap<TodayDayEvents, Held>();
  constructor(options: TodayEventsOptions) {
    this.#store = options.store; this.#rules = options.rules; this.#services = { ...options.services };
    for (const service of Object.values(this.#services)) if (service !== undefined) check(service?.store === options.store, 'TODAY_AUTHORITY_STORE_MISMATCH', 'Today authority services must read this current workspace store.');
  }

  #request(input: TodayEventsRequest): TodayEventsRequest {
    check(record(input) && Object.keys(input).length === 2 && Object.keys(input).every(key => ['date', 'timeZone'].includes(key))
      && validDate(input.date) && typeof input.timeZone === 'string' && /^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(input.timeZone),
    'INVALID_TODAY_DAY', 'Supply an explicit valid displayed date and named time zone.');
    if (this.#rules) { strictLocal(`${input.date}T00:00`, this.#rules.minYear, this.#rules.maxYear); this.#rules.canonicalZone(input.timeZone); }
    return { date: input.date, timeZone: input.timeZone };
  }

  #actor(state: State, value: unknown): TodayEventActor {
    return id(value) && state.members.some(member => member.id === value) ? { kind: 'member', memberId: value } : absentActor;
  }

  #resolve(ctx: Context, state: State, item: AuditRecord, cache: ReadCache): Resolution {
    const s = this.#services, d = item.details;
    const base = (actor: TodayEventActor): EventBase => ({ id: item.id, at: new Date(item.at).toISOString(), actor });
    const visible = (event: TodayDayEvent): Resolution => ({ kind: 'visible', event });
    if (item.event === 'source.imported' || item.event === 'source.import-refused') {
      if (!s.learning) return unresolved('AUTHORITY_RESOLVER_UNAVAILABLE');
      if (!id(d.sourceId)) return unresolved();
      const accepted = item.event === 'source.imported';
      const target = accepted ? d.importId : d.eventId;
      if (!id(target)) return unresolved();
      assertSourceAccess(state, ctx, [d.sourceId]);
      const raw = accepted ? state.imports.find(value => value.id === target) : state.learning.find(value => value.id === target);
      if (!raw) return unresolved();
      const candidates = accepted ? state.learning.filter(value => value.importIdentity?.id === target) : [raw];
      if (candidates.length !== 1) return unresolved();
      const candidate: unknown = candidates[0];
      if (!record(candidate)) return unresolved();
      // Classify actual reader/author denials before diagnosing invalid retained
      // proof. A filtering list alone cannot distinguish corruption from denial.
      if (record(candidate.importIdentity) && Array.isArray(candidate.importIdentity.branches)) {
        const member = authorize(this.#store, ctx);
        if (!member.branches.includes('*') && (!candidate.importIdentity.branches.length
          || !candidate.importIdentity.branches.every(branch => typeof branch === 'string' && member.branches.includes(branch)))) return hidden;
      }
      assertLearningDecisionRecord(candidate);
      const authorContext = { memberId: candidate.memberId, role: candidate.role, epoch: candidate.epoch };
      const author = current(state, authorContext, 'prepare');
      assertSourceAccess(state, authorContext, candidate.sourceIds);
      const branches = candidate.importIdentity?.branches;
      if (branches && !author.branches.includes('*') && (!branches.length || !branches.every(branch => author.branches.includes(branch)))) return hidden;
      if (candidate.memberId !== ctx.memberId && ctx.role !== 'owner') return hidden;
      for (const rowId of candidate.rowIds) {
        const fact = state.facts.find(value => value.id === rowId);
        if (fact && !canSeeFact(this.#store, ctx, fact)) return hidden;
      }
      const matches = ((cache.learning ??= s.learning.list(ctx)) as unknown[]).filter((value): value is LearningDecision => record(value) && value.type === 'decision'
        && record(value.importIdentity) && (accepted ? value.importIdentity.id === target : value.id === target));
      if (matches.length === 0) return unresolved();
      if (matches.length !== 1) return unresolved();
      const evidence = matches[0]!, identity = evidence.importIdentity!;
      if (identity.sourceId !== d.sourceId || identity.outcome !== (accepted ? 'accepted' : 'rejected')) return unresolved();
      const actor = this.#actor(state, evidence.memberId);
      if (accepted) {
        if (!record(raw) || raw.sourceId !== identity.sourceId || raw.format !== identity.format || !formats.includes(identity.format)
          || !Array.isArray(raw.rowIds) || raw.rowIds.length !== d.rowCount || !integer(d.rowCount)
          || raw.contentHash !== identity.contentHash || raw.recipeHash !== identity.recipeHash) return unresolved();
        return visible({ ...base(actor), kind: 'source.imported', args: { sourceId: identity.sourceId, format: identity.format as ImportFormat,
          rowCount: raw.rowIds.length, qualification: 'experimental' }, reference: { kind: 'import', importId: identity.id, sourceId: identity.sourceId } });
      }
      const reasonCode = evidence.input.reasonCode;
      if (!reasonCode || !REASON_CODES.includes(reasonCode) || reasonCode !== d.reasonCode) return unresolved();
      return visible({ ...base(actor), kind: 'source.import-refused', args: { sourceId: identity.sourceId, reasonCode, qualification: 'experimental' },
        reference: { kind: 'import-refusal', learningEventId: evidence.id } });
    }
    if (item.event === 'calculation.completed') {
      if (!s.calculator?.receiptGuard) return unresolved('AUTHORITY_RESOLVER_UNAVAILABLE');
      if (!id(d.receiptId) || !id(d.operation) || !integer(d.rowCount)) return unresolved();
      const receipt = s.calculator.receipt(ctx, d.receiptId);
      // Calculator's current resolver checks rows/exclusions and its acquisition
      // guard. Explicit source IDs still need denial/deletion checks for zero rows.
      assertSourceAccess(state, ctx, receipt.sourceIds);
      if (receipt.id !== d.receiptId || receipt.operation !== d.operation || receipt.rowIds.length !== d.rowCount || typeof receipt.stale !== 'boolean') return unresolved();
      return visible({ ...base(this.#actor(state, receipt.memberId)), kind: 'calculation.completed', args: { operation: receipt.operation, stale: receipt.stale },
        reference: { kind: 'receipt', receiptId: receipt.id } });
    }
    if (actionKinds.includes(item.event)) {
      if (!s.actions) return unresolved('AUTHORITY_RESOLVER_UNAVAILABLE');
      if (!id(d.actionId)) return unresolved();
      const raw = state.actions.find(value => value.id === d.actionId);
      if (!raw) return unresolved();
      s.actions.access(state, ctx, raw);
      s.actions.operation(raw.connector, raw.operation).authorize?.(state, ctx, 'read');
      const values = (cache.actions ??= s.actions.list(ctx)).filter(value => value.id === d.actionId);
      if (!values.length) return unresolved();
      if (values.length !== 1) return unresolved();
      const action = values[0]!;
      if (!id(action.connector) || !id(action.operation)) return unresolved();
      let actor: TodayEventActor = absentActor;
      if (item.event === 'action.prepared') {
        if (d.memberId !== action.createdBy) return unresolved();
        actor = this.#actor(state, action.createdBy);
      }
      if (item.event === 'action.approved') {
        // If retained approval was replaced, its historical actor cannot be
        // recovered from the current approval; preserve the missing actor.
        if (action.approval?.digest === d.digest) {
          if (action.approval.memberId !== d.memberId) return unresolved();
          actor = this.#actor(state, d.memberId);
        }
      }
      if (item.event === 'action.attempt' && !action.attempts.some(attempt => attempt.id === d.attemptId)) return unresolved();
      const args: { connector: string; operation: string; outcome?: TodayActionOutcome; businessSuccess?: boolean | null } = { connector: action.connector, operation: action.operation };
      if (item.event === 'action.settled' || item.event === 'action.reconciled' || item.event === 'action.interrupted') {
        const outcome = item.event === 'action.reconciled' ? d.status : d.outcome;
        if (typeof outcome !== 'string' || !outcomes.includes(outcome)) return unresolved();
        args.outcome = outcome as TodayActionOutcome;
      }
      if (item.event === 'action.settled') {
        if (!(d.businessSuccess === null || typeof d.businessSuccess === 'boolean')) return unresolved();
        args.businessSuccess = d.businessSuccess;
      }
      return visible({ ...base(actor), kind: item.event as TodayActionKind, args, reference: { kind: 'action', actionId: action.id } });
    }
    if (['decision.created', 'decision.revised', 'decision.reviewed'].includes(item.event)) {
      if (!s.reports?.options.receiptGuard) return unresolved('AUTHORITY_RESOLVER_UNAVAILABLE');
      if (!id(d.decisionId)) return unresolved();
      const raw = state.decisions.find(value => value.id === d.decisionId);
      if (!raw) return unresolved();
      currentAccess(this.#store, ctx, raw.branch);
      if (Array.isArray(raw.sourceIds)) assertSourceAccess(state, ctx, raw.sourceIds);
      for (const receiptId of raw.receiptIds ?? []) {
        const receipt = s.reports.calculator.receipt(ctx, receiptId);
        assertSourceAccess(state, ctx, receipt.sourceIds);
      }
      const values = (cache.decisions ??= s.reports.decisions(ctx)).filter(value => value.id === d.decisionId);
      if (!values.length) return unresolved();
      if (values.length !== 1) return unresolved();
      const decision = values[0]!, reference = { kind: 'decision' as const, decisionId: decision.id as string };
      const revision = d.revision === undefined ? {} : integer(d.revision) && d.revision > 0 ? { revision: d.revision } : undefined;
      if (!revision) return unresolved();
      let actor: TodayEventActor = absentActor;
      if (item.event === 'decision.created') {
        if ((d.memberId !== undefined && d.memberId !== decision.by) || (d.revision !== undefined && d.revision !== 1)) return unresolved();
        actor = this.#actor(state, decision.by);
      }
      if (item.event === 'decision.revised') {
        const entries = (decision.revisions ?? []).filter((entry: { fromRevision: number; by: string; at: string }) => entry.fromRevision + 1 === d.revision
          && entry.by === d.memberId && instant(entry.at) && Date.parse(entry.at) <= Date.parse(item.at));
        if (entries.length !== 1) return unresolved();
        actor = this.#actor(state, entries[0].by);
      }
      if (item.event === 'decision.reviewed') {
        if (typeof d.outcome !== 'string' || !decisionOutcomes.includes(d.outcome)) return unresolved();
        const entries = (decision.reviews ?? []).filter((entry: { atRevision?: number; by: string; at: string; outcome: string }) => entry.outcome === d.outcome
          && (d.revision === undefined || entry.atRevision !== undefined && entry.atRevision + 1 === d.revision)
          && (d.memberId === undefined || entry.by === d.memberId) && instant(entry.at) && Date.parse(entry.at) <= Date.parse(item.at));
        if (!entries.length) return unresolved();
        if (entries.length === 1) actor = this.#actor(state, entries[0].by);
        return visible({ ...base(actor), kind: 'decision.reviewed', args: { ...revision, outcome: d.outcome as TodayDecisionOutcome }, reference });
      }
      return visible({ ...base(actor), kind: item.event as 'decision.created' | 'decision.revised', args: revision, reference });
    }
    if (item.event === 'job.delivered') {
      if (!s.jobs?.deliverableGuard) return unresolved('AUTHORITY_RESOLVER_UNAVAILABLE');
      if (!id(d.jobId) || typeof d.spentMinor !== 'string' || !/^(0|[1-9]\d*)$/.test(d.spentMinor)) return unresolved();
      const raw = state.jobs.find(value => value.id === d.jobId);
      if (!raw) return unresolved();
      if (raw.ownerId !== ctx.memberId || raw.ownerEpoch !== ctx.epoch || raw.ownerRole !== ctx.role) return hidden;
      if (raw.type === 'owner-brief' && !raw.plan) assertSourceAccess(state, ctx, raw.sourceIds);
      else sourceAccess(state, ctx, raw.sourceIds);
      const jobs = (cache.jobs ??= s.jobs.list(ctx)).filter(value => value.id === d.jobId);
      if (!jobs.length) return unresolved();
      if (jobs.length !== 1 || !Object.hasOwn(jobs[0]!, 'deliverable')) return unresolved();
      return visible({ ...base(absentActor), kind: 'job.delivered', args: { spentMinor: d.spentMinor }, reference: { kind: 'job-delivery', jobId: jobs[0]!.id } });
    }
    return unresolved('UNSUPPORTED_EVENT_KIND');
  }

  #read(ctxInput: Context, input: TodayEventsRequest): { result: TodayDayEvents; all: TodayDayEvent[]; context: Context; workspaceId: string } {
    const ctx = { ...ctxInput }, request = this.#request(input);
    const member = authorize(this.#store, ctx); const state = this.#store.read();
    const pin = JSON.stringify(state), reasons = new Set<TodayEventsReason>(), all: TodayDayEvent[] = [];
    const cache: ReadCache = {};
    if (!this.#rules) reasons.add('CALENDAR_RULES_UNAVAILABLE');
    else {
      const identities = new Set<string>();
      const duplicates = new Set<string>();
      for (const raw of state.activity as unknown[]) if (record(raw) && id(raw.id)) { if (identities.has(raw.id)) duplicates.add(raw.id); identities.add(raw.id); }
      for (const raw of state.activity as unknown[]) {
        if (!record(raw) || !instant(raw.at)) { reasons.add('EVENT_EVIDENCE_UNRESOLVED'); continue; }
        let local: string;
        try { local = this.#rules.localAt(Date.parse(raw.at), request.timeZone); } catch { reasons.add('EVENT_EVIDENCE_UNRESOLVED'); continue; }
        if (local.slice(0, 10) !== request.date) continue;
        if (typeof raw.event === 'string' && ancillary.has(raw.event)) continue;
        if (!id(raw.id) || duplicates.has(raw.id) || typeof raw.event !== 'string' || !record(raw.details)) { reasons.add('EVENT_EVIDENCE_UNRESOLVED'); continue; }
        let value: Resolution;
        try { value = this.#resolve(ctx, state, raw as AuditRecord, cache); }
        catch (error) {
          if (error instanceof ChausarError && accessErrors.has(error.code)) value = hidden;
          else value = unresolved();
        }
        if (value.kind === 'visible') {
          all.push(value.event);
          if (value.event.actor.kind === 'not-recorded') reasons.add('ACTOR_NOT_RECORDED');
        } else if (value.kind === 'unresolved') reasons.add(value.reason);
      }
    }
    // Reject any resolver that changed workspace state or authority. No partial
    // payload escapes a changed store, including changes without revision bumps.
    authorize(this.#store, ctx);
    check(JSON.stringify(this.#store.read()) === pin, 'TODAY_VIEW_CHANGED', 'Workspace evidence changed during this read. Read Today again.');
    const sourceRestricted = !state.policy.allowedSources.includes('*')
      || state.sourceRules.some(rule => (nonempty(rule.sourceId) && !sourceAllowed(state, ctx, rule.sourceId))
        || ((nonempty(rule.sourceId) || nonempty(rule.id)) && (rule.memberId === undefined || rule.memberId === ctx.memberId) && (rule.active === false || rule.read === false)))
      || state.tombstones.some(item => nonempty(item.sourceId) && (item.kind === 'source' || item.deleted === true));
    if (this.#rules && (member.role !== 'owner' || !member.branches.includes('*') || sourceRestricted)) {
      // Audit rows without resolvable references have no seat-level visibility
      // proof. A constant capability reason prevents hidden rows from changing
      // diagnostics for restricted seats, even on an otherwise empty date.
      for (const code of ['AUTHORITY_RESOLVER_UNAVAILABLE', 'UNSUPPORTED_EVENT_KIND', 'EVENT_EVIDENCE_UNRESOLVED'] as const) reasons.delete(code);
      reasons.add('PROJECTION_CAPABILITY_PARTIAL');
    }
    all.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const codes = [...reasons].sort();
    const kind = codes.length === 0 ? 'complete' : all.length === 0 && codes.every(code => ['CALENDAR_RULES_UNAVAILABLE', 'AUTHORITY_RESOLVER_UNAVAILABLE'].includes(code)) ? 'unavailable' : 'partial';
    const result: TodayDayEvents = freeze({ ...request, calendarRevision: this.#rules?.revision ?? null, events: all.slice(0, 6), total: all.length, state: { kind, reasonCodes: codes } });
    return { result, all, context: ctx, workspaceId: state.workspace.id };
  }

  day(ctx: Context, input: TodayEventsRequest): TodayDayEvents {
    const value = this.#read(ctx, input);
    this.#held.set(value.result, { context: value.context, request: { ...input }, workspaceId: value.workspaceId });
    return value.result;
  }

  /** Parent assembly after awaited work must release this authentic held value,
   * which reads again. A serialized result or reference is never an access grant. */
  release(ctx: Context, held: TodayDayEvents): TodayDayEvents {
    const pin = this.#held.get(held);
    check(pin && pin.workspaceId === this.#store.read().workspace.id && pin.context.memberId === ctx.memberId
      && pin.context.role === ctx.role && pin.context.epoch === ctx.epoch && pin.context.channel === ctx.channel
      && pin.context.sourceTainted === ctx.sourceTainted, 'TODAY_HELD_RESULT_FORBIDDEN', 'Release only this member context and workspace current held read.');
    return this.day(ctx, pin.request);
  }

  /** Open by event ID, never by a caller-supplied arbitrary domain reference.
   * The downstream receipt/action/decision/job/source read reauthorizes again. */
  resolveReference(ctx: Context, input: TodayEventsRequest & { readonly eventId: string }): TodayDayEvent['reference'] {
    check(record(input) && Object.keys(input).length === 3 && id(input.eventId), 'INVALID_TODAY_EVENT_REFERENCE', 'Choose a retained day event ID in its explicit display scope.');
    const value = this.#read(ctx, { date: input.date, timeZone: input.timeZone });
    const event = value.all.find(item => item.id === input.eventId);
    check(event, 'TODAY_EVENT_REFERENCE_UNAVAILABLE', 'The event reference is unavailable under current authority.');
    return freeze(structuredClone(event.reference));
  }
}
