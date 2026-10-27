// Ink v2 wave 5, package 5A5 (P11): the desktop's print port for a report's PDF. report-print.cjs prints the report's
// HTML in a hidden window that runs no script, in a session that loads nothing else, and says 'font-missing' when the
// report has Hindi this computer cannot draw; engine-harness.cjs relays the worker's ask to main and answers once;
// the engine's processPrintPort talks to it over the worker channel. Stub BrowserWindow and webContents; no Electron.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EngineHarness } from '../../app/desktop/engine-harness.cjs';
import { processPrintPort } from '../runtime/venture/playbooks/kit/report/pdf.ts';

const require = createRequire(import.meta.url);
const { printReport, hasDevanagariFont, PRINT_PARTITION, PDF_OPTIONS } = require('../../app/desktop/report-print.cjs');
const HTML = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Report</title></head><body><main><h1>September</h1></main></body></html>\n';
const PDF = Buffer.from('%PDF-1.7\n%stub\n%%EOF\n');

/** Electron's BrowserWindow and session as report-print.cjs uses them, recording every call. */
function electron(options: { pdf?: Buffer | Error } = {}) {
  const windows: any[] = [];
  const sessions = new Map<string, any>();
  class Window extends EventEmitter {
    options: any; loaded: string[] = []; destroyed = false; webContents: any;
    constructor(given: any) {
      super(); this.options = given; windows.push(this);
      const contents = new EventEmitter() as any;
      contents.setWindowOpenHandler = (handler: any) => { contents.open = handler; };
      contents.printToPDF = async (printOptions: any) => { contents.printed = printOptions; if (options.pdf instanceof Error) throw options.pdf; return options.pdf ?? PDF; };
      this.webContents = contents;
    }
    async loadURL(url: string) { this.loaded.push(url); }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; }
  }
  const session = {
    fromPartition(name: string) {
      if (!sessions.has(name)) {
        const made: any = { name, filters: [] as any[], permission: null as any, check: null as any, webRequest: { onBeforeRequest(filter: any) { made.filters.push(filter); } } };
        made.setPermissionRequestHandler = (handler: any) => { made.permission = handler; };
        made.setPermissionCheckHandler = (handler: any) => { made.check = handler; };
        sessions.set(name, made);
      }
      return sessions.get(name);
    },
  };
  return { BrowserWindow: Window, session, windows, sessions };
}
const fonts = (present: boolean) => ({ platform: 'win32', env: { WINDIR: 'C:\\Windows' }, exists: (path: string) => present && path.endsWith('Nirmala.ttc') });

test('the report prints in a hidden window that runs no script, in a session that loads nothing else, and the window goes away', async () => {
  const e = electron();
  const result = await printReport({ html: HTML, scripts: ['latin'] }, { ...e, ...fonts(false) });
  assert.deepEqual(result, { ok: true, pdfBase64: PDF.toString('base64') });
  const [window] = e.windows;
  assert.equal(window.options.show, false);
  const prefs = window.options.webPreferences;
  assert.deepEqual([prefs.javascript, prefs.sandbox, prefs.contextIsolation, prefs.nodeIntegration, prefs.webSecurity], [false, true, true, false, true]);
  assert.equal(prefs.session, e.sessions.get(PRINT_PARTITION), 'its own in-memory session');
  assert.equal(PRINT_PARTITION.startsWith('persist:'), false);
  assert.equal(window.webContents.open().action, 'deny');
  let prevented = false; window.webContents.emit('will-navigate', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(window.loaded.length, 1);
  assert.ok(window.loaded[0].startsWith('data:text/html;charset=utf-8;base64,'));
  assert.equal(Buffer.from(window.loaded[0].split(',')[1], 'base64').toString('utf8'), HTML, 'it prints exactly the report HTML');
  assert.deepEqual(window.webContents.printed, PDF_OPTIONS);
  assert.equal(window.destroyed, true);
  // The session cancels every request but the page's own data address and grants no permission.
  const session = e.sessions.get(PRINT_PARTITION);
  const decide = (url: string) => { let cancel: boolean | undefined; session.filters[0]({ url }, (answer: any) => { cancel = answer.cancel; }); return cancel; };
  assert.deepEqual([decide('data:text/html;charset=utf-8;base64,AAAA'), decide('https://tracker.example/pixel.gif'), decide('file:///C:/secret.txt'), decide('chausar://app/index.html')], [false, true, true, true]);
  let granted: boolean | undefined; session.permission({}, 'media', (value: boolean) => { granted = value; });
  assert.equal(granted, false);
  assert.equal(session.check(), false);
  // A second print reuses the session without adding its rules again.
  await printReport({ html: HTML, scripts: ['latin'] }, { ...e, ...fonts(false) });
  assert.equal(session.filters.length, 1);
});

test('Hindi with no Devanagari font here prints nothing and says font-missing; with one it prints', async () => {
  const e = electron();
  assert.deepEqual(await printReport({ html: HTML, scripts: ['latin', 'devanagari'] }, { ...e, ...fonts(false) }), { ok: false, reason: 'font-missing' });
  assert.equal(e.windows.length, 0, 'no window was opened');
  assert.equal((await printReport({ html: HTML, scripts: ['latin', 'devanagari'] }, { ...e, ...fonts(true) })).ok, true);
  assert.equal(hasDevanagariFont({ platform: 'darwin', env: {}, exists: (path: string) => path === '/System/Library/Fonts/Kohinoor.ttc' }), true);
  assert.equal(hasDevanagariFont({ platform: 'linux', env: {}, exists: () => false }), false);
});

test('a request out of bounds, a print that fails or bytes that are not a PDF answer failed, and the window still goes away', async () => {
  for (const input of [null, { html: '<p>no doctype</p>', scripts: ['latin'] }, { html: HTML, scripts: ['klingon'] }, { html: HTML }, { html: `<!doctype html>${'x'.repeat(1_600_000)}`, scripts: ['latin'] }]) {
    assert.deepEqual(await printReport(input, { ...electron(), ...fonts(true) }), { ok: false, reason: 'failed' });
  }
  for (const pdf of [new Error('printer gone'), Buffer.from('<html>not a pdf</html>')]) {
    const e = electron({ pdf });
    assert.deepEqual(await printReport({ html: HTML, scripts: ['latin'] }, { ...e, ...fonts(true) }), { ok: false, reason: 'failed' });
    assert.equal(e.windows[0].destroyed, true);
  }
});

class Child extends EventEmitter {
  connected = true; sent: any[] = [];
  send(value: any, callback: (error?: Error) => void) { this.sent.push(value); callback(); }
  disconnect() { this.connected = false; } kill() { return true; }
}
async function readyHarness() {
  const child = new Child();
  const harness = new EngineHarness({ workerPath: '/owned/worker.ts', environment: {}, forkProcess: () => child as any, startupTimeoutMs: 2000 });
  const start = harness.start(); child.emit('message', { ready: true }); await start;
  return { child, harness };
}
const PRINT_ID = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

test("the harness passes the engine's print ask to main's one listener and answers the worker once", async () => {
  const { child, harness } = await readyHarness();
  // No listener: failed, at once.
  child.emit('message', { kind: 'host-print', printId: PRINT_ID, html: HTML, scripts: ['latin'] });
  assert.deepEqual(child.sent.at(-1), { kind: 'host-print-result', printId: PRINT_ID, ok: false, reason: 'failed' });
  const asked: any[] = [];
  harness.on('print', (request: any, answer: (result: unknown) => void) => { asked.push(request); answer({ ok: true, pdfBase64: 'JVBERi0=' }); answer({ ok: false, reason: 'failed' }); });
  child.emit('message', { kind: 'host-print', printId: PRINT_ID, html: HTML, scripts: ['latin'] });
  assert.deepEqual(asked, [{ html: HTML, scripts: ['latin'] }]);
  assert.deepEqual(child.sent.filter(item => item.kind === 'host-print-result').slice(1), [{ kind: 'host-print-result', printId: PRINT_ID, ok: true, pdfBase64: 'JVBERi0=' }], 'answered once');
  // An ask without a proper id is ignored; one with an unknown script is refused without reaching main.
  const before = child.sent.length;
  child.emit('message', { kind: 'host-print', printId: 'nope', html: HTML, scripts: ['latin'] });
  assert.equal(child.sent.length, before);
  child.emit('message', { kind: 'host-print', printId: PRINT_ID, html: HTML, scripts: ['latin', 'shell'] });
  assert.deepEqual(child.sent.at(-1), { kind: 'host-print-result', printId: PRINT_ID, ok: false, reason: 'failed' });
  assert.equal(asked.length, 1);
});

test("the engine's print port and the harness, end to end over a stand-in worker channel", async () => {
  const { child, harness } = await readyHarness();
  // The worker's side of the channel: what it sends reaches the harness; what the harness sends back reaches it.
  const worker = new EventEmitter() as EventEmitter & { connected: boolean; send: (message: unknown, callback?: (error: Error | null) => void) => boolean };
  worker.connected = true;
  worker.send = (message, callback) => { queueMicrotask(() => child.emit('message', message)); callback?.(null); return true; };
  const relay = child.send.bind(child);
  child.send = (value: any, callback: (error?: Error) => void) => { relay(value, callback); queueMicrotask(() => worker.emit('message', value)); };
  harness.on('print', (request: any, answer: (result: unknown) => void) => { answer(request.scripts.includes('devanagari') ? { ok: false, reason: 'font-missing' } : { ok: true, pdfBase64: PDF.toString('base64') }); });
  const port = processPrintPort(worker);
  assert.deepEqual(await port.print({ html: HTML, scripts: ['latin'] }), { ok: true, pdfBase64: PDF.toString('base64') });
  assert.deepEqual(await port.print({ html: HTML, scripts: ['latin', 'devanagari'] }), { ok: false, reason: 'font-missing' });
  // No answer in time is a failure; a channel that is gone fails at once.
  const silent = new EventEmitter() as any; silent.connected = true; silent.send = (_message: unknown, callback?: (error: Error | null) => void) => { callback?.(null); return true; };
  assert.deepEqual(await processPrintPort(silent, { timeoutMs: 20 }).print({ html: HTML, scripts: ['latin'] }), { ok: false, reason: 'failed' });
  const gone = new EventEmitter() as any; gone.connected = false;
  assert.deepEqual(await processPrintPort(gone).print({ html: HTML, scripts: ['latin'] }), { ok: false, reason: 'failed' });
});

test('main.cjs answers the print port with one handler, through report-print.cjs, and the worker composes the port', async () => {
  const main = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  const handlers = main.match(/engine\.on\('print'/g) ?? [];
  assert.equal(handlers.length, 1);
  assert.match(main, /engine\.on\('print', \(request, answer\) => \{ require\('\.\/report-print\.cjs'\)\.printReport\(request, \{ BrowserWindow, session \}\)\.then\(answer, \(\) => answer\(null\)\); \}\);/);
  const worker = await readFile(new URL('../runtime/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /print: processPrintPort\(process\)/);
});
