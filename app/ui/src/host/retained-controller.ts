/**
 * Retained scenario reads and human lesson review over the host's guarded RPC port.
 *
 * Only `scenarios.reopen`, `memory.lessons` and `memory.decideLesson` are wired. There is
 * no scenario enumeration, catalogue, persistence, recomputation, mutation, evaluation or
 * review creation here: a scenario opens only from an exact trusted host-supplied pin, and
 * a lesson decision sends only a review token the Engine itself returned. Every reply is
 * fenced by the host generation this controller joins, by its own operation generation and
 * by the caller's surface fence, so a late reply can neither revive cleared private data nor
 * overwrite a newer view, and an operation whose surface was left (an actual hash or rail
 * change read synchronously, before React commits the departure) neither publishes nor
 * dispatches. The same guard travels through the host's seam to the raw transport boundary,
 * so the host's own inner authority read cannot hide a departure from the effect.
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
  LESSON_PAGE_SIZE, isHistoricalRevision, lessonDecisionAvailability, lessonDecisionRequest, lessonPageOf, lessonPin, humanReason, retainedFailureCode,
  sameProjection, validateLessonDecisionReply, validateLessonReviewList, validateRetainedScenarioView, validateScenarioSelection,
} from './retained-contracts.ts';
import type {
  LessonDecisionIntent, LessonHumanDecision, LessonReviewView, RetainedFailureCode, RetainedScenarioView, ScenarioSelection,
} from './retained-contracts.ts';

export type RetainedMethod = 'scenarios.reopen' | 'memory.lessons' | 'memory.decideLesson';
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
 * The host's guarded port restricted to the three retained-reader methods. It is deliberately not
 * the generic request port: every retained call carries its guard to the raw transport boundary,
 * so a port that cannot recheck it there cannot be supplied here.
 */
export interface RetainedPort { guarded<M extends RetainedMethod>(method: M, payload: HostRpcPayloads[M], guard: EffectGuard): Promise<unknown> }

export type RetainedScenarioState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading'; readonly selection: ScenarioSelection }
  /** `checking` while a fresh re-read confirms the displayed view before a proof opens. */
  | { readonly kind: 'ready'; readonly selection: ScenarioSelection; readonly view: RetainedScenarioView; readonly historical: boolean; readonly checking: boolean }
  | { readonly kind: 'unavailable'; readonly selection: ScenarioSelection | null; readonly code: RetainedFailureCode };
export type LessonReviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** `notice` names why a selection was dropped without sending: a changed review or a cancelled press.
   * `page` is the at-rest window of five over the complete released list, in Engine order. */
  | { readonly kind: 'ready'; readonly lessons: readonly LessonReviewView[]; readonly selectedId: string | null; readonly notice: RetainedFailureCode | null; readonly page: number }
  | { readonly kind: 'deciding'; readonly lessons: readonly LessonReviewView[]; readonly selectedId: string; readonly decision: LessonHumanDecision; readonly page: number }
  /** `afterDispatch` means the decision may already be recorded; nothing is replayed. */
  | { readonly kind: 'unavailable'; readonly code: RetainedFailureCode; readonly afterDispatch: boolean };
export interface RetainedState { readonly scenario: RetainedScenarioState; readonly lessons: LessonReviewState }
export type RetainedActionCode = RetainedFailureCode | 'REASON_REQUIRED' | 'DECISION_UNAVAILABLE' | 'DECISION_IN_FLIGHT' | 'SELECTION_INVALID';
export type RetainedActionResult = { readonly ok: true } | { readonly ok: false; readonly code: RetainedActionCode };
export interface RetainedControllerOptions {
  /** The current trusted host context; null when the host is not ready. */
  readonly context: () => UiContext | null;
}
export interface RetainedController {
  snapshot(): RetainedState;
  subscribe(listener: () => void): () => void;
  /** A fresh authorized `scenarios.reopen` for an exact trusted host pin. Nothing is listed or recomputed. */
  openScenario(selection: unknown, fence?: OperationFence): Promise<RetainedActionResult>;
  /** A fresh `scenarios.reopen` of the displayed pin that must still equal the displayed checked view
   * before its embedded receipt or full provenance opens. A changed view refuses and clears. */
  confirmScenario(selection: ScenarioSelection, view: RetainedScenarioView, fence?: OperationFence): Promise<RetainedActionResult>;
  closeScenario(): void;
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
const idle: RetainedState = Object.freeze({ scenario: Object.freeze({ kind: 'idle' }), lessons: Object.freeze({ kind: 'idle' }) });

export function createRetainedController(port: RetainedPort, options: RetainedControllerOptions): RetainedController {
  let state: RetainedState = idle;
  let generation = Symbol(), scenarioGeneration = Symbol(), lessonGeneration = Symbol();
  let decisionDispatched = false;
  const listeners = new Set<() => void>();
  const publish = (next: Partial<RetainedState>) => {
    state = Object.freeze({ ...state, ...next });
    for (const listener of listeners) { try { listener(); } catch { /* observers own their errors */ } }
  };
  const current = (token: symbol, operation: symbol, latest: () => symbol) => generation === token && latest() === operation;
  const scenarioCurrent = (token: symbol, operation: symbol) => current(token, operation, () => scenarioGeneration);
  const lessonCurrent = (token: symbol, operation: symbol) => current(token, operation, () => lessonGeneration);
  const onSurface = (fence: OperationFence | undefined) => { try { return fence === undefined || fence() === true; } catch { return false; } };
  /** The guard an operation carries to the raw transport boundary: its own generation and its surface fence, read together. */
  const guardFor = (live: () => boolean, fence: OperationFence | undefined, issued?: () => void): EffectGuard => ({ live: () => live() && onSurface(fence), issued });
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
  /** The surface was left while this operation was in flight: it is dropped as a cancellation would drop it. */
  const leftScenario = () => { const next = cancelScenario(); if (next !== undefined) publish({ scenario: next }); return failure('READ_INVALIDATED'); };
  const leftLessons = () => { const next = cancelLessons(); if (next !== undefined) publish({ lessons: next }); return failure('READ_INVALIDATED'); };

  async function openScenario(input: unknown, fence?: OperationFence): Promise<RetainedActionResult> {
    let selection: ScenarioSelection;
    try { selection = validateScenarioSelection(input); }
    catch { scenarioGeneration = Symbol(); publish({ scenario: { kind: 'unavailable', selection: null, code: 'INVALID_REPLY' } }); return failure('SELECTION_INVALID'); }
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); scenarioGeneration = operation;
    publish({ scenario: { kind: 'loading', selection } });
    try {
      const raw = await port.guarded('scenarios.reopen', selection, guardFor(() => scenarioCurrent(token, operation), fence));
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const view = validateRetainedScenarioView(raw, selection);
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      publish({ scenario: { kind: 'ready', selection, view, historical: isHistoricalRevision(view), checking: false } });
      return success;
    } catch (error) {
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const code = retainedFailureCode(error);
      // A refusal replaces the whole private view; no earlier figure, proof or control survives beside it.
      publish({ scenario: { kind: 'unavailable', selection, code } });
      return failure(code);
    }
  }
  async function confirmScenario(selection: ScenarioSelection, view: RetainedScenarioView, fence?: OperationFence): Promise<RetainedActionResult> {
    const shown = state.scenario;
    // The press must name the exact displayed pin and checked view; an obsolete control cannot confirm a newer one.
    if (shown.kind !== 'ready' || shown.checking || !sameProjection(shown.selection, selection) || shown.view !== view) return failure('SELECTION_INVALID');
    if (!onSurface(fence)) return failure('READ_INVALIDATED');
    const token = generation, operation = Symbol(); scenarioGeneration = operation;
    publish({ scenario: { ...shown, checking: true } });
    try {
      const raw = await port.guarded('scenarios.reopen', shown.selection, guardFor(() => scenarioCurrent(token, operation), fence));
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const fresh = validateRetainedScenarioView(raw, shown.selection);
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      if (!sameProjection(fresh, shown.view)) {
        // Current authority or results moved on. The old press is refused and the stale view cleared; a new read is explicit.
        publish({ scenario: { kind: 'unavailable', selection: shown.selection, code: 'SCENARIO_VIEW_CHANGED' } });
        return failure('SCENARIO_VIEW_CHANGED');
      }
      publish({ scenario: { ...shown, checking: false } });
      return success;
    } catch (error) {
      if (!scenarioCurrent(token, operation)) return failure('READ_INVALIDATED');
      if (!onSurface(fence)) return leftScenario();
      const code = retainedFailureCode(error);
      publish({ scenario: { kind: 'unavailable', selection: shown.selection, code } });
      return failure(code);
    }
  }
  function closeScenario() { scenarioGeneration = Symbol(); publish({ scenario: { kind: 'idle' } }); }

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
    const next: { scenario?: RetainedScenarioState; lessons?: LessonReviewState } = {};
    const scenario = cancelScenario(), lessons = cancelLessons();
    if (scenario !== undefined) next.scenario = scenario;
    if (lessons !== undefined) next.lessons = lessons;
    if (next.scenario !== undefined || next.lessons !== undefined) publish(next);
  }
  function invalidate() {
    generation = Symbol(); scenarioGeneration = Symbol(); lessonGeneration = Symbol(); decisionDispatched = false;
    publish(idle);
  }
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    openScenario, confirmScenario, closeScenario, readLessons, selectLesson, pageLessons, decideLesson, cancelPending, invalidate,
  });
}
