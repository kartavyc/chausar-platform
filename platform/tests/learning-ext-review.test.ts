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
