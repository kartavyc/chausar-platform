import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const desktopMain = new URL('../../app/desktop/main.cjs', import.meta.url);
const desktopRequire = createRequire(desktopMain);
const flush = () => new Promise<void>(accept => setImmediate(accept));

async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), postgresGate?: Promise<void>) {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>(), errors: string[] = [];
  let databaseCloses = 0;
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.send = () => {}; windows.push(this); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter {
    state = 'ready'; options: any; stops = 0; lifecycle: any[] = []; failLifecycle = false;
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    async start() {} async request(method: string) { return { method, experimental: true }; }
    async updateJobLifecycle(state: any) { this.lifecycle.push(JSON.parse(JSON.stringify(state))); if (this.failLifecycle) { this.state = 'failed'; throw new Error('Lifecycle acknowledgement failed.'); } return { applied: true }; }
    async stop() { this.stops++; this.state = 'stopped'; return { graceful: true, forced: false }; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(menu: any) { menus.push(menu); } destroy() {} }
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } };
  const powerMonitor = new EventEmitter();
  const electron = { app, BrowserWindow: Window, Tray, powerMonitor, Menu: { buildFromTemplate: (items: any) => items }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  let source = await readFile(desktopMain, 'utf8');
  if (postgresGate) source = source.replace("await import(pathToFileURL(join(engineRoot, 'scripts/postgres-runtime.mjs')).href)", '__postgresModule');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !postgresGate, version: '2.3.4' }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }) };
    if (name === 'node:net' && postgresGate) return { createServer: () => ({ once() {}, listen(_port: number, _host: string, callback: () => void) { callback(); }, address: () => ({ port: 5432 }), close(callback: () => void) { callback(); } }) };
    return desktopRequire(name);
  }, __postgresModule: { startBundledPostgres: async () => { await postgresGate; return { close: async () => { databaseCloses++; } }; } }, process: { argv: ['electron', '/owned/app', ...args], env: {}, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer });
  await flush();
  return { app, windows, engines, menus, errors, handlers, powerMonitor, databaseCloses: () => databaseCloses };
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
