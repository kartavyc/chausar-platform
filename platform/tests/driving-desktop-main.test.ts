import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// WK-14, SH-03 (driving strip) and SH-07 (tray Stop) on the Electron main side. Electron, the engine
// and its worker are synthetic here; the last test drives the real module in a real Electron under Xvfb.
const require = createRequire(import.meta.url);
const modulePath = fileURLToPath(new URL('../../app/desktop/driving-main.cjs', import.meta.url));
const driving = require(modulePath) as {
  STOP_URL: string; CONTINUE_URL: string; PARTITION: string;
  drivingStatus(message: unknown): { state: string; active: boolean } | null;
  registerDriving(options: Record<string, unknown>): { drivingMenuItems(): any[]; state(): { state: string; active: boolean }; dispose(): void };
};
const flush = () => new Promise<void>(accept => setImmediate(accept));

function fakeElectron() {
  const windows: any[] = [], trays: any[] = [], menus: any[] = [], permissionHandlers: any[] = [], partitions: string[] = [];
  const app = new EventEmitter();
  class BrowserWindow extends EventEmitter {
    options: any; urls: string[] = []; shown = 0; closed = false; visible = false; onTop: unknown[] = [];
    webContents: any;
    constructor(options: any) {
      super(); this.options = options; windows.push(this);
      const contents = new EventEmitter() as any;
      contents.setWindowOpenHandler = (handler: any) => { contents.openHandler = handler; };
      this.webContents = contents;
    }
    setAlwaysOnTop(...args: unknown[]) { this.onTop = args; }
    loadURL(url: string) { this.urls.push(url); return Promise.resolve(); }
    showInactive() { this.shown++; this.visible = true; }
    isVisible() { return this.visible; }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; this.emit('closed'); }
  }
  class Tray {
    image: unknown; tooltip = ''; menu: any; destroyed = false;
    constructor(image: unknown) { this.image = image; trays.push(this); }
    setToolTip(value: string) { this.tooltip = value; }
    setContextMenu(menu: any) { this.menu = menu; }
    destroy() { this.destroyed = true; }
  }
  const electron = {
    app, BrowserWindow, Tray,
    Menu: { buildFromTemplate: (template: any[]) => { const menu = { template }; menus.push(menu); return menu; } },
    nativeImage: { createFromPath: (path: string) => ({ path, isEmpty: () => false }) },
    screen: { getPrimaryDisplay: () => ({ workArea: { x: 100, y: 20, width: 1600, height: 900 } }) },
    session: { fromPartition: (name: string) => { partitions.push(name); return {
      setPermissionRequestHandler: (handler: any) => permissionHandlers.push(handler),
      setPermissionCheckHandler: () => {},
    }; } },
  };
  return { electron, app, windows, trays, menus, permissionHandlers, partitions };
}

function fakeEngine(fail = false) {
  const calls: Array<[string, unknown]> = [];
  return { calls, worker: new EventEmitter(), request: async (method: string, payload: unknown) => {
    calls.push([method, payload]);
    if (fail) throw Object.assign(new Error('secret path /home/someone/vault'), { code: 'ENGINE_UNAVAILABLE' });
    return {};
  } };
}

function setup({ demo = false, fail = false } = {}) {
  const fake = fakeElectron();
  let engine: any = fakeEngine(fail);
  const ticks: Array<() => void> = []; let cleared = 0;
  const errors: string[] = []; const original = console.error;
  console.error = (message: string) => { errors.push(String(message)); };
  const handle = driving.registerDriving({
    getEngine: () => engine, demo, electron: fake.electron,
    setInterval: (callback: () => void) => { ticks.push(callback); return { unref() {} }; },
    clearInterval: () => { cleared++; },
  });
  const restore = () => { console.error = original; handle.dispose(); };
  return { ...fake, handle, errors, restore, ticks, cleared: () => cleared,
    get engine() { return engine; }, set engine(value) { engine = value; },
    send(message: unknown) { engine.worker.emit('message', message); } };
}

const navigate = (window: any, url: string, name = 'will-navigate') => {
  let prevented = 0; const event = { preventDefault: () => { prevented++; } };
  window.webContents.emit(name, event, url);
  return prevented;
};
const html = (url: string) => decodeURIComponent(url.slice('data:text/html;charset=utf-8,'.length));

test('the driver switch is set for real workspaces and never set in demo', t => {
  const before = process.env.CHAUSAR_DESKTOP_DRIVER;
  t.after(() => { if (before === undefined) delete process.env.CHAUSAR_DESKTOP_DRIVER; else process.env.CHAUSAR_DESKTOP_DRIVER = before; });
  process.env.CHAUSAR_DESKTOP_DRIVER = '1'; // set by the shell: demo still removes it
  const demo = setup({ demo: true }); demo.restore();
  assert.equal(process.env.CHAUSAR_DESKTOP_DRIVER, undefined);
  const real = setup(); real.restore();
  assert.equal(process.env.CHAUSAR_DESKTOP_DRIVER, '1');
});

test('outside Electron (plain Node) registration is inert', () => {
  const handle = driving.registerDriving({ getEngine: () => undefined, demo: true, electron: '/path/to/electron' });
  assert.deepEqual(handle.drivingMenuItems(), []);
  assert.deepEqual(handle.state(), { state: 'idle', active: false, stopKey: 'Ctrl Alt Pause' });
});

test('an active session shows one top-centre, unfocusable, always-on-top strip with the driving text', async t => {
  const s = setup(); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  await flush();
  assert.equal(s.windows.length, 1);
  const [window] = s.windows;
  assert.deepEqual({ ...window.options, webPreferences: undefined }, {
    x: 620, y: 20, width: 560, height: 40, frame: false, alwaysOnTop: true, focusable: false, skipTaskbar: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, closable: true, show: false, title: 'Chausar is driving', backgroundColor: '#1f2a24', webPreferences: undefined,
  });
  assert.deepEqual(window.options.webPreferences, { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false, partition: 'chausar-driving-strip', spellcheck: false });
  assert.deepEqual(window.onTop, [true, 'screen-saver']);
  assert.equal(window.shown, 1);
  assert.deepEqual(s.partitions, ['chausar-driving-strip']);
  let granted: boolean | undefined; s.permissionHandlers[0](null, 'media', (value: boolean) => { granted = value; });
  assert.equal(granted, false);
  assert.deepEqual(window.webContents.openHandler(), { action: 'deny' });
  assert.equal(window.urls.length, 1);
  assert.match(window.urls[0], /^data:text\/html;charset=utf-8,/);
  const page = html(window.urls[0]);
  assert.match(page, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
  assert.match(page, /Chausar is driving\. Ctrl Alt Pause to stop\./);
  assert.match(page, /<a href="chausar-driving:stop">Stop<\/a>/);
  assert.doesNotMatch(page, /chausar-driving:continue|<script/);
  assert.deepEqual(s.handle.state(), { state: 'driving', active: true, stopKey: 'Ctrl Alt Pause' });
});

test('paused shows Continue and Stop in the same strip; sign-in shows Stop only', async t => {
  const s = setup(); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  s.send({ kind: 'driving-status', state: 'paused-by-you', active: true });
  assert.equal(s.windows.length, 1);
  const page = html(s.windows[0].urls[1]);
  assert.match(page, /Chausar paused\. Continue or Stop\./);
  assert.match(page, /<a href="chausar-driving:continue">Continue<\/a><a href="chausar-driving:stop">Stop<\/a>/);
  s.send({ kind: 'driving-status', state: 'paused-by-you', active: true });
  assert.equal(s.windows[0].urls.length, 2, 'the same state does not reload the strip');
  s.send({ kind: 'driving-status', state: 'sign-in', active: true });
  const signIn = html(s.windows[0].urls[2]);
  assert.match(signIn, /Sign in yourself\. Chausar continues after\./);
  assert.match(signIn, /chausar-driving:stop/);
  assert.doesNotMatch(signIn, /chausar-driving:continue/);
  assert.equal(s.windows.length, 1);
});

test('an inactive state closes the strip and destroys the tray; a later session opens fresh ones', async t => {
  const s = setup(); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  assert.equal(s.trays.length, 1);
  for (const state of ['stopped-by-key', 'stopped', 'step-failed', 'done', 'idle']) {
    s.send({ kind: 'driving-status', state: 'driving', active: true });
    s.send({ kind: 'driving-status', state, active: false });
    assert.equal(s.windows.at(-1).closed, true, state);
    assert.equal(s.trays.at(-1).destroyed, true, state);
    assert.deepEqual(s.handle.drivingMenuItems(), []);
  }
  assert.equal(s.windows.length, 5);
});

test('invalid status messages are ignored', async t => {
  const s = setup(); t.after(s.restore);
  const invalid: unknown[] = [
    null, 'driving', 1, [], ['driving-status', 'driving', true],
    { kind: 'driving-status', state: 'driving', active: true, extra: 1 },
    { kind: 'driving-status', state: 'driving', active: true, stopKey: '<b>Esc</b>' },
    { kind: 'driving-status', state: 'driving', active: true, stopKey: 'Ctrl Alt Pause', extra: 1 },
    { kind: 'driving-status', state: 'driving' },
    { kind: 'status', state: 'driving', active: true },
    { kind: 'driving-status', state: 'flying', active: true },
    { kind: 'driving-status', state: 'driving', active: false },
    { kind: 'driving-status', state: 'done', active: true },
    { kind: 'driving-status', state: 'driving', active: 'true' },
    { id: 'x', kind: 'driving-status', state: 'driving' },
    Object.assign(Object.create({ inherited: true }), { kind: 'driving-status', state: 'driving', active: true }),
    Object.assign({ kind: 'driving-status', state: 'driving', active: true }, { [Symbol('x')]: 1 }),
  ];
  for (const message of invalid) { s.send(message); assert.equal(driving.drivingStatus(message), null); }
  assert.equal(s.windows.length, 0);
  assert.equal(s.trays.length, 0);
  assert.deepEqual(s.handle.state(), { state: 'idle', active: false, stopKey: 'Ctrl Alt Pause' });
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  s.send({ kind: 'driving-status', state: 'idle', active: true });
  assert.equal(s.windows[0].closed, false, 'an inconsistent message does not end the session');
});

test('the strip links call session.stop and session.resume; every navigation is prevented', async t => {
  const s = setup(); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'paused-by-you', active: true });
  const [window] = s.windows;
  assert.equal(navigate(window, 'chausar-driving:continue'), 1);
  await flush();
  assert.deepEqual(s.engine.calls, [['session.resume', {}]]);
  assert.equal(navigate(window, 'chausar-driving:stop'), 1);
  await flush();
  assert.deepEqual(s.engine.calls.at(-1), ['session.stop', {}]);
  // Electron 44 reports these links as will-frame-navigate (an event carrying url and isMainFrame).
  let prevented = 0;
  window.webContents.emit('will-frame-navigate', { url: 'chausar-driving:continue', isMainFrame: false, preventDefault: () => { prevented++; } });
  assert.equal(prevented, 1);
  await flush();
  assert.equal(s.engine.calls.length, 2, 'a subframe never acts');
  const count = s.engine.calls.length;
  for (const url of ['https://example.com/', 'chausar-driving:stop?x', 'chausar-driving:STOP', 'chausar://app/ui/index.html', 'data:text/html,x', 'file:///etc/passwd']) {
    assert.equal(navigate(window, url), 1, url);
    assert.equal(navigate(window, url, 'will-redirect'), 1, url);
    assert.equal(navigate(window, url, 'will-frame-navigate'), 1, url);
  }
  await flush();
  assert.equal(s.engine.calls.length, count);
});

test('the same link reported by both navigation events counts once; Continue acts only while paused', async t => {
  const s = setup(); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  const [window] = s.windows;
  window.webContents.emit('will-frame-navigate', { url: 'chausar-driving:stop', isMainFrame: true, preventDefault() {} });
  navigate(window, 'chausar-driving:stop');
  navigate(window, 'chausar-driving:continue');
  await flush();
  assert.deepEqual(s.engine.calls, [['session.stop', {}]]);
});

test('the tray offers Stop while driving and Continue while paused, and drivingMenuItems matches', async t => {
  const s = setup(); t.after(s.restore);
  assert.deepEqual(s.handle.drivingMenuItems(), []);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  const [tray] = s.trays;
  assert.equal(tray.tooltip, 'Chausar is driving');
  assert.match(tray.image.path, /app[\\/]desktop[\\/]icon\.png$/);
  assert.deepEqual(tray.menu.template.map((item: any) => item.label), ['Stop Chausar driving']);
  s.send({ kind: 'driving-status', state: 'paused-by-you', active: true });
  assert.equal(s.trays.length, 1);
  assert.deepEqual(tray.menu.template.map((item: any) => item.label), ['Stop Chausar driving', 'Continue']);
  assert.deepEqual(s.handle.drivingMenuItems().map(item => item.label), ['Stop Chausar driving', 'Continue']);
  tray.menu.template[1].click(); tray.menu.template[0].click();
  s.handle.drivingMenuItems()[0].click();
  await flush();
  assert.deepEqual(s.engine.calls.map(([method]: any[]) => method), ['session.resume', 'session.stop', 'session.stop']);
  s.send({ kind: 'driving-status', state: 'sign-in', active: true });
  assert.deepEqual(tray.menu.template.map((item: any) => item.label), ['Stop Chausar driving']);
});

test('the worker is found by polling, attached once, and a new worker is attached too', async t => {
  const s = setup(); t.after(s.restore);
  const first = s.engine.worker;
  assert.equal(first.listenerCount('message'), 1);
  s.ticks[0](); s.ticks[0]();
  assert.equal(first.listenerCount('message'), 1);
  s.engine = undefined; s.ticks[0]();
  s.engine = fakeEngine();
  assert.equal(s.engine.worker.listenerCount('message'), 0);
  s.ticks[0](); s.ticks[0]();
  assert.equal(s.engine.worker.listenerCount('message'), 1);
  s.send({ kind: 'driving-status', state: 'driving', active: true });
  assert.equal(s.windows.length, 1);
  s.engine.worker.emit('exit', 1, null);
  assert.equal(s.windows[0].closed, true, 'a worker that exits takes the strip down');
  assert.equal(s.trays[0].destroyed, true);
  s.app.emit('will-quit');
  assert.equal(s.cleared(), 1);
});

test('engine failures do not throw and log only a fixed code', async t => {
  const s = setup({ fail: true }); t.after(s.restore);
  s.send({ kind: 'driving-status', state: 'paused-by-you', active: true });
  assert.doesNotThrow(() => navigate(s.windows[0], 'chausar-driving:stop'));
  s.handle.drivingMenuItems()[1].click();
  await flush(); await flush();
  assert.deepEqual(s.errors, ['Chausar driving: session.stop failed; code=ENGINE_UNAVAILABLE', 'Chausar driving: session.resume failed; code=ENGINE_UNAVAILABLE']);
  s.engine.request = () => { throw new Error('sync /secret'); };
  s.handle.drivingMenuItems()[0].click();
  await flush();
  assert.equal(s.errors.at(-1), 'Chausar driving: session.stop failed; code=REQUEST_FAILED');
  assert.ok(s.errors.every(line => !line.includes('secret')));
});

test('quitting asks the engine to stop an active session once, then closes the strip', async t => {
  const s = setup(); t.after(s.restore);
  s.app.emit('before-quit');
  await flush();
  assert.deepEqual(s.engine.calls, [], 'nothing to stop when no session is active');
  const t2 = setup(); t.after(t2.restore);
  t2.send({ kind: 'driving-status', state: 'driving', active: true });
  t2.app.emit('before-quit'); t2.app.emit('before-quit');
  await flush();
  assert.deepEqual(t2.engine.calls, [['session.stop', {}]]);
  t2.app.emit('will-quit');
  assert.equal(t2.windows[0].closed, true);
  assert.equal(t2.trays[0].destroyed, true);
});

test('main.cjs registers the driving lane once, in its fenced block after the window and engine declarations', async () => {
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  const block = "// --- driving lane: WK-14 strip, tray Stop and the driver switch (app/desktop/driving-main.cjs) ---\n"
    + "require('./driving-main.cjs').registerDriving({ getEngine: () => engine, demo });\n"
    + '// --- end driving lane ---\n';
  assert.equal(source.split(block).length, 2);
  assert.equal(source.split('driving-main.cjs').length, 3);
  const declaration = source.indexOf('\nlet window; let engine;');
  assert.ok(declaration > 0);
  const lineEnd = source.indexOf('\n', declaration + 1);
  assert.equal(source.indexOf(block), lineEnd + 1, 'the block follows the declaration line directly');
});

// A real Electron under Xvfb: the strip is always on top and clicking its Stop link reaches session.stop.
const electronBinary = fileURLToPath(new URL('../../node_modules/.bin/electron', import.meta.url));
const smokeSkip = !existsSync('/usr/bin/Xvfb') ? 'Xvfb is not installed' : !existsSync(electronBinary) ? 'Electron is not installed' : false;
const smokeScript = `
const { app, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const driving = require(process.env.CHAUSAR_DRIVING_MODULE);
const calls = [];
const engine = { worker: new EventEmitter(), request: async method => { calls.push(method); return {}; } };
const result = { calls };
const finish = extra => { process.stdout.write('DRIVING-SMOKE ' + JSON.stringify({ ...result, ...extra }) + '\\n'); app.exit(0); };
setTimeout(() => finish({ timeout: true }), 20000).unref();
app.on('window-all-closed', () => {}); // closing the strip must not end the smoke before it reports
driving.registerDriving({ getEngine: () => engine, demo: false });
result.driver = process.env.CHAUSAR_DESKTOP_DRIVER;
const loaded = window => new Promise(accept => { if (!window.webContents.isLoading()) accept(); else window.webContents.once('did-finish-load', accept); });
const sweep = window => { const { width } = window.getBounds(); for (let x = width - 10; x > width - 160; x -= 8) for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) window.webContents.sendInputEvent({ type, x, y: 20, button: 'left', clickCount: 1 }); };
const wait = ms => new Promise(accept => setTimeout(accept, ms));
app.whenReady().then(async () => {
  engine.worker.emit('message', { kind: 'driving-status', state: 'driving', active: true });
  const windows = BrowserWindow.getAllWindows(); const window = windows[0];
  Object.assign(result, { windows: windows.length, alwaysOnTop: window.isAlwaysOnTop(), focusable: window.isFocusable(), bounds: window.getBounds() });
  await loaded(window); await wait(300);
  result.visible = window.isVisible();
  sweep(window); await wait(800);
  result.afterStop = calls.slice();
  engine.worker.emit('message', { kind: 'driving-status', state: 'paused-by-you', active: true });
  result.sameWindow = BrowserWindow.getAllWindows().length === 1 && BrowserWindow.getAllWindows()[0] === window;
  await loaded(window); await wait(300);
  sweep(window); await wait(800);
  result.afterPaused = calls.slice();
  result.stillOnPage = window.webContents.getURL().startsWith('data:text/html');
  engine.worker.emit('message', { kind: 'driving-status', state: 'done', active: false });
  await wait(200);
  result.closed = window.isDestroyed();
  finish({});
});
`;

async function freeDisplay(): Promise<number> {
  for (let n = 140 + Math.floor(Math.random() * 50); n < 400; n++) if (!existsSync(`/tmp/.X${n}-lock`) && !existsSync(`/tmp/.X11-unix/X${n}`)) return n;
  throw new Error('no free X display');
}

test('Electron smoke: the strip is on top and its Stop and Continue links reach the engine', { skip: smokeSkip, timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-driving-smoke-'));
  const display = await freeDisplay();
  const xvfb: ChildProcess = spawn('/usr/bin/Xvfb', [`:${display}`, '-nolisten', 'tcp'], { stdio: 'ignore' });
  t.after(async () => { xvfb.kill(); await rm(directory, { recursive: true, force: true }); });
  for (let i = 0; i < 50 && !existsSync(`/tmp/.X11-unix/X${display}`); i++) await new Promise(accept => setTimeout(accept, 100));
  assert.ok(existsSync(`/tmp/.X11-unix/X${display}`), 'Xvfb started');
  const script = join(directory, 'main.cjs');
  await writeFile(script, smokeScript);
  const environment: Record<string, string | undefined> = { ...process.env, DISPLAY: `:${display}`, CHAUSAR_DRIVING_MODULE: modulePath };
  delete environment.ELECTRON_RUN_AS_NODE; delete environment.CHAUSAR_DESKTOP_DRIVER; delete environment.NODE_TEST_CONTEXT; delete environment.NODE_OPTIONS;
  const output = await new Promise<string>((accept, reject) => {
    const child = spawn(electronBinary, ['--no-sandbox', script], { env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr!.on('data', chunk => { stderr += chunk; });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Electron smoke timed out')); }, 45_000);
    child.stdout!.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); accept(stdout + `\nexit=${code}\n` + stderr.slice(-2000)); });
  });
  const line = output.split('\n').find(value => value.startsWith('DRIVING-SMOKE '));
  assert.ok(line, `the smoke script reported: ${output}`);
  const result = JSON.parse(line!.slice('DRIVING-SMOKE '.length));
  assert.equal(result.timeout, undefined);
  assert.equal(result.driver, '1');
  assert.equal(result.windows, 1);
  assert.equal(result.alwaysOnTop, true);
  assert.equal(result.focusable, false);
  assert.equal(result.visible, true);
  assert.equal(result.bounds.width, 560);
  assert.equal(result.bounds.height, 40);
  assert.equal(result.bounds.y, 0);
  assert.deepEqual(result.afterStop, ['session.stop']);
  assert.equal(result.sameWindow, true);
  assert.deepEqual([...new Set(result.afterPaused.slice(1))].sort(), ['session.resume', 'session.stop']);
  assert.equal(result.stillOnPage, true);
  assert.equal(result.closed, true);
});

test('the strip names the stop key of this system, and Stop goes straight to the worker channel', async () => {
  const s = setup();
  const sent: unknown[] = [];
  (s.engine.worker as any).connected = true;
  (s.engine.worker as any).send = (message: unknown, done?: () => void) => { sent.push(message); done?.(); return true; };
  for (const tick of s.ticks) tick();
  s.send({ kind: 'driving-status', state: 'driving', active: true, stopKey: 'Control Option F15' });
  const strip = s.windows.at(-1)!;
  assert.match(html(strip.urls.at(-1)!), /Chausar is driving\. Control Option F15 to stop\./);
  s.handle.drivingMenuItems()[0].click();
  await flush();
  assert.deepEqual(sent, [{ kind: 'driving-control', action: 'stop' }]);
  assert.deepEqual(s.engine.calls, [], 'a busy engine is never asked');
  s.restore();
});
