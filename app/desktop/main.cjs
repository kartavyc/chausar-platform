const { app, BrowserWindow, WebContentsView, ipcMain, protocol, session, shell, dialog, Tray, Menu, nativeImage, powerMonitor, Notification, safeStorage } = require('electron');
const { readFile, writeFile } = require('node:fs/promises');
const { EngineHarness } = require('./engine-harness.cjs');
const { REQUEST_CHANNEL, STATUS_CHANNEL, VENTURE_EVENT_CHANNEL, OPEN_EXTERNAL_CHANNEL, TRUSTED_DOCUMENT, validateRequest, validateExternalUrl, assertTrustedSender, isTrustedDocument, publicError } = require('./ipc-contract.cjs');
const { join, resolve } = require('node:path');

protocol.registerSchemesAsPrivileged([{ scheme: 'chausar', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let window; let engine; let tray; let demoMode = false; let stopping = false; let startupTask = Promise.resolve();
let hostAwake = false;
const captionMicrophone = require('./caption-permission.cjs').captionPermission({window:()=>window,isTrustedDocument,verify:async(orderId,sessionId)=>{const reply=await engine.request('venture.desk.act',{playbook:'translation-studio',kind:'caption',id:orderId,action:'status',payload:{sessionId}});return reply?.result?.active===true&&reply.result.sessionId===sessionId;},verifyTalk:async sessionId=>{const view=await engine.request('venture.talk.get',{});return view?.desktop===true&&view.consent?.given===true&&view.session?.id===sessionId;}});
const formsBrowser = require('./owner-browser-host.cjs').createFormsHost({BrowserWindow,WebContentsView,session,window:()=>window,onClosed:()=>stopFormsBrowser()});
function stopFormsBrowser() { void formsBrowser.close(); engine?.closeForms?.(); }
// Wave 6 (6H2, D41): the window for recorded flows, page JavaScript allowed; nothing that may send leaves before the approved press.
const flowBrowser = require('./flow-browser.cjs').createFlowBrowser({ BrowserWindow, session });
// Wave 6 (6H1, D39): the mini app sandbox proxy's own policy, and where frames inside the window may go.
const { policyFor, subframeAllowed } = require('./mini-frame.cjs');
let backgroundRequested = process.argv.includes('--background');
// Wave 6 (6J1, D3, D36): the installed beta (release channel "beta") starts at login hidden in the tray (--hidden) and
// keeps running in the tray when the window closes; both are owner settings in the tray menu (background.cjs). The
// bundled Codex goes last on the engine's PATH. Previews and development runs keep the behaviour they had.
// One-shot A5: start at login is the owner's answer in onboarding, changeable in Settings and the tray; backgroundValue
// is background.cjs's state, with the computer's own login item read back, so the tray tick is never a guess.
let releaseBeta = false; let ownerKeepsRunning = false; let background = null; let backgroundValue = { supported: false, asked: false, startAtLogin: false, keepRunning: false, registered: false, systemOff: false };
let hiddenStart = process.argv.includes('--hidden');
const runsInBackground = () => backgroundRequested || ownerKeepsRunning;
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
  return engine.updateJobLifecycle({ awake: !stopping && hostAwake, windowOpen: !stopping && !!window && !window.isDestroyed(), backgroundEnabled: !stopping && runsInBackground() });
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
  releaseBeta = app.isPackaged && metadata.chausarReleaseChannel === 'beta' && metadata.chausarPreview !== true;
  if (releaseBeta) await startBackground();
  if (stopping) return;
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHAUSAR_ENGINE_VERSION: metadata.version, CHAUSAR_VAULT_DIRECTORY: join(app.getPath('userData'), 'vaults'), CHAUSAR_DEMO: demo ? '1' : '0',
    // A2: where the owner's choice of their own Codex is kept (platform/runtime/codex-trust.ts).
    CHAUSAR_CODEX_TRUST_DIR: join(app.getPath('userData'), 'codex-trust'),
    // One-shot A4 (row 107): the worker runs from app.asar.unpacked; the Ink build its phone server serves stays here.
    CHAUSAR_INK_ROOT: inkRoot };
  // Wave 6 (6J2): the opt-in report keys, from this shell's environment or the build's feedback.json; never hard-coded.
  Object.assign(environment, require('./feedback-keys.cjs').feedbackKeys({ env: process.env, packaged: app.isPackaged, resources: process.resourcesPath, read: path => require('node:fs').readFileSync(path, 'utf8') }));
  if (releaseBeta) {
    const program = join(process.resourcesPath, 'codex', 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
    const there = await require('node:fs/promises').lstat(program).then(info => info.isFile() && !info.isSymbolicLink(), () => false);
    Object.assign(environment, require('./background.cjs').bundledCodexEnvironment(environment, { resourcesPath: process.resourcesPath, platform: process.platform, exists: () => there }));
  }
  const binaries = app.isPackaged ? join(process.resourcesPath, 'runtime-binaries') : join(root, 'runtime-binaries');
  if (!demo && !environment.CHAUSAR_PYTHON) environment.CHAUSAR_PYTHON = process.platform === 'win32' ? join(binaries, 'python/python.exe') : join(binaries, 'python/bin/python3');
  if (stopping) return;
  engine = new EngineHarness({ workerPath: join(engineRoot, 'platform/runtime/worker.ts'), environment, requestTimeoutMs: 900_000 });
  engine.on('status', status => { if(status?.state!=='ready'){captionMicrophone.clear();stopFormsBrowser();} if (window && !window.isDestroyed()) window.webContents.send(STATUS_CHANNEL, status); if (status?.state !== 'ready') noteEngineDown(); });
  // Run events, already checked by the harness: the window reads the queue or the run again when one arrives.
  engine.on('venture-event', event => { if(event?.type==='privacy.forgotten'){captionMicrophone.clear();stopFormsBrowser();} if (window && !window.isDestroyed()) window.webContents.send(VENTURE_EVENT_CHANNEL, event); noteTrayEvent(event); });
  // A client report's PDF (5A5): the engine's print port; a hidden window that runs no script prints the report's HTML.
  engine.on('print', (request, answer) => { require('./report-print.cjs').printReport(request, { BrowserWindow, session }).then(answer, () => answer(null)); });
  // Wave 6 (6F3): a page that needs JavaScript, read in a hidden window after the engine's own checks (web-render.cjs).
  engine.on('render', (request, answer) => { require('./web-render.cjs').renderPage(request, { BrowserWindow, session }).then(answer, () => answer(null)); });
  // Wave 6 (6H2): one step of a recorded flow in its window (flow-browser.cjs); the window closes when the engine stops.
  engine.on('flows', (request, answer) => flowBrowser.handle(request, answer));
  engine.on('status', status => { if (status?.state !== 'ready') void flowBrowser.close(); });
  const credentials = require('./credential-store.cjs').createCredentialStore({ directory: join(app.getPath('userData'), 'credentials'), safeStorage });
  engine.on('credential', (request, answer) => {
    credentials[request.op](request.workspaceId, request.name, request.value)
      .then(value => answer({ ok: true, value: value ?? null }), error => answer({ ok: false, code: error?.code }));
  });
  engine.on('forms', (request, answer, verify) => formsBrowser.handle(request, answer, verify));
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
/** A4 review (L7): the keys a hidden menu keeps on Windows and Linux. */
const HIDDEN_MENU = [
  { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'zoomIn' }, { role: 'zoomIn', accelerator: 'CommandOrControl+=', visible: false }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
];
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
    { label: 'Open Chausar', click: () => openWindow() }, { type: 'separator' },
    ...(background ? [...background.menuItems(backgroundValue, changeBackground), { type: 'separator' }] : []),
    { label: 'Quit Chausar and stop jobs', click: () => app.quit() },
  ]);
}
/**
 * 6J1, A5: the beta's owner settings. Unasked, nothing is registered (onboarding asks); a saved answer is brought in
 * line at each start. A failure never stops the start.
 */
async function startBackground() {
  background = require('./background.cjs').createBackground({ app, fs: require('node:fs/promises'), platform: process.platform, directory: app.getPath('userData'), home: app.getPath('home'), env: process.env, execPath: process.execPath, beta: true });
  // A5: on macOS a login start comes from Electron's own login item, which passes no arguments.
  if (process.platform === 'darwin' && app.getLoginItemSettings?.()?.wasOpenedAtLogin === true) { backgroundRequested = true; hiddenStart = true; }
  ownerKeepsRunning = (await background.settings()).keepRunning;
  try { await background.apply(); backgroundValue = await background.state(); }
  catch (error) { console.error(publicError(error).message); backgroundValue = { ...backgroundValue, supported: true, keepRunning: ownerKeepsRunning }; }
}
/** A5: one change from the tray or the window; the tray and the engine follow, and the new state is the answer. */
async function setBackground(update) {
  if (!background) throw Object.assign(new Error('Start at login is only in the installed Chausar app.'), { code: 'BACKGROUND_UNAVAILABLE' });
  const value = await background.change(update);
  backgroundValue = value; ownerKeepsRunning = value.keepRunning;
  tray?.setContextMenu(trayMenu()); lifecycleChanged();
  return value;
}
function changeBackground(update) { void setBackground(update).catch(error => console.error(publicError(error).message)); }
/**
 * A5 fix round 1: read start at login from the computer again (its own startup settings may have changed it) and
 * rebuild the tray menu when the tick moved. Called as the pointer reaches the tray icon, before its menu opens, and
 * when the window comes to the front.
 */
function refreshBackground() {
  if (!background) return;
  void background.state().then(value => {
    const moved = value.registered !== backgroundValue.registered || value.systemOff !== backgroundValue.systemOff || value.keepRunning !== backgroundValue.keepRunning;
    backgroundValue = value;
    if (moved) tray?.setContextMenu(trayMenu());
  }, error => console.error(publicError(error).message));
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
  if (!runsInBackground() || stopping || stillRunningAsked || process.platform !== 'win32' || !tray || typeof tray.displayBalloon !== 'function') return;
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
  tray.on('mouse-enter', refreshBackground);
}
// One-shot A7: the window shows the founder's logo on Windows (the ico, every size) and Linux (a tar.gz has no desktop
// entry to take it from); macOS takes the bundle's icns. Chausar.exe carries the logo too (scripts/desktop-after-pack.cjs).
const WINDOW_ICON = { win32: 'icons/icon.ico', linux: 'icons/png/256x256.png' }[process.platform];
function createWindow(hash = '') {
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: require('electron').nativeTheme?.shouldUseDarkColors ? '#111214' : '#fbfbfa', title: appName(), show: false,
    ...(WINDOW_ICON ? { icon: join(__dirname, WINDOW_ICON) } : {}),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  // A4 review (L7): the hidden menu's keys work; its bar never shows, not even with Alt.
  if (process.platform !== 'darwin') window.setMenuBarVisibility?.(false);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  // Wave 6 (6J2): a window that stopped is noted for the next report, only while the owner has crash reports on.
  window.webContents.on('render-process-gone', (_event, details) => { if (details?.reason !== 'clean-exit' && engine?.state === 'ready') void engine.request('venture.feedback.crash', { source: 'desktop', name: 'WindowGone', message: `The window stopped: ${String(details?.reason ?? 'unknown').replace(/[^a-z-]/g, '')}` }).catch(() => {}); });
  // W6 6H1: a frame (a mini app's, the website preview's) stays on the sandbox proxy or the app's own blob previews.
  window.webContents.on('will-frame-navigate', event => { if (!event.isMainFrame && !subframeAllowed(event.url)) event.preventDefault(); });
  window.once('ready-to-show', () => window.show());
  window.loadURL(TRUSTED_DOCUMENT + hash);
  window.on('closed', () => { captionMicrophone.clear(); stopFormsBrowser(); window = null; lifecycleChanged(); noteStillRunning(); });
  // Notifications (Ink v2 wave 4, 4G1): the owner is watching only while this window is shown, not minimised and
  // focused; alerts outside the app wait while they are. Told to the engine on each change.
  // The tray's count was news since the owner last looked (4G3): looking clears it.
  const tellWatching = () => {
    const watching = !!window && !window.isDestroyed() && window.isVisible() && !window.isMinimized() && window.isFocused();
    engine?.reportWatching?.(watching);
    if (watching) { setTrayCount(0); clearCountNotice(); }
  };
  for (const change of ['focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'closed']) window.on(change, tellWatching);
  window.on('focus', refreshBackground);
  lifecycleChanged();
}
if (singleInstance) app.whenReady().then(async () => {
  if (stopping) return;
  // One-shot A4 (hands-on S10, review L7): no File, Edit, View, Window bar on Windows and Linux, but a hidden menu keeps
  // the keys owners use: zoom (Ctrl+=, Ctrl+-, Ctrl+0) and editing. Its bar is never shown (each window hides it). A
  // Mac keeps its own menu, where copy and paste live.
  if (process.platform !== 'darwin') Menu.setApplicationMenu?.(Menu.buildFromTemplate(HIDDEN_MENU));
  // Listed before the engine starts, so an unbuilt Ink app stops the start with its own plain reason.
  try { inkFiles = await listInkFiles(); }
  catch (error) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); return; }
  hostAwake = true;
  powerMonitor.on('suspend', () => { stopFormsBrowser(); hostAwake = false; lifecycleChanged(); });
  powerMonitor.on('resume', () => { hostAwake = true; lifecycleChanged(); });
  // Clipboard stays unchanged. Microphone capture needs a fresh owner-started native caption session; camera stays refused.
  // The page may carry an Ink '#/' route; the rule is the IPC sender check's own, so the two never drift apart.
  const clipboardWrite = (contents, permission) => permission === 'clipboard-sanitized-write' && Boolean(window) && contents === window.webContents && isTrustedDocument(contents.mainFrame?.url);
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {if(clipboardWrite(contents,permission))callback(true);else void captionMicrophone.request(contents,permission,details).then(callback,()=>callback(false));});
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => clipboardWrite(contents, permission)||captionMicrophone.check(contents,permission,origin,details));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('chausar://app/') }));
  protocol.handle('chausar', async request => {
    const url = new URL(request.url); const file = inkFiles.get(url.pathname); if (url.hostname !== 'app' || !file) return new Response('Not found', { status: 404 });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
    const ext = file.slice(file.lastIndexOf('.')); const data = await readFile(join(inkRoot, file));
    return new Response(data, { headers: { 'Content-Type': types[ext], 'Content-Security-Policy': policyFor(url.pathname, "default-src 'self'; script-src 'self'; style-src 'self' data:; img-src 'self' data:; media-src 'self' data:; connect-src 'none'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'"), 'X-Content-Type-Options': 'nosniff' } });
  });
  // A2 second review: the owner's choice of Codex is asked in main's own dialog, never forwarded from the window.
  const codexChoice = require('./codex-choice.cjs').createCodexChoice({ engine, dialog, window: () => window });
  ipcMain.handle(REQUEST_CHANNEL, async (event, input) => {
    try {
      assertTrustedSender(event, window?.webContents);
      const request = validateRequest(input);
      if (request.method === 'venture.ai.setup.trust') return { ok: true, result: await codexChoice(request.payload) };
      if(['workspace.lock','workspace.open','workspace.create'].includes(request.method))stopFormsBrowser();
      if(request.method==='venture.desk.act'&&request.payload?.kind==='caption'&&request.payload?.action==='stop')captionMicrophone.clear();if(request.method==='venture.talk.hear')captionMicrophone.clear();
      const result=await engine.request(request.method, request.payload);captionMicrophone.observe(request,result);
      return { ok: true, result };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
  // One-shot A6 (answer 7): a wa.me handoff opens the WhatsApp desktop app first when this computer has one for
  // whatsapp:// links, else the web page; the app link is built from the checked wa.me link (invoice-share.cjs).
  const invoiceShare = require('./invoice-share.cjs');
  const whatsappApp = () => { try { return typeof app.getApplicationNameForProtocol === 'function' && app.getApplicationNameForProtocol('whatsapp://') !== ''; } catch { return false; } };
  ipcMain.handle(OPEN_EXTERNAL_CHANNEL, async (event, input) => {
    try {
      assertTrustedSender(event, window?.webContents);
      const href = validateExternalUrl(input);
      const appLink = href.startsWith('https://wa.me/') && whatsappApp() ? invoiceShare.whatsappAppUrl(href) : null;
      if (appLink) { try { await shell.openExternal(appLink); return { ok: true }; } catch { /* the app did not open; the web page instead */ } }
      await shell.openExternal(href); return { ok: true };
    }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
  // A6 (answer 6, and the file for answer 7): Email it and Share on WhatsApp on an invoice. Main makes the file and keeps
  // it in Chausar's own share folder, beside the vaults, never in them; the window names only the invoice and how.
  const shareDeps = () => ({ window, shell, assertTrustedSender, publicError, engine, folder: join(app.getPath('userData'), 'share'), whatsappApp, emlApp: () => invoiceShare.emlHandler() });
  ipcMain.handle('chausar:invoice:share', (event, input) => invoiceShare.shareInvoice(event, input, shareDeps()));
  ipcMain.handle('chausar:share:show', (event, input) => invoiceShare.showShared(event, input, shareDeps()));
  // The network import (4D1): the owner picks one of their own files; a worker process reads it and only what Chausar keeps comes back.
  ipcMain.handle(require('./ipc-contract.cjs').PICK_FILE_CHANNEL, (event, input) => require('./network-files.cjs').pickNetworkFile(event, input, { dialog, window, assertTrustedSender, publicError, workerPath: join(engineRoot, 'platform/runtime/venture/network/extract-worker.ts') }));
  // Export for your CA (4J4): the engine makes the month's CSV, the owner picks where it goes, and it is saved atomically.
  ipcMain.handle(require('./ipc-contract.cjs').MONEY_EXPORT_CHANNEL, (event, input) => require('./money-export.cjs').saveMoneyExport(event, input, { dialog, window, assertTrustedSender, publicError, engine, documents: app.getPath('documents') }));
  // A client report (5A5): the engine makes the files, the owner picks a folder, and they are saved atomically in a new folder.
  ipcMain.handle(require('./ipc-contract.cjs').REPORT_SAVE_CHANNEL, (event, input) => require('./report-save.cjs').saveReport(event, input, { dialog, window, assertTrustedSender, publicError, engine, documents: app.getPath('documents') }));
  const youtubeProjects = require('./youtube-project.cjs').createYoutubeProject();
  const youtubeProjectDeps = () => ({ dialog, window, shell, assertTrustedSender, publicError, engine, documents: app.getPath('documents') });
  ipcMain.handle('chausar:youtube:saveProject', (event, input) => youtubeProjects.save(event, input, youtubeProjectDeps()));
  ipcMain.handle('chausar:youtube:openProject', (event, input) => youtubeProjects.open(event, input, youtubeProjectDeps()));
  ipcMain.handle('chausar:apptest:pickApk', (event, input) => require('./app-test-apk.cjs').pickClientApk(event, input, youtubeProjectDeps()));
  const socialProjects = require('./social-project.cjs').createSocialProject();
  ipcMain.handle('chausar:social:saveProject', (event, input) => socialProjects.save(event, input, youtubeProjectDeps()));
  ipcMain.handle('chausar:social:openProject', (event, input) => socialProjects.open(event, input, youtubeProjectDeps()));
  // After Delete (review of A1, row 1): a kept export, shown in the file manager; only a file of the engine's exports folder.
  ipcMain.handle('chausar:exports:show', (event, input) => require('./export-folder.cjs').showExport(event, input, { window, shell, assertTrustedSender, publicError, exportsFolder: join(app.getPath('userData'), 'vaults', 'exports') }));
  // One-shot A5: start at login and keep running, asked in onboarding and changed in Settings. Previews and development
  // runs answer that they are not here (no login item ever), and refuse a change.
  const contract = require('./ipc-contract.cjs');
  ipcMain.handle(contract.BACKGROUND_GET_CHANNEL, async event => {
    try { assertTrustedSender(event, window?.webContents); return { ok: true, result: background ? await background.state() : { ...backgroundValue, supported: false } }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
  ipcMain.handle(contract.BACKGROUND_SET_CHANNEL, async (event, input) => {
    try { assertTrustedSender(event, window?.webContents); return { ok: true, result: await setBackground(contract.validateBackgroundChange(input)) }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
  // A5 fix round 3: "Not now" on Today keeps only the day; it is no answer and never touches the login item.
  ipcMain.handle(contract.BACKGROUND_LATER_GET_CHANNEL, async event => {
    try { assertTrustedSender(event, window?.webContents); return { ok: true, result: { day: background ? await background.laterDay() : null } }; }
    catch (error) { return { ok: false, error: publicError(error) }; }
  });
  ipcMain.handle(contract.BACKGROUND_LATER_SET_CHANNEL, async (event, input) => {
    try {
      assertTrustedSender(event, window?.webContents);
      const day = contract.validateLaterDay(input);
      if (!background) throw Object.assign(new Error('Start at login is only in the installed Chausar app.'), { code: 'BACKGROUND_UNAVAILABLE' });
      return { ok: true, result: { day: await background.askLater(day) } };
    } catch (error) { return { ok: false, error: publicError(error) }; }
  });
  try { startupTask = startEngine(); await startupTask; if (stopping) return; createTray(); if (!(releaseBeta && hiddenStart)) createWindow(); }
  catch (error) { if (!stopping) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); } }
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } else if (engine?.state === 'ready') createWindow(); });
app.on('activate', () => { if (!window && engine?.state === 'ready') createWindow(); });
app.on('window-all-closed', () => { if (!runsInBackground()) app.quit(); });
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  startupTask.catch(error => console.error(publicError(error).message)).then(() => reportJobLifecycle()).catch(error => console.error(publicError(error).message)).then(() => engine?.stop()).then(result => {
    if (result && !result.graceful) console.error('The engine required termination; unfinished actions need reconciliation.');
  }).catch(error => console.error(publicError(error).message)).finally(() => { tray?.destroy(); app.quit(); });
});
