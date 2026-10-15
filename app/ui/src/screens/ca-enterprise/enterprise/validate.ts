/**
 * Checks for every enterprise reply (docs/lanes/ca-enterprise.md, "Enterprise"). A reply is
 * untrusted: a validator returns a fresh, typed copy or throws an Error whose code is
 * INVALID_REPLY, and the screen then draws the failed state instead of the reply.
 */
import { COMPANY_SUBS, type CompanySub } from './routing.ts';

export class ReplyError extends Error {
  readonly code = 'INVALID_REPLY';
  constructor() { super('The engine sent a reply this screen cannot read.'); }
}

type Obj = Record<string, unknown>;
function check(ok: boolean): asserts ok { if (!ok) throw new ReplyError(); }
function obj(v: unknown): Obj { check(v !== null && typeof v === 'object' && !Array.isArray(v)); return v as Obj; }
function arr(v: unknown, max = 5000): unknown[] { check(Array.isArray(v) && v.length <= max); return v as unknown[]; }
function str(v: unknown, max = 400): string { check(typeof v === 'string' && v.length <= max); return v as string; }
function id(v: unknown): string { const s = str(v, 120); check(s.length > 0); return s; }
function bool(v: unknown): boolean { check(typeof v === 'boolean'); return v as boolean; }
function strOrNull(v: unknown, max = 400): string | null { return v === null ? null : str(v, max); }
function oneOf<T extends string>(v: unknown, list: readonly T[]): T { check(typeof v === 'string' && (list as readonly string[]).includes(v)); return v as T; }
function strings(v: unknown, max = 500): string[] { return arr(v, max).map((x) => str(x, 200)); }
function unique(list: readonly string[]): boolean { return new Set(list).size === list.length; }

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
function time(v: unknown): string { const s = str(v, 40); check(ISO_TIME.test(s) || ISO_DATE.test(s)); return s; }

// ---- Company -------------------------------------------------------------------------

export const SUB_STATES = ['ready', 'not-built', 'needs-founder', 'out-of-service'] as const;
export type SubState = (typeof SUB_STATES)[number];
export type FactValue = string | number | boolean | null;
export interface CompanyEntry { readonly id: CompanySub; readonly state: SubState; readonly code: string | null; readonly facts: ReadonlyArray<{ readonly key: string; readonly value: FactValue }> }
export interface CompanyOverview { readonly subs: ReadonlyArray<CompanyEntry> }

function fact(v: unknown): { key: string; value: FactValue } {
  const o = obj(v);
  const key = str(o.key, 80);
  check(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(key));
  const value = o.value;
  check(value === null || typeof value === 'boolean' || (typeof value === 'string' && value.length <= 400) || (typeof value === 'number' && Number.isFinite(value)));
  return { key, value: value as FactValue };
}

export function validateOverview(reply: unknown): CompanyOverview {
  const subs = arr(obj(reply).subs, COMPANY_SUBS.length).map((v): CompanyEntry => {
    const o = obj(v);
    const code = strOrNull(o.code, 64);
    check(code === null || /^[A-Z][A-Z0-9_]{1,63}$/.test(code));
    return { id: oneOf(o.id, COMPANY_SUBS), state: oneOf(o.state, SUB_STATES), code, facts: arr(o.facts, 40).map(fact) };
  });
  check(unique(subs.map((s) => s.id)));
  return { subs };
}

// ---- Channels ------------------------------------------------------------------------

export const CHANNEL_IDS = ['whatsapp', 'telegram', 'mail', 'phone'] as const;
export const CHANNEL_MAY = ['brief', 'approval-link'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];
export type ChannelMay = (typeof CHANNEL_MAY)[number];
export interface Channel { readonly id: ChannelId; readonly may: ReadonlyArray<ChannelMay>; readonly as: 'company' | 'person' }

export function validateChannels(reply: unknown): { channels: Channel[] } {
  const channels = arr(obj(reply).channels, CHANNEL_IDS.length).map((v): Channel => {
    const o = obj(v);
    const may = arr(o.may, CHANNEL_MAY.length).map((m) => oneOf(m, CHANNEL_MAY));
    check(unique(may));
    return { id: oneOf(o.id, CHANNEL_IDS), may, as: oneOf(o.as, ['company', 'person'] as const) };
  });
  check(unique(channels.map((c) => c.id)));
  return { channels };
}

// ---- Access, reviews, teams ----------------------------------------------------------

export const PERSONAS = ['leader', 'operator', 'specialist', 'administrator', 'auditor', 'developer'] as const;
export type Persona = (typeof PERSONAS)[number];
export interface Person {
  readonly memberId: string; readonly name: string; readonly role: string; readonly branches: ReadonlyArray<string>;
  readonly persona: Persona | null; readonly grants: ReadonlyArray<string> | null; readonly administers: boolean; readonly active: boolean;
}
export interface AccessList { readonly people: ReadonlyArray<Person>; readonly personas: ReadonlyArray<Persona>; readonly grantable: ReadonlyArray<string> }

const GRANT = /^[a-z][a-z-]{0,31}\.[a-z][a-z0-9-]{0,31}$/;

export function validatePerson(v: unknown): Person {
  const o = obj(v);
  const grants = o.grants === null ? null : strings(o.grants, 200);
  check(grants === null || (grants.every((g) => GRANT.test(g)) && unique(grants)));
  return {
    memberId: id(o.memberId), name: str(o.name, 200), role: str(o.role, 60), branches: strings(o.branches, 200),
    persona: o.persona === null ? null : oneOf(o.persona, PERSONAS), grants, administers: bool(o.administers), active: bool(o.active),
  };
}

export function validateAccess(reply: unknown): AccessList {
  const o = obj(reply);
  const people = arr(o.people, 2000).map(validatePerson);
  check(unique(people.map((p) => p.memberId)));
  const grantable = strings(o.grantable, 200);
  check(grantable.every((g) => GRANT.test(g)) && unique(grantable));
  return { people, personas: arr(o.personas, PERSONAS.length).map((p) => oneOf(p, PERSONAS)), grantable };
}

export interface ReviewRow { readonly memberId: string; readonly name: string; readonly role: string; readonly decision: 'keep' | 'remove' | null; readonly decidedBy: string | null; readonly changeId: string | null }
export interface Review { readonly reviewId: string; readonly startedAt: string; readonly closedAt: string | null; readonly rows: ReadonlyArray<ReviewRow> }

export function validateReview(v: unknown): Review {
  const o = obj(v);
  const rows = arr(o.rows, 2000).map((r): ReviewRow => {
    const x = obj(r);
    return {
      memberId: id(x.memberId), name: str(x.name, 200), role: str(x.role, 60),
      decision: x.decision === null ? null : oneOf(x.decision, ['keep', 'remove'] as const),
      decidedBy: strOrNull(x.decidedBy, 200), changeId: x.changeId === undefined ? null : id(x.changeId),
    };
  });
  check(unique(rows.map((r) => r.memberId)));
  return { reviewId: id(o.reviewId), startedAt: time(o.startedAt), closedAt: o.closedAt === null ? null : time(o.closedAt), rows };
}

export function validateReviews(reply: unknown): { reviews: Review[] } {
  return { reviews: arr(obj(reply).reviews, 500).map(validateReview) };
}

export interface Team { readonly id: string; readonly name: string; readonly memberIds: ReadonlyArray<string> }
export function validateTeams(reply: unknown): { teams: Team[] } {
  const teams = arr(obj(reply).teams, 500).map((v): Team => {
    const o = obj(v);
    const memberIds = strings(o.memberIds, 2000);
    check(unique(memberIds));
    return { id: id(o.id), name: str(o.name, 120), memberIds };
  });
  check(unique(teams.map((t) => t.id)));
  return { teams };
}

// ---- Holds, companies, whose, shell --------------------------------------------------

export interface Hold { readonly id: string; readonly what: string | null }
export function validateHolds(reply: unknown): { holds: Hold[]; enforced: boolean } {
  const o = obj(reply);
  const holds = arr(o.holds, 500).map((v): Hold => { const h = obj(v); return { id: id(h.id), what: h.what === undefined ? null : strOrNull(h.what, 200) }; });
  return { holds, enforced: bool(o.enforced) };
}

export interface Companies { readonly companies: ReadonlyArray<{ readonly id: string; readonly name: string }>; readonly chosen: string; readonly eliminations: 'not-built' }
export function validateCompanies(reply: unknown): Companies {
  const o = obj(reply);
  const companies = arr(o.companies, 50).map((v) => { const c = obj(v); const cid = id(c.id); check(cid !== 'all'); return { id: cid, name: str(c.name, 120) }; });
  check(unique(companies.map((c) => c.id)));
  const chosen = id(o.chosen);
  check(chosen === 'all' || companies.some((c) => c.id === chosen));
  const combined = obj(o.combined);
  return { companies, chosen, eliminations: oneOf(combined.eliminations, ['not-built'] as const) };
}

export const WHOSE = ['mine', 'team', 'everyone'] as const;
export type WhoseValue = (typeof WHOSE)[number];
export function validateWhose(reply: unknown): { list: string; whose: WhoseValue } {
  const o = obj(reply);
  return { list: id(o.list), whose: oneOf(o.whose, WHOSE) };
}

export const SHELL_KINDS = ['desktop', 'enterprise', 'ca-firm'] as const;
export type ShellKindValue = (typeof SHELL_KINDS)[number];
export function validateSetup(reply: unknown): { kind: ShellKindValue } {
  return { kind: oneOf(obj(reply).kind, SHELL_KINDS) };
}
