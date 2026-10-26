// A small headless Chrome driver over the DevTools protocol, for the Ink screenshot walk (scripts/ui-shots/walk.mjs).
// One Browser is one Chrome process with its own profile folder and its own debugging port, so walks never share a
// browser. No dependency beyond Node 24 (fetch and WebSocket are built in).

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Where Chrome usually is, by platform. `--chrome=<path>` or CHROME_PATH wins over all of these. */
const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChrome(asked) {
  const path = asked || process.env.CHROME_PATH || CANDIDATES.find((candidate) => candidate && existsSync(candidate));
  if (!path || !existsSync(path)) throw new Error('Chrome was not found. Pass --chrome=<path to chrome> or set CHROME_PATH.');
  return path;
}

export class Browser {
  /** @param {{ chrome: string, port: number, profiles: string }} options */
  constructor({ chrome, port, profiles }) {
    this.chrome = chrome;
    this.port = port;
    this.profile = join(profiles, `chrome-${port}`);
    this.process = null;
    this.ws = null;
    this.nextId = 0;
    this.waiting = new Map();
    this.listeners = new Set();
  }

  async start() {
    rmSync(this.profile, { recursive: true, force: true });
    mkdirSync(this.profile, { recursive: true });
    this.process = spawn(this.chrome, [
      '--headless=new', `--remote-debugging-port=${this.port}`, `--user-data-dir=${this.profile}`,
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-extensions',
      '--force-color-profile=srgb', '--font-render-hinting=none', 'about:blank',
    ], { stdio: 'ignore' });
    let targets;
    for (let i = 0; i < 100 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${this.port}/json`)).json(); } catch { await sleep(150); }
    }
    if (!targets) throw new Error(`Chrome did not start on port ${this.port}`);
    const page = targets.find((t) => t.type === 'page');
    this.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { this.ws.addEventListener('open', resolve); this.ws.addEventListener('error', reject); });
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.waiting.has(message.id)) {
        const { resolve, reject } = this.waiting.get(message.id);
        this.waiting.delete(message.id);
        if (message.error) reject(new Error(`${message.error.message} (${message.error.code})`));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners) listener(message);
      }
    });
    await this.send('Page.enable');
    await this.send('Runtime.enable');
    return this;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.waiting.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  /** Runs an expression in the page and returns its value (awaiting a promise). Throws on an exception in the page. */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
      throw new Error(`in the page: ${detail}`);
    }
    return result.result?.value;
  }

  async viewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }

  async theme(dark) {
    await this.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  }

  /** The computer's languages as the page reads them (navigator.languages, Accept-Language), for pages loaded after
   *  this: the app picks Hindi from them itself (main.tsx, pickLanguage), as it would on a computer set to Hindi. */
  async languages(list) {
    if (!this.userAgent) this.userAgent = (await this.send('Browser.getVersion')).userAgent;
    await this.send('Emulation.setUserAgentOverride', { userAgent: this.userAgent, acceptLanguage: list });
  }

  /** A clock that reads `iso` when each page loaded after this starts, then runs on (null: the real clock again). The
   *  fake engine dates everything from `new Date()`, so a case can see what shows on a later day. */
  async clock(iso) {
    if (this.clockScript) {
      await this.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.clockScript });
      this.clockScript = null;
    }
    if (!iso) return;
    const source = `(() => {
      const Real = Date, shift = Real.parse(${JSON.stringify(iso)}) - Real.now();
      class Shifted extends Real { constructor(...a) { if (a.length) super(...a); else super(Real.now() + shift); } static now() { return Real.now() + shift; } }
      globalThis.Date = Shifted;
    })();`;
    this.clockScript = (await this.send('Page.addScriptToEvaluateOnNewDocument', { source })).identifier;
  }

  /** Loads a page afresh and waits for its load event. It passes through about:blank first: an address that differs
   *  from the last only after its # would otherwise move inside the old page and keep its state (the fake engine's
   *  decisions, the focus). */
  async go(url) {
    for (const address of ['about:blank', url]) {
      const loaded = new Promise((resolve) => {
        const off = this.on((message) => { if (message.method === 'Page.loadEventFired') { off(); resolve(); } });
        setTimeout(() => { off(); resolve(); }, 15000);
      });
      await this.send('Page.navigate', { url: address });
      await loaded;
    }
  }

  /** A real mouse click at the middle of an element the page finds with `finder` (an expression that yields it). */
  async click(finder, what) {
    const box = await this.evaluate(`(() => {
      const el = (${finder});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!box || !box.w || !box.h) throw new Error(`nothing to click: ${what}`);
    await sleep(80);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
    }
  }

  /** A real key press: a printable character, or a named key (Escape, Enter, Tab). */
  async key(key) {
    const named = { Escape: 27, Enter: 13, Tab: 9 };
    const code = named[key] ?? key.toUpperCase().charCodeAt(0);
    const text = named[key] ? (key === 'Enter' ? '\r' : undefined) : key;
    const codeName = named[key] ? key : `Key${key.toUpperCase()}`;
    await this.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code: codeName, windowsVirtualKeyCode: code, ...(text ? { text } : {}) });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: codeName, windowsVirtualKeyCode: code });
  }

  async screenshot(width, height) {
    const shot = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return Buffer.from(shot.data, 'base64');
  }

  async stop() {
    // Chrome may close its socket before it answers; never wait on that answer alone.
    try { await Promise.race([this.send('Browser.close'), sleep(2000)]); } catch { /* already gone */ }
    try { this.ws?.close(); } catch { /* closed */ }
    const proc = this.process;
    if (proc && proc.exitCode === null) {
      await Promise.race([new Promise((resolve) => proc.once('exit', resolve)), sleep(5000)]);
      if (proc.exitCode === null) { try { proc.kill(); } catch { /* gone */ } await sleep(500); }
    }
    // Chrome holds its profile files until it has exited; retry the removal a little.
    try { rmSync(this.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left for the next run */ }
  }
}
