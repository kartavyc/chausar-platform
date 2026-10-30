'use strict';
// Chausar desktop (Ink v2 wave 4, package 4J4, P12): the money:saveExport channel. The window names only a month; this
// file asks the engine for that month's CSV for the owner's CA (venture.money.export), shows the system save dialog,
// and writes the file where the owner picked. The owner's choice to replace a file is the system dialog's own question
// ("already exists, replace it?": Windows and macOS always ask, and showOverwriteConfirmation makes Linux ask too), so
// there is no second ask. A name that was free when the dialog closed is reserved with an exclusive create, so a file
// that appears there meanwhile is never written over (EXPORT_EXISTS). The text goes to a temporary file in the same
// folder, is flushed to disk and renamed into place, so a crash never leaves half a file; on any failure the temporary
// file and the reserved name are taken away. Errors reach the window in plain words, never with a path on this
// computer. Chausar never sends the file anywhere. main.cjs passes Electron's dialog, the window and the engine in.
const fsp = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { basename, dirname, join } = require('node:path');

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
const exists = () => failure('EXPORT_EXISTS', 'A file with this name appeared while you were choosing, so Chausar left it alone. Save again to pick a name.');

/** The words for a file system error: what happened and what to do, never the path it names. */
const FS_WORDS = Object.freeze({
  EACCES: 'Chausar could not write there. Choose another folder.',
  EPERM: 'Chausar could not write there. Choose another folder.',
  EROFS: 'Chausar could not write there: that disk is read-only. Choose another folder.',
  ENOSPC: 'There is not enough space on that disk. Free some space or choose another disk.',
  EDQUOT: 'There is not enough space on that disk. Free some space or choose another disk.',
  ENOENT: 'That folder is not there any more. Choose another folder.',
  ENOTDIR: 'That folder is not there any more. Choose another folder.',
  EBUSY: 'The file is open in another app. Close it there and save again.',
});

/** A failure fit for the window: our own refusals as they are, a file system error in plain words with no path. */
function plain(error) {
  if (error?.code === 'EXPORT_EXISTS') return error;
  return failure('EXPORT_NOT_SAVED', FS_WORDS[error?.code] ?? 'Chausar could not write the file. Choose another folder and save again.');
}

/**
 * Writes text to a path: without replace, the path is first reserved with an exclusive create (EXPORT_EXISTS when a
 * file is there); the text goes to a temporary file that is written, flushed and renamed over the path. Any failure
 * takes away the temporary file and the reservation, and answers in plain words.
 */
async function writeAtomic(target, text, options = {}) {
  const fs = options.fs ?? fsp;
  const staged = await stage(target, text, options);
  await commit([staged], fs);
}

/**
 * The first half of a write: reserves the name (unless replace), and writes, flushes and closes the temporary file
 * beside it. Nothing is renamed yet, so several files can be staged and then committed together. On failure it takes
 * away what it made and answers in plain words.
 */
async function stage(target, text, options = {}) {
  const fs = options.fs ?? fsp;
  const temp = join(dirname(target), `.${basename(target)}.${randomBytes(6).toString('hex')}.tmp`);
  const staged = { target, temp, reserved: false };
  try {
    if (options.replace !== true) {
      let slot;
      try { slot = await fs.open(target, 'wx', 0o600); } catch (error) { throw error?.code === 'EEXIST' ? exists() : error; }
      staged.reserved = true;
      await slot.close();
    }
    const handle = await fs.open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(text, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    return staged;
  } catch (error) {
    await discard([staged], fs);
    throw plain(error);
  }
}

/** Takes away staged temporary files and the names they reserved (a reserved name is still the empty slot). */
async function discard(list, fs) {
  for (const staged of list) {
    await fs.rm(staged.temp, { force: true }).catch(() => {});
    if (staged.reserved) await fs.rm(staged.target, { force: true }).catch(() => {});
  }
}

/** Renames each staged file into place, then flushes the folder. A rename that fails takes away what is not in place. */
async function commit(list, fs) {
  for (const [at, staged] of list.entries()) {
    try {
      await fs.rename(staged.temp, staged.target);
      staged.reserved = false;
    } catch (error) {
      await discard(list.slice(at), fs);
      throw plain(error);
    }
  }
  const folder = dirname(list[0].target);
  if (process.platform !== 'win32') {
    try { const dir = await fs.open(folder, 'r'); try { await dir.sync(); } finally { await dir.close(); } } catch { /* the folder could not be flushed; the file itself was */ }
  }
}

/** The request: one month like 2026-10. Never a path, and no replace flag: the system dialog asks about that. */
function saveRequest(input) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== 'month') || typeof input.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) {
    throw failure('INVALID_REQUEST', 'Choose a month to export.');
  }
  return { month: input.month };
}

/**
 * The money:saveExport handler: { ok: true, result: { saved, name, line } }, { ok: true, result: null } when the owner
 * cancelled, or { ok: false, error } in plain words.
 */
async function saveMoneyExport(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const request = saveRequest(input);
    const file = await deps.engine.request('venture.money.export', { month: request.month });
    if (!isRecord(file) || typeof file.csv !== 'string' || typeof file.fileName !== 'string' || !/^[a-z0-9-]{1,80}\.csv$/.test(file.fileName)) {
      throw failure('REQUEST_FAILED', 'The export could not be made.');
    }
    const chosen = await deps.dialog.showSaveDialog(deps.window, {
      title: 'Save for your CA', defaultPath: join(deps.documents, file.fileName), filters: [{ name: 'CSV', extensions: ['csv'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (!chosen || chosen.canceled || typeof chosen.filePath !== 'string' || chosen.filePath === '') return { ok: true, result: null };
    const fs = deps.fs ?? fsp;
    const there = path => fs.stat(path).then(() => true, () => false);
    const name = basename(chosen.filePath);
    // 4J20: the business's signed receipts go beside the CSV, named from the picked file (main picks the path; the window
    // passes none), so the CA can check them offline (scripts/verify-receipts.mjs). Both names are checked before either
    // is written. A CSV already there when the dialog closed: the system dialog asked the owner, and they chose to replace
    // it. The receipts carry the CSV's own name, so one already there is an earlier export's and is replaced with the
    // CSV; left as it was, it would sit stale beside a new CSV. Both are staged first, then put in place together, so a
    // failure part way leaves neither.
    const receiptsPath = isRecord(file.receipts) ? join(dirname(chosen.filePath), `${name.replace(/\.csv$/i, '')}-receipts.json`) : null;
    const replaceCsv = await there(chosen.filePath);
    const replaceReceipts = receiptsPath ? await there(receiptsPath) : false;
    const staged = [await stage(chosen.filePath, file.csv, { replace: replaceCsv, fs })];
    if (receiptsPath) {
      try {
        staged.push(await stage(receiptsPath, `${JSON.stringify(file.receipts, null, 2)}\n`, { replace: replaceReceipts, fs }));
      } catch (error) {
        await discard(staged, fs);
        throw error;
      }
    }
    await commit(staged, fs);
    if (receiptsPath) {
      const receipts = basename(receiptsPath);
      return { ok: true, result: { saved: true, name, receipts, line: `Saved ${name} and ${receipts} for your CA. Chausar did not send them anywhere.` } };
    }
    return { ok: true, result: { saved: true, name, line: `Saved ${name} for your CA. Chausar did not send it anywhere.` } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

// stage, commit and discard: the same atomic export for a client report's folder (report-save.cjs, Ink v2 wave 5 5A5).
module.exports = Object.freeze({ saveMoneyExport, writeAtomic, stage, commit, discard });
