import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const script = '../../scripts/packaged-ink-smoke.mjs';

test('packaged constructor discovery accepts one real export and refuses absent or ambiguous exports', async t => {
  const folder = await mkdtemp(join(tmpdir(), 'chausar-bundled-export-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await writeFile(join(folder, 'package.json'), '{"type":"module"}');
  const { bundledFunction } = await import(script);
  await assert.rejects(bundledFunction(folder, 'createPhoneAccess'), /exactly one/);
  await writeFile(join(folder, 'phone-a.js'), 'function createPhoneAccess() { return "real fixture"; } export { createPhoneAccess as a };');
  assert.equal((await bundledFunction(folder, 'createPhoneAccess'))(), 'real fixture');
  await writeFile(join(folder, 'phone-b.js'), 'export function createPhoneAccess() {}');
  await assert.rejects(bundledFunction(folder, 'createPhoneAccess'), /exactly one/);
});

test('smoke cleanup still closes later resources and removes scratch after a close failure', async () => {
  const { finishSmoke } = await import(script);
  const calls: string[] = [];
  const first = new Error('first close');
  const previous = new Error('smoke failed');
  await assert.rejects(finishSmoke([
    () => { calls.push('listener'); throw first; },
    async () => { calls.push('engine'); },
    async () => { calls.push('scratch'); },
  ], previous), (error: unknown) => error instanceof AggregateError && error.errors[0] === previous && error.errors[1] === first);
  assert.deepEqual(calls, ['listener', 'engine', 'scratch']);
});
