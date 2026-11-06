import { useEffect, useRef } from 'react';
import type { EngineClient } from '../../engine/types';

// These two surfaces edit one engine record. Keep each read/patch/write together, scoped to this client.
const pending = new WeakMap<EngineClient, Promise<void>>();

export function useSettingsSave(client: EngineClient) {
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return function save<T>(work: (stillOpen: () => void) => Promise<T>): Promise<T> {
    const stillOpen = () => { if (!mounted.current) throw new Error('Open these settings again before saving.'); };
    const next = (pending.get(client) ?? Promise.resolve()).then(() => { stillOpen(); return work(stillOpen); });
    const tail = next.then(() => {}, () => {});
    pending.set(client, tail);
    void tail.then(() => { if (pending.get(client) === tail) pending.delete(client); });
    return next;
  };
}
