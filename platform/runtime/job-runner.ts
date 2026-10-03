import { check, audit, ChausarError } from './contracts.ts';
import type { Context, State } from './contracts.ts';
import { current, digest, sourceAccess, canonical, ActionService } from './actions.ts';
import type { PrepareAction, PreparedAction } from './actions.ts';
import { JobService } from './jobs.ts';
import type { Job, JobConfig, Lease } from './jobs.ts';
import { json, money, validatePlan, validateSettlement } from './job-protocol.ts';
import type { GoalPlan, GoalStep, StepResult, ProviderSettlement, StepAttempt, Json } from './job-protocol.ts';

export type GoalRunner<Input = unknown> = {
  type: string; version: string;
  validate: (input: unknown) => Input;
  plan: (input: Input) => GoalPlan;
  /** Trusted installed-runner admission, inside the mandate transaction; never supplied by RPC. */
  admit?: (state: State, context: Context, input: Input, config: JobConfig, previous?: Job) => Input;
  deliver: (input: Input, results: Record<string, StepResult>) => Json;
  /** Current permission/evidence check, including every intermediate result used after restart. */
  release: (context: Context, result: StepResult) => boolean;
};
export type ProviderRequest = {
  key: string; step: GoalStep; context: Context; signal: AbortSignal;
  inputs: Record<string, { producerKey: string; objectiveRevision: number; result: StepResult }>;
};
export type Reconciliation =
  | { outcome: 'unknown' }
  | { outcome: 'verified'; id: string; settlement: ProviderSettlement }
  | { outcome: 'absent'; id: string; spentMinor: string; modelUnits: number; durationMs: number; actionExposureMinor: string }
  | { outcome: 'blocked'; id: string; reason: string; spentMinor: string; modelUnits: number; durationMs: number; actionExposureMinor: string };
export type GoalProvider = { id: string; kind: 'read-only'; transport: 'local' | 'remote'; model: boolean; authorize?: (state: State, context: Context, request: ProviderRequest, mode: 'dispatch' | 'readback') => void; dispatch: (request: ProviderRequest) => Promise<ProviderSettlement>; reconcile: (request: ProviderRequest) => Promise<Reconciliation> }
  | { id: string; kind: 'prepare-action'; transport: 'local'; model: false };
export type RunnerOptions = {
  workerId: string; maxActiveJobs: number; leaseMs: number;
  networkAvailable: () => boolean;
  actions?: ActionService;
};
type LeaseIdentity = Pick<Lease, 'token' | 'workerId' | 'fence'>;

/** Uses the existing store and lease authority. No timer, hosted scheduler, or provider is installed here. */
export class DurableJobRunner {
  jobs: JobService; runners: Map<string, GoalRunner<any>>; providers: Map<string, GoalProvider>; options: RunnerOptions;
  private busy = false;
  private signals = new Map<string, AbortController>();
  private readbacks = new Set<AbortController>();
  private interruptors = new Set<() => void>();
  constructor(jobs: JobService, runners: GoalRunner<any>[], providers: GoalProvider[], options: RunnerOptions) {
    check(typeof options.workerId === 'string' && options.workerId.length >= 1 && options.workerId.length <= 100 && Number.isSafeInteger(options.maxActiveJobs) && options.maxActiveJobs > 0 && Number.isSafeInteger(options.leaseMs) && options.leaseMs >= 100 && options.leaseMs <= 300000 && typeof options.networkAvailable === 'function', 'INVALID_JOB_RUNNER', 'Supply explicit worker, active-job, lease and transport policy.');
    this.jobs = jobs; this.options = options; this.runners = new Map(); this.providers = new Map();
    for (const runner of runners) { check(/^[a-z][a-z0-9-]{0,63}$/.test(runner.type) && runner.version.length > 0 && !this.runners.has(runner.type) && typeof runner.release === 'function', 'INVALID_JOB_RUNNER', 'Install unique versioned runners with current release checks.'); this.runners.set(runner.type, runner); }
    for (const provider of providers) { check(/^[a-z][a-z0-9-]{0,63}$/.test(provider.id) && !this.providers.has(provider.id) && ['read-only', 'prepare-action'].includes(provider.kind) && ['local', 'remote'].includes(provider.transport) && typeof provider.model === 'boolean', 'INVALID_JOB_PROVIDER', 'Install explicit read or action-preparation providers.'); if (provider.kind === 'read-only') { check(typeof provider.dispatch === 'function' && typeof provider.reconcile === 'function', 'INVALID_JOB_PROVIDER', 'Every dispatched provider needs readback.'); check(provider.transport === 'local' || typeof provider.authorize === 'function', 'INVALID_JOB_PROVIDER', 'Remote providers need an explicit current read and exact egress authority.'); } else check(provider.transport === 'local' && !provider.model && options.actions, 'INVALID_JOB_PROVIDER', 'Action previews use the local ActionService.'); this.providers.set(provider.id, provider); }
  }
  runner(type?: string) { const runner = type && this.runners.get(type); check(runner, 'JOB_TYPE_UNSUPPORTED', 'This goal has no installed typed runner.'); return runner; }
  async create(context: Context, config: Omit<JobConfig, 'plan'> & { type: string }): Promise<Job> {
    config = json(config);
    const runner = this.runner(config.type); const input = json(runner.validate(json(config.input))); const plan = json(runner.plan(input));
    check(plan.runnerVersion === runner.version, 'JOB_RUNNER_CHANGED', 'The plan must pin its runner version.');
    check(config.limits, 'INVALID_JOB_LIMITS', 'Supply explicit resource ceilings.'); validatePlan(plan, config.reserveMinor ?? config.budgetMinor, config.limits);
    check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Create mandates inside the app.');
    // JobService's create and this check share one serialized store transaction.
    const store = this.jobs.store;
    const capped = new JobService({ read: () => store.read(), update: change => store.update(state => {
      check(state.jobs.filter((job: Job) => !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) || job.execution?.attempts.some(a => ['dispatched', 'unknown'].includes(a.status))).length < this.options.maxActiveJobs, 'ACTIVE_JOB_LIMIT', 'The configured active job ceiling is reached.'); return change(state);
    }) }, { clock: this.jobs.clock, deliverableGuard: this.jobs.deliverableGuard, calendarRules: this.jobs.calendarRules, calendarBounds: this.jobs.calendarBounds });
    if (!runner.admit) return capped.create(context, { ...config, input, plan, background: config.background ?? false, allowedActions: config.allowedActions ?? [], testedRoutes: config.testedRoutes ?? [] });
    return store.update(async state => {
      check(state.jobs.filter((job: Job) => !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) || job.execution?.attempts.some(a => ['dispatched', 'unknown'].includes(a.status))).length < this.options.maxActiveJobs, 'ACTIVE_JOB_LIMIT', 'The configured active job ceiling is reached.');
      const admitted = json(runner.validate(json(runner.admit!(state, context, input, config))));
      const admittedPlan = json(runner.plan(admitted));
      check(admittedPlan.runnerVersion === runner.version, 'JOB_RUNNER_CHANGED', 'The admitted plan must pin its runner version.');
      validatePlan(admittedPlan, config.reserveMinor ?? config.budgetMinor, config.limits!);
      // The existing JobService authorizes and writes into this already serialized transaction.
      // This view does not acquire another store transaction.
      const transactional = new JobService({ read: () => structuredClone(state), update: async change => await change(state) },
        { clock: this.jobs.clock, deliverableGuard: this.jobs.deliverableGuard, calendarRules: this.jobs.calendarRules, calendarBounds: this.jobs.calendarBounds });
      return transactional.create(context, { ...config, input: admitted, plan: admittedPlan, background: config.background ?? false, allowedActions: config.allowedActions ?? [], testedRoutes: config.testedRoutes ?? [] });
    });
  }
  /** Authorized objective replacement fences prior work; its uncertain effects keep their original plan. */
  async amend(context: Context, id: string, config: Omit<JobConfig, 'plan'> & { type: string }): Promise<Job> {
    config = json(config);
    check(config.calendar === undefined, 'CALENDAR_SEPARATE_REVISION', 'Revise calendars separately while the objective is idle.');
    check(!context.sourceTainted && context.channel !== 'phone', 'APP_APPROVAL_REQUIRED', 'Amend objectives inside the app.');
    const runner = this.runner(config.type); let input = json(runner.validate(json(config.input))); let plan = json(runner.plan(input));
    check(config.limits && plan.runnerVersion === runner.version && typeof config.goal === 'string' && config.goal.trim().length >= 5 && config.goal.length <= 2000, 'INVALID_JOB_PLAN', 'An amended objective needs a concrete goal and pinned plan.');
    validatePlan(plan, config.reserveMinor ?? config.budgetMinor, config.limits);
    check(money(config.budgetMinor) > 0n && money(config.reserveMinor ?? config.budgetMinor) > 0n && money(config.reserveMinor ?? config.budgetMinor) <= money(config.budgetMinor), 'INVALID_BUDGET', 'The amended reservation must fit its budget.');
    check(config.stopRule && Number.isInteger(config.stopRule.maxRuns) && config.stopRule.maxRuns > 0 && config.stopRule.maxRuns <= 10000 && Date.parse(config.stopRule.deadline) > this.jobs.clock(), 'STOP_RULE_REQUIRED', 'Set an explicit amended stop rule.');
    const amended = await this.jobs.store.update(state => {
      const job = this.jobs.find(state, id); this.jobs.owner(state, context, job); check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole, 'JOB_OWNER_REQUIRED', 'Only the pinned owner may replace the objective.');
      // A replacement runner cannot bypass the original installed admission's reconciliation obligations.
      if (job.type !== config.type && [job.execution, ...(job.archivedExecutions ?? [])].some(execution => execution?.attempts.length)) {
        const original = this.runner(job.type);
        original.admit?.(state, context, original.validate(json(job.input)), config, job);
      }
      if (runner.admit) {
        const admitted = json(runner.validate(json(runner.admit(state, context, input, config, job))));
        input = admitted; plan = json(runner.plan(admitted));
        check(plan.runnerVersion === runner.version, 'JOB_RUNNER_CHANGED', 'The admitted amendment must pin its runner version.');
        validatePlan(plan, config.reserveMinor ?? config.budgetMinor, config.limits!);
      }
      check(!['cancelled', 'revoked', 'stopped', 'accepted'].includes(job.status), 'INVALID_JOB_STATE', 'A terminal mandate cannot be revived.');
      check(config.ownerId === undefined || config.ownerId === job.ownerId, 'JOB_OWNER_REQUIRED', 'Owner replacement needs a separate ownership decision.');
      check(!job.calendar || ['nextRunAt', 'intervalMs', 'catchup', 'graceMs'].every(key => !Object.hasOwn(config, key)), 'AMBIGUOUS_JOB_SCHEDULE', 'Calendar objectives cannot acquire elapsed-interval settings.');
      const intervalMs = config.intervalMs ?? job.intervalMs; const catchup = config.catchup ?? job.catchup; const graceMs = config.graceMs ?? job.graceMs; const nextRunAt = config.nextRunAt ?? job.nextRunAt;
      check(Number.isSafeInteger(intervalMs) && intervalMs >= 1000 && intervalMs <= 31536000000 && ['latest', 'skip'].includes(catchup) && Number.isSafeInteger(graceMs) && graceMs >= 0 && graceMs <= intervalMs && Number.isFinite(Date.parse(nextRunAt)), 'INVALID_SCHEDULE', 'Supply a valid amended interval, due time and catch-up rule.');
      check(money(config.budgetMinor) >= money(job.spentMinor) + money(job.reservedMinor), 'INVALID_BUDGET', 'An amendment cannot remove spent or unresolved capacity.');
      const sources = [...new Set(config.sourceIds ?? job.sourceIds)].sort(); sourceAccess(state, context, sources);
      this.jobs.interrupt(job, 'paused', 'objective-amended');
      if (job.execution && !job.execution.attempts.some(a => ['dispatched', 'unknown'].includes(a.status))) { (job.archivedExecutions ??= []).push(job.execution); delete job.execution; }
      check((config.allowedActions ?? []).every(value => typeof value === 'string' && value.length > 0) && (config.testedRoutes ?? []).every(value => typeof value === 'string' && value.length > 0) && (config.background === undefined || typeof config.background === 'boolean'), 'INVALID_JOB_PLAN', 'Declare valid amended action, route and background permissions.');
      job.revision += 1; job.type = config.type; job.goal = config.goal.trim(); job.input = input; job.plan = plan; job.limits = json(config.limits!); job.sourceIds = sources; job.budgetMinor = config.budgetMinor; job.reserveMinor = config.reserveMinor ?? config.budgetMinor; job.stopRule = json(config.stopRule); job.allowedActions = [...new Set(config.allowedActions ?? [])].sort(); job.testedRoutes = [...new Set(config.testedRoutes ?? [])].sort(); job.background = config.background ?? false; job.requiresApproval = config.requiresApproval === true; job.nextRunAt = nextRunAt; job.scheduleAnchor = nextRunAt; job.intervalMs = intervalMs; job.catchup = catchup; job.graceMs = graceMs; delete job.approval; delete job.deliverable; job.digest = this.jobs.identity(job);
      audit(state, 'job.objective-amended', { jobId: id, revision: job.revision }); return this.jobs.view(context, job);
    }); this.signals.get(id)?.abort(); return amended;
  }
  /** A release guard for the host's JobService. Rechecks the recorded results for this runner. */
  canRelease(context: Context, job: Job): boolean {
    try { this.scope(this.jobs.store.read(), context, job); check(job.execution && job.execution.objectiveRevision === job.revision && job.plan && job.execution.planDigest === digest(job.plan) && job.digest === this.jobs.identity(job) && this.runner(job.type).version === job.plan.runnerVersion, 'JOB_EVIDENCE_REVOKED', 'The result belongs to an obsolete objective or runner.'); this.results(context, job); return job.plan.steps.every(step => this.latest(job, step.id)?.status === 'verified'); } catch { return false; }
  }
  progress(context: Context, id: string) {
    const raw = this.raw(id); this.scope(this.jobs.store.read(), context, raw); const job = this.jobs.view(context, raw);
    const verified = new Set(job.execution?.objectiveRevision === job.revision ? job.execution.attempts.filter(attempt => attempt.status === 'verified').map(attempt => attempt.stepId) : []);
    const describe = (group: { id: string; requiredStepIds: string[] }) => ({ id: group.id, missingStepIds: group.requiredStepIds.filter(stepId => !verified.has(stepId)) });
    return { jobId: job.id, objectiveRevision: job.revision, goal: job.goal, status: job.status, scheduleAnchor: job.scheduleAnchor, scheduledFor: job.execution?.scheduledFor ?? job.nextRunAt, spentMinor: job.spentMinor, reservedMinor: job.reservedMinor, budgetMinor: job.budgetMinor, meters: job.execution?.meters, remainingStepIds: job.plan?.steps.filter(step => !verified.has(step.id)).map(step => step.id) ?? [], obligations: job.plan?.obligations.map(describe) ?? [], children: job.plan?.children.map(describe) ?? [], uncertainAttempts: job.execution?.attempts.filter(attempt => ['dispatched', 'unknown'].includes(attempt.status)).map(attempt => ({ key: attempt.key, stepId: attempt.stepId, reconciliationOwner: job.ownerId })) ?? [] };
  }
  private raw(id: string) { return this.jobs.find(this.jobs.store.read(), id); }
  private scope(state: State, context: Context, job: Job) { current(state, context, 'prepare'); sourceAccess(state, context, job.sourceIds); check(context.memberId === job.ownerId && context.epoch === job.ownerEpoch && context.role === job.ownerRole, 'JOB_OWNER_REQUIRED', 'Execute with the mandate owner\'s pinned identity.'); }
  private latest(job: Job, stepId: string) { return job.execution?.attempts.filter(a => a.stepId === stepId).at(-1); }
  private results(context: Context, job: Job) {
    const runner = this.runner(job.execution?.type ?? job.type); const results: Record<string, StepResult> = {};
    for (const step of (job.execution?.plan ?? job.plan!).steps) { const attempt = this.latest(job, step.id); if (attempt?.status !== 'verified' || !attempt.settlement) continue; check(runner.release(context, structuredClone(attempt.settlement.result)), 'JOB_EVIDENCE_REVOKED', 'A required saved result is no longer available to this owner.'); results[step.id] = json(attempt.settlement.result); }
    return results;
  }
  private request(context: Context, job: Job, step: GoalStep, key: string, signal: AbortSignal): ProviderRequest {
    const results = this.results(context, job); const inputs: ProviderRequest['inputs'] = {};
    for (const dependency of step.dependencies) {
      const producer = this.latest(job, dependency.stepId); const result = results[dependency.stepId];
      check(producer?.status === 'verified' && result && result.informationClass === dependency.informationClass && (!dependency.evidenceRequired || result.evidenceIds.length > 0), 'JOB_DEPENDENCY_UNSATISFIED', 'A dependency lacks the required verified result class or evidence.');
      inputs[dependency.stepId] = { producerKey: producer.key, objectiveRevision: job.execution!.objectiveRevision, result };
    }
    return { key, step: json(step), context: { ...context }, signal, inputs };
  }
  private block(job: Job, reason: string, status: Job['status'] = 'runner-blocked') {
    this.jobs.release(job); job.fence += 1; job.status = status;
    job.ledger.push({ at: this.jobs.timestamp(), event: 'blocked', reason });
  }
  private operationKey(job: Job, step: GoalStep) { return `${job.id}:revision:${job.revision}:occurrence:${job.execution!.calendar?.occurrenceId ?? job.execution!.scheduledFor}:step:${step.id}`; }
  private dispatchCheck(state: State, context: Context, job: Job, lease: LeaseIdentity) {
    this.scope(state, context, job);
    this.jobs.calendarDispatchValid(job);
    check(job.plan && job.execution && job.execution.objectiveRevision === job.revision && job.execution.planDigest === digest(job.plan) && job.digest === this.jobs.identity(job) && this.runner(job.type).version === job.plan.runnerVersion, 'JOB_RUNNER_CHANGED', 'The objective or installed runner changed.');
    check(state.policy.autonomy, 'AUTONOMY_DISABLED', 'Autonomy was disabled.');
    check(this.jobs.clock() < Date.parse(job.stopRule.deadline) && job.runs < job.stopRule.maxRuns && this.jobs.clock() - Date.parse(job.execution.startedAt) < job.limits!.durationMs, 'JOB_STOP_RULE', 'The mandate stop or wall-time ceiling was reached.');
    this.jobs.validateLease(job, lease);
    if (job.requiresApproval) { const approval = job.approval; const member = approval && state.members.find(m => m.id === approval.memberId); check(approval?.digest === job.digest && approval.revision === job.revision && member?.active && member.epoch === approval.epoch && member.role === approval.role, 'APPROVAL_REQUIRED', 'The exact mandate approval is no longer valid.'); }
  }
  private async begin(context: Context, id: string, lease: LeaseIdentity, step: GoalStep, request: ProviderRequest) {
    return this.jobs.store.update(state => {
      const job = this.jobs.find(state, id); this.dispatchCheck(state, context, job, lease);
      const provider = this.providers.get(step.provider); check(provider, 'JOB_PROVIDER_UNAVAILABLE', 'The declared provider is unavailable.');
      check(provider.model === step.modelRequired && (!step.modelRequired || job.testedRoutes!.includes(step.routeId!)), 'UNQUALIFIED_JOB_ROUTE', 'This exact model route was not tested for this job.');
      check(provider.transport === 'local' || this.options.networkAvailable(), 'JOB_NETWORK_UNAVAILABLE', 'The configured transport is unavailable.');
      check(!(provider.transport === 'remote' && job.execution!.sourceTainted), 'TAINTED_JOB_EGRESS', 'Outside text requires a human-reviewed external action preview.');
      if (provider.kind === 'read-only') provider.authorize?.(state, context, request, 'dispatch');
      const prior = this.latest(job, step.id); check(!prior, 'JOB_STEP_ALREADY_ATTEMPTED', 'A dispatched logical step is never automatically retried.');
      check(!job.execution!.attempts.some(a => ['dispatched', 'unknown'].includes(a.status)), 'JOB_STEP_ALREADY_ATTEMPTED', 'Resolve the single dispatched step before admitting another.');
      const meters = job.execution!.meters;
      check(money(step.reserveMinor) <= money(job.lease!.reservedMinor) - money(job.lease!.chargedMinor) && meters.modelUnits + step.modelUnits <= job.limits!.modelUnits && meters.durationMs + step.durationMs <= job.limits!.durationMs && money(meters.actionExposureMinor) + money(step.actionExposureMinor) <= money(job.limits!.actionExposureMinor), 'JOB_BUDGET_EXHAUSTED', 'The next step exceeds the remaining admitted capacity.');
      const key = this.operationKey(job, step);
      const attempt: StepAttempt = { stepId: step.id, key, attempt: 1, fence: lease.fence, status: 'dispatched', reservedMinor: step.reserveMinor, startedAt: this.jobs.timestamp() };
      job.execution!.attempts.push(attempt); job.ledger.push({ at: this.jobs.timestamp(), event: 'step-dispatched', fence: lease.fence, amountMinor: step.reserveMinor, reason: step.id }); audit(state, 'job.step-dispatched', { jobId: id, key, stepId: step.id }); return json(attempt);
    });
  }
  private async settle(id: string, key: string, settlement: ProviderSettlement, reconciliationId?: string) {
    return this.jobs.store.update(state => {
      const job = this.jobs.find(state, id); const attempt = job.execution?.attempts.find(a => a.key === key); check(attempt && job.plan, 'JOB_ATTEMPT_MISSING', 'The admitted attempt was removed.');
      if (attempt.status === 'verified') { check(canonical(attempt.settlement) === canonical(settlement), 'JOB_SETTLEMENT_CONFLICT', 'A settlement replay changed its result or cost.'); return; }
      check(['dispatched', 'unknown'].includes(attempt.status), 'INVALID_JOB_STATE', 'Only a pending attempt may settle.');
      const step = job.execution!.plan.steps.find(s => s.id === attempt.stepId)!; validateSettlement(settlement, step);
      const cost = money(settlement.spentMinor); check(cost <= money(job.reservedMinor), 'JOB_BUDGET_EXHAUSTED', 'The settlement exceeds retained exposure.');
      job.spentMinor = String(money(job.spentMinor) + cost); job.reservedMinor = String(money(job.reservedMinor) - cost);
      if (job.lease && job.lease.fence === attempt.fence) job.lease.chargedMinor = String(money(job.lease.chargedMinor) + cost);
      const execution = job.execution!; execution.meters.modelUnits += settlement.modelUnits; execution.meters.durationMs += settlement.durationMs; execution.meters.actionExposureMinor = String(money(execution.meters.actionExposureMinor) + money(settlement.actionExposureMinor)); execution.sourceTainted ||= settlement.result.sourceTainted;
      attempt.status = 'verified'; attempt.settlement = json(settlement); attempt.settledAt = this.jobs.timestamp(); if (reconciliationId) attempt.reconciliationId = reconciliationId;
      job.ledger.push({ at: this.jobs.timestamp(), event: 'step-verified', amountMinor: settlement.spentMinor, reason: step.id });
      // Cancellation or lease expiry cannot refund uncertain consumption. A confirmed readback can.
      if (!job.lease && !execution.attempts.some(a => ['dispatched', 'unknown'].includes(a.status))) { job.reservedMinor = '0'; job.status = execution.afterReconcile ?? (['cancelled', 'revoked', 'stopped'].includes(job.status) ? job.status : 'scheduled'); delete execution.afterReconcile; if (execution.objectiveRevision !== job.revision) { (job.archivedExecutions ??= []).push(execution); delete job.execution; } }
      audit(state, 'job.step-settled', { jobId: id, key, spentMinor: settlement.spentMinor });
    });
  }
  private async unknown(id: string, key: string, reason: string) {
    return this.jobs.store.update(state => { const job = this.jobs.find(state, id); const attempt = job.execution?.attempts.find(a => a.key === key); if (!attempt || !['dispatched', 'unknown'].includes(attempt.status)) return; const owner = state.members.find(member => member.id === job.ownerId); const revoked = !owner?.active || owner.epoch !== job.ownerEpoch || owner.role !== job.ownerRole; this.jobs.interrupt(job, revoked ? 'revoked' : job.execution?.afterReconcile ?? 'scheduled', reason); audit(state, 'job.step-unknown', { jobId: id, key, reason }); });
  }
  private async preview(request: ProviderRequest): Promise<ProviderSettlement> {
    const job = this.raw(request.key.split(':revision:')[0]); const input = request.step.input as unknown as PrepareAction;
    check(input && typeof input.connector === 'string' && typeof input.operation === 'string' && job.allowedActions!.includes(`${input.connector}.${input.operation}`), 'JOB_ACTION_FORBIDDEN', 'The action is outside the mandate catalogue.');
    const sources = input.sourceIds ?? job.sourceIds; check(sources.every(id => job.sourceIds.includes(id)), 'JOB_ACTION_FORBIDDEN', 'Action sources must stay within the mandate.');
    const action = await this.options.actions!.prepare({ ...request.context, sourceTainted: job.execution!.sourceTainted }, { ...input, sourceIds: sources, idempotencyKey: request.key });
    return this.previewResult(action, job.execution!.sourceTainted);
  }
  private previewResult(action: PreparedAction, sourceTainted: boolean): ProviderSettlement { return { result: { value: { actionId: action.id, digest: action.digest, status: action.status, businessSuccess: false }, informationClass: 'action-preview', evidenceIds: [action.id], sourceTainted }, spentMinor: '0', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' }; }
  private async boundedDispatch(provider: GoalProvider, request: ProviderRequest, controller: AbortController): Promise<ProviderSettlement> {
    const job = this.raw(request.key.split(':revision:')[0]);
    const timeoutMs = Math.min(request.step.durationMs, Date.parse(job.stopRule.deadline) - this.jobs.clock(), job.calendar ? Date.parse(job.calendar.definition.stop.until) - this.jobs.clock() : Infinity, job.limits!.durationMs - (this.jobs.clock() - Date.parse(job.execution!.startedAt)));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let aborted!: () => void;
    let stopped!: () => void;
    const interruption = new Promise<never>((_resolve, reject) => { stopped = () => reject(new ChausarError('JOB_HOST_INTERRUPTED', 'The host is stopping; unfinished work requires readback.')); this.interruptors.add(stopped); aborted = () => { if (controller.signal.reason?.code === 'JOB_HOST_INTERRUPTED') stopped(); }; controller.signal.addEventListener('abort', aborted, { once: true }); if (controller.signal.aborted) aborted(); });
    const expiry = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new ChausarError('JOB_PROVIDER_TIMEOUT', 'The provider reached its admitted deadline. Its consumption requires readback.')); controller.abort(); }, Math.max(1, timeoutMs)); });
    try { return await Promise.race([provider.kind === 'prepare-action' ? this.preview(request) : provider.dispatch(request), expiry, interruption]); }
    finally { if (timer) clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); this.interruptors.delete(stopped); }
  }
  async run(context: Context, id: string): Promise<Job> {
    check(!this.busy, 'JOB_WORKER_BUSY', 'The single local worker is busy.'); this.busy = true;
    let lease: Lease | undefined; let activeKey: string | undefined; let controller: AbortController | undefined; let heartbeat: ReturnType<typeof setInterval> | undefined;
    try {
      const initial = this.raw(id); this.scope(this.jobs.store.read(), context, initial); this.runner(initial.type);
      check(initial.plan, 'INVALID_JOB_PLAN', 'This job needs a typed plan.');
      if (initial.status === 'outcome-unknown') return this.jobs.view(context, initial);
      const acquired = await this.jobs.acquire(context, id, this.options.workerId, this.options.leaseMs); if (acquired.status !== 'running' || !acquired.lease) return acquired; lease = acquired.lease;
      await this.jobs.store.update(state => { const job = this.jobs.find(state, id); this.jobs.validateLease(job, lease!); const c = job.calendar, occurrence = c?.records.find(x => x.id === c.current); job.execution ??= { ...(c && occurrence ? { calendar: { occurrenceId: occurrence.id, scheduleRevision: occurrence.scheduleRevision, requestedLocal: occurrence.requestedLocal, resolvedLocal: occurrence.resolvedLocal!, fold: occurrence.fold, rulesRevision: c.definition.rulesRevision, ...(occurrence.representedIds !== undefined ? { representedIds: [...occurrence.representedIds] } : {}) } } : {}), plan: json(job.plan!), type: job.type!, sourceIds: [...job.sourceIds], run: job.runs + 1, objectiveRevision: job.revision, scheduledFor: occurrence?.instant ?? job.nextRunAt, planDigest: digest(job.plan), startedAt: this.jobs.timestamp(), attempts: [], meters: { modelUnits: 0, durationMs: 0, actionExposureMinor: '0' }, sourceTainted: false }; });
      controller = new AbortController(); this.signals.set(id, controller);
      heartbeat = setInterval(() => { void this.jobs.heartbeat(context, id, lease!, this.options.leaseMs).catch(() => controller?.abort()); }, Math.max(25, Math.floor(this.options.leaseMs / 3))); heartbeat.unref();
      while (true) {
        const job = this.raw(id); this.scope(this.jobs.store.read(), context, job); const results = this.results(context, job);
        const pending = job.plan!.steps.filter(item => this.latest(job, item.id)?.status !== 'verified');
        const step = pending.find(item => item.dependencies.every(dependency => results[dependency.stepId]?.informationClass === dependency.informationClass && (!dependency.evidenceRequired || results[dependency.stepId].evidenceIds.length > 0)) && (this.providers.get(item.provider)?.transport === 'local' || this.options.networkAvailable())) ?? pending[0];
        if (!step) { await this.jobs.store.update(state => { this.dispatchCheck(state, context, this.jobs.find(state, id), lease!); }); const runner = this.runner(job.type); const value = json(runner.deliver(runner.validate(job.input), results)); return await this.jobs.complete(context, id, lease, { ...(job.execution!.calendar ? { calendar: job.execution!.calendar } : {}), kind: job.type!, objectiveRevision: job.revision, scheduledFor: job.execution!.scheduledFor, result: value }, this.raw(id).lease!.chargedMinor); }
        const request = this.request(context, job, step, this.operationKey(job, step), controller.signal); const attempt = await this.begin(context, id, lease, step, request); activeKey = attempt.key;
        const provider = this.providers.get(step.provider)!;
        // Recheck synchronously at the invocation boundary after the admission commit resolves.
        check(!controller.signal.aborted, 'JOB_CANCELLED', 'The admitted step was cancelled before dispatch.');
        this.dispatchCheck(this.jobs.store.read(), context, this.raw(id), lease);
        if (provider.kind === 'read-only') provider.authorize?.(this.jobs.store.read(), context, request, 'dispatch');
        // Installed read providers are trusted ports. No external write or action execute port is exposed.
        const settlement = await this.boundedDispatch(provider, request, controller);
        await this.settle(id, attempt.key, settlement); activeKey = undefined;
      }
    } catch (failure) {
      const reason = (failure as { code?: string }).code ?? 'JOB_PROVIDER_OUTCOME_UNKNOWN';
      if (activeKey) await this.unknown(id, activeKey, reason);
      else if (lease) await this.jobs.store.update(state => { const job = this.jobs.find(state, id); if (job.status === 'running' && job.lease?.token === lease!.token) this.block(job, reason, reason === 'ACCESS_REVOKED' ? 'revoked' : reason === 'JOB_STOP_RULE' ? 'stopped' : reason === 'JOB_BUDGET_EXHAUSTED' ? 'budget-blocked' : reason === 'JOB_NETWORK_UNAVAILABLE' ? 'network-wait' : 'runner-blocked'); });
      const job = this.raw(id); this.scope(this.jobs.store.read(), context, job); return this.jobs.view(context, job);
    } finally { if (heartbeat) clearInterval(heartbeat); this.signals.delete(id); controller?.abort(); this.busy = false; }
  }
  /** Readback only. Confirmed absence pauses the job for human review; it never replays dispatch. */
  async reconcile(context: Context, id: string): Promise<Job> {
    const state = this.jobs.store.read(); const job = this.jobs.find(state, id); this.jobs.owner(state, context, job);
    const attempt = job.execution?.attempts.find(a => a.status === 'unknown'); check(attempt && job.plan, 'INVALID_JOB_STATE', 'No uncertain step needs readback.');
    sourceAccess(state, context, job.execution!.sourceIds);
    const step = job.execution!.plan.steps.find(s => s.id === attempt.stepId)!; const provider = this.providers.get(step.provider); check(provider, 'JOB_PROVIDER_UNAVAILABLE', 'Restore the declared readback provider.');
    check(provider.transport === 'local' || this.options.networkAvailable(), 'JOB_NETWORK_UNAVAILABLE', 'Readback needs the configured transport.');
    const controller = new AbortController();
    const request = this.request(context, job, step, attempt.key, controller.signal);
    let readback: Reconciliation;
    if (provider.kind === 'prepare-action') {
      const actions = this.options.actions!; const input = step.input as unknown as PrepareAction;
      const operation = actions.operation(input.connector, input.operation); operation.authorize?.(state, context, 'read');
      const action = state.actions.find((item: PreparedAction) => item.connector === input.connector && item.operation === input.operation && item.idempotencyKey === attempt.key) as PreparedAction | undefined;
      if (action) { actions.access(state, context, action); check(canonical(action.payload) === canonical(json(operation.validate(json(input.payload)))) && canonical(action.sourceIds) === canonical([...new Set(input.sourceIds ?? job.execution!.sourceIds)].sort()), 'JOB_PREVIEW_CHANGED', 'The saved action no longer matches its original exact preview.'); }
      readback = action ? { outcome: 'verified', id: action.id, settlement: this.previewResult(action, job.execution!.sourceTainted) } : { outcome: 'absent', id: attempt.key, spentMinor: '0', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' };
    }
    else {
      provider.authorize?.(state, context, request, 'readback');
      this.readbacks.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined; let aborted!: () => void;
      const interruption = new Promise<never>((_resolve, reject) => { aborted = () => reject(new ChausarError('JOB_READBACK_INTERRUPTED', 'Readback was interrupted; its outcome remains unknown.')); controller.signal.addEventListener('abort', aborted, { once: true }); });
      const expiry = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { reject(new ChausarError('JOB_READBACK_TIMEOUT', 'Readback reached its admitted time ceiling; its outcome remains unknown.')); controller.abort(); }, step.durationMs); });
      try { readback = await Promise.race([provider.reconcile(request), expiry, interruption]); }
      finally { if (timer) clearTimeout(timer); controller.signal.removeEventListener('abort', aborted); this.readbacks.delete(controller); controller.abort(); }
    }
    this.jobs.owner(this.jobs.store.read(), context, this.raw(id));
    sourceAccess(this.jobs.store.read(), context, job.execution!.sourceIds);
    if (provider.kind === 'read-only') provider.authorize?.(this.jobs.store.read(), context, request, 'readback');
    check(readback && ['verified', 'absent', 'blocked', 'unknown'].includes(readback.outcome), 'INVALID_JOB_READBACK', 'Readback must report verified, absent, known blocked or unknown.');
    if (readback.outcome === 'verified') { check(typeof readback.id === 'string' && readback.id.length > 0, 'INVALID_JOB_READBACK', 'A verified readback needs proof identity.'); await this.settle(id, attempt.key, readback.settlement, readback.id); }
    if (readback.outcome === 'absent' || readback.outcome === 'blocked') {
      check(typeof readback.id === 'string' && readback.id.length > 0, 'INVALID_JOB_READBACK', 'Confirmed absence needs readback proof.');
      if (readback.outcome === 'blocked') check(typeof readback.reason === 'string' && readback.reason.length > 0 && readback.reason.length <= 500, 'INVALID_JOB_READBACK', 'Known blocked work needs its recorded reason.');
      const settlement: ProviderSettlement = { ...readback, result: { value: readback.outcome === 'blocked' ? { kind: 'job-step-blocked-v1', reason: readback.reason } : null, informationClass: 'observation', evidenceIds: [readback.id], sourceTainted: false } }; validateSettlement(settlement, step);
      await this.jobs.store.update(state => { const saved = this.jobs.find(state, id); if (readback.outcome === 'blocked') { this.scope(state, context, saved); if (provider.kind === 'read-only') provider.authorize?.(state, context, request, 'readback'); } const execution = saved.execution!; const pending = execution.attempts.find(a => a.key === attempt.key)!; if (pending.status === readback.outcome) return; check(pending.status === 'unknown', 'INVALID_JOB_STATE', 'Readback raced with another settlement.'); const cost = money(readback.spentMinor); check(cost <= money(saved.reservedMinor), 'JOB_BUDGET_EXHAUSTED', 'Readback cost exceeds held exposure.'); saved.spentMinor = String(money(saved.spentMinor) + cost); saved.reservedMinor = '0'; pending.status = readback.outcome; pending.settlement = json(settlement); pending.reconciliationId = readback.id; pending.settledAt = this.jobs.timestamp(); execution.meters.modelUnits += readback.modelUnits; execution.meters.durationMs += readback.durationMs; execution.meters.actionExposureMinor = String(money(execution.meters.actionExposureMinor) + money(readback.actionExposureMinor)); saved.status = ['cancelled', 'revoked', 'stopped'].includes(saved.status) ? saved.status : 'paused'; delete execution.afterReconcile; if (execution.objectiveRevision !== saved.revision) { (saved.archivedExecutions ??= []).push(execution); delete saved.execution; } saved.ledger.push({ at: this.jobs.timestamp(), event: readback.outcome === 'blocked' ? 'step-blocked' : 'step-absent', reason: readback.outcome === 'blocked' ? readback.reason : step.id, amountMinor: readback.spentMinor }); });
    }
    return this.jobs.view(context, this.raw(id));
  }
  async cancel(context: Context, id: string) { const job = await this.jobs.cancel(context, id); this.signals.get(id)?.abort(); return job; }
  /** Signals are advisory; the durable journal retains every unresolved exposure. */
  interruptActive() { for (const stop of this.interruptors) stop(); for (const signal of [...this.signals.values(), ...this.readbacks]) signal.abort(new ChausarError('JOB_HOST_INTERRUPTED', 'The host is stopping; unfinished work requires readback.')); }
  /** Call only after acquiring the host's exclusive vault lock and before scheduling work. */
  async recoverInterrupted(context: Context) {
    check(!this.busy, 'JOB_WORKER_BUSY', 'Recovery is only available before the worker starts.');
    return this.jobs.store.update(state => { current(state, context, 'admin'); const recovered: string[] = []; for (const job of state.jobs as Job[]) {
      if (job.status !== 'running' || (job.plan && !this.runners.has(job.type!))) continue;
      const owner = state.members.find(member => member.id === job.ownerId); const status = !owner?.active || owner.epoch !== job.ownerEpoch || owner.role !== job.ownerRole ? 'revoked' : 'scheduled';
      this.jobs.interrupt(job, status, 'process-interrupted'); recovered.push(job.id); audit(state, 'job.interrupted', { jobId: job.id, status: job.status });
    } return { recovered }; });
  }
  /** The host reports awake/window state; closed-laptop execution requires an explicitly separate host. */
  async tick(context: Context, host: { awake: boolean; windowOpen: boolean; backgroundEnabled: boolean }) {
    if (!host.awake || (!host.windowOpen && !host.backgroundEnabled) || !this.jobs.store.read().policy.autonomy || this.busy) return [];
    const jobs = this.jobs.list(context).filter(job => job.plan && this.runners.has(job.type!) && (!job.calendar?.paused || job.calendar.current) && (host.windowOpen || job.background === true) && ((['scheduled', 'approval-blocked'].includes(job.status) && Date.parse(job.nextRunAt) <= this.jobs.clock()) || (job.status === 'network-wait' && this.options.networkAvailable()) || (job.status === 'running' && job.lease && Date.parse(job.lease.expiresAt) <= this.jobs.clock())));
    const results: Job[] = []; for (const job of jobs) results.push(await this.run(context, job.id)); return results;
  }
}
