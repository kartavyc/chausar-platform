import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import vm from 'node:vm';

// Round 4, frame-today, desktop main (app/desktop/main.cjs and shell-ipc.cjs): the tray (SH-07), the trusted document
// after a cancelled navigation, outside links during first run (SH-10), saving the fault report and the crash marker
// (SH-11). Electron, the engine, the file system and the dialogs are synthetic; nothing touches the disk.
const require = createRequire(import.meta.url);
const desktopMain = new URL('../../app/desktop/main.cjs', import.meta.url);
const desktopRequire = createRequire(desktopMain);
const flush = () => new Promise<void>(accept => setImmediate(accept));
const settle = async () => { for (let i = 0; i < 5; i++) await flush(); };
const profile = resolve('/synthetic-profile');
const marker = join(profile, 'userData', 'chausar-running.marker');

type Facts = { open?: boolean; folders?: unknown[]; reviewCount?: number | null; session?: string | null };

async function desktop(args: string[], facts: Facts = {}, files: { marker?: boolean } = {}) {
  const windows: any[] = [], engines: any[] = [], menus: any[] = [], handlers = new Map<string, any>();
  const opened: string[] = [], dialogs: any[] = [], written: [string, string][] = [], unlinked: string[] = [];
  const app = new EventEmitter() as any; app.isPackaged = false; app.quits = 0; app.quit = () => { app.quits++; };
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => join(profile, 'userData');
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: '' }; this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = () => {}; windows.push(this); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter {
    state = 'ready'; lifecycle: any[] = []; requests: string[] = []; options: any;
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    async start() {}
    async request(method: string) {
      this.requests.push(method);
      if (method === 'workspace.status') return { open: facts.open === true };
      if (method === 'todayx.workspaces') return { folders: facts.folders ?? [{ folder: 'main', main: true }] };
      if (method === 'today.review') return { count: facts.reviewCount ?? null, rows: [] };
      if (method === 'session.status') { if (facts.session === undefined || facts.session === null) throw Object.assign(new Error('Unknown'), { code: 'UNKNOWN_METHOD' }); return { state: facts.session, window: { id: 'w1', title: 'Synthetic ledger' }, steps: [] }; }
      return { method };
    }
    async updateJobLifecycle(state: any) { this.lifecycle.push({ ...state }); return { applied: true }; }
    async stop() { this.state = 'stopped'; return { graceful: true }; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu(menu: any) { menus.push(menu); } destroy() {} }
  const electron = {
    app, BrowserWindow: Window, Tray, powerMonitor: new EventEmitter(), Menu: { buildFromTemplate: (items: any) => items },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, shell: { openExternal: async (url: string) => { opened.push(url); } },
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } },
    dialog: { showErrorBox() {}, showSaveDialog: async (...input: any[]) => { dialogs.push(input); return dialogs.length === 2 ? { canceled: true } : { canceled: false, filePath: '/chosen/by/person.txt' }; } },
    ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) },
  };
  const fs = {
    readFile: async (path: string) => { if (path.endsWith('package.json')) return JSON.stringify({ version: '9.9.9' }); if (path === marker && files.marker) return 'running'; throw Object.assign(new Error('missing'), { code: 'ENOENT' }); },
    writeFile: async (path: string, text: string) => { written.push([path, text]); }, unlink: async (path: string) => { unlinked.push(path); },
    mkdir: async () => {}, lstat: async () => ({}),
  };
  vm.runInNewContext(await readFile(desktopMain, 'utf8'), { __dirname: join(profile, 'app', 'desktop'), require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === 'node:fs/promises') return fs;
    if (name === './demo-profile.cjs') return { bindDemoProfile: () => ({ vaults: join(profile, 'userData', 'vaults') }), assertDemoProfile: () => {} };
    if (name === '../../package.json') return { chausarPreview: true, version: '9.9.9' };
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    return desktopRequire(name);
  }, process: { argv: ['electron', profile, ...args], env: {}, platform: 'win32', resourcesPath: profile }, console: { error() {} }, URL, Response, Buffer });
  await settle();
  const window = windows[0];
  const trusted = (frameUrl?: string) => ({ sender: window.webContents, senderFrame: frameUrl === undefined ? window.webContents.mainFrame : { url: frameUrl } });
  return { app, windows, window, engines, menus, handlers, opened, dialogs, written, unlinked, trusted, facts };
}

test('a cancelled legacy navigation keeps the window trusted; only a committed one moves the trusted document', async () => {
  const d = await desktop(['--demo', '--ui-preview']);
  const request = d.handlers.get('chausar:request');
  const ask = () => request(d.trusted(), { method: 'workspace.status', payload: {} });
  assert.equal(d.window.webContents.mainFrame.url, 'chausar://app/ui/index.html');
  let prevented = false;
  d.window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'chausar://app/index.html');
  assert.equal(prevented, false, 'The legacy renderer stays reachable behind its flag.');
  // Cancelled: the frame never left the new UI, which still talks to main.
  d.window.webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'chausar://app/index.html', true);
  assert.equal((await ask()).ok, true);
  // A navigation that never committed and a commit of another address change nothing either.
  d.window.webContents.emit('will-navigate', { preventDefault() {} }, 'chausar://app/index.html');
  d.window.webContents.emit('did-navigate', {}, 'chausar://app/ui/index.html');
  assert.equal((await ask()).ok, true);
  // Committed: the legacy document is trusted and the new UI's frame no longer is.
  d.window.webContents.emit('will-navigate', { preventDefault() {} }, 'chausar://app/index.html');
  d.window.webContents.mainFrame.url = 'chausar://app/index.html';
  d.window.webContents.emit('did-navigate', {}, 'chausar://app/index.html');
  assert.equal((await ask()).ok, true);
  const stale = await request(d.trusted('chausar://app/ui/index.html'), { method: 'workspace.status', payload: {} });
  assert.equal(stale.error.code, 'UNTRUSTED_SENDER');
  // The default UI without the flag still refuses the navigation outright.
  const plain = await desktop(['--demo']);
  let refused = false;
  plain.window.webContents.emit('will-navigate', { preventDefault() { refused = true; } }, 'chausar://app/index.html');
  assert.equal(refused, true);
});

test('outside links before any vault exists open only from the new UI document, with every other rule kept', async () => {
  const first = await desktop(['--demo'], { open: false, folders: [] });
  const open = first.handlers.get('chausar:shell-open-external');
  assert.equal(await open({ sender: {}, senderFrame: first.window.webContents.mainFrame }, 'https://example.com/'), 'refused');
  assert.equal(await open(first.trusted(), 'http://example.com/'), 'refused');
  assert.equal(await open(first.trusted(), 'https://exämple.com/'), 'refused');
  assert.equal(await open(first.trusted(), 'https://example.com/a'), 'opened');
  assert.equal(await open(first.trusted(), 'https://example.com/b'), 'refused', 'One a second still holds.');
  assert.deepEqual(first.opened, ['https://example.com/a']);
  // A vault exists but is not open (locked): refused, as before.
  const locked = await desktop(['--demo'], { open: false, folders: [{ folder: 'main', main: true }] });
  assert.equal(await locked.handlers.get('chausar:shell-open-external')(locked.trusted(), 'https://example.com/'), 'refused');
  // The legacy document never links out before a vault exists.
  const legacy = await desktop(['--demo', '--legacy-renderer'], { open: false, folders: [] });
  assert.equal(legacy.window.webContents.mainFrame.url, 'chausar://app/index.html');
  assert.equal(await legacy.handlers.get('chausar:shell-open-external')(legacy.trusted(), 'https://example.com/'), 'refused');
  assert.deepEqual([...locked.opened, ...legacy.opened], []);
});

test('the fault report is saved through the system dialog with a fixed name; the renderer gives only the text', async () => {
  const d = await desktop(['--demo']);
  const save = d.handlers.get('chausar:shell-save-text');
  const text = 'No names, amounts, file names, cell values or questions are in this report.\n\napp 9.9.9';
  assert.equal(await save({ sender: {}, senderFrame: d.window.webContents.mainFrame }, 'fault-report', text), 'refused');
  for (const [kind, value] of [['receipt', text], ['../etc/passwd', text], ['fault-report', ''], ['fault-report', 'a\u0000b'], ['fault-report', 'x'.repeat(70_000)], ['fault-report', { path: '/tmp/x' }]] as const)
    assert.equal(await save(d.trusted(), kind, value), 'refused');
  assert.deepEqual(d.dialogs, []);
  assert.equal(await save(d.trusted(), 'fault-report', text), 'saved');
  assert.equal(d.dialogs.length, 1);
  const [owner, options] = d.dialogs[0] as [unknown, { defaultPath: string }];
  assert.equal(owner, d.window, 'The dialog belongs to the window.');
  assert.equal(options.defaultPath, 'chausar-fault-report.txt');
  assert.deepEqual(d.written.filter(([path]) => path !== marker), [['/chosen/by/person.txt', text]]);
  await new Promise(accept => setTimeout(accept, 1_050));
  assert.equal(await save(d.trusted(), 'fault-report', text), 'cancelled', 'Cancelling the dialog writes nothing.');
  assert.equal(d.written.filter(([path]) => path !== marker).length, 1);
});

test('an unclean exit is noticed on the next start, answered once, and a clean quit removes the marker', async () => {
  const clean = await desktop(['--demo']);
  assert.ok(clean.written.some(([path]) => path === marker), 'The marker is written at start.');
  assert.equal(await clean.handlers.get('chausar:shell-crash-state')(clean.trusted()), 'clean');
  clean.app.emit('before-quit', { preventDefault() {} }); await settle();
  assert.deepEqual(clean.unlinked, [marker]);

  const crashed = await desktop(['--demo'], {}, { marker: true });
  const state = crashed.handlers.get('chausar:shell-crash-state'), answer = crashed.handlers.get('chausar:shell-crash-answer');
  assert.equal(await state({ sender: {}, senderFrame: crashed.window.webContents.mainFrame }), 'clean', 'An untrusted sender learns nothing.');
  assert.equal(await state(crashed.trusted()), 'crashed');
  assert.equal(await answer(crashed.trusted(), 'upload-everything'), 'refused');
  assert.equal(await answer(crashed.trusted(), 'dont-send'), 'answered');
  assert.equal(await state(crashed.trusted()), 'clean');
});

test('the tray shows the review count, pauses jobs, offers Stop while driving and says when it is paused while locked', async () => {
  const d = await desktop(['--background', '--demo'], { open: true, reviewCount: 3, session: 'driving' });
  const menu = () => d.menus.at(-1) as any[];
  const labels = () => Array.from(menu(), item => String(item.label ?? item.type));
  assert.deepEqual(labels(), ['Open Chausar', '3 things await your review', 'Pause jobs', 'Stop', 'separator', 'Quit Chausar and stop jobs']);
  assert.equal(menu()[1].enabled, false);
  assert.equal(d.engines[0].lifecycle.at(-1).awake, true);
  menu().find(item => item.label === 'Pause jobs').click(); await settle();
  assert.equal(d.engines[0].lifecycle.at(-1).awake, false, 'Paused from the tray, the engine runs no job.');
  assert.ok(labels().includes('Resume jobs'));
  menu().find(item => item.label === 'Resume jobs').click(); await settle();
  assert.equal(d.engines[0].lifecycle.at(-1).awake, true);
  menu().find(item => item.label === 'Stop').click(); await settle();
  assert.ok(d.engines[0].requests.includes('session.stop'));
  // Without a driving lane, or with no count, those lines are left out.
  d.facts.session = null; d.facts.reviewCount = null; d.engines[0].emit('status', { state: 'ready' }); await settle();
  assert.deepEqual(labels(), ['Open Chausar', 'Pause jobs', 'separator', 'Quit Chausar and stop jobs']);
  // Locked after a workspace was open: no count, no Pause, the plain fact.
  const before = d.engines[0].requests.length;
  d.facts.open = false; d.facts.reviewCount = 3; d.engines[0].emit('status', { state: 'ready' }); await settle();
  assert.deepEqual(labels(), ['Open Chausar', 'Paused while locked', 'separator', 'Quit Chausar and stop jobs']);
  assert.equal(menu()[1].enabled, false);
  assert.deepEqual(Array.from(d.engines[0].requests.slice(before)), ['workspace.status'], 'Nothing behind the lock is read.');
});
