// 15 Nov 2026 (the first walk of the built Windows app): quit when asked. app/desktop/quit-ask.cjs holds the ask
// ("Chausar.exe --quit", through the single-instance lock) and the hidden window that hears the Windows session end
// while Chausar is in the tray. main.cjs's own use of both is in desktop-main.test.ts; the release smoke's in
// release-smoke-d11.test.ts. Here: the two pieces alone, and the installer's use of the same ask.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const quitAsk = require('../../app/desktop/quit-ask.cjs');

test('only the exact ask is an ask to quit: the argument --quit, or the lock data { quit: true }', () => {
  const { asksToQuit, QUIT_ARGUMENT } = quitAsk;
  assert.equal(QUIT_ARGUMENT, '--quit');
  assert.equal(asksToQuit(['Chausar.exe', '--quit'], undefined), true);
  assert.equal(asksToQuit(['Chausar.exe', '--allow-file-access-from-files', '--quit'], null), true, 'Windows may reorder and add arguments');
  assert.equal(asksToQuit(['Chausar.exe'], { quit: true }), true);
  assert.equal(asksToQuit(undefined, { quit: true }), true);
  for (const [argv, data] of [[['Chausar.exe'], undefined], [['Chausar.exe', '--quit=1'], {}], [['Chausar.exe', 'quit'], { quit: 'true' }], [undefined, undefined], ['--quit', null], [['Chausar.exe', '--QUIT'], { quit: 1 }]] as [unknown, unknown][]) {
    assert.equal(asksToQuit(argv, data), false, JSON.stringify([argv, data]));
  }
});

test('the asking launch: 0 at once when no Chausar runs, 0 when the other has gone, 1 when it is still there after the wait', async () => {
  const run = async (answers: boolean[], first: boolean, extra: Record<string, unknown> = {}) => {
    const app = { exits: [] as number[], released: 0, asks: [] as unknown[], exit(code: number) { this.exits.push(code); }, releaseSingleInstanceLock() { this.released += 1; }, requestSingleInstanceLock(data: unknown) { this.asks.push(data); return answers.shift() ?? false; } };
    const waits: number[] = [], jobs: (() => void)[] = [];
    quitAsk.askRunningToQuit({ app, first, later: (job: () => void, ms: number) => { jobs.push(job); waits.push(ms); }, waitMs: 2_000, everyMs: 500, ...extra });
    for (let turn = 0; turn < 40 && app.exits.length === 0; turn += 1) { await new Promise<void>(accept => setImmediate(accept)); jobs.shift()?.(); }
    return { app, waits };
  };
  const none = await run([], true);
  assert.deepEqual([none.app.exits, none.app.released, none.app.asks, none.waits], [[0], 1, [], []]);
  // The running Chausar's process is not known (it wrote no file): each look asks the lock again.
  const gone = await run([false, true], false);
  assert.deepEqual([gone.app.exits, gone.app.released, gone.waits], [[0], 1, [500, 500]]);
  assert.deepEqual(gone.app.asks, [{ quit: true }, { quit: true }]);
  const stays = await run([], false);
  assert.deepEqual([stays.app.exits, stays.app.released, stays.waits], [[1], 0, [500, 500, 500, 500]], 'four looks in two seconds, then it gives up; it ends nothing by force');
  assert.deepEqual([quitAsk.QUIT_WAIT_MS, quitAsk.QUIT_LOOK_MS, quitAsk.RUNNING_FILE], [90_000, 500, 'running.json']);
});

// 15 Nov 2026 (the installed Windows build): a second launch ended a Chausar that was slow to answer and had no window
// on screen; that is the single-instance check's own doing on Windows, on every ask. So the asking launch asks once (its
// own launch), then only watches the running Chausar's process, which that Chausar names in running.json, and asks the
// lock once more only when the process has gone, to be sure.
test('the asking launch watches the running process and does not ask again while it is there', async () => {
  const run = async (livesFor: number, answers: boolean[], waitMs = 60_000) => {
    const app = { exits: [] as number[], released: 0, asks: [] as unknown[], exit(code: number) { this.exits.push(code); }, releaseSingleInstanceLock() { this.released += 1; }, requestSingleInstanceLock(data: unknown) { this.asks.push(data); return answers.shift() ?? false; } };
    const jobs: (() => void)[] = [], watched: number[] = [];
    let looks = 0;
    quitAsk.askRunningToQuit({ app, first: false, later: (job: () => void) => { jobs.push(job); }, waitMs, everyMs: 500, runningPid: async () => 4242, alive: (pid: number) => { watched.push(pid); looks += 1; return looks <= livesFor; } });
    for (let turn = 0; turn < 400 && app.exits.length === 0; turn += 1) { await new Promise<void>(accept => setImmediate(accept)); jobs.shift()?.(); }
    return { app, watched };
  };
  const stopped = await run(7, [true]);
  assert.deepEqual([stopped.app.exits, stopped.app.released], [[0], 1]);
  assert.deepEqual(stopped.app.asks, [{ quit: true }], 'one ask, after the process had gone, to be sure the lock is free');
  assert.equal(stopped.watched.length, 8);
  assert.ok(stopped.watched.every(pid => pid === 4242));
  // Still there after the wait: 1, and never an ask in between.
  const stays = await run(Number.MAX_SAFE_INTEGER, [], 2_000);
  assert.deepEqual([stays.app.exits, stays.app.asks], [[1], []]);
  // The process went but the lock is still held (another Chausar took it): it goes back to asking, as with no file.
  const taken = await run(1, [false, false, true]);
  assert.deepEqual([taken.app.exits, taken.app.asks.length], [[0], 3]);
  // A file that names no process (unreadable, or not a process number) is as no file.
  const app = { exits: [] as number[], asks: 0, exit(code: number) { this.exits.push(code); }, releaseSingleInstanceLock() {}, requestSingleInstanceLock() { this.asks += 1; return true; } };
  const jobs: (() => void)[] = [];
  quitAsk.askRunningToQuit({ app, first: false, later: (job: () => void) => { jobs.push(job); }, runningPid: async () => { throw new Error('no file'); }, alive: () => { throw new Error('never asked'); } });
  for (let turn = 0; turn < 10 && app.exits.length === 0; turn += 1) { await new Promise<void>(accept => setImmediate(accept)); jobs.shift()?.(); }
  assert.deepEqual([app.exits, app.asks], [[0], 1]);
});

test('the hidden window is made on Windows only, once, and stop() removes it without asking to quit', () => {
  const made: any[] = [];
  class Hidden extends EventEmitter { options: unknown; constructor(options: unknown) { super(); this.options = options; made.push(this); } destroy() { this.emit('closed'); } }
  const heard: string[] = [];
  const watch = (platform: string, BaseWindow: unknown = Hidden) => quitAsk.createSessionWatch({ BaseWindow, platform, onSessionEnd: () => heard.push('session-end'), onCloseAsked: () => heard.push('close') });
  for (const platform of ['darwin', 'linux']) { const other = watch(platform); assert.equal(other.start(), false); assert.equal(other.active(), false); }
  assert.equal(watch('win32', null).start(), false,'an Electron without BaseWindow: nothing, and nothing breaks');
  assert.equal(made.length, 0);
  const windows = watch('win32');
  assert.equal(windows.start(), true);
  assert.equal(windows.start(), false, 'one at a time');
  assert.deepEqual([made.length, made[0].options, windows.active()], [1, { show: false, skipTaskbar: true }, true]);
  made[0].emit('session-end', { reasons: ['logoff'] });
  made[0].emit('close', { preventDefault() {} });
  assert.deepEqual(heard, ['session-end', 'close']);
  windows.stop();
  assert.deepEqual([windows.active(), heard], [false, ['session-end', 'close']], 'destroy sends no close');
  assert.equal(windows.start(), true, 'and it can listen again');
  made[1].emit('closed');
  assert.equal(windows.active(), false, 'a hidden window that closed is forgotten');
});

// The installer and the uninstaller close a running Chausar before they touch its files. electron-builder's own step
// sends "taskkill" without /F (which only closes the window, so the beta stays in the tray) and ends it by force about a
// second later. Chausar's step asks with "Chausar.exe --quit" first, so the engine stops gracefully; the forced end
// stays as the fallback. This is a text check only: nothing here compiles or runs NSIS.
test('the installer asks a running Chausar to quit with --quit before it ends anything by force', async () => {
  const script = await readFile(new URL('../../app/desktop/installer.nsh', import.meta.url), 'utf8');
  const macro = /!macro customCheckAppRunning\r?\n([\s\S]*?)\r?\n!macroend/.exec(script)?.[1] ?? '';
  assert.notEqual(macro, '', 'electron-builder uses customCheckAppRunning in place of its own step');
  const ask = macro.indexOf('nsExec::Exec /TIMEOUT=100000 `"$INSTDIR\\${APP_EXECUTABLE_FILENAME}" --quit`');
  const forced = macro.indexOf('taskkill /f /im "${APP_EXECUTABLE_FILENAME}"');
  assert.ok(ask > 0, 'the ask, with a time limit a little over the 90 seconds the asking launch waits');
  assert.ok(forced > ask, 'the forced end comes after the ask, as the fallback');
  assert.ok(macro.indexOf('${FileExists} "$INSTDIR\\${APP_EXECUTABLE_FILENAME}"') < ask, 'only when the installed program is there to ask');
  assert.ok(macro.indexOf('!insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0') < ask, 'only when Chausar is running: an older Chausar would start on --quit');
  assert.ok(macro.indexOf('MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)"') < ask, 'the owner is asked first, as before');
  assert.equal(/taskkill \/im/.test(macro), false, 'the polite taskkill is gone: it cannot quit Chausar');
  assert.equal(/\$pid|GetProcessInfo|_CHECK_APP_RUNNING/.test(macro), false, 'nothing from the step it replaces, which electron-builder leaves out when this one is there');
  // The words the builder's own step uses, so the labels and messages it defines are the ones used here.
  const stock = await readFile(new URL('../../node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh', import.meta.url), 'utf8').catch(() => null);
  if (stock !== null) {
    assert.match(stock, /!ifmacrodef customCheckAppRunning\s+!insertmacro customCheckAppRunning/);
    for (const used of ['!macro FIND_PROCESS _FILE _ERR', '"$(appRunning)"', '"$(appCannotBeClosed)"', '${isUpdated}']) assert.ok(stock.includes(used), used);
  }
});
