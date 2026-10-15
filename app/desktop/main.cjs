const { app, BrowserWindow, ipcMain, protocol, session, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const { readFile, writeFile, mkdir, lstat, unlink } = require('node:fs/promises');
const { EngineHarness } = require('./engine-harness.cjs');
const { REQUEST_CHANNEL, STATUS_CHANNEL, EVENT_CHANNEL, validateRequest, assertTrustedSender, publicError } = require('./ipc-contract.cjs');
const { join, resolve, dirname } = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:net');
const { readUiAsset } = require('./ui-assets.cjs');
const { registerShellHandlers, createCrashMarker } = require('./shell-ipc.cjs');
const { registerPickFileHandler } = require('./file-ipc.cjs');
const { bindDemoProfile, assertDemoProfile } = require('./demo-profile.cjs');
const packageMetadata = require('../../package.json');
const demo = packageMetadata.chausarPreview === true || process.argv.includes('--demo');
const uiPreview = process.argv.includes('--ui-preview');
// The new UI is the default renderer. The legacy renderer is reachable only behind the explicit
// --legacy-renderer flag (it then opens first), or from the older --ui-preview opt-in, which keeps
// its return link.
const legacyRenderer = process.argv.includes('--legacy-renderer');
const legacyAvailable = legacyRenderer || uiPreview;
const firstRunPreview = process.argv.includes('--first-run-preview');
const firstRunPreviewRequested = process.argv.some(value => value === '--first-run-preview' || value.startsWith('--first-run-preview='));
let demoProfile; let previewLifecycle; let singleInstance = false; let startupStage = 'preview-mode';
function startupDiagnostic(error, stage) {
  // Log a bounded location and fixed code, never error text, full paths or env.
  const filesystemCodes = ['EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EEXIST', 'ENAMETOOLONG', 'EINVAL', 'ELOOP', 'ENOSPC', 'EROFS', 'EMFILE', 'ENFILE'];
  let errorCode; let message; let stack;
  try { errorCode = error?.code; message = error?.message; stack = error?.stack; } catch { /* Diagnostics must not obstruct shutdown. */ }
  const unavailablePaths = ["Failed to get 'appData' path", "Failed to get 'userData' path", "Failed to get 'sessionData' path"];
  const code = filesystemCodes.includes(errorCode) ? errorCode : unavailablePaths.includes(message) ? 'ELECTRON_PATH_UNAVAILABLE' : 'UNCLASSIFIED';
  const frames = [];
  if (typeof stack === 'string') {
    for (const match of stack.slice(0, 8192).matchAll(/^[ \t]+at [^\r\n]*[\\/](demo-profile\.cjs|main\.cjs|preview-lifecycle\.cjs):(\d{1,6}):(\d{1,6})(?!\d)/gm)) {
      frames.push(`${match[1]}:${match[2]}:${match[3]}`); if (frames.length === 3) break;
    }
  }
  return `Chausar startup failed: stage=${stage}; code=${code}; frames=${frames.join(',') || 'unavailable'}`;
}
try {
  if (packageMetadata.chausarPreview === true && process.argv.includes('--production')) throw new Error('This unsigned preview supports synthetic data only.');
  const firstRunArguments = process.argv.slice(1);
  if (firstRunPreviewRequested && (app.isPackaged !== true || packageMetadata.chausarPreview !== true
    || new Set(firstRunArguments).size !== firstRunArguments.length
    || firstRunArguments.some(value => !['--first-run-preview', '--demo', '--ui-preview', '--background'].includes(value))
    || ['--first-run-preview', '--demo', '--ui-preview'].some(flag => !firstRunArguments.includes(flag)))) {
    throw new Error('First-run preview requires a packaged unsigned preview with exactly --demo and --ui-preview.');
  }
  if (demo) { startupStage = 'profile-bind'; demoProfile = bindDemoProfile(app); }
  if (packageMetadata.chausarPreview === true && process.env.CHAUSAR_PREVIEW_OBSERVER_NONCE !== undefined) {
    startupStage = 'preview-observer';
    const { createPreviewLifecycle } = require('./preview-lifecycle.cjs');
    previewLifecycle = createPreviewLifecycle({ metadata: packageMetadata, profile: demoProfile, environment: process.env, pid: process.pid });
  }
  startupStage = 'instance-lock'; singleInstance = app.requestSingleInstanceLock();
} catch (error) { console.error(startupDiagnostic(error, startupStage)); dialog.showErrorBox('Chausar could not start', error.message); }

protocol.registerSchemesAsPrivileged([{ scheme: 'chausar', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!singleInstance) app.quit();
let window; let engine; let database; let tray; let demoMode = demo; let stopping = false; let startupComplete = false; let startupTask = Promise.resolve();
// --- driving lane: WK-14 strip, tray Stop and the driver switch (app/desktop/driving-main.cjs) ---
require('./driving-main.cjs').registerDriving({ getEngine: () => engine, demo });
// --- end driving lane ---
let previewStopResult; const previewStopErrors = [];
let hostAwake = false;
const backgroundRequested = process.argv.includes('--background');
// --- release lane: start at login and wake launches (SH-07) ---
// --start-at-login starts hidden in the tray: no window until the person opens one, and closing the window
// keeps the tray. It grants nothing else; jobs keep running with the window closed only with --background.
// A later launch by the wake timer (--background) or at sign-in never opens a window in the running instance.
const startAtLoginRequested = process.argv.includes('--start-at-login');
const trayRequested = backgroundRequested || startAtLoginRequested;
const quietLaunch = argv => Array.isArray(argv) && argv.some(value => value === '--background' || value === '--start-at-login');
// --- end release lane ---
let selectedDocument = legacyRenderer ? 'chausar://app/index.html' : 'chausar://app/ui/index.html';
// A switch to the legacy renderer is only pending until the frame commits it (did-navigate); a cancelled or failed
// navigation leaves the current document trusted, so the window never ends up refusing its own IPC.
let pendingDocument = null;
// SH-07 tray: jobs paused from the tray (until resumed or restart), and whether a workspace was open this run.
let trayJobsPaused = false; let workspaceSeenOpen = false;
// SH-11: the unclean-exit marker, beside the vaults folder; removed on a clean quit.
let crashMarker = null;
const root = resolve(__dirname, '../..');
const renderer = join(root, 'app/renderer');
const engineRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : root;
function reportJobLifecycle() {
  if (engine?.state !== 'ready') return Promise.resolve();
  return engine.updateJobLifecycle({ awake: !stopping && hostAwake && !trayJobsPaused, windowOpen: !stopping && !!window && !window.isDestroyed(), backgroundEnabled: !stopping && backgroundRequested });
}
function lifecycleChanged() {
  void reportJobLifecycle().catch(error => {
    console.error(publicError(error).message);
    if (!stopping) { dialog.showErrorBox('Chausar jobs stopped', 'The engine could not confirm the desktop state. Restart Chausar before running jobs.'); app.quit(); }
  });
}
async function bootstrapPreviewWorkspace() {
  // The default unsigned preview owns automatic sample creation in its fresh profile.
  // Explicit first-run preview leaves creation and recovery acknowledgement to the UI.
  if (app.isPackaged !== true || packageMetadata.chausarPreview !== true || !demo || !uiPreview || stopping) return;
  assertDemoProfile(app, demoProfile);
  let method = 'workspace.status';
  try {
    const status = await engine.request(method, {});
    if (status?.open !== false || status.experimental !== true || status.storage !== 'experimental-file') {
      throw Object.assign(new Error('The synthetic preview workspace state is unexpected.'), { code: 'PREVIEW_WORKSPACE_STATE' });
    }
    if (stopping) return;
    if (firstRunPreview) return;
    method = 'workspace.create';
    await engine.request(method, { name: 'Chausar Preview (synthetic business)', folder: 'main', pack: 'ecommerce',
      demo: true, demoFixtureMonth: new Date().toISOString().slice(0, 7), passphrase: randomBytes(32).toString('base64url') });
    if (stopping) return;
    assertDemoProfile(app, demoProfile);
    method = 'ui.context';
    const context = await engine.request(method, {});
    if (context?.workspace?.demo !== true || context.member?.role !== 'owner') {
      throw Object.assign(new Error('The synthetic preview workspace did not authorize its owner.'), { code: 'PREVIEW_WORKSPACE_STATE' });
    }
  } catch (error) {
    // Fixed method and known code only: no arguments, messages, paths or keys.
    const knownCodes = ['PREVIEW_WORKSPACE_STATE', 'VAULT_LOCKED', 'VAULT_OPEN', 'VAULT_BUSY', 'DEMO_ONLY',
      'DATABASE_REQUIRED', 'REQUEST_FAILED', 'REQUEST_TIMEOUT', 'ENGINE_UNAVAILABLE', 'ENGINE_EXITED',
      'EACCES', 'EPERM', 'ENOENT', 'ENOTDIR', 'EEXIST', 'ENAMETOOLONG', 'EINVAL', 'ELOOP', 'ENOSPC', 'EROFS', 'EMFILE', 'ENFILE'];
    let value; try { value = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch {}
    const code = knownCodes.includes(value) ? value : 'UNCLASSIFIED';
    console.error(`Chausar preview workspace bootstrap failed: method=${method}; code=${code}`);
    // The shared startup/shutdown handlers may log this message. Keep that
    // propagation bounded too, without retaining the original error or cause.
    throw Object.assign(new Error('The synthetic preview workspace could not start.'), { code });
  }
}
async function startEngine() {
  const metadata = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (stopping) return;
  if (demo) assertDemoProfile(app, demoProfile);
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: demo ? demoProfile.vaults : join(app.getPath('userData'), 'vaults'), CHAUSAR_DEMO: demo ? '1' : '0' };
  const binaries = app.isPackaged ? join(process.resourcesPath, 'runtime-binaries') : join(root, 'runtime-binaries');
  if (demo) delete environment.CHAUSAR_KEYCHAIN_MANIFEST;
  else environment.CHAUSAR_KEYCHAIN_MANIFEST = join(binaries, 'keychain', 'manifest.json');
  if (!demo && !environment.CHAUSAR_POSTGRES_URL) {
    // --- release lane: bundled PostgreSQL (platform/runtime/native/desktop-database.ts) ---
    // Checks runtime-binaries against its manifest, then BundledPostgres starts the userData/database
    // cluster (stale-lock recovery). An older cluster is never upgraded here; a newer one refuses.
    const { startDesktopDatabase } = await import(pathToFileURL(join(engineRoot, 'platform/runtime/native/desktop-database.ts')).href);
    database = await startDesktopDatabase({ runtimeRoot: binaries, dataRoot: join(app.getPath('userData'), 'database'), receiptDirectory: join(app.getPath('userData'), 'release'), appVersion: metadata.version });
    if (database.state === 'needs-upgrade') { environment.CHAUSAR_DATABASE_STATE = 'needs-upgrade'; console.error(`Chausar database: code=${database.code}`); dialog.showErrorBox('Chausar database needs an upgrade', database.message); }
    else environment.CHAUSAR_POSTGRES_URL = database.url;
    // --- end release lane ---
  }
  if (!demo && !environment.CHAUSAR_PYTHON) environment.CHAUSAR_PYTHON = process.platform === 'win32' ? join(binaries, 'python/python.exe') : join(binaries, 'python/bin/python3');
  if (stopping) return;
  crashMarker = createCrashMarker({ path: join(dirname(environment.CHAUSAR_VAULT_DIRECTORY), 'chausar-running.marker'), readFile, writeFile, unlink });
  await crashMarker.start();
  engine = new EngineHarness({ workerPath: join(engineRoot, 'platform/runtime/worker.ts'), environment });
  engine.on('status', status => { if (window && !window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, status); refreshTray(); });
  engine.on('engine-event', event => { if (window && !window.isDestroyed()) window.webContents.send(EVENT_CHANNEL, { seq: event.seq }); }); // core-sync-jobs (round 4)
  await engine.start();
  await reportJobLifecycle();
}
// --- release lane: a version on trial (started by the launcher) is committed once a workspace has opened ---
function confirmUpdateTrial() { if (process.env.CHAUSAR_INSTALL_ROOT && engine?.state === 'ready') void engine.request('release.status', {}).catch(() => {}); }
// --- end release lane ---
// --- frame-today: the tray (SH-07). Facts are read from the engine as the desktop owner; a fact it cannot read is left out. ---
const DRIVING_STATES = ['driving', 'sign-in', 'paused-by-you', 'step-failed'];
async function trayFacts() {
  const facts = { count: null, locked: false, driving: false };
  if (stopping || engine?.state !== 'ready') return facts;
  try { const status = await engine.request('workspace.status', {}); if (status?.open === true) workspaceSeenOpen = true; else facts.locked = workspaceSeenOpen; } catch {}
  if (facts.locked || !workspaceSeenOpen) return facts;
  // Today's review count is a number only when every producer answered; otherwise no count is shown.
  try { const review = await engine.request('today.review', { limit: 1 }); if (Number.isSafeInteger(review?.count) && review.count >= 0) facts.count = review.count; } catch {}
  // Stop is offered only while the driving lane reports a session holding a window.
  try { const session = await engine.request('session.status', {}); facts.driving = DRIVING_STATES.includes(session?.state); } catch {}
  return facts;
}
function openWindow() { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else createWindow(); }
function trayMenu(facts) {
  return [
    { label: 'Open Chausar', click: openWindow },
    ...(facts.count === null ? [] : [{ label: facts.count === 1 ? '1 thing awaits your review' : `${facts.count} things await your review`, enabled: false }]),
    // Locked: jobs that need a key or a model wait; the engine runs nothing that needs the vault.
    facts.locked ? { label: 'Paused while locked', enabled: false }
      : { label: trayJobsPaused ? 'Resume jobs' : 'Pause jobs', click: () => { trayJobsPaused = !trayJobsPaused; lifecycleChanged(); refreshTray(); } },
    ...(facts.driving ? [{ label: 'Stop', click: () => { void engine?.request('session.stop', {}).catch(() => {}).finally(() => refreshTray()); } }] : []),
    { type: 'separator' },
    { label: 'Quit Chausar and stop jobs', click: () => app.quit() },
  ];
}
let trayRead = 0;
function refreshTray() {
  if (!tray) return;
  const mine = ++trayRead;
  void trayFacts().then(facts => { if (tray && mine === trayRead && !stopping) tray.setContextMenu(Menu.buildFromTemplate(trayMenu(facts))); }, () => {});
}
function createBackgroundTray() {
  if (!trayRequested) return; // release lane: start at login also uses the tray
  const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));
  if (icon.isEmpty()) throw new Error('The background-mode tray icon is missing.');
  tray = new Tray(icon);
  tray.setToolTip(demoMode ? 'Chausar Preview — synthetic data' : 'Chausar');
  tray.setContextMenu(Menu.buildFromTemplate(trayMenu({ count: null, locked: false, driving: false })));
  tray.on('double-click', openWindow);
  refreshTray();
  // Read again once a minute while running; the timer never keeps the app alive.
  if (typeof setInterval === 'function') setInterval(refreshTray, 60_000).unref?.();
}
// --- end frame-today tray ---
function createWindow() {
  // Worker readiness precedes workspace bootstrap. Every opening path waits
  // for the full startup task, including activate and second-instance events.
  if (stopping || !startupComplete || engine?.state !== 'ready') return;
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: '#f7f5ee', title: demoMode ? 'Chausar Preview — synthetic data' : 'Chausar', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (legacyAvailable && selectedDocument === 'chausar://app/ui/index.html' && url === 'chausar://app/index.html') pendingDocument = url;
    else event.preventDefault();
  });
  // The trusted document changes only when the main frame commits the allowed navigation; a cancelled or failed one keeps the current one.
  window.webContents.on('did-navigate', (_event, url) => { if (pendingDocument !== null && url === pendingDocument) selectedDocument = url; pendingDocument = null; });
  window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => { if (isMainFrame !== false) pendingDocument = null; });
  window.once('ready-to-show', () => {
    window.show();
    if (previewLifecycle) {
      try { assertDemoProfile(app, demoProfile); previewLifecycle.ready({ engineState: engine?.state, windowVisible: window.isVisible() }); }
      catch (error) { dialog.showErrorBox('Chausar preview could not confirm readiness', error.message); app.quit(); }
    }
  });
  window.loadURL(selectedDocument);
  window.on('closed', () => { window = null; lifecycleChanged(); });
  lifecycleChanged();
}
if (singleInstance) app.whenReady().then(async () => {
  if (stopping) return;
  hostAwake = true;
  powerMonitor.on('suspend', () => { hostAwake = false; lifecycleChanged(); });
  powerMonitor.on('resume', () => { hostAwake = true; lifecycleChanged(); });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('chausar://app/') }));
  protocol.handle('chausar', async request => {
    const url = new URL(request.url); const files = new Map([['/index.html', 'index.html'], ['/', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/assets/icon.svg', 'assets/icon.svg']]);
    if (url.hostname !== 'app' || url.username || url.password || url.port) return new Response('Not found', { status: 404 });
    const preview = await readUiAsset(root, url.pathname, true, legacyAvailable);
    if (preview) return new Response(preview.body, { headers: { 'Content-Type': preview.mime, 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' } });
    const file = legacyAvailable ? files.get(url.pathname) : undefined; if (url.hostname !== 'app' || !file) return new Response('Not found', { status: 404 });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
    const ext = file.slice(file.lastIndexOf('.')); const data = await readFile(join(renderer, file));
    return new Response(data, { headers: { 'Content-Type': types[ext], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' } });
  });
  ipcMain.handle(REQUEST_CHANNEL, async (event, input) => {
    try {
      assertTrustedSender(event, window?.webContents, selectedDocument);
      const request = validateRequest(input);
      const result = await engine.request(request.method, request.payload);
      if (/^workspace\.(open|create|recover|restore)$/.test(request.method)) confirmUpdateTrial(); // release lane
      if (/^(workspace\.|approvals\.|today\.resolve|jobs)/.test(request.method)) refreshTray(); // frame-today tray
      return { ok: true, result };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
  // SH-10, FR-04 and SH-11: shell.openExternal, shell.print, shell.saveText and the crash question on their own channels, trusted frame only.
  registerShellHandlers({ ipcMain, shell: require('electron').shell, contents: () => window?.webContents, document: () => selectedDocument,
    workspaceOpen: async () => engine?.state === 'ready' && (await engine.request('workspace.status', {}))?.open === true,
    // First run: no workspace folder exists yet (the trusted desktop's own pre-vault list).
    noVaultYet: async () => engine?.state === 'ready' && (await engine.request('todayx.workspaces', {}))?.folders?.length === 0,
    dialog: { showSaveDialog: options => (window && !window.isDestroyed() ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)) },
    writeFile, crash: { crashed: () => crashMarker?.crashed() === true, answered: () => crashMarker?.answered() } });
  // FR-07, BK-04 and FR-13 (frame-today): imports.pickFile, the system open dialog on its own channel, trusted frame only.
  registerPickFileHandler({ ipcMain, dialog, contents: () => window?.webContents, document: () => selectedDocument, owner: () => (window && !window.isDestroyed() ? window : null),
    backupsDirectory: () => join(demo ? demoProfile.vaults : join(app.getPath('userData'), 'vaults'), 'backups') });
  try { startupTask = startEngine().then(() => bootstrapPreviewWorkspace()); await startupTask; if (stopping) return; startupComplete = true; confirmUpdateTrial(); createBackgroundTray(); if (!startAtLoginRequested) createWindow(); }
  catch (error) { if (!stopping) { console.error(startupDiagnostic(error, 'ready-startup')); dialog.showErrorBox('Chausar could not start', error.message); app.quit(); } }
});
app.on('second-instance', (_event, argv) => { if (quietLaunch(argv)) return; /* release lane */ if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (engine?.state === 'ready') createWindow(); });
app.on('activate', () => { if (!window && engine?.state === 'ready') createWindow(); });
app.on('window-all-closed', () => { if (!trayRequested) app.quit(); }); // release lane: the start-at-login tray stays
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  startupTask.catch(error => { if (previewLifecycle) previewStopErrors.push('PREVIEW_STARTUP_FAILED'); console.error(publicError(error).message); }).then(() => reportJobLifecycle()).catch(error => { if (previewLifecycle) previewStopErrors.push('LIFECYCLE_STOP_FAILED'); console.error(publicError(error).message); }).then(() => engine?.stop()).then(result => {
    previewStopResult = result;
    if (result && !result.graceful) console.error('The engine required termination; unfinished actions need reconciliation.');
  }).catch(error => { if (previewLifecycle) previewStopErrors.push('ENGINE_STOP_FAILED'); console.error(publicError(error).message); }).then(() => database?.close()).catch(error => { if (previewLifecycle) previewStopErrors.push('DATABASE_CLOSE_FAILED'); console.error(publicError(error).message); }).then(() => crashMarker?.clean()).finally(() => {
    if (!previewLifecycle) { tray?.destroy(); app.quit(); return; }
    try { tray?.destroy(); } catch (error) { previewStopErrors.push('TRAY_CLOSE_FAILED'); console.error(publicError(error).message); }
    try { previewLifecycle.stopped({ engineResult: previewStopResult, errors: previewStopErrors }); } catch (error) { console.error(publicError(error).message); }
    app.quit();
  });
});
