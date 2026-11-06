// Chausar venture launcher, views (Ink v2 wave 4, package 4A1; catalogue A20): an agent's state and health, computed
// in code from the engine's own records, never by a model. State: working when a run is active on a step the agent
// owns, waiting when a run waits on the owner at one, failed when its latest finished run failed at one, else idle.
// Health, one word and one plain reason: 2 failed runs in a row is failing and 3 is quarantined; an outside action the
// agent proposed that none of its steps declares quarantines it (the run's grant holds only declared tools, so such a
// call was refused TOOL_DENIED; a granted one is counted too); more than half of at least 4 reviewed outputs sent back
// or edited, more than 10 things waiting on the owner for it, or one waiting longer than 7 days, is degraded. A cause
// no single role can claim (an undeclared outside action in a turn that is the team's) quarantines the team once, with
// one digest (TEAM_ID). A quarantine stops new runs and runs in flight (delivery/quarantine-gate.ts) until the owner
// clears it with the digest they saw; causes before that clear no longer count. Keeper is code and has no health.
// The facts are worked out once per request (teamFacts), so health stays linear in the size of the business.
import type { State } from '../../contracts.ts';
import type { AgentHealth, AgentHealthStatus, AgentView, DeliveryRunRecord, RunDetail, ToolCallRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { digest, listRecords } from '../records.ts';
import { roleOfTurn } from '../playbooks/departments.ts';
import { draftStepIn, runStepsIn, type TeamLedger } from '../money/department-spend.ts';
import { AGENT_ID, lastEventAt } from './shared.ts';

/** The id a team-level quarantine is cleared with: venture.team.clearQuarantine { agentId: 'team', digest }. */
export const TEAM_ID = 'team';
/** Failed runs in a row that make an agent failing, and quarantined. */
export const FAILING_AFTER = 2;
export const QUARANTINE_AFTER = 3;
/** Reviewed outputs looked at (the newest), the fewest that can show a pattern, and the waiting limits. */
const REVIEW_WINDOW = 10;
const REVIEW_MIN = 4;
const WAITING_MAX = 10;
const WAITING_DAYS = 7;
const DAY_MS = 24 * 60 * 60_000;

export const HEALTH_WORDS = Object.freeze({
  failing: (runs: number) => `Its last ${runs} runs failed.`,
  quarantinedRuns: (runs: number) => `Its last ${runs} runs failed. It starts no new work until you clear it.`,
  undeclared: 'It proposed an outside action that none of its steps allows. Look at its runs before you clear it.',
  teamUndeclared: 'An outside action was proposed in a turn no single agent can claim, and no step of the team allows it. Look at the runs before you clear it.',
  unwanted: "The playbook is producing work people don't want. Revise it.",
  deep: (count: number) => `${count} things wait on you for this agent.`,
  old: `Something has waited on you for this agent for more than ${WAITING_DAYS} days.`,
});

/** One agent of the team as health reads it: its id, kind and the steps it owns. */
export type TeamMember = { id: string; kind: 'agent' | 'code'; owns: (stepId: string) => boolean };
/** What health reads, worked out once per request: undeclared actions by agent and for the team, reviewed outputs by drafter. */
export type TeamFacts = { undeclared: Map<string, string[]>; teamUndeclared: string[]; reviewed: Map<string, DeliveryRunRecord[]>; cleared: Map<string, string> };

const tookPart = (owns: TeamMember['owns'], run: RunDetail) => run.steps.some(step => step.state !== 'pending' && owns(step.id));
const failedAt = (owns: TeamMember['owns'], run: RunDetail) => run.steps.some(step => step.state === 'failed' && owns(step.id));

/** An agent's state from the runs (newest first) only. */
export function memberState(owns: TeamMember['owns'], runs: readonly RunDetail[]): NonNullable<AgentView['state']> {
  if (runs.some(run => run.state === 'active' && run.steps.some(step => step.state === 'current' && owns(step.id)))) return 'working';
  if (runs.some(run => run.state === 'waiting' && run.steps.some(step => step.state === 'waiting' && owns(step.id)))) return 'waiting';
  const latest = runs.find(run => (run.state === 'done' || run.state === 'failed') && tookPart(owns, run));
  return latest?.state === 'failed' && failedAt(owns, latest) ? 'failed' : 'idle';
}

/** A proposed outside action: an outside write that went through, or that the grant refused (TOOL_DENIED). */
const proposedOutside = (call: ToolCallRecord) => call.effect === 'outside-write'
  && (call.outcome === 'succeeded' || (!call.envelope.ok && call.envelope.error.code === 'TOOL_DENIED'));

/**
 * The facts behind every agent's health, once: each undeclared outside action since the clear of whoever it counts
 * against (fact ids '<run id>/<call id>'), and each agent's newest reviewed outputs (the drafting role's on a flagship).
 */
export function teamFacts(ledger: TeamLedger, members: readonly TeamMember[], records: readonly DeliveryRunRecord[]): TeamFacts {
  const { state, venture, flagship } = ledger;
  const cleared = new Map<string, string>();
  for (const record of listRecords(state, 'venture-health-clear', venture.id)) {
    const known = cleared.get(record.agentId);
    if (!known || record.at > known) cleared.set(record.agentId, record.at);
  }
  const after = (id: string, at: string) => { const since = cleared.get(id); return since === undefined || at > since; };
  const undeclared = new Map<string, string[]>(members.map(member => [member.id, []]));
  const teamUndeclared: string[] = [];
  const reviewed = new Map<string, DeliveryRunRecord[]>(members.map(member => [member.id, []]));
  for (const run of records) {
    const harness = run.harness;
    if (harness) {
      const steps = runStepsIn(ledger, run);
      const declares = (roleId: string | null, tool: string) => steps.some(step => (roleId === null || !flagship || flagship.roleOf[step.id] === roleId)
        && ((step.tools ?? []) as readonly string[]).includes(tool));
      for (const call of harness.toolCalls) {
        if (!proposedOutside(call)) continue;
        const at = call.startedAt ?? run.at;
        const fact = `${run.id}/${call.id}`;
        if (!flagship) {
          if (!declares(null, call.tool) && after(AGENT_ID, at)) undeclared.get(AGENT_ID)?.push(fact);
          continue;
        }
        const turn = harness.turns.find(item => item.turn === call.turn && item.step === 'act') ?? { step: 'act' as const, calls: [{ tool: call.tool, input: '' }] };
        const role = roleOfTurn(flagship, steps, turn, draftStepIn(ledger, run));
        if (role !== null) {
          if (!declares(role, call.tool) && after(role, at)) undeclared.get(role)?.push(fact);
        } else if (!declares(null, call.tool) && after(TEAM_ID, at)) {
          teamUndeclared.push(fact);
        }
      }
    }
    if (run.verdict) {
      const step = flagship ? draftStepIn(ledger, run) : null;
      const drafter = flagship ? (step ? flagship.roleOf[step] : undefined) : AGENT_ID;
      if (drafter) reviewed.get(drafter)?.push(run);
    }
  }
  for (const [id, runs] of reviewed) reviewed.set(id, runs.sort((a, b) => b.verdict!.at.localeCompare(a.verdict!.at)).slice(0, REVIEW_WINDOW));
  return { undeclared, teamUndeclared, reviewed, cleared };
}

/** Failed runs in a row, newest first, among the finished runs the agent took part in since the clear. */
function failureStreak(owns: TeamMember['owns'], runs: readonly RunDetail[], since: string | undefined): string[] {
  const streak: string[] = [];
  for (const run of runs) {
    if (since !== undefined && run.startedAt <= since) break;
    if (run.state !== 'done' && run.state !== 'failed') continue;
    if (!tookPart(owns, run)) continue;
    if (run.state === 'failed' && failedAt(owns, run)) streak.push(run.runId);
    else break;
  }
  return streak;
}

function healthOf(id: string, status: AgentHealthStatus, reason: string | null, facts: unknown): AgentHealth {
  return { status, reason, digest: digest({ agentId: id, status, reason, facts }) };
}

/**
 * One agent's health now. runs: the delivery runs as the screens read them (views/runs.ts), newest first. The digest
 * covers the status, the reason and the facts behind them, so Clear quarantine binds to exactly what the owner saw.
 */
export function memberHealth(deps: VentureDeps, state: State, venture: VentureRecord, member: TeamMember, runs: readonly RunDetail[], facts: TeamFacts, times: Map<string, string> = lastEventAt(state, venture.id)): AgentHealth {
  const since = facts.cleared.get(member.id);
  const streak = failureStreak(member.owns, runs, since);
  if (streak.length >= QUARANTINE_AFTER) return healthOf(member.id, 'quarantined', HEALTH_WORDS.quarantinedRuns(streak.length), { streak, since: since ?? null });
  const undeclared = facts.undeclared.get(member.id) ?? [];
  if (undeclared.length) return healthOf(member.id, 'quarantined', HEALTH_WORDS.undeclared, { undeclared, since: since ?? null });
  if (streak.length >= FAILING_AFTER) return healthOf(member.id, 'failing', HEALTH_WORDS.failing(streak.length), { streak, since: since ?? null });
  const reviewed = facts.reviewed.get(member.id) ?? [];
  const sentBack = reviewed.filter(run => run.verdict!.choice !== 'accepted').length;
  if (reviewed.length >= REVIEW_MIN && sentBack * 2 > reviewed.length) {
    return healthOf(member.id, 'degraded', HEALTH_WORDS.unwanted, { reviewed: reviewed.map(run => [run.id, run.verdict!.choice]) });
  }
  const waiting = runs.filter(run => run.state === 'waiting' && run.steps.some(step => step.state === 'waiting' && member.owns(step.id)));
  if (waiting.length > WAITING_MAX) return healthOf(member.id, 'degraded', HEALTH_WORDS.deep(waiting.length), { waiting: waiting.map(run => run.runId) });
  const now = deps.clock().getTime();
  const old = waiting.filter(run => now - Date.parse(times.get(run.runId) ?? run.startedAt) > WAITING_DAYS * DAY_MS);
  if (old.length) return healthOf(member.id, 'degraded', HEALTH_WORDS.old, { old: old.map(run => run.runId) });
  return healthOf(member.id, 'healthy', null, null);
}

/** The team's own health: quarantined once by causes no single agent can claim, else healthy. */
export function teamHealthOf(facts: TeamFacts): AgentHealth {
  if (!facts.teamUndeclared.length) return healthOf(TEAM_ID, 'healthy', null, null);
  return healthOf(TEAM_ID, 'quarantined', HEALTH_WORDS.teamUndeclared, { undeclared: facts.teamUndeclared, since: facts.cleared.get(TEAM_ID) ?? null });
}
