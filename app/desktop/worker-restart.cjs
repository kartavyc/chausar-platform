'use strict';
// Chausar desktop (one-shot C5 task 29): when the engine worker dies unexpectedly, main starts a fresh EngineHarness (an
// old one refuses a restart) after 1 s, 5 s, then 30 s. Three restarts at most; the next death gives up, and main shows
// its error box once and quits. A worker that stays up for ten minutes earns the three tries back. This file holds only
// the waiting and the counting. Nothing is ever sent again: a pending request already failed with ENGINE_DISCONNECTED or
// ENGINE_EXITED when the worker died, and an owner's approval must never run twice.
const RESTART_DELAYS_MS = Object.freeze([1000, 5000, 30000]);
const STEADY_MS = 10 * 60_000;
const RECONNECTING = Object.freeze({ state: 'reconnecting', healthy: false });

function createWorkerRestart({ start, onReconnecting, onGiveUp, note }) {
  let attempts = 0, waiting = null, steady = null, starting = false, finished = false;
  function steadyTimer() {
    steady = setTimeout(() => { steady = null; attempts = 0; }, STEADY_MS);
    steady?.unref?.();
  }
  function died() {
    // One death is reported more than once (disconnect, then exit), and a start under way answers for itself.
    if (finished || waiting || starting) return;
    if (steady) { clearTimeout(steady); steady = null; }
    if (attempts >= RESTART_DELAYS_MS.length) { finished = true; onGiveUp(); return; }
    const delayMs = RESTART_DELAYS_MS[attempts];
    attempts += 1;
    note({ attempt: attempts, delayMs });
    onReconnecting();
    waiting = setTimeout(() => {
      waiting = null;
      if (finished) return;
      starting = true;
      Promise.resolve().then(start).then(
        () => { starting = false; if (!finished) steadyTimer(); },
        () => { starting = false; died(); },
      );
    }, delayMs);
    waiting?.unref?.();
  }
  /** Quitting: no wait goes on, and nothing starts after this. */
  function stop() {
    finished = true;
    if (waiting) { clearTimeout(waiting); waiting = null; }
    if (steady) { clearTimeout(steady); steady = null; }
  }
  return Object.freeze({
    died, stop,
    pending: () => !!waiting || starting,
    /** While a restart is pending the window hears one word for all of it, until a worker says it's ready. */
    statusForWindow: status => (status?.state !== 'ready' && !finished && (waiting || starting) ? RECONNECTING : status),
  });
}

module.exports = Object.freeze({ RESTART_DELAYS_MS, createWorkerRestart });
