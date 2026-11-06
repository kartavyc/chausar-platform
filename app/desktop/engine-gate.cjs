'use strict';
// Chausar desktop (one-shot D4 task 3): the window opens before the engine, so a request can come before there is anything
// to answer it. It waits here for the start, or for a restart, for a bounded time, and is then sent once. Nothing is ever
// sent twice: a request that started on a worker that died has already failed, and an owner's approval must not run again.
const START_WAIT_MS = 60_000;
const STILL_STARTING = 'Chausar is still starting. Try again in a moment.';

function failure(code, message) { return Object.assign(new Error(message), { code, owner: true }); }

/**
 * current(): the engine there now, if any. waiting(): true while a start or a restart is under way. startError(): the start's
 * failure, once it has failed. changed() is called on every status change, so a waiter never polls.
 */
function createEngineGate({ current, waiting, startError, timeoutMs = START_WAIT_MS }) {
  const waiters = new Set();
  const answerNow = () => {
    const engine = current();
    if (engine?.state === 'ready') return { engine };
    const refused = startError();
    if (refused) return { error: failure('ENGINE_START_FAILED', typeof refused.message === 'string' && refused.message ? refused.message : "Chausar couldn't start.") };
    // Nothing is coming: the engine there says why, in its own words.
    if (!waiting()) return engine ? { engine } : { error: failure('ENGINE_UNAVAILABLE', 'Chausar is closing.') };
    return null;
  };
  /** Resolves with the engine to send to, or rejects with plain words. Each caller sends what it holds once. */
  function ready() {
    const now = answerNow();
    if (now) return now.error ? Promise.reject(now.error) : Promise.resolve(now.engine);
    return new Promise((resolve, reject) => {
      const waiter = { settle() {
        const answer = answerNow();
        if (!answer) return;
        waiters.delete(waiter); clearTimeout(timer);
        if (answer.error) reject(answer.error); else resolve(answer.engine);
      } };
      const timer = setTimeout(() => { waiters.delete(waiter); reject(failure('ENGINE_STARTING', STILL_STARTING)); }, timeoutMs);
      timer?.unref?.();
      waiters.add(waiter);
    });
  }
  return Object.freeze({
    ready,
    changed() { for (const waiter of [...waiters]) waiter.settle(); },
    /** What the file and share handlers call: the same wait, then one request. */
    engine: Object.freeze({ request: (method, payload) => ready().then(engine => engine.request(method, payload)) }),
  });
}

module.exports = Object.freeze({ START_WAIT_MS, STILL_STARTING, createEngineGate });
