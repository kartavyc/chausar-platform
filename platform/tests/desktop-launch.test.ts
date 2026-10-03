import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
const modulePath = '../../scripts/desktop-launch.mjs';
const { desktopLaunchArguments, desktopLaunchPrerequisites, desktopLaunchEnvironment } = await import(modulePath);

test('desktop launcher requires an explicit mode and accepts no arbitrary Electron flags', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--background', '--check']), { demo: true, background: true, checkOnly: true, uiPreview: false });
  assert.deepEqual(desktopLaunchArguments(['--production']), { demo: false, background: false, checkOnly: false, uiPreview: false });
  for (const args of [[], ['--demo', '--production'], ['--demo', '--demo'], ['--demo', '--no-sandbox'], ['--demo', '--remote-debugging-port=9222']]) assert.throws(() => desktopLaunchArguments(args));
});

test('desktop launcher accepts the UI preview opt-in with an explicit mode', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--ui-preview']), { demo: true, background: false, checkOnly: false, uiPreview: true });
  assert.deepEqual(desktopLaunchArguments(['--production', '--ui-preview', '--check']), { demo: false, background: false, checkOnly: true, uiPreview: true });
  for (const args of [['--ui-preview'], ['--demo', '--ui-preview', '--ui-preview'], ['--demo', '--ui-preview', '--no-sandbox']]) assert.throws(() => desktopLaunchArguments(args));
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

test('demo launcher selects an unused explicit temporary root on every launch without creating a profile', () => {
  const original = { ELECTRON_RUN_AS_NODE: '1', CHAUSAR_DEMO_PROFILE_ROOT: '/real/profile', PATH: 'installed-tools' };
  const first = desktopLaunchEnvironment(original, true), second = desktopLaunchEnvironment(original, true);
  assert.equal(dirname(first.CHAUSAR_DEMO_PROFILE_ROOT), realpathSync(tmpdir()));
  assert.notEqual(first.CHAUSAR_DEMO_PROFILE_ROOT, second.CHAUSAR_DEMO_PROFILE_ROOT);
  assert.equal(existsSync(first.CHAUSAR_DEMO_PROFILE_ROOT), false);
  assert.equal(first.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(original.CHAUSAR_DEMO_PROFILE_ROOT, '/real/profile');
  assert.equal(desktopLaunchEnvironment(original, false).CHAUSAR_DEMO_PROFILE_ROOT, '/real/profile');
});
