// A2 second review: only the owner's click can approve a Codex. When the window asks for venture.ai.setup.trust, the
// desktop main process shows its own native dialog, modal to the app window, naming the program path and version from
// the engine's held review (never from the window's payload). Only "Use this Codex" sends main's confirmation to the
// engine over the worker's host channel; Cancel (the default, and Escape) records nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createCodexChoice, CODEX_CHOICE_WORDS } = require('../../app/desktop/codex-choice.cjs');
const { EngineHarness } = require('../../app/desktop/engine-harness.cjs');

const SHA = 'c'.repeat(64);
const HELD = { path: String.raw`C:\Users\owner\AppData\Roaming\npm\node_modules\@openai\codex\vendor\bin\codex.exe`, version: '0.166.0' };

function rig(response: number) {
  const calls: { kind: string; payload: unknown }[] = [];
  const shown: { window: unknown; options: any }[] = [];
  const engine = {
    async codexChoice(payload: unknown) { calls.push({ kind: 'choice', payload }); return { ...HELD }; },
    async confirmCodex(payload: unknown) { calls.push({ kind: 'confirm', payload }); return { setup: { state: 'trusted', origin: 'owner' } }; },
  };
  const appWindow = { id: 'app-window' };
  const dialog = { async showMessageBox(window: unknown, options: unknown) { shown.push({ window, options }); return { response }; } };
  return { calls, shown, appWindow, choose: createCodexChoice({ engine: () => engine, dialog, window: () => appWindow }) };
}

test('Use this Codex: main shows its own dialog from the held review, then confirms; the window\'s own words are never shown', async () => {
  const { calls, shown, appWindow, choose } = rig(0);
  const answer = await choose({ cli: 'codex', sha256: SHA, path: String.raw`C:\evil\codex.exe`, version: '9.9.9' });
  assert.deepEqual(answer, { setup: { state: 'trusted', origin: 'owner' } });
  assert.equal(shown.length, 1);
  assert.equal(shown[0]!.window, appWindow, 'modal to the app window');
  const options = shown[0]!.options;
  assert.equal(options.title, 'Use this Codex?');
  assert.equal(options.message, 'Use this Codex?');
  assert.equal(options.detail, `Chausar will run Codex 0.166.0 from ${HELD.path} for your AI work.`);
  assert.ok(!JSON.stringify(options).includes('evil') && !JSON.stringify(options).includes('9.9.9'), 'nothing from the window is shown');
  assert.deepEqual(options.buttons, ['Use this Codex', 'Cancel']);
  assert.equal(options.defaultId, 1, 'Cancel is the default');
  assert.equal(options.cancelId, 1, 'and Escape is Cancel');
  // One-shot A3: the confirmation names the path the dialog showed, from the held review, never the window's.
  assert.deepEqual(calls, [{ kind: 'choice', payload: { cli: 'codex', sha256: SHA } }, { kind: 'confirm', payload: { cli: 'codex', sha256: SHA, path: HELD.path } }]);
  assert.equal(/\u2014/.test(JSON.stringify(CODEX_CHOICE_WORDS)), false);
});

test('Cancel (or Escape) records nothing and says so calmly', async () => {
  const { calls, choose } = rig(1);
  await assert.rejects(choose({ cli: 'codex', sha256: SHA }), { code: 'CODEX_NOT_CHOSEN', message: "Nothing changed. Codex wasn't chosen." });
  assert.deepEqual(calls.map(call => call.kind), ['choice'], 'no confirmation reached the engine');
});

test('once trusted, a second call shows no dialog, and neither does the bundled Codex', async () => {
  for (const origin of ['owner', 'bundled']) {
    const shown: unknown[] = [], confirmed: unknown[] = [];
    const inUse = { state: 'trusted', origin, path: 'C:/Tools/codex/codex.exe', version: '0.166.0', sha256: SHA, line: 'In use.' };
    const choose = createCodexChoice({
      engine: () => ({ async codexChoice() { return { inUse }; }, async confirmCodex(payload: unknown) { confirmed.push(payload); return { setup: inUse }; } }),
      dialog: { async showMessageBox(...args: unknown[]) { shown.push(args); return { response: 0 }; } }, window: () => null,
    });
    assert.deepEqual(await choose({ cli: 'codex', sha256: SHA }), { setup: inUse }, origin);
    assert.deepEqual([shown, confirmed], [[], []], `${origin}: no dialog, nothing recorded again`);
  }
});

test('a review the engine does not hold shows no dialog at all', async () => {
  const shown: unknown[] = [];
  const choose = createCodexChoice({
    engine: () => ({ async codexChoice() { throw Object.assign(new Error('That Codex changed since you looked at it. Check it again.'), { code: 'CODEX_SETUP_CHANGED' }); }, async confirmCodex() { throw new Error('never'); } }),
    dialog: { async showMessageBox(...args: unknown[]) { shown.push(args); return { response: 0 }; } }, window: () => null,
  });
  await assert.rejects(choose({ cli: 'codex', sha256: SHA }), { code: 'CODEX_SETUP_CHANGED' });
  assert.deepEqual(shown, []);
});

// A fix: main.cjs makes the choice inside app.whenReady, before startEngine() sets the engine, and a restart replaces
// the engine. The choice reads the engine at each use, so the owner's click reaches the engine running now.
function engineNamed(name: string, calls: string[]) {
  return {
    async codexChoice() { calls.push(`${name}:choice`); return { ...HELD }; },
    async confirmCodex() { calls.push(`${name}:confirm`); return { setup: { state: 'trusted', origin: 'owner', engine: name } }; },
  };
}

test('the choice made before the engine exists reaches the engine set later', async () => {
  const calls: string[] = [];
  let current: unknown;
  const choose = createCodexChoice({ engine: () => current, dialog: { async showMessageBox() { return { response: 0 }; } }, window: () => null });
  current = engineNamed('first', calls);
  assert.deepEqual(await choose({ cli: 'codex', sha256: SHA }), { setup: { state: 'trusted', origin: 'owner', engine: 'first' } });
  assert.deepEqual(calls, ['first:choice', 'first:confirm']);
});

test('after a restart swaps the engine, the choice reaches the new one', async () => {
  const calls: string[] = [];
  let current: unknown = engineNamed('old', calls);
  const choose = createCodexChoice({ engine: () => current, dialog: { async showMessageBox() { return { response: 0 }; } }, window: () => null });
  await choose({ cli: 'codex', sha256: SHA });
  current = engineNamed('new', calls);
  assert.deepEqual(await choose({ cli: 'codex', sha256: SHA }), { setup: { state: 'trusted', origin: 'owner', engine: 'new' } });
  assert.deepEqual(calls, ['old:choice', 'old:confirm', 'new:choice', 'new:confirm']);
});

test('with no engine yet, the choice refuses as the engine does when it is not ready, shows no dialog, and can ask again later', async () => {
  const shown: unknown[] = [], calls: string[] = [];
  let current: unknown;
  const choose = createCodexChoice({ engine: () => current, dialog: { async showMessageBox(...args: unknown[]) { shown.push(args); return { response: 0 }; } }, window: () => null });
  await assert.rejects(choose({ cli: 'codex', sha256: SHA }), { code: 'ENGINE_UNAVAILABLE', message: 'The engine is unavailable. Restart Chausar.' });
  assert.deepEqual(shown, []);
  current = engineNamed('later', calls);
  await choose({ cli: 'codex', sha256: SHA });
  assert.deepEqual(calls, ['later:choice', 'later:confirm'], 'the refusal left nothing held');
});

test('an engine handed over by value is refused when the choice is made, so the early capture cannot come back', () => {
  assert.throws(() => createCodexChoice({ engine: engineNamed('value', []), dialog: {}, window: () => null }), TypeError);
  assert.throws(() => createCodexChoice({ engine: undefined, dialog: {}, window: () => null }), TypeError);
});

test('the harness sends the held-review read and the confirmation as host messages only main can write', async () => {
  const child = new EventEmitter() as any; child.connected = true; const sent: any[] = [];
  child.send = (message: any, callback: () => void) => { sent.push(message); callback(); if (message.kind) queueMicrotask(() => child.emit('message', { id: message.id, result: message.kind === 'host-codex-choice' ? HELD : { setup: { state: 'trusted' } } })); };
  child.kill = () => { child.emit('exit', 0); return true; };
  child.disconnect = () => { child.connected = false; child.emit('disconnect'); child.emit('exit', 0); };
  const harness = new EngineHarness({ workerPath: '/synthetic-worker', environment: {}, forkProcess: () => child });
  const ready = harness.start(); child.emit('message', { ready: true }); await ready;
  assert.deepEqual(await harness.codexChoice({ cli: 'codex', sha256: SHA }), HELD);
  assert.deepEqual(await harness.confirmCodex({ cli: 'codex', sha256: SHA, path: HELD.path, extra: 1 }), { setup: { state: 'trusted' } });
  assert.deepEqual(sent.map(message => [message.kind, message.method, message.payload]), [['host-codex-choice', undefined, { cli: 'codex', sha256: SHA }], ['host-codex-confirm', undefined, { cli: 'codex', sha256: SHA, path: HELD.path }]]);
  await harness.stop();
});

test('main answers the window\'s venture.ai.setup.trust only through its own dialog, never by forwarding it', async () => {
  const main = await readFile(new URL('../../app/desktop/main.cjs', import.meta.url), 'utf8');
  const handler = main.slice(main.indexOf('ipcMain.handle(REQUEST_CHANNEL'));
  const route = handler.indexOf("request.method === 'venture.ai.setup.trust'"), forward = handler.indexOf('engine.request(request.method');
  assert.ok(route > 0 && route < forward, 'the dialog route comes before the plain forward');
  // A fix: main makes the choice before startEngine() sets the engine, so the engine is read at each use, never captured.
  assert.match(main, /createCodexChoice\(\{ engine: \(\) => engine, dialog, window: \(\) => window \}\)/);
  const worker = await readFile(new URL('../runtime/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, /host-codex-confirm/);
});
