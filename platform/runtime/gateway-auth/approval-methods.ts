import { audit, check, now, type Context, type State } from '../contracts.ts';
import { current, type ActionService, type PreparedAction } from '../actions.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { SECRET_MAX, SECRET_MIN, askerGate, dropGrants, laneState, lockedUntil, memberSecret, newMemberSecret, recordGrant, verifySecondAskSecret } from './second-ask.ts';

/** Exact payload keys; anything else is refused before work starts. */
function fields(payload: Record<string, any>, required: readonly string[], optional: readonly string[] = []) {
  check(payload && typeof payload === 'object' && !Array.isArray(payload) && Object.keys(payload).every(k => required.includes(k) || optional.includes(k)) && required.every(k => Object.hasOwn(payload, k)),
    'INVALID_REQUEST', 'The request has missing or unexpected fields.');
}
const secretText = (value: unknown, min: number) => typeof value === 'string' && value.length >= min && value.length <= SECRET_MAX;

/** The money action a second ask may be granted for: visible to the caller, prepared, unattempted and exactly this digest. */
function eligible(state: State, ctx: Context, actions: ActionService, target: { id: string; digest: string }): PreparedAction {
  askerGate(state, ctx);
  const action = state.actions.find(item => item.id === target.id) as PreparedAction | undefined; check(action, 'NOT_FOUND', 'Action not found.');
  actions.access(state, ctx, action); const op = actions.operation(action.connector, action.operation); op.authorize?.(state, ctx, 'write');
  check(action.impact === 'money' || op.impact === 'money', 'SECOND_ASK_NOT_NEEDED', 'Only money is asked for a second time.');
  check(action.status === 'prepared' && action.attempts.length === 0, 'INVALID_ACTION_STATE', 'Only a prepared, unattempted action can be approved.');
  check(target.digest === action.digest && action.digest === actions.identity(action), 'PREVIEW_CHANGED', 'The exact action changed. Review its new preview.');
  return action;
}

/**
 * `secondAsk.*`: the second ask before money is approved (WK-02), and each approving member's own approval secret.
 * Every answer and every change happens in the desktop app, by a person, never from outside text.
 */
export const approvalMethods: Record<string, MethodSpec> = {
  /** `{ target: { kind: 'action', id, digest }, secret }` → `{ granted: true, expiresAt }`: one five-minute, single-use grant for exactly this approval. */
  'secondAsk.grant': { permission: 'approve', handler: async (ctx, payload, host) => {
    fields(payload, ['target', 'secret']);
    const target = payload.target;
    check(target && typeof target === 'object' && !Array.isArray(target) && Object.keys(target).sort().join(',') === 'digest,id,kind' && target.kind === 'action'
      && typeof target.id === 'string' && target.id.length >= 1 && target.id.length <= 200 && typeof target.digest === 'string' && /^[a-f0-9]{64}$/.test(target.digest),
    'INVALID_REQUEST', 'Name the action you reviewed and its digest.');
    check(secretText(payload.secret, 1), 'INVALID_REQUEST', 'Type your passphrase or approval secret.');
    const actions = host.services.actions as ActionService; const exact = { id: target.id as string, digest: target.digest as string };
    eligible(host.store.read(), ctx, actions, exact);
    check(await verifySecondAskSecret(host.store, ctx, payload.secret), 'SECOND_ASK_FAILED', 'That answer is not right. Nothing was approved.');
    // The action is checked again after the slow answer; the grant exists only once the write that records it has landed.
    await host.store.update(state => { eligible(state, ctx, actions, exact); audit(state, 'secondAsk.granted', { kind: 'action', actionId: exact.id, digest: exact.digest, memberId: ctx.memberId }); });
    const grant = recordGrant(host.store.read(), ctx, { kind: 'action', ...exact });
    return { granted: true as const, expiresAt: new Date(grant.expiresAt).toISOString() };
  } },
  /** `{ secret, current? }` → `{ set: true, at }`: a cofounder's own approval secret (10 to 1024 characters); replacing one needs the current one. */
  'secondAsk.setSecret': { permission: 'approve', handler: async (ctx, payload, host) => {
    fields(payload, ['secret'], ['current']);
    const member = askerGate(host.store.read(), ctx);
    check(member.role !== 'owner', 'SECOND_ASK_OWNER_USES_PASSPHRASE', 'The owner answers the second ask with the workspace passphrase.');
    check(secretText(payload.secret, SECRET_MIN), 'SECOND_ASK_SECRET_INVALID', 'Use an approval secret of 10 to 1024 characters.');
    check(payload.current === undefined || secretText(payload.current, 1), 'INVALID_REQUEST', 'Type your current approval secret.');
    const existing = memberSecret(host.store.read(), member.id, member.epoch);
    if (existing) {
      check(payload.current !== undefined, 'SECOND_ASK_CURRENT_REQUIRED', 'Type your current approval secret to replace it.');
      check(await verifySecondAskSecret(host.store, ctx, payload.current), 'SECOND_ASK_FAILED', 'That answer is not right. Nothing was changed.');
    }
    const record = await newMemberSecret(payload.secret, member.epoch, now());
    return host.store.update(state => {
      const live = askerGate(state, ctx);
      check(live.epoch === record.epoch && (memberSecret(state, live.id, live.epoch)?.hash ?? null) === (existing?.hash ?? null), 'SECOND_ASK_CHANGED', 'Your approval secret changed meanwhile. Try again.');
      laneState(state).secrets[live.id] = record;
      audit(state, 'secondAsk.secretSet', { memberId: live.id, replaced: existing !== null });
      return { set: true as const, at: record.at };
    });
  } },
  /** `{ memberId }` → `{ cleared }`: the owner clears anyone's approval secret (a lost seat); a cofounder clears only their own. */
  'secondAsk.clearSecret': { permission: 'admin', handler: async (ctx, payload, host) => {
    fields(payload, ['memberId']);
    check(typeof payload.memberId === 'string' && payload.memberId.length >= 1 && payload.memberId.length <= 200, 'INVALID_REQUEST', 'Name the member.');
    const result = await host.store.update(state => {
      const me = askerGate(state, ctx);
      check(me.role === 'owner' || payload.memberId === me.id, 'FORBIDDEN', 'Only the owner clears another person’s approval secret.');
      const secrets = laneState(state).secrets; const had = Object.hasOwn(secrets, payload.memberId);
      if (had) delete secrets[payload.memberId];
      audit(state, 'secondAsk.secretCleared', { memberId: payload.memberId, by: me.id, had });
      return { cleared: had, workspaceId: state.workspace.id };
    });
    dropGrants(result.workspaceId, payload.memberId);
    return { cleared: result.cleared };
  } },
  /**
   * `{ secret }` → `{ verified }`: checks the caller's own approval secret (the owner's vault passphrase, a cofounder's own secret)
   * for another lane's own second ask (write-back calls it as the same caller). It grants nothing and changes nothing but the
   * caller's own failure count; locked out it refuses SECOND_ASK_LOCKED (the end of the lock is in `secondAsk.status`).
   */
  'auth.verifyApprovalSecret': { permission: 'approve', handler: async (ctx, payload, host) => {
    fields(payload, ['secret']);
    askerGate(host.store.read(), ctx);
    check(secretText(payload.secret, 1), 'INVALID_REQUEST', 'Type your passphrase or approval secret.');
    return { verified: await verifySecondAskSecret(host.store, ctx, payload.secret) };
  } },
  /** `{}` → `{ by, expects (same as by, the name work-books reads), secretSet, lockedUntil }` for the caller only: how they answer a second ask, and whether it is locked. */
  'secondAsk.status': { permission: 'read', handler: (ctx, payload, host: ModuleHost) => {
    fields(payload, []);
    const state = host.store.read(); const member = current(state, ctx);
    const secretSet = member.role !== 'owner' && memberSecret(state, member.id, member.epoch) !== null;
    const by = member.role === 'owner' ? (typeof (host.store as { verifyPassphrase?: unknown }).verifyPassphrase === 'function' ? 'passphrase' : 'none')
      : member.role === 'cofounder' && secretSet ? 'member-secret' : 'none';
    const locked = ['owner', 'cofounder'].includes(member.role) ? lockedUntil(state.workspace.id, member.id) : null;
    return { by, expects: by, secretSet, lockedUntil: locked === null ? null : new Date(locked).toISOString() };
  } },
};
