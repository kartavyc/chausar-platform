import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, check } from '../runtime/contracts.ts';
import type { Context, State, StateStore } from '../runtime/contracts.ts';
import { ActionService, digest } from '../runtime/actions.ts';
import type { Connector } from '../runtime/actions.ts';
import { PhoneApprovalService } from '../runtime/mcp.ts';

class Store implements StateStore {
  state: State = initialState('Workflow test', true); queue = Promise.resolve();
  read() { return structuredClone(this.state); }
  update<T>(change: (state: State) => T | Promise<T>): Promise<T> { const run = this.queue.then(async () => { const draft = structuredClone(this.state); const result = await change(draft); draft.revision += 1; this.state = draft; return result; }); this.queue = run.then(() => {}, () => {}); return run; }
}
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
const accountant: Context = { memberId: 'accountant', role: 'accountant', epoch: 1 };
function setup(impact: 'reversible' | 'message' | 'money' = 'reversible') {
  const store = new Store(); store.state.members.push({ id: 'accountant', role: 'accountant', active: true, epoch: 1, name: 'Accountant', branches: ['*'] });
  let calls = 0; let disconnected = false; let write = true; let actual: any;
  const connector: Connector = { id: 'fixture', title: 'Deterministic fixture', operations: { create: { title: 'Create fixture', description: 'Persist a fixture record.', impact, idempotency: 'Stable key in provider.', readback: 'Read independently by key.', validate: payload => { check(payload && typeof (payload as any).text === 'string', 'INVALID_PAYLOAD', 'text needed'); return { text: (payload as any).text }; }, authorize: (_state, _context, mode) => { if (mode === 'write') check(write, 'WRITE_REVOKED', 'Write permission revoked.'); }, execute: async (payload, key) => { calls += 1; actual = { externalId: key, data: structuredClone(payload) }; if (disconnected) throw new Error('Connection dropped after commit'); return actual; }, reconcile: async (payload, key) => ({ verified: actual?.externalId === key && digest(actual.data) === digest(payload), businessSuccess: false, data: actual ?? null, absent: !actual }) } } };
  const actions = new ActionService(store, [connector]);
  return { store, actions, calls: () => calls, disconnect: () => { disconnected = true; }, revokeWrite: () => { write = false; } };
}
const prepare = (actions: ActionService, context = owner, key = 'stable-key-1') => actions.prepare(context, { connector: 'fixture', operation: 'create', payload: { text: 'Reminder' }, idempotencyKey: key, sourceIds: ['invoice-source'] });

test('an exact owner-approved action executes once and independently verifies delivery', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest);
  const result = await fixture.actions.execute(owner, action.id); assert.equal(result.status, 'verified'); assert.equal(result.businessSuccess, false); assert.equal(result.attempts.length, 1); assert.equal(fixture.calls(), 1);
  await assert.rejects(fixture.actions.execute(owner, action.id), { code: 'ACTION_ALREADY_ATTEMPTED' }); assert.equal(fixture.calls(), 1);
});
test('concurrent execute requests persist one attempt before the provider runs', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest);
  const attempts = await Promise.allSettled([fixture.actions.execute(owner, action.id), fixture.actions.execute(owner, action.id)]);
  assert.equal(attempts.filter(r => r.status === 'fulfilled').length, 1); assert.equal(fixture.calls(), 1); assert.equal(fixture.store.state.actions[0].attempts.length, 1);
});
test('idempotency binds exact payload and source scope', async () => {
  const fixture = setup(); const first = await prepare(fixture.actions); assert.equal((await prepare(fixture.actions)).id, first.id);
  await assert.rejects(fixture.actions.prepare(owner, { connector: 'fixture', operation: 'create', payload: { text: 'Different' }, sourceIds: ['invoice-source'], idempotencyKey: 'stable-key-1' }), { code: 'IDEMPOTENCY_CONFLICT' });
});
test('revision invalidates approval and payload tampering cannot reuse the preview', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest);
  const revised = await fixture.actions.revise(owner, action.id, { text: 'New exact body' }); assert.equal(revised.status, 'prepared'); assert.equal(revised.approval, undefined);
  await assert.rejects(fixture.actions.approve(owner, revised.id, action.digest), { code: 'PREVIEW_CHANGED' });
  await fixture.actions.approve(owner, revised.id, revised.digest); fixture.store.state.actions[0].payload.text = 'Injected after approval';
  await assert.rejects(fixture.actions.execute(owner, revised.id), { code: 'PREVIEW_CHANGED' }); assert.equal(fixture.calls(), 0);
});
test('accountant can prepare but cannot approve, and imported text cannot approve or execute', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions, accountant);
  await assert.rejects(fixture.actions.approve(accountant, action.id, action.digest), { code: 'FORBIDDEN' });
  await assert.rejects(fixture.actions.approve({ ...owner, sourceTainted: true }, action.id, action.digest), { code: 'TAINTED_APPROVAL' });
  await fixture.actions.approve(owner, action.id, action.digest); await assert.rejects(fixture.actions.execute({ ...owner, sourceTainted: true }, action.id), { code: 'TAINTED_EXECUTION' }); assert.equal(fixture.calls(), 0);
});
test('revoked approver epoch invalidates approval even for another active owner', async () => {
  const fixture = setup(); fixture.store.state.members.push({ id: 'second-owner', name: 'Second owner', active: true, epoch: 1, role: 'owner', branches: ['*'] });
  const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest); fixture.store.state.members[0].epoch += 1;
  await assert.rejects(fixture.actions.execute({ memberId: 'second-owner', role: 'owner', epoch: 1 }, action.id), { code: 'ACCESS_REVOKED' }); assert.equal(fixture.calls(), 0);
});
test('read access does not preserve revoked connector write access', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest); fixture.revokeWrite(); assert.equal(fixture.actions.list(owner).length, 1);
  await assert.rejects(fixture.actions.execute(owner, action.id), { code: 'WRITE_REVOKED' }); assert.equal(fixture.calls(), 0);
});
test('source allow and member/role grants revoke pending actions and cached reads', async () => {
  for (const rule of [{ sourceId: 'invoice-source', allow: false }, { sourceId: 'invoice-source', memberIds: ['accountant'] }, { sourceId: 'invoice-source', roles: ['accountant'] }]) {
    const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest); fixture.store.state.sourceRules = [rule];
    await assert.rejects(fixture.actions.execute(owner, action.id), { code: 'SOURCE_REVOKED' }); assert.equal(fixture.actions.list(owner).length, 0); assert.equal(fixture.calls(), 0);
  }
});
test('ambiguous provider failure stays unknown until readback and never retries the write', async () => {
  const fixture = setup(); fixture.disconnect(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest);
  assert.equal((await fixture.actions.execute(owner, action.id)).status, 'unknown'); await assert.rejects(fixture.actions.execute(owner, action.id), { code: 'ACTION_ALREADY_ATTEMPTED' });
  assert.equal((await fixture.actions.reconcile(owner, action.id)).status, 'verified'); assert.equal(fixture.calls(), 1); assert.equal(fixture.store.state.actions[0].attempts[0].error, 'PROVIDER_OUTCOME_UNKNOWN');
});
test('a malformed readback settles unknown and optional undefined result fields do not strand executing state', async () => {
  const fixture = setup(); const op = fixture.actions.operation('fixture', 'create'); op.reconcile = async () => ({ verified: true, businessSuccess: undefined } as any);
  const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest); const result = await fixture.actions.execute(owner, action.id);
  assert.equal(result.status, 'unknown'); assert.equal(result.attempts[0].error, 'INVALID_PROVIDER_RESULT'); assert.equal(result.businessSuccess, undefined); assert.equal(fixture.calls(), 1);
});
test('opening an exclusively locked vault recovers an interrupted attempt to unknown without repeating it', async () => {
  const fixture = setup(); const action = await prepare(fixture.actions); await fixture.actions.approve(owner, action.id, action.digest);
  fixture.store.state.actions[0].status = 'executing'; fixture.store.state.actions[0].attempts = [{ id: 'persisted-attempt', startedAt: '2026-10-01T00:00:00.000Z', outcome: 'executing' }];
  assert.deepEqual((await fixture.actions.recoverInterrupted(owner)).recovered, [action.id]); assert.equal(fixture.store.state.actions[0].attempts[0].error, 'PROCESS_INTERRUPTED');
  await assert.rejects(fixture.actions.execute(owner, action.id), { code: 'ACTION_ALREADY_ATTEMPTED' }); assert.equal((await fixture.actions.reconcile(owner, action.id)).status, 'rejected'); assert.equal(fixture.calls(), 0);
});
test('phone tokens bind a simple owner message and are consumed once; money is excluded', async () => {
  const fixture = setup('message'); const action = await prepare(fixture.actions); const phone = new PhoneApprovalService(fixture.store, fixture.actions);
  const token = await phone.issue(owner, action.id, action.digest); assert.equal((await phone.approve(token.token)).status, 'approved'); await assert.rejects(phone.approve(token.token), { code: 'INVALID_PHONE_TOKEN' });
  await assert.rejects(fixture.actions.execute({ ...owner, channel: 'phone' }, action.id), { code: 'APP_EXECUTION_REQUIRED' });
  const money = setup('money'); const monetary = await prepare(money.actions); await assert.rejects(new PhoneApprovalService(money.store, money.actions).issue(owner, monetary.id, monetary.digest), { code: 'PHONE_MONEY_FORBIDDEN' });
});
test('empty-source local actions keep reminder text private from other members and all direct mutation paths', async () => {
  const fixture = setup(); const scoped: Context = { memberId: 'scoped-founder', role: 'cofounder', epoch: 1 }; const viewer: Context = { memberId: 'viewer', role: 'viewer', epoch: 1 };
  fixture.store.state.members.push({ id: scoped.memberId, role: scoped.role, active: true, epoch: 1, name: 'Scoped founder', branches: ['Mumbai'] }, { id: viewer.memberId, role: viewer.role, active: true, epoch: 1, name: 'Viewer', branches: ['*'] });
  const action = await fixture.actions.prepare(owner, { connector: 'fixture', operation: 'create', payload: { text: 'Private owner reminder' }, idempotencyKey: 'private-local-key', sourceIds: [] });
  assert.deepEqual(fixture.actions.list(viewer), []); assert.deepEqual(fixture.actions.list(scoped), []);
  await assert.rejects(fixture.actions.revise(scoped, action.id, { text: 'Replace private message' }), { code: 'ACTION_FORBIDDEN' });
  await assert.rejects(fixture.actions.approve(scoped, action.id, action.digest), { code: 'ACTION_FORBIDDEN' });
  await assert.rejects(fixture.actions.prepare(scoped, { connector: 'fixture', operation: 'create', payload: { text: 'Private owner reminder' }, idempotencyKey: 'private-local-key', sourceIds: [] }), { code: 'ACTION_FORBIDDEN' });
  await fixture.actions.approve(owner, action.id, action.digest); await assert.rejects(fixture.actions.execute(scoped, action.id), { code: 'ACTION_FORBIDDEN' });
  fixture.store.state.actions[0].status = 'unknown'; fixture.store.state.actions[0].attempts = [{ id: 'private-attempt', startedAt: '2026-10-01T00:00:00.000Z', outcome: 'unknown' }];
  await assert.rejects(fixture.actions.reconcile(scoped, action.id), { code: 'ACTION_FORBIDDEN' }); assert.equal(fixture.calls(), 0);
});
test('creator access binds its epoch while a currently unrestricted workspace owner can review local actions', async () => {
  const fixture = setup(); const scoped: Context = { memberId: 'scoped-founder', role: 'cofounder', epoch: 1 }; fixture.store.state.members.push({ id: scoped.memberId, role: scoped.role, active: true, epoch: 1, name: 'Scoped founder', branches: ['Mumbai'] });
  const action = await fixture.actions.prepare(scoped, { connector: 'fixture', operation: 'create', payload: { text: 'My own private draft' }, idempotencyKey: 'scoped-local-key', sourceIds: [] }); assert.equal(fixture.actions.list(scoped)[0].id, action.id); assert.equal(fixture.actions.list(owner)[0].id, action.id);
  fixture.store.state.members.find(m => m.id === scoped.memberId)!.epoch += 1; const newer = { ...scoped, epoch: 2 }; assert.deepEqual(fixture.actions.list(newer), []); await assert.rejects(fixture.actions.revise(newer, action.id, { text: 'Replay old epoch' }), { code: 'ACTION_FORBIDDEN' });
});
