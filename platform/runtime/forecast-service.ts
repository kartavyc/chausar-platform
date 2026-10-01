import { CalculatorService, type CalculationRequest, type CalculatorOptions } from './calculator.ts';
import { audit, authorize, check, hash, newId, now, type Context, type State, type StateStore } from './contracts.ts';
import { canSeeFact, currentAccess } from './memory.ts';
import { OntologyService } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import { evaluateForecast, forecastEvaluationDigest, validateForecastRequest } from './forecast-evaluation.ts';
import type { ForecastEvaluation, ForecastRequest, ForecastResolvedEvidence, SavedForecastEvaluation } from './forecast-contracts.ts';

function viewOf(state: State): StateStore {
  return { read: () => structuredClone(state), update: async () => { throw new Error('Forecast authorization snapshots are read-only.'); } };
}
function evaluationContent(saved: SavedForecastEvaluation): ForecastEvaluation {
  const { id: _id, memberId: _member, epoch: _epoch, createdAt: _created, at: _at, stale: _stale, staleReason: _reason, ...evaluation } = saved;
  return evaluation;
}

/** Private receipt-backed evaluations in the existing encrypted authority snapshot. */
export class ForecastService {
  readonly store: StateStore;
  readonly options: CalculatorOptions;
  constructor(store: StateStore, options: CalculatorOptions = {}) { this.store = store; this.options = { ...options }; }

  private resolve(state: State, ctx: Context, request: ForecastRequest): ForecastResolvedEvidence {
    const view = viewOf(state), member = authorize(view, ctx);
    currentAccess(view, ctx, request.branch ?? undefined); assertSourceAccess(state, ctx, request.sourceIds);
    check(request.branch !== null || member.branches.includes('*'), 'FORECAST_SCOPE_MISMATCH', 'All-branch forecasting requires current access to every branch. Choose an explicit permitted branch otherwise.');
    const dictionaries = new OntologyService(view).history(ctx).filter(dictionary => dictionary.hash === request.dictionaryHash);
    check(dictionaries.length === 1, 'FORECAST_EVIDENCE_UNAVAILABLE', 'The pinned historical dictionary is no longer retained.');
    const dictionary = dictionaries[0], calculator = new CalculatorService(view, this.options);
    const ids = [...new Set(request.origins.flatMap(o => [...o.trainingReceiptIds, ...o.targets.map(t => t.receiptId)]))];
    const receipts = ids.map(id => {
      const receipt = calculator.receipt(ctx, id); assertSourceAccess(state, ctx, receipt.sourceIds);
      const provenance = state.answers.filter(answer => answer.receiptId === id);
      check(provenance.length === 1 && provenance[0].request && typeof provenance[0].request === 'object', 'FORECAST_EVIDENCE_UNAVAILABLE', 'The original calculation request is required to reconstruct this receipt scope.');
      const original = structuredClone(provenance[0].request) as CalculationRequest;
      this.options.consumerGuard?.(structuredClone(ctx), structuredClone(original));
      const lineage = [...receipt.rowIds, ...receipt.exclusions.map(exclusion => exclusion.rowId)];
      check(!state.tombstones.some(t => lineage.includes(t.factId ?? t.id)), 'FORECAST_EVIDENCE_UNAVAILABLE', 'Deleted fact evidence cannot be reopened through a retained receipt.');
      return { receipt, request: original };
    });
    const tombstones = new Set(state.tombstones.map(t => t.factId ?? t.id));
    const facts = state.facts.filter(fact => request.sourceIds.includes(fact.sourceId) && (request.branch === null || fact.branch === request.branch) && !fact.deletedAt && !tombstones.has(fact.id) && canSeeFact(view, ctx, fact));
    const operation = dictionary.operations.find(candidate => candidate.id === request.operation);
    const kinds = new Set(dictionary.definitions.filter(definition => operation?.definitions.includes(definition.name)).map(definition => definition.kind));
    const sourceRules = state.sourceRules.filter(rule => kinds.has(rule.kind) && Array.isArray(rule.sourceIds)).map(rule => ({ kind: rule.kind as string, sourceIds: structuredClone(rule.sourceIds) as string[], at: rule.at as string }));
    const importIds = new Set(receipts.flatMap(entry => entry.receipt.coverage.importIds));
    const imports: ForecastResolvedEvidence['imports'] = state.imports.filter(imported => importIds.has(imported.id));
    return { dictionary, receipts, facts: structuredClone(facts), imports: structuredClone(imports), sourceRules };
  }

  async evaluate(ctx: Context, input: ForecastRequest): Promise<SavedForecastEvaluation> {
    // Detach before the update can queue behind another writer; authorization uses its commit snapshot.
    const request = validateForecastRequest(input), context = structuredClone(ctx);
    authorize(this.store, context);
    return this.store.update(state => {
      const result = evaluateForecast(request, this.resolve(state, context, request)), at = now();
      const saved: SavedForecastEvaluation = { ...result, id: newId('forecast'), memberId: context.memberId, epoch: context.epoch, createdAt: at, at, stale: false };
      state.answers.push(structuredClone(saved));
      audit(state, 'forecast.evaluated', { forecastId: saved.id, memberId: context.memberId, mode: request.mode, requestDigest: result.requestDigest, evidenceDigest: result.evidenceDigest, horizonMonths: request.horizonsMonths, scoredFolds: result.folds.length });
      return structuredClone(saved);
    });
  }

  get(ctx: Context, id: string): SavedForecastEvaluation {
    const state = this.store.read(), context = structuredClone(ctx), view = viewOf(state);
    authorize(view, context);
    check(typeof id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(id), 'INVALID_FORECAST', 'Choose a saved forecast identifier.');
    const saved = state.answers.find(answer => answer.id === id && answer.type === 'forecast-evaluation-v1') as SavedForecastEvaluation | undefined;
    check(saved, 'FORECAST_NOT_FOUND', 'This private forecast evaluation is unavailable.');
    check(saved.memberId === context.memberId && saved.epoch === context.epoch, 'FORECAST_FORBIDDEN', 'This saved forecast belongs to another account or permission epoch.');
    const content = evaluationContent(saved);
    check(forecastEvaluationDigest(content) === saved.digest && hash(saved.request) === saved.requestDigest, 'FORECAST_EVIDENCE_MISMATCH', 'The saved forecast evaluation has changed since it was recorded.');
    const request = validateForecastRequest(saved.request);
    const replay = evaluateForecast(request, this.resolve(state, context, request));
    check(replay.evidenceDigest === saved.evidenceDigest, 'FORECAST_EVIDENCE_MISMATCH', 'Retained origin evidence changed or is unavailable. Create a separately labelled evaluation instead.');
    return structuredClone(saved);
  }
}
