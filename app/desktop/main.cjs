const { app, BrowserWindow, ipcMain, protocol, session, dialog } = require('electron');
const { readFile, writeFile, mkdir, lstat } = require('node:fs/promises');
const { fork } = require('node:child_process');
const { join, resolve } = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { createServer } = require('node:net');

protocol.registerSchemesAsPrivileged([{ scheme: 'chausar', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
let window; let worker; let startup; let database; let stopping = false; const waiting = new Map();
const root = resolve(__dirname, '../..');
const renderer = join(root, 'app/renderer');
const engineRoot = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : root;
function stop() {
  if (worker) { worker.disconnect(); worker = null; }
  for (const item of waiting.values()) { clearTimeout(item.timeout); item.reject(new Error('Engine stopped.')); } waiting.clear();
}
async function startEngine() {
  const demo = process.argv.includes('--demo');
  const environment = { ...process.env, ELECTRON_RUN_AS_NODE: '1', CHAUSAR_VAULT_DIRECTORY: join(app.getPath('userData'), 'vaults'), CHAUSAR_DEMO: demo ? '1' : '0' };
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
  worker = fork(join(engineRoot, 'platform/runtime/worker.ts'), [], {
    execPath: process.execPath, execArgv: ['--experimental-strip-types'], windowsHide: true,
    env: environment,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  startup = new Promise((resolveStart, reject) => {
    const timeout = setTimeout(() => reject(new Error('The engine did not start.')), 15000);
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.on('message', message => {
      if (message.ready) { clearTimeout(timeout); resolveStart(); return; }
      const pending = waiting.get(message.id); if (!pending) return; waiting.delete(message.id); clearTimeout(pending.timeout);
      if (message.error) pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code })); else pending.resolve(message.result);
    });
    worker.once('exit', () => { stop(); if (window && !window.isDestroyed()) window.webContents.send('chausar:engine-status', { healthy: false }); });
  });
  await startup;
}
function request(method, payload) {
  return new Promise((resolveRequest, reject) => {
    if (!worker?.connected) return reject(new Error('The engine is unavailable. Restart Chausar.'));
    const id = randomUUID(); const timeout = setTimeout(() => { waiting.delete(id); reject(new Error('The request timed out. Inspect Activity before retrying an action.')); }, 120000);
    waiting.set(id, { resolve: resolveRequest, reject, timeout }); worker.send({ id, method, payload });
  });
}
function createWindow() {
  window = new BrowserWindow({ width: 1380, height: 940, minWidth: 800, minHeight: 600, backgroundColor: '#f7f5ee', title: 'Chausar', show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, spellcheck: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.once('ready-to-show', () => window.show());
  window.loadURL('chausar://app/index.html');
  window.on('closed', () => { window = null; });
}
if (singleInstance) app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith('chausar://app/') }));
  protocol.handle('chausar', async request => {
    const url = new URL(request.url); const files = new Map([['/index.html', 'index.html'], ['/', 'index.html'], ['/app.js', 'app.js'], ['/styles.css', 'styles.css'], ['/assets/icon.svg', 'assets/icon.svg']]);
    const file = files.get(url.pathname); if (url.hostname !== 'app' || !file) return new Response('Not found', { status: 404 });
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
    const ext = file.slice(file.lastIndexOf('.')); const data = await readFile(join(renderer, file));
    return new Response(data, { headers: { 'Content-Type': types[ext], 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'", 'X-Content-Type-Options': 'nosniff' } });
  });
  ipcMain.handle('chausar:request', async (event, input) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'chausar://app/index.html') throw new Error('Request sender is not trusted.');
    if (!input || typeof input.method !== 'string' || !/^[a-z]+\.[a-zA-Z]+$/.test(input.method) || Buffer.byteLength(JSON.stringify(input)) > 2_000_000) throw new Error('Invalid request.');
    return request(input.method, input.payload ?? {});
  });
  try { await startEngine(); createWindow(); }
  catch (error) { dialog.showErrorBox('Chausar could not start', error.message); app.quit(); }
});
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
app.on('activate', () => { if (!window && worker?.connected) createWindow(); });
app.on('window-all-closed', () => { app.quit(); });
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  const active = worker;
  const stopped = active ? new Promise(accept => { const timer = setTimeout(() => { active.kill(); accept(); }, 75000); active.once('exit', () => { clearTimeout(timer); accept(); }); }) : Promise.resolve();
  stop();
  stopped.then(() => database?.close()).catch(() => {}).finally(() => app.quit());
});
