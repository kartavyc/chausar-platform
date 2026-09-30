import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A variable import allows Node's native TypeScript test runner to exercise the JS CLI without a TS emit step.
const modulePath = '../../scripts/desktop-package.mjs';
const { createDesktopPackagePlan, parseDesktopPackageArguments, desktopPackagingEnvironment, desktopPackagePrerequisites, packageDesktop, validateElectronExecutable, validateLocalElectronDistribution, validateDesktopPackagingOutput } = await import(modulePath);
const preview = JSON.parse(await readFile(new URL('../../app/desktop/builder.preview.json', import.meta.url), 'utf8'));
const final = JSON.parse(await readFile(new URL('../../app/desktop/builder.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

async function fixture(t: any, config = preview) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-package-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['app/desktop', 'app/renderer', 'platform/runtime']) await mkdir(join(root, path), { recursive: true });
  for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'platform/runtime/worker.ts', 'app/renderer/index.html', 'app/renderer/app.js', 'app/renderer/styles.css']) await writeFile(join(root, path), '// Unit-test source; never launched.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(root, 'app/desktop/builder.preview.json'), JSON.stringify(config));
  await writeFile(join(root, 'app/desktop/builder.json'), JSON.stringify(final));
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

test('preview checks refuse accidental final signing, runtime bundling, inheritance or build hooks', async t => {
  const variants = [
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
