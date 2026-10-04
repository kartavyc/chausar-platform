/**
 * Retained scenario discovery and reads, and human lesson review, over the host's guarded RPC port.
 *
 * Only `scenarios.discover`, `scenarios.reopen`, `memory.lessons` and `memory.decideLesson` are
 * wired. There is no catalogue, persistence, recomputation, mutation, evaluation or review
 * creation here: discovery releases only the Engine's own bounded page of what-if metadata, a
 * scenario opens only from an exact pin (a trusted host pin, or both identities of the exact
 * checked row a person chose), and a lesson decision sends only a review token the Engine itself
 * returned. Every reply is fenced by the host generation this controller joins, by its own
 * operation generation and by the caller's surface fence, so a late reply can neither revive
 * cleared private data nor overwrite a newer view, and an operation whose surface was left (an
 * actual hash or rail change read synchronously, before React commits the departure) neither
 * publishes nor dispatches. The same guard travels through the host's seam to the raw transport
 * boundary, so the host's own inner authority read cannot hide a departure from the effect.
 *
 * Discovery rows, the issued continuation and the chosen row are ephemeral controller state: a
 * continuation names the exact rows, cursor, window and selection it was drawn beside, a row press
 * names the exact rows, window and selection it was drawn beside, a window control names the exact
 * rows, window and selection it was drawn beside, and a detail control (Read again, Back) names the
 * exact pin, checked view, rows and window it was drawn for. A chosen row's reopen is bound to the
 * exact rows, window and selection shown when it started, reread at every await and, through the
 * host's seam, immediately before the raw call: moving the window, replacing the rows or choosing
 * another row drops it. Every refusal of a chosen row, overview read, lock, context or route
 * replacement, departure or disposal clears the rows, cursor and chosen pin; a refused chosen pin is
 * never re-read and never rescued by a static host option, the next step is an explicit fresh first
 * page. A stale continuation is refused by the Engine (`SCENARIO_AUTHORITY_CHANGED`) and is never
 * repaired or silently retried; an explicit fresh read omits the cursor. Discovery never computes,
 * prepares or selects anything.
 *
 * Because `ui.context` omits the private namespaces and the external authorities, a proof
 * is opened only after a fresh `scenarios.reopen` of the same pin still equals the displayed
 * checked view, and a decision is sent only after a fresh `memory.lessons` still equals the
 * displayed review. Every released lesson list is bound to the exact trusted workspace and
 * actor before any private prose is published. A changed pin refuses the old press; nothing
 * is substituted or replayed.
 */
import type { HostRpcPayloads, UiContext } from './contracts.ts';
import {
  LESSON_PAGE_SIZE, SCENARIO_PAGE_SIZE, discoveryRowFor, isHistoricalRevision, joinDiscoveryRows, lessonDecisionAvailability, lessonDecisionRequest, lessonPageOf, lessonPin,
  humanReason, retainedFailureCode, sameProjection, sameScenarioSelection, scenarioDiscoveryRequest, scenarioPageOf, validateLessonDecisionReply, validateLessonReviewList,
  validateRetainedScenarioView, validateScenarioDiscoveryPage, validateScenarioSelection,
} from './retained-contracts.ts';
import type {
  LessonDecisionIntent, LessonHumanDecision, LessonReviewView, RetainedFailureCode, RetainedScenarioView, ScenarioDiscoveryRequest, ScenarioDiscoveryRow, ScenarioSelection,
} from './retained-contracts.ts';

export type RetainedMethod = 'scenarios.discover' | 'scenarios.reopen' | 'memory.lessons' | 'memory.decideLesson';
/**
 * Whether the surface an operation was started for is still the live one. It is read
 * synchronously at every awaited boundary, so an actual address change that React has not
 * yet committed already fences the operation. A fence that fails drops the operation exactly
 * as a lifecycle cancellation would; it never publishes or dispatches.
 */
export type OperationFence = () => boolean;
/**
 * The guard one retained operation carries through the host's internal seam. `live` joins the
 * operation's generation, its surface fence and (for a decision) its selection; the host reads it
 * synchronously after every await of its own and immediately before the raw transport call, so a
 * departure during the host's inner authority read issues nothing. `issued` is called synchronously
 * at the moment the raw call is made, and only then: uncertainty is reported for an effect that was
 * actually issued, never for a press the seam refused first.
 */
export interface EffectGuard { readonly live: () => boolean; readonly issued?: (() => void) | undefined }
/**
 * The host's guarded port restricted to the four retained-reader methods. It is deliberately not
 * the generic request port: every retained call carries its guard to the raw transport boundary,
 * so a port that cannot recheck it there cannot be supplied here.
 */
export interface RetainedPort { guarded<M extends RetainedMethod>(method: M, payload: HostRpcPayloads[M], guard: EffectGuard): Promise<unknown> }

export type RetainedScenarioState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly selection: ScenarioSelection }
  /** `checking` while a fresh re-read confirms the displayed view before a proof opens. */
  | { readonly kind: 'ready'; readonly selection: ScenarioSelection; readonly view: RetainedScenarioView; readonly historical: boolean; readonly checking: boolean }
  /** `selection` is the trusted host pin that may be read again; null when nothing may be re-read from
   * here: a malformed pin, or a chosen row whose refusal cleared the ephemeral pin with its rows. */
  | { readonly kind: 'unavailable'; readonly selection: ScenarioSelection | null; readonly code: RetainedFailureCode };
/**
 * The released what-if rows read so far, in Engine order. `rows` is every row of every page issued
 * for this list; `cursor` is the exact issued continuation (null when the Engine released no further
 * row); `page` is the at-rest window of five; `selected` is the exact row a person chose, whose fresh
 * reopen is the scenario view, or null at rest. A loading continuation publishes no rows beside it.
 */
export type ScenarioDiscoveryState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly rows: readonly ScenarioDiscoveryRow[]; readonly cursor: string | null; readonly page: number; readonly selected: ScenarioSelection | null }
  | { readonly kind: 'unavailable'; readonly code: RetainedFailureCode };
/** What a row control names: the exact rows it was drawn from, the window it was drawn on and the selection it was drawn beside. */
export interface ScenarioRowOrigin { readonly rows: readonly ScenarioDiscoveryRow[]; readonly page: number; readonly from: ScenarioSelection | null }
/** What a continuation control names: the exact rows, the exact issued cursor, the window it was drawn on and the selection it was drawn beside. */
export interface ScenarioContinuation { readonly rows: readonly ScenarioDiscoveryRow[]; readonly cursor: string; readonly page: number; readonly from: ScenarioSelection | null }
/** The exact rows and window a chosen row's detail was drawn beside. */
export interface ScenarioListOrigin { readonly rows: readonly ScenarioDiscoveryRow[]; readonly page: number }
/**
 * What a detail control (Read again, Back to the list) names: the exact pin it was drawn for, the exact
 * checked view it was drawn from (null while that pin is loading or refused) and the exact rows and window
 * it was drawn beside (null when the trusted host pin is shown alone, outside any list).
 */
export interface ScenarioDetailOrigin { readonly selection: ScenarioSelection; readonly view: RetainedScenarioView | null; readonly list: ScenarioListOrigin | null }
export type LessonReviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** `notice` names why a selection was dropped without sending: a changed review or a cancelled press.
   * `page` is the at-rest window of five over the complete released list, in Engine order. */
  | { readonly kind: 'ready'; readonly lessons: readonly LessonReviewView[]; readonly selectedId: string | null; readonly notice: RetainedFailureCode | null; readonly page: number }
  | { readonly kind: 'deciding'; readonly lessons: readonly LessonReviewView[]; readonly selectedId: string; readonly decision: LessonHumanDecision; readonly page: number }
  /** `afterDispatch` means the decision may already be recorded; nothing is replayed. */
  | { readonly kind: 'unavailable'; readonly code: RetainedFailureCode; readonly afterDispatch: boolean };
export interface RetainedState { readonly discovery: ScenarioDiscoveryState; readonly scenario: RetainedScenarioState; readonly lessons: LessonReviewState }
export type RetainedActionCode = RetainedFailureCode | 'REASON_REQUIRED' | 'DECISION_UNAVAILABLE' | 'DECISION_IN_FLIGHT' | 'SELECTION_INVALID' | 'PAGE_INVALID';
export type RetainedActionResult = { readonly ok: true } | { readonly ok: false; readonly code: RetainedActionCode };
export interface RetainedControllerOptions {
  /** The current trusted host context; null when the host is not ready. */
  readonly context: () => UiContext | null;
}
export interface RetainedController {
  snapshot(): RetainedState;
  subscribe(listener: () => void): () => void;
  /** A fresh first page of released what-if revisions: `scenarios.discover` with the consistent bounded
   * limit and no cursor. Whatever scenario was shown is cleared; nothing is chosen, computed or retried. */
  readDiscovery(fence?: OperationFence): Promise<RetainedActionResult>;
  /** The next page, with the exact issued cursor and the same limit, from the exact rows, window and selection
   * the control was drawn beside. A moved window, another list, a consumed cursor or a newer selection leaves the control inert. */
  continueDiscovery(origin: ScenarioContinuation, fence?: OperationFence): Promise<RetainedActionResult>;
  /** Moves the at-rest window over the exact rows read so far, from the exact window and selection the control was drawn
   * beside. A chosen row of the window left behind is superseded: its view and any read in flight for it are dropped. */
  pageDiscovery(rows: readonly ScenarioDiscoveryRow[], from: number, page: number, selection: ScenarioSelection | null): void;
  /** One human choice: exactly both identities of a row of the exact rows, window and selection the control was
   * drawn beside, entering a fresh `scenarios.reopen`. No label, head flag or page metadata travels with it. */
  openDiscovered(selection: unknown, origin: ScenarioRowOrigin, fence?: OperationFence): Promise<RetainedActionResult>;
  /** A fresh authorized `scenarios.reopen` for an exact trusted host pin. Nothing is listed or recomputed. */
  openScenario(selection: unknown, fence?: OperationFence): Promise<RetainedActionResult>;
  /** A fresh `scenarios.reopen` of the exact pin the control was drawn for, still shown, loading or refused beside the
   * exact rows and window it names; the chosen row stays chosen. A newer selection, view or list leaves the control inert. */
  readScenarioAgain(origin: ScenarioDetailOrigin, fence?: OperationFence): Promise<RetainedActionResult>;
  /** A fresh `scenarios.reopen` of the displayed pin that must still equal the displayed checked view
   * before its embedded receipt or full provenance opens. A changed view refuses and clears. */
  confirmScenario(selection: ScenarioSelection, view: RetainedScenarioView, fence?: OperationFence): Promise<RetainedActionResult>;
  /** Back to the list from the exact chosen row, view, rows and window the control was drawn for: the shown
   * scenario and the chosen row are dropped; the rows read so far stay. A newer selection leaves the control inert. */
  closeScenario(origin: ScenarioDetailOrigin): RetainedActionResult;
  /** A fresh `memory.lessons({})` read, published only when every row is released to the current
   * trusted workspace and exact actor. An empty list means nothing is currently released for review. */
  readLessons(fence?: OperationFence): Promise<RetainedActionResult>;
  selectLesson(id: string | null): void;
  /** Moves the at-rest window over the exact list and from the exact page the control was rendered for;
   * another list, an already-moved window or an out-of-range target leaves the control inert. */
  pageLessons(list: readonly LessonReviewView[], from: number, page: number): void;
  /** One human press, one exact decision for the exact displayed candidate, review and evaluation;
   * the current lesson views are re-read first. Never replayed. */
  decideLesson(intent: LessonDecisionIntent, reason: string, fence?: OperationFence): Promise<RetainedActionResult>;
  /** A lifecycle boundary (departure, help, sheet close or replacement): every pending operation is
   * fenced synchronously, nothing in flight may publish or dispatch, ready views are kept. */
  cancelPending(): void;
  invalidate(): void;
}

const success: RetainedActionResult = Object.freeze({ ok: true });
const failure = (code: RetainedActionCode): RetainedActionResult => Object.freeze({ ok: false, code });
const idleDiscovery: ScenarioDiscoveryState = Object.freeze({ kind: 'idle' });
const idle: RetainedState = Object.freeze({ discovery: idleDiscovery, scenario: Object.freeze({ kind: 'idle' }), lessons: Object.freeze({ kind: 'idle' }) });

export function createRetainedController(port: RetainedPort, options: RetainedControllerOptions): RetainedController {
  let state: RetainedState = idle;
  let generation = Symbol(), discoveryGeneration = Symbol(), scenarioGeneration = Symbol(), lessonGeneration = Symbol();
  let decisionDispatched = false;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<RetainedState>) => {
    state = Object.freeze({ ...state, ...next });
    for (const listener of listeners) { try { listener(); } catch { /* observers own their errors */ } }
  };
  const current = (token: symbol, operation: symbol, latest: () => symbol) => generation === token && latest() === operation;
  const discoveryCurrent = (token: symbol, operation: symbol) => current(token, operation, () => discoveryGeneration);
  const scenarioCurrent = (token: symbol, operation: symbol) => current(token, operation, () => scenarioGeneration);
  const lessonCurrent = (token: symbol, operation: symbol) => current(token, operation, () => lessonGeneration);
  const onSurface = (fence: OperationFence | undefined) => { try { return fence === undefined || fence() === true; } catch { return false; } };
  /** The guard an operation carries to the raw transport boundary: its own generation and its surface fence, read together. */
  const guardFor = (live: () => boolean, fence: OperationFence | undefined, issued?: () => void): EffectGuard => ({ live: () => live() && onSurface(fence), issued });
  /** Whether `selection` is still the chosen row of exactly the rows and window it was chosen on. */
  const chosenAt = (origin: ScenarioListOrigin, selection: ScenarioSelection) => {
    const shown = state.discovery;
    return shown.kind === 'ready' && shown.rows === origin.rows && shown.page === origin.page && sameScenarioSelection(shown.selected, selection);
  };
  /** Whether `selection` is the row currently chosen from the list, whatever the window. */
  const chosen = (selection: ScenarioSelection) => state.discovery.kind === 'ready' && sameScenarioSelection(state.discovery.selected, selection);
  /**
   * Whether a detail control still names exactly what is shown: the same pin, the same checked view object (none
   * while loading or refused), and either the same chosen row of the same rows and window, or a pin shown alone.
   */
  const detailCurrent = (origin: ScenarioDetailOrigin) => {
    const shown = state.scenario, listed = state.discovery;
    if (shown.kind === 'idle' || shown.selection === null || !sameScenarioSelection(shown.selection, origin.selection)) return false;
    if ((shown.kind === 'ready' ? shown.view : null) !== origin.view) return false;
    if (origin.list === null) return !chosen(origin.selection);
    return listed.kind === 'ready' && listed.rows === origin.list.rows && listed.page === origin.list.page && sameScenarioSelection(listed.selected, origin.selection);
  };
  /** Drops whatever discovery operation is pending: a loading page ends idle, ready rows are kept. */
  const cancelDiscovery = (): ScenarioDiscoveryState | undefined => {
    discoveryGeneration = Symbol();
    return state.discovery.kind === 'loading' ? idleDiscovery : undefined;
  };
  /** Drops whatever scenario operation is pending: a loading read ends idle, a confirming read keeps its view. */
  const cancelScenario = (): RetainedScenarioState | undefined => {
    scenarioGeneration = Symbol();
    if (state.scenario.kind === 'loading') return { kind: 'idle' };
    if (state.scenario.kind === 'ready' && state.scenario.checking) return { ...state.scenario, checking: false };
    return undefined;
  };
  /** Drops whatever lesson operation is pending: a loading read ends idle; a press cancelled before
   * dispatch sent nothing; one cancelled after dispatch stays uncertain and is never replayed. */
  const cancelLessons = (): LessonReviewState | undefined => {
    lessonGeneration = Symbol();
    if (state.lessons.kind === 'loading') return { kind: 'idle' };
    if (state.lessons.kind === 'deciding') {
      return decisionDispatched
        ? { kind: 'unavailable', code: 'READ_INVALIDATED', afterDispatch: true }
        : { kind: 'ready', lessons: state.lessons.lessons, selectedId: null, notice: 'READ_INVALIDATED', page: state.lessons.page };
    }
    return undefined;
  };
  /** A dropped loading reopen also drops the row it was chosen for: no row stays current with no view behind it. */
  const droppedSelection = (): ScenarioDiscoveryState | undefined => {
    const shown = state.discovery;
    return state.scenario.kind === 'loading' && shown.kind === 'ready' && shown.selected !== null ? { ...shown, selected: null } : undefined;
  };
  /** The surface was left while this operation was in flight: it is dropped as a cancellation would drop it. */
  const leftDiscovery = () => { const next = cancelDiscovery(); if (next !== undefined) publish({ discovery: next }); return failure('READ_INVALIDATED'); };
  const leftScenario = () => {
    const dropped = droppedSelection(), next = cancelScenario();
    if (next !== undefined) publish(dropped === undefined ? { scenario: next } : { scenario: next, discovery: dropped });
    return failure('READ_INVALIDATED');
  };
  const leftLessons = () => { const next = cancelLessons(); if (next !== undefined) publish({ lessons: next }); return failure('READ_INVALIDATED'); };
  /**
   * A scenario refusal replaces the whole private view: no earlier figure, proof, control or released row name
   * survives beside it. A refused chosen row loses its ephemeral pin with its rows and cursor: nothing is re-read
   * from it and the next step is an explicit fresh first page. A trusted host pin keeps its pin and may be re-read.
   */
  const refuseScenario = (selection: ScenarioSelection | null, code: RetainedFailureCode, discovered: boolean) => {
    discoveryGeneration = Symbol();
    publish({ scenario: { kind: 'unavailable', selection: discovered ? null : selection, code }, discovery: idleDiscovery });
  };

  /**
   * One bounded `scenarios.discover`: the exact request (a fresh first page omits the cursor; a continuation
   * carries the exact issued cursor and the same limit), the rows the continuation extends (none for a first
   * page) and the surface fence. The overview replaces whatever scenario was shown, so a late reopen of a row
   * chosen from the earlier rows can publish nothing; a refusal publishes no row, name or cursor beside it.
   */
  async function discover(request: ScenarioDiscoveryRequest, previous: readonly ScenarioDiscoveryRow[], fence: OperationFence | undefined): Promise<RetainedActionResult> {
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); discoveryGeneration = operation; scenarioGeneration = Symbol();
    publish({ discovery: { kind: 'loading' }, scenario: { kind: 'idle' } });
    try {
      const raw = await port.guarded('scenarios.discover', request, guardFor(() => discoveryCurrent(token, operation), fence));
      if (!discoveryCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftDiscovery();
      const page = validateScenarioDiscoveryPage(raw, request);
      const rows = joinDiscoveryRows(previous, page);
      if (!discoveryCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftDiscovery();
      // The window opens on the first newly released row; a fresh first page starts at the first window.
      publish({ discovery: { kind: 'ready', rows, cursor: page.nextCursor, page: scenarioPageOf(previous.length, rows.length), selected: null } });
      return success;
    } catch (error) {
      if (!discoveryCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftDiscovery();
      const code = retainedFailureCode(error);
      // A stale continuation, a withdrawn capability or a malformed page leaves no row, cursor or selection behind.
      publish({ discovery: { kind: 'unavailable', code } });
      return failure(code);
    }
  }
  function readDiscovery(fence?: OperationFence): Promise<RetainedActionResult> {
    return discover(scenarioDiscoveryRequest({ limit: SCENARIO_PAGE_SIZE }), [], fence);
  }
  function continueDiscovery(origin: ScenarioContinuation, fence?: OperationFence): Promise<RetainedActionResult> {
    const shown = state.discovery;
    // The control acts only for the exact rows, issued cursor and selection it was drawn beside, from the last window of
    // those rows: a replaced list, a consumed continuation, a moved window or a newer selection (even one React has not
    // yet committed) leaves it inert, and a copied cursor is not current.
    if (shown.kind !== 'ready' || shown.rows !== origin.rows || shown.cursor === null || shown.cursor !== origin.cursor || shown.page !== origin.page
      || !sameScenarioSelection(shown.selected, origin.from)
      || origin.page !== scenarioPageOf(origin.rows.length, Math.max(1, origin.rows.length))) return Promise.resolve(failure('PAGE_INVALID'));
    let request: ScenarioDiscoveryRequest;
    try { request = scenarioDiscoveryRequest({ limit: SCENARIO_PAGE_SIZE, cursor: shown.cursor }); }
    catch { return Promise.resolve(failure('PAGE_INVALID')); }
    return discover(request, shown.rows, fence);
  }
  function pageDiscovery(rows: readonly ScenarioDiscoveryRow[], from: number, page: number, selection: ScenarioSelection | null) {
    const shown = state.discovery;
    // A window control acts only on the exact rows it was drawn for, from the exact window and beside the exact selection it
    // was drawn on, within those rows: a control drawn beside an earlier selection cannot move the window under a newer one.
    if (shown.kind !== 'ready' || shown.rows !== rows || shown.page !== from || !sameScenarioSelection(shown.selected, selection)
      || !Number.isSafeInteger(page) || page < 0 || page * SCENARIO_PAGE_SIZE >= Math.max(1, rows.length)) return;
    if (page === shown.page) return;
    if (shown.selected === null) { publish({ discovery: { ...shown, page } }); return; }
    // The chosen row belongs to the window left behind: its view is superseded and any read in flight for it, held at the
    // host's inner authority read or already issued, can neither dispatch nor publish for the earlier window.
    scenarioGeneration = Symbol();
    publish({ discovery: { ...shown, page, selected: null }, scenario: { kind: 'idle' } });
  }

  /**
   * The one fresh exact reopen. `discovered` keeps the chosen row's list beside the view and binds the operation to the
   * exact rows, window and selection shown when it started, reread at every await and at the raw boundary; a trusted
   * pin shows alone.
   */
  async function reopen(selection: ScenarioSelection, fence: OperationFence | undefined, discovered: boolean): Promise<RetainedActionResult> {
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); scenarioGeneration = operation;
    const next: { scenario: RetainedScenarioState; discovery?: ScenarioDiscoveryState } = { scenario: { kind: 'loading', selection } };
    if (!discovered && state.discovery.kind !== 'idle') { discoveryGeneration = Symbol(); next.discovery = idleDiscovery; }
    publish(next);
    const listed = state.discovery;
    const origin: ScenarioListOrigin | null = discovered && listed.kind === 'ready' ? { rows: listed.rows, page: listed.page } : null;
    const live = () => scenarioCurrent(token, operation) && (origin === null || chosenAt(origin, selection));
    try {
      const raw = await port.guarded('scenarios.reopen', selection, guardFor(live, fence));
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const view = validateRetainedScenarioView(raw, selection);
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      publish({ scenario: { kind: 'ready', selection, view, historical: isHistoricalRevision(view), checking: false } });
      return success;
    } catch (error) {
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const code = retainedFailureCode(error);
      refuseScenario(selection, code, discovered);
      return failure(code);
    }
  }
  async function openScenario(input: unknown, fence?: OperationFence): Promise<RetainedActionResult> {
    let selection: ScenarioSelection;
    try { selection = validateScenarioSelection(input); }
    catch { scenarioGeneration = Symbol(); refuseScenario(null, 'INVALID_REPLY', false); return failure('SELECTION_INVALID'); }
    return reopen(selection, fence, false);
  }
  function openDiscovered(input: unknown, origin: ScenarioRowOrigin, fence?: OperationFence): Promise<RetainedActionResult> {
    let selection: ScenarioSelection;
    // Only exactly both identities are admitted; a decorated or malformed pin is refused without touching the list.
    try { selection = validateScenarioSelection(input); } catch { return Promise.resolve(failure('SELECTION_INVALID')); }
    const shown = state.discovery;
    // The press must come from the exact rows, window and selection it was drawn beside, and name a row of those rows:
    // a replaced or continued list, a moved window or a newer selection React has not yet committed leaves it inert.
    if (shown.kind !== 'ready' || shown.rows !== origin.rows || shown.page !== origin.page || !sameScenarioSelection(shown.selected, origin.from)
      || discoveryRowFor(shown.rows, selection) === undefined) return Promise.resolve(failure('SELECTION_INVALID'));
    if (!onSurface(fence)) return Promise.resolve(failure('READ_INVALIDATED'));
    publish({ discovery: { ...shown, selected: selection } });
    return reopen(selection, fence, true);
  }
  function readScenarioAgain(origin: ScenarioDetailOrigin, fence?: OperationFence): Promise<RetainedActionResult> {
    // The control acts only for the exact pin, view, rows and window it was drawn for; a refused chosen row has no pin to re-read.
    if (!detailCurrent(origin)) return Promise.resolve(failure('SELECTION_INVALID'));
    return reopen(origin.selection, fence, origin.list !== null);
  }
  async function confirmScenario(selection: ScenarioSelection, view: RetainedScenarioView, fence?: OperationFence): Promise<RetainedActionResult> {
    const shown = state.scenario;
    // The press must name the exact displayed pin and checked view; an obsolete control cannot confirm a newer one.
    if (shown.kind !== 'ready' || shown.checking || !sameProjection(shown.selection, selection) || shown.view !== view) return failure('SELECTION_INVALID');
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); scenarioGeneration = operation;
    const listed = state.discovery;
    const origin: ScenarioListOrigin | null = chosen(shown.selection) && listed.kind === 'ready' ? { rows: listed.rows, page: listed.page } : null;
    const live = () => scenarioCurrent(token, operation) && (origin === null || chosenAt(origin, shown.selection));
    publish({ scenario: { ...shown, checking: true } });
    try {
      const raw = await port.guarded('scenarios.reopen', shown.selection, guardFor(live, fence));
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const fresh = validateRetainedScenarioView(raw, shown.selection);
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      if (!sameProjection(fresh, shown.view)) {
        // Current authority or results moved on. The old press is refused and the stale view cleared; a new read is explicit.
        refuseScenario(shown.selection, 'SCENARIO_VIEW_CHANGED', origin !== null);
        return failure('SCENARIO_VIEW_CHANGED');
      }
      publish({ scenario: { ...shown, checking: false } });
      return success;
    } catch (error) {
      if (!live()) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const code = retainedFailureCode(error);
      refuseScenario(shown.selection, code, origin !== null);
      return failure(code);
    }
  }
  function closeScenario(origin: ScenarioDetailOrigin): RetainedActionResult {
    // Back belongs to a chosen row only, and only while exactly that row, view, rows and window are still shown.
    if (origin.list === null || !detailCurrent(origin)) return failure('SELECTION_INVALID');
    scenarioGeneration = Symbol();
    const shown = state.discovery;
    publish({ scenario: { kind: 'idle' }, discovery: shown.kind === 'ready' ? { ...shown, selected: null } : shown });
    return success;
  }

  /** The trusted context a reply is bound to: the one the operation started under, still current. */
  const boundContext = (started: UiContext): UiContext | null => {
    const now = options.context();
    return now !== null && now.contextKey === started.contextKey ? now : null;
  };
  async function readLessons(fence?: OperationFence): Promise<RetainedActionResult> {
    if (state.lessons.kind === 'deciding') return failure('DECISION_IN_FLIGHT');
    const started = options.context();
    if (started === null) return failure('READ_INVALIDATED');
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); lessonGeneration = operation;
    publish({ lessons: { kind: 'loading' } });
    try {
      const raw = await port.guarded('memory.lessons', {}, guardFor(() => lessonCurrent(token, operation), fence));
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const context = boundContext(started);
      if (context === null) return failure('READ_INVALIDATED');
      // Every row must be released to this exact workspace and actor before any private prose is published.
      const lessons = validateLessonReviewList(raw, context);
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      publish({ lessons: { kind: 'ready', lessons, selectedId: null, notice: null, page: 0 } });
      return success;
    } catch (error) {
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const code = retainedFailureCode(error);
      publish({ lessons: { kind: 'unavailable', code, afterDispatch: false } });
      return failure(code);
    }
  }
  function selectLesson(id: string | null) {
    const lessons = state.lessons;
    if (lessons.kind !== 'ready') return;
    const index = id === null ? -1 : lessons.lessons.findIndex(item => item.candidate.id === id);
    const selectedId = index >= 0 && id !== null ? id : null;
    // The at-rest window follows the selection, so the opened row is on the page a closing sheet returns to.
    const page = index >= 0 ? lessonPageOf(index, lessons.lessons.length) : lessons.page;
    if (selectedId === lessons.selectedId && lessons.notice === null && page === lessons.page) return;
    publish({ lessons: { kind: 'ready', lessons: lessons.lessons, selectedId, notice: null, page } });
  }
  function pageLessons(list: readonly LessonReviewView[], from: number, page: number) {
    const lessons = state.lessons;
    // A page control acts only on the exact list it was rendered for, at rest, from the exact page it was
    // rendered on, within that list's pages: once the window has moved, every control of the old page is inert.
    if (lessons.kind !== 'ready' || lessons.lessons !== list || lessons.page !== from || !Number.isSafeInteger(page) || page < 0 || page * LESSON_PAGE_SIZE >= Math.max(1, list.length)) return;
    if (page === lessons.page) return;
    publish({ lessons: { ...lessons, page } });
  }
  async function decideLesson(intent: LessonDecisionIntent, reason: string, fence?: OperationFence): Promise<RetainedActionResult> {
    const lessons = state.lessons, context = options.context();
    if (lessons.kind === 'deciding') return failure('DECISION_IN_FLIGHT');
    if (lessons.kind !== 'ready' || lessons.selectedId === null || context === null) return failure('DECISION_UNAVAILABLE');
    const displayed = lessons.lessons.find(item => item.candidate.id === lessons.selectedId);
    // The press must name the exact candidate, review and evaluation that are still selected; an
    // obsolete control cannot act on a newer row or consume a replacement review token.
    if (displayed === undefined || displayed.review === undefined || displayed.evaluation === undefined
      || !sameProjection(lessonPin(displayed.candidate), intent.candidate) || displayed.review.id !== intent.reviewId
      || displayed.review.digest !== intent.reviewDigest || displayed.evaluation.digest !== intent.evaluationDigest
      || !lessonDecisionAvailability(displayed, context).ok || (intent.decision !== 'approve' && intent.decision !== 'defer')) return failure('DECISION_UNAVAILABLE');
    const entered = humanReason(reason);
    if (entered === null) return failure('REASON_REQUIRED');
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    // Consume the displayed review synchronously: a second press cannot dispatch a second decision.
    const token = generation, operation = Symbol(); lessonGeneration = operation; decisionDispatched = false;
    publish({ lessons: { kind: 'deciding', lessons: lessons.lessons, selectedId: displayed.candidate.id, decision: intent.decision, page: lessons.page } });
    let dispatched = false;
    const live = () => lessonCurrent(token, operation);
    try {
      // ui.context omits the private lesson namespace and external authorities, so the exact
      // current views are re-read before the displayed review is trusted.
      const rawList = await port.guarded('memory.lessons', {}, guardFor(live, fence));
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const bound = boundContext(context);
      if (bound === null) return failure('READ_INVALIDATED');
      const fresh = validateLessonReviewList(rawList, bound);
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const latest = fresh.find(item => item.candidate.id === displayed.candidate.id);
      if (latest === undefined || !sameProjection(latest, displayed) || !lessonDecisionAvailability(latest, bound).ok) {
        // Changed pins clear the selection and refuse without sending; the old press is never continued.
        publish({ lessons: { kind: 'ready', lessons: fresh, selectedId: null, notice: 'LESSON_REVIEW_CHANGED', page: lessonPageOf(lessons.page * LESSON_PAGE_SIZE, fresh.length) } });
        return failure('LESSON_REVIEW_CHANGED');
      }
      const request = lessonDecisionRequest(displayed, intent, entered);
      // The decision carries its live guard to the raw transport boundary: the host rechecks it after its own
      // inner authority read and immediately before issuing the effect, and reports the moment it is issued.
      // A departure read at that boundary sends nothing and is a cancellation; uncertainty begins only at issue.
      const raw = await port.guarded('memory.decideLesson', request, guardFor(live, fence, () => { dispatched = true; decisionDispatched = true; }));
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const decided = validateLessonDecisionReply(raw, request, displayed);
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      // The reply replaces only its exact row. Approval records guidance; nothing else happens here.
      publish({ lessons: { kind: 'ready', lessons: fresh.map(item => item.candidate.id === decided.candidate.id ? decided : item), selectedId: null, notice: null, page: lessonPageOf(lessons.page * LESSON_PAGE_SIZE, fresh.length) } });
      return success;
    } catch (error) {
      if (!lessonCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftLessons();
      const code = retainedFailureCode(error);
      publish({ lessons: { kind: 'unavailable', code, afterDispatch: dispatched } });
      return failure(code);
    }
  }
  function cancelPending() {
    const next: { discovery?: ScenarioDiscoveryState; scenario?: RetainedScenarioState; lessons?: LessonReviewState } = {};
    const dropped = droppedSelection(), discovery = cancelDiscovery() ?? dropped, scenario = cancelScenario(), lessons = cancelLessons();
    if (discovery !== undefined) next.discovery = discovery;
    if (scenario !== undefined) next.scenario = scenario;
    if (lessons !== undefined) next.lessons = lessons;
    if (next.discovery !== undefined || next.scenario !== undefined || next.lessons !== undefined) publish(next);
  }
  function invalidate() {
    generation = Symbol(); discoveryGeneration = Symbol(); scenarioGeneration = Symbol(); lessonGeneration = Symbol(); decisionDispatched = false;
    publish(idle);
  }
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    readDiscovery, continueDiscovery, pageDiscovery, openDiscovered, openScenario, readScenarioAgain, confirmScenario, closeScenario,
    readLessons, selectLesson, pageLessons, decideLesson, cancelPending, invalidate,
  });
}
