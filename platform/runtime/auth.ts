import { randomBytes, timingSafeEqual } from 'node:crypto';
import { authorize, audit, check, hash, newId, now } from './contracts.ts';
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
  async issueSession(context: Context, memberId = context.memberId, ttlMs = 86400000) {
    const issuer = authorize(this.store, context, memberId === context.memberId ? 'read' : 'admin');
    if (memberId !== issuer.id) check(issuer.role === 'owner', 'FORBIDDEN', 'Only a current owner can issue another member session.');
    check(Number.isSafeInteger(ttlMs) && ttlMs >= 60000 && ttlMs <= 86400000, 'INVALID_SESSION', 'Session expiry must be between one minute and one day.'); const token = opaqueToken();
    return this.store.update(state => {
      const currentIssuer = authorize(this.store, context, memberId === context.memberId ? 'read' : 'admin'); const member = state.members.find(m => m.id === memberId); check(member?.active, 'ACCESS_REVOKED', 'The selected member has no access.'); sessionAuthority(currentIssuer, member);
      const session = { id: newId('session'), kind: 'member-session', memberId: member.id, role: member.role, epoch: member.epoch, tokenHash: tokenHash(token), createdAt: now(), expiresAt: new Date(Date.now() + ttlMs).toISOString() }; state.sessions.push(session);
      audit(state, 'auth.session.issued', { sessionId: session.id, memberId }); return { token, sessionId: session.id, expiresAt: session.expiresAt };
    });
  }
  authenticate(token: string, channel: Context['channel'] = 'desktop'): Context {
    const digest = tokenHash(token); const state = this.store.read(); const session = state.sessions.find(s => s.kind === 'member-session' && typeof s.tokenHash === 'string' && sameHash(s.tokenHash, digest));
    check(session && !session.revoked && Date.parse(session.expiresAt) > Date.now(), 'INVALID_SESSION', 'The session expired or was revoked.');
    const context: Context = { memberId: session.memberId, role: session.role, epoch: session.epoch, channel }; authorize(this.store, context); return context;
  }
  async revokeSession(context: Context, sessionId: string) {
    authorize(this.store, context); return this.store.update(state => { authorize(this.store, context); const session = state.sessions.find(s => s.id === sessionId && s.kind === 'member-session'); check(session, 'INVALID_SESSION', 'Session was not found.');
      if (session.memberId !== context.memberId) authorize(this.store, context, 'admin'); session.revoked = true; delete session.tokenHash; audit(state, 'auth.session.revoked', { sessionId }); return { sessionId, revoked: true }; });
  }
}
