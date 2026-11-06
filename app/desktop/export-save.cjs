'use strict';
// One-shot C4 task 36 (206.x1, 244.w1): Export asks where to save. The window names only the kind of copy (encrypted
// or readable); this file asks the engine for the name to offer ("Pune Frames, 3 Nov 2026.vault"), opens the system
// save dialog in Documents, and asks the engine to write the copy where the owner picked. Cancel writes nothing. The
// owner's choice to replace a file is the system dialog's own question. The window gets the file's name and an id to
// show it in its folder, never the path, which stays here in main. main.cjs passes Electron's dialog, shell, the
// window, the engine and the Documents folder in; the tests pass stubs, so no dialog ever opens on screen.
const fsp = require('node:fs/promises');
const { randomBytes } = require('node:crypto');
const { join } = require('node:path');

const SAVE_CHANNEL = 'chausar:export:saveAs';
const SHOW_CHANNEL = 'chausar:export:showSaved';
/** How many saved copies Show in folder remembers, newest kept. */
const KEEP = 20;
const ID = /^[a-f0-9]{18}$/;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }

/** Where each copy this run saved went, by the id the window holds. Main memory only. */
const saved = new Map();

/** The save:as handler. Answers { name, encrypted, id }, or null when the owner cancelled. */
async function saveBusinessExport(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    if (!isRecord(input) || Object.keys(input).length !== 1 || typeof input.plaintext !== 'boolean') throw failure('INVALID_REQUEST', 'Choose an encrypted or a readable copy.');
    const plaintext = input.plaintext, tail = plaintext ? '.json' : '.vault';
    const custody = await deps.engine.request('workspace.custody.get', {});
    const named = typeof custody?.business?.exportName === 'string' ? custody.business.exportName : 'Chausar business.vault';
    const offered = named.replace(/\.vault$/, tail);
    const choice = await deps.dialog.showSaveDialog(deps.window, {
      title: plaintext ? 'Save a readable copy' : 'Save a copy of this business',
      defaultPath: join(deps.documents, offered),
      filters: [plaintext ? { name: 'Readable copy', extensions: ['json'] } : { name: 'Chausar copy', extensions: ['vault'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (!choice || choice.canceled || typeof choice.filePath !== 'string' || !choice.filePath) return { ok: true, result: null };
    const path = choice.filePath.toLowerCase().endsWith(tail) ? choice.filePath : `${choice.filePath}${tail}`;
    const answer = await deps.engine.request('workspace.export', { confirmed: true, plaintext, path });
    const id = randomBytes(9).toString('hex');
    saved.set(id, path);
    while (saved.size > KEEP) saved.delete(saved.keys().next().value);
    return { ok: true, result: { name: String(answer?.name ?? ''), encrypted: answer?.encrypted !== false, id } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

/** The show handler: shows one copy this run saved in the file manager, by its id only. */
async function showSavedExport(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const id = isRecord(input) && Object.keys(input).length === 1 ? input.id : undefined;
    if (typeof id !== 'string' || !ID.test(id) || !saved.has(id)) throw failure('INVALID_REQUEST', 'Choose a copy you saved.');
    const path = saved.get(id);
    const found = await (deps.fs ?? fsp).stat(path).catch(() => null);
    if (!found || !found.isFile()) throw failure('EXPORT_NOT_FOUND', 'That copy is not there any more.');
    deps.shell.showItemInFolder(path);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ SAVE_CHANNEL, SHOW_CHANNEL, saveBusinessExport, showSavedExport });
