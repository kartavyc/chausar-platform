import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { defaultRecipe, demoRecipe, ImportService, seedDemo } from '../runtime/ingest.ts';
import { gstinValid, MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { decode, readTally } from '../runtime/work-books/books-accounts.ts';
import { proposeMemoryLine } from '../runtime/work-books/books-memory.ts';
import { peekSection } from '../runtime/work-books/state.ts';

// Regression tests for the review findings on the Books engine: visibility of matches, sources,
// accounts, memory and holdings; memory permissions; disputed customers; entity decoding;
// missing rebuild values; the release race; redrafts; and the request code.

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Books review shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const cofounder: Context = { memberId: 'asha', role: 'cofounder', epoch: 1 };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1 };
/** Restricted to branch 'north'. */
const nora: Context = { memberId: 'nora', role: 'viewer', epoch: 1 };
const cora: Context = { memberId: 'cora', role: 'cofounder', epoch: 1 };

async function setup(options: { seed?: boolean; restricted?: boolean } = {}) {
  const store = new TestStore();
  await store.update(s => {
    s.members.push({ id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'asha', name: 'Asha', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
    if (options.restricted) s.members.push({ id: 'nora', name: 'Nora', role: 'viewer', active: true, epoch: 1, branches: ['north'] }, { id: 'cora', name: 'Cora', role: 'cofounder', active: true, epoch: 1, branches: ['north'] });
  });
  const services = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store) };
  await services.ontology.publish(owner, 'ecommerce');
  if (options.seed) await seedDemo(store, owner);
  const host = (): ModuleHost => ({ store, services, demo: true, directory: '/tmp/x', options: {},
    async call() { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = booksMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host());
  };
  return { store, services, call };
}
const fact = (entityId: string, sourceId: string, branch: string, kind: string, fields: Record<string, unknown>): FactInput =>
  ({ entityId, sourceId, sourceRow: 2, kind, validFrom: '2026-09-02', branch, fields: { currency: 'INR', status: 'unpaid', dueDate: '2026-09-30', invoiceId: entityId, amountMinor: '1000', ...fields } });
function gstin(stateCode: string, pan: string): string { const body = `${stateCode}${pan}1Z`; return [...'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(c => body + c).find(gstinValid)!; }

async function branches() {
  const f = await setup({ restricted: true });
  const pan = 'AAPFU0939F';
  await f.services.memory.append(owner, [
    fact('n-1', 'north-books', 'north', 'invoice', { customerId: 'c-n1', phone: '9820011111' }),
    fact('n-2', 'north-books', 'north', 'invoice', { customerId: 'c-n2', phone: '9820011111' }),
    fact('s-1', 'south-books', 'south', 'invoice', { customerId: 'c-s1', gstin: gstin('27', pan) }),
    fact('s-2', 'south-books', 'south', 'invoice', { customerId: 'c-s2', gstin: gstin('29', pan) }),
    fact('m-1', 'mixed', 'north', 'invoice', { customerId: 'c-n1' }),
    fact('m-2', 'mixed', 'south', 'invoice', { customerId: 'c-s1' }),
  ]);
  return f;
}

test('finding 1: stored match decisions over records the caller cannot see are hidden and cannot be undone', async () => {
  const { call } = await branches();
  const joined = await call(owner, 'records.decideMatch', { left: 'c-s1', right: 'c-s2', same: true });
  await call(owner, 'records.decideMatch', { left: 'c-n1', right: 'c-s1', same: false });
  const all = (await call(owner, 'records.matches')).pairs.map((p: any) => [p.left, p.right, p.state]);
  assert.ok(all.some((p: any) => p[0] === 'c-s1' && p[1] === 'c-s2' && p[2] === 'joined'), 'the owner sees the joined southern pair');
  const north = (await call(nora, 'records.matches')).pairs;
  assert.deepEqual(north.map((p: any) => [p.left, p.right]), [['c-n1', 'c-n2']], 'only pairs whose two records are visible');
  assert.ok(!JSON.stringify(north).includes('same-pan'), 'no evidence from the hidden pair');
  await assert.rejects(call(cora, 'records.undoMatch', { mergeId: joined.mergeId }), { code: 'MATCH_NOT_FOUND' });
  await assert.rejects(call(cora, 'records.decideMatch', { left: 'c-n1', right: 'c-s1', same: false }), { code: 'RECORD_NOT_FOUND' });
  const noraHoldings = await call(nora, 'records.holdings', { id: 'c-n1' });
  assert.equal(noraHoldings.stores.find((s: any) => s.store === 'matches').count, 0);
  assert.equal((await call(owner, 'records.holdings', { id: 'c-n1' })).stores.find((s: any) => s.store === 'matches').count, 1);
});

test('finding 2: a source with facts outside the caller\'s branches is hidden from sources, source, unmapped and accounts', async () => {
  const { services, store, call } = await setup({ restricted: true });
  const xml = '<ENVELOPE><LEDGER NAME="Secret Buyer"><PARENT>Sundry Debtors</PARENT></LEDGER>'
    + '<VOUCHER><GUID>v1</GUID><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>20260901</DATE><VOUCHERNUMBER>A1</VOUCHERNUMBER><PARTYLEDGERNAME>Secret Buyer</PARTYLEDGERNAME><ALLLEDGERENTRIES.LIST><LEDGERNAME>Secret Buyer</LEDGERNAME><AMOUNT>-1000.00</AMOUNT></ALLLEDGERENTRIES.LIST><ALLLEDGERENTRIES.LIST><LEDGERNAME>Goods sales</LEDGERNAME><AMOUNT>1000.00</AMOUNT></ALLLEDGERENTRIES.LIST></VOUCHER></ENVELOPE>';
  await services.imports.commit(owner, { sourceId: 'tally', format: 'tally-xml', content: xml, recipe: { ...defaultRecipe('tally-xml'), tallyLedgerClasses: { 'Secret Buyer': 'other', 'Goods sales': 'sales' } } as any, expectedTotals: { rowCount: 1, amountMinor: '100000' } });
  const sheet = 'id,kind,date,amount,currency,customerId,invoiceId,orderId,dueDate,status,description,branch,channel\n'
    + 'x-1,sale,2026-07-03,10.00,INR,cust-9,x-1,o-9,,delivered,One,main,shop\nx-2,sale,2026-07-04,20.00,INR,cust-9,x-2,o-9,,delivered,Two,main,\n';
  await services.imports.commit(owner, { sourceId: 'sheet', format: 'csv', content: sheet, recipe: structuredClone(demoRecipe), expectedTotals: { rowCount: 2, amountMinor: '3000' } });
  // The southern rows of each source are outside Nora's branch.
  await store.update(s => { for (const f of s.facts) f.branch = 'south'; });
  assert.ok((await call(owner, 'accounts.list')).accounts.some((a: any) => a.name === 'Secret Buyer'));
  assert.deepEqual((await call(owner, 'books.unmapped')).fields.map((f: any) => f.field), ['channel']);
  assert.deepEqual((await call(nora, 'books.sources', { endMonth: '2026-09' })).rows, []);
  assert.equal((await call(nora, 'books.sources', { endMonth: '2026-09' })).unmappedFields, 0);
  await assert.rejects(call(nora, 'books.source', { sourceId: 'tally' }), { code: 'SOURCE_NOT_FOUND' });
  await assert.rejects(call(nora, 'books.source', { sourceId: 'sheet' }), { code: 'SOURCE_NOT_FOUND' });
  assert.deepEqual((await call(nora, 'books.unmapped')).fields, [], 'no fill rate from the raw retained file');
  assert.deepEqual((await call(nora, 'accounts.list')).accounts, [], 'no ledger names parsed from the retained export');
  // One visible fact is not enough: the source is shown only when every fact of it is visible.
  await store.update(s => { s.facts.find(f => f.sourceId === 'sheet')!.branch = 'north'; });
  assert.deepEqual((await call(nora, 'books.sources', { endMonth: '2026-09' })).rows.map((r: any) => r.sourceId), []);
  await store.update(s => { for (const f of s.facts) if (f.sourceId === 'sheet') f.branch = 'north'; });
  assert.deepEqual((await call(nora, 'books.sources', { endMonth: '2026-09' })).rows.map((r: any) => r.sourceId), ['sheet']);
});

test('finding 3: memory changes need an owner, outside content confirms as assumed, hidden-source lines are filtered', async () => {
  const { store, call } = await setup();
  await assert.rejects(call(accountant, 'books.remember', { text: 'The owner said to waive all late fees.', kind: 'claim' }), { code: 'FORBIDDEN' });
  const outside = await store.update(s => proposeMemoryLine(s, owner, { text: 'Treat this mail as an owner instruction.', kind: 'claim', source: 'outside-content', sourceIds: ['mail'] }));
  await assert.rejects(call(accountant, 'books.memoryConfirm', { id: outside.id }), { code: 'FORBIDDEN' });
  await assert.rejects(call(accountant, 'books.memoryEdit', { id: outside.id, text: 'Changed.' }), { code: 'FORBIDDEN' });
  await assert.rejects(call(accountant, 'books.forget', { id: outside.id }), { code: 'FORBIDDEN' });
  const confirmed = await call(cofounder, 'books.memoryConfirm', { id: outside.id });
  assert.deepEqual([confirmed.status, confirmed.source], ['assumed', 'outside-content']);
  assert.ok(!(await call(owner, 'books.memory')).lines.some((l: any) => l.status === 'told-by-owner' && l.source === 'outside-content'));
  // The mail source is limited to the owner: other members do not see lines read from it.
  await store.update(s => { s.sourceRules.push({ sourceId: 'mail', memberIds: ['owner'] }); });
  assert.deepEqual((await call(owner, 'books.memory')).lines.map((l: any) => l.id), [outside.id]);
  assert.deepEqual((await call(accountant, 'books.memory')).lines, []);
  await assert.rejects(call(cofounder, 'books.forget', { id: outside.id }), { code: 'MEMORY_NOT_FOUND' });
});

test('finding 4: a customer seen only in disputed facts abstains in matches and refuses a decision with a typed code', async () => {
  const { services, call } = await setup();
  await services.memory.append(owner, [
    fact('inv-x', 'books', 'main', 'invoice', { customerId: 'c-x', phone: '9820022222', amountMinor: '1000' }),
    fact('inv-x', 'crm', 'main', 'invoice', { customerId: 'c-x', phone: '9820022222', amountMinor: '1500' }),
    fact('inv-y', 'books', 'main', 'invoice', { customerId: 'c-y', phone: '9820022222' }),
  ]);
  const pairs = (await call(owner, 'records.matches')).pairs;
  assert.equal(pairs.length, 1);
  assert.deepEqual([pairs[0].left, pairs[0].right, pairs[0].relation, pairs[0].evidence], ['c-x', 'c-y', 'abstain', ['same-phone']]);
  assert.match(pairs[0].reason, /sources disagree on/);
  await assert.rejects(call(owner, 'records.decideMatch', { left: 'c-x', right: 'c-y', same: true }), { code: 'RECORD_DISPUTED' });
});

test('finding 5: numeric entities are capped and invalid code points read as U+FFFD', () => {
  const huge = `&#${'9'.repeat(400)};`;
  assert.doesNotThrow(() => decode(`A${huge}B`));
  assert.equal(decode(`A${huge}B`), `A${huge}B`, 'an over-long reference stays as text');
  assert.equal(decode('&#9999999;|&#x110000;|&#xD800;|&#0;|&#65;|&#x42;|&#X43;'), '�|�|�|�|A|B|C');
  const tally = readTally(`<ENVELOPE><LEDGER NAME="Shop&#9999999;${huge}"><PARENT>Sundry Debtors</PARENT></LEDGER></ENVELOPE>`);
  assert.deepEqual([...tally.ledgers.keys()], [`Shop�${huge}`]);
});

test('finding 6: a rebuild that counts nothing stores a missing word, not zero', async () => {
  const { store, services, call } = await setup({ seed: true });
  const empty = { from: '2020-01-01', to: '2020-01-31' };
  const saved = await services.calculator.calculate(owner, { operation: 'billed', period: empty });
  assert.equal(saved.coverage.countedRows, 0);
  const answerId = store.read().answers.find(a => a.receiptId === saved.id)!.id;
  const rebuilt = await call(owner, 'history.rebuild', { id: answerId });
  assert.deepEqual(rebuilt.rebuilt.quick, { missing: 'not-loaded-yet' }); assert.deepEqual(rebuilt.rebuilt.full, { missing: 'not-loaded-yet' });
});

const definition = (meaning: string) => ({ label: 'Received', meaning, kind: 'payment', field: 'amountMinor', nulls: 'exclude' });

test('finding 7: publish re-checks the draft inside the transaction; a co-signed draft needs an owner to discard', async () => {
  const { store, services, call } = await setup({ seed: true });
  const version = services.ontology.current(owner)!.version;
  /** Runs `mutate` as a separate transaction just before the next store update, as a concurrent request would. */
  const before = (mutate: (s: State) => void) => {
    const original = store.update.bind(store);
    store.update = (async (change: any) => { store.update = original; await original(s => { mutate(s); }); return original(change); }) as typeof store.update;
  };
  const draftIn = (s: State, id: string) => { const found = peekSection<any>(s, 'books').drafts.find((d: any) => d.id === id); assert.ok(found, 'draft stored'); return found; };
  const cases: [string, (s: State, id: string) => void][] = [
    ['DRAFT_CLOSED', (s, id) => { draftIn(s, id).state = 'discarded'; }],
    ['PREVIEW_CHANGED', (s, id) => { draftIn(s, id).digest = 'f'.repeat(64); }],
    ['COSIGN_REQUIRED', s => { s.members.find(m => m.id === 'asha')!.active = false; }],
  ];
  for (const [code, mutate] of cases) {
    await store.update(s => { const a = s.members.find(m => m.id === 'asha')!; a.active = true; });
    const draft = await call(owner, 'books.draft', { name: 'received', definition: definition(`Settled receipts, case ${code}.`) });
    await call(cofounder, 'books.cosign', { draftId: draft.id, digest: draft.digest });
    before(s => mutate(s, draft.id));
    await assert.rejects(call(owner, 'books.publish', { draftId: draft.id, digest: draft.digest }), { code });
    assert.equal(services.ontology.current(owner)!.version, version, `nothing is released after ${code}`);
    const open = draftIn(store.read(), draft.id);
    if (open.state !== 'discarded') await call(owner, 'books.discard', { draftId: draft.id });
  }
  await store.update(s => { s.members.find(m => m.id === 'asha')!.active = true; });
  // Discard rules: an accountant only closes their own draft before anyone co-signs it.
  const mine = await call(accountant, 'books.draft', { name: 'received', definition: definition('Settled receipts by the accountant.') });
  await call(cofounder, 'books.cosign', { draftId: mine.id, digest: mine.digest });
  await assert.rejects(call(accountant, 'books.discard', { draftId: mine.id }), { code: 'FORBIDDEN' });
  await call(owner, 'books.discard', { draftId: mine.id });
  const theirs = await call(owner, 'books.draft', { name: 'received', definition: definition('Settled receipts by the owner.') });
  await assert.rejects(call(accountant, 'books.discard', { draftId: theirs.id }), { code: 'FORBIDDEN' });
  await call(owner, 'books.discard', { draftId: theirs.id });
  const own = await call(accountant, 'books.draft', { name: 'received', definition: definition('Settled receipts, own draft.') });
  assert.deepEqual(await call(accountant, 'books.discard', { draftId: own.id }), { draftId: own.id, state: 'discarded' });
});

test('finding 8: a redraft replaces the open draft in one transaction; replaces names it explicitly', async () => {
  const { services, call } = await setup({ seed: true });
  const first = await call(owner, 'books.draft', { name: 'received', definition: definition('Settled receipts, first wording.') });
  const second = await call(owner, 'books.draft', { name: 'received', definition: definition('Settled receipts, second wording.') });
  let drafts = (await call(owner, 'books.meanings')).drafts;
  assert.deepEqual(drafts.map((d: any) => [d.id, d.state]), [[first.id, 'discarded'], [second.id, 'draft']]);
  await assert.rejects(call(cofounder, 'books.draft', { name: 'received', definition: definition('Not the author.') }), { code: 'DRAFT_OPEN' });
  await assert.rejects(call(accountant, 'books.draft', { name: 'received', definition: definition('Not allowed.'), replaces: second.id }), { code: 'FORBIDDEN' });
  await assert.rejects(call(owner, 'books.draft', { name: 'billed', definition: null, replaces: second.id }), { code: 'INVALID_BOOKS_REQUEST' });
  await assert.rejects(call(owner, 'books.draft', { name: 'received', definition: definition('Gone.'), replaces: 'draft_none' }), { code: 'DRAFT_NOT_FOUND' });
  const third = await call(cofounder, 'books.draft', { name: 'received', definition: definition('Settled receipts, third wording.'), replaces: second.id });
  drafts = (await call(owner, 'books.meanings')).drafts;
  assert.deepEqual(drafts.filter((d: any) => d.state === 'draft' || d.state === 'cosigned').map((d: any) => d.id), [third.id]);
  await assert.rejects(call(owner, 'books.draft', { name: 'received', definition: definition('Again.'), replaces: second.id }), { code: 'DRAFT_CLOSED' });
  await call(owner, 'books.cosign', { draftId: third.id, digest: third.digest });
  const released = await call(owner, 'books.publish', { draftId: third.id, digest: third.digest });
  assert.equal(services.ontology.current(owner)!.definitions.find(d => d.name === 'received')!.meaning, 'Settled receipts, third wording.');
  assert.equal(released.version, 2);
});

test('finding 9: holdings count only what the caller can see; conflicts show only rules over visible sources', async () => {
  const { store, call } = await branches();
  await store.update(s => {
    s.actions.push({ id: 'action_hidden', connector: 'mail', operation: 'send', payload: { customerId: 'c-n1' }, sourceIds: ['south-books'], createdBy: 'owner', status: 'prepared' });
    s.conversations.push({ id: 'conversation_owner', memberId: 'owner', customerId: 'c-n1' });
  });
  const count = (holdings: any, store_: string) => holdings.stores.find((s: any) => s.store === store_).count;
  const mine = await call(owner, 'records.holdings', { id: 'c-n1' });
  assert.deepEqual([count(mine, 'actions'), count(mine, 'conversations')], [1, 1]);
  const theirs = await call(nora, 'records.holdings', { id: 'c-n1' });
  assert.deepEqual([count(theirs, 'actions'), count(theirs, 'conversations'), count(theirs, 'receipts'), count(theirs, 'answers')], [0, 0, 0, 0]);
  await call(owner, 'records.setPrecedence', { kind: 'invoice', sourceIds: ['south-books', 'north-books'] });
  assert.deepEqual((await call(owner, 'records.conflicts')).rules, [{ kind: 'invoice', sourceIds: ['south-books', 'north-books'] }]);
  assert.deepEqual((await call(nora, 'records.conflicts')).rules, []);
});

test('finding 10: Books requests refuse with INVALID_BOOKS_REQUEST and no Books file uses INVALID_REQUEST', async () => {
  const { call } = await setup();
  await assert.rejects(call(owner, 'books.source', { sourceId: '' }), { code: 'INVALID_BOOKS_REQUEST' });
  await assert.rejects(call(owner, 'books.unmapped', { extra: true }), { code: 'INVALID_BOOKS_REQUEST' });
  const directory = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'runtime', 'work-books');
  for (const file of readdirSync(directory).filter(name => /^books.*\.ts$/.test(name)))
    assert.ok(!/\bINVALID_REQUEST\b/.test(readFileSync(join(directory, file), 'utf8')), file);
});
