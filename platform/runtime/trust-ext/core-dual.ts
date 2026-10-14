/**
 * Dual control for Send, Sharing, seats, what seats see, the allowed sources and autonomy. With an active cofounder, a change
 * by either admin waits for the other role; with none, the owner's change applies at once and a cofounder alone never applies one.
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

const publicChange = (p: PendingRecord) => ({ id: p.id, what: p.what, summary: p.summary, by: p.by, at: p.at, needs: p.needs, coolsOffAt: (p as { coolsOffAt?: string }).coolsOffAt ?? null });
const live = (state: State, at = Date.now()) => peekCore(state).pending.filter(p => Date.parse(p.expiresAt) > at);
export function pendingView(state: State) { return { items: live(state).map(publicChange).sort((a, b) => b.at.localeCompare(a.at)) }; }

/** Who must agree to a change made by this member, or null when it applies at once. The person a change removes still
 *  counts as the second person; removing the only cofounder has a cooling-off instead (see `coolingOffMs`). */
export function secondNeeded(state: State, ctx: Context, _op?: PendingRecord['op']): 'owner' | 'cofounder' | null {
  const member = admin(state, ctx);
  const others = (role: string) => state.members.some(m => m.active && m.role === role && m.id !== member.id);
  if (member.role === 'cofounder') return 'owner';
  return others('cofounder') ? 'cofounder' : null;
}

/** Changes under dual control are made by a person in the app: never from a request touched by outside text, nor from another channel. */
export function requireApp(ctx: Context) {
  check(ctx.sourceTainted !== true && (ctx.channel === undefined || ctx.channel === 'desktop'), 'APP_CONSENT_REQUIRED', 'Make this change in the app.');
}

/** An owner removing the only cofounder waits for that cofounder; if they have not answered after 72 hours, the owner may confirm it. */
export const coolingOffMs = 72 * 3600000;
type Pending = PendingRecord & { coolsOffAt?: string };
const onlyCofounder = (state: State, memberId: unknown) => state.members.some(m => m.id === memberId && m.active && m.role === 'cofounder')
  && !state.members.some(m => m.active && m.role === 'cofounder' && m.id !== memberId);
const coolingOffSentence = 'The cofounder has 72 hours to answer; if they have not answered by then, the person who asked can confirm it alone.';

export async function requestChange(ctx: Context, host: ModuleHost, what: ChangeWhat, summary: string, op: PendingRecord['op']) {
  requireApp(ctx); check(appliers.has(op.type), 'CHANGE_UNKNOWN', 'This change cannot be applied.');
  const needs = secondNeeded(host.store.read(), ctx, op);
  if (!needs) return { state: 'applied' as const, ...await apply(ctx, host, op) };
  return host.store.update(state => {
    const member = admin(state, ctx); check(secondNeeded(state, ctx, op) === needs, 'CHANGE_AUTHORITY_CHANGED', 'The people in this workspace changed. Try again.');
    const coolsOff = op.type === 'remove-seat' && member.role === 'owner' && onlyCofounder(state, op.memberId);
    const at = now(); const change: Pending = { id: newId('change'), what, summary: coolsOff ? `${summary} ${coolingOffSentence}` : summary, by: member.id, byRole: member.role, at,
      expiresAt: new Date(Date.parse(at) + pendingLifetimeMs).toISOString(), needs, op: structuredClone(op), ...(coolsOff ? { coolsOffAt: new Date(Date.parse(at) + coolingOffMs).toISOString() } : {}) };
    coreState(state).pending.push(change); audit(state, 'trustx.change.requested', { changeId: change.id, what, needs, memberId: member.id });
    return { state: 'waiting-for-second' as const, change: publicChange(change) };
  });
}

/** Confirms a waiting change, or with `decline: true` turns it down (the person who asked may withdraw it the same way). */
export async function confirmChange(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  requireApp(ctx); check(payload.decline === undefined || typeof payload.decline === 'boolean', 'INVALID_FIELDS', 'Say whether the change is declined.');
  const change = await host.store.update(state => {
    const member = admin(state, ctx); const core = coreState(state);
    const found = core.pending.find(p => p.id === payload.id) as Pending | undefined; check(found, 'CHANGE_NOT_FOUND', 'This change is not waiting for anyone.');
    check(Date.parse(found.expiresAt) > Date.now(), 'CHANGE_EXPIRED', 'This change waited more than seven days and expired. Make it again.');
    if (payload.decline === true) {
      check(found.by === member.id || member.role === found.needs, 'CHANGE_NEEDS_OTHER', `This change needs the ${found.needs}.`);
      core.pending = core.pending.filter(p => p.id !== found.id);
      audit(state, 'trustx.change.declined', { changeId: found.id, what: found.what, memberId: member.id, by: found.by }); return { declined: found };
    }
    if (found.by === member.id) {
      check(found.coolsOffAt, 'SELF_CONFIRM', 'The same person cannot confirm their own change.');
      check(Date.parse(found.coolsOffAt) <= Date.now(), 'COOLING_OFF', coolingOffSentence);
      check(onlyCofounder(state, found.op.memberId), 'CHANGE_NEEDS_OTHER', 'The people in this workspace changed. This change needs the cofounder.');
    } else check(member.role === found.needs, 'CHANGE_NEEDS_OTHER', `This change needs the ${found.needs}.`);
    const author = state.members.find(m => m.id === found.by);
    check(author?.active && author.role === found.byRole, 'CHANGE_AUTHOR_REVOKED', 'The person who asked for this change no longer has that seat.');
    core.pending = core.pending.filter(p => p.id !== found.id);
    audit(state, 'trustx.change.confirmed', { changeId: found.id, what: found.what, memberId: member.id, by: found.by, ...(found.by === member.id ? { afterCoolingOff: true } : {}) }); return found;
  });
  if ('declined' in change) return { state: 'declined' as const, change: publicChange(change.declined) };
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
  requireApp(ctx); check(appliers.has(op.type), 'CHANGE_UNKNOWN', 'This change cannot be applied.'); return apply(ctx, host, op);
}
