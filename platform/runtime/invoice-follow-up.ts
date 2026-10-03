import { check, audit, type Context, type State, type StateStore } from './contracts.ts';
import { ActionService, current, digest, sourceAccess, type Connector, type PreparedAction } from './actions.ts';
import { CalculatorService, type CalculationReceipt, type CalculatorOptions } from './calculator.ts';
import { formatMinor } from './currency.ts';
import { selectFacts } from './memory.ts';
import { JobService, type Job, type JobConfig } from './jobs.ts';
import { DurableJobRunner, type GoalRunner, type GoalProvider, type ProviderRequest } from './job-runner.ts';
import { json, money, validateSettlement, type Json, type ProviderSettlement, type StepResult } from './job-protocol.ts';

export const invoiceJobType = 'invoice-follow-up';
export const invoiceConnectorId = 'simulated-invoice-reminder';
export type InvoiceTarget = { invoiceId: string; customerId: string; invoiceLink: string };
export type InvoiceJobInput = {
  targets: InvoiceTarget[]; acceptanceTest: string; reviewAt: string;
  calculation: { reserveMinor: string; durationMs: number };
  preparation: { reserveMinor: string; durationMs: number };
};
/** All values are explicit fixture/host policy, never product pricing or vendor qualification. */
export type InvoiceHostOptions = {
  clock: () => number; workerId: string; maxActiveJobs: number; leaseMs: number;
  approvalTtlMs: number; dailyCap: number; perCustomerDailyCap: number;
  dayKey: (instant: number) => string; stopWord: string;
  simulatedStepCostMinor: string; simulatedSendCostMinor: string;
};
export type InvoiceConsent = {
  kind: 'invoice-opt-in-v1'; id: string; requestId: string; ownerId: string; epoch: number;
  customerId: string; channel: 'simulation'; destination: string;
  status: 'yes' | 'no' | 'not-asked' | 'stopped'; sourceId: string; evidence: string; at: string;
};
export type InvoiceProof = {
  kind: 'invoice-balance-proof-v1'; id: string; jobId: string; objectiveRevision: number; target: InvoiceTarget;
  memberId: string; epoch: number; receiptId: string; receiptDigest: string; scopeDigest: string;
  currency: string; billedMinor: string; outstandingMinor: string; collectedMinor: string; dueDate: string;
  invoiceFactId: string; paymentFactIds: string[]; bankFactIds: string[];
  outcome: 'open' | 'paid' | 'cleared-unconfirmed' | 'needs-review'; reasons: string[]; at: string;
};
type InvoiceOperation = { kind: 'invoice-job-operation-v1'; id: string; key: string; requestDigest: string; settlement: ProviderSettlement };
type Approval = { kind: 'invoice-reminder-approval-v1'; actionId: string; digest: string; approvedAt: string; expiresAt: string };
type Delivery = { kind: 'invoice-simulated-delivery-v1'; id: string; key: string; actionId: string; payloadDigest: string;
  jobId: string; customerId: string; ownerId: string; epoch: number; day: string; costMinor: string;
  status: 'reserved' | 'sent' | 'not-sent'; at: string; sentAt?: string; reason?: string };
type ReminderPayload = { version: 1; mode: 'simulation'; jobId: string; objectiveRevision: number; occurrence: string;
  proofId: string; proofDigest: string; consentId: string; consentDigest: string; target: InvoiceTarget; text: string };
const closed = (value: unknown, keys: string[]) => check(value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).every(key => keys.includes(key)),
  'INVALID_INVOICE_REQUEST', 'Use only declared invoice fields.');
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;
const view = (state: State): StateStore => ({ read: () => structuredClone(state), update: async change => await change(state) });
// Memory marks historical answers/receipts stale in place. Freshness is a separate
// admission check; it must not rewrite the identity needed for effect readback.
const evidenceDigest = (value: unknown) => { const { stale, staleReason, ...body } = value as Record<string, unknown>; return digest(body); };
const scopeDigest = (state: State, ids: string[]) => digest({ facts: state.facts.filter(f => ids.includes(f.sourceId)),
  merges: state.merges, tombstones: state.tombstones, sourceRules: state.sourceRules, dictionaryHash: state.ontology?.hash ?? null });
class InvoiceJobService extends JobService {
  override list(context: Context) { return super.list(context).filter(job => job.type === invoiceJobType); }
}

function validateInput(input: unknown): InvoiceJobInput {
  const value = json(input) as InvoiceJobInput;
  closed(value, ['targets', 'acceptanceTest', 'reviewAt', 'calculation', 'preparation']);
  check(Array.isArray(value.targets) && value.targets.length > 0 && value.targets.length <= 64
    && typeof value.acceptanceTest === 'string' && value.acceptanceTest.trim().length >= 5 && value.acceptanceTest.length <= 2000
    && Number.isFinite(Date.parse(value.reviewAt)), 'INVALID_INVOICE_REQUEST', 'Declare bounded targets, acceptance test and review date.');
  const ids = new Set<string>();
  for (const target of value.targets) {
    closed(target, ['invoiceId', 'customerId', 'invoiceLink']);
    check(text(target.invoiceId) && text(target.customerId) && typeof target.invoiceLink === 'string'
      && /^synthetic-invoice:[A-Za-z0-9_.-]{1,100}$/.test(target.invoiceLink), 'INVALID_INVOICE_REQUEST', 'Use explicit synthetic invoice and customer identities.');
    const key = digest([target.invoiceId, target.customerId]); check(!ids.has(key), 'INVALID_INVOICE_REQUEST', 'Invoice targets must be distinct.'); ids.add(key);
  }
  for (const limit of [value.calculation, value.preparation]) {
    closed(limit, ['reserveMinor', 'durationMs']); money(limit.reserveMinor);
    check(Number.isSafeInteger(limit.durationMs) && limit.durationMs > 0, 'INVALID_INVOICE_REQUEST', 'Every step needs an explicit time ceiling.');
  }
  return value;
}

/** Source/public-contract composition for synthetic workspaces. No network, model, timer or native DB port. */
export class InvoiceFollowUpHost {
  readonly store: StateStore; readonly options: InvoiceHostOptions; readonly jobs: JobService;
  readonly runner: DurableJobRunner; readonly connector: Connector;
  private actions: ActionService; private calculatorOptions: CalculatorOptions;
  private activeCalls = 0; private activeOperations = new Set<string>();
  constructor(store: StateStore, options: InvoiceHostOptions, calculatorOptions: CalculatorOptions = {}) {
    check(typeof options.clock === 'function' && typeof options.dayKey === 'function'
      && Number.isSafeInteger(options.approvalTtlMs) && options.approvalTtlMs > 0
      && [options.dailyCap, options.perCustomerDailyCap].every(n => Number.isSafeInteger(n) && n > 0)
      && typeof options.stopWord === 'string' && /^[A-Za-z]{1,20}$/.test(options.stopWord),
    'INVOICE_POLICY_REQUIRED', 'Supply explicit expiry, daily caps, day boundary and stop word.');
    money(options.simulatedStepCostMinor); money(options.simulatedSendCostMinor);
    this.store = store; this.options = { ...options }; this.calculatorOptions = calculatorOptions;
    this.jobs = new InvoiceJobService(store, { clock: options.clock, deliverableGuard: (context, job) => this.runner.canRelease(context, job) });
    this.connector = { id: invoiceConnectorId, title: 'Simulated invoice reminders', operations: { send: {
      title: 'Simulate an individually approved reminder', description: 'Local deterministic ledger only; delivery never means paid.',
      impact: 'message', idempotency: 'One exact action/key, no uncertain replay', readback: 'Retained simulated delivery ledger',
      validate: payload => { closed(payload, ['version', 'mode', 'jobId', 'objectiveRevision', 'occurrence', 'proofId', 'proofDigest', 'consentId', 'consentDigest', 'target', 'text']);
        const p = json(payload) as ReminderPayload; check(p.version === 1 && p.mode === 'simulation' && text(p.jobId)
          && text(p.proofId) && text(p.consentId) && typeof p.text === 'string' && p.text.length <= 3000,
        'INVALID_INVOICE_REQUEST', 'A reminder needs its exact retained invoice/consent preview.'); return p as unknown as Record<string, unknown>; },
      authorize: (state, context) => this.access(state, context),
      execute: (payload, key, context) => this.send(context, payload as unknown as ReminderPayload, key),
      reconcile: async (payload, key, _result, context) => {
        const state = this.store.read(); this.historical(state, context, payload as unknown as ReminderPayload);
        const saved = this.delivery(state, key);
        if (!saved || saved.status === 'reserved') return { verified: false, businessSuccess: false };
        check(saved.payloadDigest === digest(payload), 'INVOICE_DELIVERY_CONFLICT', 'The delivery belongs to another exact preview.');
        return saved.status === 'sent' ? { verified: true, businessSuccess: false, externalId: saved.id,
          data: { mode: 'simulation', sent: true, paid: false, sentAt: saved.sentAt } }
          : { verified: false, businessSuccess: false, absent: true, data: { mode: 'simulation', sent: false, paid: false, reason: saved.reason } };
      },
    } } };
    this.actions = new ActionService(store, [this.connector]);
    const ports = this.ports();
    this.runner = new DurableJobRunner(this.jobs, [ports.goal], [ports.provider], { workerId: options.workerId,
      maxActiveJobs: options.maxActiveJobs, leaseMs: options.leaseMs, networkAvailable: () => false, actions: this.actions });
  }
  private at() { return new Date(this.options.clock()).toISOString(); }
  private access(state: State, context: Context) {
    current(state, context); check(state.workspace.demo, 'INVOICE_SIMULATION_ONLY', 'This installed slice accepts synthetic demo workspaces only.');
  }
  private own(state: State, context: Context, id: string) {
    this.access(state, context); const job = this.jobs.find(state, id); sourceAccess(state, context, job.sourceIds);
    check(job.type === invoiceJobType && job.ownerId === context.memberId && job.ownerEpoch === context.epoch && job.ownerRole === context.role,
      'JOB_OWNER_REQUIRED', 'Only the pinned invoice mandate owner may use this contract.'); return job;
  }
  private consent(state: State, context: Context, customerId: string) {
    return state.answers.filter(a => a.kind === 'invoice-opt-in-v1' && a.ownerId === context.memberId
      && a.epoch === context.epoch && a.customerId === customerId && a.channel === 'simulation').at(-1) as InvoiceConsent | undefined;
  }
  private proof(state: State, id: string): InvoiceProof {
    const p = state.answers.find(a => a.kind === 'invoice-balance-proof-v1' && a.id === id) as InvoiceProof | undefined;
    check(p, 'INVOICE_PROOF_MISSING', 'The invoice balance proof is unavailable.'); return p;
  }
  private receipt(state: State, context: Context, proof: InvoiceProof, currentProof: boolean) {
    const job = this.own(state, context, proof.jobId);
    const receipt = new CalculatorService(view(state), this.calculatorOptions).receipt(context, proof.receiptId);
    sourceAccess(state, context, receipt.sourceIds);
    check(receipt.sourceIds.every(id => job.sourceIds.includes(id)) && evidenceDigest(receipt) === proof.receiptDigest,
      'INVOICE_PROOF_CHANGED', 'The exact retained invoice calculation changed.');
    if (currentProof) check(!receipt.stale && scopeDigest(state, job.sourceIds) === proof.scopeDigest,
      'INVOICE_EVIDENCE_CHANGED', 'The invoice amount, customer identity, dictionary or source evidence changed; prepare a fresh occurrence.');
    return receipt;
  }
  private historical(state: State, context: Context, payload: ReminderPayload) {
    const job = this.own(state, context, payload.jobId); const proof = this.proof(state, payload.proofId);
    check(proof.jobId === job.id && proof.objectiveRevision === payload.objectiveRevision && evidenceDigest(proof) === payload.proofDigest
      && digest(proof.target) === digest(payload.target), 'INVOICE_PROOF_CHANGED', 'The exact reminder proof or target changed.');
    this.receipt(state, context, proof, false); return { job, proof };
  }
  private live(state: State, context: Context, payload: ReminderPayload, sending = false) {
    const { job, proof } = this.historical(state, context, payload);
    check(job.revision === payload.objectiveRevision && job.digest === this.jobs.identity(job)
      && !['cancelled', 'revoked', 'stopped', 'paused', 'accepted', 'budget-blocked'].includes(job.status),
    'INVOICE_MANDATE_STOPPED', 'This reminder mandate is cancelled, paused, finished, revised or blocked.');
    check(this.options.clock() < Date.parse(job.stopRule.deadline), 'JOB_STOP_RULE', 'The invoice mandate deadline was reached.');
    if (sending) check(job.status === 'awaiting-acceptance', 'INVOICE_NOT_DELIVERED', 'Wait for the invoice result before sending reminders.');
    this.receipt(state, context, proof, true);
    const consent = this.consent(state, context, payload.target.customerId);
    check(consent?.status === 'yes' && consent.id === payload.consentId && evidenceDigest(consent) === payload.consentDigest,
      'INVOICE_OPT_IN_REQUIRED', 'Customer opt-in or recipient changed or was stopped.');
    sourceAccess(state, context, [consent.sourceId]);
    check(proof.outcome === 'open' && money(proof.outstandingMinor) > 0n, 'INVOICE_NOT_OPEN', 'Only proven open invoices may have reminders.');
    const expected = this.payload(job, proof, consent, payload.occurrence);
    check(digest(expected) === digest(payload), 'PREVIEW_CHANGED', 'The reminder text or exact target changed.'); return { job, proof, consent };
  }
  private payload(job: Job, proof: InvoiceProof, consent: InvoiceConsent, occurrence: string): ReminderPayload {
    return { version: 1, mode: 'simulation', jobId: job.id, objectiveRevision: job.revision, occurrence,
      proofId: proof.id, proofDigest: evidenceDigest(proof), consentId: consent.id, consentDigest: evidenceDigest(consent), target: proof.target,
      text: `Invoice ${proof.target.invoiceId}: ${formatMinor(proof.outstandingMinor, proof.currency)} outstanding, due ${proof.dueDate}. Invoice: ${proof.target.invoiceLink}. Reply ${this.options.stopWord} to stop reminders.` };
  }
  private delivery(state: State, key: string) {
    const found = state.answers.filter(a => a.kind === 'invoice-simulated-delivery-v1' && a.key === key) as Delivery[];
    check(found.length <= 1, 'INVOICE_DELIVERY_CONFLICT', 'A delivery key has multiple journals.'); return found[0];
  }
  private releaseReservation(state: State, delivery: Delivery, reason: string) {
    if (delivery.status !== 'reserved') return;
    const job = this.jobs.find(state, delivery.jobId); check(money(job.reservedMinor) >= money(delivery.costMinor), 'INVOICE_BUDGET_CONFLICT', 'The delivery reservation is missing.');
    job.reservedMinor = String(money(job.reservedMinor) - money(delivery.costMinor)); delivery.status = 'not-sent'; delivery.reason = reason;
    job.ledger.push({ at: this.at(), event: 'invoice-not-sent', reason, amountMinor: delivery.costMinor });
  }
  private async send(context: Context, payload: ReminderPayload, key: string) {
    try { return await this.store.update(state => {
      const { job } = this.live(state, context, payload, true); const delivery = this.delivery(state, key);
      check(delivery?.status === 'reserved' && delivery.payloadDigest === digest(payload), 'INVOICE_DELIVERY_NOT_ADMITTED', 'Delivery requires the exact reserved invoice action.');
      check(delivery.day === this.options.dayKey(this.options.clock()), 'INVOICE_DAY_CHANGED', 'The configured reminder day changed after admission; this local effect is absent.');
      const action = this.actions.find(state, delivery.actionId); this.actions.approved(state, context, action);
      this.validApproval(state, action); check(action.status === 'executing' && action.attempts.length === 1,
        'INVOICE_DELIVERY_NOT_ADMITTED', 'The exact action attempt must precede simulated delivery.');
      // This single local commit is the only simulated effect. No transport is installed.
      job.reservedMinor = String(money(job.reservedMinor) - money(delivery.costMinor));
      job.spentMinor = String(money(job.spentMinor) + money(delivery.costMinor)); delivery.status = 'sent'; delivery.sentAt = this.at();
      job.ledger.push({ at: delivery.sentAt, event: 'invoice-sent', amountMinor: delivery.costMinor, reason: delivery.id });
      audit(state, 'invoice.simulated-sent', { jobId: job.id, actionId: action.id, deliveryId: delivery.id, paid: false });
      return { externalId: delivery.id, businessSuccess: false, data: { mode: 'simulation', sent: true, paid: false, sentAt: delivery.sentAt } };
    }); } catch (failure) {
      // A refusal before the local effect is known absent; a lost committed response stays sent.
      await this.store.update(state => { const delivery = this.delivery(state, key); if (delivery?.status === 'reserved') this.releaseReservation(state, delivery, (failure as { code?: string }).code ?? 'LOCAL_SIMULATION_INTERRUPTED'); });
      throw failure;
    }
  }
  private validApproval(state: State, action: PreparedAction) {
    const approval = state.answers.find(a => a.kind === 'invoice-reminder-approval-v1' && a.actionId === action.id) as Approval | undefined;
    check(approval?.digest === action.digest && this.options.clock() < Date.parse(approval.expiresAt),
      'INVOICE_APPROVAL_EXPIRED', 'Review this individual reminder with a fresh, unexpired approval.');
  }
  private ports(): { goal: GoalRunner<InvoiceJobInput>; provider: GoalProvider } {
    const result = (value: Json, informationClass: StepResult['informationClass'], evidenceIds: string[]): ProviderSettlement => ({
      result: { value, informationClass, evidenceIds, sourceTainted: true }, spentMinor: this.options.simulatedStepCostMinor,
      modelUnits: 0, durationMs: 0, actionExposureMinor: '0' });
    const saved = (state: State, request: ProviderRequest) => {
      const records = state.answers.filter(a => a.kind === 'invoice-job-operation-v1' && a.key === request.key) as InvoiceOperation[];
      check(records.length <= 1, 'JOB_OPERATION_CONFLICT', 'A step has multiple saved invoice operations.');
      const record = records[0]; if (record) check(record.requestDigest === digest({ step: request.step, context: request.context, inputs: request.inputs }),
        'JOB_OPERATION_CONFLICT', 'The saved invoice operation belongs to another request.'); return record;
    };
    const release = (context: Context, value: StepResult) => {
      try {
        const state = this.store.read(); const record = state.answers.find(a => a.kind === 'invoice-job-operation-v1' && a.id === value.evidenceIds[0]) as InvoiceOperation | undefined;
        check(record && digest(record.settlement.result) === digest(value), 'INVOICE_PROOF_CHANGED', 'The saved invoice result changed.');
        const data = value.value as { proofId: string; proofDigest: string; actionId?: string; digest?: string };
        const proof = this.proof(state, data.proofId); check(evidenceDigest(proof) === data.proofDigest, 'INVOICE_PROOF_CHANGED', 'The saved balance proof changed.'); this.receipt(state, context, proof, true);
        if (data.actionId) { const action = this.actions.find(state, data.actionId); this.actions.access(state, context, action);
          check(action.digest === data.digest && action.digest === this.actions.identity(action), 'PREVIEW_CHANGED', 'The saved reminder changed.'); }
        return true;
      } catch { return false; }
    };
    const provider: GoalProvider = { id: 'invoice-local-preparation', kind: 'read-only', transport: 'local', model: false,
      dispatch: async request => { this.activeOperations.add(request.key); try { return await this.store.update(async state => {
        const job = this.own(state, request.context, request.key.split(':revision:')[0]);
        check(!request.signal.aborted && job.status === 'running' && job.execution?.attempts.some(a => a.key === request.key && a.status === 'dispatched'),
          'JOB_CANCELLED', 'The exact invoice step is no longer admitted.');
        const prior = saved(state, request); if (prior) return json(prior.settlement);
        const input = request.step.input as unknown as { mode: 'balance' | 'prepare'; target: InvoiceTarget; balanceStepId?: string };
        let settlement: ProviderSettlement;
        if (input.mode === 'balance') {
          const receipt = await new CalculatorService(view(state), this.calculatorOptions).calculate(request.context, {
            operation: 'aging', sourceIds: job.sourceIds, customerId: input.target.customerId, asOf: this.at(), onDate: this.at().slice(0, 10) });
          const proof = this.balance(state, request.context, job, input.target, receipt, request.key);
          state.answers.push(proof);
          if (proof.outcome === 'paid' && !state.answers.some(a => a.kind === 'invoice-paid-v1' && a.jobId === job.id
            && a.invoiceId === proof.target.invoiceId && a.customerId === proof.target.customerId)) {
            state.answers.push({ kind: 'invoice-paid-v1', id: `paid:${proof.id}`, jobId: job.id, invoiceId: proof.target.invoiceId,
              customerId: proof.target.customerId, proofId: proof.id, receiptId: proof.receiptId,
              paymentFactIds: proof.paymentFactIds, bankFactIds: proof.bankFactIds, at: this.at() });
            job.ledger.push({ at: this.at(), event: 'invoice-paid', reason: proof.id });
          }
          settlement = result(json({ proofId: proof.id, proofDigest: evidenceDigest(proof), receiptId: receipt.id, outstandingMinor: proof.outstandingMinor,
            collectedMinor: proof.collectedMinor, outcome: proof.outcome, reasons: proof.reasons }), 'computation', [request.key]);
        } else {
          const dependency = request.inputs[input.balanceStepId!]?.result.value as { proofId?: string } | undefined;
          const proof = this.proof(state, dependency?.proofId!); this.receipt(state, request.context, proof, true);
          const consent = this.consent(state, request.context, input.target.customerId);
          let reason: string | undefined;
          if (proof.outcome !== 'open') reason = proof.outcome;
          else if (consent?.status !== 'yes') reason = 'customer-opt-in-required';
          if (reason) settlement = result(json({ proofId: proof.id, proofDigest: evidenceDigest(proof), skipped: true, reason,
            question: proof.outcome === 'needs-review' ? 'Review the disputed or incomplete invoice evidence before contacting this customer.'
              : reason === 'customer-opt-in-required' ? 'Has this customer explicitly opted in to reminders for this recipient and channel?' : null }), 'action-preview', [request.key]);
          else {
            check(job.allowedActions?.includes(`${invoiceConnectorId}.send`), 'JOB_ACTION_FORBIDDEN', 'Reminder preparation is outside this mandate.');
            const payload = this.payload(job, proof, consent!, job.execution!.scheduledFor); this.live(state, request.context, payload);
            const action = await new ActionService(view(state), [this.connector]).prepare({ ...request.context, sourceTainted: true }, {
              connector: invoiceConnectorId, operation: 'send', payload, sourceIds: job.sourceIds, idempotencyKey: request.key });
            settlement = result(json({ proofId: proof.id, proofDigest: evidenceDigest(proof), actionId: action.id, digest: action.digest, sent: false, paid: false }), 'action-preview', [request.key]);
          }
        }
        validateSettlement(settlement, request.step);
        state.answers.push({ kind: 'invoice-job-operation-v1', id: request.key, key: request.key,
          requestDigest: digest({ step: request.step, context: request.context, inputs: request.inputs }), settlement } satisfies InvoiceOperation);
        check(!request.signal.aborted, 'JOB_CANCELLED', 'The invoice work was interrupted before saving.'); return json(settlement);
      }); } finally { this.activeOperations.delete(request.key); } },
      reconcile: async request => { const state = this.store.read(); this.own(state, request.context, request.key.split(':revision:')[0]); const record = saved(state, request);
        if (!record) return this.activeOperations.has(request.key) ? { outcome: 'unknown' } : { outcome: 'absent', id: request.key, spentMinor: '0', modelUnits: 0, durationMs: 0, actionExposureMinor: '0' };
        check(release(request.context, record.settlement.result), 'JOB_EVIDENCE_REVOKED', 'Saved invoice proof is unavailable.');
        return { outcome: 'verified', id: record.id, settlement: json(record.settlement) }; },
    };
    const goal: GoalRunner<InvoiceJobInput> = { type: invoiceJobType, version: '1', validate: validateInput,
      admit: (state, context, input, config, previous) => {
        this.access(state, context); check(!previous, 'INVOICE_AMENDMENT_UNSUPPORTED', 'Create a separately reviewed mandate to replace invoice targets.');
        check(config.ownerId === context.memberId, 'JOB_OWNER_REQUIRED', 'Explicitly pin the creating invoice owner.');
        check(config.catchup === 'latest' || config.catchup === 'skip', 'INVOICE_CATCHUP_REQUIRED', 'Choose latest or skip explicitly.');
        check(config.sourceIds?.length && config.sourceIds.length <= 64 && config.testedRoutes?.length === 0
          && config.allowedActions?.length === 1 && config.allowedActions[0] === `${invoiceConnectorId}.send`,
        'INVALID_INVOICE_REQUEST', 'Declare exact local source scope, no model routes and only the simulated reminder action.');
        check(Date.parse(input.reviewAt) > this.options.clock() && Date.parse(input.reviewAt) <= Date.parse(config.stopRule.deadline),
          'INVALID_INVOICE_REQUEST', 'The review date must fall within this mandate.');
        for (const cap of [input.calculation, input.preparation]) check(money(cap.reserveMinor) >= money(this.options.simulatedStepCostMinor),
          'JOB_PLAN_EXCEEDS_LIMITS', 'Each local simulated step cost must fit its declared reservation.');
        return input;
      },
      plan: input => ({ runnerVersion: '1', children: [
        { id: 'bank-match', goal: 'Calculate balances and match books payments to synthetic bank lines', requiredStepIds: input.targets.map((_, i) => `balance-${i}`) },
        { id: 'reminder-drafts', goal: 'Prepare individually approved reminders or explain missing evidence and consent', requiredStepIds: input.targets.map((_, i) => `prepare-${i}`) },
      ], steps: input.targets.flatMap((target, i) => [
        { id: `balance-${i}`, provider: provider.id, input: json({ mode: 'balance', target }), ...input.calculation,
          modelUnits: 0, actionExposureMinor: '0', modelRequired: false, childTaskId: 'bank-match', dependencies: [] },
        { id: `prepare-${i}`, provider: provider.id, input: json({ mode: 'prepare', target, balanceStepId: `balance-${i}` }), ...input.preparation,
          modelUnits: 0, actionExposureMinor: '0', modelRequired: false, childTaskId: 'reminder-drafts',
          dependencies: [{ stepId: `balance-${i}`, informationClass: 'computation' as const, evidenceRequired: true }] },
      ]), obligations: input.targets.map((_, i) => ({ id: `invoice-${i}`, description: input.acceptanceTest, requiredStepIds: [`balance-${i}`, `prepare-${i}`] })) }),
      deliver: (input, results) => json({ mode: 'simulation', acceptanceTest: input.acceptanceTest, reviewAt: input.reviewAt,
        invoices: input.targets.map((target, i) => ({ target, balance: results[`balance-${i}`].value, reminder: results[`prepare-${i}`].value })),
        businessSuccess: false }), release,
    };
    return { goal, provider };
  }
  private balance(state: State, context: Context, job: Job, target: InvoiceTarget, receipt: CalculationReceipt, key: string): InvoiceProof {
    check(receipt.operation === 'aging' && receipt.requestedSourceIds?.every(id => job.sourceIds.includes(id)), 'INVOICE_PROOF_CHANGED', 'Balances require a scoped aging receipt.');
    const billed = receipt.definitions.find(d => d.name === 'billed')!.kind;
    const received = receipt.definitions.find(d => d.name === 'received')!.kind;
    const refunds = receipt.definitions.find(d => d.name === 'refunds')!.kind;
    const invoices = receipt.rows.filter(r => r.kind === billed && r.invoiceId === target.invoiceId && r.customerId === target.customerId);
    check(invoices.length === 1, 'INVOICE_LINK_REQUIRED', 'An exact invoice/customer link must resolve to one counted invoice.');
    const invoice = invoices[0], payments = receipt.rows.filter(r => r.kind === received && r.invoiceId === target.invoiceId && r.customerId === target.customerId);
    const credits = receipt.rows.filter(r => r.kind === refunds && r.invoiceId === target.invoiceId && r.customerId === target.customerId);
    const sum = (rows: typeof receipt.rows) => rows.reduce((n, row) => n + money(row.amountMinor), 0n);
    const outstanding = money(invoice.amountMinor) - sum(payments) - sum(credits);
    // The fixture bank adapter uses exact imported links; it never guesses or records a payment.
    const bankScope = structuredClone(state); bankScope.facts = bankScope.facts.filter(f => job.sourceIds.includes(f.sourceId));
    const selected = selectFacts(view(bankScope), context, { asOf: receipt.asOf }).facts;
    const bankIds: string[] = [], reasons: string[] = []; let collected = 0n;
    for (const payment of payments) {
      const matches = selected.filter(f => f.kind === 'bank_line' && f.validFrom <= String(receipt.assumptions.onDate)
        && f.fields.status === 'matched'
        && f.fields.paymentEntityId === payment.entityId && f.fields.customerId === target.customerId && f.fields.invoiceId === target.invoiceId
        && f.fields.amountMinor === payment.amountMinor && f.fields.currency === receipt.currency);
      if (matches.length === 1 && !bankIds.includes(matches[0].id)) { bankIds.push(matches[0].id); collected += money(payment.amountMinor); }
      else reasons.push('books-payment-needs-exact-bank-match');
    }
    const fact = state.facts.find(f => f.id === invoice.factId)!;
    if (receipt.coverage.completeness === 'partial' || receipt.coverage.completeness === 'empty') reasons.push('incomplete-calculation-evidence');
    if (fact.fields.disputed === true) reasons.push('disputed-invoice');
    const needsReview = reasons.includes('incomplete-calculation-evidence') || reasons.includes('disputed-invoice');
    const outcome = needsReview ? 'needs-review' : outstanding > 0n ? 'open'
      : payments.length > 0 && collected >= money(invoice.amountMinor) && sum(credits) === 0n && !reasons.length ? 'paid' : 'cleared-unconfirmed';
    return { kind: 'invoice-balance-proof-v1', id: `proof:${key}`, jobId: job.id, objectiveRevision: job.revision, target,
      memberId: context.memberId, epoch: context.epoch, receiptId: receipt.id, receiptDigest: evidenceDigest(receipt), scopeDigest: scopeDigest(state, job.sourceIds),
      currency: receipt.currency, billedMinor: invoice.amountMinor, outstandingMinor: String(outstanding > 0n ? outstanding : 0n), collectedMinor: String(collected),
      dueDate: invoice.dueDate!, invoiceFactId: invoice.factId, paymentFactIds: payments.map(p => p.factId), bankFactIds: bankIds, outcome, reasons, at: this.at() };
  }
  async recordConsent(context: Context, input: Omit<InvoiceConsent, 'kind' | 'id' | 'ownerId' | 'epoch'>) {
    input = json(input); closed(input, ['requestId', 'customerId', 'channel', 'destination', 'status', 'sourceId', 'evidence', 'at']);
    check(text(input.requestId) && text(input.customerId) && input.channel === 'simulation'
      && /^synthetic-customer:[A-Za-z0-9_.-]{1,100}$/.test(input.destination)
      && ['yes', 'no', 'not-asked', 'stopped'].includes(input.status) && text(input.sourceId) && text(input.evidence)
      && Number.isFinite(Date.parse(input.at)) && Date.parse(input.at) <= this.options.clock(),
    'INVALID_INVOICE_REQUEST', 'Opt-in requires an explicit synthetic recipient, state, source and observation date.');
    return this.store.update(state => {
      this.access(state, context); current(state, context, 'approve'); check(!context.sourceTainted && context.channel === 'desktop', 'APP_APPROVAL_REQUIRED', 'Record customer consent inside the app.');
      sourceAccess(state, context, [input.sourceId]);
      const prior = state.answers.find(a => a.kind === 'invoice-opt-in-v1' && a.requestId === input.requestId && a.ownerId === context.memberId && a.epoch === context.epoch) as InvoiceConsent | undefined;
      const value: InvoiceConsent = { ...input, kind: 'invoice-opt-in-v1', id: `consent:${digest([context.memberId, context.epoch, input.requestId])}`, ownerId: context.memberId, epoch: context.epoch };
      if (prior) { check(evidenceDigest(prior) === evidenceDigest(value), 'IDEMPOTENCY_CONFLICT', 'That consent identity already records different evidence.'); return json(prior); }
      state.answers.push(value); audit(state, 'invoice.opt-in-recorded', { consentId: value.id, status: value.status }); return json(value);
    });
  }
  async approveReminder(context: Context, actionId: string, expectedDigest: string) {
    await this.expireApproval(context, actionId);
    return this.store.update(async state => {
      this.access(state, context); const action = this.actions.find(state, actionId); this.checkAction(action);
      this.live(state, context, action.payload as unknown as ReminderPayload, true);
      const saved = state.answers.find(a => a.kind === 'invoice-reminder-approval-v1' && a.actionId === actionId) as Approval | undefined;
      if (action.status === 'approved') { check(saved?.digest === expectedDigest, 'PREVIEW_CHANGED', 'Approval belongs to another preview.'); this.validApproval(state, action); return json(action); }
      const approved = await new ActionService(view(state), [this.connector]).approve(context, actionId, expectedDigest);
      const record: Approval = { kind: 'invoice-reminder-approval-v1', actionId, digest: approved.digest, approvedAt: this.at(), expiresAt: new Date(this.options.clock() + this.options.approvalTtlMs).toISOString() };
      state.answers.push(record); return approved;
    });
  }
  private checkAction(action: PreparedAction) { check(action.connector === invoiceConnectorId && action.operation === 'send', 'UNSUPPORTED_ACTION', 'Only this invoice connector belongs to the contract.'); }
  private async expireApproval(context: Context, actionId: string) {
    return this.store.update(state => {
      const action = this.actions.find(state, actionId); this.checkAction(action);
      const { job } = this.historical(state, context, action.payload as unknown as ReminderPayload);
      const approval = state.answers.find(a => a.kind === 'invoice-reminder-approval-v1' && a.actionId === actionId) as Approval | undefined;
      if (action.status !== 'approved' || action.attempts.length || !approval || this.options.clock() < Date.parse(approval.expiresAt)) return false;
      action.status = 'prepared'; delete action.approval;
      state.answers = state.answers.filter(a => a !== approval);
      job.ledger.push({ at: this.at(), event: 'invoice-approval-expired', reason: actionId }); return true;
    });
  }
  async executeReminder(context: Context, actionId: string) {
    this.activeCalls++; try { return await this.executeReminderOnce(context, actionId); } finally { this.activeCalls--; }
  }
  private async executeReminderOnce(context: Context, actionId: string) {
    check(!await this.expireApproval(context, actionId), 'INVOICE_APPROVAL_EXPIRED', 'The expired approval was dropped; review this individual reminder again.');
    const admitted = await this.store.update(state => {
      const action = this.actions.find(state, actionId); this.checkAction(action); this.actions.access(state, context, action);
      this.historical(state, context, action.payload as unknown as ReminderPayload);
      if (['verified', 'unknown', 'executing', 'rejected'].includes(action.status)) return { action: structuredClone(action), reuse: true };
      this.actions.approved(state, context, action); this.validApproval(state, action);
      const { job } = this.live(state, context, action.payload as unknown as ReminderPayload, true);
      check(!this.delivery(state, action.idempotencyKey), 'INVOICE_DELIVERY_PENDING', 'This delivery was already admitted; recover or read it back.');
      const day = this.options.dayKey(this.options.clock()); check(text(day), 'INVOICE_POLICY_REQUIRED', 'The configured day boundary must identify this day.');
      const deliveries = state.answers.filter(a => a.kind === 'invoice-simulated-delivery-v1' && a.day === day && a.status !== 'not-sent') as Delivery[];
      const customerId = (action.payload as unknown as ReminderPayload).target.customerId;
      if (deliveries.length >= this.options.dailyCap || deliveries.filter(d => d.customerId === customerId).length >= this.options.perCustomerDailyCap) {
        job.ledger.push({ at: this.at(), event: 'invoice-daily-cap-stopped', reason: actionId }); return { capBlocked: true };
      }
      const cost = money(this.options.simulatedSendCostMinor);
      if (money(job.spentMinor) + money(job.reservedMinor) + cost > money(job.budgetMinor)) {
        job.status = 'budget-blocked'; job.ledger.push({ at: this.at(), event: 'invoice-budget-stopped', reason: actionId }); return { blocked: true };
      }
      job.reservedMinor = String(money(job.reservedMinor) + cost);
      const delivery: Delivery = { kind: 'invoice-simulated-delivery-v1', id: `simulated:${action.idempotencyKey}`, key: action.idempotencyKey,
        actionId, payloadDigest: digest(action.payload), jobId: job.id, customerId, ownerId: context.memberId, epoch: context.epoch,
        day, costMinor: String(cost), status: 'reserved', at: this.at() };
      state.answers.push(delivery); job.ledger.push({ at: this.at(), event: 'invoice-delivery-reserved', amountMinor: String(cost), reason: delivery.id });
      return { reuse: false };
    });
    check(!admitted.blocked, 'JOB_BUDGET_EXHAUSTED', 'The invoice budget stopped delivery; the reminder remains undone.');
    check(!admitted.capBlocked, 'INVOICE_DAILY_CAP', 'This day or customer already reached the configured reminder cap; the reminder remains undone.');
    if (admitted.reuse) return admitted.action!;
    try { return await this.actions.execute(context, actionId); }
    finally { await this.store.update(state => { const action = this.actions.find(state, actionId);
      const delivery = this.delivery(state, action.idempotencyKey); if (!action.attempts.length && delivery?.status === 'reserved') this.releaseReservation(state, delivery, 'action-not-attempted'); }); }
  }
  /** Call only after exclusive store recovery: unsent local reservations cannot dispatch afterward. */
  async recover(context: Context) {
    check(this.activeCalls === 0 && this.activeOperations.size === 0 && this.actions.active.size === 0,
      'INVOICE_HOST_BUSY', 'Recover only an exclusively reopened, idle invoice host.');
    return this.store.update(state => { this.access(state, context); current(state, context, 'admin'); const recovered: string[] = [];
      // A dedicated invoice host must not recover another installed runner's work.
      for (const action of state.actions as PreparedAction[]) {
        if (action.connector !== invoiceConnectorId || action.status !== 'executing') continue;
        action.status = 'unknown'; const attempt = action.attempts[0];
        if (attempt) { attempt.outcome = 'unknown'; attempt.finishedAt = this.at(); attempt.error = 'PROCESS_INTERRUPTED'; }
        audit(state, 'invoice.action-interrupted', { actionId: action.id, outcome: 'unknown' });
      }
      for (const job of state.jobs as Job[]) {
        if (job.type !== invoiceJobType || job.status !== 'running') continue;
        const owner = state.members.find(member => member.id === job.ownerId);
        this.jobs.interrupt(job, !owner?.active || owner.epoch !== job.ownerEpoch || owner.role !== job.ownerRole ? 'revoked' : 'scheduled', 'process-interrupted');
        audit(state, 'invoice.job-interrupted', { jobId: job.id, status: job.status });
      }
      for (const delivery of state.answers.filter(a => a.kind === 'invoice-simulated-delivery-v1') as Delivery[]) {
        if (delivery.status !== 'reserved') continue; this.releaseReservation(state, delivery, 'exclusive-host-restart-no-local-effect');
        const action = this.actions.find(state, delivery.actionId); if (!action.attempts.length) { action.status = 'cancelled'; delete action.approval; }
        recovered.push(delivery.id);
      } return { recovered }; });
  }
  async dispatch(context: Context, method: string, request: unknown = {}): Promise<unknown> {
    const value = json(request) as Record<string, any>; this.access(this.store.read(), context);
    switch (method) {
      case 'invoiceFollowUp.consent.record': return this.recordConsent(context, value as Omit<InvoiceConsent, 'kind' | 'id' | 'ownerId' | 'epoch'>);
      case 'invoiceFollowUp.create': {
        closed(value, ['goal', 'ownerId', 'budgetMinor', 'reserveMinor', 'stopRule', 'nextRunAt', 'intervalMs', 'catchup', 'graceMs', 'requiresApproval', 'sourceIds', 'input', 'limits', 'allowedActions', 'testedRoutes', 'background']);
        return this.runner.create(context, { ...value, type: invoiceJobType } as JobConfig & { type: string });
      }
      case 'invoiceFollowUp.run': closed(value, ['id']); this.own(this.store.read(), context, value.id); this.activeCalls++; try { return await this.runner.run(context, value.id); } finally { this.activeCalls--; }
      case 'invoiceFollowUp.reconcile': closed(value, ['id']); this.own(this.store.read(), context, value.id); this.activeCalls++; try { return await this.runner.reconcile(context, value.id); } finally { this.activeCalls--; }
      case 'invoiceFollowUp.approve': closed(value, ['id', 'digest']); this.own(this.store.read(), context, value.id); return this.jobs.approve(context, value.id, value.digest);
      case 'invoiceFollowUp.resume': closed(value, ['id']); this.own(this.store.read(), context, value.id); return this.jobs.resume(context, value.id);
      case 'invoiceFollowUp.pause': closed(value, ['id']); this.own(this.store.read(), context, value.id); return this.jobs.pause(context, value.id);
      case 'invoiceFollowUp.read': {
        closed(value, ['id']); const state = this.store.read(), job = this.own(state, context, value.id);
        return { job: this.jobs.view(context, job), progress: this.runner.progress(context, job.id),
          reminders: this.actions.list(context).filter(a => (a.payload as unknown as ReminderPayload).jobId === job.id),
          outcomes: state.answers.filter(a => ['invoice-simulated-delivery-v1', 'invoice-paid-v1'].includes(a.kind) && a.jobId === job.id) };
      }
      case 'invoiceFollowUp.reminder.approve': closed(value, ['id', 'digest']); return this.approveReminder(context, value.id, value.digest);
      case 'invoiceFollowUp.reminder.execute': closed(value, ['id']); return this.executeReminder(context, value.id);
      case 'invoiceFollowUp.reminder.reconcile': closed(value, ['id']); { const a = this.actions.find(this.store.read(), value.id); this.checkAction(a); return this.actions.reconcile(context, value.id); }
      case 'invoiceFollowUp.reminder.cancel': closed(value, ['id']); { const a = this.actions.find(this.store.read(), value.id); this.checkAction(a); this.historical(this.store.read(), context, a.payload as unknown as ReminderPayload); return this.actions.cancel(context, value.id); }
      case 'invoiceFollowUp.cancel': closed(value, ['id']); this.own(this.store.read(), context, value.id); return this.runner.cancel(context, value.id);
      case 'invoiceFollowUp.accept': {
        closed(value, ['id', 'repeat']); const state = this.store.read(); this.own(state, context, value.id);
        check(!state.actions.some(a => a.connector === invoiceConnectorId && a.payload.jobId === value.id
          && ['prepared', 'approved', 'executing', 'unknown'].includes(a.status)), 'INVOICE_REMINDERS_UNRESOLVED', 'Resolve or cancel each individual reminder before accepting the occurrence.');
        return this.jobs.accept(context, value.id, value.repeat === true);
      }
      case 'invoiceFollowUp.reject': closed(value, ['id', 'reason']); this.own(this.store.read(), context, value.id); return this.jobs.reject(context, value.id, value.reason);
      case 'invoiceFollowUp.tick': closed(value, ['awake', 'windowOpen', 'backgroundEnabled']); check(['awake', 'windowOpen', 'backgroundEnabled'].every(k => typeof value[k] === 'boolean'), 'INVALID_INVOICE_REQUEST', 'Supply explicit lifecycle state.'); this.activeCalls++; try { return await this.runner.tick(context, value as { awake: boolean; windowOpen: boolean; backgroundEnabled: boolean }); } finally { this.activeCalls--; }
      case 'invoiceFollowUp.recover': closed(value, []); return this.recover(context);
      default: check(false, 'INVOICE_METHOD_UNSUPPORTED', 'This invoice public method is not installed.');
    }
  }
}
