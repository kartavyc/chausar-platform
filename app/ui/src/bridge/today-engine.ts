/** Exact, detached Today data. A producer read is never an approval or a calculation. */
import type { UiContext } from '../host/contracts.ts';
import type { Chart, FigureOrMissing } from '../app/presentation.ts';
import { ReplyValidationError } from './validate.ts';

export type TodayJson = null | boolean | number | string | TodayJson[] | { [key: string]: TodayJson };
export type TodayCheck<T> = (value: unknown) => value is T;
type Checked<C> = C extends TodayCheck<infer T> ? T : never;
type Shape<R, O> = { [K in keyof R]: Checked<R[K]> } & { [K in keyof O]?: Checked<O[K]> };
const invalid = (): never => { throw new ReplyValidationError('today'); };
export function todayRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
/** Inspect descriptors before reading values. Clone aliases independently; reject cycles. */
export function detachToday(value: unknown, activityPayload = false): TodayJson {
  const ancestors = new WeakSet<object>(); let nodes = 0, characters = 0;
  const clone = (input: unknown, depth: number, path: string): TodayJson => {
    if (++nodes > 500000 || depth > 40) return invalid();
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : invalid();
    if (typeof input === 'string') {
      characters += input.length;
      const payload = activityPayload && /^modelReceipts\.\d+\.payload$/.test(path);
      return (payload ? input.length <= 262144 && new TextEncoder().encode(input).byteLength <= 262144 : input.length <= 50000) && characters <= 4000000 ? input : invalid();
    }
    if (typeof input !== 'object' || ancestors.has(input) || Object.getOwnPropertySymbols(input).length) return invalid();
    const array = Array.isArray(input), prototype: unknown = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) return invalid();
    ancestors.add(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    let output: TodayJson;
    if (array) {
      const length: unknown = descriptors.length?.value;
      if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0 || length > 20000 || Object.keys(descriptors).length !== length + 1) return invalid();
      const values: TodayJson[] = [];
      for (let index = 0; index < length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
        const entry: unknown = descriptor.value; values.push(clone(entry, depth + 1, `${path}.${index}`));
      }
      output = values;
    } else {
      const values: { [key: string]: TodayJson } = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
        const entry: unknown = descriptor.value;
        Object.defineProperty(values, key, { value: clone(entry, depth + 1, path ? `${path}.${key}` : key), enumerable: true, writable: true, configurable: true });
      }
      output = values;
    }
    ancestors.delete(input); return output;
  };
  return clone(value, 0, '');
}
export function freezeToday<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const entry of Object.values(value)) freezeToday(entry); Object.freeze(value); }
  return value;
}
export function checkedToday<T>(value: unknown, check: TodayCheck<T>): T {
  const copy = detachToday(value); if (!check(copy)) return invalid(); return freezeToday(copy);
}
export function todayObject<R extends Record<string, TodayCheck<unknown>>, O extends Record<string, TodayCheck<unknown>> = Record<never, never>>(required: R, optional?: O): TodayCheck<Shape<R, O>> {
  return (value: unknown): value is Shape<R, O> => {
    if (!todayRecord(value)) return false;
    const allowed = [...Object.keys(required), ...Object.keys(optional ?? {})];
    if (Object.keys(value).some(key => !allowed.includes(key))) return false;
    for (const [key, check] of Object.entries(required)) if (!Object.hasOwn(value, key) || !check(value[key])) return false;
    for (const [key, check] of Object.entries(optional ?? {})) if (Object.hasOwn(value, key) && !check(value[key])) return false;
    return true;
  };
}
export function todayArray<T>(check: TodayCheck<T>, maximum = 20000): TodayCheck<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.length <= maximum && value.every(check);
}
export function todayLiteral<T extends string | number | boolean | null>(expected: T): TodayCheck<T> {
  return (value: unknown): value is T => value === expected;
}
export function todayChoice<T extends string | number>(...values: T[]): TodayCheck<T> {
  return (value: unknown): value is T => values.some(item => item === value);
}
export function todayUnion<C extends readonly TodayCheck<unknown>[]>(...checks: C): TodayCheck<Checked<C[number]>> {
  return (value: unknown): value is Checked<C[number]> => checks.some(check => check(value));
}
export const todayText: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 5000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
export const todayId: TodayCheck<string> = (value: unknown): value is string => todayText(value) && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
export const todayHash: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const todayInteger: TodayCheck<number> = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const positive: TodayCheck<number> = (value: unknown): value is number => todayInteger(value) && value > 0;
const boolean: TodayCheck<boolean> = (value: unknown): value is boolean => typeof value === 'boolean';
const minor: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value) && value.length <= 1000;
const spentMinor: TodayCheck<string> = (value: unknown): value is string => minor(value) && !value.startsWith('-');
const opaqueText: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 50000;
export const todayDate: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const instant: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && todayDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && Number.isFinite(Date.parse(value));
const canonicalInstant: TodayCheck<string> = (value: unknown): value is string => instant(value) && new Date(value).toISOString() === value;
const zone: TodayCheck<string> = (value: unknown): value is string => {
  if (!todayText(value) || value.length > 100 || !/^[A-Za-z][A-Za-z0-9_+.-]*(?:\/[A-Za-z0-9_+.-]+)*$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; }
};
const nullable = <T>(check: TodayCheck<T>) => todayUnion(check, todayLiteral(null));
const period = todayObject({ from: todayDate, to: todayDate });
const validPeriod = (value: { from: string; to: string }) => value.from <= value.to;
const periodCheck: TodayCheck<{ from: string; to: string }> = (value: unknown): value is { from: string; to: string } => period(value) && validPeriod(value);
const display = todayObject({ date: todayDate, timeZone: zone });
const pack = todayObject({ id: opaqueText, dictionaryHash: todayHash, version: positive });
const capture = todayObject({ id: todayId, digest: todayHash });
const scope = todayObject({ sourceIds: todayArray(todayId, 64), branch: nullable(todayText) });
const bucket = todayObject({ id: todayId, label: todayText, period: periodCheck });
const comparison = todayObject({ operation: todayId, figureKey: todayId, period: periodCheck });
const tileConfiguration = todayObject({ id: todayId, label: todayText, operation: todayId, figureKey: todayId, period: periodCheck, buckets: todayArray(bucket, 120) }, { comparison });
const requestShape = todayObject({ dictionaryHash: todayHash, asOf: canonicalInstant, scope, tiles: todayArray(tileConfiguration, 3) });
const request: TodayCheck<TodayTilesRequest> = (value: unknown): value is TodayTilesRequest => {
  if (!requestShape(value) || value.tiles.length !== 3 || new Set(value.scope.sourceIds).size !== value.scope.sourceIds.length || new Set(value.tiles.map(tile => tile.id)).size !== 3) return false;
  return value.tiles.every(tile => {
    if (new Set(tile.buckets.map(point => point.id)).size !== tile.buckets.length) return false;
    return tile.buckets.every((point, index) => point.period.from >= tile.period.from && point.period.to <= tile.period.to && (index === 0 || tile.buckets[index - 1]!.period.to < point.period.from));
  });
};
const definition = todayObject({ name: todayText, label: todayText, meaning: todayText, kind: todayText, field: todayText, currency: todayText, nulls: todayChoice('exclude', 'reject') }, { sign: todayChoice(1, -1) });
const tileDefinition = todayObject({ dictionaryHash: todayHash, ontologyVersion: positive, definitionHash: todayHash, definitions: todayArray(definition, 1000), operationId: todayId, operationType: todayChoice('sum', 'margin', 'aging', 'change', 'scenario') });
const gap = todayObject({ code: todayText, message: todayText }, { definitionName: todayText, period: periodCheck });
const coverage = todayObject({ selectedRows: todayInteger, countedRows: todayInteger, excludedRows: todayInteger, unresolvedConflicts: todayInteger, importIds: todayArray(todayId), completeness: todayChoice('reconciled-imports', 'unreconciled-facts', 'empty', 'partial'), gaps: todayArray(todayText) }, { notCounted: todayInteger });
const figure = todayObject({ key: todayId, label: todayText, minor, display: todayText, unit: todayChoice('money', 'basis-points') }, { currency: todayText });
const valueShape = todayObject({ status: todayChoice('available', 'partial', 'unavailable'), figure: nullable(figure), receiptId: nullable(todayId), definition: nullable(tileDefinition), coverage: nullable(coverage), gaps: todayArray(gap, 1000) });
const tileValue: TodayCheck<TodayTileValue> = (value: unknown): value is TodayTileValue => valueShape(value) && (value.status === 'unavailable' ? value.figure === null : value.figure !== null) && (value.receiptId === null ? value.definition === null && value.coverage === null : value.definition !== null && value.coverage !== null) && (value.figure === null || value.receiptId !== null);
const point = todayObject({ id: todayId, label: todayText, period: periodCheck, value: tileValue });
const tile = todayObject({ id: todayId, label: todayText, operation: todayId, figureKey: todayId, period: periodCheck, value: tileValue, points: todayArray(point, 120) }, { comparison: todayObject({ operation: todayId, figureKey: todayId, period: periodCheck, value: tileValue }) });
const prepared = todayObject({ reference: capture, display, configuration: todayObject({ id: todayId, digest: todayHash, starterPack: pack, origin: todayLiteral('custom') }), result: todayObject({ version: todayLiteral(1), asOf: canonicalInstant, dictionary: todayObject({ hash: todayHash, version: positive }), scope, atomic: todayLiteral(false), verification: todayChoice('configured', 'not-configured'), tiles: todayArray(tile, 3) }) });

const basicReference = (kind: 'action-approval' | 'job-approval') => todayObject({ kind: todayLiteral(kind), id: todayId, revision: positive, digest: todayHash });
const acceptance = todayObject({ kind: todayLiteral('job-acceptance'), id: todayId, revision: positive, digest: todayHash, deliverableDigest: todayHash });
const lesson = todayObject({ kind: todayLiteral('lesson-decision'), id: todayId, revision: positive, digest: todayHash, reviewId: todayId, reviewDigest: todayHash, evaluationDigest: todayHash });
const reviewReference = todayUnion(basicReference('action-approval'), basicReference('job-approval'), acceptance, lesson);
const candidate = todayObject({ id: todayId, revision: positive, digest: todayHash });
const humanFields: TodayCheck<['decision', 'reason']> = (value: unknown): value is ['decision', 'reason'] => Array.isArray(value) && value.length === 2 && value[0] === 'decision' && value[1] === 'reason';
const reviewRequest = todayUnion(todayObject({ method: todayChoice('actions.approve', 'jobs.approve'), payload: todayObject({ id: todayId, digest: todayHash }) }), todayObject({ method: todayLiteral('jobs.accept'), payload: todayObject({ id: todayId, reference: acceptance }) }), todayObject({ method: todayLiteral('memory.decideLesson'), payload: todayObject({ candidate, reviewId: todayId, reviewDigest: todayHash }), requiredHumanFields: humanFields }));
const provenance = todayUnion(todayObject({ producer: todayChoice('actions', 'jobs', 'lessons'), id: todayId, revision: positive, digest: todayHash }), todayObject({ producer: todayLiteral('job-action-preview'), id: todayId, revision: positive, digest: todayHash, stepId: todayId, operationKey: todayText, actionId: todayId, actionDigest: todayHash, deliverableDigest: todayHash }));
const rowShape = todayObject({ kind: todayChoice('action-approval', 'job-approval', 'job-acceptance', 'lesson-decision'), title: todayText, since: instant, reference: reviewReference, request: reviewRequest, canApprove: boolean, provenance: todayArray(provenance, 1000) });
const reviewRow: TodayCheck<TodayReviewRow> = (value: unknown): value is TodayReviewRow => {
  if (!rowShape(value) || value.kind !== value.reference.kind) return false;
  const ref = value.reference, action = value.request;
  if (ref.kind === 'job-acceptance') return action.method === 'jobs.accept' && action.payload.id === ref.id && sameToday(action.payload.reference, ref);
  if (ref.kind === 'lesson-decision') return action.method === 'memory.decideLesson' && sameToday(action.payload.candidate, { id: ref.id, revision: ref.revision, digest: ref.digest }) && action.payload.reviewId === ref.reviewId && action.payload.reviewDigest === ref.reviewDigest;
  return action.method === (ref.kind === 'action-approval' ? 'actions.approve' : 'jobs.approve') && 'digest' in action.payload && action.payload.id === ref.id && action.payload.digest === ref.digest;
};
const producer = todayObject({ status: todayChoice('complete', 'incomplete', 'unavailable') }, { reason: todayChoice('PRODUCER_AUTHORITY_UNAVAILABLE', 'PRODUCER_READ_UNAVAILABLE', 'REVIEW_EVIDENCE_UNAVAILABLE', 'UNSUPPORTED_MUTATION_CONTRACT') });
const cursor: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(value);
const queueShape = todayObject({ scope: todayLiteral('prepared-actions-job-mandates-deliverables-lessons-v1'), completeness: todayChoice('complete', 'incomplete', 'unavailable'), count: nullable(todayInteger), knownCount: todayInteger, rows: todayArray(reviewRow, 100), nextCursor: nullable(cursor), producers: todayObject({ actions: producer, jobs: producer, lessons: producer }) });
const queue: TodayCheck<TodayReviewQueue> = (value: unknown): value is TodayReviewQueue => {
  if (!queueShape(value) || value.knownCount < value.rows.length || (value.completeness === 'complete' ? value.count !== value.knownCount : value.count !== null) || value.rows.some((row, index) => value.rows.slice(0, index).some(previous => sameToday(previous.reference, row.reference)))) return false;
  if (value.rows.length === 0 && (value.knownCount !== 0 || value.nextCursor !== null)) return false;
  const statuses = Object.values(value.producers).map(producer => producer.status);
  return value.completeness === (statuses.every(status => status === 'complete') ? 'complete' : statuses.every(status => status === 'unavailable') ? 'unavailable' : 'incomplete');
};

const episodeReference = todayObject({ kind: todayLiteral('alert-episode'), alertId: todayId, episodeId: todayId });
const decisionReference = todayObject({ kind: todayLiteral('decision'), decisionId: todayId });
const calendarReference = todayObject({ kind: todayLiteral('compliance-entry'), calendarId: opaqueText, entryId: opaqueText });
const reviewedReference = todayObject({ kind: todayLiteral('reviewed-compliance-calendar'), calendarId: opaqueText, version: opaqueText });
const attentionReference = todayUnion(episodeReference, decisionReference, calendarReference, reviewedReference);
const episode = todayObject({ id: todayId, status: todayChoice('open', 'cleared', 'retracted'), severity: todayChoice('warning', 'critical'), openedAt: instant, reopenCount: todayInteger, uncertain: boolean, observationIds: todayArray(todayId) }, { clearedAt: instant, reopenedAt: instant });
const observation = todayObject({ id: todayId, anchorId: todayId, observedAt: instant, recordedAt: instant, state: todayChoice('breach', 'clear', 'band', 'unknown'), issues: todayArray(todayText), receiptId: nullable(todayId) }, { amends: todayId, amendmentReason: todayText });
const notice = todayObject({ id: todayId, kind: todayLiteral('local-alert-notice-v1'), transition: todayChoice('opened', 'cleared', 'escalated', 'deescalated', 'reopened', 'uncertain', 'evidence-restored', 'amended'), alertId: todayId, episodeId: todayId, at: instant, observationId: todayId, before: nullable(episode), after: episode, delivery: todayLiteral('local-only') });
const alertEpisodeShape = todayObject({ reference: episodeReference, conditionId: todayText, label: todayText, revision: positive, definitionDigest: todayHash, branch: nullable(todayText), sourceIds: todayArray(todayText), receiptIds: todayArray(todayId), episode, lastObservation: nullable(observation), amendments: todayArray(observation), notices: todayArray(notice), evidence: todayObject({ state: todayChoice('current', 'uncertain'), issues: todayArray(todayText) }) });
const alertEpisode: TodayCheck<Checked<typeof alertEpisodeShape>> = (value: unknown): value is Checked<typeof alertEpisodeShape> => alertEpisodeShape(value) && value.reference.episodeId === value.episode.id && value.notices.every(notice => notice.alertId === value.reference.alertId && notice.episodeId === value.reference.episodeId && notice.after.id === notice.episodeId && (notice.before === null || notice.before.id === notice.episodeId));
const dueDecision = todayObject({ reference: decisionReference, text: todayText, reviewDate: todayDate, due: todayChoice('today', 'overdue'), status: todayLiteral('open'), branch: nullable(todayText), revision: nullable(positive), receiptIds: todayArray(todayId) });
const applicability = todayObject({ state: todayChoice('applicable', 'not-applicable', 'unknown'), basis: opaqueText });
const https: TodayCheck<string> = (value: unknown): value is string => { if (!opaqueText(value)) return false; try { const url = new URL(value); return url.protocol === 'https:' && !!url.hostname; } catch { return false; } };
const calendarRowShape = todayObject({ entryId: opaqueText, title: opaqueText, dueDate: todayDate, sourceUrl: https, publishedAt: instant, lastCheckedAt: instant, reviewedAt: instant, reviewedBy: opaqueText, applicability, reference: calendarReference });
const calendarRow: TodayCheck<Checked<typeof calendarRowShape>> = (value: unknown): value is Checked<typeof calendarRowShape> => calendarRowShape(value) && value.entryId === value.reference.entryId;
const windowShape = todayObject({ from: todayDate, through: todayDate, days: todayLiteral(7), timeZone: zone });
const window: TodayCheck<Checked<typeof windowShape>> = (value: unknown): value is Checked<typeof windowShape> => windowShape(value) && Date.parse(`${value.through}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) === 6 * 86400000;
const calendarCoverage = todayObject({ from: todayDate, through: todayDate, timeZone: zone });
const reviewedCalendarShape = todayObject({ window, state: todayLiteral('reviewed'), reference: reviewedReference, sourceIds: todayArray(opaqueText), reviewedAt: instant, reviewedBy: opaqueText, lastCheckedAt: instant, applicability, coverage: calendarCoverage, rows: todayArray(calendarRow) });
const reviewedCalendar: TodayCheck<Checked<typeof reviewedCalendarShape>> = (value: unknown): value is Checked<typeof reviewedCalendarShape> => reviewedCalendarShape(value) && value.sourceIds.length > 0 && new Set(value.sourceIds).size === value.sourceIds.length && value.coverage.from <= value.window.from && value.coverage.through >= value.window.through && value.coverage.timeZone === value.window.timeZone && new Set(value.rows.map(row => row.entryId)).size === value.rows.length && value.rows.every(row => row.reference.calendarId === value.reference.calendarId && row.dueDate >= value.window.from && row.dueDate <= value.window.through);
const emptyArray: TodayCheck<[]> = (value: unknown): value is [] => Array.isArray(value) && value.length === 0;
const calendar = todayUnion(todayObject({ window, state: todayLiteral('unavailable'), reason: todayChoice('no-reviewed-calendar', 'current-authority-unavailable'), rows: emptyArray }), todayObject({ window, state: todayLiteral('unsupported'), reason: todayChoice('calendar-source-contract-required', 'calendar-provenance-incomplete', 'calendar-window-not-covered'), rows: emptyArray }), reviewedCalendar);
const attention = todayObject({ kind: todayLiteral('today-attention-v1'), request: todayObject({ displayedDate: todayDate, timeZone: zone }, { branch: todayText }), authority: todayObject({ workspaceId: todayId, memberId: todayId, epoch: positive, stateRevision: todayInteger }), alertEpisodes: todayArray(alertEpisode), dueDecisions: todayArray(dueDecision), calendar, counts: todayObject({ alertEpisodes: todayInteger, dueDecisions: todayInteger, calendarEntries: todayInteger }), alertsCheckedAt: instant, evaluated: todayLiteral(false), pin: todayHash });
const selectedRow = todayUnion(todayObject({ id: todayText, kind: todayLiteral('alert-episode'), value: alertEpisode }), todayObject({ id: todayText, kind: todayLiteral('due-decision'), value: dueDecision }), todayObject({ id: todayText, kind: todayLiteral('compliance-entry'), value: calendarRow }));
const selection = todayUnion(todayObject({ state: todayLiteral('unavailable'), reason: todayLiteral('selection-policy-required'), rows: emptyArray }), todayObject({ state: todayLiteral('configured'), policyId: todayText, policyRevision: todayText, eligibleCount: todayInteger, rows: todayArray(selectedRow, 5) }));

const actor = todayUnion(todayObject({ kind: todayLiteral('member'), memberId: todayId }), todayObject({ kind: todayLiteral('not-recorded') }));
const importReference = todayObject({ kind: todayLiteral('import'), importId: todayId, sourceId: todayId });
const refusalReference = todayObject({ kind: todayLiteral('import-refusal'), learningEventId: todayId });
const receiptReference = todayObject({ kind: todayLiteral('receipt'), receiptId: todayId });
const actionReference = todayObject({ kind: todayLiteral('action'), actionId: todayId });
const jobReference = todayObject({ kind: todayLiteral('job-delivery'), jobId: todayId });
const eventBase = { id: todayId, at: canonicalInstant, actor };
const event = todayUnion(
  todayObject({ ...eventBase, kind: todayLiteral('source.imported'), args: todayObject({ sourceId: todayId, format: todayChoice('csv', 'tally-xml', 'zoho-json', 'gst-json', 'bank-csv', 'shopify-json', 'xlsx'), rowCount: todayInteger, qualification: todayLiteral('experimental') }), reference: importReference }),
  todayObject({ ...eventBase, kind: todayLiteral('source.import-refused'), args: todayObject({ sourceId: todayId, reasonCode: todayChoice('manual_confirmation', 'ambiguous_field', 'type_match', 'date_format', 'currency_mismatch', 'duplicate_record', 'exact_reference', 'reconciliation', 'unsupported_shape', 'verified_readback'), qualification: todayLiteral('experimental') }), reference: refusalReference }),
  todayObject({ ...eventBase, kind: todayLiteral('calculation.completed'), args: todayObject({ operation: todayId, stale: boolean }), reference: receiptReference }),
  todayObject({ ...eventBase, kind: todayChoice('action.prepared', 'action.revised', 'action.approved', 'action.attempt', 'action.settled', 'action.reconciled', 'action.cancelled', 'action.interrupted'), args: todayObject({ connector: todayId, operation: todayId }, { outcome: todayChoice('prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'), businessSuccess: nullable(boolean) }), reference: actionReference }),
  todayObject({ ...eventBase, kind: todayChoice('decision.created', 'decision.revised'), args: todayObject({}, { revision: positive }), reference: decisionReference }),
  todayObject({ ...eventBase, kind: todayLiteral('decision.reviewed'), args: todayObject({ outcome: todayChoice('accepted', 'rejected', 'continue', 'completed') }, { revision: positive }), reference: decisionReference }),
  todayObject({ ...eventBase, kind: todayLiteral('job.delivered'), args: todayObject({ spentMinor }), reference: jobReference })
);
const dayEvents = todayObject({ date: todayDate, timeZone: zone, calendarRevision: nullable(todayText), events: todayArray(event, 6), total: todayInteger, state: todayObject({ kind: todayChoice('complete', 'partial', 'unavailable'), reasonCodes: todayArray(todayChoice('CALENDAR_RULES_UNAVAILABLE', 'AUTHORITY_RESOLVER_UNAVAILABLE', 'UNSUPPORTED_EVENT_KIND', 'EVENT_EVIDENCE_UNRESOLVED', 'ACTOR_NOT_RECORDED', 'PROJECTION_CAPABILITY_PARTIAL'), 6) }) });
const engine = todayObject({
  kind: todayLiteral('today-engine-v1'), display, atomic: todayLiteral(false), noAction: todayLiteral(true), starterPack: nullable(pack), defaults: todayObject({ state: todayLiteral('unconfigured'), reason: todayLiteral('pack-defaults-not-configured') }), state: todayObject({ kind: todayLiteral('partial'), asOf: todayLiteral(null), reasonCode: todayLiteral('TODAY_ENGINE_CONTRACT_PARTIAL') }), productReviewCount: todayLiteral(null),
  tiles: todayUnion(todayObject({ state: todayLiteral('prepared'), value: prepared }), todayObject({ state: todayLiteral('unavailable'), reason: todayChoice('capture-required', 'tiles-service-unavailable') })),
  attention: todayUnion(todayObject({ state: todayLiteral('available'), value: attention, selection }), todayObject({ state: todayLiteral('unavailable'), reason: todayChoice('attention-service-unavailable', 'attention-guards-required') })),
  review: todayUnion(todayObject({ state: todayLiteral('available'), value: queue }), todayObject({ state: todayLiteral('unavailable'), reason: todayLiteral('review-service-unavailable') })),
  dayEvents: todayUnion(todayObject({ state: todayLiteral('available'), value: dayEvents }), todayObject({ state: todayLiteral('unavailable'), reason: todayLiteral('events-service-unavailable') }))
});

/** Frontend-only structural DTOs are derived from the exact checked wire shapes.
 * Runtime .ts imports would pull server implementations into the browser program. */
export type TodayDisplay = Checked<typeof display>;
export type TodayTileValue = Checked<typeof valueShape>;
export type TodayTilesRequest = Checked<typeof requestShape>;
export type TodayPreparedTiles = Checked<typeof prepared>;
export type TodayReviewReference = Checked<typeof reviewReference>;
export type TodayReviewRow = Checked<typeof rowShape>;
export type TodayReviewQueue = Checked<typeof queueShape>;
export type TodayDayEvent = Checked<typeof event>;
export type TodayAttention = Checked<typeof attention>;
export type TodayDayEvents = Checked<typeof dayEvents>;
export type TodayAttentionReference = Checked<typeof attentionReference>;
export type TodayAttentionResolved = Checked<typeof alertEpisode> | Checked<typeof dueDecision> | Checked<typeof calendarRow> | Checked<typeof reviewedCalendar>;
export type EngineTodayResponse = Checked<typeof engine>;
export type EngineTodayGetRequest = TodayDisplay & { tileCapture?: Checked<typeof capture> };
export type TodayPrepareTilesRequest = TodayDisplay & TodayConfiguration;

export interface TodayConfiguration { readonly configurationId: string; readonly configurationDigest: string; readonly starterPack: Checked<typeof pack>; readonly request: TodayTilesRequest }
export interface TodayChartInput { readonly tileId: string; readonly form: 'columns' | 'line' | 'ordered-bar'; readonly sentence: string; readonly from?: string; readonly to?: string }
export interface TodayProducerInput { readonly display?: TodayDisplay; readonly configuration?: TodayConfiguration; readonly charts?: readonly TodayChartInput[] }
const configuration: TodayCheck<TodayConfiguration> = todayObject({ configurationId: todayId, configurationDigest: todayHash, starterPack: pack, request });
const chartInput: TodayCheck<TodayChartInput> = todayObject({ tileId: todayId, form: todayChoice('columns', 'line', 'ordered-bar'), sentence: todayText }, { from: todayText, to: todayText });
export function validateTodayInput(value: unknown): TodayProducerInput {
  const input = checkedToday(value, todayObject({}, { display, configuration, charts: todayArray(chartInput, 3) }));
  if (input.configuration && input.configuration.request.dictionaryHash !== input.configuration.starterPack.dictionaryHash) return invalid();
  if (input.charts && (new Set(input.charts.map(chart => chart.tileId)).size !== input.charts.length || input.configuration && input.charts.some(chart => !input.configuration!.request.tiles.some(tile => tile.id === chart.tileId)))) return invalid();
  return input;
}
export function sameToday(left: unknown, right: unknown): boolean {
  const canonical = (value: TodayJson): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  };
  return canonical(detachToday(left)) === canonical(detachToday(right));
}
export async function todayDigest(value: unknown, canonical = false): Promise<string> {
  const data = detachToday(value);
  const sort = (item: TodayJson): TodayJson => {
    if (item === null || typeof item !== 'object') return item;
    if (Array.isArray(item)) return item.map(sort);
    const ordered: { [key: string]: TodayJson } = {};
    for (const key of Object.keys(item).sort()) Object.defineProperty(ordered, key, { value: sort(item[key]!), enumerable: true });
    return ordered;
  };
  const bytes = new TextEncoder().encode(JSON.stringify(canonical ? sort(data) : data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
export function validateTodayPrepared(raw: unknown, expected: TodayPrepareTilesRequest): TodayPreparedTiles {
  const value = checkedToday(raw, prepared);
  if (!sameToday(value.display, { date: expected.date, timeZone: expected.timeZone }) || value.configuration.id !== expected.configurationId || value.configuration.digest !== expected.configurationDigest || !sameToday(value.configuration.starterPack, expected.starterPack) || value.result.dictionary.hash !== expected.starterPack.dictionaryHash || value.result.dictionary.version !== expected.starterPack.version || value.result.asOf !== expected.request.asOf || !sameToday(value.result.scope, expected.request.scope) || value.result.tiles.length !== 3) return invalid();
  for (let index = 0; index < 3; index++) {
    const actual = value.result.tiles[index]!, configured = expected.request.tiles[index]!;
    if (actual.id !== configured.id || actual.label !== configured.label || actual.operation !== configured.operation || actual.figureKey !== configured.figureKey || !sameToday(actual.period, configured.period) || actual.points.length !== configured.buckets.length || (actual.comparison === undefined) !== (configured.comparison === undefined)) return invalid();
    const bound = (part: TodayTileValue, operation: string, key: string) => (part.figure === null || part.figure.key === key) && (part.definition === null || part.definition.dictionaryHash === expected.starterPack.dictionaryHash && part.definition.ontologyVersion === expected.starterPack.version && part.definition.operationId === operation);
    if (!bound(actual.value, configured.operation, configured.figureKey)) return invalid();
    for (let n = 0; n < actual.points.length; n++) { const point = actual.points[n]!, bucket = configured.buckets[n]!; if (point.id !== bucket.id || point.label !== bucket.label || !sameToday(point.period, bucket.period) || !bound(point.value, configured.operation, configured.figureKey)) return invalid(); }
    if (actual.comparison && configured.comparison && (actual.comparison.operation !== configured.comparison.operation || actual.comparison.figureKey !== configured.comparison.figureKey || !sameToday(actual.comparison.period, configured.comparison.period) || !bound(actual.comparison.value, configured.comparison.operation, configured.comparison.figureKey))) return invalid();
  }
  return value;
}
export function validateEngineToday(raw: unknown, expected: EngineTodayGetRequest, context: UiContext, config?: TodayConfiguration): EngineTodayResponse {
  const value = checkedToday(raw, engine);
  if (!sameToday(value.display, { date: expected.date, timeZone: expected.timeZone })) return invalid();
  if (value.tiles.state === 'prepared') {
    if (!expected.tileCapture || !config || !sameToday(value.tiles.value.reference, expected.tileCapture) || !sameToday(value.starterPack, value.tiles.value.configuration.starterPack)) return invalid();
    validateTodayPrepared(value.tiles.value, { ...expected, ...config });
  }
  const reviewCount = value.review.state === 'available' ? value.review.value.rows.length : 0;
  if (reviewCount > 4) return invalid();
  if (value.attention.state === 'available') {
    const a = value.attention.value, selected = value.attention.selection;
    if (a.request.displayedDate !== expected.date || a.request.timeZone !== expected.timeZone || a.authority.workspaceId !== context.workspace.id || a.authority.memberId !== context.member.id || a.authority.epoch !== context.member.epoch || a.counts.alertEpisodes !== a.alertEpisodes.length || a.counts.dueDecisions !== a.dueDecisions.length || a.counts.calendarEntries !== a.calendar.rows.length || selected.rows.length + reviewCount > 5) return invalid();
    if (a.calendar.window.from !== expected.date || a.calendar.window.timeZone !== expected.timeZone || new Set(selected.rows.map(row => row.id)).size !== selected.rows.length || selected.rows.some((row, index) => selected.rows.slice(0, index).some(previous => sameToday(previous.value.reference, row.value.reference))) || selected.state === 'configured' && (selected.eligibleCount > a.alertEpisodes.length + a.dueDecisions.length + a.calendar.rows.length || selected.rows.length !== Math.min(selected.eligibleCount, Math.max(0, 5 - reviewCount)))) return invalid();
    for (const row of selected.rows) {
      const candidates = row.kind === 'alert-episode' ? a.alertEpisodes : row.kind === 'due-decision' ? a.dueDecisions : a.calendar.rows;
      if (!candidates.some(candidate => sameToday(candidate, row.value))) return invalid();
    }
  }
  if (value.dayEvents.state === 'available') {
    const events = value.dayEvents.value;
    if (events.date !== expected.date || events.timeZone !== expected.timeZone || events.events.length !== Math.min(events.total, 6) || new Set(events.events.map(event => event.id)).size !== events.events.length || (events.state.kind === 'complete') !== (events.state.reasonCodes.length === 0)) return invalid();
    if (events.events.some(event => event.kind === 'source.imported' && event.args.sourceId !== event.reference.sourceId)) return invalid();
  }
  return value;
}
export function validateTodayQueue(raw: unknown, limit: number): TodayReviewQueue {
  const value = checkedToday(raw, queue); if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || value.rows.length > limit) return invalid(); return value;
}
export function validateTodayReview(raw: unknown, reference: TodayReviewReference): TodayReviewRow {
  const row = checkedToday(raw, reviewRow); if (!sameToday(row.reference, reference)) return invalid(); return row;
}
export function validateTodayEventReference(raw: unknown, expected: TodayDayEvent['reference']): TodayDayEvent['reference'] {
  const reference = checkedToday(raw, todayUnion(importReference, refusalReference, receiptReference, actionReference, decisionReference, jobReference));
  if (!sameToday(reference, expected)) return invalid(); return reference;
}
export function validateTodayAttention(raw: unknown, reference: TodayAttentionReference): TodayAttentionResolved {
  const value = checkedToday(raw, todayUnion(alertEpisode, dueDecision, calendarRow, reviewedCalendar));
  if (!sameToday(value.reference, reference)) return invalid(); return value;
}
export function todayFigure(value: TodayTileValue): FigureOrMissing {
  if (!value.figure || !value.receiptId) return Object.freeze({ kind: 'missing', missing: 'unknown' });
  return Object.freeze({ kind: value.figure.unit === 'money' ? 'money' : 'percent', exact: value.figure.minor, display: value.figure.display, receiptId: value.receiptId, labels: Object.freeze([]) });
}
export function todayChart(tile: TodayPreparedTiles['result']['tiles'][number], input?: TodayChartInput): Chart | undefined {
  if (!input || input.tileId !== tile.id || tile.points.length === 0) return undefined;
  const values = Object.freeze(tile.points.map(point => Object.freeze({ id: point.id, label: point.label, value: todayFigure(point.value) })));
  if (input.form === 'line') return input.from && input.to ? Object.freeze({ form: 'line', sentence: input.sentence, values, from: input.from, to: input.to }) : undefined;
  return Object.freeze({ form: input.form, sentence: input.sentence, values });
}
export type TodayEnginePayloads = {
  'today.get': EngineTodayGetRequest;
  'today.prepareTiles': TodayPrepareTilesRequest;
  'today.review': { readonly limit?: number; readonly cursor?: string };
  'today.resolveReview': { readonly reference: TodayReviewReference };
  'today.resolveEvent': TodayDisplay & { readonly eventId: string };
  'today.resolveAttention': TodayDisplay & { readonly reference: TodayAttentionReference };
};
