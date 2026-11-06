// Chausar venture launcher, views (P1-A): the team. venture.team.list, venture.team.gate and venture.team.posture.
// This build has one agent per business, the delivery agent its playbook describes; its steps are the playbook's.
// Each step has a gate: 'hold' asks the owner, 'auto' lets the step run. Gates start on hold. Steps in the always-ask
// floor (money out, sending to a client or the public, deleting, changing prices, anything on a government portal)
// stay on hold at every posture, so a request to set one to auto is refused with GATE_FLOOR. This view stores the
// gate; venture/policy checks it before each harness tool call. The posture shown is the one the agent works at: the
// launch stage tightened by the agent's own posture (policy/context.ts). venture.team.posture stores that own posture:
// the same rung as the business or a tighter one, never a looser one (POSTURE_ABOVE_STAGE). The floor asks at every rung.
// Ink v2 wave 4 (4A1, spec 5.1): each agent's department (playbooks/departments.ts), kind, state and health from facts
// (views/health.ts) and who set its posture; Keeper, the engine's own jobs as code (views/keeper.ts), listed last; the
// five departments with their counts, jobs, spend and series and the team's totals (views/team-series.ts).
// venture.team.clearQuarantine lets the owner clear a quarantined agent, or the team ('team'), with the health digest
// they saw; this file installs the quarantine check delivery runs before work moves on (delivery/quarantine-gate.ts).
// Keeper has no steps or posture to change. The team's flagship comes from views/team-shape.ts, shared with Money.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, formatMicros, identifier, listRecords, requireAppChannel, sumMicros, ventureAction } from '../records.ts';
import type { AgentHealth, AgentPostureRecord, AgentView, HealthClearRecord, PlaybookStep, Posture, TeamGateRecord, TeamListView, VentureDeps, VentureRecord } from '../contracts.ts';
import type { FlagshipDelivery } from '../playbooks/steps.ts';
import { effectivePosture, STEP_FLOOR_WORDS, stepFloorReason } from '../policy/context.ts';
import { POSTURES, postureOfStage, postureRank, stepGate } from '../policy/posture.ts';
import { ESTIMATE_WORDS } from '../models/cost.ts';
import { departmentOfMember, teamLedger, type TeamLedger } from '../money/department-spend.ts';
import { installQuarantineCheck } from '../delivery/quarantine-gate.ts';
import { deliveryRunDetails } from './runs.ts';
import { memberHealth, memberState, TEAM_ID, teamFacts, teamHealthOf, type TeamMember } from './health.ts';
import { withRefusals } from './refusals.ts';
import { KEEPER_ID, keeperAgent } from './keeper.ts';
import { departmentViews } from './team-series.ts';
import { teamFlagship } from './team-shape.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { AGENT_ID, AGENT_PURPOSES, agentName, clientNameFor, lastEventAt, plain } from './shared.ts';
import { pausedNow } from '../delivery/run-guards.ts';
import { aiWaitLine } from '../models/roles.ts';
import { autoLocked } from '../policy/auto-lock.ts';
import { nestTeam, roleSpend } from '../agents/relay.ts';

/**
 * "Connect your AI" while no connected AI that can run now serves a tier (models/roles.ts, spec 8), for an idle agent's
 * now line; null once one can. A status that cannot be read (the models package not loaded) leaves the plain words.
 */
function aiWaitFor(deps: VentureDeps, ctx: Context): string | null {
  try { return aiWaitLine(deps.models.status(ctx)); } catch { return null; }
}

const ROLE = 'Reads each order, works on it with tools, and drafts the reply for you to check.';
export const FLOOR_WORDS = STEP_FLOOR_WORDS;
const KEEPER_IS_CODE = 'Keeper is code, not AI. It has no steps or posture to change; its jobs are on Team.';
const CLEAR_STALE = "This agent's health changed since you looked, or it is not quarantined now. Look again before clearing it.";

/** Why a step is in the always-ask floor, or null. Code decides from the step's kind and its tools' effects. */
export function floorReason(step: PlaybookStep): string | null {
  return stepFloorReason(step);
}

/** The agent's steps: the playbook in use, else the accepted plan's steps (worked out, never stored, here). */
function agentSteps(state: State, venture: VentureRecord): PlaybookStep[] | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  try { return playbookSteps(plan, deliveryFlagship(venture, plan)); } catch { return null; }
}

/** Why a step asks at every posture: code's floor from its kind and tools, else the flagship playbook's own floor. */
function stepFloor(step: PlaybookStep, flagship: FlagshipDelivery | null): string | null {
  return floorReason(step) ?? flagship?.floor[step.id] ?? null;
}

/** Whether an agent id is one of this team's: the one delivery agent, or a flagship playbook's role that does steps. */
function knownAgent(flagship: FlagshipDelivery | null, steps: readonly PlaybookStep[], agentId: string): boolean {
  return flagship ? steps.some(step => flagship.roleOf[step.id] === agentId) : agentId === AGENT_ID;
}

function spendOf(state: State, venture: VentureRecord): string {
  const calls = state.conversations.filter((record: any) => record?.kind === 'venture-model-call' && record.ventureId === venture.id
    && AGENT_PURPOSES.includes(record.purpose) && typeof record.costMicros === 'string' && /^\d{1,30}$/.test(record.costMicros)) as { costMicros: string; priceConfirmed?: unknown }[];
  const total = formatMicros(sumMicros(calls.map(call => call.costMicros)));
  return calls.some(call => call.priceConfirmed === false) ? `${total}${ESTIMATE_WORDS}` : total;
}

/**
 * The team. One delivery agent for the eight fixed steps; for a flagship playbook, one agent per role that does an
 * agent or code step (playbooks/steps.ts), each with its own steps. One harness agent runs every role's steps, so
 * the gates, the posture and the spend are the team's: stored and read under AGENT_ID, as the policy reads them.
 */
function agentViews(deps: VentureDeps, state: State, venture: VentureRecord, ledger: TeamLedger = teamLedger(state, venture), aiWait: string | null = null): AgentView[] {
  return teamNow(deps, state, venture, ledger, aiWait).agents;
}

/**
 * The team as it stands: its agents (Keeper last) and the team's own health; no agents and no team health before a plan.
 * aiWait: the words an idle agent that needs an AI shows instead of Idle while none can run (aiWaitFor).
 */
function teamNow(deps: VentureDeps, state: State, venture: VentureRecord, ledger: TeamLedger, aiWait: string | null = null): { agents: AgentView[]; teamHealth: AgentHealth | null } {
  const steps = agentSteps(state, venture);
  if (!steps) return { agents: [], teamHealth: null };
  const flagship = ledger.flagship;
  const posture = effectivePosture(state, venture);
  const gates = new Map<string, 'auto' | 'hold'>();
  for (const record of listRecords(state, 'venture-team-gate', venture.id)) if (record.agentId === AGENT_ID) gates.set(record.stepId, record.gate);
  const runs = deliveryRunDetails(deps, state, venture);
  const busy = runs.find(run => run.state === 'waiting' || run.state === 'active');
  const step = busy?.steps.find(item => item.state === 'waiting' || item.state === 'current');
  const nowFor = (owns: (stepId: string) => boolean, needsAi = true): string => {
    // Ink v2 wave 4 (4F1): while the owner has paused the business, every agent reads Paused.
    if (pausedNow(state, venture.id)) return 'Paused';
    // An idle agent that needs an AI waits for one while none can run (spec 8); a code role never does.
    if (!busy || (step && !owns(step.id))) return (needsAi ? aiWait : null) ?? 'Idle';
    return busy.state === 'active' ? `Working: ${step?.purpose ?? busy.purpose}` : `Waiting on you: ${step?.purpose ?? busy.purpose}`;
  };
  const reviewed = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.verdict !== null)
    .sort((a, b) => (b.verdict!.at).localeCompare(a.verdict!.at))[0];
  const verdictWords = { accepted: 'accepted', edited: 'edited by you', rejected: 'rejected' } as const;
  const receiptId = reviewed?.harness?.workReceiptIds.at(-1);
  const last = reviewed ? { last: { line: `Draft for ${clientNameFor(state, venture.id, reviewed.orderId)} ${verdictWords[reviewed.verdict!.choice]}.`, ...(receiptId ? { receiptId } : {}) } } : {};
  const stepView = (item: PlaybookStep) => {
    // Gates start on hold at every posture: auto with spot checks lets a step run alone only once the owner set it to auto.
    const floor = stepFloor(item, flagship) !== null;
    return { id: item.id, purpose: item.title, gate: stepGate(gates.get(item.id), floor), floor };
  };
  // Ink v2 wave 4 (4A1): department, kind, state and health from facts, who set the posture, and Keeper last.
  const members: TeamMember[] = flagship
    ? flagship.roles.filter(role => steps.some(item => flagship.roleOf[item.id] === role.id)).map(role => ({ id: role.id, kind: role.kind, owns: (stepId: string) => flagship.roleOf[stepId] === role.id }))
    : [{ id: AGENT_ID, kind: 'agent', owns: () => true }];
  const records = listRecords(state, 'venture-delivery-run', venture.id);
  // The facts behind health, worked out once for the whole team (views/health.ts).
  const known = teamFacts(ledger, members, records);
  const times = lastEventAt(state, venture.id);
  const postureSetBy = listRecords(state, 'venture-agent-posture', venture.id).some(record => record.agentId === AGENT_ID) ? 'agent' as const : 'business' as const;
  const facts = (member: TeamMember) => ({
    department: departmentOfMember(ledger, member.id), kind: member.kind, state: memberState(member.owns, runs),
    health: withRefusals(memberHealth(deps, state, venture, member, runs, known, times), state, venture, member, deps.clock().toISOString()), postureSetBy, chat: member.kind === 'agent',
  });
  const keeper = keeperAgent(state, venture, posture);
  const teamHealth = teamHealthOf(known);
  if (!flagship) {
    return { agents: [plain({ id: AGENT_ID, name: agentName(state, venture), role: ROLE, now: nowFor(() => true), posture, spend: spendOf(state, venture), ...last, steps: steps.map(stepView), ...facts(members[0]) }), keeper], teamHealth };
  }
  const spend = `${spendOf(state, venture)} for the whole team`;
  const drafter = flagship.roleOf[flagship.draftStep(null)];
  // 4J12 (H25): a helper names the role it reports to among the members shown, with spend rolled up to its parent
  // (agents/relay.ts nestTeam). No shipped role has a parent in W4, so this leaves the team as it is.
  const nested = nestTeam(members.map(member => {
    const role = flagship.roles.find(item => item.id === member.id)!;
    return plain({
      id: role.id, name: role.name, role: role.job, now: nowFor(member.owns, member.kind === 'agent'), posture, spend,
      ...(role.id === drafter ? last : {}), steps: steps.filter(item => member.owns(item.id)).map(stepView), ...facts(member),
    });
  }), flagship, () => roleSpend(ledger), spendOf(state, venture).endsWith(ESTIMATE_WORDS) ? ESTIMATE_WORDS : '');
  return {
    agents: [...nested, keeper],
    teamHealth,
  };
}

/**
 * venture.team.list (read): the agents of this business, Keeper last; none, and no Keeper, until a plan is accepted.
 * With a business, the five departments too (counts, jobs this week, spend this month, the six-week series), the spend
 * no single role can claim, the team's totals (Money's own spend figure among them) and the team's own health, each
 * figure with its sum receipt (reading may write a receipt for a sum not seen before). One ledger serves the request.
 */
export async function teamListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<TeamListView> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  if (!venture) return { agents: [] };
  const ledger = teamLedger(state, venture);
  const { agents, teamHealth } = teamNow(deps, state, venture, ledger, aiWaitFor(deps, ctx));
  return { agents, ...(await departmentViews(deps, ctx, state, venture, agents, ledger)), ...(teamHealth ? { teamHealth } : {}) };
}

/**
 * Why work may not move on: the team's own quarantine, else the first quarantined agent, in words, or null. A run
 * uses every role's steps, so one quarantined agent stops the team's runs (delivery/quarantine-gate.ts).
 */
export function quarantineLine(deps: VentureDeps, state: State, venture: VentureRecord): string | null {
  const { agents, teamHealth } = teamNow(deps, state, venture, teamLedger(state, venture));
  if (teamHealth?.status === 'quarantined') return `The team is quarantined: ${teamHealth.reason} Clear it on Team first.`;
  const agent = agents.find(item => item.health?.status === 'quarantined');
  return agent ? `${agent.name} is quarantined: ${agent.health!.reason} Clear it on Team first.` : null;
}

/**
 * The same at a moment, from a state alone (inside a transaction): health reads only the clock from the host, so the
 * check runs on the commit's own state and time. Installed for delivery when this file loads.
 */
export function quarantineIn(state: State, venture: VentureRecord, nowIso: string): string | null {
  const at = { clock: () => new Date(nowIso) } as Pick<VentureDeps, 'clock'> as VentureDeps;
  return quarantineLine(at, state, venture);
}
installQuarantineCheck(quarantineIn);

/** One agent of the team as it stands now, with the same now line the team list shows, or AGENT_NOT_FOUND. */
function agentNow(deps: VentureDeps, ctx: Context, agentId: string): AgentView {
  const state = deps.store.read();
  const venture = currentVenture(state);
  const agent = venture ? agentViews(deps, state, venture, teamLedger(state, venture), aiWaitFor(deps, ctx)).find(item => item.id === agentId) : undefined;
  check(agent, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return agent;
}

/** venture.team.gate { agentId, stepId, gate } (approve, app only): stores one step's gate. A floor step never goes to auto. */
export async function teamGateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agent: AgentView }> {
  requireAppChannel(ctx, 'venture.team.gate');
  const body = exactPayload(payload, ['agentId', 'stepId', 'gate'], ['agentId', 'stepId', 'gate']);
  const agentId = identifier(body.agentId, 'Agent');
  const stepId = identifier(body.stepId, 'Step');
  check(body.gate === 'auto' || body.gate === 'hold', 'INVALID_VENTURE_REQUEST', 'Choose auto or hold.');
  check(agentId !== KEEPER_ID, 'AGENT_IS_CODE', KEEPER_IS_CODE);
  const gate = body.gate;
  await ventureAction(deps, ctx, 'approve', 'team.gate', tx => {
    const steps = agentSteps(tx.state, tx.venture!);
    const flagship = teamFlagship(tx.state, tx.venture!);
    check(steps && knownAgent(flagship, steps, agentId), 'AGENT_NOT_FOUND', 'That agent was not found.');
    // A role sets only its own steps.
    const step = steps.find(item => item.id === stepId && (!flagship || flagship.roleOf[item.id] === agentId));
    check(step, 'STEP_NOT_FOUND', 'That step was not found.');
    const floor = stepFloor(step, flagship);
    check(!(floor && gate === 'auto'), 'GATE_FLOOR', floor ?? '');
    // One harness agent runs every role's steps: the gate is stored where the policy reads it.
    tx.put<TeamGateRecord>({ ...tx.base('venture-team-gate'), agentId: AGENT_ID, stepId, gate });
  });
  return { agent: agentNow(deps, ctx, agentId) };
}

const POSTURE_NAMES: Readonly<Record<Posture, string>> = Object.freeze({
  rehearsal: 'rehearsal', shadow: 'shadow', 'approve-each': 'approve each', 'auto-spot-check': 'auto with spot checks',
});

/**
 * venture.team.posture { agentId, posture } (approve, app only): the agent's own posture. Any rung at or below the
 * business's launch stage is stored as asked; a looser one is refused with POSTURE_ABOVE_STAGE, because an agent never
 * works looser than its business. The always-ask floor asks at every rung.
 */
export async function teamPostureHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agent: AgentView }> {
  requireAppChannel(ctx, 'venture.team.posture');
  const body = exactPayload(payload, ['agentId', 'posture'], ['agentId', 'posture']);
  const agentId = identifier(body.agentId, 'Agent');
  check(typeof body.posture === 'string' && (POSTURES as readonly string[]).includes(body.posture), 'INVALID_VENTURE_REQUEST',
    'Choose rehearsal, shadow, approve each or auto with spot checks.');
  check(agentId !== KEEPER_ID, 'AGENT_IS_CODE', KEEPER_IS_CODE);
  const posture = body.posture as Posture;
  autoLocked(posture); // 4J15: auto with spot checks is built but locked (policy/auto-lock.ts), whatever readiness says.
  await ventureAction(deps, ctx, 'approve', 'team.posture', tx => {
    const steps = agentSteps(tx.state, tx.venture!);
    check(steps && knownAgent(teamFlagship(tx.state, tx.venture!), steps, agentId), 'AGENT_NOT_FOUND', 'That agent was not found.');
    const stage = postureOfStage(tx.venture!.launchStage);
    check(postureRank(posture) <= postureRank(stage), 'POSTURE_ABOVE_STAGE',
      `The business is at ${POSTURE_NAMES[stage]}, so this agent can work at ${POSTURE_NAMES[stage]} or tighter. Move the business up first.`);
    // A flagship playbook's roles are one harness agent, so a role's posture is the team's, stored where the policy reads it.
    tx.put<AgentPostureRecord>({ ...tx.base('venture-agent-posture'), agentId: AGENT_ID, posture });
  });
  return { agent: agentNow(deps, ctx, agentId) };
}

/** One agent's health, or the team's own (TEAM_ID), inside a transaction; AGENT_NOT_FOUND for anyone else. */
function healthNow(deps: VentureDeps, state: State, venture: VentureRecord, agentId: string): AgentHealth {
  const { agents, teamHealth } = teamNow(deps, state, venture, teamLedger(state, venture));
  const health = agentId === TEAM_ID ? teamHealth : agents.find(item => item.id === agentId)?.health;
  check(health, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return health;
}

/**
 * venture.team.clearQuarantine { agentId, digest } (approve, app only): the owner clears a quarantined agent, or the
 * team's own quarantine (agentId 'team'), sending back the health digest they saw. Any other digest, or one that is not
 * quarantined now, is APPROVAL_STALE. Causes before the clear no longer count toward that health.
 */
export async function teamClearQuarantineHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agent: AgentView | null; teamHealth: AgentHealth }> {
  requireAppChannel(ctx, 'venture.team.clearQuarantine');
  const body = exactPayload(payload, ['agentId', 'digest'], ['agentId', 'digest']);
  const agentId = identifier(body.agentId, 'Agent');
  check(typeof body.digest === 'string' && /^[0-9a-f]{64}$/.test(body.digest), 'APPROVAL_STALE', CLEAR_STALE);
  check(agentId !== KEEPER_ID, 'AGENT_IS_CODE', KEEPER_IS_CODE);
  const seen = body.digest;
  await ventureAction(deps, ctx, 'approve', 'team.clearQuarantine', tx => {
    const health = healthNow(deps, tx.state, tx.venture!, agentId);
    check(health.status === 'quarantined' && health.digest === seen, 'APPROVAL_STALE', CLEAR_STALE);
    tx.put<HealthClearRecord>({ ...tx.base('venture-health-clear'), agentId, digest: health.digest, reason: health.reason ?? '' });
  });
  const state = deps.store.read();
  const venture = currentVenture(state)!;
  const now = teamNow(deps, state, venture, teamLedger(state, venture));
  return { agent: agentId === TEAM_ID ? null : agentNow(deps, ctx, agentId), teamHealth: now.teamHealth! };
}
