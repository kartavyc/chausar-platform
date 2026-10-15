/**
 * The enterprise frame additions (experimental): the shell a member opens in, the lens, the group
 * companies and the switcher, Whose (mine, my team, everyone), teams, Access (personas, grants,
 * administrators, access reviews), Channels and legal holds. Everything lives under
 * `laneState(state).enterprise`. Rules only: channel delivery is hosted-link's, retention
 * enforcement is core-data's, removing a seat is trustx's (with its dual control).
 */
import { audit, check, newId, now } from '../contracts.ts';
import type { Context, Member, State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import { laneState, peekLane, shellKind, type ShellKind } from './state.ts';

export const LENSES = ['whole-group', 'finance', 'sales', 'operations'] as const;
export const PERSONAS = ['leader', 'operator', 'specialist', 'administrator', 'auditor', 'developer'] as const;
export const CHANNELS = ['whatsapp', 'telegram', 'mail', 'phone'] as const;
const MAY = ['brief', 'approval-link'] as const;
const WHOSE = ['mine', 'team', 'everyone'] as const;
type Lens = typeof LENSES[number]; type Persona = typeof PERSONAS[number]; type Channel = typeof CHANNELS[number]; type Whose = typeof WHOSE[number];
type Team = { id: string; name: string; memberIds: string[] };
type ReviewRow = { memberId: string; name: string; role: string; decision: 'keep' | 'remove' | null; decidedBy: string | null; changeId?: string };
type Review = { reviewId: string; startedAt: string; closedAt: string | null; rows: ReviewRow[] };
export interface EnterpriseState {
  /** Who administers the installation. Absent means the active owners. */
  admins?: string[];
  people: Record<string, { persona: Persona | null; grants: string[] | null }>;
  lens: Record<string, Lens>;
  group: { id: string; name: string }[];
  chosen: Record<string, string>;
  whose: Record<string, Record<string, Whose>>;
  teams: Team[];
  reviews: Review[];
  channels: Partial<Record<Channel, { may: string[]; as: 'company' | 'person' }>>;
}

/** The authored enterprise sub-places as "place.sub" (app/ui/src/app/places.ts ENTERPRISE_AUTHORED; an engine module cannot import UI code). */
export const GRANTABLE: readonly string[] = Object.freeze([
  'today.today', 'today.activity',
  'ask.new', 'ask.saved', 'ask.whatifs', 'ask.decisions', 'ask.checks', 'ask.notyet', 'ask.plans',
  'work.approvals', 'work.jobs', 'work.actions', 'work.cando', 'work.cases', 'work.agents',
  'books.sources', 'books.meanings', 'books.accounts', 'books.records', 'books.history', 'books.memory', 'books.issues', 'books.companies',
  'reports.packs', 'reports.briefs', 'reports.duedates', 'reports.exports', 'reports.sent',
  'tools.smallapps', 'tools.plugins', 'tools.assistants', 'tools.planning',
  'trust.rules', 'trust.people', 'trust.models', 'trust.network', 'trust.record', 'trust.sharing', 'trust.vault',
  'trust.access', 'trust.markings', 'trust.retention', 'trust.channels',
  'company.signin', 'company.health', 'company.recovery', 'company.keys', 'company.support', 'company.computers', 'company.quality', 'company.build', 'company.licence',
]);
const of = (place: string) => GRANTABLE.filter(g => g.startsWith(`${place}.`));
/** A persona's grants when the person has none of their own; null is everything (enterprise part 2). */
const PERSONA_GRANTS: Record<Persona, readonly string[] | null> = {
  leader: null, administrator: null,
  operator: [...of('today'), 'ask.new', 'ask.saved', 'work.approvals', 'work.jobs', 'work.actions', 'work.cases', 'books.records', 'books.issues', 'reports.packs', 'reports.briefs', 'reports.duedates'],
  specialist: [...of('today'), 'ask.new', 'ask.saved', 'ask.checks', 'work.jobs', ...of('books'), 'reports.packs', 'reports.exports'],
  auditor: ['today.today', ...of('trust'), 'books.sources', 'books.history', 'reports.packs', 'reports.exports', 'reports.sent'],
  developer: ['today.today', 'work.jobs', 'work.agents', ...of('tools'), 'trust.models', 'trust.network', 'trust.record', ...of('company')],
};
const PERSONA_HOME: Record<Persona, { place: string; sub?: string }> = {
  leader: { place: 'today' }, operator: { place: 'today' }, specialist: { place: 'books' },
  administrator: { place: 'company' }, auditor: { place: 'trust', sub: 'record' }, developer: { place: 'company', sub: 'build' },
};

const BRANCH = /^[A-Za-z0-9_.-]{1,64}$/; const LIST = /^[a-z0-9.-]{1,64}$/;
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max;
export function fields(payload: Record<string, any>, allowed: readonly string[]) {
  check(Object.keys(payload).every(k => allowed.includes(k)), 'ENTERPRISE_INVALID_FIELDS', 'This request carries a field it does not use.');
}
const peekEnt = (state: State) => peekLane(state)?.enterprise as EnterpriseState | undefined;
export function entState(state: State): EnterpriseState {
  const lane = laneState(state); const e = (lane.enterprise ??= {}) as Partial<EnterpriseState>;
  e.people ??= {}; e.lens ??= {}; e.group ??= []; e.chosen ??= {}; e.whose ??= {}; e.teams ??= []; e.reviews ??= []; e.channels ??= {};
  return e as EnterpriseState;
}
const own = <T>(record: Record<string, T> | undefined, key: string): T | undefined => record && Object.hasOwn(record, key) ? record[key] : undefined;
const memberOf = (state: State, id: string) => state.members.find(m => m.id === id);
const self = (state: State, ctx: Context) => memberOf(state, ctx.memberId)!;

/** Every enterprise.* method except enterprise.setup answers only in the enterprise shell. */
export function requireOn(state: State) { check(shellKind(state) === 'enterprise', 'ENTERPRISE_NOT_ON', 'The enterprise version is not on for this workspace.'); }
const on = <T>(fn: (ctx: Context, payload: Record<string, any>, host: ModuleHost) => T) =>
  (ctx: Context, payload: Record<string, any>, host: ModuleHost) => { requireOn(host.store.read()); return fn(ctx, payload, host); };

/** The administrators in force: the list set in Access, kept to active members, else the active owners. */
export function administrators(state: State): string[] {
  const active = (id: string) => memberOf(state, id)?.active === true;
  const listed = (peekEnt(state)?.admins ?? []).filter(active);
  return listed.length ? listed : state.members.filter(m => m.active && m.role === 'owner').map(m => m.id);
}
const personOf = (state: State, id: string) => own(peekEnt(state)?.people, id) ?? { persona: null, grants: null };

// --- the shell ---------------------------------------------------------------------------------
export function shell(ctx: Context, _payload: Record<string, any>, host: ModuleHost) {
  const state = host.store.read(); const kind: ShellKind = shellKind(state);
  if (kind === 'ca-firm') return { kind, administers: false, allowed: null, views: null, home: { place: 'clients' } };
  if (kind !== 'enterprise') return { kind, administers: false, allowed: null, views: null, home: null };
  const member = self(state, ctx); const administers = administrators(state).includes(member.id); const person = personOf(state, member.id);
  const allowed = person.grants ?? (person.persona ? PERSONA_GRANTS[person.persona] : null);
  const home = person.persona ? PERSONA_HOME[person.persona] : null;
  return { kind, administers, allowed: allowed ? [...allowed] : null,
    views: member.role === 'viewer' ? ['simple', 'guided', 'books'] : ['guided', 'books'],
    home: home && (home.place !== 'company' || administers) ? { ...home } : null };
}

export async function setup(ctx: Context, payload: Record<string, any>, host: ModuleHost) {
  fields(payload, ['on']); check(typeof payload.on === 'boolean', 'ENTERPRISE_SETUP_INVALID', 'Say whether the enterprise version is on.');
  return host.store.update(state => {
    check(shellKind(state) !== 'ca-firm', 'ENTERPRISE_SHELL_TAKEN', 'This workspace is a CA firm console.');
    const kind: ShellKind = payload.on ? 'enterprise' : 'desktop';
    laneState(state).shell = { kind, by: ctx.memberId, at: now() }; audit(state, 'enterprise.setup', { kind, by: ctx.memberId });
    return { kind };
  });
}

// --- the lens ----------------------------------------------------------------------------------
const lensView = (state: State, ctx: Context) => ({ lens: own(peekEnt(state)?.lens, ctx.memberId) ?? 'whole-group', lenses: [...LENSES] });
export const lensGet = on((ctx, payload, host) => { fields(payload, []); return lensView(host.store.read(), ctx); });
export const lensSet = on(async (ctx, payload, host) => {
  fields(payload, ['lens']); check(LENSES.includes(payload.lens), 'ENTERPRISE_LENS_INVALID', 'Choose one of the four lenses.');
  return host.store.update(state => { entState(state).lens[ctx.memberId] = payload.lens; return lensView(state, ctx); });
});

// --- group companies -----------------------------------------------------------------------------
function companiesView(state: State, ctx: Context) {
  const member = self(state, ctx); const all = member.branches.includes('*');
  const companies = (peekEnt(state)?.group ?? []).filter(c => all || member.branches.includes(c.id)).map(c => ({ ...c }));
  const chosen = own(peekEnt(state)?.chosen, ctx.memberId);
  return { companies, chosen: chosen && companies.some(c => c.id === chosen) ? chosen : 'all', combined: { eliminations: 'not-built' as const } };
}
export const companies = on((ctx, payload, host) => { fields(payload, []); return companiesView(host.store.read(), ctx); });
export const companySet = on(async (ctx, payload, host) => {
  fields(payload, ['id']); check(typeof payload.id === 'string', 'ENTERPRISE_COMPANY_FORBIDDEN', 'This company is outside your companies.');
  return host.store.update(state => {
    check(payload.id === 'all' || companiesView(state, ctx).companies.some(c => c.id === payload.id), 'ENTERPRISE_COMPANY_FORBIDDEN', 'This company is outside your companies.');
    const e = entState(state); if (payload.id === 'all') delete e.chosen[ctx.memberId]; else e.chosen[ctx.memberId] = payload.id;
    return companiesView(state, ctx);
  });
});
export const groupSet = on(async (ctx, payload, host) => {
  fields(payload, ['companies']); const list = payload.companies;
  check(Array.isArray(list) && list.length <= 50 && list.every(c => c && typeof c === 'object' && !Array.isArray(c) && Object.keys(c).every(k => k === 'id' || k === 'name')
    && typeof c.id === 'string' && BRANCH.test(c.id) && text(c.name, 120)), 'ENTERPRISE_GROUP_INVALID', 'Give each company a branch id and a name, at most fifty.');
  check(new Set(list.map((c: any) => c.id)).size === list.length, 'ENTERPRISE_GROUP_INVALID', 'Each company appears once.');
  return host.store.update(state => {
    entState(state).group = list.map((c: any) => ({ id: c.id, name: c.name.trim() }));
    audit(state, 'enterprise.group.set', { companies: list.length, by: ctx.memberId }); return companiesView(state, ctx);
  });
});

// --- Whose and teams -----------------------------------------------------------------------------
const listName = (v: unknown) => check(typeof v === 'string' && LIST.test(v), 'ENTERPRISE_WHOSE_INVALID', 'Name a list.');
const whoseWord = (v: unknown) => check(WHOSE.includes(v as Whose), 'ENTERPRISE_WHOSE_INVALID', 'Choose mine, team or everyone.');
const whoseView = (state: State, ctx: Context, list: string) => ({ list, whose: own(own(peekEnt(state)?.whose, ctx.memberId), list) ?? 'everyone' });
export const whoseGet = on((ctx, payload, host) => { fields(payload, ['list']); listName(payload.list); return whoseView(host.store.read(), ctx, payload.list); });
export const whoseSet = on(async (ctx, payload, host) => {
  fields(payload, ['list', 'whose']); listName(payload.list); whoseWord(payload.whose);
  return host.store.update(state => {
    const mine = (entState(state).whose[ctx.memberId] ??= {});
    check(Object.hasOwn(mine, payload.list) || Object.keys(mine).length < 200, 'ENTERPRISE_WHOSE_INVALID', 'Too many lists are remembered.');
    mine[payload.list] = payload.whose; return whoseView(state, ctx, payload.list);
  });
});
export const whoseMembers = on((ctx, payload, host) => {
  fields(payload, ['whose']); whoseWord(payload.whose); const state = host.store.read();
  if (payload.whose === 'everyone') return { whose: 'everyone', memberIds: null };
  if (payload.whose === 'mine') return { whose: 'mine', memberIds: [ctx.memberId] };
  const ids = new Set([ctx.memberId]);
  for (const team of peekEnt(state)?.teams ?? []) if (team.memberIds.includes(ctx.memberId)) team.memberIds.forEach(id => ids.add(id));
  return { whose: 'team', memberIds: [...ids] };
});
const teamsView = (state: State) => ({ teams: (peekEnt(state)?.teams ?? []).map(t => ({ id: t.id, name: t.name, memberIds: [...t.memberIds] })) });
export const teamsList = on((_ctx, payload, host) => { fields(payload, []); return teamsView(host.store.read()); });
export const teamsSet = on(async (ctx, payload, host) => {
  fields(payload, ['teams']); const list = payload.teams;
  check(Array.isArray(list) && list.length <= 100 && list.every(t => t && typeof t === 'object' && !Array.isArray(t) && Object.keys(t).every(k => ['id', 'name', 'memberIds'].includes(k))
    && (t.id === undefined || (typeof t.id === 'string' && BRANCH.test(t.id))) && text(t.name, 80)
    && Array.isArray(t.memberIds) && t.memberIds.length <= 500 && t.memberIds.every((id: unknown) => typeof id === 'string') && new Set(t.memberIds).size === t.memberIds.length),
  'ENTERPRISE_TEAMS_INVALID', 'Give each team a name and its people, at most one hundred teams.');
  const ids = list.map((t: any) => t.id).filter(Boolean); check(new Set(ids).size === ids.length, 'ENTERPRISE_TEAMS_INVALID', 'Each team appears once.');
  return host.store.update(state => {
    check(list.every((t: any) => t.memberIds.every((id: string) => memberOf(state, id))), 'ENTERPRISE_TEAM_MEMBER_UNKNOWN', 'A team names someone who is not in this workspace.');
    entState(state).teams = list.map((t: any) => ({ id: t.id ?? newId('team'), name: t.name.trim(), memberIds: [...t.memberIds] }));
    audit(state, 'enterprise.teams.set', { teams: list.length, by: ctx.memberId }); return teamsView(state);
  });
});

// --- Access --------------------------------------------------------------------------------------
function personRow(state: State, m: Member) {
  const p = personOf(state, m.id);
  return { memberId: m.id, name: m.name, role: m.role, branches: [...m.branches], persona: p.persona, grants: p.grants ? [...p.grants] : null,
    administers: administrators(state).includes(m.id), active: m.active };
}
export const accessList = on((_ctx, payload, host) => {
  fields(payload, []); const state = host.store.read();
  return { people: state.members.map(m => personRow(state, m)), personas: [...PERSONAS], grantable: [...GRANTABLE] };
});
export const accessSet = on(async (ctx, payload, host) => {
  fields(payload, ['memberId', 'persona', 'grants', 'administers']);
  check(payload.persona === undefined || payload.persona === null || PERSONAS.includes(payload.persona), 'ENTERPRISE_PERSONA_INVALID', 'Choose one of the six personas.');
  const g = payload.grants;
  check(g === undefined || g === null || (Array.isArray(g) && g.every((x: unknown) => typeof x === 'string' && GRANTABLE.includes(x)) && new Set(g).size === g.length),
    'ENTERPRISE_GRANT_UNKNOWN', 'Grant only the listed sub-places, each once.');
  check(payload.administers === undefined || typeof payload.administers === 'boolean', 'ENTERPRISE_INVALID_FIELDS', 'Say whether this person administers the installation.');
  return host.store.update(state => {
    const member = typeof payload.memberId === 'string' ? memberOf(state, payload.memberId) : undefined;
    check(member, 'ENTERPRISE_MEMBER_UNKNOWN', 'This person is not in the workspace.');
    const e = entState(state); const person = { ...personOf(state, member.id) };
    if (payload.persona !== undefined) person.persona = payload.persona;
    if (g !== undefined) person.grants = g === null ? null : [...g];
    if (payload.administers !== undefined) {
      if (payload.administers) check(member.active && (member.role === 'owner' || member.role === 'cofounder'), 'ENTERPRISE_ADMINISTERS_ROLE', 'Only an active owner or cofounder can administer the installation.');
      const next = new Set(administrators(state)); if (payload.administers) next.add(member.id); else next.delete(member.id);
      check([...next].some(id => memberOf(state, id)?.active), 'ENTERPRISE_LAST_ADMINISTRATOR', 'Keep at least one person who administers the installation.');
      e.admins = [...next];
    }
    e.people[member.id] = person;
    audit(state, 'enterprise.access.set', { memberId: member.id, persona: person.persona, grants: person.grants?.length ?? null, by: ctx.memberId });
    return personRow(state, member);
  });
});

// --- access reviews --------------------------------------------------------------------------------
const reviewCopy = (r: Review): Review => structuredClone(r);
export const reviews = on((_ctx, payload, host) => {
  fields(payload, []); return { reviews: [...(peekEnt(host.store.read())?.reviews ?? [])].reverse().map(reviewCopy) };
});
export const reviewStart = on(async (ctx, payload, host) => {
  fields(payload, []);
  return host.store.update(state => {
    const e = entState(state); check(!e.reviews.some(r => r.closedAt === null), 'ENTERPRISE_REVIEW_OPEN', 'Finish the open access review first.');
    const review: Review = { reviewId: newId('review'), startedAt: now(), closedAt: null,
      rows: state.members.filter(m => m.active).map(m => ({ memberId: m.id, name: m.name, role: m.role, decision: null, decidedBy: null })) };
    e.reviews.push(review); if (e.reviews.length > 50) e.reviews.splice(0, e.reviews.length - 50);
    audit(state, 'enterprise.review.started', { reviewId: review.reviewId, rows: review.rows.length, by: ctx.memberId }); return reviewCopy(review);
  });
});
function openRow(state: State, ctx: Context, payload: Record<string, any>) {
  const review = peekEnt(state)?.reviews.find(r => r.reviewId === payload.reviewId); check(review, 'ENTERPRISE_REVIEW_UNKNOWN', 'This access review was not found.');
  check(review.closedAt === null, 'ENTERPRISE_REVIEW_CLOSED', 'This access review is closed.');
  const row = review.rows.find(r => r.memberId === payload.memberId); check(row, 'ENTERPRISE_REVIEW_MEMBER_UNKNOWN', 'This person is not in the review.');
  check(row.memberId !== ctx.memberId, 'ENTERPRISE_REVIEW_SELF', 'Someone else decides on your own access.');
  check(row.decision === null, 'ENTERPRISE_REVIEW_DECIDED', 'This person was already decided.');
  return { review, row };
}
export const reviewDecide = on(async (ctx, payload, host) => {
  fields(payload, ['reviewId', 'memberId', 'keep']); check(typeof payload.keep === 'boolean', 'ENTERPRISE_INVALID_FIELDS', 'Say whether to keep this person.');
  openRow(host.store.read(), ctx, payload);
  // Removing goes through trustx (seat removal and its dual control); only its change id is kept here.
  const removed = payload.keep ? null : await host.call('trustx.removeSeat', { memberId: payload.memberId }) as { change?: { id?: unknown } };
  return host.store.update(state => {
    const { review, row } = openRow(state, ctx, payload);
    row.decision = payload.keep ? 'keep' : 'remove'; row.decidedBy = ctx.memberId;
    if (typeof removed?.change?.id === 'string') row.changeId = removed.change.id;
    if (review.rows.every(r => r.decision !== null)) review.closedAt = now();
    audit(state, 'enterprise.review.decided', { reviewId: review.reviewId, memberId: row.memberId, decision: row.decision, by: ctx.memberId });
    return reviewCopy(review);
  });
});

// --- Channels and holds --------------------------------------------------------------------------
const channelsView = (state: State) => ({ channels: CHANNELS.map(id => { const c = own(peekEnt(state)?.channels, id); return { id, may: c ? [...c.may] : [], as: c?.as ?? 'company' }; }) });
export const channelsGet = on((_ctx, payload, host) => { fields(payload, []); return channelsView(host.store.read()); });
export const channelsSet = on(async (ctx, payload, host) => {
  fields(payload, ['id', 'may', 'as']);
  check(CHANNELS.includes(payload.id) && Array.isArray(payload.may) && payload.may.every((m: unknown) => MAY.includes(m as any)) && new Set(payload.may).size === payload.may.length
    && (payload.as === 'company' || payload.as === 'person'), 'ENTERPRISE_CHANNEL_INVALID', 'Choose a channel, what it may carry, and as whom.');
  return host.store.update(state => {
    entState(state).channels[payload.id as Channel] = { may: MAY.filter(m => payload.may.includes(m)), as: payload.as };
    audit(state, 'enterprise.channels.set', { id: payload.id, may: payload.may.length, as: payload.as, by: ctx.memberId }); return channelsView(state);
  });
});
export const holdsList = on((_ctx, payload) => { fields(payload, []); return { holds: [], enforced: false }; });
export const holdsPlace = on(() => { check(false, 'ENTERPRISE_HOLDS_NOT_ENFORCED', 'Legal holds are not enforced yet, so none can be placed.'); });
