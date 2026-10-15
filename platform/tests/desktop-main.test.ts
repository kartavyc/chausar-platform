import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const desktopMain = new URL('../../app/desktop/main.cjs', import.meta.url);
const desktopRequire = createRequire(desktopMain);
const flush = () => new Promise<void>(accept => setImmediate(accept));
// Authored filesystem ports use the same canonical host path semantics as main.
// These paths are labels in the VM; no host profile or filesystem is accessed.
const syntheticTemporary = resolve('/synthetic-temp');
const ownedApp = resolve('/owned/app');
const ownedResources = resolve('/owned/resources');
const demoProfileRoot = join(syntheticTemporary, 'fresh-preview');

async function desktop(args: string[], metadataGate: Promise<void> = Promise.resolve(), postgresGate?: Promise<void>, environment: NodeJS.ProcessEnv = {}, fault?: 'existing-root' | 'ignored-binding' | 'late-binding' | 'lock-denied' | 'unavailable-defaults' | 'unavailable-user-default' | 'unavailable-session-default' | 'unavailable-app-data' | 'invalid-app-data', profileClaimFailure?: Error) {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>(), errors: string[] = [];
  const externalOpens: unknown[][] = [], prints: unknown[][] = [], openDialogs: unknown[][] = [];
  let databaseCloses = 0;
  const events: string[] = [], diagnostics: string[] = [], directories = new Set<string>([syntheticTemporary]);
  const paths: Record<string, string> = { userData: ownedApp, sessionData: ownedApp };
  const pathReads: Array<{ name: string; bound: boolean }> = [];
  const boundPaths = new Set<string>();
  const profileEnvironment = { CHAUSAR_DEMO_PROFILE_ROOT: demoProfileRoot, ...environment };
  if (fault === 'existing-root') directories.add(profileEnvironment.CHAUSAR_DEMO_PROFILE_ROOT);
  const fakeFilesystem = { realpathSync: (path: string) => { assert.equal(path, syntheticTemporary); return path; }, mkdirSync: (path: string, options: any) => {
    events.push(`mkdir:${path}`); assert.equal(options.mode, 0o700); assert.equal(options.recursive, undefined);
    if (path === demoProfileRoot && profileClaimFailure) throw profileClaimFailure;
    if (directories.has(path)) throw Object.assign(new Error('Existing demo profile refused.'), { code: 'EEXIST' }); directories.add(path);
  } };
  const profileModule = { exports: {} as any };
  vm.runInNewContext(await readFile(new URL('../../app/desktop/demo-profile.cjs', import.meta.url), 'utf8'), { module: profileModule, process: { env: profileEnvironment }, require: (name: string) => {
    if (name === 'node:fs') return fakeFilesystem;
    if (name === 'node:os') return { tmpdir: () => syntheticTemporary };
    return desktopRequire(name);
  } });
  const protocolHandlers: any[] = [];
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  app.getName = () => 'app'; app.commandLine = { hasSwitch: (name: string) => args.some(value => value === `--${name}` || value.startsWith(`--${name}=`)) };
  app.requestSingleInstanceLock = () => { events.push('lock'); return fault !== 'lock-denied'; }; app.whenReady = () => { events.push('ready'); if (fault === 'late-binding') paths.userData = ownedApp; return Promise.resolve(); };
  // Electron can fail to resolve or create a default profile before ready.
  // Its explicit path override works independently once the directory exists.
  app.getPath = (name: string) => {
    pathReads.push({ name, bound: boundPaths.has(name) });
    if (name === 'appData') {
      if (fault === 'unavailable-app-data') throw new Error("Failed to get 'appData' path");
      return fault === 'invalid-app-data' ? undefined : dirname(ownedApp);
    }
    if (!boundPaths.has(name) && (fault === 'unavailable-defaults' || fault === 'unavailable-user-default' && name === 'userData' || fault === 'unavailable-session-default' && name === 'sessionData')) throw new Error(`Failed to get '${name}' path`);
    if (!boundPaths.has(name)) directories.add(paths[name]); // Native default getters can create the old profile.
    return paths[name];
  };
  app.setPath = (name: string, path: string) => {
    events.push(`bind:${name}`); assert.equal(directories.has(path), true);
    if (fault !== 'ignored-binding') { paths[name] = path; boundPaths.add(name); }
  }; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.send = () => {}; this.webContents.print = (...args: unknown[]) => { prints.push(args); (args[1] as (success: boolean) => void)(true); }; windows.push(this); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter {
    state = 'ready'; options: any; stops = 0; lifecycle: any[] = []; failLifecycle = false; workspaceOpen = false; requests: string[] = [];
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    async start() {}
    async request(method: string) {
      this.requests.push(method);
      if (method === 'workspace.status') return { method, open: this.workspaceOpen, experimental: true, storage: 'experimental-file' };
      if (method === 'workspace.create') this.workspaceOpen = true;
      if (method === 'ui.context') return { method, workspace: { demo: true }, member: { role: 'owner' } };
      return { method, experimental: true };
    }
    async updateJobLifecycle(state: any) { this.lifecycle.push(JSON.parse(JSON.stringify(state))); if (this.failLifecycle) { this.state = 'failed'; throw new Error('Lifecycle acknowledgement failed.'); } return { applied: true }; }
    async stop() { this.stops++; this.state = 'stopped'; return { graceful: true, forced: false }; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(menu: any) { menus.push(menu); } destroy() {} }
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } };
  const powerMonitor = new EventEmitter();
  const electron = { app, BrowserWindow: Window, Tray, shell: { openExternal: async (...args: unknown[]) => { externalOpens.push(args); } }, powerMonitor, Menu: { buildFromTemplate: (items: any) => items }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle(_scheme: string, handler: any) { protocolHandlers.push(handler); } }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message), showOpenDialog: async (...args: unknown[]) => { openDialogs.push(args); return { canceled: true, filePaths: [] }; } }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  let source = await readFile(desktopMain, 'utf8');
  if (postgresGate) source = source.replace("await import(pathToFileURL(join(engineRoot, 'platform/runtime/native/desktop-database.ts')).href)", '__postgresModule');
  vm.runInNewContext(source, { __dirname: join(ownedApp, 'app', 'desktop'), require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './demo-profile.cjs') return profileModule.exports;
    if (name === '../../package.json') return { chausarPreview: !postgresGate, version: '2.3.4' };
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    if (name === 'node:fs/promises') return { readFile: async (path: string) => { if (path.endsWith('package.json')) { await metadataGate; return JSON.stringify({ chausarPreview: !postgresGate, version: '2.3.4' }); } return 'a'.repeat(43); }, mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }) };
    if (name === 'node:net' && postgresGate) return { createServer: () => ({ once() {}, listen(_port: number, _host: string, callback: () => void) { callback(); }, address: () => ({ port: 5432 }), close(callback: () => void) { callback(); } }) };
    return desktopRequire(name);
  }, __postgresModule: { startDesktopDatabase: async () => {
    await postgresGate;
    // Synthetic database states for the release-lane start-up; the real module is tested in release-desktop-database.test.ts.
    if ((profileEnvironment as NodeJS.ProcessEnv).SYNTHETIC_DATABASE_STATE === 'newer-than-app') throw Object.assign(new Error('This database was written by a newer Chausar. Install that version again; this one will not open it.'), { code: 'DATABASE_NEWER_THAN_APP' });
    if ((profileEnvironment as NodeJS.ProcessEnv).SYNTHETIC_DATABASE_STATE === 'needs-upgrade') return { state: 'needs-upgrade', code: 'POSTGRES_UPGRADE_REQUIRED', message: 'The local database needs an upgrade.', close: async () => { databaseCloses++; } };
    return { state: 'running', url: 'postgresql://chausar:synthetic@127.0.0.1:55400/postgres', close: async () => { databaseCloses++; } };
  } }, process: { argv: ['electron', ownedApp, ...args], env: profileEnvironment, platform: 'win32', resourcesPath: ownedResources }, console: { error: (message: string) => diagnostics.push(message) }, URL, Response, Buffer });
  await flush();
  return { app, windows, engines, menus, errors, diagnostics, handlers, externalOpens, prints, openDialogs, protocolHandlers, powerMonitor, events, paths, pathReads, directories, databaseCloses: () => databaseCloses };
}

test('demo claims new user and session directories before the lock and pins worker storage to that profile', async () => {
  const d = await desktop(['--demo'], Promise.resolve(), undefined, { CHAUSAR_VAULT_DIRECTORY: '/real/vaults' });
  assert.equal(d.errors.length, 0);
  assert.deepEqual(d.events, [`mkdir:${demoProfileRoot}`, `mkdir:${join(demoProfileRoot, 'userData')}`, `mkdir:${join(demoProfileRoot, 'sessionData')}`, 'bind:userData', 'bind:sessionData', 'lock', 'ready']);
  assert.equal(d.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY, join(demoProfileRoot, 'userData', 'vaults'));
  assert.deepEqual(d.paths, { userData: join(demoProfileRoot, 'userData'), sessionData: join(demoProfileRoot, 'sessionData') });
  assert.equal(d.directories.has(ownedApp), false);
});

test('unavailable Electron defaults still bind the explicit fresh profile before lock, ready and worker startup', async () => {
  for (const fault of ['unavailable-defaults', 'unavailable-user-default', 'unavailable-session-default', 'unavailable-app-data'] as const) {
    const d = await desktop(['--demo'], Promise.resolve(), undefined, { CHAUSAR_VAULT_DIRECTORY: '/real/vaults', CHAUSAR_KEYCHAIN_MANIFEST: '/real/keychain' }, fault);
    assert.deepEqual(d.errors, []);
    assert.deepEqual(d.events, [`mkdir:${demoProfileRoot}`, `mkdir:${join(demoProfileRoot, 'userData')}`, `mkdir:${join(demoProfileRoot, 'sessionData')}`, 'bind:userData', 'bind:sessionData', 'lock', 'ready']);
    assert.deepEqual(d.pathReads, [
      { name: 'appData', bound: false },
      { name: 'userData', bound: true }, { name: 'sessionData', bound: true },
      { name: 'userData', bound: true }, { name: 'sessionData', bound: true },
    ]);
    assert.equal(d.engines.length, 1); assert.equal(d.windows.length, 1);
    assert.equal(d.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY, join(demoProfileRoot, 'userData', 'vaults'));
    assert.equal(d.engines[0].options.environment.CHAUSAR_KEYCHAIN_MANIFEST, undefined);
    assert.equal(d.databaseCloses(), 0); assert.equal(d.directories.has(ownedApp), false);
  }
});

test('invalid OS defaults and explicit Electron profile overrides fail before lock or storage access', async () => {
  const invalid = await desktop(['--demo'], Promise.resolve(), undefined, {}, 'invalid-app-data');
  assert.match(invalid.errors[0], /invalid application data path/);
  const override = await desktop(['--demo', '--user-data-dir=/real/profile']);
  assert.match(override.errors[0], /user-data-dir/); assert.deepEqual(override.pathReads, []);
  for (const d of [invalid, override]) {
    assert.equal(d.events.includes('lock'), false); assert.equal(d.events.includes('ready'), false);
    assert.equal(d.engines.length, 0); assert.equal(d.windows.length, 0); assert.equal(d.app.quits, 1);
    assert.deepEqual([...d.directories], [syntheticTemporary]);
  }
});

test('startup diagnostics bound source locations and whitelist codes without logging sensitive error content', async () => {
  const secret = 'SYNTHETIC_PRIVATE_TOKEN';
  for (const [suppliedCode, loggedCode] of [['ENAMETOOLONG', 'ENAMETOOLONG'], [secret, 'UNCLASSIFIED']]) {
    const failure = Object.assign(new Error(`${secret}: /private/profile`), { code: suppliedCode });
    failure.stack = `Error: ${secret} /main.cjs:999:1\n at claim (/private/${secret}/demo-profile.cjs:26:3)\n at caller (C:\\private\\${secret}\\main.cjs:16:27)\n at outside (/private/${secret}/unknown.cjs:50:2)\n at observer (/private/${secret}/preview-lifecycle.cjs:9:8)\n at extra (/private/${secret}/main.cjs:99:3)`;
    const d = await desktop(['--demo'], Promise.resolve(), undefined, {}, undefined, failure);
    assert.deepEqual(d.diagnostics, [`Chausar startup failed: stage=profile-bind; code=${loggedCode}; frames=demo-profile.cjs:26:3,main.cjs:16:27,preview-lifecycle.cjs:9:8`]);
    assert.ok(d.diagnostics[0].length < 200); assert.equal(d.diagnostics[0].includes(secret), false);
    assert.equal(d.events.includes('lock'), false); assert.equal(d.engines.length, 0); assert.equal(d.app.quits, 1);
  }
  let codeReads = 0;
  const dynamic = new Error('Synthetic changing error properties');
  Object.defineProperty(dynamic, 'code', { get: () => ++codeReads === 1 ? 'EACCES' : secret });
  Object.defineProperty(dynamic, 'stack', { get: () => { throw new Error(secret); } });
  const d = await desktop(['--demo'], Promise.resolve(), undefined, {}, undefined, dynamic);
  assert.deepEqual(d.diagnostics, ['Chausar startup failed: stage=profile-bind; code=EACCES; frames=unavailable']);
  assert.equal(codeReads, 1); assert.equal(d.app.quits, 1);
  for (const message of ["Failed to get 'userData' path", "Failed to get 'userData' path\n"]) {
    const failure = new Error(message); failure.stack = `Error: ${secret}\n${' '.repeat(8192)}\n at late (/private/${secret}/main.cjs:99:3)`;
    const d = await desktop(['--demo'], Promise.resolve(), undefined, {}, undefined, failure);
    const code = message.endsWith('\n') ? 'UNCLASSIFIED' : 'ELECTRON_PATH_UNAVAILABLE';
    assert.deepEqual(d.diagnostics, [`Chausar startup failed: stage=profile-bind; code=${code}; frames=unavailable`]);
  }
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
  assert.deepEqual(production.events, ['lock', 'ready']); assert.equal(production.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY, join(ownedApp, 'vaults'));
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

test('the new UI is the default document and the legacy renderer is served only behind its explicit flag', async () => {
  const standard = await desktop(['--demo']);
  assert.equal(standard.errors.length, 0);
  assert.equal(standard.windows[0].webContents.mainFrame.url, 'chausar://app/ui/index.html');
  let prevented = false;
  standard.windows[0].webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'chausar://app/index.html');
  assert.equal(prevented, true, 'The default UI cannot navigate to the legacy renderer.');
  for (const path of ['/index.html', '/', '/app.js']) assert.equal((await standard.protocolHandlers[0]({ url: `chausar://app${path}` })).status, 404);
  const legacy = await desktop(['--demo', '--legacy-renderer']);
  assert.equal(legacy.errors.length, 0);
  assert.equal(legacy.windows[0].webContents.mainFrame.url, 'chausar://app/index.html');
  assert.equal((await legacy.protocolHandlers[0]({ url: 'chausar://app/index.html' })).status, 200);
  const handler = legacy.handlers.get('chausar:request');
  const reply = await handler({ sender: legacy.windows[0].webContents, senderFrame: legacy.windows[0].webContents.mainFrame }, { method: 'workspace.status', payload: {} });
  assert.equal(reply.ok, true);
});

test('production desktop forwards its fixed packaged custody manifest through the real startup composition', async () => {
  // Electron and PostgreSQL boundaries are synthetic; the actual main source runs.
  const d = await desktop(['--production'], Promise.resolve(), Promise.resolve(), { CHAUSAR_KEYCHAIN_MANIFEST: '/untrusted/manifest.json' });
  assert.equal(d.errors.length, 0); assert.equal(d.engines.length, 1);
  assert.equal(d.engines[0].options.environment.CHAUSAR_DEMO, '0');
  assert.equal(d.engines[0].options.environment.CHAUSAR_KEYCHAIN_MANIFEST, join(ownedResources, 'runtime-binaries', 'keychain', 'manifest.json'));
  d.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(d.engines[0].stops, 1); assert.equal(d.databaseCloses(), 1);
});

test('release lane: an older database cluster starts the engine without a database and says why; a newer one refuses start-up', async () => {
  const upgrade = await desktop(['--production'], Promise.resolve(), Promise.resolve(), { SYNTHETIC_DATABASE_STATE: 'needs-upgrade' });
  assert.equal(upgrade.engines.length, 1);
  assert.equal(upgrade.engines[0].options.environment.CHAUSAR_DATABASE_STATE, 'needs-upgrade');
  assert.equal(upgrade.engines[0].options.environment.CHAUSAR_POSTGRES_URL, undefined);
  assert.deepEqual(upgrade.errors, ['The local database needs an upgrade.']);
  assert.ok(upgrade.diagnostics.includes('Chausar database: code=POSTGRES_UPGRADE_REQUIRED'));
  const running = await desktop(['--production'], Promise.resolve(), Promise.resolve());
  assert.equal(running.engines[0].options.environment.CHAUSAR_POSTGRES_URL, 'postgresql://chausar:synthetic@127.0.0.1:55400/postgres');
  assert.equal(running.engines[0].options.environment.CHAUSAR_DATABASE_STATE, undefined);
  const newer = await desktop(['--production'], Promise.resolve(), Promise.resolve(), { SYNTHETIC_DATABASE_STATE: 'newer-than-app' });
  assert.equal(newer.engines.length, 0); assert.equal(newer.windows.length, 0); assert.equal(newer.app.quits, 1);
  assert.match(newer.errors[0], /newer Chausar/);
});

test('release lane: a launch through the launcher asks the engine to confirm a trial once a workspace opens', async () => {
  const plain = await desktop(['--demo']);
  const plainHandler = plain.handlers.get('chausar:request'), plainWindow = plain.windows[0];
  await plainHandler({ sender: plainWindow.webContents, senderFrame: plainWindow.webContents.mainFrame }, { method: 'workspace.open', payload: {} }); await flush();
  assert.equal(plain.engines[0].requests.includes('release.status'), false);
  const d = await desktop(['--demo'], Promise.resolve(), undefined, { CHAUSAR_INSTALL_ROOT: '/synthetic/install' });
  const engine = d.engines[0], handler = d.handlers.get('chausar:request'), window = d.windows[0];
  assert.deepEqual(engine.requests.filter((method: string) => method === 'release.status'), ['release.status']);
  await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { method: 'workspace.status', payload: {} }); await flush();
  assert.equal(engine.requests.filter((method: string) => method === 'release.status').length, 1);
  const reply = await handler({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { method: 'workspace.open', payload: {} }); await flush();
  assert.equal(reply.ok, true);
  assert.equal(engine.requests.at(-1), 'release.status');
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

// SH-10 and FR-04: the two shell channels, each answering only the trusted main frame.
const trustedEvent = (window: any) => ({ sender: window.webContents, senderFrame: window.webContents.mainFrame });
const settleRateLimit = () => new Promise<void>(accept => setTimeout(accept, 1_050));

test('shell.openExternal opens only a trusted, re-serialized https address once a second while a workspace is open', async () => {
  const d = await desktop(['--demo', '--ui-preview']);
  assert.equal(d.errors.length, 0);
  const window = d.windows[0], open = d.handlers.get('chausar:shell-open-external');
  assert.equal(typeof open, 'function');
  // Untrusted senders and stale frames are refused before the address is read.
  assert.equal(await open({ sender: {}, senderFrame: window.webContents.mainFrame }, 'https://example.com/'), 'refused');
  assert.equal(await open({ sender: window.webContents, senderFrame: { url: 'chausar://app/index.html' } }, 'https://example.com/'), 'refused');
  const refused = ['javascript:alert(1)', 'file:///etc/passwd', 'chausar://app/ui/index.html', 'http://example.com/', 'mailto:someone@example.com',
    'data:text/html,hi', 'https://user:secret@example.com/', 'https://user@example.com/', 'https://localhost/', 'https://127.0.0.1/', 'https://0x7f.1/',
    'https://[::1]/', 'https://intranet/', 'https://a.localhost/', ` https://example.com/`, 'https://exa mple.com/', 'https://example.com/\n',
    `https://example.com/${'a'.repeat(2048)}`, '', 42, null, undefined, { href: 'https://example.com/' }, ['https://example.com/']];
  for (const value of refused) assert.equal(await open(trustedEvent(window), value), 'refused', String(value));
  assert.deepEqual(d.externalOpens, []);
  // Accepted and re-serialized by URL: only the serialized string reaches the shell.
  assert.equal(await open(trustedEvent(window), 'https://EXAMPLE.com:443/a/../b?q=1#f'), 'opened');
  assert.deepEqual(d.externalOpens, [['https://example.com/b?q=1#f']]);
  // One a second: a second valid address at once is refused, then accepted after the interval.
  assert.equal(await open(trustedEvent(window), 'https://example.org/'), 'refused');
  await settleRateLimit();
  assert.equal(await open(trustedEvent(window), 'https://example.org/'), 'opened');
  assert.deepEqual(d.externalOpens, [['https://example.com/b?q=1#f'], ['https://example.org/']]);
});

test('shell.openExternal is refused while no workspace is open', async () => {
  const d = await desktop(['--demo']);
  assert.equal(d.errors.length, 0);
  assert.equal(d.engines[0].workspaceOpen, false);
  assert.equal(await d.handlers.get('chausar:shell-open-external')(trustedEvent(d.windows[0]), 'https://example.com/'), 'refused');
  assert.deepEqual(d.externalOpens, []);
});

test('shell.print shows the system dialog for the trusted window only, with nothing from the renderer in its options', async () => {
  const d = await desktop(['--demo', '--ui-preview']);
  const window = d.windows[0], print = d.handlers.get('chausar:shell-print');
  assert.equal(typeof print, 'function');
  assert.equal(await print({ sender: {}, senderFrame: window.webContents.mainFrame }, 'recovery-kit'), 'refused');
  for (const kind of ['<h1>kit</h1>', '/etc/passwd', { silent: true }, 'file:///tmp/kit.pdf', undefined, 1]) assert.equal(await print(trustedEvent(window), kind), 'refused');
  assert.equal(d.prints.length, 0);
  assert.equal(await print(trustedEvent(window), 'recovery-kit'), 'printed');
  assert.equal(d.prints.length, 1);
  assert.deepEqual(d.prints[0][0], { silent: false });
  assert.equal(d.prints[0].length, 2); assert.equal(typeof d.prints[0][1], 'function');
  assert.equal(await print(trustedEvent(window), 'page'), 'refused', 'One print dialog a second.');
  await settleRateLimit();
  assert.equal(await print(trustedEvent(window), 'page'), 'printed');
  assert.deepEqual(d.prints.map(args => args[0]), [{ silent: false }, { silent: false }]);
  // Navigation stays denied and new windows stay refused.
  assert.equal(window.webContents.open().action, 'deny');
  let prevented = false; window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'https://example.com/');
  assert.equal(prevented, true);
});

test('imports.pickFile (frame-today): the trusted window gets the system dialog, a backup opens in the profile\'s managed backups folder', async () => {
  const d = await desktop(['--demo', '--ui-preview']);
  const window = d.windows[0], pick = d.handlers.get('chausar:imports-pick-file');
  assert.equal(typeof pick, 'function');
  assert.deepEqual(await pick({ sender: {}, senderFrame: window.webContents.mainFrame }, 'statement'), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  assert.deepEqual(await pick(trustedEvent(window), '/etc/passwd'), { outcome: 'refused', code: 'FILE_KIND_REFUSED' });
  assert.equal(d.openDialogs.length, 0);
  assert.deepEqual(await pick(trustedEvent(window), 'statement'), { outcome: 'cancelled' });
  assert.deepEqual(await pick(trustedEvent(window), 'backup'), { outcome: 'cancelled' });
  assert.equal(d.openDialogs.length, 2);
  assert.equal(d.openDialogs[0][0], window, 'the dialog belongs to the app window');
  // The engine's vault directory for this demo profile, plus `backups`, where workspace.backup writes.
  const vaults = d.engines[0].options.environment.CHAUSAR_VAULT_DIRECTORY;
  assert.equal((d.openDialogs[1][1] as { defaultPath: string }).defaultPath, join(vaults, 'backups'));
});
