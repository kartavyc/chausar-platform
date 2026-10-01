import { authorize, audit, check, hash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculationRequest, type CalculatorOptions } from './calculator.ts';
import { canSeeFact, currentAccess, selectFacts, validDate, validatePeriod } from './memory.ts';
import { OntologyService } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import type { Investigation, InvestigationBudget, InvestigationCapsule, InvestigationCreate, InvestigationDrilldown,
  InvestigationHypothesis, InvestigationHypothesisInput, InvestigationReceiptPin, InvestigationRevisionInput,
  InvestigationSearchDocument, InvestigationStep, InvestigationWrite } from './investigation-contracts.ts';
export type * from './investigation-contracts.ts';
export type InvestigationOptions = CalculatorOptions & { clock?: () => string };
/** Trusted local host callbacks. Public investigation requests never accept these ports. */
export type InvestigationAdvanceCorrelation = {
  before: (state: State, value: Investigation) => void;
  after: (state: State, before: Investigation, after: Investigation) => void;
};

const plain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;
function closed(v: unknown, keys: string[]) { check(plain(v) && Object.keys(v).every(k => keys.includes(k)), 'INVALID_INVESTIGATION', 'Investigation requests must contain only declared data fields.'); }
function text(v: unknown, max = 5000): asserts v is string { check(typeof v === 'string' && v.trim().length > 0 && v.length <= max, 'INVALID_INVESTIGATION', 'Provide bounded, nonblank investigation text.'); }
function strings(v: unknown): asserts v is string[] { check(Array.isArray(v) && v.length <= 50000 && v.every(s => typeof s === 'string' && s.length > 0 && s.length <= 200), 'INVALID_INVESTIGATION', 'Use bounded explicit reference lists.'); }
const unique = (v: string[]) => [...new Set(v)].sort();
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));
function detached<T>(v: T): T { try { return structuredClone(v); } catch { check(false, 'INVALID_INVESTIGATION', 'Investigation requests must be plain data.'); } }
function budget(v: InvestigationBudget): InvestigationBudget {
  closed(v, ['maxSteps', 'maxReceiptRows', 'maxContextBytes']);
  check(Number.isSafeInteger(v.maxSteps) && v.maxSteps >= 1 && v.maxSteps <= 64
    && Number.isSafeInteger(v.maxReceiptRows) && v.maxReceiptRows >= 0 && v.maxReceiptRows <= 50000
    && Number.isSafeInteger(v.maxContextBytes) && v.maxContextBytes >= 512 && v.maxContextBytes <= 1048576,
  'INVESTIGATION_BUDGET_INVALID', 'Declare bounded step, receipt-lineage and context-byte budgets.');
  return detached(v);
}
function hypotheses(values: InvestigationHypothesisInput[], actor: string): InvestigationHypothesis[] {
  check(Array.isArray(values) && values.length <= 64, 'INVALID_INVESTIGATION', 'Provide a bounded explicit hypothesis list.');
  const ids = new Set<string>();
  return values.map(v => {
    closed(v, ['id', 'text', 'uncertainty', 'forReceiptIds', 'againstReceiptIds']); text(v.id, 100); text(v.text);
    check(!ids.has(v.id) && ['unverified', 'unresolved', 'supported', 'contradicted'].includes(v.uncertainty), 'INVALID_INVESTIGATION', 'Hypotheses need distinct IDs and an explicit owner assessment.'); ids.add(v.id);
    strings(v.forReceiptIds); strings(v.againstReceiptIds);
    return { ...detached(v), forReceiptIds: unique(v.forReceiptIds), againstReceiptIds: unique(v.againstReceiptIds), kind: 'owner-authored-hypothesis', authoredBy: actor, causalStatus: 'not-established-cause' };
  });
}
const plan = (steps: InvestigationStep[]) => steps.map(({ id, label, request, definitionHash }) => ({ id, label, request, definitionHash }));
const hypothesisRefs = (values: InvestigationHypothesis[]) => values.flatMap(v => [...v.forReceiptIds, ...v.againstReceiptIds]);
function view(state: State): StateStore { return { read: () => structuredClone(state), update: async change => await change(state) }; }
function pin(receipt: CalculationReceipt): InvestigationReceiptPin {
  return { receiptId: receipt.id, operation: receipt.operation, dictionaryHash: receipt.dictionaryHash, definitionHash: receipt.definitionHash,
    receiptDigest: hash(receipt), asOf: receipt.asOf, period: detached(receipt.period), comparePeriod: detached(receipt.comparePeriod),
    sourceIds: unique(receipt.sourceIds), rowIds: unique([...receipt.rowIds, ...receipt.exclusions.map(e => e.rowId)]) };
}

export class InvestigationService {
  readonly store: StateStore;
  readonly options: InvestigationOptions;
  constructor(store: StateStore, options: InvestigationOptions = {}) { this.store = store; this.options = options; }
  private clock() { const at = this.options.clock?.() ?? now(); check(typeof at === 'string' && Number.isFinite(Date.parse(at)), 'INVALID_INVESTIGATION', 'The trusted clock must return an ISO timestamp.'); return new Date(at).toISOString(); }
  private writer(store: StateStore, ctx: Context) {
    authorize(store, ctx, 'prepare'); check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'INVESTIGATION_APP_REQUIRED', 'Author and advance private investigations in the untainted app.');
  }
  private calculator(store: StateStore) { return new CalculatorService(store, this.options); }
  private dictionary(store: StateStore, ctx: Context) { const d = new OntologyService(store).current(ctx); check(d, 'DICTIONARY_REQUIRED', 'Publish definitions before creating an investigation.'); return d; }
  private selection(store: StateStore, ctx: Context, step: InvestigationStep) {
    const dictionary = this.dictionary(store, ctx), operation = dictionary.operations.find(o => o.id === step.request.operation);
    check(operation, 'UNKNOWN_CALCULATION', 'The persisted step needs a published operation.');
    const kinds = dictionary.definitions.filter(d => operation.definitions.includes(d.name)).map(d => d.kind);
    const current = selectFacts(store, ctx, { ...step.request, kinds });
    const prior = step.request.comparePeriod ? selectFacts(store, ctx, { ...step.request, kinds, period: step.request.comparePeriod }) : null;
    return unique([current, ...(prior ? [prior] : [])].flatMap(s => [...s.facts.map(f => f.id), ...s.excluded.map(e => e.rowId)]));
  }
  private scope(store: StateStore, ctx: Context, steps: InvestigationStep[], sources: string[]) {
    const state = store.read(), ids = unique(steps.flatMap(step => this.selection(store, ctx, step)));
    const facts = ids.map(id => { const fact = state.facts.find(f => f.id === id); check(fact && canSeeFact(store, ctx, fact), 'INVESTIGATION_SCOPE_CHANGED', 'The permitted investigation scope is unavailable.'); return fact; });
    const sourceIds = unique([...sources, ...facts.map(f => f.sourceId)]); assertSourceAccess(state, ctx, sourceIds);
    const imports = state.imports.filter(i => sourceIds.includes(i.sourceId) || i.rowIds?.some((id: string) => ids.includes(id))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    return { sourceIds, rowIds: ids, importIds: unique(imports.map(i => i.id)), digest: hash({ facts, imports,
      sourceRules: state.sourceRules.filter(r => !r.sourceId || sourceIds.includes(r.sourceId)), merges: state.merges,
      tombstones: state.tombstones.filter(t => ids.includes(t.factId ?? t.id) || sourceIds.includes(t.sourceId)) }) };
  }
  private receiptAt(store: StateStore, ctx: Context, value: Investigation, id: string): CalculationReceipt {
    const receipt = this.calculator(store).receipt(ctx, id); assertSourceAccess(store.read(), ctx, receipt.sourceIds);
    check(!receipt.stale, 'INVESTIGATION_RECEIPT_STALE', 'A required calculation receipt is stale; create an explicitly reinterpreted investigation.');
    check(receipt.dictionaryHash === value.dictionaryHash && receipt.ontologyVersion === value.ontologyVersion
      && receipt.definitionHash === hash(receipt.definitions) && receipt.asOf === value.asOf
      && receipt.branch === (value.branch ?? null), 'INVESTIGATION_RECEIPT_CHANGED', 'Evidence must preserve its private definition, branch and knowledge-cut bindings.');
    return receipt;
  }
  private at(store: StateStore, ctx: Context, id: string): Investigation {
    authorize(store, ctx);
    const value = store.read().answers.find(a => a.kind === 'private-investigation-v1' && a.id === id && a.ownerId === ctx.memberId && a.epoch === ctx.epoch) as Investigation | undefined;
    check(value, 'INVESTIGATION_NOT_FOUND', 'This private investigation is unavailable under your current access.');
    currentAccess(store, ctx, value.branch); assertSourceAccess(store.read(), ctx, value.sourceIds);
    const dictionary = this.dictionary(store, ctx);
    check(dictionary.hash === value.dictionaryHash && dictionary.version === value.ontologyVersion, 'INVESTIGATION_DEFINITION_CHANGED', 'The investigation pins earlier meanings; create a new investigation for new definitions.');
    check(hash(plan(value.steps)) === value.planHash, 'INVESTIGATION_PLAN_CHANGED', 'The saved investigation plan no longer matches its pin.');
    value.steps.forEach(step => this.options.consumerGuard?.(ctx, detached(step.request)));
    const scope = this.scope(store, ctx, value.steps, value.sourceIds);
    check(scope.digest === value.scopeDigest, 'INVESTIGATION_SCOPE_CHANGED', 'The saved source/identity/import scope changed; author a new investigation.');
    for (const p of value.receiptPins) {
      const receipt = this.receiptAt(store, ctx, value, p.receiptId);
      check(hash(pin(receipt)) === hash(p), 'INVESTIGATION_RECEIPT_CHANGED', 'The saved evidence pin no longer matches its current receipt.');
    }
    const completed = value.steps.filter(s => s.state === 'completed');
    check(completed.every(s => s.receipt && value.receiptPins.some(p => hash(p) === hash(s.receipt))
      && s.receipt.operation === s.request.operation && s.receipt.definitionHash === s.definitionHash
      && hash(s.receipt.period) === hash(s.request.period ?? null) && hash(s.receipt.comparePeriod) === hash(s.request.comparePeriod ?? null)),
    'INVESTIGATION_RECEIPT_CHANGED', 'Every completed step must retain its exact plan and receipt bindings.');
    return detached(value);
  }
  private roots(value: Investigation) {
    value.receiptIds = unique(value.receiptPins.map(p => p.receiptId));
    value.sourceIds = unique([...value.sourceIds, ...value.receiptPins.flatMap(p => p.sourceIds)]);
    value.rowIds = unique([...value.rowIds, ...value.receiptPins.flatMap(p => p.rowIds)]);
  }
  private references(store: StateStore, ctx: Context, value: Investigation) {
    const ids = unique([...hypothesisRefs(value.hypotheses), ...value.revisions.flatMap(r => hypothesisRefs(r.hypotheses))]);
    for (const id of ids) if (!value.receiptPins.some(p => p.receiptId === id)) value.receiptPins.push(pin(this.receiptAt(store, ctx, value, id)));
    this.roots(value);
  }
  private capsuleAt(store: StateStore, ctx: Context, value: Investigation): InvestigationCapsule {
    const content = { kind: 'private-investigation-capsule-v1' as const, investigationId: value.id, revision: value.revision,
      ownerId: value.ownerId, epoch: value.epoch, branch: value.branch ?? null, objective: value.objective, asOf: value.asOf,
      dictionaryHash: value.dictionaryHash, planHash: value.planHash, scopeDigest: value.scopeDigest, status: value.status,
      pauseReason: value.pauseReason ?? null, budget: detached(value.budget),
      completedStepIds: value.steps.filter(s => s.state === 'completed').map(s => s.id), pendingStepIds: value.steps.filter(s => s.state === 'pending').map(s => s.id),
      plan: plan(value.steps).map((p, i) => ({ ...p, receiptId: value.steps[i].receipt?.receiptId ?? null })),
      measurements: value.receiptPins.map(p => {
        const r = this.receiptAt(store, ctx, value, p.receiptId);
        return { receiptId: r.id, operation: r.operation, dictionaryHash: r.dictionaryHash, definitionHash: r.definitionHash,
          asOf: r.asOf, period: r.period, comparePeriod: r.comparePeriod, figures: detached(r.figures), coverage: {
            completeness: r.coverage.completeness, selectedRows: r.coverage.selectedRows, countedRows: r.coverage.countedRows,
            excludedRows: r.coverage.excludedRows, gaps: detached(r.coverage.gaps) } };
      }), hypotheses: detached(value.hypotheses), sourceIds: [...value.sourceIds], rowIds: [...value.rowIds], receiptIds: [...value.receiptIds],
      completeness: 'complete-persisted-plan' as const, interpretation: 'measured-results-and-owner-hypotheses' as const };
    return { ...content, digest: hash(content) };
  }
  private pauseForBudget(store: StateStore, ctx: Context, value: Investigation, next?: InvestigationStep) {
    const rows = value.receiptPins.reduce((total, p) => total + p.rowIds.length, 0) + (next ? this.selection(store, ctx, next).length : 0);
    const reason = value.steps.length > value.budget.maxSteps ? 'step-budget' : rows > value.budget.maxReceiptRows ? 'receipt-row-budget'
      : bytes(this.capsuleAt(store, ctx, value)) > value.budget.maxContextBytes ? 'context-byte-budget' : null;
    if (reason) { value.status = 'paused'; value.pauseReason = reason; }
    return reason;
  }
  private commit(state: State, value: Investigation) { value.updatedAt = this.clock(); state.answers[state.answers.findIndex(a => a.id === value.id && a.kind === value.kind)] = detached(value); audit(state, 'investigation.updated', { investigationId: value.id, revision: value.revision, status: value.status }); return detached(value); }
  private expected(value: Investigation, input: InvestigationWrite) { check(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision === value.revision, 'INVESTIGATION_REVISION_CONFLICT', 'The saved investigation revision changed. Reopen it before writing.'); }

  async create(ctx: Context, input: InvestigationCreate): Promise<Investigation> {
    ctx = detached(ctx);
    this.writer(this.store, ctx); const supplied = detached(input); closed(supplied, ['objective', 'branch', 'asOf', 'sourceIds', 'steps', 'hypotheses', 'budget']);
    text(supplied.objective); if (supplied.branch !== undefined) text(supplied.branch, 200); strings(supplied.sourceIds);
    check(typeof supplied.asOf === 'string' && validDate(supplied.asOf.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(supplied.asOf) && Number.isFinite(Date.parse(supplied.asOf)), 'INVALID_INVESTIGATION', 'Declare an explicit ISO knowledge cut.');
    const asOf = new Date(supplied.asOf).toISOString(), limits = budget(supplied.budget), claims = hypotheses(supplied.hypotheses, ctx.memberId);
    check(Array.isArray(supplied.steps) && supplied.steps.length > 0 && supplied.steps.length <= 64, 'INVALID_INVESTIGATION', 'Provide one to sixty-four ordered plan steps.');
    return this.store.update(state => {
      const current = view(state); this.writer(current, ctx); currentAccess(current, ctx, supplied.branch);
      const dictionary = this.dictionary(current, ctx), ids = new Set<string>();
      const steps: InvestigationStep[] = supplied.steps.map(s => {
        closed(s, ['id', 'label', 'request']); text(s.id, 100); text(s.label, 500); check(!ids.has(s.id), 'INVALID_INVESTIGATION', 'Plan step identities must be unique.'); ids.add(s.id);
        closed(s.request, ['operation', 'period', 'customerId', 'orderId', 'comparePeriod', 'onDate', 'assumptions']);
        validatePeriod(s.request.period); validatePeriod(s.request.comparePeriod); text(s.request.operation, 100);
        const operation = dictionary.operations.find(o => o.id === s.request.operation); check(operation, 'UNKNOWN_CALCULATION', 'Plan only published calculations.');
        check(!s.request.comparePeriod || operation.type === 'change', 'INVALID_CALCULATION', 'Only the published comparison operation accepts a comparison period.');
        check(!s.request.assumptions || operation.type === 'scenario', 'INVALID_CALCULATION', 'Only the published scenario operation accepts assumptions.');
        const request: CalculationRequest = { ...detached(s.request), asOf, ...(supplied.branch ? { branch: supplied.branch } : {}) };
        this.options.consumerGuard?.(ctx, detached(request));
        return { id: s.id, label: s.label, request, definitionHash: hash(dictionary.definitions.filter(d => operation.definitions.includes(d.name))), state: 'pending' };
      });
      const scope = this.scope(current, ctx, steps, unique(supplied.sourceIds)), at = this.clock();
      const value: Investigation = { kind: 'private-investigation-v1', id: newId('investigation'), ownerId: ctx.memberId, memberId: ctx.memberId,
        epoch: ctx.epoch, ...(supplied.branch ? { branch: supplied.branch } : {}), revision: 1, status: 'open', objective: supplied.objective,
        asOf, dictionaryHash: dictionary.hash, ontologyVersion: dictionary.version, planHash: hash(plan(steps)), scopeDigest: scope.digest,
        scopeImportIds: scope.importIds, steps, hypotheses: claims, budget: limits, receiptPins: [], receiptIds: [],
        sourceIds: scope.sourceIds, rowIds: scope.rowIds, createdAt: at, updatedAt: at, revisions: [] };
      this.references(current, ctx, value); this.pauseForBudget(current, ctx, value);
      // Evidence references outside the calculated plan also enter the pinned scope and deletion roots.
      value.scopeDigest = this.scope(current, ctx, steps, value.sourceIds).digest;
      state.answers.push(detached(value)); audit(state, 'investigation.created', { investigationId: value.id, revision: 1 }); return detached(value);
    });
  }
  get(ctx: Context, id: string): Investigation { return this.at(view(this.store.read()), ctx, id); }
  list(ctx: Context): Investigation[] {
    authorize(this.store, ctx); return this.store.read().answers.filter(a => a.kind === 'private-investigation-v1' && a.ownerId === ctx.memberId && a.epoch === ctx.epoch)
      .flatMap(a => { try { return [this.get(ctx, a.id)]; } catch { return []; } });
  }
  async advance(ctx: Context, id: string, input: InvestigationWrite): Promise<Investigation> {
    return this.advanceCorrelated(ctx, id, input);
  }
  async advanceCorrelated(ctx: Context, id: string, input: InvestigationWrite, correlation?: InvestigationAdvanceCorrelation): Promise<Investigation> {
    ctx = detached(ctx);
    this.writer(this.store, ctx); const supplied = detached(input); closed(supplied, ['expectedRevision']);
    const prepare = (state: State) => {
      const current = view(state); this.writer(current, ctx); const value = this.at(current, ctx, id); this.expected(value, supplied);
      correlation?.before(state, detached(value)); const before = detached(value);
      check(value.status === 'open', 'INVESTIGATION_NOT_OPEN', 'Resume a paused investigation before advancing its saved plan.');
      const step = value.steps.find(s => s.state === 'pending'); check(step, 'INVESTIGATION_COMPLETE', 'Every persisted step is already measured.');
      value.revision++;
      return { current, value, before, step, paused: this.pauseForBudget(current, ctx, value, step) };
    };
    // Verification may await an exact database calculation. Keep that wait off the
    // serialized writer queue so lease heartbeats and owner changes can proceed.
    // The detached calculation cannot publish a receipt or an investigation step.
    const snapshot = detached(this.store.read()), prepared = prepare(snapshot);
    if (prepared.paused) return this.store.update(state => {
      const { value, before, paused } = prepare(state);
      check(paused, 'INVESTIGATION_BUDGET_CHANGED', 'Reopen the investigation after its budget changed.');
      const saved = this.commit(state, value); correlation?.after(state, before, detached(saved)); return saved;
    });
    const receipt = await this.calculator(prepared.current).calculate(ctx, detached(prepared.step.request));
    const answer = snapshot.answers.find(a => a.receiptId === receipt.id);
    check(answer, 'INVESTIGATION_RECEIPT_CHANGED', 'The prepared calculation needs its exact answer record.');
    return this.store.update(state => {
      // Re-read current access, definitions, full source scope, receipt pins and
      // revision instead of overwriting the state (including renewed leases).
      const { current, value, before, step, paused } = prepare(state);
      check(!paused && step.id === prepared.step.id, 'INVESTIGATION_BUDGET_CHANGED', 'The saved next step or its budget changed while measuring.');
      check(receipt.definitionHash === step.definitionHash, 'INVESTIGATION_RECEIPT_CHANGED', 'The measured step differs from its authored definition.');
      check(!state.receipts.some(r => r.id === receipt.id), 'INVESTIGATION_RECEIPT_CHANGED', 'The prepared receipt identity is already present.');
      state.receipts.push(detached(receipt)); state.answers.push(detached(answer));
      this.receiptAt(current, ctx, value, receipt.id);
      audit(state, 'calculation.completed', { receiptId: receipt.id, operation: receipt.operation, rowCount: receipt.rows.length });
      step.state = 'completed'; step.receipt = pin(receipt); value.receiptPins.push(step.receipt); this.roots(value);
      if (value.steps.every(s => s.state === 'completed')) value.status = 'complete';
      this.pauseForBudget(current, ctx, value); const saved = this.commit(state, value);
      correlation?.after(state, before, detached(saved)); return saved;
    });
  }
  async pause(ctx: Context, id: string, input: InvestigationWrite & { reason: string }): Promise<Investigation> {
    return this.change(ctx, id, input, ['expectedRevision', 'reason'], (value, current, request) => { text(request.reason, 500); check(value.status === 'open', 'INVESTIGATION_NOT_OPEN', 'Only open investigations can pause.'); value.status = 'paused'; value.pauseReason = request.reason; });
  }
  async resume(ctx: Context, id: string, input: InvestigationWrite): Promise<Investigation> {
    return this.change(ctx, id, input, ['expectedRevision'], (value, current) => {
      check(value.status === 'paused', 'INVESTIGATION_NOT_PAUSED', 'Only paused investigations can resume.'); value.status = value.steps.every(s => s.state === 'completed') ? 'complete' : 'open'; delete value.pauseReason;
      this.pauseForBudget(current, ctx, value, value.steps.find(s => s.state === 'pending'));
    });
  }
  async cancel(ctx: Context, id: string, input: InvestigationWrite): Promise<Investigation> {
    return this.change(ctx, id, input, ['expectedRevision'], value => { check(value.status !== 'cancelled', 'INVESTIGATION_CANCELLED', 'This investigation is already cancelled.'); value.status = 'cancelled'; delete value.pauseReason; });
  }
  async revise(ctx: Context, id: string, input: InvestigationRevisionInput): Promise<Investigation> {
    return this.change(ctx, id, input, ['expectedRevision', 'reason', 'objective', 'hypotheses', 'budget'], (value, current, request) => {
      text(request.reason, 500); check(value.status !== 'cancelled' && value.revisions.length < 256, 'INVESTIGATION_CANCELLED', 'A cancelled or exhausted investigation cannot be amended.');
      value.revisions.push({ fromRevision: value.revision - 1, at: this.clock(), reason: request.reason, objective: value.objective, hypotheses: detached(value.hypotheses), budget: detached(value.budget) });
      if (request.objective !== undefined) { text(request.objective); value.objective = request.objective; }
      if (request.hypotheses !== undefined) value.hypotheses = hypotheses(request.hypotheses, ctx.memberId);
      if (request.budget !== undefined) value.budget = budget(request.budget);
      this.references(current, ctx, value); value.scopeDigest = this.scope(current, ctx, value.steps, value.sourceIds).digest;
      this.pauseForBudget(current, ctx, value);
    });
  }
  private async change<T extends InvestigationWrite>(ctx: Context, id: string, input: T, keys: string[], apply: (value: Investigation, current: StateStore, request: T) => void) {
    ctx = detached(ctx);
    this.writer(this.store, ctx); const supplied = detached(input); closed(supplied, keys);
    return this.store.update(state => { const current = view(state); this.writer(current, ctx); const value = this.at(current, ctx, id); this.expected(value, supplied);
      value.revision++; apply(value, current, supplied); return this.commit(state, value); });
  }
  capsule(ctx: Context, id: string): InvestigationCapsule {
    const current = view(this.store.read()), value = this.at(current, ctx, id), capsule = this.capsuleAt(current, ctx, value);
    check(bytes(capsule) <= value.budget.maxContextBytes, 'INVESTIGATION_CONTEXT_LIMIT', 'The exact context capsule exceeds its declared budget; increase it explicitly rather than sampling evidence.'); return capsule;
  }
  drilldown(ctx: Context, id: string, input: { receiptId: string; offset: number; limit: number }): InvestigationDrilldown {
    closed(input, ['receiptId', 'offset', 'limit']); check(Number.isSafeInteger(input.offset) && input.offset >= 0 && Number.isSafeInteger(input.limit) && input.limit >= 1 && input.limit <= 1000, 'INVALID_INVESTIGATION', 'Use a bounded receipt-row page.');
    const current = view(this.store.read()), value = this.at(current, ctx, id);
    check(value.receiptIds.includes(input.receiptId), 'INVESTIGATION_RECEIPT_CHANGED', 'Drill down only into an investigation evidence receipt.');
    const receipt = this.receiptAt(current, ctx, value, input.receiptId);
    return { receiptId: receipt.id, offset: input.offset, limit: input.limit, totalRows: receipt.rows.length,
      rows: detached(receipt.rows.slice(input.offset, input.offset + input.limit)), completeness: 'bounded-receipt-page', excludedRows: receipt.exclusions.length };
  }
  searchDocuments(ctx: Context): InvestigationSearchDocument[] {
    return this.list(ctx).map(value => {
      const content = { kind: 'investigation' as const, id: value.id, revision: value.revision, ownerId: value.ownerId, epoch: value.epoch,
        branch: value.branch ?? null, title: value.objective, text: [value.objective, ...value.steps.map(s => s.label),
          ...value.hypotheses.map(h => `Owner hypothesis (not an established cause): ${h.text}`)].join('\n'),
        receiptIds: [...value.receiptIds], sourceIds: [...value.sourceIds], rowIds: [...value.rowIds] };
      return { ...content, contentHash: hash(content) };
    });
  }
}
