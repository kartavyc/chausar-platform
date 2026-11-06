// The owner chooses a local transcription program/model. This channel only returns its path;
// the engine validates both files on Save. Nothing is read, executed, installed or downloaded here.
'use strict';
async function pickTranscriptionFile(event, kind, deps) {
  try {
    deps.assertTrustedSender(event, deps.window?.webContents);
    if (kind !== 'command' && kind !== 'model') throw Object.assign(new Error('Choose a transcription program or model file.'), { code: 'INVALID_REQUEST' });
    const picked = await deps.dialog.showOpenDialog(deps.window, {
      title: kind === 'command' ? 'Choose whisper-cli' : 'Choose the whisper model', properties: ['openFile'],
      filters: kind === 'model' ? [{ name: 'Whisper model', extensions: ['bin'] }, { name: 'All files', extensions: ['*'] }] : [{ name: 'Program', extensions: ['*'] }],
    });
    deps.assertTrustedSender(event, deps.window?.webContents);
    return { ok: true, result: picked.canceled ? null : picked.filePaths[0] ?? null };
  } catch (error) { return { ok: false, error: deps.publicError(error) }; }
}
module.exports = Object.freeze({ pickTranscriptionFile });
