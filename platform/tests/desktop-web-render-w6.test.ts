// Wave 6 package 6F3 (D32): pages that need JavaScript are opened in a hidden Electron window on the desktop, and nowhere
// else. web-render.cjs opens one page in its own in-memory session as Chausar (its own user agent), with no permission,
// download or popup, no request to an address inside the computer or its network, no request to a site whose terms
// bar automated reading, and no navigation to another site; it gives back the page's HTML and clears the session. The
// harness relays the worker's ask to main and answers once; the engine's processRenderPort talks to it. Stubs, no Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import { processRenderPort } from '../runtime/venture/web/render-port.ts';
import { CHAUSAR_USER_AGENT } from '../runtime/venture/build/fetch-policy.ts';

const require = createRequire(import.meta.url);
const { renderPage, RENDER_PARTITION, requestAllowed, USER_AGENT } = require('../../app/desktop/web-render.cjs');
const PAGE = '<html><head><title>Guide</title></head><body><article><p>Drawn by script.</p></article></body></html>';

function electron(options: { html?: string; finalUrl?: string; load?: Error } = {}) {
  const windows: any[] = [];
  const sessions = new Map<string, any>();
  class Window extends EventEmitter {
    options: any; loaded: { url: string; options: any }[] = []; destroyed = false; webContents: any;
    constructor(given: any) {
      super(); this.options = given; windows.push(this);
      const contents = new EventEmitter() as any;
      contents.setWindowOpenHandler = (handler: any) => { contents.open = handler; };
      contents.executeJavaScript = async (code: string) => (/readyState/.test(code) ? 'complete' : options.html ?? PAGE);
      contents.getURL = () => options.finalUrl ?? this.loaded[0]?.url;
      this.webContents = contents;
    }
    async loadURL(url: string, given: any) { this.loaded.push({ url, options: given }); if (options.load) throw options.load; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const session = {
    fromPartition(name: string) {
      if (!sessions.has(name)) {
        const made: any = new EventEmitter();
        Object.assign(made, { name, filter: null, permission: null, check: null, agent: null, cleared: 0 });
        made.webRequest = { onBeforeRequest(handler: any) { made.filter = handler; } };
        made.setPermissionRequestHandler = (handler: any) => { made.permission = handler; };
        made.setPermissionCheckHandler = (handler: any) => { made.check = handler; };
        made.setUserAgent = (agent: string) => { made.agent = agent; };
        made.clearStorageData = async () => { made.cleared += 1; };
        sessions.set(name, made);
      }
      return sessions.get(name);
    },
  };
  return { BrowserWindow: Window, session, windows, sessions };
}
const publicDns = async (host: string) => (host === 'inside.example' ? [{ address: '10.0.0.5', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]);
const deps = (e: ReturnType<typeof electron>) => ({ ...e, lookup: publicDns, settleMs: 0, userAgent: CHAUSAR_USER_AGENT });

test('the page opens in a hidden sandboxed window with JavaScript, in its own in-memory session, as Chausar, and the window goes away', async () => {
  const e = electron();
  const result = await renderPage({ url: 'https://app.example/guide', timeoutMs: 10_000, blockedHosts: ['linkedin.com'] }, deps(e));
  assert.deepEqual(result, { ok: true, html: PAGE, finalUrl: 'https://app.example/guide' });
  const [window] = e.windows;
  assert.equal(window.options.show, false);
  const prefs = window.options.webPreferences;
  assert.deepEqual([prefs.javascript, prefs.sandbox, prefs.contextIsolation, prefs.nodeIntegration, prefs.webSecurity], [true, true, true, false, true]);
  const chosen = e.sessions.get(RENDER_PARTITION);
  assert.equal(prefs.session, chosen);
  assert.equal(RENDER_PARTITION.startsWith('persist:'), false);
  assert.equal(chosen.agent, CHAUSAR_USER_AGENT);
  assert.equal(USER_AGENT, CHAUSAR_USER_AGENT, 'the window asks under the same honest name as the engine');
  assert.equal(window.loaded[0].options.userAgent, CHAUSAR_USER_AGENT);
  assert.equal(window.webContents.open().action, 'deny');
  let denied: boolean | null = null; chosen.permission(null, 'geolocation', (allowed: boolean) => { denied = !allowed; });
  assert.equal(denied, true);
  assert.equal(chosen.check(), false);
  const download = { prevented: false, preventDefault() { this.prevented = true; } };
  chosen.emit('will-download', download, {}, {});
  assert.equal(download.prevented, true);
  assert.equal(window.destroyed, true);
  assert.ok(chosen.cleared >= 1, 'cookies and storage do not outlive the read');
});

test('requests: only http and https on public addresses, never a terms-barred site, and the page may not leave its own site', async () => {
  const rule = { origin: 'https://app.example', blockedHosts: ['linkedin.com', 'naukri.com'], lookup: publicDns };
  const allowed = (url: string, resourceType = 'script') => requestAllowed({ url, resourceType }, rule);
  assert.equal(await allowed('https://app.example/guide', 'mainFrame'), true);
  assert.equal(await allowed('https://cdn.example/app.js'), true);
  assert.equal(await allowed('data:image/png;base64,AAAA', 'image'), true);
  assert.equal(await allowed('https://other.example/next', 'mainFrame'), false, 'no navigation to another site');
  assert.equal(await allowed('https://www.linkedin.com/embed.js'), false);
  assert.equal(await allowed('http://127.0.0.1:5432/'), false);
  assert.equal(await allowed('http://[::1]/'), false);
  assert.equal(await allowed('https://inside.example/x'), false, 'a name that points inside the network');
  assert.equal(await allowed('file:///C:/Windows/win.ini'), false);
  assert.equal(await allowed('ws://app.example/socket'), false);
  assert.equal(await allowed('https://user:pw@app.example/'), false);
});

test('a bad address, a load that fails or a page too big answers failed or refused, and the window still goes away', async () => {
  const e = electron();
  assert.deepEqual(await renderPage({ url: 'file:///etc/passwd', timeoutMs: 10_000, blockedHosts: [] }, deps(e)), { ok: false, reason: 'refused' });
  assert.equal(e.windows.length, 0);
  const failing = electron({ load: new Error('ERR_NAME_NOT_RESOLVED') });
  assert.deepEqual(await renderPage({ url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: [] }, deps(failing)), { ok: false, reason: 'failed' });
  assert.equal(failing.windows[0].destroyed, true);
  const huge = electron({ html: 'x'.repeat(3 * 1024 * 1024) });
  assert.deepEqual(await renderPage({ url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: [] }, deps(huge)), { ok: false, reason: 'failed' });
});

class Child extends EventEmitter {
  connected = true; sent: any[] = [];
  send(value: any, callback: (error?: Error) => void) { this.sent.push(value); callback(); }
  disconnect() { this.connected = false; } kill() { return true; }
}
const RENDER_ID = '6f9619ff-8b86-4d01-b42d-00cf4fc964aa';

test("the harness passes the engine's render ask to main's one listener and answers the worker once", async () => {
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: () => child as any, startupTimeoutMs: 2000 });
  const start = harness.start(); child.emit('message', { ready: true }); await start;
  child.emit('message', { kind: 'host-render', renderId: RENDER_ID, url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: [] });
  assert.deepEqual(child.sent.at(-1), { kind: 'host-render-result', renderId: RENDER_ID, ok: false, reason: 'failed' });
  const asked: any[] = [];
  harness.on('render', (request: any, answer: (result: unknown) => void) => { asked.push(request); answer({ ok: true, html: PAGE, finalUrl: 'https://app.example/' }); answer({ ok: false, reason: 'failed' }); });
  child.emit('message', { kind: 'host-render', renderId: RENDER_ID, url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: ['linkedin.com'] });
  assert.deepEqual(asked, [{ url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: ['linkedin.com'] }]);
  assert.deepEqual(child.sent.filter(item => item.kind === 'host-render-result').slice(1), [{ kind: 'host-render-result', renderId: RENDER_ID, ok: true, html: PAGE, finalUrl: 'https://app.example/' }]);
  const before = child.sent.length;
  child.emit('message', { kind: 'host-render', renderId: 'nope', url: 'https://app.example/', timeoutMs: 10_000, blockedHosts: [] });
  assert.equal(child.sent.length, before, 'an ask without a proper id is ignored');
  child.emit('message', { kind: 'host-render', renderId: RENDER_ID, url: 'file:///x', timeoutMs: 10_000, blockedHosts: [] });
  assert.deepEqual(child.sent.at(-1), { kind: 'host-render-result', renderId: RENDER_ID, ok: false, reason: 'failed' });
  assert.equal(asked.length, 1);
});

test('the engine side sends one ask over the worker channel and reads one answer; no answer in time is a failure', async () => {
  const channel = new EventEmitter() as any;
  channel.connected = true; channel.sent = [] as any[];
  channel.send = (message: any, callback: (error: Error | null) => void) => { channel.sent.push(message); callback(null); return true; };
  const port = processRenderPort(channel, { timeoutMs: 50 });
  const pending = port.render({ url: 'https://app.example/', timeoutMs: 10_000 });
  const ask = channel.sent[0];
  assert.equal(ask.kind, 'host-render');
  assert.equal(ask.url, 'https://app.example/');
  assert.ok(ask.blockedHosts.includes('linkedin.com'));
  channel.emit('message', { kind: 'host-render-result', renderId: ask.renderId, ok: true, html: PAGE, finalUrl: 'https://app.example/' });
  assert.deepEqual(await pending, { ok: true, html: PAGE, finalUrl: 'https://app.example/' });
  assert.deepEqual(await port.render({ url: 'https://app.example/', timeoutMs: 10_000 }), { ok: false, reason: 'timeout' });
});
