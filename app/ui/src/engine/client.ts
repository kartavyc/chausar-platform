/**
 * request(method, params) to the engine, over whichever transport this page runs on:
 *   desktop  window.chausar.request (app/desktop/preload.cjs), validated again in main.cjs
 *   web      POST /api/rpc { method, payload } with the pairing bearer (platform/runtime/server.ts)
 *   hosted   the same /api/rpc, bearer from GET /api/hosted/session (HttpOnly cookie behind it)
 * The bearer lives in memory only: it is never stored, and the pairing link's #token is removed from the address
 * at once. A transport failure sets the status line; an engine refusal stays with the request that caused it.
 */

import type { BackupCopyLite, CopyImportInput, CopyImportResult, PackShareResult } from './types';
import { createEventFeed, pageVisibility, type PageVisibility } from './events';
import { errorLine, ownerError } from './owner-errors';
import { EngineError, type BackgroundStateLite, type DiagnosticsPreview, type EngineClient, type EngineStatus, type HostedMeLite, type InvoiceShareResult, type MethodName, type ParamsOf, type ResultOf, type Transport, type VentureRunEvent } from './types';

export interface ChausarBridge {
  request(method: string, payload?: unknown): Promise<unknown>;
  /** C5 task 32, desktop only: shows the downloaded installer, checked again first. */
  showUpdateInstaller?(kind: 'staged'): Promise<void>;
  /** C5 task 27, desktop only: what Export diagnostics would save; then that preview saved, by its id. Null when cancelled. */
  previewDiagnostics?(dumps: boolean): Promise<DiagnosticsPreview>;
  saveDiagnostics?(id: string): Promise<{ saved: true; name: string; line: string } | null>;
  /** C5 task 26, desktop only: says once that the page has painted (shell/first-paint.ts). */
  firstPaint?(): Promise<unknown>;
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
  saveMoneyExport?(month: string, format?: string): Promise<{ saved: true; name: string; receipts?: string; line: string } | null>;
  saveBriefFile?(builder: string): Promise<{ saved: true; name: string; companion: string } | null>;
  pickCopy?(): Promise<{ token: string; name: string } | null>;
  importCopy?(input: unknown): Promise<unknown>;
  setBackupFolder?(action: string): Promise<unknown>;
  /** Desktop only (review of A1, row 1): shows a kept export in the file manager, by its file name. */
  showExport?(name: string): Promise<void>;
  /** Desktop only (one-shot A6): Email it or Share on WhatsApp on an invoice, and the kept file shown in its folder. */
  shareInvoice?(invoiceId: string, how: string): Promise<unknown>;
  /** C5 task 16: Send to my CA. */
  sharePack?(month: string, how: string): Promise<unknown>;
  showShared?(name: string): Promise<void>;
  /** Desktop only (one-shot A5): start at login and keep running, read back from this computer (background.cjs). */
  getBackground?(): Promise<unknown>;
  setBackground?(update: { startAtLogin?: boolean; keepRunning?: boolean }): Promise<unknown>;
  /** Desktop only (A5 fix round 3): the day the owner put the start-at-login question aside. */
  getAskLater?(): Promise<unknown>;
  setAskLater?(day: string): Promise<void>;
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
const PAIR_CODE = /^[A-Za-z0-9_-]{43}$/;

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

/**
 * The pairing link is `<origin>/#token=<code>`; a phone's (W6 6F7) is `<origin>/#pair=<one-time code>`. Read it once and
 * take it out of the address.
 */
function capturePairingToken(env: ClientEnv, name: 'token' | 'pair' = 'token'): string | null {
  const location = env.location;
  if (!location || !location.hash.startsWith('#') || location.hash.startsWith('#/')) return null;
  const params = new URLSearchParams(location.hash.slice(1));
  const found = params.getAll(name);
  if (found.length === 0) return null;
  env.replaceUrl?.(`${location.pathname}${location.search}#/today`);
  const token = found.length === 1 ? found[0]! : '';
  return (name === 'pair' ? PAIR_CODE : LOCAL_TOKEN).test(token) ? token : null;
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

/** One-shot A5: the desktop's start-at-login state, checked field by field; anything else reads as not here. */
function backgroundState(value: unknown): BackgroundStateLite {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const flag = (key: string) => v[key] === true;
  return { supported: flag('supported'), asked: flag('asked'), startAtLogin: flag('startAtLogin'), keepRunning: flag('keepRunning'), registered: flag('registered'), systemOff: flag('systemOff') };
}

/** A6: the desktop's answer to a share, read field by field; anything else is a failed share, never a claim it opened. */
function shareResult(value: unknown): InvoiceShareResult {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const file = typeof v.file === 'string' && /^[A-Za-z0-9-]{1,80}\.(?:pdf|html)$/.test(v.file) ? v.file : null;
  const note = typeof v.note === 'string' ? v.note : null;
  if (file && v.how === 'email' && (v.opened === 'draft' || v.opened === 'link' || v.opened === 'none')) return { how: 'email', opened: v.opened, file, attached: typeof v.attached === 'string' && /^[A-Za-z0-9-]{1,80}\.(?:pdf|html)$/.test(v.attached) ? v.attached : file, to: v.to === true, note };
  if (file && v.how === 'whatsapp' && (v.opened === 'app' || v.opened === 'web')) return { how: 'whatsapp', opened: v.opened, file, note };
  throw new EngineError('REQUEST_FAILED', 'The desktop could not share the invoice.');
}

/** B1 fix round 1: the transport's owner flag goes on with the words (owner-errors.ts). */
function asEngineError(error: unknown): EngineError {
  if (error instanceof EngineError) return ownerError(error);
  const e = error as { code?: unknown; message?: unknown; reason?: unknown; owner?: unknown } | null;
  return ownerError({ code: typeof e?.code === 'string' ? e.code : 'REQUEST_FAILED', message: typeof e?.message === 'string' ? e.message : 'The request did not finish.', reason: e?.reason, owner: e?.owner });
}

export function createEngineClient(env: ClientEnv = browserEnv()): EngineClient {
  const bridge = env.bridge;
  const transport: Transport = bridge ? 'desktop' : env.hosted ? 'hosted' : 'web';
  const hashToken = bridge ? null : capturePairingToken(env);
  let localToken: string | null = transport === 'web' ? hashToken : null;
  // W6 6F7: a phone's one-time pairing code, traded once at /api/phone/pair for a phone session kept in memory only.
  let pairCode: string | null = transport === 'web' && !hashToken ? capturePairingToken(env, 'pair') : null;
  let hostedToken: string | null = null;
  const status = createStatusStore(transport === 'web' && !localToken && !pairCode ? { state: 'unpaired' } : { state: 'ok' });

  if (bridge?.onEngineStatus) {
    bridge.onEngineStatus(({ state }) => {
      if (state === 'ready') status.set({ state: 'ok' });
      else if (state === 'starting') status.set({ state: 'starting' });
      else if (state === 'reconnecting') status.set({ state: 'reconnecting' });
      else status.set({ state: 'offline' });
    });
  }

  let pairing: Promise<void> | null = null;
  async function tradePairCode(code: string): Promise<void> {
    let response: Response;
    try {
      response = await env.fetch!('/api/phone/pair', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    } catch {
      status.set({ state: 'offline' });
      throw new EngineError('OFFLINE', errorLine('client.phoneOffline'), undefined, true);
    }
    const body = (await response.json().catch(() => null)) as { token?: unknown; error?: { code?: string; message?: string } } | null;
    if (response.ok && typeof body?.token === 'string' && LOCAL_TOKEN.test(body.token)) { localToken = body.token; return; }
    status.set({ state: 'unpaired' });
    throw asEngineError(body?.error ?? { code: 'UNAUTHENTICATED', message: errorLine('client.pairFailed'), owner: true });
  }

  async function bearer(): Promise<string | null> {
    // Every request that starts while the code is being traded waits for the one trade.
    if (transport === 'web' && pairCode) { const code = pairCode; pairCode = null; pairing = tradePairCode(code); }
    if (transport === 'web' && pairing) { const trade = pairing; try { await trade; } finally { if (pairing === trade) pairing = null; } }
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
      // C5 task 29: while the desktop restarts its worker, a refused request changes nothing: the status line says why.
      if (e.code.startsWith('ENGINE_') && status.get().state !== 'reconnecting') status.set({ state: 'offline' });
      throw e;
    }
  }

  async function overHttp(method: string, params: unknown): Promise<unknown> {
    const token = await bearer();
    if (!token) {
      if (status.get().state !== 'offline') status.set(transport === 'web' && !hashToken ? { state: 'unpaired' } : { state: 'session-ended' });
      throw new EngineError('UNAUTHENTICATED', errorLine('client.unpaired'), undefined, true);
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
      throw new EngineError('OFFLINE', errorLine('client.offline'), undefined, true);
    }
    type Reply = { result?: unknown; error?: { code?: string; message?: string; reason?: string; owner?: unknown } };
    let body: Reply | null = null;
    try { body = (await response.json()) as Reply; } catch { body = null; }
    if (response.status === 401) {
      if (transport === 'web') localToken = null; else hostedToken = null;
      status.set({ state: 'session-ended' });
      // B1 fix round 1: the server's own words (the trial-ended line) as sent; else this page's.
      throw ownerError(body?.error?.message ? { code: 'UNAUTHENTICATED', message: body.error.message, owner: body.error.owner } : { code: 'UNAUTHENTICATED', message: errorLine('client.sessionEnded'), owner: true });
    }
    if (body?.error) {
      status.set({ state: 'ok' });
      throw asEngineError(body.error);
    }
    if (!response.ok || !body) {
      // B1 fix round 2: the status code stays out of the owner's words; the line is the page's own (errors.json).
      const message = errorLine('client.noAnswer');
      status.set({ state: 'error', message });
      throw new EngineError('HTTP_ERROR', message, undefined, true);
    }
    status.set({ state: 'ok' });
    return body.result;
  }

  const client: EngineClient = {
    transport,
    request<M extends MethodName>(method: M, params?: ParamsOf<M>): Promise<ResultOf<M>> {
      const payload = params ?? {};
      // One-shot B1: a refusal reaches the page in the owner's words (owner-errors.ts), with its code kept.
      return (bridge ? overDesktop(method, payload) : overHttp(method, payload)).catch((error: unknown) => { throw ownerError(error); }) as Promise<ResultOf<M>>;
    },
    subscribe(listener: (event: VentureRunEvent) => void) { return feed.subscribe(listener); },
    status: () => status.get(),
    onStatus: (listener) => status.subscribe(listener),
    // 4D4: the desktop's file pick for the network import, with its refusals as engine errors.
    ...(bridge?.pickNetworkFile ? { pickNetworkFile: (kind, options) => bridge.pickNetworkFile!(kind, options).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // 4J21: the hosted server's `me` (trials switch, temporary business), read again with the session each time.
    ...(transport === 'hosted' ? { hostedMe: hostedSessionMe } : {}),
    // 4J20: Export for your CA saved by the desktop, with its refusals as engine errors.
    ...(bridge?.saveMoneyExport ? { saveMoneyExport: (month: string, format?: string) => (format === undefined ? bridge.saveMoneyExport!(month) : bridge.saveMoneyExport!(month, format)).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // C5 tasks 21, 23: an exported copy and a backup folder, picked by main, with its refusals as engine errors.
    ...(bridge?.saveBriefFile ? { saveBriefFile: (builder: string) => bridge.saveBriefFile!(builder).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.showUpdateInstaller ? { showUpdateInstaller: (kind: 'staged') => bridge.showUpdateInstaller!(kind).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.previewDiagnostics ? { previewDiagnostics: (dumps: boolean) => bridge.previewDiagnostics!(dumps).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.saveDiagnostics ? { saveDiagnostics: (id: string) => bridge.saveDiagnostics!(id).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.pickCopy ? { pickCopy: () => bridge.pickCopy!().catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.importCopy ? { importCopy: (input: CopyImportInput) => bridge.importCopy!(input).then((value) => value as CopyImportResult, (error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.setBackupFolder ? { setBackupFolder: (action: 'pick' | 'clear') => bridge.setBackupFolder!(action).then((value) => value as { copy: BackupCopyLite | null } | null, (error: unknown) => { throw asEngineError(error); }) } : {}),
    // Review of A1 (row 1): a kept export shown in the file manager, with its refusals as engine errors.
    ...(bridge?.showExport ? { showExport: (name: string) => bridge.showExport!(name).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // One-shot A6: an invoice shared through the owner's own apps, and its file shown, with the desktop's refusals as engine errors.
    ...(bridge?.sharePack ? { sharePack: (month: string, how: 'email' | 'whatsapp') => bridge.sharePack!(month, how).then((value) => value as PackShareResult, (error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.shareInvoice ? { shareInvoice: (invoiceId: string, how: 'email' | 'whatsapp') => bridge.shareInvoice!(invoiceId, how).then(shareResult, (error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.showShared ? { showShared: (name: string) => bridge.showShared!(name).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    // One-shot A5: start at login and keep running, with the desktop's refusals as engine errors.
    ...(bridge?.getBackground ? { getBackground: () => bridge.getBackground!().then(backgroundState, (error: unknown) => { throw asEngineError(error); }) } : {}),
    // A5 fix round 3: the day the owner put the question aside; anything but a day reads as never.
    ...(bridge?.getAskLater ? { getAskLater: () => bridge.getAskLater!().then((day) => (typeof day === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day) ? day : null), (error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.setAskLater ? { setAskLater: (day: string) => bridge.setAskLater!(day).catch((error: unknown) => { throw asEngineError(error); }) } : {}),
    ...(bridge?.setBackground ? { setBackground: (update: { startAtLogin?: boolean; keepRunning?: boolean }) => bridge.setBackground!(update).then(backgroundState, (error: unknown) => { throw asEngineError(error); }) } : {}),
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
