'use strict';
const { fork } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { validateRequest, validateVentureEvent } = require('./ipc-contract.cjs');
const { createFormsRelay } = require('./owner-browser-relay.cjs');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
/**
 * Ink v2 wave 5 (5A5): a report print the engine asked for. Checked here (an id, an HTML string within bounds, known
 * scripts), passed to main's 'print' listener with one answer function, and answered to the worker once as
 * { kind: 'host-print-result', printId, ok, pdfBase64 | reason }. With no listener, or a request out of bounds, 'failed'.
 */
function printRelay(harness, child, message) {
  const printId = typeof message.printId === 'string' && /^[0-9a-f-]{36}$/.test(message.printId) ? message.printId : null;
  if (!printId) return;
  let answered = false;
  const answer = result => {
    if (answered) return; answered = true;
    const reply = result && result.ok === true && typeof result.pdfBase64 === 'string' ? { ok: true, pdfBase64: result.pdfBase64 } : { ok: false, reason: result?.reason === 'font-missing' ? 'font-missing' : 'failed' };
    try { if (child.connected) child.send({ kind: 'host-print-result', printId, ...reply }, () => {}); } catch { /* the engine is gone; its port times out */ }
  };
  const scripts = Array.isArray(message.scripts) ? message.scripts : [];
  if (harness.listenerCount('print') === 0 || typeof message.html !== 'string' || message.html.length > 2_000_000 || !scripts.every(script => script === 'latin' || script === 'devanagari')) { answer(null); return; }
  try { harness.emit('print', Object.freeze({ html: message.html, scripts: [...scripts] }), answer); } catch { answer(null); }
}
// Main-process-owned worker lifecycle; a renderer never chooses paths or launch options.
class EngineHarness extends EventEmitter {
  constructor({ workerPath, environment, execPath = process.execPath, forkProcess = fork, startupTimeoutMs = 15_000, requestTimeoutMs = 120_000, lifecycleTimeoutMs = 5_000, shutdownTimeoutMs = 75_000, maxPending = 128 }) {
    super();
    this.options = { workerPath, environment, execPath, forkProcess, startupTimeoutMs, requestTimeoutMs, lifecycleTimeoutMs, shutdownTimeoutMs, maxPending };
    this.worker = null; this.state = 'stopped'; this.waiting = new Map(); this.startup = null; this.shutdown = null;
  }
  status(state) { this.state = state; this.emit('status', Object.freeze({ state, healthy: state === 'ready' })); }
  failPending(error) { for (const pending of this.waiting.values()) { clearTimeout(pending.timer); pending.reject(error); } this.waiting.clear(); }
  start() {
    if (this.startup && this.state === 'stopped') return Promise.reject(failure('ENGINE_RESTART_REFUSED', 'Create a fresh harness before restarting the engine.'));
    if (this.state !== 'stopped') return this.startup ?? Promise.reject(failure('ENGINE_BUSY', 'The engine is already running or requires shutdown.'));
    this.status('starting');
    this.startup = new Promise((accept, reject) => {
      let settled = false;
      const settle = (error) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else accept(); };
      const timer = setTimeout(() => { const error = failure('ENGINE_START_TIMEOUT', 'The engine did not start before its deadline.'); this.status('failed'); settle(error); this.failPending(error); try { this.worker?.kill(); } catch {} }, this.options.startupTimeoutMs);
      try {
        const child = this.options.forkProcess(this.options.workerPath, [], { execPath: this.options.execPath, execArgv: ['--experimental-strip-types'], windowsHide: true, shell: false, env: { ...this.options.environment, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        this.worker = child;
        const forms = createFormsRelay(this, child);
        child.once('disconnect', () => forms.close()); child.once('exit', () => forms.close());
        child.on('message', message => {
          if (!message || typeof message !== 'object' || Array.isArray(message)) return;
          if (message.ready === true && this.state === 'starting') { this.status('ready'); settle(); return; }
          // A run event the engine committed: checked again here, then main forwards it to the window.
          if (message.kind === 'venture-event' && message.id === undefined) { const event = validateVentureEvent(message.event); if (event) this.emit('venture-event', event); return; }
          // Ink v2 wave 5 (5A5): the engine asks main to print a report's HTML to PDF (report-print.cjs); answered once.
          if (message.kind === 'host-print' && message.id === undefined) { printRelay(this, child, message); return; }
          if ((message.kind === 'host-forms' || message.kind === 'host-forms-verified') && message.id === undefined) { forms.receive(message); return; }
          if (typeof message.id !== 'string') return;
          const pending = this.waiting.get(message.id); if (!pending) return;
          this.waiting.delete(message.id); clearTimeout(pending.timer);
          if (message.error) pending.reject(failure(typeof message.error.code === 'string' ? message.error.code : 'REQUEST_FAILED', typeof message.error.message === 'string' ? message.error.message : 'The engine request failed.'));
          else if (pending.kind === 'host-lifecycle' && (message.kind !== 'host-lifecycle' || message.applied !== true || message.result?.applied !== true)) pending.reject(failure('INVALID_JOB_LIFECYCLE_ACK', 'The engine did not acknowledge its host lifecycle.'));
          else if (Object.hasOwn(message, 'result')) pending.resolve(message.result);
          else pending.reject(failure('INVALID_ENGINE_REPLY', 'The engine returned an invalid response.'));
        });
        child.on('error', error => { settle(error); this.failPending(error); if (this.state !== 'stopping') this.status('failed'); });
        child.on('disconnect', () => { if (this.state === 'stopping' || this.state === 'stopped') return; const error = failure('ENGINE_DISCONNECTED', 'The engine connection was lost. Inspect Activity before retrying an action.'); settle(error); this.failPending(error); this.status('failed'); });
        child.once('exit', (code, signal) => {
          if (this.worker === child) this.worker = null;
          const error = failure('ENGINE_EXITED', 'The engine stopped. Inspect Activity before retrying an action.');
          settle(error); this.failPending(error); this.status(this.state === 'stopping' ? 'stopped' : 'failed'); this.emit('exit', { code, signal });
        });
      } catch (error) { this.status('failed'); settle(error); }
    });
    return this.startup;
  }
  request(method, payload = {}) {
    let input;
    try { input = validateRequest({ method, payload }); } catch (error) { return Promise.reject(error); }
    return this.#send(input, this.options.requestTimeoutMs);
  }
  // Trusted main-process lifecycle only. No renderer method can manufacture this cancellation.
  closeForms() { try { if (this.worker?.connected) this.worker.send({ kind: 'host-forms-closed' }, () => {}); } catch {} }
  // Whether the owner is looking at the window (shown, not minimised, focused), for the notification centre's alert
  // rules (Ink v2 wave 4, 4G1). A plain notice with no reply: the next change corrects a lost one. False when not sent.
  reportWatching(watching) {
    if (typeof watching !== 'boolean' || this.state !== 'ready' || !this.worker?.connected) return false;
    try { this.worker.send({ kind: 'host-watching', watching }, () => {}); return true; } catch { return false; }
  }
  // This host hook bypasses the renderer method contract and requires a correlated ACK.
  updateJobLifecycle(state) {
    if (!state || typeof state !== 'object' || Array.isArray(state) || Object.keys(state).length !== 3 || !['awake', 'windowOpen', 'backgroundEnabled'].every(key => typeof state[key] === 'boolean')) return Promise.reject(failure('INVALID_JOB_LIFECYCLE', 'Report explicit host awake, window and background state.'));
    const input = { kind: 'host-lifecycle', state: { awake: state.awake, windowOpen: state.windowOpen, backgroundEnabled: state.backgroundEnabled } };
    return this.#send(input, this.options.lifecycleTimeoutMs).catch(error => {
      // Unknown lifecycle cannot keep dispatching work under a stale host state.
      if (this.state === 'ready') {
        this.status('failed'); this.failPending(error);
        try { if (this.worker?.connected) this.worker.disconnect(); else this.worker?.kill(); } catch { try { this.worker?.kill(); } catch {} }
      }
      throw error;
    });
  }
  #send(input, timeoutMs) {
    if (this.state !== 'ready' || !this.worker?.connected) return Promise.reject(failure('ENGINE_UNAVAILABLE', 'The engine is unavailable. Restart Chausar.'));
    if (this.waiting.size >= this.options.maxPending) return Promise.reject(failure('ENGINE_BUSY', 'Too many desktop requests are pending. Wait for them to finish.'));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { this.waiting.delete(id); reject(input.kind === 'host-lifecycle' ? failure('JOB_LIFECYCLE_TIMEOUT', 'The engine did not acknowledge its host lifecycle in time.') : failure('REQUEST_TIMEOUT', 'The request timed out. Inspect Activity before retrying an action.')); }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer, kind: input.kind });
      const sent = error => { if (!error || !this.waiting.has(id)) return; clearTimeout(timer); this.waiting.delete(id); reject(failure('ENGINE_SEND_FAILED', 'The request could not reach the engine.')); };
      try { this.worker.send({ id, ...input }, sent); } catch (error) { sent(error); }
    });
  }
  stop() {
    if (this.shutdown) return this.shutdown;
    this.shutdown = new Promise((accept, reject) => {
      const child = this.worker; this.status('stopping');
      this.failPending(failure('ENGINE_STOPPING', 'The engine is completing pending work before shutdown.'));
      if (!child) { this.status('stopped'); accept({ graceful: true, forced: false }); return; }
      let forced = false;
      const timer = setTimeout(() => { forced = true; try { if (!child.kill('SIGKILL')) failed(failure('ENGINE_STOP_FAILED', 'The engine did not stop.')); } catch (error) { failed(error); } }, this.options.shutdownTimeoutMs);
      const finalTimer = setTimeout(() => failed(failure('ENGINE_STOP_FAILED', 'The engine did not exit after termination.')), this.options.shutdownTimeoutMs + 5_000);
      const clean = () => { clearTimeout(timer); clearTimeout(finalTimer); child.removeListener('exit', finished); };
      const failed = error => { clean(); this.status('failed'); reject(error); };
      const finished = code => { clean(); this.status('stopped'); accept({ graceful: !forced && code === 0, forced, exitCode: code }); };
      child.once('exit', finished);
      try { if (child.connected) child.disconnect(); else if (!child.kill()) failed(failure('ENGINE_STOP_FAILED', 'The engine could not be stopped.')); } catch (error) { failed(error); }
    });
    return this.shutdown;
  }
}
module.exports = { EngineHarness };
