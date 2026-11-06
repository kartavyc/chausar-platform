// D7 task 6, the additive half: every build bundles the engine (scripts/bundle-engine.mjs) between the Ink build and
// electron-builder, carries app/engine/dist as its own file set (the 64 KB pattern lesson, desktop-package.mjs) and
// unpacks it, and the receipt records the bundle. The engine source still ships beside it until desktop main runs the
// bundle (task 5), and the engine source leaves the builder files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modulePath = '../../scripts/desktop-package.mjs';
const desktopPackage = await import(modulePath);
const { ENGINE_BUNDLE, validateEngineBundleConfig, engineReceipt, desktopPackageCommands, createDesktopPackagePlan, desktopPackagePrerequisites, ICON_FILES } = desktopPackage;
const read = async (name: string) => JSON.parse(await readFile(new URL(`../../app/desktop/${name}`, import.meta.url), 'utf8'));
const CONFIGS = { beta: await read('builder.beta.json'), preview: await read('builder.preview.json'), final: await read('builder.json') } as const;
const FILE = { beta: 'builder.beta.json', preview: 'builder.preview.json', final: 'builder.json' } as const;
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

async function fixture(t: any, mode: keyof typeof CONFIGS, config: unknown) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-engine-bundle-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['app/desktop/icons/png', 'app/ui/src', 'platform/runtime', 'scripts']) await mkdir(join(root, path), { recursive: true });
  for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'app/desktop/icon@1.5x.png', 'app/desktop/icon@2x.png', ...ICON_FILES, './scripts/desktop-after-pack.cjs', 'platform/runtime/worker.ts', 'app/ui/index.html', 'app/ui/src/main.tsx', 'app/ui/vite.config.ts']) await writeFile(join(root, path), '// Unit-test source; never launched.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  for (const each of ['beta', 'preview', 'final'] as const) await writeFile(join(root, 'app/desktop', FILE[each]), JSON.stringify(each === mode ? config : CONFIGS[each]));
  return root;
}

test('every builder file carries the engine bundle as its own file set, unpacked', async t => {
  assert.deepEqual(ENGINE_BUNDLE.fileSet, { from: 'app/engine/dist', to: 'app/engine/dist', filter: ['**/*'] });
  assert.equal(ENGINE_BUNDLE.unpack, 'app/engine/dist/**/*');
  for (const [mode, config] of Object.entries(CONFIGS)) {
    validateEngineBundleConfig(config);
    assert.ok(config.files.some((entry: unknown) => JSON.stringify(entry) === JSON.stringify(ENGINE_BUNDLE.fileSet)), mode);
    assert.ok(config.asarUnpack.includes(ENGINE_BUNDLE.unpack), mode);
  }
  for (const mode of ['beta', 'preview', 'final'] as const) {
    const config = CONFIGS[mode];
    const variants = [
      { ...config, files: config.files.filter((entry: unknown) => JSON.stringify(entry) !== JSON.stringify(ENGINE_BUNDLE.fileSet)) },
      { ...config, files: [...config.files.filter((entry: unknown) => JSON.stringify(entry) !== JSON.stringify(ENGINE_BUNDLE.fileSet)), 'app/engine/dist/**/*'] },
      { ...config, asarUnpack: config.asarUnpack.filter((glob: string) => glob !== ENGINE_BUNDLE.unpack) },
      { ...config, files: [...config.files, 'app/engine/maps/**/*'] },
    ];
    for (const variant of variants) {
      assert.throws(() => validateEngineBundleConfig(variant), /engine bundle/);
      const result = await desktopPackagePrerequisites({ root: await fixture(t, mode, variant), plan: createDesktopPackagePlan({ mode }), environment: {} });
      const failure = result.failures.find((item: any) => item.check === 'packaging configuration');
      assert.ok(failure, mode);
      assert.match(failure.reason, /engine bundle/);
    }
  }
});

// D7 task 6: main runs the bundle (task 5), so the engine source leaves all three builder files. The one file main still
// reads from the archive is the credential contract.
test('no build ships the engine source, its helpers or the fixtures; the credential contract stays in the archive', async t => {
  const SOURCE = ['platform/runtime', 'platform/semantic-qualification', 'platform/helpers', 'fixtures'];
  for (const [mode, config] of Object.entries(CONFIGS)) {
    const text = (entry: any) => (typeof entry === 'string' ? entry : entry?.from ?? '').replace(/^!/, '');
    for (const entry of [...config.files, ...config.asarUnpack]) {
      if (text(entry) === ENGINE_BUNDLE.contract) continue;
      assert.ok(!SOURCE.some(source => text(entry).startsWith(source)), mode + ': ' + text(entry));
    }
    assert.ok(config.files.includes(ENGINE_BUNDLE.contract), mode);
    assert.ok(!config.asarUnpack.includes(ENGINE_BUNDLE.contract), mode + ': main reads it from the archive');
    assert.ok(!config.files.includes('app/**/*'), mode + ': a glob over app/ would take the source maps too');
  }
  for (const mode of ['beta', 'preview', 'final'] as const) {
    const config = CONFIGS[mode];
    for (const variant of [
      { ...config, files: [...config.files, 'platform/runtime/**/*'] },
      { ...config, files: [...config.files, { from: 'platform/runtime', to: 'platform/runtime', filter: ['**/*'] }] },
      { ...config, files: config.files.filter((entry: unknown) => entry !== ENGINE_BUNDLE.contract) },
      { ...config, asarUnpack: [...config.asarUnpack, 'platform/helpers/**/*'] },
    ]) {
      const result = await desktopPackagePrerequisites({ root: await fixture(t, mode, variant), plan: createDesktopPackagePlan({ mode }), environment: {} });
      assert.ok(result.failures.some((item: any) => item.check === 'packaging configuration' && /engine source|credential contract/.test(item.reason)), mode + ' ' + JSON.stringify(variant.files.at(-1)));
    }
  }
});

test('packaging runs the Ink build, then the engine bundle, then electron-builder', () => {
  const plan = createDesktopPackagePlan();
  const commands = desktopPackageCommands(plan, { cliPath: '/local/electron-builder/cli.js', viteCli: '/local/vite/bin/vite.js' });
  assert.deepEqual(commands.map((command: any) => command.name), ['Ink build', 'engine bundle', 'electron-builder']);
  assert.deepEqual(commands[1].args, ['scripts/bundle-engine.mjs']);
  assert.equal(pkg.scripts['build:engine'], `node ${commands[1].args.join(' ')}`, 'the package build and npm run build:engine are the same bundle');
});

test('the receipt records the bundle from its manifest', () => {
  assert.deepEqual(engineReceipt({ schemaVersion: 1, entries: ['runtime/worker.js'], chunks: 262, bytes: 10709006, files: 297, rolldown: '1.2.16', sourceCommit: 'abc', maps: 'x' }),
    { entries: ['runtime/worker.js'], chunks: 262, bytes: 10709006, files: 297, rolldown: '1.2.16', sourceCommit: 'abc' });
  assert.throws(() => engineReceipt({ entries: [] }), /engine bundle/);
});
