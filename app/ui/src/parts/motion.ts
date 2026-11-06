/**
 * One place for "may this move?" (one-shot C3). Motion is off when the computer asks for reduced motion, or when the
 * owner turns animations off in Settings, This app (shell/App.tsx puts `data-motion="off"` on <html>). The CSS side is
 * tokens/motion.css, which sets every --t-* to 0 in both cases; this file is the same answer for code, plus the small
 * helpers every moving part shares: a view transition around a DOM change, a scroll that is smooth only when motion is
 * on, and a presence hook that keeps a closing thing on screen until its exit ends.
 *
 * Nothing here moves at first paint, and nothing waits on an event that may never come: every wait has a timer read
 * from the element's own computed duration.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { flushSync } from 'react-dom';

const REDUCE = '(prefers-reduced-motion: reduce)';

function reduceQuery(): MediaQueryList | null {
  try {
    return typeof window === 'undefined' ? null : (window.matchMedia?.(REDUCE) ?? null);
  } catch {
    return null;
  }
}

/** True when the computer's own setting asks for reduced motion. */
export function prefersReducedMotion(): boolean {
  return reduceQuery()?.matches ?? false;
}

/** True when the owner turned animations off for this computer (Settings, This app). */
export function ownerTurnedMotionOff(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.motion === 'off';
}

/** True when nothing may move: the computer asks for reduced motion, or the owner turned animations off. */
export function motionOff(): boolean {
  return prefersReducedMotion() || ownerTurnedMotionOff();
}

function subscribe(onChange: () => void): () => void {
  const query = reduceQuery();
  query?.addEventListener?.('change', onChange);
  const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(onChange);
  observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    query?.removeEventListener?.('change', onChange);
    observer?.disconnect();
  };
}

/** `motionOff()` that re-renders when either setting changes. Off on the server, where nothing moves. */
export function useMotionOff(): boolean {
  return useSyncExternalStore(subscribe, motionOff, () => true);
}

type Transition = { ready?: Promise<unknown>; finished?: Promise<unknown>; updateCallbackDone?: Promise<unknown> };
type TransitionDocument = Document & { startViewTransition?: (update: () => void) => Transition | undefined };

/**
 * Run `update` (a state change that redraws the page) inside one view transition when motion is on and the browser
 * has them; otherwise run it at once. `swap` names the kind of change for the CSS while it runs (`<html data-swap>`:
 * `sub` is a page inside one place, which cross-fades with no rise). React commits the new view inside the transition
 * through flushSync, so call this from an event handler, never during a render. Resolves once the DOM is updated.
 */
export function withViewTransition(update: () => void, swap?: string): Promise<void> {
  const doc = document as TransitionDocument;
  if (motionOff() || typeof doc.startViewTransition !== 'function') {
    update();
    return Promise.resolve();
  }
  const root = document.documentElement;
  if (swap) root.dataset.swap = swap;
  let ran = false;
  const run = () => {
    ran = true;
    flushSync(update);
  };
  const transition = doc.startViewTransition(run);
  const clear = () => {
    if (swap && root.dataset.swap === swap) delete root.dataset.swap;
  };
  // A skipped transition (a hidden window, a newer one) rejects `ready`: that is not a failure, the update still ran.
  transition?.ready?.catch(() => {});
  if (transition?.finished) transition.finished.then(clear, clear);
  else clear();
  if (transition?.updateCallbackDone) return transition.updateCallbackDone.then(() => undefined, () => { if (!ran) run(); });
  if (!ran) run();
  return Promise.resolve();
}

/** Bring `element` into view: a smooth scroll only when motion is on, the nearest edge, never the whole page jumping. */
export function scrollToView(element: Element | null | undefined): void {
  element?.scrollIntoView?.({ behavior: motionOff() ? 'auto' : 'smooth', block: 'nearest' });
}

/** The longest of a comma list of CSS times ("0.14s, 200ms"), in ms. */
function longest(times: string): number {
  return Math.max(0, ...times.split(',').map((time) => {
    const value = Number(time.replace(/m?s\s*$/, ''));
    if (!Number.isFinite(value)) return 0;
    return /ms\s*$/.test(time) ? value : value * 1000;
  }));
}

/** How long `element`'s exit runs, from its computed transition and animation times (delay included), in ms. */
export function exitTime(element: Element | null): number {
  if (!element || typeof getComputedStyle === 'undefined') return 0;
  const style = getComputedStyle(element);
  return Math.max(
    longest(style.transitionDuration || '0s') + longest(style.transitionDelay || '0s'),
    longest(style.animationDuration || '0s') + longest(style.animationDelay || '0s'),
  );
}

/** How long past an exit's own time the timer waits for its end event before it takes the thing away anyway. */
export const EXIT_GRACE_MS = 50;

/**
 * Wait for `element`'s exit to end: its own transitionend or animationend, or a timer at its computed time plus a
 * little, whichever comes first. With nothing to wait for (motion off, no element, no exit time) it ends at once.
 * Returns a cancel.
 */
export function afterExit(element: Element | null, done: () => void): () => void {
  const wait = motionOff() || !element ? 0 : exitTime(element);
  if (wait <= 0 || !element) {
    done();
    return () => {};
  }
  let over = false;
  const finish = (event?: Event) => {
    if (over || (event && event.target !== element)) return;
    over = true;
    element.removeEventListener('transitionend', finish);
    element.removeEventListener('animationend', finish);
    clearTimeout(timer);
    done();
  };
  element.addEventListener('transitionend', finish);
  element.addEventListener('animationend', finish);
  const timer = setTimeout(finish, wait + EXIT_GRACE_MS);
  return () => {
    over = true;
    element.removeEventListener('transitionend', finish);
    element.removeEventListener('animationend', finish);
    clearTimeout(timer);
  };
}

export type PresenceState = 'open' | 'closing';

/**
 * Keep a thing mounted while it closes. `open` is what the data says; `mounted` is whether to draw it, and `state` is
 * `closing` while its exit runs (put it on the element as `data-state` and give that state the exit in CSS). It goes
 * when `ref`'s element ends its transition or animation, at once when motion is off, and on a timer from the element's
 * computed time if the end event never comes, so a missed event never leaves it on screen. Opening again while it
 * closes keeps the same element.
 */
export function usePresence(open: boolean, ref: RefObject<Element | null>): { mounted: boolean; state: PresenceState } {
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open && (!mounted || closing)) {
    setMounted(true);
    setClosing(false);
  } else if (!open && mounted && !closing) {
    if (motionOff()) setMounted(false);
    else setClosing(true);
  }
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);
  useEffect(() => {
    if (!closing) return undefined;
    return afterExit(ref.current, () => {
      if (!live.current) return;
      setClosing(false);
      setMounted(false);
    });
  }, [closing, ref]);
  return { mounted: mounted || open, state: closing && !open ? 'closing' : 'open' };
}
