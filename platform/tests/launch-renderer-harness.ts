// Shared harness for the launch and onboarding renderer tests: runs the real launch.js and app.js in one vm context
// with a fake DOM whose innerHTML and outerHTML setters throw, the real preload, and the real IPC contract validator.
// The engine is a fake that answers from the typed synthetic fixtures in fixtures/venture/renderer, including the
// draft desk before the vault (venture.ai.* and venture.compose.*). No network, no Electron, no model.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import type { BooksPeriodChoice, BooksSummary, ModelPreset } from '../runtime/venture/contracts.ts';
import type { AiStatusView, ComposeDecision, ComposedPlan } from '../runtime/venture/onboarding-contracts.ts';
import { applyComposePatch } from '../runtime/venture/core/compose.ts';
import * as F from './fixtures/venture/renderer/results.ts';
import * as O from './fixtures/venture/renderer/onboarding.ts';
import { kindByRules } from './fixtures/venture/onboarding/kind-rules.ts';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
export const contract = require(join(root, 'app/desktop/ipc-contract.cjs'));
export const [appSource, launchSource, preloadSource, cssSource, indexSource] = await Promise.all(
  ['app/renderer/app.js', 'app/renderer/launch.js', 'app/desktop/preload.cjs', 'app/renderer/styles.css', 'app/renderer/index.html'].map(path => readFile(join(root, path), 'utf8')));
export const LAUNCH_IDS = ['today', 'business', 'build', 'clients', 'agents', 'money', 'connections'];
export const BACK_OFFICE_IDS = ['conversation', 'brief', 'sources', 'dictionary', 'memory', 'decisions', 'actions', 'jobs', 'trust', 'models', 'plugins', 'activity'];
export const EXPERIMENTAL = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
export const KEY = 'sk-ant-demo-0000000000000000000000';
export const RECORDING = 'AI answers here come from a synthetic recording.';
export const BOTH_RECORDED = 'AI answers and GitHub reads here come from a synthetic recording.';
export const CLIENT = 'Cafe Aroma Demo';
/** The fixtures' business is in India, so the engine's day basis is Asia/Kolkata. */
export const ZONE = 'Asia/Kolkata';
export function ownerDay(zone = ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const PERIODS: BooksPeriodChoice[] = [
  { key: 'all', label: 'All time', from: '2026-10-01', to: '2026-10-31' }, { key: 'this-month', label: 'This month', from: '2026-10-01', to: '2026-10-31' },
  { key: 'last-month', label: 'Last month', from: '2026-09-01', to: '2026-09-30' }, { key: 'this-year', label: 'This year', from: '2026-01-01', to: '2026-12-31' },
];
/** The books summary as the engine now answers it: a named period or the owner's own dates, on the owner's calendar. */
export function booksFor(payload: { period?: string; from?: string; to?: string }): BooksSummary {
  const custom = payload.from !== undefined || payload.to !== undefined;
  const chosen = PERIODS.find(item => item.key === (payload.period ?? 'all'))!;
  return {
    ...F.booksSummary, period: { from: payload.from ?? chosen.from, to: payload.to ?? chosen.to }, periodKey: custom ? 'custom' : chosen.key,
    periods: PERIODS, today: ownerDay(), timeZone: ZONE,
  };
}

export type Handler = (event: { target: Element; currentTarget: Element; preventDefault(): void }) => unknown;
export class Element {
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
export function matches(node: Element, selector: string) {
  if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  return node.tagName === selector;
}
/** Whether a node carries a class: look B adds enter classes such as ob-in-1 beside the named one. */
export function hasClass(node: Element, name: string) { return node.className.split(/\s+/).includes(name); }
export function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
export function find(node: Element, predicate: (item: Element) => boolean, message = 'Expected a renderer control.') { const found = descendants(node).find(predicate); assert.ok(found, message); return found; }
export function buttons(node: Element, label: string) { return descendants(node).filter(item => item.tagName === 'button' && item.textContent === label); }
export function button(node: Element, label: string) { const found = buttons(node, label)[0]; assert.ok(found, `Expected button "${label}".`); return found; }
export function control(node: Element, label: string) {
  const field = find(node, item => (hasClass(item, 'launch-field') || item.className === 'field') && item.children[0]?.textContent === label, `Expected field "${label}".`);
  return field.children[1];
}
export function ancestors(node: Element) { const list: Element[] = []; for (let parent = node.parent; parent; parent = parent.parent) list.push(parent); return list; }
export function openDialog(body: Element) { const found = descendants(body).filter(item => item.tagName === 'dialog' && item.open).at(-1); assert.ok(found, 'Expected an open sheet or dialog.'); return found; }
export async function flush(times = 6) { for (let i = 0; i < times; i++) await new Promise<void>(accept => setImmediate(accept)); }
export async function click(node: Element) { await node.dispatch('click'); await flush(); }
export async function type(input: Element, value: string) { input.value = value; await input.dispatch('input'); }
export async function tick(box: Element) { box.checked = true; await box.dispatch('change'); }

/** Words a person reads at rest: closed details show only their summary; hidden nodes and closed dialogs show nothing. */
export function visibleText(node: Element): string[] {
  if (node.hidden || (node.tagName === 'dialog' && !node.open)) return [];
  if (node.tagName === 'option') return [];
  if (node.tagName === 'select') return [descendants(node).find(item => item.tagName === 'option' && item.value === node.value)?.textContent ?? ''];
  if (node.tagName === 'details' && !node.open) { const summary = node.children.find(child => child.tagName === 'summary'); return summary ? visibleText(summary) : []; }
  const own = [node.ownText];
  if (node.attributes.placeholder) own.push(node.attributes.placeholder);
  if (node.tagName === 'input' && node.attributes.type !== 'password' && node.attributes.type !== 'checkbox') own.push(node.value);
  return [...own, ...node.children.flatMap(visibleText)];
}
export function wordCount(node: Element) { return visibleText(node).join(' ').split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length; }
export function text(node: Element) { return node.textContent; }
/** A draft reply row on Agents whose words match; the client's name on it is the button that opens the draft. */
export function draftRow(node: Element, words: RegExp) {
  const found = descendants(node).filter(item => item.className === 'launch-row' && words.test(item.textContent))[0];
  assert.ok(found, `Expected a draft row matching ${words}.`);
  return found;
}
export async function openDraft(node: Element, words: RegExp) { await click(button(draftRow(node, words), CLIENT)); }

// ---------------------------------------------------------------------------------------------
// The fake engine
// ---------------------------------------------------------------------------------------------
export type Dispatch = (method: string, payload: Record<string, any>) => unknown;
/** The draft desk before the vault: the AI status, the presets, the terms gate, the held plan, and a failing second pair call. */
export type DraftOptions = { ai?: AiStatusView; presets?: ModelPreset[]; gateOpen?: boolean; held?: { key: O.DecisionKey; decision: ComposeDecision; plan: ComposedPlan | null } | null; failMain?: boolean; replay?: boolean };
export type EngineOptions = { open?: boolean; venture?: boolean; blueprint?: 'draft' | 'accepted' | null; models?: 'connected' | 'templates'; build?: 'followed' | 'unfollowed'; draft?: DraftOptions; overrides?: Record<string, Dispatch> };
export function fakeEngine(options: EngineOptions = {}) {
  const world = {
    open: options.open ?? false,
    venture: options.venture ?? false,
    blueprint: options.blueprint === undefined ? 'accepted' as 'draft' | 'accepted' | null : options.blueprint,
    invoice: 'draft' as 'draft' | 'issued',
    uploads: [...F.uploads],
    questions: F.templateQuestions.filter(question => question.id !== 'q_tax_rate').map(question => ({ ...question, answer: null as any, answerMinor: null, answerBps: null, answeredAt: null })),
    /** True once venture.create adopted a composed plan: the vault then answers with the composed business. */
    composed: false,
    draft: {
      ai: options.draft?.ai ?? O.statusNone, presets: options.draft?.presets ?? (options.draft?.gateOpen ? O.presetsGateOpen : O.presets), gateOpen: options.draft?.gateOpen ?? false,
      key: options.draft?.held?.key ?? null, decision: options.draft?.held?.decision ?? null, plan: options.draft?.held?.plan ?? null,
    } as DraftWorld,
  };
  const draftDispatch = draftEngine(world, options.draft ?? {});
  const interviewView = () => {
    const next = world.questions.find(question => question.answer === null) ?? null;
    return { interview: { id: 'vin_demo', kind: 'venture-interview', ventureId: 'vnt_demo', memberId: 'owner', epoch: 1, at: '2026-10-15T09:30:00.000Z', serviceType: { value: 'bookkeeping', label: 'assumption', by: 'template' }, questions: world.questions, modelCallIds: [], source: 'template' }, next, done: next === null, asked: world.questions.filter(question => question.answer !== null).length, limit: 6 };
  };
  const dispatch: Dispatch = (method, payload) => {
    const override = options.overrides?.[method];
    if (override) return override(method, payload);
    if (method.startsWith('venture.ai.') || method.startsWith('venture.compose.')) return draftDispatch(method, payload);
    if (world.composed) {
      switch (method) {
        case 'venture.get': return O.composedVentureView;
        case 'venture.blueprint.get': return world.blueprint === 'accepted' ? O.composedBlueprintAccepted : O.composedBlueprintView;
        case 'venture.blueprint.accept': world.blueprint = 'accepted'; return O.composedBlueprintAccepted;
        case 'venture.price.quote': return O.composedReceipt;
        default: break;
      }
    }
    switch (method) {
      case 'workspace.status': return { open: world.open, workspace: world.open ? { name: 'Ledger Cafe Books' } : undefined, storage: 'experimental-file', experimental: true, version: '0.1.0-preview.1' };
      case 'workspace.create': world.open = true; return { workspace: { name: payload.name }, recoveryKit: 'DEMO-RECOVERY-CODE', recoveryCode: 'DEMO-RECOVERY-CODE', experimental: true };
      case 'venture.countries': return O.countries;
      case 'venture.preview': return { ...F.preview, idea: payload.idea };
      case 'venture.create':
        world.venture = true;
        if (payload.composeId) {
          assert.ok(world.draft.plan && payload.composeId === world.draft.plan.composeId && payload.composedDigest === world.draft.plan.digest, 'venture.create names the held plan by id and digest');
          world.composed = true; world.blueprint = 'draft'; world.draft.plan = null; world.draft.decision = null;
          return O.composedVentureView;
        }
        return F.ventureView;
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
      case 'venture.books.summary': return booksFor(payload);
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
      case 'venture.delivery.answer': return F.answeredRun;
      case 'venture.files.list': return world.uploads.filter(item => payload.orderId === undefined || (item.scope.kind === 'order' && item.scope.orderId === payload.orderId));
      case 'venture.files.add': {
        const added = { ...F.uploads[0], id: `upload_${world.uploads.length + 1}`, name: payload.name, format: String(payload.name).split('.').pop() as 'csv', bytes: Buffer.from(payload.contentBase64, 'base64').length, scope: { kind: 'order' as const, orderId: payload.orderId } };
        world.uploads.push(added);
        return added;
      }
      case 'venture.work.get': assert.equal(payload.id, F.workReceipt.id); return F.workReceipt;
      case 'venture.improve.status': return F.improveIdle;
      case 'venture.improve.run': return F.improveKeptRun;
      case 'venture.improve.adopt': return F.adoptedPlaybook;
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
export type FakeTab = { opener: unknown; closed: boolean; url: string | null; location: { replace(url: string): void }; close(): void };
export function makeTab(): FakeTab {
  const tab: FakeTab = { opener: { page: 'chausar' }, closed: false, url: null, location: { replace: (url: string) => { tab.url = url; } }, close: () => { tab.closed = true; } };
  return tab;
}
/** Blob and URL for saveText: each saved file is kept so a test can read its name, type and text. */
export class FakeBlob { readonly text: string; readonly type: string; constructor(parts: unknown[], options: { type?: string } = {}) { this.text = parts.map(String).join(''); this.type = options.type ?? ''; } }
export type HarnessOptions = { openExternal?: (url: string) => unknown; clipboard?: boolean | 'refuse'; timers?: boolean; browser?: { open: () => FakeTab | null }; language?: string };
export async function harness(engine: EngineOptions = {}, options: HarnessOptions = {}) {
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
  const navigator = options.clipboard === false ? undefined : { language: options.language ?? 'en-IN', clipboard: { writeText: async (value: string) => { if (options.clipboard === 'refuse') throw new Error("Failed to execute 'writeText' on 'Clipboard': Write permission denied."); clipboard.push(value); } } };
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
    document, Node: Element, navigator, crypto: { randomUUID }, URL: TestURL, URLSearchParams, structuredClone, console, Blob: FakeBlob, window, btoa,
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
export async function place(id: string, engine: EngineOptions = {}, options: HarnessOptions = {}) {
  const h = await harness({ open: true, venture: true, ...engine }, options);
  await h.renderer.boot(); await flush();
  if (id !== 'today') { await h.renderer.navigate(id); await flush(); }
  const content = find(h.app, node => node.id === 'page-content');
  return { ...h, content };
}

// ---------------------------------------------------------------------------------------------
// The draft desk before the vault: connect an AI, decide, fill, update. The kind comes from the test-only rules.
// ---------------------------------------------------------------------------------------------
export type DraftWorld = { ai: AiStatusView; presets: ModelPreset[]; gateOpen: boolean; key: O.DecisionKey | null; decision: ComposeDecision | null; plan: ComposedPlan | null };
const refuse = (code: string, message: string) => Object.assign(new Error(message), { code });
function draftEngine(world: { venture: boolean; draft: DraftWorld }, options: DraftOptions): Dispatch {
  return (method, payload) => {
    const draft = world.draft;
    if (world.venture) throw refuse('VENTURE_EXISTS', 'Your business already has its AI settings under Trust.');
    switch (method) {
      case 'venture.ai.status': return draft.ai;
      case 'venture.ai.options': return O.options(draft.ai, draft.presets, draft.gateOpen);
      case 'venture.ai.calls': return O.calls;
      case 'venture.ai.connect': {
        const preset = draft.presets.find(item => item.id === payload.presetId);
        if (!preset || payload.consentDigest !== preset.consentDigest) throw refuse('MODEL_CONSENT_REQUIRED', 'Read and agree to what is sent first.');
        if (preset.needsKey && (typeof payload.apiKey !== 'string' || payload.apiKey.length < 20)) throw refuse('INVALID_VENTURE_REQUEST', 'Paste the whole key.');
        switch (preset.id) {
          case 'anthropic-haiku-5-5': draft.ai = O.statusHalf; break;
          case 'anthropic-sonnet-5-5':
            if (options.failMain) throw refuse('MODEL_FAILED', O.PASS_THROUGH.MODEL_FAILED);
            draft.ai = options.replay ? O.statusPairReplay : O.statusPair; break;
          case 'openai-gpt-6-luna': draft.ai = O.statusLuna; break;
          case 'claude-code-cli':
            if (!draft.gateOpen) throw refuse('PRESET_UNAVAILABLE', preset.availabilityReason);
            draft.ai = O.statusClaudeCode; break;
          default: throw refuse('PRESET_UNAVAILABLE', preset.availabilityReason);
        }
        return draft.ai;
      }
      case 'venture.compose.get': return draft.decision ? { decision: draft.decision, plan: draft.plan } : null;
      case 'venture.compose.decide': {
        assert.deepEqual(Object.keys(payload).sort(), ['countryCode', 'text'], 'decide gets exactly the text and the country');
        const country = O.countries.find(item => item.code === payload.countryCode);
        if (!country) throw refuse('UNKNOWN_COUNTRY', 'Choose a country from the list.');
        draft.key = O.KIND_FIXTURE[kindByRules(payload.text)];
        draft.decision = O.decisionFor(draft.key, payload.text, country);
        draft.plan = null;
        return draft.decision;
      }
      case 'venture.compose.fill': {
        if (!draft.decision || payload.composeId !== draft.decision.composeId) throw refuse('COMPOSE_NOT_FOUND', 'Your plan was only kept in memory, and it is gone. Make it again.');
        if (draft.decision.kind === 'not-a-service') throw refuse('COMPOSE_NOT_A_SERVICE', O.landlordDecision.refusal!);
        draft.plan ??= O.planFor(draft.key as O.PlanKey, draft.decision, options.replay ? O.WRITTEN_REPLAY : O.WRITTEN);
        return draft.plan;
      }
      case 'venture.compose.update': {
        assert.deepEqual(Object.keys(payload).sort(), ['composeId', 'patch'], 'update sends only the id and the patch');
        if (!draft.plan || payload.composeId !== draft.plan.composeId) throw refuse('COMPOSE_NOT_FOUND', 'Your plan was only kept in memory, and it is gone. Make it again.');
        draft.plan = applyComposePatch(draft.plan, payload.patch);
        return draft.plan;
      }
      default: throw refuse('UNEXPECTED_FIXTURE_RPC', `Unexpected draft RPC ${method}.`);
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Words at rest: header, left pane and right pane together, with named parts counted on their own
// ---------------------------------------------------------------------------------------------
/** Visible text with the parts named by class left out (the recovery code, the experimental-storage line). */
export function visibleTextExcept(node: Element, except: readonly string[] = []): string[] {
  if (except.some(name => node.className.split(/\s+/).includes(name))) return [];
  if (node.hidden || (node.tagName === 'dialog' && !node.open)) return [];
  if (node.tagName === 'option') return [];
  if (node.tagName === 'select') return [descendants(node).find(item => item.tagName === 'option' && item.value === node.value)?.textContent ?? ''];
  if (node.tagName === 'details' && !node.open) { const summary = node.children.find(child => child.tagName === 'summary'); return summary ? visibleTextExcept(summary, except) : []; }
  const own = [node.ownText];
  if (node.attributes.placeholder) own.push(node.attributes.placeholder);
  if (node.tagName === 'input' && node.attributes.type !== 'password' && node.attributes.type !== 'checkbox') own.push(node.value);
  return [...own, ...node.children.flatMap(child => visibleTextExcept(child, except))];
}
export const REST_EXCEPT = Object.freeze(['ob-code', 'launch-warn']);
/** Words at rest on a whole screen, counted like wordCount: split on spaces, pieces holding a letter or a digit. */
export function restWords(screen: Element, { except = REST_EXCEPT }: { except?: readonly string[] } = {}): number {
  return visibleTextExcept(screen, except).join(' ').split(/\s+/).filter(token => /[\p{L}\p{N}]/u.test(token)).length;
}
export function restText(screen: Element, except: readonly string[] = REST_EXCEPT): string {
  return visibleTextExcept(screen, except).join(' ').replace(/\s+/g, ' ').trim();
}
