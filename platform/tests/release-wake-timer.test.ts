import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WakeTimer, nativeWakeClear, nativeWakeSet, nativeWakeStatus, pmsetTime, systemdUtc, systemdWakeService, systemdWakeTimer, wakeTime, windowsWakeTaskXml } from '../runtime/native/wake-timer.ts';
import type { ServiceRunner } from '../runtime/native/background-service.ts';

const code = (expected: string) => (error: any) => error?.code === expected;
const now = new Date('2026-10-15T10:00:20Z');
const clock = () => new Date(now);
type Call = { command: string; args: string[] };
function recorder(reply: (call: Call) => { code: number; stdout?: string } = () => ({ code: 0 })) {
  const calls: Call[] = [];
  const runner: ServiceRunner = async (command, args) => { calls.push({ command, args }); const r = reply({ command, args }); return { code: r.code, stdout: r.stdout ?? '', stderr: '' }; };
  return { calls, runner };
}
async function temporaryHome(t: any) {
  const home = await mkdtemp(join(tmpdir(), 'chausar-wake-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const rtc = join(home, 'wakealarm'); await writeFile(rtc, '');
  return { home, rtc };
}

test('wake times need an explicit offset, round down to the minute, and stay between one minute and seven days ahead', () => {
  assert.equal(wakeTime('2026-10-16T07:00:59+05:30', now).toISOString(), '2026-10-16T01:30:00.000Z');
  assert.equal(wakeTime('2026-10-15T10:02:10Z', now).toISOString(), '2026-10-15T10:02:00.000Z');
  for (const value of ['2026-10-16T07:00', '2026-10-16 07:00Z', 'tomorrow', '2026-13-40T07:00Z', 1_760_000_000_000, null, '2026-10-16T07:00Z\n'])
    assert.throws(() => wakeTime(value, now), code('WAKE_TIME_INVALID'), String(value));
  assert.throws(() => wakeTime('2026-10-15T10:00:59Z', now), code('WAKE_TIME_PAST'));
  assert.throws(() => wakeTime('2026-10-14T10:00Z', now), code('WAKE_TIME_PAST'));
  assert.equal(wakeTime('2026-10-22T10:00Z', now).toISOString(), '2026-10-22T10:00:00.000Z');
  assert.throws(() => wakeTime('2026-10-22T10:01Z', now), code('WAKE_TIME_TOO_FAR'));
});

test('time formats: systemd in UTC, pmset in local wall-clock time', () => {
  const at = new Date('2026-10-16T01:30:00Z');
  assert.equal(systemdUtc(at), '2026-10-16 01:30:00 UTC');
  const local = new Date(2026, 0, 5, 7, 4, 0);
  assert.equal(pmsetTime(local), '01/05/2026 07:04:00');
});

test('Windows task wakes the computer once, as the current user, without elevation, and escapes every value', () => {
  const xml = windowsWakeTaskXml({ executable: 'C:\\Program Files\\Chausar & Co\\Chausar.exe', user: 'DOMAIN\\A <b>', at: new Date('2026-10-16T01:30:00Z') });
  assert.match(xml, /<WakeToRun>true<\/WakeToRun>/);
  assert.match(xml, /<TimeTrigger>\s*<StartBoundary>2026-10-16T01:30:00Z<\/StartBoundary>\s*<EndBoundary>2026-10-16T02:30:00Z<\/EndBoundary>/);
  assert.match(xml, /<URI>\\Chausar\\Wake<\/URI>/);
  assert.match(xml, /<Command>&quot;C:\\Program Files\\Chausar &amp; Co\\Chausar\.exe&quot;<\/Command>/);
  assert.match(xml, /<Arguments>--background<\/Arguments>/);
  assert.match(xml, /<UserId>DOMAIN\\A &lt;b&gt;<\/UserId>/);
  assert.match(xml, /<RunLevel>LeastPrivilege<\/RunLevel>/);
  assert.match(xml, /<LogonType>InteractiveToken<\/LogonType>/);
  assert.ok(!/HighestAvailable|S-1-5-18|SYSTEM/.test(xml));
});

test('systemd timer and service: UTC calendar, WakeSystem, not persistent, quoted executable', () => {
  const timer = systemdWakeTimer(new Date('2026-10-16T01:30:00Z'));
  for (const line of ['OnCalendar=2026-10-16 01:30:00 UTC', 'WakeSystem=true', 'Persistent=false', 'Unit=chausar-wake.service', 'WantedBy=timers.target'])
    assert.ok(timer.split('\n').includes(line), line);
  const service = systemdWakeService('/opt/Chausar 50% "x"/$chausar');
  assert.match(service, /^ExecStart="\/opt\/Chausar 50%% \\"x\\"\/\$\$chausar" "--background"$/m);
  assert.ok(!/^User=/m.test(service));
});

test('Windows: plan, set and clear through schtasks with a UTF-16 task file; status reads the pending wake', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'chausar-wake-win-')); t.after(() => rm(temporary, { recursive: true, force: true }));
  let taskXml = '';
  let installed = false;
  const { calls, runner } = recorder(call => {
    if (call.args[0] === '/Create') return { code: 0 };
    if (call.args[0] === '/Query') return installed ? { code: 0, stdout: taskXml } : { code: 1 };
    if (call.args[0] === '/Delete') { installed = false; return { code: 0 }; }
    return { code: 1 };
  });
  const wrapped: ServiceRunner = async (command, args, options) => {
    if (args[0] === '/Create') {
      const raw = await readFile(args[args.indexOf('/XML') + 1]);
      assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe]);
      taskXml = raw.subarray(2).toString('utf16le'); installed = true;
    }
    return runner(command, args, options);
  };
  const timer = new WakeTimer({ platform: 'win32', executable: 'C:\\Program Files\\Chausar\\Chausar.exe', windowsUser: 'PC\\owner', systemRoot: 'C:\\Windows', temporaryDirectory: temporary, runner: wrapped, now: clock });
  const plan = timer.plan('2026-10-16T07:00+05:30');
  assert.equal(plan.at, '2026-10-16T01:30:00Z'); assert.equal(plan.elevation, 'none'); assert.equal(plan.mechanism, 'windows-task-scheduler');
  assert.deepEqual(plan.install[0].args, ['/Create', '/TN', 'Chausar\\Wake', '/XML', '<temporary task file>', '/F']);
  assert.equal(plan.install[0].command, 'C:\\Windows\\System32\\schtasks.exe');
  assert.deepEqual(plan.command, { executable: 'C:\\Program Files\\Chausar\\Chausar.exe', args: ['--background'] });
  assert.deepEqual(await timer.status(), { platform: 'win32', mechanism: 'windows-task-scheduler', available: true, nextWakeAt: null, experimental: true });
  await assert.rejects(timer.set({ at: '2026-10-16T07:00+05:30' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(timer.set({ at: '2026-10-30T07:00Z', confirmed: true }), code('WAKE_TIME_TOO_FAR'));
  assert.equal(calls.length, 1);
  const status = await nativeWakeSet(timer, { at: '2026-10-16T07:00+05:30', confirmed: true });
  assert.equal(status.nextWakeAt, '2026-10-16T01:30:00Z');
  assert.match(taskXml, /<WakeToRun>true<\/WakeToRun>/);
  assert.deepEqual(await readdir(temporary), [], 'the task file is removed');
  const cleared = await nativeWakeClear(timer, { confirmed: true });
  assert.equal(cleared.nextWakeAt, null);
  assert.ok(calls.some(call => call.args[0] === '/Delete'));
  await assert.rejects(nativeWakeClear(timer, {}), code('CONFIRMATION_REQUIRED'));
});

test('macOS: an ordinary user is refused WAKE_TIMER_NEEDS_ADMIN, never prompted; the plan still shows the exact pmset command', async () => {
  const { calls, runner } = recorder(call => call.args[0] === '-g' ? { code: 0, stdout: 'Scheduled power events:\n' } : { code: 0 });
  const timer = new WakeTimer({ platform: 'darwin', executable: '/Applications/Chausar.app/Contents/MacOS/Chausar', homeDirectory: '/Users/a', uid: 501, runner, now: clock });
  const status = await nativeWakeStatus(timer);
  assert.deepEqual(status, { platform: 'darwin', mechanism: 'macos-pmset', available: false, reason: 'WAKE_TIMER_NEEDS_ADMIN', nextWakeAt: null, experimental: true });
  const at = '2026-10-16T01:30:00Z';
  const plan = timer.plan(at);
  assert.equal(plan.elevation, 'admin'); assert.equal(plan.command, null);
  assert.deepEqual(plan.install, [{ command: '/usr/bin/pmset', args: ['schedule', 'wake', pmsetTime(new Date(at)), 'Chausar'] }]);
  assert.equal(plan.display[0], `/usr/bin/pmset schedule wake "${pmsetTime(new Date(at))}" Chausar`);
  await assert.rejects(timer.set({ at, confirmed: true }), code('WAKE_TIMER_NEEDS_ADMIN'));
  assert.ok(calls.every(call => call.args[0] === '-g'), 'nothing but the read-only listing ran');
  assert.ok(!calls.some(call => /sudo|osascript/.test(call.command)));
});

test('macOS as root replaces Chausar\'s pending wake and reads it back', async () => {
  let scheduled: string | null = pmsetTime(new Date('2026-10-15T20:00:00Z'));
  const { calls, runner } = recorder(call => {
    if (call.args[0] === '-g') return { code: 0, stdout: `Scheduled power events:\n [0]  wake at 10/20/2026 09:00:00 by 'Other'\n${scheduled ? ` [1]  wake at ${scheduled} by 'Chausar'\n` : ''}` };
    if (call.args[1] === 'cancel') { scheduled = null; return { code: 0 }; }
    scheduled = call.args[2]; return { code: 0 };
  });
  const timer = new WakeTimer({ platform: 'darwin', executable: '/Applications/Chausar.app/Contents/MacOS/Chausar', homeDirectory: '/var/root', uid: 0, runner, now: clock });
  assert.equal((await timer.status()).nextWakeAt, '2026-10-15T20:00:00Z');
  const status = await timer.set({ at: '2026-10-16T01:30:30Z', confirmed: true });
  assert.equal(status.available, true); assert.equal(status.nextWakeAt, '2026-10-16T01:30:00Z');
  const mutating = calls.filter(call => call.args[0] === 'schedule').map(call => call.args);
  assert.deepEqual(mutating, [['schedule', 'cancel', 'wake', pmsetTime(new Date('2026-10-15T20:00:00Z')), 'Chausar'], ['schedule', 'wake', pmsetTime(new Date('2026-10-16T01:30:00Z')), 'Chausar']]);
  assert.equal((await timer.clear({ confirmed: true })).nextWakeAt, null);
});

test('Linux: an unprivileged user manager without CAP_WAKE_ALARM is refused before anything is written', async t => {
  const { home, rtc } = await temporaryHome(t);
  const { calls, runner } = recorder(call => call.args[0] === 'show' ? { code: 0, stdout: '\n' } : { code: 0 });
  const timer = new WakeTimer({ platform: 'linux', executable: '/opt/Chausar/chausar', homeDirectory: home, uid: 1000, rtcWakeAlarmPath: rtc, runner, now: clock });
  assert.deepEqual(await timer.status(), { platform: 'linux', mechanism: 'linux-systemd-user-timer', available: false, reason: 'WAKE_TIMER_NEEDS_ADMIN', nextWakeAt: null, experimental: true });
  assert.deepEqual(calls[0].args, ['show', 'user@1000.service', '-p', 'AmbientCapabilities', '--value']);
  await assert.rejects(timer.set({ at: '2026-10-16T01:30Z', confirmed: true }), code('WAKE_TIMER_NEEDS_ADMIN'));
  assert.equal(existsSync(join(home, '.config')), false);
  const noRtc = new WakeTimer({ platform: 'linux', executable: '/opt/Chausar/chausar', homeDirectory: home, uid: 1000, rtcWakeAlarmPath: join(home, 'missing'), runner, now: clock });
  assert.equal((await noRtc.status()).reason, 'WAKE_TIMER_UNAVAILABLE');
  await assert.rejects(noRtc.set({ at: '2026-10-16T01:30Z', confirmed: true }), code('WAKE_TIMER_UNAVAILABLE'));
});

test('Linux with CAP_WAKE_ALARM writes the timer and service, reloads, enables and re-arms, then clears', async t => {
  const { home, rtc } = await temporaryHome(t);
  const { calls, runner } = recorder(call => call.args[0] === 'show' ? { code: 0, stdout: 'cap_net_bind_service cap_wake_alarm\n' } : { code: 0 });
  const timer = new WakeTimer({ platform: 'linux', executable: '/opt/Chausar App/chausar', homeDirectory: home, uid: 1000, rtcWakeAlarmPath: rtc, runner, now: clock });
  const status = await timer.set({ at: '2026-10-16T07:00:45+05:30', confirmed: true });
  assert.deepEqual(status, { platform: 'linux', mechanism: 'linux-systemd-user-timer', available: true, nextWakeAt: '2026-10-16T01:30:00Z', experimental: true });
  const units = join(home, '.config', 'systemd', 'user');
  assert.match(await readFile(join(units, 'chausar-wake.timer'), 'utf8'), /^OnCalendar=2026-10-16 01:30:00 UTC$/m);
  assert.match(await readFile(join(units, 'chausar-wake.service'), 'utf8'), /^ExecStart="\/opt\/Chausar App\/chausar" "--background"$/m);
  assert.deepEqual(calls.filter(call => call.args[0] === '--user').map(call => call.args.slice(1)), [['daemon-reload'], ['enable', 'chausar-wake.timer'], ['restart', 'chausar-wake.timer']]);
  calls.length = 0;
  const cleared = await timer.clear({ confirmed: true });
  assert.equal(cleared.nextWakeAt, null);
  assert.equal(existsSync(join(units, 'chausar-wake.timer')), false); assert.equal(existsSync(join(units, 'chausar-wake.service')), false);
  assert.deepEqual(calls.filter(call => call.args[0] === '--user').map(call => call.args.slice(1)), [['disable', '--now', 'chausar-wake.timer'], ['daemon-reload']]);
  // A wake already past reads as none.
  const later = new WakeTimer({ platform: 'linux', executable: '/opt/Chausar App/chausar', homeDirectory: home, uid: 0, rtcWakeAlarmPath: rtc, runner, now: () => new Date('2026-10-17T00:00:00Z') });
  await mkdir(units, { recursive: true }); await writeFile(join(units, 'chausar-wake.timer'), systemdWakeTimer(new Date('2026-10-16T01:30:00Z')));
  assert.equal((await later.status()).nextWakeAt, null);
});

test('Linux refuses a symlinked unit file instead of following it', async t => {
  const { home, rtc } = await temporaryHome(t);
  const units = join(home, '.config', 'systemd', 'user'); await mkdir(units, { recursive: true });
  await writeFile(join(home, 'elsewhere'), 'x'); await symlink(join(home, 'elsewhere'), join(units, 'chausar-wake.timer'));
  const { runner } = recorder();
  const timer = new WakeTimer({ platform: 'linux', executable: '/opt/chausar', homeDirectory: home, uid: 0, rtcWakeAlarmPath: rtc, runner, now: clock });
  await assert.rejects(timer.status(), code('WAKE_TIMER_PATH_UNSAFE'));
  assert.equal(await readFile(join(home, 'elsewhere'), 'utf8'), 'x');
});

test('constructor and payload validation', async () => {
  assert.throws(() => new WakeTimer({ platform: 'freebsd', executable: '/opt/chausar' }), code('WAKE_TIMER_UNSUPPORTED'));
  assert.throws(() => new WakeTimer({ platform: 'linux', executable: 'chausar', uid: 1 }), code('WAKE_TIMER_PATH_INVALID'));
  assert.throws(() => new WakeTimer({ platform: 'win32', executable: 'C:\\a\\"b".exe' }), code('WAKE_TIMER_PATH_INVALID'));
  const timer = new WakeTimer({ platform: 'linux', executable: '/opt/chausar', homeDirectory: '/home/a', uid: 1000, now: clock, runner: recorder().runner });
  await assert.rejects(nativeWakeSet(timer, { at: '2026-10-16T01:30Z' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(nativeWakeSet(timer, { at: '2026-10-16T01:30', confirmed: true }), code('WAKE_TIME_INVALID'));
  await assert.rejects(nativeWakeSet(timer, ['x']), code('INVALID_REQUEST'));
});

test('real Linux status on this machine runs read-only and never writes', { skip: process.platform !== 'linux' }, async t => {
  const home = await mkdtemp(join(tmpdir(), 'chausar-wake-real-')); t.after(() => rm(home, { recursive: true, force: true }));
  const timer = new WakeTimer({ executable: '/opt/chausar/chausar', homeDirectory: home });
  const status = await timer.status();
  assert.equal(status.platform, 'linux'); assert.equal(typeof status.available, 'boolean'); assert.equal(status.nextWakeAt, null);
  if (!status.available) await assert.rejects(timer.set({ at: new Date(Date.now() + 3_600_000).toISOString(), confirmed: true }), code(status.reason!));
  assert.deepEqual(await readdir(home), []);
});
