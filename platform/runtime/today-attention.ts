import { authorize, check, hash, type Context, type State, type StateStore } from './contracts.ts';
import { AlertsService, type AlertEpisode, type AlertNotice, type AlertObservation, type AlertsOptions } from './alerts.ts';
import { ReportService, type ReportOptions } from './reports.ts';
import { currentAccess, validDate } from './memory.ts';
import { assertSourceAccess, sourceAllowed } from './trust.ts';

/** The host supplies the displayed civil day and zone. Neither is inferred from the machine clock. */
export type TodayAttentionRequest = { displayedDate: string; timeZone: string; branch?: string };
export type AttentionObservation = Pick<AlertObservation, 'id' | 'anchorId' | 'observedAt' | 'recordedAt' | 'state' | 'issues' | 'amends' | 'amendmentReason'> & { receiptId: string | null };
export type AttentionAlertEpisode = {
  reference: { kind: 'alert-episode'; alertId: string; episodeId: string };
  conditionId: string; label: string; revision: number; definitionDigest: string;
  branch: string | null; sourceIds: string[]; receiptIds: string[];
  /** Retained lifecycle, including cleared/retracted history; presence is not a new breach assertion. */
  episode: AlertEpisode;
  lastObservation: AttentionObservation | null;
  amendments: AttentionObservation[];
  notices: AlertNotice[];
  evidence: { state: 'current' | 'uncertain'; issues: string[] };
};
export type AttentionDueDecision = {
  reference: { kind: 'decision'; decisionId: string };
  text: string; reviewDate: string; due: 'today' | 'overdue'; status: 'open';
  branch: string | null; revision: number | null; receiptIds: string[];
};
export type ReviewedComplianceEntry = {
  entryId: string; title: string; dueDate: string; sourceUrl: string; publishedAt: string;
  lastCheckedAt: string; reviewedAt: string; reviewedBy: string;
  /** Supplied reviewed source meaning, never inferred from a due date or a business name. */
  applicability: { state: 'applicable' | 'not-applicable' | 'unknown'; basis: string };
};
/** Trusted host adapter output, not a public request or an assertion accepted from the renderer. */
export type TodayAttentionCalendarInput =
  | { state: 'unavailable' }
  | { state: 'unsupported' }
  | { state: 'reviewed'; calendarId: string; version: string; sourceIds: string[];
      reviewedAt: string; reviewedBy: string; lastCheckedAt: string;
      applicability: ReviewedComplianceEntry['applicability'];
      coverage: { from: string; through: string; timeZone: string }; entries: ReviewedComplianceEntry[] };
export type AttentionCalendarRow = ReviewedComplianceEntry & {
  reference: { kind: 'compliance-entry'; calendarId: string; entryId: string };
};
export type AttentionCalendar = {
  window: { from: string; through: string; days: 7; timeZone: string };
} & (
  | { state: 'unavailable'; reason: 'no-reviewed-calendar' | 'current-authority-unavailable'; rows: [] }
  | { state: 'unsupported'; reason: 'calendar-source-contract-required' | 'calendar-provenance-incomplete' | 'calendar-window-not-covered'; rows: [] }
  | { state: 'reviewed'; reference: { kind: 'reviewed-compliance-calendar'; calendarId: string; version: string };
      sourceIds: string[]; reviewedAt: string; reviewedBy: string; lastCheckedAt: string;
      applicability: ReviewedComplianceEntry['applicability'];
      coverage: { from: string; through: string; timeZone: string }; rows: AttentionCalendarRow[] }
);
export type TodayAttention = {
  kind: 'today-attention-v1'; request: TodayAttentionRequest;
  authority: { workspaceId: string; memberId: string; epoch: number; stateRevision: number };
  /** Stable AlertsService.brief alert order, then retained episode order; no severity rank. */
  alertEpisodes: AttentionAlertEpisode[];
  /** ReportService.dueDecisions retained order; no added overdue/severity rank. */
  dueDecisions: AttentionDueDecision[];
  calendar: AttentionCalendar;
  counts: { alertEpisodes: number; dueDecisions: number; calendarEntries: number };
  alertsCheckedAt: string;
  evaluated: false;
  pin: string;
};
export type TodayAttentionOptions = {
  /** Factories bind existing receipt/readiness/execution guards to the read-only current view. */
  alertsOptions?: (view: StateStore) => AlertsOptions;
  reportOptions?: (view: StateStore) => ReportOptions;
  calendar?: (ctx: Context, request: TodayAttentionRequest, view: StateStore) => TodayAttentionCalendarInput;
};

function view(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new Error('Today attention views are read-only.'); } };
}
function plain(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
function nonblank(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function instant(value: unknown): value is string {
  return typeof value === 'string' && validDate(value.slice(0, 10))
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)) && Number(value.slice(11, 13)) < 24
    && Number(value.slice(14, 16)) < 60 && Number(value.slice(17, 19)) < 60;
}
function applicability(value: unknown): value is ReviewedComplianceEntry['applicability'] {
  return plain(value) && ['applicable', 'not-applicable', 'unknown'].includes(String(value.state)) && nonblank(value.basis);
}
function sourceLink(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname.length > 0; }
  catch { return false; }
}
function request(input: TodayAttentionRequest): TodayAttentionRequest {
  check(plain(input) && Object.keys(input).every(key => ['displayedDate', 'timeZone', 'branch'].includes(key))
    && validDate(input.displayedDate) && nonblank(input.timeZone)
    && (input.branch === undefined || nonblank(input.branch)), 'INVALID_TODAY_ATTENTION', 'Supply an explicit valid displayed day, timezone and optional branch.');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }); }
  catch { check(false, 'INVALID_TODAY_ATTENTION', 'Supply a supported explicit timezone.'); }
  return structuredClone(input);
}
function seventhDay(from: string): string {
  const day = new Date(`${from}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 6);
  const through = day.toISOString().slice(0, 10);
  check(validDate(through), 'INVALID_TODAY_ATTENTION', 'The seven-day window must remain within supported civil dates.');
  return through;
}
function observation(value: AlertObservation): AttentionObservation {
  return { id: value.id, anchorId: value.anchorId, observedAt: value.observedAt, recordedAt: value.recordedAt,
    state: value.state, issues: [...value.issues], receiptId: value.receipt?.receiptId ?? null,
    ...(value.amends === undefined ? {} : { amends: value.amends }),
    ...(value.amendmentReason === undefined ? {} : { amendmentReason: value.amendmentReason }) };
}
function digest(value: Omit<TodayAttention, 'pin'>): string {
  // checkedAt is a read timestamp. Evidence issues, lifecycle and source provenance remain pinned.
  const { alertsCheckedAt, ...content } = value; return hash(content);
}

/** Read retained domain services only. No calculation, alert evaluation, model, job or mutation port. */
export class TodayAttentionService {
  readonly store: StateStore;
  readonly options: TodayAttentionOptions;
  constructor(store: StateStore, options: TodayAttentionOptions = {}) { this.store = store; this.options = options; }

  private calendar(ctx: Context, input: TodayAttentionRequest, current: StateStore): AttentionCalendar {
    const state = current.read();
    const window = { from: input.displayedDate, through: seventhDay(input.displayedDate), days: 7 as const, timeZone: input.timeZone };
    if (!this.options.calendar) return state.schedules.some(item => item.type === 'compliance-calendar')
      ? { window, state: 'unsupported', reason: 'calendar-source-contract-required', rows: [] }
      : { window, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] };
    const calendar = structuredClone(this.options.calendar(structuredClone(ctx), structuredClone(input), current));
    if (calendar?.state === 'unavailable') return { window, state: 'unavailable', reason: 'no-reviewed-calendar', rows: [] };
    if (calendar?.state === 'unsupported') return { window, state: 'unsupported', reason: 'calendar-source-contract-required', rows: [] };
    if (calendar?.state !== 'reviewed' || !nonblank(calendar.calendarId) || !nonblank(calendar.version)
      || !Array.isArray(calendar.sourceIds) || !calendar.sourceIds.length || !Array.from(calendar.sourceIds).every(nonblank)
      || new Set(calendar.sourceIds).size !== calendar.sourceIds.length
      || !instant(calendar.reviewedAt) || !nonblank(calendar.reviewedBy) || !instant(calendar.lastCheckedAt)
      || !applicability(calendar.applicability)
      || !calendar.coverage || !validDate(calendar.coverage.from) || !validDate(calendar.coverage.through)
      || calendar.coverage.from > calendar.coverage.through || !Array.isArray(calendar.entries)) {
      return { window, state: 'unsupported', reason: 'calendar-provenance-incomplete', rows: [] };
    }
    // No revoked calendar identifiers, dates or hidden counts are released.
    if (!calendar.sourceIds.every(id => sourceAllowed(state, ctx, id))) {
      return { window, state: 'unavailable', reason: 'current-authority-unavailable', rows: [] };
    }
    assertSourceAccess(state, ctx, calendar.sourceIds);
    if (Array.from(calendar.entries).some(entry => !entry || !nonblank(entry.entryId) || !nonblank(entry.title) || !validDate(entry.dueDate)
      || !sourceLink(entry.sourceUrl)
      || !instant(entry.publishedAt) || !instant(entry.lastCheckedAt) || !instant(entry.reviewedAt) || !nonblank(entry.reviewedBy)
      || !applicability(entry.applicability)) || new Set(calendar.entries.map(entry => entry.entryId)).size !== calendar.entries.length) {
      return { window, state: 'unsupported', reason: 'calendar-provenance-incomplete', rows: [] };
    }
    if (calendar.coverage.timeZone !== input.timeZone || calendar.coverage.from > window.from || calendar.coverage.through < window.through) {
      return { window, state: 'unsupported', reason: 'calendar-window-not-covered', rows: [] };
    }
    return { window, state: 'reviewed', reference: { kind: 'reviewed-compliance-calendar', calendarId: calendar.calendarId, version: calendar.version },
      sourceIds: [...calendar.sourceIds], reviewedAt: calendar.reviewedAt, reviewedBy: calendar.reviewedBy, lastCheckedAt: calendar.lastCheckedAt,
      applicability: { state: calendar.applicability.state, basis: calendar.applicability.basis },
      coverage: { from: calendar.coverage.from, through: calendar.coverage.through, timeZone: calendar.coverage.timeZone }, rows: calendar.entries
        .filter(entry => entry.dueDate >= window.from && entry.dueDate <= window.through)
        .map(entry => ({ entryId: entry.entryId, title: entry.title, dueDate: entry.dueDate, sourceUrl: entry.sourceUrl,
          publishedAt: entry.publishedAt, lastCheckedAt: entry.lastCheckedAt, reviewedAt: entry.reviewedAt, reviewedBy: entry.reviewedBy,
          applicability: { state: entry.applicability.state, basis: entry.applicability.basis },
          reference: { kind: 'compliance-entry', calendarId: calendar.calendarId, entryId: entry.entryId } })) };
  }

  read(ctx: Context, input: TodayAttentionRequest): TodayAttention {
    ctx = structuredClone(ctx); const supplied = request(input), state = structuredClone(this.store.read()), current = view(state);
    authorize(current, ctx); currentAccess(current, ctx, supplied.branch);
    const alerts = new AlertsService(current, this.options.alertsOptions?.(current));
    const reports = new ReportService(current, this.options.reportOptions?.(current));
    const brief = alerts.brief(ctx, supplied.branch === undefined ? {} : { branch: supplied.branch });
    const alertEpisodes: AttentionAlertEpisode[] = brief.items.flatMap(item => {
      // get reuses the exact source/receipt/epoch guards before exposing amendment/notice history.
      const retained = alerts.get(ctx, item.alertId);
      return item.episodes.map(episode => {
        const notices = retained.notices.filter(notice => notice.episodeId === episode.id);
        const ids = new Set([...episode.observationIds, ...notices.map(notice => notice.observationId)]);
        const anchors = new Set(retained.observations.filter(value => ids.has(value.id)).map(value => value.anchorId));
        const related = retained.observations.filter(value => ids.has(value.id) || anchors.has(value.anchorId));
        // Retained append order breaks ties between corrections at the same measurement time.
        const latestByAnchor = new Map<string, AlertObservation>();
        related.forEach(value => latestByAnchor.set(value.anchorId, value));
        const last = [...latestByAnchor.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
        return { reference: { kind: 'alert-episode' as const, alertId: item.alertId, episodeId: episode.id },
          conditionId: item.conditionId, label: item.label, revision: item.revision, definitionDigest: item.definitionDigest,
          branch: item.branch, sourceIds: [...item.sourceIds], receiptIds: [...item.receiptIds], episode: structuredClone(episode),
          lastObservation: last ? observation(last) : null, amendments: related.filter(value => value.amends !== undefined).map(observation),
          notices: structuredClone(notices), evidence: structuredClone(item.evidence) };
      });
    });
    const dueDecisions: AttentionDueDecision[] = reports.dueDecisions(ctx, { dueOn: supplied.displayedDate,
      ...(supplied.branch === undefined ? {} : { branch: supplied.branch }) }).map<AttentionDueDecision>(value => ({
      reference: { kind: 'decision', decisionId: value.id }, text: value.text, reviewDate: value.reviewDate,
      due: value.reviewDate === supplied.displayedDate ? 'today' : 'overdue', status: 'open', branch: value.branch ?? null,
      revision: Number.isSafeInteger(value.revision) ? value.revision : null, receiptIds: [...(value.receiptIds ?? [])],
    }));
    const calendar = this.calendar(ctx, supplied, current);
    // Trusted readiness hooks must not cause a response based on a superseded snapshot.
    const finalState = this.store.read(); authorize(view(finalState), ctx);
    check(hash(finalState) === hash(state), 'TODAY_ATTENTION_STALE', 'Authority or retained evidence changed while reading Today. Read again.');
    const body: Omit<TodayAttention, 'pin'> = { kind: 'today-attention-v1', request: supplied,
      authority: { workspaceId: state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch, stateRevision: state.revision },
      alertEpisodes, dueDecisions, calendar, counts: { alertEpisodes: alertEpisodes.length, dueDecisions: dueDecisions.length, calendarEntries: calendar.rows.length },
      alertsCheckedAt: brief.checkedAt, evaluated: false };
    return structuredClone({ ...body, pin: digest(body) });
  }

  /** The host calls this after any await and immediately before releasing held rows/references/counts. */
  assertCurrent(ctx: Context, held: TodayAttention): TodayAttention {
    authorize(this.store, ctx);
    check(held?.kind === 'today-attention-v1' && held.authority?.memberId === ctx.memberId && held.authority.epoch === ctx.epoch
      && held.authority.workspaceId === this.store.read().workspace.id, 'TODAY_ATTENTION_STALE', 'This Today response belongs to another current authority.');
    const { pin, ...body } = held;
    check(digest(body) === pin, 'TODAY_ATTENTION_STALE', 'The held Today response changed. Read again.');
    const current = this.read(ctx, held.request);
    check(current.pin === pin, 'TODAY_ATTENTION_STALE', 'Authority, evidence, lifecycle or calendar provenance changed. Read Today again.');
    return current;
  }
}
