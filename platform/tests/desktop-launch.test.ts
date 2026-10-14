import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
const modulePath = '../../scripts/desktop-launch.mjs';
const { desktopLaunchArguments, desktopLaunchPrerequisites, desktopLaunchEnvironment } = await import(modulePath);

test('desktop launcher requires an explicit mode and accepts no arbitrary Electron flags', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--background', '--check']), { demo: true, background: true, checkOnly: true, uiPreview: false, firstRunPreview: false, legacyRenderer: false });
  assert.deepEqual(desktopLaunchArguments(['--production']), { demo: false, background: false, checkOnly: false, uiPreview: false, firstRunPreview: false, legacyRenderer: false });
  for (const args of [[], ['--demo', '--production'], ['--demo', '--demo'], ['--demo', '--no-sandbox'], ['--demo', '--remote-debugging-port=9222']]) assert.throws(() => desktopLaunchArguments(args));
});

test('desktop launcher accepts the UI preview opt-in with an explicit mode', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--ui-preview']), { demo: true, background: false, checkOnly: false, uiPreview: true, firstRunPreview: false, legacyRenderer: false });
  assert.deepEqual(desktopLaunchArguments(['--production', '--ui-preview', '--check']), { demo: false, background: false, checkOnly: true, uiPreview: true, firstRunPreview: false, legacyRenderer: false });
  for (const args of [['--ui-preview'], ['--demo', '--ui-preview', '--ui-preview'], ['--demo', '--ui-preview', '--no-sandbox']]) assert.throws(() => desktopLaunchArguments(args));
});

test('first-run preview requires both explicit demo and UI modes without production, duplicate or arbitrary flags', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--ui-preview', '--first-run-preview']), { demo: true, background: false, checkOnly: false, uiPreview: true, firstRunPreview: true, legacyRenderer: false });
  assert.deepEqual(desktopLaunchArguments(['--demo', '--ui-preview', '--first-run-preview', '--check']), { demo: true, background: false, checkOnly: true, uiPreview: true, firstRunPreview: true, legacyRenderer: false });
  for (const args of [
    ['--first-run-preview'], ['--demo', '--first-run-preview'], ['--production', '--ui-preview', '--first-run-preview'],
    ['--demo', '--production', '--ui-preview', '--first-run-preview'], ['--demo', '--ui-preview', '--first-run-preview', '--first-run-preview'],
    ['--demo', '--demo', '--ui-preview', '--first-run-preview'], ['--demo', '--ui-preview', '--ui-preview', '--first-run-preview'],
    ['--demo', '--ui-preview', '--first-run-preview', '--no-sandbox'], ['--demo', '--ui-preview', '--first-run-preview=false'],
  ]) assert.throws(() => desktopLaunchArguments(args), (error: unknown) => error instanceof Error && [
    'Use --demo or --production, with optional --ui-preview, --legacy-renderer, --background and --check; --first-run-preview requires --demo and --ui-preview.',
    'Select exactly one launch mode: --demo or --production.',
    'First-run preview requires --demo and --ui-preview.',
  ].includes(error.message), JSON.stringify(args));
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

test('a parent launcher can select the same fresh temporary directory it gives the child', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'chausar-parent-launch-test-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const environment = { TEMP: temporary, TMP: temporary, TMPDIR: temporary };
  const launch = desktopLaunchEnvironment(environment, true, temporary);
  assert.equal(dirname(launch.CHAUSAR_DEMO_PROFILE_ROOT), realpathSync(temporary));
  assert.equal(existsSync(launch.CHAUSAR_DEMO_PROFILE_ROOT), false);
  assert.equal(launch.TEMP, temporary); assert.equal(launch.TMPDIR, temporary);
});

test('the legacy renderer flag is accepted as a fallback and unknown flags still refuse', () => {
  assert.deepEqual(desktopLaunchArguments(['--demo', '--legacy-renderer']), { demo: true, background: false, checkOnly: false, uiPreview: false, firstRunPreview: false, legacyRenderer: true });
  assert.throws(() => desktopLaunchArguments(['--demo', '--legacy-renderer', '--legacy-renderer']));
  assert.throws(() => desktopLaunchArguments(['--demo', '--legacy']));
});
