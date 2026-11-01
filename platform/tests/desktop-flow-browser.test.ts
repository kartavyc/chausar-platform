// Wave 6 package 6H2 (D41): the desktop's browser window for recorded flows (app/desktop/flow-browser.cjs), the
// harness relay ('flows') and the engine worker's port (flows/port.ts). Page JavaScript is allowed in this window, so
// what keeps it safe is held here: its own in-memory session, no permission, download or popup, no navigation off the
// flow's site, every request that may send cancelled unless the engine pressed the approved submit, and recorded
// events taken only from console lines carrying the window's own token. Stubs, no Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import { processFlowPort } from '../runtime/venture/flows/port.ts';
import type { FlowTarget } from '../runtime/venture/flows/recipe.ts';

const require = createRequire(import.meta.url);
const { createFlowBrowser, fingerprintOf } = require('../../app/desktop/flow-browser.cjs');

type Page = (command: any) => unknown;
function electron(page: Page) {
  const windows: any[] = [];
  const sessions: any[] = [];
  class Window extends EventEmitter {
    options: any; destroyed = false; webContents: any; loaded: string[] = [];
    constructor(given: any) {
      super(); this.options = given; windows.push(this);
      const contents = new EventEmitter() as any;
      contents.setWindowOpenHandler = (handler: any) => { contents.open = handler; };
      contents.isLoading = () => false;
      contents.getURL = () => this.loaded.at(-1) ?? '';
      contents.executeJavaScriptInIsolatedWorld = async (world: number, [script]: { code: string }[]) => {
        assert.equal(world, 1007);
        const json = script.code.slice(script.code.lastIndexOf(')(') + 2, -1);
        return page(JSON.parse(json));
      };
      this.webContents = contents;
    }
    async loadURL(url: string) { this.loaded.push(url); this.webContents.emit('dom-ready'); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const session = {
    fromPartition(name: string) {
      const made: any = new EventEmitter();
      Object.assign(made, { name, filter: null, completed: null, permission: null, check: null, cleared: 0 });
      made.webRequest = { onBeforeRequest(handler: any) { made.filter = handler; }, onCompleted(handler: any) { made.completed = handler; } };
      made.setPermissionRequestHandler = (handler: any) => { made.permission = handler; };
      made.setPermissionCheckHandler = (handler: any) => { made.check = handler; };
      made.clearStorageData = async () => { made.cleared += 1; };
      sessions.push(made);
      return made;
    },
  };
  return { BrowserWindow: Window, session, windows, sessions };
}
const ask = (browser: any, runId: string, op: string, payload: unknown = {}) => new Promise<any>(resolve => browser.handle({ runId, op, payload }, resolve));
const request = (s: any, method: string, url: string, resourceType = 'xhr') => new Promise<boolean>(resolve => s.filter({ method, url, resourceType }, (r: any) => resolve(!r.cancel)));
const TARGET: FlowTarget = { candidates: [{ kind: 'id', value: 'save' }], fingerprint: 'f'.repeat(64), label: 'Save' };
const DESCRIPTOR = JSON.stringify(['button', 'submit', null, 'save', null, null, null, 'http://127.0.0.1:4100/save', true]);

test('the window allows page JavaScript but lives in its own in-memory session with no permission, download, popup or other site', async () => {
  const e = electron(command => (command.op === 'facts' ? { url: 'http://127.0.0.1:4100/form', title: 'Form', captcha: false } : { ok: true }));
  const browser = createFlowBrowser(e);
  const opened = await ask(browser, 'flowrun_1', 'open', { url: 'http://127.0.0.1:4100/form' });
  assert.deepEqual(opened, { ok: true, result: { url: 'http://127.0.0.1:4100/form', title: 'Form', captcha: false } });
  const [window] = e.windows;
  const prefs = window.options.webPreferences;
  assert.equal(prefs.javascript, true);
  assert.equal(prefs.sandbox, true);
  assert.equal(prefs.contextIsolation, true);
  assert.equal(prefs.nodeIntegration, false);
  assert.equal(prefs.devTools, false);
  const [s] = e.sessions;
  assert.match(s.name, /^chausar-flow-[0-9a-f-]{36}$/, 'in memory: no persist: prefix');
  let granted: boolean | null = null; s.permission(null, 'media', (value: boolean) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(s.check(), false);
  let prevented = false; s.emit('will-download', { preventDefault: () => { prevented = true; } }, { cancel() {} });
  assert.equal(prevented, true);
  assert.deepEqual(window.webContents.open(), { action: 'deny' });
  let stopped = false; window.webContents.emit('will-navigate', { url: 'https://elsewhere.example/', preventDefault: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.equal(await request(s, 'GET', 'https://elsewhere.example/', 'mainFrame'), false);
  assert.equal(await request(s, 'GET', 'https://cdn.example/app.js', 'script'), true, 'a plain read for the page is fine');
  assert.equal(await request(s, 'GET', 'http://user:pw@127.0.0.1:4100/x'), false);
  await ask(browser, 'flowrun_1', 'close');
  assert.equal(window.destroyed, true);
  assert.equal(s.cleared, 1);
});

test('nothing that may send leaves before the approved press, and then only to the flow\'s own site', async () => {
  let sends: any = null;
  const e = electron(command => {
    if (command.op === 'facts') return { url: 'http://127.0.0.1:4100/form', title: 'Form', captcha: false };
    if (command.op === 'click') { if (!command.approved) return { ok: false, reason: 'held' }; void sends?.(); return { ok: true }; }
    return { ok: true };
  });
  const browser = createFlowBrowser(e);
  await ask(browser, 'flowrun_2', 'open', { url: 'http://127.0.0.1:4100/form' });
  const [s] = e.sessions;
  assert.equal(await request(s, 'POST', 'http://127.0.0.1:4100/save'), false, 'an autosave or script send is cancelled');
  assert.deepEqual(await ask(browser, 'flowrun_2', 'click', { target: TARGET, approved: false }), { ok: false, code: 'FLOW_HELD' });
  const seen: boolean[] = [];
  sends = async () => {
    seen.push(await request(s, 'POST', 'https://elsewhere.example/collect'));
    seen.push(await request(s, 'POST', 'http://127.0.0.1:4100/save'));
    s.completed({ method: 'POST', statusCode: 200 });
  };
  const pressed = await ask(browser, 'flowrun_2', 'click', { target: TARGET, approved: true });
  assert.deepEqual(seen, [false, true]);
  assert.equal(pressed.ok, true);
  assert.equal(pressed.result.answered, true);
  assert.equal(await request(s, 'POST', 'http://127.0.0.1:4100/save'), false, 'the window closes again after the press');
  assert.deepEqual(await ask(browser, 'other_run', 'find', { target: TARGET }), { ok: false, code: 'FLOW_BROWSER_CLOSED' });
  await browser.close();
});

test('a recording takes only console lines with the window\'s token; a forged line is ignored; Done ends it', async () => {
  let token = '';
  const e = electron(command => { if (command.op === 'record') token = command.token; return { ok: true }; });
  const browser = createFlowBrowser(e);
  const done = ask(browser, 'rec_1', 'record', { url: 'http://127.0.0.1:4100/form' });
  await new Promise(resolve => setImmediate(resolve));
  const [window] = e.windows;
  assert.equal(window.options.webPreferences.javascript, true);
  assert.match(token, /^chausar-flow:[0-9a-f-]{36}:$/);
  const control = { tag: 'input', type: 'text', name: 'client', id: 'client', candidates: [{ kind: 'id', value: 'client' }], descriptor: '["input","text","client"]' };
  const say = (line: string) => window.webContents.emit('console-message', { message: line });
  say(`chausar-flow:forged:${JSON.stringify({ seq: 1, kind: 'input', control, value: 'forged' })}`);
  say(`${token}${JSON.stringify({ seq: 1, kind: 'input', control, value: 'Asha' })}`);
  const [s] = e.sessions;
  say(`${token}${JSON.stringify({ seq: 2, kind: 'click', control: { ...control, tag: 'button', descriptor: DESCRIPTOR } })}`);
  assert.equal(await request(s, 'POST', 'http://127.0.0.1:4100/save'), false, 'a press that tried to send while recording is cancelled');
  say(`${token}${JSON.stringify({ seq: 3, kind: 'done' })}`);
  const answer = await done;
  assert.equal(answer.ok, true);
  const events = answer.result.events;
  assert.deepEqual(events.map((item: any) => item.kind), ['open', 'input', 'submit'], 'the press that tried to send became a stop before a submit');
  assert.equal(events[1].value, 'Asha');
  assert.equal(events[1].control.fingerprint, fingerprintOf('["input","text","client"]'));
  assert.equal('descriptor' in events[1].control, false);
  assert.equal(window.destroyed, true);
});

test('the harness relays the worker\'s flow asks to main and answers once; the port checks what comes back', async () => {
  const sent: any[] = [];
  const child = Object.assign(new EventEmitter(), { connected: true, send: (value: any, callback?: Function) => { sent.push(value); callback?.(); return true; }, kill: () => {} });
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: (() => child) as any });
  const asked: any[] = [];
  harness.on('flows', (req: any, answer: Function) => { asked.push(req); answer({ ok: true, result: { count: 1, fingerprint: 'a'.repeat(64), submitLike: false, secret: false, filled: false } }); answer({ ok: false, code: 'FLOW_HELD' }); });
  const starting = harness.start(); child.emit('message', { ready: true }); await starting;
  try {
    const callId = '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12);
    child.emit('message', { kind: 'host-flows', callId, runId: 'flowrun_3', op: 'find', payload: { target: TARGET } });
    assert.deepEqual(asked, [{ runId: 'flowrun_3', op: 'find', payload: { target: TARGET } }]);
    const replies = sent.filter(item => item.kind === 'host-flows-result');
    assert.equal(replies.length, 1, 'answered once');
    assert.deepEqual(replies[0], { kind: 'host-flows-result', callId, ok: true, result: { count: 1, fingerprint: 'a'.repeat(64), submitLike: false, secret: false, filled: false } });
    child.emit('message', { kind: 'host-flows', callId: 'bad', runId: 'flowrun_3', op: 'find', payload: {} });
    child.emit('message', { kind: 'host-flows', callId: '1'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12), runId: 'x', op: 'eval', payload: {} });
    assert.equal(asked.length, 1, 'a bad ask never reaches main');
  } finally { child.emit('exit', 0, null); }

  // The worker's side: an answer it cannot read is a closed window, never a guess.
  const channel: any = new EventEmitter();
  channel.connected = true;
  channel.send = (message: any, callback?: Function) => { callback?.(null); setImmediate(() => channel.emit('message', reply(message))); return true; };
  let reply = (message: any): any => ({ kind: 'host-flows-result', callId: message.callId, ok: true, result: { count: 1, fingerprint: 'b'.repeat(64), submitLike: true, secret: false, filled: true } });
  const port = processFlowPort(channel);
  assert.deepEqual(await port.find('flowrun_4', TARGET), { count: 1, fingerprint: 'b'.repeat(64), submitLike: true, secret: false, filled: true });
  reply = message => ({ kind: 'host-flows-result', callId: message.callId, ok: true, result: { count: 'many' } });
  await assert.rejects(port.find('flowrun_4', TARGET), (error: any) => error.code === 'FLOW_BROWSER_CLOSED');
  reply = message => ({ kind: 'host-flows-result', callId: message.callId, ok: false, code: 'FLOW_HELD' });
  await assert.rejects(port.click('flowrun_4', TARGET, false), (error: any) => error.code === 'FLOW_HELD');
  reply = message => ({ kind: 'host-flows-result', callId: message.callId, ok: true, result: { events: [{ kind: 'open', url: 'http://127.0.0.1:4100/' }, { kind: 'input', control: { tag: 7 }, value: 'x' }] } });
  const recorded = await port.record('rec_2', 'http://127.0.0.1:4100/');
  assert.deepEqual(recorded.events, [{ kind: 'open', url: 'http://127.0.0.1:4100/' }], 'an event it cannot read is dropped');
});
