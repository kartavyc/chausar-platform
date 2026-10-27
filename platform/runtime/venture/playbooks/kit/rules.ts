// Chausar playbook kit: the dated rule register every playbook keeps (Ink v2 wave 5, package 5A3; catalogue P1
// generalised, P5's rule side). One rule is one limit, disclosure or practice a playbook's steps and checks rest on,
// with its sources, the day it was checked, how it was read, the steps and checks that use it, what it does not cover,
// and when it must be checked again (90 days unless the rule says otherwise). validateRules refuses a rule that cannot
// be trusted as data; ruleFreshness reads one on the owner's own day; noteUnconfirmed and requireConfirmedRules are
// what a kit playbook's checks and runs call. Code only, no model, no clock inside: the caller passes the owner's day
// (rulesFreshnessAt turns an instant into it by the business's country).
//
// Idea taken, code written here: xjli360/sealeap-ecommerce-skills (MIT), whose rule refresh lists, per rule, its
// official pages with the checked date, how much of each was read, the skills it is used by and its limitations.
import { check } from '../../../contracts.ts';
import type { CountryProfile, IsoDate, PlaybookCheckResult } from '../../contracts.ts';
import { validDate } from '../../../memory.ts';
import { localDayAt } from '../../local-day.ts';
import type { DatedRule, RuleRead } from './define.ts';

export type { DatedRule, RuleRead } from './define.ts';

/** The days a rule stays current after checkedOn unless it names its own window. Day 91 is stale. */
export const RULE_RECHECK_DAYS = 90;
/** The longest window a rule may name: a year. */
export const RULE_RECHECK_MAX_DAYS = 365;
/** What a house rule shows as its source: it is Chausar's own, not a platform's or a regulator's. */
export const HOUSE_SOURCE = "Chausar's own rule";
/** The words a check that rests on an unconfirmed rule ends its detail with. */
export const UNCONFIRMED_NOTE = 'This rule is not confirmed.';
export const RULE_READS: readonly RuleRead[] = Object.freeze(['official', 'secondary', 'house', 'unconfirmed']);

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HTTPS = /^https:\/\/[^\s]+$/;

/** What validateRules checks usedBy against: the playbook's step ids and check ids (a definition has both). */
export type RuleOwner = { steps: readonly { id: string }[]; checkIds: readonly string[] };

const words = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim() && !/[\n\r\t]/.test(value);

/** Days since 1970-01-01 for a real calendar date; null for anything else. */
function dayNumber(date: string): number | null {
  if (!validDate(date)) return null;
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Whole days from one date to a later one (negative when it is earlier). */
export function daysFrom(from: IsoDate, to: IsoDate): number {
  const start = dayNumber(from), end = dayNumber(to);
  check(start !== null && end !== null, 'RULE_INVALID', 'Give dates like 2026-10-21.');
  return end - start;
}

/**
 * Refuses (RULE_INVALID, naming the rule and what is wrong) a register a playbook cannot rest on: an id that is not a
 * short lowercase name, or listed twice; empty words; a source missing unless the rule is a house rule, or one without
 * a title and an https link; a checkedOn that is not a date or is after today; an unknown reading; a value without a
 * unit or a unit without a value; usedBy empty or naming a step or check the playbook lacks; limitations missing; a
 * recheck window that is not a whole number of days from 1 to 365; a confirmation without a name or with a day before
 * the check or after today. Returns the rules as given.
 */
export function validateRules(rules: readonly DatedRule[], owner: RuleOwner, today: IsoDate): readonly DatedRule[] {
  check(validDate(today), 'RULE_INVALID', 'Give today as a date like 2026-10-21.');
  const targets = new Set([...owner.steps.map(step => step.id), ...owner.checkIds]);
  const seen = new Set<string>();
  for (const rule of rules) {
    const name = typeof rule?.id === 'string' ? rule.id : JSON.stringify(rule?.id);
    const refuse = (ok: unknown, what: string): void => check(ok, 'RULE_INVALID', `The rule ${name} ${what}.`);
    refuse(typeof rule.id === 'string' && ID.test(rule.id), 'needs a short lowercase id');
    refuse(!seen.has(rule.id), 'is listed twice');
    seen.add(rule.id);
    refuse(words(rule.scope) && words(rule.topic), 'needs its scope and topic');
    refuse(words(rule.rule), 'needs its words');
    refuse(RULE_READS.includes(rule.read), 'has an unknown reading: use official, secondary, house or unconfirmed');
    refuse(words(rule.how), 'needs how it was read');
    refuse(Array.isArray(rule.sources), 'needs its sources');
    if (rule.read !== 'house') refuse(rule.sources.length > 0, `needs at least one source: only a house rule may have none, and its source is "${HOUSE_SOURCE}"`);
    for (const source of rule.sources) refuse(source && words(source.title) && typeof source.url === 'string' && HTTPS.test(source.url), 'has a source without a title and an https link');
    refuse(typeof rule.checkedOn === 'string' && validDate(rule.checkedOn), 'needs the day it was checked, like 2026-10-21');
    refuse(daysFrom(rule.checkedOn, today) >= 0, `was checked on ${rule.checkedOn}, after today (${today})`);
    refuse((rule.value === undefined) === (rule.unit === undefined), rule.value === undefined ? 'has a unit without a value' : 'has a value without a unit');
    if (rule.value !== undefined) refuse(words(rule.value) && words(rule.unit), 'has an empty value or unit');
    refuse(Array.isArray(rule.usedBy) && rule.usedBy.length > 0, 'needs the steps or checks that use it');
    const unknown = rule.usedBy.filter(id => !targets.has(id));
    refuse(!unknown.length, `is used by ${unknown.join(', ')}, which the playbook has no step or check for`);
    refuse(words(rule.limitations), 'needs a line on what it does not cover');
    refuse(rule.recheckAfterDays === undefined || (Number.isInteger(rule.recheckAfterDays) && rule.recheckAfterDays >= 1 && rule.recheckAfterDays <= RULE_RECHECK_MAX_DAYS),
      `has a recheck window that is not a whole number of days from 1 to ${RULE_RECHECK_MAX_DAYS}`);
    // Never fails open: every rule says who must confirm it, and one a CA or lawyer must confirm carries confirmedBy
    // (null until they do), so leaving the field out can never make a tax or legal rule need no one.
    refuse(rule.needs === null || (NEEDS as readonly unknown[]).includes(rule.needs), 'needs who must confirm it: ca, lawyer or null');
    const present = Object.hasOwn(rule, 'confirmedBy') && rule.confirmedBy !== undefined;
    if (rule.needs === null) {
      refuse(!present, 'needs no one to confirm it, so it carries no confirmedBy');
    } else {
      refuse(present, `needs a ${WHO[rule.needs]} to confirm it, so it carries confirmedBy: null until they do, or who confirmed it and when`);
    }
    if (rule.confirmedBy) {
      const { name: who, on } = rule.confirmedBy;
      refuse(words(who), 'has a confirmation without the name of who confirmed it');
      refuse(typeof on === 'string' && validDate(on) && daysFrom(rule.checkedOn, on) >= 0 && daysFrom(on, today) >= 0, 'has a confirmation dated before it was checked or after today');
    } else {
      refuse(rule.confirmedBy === undefined || rule.confirmedBy === null, 'has a confirmation that is neither a name and a day nor null');
    }
  }
  return rules;
}

/** Who may have to confirm a rule, and how a sentence names them. */
const NEEDS = ['ca', 'lawyer'] as const;
const WHO: Readonly<Record<(typeof NEEDS)[number], string>> = Object.freeze({ ca: 'CA', lawyer: 'lawyer' });
/** Whether a client's work must wait on this rule: it needs a CA or lawyer, who has not confirmed it yet. */
const waitsForConfirmation = (rule: DatedRule): boolean => rule.needs !== null && rule.needs !== undefined && !rule.confirmedBy;

/** One rule on one day: how old its check is, its window, whether it is stale, unconfirmed or waiting for a CA or lawyer. */
export type RuleFreshness = {
  id: string;
  checkedOn: IsoDate;
  ageDays: number;
  windowDays: number;
  stale: boolean;
  /** Read as 'unconfirmed': kept without a source confirming it on the day. */
  unconfirmed: boolean;
  /** A rule a CA or lawyer must confirm (confirmedBy is null): rehearsal only until they do. */
  awaitingConfirmation: boolean;
  /** One plain sentence on its freshness, for the owner. */
  line: string;
};

/** The rule's window: its own recheckAfterDays, else 90. */
export const windowOf = (rule: DatedRule): number => rule.recheckAfterDays ?? RULE_RECHECK_DAYS;

/** How fresh one rule is on the owner's day: stale once more days than its window have passed (day 91 by default). */
export function ruleFreshness(rule: DatedRule, today: IsoDate): RuleFreshness {
  const ageDays = daysFrom(rule.checkedOn, today);
  const windowDays = windowOf(rule);
  const stale = ageDays > windowDays;
  const unconfirmed = rule.read === 'unconfirmed';
  const awaitingConfirmation = waitsForConfirmation(rule);
  const where = rule.read === 'house' ? '' : ' on its source page';
  const waiting = awaitingConfirmation ? ` A ${WHO[rule.needs!]} has not confirmed it yet, so it works in practice runs only.` : '';
  const line = stale
    ? `${rule.topic} was checked ${ageDays} days ago, on ${rule.checkedOn}. Check it again${where} before relying on it.${waiting}`
    : unconfirmed
      ? `Not confirmed against a source yet. ${rule.how}${waiting}`
      : `Current. ${rule.how}${waiting}`;
  return { id: rule.id, checkedOn: rule.checkedOn, ageDays, windowDays, stale, unconfirmed, awaitingConfirmation, line };
}

/** Every rule's freshness on the owner's day, with the counts: current (inside its window and confirmed), stale, unconfirmed. */
export function rulesFreshness(rules: readonly DatedRule[], today: IsoDate): { current: number; stale: RuleFreshness[]; unconfirmed: RuleFreshness[]; all: RuleFreshness[] } {
  const all = rules.map(rule => ruleFreshness(rule, today));
  const stale = all.filter(item => item.stale);
  const unconfirmed = all.filter(item => !item.stale && item.unconfirmed);
  return { current: all.length - stale.length - unconfirmed.length, stale, unconfirmed, all };
}

/** rulesFreshness on the business's own calendar day at an instant (localDayAt by its country), never the computer's. */
export function rulesFreshnessAt(rules: readonly DatedRule[], instant: Date | string, country: Pick<CountryProfile, 'code'>): ReturnType<typeof rulesFreshness> {
  return rulesFreshness(rules, localDayAt(instant, country));
}

/**
 * Check results with "This rule is not confirmed." at the end of the detail of each check that rests on a rule read
 * as unconfirmed (its id in that rule's usedBy). A check that did not run read no rule and is left as it is.
 */
export function noteUnconfirmed(results: readonly PlaybookCheckResult[], rules: readonly DatedRule[]): PlaybookCheckResult[] {
  const unsure = new Set(rules.filter(rule => rule.read === 'unconfirmed').flatMap(rule => rule.usedBy));
  return results.map(result => {
    if (result.outcome === 'not-run' || !unsure.has(result.check) || result.detail.endsWith(UNCONFIRMED_NOTE)) return { ...result };
    return { ...result, detail: `${result.detail.replace(/\s+$/, '')} ${UNCONFIRMED_NOTE}` };
  });
}

/** Whose work a rule is used for: a real client's order, or a practice run on made-up clients. */
export type RuleUse = 'client' | 'rehearsal';

/**
 * Refuses (RULE_UNCONFIRMED) a real client's work that rests on a rule a CA or lawyer must confirm and has not
 * (confirmedBy null), the way the CA firm's rate tables work in rehearsal only until the CA confirms them. used: the
 * step and check ids the work ran. A rehearsal goes on, and so does a rule that needs no such confirmation.
 */
export function requireConfirmedRules(rules: readonly DatedRule[], used: Iterable<string>, use: RuleUse): void {
  if (use === 'rehearsal') return;
  const ran = new Set(used);
  const waiting = rules.find(rule => waitsForConfirmation(rule) && rule.usedBy.some(id => ran.has(id)));
  check(!waiting, 'RULE_UNCONFIRMED', waiting
    ? `A ${WHO[waiting.needs!]} has not confirmed the rule "${waiting.topic}" yet. It works in practice runs only until they do.`
    : '');
}
