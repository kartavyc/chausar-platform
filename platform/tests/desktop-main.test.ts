import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const flush = () => new Promise<void>(accept => setImmediate(accept));

// options (Ink v2 wave 4, 4G3): files, the Ink build's file names; written, the files main.cjs wrote (kept across runs).
async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), postgresGate?: Promise<void>, options: { files?: string[]; written?: Set<string> } = {}) {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>(), errors: string[] = [];
  const trays: any[] = [], notes: any[] = [], written = options.written ?? new Set<string>();
  let protocolHandler: ((request: { url: string }) => Promise<Response>) | null = null;
  let databaseCloses = 0;
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.send = () => {}; windows.push(this); }
    urls: string[] = [];
    loadURL(url: string) { this.webContents.mainFrame.url = url; this.urls.push(url); }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
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
  const electron = { app, BrowserWindow: Window, Tray, Notification, powerMonitor, Menu: { buildFromTemplate: (items: any) => items }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme: string, handler: any) => { protocolHandler = handler; } }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  let source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  if (postgresGate) source = source.replace("await import(pathToFileURL(join(engineRoot, 'scripts/postgres-runtime.mjs')).href)", '__postgresModule');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    if (name === './money-export.cjs') return require('../../app/desktop/money-export.cjs');
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !postgresGate, version: '2.3.4' }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      writeFile: async (path: string, _data: unknown, flags: any) => { if (flags?.flag === 'wx' && written.has(path)) throw Object.assign(new Error('The file exists.'), { code: 'EEXIST' }); written.add(path); },
      // A one-page Ink build in app/ui/dist, which main.cjs lists before it starts anything.
      readdir: async () => (options.files ?? ['index.html']).map(name => ({ name, isDirectory: () => false, isFile: () => true })) };
    if (name === 'node:net' && postgresGate) return { createServer: () => ({ once() {}, listen(_port: number, _host: string, callback: () => void) { callback(); }, address: () => ({ port: 5432 }), close(callback: () => void) { callback(); } }) };
    return require(name);
  }, __postgresModule: { startBundledPostgres: async () => { await postgresGate; return { close: async () => { databaseCloses++; } }; } }, process: { argv: ['electron', '/owned/app', ...args], env: {}, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer,
    // Looked up at each call, so a test's mocked timers reach main.cjs too.
    setTimeout: (...parts: Parameters<typeof setTimeout>) => setTimeout(...parts), clearTimeout: (timer: any) => clearTimeout(timer) });
  await flush();
  return { app, windows, engines, menus, errors, handlers, powerMonitor, databaseCloses: () => databaseCloses, trays, notes, written, protocol: () => protocolHandler };
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

test('quit awaits in-flight startup and never opens a window or starts a late worker', async () => {
  let release!: () => void; const gate = new Promise<void>(accept => { release = accept; });
  const d = await desktop([], gate);
  d.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(d.app.quits, 0); assert.equal(d.engines.length, 0);
  release(); await flush();
  assert.equal(d.app.quits, 1); assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0); assert.equal(d.errors.length, 0);
});

test('quit during bundled database startup closes the completed database before exiting', async () => {
  let release!: () => void; const gate = new Promise<void>(accept => { release = accept; });
  const d = await desktop(['--production'], Promise.resolve(), gate);
  d.app.emit('before-quit', { preventDefault() {} }); await flush(); assert.equal(d.app.quits, 0);
  release(); await flush(); assert.equal(d.databaseCloses(), 1); assert.equal(d.app.quits, 1); assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0);
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
  const d = await desktop([], Promise.resolve(), Promise.resolve());
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
  const contract = require('../../app/desktop/ipc-contract.cjs');
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
  const d = await desktop([], Promise.resolve(), Promise.resolve());
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
  const contract = require('../../app/desktop/ipc-contract.cjs');
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
