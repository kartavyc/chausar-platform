import { useCallback, useEffect, useState } from 'react';
import { useEngine, useResource } from './context';
import type { EngineError, PhoneAccessView } from './types';

/** How often the listener's state is read again while it is on, so a link that ran out or a stop elsewhere shows. */
export const PHONE_POLL_MS = 5000;

export interface PhoneAccess {
  /**
   * The phone listener's state as the engine last said it: its newest answer, read again every few seconds while it is
   * on. Never the page's own memory of having made a link.
   */
  status: PhoneAccessView | null;
  /** The pairing link this page made, shown only while the engine says the listener is on with a link still waiting. */
  made: PhoneAccessView | null;
  error: EngineError | undefined;
  busy: boolean;
  /** Makes a pairing link; a refusal is thrown for the place to say in its own words. */
  link(via: 'wifi' | 'tailscale'): Promise<void>;
  /** Stops phone access and every phone session. */
  stop(): Promise<void>;
}

/**
 * Phone access for the places that offer it (Business > Notifications, Connections). Found on the real app, 16 November
 * 2026: a page kept the answer of its own "Make a pairing link" and never asked again, so what it showed and what the
 * engine did went apart. Here the state is always the engine's: every action's answer, then a fresh read, then a read
 * every PHONE_POLL_MS while the listener is on (the engine closes it by itself when the link runs out unused).
 */
export function usePhoneAccess(): PhoneAccess {
  const client = useEngine();
  const read = useResource('venture.phone.access', {});
  const { reload } = read;
  /** An action's answer, newer than the last read until the next read lands. */
  const [answered, setAnswered] = useState<PhoneAccessView | null>(null);
  const [link, setLink] = useState<PhoneAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setAnswered(null); }, [read.data]);
  const status = answered ?? read.data ?? null;
  const on = status?.on === true;
  useEffect(() => {
    if (!on) return undefined;
    const timer = setInterval(() => { reload(); }, PHONE_POLL_MS);
    return () => clearInterval(timer);
  }, [on, reload]);
  const waiting = on && (status?.waiting ?? 0) > 0;
  // The engine says no link waits any more (used, run out, or stopped): the page forgets the one it showed.
  useEffect(() => { if (status && !waiting) setLink(null); }, [status, waiting]);

  const send = useCallback(async (params: { action: 'link'; via: 'wifi' | 'tailscale' } | { action: 'stop' }) => {
    setBusy(true);
    try {
      const answer = await client.request('venture.phone.access', params);
      setAnswered(answer);
      setLink(answer.link ? answer : null);
      reload();
    } finally { setBusy(false); }
  }, [client, reload]);

  return {
    status, made: waiting ? link : null, error: read.error, busy,
    link: useCallback((via) => send({ action: 'link', via }), [send]),
    stop: useCallback(() => send({ action: 'stop' }), [send]),
  };
}
