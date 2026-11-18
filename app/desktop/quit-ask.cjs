'use strict';
// Chausar desktop (15 Nov 2026, the first walk of the built Windows app): quit when asked.
//
// On Windows nothing polite could quit Chausar: "taskkill /PID" without /F only posts a close to a window, the beta
// keeps running in the tray when its window closes, and no signal reaches a Windows program. So an installer, a script
// or the release smoke could only end it by force, which cuts the engine off without its graceful stop.
//
// The ask: a second launch with --quit ("Chausar.exe --quit"). It goes through the single-instance lock, which lives in
// the user data folder, so it reaches only the Chausar that shares that folder (a smoke run's --smoke-user-data
// included) and nothing else. The running Chausar quits the way the tray's "Quit Chausar and stop jobs" does. The asking
// launch opens no window, starts no engine and writes nothing; it exits 0 once the other has gone (or at once when none
// is running) and 1 when the other is still there after the wait. It never ends anything by force: that stays the
// caller's choice. It asks once and then watches the running Chausar's process (askRunningToQuit below says why).
//
// The watcher: Windows tells only top-level windows that the session is ending (sign-out, shutdown, an installer's
// Restart Manager). In the tray Chausar has no window, so a hidden one listens. A close that reaches the hidden window
// can only come from outside ("taskkill /PID" without /F, an installer): the owner cannot see it, so it is an ask to quit.
const QUIT_ARGUMENT = '--quit';
const QUIT_WAIT_MS = 90_000;
const QUIT_LOOK_MS = 500;
/** In the user data folder: the running Chausar's own process number, which the asking launch watches. */
const RUNNING_FILE = 'running.json';

/** True when a second launch (its arguments, or the data its lock request carried) asks the running Chausar to quit. */
function asksToQuit(argv, data) {
  return data?.quit === true || (Array.isArray(argv) && argv.includes(QUIT_ARGUMENT));
}

/**
 * The asking launch's side. first: whether this launch got the lock (so no Chausar is running here). The launch itself
 * was the ask. After it, the running Chausar's process is only watched (runningPid: the number it wrote in
 * running.json; alive: whether that process is still there), and the lock is asked once more when it has gone, to be
 * sure. Nothing is asked in between: on Windows each ask goes through the single-instance check, which ends a first
 * Chausar that is slow to answer and has no window on screen (seen on the installed build, 15 Nov 2026). Only when the
 * process is not known does each look ask the lock again; a refusal repeats the ask, and getting it means the other
 * has gone.
 */
function askRunningToQuit({ app, first, later, runningPid = async () => null, alive = () => false, waitMs = QUIT_WAIT_MS, everyMs = QUIT_LOOK_MS }) {
  const gone = () => { try { app.releaseSingleInstanceLock?.(); } catch { /* the exit frees it */ } app.exit(0); };
  if (first) { gone(); return; }
  let looksLeft = Math.ceil(waitMs / everyMs);
  let pid = null;
  const look = () => {
    looksLeft -= 1;
    let there = false;
    if (pid !== null) { try { there = alive(pid) === true; } catch { there = false; } }
    if (!there) {
      pid = null;
      if (app.requestSingleInstanceLock({ quit: true })) { gone(); return; }
    }
    if (looksLeft <= 0) { app.exit(1); return; }
    later(look, everyMs);
  };
  Promise.resolve().then(runningPid).then(found => { pid = Number.isSafeInteger(found) && found > 0 ? found : null; }, () => { pid = null; }).then(() => { later(look, everyMs); });
}

/** The hidden window that hears the session end while Chausar has no window of its own. Windows only. */
function createSessionWatch({ BaseWindow, platform, onSessionEnd, onCloseAsked }) {
  const supported = platform === 'win32' && typeof BaseWindow === 'function';
  let watcher = null;
  return Object.freeze({
    start() {
      if (!supported || watcher) return false;
      const made = new BaseWindow({ show: false, skipTaskbar: true });
      watcher = made;
      made.on('session-end', () => onSessionEnd());
      made.on('close', event => onCloseAsked(event));
      made.on('closed', () => { if (watcher === made) watcher = null; });
      return true;
    },
    /** The app window is there and listens itself. destroy() closes without a close event, so this is never an ask. */
    stop() {
      const old = watcher; watcher = null;
      try { old?.destroy(); } catch { /* already gone */ }
    },
    active: () => watcher !== null,
  });
}

module.exports = Object.freeze({ QUIT_ARGUMENT, QUIT_WAIT_MS, QUIT_LOOK_MS, RUNNING_FILE, asksToQuit, askRunningToQuit, createSessionWatch });
