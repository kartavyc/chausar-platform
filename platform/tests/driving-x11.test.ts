import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { X11Driver } from '../runtime/driving/x11/driver.ts';
import { EVENT_MASK, X11Client, keyEvent, type KeyEvent } from '../runtime/driving/x11/protocol.ts';
import { parseChord, type Activity } from '../runtime/driving/driver.ts';

const XVFB = '/usr/bin/Xvfb';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const env = { XAUTHORITY: '/nonexistent/chausar-test-xauthority', HOME: '/nonexistent' };
async function until<T>(probe: () => Promise<T> | T, ms = 2000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await probe(); if (v || Date.now() > end) return v; await sleep(20); }
}
/** Pixels of an 8-bit RGB, unfiltered PNG as written by the driver. */
function decodePng(png: Buffer) {
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  let at = 8, width = 0, height = 0; const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at), type = png.subarray(at + 4, at + 8).toString(), data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); assert.equal(data[9], 2); }
    if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  return { width, height, raw: inflateSync(Buffer.concat(idat)) };
}

test('X11 driver against a private Xvfb', { timeout: 30_000 }, async t => {
  if (!existsSync(XVFB)) { t.skip('Xvfb is not installed at /usr/bin/Xvfb, so the X11 driver cannot be tested here.'); return; }
  let n = 140; while (n < 200 && (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`))) n++;
  assert.ok(n < 200, 'no free display number');
  const display = `:${n}`;
  const server = spawn(XVFB, [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  t.after(() => { server.kill('SIGTERM'); });
  assert.ok(await until(() => existsSync(`/tmp/.X11-unix/X${n}`), 5000), 'Xvfb did not start');
  await sleep(100);

  const app = await X11Client.open(display, env);
  const person = await X11Client.open(display, env);
  const driver = new X11Driver({ display, env });
  t.after(async () => { await driver.close(); app.close(); person.close(); });
  const root = app.setup.root;
  const keys: KeyEvent[] = [];
  app.onEvent = event => { const k = keyEvent(event); if (k && event.type === 2) keys.push(k); };

  const atom = (name: string) => app.internAtom(name);
  const setTitle = async (win: number, title: string) => {
    await app.changeProperty(win, 39, 31, 8, Buffer.from(title, 'latin1'));
    await app.changeProperty(win, await atom('_NET_WM_NAME'), await atom('UTF8_STRING'), 8, Buffer.from(title));
  };
  const makeWindow = async (title: string, opts: { pid?: number; transientFor?: number; back?: number } = {}) => {
    const win = await app.createWindow(root, 100, 120, 320, 200, { backPixel: opts.back ?? 0x336699, eventMask: EVENT_MASK.KeyPress | EVENT_MASK.ButtonPress });
    await setTitle(win, title);
    await app.changeProperty(win, 67, 31, 8, Buffer.from('synthbooks\0synthbooks\0', 'latin1'));
    if (opts.pid) { const b = Buffer.alloc(4); b.writeUInt32LE(opts.pid); await app.changeProperty(win, await atom('_NET_WM_PID'), 6, 32, b); }
    if (opts.transientFor) { const b = Buffer.alloc(4); b.writeUInt32LE(opts.transientFor); await app.changeProperty(win, 68, 33, 32, b); }
    await app.mapWindow(win);
    assert.ok(await until(async () => (await app.getWindowAttributes(win)).mapState === 2));
    return { win, id: `0x${win.toString(16)}` };
  };
  const ledger = await makeWindow('Synthetic Books Ledger', { pid: 424242 });

  await t.test('availability and display refusals', async () => {
    assert.deepEqual(await driver.available(), { ok: true });
    const remote = await new X11Driver({ display: 'books.example:0', env }).available();
    assert.equal(remote.ok, false); assert.equal(!remote.ok && remote.code, 'DRIVER_UNAVAILABLE');
    const missing = await new X11Driver({ display: ':139', env: { ...env, DISPLAY: undefined } }).available();
    assert.equal(missing.ok, false);
    assert.equal((await new X11Driver({ env: {} }).available()).ok, false);
  });

  await t.test('lists the window with title and app; excludePids hides it', async () => {
    const found = (await driver.listWindows()).find(w => w.id === ledger.id);
    assert.deepEqual(found, { id: ledger.id, title: 'Synthetic Books Ledger', app: 'synthbooks', pid: 424242 });
    const hidden = new X11Driver({ display, env, excludePids: [424242] });
    assert.equal((await hidden.listWindows()).some(w => w.id === ledger.id), false);
    await hidden.close();
    await assert.rejects(driver.windowInfo('ledger'), { code: 'WINDOW_NOT_FOUND' });
    await assert.rejects(driver.windowInfo('0x123456789'), { code: 'WINDOW_NOT_FOUND' });
  });

  await t.test('focus, then a checked chord reaches the window', async () => {
    await driver.focus(ledger.id);
    assert.deepEqual(await driver.focused(), { windowId: ledger.id, secret: null });
    const map = await app.getKeyboardMapping();
    const codeOf = (sym: number) => map.min + map.keysyms.findIndex((s, i) => i % map.perKeycode === 0 && s === sym) / map.perKeycode;
    keys.length = 0;
    await driver.press(parseChord('ctrl+e'));
    await app.getInputFocus();
    const e = await until(() => keys.find(k => k.keycode === codeOf(0x65)));
    assert.ok(e, 'no KeyPress for e'); assert.equal(e.window, ledger.win); assert.ok(e.state & 4, 'ControlMask missing');
    assert.throws(() => parseChord('alt+d'), { code: 'DRIVING_KEY_REFUSED' });
    assert.throws(() => parseChord('a'), { code: 'DRIVING_KEY_REFUSED' });
    await assert.rejects(driver.typeFileName('notes.txt'), { code: 'DRIVING_TEXT_REFUSED' });

    keys.length = 0;
    const name = 'chausar-export-abc123.csv';
    await driver.typeFileName(name);
    await app.getInputFocus();
    await until(() => keys.length >= name.length);
    const shiftCodes = new Set([0xffe1, 0xffe2].map(codeOf));
    const typed = keys.filter(k => !shiftCodes.has(k.keycode)).map(k => String.fromCharCode(map.keysyms[(k.keycode - map.min) * map.perKeycode + (k.state & 1 ? 1 : 0)])).join('');
    assert.equal(typed, name);
  });

  await t.test('snapshot is a PNG of the window in its background colour', async () => {
    const shot = await driver.snapshot(ledger.id);
    assert.equal(shot.width, 320); assert.equal(shot.height, 200);
    const { width, height, raw } = decodePng(shot.png);
    assert.equal(width, 320); assert.equal(height, 200);
    for (let y = 0; y < height; y += 37) for (let x = 0; x < width; x += 41) {
      const at: number = y * (width * 3 + 1) + 1 + x * 3;
      assert.deepEqual([raw[at], raw[at + 1], raw[at + 2]], [0x33, 0x66, 0x99]);
    }
  });

  await t.test('retitle, destroy and related dialogs', async () => {
    await setTitle(ledger.win, 'Synthetic Books Ledger - Day Book');
    assert.equal((await driver.windowInfo(ledger.id))?.title, 'Synthetic Books Ledger - Day Book');
    const gone = await makeWindow('Synthetic Scratch');
    assert.equal((await driver.windowInfo(gone.id))?.title, 'Synthetic Scratch');
    await app.destroyWindow(gone.win);
    assert.equal(await driver.windowInfo(gone.id), null);
    const dialog = await makeWindow('Export Report', { transientFor: ledger.win });
    const related = await driver.related(ledger.id);
    assert.ok(related.some(w => w.id === dialog.id && w.title === 'Export Report'));
    assert.equal(related.some(w => w.id === ledger.id), false);
  });

  await t.test('watch: own input is muted, the person and the stop key are reported', async () => {
    const seen: Activity[] = [];
    const watch = await driver.watch(a => seen.push(a));
    await driver.focus(ledger.id);
    await driver.press(parseChord('ctrl+e'));
    await sleep(350);
    assert.deepEqual(seen.filter(a => a.kind !== 'stop-key'), [], 'own press was reported');

    const map = await person.getKeyboardMapping();
    const codeOf = (sym: number) => map.min + map.keysyms.findIndex((s, i) => i % map.perKeycode === 0 && s === sym) / map.perKeycode;
    let start = Date.now();
    await person.fakeInput(6, 0, 640, 400); await person.fakeInput(6, 0, 650, 410); await person.getInputFocus();
    assert.ok(await until(() => seen.some(a => a.kind === 'pointer'), 500), 'pointer move not reported');
    assert.ok(Date.now() - start < 500);

    start = Date.now();
    await person.fakeInput(2, codeOf(0x6b)); await person.fakeInput(3, codeOf(0x6b)); await person.getInputFocus();
    assert.ok(await until(() => seen.some(a => a.kind === 'key'), 500), 'key not reported');
    assert.ok(Date.now() - start < 500);

    await person.fakeInput(4, 1); await person.fakeInput(5, 1); await person.getInputFocus();
    assert.ok(await until(() => seen.some(a => a.kind === 'button'), 500), 'button not reported');

    const ctrl = codeOf(0xffe3), alt = codeOf(0xffe9), pause = codeOf(0xff13);
    for (const c of [ctrl, alt, pause]) await person.fakeInput(2, c);
    for (const c of [pause, alt, ctrl]) await person.fakeInput(3, c);
    await person.getInputFocus();
    assert.ok(await until(() => seen.some(a => a.kind === 'stop-key'), 500), 'stop key not reported');
    watch.close();
  });
});
