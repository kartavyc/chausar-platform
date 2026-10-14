/** TR-06 People and seats, mapped onto the core roles; seat changes go through dual control. */
import { audit, check, now } from '../contracts.ts';
import type { Context, Member, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { boundedText, coreState, invitationOf, isDate, peekCore, seatOf, today } from './core-state.ts';
import type { Seat } from './core-state.ts';
import { onApplyChange, requestChange } from './core-dual.ts';

const noSend = 'Cannot change Send, Sharing or seats.';
export const seatLimits: Record<Seat, string[]> = {
  owner: ['Everything.', 'When there is a cofounder, changes to Send, Sharing and seats need the cofounder too.'],
  cofounder: ['Everything, except that changes to Send, Sharing and seats need both the owner and the cofounder.'],
  accountant: ['Reads everything not marked away from this seat.', 'Prepares actions.', 'Cannot approve money.', noSend],
  ca: ['Reads and exports, until a date.', 'Cannot prepare or approve actions.', noSend],
  staff: ['Adds entries.', 'Sees their own: not yet enforced by the engine; today this seat reads like an accountant.', 'Cannot approve money.', noSend],
  viewer: ['Reads only.', noSend],
  assistant: ['An assistant on this computer that asks read-only questions.', 'Cannot prepare or approve actions.', noSend],
};
const seatRole: Partial<Record<Seat, Member['role']>> = { cofounder: 'cofounder', accountant: 'accountant', ca: 'viewer', staff: 'accountant' };
const invitable = Object.keys(seatRole) as Seat[];

/** A CA seat ends at the end of its date: on the day after, the seat is over. */
const ended = (endsOn: string | null, day = today()) => endsOn !== null && endsOn < day;
function seatRecordFor(state: State, memberId: string) { const invite = invitationOf(state, memberId); return invite ? peekCore(state).seats[invite] : undefined; }

export function seatsView(state: State, ctx: Context) {
  const core = peekCore(state);
  const seats = state.members.map(m => {
    const record = seatRecordFor(state, m.id); const seat = seatOf(state, m); const endsOn = record?.endsOn ?? null;
    return { memberId: m.id, name: m.name, seat, limits: [...seatLimits[seat]], endsOn, ended: ended(endsOn), removedOn: core.removed[m.id] ?? null, active: m.active, you: m.id === ctx.memberId };
  });
  return { seats, templates: (Object.keys(seatLimits) as Seat[]).map(seat => ({ seat, limits: [...seatLimits[seat]] })) };
}

/** Members whose dated seat is past its end and who still have access. */
export function endedMembers(state: State, day = today()): string[] {
  return state.members.filter(m => m.active && ended(seatRecordFor(state, m.id)?.endsOn ?? null, day)).map(m => m.id);
}
/** Ends dated seats inside a store update: the member loses access and its sessions, as `members.revoke` would. */
export function endSeats(state: State, day = today()): string[] {
  const ids = endedMembers(state, day);
  for (const id of ids) {
    const member = state.members.find(m => m.id === id)!;
    if (member.role === 'owner' && state.members.filter(m => m.active && m.role === 'owner').length === 1) continue;
    member.active = false; member.epoch++; state.sessions = state.sessions.filter(s => s.memberId !== id);
    coreState(state).removed[id] ??= day; audit(state, 'trust.member.revoked', { memberId: id, reason: 'seat-ended' });
  }
  return ids;
}

export async function seats(ctx: Context, host: ModuleHost) {
  if (endedMembers(host.store.read()).length) await host.store.update(state => { endSeats(state); });
  const state = host.store.read(); const me = state.members.find(m => m.id === ctx.memberId);
  check(me?.active && me.epoch === ctx.epoch, 'ACCESS_REVOKED', 'Your workspace access has changed. Sign in again.');
  return seatsView(state, ctx);
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** One page to forward to an accountant. It carries no code: the code arrives separately. */
export function accountantGuide(workspace: string, name: string): string {
  const items = seatLimits.accountant.map(l => `<li>${escape(l)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Joining ${escape(workspace)} on Chausar</title></head><body>`
    + `<h1>Hello ${escape(name)}</h1><p>You have been invited to the accountant's seat in ${escape(workspace)} on Chausar.</p>`
    + `<h2>What your seat allows</h2><ul>${items}</ul>`
    + `<h2>How to join</h2><ol><li>Install Chausar on your computer.</li><li>Choose "Join a workspace".</li><li>Type the one-time code you were given.</li></ol>`
    + `<p>Your one-time code arrives separately, straight from the person who invited you. It is not in this page, works once, and expires.</p>`
    + `<p>Anything you copy or export stays with you, so keep it as carefully as the books it came from.</p></body></html>`;
}

export async function invite(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  check(invitable.includes(payload.seat), 'SEAT_NOT_INVITABLE', 'Invite a cofounder, an accountant, a CA or staff.');
  check(boundedText(payload.name), 'INVALID_MEMBER', 'An invite needs a name.');
  const endsOn = payload.endsOn ?? null;
  if (payload.seat === 'ca') check(isDate(endsOn) && endsOn >= today(), 'INVALID_END_DATE', 'A CA seat needs an end date from today on.');
  else check(endsOn === null, 'INVALID_END_DATE', 'Only a CA seat has an end date.');
  const summary = `Invite ${payload.name.trim()} to the ${payload.seat} seat${endsOn ? ` until ${endsOn}` : ''}.`;
  return requestChange(ctx, host, 'seats', summary, { type: 'invite', seat: payload.seat, name: payload.name.trim(), endsOn });
}

onApplyChange('invite', async (ctx, host, op) => {
  const seat = op.seat as Seat; const name = op.name as string;
  const made = await host.services.auth.invite(ctx, { name, role: seatRole[seat]!, ttlMs: 86400000 });
  const workspace = await host.store.update(state => {
    coreState(state).seats[made.id] = { inviteId: made.id, seat, name, endsOn: (op.endsOn as string | null) ?? null, invitedBy: ctx.memberId, at: now() };
    audit(state, 'trustx.seat.invited', { inviteId: made.id, seat, memberId: ctx.memberId }); return state.workspace.name;
  });
  return { invite: { id: made.id, token: made.token, expiresAt: made.expiresAt }, ...(seat === 'accountant' ? { guide: { html: accountantGuide(workspace, name) } } : {}) };
});

export async function removeSeat(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  const state = host.store.read(); const member = state.members.find(m => m.id === payload.memberId);
  check(member, 'MEMBER_NOT_FOUND', 'Member was not found.');
  check(member.active, 'MEMBER_ALREADY_REMOVED', 'This person was already removed.');
  check(!(member.role === 'owner' && state.members.filter(m => m.active && m.role === 'owner').length === 1), 'LAST_OWNER', 'Keep an active owner in the workspace.');
  return requestChange(ctx, host, 'seats', `Remove ${member.name} from the ${seatOf(state, member)} seat.`, { type: 'remove-seat', memberId: member.id });
}

onApplyChange('remove-seat', async (ctx, host, op) => {
  const memberId = op.memberId as string;
  await host.services.trust.revokeMember(ctx, memberId);
  const removedOn = await host.store.update(state => { const day = today(); coreState(state).removed[memberId] = day; audit(state, 'trustx.seat.removed', { memberId, by: ctx.memberId }); return day; });
  return { removedOn, kept: 'What was already copied or exported stays with that person.' };
});
