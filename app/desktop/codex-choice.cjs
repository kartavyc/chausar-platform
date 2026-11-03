'use strict';
// A2 second review: only the owner's click can approve a Codex. When the window asks for venture.ai.setup.trust, main
// asks the engine for its held review of that exact program (codexChoiceFor, over the worker's host channel), shows its
// own native dialog, modal to the app window, naming the real program path and version from that review (never from
// the window's payload), and only on "Use this Codex" sends the confirmation. Cancel is the default and what Escape
// does; it records nothing. A Codex already in use (the owner's earlier choice, or the bundled one) is not asked again.

const CODEX_CHOICE_WORDS = Object.freeze({
  title: 'Use this Codex?',
  detail: (version, path) => `Chausar will run Codex ${version} from ${path} for your AI work.`,
  buttons: Object.freeze(['Use this Codex', 'Cancel']),
  cancelled: "Nothing changed. Codex wasn't chosen.",
  busy: 'Answer the question Chausar is already asking first.',
});
const failure = (code, message) => Object.assign(new Error(message), { code });
const plain = (value, limit) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f]/.test(value);

/** engine: the harness (codexChoice, confirmCodex); dialog: Electron's dialog; window: the app window, read at each use. */
function createCodexChoice({ engine, dialog, window }) {
  let asking = false;
  return async function choose(payload) {
    if (asking) throw failure('ENGINE_BUSY', CODEX_CHOICE_WORDS.busy);
    asking = true;
    try {
      const asked = { cli: payload?.cli, sha256: payload?.sha256 };
      const held = await engine.codexChoice(asked);
      if (held && typeof held === 'object' && Object.hasOwn(held, 'inUse')) return { setup: held.inUse };
      if (!held || !plain(held.path, 4096) || !plain(held.version, 64)) throw failure('CODEX_SETUP_CHANGED', 'That Codex changed since you looked at it. Check it again.');
      const options = {
        type: 'question', title: CODEX_CHOICE_WORDS.title, message: CODEX_CHOICE_WORDS.title, detail: CODEX_CHOICE_WORDS.detail(held.version, held.path),
        buttons: [...CODEX_CHOICE_WORDS.buttons], defaultId: 1, cancelId: 1, noLink: true,
      };
      const parent = typeof window === 'function' ? window() : window;
      const answer = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (answer?.response !== 0) throw failure('CODEX_NOT_CHOSEN', CODEX_CHOICE_WORDS.cancelled);
      return await engine.confirmCodex(asked);
    } finally { asking = false; }
  };
}

module.exports = { createCodexChoice, CODEX_CHOICE_WORDS };
