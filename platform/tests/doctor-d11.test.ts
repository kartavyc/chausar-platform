// D11a task 11: `npm run doctor` checks the developer loop and prints one line per check with its fix. Every input is
// injected here (Node version, environment, PATH, the checkout's two lock files), so nothing on this computer is read
// and no tool is run.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor, MIN_NODE } from '../../scripts/doctor.mjs';

const lock = (packages: Record<string, { version: string; optional?: boolean }>) => JSON.stringify({ name: 'chausar-desktop', lockfileVersion: 3, packages: { '': { name: 'chausar-desktop' }, ...packages } });

async function checkout(t: TestContext, installed: Record<string, { version: string }> | null, tools: string[] = ['codex', 'claude']) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-doctor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package-lock.json'), lock({ 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' }, 'node_modules/c-win32': { version: '1.0.0', optional: true } }));
  if (installed) {
    await mkdir(join(root, 'node_modules'), { recursive: true });
    await writeFile(join(root, 'node_modules', '.package-lock.json'), lock(installed));
  }
  const bin = join(root, 'bin');
  await mkdir(bin);
  const suffix = process.platform === 'win32' ? '.cmd' : '';
  for (const tool of tools) await writeFile(join(bin, `${tool}${suffix}`), '', { mode: 0o755 });
  const env = { PATH: bin, Path: bin, PATHEXT: '.EXE;.CMD', CHAUSAR_RUN_ROOT: join(root, '..', 'doctor-runs'), CHAUSAR_HOME: join(root, '..', 'doctor-home') };
  return { root, env };
}

const lineFor = (lines: { name: string; ok: boolean; text: string; fix?: string }[], name: string) => {
  const line = lines.find(item => item.name === name);
  assert.ok(line, `a ${name} line`);
  return line;
};

test('a ready checkout: every check passes, each on one line', async t => {
  const c = await checkout(t, { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } });
  const lines = await doctor({ root: c.root, env: c.env, nodeVersion: 'v24.13.1' });
  assert.deepEqual(lines.map(line => line.name), ['node', 'run root', 'data home', 'codex', 'claude', 'node_modules']);
  assert.deepEqual(lines.filter(line => !line.ok), []);
  assert.match(lineFor(lines, 'run root').text, /doctor-runs/);
  assert.match(lineFor(lines, 'data home').text, /doctor-home/);
  assert.match(lineFor(lines, 'codex').text, /bin/);
});

test('an old Node gives its fix', async t => {
  const c = await checkout(t, { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } });
  for (const version of ['v22.11.0', 'v24.13.0', 'v24.9.9']) {
    const node = lineFor(await doctor({ root: c.root, env: c.env, nodeVersion: version }), 'node');
    assert.equal(node.ok, false, version);
    assert.match(node.fix ?? '', new RegExp(`Install Node ${MIN_NODE.replaceAll('.', '\\.')} or newer`));
  }
  assert.equal(MIN_NODE, '24.13.1');
  assert.equal(lineFor(await doctor({ root: c.root, env: c.env, nodeVersion: 'v25.0.0' }), 'node').ok, true);
});

test('node_modules that does not match the lockfile, or is missing, gives "npm ci" as the fix', async t => {
  const moved = await checkout(t, { 'node_modules/a': { version: '1.0.1' }, 'node_modules/b': { version: '2.0.0' } });
  const line = lineFor(await doctor({ root: moved.root, env: moved.env, nodeVersion: 'v24.13.1' }), 'node_modules');
  assert.equal(line.ok, false);
  assert.match(line.text, /node_modules\/a is 1\.0\.1, the lockfile says 1\.0\.0/);
  assert.match(line.fix ?? '', /npm ci/);
  const missing = await checkout(t, { 'node_modules/a': { version: '1.0.0' } });
  assert.match(lineFor(await doctor({ root: missing.root, env: missing.env, nodeVersion: 'v24.13.1' }), 'node_modules').text, /node_modules\/b is not installed/);
  const none = await checkout(t, null);
  const empty = lineFor(await doctor({ root: none.root, env: none.env, nodeVersion: 'v24.13.1' }), 'node_modules');
  assert.equal(empty.ok, false);
  assert.match(empty.fix ?? '', /npm ci/);
});

test('a missing Codex or Claude Code is named with where to get it; nothing is run', async t => {
  const c = await checkout(t, { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } }, ['claude']);
  const lines = await doctor({ root: c.root, env: c.env, nodeVersion: 'v24.13.1' });
  const codex = lineFor(lines, 'codex');
  assert.equal(codex.ok, false);
  assert.match(codex.fix ?? '', /Codex/);
  assert.equal(lineFor(lines, 'claude').ok, true);
});

test('a run root inside the checkout is refused with its fix', async t => {
  const c = await checkout(t, { 'node_modules/a': { version: '1.0.0' }, 'node_modules/b': { version: '2.0.0' } });
  await writeFile(join(c.root, 'package.json'), JSON.stringify({ name: 'chausar-desktop' }));
  await mkdir(join(c.root, '.git'));
  const line = lineFor(await doctor({ root: c.root, env: { ...c.env, CHAUSAR_RUN_ROOT: join(c.root, 'results') }, nodeVersion: 'v24.13.1' }), 'run root');
  assert.equal(line.ok, false);
  assert.match(line.fix ?? '', /CHAUSAR_RUN_ROOT/);
});
