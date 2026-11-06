import { useEffect } from 'react';
import { useResource } from '../engine/context';
import type { MotionPreferenceLite } from '../engine/types';

/**
 * The owner's Animations choice (one-shot C3 task 3) on the page: 'off' puts `data-motion="off"` on <html>, which sets
 * every motion time to 0 (tokens/motion.css) and makes parts/motion.ts answer that nothing may move; 'system' takes it
 * away, so only the computer's own reduce-motion setting counts. Never in browser storage: the engine keeps it.
 */
export function applyMotionPreference(motion: MotionPreferenceLite): void {
  const root = document.documentElement;
  if (motion === 'off') root.dataset.motion = 'off';
  else delete root.dataset.motion;
}

/**
 * Read the app's preference once at the top of the shell and apply it. Nothing changes before the answer, since first
 * paint never moves; an engine that cannot answer (the hosted web has no computer of its own) leaves the computer's
 * setting in charge.
 */
export function useMotionPreference(): void {
  const preferences = useResource('app.preferences.get', {});
  const motion = preferences.data?.motion;
  useEffect(() => {
    if (motion) applyMotionPreference(motion);
  }, [motion]);
}
