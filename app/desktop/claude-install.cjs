'use strict';
// D5: only the owner's click starts Install Claude Code. When the window asks, main shows its own native dialog, modal to
// the app window, with words the window has no part in. Cancel is the default and what Escape does; it downloads nothing.
// Only on yes does main tell the engine, over the worker's host channel, which no window, phone or tool can write to. That
// message carries nothing: the engine makes the yes itself (engine.ts installClaudeCodeFor), fresh and for one use.
const CLAUDE_INSTALL_ASK = Object.freeze({
  title: 'Install Claude Code?',
  detail: "Chausar will download Anthropic's official installer from claude.ai and run it, unchanged. You sign in to Claude Code yourself.",
  buttons: Object.freeze(['Download and install', 'Cancel']),
  cancelled: 'Nothing was downloaded.',
  busy: 'Answer the question Chausar is already asking first.',
});
const failure = (code, message) => Object.assign(new Error(message), { code, owner: true });

function createClaudeInstall({ engine, dialog, window }) {
  let asking = false;
  return async function install() {
    if (asking) throw failure('ENGINE_BUSY', CLAUDE_INSTALL_ASK.busy);
    asking = true;
    try {
      const options = { type: 'question', title: CLAUDE_INSTALL_ASK.title, message: CLAUDE_INSTALL_ASK.title, detail: CLAUDE_INSTALL_ASK.detail, buttons: [...CLAUDE_INSTALL_ASK.buttons], defaultId: 1, cancelId: 1, noLink: true };
      const parent = window();
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (answer?.response !== 0) throw failure('CLAUDE_INSTALL_NOT_CHOSEN', CLAUDE_INSTALL_ASK.cancelled);
      const running = engine();
      if (!running) throw failure('ENGINE_UNAVAILABLE', 'Chausar is closing.');
      return await running.installClaude();
    } finally { asking = false; }
  };
}

module.exports = Object.freeze({ CLAUDE_INSTALL_ASK, createClaudeInstall });
