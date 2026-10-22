// P6: checks P0's shell wiring for the venture launcher: the link opener in the IPC contract, main process and
// preload, the web server's route for the Ink build's scripts, and the rule that server.ts and worker.ts never load
// host.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer, createServerEngine } from '../runtime/server.ts';
import { listInkFiles } from '../runtime/ui-ink.ts';
import { createWorkerEngine } from '../runtime/worker.ts';
import { EXTERNAL_ORIGINS } from '../runtime/venture/contracts.ts';
import type { PlanPreview, VentureView } from '../runtime/venture/contracts.ts';
import type { DesktopBridge } from '../../app/desktop/types.ts';

const require = createRequire(import.meta.url);
const ipc = require('../../app/desktop/ipc-contract.cjs');
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const TOKEN_LINK = 'https://github.com/settings/personal-access-tokens/new?name=Chausar%20read%20only&description=Lets%20Chausar%20read%20one%20app%20repo.%20Read%20only.&expires_in=90&contents=read&metadata=read&deployments=read&statuses=read&actions=read';
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected, error?.message); return true; };

// Compile-time only: the desktop types know every venture method, its payload and its result, and the link opener.
// The function is never called; the typecheck is the test.
async function typedBridge(bridge: DesktopBridge) {
  const preview: PlanPreview = await bridge.request('venture.preview', { idea: 'Monthly bookkeeping for cafes', countryCode: 'IN' });
  const view: VentureView | null = await bridge.request('venture.get');
  const countries = await bridge.request('venture.countries');
  await bridge.request('venture.events', { limit: 10 });
  // @ts-expect-error venture.create needs its payload
  await bridge.request('venture.create');
  // @ts-expect-error the idea must be text
  await bridge.request('venture.preview', { idea: 42, countryCode: 'IN' });
  await bridge.openExternal('https://lovable.dev/');
  return { preview, view, countries };
}
void typedBridge;

test('validateExternalUrl opens only one https partner link, with no credentials and a bounded length', () => {
  const lovable = `https://lovable.dev/#prompt=${encodeURIComponent('Build brief from Chausar. Business type: Bookkeeping studio.')}`;
  const replit = 'https://replit.com/?stack=Build&prompt=A4Jw9gtsAuQ&referrer=chausar';
  for (const url of [lovable, replit, TOKEN_LINK, 'https://razorpay.com/']) assert.equal(ipc.validateExternalUrl(url), new URL(url).href);
  const longest = `https://lovable.dev/#prompt=${'a'.repeat(30_000 - 'https://lovable.dev/#prompt='.length)}`;
  assert.equal(longest.length, 30_000);
  assert.equal(ipc.validateExternalUrl(longest), longest);
  const refused: [unknown, string][] = [
    ['http://lovable.dev/', 'INVALID_EXTERNAL_URL'],
    ['javascript:alert(1)', 'INVALID_EXTERNAL_URL'],
    ['https://owner:secret@lovable.dev/', 'INVALID_EXTERNAL_URL'],
    ['https://owner@lovable.dev/', 'INVALID_EXTERNAL_URL'],
    [`${longest}a`, 'INVALID_EXTERNAL_URL'],
    ['', 'INVALID_EXTERNAL_URL'],
    ['not a url', 'INVALID_EXTERNAL_URL'],
    [42, 'INVALID_EXTERNAL_URL'],
    [{ href: 'https://lovable.dev/' }, 'INVALID_EXTERNAL_URL'],
    ['https://example.com/', 'EXTERNAL_URL_NOT_ALLOWED'],
    ['https://lovable.dev.example.com/', 'EXTERNAL_URL_NOT_ALLOWED'],
    ['https://lovable.dev:8443/', 'EXTERNAL_URL_NOT_ALLOWED'],
    ['https://api.github.com/repos/a/b', 'EXTERNAL_URL_NOT_ALLOWED'],
  ];
  assert.equal(`${longest}a`.length, 30_001);
  for (const [input, expected] of refused) assert.throws(() => ipc.validateExternalUrl(input), code(expected), String(input).slice(0, 60));
});

test('the IPC contract carries the same partner origins as the venture contracts', () => {
  assert.deepEqual([...ipc.EXTERNAL_ORIGINS], [...EXTERNAL_ORIGINS]);
  assert.ok(Object.isFrozen(ipc.EXTERNAL_ORIGINS));
  assert.equal(ipc.OPEN_EXTERNAL_CHANNEL, 'chausar:open-external');
});

/** Runs main.cjs in a vm with an Electron mock, following the pattern in desktop-main.test.ts. */
async function desktop() {
  const windows: any[] = [], engines: any[] = [], handlers = new Map<string, any>(), errors: string[] = [], opened: string[] = [];
  const permissions: { request?: any; check?: any } = {};
  const app = new EventEmitter() as any; app.isPackaged = true; app.quits = 0;
  app.requestSingleInstanceLock = () => true; app.whenReady = () => Promise.resolve(); app.getPath = () => '/owned/app'; app.quit = () => { app.quits++; };
  class Window extends EventEmitter {
    webContents: any; options: any;
    constructor(options: any) { super(); this.options = options; this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' }; this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; }; this.webContents.send = () => {}; windows.push(this); }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; }
  }
  class Harness extends EventEmitter {
    state = 'ready'; options: any;
    constructor(options: any) { super(); this.options = options; engines.push(this); }
    async start() {} async request(method: string) { return { method }; }
    async updateJobLifecycle() { return { applied: true }; }
    async stop() { this.state = 'stopped'; return { graceful: true, forced: false }; }
  }
  class Tray extends EventEmitter { setToolTip() {} setContextMenu() {} destroy() {} }
  const session = { defaultSession: {
    setPermissionRequestHandler(handler: any) { permissions.request = handler; },
    setPermissionCheckHandler(handler: any) { permissions.check = handler; },
    webRequest: { onBeforeRequest() {} },
  } };
  const shell = { openExternal: async (url: string) => { opened.push(url); } };
  const electron = { app, BrowserWindow: Window, Tray, shell, powerMonitor: new EventEmitter(), Menu: { buildFromTemplate: (items: any) => items }, nativeImage: { createFromPath: () => ({ isEmpty: () => false }) }, protocol: { registerSchemesAsPrivileged() {}, handle() {} }, session, dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) }, ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler) } };
  const source = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { __dirname: '/owned/app/app/desktop', require: (name: string) => {
    if (name === 'electron') return electron;
    if (name === './engine-harness.cjs') return { EngineHarness: Harness };
    if (name === './ipc-contract.cjs') return require('../../app/desktop/ipc-contract.cjs');
    // readdir lists a one-page Ink build, so main.cjs finds app/ui/dist and opens its window.
    if (name === 'node:fs/promises') return { readFile: async (path: string) => path.endsWith('package.json') ? JSON.stringify({ chausarPreview: true, version: '2.3.4' }) : '', mkdir: async () => {}, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false }),
      readdir: async () => [{ name: 'index.html', isDirectory: () => false, isFile: () => true }] };
    return require(name);
  }, process: { argv: ['electron', '/owned/app'], env: {}, platform: 'win32', resourcesPath: '/owned/resources' }, console: { error() {} }, URL, Response, Buffer });
  await flush();
  return { windows, engines, handlers, errors, opened, permissions };
}

test('main.cjs opens an allowed link once for a trusted sender, refuses everything else, and allows 15 minutes per request', async () => {
  const d = await desktop();
  assert.deepEqual(d.errors, []);
  assert.equal(d.engines.length, 1);
  assert.equal(d.engines[0].options.requestTimeoutMs, 900_000);
  const handler = d.handlers.get('chausar:open-external');
  assert.equal(typeof handler, 'function');
  const window = d.windows[0];
  const trusted = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
  const url = 'https://replit.com/?stack=Build&prompt=A4Jw9gtsAuQ&referrer=chausar';
  // Replies are made inside the vm, so compare their JSON rather than their prototypes.
  assert.deepEqual(JSON.parse(JSON.stringify(await handler(trusted, url))), { ok: true });
  assert.deepEqual(d.opened, [url]);
  const untrusted = await handler({ sender: {}, senderFrame: window.webContents.mainFrame }, 'https://lovable.dev/');
  assert.equal(untrusted.ok, false); assert.equal(untrusted.error.code, 'UNTRUSTED_SENDER');
  for (const [input, expected] of [['http://lovable.dev/', 'INVALID_EXTERNAL_URL'], ['https://example.com/', 'EXTERNAL_URL_NOT_ALLOWED'], [42, 'INVALID_EXTERNAL_URL']] as const) {
    const reply = await handler(trusted, input);
    assert.equal(reply.ok, false); assert.equal(reply.error.code, expected);
  }
  assert.deepEqual(d.opened, [url], 'a refused link never reaches shell.openExternal');
});

test('main.cjs lets only the app window write to the clipboard and refuses every other permission', async () => {
  const d = await desktop();
  const window = d.windows[0];
  assert.equal(typeof d.permissions.check, 'function');
  assert.equal(typeof d.permissions.request, 'function');
  const asked = (contents: unknown, permission: string) => new Promise<boolean>(accept => d.permissions.request(contents, permission, accept));
  assert.equal(d.permissions.check(window.webContents, 'clipboard-sanitized-write'), true);
  assert.equal(await asked(window.webContents, 'clipboard-sanitized-write'), true);
  for (const permission of ['clipboard-read', 'media', 'notifications', 'geolocation', 'openExternal', 'fullscreen']) {
    assert.equal(d.permissions.check(window.webContents, permission), false, permission);
    assert.equal(await asked(window.webContents, permission), false, permission);
  }
  const stranger = new EventEmitter() as any; stranger.mainFrame = { url: 'chausar://app/index.html' };
  assert.equal(d.permissions.check(stranger, 'clipboard-sanitized-write'), false);
  assert.equal(d.permissions.check(null, 'clipboard-sanitized-write'), false);
  window.loadURL('https://example.com/');
  assert.equal(d.permissions.check(window.webContents, 'clipboard-sanitized-write'), false, 'only the trusted document');
  assert.equal(await asked(window.webContents, 'clipboard-sanitized-write'), false);
});

test('main.cjs keeps clipboard writes for the Ink page on a hash route, by the same rule as the IPC sender check', async () => {
  const d = await desktop();
  const window = d.windows[0];
  const asked = (contents: unknown, permission: string) => new Promise<boolean>(accept => d.permissions.request(contents, permission, accept));
  for (const url of ['chausar://app/index.html#/today', 'chausar://app/index.html#/money/invoices?sheet=receipt%3AR-0418']) {
    window.loadURL(url);
    assert.equal(d.permissions.check(window.webContents, 'clipboard-sanitized-write'), true, url);
    assert.equal(await asked(window.webContents, 'clipboard-sanitized-write'), true, url);
    assert.equal(d.permissions.check(window.webContents, 'clipboard-read'), false, url);
  }
  for (const url of ['chausar://app/index.html?x#/today', 'chausar://app/index.html#<script>', 'chausar://app/index.html#today', 'chausar://app/other.html#/today', 'https://example.com/#/today']) {
    window.loadURL(url);
    assert.equal(d.permissions.check(window.webContents, 'clipboard-sanitized-write'), false, url);
    assert.equal(await asked(window.webContents, 'clipboard-sanitized-write'), false, url);
  }
  // The one rule lives in the IPC contract, so the two checks can never drift apart.
  assert.equal(ipc.isTrustedDocument('chausar://app/index.html#/team'), true);
  assert.equal(ipc.isTrustedDocument('chausar://app/index.html?x#/team'), false);
  assert.equal(ipc.isTrustedDocument(undefined), false);
});

test('preload.cjs exposes openExternal, which invokes the open-external channel and rethrows coded failures', async () => {
  const exposed: Record<string, any> = {};
  const invocations: [string, unknown][] = [];
  let reply: unknown = { ok: true };
  const electron = {
    contextBridge: { exposeInMainWorld: (name: string, api: unknown) => { exposed[name] = api; } },
    ipcRenderer: { invoke: async (channel: string, value: unknown) => { invocations.push([channel, value]); return reply; }, on() {}, removeListener() {} },
  };
  const source = await readFile(new URL('../../app/desktop/preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(source, { require: (name: string) => { if (name === 'electron') return electron; throw new Error(`Unexpected require ${name}`); } });
  const bridge = exposed.chausar;
  assert.ok(bridge && Object.isFrozen(bridge));
  assert.equal(typeof bridge.openExternal, 'function');
  assert.equal(await bridge.openExternal('https://lovable.dev/#prompt=hello'), undefined);
  await bridge.openExternal(new URL('https://bolt.new/'));
  assert.deepEqual(invocations, [['chausar:open-external', 'https://lovable.dev/#prompt=hello'], ['chausar:open-external', 'https://bolt.new/']]);
  reply = { ok: false, error: { code: 'EXTERNAL_URL_NOT_ALLOWED', message: 'Chausar opens only its listed partner sites.' } };
  await assert.rejects(bridge.openExternal('https://example.com/'), (error: any) => {
    assert.equal(error.code, 'EXTERNAL_URL_NOT_ALLOWED'); assert.equal(error.message, 'Chausar opens only its listed partner sites.'); return true;
  });
  reply = undefined;
  await assert.rejects(bridge.openExternal('https://bolt.new/'), (error: any) => {
    assert.equal(error.code, 'REQUEST_FAILED'); assert.equal(error.message, 'The link could not be opened.'); return true;
  });
});

test('the local web server serves the Ink build\'s script as JavaScript under the same content security policy', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-shell-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  // A stand-in for app/ui/dist: one page and one hashed script, listed the way the entrypoint lists the real build.
  const folder = join(directory, 'ink'); await mkdir(join(folder, 'assets'), { recursive: true });
  const script = 'export const shell = "synthetic Ink script";\n';
  await writeFile(join(folder, 'index.html'), '<!doctype html><title>Chausar</title>'); await writeFile(join(folder, 'assets/index-abc.js'), script);
  const app = createLocalServer(engine, { ink: { folder, files: await listInkFiles(folder) } });
  const { origin } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await fetch(`${origin}/launch.js`)).status, 404, 'the old renderer\'s launch.js is gone');
  const response = await fetch(`${origin}/assets/index-abc.js`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const csp = response.headers.get('content-security-policy') ?? '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /default-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(await response.text(), script);
});

test('server.ts and worker.ts never load host.ts, and replay files need demo mode plus their own switch', async t => {
  for (const file of ['../runtime/server.ts', '../runtime/worker.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /venture\/host(?:\.ts|\.js)?['"`]/, `${file} must not import host.ts`);
    assert.match(source, /from '\.\/venture\/host-env\.ts'/, `${file} reads the venture options through host-env.ts`);
  }
  const directory = await mkdtemp(join(tmpdir(), 'chausar-venture-shell-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const replayFiles = { CHAUSAR_VENTURE_MODEL_REPLAY: 'platform/tests/fixtures/venture/demo/model-replay.json', CHAUSAR_VENTURE_GITHUB_REPLAY: 'platform/tests/fixtures/venture/e2e/github-sync.json' };
  const base = { CHAUSAR_VAULT_DIRECTORY: directory };
  const pending = { claudeCodeTerms: 'pending' };
  const replayed = { host: 'local-web', ...pending, modelReplayPath: replayFiles.CHAUSAR_VENTURE_MODEL_REPLAY, githubReplayPath: replayFiles.CHAUSAR_VENTURE_GITHUB_REPLAY };

  assert.deepEqual((await createServerEngine(base, ['--demo'])).options.venture, { host: 'local-web', ...pending });
  assert.deepEqual((await createServerEngine({ ...base, ...replayFiles }, ['--demo'])).options.venture, { host: 'local-web', ...pending });
  assert.deepEqual((await createServerEngine({ ...base, ...replayFiles, CHAUSAR_VENTURE_REPLAY: '1' }, ['--demo'])).options.venture, replayed);
  assert.deepEqual((await createServerEngine({ ...base, ...replayFiles }, ['--demo', '--replay'])).options.venture, replayed);
  assert.deepEqual((await createServerEngine({ ...base, ...replayFiles, CHAUSAR_VENTURE_REPLAY: '1' }, [])).options.venture, { host: 'local-web', ...pending }, 'never outside demo mode');

  const worker = { ...base, CHAUSAR_DEMO: '1' };
  assert.deepEqual((await createWorkerEngine({ ...worker, ...replayFiles })).options.venture, { host: 'desktop', ...pending });
  assert.deepEqual((await createWorkerEngine({ ...worker, ...replayFiles, CHAUSAR_VENTURE_REPLAY: '1' })).options.venture,
    { ...replayed, host: 'desktop' });
  assert.deepEqual((await createWorkerEngine({ ...base, ...replayFiles, CHAUSAR_VENTURE_REPLAY: '1', CHAUSAR_DEMO: '0' })).options.venture, { host: 'desktop', ...pending });
});
