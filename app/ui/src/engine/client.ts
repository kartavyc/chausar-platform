/**
 * request(method, params) to the engine, over whichever transport this page runs on:
 *   desktop  window.chausar.request (app/desktop/preload.cjs), validated again in main.cjs
 *   web      POST /api/rpc { method, payload } with the pairing bearer (platform/runtime/server.ts)
 *   hosted   the same /api/rpc, bearer from GET /api/hosted/session (HttpOnly cookie behind it)
 * The bearer lives in memory only: it is never stored, and the pairing link's #token is removed from the address
 * at once. A transport failure sets the status line; an engine refusal stays with the request that caused it.
 */

import { createEventFeed, pageVisibility, type PageVisibility } from './events';
import { EngineError, type EngineClient, type EngineStatus, type HostedMeLite, type MethodName, type ParamsOf, type ResultOf, type Transport, type VentureRunEvent } from './types';

export interface ChausarBridge {
  request(method: string, payload?: unknown): Promise<unknown>;
  openExternal?(url: string): Promise<void>;
  /**
   * Desktop only (4D1): the owner picks one of their own network files and a desktop worker reads it on this computer;
   * text (what Chausar keeps) goes to venture.network.import { kind, name, text }. ownerAddresses: needed for mail.
   * ownerProfile: the owner's LinkedIn address, when a messages export cannot tell who they are. Null when cancelled.
   */
  pickNetworkFile?(kind: string, options?: { ownerAddresses?: string[]; ownerProfile?: string; timeZone?: string }): Promise<{
    kind: string; name: string; text: string; rows: number; people: number; dropped: [string, number][]; line: string;
  } | null>;
  /**
   * Desktop only (4J4): asks the engine for one month's CSV for the owner's CA (venture.money.export) and saves it where
   * the owner picks; the system save dialog asks before it replaces a file. EXPORT_EXISTS when a file appeared under the
   * picked name meanwhile; EXPORT_NOT_SAVED with plain words when the disk refused. Null when cancelled. On the web the
   * page downloads the engine's csv itself.
   */
  saveMoneyExport?(month: string): Promise<{ saved: true; name: string; receipts?: string; line: string } | null>;
  /** Desktop only (5A5): makes a draft's client report and saves its files in a new folder where the owner picks. Null when cancelled. */
  saveReport?(runId: string): Promise<{ saved: true; folder: string; line: string } | null>;
  saveYoutubeProject?(editId: string, digest: string): Promise<{ saved: true; savedId: string; folder: string; line: string } | null>;
  openYoutubeProject?(savedId: string): Promise<{ opened: true }>;
  pickAppTestApk?(orderId: string, fromClient: true, digest?: string): Promise<{ imported: true; orderId: string } | null>;
  saveSocialProject?(orderId: string, digest: string): Promise<{ saved: true; savedId: string; folder: string; line: string } | null>;
  openSocialProject?(savedId: string): Promise<{ opened: true }>;
  onEngineStatus?(callback: (status: { healthy: boolean; state: string }) => void): () => void;
  onEvent?(callback: (value: unknown) => void): () => void;
}

export interface ClientEnv {
  bridge?: ChausarBridge | undefined;
  fetch?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
  location?: { hash: string; pathname: string; search: string } | undefined;
  replaceUrl?: ((url: string) => void) | undefined;
  hosted?: boolean | undefined;
  /** The page's visibility (4G4): a hidden web page closes its event stream, so the owner stops counting as watching. */
  visibility?: PageVisibility | undefined;
}

const LOCAL_TOKEN = /^(?:[a-fA-F0-9]{64}|[A-Za-z0-9_-]{43})$/;
const HOSTED_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export function createStatusStore(initial: EngineStatus = { state: 'ok' }) {
  let current = initial;
  const listeners = new Set<(status: EngineStatus) => void>();
  return {
    get: () => current,
    set(next: EngineStatus) {
      if (JSON.stringify(next) === JSON.stringify(current)) return;
      current = next;
      for (const listener of [...listeners]) listener(current);
    },
    subscribe(listener: (status: EngineStatus) => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** The pairing link is `<origin>/#token=<code>`. Read it once and take it out of the address. */
function capturePairingToken(env: ClientEnv): string | null {
  const location = env.location;
  if (!location || !location.hash.startsWith('#') || location.hash.startsWith('#/')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const found = params.getAll('token');
  if (found.length === 0) return null;
  env.replaceUrl?.(`${location.pathname}${location.search}#/today`);
  const token = found.length === 1 ? found[0]! : '';
  return LOCAL_TOKEN.test(token) ? token : null;
}

/**
 * W4 4J21: the hosted session view's `me`, only what the Ink app reads: the server's trials switch and the temporary
 * business's view (4J23, hosted/trial.ts trialView). Anything not in that shape is null: nothing is guessed.
 */
export function hostedMeOf(value: unknown): HostedMeLite | null {
  if (!value || typeof value !== 'object') return null;
  const me = value as { trials?: unknown; trial?: unknown };
  if (typeof me.trials !== 'boolean') return null;
  const trial = me.trial as Record<string, unknown> | null | undefined;
  if (trial === null || trial === undefined) return { trials: me.trials, trial: null };
  const ok = typeof trial === 'object' && trial.temporary === true && typeof trial.line === 'string' && typeof trial.expiresAt === 'string'
    && typeof trial.endsSoon === 'boolean' && (trial.warning === null || typeof trial.warning === 'string');
  return ok ? { trials: me.trials, trial: { temporary: true, line: trial.line as string, expiresAt: trial.expiresAt as string, endsSoon: trial.endsSoon as boolean, warning: trial.warning as string | null } } : { trials: me.trials, trial: null };
}

function asEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return error;
  const e = error as { code?: unknown; message?: unknown; reason?: unknown } | null;
  return new EngineError(typeof e?.code === 'string' ? e.code : 'REQUEST_FAILED', typeof e?.message === 'string' ? e.message : 'The engine could not complete the request.', typeof e?.reason === 'string' ? e.reason : undefined);
}

export function createEngineClient(env: ClientEnv = browserEnv()): EngineClient {
  const bridge = env.bridge;
  const transport: Transport = bridge ? 'desktop' : env.hosted ? 'hosted' : 'web';
  const hashToken = bridge ? null : capturePairingToken(env);
  let localToken: string | null = transport === 'web' ? hashToken : null;
  let hostedToken: string | null = null;
  const status = createStatusStore(transport === 'web' && !localToken ? { state: 'unpaired' } : { state: 'ok' });

  if (bridge?.onEngineStatus) {
    bridge.onEngineStatus(({ state }) => {
      if (state === 'ready') status.set({ state: 'ok' });
      else if (state === 'starting') status.set({ state: 'starting' });
      else status.set({ state: 'offline' });
    });
  }

  async function bearer(): Promise<string | null> {
    if (transport === 'web') return localToken;
    if (hostedToken) return hostedToken;
    try {
      const response = await env.fetch!('/api/hosted/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      const body = (await response.json()) as { token?: unknown };
      hostedToken = typeof body.token === 'string' && HOSTED_TOKEN.test(body.token) ? body.token : null;
      return hostedToken;
    } catch {
      status.set({ state: 'offline' });
      return null;
    }
  }

  /** GET /api/hosted/session again for its `me`; the bearer it carries is kept too, as bearer() keeps it. */
  async function hostedSessionMe(): Promise<HostedMeLite | null> {
    try {
      const response = await env.fetch!('/api/hosted/session', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return null;
      const body = (await response.json()) as { token?: unknown; me?: unknown };
      if (typeof body.token === 'string' && HOSTED_TOKEN.test(body.token)) hostedToken = body.token;
      return hostedMeOf(body.me);
    } catch {
      return null;
    }
  }

  async function overDesktop(method: string, params: unknown): Promise<unknown> {
    try {
      const result = await bridge!.request(method, params);
      if (status.get().state === 'offline' || status.get().state === 'starting') status.set({ state: 'ok' });
      return result;
    } catch (error) {
      const e = asEngineError(error);
      if (e.code.startsWith('ENGINE_')) status.set({ state: 'offline' });
      throw e;
    }
  }

  async function overHttp(method: string, params: unknown): Promise<unknown> {
    const token = await bearer();
    if (!token) {
      if (status.get().state !== 'offline') status.set(transport === 'web' && !hashToken ? { state: 'unpaired' } : { state: 'session-ended' });
      throw new EngineError('UNAUTHENTICATED', 'This browser is not connected to the engine.');
    }
    let response: Response;
    try {
      response = await env.fetch!('/api/rpc', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ method, payload: params }),
      });
    } catch {
      status.set({ state: 'offline' });
      throw new EngineError('OFFLINE', 'The engine is not answering.');
    }
    type Reply = { result?: unknown; error?: { code?: string; message?: string; reason?: string } };
    let body: Reply | null = null;
    try { body = (await response.json()) as Reply; } catch { body = null; }
    if (response.status === 401) {
      if (transport === 'web') localToken = null; else hostedToken = null;
      status.set({ state: 'session-ended' });
      throw new EngineError('UNAUTHENTICATED', body?.error?.message ?? 'This session ended.');
    }
    if (body?.error) {
      status.set({ state: 'ok' });
      throw asEngineError(body.error);
    }
    if (!response.ok || !body) {
      const message = `HTTP ${response.status}`;
      status.set({ state: 'error', message });
      throw new EngineError('HTTP_ERROR', message);
    }
    status.set({ state: 'ok' });
    return body.result;
  }

  const client: EngineClient = {
    transport,
    request<M extends MethodName>(method: M, params?: ParamsOf<M>): Promise<ResultOf<M>> {
      const payload = params ?? {};
      return (bridge ? overDesktop(method, payload) : overHttp(method, payload)) as Promise<ResultOf<M>>;
    },
    subscribe(listener: (event: VentureRunEvent) => void) { return feed.subscribe(listener); },
    status: () => status.get(),
    onStatus: (listener) => status.subscribe(listener),
    // 4D4: the desktop's file pick for the network import, with its refusals as engine errors.
    ...(bridge?.pickNetworkFile ? { pickNetworkFile: (kind, options) => bridge.pickNetworkFile!(kind, options).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // 4J21: the hosted server's `me` (trials switch, temporary business), read again with the session each time.
    ...(transport === 'hosted' ? { hostedMe: hostedSessionMe } : {}),
    // 4J20: Export for your CA saved by the desktop, with its refusals as engine errors.
    ...(bridge?.saveMoneyExport ? { saveMoneyExport: (month: string) => bridge.saveMoneyExport!(month).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // 5A5: a client report saved by the desktop through the atomic export, with its refusals as engine errors.
    ...(bridge?.saveReport ? { saveReport: (runId: string) => bridge.saveReport!(runId).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.saveYoutubeProject ? { saveYoutubeProject: (editId: string, digest: string) => bridge.saveYoutubeProject!(editId, digest).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.pickAppTestApk ? { pickAppTestApk: (orderId: string, fromClient: true, digest?: string) => bridge.pickAppTestApk!(orderId, fromClient, digest).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.openYoutubeProject ? { openYoutubeProject: (savedId: string) => bridge.openYoutubeProject!(savedId).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.saveSocialProject ? { saveSocialProject: (orderId: string, digest: string) => bridge.saveSocialProject!(orderId, digest).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.openSocialProject ? { openSocialProject: (savedId: string) => bridge.openSocialProject!(savedId).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
  };
  const feed = createEventFeed({
    onEvent: bridge?.onEvent ? (callback) => bridge.onEvent!(callback) : undefined,
    request: (method, params) => client.request(method, params),
    sse: bridge ? undefined : { fetch: env.fetch!, bearer },
    visibility: bridge ? undefined : env.visibility,
  });
  return client;
}

export function browserEnv(): ClientEnv {
  const w = window as Window & { chausar?: ChausarBridge };
  const hosted = [...document.head.querySelectorAll('meta[name="chausar-mode"]')].some((m) => m.getAttribute('content') === 'hosted');
  return {
    bridge: w.chausar && typeof w.chausar.request === 'function' ? w.chausar : undefined,
    fetch: window.fetch.bind(window),
    location: window.location,
    replaceUrl: (url) => window.history.replaceState(null, '', url),
    hosted,
    visibility: pageVisibility(document),
  };
}
