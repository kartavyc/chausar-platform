// The Ink app (app/ui/dist) is the only app the local server and Electron serve, from an allowlist built from the dist
// folder at startup. Without a build, both refuse to start and say to run npm run build:ui.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createLocalServer } from '../runtime/server.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';
import type { Engine } from '../runtime/engine.ts';

const require = createRequire(new URL('../../app/desktop/main.cjs', import.meta.url));

async function dist() {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-ink-'));
  await mkdir(join(folder, 'assets'));
  await writeFile(join(folder, 'index.html'), '<!doctype html><title>Ink</title>');
  await writeFile(join(folder, 'theme.js'), '/* theme */');
  await writeFile(join(folder, 'assets/index-abc.js'), 'export {};');
  await writeFile(join(folder, 'assets/font-x.woff2'), 'wOF2');
  await writeFile(join(folder, 'assets/notes.exe'), 'MZ');
  return folder;
}

test('the Ink allowlist holds the built files of known types and refuses an unbuilt or missing folder', async t => {
  const folder = await dist(); t.after(() => rm(folder, { recursive: true, force: true }));
  const files = await listInkFiles(folder);
  assert.deepEqual(Object.keys(files).sort(), ['/', '/assets/font-x.woff2', '/assets/index-abc.js', '/index.html', '/theme.js']);
  const empty = await mkdtemp(join(tmpdir(), 'chausar-ink-empty-')); t.after(() => rm(empty, { recursive: true, force: true }));
  await assert.rejects(listInkFiles(empty), { code: 'UI_NOT_BUILT', message: /Run npm run build:ui/ });
  await assert.rejects(listInkFiles(join(empty, 'dist')), { code: 'UI_NOT_BUILT', message: /Run npm run build:ui/ });
});

test('the local server serves Ink at /, keeps /api/rpc, and serves nothing else', async t => {
  const folder = await dist(); t.after(() => rm(folder, { recursive: true, force: true }));
  const engine = { shutdown: async () => {} } as unknown as Engine;
  const app = createLocalServer(engine, { ink: { folder, files: await listInkFiles(folder) } });
  const { origin } = await app.listen(); t.after(() => app.close(100));
  const page = await fetch(`${origin}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Ink<\/title>/);
  assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'; style-src 'self'/);
  const script = await fetch(`${origin}/assets/index-abc.js`);
  assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal((await fetch(`${origin}/assets/font-x.woff2`)).headers.get('content-type'), 'font/woff2');
  for (const path of ['/app.js', '/launch.js', '/assets/notes.exe', '/assets/../index.html.bak']) assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  const rpc = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(rpc.status, 401);
});

test('a local server made without the Ink build serves the API and no application file', async t => {
  const engine = { shutdown: async () => {} } as unknown as Engine;
  const app = createLocalServer(engine);
  const { origin } = await app.listen(); t.after(() => app.close(100));
  for (const path of ['/', '/index.html', '/app.js', '/launch.js', '/styles.css', '/assets/icon.svg']) assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  assert.equal((await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
});

/** Runs main.cjs in a vm with a small Electron stand-in, like desktop-main.test.ts, and returns its protocol handler. */
async function desktop(args: string[], env: Record<string, string>, distFiles: Record<string, string> | null) {
  let handler: ((request: { url: string }) => Promise<Response>) | undefined;
  const errors: string[] = []; const reads: string[] = []; const windows: any[] = [];
  const app = new EventEmitter() as any; app.isPackaged = false; app.quits = 0;
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' }; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = () => {}; windows.push(this); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter { state = 'ready'; async start() {} async request() { return {}; } async updateJobLifecycle() { return { applied: true }; } async stop() { return { graceful: true }; } }
  const dirent = (name: string, dir: boolean) => ({ name, isDirectory: () => dir, isFile: () => !dir });
  const fs = {
    readFile: async (path: string) => { if (path.endsWith('package.json')) return JSON.stringify({ chausarPreview: true, version: '2.3.4' }); reads.push(path.replaceAll('\\', '/')); return Buffer.from('file'); },
    mkdir: async () => {}, writeFile: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
    readdir: async (folder: string) => {
      if (!distFiles) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      const at = folder.replaceAll('\\', '/').replace(/^.*app\/ui\/dist\/?/, '');
      const names = new Map<string, boolean>();
      for (const file of Object.keys(distFiles)) { if (!file.startsWith(at ? `${at}/` : '')) continue; const rest = file.slice(at ? at.length + 1 : 0); const [head, ...tail] = rest.split('/'); names.set(head!, tail.length > 0); }
      return [...names].map(([name, dir]) => dirent(name, dir));
    },
  };
  const electron = { app, BrowserWindow: Window, Tray: class extends EventEmitter { setToolTip() {} setContextMenu() {} }, shell: {}, powerMonitor: new EventEmitter(), Menu: { buildFromTemplate: (x: any) => x }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
    protocol: { registerSchemesAsPrivileged() {}, handle: (_scheme: string, h: any) => { handler = h; } },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } },
    dialog: { showErrorBox: (_t: string, message: string) => errors.push(message) }, ipcMain: { handle() {} } };
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('./ipc-contract.cjs');
    if (name === 'node:fs/promises') return fs;
    return require(name);
  }, process: { argv: ['electron', '/owned/app', ...args], env, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer });
  for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
  return { handler, errors, reads, app, windows };
}

test('Electron serves Ink from app/ui/dist, from the folder listing, and refuses other files', async () => {
  const built = { 'index.html': '', 'theme.js': '', 'assets/index-abc.js': '', 'assets/notes.exe': '' };
  const ink = await desktop(['--demo'], {}, built);
  assert.equal(ink.errors.length, 0, ink.errors.join(' | '));
  assert.equal((await ink.handler!({ url: 'chausar://app/index.html' })).status, 200);
  assert.equal((await ink.handler!({ url: 'chausar://app/assets/index-abc.js' })).headers.get('Content-Type'), 'text/javascript; charset=utf-8');
  assert.equal((await ink.handler!({ url: 'chausar://app/app.js' })).status, 404);
  assert.equal((await ink.handler!({ url: 'chausar://app/assets/notes.exe' })).status, 404);
  for (const path of ['launch.js', 'styles.css', 'assets/icon.svg']) assert.equal((await ink.handler!({ url: `chausar://app/${path}` })).status, 404, path);
  assert.equal(ink.windows.length, 1);
  assert.equal(ink.windows[0].webContents.mainFrame.url, 'chausar://app/index.html');
  assert.ok(ink.reads.length > 0 && ink.reads.every(path => path.includes('/app/ui/dist/')), ink.reads.join(', '));
});

test('Electron with no build, or an empty dist folder, says so and quits before any window', async () => {
  for (const files of [null, {}]) {
    const missing = await desktop(['--demo'], {}, files);
    assert.match(missing.errors[0] ?? '', /Run npm run build:ui/);
    assert.equal(missing.app.quits, 1);
    assert.equal(missing.windows.length, 0);
  }
});

test('every npm script that opens the app builds Ink first, so a fresh checkout never starts without it', async () => {
  const { scripts } = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  for (const name of ['start', 'start:production', 'start:hosted', 'desktop', 'desktop:production']) assert.equal(scripts[`pre${name}`], 'npm run build:ui', name);
  assert.equal(scripts['build:ui'], 'vite build --config app/ui/vite.config.ts');
});

test('a hash route keeps the window trusted; a query does not', () => {
  const { assertTrustedSender } = require('../../app/desktop/ipc-contract.cjs');
  const mainFrame = { url: 'chausar://app/index.html#/work/runs?sheet=run%3A31' }; const contents = { mainFrame };
  assert.doesNotThrow(() => assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents));
  mainFrame.url = 'chausar://app/index.html?x#/today';
  assert.throws(() => assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), { code: 'UNTRUSTED_SENDER' });
  mainFrame.url = 'chausar://app/index.html#<script>';
  assert.throws(() => assertTrustedSender({ sender: contents, senderFrame: mainFrame }, contents), { code: 'UNTRUSTED_SENDER' });
});
