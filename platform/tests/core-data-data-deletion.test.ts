import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authorize, ChausarError, initialState, type Context, type State, type StateStore } from '../runtime/contracts.ts';
import { ActionService, type Connector } from '../runtime/actions.ts';
import { CalculatorService } from '../runtime/calculator.ts';
import { MemoryService, type FactInput } from '../runtime/memory.ts';
import { OntologyService } from '../runtime/ontology.ts';
import { TrustService } from '../runtime/trust.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { dataMethods } from '../runtime/core-data/data.ts';
import { bindRegisterDirectory, readRegister, registerKey, REGISTER_LIMITS } from '../runtime/core-data/deletion-register.ts';
import { holdingsOf } from '../runtime/work-books/books-records.ts';

// Deleting one customer's core rows (BK-20, TR-13) and re-applying deletions after a restore (WK-15). Synthetic data only.

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic Deletion Shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const cofounder: Context = { memberId: 'meera', role: 'cofounder', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'ravi', role: 'accountant', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'vik', role: 'viewer', epoch: 1 };
const reminders: Connector = { id: 'reminders', title: 'Synthetic reminders', operations: { send: {
  title: 'Send a reminder', description: 'Synthetic.', impact: 'message', idempotency: 'key', readback: 'none',
  validate: payload => payload as Record<string, unknown>, execute: async () => ({ businessSuccess: true }), reconcile: async () => ({ verified: true, businessSuccess: true }),
} } };
const fact = (entityId: string, sourceId: string, fields: Record<string, unknown>): FactInput =>
  ({ entityId, sourceId, sourceRow: 2, kind: 'invoice', validFrom: '2026-09-02', branch: 'main', fields: { currency: 'INR', status: 'unpaid', dueDate: '2026-09-30', invoiceId: entityId, amountMinor: '1000', ...fields } });
const period = { from: '2026-09-01', to: '2026-09-30' };
const code = (value: string) => (error: unknown) => (error as ChausarError).code === value;
const FIVE = ['facts', 'receipts', 'answers', 'actions', 'conversations'];

async function setup(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-deletion-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = new TestStore();
  await store.update(s => { s.members.push({ id: 'meera', name: 'Meera', role: 'cofounder', active: true, epoch: 1, branches: ['*'] },
    { id: 'ravi', name: 'Ravi', role: 'accountant', active: true, epoch: 1, branches: ['*'] }, { id: 'vik', name: 'Vik', role: 'viewer', active: true, epoch: 1, branches: ['*'] }); });
  const services: Record<string, any> = { memory: new MemoryService(store), ontology: new OntologyService(store), calculator: new CalculatorService(store), actions: new ActionService(store, [reminders]), trust: new TrustService(store) };
  await services.ontology.publish(owner, 'ecommerce');
  const host = (): ModuleHost => ({ store, services, demo: true, directory, options: {}, async call() { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } });
  const call = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = dataMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host());
  };
  return { store, services, call, host, directory };
}
/** c-1 with two invoices, c-2 joined into c-1, c-3 unrelated; a receipt and answer, actions in each state, conversations. */
async function populate(f: Awaited<ReturnType<typeof setup>>) {
  await f.services.memory.append(owner, [fact('i-1', 'shop', { customerId: 'c-1', customerName: 'Asha Traders' }), fact('i-2', 'shop', { customerId: 'c-1' }),
    fact('i-3', 'shop', { customerId: 'c-2' }), fact('i-4', 'shop', { customerId: 'c-3' })]);
  await f.services.memory.merge(owner, ['c-1', 'c-2'], 'c-1');
  const receipt = await f.services.calculator.calculate(owner, { operation: 'billed', period });
  const others = await f.services.calculator.calculate(accountant, { operation: 'billed', period });
  const prepare = (key: string, customerId: string) => f.services.actions.prepare(owner, { connector: 'reminders', operation: 'send', payload: { customerId, text: 'Synthetic reminder.' }, idempotencyKey: `reminder-${key}` });
  const plain = await prepare('a-plain', 'c-1'), executing = await prepare('a-executing', 'c-1'), unsure = await prepare('a-unknown', 'c-2'), unrelated = await prepare('a-other', 'c-3');
  await f.store.update(s => {
    s.actions.find(a => a.id === executing.id).status = 'executing'; s.actions.find(a => a.id === unsure.id).status = 'unknown';
    s.conversations.push({ id: 'conv-own', memberId: 'owner', at: new Date().toISOString(), turns: [{ customerId: 'c-1', text: 'synthetic' }] },
      { id: 'conv-other', memberId: 'ravi', at: new Date().toISOString(), turns: [{ customerId: 'c-1' }] });
  });
  return { receipt, others, plain, executing, unsure, unrelated };
}
const counts = (rows: { store: string; count: number }[]) => Object.fromEntries(rows.filter(r => FIVE.includes(r.store)).map(r => [r.store, r.count]));

test('BK-20: the plan counts exactly what records.holdings counts in the five core stores', async t => {
  const f = await setup(t); await populate(f);
  for (const ctx of [owner, accountant]) {
    const plan = await f.call(ctx, 'deletion.customerPlan', { id: 'c-1' });
    assert.deepEqual(counts(plan.stores), counts(holdingsOf(f.host(), ctx, 'c-1')), `as ${ctx.memberId}`);
  }
  const plan = await f.call(owner, 'deletion.customerPlan', { id: 'c-1' });
  assert.deepEqual(plan.stores.map((s: any) => [s.store, s.count, s.waiting, s.state]), [['facts', 3, 0, 'can-delete'], ['receipts', 1, 0, 'can-delete'], ['answers', 1, 0, 'can-delete'],
    ['actions', 3, 2, 'can-delete'], ['conversations', 1, 0, 'can-delete']]);
  assert.match(plan.stores[3].reason, /checked first/); assert.equal(plan.canDelete, true);
  await assert.rejects(f.call(owner, 'deletion.customerPlan', { id: 'nobody' }), code('RECORD_NOT_FOUND'));
  await assert.rejects(f.call(owner, 'deletion.customerPlan', { id: 'c-1', extra: true }), code('INVALID_DELETION_REQUEST'));
});

test('BK-20: deleting a customer removes the counted rows and derived copies, keeps unsure actions, and records the deletion outside the vault', async t => {
  const f = await setup(t); const made = await populate(f); const revision = f.store.read().revision;
  await assert.rejects(f.call(viewer, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' }), code('FORBIDDEN'));
  await assert.rejects(f.call({ ...owner, sourceTainted: true }, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' }), code('TAINTED_APPROVAL'));
  await assert.rejects(f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-2' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(f.call(owner, 'deletion.customer', { id: 'nobody', confirmation: 'nobody' }), code('RECORD_NOT_FOUND'));
  assert.equal(f.store.read().revision, revision, 'a refused deletion writes nothing');

  const report = await f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' });
  assert.deepEqual(report.rows.map((r: any) => [r.store, r.count, r.remaining, r.state]), [['facts', 3, 0, 'deleted'], ['receipts', 1, 0, 'deleted'], ['answers', 1, 0, 'deleted'],
    ['actions', 3, 2, 'pending'], ['conversations', 1, 0, 'deleted']]);
  assert.match(report.rows[3].reason, /executing or unsure/); assert.equal(report.complete, false);
  const state = f.store.read();
  assert.deepEqual(state.facts.map(x => x.fields.customerId), ['c-3']);
  assert.equal(state.tombstones.filter(x => x.kind === 'content' && x.factId).length, 3);
  assert.equal(state.receipts.some(r => r.id === made.receipt.id), false); assert.equal(state.answers.some(a => a.receiptId === made.receipt.id), false);
  assert.deepEqual(state.actions.map(a => a.id).sort(), [made.executing.id, made.unsure.id, made.unrelated.id].sort());
  assert.deepEqual(state.conversations.map(c => c.id), ['conv-other'], 'another person\'s conversation is theirs to delete');
  // Another person's receipt used the deleted rows: it is kept and marked stale, and its answer too.
  const other = state.receipts.find(r => r.id === made.others.id); assert.equal(other.stale, true); assert.match(other.staleReason, /deleted/);
  assert.equal(report.derived.staleMarked >= 1, true);
  // The register holds keyed hashes only: the customer's id and name are not in the file, nor in the audit.
  const files = await readdir(join(f.directory, 'deletions')); assert.equal(files.length, 1);
  const text = await readFile(join(f.directory, 'deletions', files[0]), 'utf8');
  assert.equal(/c-1|c-2|Asha/.test(text), false);
  const [entry, ...rest] = readRegister(f.directory, state.workspace.id);
  assert.equal(rest.length, 0); assert.equal(entry.key, registerKey(state.workspace.id, 'customer', 'c-1')); assert.equal(entry.rows!.length, 3 + 1 + 1 + 1 + 1, 'the rows erased, by keyed hash');
  const audit = state.activity.filter(a => a.event === 'deletion.customer'); assert.equal(audit.length, 1); assert.equal(/c-1|c-2|Asha/.test(JSON.stringify(audit)), false);

  // Once the unsure actions are settled, a second deletion removes them.
  await f.store.update(s => { for (const a of s.actions) if (a.id === made.executing.id || a.id === made.unsure.id) a.status = 'verified'; });
  const second = await f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' });
  assert.deepEqual(second.rows.map((r: any) => [r.store, r.state]), [['facts', 'nothing-held'], ['receipts', 'nothing-held'], ['answers', 'nothing-held'], ['actions', 'deleted'], ['conversations', 'nothing-held']]);
  assert.equal(second.complete, true); assert.deepEqual(f.store.read().actions.map(a => a.id), [made.unrelated.id]);
});

test('BK-20: each person deletes only what they can see or own', async t => {
  const f = await setup(t); await populate(f);
  await f.store.update(s => { s.members.find(m => m.id === 'ravi')!.branches = ['west']; });
  // The accountant no longer sees the main branch, but their own saved receipt and conversation about the customer are still theirs.
  assert.deepEqual(counts((await f.call(accountant, 'deletion.customerPlan', { id: 'c-1' })).stores), { facts: 0, receipts: 1, answers: 1, actions: 0, conversations: 1 });
  await assert.rejects(f.call(accountant, 'deletion.customerPlan', { id: 'c-9' }), code('RECORD_NOT_FOUND'));
  const plan = await f.call(cofounder, 'deletion.customerPlan', { id: 'c-1' });
  assert.deepEqual(counts(plan.stores), { facts: 3, receipts: 0, answers: 0, actions: 0, conversations: 0 }, 'the owner\'s receipts and private local actions are not the cofounder\'s');
  const report = await f.call(cofounder, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' });
  assert.deepEqual(report.rows.map((r: any) => r.state), ['deleted', 'nothing-held', 'nothing-held', 'nothing-held', 'nothing-held']);
  assert.equal(f.store.read().actions.length, 4, 'the owner\'s actions stay');
});

test('WK-15: deletions that came back with an older vault are found by keyed hash and deleted again; newer rows stay', async t => {
  const f = await setup(t); const made = await populate(f);
  const backup = structuredClone(f.store.read());
  await f.store.update(s => { for (const a of s.actions) a.status = 'verified'; });
  await f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' });
  assert.deepEqual((await f.call(owner, 'deletion.pending', {})).kinds, [{ kind: 'customer', cameBack: 0 }, { kind: 'source', cameBack: 0 }]);
  // A restore brings the older vault back.
  f.store.state = structuredClone(backup);
  await new Promise(r => setTimeout(r, 5));
  await f.services.memory.append(owner, [fact('i-9', 'shop', { customerId: 'c-1' })]);
  const pending = await f.call(viewer, 'deletion.pending', {});
  assert.deepEqual(pending.kinds, [{ kind: 'customer', cameBack: 1 }, { kind: 'source', cameBack: 0 }]); assert.equal(pending.total, 1);
  assert.equal(JSON.stringify(pending).includes('c-1'), false);
  await assert.rejects(f.call(owner, 'deletion.reapply', { confirmation: 'wrong' }), code('CONFIRMATION_REQUIRED'));
  await assert.rejects(f.call({ ...owner, sourceTainted: true }, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' }), code('TAINTED_APPROVAL'));
  await assert.rejects(f.call(accountant, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' }), code('FORBIDDEN'));
  // The backup still had two unsure actions: they come back unsure, are checked first and kept.
  const first = await f.call(owner, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' });
  assert.deepEqual(first.kinds.map((k: any) => [k.kind, k.cameBack, k.deleted, k.remaining, k.state]), [['customer', 1, 0, 1, 'pending'], ['source', 0, 0, 0, 'nothing-held']]);
  assert.match(first.kinds[0].reason, /executing or unsure/); assert.equal(first.complete, false);
  assert.deepEqual(f.store.read().actions.filter(a => a.payload.customerId !== 'c-3').map(a => a.status).sort(), ['executing', 'unknown']);
  await f.store.update(s => { for (const a of s.actions) a.status = 'verified'; });
  const again = await f.call(owner, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' });
  assert.deepEqual(again.kinds.map((k: any) => [k.kind, k.cameBack, k.deleted, k.remaining, k.state]), [['customer', 1, 1, 0, 'deleted'], ['source', 0, 0, 0, 'nothing-held']]);
  assert.equal(again.complete, true);
  const state = f.store.read();
  assert.deepEqual(state.facts.map(x => x.entityId).sort(), ['i-4', 'i-9'], 'the invoice learned after the deletion stays');
  // Exactly the rows deleted before: the accountant's own receipt and conversation were never deleted, so they are not "back".
  assert.ok(state.receipts.some(r => r.id === made.others.id)); assert.ok(state.conversations.some(c => c.id === 'conv-other'));
  assert.equal((await f.call(owner, 'deletion.pending', {})).total, 0);
  assert.equal(state.activity.filter(a => a.event === 'deletion.reapplied').length, 2);
});

test('WK-15: a source deletion is registered by the trust service, and when no folder is known it waits in the vault outbox', async t => {
  const f = await setup(t); await populate(f);
  const backup = structuredClone(f.store.read());
  bindRegisterDirectory(f.store, f.directory);
  await f.services.trust.deleteSource(owner, 'shop');
  const id = f.store.read().workspace.id;
  assert.deepEqual(readRegister(f.directory, id).map(e => [e.kind, e.key]), [['source', registerKey(id, 'source', 'shop')]]);
  f.store.state = structuredClone(backup);
  assert.deepEqual((await f.call(owner, 'deletion.pending', {})).kinds, [{ kind: 'customer', cameBack: 0 }, { kind: 'source', cameBack: 1 }]);
  const again = await f.call(owner, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' });
  assert.deepEqual(again.kinds[1], { kind: 'source', cameBack: 1, deleted: 1, remaining: 0, state: 'deleted', reason: null });
  assert.equal(f.store.read().facts.length, 0);

  // Another store with no folder bound: the entry waits in memory (the vault's stores are untouched), is counted, and the next deletion writes it out.
  const g = await setup(t); await populate(g); const gBackup = structuredClone(g.store.read()); const backupOf = (_: unknown) => gBackup;
  const loose = new TestStore(); loose.state = g.store.state; const trust = new TrustService(loose);
  await trust.deleteSource(owner, 'shop'); g.store.state = loose.state;
  assert.equal(g.store.read().extensions, undefined);
  assert.deepEqual(readRegister(g.directory, g.store.read().workspace.id), []);
  g.store.state = structuredClone(backupOf(g)); assert.equal((await g.call(owner, 'deletion.pending', {})).kinds[1].cameBack, 1);
  g.store.state = loose.state;
  await g.services.memory.append(owner, [fact('i-5', 'till', { customerId: 'c-5' })]);
  await g.call(owner, 'deletion.customer', { id: 'c-5', confirmation: 'c-5' });
  assert.deepEqual(readRegister(g.directory, g.store.read().workspace.id).map(e => e.kind).sort(), ['customer', 'source']);
  assert.equal((await g.call(owner, 'deletion.pending', {})).registered, 2);
});

test('WK-15: a malformed or full register is refused with a typed code and nothing is deleted', async t => {
  const f = await setup(t); await populate(f);
  const id = f.store.read().workspace.id; await f.call(owner, 'deletion.customer', { id: 'c-3', confirmation: 'c-3' });
  const [name] = await readdir(join(f.directory, 'deletions')); const file = join(f.directory, 'deletions', name);
  for (const body of ['{not json', JSON.stringify({ version: 1, workspace: 'x', entries: [] }), JSON.stringify({ version: 1, workspace: JSON.parse(await readFile(file, 'utf8')).workspace, entries: [{ key: 'c-1', kind: 'customer', at: '2026-10-01T00:00:00.000Z' }] })]) {
    await writeFile(file, body);
    const revision = f.store.read().revision;
    await assert.rejects(f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' }), code('DELETION_REGISTER_INVALID'));
    await assert.rejects(f.call(owner, 'deletion.pending', {}), code('DELETION_REGISTER_INVALID'));
    assert.equal(f.store.read().revision, revision); assert.equal(f.store.read().facts.some(x => x.fields.customerId === 'c-1'), true);
  }
  const workspace = JSON.parse((await readFile(file, 'utf8'))).workspace;
  const entries = Array.from({ length: REGISTER_LIMITS.entries }, (_, i) => ({ key: i.toString(16).padStart(64, '0'), kind: 'customer', at: '2026-10-01T00:00:00.000Z' }));
  await writeFile(file, JSON.stringify({ version: 1, workspace, entries }));
  await assert.rejects(f.call(owner, 'deletion.customer', { id: 'c-1', confirmation: 'c-1' }), code('DELETION_REGISTER_FULL'));
  assert.equal(f.store.read().facts.some(x => x.fields.customerId === 'c-1'), true);
  assert.equal(readRegister(f.directory, id).length, REGISTER_LIMITS.entries);
  // No temporary file is left behind by the atomic writes.
  assert.deepEqual((await readdir(join(f.directory, 'deletions'))).filter(n => n.endsWith('.tmp')), []);
  await mkdir(join(f.directory, 'unused'), { recursive: true });
});

test('WK-15: a register entry without its row list falls back to the customer\'s own key and older rows', async t => {
  const f = await setup(t); await populate(f);
  const id = f.store.read().workspace.id; const later = new Date(Date.now() + 60000).toISOString();
  await mkdir(join(f.directory, 'deletions'), { recursive: true });
  const { hash } = await import('../runtime/contracts.ts');
  await writeFile(join(f.directory, 'deletions', `register-${hash(id).slice(0, 32)}.json`), JSON.stringify({ version: 1, workspace: hash(id), entries: [{ key: registerKey(id, 'customer', 'c-3'), kind: 'customer', at: later, rows: null }] }));
  assert.deepEqual((await f.call(owner, 'deletion.pending', {})).kinds[0], { kind: 'customer', cameBack: 1 });
  await f.store.update(s => { for (const a of s.actions) a.status = 'verified'; });
  const again = await f.call(owner, 'deletion.reapply', { confirmation: 'Synthetic Deletion Shop' });
  // Without the row list only what the caller holds can go; the accountant's own receipt still names the customer, and the note says so.
  assert.deepEqual(again.kinds[0], { kind: 'customer', cameBack: 1, deleted: 0, remaining: 1, state: 'pending', reason: 'Some of it is held by another person or is outside your access. They delete it again.' });
  assert.equal(f.store.read().facts.some(x => x.fields.customerId === 'c-3'), false);
});
