'use strict';
// WK-14 "Chausar is driving", the SH-03 driving banner strip and the SH-07 tray Stop, main side.
//
// The desktop driver and the session state machine live in the engine worker (engine module
// `session.*`). The worker sends an unsolicited `{ kind: 'driving-status', state, active }` message
// whenever the session state changes; the harness ignores messages without an id, so this module
// listens on the worker itself. Main only shows the strip and the tray Stop, and asks the engine to
// act with session.stop and session.resume. The stop key (Ctrl Alt Pause) is grabbed natively by the
// driver in the worker: Electron's globalShortcut cannot register Pause.
//
// The strip is a separate, unfocusable, always-on-top window with JavaScript off, an in-memory
// partition and a data: page whose two links are never followed: will-navigate, will-frame-navigate
// and will-redirect are always prevented, and exactly `chausar-driving:stop` /
// `chausar-driving:continue` (main frame) call the engine.
//
// drivingMenuItems() returns the current Electron menu-item templates for Stop (and Continue while
// paused), or [] when no session is active. The frame-today lane's own tray can splice these into its
// menu (rebuild it on each 'driving-status' change); this module's dedicated tray then becomes
// optional. Engine failures are logged with a fixed method and code only, never message text.
const { join } = require('node:path');
const { publicError } = require('./ipc-contract.cjs');

const STATES = Object.freeze(['idle', 'driving', 'sign-in', 'paused-by-you', 'stopped-by-key', 'stopped', 'step-failed', 'done']);
const ACTIVE_STATES = Object.freeze(['driving', 'sign-in', 'paused-by-you']);
const STOP_URL = 'chausar-driving:stop';
const CONTINUE_URL = 'chausar-driving:continue';
const PARTITION = 'chausar-driving-strip';
const STRIP_WIDTH = 560;
const STRIP_HEIGHT = 40;
const ATTACH_INTERVAL_MS = 500;
const LINK_DEDUPE_MS = 300;
const STRIP_TEXT = Object.freeze({
  driving: { text: 'Chausar is driving. Ctrl Alt Pause to stop.', links: [['Stop', STOP_URL]] },
  'paused-by-you': { text: 'You moved the mouse. Paused.', links: [['Continue', CONTINUE_URL], ['Stop', STOP_URL]] },
  'sign-in': { text: 'Sign in yourself. Chausar continues after.', links: [['Stop', STOP_URL]] },
});

/** The validated status, or null: a plain object with exactly kind, state and active, consistent. */
function drivingStatus(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const prototype = Object.getPrototypeOf(message);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(message);
  if (keys.length !== 3 || !['kind', 'state', 'active'].every(key => keys.includes(key))) return null;
  const { kind, state, active } = message;
  if (kind !== 'driving-status' || typeof state !== 'string' || !STATES.includes(state) || typeof active !== 'boolean') return null;
  if (active !== ACTIVE_STATES.includes(state)) return null;
  return { state, active };
}

function stripHtml(state) {
  const { text, links } = STRIP_TEXT[state];
  const anchors = links.map(([label, href]) => `<a href="${href}">${label}</a>`).join('');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'
    + '<title>Chausar is driving</title><style>'
    + 'html,body{margin:0;height:100%;overflow:hidden;background:#1f2a24;color:#f7f5ee;font:600 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none;cursor:default}'
    + 'main{display:flex;align-items:center;gap:8px;height:100%;padding:0 8px 0 14px;box-sizing:border-box}'
    + 'p{margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + 'a{color:#1f2a24;background:#f7f5ee;text-decoration:none;padding:6px 12px;border-radius:4px}'
    + '</style></head><body><main role="status"><p>' + text + '</p>' + anchors + '</main></body></html>';
}

function stripUrl(state) { return `data:text/html;charset=utf-8,${encodeURIComponent(stripHtml(state))}`; }

function registerDriving({ getEngine, demo, electron = require('electron'), setInterval: every = setInterval, clearInterval: stopEvery = clearInterval, iconPath = join(__dirname, 'icon.png'), now = Date.now }) {
  // Outside an Electron main process (plain Node, where require('electron') is the binary's path) there
  // is nothing to show and no worker to switch on: stay inert.
  if (!electron || typeof electron !== 'object' || !electron.app || typeof electron.app.on !== 'function') {
    return { drivingMenuItems: () => [], state: () => ({ state: 'idle', active: false }), dispose() {} };
  }
  const { app, BrowserWindow, Tray, Menu, nativeImage, screen, session } = electron;
  if (!demo) process.env.CHAUSAR_DESKTOP_DRIVER = '1'; else delete process.env.CHAUSAR_DESKTOP_DRIVER; // demo never drives, whatever the shell set
  const attached = new WeakSet();
  let current = { state: 'idle', active: false };
  let strip = null; let stripState = null; let tray = null; let partitionReady = false; let quitting = false; let disposed = false;

  function call(method) {
    let engine;
    try { engine = getEngine(); } catch { engine = undefined; }
    if (!engine || typeof engine.request !== 'function') { console.error(`Chausar driving: ${method} failed; code=ENGINE_UNAVAILABLE`); return Promise.resolve(); }
    let pending;
    try { pending = Promise.resolve(engine.request(method, {})); } catch (error) { pending = Promise.reject(error); }
    return pending.then(() => undefined, error => { console.error(`Chausar driving: ${method} failed; code=${publicError(error).code}`); });
  }
  const stop = () => call('session.stop');
  const resume = () => call('session.resume');

  function drivingMenuItems() {
    if (!current.active) return [];
    const items = [{ label: 'Stop Chausar driving', click: () => { void stop(); } }];
    if (current.state === 'paused-by-you') items.push({ label: 'Continue', click: () => { void resume(); } });
    return items;
  }

  function closeStrip() {
    const window = strip; strip = null; stripState = null;
    try { if (window && !window.isDestroyed?.()) window.close(); } catch { /* already gone */ }
  }
  function destroyTray() {
    const icon = tray; tray = null;
    try { icon?.destroy(); } catch { /* already gone */ }
  }

  function stripSession() {
    const partition = session.fromPartition(PARTITION);
    if (!partitionReady) {
      partition.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      partition.setPermissionCheckHandler?.(() => false);
      partitionReady = true;
    }
    return partition;
  }

  function showStrip(state) {
    if (strip && strip.isDestroyed?.()) { strip = null; stripState = null; }
    if (!strip) {
      stripSession();
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(STRIP_WIDTH, area.width);
      const window = new BrowserWindow({
        x: Math.round(area.x + (area.width - width) / 2), y: area.y, width, height: STRIP_HEIGHT,
        frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false, movable: false,
        minimizable: false, maximizable: false, fullscreenable: false, closable: true, show: false,
        title: 'Chausar is driving', backgroundColor: '#1f2a24',
        webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION, spellcheck: false },
      });
      window.setAlwaysOnTop(true, 'screen-saver');
      const contents = window.webContents;
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      // Electron 44 reports a click on a link with an unknown scheme as will-frame-navigate only, while
      // other navigations also raise will-navigate: both are always prevented, and either may act for
      // the main frame. The same link within a moment of itself counts once.
      let lastLink = null; let lastAt = -Infinity;
      const navigate = (event, legacyUrl) => {
        try { event.preventDefault(); } catch { /* the navigation is refused either way below */ }
        const url = typeof event?.url === 'string' ? event.url : legacyUrl;
        if (event?.isMainFrame === false || (url !== STOP_URL && url !== CONTINUE_URL)) return;
        const at = now();
        if (url === lastLink && at - lastAt < LINK_DEDUPE_MS) return;
        lastLink = url; lastAt = at;
        if (url === STOP_URL) void stop();
        else if (current.state === 'paused-by-you') void resume();
      };
      contents.on('will-navigate', navigate);
      contents.on('will-frame-navigate', navigate);
      contents.on('will-redirect', event => event.preventDefault());
      window.on('closed', () => { if (strip === window) { strip = null; stripState = null; } });
      strip = window;
    }
    if (stripState !== state) {
      stripState = state;
      void Promise.resolve(strip.loadURL(stripUrl(state))).catch(error => console.error(`Chausar driving: strip failed; code=${publicError(error).code}`));
    }
    if (!strip.isVisible?.()) strip.showInactive();
  }

  function showTray() {
    if (!tray) {
      const icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty?.()) { console.error('Chausar driving: tray failed; code=ICON_MISSING'); return; }
      tray = new Tray(icon);
      tray.setToolTip('Chausar is driving');
    }
    tray.setContextMenu(Menu.buildFromTemplate(drivingMenuItems()));
  }

  function apply(next) {
    if (disposed) return;
    const changed = next.state !== current.state;
    current = next;
    if (!current.active) { closeStrip(); destroyTray(); return; }
    if (quitting) return;
    try { showStrip(current.state); } catch (error) { console.error(`Chausar driving: strip failed; code=${publicError(error).code}`); }
    try { if (changed || !tray) showTray(); } catch (error) { console.error(`Chausar driving: tray failed; code=${publicError(error).code}`); }
  }

  function attach() {
    let worker;
    try { worker = getEngine()?.worker; } catch { worker = undefined; }
    if (!worker || typeof worker.on !== 'function' || attached.has(worker)) return;
    attached.add(worker);
    worker.on('message', message => { const status = drivingStatus(message); if (status) apply(status); });
    // A worker that is gone cannot be driving: take the strip and the tray Stop down with it.
    worker.once?.('exit', () => { if (current.active) apply({ state: 'idle', active: false }); });
  }

  attach();
  const timer = every(attach, ATTACH_INTERVAL_MS);
  timer?.unref?.();
  let watching = true;
  const stopWatching = () => { if (watching) { watching = false; stopEvery(timer); } };
  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    if (current.active) void stop();
  });
  app.on('will-quit', () => { stopWatching(); closeStrip(); destroyTray(); });

  function dispose() { stopWatching(); disposed = true; closeStrip(); destroyTray(); }
  return { drivingMenuItems, state: () => ({ ...current }), dispose };
}

module.exports = Object.freeze({ STATES, ACTIVE_STATES, STOP_URL, CONTINUE_URL, PARTITION, drivingStatus, stripHtml, stripUrl, registerDriving });
