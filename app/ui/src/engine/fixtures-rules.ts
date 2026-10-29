import {landedKitRules} from './landed-kit-rules';
import {formsRules} from './forms-rules';
/**
 * The fake engine's answer for the dated platform rules (venture.rules.list, Ink v2 wave 2, package 2H). The rules and
 * the playbooks' risk levels are the engine's own (fixtures-rules-data.ts, made from its registers), and the words for
 * freshness and the summary follow the engine (platform/runtime/venture/playbooks/rules-current.ts and the social
 * register's rulesFreshness). The fake works out freshness from its own clock the way the engine does; the screen
 * never does.
 */

import type { PlatformRuleView, RulesListView } from './types';
import { PLAYBOOK_REVIEW, RULE_DATA } from './fixtures-rules-data';
import { devAsksKitSample, kitSampleRules } from './fake-kit-rules';

/** One rule as the engine's registers give it, with its line while inside its window. */
export interface SampleRule {
  id: string; kind: 'social' | 'youtube'; platform: string; name: string; rule: string; checkedOn: string; windowDays: number;
  unconfirmed: boolean; usedBy: string[]; limitations: string[]; source: { title: string; url: string } | null;
  /** 5A3: every source the engine lists for the rule. */
  sources: { title: string; url: string }[];
  freshLine: string;
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00.000Z`) / 86400000);

function viewOf(rule: SampleRule, today: string): PlatformRuleView {
  const age = dayNumber(today) - dayNumber(rule.checkedOn);
  const stale = age > rule.windowDays;
  const staleLine = rule.kind === 'youtube'
    ? `${rule.name} was checked ${age} days ago, on ${rule.checkedOn}. Check it again on its source page before relying on it.`
    : `The rule "${rule.rule}" was checked ${age} days ago, on ${rule.checkedOn}. Check it again before relying on it.`;
  return {
    id: rule.id, platform: rule.platform, rule: rule.rule, checkedOn: rule.checkedOn, stale,
    usedBy: [...rule.usedBy], limitations: [...rule.limitations], source: rule.source ? { ...rule.source } : null,
    sources: rule.sources.map((source) => ({ ...source })),
    line: stale ? staleLine : rule.freshLine,
  };
}

/** venture.rules.list for a business on a playbook (by id and label) on a day; a null playbook for a business on none. */
export function rulesListFor(playbook: { id: string; label: string } | null | undefined, today: string): RulesListView {
  if(playbook?.id==='data-entry-desk')return formsRules(today) as RulesListView;
  const landed=playbook?landedKitRules(playbook.id,today):null;
  if(landed)return landed;
  const review = playbook ? PLAYBOOK_REVIEW[playbook.id] : undefined;
  // 5A3: the dev page's ?kit-sample shows a kit playbook's rules, recipes and boundaries (no kit playbook has landed yet).
  if (devAsksKitSample()) return kitSampleRules(today);
  if (!playbook || !review) return { playbook: null, rules: [], summary: 'This business follows no playbook with dated platform rules.', recipes: [], boundaries: [] };
  const sample = RULE_DATA[playbook.id] ?? [];
  const rules = sample.map((rule) => viewOf(rule, today));
  const stale = rules.filter((rule) => rule.stale).length;
  const unsure = sample.filter((rule, index) => rule.unconfirmed && !rules[index]!.stale).length;
  return {
    playbook: { id: playbook.id, label: playbook.label, ...review },
    rules,
    // A playbook with no dated platform rules (the CA firm dates its rate tables on Your CA) gets the engine's words.
    summary: rules.length
      ? `${rules.length - stale - unsure} current, ${stale} to recheck${unsure ? `, ${unsure} not confirmed against a source yet` : ''}.`
      : 'This playbook rests on no dated platform rules.',
    // 5A3: recipes and boundaries come from a kit playbook's definition; the flagships have none.
    recipes: [], boundaries: [],
  };
}
