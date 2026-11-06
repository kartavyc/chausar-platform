// Chausar flagship playbooks: venture.rules.list (Ink v2 wave 2, package 2H; catalogue P1). The dated platform rules
// the business's playbook rests on, each with the day it was checked, whether it is past its recheck window today,
// the steps and checks that use it, what it does not cover and its source page; with the playbook's risk level and
// the day it was last reviewed. A read: nothing is written. Business > Plan and playbook shows it (RulesSection.tsx).
import type { Context, State } from '../../contracts.ts';
import type { PlatformRuleView, RulesListView, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload } from '../records.ts';
import { acceptedBlueprintOrNull, readAs, todayIso } from '../delivery/shared.ts';
import { currentPlaybook, deliveryFlagship } from '../delivery/playbook.ts';
import { findPlaybook, pickPlaybook } from './registry.ts';
import { playbookRules, rulesSummary, type DatedRule } from './rules-current.ts';

const NO_PLAYBOOK = 'This business follows no playbook with dated platform rules.';

/**
 * The flagship playbook the business runs: the playbook in use's, else the accepted plan's (as delivery picks it),
 * else, before a plan is accepted, the one the idea picks (the playbook the plan page names).
 */
function businessFlagship(state: State, venture: VentureRecord): string | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.flagship ?? null;
  const plan = acceptedBlueprintOrNull(state, venture);
  return plan ? deliveryFlagship(venture, plan) : pickPlaybook(venture.idea)?.id ?? null;
}

function viewOf(rule: DatedRule): PlatformRuleView {
  return {
    id: rule.id, platform: rule.platform, rule: rule.rule, checkedOn: rule.checkedOn, stale: rule.stale,
    usedBy: [...rule.usedBy], limitations: [...rule.limitations], source: rule.source ? { ...rule.source } : null, line: rule.line,
  };
}

/** venture.rules.list {} (read): the playbook's dated rules on the owner's day; an empty list with no flagship playbook. */
export async function rulesListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RulesListView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const flagship = businessFlagship(state, venture);
  const registration = flagship ? findPlaybook(flagship) : null;
  if (!registration) return { playbook: null, rules: [], summary: NO_PLAYBOOK };
  const rules = playbookRules(registration.id, todayIso(deps, venture));
  return {
    playbook: { id: registration.id, label: registration.label, riskLevel: registration.riskLevel, lastReviewed: registration.lastReviewed },
    rules: rules.map(viewOf),
    summary: rulesSummary(rules),
  };
}
