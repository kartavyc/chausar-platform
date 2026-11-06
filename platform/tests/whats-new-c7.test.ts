// C7 task 26 (the file half): "What's new" shows once per version. The seen mark is one per-computer file,
// custody/seen.json beside ai-setup.json, written whole through a temporary file and a rename, at most 4 KB. A fresh
// install records its version silently; an update shows once; a broken file reads as seen (nothing shown rather than a
// loop); a file from a newer Chausar is left alone (D12's per-computer files rule).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { markSeen, whatsNewState, SEEN_FILE } from '../runtime/whats-new-file.ts';

async function custody(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-whats-new-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return join(root, 'custody');
}

test('first ever start: the version is recorded silently and reads as seen', async t => {
  const folder = await custody(t);
  assert.deepEqual(await whatsNewState(folder, '0.2.0', { hasBusiness: false }), { version: '0.2.0', seen: true });
  const kept = JSON.parse(await readFile(join(folder, SEEN_FILE), 'utf8'));
  assert.equal(kept.format, 'chausar.seen.v1'); assert.equal(kept.version, '0.2.0');
  assert.deepEqual(await readdir(folder), [SEEN_FILE]);
});

test('after an update the version is not seen until it is marked; a computer with businesses but no file sees it once', async t => {
  const folder = await custody(t);
  await whatsNewState(folder, '0.1.0', { hasBusiness: false });
  assert.deepEqual(await whatsNewState(folder, '0.2.0', { hasBusiness: true }), { version: '0.2.0', seen: false });
  await markSeen(folder, '0.2.0');
  assert.deepEqual(await whatsNewState(folder, '0.2.0', { hasBusiness: true }), { version: '0.2.0', seen: true });
  const other = await custody(t);
  assert.deepEqual(await whatsNewState(other, '0.2.0', { hasBusiness: true }), { version: '0.2.0', seen: false });
  await assert.rejects(readFile(join(other, SEEN_FILE)), 'nothing is written until the owner closes it');
});

test('a broken or oversized file reads as seen, and marking replaces it', async t => {
  const folder = await custody(t);
  await mkdir(folder, { recursive: true });
  for (const text of ['{broken', JSON.stringify({ format: 'chausar.seen.v1', version: 7 }), JSON.stringify({ format: 'chausar.seen.v1', version: 'x'.repeat(5000) }), '[]']) {
    await writeFile(join(folder, SEEN_FILE), text);
    assert.deepEqual(await whatsNewState(folder, '0.2.0', { hasBusiness: true }), { version: '0.2.0', seen: true }, text.slice(0, 30));
  }
  await markSeen(folder, '0.3.0');
  assert.equal(JSON.parse(await readFile(join(folder, SEEN_FILE), 'utf8')).version, '0.3.0');
  assert.ok((await readFile(join(folder, SEEN_FILE))).length <= 4096);
  await assert.rejects(markSeen(folder, 'x'.repeat(200)), (error: any) => error.code === 'INVALID_VENTURE_REQUEST');
  assert.deepEqual(await readdir(folder), [SEEN_FILE], 'no temporary file is left');
});

test('a seen mark from a newer Chausar is left alone and reads as seen', async t => {
  const folder = await custody(t), newer = JSON.stringify({ format: 'chausar.seen.v2', version: '0.9.0', extra: true });
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, SEEN_FILE), newer);
  assert.deepEqual(await whatsNewState(folder, '0.2.0', { hasBusiness: true }), { version: '0.2.0', seen: true });
  await markSeen(folder, '0.2.0');
  assert.equal(await readFile(join(folder, SEEN_FILE), 'utf8'), newer);
  const log = await readFile(join(folder, 'diagnostics.jsonl'), 'utf8');
  assert.match(log, /"step":"whats-new"/); assert.match(log, /LOCAL_FILE_NEWER/);
});
