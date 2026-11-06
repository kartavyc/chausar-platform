// D5 task 6: the headless smoke can run against a packaged build. `--packaged <unpacked dir>` takes the packaged program
// (Chausar.exe, or chausar on Linux), run with ELECTRON_RUN_AS_NODE so no window ever opens, and the worker inside that
// build's resources/app.asar.unpacked. Without the option the source paths stay as they were. Only the argument
// parsing is tested here; nothing is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const smokePath = '../../scripts/desktop-smoke.mjs';
const { parseSmokeArguments } = await import(smokePath);
const electronSmokePath = '../../scripts/desktop-electron-smoke.mjs';
const { parseElectronSmokeArguments } = await import(electronSmokePath);

async function packagedBuild(t: any, platform: 'win32' | 'linux', withProgram = true) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-smoke-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'resources', 'app.asar.unpacked', 'platform', 'runtime'), { recursive: true });
  if (withProgram) await writeFile(join(root, platform === 'win32' ? 'Chausar.exe' : 'chausar'), 'synthetic');
  return root;
}

test('with no option the smoke runs the source worker under this Node, as before', () => {
  assert.deepEqual(parseSmokeArguments([], { platform: 'win32' }), {
    packaged: null, worker: resolve(ROOT, 'platform/runtime/worker.ts'), packageJson: resolve(ROOT, 'package.json'),
  });
  assert.deepEqual(parseElectronSmokeArguments([], { platform: 'win32' }), { check: false, packaged: null });
  assert.deepEqual(parseElectronSmokeArguments(['--check'], { platform: 'win32' }), { check: true, packaged: null });
});

test('--packaged <dir> takes the packaged program and the worker inside that build', async t => {
  for (const platform of ['win32', 'linux'] as const) {
    const build = await packagedBuild(t, platform);
    const parsed = parseSmokeArguments(['--packaged', build], { platform });
    assert.deepEqual(parsed, {
      packaged: resolve(build),
      worker: join(resolve(build), 'resources', 'app.asar.unpacked', 'app', 'engine', 'dist', 'runtime', 'worker.js'),
      packageJson: join(resolve(build), 'resources', 'app.asar.unpacked', 'package.json'),
    });
    assert.deepEqual(parseElectronSmokeArguments(['--packaged', build], { platform }), {
      check: false, packaged: { folder: resolve(build), program: join(resolve(build), platform === 'win32' ? 'Chausar.exe' : 'chausar') },
    });
  }
});

test('--packaged refuses a missing value, a path that is not a folder, a folder with no program, and any other option', async t => {
  const build = await packagedBuild(t, 'win32');
  const file = join(build, 'Chausar.exe');
  const noProgram = await packagedBuild(t, 'win32', false);
  for (const parse of [parseSmokeArguments, parseElectronSmokeArguments]) {
    assert.throws(() => parse(['--packaged'], { platform: 'win32' }), /--packaged needs the unpacked build folder/);
    assert.throws(() => parse(['--packaged', '--check'], { platform: 'win32' }), /--packaged needs the unpacked build folder/);
    assert.throws(() => parse(['--packaged', file], { platform: 'win32' }), /is not a folder/);
    assert.throws(() => parse(['--packaged', join(build, 'nothing-here')], { platform: 'win32' }), /is not a folder/);
    assert.throws(() => parse(['--packaged', noProgram], { platform: 'win32' }), /has no Chausar\.exe/);
    assert.throws(() => parse(['--packaged', build], { platform: 'linux' }), /has no chausar/);
    assert.throws(() => parse(['--unknown'], { platform: 'win32' }), /Use only/);
    assert.throws(() => parse(['--packaged', build, '--packaged', build], { platform: 'win32' }), /Use only/);
  }
  assert.throws(() => parseSmokeArguments(['--check'], { platform: 'win32' }), /Use only/);
});
