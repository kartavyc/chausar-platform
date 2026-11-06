// D11e task 26 (the recorder and the file; the engine's capture option and driver hooks come after the rebase): a run
// capture holds the starting State and every answer in order, contacts masked, and refuses any secret.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RUN_CAPTURE_FORMAT, createRunRecorder, writeRunCapture } from '../runtime/venture/replay/capture.ts';
import { readRunCapture } from '../runtime/venture/replay/replay-run.ts';

// Built at run time from parts, so no key-shaped string sits in the source (GitHub push protection).
const keyShaped = () => ['sk', 'ant', 'api03', 'Ab1Cd2Ef3Gh4Ij5Kl6Mn7Op8Qr9St0Uv1Wx2Yz3'].join('-');

test('a capture holds the starting State and every answer in order, with contacts masked, and reads back', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-run-capture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const recorder = createRunRecorder({ startState: { schemaVersion: 1, owner: 'Asha', email: 'asha@example.com' }, capturedAt: '2026-11-06T10:00:00.000Z' });
  recorder.clock('2026-11-06T10:00:01.000Z');
  recorder.model('plan-suggest', 'Plan for Asha (asha@example.com)', 'A tutoring plan. Call +91 98765 43210.');
  recorder.driver('codex', '{"type":"item.completed","item":{"type":"agent_message","text":"Done"}}');
  recorder.fetch('https://example.com/pricing', 200, '<p>Prices</p>');
  recorder.clock('2026-11-06T10:00:02.000Z');
  const capture = recorder.finish([{ id: 'venture_a1b2c3d4', kind: 'plan' }]);
  assert.equal(capture.format, RUN_CAPTURE_FORMAT);
  assert.deepEqual(capture.events.map(event => event.kind), ['clock', 'model', 'driver', 'fetch', 'clock']);
  assert.deepEqual(capture.startState, { schemaVersion: 1, owner: 'Asha', email: '[email]' });
  assert.deepEqual(capture.events[1], { kind: 'model', purpose: 'plan-suggest', request: 'Plan for Asha ([email])', answer: 'A tutoring plan. Call [phone].' });
  const path = await writeRunCapture(dir, capture);
  assert.match(path, /run-20261106T100000000Z\.capture\.json$/);
  assert.deepEqual(readRunCapture(JSON.parse(await readFile(path, 'utf8'))), capture);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith('.tmp')), [], 'no temporary file is left');
});

test('a key-shaped answer is refused by kind, never echoed, and nothing is written', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'chausar-run-capture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T10:00:00.000Z' });
  assert.throws(() => recorder.model('compose', 'Write the offer', `Use this key: ${keyShaped()}`), (error: any) => {
    assert.equal(error.code, 'CAPTURE_REFUSED');
    assert.match(error.message, /model call 1 \(answer\) holds/);
    assert.equal(error.message.includes(keyShaped()), false, 'the value is never in the message');
    return true;
  });
  assert.throws(() => createRunRecorder({ startState: { token: keyShaped() }, capturedAt: 'x' }), /CAPTURE_REFUSED|cannot hold a secret/);
  assert.deepEqual(await readdir(dir), []);
});

test('a finished capture takes no more events', () => {
  const recorder = createRunRecorder({ startState: {}, capturedAt: '2026-11-06T10:00:00.000Z' });
  recorder.finish([]);
  assert.throws(() => recorder.clock('2026-11-06T10:00:03.000Z'), /already finished/);
});

test('no host turns capture on: worker, server and hosted server never import it, and no variable names it', async () => {
  for (const file of ['worker.ts', 'server.ts', 'hosted/server.ts']) {
    const source = await readFile(new URL(`../runtime/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /replay\/capture|capture:\s*\{/, file);
  }
  const capture = await readFile(new URL('../runtime/venture/replay/capture.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(capture, /process\.env|CHAUSAR_[A-Z_]*CAPTURE/);
});
