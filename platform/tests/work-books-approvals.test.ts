import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, check, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import type { Connector, Operation } from '../runtime/actions.ts';
import { JobService } from '../runtime/jobs.ts';
import { OntologyService } from '../runtime/ontology.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods, workPurge } from '../runtime/work-books/work.ts';
import { section } from '../runtime/work-books/state.ts';

class TestStore implements StateStore {
  state: State;
  constructor() { this.state = initialState('Synthetic hardware shop', true); }
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>) { const copy = structuredClone(this.state); const result = await change(copy); copy.revision++; this.state = copy; return result; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };

type Fixture = Awaited<ReturnType<typeof fixture>>;
async function fixture(options: { writeback?: Record<string, (payload: any) => unknown> } = {}) {
  const store = new TestStore();
  store.state.members.push({ id: 'viewer', name: 'Vee Viewer', role: 'viewer', active: true, epoch: 1, branches: ['*'] }, { id: 'accountant', name: 'Asha Accountant', role: 'accountant', active: true, epoch: 1, branches: ['*'] });
  const sent = new Map<string, unknown>(); const fake = { lose: false, executions: 0 };
  const op = (impact: Operation['impact'], title: string): Operation => ({
    title, description: `${title} in the synthetic books app.`, impact, idempotency: 'The key names one record.', readback: 'Reads the record by key.',
    validate: payload => { check(payload !== null && typeof payload === 'object' && !Array.isArray(payload), 'INVALID_ACTION', 'Send an object.'); return payload as Record<string, unknown>; },
    execute: async (payload, key) => { fake.executions += 1; sent.set(key, payload); if (fake.lose) throw new Error('connection lost'); return { externalId: key }; },
    reconcile: async (payload, key) => { const found = sent.get(key); return { verified: found !== undefined, businessSuccess: found !== undefined, data: found, absent: found === undefined }; },
  });
  const connector: Connector = { id: 'books-app', title: 'Synthetic books app', operations: { note: op('reversible', 'Add a note to a customer'), unnote: op('reversible', 'Remove a note'), remind: op('message', 'Send a payment reminder'), pay: op('money', 'Pay a supplier'), voucher: op('reversible', 'Prepare a sales voucher') } };
  const actions = new ActionService(store, [connector]); const jobs = new JobService(store); const ontology = new OntologyService(store);
  const clock = { offset: 0 }; const calls: { method: string; payload: any }[] = []; const services: Record<string, any> = { actions, jobs, ontology };
  const host = (ctx: Context): ModuleHost => ({
    store, services, demo: true, directory: '/tmp/x', options: { clock: () => Date.now() + clock.offset },
    async call(method, payload) {
      calls.push({ method, payload });
      if (method === 'jobs.approve') return jobs.approve(ctx, payload.id as string, payload.digest as string);
      if (method === 'jobs.accept') return jobs.accept(ctx, payload.id as string);
      if (method === 'jobs.cancel') return jobs.cancel(ctx, payload.id as string);
      if (method === 'books.publish' || method === 'books.discard') return store.update(state => {
        const draft = section<{ drafts: any[] }>(state, 'books', () => ({ drafts: [] })).drafts.find(d => d.id === payload.draftId);
        check(draft, 'NOT_FOUND', 'Draft not found.');
        if (method === 'books.discard') { draft.state = 'discarded'; return { draftId: draft.id, state: 'discarded' }; }
        check(draft.digest === payload.digest, 'PREVIEW_CHANGED', 'Changed.'); draft.state = 'published'; return { version: 3, hash: 'h', staleAnswers: 0 };
      });
      if (method === 'memory.decideLesson') return { ok: true };
      const writeback = options.writeback?.[method]; if (writeback) return writeback(payload);
      throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.');
    },
  });
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host(ctx));
  };
  const prepare = (operation: string, payload: Record<string, unknown>, key = `key-${operation}-${Math.random()}`) => actions.prepare(owner, { connector: 'books-app', operation, payload, idempotencyKey: key, sourceIds: ['sheet'] });
  return { store, actions, jobs, services, clock, calls, fake, request, prepare };
}
const age = (f: Fixture, id: string, ms: number) => f.store.update(state => { const a = state.actions.find(x => x.id === id); a.createdAt = new Date(Date.parse(a.createdAt) - ms).toISOString(); });

test('the queue orders tier-2 first, then tier-1, then prepare-only, newest first inside a tier', async () => {
  const f = await fixture({ writeback: { 'writeback.catalogue': () => ({ rows: [{ system: 'books-app', action: 'voucher', title: 'Prepare a sales voucher', kind: 'inside-undoable', status: 'prepare-only' }] }) } });
  const note = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' });
  const remind = await f.prepare('remind', { to: 'customer-a', text: 'Your invoice is due.' });
  const voucher = await f.prepare('voucher', { voucher: { type: 'Sales', number: null, date: '2026-10-01', lines: [{ ledger: 'Sales', creditMinor: '10000' }, { ledger: 'Customer A', debitMinor: '10000' }] } });
  const pay = await f.prepare('pay', { supplierId: 'supplier-b', amountMinor: '250000' });
  const note2 = await f.prepare('note', { customerId: 'customer-b', text: 'Call after 5' });
  await age(f, note.id, 60000); await age(f, remind.id, 60000);
  const list = await f.request(owner, 'approvals.list');
  assert.deepEqual(list.items.map((i: any) => i.id), [`action:${pay.id}`, `action:${remind.id}`, `action:${note2.id}`, `action:${note.id}`, `action:${voucher.id}`]);
  assert.deepEqual(list.items.map((i: any) => i.tier), ['tier-2', 'tier-2', 'tier-1', 'tier-1', 'prepare-only']);
  assert.deepEqual(list.items.map((i: any) => i.kind), ['money', 'message', 'record-change', 'record-change', 'prepare-only']);
  assert.deepEqual(list.counts, { tier2: 2, tier1: 2, prepareOnly: 1 });
  assert.deepEqual(list.items[0].amount, { minor: '250000' });
  assert.equal(list.items[0].touches, 'Synthetic books app: supplier-b');
  assert.deepEqual(list.items[0].preparedBy, { kind: 'person', name: 'Workspace owner' });
  assert.equal(list.items[3].amount, null);
  const sheet = await f.request(owner, 'approvals.get', { id: `action:${voucher.id}` });
  assert.equal(sheet.prepareOnly, true); assert.equal(sheet.can.includes('approve'), false);
  assert.deepEqual(sheet.voucher, { type: 'Sales', number: null, date: '2026-10-01', note: 'prepare-only', lines: [{ ledger: 'Sales', debit: null, credit: { minor: '10000' } }, { ledger: 'Customer A', debit: { minor: '10000' }, credit: null }] });
  await assert.rejects(f.request(owner, 'approvals.approve', { id: `action:${voucher.id}`, digest: sheet.digest }), code('PREPARE_ONLY'));
  const message = await f.request(owner, 'approvals.get', { id: `action:${remind.id}` });
  assert.equal(message.change.asWritten, 'Your invoice is due.'); assert.equal(message.reason, 'always-waits:message');
  assert.equal(Date.parse(message.expiresAt) - Date.parse(message.createdAt), 24 * 3600000);
  assert.equal(Date.parse(list.items[2].expiresAt) - Date.parse(list.items[2].createdAt), 7 * 24 * 3600000);
  assert.deepEqual(message.steps.map((s: any) => [s.name, s.state]), [['prepared', 'done'], ['approved', 'waiting-for-you'], ['done', 'not-reached'], ['read-back', 'not-reached'], ['recorded', 'not-reached']]);
});

test('approval refuses a changed digest, an expired item and money without the second ask', async () => {
  const f = await fixture();
  const pay = await f.prepare('pay', { supplierId: 'supplier-b', amountMinor: '250000' });
  const id = `action:${pay.id}`; const sheet = await f.request(owner, 'approvals.get', { id });
  assert.equal(sheet.needsSecondAsk, true); assert.equal(sheet.reason, 'always-waits:money');
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest }), code('SECOND_ASK_REQUIRED'));
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: 'f'.repeat(64), secondAsk: true }), code('PREVIEW_CHANGED'));
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: false }), code('INVALID_APPROVAL'));
  const changed = await f.request(owner, 'approvals.change', { id, payload: { supplierId: 'supplier-b', amountMinor: '240000' } });
  assert.equal(changed.revision, 2); assert.notEqual(changed.digest, sheet.digest); assert.deepEqual(changed.blocked, { kind: 'changed', code: 'PREPARED_AGAIN' });
  await assert.rejects(f.request(owner, 'approvals.approve', { id, digest: sheet.digest, secondAsk: true }), code('PREVIEW_CHANGED'));
  const approved = await f.request(owner, 'approvals.approve', { id, digest: changed.digest, secondAsk: true });
  assert.equal(approved.state, 'approved'); assert.equal(approved.steps[1].state, 'done'); assert.equal(approved.steps[2].state, 'waiting-for-you');

  const remind = await f.prepare('remind', { to: 'customer-a', text: 'Due today.' });
  const rid = `action:${remind.id}`; const rsheet = await f.request(owner, 'approvals.get', { id: rid });
  f.clock.offset = 25 * 3600000;
  const list = await f.request(owner, 'approvals.list');
  assert.deepEqual(list.expired.map((i: any) => i.id), [rid]); assert.equal(list.items.some((i: any) => i.id === rid), false);
  const expiredSheet = await f.request(owner, 'approvals.get', { id: rid });
  assert.deepEqual(expiredSheet.blocked, { kind: 'expired', code: 'APPROVAL_EXPIRED' }); assert.deepEqual(expiredSheet.can, ['change', 'drop']);
  assert.equal(expiredSheet.steps[1].state, 'stopped-by-rule');
  await assert.rejects(f.request(owner, 'approvals.approve', { id: rid, digest: rsheet.digest }), code('APPROVAL_EXPIRED'));
  // Preparing it again restarts the clock.
  const again = await f.request(owner, 'approvals.change', { id: rid, payload: { to: 'customer-a', text: 'Due today, again.' } });
  assert.equal(again.blocked.kind, 'changed'); assert.ok(again.can.includes('approve'));
  assert.equal((await f.request(owner, 'approvals.approve', { id: rid, digest: again.digest })).state, 'approved');
  assert.equal((await f.request(owner, 'approvals.action', { id: rid })).channel, 'desktop');
});

test('viewer and accountant seats read the queue but cannot approve', async () => {
  const f = await fixture();
  const note = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' }); const id = `action:${note.id}`;
  const asViewer = await f.request(viewer, 'approvals.get', { id });
  assert.equal(asViewer.readOnly, true); assert.deepEqual(asViewer.can, []); assert.equal(asViewer.blocked, undefined);
  const asAccountant = await f.request(accountant, 'approvals.get', { id });
  assert.equal(asAccountant.readOnly, true); assert.deepEqual(asAccountant.blocked, { kind: 'owner-approves', code: 'OWNER_APPROVES' });
  assert.equal((await f.request(viewer, 'approvals.list')).items.length, 1);
  await assert.rejects(f.request(viewer, 'approvals.approve', { id, digest: note.digest }), code('FORBIDDEN'));
  await assert.rejects(f.request(accountant, 'approvals.approve', { id, digest: note.digest }), code('FORBIDDEN'));
  await assert.rejects(f.request(viewer, 'approvals.drop', { id }), code('FORBIDDEN'));
  await assert.rejects(f.request(viewer, 'approvals.change', { id, payload: {} }), code('FORBIDDEN'));
  assert.equal((await f.request(owner, 'approvals.get', { id })).readOnly, false);
});

test('not now hides an item for the caller until the snooze ends; drop cancels it', async () => {
  const f = await fixture();
  const note = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' }); const id = `action:${note.id}`;
  await assert.rejects(f.request(owner, 'approvals.notNow', { id, hours: 0 }), code('INVALID_APPROVAL'));
  await assert.rejects(f.request(owner, 'approvals.notNow', { id, hours: 169 }), code('INVALID_APPROVAL'));
  const snooze = await f.request(owner, 'approvals.notNow', { id, hours: 2 });
  assert.equal(snooze.id, id); assert.ok(Date.parse(snooze.snoozedUntil) > Date.now() + 3600000);
  let list = await f.request(owner, 'approvals.list');
  assert.equal(list.items.length, 0); assert.equal(list.snoozed, 1);
  assert.equal((await f.request(viewer, 'approvals.list')).items.length, 1, 'a snooze is per person');
  assert.equal((await f.request(owner, 'approvals.get', { id })).snoozedUntil, snooze.snoozedUntil);
  f.clock.offset = 3 * 3600000;
  list = await f.request(owner, 'approvals.list'); assert.equal(list.items.length, 1); assert.equal(list.snoozed, 0);
  assert.deepEqual(await f.request(owner, 'approvals.drop', { id }), { id, state: 'cancelled' });
  assert.equal((await f.request(owner, 'approvals.list')).items.length, 0);
  assert.equal(f.store.read().actions[0].status, 'cancelled');
  await assert.rejects(f.request(owner, 'approvals.get', { id: 'action:missing' }), code('NOT_FOUND'));
  await assert.rejects(f.request(owner, 'approvals.get', { id: 'nothing' }), code('INVALID_APPROVAL'));
  await assert.rejects(f.request(owner, 'approvals.get', { id, extra: 1 }), code('INVALID_APPROVAL'));
});

test('groups take only undoable items and approve one by one, with results per item and a pace warning', async () => {
  const f = await fixture();
  const notes = [];
  for (const customer of ['a', 'b', 'c', 'd']) notes.push(await f.prepare('note', { customerId: `customer-${customer}`, text: 'Matched to bank' }));
  const remind = await f.prepare('remind', { to: 'customer-a', text: 'Due.' });
  await assert.rejects(f.request(owner, 'approvals.group', { ids: [`action:${notes[0].id}`, `action:${remind.id}`] }), code('GROUP_NOT_ALLOWED'));
  await assert.rejects(f.request(owner, 'approvals.group', { ids: [`action:${notes[0].id}`] }), code('INVALID_APPROVAL'));
  const group = await f.request(owner, 'approvals.group', { ids: notes.map(n => `action:${n.id}`) });
  assert.equal(group.undoable, true); assert.equal(group.items.length, 4); assert.match(group.title, /^4 /);
  const result = await f.request(owner, 'approvals.approveGroup', { items: [
    ...group.items.slice(0, 3).map((i: any) => ({ id: i.id, digest: i.digest })),
    { id: group.items[3].id, digest: 'a'.repeat(64) },
    { id: `action:${remind.id}`, digest: remind.digest },
  ] });
  assert.deepEqual(result.results.map((r: any) => [r.ok, r.code ?? r.state]), [[true, 'approved'], [true, 'approved'], [true, 'approved'], [false, 'PREVIEW_CHANGED'], [false, 'GROUP_NOT_ALLOWED']]);
  assert.equal(f.store.read().actions.find(a => a.id === remind.id).status, 'prepared');
  const pace = await f.request(owner, 'approvals.pace');
  assert.equal(pace.fastStreak, 2, 'the first approval has nothing to be measured against'); assert.equal(pace.warn, false);
  const fifth = await f.prepare('note', { customerId: 'customer-e', text: 'Matched to bank' });
  await f.request(owner, 'approvals.approve', { id: `action:${fifth.id}`, digest: fifth.digest });
  assert.deepEqual(await f.request(owner, 'approvals.pace'), { fastStreak: 3, warn: true });
  assert.deepEqual(await f.request(viewer, 'approvals.pace'), { fastStreak: 0, warn: false });
  // A slow, read approval resets the streak.
  const sixth = await f.prepare('note', { customerId: 'customer-f', text: 'Matched to bank' });
  f.clock.offset = 5000; await f.request(owner, 'approvals.approve', { id: `action:${sixth.id}`, digest: sixth.digest });
  assert.deepEqual(await f.request(owner, 'approvals.pace'), { fastStreak: 0, warn: false });
});

test('execute is done once; an unsure result is checked by reading back, or attested by the owner without being marked verified', async () => {
  const f = await fixture();
  const remind = await f.prepare('remind', { to: 'customer-a', text: 'Due.' }); const id = `action:${remind.id}`;
  await assert.rejects(f.request(owner, 'approvals.execute', { id }), code('APPROVAL_REQUIRED'));
  await f.request(owner, 'approvals.approve', { id, digest: remind.digest });
  f.fake.lose = true;
  const unsure = await f.request(owner, 'approvals.execute', { id });
  assert.equal(unsure.state, 'unknown'); assert.equal(unsure.steps[2].state, 'unsure'); assert.deepEqual(unsure.can, ['reconcile', 'resolve']);
  assert.equal(f.fake.executions, 1);
  await assert.rejects(f.request(owner, 'approvals.execute', { id }), code('ACTION_ALREADY_ATTEMPTED'));
  assert.equal(f.fake.executions, 1, 'never a second send');
  const detail = await f.request(owner, 'approvals.get', { id });
  assert.deepEqual(detail.blocked, { kind: 'unsure', code: 'OUTCOME_UNKNOWN' }); assert.deepEqual(detail.can, ['reconcile']);
  // While it is unsure, sending stays closed for every other message or payment.
  const restore = await f.request(owner, 'approvals.afterRestore');
  assert.equal(restore.sendingClosed, true); assert.deepEqual(restore.items.map((i: any) => i.id), [id]); assert.ok(restore.notes.length >= 1);
  const other = await f.prepare('remind', { to: 'customer-b', text: 'Due.' });
  await f.request(owner, 'approvals.approve', { id: `action:${other.id}`, digest: other.digest });
  await assert.rejects(f.request(owner, 'approvals.execute', { id: `action:${other.id}` }), code('SENDING_CLOSED'));
  await assert.rejects(f.request(viewer, 'approvals.resolveUnknown', { id, result: 'check' }), code('FORBIDDEN'));
  await assert.rejects(f.request(owner, 'approvals.resolveUnknown', { id, result: 'maybe' }), code('INVALID_APPROVAL'));
  const checked = await f.request(owner, 'approvals.resolveUnknown', { id, result: 'check' });
  assert.equal(checked.state, 'verified'); assert.deepEqual(checked.steps.map((s: any) => s.state), ['done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(checked.readBack, [{ field: 'text', asked: 'Due.', found: 'Due.', same: true }, { field: 'to', asked: 'customer-a', found: 'customer-a', same: true }]);
  assert.equal(checked.approvedBy, 'Workspace owner'); assert.equal(checked.rule, 'always-waits:message'); assert.equal(checked.wouldHaveDone, 'waited');
  assert.equal((await f.request(owner, 'approvals.afterRestore')).sendingClosed, false);
  f.fake.lose = false;
  assert.equal((await f.request(owner, 'approvals.execute', { id: `action:${other.id}` })).state, 'verified');

  const third = await f.prepare('remind', { to: 'customer-c', text: 'Due.' }); const tid = `action:${third.id}`;
  await f.request(owner, 'approvals.approve', { id: tid, digest: third.digest });
  f.fake.lose = true; await f.request(owner, 'approvals.execute', { id: tid });
  const told = await f.request(owner, 'approvals.resolveUnknown', { id: tid, result: 'was-not-sent' });
  assert.equal(told.state, 'unknown', 'what the owner says is recorded, not verified');
  assert.equal(told.attestation.by, 'Workspace owner'); assert.equal(told.attestation.said, 'was-not-sent');
  assert.ok(f.store.read().activity.some(a => a.event === 'action.attested'));
  const ledger = await f.request(owner, 'approvals.ledger');
  assert.deepEqual(new Set(ledger.items.map((i: any) => i.id)), new Set([tid, `action:${other.id}`, id]));
  assert.equal(ledger.items.length, 3); assert.ok(ledger.items.every((i: any, n: number) => n === 0 || Date.parse(ledger.items[n - 1].createdAt) >= Date.parse(i.createdAt)));
});

test('catalogue lists the core rows when writeback is absent; practice and reversal say so', async () => {
  const f = await fixture();
  const cat = await f.request(owner, 'approvals.catalogue');
  assert.deepEqual(cat.writeback, { available: false });
  assert.deepEqual(cat.rows.find((r: any) => r.action === 'pay'), { system: 'books-app', systemTitle: 'Synthetic books app', action: 'pay', title: 'Pay a supplier', kind: 'money', waits: true, status: 'live', source: 'core' });
  assert.equal(cat.rows.find((r: any) => r.action === 'note').waits, false);
  assert.ok(cat.rows.every((r: any) => r.source === 'core'));
  const entry = await f.request(owner, 'approvals.catalogueEntry', { system: 'books-app', action: 'remind' });
  assert.deepEqual(Object.keys(entry).sort(), ['action', 'description', 'expires', 'idempotency', 'kind', 'readBack', 'readStatus', 'retryWindow', 'source', 'status', 'system', 'systemTitle', 'tier', 'title', 'waits'].sort());
  assert.equal(entry.tier, 'tier-2'); assert.equal(entry.idempotency, 'The key names one record.');
  await assert.rejects(f.request(owner, 'approvals.catalogueEntry', { system: 'books-app', action: 'fly' }), code('NOT_FOUND'));
  const note = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' });
  const practice = await f.request(owner, 'approvals.practice', { id: `action:${note.id}` });
  assert.deepEqual(practice, { practice: true, available: false, steps: ['prepared', 'approved', 'done', 'read-back', 'recorded'].map(name => ({ name, state: 'not-reached', at: null })), wouldSend: null, code: 'WRITEBACK_NOT_BUILT' });
  assert.equal(f.fake.executions, 0);
  await f.request(owner, 'approvals.approve', { id: `action:${note.id}`, digest: note.digest });
  await f.request(owner, 'approvals.execute', { id: `action:${note.id}` });
  await assert.rejects(f.request(owner, 'approvals.reverse', { id: `action:${note.id}` }), code('REVERSAL_NOT_AVAILABLE'));
  const wanted = await f.request(owner, 'approvals.wanted', { system: 'Shopify', text: 'Change a product price' });
  assert.match(wanted.id, /^wanted_/);
  assert.deepEqual((await f.request(viewer, 'approvals.wantedList')).items, [{ id: wanted.id, system: 'Shopify', text: 'Change a product price', at: wanted.at, by: 'Workspace owner' }]);
  await assert.rejects(f.request(viewer, 'approvals.wanted', { system: 'Shopify', text: 'Anything' }), code('FORBIDDEN'));
  await assert.rejects(f.request(owner, 'approvals.wanted', { system: '', text: 'Change a price' }), code('INVALID_APPROVAL'));
});

test('writeback catalogue rows merge over core rows, enable reversal and pass practice through', async () => {
  const f = await fixture({ writeback: {
    'writeback.catalogue': () => ({ rows: [
      { system: 'books-app', action: 'note', title: 'Add a note to a customer', kind: 'inside-undoable', status: 'experimental', retryWindow: '24 hours', reversal: 'unnote', readStatus: 'live' },
      { system: 'tally', systemTitle: 'Tally', action: 'voucher', title: 'Enter a voucher', kind: 'cannot-undo', status: 'not-yet' },
      { system: 'broken', action: 'x', title: 'No status' },
    ] }),
    'writeback.practice': () => ({ steps: ['prepared', 'approved', 'done', 'read-back', 'recorded'].map(name => ({ name, state: 'done', at: null })), wouldSend: 'A note on customer-a' }),
  } });
  const cat = await f.request(owner, 'approvals.catalogue');
  assert.equal(cat.writeback.available, true);
  assert.equal(cat.rows.some((r: any) => r.system === 'broken'), false);
  assert.deepEqual(cat.rows.find((r: any) => r.system === 'tally'), { system: 'tally', systemTitle: 'Tally', action: 'voucher', title: 'Enter a voucher', kind: 'cannot-undo', waits: true, status: 'not-yet', source: 'writeback' });
  const note = cat.rows.find((r: any) => r.action === 'note'); assert.equal(note.source, 'writeback'); assert.equal(note.status, 'experimental');
  const entry = await f.request(owner, 'approvals.catalogueEntry', { system: 'books-app', action: 'note' });
  assert.equal(entry.retryWindow, '24 hours'); assert.equal(entry.readStatus, 'live'); assert.equal(entry.idempotency, 'The key names one record.'); assert.equal('reversal' in entry, false);
  const prepared = await f.prepare('note', { customerId: 'customer-a', text: 'Prefers mail' }); const id = `action:${prepared.id}`;
  const practice = await f.request(owner, 'approvals.practice', { id });
  assert.equal(practice.available, true); assert.equal(practice.wouldSend, 'A note on customer-a'); assert.equal(f.fake.executions, 0);
  assert.deepEqual(f.calls.find(c => c.method === 'writeback.practice')?.payload, { actionId: prepared.id, digest: prepared.digest });
  await f.request(owner, 'approvals.approve', { id, digest: prepared.digest });
  await assert.rejects(f.request(owner, 'approvals.reverse', { id }), code('REVERSAL_NOT_AVAILABLE'), 'only a verified action can be reversed');
  const done = await f.request(owner, 'approvals.execute', { id }); assert.deepEqual(done.can, ['reverse']);
  const reversal = await f.request(owner, 'approvals.reverse', { id });
  assert.equal(reversal.state, 'prepared'); assert.equal(reversal.source, 'action'); assert.notEqual(reversal.id, id);
  const action = f.store.read().actions.find(a => `action:${a.id}` === reversal.id);
  assert.equal(action.operation, 'unnote'); assert.equal(action.payload.reverses, prepared.id); assert.notEqual(action.idempotencyKey, prepared.idempotencyKey);
  assert.equal((await f.request(owner, 'approvals.reverse', { id })).id, reversal.id, 'asking twice prepares the same reversal');
});

test('jobs, acceptances, release drafts and lessons share the queue and route to their owners', async () => {
  const f = await fixture();
  const deadline = new Date(Date.now() + 30 * 86400000).toISOString();
  const job = await f.jobs.create(owner, { goal: 'Chase overdue invoices each week', budgetMinor: '50000', stopRule: { maxRuns: 4, deadline }, requiresApproval: true });
  const done = await f.jobs.create(owner, { goal: 'Summarise the week for the owner', budgetMinor: '1000', stopRule: { maxRuns: 1, deadline } });
  await f.store.update(state => { const j = state.jobs.find(x => x.id === done.id); j.status = 'awaiting-acceptance'; j.runs = 1; j.ledger.push({ at: new Date().toISOString(), event: 'delivered', amountMinor: '400' }); j.spentMinor = '400'; });
  await f.store.update(state => { section<{ drafts: any[] }>(state, 'books', () => ({ drafts: [] })).drafts.push(
    { id: 'draft_1', name: 'received', author: 'Workspace owner', createdAt: new Date().toISOString(), state: 'cosigned', before: { label: 'Received', meaning: 'Old' }, after: { label: 'Received', meaning: 'New' }, change: 'Count UPI receipts', affects: { calculations: [], savedAnswers: 0 }, reviews: [], checks: { ok: true, code: null }, digest: 'd'.repeat(64) },
    { id: 'draft_2', name: 'old', author: 'Workspace owner', createdAt: new Date().toISOString(), state: 'published', before: null, after: null, change: 'x', digest: 'e'.repeat(64) },
    { bogus: true }); });
  f.services.lessons = { lessons: () => [
    { candidate: { id: 'lesson_1', revision: 1, digest: 'c'.repeat(64), title: 'model words', proposedAt: new Date().toISOString(), change: { kind: 'reminder-timing', targetId: 'reminder-hour', before: '09', after: '11' } }, status: 'review-ready', review: { id: 'review_1', digest: 'b'.repeat(64) } },
    { candidate: { id: 'lesson_2', revision: 1, digest: 'c'.repeat(64), title: 'x', proposedAt: new Date().toISOString(), change: { kind: 'shortlist-order', targetId: 't', before: 1, after: 2 } }, status: 'proposed' },
  ] };
  const list = await f.request(owner, 'approvals.list');
  const ids = list.items.map((i: any) => i.id).sort();
  assert.deepEqual(ids, [`acceptance:${done.id}`, `job:${job.id}`, 'lesson:lesson_1', 'release:draft_1'].sort());
  const jobItem = list.items.find((i: any) => i.source === 'job');
  assert.equal(jobItem.kind, 'job'); assert.equal(jobItem.tier, 'tier-2'); assert.deepEqual(jobItem.amount, { minor: '50000' });
  const lessonItem = list.items.find((i: any) => i.source === 'lesson'); assert.equal(lessonItem.title, 'Review a learned preference'); assert.equal(lessonItem.tier, 'tier-1');
  const jobSheet = await f.request(owner, 'approvals.get', { id: `job:${job.id}` });
  assert.equal(jobSheet.reason, 'job-approval'); assert.equal(jobSheet.job.goal, 'Chase overdue invoices each week'); assert.equal(jobSheet.job.missedRun, 'run-once-on-wake');
  await assert.rejects(f.request(owner, 'approvals.group', { ids: [`job:${job.id}`, 'lesson:lesson_1'] }), code('GROUP_NOT_ALLOWED'));
  assert.equal((await f.request(owner, 'approvals.approve', { id: `job:${job.id}`, digest: jobSheet.digest })).state, 'approved');
  assert.ok(f.calls.some(c => c.method === 'jobs.approve' && c.payload.id === job.id));
  const release = await f.request(owner, 'approvals.get', { id: 'release:draft_1' });
  assert.equal(release.reason, 'release-cosign'); assert.deepEqual(release.change.fields, [{ name: 'meaning', before: 'Old', after: 'New' }]);
  assert.equal((await f.request(owner, 'approvals.approve', { id: 'release:draft_1', digest: release.digest })).state, 'verified');
  assert.deepEqual(f.calls.find(c => c.method === 'books.publish')?.payload, { draftId: 'draft_1', digest: release.digest });
  const acceptance = await f.request(owner, 'approvals.get', { id: `acceptance:${done.id}` });
  assert.equal(acceptance.reason, 'acceptance'); assert.equal(acceptance.steps[3].state, 'waiting-for-you');
  assert.equal((await f.request(owner, 'approvals.approve', { id: `acceptance:${done.id}`, digest: acceptance.digest })).state, 'verified');
  const lesson = await f.request(owner, 'approvals.get', { id: 'lesson:lesson_1' });
  await f.request(owner, 'approvals.approve', { id: 'lesson:lesson_1', digest: lesson.digest });
  assert.deepEqual(f.calls.find(c => c.method === 'memory.decideLesson')?.payload, { candidate: { id: 'lesson_1', revision: 1, digest: 'c'.repeat(64) }, reviewId: 'review_1', reviewDigest: 'b'.repeat(64), decision: 'approve', reason: 'Approved in the approvals queue.' });
  const jobs = await f.request(owner, 'approvals.jobs');
  assert.equal(jobs.limit, 10); assert.deepEqual(jobs.proposals, { available: false });
  assert.deepEqual(jobs.items.map((j: any) => [j.id, j.state]).sort(), [[job.id, 'scheduled'], [done.id, 'accepted']].sort());
  assert.ok(jobs.items.find((j: any) => j.id === job.id).can.includes('pause'));
  const card = await f.request(owner, 'approvals.job', { id: `acceptance:${done.id}` });
  assert.ok(card.timeline.some((s: any) => s.event === 'delivered' && s.amount.minor === '400')); assert.equal(card.runs, 1);
  const third = await f.jobs.create(owner, { goal: 'Reconcile the bank each night', budgetMinor: '5000', stopRule: { maxRuns: 9, deadline }, requiresApproval: true });
  assert.deepEqual(await f.request(owner, 'approvals.drop', { id: `job:${third.id}` }), { id: `job:${third.id}`, state: 'cancelled' });
  assert.equal(f.store.read().jobs.find(j => j.id === third.id).status, 'cancelled');
});

test('purge removes private notes tied to removed actions and jobs', async () => {
  const f = await fixture();
  const keep = await f.prepare('note', { customerId: 'customer-a', text: 'Keep' });
  const lose = await f.prepare('remind', { to: 'customer-b', text: 'Lose' });
  await f.request(owner, 'approvals.notNow', { id: `action:${keep.id}` });
  await f.request(owner, 'approvals.notNow', { id: `action:${lose.id}` });
  await f.request(owner, 'approvals.get', { id: `action:${lose.id}` });
  await f.request(owner, 'approvals.approve', { id: `action:${lose.id}`, digest: lose.digest });
  await f.request(owner, 'approvals.notNow', { id: `action:${keep.id}` });
  await f.request(owner, 'approvals.wanted', { system: 'Tally', text: 'Enter a voucher' });
  const state = structuredClone(f.store.read());
  const removed = workPurge(state, { sourceIds: ['sheet'], removedIds: new Set([lose.id]), at: new Date().toISOString() });
  assert.equal(removed, 1, 'the approval channel of the removed action');
  const work = (state.extensions!['work-books'] as any).work;
  assert.deepEqual(Object.keys(work.channels), []); assert.deepEqual(Object.keys(work.snoozes.owner), [`action:${keep.id}`]); assert.equal(work.wanted.length, 1);
  state.actions = state.actions.filter(a => a.id !== keep.id);
  assert.equal(workPurge(state, { sourceIds: [], removedIds: new Set(), at: new Date().toISOString() }), 1, 'a note for an action that no longer exists');
  assert.equal(workPurge(initialState('Empty'), { sourceIds: [], removedIds: new Set(), at: new Date().toISOString() }), 0);
});
