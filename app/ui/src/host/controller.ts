/** Additive host composition. Only an injected trusted RPC port owns transport. */
import { createDesktopReceiptReader, isEvidenceDenial, readFailureCode } from '../bridge/client.ts';
import type { ReadFailureCode } from '../bridge/contract.ts';
import type { CalculationReceiptEvidence } from '../bridge/presentation.ts';
import { createDesktopTodayReader } from '../bridge/today-host.ts';
import type { DashboardTodayInput, TodayHostProjection } from '../bridge/today-host.ts';
import { createConversationHost } from '../bridge/conversation-host.ts';
import type { ConversationFailureCode, ConversationHost, ConversationHostPort } from '../bridge/conversation-host.ts';
import type { ConversationQuestionSettings } from '../app/conversation-surface.ts';
import type { Address } from '../app/presentation.ts';
import { formatAddress, parseAddress, sameAddress } from '../app/routes.ts';
import { validateCreatedWorkspace, validateModelRoutes, validateUiContext } from './contracts.ts';
import type { PlaceRpc } from '../places/types.ts';
import type { CreatedWorkspace, HostRpcPayloads, HostRpcPort, UiContext, UiModelRoute, WorkspaceCreateInput } from './contracts.ts';
import { createRetainedController } from './retained-controller.ts';
import type { EffectGuard, RetainedController, RetainedPort } from './retained-controller.ts';
import { createTodayConsumer } from './today-controller.ts';
import type { TodayConsumerController } from './today-controller.ts';
import { validateTodayInput } from '../bridge/today-engine.ts';
import type { TodayProducerInput } from '../bridge/today-engine.ts';
import type { TodayReadPort } from '../bridge/today-navigation.ts';
import { FIRST_RUN_METHODS, sameAuthority, validateOntologyReadback } from '../screens/first-run/contracts.ts';
import type { FirstRunPort, FirstRunRpcPayloads } from '../screens/first-run/contracts.ts';
import { createFirstRunController } from '../screens/first-run/controller.ts';
import type { FirstRunController, FirstRunControllerOptions, FirstRunHandoff, FirstRunResult } from '../screens/first-run/controller.ts';
import { publishedVerified, webCryptoDigest } from '../screens/first-run/digest.ts';

export type HostFailureCode = ReadFailureCode;
export type HostReceiptSelection =
  | { readonly id: string; readonly address: Address; readonly kind: 'loading' }
  | { readonly id: string; readonly address: Address; readonly kind: 'ready'; readonly value: CalculationReceiptEvidence }
  | { readonly id: string; readonly address: Address; readonly kind: 'failed'; readonly code: HostFailureCode };
export interface HostState {
  readonly phase: 'loading' | 'ready' | 'locked' | 'unavailable';
  readonly code?: HostFailureCode;
  readonly context: UiContext | null;
  readonly today: TodayHostProjection | null;
  readonly routes: readonly UiModelRoute[];
  readonly selectedRouteId: string | null;
  readonly receipt: HostReceiptSelection | null;
  readonly dictionaryReviewRequired: boolean;
  readonly todayConfiguration: 'configured' | 'not-configured';
  readonly creation: WorkspaceCreationState;
}
export type WorkspaceCreationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'creating' }
  | { readonly kind: 'recovery-required'; readonly value: CreatedWorkspace }
  | { readonly kind: 'recovery-held' }
  | { readonly kind: 'unknown'; readonly code: 'REQUEST_FAILED' }
  | { readonly kind: 'failed'; readonly code: 'INVALID_DICTIONARY_MODE' };
export interface HostOptions {
  readonly now?: () => number;
  readonly timeZone?: string;
  readonly todayProducer?: TodayProducerInput;
  /** An explicitly installed legacy dashboard contract; absence performs no figure read. */
  readonly dashboard?: DashboardTodayInput;
  readonly firstRun?: Pick<FirstRunControllerOptions, 'digest' | 'createAttemptId'>;
}
export interface HostController {
  /** Untyped named requests for lane-owned place modules (app/ui/src/places). */
  readonly places: PlaceRpc;
  readonly conversation: ConversationHost;
  /** Retained scenario reopen and lesson review, joined to every host invalidation. */
  readonly retained: RetainedController;
  readonly todayConsumer: TodayConsumerController | null;
  readonly firstRun: FirstRunController;
  readonly timeZone: string | null;
  snapshot(): HostState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Independent metadata bootstrap for the explicitly injected Today capability. */
  refreshToday(): Promise<void>;
  /** Issued trusted producer changes invalidate Today/Saved even after a lost reply. */
  invalidateTrustedProducer(): void;
  /** Install explicit trusted Today policy for the latest verified dictionary; no read is issued. */
  bindTodayProducer(input: unknown): boolean;
  /** The mounted owner supplies the actual synchronous surface guard; absence denies. */
  setFirstRunSurface(live: (() => boolean) | null): void;
  /** Final synchronous authority admission after the slice's one-shot admission. */
  completeFirstRun(handoff: FirstRunHandoff): boolean;
  createWorkspace(input: WorkspaceCreateInput): Promise<void>;
  acknowledgeRecovery(rendered: CreatedWorkspace): Promise<boolean>;
  /** Explicit metadata-only re-entry after trusted reopen; preserves the original unresolved attempt. */
  requalifyFirstRunAfterReopen(): Promise<boolean>;
  /** Trusted focus/status/poll hooks reread metadata only, never calculations. */
  checkAuthority(): Promise<void>;
  /** A catalogue route is chosen by an explicit user intent, never its priority. */
  selectRoute(id: string | null): void;
  questionSettings(): ConversationQuestionSettings | null;
  openReceipt(id: string, address: Address): Promise<void>;
  closeReceipt(): void;
  invalidate(code?: HostFailureCode): void;
  lock(): Promise<void>;
  /** Refused disposal leaves the attempt and this controller alive. */
  dispose(): FirstRunResult;
}
function failure(code: HostFailureCode): Error & { code: HostFailureCode } { return Object.assign(new Error(code), { code }); }
/** Calendar arithmetic only; no business figures are computed by the host. */
export function currentMonth(now: number, timeZone: string): { readonly date: string; readonly period: { readonly from: string; readonly to: string } } {
  if (!Number.isFinite(now)) throw failure('INVALID_REPLY');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === type)?.value;
  const year = part('year'), month = part('month'), day = part('day');
  if (!year || !month || !day || !/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) throw failure('INVALID_REPLY');
  const lastDay = String(new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate()).padStart(2, '0');
  return Object.freeze({ date: `${year}-${month}-${day}`, period: Object.freeze({ from: `${year}-${month}-01`, to: `${year}-${month}-${lastDay}` }) });
}
const emptyState = (phase: HostState['phase'], code?: HostFailureCode): HostState => Object.freeze({ phase, ...(code === undefined ? {} : { code }), context: null, today: null, routes: Object.freeze([]), selectedRouteId: null, receipt: null, dictionaryReviewRequired: false, todayConfiguration: 'not-configured', creation: Object.freeze({ kind: 'idle' }) });

export function createHostController(port: HostRpcPort, options: HostOptions = {}): HostController {
  const now = options.now ?? Date.now;
  const timeZone = options.timeZone ?? null;
  // Reject an invalid host timezone before issuing any RPC.
  if (timeZone !== null) new Intl.DateTimeFormat('en', { timeZone });
  if (options.dashboard !== undefined && timeZone === null) throw failure('INVALID_REPLY');
  let state = emptyState('loading');
  let generation = Symbol(), receiptGeneration = Symbol(), disposed = false;
  let authorityCheck: Promise<void> | null = null;
  let settings: ConversationQuestionSettings | null = null;
  let firstRunSurface: (() => boolean) | null = null;
  let verifiedHandoff: FirstRunHandoff | null = null;
  let firstRunReopenAuthority: UiContext | null = null;
  let verifiedDictionary: { readonly contextKey: string; readonly hash: string; readonly version: number; readonly pack: string } | null = null;
  let installedDashboard = options.dashboard ?? null;
  let producerBindingRequired = false;
  let creation: WorkspaceCreationState = Object.freeze({ kind: 'idle' });
  let acknowledgingRecovery = false;
  const listeners = new Set<() => void>();
  function publish(value: HostState) {
    if (!disposed) {
      const shownCreation: WorkspaceCreationState = creation.kind === 'recovery-required' && (value.phase !== 'loading' || acknowledgingRecovery) ? Object.freeze({ kind: 'recovery-held' }) : creation;
      state = Object.freeze({ ...value, creation: shownCreation }); for (const listener of listeners) listener();
    }
  }
  function isCurrent(token: symbol) { return !disposed && generation === token; }
  async function contextRead(): Promise<UiContext> { return validateUiContext(await port.request('ui.context', {})); }
  function assertSameContext(current: UiContext, expected: UiContext) {
    if (current.contextKey !== expected.contextKey || current.workspace.id !== expected.workspace.id || current.member.id !== expected.member.id || current.member.epoch !== expected.member.epoch || current.member.role !== expected.member.role) {
      invalidate('ACCESS_DENIED'); throw failure('ACCESS_DENIED');
    }
  }
  /** A caller's effect guard, read synchronously; a guard that throws is a guard that failed. */
  function guardLive(guard: EffectGuard | undefined): boolean {
    if (guard === undefined) return true;
    try { return guard.live() === true; } catch { return false; }
  }
  /**
   * The internal host seam. Every request is fenced by the host generation and the trusted context
   * read before and after it. A retained or conversation operation additionally carries its own live
   * guard (surface, generation, selection; for a conversation RPC the exact state it was started under):
   * it is reread after the inner context read, immediately before the raw transport call, after the raw
   * reply, before the value is returned and in the catch, so a departure or cancellation during the
   * host's own reads issues nothing, and a late reply or denial of an operation that is no longer live
   * publishes nothing and invalidates nothing. The guard is told the moment the raw call is actually
   * issued. A denial of a live operation is current evidence and invalidates the host as before; the
   * trusted context checks invalidate on their own, guard or not. The wire method and payload are unchanged.
   */
  async function guardedRequest<M extends keyof HostRpcPayloads>(method: M, payload: HostRpcPayloads[M], guard?: EffectGuard): Promise<unknown> {
    const token = generation, expected = state.context;
    if (!isCurrent(token) || expected === null || state.phase !== 'ready' || state.dictionaryReviewRequired) throw failure('ACCESS_DENIED');
    if (producerBindingRequired && (method.startsWith('today.') || method === 'scenarios.discover' || method === 'scenarios.reopen'
      || method === 'memory.lessons' || method === 'memory.decideLesson' || method === 'conversation.get'
      || method === 'conversation.continuation' || method === 'receipts.get')) throw failure('READ_INVALIDATED');
    if (!guardLive(guard)) throw failure('READ_INVALIDATED');
    try {
      const before = await contextRead();
      if (!isCurrent(token)) throw failure('READ_INVALIDATED');
      assertSameContext(before, expected);
      // No configured priority or caller-supplied route can select a model.
      if (method === 'models.preview' || method === 'conversation.ask') {
        const route = Object.getOwnPropertyDescriptor(payload, 'routeId');
        if (settings === null || route?.value !== settings.routeId) throw failure('ACCESS_DENIED');
      }
      // The last synchronous check before the effect: nothing is awaited between it and the raw call.
      if (!guardLive(guard)) throw failure('READ_INVALIDATED');
      guard?.issued?.();
      const value = await port.request(method, payload);
      if (!isCurrent(token) || !guardLive(guard)) throw failure('READ_INVALIDATED');
      const after = await contextRead();
      if (!isCurrent(token)) throw failure('READ_INVALIDATED');
      assertSameContext(after, expected);
      if (!guardLive(guard)) throw failure('READ_INVALIDATED');
      return value;
    } catch (error) {
      const code = readFailureCode(error);
      // Read before anything is invalidated: a denial belongs to the operation that was issued. While that operation
      // is still live it is current evidence; once its guard is dead (cancelled, replaced or departed) the reply is
      // obsolete and must not invalidate the newer journey that has since started.
      if (isCurrent(token) && guardLive(guard) && (isEvidenceDenial(code) || code === 'INVALID_REPLY')) invalidate(code);
      throw error;
    }
  }
  // The same seam under two names: the generic guarded port for the existing readers, and the retained
  // port whose every call must carry its guard to the raw boundary.
  const guardedPort: HostRpcPort & RetainedPort & TodayReadPort = { request: guardedRequest, guarded: guardedRequest };
  const todayReader = createDesktopTodayReader(guardedPort);
  const receiptReader = createDesktopReceiptReader(guardedPort);
  /**
   * The conversation's own operation guard, captured separately for each conversation RPC. The conversation host
   * publishes a fresh frozen state before every request it makes (busy preview, readback, continuation or
   * synthesis-preview; busy approval, then busy ask or synthesis-run, then busy readback, each only after the
   * preceding RPC settled) and a different state on cancellation, replacement, editing or invalidation. The exact
   * state object current at the moment a request is made is therefore that one request's identity: it is reread
   * at the seam after every await, immediately before the raw call and in the catch, so a cancelled or superseded
   * conversation operation dispatches nothing and its late reply or denial neither publishes nor invalidates the
   * newer journey, while legitimate multi-stage work completes because each stage publishes before it requests.
   */
  async function conversationRequest<M extends keyof HostRpcPayloads>(method: M, payload: HostRpcPayloads[M]): Promise<unknown> {
    const started = conversation.snapshot();
    return guardedRequest(method, payload, { live: () => conversation.snapshot() === started });
  }
  const conversationPort: ConversationHostPort = { request: conversationRequest };
  const conversation: ConversationHost = createConversationHost(conversationPort, { now });
  const retained = createRetainedController(guardedPort, { context: () => (state.phase === 'ready' ? state.context : null) });
  let todayConsumer = Object.hasOwn(options, 'todayProducer') ? createTodayConsumer(guardedPort, options.todayProducer ?? {}, { context: () => state.phase === 'ready' ? state.context : null }) : null;
  function configuredToday(): HostState['todayConfiguration'] {
    if (producerBindingRequired) return 'not-configured';
    return todayConsumer !== null ? todayConsumer.input?.display !== undefined && todayConsumer.input.configuration !== undefined ? 'configured' : 'not-configured'
      : installedDashboard !== null ? 'configured' : 'not-configured';
  }
  function firstRunLive(): boolean {
    if (disposed || state.phase !== 'ready' || state.context === null || !state.dictionaryReviewRequired) return false;
    try { return firstRunSurface?.() === true; } catch { return false; }
  }
  // The slice owns before/after context reads and the verified adoption of its publication's new key.
  // The ordinary guarded port intentionally cannot admit that mutation. No other method enters here.
  const firstRunPort: FirstRunPort = { request(method, payload) {
    if (!FIRST_RUN_METHODS.includes(method) || !firstRunLive()) return Promise.reject(failure('READ_INVALIDATED'));
    // Each branch names its identical wire schema. TypeScript cannot narrow a generic indexed
    // payload when its method narrows; these assertions change no bytes or object identity.
    switch (method) {
      case 'ui.context': return port.request('ui.context', payload as FirstRunRpcPayloads['ui.context']);
      case 'ontology.packs': return port.request('ontology.packs', payload as FirstRunRpcPayloads['ontology.packs']);
      case 'ontology.get': return port.request('ontology.get', payload as FirstRunRpcPayloads['ontology.get']);
      case 'ontology.publish':
        // Capture before dispatch: the raw port can synchronously invalidate this host.
        firstRunReopenAuthority = state.context;
        return port.request('ontology.publish', payload as FirstRunRpcPayloads['ontology.publish']);
    }
    return Promise.reject(failure('ACCESS_DENIED'));
  } };
  const firstRun = createFirstRunController(firstRunPort, { ...options.firstRun, guard: { live: firstRunLive } });
  const dictionaryDigest = options.firstRun?.digest ?? webCryptoDigest();
  firstRun.subscribe(() => {
    const shown = firstRun.snapshot();
    if (shown.kind !== 'left') verifiedHandoff = null;
    if (shown.kind !== 'published' || !firstRunLive()) return;
    if (state.context === null || !sameAuthority(state.context, shown.context)) { invalidate('ACCESS_DENIED'); return; }
    verifiedHandoff = shown.handoff;
    verifiedDictionary = Object.freeze({ contextKey: shown.context.contextKey, hash: shown.published.hash, version: shown.published.version, pack: shown.published.pack });
    publish({ ...state, context: shown.context });
  });
  firstRun.onIssuance(event => {
    if (event.kind === 'issued') invalidateProducer(true);
    if (event.kind === 'resolved') firstRunReopenAuthority = null;
  });
  function clearPrivate(keepTodayCapture = false) {
    const cleared = Symbol(); generation = cleared; receiptGeneration = Symbol(); settings = null;
    todayReader.invalidate(); receiptReader.invalidate(); conversation.invalidate(); retained.invalidate();
    if (keepTodayCapture) todayConsumer?.cancelSelection(); else todayConsumer?.invalidate();
    return cleared;
  }
  function invalidate(code: HostFailureCode = 'READ_INVALIDATED') {
    clearPrivate();
    verifiedHandoff = null;
    verifiedDictionary = null;
    acknowledgingRecovery = false;
    firstRun.invalidate(code === 'VAULT_LOCKED' ? 'VAULT_LOCKED' : code === 'INVALID_REPLY' ? 'INVALID_REPLY' : 'ACCESS_DENIED');
    conversation.invalidate(code as ConversationFailureCode);
    publish(emptyState(code === 'VAULT_LOCKED' ? 'locked' : 'unavailable', code));
  }
  function invalidateProducer(ownFirstRun = false) {
    if (!ownFirstRun) { invalidate('READ_INVALIDATED'); return; }
    // An issued publication has made all old producer views possibly stale. Keep only the seat
    // needed by its own checked readback; neither a figure nor a Saved view survives this boundary.
    clearPrivate();
    verifiedDictionary = null; producerBindingRequired = true;
    const retired = todayConsumer; todayConsumer = null; installedDashboard = null; retired?.dispose();
    publish({ ...state, today: null, routes: Object.freeze([]), selectedRouteId: null, receipt: null, todayConfiguration: 'not-configured' });
  }
  function bindTodayProducer(rawInput: unknown): boolean {
    const context = state.context, dictionary = verifiedDictionary;
    if (disposed || state.phase !== 'ready' || state.dictionaryReviewRequired || context === null || dictionary === null
      || dictionary.contextKey !== context.contextKey || firstRun.issuance() !== 'none') return false;
    let input: TodayProducerInput;
    try { input = validateTodayInput(rawInput); } catch { return false; }
    // A display alone cannot qualify a policy after publication. Missing input remains honest pending.
    if (input.display !== undefined && input.configuration === undefined) return false;
    if (input.configuration !== undefined) {
      const pack = input.configuration.starterPack;
      if (pack.id !== dictionary.pack || pack.dictionaryHash !== dictionary.hash || pack.version !== dictionary.version) return false;
    }
    clearPrivate();
    const token = generation;
    const retired = todayConsumer; todayConsumer = null; installedDashboard = null; retired?.dispose();
    if (!isCurrent(token) || state.phase !== 'ready' || state.context !== context || verifiedDictionary !== dictionary) return false;
    const replacement = createTodayConsumer(guardedPort, input, { context: () => state.phase === 'ready' ? state.context : null });
    todayConsumer = replacement;
    producerBindingRequired = input.display === undefined || input.configuration === undefined;
    publish({ ...state, today: null, receipt: null, selectedRouteId: null, todayConfiguration: configuredToday() });
    return isCurrent(token) && state.phase === 'ready' && state.context === context && todayConsumer === replacement && verifiedDictionary === dictionary;
  }
  async function refresh(creationPin: CreatedWorkspace | null = null) {
    if (disposed || creation.kind === 'creating' || creation.kind === 'unknown' || firstRun.issuance() !== 'none') return;
    if (creationPin !== null && (!acknowledgingRecovery || creation.kind !== 'recovery-required' || creation.value !== creationPin)) return;
    if (creationPin === null && acknowledgingRecovery) return;
    if (creation.kind === 'recovery-required' && creationPin === null) {
      const held = creation, token = generation;
      try {
        const current = await contextRead();
        if (!isCurrent(token) || creation !== held) return;
        if (current.workspace.id !== held.value.workspace.id || !['owner', 'cofounder'].includes(current.member.role)) throw failure('ACCESS_DENIED');
        // The kit is still held privately; only this fresh exact-workspace admin read releases it again.
        publish(emptyState('loading'));
      } catch (error) { if (isCurrent(token)) invalidate(readFailureCode(error)); }
      return;
    }
    // A local hide remains a hide. The held-kit branch alone may qualify its recovery release.
    if (state.phase === 'locked') return;
    const previousContext = state.context, previousRoute = state.selectedRouteId;
    firstRun.cancel(); verifiedHandoff = null;
    const token = clearPrivate(todayConsumer !== null);
    if (!isCurrent(token) || creationPin !== null && (!acknowledgingRecovery || creation.kind !== 'recovery-required' || creation.value !== creationPin)) return;
    publish(emptyState('loading'));
    if (!isCurrent(token) || creationPin !== null && (!acknowledgingRecovery || creation.kind !== 'recovery-required' || creation.value !== creationPin)) return;
    try {
      const context = await contextRead();
      if (!isCurrent(token)) return;
      if (creationPin !== null && (context.workspace.id !== creationPin.workspace.id || !['owner', 'cofounder'].includes(context.member.role))) throw failure('ACCESS_DENIED');
      const dictionary = validateOntologyReadback(await port.request('ontology.get', {}));
      if (!isCurrent(token)) return;
      if (dictionary.current !== null && !(await publishedVerified(dictionary.current, dictionaryDigest))) throw failure('INVALID_REPLY');
      if (!isCurrent(token)) return;
      const after = await contextRead();
      if (!isCurrent(token)) return;
      assertSameContext(after, context);
      if (creationPin !== null) {
        if (!acknowledgingRecovery || creation.kind !== 'recovery-required' || creation.value !== creationPin) return;
        creation = Object.freeze({ kind: 'idle' }); acknowledgingRecovery = false;
      }
      verifiedDictionary = dictionary.current === null ? null : Object.freeze({ contextKey: after.contextKey, hash: dictionary.current.hash, version: dictionary.current.version, pack: dictionary.current.pack });
      publish({ ...emptyState('ready'), context: after, dictionaryReviewRequired: dictionary.current === null,
        todayConfiguration: dictionary.current === null ? 'not-configured' : configuredToday() });
      if (dictionary.current === null) { todayConsumer?.invalidate(); return; }
      if (previousContext !== null && previousContext.contextKey !== after.contextKey || previousRoute !== null) todayConsumer?.invalidate();
      // Catalogue reads have no model test, preview or dispatch effect.
      const routes = validateModelRoutes(await guardedRequest('models.list', {}));
      if (!isCurrent(token)) return;
      publish({ ...state, routes });
      if (todayConsumer !== null) await todayConsumer.refresh(() => isCurrent(token));
      else if (installedDashboard !== null) {
        const today = await todayReader.dashboard(installedDashboard);
        if (!isCurrent(token)) return;
        if (!today.ok) { invalidate(today.code); return; }
        publish({ ...state, today: today.value });
      }
    } catch (error) { if (isCurrent(token)) invalidate(readFailureCode(error)); }
  }
  const refreshToday = () => refresh();
  async function requalifyFirstRunAfterReopen(): Promise<boolean> {
    const expected = firstRunReopenAuthority, token = generation;
    if (disposed || expected === null || firstRun.issuance() !== 'unresolved' || creation.kind !== 'idle') return false;
    try {
      const current = await contextRead();
      if (!isCurrent(token) || firstRunReopenAuthority !== expected || firstRun.issuance() !== 'unresolved') return false;
      if (!sameAuthority(current, expected)) { invalidate('ACCESS_DENIED'); return false; }
      const admitted = clearPrivate();
      if (!isCurrent(admitted) || firstRunReopenAuthority !== expected || firstRun.issuance() !== 'unresolved') return false;
      verifiedHandoff = null; verifiedDictionary = null;
      publish({ ...emptyState('ready'), context: current, dictionaryReviewRequired: true });
      return isCurrent(admitted) && state.phase === 'ready' && state.context === current && state.dictionaryReviewRequired && firstRun.issuance() === 'unresolved';
    } catch (error) { if (isCurrent(token)) invalidate(readFailureCode(error)); return false; }
  }
  function checkAuthority(): Promise<void> {
    if (authorityCheck !== null) return authorityCheck;
    const token = generation, expected = state.context;
    if (!isCurrent(token) || state.phase !== 'ready' || expected === null) return Promise.resolve();
    // The raw publication can intentionally replace this key. Its own receipt/context protocol
    // qualifies that change; a metadata poll must not erase the pending attempt or adopt a guess.
    authorityCheck = (async () => {
      try {
        const current = await contextRead();
        if (isCurrent(token)) {
          if (state.dictionaryReviewRequired && firstRun.issuance() !== 'none') {
            if (!sameAuthority(current, expected)) invalidate('ACCESS_DENIED');
          } else assertSameContext(current, expected);
        }
      }
      catch (error) { if (isCurrent(token)) invalidate(readFailureCode(error)); }
      finally { authorityCheck = null; }
    })();
    return authorityCheck;
  }
  function selectRoute(id: string | null) {
    if (disposed || state.phase !== 'ready' || state.context === null) return;
    const route = id === null ? null : state.routes.find(item => item.id === id && item.enabled);
    if (id !== null && route === undefined) { invalidate('INVALID_REPLY'); return; }
    // Route changes clear private draft/review/readback as a context replacement.
    clearPrivate();
    settings = route === null || route === undefined || state.context.member.role === 'viewer' ? null : Object.freeze({ purpose: 'conversation', questionDisclosure: 'verbatim', routeId: route.id });
    publish({ ...state, selectedRouteId: settings?.routeId ?? null, receipt: null });
    if (todayConsumer !== null) { const token = generation; void todayConsumer.refresh(() => isCurrent(token)); }
  }
  async function openReceipt(id: string, address: Address) {
    if (disposed || state.context === null || state.phase !== 'ready') return;
    let bound: Address;
    try { bound = Object.freeze(parseAddress(formatAddress(address))); if (bound.sheet === undefined || !sameAddress(bound, address)) throw failure('INVALID_REPLY'); }
    catch { invalidate('INVALID_REPLY'); return; }
    const token = generation, receiptToken = Symbol(); receiptGeneration = receiptToken;
    publish({ ...state, receipt: Object.freeze({ id, address: bound, kind: 'loading' }) });
    const read = await receiptReader.receipt(id);
    if (!isCurrent(token) || receiptGeneration !== receiptToken) return;
    if (!read.ok) {
      if (isEvidenceDenial(read.code) || read.code === 'INVALID_REPLY') invalidate(read.code);
      else publish({ ...state, receipt: Object.freeze({ id, address: bound, kind: 'failed', code: read.code }) });
      return;
    }
    publish({ ...state, receipt: Object.freeze({ id, address: bound, kind: 'ready', value: read.value }) });
  }
  function closeReceipt() { receiptGeneration = Symbol(); if (!disposed) publish({ ...state, receipt: null }); }
  async function lock() {
    if (disposed) return;
    const role = state.context?.member.role;
    invalidate('VAULT_LOCKED');
    // Every seat can clear its local screen; the existing Engine lock is admin-only.
    if (role !== 'owner' && role !== 'cofounder') return;
    try { await port.request('workspace.lock', {}); }
    catch (error) { if (!disposed) invalidate(readFailureCode(error)); }
  }
  function completeFirstRun(handoff: FirstRunHandoff): boolean {
    const current = state.context;
    if (!firstRunLive() || current === null || verifiedHandoff !== handoff || firstRun.snapshot().kind !== 'left'
      || firstRun.issuance() !== 'none' || current.workspace.id !== handoff.workspaceId || current.member.id !== handoff.memberId
      || current.contextKey !== handoff.contextKey || !['owner', 'cofounder'].includes(current.member.role)) return false;
    verifiedHandoff = null;
    clearPrivate();
    const token = generation;
    publish({ ...state, dictionaryReviewRequired: false, todayConfiguration: 'not-configured', today: null, routes: Object.freeze([]), selectedRouteId: null, receipt: null });
    // A synchronous subscriber can revoke the host while this state is released. It has the last word.
    try { return isCurrent(token) && state.phase === 'ready' && state.context === current && firstRun.snapshot().kind === 'left' && firstRunSurface?.() === true; }
    catch { return false; }
  }
  async function createWorkspace(input: WorkspaceCreateInput) {
    if (disposed || state.context !== null || state.phase !== 'locked' || !['idle', 'failed'].includes(creation.kind)) return;
    // Construct the exact deferred envelope. A caller's extra pack/demo fields never become own wire keys.
    const payload = { name: input.name, passphrase: input.passphrase, ...(input.folder === undefined ? {} : { folder: input.folder }), dictionaryMode: 'deferred' as const, demo: false as const };
    creation = Object.freeze({ kind: 'creating' }); const token = clearPrivate();
    if (!isCurrent(token)) { creation = Object.freeze({ kind: 'idle' }); publish(state); return; }
    publish(emptyState('loading'));
    if (!isCurrent(token)) { creation = Object.freeze({ kind: 'idle' }); publish(state); return; }
    try {
      const value = validateCreatedWorkspace(await port.request('workspace.create', payload));
      if (disposed) return;
      creation = Object.freeze({ kind: 'recovery-required', value });
      // The result belongs to the issued create even after a lock. Keep its sole kit privately;
      // an obsolete reply cannot restore its loading surface or release the kit to that surface.
      publish(isCurrent(token) ? emptyState('loading') : state);
    } catch (error) {
      if (disposed) return;
      const descriptor = error !== null && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
      creation = Object.freeze(descriptor?.value === 'INVALID_DICTIONARY_MODE' ? { kind: 'failed', code: 'INVALID_DICTIONARY_MODE' } : { kind: 'unknown', code: 'REQUEST_FAILED' });
      publish(isCurrent(token) ? emptyState('locked', 'VAULT_LOCKED') : state);
    }
  }
  async function acknowledgeRecovery(rendered: CreatedWorkspace): Promise<boolean> {
    if (disposed || state.phase !== 'loading' || creation.kind !== 'recovery-required' || creation.value !== rendered
      || state.creation !== creation || acknowledgingRecovery) return false;
    acknowledgingRecovery = true;
    await refresh(rendered);
    return recoveryAdmitted(rendered);
  }
  function recoveryAdmitted(rendered: CreatedWorkspace): boolean {
    return !disposed && creation.kind === 'idle' && state.phase === 'ready' && state.context?.workspace.id === rendered.workspace.id;
  }
  return Object.freeze({
    places: Object.freeze({ request: (method: string, payload: Record<string, unknown>) => disposed ? Promise.reject(failure('READ_INVALIDATED')) : (port as unknown as PlaceRpc).request(method, payload) }),
    conversation, retained, get todayConsumer() { return todayConsumer; }, firstRun, timeZone, snapshot: () => state,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh: () => refresh(), refreshToday, invalidateTrustedProducer: () => invalidateProducer(), bindTodayProducer, requalifyFirstRunAfterReopen, checkAuthority, selectRoute, questionSettings: () => settings, openReceipt, closeReceipt, invalidate, lock,
    setFirstRunSurface(live: (() => boolean) | null) { firstRunSurface = live; if (live === null) firstRun.cancel(); },
    completeFirstRun, createWorkspace, acknowledgeRecovery,
    dispose() {
      if (disposed) return Object.freeze({ ok: true });
      firstRun.cancel();
      if (creation.kind === 'creating') return Object.freeze({ ok: false, code: 'IN_FLIGHT' });
      if (creation.kind === 'recovery-required') return Object.freeze({ ok: false, code: 'PUBLISH_UNRESOLVED' });
      const ended = firstRun.dispose(); if (!ended.ok) return ended;
      firstRunSurface = null; clearPrivate(); todayConsumer?.dispose(); creation = Object.freeze({ kind: 'idle' });
      publish(emptyState('unavailable', 'READ_INVALIDATED')); disposed = true; listeners.clear();
      return Object.freeze({ ok: true });
    },
  });
}
