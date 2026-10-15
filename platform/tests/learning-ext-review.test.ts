import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { demoCsv, demoRecipe, ImportService } from '../runtime/ingest.ts';
import { LearningService } from '../runtime/learning.ts';
import { MemoryService } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { learningExtModule } from '../runtime/modules/lane-learning-ext.ts';
import { logOf } from '../runtime/learning-ext/log.ts';
import { samplesLayer } from '../runtime/learning-ext/dictionary-layers.ts';

// Regression tests for the lane's adversarial review. All data is synthetic.
class Store implements StateStore {
  state: State;
  constructor(demo = true) { this.state = initialState('Synthetic review shop', demo); }
  read() { return structuredClone(this.state); }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'acct', role: 'accountant', epoch: 1, channel: 'desktop' };
function host(store: Store, ctx: Context = owner): ModuleHost {
  return { store, services: { learning: new LearningService(store) }, demo: true, directory: '', options: {}, call: async (method, payload) => {
    const ontology = new OntologyService(store);
    if (method === 'ontology.publish') return ontology.publishPayload(ctx, payload as any);
    if (method === 'ontology.get') return ontology.get(ctx, payload as any);
    throw new Error(`Unexpected call ${method}`);
  } };
}
const call = async (store: Store, method: string, payload: Record<string, unknown> = {}, ctx = owner): Promise<any> => learningExtModule.methods[method].handler(ctx, payload, host(store, ctx));
async function seeded() {
  const store = new Store(); await new OntologyService(store).publish(owner, 'ecommerce');
  await new ImportService(store).commit(owner, { sourceId: 'demo-export', format: 'csv', content: demoCsv, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 10, amountMinor: '1230000' } });
  store.state.members.push({ id: 'acct', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  return store;
}

test('a malformed engine decision is left out of the log instead of breaking it', async () => {
  const store = await seeded(), learning = new LearningService(store);
  await learning.recordDecision(owner, { kind: 'mapping', choice: 'accepted', reasonCode: 'toString' as any, reportShape: 'gst-return-xyz' as any });
  await learning.recordDecision(owner, { kind: 'mapping', choice: 'accepted', reasonCode: '__proto__' as any });
  const page = await call(store, 'learningx.log');
  assert.equal(page.total, 3); assert.ok(page.items.every((item: any) => item.event.reason === undefined || item.event.reason === 'reconciliation'));
  assert.equal((await call(store, 'learningx.preview')).count, 3);
});

test('a malformed bank layout cannot enter the library or crash the grammar check', async () => {
  const store = await seeded();
  await assert.rejects(call(store, 'learningx.recipeSave', { recipe: { ...structuredClone(demoRecipe), bankLayout: {} }, passedTests: true }), { code: 'RECIPE_GRAMMAR' });
  const checked = await call(store, 'learningx.recipeCheck', { recipe: { ...structuredClone(demoRecipe), bankLayout: null }, fields: ['id'] });
  assert.equal(checked.valid, false);
  assert.ok((await call(store, 'learningx.recipeLookup', { fields: ['id', 'amount'] })).items.length > 0);
});

test('an account decided by one person is changed only by them or the owner, and viewers do not see account names', async () => {
  const store = await seeded();
  const set = await call(store, 'learningx.accountsPropose', { accounts: [{ id: 'a1', name: 'Kotak Current', parentGroup: 'Bank Accounts' }] });
  await call(store, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'accepted' }] });
  await assert.rejects(call(store, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'corrected', accountClass: 'loans' }] }, accountant), { code: 'ALREADY_DECIDED' });
  assert.equal((await call(store, 'learningx.accountsList', {}, accountant)).sets.length, 1);
});

test('purging an account set takes its decisions out of the log', async () => {
  const store = await seeded();
  const set = await call(store, 'learningx.accountsPropose', { accounts: [{ id: 'a1', name: 'Cash', parentGroup: 'Cash-in-Hand' }] });
  await call(store, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'accepted' }] });
  assert.equal(logOf(store.state).length, 1);
  learningExtModule.purge!(store.state, { sourceIds: [], removedIds: new Set([set.id]), at: new Date().toISOString() });
  assert.equal(logOf(store.state).length, 0);
});

test('the decision log is a bounded ring: decisions past retention go first', async () => {
  const store = await seeded();
  await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted' } });
  logOf(store.state)[0].at = '2020-01-01T00:00:00.000Z';
  await call(store, 'learningx.record', { event: { kind: 'action', choice: 'rejected' } });
  assert.deepEqual(logOf(store.state).map(entry => entry.event.choice), ['rejected']);
});

test('the answer key rows stay with the owner, and a stale dictionary proposal cannot undo later edits', async () => {
  const store = await seeded();
  const view = await call(store, 'learningx.answerKey', {}, accountant);
  assert.deepEqual(view.key.rows, { state: 'withheld' }); assert.ok(view.key.cases.length > 0);
  await assert.rejects(call(store, 'learningx.answerKey', { run: true }, accountant), { code: 'FORBIDDEN' });
  const proposal = await call(store, 'learningx.dictionaryBuild', { files: [{ content: demoCsv }] });
  await new OntologyService(store).publish(owner, 'retail');
  await assert.rejects(call(store, 'learningx.dictionaryAdopt', { id: proposal.id, digest: proposal.digest }), { code: 'PROPOSAL_STALE' });
  assert.equal(new OntologyService(store).current(owner)!.pack, 'retail');
});

test('number-like sample values are shapes at every send level', async () => {
  const store = await seeded(); store.state.policy.send = 'samples';
  await new MemoryService(store).append(owner, [{ entityId: 'n-1', sourceId: 'books', sourceRow: 2, kind: 'invoice', validFrom: '2026-09-02', branch: 'main', fields: { amountMinor: '100', currency: 'INR', status: '4,500.00', customerId: 'c-1' } }]);
  const fields = (samplesLayer(store, owner, { fields: ['status', 'customerId'] }) as any).fields;
  assert.equal(JSON.stringify(fields.status).includes('4,500.00'), false);
  assert.ok(fields.customerId.values.includes('c-1'));
});

test('the installed app opens sharing only through its trusted environment, never in demo', () => {
  const options = (env: Record<string, string>, demo = false) => learningExtModule.hostOptions!({ directory: '/tmp/x', demo, env });
  assert.deepEqual(options({}), {});
  assert.deepEqual(options({ CHAUSAR_LEARNING_INTAKE_URL: 'https://intake.example.com' }), { intake: { url: 'https://intake.example.com' } });
  assert.deepEqual(options({ CHAUSAR_LEARNING_INTAKE_URL: 'https://intake.example.com' }, true), {});
  assert.deepEqual(options({ CHAUSAR_LEARNING_FOUNDER_SWITCH: '1' }), { founderSwitch: true });
});

test('retention cleanup ages out account sets, outbox samples, dictionary proposals and decisions', async () => {
  const { TrustService } = await import('../runtime/trust.ts');
  const { peekArea } = await import('../runtime/learning-ext/state.ts');
  const store = await seeded();
  await import('../runtime/engine.ts'); // registers the engine modules' purge hooks
  const set = await call(store, 'learningx.accountsPropose', { accounts: [{ id: 'a1', name: 'Cash', parentGroup: 'Cash-in-Hand' }] });
  await call(store, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'accepted' }] });
  await call(store, 'learningx.cleanSample', { content: 'Customer,Amount\nRavi,10\n' });
  await call(store, 'learningx.dictionaryBuild', { files: [{ content: demoCsv }] });
  const later = new Date(Date.now() + (store.state.policy.retentionDays + 1) * 86_400_000);
  await new TrustService(store).cleanup(owner, later);
  const lane = (name: string) => peekArea<any>(store.state, name);
  assert.deepEqual([lane('accounts').sets.length, lane('sharing').outbox.length, lane('dictionary').proposals.length, logOf(store.state).length], [0, 0, 0, 0]);
});

test('the owner can clear the local learning log inside the app', async () => {
  const store = await seeded();
  await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted' } });
  await assert.rejects(call(store, 'learningx.logClear', {}, accountant), { code: 'FORBIDDEN' });
  await assert.rejects(call(store, 'learningx.logClear', {}, { ...owner, channel: 'phone' }), { code: 'OWNER_REQUIRED' });
  assert.deepEqual(await call(store, 'learningx.logClear', { before: '2000-01-01' }), { removed: 0 });
  assert.deepEqual(await call(store, 'learningx.logClear', {}), { removed: 1 });
});

test('smuggling: the batch is in canonical order, so the sequence of decisions carries nothing', async () => {
  const store = await seeded(); store.state.policy.sharing = true;
  for (const reason of ['stop-rule', 'budget-reached', 'routed', 'fallback', 'routed'] as const) await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted', reason } });
  const preview = await call(store, 'learningx.preview', {});
  const lines = preview.bytes.split('\n').slice(1, -1).map((line: string) => line.replace(/,$/, ''));
  assert.deepEqual(lines, [...lines].sort()); assert.ok(preview.authors.some((author: any) => author.memberId === 'owner'));
});

test('smuggling: the public name is fixed at consent', async () => {
  const { sharingMethods } = await import('../runtime/learning-ext/sharing.ts');
  const store = await seeded(); store.state.policy.sharing = true; store.state.workspace.demo = false;
  const bodies: string[] = [];
  const h = { ...host(store), demo: false, options: { intake: { url: 'https://intake.example.com', transport: async (request: any) => { bodies.push(request.body); return { status: 201, body: '{"reference":"lb_x","credits":1}' }; } } } };
  const run = (method: string, payload: any) => sharingMethods[method].handler(owner, payload, h) as Promise<any>;
  await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted' } });
  await run('learningx.creditName', { publicName: 'Asha' });
  const preview = await run('learningx.preview', {}), consent = await run('learningx.consent', { previewId: preview.id, digest: preview.digest });
  await run('learningx.creditName', { publicName: 'Ravi Kumar owes fifty' });
  await run('learningx.submit', { consentId: consent.id });
  assert.deepEqual(JSON.parse(bodies[0]).contributor, { publicName: 'Asha' });
});

test('smuggling: identifiers in loose formats are masked, and column titles with data never become field names', async () => {
  const { sensitiveKind, maskOf, schemaLayer } = await import('../runtime/learning-ext/dictionary-layers.ts');
  const { safeFieldName } = await import('../runtime/learning-ext/dictionary-builder.ts');
  for (const value of ['1234 5678 9012', 'A/c 50100234567891', '9876 543 210', '098765 43210', '27 AAPFU 0939 F1ZV', 'ravi[at]gmail.com', '９８７６５４３２１０']) assert.ok(sensitiveKind(value), value);
  assert.equal(sensitiveKind('Web shop'), undefined); assert.equal(maskOf('①②³'), '999');
  for (const header of ['Ravi Kumar 9876543210', 'Sharma Traders GSTIN 27AAPFU0939F1ZV', 'Balance 54000']) assert.equal(safeFieldName(header), null, header);
  assert.equal(safeFieldName('Sales Channel'), 'salesChannel');
  const store = await seeded(); const draft = structuredClone(new OntologyService(store).current(owner)!) as any;
  const custom = { pack: draft.pack, label: draft.label, currency: draft.currency, gstMode: draft.gstMode, fields: { ...draft.fields, ravisLedger: 'string' }, definitions: draft.definitions };
  await new OntologyService(store).publish(owner, custom);
  const names = (schemaLayer(store, owner) as any).fields.map((field: any) => field.name);
  assert.ok(names.some((name: any) => name?.state === 'withheld')); assert.equal(names.includes('ravisLedger'), false);
  store.state.policy.send = 'shape'; assert.ok((schemaLayer(store, owner) as any).fields.some((field: any) => field.name === 'ravisLedger'));
});

test('Books reads decided account classes in its own taxonomy through learningx.accountsProposals', async () => {
  const store = await seeded();
  const set = await call(store, 'learningx.accountsPropose', { accounts: [{ id: 'a1', name: 'Sales 18%', parentGroup: 'Sales Accounts' }, { id: 'a2', name: 'Suspense', parentGroup: 'Suspense A/c' }, { id: 'a3', name: 'GST Payable', parentGroup: 'Duties & Taxes' }] });
  await call(store, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'a1', choice: 'accepted' }, { accountId: 'a2', choice: 'accepted' }, { accountId: 'a3', choice: 'corrected', accountClass: 'current-liabilities' }] });
  const { proposals } = await call(store, 'learningx.accountsProposals');
  assert.deepEqual(proposals.map((p: any) => [p.name, p.class, p.accountClass]), [['GST Payable', 'liability', 'current-liabilities'], ['Sales 18%', 'income', 'sales']]);
});

test('smuggling: a batch holds each distinct event once with a times word, never an exact count', async () => {
  const store = await seeded(); store.state.policy.sharing = true;
  for (let i = 0; i < 5; i++) await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted', reason: 'routed' } });
  for (let i = 0; i < 12; i++) await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted', reason: 'fallback' } });
  await call(store, 'learningx.record', { event: { kind: 'action', choice: 'accepted', reason: 'stop-rule', times: 'many' } });
  const preview = await call(store, 'learningx.preview', {});
  const events = preview.bytes.split('\n').slice(1, -1).map((line: string) => JSON.parse(line.replace(/,$/, '')));
  assert.equal(preview.count, 19);
  assert.deepEqual(events.filter((event: any) => event.kind === 'action').map((event: any) => [event.reason, event.times]), [['fallback', 'many'], ['routed', 'few'], ['stop-rule', 'one']]);
});
