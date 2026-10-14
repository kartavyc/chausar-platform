import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat, symlink, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackgroundService, type ServiceCommandResult } from '../runtime/native/background-service.ts';

const code = (expected: string) => (error: any) => error?.code === expected;
// POSIX unit paths are built with POSIX joins, so the temp-home tests need a POSIX host.
const posixHost = process.platform !== 'win32';

async function home(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-service-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
type Call = { command: string; args: string[]; file?: Buffer };
function fakeRunner(reply: (call: Call) => Partial<ServiceCommandResult> = () => ({})) {
  const calls: Call[] = [];
  const runner = async (command: string, args: string[]) => {
    const call: Call = { command, args };
    const xml = args.indexOf('/XML');
    if (args[0] === '/Create' && xml >= 0) call.file = await readFile(args[xml + 1]);
    calls.push(call);
    return { code: 0, stdout: '', stderr: '', ...reply(call) };
  };
  return { calls, runner };
}

test('install and uninstall refuse without explicit confirmation and run nothing', async t => {
  const { calls, runner } = fakeRunner();
  const service = new BackgroundService({ platform: 'linux', executable: '/opt/chausar', dataDirectory: '/data', homeDirectory: '/nonexistent-home', runner });
  for (const input of [undefined, {}, { confirmed: false }, { confirmed: 'yes' as any }]) {
    await assert.rejects(service.install(input), code('CONFIRMATION_REQUIRED'));
    await assert.rejects(service.uninstall(input), code('CONFIRMATION_REQUIRED'));
  }
  assert.equal(calls.length, 0);
});

test('linux: writes the user unit, reloads, enables, reports status and removes it', { skip: !posixHost }, async t => {
  const root = await home(t), data = join(root, 'data dir & "quoted"');
  let active = false;
  const { calls, runner } = fakeRunner(call => call.args[1] === 'is-active' ? { code: active ? 0 : 3, stdout: active ? 'active\n' : 'inactive\n' } : {});
  const service = new BackgroundService({ platform: 'linux', executable: '/opt/Chausar/chausar', dataDirectory: data, homeDirectory: root, runner });
  assert.deepEqual(await service.status(), { platform: 'linux', mechanism: 'linux-systemd-user', installed: false, running: false, unitPath: join(root, '.config/systemd/user/chausar-background.service') });
  active = true;
  const installed = await service.install({ confirmed: true });
  assert.equal(installed.installed, true); assert.equal(installed.running, true);
  const unit = await readFile(installed.unitPath, 'utf8');
  assert.ok(unit.includes(`ReadWritePaths="${data.replace(/"/g, '\\"')}"`));
  assert.equal((await stat(installed.unitPath)).mode & 0o777, 0o644);
  assert.deepEqual(calls.map(call => call.args.join(' ')), ['--user is-active chausar-background.service', '--user daemon-reload', '--user enable --now chausar-background.service', '--user is-active chausar-background.service']);
  assert.ok(calls.every(call => /systemctl$/.test(call.command)));
  calls.length = 0; active = false;
  const removed = await service.uninstall({ confirmed: true });
  assert.equal(removed.installed, false); assert.equal(removed.running, false);
  assert.deepEqual(calls.map(call => call.args.join(' ')), ['--user disable --now chausar-background.service', '--user daemon-reload', '--user is-active chausar-background.service']);
  assert.deepEqual(await readdir(join(root, '.config/systemd/user')), []);
});

test('macOS: writes the launch agent, replaces any loaded copy, bootstraps it and boots it out on removal', { skip: !posixHost }, async t => {
  const root = await home(t);
  let loaded = false;
  const { calls, runner } = fakeRunner(call => {
    if (call.args[0] === 'bootstrap') loaded = true;
    if (call.args[0] === 'bootout') { const was = loaded; loaded = false; return { code: was ? 0 : 3 }; }
    if (call.args[0] === 'print') return loaded ? { stdout: 'gui/501/in.chausar.background = {\n\tstate = running\n}' } : { code: 113 };
    return {};
  });
  const service = new BackgroundService({ platform: 'darwin', executable: '/Applications/Chausar.app/Contents/MacOS/Chausar', dataDirectory: `${root}/Application Support/Chausar & <Co>`, homeDirectory: root, uid: 501, runner });
  const status = await service.install({ confirmed: true });
  assert.deepEqual(status, { platform: 'darwin', mechanism: 'macos-launchd-agent', installed: true, running: true, unitPath: `${root}/Library/LaunchAgents/in.chausar.background.plist` });
  // The desktop app finds its own data directory; the agent passes only --background (escaping is covered by the generator tests).
  assert.match(await readFile(status.unitPath, 'utf8'), /<string>--background<\/string>\n  <\/array>/);
  assert.deepEqual(calls.map(call => call.args.join(' ')), ['bootout gui/501/in.chausar.background', `bootstrap gui/501 ${status.unitPath}`, 'print gui/501/in.chausar.background']);
  calls.length = 0;
  const removed = await service.uninstall({ confirmed: true });
  assert.equal(removed.installed, false); assert.equal(removed.running, null);
  assert.deepEqual(calls.map(call => call.args[0]), ['bootout', 'print']);
});

test('a failing system command refuses with SERVICE_COMMAND_FAILED', { skip: !posixHost }, async t => {
  const root = await home(t);
  const { runner } = fakeRunner(call => call.args[1] === 'enable' ? { code: 1, stderr: 'Failed to connect to bus' } : {});
  const service = new BackgroundService({ platform: 'linux', executable: '/opt/chausar', dataDirectory: '/data', homeDirectory: root, runner });
  await assert.rejects(service.install({ confirmed: true }), (error: any) => error.code === 'SERVICE_COMMAND_FAILED' && !error.message.includes('bus'));
});

test('a symlinked unit file is refused instead of being followed', { skip: !posixHost }, async t => {
  const root = await home(t), unitDirectory = join(root, '.config/systemd/user');
  await mkdir(unitDirectory, { recursive: true });
  await writeFile(join(root, 'elsewhere'), 'keep');
  await symlink(join(root, 'elsewhere'), join(unitDirectory, 'chausar-background.service'));
  const { runner } = fakeRunner();
  const service = new BackgroundService({ platform: 'linux', executable: '/opt/chausar', dataDirectory: '/data', homeDirectory: root, runner });
  await assert.rejects(service.install({ confirmed: true }), code('SERVICE_PATH_UNSAFE'));
  assert.equal(await readFile(join(root, 'elsewhere'), 'utf8'), 'keep');
});

test('windows: registers the task from a UTF-16 XML file, removes the file, queries and deletes', async t => {
  const temporary = await home(t);
  let registered = false;
  const { calls, runner } = fakeRunner(call => {
    if (call.args[0] === '/Create') registered = true;
    if (call.args[0] === '/Delete') registered = false;
    if (call.args[0] === '/Query') {
      if (!registered) return { code: 1, stderr: 'ERROR: The system cannot find the file specified.' };
      return call.args.includes('/XML') ? { stdout: '<?xml version="1.0"?><Task></Task>' } : { stdout: '"\\Chausar\\Background","N/A","Running"\r\n' };
    }
    return {};
  });
  const service = new BackgroundService({ platform: 'win32', executable: 'C:\\Program Files\\Chausar\\Chausar.exe', dataDirectory: 'C:\\Users\\u\\AppData\\Roaming\\Chausar',
    windowsUser: 'PC\\u', systemRoot: 'C:\\Windows', temporaryDirectory: temporary, runner });
  const status = await service.install({ confirmed: true });
  assert.deepEqual(status, { platform: 'win32', mechanism: 'windows-task-scheduler', installed: true, running: true, unitPath: 'Task Scheduler\\Chausar\\Background' });
  const create = calls[0];
  assert.equal(create.command, 'C:\\Windows\\System32\\schtasks.exe');
  assert.deepEqual(create.args.filter((_, index) => index !== 4), ['/Create', '/TN', 'Chausar\\Background', '/XML', '/F']);
  assert.deepEqual([...create.file!.subarray(0, 2)], [0xff, 0xfe]);
  assert.match(create.file!.subarray(2).toString('utf16le'), /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.deepEqual(await readdir(temporary), []);
  calls.length = 0;
  const removed = await service.uninstall({ confirmed: true });
  assert.equal(removed.installed, false);
  assert.deepEqual(calls.map(call => call.args[0]), ['/Query', '/Query', '/Delete', '/Query']);
});
