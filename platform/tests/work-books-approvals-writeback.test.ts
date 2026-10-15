import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, ChausarError, initialState } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService } from '../runtime/actions.ts';
import type { ModuleHost } from '../runtime/modules/types.ts';
import { workMethods } from '../runtime/work-books/work.ts';
import { exportName } from '../runtime/work-books/work-writeback-export.ts';

// A stubbed write-back dispatcher: views in the shape docs/lanes/writeback.md documents, synthetic values.
class TestStore implements StateStore {
  state: State = initialState('Synthetic writeback shop', true);
  read() { return this.state; }
  async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const copy = structuredClone(this.state); const out = await change(copy); copy.revision++; this.state = copy; return out; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const cofounder: Context = { memberId: 'cofounder', role: 'cofounder', epoch: 1, channel: 'desktop' };
const code = (expected: string) => (error: any) => { assert.equal(error?.code, expected); return true; };
const NAMES = ['prepared', 'approved', 'done', 'read-back', 'recorded'];

function view(id: string, o: Record<string, any> = {}) {
  const status = o.status ?? 'prepared';
  const states = o.steps ?? (status === 'prepared' ? ['done', 'current', 'waiting', 'waiting', 'waiting'] : status === 'approved' ? ['done', 'done', 'waiting', 'waiting', 'waiting']
    : status === 'unknown' ? ['done', 'done', 'unknown', 'unknown', 'waiting'] : ['done', 'done', 'done', 'done', 'done']);
  return {
    id, system: o.system ?? 'razorpay', action: o.action ?? 'paymentLink.create', title: o.title ?? 'Create a Razorpay payment link', digest: o.digest ?? `digest-${id}-1`, revision: o.revision ?? 1, status,
    word: 'waiting-for-you', connection: { id: 'connection-1', label: 'Practice Razorpay', environment: 'practice', removed: false }, practice: true,
    kind: o.kind ?? 'money', tier: o.tier ?? 2, alwaysWaits: o.alwaysWaits ?? true, preview: {}, target: { label: o.target ?? 'Customer A', ref: null },
    steps: NAMES.map((name, i) => ({ name, state: states[i], turn: i === 1 ? 'person' : 'chausar', ...(states[i] === 'done' ? { at: '2026-10-14T05:00:00.000Z' } : {}) })),
    expiresAt: o.expiresAt ?? '2099-01-01T00:00:00.000Z', readBack: o.readBack ?? null, businessSuccess: null, externalId: null, notices: o.notices ?? [],
    approval: {
      approvalId: id, kind: o.kind === 'seen-outside' ? 'message' : 'money', practice: true, what: 'writeback.x', target: { label: 'Customer A' },
      waitsBecause: { ruleId: 'always-waits', text: 'Money always waits for a person.' }, change: o.change ?? { fields: [{ name: 'amount', before: '', after: '₹500.00' }] },
      steps: [], tier: o.tier ?? 2, cancels: [], expiresAt: null, preparedBy: { kind: 'person', name: 'owner' }, needsSecondAsk: o.needsSecondAsk ?? true,
      can: status === 'prepared' ? ['approve', 'notNow', 'change', 'drop'] : status === 'approved' ? ['change', 'drop'] : [], ...(o.reauth ? { reauth: o.reauth } : {}),
    },
  };
}

function fixture(views: any[], extra: Record<string, (payload: any) => unknown> = {}) {
  const store = new TestStore();
  store.state.members.push({ id: 'cofounder', name: 'Cora Cofounder', role: 'cofounder', active: true, epoch: 1, branches: ['*'] });
  // The stored envelopes the views stand for (write-back keeps them in the shared actions journal).
  for (const v of views) store.state.actions.push({ id: v.id, connector: `wb-${v.system}`, operation: v.action, payload: { system: v.system, action: v.action, payload: v.payload ?? { amountMinor: '50000' }, ...(v.evidence ? { evidence: v.evidence } : {}) },
    sourceIds: [], idempotencyKey: `wb-${v.id}`, digest: v.digest, revision: 1, createdBy: 'owner', createdEpoch: 1, createdAt: '2026-10-14T05:00:00.000Z', impact: 'money', status: v.status, attempts: [] } as any);
  const calls: { method: string; payload: any }[] = [];
  const actions = new ActionService(store, []);
  const handlers: Record<string, (payload: any) => unknown> = {
    'writeback.ledger': () => views,
    'writeback.catalogue': () => [],
    ...extra,
  };
  const host: ModuleHost = {
    store, services: { actions }, demo: true, directory: '/nonexistent', options: {},
    async call(method, payload) { calls.push({ method, payload }); const h = handlers[method]; if (!h) throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); return h(payload); },
  };
  const request = async (ctx: Context, method: string, payload: Record<string, unknown> = {}): Promise<any> => {
    const spec = workMethods[method]; assert.ok(spec, method); authorize(store, ctx, spec.permission); return spec.handler(ctx, payload, host);
  };
  return { store, calls, request, handlers };
}

test('money from write-back joins the queue as tier 2 with its amount, asks a second time, and approves the exact digest', async () => {
  const v = view('action_pay');
  const f = fixture([v], { 'writeback.reauth': () => ({ token: 'a'.repeat(64), expiresInSeconds: 120 }), 'writeback.approve': p => ({ ...v, status: 'approved', digest: p.digest }) });
  const list = await f.request(owner, 'approvals.list');
  assert.deepEqual(list.items.map((i: any) => [i.id, i.source, i.tier, i.kind]), [['writeback:action_pay', 'writeback', 'tier-2', 'money']]);
  assert.deepEqual(list.items[0].amount, { minor: '50000' }); assert.equal(list.items[0].touches, 'Razorpay: Customer A'); assert.deepEqual(list.items[0].preparedBy, { kind: 'person', name: 'Workspace owner' });
  const sheet = await f.request(owner, 'approvals.get', { id: 'writeback:action_pay' });
  assert.equal(sheet.needsSecondAsk, true); assert.deepEqual(sheet.secondAsk, { by: 'passphrase', whose: 'vault-passphrase' }); assert.equal(sheet.reason, 'always-waits:money');
  assert.equal(sheet.writeback.waitsBecause, 'Money always waits for a person.'); assert.equal(sheet.writeback.connection.label, 'Practice Razorpay');
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'writeback:action_pay', digest: v.digest }), code('SECOND_ASK_REQUIRED'));
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'writeback:action_pay', digest: 'digest-other' , secondAsk: true }), code('PREVIEW_CHANGED'));
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'writeback:action_pay', digest: v.digest, secondAsk: true }), code('REAUTH_REQUIRED'));
  await f.request(owner, 'approvals.approve', { id: 'writeback:action_pay', digest: v.digest, secondAsk: true, reauth: 'synthetic passphrase' });
  assert.deepEqual(f.calls.find(c => c.method === 'writeback.reauth')?.payload, { id: 'action_pay', digest: v.digest, passphrase: 'synthetic passphrase' });
  assert.deepEqual(f.calls.find(c => c.method === 'writeback.approve')?.payload, { id: 'action_pay', digest: v.digest, secondAsk: 'a'.repeat(64) });
  assert.equal(JSON.stringify(f.store.state).includes('synthetic passphrase'), false, 'the passphrase is never stored');
  await assert.rejects(f.request(owner, 'approvals.group', { ids: ['writeback:action_pay', 'writeback:action_pay2'] }), (e: any) => ['GROUP_NOT_ALLOWED', 'NOT_FOUND', 'INVALID_APPROVAL'].includes(e.code));
});

test('the second ask goes through writeback.reauth; its single-use token approves; no passphrase where none is asked', async () => {
  const v = view('action_refund', { reauth: 'passphrase' });
  const f = fixture([v], { 'writeback.reauth': () => ({ token: 'b'.repeat(64), expiresInSeconds: 120 }), 'writeback.approve': () => ({ ...v, status: 'approved' }) });
  const sheet = await f.request(owner, 'approvals.get', { id: 'writeback:action_refund' });
  assert.deepEqual(sheet.secondAsk, { by: 'passphrase', whose: 'vault-passphrase' });
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'writeback:action_refund', digest: v.digest, secondAsk: true }), code('REAUTH_REQUIRED'));
  await f.request(owner, 'approvals.approve', { id: 'writeback:action_refund', digest: v.digest, secondAsk: true, reauth: 'synthetic passphrase' });
  assert.deepEqual(f.calls.find(c => c.method === 'writeback.approve')?.payload, { id: 'action_refund', digest: v.digest, secondAsk: 'b'.repeat(64) });
  assert.equal(JSON.stringify(f.store.state).includes('synthetic passphrase'), false, 'the passphrase is never stored');
  const plain = view('action_mail', { kind: 'seen-outside', needsSecondAsk: false, change: { asWritten: 'Hello' } });
  const g = fixture([plain], { 'writeback.approve': () => ({ ...plain, status: 'approved' }) });
  await assert.rejects(g.request(owner, 'approvals.approve', { id: 'writeback:action_mail', digest: plain.digest, reauth: 'synthetic' }), code('INVALID_APPROVAL'), 'no passphrase is sent unless write-back asks for one');
  const bad = fixture([v], { 'writeback.reauth': () => ({ token: 'not-a-token' }) });
  await assert.rejects(bad.request(owner, 'approvals.approve', { id: 'writeback:action_refund', digest: v.digest, secondAsk: true, reauth: 'x' }), code('INVALID_WRITEBACK_REPLY'));
});

test('an expired yes from write-back refuses APPROVAL_EXPIRED; an expired item leaves the queue', async () => {
  const v = view('action_exp', { kind: 'seen-outside', needsSecondAsk: false, change: { asWritten: 'Hello' } });
  const f = fixture([v], { 'writeback.approve': () => ({ ...v, status: 'prepared', notice: { kind: 'expired' } }) });
  await assert.rejects(f.request(owner, 'approvals.approve', { id: 'writeback:action_exp', digest: v.digest }), code('APPROVAL_EXPIRED'));
  const g = fixture([view('action_old', { expiresAt: '2020-01-01T00:00:00.000Z' })]);
  const list = await g.request(owner, 'approvals.list');
  assert.deepEqual(list.items, []); assert.deepEqual(list.expired.map((i: any) => i.id), ['writeback:action_old']);
  const sheet = await g.request(owner, 'approvals.get', { id: 'writeback:action_old' });
  assert.deepEqual(sheet.blocked, { kind: 'expired', code: 'APPROVAL_EXPIRED' }); assert.equal(sheet.steps[1].state, 'stopped-by-rule');
});

test('not sure: Check reads back, and the two answers settle through write-back as sent or not-sent', async () => {
  const v = view('action_wa', { status: 'unknown', system: 'whatsapp', action: 'template.send', kind: 'seen-outside', needsSecondAsk: false });
  const f = fixture([v], { 'writeback.readBack': () => v, 'writeback.settle': () => v });
  const record = await f.request(owner, 'approvals.action', { id: 'writeback:action_wa' });
  assert.equal(record.state, 'unknown'); assert.deepEqual(record.can, ['reconcile', 'resolve']); assert.equal(record.steps[2].state, 'unsure');
  await f.request(owner, 'approvals.resolveUnknown', { id: 'writeback:action_wa', result: 'check' });
  await f.request(owner, 'approvals.resolveUnknown', { id: 'writeback:action_wa', result: 'was-sent' });
  await f.request(owner, 'approvals.resolveUnknown', { id: 'writeback:action_wa', result: 'was-not-sent' });
  assert.deepEqual(f.calls.filter(c => ['writeback.readBack', 'writeback.settle'].includes(c.method)).map(c => [c.method, c.payload]), [
    ['writeback.readBack', { id: 'action_wa' }], ['writeback.settle', { id: 'action_wa', said: 'sent' }], ['writeback.settle', { id: 'action_wa', said: 'not-sent' }],
  ]);
  // A write-back action that is not sure closes sending for every always-waits action.
  const after = await f.request(owner, 'approvals.afterRestore');
  assert.equal(after.sendingClosed, true); assert.deepEqual(after.items.map((i: any) => i.id), ['writeback:action_wa']);
});

test('execute is gated by sending, carries write-back notices, and after restore lists journalled actions', async () => {
  const sure = view('action_ok', { status: 'approved', kind: 'seen-outside', needsSecondAsk: false, system: 'mail', action: 'smtp.send' });
  const f = fixture([sure], {
    'writeback.execute': () => ({ ...sure, status: 'prepared', notice: { kind: 'prepared-again', message: 'The target changed after you approved. It was prepared again; nothing was sent.' } }),
    'writeback.afterRestore': () => [{ id: 'action_ok', system: 'mail', action: 'smtp.send', message: 'This may already have gone out.' }],
  });
  const out = await f.request(owner, 'approvals.execute', { id: 'writeback:action_ok' });
  assert.deepEqual(out.notice, { kind: 'prepared-again', message: 'The target changed after you approved. It was prepared again; nothing was sent.' });
  assert.deepEqual((f.store.state.extensions?.['work-books'] as any)?.work?.executing, {}, 'the reservation is released');
  const after = await f.request(owner, 'approvals.afterRestore');
  assert.equal(after.sendingClosed, true); assert.deepEqual(after.items.map((i: any) => i.id), ['writeback:action_ok']);
  assert.ok(after.notes.some((n: string) => /already have gone out/.test(n)));
  const blockedBy = view('action_unsure', { status: 'unknown' });
  const g = fixture([sure, blockedBy], { 'writeback.execute': () => sure });
  await assert.rejects(g.request(owner, 'approvals.execute', { id: 'writeback:action_ok' }), code('SENDING_CLOSED'));
});

test('practice maps the write-back run onto the five steps and never sends', async () => {
  const v = view('action_p');
  const f = fixture([v], { 'writeback.practice': p => ({ id: 'practice-1', practice: true, sent: 0, steps: [{ system: 'razorpay', action: 'paymentLink.create', outcome: 'would-be-not-sure', preview: { fields: [{ name: 'amount', before: '', after: '₹500.00' }] }, requests: [{}, {}] }], echo: p }) });
  const out = await f.request(owner, 'approvals.practice', { id: 'writeback:action_p' });
  assert.deepEqual(out.steps.map((s: any) => s.state), ['done', 'done', 'unsure', 'unsure', 'not-reached']);
  assert.equal(out.wouldSend, 'amount:  → ₹500.00'); assert.equal(out.requests, 2); assert.equal(out.outcome, 'would-be-not-sure');
  assert.deepEqual(f.calls.find(c => c.method === 'writeback.practice')?.payload, { actionId: 'action_p' });
});

test('reminder payment notes are for the owner only; prepare refusals become a plain blocked reason', async () => {
  const v = view('action_rem', { system: 'mail', action: 'smtp.send', kind: 'seen-outside', needsSecondAsk: false, change: { asWritten: 'To: a@b.example\n\nInvoice inv-1 has ₹300.00 due.\nYou can pay here: https://pay.example/inv-1' } });
  (v as any).evidence = { kind: 'invoice-follow-up', digest: 'd', detail: { customerId: 'cust-1', invoiceId: 'inv-1', day: '2026-10-14', channel: 'email', outstandingMinor: '30000' } };
  (v as any).payload = { to: ['a@b.example'], subject: 's', body: 'b' };
  const f = fixture([v], {
    'writeback.followUp.consents': () => [{ customerId: 'cust-1', channel: 'whatsapp', answer: 'no', observedOn: '2026-09-01', sourceId: null, recordedBy: 'cofounder', at: '2026-09-01T00:00:00Z' }, { customerId: 'cust-1', channel: 'email', answer: 'yes', observedOn: '2026-10-01', sourceId: null, recordedBy: 'owner', at: '2026-10-01T00:00:00Z' }],
    'writeback.settings': () => ({ reminderCapPerCustomer: 1, reminderCapPerDay: 20 }),
    'writeback.followUp.prepare': () => { throw new ChausarError('FOLLOW_UP_DAILY_CAP', 'Today\'s reminder limit is reached.'); },
  });
  const sheet = await f.request(owner, 'approvals.get', { id: 'writeback:action_rem' });
  assert.equal(sheet.reminder.invoiceLink, 'https://pay.example/inv-1'); assert.deepEqual(sheet.reminder.outstanding, { minor: '30000' });
  assert.equal(sheet.reminder.notes.length, 2); assert.ok(sheet.reminder.notes.every((n: any) => n.notLegalAdvice === true && n.checkedOn === '2026-10-14' && n.text.en && n.text.hi));
  assert.deepEqual(sheet.reminder.agreement, [{ channel: 'email', answer: 'yes', source: 'Told by Workspace owner', on: '2026-10-01' }, { channel: 'whatsapp', answer: 'no', source: 'Told by Cora Cofounder', on: '2026-09-01' }]);
  const other = await f.request(cofounder, 'approvals.get', { id: 'writeback:action_rem' });
  assert.equal(other.reminder.notes, null, 'a cofounder sees the reminder but not the owner notes');
  assert.deepEqual(await f.request(owner, 'approvals.prepareReminder', { connectionId: 'c', customerId: 'cust-1', invoiceId: 'inv-1' }),
    { id: null, blocked: { code: 'FOLLOW_UP_DAILY_CAP', reason: 'The reminder limit for today is reached. The rest wait until tomorrow.' } });
  await assert.rejects(f.request(owner, 'approvals.prepareReminder', { connectionId: 'c', customerId: 'cust-1' }), code('INVALID_APPROVAL'));
});

test('without write-back installed the queue is unchanged and reminders say not built; export names are generated, never taken from outside text', async () => {
  const store = new TestStore(); const actions = new ActionService(store, []);
  const host: ModuleHost = { store, services: { actions }, demo: true, directory: '/nonexistent', options: {}, async call() { throw new ChausarError('UNKNOWN_METHOD', 'Unknown request.'); } };
  const run = (method: string, payload: Record<string, unknown> = {}) => workMethods[method].handler(owner, payload, host) as Promise<any>;
  assert.deepEqual((await run('approvals.list')).items, []);
  assert.deepEqual((await run('approvals.ledger')).items, []);
  await assert.rejects(run('approvals.get', { id: 'writeback:action_x' }), code('NOT_FOUND'));
  await assert.rejects(run('approvals.prepareReminder', { connectionId: 'c', customerId: 'a', invoiceId: 'b' }), code('WRITEBACK_NOT_BUILT'));
  assert.equal(exportName(Date.parse('2026-10-14T05:06:07.890Z'), '../../etc/passwd', 'checklist'), 'chausar-prepared-20261014-050607Z-etcpasswd-checklist.txt');
  assert.equal(exportName(0, '', 'prepared', 2), 'chausar-prepared-19700101-000000Z-item-3-prepared.json');
});
