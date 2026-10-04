import { CalculatorService, type CalculationReceipt, type CalculationRequest } from './calculator.ts';
import { authorize, check, ChausarError, hash, type Context } from './contracts.ts';
import { currentAccess, validDate, type Period } from './memory.ts';
import { OntologyService, type Dictionary, type Operation } from './ontology.ts';
import { assertSourceAccess } from './trust.ts';
import type { TodayTile, TodayTileConfiguration, TodayTileGap, TodayTileValue, TodayTilesRequest, TodayTilesResult } from './today-tiles-contracts.ts';

const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value);
const plain = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value: unknown, required: string[], optional: string[] = []) => plain(value)
  && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key));
const periodValid = (value: unknown): value is Period => exactKeys(value, ['from', 'to']) && plain(value)
  && validDate(value.from) && validDate(value.to) && value.from <= value.to;
const samePeriod = (left: Period | null, right?: Period) => right === undefined ? left === null : left?.from === right.from && left.to === right.to;
function synchronous(value: unknown) {
  check(!value || !['object', 'function'].includes(typeof value) || typeof (value as { then?: unknown }).then !== 'function',
    'TODAY_TILES_CALCULATOR_REQUIRED', 'Today tiles require synchronous installed calculator readiness guards.');
}
function validate(input: TodayTilesRequest): TodayTilesRequest {
  const valid = (condition: unknown) => check(condition, 'TODAY_TILES_INVALID_REQUEST', 'Supply bounded explicit tile, figure, period, bucket, comparison, source, branch and knowledge-cut configuration.');
  valid(exactKeys(input, ['dictionaryHash', 'asOf', 'scope', 'tiles']));
  valid(typeof input.dictionaryHash === 'string' && /^[a-f0-9]{64}$/.test(input.dictionaryHash));
  valid(typeof input.asOf === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.asOf)
    && Number.isFinite(Date.parse(input.asOf)) && new Date(input.asOf).toISOString() === input.asOf);
  valid(exactKeys(input.scope, ['sourceIds', 'branch']));
  valid(Array.isArray(input.scope.sourceIds) && input.scope.sourceIds.length <= 64
    && Array.from(input.scope.sourceIds).every(identifier) && new Set(input.scope.sourceIds).size === input.scope.sourceIds.length);
  valid(input.scope.branch === null || identifier(input.scope.branch));
  valid(Array.isArray(input.tiles) && input.tiles.length > 0 && input.tiles.length <= 12);
  const ids = new Set<string>(); let calculations = 0;
  for (const tile of input.tiles) {
    valid(exactKeys(tile, ['id', 'label', 'operation', 'figureKey', 'period', 'buckets'], ['comparison']));
    valid(identifier(tile.id) && !ids.has(tile.id)); ids.add(tile.id);
    valid(typeof tile.label === 'string' && tile.label.trim().length > 0 && tile.label.length <= 200);
    valid(identifier(tile.operation) && identifier(tile.figureKey) && periodValid(tile.period));
    valid(Array.isArray(tile.buckets) && tile.buckets.length <= 366);
    const bucketIds = new Set<string>(); let previous: Period | undefined;
    for (const bucket of tile.buckets) {
      valid(exactKeys(bucket, ['id', 'label', 'period']));
      valid(identifier(bucket.id) && !bucketIds.has(bucket.id)); bucketIds.add(bucket.id);
      valid(typeof bucket.label === 'string' && bucket.label.trim().length > 0 && bucket.label.length <= 200 && periodValid(bucket.period));
      valid(bucket.period.from >= tile.period.from && bucket.period.to <= tile.period.to && (!previous || previous.to < bucket.period.from));
      previous = bucket.period;
    }
    if (tile.comparison !== undefined) {
      valid(exactKeys(tile.comparison, ['operation', 'figureKey', 'period']));
      valid(identifier(tile.comparison.operation) && identifier(tile.comparison.figureKey) && periodValid(tile.comparison.period));
    }
    calculations += 1 + tile.buckets.length + (tile.comparison ? 1 : 0);
  }
  valid(calculations <= 512);
  return structuredClone(input);
}
const unavailable = (code: string, message: string): TodayTileValue => ({ status: 'unavailable', figure: null, receiptId: null, definition: null, coverage: null, gaps: [{ code, message }] });
const semanticFailures = new Set(['INVALID_CURRENCY', 'CURRENCY_PRECISION_UNSUPPORTED', 'CURRENCY_MISMATCH', 'MISSING_MEASURE_VALUE', 'INVALID_MINOR_UNITS', 'INVALID_EVENT_SIGN']);
const contextIdentity = (ctx: Context) => hash({ memberId: ctx.memberId, role: ctx.role, epoch: ctx.epoch,
  channel: ctx.channel ?? null, sourceTainted: ctx.sourceTainted ?? null });

/** Source service: all financial arithmetic and publication stay in the installed calculator. */
export class TodayTilesService {
  readonly calculator: CalculatorService;
  readonly #issued = new WeakMap<TodayTilesResult, {
    contextHash: string; workspaceId: string; contentHash: string; release(): TodayTilesResult;
  }>();
  constructor(calculator: CalculatorService) {
    check(calculator instanceof CalculatorService && typeof calculator.consumerGuard === 'function' && typeof calculator.receiptGuard === 'function',
      'TODAY_TILES_CALCULATOR_REQUIRED', 'Install Today tiles with the existing guarded CalculatorService.');
    this.calculator = calculator;
  }
  async build(ctx: Context, input: TodayTilesRequest): Promise<TodayTilesResult> {
    const request = validate(input), calculator = this.calculator, store = calculator.store;
    ctx = structuredClone(ctx);
    const consumerGuard = calculator.consumerGuard, receiptGuard = calculator.receiptGuard, verifier = calculator.verifier;
    const dictionary = new OntologyService(store).current(ctx);
    check(dictionary && dictionary.hash === request.dictionaryHash, 'TODAY_TILES_DEFINITION_CHANGED', 'Tile configuration must name the current published dictionary.');
    const access = () => {
      authorize(store, ctx); currentAccess(store, ctx, request.scope.branch ?? undefined);
      assertSourceAccess(store.read(), ctx, request.scope.sourceIds);
      check(calculator.store === store && calculator.consumerGuard === consumerGuard && calculator.receiptGuard === receiptGuard && calculator.verifier === verifier
        && typeof consumerGuard === 'function' && typeof receiptGuard === 'function', 'TODAY_TILES_CALCULATOR_REQUIRED', 'The installed calculator or its guards changed during assembly.');
      check(new OntologyService(store).current(ctx)?.hash === dictionary.hash, 'TODAY_TILES_DEFINITION_CHANGED', 'Definitions changed during tile assembly. Recalculate.');
    };
    const fingerprint = () => {
      const state = store.read();
      return hash({ workspace: state.workspace, schemaVersion: state.schemaVersion, members: state.members, policy: state.policy,
        facts: state.facts, imports: state.imports, sourceRules: state.sourceRules, merges: state.merges, tombstones: state.tombstones });
    };
    access(); const inputHash = fingerprint();
    const fence = () => { access(); check(fingerprint() === inputHash, 'TODAY_TILES_INPUT_CHANGED', 'Source evidence, identity or authority changed between sequential tile calculations. Recalculate.'); };
    const retained: { request: CalculationRequest; operation: Operation; figureKey: string; value: TodayTileValue; receipt: CalculationReceipt }[] = [];
    const calculate = async (operation: Operation, figureKey: string, period: Period, comparePeriod?: Period): Promise<TodayTileValue> => {
      const calculation: CalculationRequest = { operation: operation.id, period, asOf: request.asOf, sourceIds: request.scope.sourceIds,
        ...(request.scope.branch === null ? {} : { branch: request.scope.branch }), ...(comparePeriod ? { comparePeriod } : {}) };
      fence(); synchronous(consumerGuard!(ctx, structuredClone(calculation))); fence();
      let receipt: CalculationReceipt;
      try { receipt = await calculator.calculate(ctx, calculation); }
      catch (error) {
        fence();
        if (error instanceof ChausarError && semanticFailures.has(error.code)) return unavailable(error.code, error.message);
        throw error;
      }
      fence();
      const value = this.#value(receipt, operation, figureKey, dictionary, calculation);
      retained.push({ request: calculation, operation, figureKey, value, receipt });
      return value;
    };
    const tileValue = async (tile: TodayTileConfiguration, period: Period) => {
      const operation = dictionary.operations.find(item => item.id === tile.operation);
      if (!operation || !['sum', 'margin'].includes(operation.type)) return unavailable('UNSUPPORTED_TILE_OPERATION', 'This tile needs an existing published sum or contribution operation.');
      return calculate(operation, tile.figureKey, period);
    };
    const tiles: TodayTile[] = [];
    for (const configuration of request.tiles) {
      const tile: TodayTile = { id: configuration.id, label: configuration.label, operation: configuration.operation,
        figureKey: configuration.figureKey, period: configuration.period, value: await tileValue(configuration, configuration.period), points: [] };
      for (const bucket of configuration.buckets) tile.points.push({ ...bucket, value: await tileValue(configuration, bucket.period) });
      if (configuration.comparison) {
        const comparison = configuration.comparison, operation = dictionary.operations.find(item => item.id === comparison.operation);
        const primary = dictionary.operations.find(item => item.id === configuration.operation);
        const compatible = primary?.type === 'sum' && primary.definitions.length === 1 && primary.definitions[0] === 'earned'
          && configuration.figureKey === 'total' && operation?.type === 'change' && operation.definitions.length === 1 && operation.definitions[0] === 'earned';
        tile.comparison = { ...comparison, value: compatible
          ? await calculate(operation!, comparison.figureKey, configuration.period, comparison.period)
          : unavailable('UNSUPPORTED_TILE_COMPARISON', 'Only the existing earned-revenue change operation supplies a compatible measured comparison. No comparison algebra is installed here.') };
      }
      tiles.push(tile);
    }
    // Reopen every retained receipt, including every offscreen point, only after the final awaited calculation.
    // Consumer readiness is also current; reopening invokes the installed receipt guard and row/source/epoch checks.
    fence();
    for (const item of retained) {
      synchronous(consumerGuard!(ctx, structuredClone(item.request)));
      const receipt = calculator.receipt(ctx, item.receipt.id);
      synchronous(receiptGuard!(ctx, structuredClone(receipt)));
      fence();
      check(hash(receipt) === hash(item.receipt) && !receipt.stale, 'TODAY_TILES_RECEIPT_CHANGED', 'A retained receipt changed or became stale during tile assembly.');
      Object.assign(item.value, this.#value(receipt, item.operation, item.figureKey, dictionary, item.request));
    }
    fence();
    const result = structuredClone({ version: 1, asOf: request.asOf, dictionary: { hash: dictionary.hash, version: dictionary.version },
      scope: request.scope, atomic: false, verification: verifier ? 'configured' : 'not-configured', tiles } satisfies TodayTilesResult);
    const immutable = structuredClone(result), proofs = retained.map(item => structuredClone({
      request: item.request, operation: item.operation, figureKey: item.figureKey, value: item.value, receipt: item.receipt,
    }));
    const retainedNow = () => {
      const state = store.read(), at = Date.now(), days = state.policy.retentionDays;
      const cutoff = at - days * 86400000;
      const current = (instant: string) => typeof instant === 'string' && Number.isFinite(Date.parse(instant))
        && Date.parse(instant) >= cutoff && Date.parse(instant) <= at;
      check(Number.isFinite(at) && Number.isSafeInteger(days) && days >= 1 && days <= 3650,
        'TODAY_TILES_RETENTION_EXPIRED', 'The current receipt and evidence retention cut is unavailable. Prepare tiles again.');
      for (const proof of proofs) {
        const factIds = new Set([...proof.receipt.rowIds, ...proof.receipt.exclusions.map(item => item.rowId)]);
        check(current(proof.receipt.createdAt) && [...factIds].every(id => {
          const fact = state.facts.find(item => item.id === id); return fact && current(fact.learnedAt);
        }), 'TODAY_TILES_RETENTION_EXPIRED', 'A prepared receipt or counted or excluded fact passed the current retention cut. Prepare tiles again.');
      }
    };
    this.#issued.set(result, { contextHash: contextIdentity(ctx), workspaceId: store.read().workspace.id, contentHash: hash(result), release: () => {
      check(this.calculator === calculator, 'TODAY_TILES_CALCULATOR_REQUIRED', 'The installed calculator changed. Prepare tiles again.');
      fence(); retainedNow();
      for (const proof of proofs) {
        synchronous(consumerGuard!(ctx, structuredClone(proof.request)));
        const receipt = calculator.receipt(ctx, proof.receipt.id);
        synchronous(receiptGuard!(ctx, structuredClone(receipt)));
        fence();
        check(hash(receipt) === hash(proof.receipt) && !receipt.stale, 'TODAY_TILES_RECEIPT_CHANGED', 'A prepared receipt changed or became stale. Prepare tiles again.');
        check(hash(this.#value(receipt, proof.operation, proof.figureKey, dictionary, proof.request)) === hash(proof.value),
          'TODAY_TILES_RECEIPT_CHANGED', 'A prepared figure or its evidence changed. Prepare tiles again.');
      }
      fence(); retainedNow();
      return structuredClone(immutable);
    } });
    return result;
  }
  /** Host-only private custody. Reopens all original receipts without calculation,
   * publication, audit or update. Serialized or modified result bodies cannot be released. */
  release(ctx: Context, held: TodayTilesResult): TodayTilesResult {
    authorize(this.calculator.store, ctx);
    const issued = this.#issued.get(held);
    check(issued && issued.contextHash === contextIdentity(ctx) && issued.workspaceId === this.calculator.store.read().workspace.id
      && issued.contentHash === hash(held), 'TODAY_TILES_HELD_RESULT_FORBIDDEN', 'Release only the unchanged result issued for this exact current workspace and member context.');
    return issued.release();
  }
  #value(receipt: CalculationReceipt, operation: Operation, figureKey: string, dictionary: Dictionary, request: CalculationRequest): TodayTileValue {
    const definitions = dictionary.definitions.filter(item => operation.definitions.includes(item.name));
    check(receipt.operation === operation.id && receipt.dictionaryHash === dictionary.hash && receipt.ontologyVersion === dictionary.version
      && receipt.definitionHash === hash(definitions) && hash(receipt.definitions) === hash(definitions) && receipt.currency === dictionary.currency
      && receipt.asOf === request.asOf && receipt.branch === (request.branch ?? null) && samePeriod(receipt.period, request.period)
      && samePeriod(receipt.comparePeriod, request.comparePeriod) && hash(receipt.requestedSourceIds) === hash(request.sourceIds),
    'TODAY_TILES_RECEIPT_MISMATCH', 'Every tile receipt must retain the declared definition, scope, periods and knowledge cut.');
    const gaps: TodayTileGap[] = receipt.coverage.gaps.map(message => ({ code: 'RECEIPT_COVERAGE_GAP', message }));
    const facts = this.calculator.store.read().facts;
    let missingEvidence = false;
    for (const period of [request.period!, ...(request.comparePeriod ? [request.comparePeriod] : [])]) for (const definition of definitions) {
      const evidence = receipt.rows.some(row => row.kind === definition.kind && row.validFrom >= period.from && row.validFrom <= period.to
        && facts.some(fact => fact.id === row.factId && typeof fact.fields[definition.field] === 'string' && /^-?\d+$/.test(fact.fields[definition.field] as string)));
      if (!evidence) { missingEvidence = true; gaps.push({ code: 'DEFINITION_EVIDENCE_EMPTY', message: 'No counted known amount establishes this definition in this period. Missing activity is not zero.', definitionName: definition.name, period }); }
    }
    const figure = receipt.figures.find(item => item.key === figureKey);
    if (!figure) gaps.push({ code: 'FIGURE_UNAVAILABLE', message: 'The calculator supplied no figure for this key; an undefined ratio is not interpolated.' });
    check(!figure || /^-?\d+$/.test(figure.minor) && ['money', 'basis-points'].includes(figure.unit)
      && (figure.unit !== 'money' || figure.currency === receipt.currency), 'TODAY_TILES_RECEIPT_MISMATCH', 'Tile figures must retain exact calculator units and currency.');
    const available = !missingEvidence && Boolean(figure);
    return { status: !available ? 'unavailable' : gaps.length || receipt.coverage.completeness !== 'reconciled-imports' ? 'partial' : 'available',
      figure: available ? structuredClone(figure!) : null, receiptId: receipt.id,
      definition: { dictionaryHash: receipt.dictionaryHash, ontologyVersion: receipt.ontologyVersion, definitionHash: receipt.definitionHash,
        definitions: structuredClone(receipt.definitions), operationId: operation.id, operationType: operation.type },
      coverage: structuredClone(receipt.coverage), gaps };
  }
}
