// Chausar venture launcher, agents (wave 6 package 6G2, DECISIONS D43): who is retired and who now does a retired
// agent's steps. A leaf module that only reads records, so the team view, agent chat, the chief's routing, routines and
// delivery can ask it without loading the retire handlers (agents/retire.ts). A retirement in force is the newest
// venture-agent-retirement record for the agent with no restoredAt. Its steps go to the agent the owner chose, or to
// the owner ('owner'); when that agent retired too, they follow its handover on, so a chain always ends at an agent
// still on the team or at the owner. Nothing here changes a step, a receipt or an approval: one harness runs every
// role's steps, so a handover decides whose card and chat show those steps and whose AI settings run new work on them.
import type { State } from '../../contracts.ts';
import type { AgentRetirementRecord, DepartmentId, RetiredAgentView } from '../contracts.ts';
import { listRecords } from '../records.ts';
import { departmentOfRole } from '../playbooks/departments.ts';
import type { FlagshipDelivery } from '../playbooks/steps.ts';
import { OWNER_HANDOVER, RETIRED_SUFFIX, shelfLine } from './retired-words.ts';

export { OWNER_HANDOVER, RETIRE_KEPT_LINE, RETIRED_LINE, RETIRED_SUFFIX, SHELF_THREAD_LINE, shelfLine } from './retired-words.ts';
/** The team's own AI settings (views/shared.ts AGENT_ID): what runs new work on steps handed to the owner. */
const TEAM_AGENT = 'delivery';

/** Every retirement in force in this business, by agent id (the newest record per agent wins). */
export function retirements(state: State, ventureId: string): Map<string, AgentRetirementRecord> {
  const out = new Map<string, AgentRetirementRecord>();
  for (const record of listRecords(state, 'venture-agent-retirement', ventureId)) {
    if (record.restoredAt === null) out.set(record.agent, record);
    else if (out.get(record.agent)?.id === record.id) out.delete(record.agent);
  }
  return out;
}

/** The agent's retirement in force, or null. */
export function retirementOf(state: State, ventureId: string, agentId: string): AgentRetirementRecord | null {
  return retirements(state, ventureId).get(agentId) ?? null;
}

/** Whether the agent is retired now. */
export function isRetired(state: State, ventureId: string, agentId: string): boolean {
  return retirements(state, ventureId).has(agentId);
}

/**
 * Who does a role's steps now: the role itself while it is on the team, else the end of its handover chain, an agent on
 * the team or OWNER_HANDOVER. A chain that went round (it cannot, since a retired agent never takes over) ends at the owner.
 */
export function holderOf(state: State, ventureId: string, roleId: string, known: Map<string, AgentRetirementRecord> = retirements(state, ventureId)): string {
  let at = roleId;
  const seen = new Set<string>();
  while (known.has(at)) {
    if (seen.has(at)) return OWNER_HANDOVER;
    seen.add(at);
    at = known.get(at)!.to;
    if (at === OWNER_HANDOVER) return OWNER_HANDOVER;
  }
  return at;
}

/**
 * The agent a new job on a role's step runs as (its AI settings and spend): the step's holder, or the team's own
 * settings when the owner took the work over.
 */
export function jobAgentFor(state: State, ventureId: string, roleId: string): string {
  const holder = holderOf(state, ventureId, roleId);
  return holder === OWNER_HANDOVER ? TEAM_AGENT : holder;
}

/** One retirement as the Retired shelf shows it, with the role's words and department from its flagship playbook. */
export function retiredView(record: AgentRetirementRecord, flagship: Pick<FlagshipDelivery, 'id' | 'roles'> | null): RetiredAgentView {
  const role = flagship?.roles.find(item => item.id === record.agent);
  const to = record.to === OWNER_HANDOVER ? null : { id: record.to, name: flagship?.roles.find(item => item.id === record.to)?.name ?? record.to };
  let department: DepartmentId | undefined;
  try { department = flagship ? departmentOfRole(flagship, record.agent) : undefined; } catch { department = undefined; }
  return { id: record.agent, name: record.name, role: role?.job ?? '', ...(department ? { department } : {}), at: record.at, to, line: shelfLine(to?.name ?? null) };
}

/** The Retired shelf, oldest first. */
export function retiredShelf(state: State, ventureId: string, flagship: Pick<FlagshipDelivery, 'id' | 'roles'> | null): RetiredAgentView[] {
  return [...retirements(state, ventureId).values()].sort((a, b) => a.at.localeCompare(b.at)).map(record => retiredView(record, flagship));
}

/** An agent's name as Today and receipts show it: with " (retired)" while it is retired. */
export function retiredName(state: State, ventureId: string, agentId: string, name: string): string {
  return isRetired(state, ventureId, agentId) ? `${name}${RETIRED_SUFFIX}` : name;
}
