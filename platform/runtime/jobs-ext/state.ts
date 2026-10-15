/**
 * The jobs-ext lane's private namespace inside workspace state (`state.extensions['jobs-ext']`).
 *
 * Core jobs (`state.jobs`, owned by JobService) stay the single authority for the mandate:
 * goal, owner, rupee budget, stop rule, leases, acceptance. This namespace only adds what the
 * lane needs around them: proposals, the written catch-up rule, extra stop rules, the run
 * timeline, delivered results, questions, the autonomy table and procedures.
 */
import { check } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';

export const LANE = 'jobs-ext';
export const LANE_JOB_PREFIX = 'jobsx-';

export type MissedRule = 'skip' | 'once' | 'all';
export type StepKind = 'calculate' | 'question' | 'action' | 'lookup' | 'person';

/** One line of a job's time line. Amounts are whole paise as strings. */
export type TimelineEntry = {
  id: string; at: string; jobId: string; run: number;
  kind: 'run-started' | 'step' | 'question' | 'answer' | 'person-step' | 'person-done' | 'stopped-by-rule' | 'missed' | 'delivered'
    | 'accepted' | 'rejected' | 'set-aside' | 'waiting-network' | 'route-untested' | 'budget' | 'paid' | 'note';
  stepKind?: StepKind; needsModel?: boolean; routeId?: string; costMinor?: string; costEstimate?: boolean; durationMs?: number;
  /** Plain fixed words chosen by software. Never outside text. */
  text: string; code?: string;
  recordIds?: string[]; receiptIds?: string[]; actionIds?: string[]; caseId?: string;
  /** A model request waiting for the owner's approval of its exact payload (`models.approve`). */
  modelPreviewId?: string;
};

export type LaneQuestion = {
  id: string; jobId: string; caseId?: string; askedAt: string; prompt: string; options: string[];
  /** The rule's own pick and how sure it is, when it has one. */
  suggested?: { option: string; confidence: number };
  status: 'open' | 'answered' | 'withdrawn'; applied?: boolean; answer?: string; answeredBy?: string; answeredAt?: string; sourceIds: string[];
};

export type PersonStep = { id: string; jobId: string; recordIds?: string[]; title: string; assignee: string; status: 'waiting' | 'done'; createdAt: string; doneAt?: string; doneBy?: string };

export type CaseOutcome = {
  caseId: string; recordIds: string[]; handledBy: 'procedure' | 'agent' | 'ready-made' | 'person';
  decision?: string; confidence?: number; status: 'done' | 'waiting-for-you' | 'waiting-network' | 'blocked' | 'paid' | 'not-due';
  reason?: string; actionIds: string[]; receiptIds: string[]; costMinor: string; durationMs: number;
};

export type LaneResult = {
  jobId: string; run: number; deliveredAt: string; digest: string;
  done: string[]; open: string[]; recommendations: string[];
  /** `minor` is whole paise unless `unit` says otherwise (a quantity from core-data's stock measure). */
  figures: { key: string; label: string; minor: string; display: string; receiptId: string; unit?: string }[];
  cases: CaseOutcome[]; receiptIds: string[]; sourceIds: string[];
};

export type LaneJob = {
  jobId: string; template: string; createdAt: string; proposalId?: string;
  missedRule: MissedRule; stepsPerDelivery: number; stepsDone: number; backlog: number;
  failureLimit: number; consecutiveFailures: number; setAside?: { at: string; reason: string };
  stoppedBy?: { at: string; rule: string; reason: string; leftUndone: string[] };
  testedRoutes: string[]; sourceIds: string[];
  replacedBy?: string; replaces?: string; deletedAt?: string;
  cases: Record<string, CaseOutcome>;
  /** Runs this lane started, deliveries made, and figures gathered by earlier steps of this delivery. */
  runCounter?: number; deliveries?: number; stepFigures?: LaneResult['figures']; stepReceipts?: string[];
  /** Work held while a person does a step (WK-16). */
  pending?: unknown; waitingFor?: string;
  /** Runs while the window is closed, when background mode is on. */
  background: boolean;
  approvedDigest: string;
  gstSources?: { registerSourceId: string; gstr2bSourceId: string };
  /** A private nonce in this job's action keys (never returned by any method). */
  keyNonce?: string;
};

export type MissedNote = { id: string; jobId: string; at: string; missed: number; ran: number; rule: MissedRule; text: string; seen: boolean };

export type Proposal = {
  id: string; createdAt: string; createdBy: string; origin: 'detector' | 'person' | 'job' | 'edit';
  /** A job asked to create another job: it always waits for the owner's yes. */
  fromJobId?: string; replacesJobId?: string;
  template: string; sentence?: string; card: JobCard; digest: string;
  status: 'proposed' | 'approved' | 'dismissed'; decidedAt?: string; jobId?: string; evidence: string[]; sourceIds: string[];
};

/** WK-09: what a job may do, readable before it starts. */
export type JobCard = {
  template: string; title: string; goal: string; finishedWhen: string; ownerId: string;
  budgetMinor: string; reserveMinor: string; stopRule: { maxRuns: number; deadline: string };
  extraStopRules: { failures: number };
  intervalMs: number; nextRunAt: string; missedRule: MissedRule; stepsPerDelivery: number;
  allowedActions: string[]; testedRoutes: string[]; reviewDate: string; computer: 'this-computer';
  background: boolean; steps: { kind: StepKind; title: string; needsModel: boolean }[];
  sourceIds: string[]; untrustedInstructions?: boolean;
  /** GST matching: the purchase register and the GSTR-2B source it compares. */
  gstSources?: { registerSourceId: string; gstr2bSourceId: string };
};

/** A kind's switch, its daily count and its daily amount limit in whole paise ('0': nothing that touches money runs on its own). */
export type AutonomyKind = { on: boolean; dailyCount: number; dailyAmountMinor?: string };
export type AutonomyRun = { kind: string; actionId: string; at: string; amountMinor?: string; claim?: string };

export type JobsExtSettings = {
  activeJobCap: number; failureLimit: number; backgroundMode: boolean; backgroundAsked: boolean;
  reminderPerCustomerPerDay: number; reminderPerDay: number; groupMax: number; autoReviewMinutes: number;
};

export type JobsExtState = {
  version: 1;
  settings: JobsExtSettings;
  jobs: Record<string, LaneJob>;
  proposals: Proposal[];
  timeline: TimelineEntry[];
  results: LaneResult[];
  questions: LaneQuestion[];
  personSteps: PersonStep[];
  missed: MissedNote[];
  autonomy: { preset: 'ask-everything' | 'routine' | 'all-but-always-waits' | 'custom'; kinds: Record<string, AutonomyKind>; runs: AutonomyRun[] };
  consent: { customerId: string; channel: 'mail' | 'whatsapp'; agreed: boolean; source: string; at: string; stoppedAt?: string; sourceIds: string[] }[];
  reminders: { customerId: string; invoiceId: string; day: string; actionId: string; jobId: string; key?: string; ownerId?: string }[];
  /** Procedures and their run traces live in their own sub-namespace (platform/runtime/procedures). */
  procedures: unknown;
  lastDetection?: Record<string, string>;
  /** Missed-run notes of core-run jobs (`<jobId>:<at>`) that their owner marked as read. */
  seenCoreMissed?: string[];
};

export const defaultSettings = (): JobsExtSettings => ({
  activeJobCap: 10, failureLimit: 3, backgroundMode: false, backgroundAsked: false,
  reminderPerCustomerPerDay: 1, reminderPerDay: 20, groupMax: 10, autoReviewMinutes: 0,
});

export function initLane(): JobsExtState {
  return { version: 1, settings: defaultSettings(), jobs: {}, proposals: [], timeline: [], results: [], questions: [], personSteps: [], missed: [],
    autonomy: { preset: 'ask-everything', kinds: {}, runs: [] }, consent: [], reminders: [], procedures: undefined };
}

/** The writable namespace. Call only inside `store.update`. */
export function lane(state: State): JobsExtState { return moduleState(state, LANE, initLane); }
/** A read-only copy; absence is an empty namespace. */
export function peekLane(state: State): JobsExtState { return structuredClone(peekModuleState<JobsExtState>(state, LANE) ?? initLane()); }

export const TIMELINE_LIMIT = 5000;
/** Keeps a lane list bounded: the oldest settled entries go first. */
export function bound<T>(list: T[], max = 2000, settled: (item: T) => boolean = () => true) {
  while (list.length > max) { const index = list.findIndex(settled); list.splice(index < 0 ? 0 : index, 1); }
}
export function pushTimeline(ns: JobsExtState, entry: TimelineEntry) {
  ns.timeline.push(entry);
  if (ns.timeline.length > TIMELINE_LIMIT) ns.timeline.splice(0, ns.timeline.length - TIMELINE_LIMIT);
}

export function isLaneJob(job: { type?: string } | undefined): boolean { return !!job?.type && job.type.startsWith(LANE_JOB_PREFIX); }

/** Jobs and their lane records are private to their pinned owner, as in JobService.list. */
export function ownsJob(context: Context, job: { ownerId: string; ownerEpoch: number; ownerRole: string }) {
  return job.ownerId === context.memberId && job.ownerEpoch === context.epoch && job.ownerRole === context.role;
}

export function inApp(context: Context, code = 'APP_APPROVAL_REQUIRED') {
  check(!context.sourceTainted && context.channel !== 'phone', code, 'Do this inside the app.');
}

export const paise = (value: unknown, code = 'INVALID_BUDGET'): bigint => {
  check(typeof value === 'string' && /^(0|[1-9]\d{0,17})$/.test(value), code, 'Use whole paise as a string.');
  return BigInt(value);
};

export const dayOf = (iso: string) => iso.slice(0, 10);

/** Rupees for display from whole paise. Display only; arithmetic stays in BigInt paise. */
export function rupees(minor: string | bigint): string {
  const n = BigInt(minor); const negative = n < 0n; const a = negative ? -n : n;
  return `₹${negative ? '-' : ''}${(a / 100n).toLocaleString('en-IN')}.${String(a % 100n).padStart(2, '0')}`;
}
