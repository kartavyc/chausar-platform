import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { AuthService } from '../runtime/auth.ts';
import { TrustService } from '../runtime/trust.ts';
class MemoryStore implements StateStore { state: State = initialState('Auth'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;

test('a session is kept as a hash, never as its token', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const session = await auth.issueSession(owner);
  assert.equal(JSON.stringify(store.state).includes(session.token), false); assert.equal(auth.authenticate(session.token).memberId, 'owner');
  assert.equal(auth.authenticate(session.token, 'phone').channel, 'phone');
});
test('member revocation invalidates an already-issued token immediately', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const trust = new TrustService(store); const member = await trust.addMember(owner, { name: 'Partner', role: 'cofounder' }); const session = await auth.issueSession(owner, member.id);
  assert.equal(auth.authenticate(session.token).memberId, member.id); await trust.revokeMember(owner, member.id); assert.throws(() => auth.authenticate(session.token), code('INVALID_SESSION'));
});
test('revoked and expired session tokens are denied', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const first = await auth.issueSession(owner); await auth.revokeSession(owner, first.sessionId); assert.throws(() => auth.authenticate(first.token), code('INVALID_SESSION'));
  const second = await auth.issueSession(owner); store.state.sessions.find(s => s.id === second.sessionId).expiresAt = '2000-01-01T00:00:00.000Z'; assert.throws(() => auth.authenticate(second.token), code('INVALID_SESSION'));
});

test('scoped cofounders cannot mint owner or other-member tokens', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store);
  store.state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: ['main'] }, { id: 'west', name: 'West viewer', role: 'viewer', active: true, epoch: 1, branches: ['west'] });
  const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1 };
  await assert.rejects(auth.issueSession(partner, 'owner'), code('FORBIDDEN'));
  await assert.rejects(auth.issueSession(partner, 'west'), code('FORBIDDEN'));
  const session = await auth.issueSession(partner); assert.equal(auth.authenticate(session.token).role, 'cofounder');
  assert.equal(store.state.sessions.filter(s => s.kind === 'member-session').length, 1);
});

test('even owners cannot mint sessions outside their current branch ceiling', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store);
  store.state.members.push({ id: 'local', name: 'Local viewer', role: 'viewer', active: true, epoch: 1, branches: ['main'] }, { id: 'west', name: 'West viewer', role: 'viewer', active: true, epoch: 1, branches: ['west'] });
  store.state.members[0].branches = ['main'];
  await assert.rejects(auth.issueSession(owner, 'west'), code('SESSION_SCOPE_FORBIDDEN'));
  const session = await auth.issueSession(owner, 'local'); assert.equal(auth.authenticate(session.token).memberId, 'local');
});

test('direct member creation enforces the role and branch ceiling', async () => {
  const store = new MemoryStore(); const trust = new TrustService(store);
  store.state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: ['main'] });
  const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1 };
  await assert.rejects(trust.addMember(partner, { name: 'Owner escalation', role: 'owner', branches: ['main'] }), code('MEMBER_ROLE_FORBIDDEN'));
  for (const branches of [['west'], ['*']]) await assert.rejects(trust.addMember(partner, { name: 'Branch escalation', role: 'viewer', branches }), code('MEMBER_SCOPE_FORBIDDEN'));
  await assert.rejects(trust.addMember(partner, { name: 'Implicit broad escalation', role: 'viewer' }), code('MEMBER_SCOPE_FORBIDDEN'));
  const allowed = await trust.addMember(partner, { name: 'Same branch viewer', role: 'viewer', branches: ['main'] }); assert.deepEqual(allowed.branches, ['main']);
  store.state.members[0].branches = ['main'];
  await assert.rejects(trust.addMember(owner, { name: 'Scoped owner escalation', role: 'viewer', branches: ['west'] }), code('MEMBER_SCOPE_FORBIDDEN'));
});
