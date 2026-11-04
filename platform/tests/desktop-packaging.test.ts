import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// A variable import allows Node's native TypeScript test runner to exercise the JS CLI without a TS emit step.
const modulePath = '../../scripts/desktop-package.mjs';
const desktopPackage = await import(modulePath);
const { createDesktopPackagePlan, parseDesktopPackageArguments, desktopPackagingEnvironment, desktopPackagePrerequisites, packageDesktop, validateElectronExecutable, validateLocalElectronDistribution, validateDesktopPackagingOutput, validateInkPackagingConfig, desktopPackageCommands, INK_SOURCE_EXCLUSIONS, ICON_FILES } = desktopPackage;
const preview = JSON.parse(await readFile(new URL('../../app/desktop/builder.preview.json', import.meta.url), 'utf8'));
const final = JSON.parse(await readFile(new URL('../../app/desktop/builder.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
// Wave 6 (6J1, D3): the unsigned beta installer's own configuration; read leniently so the older tests stand alone.
const beta = JSON.parse(await readFile(new URL('../../app/desktop/builder.beta.json', import.meta.url), 'utf8').catch(() => '{}'));

async function fixture(t: any, config = preview, betaConfig = beta) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-package-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['app/desktop/icons/png', 'app/ui/src', 'platform/runtime', 'scripts']) await mkdir(join(root, path), { recursive: true });
  for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'app/desktop/icon@1.5x.png', 'app/desktop/icon@2x.png', ...ICON_FILES, 'scripts/desktop-after-pack.cjs', 'platform/runtime/worker.ts', 'app/ui/index.html', 'app/ui/src/main.tsx', 'app/ui/vite.config.ts']) await writeFile(join(root, path), '// Unit-test source; never launched.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(root, 'app/desktop/builder.preview.json'), JSON.stringify(config));
  await writeFile(join(root, 'app/desktop/builder.json'), JSON.stringify(final));
  await writeFile(join(root, 'app/desktop/builder.beta.json'), JSON.stringify(betaConfig));
  return root;
}

test('package versions must use the same canonical semantic policy as the running updater', async t => {
  const root = await fixture(t);
  for (const version of ['1.2.3+build.1', '1.02.3', '1.2.3-01']) {
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...pkg, version }));
    const result = await desktopPackagePrerequisites({ root });
    assert.equal(result.ok, false);
    assert.ok(result.failures.some((failure: any) => /semantic version|unambiguous/.test(failure.reason)));
  }
});

test('all six native targets have explicit architecture, configuration and no-publish arguments', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    for (const architecture of ['x64', 'arm64']) {
      const plan = createDesktopPackagePlan({ platform, architecture, hostPlatform: platform, hostArchitecture: architecture });
      assert.equal(plan.target, `${platform}-${architecture}`);
      assert.equal(plan.mode, 'preview');
      assert.equal(plan.config, 'app/desktop/builder.preview.json');
      assert.equal(plan.output, 'release/preview');
      assert.ok(plan.builderArguments.includes(`--${architecture}`));
      assert.deepEqual(plan.builderArguments.slice(-2), ['--publish', 'never']);
    }
  }
});

test('unsupported targets and cross-host builds are refused before a packaging child can run', () => {
  assert.throws(() => createDesktopPackagePlan({ platform: 'freebsd' }), /supported targets/);
  assert.throws(() => createDesktopPackagePlan({ architecture: 'ia32' }), /supported targets/);
  assert.throws(() => createDesktopPackagePlan({ platform: 'darwin', architecture: 'arm64', hostPlatform: 'win32', hostArchitecture: 'x64' }), /matching native host/);
  assert.throws(() => createDesktopPackagePlan({ platform: 'linux', architecture: 'arm64', hostPlatform: 'linux', hostArchitecture: 'x64' }), /matching native host/);
  assert.throws(() => createDesktopPackagePlan({ mode: 'unsigned-final' }), /mode/);
});

test('final packaging keeps the original signed config and never publishes', () => {
  const plan = createDesktopPackagePlan({ mode: 'final', unpacked: true });
  assert.equal(plan.config, 'app/desktop/builder.json');
  assert.equal(plan.output, 'release');
  assert.ok(plan.builderArguments.includes('--dir'));
  assert.deepEqual(plan.builderArguments.slice(-3), ['--publish', 'never', '--dir']);
  assert.equal(final.forceCodeSigning, true);
  assert.equal(final.win.signAndEditExecutable, true);
  assert.equal(final.mac.hardenedRuntime, true);
  assert.equal(final.publish, null);
});

test('CLI accepts only bounded packaging options and refuses injected builder or publishing flags', () => {
  assert.deepEqual(parseDesktopPackageArguments(['--mode', 'preview', '--platform', 'win32', '--arch', 'x64', '--dir', '--check']), { mode: 'preview', platform: 'win32', architecture: 'x64', unpacked: true, checkOnly: true });
  // A2 review: shipping a bundled Codex with no recorded setup takes an explicit flag.
  assert.deepEqual(parseDesktopPackageArguments(['--mode', 'beta', '--allow-unrecorded-codex']), { mode: 'beta', allowUnrecordedCodex: true });
  assert.equal(createDesktopPackagePlan({ mode: 'beta', platform: 'win32', architecture: 'x64', hostPlatform: 'win32', hostArchitecture: 'x64', allowUnrecordedCodex: true }).allowUnrecordedCodex, true);
  assert.equal('allowUnrecordedCodex' in createDesktopPackagePlan({ mode: 'beta', platform: 'win32', architecture: 'x64', hostPlatform: 'win32', hostArchitecture: 'x64' }), false);
  for (const args of [['--mode'], ['--arch', '--check'], ['--publish', 'always'], ['--config', 'other.json'], ['--mode', 'preview', '--mode', 'final'], ['--check', '--check'], ['--dir', '--dir']]) assert.throws(() => parseDesktopPackageArguments(args));
});

test('preview packaging removes credentials from the child environment without mutating its parent', () => {
  const source = { PATH: 'local-tools', SystemRoot: 'Windows', CSC_LINK: 'private', WIN_CSC_LINK: 'private', APPLE_ID: 'private', CHAUSAR_RELEASE_PRIVATE_KEY_FILE: 'private', CHAUSAR_POSTGRES_URL: 'private', GH_TOKEN: 'private', GITHUB_TOKEN: 'private', AWS_SECRET_ACCESS_KEY: 'private', KEYGEN_TOKEN: 'private', NPM_TOKEN: 'private', COMPOSIO_API_KEY: 'private', DATABASE_PASSWORD: 'private', CSC_IDENTITY_AUTO_DISCOVERY: 'true' };
  const child = desktopPackagingEnvironment('preview', source);
  assert.deepEqual(child, { PATH: 'local-tools', SystemRoot: 'Windows', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  assert.equal(source.CSC_LINK, 'private');
  assert.deepEqual(desktopPackagingEnvironment('final', source), source);
});

test('preview metadata, resources and native signing settings are distinct from the final installer', () => {
  assert.notEqual(preview.appId, final.appId);
  assert.equal(preview.productName, 'Chausar Unsigned Preview');
  assert.notEqual(preview.productName, final.productName);
  assert.equal(preview.extraMetadata.chausarPreview, true);
  assert.equal(preview.extraMetadata.chausarReleaseChannel, 'unsigned-preview');
  assert.equal(preview.extraMetadata.name, 'chausar-preview');
  assert.equal(preview.forceCodeSigning, false);
  assert.deepEqual(preview.extraResources, []);
  assert.equal(preview.npmRebuild, false);
  assert.deepEqual(preview.win.target, ['zip']);
  assert.equal(preview.electronDist, 'node_modules/electron/dist');
  assert.equal(preview.nsis, undefined);
  assert.deepEqual(final.win.target, ['nsis']);
});

test('a missing logo file stops packaging at the source check, and a config without the logo at the configuration check (A7)', async t => {
  const root = await fixture(t);
  await rm(join(root, 'app/desktop/icons/png/256x256.png'));
  await writeFile(join(root, 'app/desktop/builder.preview.json'), JSON.stringify({ ...preview, linux: { ...preview.linux, icon: undefined } }));
  const result = await desktopPackagePrerequisites({ root, environment: {} });
  assert.ok(result.failures.some((failure: any) => failure.check === 'desktop source entrypoints'));
  assert.ok(result.failures.some((failure: any) => failure.check === 'packaging configuration' && /icon/.test(failure.reason)));
});

test('the tray\'s 1.5x and 2x PNGs are checked source files too (A7 fix round 1)', async t => {
  for (const name of ['icon@1.5x.png', 'icon@2x.png']) {
    const root = await fixture(t);
    await rm(join(root, 'app/desktop', name));
    const result = await desktopPackagePrerequisites({ root, environment: {} });
    assert.ok(result.failures.some((failure: any) => failure.check === 'desktop source entrypoints'), name);
  }
});

const RCEDIT_CHECK = 'Windows exe icon tool (rcedit.exe)';
// Plans are only made for the native host, so the Windows half runs on Windows and the other half elsewhere.
test('a Windows build checks the pinned rcedit.exe before anything runs: missing or different is refused, the pinned one passes (A7 fix round 1)', { skip: process.platform !== 'win32' }, async t => {
  const RCEDIT = 'node_modules/electron-winstaller/vendor/rcedit.exe', CHECK = RCEDIT_CHECK;
  const windows = (mode: string) => createDesktopPackagePlan({ mode, platform: 'win32', architecture: process.arch });
  const missing = await fixture(t);
  const none = await desktopPackagePrerequisites({ root: missing, plan: windows('beta'), environment: {} });
  assert.match(none.failures.find((failure: any) => failure.check === CHECK)?.reason ?? '', /missing.*nothing is downloaded/);
  const other = await fixture(t);
  await mkdir(join(other, 'node_modules/electron-winstaller/vendor'), { recursive: true });
  await writeFile(join(other, RCEDIT), 'not the tool');
  for (const mode of ['beta', 'preview']) {
    const result = await desktopPackagePrerequisites({ root: other, plan: windows(mode), environment: {} });
    assert.match(result.failures.find((failure: any) => failure.check === CHECK)?.reason ?? '', /not the pinned one/, mode);
  }
  const pinned = await fixture(t);
  await mkdir(join(pinned, 'node_modules/electron-winstaller/vendor'), { recursive: true });
  await writeFile(join(pinned, RCEDIT), await readFile(new URL(`../../${RCEDIT}`, import.meta.url)));
  assert.ok((await desktopPackagePrerequisites({ root: pinned, plan: windows('beta'), environment: {} })).checks.includes(CHECK));
  // A final build has electron-builder edit the exe itself.
  const final = await desktopPackagePrerequisites({ root: missing, plan: windows('final'), environment: {} });
  assert.ok(![...final.checks, ...final.failures.map((failure: any) => failure.check)].includes(CHECK));
});

test('a Linux or macOS build never asks for rcedit.exe (A7 fix round 1)', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  for (const mode of ['beta', 'preview']) {
    if (mode === 'beta' && process.platform === 'darwin') continue;
    const result = await desktopPackagePrerequisites({ root, plan: createDesktopPackagePlan({ mode }), environment: {} });
    assert.ok(![...result.checks, ...result.failures.map((failure: any) => failure.check)].includes(RCEDIT_CHECK), mode);
  }
});

test('preview preflight is read-only and identifies missing local dependencies without requiring signing keys', async t => {
  const root = await fixture(t);
  const before = await readdir(root);
  const result = await desktopPackagePrerequisites({ root, environment: {} });
  assert.equal(result.ok, false);
  assert.ok(result.checks.includes('packaging configuration'));
  assert.ok(result.checks.includes('desktop source entrypoints'));
  assert.ok(result.failures.some((failure: any) => failure.check === 'locked local packaging dependencies and Electron distribution'));
  assert.ok(!result.failures.some((failure: any) => /sign|runtime manifest|vendored|notar/i.test(failure.check)));
  assert.deepEqual(await readdir(root), before);
  const attempt = await packageDesktop({ root, environment: {} });
  assert.equal(attempt.packaged, false);
  assert.deepEqual(await readdir(root), before);
});

test('both configurations ship the Ink build and none of its sources, tooling or the retired renderer', () => {
  for (const config of [preview, final]) {
    validateInkPackagingConfig(config);
    assert.ok(config.files.includes('app/ui/dist/**/*'));
    for (const glob of INK_SOURCE_EXCLUSIONS) assert.ok(config.files.includes(glob), glob);
    assert.equal(JSON.stringify(config).includes('app/renderer'), false);
  }
  for (const glob of ['!app/ui/src/**/*', '!app/ui/tests/**/*', '!app/ui/public/**/*', '!app/ui/vite.config.ts', '!app/ui/vitest.config.ts']) assert.ok(INK_SOURCE_EXCLUSIONS.includes(glob), glob);
  for (const config of [
    { ...preview, files: preview.files.map((glob: string) => glob === 'app/ui/dist/**/*' ? 'app/renderer/**/*' : glob) },
    { ...preview, files: preview.files.filter((glob: string) => glob !== 'app/ui/dist/**/*') },
    { ...final, files: final.files.filter((glob: string) => glob !== '!app/ui/src/**/*') },
    { ...final, files: [...final.files, 'app/renderer/**/*'] },
    { ...preview, asarUnpack: [...preview.asarUnpack, 'app/ui/dist/**/*'] },
  ]) assert.throws(() => validateInkPackagingConfig(config));
});

test('packaging builds Ink with the local Vite CLI, as npm run build:ui does, before electron-builder runs', () => {
  const plan = createDesktopPackagePlan();
  const commands = desktopPackageCommands(plan, { cliPath: '/local/electron-builder/cli.js', viteCli: '/local/vite/bin/vite.js' });
  assert.deepEqual(commands.map((command: any) => command.name), ['Ink build', 'electron-builder']);
  assert.deepEqual(commands[0].args, ['/local/vite/bin/vite.js', 'build', '--config', 'app/ui/vite.config.ts']);
  assert.equal(pkg.scripts['build:ui'], `vite ${commands[0].args.slice(1).join(' ')}`, 'the package build and npm run build:ui are the same build');
  assert.deepEqual(commands[1].args, ['/local/electron-builder/cli.js', ...plan.builderArguments]);
  assert.ok(pkg.devDependencies.vite, 'vite is a pinned dependency the prerequisites check');
});

test('preview checks refuse accidental final signing, runtime bundling, inheritance or build hooks', async t => {
  const variants = [
    { ...preview, files: preview.files.map((glob: string) => glob === 'app/ui/dist/**/*' ? 'app/renderer/**/*' : glob) },
    { ...preview, forceCodeSigning: true },
    { ...preview, productName: final.productName },
    { ...preview, extraMetadata: { ...preview.extraMetadata, chausarPreview: false } },
    { ...preview, publish: { provider: 'github' } },
    { ...preview, extraResources: [{ from: 'runtime-binaries', to: 'runtime-binaries' }] },
    { ...preview, directories: { output: '../outside' } },
    { ...preview, extends: './builder.json' },
    { ...preview, afterPack: 'unexpected-hook.cjs' },
    { ...preview, npmRebuild: true },
    { ...preview, electronDist: 'https://example.invalid/electron' },
    { ...preview, win: { ...preview.win, target: ['nsis', 'zip'] } },
  ];
  for (const config of variants) {
    const result = await desktopPackagePrerequisites({ root: await fixture(t, config), environment: {} });
    assert.ok(result.failures.some((failure: any) => failure.check === 'packaging configuration'));
  }
});

test('a caller cannot alter a plan to inject builder arguments or write outside the output folder', async t => {
  const root = await fixture(t), plan = createDesktopPackagePlan();
  await assert.rejects(desktopPackagePrerequisites({ root, plan: { ...plan, builderArguments: ['--publish', 'always'] } }), /unchanged native plan/);
  await assert.rejects(packageDesktop({ root, plan: { ...plan, output: '../outside' } }), /unchanged native plan/);
});

test('lockfiles with missing integrity or conflicting root pins block packaging before installation', async t => {
  const root = await fixture(t);
  const rootEntry = { version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { '': rootEntry } }));
  let result = await desktopPackagePrerequisites({ root, environment: {} });
  assert.match(result.failures[0].reason, /exact .* pin/);
  const packages: Record<string, any> = { '': rootEntry };
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) packages[`node_modules/${name}`] = { version, resolved: 'https://registry.npmjs.org/test-fixture.tgz' };
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages }));
  result = await desktopPackagePrerequisites({ root, environment: {} });
  assert.match(result.failures[0].reason, /integrity hashes/);
});

test('final mode continues to report absent runtimes and signing prerequisites', async t => {
  const root = await fixture(t);
  const result = await desktopPackagePrerequisites({ root, plan: createDesktopPackagePlan({ mode: 'final' }), environment: {} });
  assert.equal(result.ok, false);
  assert.ok(result.failures.some((failure: any) => failure.check === 'final: Ed25519 release manifest signing key pair'));
  assert.ok(result.failures.some((failure: any) => failure.check.startsWith('final: vendored ')));
  assert.ok(result.failures.some((failure: any) => failure.check === 'final: complete runtime integrity and provenance manifest'));
});

test('read-only native header validation refuses wrong Windows architecture and malformed executable data', async t => {
  const root = await fixture(t), path = join(root, 'never-executed-header-fixture.bin');
  // Header test bytes are temporary fixtures. They never enter an Electron distribution or package artifact.
  const bytes = Buffer.alloc(4096); bytes.write('MZ', 0); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  await writeFile(path, bytes);
  await validateElectronExecutable(path, 'win32', 'x64');
  await assert.rejects(validateElectronExecutable(path, 'win32', 'arm64'), /architecture differs/);
  await writeFile(path, Buffer.alloc(4096));
  await assert.rejects(validateElectronExecutable(path, 'win32', 'x64'), /PE executable/);
});

test('freshness checks preserve previous receipts and interrupted artifacts and never relabel stale output', async t => {
  const root = await fixture(t), plan = createDesktopPackagePlan();
  const fresh = await validateDesktopPackagingOutput({ root, plan, version: pkg.version });
  assert.equal(fresh.expectedArtifacts.length, process.platform === 'win32' ? 1 : 2);
  if (process.platform === 'win32') assert.match(fresh.expectedArtifacts[0], /-win-(x64|arm64)\.zip$/);
  await mkdir(join(root, 'release/preview'), { recursive: true });
  const previousReceipt = 'previous qualification evidence';
  await writeFile(fresh.receiptPath, previousReceipt);
  await assert.rejects(validateDesktopPackagingOutput({ root, plan, version: pkg.version }), /output directory is not empty/);
  assert.equal(await readFile(fresh.receiptPath, 'utf8'), previousReceipt);
  const other = await fixture(t), artifact = fresh.expectedArtifacts[0];
  await mkdir(join(other, 'release/preview'), { recursive: true });
  await writeFile(join(other, 'release/preview', artifact), 'old output; never executed');
  await assert.rejects(validateDesktopPackagingOutput({ root: other, plan, version: pkg.version }), /output directory is not empty/);
  assert.equal(await readFile(join(other, 'release/preview', artifact), 'utf8'), 'old output; never executed');
});

test('output validation refuses a symlinked release directory before a builder can write outside the checkout', async t => {
  const root = await fixture(t), outside = await fixture(t);
  try { await symlink(outside, join(root, 'release'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error: any) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('This host cannot create a disposable test symlink.'); return; } throw error; }
  await assert.rejects(validateDesktopPackagingOutput({ root, version: pkg.version }), /real directories inside the checkout/);
  assert.ok(!(await readdir(outside)).includes('preview'));
});

test('final executable leftovers and interrupted unpacked directories block rebuilding without overwriting evidence', async t => {
  const root = await fixture(t), finalPlan = createDesktopPackagePlan({ mode: 'final' });
  await mkdir(join(root, 'release'));
  const priorInstaller = join(root, 'release', 'previous-final.exe');
  await writeFile(priorInstaller, 'interrupted final output; never executed');
  await assert.rejects(validateDesktopPackagingOutput({ root, plan: finalPlan, version: pkg.version }), /output directory is not empty/);
  assert.equal(await readFile(priorInstaller, 'utf8'), 'interrupted final output; never executed');
  const other = await fixture(t), previewPlan = createDesktopPackagePlan({ unpacked: true });
  await mkdir(join(other, 'release/preview', `${process.platform}-unpacked`), { recursive: true });
  await assert.rejects(validateDesktopPackagingOutput({ root: other, plan: previewPlan, version: pkg.version }), /output directory is not empty/);
  assert.deepEqual(await readdir(join(other, 'release/preview')), [`${process.platform}-unpacked`]);
});

test('local Electron distribution validation checks version without importing or executing Electron', async t => {
  const root = await fixture(t), electronRoot = join(root, 'unit-test-electron'), dist = join(electronRoot, 'dist');
  await mkdir(dist, { recursive: true });
  // Disposable PE headers model only validation. They are never used as a release distribution.
  const bytes = Buffer.alloc(4096); bytes.write('MZ', 0); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(0x8664, 132);
  await writeFile(join(dist, 'electron.exe'), bytes);
  await writeFile(join(electronRoot, 'path.txt'), 'electron.exe');
  await writeFile(join(dist, 'version'), '44.4.5');
  await validateLocalElectronDistribution(electronRoot, '44.4.5', 'win32', 'x64');
  await assert.rejects(validateLocalElectronDistribution(electronRoot, '44.4.6', 'win32', 'x64'), /dist version differs/);
  await assert.rejects(validateLocalElectronDistribution(electronRoot, '44.4.5', 'win32', 'arm64'), /architecture differs/);
  await writeFile(join(electronRoot, 'path.txt'), 'other.exe');
  await assert.rejects(validateLocalElectronDistribution(electronRoot, '44.4.5', 'win32', 'x64'), /target platform/);
});

// ---------------------------------------------------------------------------
// Wave 6, package 6J1 (D3, D12, D36): the unsigned beta. A Windows installer (NSIS, per user, no admin) and Linux
// AppImage and tar.gz, real data (not the synthetic preview), Codex bundled with its LICENSE and NOTICE, no signing,
// no publishing and no update channel. Native builds only, like the other modes.
// ---------------------------------------------------------------------------

test('the beta plan uses its own configuration and output folder, never publishes and says it is unsigned (6J1)', () => {
  const plan = createDesktopPackagePlan({ mode: 'beta', platform: 'win32', architecture: 'x64', hostPlatform: 'win32', hostArchitecture: 'x64' });
  assert.equal(plan.config, 'app/desktop/builder.beta.json');
  assert.equal(plan.output, 'release/beta');
  assert.deepEqual(plan.builderArguments, ['--config', 'app/desktop/builder.beta.json', '--win', '--x64', '--publish', 'never']);
  assert.match(plan.qualification, /unsigned beta/);
  assert.deepEqual(createDesktopPackagePlan({ mode: 'beta', platform: 'linux', architecture: 'x64', hostPlatform: 'linux', hostArchitecture: 'x64' }).builderArguments, ['--config', 'app/desktop/builder.beta.json', '--linux', '--x64', '--publish', 'never']);
  assert.deepEqual(parseDesktopPackageArguments(['--mode', 'beta']), { mode: 'beta' });
  assert.throws(() => createDesktopPackagePlan({ mode: 'beta', platform: 'darwin', architecture: 'arm64', hostPlatform: 'darwin', hostArchitecture: 'arm64' }), /Windows and Linux/);
  assert.throws(() => createDesktopPackagePlan({ mode: 'beta', platform: 'linux', architecture: 'x64', hostPlatform: 'win32', hostArchitecture: 'x64' }), /matching native host/);
});

test('beta packaging strips signing and service credentials from the build like the preview does (6J1)', () => {
  const source = { PATH: 'local-tools', CSC_LINK: 'private', GH_TOKEN: 'private', CHAUSAR_POSTGRES_URL: 'private', SENTRY_AUTH_TOKEN: 'private' };
  assert.deepEqual(desktopPackagingEnvironment('beta', source), { PATH: 'local-tools', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
});

test('the beta configuration: product Chausar, real data, unsigned NSIS per user, deb, AppImage and tar.gz, Codex and notices bundled (6J1)', () => {
  assert.equal(beta.appId, 'in.chausar.desktop');
  assert.equal(beta.productName, 'Chausar');
  assert.equal(beta.artifactName, 'Chausar-Beta-${version}-${os}-${arch}.${ext}');
  assert.deepEqual(beta.extraMetadata, { name: 'chausar', productName: 'Chausar', chausarReleaseChannel: 'beta', homepage: 'https://www.chausar.co.in' });
  assert.equal(beta.forceCodeSigning, false);
  assert.equal(beta.win.signAndEditExecutable, false);
  assert.deepEqual(beta.win.target, ['nsis']);
  assert.deepEqual(beta.nsis, { oneClick: false, perMachine: false, allowElevation: false, allowToChangeInstallationDirectory: true, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'Chausar', deleteAppDataOnUninstall: false, runAfterFinish: true, include: 'app/desktop/installer.nsh', installerIcon: 'app/desktop/icons/icon.ico', uninstallerIcon: 'app/desktop/icons/icon.ico' });
  assert.deepEqual(beta.linux.target, ['deb', 'AppImage', 'tar.gz']);
  assert.deepEqual(beta.deb, { maintainer: 'Kartavy Chauhan <info@chausar.co.in>' });
  assert.equal(beta.linux.executableName, 'chausar');
  assert.equal(beta.mac, undefined, 'Mac is out of scope for the beta');
  assert.deepEqual(beta.extraResources, [{ from: 'vendor/codex-bundle/${os}-${arch}', to: 'codex', filter: ['**/*'] }, { from: 'app/desktop/notices', to: 'notices', filter: ['**/*'] }, { from: 'LICENSE', to: 'LICENSE' }, { from: 'NOTICE', to: 'NOTICE' }, { from: 'vendor/feedback/feedback.json', to: 'feedback.json' }]);
  assert.equal(beta.publish, null);
  assert.equal(beta.npmRebuild, false);
  assert.equal(beta.electronDist, 'node_modules/electron/dist');
  assert.equal(beta.directories.output, 'release/beta');
  // electron-builder 26 lists every unpacked file of a mixed file set in one pattern, and @electron/asar refuses a
  // pattern over 64 KB (the first live build stopped there). Each folder that is unpacked whole is its own file set.
  for (const folder of ['platform/runtime', 'platform/semantic-qualification/src', 'platform/helpers']) {
    assert.ok(beta.files.some((entry: any) => JSON.stringify(entry) === JSON.stringify({ from: folder, to: folder, filter: ['**/*'] })), folder);
    assert.ok(!beta.files.includes(`${folder}/**/*`), folder);
  }
  validateInkPackagingConfig(beta);
});

test('beta checks refuse signing, publishing, the preview identity, other resources, hooks or another installer shape (6J1)', async t => {
  const variants = [
    { ...beta, forceCodeSigning: true },
    { ...beta, win: { ...beta.win, signAndEditExecutable: true } },
    { ...beta, publish: { provider: 'github' } },
    { ...beta, extraMetadata: { ...beta.extraMetadata, chausarPreview: true } },
    { ...beta, extraMetadata: { ...beta.extraMetadata, chausarReleaseChannel: 'unsigned-preview' } },
    { ...beta, appId: 'in.chausar.desktop.preview' },
    { ...beta, extraResources: [...(beta.extraResources ?? []), { from: 'runtime-binaries', to: 'runtime-binaries' }] },
    { ...beta, extends: './builder.json' },
    { ...beta, afterPack: 'unexpected-hook.cjs' },
    { ...beta, npmRebuild: true },
    { ...beta, electronDist: 'https://example.invalid/electron' },
    { ...beta, win: { ...beta.win, target: ['zip'] } },
    { ...beta, nsis: { ...beta.nsis, perMachine: true } },
    { ...beta, nsis: { ...beta.nsis, deleteAppDataOnUninstall: true } },
    { ...beta, linux: { ...beta.linux, target: ['deb'] } },
    { ...beta, linux: { ...beta.linux, target: ['AppImage', 'tar.gz'] } },
    { ...beta, deb: {} },
    { ...beta, deb: { ...beta.deb, afterInstall: 'own-install.sh' } },
    { ...beta, linux: { ...beta.linux, afterRemove: 'own-remove.sh' } },
    { ...beta, extraMetadata: { ...beta.extraMetadata, homepage: undefined } },
    { ...beta, directories: { output: '../outside' } },
    { ...beta, files: (beta.files ?? []).map((entry: any) => entry?.from === 'platform/runtime' ? 'platform/runtime/**/*' : entry) },
  ];
  for (const config of variants) {
    const result = await desktopPackagePrerequisites({ root: await fixture(t, preview, config), plan: createDesktopPackagePlan({ mode: 'beta' }), environment: {} });
    assert.ok(result.failures.some((failure: any) => failure.check === 'packaging configuration'), JSON.stringify(config).slice(0, 160));
  }
});

test('beta prerequisites ask for the staged Codex bundle with its LICENSE and NOTICE before anything is built (6J1)', async t => {
  const root = await fixture(t);
  const result = await desktopPackagePrerequisites({ root, plan: createDesktopPackagePlan({ mode: 'beta' }), environment: {} });
  assert.equal(result.ok, false);
  assert.ok(result.checks.includes('packaging configuration'));
  const codex = result.failures.find((failure: any) => failure.check === 'bundled Codex with its LICENSE and NOTICE');
  assert.ok(codex, 'the Codex bundle is a named prerequisite');
  assert.match(codex.reason, /package:codex/);
});

test('beta artifact names: one Windows installer, or a deb, an AppImage and a tar.gz on Linux (6J1)', async t => {
  const root = await fixture(t), plan = createDesktopPackagePlan({ mode: 'beta' });
  const { expectedArtifacts } = await validateDesktopPackagingOutput({ root, plan, version: pkg.version });
  if (process.platform === 'win32') assert.deepEqual(expectedArtifacts, [`Chausar-Beta-${pkg.version}-win-${process.arch}.exe`]);
  else if (process.platform === 'linux') assert.deepEqual(expectedArtifacts, [`Chausar-Beta-${pkg.version}-linux-${process.arch === 'x64' ? 'amd64' : process.arch}.deb`, `Chausar-Beta-${pkg.version}-linux-${process.arch === 'x64' ? 'x86_64' : process.arch}.AppImage`, `Chausar-Beta-${pkg.version}-linux-${process.arch}.tar.gz`]);
});

test('Linux artifact names follow electron-builder: a deb says amd64, an AppImage x86_64, a tar.gz x64 (found on the VPS build)', async () => {
  const { expectedArtifactNames } = desktopPackage;
  assert.deepEqual(expectedArtifactNames({ mode: 'beta', platform: 'linux', architecture: 'x64', version: '1.2.3' }),
    ['Chausar-Beta-1.2.3-linux-amd64.deb', 'Chausar-Beta-1.2.3-linux-x86_64.AppImage', 'Chausar-Beta-1.2.3-linux-x64.tar.gz']);
  assert.deepEqual(expectedArtifactNames({ mode: 'beta', platform: 'linux', architecture: 'arm64', version: '1.2.3' }),
    ['Chausar-Beta-1.2.3-linux-arm64.deb', 'Chausar-Beta-1.2.3-linux-arm64.AppImage', 'Chausar-Beta-1.2.3-linux-arm64.tar.gz']);
  assert.deepEqual(expectedArtifactNames({ mode: 'preview', platform: 'linux', architecture: 'x64', version: '1.2.3' }),
    ['Chausar-Preview-1.2.3-linux-x86_64.AppImage', 'Chausar-Preview-1.2.3-linux-x64.tar.gz']);
  assert.deepEqual(expectedArtifactNames({ mode: 'beta', platform: 'win32', architecture: 'x64', version: '1.2.3' }), ['Chausar-Beta-1.2.3-win-x64.exe']);
});

test('the uninstaller removes the start-at-login entry the app made, and never the owner\'s data (6J1)', async () => {
  const script = await readFile(new URL('../../app/desktop/installer.nsh', import.meta.url), 'utf8');
  assert.match(script, /!macro customUnInstall/);
  assert.match(script, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "Chausar"/);
  assert.match(script, /DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run" "Chausar"/);
  // The live uninstall left the installer copy electron-builder keeps in %LOCALAPPDATA%\chausar-updater; it goes too.
  assert.match(script, /RMDir \/r "\$LOCALAPPDATA\\chausar-updater"/);
  assert.equal(/\$APPDATA/i.test(script), false, 'the owner\'s businesses (in %APPDATA%\\Chausar) stay unless they delete them');
});

test('one pinned build-only Git source (electron-builder\'s node-gyp at an exact commit, dev only) is accepted; any other Git source is refused (6J1)', async t => {
  const root = await fixture(t);
  const rootEntry = { version: pkg.version, dependencies: pkg.dependencies, devDependencies: pkg.devDependencies };
  const integrity = 'sha512-' + 'A'.repeat(86) + '==';
  const packages: Record<string, any> = { '': rootEntry };
  for (const [name, version] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) packages[`node_modules/${name}`] = { version, resolved: 'https://registry.npmjs.org/test-fixture.tgz', integrity };
  const pinned = 'git+ssh://git@github.com/electron/node-gyp.git#06b29aafb7708acef8b3669835c8a7857ebc92d2';
  const run = async (entry: any) => {
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: { ...packages, 'node_modules/@electron/node-gyp': entry } }));
    return (await desktopPackagePrerequisites({ root, environment: {} })).failures.find((failure: any) => failure.check === 'locked local packaging dependencies and Electron distribution')?.reason ?? '';
  };
  assert.doesNotMatch(await run({ version: '10.2.0-electron.1', resolved: pinned, integrity, dev: true }), /HTTPS|integrity/);
  assert.match(await run({ version: '10.2.0-electron.1', resolved: pinned, integrity }), /HTTPS/, 'only as a build-time (dev) package');
  assert.match(await run({ version: '10.2.0-electron.1', resolved: pinned.replace('06b29a', '16b29a'), integrity, dev: true }), /HTTPS/, 'only that exact commit');
  assert.match(await run({ version: '10.2.0-electron.1', resolved: pinned, dev: true }), /integrity/, 'still with an integrity hash');
});

test('W6 6J3: the beta build ships the AGPL licence and the NOTICE beside the program', () => {
  const resources = (beta.extraResources ?? []) as { from: string; to: string }[];
  for (const name of ['LICENSE', 'NOTICE']) assert.ok(resources.some(entry => entry.from === name && entry.to === name), name);
});

// Wave 6 founder follow-up (6J2 open item): the report keys reach a build only through three build-time variables.
// Fake values only; built at runtime so nothing here looks like a real key.
const FAKE_KEY = ['fake', 'report', 'key'].join('_');
const FAKE_HOST = 'https://reports.example.invalid';
const FAKE_DSN = `https://${['fake', 'public'].join('')}@ingest.example.invalid/7`;
const FEEDBACK_STAGED = 'vendor/feedback/feedback.json';

test('report keys: no variables means no file; set variables become exactly { posthogKey, posthogHost, sentryDsn } (6J2)', () => {
  const { feedbackResource } = desktopPackage;
  assert.equal(feedbackResource({}), null);
  assert.equal(feedbackResource({ CHAUSAR_FEEDBACK_POSTHOG_KEY: '', CHAUSAR_FEEDBACK_SENTRY_DSN: '' }), null);
  assert.deepEqual(feedbackResource({ CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: FAKE_HOST, CHAUSAR_FEEDBACK_SENTRY_DSN: FAKE_DSN, OTHER: 'ignored' }),
    { posthogKey: FAKE_KEY, posthogHost: FAKE_HOST, sentryDsn: FAKE_DSN });
  assert.deepEqual(feedbackResource({ CHAUSAR_FEEDBACK_SENTRY_DSN: FAKE_DSN }), { sentryDsn: FAKE_DSN });
});

test('report keys: a half-set or malformed variable stops the build by name, and never repeats the value (6J2)', () => {
  const { feedbackResource } = desktopPackage;
  const cases: [Record<string, string>, RegExp][] = [
    [{ CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY }, /CHAUSAR_FEEDBACK_POSTHOG_HOST/],
    [{ CHAUSAR_FEEDBACK_POSTHOG_HOST: FAKE_HOST }, /CHAUSAR_FEEDBACK_POSTHOG_KEY/],
    [{ CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'http://reports.example.invalid' }, /CHAUSAR_FEEDBACK_POSTHOG_HOST/],
    [{ CHAUSAR_FEEDBACK_POSTHOG_KEY: 'has spaces in it', CHAUSAR_FEEDBACK_POSTHOG_HOST: FAKE_HOST }, /CHAUSAR_FEEDBACK_POSTHOG_KEY/],
    [{ CHAUSAR_FEEDBACK_SENTRY_DSN: 'http://plain.example.invalid/1' }, /CHAUSAR_FEEDBACK_SENTRY_DSN/],
  ];
  for (const [environment, name] of cases) {
    let message = '';
    try { feedbackResource(environment); } catch (error: any) { message = error.message; }
    assert.match(message, name);
    for (const value of Object.values(environment)) assert.ok(!message.includes(value), 'the error names the variable, never its value');
  }
});

test('report keys: packaging stages feedback.json from the variables, and removes a stale one when none are set (6J2)', async t => {
  const { stageFeedbackKeys } = desktopPackage;
  const root = await fixture(t);
  const staged = join(root, ...FEEDBACK_STAGED.split('/'));
  const set = await stageFeedbackKeys({ root, environment: { CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: FAKE_HOST, CHAUSAR_FEEDBACK_SENTRY_DSN: FAKE_DSN } });
  assert.deepEqual(JSON.parse(await readFile(staged, 'utf8')), { posthogKey: FAKE_KEY, posthogHost: FAKE_HOST, sentryDsn: FAKE_DSN });
  // What packaging keeps or prints says only which services are set up, never a value.
  assert.deepEqual(set, { posthog: true, sentry: true });
  assert.ok(![FAKE_KEY, FAKE_HOST, FAKE_DSN].some(value => JSON.stringify(set).includes(value)));
  const none = await stageFeedbackKeys({ root, environment: { PATH: 'local-tools' } });
  assert.deepEqual(none, { posthog: false, sentry: false });
  await assert.rejects(readFile(staged, 'utf8'), { code: 'ENOENT' }, 'a build without the variables ships no file, not the last build\'s');
  await stageFeedbackKeys({ root, environment: { CHAUSAR_FEEDBACK_SENTRY_DSN: FAKE_DSN } });
  await assert.rejects(stageFeedbackKeys({ root, environment: { CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY } }), /CHAUSAR_FEEDBACK_POSTHOG_HOST/);
  await assert.rejects(readFile(staged, 'utf8'), { code: 'ENOENT' }, 'a refused build leaves no staged file behind');
});

test('report keys: the beta and the normal build ship the staged file as resources/feedback.json, where the app reads it (6J2)', () => {
  const { feedbackKeys } = createRequire(import.meta.url)('../../app/desktop/feedback-keys.cjs');
  const entry = { from: FEEDBACK_STAGED, to: 'feedback.json' };
  for (const [name, config] of [['beta', beta], ['final', final]] as const) {
    assert.ok((config.extraResources ?? []).some((value: any) => JSON.stringify(value) === JSON.stringify(entry)), name);
  }
  assert.ok(!(preview.extraResources ?? []).length, 'the demo preview carries no report keys');
  const read: string[] = [];
  feedbackKeys({ env: {}, packaged: true, resources: 'RESOURCES', read: (path: string) => { read.push(path); return '{}'; } });
  assert.deepEqual(read, [join('RESOURCES', entry.to)]);
});

test('report keys: the staged file is git-ignored and the build children still get no CHAUSAR_ variables (6J2)', async () => {
  const ignore = await readFile(new URL('../../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /^vendor\/feedback\/\r?$/m);
  assert.deepEqual(desktopPackagingEnvironment('beta', { PATH: 'local-tools', CHAUSAR_FEEDBACK_POSTHOG_KEY: FAKE_KEY, CHAUSAR_FEEDBACK_SENTRY_DSN: FAKE_DSN }), { PATH: 'local-tools', CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
});

test('report keys: packaging stages them before electron-builder runs, and only for the beta and the normal build (6J2)', async () => {
  const source = await readFile(new URL('../../scripts/desktop-package.mjs', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export async function packageDesktop'));
  const stage = body.indexOf('stageFeedbackKeys('), build = body.indexOf('desktopPackageCommands(plan');
  assert.ok(stage > 0 && stage < build, 'the file is in place before the build copies resources');
  assert.match(body.slice(0, build), /plan\.mode !== 'preview'/);
  assert.doesNotMatch(source, /console\.(?:log|error)\([^)]*(?:posthogKey|sentryDsn|CHAUSAR_FEEDBACK_)/, 'no key value is ever printed');
});

// A2 second review (nit): the receipt says when a beta was built with --allow-unrecorded-codex, and whether its
// bundled Codex carries a recorded setup.
test('the beta receipt records the bundled Codex setup and the --allow-unrecorded-codex flag', () => {
  const { bundledReceipt } = desktopPackage;
  const codex = { version: '0.166.0', target: 'x86_64-pc-windows-msvc', licence: 'Apache-2.0', files: { 'bin/codex.exe': {}, LICENSE: {} } };
  assert.deepEqual(bundledReceipt({ ...codex, evidence: { recordedAt: '2026-11-03T00:00:00.000Z' } }, { allowUnrecordedCodex: false }), {
    codex: { version: '0.166.0', target: 'x86_64-pc-windows-msvc', licence: 'Apache-2.0', files: 2, setup: 'recorded' }, notices: 'notices/THIRD-PARTY-NOTICES.md',
  });
  assert.deepEqual(bundledReceipt({ ...codex, evidence: null }, { allowUnrecordedCodex: true }).codex, {
    version: '0.166.0', target: 'x86_64-pc-windows-msvc', licence: 'Apache-2.0', files: 2, setup: 'not recorded', allowUnrecordedCodex: true,
  });
});
