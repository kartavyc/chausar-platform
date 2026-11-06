/**
 * The fake engine's answers for retiring an agent and Bring back (wave 6 package 6G2, D43), as the engine's
 * agents/retire.ts and agents/retired.ts answer them: venture.agents.retire.check lists what the agent holds, what is in
 * flight, the routines that switch off and who can take over, with a digest; venture.agents.retire (app only) takes that
 * digest and who takes over (another AI agent, or 'owner'), switches its routines off and puts it on the Retired shelf;
 * venture.agents.restore (app only) brings it back as it was, switching on the routines retiring switched off. The
 * words are the engine's own (platform/runtime/venture/agents/retired-words.ts).
 *
 * The team (venture.team.list) is shaped here too: a retired agent leaves the agents for `retired`, and the agent that
 * took over shows its steps; a chain of handovers ends at an agent on the team or at the owner. Nothing else changes:
 * the fake's receipts, journal, Today rows and notes stay as they were, and Today names the agent with "(retired)".
 */

import { inFlightWords, lastOneLine, NOT_RETIRED, OWNER_HANDOVER, restoredLine, RETIRE_CHOOSE, RETIRE_KEPT_LINE, RETIRE_RUN_WORDS, RETIRE_STALE, RETIRED_LINE, RETIRED_SUFFIX, retiredLine, SHELF_THREAD_LINE, shelfLine } from '../../../../platform/shared/venture/agents/retired-words.ts';
import {
  EngineError, type AgentNotesView, type AgentThreadView, type AgentView, type QueueRow, type RetireCheckView, type RetiredAgentView, type RoutineView,
  type RunSummary, type StandingOrdersView, type TeamListView,
} from './types';

export const FAKE_RETIRE_METHODS: ReadonlySet<string> = new Set(['venture.agents.retire.check', 'venture.agents.retire', 'venture.agents.restore']);

const KEEPER_ID = 'keeper';
const KEEPER_IS_CODE = 'Keeper uses fixed rules, not AI. It has no chat; its jobs are on Team.';
const NOT_FOUND = 'That agent was not found.';
const APP_ONLY = 'Approve this inside the Chausar app.';
const ID = /^[A-Za-z0-9_.:-]{1,200}$/;

/** What the desk reads from the fake engine. */
export interface RetireHost {
  current(): string;
  now(): string;
  hosted(): boolean;
  digest(value: unknown): string;
  /** The open business's own agents, as the sample holds them (before retirement shapes the team). */
  agents(): AgentView[];
  /** The fake engine's own answer to another method, inside one request. */
  ask(method: string, params: Record<string, unknown>): unknown;
  runs(): readonly RunSummary[];
  /** The Today rows still waiting, every business. */
  rows(): readonly QueueRow[];
}

interface Retirement { agent: AgentView; to: string; routines: string[]; digest: string; at: string }

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);

function exact(p: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (!Object.keys(p).every((key) => allowed.includes(key)) || !required.every((key) => Object.hasOwn(p, key))) throw invalid('Send the required fields and nothing else.');
  return p;
}

function id(value: unknown, field: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw invalid(`${field} must be a known identifier.`);
  return value;
}

/** The engine's views/shared.ts short: one line, cut at a word, with "..." when it was longer. */
function short(text: string, max: number): string {
  const single = text.replace(/\s+/g, ' ').trim();
  if (single.length <= max) return single;
  const cut = single.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

export class FakeRetireDesk {
  private readonly host: RetireHost;
  /** Retirements in force, per business, in the order they were made. */
  private readonly books = new Map<string, Map<string, Retirement>>();

  constructor(host: RetireHost) {
    this.host = host;
  }

  handles(method: string): boolean {
    return FAKE_RETIRE_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.agents.retire.check': { const body = exact(p, ['agent'], ['agent']); return this.check(id(body.agent, 'Agent')); }
      case 'venture.agents.retire': return this.retire(p);
      case 'venture.agents.restore': return this.restore(p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', 'The sample business can\'t do that yet.');
    }
  }

  private book(business = this.host.current()): Map<string, Retirement> {
    let found = this.books.get(business);
    if (!found) { found = new Map(); this.books.set(business, found); }
    return found;
  }

  /** The retired agent with when it retired, or null: what agent chat reads for the read-only shelf. */
  retiredAgent(agentId: string): { agent: AgentView; at: string; line: string } | null {
    const found = this.book().get(agentId);
    return found ? { agent: structuredClone(found.agent), at: found.at, line: SHELF_THREAD_LINE } : null;
  }

  /** Who does a role's steps now: the role on the team, else the end of its handover chain (an agent or the owner). */
  private holder(roleId: string): string {
    const book = this.book();
    let at = roleId;
    const seen = new Set<string>();
    while (book.has(at)) {
      if (seen.has(at)) return OWNER_HANDOVER;
      seen.add(at);
      at = book.get(at)!.to;
      if (at === OWNER_HANDOVER) return OWNER_HANDOVER;
    }
    return at;
  }

  /**
   * The open business's agents as the team shows them: retired ones left out, and each agent with the steps handed to
   * it, in the sample's step order.
   */
  agentsNow(agents: AgentView[]): AgentView[] {
    const book = this.book();
    if (!book.size) return agents;
    const owned = new Map<string, AgentView['steps']>();
    for (const agent of agents) {
      if (agent.id === KEEPER_ID) continue;
      const holder = this.holder(agent.id);
      if (holder === agent.id || holder === OWNER_HANDOVER) continue;
      owned.set(holder, [...(owned.get(holder) ?? []), ...structuredClone(agent.steps)]);
    }
    return agents.filter((agent) => !book.has(agent.id)).map((agent) => (owned.has(agent.id) ? { ...agent, steps: [...agent.steps, ...owned.get(agent.id)!] } : agent));
  }

  /** The team with its Retired shelf, sent only when someone is on it. */
  withShelf(view: TeamListView): TeamListView {
    const book = this.book();
    if (!book.size) return view;
    const names = new Map(this.host.agents().map((agent) => [agent.id, agent.name]));
    const retired: RetiredAgentView[] = [...book.values()].sort((a, b) => a.at.localeCompare(b.at)).map((item) => {
      const to = item.to === OWNER_HANDOVER ? null : { id: item.to, name: names.get(item.to) ?? item.to };
      return { id: item.agent.id, name: item.agent.name, role: item.agent.role, ...(item.agent.department ? { department: item.agent.department } : {}), at: item.at, to, line: shelfLine(to?.name ?? null) };
    });
    return { ...view, retired };
  }

  /** A Today row as the engine words it: an agent's name with "(retired)" while it is retired. */
  rowName(row: QueueRow): QueueRow {
    if (!row.agent) return row;
    const book = this.books.get(row.businessId);
    const retired = book && [...book.values()].some((item) => item.agent.name === row.agent);
    return retired ? { ...row, agent: `${row.agent}${RETIRED_SUFFIX}` } : row;
  }

  /** AGENT_RETIRED for a write to a retired agent (agent chat, notes, routines). */
  refuseRetired(agentId: string): void {
    if (this.book().has(agentId)) throw new EngineError('AGENT_RETIRED', RETIRED_LINE);
  }

  /** chatAgent: Keeper and code roles have no chat; an id not on this team is AGENT_NOT_FOUND; a retired one AGENT_RETIRED. */
  private onTeam(agentId: string): AgentView {
    if (agentId === KEEPER_ID) throw new EngineError('AGENT_IS_CODE', KEEPER_IS_CODE);
    if (this.book().has(agentId)) throw new EngineError('AGENT_RETIRED', RETIRED_LINE);
    const found = (this.host.ask('venture.team.list', {}) as TeamListView).agents.find((agent) => agent.id === agentId);
    if (!found) throw new EngineError('AGENT_NOT_FOUND', NOT_FOUND);
    if (found.kind === 'code') throw new EngineError('AGENT_IS_CODE', `${found.name} uses fixed rules, not AI. It has no chat; its work shows in each job's steps.`);
    return found;
  }

  private hex(value: unknown): string {
    return Array.from({ length: 8 }, (_, part) => this.host.digest({ value, part })).join('').slice(0, 64);
  }

  private check(agentId: string): RetireCheckView {
    const agent = this.onTeam(agentId);
    const team = (this.host.ask('venture.team.list', {}) as TeamListView).agents;
    const routines = ((this.host.ask('venture.routines.list', {}) as { routines: RoutineView[] }).routines)
      .filter((routine) => routine.agent === agentId && routine.on).map((routine) => ({ id: routine.id, name: routine.name, when: routine.when }));
    const to = team.filter((item) => item.id !== agentId && item.id !== KEEPER_ID && item.kind !== 'code' && item.chat !== false).map((item) => ({ id: item.id, name: item.name }));
    const thread = this.host.ask('venture.agents.thread.list', { agent: agentId }) as AgentThreadView;
    const orders = this.host.ask('venture.agents.orders.list', { agent: agentId }) as StandingOrdersView;
    const notes = this.host.ask('venture.agents.notes.list', { agent: agentId }) as AgentNotesView;
    const holds = {
      steps: agent.steps.map((step) => step.purpose), instructions: orders.orders.length, notes: notes.notes.length,
      messages: thread.items.filter((item) => item.type === 'message').length,
    };
    const inFlight: RetireCheckView['inFlight'] = [];
    for (const run of this.host.runs()) {
      const words = RETIRE_RUN_WORDS[run.state];
      if (run.agent === agent.name && run.businessId === this.host.current() && words) inFlight.push({ id: run.runId, kind: 'run', line: `${run.purpose}: ${words}` });
    }
    if (thread.waiting) inFlight.push({ id: thread.waiting.rowId, kind: 'question', line: inFlightWords.question(short(thread.waiting.question, 160)) });
    for (const item of thread.items) {
      if (item.type === 'proposal' && item.proposal.status === 'drafted') inFlight.push({ id: item.proposal.id, kind: 'proposal', line: inFlightWords.proposal(short(item.proposal.quote, 120)) });
    }
    for (const row of this.host.rows()) {
      if (row.businessId === this.host.current() && row.kind === 'proposal' && row.agent === agent.name) inFlight.push({ id: row.id, kind: 'today', line: inFlightWords.today(short(row.title, 160)) });
    }
    const blocked = to.length ? null : lastOneLine(agent.name);
    const seen = { agent: agentId, holds, inFlight: inFlight.map((item) => item.id), routines: routines.map((item) => item.id), to: to.map((item) => item.id), blocked };
    return { agent: { id: agent.id, name: agent.name, role: agent.role }, holds, inFlight, routines, to, kept: RETIRE_KEPT_LINE, blocked, digest: this.hex(seen) };
  }

  /** Switches one routine on or off with the owner's own routines.set, the way the engine replaces the record. */
  private switchRoutine(routineId: string, on: boolean): boolean {
    const routine = ((this.host.ask('venture.routines.list', {}) as { routines: RoutineView[] }).routines).find((item) => item.id === routineId);
    if (!routine || routine.prompt === undefined) return false;
    this.host.ask('venture.routines.set', { routine: { id: routine.id, name: routine.name, agent: routine.agent, prompt: routine.prompt, schedule: routine.schedule, on } });
    return true;
  }

  private retire(p: Record<string, unknown>): { retired: RetiredAgentView; line: string } {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', APP_ONLY);
    const body = exact(p, ['agent', 'to', 'digest'], ['agent', 'to', 'digest']);
    const agentId = id(body.agent, 'Agent');
    const to = id(body.to, 'Who takes over');
    if (typeof body.digest !== 'string' || !/^[0-9a-f]{64}$/.test(body.digest)) throw new EngineError('APPROVAL_STALE', RETIRE_STALE);
    const view = this.check(agentId);
    if (view.blocked) throw new EngineError('AGENT_LAST_ONE', view.blocked);
    if (to !== OWNER_HANDOVER && !view.to.some((item) => item.id === to)) throw invalid(RETIRE_CHOOSE);
    if (view.digest !== body.digest) throw new EngineError('APPROVAL_STALE', RETIRE_STALE);
    const own = this.host.agents().find((agent) => agent.id === agentId)!;
    for (const routine of view.routines) this.switchRoutine(routine.id, false);
    this.book().set(agentId, { agent: structuredClone(own), to, routines: view.routines.map((item) => item.id), digest: view.digest, at: this.host.now() });
    const retired = this.withShelf({ agents: [] }).retired!.find((item) => item.id === agentId)!;
    return { retired, line: retiredLine(retired.name, retired.to?.name ?? null, view.routines.length) };
  }

  private restore(p: Record<string, unknown>): { agent: AgentView; routines: number; line: string } {
    if (this.host.hosted()) throw new EngineError('APP_APPROVAL_REQUIRED', APP_ONLY);
    const body = exact(p, ['agent'], ['agent']);
    const agentId = id(body.agent, 'Agent');
    const book = this.book();
    const found = book.get(agentId);
    if (!found) throw invalid(NOT_RETIRED);
    book.delete(agentId);
    const offNow = ((this.host.ask('venture.routines.list', {}) as { routines: RoutineView[] }).routines)
      .filter((routine) => found.routines.includes(routine.id) && !routine.on && routine.agent === agentId);
    for (const routine of offNow) this.switchRoutine(routine.id, true);
    const agent = (this.host.ask('venture.team.list', {}) as TeamListView).agents.find((item) => item.id === agentId);
    if (!agent) throw new EngineError('AGENT_NOT_FOUND', NOT_FOUND);
    return { agent, routines: offNow.length, line: restoredLine(found.agent.name, offNow.length) };
  }
}
