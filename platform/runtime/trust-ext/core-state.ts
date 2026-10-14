/** Trust core (TR-01..TR-06): the stored shape under `laneState(state).trust.core` and shared helpers. */
import { check } from '../contracts.ts';
import type { Context, Member, State } from '../contracts.ts';
import { laneState, peekLane } from './lane-state.ts';

export const markKinds = ['personal', 'financial', 'confidential'] as const;
export type MarkKind = typeof markKinds[number];
export const seatNames = ['owner', 'cofounder', 'accountant', 'ca', 'staff', 'viewer', 'assistant'] as const;
export type Seat = typeof seatNames[number];
export type Sees = Record<MarkKind, boolean>;
export type MarkTarget = { type: 'source' | 'record' | 'field'; sourceId: string; recordId?: string; field?: string };
export type Mark = { id: string; kind: MarkKind; target: MarkTarget; auto: boolean; by: string; at: string };
export type KindRule = { kind: string; on: boolean; maxPerDay: number; maxAmountMinorPerDay: string | null };
export type Caps = { remindersPerCustomerPerDay: number; remindersPerDay: number; activeJobs: number; monthlyAiCapMinor: string | null };
export type Preset = 'ask-everything' | 'routine' | 'all-but-waits' | 'custom';
export type ChangeWhat = 'send' | 'sharing' | 'seats';
export type PendingRecord = { id: string; what: ChangeWhat; summary: string; by: string; byRole: Member['role']; at: string; expiresAt: string;
  needs: 'owner' | 'cofounder'; op: { type: string } & Record<string, unknown> };
export type SeatRecord = { inviteId: string; seat: Seat; name: string; endsOn: string | null; invitedBy: string; at: string };
export type CoreState = {
  marks: Mark[]; autoOff: string[]; seatSees: Partial<Record<Seat, Sees>>;
  send: { localOnly: boolean; financialRoutes: string[] };
  keep: Record<string, number | null>;
  autonomy: { preset: Preset; kinds: Record<string, Omit<KindRule, 'kind'>>; caps: Caps };
  pending: PendingRecord[]; seats: Record<string, SeatRecord>; memberSeats: Record<string, Seat>; removed: Record<string, string>;
};

export const actionKinds: KindRule[] = [
  { kind: 'reminder', on: false, maxPerDay: 20, maxAmountMinorPerDay: null },
  { kind: 'brief', on: false, maxPerDay: 3, maxAmountMinorPerDay: null },
  { kind: 'sheet-update', on: false, maxPerDay: 20, maxAmountMinorPerDay: null },
  { kind: 'calendar-event', on: false, maxPerDay: 10, maxAmountMinorPerDay: null },
  { kind: 'voucher-draft', on: false, maxPerDay: 10, maxAmountMinorPerDay: '1000000' },
  { kind: 'report', on: false, maxPerDay: 5, maxAmountMinorPerDay: null },
];
export const defaultCaps: Caps = { remindersPerCustomerPerDay: 1, remindersPerDay: 20, activeJobs: 10, monthlyAiCapMinor: null };
export const defaultSees: Record<Seat, Sees> = {
  owner: { personal: true, financial: true, confidential: true }, cofounder: { personal: true, financial: true, confidential: true },
  accountant: { personal: false, financial: true, confidential: false }, ca: { personal: false, financial: true, confidential: false },
  staff: { personal: false, financial: false, confidential: false }, viewer: { personal: false, financial: false, confidential: false },
  assistant: { personal: false, financial: false, confidential: false },
};
export const keepKinds = ['facts', 'modelReceipts', 'activity', 'briefs', 'exports', 'learning'] as const;

function fresh(): CoreState {
  return { marks: [], autoOff: [], seatSees: {}, send: { localOnly: false, financialRoutes: [] }, keep: {},
    autonomy: { preset: 'ask-everything', kinds: {}, caps: { ...defaultCaps } }, pending: [], seats: {}, memberSeats: {}, removed: {} };
}
/** Writable namespace; call only inside `store.update`. */
export function coreState(state: State): CoreState {
  const trust = laneState(state).trust; const core = (trust.core ??= fresh()) as CoreState;
  const blank = fresh(); for (const key of Object.keys(blank) as (keyof CoreState)[]) (core as any)[key] ??= blank[key];
  return core;
}
/** Read-only view with defaults; never creates the namespace. */
export function peekCore(state: State): CoreState { return { ...fresh(), ...(peekLane(state)?.trust?.core ?? {}) } as CoreState; }

/** The India Standard Time date (UTC+5:30, no daylight saving): the lane's day for CA end dates and daily limits. */
export const today = (at = Date.now()) => new Date(at + 19800000).toISOString().slice(0, 10);
export const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
export const boundedText = (value: unknown, max = 200): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;

/** Every source the workspace knows of, from its facts and imports. */
export function knownSources(state: State): string[] {
  const ids = new Set<string>();
  for (const f of state.facts) if (!f.deletedAt) ids.add(f.sourceId);
  for (const i of state.imports) if (typeof i?.sourceId === 'string' && i.sourceId) ids.add(i.sourceId);
  return [...ids].sort();
}

const roleSeat: Record<Member['role'], Seat> = { owner: 'owner', cofounder: 'cofounder', accountant: 'accountant', viewer: 'viewer' };
/** Invitation by member from the `auth.invitation.accepted` activity entries, built once per activity log and rebuilt when it changes. */
const acceptances = new WeakMap<unknown[], { length: number; last: unknown; byMember: Map<string, string> }>();
/** The invitation that made a member, from the `auth.invitation.accepted` activity entry. */
export function invitationOf(state: State, memberId: string): string | undefined {
  const log = state.activity; let index = acceptances.get(log);
  if (!index || index.length !== log.length || index.last !== log.at(-1)) {
    const byMember = new Map<string, string>();
    for (const a of log) if (a.event === 'auth.invitation.accepted' && typeof a.details?.memberId === 'string' && !byMember.has(a.details.memberId)) byMember.set(a.details.memberId, a.details.invitationId);
    acceptances.set(log, index = { length: log.length, last: log.at(-1), byMember });
  }
  return index.byMember.get(memberId);
}
export function seatOf(state: State, member: Member): Seat {
  const core = peekCore(state); const known = core.memberSeats[member.id]; if (known) return known;
  const invite = invitationOf(state, member.id);
  return (invite && core.seats[invite]?.seat) || roleSeat[member.role];
}
export function admin(state: State, ctx: Context): Member {
  const member = state.members.find(m => m.id === ctx.memberId);
  check(member?.active && ['owner', 'cofounder'].includes(member.role), 'FORBIDDEN', 'An owner must approve this change.');
  return member;
}
