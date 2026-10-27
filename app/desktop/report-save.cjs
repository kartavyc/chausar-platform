'use strict';
// Chausar desktop (Ink v2 wave 5, package 5A5, P11): the report:save channel. The window names only the draft; main
// asks the engine to make the report (venture.report.render: the web page, its PDF through this desktop's print port,
// Word and Excel files, and manifest.json), checks each file against the sha256 the engine gave, shows the system
// folder dialog, and writes everything into a new folder there named after the report. The writes go through wave 4's
// atomic export (money-export.cjs stage and commit: each name reserved, each file flushed and renamed into place); the
// folder is made new, so a failure part way takes the whole folder away and nothing is left half written, and a folder
// already there is left alone (EXPORT_EXISTS). Errors reach the window in plain words, never with a path on this
// computer. Chausar never sends the files anywhere. main.cjs passes Electron's dialog, the window and the engine in.
const fsp = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { join } = require('node:path');
const { stage, commit, discard } = require('./money-export.cjs');

const FORMATS = Object.freeze(['html', 'pdf', 'docx', 'xlsx']);
const FILE_NAME = /^[a-z0-9-]{1,80}\.(html|pdf|docx|xlsx)$/;
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
const unmade = () => failure('REQUEST_FAILED', 'The report could not be made.');

/** The request: one draft id. Never a path or a format list: main asks for every format. */
function saveRequest(input) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== 'runId') || typeof input.runId !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.runId)) {
    throw failure('INVALID_REQUEST', 'Choose the draft whose report to save.');
  }
  return { runId: input.runId };
}

/** One file of the engine's answer as bytes, after its name and its sha256 are checked. */
function bytesOf(file, pattern) {
  if (!isRecord(file) || typeof file.name !== 'string' || !pattern.test(file.name) || typeof file.contentBase64 !== 'string' || typeof file.sha256 !== 'string') throw unmade();
  const bytes = Buffer.from(file.contentBase64, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw unmade();
  return { name: file.name, bytes };
}

/**
 * The report:save handler: { ok: true, result: { saved, folder, line } }, { ok: true, result: null } when the owner
 * cancelled, or { ok: false, error } in plain words.
 */
async function saveReport(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const request = saveRequest(input);
    const report = await deps.engine.request('venture.report.render', { runId: request.runId, formats: [...FORMATS] });
    if (!isRecord(report) || !Array.isArray(report.files) || report.files.length === 0 || !isRecord(report.manifest)) throw unmade();
    const files = report.files.map(file => bytesOf(file, FILE_NAME));
    files.push(bytesOf(report.manifest, /^manifest\.json$/));
    if (new Set(files.map(file => file.name)).size !== files.length) throw unmade();
    const name = files[0].name.replace(/\.[a-z]+$/, '');
    const chosen = await deps.dialog.showOpenDialog(deps.window, { title: 'Choose where to save the report', defaultPath: deps.documents, properties: ['openDirectory', 'createDirectory'] });
    if (!chosen || chosen.canceled || !Array.isArray(chosen.filePaths) || typeof chosen.filePaths[0] !== 'string' || chosen.filePaths[0] === '') return { ok: true, result: null };
    const fs = deps.fs ?? fsp;
    const folder = join(chosen.filePaths[0], name);
    try { await fs.mkdir(folder); } catch (error) {
      if (error?.code === 'EEXIST') throw failure('EXPORT_EXISTS', `A folder named ${name} is already there, so Chausar left it alone. Choose another place, or move that folder first.`);
      throw failure('EXPORT_NOT_SAVED', 'Chausar could not make a folder there. Choose another place.');
    }
    const staged = [];
    try {
      for (const file of files) staged.push(await stage(join(folder, file.name), file.bytes, { fs }));
      await commit(staged, fs);
    } catch (error) {
      await discard(staged, fs).catch(() => {});
      await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return { ok: true, result: { saved: true, folder: name, line: `Saved ${files.length} files in the folder ${name}. Chausar did not send them anywhere.` } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ saveReport });
