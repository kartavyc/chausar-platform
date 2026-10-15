/**
 * Loading engine replies for the jobs-ext screens. The screens call the engine only through
 * the host's `rpc`; each reply is checked before it is kept, and a reply that arrives after
 * the address changed is dropped. Refusals become the design's fixed states:
 *   UNKNOWN_METHOD, INVALID_REQUEST, METHOD_UNAVAILABLE → not built yet
 *   FORBIDDEN                                         → read only
 *   ACCESS_REVOKED, VAULT_LOCKED, WORKSPACE_LOCKED     → locked
 *   anything else                                     → failed, with its short code
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Address, ScreenState } from '../../app/presentation.ts';
import type { PlaceRpc } from '../../places/types.ts';
import { InvalidReply, type Check } from './check.ts';

export const NOT_BUILT_CODES: ReadonlySet<string> = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);

export function codeOf(error: unknown): string {
  if (error instanceof InvalidReply) return 'INVALID_REPLY';
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

export function stateFor(code: string): ScreenState {
  if (NOT_BUILT_CODES.has(code)) return { kind: 'not-built' };
  if (code === 'FORBIDDEN') return { kind: 'read-only' };
  if (code === 'ACCESS_REVOKED' || code === 'VAULT_LOCKED' || code === 'WORKSPACE_LOCKED') return { kind: 'locked' };
  if (code === 'NETWORK_WAIT' || code === 'OFFLINE') return { kind: 'waiting-for-network' };
  return { kind: 'failed', code };
}

export type Loaded<T> =
  | { readonly phase: 'loading'; readonly last?: T }
  | { readonly phase: 'ready'; readonly value: T }
  | { readonly phase: 'refused'; readonly code: string; readonly state: ScreenState };

export interface ReplyHost {
  readonly rpc: PlaceRpc;
  readonly address: Address;
  live(address: Address): boolean;
}

/** Load one method's reply and keep it checked. A change of `key` forces a fresh read. */
export function useReply<T>(host: ReplyHost, method: string, payload: Record<string, unknown>, check: Check<T>, key = ''): { loaded: Loaded<T>; reload: () => void } {
  const [loaded, setLoaded] = useState<Loaded<T>>({ phase: 'loading' });
  const [tick, setTick] = useState(0);
  const lastRef = useRef<T | undefined>(undefined);
  const checkRef = useRef(check);
  checkRef.current = check;
  const body = JSON.stringify(payload);
  useEffect(() => {
    let current = true;
    const address = host.address;
    setLoaded(lastRef.current === undefined ? { phase: 'loading' } : { phase: 'loading', last: lastRef.current });
    host.rpc.request(method, JSON.parse(body) as Record<string, unknown>).then(
      reply => {
        if (!current || !host.live(address)) return;
        try { const value = checkRef.current(reply, method); lastRef.current = value; setLoaded({ phase: 'ready', value }); }
        catch (error) { const code = codeOf(error); setLoaded({ phase: 'refused', code, state: stateFor(code) }); }
      },
      (error: unknown) => {
        if (!current || !host.live(address)) return;
        const code = codeOf(error); setLoaded({ phase: 'refused', code, state: stateFor(code) });
      });
    return () => { current = false; };
  }, [host, method, body, key, tick]);
  const reload = useCallback(() => setTick(n => n + 1), []);
  return { loaded, reload };
}

export type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: string };

/** One change request. The reply is checked; a refusal is returned as its code. */
export async function act<T>(rpc: PlaceRpc, method: string, payload: Record<string, unknown>, check: Check<T>): Promise<Outcome<T>> {
  try { return { ok: true, value: check(await rpc.request(method, payload), method) }; }
  catch (error) { return { ok: false, code: codeOf(error) }; }
}

/** A hook form of `act` that tracks the one request in flight and its last refusal. */
export function useAct(rpc: PlaceRpc): { busy: boolean; refusal: string | null; run: <T>(method: string, payload: Record<string, unknown>, check: Check<T>) => Promise<Outcome<T>>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const run = useCallback(async <T,>(method: string, payload: Record<string, unknown>, check: Check<T>) => {
    setBusy(true); setRefusal(null);
    const outcome = await act(rpc, method, payload, check);
    setBusy(false);
    if (!outcome.ok) setRefusal(outcome.code);
    return outcome;
  }, [rpc]);
  const clear = useCallback(() => setRefusal(null), []);
  return { busy, refusal, run, clear };
}
