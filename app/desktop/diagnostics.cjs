'use strict';
// Chausar desktop (one-shot C5 tasks 25, 26): this computer's own diagnostic files, under <userData>/diagnostics, and the
// main-process guard. A line holds names and sizes only: a number, a true or false, or a short tag with no spaces or
// slashes. A message, a path or anything longer never reaches a file, so a file the owner hands to support holds none of
// their work. Each file moves to <name>.1 at 1 MB, so a computer never keeps more than two of each. Writing a line never
// throws and never stops the app: a log that cannot be written changes nothing. Nothing here is sent anywhere.
const fsp = require('node:fs/promises');
const { join } = require('node:path');

const DIAGNOSTICS_MAX_BYTES = 1024 * 1024;
const FILE_NAME = /^[a-z][a-z0-9-]{0,40}\.jsonl$/;
const TAG = /^[A-Za-z0-9_.:@+-]{1,100}$/;
const CRASH_WORDS = 'Chausar hit a problem and needs to close. Nothing was sent anywhere.';
/**
 * C5 task 26, D4: the start-up steps, in the order they normally happen: the window first, then the engine. This is the one
 * list of them. WINDOW_PHASES are the ones the window is told, before the engine says it's ready.
 */
const FIRST_PAINT = 'first-paint';
const STARTUP_PHASES = Object.freeze(['app-ready', 'window-shown', 'engine-forked', 'loaded', 'engine-ready', FIRST_PAINT, 'first-request']);
const WINDOW_PHASES = Object.freeze(['window-shown', 'engine-forked', 'loaded']);

function cleanFields(record) {
  const out = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (!TAG.test(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && TAG.test(value))) out[key] = value;
  }
  return out;
}

/** The writer for one folder. fs is a seam for tests; lines are written one at a time, in the order asked. */
function createDiagnostics({ folder, fs = fsp, maxBytes = DIAGNOSTICS_MAX_BYTES, now = () => new Date().toISOString() }) {
  let queue = Promise.resolve(), made = false;
  const sizes = new Map();
  async function write(name, text) {
    if (!made) { await fs.mkdir(folder, { recursive: true }); made = true; }
    const path = join(folder, name), bytes = Buffer.byteLength(text);
    if (!sizes.has(name)) sizes.set(name, await fs.stat(path).then(info => info.size, () => 0));
    if (sizes.get(name) > 0 && sizes.get(name) + bytes > maxBytes) {
      await fs.rename(path, `${path}.1`);
      sizes.set(name, 0);
    }
    await fs.appendFile(path, text, { mode: 0o600 });
    sizes.set(name, sizes.get(name) + bytes);
  }
  function line(name, record) {
    if (!FILE_NAME.test(name)) return queue;
    const text = `${JSON.stringify({ at: now(), ...cleanFields(record) })}\n`;
    queue = queue.then(() => write(name, text)).catch(() => { sizes.delete(name); });
    return queue;
  }
  return Object.freeze({ line, flushed: () => queue, folder });
}

/**
 * C5 task 25: crash dumps stay on this computer, and an error nothing caught in the main process writes one line, shows
 * one plain dialog and quits cleanly (the quit stops the engine as usual). A later problem while closing is only noted.
 */
function startMainGuard({ process, crashReporter, dialog, app, diagnostics }) {
  crashReporter?.start?.({ uploadToServer: false });
  let closing = false;
  const guard = op => error => {
    const written = diagnostics.line('main.jsonl', { op, name: error?.name, code: error?.code });
    if (closing) return;
    closing = true;
    void written.then(() => {
      try { dialog.showErrorBox('Chausar', CRASH_WORDS); } finally { app.quit(); }
    });
  };
  process.on?.('uncaughtException', guard('uncaught'));
  process.on?.('unhandledRejection', guard('unhandled-rejection'));
}

/** C5 task 26: the start-up lines in startup.jsonl. mark writes a phase once; note writes any other event, like a restart. */
function createTimeline({ diagnostics, now = Date.now }) {
  const started = now(), seen = new Set();
  return Object.freeze({
    mark(phase) {
      if (!STARTUP_PHASES.includes(phase) || seen.has(phase)) return false;
      seen.add(phase);
      void diagnostics.line('startup.jsonl', { phase, ms: now() - started });
      return true;
    },
    reached: phase => seen.has(phase),
    note(op, fields = {}) { void diagnostics.line('startup.jsonl', { op, ...fields, ms: now() - started }); },
  });
}

module.exports = Object.freeze({ DIAGNOSTICS_MAX_BYTES, CRASH_WORDS, FIRST_PAINT, STARTUP_PHASES, WINDOW_PHASES, createDiagnostics, startMainGuard, createTimeline });
