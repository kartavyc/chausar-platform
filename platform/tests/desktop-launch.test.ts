import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const modulePath = '../../scripts/desktop-launch.mjs';
const { desktopLaunchArguments, desktopLaunchPrerequisites } = await import(modulePath);

test('desktop launcher requires an explicit mode and accepts no arbitrary Electron flags', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--background', '--check']), { demo: true, background: true, checkOnly: true });
  assert.deepEqual(desktopLaunchArguments(['--production']), { demo: false, background: false, checkOnly: false });
  for (const args of [[], ['--demo', '--production'], ['--demo', '--demo'], ['--demo', '--no-sandbox'], ['--demo', '--remote-debugging-port=9222']]) assert.throws(() => desktopLaunchArguments(args));
});

test('launcher fails closed on missing, mismatched or redirected local Electron without running it', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-launch-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { electron: '44.4.5' } }));
  await assert.rejects(desktopLaunchPrerequisites(root), (error: any) => error.code === 'ENOENT');
  await mkdir(join(root, 'node_modules/electron'), { recursive: true });
  const path = join(root, 'node_modules/electron/package.json');
  await writeFile(path, JSON.stringify({ version: '1.0.0', bin: 'cli.js' })); await assert.rejects(desktopLaunchPrerequisites(root), /exact project pin/);
  await writeFile(path, JSON.stringify({ version: '44.4.5', bin: '../../outside.js' })); await assert.rejects(desktopLaunchPrerequisites(root), /inside its installed package/);
});
