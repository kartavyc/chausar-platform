// Chausar venture launcher, agents (Ink v2 wave 4, package 4B1): who an agent's thread belongs to. The team is the
// playbook's roles (playbooks/steps.ts) for a flagship business, else the one delivery agent of the eight fixed steps
// (views/team.ts reads the same facts). An agent owns the steps its role does; Keeper and the code roles are code, not
// AI, so they have no chat. Reads only.
import { check, type State } from '../../contracts.ts';
import type { PlaybookRecord, PlaybookStep, VentureRecord } from '../contracts.ts';
import { currentPlaybook, deliveryFlagship, playbookSteps } from '../delivery/playbook.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { flagshipDelivery, type FlagshipDelivery } from '../playbooks/steps.ts';
import { AGENT_ID, agentName } from '../views/shared.ts';

/** Keeper's id on Team (4A1): the engine's own jobs, run as code. */
export const KEEPER_ID = 'keeper';
/** What the one delivery agent of the eight fixed steps does (views/team.ts says the same). */
const DELIVERY_JOB = 'Reads each order, works on it with tools, and drafts the reply for you to check.';
/** Step kinds whose guidance the owner may change from chat: an agent's own steps and the writing step. */
const GUIDED_KINDS: readonly PlaybookStep['kind'][] = ['gather', 'question', 'work', 'write'];

/** One agent the owner can chat with: its words, the steps it owns, and the playbook those steps come from. */
export type ChatAgent = {
  id: string;
  name: string;
  job: string;
  /** The steps this agent does, in playbook order. */
  steps: PlaybookStep[];
  /** The ids of every step this agent does. */
  stepIds: string[];
  /** Every step of the team's playbook, people's steps included (where a floor request lands). */
  team: PlaybookStep[];
  /** The playbook in use, or null before the first one is stored (the steps then come from the accepted plan). */
  playbook: PlaybookRecord | null;
  flagship: FlagshipDelivery | null;
};

/** The team's steps: the playbook in use's, else the accepted plan's, with the flagship playbook they follow. */
function teamSteps(state: State, venture: VentureRecord): { steps: PlaybookStep[]; playbook: PlaybookRecord | null; flagship: FlagshipDelivery | null } | null {
  const playbook = currentPlaybook(state, venture);
  if (playbook) return { steps: playbook.steps, playbook, flagship: flagshipDelivery(playbook.flagship) };
  const plan = acceptedBlueprintOrNull(state, venture);
  if (!plan) return null;
  const id = deliveryFlagship(venture, plan);
  try { return { steps: playbookSteps(plan, id), playbook: null, flagship: flagshipDelivery(id) }; } catch { return null; }
}

/** The role id that does a step: a flagship playbook's role, the one delivery agent, or null for a person's step. */
export function roleOfStep(flagship: FlagshipDelivery | null, stepId: string): string | null {
  return flagship ? flagship.roleOf[stepId] ?? null : AGENT_ID;
}

/**
 * The agent a thread belongs to. Refuses Keeper and the code roles (AGENT_IS_CODE: they are code, not AI) and any id
 * that is not on this team (AGENT_NOT_FOUND).
 */
export function chatAgent(state: State, venture: VentureRecord, agentId: string): ChatAgent {
  check(agentId !== KEEPER_ID, 'AGENT_IS_CODE', 'Keeper is code, not AI. It has no chat; its jobs are on Team.');
  const team = teamSteps(state, venture);
  check(team, 'AGENT_NOT_FOUND', 'That agent was not found.');
  const { steps, playbook, flagship } = team;
  if (!flagship) {
    check(agentId === AGENT_ID, 'AGENT_NOT_FOUND', 'That agent was not found.');
    return { id: AGENT_ID, name: agentName(state, venture), job: DELIVERY_JOB, steps, stepIds: steps.map(step => step.id), team: steps, playbook, flagship };
  }
  const role = flagship.roles.find(item => item.id === agentId);
  const own = steps.filter(step => flagship.roleOf[step.id] === agentId);
  check(role && own.length, 'AGENT_NOT_FOUND', 'That agent was not found.');
  check(role.kind === 'agent', 'AGENT_IS_CODE', `${role.name} is code, not AI. It has no chat; its work shows in each run's steps.`);
  return { id: role.id, name: role.name, job: role.job, steps: own, stepIds: own.map(step => step.id), team: steps, playbook, flagship };
}

/** The agent's steps whose guidance chat may change, in playbook order: its agent steps and its writing steps. */
export function guidedSteps(agent: Pick<ChatAgent, 'steps'>): PlaybookStep[] {
  return agent.steps.filter(step => GUIDED_KINDS.includes(step.kind));
}
