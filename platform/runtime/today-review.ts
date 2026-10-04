import { authorize, check, hash, newId } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { ActionService, canonical, current, digest, sourceAccess } from './actions.ts';
import type { PreparedAction } from './actions.ts';
import { JobService } from './jobs.ts';
import type { Job } from './jobs.ts';
import type { LessonService } from './lessons.ts';
import type { LessonEvaluationAuthority, LessonTargetAuthority, LessonView } from './lesson-contracts.ts';

/** This is one existing-source review set, not all product review obligations. */
export const TODAY_REVIEW_SCOPE = 'prepared-actions-job-mandates-deliverables-lessons-v1' as const;
export type TodayReviewKind = 'action-approval' | 'job-approval' | 'job-acceptance' | 'lesson-decision';
export type TodayReviewReference =
  | { kind: 'action-approval' | 'job-approval'; id: string; revision: number; digest: string }
  | { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string }
  | { kind: 'lesson-decision'; id: string; revision: number; digest: string; reviewId: string; reviewDigest: string; evaluationDigest: string };
export type TodayReviewRequest =
  | { method: 'actions.approve' | 'jobs.approve'; payload: { id: string; digest: string } }
  | { method: 'jobs.accept'; payload: { id: string } }
  /** Decision and reason must be supplied by the human, never by this read. */
  | { method: 'memory.decideLesson'; payload: { candidate: { id: string; revision: number; digest: string }; reviewId: string; reviewDigest: string }; requiredHumanFields: ['decision', 'reason'] };
export type TodayReviewProvenance =
  | { producer: 'actions' | 'jobs' | 'lessons'; id: string; revision: number; digest: string }
  | { producer: 'job-action-preview'; id: string; revision: number; digest: string; stepId: string; operationKey: string; actionId: string; actionDigest: string; deliverableDigest: string };
export type TodayReviewRow = {
  kind: TodayReviewKind; title: string; since: string; reference: TodayReviewReference;
  request: TodayReviewRequest; canApprove: boolean; provenance: TodayReviewProvenance[];
};
export type TodayReviewProducer = {
  status: 'complete' | 'incomplete' | 'unavailable';
  reason?: 'PRODUCER_AUTHORITY_UNAVAILABLE' | 'PRODUCER_READ_UNAVAILABLE' | 'REVIEW_EVIDENCE_UNAVAILABLE';
};
export type TodayReviewQueue = {
  scope: typeof TODAY_REVIEW_SCOPE; completeness: 'complete' | 'incomplete' | 'unavailable';
  /** Null until every producer in this scoped set is available. */
  count: number | null; knownCount: number; rows: TodayReviewRow[]; nextCursor: string | null;
  producers: Record<'actions' | 'jobs' | 'lessons', TodayReviewProducer>;
};
export type TodayReviewOptions = {
  actions?: ActionService; jobs?: JobService;
  /** Required by a host whose action/job read guards depend on live authority
   * outside State. It must change for every such grant/release change. Guards
   * themselves are synchronous read-only ports, never authority mutations. */
  authorityRevision?: () => string;
  /** The SAME trusted target/evaluation authorities installed in the service.
   * They expose live revisions, including revocation while a reply is held.
   * No evaluation authority or review-issuance fallback is supplied here. */
  lessons?: { service: LessonService; targets: LessonTargetAuthority; evaluations: LessonEvaluationAuthority };
};
export type TodayReviewPageRequest = { limit?: number; cursor?: string };
const unavailable = (): TodayReviewProducer => ({ status: 'unavailable', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' });
const complete = (): TodayReviewProducer => ({ status: 'complete' });
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const actor = (context: Context) => ({ memberId: context.memberId, role: context.role, epoch: context.epoch });
const pin = (view: LessonView) => ({ id: view.candidate.id, revision: view.candidate.revision, digest: view.candidate.digest });
const allows = (test: () => void) => { try { test(); return true; } catch { return false; } };
const approvalStates: Job['status'][] = ['scheduled', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait', 'paused'];

/** Read-only projection of current real producer services. No prepare, approval,
 * acceptance, lesson review issuance, dispatch, reconciliation or store update.
 * Call resolve again after an asynchronous transport hold and before drilldown;
 * a returned reference or cursor is never a grant to perform a mutation. */
export class TodayReviewService {
  private readonly store: StateStore;
  private readonly sources: TodayReviewOptions;
  private readonly cursorKey = newId('review_cursor');
  constructor(store: StateStore, options: TodayReviewOptions = {}) {
    this.store = store;
    this.sources = { actions: options.actions, jobs: options.jobs, authorityRevision: options.authorityRevision, ...(options.lessons ? { lessons: { ...options.lessons } } : {}) };
    check(!options.actions || options.actions.store === store, 'REVIEW_WORKSPACE_CHANGED', 'Review actions must use this exact workspace store.');
    check(!options.jobs || options.jobs.store === store, 'REVIEW_WORKSPACE_CHANGED', 'Review jobs must use this exact workspace store.');
  }
  private basis() {
    const lesson = this.sources.lessons;
    let external: string | undefined;
    try { external = this.sources.authorityRevision?.(); }
    catch { check(false, 'REVIEW_AUTHORITY_UNAVAILABLE', 'The installed live review authority is unavailable.'); }
    check(!this.sources.authorityRevision || typeof external === 'string' && external.trim().length > 0, 'REVIEW_AUTHORITY_UNAVAILABLE', 'The installed live review authority is unavailable.');
    let lessonRevisions: unknown;
    try { lessonRevisions = { targets: lesson?.targets.authorityRevision(), evaluations: lesson?.evaluations.authorityRevision() }; }
    catch { lessonRevisions = { unavailable: true }; }
    return hash({ state: this.store.read(), external, lessonRevisions });
  }
  private canApprove(context: Context, state: State) {
    return allows(() => { current(state, context, 'approve'); check(!context.sourceTainted, 'TAINTED_APPROVAL', 'A human must review this request.'); });
  }
  private actions(context: Context, state: State, coverage: TodayReviewQueue['producers']): TodayReviewRow[] {
    const service = this.sources.actions;
    if (!service) return [];
    coverage.actions = complete();
    // An accessible retained action without its installed catalogue is missing
    // authority, rather than proof that there are zero outstanding requests.
    for (const action of state.actions as PreparedAction[]) {
      if (action.status === 'prepared' && action.attempts.length === 0 && allows(() => service.access(state, context, action)) &&
          !service.registry.get(action.connector)?.operations[action.operation]) coverage.actions = unavailable();
    }
    return service.list(context).filter(action => action.status === 'prepared' && action.attempts.length === 0).map<TodayReviewRow>(action => {
      const operation = service.operation(action.connector, action.operation);
      const reference: TodayReviewReference = { kind: 'action-approval', id: action.id, revision: action.revision, digest: action.digest };
      return {
        kind: 'action-approval', title: operation.title, since: action.createdAt, reference,
        request: { method: 'actions.approve', payload: { id: action.id, digest: action.digest } },
        canApprove: this.canApprove(context, state) && allows(() => {
          service.access(state, context, action); operation.authorize?.(state, context, 'write');
          check(context.channel !== 'phone' || operation.impact === 'message', 'APP_APPROVAL_REQUIRED', 'Review this request in the app.');
          check(action.digest === service.identity(action), 'PREVIEW_CHANGED', 'Review the current exact action.');
        }), provenance: [{ producer: 'actions', id: action.id, revision: action.revision, digest: action.digest }],
      };
    });
  }
  private validApproval(state: State, context: Context, job: Job): boolean {
    const service = this.sources.jobs!, approval = job.approval;
    return !!approval && approval.digest === job.digest && approval.revision === job.revision && allows(() => {
      service.owner(state, { memberId: approval.memberId, role: approval.role, epoch: approval.epoch }, job);
      // An old grant cannot supply approval through a revoked source/role/epoch.
      service.owner(state, context, job);
    });
  }
  private jobs(context: Context, state: State, coverage: TodayReviewQueue['producers'], actionRows: TodayReviewRow[]): TodayReviewRow[] {
    const service = this.sources.jobs;
    if (!service) return [];
    coverage.jobs = service.deliverableGuard ? complete() : { status: 'incomplete', reason: 'PRODUCER_AUTHORITY_UNAVAILABLE' };
    const rows: TodayReviewRow[] = [];
    for (const job of service.list(context)) {
      const raw = service.find(state, job.id);
      const intact = job.digest === service.identity(job);
      const provenance: TodayReviewProvenance[] = [{ producer: 'jobs', id: job.id, revision: job.revision, digest: job.digest }];
      if (job.status === 'awaiting-acceptance') {
        // JobService.view, including the current evidence guard, decides release.
        if (!Object.hasOwn(job, 'deliverable') || !intact) {
          coverage.jobs = { status: 'incomplete', reason: 'REVIEW_EVIDENCE_UNAVAILABLE' }; continue;
        }
        const deliverableDigest = digest(job.deliverable);
        rows.push({ kind: 'job-acceptance', title: job.goal, since: job.ledger.findLast(item => item.event === 'delivered')?.at ?? job.createdAt,
          reference: { kind: 'job-acceptance', id: job.id, revision: job.revision, digest: job.digest, deliverableDigest },
          request: { method: 'jobs.accept', payload: { id: job.id } },
          canApprove: this.canApprove(context, state) && context.channel !== 'phone' && allows(() => service.owner(state, context, raw)), provenance });
        this.actionProvenance(job, raw, deliverableDigest, actionRows);
      } else if (job.requiresApproval && approvalStates.includes(job.status) && intact && !raw.deliverable &&
          !raw.execution?.attempts.some(attempt => ['dispatched', 'unknown'].includes(attempt.status)) &&
          job.runs < job.stopRule.maxRuns && Number.isFinite(Date.parse(job.stopRule.deadline)) && service.clock() < Date.parse(job.stopRule.deadline) &&
          (!job.calendar || service.clock() < Date.parse(job.calendar.definition.stop.until)) && !this.validApproval(state, context, raw)) {
        rows.push({ kind: 'job-approval', title: job.goal, since: job.createdAt,
          reference: { kind: 'job-approval', id: job.id, revision: job.revision, digest: job.digest },
          request: { method: 'jobs.approve', payload: { id: job.id, digest: job.digest } },
          canApprove: this.canApprove(context, state) && context.channel !== 'phone' && allows(() => service.owner(state, context, raw)), provenance });
      }
    }
    return rows;
  }
  private actionProvenance(job: Job, raw: Job, deliverableDigest: string, rows: TodayReviewRow[]) {
    const released = job.deliverable as { kind?: string; objectiveRevision?: number; scheduledFor?: string; result?: { actions?: unknown[] } };
    const execution = raw.execution;
    if (job.type !== 'action-preparation' || released?.kind !== job.type || released.objectiveRevision !== job.revision ||
        !execution || execution.objectiveRevision !== job.revision || execution.planDigest !== digest(raw.plan) ||
        released.scheduledFor !== execution.scheduledFor || !Array.isArray(released.result?.actions)) return;
    for (const value of released.result.actions) {
      const preview = value as { id?: string; informationClass?: string; evidenceIds?: string[]; value?: { actionId?: string; digest?: string } };
      if (preview?.informationClass !== 'action-preview' || preview.evidenceIds?.length !== 1) continue;
      const row = rows.find(item => item.kind === 'action-approval' && item.reference.id === preview.value?.actionId && item.reference.digest === preview.value?.digest);
      if (!row || preview.evidenceIds[0] !== row.reference.id) continue;
      const step = execution.plan.steps.find(item => item.id === preview.id && item.provider === 'local-action-preparation');
      if (!step) continue;
      const operationKey = `${job.id}:revision:${job.revision}:occurrence:${execution.calendar?.occurrenceId ?? execution.scheduledFor}:step:${step.id}`;
      const action = this.sources.actions!.find(this.store.read(), row.reference.id);
      if (action.idempotencyKey !== operationKey || !execution.attempts.some(attempt => attempt.key === operationKey && attempt.stepId === step.id && attempt.status === 'verified')) continue;
      const provenance: TodayReviewProvenance = { producer: 'job-action-preview', id: job.id, revision: job.revision, digest: job.digest,
        stepId: step.id, operationKey, actionId: action.id, actionDigest: action.digest, deliverableDigest };
      if (!row.provenance.some(item => same(item, provenance))) row.provenance.push(provenance);
    }
  }
  private lessons(context: Context, state: State, coverage: TodayReviewQueue['producers']): TodayReviewRow[] {
    const source = this.sources.lessons;
    if (!source?.evaluations || !source.targets) return [];
    check(source.targets.authorityRevision().trim() && source.evaluations.authorityRevision().trim(), 'LESSON_AUTHORITY_REQUIRED', 'Install current target and evaluation revisions.');
    const views = source.service.lessons(context);
    coverage.lessons = complete();
    // Engine-retained namespace is essential to establish coverage: lessons()
    // intentionally omits unavailable records, which is not an empty queue.
    const retained = state.lessonState?.lessons ?? [];
    check(!views.length || state.lessonState?.workspaceId === state.workspace.id, 'REVIEW_WORKSPACE_CHANGED', 'Review lessons must use this exact retained workspace namespace.');
    let approvalCoverage = true;
    for (const record of retained) {
      const candidate = record.revisions.at(-1);
      if (!candidate || candidate.owner.memberId !== context.memberId) continue;
      try { source.service.history(context, record.id); } catch {
        // A withheld approved record can still block promotion in decideLesson.
        // Never infer absence of a conflict from its omission in the read list.
        approvalCoverage = false;
        if (same(candidate.owner, actor(context)) && allows(() => {
          sourceAccess(state, context, candidate.applicability.sourceIds);
          const member = current(state, context);
          check(member.branches.includes('*') || candidate.applicability.branchIds.every(branch => member.branches.includes(branch)), 'BRANCH_FORBIDDEN', 'Lesson source scope is unavailable.');
        })) coverage.lessons = { status: 'incomplete', reason: 'REVIEW_EVIDENCE_UNAVAILABLE' };
      }
    }
    const rows: TodayReviewRow[] = [];
    for (const view of views) {
      const { candidate, evaluation, review } = view;
      if (candidate.workspaceId !== state.workspace.id || view.status !== 'review-ready' || !evaluation || !review ||
          !same(review.candidate, pin(view)) || review.evaluationDigest !== evaluation.digest || !same(review.reviewer, actor(context))) continue;
      if (candidate.supersedes) {
        const previous = views.find(item => same(pin(item), candidate.supersedes));
        if (!previous || previous.status !== 'approved' || !previous.evaluation || !same(previous.candidate.applicability, candidate.applicability) ||
            !same(previous.candidate.target, candidate.target) || previous.candidate.change.kind !== candidate.change.kind ||
            previous.candidate.change.targetId !== candidate.change.targetId || !same(previous.candidate.change.after, candidate.change.before)) {
          coverage.lessons = { status: 'incomplete', reason: 'REVIEW_EVIDENCE_UNAVAILABLE' }; continue;
        }
      }
      const conflict = views.some(other => other.status === 'approved' && other.candidate.id !== candidate.id &&
        other.candidate.owner.memberId === candidate.owner.memberId && other.candidate.change.kind === candidate.change.kind &&
        other.candidate.change.targetId === candidate.change.targetId && other.candidate.applicability.branchIds.some(branch => candidate.applicability.branchIds.includes(branch)) &&
        same(other.candidate.applicability.sourceIds, candidate.applicability.sourceIds) &&
        Object.keys(candidate.applicability.conditions).every(key => !Object.hasOwn(other.candidate.applicability.conditions, key) || other.candidate.applicability.conditions[key] === candidate.applicability.conditions[key]) &&
        (!candidate.supersedes || !same(candidate.supersedes, pin(other))));
      const reference: TodayReviewReference = { kind: 'lesson-decision', ...pin(view), reviewId: review.id, reviewDigest: review.digest, evaluationDigest: evaluation.digest };
      rows.push({ kind: 'lesson-decision', title: candidate.title, since: review.at, reference,
        request: { method: 'memory.decideLesson', payload: { candidate: pin(view), reviewId: review.id, reviewDigest: review.digest }, requiredHumanFields: ['decision', 'reason'] },
        canApprove: this.canApprove(context, state) && context.channel === 'desktop' && approvalCoverage && !conflict,
        provenance: [{ producer: 'lessons', ...pin(view) }] });
    }
    return rows;
  }
  private collect(context: Context) {
    authorize(this.store, context);
    const before = this.basis();
    const state = this.store.read();
    const readSet = () => {
      const coverage: TodayReviewQueue['producers'] = { actions: unavailable(), jobs: unavailable(), lessons: unavailable() };
      const rows: TodayReviewRow[] = [];
      const read = (producer: keyof typeof coverage, run: () => TodayReviewRow[]) => {
        try { rows.push(...run()); } catch { coverage[producer] = { status: 'unavailable', reason: 'PRODUCER_READ_UNAVAILABLE' }; }
      };
      read('actions', () => this.actions(context, state, coverage));
      read('jobs', () => this.jobs(context, state, coverage, rows));
      read('lessons', () => this.lessons(context, state, coverage));
      return { rows, coverage };
    };
    const collected = readSet(), renewed = readSet();
    // Recheck release and capability at the end too: installed operation/output
    // guards may have live authority beyond persisted State. Never release the
    // first producer's held rows after a later producer changes that authority.
    check(hash(collected) === hash(renewed), 'REVIEW_AUTHORITY_CHANGED', 'Review authority changed during this read. Read the current queue again.');
    const { rows, coverage } = renewed;
    authorize(this.store, context);
    const after = this.basis();
    check(before === after, 'REVIEW_AUTHORITY_CHANGED', 'Review authority changed during this read. Read the current queue again.');
    // Exact request identity, never labels. Acceptance and approval stay distinct.
    const unique = new Map<string, TodayReviewRow>();
    for (const row of rows) {
      const key = canonical(row.reference), existing = unique.get(key);
      if (!existing) unique.set(key, row);
      else for (const provenance of row.provenance) if (!existing.provenance.some(item => same(item, provenance))) existing.provenance.push(provenance);
    }
    const ordered = [...unique.values()].sort((a, b) => a.since.localeCompare(b.since) || canonical(a.reference).localeCompare(canonical(b.reference)));
    const statuses = Object.values(coverage).map(item => item.status);
    const completeness: TodayReviewQueue['completeness'] = statuses.every(status => status === 'complete') ? 'complete' : statuses.every(status => status === 'unavailable') ? 'unavailable' : 'incomplete';
    return { rows: ordered, coverage, completeness, fingerprint: hash({ basis: after, context, coverage, rows: ordered }) };
  }
  private cursor(offset: number, fingerprint: string) {
    const seal = hash({ offset, fingerprint, key: this.cursorKey });
    return Buffer.from(JSON.stringify({ offset, seal })).toString('base64url');
  }
  list(context: Context, request: TodayReviewPageRequest = {}): TodayReviewQueue {
    context = Object.freeze(structuredClone(context));
    check(request && typeof request === 'object' && !Array.isArray(request) && Object.getPrototypeOf(request) === Object.prototype && Object.keys(request).every(key => ['limit', 'cursor'].includes(key)), 'INVALID_REVIEW_PAGE', 'Use a bounded review page request.');
    const limit = request.limit ?? 4;
    check(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'INVALID_REVIEW_PAGE', 'Review pages contain 1–100 rows.');
    const queue = this.collect(context);
    let offset = 0;
    if (request.cursor !== undefined) {
      check(typeof request.cursor === 'string' && request.cursor.length <= 512, 'REVIEW_QUEUE_CHANGED', 'Read the current review queue again.');
      let parsed: { offset?: number; seal?: string } = {};
      try { parsed = JSON.parse(Buffer.from(request.cursor, 'base64url').toString()); } catch { /* Refuse malformed or stale cursors. */ }
      check(parsed && Number.isSafeInteger(parsed.offset) && parsed.offset! > 0 && parsed.offset! < queue.rows.length &&
        request.cursor === this.cursor(parsed.offset!, queue.fingerprint), 'REVIEW_QUEUE_CHANGED', 'The review queue or authority changed. Read its first page again.');
      offset = parsed.offset!;
    }
    const end = Math.min(offset + limit, queue.rows.length);
    return structuredClone({ scope: TODAY_REVIEW_SCOPE, completeness: queue.completeness,
      count: queue.completeness === 'complete' ? queue.rows.length : null, knownCount: queue.rows.length,
      rows: queue.rows.slice(offset, end), nextCursor: end < queue.rows.length ? this.cursor(end, queue.fingerprint) : null, producers: queue.coverage });
  }
  resolve(context: Context, reference: TodayReviewReference): TodayReviewRow {
    const rows = this.collect(Object.freeze(structuredClone(context))).rows;
    const row = rows.find(item => same(item.reference, reference));
    check(row, 'REVIEW_REFERENCE_UNAVAILABLE', 'This exact review request is no longer available under current authority.');
    return structuredClone(row);
  }
}
