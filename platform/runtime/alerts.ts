import { authorize, audit, check, hash as rawHash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import { CalculatorService, type CalculationReceipt, type CalculationRequest } from './calculator.ts';
import { currentAccess, validDate, type Period } from './memory.ts';
import { OntologyService } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import type { AlertCreate, AlertDefinition, AlertEpisode, AlertEvaluate, AlertEvaluation, AlertNotice, AlertObservation,
  AlertPersistence, AlertReceiptPin, AlertsOptions, AlertWrite, BusinessAlert, AlertBrief, AlertBriefItem, AlertBriefScope } from './alerts-contracts.ts';
export type * from './alerts-contracts.ts';

const KIND = 'business-alert-v1';
const unique = (values: string[]) => [...new Set(values)].sort();
const plain = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]));
  return value;
}
const hash = (value: unknown) => rawHash(canonical(value));
function closed(value: unknown, keys: string[]) {
  check(plain(value) && Object.keys(value).every(key => keys.includes(key)), 'INVALID_ALERT', 'Use only declared alert data fields.');
}
function text(value: unknown, max = 200): asserts value is string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max, 'INVALID_ALERT', 'Provide bounded nonblank alert text.');
}
function integer(value: unknown): asserts value is string {
  check(typeof value === 'string' && /^-?\d{1,100}$/.test(value), 'INVALID_ALERT', 'Thresholds must be exact whole minor-unit or basis-point strings.');
}
function timestamp(value: unknown): string {
  check(typeof value === 'string' && validDate(value.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value)), 'INVALID_ALERT', 'Use explicit ISO timestamps.');
  return new Date(value).toISOString();
}
function bounded(value: unknown, minimum: number, maximum: number) {
  check(Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum, 'INVALID_ALERT', 'Declare bounded integer persistence and freshness limits.');
}
function persistence(value: AlertPersistence) {
  closed(value, ['observations', 'durationMs']); bounded(value.observations, 1, 10000); bounded(value.durationMs, 0, 366 * 86400000);
}
function detach<T>(value: T): T {
  try { return structuredClone(value); } catch { check(false, 'INVALID_ALERT', 'Alert inputs must be plain data.'); }
}
function view(state: State): StateStore { return { read: () => detach(state), update: async () => { throw new Error('Alert authorization views are read-only.'); } }; }
// Staleness is lifecycle metadata changed by legitimate imports. All retained content stays pinned.
function receiptContent(receipt: CalculationReceipt) { const { stale, staleReason, ...content } = receipt; return content; }
function semanticRequest(request: CalculationRequest) {
  return { ...request, ...(request.sourceIds ? { sourceIds: unique(request.sourceIds) } : {}) };
}
function requestTemplate(request: CalculationRequest) { const { asOf, period, comparePeriod, ...template } = semanticRequest(request); return template; }
const days = (period: Period | null) => period ? (Date.parse(period.to) - Date.parse(period.from)) / 86400000 + 1 : null;
const comparisonOffset = (period: Period | null, comparison: Period | null) => period && comparison ? Date.parse(period.from) - Date.parse(comparison.from) : null;
function pin(receipt: CalculationReceipt, request: CalculationRequest): AlertReceiptPin {
  return { receiptId: receipt.id, digest: hash({ receipt: receiptContent(receipt), request }), request: detach(request),
    asOf: receipt.asOf, period: detach(receipt.period), comparePeriod: detach(receipt.comparePeriod),
    rowIds: unique([...receipt.rowIds, ...receipt.exclusions.map(item => item.rowId)]),
    sourceIds: unique([...receipt.sourceIds, ...(receipt.requestedSourceIds ?? [])]) };
}
function configuration(input: AlertCreate): AlertCreate {
  closed(input, ['conditionId', 'label', 'baselineReceiptId', 'figureKey', 'unit', 'sourceIds', 'periodMode', 'direction', 'activateMinor', 'clearMinor', 'activation', 'clearance', 'severity', 'reopening', 'maxEvidenceAgeMs', 'maxObservationGapMs']);
  text(input.conditionId); text(input.label, 1000); text(input.baselineReceiptId); text(input.figureKey);
  closed(input.unit, input.unit?.kind === 'money' ? ['kind', 'currency'] : ['kind']);
  check(input.unit.kind === 'money' || input.unit.kind === 'basis-points', 'INVALID_ALERT', 'Declare the receipt figure unit.');
  if (input.unit.kind === 'money') check(typeof input.unit.currency === 'string' && /^[A-Z]{3}$/.test(input.unit.currency), 'INVALID_ALERT', 'Money thresholds require an explicit currency.');
  check(Array.isArray(input.sourceIds) && input.sourceIds.length > 0 && input.sourceIds.length <= 64
    && input.sourceIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id)) && unique(input.sourceIds).length === input.sourceIds.length,
  'INVALID_ALERT', 'Choose one to sixty-four explicit distinct sources.');
  check(['fixed', 'moving'].includes(input.periodMode) && ['above', 'below'].includes(input.direction)
    && ['same-episode', 'new-episode', 'never'].includes(input.reopening), 'INVALID_ALERT', 'Declare window, threshold direction and reopening rules.');
  integer(input.activateMinor); integer(input.clearMinor);
  check(input.direction === 'above' ? BigInt(input.clearMinor) < BigInt(input.activateMinor) : BigInt(input.clearMinor) > BigInt(input.activateMinor),
    'INVALID_ALERT', 'Clear and activation thresholds must leave an explicit hysteresis band.');
  persistence(input.activation); persistence(input.clearance);
  closed(input.severity, ['initial', 'criticalMinor', 'downgrade']);
  check(['warning', 'critical'].includes(input.severity.initial) && ['on-clear', 'on-observation'].includes(input.severity.downgrade), 'INVALID_ALERT', 'Declare severity and downgrade behavior.');
  if (input.severity.criticalMinor !== undefined) {
    integer(input.severity.criticalMinor);
    check(input.direction === 'above' ? BigInt(input.severity.criticalMinor) >= BigInt(input.activateMinor) : BigInt(input.severity.criticalMinor) <= BigInt(input.activateMinor), 'INVALID_ALERT', 'Critical severity must be within the breach region.');
  }
  bounded(input.maxEvidenceAgeMs, 1, 366 * 86400000); bounded(input.maxObservationGapMs, 1, 366 * 86400000);
  const result = detach(input); result.sourceIds = unique(result.sourceIds);
  result.activateMinor = String(BigInt(result.activateMinor)); result.clearMinor = String(BigInt(result.clearMinor));
  if (result.severity.criticalMinor !== undefined) result.severity.criticalMinor = String(BigInt(result.severity.criticalMinor));
  return result;
}
function classify(definition: AlertDefinition, value: string): Pick<AlertObservation, 'state' | 'severity'> {
  const n = BigInt(value), above = definition.direction === 'above';
  if (above ? n >= BigInt(definition.activateMinor) : n <= BigInt(definition.activateMinor)) {
    const critical = definition.severity.criticalMinor;
    return { state: 'breach', severity: definition.severity.initial === 'critical' || (critical !== undefined && (above ? n >= BigInt(critical) : n <= BigInt(critical))) ? 'critical' : 'warning' };
  }
  return { state: (above ? n <= BigInt(definition.clearMinor) : n >= BigInt(definition.clearMinor)) ? 'clear' : 'band' };
}
function effective(observations: AlertObservation[]) {
  const samples = new Map<string, AlertObservation>();
  for (const observation of observations) {
    const prior = samples.get(observation.anchorId);
    // Unavailable corrections cannot retract a previously measured breach or resolution.
    // Preserve its last qualified classification and expose the amendment's uncertainty.
    samples.set(observation.anchorId, observation.amends && observation.state === 'unknown' && prior
      ? { ...observation, state: prior.state, severity: prior.severity, valueMinor: prior.valueMinor } : observation);
  }
  return [...samples.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}
function project(alert: BusinessAlert): AlertEpisode[] {
  const episodes: AlertEpisode[] = [], definition = alert.definition;
  let active: AlertEpisode | undefined, activation: AlertObservation[] = [], clearance: AlertObservation[] = [], lastAt: string | undefined;
  const persisted = (samples: AlertObservation[], rule: AlertPersistence) => samples.length >= rule.observations
    && Date.parse(samples.at(-1)!.observedAt) - Date.parse(samples[0].observedAt) >= rule.durationMs;
  for (const sample of effective(alert.observations)) {
    if (lastAt && Date.parse(sample.observedAt) - Date.parse(lastAt) > definition.maxObservationGapMs) { activation = []; clearance = []; }
    lastAt = sample.observedAt;
    if (active) active.observationIds.push(sample.id);
    if (sample.state === 'unknown') { activation = []; clearance = []; if (active) active.uncertain = true; continue; }
    if (active) {
      active.uncertain = sample.issues.length > 0;
      if (!sample.issues.length && definition.severity.downgrade === 'on-observation') active.severity = sample.severity ?? definition.severity.initial;
    }
    if (sample.state === 'breach') {
      clearance = [];
      if (active) {
        if (sample.severity === 'critical' || definition.severity.downgrade === 'on-observation') active.severity = sample.severity!;
        continue;
      }
      activation.push(sample);
      if (!persisted(activation, definition.activation)) continue;
      const prior = episodes.at(-1);
      if (prior && definition.reopening === 'never') { activation = []; continue; }
      if (prior && definition.reopening === 'same-episode') {
        active = prior; active.status = 'open'; delete active.clearedAt; active.reopenedAt = sample.observedAt;
        active.reopenCount++; active.severity = definition.severity.downgrade === 'on-observation' ? sample.severity!
          : activation.some(item => item.severity === 'critical') ? 'critical' : 'warning'; active.uncertain = activation.some(item => item.issues.length > 0);
        active.observationIds.push(...activation.map(item => item.id));
      } else {
        active = { id: `alert_episode_${hash([alert.id, activation[0].anchorId]).slice(0, 32)}`, status: 'open',
          severity: definition.severity.downgrade === 'on-observation' ? sample.severity! : activation.some(item => item.severity === 'critical') ? 'critical' : 'warning', openedAt: sample.observedAt,
          reopenCount: 0, uncertain: activation.some(item => item.issues.length > 0), observationIds: activation.map(item => item.id) };
        episodes.push(active);
      }
      activation = [];
    } else if (sample.state === 'clear') {
      activation = [];
      if (!active) continue;
      clearance.push(sample);
      if (persisted(clearance, definition.clearance)) { active.status = 'cleared'; active.clearedAt = sample.observedAt; active = undefined; clearance = []; }
    } else { activation = []; clearance = []; }
  }
  return episodes;
}

/** Receipt-backed business conditions. The existing job runner calls evaluate; this service has no scheduler or dispatch port. */
export class AlertsService {
  readonly store: StateStore;
  readonly options: AlertsOptions;
  constructor(store: StateStore, options: AlertsOptions = {}) { this.store = store; this.options = options; }
  private clock() { return timestamp(this.options.clock?.() ?? now()); }
  private calculator(store: StateStore) { return new CalculatorService(store, this.options.calculatorOptions?.(store) ?? this.options); }
  private writer(store: StateStore, ctx: Context) {
    authorize(store, ctx, 'prepare');
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'ALERT_APP_REQUIRED', 'Author and evaluate alerts in the untainted desktop engine.');
  }
  private receipt(store: StateStore, ctx: Context, id: string) {
    const calculator = this.calculator(store), receipt = calculator.receipt(ctx, id);
    assertSourceAccess(store.read(), ctx, receipt.sourceIds);
    const answer = store.read().answers.find(item => item.receiptId === id && item.request);
    check(answer, 'ALERT_RECEIPT_REQUEST_REQUIRED', 'Use a calculation receipt with its retained exact request.');
    const request: CalculationRequest = detach(answer.request);
    calculator.consumerGuard?.(ctx, detach(request));
    return { receipt, request, pin: pin(receipt, request) };
  }
  private at(store: StateStore, ctx: Context, id: string): BusinessAlert {
    authorize(store, ctx);
    const alert = store.read().answers.find(item => item.kind === KIND && item.id === id && item.ownerId === ctx.memberId && item.epoch === ctx.epoch) as BusinessAlert | undefined;
    check(alert, 'ALERT_NOT_FOUND', 'This private alert is unavailable under current authority.');
    currentAccess(store, ctx, alert.branch ?? undefined); assertSourceAccess(store.read(), ctx, alert.sourceIds);
    check(hash(alert.definition) === alert.definitionDigest, 'ALERT_DEFINITION_CHANGED', 'The saved alert definition no longer matches its immutable pin.');
    for (const saved of [alert.definition.baseline, ...alert.observations.flatMap(item => item.receipt ? [item.receipt] : [])]) {
      check(hash(this.receipt(store, ctx, saved.receiptId).pin) === hash(saved), 'ALERT_RECEIPT_CHANGED', 'Retained alert evidence changed or is unavailable.');
    }
    return detach(alert);
  }
  private expected(alert: BusinessAlert, input: AlertWrite) {
    check(Number.isSafeInteger(input.expectedRevision) && input.expectedRevision === alert.revision, 'ALERT_REVISION_CONFLICT', 'Reopen the current alert revision before writing.');
  }
  private currentMeaning(store: StateStore, ctx: Context, definition: AlertDefinition) {
    const dictionary = new OntologyService(store).current(ctx);
    check(dictionary?.hash === definition.dictionaryHash && dictionary.version === definition.ontologyVersion, 'ALERT_MEANING_CHANGED', 'Publish a new condition for changed business meanings.');
  }
  private compatible(definition: AlertDefinition, receipt: CalculationReceipt, request: CalculationRequest) {
    check(receipt.operation === definition.operation && receipt.dictionaryHash === definition.dictionaryHash && receipt.ontologyVersion === definition.ontologyVersion
      && receipt.definitionHash === definition.definitionHash && rawHash(receipt.definitions) === receipt.definitionHash
      && receipt.branch === definition.branch && hash(unique(receipt.requestedSourceIds ?? [])) === hash(definition.sourceIds)
      && receipt.sourceIds.every(id => definition.sourceIds.includes(id))
      && hash(requestTemplate(request)) === hash(requestTemplate(definition.baseline.request)), 'ALERT_EVIDENCE_SCOPE_CHANGED', 'Evidence must retain the exact definitions, selectors, units and explicit source scope.');
    const baseline = definition.baseline;
    check(definition.periodMode === 'fixed' ? hash([receipt.period, receipt.comparePeriod]) === hash([baseline.period, baseline.comparePeriod])
      : receipt.period !== null && days(receipt.period) === days(baseline.period) && days(receipt.comparePeriod) === days(baseline.comparePeriod)
        && comparisonOffset(receipt.period, receipt.comparePeriod) === comparisonOffset(baseline.period, baseline.comparePeriod),
    'ALERT_WINDOW_CHANGED', 'Use the published fixed window or the same moving-window duration and comparison alignment.');
    const figure = receipt.figures.find(item => item.key === definition.figureKey);
    if (figure) check(figure.unit === definition.unit.kind && (definition.unit.kind !== 'money' || figure.currency === definition.unit.currency),
      'ALERT_UNIT_CHANGED', 'A figure cannot change the threshold unit or currency.');
    return figure;
  }
  private issues(definition: AlertDefinition, receipt: CalculationReceipt, at: string): string[] {
    const issues: string[] = [];
    if (receipt.stale) issues.push('stale-receipt');
    if (Date.parse(receipt.asOf) > Date.parse(at) || Date.parse(receipt.createdAt) > Date.parse(at)) issues.push('future-evidence');
    if (Date.parse(at) - Date.parse(receipt.asOf) > definition.maxEvidenceAgeMs || Date.parse(at) - Date.parse(receipt.createdAt) > definition.maxEvidenceAgeMs) issues.push('expired-evidence');
    if (receipt.coverage.completeness !== 'reconciled-imports' || receipt.coverage.unresolvedConflicts !== 0) issues.push(`coverage-${receipt.coverage.completeness}`);
    if (!definition.sourceIds.every(id => receipt.sourceIds.includes(id))) issues.push('unobserved-source');
    return unique(issues);
  }
  private commit(state: State, ctx: Context, alert: BusinessAlert, event: string) {
    const current = view(state); this.writer(current, ctx); currentAccess(current, ctx, alert.branch ?? undefined);
    assertSourceAccess(state, ctx, alert.sourceIds);
    // Re-run host readiness and receipt guards at the final mutation boundary.
    for (const saved of [alert.definition.baseline, ...alert.observations.flatMap(item => item.receipt ? [item.receipt] : [])]) {
      check(hash(this.receipt(current, ctx, saved.receiptId).pin) === hash(saved), 'ALERT_RECEIPT_CHANGED', 'Alert evidence changed before commit.');
    }
    alert.updatedAt = this.clock();
    const index = state.answers.findIndex(item => item.kind === KIND && item.id === alert.id);
    if (index < 0) state.answers.push(detach(alert)); else state.answers[index] = detach(alert);
    audit(state, event, { alertId: alert.id, revision: alert.revision, memberId: ctx.memberId });
    return detach(alert);
  }
  async create(ctx: Context, input: AlertCreate): Promise<BusinessAlert> {
    ctx = detach(ctx); this.writer(this.store, ctx); const supplied = configuration(detach(input));
    return this.store.update(state => {
      const current = view(state); this.writer(current, ctx); assertSourceAccess(state, ctx, supplied.sourceIds);
      const evidence = this.receipt(current, ctx, supplied.baselineReceiptId), at = this.clock();
      const definition: AlertDefinition = { ...supplied, operation: evidence.receipt.operation, branch: evidence.receipt.branch,
        dictionaryHash: evidence.receipt.dictionaryHash, definitionHash: evidence.receipt.definitionHash, ontologyVersion: evidence.receipt.ontologyVersion, baseline: evidence.pin };
      this.currentMeaning(current, ctx, definition); const figure = this.compatible(definition, evidence.receipt, evidence.request);
      check(figure && this.issues(definition, evidence.receipt, at).length === 0, 'ALERT_BASELINE_REQUIRED', 'Author alerts from a current reconciled receipt and an existing figure.');
      const conditionKey = hash({ ownerId: ctx.memberId, epoch: ctx.epoch, conditionId: supplied.conditionId, branch: definition.branch, sourceIds: supplied.sourceIds });
      check(!state.answers.some(item => item.kind === KIND && item.conditionKey === conditionKey), 'ALERT_CONDITION_EXISTS', 'This problem already has an alert definition.');
      const alert: BusinessAlert = { kind: KIND, id: newId('alert'), ownerId: ctx.memberId, memberId: ctx.memberId, epoch: ctx.epoch, branch: definition.branch,
        conditionKey, revision: 1, status: 'draft', definition, definitionDigest: hash(definition), createdAt: at, updatedAt: at,
        observations: [], episodes: [], notices: [], receiptIds: [evidence.receipt.id], sourceIds: supplied.sourceIds, rowIds: evidence.pin.rowIds };
      return this.commit(state, ctx, alert, 'alert.created');
    });
  }
  get(ctx: Context, id: string): BusinessAlert { return this.at(view(this.store.read()), detach(ctx), id); }
  list(ctx: Context): BusinessAlert[] {
    const current = view(this.store.read()); authorize(current, ctx);
    return current.read().answers.filter(item => item.kind === KIND && item.ownerId === ctx.memberId && item.epoch === ctx.epoch)
      .flatMap(item => { try { return [this.at(current, ctx, item.id)]; } catch { return []; } });
  }
  brief(ctx: Context, filter: AlertBriefScope = {}): AlertBrief {
    const current = view(this.store.read()), service = new AlertsService(current, this.options);
    authorize(current, ctx); currentAccess(current, ctx, filter.branch);
    if (filter.sourceIds !== undefined) check(Array.isArray(filter.sourceIds) && filter.sourceIds.length <= 64
      && filter.sourceIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id))
      && new Set(filter.sourceIds).size === filter.sourceIds.length, 'INVALID_SOURCE_SCOPE', 'Choose distinct declared sources for the alert brief.');
    const checkedAt = service.clock(), scope = { branch: filter.branch ?? null, sourceIds: filter.sourceIds === undefined ? null : unique(filter.sourceIds) };
    const dictionary = new OntologyService(current).current(ctx);
    const items: AlertBriefItem[] = service.list(ctx)
      .filter(alert => alert.status === 'published' && (scope.branch === null || alert.branch === scope.branch)
        && (scope.sourceIds === null || alert.sourceIds.every(id => scope.sourceIds!.includes(id))))
      .map(alert => {
        const last = effective(alert.observations).at(-1), issues = [...(last?.issues ?? ['not-observed'])];
        if (dictionary?.hash !== alert.definition.dictionaryHash || dictionary.version !== alert.definition.ontologyVersion) issues.push('definition-changed');
        if (last) {
          if (last.state === 'unknown' || !last.receipt) issues.push('missing-evidence');
          if (Date.parse(checkedAt) - Date.parse(last.observedAt) > alert.definition.maxObservationGapMs) issues.push('observation-gap');
          if (last.receipt) {
            const receipt = service.receipt(current, ctx, last.receipt.receiptId).receipt;
            issues.push(...service.issues(alert.definition, receipt, checkedAt));
          }
        }
        if (alert.episodes.some(episode => episode.status === 'open' && episode.uncertain)) issues.push('uncertain-episode');
        return { alertId: alert.id, conditionId: alert.definition.conditionId, label: alert.definition.label,
          revision: alert.revision, definitionDigest: alert.definitionDigest, branch: alert.branch,
          sourceIds: [...alert.sourceIds], episodes: detach(alert.episodes),
          observation: last ? { id: last.id, observedAt: last.observedAt, recordedAt: last.recordedAt, state: last.state, receiptId: last.receipt?.receiptId ?? null } : null,
          evidence: { state: issues.length ? 'uncertain' as const : 'current' as const, issues: unique(issues) }, receiptIds: unique(alert.receiptIds) };
      }).sort((a, b) => a.alertId.localeCompare(b.alertId));
    return { configured: true, evaluated: false, checkedAt, scope, items, receiptIds: unique(items.flatMap(item => item.receiptIds)),
      pin: hash({ scope, items }) };
  }
  async publish(ctx: Context, id: string, input: AlertWrite): Promise<BusinessAlert> {
    ctx = detach(ctx); this.writer(this.store, ctx); const supplied = detach(input); closed(supplied, ['expectedRevision']);
    return this.store.update(state => {
      const current = view(state); this.writer(current, ctx); const alert = this.at(current, ctx, id); this.expected(alert, supplied);
      check(alert.status === 'draft', 'ALERT_ALREADY_PUBLISHED', 'This immutable definition is already published.');
      this.currentMeaning(current, ctx, alert.definition);
      const evidence = this.receipt(current, ctx, alert.definition.baselineReceiptId);
      check(this.issues(alert.definition, evidence.receipt, this.clock()).length === 0, 'ALERT_BASELINE_REQUIRED', 'Publish against current reconciled evidence.');
      alert.status = 'published'; alert.publishedAt = this.clock(); alert.revision++;
      return this.commit(state, ctx, alert, 'alert.published');
    });
  }
  async evaluate(ctx: Context, id: string, input: AlertEvaluate): Promise<AlertEvaluation> {
    ctx = detach(ctx); this.writer(this.store, ctx); const supplied = detach(input);
    closed(supplied, ['expectedRevision', 'observationId', 'observedAt', 'receiptId', 'missingReason', 'correction']);
    text(supplied.observationId); supplied.observedAt = timestamp(supplied.observedAt);
    check((supplied.receiptId !== undefined) !== (supplied.missingReason !== undefined), 'INVALID_ALERT', 'Provide a saved receipt or an explicit unavailable-evidence reason.');
    if (supplied.receiptId !== undefined) text(supplied.receiptId); else text(supplied.missingReason, 1000);
    if (supplied.correction) { closed(supplied.correction, ['observationId', 'reason']); text(supplied.correction.observationId); text(supplied.correction.reason, 1000); }
    return this.store.update(state => {
      const current = view(state); this.writer(current, ctx); const alert = this.at(current, ctx, id);
      check(alert.status === 'published', 'ALERT_NOT_PUBLISHED', 'Publish the definition before evaluating it.');
      this.currentMeaning(current, ctx, alert.definition); const at = this.clock();
      check(supplied.observedAt <= at, 'INVALID_ALERT', 'An observation cannot come from the future.');
      const { expectedRevision, ...payload } = supplied, payloadHash = hash(payload);
      const duplicate = alert.observations.find(item => item.id === supplied.observationId);
      if (duplicate) {
        check(duplicate.payloadHash === payloadHash, 'ALERT_OBSERVATION_CONFLICT', 'An observation identity cannot be reused for different evidence.');
        return { alert, duplicate: true, notices: [] };
      }
      check(alert.observations.length < 10000, 'ALERT_HISTORY_LIMIT', 'This condition reached its retained observation limit.');
      const original = supplied.correction ? alert.observations.find(item => item.id === supplied.correction!.observationId && !item.amends) : undefined;
      if (supplied.correction) check(original && original.observedAt === supplied.observedAt, 'ALERT_CORRECTION_TARGET', 'Corrections amend an existing original observation at its original measurement time.');
      const sample: AlertObservation = { id: supplied.observationId, anchorId: original?.anchorId ?? supplied.observationId,
        observedAt: supplied.observedAt, recordedAt: at, payloadHash, state: 'unknown', issues: [],
        ...(original ? { amends: original.id, amendmentReason: supplied.correction!.reason } : {}) };
      if (supplied.receiptId) {
        const evidence = this.receipt(current, ctx, supplied.receiptId), receipt = evidence.receipt;
        const figure = this.compatible(alert.definition, receipt, evidence.request);
        sample.evidenceHash = hash({ request: semanticRequest({ ...evidence.request, asOf: receipt.asOf }), asOf: receipt.asOf, period: receipt.period, comparePeriod: receipt.comparePeriod,
          figures: receipt.figures, rows: receipt.rows, exclusions: receipt.exclusions, coverage: receipt.coverage, definitions: receipt.definitions });
        if (!original && alert.observations.some(item => !item.amends && item.evidenceHash === sample.evidenceHash)) return { alert, duplicate: true, notices: [] };
        if (original) {
          const latestReceipt = alert.observations.filter(item => item.anchorId === original.anchorId && item.receipt).at(-1)?.receipt;
          check(receipt.asOf > (latestReceipt?.asOf ?? original.observedAt), 'ALERT_CORRECTION_CUT', 'A correction needs a later knowledge cut than the evidence it amends.');
          const originalWindow = original.receipt ?? (alert.definition.periodMode === 'fixed' ? alert.definition.baseline : null);
          check(originalWindow && hash([receipt.period, receipt.comparePeriod]) === hash([originalWindow.period, originalWindow.comparePeriod]), 'ALERT_WINDOW_CHANGED', 'A correction must keep the original measurement window; an unavailable moving-window sample has no receipt-backed window to amend.');
        } else {
          check(receipt.asOf === supplied.observedAt, 'ALERT_OBSERVATION_CUT', 'An ordinary observation time must equal its receipt knowledge cut.');
          const prior = alert.observations.filter(item => !item.amends && item.receipt).at(-1)?.receipt;
          if (alert.definition.periodMode === 'moving' && prior?.period && receipt.period) check(receipt.period.to >= prior.period.to, 'ALERT_WINDOW_CHANGED', 'Moving windows cannot move backwards without an explicit correction.');
        }
        sample.receipt = evidence.pin; sample.issues = this.issues(alert.definition, receipt, at);
        if (!figure) sample.issues.push('missing-figure');
        else { integer(figure.minor); sample.valueMinor = String(BigInt(figure.minor)); }
        if (!sample.issues.length && figure) Object.assign(sample, classify(alert.definition, figure.minor));
      } else sample.issues = [`unavailable: ${supplied.missingReason}`];
      this.expected(alert, supplied);
      if (!original) check(!alert.observations.length || supplied.observedAt > effective(alert.observations).at(-1)!.observedAt,
        'ALERT_LATE_OBSERVATION', 'Late evidence must explicitly amend its original observation.');
      alert.observations.push(sample);
      const projected = project(alert), notices: AlertNotice[] = [];
      for (const episode of projected) {
        const before = alert.episodes.find(item => item.id === episode.id) ?? null;
        let transition: AlertNotice['transition'] | undefined;
        if (original) { if (!before || hash(before) !== hash(episode)) transition = 'amended'; }
        else if (!before || before.status === 'retracted') transition = 'opened';
        else if (episode.reopenCount > before.reopenCount) transition = 'reopened';
        else if (before.status === 'open' && episode.status === 'cleared') transition = 'cleared';
        else if (before.severity !== episode.severity) transition = episode.severity === 'critical' ? 'escalated' : 'deescalated';
        else if (before.uncertain !== episode.uncertain) transition = episode.uncertain ? 'uncertain' : 'evidence-restored';
        if (transition) notices.push({ id: newId('alert_notice'), kind: 'local-alert-notice-v1', transition, alertId: alert.id, episodeId: episode.id,
          at, observationId: sample.id, before: detach(before), after: detach(episode), delivery: 'local-only' });
      }
      for (const prior of alert.episodes) if (!projected.some(item => item.id === prior.id)) {
        const retracted = { ...detach(prior), status: 'retracted' as const };
        projected.push(retracted);
        if (prior.status !== 'retracted') notices.push({ id: newId('alert_notice'), kind: 'local-alert-notice-v1', transition: 'amended', alertId: alert.id,
          episodeId: prior.id, at, observationId: sample.id, before: detach(prior), after: detach(retracted), delivery: 'local-only' });
      }
      alert.episodes = projected; alert.notices.push(...notices); alert.revision++;
      alert.receiptIds = unique([alert.definition.baseline.receiptId, ...alert.observations.flatMap(item => item.receipt ? [item.receipt.receiptId] : [])]);
      alert.rowIds = unique([alert.definition.baseline, ...alert.observations.flatMap(item => item.receipt ? [item.receipt] : [])].flatMap(item => item.rowIds));
      return { alert: this.commit(state, ctx, alert, original ? 'alert.amended' : 'alert.evaluated'), duplicate: false, notices: detach(notices) };
    });
  }
}
