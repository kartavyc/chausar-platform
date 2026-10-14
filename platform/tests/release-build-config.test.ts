import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReleaseUpdater } from '../runtime/updater.ts';
import { releaseChecksums } from '../../scripts/release/checksums.ts';
import { signUpdateManifest } from '../../scripts/release/sign-update-manifest.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const final = JSON.parse(await readFile(join(root, 'app/desktop/builder.json'), 'utf8'));
const preview = JSON.parse(await readFile(join(root, 'app/desktop/builder.preview.json'), 'utf8'));
const require = createRequire(import.meta.url);
const signHook = require('../../scripts/release/windows-sign.cjs');
const code = (expected: string) => (error: any) => error?.code === expected;

async function temporary(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-release-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test('final builder config has the three installer targets, versioned artifact names and no publishing', () => {
  assert.deepEqual(final.win.target, ['nsis']);
  assert.deepEqual(final.mac.target, ['dmg', 'zip']);
  // The AppImage is the standalone download; the tar.gz is what the launcher installs in place.
  assert.deepEqual(final.linux.target, ['AppImage', 'tar.gz']);
  for (const token of ['${version}', '${os}', '${arch}', '${ext}']) assert.ok(final.artifactName.includes(token), token);
  assert.equal(final.publish, null);
  assert.equal(final.forceCodeSigning, true);
  assert.equal(final.nsis.perMachine, false);
  assert.equal(preview.publish, null);
});

test('signing hooks and entitlements point at existing files', async () => {
  assert.equal(final.win.signAndEditExecutable, true);
  assert.equal(final.win.signtoolOptions.sign, 'scripts/release/windows-sign.cjs');
  assert.deepEqual(final.win.signtoolOptions.signingHashAlgorithms, ['sha256']);
  assert.ok(existsSync(join(root, final.win.signtoolOptions.sign)));
  assert.equal(final.mac.hardenedRuntime, true);
  assert.equal(final.mac.notarize, true);
  for (const key of ['entitlements', 'entitlementsInherit']) assert.ok(existsSync(join(root, final.mac[key])), key);
  const entitlements = await readFile(join(root, final.mac.entitlements), 'utf8');
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.ok(!/network\.server|disable-library-validation|get-task-allow|allow-dyld-environment/.test(entitlements));
  // Bundled runtimes are pre-signed before their manifests pin them; the builder must not re-sign them.
  assert.ok(final.mac.signIgnore.some((pattern: string) => new RegExp(pattern).test('/x/Chausar.app/Contents/Resources/runtime-binaries/keychain/chausar-keychain')));
});

test('the Windows sign hook refuses with WINDOWS_SIGNING_UNCONFIGURED when its settings are absent', async () => {
  assert.equal(typeof signHook, 'function');
  assert.equal(signHook.sign, signHook);
  await assert.rejects(signHook({ path: 'C:\\build\\Chausar.exe', hash: 'sha256', isNest: false }, undefined, {}), code('WINDOWS_SIGNING_UNCONFIGURED'));
  await assert.rejects(signHook({ path: 'C:\\build\\Chausar.exe' }, undefined, { CHAUSAR_WIN_SIGNER: 'local-pfx' }), code('WINDOWS_SIGNING_UNCONFIGURED'));
  const partial = { CHAUSAR_WIN_SIGNER: 'digicert-keylocker', SM_HOST: 'https://clientauth.one.digicert.com', SM_API_KEY: 'super-secret-api-key' };
  await assert.rejects(signHook({ path: '/build/Chausar.exe' }, undefined, partial), (error: any) =>
    error.code === 'WINDOWS_SIGNING_UNCONFIGURED' && error.message.includes('SM_KEYPAIR_ALIAS') && !error.message.includes('super-secret-api-key'));
  await assert.rejects(signHook({ path: '/build/Chausar.exe' }, undefined, { CHAUSAR_WIN_SIGNER: 'sslcom-esigner', ES_USERNAME: 'u', ES_PASSWORD: 'p', ES_CREDENTIAL_ID: 'c', ES_TOTP_SECRET: 't', CODESIGNTOOL_PATH: 'C:\\tools\\CodeSignTool.bat' }),
    code('WINDOWS_SIGNING_UNCONFIGURED'));
});

test('the sign hook runs the cloud tool without a shell and leaves pre-signed bundled runtimes untouched', async () => {
  const environment = { CHAUSAR_WIN_SIGNER: 'digicert-keylocker', SM_HOST: 'h', SM_API_KEY: 'k', SM_CLIENT_CERT_FILE: '/c.p12', SM_CLIENT_CERT_PASSWORD: 'p', SM_KEYPAIR_ALIAS: 'alias', SMCTL_PATH: '/opt/smctl' };
  const calls: any[] = [];
  const fakeSpawn = (executable: string, args: string[], options: any) => {
    calls.push({ executable, args, options });
    const { EventEmitter } = require('node:events');
    const child = new EventEmitter(); child.kill = () => true;
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  await signHook.signFile('/build/win-unpacked/Chausar.exe', environment, fakeSpawn);
  assert.deepEqual(calls[0].executable, '/opt/smctl');
  assert.deepEqual(calls[0].args, ['sign', '--keypair-alias=alias', '--input=/build/win-unpacked/Chausar.exe']);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.windowsHide, true);
  assert.deepEqual(calls[0].options.stdio, ['ignore', 'ignore', 'ignore']);
  // A bundled runtime file is skipped (it was pre-signed before its integrity manifest).
  const sep = process.platform === 'win32' ? '\\' : '/';
  await signHook({ path: ['', 'build', 'win-unpacked', 'resources', 'runtime-binaries', 'keychain', 'chausar-keychain.exe'].join(sep) }, undefined, environment);
  await assert.rejects(signHook.signFile('relative.exe', environment, fakeSpawn), code('WINDOWS_SIGNING_INVALID'));
  assert.equal(calls.length, 1);
});

test('checksums are sorted, sha256sum-compatible and mirrored in JSON', async t => {
  const directory = await temporary(t);
  await writeFile(join(directory, 'b.AppImage'), 'second');
  await writeFile(join(directory, 'a.exe'), 'first');
  await writeFile(join(directory, 'builder-debug.yml'), 'diagnostic');
  const result = spawnSync(process.execPath, [join(root, 'scripts/release/checksums.ts'), directory], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const sums = await readFile(join(directory, 'SHA256SUMS'), 'utf8');
  const lines = sums.trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^[a-f0-9]{64} {2}a\.exe$/);
  assert.match(lines[1], /^[a-f0-9]{64} {2}b\.AppImage$/);
  const json = JSON.parse(await readFile(join(directory, 'checksums.json'), 'utf8'));
  assert.deepEqual(json.files.map((file: any) => [file.name, file.size]), [['a.exe', 5], ['b.AppImage', 6]]);
  assert.equal(json.files[0].sha256, lines[0].slice(0, 64));
  assert.equal(json.files[0].sha256, 'a7937b64b8caa58f03721bb6bacf5c78cb235febe0e70b1b84cd99541461a08e');
  const check = spawnSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: directory, encoding: 'utf8' });
  if (!check.error) assert.equal(check.status, 0, check.stderr);
  // Re-running ignores its own outputs.
  assert.equal((await releaseChecksums(directory)).files.length, 2);
  const empty = await temporary(t);
  await assert.rejects(releaseChecksums(empty), code('CHECKSUM_EMPTY'));
});

test('update manifests round-trip: signed here, verified by ReleaseUpdater.verify', async t => {
  const directory = await temporary(t), keys = generateKeyPairSync('ed25519');
  const keyFile = join(directory, 'release-private.pem');
  await writeFile(keyFile, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const artifactPath = join(directory, 'Chausar-2.0.0-linux-x64.AppImage');
  await writeFile(artifactPath, 'synthetic artifact; never executed');
  const input = { artifactPath, version: '2.0.0', url: 'https://downloads.chausar.in/Chausar-2.0.0-linux-x64.AppImage',
    platform: process.platform as 'linux', architecture: process.arch as 'x64', minEngineVersion: '1.0.0', dataSchemaVersion: 1, rollbackSupported: false };
  const signed = await signUpdateManifest(input, { CHAUSAR_RELEASE_PRIVATE_KEY_FILE: keyFile });
  const updater = new ReleaseUpdater({ publicKey: keys.publicKey, version: '1.0.0', stageDirectory: directory });
  const verified = updater.verify(signed.payload, signed.signature);
  assert.equal(verified.version, '2.0.0');
  assert.equal(verified.sha256, signed.manifest.sha256);
  assert.equal(verified.size, 34);
  const other = generateKeyPairSync('ed25519');
  assert.throws(() => new ReleaseUpdater({ publicKey: other.publicKey, version: '1.0.0', stageDirectory: directory }).verify(signed.payload, signed.signature), code('INVALID_RELEASE_SIGNATURE'));
});

test('update-manifest signing refuses RELEASE_KEY_UNCONFIGURED without a usable Ed25519 key', async t => {
  const directory = await temporary(t), artifactPath = join(directory, 'a.zip');
  await writeFile(artifactPath, 'x');
  const input = { artifactPath, version: '2.0.0', url: 'https://downloads.chausar.in/a.zip', platform: 'linux' as const, architecture: 'x64' as const, minEngineVersion: '1.0.0', dataSchemaVersion: 1, rollbackSupported: false };
  await assert.rejects(signUpdateManifest(input, {}), code('RELEASE_KEY_UNCONFIGURED'));
  await assert.rejects(signUpdateManifest(input, { CHAUSAR_RELEASE_PRIVATE_KEY_FILE: 'relative.pem' }), code('RELEASE_KEY_UNCONFIGURED'));
  await assert.rejects(signUpdateManifest(input, { CHAUSAR_RELEASE_PRIVATE_KEY_FILE: join(directory, 'missing.pem') }), code('RELEASE_KEY_UNCONFIGURED'));
  const rsa = join(directory, 'rsa.pem');
  await writeFile(rsa, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
  await assert.rejects(signUpdateManifest(input, { CHAUSAR_RELEASE_PRIVATE_KEY_FILE: rsa }), code('RELEASE_KEY_UNCONFIGURED'));
  const cli = spawnSync(process.execPath, [join(root, 'scripts/release/sign-update-manifest.ts'), '--artifact', artifactPath, '--version', '2.0.0', '--url', 'https://downloads.chausar.in/a.zip',
    '--platform', 'linux', '--arch', 'x64', '--min-engine', '1.0.0', '--data-schema', '1', '--rollback', 'false'], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /^RELEASE_KEY_UNCONFIGURED:/);
});

test('release.yml builds only, never publishes, and passes secrets only through env', async () => {
  const text = await readFile(join(root, '.github/workflows/release.yml'), 'utf8');
  const lines = text.split('\n');
  assert.match(text, /^on:\n {2}workflow_dispatch:/m);
  assert.match(text, /^ {2}push:\n {4}tags: \['v\*'\]/m);
  assert.match(text, /^permissions:\n {2}contents: read$/m);
  for (const input of ['version:', 'channel:', 'sign:', 'draft_release:']) assert.ok(text.includes(`      ${input}`), input);
  assert.match(text, /draft_release:[\s\S]*?default: false/);
  for (const target of ['platform: win32\n            arch: x64', 'platform: darwin\n            arch: arm64', 'platform: darwin\n            arch: x64', 'platform: linux\n            arch: x64'])
    assert.ok(text.includes(target), target);
  for (const step of ['npm ci --ignore-scripts', 'node-version: \'24.13.1\'', 'node node_modules/electron/install.js', 'scripts/release/stage-runtime.ts --platform', 'node scripts/package-preflight.mjs',
    'node scripts/desktop-package.mjs --mode', 'node scripts/release/checksums.ts', 'scripts/release/sign-update-manifest.ts', 'scripts/release/keychain-manifest.ts', 'actions/upload-artifact@v4', 'cmake --build'])
    assert.ok(text.includes(step), step);
  // Never publishes: no electron-builder publish flag and the only release creation is a draft.
  assert.ok(!/--publish (always|onTag|onTagOrDraft)/.test(text));
  assert.ok(!/softprops\/action-gh-release|actions\/create-release/.test(text));
  const creates = lines.filter(line => line.includes('gh release'));
  assert.ok(creates.length === 1 && creates[0].includes('--draft'));
  assert.equal(lines.filter(line => /contents: write/.test(line)).length, 1);
  // Secrets appear only as `NAME: ${{ secrets.X ... }}` env mappings, never inside run text.
  let runIndent = -1;
  for (const line of lines) {
    const indent = line.length - line.trimStart().length;
    if (runIndent >= 0 && line.trim() && indent <= runIndent) runIndent = -1;
    if (runIndent >= 0) { assert.ok(!line.includes('secrets.'), `secret inside run block: ${line.trim()}`); continue; }
    const run = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (run) {
      assert.ok(!run[2].includes('secrets.'), `secret in run line: ${line.trim()}`);
      if (/^[|>]/.test(run[2])) runIndent = run[1].length;
      continue;
    }
    if (line.includes('secrets.')) assert.match(line, /^\s+[A-Z][A-Z0-9_]*: \$\{\{ secrets\.[A-Z0-9_]+( != '')?( && secrets\.[A-Z0-9_]+ != '')? \}\}$/, line);
  }
  // Every signing step is gated by an env flag derived from the secrets.
  assert.ok(text.includes("env.HAS_WIN_SIGNING == 'true'"));
  assert.ok(text.includes("env.HAS_MAC_SIGNING == 'true'"));
  assert.ok(text.includes("env.HAS_RELEASE_KEY == 'true'"));
});

test('both desktop configs package the new UI host, its built bundle and its fonts', async () => {
  for (const name of ['builder.json', 'builder.preview.json']) {
    const config = JSON.parse(await readFile(new URL(`../../app/desktop/${name}`, import.meta.url), 'utf8'));
    for (const path of ['app/ui/host/**/*', 'app/ui/public/**/*', 'app/ui/assets/fonts/**/*']) assert.ok(config.files.includes(path), `${name} must package ${path}`);
  }
});
