import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  DPAPI_ARGS, DPAPI_SCRIPT, KEY_SERVICE, LINUX_ENV_NAMES, SECRET_TOOL, SECURITY, execFileRun, linuxDeviceKeyStore, macDeviceKeyStore,
  PROBE_RETRY_MS, memoProbe, memoryDeviceKeyStore, noDeviceKeyStore, osDeviceKeyStore, windowsDeviceKeyStore, type ProbeResult, type RunProcess,
} from '../runtime/device-custody.ts';
import { CUSTODY_WORDS } from '../runtime/workspace-custody-contracts.ts';

type Call = { file: string; args: readonly string[]; input: string; options: { timeoutMs: number; env: Record<string, string> } };
type Answer = { code: number | null; stdout?: string; timedOut?: boolean } | Error;
/** A fake child process runner: records every call and answers from a script, in order. */
function fakeRun(answers: Answer[] | ((call: Call) => Answer)) {
  const calls: Call[] = [];
  const run: RunProcess = async (file, args, input, options) => {
    const call = { file, args: [...args], input, options: { ...options, env: { ...options.env } } }; calls.push(call);
    const answer = typeof answers === 'function' ? answers(call) : answers.shift();
    if (!answer) throw new Error('No scripted answer');
    if (answer instanceof Error) throw answer;
    return { code: answer.code, stdout: answer.stdout ?? '', timedOut: answer.timedOut ?? false };
  };
  return { run, calls };
}
const code = (expected: string, reason?: string) => (error: any) => error.code === expected && (reason === undefined || error.reason === reason);
const secret = () => randomBytes(32);
/** The DPAPI stdin: three lines, op, entropy and base64 data, and nothing else. */
function stdinLines(input: string) {
  assert.ok(input.endsWith('\n'));
  const lines = input.slice(0, -1).split('\n');
  assert.equal(lines.length, 3, 'exactly three lines');
  const [op, entropy, data] = lines;
  return { op, entropy, data };
}
const leaks = (text: string, value: Buffer) => text.includes(value.toString('base64')) || text.includes(value.toString('base64url')) || text.includes(value.toString('hex'));

test('Windows: the exact PowerShell path, arguments and environment; the secret travels only on stdin', async () => {
  const environment = { SystemRoot: 'C:\\Windows', PATH: 'C:\\should-not-pass', USERPROFILE: 'C:\\Users\\someone' };
  const blob = randomBytes(40);
  const { run, calls } = fakeRun([{ code: 0, stdout: `OK:${blob.toString('base64')}` }]);
  const store = windowsDeviceKeyStore(run, environment, () => true);
  const value = secret();
  const record = await store.protect('vault-a', value);
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call.file, join('C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'));
  assert.deepEqual(call.args, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', DPAPI_SCRIPT]);
  assert.deepEqual(call.args, [...DPAPI_ARGS]);
  assert.ok(!call.args.some(arg => /EncodedCommand|ExecutionPolicy/i.test(arg)), 'no -EncodedCommand and no -ExecutionPolicy');
  assert.deepEqual(call.options.env, { SystemRoot: 'C:\\Windows' }, 'the child gets SystemRoot and nothing else');
  assert.equal(call.options.timeoutMs, 20_000);
  assert.ok(!leaks(call.args.join(' '), value), 'the secret is never in the argument list');
  const input = stdinLines(call.input);
  assert.equal(input.op, 'protect'); assert.equal(input.entropy, 'chausar.device-key.v1:vault-a'); assert.equal(input.data, value.toString('base64'));
  assert.equal(record.scheme, 'windows-dpapi'); assert.equal(record.vaultId, 'vault-a'); assert.equal(record.blob, blob.toString('base64'));
  assert.equal(record.format, 'chausar.device-key.v1');
  assert.ok(!leaks(JSON.stringify(record), value), 'the record never holds the secret');
});

test('Windows: OK parsing on unprotect, and every failure becomes a fixed word without stdout or the secret', async () => {
  const value = secret();
  const { run, calls } = fakeRun([{ code: 0, stdout: `OK:${value.toString('base64')}` }]);
  const store = windowsDeviceKeyStore(run, { SystemRoot: 'C:\\Windows' }, () => true);
  const record = { format: 'chausar.device-key.v1' as const, vaultId: 'vault-a', scheme: 'windows-dpapi' as const, blob: randomBytes(40).toString('base64'), createdAt: new Date().toISOString() };
  assert.ok((await store.unprotect(record))!.equals(value));
  const input = stdinLines(calls[0].input);
  assert.equal(input.op, 'unprotect'); assert.equal(input.entropy, 'chausar.device-key.v1:vault-a'); assert.equal(input.data, record.blob);

  const stdoutSecret = `MODE:ConstrainedLanguage ${value.toString('base64')}`;
  for (const [answer, reason] of [[{ code: 1, stdout: stdoutSecret }, 'failed'], [{ code: 3, stdout: 'MODE:ConstrainedLanguage' }, 'blocked'],
    [{ code: null, timedOut: true }, 'failed'], [{ code: 5 }, 'failed'], [{ code: 0, stdout: 'not ok' }, 'failed'], [new Error(`spawn failed ${value.toString('base64')}`), 'failed']] as const) {
    const failing = windowsDeviceKeyStore(fakeRun([answer as Answer]).run, { SystemRoot: 'C:\\Windows' }, () => true);
    await assert.rejects(failing.unprotect(record), (error: any) => {
      assert.equal(error.code, 'DEVICE_KEY_FAILED'); assert.equal(error.reason, reason);
      assert.equal(error.message, CUSTODY_WORDS.errors.DEVICE_KEY_FAILED);
      assert.ok(!leaks(error.message + JSON.stringify(error), value), 'no secret in the error');
      assert.ok(!error.message.includes('MODE:'), 'no stdout in the error');
      return true;
    });
  }
});

test('Windows: the probe protects one sample, once per store; exit 3 means blocked; no SystemRoot means another platform', async () => {
  const { run, calls } = fakeRun(() => ({ code: 0, stdout: `OK:${randomBytes(40).toString('base64')}` }));
  const store = windowsDeviceKeyStore(run, { SystemRoot: 'C:\\Windows' }, () => true);
  assert.deepEqual(await Promise.all([store.probe(), store.probe()]), [{ available: true }, { available: true }]);
  assert.deepEqual(await store.probe(), { available: true });
  assert.equal(calls.length, 1, 'the probe runs at most once per store');
  assert.equal(stdinLines(calls[0].input).entropy, 'chausar.device-key.v1:probe');
  assert.deepEqual(await windowsDeviceKeyStore(fakeRun([{ code: 3, stdout: 'MODE:ConstrainedLanguage' }]).run, { SystemRoot: 'C:\\Windows' }, () => true).probe(), { available: false, reason: 'blocked' });
  assert.deepEqual(await windowsDeviceKeyStore(fakeRun([{ code: null, timedOut: true }]).run, { SystemRoot: 'C:\\Windows' }, () => true).probe(), { available: false, reason: 'failed' });
  const none = fakeRun([]);
  assert.deepEqual(await windowsDeviceKeyStore(none.run, {}, () => true).probe(), { available: false, reason: 'platform' });
  assert.deepEqual(await windowsDeviceKeyStore(none.run, { SystemRoot: 'Windows' }, () => true).probe(), { available: false, reason: 'platform' }, 'a relative SystemRoot is refused');
  assert.deepEqual(await windowsDeviceKeyStore(none.run, { SystemRoot: 'C:\\Windows' }, () => false).probe(), { available: false, reason: 'platform' }, 'a missing powershell.exe is refused');
  assert.equal(none.calls.length, 0, 'never a PATH lookup');
  await assert.rejects(windowsDeviceKeyStore(none.run, { SystemRoot: 'C:\\Windows' }, () => true).protect('../escape', secret()), code('DEVICE_KEY_FAILED'));
});

test('Windows DPAPI for real on this computer: a round trip, one vault cannot open another, a flipped byte fails', { skip: process.platform !== 'win32' }, async () => {
  let runs = 0;
  const counted: RunProcess = (...args) => { runs++; return execFileRun(...args); };
  const store = osDeviceKeyStore('win32', counted);
  assert.equal(store.scheme, 'windows-dpapi');
  const started = Date.now();
  assert.deepEqual(await store.probe(), { available: true });
  const probeMs = Date.now() - started;
  assert.deepEqual(await store.probe(), { available: true });
  assert.equal(runs, 1, 'the probe ran once for this store');
  const value = secret();
  const protectStart = Date.now();
  const record = await store.protect('dpapi-test-vault-a', value);
  const protectMs = Date.now() - protectStart;
  assert.ok(!leaks(JSON.stringify(record), value));
  const unprotectStart = Date.now();
  assert.ok((await store.unprotect(record))!.equals(value));
  const unprotectMs = Date.now() - unprotectStart;
  await assert.rejects(store.unprotect({ ...record, vaultId: 'dpapi-test-vault-b' }), code('DEVICE_KEY_FAILED'));
  const blob = Buffer.from(record.blob!, 'base64'); blob[blob.length - 5] ^= 0x01;
  await assert.rejects(store.unprotect({ ...record, blob: blob.toString('base64') }), code('DEVICE_KEY_FAILED'));
  console.log(`real DPAPI on this computer: probe ${probeMs} ms, protect ${protectMs} ms, unprotect ${unprotectMs} ms, blob ${Buffer.from(record.blob!, 'base64').length} bytes`);
});

test('macOS: the keychain item is stored through security -i on stdin, read back, and absent items read as null', async () => {
  const value = secret(), text = value.toString('base64url');
  const { run, calls } = fakeRun([{ code: 0 }, { code: 0, stdout: `${text}\n` }, { code: 0, stdout: `${text}\n` }, { code: 44 }, { code: 0 }, { code: 44 }]);
  const store = macDeviceKeyStore(run, { HOME: '/Users/owner', PATH: '/usr/bin:/bin' }, () => true);
  const record = await store.protect('vault-a', value);
  assert.deepEqual(record.item, { service: KEY_SERVICE, account: 'vault-a' });
  assert.equal(record.blob, undefined);
  assert.equal(calls[0].file, SECURITY); assert.deepEqual(calls[0].args, ['-i']);
  assert.equal(calls[0].input, `add-generic-password -U -s chausar.vault-key -a vault-a -l "Chausar vault key" -w ${text}\n`);
  assert.deepEqual(calls[1].args, ['find-generic-password', '-s', 'chausar.vault-key', '-a', 'vault-a', '-w'], 'protect reads the item back');
  assert.ok((await store.unprotect(record))!.equals(value), 'one trailing newline is trimmed');
  assert.equal(await store.unprotect(record), null, 'exit 44 means no such item');
  await store.forget(record);
  assert.deepEqual(calls[4].args, ['delete-generic-password', '-s', 'chausar.vault-key', '-a', 'vault-a']);
  await store.forget(record); // exit 44 counts as done
  for (const call of calls) {
    assert.ok(!leaks(call.args.join(' '), value), 'no argument ever holds the secret');
    assert.deepEqual(call.options.env, { HOME: '/Users/owner' });
  }
  assert.ok(!leaks(JSON.stringify(record), value));
});

test('macOS: a locked keychain answers locked; a missing security tool means another platform; the probe cleans up', async () => {
  const locked = macDeviceKeyStore(fakeRun([{ code: 36 }]).run, {}, () => true);
  const record = { format: 'chausar.device-key.v1' as const, vaultId: 'vault-a', scheme: 'macos-keychain' as const, item: { service: KEY_SERVICE, account: 'vault-a' }, createdAt: '' };
  await assert.rejects(locked.unprotect(record), code('DEVICE_KEY_FAILED', 'locked'));
  assert.deepEqual(await macDeviceKeyStore(fakeRun([{ code: 36 }, { code: 0 }]).run, {}, () => true).probe(), { available: false, reason: 'locked' });
  assert.deepEqual(await macDeviceKeyStore(fakeRun([]).run, {}, () => false).probe(), { available: false, reason: 'platform' });
  const probe = fakeRun(call => call.args[0] === '-i' ? { code: 0 } : call.args[0] === 'find-generic-password'
    ? { code: 0, stdout: `${/-w (\S+)\n$/.exec(probeInput)![1]}\n` } : { code: 0 });
  let probeInput = '';
  const wrapped: RunProcess = (file, args, input, options) => { if (args[0] === '-i') probeInput = input; return probe.run(file, args, input, options); };
  assert.deepEqual(await macDeviceKeyStore(wrapped, {}, () => true).probe(), { available: true });
  assert.deepEqual(probe.calls.map(call => call.args[0]), ['-i', 'find-generic-password', 'delete-generic-password']);
  assert.match(probe.calls[1].args[4], /^probe-[a-f0-9]{16}$/);
  await assert.rejects(locked.unprotect({ ...record, item: { service: KEY_SERVICE, account: 'another' } }), code('DEVICE_KEY_FAILED'));
});

test('Linux: secret-tool store with the secret on stdin, lookup parse, empty exit 1 is null, only three environment names', async () => {
  const value = secret(), text = value.toString('base64url');
  const environment = { DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus', XDG_RUNTIME_DIR: '/run/user/1000', HOME: '/home/owner', PATH: '/usr/bin', DISPLAY: ':0', SECRET: 'x' };
  const { run, calls } = fakeRun([{ code: 0 }, { code: 0, stdout: text }, { code: 0, stdout: `${text}\n` }, { code: 1, stdout: '' }, { code: 0 }]);
  const store = linuxDeviceKeyStore(run, environment, () => true);
  const record = await store.protect('vault-a', value);
  assert.equal(calls[0].file, SECRET_TOOL);
  assert.deepEqual(calls[0].args, ['store', '--label', 'Chausar vault key', 'service', 'chausar.vault-key', 'account', 'vault-a']);
  assert.equal(calls[0].input, text, 'the secret on stdin with no newline');
  assert.deepEqual(calls[1].args, ['lookup', 'service', 'chausar.vault-key', 'account', 'vault-a']);
  assert.equal(calls[0].options.timeoutMs, 30_000);
  assert.ok((await store.unprotect(record))!.equals(value));
  assert.equal(await store.unprotect(record), null, 'exit 1 with empty stdout means no such item');
  await store.forget(record);
  assert.deepEqual(calls[4].args, ['clear', 'service', 'chausar.vault-key', 'account', 'vault-a']);
  for (const call of calls) {
    assert.deepEqual(Object.keys(call.options.env).sort(), [...LINUX_ENV_NAMES].sort());
    assert.ok(!leaks(call.args.join(' '), value));
  }
});

test('Linux: no session bus or no secret-tool means no keyring; a timeout means locked', async () => {
  const empty = fakeRun([]);
  assert.deepEqual(await linuxDeviceKeyStore(empty.run, { HOME: '/home/owner' }, () => true).probe(), { available: false, reason: 'no-keyring' });
  assert.deepEqual(await linuxDeviceKeyStore(empty.run, { DBUS_SESSION_BUS_ADDRESS: 'unix:x' }, () => false).probe(), { available: false, reason: 'no-keyring' });
  assert.equal(empty.calls.length, 0);
  const enoent = Object.assign(new Error('spawn /usr/bin/secret-tool ENOENT'), { code: 'ENOENT' });
  assert.deepEqual(await linuxDeviceKeyStore(fakeRun([enoent]).run, { DBUS_SESSION_BUS_ADDRESS: 'unix:x' }, () => true).probe(), { available: false, reason: 'no-keyring' });
  assert.deepEqual(await linuxDeviceKeyStore(fakeRun([{ code: null, timedOut: true }, { code: 0 }]).run, { DBUS_SESSION_BUS_ADDRESS: 'unix:x' }, () => true).probe(), { available: false, reason: 'locked' });
  const record = { format: 'chausar.device-key.v1' as const, vaultId: 'vault-a', scheme: 'linux-secret-service' as const, item: { service: KEY_SERVICE, account: 'vault-a' }, createdAt: '' };
  await assert.rejects(linuxDeviceKeyStore(fakeRun([{ code: 2, stdout: '' }]).run, { DBUS_SESSION_BUS_ADDRESS: 'unix:x' }, () => true).unprotect(record), code('DEVICE_KEY_FAILED', 'failed'));
});

test('memory stores behave as two computers; no store refuses with the fixed words; other platforms ask for a passphrase', async () => {
  const here = memoryDeviceKeyStore(), there = memoryDeviceKeyStore(), value = secret();
  const record = await here.protect('vault-a', value);
  assert.equal(here.items(), 1);
  assert.ok((await here.unprotect(record))!.equals(value));
  assert.equal(await there.unprotect(record), null, 'another computer does not have the item');
  assert.ok(!leaks(JSON.stringify(record), value));
  await here.forget(record); assert.equal(here.items(), 0); assert.equal(await here.unprotect(record), null);
  const none = noDeviceKeyStore('not-configured');
  assert.deepEqual(await none.probe(), { available: false, reason: 'not-configured' });
  await assert.rejects(none.protect('vault-a', value), (error: any) => error.code === 'DEVICE_KEYS_UNAVAILABLE' && error.reason === 'not-configured' && error.message === CUSTODY_WORDS.unavailable['not-configured']);
  assert.deepEqual(await osDeviceKeyStore('freebsd', fakeRun([]).run).probe(), { available: false, reason: 'platform' });
  assert.equal(osDeviceKeyStore('darwin', fakeRun([]).run).scheme, 'macos-keychain');
  assert.equal(osDeviceKeyStore('linux', fakeRun([]).run).scheme, 'linux-secret-service');
});

test('device-custody.ts never logs, never reads stderr, and never uses a shell', async () => {
  const source = await readFile(new URL('../runtime/device-custody.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /console\./);
  assert.doesNotMatch(source, /\.stderr\b/);
  assert.doesNotMatch(source, /process\.stderr|stdio:\s*\[[^\]]*'pipe'\s*\]\s*,?\s*$/m);
  assert.match(source, /stdio: \['pipe', 'pipe', 'ignore'\]/, 'stderr is ignored at the source');
  assert.match(source, /shell: false/);
  assert.doesNotMatch(source, /EncodedCommand|ExecutionPolicy|pwsh/);
});

test('Windows: the script reads stdin with .NET calls only, so module logging never records the secret', () => {
  // PowerShell module logging (event 4103, or 800 in the Windows PowerShell log) writes every cmdlet's parameter values.
  // The only cmdlet allowed is Add-Type, with a fixed assembly name; stdin never passes through a cmdlet or a pipeline.
  assert.doesNotMatch(DPAPI_SCRIPT, /\|/, 'no pipeline at all');
  assert.doesNotMatch(DPAPI_SCRIPT, /ConvertFrom-Json|ReadToEnd|Out-|Write-|\$input\b/i);
  const cmdlets = DPAPI_SCRIPT.match(/\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/g) ?? [];
  assert.deepEqual([...new Set(cmdlets)], ['Add-Type']);
  assert.match(DPAPI_SCRIPT, /^Add-Type -AssemblyName System\.Security$/m);
  assert.equal(DPAPI_SCRIPT.match(/\[Console\]::In\.ReadLine\(\)/g)?.length, 3, 'op, entropy and data, one line each');
});

test('the probe keeps a success for good, but asks again after a failure once PROBE_RETRY_MS has passed', async () => {
  let now = 1_000_000, runs = 0;
  const answers: ProbeResult[] = [{ available: false, reason: 'failed' }, { available: false, reason: 'locked' }, { available: true }];
  const probe = memoProbe(async () => { runs++; return answers.shift()!; }, () => now);
  assert.deepEqual(await Promise.all([probe(), probe()]), [{ available: false, reason: 'failed' }, { available: false, reason: 'failed' }]);
  assert.equal(runs, 1, 'calls at the same time share one attempt');
  now += PROBE_RETRY_MS - 1;
  assert.deepEqual(await probe(), { available: false, reason: 'failed' }, 'a burst inside the window answers from memory');
  assert.equal(runs, 1);
  now += 1;
  assert.deepEqual(await probe(), { available: false, reason: 'locked' }, 'after the window the OS is asked again');
  now += PROBE_RETRY_MS;
  assert.deepEqual(await probe(), { available: true });
  now += 10 * PROBE_RETRY_MS;
  assert.deepEqual(await probe(), { available: true });
  assert.equal(runs, 3, 'a success is never asked again');
  let threw = 0;
  const throwing = memoProbe(async () => { threw++; if (threw === 1) throw new Error('cold start'); return { available: true }; }, () => now);
  assert.deepEqual(await throwing(), { available: false, reason: 'failed' });
  now += PROBE_RETRY_MS;
  assert.deepEqual(await throwing(), { available: true }, 'a throw counts as a failure and is retried too');

  // The Windows store uses the same rule: right after a slow cold start (a timeout), no second PowerShell starts.
  const slow = fakeRun([{ code: null, timedOut: true }, { code: 0, stdout: `OK:${randomBytes(40).toString('base64')}` }]);
  const store = windowsDeviceKeyStore(slow.run, { SystemRoot: 'C:\\Windows' }, () => true);
  assert.deepEqual(await store.probe(), { available: false, reason: 'failed' });
  assert.deepEqual(await store.probe(), { available: false, reason: 'failed' });
  assert.equal(slow.calls.length, 1, 'inside the window no new PowerShell starts');
});
