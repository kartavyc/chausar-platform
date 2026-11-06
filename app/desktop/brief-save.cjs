'use strict';
// Chausar desktop (C5 task 35): the chausar:brief:saveFile channel. The window names only the builder; this file asks
// the engine for the brief as files (venture.build.briefFile), shows the system save dialog for website-brief.md, and
// puts the builder's note file (AGENTS.md or replit.md) beside it. The dialog asks before it replaces the brief; a note
// file already in that folder may be the owner's own project file, so it is never written over and nothing is saved.
// Both go in together (money-export.cjs stage and commit). The record is marked only after they landed. Chausar sends
// nothing to Lovable or Replit: the owner adds the files there.
const fsp = require('node:fs/promises');
const { basename, dirname, join } = require('node:path');
const { stage, commit, discard } = require('./money-export.cjs');

const NOTE_FILE = /^(?:AGENTS|replit)\.md$/;
function failure(code, message) { return Object.assign(new Error(message), { code }); }
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

/** The request: exactly one builder that takes a file. Never a path. */
function saveRequest(input) {
  if (!isRecord(input) || Object.keys(input).some(key => key !== 'builder') || (input.builder !== 'lovable' && input.builder !== 'replit')) {
    throw failure('INVALID_REQUEST', 'Choose Lovable or Replit.');
  }
  return { builder: input.builder };
}

/** The handler: { ok: true, result: { saved, name, companion } }, { ok: true, result: null } when cancelled, or { ok: false, error }. */
async function saveBriefFile(event, input, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    const request = saveRequest(input);
    const plan = await deps.engine.request('venture.build.briefFile', request);
    const [brief, note] = Array.isArray(plan?.files) ? plan.files : [];
    if (typeof brief?.text !== 'string' || brief.name !== 'website-brief.md' || typeof note?.text !== 'string' || !NOTE_FILE.test(note?.name ?? '')) {
      throw failure('REQUEST_FAILED', 'The brief could not be made into a file.');
    }
    const chosen = await deps.dialog.showSaveDialog(deps.window, {
      title: 'Save your brief', defaultPath: join(deps.documents, brief.name), filters: [{ name: 'Markdown', extensions: ['md'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (!chosen || chosen.canceled || typeof chosen.filePath !== 'string' || chosen.filePath === '') return { ok: true, result: null };
    const fs = deps.fs ?? fsp;
    const notePath = join(dirname(chosen.filePath), note.name);
    if (await fs.stat(notePath).then(() => true, () => false)) {
      throw failure('EXPORT_EXISTS', `${note.name} is already in that folder, so Chausar left it alone. Choose another folder.`);
    }
    const replaceBrief = await fs.stat(chosen.filePath).then(() => true, () => false);
    const staged = [await stage(chosen.filePath, brief.text, { replace: replaceBrief, fs })];
    try {
      staged.push(await stage(notePath, note.text, { fs }));
    } catch (error) {
      await discard(staged, fs);
      throw error;
    }
    await commit(staged, fs);
    await deps.engine.request('venture.build.handoffOpened', { handoffId: plan.handoffId });
    return { ok: true, result: { saved: true, name: basename(chosen.filePath), companion: note.name } };
  } catch (error) {
    return { ok: false, error: deps.publicError(error) };
  }
}

module.exports = Object.freeze({ saveBriefFile });
