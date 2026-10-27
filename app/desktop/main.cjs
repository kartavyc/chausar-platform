const { app, BrowserWindow, ipcMain, protocol, session, shell, dialog, Tray, Menu, nativeImage, powerMonitor, Notification } = require('electron');
const { readFile, writeFile, mkdir, lstat } = require('node:fs/promises');
const { EngineHarness } = require('./engine-harness.cjs');
const { REQUEST_CHANNEL, STATUS_CHANNEL, VENTURE_EVENT_CHANNEL, OPEN_EXTERNAL_CHANNEL, TRUSTED_DOCUMENT, validateRequest, validateExternalUrl, assertTrustedSender, isTrustedDocument, publicError } = require('./ipc-contract.cjs');
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
// The window is the Ink app (app/ui), built to app/ui/dist by npm run build:ui; a package carries the build inside it.
const inkRoot = join(root, 'app/ui/dist');
let inkFiles = null;
/** The allowlist for Ink: every regular file under app/ui/dist with a known type, listed once at startup. */
async function listInkFiles() {
  const { readdir } = require('node:fs/promises');
  const found = new Map();
  const notBuilt = 'The Ink app is not built. Run npm run build:ui, then start Chausar again.';
  async function walk(folder, prefix) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(folder, entry.name), name + '/');
      else if (entry.isFile() && /^[A-Za-z0-9._/-]+\.(html|js|css|svg|woff2|txt|json|png|webmanifest)$/.test(name)) found.set('/' + name, name);
    }
  }
  try { await walk(inkRoot, ''); }
  catch (error) { if (error.code === 'ENOENT') throw new Error(notBuilt); throw error; }
  if (!found.has('/index.html')) throw new Error(notBuilt);
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
  engine.on('status', status => { if (window && !window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, status); if (status?.state !== 'ready') noteEngineDown(); });
  // Run events, already checked by the harness: the window reads the queue or the run again when one arrives.
  engine.on('venture-event', event => { if (window && !window.isDestroyed()) window.webContents.send(VENTURE_EVENT_CHANNEL, event); noteTrayEvent(event); });
  // A client report's PDF (5A5): the engine's print port; a hidden window that runs no script prints the report's HTML.
  engine.on('print', (request, answer) => { require('./report-print.cjs').printReport(request, { BrowserWindow, session }).then(answer, () => answer(null)); });
  await engine.start();
  await reportJobLifecycle();
}
// The tray (Ink v2 wave 4, package 4G3; catalogue O13 and O23), there whenever Chausar runs, so the count it shows is
// true in every mode. Its tooltip says whether a run is working (busy lingers 1.5 s after the last run stops, so a short
// pause does not flicker) and how many things need the owner; its menu's "3 need you" opens the window at the approval
// page. The count comes only from the engine's notify.new, which carries one when an alert is due outside the app (the
// pause, quiet hours and pacing of venture/notify/centre.ts already held), and it shows once as an OS notification
// that says the count alone. When the owner looks at the window the count is cleared: it was news since they last
// looked, and a number left standing could be wrong. The first time the window closes while Chausar keeps running in
// the background on Windows, one balloon says so, never again (a file in the app's own folder remembers). A click on
// any of them opens the window and nothing more: a notification never acts on its own.
const APPROVE_HASH = '#/approve/next';
const BUSY_LINGER_MS = 1500;
const BUSY_EVENTS = ['run.started', 'run.step', 'run.call'];
const IDLE_EVENTS = ['run.done', 'run.failed', 'run.stopped', 'run.waiting'];
const STILL_RUNNING = 'Chausar is still running. It keeps your scheduled checks going.';
const STILL_RUNNING_FILE = 'still-running-shown';
const busyRuns = new Set();
let trayCount = 0; let trayBusy = false; let idleTimer = null; let countNotice = null; let stillRunningAsked = false;
const appName = () => (demoMode ? 'Chausar Preview (synthetic data)' : 'Chausar');
const needYou = count => `${count} ${count === 1 ? 'needs' : 'need'} you`;
function trayTooltip() {
  const parts = [trayBusy ? 'working' : '', trayCount > 0 ? needYou(trayCount) : ''].filter(Boolean);
  return parts.length ? `${appName()}: ${parts.join(', ')}` : appName();
}
function trayMenu() {
  return Menu.buildFromTemplate([
    ...(trayCount > 0 ? [{ label: needYou(trayCount), click: () => openApprovals() }, { type: 'separator' }] : []),
    { label: 'Open Chausar', click: () => openWindow() }, { type: 'separator' }, { label: 'Quit Chausar and stop jobs', click: () => app.quit() },
  ]);
}
function setTrayCount(count) {
  if (count === trayCount) return;
  trayCount = count;
  if (tray) { tray.setToolTip(trayTooltip()); tray.setContextMenu(trayMenu()); }
}
function setTrayBusy(busy) {
  if (busy === trayBusy) return;
  trayBusy = busy;
  tray?.setToolTip(trayTooltip());
}
/** Busy while any run is working; idle only once none has been for BUSY_LINGER_MS. */
function settleBusy() {
  if (busyRuns.size) { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } setTrayBusy(true); return; }
  if (!trayBusy || idleTimer) return;
  idleTimer = setTimeout(() => { idleTimer = null; if (!busyRuns.size) setTrayBusy(false); }, BUSY_LINGER_MS);
  idleTimer?.unref?.();
}
function noteEngineDown() { busyRuns.clear(); settleBusy(); }
function clearCountNotice() { try { countNotice?.close(); } catch {} countNotice = null; }
/** A run event the harness checked: runs make the tray busy or idle; notify.new with a count is an alert. */
function noteTrayEvent(event) {
  if (!event || typeof event.type !== 'string') return;
  if (typeof event.runId === 'string' && (BUSY_EVENTS.includes(event.type) || IDLE_EVENTS.includes(event.type))) {
    if (BUSY_EVENTS.includes(event.type)) busyRuns.add(event.runId); else busyRuns.delete(event.runId);
    settleBusy();
  }
  if (event.type !== 'notify.new' || !Number.isSafeInteger(event.count) || event.count < 0) return;
  setTrayCount(event.count);
  if (event.count === 0) { clearCountNotice(); return; }
  if (typeof Notification !== 'function' || typeof Notification.isSupported !== 'function' || !Notification.isSupported()) return;
  // One notice at a time: a newer count replaces the older one. It says the count and nothing else.
  clearCountNotice();
  countNotice = new Notification({ title: 'Chausar', body: needYou(event.count) });
  countNotice.on('click', () => openApprovals());
  countNotice.show();
}
function openWindow(hash = '') {
  if (window && !window.isDestroyed()) {
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    // Only the route after the hash changes: the page is not loaded again.
    if (hash) window.loadURL(TRUSTED_DOCUMENT + hash);
  } else createWindow(hash);
}
function openApprovals() { openWindow(APPROVE_HASH); }
/** Once ever, on Windows in the background: the window closed, and Chausar keeps running. */
function noteStillRunning() {
  if (!backgroundRequested || stopping || stillRunningAsked || process.platform !== 'win32' || !tray || typeof tray.displayBalloon !== 'function') return;
  stillRunningAsked = true;
  writeFile(join(app.getPath('userData'), STILL_RUNNING_FILE), 'shown', { flag: 'wx', mode: 0o600 })
    .then(() => { tray?.displayBalloon({ title: 'Chausar', content: STILL_RUNNING, iconType: 'info' }); },
      () => { /* Shown before, or the app's own folder is not writable: never shown twice. */ });
}
function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));
  if (icon.isEmpty()) throw new Error('The tray icon is missing.');
  tray = new Tray(icon);
  tray.setToolTip(trayTooltip());
  tray.setContextMenu(trayMenu());
  tray.on('double-click', () => openWindow());
}
function createWindow(hash = '') {
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: require('electron').nativeTheme?.shouldUseDarkColors ? '#111214' : '#fbfbfa', title: appName(), show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadURL(TRUSTED_DOCUMENT + hash);
  window.on('closed', () => { window = null; lifecycleChanged(); noteStillRunning(); });
  // Notifications (Ink v2 wave 4, 4G1): the owner is watching only while this window is shown, not minimised and
  // focused; alerts outside the app wait while they are. Told to the engine on each change.
  // The tray's count was news since the owner last looked (4G3): looking clears it.
  const tellWatching = () => {
    const watching = !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused();
    engine?.reportWatching?.(watching);
    if (watching) { setTrayCount(0); clearCountNotice(); }
  };
  for (const change of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'closed']) window.on(change, tellWatching);
  lifecycleChanged();
}
if (singleInstance) app.whenReady().then(async () => {
  if (stopping) return;
  // Listed before the engine starts, so an unbuilt Ink app stops the start with its own plain reason.
  try { inkFiles = await listInkFiles(); }
  catch (error) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); return; }
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
    const url = new URL(request.url); const file = inkFiles.get(url.pathname); if (url.hostname !== 'app' || !file) return new Response('Not found', { status: 404 });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    const ext = file.slice(file.lastIndexOf('.')); const data = await readFile(join(inkRoot, file));
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
  // The network import (4D1): the owner picks one of their own files; a worker process reads it and only what Chausar keeps comes back.
  ipcMain.handle(require('./ipc-contract.cjs').PICK_FILE_CHANNEL, (event, input) => require('./network-files.cjs').pickNetworkFile(event, input, { dialog, window, assertTrustedSender, publicError, workerPath: join(engineRoot, 'platform/runtime/venture/network/extract-worker.ts') }));
  // Export for your CA (4J4): the engine makes the month's CSV, the owner picks where it goes, and it is saved atomically.
  ipcMain.handle(require('./ipc-contract.cjs').MONEY_EXPORT_CHANNEL, (event, input) => require('./money-export.cjs').saveMoneyExport(event, input, { dialog, window, assertTrustedSender, publicError, engine, documents: app.getPath('documents') }));
  // A client report (5A5): the engine makes the files, the owner picks a folder, and they are saved atomically in a new folder.
  ipcMain.handle(require('./ipc-contract.cjs').REPORT_SAVE_CHANNEL, (event, input) => require('./report-save.cjs').saveReport(event, input, { dialog, window, assertTrustedSender, publicError, engine, documents: app.getPath('documents') }));
  try { startupTask = startEngine(); await startupTask; if (stopping) return; createTray(); createWindow(); }
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
