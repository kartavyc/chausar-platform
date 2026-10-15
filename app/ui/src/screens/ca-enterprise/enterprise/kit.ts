/**
 * One engine read and one engine change for an enterprise screen. A read is loading, ready,
 * not built (the engine has no such method yet), locked or failed with its code. A reply is
 * checked before it is kept, and one that arrives after the person left the address is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlaceRenderProps, PlaceRpc } from '../../../places/types.ts';

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

/** Read `method` once per address; `reload` reads it again. */
export function useRead<T>(p: Pick<PlaceRenderProps, 'rpc' | 'live' | 'address'>, method: string, validate: (reply: unknown) => T, payload: Record<string, unknown> = {}):
  { state: Loaded<T>; reload: () => void; replace: (value: T) => void } {
  const [state, setState] = useState<Loaded<T>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const body = JSON.stringify(payload);
  const { rpc, live, address } = p;
  const at = `${address.place}/${address.sub ?? ''}`;
  const isLive = useRef<() => boolean>(() => true);
  isLive.current = () => live(address);
  useEffect(() => {
    const ticket = ++latest.current;
    const current = () => ticket === latest.current && isLive.current();
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    rpc.request(method, JSON.parse(body) as Record<string, unknown>).then(
      (reply) => {
        if (!current()) return;
        try { setState({ kind: 'ready', value: validate(reply) }); } catch (error) { setState({ kind: 'failed', code: errorCode(error) }); }
      },
      (error: unknown) => { if (current()) setState(settle<T>(error)); },
    );
    return () => { latest.current++; };
    // validate is a module-level function for every caller; live is read when the reply arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, method, body, at, round]);
  const reload = useCallback(() => setRound((n) => n + 1), []);
  const replace = useCallback((value: T) => setState({ kind: 'ready', value }), []);
  return { state, reload, replace };
}

export type Sent<T> = { readonly kind: 'idle' } | { readonly kind: 'sending' } | { readonly kind: 'done'; readonly value: T } | { readonly kind: 'refused'; readonly code: string };

/** One press, one request; the outcome is kept for the screen. */
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

/** Whether this seat may change enterprise settings. The engine decides; this only hides controls a viewer cannot use. */
export function canChange(p: Pick<PlaceRenderProps, 'viewer' | 'member'>): boolean {
  return !p.viewer && ['owner', 'cofounder', 'administrator', 'admin'].includes(p.member.role);
}
