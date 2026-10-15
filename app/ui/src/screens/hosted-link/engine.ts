/**
 * Engine reads and changes for the hosted-link screens, only through the host's `rpc`.
 * A read is loading, ready, not built, locked or failed; a reread that fails keeps what was
 * read before and marks it stale. A reply that arrives after the person left the address is
 * dropped. A change is one press, one request, its outcome kept for the screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScreenState } from '../../app/presentation.ts';
import type { PlaceRpc } from '../../places/types.ts';

export type Read<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T; readonly staleCode: string | null }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'failed'; readonly code: string };

export type Sent<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'sending' }
  | { readonly kind: 'done'; readonly value: T }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'refused'; readonly code: string };

/** The design's "not built yet": the method does not exist in this engine. */
export const NOT_BUILT_CODES: ReadonlySet<string> = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);
const LOCKED_CODES: ReadonlySet<string> = new Set(['VAULT_LOCKED', 'WORKSPACE_LOCKED', 'LOCKED', 'NO_WORKSPACE']);

export function errorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

export function screenState(read: Read<unknown>): ScreenState {
  switch (read.kind) {
    case 'loading': return { kind: 'loading' };
    case 'not-built': return { kind: 'not-built' };
    case 'locked': return { kind: 'locked' };
    case 'failed': return { kind: 'failed', code: read.code };
    case 'ready': return { kind: 'ready' };
  }
}

export function useRead<T>(rpc: PlaceRpc, method: string, payload: Record<string, unknown>, validate: (reply: unknown) => T):
  { read: Read<T>; reload: () => void } {
  const [read, setRead] = useState<Read<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const body = JSON.stringify(payload);
  useEffect(() => {
    const ticket = ++latest.current;
    let alive = true;
    setRead((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    const settle = (next: (prev: Read<T>) => Read<T>) => { if (alive && ticket === latest.current) setRead(next); };
    rpc.request(method, JSON.parse(body) as Record<string, unknown>).then(
      (reply) => {
        let value: T;
        try { value = validate(reply); } catch (error) { settle(() => ({ kind: 'failed', code: errorCode(error) })); return; }
        settle(() => ({ kind: 'ready', value, staleCode: null }));
      },
      (error: unknown) => {
        const code = errorCode(error);
        settle((prev) => {
          if (NOT_BUILT_CODES.has(code)) return { kind: 'not-built' };
          if (LOCKED_CODES.has(code)) return { kind: 'locked' };
          return prev.kind === 'ready' ? { ...prev, staleCode: code } : { kind: 'failed', code };
        });
      },
    );
    return () => { alive = false; };
    // validate is a module-level function for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, method, body, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { read, reload };
}

export function useSend<T>(rpc: PlaceRpc, validate: (reply: unknown) => T):
  { sent: Sent<T>; send: (method: string, payload: Record<string, unknown>) => Promise<T | null>; clear: () => void } {
  const [sent, setSent] = useState<Sent<T>>({ kind: 'idle' });
  const busy = useRef(false);
  const send = useCallback(async (method: string, payload: Record<string, unknown>) => {
    if (busy.current) return null;
    busy.current = true; setSent({ kind: 'sending' });
    try {
      const value = validate(await rpc.request(method, payload));
      setSent({ kind: 'done', value }); return value;
    } catch (error) {
      const code = errorCode(error);
      setSent(NOT_BUILT_CODES.has(code) ? { kind: 'not-built' } : { kind: 'refused', code }); return null;
    } finally { busy.current = false; }
  }, [rpc, validate]);
  const clear = useCallback(() => setSent({ kind: 'idle' }), []);
  return { sent, send, clear };
}
