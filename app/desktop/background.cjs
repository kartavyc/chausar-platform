'use strict';
// Wave 6, package 6J1 (D3, D36): work runs while the app runs, so the installed beta starts at login (hidden, in the
// tray) and keeps running in the tray when its window closes. Both are owner settings with those defaults, shown as
// ticks in the tray menu and kept in the app's own folder. Only the installed beta (release channel "beta") ever
// registers a login item: previews and development runs never do, and Mac is out of scope for the beta.
// Windows uses Electron's login item (one registry value named "Chausar", removed again by the uninstaller); Linux
// has no Electron login items, so an XDG autostart file is the login item. The bundled Codex (resources/codex) goes
// last on the engine's PATH, so an owner's own Codex install is still the one found first.
const path = require('node:path');

const BACKGROUND_FILE = 'background.json';
const LOGIN_ARGS = Object.freeze(['--background', '--hidden']);
const LOGIN_NAME = 'Chausar';
const AUTOSTART_FILE = 'chausar.desktop';

function defaultsFor(beta) { return { startAtLogin: beta, keepRunning: beta }; }
function parseSettings(text, defaults) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.startAtLogin !== 'boolean' || typeof value.keepRunning !== 'boolean') return defaults;
    return { startAtLogin: value.startAtLogin, keepRunning: value.keepRunning };
  } catch { return defaults; }
}
/** A desktop entry field holds one line; a path is quoted for Exec and its quotes and backslashes escaped. */
function execQuoted(file) { return `"${String(file).replace(/[\r\n]/g, '').replace(/(["`$\\])/g, '\\$1')}"`; }
/** TryExec takes the bare path, the same one line as Exec, with only its backslashes escaped. */
function tryExecPath(file) { return String(file).replace(/[\r\n]/g, '').replace(/\\/g, '\\\\'); }

/**
 * deps: app (Electron app), fs ({ readFile, writeFile, mkdir, rm }), platform, directory (the app's own folder),
 * home, env, execPath, beta (true only for the packaged beta channel).
 */
function createBackground({ app, fs, platform, directory, home, env = {}, execPath, beta = false }) {
  const defaults = defaultsFor(beta === true);
  const file = path.join(directory, BACKGROUND_FILE);
  const supported = beta === true && (platform === 'win32' || platform === 'linux');
  const autostartFile = () => path.posix.join(env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(home, '.config'), 'autostart', AUTOSTART_FILE);
  let current = null;

  async function settings() {
    if (current) return { ...current };
    let text = null;
    try { text = await fs.readFile(file, 'utf8'); } catch { text = null; }
    current = text === null ? defaults : parseSettings(text, defaults);
    return { ...current };
  }
  async function loginItem(enabled) {
    if (!supported) return;
    if (platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: execPath, args: [...LOGIN_ARGS], name: LOGIN_NAME });
      return;
    }
    const target = autostartFile();
    if (!enabled) { if (typeof fs.rm === 'function') await fs.rm(target, { force: true }); return; }
    // An AppImage runs from a temporary mount; APPIMAGE names the file the owner keeps, so login starts that one.
    const program = typeof env.APPIMAGE === 'string' && path.posix.isAbsolute(env.APPIMAGE) ? env.APPIMAGE : execPath;
    const entry = ['[Desktop Entry]', 'Type=Application', 'Name=Chausar', 'Comment=Keeps your Chausar work going while you are signed in', `Exec=${execQuoted(program)} ${LOGIN_ARGS.join(' ')}`,
      // TryExec: once the program is gone (a deleted AppImage, or a deb removed with apt) the desktop skips the entry.
      `TryExec=${tryExecPath(program)}`, 'Terminal=false', 'X-GNOME-Autostart-enabled=true', ''].join('\n');
    await fs.mkdir(path.posix.dirname(target), { recursive: true });
    await fs.writeFile(target, entry, { mode: 0o600 });
  }
  /** Bring the login item in line with the saved setting (the first beta run registers the default). */
  async function apply() { if (supported) await loginItem((await settings()).startAtLogin); }
  /** Save a change from the tray menu and apply it at once. */
  async function change(update) {
    const next = { ...(await settings()) };
    for (const key of ['startAtLogin', 'keepRunning']) if (typeof update?.[key] === 'boolean') next[key] = update[key];
    current = next;
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, JSON.stringify(next), { mode: 0o600 });
    if (typeof update?.startAtLogin === 'boolean') await loginItem(next.startAtLogin);
    return { ...next };
  }
  /** The two ticks for the tray menu, beta only; onChange receives the one setting that changed. */
  function menuItems(value, onChange) {
    if (!supported) return [];
    return [
      { label: 'Start at login', type: 'checkbox', checked: value.startAtLogin, click: item => onChange({ startAtLogin: item.checked === true }) },
      { label: 'Keep running in the tray', type: 'checkbox', checked: value.keepRunning, click: item => onChange({ keepRunning: item.checked === true }) },
    ];
  }
  return { settings, apply, change, menuItems, supported };
}

/** The engine's environment with the bundled Codex folder last on PATH, when the bundle is there. */
function bundledCodexEnvironment(environment, { resourcesPath, platform, exists }) {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const folder = join(resourcesPath, 'codex', 'bin');
  if (!exists(join(folder, platform === 'win32' ? 'codex.exe' : 'codex'))) return { ...environment };
  const result = { ...environment };
  const key = Object.keys(result).find(name => /^path$/i.test(name)) ?? 'PATH';
  const separator = platform === 'win32' ? ';' : ':';
  const entries = typeof result[key] === 'string' && result[key] ? result[key].split(separator) : [];
  if (!entries.includes(folder)) entries.push(folder);
  result[key] = entries.join(separator);
  // A2: where the bundle is, so the engine loads the setup the build recorded for it (platform/runtime/codex-trust.ts).
  result.CHAUSAR_CODEX_BUNDLE_DIR = join(resourcesPath, 'codex');
  return result;
}

module.exports = { createBackground, bundledCodexEnvironment, BACKGROUND_FILE, LOGIN_ARGS, LOGIN_NAME };
