'use strict';
// Chausar desktop (review of A1, row 1): the exports:show channel. After Delete, the copies the owner exported to keep
// stay in Chausar's exports folder, and the window may ask to show one in the system file manager. The window names only
// the file, as Chausar names an export (chausar-<workspace id>-<time>.vault or .json, or a CA pack's ca-<month>.csv); this file shows that file of the
// exports folder and nothing else, never a path the window wrote.
const { stat } = require('node:fs/promises');
const { join, relative } = require('node:path');
const failure = (code, message) => Object.assign(new Error(message), { code });
const EXPORT_NAME = /^chausar-[A-Za-z0-9_-]{1,120}-(?:\d{1,16}\.(?:vault|json)|ca-\d{4}-\d{2}(?:\.csv|-receipts\.json))$/;

async function showExport(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const name = input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 1 ? input.name : undefined;
    if (typeof name !== 'string' || !EXPORT_NAME.test(name)) throw failure('INVALID_REQUEST', 'Choose one of the copies Chausar exported.');
    const path = join(deps.exportsFolder, name);
    if (relative(deps.exportsFolder, path) !== name) throw failure('INVALID_REQUEST', 'Choose one of the copies Chausar exported.');
    const found = await stat(path).catch(() => null);
    if (!found || !found.isFile()) throw failure('EXPORT_NOT_FOUND', 'That copy is not in the exports folder any more.');
    deps.shell.showItemInFolder(path);
    return { ok: true };
  } catch (error) { return { ok: false, error: deps.publicError(error) }; }
}

module.exports = Object.freeze({ showExport, EXPORT_NAME });
