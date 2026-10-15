'use strict';
// The shell calls the design names, each on its own channel, never the engine request channel, and
// each answering only the trusted main frame:
// - SH-10 shell.openExternal: https only, at most 2048 characters, no credentials, no address on this
//   computer or the local network, parsed with URL and re-serialized; one call a second; refused while
//   no workspace is open, except during first run (no vault exists yet) from the new UI's own document.
// - FR-04 shell.print: the system dialog for the current window only; the renderer chooses nothing but
//   which printable kind it has drawn.
// - SH-11 shell.saveText: the system save dialog for one fixed kind (the fault report); the renderer
//   gives the text it shows and nothing else, never a path, a name or a folder.
// - SH-11 crash: whether the last run ended without a clean quit (a marker file main keeps), and the
//   person's answer, which clears it. Nothing is sent from here.
const { assertTrustedSender } = require('./ipc-contract.cjs');

const OPEN_EXTERNAL_CHANNEL = 'chausar:shell-open-external';
const PRINT_CHANNEL = 'chausar:shell-print';
const SAVE_TEXT_CHANNEL = 'chausar:shell-save-text';
const CRASH_STATE_CHANNEL = 'chausar:shell-crash-state';
const CRASH_ANSWER_CHANNEL = 'chausar:shell-crash-answer';
const MAX_URL_LENGTH = 2048;
const MAX_TEXT_LENGTH = 64 * 1024;
const OPEN_INTERVAL_MS = 1000;
const PRINT_KINDS = Object.freeze(['recovery-kit', 'page']);
const SAVE_KINDS = Object.freeze({ 'fault-report': 'chausar-fault-report.txt' });
/** The new UI's own document: the only one that may link out before any vault exists (first run). */
const UI_DOCUMENT = 'chausar://app/ui/index.html';

/** The re-serialized address, or null when it may not leave the app. */
function externalUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) return null;
  // Whitespace and control characters would be dropped silently by the parser: refuse instead.
  if (/[\u0000- \u007f-\u009f]/.test(input)) return null;
  // Only plain ASCII as typed (no look-alike letters, no direction marks) and no backslash, so what the
  // person reads in the dialog is what opens.
  if (/[^!-~]|\\/.test(input)) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  const host = url.hostname.toLowerCase();
  // A named host with a dot: never this computer, a bare local-network name or an address by number.
  if (!host.includes('.') || host.endsWith('.') || host === 'localhost' || host.endsWith('.localhost')
    || host.startsWith('[') || /^[0-9.]+$/.test(host)) return null;
  // Never a name on the local network, and only the default port. Names that resolve to a private address
  // cannot be caught without resolving them; the person's confirmation in the dialog is the control there.
  if (url.port !== '' || /\.(local|lan|internal|localdomain|home\.arpa|intranet|corp)$/.test(host)) return null;
  const href = url.href;
  return href.length <= MAX_URL_LENGTH ? href : null;
}

/** Text a person was shown: a bounded string of printable characters, tabs and line breaks. */
function savableText(input) {
  return typeof input === 'string' && input.length > 0 && input.length <= MAX_TEXT_LENGTH && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input);
}

function registerShellHandlers({ ipcMain, shell, contents, document, workspaceOpen, noVaultYet = async () => false, dialog = null, writeFile = null, crash = null, now = Date.now }) {
  let lastOpen = -Infinity; let printing = false; let lastPrint = -Infinity; let saving = false; let lastSave = -Infinity;
  const trusted = event => { try { assertTrustedSender(event, contents(), document()); return true; } catch { return false; } };
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (event, input) => {
    if (!trusted(event)) return 'refused';
    const href = externalUrl(input);
    if (href === null) return 'refused';
    const at = now();
    if (at - lastOpen < OPEN_INTERVAL_MS) return 'refused';
    lastOpen = at;
    try {
      // First run: before any vault exists, only the new UI's own document may link out; every other rule still holds.
      if (await workspaceOpen() !== true && !(document() === UI_DOCUMENT && await noVaultYet() === true)) return 'refused';
      await shell.openExternal(href);
      return 'opened';
    } catch { return 'refused'; }
  });
  ipcMain.handle(PRINT_CHANNEL, async (event, kind) => {
    if (!trusted(event) || !PRINT_KINDS.includes(kind) || printing) return 'refused';
    const at = now();
    if (at - lastPrint < OPEN_INTERVAL_MS) return 'refused';
    lastPrint = at; printing = true;
    const target = contents();
    try {
      // The system print dialog for this window: nothing from the renderer reaches the options.
      return await new Promise(accept => target.print({ silent: false }, success => accept(success ? 'printed' : 'refused')));
    } catch { return 'refused'; } finally { printing = false; }
  });
  ipcMain.handle(SAVE_TEXT_CHANNEL, async (event, kind, text) => {
    if (!trusted(event) || !Object.hasOwn(SAVE_KINDS, kind) || !savableText(text) || saving || !dialog || !writeFile) return 'refused';
    const at = now();
    if (at - lastSave < OPEN_INTERVAL_MS) return 'refused';
    lastSave = at; saving = true;
    try {
      // The system save dialog chooses the place; the renderer only names the kind, which fixes the suggested name.
      const choice = await dialog.showSaveDialog({ defaultPath: SAVE_KINDS[kind], filters: [{ name: 'Text', extensions: ['txt'] }], properties: ['createDirectory', 'showOverwriteConfirmation'] });
      if (!choice || choice.canceled === true || typeof choice.filePath !== 'string' || choice.filePath.length === 0) return 'cancelled';
      await writeFile(choice.filePath, text, { encoding: 'utf8', mode: 0o600 });
      return 'saved';
    } catch { return 'refused'; } finally { saving = false; }
  });
  ipcMain.handle(CRASH_STATE_CHANNEL, async event => (trusted(event) && crash?.crashed() === true ? 'crashed' : 'clean'));
  ipcMain.handle(CRASH_ANSWER_CHANNEL, async (event, answer) => {
    if (!trusted(event) || (answer !== 'send' && answer !== 'dont-send') || !crash) return 'refused';
    // Either answer clears the question; sending itself goes through the engine, which refuses until an endpoint exists.
    crash.answered();
    return 'answered';
  });
}

/**
 * The unclean-exit marker: written at start, removed on a clean quit. Found at start, the last run ended
 * without quitting (a crash, a kill or a power cut). The marker holds no data; every file call is guarded.
 */
function createCrashMarker({ path, readFile, writeFile, unlink }) {
  let crashed = false;
  return Object.freeze({
    async start() {
      try { await readFile(path); crashed = true; } catch { crashed = false; }
      try { await writeFile(path, 'running', { mode: 0o600 }); } catch { /* No marker: a crash then goes unnoticed, never a false one. */ }
    },
    async clean() { try { await unlink(path); } catch { /* Already gone. */ } },
    crashed: () => crashed,
    answered() { crashed = false; },
  });
}

module.exports = Object.freeze({ OPEN_EXTERNAL_CHANNEL, PRINT_CHANNEL, SAVE_TEXT_CHANNEL, CRASH_STATE_CHANNEL, CRASH_ANSWER_CHANNEL, MAX_URL_LENGTH, MAX_TEXT_LENGTH,
  OPEN_INTERVAL_MS, PRINT_KINDS, SAVE_KINDS, UI_DOCUMENT, externalUrl, savableText, registerShellHandlers, createCrashMarker });
