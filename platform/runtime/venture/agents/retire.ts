// Chausar venture launcher, agents (wave 6 package 6G2, DECISIONS D43): retiring an agent and Bring back.
// venture.agents.retire.check reads what the agent holds (its steps, standing orders, notes and messages), what is in
// flight (runs on its steps, its open question, proposals waiting in its chat, Today cards it raised or a routine of its
// parked), the routines that will switch off and who can take over, with a digest of exactly that. venture.agents.retire
// takes the digest the owner saw and who takes over (another AI agent on the team, or 'owner'): it switches the agent's
// routines off and stores the retirement. Nothing else is written: receipts, the exact-approval journal, Today's
// proposals, the agent's proposals, notes and their changes stay as they were, so every approval in flight and every
// undo still works; the thread becomes read only (threads.ts, notes.ts) and Today names the agent with "(retired)".
// venture.agents.restore (Bring back) clears the retirement and switches on again the routines retiring switched off,
// after the same connection check routines.set asks for. The last AI agent of a team cannot retire (AGENT_LAST_ONE).
// Modelled on venture.team.clearQuarantine: the owner sends back the digest of what they read; a changed check is stale.
import { check, type Context, type State } from '../../contracts.ts';
import { digest, exactPayload, identifier, listRecords, requireAppChannel, ventureAction } from '../records.ts';
import type { AgentRestored, AgentRetired, AgentRetirementRecord, RetireCheckView, RetireInFlight, RoutineRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { readAs } from '../delivery/shared.ts';
import { requireConnectorChecked } from '../build/connector-check.ts';
import { teamFlagship } from '../views/team-shape.ts';
import { short } from '../views/shared.ts';
import { teamAgents } from '../chief/routing.ts';
import { agentRunHistory, waitingOn } from './answer.ts';
import { chatRoute } from './consent.ts';
import { agentNotes } from './notes.ts';
import { chatAgent } from './roles.ts';
import { liveRoutines, whenWords } from './routines.ts';
import { standingOrders } from './versions.ts';
import { OWNER_HANDOVER, RETIRE_KEPT_LINE, RETIRED_LINE, retirementOf, retiredView } from './retired.ts';
import {
  inFlightWords, lastOneLine as lastOne, NOT_RETIRED, restoredLine, RETIRE_CHOOSE as CHOOSE, RETIRE_RUN_WORDS as RUN_WORDS, RETIRE_STALE as STALE, retiredLine,
} from './retired-words.ts';

/** Everything moving that names the agent, oldest first by kind: runs, its question, its chat's proposals, Today cards. */
function inFlight(deps: VentureDeps, state: State, venture: VentureRecord, agent: ReturnType<typeof chatAgent>): RetireInFlight[] {
  const out: RetireInFlight[] = [];
  for (const { detail } of agentRunHistory(deps, state, venture, agent)) {
    const words = RUN_WORDS[detail.state];
    if (words) out.push({ id: detail.runId, kind: 'run', line: `${detail.purpose}: ${words}` });
  }
  const waiting = waitingOn(deps, state, venture, agent);
  if (waiting) out.push({ id: waiting.rowId, kind: 'question', line: inFlightWords.question(short(waiting.question, 160)) });
  for (const record of listRecords(state, 'venture-agent-proposal', venture.id)) {
    if (record.agent === agent.id && record.status === 'drafted') out.push({ id: record.id, kind: 'proposal', line: inFlightWords.proposal(short(record.quote, 120)) });
  }
  for (const record of listRecords(state, 'venture-proposal', venture.id)) {
    if (record.agent === agent.id && (record.status === 'drafted' || record.status === 'raised')) out.push({ id: record.id, kind: 'today', line: inFlightWords.today(short(record.title, 160)) });
  }
  const mine = new Map(listRecords(state, 'venture-routine', venture.id).filter(routine => routine.agent === agent.id).map(routine => [routine.id, routine]));
  for (const run of listRecords(state, 'venture-routine-run', venture.id)) {
    const routine = mine.get(run.routineId);
    if (routine && run.state === 'needs-input') out.push({ id: run.id, kind: 'today', line: inFlightWords.routine(routine.name) });
  }
  return out;
}

/** The check screen, worked out from the vault as it is now. AGENT_RETIRED once retired; Keeper and code roles have none. */
function checkView(deps: VentureDeps, state: State, venture: VentureRecord, agentId: string): RetireCheckView {
  const agent = chatAgent(state, venture, agentId);
  check(!retirementOf(state, venture.id, agentId), 'AGENT_RETIRED', RETIRED_LINE);
  const routines = liveRoutines(state, venture.id).filter(routine => routine.agent === agentId && routine.on)
    .map(routine => ({ id: routine.id, name: routine.name, when: whenWords(routine.schedule, venture) }));
  const to = teamAgents(state, venture).filter(item => item.id !== agentId).map(item => ({ id: item.id, name: item.name }));
  const holds = {
    steps: agent.steps.map(step => step.title),
    instructions: standingOrders(state, venture, agent).length,
    notes: agentNotes(state, venture, agentId).length,
    messages: listRecords(state, 'venture-agent-message', venture.id).filter(record => record.agent === agentId).length,
  };
  const moving = inFlight(deps, state, venture, agent);
  const blocked = to.length ? null : lastOne(agent.name);
  const seen = { agent: agentId, holds, inFlight: moving.map(item => item.id), routines: routines.map(item => item.id), to: to.map(item => item.id), blocked };
  return { agent: { id: agent.id, name: agent.name, role: agent.job }, holds, inFlight: moving, routines, to, kept: RETIRE_KEPT_LINE, blocked, digest: digest(seen) };
}

/** venture.agents.retire.check { agent } (read): what the owner reads before retiring an agent. */
export async function retireCheckHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<RetireCheckView> {
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  const { state, venture } = readAs(deps, ctx, 'read');
  return checkView(deps, state, venture, agentId);
}

/**
 * venture.agents.retire { agent, to, digest } (approve, app only): retires the agent with the check the owner saw.
 * to: another AI agent on the team, or 'owner'. Its routines that are on switch off; the retirement keeps their ids.
 */
export async function retireHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentRetired> {
  requireAppChannel(ctx, 'venture.agents.retire');
  const body = exactPayload(payload, ['agent', 'to', 'digest'], ['agent', 'to', 'digest']);
  const agentId = identifier(body.agent, 'Agent');
  const to = identifier(body.to, 'Who takes over');
  check(typeof body.digest === 'string' && /^[0-9a-f]{64}$/.test(body.digest), 'APPROVAL_STALE', STALE);
  const seen = body.digest;
  readAs(deps, ctx, 'approve');
  return ventureAction(deps, ctx, 'approve', 'agents.retire', tx => {
    const venture = tx.venture!;
    const view = checkView(deps, tx.state, venture, agentId);
    check(!view.blocked, 'AGENT_LAST_ONE', view.blocked ?? '');
    check(to === OWNER_HANDOVER || view.to.some(item => item.id === to), 'INVALID_VENTURE_REQUEST', CHOOSE);
    check(view.digest === seen, 'APPROVAL_STALE', STALE);
    for (const item of view.routines) {
      const routine = tx.find('venture-routine', item.id)!;
      tx.replace<RoutineRecord>({ ...routine, on: false, at: tx.now });
    }
    const record = tx.put<AgentRetirementRecord>({
      ...tx.base('venture-agent-retirement'), agent: agentId, name: view.agent.name, to, routines: view.routines.map(item => item.id), digest: view.digest, restoredAt: null,
    });
    const retired = retiredView(record, teamFlagship(tx.state, venture));
    return { retired, line: retiredLine(retired.name, retired.to?.name ?? null, view.routines.length) };
  });
}

/**
 * venture.agents.restore { agent } (approve, app only): Bring back. The agent returns to the team as it was: its steps
 * come back to it, its chat takes words again, and the routines retiring switched off (still its own, still there and
 * still off) switch on, after the connection check routines.set asks for (ROUTINE_NEEDS_CHECK).
 */
export async function restoreHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AgentRestored> {
  requireAppChannel(ctx, 'venture.agents.restore');
  const body = exactPayload(payload, ['agent'], ['agent']);
  const agentId = identifier(body.agent, 'Agent');
  readAs(deps, ctx, 'approve');
  const route = chatRoute(deps.models.status(ctx));
  const restored = await ventureAction(deps, ctx, 'approve', 'agents.restore', tx => {
    const venture = tx.venture!;
    const record = retirementOf(tx.state, venture.id, agentId);
    check(record, 'INVALID_VENTURE_REQUEST', NOT_RETIRED);
    const routines = record.routines.map(id => tx.find('venture-routine', id))
      .filter((routine): routine is RoutineRecord => !!routine && routine.removedAt === null && !routine.on && routine.agent === agentId);
    if (routines.length && route) requireConnectorChecked(tx.state, venture.id, `model:${route.presetId}`);
    tx.replace<AgentRetirementRecord>({ ...record, restoredAt: tx.now });
    for (const routine of routines) tx.replace<RoutineRecord>({ ...routine, on: true, at: tx.now });
    return { name: record.name, routines: routines.length };
  });
  const { teamListHandler } = await import('../views/team.ts');
  const agent = (await teamListHandler(deps, ctx, {})).agents.find(item => item.id === agentId);
  check(agent, 'AGENT_NOT_FOUND', 'That agent was not found.');
  return { agent, routines: restored.routines, line: restoredLine(restored.name, restored.routines) };
}
