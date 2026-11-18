import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(new URL('../../app/desktop/main.cjs', import.meta.url));
const flush = () => new Promise<void>(accept => setImmediate(accept));

// options (Ink v2 wave 4, 4G3): files, the Ink build's file names; written, the files main.cjs wrote (kept across runs).
// channel (6J1): the packaged release channel; 'beta' is the installed, unsigned beta with real data.
async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), production = false, options: { files?: string[]; written?: Set<string>; channel?: string; whatsapp?: string; openFails?: (url: string) => boolean; platform?: string; metadata?: Record<string, unknown>; updates?: any; startFails?: boolean[]; pending?: string; order?: unknown[]; lock?: boolean[]; slowDisk?: boolean; startGate?: Promise<void> } = {}) {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>(), errors: string[] = [];
  const trays: any[] = [], notes: any[] = [], written = options.written ?? new Set<string>(), logins: any[] = [], appMenus: unknown[] = [];
  let protocolHandler: ((request: { url: string }) => Promise<Response>) | null = null;
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  // A5: the computer's login items as Electron reads them back (Windows launch items, this program's only).
  const run = new Map<string, any>();
  app.setLoginItemSettings = (settings: any) => { logins.push(JSON.parse(JSON.stringify(settings))); if (settings.openAtLogin) run.set(settings.name, { path: settings.path, args: settings.args, enabled: true }); else run.delete(settings.name); };
  app.loginRun = run;
  app.getLoginItemSettings = (options: any) => ({ openAtLogin: false, launchItems: [...run].filter(([, item]) => item.path === options?.path).map(([name, item]) => ({ name, path: item.path, args: item.args, scope: 'user', enabled: item.enabled })) });
  // A6: the app this computer has for whatsapp:// links ('' when none), as Electron reads it.
  app.getApplicationNameForProtocol = (protocol: string) => (protocol === 'whatsapp://' ? options.whatsapp ?? '' : '');
  const opened: string[] = [], openedPaths: string[] = [], shownItems: string[] = [];
  // C5 task 25: the crash reporter, the process's own error events and the lines main.cjs writes (a stand-in file system).
  const crashStarts: unknown[] = [], processHandlers = new Map<string, (error: unknown) => void>(), logged: { path: string; text: string }[] = [];
  const shell = { openExternal: async (url: string) => { if (options.openFails?.(url)) throw new Error('No app for this link.'); opened.push(url); }, openPath: async (path: string) => { openedPaths.push(path); return ''; }, showItemInFolder: (path: string) => { shownItems.push(path); } };
  // 15 Nov 2026 (quit when asked): the lock's answers in order (true once they run out), what each ask carried, the
  // exit codes, and the hidden windows main.cjs makes to hear the session end (Electron's BaseWindow).
  app.lockAsks = [] as unknown[]; app.exits = [] as number[]; app.released = 0; const watchers: any[] = [];
  app.exit = (code: number) => { app.exits.push(code); }; app.releaseSingleInstanceLock = () => { app.released++; };
  class Watcher extends EventEmitter { options: any; destroyed = false; constructor(options: any) { super(); this.options = options; watchers.push(this); } destroy() { this.destroyed = true; this.emit('closed'); } }
  app.requestSingleInstanceLock = (data?: unknown) => { app.lockAsks.push(data ?? null); return options.lock?.length ? options.lock.shift() : true; }; app.whenReady = () => Promise.resolve(); app.quit = () => { app.quits++; app.loggedAtQuit.push(logged.length); };
  // How many diagnostics lines had reached the file at each quit.
  app.loggedAtQuit = [] as number[];
  // D11 release smoke: the paths main.cjs sets before ready. As in Electron, a path that was set is the one read back.
  app.setPaths = [] as [string, string][]; app.setPath = (name: string, value: string) => { app.setPaths.push([name, value]); };
  app.getPath = (name: string) => app.setPaths.findLast(([set]: [string, string]) => set === name)?.[1] ?? '/owned/app';
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.sent = []; this.webContents.send = (channel: string, value: unknown) => { this.webContents.sent.push([channel, value]); }; windows.push(this); }
    urls: string[] = [];
    loadURL(url: string) { this.webContents.mainFrame.url = url; this.urls.push(url); }
    shows = 0;
    show() { this.shows++; } focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
    menuBar: boolean[] = [];
    setMenuBarVisibility(visible: boolean) { this.menuBar.push(visible); }
    // Ink v2 wave 4 (4G1): what main.cjs reads to tell the engine whether the owner is watching.
    visible = true; focused = false; minimized = false;
    isVisible() { return this.visible; } isFocused() { return this.focused; }
  }
  const startFails: boolean[] = options.startFails ?? [], order: unknown[] = options.order ?? [];
  class Harness extends EventEmitter {
    state = 'ready'; options: any; stops = 0;
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    asked: string[] = [];
    // startGate: the worker takes this long to say it is ready (a slow first start).
    async start() { if (options.startGate) { this.state = 'starting'; await options.startGate; this.state = 'ready'; } if (startFails.shift() === true) throw new Error('The worker did not start.'); }
    async request(method: string) { this.asked.push(method); return { method, experimental: true }; }
    // C5 task 29: the worker dies: the real harness says failed, then exit.
    die() { this.state = 'failed'; this.emit('status', { state: 'failed', healthy: false }); this.emit('exit', { code: 1, signal: null }); }
    reconnecting() { this.state = 'reconnecting'; this.emit('status', { state: 'reconnecting', healthy: false }); }
    async stop() { this.stops++; order.push('engine stopped'); this.state = 'stopped'; return { graceful: true, forced: false }; }
    async prepareUpdateInstall(input: unknown) { order.push('prepared'); order.push(plain(input)); return { busy: false, openDataSchema: 1, backup: 'made' }; }
    watching: boolean[] = [];
    reportWatching(value: boolean) { this.watching.push(value); return true; }
  }
  class Tray extends EventEmitter {
    tooltips: string[] = []; balloons: any[] = [];
    constructor() { super(); trays.push(this); }
    setToolTip(text: string) { this.tooltips.push(text); } setContextMenu(menu: any) { menus.push(menu); } displayBalloon(balloon: any) { this.balloons.push(balloon); } destroy() {}
  }
  // Ink v2 wave 4 (4G3): the OS notification main.cjs shows for a count.
  class Notification extends EventEmitter {
    static isSupported() { return true; }
    options: any; shown = 0; closed = 0;
    constructor(options: any) { super(); this.options = options; notes.push(this); }
    show() { this.shown++; } close() { this.closed++; }
  }
  // 15 Nov 2026: what main.cjs told the session about spell checking, with how many windows existed then.
  const spellChecks: [boolean, number][] = [];
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} }, setSpellCheckerEnabled: (on: boolean) => { spellChecks.push([on, windows.length]); } } };
  const powerMonitor = new EventEmitter();
  const electron = { app, shell, crashReporter: { start: (settings: unknown) => { crashStarts.push(settings); } }, BrowserWindow: Window, BaseWindow: Watcher, Tray, Notification, powerMonitor, Menu: { buildFromTemplate: (items: any) => items, setApplicationMenu: (menu: unknown) => { appMenus.push(menu); } }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme: string, handler: any) => { protocolHandler = handler; } }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  let source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('./ipc-contract.cjs');
    if (name === './money-export.cjs') return require('./money-export.cjs');
    if (name === './updates.cjs' && options.updates) return options.updates;
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('pending-release.json') && options.pending) return options.pending; if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !production, version: '2.3.4', ...(options.channel ? { chausarReleaseChannel: options.channel } : {}), ...options.metadata }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      // slowDisk: a line takes a turn of the event loop to reach the file, as a real disk does.
      appendFile: async (path: string, text: string) => { if (options.slowDisk) await new Promise(done => setImmediate(done)); logged.push({ path: String(path), text }); }, stat: async () => { throw Object.assign(new Error('No file.'), { code: 'ENOENT' }); }, rename: async () => {},
      writeFile: async (path: string, _data: unknown, flags: any) => { if (flags?.flag === 'wx' && written.has(path)) throw Object.assign(new Error('The file exists.'), { code: 'EEXIST' }); written.add(path); },
      // A one-page Ink build in app/ui/dist, which main.cjs lists before it starts anything.
      readdir: async () => (options.files ?? ['index.html']).map(name => ({ name, isDirectory: () => false, isFile: () => true })) };
    return require(name);
  }, process: { argv: ['electron', '/owned/app', ...args], env: {}, platform: options.platform ?? 'win32', resourcesPath: '/owned/resources', execPath: '/owned/app/Chausar.exe', on: (name: string, handler: (error: unknown) => void) => { processHandlers.set(name, handler); } }, console: { error() {} }, URL, Response, Buffer,
    // Looked up at each call, so a test's mocked timers reach main.cjs too.
    setTimeout: (...parts: Parameters<typeof setTimeout>) => setTimeout(...parts), clearTimeout: (timer: any) => clearTimeout(timer) });
  await flush();
  return { app, windows, engines, menus, errors, handlers, powerMonitor, trays, notes, written, logins, appMenus, opened, openedPaths, shownItems, crashStarts, processHandlers, logged, order, watchers, spellChecks, protocol: () => protocolHandler };
}

test('packaged preview forces synthetic worker and enforces the isolated window IPC envelope', async () => {
  const d = await desktop([]); assert.equal(d.errors.length, 0); assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '1');
  assert.equal(d.engines[0].options.environment.CHAUSAR_ENGINE_VERSION, '2.3.4');
  const window = d.windows[0]; assert.match(window.options.title, /synthetic data/);
  assert.equal(window.options.webPreferences.sandbox, true); assert.equal(window.options.webPreferences.contextIsolation, true); assert.equal(window.options.webPreferences.nodeIntegration, false); assert.equal(window.webContents.open().action, 'deny');
  const handler = d.handlers.get('chausar:request');
  const reply = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { method: 'workspace.status', payload: {} });
  assert.equal(reply.ok, true); assert.equal(reply.result.experimental, true);
  const refusal = await handler({ sender: {}, senderFrame: window.webContents.mainFrame }, { method: 'workspace.status' }); assert.equal(refusal.ok, false); assert.equal(refusal.error.code, 'UNTRUSTED_SENDER');
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 1);
});

test('background process exposes Open/Quit and drains once without startup persistence', async () => {
  const d = await desktop(['--background']); assert.equal(d.menus.length, 1); d.windows[0].emit('closed');
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 0);
  d.app.emit('second-instance'); assert.equal(d.windows.length, 2);
  d.menus[0][2].click(); assert.equal(d.app.quits, 1);
  let prevented = false; d.app.emit('before-quit', { preventDefault: () => { prevented = true; } }); await flush();
  assert.equal(prevented, true); assert.equal(d.engines[0].stops, 1);
});

test('unsigned packaged preview refuses explicit production mode before starting a worker', async () => {
  const d = await desktop(['--production']); assert.match(d.errors[0], /synthetic data only/); assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0); assert.equal(d.app.quits, 1);
});

test('the real desktop starts its file worker without starting a bundled database', async () => {
  const d = await desktop(['--production'], Promise.resolve(), true);
  assert.equal(d.errors.length, 0);
  assert.equal([...d.written].some(path => path.includes("database")), false);
  assert.equal(d.engines.length, 1);
  assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '0');
  assert.equal(d.engines[0].options.environment.CHAUSAR_POSTGRES_URL, undefined);
});

// One-shot A4 (hands-on row 107): the worker runs from app.asar.unpacked; the Ink build stays inside the archive, so
// main tells the worker where it is, or a pairing link answers "The Ink app is not built".
test('the worker is told where the Ink build is, for the phone server', async () => {
  const d = await desktop(['--production'], Promise.resolve(), true);
  assert.equal(d.engines[0].options.environment.CHAUSAR_INK_ROOT, require('node:path').join(require('node:path').resolve('/owned/app/app/desktop', '../..'), 'app/ui/dist'));
});

// One-shot A4 (hands-on S10): the window had Electron's default menu bar (File, Edit, View, Window). On Windows and
// Linux there is none; typing shortcuts still work in the page.
test('the window has no default menu bar on Windows, and the zoom keys still work', async () => {
  const d = await desktop(['--production'], Promise.resolve(), true);
  // A4 review (L7): a hidden menu keeps Ctrl+=, Ctrl+- and Ctrl+0 (and the editing keys); its bar is never shown.
  assert.equal(d.appMenus.length, 1);
  const roles = (d.appMenus[0] as any[]).flatMap((menu: any) => menu.submenu).map((item: any) => [item.role, item.accelerator ?? null]);
  for (const role of ['zoomIn', 'zoomOut', 'resetZoom', 'copy', 'paste', 'selectAll']) assert.ok(roles.some(([name]: any) => name === role), role);
  assert.ok(roles.some(([name, key]: any) => name === 'zoomIn' && key === 'CommandOrControl+='), 'Ctrl+= zooms in');
  assert.deepEqual(d.windows[0].menuBar, [false]);
});

test('quit awaits in-flight startup and never opens a window or starts a late worker', async () => {
  let release!: () => void; const gate = new Promise<void>(accept => { release = accept; });
  const d = await desktop([], gate);
  d.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(d.app.quits, 0); assert.equal(d.engines.length, 0);
  release(); await flush();
  assert.equal(d.app.quits, 1); assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0); assert.equal(d.errors.length, 0);
});

test('desktop tells the engine the owner is watching only while the window is shown, not minimised and focused (4G1)', async () => {
  const d = await desktop([]);
  const window = d.windows[0], engine = d.engines[0];
  // isMinimized is read from the field the window keeps, the way Electron answers it.
  window.isMinimized = () => window.minimized;
  window.focused = true; window.emit('focus');
  window.focused = false; window.emit('blur');
  window.focused = true; window.emit('focus');
  window.minimized = true; window.emit('minimize');
  window.minimized = false; window.emit('restore');
  window.visible = false; window.emit('hide');
  window.visible = true; window.emit('show');
  window.emit('closed');
  assert.deepEqual(engine.watching, [true, false, true, false, true, false, true, false]);
});

// ---------------------------------------------------------------------------
// Ink v2 wave 4, package 4G3 (O13, O23): the tray count, the OS notification, the one-time balloon, busy and idle,
// the tray icon, and the Ink build's icons and manifest
// ---------------------------------------------------------------------------

const AT = '2026-10-26T09:00:00.000Z';
const runEvent = (type: string, fields: Record<string, unknown> = {}) => ({ type, businessId: 'main', at: AT, ...fields });
// What main.cjs builds lives in its own realm: copied out as plain values before deep comparisons.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const labels = (menu: any[]) => Array.from(menu, item => item.label ?? item.type);
const APPROVE = 'chausar://app/index.html#/approve/next';

test('the tray is there in every mode, with Open and Quit, so the count it shows is true (4G3)', async () => {
  const d = await desktop([]);
  assert.equal(d.trays.length, 1, 'a foreground window has the tray too');
  assert.deepEqual(labels(d.menus.at(-1)), ['Open Chausar', 'separator', 'Quit Chausar and stop jobs']);
  assert.equal(d.trays[0].tooltips.at(-1), 'Chausar Preview (synthetic data)');
  assert.equal(d.windows[0].options.title, 'Chausar Preview (synthetic data)');
});

test('notify.new with a count: "Chausar: 3 need you" in the tooltip, "3 need you" in the menu, one OS notification with the count alone (4G3)', async () => {
  const d = await desktop([], Promise.resolve(), true);
  const tray = d.trays[0], engine = d.engines[0], window = d.windows[0];
  assert.equal(tray.tooltips.at(-1), 'Chausar');
  // The centre changed without an alert: nothing outside the app.
  engine.emit('venture-event', runEvent('notify.new'));
  assert.equal(d.notes.length, 0);
  assert.equal(tray.tooltips.at(-1), 'Chausar');
  engine.emit('venture-event', runEvent('notify.new', { count: 3, seq: 9 }));
  assert.equal(tray.tooltips.at(-1), 'Chausar: 3 need you');
  const menu = d.menus.at(-1);
  assert.deepEqual(labels(menu), ['3 need you', 'separator', 'Open Chausar', 'separator', 'Quit Chausar and stop jobs']);
  assert.equal(d.notes.length, 1);
  assert.deepEqual(plain(d.notes[0].options), { title: 'Chausar', body: '3 need you' }, 'the count and nothing else');
  assert.equal(d.notes[0].shown, 1);
  // The menu line opens the window at the approval page, and so does a tap on the notification. Neither decides anything.
  menu[0].click();
  assert.equal(window.urls.at(-1), APPROVE);
  window.urls.length = 0;
  d.notes[0].emit('click');
  assert.deepEqual(window.urls, [APPROVE]);
  // A newer count replaces the older notification.
  engine.emit('venture-event', runEvent('notify.new', { count: 1 }));
  assert.equal(d.notes[0].closed, 1);
  assert.equal(d.notes[1].options.body, '1 needs you');
  assert.equal(tray.tooltips.at(-1), 'Chausar: 1 needs you');
  // The owner looks at the window: the count was news since they last looked, so it is cleared, never left stale.
  window.focused = true; window.emit('focus');
  assert.equal(tray.tooltips.at(-1), 'Chausar');
  assert.deepEqual(labels(d.menus.at(-1)), ['Open Chausar', 'separator', 'Quit Chausar and stop jobs']);
  assert.equal(d.notes[1].closed, 1);
});

test('the count reaches the window on notify.new alone: the IPC contract has no separate count channel (4G3)', () => {
  const contract = require('./ipc-contract.cjs');
  assert.equal(Object.hasOwn(contract, 'NOTIFY_COUNT_CHANNEL'), false);
  assert.equal(JSON.stringify(Object.values(contract).filter(value => typeof value === 'string')).includes('notify:count'), false);
});

test('with the window closed in the background, the count line opens a new window at the approval page (4G3)', async () => {
  const d = await desktop(['--background']);
  d.windows[0].emit('closed');
  d.engines[0].emit('venture-event', runEvent('notify.new', { count: 2 }));
  d.menus.at(-1)[0].click();
  assert.equal(d.windows.length, 2);
  assert.deepEqual(d.windows[1].urls, [APPROVE]);
});

test('the first time the window closes in the background on Windows, one balloon says Chausar is still running, and never again (O23)', async () => {
  const written = new Set<string>();
  const d = await desktop(['--background'], Promise.resolve(), undefined, { written });
  d.windows[0].emit('closed'); await flush();
  assert.deepEqual(plain(d.trays[0].balloons), [{ title: 'Chausar', content: 'Chausar is still running. It keeps your scheduled checks going.', iconType: 'info' }]);
  d.app.emit('second-instance'); d.windows[1].emit('closed'); await flush();
  assert.equal(d.trays[0].balloons.length, 1, 'not twice in one run');
  const later = await desktop(['--background'], Promise.resolve(), undefined, { written });
  later.windows[0].emit('closed'); await flush();
  assert.equal(later.trays[0].balloons.length, 0, 'never again, even after a restart');
  const foreground = await desktop([]);
  foreground.windows[0].emit('closed'); await flush();
  assert.equal(foreground.trays[0].balloons.length, 0, 'without the background the app quits, so there is nothing to say');
});

test('the tray says when a run is working; busy lingers 1.5 s after the last run stops (O23)', async t => {
  const d = await desktop([], Promise.resolve(), true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const tray = d.trays[0], engine = d.engines[0];
  engine.emit('venture-event', runEvent('run.started', { runId: 'run_a' }));
  assert.equal(tray.tooltips.at(-1), 'Chausar: working');
  engine.emit('venture-event', runEvent('run.started', { runId: 'run_b' }));
  engine.emit('venture-event', runEvent('run.done', { runId: 'run_a' }));
  assert.equal(tray.tooltips.at(-1), 'Chausar: working', 'another run still works');
  engine.emit('venture-event', runEvent('run.waiting', { runId: 'run_b' }));
  t.mock.timers.tick(1499);
  assert.equal(tray.tooltips.at(-1), 'Chausar: working', 'still lingering');
  engine.emit('venture-event', runEvent('run.step', { runId: 'run_b' }));
  t.mock.timers.tick(10);
  assert.equal(tray.tooltips.at(-1), 'Chausar: working', 'it went on within the linger, so no flicker');
  engine.emit('venture-event', runEvent('run.failed', { runId: 'run_b' }));
  t.mock.timers.tick(1500);
  assert.equal(tray.tooltips.at(-1), 'Chausar');
  engine.emit('venture-event', runEvent('notify.new', { count: 2 }));
  engine.emit('venture-event', runEvent('run.started', { runId: 'run_c' }));
  assert.equal(tray.tooltips.at(-1), 'Chausar: working, 2 need you');
  // An engine that stopped has no run going.
  engine.emit('status', { state: 'failed', healthy: false });
  t.mock.timers.tick(1500);
  assert.equal(tray.tooltips.at(-1), 'Chausar: 2 need you');
});

test('the desktop serves the Ink build app icons and manifest as image/png and application/manifest+json, still from an allowlist', async () => {
  const d = await desktop([], Promise.resolve(), undefined, { files: ['index.html', 'icon-192.png', 'manifest.webmanifest', 'notes.exe'] });
  const handler = d.protocol()!;
  const png = await handler({ url: 'chausar://app/icon-192.png' });
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  const manifest = await handler({ url: 'chausar://app/manifest.webmanifest' });
  assert.equal(manifest.status, 200);
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  assert.equal((await handler({ url: 'chausar://app/notes.exe' })).status, 404);
  assert.equal((await handler({ url: 'chausar://app/index.html' })).headers.get('content-type'), 'text/html; charset=utf-8');
});

// One-shot A7: the tray PNGs themselves (the founder's logo at 16, 24 and 32) are checked in desktop-icons-a7.test.ts.
test('the window shows the logo: the ico on Windows, the 256 PNG on Linux, the app bundle\'s own icon on macOS (A7)', async () => {
  const { join } = require('node:path');
  for (const [platform, icon] of [['win32', 'icons/icon.ico'], ['linux', 'icons/png/256x256.png'], ['darwin', null]] as const) {
    const d = await desktop([], Promise.resolve(), undefined, { platform });
    assert.equal(d.errors.length, 0, platform);
    assert.equal(d.windows[0].options.icon, icon === null ? undefined : join('/owned/app/app/desktop', icon), platform);
    if (icon !== null) assert.ok((await readFile(new URL(`../../app/desktop/${icon}`, import.meta.url))).length > 0, `${icon} is in the app`);
  }
});

test('Export for your CA: main answers the save channel for the app\'s own window only, and asks the engine for the month (4J4)', async () => {
  const d = await desktop([]);
  const contract = require('./ipc-contract.cjs');
  const handler = d.handlers.get(contract.MONEY_EXPORT_CHANNEL);
  assert.equal(typeof handler, 'function');
  const window = d.windows[0];
  const refused = await handler({ sender: {}, senderFrame: window.webContents.mainFrame }, { month: '2026-10' });
  assert.deepEqual([refused.ok, refused.error.code], [false, 'UNTRUSTED_SENDER']);
  const path = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { month: '2026-10', path: 'C:/x.csv' });
  assert.deepEqual([path.ok, path.error.code], [false, 'INVALID_REQUEST'], 'the window never names a path');
  // The test engine answers no CSV, so the save stops before any dialog or file.
  const asked = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { month: '2026-10' });
  assert.deepEqual([asked.ok, asked.error.code], [false, 'REQUEST_FAILED']);
});

// ---------------------------------------------------------------------------
// Wave 6, package 6J1 (D3, D36): the installed beta starts at login (hidden, in the tray) and keeps running in the
// tray when its window closes; both are owner settings in the tray menu. Previews never register a login item.
// ---------------------------------------------------------------------------

test('the installed beta registers no login item on its first start, starts real data, and keeps running in the tray (6J1, A5 S12)', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  assert.equal(d.errors.length, 0);
  assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '0');
  assert.deepEqual(d.logins, [], "start at login waits for the owner's answer in onboarding");
  const menu = d.menus.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(menu.filter((item: any) => item.type === 'checkbox').map((item: any) => [item.label, item.checked]))), [['Start when you sign in to this computer', false], ['Keep running in the tray', true]]);
  d.windows[0].emit('closed'); await flush();
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 0, 'closing the window keeps Chausar in the tray');
  assert.match(d.engines[0].options.environment.PATH, /codex[\\/]bin$/, 'the bundled Codex is the last place the engine looks');
});

test('a login start opens no window: Chausar waits in the tray until the owner opens it (6J1)', async () => {
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  assert.equal(d.trays.length, 1);
  assert.equal(d.windows.length, 0);
  d.app.emit('second-instance'); await flush();
  assert.equal(d.windows.length, 1);
});

test('the owner can turn start at login on and off and the tray off; the tick shows the computer; off means the window closing quits Chausar (6J1, A5)', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  const ticks = () => d.menus.at(-1).filter((item: any) => item.type === 'checkbox');
  ticks()[0].click({ checked: true }); await flush(); await flush();
  assert.deepEqual(d.logins, [{ openAtLogin: true, path: '/owned/app/Chausar.exe', args: ['--background', '--hidden'], name: 'Chausar' }]);
  assert.equal(ticks()[0].checked, true);
  ticks()[0].click({ checked: false }); await flush(); await flush();
  assert.deepEqual(d.logins.at(-1), { openAtLogin: false, path: '/owned/app/Chausar.exe', args: ['--background', '--hidden'], name: 'Chausar' });
  ticks()[1].click({ checked: false }); await flush(); await flush();
  assert.deepEqual(JSON.parse(JSON.stringify(ticks().map((item: any) => item.checked))), [false, false]);
  d.windows[0].emit('closed'); await flush();
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 1);
});

test('previews and development runs never register a login item and their tray menu is unchanged (6J1)', async () => {
  const d = await desktop([]);
  assert.deepEqual(d.logins, []);
  assert.equal(d.menus.at(-1).some((item: any) => item.type === 'checkbox'), false);
  const hidden = await desktop(['--hidden']);
  assert.equal(hidden.windows.length, 1, 'only the beta starts hidden');
});

// One-shot A5 (founder answer 5; rows 4, 88, 114): onboarding and Settings read and change start at login and the tray
// through two channels for the app's own window only. The answer is background.cjs's state, read back from the computer.
test('A5: the window reads start at login and keep running, and a change registers it, moves the tray tick and answers the state', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  const contract = require('./ipc-contract.cjs');
  const get = d.handlers.get(contract.BACKGROUND_GET_CHANNEL), set = d.handlers.get(contract.BACKGROUND_SET_CHANNEL);
  assert.equal(typeof get, 'function');
  assert.equal(typeof set, 'function');
  const own = { sender: d.windows[0].webContents, senderFrame: d.windows[0].webContents.mainFrame };
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  // Unasked, start at login reads off: standing configuration on the owner's computer waits for their tick (17 Nov 2026).
  assert.deepEqual(plain(await get(own, undefined)), { ok: true, result: { supported: true, asked: false, startAtLogin: false, keepRunning: true, registered: false, systemOff: false } });
  const changed = await set(own, { startAtLogin: true });
  assert.deepEqual(plain(changed), { ok: true, result: { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: true, systemOff: false } });
  assert.deepEqual(d.logins, [{ openAtLogin: true, path: '/owned/app/Chausar.exe', args: ['--background', '--hidden'], name: 'Chausar' }]);
  assert.equal(d.menus.at(-1).find((item: any) => item.label === 'Start when you sign in to this computer').checked, true);
  const kept = await set(own, { keepRunning: false });
  assert.equal(kept.result.keepRunning, false);
  await flush();
  // Only the app's own window, and only the two ticks as true or false.
  assert.deepEqual([(await get({ sender: {}, senderFrame: own.senderFrame }, undefined)).error.code, (await set({ sender: {}, senderFrame: own.senderFrame }, { startAtLogin: false })).error.code], ['UNTRUSTED_SENDER', 'UNTRUSTED_SENDER']);
  for (const bad of [{}, { startAtLogin: 'yes' }, { startAtLogin: true, path: 'C:/x.exe' }, [true], null, 'on']) {
    const reply = await set(own, bad);
    assert.deepEqual([reply.ok, reply.error.code], [false, 'INVALID_REQUEST'], JSON.stringify(bad));
  }
  assert.equal(d.logins.length, 1, 'no refused change reached the computer');
});

test('A5: a preview or development run answers that start at login is not here, and refuses a change', async () => {
  const d = await desktop([]);
  const contract = require('./ipc-contract.cjs');
  const own = { sender: d.windows[0].webContents, senderFrame: d.windows[0].webContents.mainFrame };
  assert.deepEqual(JSON.parse(JSON.stringify(await d.handlers.get(contract.BACKGROUND_GET_CHANNEL)(own, undefined))), { ok: true, result: { supported: false, asked: false, startAtLogin: false, keepRunning: false, registered: false, systemOff: false } });
  const refused = await d.handlers.get(contract.BACKGROUND_SET_CHANNEL)(own, { startAtLogin: true });
  assert.deepEqual([refused.ok, refused.error.code], [false, 'BACKGROUND_UNAVAILABLE']);
  assert.deepEqual(d.logins, []);
  // B1 fix round 1 (quality 8): the refusal's words are one constant, shared by main and background.cjs.
  const { BACKGROUND_UNAVAILABLE_LINE } = require('./background.cjs');
  assert.equal(refused.error.message, BACKGROUND_UNAVAILABLE_LINE);
  assert.equal(BACKGROUND_UNAVAILABLE_LINE, 'Only the installed Chausar app can start when you sign in to this computer.');
  const sources = (await Promise.all(['main.cjs', 'background.cjs'].map(name => readFile(new URL(`../../app/desktop/${name}`, import.meta.url), 'utf8')))).join(' ');
  assert.equal(sources.split(BACKGROUND_UNAVAILABLE_LINE).length - 1, 1, 'written once');
});

test('A5: the real preload forwards only the two ticks', async () => {
  let bridge: any; const calls: any[] = [];
  vm.runInNewContext(await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (channel: string, input: any) => { calls.push({ channel, input }); return { ok: true, result: { supported: true } }; } } }) });
  assert.deepEqual(await bridge.getBackground(), { supported: true });
  await bridge.setBackground({ startAtLogin: true, keepRunning: false, path: 'C:/x.exe' });
  await bridge.setBackground({ keepRunning: 'yes' });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { channel: 'chausar:background:get' },
    { channel: 'chausar:background:set', input: { startAtLogin: true, keepRunning: false } },
    { channel: 'chausar:background:set', input: {} },
  ]);
});

// A5 fix round 1 (finding 5): the tray tick is read from the computer again just before the menu opens (the pointer
// reaches the icon) and when the window comes to the front, so a change made in the computer's own settings shows.
test('A5: the tray reads start at login again as the pointer reaches it and when the window is focused', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  const contract = require('./ipc-contract.cjs');
  const own = { sender: d.windows[0].webContents, senderFrame: d.windows[0].webContents.mainFrame };
  await d.handlers.get(contract.BACKGROUND_SET_CHANNEL)(own, { startAtLogin: true });
  const tick = () => d.menus.at(-1).find((item: any) => item.label === 'Start when you sign in to this computer').checked;
  assert.equal(tick(), true);
  d.app.loginRun.get('Chausar').enabled = false;
  d.trays[0].emit('mouse-enter'); await flush(); await flush();
  assert.equal(tick(), false, 'switched off in Task Manager');
  d.app.loginRun.get('Chausar').enabled = true;
  d.windows[0].emit('focus'); await flush(); await flush();
  assert.equal(tick(), true);
});

test('A5 fix round 3: the window keeps and reads the day the owner put the question aside, and nothing else changes', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  const contract = require('./ipc-contract.cjs');
  const own = { sender: d.windows[0].webContents, senderFrame: d.windows[0].webContents.mainFrame };
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  assert.deepEqual(plain(await d.handlers.get(contract.BACKGROUND_LATER_SET_CHANNEL)(own, { day: '2026-11-04' })), { ok: true, result: { day: '2026-11-04' } });
  assert.deepEqual(plain(await d.handlers.get(contract.BACKGROUND_LATER_GET_CHANNEL)(own, undefined)), { ok: true, result: { day: '2026-11-04' } });
  assert.deepEqual(d.logins, []);
  for (const bad of [{}, { day: 'today' }, { day: '2026-11-04', startAtLogin: true }, null]) {
    const reply = await d.handlers.get(contract.BACKGROUND_LATER_SET_CHANNEL)(own, bad);
    assert.deepEqual([reply.ok, reply.error.code], [false, 'INVALID_REQUEST'], JSON.stringify(bad));
  }
  assert.equal((await d.handlers.get(contract.BACKGROUND_LATER_SET_CHANNEL)({ sender: {}, senderFrame: own.senderFrame }, { day: '2026-11-04' })).error.code, 'UNTRUSTED_SENDER');
  const preview = await desktop([]);
  const previewOwn = { sender: preview.windows[0].webContents, senderFrame: preview.windows[0].webContents.mainFrame };
  assert.deepEqual(plain(await preview.handlers.get(contract.BACKGROUND_LATER_GET_CHANNEL)(previewOwn, undefined)), { ok: true, result: { day: null } });
});

test('A5 fix round 3: the real preload forwards only the day to put the question aside', async () => {
  let bridge: any; const calls: any[] = [];
  vm.runInNewContext(await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (channel: string, input: any) => { calls.push({ channel, input }); return { ok: true, result: { day: '2026-11-04' } }; } } }) });
  assert.equal(await bridge.getAskLater(), '2026-11-04');
  await bridge.setAskLater('2026-11-04', { startAtLogin: true });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ channel: 'chausar:background:later:get' }, { channel: 'chausar:background:later:set', input: { day: '2026-11-04' } }]);
});

// ---------------------------------------------------------------------------
// One-shot A6 (the founder's answer 7): WhatsApp opens the desktop app first, else the web page. Every wa.me handoff
// goes through the same gate; the app link is built from the checked wa.me link. The invoice share channels answer the
// app's own window only.
// ---------------------------------------------------------------------------

test('A6: a wa.me handoff opens the WhatsApp desktop app when this computer has one, else the web page; other links open as before', async () => {
  const text = ['Hello Asha,', 'The proof is ready.'].join('\n');
  const wa = `https://wa.me/919876543210?text=${encodeURIComponent(text)}`;
  const withApp = await desktop([], Promise.resolve(), false, { whatsapp: 'WhatsApp' });
  const window = withApp.windows[0], trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const open = withApp.handlers.get('chausar:open-external');
  assert.deepEqual(JSON.parse(JSON.stringify(await open(trusted, wa))), { ok: true });
  assert.deepEqual(withApp.opened, [`whatsapp://send?phone=919876543210&text=${encodeURIComponent(text)}`]);
  assert.deepEqual(JSON.parse(JSON.stringify(await open(trusted, 'https://razorpay.com/'))), { ok: true });
  assert.equal(withApp.opened[1], 'https://razorpay.com/', 'a partner link is not touched');
  const refused = await open(trusted, 'whatsapp://send?text=x');
  assert.deepEqual([refused.ok, refused.error.code], [false, 'INVALID_EXTERNAL_URL'], 'the window never opens a whatsapp:// link itself');
  assert.equal(withApp.opened.length, 2);

  const noApp = await desktop([], Promise.resolve(), false, { whatsapp: '' });
  const w2 = noApp.windows[0];
  assert.deepEqual(JSON.parse(JSON.stringify(await noApp.handlers.get('chausar:open-external')({ sender: w2.webContents, senderFrame: w2.webContents.mainFrame }, wa))), { ok: true });
  assert.deepEqual(noApp.opened, [wa]);

  const broken = await desktop([], Promise.resolve(), false, { whatsapp: 'WhatsApp', openFails: url => url.startsWith('whatsapp:') });
  const w3 = broken.windows[0];
  assert.deepEqual(JSON.parse(JSON.stringify(await broken.handlers.get('chausar:open-external')({ sender: w3.webContents, senderFrame: w3.webContents.mainFrame }, wa))), { ok: true });
  assert.deepEqual(broken.opened, [wa], 'an app that does not open falls back to the web page');
});

test('A6: main answers the invoice share and show channels for the window of the app only, and the window names no path', async () => {
  const d = await desktop([]);
  const window = d.windows[0], trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const shareHandler = d.handlers.get('chausar:invoice:share'), show = d.handlers.get('chausar:share:show');
  assert.equal(typeof shareHandler, 'function');
  assert.equal(typeof show, 'function');
  const untrusted = await shareHandler({ sender: {}, senderFrame: window.webContents.mainFrame }, { invoiceId: 'inv-0001', how: 'email' });
  assert.deepEqual([untrusted.ok, untrusted.error.code], [false, 'UNTRUSTED_SENDER']);
  const path = await shareHandler(trusted, { invoiceId: 'inv-0001', how: 'email', path: 'C:/x.eml' });
  assert.deepEqual([path.ok, path.error.code], [false, 'INVALID_REQUEST']);
  // The test engine answers no file, so the share stops before anything is written or opened.
  const asked = await shareHandler(trusted, { invoiceId: 'inv-0001', how: 'whatsapp' });
  assert.deepEqual([asked.ok, asked.error.code], [false, 'REQUEST_FAILED']);
  assert.deepEqual([d.opened, d.openedPaths], [[], []]);
  const showRefused = await show(trusted, { name: '../secret.pdf' });
  assert.deepEqual([showRefused.ok, showRefused.error.code], [false, 'INVALID_REQUEST']);
  assert.deepEqual(d.shownItems, []);
});

// D11 task 29: --smoke-user-data=<absolute path> gives a release smoke run its own user data folder, set before the
// single-instance lock and ready; anything else (relative, empty, a second copy of the flag) is ignored.
test('D11: --smoke-user-data sets userData only to an absolute path, before the single-instance lock', async () => {
  const absolute = await desktop(['--smoke-user-data=C:\\Users\\someone\\AppData\\Local\\Temp\\chausar-smoke-1']);
  assert.deepEqual(absolute.app.setPaths, [['userData', 'C:\\Users\\someone\\AppData\\Local\\Temp\\chausar-smoke-1']]);
  const linux = await desktop(['--smoke-user-data=/tmp/chausar-smoke-2'], Promise.resolve(), false, { platform: 'linux' });
  assert.deepEqual(linux.app.setPaths, [['userData', '/tmp/chausar-smoke-2']]);
  for (const args of [['--smoke-user-data=chausar-smoke'], ['--smoke-user-data='], ['--smoke-user-data', 'C:\\x'], ['--smoke-user-data=..\\up'], []]) {
    assert.deepEqual((await desktop(args)).app.setPaths, [], JSON.stringify(args));
  }
  assert.deepEqual((await desktop(['--smoke-user-data=chausar-smoke'], Promise.resolve(), false, { platform: 'linux' })).app.setPaths, [], 'relative on Linux too');
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('--smoke-user-data=') < source.indexOf('requestSingleInstanceLock('), 'set before the lock, which lives in userData');
  // Found on the first real Mac smoke (14 Nov 2026): the diagnostics folder was read from userData before the smoke
  // folder was set, so the start phases went to the owner's real data folder and the release smoke, which waits for
  // first paint in its own folder, never saw it (on any system). The smoke folder is set first; nothing else moves.
  assert.ok(source.indexOf('--smoke-user-data=') < source.indexOf('createDiagnostics({'), 'set before the diagnostics folder is read from userData');
  await new Promise(done => setTimeout(done, 20));
  const smokePhases = linux.logged.filter(({ path }: { path: string }) => path.endsWith('startup.jsonl'));
  assert.ok(smokePhases.length > 0, 'the smoke run wrote its start phases');
  for (const { path } of linux.logged) assert.ok(path.replace(/[\\]/g, '/').startsWith('/tmp/chausar-smoke-2/diagnostics/'), `${path} is in the smoke folder`);
  const plain = await desktop([], Promise.resolve(), false, { platform: 'linux' });
  await new Promise(done => setTimeout(done, 20));
  for (const { path } of plain.logged) assert.ok(path.replace(/[\\]/g, '/').startsWith('/owned/app/diagnostics/'), `${path} is in the data folder`);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 25: the main-process guard and local crash dumps.
// ---------------------------------------------------------------------------

/** The lines main.cjs wrote to one diagnostics file, as objects, without their time. */
function linesOf(d: { logged: { path: string; text: string }[] }, name: string) {
  return d.logged.filter(({ path }) => path.replace(/[\\]/g, '/').endsWith(`/diagnostics/${name}`)).map(({ text }) => { const { at: _at, ...line } = JSON.parse(text); return line; });
}

test('C5 task 25: crash dumps stay here, and an error nothing caught writes one line, shows one plain dialog and quits', async () => {
  const d = await desktop([]);
  assert.deepEqual(plain(d.crashStarts), [{ uploadToServer: false }], 'the reporter starts with no upload');
  assert.deepEqual([...d.processHandlers.keys()].sort(), ['uncaughtException', 'unhandledRejection']);
  d.processHandlers.get('uncaughtException')!(new TypeError('the file secret-marker.txt'));
  await flush(); await flush();
  assert.deepEqual(linesOf(d, 'main.jsonl'), [{ op: 'uncaught', name: 'TypeError' }]);
  assert.deepEqual(d.errors, ['Chausar hit a problem and needs to close. Nothing was sent anywhere.']);
  assert.equal(d.app.quits, 1);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 26: the start-up timeline and the window's first paint.
// ---------------------------------------------------------------------------

test('C5 task 26: the start line has the phases in order, each once; first paint comes from the app window only', async () => {
  const { STARTUP_PHASES } = require('./diagnostics.cjs');
  const contract = require('./ipc-contract.cjs');
  const d = await desktop([]);
  const window = d.windows[0], own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  window.emit('ready-to-show');
  await d.handlers.get('chausar:request')(own, { method: 'workspace.status', payload: {} });
  await d.handlers.get('chausar:request')(own, { method: 'workspace.status', payload: {} });
  assert.equal((await d.handlers.get(contract.FIRST_PAINT_CHANNEL)({ sender: {}, senderFrame: own.senderFrame })).error.code, 'UNTRUSTED_SENDER');
  assert.equal(linesOf(d, 'startup.jsonl').some(line => line.phase === 'first-paint'), false);
  assert.deepEqual(plain(await d.handlers.get(contract.FIRST_PAINT_CHANNEL)(own)), { ok: true });
  await d.handlers.get(contract.FIRST_PAINT_CHANNEL)(own);
  await flush();
  const lines = linesOf(d, 'startup.jsonl');
  assert.deepEqual(lines.map(line => line.phase), [...STARTUP_PHASES]);
  for (const line of lines) assert.ok(Number.isFinite(line.ms) && line.ms >= 0);
});

test('C5 task 26: main gives the harness a timing writer for rpc.jsonl, and the real preload sends only the event', async () => {
  const d = await desktop([]);
  d.engines[0].options.onTiming({ method: 'workspace.status', ms: 3, requestBytes: 2, answerBytes: 9, ok: true, words: 'secret-marker here' });
  await flush();
  assert.deepEqual(linesOf(d, 'rpc.jsonl'), [{ method: 'workspace.status', ms: 3, requestBytes: 2, answerBytes: 9, ok: true }]);
  let bridge: any; const calls: unknown[] = [];
  vm.runInNewContext(await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (...parts: unknown[]) => { calls.push(parts); return { ok: true }; } } }) });
  await bridge.firstPaint('anything');
  assert.deepEqual(plain(calls), [['chausar:first-paint']]);
});

test('C5 task 27: main answers Export diagnostics for the app window only, and the preload sends only the tick and the id', async () => {
  const contract = require('./ipc-contract.cjs');
  const d = await desktop([]);
  const own = { sender: d.windows[0].webContents, senderFrame: d.windows[0].webContents.mainFrame }, stranger = { sender: {}, senderFrame: own.senderFrame };
  assert.equal((await d.handlers.get(contract.DIAGNOSTICS_PREVIEW_CHANNEL)(stranger, { dumps: false })).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await d.handlers.get(contract.DIAGNOSTICS_SAVE_CHANNEL)(stranger, { id: 'x' })).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await d.handlers.get(contract.DIAGNOSTICS_PREVIEW_CHANNEL)(own, { dumps: false, path: 'C:/x' })).error.code, 'INVALID_REQUEST');
  let bridge: any; const calls: unknown[] = [];
  vm.runInNewContext(await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (...parts: unknown[]) => { calls.push(parts); return { ok: true, result: null }; } } }) });
  await bridge.previewDiagnostics(true);
  await bridge.previewDiagnostics('C:/x');
  await bridge.saveDiagnostics('abc');
  assert.deepEqual(plain(calls), [['chausar:diagnostics:preview', { dumps: true }], ['chausar:diagnostics:preview', { dumps: false }], ['chausar:diagnostics:save', { id: 'abc' }]]);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 29: a worker that died is started again, by a fresh harness, after 1 s, 5 s, then 30 s.
// ---------------------------------------------------------------------------

const statusesOf = (window: any) => plain(window.webContents.sent.filter(([channel]: [string]) => channel === 'chausar:engine-status').map(([, status]: [string, { state: string }]) => status.state));

test('C5 task 29: a worker that dies twice then stays: two restarts at the backoff times, reconnecting then ready, no error box', async t => {
  const d = await desktop([], Promise.resolve(), true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const window = d.windows[0];
  d.engines[0].die();
  assert.deepEqual(statusesOf(window).at(-1), 'reconnecting');
  assert.equal(statusesOf(window).includes('failed'), false, 'the window never hears failed while a restart is pending');
  t.mock.timers.tick(999); await flush();
  assert.equal(d.engines.length, 1);
  t.mock.timers.tick(1); await flush(); await flush();
  assert.equal(d.engines.length, 2, 'a fresh harness after 1 s');
  assert.equal(d.engines[0].stops, 1, 'the old one was stopped first, so its lock is free');
  d.engines[1].emit('status', { state: 'ready', healthy: true });
  assert.equal(statusesOf(window).at(-1), 'ready');
  d.engines[1].die();
  assert.equal(statusesOf(window).at(-1), 'reconnecting');
  t.mock.timers.tick(4999); await flush();
  assert.equal(d.engines.length, 2);
  t.mock.timers.tick(1); await flush(); await flush();
  assert.equal(d.engines.length, 3, 'a fresh harness after 5 s more');
  d.engines[2].emit('status', { state: 'ready', healthy: true });
  assert.equal(statusesOf(window).at(-1), 'ready');
  assert.deepEqual(d.errors, []);
  assert.equal(d.app.quits, 0);
  // Each restart is a line in the timeline.
  assert.deepEqual(linesOf(d, 'startup.jsonl').filter(line => line.op === 'engine-restart').map(({ attempt, delayMs }) => [attempt, delayMs]), [[1, 1000], [2, 5000]]);
  // The window's requests go to the new worker; nothing was sent to it by itself, an approval above all.
  assert.deepEqual(d.engines[2].asked, []);
  const own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  await d.handlers.get('chausar:request')(own, { method: 'workspace.status', payload: {} });
  assert.deepEqual(d.engines[2].asked, ['workspace.status']);
});

test('C5 task 29: dying four times shows the box once and quits', async t => {
  const d = await desktop([], Promise.resolve(), true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const [index, wait] of [1000, 5000, 30000].entries()) {
    d.engines[index].die();
    t.mock.timers.tick(wait); await flush(); await flush();
    d.engines[index + 1].emit('status', { state: 'ready', healthy: true });
  }
  assert.equal(d.engines.length, 4);
  assert.deepEqual(d.errors, []);
  d.engines[3].die();
  assert.equal(d.errors.length, 1);
  assert.match(d.errors[0], /could not restart/);
  assert.equal(d.app.quits, 1);
  d.engines[3].die();
  t.mock.timers.tick(100_000); await flush();
  assert.equal(d.errors.length, 1);
  assert.equal(d.engines.length, 4);
  assert.equal(statusesOf(d.windows[0]).at(-1), 'failed');
});

test('C5 task 29: a restart that fails to start counts as the next failure, and a failed first start is the box as today', async t => {
  const d = await desktop([], Promise.resolve(), true, { startFails: [false, true, false] });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  d.engines[0].die();
  t.mock.timers.tick(1000); await flush(); await flush();
  assert.equal(d.engines.length, 2);
  t.mock.timers.tick(5000); await flush(); await flush();
  assert.equal(d.engines.length, 3);
  assert.deepEqual(d.errors, []);
  t.mock.timers.reset();
  const first = await desktop([], Promise.resolve(), true, { startFails: [true] });
  assert.deepEqual(first.errors, ['The worker did not start.']);
  assert.equal(first.app.quits, 1);
  assert.equal(first.engines.length, 1, 'no restart of an engine that never started');
});

test('C5 task 29: quitting during the wait stops the restart, and the old worker is stopped once', async t => {
  const d = await desktop([], Promise.resolve(), true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  d.engines[0].die();
  d.app.emit('before-quit', { preventDefault() {} }); await flush(); await flush();
  t.mock.timers.tick(100_000); await flush();
  assert.equal(d.engines.length, 1);
  assert.equal(d.engines[0].stops, 1);
  assert.equal(d.app.quits, 1);
  assert.deepEqual(d.errors, []);
});

test('C5 task 29: a worker that stops while Chausar quits is not started again', async t => {
  const d = await desktop([], Promise.resolve(), true);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  d.app.emit('before-quit', { preventDefault() {} });
  d.engines[0].die();
  await flush(); await flush();
  t.mock.timers.tick(100_000); await flush();
  assert.equal(d.engines.length, 1);
});

// ---------------------------------------------------------------------------
// One-shot C5 task 32: install on quit and the boot marker, called from main. update-wiring.cjs has its own tests.
// ---------------------------------------------------------------------------

const UPDATE_KEYS = { chausarUpdatePublicKey: 'the-public-key', chausarUpdateFeed: 'https://downloads.example.com/feed.json', chausarWindowsPublisher: 'Chausar', chausarPreview: false };
const standInUpdates = (order: unknown[], answer = { state: 'installer-started', version: '3.0.0' }) => ({
  startBoot: async () => { order.push('boot started'); return { attempts: 1, failed: false }; },
  clearBoot: async () => { order.push('boot cleared'); },
  onFailedBoot: async () => '',
  verifyStaged: async () => true,
  installOnQuit: async (input: any) => { order.push('install'); order.push(input.staged.artifactPath); return answer; },
});
const PENDING = JSON.stringify({ manifest: { version: '3.0.0' }, signature: 'sig', artifactPath: '/owned/app/updates/stage/release.artifact' });

test('C5 task 32: the boot marker starts before the engine, and clears only at ready plus first paint', async () => {
  const order: unknown[] = [];
  const d = await desktop([], Promise.resolve(), true, { metadata: UPDATE_KEYS, updates: standInUpdates(order) });
  await flush();
  assert.deepEqual(order, ['boot started'], 'the engine is ready; no paint yet');
  assert.equal(d.engines.length, 1);
  const window = d.windows[0], own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  await d.handlers.get(require('./ipc-contract.cjs').FIRST_PAINT_CHANNEL)(own);
  await flush();
  assert.deepEqual(order, ['boot started', 'boot cleared']);
});

test('C5 task 32: before-quit asks the engine first, stops it, then installs; a build with no key does none of it', async () => {
  const order: unknown[] = [];
  const d = await desktop([], Promise.resolve(), true, { order, metadata: UPDATE_KEYS, updates: standInUpdates(order), pending: PENDING });
  await flush();
  d.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.deepEqual(order.slice(1), ['prepared', { backup: true }, 'engine stopped', 'install', '/owned/app/updates/stage/release.artifact']);
  assert.equal(d.app.quits, 1);

  const plainOrder: unknown[] = [];
  const none = await desktop([], Promise.resolve(), true, { updates: standInUpdates(plainOrder), pending: PENDING });
  none.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.deepEqual(plainOrder, []);
  assert.deepEqual(none.order, ['engine stopped']);
  assert.equal(none.app.quits, 1);
  const window = none.windows[0], own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const refused = await none.handlers.get(require('./ipc-contract.cjs').UPDATE_SHOW_CHANNEL)(own, { kind: 'staged' });
  assert.deepEqual([refused.ok, refused.error.code], [false, 'UPDATES_NOT_SET_UP']);
});

test('C5 task 32: a start in the tray has no window to paint, so it clears the marker when the engine is ready', async () => {
  const order: unknown[] = [];
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta', metadata: UPDATE_KEYS, updates: standInUpdates(order) });
  await flush(); await flush();
  assert.equal(d.windows.length, 0);
  assert.deepEqual(order, ['boot started', 'boot cleared']);
});

test('C5 task 32: Show installer answers the app window only and names only which one; the worker hears the build\'s keys', async () => {
  const contract = require('./ipc-contract.cjs');
  const d = await desktop([], Promise.resolve(), true, { metadata: UPDATE_KEYS, updates: standInUpdates([]) });
  const environment = d.engines[0].options.environment;
  assert.deepEqual([environment.CHAUSAR_UPDATE_PUBLIC_KEY, environment.CHAUSAR_UPDATE_FEED, environment.CHAUSAR_WINDOWS_PUBLISHER], ['the-public-key', 'https://downloads.example.com/feed.json', 'Chausar']);
  const handler = d.handlers.get(contract.UPDATE_SHOW_CHANNEL), window = d.windows[0], own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.equal((await handler({ sender: {}, senderFrame: own.senderFrame }, { kind: 'staged' })).error.code, 'UNTRUSTED_SENDER');
  for (const bad of [{}, { kind: 'previous' }, { kind: 'staged', path: 'C:/x' }, null]) assert.equal((await handler(own, bad)).error.code, 'INVALID_REQUEST', JSON.stringify(bad));
  let bridge: any; const calls: unknown[] = [];
  vm.runInNewContext(await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8'), { require: () => ({ contextBridge: { exposeInMainWorld: (_name: string, value: any) => { bridge = value; } }, ipcRenderer: { invoke: async (...parts: unknown[]) => { calls.push(parts); return { ok: true }; } } }) });
  await bridge.showUpdateInstaller('staged');
  assert.deepEqual(plain(calls), [['chausar:updates:showInstaller', { kind: 'staged' }]]);
});

test('C5 task 32: the engine says if a run is busy and makes the safety copy over main\'s own route; no window can ask', async () => {
  const contract = require('./ipc-contract.cjs');
  assert.equal(contract.METHODS.includes('updates.prepareInstall'), false);
  const source = await readFile(new URL('../runtime/worker.ts', import.meta.url), 'utf8');
  assert.match(source, /message\?\.kind === 'host-update-prepare'/);
});

// ---------------------------------------------------------------------------
// 15 Nov 2026, the first walk of the built Windows app: quit when asked. "taskkill /PID" without /F only closes a
// window, and the beta keeps running in the tray, so nothing polite could quit Chausar on Windows. A second launch
// with --quit asks the running Chausar (the one that shares its user data folder, through the single-instance lock) to
// quit the way the tray's "Quit Chausar and stop jobs" does, and exits 0 once it has gone. The end of the Windows
// session does the same stop at once, without the update work.
// ---------------------------------------------------------------------------

/** The quit lines main.cjs wrote, without their time and milliseconds. */
const quitLines = (d: { logged: { path: string; text: string }[] }) => linesOf(d, 'main.jsonl').map(({ ms: _ms, ...line }) => line);
const EXE = 'C:\\Chausar\\Chausar.exe';

test('quit when asked: a launch with --quit and no Chausar running exits 0 at once, with no engine, window or tray', async () => {
  const d = await desktop(['--quit'], Promise.resolve(), true, { channel: 'beta' });
  await flush();
  assert.deepEqual(d.app.exits, [0]);
  assert.equal(d.app.released, 1, 'the lock it took is given back');
  assert.deepEqual(plain(d.app.lockAsks), [{ quit: true }]);
  assert.deepEqual([d.engines.length, d.windows.length, d.trays.length, d.watchers.length, d.app.quits], [0, 0, 0, 0, 0]);
  assert.deepEqual(d.logged, [], 'it writes nothing');
});

test('quit when asked: with Chausar running, --quit asks through the lock, waits until it has gone, then exits 0', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = await desktop(['--quit', '--smoke-user-data=C:\\Temp\\chausar-smoke-9'], Promise.resolve(), true, { channel: 'beta', lock: [false, false, true] });
  assert.deepEqual(d.app.setPaths, [['userData', 'C:\\Temp\\chausar-smoke-9']], 'it asks only the Chausar that shares this user data folder');
  assert.deepEqual([d.app.exits, d.app.quits], [[], 0], 'it waits: the other Chausar is still there');
  t.mock.timers.tick(500);
  assert.deepEqual(d.app.exits, [], 'still closing');
  t.mock.timers.tick(500);
  assert.deepEqual(d.app.exits, [0], 'gone: the lock is free');
  assert.equal(d.app.released, 1);
  assert.deepEqual(plain(d.app.lockAsks), [{ quit: true }, { quit: true }, { quit: true }], 'each look asks again, so a lost ask is repeated');
  assert.deepEqual([d.engines.length, d.windows.length, d.trays.length], [0, 0, 0]);
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('--smoke-user-data=') < source.indexOf('requestSingleInstanceLock('), 'the user data folder is set before the ask');
});

test('quit when asked: a Chausar that has not gone after the wait makes --quit exit 1, and it is never ended by force', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const d = await desktop(['--quit'], Promise.resolve(), true, { lock: Array.from({ length: 400 }, () => false) });
  // One look every half second for 90 seconds, each tick on its own so every look runs at its time.
  for (let look = 0; look < 179; look += 1) t.mock.timers.tick(500);
  assert.deepEqual(d.app.exits, []);
  t.mock.timers.tick(500);
  assert.deepEqual(d.app.exits, [1]);
  assert.equal(d.app.released, 0);
  assert.equal(d.app.lockAsks.length, 181, 'it asked at the start and at every look, and nothing else');
});

test('quit when asked: the running Chausar stops its engine as the tray Quit does and opens no window; a plain second launch still opens it', async () => {
  const asks: [string[], string, unknown][] = [[[EXE, '--quit'], 'C:\\', { quit: true }], [[EXE, '--quit', '--allow-file-access-from-files'], 'C:\\', undefined], [[EXE], 'C:\\', { quit: true }]];
  for (const ask of asks) {
    const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
    d.windows[0].emit('closed'); await flush();
    d.app.emit('window-all-closed');
    assert.equal(d.app.quits, 0, 'closing the window keeps Chausar in the tray, as before');
    d.app.emit('second-instance', {}, ...ask);
    assert.equal(d.app.quits, 1, JSON.stringify(ask));
    assert.equal(d.windows.length, 1, 'no window opens');
    let prevented = false;
    d.app.emit('before-quit', { preventDefault: () => { prevented = true; } });
    for (let count = 0; count < 6; count += 1) await flush();
    assert.equal(prevented, true);
    assert.equal(d.engines[0].stops, 1);
    assert.equal(d.app.quits, 2, 'the engine stopped, so the quit goes on');
    assert.deepEqual(quitLines(d), [{ op: 'quit', reason: 'asked' }, { op: 'quit-engine', reason: 'asked', graceful: true }]);
  }
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  d.app.emit('second-instance', {}, [EXE, '--quitting', 'quit'], 'C:\\', { quit: 'yes' });
  assert.deepEqual([d.app.quits, d.windows.length], [0, 1], 'only the exact ask quits');
  // The tray's own Quit says where it came from too.
  d.menus.at(-1).at(-1).click();
  d.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.deepEqual(quitLines(d), [{ op: 'quit', reason: 'tray' }, { op: 'quit-engine', reason: 'tray', graceful: true }]);
});

test('the end of the Windows session stops the engine at once: no safety copy, no installer, and the window is how Chausar hears it', async () => {
  const order: unknown[] = [];
  const d = await desktop([], Promise.resolve(), true, { order, metadata: UPDATE_KEYS, updates: standInUpdates(order), pending: PENDING });
  await flush();
  d.windows[0].emit('session-end', { reasons: ['logoff'] });
  assert.equal(d.app.quits, 1);
  d.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.deepEqual(order.slice(1), ['engine stopped'], 'nothing is copied or installed while the computer shuts down');
  assert.equal(d.app.quits, 2);
  assert.deepEqual(quitLines(d), [{ op: 'quit', reason: 'session-end' }, { op: 'quit-engine', reason: 'session-end', graceful: true }]);
});

test('in the tray on Windows a hidden window hears the session end and a close asked from outside; the app window takes its place', async () => {
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  assert.equal(d.windows.length, 0);
  assert.equal(d.watchers.length, 1, 'no window in the tray, so a hidden one listens');
  assert.deepEqual(plain(d.watchers[0].options), { show: false, skipTaskbar: true });
  // The owner opens Chausar: the app window listens now, and the hidden one goes without the app quitting.
  d.app.emit('second-instance', {}, [EXE], 'C:\\', null);
  assert.equal(d.windows.length, 1);
  assert.equal(d.watchers[0].destroyed, true);
  assert.equal(d.app.quits, 0);
  // They close it again: Chausar stays in the tray (the beta default), and a new hidden window listens.
  d.windows[0].emit('closed'); await flush();
  d.app.emit('window-all-closed');
  assert.equal(d.app.quits, 0);
  assert.equal(d.watchers.length, 2);
  d.watchers[1].emit('session-end', { reasons: ['shutdown'] });
  assert.equal(d.app.quits, 1);
  d.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.equal(d.engines[0].stops, 1);
  assert.deepEqual(quitLines(d)[0], { op: 'quit', reason: 'session-end' });
  // While Chausar quits, the hidden window closes like any other.
  let held = false; d.watchers[1].emit('close', { preventDefault: () => { held = true; } });
  assert.equal(held, false);

  // "taskkill /PID" without /F reaches only this hidden window while Chausar is in the tray: that is a polite ask to quit.
  const asked = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  let prevented = false; asked.watchers[0].emit('close', { preventDefault: () => { prevented = true; } });
  assert.deepEqual([prevented, asked.app.quits], [true, 1]);
  asked.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 6; count += 1) await flush();
  assert.deepEqual(quitLines(asked)[0], { op: 'quit', reason: 'close-request' });

  // Only Windows needs it, and only while Chausar stays running without a window.
  const linux = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta', platform: 'linux' });
  assert.equal(linux.watchers.length, 0);
  const preview = await desktop([]);
  preview.windows[0].emit('closed'); await flush();
  assert.equal(preview.watchers.length, 0, 'this one quits when its window closes');
  preview.app.emit('window-all-closed'); assert.equal(preview.app.quits, 1);
});

// 15 Nov 2026 (the first Windows walk): Electron made the Windows spelling files for this user
// (%APPDATA%\Microsoft\Spelling\en-US\default.acl and .exc) at every start, although the window's own spell check is off
// (webPreferences.spellcheck: false). That switch only stops the page from asking; the session's spell checker was
// still on, and it is what sets up the system's dictionaries. The session's own switch is turned off before any window.
test('spell check is off for the whole session, before any window opens, so no spelling files are set up', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  assert.deepEqual(d.spellChecks, [[false, 0]]);
  assert.equal(d.windows[0].options.webPreferences.spellcheck, false, 'and the window still asks for none');
  const tray = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  assert.deepEqual(tray.spellChecks, [[false, 0]], 'also when Chausar starts in the tray');
  assert.deepEqual((await desktop(['--quit'])).spellChecks, [], 'a launch that only asks the running Chausar to quit sets nothing up');
});

// Found on the first real run of the ask (this Mac, 15 Nov 2026): main.jsonl held "quit, asked" but not how the engine
// stopped. The line was still on its way to the file when Chausar left. The quit now waits for its own lines.
test('quit when asked: the line that says how the engine stopped reaches the file before Chausar leaves', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta', slowDisk: true });
  for (let count = 0; count < 6; count += 1) await flush();
  d.app.emit('second-instance', {}, [EXE, '--quit'], 'C:\\', { quit: true });
  d.app.emit('before-quit', { preventDefault() {} });
  for (let count = 0; count < 12; count += 1) await flush();
  assert.equal(d.app.quits, 2);
  assert.deepEqual(quitLines(d), [{ op: 'quit', reason: 'asked' }, { op: 'quit-engine', reason: 'asked', graceful: true }]);
  const written = d.logged.findIndex(({ text }: { text: string }) => text.includes('"quit-engine"')) + 1;
  assert.ok(written > 0 && d.app.loggedAtQuit.at(-1)! >= written, 'both quit lines were in the file when the last quit was called');
});

// Found on the first real run of the ask (this Mac, 15 Nov 2026): the asking launch looks every half second, and each
// look asks again. The second ask called quit while the engine was still stopping, and a quit during the stop is not
// held back, so Chausar left at once and the engine was cut off: the very thing the ask is there to prevent. An ask
// (and the tray's Quit, and the session end) that comes while Chausar is already stopping now changes nothing.
test('quit when asked: asked again while the engine is still stopping, Chausar does not leave early', async () => {
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta' });
  d.app.emit('second-instance', {}, [EXE, '--quit'], 'C:\\', { quit: true });
  assert.equal(d.app.quits, 1);
  d.app.emit('before-quit', { preventDefault() {} });
  // The engine has not stopped yet: the next looks ask again, the owner presses the tray's Quit, the session ends.
  d.app.emit('second-instance', {}, [EXE, '--quit'], 'C:\\', { quit: true });
  d.app.emit('second-instance', {}, [EXE, '--quit'], 'C:\\', { quit: true });
  d.menus.at(-1).at(-1).click();
  d.windows[0].emit('session-end', { reasons: ['logoff'] });
  assert.equal(d.app.quits, 1, 'no second quit while the engine stops');
  assert.equal(d.engines[0].stops, 0, 'the stop is still on its way');
  for (let count = 0; count < 6; count += 1) await flush();
  assert.equal(d.engines[0].stops, 1);
  assert.equal(d.app.quits, 2, 'one quit to begin, one once the engine has stopped');
  assert.deepEqual(quitLines(d), [{ op: 'quit', reason: 'asked' }, { op: 'quit-engine', reason: 'asked', graceful: true }]);
});

// ---------------------------------------------------------------------------
// 15 Nov 2026, the installed Windows build in the owner's own session: a slow first start showed nothing for ten
// seconds (the window was made only after the engine answered), and a second launch in that time ended both: the
// second launch's single-instance check found the first not answering and with no window on screen, ended it without
// asking, and then left too. Chausar now opens its window as soon as it knows this is not a tray start, on screen at
// once, before the engine starts; the page says "Chausar is starting." and what it asks waits for the engine.
// ---------------------------------------------------------------------------

test('a slow start: the window is on screen before the engine has started, says Chausar is starting, and what it asks waits', async () => {
  const contract = require('./ipc-contract.cjs');
  let release!: () => void; const startGate = new Promise<void>(accept => { release = accept; });
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta', startGate });
  await flush();
  assert.equal(d.windows.length, 1, 'the window does not wait for the engine');
  const window = d.windows[0], own = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  assert.ok(window.shows >= 1, 'on screen at once, not only once its page is ready');
  assert.equal(d.trays.length, 0, 'the tray comes with the engine, as before');
  assert.equal(d.engines[0].options.startupTimeoutMs, 60_000, 'a cold first start gets a minute before Chausar gives up');
  // The page has loaded: it is told the engine is still starting.
  window.webContents.emit('did-finish-load');
  assert.deepEqual(plain(window.webContents.sent.filter(([channel]: [string]) => channel === contract.STATUS_CHANNEL)), [[contract.STATUS_CHANNEL, { state: 'starting', healthy: false }]]);
  // What the page asks waits for the engine instead of failing.
  let answered = false;
  const asked = d.handlers.get('chausar:request')(own, { method: 'workspace.status', payload: {} }).then((reply: any) => { answered = true; return reply; });
  await flush(); await flush();
  assert.deepEqual([answered, d.engines[0].asked], [false, []]);
  // The owner launches Chausar again, as one does when nothing seems to happen: the window comes forward, nothing ends.
  d.app.emit('second-instance', {}, [EXE], 'C:\\', null);
  assert.deepEqual([d.windows.length, d.app.quits, d.app.exits], [1, 0, []]);
  release();
  const reply = await asked;
  assert.equal(reply.ok, true);
  for (let count = 0; count < 4; count += 1) await flush();
  assert.deepEqual([d.windows.length, d.trays.length, d.engines.length, d.errors], [1, 1, 1, []], 'one window, one engine, the tray, no error');
  // A page that loads once the engine is up is told nothing about starting.
  window.webContents.sent.length = 0;
  window.webContents.emit('did-finish-load');
  assert.deepEqual(window.webContents.sent.filter(([, status]: [string, any]) => status?.state === 'starting'), []);
});

test('a slow start in the tray: no window by itself, but a second launch during the start opens one once the engine is up', async () => {
  let release!: () => void; const startGate = new Promise<void>(accept => { release = accept; });
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta', startGate });
  await flush();
  assert.equal(d.windows.length, 0, 'a login start stays in the tray');
  d.app.emit('second-instance', {}, [EXE], 'C:\\', null);
  assert.deepEqual([d.windows.length, d.app.quits], [0, 0], 'nothing to show yet, and nothing ends');
  release();
  for (let count = 0; count < 4; count += 1) await flush();
  assert.deepEqual([d.windows.length, d.trays.length], [1, 1], 'the owner asked for Chausar, so its window opens when it can');
  // Without that second launch the tray start stays in the tray.
  const quiet = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  assert.equal(quiet.windows.length, 0);
});

test('a start that fails after the window opened still says so once and quits; a preview refused before its engine opens no window', async () => {
  const failed = await desktop([], Promise.resolve(), true, { startFails: [true] });
  assert.deepEqual([failed.errors, failed.app.quits, failed.windows.length], [['The worker did not start.'], 1, 1]);
  const refused = await desktop(['--production']);
  assert.deepEqual([refused.windows.length, refused.engines.length], [0, 0]);
});

test('a slow start: a window the owner closed while Chausar was starting is not opened again when the engine is up', async () => {
  let release!: () => void; const startGate = new Promise<void>(accept => { release = accept; });
  const d = await desktop([], Promise.resolve(), true, { channel: 'beta', startGate });
  await flush();
  assert.equal(d.windows.length, 1);
  d.windows[0].emit('closed'); await flush();
  d.app.emit('window-all-closed');
  assert.equal(d.app.quits, 0, 'the beta keeps running in the tray');
  release();
  for (let count = 0; count < 4; count += 1) await flush();
  assert.deepEqual([d.windows.length, d.trays.length, d.engines.length], [1, 1, 1], 'no second window by itself');
});
