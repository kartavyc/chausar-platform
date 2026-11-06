'use strict';
// Chausar 5B2 project handoff. Original desktop boundary over the P12 atomic writer; open-edit (MIT) folder idea only.
const { randomUUID, createHash } = require('node:crypto');
const { resolve, relative, isAbsolute } = require('node:path');
const failure = (code, message) => Object.assign(new Error(message), { code });
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const invalid = () => failure('INVALID_REQUEST', 'Choose the reviewed output board.');
const unsaved = () => failure('EXPORT_NOT_SAVED', 'The project could not be saved. Review its outputs and try again.');

function requestOf(input) {
  if (!record(input) || Object.keys(input).some(key => !['editId', 'digest'].includes(key)) || typeof input.editId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(input.editId) || typeof input.digest !== 'string' || !input.digest || input.digest.length > 2000000) throw invalid();
  return { playbook: 'youtube', kind: 'board', id: input.editId, action: 'export', payload: {}, digest: input.digest };
}
function checked(value, request) {
  if (!record(value) || value.editId !== request.id || value.digest !== request.digest || !/^[A-Za-z0-9_-]{1,100}$/.test(value.orderId) || !Array.isArray(value.files) || !value.files.length || value.files.length > 100 || !record(value.manifest) || !Array.isArray(value.manifest.files) || value.manifest.files.length !== value.files.length) throw unsaved();
  let bytes = 0;
  const names = new Set();
  for (const file of value.files) {
    if (!record(file) || typeof file.path !== 'string' || !/^(exports|metadata|thumbnails|edl)\/[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(file.path) || typeof file.text !== 'string' || names.has(file.path.toLowerCase())) throw unsaved();
    names.add(file.path.toLowerCase()); bytes += Buffer.byteLength(file.text);
    if (bytes > 50000000) throw unsaved();
    const proof = value.manifest.files.filter(proof => proof.path === file.path);
    if (proof.length !== 1 || proof[0].bytes !== Buffer.byteLength(file.text) || proof[0].sha256 !== createHash('sha256').update(file.text).digest('hex')) throw unsaved();
  }
  return value;
}

/** Saved folder handles are held only in this desktop session and cannot be supplied as paths by the page. */
function createYoutubeProject() {
  const saved = new Map();
  return {
    async save(event, input, deps) {
      try {
        deps.assertTrustedSender(event, deps.window?.webContents);
        const request = requestOf(input);
        const before = checked((await deps.engine.request('venture.desk.act', request)).result, request);
        const selected = await deps.dialog.showOpenDialog(deps.window, { title: 'Choose where to save the video project', defaultPath: deps.documents, properties: ['openDirectory', 'createDirectory'] });
        if (!selected || selected.canceled || !Array.isArray(selected.filePaths) || !selected.filePaths[0]) return { ok: true, result: null };
        const after = checked((await deps.engine.request('venture.desk.act', request)).result, request);
        if (JSON.stringify(before) !== JSON.stringify(after)) throw failure('APPROVAL_STALE', 'The outputs changed while you chose a folder. Review them again.');
        const parent = resolve(selected.filePaths[0]);
        const { writeProjectFolder } = await import('../../platform/runtime/venture/playbooks/youtube/project-folder.ts');
        const folder = await writeProjectFolder(parent, after.orderId, after.files);
        const inside = relative(parent, folder);
        if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw unsaved();
        const savedId = randomUUID(); saved.set(savedId, { folder, editId: input.editId });
        return { ok: true, result: { saved: true, savedId, folder: after.orderId, line: 'Saved the reviewed project. Open it in your editor to finish or post.' } };
      } catch (error) { return { ok: false, error: deps.publicError(error) }; }
    },
    async open(event, input, deps) {
      try {
        deps.assertTrustedSender(event, deps.window?.webContents);
        if (!record(input) || Object.keys(input).some(key => key !== 'savedId') || typeof input.savedId !== 'string' || !saved.has(input.savedId)) throw unsaved();
        const entry = saved.get(input.savedId);
        // Reading the board again prevents a saved handle from crossing a locked or different workspace.
        await deps.engine.request('venture.desk.get', { playbook: 'youtube', kind: 'board', id: entry.editId });
        if (await deps.shell.openPath(entry.folder)) throw unsaved();
        return { ok: true, result: { opened: true } };
      } catch (error) { return { ok: false, error: deps.publicError(error) }; }
    },
  };
}
module.exports = Object.freeze({ createYoutubeProject });
