import { retainReplaySample } from './fixtures/replay-samples.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';

test('only explicit capture of a sample request writes an executable capture', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-engine-capture-'));
  const dir = join(root, 'captures');
  const engine = new Engine({ directory: join(root, 'data'), demo: true, storage: 'experimental-file', capture: { dir } });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Sample studio', passphrase: 'sample-only-passphrase', demo: true });
  await engine.request('venture.create', { idea: 'A weekend photography studio in Pune for birthday parties and shop product photos.', countryCode: 'IN', workingName: 'Sample studio' });
  await assert.rejects(engine.captureRequest('workspace.status', {}, 'owner data'), { code: 'CAPTURE_SAMPLE_REQUIRED' });
  const beforeRefusal = engine.vault!.read();
  engine.options.capture!.dir = process.cwd();
  await assert.rejects(engine.captureRequest('venture.client.add', { name: 'Must not be added', countryCode: 'IN' }, 'sample business'), /outside the code folder/);
  assert.deepEqual(engine.vault!.read(), beforeRefusal, 'invalid output must be refused before performing the request');
  engine.options.capture!.dir = dir;
  const result = await engine.captureRequest('venture.client.add', { name: 'Sample client', countryCode: 'IN' }, 'sample business');
  const capture = JSON.parse(await readFile(result.path, 'utf8'));
  await retainReplaySample('client', capture);
  assert.equal(capture.operation.method, 'venture.client.add');
  assert.ok(capture.events.some((event: any) => event.kind === 'clock'));
  assert.ok(capture.records.some((row: any) => row.kind === 'venture-client' && row.name === 'Sample client'));
  assert.equal((await readdir(dir)).length, 1);
  const { replayEngineRun } = await import('../runtime/venture/replay/engine-run.ts');
  assert.deepEqual((await replayEngineRun(capture)).differences, []);
  for (const method of ['venture.email.send', 'venture.claude.install', 'venture.delivery.approve']) {
    await assert.rejects(replayEngineRun({ ...capture, operation: { method, payload: { approval: 'captured' } } }), { code: 'CAPTURE_METHOD_REFUSED' });
    await assert.rejects(engine.captureRequest(method, {}, 'sample business'), { code: 'CAPTURE_METHOD_REFUSED' });
  }
  capture.records.find((row: any) => row.kind === 'venture-client').name = 'Changed client';
  assert.ok((await replayEngineRun(capture)).differences.some((line: string) => line.includes('Changed client')));
});

test('capture remains disabled without the constructor capability', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-engine-capture-'));
  const engine = new Engine({ directory: root, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(engine.captureRequest('workspace.status', {}, 'sample business'), { code: 'CAPTURE_DISABLED' });
});

test('an existing sample vault never acquires capture or state-restore authority when reopened', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-existing-capture-'));
  const first = new Engine({ directory: root, demo: true, storage: 'experimental-file' });
  await first.request('workspace.create', { name: 'Existing sample', passphrase: 'sample-existing-passphrase', demo: true });
  const state = first.vault!.read(); await first.close();
  const later = new Engine({ directory: root, demo: true, storage: 'experimental-file', capture: { dir: join(root, 'captures') } });
  t.after(async () => { await later.close(); await rm(root, { recursive: true, force: true }); });
  await later.request('workspace.open', { passphrase: 'sample-existing-passphrase' });
  await assert.rejects(later.captureRequest('venture.client.add', { name: 'Sample' }, 'sample business'), { code: 'CAPTURE_SAMPLE_REQUIRED' });
  await assert.rejects(later.vault!.restoreCaptureState(state), { code: 'CAPTURE_SAMPLE_REQUIRED' });
});
