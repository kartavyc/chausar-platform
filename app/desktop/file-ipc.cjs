'use strict';
// imports.pickFile (frame-today, FR-07, BK-04 and FR-13): the system open dialog, on its own
// channel, never the engine request channel. It answers only the trusted main frame, one dialog
// at a time. The renderer chooses nothing but the kind:
// - 'statement': a CSV, Excel or PDF file, any folder the person chooses. Main checks the
//   extension again (a dialog filter can be typed past), reads the bytes itself, and returns
//   `{ name, bytesBase64 }`: the file's base name and its bytes, never its path.
// - 'backup': a `.backup` file in the app's own managed backups folder (the engine's
//   `<vaults>/backups`, where `workspace.backup` writes). Main resolves the real path and returns
//   only its managed name, which `workspace.restore` requires. A file anywhere else is refused.
// A statement is at most MAX_STATEMENT_BYTES: one desktop request carries at most 2,000,000
// bytes (ipc-contract.cjs) and the bytes travel base64, so a larger file could never reach
// the engine's preview.
const { basename, extname, join, relative, isAbsolute, sep } = require('node:path');
const { assertTrustedSender } = require('./ipc-contract.cjs');

const PICK_FILE_CHANNEL = 'chausar:imports-pick-file';
const PICK_KINDS = Object.freeze(['statement', 'backup']);
const STATEMENT_EXTENSIONS = Object.freeze(['csv', 'xlsx', 'pdf']);
const MAX_STATEMENT_BYTES = 1_450_000;
const MAX_NAME_LENGTH = 200;
const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,190}\.backup$/;
const PICK_REFUSALS = Object.freeze(['FILE_TOO_LARGE', 'FILE_KIND_REFUSED', 'FILE_UNREADABLE', 'BACKUP_NOT_MANAGED', 'PICKER_BUSY']);

const refused = code => ({ outcome: 'refused', code });

/** The base name shown to the person: plain text, bounded, no control or direction characters. */
function displayName(path) {
  const name = basename(path);
  if (name.length === 0 || name.length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(name)) return null;
  return name;
}

function registerPickFileHandler({ ipcMain, dialog, contents, document, owner, backupsDirectory, fs = require('node:fs/promises') }) {
  let busy = false;
  const trusted = event => { try { assertTrustedSender(event, contents(), document()); return true; } catch { return false; } };

  async function statement(path) {
    const name = displayName(path);
    const extension = extname(path).slice(1).toLowerCase();
    if (name === null || !STATEMENT_EXTENSIONS.includes(extension)) return refused('FILE_KIND_REFUSED');
    let handle;
    try {
      handle = await fs.open(path, 'r');
      const info = await handle.stat();
      if (!info.isFile()) return refused('FILE_UNREADABLE');
      if (info.size > MAX_STATEMENT_BYTES) return refused('FILE_TOO_LARGE');
      const bytes = Buffer.alloc(info.size);
      const { bytesRead } = info.size === 0 ? { bytesRead: 0 } : await handle.read(bytes, 0, info.size, 0);
      // The file changed under the read: refuse rather than send a part of it.
      if (bytesRead !== info.size) return refused('FILE_UNREADABLE');
      const probe = Buffer.alloc(1);
      if ((await handle.read(probe, 0, 1, info.size)).bytesRead !== 0) return refused('FILE_TOO_LARGE');
      return { outcome: 'picked', name, bytesBase64: bytes.toString('base64') };
    } catch { return refused('FILE_UNREADABLE'); } finally { await handle?.close().catch(() => {}); }
  }

  async function backup(path, root) {
    try {
      const [realRoot, realFile] = await Promise.all([fs.realpath(root), fs.realpath(path)]);
      const rel = relative(realRoot, realFile);
      // Only a file directly in the managed folder, by its own managed name.
      if (rel.length === 0 || isAbsolute(rel) || rel.includes(sep) || rel.includes('/') || !BACKUP_NAME.test(rel)) return refused('BACKUP_NOT_MANAGED');
      const info = await fs.lstat(join(realRoot, rel));
      if (!info.isFile()) return refused('BACKUP_NOT_MANAGED');
      return { outcome: 'picked', name: rel };
    } catch { return refused('BACKUP_NOT_MANAGED'); }
  }

  ipcMain.handle(PICK_FILE_CHANNEL, async (event, kind) => {
    if (!trusted(event) || !PICK_KINDS.includes(kind)) return refused('FILE_KIND_REFUSED');
    if (busy) return refused('PICKER_BUSY');
    busy = true;
    try {
      const root = kind === 'backup' ? backupsDirectory() : null;
      const options = kind === 'backup'
        ? { properties: ['openFile'], defaultPath: root, filters: [{ name: 'Chausar backup', extensions: ['backup'] }] }
        : { properties: ['openFile'], filters: [{ name: 'CSV, Excel or PDF', extensions: [...STATEMENT_EXTENSIONS] }] };
      const parent = owner();
      const chosen = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      if (chosen?.canceled === true || !Array.isArray(chosen?.filePaths) || chosen.filePaths.length === 0) return { outcome: 'cancelled' };
      const path = chosen.filePaths[0];
      if (typeof path !== 'string' || path.length === 0) return refused('FILE_UNREADABLE');
      return kind === 'backup' ? await backup(path, root) : await statement(path);
    } catch { return refused('FILE_UNREADABLE'); } finally { busy = false; }
  });
}

module.exports = Object.freeze({ PICK_FILE_CHANNEL, PICK_KINDS, STATEMENT_EXTENSIONS, MAX_STATEMENT_BYTES, PICK_REFUSALS, BACKUP_NAME, registerPickFileHandler });
