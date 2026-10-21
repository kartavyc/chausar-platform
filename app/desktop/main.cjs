const { app, BrowserWindow, ipcMain, protocol, session, shell, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const { readFile, writeFile, mkdir, lstat } = require('node:fs/promises');
const { EngineHarness } = require('./engine-harness.cjs');
const { REQUEST_CHANNEL, STATUS_CHANNEL, VENTURE_EVENT_CHANNEL, OPEN_EXTERNAL_CHANNEL, validateRequest, validateExternalUrl, assertTrustedSender, isTrustedDocument, publicError } = require('./ipc-contract.cjs');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:net');

protocol.registerSchemesAsPrivileged([{ scheme: 'chausar', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let window; let engine; let database; let tray; let demoMode = false; let stopping = false; let startupTask = Promise.resolve();
let hostAwake = false;
const backgroundRequested = process.argv.includes('--background');
const root = resolve(__dirname, '../..');
const renderer = join(root, 'app/renderer');
// The Ink app (app/ui, built to app/ui/dist) replaces the old renderer only when asked: --ink or CHAUSAR_UI=ink.
const inkRequested = process.argv.includes('--ink') || process.env.CHAUSAR_UI === 'ink';
const inkRoot = join(root, 'app/ui/dist');
let inkFiles = null;
/** The allowlist for Ink: every regular file under app/ui/dist with a known type, listed once at startup. */
async function listInkFiles() {
  const { readdir } = require('node:fs/promises');
  const found = new Map();
  async function walk(folder, prefix) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(folder, entry.name), name + '/');
      else if (entry.isFile() && /^[A-Za-z0-9._/-]+\.(html|js|css|svg|woff2|txt|json)$/.test(name)) found.set('/' + name, name);
    }
  }
  await walk(inkRoot, '');
  if (!found.has('/index.html')) throw new Error('The Ink app is not built. Run npm run build:ui, then start Chausar again.');
  found.set('/', 'index.html');
  return found;
}
const engineRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : root;
function reportJobLifecycle() {
  if (engine?.state !== 'ready') return Promise.resolve();
  return engine.updateJobLifecycle({ awake: !stopping && hostAwake, windowOpen: !stopping && !!window && !window.isDestroyed(), backgroundEnabled: !stopping && backgroundRequested });
}
function lifecycleChanged() {
  void reportJobLifecycle().catch(error => {
    console.error(publicError(error).message);
    if (!stopping) { dialog.showErrorBox('Chausar jobs stopped', 'The engine could not confirm the desktop state. Restart Chausar before running jobs.'); app.quit(); }
  });
}
async function startEngine() {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (stopping) return;
  const demo = metadata.chausarPreview === true || process.argv.includes('--demo'); demoMode = demo;
  if (metadata.chausarPreview === true && process.argv.includes('--production')) throw new Error('This unsigned preview supports synthetic data only.');
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: join(app.getPath('userData'), 'vaults'), CHAUSAR_DEMO: demo ? '1' : '0' };
  const binaries = app.isPackaged ? join(process.resourcesPath, 'runtime-binaries') : join(root, 'runtime-binaries');
  if (!demo && !environment.CHAUSAR_POSTGRES_URL) {
    const { startBundledPostgres } = await import(pathToFileURL(join(engineRoot, 'scripts/postgres-runtime.mjs')).href);
    const privateFolder = join(app.getPath('userData'), 'database'); await mkdir(privateFolder, { recursive: true, mode: 0o700 });
    const passwordFile = join(privateFolder, 'database-password');
    try { const stat = await lstat(passwordFile); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('The database credential file is unsafe.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; await writeFile(passwordFile, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 }); }
    const password = (await readFile(passwordFile, 'utf8')).trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(password)) throw new Error('The local database credential file is invalid.');
    const selector = createServer();
    await new Promise((accept, reject) => { selector.once('error', reject); selector.listen(0, '127.0.0.1', accept); });
    const port = selector.address().port; await new Promise((accept, reject) => selector.close(error => error ? reject(error) : accept()));
    const suffix = process.platform === 'win32' ? '.exe' : '';
    database = await startBundledPostgres({ postgresBinary: join(binaries, 'postgres/bin/postgres' + suffix), initdbBinary: join(binaries, 'postgres/bin/initdb' + suffix), pgCtlBinary: join(binaries, 'postgres/bin/pg_ctl' + suffix), dataDirectory: join(privateFolder, 'cluster'), passwordFile, user: 'chausar', port });
    environment.CHAUSAR_POSTGRES_URL = `postgresql://chausar:${encodeURIComponent(password)}@127.0.0.1:${port}/postgres`;
  }
  if (!demo && !environment.CHAUSAR_PYTHON) environment.CHAUSAR_PYTHON = process.platform === 'win32' ? join(binaries, 'python/python.exe') : join(binaries, 'python/bin/python3');
  if (stopping) return;
  engine = new EngineHarness({ workerPath: join(engineRoot, 'platform/runtime/worker.ts'), environment, requestTimeoutMs: 900_000 });
  engine.on('status', status => { if (window && !window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, status); });
  // Run events, already checked by the harness: the window reads the queue or the run again when one arrives.
  engine.on('venture-event', event => { if (window && !window.isDestroyed()) window.webContents.send(VENTURE_EVENT_CHANNEL, event); });
  await engine.start();
  await reportJobLifecycle();
}
function createBackgroundTray() {
  if (!backgroundRequested) return;
  const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));
  if (icon.isEmpty()) throw new Error('The background-mode tray icon is missing.');
  tray = new Tray(icon);
  tray.setToolTip(demoMode ? 'Chausar Preview — synthetic data' : 'Chausar');
  const open = () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else createWindow(); };
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Chausar', click: open }, { type: 'separator' }, { label: 'Quit Chausar and stop jobs', click: () => app.quit() }]));
  tray.on('double-click', open);
}
function createWindow() {
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: inkFiles ? (require('electron').nativeTheme?.shouldUseDarkColors ? '#111214' : '#fbfbfa') : '#f7f5ee', title: demoMode ? 'Chausar Preview — synthetic data' : 'Chausar', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadURL('chausar://app/index.html');
  window.on('closed', () => { window = null; lifecycleChanged(); });
  lifecycleChanged();
}
if (singleInstance) app.whenReady().then(async () => {
  if (stopping) return;
  if (inkRequested) {
    try { inkFiles = await listInkFiles(); }
    catch (error) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); return; }
  }
  hostAwake = true;
  powerMonitor.on('suspend', () => { hostAwake = false; lifecycleChanged(); });
  powerMonitor.on('resume', () => { hostAwake = true; lifecycleChanged(); });
  // One permission is allowed: the app's own window may write text to the clipboard (Copy brief, Copy invoice). Everything else is refused.
  // The page may carry an Ink '#/' route; the rule is the IPC sender check's own, so the two never drift apart.
  const clipboardWrite = (contents, permission) => permission === 'clipboard-sanitized-write' && Boolean(window) && contents === window.webContents && isTrustedDocument(contents.mainFrame?.url);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(clipboardWrite(contents, permission)));
  session.defaultSession.setPermissionCheckHandler((contents, permission) => clipboardWrite(contents, permission));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('chausar://app/') }));
  protocol.handle('chausar', async request => {
    const url = new URL(request.url); const files = inkFiles ?? new Map([['/index.html', 'index.html'], ['/', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/launch.js', 'launch.js'], ['/assets/icon.svg', 'assets/icon.svg']]);
    const file = files.get(url.pathname); if (url.hostname !== 'app' || !file) return new Response('Not found', { status: 404 });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json' };
    const ext = file.slice(file.lastIndexOf('.')); const data = await readFile(join(inkFiles ? inkRoot : renderer, file));
    return new Response(data, { headers: { 'Content-Type': types[ext], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' } });
  });
  ipcMain.handle(REQUEST_CHANNEL, async (event, input) => {
    try {
      assertTrustedSender(event, window?.webContents);
      const request = validateRequest(input);
      return { ok: true, result: await engine.request(request.method, request.payload) };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (event, input) => {
    try { assertTrustedSender(event, window?.webContents); await shell.openExternal(validateExternalUrl(input)); return { ok: true }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
  try { startupTask = startEngine(); await startupTask; if (stopping) return; createBackgroundTray(); createWindow(); }
  catch (error) { if (!stopping) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); } }
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (engine?.state === 'ready') createWindow(); });
app.on('activate', () => { if (!window && engine?.state === 'ready') createWindow(); });
app.on('window-all-closed', () => { if (!backgroundRequested) app.quit(); });
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  startupTask.catch(error => console.error(publicError(error).message)).then(() => reportJobLifecycle()).catch(error => console.error(publicError(error).message)).then(() => engine?.stop()).then(result => {
    if (result && !result.graceful) console.error('The engine required termination; unfinished actions need reconciliation.');
  }).catch(error => console.error(publicError(error).message)).then(() => database?.close()).catch(error => console.error(publicError(error).message)).finally(() => { tray?.destroy(); app.quit(); });
});
