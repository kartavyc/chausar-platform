// Chausar venture launcher, views (P1-A): the team. venture.team.list, venture.team.gate and venture.team.posture.
// This build has one agent per business, the delivery agent its playbook describes; its steps are the playbook's.
// Each step has a gate: 'hold' asks the owner, 'auto' lets the step run. Gates start on hold. Steps in the always-ask
// floor (money out, sending to a client or the public, deleting, changing prices, anything on a government portal)
// stay on hold at every posture, so a request to set one to auto is refused with GATE_FLOOR. This view stores the
// gate; venture/policy checks it before each harness tool call. The posture shown is the one the agent works at: the
// launch stage tightened by the agent's own posture (policy/context.ts). venture.team.posture stores that own posture:
// the same rung as the business or a tighter one, never a looser one (POSTURE_ABOVE_STAGE). The floor asks at every rung.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { currentVenture, exactPayload, formatMicros, identifier, listRecords, requireAppChannel, sumMicros, ventureAction } from '../records.ts';
import type { AgentPostureRecord, AgentView, PlaybookStep, Posture, TeamGateRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentPlaybook, playbookSteps } from '../delivery/playbook.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { effectivePosture, STEP_FLOOR_WORDS, stepFloorReason } from '../policy/context.ts';
import { POSTURES, postureOfStage, postureRank, stepGate } from '../policy/posture.ts';
import { ESTIMATE_WORDS } from '../models/cost.ts';
import { deliveryRunDetails } from './runs.ts';
import { AGENT_ID, AGENT_PURPOSES, agentName, clientNameFor, plain } from './shared.ts';

const ROLE = 'Reads each order, works on it with tools, and drafts the reply for you to check.';
export const FLOOR_WORDS = STEP_FLOOR_WORDS;

/** Why a step is in the always-ask floor, or null. Code decides from the step's kind and its tools' effects. */
export function floorReason(step: PlaybookStep): string | null {
  return stepFloorReason(step);
}

/** The agent's steps: the playbook in use, else the accepted plan's fixed steps (worked out, never stored, here). */
function agentSteps(state: State, venture: VentureRecord): PlaybookStep[] | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return playbook.steps;
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  try { return playbookSteps(plan); } catch { return null; }
}

function spendOf(state: State, venture: VentureRecord): string {
  const calls = state.conversations.filter((record: any) => record?.kind === 'venture-model-call' && record.ventureId === venture.id
    && AGENT_PURPOSES.includes(record.purpose) && typeof record.costMicros === 'string' && /^\d{1,30}$/.test(record.costMicros)) as { costMicros: string; priceConfirmed?: unknown }[];
  const total = formatMicros(sumMicros(calls.map(call => call.costMicros)));
  return calls.some(call => call.priceConfirmed === false) ? `${total}${ESTIMATE_WORDS}` : total;
}

function agentView(deps: VentureDeps, state: State, venture: VentureRecord): AgentView | null {
  const steps = agentSteps(state, venture);
  if (!steps) return null;
  const posture = effectivePosture(state, venture);
  const gates = new Map<string, 'auto' | 'hold'>();
  for (const record of listRecords(state, 'venture-team-gate', venture.id)) if (record.agentId === AGENT_ID) gates.set(record.stepId, record.gate);
  const runs = deliveryRunDetails(deps, state, venture);
  const busy = runs.find(run => run.state === 'waiting' || run.state === 'active');
  const step = busy?.steps.find(item => item.state === 'waiting' || item.state === 'current');
  const now = !busy ? 'Idle' : busy.state === 'active' ? `Working: ${step?.purpose ?? busy.purpose}` : `Waiting on you: ${step?.purpose ?? busy.purpose}`;
  const reviewed = listRecords(state, 'venture-delivery-run', venture.id).filter(run => run.verdict !== null)
    .sort((a, b) => (b.verdict!.at).localeCompare(a.verdict!.at))[0];
  const verdictWords = { accepted: 'accepted', edited: 'edited by you', rejected: 'rejected' } as const;
  const receiptId = reviewed?.harness?.workReceiptIds.at(-1);
  return plain({
    id: AGENT_ID, name: agentName(state, venture), role: ROLE, now, posture, spend: spendOf(state, venture),
    ...(reviewed ? { last: { line: `Draft for ${clientNameFor(state, venture.id, reviewed.orderId)} ${verdictWords[reviewed.verdict!.choice]}.`, ...(receiptId ? { receiptId } : {}) } } : {}),
    steps: steps.map(item => {
      // Gates start on hold at every posture: auto with spot checks lets a step run alone only once the owner set it to auto.
      const floor = floorReason(item) !== null;
      return { id: item.id, purpose: item.title, gate: stepGate(gates.get(item.id), floor), floor };
    }),
  });
}

/** venture.team.list (read): the agents of this business. None until a plan is accepted. */
export async function teamListHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agents: AgentView[] }> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  const state = deps.store.read();
  const venture = currentVenture(state);
  const agent = venture ? agentView(deps, state, venture) : null;
  return { agents: agent ? [agent] : [] };
}

/** venture.team.gate { agentId, stepId, gate } (approve, app only): stores one step's gate. A floor step never goes to auto. */
export async function teamGateHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ agent: AgentView }> {
  requireAppChannel(ctx, 'venture.team.gate');
  const body = exactPayload(payload, ['agentId', 'stepId', 'gate'], ['agentId', 'stepId', 'gate']);
  const agentId = identifier(body.agentId, 'Agent');
  const stepId = identifier(body.stepId, 'Step');
  check(body.gate === 'auto' || body.gate === 'hold', 'INVALID_VENTURE_REQUEST', 'Choose auto or hold.');
  const gate = body.gate;
  await ventureAction(deps, ctx, 'approve', 'team.gate', tx => {
    const steps = agentSteps(tx.state, tx.venture!);
    check(steps && agentId === AGENT_ID, 'AGENT_NOT_FOUND', 'That agent was not found.');
    const step = steps.find(item => item.id === stepId);
    check(step, 'STEP_NOT_FOUND', 'That step was not found.');
    const floor = floorReason(step);
    check(!(floor && gate === 'auto'), 'GATE_FLOOR', floor ?? '');
    tx.put<TeamGateRecord>({ ...tx.base('venture-team-gate'), agentId, stepId, gate });
  });
  const state = deps.store.read();
  const agent = agentView(deps, state, currentVenture(state)!);
  check(agent, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return { agent };
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
  const posture = body.posture as Posture;
  await ventureAction(deps, ctx, 'approve', 'team.posture', tx => {
    check(agentSteps(tx.state, tx.venture!) && agentId === AGENT_ID, 'AGENT_NOT_FOUND', 'That agent was not found.');
    const stage = postureOfStage(tx.venture!.launchStage);
    check(postureRank(posture) <= postureRank(stage), 'POSTURE_ABOVE_STAGE',
      `The business is at ${POSTURE_NAMES[stage]}, so this agent can work at ${POSTURE_NAMES[stage]} or tighter. Move the business up first.`);
    tx.put<AgentPostureRecord>({ ...tx.base('venture-agent-posture'), agentId, posture });
  });
  const state = deps.store.read();
  const agent = agentView(deps, state, currentVenture(state)!);
  check(agent, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return { agent };
}
