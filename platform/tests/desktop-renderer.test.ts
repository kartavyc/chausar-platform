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
  removeAttribute(key: string) { delete this.attributes[key]; }
  append(...children: (Element | string | null | undefined)[]) { for (const child of children) { const node = child instanceof Element ? child : Object.assign(new Element('#text'), { textContent: String(child) }); node.parent = this; this.children.push(node); } if (this.tagName === 'select' && this.children.length === children.length && children.length) this.value = this.children[0].value; }
  replaceChildren(...children: (Element | string | null | undefined)[]) { this.children = []; this.append(...children); }
  addEventListener(name: string, handler: (event: any) => unknown) { const handlers = this.listeners.get(name) || []; handlers.push(handler); this.listeners.set(name, handlers); }
  async dispatch(name: string) { for (const handler of this.listeners.get(name) || []) await handler({ preventDefault() {}, currentTarget: this, target: this }); }
  focus() {} scrollIntoView() {}
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; }
  showModal() { this.attributes.open = ''; }
  close() { delete this.attributes.open; void this.dispatch('close'); }
}
function descendants(node: Element): Element[] { return [node, ...node.children.flatMap(descendants)]; }
function find(node: Element, predicate: (node: Element) => boolean) { const found = descendants(node).find(predicate); assert.ok(found, 'Expected actual renderer control to be present.'); return found; }
function controlFor(node: Element, label: string) { const field = find(node, item => item.className === 'field' && item.children[0]?.children[0]?.textContent === label); return field.children[1]; }

async function harness({ failureQuestion, dispatch, routes = [], preview, mount = false } : { failureQuestion?: string; dispatch?: (method: string, payload: Record<string,unknown>) => Promise<unknown>; routes?: any[]; preview?: any; mount?: boolean } = {}) {
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
  body.append(app, notifications);
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => Object.assign(new Element('#text'), { textContent: String(value) }), createElementNS: (namespaceURI: string, tag: string) => Object.assign(new Element(tag), { namespaceURI }), getElementById: (id: string) => descendants(body).find(node => node.id === id) || (id === 'app' ? app : id === 'notifications' ? notifications : null), querySelectorAll: () => [] };
  const context: any = { document, Node: Element, window: { chausar: exposed, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} }, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, fetch() { throw new Error('Unexpected HTTP path in desktop boundary regression.'); } };
  assert.match(rendererSource, /\bboot\(\);\s*$/);
  // Disable only automatic boot; execute all actual renderer functions, including request/composer.
  vm.runInNewContext(rendererSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__test = { request, renderConversation, renderAnswer, reviewOutbound, showCalculator, showWorkspace, state, showConversationHistory: typeof showConversationHistory === "function" ? showConversationHistory : undefined, showSavedConversation: typeof showSavedConversation === "function" ? showSavedConversation : undefined };', context, { filename: join(root, 'app/renderer/app.js') });
  const renderer = context.__test;
  const page = await renderer.renderConversation();
  const composer = find(page, node => node.tagName === 'form' && node.className === 'composer');
  const question = find(composer, node => node.tagName === 'textarea');
  const submit = find(composer, node => node.tagName === 'button' && node.attributes.type === 'submit');
  if (mount) {
    const current = new Element('span'); current.id = 'current-page';
    const content = new Element('div'); content.id = 'page-content'; content.append(page);
    app.append(current, content);
  }
  async function ask(text: string) {
    const current = mount ? find(app, node => node.tagName === 'form' && node.className === 'composer') : composer;
    find(current, node => node.tagName === 'textarea').value = text; await current.dispatch('submit');
  }
  return { renderer, exposed, calls, wires, rejected, body, app, notifications, page, composer, question, submit, ask };
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


test('selected route requires a verbatim conversation preview while local calculation keeps its explicit fallback', async () => {
  const h = await harness({ routes: [{ id: 'fixture-route', kind: 'fixture', model: 'fixture' }], preview: { id: 'fixture-preview', approvalRequired: false } });
  const route = find(h.composer, node => node.tagName === 'select');
  route.value = 'fixture-route'; await h.ask('What was billed?');
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview'), [{ method: 'models.preview', payload: { question: 'What was billed?', routeId: 'fixture-route', purpose: 'conversation', questionDisclosure: 'verbatim' } }]);
  assert.equal(h.calls.some(call => call.method === 'conversation.ask'), false);
  assert.equal(h.renderer.state.messages.at(-1).data.preview.question, 'What was billed?');
  assert.equal(h.renderer.state.messages.at(-1).data.preview.purpose, 'conversation');
  route.value = ''; await h.ask('What was margin?');
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask'), [{ method: 'conversation.ask', payload: { question: 'What was margin?' } }]);
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
  const introductions = ['what is this business about', 'Tell me about this business.',
    'Could you please describe this business?', 'What’s this business about?',
    'Give me an overview of this business', 'What does this company do?'];
  for (const question of introductions) {
    await h.ask(question);
    assert.equal(h.rejected.length, 0); assert.equal(h.renderer.state.messages.at(-1).error, undefined);
    const contextAnswer = h.renderer.state.messages.at(-1).data;
    assert.equal(contextAnswer.kind, 'business-context', question);
    assert.equal(contextAnswer.status, 'unknown');
    assert.equal(contextAnswer.receipt.financialCalculation, false);
    assert.equal(contextAnswer.unknowns.length, 5);
    assert.ok(contextAnswer.citations.length > 0);
    const rendered = h.renderer.renderAnswer(contextAnswer);
    assert.ok(descendants(rendered).some(node => node.textContent === contextAnswer.unknowns[0].message));
    assert.equal(descendants(rendered).some(node => node.textContent?.includes('Choose a published calculation')), false);
    const savedContext = await engine.request('business.context.receipt', { id: contextAnswer.receipt.id });
    assert.equal(savedContext.contextDigest, contextAnswer.contextDigest);
    assert.deepEqual(savedContext.citations, contextAnswer.citations);
  }
  const mixedQuestion = 'What is this business about, and how much was billed?';
  await h.ask(mixedQuestion);
  const mixed = h.renderer.state.messages.at(-1).data;
  assert.equal(mixed.supported, false); assert.equal(mixed.receipt, null);
  assert.equal(mixed.kind, undefined);
  assert.match(mixed.message, /Choose a published calculation and an explicit period/);
  await assert.rejects(engine.request('conversation.ask', { question: mixedQuestion, purpose: 'business-context' }), { code: 'BUSINESS_CONTEXT_QUESTION_REQUIRED' });
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
  assert.deepEqual(h.calls.filter(call => call.method === 'conversation.ask').map(call => call.payload), [...introductions, mixedQuestion, 'What was billed?'].map(question => ({ question })));
  const stopped = await engine.stop(); assert.equal(stopped.graceful,true);
});

const savedPassphrase = 'Synthetic saved native answer fixture only';
const savedSourceId = 'synthetic-native-history-invoices';
const savedPeriod = { from: '2026-09-01', to: '2026-09-30' };
const savedIntroQuestion = 'what is this business about';
const savedBilledQuestion = 'What was billed?';
async function savedWorkerFixture(t: any, workerPath = join(root, 'platform/runtime/worker.ts')) {
  const { EngineHarness } = require(join(root, 'app/desktop/engine-harness.cjs'));
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-saved-renderer-worker-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const options = { workerPath, environment: { ...environment,
    CHAUSAR_ENGINE_VERSION: '0.1.0-preview.1', CHAUSAR_VAULT_DIRECTORY: directory, CHAUSAR_DEMO: '1', CHAUSAR_UPDATE_PUBLIC_KEY: '' } };
  let engine = new EngineHarness(options);
  const workers = [engine];
  t.after(async () => {
    for (const worker of workers) await worker.stop();
    const target = resolve(directory), child = relative(base, target);
    assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !isAbsolute(child));
    assert.ok(basename(target).startsWith('chausar-saved-renderer-worker-'));
    await rm(target, { recursive: true, force: true });
  });
  await engine.start();
  const created = await engine.request('workspace.create', { name: 'Synthetic saved answers', folder: 'saved-native', passphrase: savedPassphrase, demo: false, pack: 'ecommerce' });
  const imported = await engine.request('sources.import', {
    sourceId: savedSourceId, format: 'csv',
    content: 'id,kind,date,amount,currency,branch,status,description\nseptember-one,invoice,2026-09-02,100.00,INR,main,issued,Literal selected invoice one\nseptember-two,invoice,2026-09-03,200.00,INR,main,issued,Literal selected invoice two\naugust-outside,invoice,2026-08-02,900.00,INR,main,issued,Outside the explicit September period',
    expectedTotals: { rowCount: 3, amountMinor: '120000' },
    recipe: { version: 1, id: 'synthetic-native-saved-invoices', system: 'synthetic-csv', edition: '1',
      scope: { company: 'Synthetic saved answers', branches: ['main'] },
      bindings: [{ target: 'entityId', source: 'id', type: 'string', nulls: 'reject' },
        { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
        { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
        { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
        ...['currency', 'branch', 'status', 'description'].map(field => ({ target: field, source: field, type: 'string', nulls: 'reject' }))],
      allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'reject' } });
  assert.equal(imported.coverage.reconciled, true); assert.equal(imported.rowIds.length, 3);
  assert.deepEqual(await engine.request('models.list'), []);
  assert.equal((await engine.request('trust.get')).policy.send, 'nothing');
  async function restart() {
    assert.equal((await engine.stop()).graceful, true);
    engine = new EngineHarness(options); workers.push(engine); await engine.start();
    await engine.request('workspace.open', { folder: 'saved-native', passphrase: savedPassphrase });
  }
  return { get engine() { return engine; }, directory, imported, workspace: created.workspace, restart,
    request: (method: string, payload: Record<string, unknown> = {}) => engine.request(method, payload) };
}
const hasText = (node: Element, text: string) => descendants(node).some(child => child.textContent === text);
function dialogFor(h: Awaited<ReturnType<typeof harness>>, title: string) {
  return find(h.body, node => node.tagName === 'dialog' && hasText(node, title));
}
function namedButton(node: Element, label: string) { return find(node, child => child.tagName === 'button' && hasText(child, label)); }
function lastNamedButton(node: Element, label: string) {
  const button = descendants(node).filter(child => child.tagName === 'button' && hasText(child, label)).at(-1);
  assert.ok(button, `Expected actual renderer button: ${label}`); return button;
}
async function openHistoryEntry(h: Awaited<ReturnType<typeof harness>>, question: string) {
  const dialog = dialogFor(h, 'Recent answers');
  let row = find(dialog, node => node.textContent === question);
  while (!descendants(row).some(node => node.tagName === 'button' && hasText(node, 'Open saved answer'))) {
    assert.ok(row.parent, 'Saved question must have its actual open button.'); row = row.parent;
  }
  await namedButton(row, 'Open saved answer').dispatch('click');
  return dialogFor(h, 'Saved answer');
}
async function savedAnswers(h: Awaited<ReturnType<typeof harness>>, value: Awaited<ReturnType<typeof savedWorkerFixture>>) {
  h.renderer.state.workspace = value.workspace;
  await h.ask(savedIntroQuestion);
  const intro = h.renderer.state.messages.at(-1).data;
  assert.equal(intro.kind, 'business-context'); assert.equal(intro.receipt.financialCalculation, false);
  assert.equal(intro.status, 'unknown'); assert.equal(intro.unknowns.length, 5); assert.ok(intro.citations.length > 0);
  const billed = await h.renderer.request('conversation.ask', { question: savedBilledQuestion, period: savedPeriod, branch: 'main', asOf: new Date().toISOString() });
  assert.equal(billed.supported, true); assert.equal(billed.receipt.totalMinor, '30000');
  assert.deepEqual(billed.receipt.period, savedPeriod); assert.equal(billed.receipt.rowIds.length, 2);
  assert.ok(billed.receipt.rowIds.every((id: string) => value.imported.rowIds.includes(id)));
  assert.equal(h.calls.some(call => ['conversation.history', 'conversation.get', 'models.preview'].includes(call.method)), false);
  await namedButton(h.page, 'Recent answers').dispatch('click');
  assert.equal(descendants(dialogFor(h, 'Recent answers')).some(node => node.tagName === '#text' && ['null', 'undefined'].includes(node.textContent || '')), false);
  const history = await h.renderer.request('conversation.history', { limit: 20 });
  assert.equal(history.items.length, 2); assert.equal(history.nextCursor, undefined);
  const contextItem = history.items.find((item: any) => item.kind === 'business-context');
  const calculationItem = history.items.find((item: any) => item.kind === 'calculation');
  assert.ok(contextItem && calculationItem);
  assert.equal(contextItem.question, savedIntroQuestion); assert.equal(contextItem.receiptId, intro.receipt.id);
  assert.equal(calculationItem.question, savedBilledQuestion); assert.equal(calculationItem.receiptId, billed.receipt.id);
  for (const item of history.items) { assert.ok(Number.isFinite(Date.parse(item.at))); assert.deepEqual(Object.keys(item).sort(), ['at', 'id', 'kind', 'question', 'receiptId']); }
  assert.deepEqual((await h.renderer.request('conversation.get', { id: contextItem.id })).answer, intro);
  assert.deepEqual((await h.renderer.request('conversation.get', { id: calculationItem.id })).answer, billed);
  return { intro, billed, history, contextItem, calculationItem };
}

async function syntheticProviderCalls(directory: string): Promise<any[]> {
  try { return (await readFile(join(directory, 'synthetic-provider-calls.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); }
  catch (error: any) { if (error.code === 'ENOENT') return []; throw error; }
}
async function lunaFixture(t: any, kind: 'openai-responses' | 'ollama' = 'openai-responses') {
  const value = await savedWorkerFixture(t, join(root, 'platform/tests/fixtures/luna-worker.ts'));
  const route = await value.request('models.configure', { config: { id: 'synthetic-luna', kind,
    model: 'synthetic-planner', label: 'Synthetic fixture; no live or semantic qualification', enabled: true,
    endpoint: kind === 'ollama' ? 'http://127.0.0.1:11434/api/chat' : 'https://synthetic.invalid/v1/responses',
    budgetMinor: '10000', maxCostMinor: '1' }, ...(kind === 'ollama' ? {} : { secret: 'synthetic-fixture-only' }) });
  assert.equal(route.verification, 'not-live-verified');
  const h = await harness({ dispatch: value.request, mount: true }); h.renderer.state.workspace = value.workspace;
  function selectRoute(id = route.id) {
    find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = id;
  }
  return { value, route, h, selectRoute };
}
async function reviewedLunaRequest(fixture: Awaited<ReturnType<typeof lunaFixture>>, question: string) {
  const { h, value, selectRoute } = fixture; selectRoute();
  const before = (await syntheticProviderCalls(value.directory)).length;
  await h.ask(question);
  const pending = h.renderer.state.messages.at(-1);
  assert.equal(pending.error, undefined, pending.error);
  const preview = pending.data.preview;
  assert.equal(preview.purpose, 'conversation'); assert.equal(preview.questionDisclosure, 'verbatim');
  assert.equal(preview.approvalRequired, true); assert.equal(preview.naturalQuestion, question);
  assert.equal((await syntheticProviderCalls(value.directory)).length, before, 'Preview must not dispatch.');
  await lastNamedButton(h.app, 'Review outbound request').dispatch('click');
  const dialog = dialogFor(h, 'Review model disclosure');
  assert.ok(hasText(dialog, 'Your exact question')); assert.ok(hasText(dialog, question));
  assert.ok(hasText(dialog, preview.payload)); assert.ok(hasText(dialog, preview.digest));
  assert.ok(descendants(dialog).some(node => node.textContent?.includes('separate verbatim disclosure')));
  const approve = namedButton(dialog, 'Approve and send once');
  await approve.dispatch('click');
  assert.equal(h.calls.filter(call => call.method === 'models.approve' && call.payload.id === preview.id).length, 0, 'Unchecked consent must not approve.');
  assert.equal((await syntheticProviderCalls(value.directory)).length, before);
  find(dialog, node => node.tagName === 'input' && node.attributes.type === 'checkbox').checked = true;
  await approve.dispatch('click');
  assert.equal(approve.disabled, true, 'An uncertain or completed submission must not be retried from the same review.');
  await approve.dispatch('click'); // Deliberately invoke a disabled handler to test the one-use guard.
  assert.equal(h.calls.filter(call => call.method === 'models.approve' && call.payload.id === preview.id).length, 1);
  const asks = h.calls.filter(call => call.method === 'conversation.ask' && call.payload.previewId === preview.id);
  assert.equal(asks.length, 1); assert.deepEqual(asks[0].payload, { previewId: preview.id,
    approvalId: asks[0].payload.approvalId, question, routeId: fixture.route.id, purpose: 'conversation', questionDisclosure: 'verbatim' });
  const calls = await syntheticProviderCalls(value.directory);
  assert.equal(calls.length, before + 1, 'Exactly one synthetic provider dispatch.');
  assert.equal(calls.at(-1).payload, preview.payload); assert.equal(calls.at(-1).input.question, question);
  assert.equal(calls.at(-1).fixture, 'synthetic-planner-not-semantic-qualified');
  const final = h.renderer.state.messages.at(-1);
  return { answer: !final || final === pending ? undefined : final.data, preview, call: calls.at(-1), dialog };
}

test('actual Luna renderer preload worker executes reviewed paraphrases and mixed intent with cited exact local receipts', async t => {
  const fixture = await lunaFixture(t), { h, value } = fixture;
  await value.request('trust.update', { send: 'shape' });
  assert.equal(h.renderer.state.routeId, '');
  for (const question of ['Help me understand what this company actually does.', 'Can you explain the business in plain language?', 'What is this business about for the Acme account?']) {
    const { answer, preview, call } = await reviewedLunaRequest(fixture, question);
    assert.equal(answer.kind, 'grounded-conversation'); assert.equal(answer.results.length, 1);
    assert.equal(answer.results[0].tool, 'business.describe');
    const described = answer.results[0].answer;
    assert.equal(described.kind, 'business-context'); assert.equal(described.status, 'unknown');
    assert.equal(described.unknowns.length, 5); assert.ok(described.citations.length > 0);
    assert.ok(hasText(h.app, described.unknowns[0].message));
    assert.equal(call.input.evidence.business.samples, undefined);
    assert.equal(call.input.evidence.calculator.selectors, undefined);
    assert.equal(preview.payload.includes('Literal selected invoice one'), false);
    assert.equal(preview.payload.includes('120000'), false);
    await lastNamedButton(h.app, 'Open business context receipt').dispatch('click');
    assert.equal(h.calls.filter(call => call.method === 'business.context.receipt').at(-1).payload.id, described.receipt.id);
    assert.deepEqual(await value.request('business.context.receipt', { id: described.receipt.id }), described);
    dialogFor(h, 'Business context receipt').close();
  }
  const mixed = await reviewedLunaRequest(fixture, 'Explain this business and tell me what was billed in September.');
  assert.equal(mixed.answer.kind, 'grounded-conversation'); assert.equal(mixed.answer.results.length, 2);
  const calculation = mixed.answer.results.find((item: any) => item.tool === 'calculator.calculate').answer;
  assert.equal(calculation.totalMinor, '30000'); assert.deepEqual(calculation.period, savedPeriod);
  assert.equal(calculation.rowIds.length, 2);
  assert.ok(calculation.rowIds.every((id: string) => value.imported.rowIds.includes(id)));
  await namedButton(h.app, 'Open calculation receipt').dispatch('click');
  assert.deepEqual(await value.request('receipts.get', { id: calculation.id }), calculation);
  assert.ok(hasText(dialogFor(h, 'Calculation receipt'), calculation.id));
  assert.equal(h.rejected.length, 0);
});

test('actual Luna worker clarification typed calculation failure and invalid plan preserve one dispatch without invented amounts or retry', async t => {
  const fixture = await lunaFixture(t), { h, value } = fixture;
  await value.request('trust.update', { send: 'shape' });
  const clarification = await reviewedLunaRequest(fixture, 'Which view of the business should we look at?');
  assert.equal(clarification.answer.clarification, 'Which business aspect would you like described?');
  assert.ok(hasText(h.app, clarification.answer.clarification));
  assert.equal(descendants(h.app).some(node => node.tagName === 'button' && hasText(node, 'Open calculation receipt')), false);
  const failed = await reviewedLunaRequest(fixture, 'Describe this business and compare its billed change.');
  assert.equal(failed.answer.kind, 'grounded-conversation'); assert.equal(failed.answer.results.length, 2);
  assert.equal(failed.answer.results[0].answer.kind, 'business-context');
  const error = failed.answer.results[1]; assert.equal(error.tool, 'calculator.calculate');
  assert.equal(error.error.code, 'COMPARISON_REQUIRED'); assert.equal(error.answer, undefined);
  assert.ok(hasText(h.app, `${error.error.code}: ${error.error.message}`));
  assert.equal(descendants(h.app).some(node => node.tagName === 'button' && hasText(node, 'Open calculation receipt')), false);
  const malformed = await reviewedLunaRequest(fixture, 'Return an invalid synthetic plan.');
  assert.equal(malformed.answer, undefined);
  assert.equal(h.rejected.at(-1).error.code, 'INVALID_CONVERSATION_PLAN');
  assert.equal((await syntheticProviderCalls(value.directory)).length, 3);
  assert.equal((await value.request('models.list'))[0].id, fixture.route.id);
});

test('actual Luna worker Nothing blocks selected model and zero fact local Ollama still requires exact question consent', async t => {
  const fixture = await lunaFixture(t, 'ollama'), { h, value, selectRoute } = fixture;
  assert.equal((await value.request('trust.get')).policy.send, 'nothing');
  selectRoute(); await h.ask('What is this business about for the Acme account?');
  assert.equal(h.rejected.at(-1).error.code, 'SEND_DISABLED');
  assert.equal(h.calls.some(call => call.method === 'models.approve'), false);
  assert.equal((await syntheticProviderCalls(value.directory)).length, 0);
  assert.equal((await value.request('trust.get')).policy.send, 'nothing');
  selectRoute(''); await h.ask('What was billed?');
  assert.equal(h.renderer.state.messages.at(-1).data.receipt.totalMinor, '120000');
  assert.equal((await syntheticProviderCalls(value.directory)).length, 0);
  const local = h.calls.filter(call => call.method === 'conversation.ask').at(-1);
  assert.deepEqual(local.payload, { question: 'What was billed?' });
  await value.request('sources.delete', { id: savedSourceId });
  assert.equal((await value.request('dashboard.get')).factCount, 0);
  await value.request('trust.update', { send: 'shape' });
  const empty = await reviewedLunaRequest(fixture, 'Help me understand what this company actually does.');
  assert.equal(empty.preview.factIds.length, 0); assert.equal(empty.preview.sourceIds.length, 0);
  assert.equal(empty.answer.results[0].answer.kind, 'business-context');
  assert.equal(empty.answer.results[0].answer.unknowns.length, 5);
  assert.equal((await syntheticProviderCalls(value.directory)).length, 1);
  assert.equal((await value.request('trust.get')).policy.send, 'shape');
});

test('actual Luna renderer withholds a completed tool reply after real worker vault lock and erases reviewed question', async t => {
  const fixture = await lunaFixture(t), { value } = fixture;
  await value.request('trust.update', { send: 'shape' });
  let entered!: () => void, release!: () => void;
  const held = new Promise<void>(resolve => { entered = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    const result = await value.request(method, payload);
    if (method === 'conversation.ask' && payload.purpose === 'conversation') { entered(); await released; }
    return result;
  } });
  h.renderer.state.workspace = value.workspace;
  const pending = reviewedLunaRequest({ ...fixture, h, selectRoute: () => {
    find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route').value = fixture.route.id;
  } }, 'Explain this business and tell me what was billed in September.');
  await held;
  assert.ok(hasText(dialogFor(h, 'Review model disclosure'), 'Explain this business and tell me what was billed in September.'));
  await h.renderer.showWorkspace();
  await namedButton(dialogFor(h, 'Your workspace'), 'Lock vault').dispatch('click');
  release();
  const result = await pending;
  assert.equal(result.answer, undefined); assert.equal(h.renderer.state.messages.length, 0);
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(descendants(h.body).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  assert.equal(hasText(h.body, 'Explain this business and tell me what was billed in September.'), false);
  assert.equal((await syntheticProviderCalls(value.directory)).length, 1);
  assert.equal((await value.request('workspace.status')).open, false);
});

test('actual Luna renderer keeps the reviewed route across dropdown changes and discards a preview returned after vault lock', async t => {
  const fixture = await lunaFixture(t), { value } = fixture;
  await value.request('trust.update', { send: 'shape' });
  let gate: { entered: Promise<void>; enter: () => void; released: Promise<void>; release: () => void };
  function holdPreview() {
    let enter!: () => void, release!: () => void;
    gate = { entered: new Promise<void>(resolve => { enter = resolve; }), enter: () => enter(),
      released: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
    return gate;
  }
  const h = await harness({ mount: true, dispatch: async (method, payload) => {
    const result = await value.request(method, payload);
    if (method === 'models.preview') { const current = gate; current.enter(); await current.released; }
    return result;
  } });
  h.renderer.state.workspace = value.workspace;
  const route = find(h.app, node => node.tagName === 'select' && node.attributes['aria-label'] === 'Model route');
  const first = holdPreview(); route.value = fixture.route.id;
  const pending = h.ask('What is this business about for the Acme account?'); await first.entered;
  route.value = ''; first.release(); await pending;
  const preview = h.renderer.state.messages.at(-1).data.preview;
  assert.equal(preview.routeId, fixture.route.id); assert.equal(preview.endpoint, fixture.route.endpoint);
  assert.equal(preview.naturalQuestion, 'What is this business about for the Acme account?');
  assert.deepEqual(h.calls.filter(call => call.method === 'models.preview')[0].payload, {
    question: preview.naturalQuestion, routeId: fixture.route.id, purpose: 'conversation', questionDisclosure: 'verbatim' });
  const second = holdPreview(); route.value = fixture.route.id;
  const late = h.ask('Can you explain the business in plain language?'); await second.entered;
  await h.renderer.showWorkspace(); await namedButton(dialogFor(h, 'Your workspace'), 'Lock vault').dispatch('click');
  second.release(); await late;
  assert.equal(h.renderer.state.messages.length, 0); assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(hasText(h.body, 'Can you explain the business in plain language?'), false);
  assert.equal(descendants(h.body).some(node => node.textContent?.includes(preview.payload)), false);
  assert.equal((await syntheticProviderCalls(value.directory)).length, 0);
  assert.equal(h.calls.some(call => call.method === 'models.approve' || call.method === 'conversation.ask'), false);
  assert.equal((await value.request('workspace.status')).open, false);
});

test('actual renderer recent answers reopens exact intro and explicit-period calculation through encrypted lock and fresh native worker', async t => {
  const value = await savedWorkerFixture(t), h = await harness({ dispatch: value.request });
  const saved = await savedAnswers(h, value);
  const contextDialog = await openHistoryEntry(h, savedIntroQuestion);
  assert.ok(hasText(contextDialog, saved.intro.unknowns[0].message));
  await namedButton(contextDialog, 'Open business context receipt').dispatch('click');
  assert.ok(descendants(dialogFor(h, 'Business context receipt')).some(node => node.textContent?.includes(saved.intro.contextDigest)));
  contextDialog.close(); dialogFor(h, 'Business context receipt').close();
  const billedDialog = await openHistoryEntry(h, savedBilledQuestion);
  assert.ok(descendants(billedDialog).some(node => node.textContent?.includes('"totalMinor": "30000"')));
  await namedButton(billedDialog, 'Open calculation receipt').dispatch('click');
  assert.ok(hasText(dialogFor(h, 'Calculation receipt'), saved.billed.receipt.id));
  const encrypted = await readFile(join(value.directory, 'saved-native', 'authority.encrypted.json'), 'utf8');
  const envelope = JSON.parse(encrypted); assert.ok(envelope.snapshot); assert.equal(encrypted.includes(savedBilledQuestion), false);
  assert.equal(encrypted.includes('Literal selected invoice one'), false);
  await h.renderer.showWorkspace(); await namedButton(dialogFor(h, 'Your workspace'), 'Lock vault').dispatch('click');
  assert.equal(h.renderer.state.messages.length, 0); assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  await assert.rejects(h.renderer.request('conversation.get', { id: saved.calculationItem.id }), { code: 'VAULT_LOCKED' });
  await h.renderer.request('workspace.open', { folder: 'saved-native', passphrase: savedPassphrase });
  assert.deepEqual((await h.renderer.request('conversation.get', { id: saved.calculationItem.id })).answer, saved.billed);
  await value.restart();
  const fresh = await harness({ dispatch: value.request }); fresh.renderer.state.workspace = value.workspace;
  assert.equal(fresh.renderer.state.messages.length, 0);
  assert.equal(fresh.calls.some(call => ['conversation.history', 'conversation.get'].includes(call.method)), false);
  await namedButton(fresh.page, 'Recent answers').dispatch('click');
  assert.deepEqual(await fresh.renderer.request('conversation.history', { limit: 20 }), saved.history);
  assert.deepEqual((await fresh.renderer.request('conversation.get', { id: saved.contextItem.id })).answer, saved.intro);
  assert.deepEqual((await fresh.renderer.request('conversation.get', { id: saved.calculationItem.id })).answer, saved.billed);
  const reopened = await openHistoryEntry(fresh, savedBilledQuestion);
  await namedButton(reopened, 'Open calculation receipt').dispatch('click');
  assert.deepEqual(await fresh.renderer.request('receipts.get', { id: saved.billed.receipt.id }), saved.billed.receipt);
  assert.equal(fresh.rejected.length, 0);
});

test('actual native worker current source revocation and deletion remove saved answers without stale renderer bodies', async t => {
  const value = await savedWorkerFixture(t), h = await harness({ dispatch: value.request });
  const saved = await savedAnswers(h, value);
  await openHistoryEntry(h, savedBilledQuestion);
  await h.renderer.request('trust.update', { allowedSources: ['another-explicit-source'] });
  assert.deepEqual(await h.renderer.request('conversation.history', { limit: 20 }), { items: [] });
  for (const item of saved.history.items) await assert.rejects(h.renderer.request('conversation.get', { id: item.id }), { code: 'CONVERSATION_NOT_FOUND' });
  await h.renderer.showSavedConversation(saved.calculationItem.id);
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(descendants(h.body).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  await h.renderer.request('trust.update', { allowedSources: [savedSourceId] });
  assert.deepEqual((await h.renderer.request('conversation.get', { id: saved.calculationItem.id })).answer, saved.billed);
  await h.renderer.request('sources.delete', { id: savedSourceId });
  await value.restart();
  const fresh = await harness({ dispatch: value.request }); fresh.renderer.state.workspace = value.workspace;
  await namedButton(fresh.page, 'Recent answers').dispatch('click');
  assert.deepEqual(await fresh.renderer.request('conversation.history', { limit: 20 }), { items: [] });
  for (const item of saved.history.items) await assert.rejects(fresh.renderer.request('conversation.get', { id: item.id }), { code: 'CONVERSATION_NOT_FOUND' });
  await fresh.renderer.showSavedConversation(saved.calculationItem.id);
  assert.equal(descendants(fresh.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(descendants(fresh.body).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  await assert.rejects(fresh.renderer.request('receipts.get', { id: saved.billed.receipt.id }), { code: 'RECEIPT_NOT_FOUND' });
});

test('actual renderer discards a late saved-answer reply after the real native worker vault lock', async t => {
  const value = await savedWorkerFixture(t); let hold = false;
  let entered!: () => void, release!: () => void;
  const replyHeld = new Promise<void>(resolve => { entered = resolve; });
  const replyRelease = new Promise<void>(resolve => { release = resolve; });
  const h = await harness({ dispatch: async (method, payload) => {
    const answer = await value.request(method, payload);
    if (hold && method === 'conversation.get') { entered(); await replyRelease; }
    return answer;
  } });
  const saved = await savedAnswers(h, value);
  for (const dialog of descendants(h.body).filter(node => node.tagName === 'dialog')) dialog.close();
  hold = true; const opening = h.renderer.showSavedConversation(saved.calculationItem.id);
  await replyHeld;
  await h.renderer.showWorkspace(); await namedButton(dialogFor(h, 'Your workspace'), 'Lock vault').dispatch('click');
  release(); await opening;
  assert.equal(h.renderer.state.messages.length, 0); assert.equal(h.renderer.state.workspace, null);
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(descendants(h.body).some(node => node.textContent?.includes('"totalMinor": "30000"')), false);
  assert.equal(h.calls.filter(call => call.method === 'conversation.get').at(-1).payload.id, saved.calculationItem.id);
  assert.equal(h.rejected.length, 0, 'The delayed success came from the real worker; renderer authority generation suppresses it.');
});

test('actual renderer discards a late older-history page after its Recent answers dialog closes', async t => {
  const value = await savedWorkerFixture(t);
  let entered!: () => void, release!: () => void;
  const replyHeld = new Promise<void>(resolve => { entered = resolve; });
  const replyRelease = new Promise<void>(resolve => { release = resolve; });
  const h = await harness({ dispatch: async (method, payload) => {
    const result = await value.request(method, payload);
    if (method === 'conversation.history' && typeof payload.cursor === 'string') { entered(); await replyRelease; }
    return result;
  } });
  h.renderer.state.workspace = value.workspace;
  // Real successful asks create enough saved records for the actual 20-item UI page.
  for (let index = 0; index < 21; index++) await h.ask(savedIntroQuestion);
  assert.equal(h.calls.some(call => call.method === 'conversation.history'), false);
  await namedButton(h.page, 'Recent answers').dispatch('click');
  const dialog = dialogFor(h, 'Recent answers');
  const paging = namedButton(dialog, 'Older answers').dispatch('click');
  try {
    await replyHeld;
    await find(dialog, node => node.tagName === 'button' && node.attributes['aria-label'] === 'Close dialog').dispatch('click');
  } finally { release(); await paging; }
  assert.equal(dialog.children.length, 0, 'A closed saved-evidence dialog retains no body after a delayed real page reply.');
  assert.equal(descendants(h.body).some(node => node.tagName === 'dialog'), false);
  assert.equal(typeof h.calls.filter(call => call.method === 'conversation.history').at(-1).payload.cursor, 'string');
  assert.equal(h.rejected.length, 0);
});
