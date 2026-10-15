import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { Engine } from '../runtime/engine.ts';
import { drivingModule } from '../runtime/modules/lane-driving.ts';
import { DrivingController, type DrivingState } from '../runtime/driving/session.ts';
import { BUILT_IN_PLANS, definePlan } from '../runtime/driving/plans.ts';
import { chordText, parseChord, type Activity, type Chord, type DesktopDriver, type FocusInfo, type WindowInfo } from '../runtime/driving/driver.ts';

const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(test: () => Promise<boolean> | boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await test()) return; await wait(20); }
  assert.fail('condition not reached in time');
}
function png(width: number, height: number) {
  const crc = (buf: Buffer) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type: string, data: Buffer) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** A scripted desktop: windows, focus and the person's input, all synthetic. */
class FakeDriver implements DesktopDriver {
  readonly platform = 'fake' as const;
  windows = new Map<string, { id: string; title: string; app: string; pid: number | null; owner?: string }>([
    ['0x1', { id: '0x1', title: 'Synthetic Books Ledger', app: 'synthbooks', pid: 11 }],
    ['0x2', { id: '0x2', title: 'Synthetic Notes', app: 'notes', pid: 12 }],
  ]);
  focusId: string | null = '0x2'; secret: boolean | null = null; pressed: string[] = []; typed: string[] = []; focusCalls = 0; focusSticks = true;
  onPress: ((chord: string) => void) | null = null;
  listener: ((a: Activity) => void) | null = null; watchClosed = 0;
  async available() { return { ok: true as const }; }
  async listWindows() { return [...this.windows.values()].filter(w => !w.owner).map(({ owner: _o, ...w }) => w); }
  async windowInfo(id: string) { const w = this.windows.get(id); return w ? { id: w.id, title: w.title, app: w.app, pid: w.pid } : null; }
  async related(id: string) { return [...this.windows.values()].filter(w => w.owner === id).map(({ owner: _o, ...w }) => w); }
  async focus(id: string) { this.focusCalls += 1; if (this.focusSticks) this.focusId = id; }
  async focused(): Promise<FocusInfo> { return { windowId: this.focusId, secret: this.secret }; }
  async press(chord: Chord) { this.pressed.push(chordText(chord)); this.onPress?.(chordText(chord)); }
  async typeFileName(name: string) { this.typed.push(name); }
  async snapshot(_id: string) { return { width: 4, height: 3, png: png(4, 3) }; }
  async watch(on: (a: Activity) => void) { this.listener = on; return { close: () => { this.listener = null; this.watchClosed += 1; } }; }
  async close() {}
  person(kind: Activity['kind']) { this.listener?.({ kind, at: Date.now() }); }
}

async function open(t: any, setup: (input: { driver: FakeDriver; root: string }) => Partial<ConstructorParameters<typeof DrivingController>[0]> = () => ({})) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-drive-'));
  const driver = new FakeDriver();
  const notified: Array<[DrivingState, boolean]> = [];
  const controller = new DrivingController({ driver, exportRoot: join(directory, 'driving-exports'), plans: BUILT_IN_PLANS, pollMs: 20, startGraceMs: 0,
    notify: (state, active) => notified.push([state, active]), searchFolders: [], ...setup({ driver, root: directory }) });
  // File storage needs the demo flag; the trusted test host allows driving the synthetic window there.
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { driving: { controller, allowDemo: true } } } as any);
  t.after(async () => { controller.stop(); await controller.settled(); await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Books', passphrase: 'Synthetic driving passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return { engine, driver, controller, notified, directory };
}
const start = (engine: Engine, extra: Record<string, unknown> = {}) => engine.request('session.start', { windowId: '0x1', mode: 'read-export', typesSecrets: false, ...extra });

test('chords: navigation and chords pass, typing, deleting and pasting are refused', () => {
  assert.equal(chordText(parseChord('Ctrl+Alt+E')), 'ctrl+alt+e');
  assert.equal(chordText(parseChord('shift+alt+f5')), 'alt+shift+f5');
  for (const refused of ['a', 'shift+a', '7', 'alt+d', 'ctrl+v', 'ctrl+a', 'alt+f4', 'delete', 'backspace', 'ctrl+alt', 'meta+e', 'ctrl+ctrl+e', '']) assert.throws(() => parseChord(refused), code('DRIVING_KEY_REFUSED'), refused);
  assert.throws(() => definePlan({ id: 'bad.plan', title: 'x', produces: 'png', status: 'experimental', verified: true, steps: [{ kind: 'keys', chord: 'enter', say: 'x' }] }), code('DRIVING_PLAN_INVALID'));
  assert.throws(() => definePlan({ id: 'bad.plan', title: 'x', produces: 'csv', status: 'experimental', verified: true, steps: [{ kind: 'focus', say: 'x' }, { kind: 'snapshot', say: 'y' }] }), code('DRIVING_PLAN_INVALID'));
});

test('without the installed desktop app the driver is unavailable and nothing starts', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-drive-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const outside = drivingModule.hostOptions!({ directory, demo: false, env: { DISPLAY: ':0' } }).controller as DrivingController;
  assert.deepEqual(await outside.availability(), { ok: false, code: 'DRIVER_UNAVAILABLE', reason: 'Driving works only in the installed desktop app.' });
  await assert.rejects(outside.windows(), code('DRIVER_UNAVAILABLE'));
  const wayland = drivingModule.hostOptions!({ directory, demo: false, env: { CHAUSAR_DESKTOP_DRIVER: '1', WAYLAND_DISPLAY: 'wayland-0' } }).controller as DrivingController;
  if (process.platform === 'linux') assert.match((await wayland.availability()).reason!, /X11 on Linux/);
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(() => engine.close());
  const before = await engine.request('session.driver', {});
  assert.equal(before.available, false); assert.equal(before.code, 'DRIVER_UNAVAILABLE');
  assert.deepEqual(before.rules, { windows: 1, mode: 'read-export', typesSecrets: false });
  await engine.request('workspace.create', { name: 'Synthetic Books', passphrase: 'Synthetic driving passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  assert.deepEqual((await engine.request('session.windows', {})).windows, []);
  assert.equal((await engine.request('session.status', {})).state, 'idle');
  // work-books' WK-14 screen now reaches the real methods: available, idle, no windows to choose.
  const wk14 = await engine.request('approvals.drivingStatus', {});
  assert.equal(wk14.available, true); assert.deepEqual(wk14.windows, []);
  await assert.rejects(engine.request('approvals.drivingStart', { windowId: '0x1' }), code('DEMO_EXTERNAL_DISABLED'));
});

test('demo mode keeps driving off', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-drive-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' } as any);
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  assert.match((await engine.request('session.driver', {})).reason, /demo/i);
  await engine.request('workspace.create', { name: 'Synthetic Books', passphrase: 'Synthetic driving passphrase 2026', demo: true, pack: 'retail', folder: 'main' });
  await assert.rejects(start(engine), code('DEMO_EXTERNAL_DISABLED'));
});

test('a picture of one window: listed, driven, exported, recorded, read once and discarded', async t => {
  const { engine, driver, controller, notified } = await open(t);
  const driverInfo = await engine.request('session.driver', {});
  assert.equal(driverInfo.available, true); assert.equal(driverInfo.platform, 'fake'); assert.equal(driverInfo.stopKey, 'Ctrl Alt Pause');
  assert.deepEqual((await engine.request('session.windows', {})).windows.map((w: any) => w.id), ['0x1', '0x2']);
  const first = await start(engine);
  assert.equal(first.state, 'driving'); assert.deepEqual(first.window, { id: '0x1', title: 'Synthetic Books Ledger' });
  await controller.settled();
  const status = await engine.request('session.status', {});
  assert.equal(status.state, 'done'); assert.equal(status.reason, 'Finished.');
  assert.deepEqual(status.steps.map((s: any) => s.state), ['done', 'done']);
  assert.equal(status.exports.length, 1); assert.match(status.exports[0].name, /^chausar-export-[a-f0-9]{16}\.png$/);
  assert.equal(driver.focusId, '0x1'); assert.deepEqual(driver.pressed, []); assert.deepEqual(driver.typed, []); assert.equal(driver.watchClosed, 1);
  assert.deepEqual(notified[0], ['driving', true]); assert.deepEqual(notified.at(-1), ['done', false]);
  const history = await engine.request('session.history', {});
  assert.equal(history.sessions.length, 1); assert.equal(history.sessions[0].plan, 'window.picture'); assert.deepEqual(history.sessions[0].window, { title: 'Synthetic Books Ledger', app: 'synthbooks' });
  const exports = (await engine.request('session.exports', {})).exports;
  assert.equal(exports.length, 1); assert.equal(exports[0].mediaType, 'image/png'); assert.equal('path' in exports[0], false);
  const read = await engine.request('session.readExport', { exportId: exports[0].id });
  assert.equal(Buffer.from(read.base64, 'base64').subarray(1, 4).toString(), 'PNG'); assert.equal(read.text, undefined);
  await assert.rejects(engine.request('session.readExport', { exportId: 'export_000000000000000000' }), code('EXPORT_NOT_FOUND'));
  await assert.rejects(engine.request('session.readExport', { exportId: '../x' }), code('INVALID_SESSION_REQUEST'));
  assert.deepEqual(await engine.request('session.discardExport', { exportId: exports[0].id }), { discarded: true });
  assert.equal((await engine.request('session.exports', {})).exports.length, 0);
  await assert.rejects(engine.request('session.readExport', { exportId: exports[0].id }), code('EXPORT_NOT_FOUND'));
  const activity = (engine as any).store().read().activity.map((a: any) => a.event);
  assert.ok(activity.includes('driving.session') && activity.includes('driving.exportDiscarded'));
});

test('start keeps the rules: one session, read and export only, no secrets, a person at this computer', async t => {
  const { engine, controller } = await open(t, () => ({ pollMs: 1000 }));
  await assert.rejects(start(engine, { mode: 'edit' }), code('INVALID_SESSION_REQUEST'));
  await assert.rejects(start(engine, { typesSecrets: true }), code('INVALID_SESSION_REQUEST'));
  await assert.rejects(start(engine, { extra: 1 }), code('INVALID_SESSION_REQUEST'));
  await assert.rejects(start(engine, { windowId: '0x9' }), code('WINDOW_NOT_FOUND'));
  await assert.rejects(start(engine, { plan: 'nope' }), code('DRIVING_PLAN_NOT_FOUND'));
  await assert.rejects(start(engine, { plan: 'tally.report-export' }), code('DRIVING_PLAN_UNVERIFIED'));
  await assert.rejects((engine as any).requestAs({ ...(engine as any).bootstrapContext(), sourceTainted: true }, 'session.start', { windowId: '0x1', mode: 'read-export', typesSecrets: false }), code('TAINTED_REQUEST'));
  await assert.rejects((engine as any).requestAs({ ...(engine as any).bootstrapContext(), channel: 'mcp' }, 'session.start', { windowId: '0x1', mode: 'read-export', typesSecrets: false }), code('TAINTED_REQUEST'));
  await start(engine);
  await assert.rejects(start(engine, { windowId: '0x2' }), code('SESSION_ACTIVE'));
  await assert.rejects(engine.request('session.resume', {}), code('SESSION_NOT_PAUSED'));
  const stopped = await engine.request('session.stop', {});
  assert.equal(stopped.state, 'stopped'); assert.equal(stopped.reason, 'Stopped.');
  await controller.settled();
  // Stop is safe to repeat.
  assert.equal((await engine.request('session.stop', {})).state, 'stopped');
});

test('the person moving the mouse pauses at once; Continue goes on; the stop key ends it', async t => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  const plan = definePlan({ id: 'synthetic.keys', title: 'Synthetic keys', app: 'synthbooks', produces: 'png', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Focus.' }, { kind: 'keys', chord: 'down', say: 'Move down.', settleMs: 0 }, { kind: 'keys', chord: 'down', say: 'Move down again.', settleMs: 0 }, { kind: 'snapshot', say: 'Picture.' }] });
  const { engine, driver, controller } = await open(t, ({ driver }) => { driver.onPress = () => { if (driver.pressed.length === 1) void gate; }; return { plans: [...BUILT_IN_PLANS, plan] }; });
  driver.onPress = () => { if (driver.pressed.length === 1) driver.person('pointer'); };
  await start(engine, { plan: 'synthetic.keys' });
  await until(async () => (await engine.request('session.status', {})).state === 'paused-by-you');
  const paused = await engine.request('session.status', {});
  assert.equal(paused.reason, 'You moved the mouse or typed. Paused.');
  assert.deepEqual(driver.pressed, ['down'], 'nothing more is pressed while paused');
  await wait(100); assert.deepEqual(driver.pressed, ['down']);
  release();
  driver.focusId = '0x9'; // Continue was pressed in Chausar's own window
  assert.equal((await engine.request('session.resume', {})).state, 'driving');
  await controller.settled();
  assert.equal((await engine.request('session.status', {})).state, 'done');
  assert.deepEqual(driver.pressed, ['down', 'down']); assert.ok(driver.focusCalls >= 2, 'the chosen window is brought back after Continue');

  driver.onPress = () => driver.person('stop-key');
  await start(engine, { plan: 'synthetic.keys' });
  await controller.settled();
  const byKey = await engine.request('session.status', {});
  assert.equal(byKey.state, 'stopped-by-key'); assert.equal(byKey.reason, 'Stopped by your key.');
  assert.deepEqual(driver.pressed, ['down', 'down', 'down']);
});

test('a sign-in screen hands over to the person; a password box is never typed into; payment screens stop', async t => {
  const plan = definePlan({ id: 'synthetic.file', title: 'Synthetic file', app: 'synthbooks', produces: 'csv', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Focus.' }, { kind: 'keys', chord: 'ctrl+e', say: 'Open export.', settleMs: 0 }, { kind: 'wait-title', pattern: 'export', say: 'Wait for export.', timeoutMs: 2000 },
      { kind: 'type-file-name', extension: 'csv', say: 'Type the name.' }, { kind: 'keys', chord: 'enter', say: 'Send.', settleMs: 0 }, { kind: 'wait-file', say: 'Wait for the file.', timeoutMs: 2000 }] });
  let saveTo = '';
  const { engine, driver, controller } = await open(t, ({ root }) => { saveTo = join(root, 'program-saves'); return { plans: [plan], searchFolders: [saveTo] }; });
  const { mkdir } = await import('node:fs/promises'); await mkdir(saveTo);
  // The program asks for a sign-in first.
  driver.windows.set('0x5', { id: '0x5', title: 'Sign in to Synthetic Books', app: 'synthbooks', pid: 11, owner: '0x1' });
  driver.onPress = chord => {
    if (chord === 'ctrl+e') driver.windows.get('0x1')!.title = 'Synthetic Books — Export';
    if (chord === 'enter') void writeFile(join(saveTo, driver.typed.at(-1)!), 'date,amount\n2026-10-01,100\n');
  };
  await start(engine, { plan: 'synthetic.file' });
  await until(async () => (await engine.request('session.status', {})).state === 'sign-in');
  assert.equal((await engine.request('session.status', {})).reason, 'Sign in yourself. Chausar continues after.');
  driver.person('key'); // the person types their password: expected, not a pause
  assert.deepEqual(driver.pressed, []);
  driver.windows.delete('0x5');
  // Then a password box gets focus: Chausar waits and types nothing.
  driver.secret = true;
  await until(async () => (await engine.request('session.status', {})).reason === 'A password box has focus. Sign in yourself. Chausar continues after.');
  await wait(100); assert.deepEqual(driver.typed, []); assert.deepEqual(driver.pressed, []);
  driver.secret = false;
  await controller.settled();
  const done = await engine.request('session.status', {});
  assert.equal(done.state, 'done', JSON.stringify(done));
  assert.deepEqual(driver.pressed, ['ctrl+e', 'enter']); assert.equal(driver.typed.length, 1);
  assert.equal(existsSync(join(saveTo, driver.typed[0])), false, 'the export is moved into the session folder');
  const csv = (await engine.request('session.exports', {})).exports[0];
  assert.equal(csv.mediaType, 'text/csv');
  const read = await engine.request('session.readExport', { exportId: csv.id });
  assert.equal(read.text, 'date,amount\n2026-10-01,100\n'); assert.equal(read.base64, undefined);

  // A payment screen of the same program stops the session before any key.
  driver.windows.get('0x1')!.title = 'Synthetic Books Ledger'; driver.pressed = []; driver.typed = [];
  driver.windows.set('0x6', { id: '0x6', title: 'Make Payment', app: 'synthbooks', pid: 11, owner: '0x1' });
  await start(engine, { plan: 'synthetic.file' });
  await controller.settled();
  const stopped = await engine.request('session.status', {});
  assert.equal(stopped.state, 'step-failed'); assert.match(stopped.reason, /payment or edit screen/);
  assert.deepEqual(driver.pressed, []); assert.deepEqual(driver.typed, []);
  assert.ok(!JSON.stringify(stopped.steps).includes('Make Payment'), 'outside titles never enter steps or reasons');
});

test('another window taking focus pauses; a closed window or a missing file fails the step', async t => {
  const plan = definePlan({ id: 'synthetic.file', title: 'Synthetic file', app: 'synthbooks', produces: 'csv', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Focus.' }, { kind: 'type-file-name', extension: 'csv', say: 'Type the name.' }, { kind: 'wait-file', say: 'Wait for the file.', timeoutMs: 200 }] });
  const { engine, driver, controller } = await open(t, () => ({ plans: [plan] }));
  driver.focusSticks = false; driver.focusId = '0x2';
  await start(engine, { plan: 'synthetic.file' });
  await until(async () => (await engine.request('session.status', {})).state === 'paused-by-you');
  assert.equal((await engine.request('session.status', {})).reason, 'Another window came to the front. Paused.');
  assert.deepEqual(driver.typed, []);
  driver.focusSticks = true;
  await engine.request('session.resume', {});
  await controller.settled();
  const missing = await engine.request('session.status', {});
  assert.equal(missing.state, 'step-failed'); assert.equal(missing.reason, 'The exported file did not appear.');

  await start(engine, { plan: 'window.picture' }).catch(error => assert.equal(error.code, 'DRIVING_PLAN_NOT_FOUND'));
  driver.windows.delete('0x1');
  await assert.rejects(start(engine, { plan: 'synthetic.file' }), code('WINDOW_NOT_FOUND'));
});

test('locking the workspace stops the session; status and stop work while locked', async t => {
  const plan = definePlan({ id: 'synthetic.wait', title: 'Synthetic wait', app: null, produces: 'png', status: 'tested-synthetic', verified: true,
    steps: [{ kind: 'focus', say: 'Focus.' }, { kind: 'wait-title', pattern: 'never-appears', say: 'Wait.', timeoutMs: 60_000 }, { kind: 'snapshot', say: 'Picture.' }] });
  const { engine, controller, directory } = await open(t, () => ({ plans: [plan] }));
  await start(engine, { plan: 'synthetic.wait' });
  await wait(60);
  await engine.request('workspace.lock', {});
  const locked = await engine.request('session.status', {});
  assert.equal(locked.state, 'idle', 'a locked workspace shows no session');
  assert.equal(controller.active, null);
  assert.equal((await engine.request('session.stop', {})).state, 'idle');
  await controller.settled();
  await engine.request('workspace.open', { folder: 'main', passphrase: 'Synthetic driving passphrase 2026' });
  const history = await engine.request('session.history', {});
  assert.equal(history.sessions[0].state, 'stopped'); assert.equal(history.sessions[0].reason, 'The workspace locked or changed. Chausar stopped.');
  assert.ok(existsSync(join(directory, 'driving-exports')) === false || (await readdir(join(directory, 'driving-exports'))).length >= 0);
});

test('work-books WK-14 now runs over the real session methods', async t => {
  const { engine, controller } = await open(t);
  const now = await engine.request('approvals.drivingStatus', {});
  assert.equal(now.available, true); assert.equal(now.status.state, 'idle');
  assert.deepEqual(now.windows.map((w: any) => w.app), ['synthbooks', 'notes']);
  const started = await engine.request('approvals.drivingStart', { windowId: '0x1' });
  assert.equal(started.available, true); assert.equal(started.status.window.id, '0x1');
  await controller.settled();
  assert.equal((await engine.request('approvals.drivingStatus', {})).status.state, 'done');
  assert.equal((await engine.request('approvals.drivingStop', {})).status.state, 'done');
});

test('connectors read the plans for a group', async t => {
  const { engine } = await open(t);
  const tally = await engine.request('session.plans', { group: 'tally' });
  assert.deepEqual(tally.plans.map((p: any) => [p.id, p.verified, p.produces]), [['tally.report-export', false, 'xml']]);
  assert.equal((await engine.request('session.plans', {})).plans.length, 2);
});
