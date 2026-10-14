import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe, ImportService } from '../runtime/ingest.ts';
import { MemoryService } from '../runtime/memory.ts';
import { compileDictionary, OntologyService, starterPacks } from '../runtime/ontology.ts';
import { MCPService } from '../runtime/mcp.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { Engine } from '../runtime/engine.ts';
import { dictionaryMethods, dictionaryTick, purgeDictionary } from '../runtime/learning-ext/dictionary.ts';
import { dictionaryMcpTools, maskOf, samplesLayer, schemaLayer, operationsLayer } from '../runtime/learning-ext/dictionary-layers.ts';
import { assertAnswerKey, defaultAnswerKey, runAnswerKey } from '../runtime/learning-ext/dictionary-answer-key.ts';
import { buildDraft, choosePack, profileColumn } from '../runtime/learning-ext/dictionary-builder.ts';
import { applyEdit, assertEdit } from '../runtime/learning-ext/dictionary-edits.ts';
import { logPage } from '../runtime/learning-ext/log.ts';

// All data below is synthetic. Expected totals are the hand-worked values of the demo fixture.
class TestStore implements StateStore {
  state: State;
  constructor(state = initialState('Synthetic dictionary shop', true)) { this.state = state; }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
function hostFor(store: StateStore, ctx: Context = owner): ModuleHost {
  return { store, services: {}, demo: true, directory: '', options: {}, call: async (method, payload) => {
    const ontology = new OntologyService(store);
    if (method === 'ontology.publish') return ontology.publishPayload(ctx, payload as any);
    if (method === 'ontology.get') return ontology.get(ctx, payload as any);
    throw new Error(`Unexpected call ${method}`);
  } };
}
const call = (name: string, payload: Record<string, unknown>, store: StateStore, ctx: Context = owner) => dictionaryMethods[name].handler(ctx, payload, hostFor(store, ctx)) as Promise<any>;
const withColumn = (rows: string, prefix: string, header: string, value: string) => rows.trim().split('\n').map((line, index) => index === 0 ? `${line},${header}` : `${line.replace(/^([a-z]+-?[a-z0-9]*)/, `${prefix}$1`)},${value}`).join('\n') + '\n';
async function seeded(pack = 'ecommerce') {
  const store = new TestStore(); await new OntologyService(store).publish(owner, pack);
  await new ImportService(store).commit(owner, { sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  return store;
}
async function importWithColumn(store: StateStore, sourceId: string, prefix: string) {
  const content = withColumn(demoCsv, prefix, 'Sales Channel', 'web');
  return new ImportService(store).commit(owner, { sourceId, format: 'csv', content, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
}

test('three read-only layers: schema, samples governed by the send level, and the calculation menu', async () => {
  const empty = new TestStore();
  assert.equal((schemaLayer(empty, owner) as any).state, 'absent');
  assert.equal((samplesLayer(empty, owner) as any).state, 'absent');
  await new OntologyService(empty).publish(owner, 'ecommerce');
  assert.deepEqual((samplesLayer(empty, owner) as any).fields.amountMinor, { state: 'withheld' });
  empty.state.policy.send = 'samples';
  assert.equal((samplesLayer(empty, owner) as any).fields.amountMinor.state, 'not loaded yet');

  const store = await seeded();
  await new MemoryService(store).append(owner, [{ entityId: 'g-1', sourceId: 'books', sourceRow: 2, kind: 'invoice', validFrom: '2026-09-02', branch: 'main', fields: { amountMinor: '100', currency: 'INR', gstin: '27AAPFU0939F1ZV', status: 'unpaid' } }]);
  const schema = schemaLayer(store, owner) as any;
  assert.equal(schema.state, 'published'); assert.ok(schema.fields.some((f: any) => f.name === 'amountMinor' && f.type === 'money'));
  assert.ok(schema.definitions.some((d: any) => d.name === 'earned' && d.sign === 1)); assert.deepEqual(schema.checks.required, ['entityId', 'validFrom', 'currency']);
  const operations = operationsLayer(store, owner) as any;
  assert.ok(operations.operations.some((o: any) => o.id === 'margin' && o.type === 'margin')); assert.match(operations.readOnly, /read-only/);

  const nothing = samplesLayer(store, owner) as any;
  assert.equal(nothing.send, 'nothing'); assert.ok(Object.values(nothing.fields).every((f: any) => f.state === 'withheld'));
  assert.ok(!JSON.stringify(nothing).includes('cust-1'));
  store.state.policy.send = 'shape';
  const shape = samplesLayer(store, owner, { fields: ['customerId', 'gstin', 'pan', 'unknownField'] }) as any;
  assert.deepEqual(shape.fields.customerId, { state: 'shape', type: 'string', shapes: [{ mask: 'aaaa-9', length: '5-8' }] });
  assert.equal(shape.fields.pan.state, 'absent'); assert.equal(shape.fields.unknownField.state, 'absent');
  assert.ok(!JSON.stringify(shape).includes('cust-1') && !JSON.stringify(shape).includes('27AAPFU'));
  store.state.policy.send = 'samples';
  const samples = samplesLayer(store, owner) as any;
  assert.deepEqual(samples.fields.customerId.values, ['cust-1', 'cust-2']);
  assert.ok(samples.fields.amountMinor.values.length <= 5);
  assert.deepEqual(samples.fields.gstin.values, [{ masked: 'GSTIN', mask: maskOf('27AAPFU0939F1ZV') }]);
  assert.equal(maskOf('Inv-42'), 'Aaa-99');

  // A member limited to one branch sees samples only from that branch.
  store.state.members.push({ id: 'west-viewer', name: 'Synthetic viewer', role: 'viewer', active: true, epoch: 1, branches: ['west'] });
  const west = samplesLayer(store, { memberId: 'west-viewer', role: 'viewer', epoch: 1 }, { fields: ['customerId'] }) as any;
  assert.deepEqual(west.fields.customerId.values, ['cust-2']);

  // The same layers as MCP read tools, with closed schemas and read-only annotations.
  const mcp = new MCPService(store, { calculations: [], readTools: dictionaryMcpTools(store) });
  await mcp.handle(owner, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic' } } });
  await mcp.handle(owner, { jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = await mcp.handle(owner, { jsonrpc: '2.0', id: 2, method: 'tools/list' }) as any;
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ['dictionary_schema', 'dictionary_samples', 'dictionary_operations']);
  assert.ok(list.result.tools.every((t: any) => t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  const extra = await mcp.handle(owner, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'dictionary_schema', arguments: { write: true } } }) as any;
  assert.equal(extra.error.data.code, 'INVALID_ARGUMENTS');
  assert.throws(() => new MCPService(store, { calculations: [], readTools: [...dictionaryMcpTools(store), dictionaryMcpTools(store)[0]] }), { code: 'INVALID_MCP_TOOL' });
  assert.throws(() => new MCPService(store, { calculations: [], readTools: [{ ...dictionaryMcpTools(store)[0], name: 'open_receipt' }] }), { code: 'INVALID_MCP_TOOL' });
});

test('the hand-worked answer key passes on every starter pack and catches planted bad edits', async () => {
  for (const pack of starterPacks) assert.equal((await runAnswerKey(defaultAnswerKey, pack)).passed, true, pack.pack);
  const ecommerce = starterPacks[0];
  const sign = await runAnswerKey(defaultAnswerKey, applyEdit(ecommerce, assertEdit({ edit: 'change-sign', name: 'earned', sign: -1 })));
  assert.deepEqual(sign.failing, ['earned', 'net-sales', 'margin']);
  assert.equal(sign.cases.find(c => c.id === 'earned')!.actualMinor, '-250000');
  const removed = await runAnswerKey(defaultAnswerKey, applyEdit(ecommerce, assertEdit({ edit: 'remove-definition', name: 'refunds' })));
  assert.deepEqual(removed.failing, ['refunds', 'net-sales', 'margin', 'aging']);
  const kind = await runAnswerKey(defaultAnswerKey, applyEdit(ecommerce, assertEdit({ edit: 'change-kind', name: 'received', kind: 'sale' })));
  assert.ok(kind.failing.includes('received'));
  // A candidate without a field the recipe binds fails every case with a code.
  const missing = structuredClone(ecommerce); delete (missing.fields as any).orderId;
  const refused = await runAnswerKey(defaultAnswerKey, missing);
  assert.equal(refused.passed, false); assert.equal(refused.failing.length, 8); assert.ok(refused.cases.every(c => c.code === 'UNKNOWN_BINDING'));
  assert.throws(() => assertAnswerKey({ ...defaultAnswerKey, cases: [{ id: 'x', operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, expectedMinor: 3000 }] }), { code: 'INVALID_ANSWER_CASE' });
  assert.throws(() => assertAnswerKey({ ...defaultAnswerKey, run: 'process.exit()' }), { code: 'INVALID_ANSWER_KEY' });
  assert.throws(() => assertEdit({ edit: 'change-sign', name: 'earned', sign: 2 }), { code: 'INVALID_EDIT' });
  assert.throws(() => assertEdit({ edit: 'add-field', name: 'x', type: 'money', code: 'eval()' }), { code: 'INVALID_EDIT' });
  assert.throws(() => applyEdit(ecommerce, { edit: 'change-label', name: 'billed', label: 'Billed' }), { code: 'EDIT_NO_CHANGE' });
});

test('the builder profiles columns, chooses a pack by evidence and adopts only after the answer key', async () => {
  assert.equal(choosePack(['SKU', 'Marketplace', 'Order Total']).pack, 'ecommerce');
  assert.equal(choosePack(['Project', 'Milestone', 'Amount']).pack, 'services');
  assert.equal(choosePack(['Subscription Id', 'Seat Count']).pack, 'saas');
  assert.equal(choosePack(['Batch No', 'Raw Material']).pack, 'manufacturing');
  assert.equal(choosePack(['Outlet', 'Bill Amount']).pack, 'retail');
  assert.equal(choosePack(['Distributor', 'Territory']).pack, 'distributor');
  assert.deepEqual(choosePack(['Name', 'Amount']), { pack: 'ecommerce', confidence: 'low', scores: { ecommerce: 0, services: 0, saas: 0, manufacturing: 0, retail: 0, distributor: 0 }, matched: [] });
  assert.equal(profileColumn('Net Amount', ['1,250.50', '99']).type, 'money');
  assert.equal(profileColumn('Reference', ['1250.50']).type, 'string');
  assert.equal(profileColumn('Posted On', ['03/09/2026', '4-9-2026']).dateFormat, 'DMY');
  assert.equal(profileColumn('Batch Number', ['20260901']).type, 'integer');
  assert.equal(profileColumn('Active', ['true', 'FALSE']).type, 'boolean');

  const store = new TestStore();
  const csv = 'id,Project Code,Milestone,Hours Billed,Invoice Amount,Invoice Date,amount\nrow-1,P-1,M1,12,1500.50,2026-09-01,10.00\nrow-2,P-2,M2,8,,2026-09-02,20.00\n';
  const built = buildDraft([{ content: csv }]);
  assert.equal(built.pack.pack, 'services');
  assert.deepEqual(built.evidence.filter(e => !e.existing).map(e => [e.name, e.type]), [['hoursBilled', 'integer'], ['invoiceAmountMinor', 'money'], ['invoiceDate', 'date'], ['milestone', 'string'], ['projectCode', 'string']]);
  assert.ok(built.evidence.some(e => e.name === 'amountMinor' && e.existing));
  assert.ok(!JSON.stringify(built.draft).includes('P-1') && !JSON.stringify(built.draft).includes('1500'));
  assert.doesNotThrow(() => compileDictionary(built.draft));

  const proposal = await call('learningx.dictionaryBuild', { files: [{ content: csv }], label: 'Synthetic studio' }, store);
  assert.equal(proposal.pack.pack, 'services'); assert.equal(proposal.status, 'proposed'); assert.equal(proposal.draft.label, 'Synthetic studio');
  await assert.rejects(call('learningx.dictionaryBuild', { files: [{ content: csv }], candidate: { ...starterPacks[0], run: 'fetch()' } }, store), { code: 'INVALID_DICTIONARY' });
  await assert.rejects(call('learningx.dictionaryAdopt', { id: proposal.id, digest: 'f'.repeat(64) }, store), { code: 'PROPOSAL_CHANGED' });
  await assert.rejects(call('learningx.dictionaryAdopt', { id: proposal.id, digest: proposal.digest }, store, { ...owner, channel: 'phone' }), { code: 'APP_APPROVAL_REQUIRED' });
  const adopted = await call('learningx.dictionaryAdopt', { id: proposal.id, digest: proposal.digest }, store);
  assert.equal(adopted.published, true); assert.equal(adopted.dictionary.pack, 'services');
  assert.equal(new OntologyService(store).current(owner)!.fields.hoursBilled, 'integer');

  // A model-proposed draft that compiles but breaks the hand-worked key is never published.
  const broken = structuredClone(starterPacks[0]); broken.definitions.find(d => d.name === 'earned')!.sign = -1;
  const bad = await call('learningx.dictionaryBuild', { files: [{ content: csv }], candidate: broken }, store);
  assert.equal(bad.origin, 'model');
  const before = new OntologyService(store).current(owner)!.hash;
  const refused = await call('learningx.dictionaryAdopt', { id: bad.id, digest: bad.digest }, store);
  assert.equal(refused.published, false); assert.deepEqual(refused.failing, ['earned', 'net-sales', 'margin']);
  assert.equal(new OntologyService(store).current(owner)!.hash, before);
  const log = logPage(store.read(), owner, { kind: 'dictionary-edit' }).items.map((i: any) => [i.event.choice, i.event.reason, i.event.edit]);
  assert.deepEqual(log, [['rejected', 'answer-key-failed', 'add-definition'], ['accepted', 'answer-key-passed', 'add-definition']]);
  assert.equal((await call('learningx.dictionaryProposals', {}, store)).total, 2);
});

test('self-evolution: only edits that pass the key await review, approval is exact, app-only and stale-safe', async () => {
  const store = await seeded();
  await importWithColumn(store, 'shop-a', 'a');
  let first = await call('learningx.editsPropose', {}, store);
  assert.equal(first.items.length, 0, 'a column seen once is not yet repeated evidence');
  await importWithColumn(store, 'shop-b', 'b');
  const proposed = await call('learningx.editsPropose', { edits: [
    { edit: 'change-sign', name: 'earned', sign: -1 }, { edit: 'remove-definition', name: 'refunds' },
    { edit: 'change-label', name: 'billed', label: 'Invoiced' }, { edit: 'change-meaning', name: 'nothing', meaning: 'A meaning for nothing at all.' }, { edit: 'run', script: 'x' },
  ] }, store);
  const byKind = Object.fromEntries(proposed.items.map((i: any) => [`${i.edit.edit}:${i.edit.name ?? ''}`, i]));
  const field = byKind['add-field:salesChannel'];
  assert.equal(field.status, 'awaiting-review'); assert.equal(field.edit.type, 'string'); assert.equal(field.evidence.count, 2);
  assert.deepEqual(field.evidence.sourceIds, ['shop-a', 'shop-b']); assert.deepEqual(field.regressions, []);
  assert.ok(field.before.every((c: any) => c.passed) && field.after.every((c: any) => c.passed));
  assert.equal(byKind['change-sign:earned'].status, 'failed-answer-key'); assert.deepEqual(byKind['change-sign:earned'].failing, ['earned', 'net-sales', 'margin']);
  assert.deepEqual(byKind['remove-definition:refunds'].regressions, ['refunds', 'net-sales', 'margin', 'aging']);
  assert.equal(byKind['change-label:billed'].status, 'awaiting-review');
  assert.deepEqual(proposed.refused, [{ index: 4, code: 'INVALID_EDIT' }, { index: 3, code: 'EDIT_TARGET_MISSING' }]);
  const review = await call('learningx.edits', { status: 'awaiting-review' }, store);
  assert.deepEqual(review.items.map((i: any) => i.edit.edit).sort(), ['add-field', 'change-label']);
  // Proposing again does not duplicate edits already evaluated on this dictionary.
  assert.equal((await call('learningx.editsPropose', {}, store)).items.length, 0);

  const failed = byKind['change-sign:earned'];
  await assert.rejects(call('learningx.editApprove', { id: failed.id, digest: failed.digest }, store), { code: 'EDIT_NOT_REVIEWABLE' });
  await assert.rejects(call('learningx.editApprove', { id: field.id, digest: field.digest }, store, { ...owner, channel: 'phone' }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(call('learningx.editApprove', { id: field.id, digest: field.digest }, store, { ...owner, sourceTainted: true }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(call('learningx.editApprove', { id: field.id, digest: '0'.repeat(64) }, store), { code: 'EDIT_CHANGED' });
  const hashBefore = new OntologyService(store).current(owner)!.hash;
  assert.equal(new OntologyService(store).current(owner)!.fields.salesChannel, undefined, 'nothing publishes before approval');
  const approved = await call('learningx.editApprove', { id: field.id, digest: field.digest }, store);
  assert.equal(approved.published, true); assert.notEqual(approved.dictionaryHash, hashBefore);
  assert.equal(new OntologyService(store).current(owner)!.fields.salesChannel, 'string');
  const label = byKind['change-label:billed'];
  await assert.rejects(call('learningx.editApprove', { id: label.id, digest: label.digest }, store), { code: 'EDIT_STALE' });
  assert.equal((await call('learningx.edits', {}, store)).items.find((i: any) => i.id === label.id).stale, true);
  await call('learningx.editReject', { id: label.id }, store);
  const decisions = logPage(store.read(), owner, { kind: 'dictionary-edit' }).items.map((i: any) => `${i.event.edit}:${i.event.choice}:${i.event.reason}`);
  assert.ok(decisions.includes('add-field:accepted:answer-key-passed') && decisions.includes('change-sign:rejected:answer-key-failed') && decisions.includes('change-label:rejected:owner-override'));
  assert.ok(logPage(store.read(), owner, { kind: 'dictionary-edit' }).items.every((i: any) => !JSON.stringify(i.event).includes('Sales')));

  // Purge removes edits whose evidence came from a removed source.
  const state = structuredClone(store.read());
  assert.equal(purgeDictionary(state, { sourceIds: ['shop-a'], removedIds: new Set() }), 1);
});

test('the answer key can be replaced only by the owner in the app, and the scheduled loop proposes at most daily without publishing', async () => {
  const store = await seeded();
  const custom = { ...structuredClone(defaultAnswerKey), id: 'september-two', label: 'Two cases', cases: defaultAnswerKey.cases.slice(0, 2) };
  await assert.rejects(call('learningx.answerKeySet', { key: custom }, store, { ...owner, sourceTainted: true }), { code: 'APP_APPROVAL_REQUIRED' });
  const set = await call('learningx.answerKeySet', { key: custom }, store);
  assert.equal(set.default, false); assert.equal(set.run.passed, true); assert.equal(set.run.cases.length, 2);
  assert.equal((await call('learningx.answerKey', {}, store)).key.id, 'september-two');
  assert.equal((await call('learningx.answerKeySet', { reset: true }, store)).default, true);

  await importWithColumn(store, 'shop-a', 'a'); await importWithColumn(store, 'shop-b', 'b');
  const host = hostFor(store), scheduler = { awake: true, windowOpen: true, backgroundEnabled: false };
  assert.deepEqual(await dictionaryTick(owner, host, scheduler), [], 'autonomy is off');
  store.state.policy.autonomy = true;
  const hash = new OntologyService(store).current(owner)!.hash;
  assert.deepEqual(await dictionaryTick(owner, host, scheduler), [{ module: 'learning-ext', proposed: 1 }]);
  assert.deepEqual(await dictionaryTick(owner, host, scheduler), [], 'at most once a day');
  assert.equal(new OntologyService(store).current(owner)!.hash, hash, 'the loop never publishes');
});

test('engine: dictionary over the existing MCP server, answer key, gated edits and the builder', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-learning-ext-dictionary-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Dictionary Shop', passphrase: 'Synthetic dictionary passphrase 2026', demo: true });
  const rpc = (payload: any) => engine.request('mcp.handle', { jsonrpc: '2.0', ...payload });
  assert.equal((await rpc({ id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Synthetic agent', version: '1.0.0' } } })).result.serverInfo.name, 'chausar-verified-numbers');
  assert.equal(await rpc({ method: 'notifications/initialized' }), null);
  const tools = (await rpc({ id: 2, method: 'tools/list' })).result.tools.map((tool: any) => tool.name);
  for (const name of ['calculate', 'dictionary_schema', 'dictionary_samples', 'dictionary_operations']) assert.ok(tools.includes(name), name);
  const withheld = (await rpc({ id: 3, method: 'tools/call', params: { name: 'dictionary_samples', arguments: { fields: ['customerId', 'amountMinor'] } } })).result;
  assert.equal(withheld.isError, false); assert.deepEqual(withheld.structuredContent.fields, { customerId: { state: 'withheld' }, amountMinor: { state: 'withheld' } });
  await engine.request('trust.update', { policy: { send: 'samples' } });
  const samples = (await rpc({ id: 4, method: 'tools/call', params: { name: 'dictionary_samples', arguments: { fields: ['customerId'] } } })).result.structuredContent;
  assert.deepEqual(samples.fields.customerId, { state: 'samples', type: 'string', values: ['cust-1', 'cust-2'] });
  const operations = (await rpc({ id: 5, method: 'tools/call', params: { name: 'dictionary_operations', arguments: {} } })).result.structuredContent;
  assert.ok(operations.operations.some((o: any) => o.id === 'net_sales'));
  assert.equal((await engine.request('dictionary.mcp.info')).dictionary.state, 'published');
  assert.equal((await engine.request('dictionary.mcp.schema')).pack, 'ecommerce');

  const key = await engine.request('learningx.answerKey', { run: true });
  assert.equal(key.default, true); assert.equal(key.run.passed, true);

  for (const [sourceId, prefix] of [['shop-a', 'a'], ['shop-b', 'b']]) await engine.request('sources.import', { sourceId, format: 'csv', content: withColumn(demoCsv, prefix, 'Sales Channel', 'web'), recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  const proposed = await engine.request('learningx.editsPropose', { edits: [{ edit: 'change-sign', name: 'earned', sign: -1 }, { edit: 'remove-definition', name: 'refunds' }, { edit: 'change-label', name: 'billed', label: 'Invoiced' }] });
  const good = proposed.items.find((i: any) => i.edit.edit === 'add-field' && i.edit.name === 'salesChannel');
  assert.equal(good.status, 'awaiting-review');
  for (const bad of proposed.items.filter((i: any) => ['change-sign', 'remove-definition'].includes(i.edit.edit))) assert.equal(bad.status, 'failed-answer-key');
  const awaiting = (await engine.request('learningx.edits', { status: 'awaiting-review' })).items;
  assert.ok(awaiting.every((i: any) => !['change-sign', 'remove-definition'].includes(i.edit.edit)));
  await assert.rejects(engine.requestAs({ ...engine.context, sourceTainted: true }, 'learningx.editApprove', { id: good.id, digest: good.digest }), { code: 'APP_APPROVAL_REQUIRED' });
  await assert.rejects(engine.requestAs({ ...engine.context, channel: 'phone' }, 'learningx.editApprove', { id: good.id, digest: good.digest }), (error: any) => ['OPEN_DESKTOP', 'APP_APPROVAL_REQUIRED'].includes(error.code));
  assert.equal((await engine.request('ontology.get')).current.fields.salesChannel, undefined);
  await assert.rejects(engine.request('learningx.editApprove', { id: good.id, digest: 'a'.repeat(64) }), { code: 'EDIT_CHANGED' });
  assert.equal((await engine.request('learningx.editApprove', { id: good.id, digest: good.digest })).published, true);
  assert.equal((await engine.request('ontology.get')).current.fields.salesChannel, 'string');
  const label = proposed.items.find((i: any) => i.edit.edit === 'change-label');
  await assert.rejects(engine.request('learningx.editApprove', { id: label.id, digest: label.digest }), { code: 'EDIT_STALE' });

  // Another publish makes a freshly proposed edit stale too.
  const fresh = (await engine.request('learningx.editsPropose', { fromEvidence: false, edits: [{ edit: 'change-label', name: 'costs', label: 'Imported costs' }] })).items[0];
  assert.equal(fresh.status, 'awaiting-review');
  await engine.request('ontology.publish', { pack: 'retail' });
  await assert.rejects(engine.request('learningx.editApprove', { id: fresh.id, digest: fresh.digest }), { code: 'EDIT_STALE' });

  const built = await engine.request('learningx.dictionaryBuild', { files: [{ content: 'Distributor Code,Territory,Credit Days,Invoice Value\nd-1,north,30,1200.00\n' }] });
  assert.equal(built.pack.pack, 'distributor'); assert.ok(built.evidence.some((e: any) => e.name === 'invoiceValueMinor' && e.type === 'money'));
  assert.equal((await engine.request('learningx.dictionaryProposals')).total, 1);
});
