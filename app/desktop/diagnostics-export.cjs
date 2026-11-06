'use strict';
// Chausar desktop (one-shot C5 task 27): Export diagnostics. Main gathers this computer's diagnostic files; the window
// gets the list, the sizes and the full text to read first. Save writes exactly that text as one file, where the owner
// picks in the system dialog; the window names only the preview's id, never a path. Crash files go in only when the owner
// ticks them, since one can hold parts of what was on screen. Chausar never sends the file anywhere.
const fsp = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { basename, join } = require('node:path');
const { writeAtomic } = require('./money-export.cjs');

const MAX_FILE_BYTES = 2 * 1024 * 1024;
/** The newest crash files that fit this much go in; the rest are counted, so the file stays one a person can pass on. */
const MAX_DUMP_BYTES = 4 * 1024 * 1024;
const DUMP_NAME = /^[A-Za-z0-9._-]{1,120}\.dmp$/;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

/** Every diagnostic file this computer keeps, by the name the window shows. */
function diagnosticSources(userData) {
  const here = join(userData, 'diagnostics');
  return Object.freeze([
    { name: 'main.jsonl', path: join(here, 'main.jsonl') },
    { name: 'startup.jsonl', path: join(here, 'startup.jsonl') },
    { name: 'rpc.jsonl', path: join(here, 'rpc.jsonl') },
    { name: 'custody-diagnostics.jsonl', path: join(userData, 'vaults', 'custody', 'diagnostics.jsonl') },
    { name: 'updates.jsonl', path: join(userData, 'updates', 'updates.jsonl') },
  ]);
}
async function readSources(sources, fs) {
  const files = [];
  for (const { name, path } of sources) {
    const info = await fs.lstat(path).catch(() => null);
    if (!info?.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) continue;
    const text = await fs.readFile(path, 'utf8').catch(() => null);
    if (text !== null) files.push({ name, bytes: Buffer.byteLength(text), text });
  }
  return files;
}
/** Crash files under the folder, newest first; a folder that isn't there is none. */
async function listDumps(folder, fs, depth = 3) {
  const found = [];
  const entries = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = join(folder, entry.name);
    if (entry.isDirectory() && depth > 0) found.push(...await listDumps(path, fs, depth - 1));
    else if (entry.isFile() && DUMP_NAME.test(entry.name)) {
      const info = await fs.lstat(path).catch(() => null);
      if (info?.isFile() && !info.isSymbolicLink()) found.push({ name: entry.name, path, bytes: info.size, at: info.mtimeMs });
    }
  }
  return found.sort((a, b) => b.at - a.at || a.name.localeCompare(b.name));
}

/** One holder per window: only the latest preview can be saved, so the file is always what the owner last read. */
function createDiagnosticsExport() {
  let held = null;
  async function preview(event, input, deps) {
    try {
      deps.assertTrustedSender(event, deps.window?.webContents);
      if (!isRecord(input) || Object.keys(input).length !== 1 || typeof input.dumps !== 'boolean') throw failure('INVALID_REQUEST', 'Say whether to add crash files.');
      const fs = deps.fs ?? fsp, now = deps.now ?? (() => new Date().toISOString());
      const files = await readSources(deps.sources, fs), there = await listDumps(deps.dumpsFolder, fs);
      const dumps = [];
      let total = 0, leftOut = 0;
      if (input.dumps) {
        for (const dump of there) {
          if (total + dump.bytes > MAX_DUMP_BYTES) { leftOut++; continue; }
          const bytes = await fs.readFile(dump.path).catch(() => null);
          if (!bytes) { leftOut++; continue; }
          total += bytes.length;
          dumps.push({ name: dump.name, bytes: bytes.length, base64: bytes.toString('base64') });
        }
      }
      const madeAt = now();
      const text = `${JSON.stringify({ format: 'chausar.diagnostics.v1', madeAt, version: deps.version ?? null, platform: deps.platform ?? process.platform, files, dumps }, null, 2)}\n`;
      held = { id: randomBytes(16).toString('hex'), text, fileName: `chausar-diagnostics-${madeAt.slice(0, 10)}.json` };
      return { ok: true, result: { id: held.id, files: files.map(({ name, bytes }) => ({ name, bytes })), dumps: dumps.map(({ name, bytes }) => ({ name, bytes })), dumpsThere: there.length, leftOut, text, bytes: Buffer.byteLength(text) } };
    } catch (error) { return { ok: false, error: deps.publicError(error) }; }
  }
  async function save(event, input, deps) {
    try {
      deps.assertTrustedSender(event, deps.window?.webContents);
      if (!isRecord(input) || Object.keys(input).length !== 1 || typeof input.id !== 'string') throw failure('INVALID_REQUEST', 'Read the preview first.');
      if (!held || held.id !== input.id) throw failure('DIAGNOSTICS_PREVIEW_GONE', 'Read the preview again, then save.');
      const { text, fileName } = held;
      const chosen = await deps.dialog.showSaveDialog(deps.window, { title: 'Save diagnostics', defaultPath: join(deps.documents, fileName), filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['showOverwriteConfirmation', 'createDirectory'] });
      if (!chosen || chosen.canceled || typeof chosen.filePath !== 'string' || chosen.filePath === '') return { ok: true, result: null };
      const fs = deps.fs ?? fsp;
      // The system dialog asked before replacing a file that was there when it closed.
      await writeAtomic(chosen.filePath, text, { replace: await fs.stat(chosen.filePath).then(() => true, () => false), fs });
      held = null;
      const name = basename(chosen.filePath);
      return { ok: true, result: { saved: true, name, line: `Saved ${name}. Chausar did not send it anywhere.` } };
    } catch (error) { return { ok: false, error: deps.publicError(error) }; }
  }
  return Object.freeze({ preview, save });
}

module.exports = Object.freeze({ MAX_DUMP_BYTES, diagnosticSources, createDiagnosticsExport });
