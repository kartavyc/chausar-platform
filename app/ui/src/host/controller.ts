/** Additive host composition. Only an injected trusted RPC port owns transport. */
import { createDesktopReceiptReader, isEvidenceDenial, readFailureCode } from '../bridge/client.ts';
import type { ReadFailureCode } from '../bridge/contract.ts';
import type { CalculationReceiptEvidence } from '../bridge/presentation.ts';
import { createDesktopTodayReader } from '../bridge/today-host.ts';
import type { DashboardTodayInput, TodayHostProjection } from '../bridge/today-host.ts';
import { createConversationHost } from '../bridge/conversation-host.ts';
import type { ConversationFailureCode, ConversationHost } from '../bridge/conversation-host.ts';
import type { ConversationQuestionSettings } from '../app/conversation-surface.ts';
import type { Address } from '../app/presentation.ts';
import { formatAddress, parseAddress, sameAddress } from '../app/routes.ts';
import { validateModelRoutes, validateUiContext } from './contracts.ts';
import type { HostRpcPayloads, HostRpcPort, UiContext, UiModelRoute } from './contracts.ts';
import { createRetainedController } from './retained-controller.ts';
import type { EffectGuard, RetainedController, RetainedPort } from './retained-controller.ts';

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
}
export interface HostOptions { readonly now?: () => number; readonly timeZone?: string }
export interface HostController {
  readonly conversation: ConversationHost;
  /** Retained scenario reopen and lesson review, joined to every host invalidation. */
  readonly retained: RetainedController;
  readonly timeZone: string;
  snapshot(): HostState;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  /** Trusted focus/status/poll hooks reread metadata only, never calculations. */
  checkAuthority(): Promise<void>;
  /** A catalogue route is chosen by an explicit user intent, never its priority. */
  selectRoute(id: string | null): void;
  questionSettings(): ConversationQuestionSettings | null;
  openReceipt(id: string, address: Address): Promise<void>;
  closeReceipt(): void;
  invalidate(code?: HostFailureCode): void;
  lock(): Promise<void>;
  dispose(): void;
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
const emptyState = (phase: HostState['phase'], code?: HostFailureCode): HostState => Object.freeze({ phase, ...(code === undefined ? {} : { code }), context: null, today: null, routes: Object.freeze([]), selectedRouteId: null, receipt: null });

export function createHostController(port: HostRpcPort, options: HostOptions = {}): HostController {
  const now = options.now ?? Date.now;
  const timeZone = options.timeZone ?? 'UTC';
  // Reject an invalid host timezone before issuing any RPC.
  new Intl.DateTimeFormat('en', { timeZone });
  let state = emptyState('loading');
  let generation = Symbol(), receiptGeneration = Symbol(), disposed = false;
  let authorityCheck: Promise<void> | null = null;
  let settings: ConversationQuestionSettings | null = null;
  const listeners = new Set<() => void>();
  function publish(value: HostState) { if (!disposed) { state = Object.freeze(value); for (const listener of listeners) listener(); } }
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
   * read before and after it. A retained operation additionally carries its own live guard (surface,
   * generation, selection): it is reread after the inner context read, immediately before the raw
   * transport call, so a departure during that read issues nothing; the guard is told the moment the
   * raw call is actually issued. The wire method and payload are unchanged.
   */
  async function guardedRequest<M extends keyof HostRpcPayloads>(method: M, payload: HostRpcPayloads[M], guard?: EffectGuard): Promise<unknown> {
    const token = generation, expected = state.context;
    if (!isCurrent(token) || expected === null || state.phase !== 'ready') throw failure('ACCESS_DENIED');
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
      if (!isCurrent(token)) throw failure('READ_INVALIDATED');
      const after = await contextRead();
      if (!isCurrent(token)) throw failure('READ_INVALIDATED');
      assertSameContext(after, expected);
      return value;
    } catch (error) {
      const code = readFailureCode(error);
      if (isCurrent(token) && (isEvidenceDenial(code) || code === 'INVALID_REPLY')) invalidate(code);
      throw error;
    }
  }
  // The same seam under two names: the generic guarded port for the existing readers, and the retained
  // port whose every call must carry its guard to the raw boundary.
  const guardedPort: HostRpcPort & RetainedPort = { request: guardedRequest, guarded: guardedRequest };
  const todayReader = createDesktopTodayReader(guardedPort);
  const receiptReader = createDesktopReceiptReader(guardedPort);
  const conversation = createConversationHost(guardedPort, { now });
  const retained = createRetainedController(guardedPort, { context: () => (state.phase === 'ready' ? state.context : null) });
  function clearPrivate() {
    generation = Symbol(); receiptGeneration = Symbol(); settings = null;
    todayReader.invalidate(); receiptReader.invalidate(); conversation.invalidate(); retained.invalidate();
  }
  function invalidate(code: HostFailureCode = 'READ_INVALIDATED') {
    clearPrivate();
    conversation.invalidate(code as ConversationFailureCode);
    publish(emptyState(code === 'VAULT_LOCKED' ? 'locked' : 'unavailable', code));
  }
  async function refresh() {
    if (disposed || state.phase === 'locked') return;
    clearPrivate(); publish(emptyState('loading'));
    const token = generation;
    try {
      const context = await contextRead();
      if (!isCurrent(token)) return;
      publish({ ...emptyState('ready'), context });
      const calendar = currentMonth(now(), timeZone);
      const input: DashboardTodayInput = {
        title: 'Today', date: calendar.date, request: { period: calendar.period },
        selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }],
      };
      const today = await todayReader.dashboard(input);
      if (!isCurrent(token)) return;
      if (!today.ok) { invalidate(today.code); return; }
      // Catalogue reads have no model test, preview or dispatch effect.
      const routes = validateModelRoutes(await guardedRequest('models.list', {}));
      if (!isCurrent(token)) return;
      publish({ ...state, today: today.value, routes });
    } catch (error) { if (isCurrent(token)) invalidate(readFailureCode(error)); }
  }
  function checkAuthority(): Promise<void> {
    if (authorityCheck !== null) return authorityCheck;
    const token = generation, expected = state.context;
    if (!isCurrent(token) || state.phase !== 'ready' || expected === null) return Promise.resolve();
    authorityCheck = (async () => {
      try { const current = await contextRead(); if (isCurrent(token)) assertSameContext(current, expected); }
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
  return Object.freeze({
    conversation, retained, timeZone, snapshot: () => state,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh, checkAuthority, selectRoute, questionSettings: () => settings, openReceipt, closeReceipt, invalidate, lock,
    dispose() { if (disposed) return; clearPrivate(); publish(emptyState('unavailable', 'READ_INVALIDATED')); disposed = true; listeners.clear(); },
  });
}
