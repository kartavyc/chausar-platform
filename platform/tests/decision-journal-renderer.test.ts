import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ipcContract, { type DesktopMethod } from '../../app/desktop/ipc-contract.cjs';
import type { CalculationReceipt } from '../runtime/calculator.ts';
import { confirmDecision, draftDecision, reviewDecision, type JournalContent, type JournalDecision } from '../runtime/decision-journal.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const [rendererSource, preloadSource] = await Promise.all(['app/renderer/app.js', 'app/desktop/preload.cjs'].map(path => readFile(join(root, path), 'utf8')));
const EXACT_AMOUNT = '900719925474099391';
const { validateRequest, publicError } = ipcContract;
const UNSAFE_TEXT = '<img src=x onerror="throw new Error(\'must stay text\')">';

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function record(value: unknown): Record<string, unknown> { assert.ok(isRecord(value)); return value; }
function array(value: unknown): unknown[] { assert.ok(Array.isArray(value)); return value; }
function records(value: unknown) { return array(value).map(record); }
function text(value: unknown): string { assert.ok(typeof value === 'string'); return value; }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) { assert.deepEqual(Object.keys(value).sort(), [...keys].sort()); }

type DomEvent = { target: Element; currentTarget: Element; preventDefault(): void };
type Handler = (event: DomEvent) => unknown;
// Execute real renderer DOM construction, including dynamic selectors and modal
// lifetime. Any HTML injection fails instead of being silently ignored by a shim.
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
  parent?: Element;
  #ownText = '';
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
    remove: (...names: string[]) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
    toggle: (name: string, force?: boolean) => {
      const present = this.className.split(/\s+/).includes(name), wanted = force ?? !present;
      if (wanted) this.classList.add(name); else this.classList.remove(name); return wanted;
    },
  };
  constructor(tag: string) { this.tagName = tag; }
  get textContent(): string { return this.#ownText + this.children.map(child => child.textContent).join(''); }
  set textContent(value: string) { this.#ownText = String(value); this.children = []; }
  set innerHTML(_value: string) { throw new Error('Renderer must build safe text nodes.'); }
  set outerHTML(_value: string) { throw new Error('Renderer must build safe text nodes.'); }
  get parentElement() { return this.parent; }
  get lastElementChild() { return this.children.at(-1); }
  setAttribute(key: string, value: unknown) {
    this.attributes[key] = String(value);
    if (key === 'value') this.value = String(value);
    if (key === 'id') this.id = String(value);
    if (key === 'disabled') this.disabled = true;
    if (key === 'required') this.attributes.required = '';
    if (key.startsWith('data-')) this.dataset[key.slice(5)] = String(value);
  }
  getAttribute(key: string) { return this.attributes[key] ?? null; }
  removeAttribute(key: string) { delete this.attributes[key]; if (key === 'disabled') this.disabled = false; }
  append(...children: Element[]) {
    const first = this.children.length === 0;
    for (const child of children) { child.remove(); child.parent = this; this.children.push(child); }
    if (this.tagName === 'select' && first && children.length) this.value = children[0].value;
  }
  replaceChildren(...children: Element[]) { for (const child of this.children) child.parent = undefined; this.children = []; this.#ownText = ''; this.append(...children); }
  addEventListener(name: string, handler: Handler) { const handlers = this.listeners.get(name) ?? []; handlers.push(handler); this.listeners.set(name, handlers); }
  async dispatch(name: string) {
    if (this.disabled && name === 'click') return;
    for (const handler of this.listeners.get(name) ?? []) await handler({ target: this, currentTarget: this, preventDefault() {} });
  }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(child => child !== this); this.parent = undefined; } }
  showModal() { this.open = true; }
  close() { this.open = false; void this.dispatch('close'); }
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
function find(node: Element, predicate: (item: Element) => boolean) { const found = descendants(node).find(predicate); assert.ok(found, 'Expected actual renderer control.'); return found; }
function controls(node: Element, label: string) {
  return descendants(node).filter(item => item.className.split(/\s+/).includes('field') && item.children[0]?.textContent === label).map(item => item.children[1]);
}
function control(node: Element, label: string, index = 0) { const found = controls(node, label)[index]; assert.ok(found, `Expected field ${label}.`); return found; }
function button(node: Element, label: string) { return find(node, item => item.tagName === 'button' && item.textContent === label); }
function modal(body: Element, title?: string) { const dialogs = descendants(body).filter(item => item.tagName === 'dialog' && item.open && (!title || descendants(item).some(child => child.tagName === 'h2' && child.textContent === title))); const found = dialogs.at(-1); assert.ok(found, `Expected open dialog ${title ?? ''}.`); return found; }
function ancestorWith(node: Element, predicate: (parent: Element) => boolean) { for (let parent = node.parent; parent; parent = parent.parent) if (predicate(parent)) return parent; assert.fail('Expected control section.'); }
function optionPanel(form: Element, index = 0) { return ancestorWith(control(form, 'Option label', index), node => controls(node, 'Option reason').length === 1 && descendants(node).some(item => item.tagName === 'button' && item.textContent === 'Add evidence')); }
function checkControl(node: Element, label: string) { const found = find(node, item => item.tagName === 'label' && item.textContent === label); return find(found, item => item.tagName === 'input' && item.attributes.type === 'checkbox'); }
async function settle() { await new Promise<void>(accept => setImmediate(accept)); }
async function click(node: Element, label: string) { await button(node, label).dispatch('click'); await settle(); }
async function set(node: Element, label: string, value: string, index = 0) { const field = control(node, label, index); field.value = value; await field.dispatch(field.tagName === 'select' ? 'change' : 'input'); }

const BASE: CalculationReceipt = { id: 'receipt-base', memberId: 'owner', epoch: 1, sourceIds: ['source-base'], operation: 'earned',
  createdAt: '2026-09-30T12:00:00.000Z', asOf: '2026-09-30T12:00:00.000Z', period: { from: '2026-09-01', to: '2026-09-30' }, comparePeriod: null,
  branch: 'main', currency: 'INR', ontologyVersion: 1, dictionaryHash: 'a'.repeat(64), definitionHash: 'b'.repeat(64), definitions: [],
  figures: [{ key: 'earned', label: 'Earned revenue', minor: EXACT_AMOUNT, display: 'INR 9,007,199,254,740,993.91', unit: 'money', currency: 'INR' }],
  valueMinor: EXACT_AMOUNT, totalMinor: EXACT_AMOUNT, rowIds: ['row-base'],
  rows: [{ factId: 'row-base', entityId: 'sale-base', sourceId: 'source-base', sourceRow: 2, kind: 'sale', amountMinor: EXACT_AMOUNT, validFrom: '2026-09-12', branch: 'main' }],
  exclusions: [{ rowId: 'row-excluded', reason: 'Outside declared window.' }], coverage: { selectedRows: 2, countedRows: 1, excludedRows: 1, unresolvedConflicts: 0, importIds: [], completeness: 'unreconciled-facts', gaps: [] },
  assumptions: {}, explanation: 'Synthetic saved receipt; no causal assessment.', stale: false, allowedNumbers: [EXACT_AMOUNT] };
const MEASURED: CalculationReceipt = { ...structuredClone(BASE), id: 'receipt-measured', sourceIds: ['source-measured'], rowIds: ['row-measured'],
  figures: [{ key: 'earned', label: 'Measured earned revenue', minor: '900719925474099400', display: 'INR 9,007,199,254,740,994.00', unit: 'money', currency: 'INR' }] };
const CONTENT: JournalContent = { text: 'Keep distributor terms and review the observed result.', options: [{ id: 'keep', label: 'Keep terms', reason: 'Observe before changing.', evidence: [{ receiptId: BASE.id, figureKey: 'earned' }] }],
  assumptions: [{ id: 'lag', text: 'Payments may arrive late.', status: 'unverified', evidence: [] }], selectedOptionId: 'keep', ownerId: 'decision-owner',
  expectedOutcome: { description: 'Assess the human expectation.', measure: 'earned revenue', population: 'main-branch distributor orders', baseline: { receiptId: BASE.id, figureKey: 'earned' },
    window: { from: '2026-10-01', to: '2026-10-10' }, maturityDate: '2026-10-15', lagRule: 'Wait until the declared maturity.', uncertainty: ['Concurrent activity can affect the result.'] },
  reviewDate: '2026-10-15', hypotheses: ['No cause has been measured.'], branch: 'main' };
function richDecision(): JournalDecision { const draft = draftDecision(CONTENT, [BASE]); return confirmDecision(draft, { reviewedDigest: draft.digest, id: 'decision-rich', actorId: 'owner', at: '2026-10-01T08:00:00.000Z', receipts: [BASE] }); }
const LEGACY = { id: 'decision-legacy', text: 'Legacy choice remains readable.', reviewDate: '2026-10-05', receiptIds: [], hypotheses: [], status: 'open', reviews: [] };
type WireCall = { method: DesktopMethod; payload: Record<string, unknown> };
type Renderer = { state: Record<string, unknown>; renderDecisions(): Promise<Element>; showJournalEditor(decision?: JournalDecision): unknown; showJournalReview(decision: JournalDecision): unknown; showJournalHistory(decision: JournalDecision): unknown };
function isRenderer(value: unknown): value is Renderer { return isRecord(value) && isRecord(value.state) && ['renderDecisions', 'showJournalEditor', 'showJournalReview', 'showJournalHistory'].every(key => typeof value[key] === 'function'); }

async function harness(options: { decisions?: unknown[]; conflict?: 'review' | 'revise' } = {}) {
  const calls: WireCall[] = [], wires: unknown[] = [], rejected: { code: string; message: string }[] = [];
  let current: Record<string, unknown> = { ...richDecision() }, conflicted = false;
  let latestDraft: Record<string, unknown> | undefined;
  const decisions = () => options.decisions ?? [structuredClone(LEGACY), structuredClone(current)];
  const journalFields: Record<string, string[]> = { 'decisions.journal.draft': ['content'], 'decisions.journal.confirm': ['draft', 'reviewedDigest'],
    'decisions.journal.revise': ['id', 'content', 'expectedRevision', 'reason'], 'decisions.journal.review': ['id', 'review', 'expectedRevision'] };
  async function dispatch(method: DesktopMethod, payload: Record<string, unknown>): Promise<unknown> {
    if (journalFields[method]) exactKeys(payload, journalFields[method]);
    switch (method) {
      case 'decisions.list': return decisions();
      case 'dashboard.get': return { context: { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' }, calculations: [BASE, MEASURED], policy: { send: 'nothing' }, sources: 2, factCount: 3 };
      case 'trust.get': return { policy: { send: 'nothing' }, members: [{ id: 'owner', name: 'Workspace owner', role: 'owner', active: true, epoch: 1, branches: ['*'] },
        { id: 'decision-owner', name: 'Decision owner', role: 'accountant', active: true, epoch: 1, branches: ['main'] },
        { id: 'inactive-owner', name: 'Inactive account', role: 'accountant', active: false, epoch: 1, branches: ['main'] }] };
      case 'sources.list': return [{ id: 'source-base', sourceId: 'source-base', filename: 'Synthetic baseline.csv', name: 'Synthetic baseline' }, { id: 'source-measured', sourceId: 'source-measured', filename: 'Synthetic observation.csv', name: 'Synthetic observation' }];
      case 'receipts.get': return payload.id === BASE.id ? BASE : MEASURED;
      case 'decisions.journal.draft': latestDraft = { kind: 'journal-draft', content: structuredClone(payload.content), receipts: [BASE], digest: 'd'.repeat(64) }; return latestDraft;
      case 'decisions.journal.confirm': assert.ok(latestDraft); assert.deepEqual(payload, { draft: latestDraft, reviewedDigest: latestDraft.digest }); return { ...current, text: record(latestDraft.content).text };
      case 'decisions.journal.revise':
      case 'decisions.journal.review': {
        if (options.conflict === method.split('.').at(-1) && !conflicted) {
          conflicted = true; current = { ...current, revision: 2, text: 'Another member changed the stored record.' };
          throw Object.assign(new Error('The decision changed. Reload it before writing.'), { code: 'REVISION_CONFLICT' });
        }
        assert.equal(payload.expectedRevision, current.revision);
        current = { ...current, revision: Number(current.revision) + 1 }; return current;
      }
      case 'decisions.journal.due': assert.ok(Object.keys(payload).every(key => ['dueOn', 'branch'].includes(key))); return decisions();
      case 'decisions.create': return { ...LEGACY, ...payload };
      case 'decisions.review': return { ...LEGACY, status: 'closed' };
      default: throw new Error(`Unexpected fixture RPC ${method}.`);
    }
  }
  const ipcRenderer = { async invoke(channel: string, envelope: unknown) {
    assert.equal(channel, 'chausar:request'); const wire = structuredClone(envelope); wires.push(wire);
    try { const call = validateRequest(wire); calls.push(call); return structuredClone({ ok: true, result: await dispatch(call.method, call.payload) }); }
    catch (error: unknown) { const exposed = publicError(error); rejected.push(exposed); return structuredClone({ ok: false, error: exposed }); }
  }, on() {}, removeListener() {} };
  let exposed: unknown;
  vm.runInNewContext(preloadSource, { require(name: string) { assert.equal(name, 'electron'); return { ipcRenderer, contextBridge: { exposeInMainWorld(name: string, api: unknown) { assert.equal(name, 'chausar'); exposed = api; } } }; } }, { filename: join(root, 'app/desktop/preload.cjs') });
  assert.ok(isRecord(exposed) && typeof exposed.request === 'function');
  const body = new Element('body'), app = new Element('div'), notifications = new Element('div'), page = new Element('main'), currentPage = new Element('span');
  app.id = 'app'; notifications.id = 'notifications'; page.id = 'page-content'; currentPage.id = 'current-page'; app.append(currentPage, page); body.append(app, notifications);
  const document = { body, createElement: (tag: string) => new Element(tag), createTextNode: (value: unknown) => { const node = new Element('#text'); node.textContent = String(value); return node; },
    createElementNS: (namespace: string, tag: string) => { const node = new Element(tag); node.namespaceURI = namespace; return node; },
    getElementById: (id: string) => descendants(body).find(node => node.id === id) ?? null, querySelectorAll: (selector: string) => body.querySelectorAll(selector) };
  const context: Record<string, unknown> = { document, Node: Element, window: { chausar: exposed, location: { origin: 'chausar://app', hash: '', pathname: '/index.html', search: '' }, history: { replaceState() {} }, addEventListener() {} },
    crypto: { randomUUID }, URL, URLSearchParams, structuredClone, console, setTimeout: () => 0, clearTimeout() {}, fetch() { throw new Error('Unexpected network in synthetic desktop renderer tests.'); } };
  assert.match(rendererSource, /\bboot\(\);\s*$/);
  vm.runInNewContext(rendererSource.replace(/\bboot\(\);\s*$/, '') + '\n;globalThis.__journalTest = { renderDecisions, showJournalEditor, showJournalReview, showJournalHistory, state };', context, { filename: join(root, 'app/renderer/app.js') });
  assert.ok(isRenderer(context.__journalTest)); const renderer = context.__journalTest;
  renderer.state.page = 'decisions'; renderer.state.workspace = { name: 'Synthetic journal UI', demo: true };
  renderer.state.dashboard = { calculations: [BASE, MEASURED], context: { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' } };
  page.replaceChildren(await renderer.renderDecisions());
  return { renderer, body, page, notifications, calls, wires, rejected, get latestDraft() { return latestDraft; } };
}

async function fillEditor(form: Element) {
  for (const [label, value] of [
    ['Decision statement', 'Keep terms pending measured human review.'], ['Decision owner', 'decision-owner'], ['Review date', '2026-10-15'],
    ['Expected outcome', 'Observe earned revenue after the declared window.'], ['Outcome measure', 'earned revenue'], ['Outcome population', 'main-branch distributor orders'],
    ['Window from', '2026-10-01'], ['Window to', '2026-10-10'], ['Maturity date', '2026-10-15'], ['Lag rule', 'Wait until maturity before human review.'],
    ['Outcome uncertainty (one per line)', 'Concurrent activity can affect the result.\nSource coverage remains incomplete.'], ['Hypotheses (one per line)', 'A delay is possible.\nNo cause has been measured.'],
  ]) await set(form, label, value);
  await set(form, 'Option label', 'Keep terms'); await set(form, 'Option reason', 'Observe before another intervention.');
  const choice = control(form, 'Chosen option'), option = choice.children.find(child => child.tagName === 'option' && child.value);
  assert.ok(option); choice.value = option.value; await choice.dispatch('change');
}
async function chooseEvidence(scope: Element, receiptId: string, sourceId: string, figureLabel = 'Figure (optional)') {
  await set(scope, 'Source', sourceId); await set(scope, 'Saved receipt', receiptId); await set(scope, figureLabel, 'earned');
}

test('actual journal editor previews structured content and confirms only the explicitly reviewed exact draft through preload', async () => {
  const h = await harness(); await click(h.page, 'Create journal entry');
  const editor = modal(h.body), form = find(editor, node => node.tagName === 'form');
  for (const label of ['Decision statement', 'Decision owner', 'Review date', 'Expected outcome', 'Outcome measure', 'Outcome population', 'Window from', 'Window to', 'Maturity date', 'Lag rule']) assert.equal(control(form, label).value, '', label);
  assert.ok(!control(form, 'Decision owner').children.some(child => child.value === 'inactive-owner'));
  await fillEditor(form); await click(optionPanel(form), 'Add evidence'); await chooseEvidence(optionPanel(form), BASE.id, 'source-base');
  await click(form, 'Add assumption'); await set(form, 'Assumption statement', 'Payments may arrive after the window.'); await set(form, 'Assumption status', 'unverified');
  await form.dispatch('submit'); await settle();
  const previewCall = h.calls.find(call => call.method === 'decisions.journal.draft'); assert.ok(previewCall);
  const value = record(previewCall.payload.content); exactKeys(value, ['text', 'options', 'assumptions', 'selectedOptionId', 'ownerId', 'expectedOutcome', 'reviewDate', 'hypotheses']);
  assert.equal(value.text, 'Keep terms pending measured human review.'); assert.equal(value.ownerId, 'decision-owner');
  const options = records(value.options); assert.equal(options[0].id, value.selectedOptionId); assert.equal(options[0].label, 'Keep terms');
  assert.deepEqual(options[0].evidence, [{ receiptId: BASE.id, figureKey: 'earned' }]);
  assert.equal(records(value.assumptions)[0].status, 'unverified'); assert.deepEqual(value.hypotheses, ['A delay is possible.', 'No cause has been measured.']);
  assert.deepEqual(record(value.expectedOutcome).uncertainty, ['Concurrent activity can affect the result.', 'Source coverage remains incomplete.']);
  const preview = modal(h.body, 'Review journal draft'); assert.ok(preview.textContent.includes('Keep terms')); assert.ok(preview.textContent.includes(BASE.figures[0].display));
  assert.ok(!descendants(preview).some(node => node.tagName === 'textarea' || node.tagName === 'input' && node.attributes.type !== 'checkbox'));
  await click(preview, 'Confirm journal entry'); assert.equal(h.calls.filter(call => call.method === 'decisions.journal.confirm').length, 0);
  const consent = checkControl(preview, 'I reviewed this decision and its exact evidence.'); consent.checked = true; await consent.dispatch('change');
  await click(preview, 'Confirm journal entry');
  const confirmation = h.calls.filter(call => call.method === 'decisions.journal.confirm'); assert.equal(confirmation.length, 1);
  assert.deepEqual(confirmation[0].payload, { draft: h.latestDraft, reviewedDigest: h.latestDraft?.digest });
  assert.equal(h.rejected.length, 0); assert.ok(h.wires.length > 0);
});

test('actual dynamic option controls preserve distinct stable IDs and submit the explicitly chosen option with source-filtered evidence', async () => {
  const h = await harness(); await h.renderer.showJournalEditor(); const form = find(modal(h.body), node => node.tagName === 'form');
  await fillEditor(form); await click(form, 'Add option'); await set(form, 'Option label', 'Change terms', 1); await set(form, 'Option reason', 'A separate human alternative.', 1);
  await click(optionPanel(form, 1), 'Add evidence'); const second = optionPanel(form, 1);
  await set(second, 'Source', 'source-measured');
  assert.ok(control(second, 'Saved receipt').children.some(child => child.value === MEASURED.id));
  assert.ok(!control(second, 'Saved receipt').children.some(child => child.value === BASE.id));
  await set(second, 'Saved receipt', MEASURED.id); await set(second, 'Figure (optional)', 'earned');
  const choice = control(form, 'Chosen option'), alternative = choice.children.find(child => child.textContent === 'Change terms'); assert.ok(alternative);
  choice.value = alternative.value; await choice.dispatch('change'); await form.dispatch('submit'); await settle();
  const call = h.calls.find(item => item.method === 'decisions.journal.draft'); assert.ok(call); const value = record(call.payload.content), options = records(value.options);
  assert.equal(options.length, 2); assert.ok(text(options[0].id)); assert.ok(text(options[1].id)); assert.notEqual(options[0].id, options[1].id);
  assert.equal(value.selectedOptionId, options[1].id); assert.deepEqual(options[1].evidence, [{ receiptId: MEASURED.id, figureKey: 'earned' }]);
  assert.equal(h.rejected.length, 0);
});

test('actual journal review requires explicit declarations and submits exact measurements without execution or causal authority', async () => {
  const h = await harness(), decision = richDecision(); await h.renderer.showJournalReview(decision);
  const dialog = modal(h.body), form = find(dialog, node => node.tagName === 'form');
  assert.equal(control(form, 'Review outcome').value, ''); assert.equal(control(form, 'Observation state').value, '');
  assert.ok(dialog.textContent.includes(CONTENT.expectedOutcome.population)); assert.ok(dialog.textContent.includes(CONTENT.expectedOutcome.window.from)); assert.ok(dialog.textContent.includes(CONTENT.expectedOutcome.window.to));
  await set(form, 'Review outcome', 'continue'); await set(form, 'Observation state', 'observable'); await set(form, 'Observation notes', 'A declared observation without a causal conclusion.');
  await set(form, 'Observation uncertainty (one per line)', 'Coverage can change.\nNo causality established.');
  await set(form, 'Concurrent interventions (one per line)', 'Another campaign overlapped.'); await set(form, 'Next review date (optional)', '2026-11-01');
  await click(form, 'Add measurement'); await chooseEvidence(form, MEASURED.id, 'source-measured', 'Measured figure');
  await form.dispatch('submit'); await settle();
  const call = h.calls.find(item => item.method === 'decisions.journal.review'); assert.ok(call);
  assert.deepEqual(call.payload, { id: decision.id, expectedRevision: 1, review: { outcome: 'continue', observation: { state: 'observable',
    measurements: [{ receiptId: MEASURED.id, figureKey: 'earned' }], notes: 'A declared observation without a causal conclusion.',
    uncertainty: ['Coverage can change.', 'No causality established.'], concurrentInterventions: ['Another campaign overlapped.'], executionReceiptIds: [] }, nextReviewDate: '2026-11-01' } });
  assert.equal(h.rejected.length, 0);
});

for (const kind of ['review', 'revise'] as const) {
  test(`actual journal ${kind} conflict keeps typed values and adopts the reloaded revision only on explicit request`, async () => {
    const h = await harness({ conflict: kind }), decision = richDecision();
    if (kind === 'review') await h.renderer.showJournalReview(decision); else await h.renderer.showJournalEditor(decision);
    const dialog = modal(h.body), form = find(dialog, node => node.tagName === 'form');
    if (kind === 'review') { await set(form, 'Review outcome', 'continue'); await set(form, 'Observation state', 'pending'); await set(form, 'Observation notes', 'Keep my typed observation.'); }
    else { await set(form, 'Decision statement', 'Keep my typed revision.'); await set(form, 'Revision reason', 'Clarify the record after reload.'); }
    await form.dispatch('submit'); await settle();
    const method = `decisions.journal.${kind}`; assert.equal(h.calls.filter(call => call.method === method).length, 1);
    assert.ok(h.calls.filter(call => call.method === 'decisions.list').length >= 2, 'Conflict reloads the current record.');
    assert.equal(control(form, kind === 'review' ? 'Observation notes' : 'Decision statement').value, kind === 'review' ? 'Keep my typed observation.' : 'Keep my typed revision.');
    await form.dispatch('submit'); await settle(); assert.equal(h.calls.filter(call => call.method === method).length, 1, 'No automatic retry before revision adoption.');
    await click(dialog, 'Use reloaded revision'); await form.dispatch('submit'); await settle();
    const writes = h.calls.filter(call => call.method === method); assert.equal(writes.length, 2); assert.equal(writes[0].payload.expectedRevision, 1); assert.equal(writes[1].payload.expectedRevision, 2);
    if (kind === 'review') assert.equal(record(record(writes[1].payload.review).observation).notes, 'Keep my typed observation.');
    else { assert.equal(record(writes[1].payload.content).text, 'Keep my typed revision.'); assert.equal(writes[1].payload.reason, 'Clarify the record after reload.'); assert.equal(records(record(writes[1].payload.content).options)[0].id, 'keep'); }
    assert.equal(h.rejected.filter(error => error.code === 'REVISION_CONFLICT').length, 1);
    assert.ok(h.rejected.every(error => error.code === 'REVISION_CONFLICT'));
  });
}

test('actual due controls omit blank optional filters and use named due reads for explicit date and branch', async () => {
  const h = await harness(), filterForm = ancestorWith(control(h.page, 'Due on (optional)'), node => node.tagName === 'form');
  await filterForm.dispatch('submit'); await settle();
  assert.deepEqual(h.calls.filter(call => call.method === 'decisions.journal.due').at(-1)?.payload, {});
  await set(h.page, 'Due on (optional)', '2026-10-15'); await set(h.page, 'Branch filter (optional)', 'main'); await filterForm.dispatch('submit'); await settle();
  assert.deepEqual(h.calls.filter(call => call.method === 'decisions.journal.due').at(-1)?.payload, { dueOn: '2026-10-15', branch: 'main' });
  await click(h.page, 'Show all decisions'); assert.ok(h.calls.filter(call => call.method === 'decisions.list').length >= 2);
  assert.equal(h.rejected.length, 0);
});

test('actual rich history displays retained exact evidence as safe readable DOM and journal rows use rich controls', async () => {
  const initial = richDecision(); initial.text = UNSAFE_TEXT; initial.options[0].reason = UNSAFE_TEXT;
  const historic = reviewDecision(initial, { outcome: 'completed', observation: { state: 'achieved', measurements: [{ receiptId: MEASURED.id, figureKey: 'earned' }],
    notes: UNSAFE_TEXT, uncertainty: ['No causal conclusion.'], concurrentInterventions: ['Concurrent promotion.'], executionReceiptIds: [] } },
  { expectedRevision: 1, actorId: 'owner', at: '2026-10-15T10:00:00.000Z', receipts: [MEASURED] });
  const h = await harness({ decisions: [historic] });
  for (const label of ['Review journal', 'Revise journal', 'History']) button(h.page, label);
  assert.ok(!descendants(h.page).some(node => node.tagName === 'button' && node.textContent === 'Review'));
  await h.renderer.showJournalHistory(historic); const history = modal(h.body);
  assert.ok(history.textContent.includes(UNSAFE_TEXT)); assert.ok(history.textContent.includes(MEASURED.figures[0].display));
  assert.ok(history.textContent.includes('human-declared')); assert.ok(history.textContent.includes('Concurrent promotion.'));
  assert.ok(!descendants(history).some(node => ['script', 'img', 'iframe'].includes(node.tagName)));
  assert.ok(!descendants(history).some(node => node.tagName === 'textarea' || node.tagName === 'input'));
  assert.equal(h.rejected.length, 0);
});

test('actual decision page retains legacy recording and review alongside rich journal controls', async () => {
  const h = await harness(); await click(h.page, 'Record a decision'); const legacyForm = find(modal(h.body, 'Record a decision'), node => node.tagName === 'form');
  await set(legacyForm, 'Your choice and reasoning', 'Keep the legacy flow available.'); await set(legacyForm, 'Review date', '2026-10-15');
  await legacyForm.dispatch('submit'); await settle();
  assert.deepEqual(h.calls.find(call => call.method === 'decisions.create')?.payload, { text: 'Keep the legacy flow available.', reviewDate: '2026-10-15', receiptIds: [], hypotheses: [] });
  const recorded = descendants(h.body).filter(node => node.tagName === 'dialog' && node.open); for (const dialog of recorded) dialog.close();
  const legacyRow = ancestorWith(find(h.page, node => node.tagName === 'h3' && node.textContent === LEGACY.text), node => node.tagName === 'article');
  await click(legacyRow, 'Review'); const reviewForm = find(modal(h.body, 'Review a decision'), node => node.tagName === 'form');
  await set(reviewForm, 'Review outcome', 'completed'); await set(reviewForm, 'Review notes', 'A legacy human review.'); await reviewForm.dispatch('submit'); await settle();
  assert.deepEqual(h.calls.find(call => call.method === 'decisions.review')?.payload, { id: LEGACY.id, outcome: 'completed', notes: 'A legacy human review.' });
  assert.equal(h.rejected.length, 0);
});
