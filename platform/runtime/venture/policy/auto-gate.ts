// Chausar venture launcher, policy (Ink v2 wave 4, package 4J15, catalogue Q10): auto with spot checks, built and locked.
// The founder's decision: auto with spot checks is built but locked. This file holds the lock and the readiness view.
// The lock lives in policy/auto-lock.ts: AUTO_LOCKED from venture.launch.advance (delivery/launch.ts) and
// venture.team.posture (views/team.ts) for the auto rung, at every rung and whatever readiness says; and the policy
// context caps every posture at approve each (policy/context.ts effectivePosture), so a vault that says auto, edited,
// imported or restored, still asks, and venture.policy.allowSession stays refused. Nothing in the engine opens it.
// venture.auto.readiness {agent} (read) says how close an agent is, per step and for the agent, from the vault only:
//   per step: a code check verifies it, its kind allows auto (an agent's step below the always-ask floor; never the
//   owner's own approval or a send), and the owner switched its gate to Auto;
//   for the agent: a real order it worked passed its checks and was accepted in the last 14 days, the spend log has
//   nothing held or unknown, the last two drill runs on the current playbook (so since its last change) both passed
//   within 30 days (the two clean drill runs the lock words name), and
//   no real run in the last 14 days was latched by outside content beyond the order itself (mail, a post, a web page)
//   or had content held by the screen.
// A decision model may lower friction but never authorises (decisionModelAdvice): any doubt goes to the owner.
// The checklist follows loop-engineering's loop-audit auditor.ts (fresh proof per agent and step), cloudflare-os
// auto-approval.ts and eve's approval policies (a model lowers friction, never authorises); rewrites, not copies.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, identifier, listRecords } from '../records.ts';
import type { AutoReadinessView, DeliveryRunRecord, PlaybookStep, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { acceptedBlueprintOrNull, newestFirst } from '../delivery/shared.ts';
import { teamFlagship } from '../views/team-shape.ts';
import { AGENT_ID } from '../views/shared.ts';
import { sessionStepFloor, stepGates } from './context.ts';
import { AUTO_LOCKED_WORDS, CLEAN_DRILL_RUNS } from './auto-lock.ts';

export { AUTO_LOCKED_WORDS, autoLocked, CLEAN_DRILL_RUNS } from './auto-lock.ts';

const KEEPER = 'keeper';
const DAY_MS = 86_400_000;
const REAL_RUN_DAYS = 14;
const DRILL_DAYS = 30;
const TAINT_DAYS = 14;
/**
 * Latch sources beyond the order itself: content from outside the client's own request and files. A real order is
 * latched from its first turn by its own request (and by its files), so those cannot count against readiness; a run
 * that read mail, a post or a web page, or had content the screen held, does (a decision recorded in the W4 plan).
 */
const OUTSIDE_LATCH: ReadonlySet<string> = new Set(['mail', 'post', 'web-page']);

/** The agent's steps: the playbook in use, else the accepted plan's steps (as the team view reads them). */
function agentSteps(state: State, venture: VentureRecord, agentId: string): PlaybookStep[] {
  check(agentId !== KEEPER, 'AGENT_IS_CODE', 'Keeper is code, not AI. It never works at auto or any other posture.');
  const playbook = currentPlaybook(state, venture);
  const plan = acceptedBlueprintOrNull(state, venture);
  let steps: PlaybookStep[] | null = playbook?.steps ?? null;
  if (!steps && plan) { try { steps = playbookSteps(plan, deliveryFlagship(venture, plan)); } catch { steps = null; } }
  check(steps, 'AGENT_NOT_FOUND', 'That agent was not found.');
  const flagship = teamFlagship(state, venture);
  const owned = flagship ? steps.filter(step => flagship.roleOf[step.id] === agentId) : agentId === AGENT_ID ? steps : [];
  check(owned.length > 0, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return owned;
}

type Item = AutoReadinessView['items'][number];
const met = (id: string, label: string, yes: boolean, line: string): Item => ({ id, label, met: yes, line });

function passedChecks(run: DeliveryRunRecord): boolean {
  return run.checks.every(result => result.passed || result.notChecked === true) && !(run.playbookChecks ?? []).some(result => result.outcome === 'fail');
}

/** What auto would need for this agent, per step and for the agent, as of now. Reads only; unlocks nothing. */
export function autoReadiness(state: State, venture: VentureRecord, agentId: string, now: Date): AutoReadinessView {
  const steps = agentSteps(state, venture, agentId);
  const nowMs = now.getTime();
  const within = (iso: string | null | undefined, days: number) => typeof iso === 'string' && nowMs - Date.parse(iso) <= days * DAY_MS;
  const gates = stepGates(state, venture.id, steps, AGENT_ID);
  const stepItems = steps.flatMap(step => {
    const floor = sessionStepFloor(state, venture, step);
    const kindLine = floor ?? (step.doneBy !== 'agent' || step.kind === 'approve' ? 'You do this step yourself, so it never runs on its own.' : 'An agent step below the always-ask floor.');
    const kindOk = floor === null && step.doneBy === 'agent' && step.kind !== 'approve';
    return [
      met(`verifier:${step.id}`, `${step.title}: a check verifies it`, step.checks.length > 0,
        step.checks.length > 0 ? `${step.checks.length} code ${step.checks.length === 1 ? 'check verifies' : 'checks verify'} this step.` : 'No code check verifies this step yet.'),
      met(`kind:${step.id}`, `${step.title}: its kind allows auto`, kindOk, kindLine),
      met(`owner:${step.id}`, `${step.title}: you switched it on`, gates[step.id] === 'auto',
        gates[step.id] === 'auto' ? 'You set this step to Auto on Team.' : 'This step is on Hold. Only you can set it to Auto, on Team.'),
    ];
  });
  const real = listRecords(state, 'venture-delivery-run', venture.id).filter(run => !run.practice && run.servedBy === 'model');
  const passedRecently = real.some(run => run.verdict?.choice === 'accepted' && within(run.verdict.at, REAL_RUN_DAYS) && passedChecks(run));
  const held = listRecords(state, 'venture-spend', venture.id).filter(row => row.phase === 'reserved' || row.phase === 'unknown').length;
  const playbook = currentPlaybook(state, venture);
  // The last two drill runs on the current playbook, since it last changed: both clean, both within 30 days.
  const drills = listRecords(state, 'venture-drill-run', venture.id);
  const sinceChange = playbook ? newestFirst(drills.filter(run => run.playbookHash === playbook.hash && run.at >= playbook.at)) : [];
  const lastTwo = sinceChange.slice(0, CLEAN_DRILL_RUNS);
  const freshDrill = lastTwo.length === CLEAN_DRILL_RUNS && lastTwo.every(run => run.passed && within(run.at, DRILL_DAYS));
  const drillLine = !drills.length ? 'Run the drills twice and have every drill pass both times.'
    : !sinceChange.length ? 'No drill run since the playbook last changed. Run the drills twice again.'
      : freshDrill ? 'The last two drill runs on the current playbook passed, within the last 30 days.'
        : lastTwo.some(run => !run.passed) ? 'A drill failed in one of the last two runs. Fix it, then run the drills twice clean.'
          : lastTwo.length < CLEAN_DRILL_RUNS ? `${lastTwo.length} clean drill run on the current playbook. It needs two in a row.`
            : 'A clean drill run is older than 30 days. Run the drills twice again.';
  const latched = real.filter(run => within(run.at, TAINT_DAYS) && run.harness
    && ((run.harness.taint && OUTSIDE_LATCH.has(run.harness.taint.source)) || run.harness.toolCalls.some(call => call.screen?.status === 'quarantined' || call.screen?.status === 'flagged'))).length;
  const agentItems = [
    met('real-run', 'A real order passed in the last 14 days', passedRecently,
      passedRecently ? 'A real order this agent worked passed its checks and you accepted it in the last 14 days.' : 'No real order passed in the last 14 days with every check passing and your Accept.'),
    met('spend-log', 'The spend log is complete', held === 0,
      held === 0 ? 'Every paid call is settled in the spend log.' : `${held} paid ${held === 1 ? 'call is' : 'calls are'} still held or unknown in the spend log.`),
    met('drills', 'Two clean drill runs within 30 days and since the last playbook change', freshDrill, drillLine),
    met('no-taint', 'No run was latched by outside content', latched === 0,
      latched === 0 ? 'No real run in the last 14 days read mail, a post or a web page, or had content held by the screen.' : `${latched} real ${latched === 1 ? 'run' : 'runs'} in the last 14 days read outside content beyond the order, or had content held by the screen.`),
  ];
  const agentReady = agentItems.every(entry => entry.met);
  const readySteps = agentReady ? steps.filter(step => stepItems.filter(entry => entry.id.endsWith(`:${step.id}`)).every(entry => entry.met)).length : 0;
  return {
    agent: agentId, items: [...stepItems, ...agentItems], locked: true,
    line: `${readySteps} of ${steps.length} steps ${readySteps === 1 ? 'has' : 'have'} every item met. ${AUTO_LOCKED_WORDS}`,
  };
}

/**
 * What a decision model's advice can do with readiness: never authorise. A go on an agent with every agent item met
 * may lower friction (fewer words to read before a spot check); a wait, an unsure, or a go on an agent that is not
 * ready hands it to the owner. Auto stays locked either way.
 */
export function decisionModelAdvice(readiness: AutoReadinessView, advice: 'go' | 'wait' | 'unsure'): { authorises: false; friction: 'lower' | 'as-is'; toOwner: boolean; line: string } {
  check(['go', 'wait', 'unsure'].includes(advice), 'INVALID_VENTURE_REQUEST', 'A decision model says go, wait or unsure.');
  const agentReady = readiness.items.filter(entry => !entry.id.includes(':')).every(entry => entry.met);
  const lower = advice === 'go' && agentReady;
  return {
    authorises: false, friction: lower ? 'lower' : 'as-is', toOwner: !lower,
    line: lower
      ? 'A decision model may lower friction but never authorises. You still decide each spot check.'
      : 'A decision model may lower friction but never authorises. Any doubt goes to you.',
  };
}

/** venture.auto.readiness { agent } (read): how close an agent is to auto with spot checks, which stays locked. */
export async function autoReadinessHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AutoReadinessView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agent = identifier(body.agent, 'Agent');
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  check(agent !== KEEPER, 'AGENT_IS_CODE', 'Keeper is code, not AI. It never works at auto or any other posture.');
  check(venture, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return autoReadiness(state, venture, agent, deps.clock());
}
