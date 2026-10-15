import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChausarError } from '../runtime/contracts.ts';
import type { Activity, DesktopDriver } from '../runtime/driving/driver.ts';
import type { HelperDriverOptions } from '../runtime/driving/helper-client.ts';
import { MACOS_HELPER_SCRIPT, MacAxDriver } from '../runtime/driving/macos-ax.ts';
import { WINDOWS_HELPER_SCRIPT, WindowsUiaDriver } from '../runtime/driving/windows-uia.ts';

// A synthetic helper speaking the JSON-lines protocol. argv: mode, log file. Every window is made up.
const FAKE = String.raw`
const fs = require('node:fs');
const [mode, log] = process.argv.slice(2);
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
const png = (w, h) => { const b = Buffer.alloc(45); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b); b.writeUInt32BE(13, 8); b.write('IHDR', 12, 'latin1'); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b.toString('base64'); };
const windows = [{ id: '0x1a', title: 'Synthetic\u0007 Books‮', app: 'books', pid: 100 }, { id: '0x2b', title: 'Chausar', app: 'chausar', pid: 999 }];
let focusedCalls = 0, buffer = '';
function reply(id, op, args) {
  if (mode === 'unknown-code') return send({ id, ok: false, code: op === 'focus' ? 'SECRET_LEAK_CODE' : 'lower_case' });
  if (mode === 'perm' && op === 'available') return send({ id, ok: false, code: 'DRIVER_PERMISSION_REQUIRED', reason: 'outside text' });
  if (mode === 'hang' && op === 'focus') return;
  if (mode === 'crash' && op === 'list') return;
  if (mode === 'crash' && op === 'focus') return setTimeout(() => process.exit(3), 20);
  switch (op) {
    case 'available': return send({ id, ok: true, result: true });
    case 'list':
      if (mode === 'bad-id') return send({ id, ok: true, result: [{ id: 'window-1', title: 'x', app: 'y', pid: 1 }] });
      if (mode === 'long-title') return send({ id, ok: true, result: [{ id: '0x1', title: 'x'.repeat(401), app: 'y', pid: 1 }] });
      if (mode === 'bad-pid') return send({ id, ok: true, result: [{ id: '0x1', title: 'x', app: 'y', pid: -4 }] });
      return send({ id, ok: true, result: windows });
    case 'info': return send({ id, ok: true, result: windows.find(w => w.id === args.id) ?? null });
    case 'related': return send({ id, ok: true, result: [{ id: '0x1a', title: 'Synthetic Books', app: 'books', pid: 100 },
      { id: '0x1c', title: 'Save As', app: 'books', pid: 100 }, { id: '0x2c', title: 'Chausar dialog', app: 'chausar', pid: 999 }] });
    case 'focus': return send({ id, ok: true, result: true });
    case 'focused': return send({ id, ok: true, result: { windowId: '0x1a', secret: [true, false, null][focusedCalls++ % 3] } });
    case 'press': case 'type':
      // The hook "sees" the helper's own input, then the person holds the stop key.
      send({ event: 'key' }); send({ event: 'stop-key' });
      return setTimeout(() => send({ id, ok: true, result: true }), 10);
    case 'snapshot':
      if (mode === 'bad-png') return send({ id, ok: true, result: { width: 2, height: 3, png: Buffer.from('GIF89a-not-a-png-at-all-------------').toString('base64') } });
      return send({ id, ok: true, result: { width: 2, height: 3, png: png(2, 3) } });
    case 'watch': send({ id, ok: true, result: true }); return setTimeout(() => send({ event: 'pointer' }), 10);
    case 'unwatch': return send({ id, ok: true, result: true });
  }
  send({ id, ok: false, code: 'DRIVER_FAILED' });
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffer += chunk;
  let at;
  while ((at = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
    fs.appendFileSync(log, line + '\n');
    const request = JSON.parse(line);
    reply(request.id, request.op, request.args);
  }
});
process.stdin.on('end', () => process.exit(0));
`;

const dir = mkdtempSync(join(tmpdir(), 'chausar-fake-helper-'));
const fakePath = join(dir, 'fake-helper.cjs');
writeFileSync(fakePath, FAKE);
test.after(() => rmSync(dir, { recursive: true, force: true }));

const refuses = (code: string) => (error: unknown) => error instanceof ChausarError && error.code === code;
const settle = (ms = 60) => new Promise(resolve => setTimeout(resolve, ms));
let logs = 0;
function fake(mode = 'normal', options: HelperDriverOptions = {}) {
  const log = join(dir, `log-${logs++}.jsonl`);
  writeFileSync(log, '');
  const spawnFake = () => spawn(process.execPath, [fakePath, mode, log]);
  const requests = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { op: string; args: Record<string, unknown> });
  return { options: { spawn: spawnFake, excludePids: [999], timeoutMs: 3000, ...options }, requests };
}

const DRIVERS: [string, (options: HelperDriverOptions) => DesktopDriver][] = [
  ['windows-uia', options => new WindowsUiaDriver(options)], ['macos-ax', options => new MacAxDriver(options)]];

for (const [platform, make] of DRIVERS) {
  test(`${platform}: list, info, related, focus, focused, press, type and snapshot round trip`, async () => {
    const { options, requests } = fake();
    const driver = make(options);
    try {
      assert.equal(driver.platform, platform);
      assert.deepEqual(await driver.available(), { ok: true });
      // Control and bidi characters are stripped; the window with an excluded pid is hidden.
      assert.deepEqual(await driver.listWindows(), [{ id: '0x1a', title: 'Synthetic Books', app: 'books', pid: 100 }]);
      assert.deepEqual(await driver.windowInfo('0x1a'), { id: '0x1a', title: 'Synthetic Books', app: 'books', pid: 100 });
      assert.equal(await driver.windowInfo('0x2b'), null, 'excluded pid');
      assert.equal(await driver.windowInfo('0x99'), null);
      assert.deepEqual((await driver.related('0x1a')).map(w => w.id), ['0x1c']);
      await driver.focus('0x1a');
      assert.deepEqual(await driver.focused(), { windowId: '0x1a', secret: true });
      assert.deepEqual(await driver.focused(), { windowId: '0x1a', secret: false });
      assert.deepEqual(await driver.focused(), { windowId: '0x1a', secret: null });
      await driver.press({ modifiers: ['alt'], key: 'e' });
      await driver.typeFileName('chausar-export-abc123.csv');
      const snapshot = await driver.snapshot('0x1a');
      assert.equal(snapshot.width, 2); assert.equal(snapshot.height, 3);
      assert.equal(snapshot.png.subarray(1, 4).toString('latin1'), 'PNG');
      await assert.rejects(driver.focus('not-a-window'), refuses('DRIVER_WINDOW_GONE'));
      const sent = requests();
      assert.deepEqual(sent.find(r => r.op === 'press')?.args, { modifiers: ['alt'], key: 'e' });
      assert.deepEqual(sent.find(r => r.op === 'type')?.args, { name: 'chausar-export-abc123.csv' });
      assert.deepEqual(sent.find(r => r.op === 'focus')?.args, { id: '0x1a' });
      assert.equal(sent.some(r => r.op === 'focus' && r.args.id === 'not-a-window'), false);
    } finally { await driver.close(); }
  });

  test(`${platform}: replies are checked field by field`, async () => {
    for (const mode of ['bad-id', 'long-title', 'bad-pid']) {
      const driver = make(fake(mode).options);
      try { await assert.rejects(driver.listWindows(), refuses('DRIVER_REPLY_INVALID'), mode); } finally { await driver.close(); }
    }
    const pngDriver = make(fake('bad-png').options);
    try { await assert.rejects(pngDriver.snapshot('0x1a'), refuses('DRIVER_REPLY_INVALID')); } finally { await pngDriver.close(); }
    const codeDriver = make(fake('unknown-code').options);
    try {
      await assert.rejects(codeDriver.focus('0x1a'), (error: unknown) => refuses('DRIVER_FAILED')(error) && !String((error as Error).message).includes('SECRET'));
      await assert.rejects(codeDriver.listWindows(), refuses('DRIVER_FAILED'));
      assert.deepEqual(await codeDriver.available(), { ok: false, code: 'DRIVER_FAILED', reason: 'The desktop helper could not do this.' });
    } finally { await codeDriver.close(); }
  });

  test(`${platform}: a permission reply keeps Chausar's own sentence`, async () => {
    const driver = make(fake('perm').options);
    try {
      assert.deepEqual(await driver.available(), { ok: false, code: 'DRIVER_PERMISSION_REQUIRED',
        reason: 'Allow Chausar in System Settings, Privacy and Security, Accessibility.' });
    } finally { await driver.close(); }
  });

  test(`${platform}: a silent helper times out and the next request starts a fresh one`, async () => {
    const driver = make(fake('hang', { timeoutMs: 300 }).options);
    try {
      await driver.listWindows();
      await assert.rejects(driver.focus('0x1a'), refuses('DRIVER_TIMEOUT'));
      assert.equal((await driver.listWindows()).length, 1);
    } finally { await driver.close(); }
  });

  test(`${platform}: a helper crash rejects every pending request and stops the watch`, async () => {
    const driver = make(fake('crash').options);
    const seen: Activity['kind'][] = [];
    try {
      await driver.watch(activity => seen.push(activity.kind));
      const pending = driver.listWindows();
      await assert.rejects(driver.focus('0x1a'), refuses('DRIVER_UNAVAILABLE'));
      await assert.rejects(pending, refuses('DRIVER_UNAVAILABLE'));
      assert.equal(seen.at(-1), 'stop-key', 'a lost watch reports the stop key');
    } finally { await driver.close(); }
  });

  test(`${platform}: own input is muted but the stop key never is`, async () => {
    const driver = make(fake().options);
    const seen: Activity['kind'][] = [];
    try {
      const watch = await driver.watch(activity => seen.push(activity.kind));
      await settle();
      assert.deepEqual(seen, ['pointer']);
      await driver.press({ modifiers: ['ctrl'], key: 'f5' });
      await driver.typeFileName('chausar-export-abc123.txt');
      await settle();
      assert.deepEqual(seen, ['pointer', 'stop-key', 'stop-key']);
      watch.close();
      await settle();
    } finally { await driver.close(); }
  });

  test(`${platform}: refused keys and outside text never reach the helper`, async () => {
    const { options, requests } = fake();
    const driver = make(options);
    try {
      await assert.rejects(driver.typeFileName('invoice 2024.csv'), refuses('DRIVING_TEXT_REFUSED'));
      await assert.rejects(driver.typeFileName('chausar-export-abc123.csv\nrm'), refuses('DRIVING_TEXT_REFUSED'));
      await assert.rejects(driver.press({ modifiers: ['alt'], key: 'd' }), refuses('DRIVING_KEY_REFUSED'));
      await assert.rejects(driver.press({ modifiers: [], key: 'a' }), refuses('DRIVING_KEY_REFUSED'));
      await assert.rejects(driver.press({ modifiers: ['ctrl'], key: 'delete' }), refuses('DRIVING_KEY_REFUSED'));
      assert.deepEqual(requests(), []);
    } finally { await driver.close(); }
  });

  test(`${platform}: available never throws when the helper cannot start`, async () => {
    const driver = make({ spawn: () => spawn(join(dir, 'no-such-helper')), timeoutMs: 2000 });
    try { assert.deepEqual(await driver.available(), { ok: false, code: 'DRIVER_UNAVAILABLE', reason: 'The desktop helper is not running.' }); }
    finally { await driver.close(); }
  });
}

test('the Windows helper script holds the stop key, skips injected input and re-checks the file name', () => {
  for (const needle of ['IsPassword', 'LLKHF_INJECTED', 'LLMHF_INJECTED', 'RegisterHotKey', '0x13', 'KEYEVENTF_UNICODE', 'PrintWindow', 'GW_OWNER',
    'SetForegroundWindow', 'WindowPattern', 'WH_KEYBOARD_LL', 'WH_MOUSE_LL', 'NativeWindowHandle'])
    assert.ok(WINDOWS_HELPER_SCRIPT.includes(needle), needle);
  assert.ok(WINDOWS_HELPER_SCRIPT.includes('new Regex("^chausar-export-[a-z0-9]{6,32}\\\\.(csv|xml|xlsx|xls|txt|pdf|json|html)$")'));
  assert.ok(WINDOWS_HELPER_SCRIPT.includes('!FileName.IsMatch(name)'));
  assert.ok(/^\$source = @'$/m.test(WINDOWS_HELPER_SCRIPT) && /^'@$/m.test(WINDOWS_HELPER_SCRIPT), 'here-string markers at line starts');
  assert.ok(!/[`]/.test(WINDOWS_HELPER_SCRIPT) && !/[^\x00-\x7f]/.test(WINDOWS_HELPER_SCRIPT), 'plain ASCII for a BOM-less .ps1');
  const csharp = WINDOWS_HELPER_SCRIPT.split("$source = @'")[1]!.split("\n'@")[0]!;
  assert.ok(csharp.includes('public static class ChausarHelper') && !/[(=,\s]\$"|\?\.[A-Za-z]|=> |\bnameof\b|\bout var\b/.test(csharp), 'C# 5 only (Windows PowerShell compiler)');
});

test('the macOS helper script checks trust, password fields, the F15 stop key and the file name', () => {
  for (const needle of ['AXSecureTextField', 'AXIsProcessTrusted', 'F15', 'CGWindowListCopyWindowInfo', 'addGlobalMonitorForEventsMatchingMaskHandler',
    'AXRaise', '/usr/sbin/screencapture', "'-x', '-o', '-l' + number", 'removeItemAtPathError', 'DRIVER_PERMISSION_REQUIRED'])
    assert.ok(MACOS_HELPER_SCRIPT.includes(needle), needle);
  assert.ok(MACOS_HELPER_SCRIPT.includes('var FILE_NAME = /^chausar-export-[a-z0-9]{6,32}\\.(csv|xml|xlsx|xls|txt|pdf|json|html)$/;'));
  assert.ok(MACOS_HELPER_SCRIPT.includes('!FILE_NAME.test(name)'));
  // The script parses as JavaScript (JXA globals are only referenced inside functions).
  assert.doesNotThrow(() => new Function(MACOS_HELPER_SCRIPT));
});

test('selectDriver picks the driver for each system and none for Wayland-only Linux', async t => {
  if (!existsSync(new URL('../runtime/driving/x11/driver.ts', import.meta.url))) return t.skip('the X11 driver is not in this tree yet');
  const { selectDriver } = await import('../runtime/driving/select.ts');
  assert.equal(selectDriver({ platform: 'win32', env: {} })?.platform, 'windows-uia');
  assert.equal(selectDriver({ platform: 'darwin', env: {} })?.platform, 'macos-ax');
  assert.equal(selectDriver({ platform: 'linux', env: { DISPLAY: ':0' }, excludePids: [1] })?.platform, 'x11');
  assert.equal(selectDriver({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } }), null);
  assert.equal(selectDriver({ platform: 'freebsd', env: { DISPLAY: ':0' } }), null);
});
