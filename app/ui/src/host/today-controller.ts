/** Independent Today state. Optional trusted inputs never change legacy dashboard refresh. */
import type { EngineTodayResponse, TodayPreparedTiles, TodayPrepareTilesRequest, TodayReviewQueue, TodayReviewRow } from '../bridge/today-engine.ts';
import type { UiContext } from './contracts.ts';
import type { EffectGuard } from './retained-controller.ts';
import type { TodayData } from '../screens/today/TodayData.ts';
import type { Language, RowItem } from '../app/presentation.ts';
import { date } from '../format/dates.ts';
import { todayEvent, todayWords } from '../format/today-events.ts';
import { detachToday, freezeToday, sameToday, todayChart, todayDigest, todayFigure, validateEngineToday, validateTodayAttention, validateTodayEventReference, validateTodayInput, validateTodayPrepared, validateTodayQueue, validateTodayReview } from '../bridge/today-engine.ts';
import type { TodayProducerInput } from '../bridge/today-engine.ts';
import { openTodayActivity, openTodayAttention, openTodayEvent, openTodayReceipt, openTodayReview, openTodayTile } from '../bridge/today-navigation.ts';
import type { TodayDetail, TodayReadPort } from '../bridge/today-navigation.ts';
import { todayRefusalCodes } from '../bridge/contract.ts';
import type { TodayFailureCode } from '../bridge/contract.ts';

export interface TodayConsumerState {
  readonly phase: 'missing' | 'loading' | 'ready' | 'failed';
  readonly response: EngineTodayResponse | null;
  readonly page: TodayReviewQueue | null;
  readonly detail: TodayDetail | null;
  readonly preparing: boolean;
  readonly code?: TodayFailureCode;
}
export interface TodayConsumerController {
  readonly input: TodayProducerInput | null;
  snapshot(): TodayConsumerState;
  subscribe(listener: () => void): () => void;
  refresh(live?: () => boolean): Promise<void>;
  prepare(view: TodayConsumerState, live: () => boolean): Promise<boolean>;
  review(view: TodayConsumerState, row: TodayReviewRow, live: () => boolean): Promise<TodayDetail | null>;
  attention(view: TodayConsumerState, id: string, live: () => boolean): Promise<TodayDetail | null>;
  event(view: TodayConsumerState, id: string, live: () => boolean): Promise<TodayDetail | null>;
  tile(view: TodayConsumerState, id: string, live: () => boolean): Promise<TodayDetail | null>;
  page(view: TodayConsumerState, next: boolean, live: () => boolean): Promise<boolean>;
  receipt(view: TodayConsumerState, id: string, live: () => boolean): Promise<TodayDetail | null>;
  activity(view: TodayConsumerState, live: () => boolean): Promise<TodayDetail | null>;
  back(view: TodayConsumerState): TodayDetail | null;
  cancelSelection(): void;
  invalidate(): void;
  dispose(): void;
}
const empty = (phase: TodayConsumerState['phase'], code?: TodayFailureCode): TodayConsumerState => freezeToday({ phase, response: null, page: null, detail: null, preparing: false, ...(code === undefined ? {} : { code }) });
const codes: readonly TodayFailureCode[] = ['INVALID_REPLY', 'READ_INVALIDATED', 'REQUEST_FAILED', 'ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED', 'EVIDENCE_UNAVAILABLE', ...todayRefusalCodes, 'TODAY_CONFIGURATION_CHANGED'];
function failureCode(error: unknown): TodayFailureCode {
  if (error instanceof Error && error.name === 'ReplyValidationError') return 'INVALID_REPLY';
  if (error !== null && typeof error === 'object') {
    const descriptor = Object.getOwnPropertyDescriptor(error, 'code');
    const code: unknown = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
    const declared = codes.find(value => value === code); if (declared) return declared;
  }
  return 'REQUEST_FAILED';
}
export function createTodayConsumer(port: TodayReadPort, rawInput: unknown, options: { readonly context: () => UiContext | null }): TodayConsumerController {
  let input: TodayProducerInput | null = null, state: TodayConsumerState;
  try { input = validateTodayInput(rawInput); state = empty(input.display ? 'loading' : 'missing'); }
  catch { state = empty('failed', 'INVALID_REPLY'); }
  let generation = Symbol(), disposed = false, capture: TodayPreparedTiles | null = null, captureContext: string | null = null;
  let previousDetail: TodayDetail | null = null;
  const listeners = new Set<() => void>();
  const publish = (value: TodayConsumerState) => { if (!disposed) { state = freezeToday(value); for (const listener of listeners) listener(); } };
  function start(external: () => boolean): { guard: EffectGuard; current: () => boolean } {
    const token = Symbol(); generation = token; const context = options.context();
    const current = () => !disposed && generation === token && context !== null && options.context()?.contextKey === context.contextKey && external();
    return { guard: { live: current }, current };
  }
  function fail(error: unknown, current: () => boolean) {
    if (!current()) return;
    capture = null; captureContext = null; previousDetail = null;
    publish(empty('failed', failureCode(error)));
  }
  async function refresh(external: () => boolean = () => true) {
    if (disposed || input === null) return;
    if (!input.display) { generation = Symbol(); capture = null; captureContext = null; previousDetail = null; publish(empty('missing')); return; }
    const context = options.context(); if (!context) return;
    if (captureContext !== context.contextKey) { capture = null; captureContext = null; }
    const operation = start(external); previousDetail = null; publish(empty('loading'));
    const request = { ...input.display, ...(capture ? { tileCapture: capture.reference } : {}) };
    try {
      const raw = await port.guarded('today.get', request, operation.guard); if (!operation.current()) return;
      const response = validateEngineToday(raw, request, context, input.configuration);
      if (!operation.current()) return;
      publish({ phase: 'ready', response, page: null, detail: null, preparing: false });
    } catch (error) { fail(error, operation.current); }
  }
  async function prepare(view: TodayConsumerState, external: () => boolean): Promise<boolean> {
    if (state !== view || view.phase !== 'ready' || view.response === null || view.preparing || !input?.display || !input.configuration || !external() || disposed || !options.context() || options.context()?.member.role === 'viewer') return false;
    const context = options.context()!, configuration = input.configuration;
    const operation = start(external); previousDetail = null;
    publish({ ...state, page: null, detail: null, preparing: true });
    try {
      const digest = await todayDigest(configuration.request); if (!operation.current()) return false;
      if (digest !== configuration.configurationDigest || configuration.request.dictionaryHash !== configuration.starterPack.dictionaryHash || view.response?.starterPack === null || view.response && !sameToday(view.response.starterPack, configuration.starterPack)) throw Object.assign(new Error('TODAY_CONFIGURATION_CHANGED'), { code: 'TODAY_CONFIGURATION_CHANGED' });
      const request: TodayPrepareTilesRequest = { ...input.display, ...configuration };
      const raw = await port.guarded('today.prepareTiles', request, operation.guard); if (!operation.current()) return false;
      const prepared = validateTodayPrepared(raw, request); if (!operation.current()) return false;
      capture = prepared; captureContext = context.contextKey;
      // Reopen this exact capture through the producer. Never synthesize a get response.
      await refresh(external); return state.phase === 'ready';
    } catch (error) { fail(error, operation.current); return false; }
  }
  async function destination(view: TodayConsumerState, external: () => boolean, read: (guard: EffectGuard, context: UiContext) => Promise<TodayDetail>): Promise<TodayDetail | null> {
    const context = options.context(); if (state !== view || !context || disposed || !external()) return null;
    const operation = start(external); publish({ ...state, detail: null });
    try { const detail = await read(operation.guard, context); if (!operation.current()) return null; publish({ ...state, detail }); return detail; }
    catch (error) { fail(error, operation.current); return null; }
  }
  function currentRows(view: TodayConsumerState): readonly TodayReviewRow[] {
    return view.page?.rows ?? (view.response?.review.state === 'available' ? view.response.review.value.rows : []);
  }
  async function review(view: TodayConsumerState, row: TodayReviewRow, external: () => boolean) {
    if (state !== view || !external() || !currentRows(view).includes(row)) return null;
    previousDetail = null;
    return destination(view, external, async (guard, context) => {
      const current = validateTodayReview(await port.guarded('today.resolveReview', { reference: row.reference }, guard), row.reference);
      if (!guard.live()) throw Object.assign(new Error('READ_INVALIDATED'), { code: 'READ_INVALIDATED' });
      return openTodayReview(current, port, guard, context);
    });
  }
  async function attention(view: TodayConsumerState, id: string, external: () => boolean) {
    const row = view.response?.attention.state === 'available' ? view.response.attention.selection.rows.find(row => row.id === id) : undefined;
    if (state !== view || !external() || !row || !input?.display) return null; const shown = input.display; previousDetail = null;
    return destination(view, external, async guard => openTodayAttention(validateTodayAttention(await port.guarded('today.resolveAttention', { ...shown, reference: row.value.reference }, guard), row.value.reference)));
  }
  async function event(view: TodayConsumerState, id: string, external: () => boolean) {
    const selected = view.response?.dayEvents.state === 'available' ? view.response.dayEvents.value.events.find(event => event.id === id) : undefined;
    if (state !== view || !external() || !selected || !input?.display) return null; const shown = input.display; previousDetail = null;
    return destination(view, external, async guard => {
      const reference = validateTodayEventReference(await port.guarded('today.resolveEvent', { ...shown, eventId: selected.id }, guard), selected.reference);
      if (!guard.live()) throw Object.assign(new Error('READ_INVALIDATED'), { code: 'READ_INVALIDATED' });
      const detail = await openTodayEvent(reference, port, guard);
      if (!guard.live()) throw Object.assign(new Error('READ_INVALIDATED'), { code: 'READ_INVALIDATED' });
      return freezeToday({ ...detail, record: detachToday({ event: selected, current: detail.record }) });
    });
  }
  async function page(view: TodayConsumerState, next: boolean, external: () => boolean): Promise<boolean> {
    if (state !== view || !external()) return false;
    const queue = view.page ?? (view.response?.review.state === 'available' ? view.response.review.value : null);
    const cursor = next ? queue?.nextCursor : undefined; if (next && !cursor) return false;
    const operation = start(external); previousDetail = null; publish({ ...state, page: null, detail: null });
    try {
      const raw = await port.guarded('today.review', { limit: 4, ...(cursor ? { cursor } : {}) }, operation.guard); if (!operation.current()) return false;
      const page = validateTodayQueue(raw, 4); publish({ ...state, page }); return true;
    } catch (error) { fail(error, operation.current); return false; }
  }
  async function receipt(view: TodayConsumerState, id: string, external: () => boolean) {
    const ids = new Set(view.detail?.receiptIds ?? []);
    if (view.response?.tiles.state === 'prepared') for (const tile of view.response.tiles.value.result.tiles) {
      for (const part of [tile.value, ...tile.points.map(point => point.value), ...(tile.comparison ? [tile.comparison.value] : [])]) if (part.receiptId) ids.add(part.receiptId);
    }
    if (!ids.has(id)) return null;
    const prior = view.detail;
    const detail = await destination(view, external, guard => openTodayReceipt(id, port, guard));
    if (detail !== null) previousDetail = prior;
    return detail;
  }
  function back(view: TodayConsumerState): TodayDetail | null {
    if (state !== view || !previousDetail || view.detail?.kind !== 'receipt') return null;
    const detail = previousDetail; previousDetail = null; generation = Symbol(); publish({ ...state, detail }); return detail;
  }
  async function tile(view: TodayConsumerState, id: string, external: () => boolean) {
    if (state !== view || !external() || view.response?.tiles.state !== 'prepared') return null;
    const selected = view.response.tiles.value.result.tiles.find(tile => tile.id === id);
    if (!selected) return null;
    previousDetail = null;
    return destination(view, external, async () => openTodayTile(selected));
  }
  function cancelSelection() { generation = Symbol(); previousDetail = null; publish({ ...state, page: null, detail: null, preparing: false }); }
  function invalidate() { generation = Symbol(); capture = null; captureContext = null; previousDetail = null; publish(empty(input?.display ? 'loading' : 'missing')); }
  return Object.freeze({ input, snapshot: () => state, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, refresh, prepare, review, attention, event, tile, page, receipt, activity: (view: TodayConsumerState, external: () => boolean) => destination(view, external, (guard, context) => openTodayActivity(port, guard, context)), back, cancelSelection, invalidate, dispose: () => { invalidate(); disposed = true; listeners.clear(); } });
}
export function projectTodayConsumer(state: TodayConsumerState, input: TodayProducerInput | null, language: Language): TodayData {
  const response = state.response;
  const rows: readonly RowItem[] = response?.review.state === 'available' ? response.review.value.rows.map((row, index) => Object.freeze({ id: `review-${index}`, mark: 'you', what: row.title, note: todayWords(language, `review.${row.kind}`), detail: todayWords(language, 'reviewNote'), can: Object.freeze(['review'] as const) })) : [];
  const selected = response?.attention.state === 'available' ? response.attention.selection.rows : [];
  const attention: readonly RowItem[] = selected.map(row => Object.freeze({ id: row.id, mark: row.kind === 'alert-episode' && row.value.evidence.state === 'uncertain' ? 'unsure' : 'cha', what: row.kind === 'alert-episode' ? row.value.label : row.kind === 'due-decision' ? row.value.text : row.value.title, note: row.kind === 'alert-episode' ? todayWords(language, `episode.${row.value.episode.status}`) : row.kind === 'due-decision' ? todayWords(language, `due.${row.value.due}`) : row.value.dueDate, can: Object.freeze(['open'] as const) }));
  const tiles = response?.tiles.state === 'prepared' ? response.tiles.value.result.tiles.map(tile => {
    const chart = todayChart(tile, input?.charts?.find(input => input.tileId === tile.id));
    return Object.freeze({ id: tile.id, label: tile.label, figure: todayFigure(tile.value), ...(tile.comparison ? { change: todayFigure(tile.comparison.value), changeLabel: tile.comparison.operation } : {}), ...(chart ? { chart, chartState: { state: 'available' as const } } : { chartState: { state: 'missing' as const, reasonCode: 'CHART_NOT_PROVIDED' as const } }) });
  }) : undefined;
  return freezeToday({ state: state.phase === 'loading' ? { kind: 'loading' } : state.phase === 'failed' ? { kind: 'failed', code: state.code ?? 'REQUEST_FAILED' } : { kind: 'partial', missing: 'unknown', detail: todayWords(language, state.phase === 'missing' ? 'missingDisplay' : 'partial') }, date: input?.display ? date(input.display.date, 'long', language) : todayWords(language, 'dateMissing'), review: { rows, scoped: response?.review.state === 'available' ? { completeness: response.review.value.completeness, count: response.review.value.count, knownCount: response.review.value.knownCount, hasMore: response.review.value.nextCursor !== null } : { completeness: 'unavailable', count: null, knownCount: null, hasMore: false } }, worthALook: attention, ...(tiles ? { thisMonth: tiles } : { thisMonthMissing: 'unknown' }), earlierToday: response?.dayEvents.state === 'available' && input?.display ? response.dayEvents.value.events.map(event => todayEvent(event, input.display!.timeZone, language)) : [], ...(response?.dayEvents.state === 'available' && response.dayEvents.value.state.kind === 'complete' ? {} : { earlierTodayMissing: 'unknown' }), cashMissing: 'cash-not-captured', queueMissing: 'unknown', closeMissing: 'unknown', enterpriseMissing: 'unknown' });
}
