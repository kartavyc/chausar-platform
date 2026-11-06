// D5: the installer trim. Every build carries three Chromium languages (en-US, en-GB and hi, which comes back as a pack)
// and no Claude Code program file: Chausar always runs the owner's own Claude Code (agent-runtime/route.ts) and never the
// Agent SDK's bundled one, so the founder dropped it from every installer (5 Nov). The rule is one exported constant,
// TRIM, that the three builder files must meet, checked for every mode before anything is built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const modulePath = '../../scripts/desktop-package.mjs';
const desktopPackage = await import(modulePath);
const { TRIM, validateTrim, createDesktopPackagePlan, desktopPackagePrerequisites, ICON_FILES } = desktopPackage;
const read = async (name: string) => JSON.parse(await readFile(new URL(`../../app/desktop/${name}`, import.meta.url), 'utf8'));
const beta = await read('builder.beta.json');
const preview = await read('builder.preview.json');
const final = await read('builder.json');
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const CONFIGS = { beta, preview, final } as const;
const FILE = { beta: 'builder.beta.json', preview: 'builder.preview.json', final: 'builder.json' } as const;

async function fixture(t: any, configs: Partial<Record<keyof typeof CONFIGS, unknown>>) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-trim-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const path of ['app/desktop/icons/png', 'app/ui/src', 'platform/runtime', 'scripts']) await mkdir(join(root, path), { recursive: true });
  for (const path of ['app/desktop/main.cjs', 'app/desktop/preload.cjs', 'app/desktop/engine-harness.cjs', 'app/desktop/ipc-contract.cjs', 'app/desktop/icon.png', 'app/desktop/icon@1.5x.png', 'app/desktop/icon@2x.png', ...ICON_FILES, './scripts/desktop-after-pack.cjs', 'platform/runtime/worker.ts', 'app/ui/index.html', 'app/ui/src/main.tsx', 'app/ui/vite.config.ts']) await writeFile(join(root, path), '// Unit-test source; never launched.\n');
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  for (const mode of ['beta', 'preview', 'final'] as const) await writeFile(join(root, 'app/desktop', FILE[mode]), JSON.stringify(configs[mode] ?? CONFIGS[mode]));
  return root;
}

const configFailure = async (t: any, mode: 'beta' | 'preview' | 'final', config: unknown) => {
  const result = await desktopPackagePrerequisites({ root: await fixture(t, { [mode]: config }), plan: createDesktopPackagePlan({ mode }), environment: {} });
  return result.failures.find((failure: any) => failure.check === 'packaging configuration');
};

test('task 1: every builder file carries exactly en-US, en-GB and hi', async t => {
  assert.deepEqual(TRIM.electronLanguages, ['en-US', 'en-GB', 'hi']);
  for (const [mode, config] of Object.entries(CONFIGS)) {
    assert.deepEqual(config.electronLanguages, TRIM.electronLanguages, mode);
    validateTrim(config);
  }
  for (const mode of ['beta', 'preview', 'final'] as const) {
    const { electronLanguages: _dropped, ...without } = CONFIGS[mode];
    for (const variant of [without, { ...CONFIGS[mode], electronLanguages: [...TRIM.electronLanguages, 'ta'] }, { ...CONFIGS[mode], electronLanguages: ['en-US', 'en-GB'] }]) {
      assert.throws(() => validateTrim(variant), /languages/);
      const failure = await configFailure(t, mode, variant);
      assert.ok(failure, `${mode}: ${JSON.stringify(variant.electronLanguages)}`);
      assert.match(failure.reason, /languages/);
    }
  }
});
test('task 2: no build carries a Claude Code program file; the Agent SDK itself stays', async t => {
  assert.equal(TRIM.claudeBinary, 'none');
  assert.equal(TRIM.claudeBinaryExclusion, '!node_modules/@anthropic-ai/claude-agent-sdk-*/**');
  for (const [mode, config] of Object.entries(CONFIGS)) {
    const files: unknown[] = config.files;
    const all = files.indexOf('node_modules/**/*'), cut = files.indexOf(TRIM.claudeBinaryExclusion);
    assert.ok(all >= 0 && cut > all, `${mode}: the exclusion comes after node_modules/**/*`);
    assert.equal(files.some(entry => typeof entry === 'string' && /claude-agent-sdk-\$\{platform\}/.test(entry)), false, `${mode}: no platform package is put back`);
    assert.equal(files.some(entry => typeof entry === 'string' && /^!.*@anthropic-ai\/claude-agent-sdk\/\*\*/.test(entry)), false, `${mode}: the SDK itself ships`);
  }
  for (const mode of ['beta', 'preview', 'final'] as const) {
    const files: unknown[] = CONFIGS[mode].files;
    const without = files.filter(entry => entry !== TRIM.claudeBinaryExclusion);
    const before = [TRIM.claudeBinaryExclusion, ...without];
    const reincluded = [...files, 'node_modules/@anthropic-ai/claude-agent-sdk-${platform}-${arch}/**'];
    for (const variant of [without, before, reincluded]) {
      assert.throws(() => validateTrim({ ...CONFIGS[mode], files: variant }), /Claude Code program/);
      const failure = await configFailure(t, mode, { ...CONFIGS[mode], files: variant });
      assert.ok(failure, mode);
      assert.match(failure.reason, /Claude Code program/);
    }
  }
});

// ---------------------------------------------------------------------------
// Task 4: a build proves its own notices. Read from the unpacked folder electron-builder leaves (win-unpacked,
// linux-unpacked); a beta or final build without one of them gets no receipt.
// ---------------------------------------------------------------------------

async function unpacked(t: any, files: string[]) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-unpacked-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'resources'));
  for (const file of files) {
    await mkdir(join(root, 'resources', ...file.split('/').slice(0, -1)), { recursive: true });
    await writeFile(join(root, 'resources', ...file.split('/')), 'synthetic\n');
  }
  return root;
}

test('task 4: a beta or final build carries LICENSE, NOTICE, the third-party notices and each font licence; feedback.json only with report keys', async t => {
  const { packagedResourceProblems } = desktopPackage;
  const complete = ['LICENSE', 'NOTICE', 'notices/THIRD-PARTY-NOTICES.md', 'notices/fonts/DMMono-OFL.txt'];
  const fonts = ['DMMono-OFL.txt'];
  for (const mode of ['beta', 'final']) {
    assert.deepEqual(await packagedResourceProblems(await unpacked(t, complete), { mode, fonts }), [], mode);
    for (const missing of complete) {
      const problems = await packagedResourceProblems(await unpacked(t, complete.filter(file => file !== missing)), { mode, fonts });
      assert.deepEqual(problems, [`resources/${missing} is missing`], `${mode} ${missing}`);
    }
    // Report keys staged: feedback.json must be there; none staged: it must not.
    assert.deepEqual(await packagedResourceProblems(await unpacked(t, [...complete, 'feedback.json']), { mode, fonts, reports: { posthog: true, sentry: false } }), []);
    assert.deepEqual(await packagedResourceProblems(await unpacked(t, complete), { mode, fonts, reports: { posthog: false, sentry: true } }), ['resources/feedback.json is missing']);
    assert.deepEqual(await packagedResourceProblems(await unpacked(t, [...complete, 'feedback.json']), { mode, fonts, reports: { posthog: false, sentry: false } }), ['resources/feedback.json is there, but no report keys were staged']);
    assert.deepEqual(await packagedResourceProblems(await unpacked(t, [...complete, 'feedback.json']), { mode, fonts }), ['resources/feedback.json is there, but no report keys were staged']);
  }
  // The demo preview carries none of them.
  assert.deepEqual(await packagedResourceProblems(await unpacked(t, []), { mode: 'preview', fonts }), []);
  assert.deepEqual(await packagedResourceProblems(await unpacked(t, ['NOTICE', 'feedback.json']), { mode: 'preview', fonts }), ['resources/NOTICE is in the preview', 'resources/feedback.json is in the preview']);
  // A folder that is not an unpacked build at all.
  assert.deepEqual(await packagedResourceProblems(join(tmpdir(), `chausar-no-such-build-${process.pid}`), { mode: 'beta', fonts }), ['the unpacked build has no resources folder']);
});

test('task 4: the font licences a build must carry are the ones in app/desktop/notices/fonts', async () => {
  const { packagedFontLicences } = desktopPackage;
  const listed = await packagedFontLicences(join(tmpdir(), `chausar-no-fonts-${process.pid}`));
  assert.deepEqual(listed, []);
  assert.ok(Array.isArray(await packagedFontLicences()));
});
