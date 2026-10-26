// Chausar venture launcher, views (Ink v2 wave 4, package 4J1; catalogue O17): repeated refusals as a health reason.
// When the owner pressed Keep on hold on the same held call (the same tool with the same exact input) 3 times in the
// last 30 days, the agent is asking again for something the owner refused, so a healthy agent reads degraded with "Asked
// 3 times for something you refused." Only the owner's own decline counts: other words in an answer, a practice client
// and a question nobody answered do not. A worse health (failing, quarantined) or another reason already shown keeps
// its place: health shows one reason. Counted in code from the runs' held calls (policy/holds.ts), never by a model.
import type { State } from '../../contracts.ts';
import type { AgentHealth, IsoTime, VentureRecord } from '../contracts.ts';
import { digest, listRecords } from '../records.ts';
import type { TeamMember } from './health.ts';
import { HOLD_DECLINE_ANSWER } from '../policy/holds.ts';

/** Refusals of the same call that make a pattern, and how far back they count. */
export const REFUSED_AFTER = 3;
export const REFUSAL_WINDOW_MS = 30 * 24 * 60 * 60_000;
export const REFUSED_WORDS = (count: number) => `Asked ${count} times for something you refused.`;

/** The member's refused calls in the window, grouped by tool and exact input: each group's fact ids ('<run id>/<hold id>'). */
function refusedGroups(state: State, venture: VentureRecord, member: TeamMember, nowIso: IsoTime): Map<string, string[]> {
  const since = Date.parse(nowIso) - REFUSAL_WINDOW_MS;
  const groups = new Map<string, string[]>();
  for (const run of listRecords(state, 'venture-delivery-run', venture.id)) {
    const harness = run.harness;
    for (const hold of harness?.holds ?? []) {
      if (hold.status !== 'declined' || !member.owns(hold.stepId ?? '')) continue;
      const asked = harness!.handoffs[hold.handoff];
      if (!asked || asked.answeredBy !== 'owner' || asked.answer !== HOLD_DECLINE_ANSWER) continue;
      const at = harness!.toolCalls.find(call => call.id === hold.toolCallId)?.startedAt ?? run.at;
      if (Date.parse(at) < since) continue;
      const key = `${hold.tool} ${hold.inputDigest}`;
      groups.set(key, [...(groups.get(key) ?? []), `${run.id}/${hold.id}`]);
    }
  }
  return groups;
}

/**
 * One agent's health with repeated refusals counted: a healthy agent the owner refused the same call 3 times reads
 * degraded with that reason and a digest over the refusals behind it; any other health is returned as it is.
 */
export function withRefusals(health: AgentHealth, state: State, venture: VentureRecord, member: TeamMember, nowIso: IsoTime): AgentHealth {
  if (health.status !== 'healthy' || member.kind !== 'agent') return health;
  const most = [...refusedGroups(state, venture, member, nowIso).values()].sort((a, b) => b.length - a.length)[0] ?? [];
  if (most.length < REFUSED_AFTER) return health;
  const reason = REFUSED_WORDS(most.length);
  return { status: 'degraded', reason, digest: digest({ agentId: member.id, status: 'degraded', reason, facts: { refused: most } }) };
}
