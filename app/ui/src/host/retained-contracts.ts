/**
 * Frontend-serialized projections of the retained scenario and reviewed lesson contracts.
 *
 * Source mapping (type-only; no Engine runtime is imported into the browser):
 *   ScenarioView, ScenarioRevision, ScenarioJobState, ScenarioRunResult, ScenarioComparison
 *     platform/runtime/scenario-contracts.ts (`scenarios.reopen` reply)
 *   ScenarioDiscoveryRequest, ScenarioDiscoveryRow, ScenarioDiscoveryPage
 *     platform/runtime/scenario-contracts.ts (`scenarios.discover` request and reply); the
 *     request bounds are engine-scenarios.ts `discoveryRequest` (default 25, integer 1..50,
 *     cursor an opaque lower-case 64-hex token), the label bound is scenario-service.ts `label`
 *   receipt scope/assumption fields  platform/runtime/calculator.ts receipt creation
 *   LessonView, LessonCandidate, LessonEvaluationBinding, LessonReview, LessonDecision
 *     platform/runtime/lesson-contracts.ts (`memory.lessons`, `memory.decideLesson`)
 *   released evidence rules          platform/runtime/lesson-evidence.ts `resolved`/`names`
 *   candidate/evaluation rules       platform/runtime/lessons.ts `proposal`, `evaluationValid`, `evaluations`, `passes`
 *
 * Every validator consumes an unknown reply, refuses accessors, prototypes, symbols,
 * sparse arrays, undefined members and unknown keys at the exact declared boundaries, and
 * returns a frozen detached projection. Identities, digests, dates, source markings and
 * qualification words are retained exactly; nothing is calculated, ranked or defaulted.
 * The relationship checks here refuse malformed or inconsistent consumed replies only;
 * digests are Engine-issued pins and are never recomputed here. The host-only
 * ScenarioEvidence.state never appears in a released view and is refused.
 */
import type { ReadFailureCode } from '../bridge/contract.ts';
import type { CalculationReceiptEvidence, EngineFigureEvidence } from '../bridge/presentation.ts';
import { readFailureCode } from '../bridge/client.ts';
import { ReplyValidationError, assertISOInstant, projectCalculationReceipt } from '../bridge/validate.ts';
import type { UiContext } from './contracts.ts';

/* ---------- Scenario projections ---------- */

/** An exact pin: supplied by the trusted host, or projected from the exact checked discovery row a
 * person chose. Never a label, a snapshot, a typed-in identity or a substituted head. */
export interface ScenarioSelection { readonly scenarioId: string; readonly revisionId: string }
export type ScenarioReopenRequest = ScenarioSelection;
/** The only declared discovery parameters: a plain page size and the opaque issued continuation. */
export interface ScenarioDiscoveryRequest { readonly limit?: number; readonly cursor?: string }
/** One released historical revision, exactly as `scenarios.discover` describes it: display label,
 * clock-written creation instant, revision kind, graph readiness and whether it was the head at
 * release. No figure, receipt, freshness, owner, count or action is part of this projection. */
export interface ScenarioDiscoveryRow {
  readonly scenarioId: string;
  readonly revisionId: string;
  readonly label: string;
  readonly createdAt: string;
  readonly revisionMode: RetainedScenarioRevisionMode;
  readonly status: 'partial' | 'complete';
  /** Descriptive at release only; it never chooses a row and never replaces `revisionId`. */
  readonly isHead: boolean;
  readonly noAction: true;
}
export interface ScenarioDiscoveryPage {
  readonly mode: 'retained-revisions';
  /** In Engine order (newest first, exact identities breaking ties), at most the issued limit. */
  readonly items: readonly ScenarioDiscoveryRow[];
  /** Opaque and bound to current authority; present only while another authorized row remains. */
  readonly nextCursor: string | null;
  readonly noAction: true;
}
export interface RetainedPeriod { readonly from: string; readonly to: string }
/** CalculationRequest as retained by a scenario job: declared calculator parameters only. */
export interface RetainedCalculationRequest {
  readonly operation: string;
  readonly sourceIds?: readonly string[];
  readonly period?: RetainedPeriod;
  readonly asOf?: string;
  readonly branch?: string;
  readonly customerId?: string;
  readonly orderId?: string;
  readonly comparePeriod?: RetainedPeriod;
  readonly onDate?: string;
  readonly assumptions?: { readonly priceChangeBps: string };
}
export interface RetainedScenarioBranch {
  readonly id: string;
  readonly label: string;
  readonly role: 'baseline' | 'alternative';
  readonly assumptionRevisionId: string;
  readonly priceChangeBps: string;
  readonly rootJobId: string;
}
export interface RetainedScenarioJob {
  readonly id: string;
  readonly branchId: string;
  readonly label: string;
  readonly dependsOn: readonly string[];
  readonly usesBranchAssumptions: boolean;
  readonly request: RetainedCalculationRequest;
  readonly authoredRequest: RetainedCalculationRequest;
  readonly authoredRequestDigest: string;
  readonly requestDigest: string;
  readonly inputDigest: string;
}
export type RetainedScenarioRevisionMode = 'initial' | 'assumption-change' | 'graph-change' | 'current-state-recompute';
export interface RetainedScenarioRevision {
  readonly id: string;
  readonly scenarioId: string;
  readonly parentRevisionId: string | null;
  readonly mode: RetainedScenarioRevisionMode;
  readonly createdAt: string;
  readonly evidenceId: string;
  readonly evidenceDigest: string;
  readonly branches: readonly RetainedScenarioBranch[];
  readonly jobs: readonly RetainedScenarioJob[];
  readonly digest: string;
}
export type RetainedScenarioJobStatus = 'pending' | 'stale' | 'running' | 'ready';
export interface RetainedScenarioJobState {
  readonly jobId: string;
  readonly status: RetainedScenarioJobStatus;
  readonly runId?: string;
  readonly activeRunId?: string;
  readonly retainedRunId?: string;
  readonly reusedFromRevisionId?: string;
}
/** An embedded private receipt. It is not a global `receipts.get` record. */
export interface RetainedScenarioResult {
  readonly runId: string;
  readonly runDigest: string;
  readonly receipt: CalculationReceiptEvidence;
  readonly receiptDigest: string;
  readonly digest: string;
}
export interface RetainedScenarioRequiredJob {
  readonly jobId: string;
  readonly branchId: string;
  readonly requestDigest: string;
  readonly inputDigest: string;
  readonly runId: string;
  /** The revision the run was issued in. With reuse this is an opaque retained pin that may
   * predate the immediate `reusedFromRevisionId`; it is never required to equal it. */
  readonly runRevisionId: string;
  readonly receiptId: string;
  readonly receiptDigest: string;
  readonly reusedFromRevisionId: string | null;
}
export interface RetainedScenarioComparison {
  readonly id: string;
  readonly scenarioId: string;
  readonly revisionId: string;
  readonly revisionDigest: string;
  readonly evidenceId: string;
  readonly evidenceDigest: string;
  readonly createdAt: string;
  readonly requiredJobs: readonly RetainedScenarioRequiredJob[];
  readonly noAction: true;
  readonly limitations: readonly string[];
  readonly digest: string;
}
export interface RetainedScenarioView {
  readonly scenarioId: string;
  readonly headRevisionId: string;
  readonly mode: 'retained-revision';
  readonly revision: RetainedScenarioRevision;
  readonly jobs: readonly RetainedScenarioJobState[];
  readonly status: 'partial' | 'complete';
  readonly results: readonly RetainedScenarioResult[];
  readonly comparisons: readonly RetainedScenarioComparison[];
  readonly noAction: true;
}

/* ---------- Lesson projections ---------- */

export type LessonRole = UiContext['member']['role'];
export interface LessonActorPin { readonly memberId: string; readonly role: LessonRole; readonly epoch: number }
export interface LessonPin { readonly id: string; readonly revision: number; readonly digest: string }
export type LessonValue = null | boolean | number | string | readonly LessonValue[] | { readonly [key: string]: LessonValue };
export type LessonChangeKind = 'personal-preference' | 'reminder-timing' | 'shortlist-order';
export interface LessonEvidencePin {
  readonly kind: 'job' | 'calculation';
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
  readonly sourceIds: readonly string[];
  readonly branchIds: readonly string[];
}
/** Released evidence is always current, available and explicitly untainted; a view saying otherwise is malformed. */
export interface LessonEvidenceView {
  readonly pin: LessonEvidencePin;
  readonly available: true;
  readonly sourceTainted: false;
  readonly sourceMarkings: readonly { readonly sourceId: string; readonly marking: string }[];
  readonly summary: string;
}
export interface LessonTargetView {
  readonly kind: LessonChangeKind;
  readonly id: string;
  readonly revision: string;
  readonly digest: string;
  readonly owner: LessonActorPin;
  readonly value: LessonValue;
}
export interface LessonCandidateView {
  readonly kind: 'candidate-lesson';
  readonly workspaceId: string;
  readonly id: string;
  readonly revision: number;
  readonly digest: string;
  readonly owner: LessonActorPin;
  readonly proposedBy: LessonActorPin;
  readonly proposedAt: string;
  readonly episodeIds: readonly string[];
  readonly title: string;
  readonly rationale: string;
  readonly evidence: readonly LessonEvidenceView[];
  readonly change: { readonly kind: LessonChangeKind; readonly targetId: string; readonly before: LessonValue; readonly after: LessonValue };
  readonly applicability: { readonly memberId: string; readonly branchIds: readonly string[]; readonly sourceIds: readonly string[]; readonly conditions: Readonly<Record<string, string>> };
  readonly counterexamples: readonly { readonly conditions: Readonly<Record<string, string>>; readonly reason: string }[];
  readonly supersedes?: LessonPin;
  readonly target: LessonTargetView;
}
export interface LessonArtifactPin { readonly id: string; readonly revision: string; readonly digest: string }
export type LessonEvaluationQualification = 'synthetic-protocol' | 'owner-qualified';
export type LessonEvaluationStatus = 'complete' | 'incomplete' | 'declined';
export interface LessonEvaluationSummary {
  readonly reference: LessonArtifactPin;
  readonly set: 'open' | 'hidden';
  readonly candidate: LessonPin;
  readonly authorityId: string;
  readonly qualification: LessonEvaluationQualification;
  readonly suite: LessonArtifactPin;
  readonly harness: LessonArtifactPin;
  readonly build: LessonArtifactPin;
  readonly configuration: LessonArtifactPin;
  readonly comparisonId: string;
  /** Authority-written; any finite timestamp the Engine contract admits, retained byte for byte. */
  readonly completedAt: string;
  readonly status: LessonEvaluationStatus;
  readonly baseline: { readonly guidance: 'off'; readonly digest: string };
  readonly treatment: { readonly guidance: 'on'; readonly candidate: LessonPin };
  /** Authority-supplied names, directions and paired numbers. No outcome is derived here. */
  readonly metrics: readonly { readonly name: string; readonly direction: 'higher-is-better' | 'lower-is-better'; readonly before: number; readonly after: number }[];
  readonly sourceTainted: boolean;
  readonly sourceIds: readonly string[];
}
export interface LessonEvaluationView { readonly candidate: LessonPin; readonly open: LessonEvaluationSummary; readonly hidden: LessonEvaluationSummary; readonly digest: string }
export interface LessonReviewToken { readonly id: string; readonly candidate: LessonPin; readonly evaluationDigest: string; readonly reviewer: LessonActorPin; readonly at: string; readonly digest: string }
export type LessonStatus = 'proposed' | 'evaluation-blocked' | 'review-ready' | 'approved' | 'rejected' | 'deferred' | 'retired' | 'superseded';
export interface LessonReviewView { readonly candidate: LessonCandidateView; readonly status: LessonStatus; readonly evaluation?: LessonEvaluationView; readonly review?: LessonReviewToken }
/** Only the two approved RP-04 controls. Reject exists in the protocol but is not offered here. */
export type LessonHumanDecision = 'approve' | 'defer';
/** What one human press names: the exact candidate, review and evaluation that were on the screen. */
export interface LessonDecisionIntent {
  readonly candidate: LessonPin;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly evaluationDigest: string;
  readonly decision: LessonHumanDecision;
}
export interface LessonDecisionRequest {
  readonly candidate: LessonPin;
  readonly reviewId: string;
  readonly reviewDigest: string;
  readonly decision: LessonHumanDecision;
  readonly reason: string;
}

/* ---------- Validation primitives ---------- */

function invalid(path: string): never { throw new ReplyValidationError(path); }
const HEX64 = /^[a-f0-9]{64}$/;
const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length) invalid(path);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) invalid(path);
  }
  return value as Record<string, unknown>;
}
function exact(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = record(value, path);
  if (required.some(key => !Object.hasOwn(obj, key)) || Object.keys(obj).some(key => !required.includes(key) && !optional.includes(key))) invalid(path);
  return obj;
}
function list(value: unknown, path: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum || Object.getOwnPropertySymbols(value).length) invalid(path);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) invalid(path);
  for (let i = 0; i < value.length; i++) {
    const descriptor = descriptors[String(i)];
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value') || descriptor.value === undefined) invalid(path);
  }
  return value;
}
function text(value: unknown, path: string, maximum = 8000, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && value.trim().length === 0) || CONTROL.test(value)) invalid(path);
  return value;
}
function identity(value: unknown, path: string): string { const id = text(value, path, 200); if (!IDENTITY.test(id)) invalid(path); return id; }
function hex(value: unknown, path: string): string { if (typeof value !== 'string' || !HEX64.test(value)) invalid(path); return value; }
/** A clock-written ISO instant (Engine `now()` / scenario `#clock()` always write `toISOString()`). */
function instant(value: unknown, path: string): string { assertISOInstant(value, path); return value; }
/** An authority-written timestamp: the Engine contract admits any finite `Date.parse` value,
 * including a date-only string. The bytes are retained; nothing is normalised or given a zone. */
function timestamp(value: unknown, path: string): string {
  const out = text(value, path, 200);
  if (!Number.isFinite(Date.parse(out))) invalid(path);
  return out;
}
function boolean(value: unknown, path: string): boolean { if (typeof value !== 'boolean') invalid(path); return value; }
function choice<T extends string>(value: unknown, path: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.some(item => item === value)) invalid(path);
  return value as T;
}
function identities(value: unknown, path: string, maximum: number): readonly string[] {
  const ids = list(value, path, maximum).map((item, index) => identity(item, `${path}[${index}]`));
  if (new Set(ids).size !== ids.length) invalid(path);
  return ids;
}
/** Nonempty, bounded, nonblank, strictly ascending names: lesson-evidence.ts `names` and lessons.ts `strings`. */
function sortedNames(value: unknown, path: string, maximum = 256): readonly string[] {
  const names = list(value, path, maximum).map((item, index) => text(item, `${path}[${index}]`, 200));
  if (names.length === 0) invalid(path);
  for (let index = 1; index < names.length; index++) {
    const previous = names[index - 1], current = names[index];
    if (previous === undefined || current === undefined || !(previous < current)) invalid(path);
  }
  return names;
}
function integerString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length > 256 || !/^-?\d+$/.test(value)) invalid(path);
  return value;
}
function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => same(item, b[index]));
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
/** Bounded plain JSON for source-written values (lesson before/after/target values). */
function jsonValue(value: unknown, path: string, depth = 0): LessonValue {
  if (depth > 12) invalid(path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') return text(value, path, 100000, true);
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(path); return value; }
  if (Array.isArray(value)) return list(value, path, 10000).map((item, index) => jsonValue(item, `${path}[${index}]`, depth + 1));
  const obj = record(value, path);
  if (Object.keys(obj).length > 1000) invalid(path);
  const out: Record<string, LessonValue> = {};
  for (const [key, item] of Object.entries(obj)) out[key] = jsonValue(item, `${path}.${key}`, depth + 1);
  return out;
}
/** Explicit, nonempty condition maps with nonblank keys and values (lessons.ts `conditions`). */
function conditions(value: unknown, path: string): Readonly<Record<string, string>> {
  const obj = record(value, path), out: Record<string, string> = {};
  const entries = Object.entries(obj);
  if (entries.length === 0 || entries.length > 1000) invalid(path);
  for (const [key, item] of entries) { text(key, `${path}.key`, 200); out[key] = text(item, `${path}.${key}`, 2000); }
  return out;
}

/* ---------- Scenario validators ---------- */

export function validateScenarioSelection(value: unknown): ScenarioSelection {
  const obj = exact(value, 'scenario.selection', ['scenarioId', 'revisionId']);
  return freeze({ scenarioId: identity(obj.scenarioId, 'scenario.selection.scenarioId'), revisionId: identity(obj.revisionId, 'scenario.selection.revisionId') });
}
function period(value: unknown, path: string): RetainedPeriod {
  const obj = exact(value, path, ['from', 'to']);
  const from = text(obj.from, `${path}.from`, 10), to = text(obj.to, `${path}.to`, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) invalid(path);
  return { from, to };
}
const requestKeys = ['sourceIds', 'period', 'asOf', 'branch', 'customerId', 'orderId', 'comparePeriod', 'onDate', 'assumptions'] as const;
function calculationRequest(value: unknown, path: string): RetainedCalculationRequest {
  const obj = exact(value, path, ['operation'], requestKeys);
  const out: { -readonly [K in keyof RetainedCalculationRequest]: RetainedCalculationRequest[K] } = { operation: identity(obj.operation, `${path}.operation`) };
  if (Object.hasOwn(obj, 'sourceIds')) {
    const ids = list(obj.sourceIds, `${path}.sourceIds`, 64).map((item, index) => { const id = text(item, `${path}.sourceIds[${index}]`, 200); if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(id)) invalid(`${path}.sourceIds[${index}]`); return id; });
    if (new Set(ids).size !== ids.length) invalid(`${path}.sourceIds`);
    out.sourceIds = ids;
  }
  if (Object.hasOwn(obj, 'period')) out.period = period(obj.period, `${path}.period`);
  if (Object.hasOwn(obj, 'comparePeriod')) out.comparePeriod = period(obj.comparePeriod, `${path}.comparePeriod`);
  for (const key of ['asOf', 'branch', 'customerId', 'orderId', 'onDate'] as const) if (Object.hasOwn(obj, key)) out[key] = text(obj[key], `${path}.${key}`, 200);
  // The producer admits a knowledge cut only as a finite timestamp (scenario-service.ts requestValid).
  if (out.asOf !== undefined && !Number.isFinite(Date.parse(out.asOf))) invalid(`${path}.asOf`);
  if (Object.hasOwn(obj, 'assumptions')) {
    const assumptions = exact(obj.assumptions, `${path}.assumptions`, ['priceChangeBps']);
    out.assumptions = { priceChangeBps: integerString(assumptions.priceChangeBps, `${path}.assumptions.priceChangeBps`) };
  }
  return out;
}
function branch(value: unknown, path: string): RetainedScenarioBranch {
  const obj = exact(value, path, ['id', 'label', 'role', 'assumptionRevisionId', 'priceChangeBps', 'rootJobId']);
  return {
    id: identity(obj.id, `${path}.id`), label: text(obj.label, `${path}.label`, 200), role: choice(obj.role, `${path}.role`, ['baseline', 'alternative']),
    assumptionRevisionId: identity(obj.assumptionRevisionId, `${path}.assumptionRevisionId`), priceChangeBps: integerString(obj.priceChangeBps, `${path}.priceChangeBps`),
    rootJobId: identity(obj.rootJobId, `${path}.rootJobId`),
  };
}
function job(value: unknown, path: string): RetainedScenarioJob {
  const obj = exact(value, path, ['id', 'branchId', 'label', 'dependsOn', 'usesBranchAssumptions', 'request', 'authoredRequest', 'authoredRequestDigest', 'requestDigest', 'inputDigest']);
  const out: RetainedScenarioJob = {
    id: identity(obj.id, `${path}.id`), branchId: identity(obj.branchId, `${path}.branchId`), label: text(obj.label, `${path}.label`, 200),
    dependsOn: identities(obj.dependsOn, `${path}.dependsOn`, 1000), usesBranchAssumptions: boolean(obj.usesBranchAssumptions, `${path}.usesBranchAssumptions`),
    request: calculationRequest(obj.request, `${path}.request`), authoredRequest: calculationRequest(obj.authoredRequest, `${path}.authoredRequest`),
    authoredRequestDigest: hex(obj.authoredRequestDigest, `${path}.authoredRequestDigest`), requestDigest: hex(obj.requestDigest, `${path}.requestDigest`), inputDigest: hex(obj.inputDigest, `${path}.inputDigest`),
  };
  // A pinned job request always carries the retained knowledge cut (scenario-service.ts `job`).
  if (out.request.asOf === undefined) invalid(`${path}.request.asOf`);
  // A job that uses its branch assumption must carry that exact assumption text in its request.
  if (out.usesBranchAssumptions && out.request.assumptions === undefined) invalid(`${path}.request.assumptions`);
  return out;
}
function revision(value: unknown, path: string): RetainedScenarioRevision {
  const obj = exact(value, path, ['id', 'scenarioId', 'parentRevisionId', 'mode', 'createdAt', 'evidenceId', 'evidenceDigest', 'branches', 'jobs', 'digest']);
  const branches = list(obj.branches, `${path}.branches`, 200).map((item, index) => branch(item, `${path}.branches[${index}]`));
  const jobs = list(obj.jobs, `${path}.jobs`, 1000).map((item, index) => job(item, `${path}.jobs[${index}]`));
  if (branches.length === 0 || new Set(branches.map(item => item.id)).size !== branches.length) invalid(`${path}.branches`);
  if (branches.filter(item => item.role === 'baseline').length !== 1) invalid(`${path}.branches`);
  const baseline = branches.find(item => item.role === 'baseline');
  if (baseline === undefined || !/^-?0+$/.test(baseline.priceChangeBps)) invalid(`${path}.branches.baseline`);
  if (jobs.length === 0 || new Set(jobs.map(item => item.id)).size !== jobs.length) invalid(`${path}.jobs`);
  for (const item of branches) {
    const root = jobs.find(candidate => candidate.id === item.rootJobId);
    if (root === undefined || root.branchId !== item.id) invalid(`${path}.branches.rootJobId`);
  }
  for (const item of jobs) {
    const owner = branches.find(candidate => candidate.id === item.branchId);
    if (owner === undefined) invalid(`${path}.jobs.branchId`);
    if (item.usesBranchAssumptions && item.request.assumptions?.priceChangeBps !== owner.priceChangeBps) invalid(`${path}.jobs.assumption`);
    for (const dependency of item.dependsOn) {
      const predecessor = jobs.find(candidate => candidate.id === dependency);
      if (predecessor === undefined || predecessor.branchId !== item.branchId || predecessor.id === item.id) invalid(`${path}.jobs.dependsOn`);
    }
  }
  return {
    id: identity(obj.id, `${path}.id`), scenarioId: identity(obj.scenarioId, `${path}.scenarioId`),
    parentRevisionId: obj.parentRevisionId === null ? null : identity(obj.parentRevisionId, `${path}.parentRevisionId`),
    mode: choice(obj.mode, `${path}.mode`, ['initial', 'assumption-change', 'graph-change', 'current-state-recompute']),
    createdAt: instant(obj.createdAt, `${path}.createdAt`), evidenceId: identity(obj.evidenceId, `${path}.evidenceId`), evidenceDigest: hex(obj.evidenceDigest, `${path}.evidenceDigest`),
    branches, jobs, digest: hex(obj.digest, `${path}.digest`),
  };
}
function jobState(value: unknown, path: string): RetainedScenarioJobState {
  const obj = exact(value, path, ['jobId', 'status'], ['runId', 'activeRunId', 'retainedRunId', 'reusedFromRevisionId']);
  const out: { -readonly [K in keyof RetainedScenarioJobState]: RetainedScenarioJobState[K] } = {
    jobId: identity(obj.jobId, `${path}.jobId`), status: choice(obj.status, `${path}.status`, ['pending', 'stale', 'running', 'ready']),
  };
  for (const key of ['runId', 'activeRunId', 'retainedRunId', 'reusedFromRevisionId'] as const) if (Object.hasOwn(obj, key)) out[key] = identity(obj[key], `${path}.${key}`);
  // A ready job names its exact run; a job that is not ready has no current run.
  if (out.status === 'ready' ? out.runId === undefined : out.runId !== undefined) invalid(`${path}.runId`);
  if (out.status !== 'running' && out.activeRunId !== undefined) invalid(`${path}.activeRunId`);
  return out;
}
function result(value: unknown, path: string): RetainedScenarioResult {
  const obj = exact(value, path, ['runId', 'runDigest', 'receipt', 'receiptDigest', 'digest']);
  return {
    runId: identity(obj.runId, `${path}.runId`), runDigest: hex(obj.runDigest, `${path}.runDigest`),
    receipt: projectCalculationReceipt(obj.receipt), receiptDigest: hex(obj.receiptDigest, `${path}.receiptDigest`), digest: hex(obj.digest, `${path}.digest`),
  };
}
/**
 * The embedded receipt of a ready job must carry the exact scope its declared request names:
 * operation, event period, comparison period, branch, normalised knowledge cut, the explicit
 * requested source selection (omitted and empty stay distinct), the integer meaning of the
 * branch price assumption (calculator.ts writes the canonical integer text; authored text is kept)
 * and, when the receipt itself declares an aging date, that exact date: calculator.ts writes
 * `request.onDate ?? asOf.slice(0, 10)` into `assumptions.onDate` for an aging operation only,
 * where that `asOf` is the selection's knowledge cut already normalised to UTC (memory.ts
 * `selectFacts`), so the default date is the UTC calendar date of the cut, not the first ten
 * bytes of however the receipt spells the same instant. The issued bytes are retained as issued;
 * only this guard's expected default is derived from the normalised instant. A receipt that
 * declares no aging date is a non-aging operation; its request's onDate, if any, was ignored by
 * the calculator and is not held against it. Receipt headers the calculator does not write
 * (customer, order) are not invented here.
 */
function boundResult(declared: RetainedScenarioJob, current: RetainedScenarioResult, path: string): void {
  const request = declared.request, receipt = current.receipt;
  if (receipt.operation !== request.operation) invalid(`${path}.operation`);
  if (!same(receipt.period, request.period ?? null) || !same(receipt.comparePeriod, request.comparePeriod ?? null) || receipt.branch !== (request.branch ?? null)) invalid(`${path}.scope`);
  if (request.asOf !== undefined && Date.parse(receipt.asOf) !== Date.parse(request.asOf)) invalid(`${path}.asOf`);
  if (request.sourceIds === undefined ? receipt.requestedSourceIds !== undefined : !same(receipt.requestedSourceIds, request.sourceIds)) invalid(`${path}.requestedSourceIds`);
  const assumed = request.assumptions?.priceChangeBps;
  const retained: unknown = Object.hasOwn(receipt.assumptions, 'priceChangeBps') ? receipt.assumptions['priceChangeBps'] : undefined;
  if (assumed === undefined ? retained !== undefined : typeof retained !== 'string' || !/^-?\d+$/.test(retained) || BigInt(retained) !== BigInt(assumed)) invalid(`${path}.assumptions`);
  if (Object.hasOwn(receipt.assumptions, 'onDate')) {
    const issued: unknown = receipt.assumptions['onDate'];
    const expected = request.onDate ?? new Date(Date.parse(receipt.asOf)).toISOString().slice(0, 10);
    if (issued !== expected) invalid(`${path}.assumptions.onDate`);
  }
}
function comparison(value: unknown, path: string): RetainedScenarioComparison {
  const obj = exact(value, path, ['id', 'scenarioId', 'revisionId', 'revisionDigest', 'evidenceId', 'evidenceDigest', 'createdAt', 'requiredJobs', 'noAction', 'limitations', 'digest']);
  if (obj.noAction !== true) invalid(`${path}.noAction`);
  const requiredJobs = list(obj.requiredJobs, `${path}.requiredJobs`, 1000).map((item, index) => {
    const p = `${path}.requiredJobs[${index}]`;
    const required = exact(item, p, ['jobId', 'branchId', 'requestDigest', 'inputDigest', 'runId', 'runRevisionId', 'receiptId', 'receiptDigest', 'reusedFromRevisionId']);
    return {
      jobId: identity(required.jobId, `${p}.jobId`), branchId: identity(required.branchId, `${p}.branchId`), requestDigest: hex(required.requestDigest, `${p}.requestDigest`),
      inputDigest: hex(required.inputDigest, `${p}.inputDigest`), runId: identity(required.runId, `${p}.runId`), runRevisionId: identity(required.runRevisionId, `${p}.runRevisionId`),
      receiptId: identity(required.receiptId, `${p}.receiptId`), receiptDigest: hex(required.receiptDigest, `${p}.receiptDigest`),
      reusedFromRevisionId: required.reusedFromRevisionId === null ? null : identity(required.reusedFromRevisionId, `${p}.reusedFromRevisionId`),
    };
  });
  if (new Set(requiredJobs.map(item => item.jobId)).size !== requiredJobs.length) invalid(`${path}.requiredJobs`);
  return {
    id: identity(obj.id, `${path}.id`), scenarioId: identity(obj.scenarioId, `${path}.scenarioId`), revisionId: identity(obj.revisionId, `${path}.revisionId`),
    revisionDigest: hex(obj.revisionDigest, `${path}.revisionDigest`), evidenceId: identity(obj.evidenceId, `${path}.evidenceId`), evidenceDigest: hex(obj.evidenceDigest, `${path}.evidenceDigest`),
    createdAt: instant(obj.createdAt, `${path}.createdAt`), requiredJobs, noAction: true,
    limitations: list(obj.limitations, `${path}.limitations`, 100).map((item, index) => text(item, `${path}.limitations[${index}]`, 2000)), digest: hex(obj.digest, `${path}.digest`),
  };
}

/** The exact `scenarios.reopen` reply for the exact requested pin. */
export function validateRetainedScenarioView(value: unknown, requested: ScenarioSelection): RetainedScenarioView {
  const path = 'scenario.view';
  const obj = exact(value, path, ['scenarioId', 'headRevisionId', 'mode', 'revision', 'jobs', 'status', 'results', 'comparisons', 'noAction']);
  if (obj.mode !== 'retained-revision' || obj.noAction !== true) invalid(path);
  const scenarioId = identity(obj.scenarioId, `${path}.scenarioId`), headRevisionId = identity(obj.headRevisionId, `${path}.headRevisionId`);
  const rev = revision(obj.revision, `${path}.revision`);
  // The reply must be for the exact pinned scenario and immutable revision; labels cannot rescue a mismatch.
  if (scenarioId !== requested.scenarioId || rev.id !== requested.revisionId || rev.scenarioId !== scenarioId) invalid(`${path}.identity`);
  const jobs = list(obj.jobs, `${path}.jobs`, 1000).map((item, index) => jobState(item, `${path}.jobs[${index}]`));
  if (jobs.length !== rev.jobs.length || new Set(jobs.map(item => item.jobId)).size !== jobs.length || jobs.some(item => !rev.jobs.some(declared => declared.id === item.jobId))) invalid(`${path}.jobs`);
  // Every run is issued for one job and owned by that job's evaluation slot alone: no run identity
  // may be claimed by two jobs, nor twice by one job (scenario-service.ts beginRun/evaluate/#append).
  const owners = new Set<string>();
  for (const state of jobs) {
    for (const runId of [state.runId, state.activeRunId, state.retainedRunId]) {
      if (runId === undefined) continue;
      if (owners.has(runId)) invalid(`${path}.jobs.runOwnership`);
      owners.add(runId);
    }
  }
  const status = choice(obj.status, `${path}.status`, ['partial', 'complete']);
  if ((status === 'complete') !== jobs.every(item => item.status === 'ready')) invalid(`${path}.status`);
  const results = list(obj.results, `${path}.results`, 1000).map((item, index) => result(item, `${path}.results[${index}]`));
  if (new Set(results.map(item => item.runId)).size !== results.length) invalid(`${path}.results`);
  // Every calculation issues its own receipt identity (calculator.ts) and a result is reused only for
  // the same run (scenario-service.ts evaluate): two distinct results never share an embedded receipt
  // id, so a chart mark that names a receipt can only ever resolve to one exact run.
  if (new Set(results.map(item => item.receipt.id)).size !== results.length) invalid(`${path}.results.receiptId`);
  const referencedRuns = new Set(jobs.flatMap(item => [item.runId, item.retainedRunId].filter((id): id is string => id !== undefined)));
  if (results.some(item => !referencedRuns.has(item.runId))) invalid(`${path}.results.runId`);
  for (const state of jobs) {
    if (state.status !== 'ready') continue;
    const declared = rev.jobs.find(item => item.id === state.jobId), current = results.find(item => item.runId === state.runId);
    // A ready job without its exact embedded result is not displayable as ready.
    if (declared === undefined || current === undefined) invalid(`${path}.results.binding`);
    boundResult(declared, current, `${path}.results.binding`);
  }
  const comparisons = list(obj.comparisons, `${path}.comparisons`, 100).map((item, index) => comparison(item, `${path}.comparisons[${index}]`));
  if (new Set(comparisons.map(item => item.id)).size !== comparisons.length) invalid(`${path}.comparisons`);
  for (const item of comparisons) {
    // A comparison is released only when every required pin names this exact revision vector.
    if (item.scenarioId !== scenarioId || item.revisionId !== rev.id || item.revisionDigest !== rev.digest || item.evidenceId !== rev.evidenceId || item.evidenceDigest !== rev.evidenceDigest) invalid(`${path}.comparisons.revision`);
    if (item.requiredJobs.length !== rev.jobs.length) invalid(`${path}.comparisons.requiredJobs`);
    for (const required of item.requiredJobs) {
      const declared = rev.jobs.find(candidate => candidate.id === required.jobId), state = jobs.find(candidate => candidate.jobId === required.jobId);
      const current = results.find(candidate => candidate.runId === required.runId);
      if (declared === undefined || state === undefined || current === undefined || state.status !== 'ready' || state.runId !== required.runId
        || declared.branchId !== required.branchId || declared.requestDigest !== required.requestDigest || declared.inputDigest !== required.inputDigest
        || current.receipt.id !== required.receiptId || current.receiptDigest !== required.receiptDigest
        || (state.reusedFromRevisionId ?? null) !== required.reusedFromRevisionId) invalid(`${path}.comparisons.requiredJobs`);
      // A run with no reuse marker originates in the selected revision. A reused run keeps its
      // original revision as an opaque pin that may predate the immediate parent; no equality is required.
      if (required.reusedFromRevisionId === null && required.runRevisionId !== rev.id) invalid(`${path}.comparisons.runRevisionId`);
    }
  }
  return freeze({ scenarioId, headRevisionId, mode: 'retained-revision', revision: rev, jobs, status, results, comparisons, noAction: true });
}

/** The viewed revision is historical when the Engine head has advanced past it. */
export function isHistoricalRevision(view: RetainedScenarioView): boolean { return view.revision.id !== view.headRevisionId; }

/* ---------- Scenario discovery ---------- */

/** The producer's declared request bounds (engine-scenarios.ts `discoveryRequest`). */
export const SCENARIO_DISCOVERY_DEFAULT_LIMIT = 25;
export const SCENARIO_DISCOVERY_MAX_LIMIT = 50;
/** The consistent bounded request this interface issues: five released rows at rest, in Engine order,
 * every further row reachable only through the exact issued continuation. A transport bound, not a total. */
export const SCENARIO_PAGE_SIZE = 5;
/** The at-rest window that holds `index` of the rows read so far, or the last existing window. */
export function scenarioPageOf(index: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / SCENARIO_PAGE_SIZE) - 1);
  return Math.min(Math.max(0, Math.floor(index / SCENARIO_PAGE_SIZE)), last);
}
/** The exact outbound `scenarios.discover` payload: declared plain data only. An absent cursor is omitted,
 * never sent as null; a cursor is sent byte for byte as issued, never derived, repaired or lower-cased. */
export function scenarioDiscoveryRequest(input: { readonly limit?: number; readonly cursor?: string | null }): ScenarioDiscoveryRequest {
  const limit = input.limit ?? SCENARIO_DISCOVERY_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > SCENARIO_DISCOVERY_MAX_LIMIT) invalid('scenarios.discover.limit');
  if (input.cursor === undefined || input.cursor === null) return freeze({ limit });
  return freeze({ limit, cursor: hex(input.cursor, 'scenarios.discover.cursor') });
}
/**
 * The producer's own label rule, nothing stricter (scenario-service.ts `label` and `dataOnly`, released
 * verbatim by `describe`): any string that is not blank and holds at most 200 code units. A label is
 * display text only; it never identifies a row, so no character class of its own is refused here. The
 * shared `text()` control-character rule belongs to the other validators and is deliberately not applied.
 */
function producerLabel(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) invalid(path);
  return value;
}
function discoveryRow(value: unknown, path: string): ScenarioDiscoveryRow {
  const obj = exact(value, path, ['scenarioId', 'revisionId', 'label', 'createdAt', 'revisionMode', 'status', 'isHead', 'noAction']);
  if (obj.noAction !== true) invalid(`${path}.noAction`);
  return {
    scenarioId: identity(obj.scenarioId, `${path}.scenarioId`), revisionId: identity(obj.revisionId, `${path}.revisionId`),
    label: producerLabel(obj.label, `${path}.label`), createdAt: instant(obj.createdAt, `${path}.createdAt`),
    revisionMode: choice(obj.revisionMode, `${path}.revisionMode`, ['initial', 'assumption-change', 'graph-change', 'current-state-recompute']),
    status: choice(obj.status, `${path}.status`, ['partial', 'complete']), isHead: boolean(obj.isHead, `${path}.isHead`), noAction: true,
  };
}
const rowKey = (row: ScenarioSelection) => JSON.stringify([row.scenarioId, row.revisionId]);
/**
 * The exact `scenarios.discover` reply for the exact issued request: a complete checked page or nothing.
 * Rows are kept in Engine order with their labels, instants, kinds, readiness and head descriptions byte for
 * byte; a page longer than the issued limit, a repeated revision, a malformed row, an unknown key or a
 * malformed continuation refuses the whole page before any label is released.
 */
export function validateScenarioDiscoveryPage(value: unknown, request: ScenarioDiscoveryRequest): ScenarioDiscoveryPage {
  const path = 'scenarios.discover';
  const limit = request.limit ?? SCENARIO_DISCOVERY_DEFAULT_LIMIT;
  const obj = exact(value, path, ['mode', 'items', 'nextCursor', 'noAction']);
  if (obj.mode !== 'retained-revisions' || obj.noAction !== true) invalid(path);
  const items = list(obj.items, `${path}.items`, limit).map((item, index) => discoveryRow(item, `${path}.items[${index}]`));
  if (new Set(items.map(rowKey)).size !== items.length) invalid(`${path}.items`);
  const nextCursor = obj.nextCursor === null ? null : hex(obj.nextCursor, `${path}.nextCursor`);
  return freeze({ mode: 'retained-revisions', items, nextCursor, noAction: true });
}
/** The rows read so far followed by a continuation page; a revision released twice is not a continuation. */
export function joinDiscoveryRows(previous: readonly ScenarioDiscoveryRow[], page: ScenarioDiscoveryPage): readonly ScenarioDiscoveryRow[] {
  const rows = [...previous, ...page.items];
  if (new Set(rows.map(rowKey)).size !== rows.length) invalid('scenarios.discover.items.repeated');
  return Object.freeze(rows);
}
/** Exactly the two identities of a checked row, detached: what a human choice carries into `scenarios.reopen`. */
export function discoveryRowSelection(row: ScenarioDiscoveryRow): ScenarioSelection { return freeze({ scenarioId: row.scenarioId, revisionId: row.revisionId }); }
export function sameScenarioSelection(a: ScenarioSelection | null, b: ScenarioSelection | null): boolean {
  return a === b || (a !== null && b !== null && a.scenarioId === b.scenarioId && a.revisionId === b.revisionId);
}
/** The exact checked row that carries both pins, if it is on this list; a label never identifies a row. */
export function discoveryRowFor(rows: readonly ScenarioDiscoveryRow[], selection: ScenarioSelection): ScenarioDiscoveryRow | undefined {
  return rows.find(row => row.scenarioId === selection.scenarioId && row.revisionId === selection.revisionId);
}

export interface ScenarioColumnEntry {
  readonly job: RetainedScenarioJob;
  readonly state: RetainedScenarioJobState;
  /** Only a ready job's exact current run result. Retained old runs never appear here. */
  readonly result: RetainedScenarioResult | null;
}
export interface ScenarioColumn { readonly branch: RetainedScenarioBranch; readonly entries: readonly ScenarioColumnEntry[] }
/** One column per branch, the baseline first; display order follows the retained revision. */
export function scenarioColumns(view: RetainedScenarioView): readonly ScenarioColumn[] {
  const ordered = [...view.revision.branches].sort((a, b) => (a.role === 'baseline' ? 0 : 1) - (b.role === 'baseline' ? 0 : 1));
  return ordered.map(item => ({
    branch: item,
    entries: view.revision.jobs.filter(candidate => candidate.branchId === item.id).map(candidate => {
      const state = view.jobs.find(found => found.jobId === candidate.id);
      if (state === undefined) throw new ReplyValidationError('scenario.view.jobs');
      const current = state.status === 'ready' ? view.results.find(found => found.runId === state.runId) ?? null : null;
      return { job: candidate, state, result: current };
    }),
  }));
}
/** The issued figure key of the price-scenario calculator's outcome (calculator.ts emits
 * baseline, scenario, change and priceChangeBps in that order; the first is the unchanged measured baseline). */
export const SCENARIO_OUTCOME_KEY = 'scenario';
/** The issued scenario outcome of a ready analysis that uses its branch assumption, exactly as the
 * embedded receipt states it; null when the receipt holds no such issued figure. Nothing is derived. */
export function scenarioOutcomeFigure(entry: ScenarioColumnEntry): EngineFigureEvidence | null {
  if (entry.result === null || !entry.job.usesBranchAssumptions) return null;
  return entry.result.receipt.figures.find(item => item.key === SCENARIO_OUTCOME_KEY) ?? null;
}
/** The proof behind a displayed figure: the exact embedded result and its run/job/receipt relationship. */
export interface ScenarioProof {
  readonly view: RetainedScenarioView;
  readonly branch: RetainedScenarioBranch;
  readonly baseline: RetainedScenarioBranch;
  readonly job: RetainedScenarioJob;
  readonly state: RetainedScenarioJobState;
  readonly result: RetainedScenarioResult;
}
export function scenarioProof(view: RetainedScenarioView, runId: string): ScenarioProof | null {
  const state = view.jobs.find(item => item.status === 'ready' && item.runId === runId);
  const result = view.results.find(item => item.runId === runId);
  const job = state === undefined ? undefined : view.revision.jobs.find(item => item.id === state.jobId);
  const branch = job === undefined ? undefined : view.revision.branches.find(item => item.id === job.branchId);
  const baseline = view.revision.branches.find(item => item.role === 'baseline');
  if (state === undefined || result === undefined || job === undefined || branch === undefined || baseline === undefined) return null;
  return { view, branch, baseline, job, state, result };
}

/* ---------- Lesson validators ---------- */

const roles: readonly LessonRole[] = ['owner', 'cofounder', 'accountant', 'viewer'];
function actor(value: unknown, path: string): LessonActorPin {
  const obj = exact(value, path, ['memberId', 'role', 'epoch']);
  if (!Number.isSafeInteger(obj.epoch) || (obj.epoch as number) < 1) invalid(`${path}.epoch`);
  return { memberId: identity(obj.memberId, `${path}.memberId`), role: choice(obj.role, `${path}.role`, roles), epoch: obj.epoch as number };
}
function pin(value: unknown, path: string): LessonPin {
  const obj = exact(value, path, ['id', 'revision', 'digest']);
  if (!Number.isSafeInteger(obj.revision) || (obj.revision as number) < 1) invalid(`${path}.revision`);
  return { id: identity(obj.id, `${path}.id`), revision: obj.revision as number, digest: hex(obj.digest, `${path}.digest`) };
}
function artifact(value: unknown, path: string): LessonArtifactPin {
  const obj = exact(value, path, ['id', 'revision', 'digest']);
  return { id: text(obj.id, `${path}.id`, 200), revision: text(obj.revision, `${path}.revision`, 200), digest: hex(obj.digest, `${path}.digest`) };
}
const changeKinds: readonly LessonChangeKind[] = ['personal-preference', 'reminder-timing', 'shortlist-order'];
/** Released lesson evidence exactly as lesson-evidence.ts `resolved` admits it: available, explicitly
 * untainted, with one ordered nonblank marking per pinned source and a bounded nonblank summary. */
function evidence(value: unknown, path: string): LessonEvidenceView {
  const obj = exact(value, path, ['pin', 'available', 'sourceTainted', 'sourceMarkings', 'summary']);
  const pinObj = exact(obj.pin, `${path}.pin`, ['kind', 'id', 'revision', 'digest', 'sourceIds', 'branchIds']);
  const evidencePin: LessonEvidencePin = {
    kind: choice(pinObj.kind, `${path}.pin.kind`, ['job', 'calculation']), id: text(pinObj.id, `${path}.pin.id`, 200), revision: text(pinObj.revision, `${path}.pin.revision`, 200),
    digest: hex(pinObj.digest, `${path}.pin.digest`), sourceIds: sortedNames(pinObj.sourceIds, `${path}.pin.sourceIds`), branchIds: sortedNames(pinObj.branchIds, `${path}.pin.branchIds`),
  };
  if (obj.available !== true) invalid(`${path}.available`);
  if (obj.sourceTainted !== false) invalid(`${path}.sourceTainted`);
  const sourceMarkings = list(obj.sourceMarkings, `${path}.sourceMarkings`, 256).map((item, index) => {
    const marking = exact(item, `${path}.sourceMarkings[${index}]`, ['sourceId', 'marking']);
    return { sourceId: text(marking.sourceId, `${path}.sourceMarkings[${index}].sourceId`, 200), marking: text(marking.marking, `${path}.sourceMarkings[${index}].marking`, 2000) };
  });
  if (sourceMarkings.length !== evidencePin.sourceIds.length || sourceMarkings.some((item, index) => item.sourceId !== evidencePin.sourceIds[index])) invalid(`${path}.sourceMarkings`);
  return { pin: evidencePin, available: true, sourceTainted: false, sourceMarkings, summary: text(obj.summary, `${path}.summary`, 20000) };
}
function target(value: unknown, path: string): LessonTargetView {
  const obj = exact(value, path, ['kind', 'id', 'revision', 'digest', 'owner', 'value']);
  return {
    kind: choice(obj.kind, `${path}.kind`, changeKinds), id: text(obj.id, `${path}.id`, 200), revision: text(obj.revision, `${path}.revision`, 200),
    digest: hex(obj.digest, `${path}.digest`), owner: actor(obj.owner, `${path}.owner`), value: jsonValue(obj.value, `${path}.value`),
  };
}
function candidate(value: unknown, path: string): LessonCandidateView {
  const obj = exact(value, path, ['kind', 'workspaceId', 'id', 'revision', 'digest', 'owner', 'proposedBy', 'proposedAt', 'episodeIds', 'title', 'rationale', 'evidence', 'change', 'applicability', 'counterexamples', 'target'], ['supersedes']);
  if (obj.kind !== 'candidate-lesson') invalid(`${path}.kind`);
  if (!Number.isSafeInteger(obj.revision) || (obj.revision as number) < 1) invalid(`${path}.revision`);
  const change = exact(obj.change, `${path}.change`, ['kind', 'targetId', 'before', 'after']);
  const applicability = exact(obj.applicability, `${path}.applicability`, ['memberId', 'branchIds', 'sourceIds', 'conditions']);
  const items = list(obj.evidence, `${path}.evidence`, 256).map((item, index) => evidence(item, `${path}.evidence[${index}]`));
  // A candidate is formed only from a nonempty list of distinct evidence references (lesson-evidence.ts `references`).
  if (items.length === 0 || new Set(items.map(item => `${item.pin.kind}:${item.pin.id}`)).size !== items.length) invalid(`${path}.evidence`);
  const out: { -readonly [K in keyof LessonCandidateView]: LessonCandidateView[K] } = {
    kind: 'candidate-lesson', workspaceId: identity(obj.workspaceId, `${path}.workspaceId`), id: identity(obj.id, `${path}.id`), revision: obj.revision as number, digest: hex(obj.digest, `${path}.digest`),
    owner: actor(obj.owner, `${path}.owner`), proposedBy: actor(obj.proposedBy, `${path}.proposedBy`), proposedAt: instant(obj.proposedAt, `${path}.proposedAt`),
    episodeIds: identities(obj.episodeIds, `${path}.episodeIds`, 256), title: text(obj.title, `${path}.title`, 2000), rationale: text(obj.rationale, `${path}.rationale`, 100000),
    evidence: items,
    change: { kind: choice(change.kind, `${path}.change.kind`, changeKinds), targetId: text(change.targetId, `${path}.change.targetId`, 200), before: jsonValue(change.before, `${path}.change.before`), after: jsonValue(change.after, `${path}.change.after`) },
    // Applicability is the union over every captured evidence pin (lessons.ts `proposal`): each pin is
    // bounded at 256 names, so the aggregate is bounded by the checked pin count times that per-pin limit.
    applicability: { memberId: identity(applicability.memberId, `${path}.applicability.memberId`), branchIds: sortedNames(applicability.branchIds, `${path}.applicability.branchIds`, items.length * 256), sourceIds: sortedNames(applicability.sourceIds, `${path}.applicability.sourceIds`, items.length * 256), conditions: conditions(applicability.conditions, `${path}.applicability.conditions`) },
    counterexamples: list(obj.counterexamples, `${path}.counterexamples`, 1000).map((item, index) => {
      const counterexample = exact(item, `${path}.counterexamples[${index}]`, ['conditions', 'reason']);
      return { conditions: conditions(counterexample.conditions, `${path}.counterexamples[${index}].conditions`), reason: text(counterexample.reason, `${path}.counterexamples[${index}].reason`, 100000) };
    }),
    target: target(obj.target, `${path}.target`),
  };
  if (Object.hasOwn(obj, 'supersedes')) out.supersedes = pin(obj.supersedes, `${path}.supersedes`);
  // One sealed episode is recorded per captured evidence item (lessons.ts `proposal`).
  if (out.episodeIds.length !== out.evidence.length) invalid(`${path}.episodeIds`);
  // Scoped counterexamples are declared, never empty.
  if (out.counterexamples.length === 0) invalid(`${path}.counterexamples`);
  // Personal applicability stays within the exact evidence sources and named branches of its pinned owner.
  const sourceUnion = [...new Set(out.evidence.flatMap(item => item.pin.sourceIds))].sort();
  const branchUnion = new Set(out.evidence.flatMap(item => item.pin.branchIds));
  if (!same(out.applicability.sourceIds, sourceUnion) || out.applicability.branchIds.some(item => item === '*' || !branchUnion.has(item))) invalid(`${path}.applicability`);
  if (out.applicability.memberId !== out.owner.memberId) invalid(`${path}.applicability.memberId`);
  // The target and the change name the same configured personal guidance kind and identity, owned by the candidate's pinned owner.
  if (out.target.kind !== out.change.kind || out.target.id !== out.change.targetId || !same(out.target.owner, out.owner)) invalid(`${path}.target`);
  // A lesson shows an exact change; without a supersession pin its before value is the pinned configured value.
  if (same(out.change.before, out.change.after)) invalid(`${path}.change`);
  if (out.supersedes === undefined && !same(out.change.before, out.target.value)) invalid(`${path}.change.before`);
  return out;
}
function evaluationSummary(value: unknown, path: string, set: 'open' | 'hidden', lesson: LessonPin): LessonEvaluationSummary {
  const obj = exact(value, path, ['reference', 'set', 'candidate', 'authorityId', 'qualification', 'suite', 'harness', 'build', 'configuration', 'comparisonId', 'completedAt', 'status', 'baseline', 'treatment', 'metrics', 'sourceTainted', 'sourceIds']);
  const baseline = exact(obj.baseline, `${path}.baseline`, ['guidance', 'digest']), treatment = exact(obj.treatment, `${path}.treatment`, ['guidance', 'candidate']);
  if (baseline.guidance !== 'off' || treatment.guidance !== 'on') invalid(`${path}.guidance`);
  const out: LessonEvaluationSummary = {
    reference: artifact(obj.reference, `${path}.reference`), set: choice(obj.set, `${path}.set`, ['open', 'hidden']), candidate: pin(obj.candidate, `${path}.candidate`),
    authorityId: text(obj.authorityId, `${path}.authorityId`, 200), qualification: choice(obj.qualification, `${path}.qualification`, ['synthetic-protocol', 'owner-qualified']),
    suite: artifact(obj.suite, `${path}.suite`), harness: artifact(obj.harness, `${path}.harness`), build: artifact(obj.build, `${path}.build`), configuration: artifact(obj.configuration, `${path}.configuration`),
    comparisonId: text(obj.comparisonId, `${path}.comparisonId`, 200), completedAt: timestamp(obj.completedAt, `${path}.completedAt`), status: choice(obj.status, `${path}.status`, ['complete', 'incomplete', 'declined']),
    baseline: { guidance: 'off', digest: hex(baseline.digest, `${path}.baseline.digest`) }, treatment: { guidance: 'on', candidate: pin(treatment.candidate, `${path}.treatment.candidate`) },
    metrics: list(obj.metrics, `${path}.metrics`, 1000).map((item, index) => {
      const metric = exact(item, `${path}.metrics[${index}]`, ['name', 'direction', 'before', 'after']);
      if (typeof metric.before !== 'number' || !Number.isFinite(metric.before) || typeof metric.after !== 'number' || !Number.isFinite(metric.after)) invalid(`${path}.metrics[${index}]`);
      return { name: text(metric.name, `${path}.metrics[${index}].name`, 200), direction: choice(metric.direction, `${path}.metrics[${index}].direction`, ['higher-is-better', 'lower-is-better']), before: metric.before, after: metric.after };
    }),
    sourceTainted: boolean(obj.sourceTainted, `${path}.sourceTainted`), sourceIds: sortedNames(obj.sourceIds, `${path}.sourceIds`, 10000),
  };
  if (out.set !== set || !same(out.candidate, lesson) || !same(out.treatment.candidate, lesson)) invalid(`${path}.candidate`);
  if (new Set(out.metrics.map(item => item.name)).size !== out.metrics.length) invalid(`${path}.metrics`);
  // A complete run always carries its paired metrics (lessons.ts `evaluationValid`).
  if (out.status === 'complete' && out.metrics.length === 0) invalid(`${path}.metrics`);
  return out;
}
function evaluation(value: unknown, path: string, lesson: LessonPin): LessonEvaluationView {
  const obj = exact(value, path, ['candidate', 'open', 'hidden', 'digest']);
  const out: LessonEvaluationView = {
    candidate: pin(obj.candidate, `${path}.candidate`), open: evaluationSummary(obj.open, `${path}.open`, 'open', lesson), hidden: evaluationSummary(obj.hidden, `${path}.hidden`, 'hidden', lesson), digest: hex(obj.digest, `${path}.digest`),
  };
  if (!same(out.candidate, lesson)) invalid(`${path}.candidate`);
  return out;
}
function review(value: unknown, path: string, lesson: LessonPin): LessonReviewToken {
  const obj = exact(value, path, ['id', 'candidate', 'evaluationDigest', 'reviewer', 'at', 'digest']);
  const out: LessonReviewToken = {
    id: identity(obj.id, `${path}.id`), candidate: pin(obj.candidate, `${path}.candidate`), evaluationDigest: hex(obj.evaluationDigest, `${path}.evaluationDigest`),
    reviewer: actor(obj.reviewer, `${path}.reviewer`), at: instant(obj.at, `${path}.at`), digest: hex(obj.digest, `${path}.digest`),
  };
  if (!same(out.candidate, lesson)) invalid(`${path}.candidate`);
  return out;
}
export const lessonPin = (view: LessonCandidateView): LessonPin => ({ id: view.id, revision: view.revision, digest: view.digest });
export function validateLessonReviewView(value: unknown, path = 'lesson.view'): LessonReviewView {
  const obj = exact(value, path, ['candidate', 'status'], ['evaluation', 'review']);
  const lesson = candidate(obj.candidate, `${path}.candidate`), lessonKey = lessonPin(lesson);
  const out: { -readonly [K in keyof LessonReviewView]: LessonReviewView[K] } = {
    candidate: lesson, status: choice(obj.status, `${path}.status`, ['proposed', 'evaluation-blocked', 'review-ready', 'approved', 'rejected', 'deferred', 'retired', 'superseded']),
  };
  if (Object.hasOwn(obj, 'evaluation')) out.evaluation = evaluation(obj.evaluation, `${path}.evaluation`, lessonKey);
  if (Object.hasOwn(obj, 'review')) {
    out.review = review(obj.review, `${path}.review`, lessonKey);
    // A review token is bound to the exact evaluation it was issued for.
    if (out.evaluation === undefined || out.review.evaluationDigest !== out.evaluation.digest) invalid(`${path}.review.evaluationDigest`);
  }
  // Review-ready and approved views are always evaluation-bound in the source protocol.
  if ((out.status === 'review-ready' || out.status === 'approved') && out.evaluation === undefined) invalid(`${path}.evaluation`);
  return freeze(out);
}
/** The exact actor pin of the trusted host context: the member, role and permission epoch the Engine checks. */
export const lessonActor = (context: UiContext): LessonActorPin => ({ memberId: context.member.id, role: context.member.role, epoch: context.member.epoch });
/**
 * Whether a released row could have been released to this exact trusted context. lessons.ts
 * `access` admits a row only for its own workspace and its pinned owner's exact member, role and
 * epoch, and `lessons` suppresses every other row before release; a reply carrying a row for another
 * workspace or owner is therefore not a releasable list and none of its private prose is published.
 */
export function lessonReleasedFor(view: LessonReviewView, context: UiContext): boolean {
  return view.candidate.workspaceId === context.workspace.id && same(view.candidate.owner, lessonActor(context));
}
/** The exact `memory.lessons` reply for this exact trusted context: currently released active views, in Engine order. */
export function validateLessonReviewList(value: unknown, context: UiContext): readonly LessonReviewView[] {
  const views = list(value, 'memory.lessons', 1000).map((item, index) => validateLessonReviewView(item, `memory.lessons[${index}]`));
  if (new Set(views.map(item => item.candidate.id)).size !== views.length) invalid('memory.lessons');
  views.forEach((item, index) => { if (!lessonReleasedFor(item, context)) invalid(`memory.lessons[${index}].release`); });
  return freeze(views);
}
/** At most five released rows at rest (RP-04); every further row is reachable one page at a time, in Engine order. */
export const LESSON_PAGE_SIZE = 5;
/** The page that holds `index` of a list, or the last existing page when the index is out of range. */
export function lessonPageOf(index: number, total: number): number {
  const last = Math.max(0, Math.ceil(total / LESSON_PAGE_SIZE) - 1);
  return Math.min(Math.max(0, Math.floor(index / LESSON_PAGE_SIZE)), last);
}

export type LessonDecisionBlock = 'status' | 'evaluation' | 'review' | 'reviewer' | 'role' | 'workspace';
export type LessonDecisionAvailability = { readonly ok: true } | { readonly ok: false; readonly block: LessonDecisionBlock };
/**
 * Whether the supplied open/hidden pair is a complete, consistent, nonregressing evaluation as
 * the Engine releases it (lessons.ts `evaluations` and `passes`): both runs complete with paired
 * metrics, untainted, from the same comparison, baseline, build, configuration and qualification,
 * and no paired metric contradicting its authority-supplied direction. This is a refusal guard on
 * supplied values only; no delta, score, ranking or outcome is derived from it.
 */
function evaluationPairComplete(bound: LessonEvaluationView): boolean {
  const { open, hidden } = bound;
  return [open, hidden].every(item => item.status === 'complete' && item.metrics.length > 0 && !item.sourceTainted
    && item.metrics.every(metric => metric.direction === 'higher-is-better' ? metric.after >= metric.before : metric.after <= metric.before))
    && open.comparisonId === hidden.comparisonId && open.baseline.digest === hidden.baseline.digest && open.qualification === hidden.qualification
    && same(open.build, hidden.build) && same(open.configuration, hidden.configuration);
}
/**
 * Whether Approve / Not now may be offered. This mirrors the Engine's preconditions without
 * deciding anything itself: a genuine current review token bound to a complete consistent
 * evaluation pair on a review-ready candidate of this workspace, whose owner, target owner,
 * applicable member and reviewer are all the current approving member under the trusted host
 * context. Nothing here grants a role, infers ownership or mints a token; the Engine remains
 * the final authority on submission.
 */
export function lessonDecisionAvailability(view: LessonReviewView, context: UiContext): LessonDecisionAvailability {
  const current = lessonActor(context);
  if (context.member.role !== 'owner' && context.member.role !== 'cofounder') return { ok: false, block: 'role' };
  if (view.candidate.workspaceId !== context.workspace.id) return { ok: false, block: 'workspace' };
  if (view.status !== 'review-ready') return { ok: false, block: 'status' };
  const bound = view.evaluation;
  if (bound === undefined || !evaluationPairComplete(bound)) return { ok: false, block: 'evaluation' };
  if (view.review === undefined || view.review.evaluationDigest !== bound.digest || !same(view.review.candidate, lessonPin(view.candidate))) return { ok: false, block: 'review' };
  if (!same(view.review.reviewer, current) || !same(view.candidate.owner, current) || !same(view.candidate.target.owner, current)
    || view.candidate.applicability.memberId !== current.memberId) return { ok: false, block: 'reviewer' };
  return { ok: true };
}
/** A human-entered reason: nonempty after trimming, bounded, plain text, never autofilled. */
export const REASON_MAX_LENGTH = 4000;
export function humanReason(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > REASON_MAX_LENGTH || CONTROL.test(value)) return null;
  return value;
}
/** The exact outbound `memory.decideLesson` payload for a displayed review that the press named exactly. */
export function lessonDecisionRequest(view: LessonReviewView, intent: LessonDecisionIntent, reason: string): LessonDecisionRequest {
  if (view.review === undefined || view.evaluation === undefined || humanReason(reason) === null || (intent.decision !== 'approve' && intent.decision !== 'defer')
    || !same(lessonPin(view.candidate), intent.candidate) || view.review.id !== intent.reviewId || view.review.digest !== intent.reviewDigest
    || view.evaluation.digest !== intent.evaluationDigest) throw new ReplyValidationError('memory.decideLesson.request');
  return freeze({ candidate: lessonPin(view.candidate), reviewId: view.review.id, reviewDigest: view.review.digest, decision: intent.decision, reason });
}
/**
 * The decision reply must be the displayed candidate, evaluation and the exact submitted review,
 * unchanged, in the status this decision produces (lessons.ts `decideLesson` releases the same
 * reviewed view after appending the decision). Anything else is an uncertain reply.
 */
export function validateLessonDecisionReply(value: unknown, request: LessonDecisionRequest, displayed: LessonReviewView): LessonReviewView {
  const view = validateLessonReviewView(value, 'memory.decideLesson');
  if (view.status !== (request.decision === 'approve' ? 'approved' : 'deferred') || view.review === undefined || view.evaluation === undefined
    || view.review.id !== request.reviewId || view.review.digest !== request.reviewDigest || !same(lessonPin(view.candidate), request.candidate)
    || !same(view.candidate, displayed.candidate) || !same(view.evaluation, displayed.evaluation) || !same(view.review, displayed.review)) invalid('memory.decideLesson.binding');
  return view;
}
/** Exact structural equality of two checked projections, used for preflight re-reads. */
export function sameProjection(a: unknown, b: unknown): boolean { return same(a, b); }

/* ---------- Bounded failure mapping ---------- */

const scenarioCodes = [
  'SCENARIO_UNAVAILABLE', 'SCENARIO_REVISION_UNAVAILABLE', 'SCENARIO_EVIDENCE_UNAVAILABLE', 'SCENARIO_FORBIDDEN', 'SCENARIO_AUTHORITY_CHANGED',
  'SCENARIO_ARTIFACT_CHANGED', 'SCENARIO_RETENTION_EXPIRED', 'SCENARIO_HOST_REQUIRED', 'SCENARIO_CUSTODY_INVALID', 'SCENARIO_CUSTODY_CONFLICT',
  'SCENARIO_TAINTED_CONTEXT', 'SCENARIO_WORKSPACE_CHANGED', 'SCENARIO_RUN_UNAVAILABLE', 'SCENARIO_READ_ONLY', 'SCENARIO_HEAD_CHANGED',
  'SCENARIO_JOB_UNAVAILABLE', 'SCENARIO_BRANCH_UNAVAILABLE', 'SCENARIO_GRAPH_INVALID', 'SCENARIO_VECTOR_MISMATCH', 'INVALID_SCENARIO',
] as const;
const lessonCodes = [
  'LESSON_AUTHORITY_REQUIRED', 'LESSON_AUTHORITIES_REQUIRED', 'LESSON_AUTHORITY_REVISION_REQUIRED', 'LESSON_AUTHORITY_CHANGED', 'LESSON_REVIEW_CHANGED',
  'LESSON_EVALUATION_BLOCKED', 'EVALUATION_AUTHORITY_REQUIRED', 'EVALUATION_CHANGED', 'EVALUATION_CANDIDATE_MISMATCH', 'EVALUATION_PROVENANCE_REQUIRED',
  'EVALUATION_COMPARISON_MISMATCH', 'INVALID_LESSON_EVALUATION', 'LESSON_EVIDENCE_UNAVAILABLE', 'LESSON_EVIDENCE_CHANGED', 'LESSON_TARGET_CHANGED',
  'LESSON_OWNER_REQUIRED', 'LESSON_WORKSPACE_CHANGED', 'LESSON_NOT_FOUND', 'LESSON_CHANGED', 'INVALID_LESSON', 'INVALID_LESSON_DECISION',
  'INVALID_LESSON_STATE', 'INVALID_LESSON_TARGET', 'INVALID_LESSON_STATE_NAMESPACE', 'APP_LESSON_REVIEW_REQUIRED', 'TAINTED_LESSON', 'LESSON_CONFLICT',
  'INVALID_SUPERSESSION', 'PROTECTED_LESSON_TARGET',
] as const;
export type ScenarioDomainCode = (typeof scenarioCodes)[number];
export type LessonDomainCode = (typeof lessonCodes)[number];
/** Frontend-local codes: a transport refuses a retained method with INVALID_REQUEST;
 * a fresh re-read before a proof no longer matches the displayed view. */
export type RetainedLocalCode = 'UNSUPPORTED_TRANSPORT' | 'SCENARIO_VIEW_CHANGED';
export type RetainedFailureCode = ReadFailureCode | RetainedLocalCode | ScenarioDomainCode | LessonDomainCode;
const domainCodes: readonly string[] = [...scenarioCodes, ...lessonCodes];
export function retainedFailureCode(error: unknown): RetainedFailureCode {
  if (error instanceof ReplyValidationError) return 'INVALID_REPLY';
  let descriptor: PropertyDescriptor | undefined;
  try { descriptor = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined; }
  catch { return 'REQUEST_FAILED'; }
  const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  if (code === 'INVALID_REQUEST') return 'UNSUPPORTED_TRANSPORT';
  if (typeof code === 'string' && domainCodes.includes(code)) return code as RetainedFailureCode;
  if (code === 'FORBIDDEN' || code === 'ACCESS_REVOKED') return 'ACCESS_DENIED';
  return readFailureCode(error);
}
/** Codes that leave this interface unable to carry the method at all, as opposed to a refusal of one record. */
export function isTransportUnavailable(code: RetainedFailureCode): boolean {
  return code === 'UNSUPPORTED_TRANSPORT' || code === 'SCENARIO_HOST_REQUIRED' || code === 'LESSON_AUTHORITY_REQUIRED' || code === 'LESSON_AUTHORITIES_REQUIRED' || code === 'EVALUATION_AUTHORITY_REQUIRED';
}
