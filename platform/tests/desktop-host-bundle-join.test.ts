import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createContext, runInContext, SourceTextModule, SyntheticModule } from 'node:vm';
import type { Context } from 'node:vm';

const bundleUrl = new URL('../../app/ui/public/host.js', import.meta.url);
const shellUrl = new URL('../../app/ui/host/shell.js', import.meta.url);
const bundleSource = await readFile(bundleUrl, 'utf8');
const shellSource = await readFile(shellUrl, 'utf8');
interface RequestPort { request(method: string, payload?: unknown): Promise<unknown> }
interface Controller {
  refresh(): Promise<void>;
  snapshot(): { phase: string; code?: string; context: unknown; today: unknown; receipt: unknown; routes: readonly unknown[] };
  dispose(): void;
}
interface BundleExports {
  createDesktopRequestPort(bridge: { requestEnvelope(method: string, payload?: unknown): Promise<unknown> }): RequestPort;
  createHostController(port: RequestPort, options?: { timeZone?: string; todayProducer?: object }): Controller;
  mountHost: (...args: unknown[]) => unknown;
  createShellPort(desktop: unknown, browser: null): { openExternal(url: string): Promise<string>; print(kind: string): Promise<void> };
}
async function loadActualBundle(context: Context = createContext({})) {
  const module = new SourceTextModule(bundleSource, { context, identifier: bundleUrl.href });
  await module.link(specifier => { throw new Error(`Actual browser artifact must be self-contained: ${specifier}`); });
  await module.evaluate({ timeout: 5_000 });
  const namespace = module.namespace as unknown as Record<string, unknown>;
  for (const name of ['createDesktopRequestPort', 'createHostController', 'createShellPort', 'mountHost']) assert.equal(typeof namespace[name], 'function', name);
  return { context, exports: namespace as unknown as BundleExports };
}
function contextCopy(context: Context, value: unknown): unknown {
  if (value === undefined) return undefined;
  const parse = runInContext('(text) => JSON.parse(text)', context) as (text: string) => unknown;
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Only synthetic JSON bridge data may be copied into this fixture.');
  return parse(encoded);
}
function ordinary(value: unknown): unknown {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Expected synthetic JSON fixture data.');
  return JSON.parse(encoded);
}

// Only the controller and mount/DOM boundary are replaced in the shell import.
// Its desktop adapter is the actual export from the evaluated canonical artifact.
async function shellFixture(protocol: 'chausar:' | 'https:', token: string | null = 'synthetic-token', legacy = true) {
  const actual = await loadActualBundle();
  const context = actual.context;
  const calls: { method: string; payload: unknown }[] = [];
  const fetchCalls: { url: string; options: { method: string; headers: Record<string, string>; body: string; cache: string; credentials: string } }[] = [];
  const assignments: string[] = [];
  const historyCalls: unknown[][] = [];
  const windowEvents = new Map<string, () => void>();
  const documentEvents = new Map<string, () => void>();
  const invalidations: string[] = [];
  const container = Object.freeze({ syntheticDomBoundary: true });
  let capturedPort: RequestPort | undefined;
  let legacyReturn: (() => void) | undefined; let mountOptions: string[] = [];
  let envelope: unknown = { version: 1, ok: true, result: { workspace: 'synthetic', value: 7 } };
  let fetchReply = { ok: true, value: { result: { browser: 'synthetic', value: 9 } } as unknown };
  let legacyCalls = 0, checks = 0, disposals = 0, unsubscribes = 0, clearedTimers = 0;
  let statusListener: ((status: { state: string }) => void) | undefined;
  const bridge = {
    async request() { legacyCalls++; throw new Error('Legacy request trap: desktop shell must use requestEnvelope.'); },
    async requestEnvelope(method: string, payload: unknown) { calls.push({ method, payload: ordinary(payload) }); return contextCopy(context, envelope); },
    onEngineStatus(listener: (status: { state: string }) => void) { statusListener = listener; return () => { unsubscribes++; }; },
  };
  Object.assign(context, {
    URLSearchParams,
    location: { protocol, pathname: '/ui/host/index.html', hash: token === null ? '' : `#token=${encodeURIComponent(token)}`, assign(value: string) { assignments.push(value); } },
    history: { replaceState(...args: unknown[]) { historyCalls.push(args); } },
    document: {
      visibilityState: 'visible',
      // The trusted host serves the document that marks the legacy renderer available only behind its flag.
      documentElement: { dataset: legacy ? { legacy: 'available' } : {} },
      getElementById(id: string) { assert.equal(id, 'host'); return container; },
      addEventListener(name: string, callback: () => void) { documentEvents.set(name, callback); },
      removeEventListener(name: string, callback: () => void) { assert.equal(documentEvents.get(name), callback); documentEvents.delete(name); },
    },
    window: {
      chausar: bridge,
      addEventListener(name: string, callback: () => void) { windowEvents.set(name, callback); },
      removeEventListener(name: string, callback: () => void) { assert.equal(windowEvents.get(name), callback); windowEvents.delete(name); },
    },
    setInterval(_callback: () => void, milliseconds: number) { assert.equal(milliseconds, 5_000); return 17; },
    clearInterval(id: number) { assert.equal(id, 17); clearedTimers++; },
    async fetch(url: string, options: { method: string; headers: Record<string, string>; body: string; cache: string; credentials: string }) {
      fetchCalls.push({ url, options: ordinary(options) as typeof options });
      return { ok: fetchReply.ok, async json() { return fetchReply.value; } };
    },
  });
  let shellBridge: unknown = 'not-created';
  const hostBoundary = new SyntheticModule(['createDesktopRequestPort', 'createHostController', 'createShellPort', 'mountHost'], function () {
    this.setExport('createDesktopRequestPort', actual.exports.createDesktopRequestPort);
    this.setExport('createShellPort', (desktop: unknown) => { shellBridge = desktop; return actual.exports.createShellPort(desktop, null); });
    this.setExport('createHostController', (port: RequestPort, options: { todayProducer: object }) => {
      capturedPort = port; assert.deepEqual(ordinary(options), { todayProducer: {} });
      return { async checkAuthority() { checks++; }, invalidate(code: string) { invalidations.push(code); } };
    });
    this.setExport('mountHost', (element: unknown, _controller: unknown, options: { onLegacyReturn?(): void; shell?: { openExternal: unknown; print: unknown } }) => {
      assert.equal(element, container); legacyReturn = options.onLegacyReturn; mountOptions = Object.keys(options);
      // The shell port is the actual bundled adapter over the desktop bridge, or the browser's own.
      assert.equal(typeof options.shell?.openExternal, 'function'); assert.equal(typeof options.shell?.print, 'function');
      assert.equal(shellBridge, protocol === 'chausar:' ? bridge : null);
      return { dispose() { disposals++; } };
    });
  }, { context, identifier: 'synthetic-controller-and-dom-boundary' });
  const shell = new SourceTextModule(shellSource, { context, identifier: shellUrl.href });
  await shell.link(specifier => { assert.equal(specifier, '/ui/host.js'); return hostBoundary; });
  await shell.evaluate({ timeout: 5_000 });
  assert.ok(capturedPort); assert.equal(legacyReturn !== undefined, legacy);
  return {
    port: capturedPort, calls, fetchCalls, assignments, historyCalls, invalidations,
    setEnvelope(value: unknown) { envelope = value; },
    setFetchReply(ok: boolean, value: unknown) { fetchReply = { ok, value }; },
    legacyReturn: legacyReturn ?? (() => { throw new Error('No legacy return was offered.'); }),
    mountOptions,
    focus() { const listener = windowEvents.get('focus'); assert.ok(listener); listener(); },
    engineStatus(state: string) { assert.ok(statusListener); statusListener({ state }); },
    pagehide() { const listener = windowEvents.get('pagehide'); assert.ok(listener); listener(); },
    counts() { return { legacyCalls, checks, disposals, unsubscribes, clearedTimers, focusListeners: windowEvents.has('focus'), visibilityListeners: documentEvents.has('visibilitychange') }; },
  };
}

test('actual canonical host artifact starts as an ES module in an empty context without Node globals', async t => {
  t.diagnostic(`actual app/ui/public/host.js sha256=${createHash('sha256').update(bundleSource).digest('hex')}`);
  const context = createContext({});
  for (const name of ['process', 'require', 'module', 'Buffer', 'global']) assert.equal(runInContext(`typeof ${name}`, context), 'undefined');
  await loadActualBundle(context);
  for (const name of ['process', 'require', 'module', 'Buffer', 'global']) assert.equal(runInContext(`typeof ${name}`, context), 'undefined');
});

test('actual bundled adapter and controller preserve VAULT_LOCKED and clear private host state', async () => {
  const actual = await loadActualBundle();
  const calls: string[] = [];
  const port = actual.exports.createDesktopRequestPort({ async requestEnvelope(method) {
    calls.push(method); return contextCopy(actual.context, { version: 1, ok: false, error: { code: 'VAULT_LOCKED' } });
  } });
  const controller = actual.exports.createHostController(port, { timeZone: 'UTC' });
  try {
    await controller.refresh();
    assert.deepEqual(ordinary(controller.snapshot()), { phase: 'locked', code: 'VAULT_LOCKED', context: null, today: null, routes: [], selectedRouteId: null, receipt: null,
      dictionaryReviewRequired: false, todayConfiguration: 'not-configured', creation: { kind: 'idle' } });
    assert.deepEqual(calls, ['ui.context']);
  } finally { controller.dispose(); }
});

test('actual desktop shell routes through the actual bundled envelope adapter and preserves legacy return cleanup', async () => {
  const h = await shellFixture('chausar:');
  assert.deepEqual(ordinary(await h.port.request('ui.context')), { workspace: 'synthetic', value: 7 });
  assert.deepEqual(h.calls, [{ method: 'ui.context', payload: {} }]);
  assert.deepEqual(h.fetchCalls, []); assert.equal(h.counts().legacyCalls, 0);
  assert.deepEqual(h.historyCalls, [[null, '', '/ui/host/index.html']]);
  h.legacyReturn(); assert.deepEqual(h.assignments, ['/index.html']);
  h.focus(); h.engineStatus('ready'); h.engineStatus('stopped');
  assert.equal(h.counts().checks, 2); assert.deepEqual(h.invalidations, ['ACCESS_DENIED']);
  h.pagehide();
  assert.deepEqual(h.counts(), { legacyCalls: 0, checks: 2, disposals: 1, unsubscribes: 1, clearedTimers: 1, focusListeners: false, visibilityListeners: false });
});

test('actual desktop shell preserves locked refusals and converts malformed envelopes to a sanitized known code', async () => {
  const h = await shellFixture('chausar:');
  try {
    h.setEnvelope({ version: 1, ok: false, error: { code: 'VAULT_LOCKED' } });
    await assert.rejects(h.port.request('ui.context', {}), { code: 'VAULT_LOCKED', message: 'The desktop request failed.' });
    for (const malformed of [null, {}, { version: 2, ok: true, result: 'synthetic secret' }, { version: 1, ok: true },
      { version: 1, ok: false, error: { code: 'UNKNOWN_PRIVATE_CODE' } },
      { version: 1, ok: false, error: { code: 'VAULT_LOCKED', message: 'synthetic secret' } },
      { version: 1, ok: false, error: { code: 'VAULT_LOCKED' }, result: 'synthetic secret' }]) {
      h.setEnvelope(malformed);
      await assert.rejects(h.port.request('ui.context', {}), { code: 'REQUEST_FAILED', message: 'The desktop request failed.' });
    }
    assert.equal(h.calls.length, 8); assert.equal(h.counts().legacyCalls, 0); assert.deepEqual(h.fetchCalls, []);
  } finally { h.pagehide(); }
});

test('actual browser shell keeps bearer POST fetch contract and does not dispatch desktop IPC', async () => {
  const h = await shellFixture('https:', 'synthetic token');
  try {
    assert.deepEqual(await h.port.request('ui.context', { requested: 'synthetic' }), { browser: 'synthetic', value: 9 });
    assert.deepEqual(h.fetchCalls, [{ url: '/api/rpc', options: { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic token' }, body: JSON.stringify({ method: 'ui.context', payload: { requested: 'synthetic' } }), cache: 'no-store', credentials: 'omit' } }]);
    assert.deepEqual(h.calls, []); assert.equal(h.counts().legacyCalls, 0);
    h.setFetchReply(false, { error: { code: 'VAULT_LOCKED' } });
    await assert.rejects(h.port.request('ui.context', {}), { code: 'VAULT_LOCKED', message: 'The workspace session is unavailable.' });
    h.legacyReturn(); assert.deepEqual(h.assignments, ['/index.html#token=synthetic%20token']);
  } finally { h.pagehide(); }
  const fetchesBefore = h.fetchCalls.length;
  await assert.rejects(h.port.request('ui.context', {}), { code: 'UNAUTHENTICATED' });
  assert.equal(h.fetchCalls.length, fetchesBefore); assert.equal(h.counts().unsubscribes, 0);
});

test('actual browser shell without a token refuses locally before any fetch or desktop call', async () => {
  const h = await shellFixture('https:', null);
  try {
    await assert.rejects(h.port.request('ui.context', {}), { code: 'UNAUTHENTICATED' });
    assert.deepEqual(h.fetchCalls, []); assert.deepEqual(h.calls, []); assert.equal(h.counts().legacyCalls, 0);
    h.legacyReturn(); assert.deepEqual(h.assignments, ['/index.html']);
  } finally { h.pagehide(); }
});

test('actual shell offers no legacy return when the host document does not mark it available', async () => {
  for (const protocol of ['chausar:', 'https:'] as const) {
    const h = await shellFixture(protocol, 'synthetic-token', false);
    try { assert.deepEqual(h.mountOptions, ['firstRun', 'shell']); assert.throws(() => h.legacyReturn()); assert.deepEqual(h.assignments, []); }
    finally { h.pagehide(); }
  }
});
