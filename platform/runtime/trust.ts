import { authorize, audit, check, newId } from './contracts.ts';
import type { Context, Member, State, StateStore, TrustPolicy } from './contracts.ts';

export function sourceAllowed(state: State, context: Context, sourceId: string): boolean {
  const member = state.members.find(m => m.id === context.memberId);
  if (!member?.active || member.epoch !== context.epoch || member.role !== context.role) return false;
  if (!(state.policy.allowedSources.includes('*') || state.policy.allowedSources.includes(sourceId))) return false;
  if (state.tombstones.some(t => t.sourceId === sourceId && (t.kind === 'source' || t.deleted === true))) return false;
  const rules = state.sourceRules.filter(r => r.sourceId === sourceId);
  return rules.every(r => r.revoked !== true && r.allow !== false &&
    (!r.memberIds || r.memberIds.includes(context.memberId)) && (!r.roles || r.roles.includes(member.role)));
}

export function assertSourceAccess(state: State, context: Context, sourceIds: string[]): void {
  for (const id of sourceIds) check(sourceAllowed(state, context, id), 'SOURCE_REVOKED', 'This source is no longer available to your account.');
}

export function isNoResend(state: State, contentHash: string): boolean {
  return state.tombstones.some(t => t.contentHash === contentHash || t.digest === contentHash);
}

export class TrustService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  async updatePolicy(context: Context, patch: Partial<TrustPolicy>) {
    authorize(this.store, context, 'admin');
    const allowed = ['send', 'autonomy', 'allowedSources', 'retentionDays', 'sharing'];
    check(Object.keys(patch).every(k => allowed.includes(k)), 'INVALID_POLICY', 'Unknown privacy policy field.');
    if (patch.send !== undefined) check(['nothing', 'shape', 'samples'].includes(patch.send), 'INVALID_POLICY', 'Choose nothing, shape, or samples.');
    if (patch.allowedSources !== undefined) check(Array.isArray(patch.allowedSources) && patch.allowedSources.every(s => typeof s === 'string' && s.length > 0), 'INVALID_POLICY', 'Source grants must be named.');
    if (patch.retentionDays !== undefined) check(Number.isInteger(patch.retentionDays) && patch.retentionDays >= 1 && patch.retentionDays <= 3650, 'INVALID_POLICY', 'Retention must be between one and 3650 days.');
    for (const k of ['autonomy', 'sharing'] as const) if (patch[k] !== undefined) check(typeof patch[k] === 'boolean', 'INVALID_POLICY', 'Privacy switches must be boolean.');
    return this.store.update(state => {
      authorize(this.store, context, 'admin'); state.policy = { ...state.policy, ...structuredClone(patch) };
      audit(state, 'trust.policy.changed', { memberId: context.memberId, fields: Object.keys(patch) }); return structuredClone(state.policy);
    });
  }
  async addMember(context: Context, input: { id?: string; name: string; role: Member['role']; branches?: string[] }): Promise<Member> {
    const issuer = authorize(this.store, context, 'admin');
    check(['owner', 'cofounder', 'accountant', 'viewer'].includes(input.role), 'INVALID_ROLE', 'Unknown member role.');
    check(typeof input.name === 'string' && input.name.trim().length > 0 && input.name.length <= 200, 'INVALID_MEMBER', 'A member needs a name.');
    check(!input.branches || (Array.isArray(input.branches) && input.branches.length > 0 && input.branches.every(s => typeof s === 'string' && s.length > 0)), 'INVALID_MEMBER', 'Branch grants must be names.');
    const branches = input.branches || ['*'];
    check(input.role !== 'owner' || issuer.role === 'owner', 'MEMBER_ROLE_FORBIDDEN', 'Only an owner can grant another owner role.');
    check(issuer.branches.includes('*') || branches.every(branch => issuer.branches.includes(branch)), 'MEMBER_SCOPE_FORBIDDEN', 'New member branch grants must stay within the issuing administrator scope.');
    return this.store.update(state => {
      const currentIssuer = authorize(this.store, context, 'admin');
      check((input.role !== 'owner' || currentIssuer.role === 'owner') && (currentIssuer.branches.includes('*') || branches.every(branch => currentIssuer.branches.includes(branch))), 'MEMBER_SCOPE_FORBIDDEN', 'The issuing administrator authority changed.');
      const id = input.id || newId('member');
      check(!state.members.some(m => m.id === id), 'MEMBER_EXISTS', 'This member already exists.');
      const member = { id, name: input.name.trim(), role: input.role, branches: [...branches], active: true, epoch: 1 };
      state.members.push(member); audit(state, 'trust.member.created', { id, role: input.role }); return structuredClone(member);
    });
  }
  async revokeMember(context: Context, memberId: string) {
    authorize(this.store, context, 'admin');
    return this.store.update(state => {
      authorize(this.store, context, 'admin'); const member = state.members.find(m => m.id === memberId);
      check(member, 'MEMBER_NOT_FOUND', 'Member was not found.');
      check(!(member.role === 'owner' && state.members.filter(m => m.active && m.role === 'owner').length === 1), 'LAST_OWNER', 'Keep an active owner in the workspace.');
      member.active = false; member.epoch++; state.sessions = state.sessions.filter(s => s.memberId !== memberId);
      audit(state, 'trust.member.revoked', { memberId }); return { memberId, epoch: member.epoch, active: false };
    });
  }
}
