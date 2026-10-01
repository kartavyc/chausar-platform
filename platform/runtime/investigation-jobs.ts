import { check, hash, type Context, type State, type StateStore } from './contracts.ts';
import { current, digest, sourceAccess } from './actions.ts';
import { InvestigationService, type InvestigationOptions } from './investigations.ts';
import type { Investigation, InvestigationCapsule, InvestigationReceiptPin } from './investigation-contracts.ts';
import type { GoalProvider, GoalRunner, ProviderRequest } from './job-runner.ts';
import type { Job, JobConfig, JobService } from './jobs.ts';
import { json, money, validateSettlement, type ProviderSettlement, type StepResult } from './job-protocol.ts';

export type InvestigationJobStep = { stepId: string; reserveMinor: string; durationMs: number };
/** Caller authors only the saved identity, revision and explicit capacity for each pending step. */
export type InvestigationJobInput = {
  investigationId: string; expectedRevision: number; steps: InvestigationJobStep[];
  /** Explicit read-only delivery capacity for an already complete saved investigation. */
  finalize?: { reserveMinor: string; durationMs: number };
  /** Installed admission replaces this value from current private authoritative state. */
  binding?: InvestigationJobBinding;
};
export type InvestigationJobBinding = {
  version: 1; investigationId: string; revision: number; ownerId: string; epoch: number; role: Context['role'];
  basisHash: string; planHash: string; scopeDigest: string; dictionaryHash: string; asOf: string;
  sourceIds: string[]; rowIds: string[]; initialReceiptPins: InvestigationReceiptPin[];
  completedPrefix: { stepId: string; receipt: InvestigationReceiptPin }[];
  pendingStepIds: string[];
};
type StepValue = {
  kind: 'private-investigation-step-v1'; operationId: string; investigationId: string; stepId: string;
  receiptId: string; receipt: InvestigationReceiptPin; completedPrefixDigest: string;
  finalCapsule?: InvestigationCapsule;
};
export type InvestigationJobOperation = {
  kind: 'private-investigation-job-operation-v1'; id: string; key: string; requestDigest: string; bindingDigest: string;
  investigationId: string; stepId: string; memberId: string; epoch: number; role: Context['role'];
  beforeRevision: number; afterRevision: number; outcome: 'completed' | 'blocked' | 'finalized'; reason?: string;
  prefix: { stepId: string; receipt: InvestigationReceiptPin }[];
  sourceIds: string[]; rowIds: string[]; durationMs: number; settlement?: ProviderSettlement; integrity: string;
  at: string;
};
const view = (state: State): StateStore => ({ read: () => structuredClone(state), update: async change => await change(state) });
const closed = (value: unknown, keys: string[]) => check(value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(k => keys.includes(k)), 'INVALID_INVESTIGATION_JOB', 'Use only declared investigation job fields.');
const prefix = (value: Investigation) => value.steps.filter(s => s.state === 'completed').map(s => ({ stepId: s.id, receipt: s.receipt! }));
const basis = (value: Investigation) => hash({ id: value.id, ownerId: value.ownerId, epoch: value.epoch, branch: value.branch ?? null,
  objective: value.objective, asOf: value.asOf, dictionaryHash: value.dictionaryHash, ontologyVersion: value.ontologyVersion,
  planHash: value.planHash, scopeDigest: value.scopeDigest, scopeImportIds: value.scopeImportIds, sourceIds: value.sourceIds,
  rowIds: value.rowIds, hypotheses: value.hypotheses, budget: value.budget, revisions: value.revisions, createdAt: value.createdAt });
function validate(input: unknown): InvestigationJobInput {
  const value = json(input) as InvestigationJobInput; closed(value, ['investigationId', 'expectedRevision', 'steps', 'binding', 'finalize']);
  check(typeof value.investigationId === 'string' && value.investigationId.length > 0 && value.investigationId.length <= 200
    && Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 1 && Array.isArray(value.steps)
    && value.steps.length <= 64 && (value.steps.length > 0 ? value.finalize === undefined : value.finalize !== undefined), 'INVALID_INVESTIGATION_JOB', 'Name every remaining step, or supply explicit finalization capacity for a complete investigation.');
  if (value.finalize) { closed(value.finalize, ['reserveMinor', 'durationMs']); money(value.finalize.reserveMinor);
    check(Number.isSafeInteger(value.finalize.durationMs) && value.finalize.durationMs > 0, 'INVALID_INVESTIGATION_JOB', 'Finalization needs an explicit time ceiling.'); }
  const ids = new Set<string>();
  for (const step of value.steps) {
    closed(step, ['stepId', 'reserveMinor', 'durationMs']);
    check(typeof step.stepId === 'string' && step.stepId.length > 0 && step.stepId.length <= 100 && !ids.has(step.stepId)
      && Number.isSafeInteger(step.durationMs) && step.durationMs > 0, 'INVALID_INVESTIGATION_JOB', 'Every pending step needs a unique identity and explicit time ceiling.');
    money(step.reserveMinor); ids.add(step.stepId);
  }
  return value;
}
function bindingFor(value: Investigation, context: Context): InvestigationJobBinding {
  return { version: 1, investigationId: value.id, revision: value.revision, ownerId: context.memberId, epoch: context.epoch,
    role: context.role, basisHash: basis(value), planHash: value.planHash, scopeDigest: value.scopeDigest,
    dictionaryHash: value.dictionaryHash, asOf: value.asOf, sourceIds: [...value.sourceIds], rowIds: [...value.rowIds],
    initialReceiptPins: structuredClone(value.receiptPins), completedPrefix: prefix(value),
    pendingStepIds: value.steps.filter(s => s.state === 'pending').map(s => s.id) };
}

/** Installs one local exact-computation goal; no model, network or action execution port exists. */
export function investigationJobPorts(store: StateStore, jobs: JobService, options: InvestigationOptions = {}): { runner: GoalRunner<InvestigationJobInput>; provider: GoalProvider } {
  const active = new Set<string>();
  const service = (currentStore = store) => new InvestigationService(currentStore, options);
  const operationBody = (record: InvestigationJobOperation) => { const { integrity, ...body } = record; return body; };
  const operations = (state: State, binding: InvestigationJobBinding) => {
    const found = state.answers.filter(a => a.kind === 'private-investigation-job-operation-v1' && a.bindingDigest === digest(binding)) as InvestigationJobOperation[];
    for (const record of found) check(record.integrity === digest(operationBody(record)) && record.memberId === binding.ownerId
      && record.epoch === binding.epoch && record.role === binding.role && record.investigationId === binding.investigationId,
    'JOB_OPERATION_CONFLICT', 'The saved investigation operation identity changed.');
    return found.filter(r => r.outcome !== 'finalized').sort((a, b) => a.beforeRevision - b.beforeRevision);
  };
  const live = (state: State, context: Context, binding: InvestigationJobBinding) => {
    current(state, context); check(binding && binding.version === 1 && binding.ownerId === context.memberId && binding.epoch === context.epoch
      && binding.role === context.role, 'JOB_OWNER_REQUIRED', 'The investigation mandate belongs to its pinned private owner.');
    sourceAccess(state, context, binding.sourceIds);
    const value = service(view(state)).get(context, binding.investigationId);
    check(basis(value) === binding.basisHash, 'INVESTIGATION_JOB_CHANGED', 'The authored investigation, definitions or scope changed. Create a new mandate.');
    check(value.status !== 'cancelled', 'INVESTIGATION_NOT_OPEN', 'A cancelled investigation cannot continue or release a job result.');
    const records = operations(state, binding); const completed = [...binding.completedPrefix];
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      check(record.beforeRevision === binding.revision + index && record.afterRevision === record.beforeRevision + 1
        && record.stepId === binding.pendingStepIds[completed.length - binding.completedPrefix.length]
        && (index === records.length - 1 || record.outcome === 'completed'), 'JOB_OPERATION_CONFLICT', 'The saved continuation is not one ordered authored prefix.');
      if (record.outcome === 'completed') {
        const measured = value.steps.find(s => s.id === record.stepId);
        check(measured?.state === 'completed' && measured.receipt, 'JOB_OPERATION_CONFLICT', 'The saved continuation lacks its measured step.');
        completed.push({ stepId: measured.id, receipt: measured.receipt });
      }
      check(digest(record.prefix) === digest(completed), 'JOB_OPERATION_CONFLICT', 'A continuation changed earlier measurement evidence.');
    }
    check(value.revision === binding.revision + records.length && digest(prefix(value)) === digest(completed)
      && binding.initialReceiptPins.every(p => value.receiptPins.some(currentPin => digest(p) === digest(currentPin))),
    'INVESTIGATION_JOB_CHANGED', 'The investigation was advanced or revised outside this mandate.');
    return { value, records };
  };
  const stepInput = (request: ProviderRequest) => {
    const input = request.step.input as unknown as { binding: InvestigationJobBinding; stepId: string; finalize?: true };
    closed(input, ['binding', 'stepId', 'finalize']); check(input.binding && typeof input.stepId === 'string' && (input.finalize === undefined || input.finalize === true), 'INVALID_INVESTIGATION_JOB', 'The installed step needs its admitted private binding.'); return input;
  };
  const requestDigest = (request: ProviderRequest) => digest({ key: request.key, step: request.step,
    memberId: request.context.memberId, epoch: request.context.epoch, role: request.context.role });
  const admitted = (state: State, request: ProviderRequest, dispatch: boolean, requireAttempt = true) => {
    const input = stepInput(request), job = jobs.find(state, request.key.split(':revision:')[0]);
    check(job.execution && job.plan, 'JOB_OPERATION_CONFLICT', 'The private operation needs its admitted execution plan.');
    const attempt = job.execution?.attempts.find(a => a.key === request.key);
    const planned = job.execution?.plan.steps.find(s => s.id === request.step.id);
    const key = `${job.id}:revision:${job.revision}:occurrence:${job.execution?.calendar?.occurrenceId ?? job.execution?.scheduledFor}:step:${request.step.id}`;
    check((!requireAttempt || attempt) && (!attempt || attempt.stepId === request.step.id) && planned && digest(planned) === digest(request.step)
      && request.key === key && digest((job.input as InvestigationJobInput).binding) === digest(input.binding)
      && job.ownerId === request.context.memberId && job.ownerEpoch === request.context.epoch
      && job.ownerRole === request.context.role && job.execution?.planDigest === digest(job.execution.plan) && job.plan && job.execution.planDigest === digest(job.plan)
      && job.execution.objectiveRevision === job.revision && job.digest === jobs.identity(job), 'JOB_OPERATION_CONFLICT', 'The operation needs its exact current persisted mandate attempt.');
    check(input.binding.sourceIds.every(id => job.sourceIds.includes(id) && job.execution!.sourceIds.includes(id)), 'JOB_SOURCE_SCOPE', 'The saved investigation exceeds the explicit mandate source scope.');
    sourceAccess(state, request.context, job.execution!.sourceIds);
    if (dispatch) check(!request.signal.aborted && job.status === 'running' && job.lease && (!attempt || job.fence === attempt.fence)
      && Date.parse(job.lease.expiresAt) > jobs.clock(), 'JOB_CANCELLED', 'The private continuation was interrupted or fenced before saving.');
    return { ...live(state, request.context, input.binding), input, job };
  };
  const saved = (state: State, request: ProviderRequest) => {
    const found = state.answers.filter(a => a.kind === 'private-investigation-job-operation-v1' && a.key === request.key) as InvestigationJobOperation[];
    check(found.length <= 1, 'JOB_OPERATION_CONFLICT', 'One logical investigation step has multiple operation records.');
    const record = found[0];
    if (record) check(record.requestDigest === requestDigest(request) && record.integrity === digest(operationBody(record)), 'JOB_OPERATION_CONFLICT', 'The operation record no longer binds this request.');
    return record;
  };
  const release = (context: Context, result: StepResult): boolean => {
    try {
      const value = result.value as unknown as StepValue;
      check(result.informationClass === 'computation' && value?.kind === 'private-investigation-step-v1', 'JOB_EVIDENCE_REVOKED', 'Only this installed computation result can release.');
      const state = store.read(), record = state.answers.find(a => a.kind === 'private-investigation-job-operation-v1' && a.id === value.operationId) as InvestigationJobOperation | undefined;
      check(record && ['completed', 'finalized'].includes(record.outcome) && record.settlement && record.integrity === digest(operationBody(record))
        && digest(record.settlement.result) === digest(result), 'JOB_EVIDENCE_REVOKED', 'The exact correlated computation result is unavailable.');
      const job = jobs.find(state, record.key.split(':revision:')[0]);
      const binding = (job.input as InvestigationJobInput).binding!; const actual = live(state, context, binding);
      check(record.bindingDigest === digest(binding) && record.prefix.every(p => actual.value.steps.some(s => s.id === p.stepId && digest(s.receipt) === digest(p.receipt)))
        && result.evidenceIds.length === 1 && result.evidenceIds[0] === value.receiptId, 'JOB_EVIDENCE_REVOKED', 'The saved measurement prefix changed.');
      if (value.finalCapsule) check(actual.value.status === 'complete' && digest(service().capsule(context, actual.value.id)) === digest(value.finalCapsule), 'JOB_EVIDENCE_REVOKED', 'The final context capsule changed.');
      return true;
    } catch { return false; }
  };
  const runner: GoalRunner<InvestigationJobInput> = {
    type: 'private-investigation', version: '1', validate,
    admit: (state, context, raw, config: JobConfig, previous?: Job) => {
      current(state, context, 'prepare'); check(context.channel === 'desktop' && !context.sourceTainted, 'INVESTIGATION_APP_REQUIRED', 'Admit private investigation work in the untainted app.');
      check(!previous || ![previous.execution, ...(previous.archivedExecutions ?? [])].some(e => e?.attempts.length), 'INVESTIGATION_JOB_AMENDMENT_BLOCKED', 'A measured or uncertain mandate cannot repin its investigation. Keep its evidence and create a new reviewed mandate.');
      const input = validate(raw), value = service(view(state)).get(context, input.investigationId);
      check(value.revision === input.expectedRevision, 'INVESTIGATION_REVISION_CONFLICT', 'Review the current saved investigation revision.');
      check(value.status === (input.finalize ? 'complete' : 'open'), 'INVESTIGATION_NOT_OPEN', 'Resume pending work or explicitly finalize an already complete saved investigation.');
      const pending = value.steps.filter(s => s.state === 'pending').map(s => s.id);
      check((pending.length > 0 || input.finalize) && digest(pending) === digest(input.steps.map(s => s.stepId)), 'INVALID_INVESTIGATION_JOB', 'Declare every pending investigation step exactly once in saved order.');
      check(Array.isArray(config.sourceIds) && value.sourceIds.every(id => config.sourceIds!.includes(id)), 'JOB_SOURCE_SCOPE', 'Explicitly include every saved investigation source in the mandate.');
      sourceAccess(state, context, config.sourceIds);
      check(typeof config.goal === 'string' && config.goal.trim() === value.objective.trim(), 'INVESTIGATION_JOB_CHANGED', 'The mandate goal must preserve the authored investigation objective.');
      if (input.finalize) service(view(state)).capsule(context, value.id);
      return { investigationId: input.investigationId, expectedRevision: input.expectedRevision, steps: structuredClone(input.steps), ...(input.finalize ? { finalize: structuredClone(input.finalize) } : {}), binding: bindingFor(value, context) };
    },
    plan: input => input.finalize ? { runnerVersion: '1', steps: [{ id: 'investigation-finalize', provider: 'local-investigation', input: json({ ...(input.binding ? { binding: input.binding } : {}), stepId: 'finalize', finalize: true }), reserveMinor: input.finalize.reserveMinor, durationMs: input.finalize.durationMs, modelUnits: 0, actionExposureMinor: '0', modelRequired: false, dependencies: [] }], children: [], obligations: [{ id: 'final-capsule', description: 'Deliver the current complete saved investigation capsule without recalculating', requiredStepIds: ['investigation-finalize'] }] } : ({ runnerVersion: '1', steps: input.steps.map((s, index) => ({ id: `investigation-step-${index + 1}`, provider: 'local-investigation',
      input: json({ ...(input.binding ? { binding: input.binding } : {}), stepId: s.stepId }), reserveMinor: s.reserveMinor,
      durationMs: s.durationMs, modelUnits: 0, actionExposureMinor: '0', modelRequired: false,
      dependencies: index ? [{ stepId: `investigation-step-${index}`, informationClass: 'computation' as const, evidenceRequired: true }] : [] })), children: [],
      obligations: input.steps.map((s, index) => ({ id: `measurement-${index + 1}`, description: `Complete authored investigation step ${s.stepId}`, requiredStepIds: [`investigation-step-${index + 1}`] })) }),
    deliver: (input, results) => {
      check(input.binding, 'JOB_EVIDENCE_REQUIRED', 'An investigation deliverable needs its admitted binding.');
      const values = (input.finalize ? ['investigation-finalize'] : input.steps.map((_s, index) => `investigation-step-${index + 1}`)).map(id => {
        const result = results[id];
        check(result?.informationClass === 'computation' && result.evidenceIds.length === 1, 'JOB_EVIDENCE_REQUIRED', 'Every mandatory authored step needs its measured computation receipt.');
        return result.value as unknown as StepValue;
      });
      const capsule = values.at(-1)?.finalCapsule;
      check(capsule?.status === 'complete' && capsule.pendingStepIds.length === 0 && capsule.investigationId === input.investigationId,
        'JOB_INCOMPLETE', 'The complete persisted investigation capsule is required before delivery.');
      return json({ kind: 'private-investigation-deliverable-v1', investigationId: input.investigationId, revision: capsule.revision, capsule,
        stepReceipts: [...input.binding.completedPrefix.map(p => ({ stepId: p.stepId, receiptId: p.receipt.receiptId })), ...(input.finalize ? [] : values.map(v => ({ stepId: v.stepId, receiptId: v.receiptId })))],
        interpretation: 'measured-results-and-owner-hypotheses' });
    }, release,
  };
  const provider: GoalProvider = {
    id: 'local-investigation', kind: 'read-only', transport: 'local', model: false,
    authorize: (state, _context, request, mode) => {
      const actual = admitted(state, request, mode === 'dispatch', mode !== 'dispatch'), prior = saved(state, request);
      if (!prior && mode === 'dispatch') check(actual.input.finalize ? actual.value.status === 'complete' : actual.value.status === 'open' && actual.value.steps.find(s => s.state === 'pending')?.id === actual.input.stepId,
        'INVESTIGATION_NOT_OPEN', 'The next authored investigation step is paused, cancelled or already advanced.');
    },
    dispatch: async request => {
      const actual = admitted(store.read(), request, true), prior = saved(store.read(), request);
      if (prior) { check(['completed', 'finalized'].includes(prior.outcome) && prior.settlement && release(request.context, prior.settlement.result), 'INVESTIGATION_JOB_PAUSED', 'The admitted step has a known blocked result.'); return json(prior.settlement); }
      const started = Date.now();
      if (actual.input.finalize) return store.update(state => {
        const checked = admitted(state, request, true); check(checked.value.status === 'complete', 'JOB_INCOMPLETE', 'Finalization requires every saved authored measurement.');
        const capsule = service(view(state)).capsule(request.context, checked.value.id), last = prefix(checked.value).at(-1)!;
        const id = `investigation-operation:${request.key}`;
        const value: StepValue = { kind: 'private-investigation-step-v1', operationId: id, investigationId: checked.value.id, stepId: 'finalize',
          receiptId: last.receipt.receiptId, receipt: last.receipt, completedPrefixDigest: digest(prefix(checked.value)), finalCapsule: capsule };
        const durationMs = Date.now() - started;
        const settlement: ProviderSettlement = { result: { value: json(value), informationClass: 'computation', evidenceIds: [value.receiptId], sourceTainted: true }, spentMinor: '0', modelUnits: 0, durationMs, actionExposureMinor: '0' };
        validateSettlement(settlement, request.step);
        const body = { kind: 'private-investigation-job-operation-v1' as const, id, key: request.key, requestDigest: requestDigest(request), bindingDigest: digest(checked.input.binding), investigationId: checked.value.id, stepId: 'finalize', memberId: request.context.memberId, epoch: request.context.epoch, role: request.context.role, beforeRevision: checked.value.revision, afterRevision: checked.value.revision, outcome: 'finalized' as const, prefix: prefix(checked.value), sourceIds: [...checked.value.sourceIds], rowIds: [...checked.value.rowIds], durationMs, settlement, at: jobs.timestamp() };
        check(!saved(state, request), 'JOB_OPERATION_CONFLICT', 'The final capsule already has its correlated result.');
        state.answers.push({ ...body, integrity: digest(body) }); return json(settlement);
      });
      let record: InvestigationJobOperation | undefined;
      active.add(request.key);
      try {
        await service().advanceCorrelated(request.context, actual.value.id, { expectedRevision: actual.value.revision }, {
          before: state => { const next = admitted(state, request, true); check(next.value.revision === actual.value.revision && next.value.steps.find(s => s.state === 'pending')?.id === actual.input.stepId, 'INVESTIGATION_REVISION_CONFLICT', 'The admitted saved prefix changed before advancement.'); },
          after: (state, before, after) => {
            // The service has already committed into this transaction view; checks here can still roll it back.
            check(!request.signal.aborted, 'JOB_CANCELLED', 'The private continuation was interrupted before its atomic commit.');
            const currentJob = jobs.find(state, actual.job.id); const attempt = currentJob.execution?.attempts.find(a => a.key === request.key);
            check(currentJob.status === 'running' && currentJob.lease && attempt && currentJob.fence === attempt.fence
              && Date.parse(currentJob.lease.expiresAt) > jobs.clock(), 'JOB_CANCELLED', 'The admitted continuation lost its lease before committing.');
            current(state, request.context, 'prepare'); sourceAccess(state, request.context, currentJob.execution!.sourceIds);
            const checked = service(view(state)).get(request.context, after.id);
            check(basis(checked) === actual.input.binding.basisHash && checked.revision === before.revision + 1, 'INVESTIGATION_JOB_CHANGED', 'The admitted investigation changed while measuring.');
            const step = checked.steps.find(s => s.id === actual.input.stepId)!; const durationMs = Date.now() - started;
            const base = { kind: 'private-investigation-job-operation-v1' as const, id: `investigation-operation:${request.key}`, key: request.key,
              requestDigest: requestDigest(request), bindingDigest: digest(actual.input.binding), investigationId: checked.id, stepId: step.id,
              memberId: request.context.memberId, epoch: request.context.epoch, role: request.context.role,
              beforeRevision: before.revision, afterRevision: checked.revision, prefix: prefix(checked), sourceIds: [...checked.sourceIds], rowIds: [...checked.rowIds], durationMs, at: jobs.timestamp() };
            if (step.state !== 'completed') {
              check(checked.status === 'paused', 'JOB_OPERATION_CONFLICT', 'An unmeasured advancement must retain a declared pause.');
              validateSettlement({ result: { value: { kind: 'job-step-blocked-v1', reason: checked.pauseReason ?? 'investigation-paused' }, informationClass: 'observation', evidenceIds: [base.id], sourceTainted: false }, spentMinor: '0', modelUnits: 0, durationMs, actionExposureMinor: '0' }, request.step);
              const blocked = { ...base, outcome: 'blocked' as const, reason: checked.pauseReason ?? 'investigation-paused' };
              record = { ...blocked, integrity: digest(blocked) };
            } else {
              const value: StepValue = { kind: 'private-investigation-step-v1', operationId: base.id, investigationId: checked.id, stepId: step.id,
                receiptId: step.receipt!.receiptId, receipt: step.receipt!, completedPrefixDigest: digest(base.prefix),
                ...(checked.status === 'complete' ? { finalCapsule: service(view(state)).capsule(request.context, checked.id) } : {}) };
              const settlement: ProviderSettlement = { result: { value: json(value), informationClass: 'computation', evidenceIds: [value.receiptId], sourceTainted: true }, spentMinor: '0', modelUnits: 0, durationMs, actionExposureMinor: '0' };
              validateSettlement(settlement, request.step);
              const completed = { ...base, outcome: 'completed' as const, settlement }; record = { ...completed, integrity: digest(completed) };
            }
            check(!saved(state, request), 'JOB_OPERATION_CONFLICT', 'This logical investigation step already has atomic evidence.'); state.answers.push(json(record));
          },
        });
        check(record, 'JOB_OPERATION_MISSING', 'The saved advancement needs its atomic operation identity.');
        check(record.outcome === 'completed' && record.settlement, 'INVESTIGATION_JOB_PAUSED', 'The saved investigation paused without measuring this step; reconcile its known blocked result.');
        return json(record.settlement);
      } finally { active.delete(request.key); }
    },
    reconcile: async request => {
      admitted(store.read(), request, false); const record = saved(store.read(), request);
      if (!record) return active.has(request.key) ? { outcome: 'unknown' as const } : { outcome: 'absent' as const, id: request.key, spentMinor: '0', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' };
      if (record.outcome === 'blocked') return { outcome: 'blocked' as const, id: record.id, reason: record.reason!, spentMinor: '0', modelUnits: 0, durationMs: record.durationMs, actionExposureMinor: '0' };
      check(record.settlement && release(request.context, record.settlement.result), 'JOB_EVIDENCE_REVOKED', 'The atomic investigation result is unavailable under current authority.');
      return { outcome: 'verified' as const, id: record.settlement.result.evidenceIds[0], settlement: json(record.settlement) };
    },
  };
  return { runner, provider };
}
