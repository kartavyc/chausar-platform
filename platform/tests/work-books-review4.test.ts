import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { ImportService } from '../runtime/ingest.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { booksMethods } from '../runtime/work-books/books.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { bookRecordOf } from '../runtime/work-books/work-r4.ts';
import { impactOf } from '../runtime/work-books/books-trial-r4b.ts';
import { learningExtModule } from '../runtime/modules/lane-learning-ext.ts';
import { fakeCoreDeletion } from './work-books-core-data-fake.ts';

// Review 4 of the work-books lane: the reviewer's reproductions, kept as regression tests. Synthetic data only.
// Other lanes are stubbed in a hand-built host, except learning-ext, whose real handlers run on the same store.
class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Review Shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const cof: Context = { memberId: 'co', role: 'cofounder', epoch: 1, channel: 'desktop' };
const branchCof: Context = { memberId: 'bea', role: 'cofounder', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
type Stub = Record<string, (payload: any, store: TestStore) => unknown>;
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const fact = (entityId: string, sourceId: string, fields: Record<string, unknown>, kind = 'invoice'): FactInput =>
  ({ entityId, sourceId, sourceRow: 2, kind, validFrom: '2026-09-02', branch: 'main', fields: { currency: 'INR', ...fields } });

async function setup(stub: Stub = {}) {
  const store = new TestStore();
  await store.update(s => {
    s.members.push({ id: 'co', name: 'Co', role: 'cofounder', active: true, epoch: 1, branches: ['*'] }, { id: 'bea', name: 'Bea', role: 'cofounder', active: true, epoch: 1, branches: ['main'] },
      { id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] });
  });
  const services: Record<string, any> = { imports: new ImportService(store), memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store), actions: new ActionService(store, []) };
  await services.ontology.publish(owner, 'ecommerce');
  const calls: string[] = [];
  const methods = { ...booksMethods, ...workMethods };
  const learning = learningExtModule.methods as Record<string, any>;
  const host = (ctx: Context): ModuleHost => ({ store, services, demo: true, directory: '/tmp/x',
    options: { hasMethod: (method: string) => Object.hasOwn(stub, method) || Object.hasOwn(learning, method) },
    async call(method, payload) {
      calls.push(method);
      if (Object.hasOwn(stub, method)) return stub[method](payload, store);
      if (Object.hasOwn(learning, method)) { authorize(store, ctx, learning[method].permission); return learning[method].handler(ctx, payload, host(ctx)); }
      if (Object.hasOwn(booksMethods, method)) return call(ctx, method, payload);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = methods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  return { store, services, call, calls, host };
}
const hide = (store: TestStore, sourceId: string, memberIds: string[]) => store.update(s => { s.sourceRules.push({ sourceId, memberIds } as any); });

// ---------------------------------------------------------------- 1. reading never calculates

test('review 4 #1: resolving a reminder\'s Books record reads facts only: no aging, no receipts, answers or audit lines', async () => {
  const { store, services, host, calls } = await setup();
  await services.memory.append(owner, [fact('i-1', 'shop', { status: 'unpaid', dueDate: '2026-09-30', invoiceId: 'i-1', amountMinor: '1000', customerId: 'c-1' })]);
  await hide(store, 'secret', ['owner']);
  await services.memory.append(owner, [fact('i-2', 'secret', { status: 'unpaid', dueDate: '2026-09-30', invoiceId: 'i-2', amountMinor: '1000', customerId: 'c-2' })]);
  const revision = store.read().revision;
  for (let i = 0; i < 3; i++) assert.equal(bookRecordOf(host(owner), owner, 'c-1'), 'c-1');
  assert.equal(bookRecordOf(host(owner), owner, 'c-404'), null);
  assert.equal(bookRecordOf(host(owner), owner, null), null);
  assert.equal(bookRecordOf(host(accountant), accountant, 'c-2'), null, 'a record from a hidden source is not named');
  assert.equal(bookRecordOf(host(owner), owner, 'c-2'), 'c-2');
  assert.equal(store.read().revision, revision, 'nothing was written');
  assert.equal(store.read().receipts.length, 0); assert.equal(store.read().answers.length, 0);
  assert.deepEqual(calls, [], 'records.get (which calculates) is never called');
});

test('review 4 #1: records.invoices lists a customer\'s invoices without calculating', async () => {
  const { store, services, call } = await setup();
  await services.memory.append(owner, [
    fact('i-1', 'shop', { status: 'unpaid', dueDate: '2026-09-30', invoiceId: 'INV-1', amountMinor: '1000', customerId: 'c-1', customerName: 'Synthetic Traders' }),
    fact('i-2', 'shop', { status: 'unpaid', dueDate: '2026-10-30', invoiceId: 'INV-2', amountMinor: '2000', customerId: 'c-1' }),
    fact('p-1', 'shop', { amountMinor: '500', customerId: 'c-1' }, 'payment'),
  ]);
  const revision = store.read().revision;
  assert.deepEqual(await call(viewer, 'records.invoices', { id: 'c-1' }), { id: 'c-1', name: 'Synthetic Traders', invoices: ['INV-1', 'INV-2'] });
  assert.equal(store.read().revision, revision, 'listing invoices writes nothing');
  await assert.rejects(call(viewer, 'records.invoices', { id: 'c-404' }), code('RECORD_NOT_FOUND'));
  await assert.rejects(call(viewer, 'records.invoices', { id: 'c-1', extra: 1 }), code('INVALID_BOOKS_REQUEST'));
});

// ---------------------------------------------------------------- 2. account names stay bound to their sources

test('review 4 #2: accounts seen in several hidden sources never reach a restricted accountant through learning-ext', async () => {
  const { store, services, call, host } = await setup();
  const f = (id: string, src: string, account: string) => fact(id, src, { invoiceId: id, amountMinor: '1000', customerId: `c-${id}`, account, accountGroup: 'Indirect Expenses' });
  await services.memory.append(owner, [f('i-1', 'tA', 'Secret Ledger'), f('i-2', 'tB', 'Secret Ledger'), f('i-3', 'tA', 'Only A'), f('i-4', 'open', 'Open Rent')]);
  await hide(store, 'tA', ['owner']); await hide(store, 'tB', ['owner']);
  assert.deepEqual((await call(accountant, 'accounts.list')).accounts.map((a: any) => a.name), ['Open Rent']);
  const proposed = await call(owner, 'accounts.propose');
  assert.equal(proposed.setIds.length, 3, 'one set per source'); assert.equal(proposed.accounts, 3); assert.equal(proposed.setId, proposed.setIds.at(-1));
  const all: any = await host(owner).call('learningx.accountsList', {});
  for (const set of all.sets) assert.equal(set.sourceIds.length, 1, 'every set is bound to exactly one source');
  const named = (sets: any[]) => sets.flatMap((s: any) => s.proposals.map((p: any) => p.name)).sort();
  assert.deepEqual(named(all.sets), ['Only A', 'Open Rent', 'Secret Ledger', 'Secret Ledger']);
  for (const set of all.sets) for (const p of set.proposals) assert.equal(p.sourceId, set.sourceIds[0], 'no account is sent without its source');
  const restricted: any = await host(accountant).call('learningx.accountsList', {});
  assert.deepEqual(named(restricted.sets), ['Open Rent'], 'the accountant reads nothing from the hidden sources');
  // Books still reads the newest proposal for each name from the per-source sets.
  const list = await call(owner, 'accounts.list');
  assert.equal(list.proposals.available, true); assert.ok(list.proposals.sortedAt);
  assert.equal(list.accounts.find((a: any) => a.name === 'Secret Ledger').state, 'proposed');
});

// ---------------------------------------------------------------- 3. the learning-ext mirror is best effort

test('review 4 #3: a decision is kept even when learning-ext refuses its mirror; the same decision again is kept once', async () => {
  const { store, services, call } = await setup();
  await services.memory.append(owner, [fact('i-1', 'tally', { invoiceId: 'i-1', amountMinor: '1000', customerId: 'c-1', account: 'Office Rent', accountGroup: 'Odd Group' })]);
  await call(owner, 'accounts.propose');
  const decisions = () => (store.read().extensions as any)['work-books'].books.accounts.length;
  const first = await call(owner, 'accounts.decide', { name: 'Office Rent', decision: 'yes' });
  assert.deepEqual(first.learning, { recorded: true }); assert.equal(first.repeated, false); assert.equal(first.state, 'decided');
  const before = decisions();
  const second = await call(cof, 'accounts.decide', { name: 'Office Rent', decision: 'no' });
  assert.deepEqual(second.learning, { recorded: false, code: 'ALREADY_DECIDED' }, 'the refusal is reported, not thrown');
  assert.equal(decisions(), before + 1, 'Books kept the person\'s decision');
  const retry = await call(cof, 'accounts.decide', { name: 'Office Rent', decision: 'no' });
  assert.equal(retry.repeated, true); assert.deepEqual(retry.learning, { recorded: false });
  assert.equal(decisions(), before + 1, 'a retry does not add a second line');
  await call(owner, 'accounts.decide', { name: 'Office Rent', decision: 'change', class: 'expense' });
  assert.equal(decisions(), before + 2, 'a different decision is kept');
});

// ---------------------------------------------------------------- 4. the journal follows the source rule

test('review 4 #4: records.timelineMore hides write-back journal entries sent from a source the caller cannot read', async () => {
  const journal = [
    { id: 'j1', kind: 'sent', invoiceId: 'inv-1', customerId: 'c-1', at: '2026-09-10T09:00:00.000Z', sourceIds: ['books'] },
    { id: 'j2', kind: 'paid', invoiceId: 'inv-9', customerId: 'c-1', at: '2026-09-12T09:00:00.000Z', sourceIds: ['tHidden'] },
    { id: 'j3', kind: 'sent', invoiceId: 'inv-3', customerId: 'c-1', at: '2026-09-13T09:00:00.000Z' },
    { id: 'j4', kind: 'sent', invoiceId: 'inv-4', customerId: 'c-1', at: '2026-09-14T09:00:00.000Z', sourceIds: 'books' },
  ];
  const { store, services, call } = await setup({ 'writeback.followUp.journal': () => journal });
  await services.memory.append(owner, [fact('inv-1', 'books', { customerId: 'c-1', amountMinor: '50000', invoiceId: 'inv-1' }), fact('inv-9', 'tHidden', { customerId: 'c-9', amountMinor: '1', invoiceId: 'inv-9' })]);
  await hide(store, 'tHidden', ['owner']);
  const refs = (reply: any) => reply.entries.filter((e: any) => e.source === 'writeback-journal').map((e: any) => e.ref);
  assert.deepEqual(refs(await call(owner, 'records.timelineMore', { id: 'c-1' })), ['inv-1', 'inv-9', 'inv-3']);
  assert.deepEqual(refs(await call(accountant, 'records.timelineMore', { id: 'c-1' })), ['inv-1', 'inv-3']);
});

// ---------------------------------------------------------------- 7. tainted context cannot reapply deletions

test('review 4 #7: approvals.reapplyDeletions refuses a tainted request before calling core-data', async () => {
  const { call, calls } = await setup({ 'deletion.reapply': () => ({ at: '2026-10-15T15:00:00.000Z', complete: true, kinds: [{ kind: 'customer', cameBack: 1, deleted: 1, remaining: 0, state: 'deleted', reason: null }] }) });
  await assert.rejects(call({ ...owner, sourceTainted: true } as Context, 'approvals.reapplyDeletions', { confirmation: 'Synthetic shop' }), code('TAINTED_APPROVAL'));
  assert.ok(!calls.includes('deletion.reapply'));
  const again = await call(owner, 'approvals.reapplyDeletions', { confirmation: 'Synthetic shop' });
  assert.deepEqual([again.reapplied, again.remaining, again.complete], [1, 0, true]);
});

// ---------------------------------------------------------------- 8. BK-20 recount (and, after core-data's round 4, no full-access rule)

// core-data in its exact contract shape, except that it leaves receipts behind while reporting them deleted.
const coreDelete: Stub = fakeCoreDeletion({ leave: ['receipts'] });

test('review 4 #8: after a core deletion the exact receipts counted before are counted again; one left is never "deleted"', async () => {
  const { store, services, call } = await setup(coreDelete);
  await services.memory.append(owner, [fact('inv-1', 'books', { customerId: 'c-1', amountMinor: '50000', status: 'unpaid', dueDate: '2026-09-30', invoiceId: 'inv-1' })]);
  await services.calculator.calculate(owner, { operation: 'aging', customerId: 'c-1' });
  assert.equal(store.read().receipts.length, 1);
  const plan = await call(owner, 'records.deletionPlan', { id: 'c-1' });
  assert.deepEqual(plan.coreDeletion, { available: true, planFrom: 'core' });
  assert.equal(plan.stores.find((s: any) => s.store === 'receipts').count, 1);
  const report = await call(owner, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  const row = (store: string) => report.rows.find((r: any) => r.store === store);
  assert.equal(row('facts').state, 'deleted');
  assert.equal(row('receipts').state, 'pending', 'core-data said deleted, but the receipt counted before is still here');
  assert.equal(report.complete, false);
});

test('review 4 #8, round 4: core-data deletes only the rows the caller can see, so a member with one branch may delete', async () => {
  const { services, call, calls } = await setup(fakeCoreDeletion());
  await services.memory.append(owner, [fact('inv-1', 'books', { customerId: 'c-1', amountMinor: '50000', invoiceId: 'inv-1' })]);
  const plan = await call(branchCof, 'records.deletionPlan', { id: 'c-1' });
  assert.deepEqual(plan.coreDeletion, { available: true, planFrom: 'core' });
  assert.equal(plan.stores.find((s: any) => s.store === 'facts').state, 'can-delete'); assert.equal(plan.canDelete, true);
  const report = await call(branchCof, 'records.delete', { id: 'c-1', confirmation: 'c-1' });
  assert.equal(report.rows.find((r: any) => r.store === 'facts').state, 'deleted');
  assert.equal(calls.filter(c => c === 'deletion.customer').length, 1);
});

// ---------------------------------------------------------------- 9. preserved receipts the caller can read

test('review 4 #9: a strategy preview counts only the preserved receipts the caller can read', async () => {
  const { services, host } = await setup({ 'trials.impact': () => impact });
  let impact: Record<string, unknown> = {};
  await services.memory.append(owner, [fact('inv-1', 'books', { customerId: 'c-1', amountMinor: '50000', status: 'unpaid', dueDate: '2026-09-30', invoiceId: 'inv-1' })]);
  const mine = await services.calculator.calculate(owner, { operation: 'aging', customerId: 'c-1' });
  const theirs = await services.calculator.calculate(cof, { operation: 'aging', customerId: 'c-1' });
  impact = { digest: 'd-1', affectedSavedAnswerIds: [], rebuildArtifactIds: [], activeWorkIds: [], historicalReceiptIdsToPreserve: [mine.id, theirs.id, 'receipt-unknown'] };
  assert.equal((await impactOf(host(owner), owner, 'trial-1', 'prospective')).preserved, 1);
  assert.equal((await impactOf(host(cof), cof, 'trial-1', 'prospective')).preserved, 1);
  assert.equal((await impactOf(host(viewer), viewer, 'trial-1', 'prospective')).preserved, 0);
});

test('review 4: records.invoices is in the lane module and its allowlist', async () => {
  const { readFileSync } = await import('node:fs');
  const { workBooksModule } = await import('../runtime/modules/lane-work-books.ts');
  const listed: string[] = JSON.parse(readFileSync(new URL('../../app/desktop/module-methods/work-books.json', import.meta.url), 'utf8'));
  assert.ok(workBooksModule.methods['records.invoices']); assert.ok(listed.includes('records.invoices'));
});
