// C5 task 29: main restarts a worker that died, by a fresh EngineHarness, after 1 s, 5 s, then 30 s. Three restarts at
// most; the fourth death shows today's error box once and quits. Nothing an owner asked for is ever sent again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createWorkerRestart, RESTART_DELAYS_MS } = require('../../app/desktop/worker-restart.cjs');
const flush = () => new Promise<void>(accept => setImmediate(accept));

function setup(options: { starts?: (attempt: number) => Promise<void> } = {}) {
  const log: string[] = [], notes: unknown[] = [];
  let attempt = 0;
  const restart = createWorkerRestart({
    start: () => { attempt += 1; log.push(`start ${attempt}`); return options.starts ? options.starts(attempt) : Promise.resolve(); },
    onReconnecting: () => { log.push('reconnecting'); },
    onGiveUp: () => { log.push('give up'); },
    note: (fields: unknown) => { notes.push(fields); },
  });
  return { restart, log, notes };
}

test('the waits are 1 s, 5 s and 30 s; each restart is noted', async t => {
  assert.deepEqual([...RESTART_DELAYS_MS], [1000, 5000, 30000]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { restart, log, notes } = setup();
  restart.died();
  assert.deepEqual(log, ['reconnecting']);
  t.mock.timers.tick(999); await flush();
  assert.deepEqual(log, ['reconnecting'], 'not before the second is up');
  t.mock.timers.tick(1); await flush();
  assert.deepEqual(log, ['reconnecting', 'start 1']);
  restart.died();
  t.mock.timers.tick(4999); await flush();
  assert.equal(log.at(-1), 'reconnecting');
  t.mock.timers.tick(1); await flush();
  assert.equal(log.at(-1), 'start 2');
  restart.died();
  t.mock.timers.tick(29_999); await flush();
  assert.equal(log.at(-1), 'reconnecting');
  t.mock.timers.tick(1); await flush();
  assert.equal(log.at(-1), 'start 3');
  assert.deepEqual(notes, [{ attempt: 1, delayMs: 1000 }, { attempt: 2, delayMs: 5000 }, { attempt: 3, delayMs: 30000 }]);
});

test('the fourth death gives up once, and nothing starts after it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { restart, log } = setup();
  for (const wait of RESTART_DELAYS_MS) { restart.died(); t.mock.timers.tick(wait); await flush(); }
  restart.died();
  assert.equal(log.at(-1), 'give up');
  restart.died();
  t.mock.timers.tick(100_000); await flush();
  assert.equal(log.filter(line => line === 'give up').length, 1);
  assert.equal(log.filter(line => line.startsWith('start')).length, 3);
});

test('a restart that fails to start counts as the next failure; a second report of one death changes nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { restart, log } = setup({ starts: attempt => (attempt < 3 ? Promise.reject(new Error('no')) : Promise.resolve()) });
  restart.died();
  restart.died();
  assert.deepEqual(log, ['reconnecting'], 'disconnect and exit report one death');
  t.mock.timers.tick(1000); await flush();
  assert.deepEqual(log, ['reconnecting', 'start 1', 'reconnecting']);
  restart.died();
  t.mock.timers.tick(5000); await flush();
  assert.equal(log.at(-1), 'reconnecting');
  t.mock.timers.tick(30_000); await flush();
  assert.equal(log.at(-1), 'start 3');
  assert.equal(log.includes('give up'), false);
});

test('a report while a start is under way waits for that start to answer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let release!: () => void;
  const { restart, log } = setup({ starts: () => new Promise<void>(accept => { release = accept; }) });
  restart.died();
  t.mock.timers.tick(1000); await flush();
  assert.equal(restart.pending(), true);
  restart.died();
  assert.deepEqual(log, ['reconnecting', 'start 1']);
  release(); await flush();
  assert.equal(restart.pending(), false);
});

test('a worker that stays up for ten minutes earns the three tries back', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { restart, notes } = setup();
  restart.died();
  t.mock.timers.tick(1000); await flush();
  t.mock.timers.tick(10 * 60_000); await flush();
  restart.died();
  assert.deepEqual(notes.at(-1), { attempt: 1, delayMs: 1000 });
});

test('quitting stops any wait, so no worker starts after it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { restart, log } = setup();
  restart.died();
  restart.stop();
  t.mock.timers.tick(100_000); await flush();
  restart.died();
  assert.deepEqual(log, ['reconnecting']);
});

test('the window hears reconnecting while a restart is pending, and the plain state otherwise', () => {
  const { restart } = setup();
  const ready = { state: 'ready', healthy: true }, failed = { state: 'failed', healthy: false }, starting = { state: 'starting', healthy: false };
  assert.deepEqual(restart.statusForWindow(failed), failed);
  restart.died();
  assert.deepEqual(restart.statusForWindow(failed), { state: 'reconnecting', healthy: false });
  assert.deepEqual(restart.statusForWindow(starting), { state: 'reconnecting', healthy: false });
  assert.deepEqual(restart.statusForWindow(ready), ready);
  restart.stop();
});
