import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const desktopMain = new URL('../../app/desktop/main.cjs', import.meta.url);
const desktopRequire = createRequire(desktopMain);
const flush = () => new Promise<void>(accept => setImmediate(accept));

async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), postgresGate?: Promise<void>, environment: NodeJS.ProcessEnv = {}, fault?: 'existing-root' | 'ignored-binding' | 'late-binding' | 'lock-denied') {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>(), errors: string[] = [];
  let databaseCloses = 0;
  const events: string[] = [], directories = new Set<string>(['/synthetic-temp']);
  const paths: Record<string, string> = { userData: '/owned/app', sessionData: '/owned/app' };
  const profileEnvironment = { CHAUSAR_DEMO_PROFILE_ROOT: '/synthetic-temp/fresh-preview', ...environment };
  if (fault === 'existing-root') directories.add(profileEnvironment.CHAUSAR_DEMO_PROFILE_ROOT);
  const fakeFilesystem = { realpathSync: (path: string) => { assert.equal(path, '/synthetic-temp'); return path; }, mkdirSync: (path: string, options: any) => {
    events.push(`mkdir:${path}`); assert.equal(options.mode, 0o700); assert.equal(options.recursive, undefined);
    if (directories.has(path)) throw Object.assign(new Error('Existing demo profile refused.'), { code: 'EEXIST' }); directories.add(path);
  } };
  const profileModule = { exports: {} as any };
  vm.runInNewContext(await readFile(new URL('../../app/desktop/demo-profile.cjs', import.meta.url), 'utf8'), { module: profileModule, process: { env: profileEnvironment }, require: (name: string) => {
    if (name === 'node:fs') return fakeFilesystem;
    if (name === 'node:os') return { tmpdir: () => '/synthetic-temp' };
    return desktopRequire(name);
  } });
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  app.requestSingleInstanceLock = () => { events.push('lock'); return fault !== 'lock-denied'; }; app.whenReady = () => { events.push('ready'); if (fault === 'late-binding') paths.userData = '/owned/app'; return Promise.resolve(); };
  app.getPath = (name: string) => paths[name]; app.setPath = (name: string, path: string) => { events.push(`bind:${name}`); if (fault !== 'ignored-binding') paths[name] = path; }; app.quit = () => { app.quits++; };
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
    if (name === './demo-profile.cjs') return profileModule.exports;
    if (name === '../../package.json') return { chausarPreview: !postgresGate, version: '2.3.4' };
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !postgresGate, version: '2.3.4' }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }) };
    if (name === 'node:net' && postgresGate) return { createServer: () => ({ once() {}, listen(_port: number, _host: string, callback: () => void) { callback(); }, address: () => ({ port: 5432 }), close(callback: () => void) { callback(); } }) };
    return desktopRequire(name);
  }, __postgresModule: { startBundledPostgres: async () => { await postgresGate; return { close: async () => { databaseCloses++; } }; } }, process: { argv: ['electron', '/owned/app', ...args], env: profileEnvironment, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer });
  await flush();
  return { app, windows, engines, menus, errors, handlers, powerMonitor, events, paths, directories, databaseCloses: () => databaseCloses };
}

test('demo claims new user and session directories before the lock and pins worker storage to that profile', async () => {
  const d = await desktop(['--demo'], Promise.resolve(), undefined, { CHAUSAR_VAULT_DIRECTORY: '/real/vaults' });
  assert.equal(d.errors.length, 0);
  assert.deepEqual(d.events, ['mkdir:/synthetic-temp/fresh-preview', 'mkdir:/synthetic-temp/fresh-preview/userData', 'mkdir:/synthetic-temp/fresh-preview/sessionData', 'bind:userData', 'bind:sessionData', 'lock', 'ready']);
  assert.equal(d.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY, '/synthetic-temp/fresh-preview/userData/vaults');
  assert.deepEqual(d.paths, { userData: '/synthetic-temp/fresh-preview/userData', sessionData: '/synthetic-temp/fresh-preview/sessionData' });
});

test('reused or ineffective demo bindings stop before lock, worker, database and window creation', async () => {
  for (const fault of ['existing-root', 'ignored-binding'] as const) {
    const d = await desktop(['--demo'], Promise.resolve(), undefined, {}, fault);
    assert.equal(d.app.quits, 1); assert.equal(d.errors.length, 1); assert.equal(d.events.includes('lock'), false);
    assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0); assert.equal(d.databaseCloses(), 0);
  }
  const changed = await desktop(['--demo'], Promise.resolve(), undefined, {}, 'late-binding');
  assert.match(changed.errors[0], /isolated demo profile binding/); assert.equal(changed.engines.length, 0); assert.equal(changed.windows.length, 0);
});

test('production keeps its original paths and a denied lock never starts storage', async () => {
  const production = await desktop(['--production'], Promise.resolve(), Promise.resolve());
  assert.deepEqual(production.events, ['lock', 'ready']); assert.equal(production.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY, join('/owned/app', 'vaults'));
  const denied = await desktop(['--demo'], Promise.resolve(), undefined, {}, 'lock-denied');
  assert.equal(denied.app.quits, 1); assert.equal(denied.events.includes('ready'), false); assert.equal(denied.engines.length, 0); assert.equal(denied.windows.length, 0);
});

test('packaged preview forces synthetic worker and enforces the isolated window IPC envelope', async () => {
  const d = await desktop([], Promise.resolve(), undefined, { CHAUSAR_KEYCHAIN_MANIFEST: '/untrusted/manifest.json' }); assert.equal(d.errors.length, 0); assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '1');
  assert.equal(d.engines[0].options.environment.CHAUSAR_KEYCHAIN_MANIFEST, undefined);
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

test('UI preview opt-in opens the UI document with its trusted IPC frame and synthetic engine', async () => {
  const d = await desktop(['--demo', '--ui-preview']);
  assert.equal(d.errors.length, 0);
  assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '1');
  const window = d.windows[0];
  assert.equal(window.webContents.mainFrame.url, 'chausar://app/ui/index.html');
  const handler = d.handlers.get('chausar:request');
  const reply = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { method: 'workspace.status', payload: {} });
  assert.equal(reply.ok, true);
  const stale = await handler({ sender: window.webContents, senderFrame: { url: 'chausar://app/index.html' } }, { method: 'workspace.status', payload: {} });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'UNTRUSTED_SENDER');
});

test('production desktop forwards its fixed packaged custody manifest through the real startup composition', async () => {
  // Electron and PostgreSQL boundaries are synthetic; the actual main source runs.
  const d = await desktop(['--production'], Promise.resolve(), Promise.resolve(), { CHAUSAR_KEYCHAIN_MANIFEST: '/untrusted/manifest.json' });
  assert.equal(d.errors.length, 0); assert.equal(d.engines.length, 1);
  assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '0');
  assert.equal(d.engines[0].options.environment.CHAUSAR_KEYCHAIN_MANIFEST, join('/owned/resources', 'runtime-binaries', 'keychain', 'manifest.json'));
  d.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(d.engines[0].stops, 1); assert.equal(d.databaseCloses(), 1);
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
