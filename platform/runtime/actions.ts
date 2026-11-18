import { authorize, check } from './contracts.ts';
import type { Context, State } from './contracts.ts';
import { assertSourceAccess } from './trust.ts';

// The canonical JSON form and its digest live in portable.ts; the venture records import them by this name.
export {canonical,digest} from './portable.ts';
export function current(state: State, context: Context, permission: 'read' | 'prepare' | 'approve' | 'admin' = 'read') {
  return authorize({ read: () => state, update: async () => { throw new Error('Read-only authorization view.'); } }, context, permission);
}
export function sourceAccess(state: State, context: Context, sourceIds: string[]) {
  const member = current(state, context);
  assertSourceAccess(state, context, sourceIds);
  for (const source of sourceIds) {
    check(state.policy.allowedSources.includes('*') || state.policy.allowedSources.includes(source), 'SOURCE_REVOKED', `Access to source ${source} has been revoked.`);
    const rules = state.sourceRules.filter(r => (r.sourceId === source || r.id === source) && (r.memberId === context.memberId || !r.memberId));
    check(!rules.some(r => r.active === false || r.read === false || r.revoked === true), 'SOURCE_REVOKED', 'Source read permission was revoked.');
    const branches = state.facts.filter(f => f.sourceId === source).map(f => f.branch);
    check(member.branches.includes('*') || branches.every(b => Boolean(b) && member.branches.includes(b!)), 'BRANCH_FORBIDDEN', 'The action includes a branch outside your permissions.');
  }
}
