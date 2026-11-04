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
async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), production = false, options: { files?: string[]; written?: Set<string>; channel?: string; whatsapp?: string; openFails?: (url: string) => boolean } = {}) {
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
  const shell = { openExternal: async (url: string) => { if (options.openFails?.(url)) throw new Error('No app for this link.'); opened.push(url); }, openPath: async (path: string) => { openedPaths.push(path); return ''; }, showItemInFolder: (path: string) => { shownItems.push(path); } };
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.send = () => {}; windows.push(this); }
    urls: string[] = [];
    loadURL(url: string) { this.webContents.mainFrame.url = url; this.urls.push(url); }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
    menuBar: boolean[] = [];
    setMenuBarVisibility(visible: boolean) { this.menuBar.push(visible); }
    // Ink v2 wave 4 (4G1): what main.cjs reads to tell the engine whether the owner is watching.
    visible = true; focused = false; minimized = false;
    isVisible() { return this.visible; } isFocused() { return this.focused; }
  }
  class Harness extends EventEmitter {
    state = 'ready'; options: any; stops = 0; lifecycle: any[] = []; failLifecycle = false;
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    async start() {} async request(method: string) { return { method, experimental: true }; }
    async updateJobLifecycle(state: any) { this.lifecycle.push(JSON.parse(JSON.stringify(state))); if (this.failLifecycle) { this.state = 'failed'; throw new Error('Lifecycle acknowledgement failed.'); } return { applied: true }; }
    async stop() { this.stops++; this.state = 'stopped'; return { graceful: true, forced: false }; }
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
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } };
  const powerMonitor = new EventEmitter();
  const electron = { app, shell, BrowserWindow: Window, Tray, Notification, powerMonitor, Menu: { buildFromTemplate: (items: any) => items, setApplicationMenu: (menu: unknown) => { appMenus.push(menu); } }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme: string, handler: any) => { protocolHandler = handler; } }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  let source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('./ipc-contract.cjs');
    if (name === './money-export.cjs') return require('./money-export.cjs');
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !production, version: '2.3.4', ...(options.channel ? { chausarReleaseChannel: options.channel } : {}) }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      writeFile: async (path: string, _data: unknown, flags: any) => { if (flags?.flag === 'wx' && written.has(path)) throw Object.assign(new Error('The file exists.'), { code: 'EEXIST' }); written.add(path); },
      // A one-page Ink build in app/ui/dist, which main.cjs lists before it starts anything.
      readdir: async () => (options.files ?? ['index.html']).map(name => ({ name, isDirectory: () => false, isFile: () => true })) };
    return require(name);
  }, process: { argv: ['electron', '/owned/app', ...args], env: {}, platform: 'win32', resourcesPath: '/owned/resources', execPath: '/owned/app/Chausar.exe' }, console: { error() {} }, URL, Response, Buffer,
    // Looked up at each call, so a test's mocked timers reach main.cjs too.
    setTimeout: (...parts: Parameters<typeof setTimeout>) => setTimeout(...parts), clearTimeout: (timer: any) => clearTimeout(timer) });
  await flush();
  return { app, windows, engines, menus, errors, handlers, powerMonitor, trays, notes, written, logins, appMenus, opened, openedPaths, shownItems, protocol: () => protocolHandler };
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

test('desktop reports actual window, background and sleep transitions before shutdown', async () => {
  const d = await desktop(['--background']); const engine = d.engines[0];
  assert.deepEqual(engine.lifecycle, [
    { awake: true, windowOpen: false, backgroundEnabled: true },
    { awake: true, windowOpen: true, backgroundEnabled: true },
  ]);
  d.powerMonitor.emit('suspend'); await flush();
  assert.deepEqual(engine.lifecycle.at(-1), { awake: false, windowOpen: true, backgroundEnabled: true });
  d.windows[0].emit('closed'); await flush();
  assert.deepEqual(engine.lifecycle.at(-1), { awake: false, windowOpen: false, backgroundEnabled: true });
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 0);
  d.powerMonitor.emit('resume'); await flush();
  assert.deepEqual(engine.lifecycle.at(-1), { awake: true, windowOpen: false, backgroundEnabled: true });
  d.app.emit('second-instance'); await flush();
  assert.deepEqual(engine.lifecycle.at(-1), { awake: true, windowOpen: true, backgroundEnabled: true });
  d.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.deepEqual(engine.lifecycle.at(-1), { awake: false, windowOpen: false, backgroundEnabled: false });
  assert.equal(engine.stops, 1);
});

test('foreground closure reports no background permission and failed acknowledgement quits visibly', async () => {
  const d = await desktop([]); d.windows[0].emit('closed'); await flush();
  assert.deepEqual(d.engines[0].lifecycle.at(-1), { awake: true, windowOpen: false, backgroundEnabled: false });
  const failed = await desktop(['--background']); failed.engines[0].failLifecycle = true;
  failed.powerMonitor.emit('suspend'); await flush();
  assert.equal(failed.engines[0].state, 'failed'); assert.equal(failed.app.quits, 1);
  assert.match(failed.errors[0], /could not confirm the desktop state/);
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

/** A PNG as RGB rows: only what make_icons.py writes (8-bit RGB, no alpha, filter 0), so anything else fails. */
async function readPng(name: string) {
  const { inflateSync } = await import('node:zlib');
  const data = await readFile(new URL(`../../app/desktop/${name}`, import.meta.url));
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} is a PNG`);
  let at = 8, width = 0, height = 0, colour = -1;
  const chunks: Buffer[] = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at), kind = data.subarray(at + 4, at + 8).toString('latin1'), body = data.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); colour = body[9]; assert.equal(body[8], 8); }
    if (kind === 'IDAT') chunks.push(body);
    at += 12 + length;
  }
  assert.equal(colour, 2, `${name} is opaque RGB with no alpha channel`);
  const raw = inflateSync(Buffer.concat(chunks));
  const pixel = (x: number, y: number) => {
    const row = y * (width * 3 + 1);
    assert.equal(raw[row], 0);
    return [...raw.subarray(row + 1 + x * 3, row + 4 + x * 3)];
  };
  return { width, height, pixel };
}

test('the tray icon is the two-square mark: opaque, padded, ink and green on the light ground, at 1x, 1.5x and 2x', async () => {
  const GROUND = [0xfb, 0xfb, 0xfa], INK = [0x16, 0x18, 0x1b], ACCENT = [0x2f, 0xb6, 0x7c];
  for (const [name, size] of [['icon.png', 16], ['icon@1.5x.png', 24], ['icon@2x.png', 32]] as const) {
    const png = await readPng(name);
    assert.deepEqual([png.width, png.height], [size, size], name);
    for (let i = 0; i < size; i++) {
      for (const [x, y] of [[i, 0], [0, i], [i, size - 1], [size - 1, i]]) assert.deepEqual(png.pixel(x, y), GROUND, `${name}: the edge (${x}, ${y}) is padding`);
    }
    const near = Math.floor(size * 0.28), far = Math.floor(size * 0.72);
    assert.deepEqual(png.pixel(near, near), INK, `${name}: the top left square is ink`);
    assert.deepEqual(png.pixel(far, far), ACCENT, `${name}: the bottom right square is green`);
    assert.deepEqual(png.pixel(far, near), GROUND, `${name}: the other corners are empty`);
    assert.deepEqual(png.pixel(near, far), GROUND, `${name}: the other corners are empty`);
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
  assert.deepEqual(JSON.parse(JSON.stringify(menu.filter((item: any) => item.type === 'checkbox').map((item: any) => [item.label, item.checked]))), [['Start at login', false], ['Keep running in the tray', true]]);
  d.windows[0].emit('closed'); await flush();
  assert.deepEqual(d.engines[0].lifecycle.at(-1), { awake: true, windowOpen: false, backgroundEnabled: true });
  d.app.emit('window-all-closed'); assert.equal(d.app.quits, 0, 'closing the window keeps Chausar in the tray');
  assert.match(d.engines[0].options.environment.PATH, /codex[\\/]bin$/, 'the bundled Codex is the last place the engine looks');
});

test('a login start opens no window: Chausar waits in the tray until the owner opens it (6J1)', async () => {
  const d = await desktop(['--background', '--hidden'], Promise.resolve(), true, { channel: 'beta' });
  assert.equal(d.trays.length, 1);
  assert.equal(d.windows.length, 0);
  assert.deepEqual(d.engines[0].lifecycle.at(-1), { awake: true, windowOpen: false, backgroundEnabled: true });
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
  assert.deepEqual(d.engines[0].lifecycle.at(-1), { awake: true, windowOpen: false, backgroundEnabled: false });
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
  assert.deepEqual(plain(await get(own, undefined)), { ok: true, result: { supported: true, asked: false, startAtLogin: true, keepRunning: true, registered: false, systemOff: false } });
  const changed = await set(own, { startAtLogin: true });
  assert.deepEqual(plain(changed), { ok: true, result: { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: true, systemOff: false } });
  assert.deepEqual(d.logins, [{ openAtLogin: true, path: '/owned/app/Chausar.exe', args: ['--background', '--hidden'], name: 'Chausar' }]);
  assert.equal(d.menus.at(-1).find((item: any) => item.label === 'Start at login').checked, true);
  const kept = await set(own, { keepRunning: false });
  assert.equal(kept.result.keepRunning, false);
  await flush();
  assert.deepEqual(d.engines[0].lifecycle.at(-1), { awake: true, windowOpen: true, backgroundEnabled: false });
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
  const tick = () => d.menus.at(-1).find((item: any) => item.label === 'Start at login').checked;
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
