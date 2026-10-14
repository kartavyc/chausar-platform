import test from 'node:test';
import assert from 'node:assert/strict';
import { BackgroundService, escapeXml, launchdPlist, quoteSystemd, systemdUserUnit, windowsTaskXml } from '../runtime/native/background-service.ts';

const code = (expected: string) => (error: any) => error?.code === expected;
const tricky = '/Users/a & b/Chausar "Q" <x>/data';

test('XML escaping covers ampersands, quotes and angle brackets', () => {
  assert.equal(escapeXml(`a & b "c" 'd' <e>`), 'a &amp; b &quot;c&quot; &apos;d&apos; &lt;e&gt;');
});

test('launchd plist escapes every value and keeps the agent per-user, background and crash-only', () => {
  const plist = launchdPlist({ executable: '/Applications/Chausar & Co.app/Contents/MacOS/Chausar', args: ['--background', '--data-dir', tricky] });
  assert.match(plist, /<string>\/Applications\/Chausar &amp; Co\.app\/Contents\/MacOS\/Chausar<\/string>/);
  assert.match(plist, /<string>\/Users\/a &amp; b\/Chausar &quot;Q&quot; &lt;x&gt;\/data<\/string>/);
  assert.ok(!plist.includes('"Q"') && !plist.includes('<x>'));
  assert.match(plist, /<key>Label<\/key>\s*<string>in\.chausar\.background<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key>\s*<dict>\s*<key>Crashed<\/key>\s*<true\/>\s*<\/dict>/);
  assert.match(plist, /<key>ProcessType<\/key>\s*<string>Background<\/string>/);
  assert.ok(!/UserName|GroupName|root/.test(plist));
});

test('systemd quoting escapes backslashes, quotes, specifiers and variables', () => {
  assert.equal(quoteSystemd('/a b/"c"\\d%h$HOME'), '"/a b/\\"c\\"\\\\d%%h$$HOME"');
  const unit = systemdUserUnit({ executable: '/opt/Chausar App/chausar', args: ['--background', '--data-dir', '/home/u/50% "data" $x'], dataDirectory: '/home/u/50% "data" $x' });
  assert.match(unit, /^ExecStart="\/opt\/Chausar App\/chausar" "--background" "--data-dir" "\/home\/u\/50%% \\"data\\" \$\$x"$/m);
  for (const line of ['Restart=on-failure', 'NoNewPrivileges=yes', 'PrivateTmp=yes', 'ProtectSystem=strict', 'ReadWritePaths="/home/u/50%% \\"data\\" $$x"', 'WantedBy=default.target'])
    assert.ok(unit.split('\n').includes(line), line);
  assert.ok(!/^User=|^Group=/m.test(unit));
});

test('Windows task XML is a logon task for the current user with least privilege and restart on failure', () => {
  const xml = windowsTaskXml({ executable: 'C:\\Program Files\\Chausar & Co\\Chausar.exe', args: ['--background', '--data-dir', 'C:\\Users\\a b\\AppData\\Roaming\\Chausar\\'], user: 'DOMAIN\\a&b' });
  assert.match(xml, /<LogonTrigger>\s*<Enabled>true<\/Enabled>\s*<UserId>DOMAIN\\a&amp;b<\/UserId>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<RestartOnFailure>\s*<Interval>PT1M<\/Interval>\s*<Count>3<\/Count>/);
  assert.match(xml, /<Command>&quot;C:\\Program Files\\Chausar &amp; Co\\Chausar\.exe&quot;<\/Command>/);
  // A trailing backslash is doubled so it cannot escape the closing quote.
  assert.match(xml, /<Arguments>--background --data-dir &quot;C:\\Users\\a b\\AppData\\Roaming\\Chausar\\\\&quot;<\/Arguments>/);
  assert.ok(!xml.includes('HighestAvailable') && !xml.includes('S4U') && !xml.includes('SYSTEM'));
});

test('paths are validated as absolute without control characters', () => {
  const base = { platform: 'linux' as const, homeDirectory: '/home/u', runner: async () => ({ code: 0, stdout: '', stderr: '' }) };
  for (const [executable, dataDirectory] of [['chausar', '/data'], ['/opt/chausar', 'data'], ['/opt/chau\nsar', '/data'], ['/opt/chausar', '/da\tta'], ['/opt/../etc/chausar', '/data']])
    assert.throws(() => new BackgroundService({ ...base, executable, dataDirectory }), code('SERVICE_PATH_INVALID'));
  const windows = { platform: 'win32' as const, windowsUser: 'PC\\u', runner: base.runner };
  for (const executable of ['C:relative.exe', 'C:\\a"b\\c.exe', 'C:\\%APPDATA%\\c.exe', '/opt/chausar'])
    assert.throws(() => new BackgroundService({ ...windows, executable, dataDirectory: 'C:\\data' }), code('SERVICE_PATH_INVALID'));
  assert.doesNotThrow(() => new BackgroundService({ ...base, executable: tricky, dataDirectory: tricky }));
});

test('unsupported platforms refuse with SERVICE_UNSUPPORTED', () => {
  for (const platform of ['freebsd', 'aix', 'android'] as NodeJS.Platform[])
    assert.throws(() => new BackgroundService({ platform, executable: '/opt/chausar', dataDirectory: '/data' }), code('SERVICE_UNSUPPORTED'));
});

test('plan describes files and commands without running anything and never elevates', () => {
  let calls = 0;
  const runner = async () => { calls++; return { code: 0, stdout: '', stderr: '' }; };
  const linux = new BackgroundService({ platform: 'linux', executable: '/opt/chausar', dataDirectory: '/home/u/.config/Chausar', homeDirectory: '/home/u', runner }).plan();
  assert.equal(linux.unitPath, '/home/u/.config/systemd/user/chausar-background.service');
  assert.deepEqual(linux.install.map(command => command.args), [['--user', 'daemon-reload'], ['--user', 'enable', '--now', 'chausar-background.service']]);
  assert.deepEqual(linux.uninstall[0].args, ['--user', 'disable', '--now', 'chausar-background.service']);
  assert.deepEqual(linux.status[0].args, ['--user', 'is-active', 'chausar-background.service']);
  const mac = new BackgroundService({ platform: 'darwin', executable: '/Applications/Chausar.app/Contents/MacOS/Chausar', dataDirectory: '/Users/u/Library/Application Support/Chausar', homeDirectory: '/Users/u', uid: 501, runner }).plan();
  assert.equal(mac.unitPath, '/Users/u/Library/LaunchAgents/in.chausar.background.plist');
  assert.deepEqual(mac.install[0], { command: '/bin/launchctl', args: ['bootstrap', 'gui/501', mac.unitPath] });
  assert.deepEqual(mac.uninstall[0].args, ['bootout', 'gui/501/in.chausar.background']);
  assert.deepEqual(mac.status[0].args, ['print', 'gui/501/in.chausar.background']);
  const windows = new BackgroundService({ platform: 'win32', executable: 'C:\\Program Files\\Chausar\\Chausar.exe', dataDirectory: 'C:\\Users\\u\\AppData\\Roaming\\Chausar', windowsUser: 'PC\\u', systemRoot: 'C:\\Windows', runner }).plan('C:\\Temp\\task.xml');
  assert.deepEqual(windows.install[0], { command: 'C:\\Windows\\System32\\schtasks.exe', args: ['/Create', '/TN', 'Chausar\\Background', '/XML', 'C:\\Temp\\task.xml', '/F'] });
  assert.deepEqual(windows.uninstall[0].args, ['/Delete', '/TN', 'Chausar\\Background', '/F']);
  assert.deepEqual(windows.status[0].args, ['/Query', '/TN', 'Chausar\\Background', '/XML']);
  for (const plan of [linux, mac, windows]) {
    assert.equal(plan.elevation, 'none');
    assert.deepEqual(plan.command.args.slice(0, 1), ['--background']);
    for (const command of [...plan.install, ...plan.uninstall, ...plan.status]) assert.ok(!/sudo|runas|pkexec/i.test(command.command + command.args.join(' ')));
  }
  assert.equal(calls, 0);
});

test('the default runner uses no shell, bounds output and enforces its deadline', async () => {
  const { defaultServiceRunner } = await import('../runtime/native/background-service.ts');
  const large = await defaultServiceRunner(process.execPath, ['-e', 'process.stdout.write("x".repeat(200000))'], { timeoutMs: 10_000 });
  assert.equal(large.code, 0);
  assert.equal(large.stdout.length, 64 * 1024);
  const literal = await defaultServiceRunner(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', '$(echo injected) & | ;'], { timeoutMs: 10_000 });
  assert.equal(literal.stdout, '$(echo injected) & | ;');
  await assert.rejects(defaultServiceRunner(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { timeoutMs: 200 }), code('SERVICE_COMMAND_TIMEOUT'));
  await assert.rejects(defaultServiceRunner('/nonexistent/chausar-tool', [], { timeoutMs: 1000 }), code('SERVICE_COMMAND_FAILED'));
});
