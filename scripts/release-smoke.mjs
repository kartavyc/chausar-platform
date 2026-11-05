#!/usr/bin/env node
// D11: the release smoke. Installs a built installer silently into a temp folder, starts the app with a fresh user data
// folder (--smoke-user-data, read by app/desktop/main.cjs before ready), waits for first paint in
// <userData>/diagnostics/startup.jsonl, quits it, checks that no process it started is left, uninstalls, and removes
// its own temp folders. One line per step; a failure exits 1 and names its step.
//   Windows: the NSIS installer (.exe) with /S /D=<dir>; refuses on a computer that already has Chausar installed,
//            since a second per-user install shares the uninstall entry. Run it on CI or a clean VM.
//   Linux:   the AppImage with --appimage-extract-and-run (under xvfb-run when there is no display), or the .deb with
//            dpkg -i and dpkg -r where sudo works without a password (skipped otherwise).
// Usage: node scripts/release-smoke.mjs --installer <file> [--keep] [--timeout-ms N] [--quit-ms N]
//        node scripts/release-smoke.mjs --app <program> [...]   (an already installed program, or a test's stand-in;
//                                                               a .mjs or .js program runs with this Node)
// --keep leaves the temp user data folder for a look. The phase names follow C5's start phases; FIRST_PAINT is the one
// waited for (rebase: take it from C5's exported constant).
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIRST_PAINT = 'first-paint';
const PRODUCT = 'Chausar';
const usage = 'Usage: node scripts/release-smoke.mjs --installer <file> | --app <program> [--keep] [--timeout-ms N] [--quit-ms N]';

const sleep = ms => new Promise(done => setTimeout(done, ms));
const ok = (step, detail = '') => process.stdout.write(`ok   ${step}${detail ? `: ${detail}` : ''}\n`);
class StepFailure extends Error { constructor(step, reason) { super(reason); this.step = step; } }
const fail = (step, reason) => { throw new StepFailure(step, reason); };

function parse(argv) {
  const options = { keep: false, timeoutMs: 90_000, quitMs: 10_000 };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--keep') options.keep = true;
    else if (['--installer', '--app', '--timeout-ms', '--quit-ms'].includes(arg) && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      const value = argv[++index];
      if (arg === '--installer') options.installer = resolve(value);
      else if (arg === '--app') options.app = resolve(value);
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
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) fail('first paint', `the app exited (${child.exitCode ?? child.signalCode}) before first paint`);
    if (existsSync(phasesFile)) {
      const phases = readFileSync(phasesFile, 'utf8').split('\n').filter(Boolean).map(line => { try { return JSON.parse(line).phase; } catch { return null; } });
      if (phases.includes(FIRST_PAINT)) return phases;
    }
    await sleep(250);
  }
  fail('first paint', `no ${FIRST_PAINT} phase in ${phasesFile} within ${Math.round(timeoutMs / 1000)} s`);
}

/** Starts the program with a fresh user data folder, waits for first paint, quits it, checks nothing is left. */
async function smoke(program, options, wrap = null) {
  const userData = await mkdtemp(join(tmpdir(), 'chausar-smoke-'));
  process.stdout.write(`user data: ${userData}\n`);
  const node = /\.(?:mjs|js)$/.test(program);
  const appArgs = [`--smoke-user-data=${userData}`];
  const [command, args] = wrap ? wrap(program, appArgs) : node ? [process.execPath, [program, ...appArgs]] : [program, appArgs];
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
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid)], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
    const quitted = await Promise.race([exited.then(() => true), sleep(options.quitMs).then(() => false)]);
    if (!quitted) { child.kill('SIGKILL'); await exited; }
    ok('quit', quitted ? 'it closed when asked' : `forced after ${Math.round(options.quitMs / 1000)} s`);
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

const reg = args => spawnSync('reg', args, { encoding: 'utf8', windowsHide: true });
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
const uninstallEntries = text => Number(/(\d+) match\(es\) found/.exec(reg(['query', UNINSTALL_KEY, '/s', '/f', text, '/d']).stdout)?.[1] ?? 0);

async function windowsInstaller(options) {
  if (process.platform !== 'win32') fail('install', 'an NSIS installer runs on Windows only');
  if (uninstallEntries(PRODUCT) > 0) fail('install', `this computer already has ${PRODUCT} installed for this user; run the smoke on CI or a clean machine`);
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
  else if (uninstallEntries(dir) > 0) failure ??= new StepFailure('uninstall', `the uninstall entry for ${dir} is still in the registry`);
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
