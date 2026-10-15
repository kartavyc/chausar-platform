import { authorize, audit, check, newId, now } from './contracts.ts';
import type { Context, State, StateStore } from './contracts.ts';
import { current, digest, sourceAccess, canonical } from './actions.ts';
import { json, validatePlan } from './job-protocol.ts';
import type { GoalPlan, GoalLimits, GoalExecution } from './job-protocol.ts';
import { evaluateCalendar, validateCalendar, calendarInstant } from './calendar.ts';
import type { CalendarDefinition, CalendarBounds, CalendarEvaluation, JobCalendar } from './calendar.ts';
import type { CalendarRules } from './calendar-zone.ts';
import { assertSourceAccess } from './trust.ts';

export type JobConfig = {
  calendar?: CalendarDefinition;
  input?: unknown; plan?: GoalPlan; limits?: GoalLimits; allowedActions?: string[]; testedRoutes?: string[]; background?: boolean;
  type?: string;
  /** Named connector operations (`connector.operation`) this job may touch; a plan job defaults to its allowed actions. */
  actions?: string[];
  /** The date the owner reviews the mandate again (YYYY-MM-DD). Shown on the card; not part of its authority. */
  reviewOn?: string;
  goal: string; ownerId?: string; budgetMinor: string; reserveMinor?: string;
  stopRule: { maxRuns: number; deadline: string }; nextRunAt?: string; intervalMs?: number;
  catchup?: 'skip' | 'latest'; graceMs?: number; requiresApproval?: boolean; sourceIds?: string[];
};
export type Lease = { token: string; workerId: string; fence: number; expiresAt: string; reservedMinor: string; chargedMinor: string };
/** A read pin is compared again inside the acceptance authority transaction. */
export type JobAcceptanceReference = { kind: 'job-acceptance'; id: string; revision: number; digest: string; deliverableDigest: string };
export type Job = {
  calendar?: JobCalendar;
  input?: unknown; plan?: GoalPlan; limits?: GoalLimits; allowedActions?: string[]; testedRoutes?: string[]; background?: boolean; execution?: GoalExecution; archivedExecutions?: GoalExecution[];
  type?: string; actions?: string[]; reviewOn?: string;
  id: string; goal: string; ownerId: string; ownerEpoch: number; ownerRole: Context['role']; budgetMinor: string; reserveMinor: string; spentMinor: string; reservedMinor: string;
  stopRule: JobConfig['stopRule']; nextRunAt: string; scheduleAnchor?: string; intervalMs: number; catchup: 'skip' | 'latest'; graceMs: number;
  requiresApproval: boolean; sourceIds: string[]; revision: number; digest: string; runs: number; fence: number;
  status: 'scheduled' | 'running' | 'paused' | 'revoked' | 'approval-blocked' | 'budget-blocked' | 'runner-blocked' | 'network-wait' | 'outcome-unknown' | 'cancelled' | 'stopped' | 'awaiting-acceptance' | 'accepted';
  createdAt: string; lease?: Lease; deliverable?: unknown; approval?: { digest: string; revision: number; memberId: string; epoch: number; role: Context['role'] };
  ledger: { at: string; event: string; fence?: number; amountMinor?: string; reason?: string; durationMs?: number; stepId?: string; actionId?: string; by?: string; revision?: number }[];
};
export type JobMeters = { jobId: string; clockMs: number | null; exposureMinor: string | null; actions: string[]; reviewOn: string | null };
const ACTION_NAME = /^[a-z][a-z0-9-]*\.[a-zA-Z][a-zA-Z0-9-]*$/;
/** Validated, deduplicated and sorted action names; at most 50. */
export function actionNames(value: unknown): string[] {
  check(Array.isArray(value) && value.length <= 50 && value.every(name => typeof name === 'string' && name.length <= 129 && ACTION_NAME.test(name)), 'INVALID_JOB_ACTIONS', 'Name at most 50 actions as connector.operation.');
  return [...new Set(value as string[])].sort();
}
/** A plan job's named actions: explicit names, else the well-formed allowed actions it declares. */
export const jobActions = (actions: unknown, allowed: unknown): string[] | undefined => actions !== undefined ? actionNames(actions) : Array.isArray(allowed) ? actionNames(allowed.filter(name => typeof name === 'string' && ACTION_NAME.test(name)).slice(0, 50)) : undefined;
/** A real calendar date written YYYY-MM-DD. */
export function reviewDate(value: unknown): string {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value, 'INVALID_REVIEW_DATE', 'Set the review date as a real date, YYYY-MM-DD.');
  return value;
}
const PERSON_WAITING = 'PERSON_STEP_WAITING';
function amount(value: unknown): bigint { check(typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value), 'INVALID_BUDGET', 'Budgets use non-negative integer paise.'); return BigInt(value); }
export class JobService {
  store: StateStore; clock: () => number;
  calendarRules?: CalendarRules; calendarBounds?: CalendarBounds;
  deliverableGuard?: (context: Context, job: Job, view?: StateStore) => boolean;
  constructor(store: StateStore, options: { clock?: () => number; deliverableGuard?: (context: Context, job: Job, view?: StateStore) => boolean; calendarRules?: CalendarRules; calendarBounds?: CalendarBounds } = {}) { this.store = store; this.clock = options.clock ?? Date.now; this.deliverableGuard = options.deliverableGuard; this.calendarRules = options.calendarRules; this.calendarBounds = options.calendarBounds && json(options.calendarBounds); }
  timestamp() { return new Date(this.clock()).toISOString(); }
  private sources(state: State, context: Context, config: Pick<JobConfig, 'type' | 'plan'>, ids: string[]) {
    if (config.type === 'owner-brief' && !config.plan) {
      // Read-only briefs select rows under the owner's current branch policy.
      // A mixed-branch source is not a grant to read its other rows or prepare an effect.
      current(state, context); assertSourceAccess(state, context, ids); return;
    }
    sourceAccess(state, context, ids);
  }
  find(state: State, id: string): Job { const job = state.jobs.find(j => j.id === id); check(job, 'NOT_FOUND', 'Job not found.'); return job; }
  identity(job: Job) { return digest({ ...(job.type ? { type: job.type } : {}), ...(job.actions ? { actions: job.actions } : {}), ...(job.calendar ? { calendar: { definition: job.calendar.definition, revision: job.calendar.revision, objectiveRevision: job.calendar.objectiveRevision, digest: job.calendar.digest } } : {}), ...(job.scheduleAnchor ? { scheduleAnchor: job.scheduleAnchor } : {}), ...(job.plan ? { input: job.input, plan: job.plan, limits: job.limits, allowedActions: job.allowedActions, testedRoutes: job.testedRoutes, background: job.background } : {}), goal: job.goal, ownerId: job.ownerId, ownerEpoch: job.ownerEpoch, budgetMinor: job.budgetMinor, reserveMinor: job.reserveMinor, stopRule: job.stopRule, intervalMs: job.intervalMs, catchup: job.catchup, graceMs: job.graceMs, requiresApproval: job.requiresApproval, sourceIds: job.sourceIds, revision: job.revision }); }
  private calendarPorts() { check(this.calendarRules && this.calendarBounds, 'CALENDAR_RULES_REQUIRED', 'Install explicit time-zone rules and evaluation bounds.'); return { rules: this.calendarRules, bounds: this.calendarBounds }; }
  calendarEvaluation(job: Job, at = this.clock()): CalendarEvaluation { check(job.calendar, 'CALENDAR_REQUIRED', 'This mandate has no calendar schedule.'); return evaluateCalendar(job.calendar.definition, { ...this.calendarPorts(), jobId: job.id, now: at, records: job.calendar.records, skipOverlapWindows: job.calendar.skipOverlapWindows }); }
  calendarDispatchValid(job: Job) { if (!job.calendar) return; const c = job.calendar; check(c.objectiveRevision === job.revision && c.digest === digest(c.definition) && c.definition.rulesRevision === this.calendarPorts().rules.revision && c.current && job.execution?.calendar?.occurrenceId === c.current && job.execution.calendar.scheduleRevision === c.revision, 'CALENDAR_AUTHORITY_CHANGED', 'The reviewed calendar, rules or admitted objective changed.'); check(this.clock() < calendarInstant(c.definition.stop.until), 'JOB_STOP_RULE', 'The calendar dispatch mandate expired.'); }
  private calendarDecisions(job: Job, evaluation: CalendarEvaluation) {
    const c = job.calendar!;
    for (const decision of evaluation.decisions) {
      const old = c.records.find(x => x.id === decision.occurrence.id);
      if (old?.status === 'deferred') { old.status = decision.status; old.reason = decision.reason; old.at = this.timestamp(); }
      else if (!old) c.records.push({ ...decision.occurrence, status: decision.status, scheduleRevision: c.revision, objectiveRevision: job.revision, at: this.timestamp(), reason: decision.reason });
    }
  }
  private calendarStopAudit(job: Job, reason: string, at: number) {
    if (!job.calendar) return;
    try {
      const evaluation = this.calendarEvaluation(job, Math.min(at, Date.parse(job.stopRule.deadline), calendarInstant(job.calendar.definition.stop.until)));
      this.calendarDecisions(job, { ...evaluation, decisions: [
        ...evaluation.decisions.map(decision => ['coalesced', 'deferred'].includes(decision.status) ? { ...decision, status: 'skipped' as const, reason } : decision),
        ...evaluation.selected.map(occurrence => ({ occurrence, status: 'skipped' as const, reason })),
      ] });
    } catch (error) { job.ledger.push({ at: this.timestamp(), event: 'calendar-audit-blocked', reason: (error as { code?: string }).code ?? 'CALENDAR_UNQUALIFIED' }); }
  }
  private stopExpired(job: Job, at = this.clock()): boolean {
    if (job.runs >= job.stopRule.maxRuns || at >= Date.parse(job.stopRule.deadline)) { this.calendarStopAudit(job, 'mandate-expired', at); job.status = 'stopped'; job.ledger.push({ at: this.timestamp(), event: 'stop-rule' }); return true; }
    if (job.calendar && at >= calendarInstant(job.calendar.definition.stop.until)) { this.calendarStopAudit(job, 'schedule-expired', at); job.status = 'stopped'; job.ledger.push({ at: this.timestamp(), event: 'calendar-expired' }); return true; }
    return false;
  }
  /** Prospective calendar edits are qualified while idle and separately bind the current objective. */
  async configureCalendar(context: Context, id: string, definition: CalendarDefinition, expectedScheduleRevision: number, expectedObjectiveRevision: number, replacement: 'replace-immediately'): Promise<Job> {
    check(replacement === 'replace-immediately', 'CALENDAR_REVISION_POLICY_REQUIRED', 'Explicitly replace the old idle definition now; the new effectiveFrom is its coverage start, not a delayed activation.');
    const clean = validateCalendar(definition, this.calendarPorts().rules, this.calendarPorts().bounds);
    return this.store.update(state => {
      const job = this.find(state, id); this.owner(state, context, job);
      check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole && !context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Only the pinned owner may revise a schedule inside the app.');
      check(job.revision === expectedObjectiveRevision && (job.calendar?.revision ?? 0) === expectedScheduleRevision, 'CALENDAR_REVISION_CHANGED', 'Review the current objective and schedule revisions.');
      check(!['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) && !job.lease && !job.execution && !job.deliverable && (!job.calendar?.current || job.calendar.objectiveRevision !== job.revision), 'CALENDAR_NOT_IDLE', 'Resolve and accept the current occurrence before editing its calendar.');
      check(calendarInstant(clean.effectiveFrom) >= this.clock(), 'CALENDAR_RETROACTIVE_REVISION', 'Schedule revisions need an explicit prospective effective instant.');
      check(this.clock() < Date.parse(job.stopRule.deadline) && job.runs < job.stopRule.maxRuns, 'JOB_STOP_RULE', 'An expired mandate cannot acquire a new schedule.');
      const old = job.calendar; if (old?.current) { const record = old.records.find(x => x.id === old.current)!; record.status = 'obsolete'; record.reason = 'objective-changed'; delete old.current; }
      const c: JobCalendar = { definition: clean, revision: expectedScheduleRevision + 1, objectiveRevision: job.revision, digest: digest(clean), paused: old?.paused ?? false, records: old?.records ?? [], skipOverlapWindows: old?.skipOverlapWindows ?? [], retiredDefinitions: [...(old?.retiredDefinitions ?? []), ...(old ? [{ definition: old.definition, revision: old.revision, objectiveRevision: old.objectiveRevision, replacedAt: this.timestamp() }] : [])] };
      // A stable business identity policy cannot be changed to evade existing tombstones.
      check(!old || old.definition.identityBasis === clean.identityBasis, 'CALENDAR_IDENTITY_CHANGED', 'Business-period identity is immutable for this mandate. Create a separately reviewed mandate to change it.');
      check(!old || (old.definition.dst.overlap === 'both') === (clean.dst.overlap === 'both'), 'CALENDAR_IDENTITY_CHANGED', 'Single-run versus both-fold multiplicity is immutable for this mandate.');
      job.calendar = c; const evaluation = this.calendarEvaluation(job); job.nextRunAt = evaluation.nextRunAt ?? clean.stop.until; job.scheduleAnchor = clean.effectiveFrom; delete job.approval; job.status = 'scheduled'; job.digest = this.identity(job);
      job.ledger.push({ at: this.timestamp(), event: 'calendar-revised', reason: `replace-immediately; schedule ${c.revision}; objective ${job.revision}; new coverage ${clean.effectiveFrom}` }); audit(state, 'job.calendar-revised', { jobId: id, scheduleRevision: c.revision, objectiveRevision: job.revision, replacement, effectiveFrom: clean.effectiveFrom }); return this.view(context, job, state);
    });
  }
  /** This controls future claims only. Generic pause/cancel separately interrupt current work. */
  async pauseCalendar(context: Context, id: string): Promise<Job> { return this.setCalendarPause(context, id, true); }
  async resumeCalendar(context: Context, id: string): Promise<Job> { return this.setCalendarPause(context, id, false); }
  private async setCalendarPause(context: Context, id: string, paused: boolean): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole && !context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'The pinned owner controls future calendar claims inside the app.'); check(job.calendar && !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status), 'INVALID_JOB_STATE', 'A terminal mandate cannot resume its calendar.'); job.calendar.paused = paused; job.ledger.push({ at: this.timestamp(), event: paused ? 'calendar-paused' : 'calendar-resumed' }); return this.view(context, job, state); }); }
  owner(state: State, context: Context, job: Job) {
    current(state, context, 'approve'); check(context.memberId === job.ownerId || context.role === 'owner', 'JOB_OWNER_REQUIRED', 'Only its owner or the workspace owner may control this job.');
    this.sources(state, context, job, job.sourceIds);
  }
  private evidenceView(state: State): StateStore {
    return { read: () => structuredClone(state), update: async () => { throw new Error('Job evidence is read-only.'); } };
  }
  view(context: Context, job: Job, state = this.store.read()): Job {
    const view = structuredClone(job);
    if (job.ownerId !== context.memberId || job.ownerEpoch !== context.epoch || job.ownerRole !== context.role) { delete view.input; delete view.plan; delete view.execution; delete view.archivedExecutions; }
    if (Object.hasOwn(view, 'deliverable')) {
      let allowed = false;
      if (job.ownerId === context.memberId && job.ownerEpoch === context.epoch && job.ownerRole === context.role) { try { allowed = this.deliverableGuard?.(context, structuredClone(job), this.evidenceView(state)) === true; } catch { allowed = false; } }
      if (!allowed) delete view.deliverable;
    }
    // Intermediate results have the same release boundary as the final deliverable.
    if (view.execution) { try { sourceAccess(state, context, view.execution.sourceIds); for (const attempt of view.execution.attempts) delete attempt.settlement; } catch { delete view.execution; } }
    if (view.archivedExecutions) view.archivedExecutions = view.archivedExecutions.filter(execution => { try { sourceAccess(state, context, execution.sourceIds); for (const attempt of execution.attempts) delete attempt.settlement; return true; } catch { return false; } });
    return view;
  }
  list(context: Context): Job[] {
    const state = this.store.read(); authorize(this.evidenceView(state), context); const visible: Job[] = [];
    for (const job of state.jobs as Job[]) {
      // An empty source list is not an organization-wide sharing grant. Goals and budgets are private too.
      if (job.ownerId !== context.memberId || job.ownerEpoch !== context.epoch || job.ownerRole !== context.role) continue;
      try { this.sources(state, context, job, job.sourceIds); } catch { continue; }
      visible.push(this.view(context, job, state));
    }
    return visible;
  }
  async create(context: Context, config: JobConfig): Promise<Job> {
    config = json(config);
    if (Object.hasOwn(config, 'calendar')) { check(['nextRunAt', 'intervalMs', 'catchup', 'graceMs'].every(key => !Object.hasOwn(config, key)), 'AMBIGUOUS_JOB_SCHEDULE', 'Supply either an explicit calendar or an elapsed interval schedule.'); config.calendar = validateCalendar(config.calendar!, this.calendarPorts().rules, this.calendarPorts().bounds); }
    check(config.type === undefined || (typeof config.type === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(config.type)), 'INVALID_JOB_TYPE', 'Use a named installed runner type.');
    const actions = jobActions(config.actions, config.plan ? config.allowedActions : undefined);
    const reviewOn = config.reviewOn !== undefined ? reviewDate(config.reviewOn) : undefined;
    check(!context.sourceTainted, 'TAINTED_JOB', 'Imported text cannot create an autonomous mandate.');
    check(typeof config.goal === 'string' && config.goal.trim().length >= 5 && config.goal.length <= 2000, 'INVALID_GOAL', 'A job needs a concrete goal.');
    const budget = amount(config.budgetMinor); const reservation = amount(config.reserveMinor ?? config.budgetMinor);
    check(budget > 0n && reservation > 0n && reservation <= budget, 'INVALID_BUDGET', 'A positive reservation must fit within the budget.');
    check(config.stopRule && Number.isInteger(config.stopRule.maxRuns) && config.stopRule.maxRuns > 0 && config.stopRule.maxRuns <= 10000, 'STOP_RULE_REQUIRED', 'Set a maximum number of runs.');
    check(Number.isFinite(Date.parse(config.stopRule.deadline)) && Date.parse(config.stopRule.deadline) > this.clock(), 'STOP_RULE_REQUIRED', 'Set a future stop deadline.');
    const intervalMs = config.intervalMs ?? 86400000; check(Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 31536000000, 'INVALID_SCHEDULE', 'Intervals must be between a second and a year.');
    const nextRunAt = config.nextRunAt ?? this.timestamp(); check(Number.isFinite(Date.parse(nextRunAt)), 'INVALID_SCHEDULE', 'Set a valid due time.');
    const catchup = config.catchup ?? 'latest'; check(['latest', 'skip'].includes(catchup), 'INVALID_SCHEDULE', 'Use a skip or latest catch-up policy.');
    const graceMs = config.graceMs ?? 60000; check(Number.isSafeInteger(graceMs) && graceMs >= 0 && graceMs <= intervalMs, 'INVALID_SCHEDULE', 'Grace must fit the interval.');
    if (config.plan) { check(config.limits, 'INVALID_JOB_LIMITS', 'A durable plan needs explicit ceilings.'); validatePlan(config.plan, String(reservation), config.limits); json(config.input); check(typeof config.background === 'boolean', 'INVALID_SCHEDULE', 'Declare whether this job may run in background.'); check(Array.isArray(config.allowedActions) && Array.isArray(config.testedRoutes) && [...config.allowedActions, ...config.testedRoutes].every(value => typeof value === 'string' && value.length > 0), 'INVALID_JOB_PLAN', 'Declare exact actions and tested model routes.'); }
    return this.store.update(state => {
      current(state, context, 'approve'); const member = state.members.find(m => m.id === (config.ownerId ?? context.memberId));
      check(member?.active && ['owner', 'cofounder'].includes(member.role), 'JOB_OWNER_REQUIRED', 'A job needs an active owner or cofounder.');
      const sourceIds = [...new Set(config.sourceIds ?? [])].sort(); this.sources(state, context, config, sourceIds); this.sources(state, { memberId: member.id, role: member.role, epoch: member.epoch }, config, sourceIds);
      const job: Job = { id: newId('job'), goal: config.goal.trim(), ownerId: member.id, ownerEpoch: member.epoch, ownerRole: member.role, budgetMinor: String(budget), reserveMinor: String(reservation), spentMinor: '0', reservedMinor: '0', stopRule: structuredClone(config.stopRule), nextRunAt, intervalMs, catchup, graceMs, requiresApproval: config.requiresApproval === true, sourceIds, revision: 1, digest: '', runs: 0, fence: 0, status: 'scheduled', createdAt: this.timestamp(), ledger: [{ at: this.timestamp(), event: 'created' }] };
      if (config.type) job.type = config.type;
      if (actions) job.actions = actions;
      if (reviewOn) job.reviewOn = reviewOn;
      if (config.calendar) { job.calendar = { definition: config.calendar, revision: 1, objectiveRevision: 1, digest: digest(config.calendar), paused: false, records: [], skipOverlapWindows: [], retiredDefinitions: [] }; const evaluation = this.calendarEvaluation(job); job.nextRunAt = evaluation.nextRunAt ?? config.calendar.stop.until; }
      job.scheduleAnchor = config.calendar?.effectiveFrom ?? nextRunAt;
      if (config.plan) { job.input = json(config.input); job.plan = json(config.plan); job.limits = json(config.limits!); job.allowedActions = [...new Set(config.allowedActions!)].sort(); job.testedRoutes = [...new Set(config.testedRoutes!)].sort(); job.background = config.background; }
      job.digest = this.identity(job); state.jobs.push(job); audit(state, 'job.created', { jobId: job.id, ownerId: member.id, budgetMinor: job.budgetMinor }); return this.view(context, job, state);
    });
  }
  async approve(context: Context, id: string, expectedDigest: string): Promise<Job> {
    return this.store.update(state => {
      const job = this.find(state, id); this.owner(state, context, job); check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Mandates must be approved inside the app.');
      check(expectedDigest === job.digest && job.digest === this.identity(job), 'PREVIEW_CHANGED', 'The job configuration changed. Review it again.');
      check(['scheduled', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait', 'paused'].includes(job.status) && !job.deliverable && !job.execution?.attempts.some(a => ['dispatched', 'unknown'].includes(a.status)), 'INVALID_JOB_STATE', 'This job cannot be approved in its current state. Amend a rejected objective before rerunning.');
      job.approval = { digest: expectedDigest, revision: job.revision, memberId: context.memberId, epoch: context.epoch, role: context.role }; job.status = 'scheduled'; job.ledger.push({ at: this.timestamp(), event: 'approved' }); return this.view(context, job, state);
    });
  }
  async pause(context: Context, id: string): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); check(!['accepted', 'stopped', 'revoked', 'cancelled', 'awaiting-acceptance'].includes(job.status), 'INVALID_JOB_STATE', 'This job has stopped or awaits acceptance.'); this.interrupt(job, 'paused', 'paused'); audit(state, 'job.paused', { jobId: id }); return this.view(context, job, state); }); }
  async resume(context: Context, id: string): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); check(!context.sourceTainted && context.channel !== 'phone', 'TAINTED_JOB', 'Resume mandates inside the app.'); check(['paused', 'approval-blocked', 'budget-blocked', 'runner-blocked', 'network-wait'].includes(job.status) && !job.execution?.attempts.some(a => ['dispatched', 'unknown'].includes(a.status)), 'INVALID_JOB_STATE', 'Only a resolved paused or blocked job may resume.'); check(!job.deliverable, 'INVALID_JOB_STATE', 'Accept or reject the saved result first.'); job.status = 'scheduled'; job.ledger.push({ at: this.timestamp(), event: 'resumed' }); return this.view(context, job, state); }); }
  async remove(context: Context, id: string): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); this.interrupt(job, 'stopped', 'deleted'); audit(state, 'job.deleted', { jobId: id }); return this.view(context, job, state); }); }
  async cancel(context: Context, id: string): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); this.interrupt(job, 'cancelled', 'cancelled'); audit(state, 'job.cancelled', { jobId: id }); return this.view(context, job, state); }); }
  interrupt(job: Job, status: 'scheduled' | 'paused' | 'cancelled' | 'revoked' | 'stopped', event: string): Job['status'] {
    const unresolved = job.execution?.attempts.filter(a => ['dispatched', 'unknown'].includes(a.status)) ?? [];
    if (unresolved.length) { for (const attempt of unresolved) { attempt.status = 'unknown'; attempt.reason = event; } job.execution!.afterReconcile = status; delete job.lease; job.status = ['cancelled', 'revoked', 'stopped'].includes(status) ? status : 'outcome-unknown'; }
    else { this.release(job); job.status = status; }
    job.fence += 1; job.ledger.push({ at: this.timestamp(), event, fence: job.fence });
    return job.status;
  }
  release(job: Job) { if (job.lease) { job.reservedMinor = String(amount(job.reservedMinor) - (amount(job.lease.reservedMinor) - amount(job.lease.chargedMinor))); delete job.lease; } }
  validateLease(job: Job, lease: Pick<Lease, 'token' | 'workerId' | 'fence'>) { check(job.status === 'running' && job.lease?.token === lease.token && job.lease.workerId === lease.workerId && job.fence === lease.fence && Date.parse(job.lease.expiresAt) > this.clock(), 'STALE_LEASE', 'The worker lease expired or was fenced off.'); }
  /** Reservations persist before work starts, so concurrent workers cannot overspend. */
  async acquire(context: Context, id: string, workerId: string, leaseMs = 30000): Promise<Job> {
    check(typeof workerId === 'string' && workerId.length >= 1 && workerId.length <= 100, 'INVALID_WORKER', 'Use a worker ID.');
    check(Number.isSafeInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 300000, 'INVALID_LEASE', 'Lease duration must be 100 ms–5 minutes.');
    return this.store.update(state => {
      current(state, context, 'prepare'); check(!context.sourceTainted && context.channel !== 'phone', 'TAINTED_JOB', 'Only the local scheduler may acquire work.');
      const job = this.find(state, id); this.sources(state, context, job, job.sourceIds);
      check(context.memberId === job.ownerId || context.role === 'owner', 'JOB_OWNER_REQUIRED', 'The worker must use its owner’s context.');
      const owner = state.members.find(m => m.id === job.ownerId);
      if (!owner?.active || owner.epoch !== job.ownerEpoch || owner.role !== job.ownerRole) { this.interrupt(job, 'revoked', 'revoked'); return this.view(context, job, state); }
      if (job.status === 'running') {
        check(job.lease && Date.parse(job.lease.expiresAt) <= this.clock(), 'JOB_BUSY', 'Another worker holds this job.'); if (this.interrupt(job, 'scheduled', 'lease-expired') === 'outcome-unknown') return this.view(context, job, state);
      }
      check(!['paused', 'revoked', 'accepted', 'cancelled', 'stopped', 'awaiting-acceptance', 'outcome-unknown', 'runner-blocked'].includes(job.status), 'JOB_NOT_RUNNABLE', 'This job is paused, stopped, unresolved or awaiting acceptance.');
      if (this.stopExpired(job)) return this.view(context, job, state);
      if (job.calendar) {
        if (job.calendar.objectiveRevision !== job.revision) { job.status = 'runner-blocked'; job.ledger.push({ at: this.timestamp(), event: 'calendar-objective-changed' }); return this.view(context, job, state); }
        if (job.calendar.paused && !job.calendar.current) return this.view(context, job, state);
      }
      if (!state.policy.autonomy) { job.status = 'approval-blocked'; job.ledger.push({ at: this.timestamp(), event: 'autonomy-disabled' }); return this.view(context, job, state); }
      if (job.requiresApproval) {
        const approval = job.approval; const approver = approval && state.members.find(m => m.id === approval.memberId);
        if (!approval || approval.digest !== this.identity(job) || approval.revision !== job.revision || !approver?.active || approver.epoch !== approval.epoch || approver.role !== approval.role) { job.status = 'approval-blocked'; job.ledger.push({ at: this.timestamp(), event: 'approval-required' }); return this.view(context, job, state); }
      }
      let calendarEvaluation: CalendarEvaluation | undefined;
      if (job.calendar && !job.calendar.current) {
        try { calendarEvaluation = this.calendarEvaluation(job); } catch (error) { job.status = 'runner-blocked'; job.ledger.push({ at: this.timestamp(), event: 'blocked', reason: (error as { code?: string }).code ?? 'CALENDAR_UNQUALIFIED' }); return this.view(context, job, state); }
        if (this.stopExpired(job)) return this.view(context, job, state);
        if (!calendarEvaluation.selected.length) { this.calendarDecisions(job, calendarEvaluation); job.nextRunAt = calendarEvaluation.nextRunAt ?? job.calendar.definition.stop.until; if (!calendarEvaluation.nextRunAt) { job.status = 'stopped'; job.ledger.push({ at: this.timestamp(), event: 'calendar-exhausted' }); } return this.view(context, job, state); }
      } else check(this.clock() >= Date.parse(job.nextRunAt), 'JOB_NOT_DUE', 'This job is not due.');
      if (!job.calendar && !job.execution && job.catchup === 'skip' && this.clock() - Date.parse(job.nextRunAt) > job.graceMs) {
        const missed = Math.floor((this.clock() - Date.parse(job.nextRunAt)) / job.intervalMs) + 1;
        job.nextRunAt = new Date(Date.parse(job.nextRunAt) + missed * job.intervalMs).toISOString(); job.status = 'scheduled'; job.ledger.push({ at: this.timestamp(), event: 'catchup-skipped', reason: `${missed} due runs skipped` }); return this.view(context, job, state);
      }
      check(job.digest === this.identity(job), 'PREVIEW_CHANGED', 'The mandate changed. Review it again.');
      const runCost = (job.execution?.attempts ?? []).reduce((sum, attempt) => sum + amount(attempt.settlement?.spentMinor ?? '0'), 0n);
      const reserve = amount(job.reserveMinor) - runCost;
      if (this.stopExpired(job)) return this.view(context, job, state);
      if (amount(job.spentMinor) + amount(job.reservedMinor) + reserve > amount(job.budgetMinor)) { job.status = 'budget-blocked'; job.ledger.push({ at: this.timestamp(), event: 'budget-exhausted' }); return this.view(context, job, state); }
      let admittedCalendar: JobCalendar | undefined;
      let admittedOccurrence: JobCalendar['records'][number] | undefined;
      if (job.calendar && calendarEvaluation) {
        // Prepare the bounded audit work separately so expiry cannot persist a partial coalescing/claim.
        const candidate = { ...job, calendar: structuredClone(job.calendar) };
        this.calendarDecisions(candidate, calendarEvaluation); const c = candidate.calendar; const occurrence = calendarEvaluation.selected[0]; const prior = c.records.find(x => x.id === occurrence.id);
        if (prior) { check(prior.status === 'deferred', 'CALENDAR_OCCURRENCE_CONSUMED', 'This business period was already consumed.'); Object.assign(prior, occurrence); prior.status = 'admitted'; prior.at = this.timestamp(); prior.scheduleRevision = c.revision; prior.objectiveRevision = job.revision; delete prior.reason; if (calendarEvaluation.representedIds.length) prior.representedIds = [...calendarEvaluation.representedIds]; else delete prior.representedIds; }
        else c.records.push({ ...occurrence, status: 'admitted', scheduleRevision: c.revision, objectiveRevision: job.revision, at: this.timestamp(), ...(calendarEvaluation.representedIds.length ? { representedIds: [...calendarEvaluation.representedIds] } : {}) });
        c.current = occurrence.id; admittedCalendar = c; admittedOccurrence = prior ?? c.records[c.records.length - 1];
      }
      const reservedMinor = String(amount(job.reservedMinor) + reserve);
      const admittedAt = this.clock(); if (this.stopExpired(job, admittedAt)) return this.view(context, job, state);
      const admissionTimestamp = new Date(admittedAt).toISOString();
      if (admittedCalendar && admittedOccurrence) { admittedOccurrence.at = admissionTimestamp; job.calendar = admittedCalendar; job.nextRunAt = admittedOccurrence.instant!; job.ledger.push({ at: admissionTimestamp, event: 'calendar-admitted', reason: admittedOccurrence.id }); }
      job.fence += 1; job.reservedMinor = reservedMinor;
      job.lease = { token: newId('lease'), workerId, fence: job.fence, expiresAt: new Date(admittedAt + leaseMs).toISOString(), reservedMinor: String(reserve), chargedMinor: '0' }; job.status = 'running'; job.ledger.push({ at: admissionTimestamp, event: 'reserved', fence: job.fence, amountMinor: String(reserve) }); return this.view(context, job, state);
    });
  }
  async charge(context: Context, id: string, lease: Pick<Lease, 'token' | 'workerId' | 'fence'>, chargeMinor: string): Promise<Job> {
    const cost = amount(chargeMinor); return this.store.update(state => {
      current(state, context, 'prepare'); const job = this.find(state, id); this.sources(state, context, job, job.sourceIds); this.validateLease(job, lease);
      check(context.memberId === job.ownerId || context.role === 'owner', 'JOB_OWNER_REQUIRED', 'Only the job owner may account for its cost.');
      check(amount(job.lease!.chargedMinor) + cost <= amount(job.lease!.reservedMinor), 'BUDGET_EXCEEDED', 'This cost exceeds the reserved budget.');
      job.lease!.chargedMinor = String(amount(job.lease!.chargedMinor) + cost); job.reservedMinor = String(amount(job.reservedMinor) - cost); job.spentMinor = String(amount(job.spentMinor) + cost); job.ledger.push({ at: this.timestamp(), event: 'cost', fence: lease.fence, amountMinor: String(cost) }); return this.view(context, job, state);
    });
  }
  async heartbeat(context: Context, id: string, lease: Pick<Lease, 'token' | 'workerId' | 'fence'>, leaseMs = 30000): Promise<Job> { check(Number.isSafeInteger(leaseMs) && leaseMs >= 100 && leaseMs <= 300000, 'INVALID_LEASE', 'Invalid lease duration.'); return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); this.validateLease(job, lease); job.lease!.expiresAt = new Date(this.clock() + leaseMs).toISOString(); return this.view(context, job, state); }); }
  async complete(context: Context, id: string, lease: Pick<Lease, 'token' | 'workerId' | 'fence'>, deliverable: unknown, totalSpentMinor: string): Promise<Job> {
    const totalCost = amount(totalSpentMinor); const clean = JSON.parse(canonical(deliverable));
    return this.store.update(state => {
      current(state, context, 'prepare'); const job = this.find(state, id); this.sources(state, context, job, job.sourceIds); this.validateLease(job, lease);
      check(context.memberId === job.ownerId || context.role === 'owner', 'JOB_OWNER_REQUIRED', 'Only the job owner may complete its run.');
      if (job.plan) { const verified = new Set(job.execution?.attempts.filter(a => a.status === 'verified').map(a => a.stepId)); check(job.execution?.objectiveRevision === job.revision && job.execution.planDigest === digest(job.plan) && job.plan.steps.every(step => verified.has(step.id)) && [...job.plan.children, ...job.plan.obligations].every(group => group.requiredStepIds.every(stepId => verified.has(stepId))), 'JOB_INCOMPLETE', 'Required child results or original objective obligations are missing.'); }
      check(totalCost >= amount(job.lease!.chargedMinor) && totalCost <= amount(job.lease!.reservedMinor), 'BUDGET_EXCEEDED', 'The final cost must fit its reservation and include earlier charges.');
      // Recheck the freshly produced brief inside the same authority transaction.
      // Stale evidence is retained historically, never committed as an acceptable result.
      if (job.type === 'owner-brief' && !job.plan && this.deliverableGuard) {
        const candidate = { ...structuredClone(job), deliverable: clean };
        check(this.deliverableGuard(context, candidate, this.evidenceView(state)) === true,
          'JOB_EVIDENCE_REVOKED', 'The brief evidence changed before its result could be committed.');
      }
      const additional = totalCost - amount(job.lease!.chargedMinor); job.spentMinor = String(amount(job.spentMinor) + additional); job.reservedMinor = String(amount(job.reservedMinor) - additional); job.lease!.chargedMinor = String(totalCost); this.release(job);
      if (job.calendar?.current) job.calendar.records.find(x => x.id === job.calendar!.current)!.status = 'delivered';
      const admitted = job.ledger.findLast(entry => entry.event === 'reserved' && entry.fence === lease.fence); const durationMs = admitted ? Math.max(0, this.clock() - Date.parse(admitted.at)) : undefined;
      job.runs += 1; job.deliverable = clean; job.status = 'awaiting-acceptance'; job.ledger.push({ at: this.timestamp(), event: 'delivered', fence: lease.fence, amountMinor: String(totalCost), ...(Number.isSafeInteger(durationMs) ? { durationMs } : {}) }); audit(state, 'job.delivered', { jobId: id, spentMinor: job.spentMinor }); return this.view(context, job, state);
    });
  }
  async accept(context: Context, id: string, repeat = false, reference?: JobAcceptanceReference): Promise<Job> {
    check(reference === undefined || reference !== null && typeof reference === 'object' && !Array.isArray(reference)
      && Object.getPrototypeOf(reference) === Object.prototype
      && Object.keys(reference).length === 5 && Object.keys(reference).every(key => ['kind', 'id', 'revision', 'digest', 'deliverableDigest'].includes(key))
      && reference.kind === 'job-acceptance' && typeof reference.id === 'string' && reference.id.length >= 1 && reference.id.length <= 200
      && Number.isSafeInteger(reference.revision) && reference.revision >= 1
      && typeof reference.digest === 'string' && /^[a-f0-9]{64}$/.test(reference.digest)
      && typeof reference.deliverableDigest === 'string' && /^[a-f0-9]{64}$/.test(reference.deliverableDigest),
    'INVALID_JOB_ACCEPTANCE_REFERENCE', 'Supply the complete exact reviewed acceptance reference.');
    const expected = reference === undefined ? undefined : structuredClone(reference);
    return this.store.update(state => {
      const job = this.find(state, id); this.owner(state, context, job); check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole, 'JOB_OWNER_REQUIRED', 'Only the pinned owner may accept the result.'); check(!context.sourceTainted && context.channel !== 'phone', 'APP_ACCEPTANCE_REQUIRED', 'Accept delivered work inside the app.'); check(job.status === 'awaiting-acceptance', 'INVALID_JOB_STATE', 'A human can accept a delivered result.');
      check(!expected || expected.id === id && expected.revision === job.revision && expected.digest === job.digest
        && job.digest === this.identity(job) && job.deliverable !== undefined && expected.deliverableDigest === digest(job.deliverable),
      'PREVIEW_CHANGED', 'Review this exact current objective and deliverable before accepting it.');
      if (job.plan || job.type === 'owner-brief') check(this.deliverableGuard?.(context, structuredClone(job), this.evidenceView(state)) === true, 'JOB_EVIDENCE_REVOKED', 'Accept only currently accessible evidence for this exact objective.');
      job.ledger.push({ at: this.timestamp(), event: 'accepted' }); job.status = 'accepted';
      if (job.calendar?.current) { const c = job.calendar; const record = c.records.find(x => x.id === c.current)!; record.status = 'accepted'; if (c.definition.overlap === 'skip') c.skipOverlapWindows.push({ from: record.at, to: this.timestamp() }); delete c.current; }
      if (repeat && job.runs < job.stopRule.maxRuns && this.clock() < Date.parse(job.stopRule.deadline) && (!job.calendar || this.clock() < calendarInstant(job.calendar.definition.stop.until))) { if (job.calendar) job.nextRunAt = this.timestamp(); else { const periods = Math.max(1, Math.floor((this.clock() - Date.parse(job.nextRunAt)) / job.intervalMs) + 1); job.nextRunAt = new Date(Date.parse(job.nextRunAt) + periods * job.intervalMs).toISOString(); } job.status = 'scheduled'; delete job.approval; if (job.execution) (job.archivedExecutions ??= []).push(job.execution); delete job.execution; delete job.deliverable; }
      audit(state, 'job.accepted', { jobId: id, repeat }); return this.view(context, job, state);
    });
  }
  async reject(context: Context, id: string, reason: string): Promise<Job> { return this.store.update(state => { const job = this.find(state, id); this.owner(state, context, job); check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole && !context.sourceTainted && context.channel !== 'phone', 'APP_ACCEPTANCE_REQUIRED', 'The pinned owner rejects work inside the app.'); check(job.status === 'awaiting-acceptance', 'INVALID_JOB_STATE', 'No delivered result to reject.'); job.status = 'paused'; job.ledger.push({ at: this.timestamp(), event: 'rejected', reason: String(reason).slice(0, 1000) }); return this.view(context, job, state); }); }
  /** WK-09. The review date is shown on the card and is not authority: changing it keeps the approval. */
  async setReviewDate(context: Context, id: string, reviewOn: string | null): Promise<Job> {
    const value = reviewOn === null ? null : reviewDate(reviewOn);
    return this.store.update(state => {
      const job = this.find(state, id); this.owner(state, context, job); check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Set a review date inside the app.');
      if (value) job.reviewOn = value; else delete job.reviewOn;
      job.ledger.push({ at: this.timestamp(), event: 'review-date-set', ...(value ? { reason: value } : {}) }); audit(state, 'job.review-date-set', { jobId: id, reviewOn: value }); return this.view(context, job, state);
    });
  }
  /** WK-16. Only the pinned owner marks a person step done; the job never does it by itself. A job waiting on it resumes. */
  async personStepDone(context: Context, id: string, stepId: string): Promise<Job> {
    check(typeof stepId === 'string' && stepId.length >= 1 && stepId.length <= 64, 'PERSON_STEP_NOT_FOUND', 'Name a step for a person in this job.');
    return this.store.update(state => {
      const job = this.find(state, id); this.owner(state, context, job);
      check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole, 'JOB_OWNER_REQUIRED', 'Only the job\'s owner marks a person step done.');
      check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Mark a person step done inside the app.');
      check(!['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status), 'INVALID_JOB_STATE', 'This job has finished.');
      const step = job.plan?.steps.find(item => item.id === stepId); check(step?.provider === 'person', 'PERSON_STEP_NOT_FOUND', 'Name a step for a person in this job.');
      const verified = job.execution?.objectiveRevision === job.revision && job.execution.attempts.some(attempt => attempt.stepId === stepId && attempt.status === 'verified');
      check(!verified && !job.ledger.some(entry => entry.event === 'person-step-done' && entry.stepId === stepId && entry.revision === job.revision), 'PERSON_STEP_ALREADY_DONE', 'This step is already done.');
      const at = this.clock(); job.ledger.push({ at: new Date(at).toISOString(), event: 'person-step-done', stepId, by: context.memberId, revision: job.revision });
      const blocked = job.ledger.findLast(entry => entry.event === 'blocked');
      if (job.status === 'runner-blocked' && blocked?.reason === PERSON_WAITING && blocked.stepId === stepId) {
        // The wait for a person does not count against the plan's own wall-time ceiling.
        if (job.execution) job.execution.personWaitMs = (job.execution.personWaitMs ?? 0) + Math.max(0, at - Date.parse(blocked.at));
        job.status = 'scheduled'; if (Date.parse(job.nextRunAt) > at) job.nextRunAt = new Date(at).toISOString(); job.ledger.push({ at: new Date(at).toISOString(), event: 'resumed', reason: 'person-step-done', stepId });
      }
      audit(state, 'job.person-step-done', { jobId: id, stepId, memberId: context.memberId }); return this.view(context, job, state);
    });
  }
  /** WK-08 meters from the ledger: clock time of delivered runs and the money the job's named actions may touch. Owner only. */
  meters(context: Context, id: string): JobMeters {
    const state = this.store.read(); authorize(this.evidenceView(state), context); const job = this.find(state, id);
    check(job.ownerId === context.memberId && job.ownerEpoch === context.epoch && job.ownerRole === context.role, 'JOB_OWNER_REQUIRED', 'Only the job\'s owner reads its meters.');
    this.sources(state, context, job, job.sourceIds);
    const durations = job.ledger.filter(entry => entry.event === 'delivered' && Number.isSafeInteger(entry.durationMs) && entry.durationMs! >= 0).map(entry => entry.durationMs!);
    const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
    const deliverable = job.deliverable as { actionIds?: unknown; result?: { actionIds?: unknown } } | undefined;
    const named = new Set([...job.ledger.map(entry => entry.actionId).filter((item): item is string => typeof item === 'string'), ...strings(deliverable?.actionIds), ...strings(deliverable?.result?.actionIds)]);
    const open = (state.actions as { id: string; status: string; payload?: { amountMinor?: unknown }; sourceIds: string[] }[]).filter(action => {
      if (!named.has(action.id) || !['prepared', 'approved', 'executing', 'verified'].includes(action.status)) return false;
      try { sourceAccess(state, context, action.sourceIds); return true; } catch { return false; }
    });
    const amounts = open.map(action => action.payload?.amountMinor).filter((value): value is string => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));
    const counted = open.length > 0 || (job.actions?.length ?? 0) > 0;
    return { jobId: job.id, clockMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) : null, exposureMinor: counted ? String(amounts.reduce((sum, value) => sum + BigInt(value), 0n)) : null, actions: [...(job.actions ?? [])], reviewOn: job.reviewOn ?? null };
  }
}
