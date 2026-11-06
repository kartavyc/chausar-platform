// C5 tasks 25, 26: app/desktop/diagnostics.cjs, the rotated jsonl writer. A line holds names and sizes only, so a file a
// support person reads never carries a message, a path or a piece of the owner's work.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createDiagnostics, startMainGuard, createTimeline, STARTUP_PHASES, CRASH_WORDS, DIAGNOSTICS_MAX_BYTES } = require('../../app/desktop/diagnostics.cjs');

async function folder(t: TestContext): Promise<string> {
  const path = await mkdtemp(join(await realpath(tmpdir()), 'chausar-diagnostics-c5-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}
const lines = (text: string) => text.trim().split('\n').map(line => JSON.parse(line));

test('a line is names and sizes only: words with spaces, paths and objects never reach the file', async t => {
  const root = await folder(t);
  const log = createDiagnostics({ folder: root, now: () => '2026-11-06T10:00:00.000Z' });
  await log.line('main.jsonl', { op: 'uncaught', name: 'TypeError', code: 'ENOENT', ms: 12, ok: true, message: 'cannot read C:\\Users\\asha\\secret-marker.txt', detail: { secret: 'secret-marker' }, list: ['secret-marker'], path: '/home/asha/secret-marker', blank: '' });
  assert.deepEqual(lines(await readFile(join(root, 'main.jsonl'), 'utf8')), [{ at: '2026-11-06T10:00:00.000Z', op: 'uncaught', name: 'TypeError', code: 'ENOENT', ms: 12, ok: true }]);
});

test('the file rotates at 1 MB: the older lines move to .1 and the newest stay', async t => {
  assert.equal(DIAGNOSTICS_MAX_BYTES, 1024 * 1024);
  const root = await folder(t);
  const log = createDiagnostics({ folder: root });
  // One line is about 90 bytes, so 13,000 lines pass 1 MB once and stay under 2 MB.
  for (let index = 0; index < 13_000; index++) void log.line('rpc.jsonl', { method: 'workspace.status', ms: index, requestBytes: 2, answerBytes: 10 });
  await log.flushed();
  assert.deepEqual((await readdir(root)).sort(), ['rpc.jsonl', 'rpc.jsonl.1']);
  const current = await stat(join(root, 'rpc.jsonl')), older = await stat(join(root, 'rpc.jsonl.1'));
  assert.ok(current.size <= DIAGNOSTICS_MAX_BYTES, 'the file in use stays under the limit');
  assert.ok(older.size <= DIAGNOSTICS_MAX_BYTES && older.size > DIAGNOSTICS_MAX_BYTES - 200, 'the moved file is full');
  assert.equal(lines(await readFile(join(root, 'rpc.jsonl'), 'utf8')).at(-1).ms, 12_999);
  assert.equal(lines(await readFile(join(root, 'rpc.jsonl.1'), 'utf8'))[0].ms, 0);
});

test('a log that cannot be written changes nothing, and only plain file names are accepted', async t => {
  const root = await folder(t);
  const broken = createDiagnostics({ folder: root, fs: { mkdir: async () => { throw new Error('no disk'); } } });
  await broken.line('main.jsonl', { op: 'x' });
  const log = createDiagnostics({ folder: root });
  await log.line('../outside.jsonl', { op: 'x' });
  await log.line('not json', { op: 'x' });
  assert.deepEqual(await readdir(root), []);
});

function guarded(root: string) {
  const handlers = new Map<string, (error: unknown) => void>(), boxes: string[][] = [], started: unknown[] = [];
  let quits = 0;
  const log = createDiagnostics({ folder: root });
  startMainGuard({ process: { on: (name: string, handler: (error: unknown) => void) => handlers.set(name, handler) }, crashReporter: { start: (options: unknown) => started.push(options) }, dialog: { showErrorBox: (title: string, words: string) => boxes.push([title, words]) }, app: { quit: () => { quits++; } }, diagnostics: log });
  return { handlers, boxes, started, log, quits: () => quits };
}

test('crash dumps stay on this computer: the reporter starts with no upload', async t => {
  const { started } = guarded(await folder(t));
  assert.deepEqual(started, [{ uploadToServer: false }]);
});

test('a thrown error writes one line, shows one plain dialog and quits; the words name nothing', async t => {
  const root = await folder(t);
  const { handlers, boxes, log, quits } = guarded(root);
  handlers.get('uncaughtException')!(Object.assign(new TypeError('cannot read C:\\Users\\asha\\secret-marker.txt'), { code: 'ENOENT' }));
  await log.flushed(); await new Promise(accept => setImmediate(accept));
  assert.deepEqual(boxes, [['Chausar', 'Chausar hit a problem and needs to close. Nothing was sent anywhere.']]);
  assert.equal(CRASH_WORDS, boxes[0][1]);
  assert.equal(quits(), 1);
  const text = await readFile(join(root, 'main.jsonl'), 'utf8');
  assert.equal(text.includes('secret-marker'), false);
  assert.deepEqual(lines(text).map(({ at: _at, ...line }) => line), [{ op: 'uncaught', name: 'TypeError', code: 'ENOENT' }]);
  // A second problem while closing is noted; there is no second dialog and no second quit.
  handlers.get('unhandledRejection')!(new RangeError('again'));
  await log.flushed(); await new Promise(accept => setImmediate(accept));
  assert.equal(boxes.length, 1);
  assert.equal(quits(), 1);
  assert.deepEqual(lines(await readFile(join(root, 'main.jsonl'), 'utf8')).map(line => [line.op, line.name]), [['uncaught', 'TypeError'], ['unhandled-rejection', 'RangeError']]);
});

test('a rejected promise that is not an error object still closes plainly', async t => {
  const root = await folder(t);
  const { handlers, boxes, log, quits } = guarded(root);
  handlers.get('unhandledRejection')!('secret-marker');
  await log.flushed(); await new Promise(accept => setImmediate(accept));
  assert.equal(boxes.length, 1);
  assert.equal(quits(), 1);
  assert.equal((await readFile(join(root, 'main.jsonl'), 'utf8')).includes('secret-marker'), false);
});

test('the start-up phases are one list, and each is written once with its time since the start', async t => {
  assert.deepEqual([...STARTUP_PHASES], ['app-ready', 'window-shown', 'engine-forked', 'loaded', 'engine-ready', 'first-paint', 'first-request']);
  assert.equal(Object.isFrozen(STARTUP_PHASES), true);
  const root = await folder(t);
  let clock = 1000;
  const log = createDiagnostics({ folder: root }), timeline = createTimeline({ diagnostics: log, now: () => clock });
  clock = 1040;
  assert.equal(timeline.mark('app-ready'), true);
  assert.equal(timeline.mark('app-ready'), false, 'once');
  assert.equal(timeline.mark('made-up'), false, 'only a named phase');
  assert.equal(timeline.reached('app-ready'), true);
  assert.equal(timeline.reached('first-paint'), false);
  clock = 1100;
  timeline.note('engine-restart', { attempt: 1, delayMs: 1000 });
  await log.flushed();
  assert.deepEqual(lines(await readFile(join(root, 'startup.jsonl'), 'utf8')).map(({ at: _at, ...line }) => line), [{ phase: 'app-ready', ms: 40 }, { op: 'engine-restart', attempt: 1, delayMs: 1000, ms: 100 }]);
});
