/**
 * Whether the window is phone-wide (spec 4.3 "Phone", under 760 px): the shell then draws the top bar and the bottom
 * tabs instead of the rail, sheets cover the screen, and Today's cards can be swiped. The same query as every
 * `@media (max-width: 759px)` rule in the stylesheets, so the code and the CSS never disagree. It follows the window
 * as it changes (a phone turned sideways, a window made wider).
 */

import { useSyncExternalStore } from 'react';

export const NARROW = '(max-width: 759px)';

function query(): MediaQueryList | null {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(NARROW) : null;
  } catch {
    return null;
  }
}

function subscribe(changed: () => void): () => void {
  const list = query();
  if (!list) return () => {};
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', changed);
    return () => list.removeEventListener('change', changed);
  }
  list.addListener?.(changed);
  return () => list.removeListener?.(changed);
}

const snapshot = () => query()?.matches ?? false;

export function useNarrow(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
