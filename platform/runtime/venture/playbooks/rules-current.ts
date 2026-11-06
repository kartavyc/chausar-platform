// Chausar flagship playbooks: the dated platform rules a playbook's checks rest on, and how fresh they are on a day
// (Ink v2 wave 2, package 2H; catalogue P1). One shape over the two registers, social/register.ts and
// youtube/platform-rules.ts, read by venture.rules.list (rules-view.ts) and by the rules-current result on a draft's
// checks (draft-checks.ts). Code only, no model, no clock inside: the caller passes the owner's day.
//
// rules-current names the rules a finding quoted, then the rules whose usedBy holds a check that ran on the draft (a
// check that says "not run" read nothing). On a social draft only the rules for its own channels count (a Meta rule
// with an Instagram or Facebook post), and an export rule only for an export the run's report read. A rule past its
// recheck window makes the result 'not-run' naming it, never a pass; it never blocks Accept, as only 'fail' does. The
// line fits the run view's label (views/runs.ts cuts at 160 characters, "Not checked: " included), so its count and
// "Recheck them." always show; the full list is on the business page.
//
// Idea taken, code written here: xjli360/sealeap-ecommerce-skills (MIT), whose rule refresh lists, per rule, the
// skills it is used by and its limitations, and whose catalogue gives each skill a risk level and a last review date.
import type { IsoDate, PlaybookCheckResult } from '../contracts.ts';
import { RULE_STALE_AFTER_DAYS, SOCIAL_RULES_REGISTER, daysBetween, rulesFreshness } from './social/register.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { PLATFORM_RULES, ruleFreshness } from './youtube/platform-rules.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';

export const RULES_CURRENT_CHECK = 'rules-current';
/** The longest rules-current line: the run view's 160-character label less its "Not checked: " prefix. */
export const RULES_CURRENT_MAX = 147;

/** One dated rule, the same shape for every register. */
export type DatedRule = {
  id: string;
  /** The platform or region the rule is about, as its register writes it ('linkedin', 'meta', 'india', 'youtube'). */
  platform: string;
  /** 'export' for a rule about a platform's export file; null where the register has no topics (YouTube). */
  topic: string | null;
  /** A short name for lists: the rule's title, else the first sentence of a social rule. */
  name: string;
  /** The rule in plain words, as the owner reads it. */
  rule: string;
  checkedOn: IsoDate;
  ageDays: number;
  /** The days after checkedOn the rule stays current. */
  windowDays: number;
  stale: boolean;
  /** Kept from earlier notes, not confirmed against a source. */
  unconfirmed: boolean;
  usedBy: readonly string[];
  limitations: readonly string[];
  source: { title: string; url: string } | null;
  /** One plain sentence on the rule's freshness. */
  line: string;
};

/** What a social draft's checks read: the channels of its posts, the platforms its report's exports came from, and the rules its findings quoted, in order. */
export type RuleScopeOfRun = { channels: readonly string[]; exports: readonly string[]; quoted: readonly string[] };

/** The first sentence of a rule, without its full stop. */
function firstSentence(text: string): string {
  return text.split(/(?<=\.)\s+/)[0].replace(/\.$/, '');
}

function socialRules(today: IsoDate): DatedRule[] {
  const { stale: old, unconfirmed: unsure } = rulesFreshness(today);
  // Each item carries the register's own line (the stale one when a rule is both stale and unconfirmed).
  const freshness = new Map([...unsure, ...old].map(item => [item.id, item]));
  return SOCIAL_RULES_REGISTER.map(rule => {
    const ageDays = daysBetween(rule.checkedOn, today);
    return {
      id: rule.id, platform: rule.scope, topic: rule.topic, name: rule.title ?? firstSentence(rule.rule), rule: rule.rule, checkedOn: rule.checkedOn, ageDays,
      windowDays: RULE_STALE_AFTER_DAYS, stale: ageDays > RULE_STALE_AFTER_DAYS, unconfirmed: rule.read === 'unconfirmed',
      usedBy: rule.usedBy, limitations: rule.limitations,
      source: rule.sources[0] ? { title: rule.sources[0].title, url: rule.sources[0].url } : null,
      line: freshness.get(rule.id)?.line || `Current. ${rule.how}`,
    };
  });
}

function youtubeRules(today: IsoDate): DatedRule[] {
  return PLATFORM_RULES.map(rule => {
    const ageDays = daysBetween(rule.checkedOn, today);
    const stale = ruleFreshness(rule, today) === 'recheck';
    return {
      id: rule.id, platform: rule.platform, topic: null, name: rule.title, rule: `${rule.title}: ${rule.rule}`, checkedOn: rule.checkedOn, ageDays,
      windowDays: rule.recheckAfterDays, stale, unconfirmed: false, usedBy: rule.usedBy, limitations: rule.limitations,
      source: { title: rule.sourceTitle, url: rule.sourceUrl },
      line: stale
        ? `${rule.title} was checked ${ageDays} days ago, on ${rule.checkedOn}. Check it again on its source page before relying on it.`
        : `Current. Read on ${rule.sourceTitle}, checked on ${rule.checkedOn}.`,
    };
  });
}

/** A flagship playbook's dated platform rules on a day, in register order. Empty for a playbook with none (the CA firm dates its rate tables instead). */
export function playbookRules(flagship: string | null | undefined, today: IsoDate): DatedRule[] {
  if (flagship === SOCIAL_AGENCY_ID) return socialRules(today);
  if (flagship === YOUTUBE_ID) return youtubeRules(today);
  return [];
}

/**
 * "n current, m to recheck." for the business page, with the rules inside their window but not confirmed against a
 * source counted apart. The three counts never overlap: a stale rule counts once, as one to recheck.
 */
export function rulesSummary(rules: readonly DatedRule[]): string {
  if (!rules.length) return 'This playbook rests on no dated platform rules.';
  const stale = rules.filter(rule => rule.stale).length;
  const unsure = rules.filter(rule => !rule.stale && rule.unconfirmed).length;
  return `${rules.length - stale - unsure} current, ${stale} to recheck${unsure ? `, ${unsure} not confirmed against a source yet` : ''}.`;
}

/** Whether a social rule is about this draft: its own channels, Meta's with Instagram or Facebook, any region-wide rule, an export its report read. */
function aboutThisDraft(rule: DatedRule, scope: RuleScopeOfRun): boolean {
  if (rule.topic === 'export') return scope.exports.includes(rule.platform);
  if (['all', 'india', 'united-states'].includes(rule.platform)) return true;
  if (rule.platform === 'meta') return scope.channels.includes('instagram') || scope.channels.includes('facebook');
  return scope.channels.includes(rule.platform);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Names in order, as many as fit in room characters; the rest counted ("; plus 3 more"). A name that does not fit is
 * passed over for a shorter one after it, so the line names as many rules as it can.
 */
function fitNames(rules: readonly DatedRule[], room: number): string {
  const all = rules.map(rule => rule.name).join('; ');
  if (all.length <= room) return all;
  const shown: string[] = [];
  const left = room - `; plus ${rules.length} more`.length;
  for (const rule of rules) {
    const next = shown.length ? `${shown.join('; ')}; ${rule.name}` : rule.name;
    if (next.length <= left) shown.push(rule.name);
  }
  const more = rules.length - shown.length;
  return shown.length ? `${shown.join('; ')}; plus ${more} more` : `${more} of them`;
}

/**
 * The rules-current result for a draft whose checks ran, or null when they rest on no dated rule. 'not-run' names the
 * rules past their window; 'pass' counts the rules checked inside it and, apart, the ones not confirmed against a source
 * yet, naming those. scope narrows a social draft to its channels and puts the rules its findings quoted first.
 */
export function rulesCurrentResult(flagship: string | null | undefined, today: IsoDate, ran: Iterable<string>, scope?: RuleScopeOfRun): Pick<PlaybookCheckResult, 'check' | 'outcome' | 'detail'> | null {
  const checks = new Set(ran);
  const all = playbookRules(flagship, today);
  const quoted = (scope?.quoted ?? []).flatMap(id => all.filter(rule => rule.id === id));
  const used = all.filter(rule => rule.usedBy.some(id => checks.has(id)) && (!scope || aboutThisDraft(rule, scope)));
  const rules = [...new Map([...quoted, ...used].map(rule => [rule.id, rule])).values()];
  if (!rules.length) return null;
  const stale = rules.filter(rule => rule.stale);
  if (stale.length) {
    const windows = [...new Set(stale.map(rule => rule.windowDays))];
    const lead = `not run: ${plural(stale.length, 'rule', 'rules')} past ${windows.length === 1 ? `${stale.length === 1 ? 'its' : 'their'} ${windows[0]}-day recheck` : 'their recheck windows'}: `;
    const tail = `. Recheck ${stale.length === 1 ? 'it' : 'them'}.`;
    return { check: RULES_CURRENT_CHECK, outcome: 'not-run', detail: `${lead}${fitNames(stale, RULES_CURRENT_MAX - lead.length - tail.length)}${tail}` };
  }
  const windows = [...new Set(rules.map(rule => rule.windowDays))];
  const within = windows.length === 1 ? `within ${windows[0]} days` : 'within their recheck windows';
  const unsure = rules.filter(rule => rule.unconfirmed);
  const sure = rules.length - unsure.length;
  if (!unsure.length) return { check: RULES_CURRENT_CHECK, outcome: 'pass', detail: `${plural(sure, 'rule', 'rules')} checked ${within}.` };
  const lead = sure
    ? `${plural(sure, 'rule', 'rules')} checked ${within}, and ${unsure.length} not confirmed against a source yet: `
    : `${plural(unsure.length, 'rule', 'rules')} not confirmed against a source yet: `;
  return { check: RULES_CURRENT_CHECK, outcome: 'pass', detail: `${lead}${fitNames(unsure, RULES_CURRENT_MAX - lead.length - 1)}.` };
}
