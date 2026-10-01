import { authorize, audit, check, hash, newId, now } from './contracts.ts';
import type { Context, Fact, Member, State, StateStore, TrustPolicy } from './contracts.ts';

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

export function visibleFacts(store: StateStore, context: Context, sourceIds?: string[]): Fact[] {
  const member = authorize(store, context);
  const state = store.read();
  if (sourceIds) assertSourceAccess(state, context, sourceIds);
  const cutoff = Date.now() - state.policy.retentionDays * 86400000;
  return state.facts.filter(f => !f.deletedAt && !f.supersededAt &&
    Date.parse(f.learnedAt) >= cutoff && sourceAllowed(state, context, f.sourceId) &&
    (!sourceIds || sourceIds.includes(f.sourceId)) &&
    (member.branches.includes('*') || (Boolean(f.branch) && member.branches.includes(f.branch!))));
}

export function trustFingerprint(state: State, context: Context, sourceIds: string[]): string {
  const member = state.members.find(m => m.id === context.memberId);
  return hash({ policy: state.policy, member, sourceRules: state.sourceRules.filter(r => sourceIds.includes(r.sourceId)),
    deletedSources: state.tombstones.filter(t => sourceIds.includes(t.sourceId)) });
}

export function isNoResend(state: State, contentHash: string): boolean {
  return state.tombstones.some(t => t.contentHash === contentHash || t.digest === contentHash);
}

function hasLineage(value: any, sourceId: string, factIds: Set<string>, seen = new Set<any>()): boolean {
  if (typeof value === 'string') return value === sourceId || factIds.has(value);
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some(v => hasLineage(v, sourceId, factIds, seen));
}

function sourceDeletionScope(state: State, context: Context, member: Member, sourceId: string) {
  check(typeof sourceId === 'string' && sourceId.length > 0, 'INVALID_SOURCE', 'Choose an existing source.');
  const facts = state.facts.filter(f => f.sourceId === sourceId); const factIds = new Set(facts.map(f => f.id));
  const imports = state.imports.filter(i => hasLineage(i, sourceId, factIds));
  check(facts.length > 0 || imports.length > 0, 'SOURCE_NOT_FOUND', 'This source does not exist in the workspace.');
  assertSourceAccess(state, context, [sourceId]);
  check(member.branches.includes('*') || (facts.length > 0 && facts.every(f => Boolean(f.branch) && member.branches.includes(f.branch!))), 'SOURCE_DELETE_SCOPE_FORBIDDEN', 'Deleting a source requires current access to every affected branch.');
  return { facts, factIds, imports };
}

function retentionAuthority(store: StateStore, context: Context) {
  const member = authorize(store, context, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'RETENTION_SCOPE_FORBIDDEN', 'Whole-workspace retention cleanup requires an owner with every branch.');
  assertSourceAccess(store.read(), context, [...new Set(store.read().facts.map(f => f.sourceId))]);
}

export class TrustService {
  store: StateStore;
  constructor(store: StateStore) { this.store = store; }
  get(context: Context) { authorize(this.store, context); return structuredClone(this.store.read().policy); }
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
  members(context: Context): Member[] { authorize(this.store, context, 'admin'); return structuredClone(this.store.read().members); }
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
  async grantSource(context: Context, input: { sourceId: string; memberIds?: string[]; roles?: Member['role'][]; allow?: boolean; revoked?: boolean }) {
    authorize(this.store, context, 'admin');
    check(typeof input.sourceId === 'string' && input.sourceId.length > 0, 'INVALID_GRANT', 'A grant needs a source.');
    return this.store.update(state => {
      authorize(this.store, context, 'admin'); state.sourceRules = state.sourceRules.filter(r => r.sourceId !== input.sourceId);
      const grant = { ...structuredClone(input), id: newId('grant'), updatedAt: now() }; state.sourceRules.push(grant);
      audit(state, 'trust.source.grant.changed', { sourceId: input.sourceId }); return grant;
    });
  }
  async deleteSource(context: Context, sourceId: string) {
    const member = authorize(this.store, context, 'admin'); sourceDeletionScope(this.store.read(), context, member, sourceId);
    return this.store.update(state => {
      const currentMember = authorize(this.store, context, 'admin');
      const { facts, factIds, imports } = sourceDeletionScope(state, context, currentMember, sourceId);
      for (const artifact of [...facts, ...imports]) state.tombstones.push({ id: newId('tombstone'), kind: 'content', contentHash: artifact.contentHash || artifact.hash || hash(artifact), sourceId, deletedAt: now() });
      state.tombstones.push({ id: newId('tombstone'), kind: 'source', sourceId, deletedAt: now() });
      state.facts = state.facts.filter(f => f.sourceId !== sourceId);
      let removed = facts.length;
      for (const key of ['imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'conflicts', 'merges', 'conversations', 'modelReceipts'] as const) {
        const original = state[key]; const keep = original.filter(a => !hasLineage(a, sourceId, factIds));
        for (const a of original) if (!keep.includes(a) && key === 'modelReceipts' && a.digest) state.tombstones.push({ id: newId('tombstone'), kind: 'payload', digest: a.digest, sourceId, deletedAt: now() });
        removed += original.length - keep.length; state[key] = keep;
      }
      state.unsupported.push({ id: newId('unsupported'), code: 'SOURCE_DELETED', sourceId, at: now(), reason: 'Historical answers depending on this deleted source are no longer available.' });
      audit(state, 'trust.source.deleted', { sourceId, removed }); return { sourceId, removed, remoteDeletion: 'Remote providers may retain prior requests under their own policies.' };
    });
  }
  async cleanup(context: Context, at = new Date()) {
    retentionAuthority(this.store, context);
    return this.store.update(state => {
      retentionAuthority(this.store, context); const cutoff = at.getTime() - state.policy.retentionDays * 86400000; let removed = 0;
      const expiredFacts = new Set(state.facts.filter(f => Date.parse(f.learnedAt) < cutoff).map(f => f.id));
      for (const key of ['facts', 'imports', 'receipts', 'answers', 'decisions', 'actions', 'jobs', 'learning', 'conversations', 'modelReceipts', 'conflicts', 'merges'] as const) {
        state[key] = state[key].filter(a => {
          const date = a.learnedAt || a.createdAt || a.at; const expired = (date && Date.parse(date) < cutoff) || [...expiredFacts].some(id => hasLineage(a, '__none__', new Set([id])));
          if (expired) { removed++; state.tombstones.push({ id: newId('tombstone'), kind: 'retention', digest: a.digest || hash(a), contentHash: a.contentHash, deletedAt: at.toISOString() }); }
          return !expired;
        }) as any;
      }
      audit(state, 'trust.retention.cleaned', { removed, cutoff: new Date(cutoff).toISOString() }); return { removed };
    });
  }
}
