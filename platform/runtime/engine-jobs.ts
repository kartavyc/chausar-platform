import { CalculatorService, type CalculatorOptions, type CalculationRequest, type CalculationReceipt } from './calculator.ts';
import { ActionService, digest, sourceAccess } from './actions.ts';
import { check, type Context, type StateStore } from './contracts.ts';
import { DurableJobRunner, type ProviderRequest, type GoalRunner, type GoalProvider } from './job-runner.ts';
import { calculationGoal, evidenceGoal } from './job-goals.ts';
import { json, validateSettlement, type ProviderSettlement, type StepResult, type Json } from './job-protocol.ts';
import { JobService } from './jobs.ts';
import { investigationJobPorts } from './investigation-jobs.ts';

/** Host configuration, never a pricing policy or a provider qualification. */
export type EngineJobOptions = {
  workerId: string; maxActiveJobs: number; leaseMs: number;
  networkAvailable: () => boolean;
  /** Trusted host clock; fixtures explicitly label synthetic time. */
  clock?: () => number;
};
export type JobLifecycle = { awake: boolean; windowOpen: boolean; backgroundEnabled: boolean };
type OperationRecord = {
  key: string; requestDigest: string; sourceIds: string[];
  memberId: string; epoch: number; role: Context['role']; settlement: ProviderSettlement;
};
const receiptValue = (receipt: CalculationReceipt): Json => json({
  receiptId: receipt.id, operation: receipt.operation, valueMinor: receipt.valueMinor,
  currency: receipt.currency, coverage: receipt.coverage,
});
const result = (receipt: CalculationReceipt, informationClass: 'computation' | 'observation'): StepResult => ({
  value: receiptValue(receipt), informationClass, evidenceIds: [receipt.id], sourceTainted: true,
});
const settlement = (value: StepResult, durationMs: number): ProviderSettlement => ({
  result: value, spentMinor: '0', modelUnits: 0, durationMs, actionExposureMinor: '0',
});

/** Real local adapters: exact calculations, existing receipt review and preparation only. */
export function createEngineJobRunner(store: StateStore, jobs: JobService, actions: ActionService, calculationOptions: CalculatorOptions, options: EngineJobOptions) {
  const calculator = new CalculatorService(store, calculationOptions);
  const activeOperations = new Set<string>();
  const sources = (request: ProviderRequest): string[] => {
    const job = jobs.find(store.read(), request.key.split(':revision:')[0]);
    check(job.execution && job.execution.attempts.some(attempt => attempt.key === request.key), 'JOB_ATTEMPT_MISSING', 'The local operation needs its persisted attempt.');
    sourceAccess(store.read(), request.context, job.execution.sourceIds);
    return [...job.execution.sourceIds];
  };
  const identity = (request: ProviderRequest, sourceIds: string[]) => digest({ input: request.step.input, memberId: request.context.memberId, epoch: request.context.epoch, role: request.context.role, sourceIds });
  const record = (request: ProviderRequest, sourceIds: string[], value: ProviderSettlement): OperationRecord => ({
    key: request.key, requestDigest: identity(request, sourceIds), sourceIds,
    memberId: request.context.memberId, epoch: request.context.epoch, role: request.context.role, settlement: json(value),
  });
  const saved = (request: ProviderRequest, sourceIds: string[]): OperationRecord | undefined => {
    const state = store.read();
    const records = [...state.receipts, ...state.answers].map(item => item.jobOperation as OperationRecord | undefined).filter(item => item?.key === request.key);
    check(records.length <= 1, 'JOB_OPERATION_CONFLICT', 'A local operation has more than one saved result.');
    const item = records[0];
    if (item) check(item.requestDigest === identity(request, sourceIds) && item.memberId === request.context.memberId && item.epoch === request.context.epoch && item.role === request.context.role, 'JOB_OPERATION_CONFLICT', 'The stored local operation belongs to different input or authority.');
    return item;
  };
  const receipt = (context: Context, id: string, sourceIds?: string[]) => {
    const value = calculator.receipt(context, id);
    check(!value.stale, 'JOB_EVIDENCE_REVOKED', 'This evidence is marked stale. Recalculate for a new objective.');
    const state = store.read();
    const lineage = [...new Set([...value.sourceIds, ...[...value.rowIds, ...value.exclusions.map(item => item.rowId)].map(id => state.facts.find(fact => fact.id === id)?.sourceId).filter((id): id is string => !!id)])];
    sourceAccess(state, context, lineage);
    if (sourceIds) check(lineage.every(id => sourceIds.includes(id)), 'JOB_SOURCE_SCOPE', 'The receipt contains sources outside this mandate.');
    return value;
  };
  const release = (context: Context, value: StepResult): boolean => {
    try {
      if (value.informationClass === 'action-preview') {
        const preview = value.value as { actionId?: string; digest?: string };
        const action = actions.find(store.read(), preview.actionId!); actions.access(store.read(), context, action);
        actions.operation(action.connector, action.operation).authorize?.(store.read(), context, 'read');
        return value.evidenceIds.length === 1 && value.evidenceIds[0] === action.id && preview.digest === action.digest && action.digest === actions.identity(action) && !['cancelled', 'rejected', 'blocked'].includes(action.status);
      }
      const id = (value.value as { receiptId?: string })?.receiptId;
      if (!id || value.evidenceIds.length !== 1 || value.evidenceIds[0] !== id) return false;
      return digest(value.value) === digest(receiptValue(receipt(context, id)));
    } catch { return false; }
  };
  const readback = async (request: ProviderRequest) => {
    const sourceIds = sources(request); const item = saved(request, sourceIds);
    if (!item) return activeOperations.has(request.key) ? { outcome: 'unknown' as const } : { outcome: 'absent' as const, id: request.key, spentMinor: '0', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' };
    check(release(request.context, item.settlement.result), 'JOB_EVIDENCE_REVOKED', 'The recorded local result is unavailable under current access.');
    return { outcome: 'verified' as const, id: item.settlement.result.evidenceIds[0], settlement: json(item.settlement) };
  };
  const calculations: GoalProvider = {
    id: 'local-calculation', kind: 'read-only', transport: 'local', model: false,
    dispatch: async request => {
      const sourceIds = sources(request); const prior = saved(request, sourceIds);
      if (prior) { check(release(request.context, prior.settlement.result), 'JOB_EVIDENCE_REVOKED', 'The saved calculation is unavailable.'); return json(prior.settlement); }
      const startedAt = Date.now(); let operation: OperationRecord | undefined;
      // Restrict computation input, without changing the shared store or another owner.
      // Correlation and settlement are committed with the receipt, closing the crash gap.
      const scoped: StateStore = {
        read: () => { const state = store.read(); state.facts = state.facts.filter(fact => sourceIds.includes(fact.sourceId)); return state; },
        update: change => store.update(async state => {
          check(!request.signal.aborted, 'JOB_CANCELLED', 'The calculation was interrupted before saving.');
          const before = new Set(state.receipts.map(item => item.id)); const value = await change(state);
          check(!request.signal.aborted, 'JOB_CANCELLED', 'The calculation was interrupted before saving.');
          const added = state.receipts.filter(item => !before.has(item.id));
          check(added.length === 1, 'JOB_OPERATION_CONFLICT', 'The local calculation must save one exact receipt.');
          const proof = added[0] as CalculationReceipt;
          check([...proof.sourceIds, ...proof.exclusions.map(item => state.facts.find(fact => fact.id === item.rowId)?.sourceId)].every(id => id && sourceIds.includes(id)), 'JOB_SOURCE_SCOPE', 'The saved calculation exceeded its source scope.');
          operation = record(request, sourceIds, settlement(result(proof, 'computation'), Date.now() - startedAt));
          validateSettlement(operation.settlement, request.step);
          added[0].jobOperation = operation;
          return value;
        }),
      };
      activeOperations.add(request.key);
      try {
        await new CalculatorService(scoped, calculationOptions).calculate(request.context, json(request.step.input) as unknown as CalculationRequest);
        check(operation, 'JOB_OPERATION_MISSING', 'The calculation did not persist its result identity.');
        return json(operation.settlement);
      } finally { activeOperations.delete(request.key); }
    }, reconcile: readback,
  };
  const evidence: GoalProvider = {
    id: 'local-evidence', kind: 'read-only', transport: 'local', model: false,
    dispatch: async request => {
      const sourceIds = sources(request); const prior = saved(request, sourceIds);
      if (prior) { check(release(request.context, prior.settlement.result), 'JOB_EVIDENCE_REVOKED', 'The saved evidence is unavailable.'); return json(prior.settlement); }
      const input = request.step.input as { receiptId?: string };
      check(input && typeof input.receiptId === 'string' && Object.keys(input).length === 1, 'INVALID_JOB_INPUT', 'Review an exact existing receipt ID.');
      return store.update(state => {
        check(!request.signal.aborted, 'JOB_CANCELLED', 'The evidence review was interrupted before saving.');
        const proof = receipt(request.context, input.receiptId!, sourceIds);
        const value = settlement(result(proof, 'observation'), 0);
        state.answers.push({ id: `job-evidence:${request.key}`, kind: 'job-evidence', receiptId: proof.id, sourceIds, at: jobs.timestamp(), jobOperation: record(request, sourceIds, value) });
        return value;
      });
    }, reconcile: readback,
  };
  const prepare: GoalRunner<{ actions: { id: string; input: Json; reserveMinor: string; durationMs: number }[] }> = {
    type: 'action-preparation', version: '1',
    validate: input => {
      const clean = json(input) as { actions?: { id: string; input: Json; reserveMinor: string; durationMs: number }[] };
      check(clean && Object.keys(clean).length === 1 && Array.isArray(clean.actions) && clean.actions.length > 0, 'INVALID_JOB_INPUT', 'Supply exact action preparation requests.');
      for (const item of clean.actions) {
        const action = item.input as { connector?: string; operation?: string; payload?: unknown };
        check(action && typeof action.connector === 'string' && typeof action.operation === 'string' && Object.hasOwn(action, 'payload') && Object.keys(action).every(key => ['connector', 'operation', 'payload', 'sourceIds'].includes(key)), 'INVALID_JOB_INPUT', 'Name the action operation and exact preview payload.');
      }
      return { actions: clean.actions };
    },
    plan: input => ({ runnerVersion: '1', steps: input.actions.map(item => ({ id: item.id, provider: 'local-action-preparation', input: item.input, reserveMinor: item.reserveMinor, durationMs: item.durationMs, modelUnits: 0, actionExposureMinor: '0', modelRequired: false, dependencies: [] })), children: [], obligations: input.actions.map(item => ({ id: item.id, description: `Prepare the requested action ${item.id}`, requiredStepIds: [item.id] })) }),
    deliver: (input, results) => {
      for (const item of input.actions) check(results[item.id]?.informationClass === 'action-preview' && results[item.id].evidenceIds.length === 1, 'JOB_EVIDENCE_REQUIRED', 'Every preparation needs its exact action preview.');
      return json({ actions: input.actions.map(item => ({ id: item.id, ...results[item.id] })), businessSuccess: false });
    }, release,
  };
  const investigation = investigationJobPorts(store, jobs, calculationOptions);
  return new DurableJobRunner(jobs, [calculationGoal({ providerId: calculations.id, release }), evidenceGoal({ providerId: evidence.id, release }), prepare, investigation.runner], [calculations, evidence, { id: 'local-action-preparation', kind: 'prepare-action', transport: 'local', model: false }, investigation.provider], { ...options, actions });
}

/** Only explicitly supplied policy enables typed jobs in the process entry points. */
export function engineJobOptions(environment: Record<string, string | undefined>): EngineJobOptions | undefined {
  const fields = [environment.CHAUSAR_JOB_WORKER_ID, environment.CHAUSAR_JOB_MAX_ACTIVE, environment.CHAUSAR_JOB_LEASE_MS];
  if (fields.every(value => value === undefined)) return undefined;
  check(typeof fields[0] === 'string' && fields[0].length >= 1 && fields[0].length <= 100 && fields.slice(1).every(value => typeof value === 'string' && /^[1-9]\d*$/.test(value)), 'INVALID_JOB_RUNNER', 'Configure all explicit job worker, active ceiling and lease settings.');
  return { workerId: fields[0], maxActiveJobs: Number(fields[1]), leaseMs: Number(fields[2]), networkAvailable: () => false };
}
