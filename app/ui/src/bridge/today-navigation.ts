/** Genuine read destinations after Today has resolved a current, complete reference. */
import type { TodayReviewRow, TodayDayEvent, TodayAttentionResolved, TodayPreparedTiles } from './today-engine.ts';
import type { UiContext } from '../host/contracts.ts';
import type { EffectGuard } from '../host/retained-controller.ts';
import type { LessonReviewView } from '../host/retained-contracts.ts';
import { validateLessonReviewList } from '../host/retained-contracts.ts';
import { projectCalculationReceipt, ReplyValidationError } from './validate.ts';
import type { CalculationReceiptEvidence } from './presentation.ts';
import { checkedToday, detachToday, freezeToday, sameToday, todayArray, todayChoice, todayDigest, todayHash, todayId, todayInteger, todayObject, todayRecord, todayText, todayUnion, todayLiteral } from './today-engine.ts';
import type { TodayCheck, TodayEnginePayloads, TodayJson } from './today-engine.ts';

export interface TodayNavigationPayloads {
  'actions.list': Record<string, never>;
  'jobs.list': Record<string, never>;
  'decisions.list': Record<string, never>;
  'sources.list': Record<string, never>;
  'learning.list': Record<string, never>;
  'activity.list': Record<string, never>;
  'memory.lessons': Record<string, never>;
  'receipts.get': { readonly id: string };
}
export interface TodayReadPort {
  guarded<M extends keyof (TodayEnginePayloads & TodayNavigationPayloads)>(method: M, payload: (TodayEnginePayloads & TodayNavigationPayloads)[M], guard: EffectGuard): Promise<unknown>;
}
export interface TodayDetail {
  readonly kind: 'action' | 'job' | 'lesson' | 'receipt' | 'tile' | 'import' | 'import-refusal' | 'decision' | 'alert-episode' | 'compliance-entry' | 'reviewed-compliance-calendar' | 'activity';
  readonly title: string;
  readonly record: TodayJson;
  readonly receiptIds: readonly string[];
  readonly receipt?: CalculationReceiptEvidence;
  readonly lesson?: LessonReviewView;
}
const invalid = (): never => { throw new ReplyValidationError('today.destination'); };
const bool: TodayCheck<boolean> = (value: unknown): value is boolean => typeof value === 'boolean';
const positive: TodayCheck<number> = (value: unknown): value is number => todayInteger(value) && value > 0;
const instant: TodayCheck<string> = (value: unknown): value is string => todayText(value) && Number.isFinite(Date.parse(value));
const minor: TodayCheck<string> = (value: unknown): value is string => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && value.length <= 1000;
const json: TodayCheck<TodayJson> = (value: unknown): value is TodayJson => value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(json) || todayRecord(value) && Object.values(value).every(json);
const jsonRecord: TodayCheck<{ [key: string]: TodayJson }> = (value: unknown): value is { [key: string]: TodayJson } => todayRecord(value) && Object.values(value).every(json);
const role = todayChoice('owner', 'cofounder', 'accountant', 'viewer');
const result = todayObject({}, { externalId: todayText, data: json, businessSuccess: bool });
const readback = todayObject({ verified: bool, businessSuccess: bool }, { data: json, externalId: todayText, absent: bool });
const attempt = todayObject({ id: todayId, startedAt: instant, outcome: todayChoice('executing', 'verified', 'unknown', 'rejected') }, { finishedAt: instant, error: todayText, result, readback });
const action = todayObject({ id: todayId, connector: todayId, operation: todayId, payload: jsonRecord, sourceIds: todayArray(todayId, 64), idempotencyKey: todayText, digest: todayHash, revision: positive, createdBy: todayId, createdEpoch: positive, createdAt: instant, impact: todayChoice('reversible', 'message', 'money', 'destructive'), status: todayChoice('prepared', 'approved', 'executing', 'verified', 'unknown', 'rejected', 'blocked', 'cancelled'), attempts: todayArray(attempt) }, { approval: todayObject({ memberId: todayId, role, epoch: positive, digest: todayHash, revision: positive, workspaceRevision: todayInteger, at: instant }), result, readback, businessSuccess: bool, blockedReason: todayText });
const job = todayObject({ id: todayId, goal: todayText, ownerId: todayId, ownerEpoch: positive, ownerRole: role, budgetMinor: minor, reserveMinor: minor, spentMinor: minor, reservedMinor: minor, stopRule: todayObject({ maxRuns: positive, deadline: instant }), nextRunAt: instant, intervalMs: todayInteger, catchup: todayChoice('skip', 'latest'), graceMs: todayInteger, requiresApproval: bool, sourceIds: todayArray(todayId, 64), revision: positive, digest: todayHash, runs: todayInteger, fence: todayInteger, status: todayChoice('scheduled', 'running', 'paused', 'revoked', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait', 'outcome-unknown', 'cancelled', 'stopped', 'awaiting-acceptance', 'accepted'), createdAt: instant, ledger: todayArray(todayObject({ at: instant, event: todayText }, { fence: todayInteger, amountMinor: minor, reason: todayText })) }, { calendar: jsonRecord, input: json, plan: jsonRecord, limits: jsonRecord, allowedActions: todayArray(todayText), testedRoutes: todayArray(todayText), background: bool, execution: jsonRecord, archivedExecutions: todayArray(jsonRecord), type: todayText, scheduleAnchor: instant, lease: todayObject({ token: todayText, workerId: todayText, fence: todayInteger, expiresAt: instant, reservedMinor: minor, chargedMinor: minor }), deliverable: json, approval: todayObject({ digest: todayHash, revision: positive, memberId: todayId, epoch: positive, role }) });
const recordList = todayArray(jsonRecord);
const ids = (record: Record<string, unknown>): readonly string[] => {
  if (record.receiptIds === undefined) return Object.freeze([]);
  return checkedToday(record.receiptIds, todayArray(todayId));
};
function detail(kind: TodayDetail['kind'], title: string, record: unknown, receipts: readonly string[] = []): TodayDetail {
  return freezeToday({ kind, title, record: detachToday(record), receiptIds: [...receipts] });
}
/** Disclose the released capture, including unavailable values and their gaps. */
export function openTodayTile(tile: TodayPreparedTiles['result']['tiles'][number]): TodayDetail {
  const values = [tile.value, ...tile.points.map(point => point.value), ...(tile.comparison ? [tile.comparison.value] : [])];
  return detail('tile', tile.label, tile, [...new Set(values.flatMap(value => value.receiptId === null ? [] : [value.receiptId]))]);
}
/** Only this known legacy field may be undefined before IPC serialization.
 * Preserve descriptors so hostile accessors still fail without being invoked. */
function nativeRecords(raw: unknown, optionalKey: 'expectedTotals' | 'providerRequestId'): unknown {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || Object.getOwnPropertySymbols(raw).length !== 0) return invalid();
  const copied: unknown[] = [];
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    let released = descriptor;
    if (key !== 'length' && Object.hasOwn(descriptor, 'value')) {
      const item: unknown = descriptor.value;
      if (item !== null && typeof item === 'object' && Object.getPrototypeOf(item) === Object.prototype && Object.getOwnPropertySymbols(item).length === 0) {
        const fields = Object.getOwnPropertyDescriptors(item), optional = fields[optionalKey];
        if (optional && Object.hasOwn(optional, 'value') && optional.value === undefined && optional.enumerable) {
          delete fields[optionalKey];
          const record: Record<string, unknown> = {};
          Object.defineProperties(record, fields);
          released = { ...descriptor, value: record };
        }
      }
    }
    Object.defineProperty(copied, key, released);
  }
  return copied;
}
function live(guard: EffectGuard) { if (!guard.live()) throw Object.assign(new Error('READ_INVALIDATED'), { code: 'READ_INVALIDATED' }); }
async function actionRead(port: TodayReadPort, guard: EffectGuard, id: string, pin?: { revision: number; digest: string }): Promise<TodayDetail> {
  const rows = checkedToday(await port.guarded('actions.list', {}, guard), todayArray(action)); live(guard);
  const matches = rows.filter(row => row.id === id); if (matches.length !== 1) return invalid();
  const current = matches[0]!; if (pin && (current.revision !== pin.revision || current.digest !== pin.digest)) return invalid();
  return detail('action', `${current.connector} · ${current.operation}`, current);
}
async function jobRead(port: TodayReadPort, guard: EffectGuard, id: string, pin?: { revision: number; digest: string; deliverableDigest?: string }): Promise<TodayDetail> {
  const rows = checkedToday(await port.guarded('jobs.list', {}, guard), todayArray(job)); live(guard);
  const matches = rows.filter(row => row.id === id); if (matches.length !== 1) return invalid();
  const current = matches[0]!;
  if (pin && (current.revision !== pin.revision || current.digest !== pin.digest)) return invalid();
  if (pin?.deliverableDigest) { if (!Object.hasOwn(current, 'deliverable') || await todayDigest(current.deliverable, true) !== pin.deliverableDigest) return invalid(); live(guard); }
  return detail('job', current.goal, current);
}
export async function openTodayReview(row: TodayReviewRow, port: TodayReadPort, guard: EffectGuard, context: UiContext): Promise<TodayDetail> {
  const ref = row.reference;
  if (ref.kind === 'action-approval') return actionRead(port, guard, ref.id, ref);
  if (ref.kind === 'job-approval' || ref.kind === 'job-acceptance') return jobRead(port, guard, ref.id, ref);
  if (ref.kind !== 'lesson-decision') return invalid();
  const lessons = validateLessonReviewList(await port.guarded('memory.lessons', {}, guard), context); live(guard);
  const matches = lessons.filter(view => view.candidate.id === ref.id); if (matches.length !== 1) return invalid();
  const current = matches[0]!;
  if (current.candidate.revision !== ref.revision || current.candidate.digest !== ref.digest || current.review?.id !== ref.reviewId || current.review?.digest !== ref.reviewDigest || current.evaluation?.digest !== ref.evaluationDigest) return invalid();
  return freezeToday({ ...detail('lesson', row.title, current), lesson: current });
}
export async function openTodayReceipt(id: string, port: TodayReadPort, guard: EffectGuard): Promise<TodayDetail> {
  const receipt = projectCalculationReceipt(await port.guarded('receipts.get', { id }, guard)); live(guard);
  if (receipt.id !== id) return invalid();
  return freezeToday({ ...detail('receipt', id, receipt, [id]), receipt });
}
export async function openTodayEvent(reference: TodayDayEvent['reference'], port: TodayReadPort, guard: EffectGuard): Promise<TodayDetail> {
  if (reference.kind === 'receipt') return openTodayReceipt(reference.receiptId, port, guard);
  if (reference.kind === 'action') return actionRead(port, guard, reference.actionId);
  if (reference.kind === 'job-delivery') return jobRead(port, guard, reference.jobId);
  if (reference.kind === 'decision') {
    const rows = checkedToday(await port.guarded('decisions.list', {}, guard), recordList); live(guard);
    const matches = rows.filter(row => row.id === reference.decisionId); if (matches.length !== 1) return invalid();
    const current = matches[0]!; if (!todayText(current.text) || !todayId(current.id) || !todayText(current.status) || !Array.isArray(current.reviews)) return invalid();
    return detail('decision', current.text, current, ids(current));
  }
  if (reference.kind === 'import') {
    const rows = checkedToday(nativeRecords(await port.guarded('sources.list', {}, guard), 'expectedTotals'), recordList); live(guard);
    const matches = rows.filter(row => row.id === reference.importId && row.sourceId === reference.sourceId); if (matches.length !== 1) return invalid();
    const current = matches[0]!; if (!todayText(current.format) || !todayHash(current.contentHash) || !todayHash(current.recipeHash) || !Array.isArray(current.rowIds)) return invalid();
    return detail('import', reference.sourceId, current);
  }
  const rows = checkedToday(await port.guarded('learning.list', {}, guard), recordList); live(guard);
  const matches = rows.filter(row => row.id === reference.learningEventId && row.type === 'decision'); if (matches.length !== 1) return invalid();
  const current = matches[0]!;
  if (!todayRecord(current.importIdentity) || current.importIdentity.outcome !== 'rejected' || current.importIdentity.qualification !== 'experimental' || !todayId(current.importIdentity.sourceId) || !todayRecord(current.input) || !todayText(current.input.reasonCode) || !todayHash(current.recordIntegrity)) return invalid();
  return detail('import-refusal', current.importIdentity.sourceId, current);
}
export function openTodayAttention(value: TodayAttentionResolved): TodayDetail {
  if (value.reference.kind === 'alert-episode' && 'episode' in value) return detail('alert-episode', value.label, value, value.receiptIds);
  if (value.reference.kind === 'decision' && 'text' in value) return detail('decision', value.text, value, value.receiptIds);
  if (value.reference.kind === 'compliance-entry' && 'title' in value) return detail('compliance-entry', value.title, value);
  if (value.reference.kind === 'reviewed-compliance-calendar') return detail('reviewed-compliance-calendar', value.reference.calendarId, value);
  return invalid();
}
export async function openTodayActivity(port: TodayReadPort, guard: EffectGuard, context: UiContext): Promise<TodayDetail> {
  if (context.member.role !== 'owner' && context.member.role !== 'cofounder') return invalid();
  const raw = await port.guarded('activity.list', {}, guard); live(guard);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw) || Object.getPrototypeOf(raw) !== Object.prototype || Object.getOwnPropertySymbols(raw).length !== 0) return invalid();
  const fields = Object.getOwnPropertyDescriptors(raw), receipts = fields.modelReceipts;
  if (!receipts || !Object.hasOwn(receipts, 'value')) return invalid();
  const normalized: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(fields)) Object.defineProperty(normalized, key, key === 'modelReceipts' ? { ...descriptor, value: nativeRecords(receipts.value, 'providerRequestId') } : descriptor);
  const records = detachToday(normalized, true);
  const shape = todayObject({ items: todayArray(jsonRecord, 200), modelReceipts: todayArray(jsonRecord) });
  if (!shape(records)) return invalid();
  return freezeToday({ kind: 'activity', title: 'activity', record: records, receiptIds: [] });
}
