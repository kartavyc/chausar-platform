/**
 * request(method, params) to the engine, over whichever transport this page runs on:
 *   desktop  window.chausar.request (app/desktop/preload.cjs), validated again in main.cjs
 *   web      POST /api/rpc { method, payload } with the pairing bearer (platform/runtime/server.ts)
 *   hosted   the same /api/rpc, bearer from GET /api/hosted/session (HttpOnly cookie behind it)
 * The bearer lives in memory only: it is never stored, and the pairing link's #token is removed from the address
 * at once. A transport failure sets the status line; an engine refusal stays with the request that caused it.
 */

import { createEventFeed } from './events';
import { EngineError, type EngineClient, type EngineStatus, type MethodName, type ParamsOf, type ResultOf, type Transport, type VentureRunEvent } from './types';

export interface ChausarBridge {
  request(method: string, payload?: unknown): Promise<unknown>;
  openExternal?(url: string): Promise<void>;
  onEngineStatus?(callback: (status: { healthy: boolean; state: string }) => void): () => void;
  onEvent?(callback: (value: unknown) => void): () => void;
}

export interface ClientEnv {
  bridge?: ChausarBridge | undefined;
  fetch?: ((url: string, init?: RequestInit) => Promise<Response>) | undefined;
  location?: { hash: string; pathname: string; search: string } | undefined;
  replaceUrl?: ((url: string) => void) | undefined;
  hosted?: boolean | undefined;
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
  };
  const feed = createEventFeed({
    onEvent: bridge?.onEvent ? (callback) => bridge.onEvent!(callback) : undefined,
    request: (method, params) => client.request(method, params),
    sse: bridge ? undefined : { fetch: env.fetch!, bearer },
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
  };
}
