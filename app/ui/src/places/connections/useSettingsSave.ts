import { useEffect, useRef } from 'react';
import type { EngineClient } from '../../engine/types';

// These two surfaces edit one engine record. Keep each read/patch/write together for this client and business.
const pending = new WeakMap<EngineClient, Map<string, Promise<void>>>();

export function useSettingsSave(client: EngineClient, business: string | undefined) {
  const lifetime = useRef({ client, business, live: true });
  if (lifetime.current.client !== client || lifetime.current.business !== business) {
    lifetime.current.live = false;
    lifetime.current = { client, business, live: true };
  }
  const ticket = lifetime.current;
  useEffect(() => { ticket.live = true; return () => { ticket.live = false; }; }, [ticket]);
  return function save<T>(work: (stillOpen: () => Promise<void>) => Promise<T>): Promise<T> {
    const checkTicket = () => {
      if (!ticket.live || lifetime.current !== ticket || !business) throw new Error('Open these settings again before saving.');
    };
    const stillOpen = async () => {
      checkTicket();
      const current = await client.request('venture.get', {});
      checkTicket();
      if (current?.venture.id !== business) throw new Error('The open business changed. Open these settings again before saving.');
    };
    const key = business ?? '';
    const scopes = pending.get(client) ?? new Map<string, Promise<void>>();
    pending.set(client, scopes);
    const next = (scopes.get(key) ?? Promise.resolve()).then(async () => { await stillOpen(); return work(stillOpen); });
    const tail = next.then(() => {}, () => {});
    scopes.set(key, tail);
    void tail.then(() => {
      if (scopes.get(key) === tail) scopes.delete(key);
      if (!scopes.size) pending.delete(client);
    });
    return next;
  };
}
