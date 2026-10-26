// Chausar venture launcher, delivery package (Ink v2 wave 4, package 4J15, catalogue Q11): the shadow summary.
// At the shadow stage an agent's drafts for real orders are practice drafts that never reach a client. This view
// counts them, from those records only: what would have gone out (a draft that passed every check with nothing held),
// what was held (a failed check, a call the policy held for the owner, a question waiting, a failed or stopped run),
// and what the owner would have changed (practice drafts the owner rejected, or edited into different words; an edit
// saved with the same words counts as sent as is). A figure it cannot know is a
// dash: every figure before the first shadow draft, and "changed" until the owner reviewed one.
// It also says what to do before arming, each success condition with its bound: before the first run, a rehearsal on
// three sample orders; until the owner has watched one real order to its review, "Watch one real order end to end".
// One harness agent runs every role's steps, so a flagship team's roles share the team's shadow drafts.
// The summary strip and the bounded success conditions follow decionis SummaryStrip.tsx and DemoPolicyPack.tsx and the
// qm define-loop skill; rewrites, not copies.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, identifier, listRecords } from '../records.ts';
import type { DeliveryRunRecord, ShadowSummaryView, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from './playbook.ts';
import { acceptedBlueprintOrNull } from './shared.ts';
import { teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID } from '../views/shared.ts';

export const SHADOW_BOUND = 'or stop with a reason after 5 tries';
export const SHADOW_REHEARSE = `Before the first real order, rehearse on three sample orders: a routine one, a risky one and one that pushes on price. Run each until it passes, ${SHADOW_BOUND}.`;
export const SHADOW_WATCH = `Watch one real order end to end before arming: approve each turn until its draft is ready for your review, ${SHADOW_BOUND}.`;
const DASH = '-';
const REVIEWED: readonly DeliveryRunRecord['status'][] = ['ready-for-review', 'accepted', 'edited', 'rejected'];

/** Whether an agent id is on this business's team (Keeper is code): the delivery agent, or a flagship role with steps. */
function requireAgent(state: State, venture: VentureRecord | null, agentId: string): VentureRecord {
  check(agentId !== 'keeper', 'AGENT_IS_CODE', 'Keeper is code, not AI. It makes no drafts to count.');
  check(venture, 'AGENT_NOT_FOUND', 'That agent was not found.');
  const plan = acceptedBlueprintOrNull(state, venture);
  let steps = currentPlaybook(state, venture)?.steps ?? null;
  if (!steps && plan) { try { steps = playbookSteps(plan, deliveryFlagship(venture, plan)); } catch { steps = null; } }
  const flagship = teamFlagship(state, venture);
  const known = !!steps && (flagship ? steps.some(step => flagship.roleOf[step.id] === agentId) : agentId === AGENT_ID);
  check(known, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return venture;
}

function checksPassed(run: DeliveryRunRecord): boolean {
  return run.checks.every(result => result.passed || result.notChecked === true) && !(run.playbookChecks ?? []).some(result => result.outcome === 'fail');
}

/** Something stopped this practice draft for the owner: a check, a policy hold, a question, or the run itself. */
function heldFor(run: DeliveryRunRecord): boolean {
  if (run.status === 'failed' || run.status === 'stopped' || run.status === 'needs-answer' || run.status === 'brief-waiting') return true;
  if ((run.harness?.holds ?? []).length > 0) return true;
  return REVIEWED.includes(run.status) && !checksPassed(run);
}

const figure = (value: number | null) => (value === null ? DASH : String(value));
const words = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();

/**
 * Whether the owner's review changed what would have gone out: a rejection, or an edit whose words differ from the
 * draft. An edit saved with the same words is "send as is", not a change.
 */
function changedByYou(run: DeliveryRunRecord): boolean {
  if (run.verdict?.choice === 'rejected') return true;
  return run.verdict?.choice === 'edited' && words(run.editedText) !== words(run.renderedText);
}

/** The summary of this business's shadow drafts, read from the vault only. */
export function shadowSummary(state: State, venture: VentureRecord, agentId: string): ShadowSummaryView {
  const runs = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.servedBy === 'model');
  const shadow = runs.filter(run => run.practice);
  const known = shadow.length > 0;
  const gone = shadow.filter(run => REVIEWED.includes(run.status) && !heldFor(run)).length;
  const held = shadow.filter(heldFor).length;
  const reviewed = shadow.filter(run => run.verdict !== null);
  const changed = reviewed.length ? reviewed.filter(changedByYou).length : null;
  const offers: string[] = [];
  const rehearsed = listRecords(state, 'venture-simulation-run', venture.id).length > 0;
  if (!rehearsed && !known) offers.push(SHADOW_REHEARSE);
  if (!runs.some(run => run.verdict !== null)) offers.push(SHADOW_WATCH);
  const wouldHaveGone = known ? gone : null, heldCount = known ? held : null;
  return {
    agent: agentId, wouldHaveGone, held: heldCount, changed: known ? changed : null, offers,
    line: `Would have gone out ${figure(wouldHaveGone)}, held ${figure(heldCount)}, you would have changed ${figure(known ? changed : null)}`,
  };
}

/** venture.shadow.summary { agent } (read): what the agent's shadow drafts would have done, with a dash where unknown. */
export async function shadowSummaryHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ShadowSummaryView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agent = identifier(body.agent, 'Agent');
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = requireAgent(state, currentVenture(state), agent);
  return shadowSummary(state, venture, agent);
}
