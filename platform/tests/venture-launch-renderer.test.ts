// Launch renderer (P7): runs the real launch.js and app.js in one vm context with a fake DOM whose innerHTML and
// outerHTML setters throw, the real preload, and the real IPC contract validator. The engine is a fake that
// answers from the typed synthetic fixtures in fixtures/venture/renderer. No network, no Electron, no model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { EVIDENCE_METHODS, EXTERNAL_ORIGINS, INDIA_STATES } from '../runtime/venture/contracts.ts';
import type { DeliveryRunRecord } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import * as F from './fixtures/venture/renderer/results.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const contract = require(join(root, 'app/desktop/ipc-contract.cjs'));
const [appSource, launchSource, preloadSource, cssSource] = await Promise.all(
  ['app/renderer/app.js', 'app/renderer/launch.js', 'app/desktop/preload.cjs', 'app/renderer/styles.css'].map(path => readFile(join(root, path), 'utf8')));
const LAUNCH_IDS = ['today', 'business', 'build', 'clients', 'agents', 'money', 'connections'];
const BACK_OFFICE_IDS = ['conversation', 'brief', 'sources', 'dictionary', 'memory', 'decisions', 'actions', 'jobs', 'trust', 'models', 'plugins', 'activity'];
const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
const KEY = 'sk-ant-demo-0000000000000000000000';
const RECORDING = 'AI answers here come from a synthetic recording.';

type Handler = (event: { target: Element; currentTarget: Element; preventDefault(): void }) => unknown;
class Element {
  readonly tagName: string;
  children: Element[] = [];
  attributes: Record<string, string> = {};
  readonly listeners = new Map<string, Handler[]>();
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  open = false;
  className = '';
  id = '';
  namespaceURI = '';
  ownText = '';
  parent?: Element;
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
    remove: (...names: string[]) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
    toggle: (name: string, force?: boolean) => {
      const present = this.className.split(/\s+/).includes(name), wanted = force ?? !present;
      if (wanted) this.classList.add(name); else this.classList.remove(name);
      return wanted;
    },
    contains: (name: string) => this.className.split(/\s+/).includes(name),
  };
  constructor(tag: string) { this.tagName = tag; }
  get textContent(): string { return this.ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.ownText = String(value); this.children = []; }
  set innerHTML(_value: string) { throw new Error('Renderer must build safe text nodes.'); }
  set outerHTML(_value: string) { throw new Error('Renderer must build safe text nodes.'); }
  get parentElement() { return this.parent; }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = String(value);
    if (key === 'value') this.value = String(value);
    if (key === 'id') this.id = String(value);
    if (key === 'disabled') this.disabled = true;
    if (key === 'hidden') this.hidden = true;
    if (key === 'open') this.open = true;
    if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value);
  }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  removeAttribute(key: string) { delete this.attributes[key]; if (key === 'disabled') this.disabled = false; }
  /** Like the DOM: strings become text nodes. A null would be drawn as the word "null" in a browser, so it fails here. */
  append(...items: (Element | string)[]) {
    const first = this.children.length === 0;
    const children = items.map(item => {
      if (item == null) throw new Error('append(null) would draw the text "null" in a browser.');
      if (typeof item === 'string') { const node = new Element('#text'); node.textContent = item; return node; }
      return item;
    });
    for (const child of children) { child.remove(); child.parent = this; this.children.push(child); }
    if (this.tagName === 'select' && first && children.length) this.value = children[0].value;
  }
  replaceChildren(...children: (Element | string)[]) { for (const child of this.children) child.parent = undefined; this.children = []; this.ownText = ''; this.append(...children); }
  addEventListener(name: string, handler: Handler) { const handlers = this.listeners.get(name) ?? []; handlers.push(handler); this.listeners.set(name, handlers); }
  async dispatch(name: string) {
    if (this.disabled && name === 'click') return;
    for (const handler of this.listeners.get(name) ?? []) await handler({ target: this, currentTarget: this, preventDefault() {} });
  }
  click() { void this.dispatch('click'); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; } }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; void this.dispatch('close'); }
  focus() {}
  scrollIntoView() {}
  querySelectorAll(selector: string) { return descendants(this).slice(1).filter(node => matches(node, selector)); }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
}
function matches(node: Element, selector: string) {
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return node.tagName === selector;
}
function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
function find(node: Element, predicate: (item: Element) => boolean, message = 'Expected a renderer control.') { const found = descendants(node).find(predicate); assert.ok(found, message); return found; }
function buttons(node: Element, label: string) { return descendants(node).filter(item => item.tagName === 'button' && item.textContent === label); }
function button(node: Element, label: string) { const found = buttons(node, label)[0]; assert.ok(found, `Expected button "${label}".`); return found; }
function control(node: Element, label: string) {
  const field = find(node, item => (item.className === 'launch-field' || item.className === 'field') && item.children[0]?.textContent === label, `Expected field "${label}".`);
  return field.children[1];
}
function ancestors(node: Element) { const list: Element[] = []; for (let parent = node.parent; parent; parent = parent.parent) list.push(parent); return list; }
function openDialog(body: Element) { const found = descendants(body).filter(item => item.tagName === 'dialog' && item.open).at(-1); assert.ok(found, 'Expected an open sheet or dialog.'); return found; }
async function flush(times = 6) { for (let i = 0; i < times; i++) await new Promise<void>(accept => setImmediate(accept)); }
async function click(node: Element) { await node.dispatch('click'); await flush(); }
async function type(input: Element, value: string) { input.value = value; await input.dispatch('input'); }
async function tick(box: Element) { box.checked = true; await box.dispatch('change'); }

/** Words a person reads at rest: closed details show only their summary; hidden nodes and closed dialogs show nothing. */
function visibleText(node: Element): string[] {
  if (node.hidden || (node.tagName === 'dialog' && !node.open)) return [];
  if (node.tagName === 'option') return [];
  if (node.tagName === 'select') return [descendants(node).find(item => item.tagName === 'option' && item.value === node.value)?.textContent ?? ''];
  if (node.tagName === 'details' && !node.open) { const summary = node.children.find(child => child.tagName === 'summary'); return summary ? visibleText(summary) : []; }
  const own = [node.ownText];
  if (node.attributes.placeholder) own.push(node.attributes.placeholder);
  if (node.tagName === 'input' && node.attributes.type !== 'password' && node.attributes.type !== 'checkbox') own.push(node.value);
  return [...own, ...node.children.flatMap(visibleText)];
}
function wordCount(node: Element) { return visibleText(node).join(' ').split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length; }
function text(node: Element) { return node.textContent; }

// ---------------------------------------------------------------------------------------------
// The fake engine
// ---------------------------------------------------------------------------------------------
type Dispatch = (method: string, payload: Record<string, any>) => unknown;
type EngineOptions = { open?: boolean; venture?: boolean; blueprint?: 'draft' | 'accepted' | null; models?: 'connected' | 'templates'; build?: 'followed' | 'unfollowed'; overrides?: Record<string, Dispatch> };
function fakeEngine(options: EngineOptions = {}) {
  const world = {
    open: options.open ?? false,
    venture: options.venture ?? false,
    blueprint: options.blueprint === undefined ? 'accepted' as 'draft' | 'accepted' | null : options.blueprint,
    invoice: 'draft' as 'draft' | 'issued',
    questions: F.templateQuestions.filter(question => question.id !== 'q_tax_rate').map(question => ({ ...question, answer: null as any, answerMinor: null, answerBps: null, answeredAt: null })),
  };
  const interviewView = () => {
    const next = world.questions.find(question => question.answer === null) ?? null;
    return { interview: { id: 'vin_demo', kind: 'venture-interview', ventureId: 'vnt_demo', memberId: 'owner', epoch: 1, at: '2026-10-15T09:30:00.000Z', serviceType: { value: 'bookkeeping', label: 'assumption', by: 'template' }, questions: world.questions, modelCallIds: [], source: 'template' }, next, done: next === null, asked: world.questions.filter(question => question.answer !== null).length, limit: 6 };
  };
  const dispatch: Dispatch = (method, payload) => {
    const override = options.overrides?.[method];
    if (override) return override(method, payload);
    switch (method) {
      case 'workspace.status': return { open: world.open, workspace: world.open ? { name: 'Ledger Cafe Books' } : undefined, storage: 'experimental-file', experimental: true, version: '0.1.0-preview.1' };
      case 'workspace.create': world.open = true; return { workspace: { name: payload.name }, recoveryKit: 'DEMO-RECOVERY-CODE', recoveryCode: 'DEMO-RECOVERY-CODE', experimental: true };
      case 'venture.countries': return F.countries;
      case 'venture.preview': return { ...F.preview, idea: payload.idea };
      case 'venture.create': world.venture = true; return F.ventureView;
      case 'venture.get': return world.venture ? F.ventureView : null;
      case 'venture.events': return payload.limit === 1 && !payload.afterSeq ? { events: F.events.slice(0, 1), lastSeq: F.LAST_SEQ } : { events: F.events, lastSeq: F.LAST_SEQ };
      case 'venture.interview.next': return interviewView();
      case 'venture.interview.answer': {
        const question = world.questions.find(item => item.id === payload.questionId);
        assert.ok(question, `Unknown question ${payload.questionId}`);
        question.answer = payload.answer;
        if (question.id === 'q_tax') {
          const rate = F.templateQuestions.find(item => item.id === 'q_tax_rate')!;
          world.questions = world.questions.filter(item => item.id !== 'q_tax_rate');
          if (payload.answer.yes) world.questions.push({ ...rate, answer: null, answerMinor: null, answerBps: null, answeredAt: null });
        }
        return interviewView();
      }
      case 'venture.blueprint.draft': world.blueprint = 'draft'; return F.blueprintDraftView;
      case 'venture.blueprint.get': return world.blueprint === 'draft' ? F.blueprintDraftView : world.blueprint === 'accepted' ? F.blueprintView : null;
      case 'venture.blueprint.update': return F.blueprintDraftView;
      case 'venture.blueprint.accept': world.blueprint = 'accepted'; return F.blueprintView;
      case 'venture.price.quote': return F.offerReceipt;
      case 'venture.receipt.get': return payload.id === F.orderReceipt.id ? F.orderReceipt : F.offerReceipt;
      case 'venture.models.presets': return F.presets;
      case 'venture.models.status': return options.models === 'templates' ? F.modelsTemplatesOnly : F.modelsConnected;
      case 'venture.models.connect': return F.modelsConnected;
      case 'venture.build.status': return options.build === 'unfollowed' ? F.buildStatusUnfollowed : F.buildStatus;
      case 'venture.build.brief': return F.brief;
      case 'venture.build.handoff': return F.handoffPlans[payload.builder as 'lovable' | 'replit' | 'bolt'];
      case 'venture.build.handoffOpened': return { ...F.buildStatus.handoffs[0], id: payload.handoffId, openedAt: '2026-10-15T09:31:00.000Z' };
      case 'venture.build.link': return F.buildStatus.follow;
      case 'venture.build.sync': return F.lastStatus;
      case 'venture.connectors.list': return F.connectors;
      case 'venture.client.list': return [F.client];
      case 'venture.client.add': return F.client;
      case 'venture.order.list': return [F.order];
      case 'venture.order.create': return F.order;
      case 'venture.order.deliver': return { ...F.order, status: 'delivered', deliveredOn: payload.deliveredOn };
      case 'venture.invoice.list': return [F.invoiceDraftView.invoice];
      case 'venture.invoice.prepare': return F.invoiceDraftView;
      case 'venture.invoice.get': return world.invoice === 'draft' ? F.invoiceDraftView : F.invoiceIssuedView;
      case 'venture.invoice.issue': world.invoice = 'issued'; return F.invoiceIssuedView;
      case 'venture.payment.record': return F.invoiceIssuedView;
      case 'venture.books.summary': return F.booksSummary;
      case 'receipts.get': return F.calculatorReceipt;
      case 'venture.delivery.playbook': return F.playbook;
      case 'venture.simulation.scenarios': return F.scenarios;
      case 'venture.simulation.get': return F.simulationRun(String(payload.runId).replace(/^vsr_/, ''), { runId: payload.runId });
      case 'venture.simulation.run': return F.simulationRun(payload.scenarioIds[0]);
      case 'venture.launch.status': return F.launchStatus;
      case 'venture.launch.advance': return { ...F.launchStatus, stage: payload.to };
      case 'venture.capabilities': return F.capabilities;
      case 'venture.delivery.list': return [F.waitingRun, F.practiceRun, F.outlineRun];
      case 'venture.delivery.run': return F.waitingRun;
      case 'venture.delivery.approve': return F.practiceRun;
      case 'venture.delivery.review': return { ...F.outlineRun, status: payload.verdict, verdict: { choice: payload.verdict, reason: payload.reason ?? null, at: '2026-10-15T09:40:00.000Z' }, editedText: payload.editedText ?? null };
      case 'models.list': return [];
      default: throw Object.assign(new Error(`Unexpected fixture RPC ${method}.`), { code: 'UNEXPECTED_FIXTURE_RPC' });
    }
  };
  return { world, dispatch };
}

// ---------------------------------------------------------------------------------------------
// The harness: real preload, real IPC contract, both renderer scripts in one vm context
// ---------------------------------------------------------------------------------------------
/** A browser tab the page opened with window.open: it records where the page sent it and whether it was closed. */
type FakeTab = { opener: unknown; closed: boolean; url: string | null; location: { replace(url: string): void }; close(): void };
function makeTab(): FakeTab {
  const tab: FakeTab = { opener: { page: 'chausar' }, closed: false, url: null, location: { replace: (url: string) => { tab.url = url; } }, close: () => { tab.closed = true; } };
  return tab;
}
/** Blob and URL for saveText: each saved file is kept so a test can read its name, type and text. */
class FakeBlob { readonly text: string; readonly type: string; constructor(parts: unknown[], options: { type?: string } = {}) { this.text = parts.map(String).join(''); this.type = options.type ?? ''; } }
type HarnessOptions = { openExternal?: (url: string) => unknown; clipboard?: boolean | 'refuse'; timers?: boolean; browser?: { open: () => FakeTab | null } };
async function harness(engine: EngineOptions = {}, options: HarnessOptions = {}) {
  const fake = fakeEngine(engine);
  const calls: { method: string; payload: any }[] = [], rejected: unknown[] = [], opened: string[] = [], externalInvokes: unknown[] = [], clipboard: string[] = [];
  const anchors: Element[] = [], blobs = new Map<string, FakeBlob>(), opens: { args: unknown[]; callsBefore: number }[] = [];
  const TestURL = class extends URL {};
  Object.defineProperty(TestURL, 'createObjectURL', { value: (blob: FakeBlob) => { const id = `blob:chausar-test/${blobs.size + 1}`; blobs.set(id, blob); return id; } });
  Object.defineProperty(TestURL, 'revokeObjectURL', { value: () => {} });
  const saved = () => anchors.filter(node => node.attributes.download).map(node => ({ filename: node.attributes.download, type: blobs.get(node.attributes.href)?.type, text: blobs.get(node.attributes.href)?.text }));
  const ipcRenderer = {
    async invoke(channel: string, envelope: unknown) {
      if (channel === 'chausar:open-external') {
        externalInvokes.push(envelope);
        try { const url = contract.validateExternalUrl(envelope); await options.openExternal?.(url); opened.push(url); return { ok: true }; }
        catch (error) { return structuredClone({ ok: false, error: contract.publicError(error) }); }
      }
      assert.equal(channel, 'chausar:request');
      const wire = structuredClone(envelope);
      let call: { method: string; payload: any };
      try { call = contract.validateRequest(wire); } catch (error) { rejected.push({ wire, error: contract.publicError(error) }); return structuredClone({ ok: false, error: contract.publicError(error) }); }
      calls.push(call);
      try { return structuredClone({ ok: true, result: await fake.dispatch(call.method, call.payload) }); }
      catch (error) { return structuredClone({ ok: false, error: contract.publicError(error) }); }
    },
    on() {}, removeListener() {},
  };
  let exposed: unknown;
  vm.runInNewContext(preloadSource, { require(name: string) { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(key: string, api: unknown) { assert.equal(key, 'chausar'); exposed = api; } } }; } }, { filename: join(root, 'app/desktop/preload.cjs') });
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div');
  app.id = 'app'; notifications.id = 'notifications'; body.append(app, notifications);
  const document = {
    body, createElement: (tag: string) => { const node = new Element(tag); if (tag === 'a') anchors.push(node); return node; },
    createTextNode: (value: unknown) => { const node = new Element('#text'); node.textContent = String(value); return node; },
    createElementNS: (namespace: string, tag: string) => { const node = new Element(tag); node.namespaceURI = namespace; return node; },
    getElementById: (id: string) => descendants(body).find(node => node.id === id) ?? null, querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  };
  const navigator = options.clipboard === false ? undefined : { language: 'en-IN', clipboard: { writeText: async (value: string) => { if (options.clipboard === 'refuse') throw new Error("Failed to execute 'writeText' on 'Clipboard': Write permission denied."); clipboard.push(value); } } };
  const window: Record<string, unknown> = { location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} };
  if (options.browser) window.open = (...args: unknown[]) => { opens.push({ args, callsBefore: calls.length }); return options.browser!.open(); };
  else window.chausar = exposed;
  /** The paired browser's transport: the same fake engine behind /api/rpc, answered as the local server answers. */
  const browserFetch = async (path: string, init: { body: string }) => {
    assert.equal(path, '/api/rpc');
    const call = JSON.parse(init.body) as { method: string; payload: any };
    calls.push(call);
    try { const result = await fake.dispatch(call.method, call.payload); return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify({ result: result ?? null })) }; }
    catch (error: any) { return { ok: false, status: 400, json: async () => ({ error: { code: error.code, message: error.message } }) }; }
  };
  const context = vm.createContext({
    document, Node: Element, navigator, crypto: { randomUUID }, URL: TestURL, URLSearchParams, structuredClone, console, Blob: FakeBlob, window,
    setTimeout: options.timers ? (callback: () => void) => { callback(); return 1; } : () => 0, clearTimeout() {},
    fetch: options.browser ? browserFetch : () => { throw new Error('Unexpected network in the launch renderer tests.'); },
  });
  vm.runInContext(launchSource, context, { filename: join(root, 'app/renderer/launch.js') });
  assert.match(appSource, /\bboot\(\);\s*$/);
  vm.runInContext(appSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__launchTest = { launch, boot, navigate, renderShell, applyWorkspaceStatus, renderModels, openExternal, request, state, EXTERNAL_ORIGINS, evidenceChanges: [...evidenceChanges] };', context, { filename: join(root, 'app/renderer/app.js') });
  const renderer = context.__launchTest;
  if (options.browser) renderer.state.token = 'paired-browser-token';
  const after = (method: string) => calls.slice(calls.findIndex(call => call.method === method));
  return { renderer, calls, rejected, opened, externalInvokes, clipboard, body, app, world: fake.world, after, anchors, opens, saved };
}
/** Boots straight into the shell with a business, then opens one place. */
async function place(id: string, engine: EngineOptions = {}, options: HarnessOptions = {}) {
  const h = await harness({ open: true, venture: true, ...engine }, options);
  await h.renderer.boot(); await flush();
  if (id !== 'today') { await h.renderer.navigate(id); await flush(); }
  const content = find(h.app, node => node.id === 'page-content');
  return { ...h, content };
}

// ---------------------------------------------------------------------------------------------
// 1 to 3: one question first, a plan at once, keep it safe
// ---------------------------------------------------------------------------------------------
test('first screen asks one question with one textarea and makes only the boot and country requests', async () => {
  const h = await harness();
  await h.renderer.boot(); await flush();
  const title = find(h.app, node => node.className === 'launch-title');
  assert.equal(title.textContent, 'What service business do you want to start?');
  assert.equal(descendants(h.app).filter(node => node.tagName === 'textarea').length, 1);
  assert.equal(descendants(h.body).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 0);
  assert.deepEqual(h.calls.map(call => call.method), ['workspace.status', 'venture.countries']);
  assert.match(text(h.app), /India, prices in INR\./);
  assert.match(text(h.app), /Nothing is saved until you keep it\./);
  assert.equal(descendants(h.app).filter(node => node.className === 'launch-btn').length, 1, 'one filled button');
  assert.equal(h.rejected.length, 0);
});

test('"Show my plan" sends exactly the idea and country and shows the plan with no vault or passphrase', async () => {
  const h = await harness();
  await h.renderer.boot(); await flush();
  await type(find(h.app, node => node.tagName === 'textarea'), 'Monthly bookkeeping for cafes and small shops in Pune.');
  await click(button(h.app, 'Show my plan'));
  assert.deepEqual(h.calls.at(-1), { method: 'venture.preview', payload: { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN' } });
  assert.deepEqual(Object.keys(h.calls.at(-1)!.payload).sort(), ['countryCode', 'idea']);
  for (const words of ['Monthly books', 'Catch up', 'Collect bills and bank statements', 'Draft the monthly report for review', 'Set your price']) assert.ok(text(h.app).includes(words), words);
  assert.equal(descendants(h.app).filter(node => node.className === 'launch-chip' && node.textContent === 'planned: agent').length, 3);
  assert.ok(descendants(h.app).some(node => node.className === 'launch-chip' && node.textContent === 'Assumption: not registered for GST'));
  assert.equal(descendants(h.body).filter(node => node.tagName === 'input' && node.attributes.type === 'password').length, 0);
  assert.equal(h.calls.some(call => call.method === 'workspace.create'), false);
  assert.equal(descendants(h.app).filter(node => node.className === 'launch-btn').length, 1, 'one filled button');
});

test('every plan step and every approval carries its own label, before and after the plan is kept', async () => {
  const told = <T extends { label: string }>(line: T) => ({ ...line, label: 'told-by-you' });
  const preview = {
    ...F.preview,
    deliverySteps: F.preview.deliverySteps.map((step, index) => (index === 1 ? { ...step, title: told(step.title) } : step)),
    approvals: [F.preview.approvals[0], told(F.preview.approvals[1])],
  };
  const labelsIn = (host: Element, title: string) => {
    const part = find(host, node => (node.className === 'launch-section' || node.tagName === 'details') && node.children[0]?.textContent === title, `Expected the "${title}" part.`);
    return {
      steps: descendants(part).filter(node => node.className === 'launch-row').map(row => descendants(row).find(node => node.className.split(' ').includes('launch-row-label'))?.textContent),
      approvals: descendants(part).filter(node => node.className.split(' ').includes('launch-approval')).map(line => [line.children[0].textContent, line.children.at(-1)!.textContent]),
    };
  };
  const h = await harness({ overrides: { 'venture.preview': () => preview } });
  await h.renderer.boot(); await flush();
  await type(find(h.app, node => node.tagName === 'textarea'), 'Monthly bookkeeping for cafes.');
  await click(button(h.app, 'Show my plan'));
  assert.deepEqual(labelsIn(h.app, 'Steps').steps, ['assumption', 'told by you', 'assumption', 'assumption']);
  assert.deepEqual(labelsIn(h.app, 'You approve').approvals, [['Every monthly report before it reaches a client', 'assumption'], ['Any message that asks a client for money', 'told by you']]);

  const kept = { ...F.blueprintDraftView, blueprint: { ...F.blueprintDraftView.blueprint, deliverySteps: preview.deliverySteps, approvals: preview.approvals } };
  const owned = await place('business', { blueprint: 'draft', overrides: { 'venture.blueprint.get': () => kept } });
  assert.deepEqual(labelsIn(owned.content, 'Steps').steps, ['assumption', 'told by you', 'assumption', 'assumption']);
  assert.deepEqual(labelsIn(owned.content, 'You approve').approvals, [['Every monthly report before it reaches a client', 'assumption'], ['Any message that asks a client for money', 'told by you']]);
});

test('keeping the plan creates a services vault, then sets up the business in order with typed answers', async () => {
  const h = await harness();
  await h.renderer.boot(); await flush();
  await type(find(h.app, node => node.tagName === 'textarea'), 'Monthly bookkeeping for cafes and small shops in Pune.');
  await click(button(h.app, 'Show my plan'));
  await type(find(h.app, node => node.attributes['aria-label'] === 'Your price, in INR'), '2,499');
  await click(button(h.app, 'Change'));
  await click(button(h.app, 'Yes'));
  assert.equal(find(h.app, node => node.attributes['aria-label'] === 'GST rate, in percent').value, '18', 'the rate is prefilled from the preview');
  await click(button(h.app, 'Tell us more (optional)'));
  await click(button(h.app, 'Small shops'));
  await click(button(h.app, 'Keep this plan'));

  assert.ok(text(h.app).includes('Chausar keeps your records for ten years, as tax rules expect.'));
  assert.ok(text(h.app).includes(EXPERIMENTAL), 'experimental notice on Keep it safe');
  const folderLine = (folder: string) => `Chausar keeps this business in the workspace folder ${folder}. To open it again you need this folder name and your passphrase.`;
  assert.ok(text(h.app).includes(folderLine('my-service-business')), 'the folder is shown before the owner keeps the plan');
  await type(control(h.app, 'Working name'), 'Ledger Cafe Books');
  assert.ok(text(h.app).includes(folderLine('ledger-cafe-books')), 'the folder follows the working name as it is typed');
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Confirm passphrase'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.deepEqual(h.calls.find(call => call.method === 'workspace.create'), { method: 'workspace.create', payload: { name: 'Ledger Cafe Books', passphrase: 'long-enough-passphrase', pack: 'services', folder: 'ledger-cafe-books' } });
  assert.equal(control(h.app, 'Passphrase').value, '', 'passphrase cleared');

  const kit = openDialog(h.body);
  assert.ok(text(kit).includes('Workspace folder: ledger-cafe-books.'), 'the recovery kit screen names the folder');
  await click(descendants(kit).find(node => node.tagName === 'button' && node.textContent.includes('Save recovery kit'))!);
  const [savedKit] = h.saved();
  assert.equal(savedKit.filename, 'chausar-recovery-kit.txt');
  assert.match(savedKit.text!, /^Chausar recovery kit\nWorkspace: Ledger Cafe Books\nWorkspace folder: ledger-cafe-books\n/);
  assert.ok(savedKit.text!.includes('DEMO-RECOVERY-CODE'), 'the saved kit holds the folder and the code together');
  assert.equal(descendants(kit).find(node => node.className === 'recovery-secret')!.textContent, 'DEMO-RECOVERY-CODE', 'the code itself stays alone, so it can be pasted into Recover');
  await tick(find(kit, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(kit, 'Enter my workspace')); await flush();
  const sequence = h.after('venture.create').slice(0, 11);
  assert.deepEqual(sequence, [
    { method: 'venture.create', payload: { idea: 'Monthly bookkeeping for cafes and small shops in Pune.', countryCode: 'IN', workingName: 'Ledger Cafe Books' } },
    { method: 'venture.interview.next', payload: { useTemplate: true } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_1', answer: { choiceId: 'c_2' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_2', answer: { skipped: true } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_pricing_model', answer: { choiceId: 'monthly' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_price', answer: { amount: '2,499' } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_tax', answer: { yes: true } } },
    { method: 'venture.interview.answer', payload: { questionId: 'q_tax_rate', answer: { rate: '18' } } },
    { method: 'venture.blueprint.draft', payload: { useTemplate: true } },
    { method: 'venture.price.quote', payload: { offerId: 'offer_1' } },
    { method: 'venture.get', payload: {} },
  ]);
  assert.equal(h.rejected.length, 0, 'no payload carried undefined');
  assert.ok(text(h.app).includes('INR 2,948.82'), 'the kept plan shows the receipt total');
  assert.ok(text(h.app).includes('Accept plan'));
});

test('without a price the price question is skipped and no quote is asked for', async () => {
  const h = await harness();
  await h.renderer.boot(); await flush();
  await type(find(h.app, node => node.tagName === 'textarea'), 'Podcast editing for small creators.');
  await click(button(h.app, 'Show my plan'));
  await click(button(h.app, 'Per hour'));
  await click(button(h.app, 'Keep this plan'));
  await type(control(h.app, 'Passphrase'), 'long-enough-passphrase');
  await type(control(h.app, 'Confirm passphrase'), 'long-enough-passphrase');
  await find(h.app, node => node.tagName === 'form').dispatch('submit'); await flush();
  assert.equal(h.calls.find(call => call.method === 'workspace.create')!.payload.folder, 'my-service-business');
  const kit = openDialog(h.body);
  await tick(find(kit, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(kit, 'Enter my workspace')); await flush();
  const answers = h.calls.filter(call => call.method === 'venture.interview.answer').map(call => [call.payload.questionId, call.payload.answer]);
  assert.deepEqual(answers, [['q_1', { skipped: true }], ['q_2', { skipped: true }], ['q_pricing_model', { choiceId: 'hourly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]]);
  assert.equal(h.calls.some(call => call.method === 'venture.price.quote'), false);
});

test('an open vault with no business resumes at the idea and keeps the plan without asking for a passphrase', async () => {
  const h = await harness({ open: true, venture: false, blueprint: null });
  await h.renderer.boot(); await flush();
  assert.equal(find(h.app, node => node.className === 'launch-title').textContent, 'What service business do you want to start?');
  assert.ok(buttons(h.app, 'Open the back office').length === 1);
  await type(find(h.app, node => node.tagName === 'textarea'), 'Monthly bookkeeping for cafes.');
  await click(button(h.app, 'Show my plan'));
  await click(button(h.app, 'Keep this plan')); await flush();
  assert.equal(h.calls.some(call => call.method === 'workspace.create'), false);
  assert.deepEqual(h.calls.find(call => call.method === 'venture.create')!.payload, { idea: 'Monthly bookkeeping for cafes.', countryCode: 'IN', workingName: 'Ledger Cafe Books' });
});

// ---------------------------------------------------------------------------------------------
// 4: Add your AI
// ---------------------------------------------------------------------------------------------
test('Add your AI connects the recommended pair with consent, a key outside any form, and the Luna model id', async () => {
  const h = await place('today');
  const next = descendants(h.content).filter(node => node.className === 'launch-row' && node.textContent.startsWith('Add your AI (optional)'))[0];
  await click(button(next, 'Open'));
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Which AI should do the work?'));
  assert.ok(text(sheet).includes('AI answers here come from a synthetic recording.'));
  const recommended = find(sheet, node => node.dataset.preset === 'recommended');
  const key = find(recommended, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(key.attributes.autocomplete, 'off');
  assert.equal(ancestors(key).some(node => node.tagName === 'form'), false, 'the key field is not inside a form');
  assert.ok(text(recommended).includes('Chausar keeps this in memory only. If your browser offers to save it, choose Never.'));
  assert.ok(text(recommended).includes(F.presets[0].consentText), 'consent text shown word for word');
  const connect = button(recommended, 'Connect');
  assert.equal(connect.disabled, true);
  await type(key, KEY);
  await click(connect);
  assert.equal(h.calls.filter(call => call.method === 'venture.models.connect').length, 0, 'nothing sent before the box is ticked');
  await tick(find(recommended, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  assert.equal(connect.disabled, false);
  await click(connect);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').map(call => call.payload), [
    { presetId: 'anthropic-haiku-5-5', consentDigest: F.presets[0].consentDigest, apiKey: KEY, tiers: ['fast'] },
    { presetId: 'anthropic-sonnet-5-5', consentDigest: F.presets[1].consentDigest, apiKey: KEY, tiers: ['main'] },
  ]);
  assert.equal(key.value, '', 'the key is cleared');
  assert.match(text(recommended), /Connected: Claude Haiku 5.5 for quick work/);

  const rowsInOrder = descendants(sheet).filter(node => node.className === 'launch-preset').map(node => node.dataset.preset);
  assert.deepEqual(rowsInOrder, ['built-in-templates', 'anthropic-haiku-5-5', 'openai-gpt-6-luna', 'anthropic-sonnet-5-5', 'claude-code-cli', 'codex-cli'], 'cheapest first');
  const luna = find(sheet, node => node.dataset.preset === 'openai-gpt-6-luna');
  assert.ok(text(luna).includes('unverified'));
  const model = control(luna, 'Model id, as your account shows it');
  assert.equal(model.value, 'gpt-6-luna');
  await type(model, 'gpt-6-luna-2026');
  const lunaKey = find(luna, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(ancestors(lunaKey).some(node => node.tagName === 'form'), false);
  await type(lunaKey, 'sk-openai-demo-000000000000000000');
  await tick(find(luna, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(button(luna, 'Connect'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').at(-1)!.payload, { presetId: 'openai-gpt-6-luna', consentDigest: F.presets[2].consentDigest, apiKey: 'sk-openai-demo-000000000000000000', model: 'gpt-6-luna-2026' });
  assert.equal(lunaKey.value, '');

  const claude = find(sheet, node => node.dataset.preset === 'claude-code-cli');
  assert.ok(text(claude).includes('Uses your own sign-in on this computer.'));
  assert.ok(buttons(claude, 'Check and connect').length === 1);
  await click(button(find(sheet, node => node.dataset.preset === 'built-in-templates'), 'Keep using templates'));
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.models.connect').at(-1)!.payload, { presetId: 'built-in-templates', consentDigest: F.presets[5].consentDigest });
  assert.equal(h.rejected.length, 0);
});

// ---------------------------------------------------------------------------------------------
// 5 and 6: the plan with receipts, and Build
// ---------------------------------------------------------------------------------------------
test('the plan shows the receipt display exactly, opens the receipt, and accepts the exact digest', async () => {
  const h = await place('business', { blueprint: 'draft' });
  const figure = find(h.content, node => node.className === 'launch-fig-btn');
  assert.equal(figure.textContent, 'INR 2,948.82');
  assert.equal(figure.textContent, F.offerReceipt.figures.find(item => item.key === 'total')!.display);
  await click(figure);
  const sheet = openDialog(h.body);
  for (const words of ['GST at 18%', 'INR 449.82', F.offerReceipt.explanation, 'unit price times quantity']) assert.ok(text(sheet).includes(words), words);
  await click(button(sheet, 'Close'));
  assert.ok(text(h.content).includes('For a tax invoice, add: Your GSTIN, Your state, Your SAC code.'));
  await click(button(h.content, 'Accept plan'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.blueprint.accept')!.payload, { digest: F.blueprintDraftView.blueprint.digest });
  assert.equal(h.renderer.state.page, 'build');
  for (const banned of ['parseFloat', 'toFixed', 'BigInt']) assert.equal(launchSource.includes(banned), false, `launch.js must not contain ${banned}`);
});

test('tax invoice details send only what changed and price the plan again', async () => {
  const h = await place('business', { blueprint: 'draft' });
  await click(button(h.content, 'Add them'));
  const sheet = openDialog(h.body);
  const states = descendants(control(sheet, 'Your state')).filter(node => node.tagName === 'option').map(node => node.textContent);
  assert.deepEqual(states.slice(0, 3), ['From your GSTIN', 'Andaman and Nicobar Islands (35)', 'Andhra Pradesh (37)'], 'states sorted by name');
  assert.equal(states.length, Object.keys(INDIA_STATES).length + 1);
  await type(control(sheet, 'Your GSTIN'), '27ZZZZZ9999Z1Z8');
  await type(control(sheet, 'Your SAC code'), '998222');
  await click(button(sheet, 'Save'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.blueprint.update')!.payload, { patch: { taxId: '27ZZZZZ9999Z1Z8', sacCode: '998222' } });
  assert.ok(h.after('venture.blueprint.update').some(call => call.method === 'venture.blueprint.get'), 'the plan is read again after the change');
});

test('Build shows the brief first and opens Lovable only through the link opener, then marks it opened', async () => {
  const h = await place('build');
  const nodes = descendants(h.content);
  const opening = nodes.findIndex(node => node.className === 'launch-brief');
  const lovable = nodes.findIndex(node => node.tagName === 'button' && node.textContent === 'Open in Lovable');
  assert.ok(opening >= 0 && lovable > opening, 'brief text comes before the Open buttons');
  assert.match(nodes[opening].textContent, /A calm site for a bookkeeping studio/);
  assert.ok(text(h.content).includes('Replit receives your brief as soon as its page opens.'));
  await click(nodes[lovable]);
  const handoff = h.calls.findIndex(call => call.method === 'venture.build.handoff');
  assert.deepEqual(h.calls[handoff].payload, { builder: 'lovable' });
  assert.deepEqual(h.opened, [new URL(F.handoffPlans.lovable.url).href]);
  assert.deepEqual(h.calls[handoff + 1], { method: 'venture.build.handoffOpened', payload: { handoffId: 'vho_lovable' } });
  assert.ok(text(h.content).includes('Lovable keeps your brief in this browser until you press send.'), 'the plan notes show under the buttons');
});

test('a refused link never marks the builder opened', async () => {
  const failing = await place('build', {}, { openExternal: () => { throw Object.assign(new Error('The system browser refused.'), { code: 'OPEN_FAILED' }); } });
  await click(button(failing.content, 'Open in Lovable'));
  assert.equal(failing.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(failing.content).includes('The system browser refused.'));

  for (const url of ['http://lovable.dev/#prompt=x', 'https://user:secret@lovable.dev/#prompt=x', 'https://lovable.example/#prompt=x']) {
    const h = await place('build', { overrides: { 'venture.build.handoff': () => ({ ...F.handoffPlans.lovable, url }) } });
    await click(button(h.content, 'Open in Lovable'));
    assert.equal(h.externalInvokes.length, 0, `${url} is refused before any call`);
    assert.equal(h.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
    assert.match(text(h.content), /Use one partner link\.|Chausar opens only its listed partner sites\./);
  }
  const h = await harness();
  await assert.rejects(h.renderer.openExternal('http://lovable.dev/'), { code: 'INVALID_EXTERNAL_URL' });
  await assert.rejects(h.renderer.openExternal('https://a:b@github.com/'), { code: 'INVALID_EXTERNAL_URL' });
  await assert.rejects(h.renderer.openExternal('https://example.com/'), { code: 'EXTERNAL_URL_NOT_ALLOWED' });
  assert.equal(h.externalInvokes.length, 0);
  await h.renderer.openExternal('https://razorpay.com/');
  assert.deepEqual(h.opened, ['https://razorpay.com/']);
});

test('in a paired browser, Open in Lovable opens the tab inside the click, before any request, then sends the link there', async () => {
  const tab = makeTab();
  const h = await place('build', {}, { browser: { open: () => tab } });
  assert.ok(text(h.content).includes('Hand your brief') || text(h.content).includes('Open in Lovable'), 'the build place loaded over /api/rpc');
  const before = h.calls.length;
  await click(button(h.content, 'Open in Lovable'));
  assert.deepEqual(h.opens.map(item => item.args), [['', '_blank']]);
  assert.equal(h.opens[0].callsBefore, before, 'the tab opens before venture.build.handoff is asked for');
  assert.equal(tab.opener, null, 'the builder page gets no handle back to Chausar');
  assert.equal(tab.url, new URL(F.handoffPlans.lovable.url).href);
  assert.equal(tab.closed, false);
  assert.deepEqual(h.calls.slice(before), [{ method: 'venture.build.handoff', payload: { builder: 'lovable' } }, { method: 'venture.build.handoffOpened', payload: { handoffId: 'vho_lovable' } }]);
  assert.ok(text(h.content).includes('Lovable opened in your browser.'));

  const cards = await place('connections', {}, { browser: { open: () => makeTab() } });
  await click(button(find(cards.content, node => node.dataset.connector === 'bolt'), 'Open'));
  assert.equal(cards.opens.length, 0, 'a copy handoff opens no tab');
  await click(button(find(cards.content, node => node.dataset.connector === 'razorpay'), 'Visit site'));
  assert.equal(cards.opens.length, 0, 'a vendor page opens from the click itself, with no waiting first');
  const visit = cards.anchors.find(node => node.attributes.href === 'https://razorpay.com/');
  assert.ok(visit, 'the vendor page opened through a temporary link');
  assert.equal(visit.attributes.target, '_blank');
  assert.equal(visit.attributes.rel, 'noopener noreferrer');
});

test('in a paired browser, a blocked tab sends nothing, and a failed handoff or a refused link closes the tab and sends nothing', async () => {
  const blocked = await place('build', {}, { browser: { open: () => null } });
  const before = blocked.calls.length;
  await click(button(blocked.content, 'Open in Lovable'));
  assert.equal(blocked.calls.length, before, 'no request at all');
  assert.ok(text(blocked.content).includes('Your browser blocked the new tab. Allow pop-ups for Chausar and try again.'));

  const failingTab = makeTab();
  const failing = await place('build', { overrides: { 'venture.build.handoff': () => { throw Object.assign(new Error('Write the brief again first.'), { code: 'BRIEF_STALE' }); } } }, { browser: { open: () => failingTab } });
  await click(button(failing.content, 'Open in Lovable'));
  assert.equal(failingTab.closed, true, 'the empty tab is closed');
  assert.equal(failingTab.url, null);
  assert.equal(failing.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(failing.content).includes('Write the brief again first.'));

  const refusedTab = makeTab();
  const refused = await place('build', { overrides: { 'venture.build.handoff': () => ({ ...F.handoffPlans.lovable, url: 'https://lovable.example/#prompt=x' }) } }, { browser: { open: () => refusedTab } });
  await click(button(refused.content, 'Open in Lovable'));
  assert.equal(refusedTab.closed, true);
  assert.equal(refusedTab.url, null, 'an unlisted site never loads');
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(refused.content).includes('Chausar opens only its listed partner sites.'));
});

test('Bolt on Connections copies the brief, then marks the handoff opened; a failed copy sends nothing', async () => {
  const h = await place('connections');
  const bolt = find(h.content, node => node.dataset.connector === 'bolt');
  await click(button(bolt, 'Open'));
  assert.deepEqual(h.clipboard, [F.handoffPlans.bolt.clipboardText]);
  assert.deepEqual(h.calls.filter(call => call.method.startsWith('venture.build.')).map(call => call.method), ['venture.build.handoff', 'venture.build.handoffOpened']);
  assert.equal(h.externalInvokes.length, 0, 'copy mode opens nothing');

  const noClipboard = await place('connections', {}, { clipboard: false });
  await click(button(find(noClipboard.content, node => node.dataset.connector === 'bolt'), 'Open'));
  assert.equal(noClipboard.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(noClipboard.content).includes('This window cannot copy. Use Save instead.'));

  const refused = await place('connections', {}, { clipboard: 'refuse' });
  const refusedBolt = find(refused.content, node => node.dataset.connector === 'bolt');
  await click(button(refusedBolt, 'Open'));
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false);
  assert.ok(text(refused.content).includes('This window could not copy. Use Save instead.'), 'a refused copy is told in plain words');
  assert.equal(text(refused.content).includes('writeText'), false);
  await click(button(refusedBolt, 'Save brief'));
  assert.deepEqual(refused.saved(), [{ filename: 'brief.md', type: 'text/markdown', text: F.handoffPlans.bolt.clipboardText }], 'the card offers Save beside the refused copy');
  assert.equal(refused.calls.some(call => call.method === 'venture.build.handoffOpened'), false, 'saving is not opening');

  const visit = await place('connections');
  await click(button(find(visit.content, node => node.dataset.connector === 'razorpay'), 'Visit site'));
  assert.deepEqual(visit.opened, ['https://razorpay.com/']);
  assert.equal(buttons(find(visit.content, node => node.dataset.connector === 'razorpay'), 'Open').length, 0, 'a planned chip has no button of its own');
  assert.equal(buttons(find(visit.content, node => node.dataset.connector === 'mail-app'), 'Open').length, 0, 'the mail app has no button');
});

test('following GitHub sends the repo and key from outside any form, clears the key, then reads GitHub', async () => {
  const h = await place('build', { build: 'unfollowed' });
  const key = find(h.content, node => node.tagName === 'input' && node.attributes.type === 'password');
  assert.equal(key.attributes.autocomplete, 'off');
  assert.equal(ancestors(key).some(node => node.tagName === 'form'), false, 'the token field is outside any form');
  assert.ok(text(h.content).includes('Choose Only select repositories, then pick this one repo.'));
  await type(control(h.content, 'Your app repo on GitHub'), 'demo-owner/ledger-cafe-books');
  await type(key, 'github_pat_demo_0000000000000000');
  await click(button(h.content, 'Follow'));
  const link = h.calls.findIndex(call => call.method === 'venture.build.link');
  assert.deepEqual(h.calls[link].payload, { repo: 'demo-owner/ledger-cafe-books', token: 'github_pat_demo_0000000000000000' });
  assert.deepEqual(h.calls[link + 1], { method: 'venture.build.sync', payload: {} });
  assert.equal(key.value, '');
  await click(button(h.content, 'Create a read-only key'));
  assert.deepEqual(h.opened, [new URL(F.buildStatus.tokenLink).href]);
});

test('the followed build shows status words, whose account changed it, and the synthetic recording line', async () => {
  const h = await place('build');
  for (const words of ['Repo connected', 'Last change: Add the services page. By Lovable', 'Brief marker found. UI check passed.', 'These answers come from a synthetic recording, not your real repo.', "What Chausar can't see", 'Check GitHub now']) assert.ok(text(h.content).includes(words), words);
  assert.equal(descendants(h.content).some(node => node.tagName === 'a'), false, 'no links are drawn from engine data');
  await click(button(h.content, 'Check GitHub now'));
  assert.ok(h.calls.some(call => call.method === 'venture.build.sync'));
});

// ---------------------------------------------------------------------------------------------
// 7 and 8: the shell, and engine text staying text
// ---------------------------------------------------------------------------------------------
test('the shell draws seven launch places, then the twelve back office views under one group', async () => {
  const h = await place('today');
  const nav = find(h.app, node => node.tagName === 'nav');
  const pageButtons = descendants(nav).filter(node => node.tagName === 'button' && node.dataset.page);
  assert.deepEqual(pageButtons.slice(0, 7).map(node => node.dataset.page), LAUNCH_IDS);
  const group = find(nav, node => node.tagName === 'details' && node.className === 'nav-group');
  assert.equal(group.children[0].textContent, 'Back office');
  assert.deepEqual(descendants(group).filter(node => node.tagName === 'button' && node.dataset.page).map(node => node.dataset.page), BACK_OFFICE_IDS);
  assert.equal(LAUNCH_IDS.some(id => BACK_OFFICE_IDS.includes(id)), false, 'no id collision');
  assert.deepEqual([...h.renderer.launch.pages.map((entry: string[]) => entry[0])], LAUNCH_IDS);
  assert.equal(find(h.app, node => node.className === 'avatar').textContent, 'L');
  assert.equal(find(h.app, node => node.id === 'current-page').textContent, 'Today');
  assert.equal(find(h.app, node => node.id === 'shell').classList.contains('on-launch'), true);
  assert.equal(group.open, false, 'the back office starts closed on a launch place');

  await h.renderer.navigate('models'); await flush();
  assert.equal(find(h.app, node => node.id === 'shell').classList.contains('on-launch'), false);
  assert.equal(find(h.app, node => node.id === 'current-page').textContent, 'Models');
  assert.equal(find(h.app, node => node.tagName === 'details' && node.className === 'nav-group').open, true, 'the back office group opens for a back office view');
  const models = find(h.app, node => node.id === 'page-content');
  assert.ok(text(models).includes("Your business's AI connections"));
  assert.ok(text(models).includes('They follow your send setting on Trust & access.'));
  assert.ok(text(models).includes('claude-haiku-5-5') && text(models).includes('quick work'));
  assert.ok(text(models).includes('claude-sonnet-5-5') && text(models).includes('plans and drafts'));
  h.renderer.renderShell(); await flush();
  assert.equal(find(h.app, node => node.tagName === 'details' && node.className === 'nav-group').open, true, 'opens when a back office view is current');
});

test('engine text such as an img tag stays a text node', async () => {
  const unsafe = { ...F.preview, oneLiner: { ...F.preview.oneLiner, value: F.UNSAFE_TEXT }, serviceLabel: F.UNSAFE_TEXT };
  const engine = await harness({ overrides: { 'venture.preview': () => unsafe } });
  await engine.renderer.boot(); await flush();
  await type(find(engine.app, node => node.tagName === 'textarea'), F.UNSAFE_TEXT);
  await click(button(engine.app, 'Show my plan'));
  assert.ok(descendants(engine.app).filter(node => node.tagName === '#text' && node.textContent === F.UNSAFE_TEXT).length >= 2);
  assert.equal(descendants(engine.app).some(node => node.tagName === 'img'), false);
  const build = await place('build');
  assert.ok(text(build.content).includes(F.UNSAFE_TEXT), 'brief text containing markup is shown as text');
  assert.equal(descendants(build.content).some(node => node.tagName === 'img'), false, 'only the app icon is an image');
});

// ---------------------------------------------------------------------------------------------
// 9: static checks
// ---------------------------------------------------------------------------------------------
test('launch.js and the launch styles follow the house rules', () => {
  const launchCss = cssSource.slice(cssSource.indexOf('/* launch'));
  assert.ok(launchCss.length > 1000, 'the launch section is appended to styles.css');
  for (const [name, source] of [['launch.js', launchSource], ['launch css', launchCss]] as const) {
    assert.equal(source.includes(String.fromCharCode(0x2014)), false, `${name}: no em dash`);
    assert.deepEqual(houseStyleFindings(source), [], `${name}: no banned words`);
  }
  for (const banned of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'localStorage', 'sessionStorage', 'document.write']) assert.equal(launchSource.includes(banned), false, banned);
  assert.equal(/^\s*(import|export)\s/m.test(launchSource), false, 'classic script');
  assert.equal(cssSource.includes('infinite'), false, 'nothing loops');
  for (const match of launchCss.matchAll(/(\d*\.?\d+)(ms|s)\b/g)) {
    const ms = match[2] === 's' ? Number(match[1]) * 1000 : Number(match[1]);
    assert.ok(ms <= 400, `duration ${match[0]} is over 400 ms`);
  }
  for (const match of launchCss.matchAll(/animation(?:-iteration-count)?:([^;}]+)/g)) {
    for (const token of match[1].trim().split(/\s+/)) if (/^\d+$/.test(token)) assert.equal(token, '1', 'animations run once');
  }
  assert.match(launchCss, /prefers-reduced-motion:reduce\)\{[^}]*0ms/);
  assert.match(launchCss, /prefers-color-scheme:dark/);
  assert.equal(/\.loading:before\{[^}]*animation/.test(cssSource), false, 'the spinner is a still mark');
});

test('the renderer copies of the contract lists match the contracts', async () => {
  const h = await harness();
  for (const method of EVIDENCE_METHODS) assert.ok(h.renderer.evidenceChanges.includes(method), `${method} is in evidenceChanges`);
  assert.deepEqual(JSON.parse(JSON.stringify(h.renderer.EXTERNAL_ORIGINS)), [...EXTERNAL_ORIGINS]);
  const states = Object.fromEntries([...launchSource.slice(launchSource.indexOf('const INDIA_STATES')).split('});')[0].matchAll(/'(\d\d)': '([^']+)'/g)].map(match => [match[1], match[2]]));
  assert.deepEqual(states, { ...INDIA_STATES });
});

test('launch.js does nothing when it loads and defines one frozen factory', () => {
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(launchSource, sandbox, { filename: 'launch.js' });
  const factory = sandbox.ChausarLaunch as { version: number; create: unknown };
  assert.equal(Object.isFrozen(factory), true);
  assert.equal(factory.version, 1);
  assert.equal(typeof factory.create, 'function');
  assert.deepEqual(Object.keys(sandbox), ['ChausarLaunch']);
});

test('without launch.js the app keeps its old setup screen and shell', async () => {
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div');
  app.id = 'app'; notifications.id = 'notifications'; body.append(app, notifications);
  const document = {
    body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => { const node = new Element('#text'); node.textContent = String(value); return node; },
    createElementNS: (_namespace: string, tag: string) => new Element(tag), getElementById: (id: string) => descendants(body).find(node => node.id === id) ?? null, querySelectorAll: (selector: string) => body.querySelectorAll(selector),
  };
  const context = vm.createContext({ document, Node: Element, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, window: { chausar: { request: async () => ({}) }, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} } });
  vm.runInContext(appSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__plain = { launch, applyWorkspaceStatus, state };', context);
  const plain = context.__plain;
  assert.equal(plain.launch, null);
  plain.applyWorkspaceStatus({ open: false });
  assert.ok(text(app).includes('Welcome to Chausar.'), 'the old vault form');
  plain.state.workspace = { name: 'Kiran Retail Demo' };
  plain.applyWorkspaceStatus({ open: true, workspace: { name: 'Kiran Retail Demo' } }); await flush();
  const nav = find(app, node => node.tagName === 'nav');
  assert.deepEqual(descendants(nav).filter(node => node.tagName === 'button' && node.dataset.page).map(node => node.dataset.page), BACK_OFFICE_IDS);
  assert.equal(descendants(nav).some(node => node.tagName === 'details'), false);
});

// ---------------------------------------------------------------------------------------------
// 10: words at rest
// ---------------------------------------------------------------------------------------------
test('each of the seven places stays at or under 120 visible words with one filled button at most', async t => {
  for (const id of LAUNCH_IDS) {
    const h = await place(id);
    const words = wordCount(h.content);
    t.diagnostic(`${id}: ${words} words at rest`);
    if (process.env.P7_SHOW_WORDS) t.diagnostic(visibleText(h.content).join(' ').replace(/s+/g, ' '));
    assert.ok(words > 10, `${id} rendered (${words} words)`);
    assert.ok(words <= 120, `${id} shows ${words} words at rest: ${visibleText(h.content).join(' ').replace(/s+/g, ' ')}`);
    assert.ok(descendants(h.content).filter(node => node.className === 'launch-btn').length <= 1, `${id}: one filled button at most`);
    assert.equal(text(h.content).includes('The engine could not load this view'), false, `${id} loaded`);
    assert.equal(descendants(h.content).some(node => node.className === 'footer-note'), false, `${id}: no back office footer`);
  }
});

// ---------------------------------------------------------------------------------------------
// 11: agents, long requests, practice drafts, outlines, money notices
// ---------------------------------------------------------------------------------------------
test('Rehearse runs one practice client per request and recovers a timed-out run from the stored result', async () => {
  let runs = 0;
  const h = await place('agents', { overrides: {
    'venture.simulation.run': (_method, payload) => {
      runs++;
      if (runs === 2) throw Object.assign(new Error('The engine did not answer in time.'), { code: 'REQUEST_TIMEOUT' });
      return F.simulationRun(payload.scenarioIds[0]);
    },
  } });
  await click(button(h.content, 'Rehearse')); await flush();
  const simulationCalls = h.calls.filter(call => call.method === 'venture.simulation.run');
  assert.deepEqual(simulationCalls.map(call => call.payload), F.scenarios.map(item => ({ scenarioIds: [item.id] })));
  const afterTimeout = h.calls.slice(h.calls.indexOf(simulationCalls[1]) + 1);
  assert.equal(afterTimeout[0].method, 'venture.launch.status');
  assert.deepEqual(afterTimeout[1], { method: 'venture.simulation.get', payload: { runId: 'vsr_bookkeeping-messy' } });
  const messy = find(h.content, node => node.dataset.scenario === 'bookkeeping-messy');
  assert.match(text(messy), /A messy client.*passed/);
  assert.ok(text(messy).includes('USD 0.0021'));
  assert.equal(text(h.content).includes('did not answer in time'), false, 'a timeout is not shown as a failure');
  assert.equal(text(h.content).includes('Still working'), false);
});

test('template rehearsal says it was not judged, and the ladder shows the blocked reason and planned stages', async () => {
  const h = await place('agents', { models: 'templates', overrides: {
    'venture.launch.status': () => F.launchStatusRehearsal,
    'venture.simulation.run': (_method, payload) => F.simulationRun(payload.scenarioIds[0], { modelMode: 'template' }),
  } });
  assert.ok(text(h.content).includes("Connect an AI and rehearse with it first. Template outlines can't be judged."));
  assert.equal(descendants(h.content).filter(node => node.tagName === 'button' && /^Move to/.test(node.textContent)).length, 0);
  const ladder = find(h.content, node => node.className === 'launch-ladder');
  assert.equal(descendants(ladder).filter(node => node.className === 'launch-row-note' && node.textContent === 'planned').length, 2);
  assert.ok(text(h.content).includes('No AI connected. Built-in templates write outlines.'));
  await click(button(h.content, 'Rehearse')); await flush();
  assert.equal(descendants(h.content).filter(node => node.tagName === 'p' && node.textContent === 'Template outline, not judged').length, 3);
});

test('a shadow stage offers one move to the next stage', async () => {
  const h = await place('agents');
  await click(button(h.content, 'Move to approve each draft'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.launch.advance')!.payload, { to: 'approve-each' });
});

test('a waiting draft shows the exact payload and sends it once after the box is ticked', async () => {
  const live = { ...F.modelsConnected, replay: { active: false, label: null } };
  const h = await place('agents', { overrides: { 'venture.models.status': () => live } });
  const waiting = descendants(h.content).filter(node => node.className === 'launch-row' && /waiting for you/.test(node.textContent))[0];
  await click(button(waiting, 'Review'));
  const sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('This is exactly what will be sent to Claude Sonnet 5.5'));
  assert.equal(text(sheet).includes(RECORDING), false, 'no recording line when real calls are made');
  assert.ok(text(sheet).includes('Send this exact text once.'));
  assert.ok(text(sheet).includes(F.waitingRun.preview!.payloadText));
  const approve = button(sheet, 'Approve and send');
  assert.equal(approve.disabled, true);
  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  await click(approve);
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.delivery.approve').map(call => call.payload), [{ runId: 'vdr_wait', digest: F.waitingRun.preview!.digest }]);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'), 'the result appears where the action was');
  assert.equal(text(sheet).includes(RECORDING), false);
});

test('in a demo with recordings, a draft reply opened from Clients says a synthetic recording answers, waiting and ready', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('clients', { overrides: { 'venture.delivery.approve': async () => { await pending; return F.practiceRun; } } }, { timers: true });
  await click(button(h.content, 'Draft a reply'));
  const sheet = openDialog(h.body);
  const recordingBefore = (tag: string) => {
    const nodes = descendants(sheet);
    const line = nodes.findIndex(node => node.tagName === 'p' && node.textContent === RECORDING);
    const target = nodes.findIndex(node => node.tagName === tag);
    assert.ok(line >= 0, 'the recording line is on the sheet');
    assert.ok(target > line, `the recording line sits above the ${tag}`);
  };
  recordingBefore('pre');
  assert.ok(text(sheet).includes('This is exactly what Chausar would send to Claude Sonnet 5.5. In this demo a synthetic recording answers instead.'));
  assert.equal(text(sheet).includes('will be sent to'), false, 'nothing claims a send to the model in a demo');
  assert.ok(text(sheet).includes('Approve this exact text once.'));
  assert.ok(text(sheet).includes(F.waitingRun.preview!.payloadText));

  await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
  void button(sheet, 'Approve and send').dispatch('click'); await flush();
  assert.ok(text(sheet).includes('Writing a draft reply from a synthetic recording'));
  assert.equal(text(sheet).includes('with Claude Sonnet 5.5'), false);
  release(); await flush(12);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'), 'the ready draft is shown where the action was');
  recordingBefore('pre');

  const outline = await place('agents');
  await click(button(descendants(outline.content).filter(node => node.className === 'launch-row' && /outline/.test(node.textContent))[0], 'Review'));
  assert.equal(text(openDialog(outline.body)).includes(RECORDING), false, 'a template outline had no AI, so no recording line');
});

test('in a demo with recordings, rewriting the plan says a synthetic recording writes it', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('business', { blueprint: 'draft', overrides: { 'venture.blueprint.draft': async () => { await pending; return F.blueprintDraftView; } } }, { timers: true });
  void button(h.content, 'Rewrite with AI').dispatch('click'); await flush();
  assert.ok(text(h.content).includes('Writing your plan from a synthetic recording'));
  assert.equal(text(h.content).includes('with Claude Sonnet 5.5'), false);
  release(); await flush(12);
  assert.ok(text(h.content).includes('Accept plan'));
});

test('an approval that times out re-reads the stored draft instead of showing an error', async () => {
  const timeout = () => { throw Object.assign(new Error('The engine did not answer in time.'), { code: 'REQUEST_TIMEOUT' }); };
  const approveTimedOut = async (list?: () => unknown, onApprove?: () => void) => {
    const h = await place('agents', { overrides: { 'venture.delivery.approve': () => { onApprove?.(); return timeout(); }, ...(list ? { 'venture.delivery.list': list } : {}) } });
    const waiting = descendants(h.content).filter(node => node.className === 'launch-row' && /waiting for you/.test(node.textContent))[0];
    await click(button(waiting, 'Review'));
    const sheet = openDialog(h.body);
    await tick(find(sheet, node => node.tagName === 'input' && node.attributes.type === 'checkbox'));
    await click(button(sheet, 'Approve and send'));
    assert.equal(h.calls.at(-1)!.method, 'venture.delivery.list');
    assert.equal(text(sheet).includes('did not answer in time'), false);
    return sheet;
  };
  let approved = false;
  const stored = await approveTimedOut(() => (approved ? [{ ...F.practiceRun, id: 'vdr_wait' }, F.outlineRun] : [F.waitingRun, F.practiceRun]), () => { approved = true; });
  assert.ok(text(stored).includes('Practice draft. Not for the client.'), 'the stored draft is shown');
  assert.ok(text(stored).includes('Total: INR 2,948.82'));
  const stillWaiting = await approveTimedOut();
  assert.ok(text(stillWaiting).includes('Still working. Check again in a minute.'), 'the run is still waiting, so the screen says so');
  assert.equal(buttons(stillWaiting, 'Check again').length, 1);
});

test('a practice draft cannot be accepted, copied or saved; a template outline says no AI wrote it', async () => {
  const h = await place('agents');
  const practice = descendants(h.content).filter(node => node.className === 'launch-row' && /ready to review, practice/.test(node.textContent))[0];
  await click(button(practice, 'Review'));
  let sheet = openDialog(h.body);
  assert.ok(text(sheet).includes('Practice draft. Not for the client.'));
  for (const label of ['Accept', 'Copy', 'Save']) assert.equal(buttons(sheet, label).length, 0, `no ${label} on a practice draft`);
  assert.equal(buttons(sheet, 'Edit').length, 1);
  assert.equal(buttons(sheet, 'Reject').length, 1);
  await click(button(sheet, 'Close'));

  const outline = descendants(h.content).filter(node => node.className === 'launch-row' && /outline/.test(node.textContent))[0];
  await click(button(outline, 'Review'));
  sheet = openDialog(h.body);
  assert.ok(text(sheet).includes("Template outline. No AI wrote this and it doesn't read the client's request."));
  await click(button(sheet, 'Accept'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.delivery.review')!.payload, { runId: 'vdr_outline', verdict: 'accepted' });
  assert.equal(buttons(sheet, 'Copy').length, 1, 'an accepted draft can be copied');
});

test('a draft with a failed check offers Edit and Reject, not Accept', async () => {
  const failed: DeliveryRunRecord = { ...F.outlineRun, id: 'vdr_failed', checks: [{ check: 'required-sections', passed: false, detail: 'The Next steps section is missing.' }] };
  const h = await place('agents', { overrides: { 'venture.delivery.list': () => [failed] } });
  const outline = descendants(h.content).filter(node => node.className === 'launch-row' && /outline/.test(node.textContent))[0];
  await click(button(outline, 'Review'));
  const sheet = openDialog(h.body);
  assert.equal(buttons(sheet, 'Accept').length, 0, 'the engine refuses Accept after a failed check, so the sheet does not offer it');
  assert.equal(buttons(sheet, 'Edit').length, 1);
  assert.equal(buttons(sheet, 'Reject').length, 1);
  assert.ok(text(sheet).includes("A check failed, so this draft can't be accepted as it is. Edit it or reject it."));
  assert.ok(text(sheet).includes('The Next steps section is missing.'));
});

test('the money place and the invoice sheet show the experimental notice; issuing names the exact total', async () => {
  const money = await place('money');
  assert.ok(text(money.content).includes(EXPERIMENTAL));
  assert.ok(text(money.content).includes('Billed and earned leave out tax. Received is the cash that came in, tax included.'));
  for (const display of ['INR 2,499.00', 'INR 2,948.82']) assert.ok(text(money.content).includes(display));
  await click(button(money.content, 'INR 2,499.00'));
  assert.deepEqual(money.calls.at(-1), { method: 'receipts.get', payload: { id: 'rcpt_billed_1' } });
  assert.ok(text(openDialog(money.body)).includes('Billed from one invoice fact in the books.'));

  const clients = await place('clients');
  await click(button(clients.content, 'Open draft invoice'));
  const sheet = openDialog(clients.body);
  assert.equal(descendants(sheet).filter(node => node.textContent === EXPERIMENTAL && node.tagName === 'span').length, 1, 'the notice shows once');
  const issue = button(sheet, 'Issue invoice');
  assert.equal(issue.disabled, true);
  const confirm = find(sheet, node => node.tagName === 'label' && node.textContent === 'I checked this invoice. Its total is INR 2,948.82.');
  await tick(find(confirm, node => node.tagName === 'input'));
  await click(issue);
  assert.deepEqual(clients.calls.find(call => call.method === 'venture.invoice.issue')!.payload, { invoiceId: 'vin_1', digest: F.invoiceDraftView.invoice.digest });
  assert.equal(find(sheet, node => node.className === 'launch-sheet-title').textContent, 'Invoice INV-0001', 'the title follows the issued invoice');
  assert.ok(text(sheet).includes('Record a payment'));
  await type(control(sheet, 'Amount received'), '2948.82');
  await click(button(sheet, 'Record payment'));
  const payment = clients.calls.find(call => call.method === 'venture.payment.record')!.payload;
  assert.equal(payment.amount, '2948.82', 'the amount goes to the engine as typed');
  assert.equal(payment.method, 'bank-transfer');
  assert.equal(payment.receivedOn, new Date().toISOString().slice(0, 10), 'the date field starts at the engine date (UTC)');
});

test('clients and orders: add a client and an order with typed text, draft a reply, mark delivered', async () => {
  const h = await place('clients');
  await click(button(h.content, 'Add client'));
  let sheet = openDialog(h.body);
  await type(control(sheet, 'Name'), 'Cafe Aroma Demo');
  await type(control(sheet, 'Email'), 'owner@aroma.example');
  const state = control(sheet, 'State, for place of supply');
  state.value = '27';
  await click(button(sheet, 'Add client'));
  assert.deepEqual(h.calls.find(call => call.method === 'venture.client.add')!.payload, { name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', stateCode: '27' });

  const fresh = await place('clients');
  await click(button(fresh.content, 'New order'));
  sheet = openDialog(fresh.body);
  await type(control(sheet, 'What the client asked for'), F.order.request);
  await click(button(sheet, 'Add order'));
  assert.deepEqual(fresh.calls.find(call => call.method === 'venture.order.create')!.payload, { clientId: 'vcl_1', offerId: 'offer_1', request: F.order.request, quantity: '1' });

  const orders = await place('clients');
  await click(button(orders.content, 'Draft a reply'));
  assert.deepEqual(orders.calls.find(call => call.method === 'venture.delivery.run')!.payload, { orderId: 'vor_1' });
  assert.ok(text(openDialog(orders.body)).includes('This is exactly what Chausar would send to Claude Sonnet 5.5. In this demo a synthetic recording answers instead.'));
  await click(button(openDialog(orders.body), 'Close'));
  const again = await place('clients');
  await click(button(again.content, 'Mark delivered'));
  const date = control(again.content, 'Delivered on');
  date.value = '2026-10-04';
  await click(buttons(again.content, 'Mark delivered').at(-1)!);
  assert.deepEqual(again.calls.find(call => call.method === 'venture.order.deliver')!.payload, { orderId: 'vor_1', deliveredOn: '2026-10-04' });
});

test('while a model writes, the screen shows a still outline and one line of words, never a spinner', async () => {
  let release: () => void = () => {};
  const pending = new Promise<void>(accept => { release = accept; });
  const h = await place('agents', { overrides: { 'venture.simulation.run': async (_method, payload) => { await pending; return F.simulationRun(payload.scenarioIds[0]); } } }, { timers: true });
  void button(h.content, 'Rehearse').dispatch('click'); await flush();
  const clean = find(h.content, node => node.dataset.scenario === 'bookkeeping-clean');
  assert.ok(descendants(clean).some(node => node.className === 'launch-outline' && node.attributes['aria-hidden'] === 'true'));
  assert.ok(text(clean).includes('Rehearsing with a practice client: A tidy client'));
  assert.equal(descendants(h.app).some(node => /loading|spinner|shimmer|pulse/.test(node.className)), false);
  release(); await flush(12);
  assert.ok(text(find(h.content, node => node.dataset.scenario === 'bookkeeping-clean')).includes('passed'));
});

test('Today lists what awaits the owner, the checklist as 7 of 12, the money line and the day line', async () => {
  const h = await place('today');
  for (const words of ['A draft reply waits for your approval', 'A practice draft is ready to review', 'A draft invoice is ready to issue', 'Add your AI (optional)', '7 of 12', 'Billed (without tax)', 'Received (with tax)', 'Earned (without tax)', 'Plan accepted', 'GitHub checked']) {
    assert.ok(text(h.content).includes(words), words);
  }
  assert.deepEqual(h.calls.filter(call => call.method === 'venture.events').map(call => call.payload), [{ limit: 1 }, { afterSeq: 8, limit: 6 }]);
  await click(button(h.content, 'INR 2,948.82'));
  assert.deepEqual(h.calls.at(-1), { method: 'receipts.get', payload: { id: 'rcpt_received_1' } });
});
