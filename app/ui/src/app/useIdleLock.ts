/**
 * Idle auto-lock (SH-02): after `minutes` with no input, `onIdle` is called once. Any key,
 * pointer, wheel or touch input starts the wait again. The time comes from the shell reply
 * (`todayx.shell` autoLockMinutes; ten is the proposed default). The hook only times; the
 * lock itself is the host's `vault.lock`, called from `onIdle`.
 *
 * One timeout at a time, never a repeating timer. It is cleared on unmount, when disabled
 * (for example while already locked), and when the time changes.
 */

import { useEffect, useRef } from 'react';

export const IDLE_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart'] as const;

const MS_PER_MINUTE = 60_000;

export interface IdleLockOptions {
  /** Whole minutes of no use before the app locks itself. Not positive: never. */
  minutes: number;
  onIdle: () => void;
  /** Off while locked or on first run. */
  enabled?: boolean | undefined;
}

export function useIdleLock({ minutes, onIdle, enabled = true }: IdleLockOptions): void {
  const latest = useRef(onIdle);
  latest.current = onIdle;

  useEffect(() => {
    if (!enabled || !Number.isFinite(minutes) || minutes <= 0) return;
    const wait = minutes * MS_PER_MINUTE;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let fired = false;
    const arm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        if (fired) return;
        fired = true;
        latest.current();
      }, wait);
    };
    const onInput = () => {
      fired = false;
      arm();
    };
    arm();
    for (const name of IDLE_EVENTS) window.addEventListener(name, onInput, { capture: true, passive: true });
    return () => {
      if (timer !== null) clearTimeout(timer);
      for (const name of IDLE_EVENTS) window.removeEventListener(name, onInput, { capture: true });
    };
  }, [minutes, enabled]);
}
