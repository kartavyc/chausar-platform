// D12 task 7: a per-computer file written by a newer Chausar is left alone. Each reader knows its own format or version;
// a newer one is ignored (the reader works without it), never rewritten or removed, and noted once in the custody
// diagnostics. So after a rollback, the older Chausar does not clobber what the newer one kept. The files in this lane:
// business cards (custody/cards), the AI setup (custody/ai-setup.json) and the kept tool looks (custody/cli-looks.json).
// C5's preferences.json, exports.json and updates/*.json, C7's seen.json and D12's data-versions.json join after the
// rebase, on the same helper.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CustodyFiles, newCard } from '../runtime/workspace-custody.ts';
import { aiSetupFile } from '../runtime/venture/models/ai-setup-file.ts';
import { readAiSetup } from '../runtime/venture/models/ai-setup.ts';
import { cliLookFile, cliLookPath, readKeptLooks } from '../runtime/venture/models/cli-look-file.ts';

async function home(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-local-files-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'custody', 'cards'), { recursive: true });
  return directory;
}
const notes = async (directory: string) => (await readFile(join(directory, 'custody', 'diagnostics.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));

test('a newer business card is ignored, never rewritten or removed, and noted once', async t => {
  const directory = await home(t);
  const path = join(directory, 'custody', 'cards', 'sample-tutoring.json');
  const newer = JSON.stringify({ format: 'chausar.vault-card.v99', folder: 'sample-tutoring', futureField: true });
  await writeFile(path, newer);
  const custody = new CustodyFiles(directory);
  assert.equal(await custody.readCard('sample-tutoring'), null);
  assert.deepEqual(await custody.listCards(), []);
  await custody.writeCard({ ...newCard({ folder: 'sample-tutoring', unlock: 'this-computer', recovery: 'unknown' }), name: 'Sample tutoring' });
  await custody.removeCard('sample-tutoring');
  await custody.writeCard({ ...newCard({ folder: 'sample-tutoring', unlock: 'this-computer', recovery: 'unknown' }), name: 'Sample tutoring' });
  assert.equal(await readFile(path, 'utf8'), newer, 'the bytes are unchanged');
  const lines = (await notes(directory)).filter(line => line.code === 'LOCAL_FILE_NEWER');
  assert.equal(lines.length, 1, 'noted once');
  assert.deepEqual([lines[0].op, lines[0].step], ['local-file', 'card']);
});

test('a card of this version is still written and removed as before', async t => {
  const directory = await home(t);
  const custody = new CustodyFiles(directory);
  await custody.writeCard({ ...newCard({ folder: 'sample-shop', unlock: 'this-computer', recovery: 'unknown' }), name: 'Sample shop' });
  assert.equal((await custody.readCard('sample-shop'))?.name, 'Sample shop');
  await custody.removeCard('sample-shop');
  assert.equal(await custody.readCard('sample-shop'), null);
});

test('a newer AI setup file is ignored, and neither a new setup nor a clear touches it', async t => {
  const directory = await home(t);
  const path = join(directory, 'custody', 'ai-setup.json');
  const newer = JSON.stringify({ format: 'chausar.ai-setup.v99', from: { workspaceId: 'workspace_x', name: 'Sample' }, at: '2026-12-01T00:00:00.000Z' });
  await writeFile(path, newer);
  const port = aiSetupFile(path);
  assert.equal(readAiSetup(await port.read()), null, 'the reader works without it');
  await port.write({ format: 'chausar.ai-setup.v1', from: { workspaceId: 'workspace_y', name: 'Other' }, at: '2026-11-06T10:00:00.000Z', connections: [], models: {} } as any);
  await port.clear();
  assert.equal(await readFile(path, 'utf8'), newer);
  assert.equal((await notes(directory)).filter(line => line.code === 'LOCAL_FILE_NEWER' && line.step === 'ai-setup').length, 1);
});

test('newer kept tool looks are ignored and not replaced', async t => {
  const directory = await home(t);
  const path = cliLookPath(directory);
  const newer = JSON.stringify({ version: 99, looks: { codex: { anything: 'from a newer Chausar' } } });
  await writeFile(path, newer);
  const port = cliLookFile(path);
  assert.deepEqual(readKeptLooks(await port.read()), {}, 'the reader works without it');
  await port.write({});
  assert.equal(await readFile(path, 'utf8'), newer);
  assert.equal((await notes(directory)).filter(line => line.code === 'LOCAL_FILE_NEWER' && line.step === 'cli-looks').length, 1);
});

test('a damaged file of no known kind is still replaced, as before (only a newer version is protected)', async t => {
  const directory = await home(t);
  const path = cliLookPath(directory);
  await writeFile(path, '{ not json');
  await cliLookFile(path).write({});
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { version: 1, looks: {} });
});
