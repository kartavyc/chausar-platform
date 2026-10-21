/**
 * Two small session signals for the Clients place, kept per engine client (so tests and businesses never share them):
 * - "clients changed": a client was added or a suggestion applied, so every list showing clients reloads. The engine
 *   sends no run or queue event for these.
 * - dismissed suggestions: the engine has no dismiss method yet, so a dismissed suggestion stays hidden for this
 *   session only. Memory only; nothing goes to browser storage.
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import type { EngineClient } from '../../engine/types';

const changed = new WeakMap<EngineClient, Set<() => void>>();

export function clientsChanged(client: EngineClient): void {
  for (const listener of [...(changed.get(client) ?? [])]) listener();
}

export function useClientsChanged(client: EngineClient, listener: () => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const set = changed.get(client) ?? new Set<() => void>();
    changed.set(client, set);
    const call = () => latest.current();
    set.add(call);
    return () => { set.delete(call); };
  }, [client]);
}

interface DismissStore { ids: Set<string>; version: number; listeners: Set<() => void> }
const dismissals = new WeakMap<EngineClient, DismissStore>();

function storeFor(client: EngineClient): DismissStore {
  let store = dismissals.get(client);
  if (!store) {
    store = { ids: new Set(), version: 0, listeners: new Set() };
    dismissals.set(client, store);
  }
  return store;
}

/** The suggestions dismissed in this session, and a way to dismiss one more. */
export function useDismissed(client: EngineClient): [ReadonlySet<string>, (id: string) => void] {
  const store = storeFor(client);
  const subscribe = useCallback((listener: () => void) => {
    store.listeners.add(listener);
    return () => { store.listeners.delete(listener); };
  }, [store]);
  const version = useCallback(() => store.version, [store]);
  useSyncExternalStore(subscribe, version, version);
  const dismiss = useCallback((id: string) => {
    if (store.ids.has(id)) return;
    store.ids.add(id);
    store.version += 1;
    for (const listener of [...store.listeners]) listener();
  }, [store]);
  return [store.ids, dismiss];
}
