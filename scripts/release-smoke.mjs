#!/usr/bin/env node
// D11: the release smoke. Installs a built installer silently into a temp folder, starts the app with a fresh user data
// folder (--smoke-user-data, read by app/desktop/main.cjs before ready), waits for first paint in
// <userData>/diagnostics/startup.jsonl, quits it, checks that no process it started is left, uninstalls, and removes
// its own temp folders. One line per step; a failure exits 1 and names its step.
//   Windows: the NSIS installer (.exe) with /S /D=<dir>; refuses on a computer that already has Chausar installed,
//            since a second per-user install shares the uninstall entry. Run it on CI or a clean VM: it installs only
//            with CI=true or --allow-install, and a reg answer it cannot read counts as an install (it refuses).
//   Linux:   the AppImage with --appimage-extract-and-run (under xvfb-run when there is no display), or the .deb with
//            dpkg -i and dpkg -r where sudo works without a password (skipped otherwise).
//   macOS:   no installer step (a dmg is not mounted here): pass --app with the program inside the built app,
//            release/beta/mac-arm64/Chausar.app/Contents/MacOS/Chausar. Run on a real arm64 build on 14 Nov 2026
//            (macOS 27.2): it passed once main.cjs set the smoke folder before its diagnostics (docs/desktop-releases.md).
// Usage: node scripts/release-smoke.mjs --installer <file> [--allow-install] [--keep] [--timeout-ms N] [--quit-ms N] [--quit-by launch|signal]
//        node scripts/release-smoke.mjs --app <program> [...]   (an already installed program, or a test's stand-in;
//                                                               a .mjs or .js program runs with this Node)
// Quit (15 Nov 2026, the first walk of the built Windows app): "taskkill /PID" without /F only closes a window, and the
// beta keeps running in the tray, so on Windows the smoke always ended the app by force. It now asks the way a person
// or an installer can: a second launch with --quit and the same user data folder (app/desktop/quit-ask.cjs), which
// stops the engine gracefully. That is the way on Windows; elsewhere SIGTERM, which Electron turns into the same quit.
// --quit-by picks either on any system. The forced end stays as the fallback and the quit line says when it was used.
// --keep leaves the temp user data folder for a look. The phase names follow C5's start phases; FIRST_PAINT is the one
// waited for (rebase: take it from C5's exported constant).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIRST_PAINT = 'first-paint';
/** The window opens before the engine has started (15 Nov 2026), so the engine's own phase is waited for too. */
export const ENGINE_READY = 'engine-ready';
const PRODUCT = 'Chausar';
const QUIT_ARGUMENT = '--quit';
const usage = 'Usage: node scripts/release-smoke.mjs --installer <file> | --app <program> [--allow-install] [--keep] [--timeout-ms N] [--quit-ms N] [--quit-by launch|signal]';
/** How the smoke asks the app to quit: a second launch with --quit on Windows, SIGTERM elsewhere. */
export const quitWay = (platform = process.platform) => (platform === 'win32' ? 'launch' : 'signal');

const sleep = ms => new Promise(done => setTimeout(done, ms));
const ok = (step, detail = '') => process.stdout.write(`ok   ${step}${detail ? `: ${detail}` : ''}\n`);
class StepFailure extends Error { constructor(step, reason) { super(reason); this.step = step; } }
const fail = (step, reason) => { throw new StepFailure(step, reason); };

function parse(argv) {
  const options = { keep: false, allowInstall: false, timeoutMs: 90_000, quitMs: 20_000, quitBy: quitWay() };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--keep') options.keep = true;
    else if (arg === '--allow-install') options.allowInstall = true;
    else if (['--installer', '--app', '--timeout-ms', '--quit-ms', '--quit-by'].includes(arg) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      const value = argv[++index];
      if (arg === '--installer') options.installer = resolve(value);
      else if (arg === '--app') options.app = resolve(value);
      else if (arg === '--quit-by') { if (value !== 'launch' && value !== 'signal') return null; options.quitBy = value; }
      else if (/^\d+$/.test(value)) options[arg === '--timeout-ms' ? 'timeoutMs' : 'quitMs'] = Number(value);
      else return null;
    } else return null;
  }
  if (Boolean(options.installer) === Boolean(options.app)) return null;
  return options;
}

/** Every process on this computer: [{ pid, ppid, name }]. Windows through CIM (hidden PowerShell), else ps. */
function listProcesses() {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }'], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    return result.stdout.split(/\r?\n/).map(line => /^(\d+) (\d+) (.*)$/.exec(line.trim())).filter(Boolean).map(([, pid, ppid, name]) => ({ pid: Number(pid), ppid: Number(ppid), name }));
  }
  const result = spawnSync('ps', ['-eo', 'pid=,ppid=,comm='], { encoding: 'utf8', timeout: 60_000 });
  return result.stdout.split('\n').map(line => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)).filter(Boolean).map(([, pid, ppid, name]) => ({ pid: Number(pid), ppid: Number(ppid), name: name.trim() }));
}

/** The process and everything it started, from one listing. */
function treeOf(root, processes) {
  const found = new Map([[root, processes.find(item => item.pid === root) ?? { pid: root, ppid: 0, name: '?' }]]);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of processes) if (!found.has(item.pid) && found.has(item.ppid) && item.pid !== item.ppid) { found.set(item.pid, item); grew = true; }
  }
  return [...found.values()];
}
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

async function waitForPaint(phasesFile, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let missing = FIRST_PAINT;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) fail('first paint', `the app exited (${child.exitCode ?? child.signalCode}) before first paint`);
    if (existsSync(phasesFile)) {
      const phases = readFileSync(phasesFile, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line).phase; } catch { return null; } });
      missing = [FIRST_PAINT, ENGINE_READY].find(phase => !phases.includes(phase)) ?? null;
      if (!missing) return phases;
    }
    await sleep(250);
  }
  fail('first paint', `no ${missing} phase in ${phasesFile} within ${Math.round(timeoutMs / 1000)} s`);
}

/** Starts the program with a fresh user data folder, waits for first paint, quits it, checks nothing is left. */
async function smoke(program, options, wrap = null) {
  // Under the temp folder's real path: on a Mac it is reached through a link (/var to /private/var), and the vault
  // refuses linked paths, so the app could not list its businesses there and never showed its real first screen.
  const userData = await mkdtemp(join(realpathSync(tmpdir()), 'chausar-smoke-'));
  process.stdout.write(`user data: ${userData}\n`);
  const node = /\.(?:mjs|js)$/.test(program);
  const appArgs = [`--smoke-user-data=${userData}`];
  const launch = extra => (wrap ? wrap(program, [...extra, ...appArgs]) : node ? [process.execPath, [program, ...extra, ...appArgs]] : [program, [...extra, ...appArgs]]);
  const [command, args] = launch([]);
  const child = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  const exited = new Promise(done => child.once('exit', done));
  let failure = null;
  try {
    await new Promise((done, reject) => { child.once('spawn', done); child.once('error', error => reject(new StepFailure('launch', error.message))); });
    ok('launch', `${basename(program)} (pid ${child.pid})`);
    const phases = await waitForPaint(join(userData, 'diagnostics', 'startup.jsonl'), child, options.timeoutMs);
    ok('first paint', phases.join(', '));
  } catch (error) { failure = error; }

  // Quit whether or not it painted: politely first, then by force; then nothing it started may be left.
  const started = treeOf(child.pid, listProcesses());
  if (child.exitCode === null && child.signalCode === null) {
    // The ask: a second launch with --quit and the same user data folder, or SIGTERM (see the top of this file).
    let asking = null;
    if (options.quitBy === 'launch') {
      const [askCommand, askArgs] = launch([QUIT_ARGUMENT]);
      asking = spawn(askCommand, askArgs, { stdio: 'ignore', windowsHide: true });
      asking.once('error', () => { /* it could not start: the wait below ends in the forced fallback */ });
    } else child.kill('SIGTERM');
    const how = asking ? 'a --quit launch' : 'SIGTERM';
    const quitted = await Promise.race([exited.then(() => true), sleep(options.quitMs).then(() => false)]);
    if (!quitted) { child.kill('SIGKILL'); await exited; }
    // The asking launch leaves by itself once the app has gone; one still waiting (the app never closed) is ended.
    if (asking && asking.exitCode === null && asking.signalCode === null) {
      const askGone = new Promise(done => asking.once('exit', done));
      if (!(await Promise.race([askGone.then(() => true), sleep(quitted ? 5_000 : 0).then(() => false)]))) { asking.kill('SIGKILL'); await askGone; }
    }
    ok('quit', quitted ? `it closed when asked (${how})` : `forced after ${Math.round(options.quitMs / 1000)} s: it did not close when asked (${how})`);
  } else ok('quit', 'it had already exited');
  let left = started.filter(item => item.pid !== child.pid);
  for (let wait = 0; wait < 20 && left.some(item => alive(item.pid)); wait++) await sleep(250);
  left = left.filter(item => alive(item.pid));
  for (const item of left) { try { process.kill(item.pid, 'SIGKILL'); } catch { /* gone */ } }
  const leftFailure = left.length ? new StepFailure('no process left', `${left.length} process${left.length === 1 ? '' : 'es'} still running: ${left.map(item => `${item.pid} ${item.name}`).join(', ')} (ended now)`) : null;
  if (!leftFailure) ok('no process left');

  if (options.keep) ok('clean up', `kept ${userData}`);
  else { await rm(userData, { recursive: true, force: true }); ok('clean up', 'temp user data removed'); }
  if (failure) throw failure;
  if (leftFailure) throw leftFailure;
}

const runReg = args => spawnSync('reg', args, { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
/** How many uninstall entries hold the text, or null when the answer cannot be read (a failure, or another language). */
function uninstallEntries(text, reg = runReg) {
  const result = reg(['query', UNINSTALL_KEY, '/s', '/f', text, '/d']);
  const match = !result?.error && /^End of search: (\d+) match\(es\) found\.?\s*$/m.exec(result?.stdout ?? '');
  return match ? Number(match[1]) : null;
}

/**
 * Why the Windows installer must not run here, or null. It runs only on CI (CI=true) or with --allow-install, and only
 * when reg says plainly that no Chausar is installed for this user: an answer it cannot read counts as installed.
 */
export function installRefusal({ reg = runReg, env = process.env, allowInstall = false } = {}) {
  if (env.CI !== 'true' && !allowInstall) return 'the Windows smoke installs and uninstalls a real build, so it runs only with CI=true or --allow-install';
  const found = uninstallEntries(PRODUCT, reg);
  if (found === null) return `could not read the installed programs (reg query failed or answered in another language); refusing in case ${PRODUCT} is installed`;
  if (found > 0) return `this computer already has ${PRODUCT} installed for this user; run the smoke on CI or a clean machine`;
  return null;
}

async function windowsInstaller(options) {
  if (process.platform !== 'win32') fail('install', 'an NSIS installer runs on Windows only');
  const refusal = installRefusal({ allowInstall: options.allowInstall });
  if (refusal) fail('install', refusal);
  const dir = await mkdtemp(join(tmpdir(), 'chausar-smoke-install-'));
  const install = spawnSync(options.installer, ['/S', `/D=${dir}`], { windowsHide: true, timeout: 300_000 });
  const program = join(dir, `${PRODUCT}.exe`);
  if (install.status !== 0 || !existsSync(program)) fail('install', `the installer exited ${install.status} and ${program} is ${existsSync(program) ? 'there' : 'missing'}`);
  ok('install', dir);
  let failure = null;
  try { await smoke(program, options); } catch (error) { failure = error; }
  spawnSync(join(dir, `Uninstall ${PRODUCT}.exe`), ['/S'], { windowsHide: true, timeout: 300_000 });
  for (let wait = 0; wait < 120 && existsSync(program); wait++) await sleep(500);
  if (existsSync(program)) failure ??= new StepFailure('uninstall', `${program} is still there`);
  else if (uninstallEntries(dir) !== 0) failure ??= new StepFailure('uninstall', `the uninstall entry for ${dir} is still in the registry, or reg could not say`);
  else ok('uninstall', 'the install folder and its uninstall entry are gone');
  await rm(dir, { recursive: true, force: true });
  if (failure) throw failure;
}

async function linuxAppImage(options) {
  chmodSync(options.installer, 0o755);
  ok('install', 'the AppImage runs in place (--appimage-extract-and-run)');
  const xvfb = !process.env.DISPLAY && spawnSync('sh', ['-c', 'command -v xvfb-run'], { encoding: 'utf8' }).status === 0;
  await smoke(options.installer, options, (program, appArgs) => (xvfb ? ['xvfb-run', ['-a', program, '--appimage-extract-and-run', ...appArgs]] : [program, ['--appimage-extract-and-run', ...appArgs]]));
}

async function linuxDeb(options) {
  if (spawnSync('sudo', ['-n', 'true'], { stdio: 'ignore' }).status !== 0) { ok('skip', 'the .deb needs sudo without a password here; nothing was installed'); return; }
  const name = spawnSync('dpkg-deb', ['-f', options.installer, 'Package'], { encoding: 'utf8' }).stdout.trim();
  if (spawnSync('sudo', ['-n', 'dpkg', '-i', options.installer], { stdio: 'ignore' }).status !== 0) fail('install', `dpkg -i ${options.installer} failed`);
  ok('install', name);
  let failure = null;
  try {
    const program = spawnSync('dpkg', ['-L', name], { encoding: 'utf8' }).stdout.split('\n').find(path => /\/opt\/[^/]+\/[^/.]+$/.test(path) && existsSync(path));
    if (!program) fail('install', `no program under /opt in ${name}`);
    const xvfb = !process.env.DISPLAY;
    await smoke(program, options, (file, appArgs) => (xvfb ? ['xvfb-run', ['-a', file, ...appArgs]] : [file, appArgs]));
  } catch (error) { failure = error; }
  if (spawnSync('sudo', ['-n', 'dpkg', '-r', name], { stdio: 'ignore' }).status !== 0) failure ??= new StepFailure('uninstall', `dpkg -r ${name} failed`);
  else ok('uninstall', name);
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parse(process.argv.slice(2));
  if (!options) { process.stderr.write(`${usage}\n`); process.exit(2); }
  const kind = options.app ? 'app' : /\.exe$/i.test(options.installer) ? 'nsis' : /\.AppImage$/i.test(options.installer) ? 'appimage' : /\.deb$/i.test(options.installer) ? 'deb' : null;
  // The Mac build (14 Nov 2026): nothing here mounts a dmg or unpacks a Mac zip. A Mac build is smoked with --app.
  if (!kind && /(?:\.dmg|-mac-[^\\/]*\.zip)$/i.test(options.installer)) { process.stderr.write(`A Mac build is smoked from the app itself: pass --app <the built app's program, release/beta/mac-arm64/Chausar.app/Contents/MacOS/Chausar say>, not the dmg or zip.\n${usage}\n`); process.exit(2); }
  if (!kind) { process.stderr.write(`The installer must be a .exe (Windows NSIS), .AppImage or .deb file.\n${usage}\n`); process.exit(2); }
  try {
    if (kind === 'app') await smoke(options.app, options);
    else if (kind === 'nsis') await windowsInstaller(options);
    else if (kind === 'appimage') await linuxAppImage(options);
    else await linuxDeb(options);
    process.stdout.write('The release smoke passed.\n');
  } catch (error) {
    const step = error instanceof StepFailure ? error.step : 'smoke';
    process.stdout.write(`FAIL ${step}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
