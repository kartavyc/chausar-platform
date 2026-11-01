'use strict';
// Chausar desktop (wave 6, package 6F3, DECISIONS D32): the hidden window that reads a page needing JavaScript. The
// engine worker asks over its own channel (engine-harness.cjs 'render') only after its own checks: the fetch policy,
// robots.txt and the per-site pace (platform/runtime/venture/web/reader.ts). Here the page opens in a window that is
// never shown, sandboxed, in its own in-memory session that asks as Chausar (its own user agent, nothing else), grants
// no permission, takes no download and opens no popup. Every request is checked before it goes: http or https only, no
// name or password in the address, never an address inside this computer or its network (by its literal form and by a
// lookup of its name), never a site whose terms bar automated reading, and no navigation to another site. After the
// page settles its HTML is taken, the window is destroyed and the session's cookies and storage are cleared, so nothing
// carries over to the next read. The HTML goes back to the engine, which reads it as untrusted words. Chromium does its
// own name lookup, so the name check here is a second line; the engine's network guard stays the first.
// Written for Chausar from Electron's documented API.
const { isIP } = require('node:net');
const { lookup: dnsLookup } = require('node:dns/promises');

/** The session the reading window uses: in memory (no persist: prefix), cleared after every read. */
const RENDER_PARTITION = 'chausar-web-read';
const MAX_HTML = 2 * 1024 * 1024;
const MIN_TIMEOUT = 5_000, MAX_TIMEOUT = 30_000;
const USER_AGENT = 'Chausar/1.0 (+https://www.chausar.co.in)';

/** Whether a literal IPv4 address is private, loopback, link-local, shared, reserved or multicast. */
function privateV4(address) {
  const [a, b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 168 || b === 0)) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
/** Whether a literal IPv6 address is unspecified, loopback, unique-local, link-local, multicast or maps a private IPv4. */
function privateV6(address) {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return privateV4(mapped[1]);
  if (/^::ffff:/.test(lower)) return true;
  return /^(fc|fd|fe[89ab]|ff)/.test(lower) || lower.startsWith('64:ff9b:') || lower.startsWith('2001:db8:');
}
function privateAddress(address) {
  const kind = isIP(address);
  return kind === 4 ? privateV4(address) : kind === 6 ? privateV6(address) : true;
}

/**
 * Whether one request from the reading window may go. rule: { origin, blockedHosts, lookup }. The page itself may not
 * leave its own site; data and blob addresses the page made stay inside it.
 */
async function requestAllowed(details, rule) {
  let url;
  try { url = new URL(String(details.url)); } catch { return false; }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return details.resourceType !== 'mainFrame';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (rule.blockedHosts.some(name => host === name || host.endsWith(`.${name}`))) return false;
  if (details.resourceType === 'mainFrame' && url.origin !== rule.origin) return false;
  if (isIP(host)) return !privateAddress(host);
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.')) return false;
  try {
    const found = await rule.lookup(host);
    const list = Array.isArray(found) ? found : [found];
    return list.length > 0 && list.every(item => item && typeof item.address === 'string' && !privateAddress(item.address));
  } catch { return false; }
}

/** The request as the harness passed it, or null: an http or https address, a deadline, the barred hosts. */
function renderRequest(input) {
  if (!input || typeof input !== 'object' || typeof input.url !== 'string' || input.url.length > 2048 || !Array.isArray(input.blockedHosts)) return null;
  let url;
  try { url = new URL(input.url); } catch { return null; }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) return null;
  if (!input.blockedHosts.every(host => typeof host === 'string' && /^[a-z0-9.-]{1,253}$/.test(host))) return null;
  const timeoutMs = Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, Number(input.timeoutMs) || MAX_TIMEOUT));
  return { url: url.href, origin: url.origin, timeoutMs, blockedHosts: [...input.blockedHosts] };
}

/** The reading session, set up once: Chausar's own user agent, no permission, no download, every request checked. */
const prepared = new WeakMap();
function renderSession(session, deps) {
  const chosen = session.fromPartition(RENDER_PARTITION);
  if (!prepared.has(chosen)) {
    const state = { rule: null };
    chosen.setUserAgent(deps.userAgent ?? USER_AGENT);
    chosen.webRequest.onBeforeRequest((details, callback) => {
      const rule = state.rule;
      if (!rule) { callback({ cancel: true }); return; }
      requestAllowed(details, rule).then(allowed => callback({ cancel: !allowed }), () => callback({ cancel: true }));
    });
    chosen.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    chosen.setPermissionCheckHandler(() => false);
    chosen.on('will-download', event => event.preventDefault());
    prepared.set(chosen, state);
  }
  return { chosen, state: prepared.get(chosen) };
}

const later = ms => new Promise(done => setTimeout(done, ms));

/** One read at a time: the session's request rule belongs to the page being read. */
let queue = Promise.resolve();

/**
 * Opens one page with JavaScript and answers { ok: true, html, finalUrl } or { ok: false, reason: 'refused' | 'failed' |
 * 'timeout' }. deps: Electron's BrowserWindow and session; lookup, settleMs and userAgent for tests.
 */
function renderPage(input, deps) {
  const request = renderRequest(input);
  if (!request) return Promise.resolve({ ok: false, reason: 'refused' });
  const run = queue.then(() => readOnce(request, deps));
  queue = run.then(() => undefined, () => undefined);
  return run;
}

async function readOnce(request, deps) {
  const { chosen, state } = renderSession(deps.session, deps);
  state.rule = { origin: request.origin, blockedHosts: request.blockedHosts, lookup: deps.lookup ?? (host => dnsLookup(host, { all: true })) };
  const settleMs = deps.settleMs ?? 1500;
  let window = null, timer = null;
  try {
    window = new deps.BrowserWindow({
      show: false, width: 1280, height: 900, paintWhenInitiallyHidden: true,
      webPreferences: { session: chosen, javascript: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, images: false, spellcheck: false, webgl: false, backgroundThrottling: false, autoplayPolicy: 'document-user-activation-required' },
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), request.timeoutMs); });
    const work = (async () => {
      await window.loadURL(request.url, { userAgent: deps.userAgent ?? USER_AGENT });
      // After the first load the page may not navigate anywhere.
      window.webContents.on('will-navigate', event => event.preventDefault());
      if (settleMs > 0) await later(settleMs);
      const html = await window.webContents.executeJavaScript('document.documentElement ? document.documentElement.outerHTML : ""', true);
      return { html: typeof html === 'string' ? html : '', finalUrl: String(window.webContents.getURL() || request.url) };
    })();
    const done = await Promise.race([work, timeout]);
    if (done === 'timeout') { work.catch(() => undefined); return { ok: false, reason: 'timeout' }; }
    if (!done.html || done.html.length > MAX_HTML) return { ok: false, reason: 'failed' };
    return { ok: true, html: done.html, finalUrl: done.finalUrl };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    if (timer) clearTimeout(timer);
    try { if (window && !window.isDestroyed()) window.destroy(); } catch { /* already gone */ }
    state.rule = null;
    try { await chosen.clearStorageData(); } catch { /* nothing kept to clear */ }
  }
}

module.exports = Object.freeze({ renderPage, requestAllowed, RENDER_PARTITION, USER_AGENT });
