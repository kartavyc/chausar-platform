import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
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
  // The Mac build (the founder's decision, 14 Nov 2026): the same launcher names the darwin triples.
  assert.equal(codexTarget('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(codexTarget('darwin', 'x64'), 'x86_64-apple-darwin');
  assert.throws(() => codexTarget('linux', 'ia32'), /Windows, Linux and macOS/);
  assert.throws(() => codexTarget('darwin', 'ia32'), /Windows, Linux and macOS/);
  assert.throws(() => codexTarget('freebsd', 'x64'), /Windows, Linux and macOS/);
  assert.equal(bundleFolderName('win32', 'x64'), 'vendor/codex-bundle/win-x64');
  assert.equal(bundleFolderName('linux', 'x64'), 'vendor/codex-bundle/linux-x64');
  // electron-builder's ${os} word for macOS is mac (builder.beta.json: vendor/codex-bundle/${os}-${arch}).
  assert.equal(bundleFolderName('darwin', 'arm64'), 'vendor/codex-bundle/mac-arm64');
  assert.equal(bundleFolderName('darwin', 'x64'), 'vendor/codex-bundle/mac-x64');
});

test('the CLI takes only a source package and an optional target, never a destination', () => {
  assert.deepEqual(parseCodexBundleArguments(['--from', 'C:/npm/node_modules/@openai/codex']), { from: 'C:/npm/node_modules/@openai/codex' });
  assert.deepEqual(parseCodexBundleArguments(['--from', '/x', '--platform', 'linux', '--arch', 'x64']), { from: '/x', platform: 'linux', architecture: 'x64' });
  assert.deepEqual(parseCodexBundleArguments(['--from', '/x', '--platform', 'darwin', '--arch', 'arm64']), { from: '/x', platform: 'darwin', architecture: 'arm64' });
  let usage = '';
  try { parseCodexBundleArguments(['--to', '/elsewhere']); } catch (error: any) { usage = error.message; }
  assert.match(usage, /--platform win32\|linux\|darwin /);
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
  // A2 second review: the version check runs bare; the other two lead with the quiet flags.
  assert.deepEqual(asked, [['--version'], [...QUIET_ARGS, 'exec', '--help'], [...QUIET_ARGS, 'features', 'list']]);
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

test('staging again replaces an unchanged earlier bundle of the same version, quietly; anything else there is refused and left as it is', async t => {
  const stage = (fixture: { root: string; destination: string }, extra: Record<string, unknown> = {}) => stageCodexBundle({ source: fixture.root, destination: fixture.destination, platform: 'win32', architecture: 'x64', ...extra });
  const leftovers = async (fixture: { root: string }) => (await readdir(fixture.root)).filter(name => name.includes('.staging-'));
  // The same version over itself: verified, then replaced, with nothing left beside it.
  const again = await vendorFixture(t);
  const first = await stage(again);
  const second = await stage(again);
  assert.deepEqual(second, first);
  assert.deepEqual(await verifyCodexBundle({ directory: again.destination, platform: 'win32', architecture: 'x64' }), first);
  assert.deepEqual(await leftovers(again), []);
  // A rebuild that records the setup replaces one staged without it.
  const answer = (args: string[]) => (args.at(-1) === '--version' ? 'codex-cli 0.166.0\n' : 'text\n');
  const recorded = await stage(again, { probe: async (_command: string, args: string[]) => ({ exitCode: 0, stdout: answer(args) }), now: () => new Date('2026-11-14T10:00:00.000Z') });
  assert.equal(recorded.evidence.recordedAt, '2026-11-14T10:00:00.000Z');
  assert.deepEqual(await verifyCodexBundle({ directory: again.destination, platform: 'win32', architecture: 'x64', requireSetup: true }), recorded);
  // A staging that fails part way keeps the earlier bundle whole, and leaves nothing beside it.
  await assert.rejects(stage(again, { probe: async () => ({ exitCode: 1, stdout: '' }) }), /did not answer/);
  assert.deepEqual(await verifyCodexBundle({ directory: again.destination, platform: 'win32', architecture: 'x64', requireSetup: true }), recorded);
  assert.deepEqual(await leftovers(again), []);
  // A file changed since staging: not this script's bundle any more, so it is not removed.
  const changed = await vendorFixture(t);
  await stage(changed);
  await writeFile(join(changed.destination, 'bin/codex.exe'), 'changed by hand');
  await assert.rejects(stage(changed), /not empty.*changed after the Codex bundle was staged/);
  assert.equal(await readFile(join(changed.destination, 'bin/codex.exe'), 'utf8'), 'changed by hand');
  // A file nobody staged beside a good bundle: refused, and it stays.
  const extra = await vendorFixture(t);
  await stage(extra);
  await writeFile(join(extra.destination, 'notes.txt'), 'mine');
  await assert.rejects(stage(extra), /not empty.*not listed in BUNDLE\.json/);
  assert.equal(await readFile(join(extra.destination, 'notes.txt'), 'utf8'), 'mine');
  // A bundle of another version: refused, never replaced without being looked at.
  const older = await vendorFixture(t);
  await stage(older);
  const manifestPath = join(older.destination, 'BUNDLE.json');
  await writeFile(manifestPath, (await readFile(manifestPath, 'utf8')).replace('"version": "0.166.0"', '"version": "0.154.0"'));
  await assert.rejects(stage(older), /not empty/);
  assert.match(await readFile(manifestPath, 'utf8'), /0\.154\.0/);
  assert.deepEqual(await leftovers(older), []);
});

test('A2 review: verification checks the recorded setup and the left-out folder, and a beta needs the setup unless told otherwise', async t => {
  const answer = (args: string[]) => ({ exitCode: 0, stdout: args.at(-1) === '--version' ? 'codex-cli 0.166.0\n' : 'text\n' });
  const { root, destination } = await vendorFixture(t);
  await stageCodexBundle({ source: root, destination, platform: 'win32', architecture: 'x64', probe: async (_c: string, args: string[]) => answer(args) });
  await verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64', requireSetup: true });
  // No recorded setup: fine for a plain check, refused when a beta needs it.
  const bare = await vendorFixture(t);
  await stageCodexBundle({ source: bare.root, destination: bare.destination, platform: 'win32', architecture: 'x64' });
  await verifyCodexBundle({ directory: bare.destination, platform: 'win32', architecture: 'x64' });
  await assert.rejects(verifyCodexBundle({ directory: bare.destination, platform: 'win32', architecture: 'x64', requireSetup: true }), /no recorded setup; stage it on a win32-x64 computer.*--allow-unrecorded-codex/);
  // A file from a left-out folder, or a changed leftOut list, is refused.
  await mkdir(join(destination, 'codex-resources/voice'), { recursive: true });
  await writeFile(join(destination, 'codex-resources/voice/NOTICE.md'), 'x');
  await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), /left out/);
  await rm(join(destination, 'codex-resources/voice'), { recursive: true });
  const manifest = JSON.parse(await readFile(join(destination, 'BUNDLE.json'), 'utf8'));
  await writeFile(join(destination, 'BUNDLE.json'), JSON.stringify({ ...manifest, leftOut: [] }));
  await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), /must leave out codex-resources\/voice/);
  await writeFile(join(destination, 'BUNDLE.json'), JSON.stringify({ ...manifest, evidence: { ...manifest.evidence, files: { versionOutput: 'evidence/version.stdout.txt' } } }));
  await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'win32', architecture: 'x64' }), /malformed recorded setup/);
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

// ---------------------------------------------------------------------------
// The Mac build (the founder's decision, 14 Nov 2026): the beta bundles Codex for macOS on arm64 and x64 too. The
// fixture follows the real packages, checked the same day from the npm registry (@openai/codex@0.166.0-darwin-arm64 and
// -darwin-x64, unpacked outside the code folder): vendor/<target>/ holds codex-package.json (layout 1, entrypoint
// bin/codex), bin/codex and bin/codex-code-mode-host (Mach-O for that chip), codex-path/rg, and on arm64 the voice
// folder (codex-resources/voice, with its own bin, lib, plugins and licenses), which is left out. The real arm64
// package was staged with this script and its program answered the three check commands; these tests hold the shape.
// ---------------------------------------------------------------------------

/** A disposable 64-bit Mach-O header (little-endian) for validation only; never executed and never part of a package. */
function machHeader(cpu = 0x0100000c) {
  const bytes = Buffer.alloc(4096); bytes.writeUInt32LE(0xfeedfacf, 0); bytes.writeUInt32LE(cpu, 4);
  return bytes;
}
const MAC = { arm64: { target: 'aarch64-apple-darwin', cpu: 0x0100000c }, x64: { target: 'x86_64-apple-darwin', cpu: 0x01000007 } } as const;
async function macVendorFixture(t: any, architecture: 'arm64' | 'x64' = 'arm64', layout: Record<string, unknown> = {}, cpu: number = MAC[architecture].cpu) {
  const root = await mkdtemp(join(tmpdir(), 'chausar-codex-mac-bundle-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { target } = MAC[architecture];
  const vendor = join(root, `node_modules/@openai/codex-darwin-${architecture}/vendor/${target}`);
  for (const folder of ['bin', 'codex-path', 'codex-resources/voice/bin', 'codex-resources/voice/lib', 'codex-resources/voice/plugins', 'codex-resources/voice/licenses']) await mkdir(join(vendor, folder), { recursive: true });
  await writeFile(join(vendor, 'bin/codex'), machHeader(cpu), { mode: 0o755 });
  await writeFile(join(vendor, 'bin/codex-code-mode-host'), machHeader(cpu), { mode: 0o755 });
  await writeFile(join(vendor, 'codex-path/rg'), machHeader(cpu), { mode: 0o755 });
  await writeFile(join(vendor, 'codex-resources/voice/bin/codex-voice-host'), machHeader(cpu), { mode: 0o755 });
  await writeFile(join(vendor, 'codex-resources/voice/lib/libopus.0.dylib'), 'library', { mode: 0o755 });
  await writeFile(join(vendor, 'codex-resources/voice/plugins/libgstopus.dylib'), 'library', { mode: 0o755 });
  await writeFile(join(vendor, 'codex-resources/voice/licenses/LGPL-2.1.txt'), 'licence text');
  await writeFile(join(vendor, 'codex-resources/voice/NOTICE.md'), '# Native voice libraries');
  await writeFile(join(vendor, 'codex-package.json'), JSON.stringify({ layoutVersion: 1, version: '0.166.0', target, variant: 'codex', entrypoint: 'bin/codex', resourcesDir: 'codex-resources', pathDir: 'codex-path', ...layout }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.166.0', license: 'Apache-2.0' }));
  return { root, vendor, destination: join(root, 'staged') };
}
// The header check wants the execute bit, which a Windows disk does not keep: there the same staging is refused in
// words, and the full Mac staging runs on macOS and Linux.
const KEEPS_EXECUTE_BIT = process.platform !== 'win32';

test('Mac: the darwin platform package is found nested or beside @openai/codex, for arm64 and x64', async t => {
  for (const architecture of ['arm64', 'x64'] as const) {
    const { root, vendor } = await macVendorFixture(t, architecture);
    assert.equal(await codexVendorFolder(root, 'darwin', architecture), vendor);
    const other = architecture === 'arm64' ? 'x64' : 'arm64';
    await assert.rejects(codexVendorFolder(root, 'darwin', other), new RegExp(`no Codex ${MAC[other].target} files`));
  }
  const hoisted = await mkdtemp(join(tmpdir(), 'chausar-codex-mac-hoisted-test-'));
  t.after(() => rm(hoisted, { recursive: true, force: true }));
  const codex = join(hoisted, 'node_modules/@openai/codex'), beside = join(hoisted, 'node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin');
  await mkdir(codex, { recursive: true }); await mkdir(beside, { recursive: true });
  assert.equal(await codexVendorFolder(codex, 'darwin', 'arm64'), beside);
});

test('Mac: staging copies the darwin Codex with the program named codex (no .exe), LICENSE, NOTICE and a manifest, and leaves voice out', async t => {
  for (const architecture of ['arm64', 'x64'] as const) {
    const { root, destination } = await macVendorFixture(t, architecture);
    if (!KEEPS_EXECUTE_BIT) { await assert.rejects(stageCodexBundle({ source: root, destination, platform: 'darwin', architecture }), /bin\/codex: .*correct permissions/); continue; }
    const manifest = await stageCodexBundle({ source: root, destination, platform: 'darwin', architecture });
    assert.equal(manifest.target, MAC[architecture].target);
    assert.equal(manifest.entrypoint, 'bin/codex');
    assert.equal(manifest.version, '0.166.0');
    assert.deepEqual(Object.keys(manifest.files).sort(), ['LICENSE', 'NOTICE', 'bin/codex', 'bin/codex-code-mode-host', 'codex-package.json', 'codex-path/rg']);
    assert.deepEqual(manifest.leftOut, ['codex-resources/voice']);
    // The copy is byte for byte (OpenAI's own signature is part of each file) and every program keeps its execute bit.
    for (const name of ['bin/codex', 'bin/codex-code-mode-host', 'codex-path/rg']) {
      assert.deepEqual(await readFile(join(destination, name)), machHeader(MAC[architecture].cpu), name);
      assert.ok(((await stat(join(destination, name))).mode & 0o111) !== 0, `${name} keeps its execute bit`);
    }
    assert.deepEqual((await readdir(destination)).sort(), ['BUNDLE.json', 'LICENSE', 'NOTICE', 'bin', 'codex-package.json', 'codex-path']);
    assert.equal(manifest.files['bin/codex'].sha256, sha256(machHeader(MAC[architecture].cpu)));
    assert.ok(((await stat(join(destination, 'bin/codex'))).mode & 0o111) !== 0, 'the staged program keeps its execute bit');
    assert.deepEqual(await verifyCodexBundle({ directory: destination, platform: 'darwin', architecture }), manifest);
    // A bundle staged for one Mac is not the other Mac's, nor another system's.
    const other = architecture === 'arm64' ? 'x64' : 'arm64';
    await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'darwin', architecture: other }), new RegExp(`not Codex 0\\.166\\.0 for ${MAC[other].target}`));
    await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'linux', architecture }), /not Codex 0\.166\.0 for/);
    await assert.rejects(verifyCodexBundle({ directory: destination, platform: 'darwin', architecture, requireSetup: true }), new RegExp(`no recorded setup; stage it on a darwin-${architecture} computer`));
  }
});

test('Mac: staging records the setup with the same quiet check commands as Windows and Linux', async t => {
  if (!KEEPS_EXECUTE_BIT) return;
  const { root, destination } = await macVendorFixture(t, 'arm64');
  const asked: { command: string; args: string[] }[] = [];
  const probe = async (command: string, args: string[]) => { asked.push({ command, args }); return { exitCode: 0, stdout: args.at(-1) === '--version' ? 'codex-cli 0.166.0\n' : 'text\n' }; };
  const manifest = await stageCodexBundle({ source: root, destination, platform: 'darwin', architecture: 'arm64', probe, now: () => new Date('2026-11-14T10:00:00.000Z') });
  assert.deepEqual(asked.map(item => item.args), [['--version'], [...QUIET_ARGS, 'exec', '--help'], [...QUIET_ARGS, 'features', 'list']]);
  // The staged copy itself answers, in the folder it is built in beside the destination, before it is moved into place.
  assert.ok(asked.every(item => item.command.startsWith(`${destination}.staging-`) && item.command.endsWith(join('bin', 'codex'))), 'the staged program itself answers');
  assert.deepEqual((await readdir(root)).filter(name => name.includes('.staging-')), [], 'and nothing is left beside the bundle');
  assert.equal(manifest.evidence.recordedAt, '2026-11-14T10:00:00.000Z');
  await verifyCodexBundle({ directory: destination, platform: 'darwin', architecture: 'arm64', requireSetup: true });
});

test('Mac: staging refuses a program for the other Mac chip, a Windows layout, and a launcher script in place of the program', async t => {
  const wrongChip = await macVendorFixture(t, 'arm64', {}, MAC.x64.cpu);
  await assert.rejects(stageCodexBundle({ source: wrongChip.root, destination: wrongChip.destination, platform: 'darwin', architecture: 'arm64' }), KEEPS_EXECUTE_BIT ? /bin\/codex: .*architecture/ : /bin\/codex: /);
  const exeEntry = await macVendorFixture(t, 'arm64', { entrypoint: 'bin/codex.exe' });
  await assert.rejects(stageCodexBundle({ source: exeEntry.root, destination: exeEntry.destination, platform: 'darwin', architecture: 'arm64' }), /entrypoint must be bin\/codex$/);
  const wrongTarget = await macVendorFixture(t, 'arm64', { target: 'x86_64-apple-darwin' });
  await assert.rejects(stageCodexBundle({ source: wrongTarget.root, destination: wrongTarget.destination, platform: 'darwin', architecture: 'arm64' }), /target/);
  // The Codex inside the ChatGPT app keeps a small launcher script at bin/codex and the program in a nested app. That
  // is not the npm package this script stages, and it is refused in words rather than shipped.
  const launcher = await macVendorFixture(t, 'arm64');
  await writeFile(join(launcher.vendor, 'bin/codex'), `#!/bin/sh\n${'# launcher\n'.repeat(500)}exec "$0.real" "$@"\n`, { mode: 0o755 });
  await assert.rejects(stageCodexBundle({ source: launcher.root, destination: launcher.destination, platform: 'darwin', architecture: 'arm64' }), KEEPS_EXECUTE_BIT ? /bin\/codex: the program must be a macOS Mach-O executable.*@openai\/codex npm package/ : /bin\/codex: /);
  await assert.rejects(readdir(launcher.destination), { code: 'ENOENT' }, 'a refused staging writes nothing');
});
