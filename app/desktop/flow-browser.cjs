'use strict';
// Chausar desktop (wave 6, package 6H2, DECISIONS D41): the browser window for recorded flows. The engine worker asks
// over its own channel (engine-harness.cjs 'flows'; platform/runtime/venture/flows/port.ts); a renderer never can.
// Unlike the native-form window (owner-browser.cjs), page JavaScript is allowed here, because the owner records and
// replays ordinary modern sites. What keeps it safe instead:
// - One visible window at a time, in its own in-memory session (no persist: prefix), cleared when it closes. No
//   permission, no download, no popup, no navigation off the flow's own site, no name or password in an address.
// - Nothing leaves before the owner's approval: every request that is not a plain read (POST, PUT, PATCH, DELETE...)
//   is cancelled, unless the engine pressed the one submit the owner approved for this run, for a few seconds, and
//   only to the flow's own site. While recording, a submit is stopped and kept as a stop before the submit; a press
//   that tried to send is kept the same way.
// - Chausar's own page work runs in an isolated world the page cannot read (fixed operations below, no caller
//   JavaScript). It never reads the value of a password, card or code field: it only says whether one is filled.
// - Recorded events come back as console lines carrying a random token the page cannot know; any other line is ignored.
// Written for Chausar from Electron's documented API.
const { randomUUID, createHash } = require('node:crypto');

const WORLD = 1007;
const RECORD_MS = 30 * 60_000;
const ARM_MS = 10_000;
const WAIT_MS = 8_000;
const FIND_MS = 3_000;
const MAX_EVENTS = 500;
const READS = new Set(['GET', 'HEAD', 'OPTIONS']);
const failure = (code, message) => Object.assign(new Error(message || 'The flow window refused this.'), { code });
const fingerprintOf = descriptor => createHash('sha256').update(String(descriptor)).digest('hex');
const later = ms => new Promise(done => setTimeout(done, ms));

/**
 * Runs inside the page, in Chausar's isolated world, with one plain command. It uses nothing from outside itself.
 * ops: record (start the recorder, once per page), find, fill, click, facts, controls.
 */
function pageOp(command) {
  const doc = document;
  const text = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const attr = (el, name) => (el && el.getAttribute ? text(el.getAttribute(name) || '', 200) || null : null);
  const tagOf = el => String((el && el.tagName) || '').toLowerCase();
  const labelOf = el => {
    if (!el) return null;
    const own = el.labels && el.labels[0] ? text(el.labels[0].textContent, 120) : '';
    if (own) return own;
    const by = attr(el, 'aria-labelledby');
    const named = by ? doc.getElementById(by.split(' ')[0]) : null;
    return named ? text(named.textContent, 120) || null : null;
  };
  const buttonLike = el => tagOf(el) === 'button' || attr(el, 'role') === 'button' || (tagOf(el) === 'input' && ['submit', 'image', 'button', 'reset'].includes(String(el.type).toLowerCase()));
  const formOf = el => (el && (el.form || (el.closest && el.closest('form')))) || null;
  const secret = el => {
    const said = [el.name, el.id, labelOf(el), attr(el, 'aria-label')].filter(Boolean).join(' ');
    const auto = String(attr(el, 'autocomplete') || '').toLowerCase();
    return String(el.type).toLowerCase() === 'password' || /(?:^|\s)(?:cc-[a-z-]+|one-time-code|current-password|new-password)(?:$|\s)/.test(auto)
      || /password|passwd|passcode|\botp\b|one[\s_-]?time|verification[\s_-]?code|card[\s_-]?(?:number|no)\b|cardnumber|\bcvv\b|\bcvc\b|security[\s_-]?code|expiry|\bpin\b/i.test(said);
  };
  const submitLike = el => (buttonLike(el) && !!formOf(el)) || (tagOf(el) === 'input' && ['submit', 'image'].includes(String(el.type).toLowerCase()));
  const visible = el => {
    if (!el || el.hidden || el.type === 'hidden' || (el.closest && el.closest('[hidden],[aria-hidden="true"],[data-chausar-flow]'))) return false;
    const box = el.getBoundingClientRect ? el.getBoundingClientRect() : { width: 1, height: 1 };
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const describe = el => {
    const form = formOf(el);
    let action = null;
    try { const raw = (el.formAction && el.hasAttribute && el.hasAttribute('formaction')) ? el.formAction : form ? form.action : null; if (raw) { const u = new URL(raw, location.href); action = u.origin + u.pathname; } } catch { action = null; }
    const link = el.closest ? el.closest('a[href]') : null;
    const tag = tagOf(el);
    const type = el.getAttribute && el.getAttribute('type') ? String(el.type).toLowerCase() : tag === 'button' ? (form ? 'submit' : 'button') : tag === 'input' ? 'text' : null;
    const candidates = [];
    const id = attr(el, 'id'), name = attr(el, 'name'), testId = attr(el, 'data-testid'), aria = attr(el, 'aria-label'), label = labelOf(el);
    if (id && doc.querySelectorAll('[id="' + CSS.escape(id) + '"]').length === 1) candidates.push({ kind: 'id', value: id });
    if (name && ['input', 'select', 'textarea', 'button'].includes(tag)) candidates.push({ kind: 'name', value: name });
    if (testId) candidates.push({ kind: 'test-id', value: testId });
    if (aria) candidates.push({ kind: 'aria-label', value: aria });
    if (label) candidates.push({ kind: 'label', value: label });
    const words = buttonLike(el) ? text(el.textContent || el.value || '', 120) : '';
    return {
      tag, type, name, id, testId, ariaLabel: aria, labelText: label, autocomplete: attr(el, 'autocomplete'), role: attr(el, 'role'), inForm: !!form, formAction: action,
      text: words, href: link ? text(link.href, 2048) : null, candidates: candidates.slice(0, 6),
      descriptor: JSON.stringify([tag, type, name, id, testId, attr(el, 'autocomplete'), attr(el, 'role'), action, !!form]),
    };
  };
  const matches = candidate => {
    const value = String(candidate.value || '');
    let list = [];
    if (candidate.kind === 'id') list = Array.from(doc.querySelectorAll('[id="' + CSS.escape(value) + '"]'));
    else if (candidate.kind === 'name') list = Array.from(doc.querySelectorAll('[name="' + CSS.escape(value) + '"]'));
    else if (candidate.kind === 'test-id') list = Array.from(doc.querySelectorAll('[data-testid="' + CSS.escape(value) + '"]'));
    else if (candidate.kind === 'aria-label') list = Array.from(doc.querySelectorAll('[aria-label="' + CSS.escape(value) + '"]'));
    else if (candidate.kind === 'label') list = Array.from(doc.querySelectorAll('input,select,textarea')).filter(el => labelOf(el) === value);
    return list.filter(visible);
  };
  const resolve = target => {
    let most = 0;
    for (const candidate of (target && target.candidates) || []) {
      const found = matches(candidate);
      if (found.length === 1) return { el: found[0], count: 1 };
      most = Math.max(most, found.length);
    }
    return { el: null, count: most };
  };
  const shown = el => (String(el.type).toLowerCase() === 'checkbox' || String(el.type).toLowerCase() === 'radio' ? String(!!el.checked) : String(el.value));
  const op = command && command.op;
  if (op === 'find') {
    const { el, count } = resolve(command.target);
    if (!el) return { count, descriptor: null, submitLike: false, secret: false, filled: false };
    return { count: 1, descriptor: describe(el).descriptor, submitLike: submitLike(el), secret: secret(el), filled: typeof el.value === 'string' && el.value.length > 0 };
  }
  if (op === 'fill') {
    const { el } = resolve(command.target);
    if (!el || secret(el) || submitLike(el) || el.disabled || el.readOnly) return { ok: false };
    const kind = command.control;
    if (kind === 'checkbox') el.checked = command.value === 'true';
    else if (kind === 'select') { if (!Array.from(el.options || []).some(o => o.value === command.value && !o.disabled)) return { ok: false }; el.value = command.value; }
    else {
      const proto = tagOf(el) === 'textarea' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      el.focus(); setter.call(el, command.value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, shown: shown(el) };
  }
  if (op === 'click') {
    const { el } = resolve(command.target);
    if (!el) return { ok: false, reason: 'missing' };
    if (submitLike(el) && command.approved !== true) return { ok: false, reason: 'held' };
    el.click();
    return { ok: true };
  }
  if (op === 'facts') {
    const frames = Array.from(doc.querySelectorAll('iframe')).some(frame => /recaptcha|hcaptcha|turnstile|challenges\.cloudflare|arkoselabs|funcaptcha/i.test(frame.src || ''));
    const widgets = !!doc.querySelector('.g-recaptcha,.h-captcha,.cf-turnstile,[data-sitekey]');
    return { url: location.href, title: text(doc.title, 200), captcha: frames || widgets };
  }
  if (op === 'controls') {
    return Array.from(doc.querySelectorAll('input,select,textarea,button,[role="button"]')).filter(visible).slice(0, 40).map(el => {
      const d = describe(el);
      return { label: d.labelText || d.ariaLabel || d.text || d.name || d.id || 'Control', candidates: d.candidates, descriptor: d.descriptor };
    }).filter(item => item.candidates.length > 0);
  }
  if (op === 'record') {
    const scope = globalThis;
    if (scope.__chausarRecording) return { ok: true };
    scope.__chausarRecording = true;
    let seq = 0;
    const send = event => { seq += 1; console.log(command.token + JSON.stringify({ seq, ...event })); };
    const bar = doc.createElement('div');
    bar.setAttribute('data-chausar-flow', '1');
    bar.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:8px 12px;background:#0b0d0e;color:#fff;font:14px sans-serif;display:flex;gap:12px;align-items:center;');
    const line = doc.createElement('span');
    line.textContent = 'Chausar is recording. Passwords, card numbers and codes are never kept. A submit is stopped and asks you on each run.';
    const done = doc.createElement('button');
    done.textContent = 'Done';
    done.setAttribute('data-chausar-done', '1');
    done.addEventListener('click', event => { event.preventDefault(); event.stopImmediatePropagation(); send({ kind: 'done' }); }, true);
    bar.append(line, done);
    (doc.body || doc.documentElement).appendChild(bar);
    const controlOf = node => (node && node.closest ? node.closest('button,a[href],input,select,textarea,[role="button"]') : null);
    scope.addEventListener('change', event => {
      const el = event.target;
      if (!el || !['input', 'select', 'textarea'].includes(tagOf(el)) || (el.closest && el.closest('[data-chausar-flow]'))) return;
      const kind = String(el.type).toLowerCase();
      send({ kind: 'input', control: describe(el), value: secret(el) ? null : kind === 'checkbox' || kind === 'radio' ? String(!!el.checked) : String(el.value).slice(0, 2000) });
    }, true);
    scope.addEventListener('click', event => {
      const el = controlOf(event.target);
      if (!el || (el.closest && el.closest('[data-chausar-flow]'))) return;
      // A press that submits is recorded by the submit that follows, and stopped there.
      if (tagOf(el) !== 'a' && submitLike(el) && (tagOf(el) === 'input' || String(el.type).toLowerCase() === 'submit')) return;
      send({ kind: 'click', control: describe(el) });
    }, true);
    scope.addEventListener('submit', event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const form = event.target;
      const by = event.submitter || (form && form.querySelector ? form.querySelector('button[type="submit"],input[type="submit"],button:not([type])') : null);
      send({ kind: 'submit', control: describe(by || form) });
      line.textContent = 'Chausar stopped this submit. On each run it will stop here and ask you first.';
    }, true);
    return { ok: true };
  }
  return { ok: false };
}

/** The window for recorded flows. deps: Electron's BrowserWindow and session, and window() for the owner's window. */
function createFlowBrowser(deps) {
  let active = null;
  const sameSite = (url, origin) => { try { const u = new URL(url); return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === origin && !u.username && !u.password; } catch { return false; } };
  const run = async (s, command) => {
    if (!live(s)) throw failure('FLOW_BROWSER_CLOSED', 'The flow window closed.');
    return s.win.webContents.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${pageOp.toString()})(${JSON.stringify(command)})` }]);
  };
  const live = s => !!s && active === s && !!s.win && !s.win.isDestroyed();
  const current = runId => { if (!active || active.runId !== runId || !live(active)) throw failure('FLOW_BROWSER_CLOSED', 'The flow window for this run is not open.'); return active; };
  async function settled(s, ms) {
    const until = Date.now() + ms;
    while (live(s) && s.win.webContents.isLoading() && Date.now() < until) await later(50);
  }

  async function close(runId) {
    const s = active;
    if (!s || (runId && s.runId !== runId)) return;
    active = null;
    s.finish?.();
    try { if (s.win && !s.win.isDestroyed()) s.win.destroy(); } catch { /* already gone */ }
    try { s.ses.webRequest.onBeforeRequest(null); } catch { /* none set */ }
    try { await s.ses.clearStorageData(); } catch { /* nothing kept */ }
  }

  async function open(runId, url, mode) {
    if (typeof runId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(runId)) throw failure('FLOW_BROWSER_CLOSED', 'Choose a flow run.');
    let origin;
    try { const u = new URL(url); if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) throw new Error('scheme'); origin = u.origin; } catch { throw failure('FLOW_INVALID', 'Open a web address that starts with https.'); }
    await close();
    const ses = deps.session.fromPartition(`chausar-flow-${randomUUID()}`);
    const s = { runId, mode, origin, ses, win: null, events: [], token: `chausar-flow:${randomUUID()}:`, armedUntil: 0, sent: false, blocked: false, lastClick: null, finish: null, seen: 0 };
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (event, item) => { event.preventDefault(); try { item?.cancel(); } catch { /* none */ } });
    ses.webRequest.onBeforeRequest((details, callback) => {
      let u = null;
      try { u = new URL(details.url); } catch { callback({ cancel: true }); return; }
      if (u.username || u.password || !['http:', 'https:', 'data:', 'blob:'].includes(u.protocol)) { callback({ cancel: true }); return; }
      if (details.resourceType === 'mainFrame' && u.origin !== s.origin) { callback({ cancel: true }); return; }
      if (READS.has(String(details.method).toUpperCase())) { callback({ cancel: false }); return; }
      // A request that may send something: only the approved press, for a few seconds, to the flow's own site.
      if (s.mode === 'replay' && Date.now() < s.armedUntil && u.origin === s.origin) { s.sent = true; callback({ cancel: false }); return; }
      s.blocked = true;
      // While recording, a press that tried to send becomes a stop before a submit in place of a plain press.
      if (s.mode === 'record' && s.lastClick) {
        const last = s.events[s.events.length - 1];
        if (last?.kind === 'click' && last.control === s.lastClick) s.events.pop();
        s.events.push({ kind: 'submit', control: s.lastClick }); s.lastClick = null;
      }
      callback({ cancel: true });
    });
    ses.webRequest.onCompleted?.(details => { if (!READS.has(String(details.method).toUpperCase()) && details.statusCode >= 200 && details.statusCode < 400) s.answered = true; });
    const win = new deps.BrowserWindow({
      show: true, width: 1100, height: 820, minWidth: 390, minHeight: 400, title: mode === 'record' ? 'Chausar: recording a flow' : 'Chausar: running a flow', autoHideMenuBar: true,
      webPreferences: { session: ses, javascript: true, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, spellcheck: false, webgl: false, plugins: false, navigateOnDragDrop: false },
    });
    s.win = win;
    active = s;
    const wc = win.webContents;
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', event => { if (!sameSite(event.url, s.origin)) event.preventDefault(); });
    wc.on('will-frame-navigate', event => { if (event.isMainFrame && !sameSite(event.url, s.origin)) event.preventDefault(); });
    wc.on('render-process-gone', () => { void close(runId); });
    win.on('closed', () => { if (active === s) void close(runId); });
    wc.on('console-message', (event, _level, message) => {
      const line = typeof event?.message === 'string' ? event.message : message;
      if (typeof line !== 'string' || !line.startsWith(s.token) || s.events.length >= MAX_EVENTS) return;
      let parsed = null;
      try { parsed = JSON.parse(line.slice(s.token.length)); } catch { return; }
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.kind === 'done') { s.finish?.(); return; }
      if (!['input', 'click', 'submit'].includes(parsed.kind) || !parsed.control || typeof parsed.control.descriptor !== 'string') return;
      const { descriptor, ...control } = parsed.control;
      const event2 = { kind: parsed.kind, control: { ...control, fingerprint: fingerprintOf(descriptor) }, ...(parsed.kind === 'input' ? { value: typeof parsed.value === 'string' ? parsed.value.slice(0, 2000) : null } : {}) };
      s.lastClick = parsed.kind === 'click' ? event2.control : null;
      s.events.push(event2);
    });
    if (mode === 'record') wc.on('dom-ready', () => { if (live(s)) run(s, { op: 'record', token: s.token }).catch(() => undefined); });
    await win.loadURL(url);
    return s;
  }

  async function facts(s) {
    await settled(s, WAIT_MS);
    const found = await run(s, { op: 'facts' });
    return { url: String(found?.url ?? s.win.webContents.getURL()), title: String(found?.title ?? ''), captcha: found?.captcha === true };
  }

  async function find(s, target) {
    const until = Date.now() + FIND_MS;
    for (;;) {
      await settled(s, WAIT_MS);
      const found = await run(s, { op: 'find', target });
      const answer = { count: Number(found?.count) || 0, fingerprint: typeof found?.descriptor === 'string' ? fingerprintOf(found.descriptor) : null, submitLike: found?.submitLike === true, secret: found?.secret === true, filled: found?.filled === true };
      if (answer.count > 0 || Date.now() >= until) return answer;
      await later(150);
    }
  }

  const ops = {
    async record(runId, p) {
      const s = await open(runId, p.url, 'record');
      await new Promise(resolve => { const timer = setTimeout(resolve, RECORD_MS); s.finish = () => { clearTimeout(timer); s.finish = null; resolve(); }; });
      const events = [{ kind: 'open', url: p.url }, ...s.events];
      await close(runId);
      return { events };
    },
    async open(runId, p) { const s = await open(runId, p.url, 'replay'); return facts(s); },
    async find(runId, p) { return find(current(runId), p.target); },
    async fill(runId, p) {
      const s = current(runId);
      const done = await run(s, { op: 'fill', target: p.target, control: p.control, value: p.value });
      return { shown: done?.ok === true && typeof done.shown === 'string' ? done.shown : null };
    },
    async click(runId, p) {
      const s = current(runId);
      s.blocked = false; s.answered = false; s.sent = false;
      if (p.approved === true) s.armedUntil = Date.now() + ARM_MS;
      const done = await run(s, { op: 'click', target: p.target, approved: p.approved === true });
      if (done?.ok !== true) { s.armedUntil = 0; throw failure(done?.reason === 'held' ? 'FLOW_HELD' : 'FLOW_CHANGED', 'The press was refused.'); }
      const until = Date.now() + (p.approved === true ? WAIT_MS : 600);
      await later(150);
      while (live(s) && Date.now() < until && (s.win.webContents.isLoading() || (p.approved === true && !s.answered))) await later(100);
      s.armedUntil = 0;
      const page = await facts(s);
      return { facts: page, answered: s.answered === true, blocked: s.blocked === true };
    },
    async facts(runId) { return facts(current(runId)); },
    async controls(runId) {
      const list = await run(current(runId), { op: 'controls' });
      return (Array.isArray(list) ? list : []).slice(0, 40).map(item => ({ label: String(item.label).slice(0, 120), candidates: item.candidates, fingerprint: fingerprintOf(item.descriptor) }));
    },
    async close(runId) { await close(runId && runId !== 'all' ? runId : undefined); return { closed: true }; },
  };

  return {
    /** One request from the engine: { runId, op, payload }, answered once with { ok, result } or { ok: false, code }. */
    handle(request, answer) {
      const op = request && ops[request.op];
      if (!op || typeof request.runId !== 'string') { answer({ ok: false, code: 'FLOW_INVALID' }); return; }
      op(request.runId, request.payload || {}).then(result => answer({ ok: true, result }), error => answer({ ok: false, code: typeof error?.code === 'string' ? error.code : 'FLOW_BROWSER_CLOSED' }));
    },
    close: () => close(),
  };
}

module.exports = Object.freeze({ createFlowBrowser, pageOp, fingerprintOf });
