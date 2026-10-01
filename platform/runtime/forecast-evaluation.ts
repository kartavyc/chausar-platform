import { check, hash, type Context, type Fact, type State, type StateStore } from './contracts.ts';
import { selectFacts, validDate, type Period } from './memory.ts';
import type { Definition } from './ontology.ts';
import type { ForecastEvaluation, ForecastExact, ForecastEvidencePin, ForecastHorizonSummary, ForecastPrediction, ForecastRequest, ForecastResolvedEvidence } from './forecast-contracts.ts';

const identifier = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function closed(v: unknown, keys: string[], code = 'INVALID_FORECAST'): asserts v is Record<string, unknown> {
  check(record(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k)), code, 'Use exactly the declared forecast fields.');
}
function integer(v: unknown, min: number, max: number): v is number { return Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max; }
function distinct<T>(values: T[]) { return new Set(values).size === values.length; }
function ids(v: unknown, max: number): v is string[] { return Array.isArray(v) && v.length > 0 && v.length <= max && Array.from(v).every(identifier) && distinct(v); }
function timestamp(value: unknown, code = 'INVALID_FORECAST'): number {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value), code, 'Recorded knowledge requires an explicit UTC timestamp.');
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString().slice(0, 19) === value.slice(0, 19), code, 'The recorded-knowledge timestamp is invalid.');
  return time;
}
function monthIndex(date: string) { return Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1; }
function monthStart(index: number) {
  const year = Math.floor(index / 12), month = index % 12 + 1;
  check(year >= 1 && year <= 9999, 'INVALID_FORECAST', 'The requested calendar month is outside the supported date range.');
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}
function monthPeriod(index: number): Period {
  const from = monthStart(index), next = Date.parse(`${monthStart(index + 1)}T00:00:00.000Z`);
  return { from, to: new Date(next - 86400000).toISOString().slice(0, 10) };
}
function monthClose(index: number) { return Date.parse(`${monthStart(index + 1)}T00:00:00.000Z`); }
function receiptMonth(period: Period | null): number {
  check(record(period) && validDate(period.from) && validDate(period.to), 'FORECAST_MONTH_REQUIRED', 'Each receipt must cover one complete calendar month.');
  const index = monthIndex(period.from);
  const expected = monthPeriod(index);
  check(Object.keys(period).length === 2 && period.from === expected.from && period.to === expected.to, 'FORECAST_MONTH_REQUIRED', 'Partial, cumulative and duplicate monthly periods are not accepted.');
  return index;
}

/** Validate and detach the transport request before a queued durable transaction. */
export function validateForecastRequest(value: unknown): ForecastRequest {
  closed(value, ['version', 'mode', 'operation', 'dictionaryHash', 'sourceIds', 'branch', 'horizonsMonths', 'cadenceMonths', 'minimumTrainingMonths', 'method', 'benchmark', 'availabilityLagMs', 'origins']);
  check(value.version === 1 && ['operational-as-known', 'restated-diagnostic'].includes(String(value.mode)) && value.method === 'linear-trend-v1' && value.benchmark === 'last-observed-v1', 'INVALID_FORECAST', 'Use the supported version, mode, method and benchmark.');
  check(identifier(value.operation) && typeof value.dictionaryHash === 'string' && /^[a-f0-9]{64}$/.test(value.dictionaryHash), 'INVALID_FORECAST', 'Bind a published operation and dictionary digest.');
  check(ids(value.sourceIds, 64) && (value.branch === null || identifier(value.branch)), 'INVALID_FORECAST', 'Declare a distinct source scope and a branch or explicit all-branch scope.');
  check(Array.isArray(value.horizonsMonths) && value.horizonsMonths.length > 0 && value.horizonsMonths.length <= 24 && Array.from(value.horizonsMonths).every(h => integer(h, 1, 120)) && distinct(value.horizonsMonths), 'INVALID_FORECAST', 'Choose distinct monthly horizons within the supported bound.');
  check(integer(value.cadenceMonths, 1, 120) && integer(value.minimumTrainingMonths, 2, 600) && integer(value.availabilityLagMs, 0, 31536000000), 'INVALID_FORECAST', 'Declare a bounded cadence, training window and availability lag.');
  check(Array.isArray(value.origins) && value.origins.length > 0 && value.origins.length <= 240, 'INVALID_FORECAST', 'Declare bounded historical origins.');
  const originIds = new Set<string>(); let previousMonth: number | undefined, previousKnowledge: number | undefined;
  for (const origin of value.origins) {
    closed(origin, ['id', 'eventCutoff', 'knowledgeCut', 'trainingReceiptIds', 'targets']);
    check(identifier(origin.id) && !originIds.has(origin.id), 'INVALID_FORECAST', 'Origin identifiers must be distinct.'); originIds.add(origin.id);
    check(validDate(origin.eventCutoff) && monthPeriod(monthIndex(origin.eventCutoff)).to === origin.eventCutoff, 'INVALID_FORECAST', 'An event cutoff must be a calendar-month end.');
    const month = monthIndex(origin.eventCutoff), known = timestamp(origin.knowledgeCut);
    check(known >= monthClose(month), 'INVALID_FORECAST', 'An origin knowledge cut must follow the closed event month.');
    check(previousKnowledge === undefined || known > previousKnowledge, 'FORECAST_CADENCE_MISMATCH', 'Historical origin knowledge cuts must advance with the operational cadence.'); previousKnowledge = known;
    check(previousMonth === undefined || month - previousMonth === value.cadenceMonths, 'FORECAST_CADENCE_MISMATCH', 'Origins must follow the declared operational cadence without gaps.'); previousMonth = month;
    check(ids(origin.trainingReceiptIds, 1200), 'INVALID_FORECAST', 'Declare distinct retained training receipts for every origin.');
    check(Array.isArray(origin.targets) && origin.targets.length <= value.horizonsMonths.length, 'INVALID_FORECAST', 'Targets must name declared horizons.');
    const horizons = new Set<number>();
    for (const target of origin.targets) {
      closed(target, ['horizonMonths', 'receiptId']);
      check(typeof target.horizonMonths === 'number' && value.horizonsMonths.includes(target.horizonMonths) && !horizons.has(target.horizonMonths) && identifier(target.receiptId), 'INVALID_FORECAST', 'Each origin can bind one target receipt per declared horizon.');
      check(!origin.trainingReceiptIds.includes(target.receiptId), 'INVALID_FORECAST', 'A target receipt cannot train its own origin.'); horizons.add(target.horizonMonths);
      monthPeriod(month + target.horizonMonths);
      check(value.mode !== 'operational-as-known' || known < monthClose(month + target.horizonMonths), 'FORECAST_KNOWLEDGE_LEAK', 'An operational forecast must precede completion of its target month; later hindsight requires restated-diagnostic mode.');
    }
  }
  const origins = value.origins as ForecastRequest['origins'];
  check(new Set(origins.flatMap(origin => [...origin.trainingReceiptIds, ...origin.targets.map(target => target.receiptId)])).size <= 2400, 'INVALID_FORECAST', 'The evaluation exceeds the bounded retained receipt limit.');
  return structuredClone(value) as ForecastRequest;
}

/** Ignore mutable invalidation flags; retained historical arithmetic remains inspectable. */
export function forecastReceiptDigest(receipt: ForecastResolvedEvidence['receipts'][number]['receipt']): string {
  const { stale: _stale, staleReason: _reason, ...immutable } = receipt; return hash(immutable);
}
export function forecastEvaluationDigest(evaluation: ForecastEvaluation): string {
  // Current invalidation flags are observable metadata, not revised historical results.
  return hash({ ...evaluation, digest: undefined, coverage: { ...evaluation.coverage, staleHistoricalReceiptIds: undefined } });
}
function factDigest(fact: Fact) {
  const { deletedAt: _deleted, supersededAt: _superseded, ...immutable } = fact; return hash(immutable);
}
const absolute = (v: bigint) => v < 0n ? -v : v;
function exact(n: bigint, d: bigint): ForecastExact {
  check(d > 0n, 'INVALID_FORECAST_EVIDENCE', 'An exact value needs a positive denominator.');
  let a = absolute(n), b = d; while (b) { const r = a % b; a = b; b = r; }
  return { numerator: String(n / a), denominator: String(d / a) };
}
function prediction(numerator: bigint, denominator: bigint, actual: bigint): ForecastPrediction {
  const minor = numerator / denominator, error = minor - actual;
  return { minor: String(minor), exactMinor: exact(numerator, denominator), signedErrorMinor: String(error), absoluteErrorMinor: String(absolute(error)), squaredErrorMinor: String(error * error) };
}
function fit(values: bigint[]) {
  const n = BigInt(values.length), sx = n * (n - 1n) / 2n, sxx = n * (n - 1n) * (2n * n - 1n) / 6n;
  const sy = values.reduce((a, b) => a + b, 0n), sxy = values.reduce((a, b, i) => a + BigInt(i) * b, 0n);
  const d = n * sxx - sx * sx, slope = n * sxy - sx * sy;
  const intercept = sy * d - slope * sx, denominator = n * d;
  return { slope: exact(slope, d), intercept: exact(intercept, denominator), predict: (x: number) => ({ n: intercept + n * slope * BigInt(x), d: denominator }) };
}

// Replay the existing temporal selection rules over trusted, currently permitted evidence.
// This internal context carries no workspace authority; RPC callers cannot supply this snapshot.
function evidenceView(evidence: ForecastResolvedEvidence): { store: StateStore; ctx: Context } {
  const ctx: Context = { memberId: 'forecast-evidence', role: 'owner', epoch: 1 };
  const state: State = {
    schemaVersion: 1, revision: 0, workspace: { id: 'resolved-evidence', name: 'Resolved evidence', currency: evidence.dictionary.currency, demo: false, createdAt: evidence.dictionary.publishedAt },
    members: [{ id: ctx.memberId, role: ctx.role, epoch: 1, active: true, name: 'Evidence replay', branches: ['*'] }],
    policy: { send: 'nothing', autonomy: false, allowedSources: ['*'], retentionDays: 0, sharing: false }, ontology: null,
    facts: evidence.facts, sourceRules: evidence.sourceRules, imports: [], receipts: [], answers: [], decisions: [], actions: [], jobs: [], learning: [], plugins: [], modelReceipts: [], activity: [], conflicts: [], merges: [], tombstones: [], conversations: [], routes: [], sessions: [], unsupported: [], schedules: [],
  };
  return { ctx, store: { read: () => state, update: async () => { throw new Error('Forecast evidence replay is read-only.'); } } };
}
function eligibleRows(evidence: ForecastResolvedEvidence, request: ForecastRequest, definitions: Definition[], period: Period, asOf: string) {
  const { store, ctx } = evidenceView(evidence);
  const selection = selectFacts(store, ctx, { period, asOf, ...(request.branch === null ? {} : { branch: request.branch }), kinds: definitions.map(d => d.kind) });
  check(selection.conflicts.length === 0, 'FORECAST_COVERAGE_GAP', 'Unresolved historical source conflicts cannot qualify a training month.');
  const counted = new Set<string>(); let total = 0n;
  for (const definition of definitions) {
    const sign = BigInt(definition.sign ?? 1) * (request.operation === 'net_sales' && definition.name === 'refunds' ? -1n : 1n);
    for (const fact of selection.facts.filter(f => f.kind === definition.kind)) {
      if (['cancelled', 'void', 'draft', 'bounced'].includes(String(fact.fields.status ?? ''))) continue;
      check(typeof fact.fields[definition.field] === 'string' && /^-?\d+$/.test(String(fact.fields[definition.field])) && fact.fields.currency === definition.currency, 'FORECAST_COVERAGE_GAP', 'Missing amounts or unconverted currency leave the historical month unqualified.');
      total += BigInt(String(fact.fields[definition.field])) * sign; counted.add(fact.id);
    }
  }
  return { rows: [...counted].sort(), total };
}
function sameIds(a: string[], b: string[]) { return a.length === b.length && hash([...a].sort()) === hash([...b].sort()); }

/** Deterministic source-evidence backtest. It never fits preprocessing on targets or other origins. */
export function evaluateForecast(input: ForecastRequest, resolvedEvidence: ForecastResolvedEvidence): ForecastEvaluation {
  const request = validateForecastRequest(input);
  check(record(resolvedEvidence) && record(resolvedEvidence.dictionary) && Array.isArray(resolvedEvidence.receipts) && Array.isArray(resolvedEvidence.facts) && Array.isArray(resolvedEvidence.imports) && Array.isArray(resolvedEvidence.sourceRules), 'INVALID_FORECAST_EVIDENCE', 'Resolve retained dictionaries, guarded receipts, reconciliation imports and fact history through the trusted host.');
  const evidence = structuredClone(resolvedEvidence), dictionary = evidence.dictionary;
  const { hash: dictionaryHash, ...dictionaryContent } = dictionary;
  check(dictionary.hash === request.dictionaryHash && hash(dictionaryContent) === dictionaryHash, 'FORECAST_DEFINITION_MISMATCH', 'The retained dictionary differs from the requested immutable revision.');
  const published = timestamp(dictionary.publishedAt, 'INVALID_FORECAST_EVIDENCE');
  const operation = dictionary.operations.find(o => o.id === request.operation);
  check(operation?.type === 'sum' && (operation.definitions.length === 1 || request.operation === 'net_sales'), 'FORECAST_DEFINITION_MISMATCH', 'This method accepts published scalar monetary sums only.');
  const definitions = dictionary.definitions.filter(d => operation.definitions.includes(d.name)), definitionHash = hash(definitions);
  check(definitions.length === operation.definitions.length && definitions.every(d => d.currency === dictionary.currency), 'FORECAST_DEFINITION_MISMATCH', 'Resolve every definition in the pinned currency.');
  check(distinct(evidence.facts.map(f => f.id)), 'INVALID_FORECAST_EVIDENCE', 'Fact evidence IDs must be distinct.');
  for (const f of evidence.facts) check(request.sourceIds.includes(f.sourceId) && (request.branch === null || f.branch === request.branch) && !f.deletedAt, 'FORECAST_SCOPE_MISMATCH', 'Resolved fact history must match the current permitted source and branch scope.');
  evidence.sourceRules.forEach(r => { check(record(r) && typeof r.kind === 'string' && Array.isArray(r.sourceIds), 'INVALID_FORECAST_EVIDENCE', 'Resolve historical source precedence publications.'); timestamp(r.at, 'INVALID_FORECAST_EVIDENCE'); });
  const relevantKinds = new Set(definitions.map(d => d.kind));
  evidence.sourceRules = evidence.sourceRules.filter(rule => relevantKinds.has(rule.kind));
  const receipts = new Map(evidence.receipts.map(entry => [entry.receipt.id, entry]));
  check(receipts.size === evidence.receipts.length, 'INVALID_FORECAST_EVIDENCE', 'Resolved receipt IDs must be distinct.');
  const refs = [...new Set(request.origins.flatMap(o => [...o.trainingReceiptIds, ...o.targets.map(t => t.receiptId)]))].sort();
  check(refs.length <= 2400, 'INVALID_FORECAST', 'The evaluation exceeds the bounded retained receipt limit.');
  const facts = new Map(evidence.facts.map(f => [f.id, f])), imports = new Map(evidence.imports.map(i => [i.id, i])), months = new Map<string, number>(), pins: ForecastEvidencePin[] = [];
  check(imports.size === evidence.imports.length, 'INVALID_FORECAST_EVIDENCE', 'Resolved reconciliation import IDs must be distinct.');
  for (const id of refs) {
    const entry = receipts.get(id); check(entry, 'FORECAST_EVIDENCE_UNAVAILABLE', 'A declared origin receipt is no longer retained.');
    const r = entry.receipt, original = entry.request;
    check(record(original) && Object.keys(original).every(k => ['operation', 'sourceIds', 'branch', 'period', 'asOf'].includes(k)), 'FORECAST_SCOPE_MISMATCH', 'A forecast receipt cannot hide customer, order, assumption or other population filters.');
    check(r.operation === request.operation && r.dictionaryHash === request.dictionaryHash && r.ontologyVersion === dictionary.version && r.definitionHash === definitionHash && hash(r.definitions) === definitionHash && r.currency === dictionary.currency, 'FORECAST_DEFINITION_MISMATCH', 'Every training and target month must share operation, definition revision and currency.');
    check(Array.isArray(r.requestedSourceIds) && sameIds(r.requestedSourceIds, request.sourceIds) && r.branch === request.branch && original.operation === r.operation && Array.isArray(original.sourceIds) && sameIds(original.sourceIds, request.sourceIds) && (original.branch ?? null) === request.branch && hash(original.period) === hash(r.period), 'FORECAST_SCOPE_MISMATCH', 'Retained calculation scope must equal the forecast scope, including empty selected sources.');
    const asOf = timestamp(r.asOf, 'INVALID_FORECAST_EVIDENCE');
    // Calculator receipts always retain the resolved normalized cut, including when
    // the original caller used the default clock or an equivalent offset timestamp.
    check((original.asOf === undefined || typeof original.asOf === 'string' && Date.parse(original.asOf) === asOf) && published <= asOf, 'FORECAST_EVIDENCE_UNAVAILABLE', 'The receipt must retain its historical knowledge cut and published meaning.');
    const month = receiptMonth(r.period); months.set(id, month);
    check(asOf >= monthClose(month), 'FORECAST_COVERAGE_GAP', 'A monthly receipt must observe the complete closed event month.');
    check(r.comparePeriod === null && record(r.assumptions) && Object.keys(r.assumptions).length === 0 && /^-?\d+$/.test(r.totalMinor) && r.valueMinor === r.totalMinor, 'INVALID_FORECAST_EVIDENCE', 'Use exact observed monetary totals without scenario assumptions.');
    check(r.rows.length > 0 && r.coverage.completeness === 'reconciled-imports' && r.coverage.gaps.length === 0 && r.coverage.unresolvedConflicts === 0 && r.coverage.countedRows === r.rows.length && distinct(r.rowIds) && sameIds(r.rowIds, r.rows.map(row => row.factId)), 'FORECAST_COVERAGE_GAP', 'Every declared receipt needs reconciled, gap-free retained coverage.');
    check(ids(r.coverage.importIds, 2400), 'FORECAST_EVIDENCE_UNAVAILABLE', 'Retain the reconciliation imports backing each declared receipt.');
    const reconciliation = r.coverage.importIds.map(importId => {
      const imported = imports.get(importId);
      check(imported && Array.isArray(imported.rowIds) && record(imported.coverage), 'FORECAST_EVIDENCE_UNAVAILABLE', 'A required reconciliation import is no longer retained.');
      check(imported.sourceId === undefined || request.sourceIds.includes(imported.sourceId), 'FORECAST_SCOPE_MISMATCH', 'Reconciliation imports must belong to the declared source scope.');
      return imported;
    });
    check(r.rowIds.every(factId => reconciliation.some(imported => imported.coverage.reconciled === true && imported.rowIds.includes(factId))), 'FORECAST_COVERAGE_GAP', 'Retained imports no longer reconcile every counted receipt row.');
    check(r.sourceIds.every(source => request.sourceIds.includes(source)) && sameIds(r.sourceIds, [...new Set(r.rows.map(row => row.sourceId))]), 'FORECAST_SCOPE_MISMATCH', 'Counted receipt sources must stay inside the declared source scope.');
    const lineage = [...new Set([...r.rowIds, ...r.exclusions.map(e => e.rowId)])].sort();
    for (const factId of lineage) {
      const fact = facts.get(factId); check(fact, 'FORECAST_EVIDENCE_UNAVAILABLE', 'Required origin fact evidence is no longer retained.');
      check(timestamp(fact.learnedAt, 'INVALID_FORECAST_EVIDENCE') <= asOf, 'FORECAST_KNOWLEDGE_LEAK', 'The receipt includes a row learned after its recorded knowledge cut.');
    }
    for (const row of r.rows) {
      const f = facts.get(row.factId)!, definition = definitions.find(d => d.kind === f.kind);
      check(definition && row.entityId === f.entityId && row.sourceId === f.sourceId && row.sourceRow === f.sourceRow && row.kind === f.kind && row.validFrom === f.validFrom && row.branch === f.branch && row.amountMinor === f.fields[definition.field] && (!row.measureField || row.measureField === definition.field), 'INVALID_FORECAST_EVIDENCE', 'Retained receipt rows must match their original fact evidence.');
    }
    const observed = eligibleRows(evidence, request, definitions, r.period!, r.asOf);
    check(sameIds(observed.rows, r.rowIds) && String(observed.total) === r.totalMinor, 'FORECAST_EVIDENCE_MISMATCH', 'The receipt does not reconstruct its declared historical population and total.');
    pins.push({ receiptId: id, receiptDigest: forecastReceiptDigest(r), calculationRequestDigest: hash(original), factDigests: lineage.map(factId => ({ factId, digest: factDigest(facts.get(factId)!) })), importDigests: reconciliation.map(imported => ({ importId: imported.id, digest: hash(imported) })).sort((a, b) => a.importId.localeCompare(b.importId)) });
  }
  const pinMap = new Map(pins.map(p => [p.receiptId, p]));
  const origins: ForecastEvaluation['origins'] = [], folds: ForecastEvaluation['folds'] = [];
  let maxKnowledge = Math.max(...refs.map(id => timestamp(receipts.get(id)!.receipt.asOf)));
  for (const origin of request.origins) {
    const cutoffMonth = monthIndex(origin.eventCutoff), effective = timestamp(origin.knowledgeCut) - request.availabilityLagMs;
    if (request.mode === 'operational-as-known') check(published <= effective, 'FORECAST_EVIDENCE_UNAVAILABLE', 'The pinned definition was unavailable at this operational origin.');
    const excluded: ForecastEvaluation['origins'][number]['excludedTraining'] = [], candidates = new Map<number, typeof evidence.receipts>();
    for (const id of origin.trainingReceiptIds) {
      const entry = receipts.get(id)!, month = months.get(id)!;
      const reason = month > cutoffMonth ? 'after-event-cutoff' : request.mode === 'operational-as-known' && monthClose(month) > effective ? 'month-not-available' : request.mode === 'operational-as-known' && timestamp(entry.receipt.asOf) > effective ? 'after-knowledge-cut' : null;
      if (reason) { excluded.push({ receiptId: id, reason }); continue; }
      candidates.set(month, [...(candidates.get(month) ?? []), entry]);
    }
    const selected = [...candidates.entries()].sort(([a], [b]) => a - b).map(([month, entries]) => {
      entries.sort((a, b) => timestamp(b.receipt.asOf) - timestamp(a.receipt.asOf) || a.receipt.id.localeCompare(b.receipt.id));
      const entry = entries[0];
      check(!entries.slice(1).some(e => timestamp(e.receipt.asOf) === timestamp(entry.receipt.asOf) && (e.receipt.totalMinor !== entry.receipt.totalMinor || !sameIds(e.receipt.rowIds, entry.receipt.rowIds))), 'FORECAST_EVIDENCE_MISMATCH', 'Ambiguous receipts describe different values at the same monthly knowledge cut.');
      entries.slice(1).forEach(e => excluded.push({ receiptId: e.receipt.id, reason: 'older-month-revision' }));
      if (request.mode === 'operational-as-known') {
        const known = eligibleRows(evidence, request, definitions, entry.receipt.period!, new Date(effective).toISOString());
        check(sameIds(known.rows, entry.receipt.rowIds) && String(known.total) === entry.receipt.totalMinor, 'FORECAST_EVIDENCE_UNAVAILABLE', 'Retained training receipts omit evidence already available at this origin. Supply an origin receipt for that knowledge cut.');
      }
      return { month, entry };
    });
    check(selected.length >= request.minimumTrainingMonths, 'FORECAST_HISTORY_REQUIRED', 'This origin lacks the minimum eligible training history.');
    for (let i = 1; i < selected.length; i++) check(selected[i].month === selected[i - 1].month + 1, 'FORECAST_GAP', 'Eligible training months must be consecutive with no imputed gaps.');
    let lastAvailable = cutoffMonth;
    if (request.mode === 'operational-as-known') { while (monthClose(lastAvailable) > effective) lastAvailable--; maxKnowledge = Math.max(maxKnowledge, effective); }
    check(selected.at(-1)!.month === lastAvailable, 'FORECAST_GAP', 'Training must reach the latest completed available month at this origin.');
    const training = selected.map(({ entry: { receipt: r } }) => ({ receiptId: r.id, period: r.period!, asOf: r.asOf, totalMinor: r.totalMinor, evidenceDigest: hash(pinMap.get(r.id)) }));
    const model = fit(training.map(t => BigInt(t.totalMinor))), firstMonth = selected[0].month;
    for (const target of origin.targets) {
      const r = receipts.get(target.receiptId)!.receipt;
      check(months.get(r.id) === cutoffMonth + target.horizonMonths, 'FORECAST_HORIZON_MISMATCH', 'Each target must cover the individual month at its declared operational offset.');
      const actual = BigInt(r.totalMinor), p = model.predict(cutoffMonth + target.horizonMonths - firstMonth), baseline = BigInt(training.at(-1)!.totalMinor);
      folds.push({ originId: origin.id, horizonMonths: target.horizonMonths, targetPeriod: r.period!, targetReceiptId: r.id, targetKnowledgeAsOf: r.asOf, actualMinor: String(actual), candidate: prediction(p.n, p.d, actual), benchmark: prediction(baseline, 1n, actual) });
    }
    origins.push({ id: origin.id, eventCutoff: origin.eventCutoff, knowledgeCut: origin.knowledgeCut, effectiveTrainingKnowledgeCut: request.mode === 'operational-as-known' ? new Date(effective).toISOString() : null, interpretation: request.mode, training, excludedTraining: excluded.sort((a, b) => a.receiptId.localeCompare(b.receiptId)), trainingDigest: hash(training), model: { interceptMinor: model.intercept, slopeMinorPerMonth: model.slope, xOriginMonth: monthStart(firstMonth).slice(0, 7), observations: training.length }, targetReceiptIds: origin.targets.map(t => t.receiptId), missingHorizonsMonths: request.horizonsMonths.filter(h => !origin.targets.some(t => t.horizonMonths === h)) });
  }
  const horizons: ForecastHorizonSummary[] = request.horizonsMonths.map(horizonMonths => {
    const scored = folds.filter(f => f.horizonMonths === horizonMonths), count = BigInt(scored.length);
    const summary = (key: 'candidate' | 'benchmark') => {
      const ae = scored.reduce((n, f) => n + BigInt(f[key].absoluteErrorMinor), 0n), se = scored.reduce((n, f) => n + BigInt(f[key].squaredErrorMinor), 0n);
      return { sumAbsoluteErrorMinor: String(ae), sumSquaredErrorMinor: String(se), meanAbsoluteErrorMinor: count ? exact(ae, count) : null, meanSquaredErrorMinor: count ? exact(se, count) : null };
    };
    const candidate = summary('candidate'), benchmark = summary('benchmark');
    return { horizonMonths, scoredOrigins: scored.length, requestedOrigins: origins.length, missingOriginIds: origins.filter(o => o.missingHorizonsMonths.includes(horizonMonths)).map(o => o.id), candidate, benchmark, comparison: !count ? 'unscored' : BigInt(candidate.sumAbsoluteErrorMinor) < BigInt(benchmark.sumAbsoluteErrorMinor) ? 'lower-absolute-error' : candidate.sumAbsoluteErrorMinor === benchmark.sumAbsoluteErrorMinor ? 'equal-absolute-error' : 'higher-absolute-error' };
  });
  const dictionaryDigest = hash(dictionary), sourceRulesDigest = hash(evidence.sourceRules.filter(r => timestamp(r.at) <= maxKnowledge));
  const evidenceDigest = hash({ dictionaryDigest, sourceRulesDigest, pins });
  const limitations = [
    'Source-evidence backtest only; no native database, live deployment or independent predictive qualification is established.',
    'No calibrated prediction interval, coverage guarantee or probabilistic composition is supplied.',
    'Univariate linear trend and last observed month only; no seasonality, covariates, imputation, hierarchy reconciliation, preprocessing or tuning.',
    'Each horizon is scored independently on its supplied origins. A lower observed error is not a deployment qualification.',
    'Targets are retained retrospective observed totals at explicit receipt knowledge cuts; corrections can change later scoring without entering earlier training.',
    'Reconciliation is backed by retained source import records, not independent native or live source qualification. Origin cuts apply to recorded fact availability.',
    'Observed monetary activity follows the pinned definitions; this does not estimate unconstrained demand or causal effects.',
    'Missing or deleted origin evidence blocks replay; evaluation does not extend retention or current access.',
  ];
  if (request.mode === 'restated-diagnostic') limitations.push('Restated diagnostic training uses explicitly supplied later-known receipt revisions and ignores operational availability cuts; these scores cannot certify historical operational performance.');
  if (horizons.some(h => h.missingOriginIds.length)) limitations.push('Some declared origin/horizon targets are absent; coverage denominators and unscored horizons are reported explicitly.');
  const result: ForecastEvaluation = {
    version: 1, type: 'forecast-evaluation-v1', mode: request.mode, interpretation: request.mode === 'operational-as-known' ? 'Historical operational evaluation using only evidence available at each origin.' : 'Restated diagnostic evaluation using later-known historical revisions; not historical operational performance.', qualification: 'source-evidence-backtest', operation: request.operation, dictionaryHash: dictionary.hash, definitionHash, currency: dictionary.currency, sourceIds: [...request.sourceIds], branch: request.branch, request, requestDigest: hash(request), evidenceDigest, dictionaryDigest, sourceRulesDigest, receiptIds: refs, rowIds: [...new Set(pins.flatMap(p => p.factDigests.map(f => f.factId)))].sort(), evidencePins: pins,
    methods: { method: 'linear-trend-v1', methodRevision: 'chausar-linear-trend-v1.1', benchmark: 'last-observed-v1', benchmarkRevision: 'chausar-last-observed-v1.1', preprocessing: 'none', tuning: 'none', rounding: 'truncate-toward-zero', target: 'individual-calendar-month', errorSign: 'prediction-minus-actual', scoringBasis: 'emitted-integer-minor-prediction' },
    origins, folds, horizons, coverage: { origins: origins.length, folds: folds.length, requestedHorizons: horizons.length, scoredHorizons: horizons.filter(h => h.scoredOrigins > 0).length, reconciledReceiptCount: refs.length, staleHistoricalReceiptIds: refs.filter(id => receipts.get(id)!.receipt.stale) }, uncertainty: { calibratedIntervals: false, intervalType: 'none' }, limitations, digest: '',
  };
  result.digest = forecastEvaluationDigest(result); return result;
}
