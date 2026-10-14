import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../runtime/contracts.ts';
import type { State, StateStore, Context } from '../runtime/contracts.ts';
import { AuthService } from '../runtime/auth.ts';
import { TrustService } from '../runtime/trust.ts';
class MemoryStore implements StateStore { state: State = initialState('Auth'); read() { return this.state; } async update<T>(change: (state: State) => T | Promise<T>): Promise<T> { return await change(this.state); } }
const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1 };
const code = (name: string) => (e: any) => e.code === name;

test('one-use invitation creates scoped seat and stores hashes rather than tokens', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const invite = await auth.invite(owner, { name: 'Bookkeeper', role: 'accountant', branches: ['Mumbai'] });
  assert.equal(JSON.stringify(store.state).includes(invite.token), false); const accepted = await auth.accept(invite.token); assert.deepEqual(accepted.member.branches, ['Mumbai']); assert.equal(accepted.member.role, 'accountant');
  assert.equal(JSON.stringify(store.state).includes(accepted.token), false); assert.equal(auth.authenticate(accepted.token).memberId, accepted.member.id); await assert.rejects(auth.accept(invite.token), code('INVITE_EXPIRED'));
});
test('viewer cannot issue invitations and cannot inspect other member sessions', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const invite = await auth.invite(owner, { name: 'Viewer', role: 'viewer' }); const accepted = await auth.accept(invite.token); const ctx = auth.authenticate(accepted.token);
  await assert.rejects(auth.invite(ctx, { name: 'Privileged', role: 'owner' }), code('FORBIDDEN')); const ownerSession = await auth.issueSession(owner); assert.equal(auth.sessions(ctx).some(s => s.id === ownerSession.sessionId), false);
});
test('member revocation invalidates an already-issued token immediately', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const trust = new TrustService(store); const member = await trust.addMember(owner, { name: 'Partner', role: 'accountant' }); const session = await auth.issueSession(owner, member.id);
  assert.equal(auth.authenticate(session.token).memberId, member.id); await trust.revokeMember(owner, member.id); assert.throws(() => auth.authenticate(session.token), code('INVALID_SESSION'));
});
test('invitation issuer epoch change prevents redemption', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const invite = await auth.invite(owner, { name: 'New seat', role: 'viewer' }); store.state.members[0].epoch++;
  await assert.rejects(auth.accept(invite.token), code('INVITE_EXPIRED'));
});
test('revoked and expired session tokens are denied; returned listings omit hashes', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const first = await auth.issueSession(owner); await auth.revokeSession(owner, first.sessionId); assert.throws(() => auth.authenticate(first.token), code('INVALID_SESSION'));
  const second = await auth.issueSession(owner); store.state.sessions.find(s => s.id === second.sessionId).expiresAt = '2000-01-01T00:00:00.000Z'; assert.throws(() => auth.authenticate(second.token), code('INVALID_SESSION'));
  assert.equal(JSON.stringify(auth.sessions(owner)).includes('tokenHash'), false);
});
test('invitation revocation removes its redeemable credential', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store); const invite = await auth.invite(owner, { name: 'Revoked', role: 'viewer' }); await auth.revokeInvite(owner, invite.id); await assert.rejects(auth.accept(invite.token), code('INVITE_EXPIRED'));
});

test('scoped cofounders cannot mint owner or other-member tokens and cannot invite stronger roles', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store);
  store.state.members.push({ id: 'partner', name: 'Partner', role: 'cofounder', active: true, epoch: 1, branches: ['main'] }, { id: 'west', name: 'West viewer', role: 'viewer', active: true, epoch: 1, branches: ['west'] });
  const partner: Context = { memberId: 'partner', role: 'cofounder', epoch: 1 };
  await assert.rejects(auth.issueSession(partner, 'owner'), code('FORBIDDEN'));
  await assert.rejects(auth.issueSession(partner, 'west'), code('FORBIDDEN'));
  await assert.rejects(auth.invite(partner, { name: 'Owner escalation', role: 'owner', branches: ['main'] }), code('INVITE_ROLE_FORBIDDEN'));
  const session = await auth.issueSession(partner); assert.equal(auth.authenticate(session.token).role, 'cofounder');
  assert.equal(store.state.sessions.filter(s => s.kind === 'member-session').length, 1);
});

test('even owners cannot mint sessions or redeem invitations outside their current branch ceiling', async () => {
  const store = new MemoryStore(); const auth = new AuthService(store);
  store.state.members.push({ id: 'local', name: 'Local viewer', role: 'viewer', active: true, epoch: 1, branches: ['main'] }, { id: 'west', name: 'West viewer', role: 'viewer', active: true, epoch: 1, branches: ['west'] });
  const pending = await auth.invite(owner, { name: 'Pending west', role: 'viewer', branches: ['west'] });
  store.state.members[0].branches = ['main'];
  await assert.rejects(auth.issueSession(owner, 'west'), code('SESSION_SCOPE_FORBIDDEN'));
  await assert.rejects(auth.accept(pending.token), code('INVITE_EXPIRED'));
  const session = await auth.issueSession(owner, 'local'); assert.equal(auth.authenticate(session.token).memberId, 'local');
  assert.equal(store.state.sessions.find(s => s.id === pending.id).consumed, false);
});

test('direct member creation enforces the same role and branch ceiling as invitations', async () => {
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
