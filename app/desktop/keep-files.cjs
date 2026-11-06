'use strict';
// Chausar desktop (C5 tasks 21, 23): the two picks behind Keep this business. The window never names a path. For an exported
// copy, main shows the system dialog and gives the window a one-time token and the file's name; the window sends the token
// back with the copy's passphrase or recovery code, and main asks the engine workspace.import with the path. A refusal keeps
// the pick, so the owner can answer it; success spends it. For a backup folder, main shows the folder dialog and asks the
// engine workspace.backups.copyTo. Neither engine method is in the window's allowlist.
const { randomBytes } = require('node:crypto');
const { basename } = require('node:path');

const failure = (code, message) => Object.assign(new Error(message), { code });
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_PICKS = 8;
/** Picks made in this run of the app: token to path. They never leave main. */
const picks = new Map();

/** copy:pick {}: { ok, result: { token, name } }, or result null when the owner cancelled. */
async function pickCopy(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    if (!isRecord(input) || Object.keys(input).length) throw failure('INVALID_REQUEST', 'Choose the copy here.');
    const chosen = await deps.dialog.showOpenDialog(deps.window, {
      title: 'Open an exported copy', defaultPath: deps.documents, properties: ['openFile'],
      filters: [{ name: 'Chausar copy', extensions: ['vault', 'backup', 'json'] }],
    });
    const path = chosen && !chosen.canceled ? chosen.filePaths?.[0] : null;
    if (typeof path !== 'string' || path === '') return { ok: true, result: null };
    const token = randomBytes(18).toString('base64url');
    if (picks.size >= MAX_PICKS) picks.delete(picks.keys().next().value);
    picks.set(token, path);
    return { ok: true, result: { token, name: basename(path) } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

/** copy:import { token, passphrase?, recoveryCode?, restore? }. */
async function importCopy(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const allowed = ['token', 'passphrase', 'recoveryCode', 'restore'];
    if (!isRecord(input) || Object.keys(input).some(key => !allowed.includes(key)) || typeof input.token !== 'string' || !TOKEN.test(input.token)
      || (input.passphrase !== undefined && (typeof input.passphrase !== 'string' || input.passphrase.length > 1024))
      || (input.recoveryCode !== undefined && (typeof input.recoveryCode !== 'string' || input.recoveryCode.length > 200))
      || (input.restore !== undefined && input.restore !== true)) throw failure('INVALID_REQUEST', 'Choose the copy here.');
    const file = picks.get(input.token);
    if (!file) throw failure('COPY_NOT_PICKED', 'Choose the copy again.');
    const { token: _token, ...rest } = input;
    const result = await deps.engine.request('workspace.import', { file, ...rest });
    picks.delete(input.token);
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

/** backups:folder { action: 'pick' | 'clear' }: { ok, result: { copy } }, or result null when the owner cancelled. */
async function setBackupFolder(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    if (!isRecord(input) || Object.keys(input).length !== 1 || (input.action !== 'pick' && input.action !== 'clear')) throw failure('INVALID_REQUEST', 'Pick the folder here.');
    let folder = null;
    if (input.action === 'pick') {
      const chosen = await deps.dialog.showOpenDialog(deps.window, { title: 'Keep a copy on a drive', defaultPath: deps.documents, properties: ['openDirectory', 'createDirectory'] });
      folder = chosen && !chosen.canceled ? chosen.filePaths?.[0] : null;
      if (typeof folder !== 'string' || folder === '') return { ok: true, result: null };
    }
    return { ok: true, result: await deps.engine.request('workspace.backups.copyTo', { folder, confirmed: true }) };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ pickCopy, importCopy, setBackupFolder });
