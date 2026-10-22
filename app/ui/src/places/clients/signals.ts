/**
 * A small signal for the Clients place, kept per engine client (so tests and businesses never share it): "clients
 * changed". A client or lead was added, a suggestion applied, a draft written or a send recorded, so every list and
 * sheet showing them reloads. The engine sends no run or queue event for these. Memory only.
 */

import { useEffect, useRef } from 'react';
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
