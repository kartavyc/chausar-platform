// Actual main/helper source with authored Electron/filesystem ports. This is
// receipt contract evidence; no Electron, provider or native process is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const mainUrl = new URL('../../app/desktop/main.cjs', import.meta.url);
const helperSource = await readFile(new URL('../../app/desktop/preview-lifecycle.cjs', import.meta.url), 'utf8');
const desktopRequire = createRequire(mainUrl);
const flush = () => new Promise<void>(accept => setImmediate(accept));
function fixture() {
  const root = path.resolve('synthetic-observer-profile');
  const profile = Object.freeze({ root, userData: path.join(root, 'userData'), sessionData: path.join(root, 'sessionData'), vaults: path.join(root, 'userData', 'vaults') });
  const writes = new Map<string, any>(), reads: string[] = [], links = new Set<string>(), publications: any[] = [];
  const fakeFs = {
    lstatSync(file: string) { reads.push(file); return { isDirectory: () => true, isSymbolicLink: () => links.has(file) }; },
    realpathSync(file: string) { return file; },
    writeFileSync(file: string, bytes: string, options: any) { assert.equal(options.flag, 'wx'); assert.equal(options.mode, 0o600); if (writes.has(file)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); writes.set(file, JSON.parse(bytes)); },
    linkSync(source: string, destination: string) { assert.equal(source.endsWith('.tmp'), true); assert.ok(writes.get(source)?.state); publications.push({ complete: writes.has(source), destinationAbsent: !writes.has(destination), source, destination }); if (writes.has(destination)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); writes.set(destination, writes.get(source)); },
    unlinkSync(file: string) { assert.equal(file.endsWith('.tmp'), true); assert.equal(writes.delete(file), true); },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(helperSource, { module, require(name: string) { if (name === 'node:fs') return fakeFs; if (name === 'node:path') return path; throw new Error(`Unexpected require: ${name}`); }, process: { env: {}, pid: 701 } });
  const metadata = { chausarPreview: true, chausarSourceCommit: 'a'.repeat(40), chausarSourceTree: 'b'.repeat(40), version: '0.1.0-test' };
  const environment = { CHAUSAR_PREVIEW_OBSERVER_NONCE: 'c'.repeat(32) };
  return { profile, writes, reads, links, publications, metadata, environment, module,
    create: (options: Record<string, unknown> = {}) => module.exports.createPreviewLifecycle({ metadata, profile, environment, pid: 701, ...options }) };
}
test('production and nonce-free preview keep the observer inactive', () => {
  const f = fixture(); assert.equal(f.create({ metadata: {} }), undefined); assert.equal(f.create({ environment: {} }), undefined);
  assert.equal(f.reads.length, 0); assert.equal(f.writes.size, 0);
});
test('invalid source/nonce/PID or unfrozen binding cannot establish an observer', () => {
  const f = fixture(); assert.throws(() => f.create({ environment: { CHAUSAR_PREVIEW_OBSERVER_NONCE: '../bad' } }), /identity/);
  assert.throws(() => f.create({ pid: -1 }), /identity/); assert.throws(() => f.create({ metadata: { ...f.metadata, chausarSourceTree: 'unknown' } }), /identity/);
  assert.throws(() => f.create({ profile: { ...f.profile } }), /bound/); assert.equal(f.writes.size, 0);
});
test('ready observes the engine and shown window and writes the pinned identity once', () => {
  const f = fixture(), observer = f.create();
  assert.throws(() => observer.ready({ engineState: 'starting', windowVisible: true }), /ready/);
  assert.throws(() => observer.ready({ engineState: 'ready', windowVisible: false }), /ready/); assert.equal(f.writes.size, 0);
  observer.ready({ engineState: 'ready', windowVisible: true }); observer.ready({ engineState: 'ready', windowVisible: true });
  const receipt = f.writes.get(path.join(f.profile.root, 'preview-ready.json'));
  assert.equal(f.writes.size, 1); assert.equal(receipt.pid, 701); assert.equal(receipt.nonce, f.environment.CHAUSAR_PREVIEW_OBSERVER_NONCE);
  assert.equal(receipt.sourceCommit, f.metadata.chausarSourceCommit); assert.equal(receipt.sourceTree, f.metadata.chausarSourceTree);
  assert.equal(receipt.profileRoot, f.profile.root); assert.equal(receipt.userData, f.profile.userData); assert.equal(receipt.sessionData, f.profile.sessionData); assert.equal(receipt.vaults, f.profile.vaults);
  assert.equal(f.publications.length, 1); assert.equal(f.publications[0].complete, true); assert.equal(f.publications[0].destinationAbsent, true); assert.equal(f.publications[0].destination, path.join(f.profile.root, 'preview-ready.json'));
});
test('linked profiles and occupied receipt files refuse without overwrite', () => {
  const f = fixture(), observer = f.create(); f.links.add(f.profile.sessionData);
  assert.throws(() => observer.ready({ engineState: 'ready', windowVisible: true }), /changed/); assert.equal(f.writes.size, 0);
  f.links.clear(); const marker = path.join(f.profile.root, 'preview-ready.json'); f.writes.set(marker, { retained: true });
  assert.throws(() => observer.ready({ engineState: 'ready', windowVisible: true }), /EEXIST/); assert.deepEqual(f.writes.get(marker), { retained: true });
  assert.equal(f.writes.size, 1); assert.equal(f.publications[0].destinationAbsent, false);
});
test('graceful shutdown requires the observed Engine result; forced/missing/errors cannot inherit it', () => {
  for (const [engineResult, errors, graceful] of [
    [{ graceful: true, forced: false, exitCode: 0 }, [], true],
    [{ graceful: false, forced: true, exitCode: 1 }, [], false],
    [{ graceful: true, forced: false }, [], false],
    [undefined, [], false],
    [{ graceful: true, forced: false, exitCode: 0 }, ['ENGINE_STOP_FAILED'], false],
  ] as const) {
    const f = fixture(), observer = f.create(); observer.stopped({ engineResult, errors: [...errors] });
    const receipt = f.writes.get(path.join(f.profile.root, 'preview-stopped.json'));
    assert.equal(receipt.graceful, graceful); assert.equal(receipt.readyObserved, false); assert.equal(receipt.nativeAccepted, undefined);
    assert.equal(f.publications[0].complete, true); assert.equal(f.publications[0].destinationAbsent, true);
    assert.throws(() => observer.stopped({ engineResult, errors: [] }), /single/);
  }
});
async function mainFixture(stopResult: any = { graceful: true, forced: false, exitCode: 0 }, stopFails = false, observerActive = true) {
  const f = fixture(), windows: any[] = [], events: string[] = [], errors: string[] = [];
  const app = new EventEmitter() as any; app.isPackaged = true; app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve();
  app.getPath = (name: string) => f.profile[name as 'userData' | 'sessionData']; app.quit = () => { events.push('quit'); };
  class Window extends EventEmitter {
    visible = false; webContents = new EventEmitter() as any;
    constructor() { super(); this.webContents.setWindowOpenHandler = () => {}; this.webContents.send = () => {}; windows.push(this); }
    show() { this.visible = true; events.push('shown'); } isVisible() { return this.visible; } isDestroyed() { return false; } loadURL() {}
  }
  class Harness extends EventEmitter {
    state = 'starting';
    async start() { this.state = 'ready'; events.push('engine-ready'); }
    async updateJobLifecycle() { return { applied: true }; }
    async stop() { events.push('engine-stop'); if (stopFails) throw new Error('Synthetic stop failure.'); return stopResult; }
  }
  const electron = { app, BrowserWindow: Window, ipcMain: { handle() {} }, protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    session: { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } },
    dialog: { showErrorBox(_title: string, message: string) { errors.push(message); } }, powerMonitor: new EventEmitter() };
  vm.runInNewContext(await readFile(mainUrl, 'utf8'), { __dirname: path.resolve('synthetic-observer-app/app/desktop'), require(name: string) {
    if (name === 'electron') return electron;
    if (name === '../../package.json') return f.metadata;
    if (name === './demo-profile.cjs') return { bindDemoProfile: () => f.profile, assertDemoProfile: () => { events.push('profile-checked'); } };
    if (name === './preview-lifecycle.cjs') { assert.equal(observerActive, true); events.push('observer-loaded'); return f.module.exports; }
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === 'node:fs/promises') return { readFile: async () => JSON.stringify(f.metadata) };
    return desktopRequire(name);
  }, process: { argv: ['synthetic-electron', '--demo', '--ui-preview'], env: observerActive ? f.environment : {}, pid: 701, resourcesPath: path.resolve('synthetic-observer-app/resources') }, console: { error() {} }, URL, Response, Buffer });
  await flush(); return { ...f, app, windows, events, errors };
}
test('actual main publishes ready only after Engine start, ready-to-show and visible window', async () => {
  const f = await mainFixture(); assert.equal(f.writes.size, 0); assert.equal(f.windows.length, 1);
  f.windows[0].emit('ready-to-show'); assert.equal(f.errors.length, 0);
  assert.ok(f.events.indexOf('engine-ready') < f.events.indexOf('shown')); assert.equal(f.writes.get(path.join(f.profile.root, 'preview-ready.json')).windowVisible, true);
  f.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(f.writes.get(path.join(f.profile.root, 'preview-stopped.json')).graceful, true); assert.ok(f.events.indexOf('engine-stop') < f.events.indexOf('quit'));
});
test('actual main retains forced and failed Engine shutdown classifications', async () => {
  const forced = await mainFixture({ graceful: false, forced: true, exitCode: 1 }); forced.app.emit('before-quit', { preventDefault() {} }); await flush();
  const forcedReceipt = forced.writes.get(path.join(forced.profile.root, 'preview-stopped.json')); assert.equal(forcedReceipt.forced, true); assert.equal(forcedReceipt.graceful, false);
  const failed = await mainFixture(undefined, true); failed.app.emit('before-quit', { preventDefault() {} }); await flush();
  const failedReceipt = failed.writes.get(path.join(failed.profile.root, 'preview-stopped.json')); assert.equal(failedReceipt.graceful, false); assert.deepEqual(failedReceipt.errors, ['ENGINE_STOP_FAILED']);
});
test('actual nonce-free main never loads observer or writes receipts', async () => {
  const f = await mainFixture(undefined, false, false); f.windows[0].emit('ready-to-show'); f.app.emit('before-quit', { preventDefault() {} }); await flush();
  assert.equal(f.events.includes('observer-loaded'), false); assert.equal(f.writes.size, 0); assert.equal(f.events.at(-1), 'quit');
});
