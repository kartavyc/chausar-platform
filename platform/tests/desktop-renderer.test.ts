import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import vm from 'node:vm';
import { randomUUID, createHash } from 'node:crypto';

// Execute the actual renderer and preload with a structured-clone IPC fixture.
// Host-Node worker integration uses only a fresh synthetic temporary vault. No Electron/GUI/network.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const contract = require(join(root, 'app/desktop/ipc-contract.cjs'));
const sources = await Promise.all(['app/renderer/app.js', 'app/desktop/preload.cjs', 'app/desktop/ipc-contract.cjs'].map(async path => ({ path, source: await readFile(join(root, path), 'utf8') })));
const rendererSource = sources[0].source;
const preloadSource = sources[1].source;

class Element {
  tagName: string; children: Element[]; attributes: Record<string,string>; listeners: Map<string, ((event: any) => unknown)[]>; value: string; checked: boolean; disabled: boolean; className: string; classList: { add(): void; remove(): void; toggle(): void }; parent?: Element; id?: string; textContent?: string;
  constructor(tag: string) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = new Map(); this.value = ''; this.checked = false; this.disabled = false; this.className = ''; this.classList = { add() {}, remove() {}, toggle() {} }; }
  setAttribute(key: string, value: unknown) { this.attributes[key] = String(value); if (key === 'value') this.value = String(value); if (key === 'id') this.id = String(value); }
  append(...children: Element[]) { for (const child of children) { child.parent = this; this.children.push(child); } if (this.tagName === 'select' && this.children.length === children.length && children.length) this.value = children[0].value; }
  replaceChildren(...children: Element[]) { this.children = []; this.append(...children); }
  addEventListener(name: string, handler: (event: any) => unknown) { const handlers = this.listeners.get(name) || []; handlers.push(handler); this.listeners.set(name, handlers); }
  async dispatch(name: string) { for (const handler of this.listeners.get(name) || []) await handler({ preventDefault() {}, currentTarget: this, target: this }); }
  focus() {} remove() {} scrollIntoView() {} showModal() {} close() {}
}
function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
function find(node: Element, predicate: (node: Element) => boolean) { const found = descendants(node).find(predicate); assert.ok(found, 'Expected actual renderer control to be present.'); return found; }
function controlFor(node: Element, label: string) { const field = find(node, item => item.className === 'field' && item.children[0]?.children[0]?.textContent === label); return field.children[1]; }

async function harness({ failureQuestion, dispatch, routes = [], preview } : { failureQuestion?: string; dispatch?: (method: string, payload: Record<string,unknown>) => Promise<unknown>; routes?: any[]; preview?: any } = {}) {
  const calls: any[] = [], wires: any[] = [], rejected: any[] = [];
  let exposed: any;
  const ipcRenderer = {
    async invoke(channel: string, envelope: unknown) {
      assert.equal(channel, 'chausar:request');
      // Electron IPC serializes via structured clone, which keeps own undefined properties.
      // Do not JSON-roundtrip here: doing so would mask the original native-only bug.
      const wire = structuredClone(envelope); wires.push(wire);
      try {
        const request = contract.validateRequest(wire); calls.push(request);
        if (dispatch) return structuredClone({ ok: true, result: await dispatch(request.method, request.payload) });
        if (request.method === 'conversation.ask' && request.payload.question === failureQuestion) return { ok: false, error: { code: 'FIXTURE_REFUSED', message: 'Synthetic refusal.' } };
        let result;
        if (request.method === 'models.list') result = routes;
        else if (request.method === 'models.preview') result = preview;
        else if (request.method === 'dashboard.get') result = { factCount: 10, sources: 1, policy: { send: 'nothing' } };
        else if (request.method === 'conversation.ask') result = { status: 'unsupported', reason: 'Synthetic engine reply; no real engine was started.' };
        else result = { echoed: request.payload };
        return structuredClone({ ok: true, result });
      } catch (error: any) { const typed = contract.publicError(error); rejected.push({ wire, error: typed }); return { ok: false, error: typed }; }
    },
    on() {}, removeListener() {},
  };
  vm.runInNewContext(preloadSource, { require: (name: string) => { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name: string, api: any) { assert.equal(name, 'chausar'); exposed = api; } } }; } }, { filename: join(root, 'app/desktop/preload.cjs') });
  assert.ok(exposed);
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div');
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => Object.assign(new Element('#text'), { textContent: String(value) }), createElementNS: (namespaceURI: string, tag: string) => Object.assign(new Element(tag), { namespaceURI }), getElementById: (id: string) => id === 'app' ? app : id === 'notifications' ? notifications : null, querySelectorAll: () => [] };
  const context: any = { document, Node: Element, window: { chausar: exposed, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} }, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, fetch() { throw new Error('Unexpected HTTP path in desktop boundary regression.'); } };
  assert.match(rendererSource, /\bboot\(\);\s*$/);
  // Disable only automatic boot; execute all actual renderer functions, including request/composer.
  vm.runInNewContext(rendererSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__test = { request, renderConversation, renderAnswer, showCalculator, state };', context, { filename: join(root, 'app/renderer/app.js') });
  const renderer = context.__test;
  const page = await renderer.renderConversation();
  const composer = find(page, node => node.tagName === 'form' && node.className === 'composer');
  const question = find(composer, node => node.tagName === 'textarea');
  const submit = find(composer, node => node.tagName === 'button' && node.attributes.type === 'submit');
  async function ask(text: string) { question.value = text; await composer.dispatch('submit'); }
  return { renderer, exposed, calls, wires, rejected, body, page, composer, question, submit, ask };
}

test('actual local composer submits ordinary question through actual preload and strict clone boundary', async t => {
  t.diagnostic(`source root: ${root}`);
  for (const { path, source } of sources) t.diagnostic(`${path} sha256=${createHash('sha256').update(source).digest('hex')}`);
  const h = await harness(); await h.ask('what is the business about');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask'), [{ method: 'conversation.ask', payload: { question: 'what is the business about' } }]);
  assert.equal(h.rejected.length, 0);
  assert.equal(h.renderer.state.messages.at(-1).error, undefined);
  assert.equal(h.submit.disabled, false);
});

test('actual composer accepts repeated questions and recovers after typed engine refusal', async () => {
  const h = await harness({ failureQuestion: 'fixture refusal' });
  for (const question of ['what is the business about', 'fixture refusal', 'What was billed?']) await h.ask(question);
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask').map(call => call.payload), [{ question: 'what is the business about' }, { question: 'fixture refusal' }, { question: 'What was billed?' }]);
  assert.equal(h.rejected.length, 0);
  assert.equal(h.renderer.state.messages[3].error, 'Synthetic refusal.');
  assert.equal(h.renderer.state.messages.at(-1).error, undefined);
  assert.equal(h.renderer.state.messages.length, 6);
  assert.equal(h.submit.disabled, false);
});

test('actual calculator omits blank optional parameters rather than transmitting undefined', async () => {
  const h = await harness(); h.renderer.showCalculator();
  const form = find(h.body, node => node.tagName === 'form'); await form.dispatch('submit');
  assert.deepEqual(h.calls.filter(call => call.method === 'calculation.run'), [{ method: 'calculation.run', payload: { operation: 'billed' } }]);
  assert.equal(h.rejected.length, 0);
});

test('actual calculator preserves selected nested period and branch parameters', async () => {
  const h = await harness(); h.renderer.showCalculator();
  controlFor(h.body, 'Period from').value = '2026-09-01'; controlFor(h.body, 'Period to').value = '2026-09-30'; controlFor(h.body, 'Branch').value = 'main';
  const form = find(h.body, node => node.tagName === 'form'); await form.dispatch('submit');
  assert.deepEqual(h.calls.filter(call => call.method === 'calculation.run'), [{ method: 'calculation.run', payload: { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, branch: 'main' } }]);
  assert.equal(h.rejected.length, 0);
});

test('renderer request keeps valid JSON false zero null and array members unchanged', async () => {
  const h = await harness();
  const payload = { confirmed: false, zero: 0, nil: null, nested: { values: [null, false, 0, ''] } };
  await h.renderer.request('calculation.run', payload);
  assert.deepEqual(h.calls.at(-1), { method: 'calculation.run', payload });
});

test('actual preload leaves strict validator rejecting undefined and invalid numeric values', async () => {
  const h = await harness();
  for (const payload of [{ routeId: undefined }, { nested: { optional: undefined } }, { values: [undefined] }, { amount: NaN }, { amount: Infinity }]) await assert.rejects(h.exposed.request('conversation.ask', payload), { code: 'INVALID_REQUEST' });
  assert.equal(h.rejected.length, 5);
  assert.equal(h.calls.filter(call => call.method === 'conversation.ask').length, 0);
});


test('selected route keeps defined preview values and returning to local calculation omits them', async () => {
  const h = await harness({ routes: [{ id: 'fixture-route', kind: 'fixture', model: 'fixture' }], preview: { id: 'fixture-preview', approvalRequired: false } });
  const route = find(h.composer, node => node.tagName === 'select');
  route.value = 'fixture-route'; await h.ask('What was billed?');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask')[0], { method: 'conversation.ask', payload: { question: 'What was billed?', routeId: 'fixture-route', previewId: 'fixture-preview' } });
  route.value = ''; await h.ask('What was margin?');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask')[1], { method: 'conversation.ask', payload: { question: 'What was margin?' } });
  assert.equal(h.rejected.length, 0);
});

test('actual business context renderer keeps citations as safe text and opens its context receipt through strict preload', async () => {
  const answer = { id: 'synthetic-business-answer', kind: 'business-context', status: 'partial',
    claims: [{ text: '<img src=x onerror=untrusted> is quoted owner text', origin: 'owner-told', qualification: 'owner-stated', citationIds: ['synthetic-citation'] }],
    unknowns: [{ category: 'products', message: 'Products are unknown in this synthetic evidence.' }], conflicts: [],
    citations: [{ id: 'synthetic-citation', kind: 'profile', referenceId: 'synthetic-profile', contentHash: 'a'.repeat(64) }],
    scope: { completeness: 'bounded' }, contextDigest: 'b'.repeat(64), receipt: { id: 'synthetic-business-answer', financialCalculation: false } };
  const h = await harness({ dispatch: async (method, payload) => { if (method === 'business.context.receipt') { assert.deepEqual(payload, { id: answer.id }); return answer; } return {}; } });
  const rendered = h.renderer.renderAnswer(answer) as Element;
  assert.ok(descendants(rendered).some(node => node.tagName === '#text' && node.textContent === answer.claims[0].text));
  assert.equal(descendants(rendered).some(node => node.tagName === 'img'), false);
  assert.ok(descendants(rendered).some(node => node.textContent === answer.unknowns[0].message));
  const open = find(rendered, node => node.tagName === 'button' && descendants(node).some(child => child.textContent === 'Open business context receipt'));
  await open.dispatch('click'); assert.equal(h.rejected.length, 0);
  assert.deepEqual(h.calls.filter(call => call.method === 'business.context.receipt'), [{ method: 'business.context.receipt', payload: { id: answer.id } }]);
  assert.equal(h.calls.some(call => call.method === 'receipts.get'), false);
});

test('actual local question reaches the host-Node worker and subsequent billed question succeeds', async t => {
  const { EngineHarness } = require(join(root,'app/desktop/engine-harness.cjs'));
  const directory = await mkdtemp(join(tmpdir(),'chausar-renderer-worker-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['path','systemroot','windir','temp','tmp','userprofile'].includes(name.toLowerCase())));
  const engine = new EngineHarness({ workerPath: join(root,'platform/runtime/worker.ts'), environment: { ...environment, CHAUSAR_ENGINE_VERSION: '0.1.0-preview.1', CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' } });
  t.after(async () => {
    await engine.stop();
    const target = resolve(directory), child = relative(resolve(tmpdir()), target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-renderer-worker-'));
    await rm(target,{recursive:true,force:true});
  });
  await engine.start();
  // This is a disposable synthetic fixture passphrase, unrelated to any user's vault.
  await engine.request('workspace.create',{name:'Synthetic IPC fixture',folder:'fixture',passphrase:'synthetic-fixture-only',demo:true});
  const h = await harness({ dispatch: (method,payload) => engine.request(method,payload) });
  await h.ask('what is the business about');
  assert.equal(h.rejected.length, 0); assert.equal(h.renderer.state.messages.at(-1).error, undefined);
  const contextAnswer = h.renderer.state.messages.at(-1).data;
  assert.equal(contextAnswer.kind, 'business-context');
  assert.equal(contextAnswer.status, 'unknown');
  assert.equal(contextAnswer.receipt.financialCalculation, false);
  assert.equal(contextAnswer.unknowns.length, 5);
  assert.ok(contextAnswer.citations.length > 0);
  const savedContext = await engine.request('business.context.receipt', { id: contextAnswer.receipt.id });
  assert.equal(savedContext.contextDigest, contextAnswer.contextDigest);
  assert.deepEqual(savedContext.citations, contextAnswer.citations);
  await h.ask('What was billed?');
  assert.equal(h.rejected.length, 0); assert.equal(h.renderer.state.messages.at(-1).error, undefined);
  const answer = h.renderer.state.messages.at(-1).data;
  assert.equal(answer.supported, true);
  assert.equal(answer.receipt.operation, 'billed');
  assert.equal(answer.receipt.currency, 'INR');
  // The authored synthetic CSV contains two invoices, INR1000 and INR2000.
  assert.equal(answer.receipt.totalMinor, '300000');
  assert.equal(answer.receipt.rowIds.length, 2);
  const retained = await engine.request('receipts.get', { id: answer.receipt.id });
  assert.equal(retained.id, answer.receipt.id);
  assert.equal(retained.totalMinor, '300000');
  assert.deepEqual(retained.rowIds, answer.receipt.rowIds);
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask').map(call => call.payload),[{question:'what is the business about'},{question:'What was billed?'}]);
  const stopped = await engine.stop(); assert.equal(stopped.graceful,true);
});
