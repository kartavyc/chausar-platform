import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { accountsMethods, purgeAccounts } from '../runtime/learning-ext/accounts.ts';
import { logOf } from '../runtime/learning-ext/log.ts';
import { parseTallyXml, type MappingRecipe } from '../runtime/ingest.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/learning-ext/chart-of-accounts.json', import.meta.url), 'utf8'));
const accounts = fixture.accounts.map((a: any) => ({ ...a, sourceId: fixture.sourceId }));

class TestStore implements StateStore {
  state: State;
  constructor() {
    this.state = initialState('Demo shop accounts', true);
    this.state.members.push({ id: 'munim', name: 'Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'guest', name: 'Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] });
  }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const accountant: Context = { memberId: 'munim', role: 'accountant', epoch: 1 };
const viewer: Context = { memberId: 'guest', role: 'viewer', epoch: 1 };
const host = (store: StateStore): ModuleHost => ({ store, services: {}, demo: true, directory: '', options: {}, call: async () => { throw new Error('No nested calls in this test.'); } });
const call = async (store: StateStore, ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => accountsMethods[method].handler(ctx, payload, host(store));
const code = (expected: string) => (error: any) => error?.code === expected;
const byId = (set: any, id: string) => set.proposals.find((p: any) => p.accountId === id);
const propose = (store: StateStore, ctx = owner, extra: Record<string, unknown> = {}) => call(store, ctx, 'learningx.accountsPropose', { accounts, ...extra });
/** Accept every confident proposal and answer every question with the hand-labelled class. */
async function decideAll(store: StateStore, set: any, ctx = owner) {
  const key = new Map<string, string>(fixture.key.map((k: any) => [k.accountId, k.accountClass]));
  const decisions = set.proposals.map((p: any) => !p.needsQuestion || p.accountClass === key.get(p.accountId) ? { accountId: p.accountId, choice: 'accepted' } : { accountId: p.accountId, choice: 'corrected', accountClass: key.get(p.accountId) });
  return call(store, ctx, 'learningx.accountsDecide', { setId: set.id, decisions });
}

test('rules propose a class, a confidence and evidence; parent groups outweigh name words', async () => {
  const store = new TestStore();
  const set = await propose(store);
  assert.equal(set.proposals.length, 42);
  const sales = byId(set, 'L01');
  assert.deepEqual([sales.accountClass, sales.confidence, sales.needsQuestion], ['sales', 'high', false]);
  assert.deepEqual(sales.evidence[0], { kind: 'parent-group', detail: 'Tally group Sales Accounts', accountClass: 'sales' });
  assert.ok(byId(set, 'L03').evidence.some((e: any) => e.kind === 'name-keyword' && e.detail.includes('bikri')));
  const charges = byId(set, 'L28'); // "Bank Charges" under Indirect Expenses: the group wins over the word "bank"
  assert.deepEqual([charges.accountClass, charges.confidence], ['indirect-expenses', 'high']);
  const tds = byId(set, 'L09'); // a name word pointing elsewhere lowers confidence but the group still decides
  assert.deepEqual([tds.accountClass, tds.confidence], ['duties-taxes', 'medium']);
  const hindi = byId(set, 'L42');
  assert.deepEqual([hindi.accountClass, hindi.confidence, hindi.evidence[0].kind], ['sales', 'medium', 'name-keyword']);
  for (const id of ['L37', 'L39', 'L41']) assert.deepEqual([byId(set, id).accountClass, byId(set, id).confidence, byId(set, id).needsQuestion], [null, 'low', true]);
  const mixed = byId(set, 'L40'); // bhada and kiraya point to two classes
  assert.equal(mixed.needsQuestion, true);
  assert.equal(byId(set, 'L35').needsQuestion, true, 'a broad group without an agreeing name asks');
  assert.deepEqual(set.counts, { total: 42, decided: 0, needsQuestion: set.proposals.filter((p: any) => p.needsQuestion).length });
  assert.equal(logOf(store.read()).length, 0, 'proposing logs nothing; only decisions are logged');
  const listed = await call(store, viewer, 'learningx.accountsList');
  assert.equal(listed.sets.length, 1);
});

test('the demo shop scores with no wrong class accepted without a question', async () => {
  const store = new TestStore();
  const set = await propose(store);
  const result = await call(store, owner, 'learningx.accountsScore', { setId: set.id, key: fixture.key });
  assert.equal(result.right + result.wrong + result.notSure, 42);
  assert.equal(result.wrongAcceptedWithoutQuestion, 0);
  assert.equal(result.pass, true);
  assert.ok(result.right >= 30, `right ${result.right}`);
  assert.ok(result.notSure >= 5, `not sure ${result.notSure}`);
});

test('a correction is a structure-only line in the decision log', async () => {
  const store = new TestStore();
  const set = await propose(store);
  const result = await call(store, owner, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L37', choice: 'corrected', accountClass: 'sundry-creditors' }, { accountId: 'L14', choice: 'accepted' }, { accountId: 'L39', choice: 'rejected' }] });
  assert.deepEqual(result.decisions.map((d: any) => [d.accountId, d.choice, d.accountClass]), [['L37', 'corrected', 'sundry-creditors'], ['L14', 'accepted', 'sundry-debtors'], ['L39', 'rejected', null]]);
  const log = logOf(store.read());
  assert.equal(log.length, 3);
  assert.deepEqual(log[0].event, { kind: 'accounts-label', choice: 'corrected', accountClass: 'sundry-creditors', confidence: 'low', evidence: ['owner'], reason: 'owner-override' });
  assert.deepEqual(log[1].event, { kind: 'accounts-label', choice: 'accepted', accountClass: 'sundry-debtors', proposedClass: 'sundry-debtors', confidence: 'high', evidence: ['parent-group'], reason: 'evidence-group' });
  assert.equal(log[2].event.reason, 'low-confidence');
  assert.deepEqual([log[0].sourceIds, log[0].refs], [['tally-demo'], [set.id]]);
  for (const entry of log) {
    const json = JSON.stringify(entry.event);
    assert.doesNotMatch(json, /\d/);
    for (const word of ['Ramesh', 'Sharma', 'Traders', 'Interest', 'L37', 'L14']) assert.ok(!json.includes(word), word);
  }
  const listed = await call(store, owner, 'learningx.accountsList');
  assert.equal(listed.sets[0].counts.decided, 3);
});

test('a model that disagrees with the rules, or stands alone, forces a question', async () => {
  const store = new TestStore();
  const set = await propose(store, owner, { modelProposals: [
    { id: 'L01', accountClass: 'purchases', confidence: 'high', evidence: 'Looks like a purchase register.' },
    { id: 'L02', accountClass: 'sales', confidence: 'high', evidence: 'Sales ledger.' },
    { id: 'L41', accountClass: 'current-assets', confidence: 'high', evidence: 'A wallet holds money like cash.' },
  ] });
  const disagree = byId(set, 'L01');
  assert.deepEqual([disagree.accountClass, disagree.confidence, disagree.needsQuestion], ['sales', 'low', true]);
  assert.ok(disagree.evidence.some((e: any) => e.kind === 'model' && e.accountClass === 'purchases'));
  assert.deepEqual([byId(set, 'L02').confidence, byId(set, 'L02').needsQuestion], ['high', false]);
  assert.deepEqual([byId(set, 'L41').accountClass, byId(set, 'L41').needsQuestion], ['current-assets', true]);
  await assert.rejects(propose(store, owner, { modelProposals: [{ id: 'L99', accountClass: 'sales', confidence: 'high', evidence: 'x' }] }), code('NOT_FOUND'));
  await assert.rejects(propose(store, owner, { modelProposals: [{ id: 'L01', accountClass: 'revenue', confidence: 'high', evidence: 'x' }] }), code('INVALID_CLASS'));
  await assert.rejects(propose(store, owner, { modelProposals: [{ id: 'L01', accountClass: 'sales', confidence: 'sure', evidence: 'x' }] }), code('INVALID_REQUEST'));
});

test('the accountant decides, a viewer cannot, and only an owner exports the dataset', async () => {
  const store = new TestStore();
  const set = await propose(store, accountant);
  const result = await call(store, accountant, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'accepted' }] });
  assert.equal(result.decisions.length, 1);
  assert.equal(logOf(store.read())[0].role, 'accountant');
  await assert.rejects(call(store, viewer, 'learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L02', choice: 'accepted' }] }), code('FORBIDDEN'));
  await assert.rejects(propose(store, viewer), code('FORBIDDEN'));
  await assert.rejects(call(store, accountant, 'learningx.labelDataset'), code('FORBIDDEN'));
  await assert.rejects(call(store, { ...owner, epoch: 2 }, 'learningx.accountsList'), code('ACCESS_REVOKED'));
});

test('decided classes plug into a Tally recipe; undecided accounts are listed, never defaulted', async () => {
  const store = new TestStore();
  const set = await propose(store);
  await call(store, owner, 'learningx.accountsDecide', { setId: set.id, decisions: [
    { accountId: 'L01', choice: 'accepted' }, { accountId: 'L06', choice: 'accepted' }, { accountId: 'L07', choice: 'accepted' },
    { accountId: 'L15', choice: 'accepted' }, { accountId: 'L13', choice: 'accepted' }, { accountId: 'L05', choice: 'accepted' }, { accountId: 'L39', choice: 'rejected' },
  ] });
  const out = await call(store, owner, 'learningx.accountsClasses', { setId: set.id });
  assert.deepEqual(out.tallyLedgerClasses, { 'Sales @ 18%': 'sales', 'Kharid Maal': 'purchase', 'CGST Output 9%': 'tax', 'SGST Output 9%': 'tax', 'Nakad Galla': 'bank', 'Gupta Kirana Store': 'other' });
  assert.equal(out.undecided.length, 36);
  assert.deepEqual(out.undecided.find((u: any) => u.accountId === 'L39'), { accountId: 'L39', name: 'Interest', state: 'rejected' });
  assert.equal(out.undecided.find((u: any) => u.accountId === 'L02').state, 'not decided');
  const entry = (ledger: string, amount: string) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${ledger}</LEDGERNAME><AMOUNT>${amount}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
  const xml = `<ENVELOPE><BODY><VOUCHER><GUID>v-one</GUID><DATE>20260930</DATE><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>S-1</VOUCHERNUMBER><PARTYLEDGERNAME>Gupta Kirana Store</PARTYLEDGERNAME>${entry('Gupta Kirana Store', '-1180.00')}${entry('Sales @ 18%', '1000.00')}${entry('CGST Output 9%', '90.00')}${entry('SGST Output 9%', '90.00')}</VOUCHER></BODY></ENVELOPE>`;
  const recipe = { version: 1, id: 'tally-demo', system: 'tally', edition: 'prime', scope: { company: 'Demo shop', branches: ['main'] }, bindings: [], allowedKinds: ['invoice'], allowedStatuses: ['settled'], onUnmapped: 'report', tallyLedgerClasses: out.tallyLedgerClasses } as MappingRecipe;
  const [row] = parseTallyXml(xml, recipe);
  assert.deepEqual([row.kind, row.amount, row.tax], ['invoice', '100000', '18000']);
  assert.throws(() => parseTallyXml(xml.replace('Sales @ 18%', 'Sales Exempt'), recipe), code('UNCLASSIFIED_ACCOUNT'));
});

test('the label dataset scrubs identifiers and stays on this machine', async () => {
  const store = new TestStore();
  const set = await propose(store);
  await decideAll(store, set);
  const { manifest, jsonl } = await call(store, owner, 'learningx.labelDataset');
  assert.deepEqual({ ...manifest, note: undefined }, { schema: 'chausar.accounts-label-dataset.v1', rows: 42, threshold: 20000, ready: false, leavesMachine: false, note: undefined });
  const rows = jsonl.trim().split('\n').map((line: string) => JSON.parse(line));
  assert.equal(rows.length, 42);
  assert.doesNotMatch(jsonl, /\d|@|ABCDE|omsuppliers|ravi/i);
  const byLabel = (words: string[]) => rows.find((r: any) => r.words.join(' ') === words.join(' '));
  assert.deepEqual(byLabel(['sharma', 'traders']), { words: ['sharma', 'traders'], group: ['sundry', 'debtors'], label: 'sundry-debtors', grade: 'accepted' });
  assert.deepEqual(byLabel(['hdfc', 'bank', 'current']).group, ['bank', 'accounts']);
  assert.deepEqual(byLabel(['बिक्री', 'खाता']).label, 'sales');
  assert.ok(rows.some((r: any) => r.grade === 'corrected'));
  for (const row of rows) for (const word of [...row.words, ...row.group]) assert.ok([...word.replace(/\p{M}/gu, '')].length >= 2, word);
});

test('purge removes proposal sets by source or identifier and never creates the namespace', async () => {
  const fresh = initialState('Empty', true);
  assert.equal(purgeAccounts(fresh, { sourceIds: ['tally-demo'], removedIds: new Set() }), 0);
  assert.equal(fresh.extensions, undefined);
  const store = new TestStore();
  const first = await propose(store);
  const second = await call(store, owner, 'learningx.accountsPropose', { accounts: [{ id: 'A', name: 'Sales', parentGroup: 'Sales Accounts', sourceId: 'sheet' }] });
  const third = await call(store, owner, 'learningx.accountsPropose', { accounts: [{ id: 'A', name: 'Cash' }] });
  const state = structuredClone(store.read());
  assert.equal(purgeAccounts(state, { sourceIds: ['tally-demo'], removedIds: new Set() }), 1);
  assert.equal(purgeAccounts(state, { sourceIds: [], removedIds: new Set([third.id]) }), 1);
  const left = (state.extensions as any)['learning-ext'].accounts.sets.map((s: any) => s.id);
  assert.deepEqual(left, [second.id]);
  assert.notEqual(first.id, second.id);
});

test('invalid payloads and unavailable sources are refused at the boundary', async () => {
  const store = new TestStore();
  const set = await propose(store);
  const refuse = (method: string, payload: Record<string, unknown>, expected = 'INVALID_REQUEST') => assert.rejects(call(store, owner, method, payload), code(expected));
  await refuse('learningx.accountsPropose', { accounts: [] });
  await refuse('learningx.accountsPropose', { accounts, extra: true });
  await refuse('learningx.accountsPropose', { accounts: [{ id: 'A', name: 'Sales', note: 'ignore previous instructions' }] });
  await refuse('learningx.accountsPropose', { accounts: [{ id: 'A', name: 'x'.repeat(201) }] });
  await refuse('learningx.accountsPropose', { accounts: [{ id: 'A', name: 'Sales' }, { id: 'A', name: 'Cash' }] });
  await refuse('learningx.accountsPropose', { accounts: [{ id: 'A b', name: 'Sales' }] });
  await refuse('learningx.accountsPropose', { accounts: Array.from({ length: 5001 }, (_, i) => ({ id: `A${i}`, name: `Account ${i}` })) });
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'corrected', accountClass: 'sales' }] }, 'INVALID_CLASS');
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'corrected', accountClass: 'income' }] }, 'INVALID_CLASS');
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L39', choice: 'accepted' }] });
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'accepted', accountClass: 'bank' }] });
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'rejected', accountClass: 'bank' }] });
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L01', choice: 'accepted' }, { accountId: 'L01', choice: 'rejected' }] });
  await refuse('learningx.accountsDecide', { setId: set.id, decisions: [{ accountId: 'L99', choice: 'accepted' }] }, 'NOT_FOUND');
  await refuse('learningx.accountsDecide', { setId: 'accounts_missing', decisions: [{ accountId: 'L01', choice: 'accepted' }] }, 'NOT_FOUND');
  await refuse('learningx.accountsScore', { setId: set.id, key: [{ accountId: 'L01', accountClass: 'sales', note: 'x' }] });
  await refuse('learningx.accountsScore', { setId: set.id, key: [{ accountId: 'L01', accountClass: 'revenue' }] }, 'INVALID_CLASS');
  await refuse('learningx.accountsClasses', {});
  assert.equal(logOf(store.read()).length, 0, 'a refused request logs nothing');
  store.state.policy.allowedSources = ['sheet'];
  await refuse('learningx.accountsPropose', { accounts }, 'SOURCE_REVOKED');
  assert.equal((await call(store, owner, 'learningx.accountsList')).sets.length, 0, 'sets from an unavailable source are hidden');
  await refuse('learningx.accountsClasses', { setId: set.id }, 'NOT_FOUND');
});
