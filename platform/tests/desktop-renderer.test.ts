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
  body.append(app, notifications);
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => Object.assign(new Element('#text'), { textContent: String(value) }), createElementNS: (namespaceURI: string, tag: string) => Object.assign(new Element(tag), { namespaceURI }), getElementById: (id: string) => descendants(body).find(node => node.id === id) || (id === 'app' ? app : id === 'notifications' ? notifications : null), querySelectorAll: () => [] };
  const context: any = { document, Node: Element, window: { chausar: exposed, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} }, crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, fetch() { throw new Error('Unexpected HTTP path in desktop boundary regression.'); } };
  assert.match(rendererSource, /\bboot\(\);\s*$/);
  // Disable only automatic boot; execute all actual renderer functions, including request/composer.
  vm.runInNewContext(rendererSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__test = { request, renderConversation, renderAnswer, showCalculator, showWorkspace, state, showConversationHistory: typeof showConversationHistory === "function" ? showConversationHistory : undefined, showSavedConversation: typeof showSavedConversation === "function" ? showSavedConversation : undefined };', context, { filename: join(root, 'app/renderer/app.js') });
  const renderer = context.__test;
  const page = await renderer.renderConversation();
  const composer = find(page, node => node.tagName === 'form' && node.className === 'composer');
  const question = find(composer, node => node.tagName === 'textarea');
  const submit = find(composer, node => node.tagName === 'button' && node.attributes.type === 'submit');
  async function ask(text: string) { question.value = text; await composer.dispatch('submit'); }
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
async function savedWorkerFixture(t: any) {
  const { EngineHarness } = require(join(root, 'app/desktop/engine-harness.cjs'));
  const base = resolve(tmpdir()), directory = await mkdtemp(join(base, 'chausar-saved-renderer-worker-'));
  const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => ['path', 'systemroot', 'windir', 'temp', 'tmp', 'userprofile'].includes(name.toLowerCase())));
  const options = { workerPath: join(root, 'platform/runtime/worker.ts'), environment: { ...environment,
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
