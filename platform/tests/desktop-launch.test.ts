import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const modulePath = '../../scripts/desktop-launch.mjs';
const { desktopLaunchArguments, desktopLaunchPrerequisites, desktopLaunchEnvironment, desktopLaunchSpawnOptions } = await import(modulePath);

// One-shot A4 (hands-on row 2): windowsHide on the launch made Windows hide the app's first window, so npm run desktop
// showed nothing. The launch starts Electron like any window app: no shell, the cleaned environment, its own output.
test('the desktop launch never hides the window it starts', () => {
  const options = desktopLaunchSpawnOptions('/project', { PATH: 'tools', ELECTRON_RUN_AS_NODE: '1' });
  assert.notEqual(options.windowsHide, true);
  assert.equal(options.shell, false);
  assert.equal(options.stdio, 'inherit');
  assert.equal(options.cwd, '/project');
  assert.deepEqual(options.env, { PATH: 'tools' });
});

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

test('native launch cannot inherit Node mode or redirect the verified distribution through npm install selectors', () => {
  const environment = { PATH: 'installed-tools', CHAUSAR_HOME: 'app-owned-data', ELECTRON_RUN_AS_NODE: '1', ELECTRON_OVERRIDE_DIST_PATH: 'outside', ELECTRON_INSTALL_PLATFORM: 'linux', ELECTRON_INSTALL_ARCH: 'arm64', npm_config_arch: 'arm64', npm_config_platform: 'linux' };
  assert.deepEqual(desktopLaunchEnvironment(environment), { PATH: 'installed-tools', CHAUSAR_HOME: 'app-owned-data' });
  assert.equal(environment.ELECTRON_OVERRIDE_DIST_PATH, 'outside');
});
