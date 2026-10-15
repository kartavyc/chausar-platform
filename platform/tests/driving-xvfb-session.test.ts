import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { DrivingController } from '../runtime/driving/session.ts';
import { BUILT_IN_PLANS, definePlan } from '../runtime/driving/plans.ts';
import { X11Driver } from '../runtime/driving/x11/driver.ts';
import { EVENT_MASK, X11Client, keyEvent } from '../runtime/driving/x11/protocol.ts';

/**
 * The whole session over the real X11 driver: a private Xvfb, a synthetic "books" program drawn
 * by this test, and the engine's session.* methods. Nothing here touches a real program.
 */
const XVFB = '/usr/bin/Xvfb';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const env = { XAUTHORITY: '/nonexistent/chausar-test-xauthority', HOME: '/nonexistent' };
async function until(probe: () => Promise<boolean> | boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await probe()) return; await sleep(25); }
  assert.fail('condition not reached in time');
}

test('a session drives a synthetic program under Xvfb: export by keys, pause on the person, stop key', { timeout: 60_000 }, async t => {
  if (!existsSync(XVFB)) { t.skip('Xvfb is not installed at /usr/bin/Xvfb, so the session cannot be driven here.'); return; }
  let n = 200; while (n < 260 && (existsSync(`/tmp/.X11-unix/X${n}`) || existsSync(`/tmp/.X${n}-lock`))) n++;
  const display = `:${n}`;
  const server = spawn(XVFB, [display, '-screen', '0', '1280x800x24', '-nolisten', 'tcp'], { stdio: 'ignore' });
  t.after(() => { server.kill('SIGTERM'); });
  await until(() => existsSync(`/tmp/.X11-unix/X${n}`));
  await sleep(100);

  const directory = await mkdtemp(join(tmpdir(), 'chausar-xvfb-drive-'));
  const saves = join(directory, 'program-saves'); await mkdir(saves);
  t.after(() => rm(directory, { recursive: true, force: true }));

  // The synthetic program: Ctrl+E opens its export screen; typed letters fill the file name; Enter saves it.
  const app = await X11Client.open(display, env);
  const person = await X11Client.open(display, env);
  const root = app.setup.root;
  const map = await app.getKeyboardMapping();
  const symOf = (code: number, shift: boolean) => map.keysyms[(code - map.min) * map.perKeycode + (shift ? 1 : 0)];
  const codeOf = (sym: number) => map.min + map.keysyms.findIndex((s, i) => i % map.perKeycode === 0 && s === sym) / map.perKeycode;
  const window = await app.createWindow(root, 80, 80, 400, 260, { backPixel: 0x2e7d32, eventMask: EVENT_MASK.KeyPress });
  const atom = (name: string) => app.internAtom(name);
  const title = async (text: string) => { await app.changeProperty(window, 39, 31, 8, Buffer.from(text, 'latin1')); await app.changeProperty(window, await atom('_NET_WM_NAME'), await atom('UTF8_STRING'), 8, Buffer.from(text)); };
  await title('Synthetic Books Day Book');
  await app.changeProperty(window, 67, 31, 8, Buffer.from('synthbooks\0synthbooks\0', 'latin1'));
  await app.mapWindow(window);
  let typed = ''; let exporting = false; const presses: string[] = [];
  app.onEvent = event => {
    const key = keyEvent(event); if (!key || event.type !== 2) return;
    const sym = symOf(key.keycode, (key.state & 1) === 1);
    presses.push(sym.toString(16));
    if ((key.state & 4) && sym === 0x65) { exporting = true; void title('Synthetic Books Export'); return; }
    if (!exporting) return;
    if (sym === 0xff0d) { const name = typed; typed = ''; exporting = false; void title('Synthetic Books Day Book').then(() => writeFile(join(saves, name), 'date,amount\n2026-10-01,250000\n')); return; }
    if (sym >= 0x20 && sym < 0x7f) typed += String.fromCharCode(sym);
  };
  await until(async () => (await app.getWindowAttributes(window)).mapState === 2);
  const id = `0x${window.toString(16)}`;

  const plan = definePlan({ id: 'synthbooks.day-book', title: 'Export the synthetic day book', app: 'synthbooks', appLabel: 'Synthetic Books', groups: ['tally'], produces: 'csv', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Bring Synthetic Books to the front.' }, { kind: 'keys', chord: 'ctrl+e', say: 'Open Export.', settleMs: 50 },
      { kind: 'wait-title', pattern: 'export', say: 'Wait for the Export screen.', timeoutMs: 5000 }, { kind: 'type-file-name', extension: 'csv', say: 'Type the export file name.' },
      { kind: 'keys', chord: 'enter', say: 'Save the export.', settleMs: 50 }, { kind: 'wait-file', say: 'Wait for the exported file.', timeoutMs: 5000 }] });
  const slow = definePlan({ id: 'synthbooks.slow', title: 'Wait, then picture', app: 'synthbooks', produces: 'png', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Bring Synthetic Books to the front.' }, { kind: 'keys', chord: 'down', say: 'Move down.', settleMs: 600 }, { kind: 'keys', chord: 'down', say: 'Move down again.', settleMs: 600 }, { kind: 'snapshot', say: 'Take a picture.' }] });
  const driver = new X11Driver({ display, env });
  const controller = new DrivingController({ driver, exportRoot: join(directory, 'driving-exports'), plans: [...BUILT_IN_PLANS, plan, slow], searchFolders: [saves], pollMs: 40, startGraceMs: 0 });
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { driving: { controller, allowDemo: true } } } as any);
  t.after(async () => { controller.stop(); await controller.settled(); await engine.close(); await driver.close(); app.close(); person.close(); });
  await engine.request('workspace.create', { name: 'Synthetic Books', passphrase: 'Synthetic driving passphrase 2026', demo: false, pack: 'retail', folder: 'main' });

  assert.equal((await engine.request('session.driver', {})).platform, 'x11');
  const windows = (await engine.request('session.windows', {})).windows;
  assert.deepEqual(windows.find((w: any) => w.id === id), { id, title: 'Synthetic Books Day Book', app: 'synthbooks' });

  await t.test('export by keys: the file the program saves is kept and read in', async () => {
    await engine.request('session.start', { windowId: id, mode: 'read-export', typesSecrets: false, plan: 'synthbooks.day-book' });
    await controller.settled();
    const status = await engine.request('session.status', {});
    assert.equal(status.state, 'done', JSON.stringify(status));
    assert.equal(status.exports.length, 1);
    const read = await engine.request('session.readExport', { exportId: status.exports[0].id });
    assert.equal(read.text, 'date,amount\n2026-10-01,250000\n'); assert.match(read.name, /^chausar-export-[a-f0-9]{16}\.csv$/);
  });

  await t.test('a picture of the window', async () => {
    await engine.request('session.start', { windowId: id, mode: 'read-export', typesSecrets: false });
    await controller.settled();
    const status = await engine.request('session.status', {});
    assert.equal(status.state, 'done');
    const read = await engine.request('session.readExport', { exportId: status.exports[0].id });
    const png = Buffer.from(read.base64, 'base64');
    assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.equal(png.readUInt32BE(16), 400); assert.equal(png.readUInt32BE(20), 260);
  });

  await t.test('the person moving the mouse pauses at once and nothing more is pressed', async () => {
    presses.length = 0;
    await engine.request('session.start', { windowId: id, mode: 'read-export', typesSecrets: false, plan: 'synthbooks.slow' });
    await until(() => presses.length >= 1);
    await sleep(300); // past the driver's own-input grace after its key
    await person.fakeInput(6, 0, 700, 500); // the person moves the pointer
    await until(async () => (await engine.request('session.status', {})).state === 'paused-by-you', 1000);
    await sleep(800);
    assert.equal(presses.filter(p => p === 'ff54').length, 1, 'the second Down is not pressed while paused');
    await engine.request('session.resume', {});
    await controller.settled();
    assert.equal((await engine.request('session.status', {})).state, 'done');
    assert.equal(presses.filter(p => p === 'ff54').length, 2);
  });

  await t.test('Ctrl Alt Pause stops the session within a second', async () => {
    await engine.request('session.start', { windowId: id, mode: 'read-export', typesSecrets: false, plan: 'synthbooks.slow' });
    await sleep(100);
    const [ctrl, alt, pause] = [codeOf(0xffe3), codeOf(0xffe9), codeOf(0xff13)];
    const pressedAt = Date.now();
    for (const code of [ctrl, alt, pause]) await person.fakeInput(2, code);
    for (const code of [pause, alt, ctrl]) await person.fakeInput(3, code);
    await until(async () => (await engine.request('session.status', {})).state === 'stopped-by-key', 1000);
    assert.ok(Date.now() - pressedAt < 1000);
    await controller.settled();
    const history = await engine.request('session.history', {});
    assert.deepEqual(history.sessions.map((s: any) => s.state), ['stopped-by-key', 'done', 'done', 'done']);
  });
});
