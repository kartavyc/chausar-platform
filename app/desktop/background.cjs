'use strict';
// Wave 6, package 6J1 (D3, D36): work runs while the app runs, so the installed beta can start at login (hidden, in the
// tray) and keeps running in the tray when its window closes. Both are owner settings, shown as ticks in the tray menu
// and kept in the app's own folder. Only the installed beta (release channel "beta") ever registers a login item:
// previews and development runs never do.
// One-shot A5 (founder answer 5; hands-on rows 4, 88, 114, S12, bug 8): start at login is asked in onboarding, ticked
// by default, and changeable in Settings and the tray. Nothing is registered until the owner answers (the first start
// used to register it silently). What the window and the tray show is the computer's own state, read back each time:
// Windows and macOS through Electron's login items (on Windows the user's Run value "Chausar" and its Task Manager
// switch, removed again by the uninstaller), Linux through the XDG autostart file (Electron has no Linux login items).
// A login item the computer's own startup settings switched off stays off at each start; only the owner turning it on
// in Chausar turns it back on. The bundled Codex (resources/codex) goes last on the engine's PATH, so an owner's own
// Codex install is still the one found first.
const path = require('node:path');

const BACKGROUND_FILE = 'background.json';
const LOGIN_ARGS = Object.freeze(['--background', '--hidden']);
const LOGIN_NAME = 'Chausar';
const AUTOSTART_FILE = 'chausar.desktop';

/** startAtLogin here is the suggestion onboarding ticks; it is never applied until the owner answers (asked). */
function defaultsFor(beta) { return { startAtLogin: beta, keepRunning: beta, asked: false }; }
function parseSettings(text, defaults) {
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.startAtLogin !== 'boolean' || typeof value.keepRunning !== 'boolean') return defaults;
    // A5 fix round 3: systemOff, kept only when true, remembers that the computer had switched the login item off.
    return { startAtLogin: value.startAtLogin, keepRunning: value.keepRunning, asked: true, off: value.systemOff === true };
  } catch { return defaults; }
}
/**
 * The program as one quoted Exec argument, by the desktop entry spec (one line): inside the double quotes a backslash
 * goes before each double quote, backtick, dollar sign and backslash; then, Exec being a string value, every backslash
 * is doubled again; and % (which starts a field code) is written %%. A5 fix round 1 added the second and third steps.
 */
function execQuoted(file) {
  const quoted = `"${String(file).replace(/[\r\n]/g, '').replace(/(["`$\\])/g, '\\$1')}"`;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}
/** TryExec takes the bare path, the same one line as Exec, with only its backslashes escaped. */
function tryExecPath(file) { return String(file).replace(/[\r\n]/g, '').replace(/\\/g, '\\\\'); }

/**
 * deps: app (Electron app), fs ({ readFile, writeFile, mkdir, rm }), platform, directory (the app's own folder),
 * home, env, execPath, beta (true only for the packaged beta channel).
 */
function createBackground({ app, fs, platform, directory, home, env = {}, execPath, beta = false }) {
  const defaults = defaultsFor(beta === true);
  const file = path.join(directory, BACKGROUND_FILE);
  const supported = beta === true && (platform === 'win32' || platform === 'linux' || platform === 'darwin');
  const autostartFile = () => path.posix.join(env.XDG_CONFIG_HOME && path.posix.isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : path.posix.join(home, '.config'), 'autostart', AUTOSTART_FILE);
  let current = null;

  /** The saved settings with what the computer last showed of a switch-off (off), for this file only. */
  async function saved() {
    if (current) return { ...current };
    let text = null;
    try { text = await fs.readFile(file, 'utf8'); } catch { text = null; }
    current = text === null ? { ...defaults, off: false } : parseSettings(text, { ...defaults, off: false });
    return { ...current };
  }
  async function settings() {
    const { startAtLogin, keepRunning, asked } = await saved();
    return { startAtLogin, keepRunning, asked };
  }
  async function write(next) {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, JSON.stringify({ startAtLogin: next.startAtLogin, keepRunning: next.keepRunning, ...(next.off ? { systemOff: true } : {}) }), { mode: 0o600 });
    current = { startAtLogin: next.startAtLogin, keepRunning: next.keepRunning, asked: true, off: next.off === true };
  }
  /**
   * The computer's own login item for this program: 'on', 'off' (there, but switched off by the computer's startup
   * settings: Task Manager, the desktop's startup apps, or macOS waiting for approval) or 'none'.
   */
  async function presence() {
    if (!supported) return 'none';
    if (platform === 'win32') {
      const found = app.getLoginItemSettings({ path: execPath, args: [...LOGIN_ARGS] });
      const item = (Array.isArray(found?.launchItems) ? found.launchItems : []).find(entry => entry?.name === LOGIN_NAME && entry.scope === 'user');
      return !item ? 'none' : item.enabled === true ? 'on' : 'off';
    }
    if (platform === 'darwin') {
      const found = app.getLoginItemSettings();
      return found?.openAtLogin === true ? 'on' : found?.status === 'requires-approval' ? 'off' : 'none';
    }
    let text = null;
    try { text = await fs.readFile(autostartFile(), 'utf8'); } catch { text = null; }
    if (text === null) return 'none';
    return /^X-GNOME-Autostart-enabled=false\s*$/m.test(text) || /^Hidden=true\s*$/m.test(text) ? 'off' : 'on';
  }
  /** off (A5 fix round 3): register it switched off, as the computer had it, so a move never switches it back on. */
  async function loginItem(enabled, { off = false } = {}) {
    if (!supported) return;
    if (platform === 'win32') {
      app.setLoginItemSettings({ openAtLogin: enabled, path: execPath, args: [...LOGIN_ARGS], name: LOGIN_NAME, ...(enabled && off ? { enabled: false } : {}) });
      return;
    }
    // macOS: Electron's own login item for the app; a start from it is read as a login start (main.cjs).
    if (platform === 'darwin') { app.setLoginItemSettings({ openAtLogin: enabled }); return; }
    const target = autostartFile();
    if (!enabled) { if (typeof fs.rm === 'function') await fs.rm(target, { force: true }); return; }
    await writeAutostart(autostartEntry(!off, false));
  }
  /** Linux: this program's own autostart entry. switchedOn false (and hidden) keep a switch-off the desktop made. */
  function autostartEntry(switchedOn, hidden) {
    // An AppImage runs from a temporary mount; APPIMAGE names the file the owner keeps, so login starts that one.
    const program = typeof env.APPIMAGE === 'string' && path.posix.isAbsolute(env.APPIMAGE) ? env.APPIMAGE : execPath;
    return ['[Desktop Entry]', 'Type=Application', 'Name=Chausar', 'Comment=Keeps your Chausar work going while you are signed in', `Exec=${execQuoted(program)} ${LOGIN_ARGS.join(' ')}`,
      // TryExec: once the program is gone (a deleted AppImage, or a deb removed with apt) the desktop skips the entry.
      `TryExec=${tryExecPath(program)}`, 'Terminal=false', `X-GNOME-Autostart-enabled=${switchedOn ? 'true' : 'false'}`, ...(hidden ? ['Hidden=true'] : []), ''].join('\n');
  }
  async function writeAutostart(entry) {
    const target = autostartFile();
    await fs.mkdir(path.posix.dirname(target), { recursive: true });
    await fs.writeFile(target, entry, { mode: 0o600 });
  }
  /**
   * A5 fix round 1: Linux, a saved yes with an autostart file that starts another program (an older AppImage the owner
   * replaced, say): written again for this program, keeping a switch-off the desktop made. An up to date file is left.
   */
  async function refreshAutostart() {
    let text = null;
    try { text = await fs.readFile(autostartFile(), 'utf8'); } catch { return; }
    const line = (source, key) => (new RegExp(`^${key}=(.*)$`, 'm').exec(source) ?? [])[1] ?? null;
    const off = /^X-GNOME-Autostart-enabled=false\s*$/m.test(text), hidden = /^Hidden=true\s*$/m.test(text);
    const fresh = autostartEntry(!off, hidden);
    if (line(text, 'Exec') === line(fresh, 'Exec') && line(text, 'TryExec') === line(fresh, 'TryExec')) return;
    await writeAutostart(fresh);
  }
  /**
   * At each start, once the owner has answered: a yes with no login item at all registers one (the program moved, or
   * an update replaced it), and a no removes any that is there. A login item the computer switched off stays off.
   * Unasked, nothing is touched.
   */
  async function apply() {
    if (!supported) return;
    const kept = await saved();
    if (!kept.asked) return;
    const found = await presence();
    // A5 fix round 3: a yes with no login item for this program (it moved) is registered as the computer last had it.
    if (kept.startAtLogin && found === 'none') await loginItem(true, { off: kept.off });
    else if (!kept.startAtLogin && found !== 'none') await loginItem(false);
    else if (kept.startAtLogin && platform === 'linux') await refreshAutostart();
    if (found !== 'none') await remember(found === 'off');
  }
  /**
   * A5 fix round 3: what the computer shows of a switch-off, kept with a saved answer (through the queue, so it never
   * writes over a change), so a later move of the program registers the item as the computer had it.
   */
  function remember(off) {
    const run = queue.then(async () => { const kept = await saved(); if (kept.asked && kept.off !== off) await write({ ...kept, off }); });
    queue = run.then(() => undefined, () => undefined);
    return queue;
  }
  /** What the window and the tray show: the saved settings with the computer's own state of the login item. */
  async function state() { return read(true); }
  /** remembering false inside a change, which already holds the queue. */
  async function read(remembering) {
    const kept = await saved();
    const found = await presence();
    if (remembering && kept.asked && found !== 'none' && kept.off !== (found === 'off')) await remember(found === 'off');
    return { supported, asked: kept.asked, startAtLogin: kept.startAtLogin, keepRunning: kept.keepRunning, registered: found === 'on', systemOff: found === 'off' };
  }
  /**
   * Save a change from onboarding, Settings or the tray menu, apply it at once, and answer the new state. A change of
   * Keep running alone, before start at login was answered, saves what the computer has now, never the suggestion.
   */
  /**
   * A5 fix round 1: changes run one after another (onboarding's save and a tray click can come together), so each reads
   * what the one before it saved; a failed change is reported to its caller and does not stop the next.
   */
  let queue = Promise.resolve();
  function change(update) {
    const run = queue.then(() => changeNow(update));
    queue = run.then(() => undefined, () => undefined);
    return run;
  }
  async function changeNow(update) {
    if (!supported) return read(false);
    const before = await saved();
    const next = { startAtLogin: before.startAtLogin, keepRunning: before.keepRunning, off: before.off };
    // A5 fix round 2: before start at login was answered, a change of Keep running alone saves what the computer has; a
    // login item there but switched off by the computer counts as a yes it switched off (a saved no would remove it).
    if (!before.asked && typeof update?.startAtLogin !== 'boolean') {
      const found = await presence();
      next.startAtLogin = found !== 'none';
      next.off = found === 'off';
    }
    for (const key of ['startAtLogin', 'keepRunning']) if (typeof update?.[key] === 'boolean') next[key] = update[key];
    // The owner's own tick is the owner's act: the item is on (or gone) as they said, never remembered as switched off.
    if (typeof update?.startAtLogin === 'boolean') next.off = false;
    await write(next);
    if (typeof update?.startAtLogin === 'boolean') await loginItem(next.startAtLogin);
    return read(false);
  }
  /** The two ticks for the tray menu, beta only (value: a state()); onChange receives the one setting that changed. */
  function menuItems(value, onChange) {
    if (!supported) return [];
    return [
      { label: 'Start at login', type: 'checkbox', checked: value.registered === true, click: item => onChange({ startAtLogin: item.checked === true }) },
      { label: 'Keep running in the tray', type: 'checkbox', checked: value.keepRunning, click: item => onChange({ keepRunning: item.checked === true }) },
    ];
  }
  return { settings, state, apply, change, menuItems, supported };
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
