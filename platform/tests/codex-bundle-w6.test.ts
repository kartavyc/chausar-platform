import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Wave 6, package 6J1 (D3, D12): the installer bundles Codex (Apache-2.0) with its LICENSE and NOTICE, copied from a
// local Codex install the founder already has; nothing is downloaded and nothing implies an OpenAI endorsement.
const modulePath = '../../scripts/codex-bundle.mjs';
const { CODEX_BUNDLE, QUIET_ARGS, codexTarget, codexVendorFolder, stageCodexBundle, verifyCodexBundle, bundleFolderName, parseCodexBundleArguments } = await import(modulePath);
const repo = new URL('../../', import.meta.url);
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function peHeader(machine = 0x8664) {
  // A disposable PE header for validation only; never executed and never part of a package.
  const bytes = Buffer.alloc(4096); bytes.write('MZ', 0); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128); bytes.writeUInt16LE(machine, 132);
  return bytes;
}
async function vendorFixture(t: any, layout: Record<string, unknown> = {}, machine = 0x8664) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-codex-bundle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const vendor = join(root, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc');
  for (const folder of ['bin', 'codex-path', 'codex-resources']) await mkdir(join(vendor, folder), { recursive: true });
  await writeFile(join(vendor, 'bin/codex.exe'), peHeader(machine));
  await writeFile(join(vendor, 'codex-path/rg.exe'), peHeader(machine));
  await writeFile(join(vendor, 'codex-resources/codex-command-runner.exe'), peHeader(machine));
  // A2: 0.166.0 carries native voice libraries (GStreamer, GLib, Microsoft's runtime DLL) that Chausar leaves out.
  await mkdir(join(vendor, 'codex-resources/voice/bin'), { recursive: true });
  await writeFile(join(vendor, 'codex-resources/voice/bin/codex-voice-host.exe'), peHeader(machine));
  await writeFile(join(vendor, 'codex-resources/voice/bin/vcruntime140.dll'), 'runtime');
  await writeFile(join(vendor, 'codex-resources/voice/NOTICE.md'), '# Native voice libraries');
  await writeFile(join(vendor, 'codex-package.json'), JSON.stringify({ layoutVersion: 1, version: '0.166.0', target: 'x86_64-pc-windows-msvc', variant: 'codex', entrypoint: 'bin/codex.exe', resourcesDir: 'codex-resources', pathDir: 'codex-path', ...layout }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.166.0', license: 'Apache-2.0' }));
  return { root, vendor, destination: join(root, 'staged') };
}

test('the shipped Codex LICENSE and NOTICE are byte for byte the files in openai/codex at the pinned release tag', async () => {
  assert.equal(CODEX_BUNDLE.version, '0.166.0');
  assert.equal(CODEX_BUNDLE.licence, 'Apache-2.0');
  assert.equal(CODEX_BUNDLE.tag, 'rust-v0.166.0');
  const license = await readFile(new URL('app/desktop/notices/codex/LICENSE', repo));
  const notice = await readFile(new URL('app/desktop/notices/codex/NOTICE', repo));
  assert.equal(sha256(license), CODEX_BUNDLE.licenseSha256);
  assert.equal(sha256(notice), CODEX_BUNDLE.noticeSha256);
  assert.equal(CODEX_BUNDLE.licenseSha256, 'd17f227e4df5da1600391338865ce0f3055211760a36688f816941d58232d8dc');
  assert.equal(CODEX_BUNDLE.noticeSha256, '9d71575ecfd9a843fc1677b0efb08053c6ba9fd686a0de1a6f5382fd3c220915');
  assert.match(license.toString('utf8'), /Apache License\s+Version 2\.0/);
  // The upstream file uses no-break spaces in its copyright line; it is kept exactly as published.
  assert.match(notice.toString('utf8'), /^OpenAI Codex\nCopyright\s2025\sOpenAI\n/);
});

test('every bundled third-party piece has its licence in the notices folder and the index names it (6J1)', async () => {
  const index = await readFile(new URL('app/desktop/notices/THIRD-PARTY-NOTICES.md', repo), 'utf8');
  for (const [name, file] of [['OpenAI Codex', 'codex/LICENSE'], ['OpenAI Codex', 'codex/NOTICE'], ['Ratatui', 'ratatui/LICENSE'], ['ripgrep', 'ripgrep/LICENSE-MIT'], ['ripgrep', 'ripgrep/UNLICENSE'], ['PCRE2', 'pcre2/LICENCE.md']]) {
    assert.ok(index.includes(name), name);
    assert.ok(index.includes(file), file);
    assert.ok((await readFile(new URL(`app/desktop/notices/${file}`, repo))).length > 100, file);
  }
  assert.match(index, /not endorsed by OpenAI/i);
  assert.equal(index.includes('\u2014'), false, 'no em dashes');
  const attributes = await readFile(new URL('.gitattributes', repo), 'utf8');
  assert.match(attributes, /^app\/desktop\/notices\/\*\* -text$/m, 'licence files stay byte for byte across checkouts');
});

test('Codex targets follow the Codex launcher, and electron-builder folder names follow its os and arch words', () => {
  assert.equal(codexTarget('win32', 'x64'), 'x86_64-pc-windows-msvc');
  assert.equal(codexTarget('win32', 'arm64'), 'aarch64-pc-windows-msvc');
  assert.equal(codexTarget('linux', 'x64'), 'x86_64-unknown-linux-musl');
  assert.equal(codexTarget('linux', 'arm64'), 'aarch64-unknown-linux-musl');
  assert.throws(() => codexTarget('darwin', 'arm64'), /Windows and Linux/);
  assert.throws(() => codexTarget('linux', 'ia32'), /Windows and Linux/);
  assert.equal(bundleFolderName('win32', 'x64'), 'vendor/codex-bundle/win-x64');
  assert.equal(bundleFolderName('linux', 'x64'), 'vendor/codex-bundle/linux-x64');
});

test('the CLI takes only a source package and an optional target, never a destination', () => {
  assert.deepEqual(parseCodexBundleArguments(['--from', 'C:/npm/node_modules/@openai/codex']), { from: 'C:/npm/node_modules/@openai/codex' });
  assert.deepEqual(parseCodexBundleArguments(['--from', '/x', '--platform', 'linux', '--arch', 'x64']), { from: '/x', platform: 'linux', architecture: 'x64' });
  for (const args of [[], ['--from'], ['--from', '/x', '--from', '/y'], ['--to', '/elsewhere'], ['--from', '/x', '--check']]) assert.throws(() => parseCodexBundleArguments(args));
});

test('staging copies the platform Codex layout with LICENSE, NOTICE and a manifest of every file', async t => {
  const { root, vendor, destination } = await vendorFixture(t);
  assert.equal(await codexVendorFolder(root, 'win32', 'x64'), vendor);
  const manifest = await stageCodexBundle({ source: root, destination, platform: 'win32', architecture: 'x64' });
  assert.equal(manifest.version, '0.166.0');
  assert.equal(manifest.target, 'x86_64-pc-windows-msvc');
  assert.equal(manifest.licence, 'Apache-2.0');
  assert.equal(manifest.entrypoint, 'bin/codex.exe');
  assert.deepEqual((await readdir(destination)).sort(), ['BUNDLE.json', 'LICENSE', 'NOTICE', 'bin', 'codex-package.json', 'codex-path', 'codex-resources']);
  assert.deepEqual(await readFile(join(destination, 'LICENSE')), await readFile(new URL('app/desktop/notices/codex/LICENSE', repo)));
  assert.deepEqual(await readFile(join(destination, 'NOTICE')), await readFile(new URL('app/desktop/notices/codex/NOTICE', repo)));
  const files = Object.keys(manifest.files).sort();
  assert.deepEqual(files, ['LICENSE', 'NOTICE', 'bin/codex.exe', 'codex-package.json', 'codex-path/rg.exe', 'codex-resources/codex-command-runner.exe']);
  // A2: the voice folder is left out, and the manifest says so.
  assert.deepEqual(await readdir(join(destination, 'codex-resources')), ['codex-command-runner.exe']);
  assert.deepEqual(manifest.leftOut, ['codex-resources/voice']);
  assert.equal(manifest.files['bin/codex.exe'].sha256, sha256(peHeader()));
  assert.deepEqual(JSON.parse(await readFile(join(destination, 'BUNDLE.json'), 'utf8')), manifest);
  assert.deepEqual(await verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), manifest);
});

test('A2: staging records the bundled Codex setup at build time: its version, exec help and features answers, pinned in BUNDLE.json', async t => {
  const { root, destination } = await vendorFixture(t);
  const asked: string[][] = [];
  const answer = (key: string) => (key === '--version' ? 'codex-cli 0.166.0\n' : key === 'exec --help' ? 'exec help text\n' : 'features text\n');
  const plain = (args: string[]) => (args[0] === '--disable' ? args.slice(QUIET_ARGS.length) : args);
  const probe = async (_command: string, args: string[]) => { asked.push(args); return { exitCode: 0, stdout: answer(plain(args).join(' ')) }; };
  const manifest = await stageCodexBundle({ source: root, destination, platform: 'win32', architecture: 'x64', probe, now: () => new Date('2026-11-03T10:00:00.000Z') });
  assert.deepEqual(asked, [[...QUIET_ARGS, '--version'], [...QUIET_ARGS, 'exec', '--help'], [...QUIET_ARGS, 'features', 'list']]);
  const { CODEX_QUIET_ARGS } = await import('../runtime/providers/codex-cli.ts');
  assert.deepEqual([...QUIET_ARGS], [...CODEX_QUIET_ARGS], 'the build and the engine quiet the same features');
  assert.deepEqual(manifest.evidence, { recordedAt: '2026-11-03T10:00:00.000Z', files: { versionOutput: 'evidence/version.stdout.txt', execHelp: 'evidence/exec-help.stdout.txt', features: 'evidence/features.stdout.txt' } });
  assert.equal(await readFile(join(destination, 'evidence/version.stdout.txt'), 'utf8'), answer('--version'));
  assert.equal(manifest.files['evidence/version.stdout.txt'].sha256, sha256(answer('--version')));
  assert.deepEqual(await verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), manifest);
  // A version answer for another Codex is refused at staging.
  const other = await vendorFixture(t);
  const older = async (command: string, args: string[]) => (plain(args)[0] === '--version' ? { exitCode: 0, stdout: 'codex-cli 0.154.0\n' } : probe(command, args));
  await assert.rejects(stageCodexBundle({ source: other.root, destination: other.destination, platform: 'win32', architecture: 'x64', probe: older }), /answered as another version/);
  // Without a probe for another platform's program, the bundle is staged with no recorded setup.
  const elsewhere = await vendorFixture(t);
  const unrecorded = await stageCodexBundle({ source: elsewhere.root, destination: elsewhere.destination, platform: 'win32', architecture: 'x64', probe: null });
  assert.equal(unrecorded.evidence, null);
});

test('a local npm install keeps the platform package beside @openai/codex, and that layout is found too', async t => {
  const root = await mkdtemp(join(tmpdir(), 'chausar-codex-hoisted-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  // `npm install @openai/codex` in a folder hoists the platform package: node_modules/@openai/codex-linux-x64 sits beside it.
  const codex = join(root, 'node_modules/@openai/codex');
  const vendor = join(root, 'node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl');
  await mkdir(codex, { recursive: true });
  await mkdir(vendor, { recursive: true });
  assert.equal(await codexVendorFolder(codex, 'linux', 'x64'), vendor);
  await assert.rejects(codexVendorFolder(codex, 'linux', 'arm64'), /no Codex aarch64-unknown-linux-musl files/);
});

test('staging refuses a different Codex version, a wrong target or architecture, links, and a folder already in use', async t => {
  const wrongVersion = await vendorFixture(t, { version: '0.167.0' });
  await assert.rejects(stageCodexBundle({ source: wrongVersion.root, destination: wrongVersion.destination, platform: 'win32', architecture: 'x64' }), /0\.166\.0/);
  const wrongTarget = await vendorFixture(t, { target: 'aarch64-pc-windows-msvc' });
  await assert.rejects(stageCodexBundle({ source: wrongTarget.root, destination: wrongTarget.destination, platform: 'win32', architecture: 'x64' }), /target/);
  const wrongMachine = await vendorFixture(t, {}, 0xaa64);
  await assert.rejects(stageCodexBundle({ source: wrongMachine.root, destination: wrongMachine.destination, platform: 'win32', architecture: 'x64' }), /architecture/);
  const used = await vendorFixture(t);
  await mkdir(used.destination, { recursive: true }); await writeFile(join(used.destination, 'old.txt'), 'earlier bundle');
  await assert.rejects(stageCodexBundle({ source: used.root, destination: used.destination, platform: 'win32', architecture: 'x64' }), /not empty/);
  assert.equal(await readFile(join(used.destination, 'old.txt'), 'utf8'), 'earlier bundle');
  const linked = await vendorFixture(t);
  try { await symlink(join(linked.vendor, 'bin/codex.exe'), join(linked.vendor, 'codex-path/link.exe')); }
  catch (error: any) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('This host cannot create a disposable test symlink.'); return; } throw error; }
  await assert.rejects(stageCodexBundle({ source: linked.root, destination: linked.destination, platform: 'win32', architecture: 'x64' }), /link/);
});

test('verification refuses a bundle with a missing LICENSE or NOTICE, a changed file or an extra file', async t => {
  for (const damage of ['LICENSE', 'NOTICE', 'changed', 'extra']) {
    const { root, destination } = await vendorFixture(t);
    await stageCodexBundle({ source: root, destination, platform: 'win32', architecture: 'x64' });
    if (damage === 'changed') await writeFile(join(destination, 'codex-path/rg.exe'), peHeader(0x8664).fill(1, 200));
    else if (damage === 'extra') await writeFile(join(destination, 'bin/added.exe'), peHeader());
    else await rm(join(destination, damage));
    await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), damage === 'extra' ? /not listed/ : damage === 'changed' ? /changed/ : new RegExp(damage), damage);
  }
  await assert.rejects(verifyCodexBundle({ directory: join(tmpdir(), 'chausar-no-such-codex-bundle'), platform: 'win32', architecture: 'x64' }), /package:codex/);
});
