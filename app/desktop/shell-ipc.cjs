'use strict';
// The two shell calls the design names (SH-10 shell.openExternal, FR-04 shell.print), each on
// its own channel, never the engine request channel. Both answer only the trusted main frame.
// openExternal: https only, at most 2048 characters, no credentials, no address on this
// computer or the local network, parsed with URL and re-serialized; one call a second; refused
// while no workspace is open. print: the system dialog for the current window only; the
// renderer chooses nothing but which printable kind it has drawn.
const { assertTrustedSender } = require('./ipc-contract.cjs');

const OPEN_EXTERNAL_CHANNEL = 'chausar:shell-open-external';
const PRINT_CHANNEL = 'chausar:shell-print';
const MAX_URL_LENGTH = 2048;
const OPEN_INTERVAL_MS = 1000;
const PRINT_KINDS = Object.freeze(['recovery-kit', 'page']);

/** The re-serialized address, or null when it may not leave the app. */
function externalUrl(input) {
  if (typeof input !== 'string' || input.length === 0 || input.length > MAX_URL_LENGTH) return null;
  // Whitespace and control characters would be dropped silently by the parser: refuse instead.
  if (/[\u0000- \u007f-\u009f]/.test(input)) return null;
  // Only plain ASCII as typed (no look-alike letters, no direction marks) and no backslash, so what the
  // person reads in the dialog is what opens.
  if (/[^\u0021-\u007e]|\\/.test(input)) return null;
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

function registerShellHandlers({ ipcMain, shell, contents, document, workspaceOpen, now = Date.now }) {
  let lastOpen = -Infinity; let printing = false; let lastPrint = -Infinity;
  const trusted = event => { try { assertTrustedSender(event, contents(), document()); return true; } catch { return false; } };
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (event, input) => {
    if (!trusted(event)) return 'refused';
    const href = externalUrl(input);
    if (href === null) return 'refused';
    const at = now();
    if (at - lastOpen < OPEN_INTERVAL_MS) return 'refused';
    lastOpen = at;
    try {
      if (await workspaceOpen() !== true) return 'refused';
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
}

module.exports = Object.freeze({ OPEN_EXTERNAL_CHANNEL, PRINT_CHANNEL, MAX_URL_LENGTH, OPEN_INTERVAL_MS, PRINT_KINDS, externalUrl, registerShellHandlers });
