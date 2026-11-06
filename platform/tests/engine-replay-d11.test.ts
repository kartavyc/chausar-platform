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
  const result = await engine.captureRequest('venture.client.add', { name: 'Sample client', countryCode: 'IN' }, 'sample business');
  const capture = JSON.parse(await readFile(result.path, 'utf8'));
  assert.equal(capture.operation.method, 'venture.client.add');
  assert.ok(capture.events.some((event: any) => event.kind === 'clock'));
  assert.ok(capture.records.some((row: any) => row.kind === 'venture-client' && row.name === 'Sample client'));
  assert.equal((await readdir(dir)).length, 1);
  const { replayEngineRun } = await import('../runtime/venture/replay/engine-run.ts');
  assert.deepEqual((await replayEngineRun(capture)).differences, []);
  capture.records.find((row: any) => row.kind === 'venture-client').name = 'Changed client';
  assert.ok((await replayEngineRun(capture)).differences.some((line: string) => line.includes('Changed client')));
});

test('capture remains disabled without the constructor capability', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-engine-capture-'));
  const engine = new Engine({ directory: root, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(root, { recursive: true, force: true }); });
  await assert.rejects(engine.captureRequest('workspace.status', {}, 'sample business'), { code: 'CAPTURE_DISABLED' });
});
