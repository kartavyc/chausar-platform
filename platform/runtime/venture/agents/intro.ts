// C5 task 1: introduce each agent once. Team lists, for the member reading it, the agents they have not met yet, each
// with one code-written line (the agent's name and its role's job line, never model text). "Got it" sends
// venture.team.introduced { agentIds } (quiet: a seen-mark, nothing the owner decided), which stores one
// venture-team-intro record per change for that member; the newest record holds every agent they have met.
import type { Context, State } from '../../contracts.ts';
import type { AgentView, TeamIntroRecord, VentureDeps } from '../contracts.ts';
import { exactPayload, listRecords, ventureAction } from '../records.ts';
import { check } from '../../contracts.ts';
import { introLine } from './intro-core.ts';

export { introLine };

export type TeamIntroLine = { agentId: string; line: string };

/** The agents this member has met: the newest venture-team-intro record of theirs. */
export function metAgents(state: State, ventureId: string, memberId: string): ReadonlySet<string> {
  const newest = listRecords(state, 'venture-team-intro', ventureId).filter(record => record.memberId === memberId).at(-1);
  return new Set(newest?.agentIds ?? []);
}


/** The lines for every agent (kind 'agent'; Keeper and code roles are not introduced) this member has not met. */
export function introductions(state: State, ventureId: string, memberId: string, agents: readonly AgentView[]): TeamIntroLine[] {
  const met = metAgents(state, ventureId, memberId);
  return agents.filter(agent => agent.kind !== 'code' && !met.has(agent.id)).map(agent => ({ agentId: agent.id, line: introLine(agent.name, agent.role) }));
}

/** venture.team.introduced { agentIds } (quiet): this member has met these agents. Answers the ids met so far. */
export async function teamIntroducedHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ met: string[] }> {
  const body = exactPayload(payload, ['agentIds'], ['agentIds']);
  const ids = body.agentIds;
  check(Array.isArray(ids) && ids.length > 0 && ids.length <= 50 && ids.every(id => typeof id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(id)), 'INVALID_VENTURE_REQUEST', 'Name the agents you have met.');
  return ventureAction(deps, ctx, 'read', 'team.introduced', tx => {
    const venture = tx.venture!;
    const met = new Set(metAgents(tx.state, venture.id, ctx.memberId));
    const before = met.size;
    for (const id of ids as string[]) met.add(id);
    if (met.size !== before) tx.put<TeamIntroRecord>({ ...tx.base('venture-team-intro'), agentIds: [...met].sort() });
    return { met: [...met].sort() };
  });
}
