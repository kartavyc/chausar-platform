import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync, realpathSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService } from '../runtime/ingest.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { AnalyticalHelper } from '../runtime/helper.ts';
import { Engine } from '../runtime/engine.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { outlineOf, withBoxes, wordsOf } from '../runtime/work-books/books-bill-r4b.ts';
import { parseBill } from '../runtime/work-books/books-bill-parse.ts';

// Round 4 of the work-books lane (BK-09, BK-12, BK-19, BK-20, bill photo word boxes). Synthetic data only.
// Other lanes are stubbed in a hand-built host: which of their methods are installed is the stub's own list.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic R4 Shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1 };
type Stub = Record<string, (payload: any, store: TestStore) => unknown>;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const fact = (entityId: string, kind: string, validFrom: string, fields: Record<string, unknown>): FactInput =>
  ({ entityId, sourceId: 'books', sourceRow: 2, kind, validFrom, branch: 'main', fields: { currency: 'INR', status: 'settled', ...fields } });

async function setup(options: { stub?: Stub; helper?: unknown } = {}) {
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }); });
  const services: Record<string, any> = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store), actions: new ActionService(store, []), ...(options.helper ? { helper: options.helper } : {}) };
  await services.ontology.publish(owner, 'ecommerce');
  const calls: { method: string; payload: any }[] = [];
  const methods = { ...booksMethods, ...workMethods };
  const host = (ctx: Context): ModuleHost => ({ store, services, demo: true, directory: '/tmp/x', options: { hasMethod: (method: string) => !!options.stub && Object.hasOwn(options.stub, method) },
    async call(method, payload) {
      calls.push({ method, payload: structuredClone(payload) });
      if (options.stub && Object.hasOwn(options.stub, method)) return options.stub[method](payload, store);
      if (Object.hasOwn(booksMethods, method)) return call(ctx, method, payload);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = methods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  return { store, services, call, calls };
}
const reminderAction = (id: string, customerId: string, at: string) => ({ id, connector: 'local', operation: 'reminder-draft', payload: { invoiceId: 'inv-1', customerId, text: 'Please pay.' },
  sourceIds: ['books'], idempotencyKey: id, digest: 'd', revision: 1, createdBy: 'owner', createdEpoch: 1, createdAt: at, impact: 'reversible', status: 'prepared', attempts: [] });

// ---------------------------------------------------------------- BK-12 the rest of the time line

test('BK-12: the time line adds reminders, actions, write-back journal entries and notes, each with its source', async () => {
  const journal = [
    { id: 'j1', kind: 'sent', invoiceId: 'inv-1', customerId: 'c-1', actionId: 'a-wb', on: '2026-09-10', at: '2026-09-10T09:00:00.000Z', sourceIds: ['books'] },
    { id: 'j2', kind: 'paid', invoiceId: 'inv-1', customerId: 'c-1', actionId: null, on: '2026-09-12', at: '2026-09-12T09:00:00.000Z', sourceIds: ['books'] },
    { id: 'j3', kind: 'sent', invoiceId: 'inv-9', customerId: 'c-10', actionId: 'a-x', on: '2026-09-11', at: '2026-09-11T09:00:00.000Z', sourceIds: ['books'] },
  ];
  const { store, services, call } = await setup({ stub: { 'writeback.followUp.journal': () => journal } });
  await services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' }), fact('inv-9', 'invoice', '2026-09-02', { customerId: 'c-10', amountMinor: '1000' })]);
  await call(owner, 'books.remember', { text: 'c-1 prefers calls after noon', kind: 'preference' });
  await call(owner, 'books.remember', { text: 'c-10 pays late', kind: 'claim' });
  await store.update(s => { s.actions.push(reminderAction('a-1', 'c-1', '2026-09-08T10:00:00.000Z'), { ...reminderAction('a-2', 'c-10', '2026-09-08T11:00:00.000Z') }); });

  const more = await call(viewer, 'records.timelineMore', { id: 'c-1' });
  assert.equal(more.recordId, 'c-1'); assert.deepEqual(more.journal, { available: true }); assert.equal(more.omitted, 0);
  assert.deepEqual(more.entries.map((e: any) => [e.type, e.source, e.ref]), [
    ['reminder', 'actions', 'a-1'], ['reminder-sent', 'writeback-journal', 'inv-1'], ['payment-noted', 'writeback-journal', 'inv-1'], ['note', 'memory', more.entries[3].ref]]);
  assert.equal(more.entries[0].what, 'reminder-draft'); assert.equal(more.entries[0].status, 'prepared');
  assert.equal(more.entries[3].what, 'c-1 prefers calls after noon');
  assert.ok(more.entries.every((e: any) => !JSON.stringify(e).includes('c-10')), 'a longer id is never matched');

  await assert.rejects(call(viewer, 'records.timelineMore', { id: 'nobody' }), code('RECORD_NOT_FOUND'));
  await assert.rejects(call(viewer, 'records.timelineMore', { id: 'c-1', extra: 1 }), code('INVALID_BOOKS_REQUEST'));
  const without = await setup();
  await without.services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  assert.deepEqual(await without.call(viewer, 'records.timelineMore', { id: 'c-1' }), { recordId: 'c-1', entries: [], omitted: 0, journal: { available: false } });
});

test('BK-12: an action is listed only under core\'s access rule; a private one of another member is not', async () => {
  const { store, services, call } = await setup();
  await services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  await store.update(s => { s.actions.push({ ...reminderAction('a-private', 'c-1', '2026-09-08T10:00:00.000Z'), sourceIds: [], createdBy: 'ravi' }); });
  assert.deepEqual((await call(viewer, 'records.timelineMore', { id: 'c-1' })).entries, []);
  assert.deepEqual((await call(owner, 'records.timelineMore', { id: 'c-1' })).entries.map((e: any) => e.ref), ['a-private'], 'the owner with every branch sees it');
});

// ---------------------------------------------------------------- BK-20 through core-data's one-customer deletion

/** A stand-in for core-data's deletion: it removes the customer's facts the way a core deletion would. */
const coreDelete: Stub = {
  'deletion.customer': (payload, store) => {
    assert.deepEqual(Object.keys(payload).sort(), ['confirmation', 'customerId', 'recordIds']);
    for (const f of store.state.facts) if (payload.recordIds.includes(f.fields.customerId)) f.deletedAt = '2026-10-15T00:00:00.000Z';
    return { customerId: payload.customerId, stores: [{ store: 'facts', count: 1 }] };
  },
};

test('BK-20: with core-data installed, the plan offers the core stores and delete reports each store after counting again', async () => {
  const { services, call, calls } = await setup({ stub: coreDelete });
  await services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  await call(owner, 'records.setOptIn', { id: 'c-1', channel: 'mail', answer: 'yes', source: 'Email', on: '2026-09-03' });
  const plan = await call(viewer, 'records.deletionPlan', { id: 'c-1' });
  assert.deepEqual(plan.coreDeletion, { available: true }); assert.equal(plan.canDelete, true);
  assert.deepEqual(plan.stores.find((s: any) => s.store === 'facts'), { store: 'facts', count: 1, state: 'can-delete', reason: null });

  // Deleting always waits for a person: the approve seat and the typed id, checked before core-data is called.
  await assert.rejects(call(accountant, 'records.delete', { id: 'c-1', confirmation: 'c-1' }), code('FORBIDDEN'));
  await assert.rejects(call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1 ' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(call({ ...owner, sourceTainted: true }, 'records.delete', { id: 'c-1', confirmation: 'c-1' }), code('TAINTED_APPROVAL'));
  assert.equal(calls.filter(c => c.method === 'deletion.customer').length, 0, 'not called before the yes');

  const report = await call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  assert.deepEqual(calls.filter(c => c.method === 'deletion.customer').map(c => c.payload), [{ customerId: 'c-1', recordIds: ['c-1'], confirmation: 'c-1' }]);
  const by = Object.fromEntries(report.rows.map((r: any) => [r.store, r.state]));
  assert.deepEqual([by.facts, by['opt-ins'], by.receipts], ['deleted', 'deleted', 'nothing-held']);
  assert.equal(report.complete, true);
});

test('BK-20: a core deletion that refuses keeps its code on the store, which is never reported deleted', async () => {
  const { services, call } = await setup({ stub: { 'deletion.customer': () => { throw new ChausarError('CORE_DELETION_LOCKED', 'Locked.'); } } });
  await services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  const report = await call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  const facts = report.rows.find((r: any) => r.store === 'facts');
  assert.equal(facts.state, 'pending'); assert.match(facts.reason, /CORE_DELETION_LOCKED/); assert.equal(report.complete, false);
});

test('BK-20: without the core deletion installed, the core stores stay "not possible here"', async () => {
  const { services, call, calls } = await setup({ stub: { 'trustx.deletions': () => ({ items: [] }) } });
  await services.memory.append(owner, [fact('inv-1', 'invoice', '2026-09-02', { customerId: 'c-1', amountMinor: '50000' })]);
  await call(owner, 'books.remember', { text: 'c-1 prefers calls after noon', kind: 'preference' });
  const plan = await call(viewer, 'records.deletionPlan', { id: 'c-1' });
  assert.deepEqual(plan.coreDeletion, { available: false }); assert.equal(plan.stores.find((s: any) => s.store === 'facts').state, 'needs-owner');
  const report = await call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  assert.equal(report.rows.find((r: any) => r.store === 'facts').state, 'not-possible');
  assert.equal(calls.some(c => c.method === 'deletion.customer'), false, 'never probed');
});

// ---------------------------------------------------------------- BK-19 the not-counted count from receipts

test('BK-19: once receipts carry the not-counted count, books.rates lists it from the caller\'s own receipts; rates stay entered here', async () => {
  const { store, call } = await setup();
  const before = await call(viewer, 'books.rates', {});
  assert.deepEqual(before.fromReceipts, { available: false, receipts: [] });
  const receipt = (id: string, memberId: string, notCounted: unknown) => ({ id, memberId, operation: 'billed', createdAt: '2026-10-01T10:00:00.000Z', coverage: { countedRows: 3, notCounted } });
  await store.update(s => { s.receipts.push(receipt('r-old', 'vik', undefined), receipt('r-1', 'vik', [{ currency: 'USD', rows: 2 }, { currency: 'EUR', rows: 0 }]), receipt('r-2', 'vik', []), receipt('r-other', 'owner', [{ currency: 'AED', rows: 9 }])); });
  const after = await call(viewer, 'books.rates', {});
  assert.deepEqual(after.fromReceipts, { available: true, receipts: [{ receiptId: 'r-1', operation: 'billed', at: '2026-10-01T10:00:00.000Z', notCounted: [{ currency: 'USD', rows: 2 }] }] });
  assert.deepEqual(after.rates, []);
  await assert.rejects(call(viewer, 'books.setRate', { currency: 'USD', on: '2026-09-02', rate: { units: '832150', per: '10000' }, source: 'RBI' }), code('FORBIDDEN'));
});

// ---------------------------------------------------------------- bill photo: word boxes and every page

const PAGE1 = ['Sharma Paper Mart', 'Bill No: SPM-0042', 'Date: 05/09/2026', 'A4 Paper Ream 2 x 250.00 500.00'].join('\n');
const PAGE2 = ['CGST 9% 45.00', 'Grand Total 545.00'].join('\n');
/** Synthetic word boxes in the helper's shape: each word on its line, 100 pixels a word, 50 a line. */
function wordsFor(text: string) {
  return text.split('\n').flatMap((line, i) => line.split(' ').map((word, j) => ({ text: word, line: i + 1, left: 100 + j * 100, top: 100 + i * 50, width: 90, height: 40, confidence: 92 })));
}
const twoPages = { pages: [
  { page: 1, text: PAGE1, confidence: 92, width: 1000, height: 2000, words: wordsFor(PAGE1), wordsOmitted: 0 },
  { page: 2, text: PAGE2, confidence: 92, width: 1000, height: 2000, words: wordsFor(PAGE2), wordsOmitted: 3 }], engineVersion: '5.3.4' };
const pdf = Buffer.from('%PDF-1.4\nsynthetic bill page\n%%EOF\n').toString('base64');

test('bill photo: the reader is asked for word boxes; each field is outlined by its words, on every page', async () => {
  const seen: any[] = [];
  const { call } = await setup({ helper: { run: async (op: string, input: any) => { seen.push({ op, input }); return { result: structuredClone(twoPages) }; } } });
  const read = await call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  assert.equal(seen[0].op, 'pdf.ocr'); assert.equal(seen[0].input.words, true); assert.equal(seen[0].input.maxPages, 4);
  assert.equal(read.reader.pages, 2);
  assert.deepEqual(read.outline.map((p: any) => [p.page, p.boxes.length, p.omitted]), [[1, wordsFor(PAGE1).length, 0], [2, wordsFor(PAGE2).length, 3]]);
  // The bill number is the one word that holds it, not the whole line.
  assert.deepEqual(read.billNumber.region, { page: 1, line: 2, of: 4, box: { x: 300, y: 75, w: 90, h: 20 } });
  // The total is on page 2, outlined by its last word with a digit.
  assert.equal(read.total.value, '54500'); assert.deepEqual(read.total.region, { page: 2, line: 2, of: 2, box: { x: 300, y: 75, w: 90, h: 20 } });
  assert.equal(read.tax[0].amount.region.page, 2); assert.ok(read.tax[0].amount.region.box);
  for (const p of read.outline) for (const b of p.boxes) assert.ok([b.x, b.y, b.w, b.h].every(v => Number.isInteger(v) && v >= 0 && v <= 1000));
});

test('bill photo: a reader without word boxes keeps the line band; boxes in another shape are not trusted', async () => {
  const plain = await setup({ helper: { run: async () => ({ result: { pages: [{ page: 1, text: PAGE1 + '\n' + PAGE2, confidence: 92 }], engineVersion: '5.3.4' } }) } });
  const read = await plain.call(owner, 'books.billRead', { bytesBase64: pdf, mime: 'application/pdf' });
  assert.deepEqual(read.outline, []); assert.deepEqual(read.billNumber.region, { page: 1, line: 2, of: 6 });
  assert.equal(wordsOf({ pages: [{ ...twoPages.pages[0], words: [{ text: 'x', line: 0, left: 1, top: 1, width: 1, height: 1 }] }] }), null);
  assert.equal(wordsOf({ pages: [{ ...twoPages.pages[0], width: 0 }] }), null);
  assert.deepEqual(outlineOf(null), []);
  const proposal = parseBill([{ page: 1, text: PAGE1, confidence: 92 }]);
  assert.deepEqual(withBoxes(proposal, null), proposal);
});

test('helper: pdf.ocr accepts the additive words option and still refuses any other input', async () => {
  const sent: string[] = [];
  const spawnProcess: any = () => {
    const child: any = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
    child.stdin.on('data', (chunk: Buffer) => sent.push(chunk.toString()));
    child.stdin.on('finish', () => queueMicrotask(() => { child.stdout.write(JSON.stringify({ ok: true, operation: 'pdf.ocr', result: structuredClone(twoPages), runtime: { python: '3.12.3', resourceLimits: true } })); child.emit('close', 0); }));
    return child;
  };
  const helper = new AnalyticalHelper({ executable: process.execPath, spawnProcess });
  const result = await helper.run('pdf.ocr', { pdfBase64: pdf, maxPages: 4, words: true });
  assert.equal(result.result.pages[1].words.length, wordsFor(PAGE2).length); assert.match(sent.join(''), /"words":true/);
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64: pdf, boxes: true }), code('INVALID_HELPER_INPUT'));
});

// ---------------------------------------------------------------- BK-09 publish strategies, through the real engine

const sourceId = 'synthetic-r4-source';
const importInput = { sourceId, format: 'csv',
  content: 'id,kind,date,amount,tax,currency,branch,status\nI1,invoice,2026-09-02,100.00,10.00,INR,main,issued\nI2,invoice,2026-09-03,200.00,20.00,INR,main,issued\nP1,payment,2026-09-04,50.00,0.00,INR,main,settled',
  recipe: { version: 1, id: 'synthetic-r4-recipe', system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic R4', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice', 'payment'], allowedStatuses: ['issued', 'settled'], onUnmapped: 'report' },
  expectedTotals: { rowCount: 3, amountMinor: '35000' } };

async function engineWithDraft(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-books-r4-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic R4 Shop', passphrase: 'Synthetic r4 passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  await engine.request('sources.import', importInput);
  const asOf = new Date(Date.now() + 1).toISOString();
  await engine.request('calculation.run', { operation: 'billed', sourceIds: [sourceId], asOf });
  const word = (await engine.request('books.meaning', { name: 'billed' })).word;
  const draft = await engine.request('books.draft', { name: 'billed', definition: { label: word.label, meaning: 'Synthetic trial: billed counts invoice tax only.', kind: word.kind, field: 'taxMinor', nulls: word.nulls } });
  return { engine, draft, trial: await engine.request('books.trial', { draftId: draft.id }) };
}

test('BK-09: both publish strategies are offered, each with its own impact preview from core', async t => {
  const { engine, trial } = await engineWithDraft(t);
  assert.deepEqual(trial.impacts.map((i: any) => i.strategy), ['prospective', 'retrospective']);
  for (const i of trial.impacts) { assert.ok(i.digest, i.strategy); assert.equal(i.code, null); assert.equal(i.affectedAnswers, 1); assert.equal(i.activeWork, 0); }
  assert.notEqual(trial.impacts[0].digest, trial.impacts[1].digest, 'each strategy has its own digest');
  assert.equal(trial.impact.digest, trial.impacts[0].digest, 'the round-two field stays the prospective one');
  assert.equal(trial.impacts[1].rebuild, 1);
  // A digest reviewed for one strategy does not publish the other.
  await assert.rejects(engine.request('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: trial.impacts[0].digest, strategy: 'retrospective' }), code('TRIAL_IMPACT_NOT_ACKNOWLEDGED'));
  await assert.rejects(engine.request('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: trial.impacts[1].digest, strategy: 'sideways' }), code('INVALID_BOOKS_REQUEST'));
});

test('BK-09: publishing retrospectively restates the saved answer as new evidence; the original receipt stays', async t => {
  const { engine, draft, trial } = await engineWithDraft(t);
  const retro = trial.impacts.find((i: any) => i.strategy === 'retrospective');
  const published = await engine.request('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: retro.digest, strategy: 'retrospective' });
  assert.equal(published.status, 'promoted'); assert.equal(published.strategy, 'retrospective'); assert.equal(published.draftId, draft.id);
  const answers = engine.vault!.read().answers;
  const restated = answers.filter((a: any) => a.publicationId === published.publicationId);
  assert.equal(restated.length, 1); assert.equal(restated[0].interpretation, 'restated-private-diagnostic');
  assert.equal((await engine.request('receipts.get', { id: restated[0].receiptId })).totalMinor, '3000');
  assert.equal((await engine.request('books.meanings', {})).drafts.find((d: any) => d.id === draft.id).state, 'published');
});

// ---------------------------------------------------------------- the real reader, where tesseract is installed

const python = process.env.CHAUSAR_PYTHON ?? (existsSync('/usr/bin/python3') ? realpathSync('/usr/bin/python3') : '');
const PROBE = 'import os, shutil, subprocess, pypdfium2, PIL\nt = shutil.which("tesseract", path=os.defpath)\nassert t\nassert "eng" in subprocess.run([t, "--list-langs"], capture_output=True, text=True).stdout.split()';
const probe = python ? spawnSync(python, ['-I', '-c', PROBE], { encoding: 'utf8', timeout: 20_000 }) : null;
const ocrSkip = !python ? 'no Python found (set CHAUSAR_PYTHON)' : probe?.status !== 0 ? 'tesseract-ocr with eng, pypdfium2 and Pillow are not installed for the configured Python' : false;
/** Bill pages drawn as pictures with Pillow; one PNG, or a picture-only PDF of every page. */
const RENDER = `
import base64, io, json, sys
from PIL import Image, ImageDraw, ImageFont
request = json.loads(sys.stdin.read())
try:
    font = ImageFont.truetype("DejaVuSans.ttf", 30)
except OSError:
    font = ImageFont.load_default(size=30)
images = []
for text in request["pages"]:
    image = Image.new("RGB", (1240, 1754), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    for index, line in enumerate(text.split("\\n")):
        draw.text((100, 120 + index * 60), line, font=font, fill=(0, 0, 0))
    images.append(image)
out = io.BytesIO()
if request["as"] == "png":
    images[0].save(out, "PNG")
else:
    images[0].save(out, "PDF", save_all=True, append_images=images[1:], resolution=150)
sys.stdout.write(base64.b64encode(out.getvalue()).decode())
`;
const render = (pages: string[], as: 'png' | 'pdf') => {
  const done = spawnSync(python, ['-I', '-c', RENDER], { input: JSON.stringify({ pages, as }), encoding: 'utf8', timeout: 30_000 });
  assert.equal(done.status, 0, done.stderr); return done.stdout.trim();
};

test('real OCR: a bill photo is read by tesseract with word boxes; a two-page bill is outlined on both pages', { skip: ocrSkip, timeout: 120_000 }, async () => {
  const helper = new AnalyticalHelper({ executable: python, timeoutMs: 30_000 });
  const { call } = await setup({ helper });
  const photo = render([`${PAGE1}\n${PAGE2}`], 'png');
  const read = await call(owner, 'books.billRead', { bytesBase64: photo, mime: 'image/png' });
  assert.equal(read.reader.engine, 'tesseract'); assert.match(read.reader.version, /^\d/); assert.equal(read.reader.pages, 1);
  assert.equal(read.billNumber.value, 'SPM-0042'); assert.equal(read.total.value, '54500');
  assert.equal(read.outline.length, 1); assert.ok(read.outline[0].boxes.length >= 15, String(read.outline[0].boxes.length));
  const box = read.total.region.box; assert.ok(box && box.x > 0 && box.y > 0 && box.x + box.w <= 1000 && box.y + box.h <= 1000, JSON.stringify(read.total.region));
  assert.ok(read.billNumber.region.box.y < box.y, 'the bill number is above the total on the page');

  const twoPage = render([PAGE1, PAGE2], 'pdf');
  const direct = await helper.run('pdf.ocr', { pdfBase64: twoPage, maxPages: 4, words: true });
  assert.equal(direct.result.pages.length, 2);
  for (const page of direct.result.pages) { assert.ok(page.width > 0 && page.height > 0); assert.ok(page.words.length > 0); assert.ok(page.words.every((w: any) => w.line >= 1 && Number.isInteger(w.left))); }
  const plain = await helper.run('pdf.ocr', { pdfBase64: twoPage, maxPages: 4 });
  assert.equal('words' in plain.result.pages[0], false, 'without the option the reply is as before');
  await assert.rejects(helper.run('pdf.ocr', { pdfBase64: twoPage, words: 'yes' }), code('INVALID_HELPER_INPUT'));
  const both = await call(owner, 'books.billRead', { bytesBase64: twoPage, mime: 'application/pdf' });
  assert.deepEqual(both.outline.map((p: any) => p.page), [1, 2]); assert.equal(both.total.region.page, 2); assert.ok(both.total.region.box);
});
