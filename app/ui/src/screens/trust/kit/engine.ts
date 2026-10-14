/**
 * One engine read for a screen: loading, ready, not built, locked, read only or failed.
 * A reply is checked by the screen's own validator before it is kept. A reply that
 * arrives after the person left the address is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaceRpc } from '../../../places/types.ts';

export type Loaded<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'failed'; readonly code: string };

export const NOT_BUILT_CODES: ReadonlySet<string> = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);
const LOCKED_CODES: ReadonlySet<string> = new Set(['VAULT_LOCKED', 'WORKSPACE_LOCKED', 'LOCKED', 'NO_WORKSPACE']);

export function errorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

export function settle<T>(error: unknown): Loaded<T> {
  const code = errorCode(error);
  if (NOT_BUILT_CODES.has(code)) return { kind: 'not-built' };
  if (LOCKED_CODES.has(code)) return { kind: 'locked' };
  return { kind: 'failed', code };
}

/** Read `method` with `payload`; `key` changes when the request changes. */
export function useEngine<T>(rpc: PlaceRpc, method: string, payload: Record<string, unknown>, validate: (reply: unknown) => T, key = ''):
  { state: Loaded<T>; reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const body = JSON.stringify(payload);
  useEffect(() => {
    const ticket = ++latest.current;
    let alive = true;
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    rpc.request(method, JSON.parse(body) as Record<string, unknown>).then(
      (reply) => {
        if (!alive || ticket !== latest.current) return;
        try { setState({ kind: 'ready', value: validate(reply) }); } catch (error) { setState({ kind: 'failed', code: errorCode(error) }); }
      },
      (error: unknown) => { if (alive && ticket === latest.current) setState(settle<T>(error)); },
    );
    return () => { alive = false; };
    // validate is a module-level function for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, method, body, key, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  return { state, reload };
}

/** A change sent to the engine: one press, one request, its outcome kept for the screen. */
export type Sent<T> = { readonly kind: 'idle' } | { readonly kind: 'sending' } | { readonly kind: 'done'; readonly value: T } | { readonly kind: 'refused'; readonly code: string };

export function useSend<T>(rpc: PlaceRpc, validate: (reply: unknown) => T): { sent: Sent<T>; send: (method: string, payload: Record<string, unknown>) => Promise<T | null>; clear: () => void } {
  const [sent, setSent] = useState<Sent<T>>({ kind: 'idle' });
  const busy = useRef(false);
  const send = useCallback(async (method: string, payload: Record<string, unknown>) => {
    if (busy.current) return null;
    busy.current = true; setSent({ kind: 'sending' });
    try {
      const value = validate(await rpc.request(method, payload));
      setSent({ kind: 'done', value }); return value;
    } catch (error) {
      setSent({ kind: 'refused', code: errorCode(error) }); return null;
    } finally { busy.current = false; }
  }, [rpc, validate]);
  const clear = useCallback(() => setSent({ kind: 'idle' }), []);
  return { sent, send, clear };
}
