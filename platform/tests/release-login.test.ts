import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StartAtLogin, loginAgentPlist, quoteDesktopExec, shellSetStartAtLogin, shellStartAtLogin, windowsRunValue, xdgAutostartEntry } from '../runtime/native/start-at-login.ts';
import type { ServiceRunner } from '../runtime/native/background-service.ts';

const code = (expected: string) => (error: any) => error?.code === expected;

/** Reads an Exec value back the way a Desktop Entry consumer does: string unescape, then
 * quoted-argument unescape, then %% → %. */
function parseExec(value: string): string[] {
  const unescaped = value.replace(/\\([\\sntr])/g, (_m, c) => ({ '\\': '\\', s: ' ', n: '\n', t: '\t', r: '\r' } as any)[c]);
  const args: string[] = []; let current = ''; let quoted = false; let started = false;
  for (let i = 0; i < unescaped.length; i++) {
    const c = unescaped[i];
    if (quoted) {
      if (c === '\\') { current += unescaped[++i]; continue; }
      if (c === '"') { quoted = false; continue; }
      current += c;
    } else if (c === '"') { quoted = true; started = true; }
    else if (c === ' ') { if (started) args.push(current); current = ''; started = false; }
    else { current += c; started = true; }
  }
  if (started) args.push(current);
  return args.map(arg => arg.replace(/%%/g, '%'));
}

test('Desktop Entry Exec quoting round-trips spaces, quotes, backquotes, dollars, backslashes and percents', () => {
  const tricky = '/opt/My "Apps"/`x` $HOME \\bin 50%/chausar';
  const exec = quoteDesktopExec(tricky);
  assert.equal(exec, '"/opt/My \\\\"Apps\\\\"/\\\\`x\\\\` \\\\$HOME \\\\\\\\bin 50%%/chausar"');
  assert.deepEqual(parseExec(`${exec} --start-at-login`), [tricky, '--start-at-login']);
  const entry = xdgAutostartEntry('/opt/Chausar/chausar');
  for (const line of ['[Desktop Entry]', 'Type=Application', 'Exec="/opt/Chausar/chausar" --start-at-login', 'X-GNOME-Autostart-enabled=true', 'Terminal=false'])
    assert.ok(entry.split('\n').includes(line), line);
});

test('macOS login agent is distinct from the background agent: own label, RunAtLoad, no KeepAlive, escaped', () => {
  const plist = loginAgentPlist('/Applications/Chausar & Co.app/Contents/MacOS/Chausar');
  assert.match(plist, /<key>Label<\/key>\s*<string>in\.chausar\.login<\/string>/);
  assert.match(plist, /<string>\/Applications\/Chausar &amp; Co\.app\/Contents\/MacOS\/Chausar<\/string>\s*<string>--start-at-login<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.ok(!/KeepAlive|in\.chausar\.background|--background/.test(plist));
});

test('Windows: HKCU Run value through reg.exe only (no PowerShell), quoted executable', async () => {
  assert.equal(windowsRunValue('C:\\Program Files\\Chausar\\Chausar.exe'), '"C:\\Program Files\\Chausar\\Chausar.exe" --start-at-login');
  let value: string | null = null; const calls: string[][] = [];
  const runner: ServiceRunner = async (command, args) => {
    assert.equal(command, 'C:\\Windows\\System32\\reg.exe'); calls.push(args);
    if (args[0] === 'add') { value = args[args.indexOf('/d') + 1]; return { code: 0, stdout: 'The operation completed successfully.', stderr: '' }; }
    if (args[0] === 'delete') { value = null; return { code: 0, stdout: '', stderr: '' }; }
    return value === null ? { code: 1, stdout: '', stderr: 'ERROR: The system was unable to find the specified registry key or value.' }
      : { code: 0, stdout: `\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\r\n    Chausar    REG_SZ    ${value}\r\n\r\n`, stderr: '' };
  };
  const login = new StartAtLogin({ platform: 'win32', executable: 'C:\\Program Files\\Chausar\\Chausar.exe', systemRoot: 'C:\\Windows', runner });
  const path = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Chausar';
  assert.deepEqual(await shellStartAtLogin(login), { platform: 'win32', mechanism: 'windows-run-key', enabled: false, path, matches: null });
  await assert.rejects(shellSetStartAtLogin(login, { enabled: true }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(shellSetStartAtLogin(login, { enabled: 'yes', confirmed: true }), code('INVALID_REQUEST'));
  assert.deepEqual(await shellSetStartAtLogin(login, { enabled: true, confirmed: true }), { platform: 'win32', mechanism: 'windows-run-key', enabled: true, path, matches: true });
  assert.deepEqual(calls.find(args => args[0] === 'add'), ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Chausar', '/t', 'REG_SZ', '/d', '"C:\\Program Files\\Chausar\\Chausar.exe" --start-at-login', '/f']);
  value = '"C:\\Old\\Chausar.exe" --start-at-login';
  assert.equal((await login.status()).matches, false);
  assert.equal((await shellSetStartAtLogin(login, { enabled: false, confirmed: true })).enabled, false);
  assert.deepEqual(calls.find(args => args[0] === 'delete'), ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Chausar', '/f']);
  calls.length = 0;
  await login.set({ enabled: false, confirmed: true });
  assert.ok(!calls.some(args => args[0] === 'delete'), 'nothing to delete');
});

test('macOS: writes and removes the LaunchAgent file without launchctl', async t => {
  const home = await mkdtemp(join(tmpdir(), 'chausar-login-mac-')); t.after(() => rm(home, { recursive: true, force: true }));
  const runner: ServiceRunner = async () => { throw new Error('No command may run.'); };
  const login = new StartAtLogin({ platform: 'darwin', executable: '/Applications/Chausar.app/Contents/MacOS/Chausar', homeDirectory: home, runner });
  const path = join(home, 'Library', 'LaunchAgents', 'in.chausar.login.plist');
  assert.deepEqual(await login.set({ enabled: true, confirmed: true }), { platform: 'darwin', mechanism: 'macos-launch-agent', enabled: true, path, matches: true });
  assert.equal(await readFile(path, 'utf8'), loginAgentPlist('/Applications/Chausar.app/Contents/MacOS/Chausar'));
  assert.equal((await login.set({ enabled: false, confirmed: true })).enabled, false);
  assert.equal(existsSync(path), false);
});

test('real Linux: writes, reads and removes ~/.config/autostart/in.chausar.desktop in a temporary home', async t => {
  const home = await mkdtemp(join(tmpdir(), 'chausar-login-linux-')); t.after(() => rm(home, { recursive: true, force: true }));
  const executable = '/opt/Chausar Preview/chausar-preview';
  const login = new StartAtLogin({ platform: 'linux', executable, homeDirectory: home });
  const path = join(home, '.config', 'autostart', 'in.chausar.desktop');
  assert.deepEqual(await login.status(), { platform: 'linux', mechanism: 'linux-xdg-autostart', enabled: false, path, matches: null });
  await assert.rejects(login.set({ enabled: true }), code('CONFIRMATION_REQUIRED'));
  assert.equal(existsSync(path), false);
  assert.deepEqual(await shellSetStartAtLogin(login, { enabled: true, confirmed: true }), { platform: 'linux', mechanism: 'linux-xdg-autostart', enabled: true, path, matches: true });
  const written = await readFile(path, 'utf8');
  assert.deepEqual(parseExec(/^Exec=(.*)$/m.exec(written)![1]), [executable, '--start-at-login']);
  assert.equal((await lstat(path)).mode & 0o777, 0o644);
  assert.deepEqual(await readdir(join(home, '.config', 'autostart')), ['in.chausar.desktop'], 'no temporary file left');
  // Turned off in the session's own settings: present, but not enabled.
  await writeFile(path, written.replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'));
  assert.deepEqual(await login.status(), { platform: 'linux', mechanism: 'linux-xdg-autostart', enabled: false, path, matches: false });
  assert.equal((await login.set({ enabled: true, confirmed: true })).enabled, true);
  assert.equal((await shellSetStartAtLogin(login, { enabled: false, confirmed: true })).enabled, false);
  assert.equal(existsSync(path), false);
  assert.equal((await login.set({ enabled: false, confirmed: true })).enabled, false, 'turning off twice is fine');
});

test('Linux refuses a symlinked autostart entry or folder rather than writing through it', async t => {
  const home = await mkdtemp(join(tmpdir(), 'chausar-login-link-')); t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.config', 'autostart'), { recursive: true });
  await writeFile(join(home, 'target'), 'keep');
  await symlink(join(home, 'target'), join(home, '.config', 'autostart', 'in.chausar.desktop'));
  const login = new StartAtLogin({ platform: 'linux', executable: '/opt/chausar', homeDirectory: home });
  await assert.rejects(login.status(), code('START_AT_LOGIN_PATH_UNSAFE'));
  await assert.rejects(login.set({ enabled: true, confirmed: true }), code('START_AT_LOGIN_PATH_UNSAFE'));
  assert.equal(await readFile(join(home, 'target'), 'utf8'), 'keep');
  const other = await mkdtemp(join(tmpdir(), 'chausar-login-dir-')); t.after(() => rm(other, { recursive: true, force: true }));
  await mkdir(join(other, '.config'), { recursive: true }); await symlink(home, join(other, '.config', 'autostart'));
  await assert.rejects(new StartAtLogin({ platform: 'linux', executable: '/opt/chausar', homeDirectory: other }).set({ enabled: true, confirmed: true }), code('START_AT_LOGIN_PATH_UNSAFE'));
});

test('constructor validation', () => {
  assert.throws(() => new StartAtLogin({ platform: 'aix', executable: '/opt/chausar' }), code('START_AT_LOGIN_UNSUPPORTED'));
  assert.throws(() => new StartAtLogin({ platform: 'linux', executable: '/opt/../chausar', homeDirectory: '/home/a' }), code('START_AT_LOGIN_PATH_INVALID'));
  assert.throws(() => new StartAtLogin({ platform: 'linux', executable: '/opt/chausar\n', homeDirectory: '/home/a' }), code('START_AT_LOGIN_PATH_INVALID'));
  assert.throws(() => new StartAtLogin({ platform: 'win32', executable: 'C:\\a\\%APPDATA%\\x.exe' }), code('START_AT_LOGIN_PATH_INVALID'));
});
