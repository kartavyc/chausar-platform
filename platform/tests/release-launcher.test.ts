import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalReleaseManifest, type ReleaseManifest } from '../runtime/updater.ts';
import type { HttpRequest, HttpResponse } from '../runtime/connectors.ts';
import { canonicalChannelDocument, type ChannelRelease } from '../runtime/native/update-channel.ts';
import { UpdateService } from '../runtime/native/update-service.ts';
import { MAX_TRIAL_LAUNCHES } from '../runtime/native/update-install.ts';
import { confirmInstalledTrial, findAppExecutable } from '../runtime/native/update-launch.ts';

/**
 * End to end on real files: a first install adopted from a tar.gz, the real UpdateService (signed feed,
 * signed manifest, staged download through the injectable HTTP seam, confirmed apply), the real POSIX
 * launcher stub resolving each launch through the installed copy's own resolver, a fake app executable
 * that does or does not reach an open workspace, automatic rollback, engine-side confirmation through the
 * release module, and the kill switch's advised rollback. Synthetic keys; nothing leaves the machine.
 */
const posix = process.platform !== 'win32' && spawnSync('tar', ['--version']).status === 0 && spawnSync('sh', ['-c', 'exit 0']).status === 0;
const repo = fileURLToPath(new URL('../..', import.meta.url));
const launcherSource = join(repo, 'scripts', 'release', 'launcher', 'chausar-launcher.sh');
const resolverModule = join(repo, 'platform', 'runtime', 'native', 'update-launch.ts');
const keys = generateKeyPairSync('ed25519'), signText = (text:string) => sign(null, Buffer.from(text), keys.privateKey).toString('base64url');
const hash = (bytes:Uint8Array|string) => createHash('sha256').update(bytes).digest('hex');
const FEED = 'https://updates.example.com/stable.json', HOUR = 3600000;
const sq = (value:string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** A tar.gz shaped like electron-builder's Linux archive: one top folder with the executable and resources/app.asar.unpacked. */
async function versionArchive(work:string, version:string, options:{ brokenNodeMode?:boolean; confirmScript:string }) {
  const top = join(work, `src-${version}`, `chausar-${version}`), native = join(top, 'resources', 'app.asar.unpacked', 'platform', 'runtime', 'native');
  await mkdir(native, { recursive: true });
  await writeFile(join(top, 'resources', 'app.asar.unpacked', 'package.json'), '{"type":"module"}\n');
  // The packaged resolver is the real module; this copy only forwards to it (the test has no packaged app).
  await writeFile(join(native, 'update-launch.ts'), `import { main } from ${JSON.stringify(resolverModule)};\nprocess.exitCode = await main(process.argv.slice(2));\n`);
  // The fake app: Node mode runs scripts (like Electron with ELECTRON_RUN_AS_NODE); app mode logs the launch and,
  // when told to, opens a workspace in a real engine, which confirms the trial through the release module.
  await writeFile(join(top, 'chausar'), [
    '#!/bin/sh',
    options.brokenNodeMode ? 'if [ "${ELECTRON_RUN_AS_NODE:-}" = 1 ]; then echo "broken node mode" >&2; exit 9; fi' : `if [ "\${ELECTRON_RUN_AS_NODE:-}" = 1 ]; then exec ${sq(process.execPath)} "$@"; fi`,
    `printf '%s %s %s\\n' ${sq(version)} "$CHAUSAR_INSTALL_ROOT" "$*" >> "$FAKE_LAUNCH_LOG"`,
    `if [ "\${FAKE_OPENS_WORKSPACE:-}" = 1 ]; then exec ${sq(process.execPath)} ${sq(options.confirmScript)} ${sq(version)}; fi`,
    'exit 0', ''].join('\n'));
  await chmod(join(top, 'chausar'), 0o755);
  const archive = join(work, `chausar-${version}-linux-x64.tar.gz`);
  assert.equal(spawnSync('tar', ['-czf', archive, '-C', join(work, `src-${version}`), `chausar-${version}`], { shell: false }).status, 0);
  return { archive, bytes: await readFile(archive) };
}

async function world(t:any) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-release-launcher-')); t.after(() => rm(root, { recursive: true, force: true }));
  const work = join(root, 'work'), installRoot = join(root, 'install'), appData = join(root, 'app-data'), log = join(root, 'launches.log');
  await mkdir(work); await writeFile(log, '');
  // What the installed app's engine does after a workspace opens: the desktop host calls release.status,
  // and the release module (wired from CHAUSAR_INSTALL_ROOT by its hostOptions) commits the trial.
  const confirmScript = join(work, 'open-workspace.ts');
  await writeFile(confirmScript, [
    `import { mkdtemp } from 'node:fs/promises';`,
    `import { join } from 'node:path';`,
    `import { Engine } from ${JSON.stringify(join(repo, 'platform', 'runtime', 'engine.ts'))};`,
    `const directory = await mkdtemp(join(${JSON.stringify(root)}, 'engine-'));`,
    `const engine = new Engine({ directory, version: process.argv[2], demo: true, storage: 'experimental-file' });`,
    `await engine.request('workspace.create', { name: 'Synthetic launcher shop', passphrase: 'synthetic-launcher-passphrase', demo: true });`,
    `const status = await engine.request('release.status');`,
    `process.stdout.write(JSON.stringify({ trial: status.trial }) + '\\n');`, ''].join('\n'));
  const feedFiles:Record<string, string|Uint8Array> = {};
  let issued = Date.now() - 10 * HOUR;
  const publish = (releases:ChannelRelease[]) => {
    issued += HOUR;
    const text = canonicalChannelDocument({ format: 'chausar.channel.v1', channel: 'stable', issuedAt: new Date(issued).toISOString(), expiresAt: new Date(Date.now() + 24 * HOUR).toISOString(), releases });
    feedFiles[FEED] = text; feedFiles[FEED + '.sig'] = signText(text);
  };
  const release = async (version:string, options:{ brokenNodeMode?:boolean } = {}) => {
    const { bytes } = await versionArchive(work, version, { ...options, confirmScript });
    const manifest:ReleaseManifest = { schemaVersion: 1, version, publishedAt: '2026-10-01T00:00:00.000Z', platform: 'linux', architecture: process.arch as ReleaseManifest['architecture'],
      url: `https://downloads.example.com/chausar-${version}-linux-x64.tar.gz`, sha256: hash(bytes), size: bytes.length, minEngineVersion: '0.1.0', dataSchemaVersion: 1, rollback: { supported: true, requiresBackup: true } };
    const text = canonicalReleaseManifest(manifest), manifestUrl = `https://updates.example.com/releases/${version}/linux-${process.arch}.json`;
    Object.assign(feedFiles, { [manifestUrl]: text, [manifestUrl + '.sig']: signText(text), [manifest.url]: bytes });
    return { version, platform: 'linux', architecture: process.arch, manifestSha256: hash(text), rolloutPercent: 100, withdrawn: false, previewExpiresAt: null } as ChannelRelease;
  };
  const requested:string[] = [];
  const http = async (request:HttpRequest):Promise<HttpResponse> => { requested.push(request.url); const body = feedFiles[request.url]; return body === undefined ? { status: 404, url: request.url, body: '' } : { status: 200, url: request.url, body }; };
  const service = (version:string) => new UpdateService({ publicKey: keys.publicKey, version, channel: 'stable', installRoot, appDataDirectory: appData, feedUrl: FEED, http, installId: 'install-launcher-0001', demo: false });
  const launch = (env:Record<string, string> = {}) => {
    const result = spawnSync(join(installRoot, 'chausar-launcher'), ['--synthetic-flag'], { encoding: 'utf8', shell: false, timeout: 60000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, FAKE_LAUNCH_LOG: log, ...env } });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  const launches = async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(line => line.split(' ')[0]);
  const pointer = async () => JSON.parse(await readFile(join(installRoot, 'current.json'), 'utf8'));
  return { root, work, installRoot, confirmScript, publish, release, service, launch, launches, pointer, requested, log };
}

test('launcher: adopt, update, two unconfirmed launches, automatic rollback, confirmed update and the kill switch', { skip: !posix, timeout: 180000 }, async t => {
  const w = await world(t);
  // 1. First install from a checked archive, through the resolver's own command line.
  const first = await versionArchive(w.work, '1.0.0', { confirmScript: w.confirmScript });
  const adopt = spawnSync(process.execPath, [resolverModule, 'adopt', '--install-root', w.installRoot, '--archive', first.archive, '--version', '1.0.0', '--launcher', launcherSource], { encoding: 'utf8' });
  assert.equal(adopt.status, 0, adopt.stderr);
  assert.match(adopt.stdout, /^version=1\.0\.0$/m);
  assert.deepEqual((await w.pointer()).state, 'committed');
  assert.equal(await findAppExecutable(join(w.installRoot, 'versions', '1.0.0')), join(w.installRoot, 'versions', '1.0.0', 'chausar-1.0.0', 'chausar'));
  let run = w.launch();
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(await w.launches(), ['1.0.0']);
  assert.match(await readFile(w.log, 'utf8'), new RegExp(`^1\\.0\\.0 ${w.installRoot} --synthetic-flag$`, 'm'));

  // 2. The real update flow: signed feed → check → stage → confirmed apply leaves 1.1.0 on trial.
  //    1.1.0's own Node mode is broken: its predecessor resolves the launch, so rollback still works.
  w.publish([await w.release('1.1.0', { brokenNodeMode: true })]);
  const v1 = w.service('1.0.0'), checked = await v1.check();
  assert.ok(checked.action === 'update' && checked.version === '1.1.0' && checked.installMode === 'in-place-swap');
  assert.equal((await v1.stage()).installed, false);
  assert.equal((await w.pointer()).version, '1.0.0');
  const applied = await v1.apply({ confirmed: true });
  assert.deepEqual([applied.version, applied.previous, applied.state], ['1.1.0', '1.0.0', 'trial']);

  // 3. Launches that never open a workspace: two trial launches, then the third returns to 1.0.0.
  for (let attempt = 1; attempt <= MAX_TRIAL_LAUNCHES; attempt++) {
    run = w.launch(); assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(await w.pointer(), { ...(await w.pointer()), version: '1.1.0', state: 'trial', attempts: attempt });
  }
  run = w.launch(); assert.equal(run.status, 0, run.stderr);
  assert.match(run.stderr, /version 1\.1\.0 did not confirm a clean start twice; returned to 1\.0\.0/);
  assert.deepEqual(await w.launches(), ['1.0.0', '1.1.0', '1.1.0', '1.0.0']);
  const back = await w.pointer();
  assert.deepEqual([back.version, back.previous, back.state, back.attempts], ['1.0.0', null, 'committed', 0]);
  run = w.launch(); assert.equal(run.status, 0); assert.equal((await w.launches()).at(-1), '1.0.0');

  // 4. A working update: the first launch opens a workspace and the engine's release module confirms it.
  w.publish([await w.release('1.2.0')]);
  const again = w.service('1.0.0'), next = await again.check();
  assert.ok(next.action === 'update' && next.version === '1.2.0');
  await again.stage(); await again.apply({ confirmed: true });
  assert.deepEqual([(await w.pointer()).version, (await w.pointer()).state], ['1.2.0', 'trial']);
  run = w.launch({ FAKE_OPENS_WORKSPACE: '1' }); assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout.trim().split('\n').at(-1)!), { trial: 'confirmed' });
  assert.deepEqual([(await w.pointer()).version, (await w.pointer()).previous, (await w.pointer()).state], ['1.2.0', '1.0.0', 'committed']);
  for (let index = 0; index < 3; index++) { run = w.launch(); assert.equal(run.status, 0); }
  assert.deepEqual((await w.launches()).slice(-4), ['1.2.0', '1.2.0', '1.2.0', '1.2.0']);
  assert.equal((await w.pointer()).attempts, 0);
  assert.equal(await confirmInstalledTrial(w.installRoot, '1.2.0'), 'already-committed');
  assert.equal(await confirmInstalledTrial(w.installRoot, '1.0.0'), 'other-version');
  // The failed 1.1.0 was pruned when 1.2.0 arrived only if beyond the kept versions; 1.0.0 must still be there.
  assert.ok((await readdir(join(w.installRoot, 'versions'))).includes('1.0.0'));

  // 5. The publisher withdraws 1.2.0: the running 1.2.0 is advised to roll back to the installed 1.0.0.
  const withdrawn = await w.release('1.2.0');
  w.publish([{ ...(await w.release('1.0.0')) }, { ...withdrawn, withdrawn: true }]);
  const v12 = w.service('1.2.0'), advice = await v12.check();
  assert.ok(advice.action === 'rollback-advised' && advice.to === '1.0.0' && advice.previousInstalled === true);
  await assert.rejects(v12.rollback({ confirmed: false }), (error:any) => error.code === 'CONFIRMATION_REQUIRED');
  assert.deepEqual(await v12.rollback({ confirmed: true }), { rolledBack: true, from: '1.2.0', to: '1.0.0', restartRequired: true });
  run = w.launch(); assert.equal(run.status, 0, run.stderr);
  assert.equal((await w.launches()).at(-1), '1.0.0');
  assert.ok(w.requested.every(url => url.startsWith('https://')));
});

test('launcher: refuses without an install, with an unsafe executable name, and when no copy can resolve', { skip: !posix, timeout: 60000 }, async t => {
  const w = await world(t);
  await mkdir(w.installRoot, { recursive: true });
  await writeFile(join(w.installRoot, 'chausar-launcher'), await readFile(launcherSource)); await chmod(join(w.installRoot, 'chausar-launcher'), 0o755);
  let run = w.launch();
  assert.equal(run.status, 66); assert.match(run.stderr, /LAUNCH_NOT_INSTALLED/);
  run = w.launch({ CHAUSAR_EXECUTABLE_NAME: '../evil' });
  assert.equal(run.status, 64); assert.match(run.stderr, /LAUNCH_EXECUTABLE_INVALID/);
  const only = await versionArchive(w.work, '2.0.0', { brokenNodeMode: true, confirmScript: w.confirmScript });
  await rm(join(w.installRoot, 'chausar-launcher'));
  const adopt = spawnSync(process.execPath, [resolverModule, 'adopt', '--install-root', w.installRoot, '--archive', only.archive, '--version', '2.0.0', '--launcher', launcherSource], { encoding: 'utf8' });
  assert.equal(adopt.status, 0, adopt.stderr);
  run = w.launch();
  assert.equal(run.status, 70); assert.match(run.stderr, /LAUNCH_UNRESOLVED/);
  assert.equal(await readFile(w.log, 'utf8'), '');
  const usage = spawnSync(process.execPath, [resolverModule, 'resolve'], { encoding: 'utf8' });
  assert.equal(usage.status, 64); assert.match(usage.stderr, /LAUNCH_USAGE/);
  const missing = spawnSync(process.execPath, [resolverModule, 'resolve', '--install-root', join(w.root, 'nowhere')], { encoding: 'utf8' });
  assert.equal(missing.status, 70); assert.match(missing.stderr, /LAUNCH_NOT_INSTALLED/); assert.doesNotMatch(missing.stderr, /nowhere/);
});
