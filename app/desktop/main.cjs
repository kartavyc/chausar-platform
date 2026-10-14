const { app, BrowserWindow, ipcMain, protocol, session, dialog, Tray, Menu, nativeImage, powerMonitor } = require('electron');
const { readFile, writeFile, mkdir, lstat } = require('node:fs/promises');
const { EngineHarness } = require('./engine-harness.cjs');
const { REQUEST_CHANNEL, STATUS_CHANNEL, validateRequest, assertTrustedSender, publicError } = require('./ipc-contract.cjs');
const { join, resolve } = require('node:path');
const { randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:net');
const { readUiAsset } = require('./ui-assets.cjs');
const { registerShellHandlers } = require('./shell-ipc.cjs');
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
let previewStopResult; const previewStopErrors = [];
let hostAwake = false;
const backgroundRequested = process.argv.includes('--background');
let selectedDocument = legacyRenderer ? 'chausar://app/index.html' : 'chausar://app/ui/index.html';
const root = resolve(__dirname, '../..');
const renderer = join(root, 'app/renderer');
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
  engine = new EngineHarness({ workerPath: join(engineRoot, 'platform/runtime/worker.ts'), environment });
  engine.on('status', status => { if (window && !window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, status); });
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
  // Worker readiness precedes workspace bootstrap. Every opening path waits
  // for the full startup task, including activate and second-instance events.
  if (stopping || !startupComplete || engine?.state !== 'ready') return;
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: '#f7f5ee', title: demoMode ? 'Chausar Preview — synthetic data' : 'Chausar', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (legacyAvailable && selectedDocument === 'chausar://app/ui/index.html' && url === 'chausar://app/index.html') selectedDocument = url;
    else event.preventDefault();
  });
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
      return { ok: true, result: await engine.request(request.method, request.payload) };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
  // SH-10 and FR-04: shell.openExternal and shell.print on their own channels, trusted frame only.
  registerShellHandlers({ ipcMain, shell: require('electron').shell, contents: () => window?.webContents, document: () => selectedDocument,
    workspaceOpen: async () => engine?.state === 'ready' && (await engine.request('workspace.status', {}))?.open === true });
  try { startupTask = startEngine().then(() => bootstrapPreviewWorkspace()); await startupTask; if (stopping) return; startupComplete = true; createBackgroundTray(); createWindow(); }
  catch (error) { if (!stopping) { console.error(startupDiagnostic(error, 'ready-startup')); dialog.showErrorBox('Chausar could not start', error.message); app.quit(); } }
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (engine?.state === 'ready') createWindow(); });
app.on('activate', () => { if (!window && engine?.state === 'ready') createWindow(); });
app.on('window-all-closed', () => { if (!backgroundRequested) app.quit(); });
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  startupTask.catch(error => { if (previewLifecycle) previewStopErrors.push('PREVIEW_STARTUP_FAILED'); console.error(publicError(error).message); }).then(() => reportJobLifecycle()).catch(error => { if (previewLifecycle) previewStopErrors.push('LIFECYCLE_STOP_FAILED'); console.error(publicError(error).message); }).then(() => engine?.stop()).then(result => {
    previewStopResult = result;
    if (result && !result.graceful) console.error('The engine required termination; unfinished actions need reconciliation.');
  }).catch(error => { if (previewLifecycle) previewStopErrors.push('ENGINE_STOP_FAILED'); console.error(publicError(error).message); }).then(() => database?.close()).catch(error => { if (previewLifecycle) previewStopErrors.push('DATABASE_CLOSE_FAILED'); console.error(publicError(error).message); }).finally(() => {
    if (!previewLifecycle) { tray?.destroy(); app.quit(); return; }
    try { tray?.destroy(); } catch (error) { previewStopErrors.push('TRAY_CLOSE_FAILED'); console.error(publicError(error).message); }
    try { previewLifecycle.stopped({ engineResult: previewStopResult, errors: previewStopErrors }); } catch (error) { console.error(publicError(error).message); }
    app.quit();
  });
});
