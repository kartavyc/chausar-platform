// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1, M19): which AI answers for each role.
// venture.models.roles lists each agent of the team with the model tiers its steps use, as the playbook says ('fast'
// for the work, 'main' for checking and writing), the preset that serves each tier now and that preset's price line
// (list prices in US dollars, and in rupees beside them at the owner's own rate when one is set). One harness agent runs
// every role's steps, so a role's AI is its tier's AI: choosing another connected AI for a tier uses today's tier
// routing, a different AI per role is not offered, and the answer says so. A tier served by the built-in templates, or
// by an AI that cannot run now, is not usable: agents that need the AI wait until the owner connects one.
import { authorize, type Context, type State } from '../../contracts.ts';
import type { ModelPresetId, ModelStatusView, ModelTier, PlaybookStep, RoleModelView, RoleModelsView, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, formatMicros, formatVentureDate } from '../records.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { flagshipDelivery } from '../playbooks/steps.ts';
import { AGENT_ID, agentName } from '../views/shared.ts';
import { rupeeFigure, rupeeRateWords, rupeesOf } from '../money/spend.ts';
import { CLI_LABELS, presetSpec } from './presets.ts';

export { NOT_REPORTED } from './types.ts';
export { writtenByLine } from './written-by.ts';

export const ROLE_WORDS = Object.freeze({
  oneAgent: 'Your team runs as one agent, so each role uses the AI that serves its kind of job: fast for the work, main for checking and writing. Choose them under Your AI. A different AI for each role is not offered.',
  connect: 'Connect your AI: until then, agents that need it wait.',
  templates: 'Free. Nothing is sent to any AI.',
});

const TIER_ORDER: readonly ModelTier[] = ['fast', 'main'];

/** The tiers a set of steps uses, in the order fast then main. Code steps use none. */
function tiersOf(steps: readonly PlaybookStep[]): ModelTier[] {
  const used = new Set(steps.map(step => step.model).filter((tier): tier is ModelTier => tier !== null));
  return TIER_ORDER.filter(tier => used.has(tier));
}

/** The team's agents and their steps: a flagship playbook's agent roles, else the one delivery agent. Keeper is code. */
function teamRoles(state: State, venture: VentureRecord): { agent: string; name: string; steps: PlaybookStep[] }[] {
  const playbook = currentPlaybook(state, venture);
  let steps: PlaybookStep[] | null = playbook?.steps ?? null;
  let flagshipId: string | null | undefined = playbook ? playbook.flagship : null;
  if (!playbook) {
    const plan = acceptedBlueprintOrNull(state, venture);
    if (!plan) return [];
    flagshipId = deliveryFlagship(venture, plan);
    try { steps = playbookSteps(plan, flagshipId); } catch { return []; }
  }
  if (!steps) return [];
  const flagship = flagshipDelivery(flagshipId);
  if (!flagship) return [{ agent: AGENT_ID, name: agentName(state, venture), steps }];
  return flagship.roles.filter(role => role.kind === 'agent')
    .map(role => ({ agent: role.id, name: role.name, steps: steps!.filter(step => flagship.roleOf[step.id] === role.id) }));
}

/**
 * The price line of the preset serving a tier: its list price per million tokens with where the price came from and
 * when it was checked (an unconfirmed price says so), and in rupees at the owner's rate when one is set. The owner's
 * own command-line tool runs on their own plan; the templates send nothing.
 */
function priceLine(state: State, venture: VentureRecord, presetId: ModelPresetId): string {
  const spec = presetSpec(presetId);
  if (spec.kind === 'template') return ROLE_WORDS.templates;
  if (spec.kind === 'claude-cli' || spec.kind === 'codex-cli') {
    return `Runs on your own ${CLI_LABELS[spec.kind === 'claude-cli' ? 'claude-code' : 'codex']} plan. Chausar adds no charge.`;
  }
  const table = spec.priceTable;
  if (!table) return 'No list price is recorded for this AI.';
  const checked = formatVentureDate(table.checkedOn, venture.country.dateOrder ?? 'day-month-year');
  const parts = [
    `${formatMicros(table.inputMicrosPerMillion)} in, ${formatMicros(table.outputMicrosPerMillion)} out per million tokens.`,
    `${table.source}, checked ${checked}${table.confirmed ? '' : ', price unconfirmed'}.`,
  ];
  const rupees = rupeesOf(state, venture);
  if (rupees) parts.push(`In rupees: ${rupeeFigure(table.inputMicrosPerMillion, rupees)} in, ${rupeeFigure(table.outputMicrosPerMillion, rupees)} out at ${rupeeRateWords(rupees)}.`);
  return parts.join(' ');
}

/** A tier is usable for an agent only when a connected AI, not the templates, serves it and can run now. */
function usableTier(tier: ModelStatusView['tiers'][ModelTier]): boolean {
  return tier.usable && tier.presetId !== 'built-in-templates';
}

/**
 * "Connect your AI" while no tier is served by a connected AI that can run now (not installed, signed out, no key,
 * sending nothing, or only templates), for an idle agent's now line on Team (spec 8); null once one can run.
 */
export function aiWaitLine(status: ModelStatusView): string | null {
  return TIER_ORDER.some(tier => usableTier(status.tiers[tier])) ? null : 'Connect your AI';
}

/** venture.models.roles (read): each agent's tiers, the preset serving each and its price line. Never writes. */
export async function rolesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RoleModelsView> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return { roles: [], line: ROLE_WORDS.oneAgent };
  const status = deps.models.status(ctx);
  const roles: RoleModelView[] = teamRoles(state, venture).map(role => ({
    agent: role.agent, name: role.name,
    tiers: tiersOf(role.steps).map(tier => {
      const serving = status.tiers[tier];
      return { tier, presetId: serving.presetId, model: serving.model, price: priceLine(state, venture, serving.presetId), usable: usableTier(serving) };
    }),
  })).filter(role => role.tiers.length > 0);
  const waiting = roles.length > 0 && roles.every(role => role.tiers.every(tier => !tier.usable));
  return { roles, line: waiting ? `${ROLE_WORDS.oneAgent} ${ROLE_WORDS.connect}` : ROLE_WORDS.oneAgent };
}
