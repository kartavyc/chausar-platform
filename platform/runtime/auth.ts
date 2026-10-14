import { randomBytes, timingSafeEqual } from 'node:crypto';
import { authorize, audit, check, guardChange, hash, newId, now } from './contracts.ts';
import type { Context, Member, StateStore } from './contracts.ts';

const opaqueToken = () => randomBytes(32).toString('base64url');
const roleRank: Record<Member['role'], number> = { viewer: 0, accountant: 1, cofounder: 2, owner: 3 };
const withinBranches = (issuer: Member, branches: string[]) => issuer.branches.includes('*') || branches.every(branch => issuer.branches.includes(branch));
function sessionAuthority(issuer: Member, target: Member) {
  if (issuer.id === target.id) return;
  check(issuer.role === 'owner', 'FORBIDDEN', 'Only a current owner can issue another member session.');
  check(roleRank[target.role] <= roleRank[issuer.role] && withinBranches(issuer, target.branches), 'SESSION_SCOPE_FORBIDDEN', 'A session cannot grant authority outside its issuing owner scope.');
}
function tokenHash(value: unknown): string { check(typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value), 'INVALID_SESSION', 'Supply a valid session token.'); return hash(value); }
function sameHash(left: string, right: string): boolean { return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right)); }

/** Tokens are returned once to the intended recipient; authority snapshots contain only hashes. */
export class AuthService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  async invite(context: Context, input: { name: string; role: Member['role']; branches?: string[]; ttlMs?: number }) {
    const issuer = authorize(this.store, context, 'admin');
    check(['owner', 'cofounder', 'accountant', 'viewer'].includes(input.role), 'INVALID_ROLE', 'Choose an existing workspace role.');
    check(roleRank[input.role] <= roleRank[issuer.role], 'INVITE_ROLE_FORBIDDEN', 'An invitation cannot grant a stronger role than its issuer.');
    check(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200, 'INVALID_MEMBER', 'An invite needs a member name.');
    check(!input.branches || (Array.isArray(input.branches) && input.branches.length > 0 && input.branches.every(s => typeof s === 'string' && s.length > 0)), 'INVALID_MEMBER', 'An invite needs named branch grants.');
    check(withinBranches(issuer, input.branches || ['*']), 'INVITE_SCOPE_DENIED', 'An invitation cannot grant branches outside the issuing administrator scope.');
    const ttlMs = input.ttlMs ?? 3600000; check(Number.isSafeInteger(ttlMs) && ttlMs >= 60000 && ttlMs <= 86400000, 'INVALID_INVITE', 'Invitation expiry must be between one minute and one day.');
    const token = opaqueToken(); const digest = tokenHash(token);
    const invitation = await this.store.update(state => { const currentIssuer = authorize(this.store, context, 'admin');
      check(roleRank[input.role] <= roleRank[currentIssuer.role] && withinBranches(currentIssuer, input.branches || ['*']), 'INVITE_SCOPE_DENIED', 'The issuing administrator authority changed.'); guardChange(state, context, { kind: 'invite', role: input.role });
      const invite = { id: newId('invite'), kind: 'member-invite', tokenHash: digest, issuerId: context.memberId, issuerEpoch: context.epoch,
      name: input.name.trim(), role: input.role, branches: input.branches || ['*'], createdAt: now(), expiresAt: new Date(Date.now() + ttlMs).toISOString(), consumed: false }; state.sessions.push(invite); audit(state, 'auth.invitation.created', { inviteId: invite.id, role: input.role }); return invite; });
    const { tokenHash: _, ...publicInvite } = invitation; return { ...publicInvite, token };
  }
  async accept(token: string) {
    const digest = tokenHash(token); const sessionToken = opaqueToken();
    return this.store.update(state => {
      const invitation = state.sessions.find(s => s.kind === 'member-invite' && typeof s.tokenHash === 'string' && sameHash(s.tokenHash, digest));
      const issuer = state.members.find(m => m.id === invitation?.issuerId);
      check(invitation && !invitation.consumed && !invitation.revoked && Date.parse(invitation.expiresAt) > Date.now() && issuer?.active && issuer.epoch === invitation.issuerEpoch && ['owner', 'cofounder'].includes(issuer.role) && roleRank[invitation.role as Member['role']] <= roleRank[issuer.role] && withinBranches(issuer, invitation.branches), 'INVITE_EXPIRED', 'This invitation expired, was consumed, or its issuer lost access.');
      invitation.consumed = true; delete invitation.tokenHash;
      const member = { id: newId('member'), name: invitation.name, role: invitation.role, branches: invitation.branches, active: true, epoch: 1 }; state.members.push(member);
      const session = { id: newId('session'), kind: 'member-session', memberId: member.id, epoch: member.epoch, role: member.role, tokenHash: tokenHash(sessionToken), createdAt: now(), expiresAt: new Date(Date.now() + 86400000).toISOString() }; state.sessions.push(session);
      audit(state, 'auth.invitation.accepted', { invitationId: invitation.id, memberId: member.id }); return { token: sessionToken, sessionId: session.id, member: structuredClone(member), context: { memberId: member.id, role: member.role, epoch: member.epoch } as Context };
    });
  }
  /** `scope: 'mcp'` issues a session that only the numbers server (`/mcp`) accepts. */
  async issueSession(context: Context, memberId = context.memberId, ttlMs = 86400000, options: { scope?: 'mcp' } = {}) {
    check(options.scope === undefined || options.scope === 'mcp', 'INVALID_SESSION', 'Unknown session scope.');
    const issuer = authorize(this.store, context, memberId === context.memberId ? 'read' : 'admin');
    if (memberId !== issuer.id) check(issuer.role === 'owner', 'FORBIDDEN', 'Only a current owner can issue another member session.');
    check(Number.isSafeInteger(ttlMs) && ttlMs >= 60000 && ttlMs <= 86400000, 'INVALID_SESSION', 'Session expiry must be between one minute and one day.'); const token = opaqueToken();
    return this.store.update(state => {
      const currentIssuer = authorize(this.store, context, memberId === context.memberId ? 'read' : 'admin'); const member = state.members.find(m => m.id === memberId); check(member?.active, 'ACCESS_REVOKED', 'The selected member has no access.'); sessionAuthority(currentIssuer, member);
      const session = { id: newId('session'), kind: 'member-session', memberId: member.id, role: member.role, epoch: member.epoch, tokenHash: tokenHash(token), createdAt: now(), expiresAt: new Date(Date.now() + ttlMs).toISOString(), ...(options.scope ? { scope: options.scope } : {}) }; state.sessions.push(session);
      audit(state, 'auth.session.issued', { sessionId: session.id, memberId }); return { token, sessionId: session.id, expiresAt: session.expiresAt };
    });
  }
  authenticate(token: string, channel: Context['channel'] = 'desktop'): Context {
    const digest = tokenHash(token); const state = this.store.read(); const session = state.sessions.find(s => s.kind === 'member-session' && typeof s.tokenHash === 'string' && sameHash(s.tokenHash, digest));
    check(session && !session.revoked && Date.parse(session.expiresAt) > Date.now(), 'INVALID_SESSION', 'The session expired or was revoked.');
    check(session.scope === undefined || session.scope === channel, 'SESSION_SCOPE_FORBIDDEN', 'This session works only on the numbers server.');
    const context: Context = { memberId: session.memberId, role: session.role, epoch: session.epoch, channel }; authorize(this.store, context); return context;
  }
  async revokeSession(context: Context, sessionId: string) {
    authorize(this.store, context); return this.store.update(state => { authorize(this.store, context); const session = state.sessions.find(s => s.id === sessionId && s.kind === 'member-session'); check(session, 'INVALID_SESSION', 'Session was not found.');
      if (session.memberId !== context.memberId) authorize(this.store, context, 'admin'); session.revoked = true; delete session.tokenHash; audit(state, 'auth.session.revoked', { sessionId }); return { sessionId, revoked: true }; });
  }
  async revokeInvite(context: Context, inviteId: string) {
    authorize(this.store, context, 'admin'); return this.store.update(state => { authorize(this.store, context, 'admin'); const invitation = state.sessions.find(s => s.id === inviteId && s.kind === 'member-invite'); check(invitation, 'INVITE_EXPIRED', 'Invitation was not found.'); invitation.revoked = true; delete invitation.tokenHash; audit(state, 'auth.invitation.revoked', { inviteId }); return { inviteId, revoked: true }; });
  }
  sessions(context: Context) { const member = authorize(this.store, context); return this.store.read().sessions.filter(s => (s.kind === 'member-invite' || s.kind === 'member-session') && (['owner', 'cofounder'].includes(member.role) || s.memberId === member.id)).map(({ tokenHash: _, ...metadata }) => metadata); }
}
