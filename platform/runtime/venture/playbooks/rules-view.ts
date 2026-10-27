// Chausar flagship playbooks: venture.rules.list (Ink v2 wave 2, package 2H; catalogue P1). The dated platform rules
// the business's playbook rests on, each with the day it was checked, whether it is past its recheck window today,
// the steps and checks that use it, what it does not cover and its source page; with the playbook's risk level and
// the day it was last reviewed. A read: nothing is written. Business > Plan and playbook shows it (RulesSection.tsx).
// Ink v2 wave 5 (5A3): a kit playbook's rules come from its definition, with its recipes and measurement boundaries
// (Recipes.tsx shows those).
import type { Context, State } from '../../contracts.ts';
import type { IsoDate, PlatformRuleView, RulesListView, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload } from '../records.ts';
import { acceptedBlueprintOrNull, readAs, todayIso } from '../delivery/shared.ts';
import { currentPlaybook, deliveryFlagship } from '../delivery/playbook.ts';
import { findPlaybook, pickPlaybook, type PlaybookRegistration } from './registry.ts';
import { playbookRules, rulesSummary, type DatedRule } from './rules-current.ts';
import type { PlaybookDefinition } from './kit/define.ts';
import { recipeViews } from './kit/recipes.ts';
import { boundaryViews } from './kit/boundaries.ts';
import { kitDefinitions } from './kit/installed.ts';

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
    usedBy: [...rule.usedBy], limitations: [...rule.limitations], source: rule.source ? { ...rule.source } : null,
    sources: rule.sources.map(source => ({ ...source })), line: rule.line,
  };
}

/**
 * The rules list of one registered playbook on the owner's day: its dated rules (the social or YouTube register, or a
 * kit definition's), and for a kit playbook its recipes and measurement boundaries (Ink v2 wave 5, 5A3). definitions:
 * the wave 5 list, or a test's own.
 */
export function rulesListOf(
  registration: Pick<PlaybookRegistration, 'id' | 'label' | 'riskLevel' | 'lastReviewed'>, today: IsoDate, definitions: readonly PlaybookDefinition[] = kitDefinitions(),
): RulesListView {
  const rules = playbookRules(registration.id, today, definitions);
  const kit = definitions.find(definition => definition.registration.id === registration.id);
  return {
    playbook: { id: registration.id, label: registration.label, riskLevel: registration.riskLevel, lastReviewed: registration.lastReviewed },
    rules: rules.map(viewOf),
    summary: rulesSummary(rules),
    recipes: kit ? recipeViews(kit.recipes) : [],
    boundaries: kit ? boundaryViews(kit.boundaries) : [],
  };
}

/** venture.rules.list {} (read): the playbook's dated rules on the owner's day; an empty list with no playbook. */
export async function rulesListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RulesListView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  const flagship = businessFlagship(state, venture);
  const registration = flagship ? findPlaybook(flagship) : null;
  if (!registration) return { playbook: null, rules: [], summary: NO_PLAYBOOK, recipes: [], boundaries: [] };
  return rulesListOf(registration, todayIso(deps, venture));
}
