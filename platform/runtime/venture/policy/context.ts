// Chausar venture launcher, policy (P2-posture): the policy context, read from the vault.
// The posture is the business launch stage tightened by the agent's own posture and by the run (made-up clients are
// always a rehearsal). Each step's gate is what venture.team.gate stored, on hold by default, and on hold for good when
// the step is on the always-ask floor. The approval says who approved the turn: the caller knows, so the caller says;
// a real order without one has none, and every call waits for the owner.
import { check, type Context, type State } from '../../contracts.ts';
import { isAppChannel, listRecords, ventureAction } from '../records.ts';
import type { AgentPostureRecord, PlaybookRecord, PlaybookStep, Posture, VentureDeps, VentureRecord, WorkRunRef } from '../contracts.ts';
import { toolSpec } from '../delivery/harness/tools.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { AGENT_ID } from '../views/shared.ts';
import type { Approval, PolicyContext } from './ladder.ts';
import { POSTURES, postureOfStage, runPosture, stepGate, tighten } from './posture.ts';

/** Why a whole step is on the floor. The team view shows the same words next to the step. */
export const STEP_FLOOR_WORDS = Object.freeze({
  send: 'Sending to a client or the public always asks you first.',
  outside: 'Acting outside Chausar always asks you first.',
});

/** Why a step is in the always-ask floor, or null. Code decides from the step's kind and its tools' effects. */
export function stepFloorReason(step: Pick<PlaybookStep, 'kind' | 'tools'>): string | null {
  if (step.kind === 'operator') return STEP_FLOOR_WORDS.send;
  if ((step.tools ?? []).some(tool => toolSpec(tool)?.effect === 'outside-write')) return STEP_FLOOR_WORDS.outside;
  return null;
}

/** The agent's own posture: its newest record, or null when it has none. */
export function agentPosture(state: State, ventureId: string, agentId: string): Posture | null {
  const records = listRecords(state, 'venture-agent-posture', ventureId).filter(record => record.agentId === agentId);
  return records.length ? records[records.length - 1].posture : null;
}

/** The business posture tightened by the agent's own. What the team view shows. */
export function effectivePosture(state: State, venture: VentureRecord, agentId: string = AGENT_ID): Posture {
  return tighten(postureOfStage(venture.launchStage), agentPosture(state, venture.id, agentId));
}

/** Each step's gate as the policy reads it: stored, else on hold; a floor step always on hold. */
export function stepGates(state: State, ventureId: string, steps: readonly PlaybookStep[], agentId: string = AGENT_ID): Record<string, 'auto' | 'hold'> {
  const stored = new Map<string, 'auto' | 'hold'>();
  for (const record of listRecords(state, 'venture-team-gate', ventureId)) if (record.agentId === agentId) stored.set(record.stepId, record.gate);
  return Object.fromEntries(steps.map(step => [step.id, stepGate(stored.get(step.id), stepFloorReason(step) !== null)]));
}

export type ContextInput = {
  state: State;
  venture: VentureRecord;
  playbook: Pick<PlaybookRecord, 'steps'>;
  runRef: WorkRunRef;
  approval?: Approval;
  agentId?: string;
};

/** The policy context for one run, as of now. Reads only. */
export function harnessPolicyContext(input: ContextInput): PolicyContext {
  const agentId = input.agentId ?? AGENT_ID;
  const steps = input.playbook.steps;
  const stepsByTool: Record<string, string[]> = {};
  for (const step of steps) for (const tool of step.tools ?? []) (stepsByTool[tool] ??= []).push(step.id);
  return {
    posture: tighten(effectivePosture(input.state, input.venture, agentId), runPosture(input.runRef)),
    approval: input.approval ?? (input.runRef.kind === 'delivery' ? { kind: 'none' } : { kind: 'practice' }),
    gates: stepGates(input.state, input.venture.id, steps, agentId),
    stepsByTool,
    stepTitles: Object.fromEntries(steps.map(step => [step.id, step.title])),
  };
}

/**
 * Stores an agent's own posture (approve, inside the app). Any rung may be stored; it only ever tightens the business
 * posture, so a looser one waits until the business moves up. venture.team.posture (views/team.ts) is stricter: it
 * refuses a looser one with POSTURE_ABOVE_STAGE.
 */
export async function setAgentPosture(deps: VentureDeps, ctx: Context, agentId: string, posture: Posture): Promise<AgentPostureRecord> {
  check(isAppChannel(ctx), 'APP_APPROVAL_REQUIRED', 'Approve this inside the Chausar app.');
  check(POSTURES.includes(posture), 'INVALID_VENTURE_REQUEST', 'Choose rehearsal, shadow, approve each or auto with spot checks.');
  return ventureAction(deps, ctx, 'approve', 'team.posture', tx => {
    check(agentId === AGENT_ID && acceptedBlueprintOrNull(tx.state, tx.venture!) !== null, 'AGENT_NOT_FOUND', 'That agent was not found.');
    return tx.put<AgentPostureRecord>({ ...tx.base('venture-agent-posture'), agentId, posture });
  });
}
