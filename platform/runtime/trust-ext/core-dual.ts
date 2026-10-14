/**
 * Dual control for Send, Sharing and seats. With an active cofounder, a change by either admin waits
 * for the other role; with none, the owner's change applies at once and a cofounder alone never applies one.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { audit, check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { admin, coreState, peekCore } from './core-state.ts';
import type { ChangeWhat, PendingRecord } from './core-state.ts';

export const pendingLifetimeMs = 7 * 86400000;
type Applier = (ctx: Context, host: ModuleHost, op: PendingRecord['op']) => Promise<Record<string, unknown>>;
const appliers = new Map<string, Applier>();
/** Set only while this file applies an agreed (or single-person) change; the core change guard lets that member's core calls through. */
const applying = new AsyncLocalStorage<string>();
const apply = (ctx: Context, host: ModuleHost, op: PendingRecord['op']) => applying.run(ctx.memberId, () => appliers.get(op.type)!(ctx, host, op));
/** Each part registers how its own change type is applied once both people agree. */
export function onApplyChange(type: string, apply: Applier) { appliers.set(type, apply); }

const publicChange = (p: PendingRecord) => ({ id: p.id, what: p.what, summary: p.summary, by: p.by, at: p.at, needs: p.needs });
const live = (state: State, at = Date.now()) => peekCore(state).pending.filter(p => Date.parse(p.expiresAt) > at);
export function pendingView(state: State) { return { items: live(state).map(publicChange).sort((a, b) => b.at.localeCompare(a.at)) }; }

/** Who must agree to a change made by this member, or null when it applies at once. The person a
 *  change removes never counts as the second person, so a cofounder cannot block their own removal. */
export function secondNeeded(state: State, ctx: Context, op?: PendingRecord['op']): 'owner' | 'cofounder' | null {
  const member = admin(state, ctx); const target = op?.type === 'remove-seat' ? op.memberId : undefined;
  const others = (role: string) => state.members.some(m => m.active && m.role === role && m.id !== member.id && m.id !== target);
  if (member.role === 'cofounder') return 'owner';
  return others('cofounder') ? 'cofounder' : null;
}

export async function requestChange(ctx: Context, host: ModuleHost, what: ChangeWhat, summary: string, op: PendingRecord['op']) {
  check(appliers.has(op.type), 'CHANGE_UNKNOWN', 'This change cannot be applied.');
  const needs = secondNeeded(host.store.read(), ctx, op);
  if (!needs) return { state: 'applied' as const, ...await apply(ctx, host, op) };
  return host.store.update(state => {
    const member = admin(state, ctx); check(secondNeeded(state, ctx, op) === needs, 'CHANGE_AUTHORITY_CHANGED', 'The people in this workspace changed. Try again.');
    const at = now(); const change: PendingRecord = { id: newId('change'), what, summary, by: member.id, byRole: member.role, at,
      expiresAt: new Date(Date.parse(at) + pendingLifetimeMs).toISOString(), needs, op: structuredClone(op) };
    coreState(state).pending.push(change); audit(state, 'trustx.change.requested', { changeId: change.id, what, needs, memberId: member.id });
    return { state: 'waiting-for-second' as const, change: publicChange(change) };
  });
}

export async function confirmChange(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const change = await host.store.update(state => {
    const member = admin(state, ctx); const core = coreState(state);
    const found = core.pending.find(p => p.id === payload.id); check(found, 'CHANGE_NOT_FOUND', 'This change is not waiting for anyone.');
    check(Date.parse(found.expiresAt) > Date.now(), 'CHANGE_EXPIRED', 'This change waited more than seven days and expired. Make it again.');
    check(found.by !== member.id, 'SELF_CONFIRM', 'The same person cannot confirm their own change.');
    check(member.role === found.needs, 'CHANGE_NEEDS_OTHER', `This change needs the ${found.needs}.`);
    const author = state.members.find(m => m.id === found.by);
    check(author?.active && author.role === found.byRole, 'CHANGE_AUTHOR_REVOKED', 'The person who asked for this change no longer has that seat.');
    core.pending = core.pending.filter(p => p.id !== found.id);
    audit(state, 'trustx.change.confirmed', { changeId: found.id, what: found.what, memberId: member.id, by: found.by }); return found;
  });
  check(appliers.has(change.op.type), 'CHANGE_UNKNOWN', 'This change cannot be applied.');
  try { return { state: 'applied' as const, change: publicChange(change), ...await apply(ctx, host, change.op) }; }
  catch (error) { await host.store.update(state => { coreState(state).pending.push(change); }); throw error; }
}

/** Drop changes that waited past their seven days. Returns how many were removed. */
export function expirePending(state: State, at = Date.now()): number {
  const core = coreState(state); const before = core.pending.length; core.pending = core.pending.filter(p => Date.parse(p.expiresAt) > at);
  return before - core.pending.length;
}

/** True while this member's change is being applied by `requestChange` or `confirmChange`. */
export const applyingChange = (ctx: Context) => applying.getStore() === ctx.memberId;
/** Applies a registered change by one person, outside dual control: only for what this lane does not count as a seat
 *  (an assistant paired on this computer, which reaches only the numbers server). */
export async function applyByOne(ctx: Context, host: ModuleHost, op: PendingRecord['op']) {
  check(appliers.has(op.type), 'CHANGE_UNKNOWN', 'This change cannot be applied.'); return apply(ctx, host, op);
}
