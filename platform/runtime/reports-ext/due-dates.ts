/** Statutory due dates worked out by the engine from the shipped, sourced table. No date is ever written by a model. */
import { readFileSync } from 'node:fs';
import { check } from '../contracts.ts';
import { validDate } from '../memory.ts';
import { addDays, closed, daysBetween, dateOf, monthEnd } from './common.ts';

type Rule = { type: 'monthly'; day: number | 'last'; months?: number[]; overrides?: Record<string, number> } | { type: 'annual'; dates: string[] };
type TableRow = { id: string; what: string; rule: Rule; source: { title: string; url: string }; lastChecked: string; appliesTo: { kinds: string[]; gstModes: string[]; states: string[] } };
type Table = { version: string; publishedAt: string; reviewed: boolean; kinds: string[]; gstModes: string[]; states: string[]; rows: TableRow[] };
export type DueProfile = { kind: string; gstMode: 'regular' | 'composition' | 'none'; state: string };
export type DueRow = { id: string; what: string; dueOn: string; source: { title: string; url: string }; lastChecked: string; checkOld: boolean; appliesTo: TableRow['appliesTo'] };

export const table: Table = JSON.parse(readFileSync(new URL('./due-dates.v1.json', import.meta.url), 'utf8'));
// The shipped table is checked once at load: a malformed row would make every date suspect.
for (const row of table.rows) {
  const rule = row.rule;
  const ok = rule.type === 'monthly' ? (rule.day === 'last' || (Number.isInteger(rule.day) && rule.day >= 1 && rule.day <= 28)) && (rule.months ?? []).every(m => m >= 1 && m <= 12)
    && Object.entries(rule.overrides ?? {}).every(([m, d]) => Number(m) >= 1 && Number(m) <= 12 && d >= 1 && d <= 30)
    : rule.type === 'annual' && rule.dates.every(date => validDate(`2025-${date}`));
  if (!ok || !validDate(row.lastChecked) || !/^https:\/\//.test(row.source.url)) throw new Error(`Invalid due-date table row: ${row.id}`);
}

export function validProfile(value: unknown): DueProfile {
  const input = closed(value, ['kind', 'gstMode', 'state'], 'INVALID_DUE_PROFILE');
  check(typeof input.kind === 'string' && /^[a-z][a-z0-9-]{1,40}$/.test(input.kind), 'INVALID_DUE_PROFILE', 'Name the kind of business in lower-case words.');
  check(table.gstModes.includes(input.gstMode), 'INVALID_DUE_PROFILE', 'Choose regular, composition or no GST registration.');
  check(typeof input.state === 'string' && table.states.includes(input.state), 'INVALID_DUE_PROFILE', 'Choose a state or union territory by its two-letter code.');
  return { kind: input.kind, gstMode: input.gstMode, state: input.state };
}

/** Every date a rule gives between `from` and `to`, inclusive. */
function datesOf(rule: Rule, from: string, to: string): string[] {
  const out: string[] = [];
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    if (rule.type === 'annual') out.push(...rule.dates.map(date => `${year}-${date}`));
    else for (let month = 1; month <= 12; month++) {
      if (rule.months && !rule.months.includes(month)) continue;
      const override = rule.overrides?.[String(month)];
      out.push(override !== undefined ? dateOf(year, month, override) : rule.day === 'last' ? monthEnd(year, month) : dateOf(year, month, rule.day));
    }
  }
  return out.filter(date => date >= from && date <= to).sort();
}

export function dueDates(input: { from: string; days: number; profile: DueProfile | null }) {
  const { from, days, profile } = input; const to = addDays(from, days);
  const covered = !profile || table.kinds.includes(profile.kind);
  const applies = (row: TableRow) => !profile || (row.appliesTo.kinds.includes(profile.kind) && row.appliesTo.gstModes.includes(profile.gstMode)
    && (row.appliesTo.states.includes('all') || row.appliesTo.states.includes(profile.state)));
  const rows: DueRow[] = covered ? table.rows.filter(applies).flatMap(row => datesOf(row.rule, from, to).map(dueOn => ({
    id: `${row.id}:${dueOn}`, what: row.what, dueOn, source: { ...row.source }, lastChecked: row.lastChecked,
    checkOld: daysBetween(row.lastChecked, from) > 30, appliesTo: structuredClone(row.appliesTo) }))) : [];
  rows.sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.id.localeCompare(b.id));
  return { caNote: 'Not yet checked by a CA.', table: { version: table.version, publishedAt: table.publishedAt, reviewed: table.reviewed }, profile, covered, coveredKinds: [...table.kinds], rows };
}

export function dueRequest(payload: unknown, today: string): { from: string; days: number; profile?: DueProfile } {
  const input = closed(payload, ['from', 'days', 'profile'], 'INVALID_DUE_REQUEST');
  check(input.from === undefined || validDate(input.from), 'INVALID_DUE_REQUEST', 'Give a valid start date.');
  check(input.days === undefined || (Number.isInteger(input.days) && input.days >= 1 && input.days <= 400), 'INVALID_DUE_REQUEST', 'Choose between 1 and 400 days.');
  return { from: input.from ?? today, days: input.days ?? 60, ...(input.profile === undefined || input.profile === null ? {} : { profile: validProfile(input.profile) }) };
}
