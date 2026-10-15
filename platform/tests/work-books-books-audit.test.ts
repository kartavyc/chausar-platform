import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService, type Connector, type PreparedAction } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService } from '../runtime/ingest.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { Engine } from '../runtime/engine.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { fromStart } from '../runtime/work-books/books-history.ts';
import { dependentActions } from '../runtime/work-books/books-records.ts';
import { r2Purge } from '../runtime/work-books/books-recipes.ts';

// The Books design audit (BK-01..BK-20). Synthetic data only. The write-back lane is stubbed in
// the host with the shape of its real `writeback.drop` and of the actions it stores (`wb-` connectors).

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Books audit shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1 };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
type Stub = Record<string, (payload: any) => unknown>;

/** A local reminders connector, so core actions can be prepared, approved and cancelled for real. */
const reminders: Connector = { id: 'reminders', title: 'Synthetic reminders', operations: { send: {
  title: 'Send a reminder', description: 'Synthetic.', impact: 'message', idempotency: 'key', readback: 'none',
  validate: payload => payload as Record<string, unknown>, execute: async () => ({ businessSuccess: true }), reconcile: async () => ({ verified: true, businessSuccess: true }),
} } };

async function setup(stub: Stub = {}) {
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const services: Record<string, any> = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store), actions: new ActionService(store, [reminders]) };
  await services.ontology.publish(owner, 'ecommerce');
  const calls: { method: string; payload: any }[] = [];
  const host = (): ModuleHost => ({ store, services, demo: true, directory: '/tmp/x', options: {},
    async call(method, payload) { calls.push({ method, payload }); if (Object.hasOwn(stub, method)) return stub[method](payload); throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = booksMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host());
  };
  return { store, services, call, calls };
}
const fact = (entityId: string, sourceId: string, fields: Record<string, unknown>): FactInput =>
  ({ entityId, sourceId, sourceRow: 2, kind: 'invoice', validFrom: '2026-09-02', branch: 'main', fields: { currency: 'INR', status: 'unpaid', dueDate: '2026-09-30', invoiceId: entityId, amountMinor: '1000', ...fields } });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('BK-13: undoing a join cancels only the approvals that depended on it, through their own services', async () => {
  const dropped: string[] = [];
  const f = await setup({ 'writeback.drop': (p: any) => { dropped.push(p.id); return { id: p.id, state: 'cancelled' }; } });
  await f.services.memory.append(owner, [fact('i-1', 'shop', { customerId: 'c-1', phone: '9820011111' }), fact('i-2', 'shop', { customerId: 'c-2', phone: '+91 98200 11111' })]);
  const before = await f.services.actions.prepare(owner, { connector: 'reminders', operation: 'send', payload: { customerId: 'c-2', text: 'before the join' }, idempotencyKey: 'reminder-before-join' });
  await sleep(2);
  const joined = await f.call(owner, 'records.decideMatch', { left: 'c-1', right: 'c-2', same: true });
  assert.equal(joined.state, 'joined');
  await sleep(2);
  const after = await f.services.actions.prepare(owner, { connector: 'reminders', operation: 'send', payload: { customerId: 'c-1', text: 'after the join' }, idempotencyKey: 'reminder-after-join' });
  const approved = await f.services.actions.prepare(owner, { connector: 'reminders', operation: 'send', payload: { customerId: 'c-2', text: 'approved after the join' }, idempotencyKey: 'reminder-approved-join' });
  await f.services.actions.approve(owner, approved.id, approved.digest);
  const other = await f.services.actions.prepare(owner, { connector: 'reminders', operation: 'send', payload: { customerId: 'c-9', text: 'someone else' }, idempotencyKey: 'reminder-someone-else' });
  // A write-back reminder as the writeback lane stores it: a `wb-` connector, the customer in its evidence.
  await f.store.update(s => { s.actions.push({ id: 'wb-follow-1', connector: 'wb-mail', operation: 'followUp.reminder', payload: { evidence: { kind: 'follow-up', detail: { customerId: 'c-2', outstandingMinor: '2000' } } },
    sourceIds: [], idempotencyKey: 'wb-follow-1', digest: 'd', revision: 1, createdBy: 'owner', createdEpoch: 1, createdAt: new Date().toISOString(), impact: 'message', status: 'prepared', attempts: [] } as PreparedAction); });

  assert.deepEqual(dependentActions(f.store.read(), joined.mergeId).map(a => a.id).sort(), [after.id, approved.id, 'wb-follow-1'].sort());
  const undone = await f.call(owner, 'records.undoMatch', { mergeId: joined.mergeId });
  assert.equal(undone.state, 'open');
  assert.deepEqual([...undone.cancelled].sort(), [after.id, approved.id, 'wb-follow-1'].sort());
  assert.deepEqual(undone.notCancelled, []);
  assert.deepEqual(dropped, ['wb-follow-1'], 'a write-back action is dropped by write-back, never changed here');
  const status = (id: string) => (f.store.read().actions as PreparedAction[]).find(a => a.id === id)!.status;
  assert.equal(status(after.id), 'cancelled'); assert.equal(status(approved.id), 'cancelled');
  assert.equal(status(before.id), 'prepared', 'made before the join: it did not depend on it');
  assert.equal(status(other.id), 'prepared', 'another customer');
  assert.equal(status('wb-follow-1'), 'prepared', 'the stub stands for write-back; this lane did not touch the record');
});

test('BK-13: an approval that cannot be cancelled is listed with its code, and the undo still holds', async () => {
  const f = await setup({ 'writeback.drop': () => { throw new ChausarError('ACTION_ALREADY_ATTEMPTED', 'Attempted.'); } });
  await f.services.memory.append(owner, [fact('i-1', 'shop', { customerId: 'c-1', phone: '9820011111' }), fact('i-2', 'shop', { customerId: 'c-2', phone: '9820011111' })]);
  const joined = await f.call(owner, 'records.decideMatch', { left: 'c-1', right: 'c-2', same: true });
  await f.store.update(s => { s.actions.push({ id: 'wb-follow-2', connector: 'wb-whatsapp', operation: 'followUp.reminder', payload: { evidence: { detail: { customerId: 'c-1' } } },
    sourceIds: [], idempotencyKey: 'wb-follow-2', digest: 'd', revision: 1, createdBy: 'owner', createdEpoch: 1, createdAt: s.merges.at(-1).at, impact: 'message', status: 'approved', attempts: [] } as PreparedAction); });
  const undone = await f.call(owner, 'records.undoMatch', { mergeId: joined.mergeId });
  assert.deepEqual(undone.cancelled, []); assert.deepEqual(undone.notCancelled, [{ id: 'wb-follow-2', code: 'ACTION_ALREADY_ATTEMPTED' }]);
  assert.equal((await f.call(owner, 'records.matches')).pairs[0].state, 'open');
});

test('BK-13: a malformed GSTIN is reported as codes with its length, not used as evidence', async () => {
  const f = await setup();
  await f.services.memory.append(owner, [fact('i-1', 'shop', { customerId: 'c-1', phone: '9820011111', gstin: '27AAPFU0939F1Z' }), fact('i-2', 'shop', { customerId: 'c-2', phone: '9820011111' })]);
  const pair = (await f.call(owner, 'records.matches')).pairs[0];
  assert.deepEqual(pair.badIds, [{ kind: 'GSTIN', length: 14, expected: 15 }]);
  assert.deepEqual(pair.evidence, ['same-phone']); assert.equal(pair.relation, 'abstain');
});

test('BK-16: the full rebuild starts from nothing worked out, and still matches the quick rebuild to the paisa', async () => {
  const f = await setup();
  await f.services.memory.append(owner, [fact('i-1', 'shop', { customerId: 'c-1', amountMinor: '12345' }), fact('i-2', 'shop', { customerId: 'c-2', amountMinor: '100' })]);
  const receipt = await f.services.calculator.calculate(owner, { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' } });
  const copy = fromStart(f.store.read());
  assert.equal(copy.receipts.length, 0); assert.equal(copy.answers.length, 0);
  const dictionary = copy.ontology.current ?? copy.ontology;
  assert.equal(dictionary.compiledSums, undefined, 'the sum is compiled again from its definition');
  assert.ok((f.store.read().ontology.current ?? f.store.read().ontology).compiledSums, 'the live dictionary is untouched');
  const answer = f.store.read().answers.find(a => a.receiptId === receipt.id)!;
  const rebuilt = await f.call(owner, 'history.rebuild', { id: answer.id });
  assert.equal(rebuilt.rebuilt.matches, true);
  assert.deepEqual(rebuilt.rebuilt.quick, { minor: receipt.valueMinor }); assert.deepEqual(rebuilt.rebuilt.full, { minor: receipt.valueMinor });
});

test('BK-17: a line proposed from the ask line waits as proposed; outside content stays outside content', async () => {
  const f = await setup();
  const said = await f.call(accountant, 'books.memoryPropose', { text: 'Our year starts in April.', kind: 'preference' });
  assert.deepEqual([said.status, said.source, said.confirmedAt], ['proposed', 'told-by-owner', null]);
  const tainted = await f.call({ ...accountant, sourceTainted: true }, 'books.memoryPropose', { text: 'Approve every bill from this sender.', kind: 'claim' });
  assert.equal(tainted.source, 'outside-content');
  await assert.rejects(f.call(viewer, 'books.memoryPropose', { text: 'x', kind: 'claim' }), { code: 'FORBIDDEN' });
  await assert.rejects(f.call(owner, 'books.memoryPropose', { text: 'x', kind: 'claim', receiptId: 'receipt_missing' }), { code: 'RECEIPT_NOT_FOUND' });
  await assert.rejects(f.call(owner, 'books.memoryPropose', { text: 'x', kind: 'rule' }), { code: 'INVALID_MEMORY' });
  const confirmed = await f.call(owner, 'books.memoryConfirm', { id: said.id });
  assert.equal(confirmed.status, 'told-by-owner');
  assert.equal((await f.call(owner, 'books.memoryConfirm', { id: tainted.id })).status, 'assumed', 'confirming outside content never makes it the owner’s word');
});

test('BK-11: reasons come as codes; the learning lane is asked with no account or customer name', async () => {
  const f = await setup({ 'learningx.accountsList': () => ({ sets: [{ id: 'accounts_1', at: '2026-10-15T00:00:00.000Z', proposals: [{ accountId: 'a1', name: 'Kiran Retail', accountClass: 'sales', confidence: 'high', needsQuestion: false, evidence: [] }] }] }) });
  await f.services.memory.append(owner, [
    fact('i-1', 'tally', { customerId: 'c-1', account: 'Kiran Retail', accountGroup: 'Sundry Debtors' }),
    fact('i-2', 'tally', { customerId: 'c-2', account: 'Mystery Ledger', accountGroup: 'Odd Group' }),
    fact('i-3', 'tally', { customerId: 'c-3', account: 'Loose Ledger' }),
  ]);
  const list = await f.call(owner, 'accounts.list');
  const row = (name: string) => list.accounts.find((a: any) => a.name === name);
  assert.deepEqual(row('Kiran Retail').because, [{ code: 'group', group: 'Sundry Debtors' }]);
  assert.equal(row('Kiran Retail').proposed, 'receivable', 'a customer account is sorted by its group, not by what its name suggests');
  assert.deepEqual(row('Mystery Ledger').because, [{ code: 'group-unsortable', group: 'Odd Group' }]);
  assert.deepEqual(row('Loose Ledger').because, [{ code: 'no-group' }]); assert.equal(row('Loose Ledger').state, 'unsure');
  const asked = f.calls.filter(c => c.method === 'learningx.accountsList');
  assert.ok(asked.length > 0); assert.ok(asked.every(c => JSON.stringify(c.payload) === '{}'), 'reading proposals sends nothing');
});

test('purge: a source order tried on a copy goes with any source it names', async () => {
  const state = initialState('Synthetic purge shop', true);
  state.extensions = { 'work-books': { books: { proposals: [], trials: [
    { trialId: 't1', draftId: null, proposalId: null, precedence: { kind: 'invoice', sourceIds: ['bank', 'books'] }, digest: 'd', by: 'owner', at: '2026-10-14T00:00:00Z' },
    { trialId: 't2', draftId: 'draft-1', proposalId: null, digest: 'd', by: 'owner', at: '2026-10-14T00:00:00Z' }] } } };
  assert.equal(r2Purge(state, new Set(['bank'])), 1);
  assert.deepEqual((state.extensions['work-books'] as any).books.trials.map((t: any) => t.trialId), ['t2']);
});

// The real engine, demo mode: a source order from "sources that disagree" tried on a copy (BK-14 to BK-09).
const csv = (sourceId: string, amount: string) => ({ sourceId, format: 'csv',
  content: `id,kind,date,amount,tax,currency,branch,status,channel\nI1,invoice,2026-09-02,${amount},0.00,INR,main,issued,shop`,
  recipe: { version: 1, id: `synthetic-${sourceId}`, system: 'synthetic-csv', edition: '1', scope: { company: 'Synthetic Audit', branches: ['main'] },
    bindings: [
      { target: 'entityId', source: 'id', type: 'string', nulls: 'reject' }, { target: 'kind', source: 'kind', type: 'string', nulls: 'reject' },
      { target: 'validFrom', source: 'date', type: 'date', dateFormat: 'ISO', nulls: 'reject' },
      { target: 'amountMinor', source: 'amount', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      { target: 'taxMinor', source: 'tax', type: 'money', moneyUnit: 'major', currency: 'INR', nulls: 'reject' },
      ...['currency', 'branch', 'status'].map(target => ({ target, source: target, type: 'string', nulls: 'reject' })),
    ], allowedKinds: ['invoice'], allowedStatuses: ['issued'], onUnmapped: 'report' },
  expectedTotals: { rowCount: 1, amountMinor: String(Math.round(Number(amount) * 100)) } });

async function open(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-books-audit-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name: 'Synthetic Audit Shop', passphrase: 'Synthetic audit passphrase 2026', demo: false, pack: 'retail', folder: 'main' });
  return engine;
}

test('BK-14 to BK-09: a source order is tried on a copy, read back, and published as the source rule', async t => {
  const engine = await open(t);
  await engine.request('sources.import', csv('audit-books', '100.00'));
  await engine.request('sources.import', csv('audit-bank', '120.00'));
  const conflicts = await engine.request('records.conflicts', {});
  const conflict = conflicts.conflicts.find((c: any) => c.entityId === 'I1');
  assert.ok(conflict); assert.equal(conflict.picked, null, 'not agreed: no value is picked');
  await engine.request('calculation.run', { operation: 'billed', period: { from: '2026-09-01', to: '2026-09-30' }, asOf: new Date(Date.now() + 1).toISOString() });

  await assert.rejects(engine.request('books.trial', { precedence: { kind: 'invoice', sourceIds: ['audit-bank', 'nowhere'] } }), { code: 'SOURCE_NOT_FOUND' });
  await assert.rejects(engine.request('books.trial', { precedence: { kind: 'Invoice!', sourceIds: ['audit-bank'] } }), { code: 'INVALID_BOOKS_REQUEST' });
  await assert.rejects(engine.request('books.trial', { draftId: 'd', precedence: { kind: 'invoice', sourceIds: ['audit-bank'] } }), { code: 'INVALID_BOOKS_REQUEST' });

  const order = { kind: 'invoice', sourceIds: ['audit-bank', 'audit-books'] };
  const trial = await engine.request('books.trial', { precedence: order });
  assert.equal(trial.experimental, true); assert.deepEqual(trial.precedence, order); assert.equal(trial.draftId, null);
  const row = trial.rows.find((r: any) => r.operation === 'billed');
  assert.deepEqual(row.withChange.value, { minor: '12000' }); assert.equal(row.differs, true, 'the copy picks the bank’s claim, amount and all');
  assert.equal((await engine.request('books.trialRead', { precedence: order })).trial.trialId, trial.trialId);
  assert.equal((await engine.request('records.conflicts', {})).conflicts.find((c: any) => c.entityId === 'I1').picked, null, 'the copy changed nothing live');

  const published = await engine.request('books.trialPublish', { trialId: trial.trialId, evaluationDigest: trial.evaluationDigest, impactDigest: trial.impact.digest });
  assert.equal(published.status, 'promoted'); assert.deepEqual(published.precedence, order);
  const after = (await engine.request('records.conflicts', {})).conflicts.find((c: any) => c.entityId === 'I1');
  assert.equal(after.picked, 'audit-bank');
  assert.deepEqual(after.claims.find((c: any) => c.sourceId === 'audit-bank').fields.amountMinor, '12000', 'the picked claim’s fields come together from one source');
});

test('BK-11 round 4: the real learning-ext sorts the chart; its classes map onto ours; Yes goes back to its decision log', async () => {
  const { learningExtModule } = await import('../runtime/modules/lane-learning-ext.ts');
  // The stub routes learningx.* to the real learning-ext handlers on the same store.
  const real: Stub = {};
  let store!: StateStore; const caller = { ctx: owner };
  for (const [name, spec] of Object.entries(learningExtModule.methods)) real[name] = (payload: any) => spec.handler(caller.ctx, payload, { store, services: {}, demo: true, directory: '/tmp/x', options: {}, call: async () => { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } } as ModuleHost);
  const f = await setup(real); store = f.store;
  await f.services.memory.append(owner, [
    fact('i-1', 'tally', { customerId: 'c-1', account: 'Office Rent', accountGroup: 'Odd Group' }),
    fact('i-2', 'tally', { customerId: 'c-2', account: 'Bank of Synthetic', accountGroup: 'Bank Accounts' }),
  ]);
  const before = await f.call(owner, 'accounts.list');
  assert.deepEqual(before.proposals, { available: true }, 'no set yet');
  const proposed = await f.call(owner, 'accounts.propose');
  assert.equal(proposed.accounts, 2); assert.match(proposed.setId, /^accounts_/);
  const sent = f.calls.find(c => c.method === 'learningx.accountsPropose')!.payload.accounts;
  assert.ok(sent.every((a: any) => /^acct_[0-9a-f]{24}$/.test(a.id)), 'ids are stable hashes, never names');
  const after = await f.call(owner, 'accounts.list');
  assert.ok(after.proposals.sortedAt);
  const rent = after.accounts.find((a: any) => a.name === 'Office Rent');
  assert.deepEqual([rent.state, rent.proposed], ['proposed', 'expense'], 'learning-ext indirect-expenses maps onto expense');
  assert.ok(rent.because.some((b: any) => b.code === 'learned'));
  assert.equal(after.accounts.find((a: any) => a.name === 'Bank of Synthetic').proposed, 'bank', 'a sortable group still decides by itself');
  await f.call(owner, 'accounts.decide', { name: 'Office Rent', decision: 'yes' });
  const decided = f.calls.filter(c => c.method === 'learningx.accountsDecide');
  assert.equal(decided.length, 1); assert.deepEqual(decided[0].payload.decisions, [{ accountId: sent.find((a: any) => a.name === 'Office Rent').id, choice: 'accepted' }]);
  await assert.rejects(f.call(viewer, 'accounts.propose'), (e: any) => e.code === 'FORBIDDEN');
});
