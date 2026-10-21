/**
 * The new-order sheet lives beside the page, not inside it. When it adds an order it says so here, and the Work
 * place reloads at once instead of waiting for an engine event.
 */

import { useEffect, useRef } from 'react';

const listeners = new Set<() => void>();

export function workChanged(): void {
  for (const listener of [...listeners]) listener();
}

export function useWorkChanged(listener: () => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const call = () => latest.current();
    listeners.add(call);
    return () => { listeners.delete(call); };
  }, []);
}
