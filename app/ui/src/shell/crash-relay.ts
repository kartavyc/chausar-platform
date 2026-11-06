import type { EngineClient } from '../engine/types';

/** At most this many crashes a session go to the engine; a crash loop never floods it. */
const MOST = 5;

/**
 * W6 6J2 (D47): the app window passes an uncaught error or rejection to the engine (venture.feedback.crash). The engine
 * keeps it, scrubbed of names, paths, numbers and keys, only while the owner has crash reports on, and nothing leaves
 * until Send report. The relay never throws and never retries. Returns a stop function.
 */
export function startCrashRelay(client: Pick<EngineClient, 'request'>, target: EventTarget = window): () => void {
  let count = 0;
  const pass = (error: unknown, fallback: string) => {
    if (count >= MOST) return;
    count += 1;
    const known = error instanceof Error ? error : null;
    const params = { source: 'window' as const, name: known?.name ?? 'Error', message: (known?.message ?? fallback).slice(0, 8000), ...(known?.stack ? { stack: known.stack.slice(0, 40000) } : {}) };
    try { void Promise.resolve(client.request('venture.feedback.crash', params)).catch(() => {}); } catch { /* the relay never fails on its own */ }
  };
  const onError = (event: Event) => { const e = event as ErrorEvent; pass(e.error, typeof e.message === 'string' ? e.message : 'Error'); };
  const onRejection = (event: Event) => pass((event as PromiseRejectionEvent).reason, 'Unhandled rejection');
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => { target.removeEventListener('error', onError); target.removeEventListener('unhandledrejection', onRejection); };
}
