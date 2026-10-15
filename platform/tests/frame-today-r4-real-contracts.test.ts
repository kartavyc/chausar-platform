import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { desktopSyncOptions } from '../runtime/core-sync-jobs/desktop-sync.ts';
import { DrivingController } from '../runtime/driving/session.ts';
import { BUILT_IN_PLANS } from '../runtime/driving/plans.ts';
import type { Activity, Chord, DesktopDriver, FocusInfo } from '../runtime/driving/driver.ts';
import { installSyntheticProductionStorage } from './fixtures/synthetic-production-engine.ts';
import {
  contextTimeZone, isTimeZoneReply, JOIN_REFUSALS, joinPhaseAt, R4_REFUSALS, readJoinAnswer, readJoinRequests, readJoinState, readLocalModels,
} from '../../app/ui/src/bridge/r4-contracts.ts';
import { isVoiceConfirm, isVoiceHeard, isVoiceStatus, isVoiceUsage, readVoiceSpeak, readVoiceStart } from '../../app/ui/src/bridge/voice-contract.ts';
import { isShellReply, isUpdatesReply } from '../../app/ui/src/bridge/todayx-contract.ts';
import { HOSTED_RECOVERY_REFUSALS } from '../../app/ui/src/bridge/hosted-recovery-contract.ts';
import { validateOpened } from '../../app/ui/src/screens/first-run/journey-contracts.ts';
import { createVoiceController, type VoiceCapturePort } from '../../app/ui/src/host/voice-controller.ts';

// Round 4: the frame-today screens were built against contracts with typed fixtures. Here each REAL engine method that
// now exists runs on synthetic data, and its reply goes through the same validator the screen uses. Nothing leaves the machine.
const passphrase = 'Frame today real contracts synthetic passphrase';
const codeOf = async (promise: Promise<unknown>) => { try { await promise; return null; } catch (error) { return (error as { code?: unknown }).code; } };

async function demoEngine(t: TestContext, options: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ft-real-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...options } as never);
  t.after(async () => { await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Frame Real Shop', passphrase, demo: false, pack: 'ecommerce', folder: 'main' });
  return engine;
}
/** A non-demo engine on synthetic production storage: models-ext refuses its providers in a demo engine. */
async function productionEngine(t: TestContext, modelsExt: Record<string, unknown>) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ft-real-prod-'));
  const engine = new Engine({ directory, ...installSyntheticProductionStorage(directory, ['main'], t.mock), modules: { 'models-ext': modelsExt } });
  t.after(async () => { await engine.request('workspace.lock', {}).catch(() => {}); await engine.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Frame Real Prod Shop', passphrase: 'correct horse battery staple 42', demo: false, pack: 'ecommerce' });
  return engine;
}

/* ------------------------------------------------------------------ FR-14: devices.join / seats.inviteVerify */

test('FR-14 on two real engines: every devices.join and seats.inviteVerify reply passes the screen’s validators, and the copy restores', async t => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'chausar-ft-join-'));
  const engines = new Set<Engine>();
  t.after(async () => { for (const engine of engines) await engine.close().catch(() => {}); await rm(root, { recursive: true, force: true }); });
  const office = join(root, 'office'), laptop = join(root, 'laptop'), shared = join(root, 'shared');
  await mkdir(shared);
  const start = async (directory: string, sync: boolean) => {
    const options = sync ? await desktopSyncOptions(directory, false, () => new Date()) : undefined;
    const engine = new Engine({ directory, demo: true, storage: 'experimental-file', ...(options ? { sync: options } : {}) });
    engines.add(engine); return engine;
  };
  // The computer already in: sync set up with the shared folder, restarted, turned on.
  let a = await start(office, false);
  await a.request('workspace.create', { name: 'Synthetic Join Shop', passphrase, demo: false, pack: 'ecommerce' });
  // Not enrolled yet: the computer already in says so in words.
  const notEnrolled = await codeOf(a.request('seats.inviteVerify', {}));
  assert.equal(notEnrolled, 'DEVICE_NOT_ENROLLED'); assert.ok(JOIN_REFUSALS.includes(notEnrolled as never));
  await a.request('sync.setup', { transport: 'folder', folder: shared, deviceName: 'Office desk' });
  await a.close(); engines.delete(a);
  a = await start(office, true); await a.request('workspace.open', { folder: 'main', passphrase });
  await a.request('sync.setup', { on: true });
  assert.deepEqual(readJoinRequests(await a.request('seats.inviteVerify', {})), []);

  // The new computer, before any workspace is open.
  const b = await start(laptop, false);
  const notStarted = await codeOf(b.request('devices.join', { step: 'finish' }));
  assert.equal(notStarted, 'DEVICE_JOIN_NOT_STARTED', 'the screen starts at the folder question on this code');
  for (const [payload, expected] of [[{ step: 'request', folder: join(root, 'nowhere') }, 'DEVICE_FOLDER_UNAVAILABLE'], [{ step: 'request', folder: 'relative' }, 'INVALID_DEVICE_REQUEST'],
    [{ step: 'request', folder: shared, deviceName: '<b>' }, 'INVALID_DEVICE_REQUEST']] as const) {
    const code = await codeOf(b.request('devices.join', payload));
    assert.equal(code, expected); assert.ok(JOIN_REFUSALS.includes(code as never), String(code));
  }
  const asked = readJoinState(await b.request('devices.join', { step: 'request', folder: shared, deviceName: 'Laptop' }));
  assert.ok(asked?.state === 'waiting', 'a waiting reply with a six-digit code');
  assert.equal(joinPhaseAt(asked, Date.now()), 'waiting');
  assert.deepEqual(readJoinState(await b.request('devices.join', { step: 'finish' })), asked, 'Check again reads the same join');

  // On the computer already in: the list, a typed code that differs, then the right one.
  const listed = readJoinRequests(await a.request('seats.inviteVerify', {}));
  assert.equal(listed?.length, 1); assert.equal(listed[0]!.name, 'Laptop'); assert.equal(listed[0]!.requestId, asked.requestId);
  const wrong = asked.code === '000000' ? '000001' : '000000';
  assert.equal(await codeOf(a.request('seats.inviteVerify', { requestId: asked.requestId, code: wrong, approve: true })), 'DEVICE_JOIN_CODE_MISMATCH');
  const answer = readJoinAnswer(await a.request('seats.inviteVerify', { requestId: asked.requestId, code: asked.code, approve: true }), asked.requestId);
  assert.ok(answer !== null && 'approved' in answer && answer.approved === true && answer.revision > 0, JSON.stringify(answer));
  assert.deepEqual(readJoinRequests(await a.request('seats.inviteVerify', {})), [], 'a used request is no longer listed');
  assert.equal(await codeOf(a.request('seats.inviteVerify', { requestId: 'join_00000000-0000-4000-8000-000000000000', approve: true, code: '123456' })), 'DEVICE_JOIN_NOT_FOUND');

  // Ready: the screen restores the managed copy with the workspace passphrase (`workspace.restore`), then asks for a restart.
  const ready = readJoinState(await b.request('devices.join', { step: 'finish' }));
  assert.ok(ready?.state === 'ready');
  assert.equal(await codeOf(b.request('devices.join', { step: 'finish' })), 'DEVICE_ALREADY_ENROLLED');
  const opened = validateOpened(await b.request('workspace.restore', { folder: 'main', backupFile: ready.backupFile, passphrase }));
  assert.equal(opened.name, 'Synthetic Join Shop');

  // Refuse, from the computer already in: the next new computer reads "refused".
  const c = await start(join(root, 'third'), false);
  const third = readJoinState(await c.request('devices.join', { step: 'request', folder: shared }));
  assert.ok(third?.state === 'waiting');
  assert.deepEqual(readJoinAnswer(await a.request('seats.inviteVerify', { requestId: third.requestId, approve: false }), third.requestId), { refused: true });
  assert.deepEqual(readJoinState(await c.request('devices.join', { step: 'finish' })), { state: 'refused' });
  // Cancel.
  const fourth = readJoinState(await c.request('devices.join', { step: 'request', folder: shared }));
  assert.ok(fourth?.state === 'waiting');
  assert.deepEqual(readJoinState(await c.request('devices.join', { step: 'cancel' })), { state: 'cancelled' });
  for (const code of JOIN_REFUSALS) assert.ok(R4_REFUSALS.includes(code), code);
});

/* ------------------------------------------------------------------ workspace.setTimeZone (core-data) */

test('workspace.setTimeZone: the real reply passes isTimeZoneReply, spelled as the zone list spells it; refusals are core-data’s', async t => {
  const engine = await demoEngine(t);
  const saved = await engine.request('workspace.setTimeZone', { timeZone: 'Europe/London' });
  assert.ok(isTimeZoneReply(saved)); assert.deepEqual(saved, { timeZone: 'Europe/London' });
  assert.deepEqual(contextTimeZone(await engine.request('ui.context', {})), { timeZone: 'Europe/London' });
  // Another spelling of the same name comes back in the list's spelling: the screen accepts it as the same zone.
  const lower = await engine.request('workspace.setTimeZone', { timeZone: 'asia/kolkata' }) as { timeZone: string };
  assert.ok(isTimeZoneReply(lower)); assert.equal(lower.timeZone.toLowerCase(), 'asia/kolkata');
  for (const payload of [{ timeZone: 'Mars/Olympus' }, { timeZone: 'Asia/Kolkata', extra: 1 }]) assert.equal(await codeOf(engine.request('workspace.setTimeZone', payload)), 'INVALID_TIME_ZONE');
  const tainted: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop', sourceTainted: true };
  assert.equal(await codeOf(engine.requestAs(tainted, 'workspace.setTimeZone', { timeZone: 'UTC' })), 'TAINTED_SETTING');
  for (const code of ['INVALID_TIME_ZONE', 'TAINTED_SETTING']) assert.ok(R4_REFUSALS.includes(code as never), code);
});

/* ------------------------------------------------------------------ modelsx.localList (models-ext) */

test('modelsx.localList: the real reachable and unreachable replies pass readLocalModels; a demo engine refuses in words', async t => {
  const reachable = await productionEngine(t, { ollamaHttp: async () => ({ status: 200, body: JSON.stringify({ models: [
    { name: 'llama3.2:3b', size: 2019393189, modified_at: '2026-09-01T10:00:00Z', details: { family: 'llama' } }, { name: 'bad name; rm -rf', size: 1 }] }) }) });
  const list = await reachable.request('modelsx.localList', {});
  assert.deepEqual(readLocalModels(list), { reachable: true, endpoint: 'http://127.0.0.1:11434', models: [{ name: 'llama3.2:3b', sizeBytes: 2019393189, modifiedAt: '2026-09-01T10:00:00.000Z', family: 'llama' }] });
  const unreachable = await productionEngine(t, { ollamaHttp: async () => { throw new Error('ECONNREFUSED'); } });
  const none = await unreachable.request('modelsx.localList', {});
  assert.equal((none as { words?: unknown }).words !== undefined, true, 'the engine sends its own words');
  assert.deepEqual(readLocalModels(none), { reachable: false });
  const demo = await demoEngine(t);
  assert.equal(await codeOf(demo.request('modelsx.localList', {})), 'DEMO_PROVIDER_DISABLED');
  assert.ok(R4_REFUSALS.includes('DEMO_PROVIDER_DISABLED'));
});

/* ------------------------------------------------------------------ voice.* (models-ext) */

test('voice.*: the real replies pass the ask line’s validators, and the voice controller confirms against the real engine', async t => {
  const at = Date.parse('2031-01-30T10:00:00.000Z');
  const engine = await productionEngine(t, { clock: () => at, monotonic: () => at });
  assert.ok(isVoiceStatus(await engine.request('voice.status', {})), 'voice is off: the status still validates');
  assert.equal(await codeOf(engine.request('voice.start', {})), 'VOICE_OFF');
  await engine.request('trust.update', { send: 'samples' });
  await engine.request('voice.setEnabled', { enabled: true });
  const status = await engine.request('voice.status', {});
  assert.ok(isVoiceStatus(status), JSON.stringify(status));
  const started = readVoiceStart(await engine.request('voice.start', {}));
  assert.ok(started); assert.equal(started.capture, 'browser-transcript'); assert.equal(started.capMs, null, 'the browser hold has no cap');
  const reply = await engine.request('voice.stop', { sessionId: started.sessionId, transcript: 'do lakh ka payment nahi aaya', durationMs: 3000 });
  assert.ok(isVoiceHeard(reply, started.sessionId), JSON.stringify(reply));
  const heard = reply as { heard: string; understood: { digest: string; understood: string } };
  // Sending the reading as `text` would make it an edit with another digest: the engine refuses it.
  assert.equal(await codeOf(engine.request('voice.confirm', { sessionId: started.sessionId, digest: heard.understood.digest, text: heard.understood.understood })), 'UNDERSTOOD_CHANGED');
  const confirmed = await engine.request('voice.confirm', { sessionId: started.sessionId, digest: heard.understood.digest }) as Record<string, unknown>;
  assert.ok(isVoiceConfirm(confirmed, heard.understood.digest)); assert.equal(confirmed.text, heard.heard); assert.equal(confirmed.understood, heard.understood.understood);
  const usage = await engine.request('voice.usage', {});
  assert.ok(isVoiceUsage(usage), JSON.stringify(usage));
  assert.ok(isVoiceStatus(await engine.request('voice.status', {})), 'browser minutes are "not counted" and still validate');

  // The controller itself, over the real engine: hold, words, every amount answered Yes, then Ask this.
  const capture: VoiceCapturePort = { begin: () => true, end: async () => ({ transcript: 'teen hazaar rupaye bhejo', durationMs: 2000 }), cancel: () => {} };
  const voice = createVoiceController({ request: (method, payload) => engine.request(method, payload) }, capture, null, () => 'hi');
  await voice.refresh();
  assert.equal(voice.snapshot().status.kind, 'ready');
  voice.start();
  for (let i = 0; i < 50 && voice.snapshot().phase.kind !== 'listening'; i++) await new Promise(r => setTimeout(r, 10));
  await voice.stop();
  const phase = voice.snapshot().phase;
  assert.equal(phase.kind, 'heard', JSON.stringify(phase));
  if (phase.kind !== 'heard') return;
  phase.readBacks.forEach((_, index) => voice.answer(index, true));
  assert.equal(await voice.confirm(), phase.text);
  assert.deepEqual(voice.snapshot().phase, { kind: 'idle' });

  // Read aloud: segments from a real calculator receipt.
  await engine.request('ontology.publish', { pack: 'ecommerce' });
  const csv = 'id,kind,date,amount,currency,customerId,invoiceId\ninvoice-a,invoice,2031-01-02,200000.00,INR,customer-a,invoice-a\n';
  const recipe = { version: 1, id: 'voice-test-v1', system: 'voice-csv', edition: '1', scope: { company: 'Frame Real Prod Shop', branches: ['main'] },
    bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' }, { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'currency', source: 'currency', type: 'string', nulls: 'reject' }, { target: 'customerId', source: 'customerId', type: 'string', nulls: 'omit' }, { target: 'invoiceId', source: 'invoiceId', type: 'string', nulls: 'omit' }],
    allowedKinds: ['invoice'], allowedStatuses: [], onUnmapped: 'reject' };
  await engine.request('sources.import', { sourceId: 'voice-export', format: 'csv', content: csv, recipe, expectedTotals: { rowCount: 1, amountMinor: '20000000' } });
  const receipt = await engine.request('calculation.run', { operation: 'billed', period: { from: '2031-01-01', to: '2031-01-31' } }) as { id: string };
  const spoken = readVoiceSpeak(await engine.request('voice.speak', { receiptId: receipt.id, language: 'en' }));
  assert.ok(spoken && spoken.segments.length > 0);
  assert.deepEqual(await engine.request('voice.stopSpeaking', { utteranceId: spoken.utteranceId }), { stopped: true });
});

/* ------------------------------------------------------------------ session.status / session.stop (driving) */

/** One synthetic window whose picture waits until the test lets it go, or fails. */
class HeldDriver implements DesktopDriver {
  readonly platform = 'fake' as const;
  release: (() => void) | null = null; fail: ((error: Error) => void) | null = null;
  async available() { return { ok: true as const }; }
  async listWindows() { return [{ id: '0x1', title: 'Synthetic Books Ledger', app: 'synthbooks', pid: 11 }]; }
  async windowInfo(id: string) { return id === '0x1' ? { id, title: 'Synthetic Books Ledger', app: 'synthbooks', pid: 11 } : null; }
  async related() { return []; }
  focusId: string | null = null;
  async focus(id: string) { this.focusId = id; }
  async focused(): Promise<FocusInfo> { return { windowId: this.focusId, secret: false }; }
  async press(_chord: Chord) {}
  async typeFileName() {}
  async snapshot(): Promise<{ width: number; height: number; png: Buffer }> { return new Promise((_resolve, reject) => { this.fail = reject; }); }
  async watch(_on: (a: Activity) => void) { return { close: () => {} }; }
  async close() {}
}

test('session.status / session.stop: the driving banner and tray Stop follow the real states; a failed step has ended the session', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ft-drive-'));
  const driver = new HeldDriver();
  const controller = new DrivingController({ driver, exportRoot: join(directory, 'driving-exports'), plans: BUILT_IN_PLANS, pollMs: 20, startGraceMs: 0, searchFolders: [] });
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file', modules: { driving: { controller, allowDemo: true } } } as never);
  t.after(async () => { controller.stop(); await controller.settled().catch(() => {}); await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Books', passphrase, demo: false, pack: 'retail', folder: 'main' });
  const banners = async () => { const shell = await engine.request('todayx.shell', {}); assert.ok(isShellReply(shell), JSON.stringify(shell)); return (shell as unknown as { banners: { kind: string }[] }).banners; };
  assert.deepEqual((await banners()).filter(b => b.kind === 'driving'), []);

  await engine.request('session.start', { windowId: '0x1', mode: 'read-export', typesSecrets: false });
  for (let i = 0; i < 100 && driver.fail === null; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal((await engine.request('session.status', {}) as { state: string }).state, 'driving');
  assert.deepEqual((await banners()).filter(b => b.kind === 'driving'), [{ kind: 'driving', program: 'Synthetic Books Ledger' }]);
  const stopped = await engine.request('session.stop', {}) as { state: string };
  assert.equal(stopped.state, 'stopped');
  assert.deepEqual((await banners()).filter(b => b.kind === 'driving'), [], 'Stop ends the banner');

  // A step that fails ends the session: the last status says step-failed, and no banner (or tray Stop) shows.
  driver.fail = null;
  await engine.request('session.start', { windowId: '0x1', mode: 'read-export', typesSecrets: false });
  for (let i = 0; i < 100 && driver.fail === null; i++) await new Promise(r => setTimeout(r, 10));
  driver.fail!(Object.assign(new Error('Synthetic driver failure'), { code: 'DRIVER_FAILED' }));
  await controller.settled().catch(() => {});
  assert.equal((await engine.request('session.status', {}) as { state: string }).state, 'step-failed');
  assert.deepEqual((await banners()).filter(b => b.kind === 'driving'), []);
});

/* ------------------------------------------------------------------ release.status, approvals.afterRestore, hosted.recovery.* */

test('release.status, approvals.afterRestore and hosted.recovery.* as served: the shell, updates and recovery screens read them as built', async t => {
  const engine = await demoEngine(t);
  const release = await engine.request('release.status', {}) as Record<string, unknown>;
  assert.equal(release.configured, false); assert.equal(release.vaultCompatible, true);
  const updates = await engine.request('todayx.updates', {});
  assert.ok(isUpdatesReply(updates)); assert.equal((updates as { state: string }).state, 'not-configured');
  const restore = await engine.request('approvals.afterRestore', {}) as Record<string, unknown>;
  assert.deepEqual(Object.keys(restore).sort(), ['items', 'noteKeys', 'notes', 'sendingClosed']);
  assert.equal(restore.sendingClosed, false);
  const shell = await engine.request('todayx.shell', {});
  assert.ok(isShellReply(shell));
  assert.deepEqual((shell as unknown as { banners: { kind: string }[] }).banners.filter(b => ['sending-closed', 'update-needed', 'no-connection'].includes(b.kind)), []);
  // hosted.recovery.*: before a vault, in a demo engine, the refusal is one the lock screen names.
  await engine.request('workspace.lock', {});
  const refused = await codeOf(engine.request('hosted.recovery.request', { folder: 'main' }));
  assert.ok(HOSTED_RECOVERY_REFUSALS.includes(refused as never), String(refused));
});

test('models.setLadder, models.probe, workspace.pin.* and network.online are really absent, so their screens keep "not built yet"', async t => {
  const engine = await demoEngine(t);
  for (const [method, payload] of [['models.setLadder', { routeIds: [] }], ['models.probe', { routeId: 'route_a' }], ['workspace.pin.status', {}], ['workspace.pin.unlock', { folder: 'main', pin: '1234' }],
    ['workspace.pin.set', { pin: '1234', passphrase }], ['workspace.pin.remove', {}], ['network.online', {}]] as const) {
    assert.equal(await codeOf(engine.request(method, payload)), 'UNKNOWN_METHOD', method);
  }
});
