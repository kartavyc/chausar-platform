import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, readFile, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createWorkerEngine } from '../runtime/worker.ts';
import type { Engine } from '../runtime/engine.ts';
import { createHostController } from '../../app/ui/src/host/controller.ts';
import type { HostRpcPort } from '../../app/ui/src/host/contracts.ts';
import type { TodayStatEvidence } from '../../app/ui/src/bridge/today-host.ts';
import type { TodayView } from '../../app/ui/src/bridge/presentation.ts';
import { handoffPinOf } from '../../app/ui/src/screens/first-run/controller.ts';
import { pinOf } from '../../app/ui/src/screens/first-run/review.ts';

const mainUrl = new URL('../../app/desktop/main.cjs', import.meta.url);
const mainRequire = createRequire(mainUrl);
const ipc = mainRequire('./ipc-contract.cjs');
const seedFailureMarker = 'SYNTHETIC_PRIVATE_MATERIAL_NEVER_LOG';
const flush = () => new Promise<void>(accept => setImmediate(accept));
function latch() {
  let release!: () => void; const promise = new Promise<void>(accept => { release = accept; });
  return { promise, release };
}
type FixtureOptions = { args?: string[]; preview?: boolean; packaged?: boolean; production?: boolean;
  createGate?: ReturnType<typeof latch>; createFailure?: boolean; existingLocked?: boolean; reuseProfile?: boolean;
  statusReply?: Record<string, unknown> };

/** Actual main/Engine/controller composition; Electron is a recording boundary.
 * No Electron, worker process, SQL/native helper, model, vendor, or credential store runs. */
async function fixture(t: TestContext, options: FixtureOptions = {}) {
  const temporary = await realpath(tmpdir());
  if (process.platform === 'win32') assert.match(temporary, /^C:\\/i);
  const profileRoot = join(temporary, 'chausar-ui-bootstrap-' + randomUUID());
  const logicalDefault = join(temporary, 'synthetic-unread-default-profile');
  const args = options.args ?? ['--demo', '--ui-preview'];
  const metadata = { version: '2.3.4', chausarPreview: options.preview ?? true };
  const environment = { CHAUSAR_DEMO_PROFILE_ROOT: profileRoot,
    CHAUSAR_VAULT_DIRECTORY: join(logicalDefault, 'must-not-be-used'),
    CHAUSAR_KEYCHAIN_MANIFEST: join(logicalDefault, 'must-not-be-read', 'manifest.json'),
    ...(options.production ? { CHAUSAR_POSTGRES_URL: 'postgresql://synthetic.invalid/no-connection' } : {}) };
  const windows: any[] = [], harnesses: Harness[] = [], errors: string[] = [], diagnostics: string[] = [];
  const handlers = new Map<string, any>(), completed: string[] = [], pathReads: { name: string; bound: boolean }[] = [];
  const paths: Record<string, string> = { userData: logicalDefault, sessionData: logicalDefault };
  const bound = new Set<string>(), createEntered = latch(), stopped = latch();
  let readyTask: Promise<unknown> = Promise.resolve(), modelCalls = 0, credentialReads = 0, instanceLockCalls = 0;
  if (options.reuseProfile) await mkdir(profileRoot, { mode: 0o700 });
  const app = new EventEmitter() as any;
  app.isPackaged = options.packaged ?? true; app.quits = 0;
  app.getName = () => 'SyntheticChausar';
  app.commandLine = { hasSwitch: (name: string) => args.some(value => value === '--' + name || value.startsWith('--' + name + '=')) };
  app.getPath = (name: string) => {
    pathReads.push({ name, bound: bound.has(name) });
    if (name === 'appData') return join(temporary, 'synthetic-unread-app-data');
    if (!options.production && !bound.has(name)) throw new Error('Unbound real-profile fallback is forbidden.');
    return paths[name];
  };
  app.setPath = (name: string, path: string) => { paths[name] = path; bound.add(name); };
  app.requestSingleInstanceLock = () => { instanceLockCalls++; return true; };
  app.whenReady = () => ({ then(callback: () => Promise<unknown>) { readyTask = Promise.resolve().then(callback); return readyTask; } });
  app.quit = () => { app.quits++; stopped.release(); };
  class Window extends EventEmitter {
    options: any; webContents: any; workspaceReadyAtConstruction: boolean; demoFactsAtConstruction: number; bootstrapCompleted: string[];
    constructor(config: any) {
      super(); this.options = config;
      this.workspaceReadyAtConstruction = !!harnesses[0]?.actual?.vault?.read().workspace.demo;
      this.demoFactsAtConstruction = harnesses[0]?.actual?.vault?.read().facts.filter(fact => fact.sourceId === 'demo-export').length ?? 0;
      this.bootstrapCompleted = [...completed];
      this.webContents = new EventEmitter(); this.webContents.mainFrame = { url: 'chausar://app/index.html' };
      this.webContents.setWindowOpenHandler = (handler: any) => { this.webContents.open = handler; };
      this.webContents.send = () => {}; windows.push(this);
    }
    loadURL(url: string) { this.webContents.mainFrame.url = url; }
    show() {} focus() {} restore() {} isMinimized() { return false; } isDestroyed() { return false; } isVisible() { return true; }
  }
  class Harness extends EventEmitter {
    state = 'starting'; actual?: Engine; options: any; stops = 0; stopFinished = latch(); requests: { method: string; payload: any }[] = [];
    constructor(config: any) { super(); this.options = config; harnesses.push(this); }
    async start() {
      if (!options.production) {
        assert.equal(this.options.environment.CHAUSAR_DEMO, '1');
        assert.equal(this.options.environment.CHAUSAR_KEYCHAIN_MANIFEST, undefined);
        assert.equal(this.options.environment.CHAUSAR_VAULT_DIRECTORY, join(profileRoot, 'userData', 'vaults'));
        this.actual = await createWorkerEngine(this.options.environment, {
          readKeychainManifest: async () => { credentialReads++; throw new Error('No credential manifest may be read.'); },
        });
        this.actual.options.gateway = { http: async () => { modelCalls++; throw new Error('No model or vendor call is admitted.'); } };
        if (options.existingLocked) {
          await this.actual.request('workspace.create', { name: 'Retained synthetic workspace', folder: 'main', demo: true, passphrase: 'synthetic-existing-passphrase' });
          await this.actual.request('workspace.lock', {});
        }
      }
      this.state = 'ready';
    }
    async request(method: string, payload: any = {}) {
      // The installed Harness crosses a process/JSON boundary; retain that canonical form.
      const canonical = JSON.parse(JSON.stringify(payload)); this.requests.push({ method, payload: canonical });
      if (method === 'workspace.create') {
        createEntered.release();
        if (options.createGate) await options.createGate.promise;
        if (options.createFailure) throw Object.assign(new Error(`${seedFailureMarker}; key=${canonical.passphrase}; path=${profileRoot}`), { code: 'EACCES' });
      }
      if (method === 'workspace.status' && options.statusReply !== undefined) {
        completed.push(method); return structuredClone(options.statusReply);
      }
      const result = this.actual ? await this.actual.request(method, canonical) : { open: false, experimental: false };
      completed.push(method); return result;
    }
    async updateJobLifecycle(state: any) { this.actual?.updateJobLifecycle(JSON.parse(JSON.stringify(state))); return { applied: true }; }
    async stop() { this.stops++; await this.actual?.shutdown(5000); this.state = 'stopped'; this.stopFinished.release(); return { graceful: true, forced: false }; }
  }
  const profileModule = { exports: {} as any };
  vm.runInNewContext(await readFile(new URL('../../app/desktop/demo-profile.cjs', import.meta.url), 'utf8'), {
    module: profileModule, process: { env: environment }, require: mainRequire,
  });
  const session = { defaultSession: { setPermissionRequestHandler() {}, setPermissionCheckHandler() {}, webRequest: { onBeforeRequest() {} } } };
  const electron = { app, BrowserWindow: Window, powerMonitor: new EventEmitter(), session,
    protocol: { registerSchemesAsPrivileged() {}, handle() {} },
    dialog: { showErrorBox: (_title: string, message: string) => errors.push(message) },
    ipcMain: { handle: (channel: string, handler: any) => handlers.set(channel, handler) },
  };
  const context = vm.createContext({ __dirname: dirname(fileURLToPath(mainUrl)),
    Date,
    process: { argv: app.isPackaged ? ['synthetic-packaged-executable', ...args] : ['electron', 'synthetic-app', ...args], env: environment, platform: process.platform, resourcesPath: join(temporary, 'synthetic-unread-resources') },
    console: { error: (message: string) => diagnostics.push(message) }, URL, Response, Buffer,
    require: (name: string) => {
      if (name === 'electron') return electron;
      if (name === './engine-harness.cjs') return { EngineHarness: Harness };
      if (name === './demo-profile.cjs') return profileModule.exports;
      if (name === '../../package.json') return metadata;
      if (name === 'node:fs/promises') return {
        readFile: async (path: string) => { assert.equal(path, resolve(fileURLToPath(mainUrl), '../../..', 'package.json')); return JSON.stringify(metadata); },
        mkdir: async () => { throw new Error('Native storage creation is forbidden.'); },
        writeFile: async () => { throw new Error('Native credential writes are forbidden.'); },
        lstat: async () => { throw new Error('Native credential inspection is forbidden.'); },
      };
      return mainRequire(name);
    },
  });
  vm.runInContext(await readFile(mainUrl, 'utf8'), context);
  t.after(async () => {
    options.createGate?.release(); await readyTask;
    if (!vm.runInContext('stopping', context)) app.emit('before-quit', { preventDefault() {} });
    for (const harness of harnesses) await harness.stopFinished.promise;
    await flush();
    try {
      const info = await lstat(profileRoot), actual = await realpath(profileRoot), child = relative(temporary, actual);
      assert.ok(info.isDirectory() && !info.isSymbolicLink() && resolve(actual) === resolve(profileRoot));
      assert.ok(child && !isAbsolute(child) && !child.startsWith('..') && dirname(actual) === temporary);
      await rm(actual, { recursive: true, force: true });
    } catch (error: any) { if (error.code !== 'ENOENT') throw error; }
  });
  async function rpc(method: string, payload: any = {}) {
    const window = windows.at(-1); assert.ok(window, 'A trusted fake window must exist for desktop IPC.');
    const response = await handlers.get(ipc.REQUEST_CHANNEL)({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { method, payload });
    if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
    return response.result;
  }
  return { app, windows, harnesses, handlers, errors, diagnostics, pathReads, paths, profileRoot, ready: () => readyTask,
    createEntered: createEntered.promise, stopped: stopped.promise, rpc, calls: () => ({ modelCalls, credentialReads }),
    instanceLockCalls: () => instanceLockCalls,
    navigateLegacy() { const window = windows.at(-1); assert.ok(window); let prevented = false;
      window.webContents.emit('will-navigate', { preventDefault() { prevented = true; } }, 'chausar://app/index.html');
      assert.equal(prevented, false); window.webContents.mainFrame.url = 'chausar://app/index.html';
      // Electron commits the navigation with did-navigate; only then does main trust the legacy document.
      window.webContents.emit('did-navigate', {}, 'chausar://app/index.html'); },
  };
}

test('fresh packaged UI has an actual synthetic workspace before window construction and usable trusted receipts', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-30T12:00:00Z') });
  const d = await fixture(t); await d.ready();
  assert.deepEqual(d.errors, []); assert.equal(d.windows.length, 1);
  assert.equal(d.windows[0].workspaceReadyAtConstruction, true, 'Fresh preview window opened before a synthetic workspace was ready.');
  assert.ok(d.windows[0].demoFactsAtConstruction > 0, 'Synthetic imported evidence must be retained before window construction.');
  assert.ok(d.windows[0].bootstrapCompleted.includes('ui.context'), 'Actual UI context must succeed before window construction.');
  const creates = d.harnesses[0].requests.filter(request => request.method === 'workspace.create');
  assert.equal(creates.length, 1); assert.equal(creates[0].payload.demo, true); assert.equal(creates[0].payload.folder, 'main');
  assert.equal(creates[0].payload.pack, 'ecommerce'); assert.match(creates[0].payload.passphrase, /^[A-Za-z0-9_-]{43}$/);
  const controller = createHostController({ request: d.rpc } as HostRpcPort, { now: () => Date.parse('2026-09-30T12:00:00Z'), timeZone: 'UTC',
    dashboard: { title: 'Today', date: '2026-09-30', request: { period: { from: '2026-09-01', to: '2026-09-30' } },
      selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] } });
  t.after(() => controller.dispose()); await controller.refresh();
  const state = controller.snapshot(); assert.equal(state.phase, 'ready', state.code); assert.equal(state.context?.workspace.demo, true);
  assert.ok(state.today); assert.equal(state.today.receipts.length, 4); assert.equal(state.selectedRouteId, null);
  const billed = state.today.today.stats.find(stat => stat.id === 'billed:total'); assert.ok(billed);
  assert.equal(billed.figure.kind, 'money');
  if (billed.figure.kind !== 'money') assert.fail('The unchanged September sample must remain displayable.');
  assert.equal(billed.figure.paise, '300000');
  const receipt = state.today.receipts[0]!; await controller.openReceipt(receipt.id, { place: 'today', sub: 'today', sheet: receipt.id });
  assert.equal(controller.snapshot().receipt?.kind, 'ready');
  assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
  assert.equal(d.pathReads.some(read => ['userData', 'sessionData'].includes(read.name) && !read.bound), false);
});

test('current-month packaged preview displays authored demo figures and fresh receipts while retaining honest Today gaps', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-04T12:00:00Z') });
  const d = await fixture(t); await d.ready();
  assert.deepEqual(d.errors, []);
  assert.ok(d.windows[0].demoFactsAtConstruction > 0, 'The calendar regression must not be a missing-seed failure.');
  const controller = createHostController({ request: d.rpc } as HostRpcPort, { timeZone: 'UTC',
    dashboard: { title: 'Today', date: '2026-10-04', request: { period: { from: '2026-10-01', to: '2026-10-31' } },
      selections: [{ operation: 'billed', figureKey: 'total' }, { operation: 'received', figureKey: 'total' }, { operation: 'margin', figureKey: 'contribution' }] } });
  t.after(() => controller.dispose()); await controller.refresh();
  const state = controller.snapshot();
  assert.equal(state.phase, 'ready', state.code); assert.ok(state.today);
  for (const [id, paise] of [['billed:total', '300000'], ['received:total', '260000'], ['margin:contribution', '130000']] as const) {
    const stat: TodayView['stats'][number] | undefined = state.today.today.stats.find(item => item.id === id);
    assert.ok(stat, `Missing current-month ${id}`);
    assert.equal(stat.figure.kind, 'money', `${id} must display the authored sample amount rather than an empty-period unknown`);
    if (stat.figure.kind !== 'money') assert.fail('The authored sample figure was unavailable.');
    assert.equal(stat.figure.paise, paise);
    const evidence: TodayStatEvidence | undefined = state.today.statsEvidence.find(item => item.statId === id);
    assert.ok(evidence); assert.deepEqual(evidence.scope.period, { from: '2026-10-01', to: '2026-10-31' });
    assert.ok(d.harnesses[0].requests.some(request => request.method === 'receipts.get' && request.payload.id === evidence.receiptId));
  }
  assert.deepEqual(state.today.today.state, { kind: 'partial', asOf: null, reasonCode: 'TODAY_ENGINE_CONTRACT_PARTIAL' });
  assert.equal(state.today.today.pendingCount, null);
  assert.deepEqual(state.today.today.attention, []); assert.deepEqual(state.today.today.worthLook, []); assert.deepEqual(state.today.today.dayEvents, []);
  assert.ok(state.today.today.stats.every(stat => stat.chart === null));
  const receipt = state.today.receipts.find(item => item.operation === 'billed'); assert.ok(receipt);
  await controller.openReceipt(receipt.id, { place: 'today', sub: 'today', sheet: receipt.id });
  assert.equal(controller.snapshot().receipt?.kind, 'ready');
  assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
});

test('explicit packaged first-run preview leaves creation to the host and admits only a reviewed dictionary with Today pending', { timeout: 20000 }, async t => {
  const d = await fixture(t, { args: ['--demo', '--ui-preview', '--first-run-preview'] }); await d.ready();
  assert.deepEqual(d.errors, []); assert.equal(d.windows.length, 1);
  assert.equal(d.windows[0].webContents.mainFrame.url, 'chausar://app/ui/index.html');
  assert.equal(d.windows[0].workspaceReadyAtConstruction, false); assert.equal(d.windows[0].demoFactsAtConstruction, 0);
  assert.deepEqual(d.harnesses[0].requests.map(request => request.method), ['workspace.status'], 'Fresh experimental storage must be checked before the first-run window opens.');
  assert.equal(d.harnesses[0].actual!.vault, null);
  const controller = createHostController({ request: d.rpc } as HostRpcPort, { todayProducer: {}, firstRun: {
    digest: async text => createHash('sha256').update(text).digest('hex'), createAttemptId: () => 'packaged-reviewed-first-run-attempt',
  } });
  t.after(() => { controller.dispose(); }); await controller.refresh();
  assert.equal(controller.snapshot().phase, 'locked'); assert.equal(controller.snapshot().today, null);
  await controller.createWorkspace({ name: 'SYNTHETIC reviewed preview', folder: 'reviewed', passphrase: 'synthetic-preview-passphrase' });
  const creates = d.harnesses[0].requests.filter(request => request.method === 'workspace.create');
  assert.deepEqual(creates.map(request => request.payload), [{ name: 'SYNTHETIC reviewed preview', folder: 'reviewed',
    passphrase: 'synthetic-preview-passphrase', dictionaryMode: 'deferred', demo: false }]);
  assert.equal(Object.hasOwn(creates[0].payload, 'pack'), false); assert.equal(Object.hasOwn(creates[0].payload, 'demoFixtureMonth'), false);
  const created = controller.snapshot().creation; if (created.kind !== 'recovery-required') assert.fail('The host must retain the sole recovery kit for acknowledgement.');
  assert.equal(d.harnesses[0].actual!.vault!.read().ontology.current, null);
  assert.equal(d.harnesses[0].actual!.vault!.read().facts.length, 0);
  assert.equal(await controller.acknowledgeRecovery(created.value), true);
  assert.equal(controller.snapshot().creation.kind, 'idle'); assert.equal(controller.snapshot().dictionaryReviewRequired, true);
  assert.equal(JSON.stringify(controller.snapshot()).includes(created.value.recoveryKit), false);
  controller.setFirstRunSurface(() => true);
  assert.deepEqual(await controller.firstRun.load(), { ok: true });
  assert.deepEqual(controller.firstRun.choosePack('ecommerce'), { ok: true });
  for (let tick = 0; tick < 32; tick++) await Promise.resolve();
  let shown = controller.firstRun.snapshot(); if (shown.kind !== 'review') assert.fail('The actual starter must produce a checked review.');
  for (const name of shown.review.rows.map(row => row.definition.name)) {
    shown = controller.firstRun.snapshot(); if (shown.kind !== 'review') assert.fail('The checked review must remain current.');
    const pin = pinOf(shown.review); assert.ok(pin);
    assert.deepEqual(controller.firstRun.acceptRow(name, pin), { ok: true });
  }
  shown = controller.firstRun.snapshot(); if (shown.kind !== 'review') assert.fail('The exact settings review must remain current.');
  let pin = pinOf(shown.review); assert.ok(pin); assert.deepEqual(controller.firstRun.acceptSettings(pin), { ok: true });
  shown = controller.firstRun.snapshot(); if (shown.kind !== 'review') assert.fail('The accepted review must remain current.');
  pin = pinOf(shown.review); assert.ok(pin); assert.deepEqual(await controller.firstRun.publishDictionary(pin), { ok: true });
  const published = controller.firstRun.snapshot(); if (published.kind !== 'published') assert.fail('Publication must be attributed and verified before Continue.');
  assert.equal(d.harnesses[0].actual!.vault!.read().ontology.current!.hash, published.published.hash);
  const left = await controller.firstRun.leave(handoffPinOf(published)); if (!left.ok) assert.fail('The exact published authority must admit Continue.');
  const handoff = left.admit(); assert.ok(handoff); assert.equal(controller.completeFirstRun(handoff), true); assert.equal(left.admit(), null);
  await controller.refreshToday();
  assert.equal(controller.snapshot().phase, 'ready'); assert.equal(controller.snapshot().dictionaryReviewRequired, false);
  assert.equal(controller.snapshot().todayConfiguration, 'not-configured'); assert.equal(controller.snapshot().today, null); assert.equal(controller.todayConsumer, null);
  const methods = d.harnesses[0].requests.map(request => request.method);
  assert.equal(methods.filter(method => method === 'workspace.create').length, 1); assert.equal(methods.filter(method => method === 'ontology.publish').length, 1);
  assert.equal(methods.some(method => ['today.get', 'dashboard.get', 'calculation.run', 'receipts.get', 'sources.commitImport'].includes(method)), false);
  assert.deepEqual(controller.dispose(), { ok: true }); d.navigateLegacy();
  const period = { from: '2026-10-01', to: '2026-10-31' };
  const receipt = await d.rpc('calculation.run', { operation: 'billed', period });
  assert.equal(receipt.operation, 'billed'); assert.deepEqual(receipt.period, period);
  assert.equal(receipt.dictionaryHash, published.published.hash); assert.equal(receipt.ontologyVersion, published.published.version);
  assert.equal(receipt.valueMinor, '0'); assert.equal(receipt.totalMinor, '0'); assert.deepEqual(receipt.rows, []);
  assert.deepEqual(receipt.coverage, { selectedRows: 0, countedRows: 0, excludedRows: 0, unresolvedConflicts: 0, importIds: [],
    completeness: 'empty', gaps: ['No visible facts were counted. An empty selection is not proof that the business activity was zero.'], notCounted: 0 });
  assert.deepEqual(await d.rpc('receipts.get', { id: receipt.id }), receipt);
  assert.equal(d.harnesses[0].requests.filter(request => request.method === 'calculation.run').length, 1);
  assert.equal(d.harnesses[0].requests.filter(request => request.method === 'receipts.get').length, 1);
  assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
  assert.equal(d.pathReads.some(read => ['userData', 'sessionData'].includes(read.name) && !read.bound), false);
});

test('explicit first-run packaged argv refuses unsupported modes, duplicate flags and extra inputs before profile or instance setup', async t => {
  const valid = ['--demo', '--ui-preview', '--first-run-preview'];
  const refusals: FixtureOptions[] = [
    { args: ['--first-run-preview'] }, { args: ['--demo', '--first-run-preview'] }, { args: ['--ui-preview', '--first-run-preview'] },
    { args: ['--production', '--ui-preview', '--first-run-preview'] }, { args: [...valid, '--production'] },
    { args: [...valid, '--first-run-preview'] }, { args: [...valid, '--demo'] }, { args: [...valid, '--ui-preview'] },
    { args: [...valid, '--background', '--background'] }, { args: [...valid, '--no-sandbox'] },
    { args: [...valid, '--production=false'] }, { args: [...valid, 'synthetic-extra-document'] },
    { args: ['--demo', '--ui-preview', '--first-run-preview=false'] }, { args: valid, packaged: false }, { args: valid, preview: false },
  ];
  for (const options of refusals) {
    const d = await fixture(t, options); await d.ready();
    assert.equal(d.errors.length, 1, JSON.stringify(options)); assert.equal(d.app.quits, 1);
    assert.equal(d.instanceLockCalls(), 0); assert.deepEqual(d.pathReads, []);
    assert.equal(d.harnesses.length, 0); assert.equal(d.windows.length, 0);
    await assert.rejects(lstat(d.profileRoot), { code: 'ENOENT' });
    assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
  }
});

test('explicit first-run preview still refuses an open or nonexperimental storage status before any window or creation', async t => {
  for (const statusReply of [{ open: true, experimental: true, storage: 'experimental-file' },
    { open: false, experimental: false, storage: 'experimental-file' }, { open: false, experimental: true, storage: 'postgres' }]) {
    const d = await fixture(t, { args: ['--demo', '--ui-preview', '--first-run-preview'], statusReply }); await d.ready();
    assert.equal(d.errors.length, 1); assert.equal(d.windows.length, 0); assert.equal(d.app.quits, 1);
    assert.deepEqual(d.harnesses[0].requests.map(request => request.method), ['workspace.status']);
    assert.ok(d.diagnostics.includes('Chausar preview workspace bootstrap failed: method=workspace.status; code=PREVIEW_WORKSPACE_STATE'));
    assert.equal(d.harnesses[0].actual!.vault, null); assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
  }
});

test('unpackaged UI, legacy demo and production never automatically seed a workspace', async t => {
  for (const options of [{ packaged: false }, { args: ['--demo'] }, { preview: false, production: true, args: ['--production', '--ui-preview'] }]) {
    const d = await fixture(t, options); await d.ready();
    assert.deepEqual(d.errors, []); assert.equal(d.windows.length, 1);
    assert.equal(d.harnesses[0].requests.some(request => request.method === 'workspace.create'), false);
    assert.equal(d.windows[0].workspaceReadyAtConstruction, false);
    if (options.production) {
      assert.equal(d.harnesses[0].actual, undefined);
      assert.equal(d.harnesses[0].options.environment.CHAUSAR_DEMO, '0');
    } else assert.equal((await d.rpc('workspace.status')).open, false);
    assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
  }
});

test('ordinary UI preserves an existing locked workspace and its trusted return to legacy', async t => {
  const d = await fixture(t, { preview: false, existingLocked: true }); await d.ready();
  assert.deepEqual(d.errors, []); assert.equal(d.windows.length, 1);
  assert.equal(d.harnesses[0].requests.some(request => request.method === 'workspace.create'), false);
  const controller = createHostController({ request: d.rpc } as HostRpcPort);
  t.after(() => controller.dispose()); await controller.refresh();
  assert.equal(controller.snapshot().phase, 'locked'); assert.equal(controller.snapshot().today, null);
  d.navigateLegacy();
  assert.equal((await d.rpc('workspace.status')).open, false);
  await d.rpc('workspace.open', { folder: 'main', passphrase: 'synthetic-existing-passphrase' });
  assert.equal((await d.rpc('workspace.status')).workspace.name, 'Retained synthetic workspace');
  assert.equal(d.windows[0].webContents.mainFrame.url, 'chausar://app/index.html');
  assert.deepEqual(d.calls(), { modelCalls: 0, credentialReads: 0 });
});

test('seed failure refuses every window path without recovery or retry', async t => {
  const d = await fixture(t, { createFailure: true }); await d.ready();
  assert.equal(d.windows.length, 0); assert.equal(d.errors.length, 1); assert.equal(d.app.quits, 1);
  const requests = d.harnesses[0].requests;
  assert.equal(requests.filter(request => request.method === 'workspace.create').length, 1);
  assert.equal(requests.some(request => ['workspace.open', 'workspace.recover', 'workspace.delete'].includes(request.method)), false);
  d.app.emit('activate'); d.app.emit('second-instance'); await flush(); assert.equal(d.windows.length, 0);
  assert.ok(d.diagnostics.length > 0);
  assert.ok(d.diagnostics.includes('Chausar preview workspace bootstrap failed: method=workspace.create; code=EACCES'));
  d.app.emit('before-quit', { preventDefault() {} }); await d.harnesses[0].stopFinished.promise; await flush();
  assert.equal(d.harnesses[0].stops, 1);
  const publicMessages = [...d.diagnostics, ...d.errors].join('\n');
  const failedCreate = requests.find(request => request.method === 'workspace.create')!;
  for (const privateValue of [seedFailureMarker, failedCreate.payload.passphrase, d.profileRoot]) assert.equal(publicMessages.includes(privateValue), false);
  assert.equal(d.harnesses[0].actual!.vault, null);
});

test('pending seed blocks activate and second-instance until startup is complete', async t => {
  const gate = latch(), d = await fixture(t, { createGate: gate }); await d.createEntered;
  assert.equal(d.windows.length, 0);
  d.app.emit('activate'); d.app.emit('second-instance'); await flush(); assert.equal(d.windows.length, 0);
  gate.release(); await d.ready();
  assert.equal(d.windows.length, 1); assert.equal(d.windows[0].workspaceReadyAtConstruction, true);
  d.windows[0].emit('closed'); d.app.emit('activate'); await flush();
  assert.equal(d.windows.length, 2);
  assert.equal(d.harnesses[0].requests.filter(request => request.method === 'workspace.create').length, 1);
});

test('quit during pending seed drains exactly once and never publishes a late window', async t => {
  const gate = latch(), d = await fixture(t, { createGate: gate }); await d.createEntered;
  let prevented = false; d.app.emit('before-quit', { preventDefault() { prevented = true; } });
  d.app.emit('activate'); d.app.emit('second-instance'); await flush();
  assert.equal(prevented, true); assert.equal(d.app.quits, 0); assert.equal(d.windows.length, 0); assert.equal(d.harnesses[0].stops, 0);
  gate.release(); await d.ready(); await d.stopped;
  assert.equal(d.harnesses[0].stops, 1); assert.equal(d.harnesses[0].state, 'stopped'); assert.equal(d.harnesses[0].actual!.vault, null);
  d.app.emit('activate'); d.app.emit('second-instance'); await flush();
  assert.equal(d.windows.length, 0); assert.equal(d.errors.length, 0);
});

test('occupied synthetic workspace is retained when a fresh packaged bootstrap cannot create main', async t => {
  const d = await fixture(t, { existingLocked: true }); await d.ready();
  assert.equal(d.windows.length, 0); assert.equal(d.errors.length, 1);
  assert.equal(d.harnesses[0].requests.filter(request => request.method === 'workspace.create').length, 1);
  assert.equal(d.harnesses[0].requests.some(request => ['workspace.open', 'workspace.recover', 'workspace.delete'].includes(request.method)), false);
  await d.harnesses[0].actual!.request('workspace.open', { folder: 'main', passphrase: 'synthetic-existing-passphrase' });
  assert.equal((await d.harnesses[0].actual!.request('workspace.status')).workspace.name, 'Retained synthetic workspace');
});

test('reused profiles and explicit user-data-dir cannot fall back to a real profile or start an Engine', async t => {
  for (const options of [{ reuseProfile: true }, { args: ['--demo', '--ui-preview', '--user-data-dir=synthetic-unowned-profile'] },
    { reuseProfile: true, args: ['--demo', '--ui-preview', '--first-run-preview'] },
    { args: ['--demo', '--ui-preview', '--first-run-preview', '--user-data-dir=synthetic-unowned-profile'] }]) {
    const d = await fixture(t, options); await d.ready();
    assert.equal(d.errors.length, 1); assert.equal(d.app.quits, 1); assert.equal(d.harnesses.length, 0); assert.equal(d.windows.length, 0);
    assert.equal(d.pathReads.some(read => ['userData', 'sessionData'].includes(read.name) && !read.bound), false);
  }
});
