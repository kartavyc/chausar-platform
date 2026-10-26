/**
 * Team's departments (spec section 3 "Team", 5.1): the view model the department panel and the one-department view
 * draw, and the one place engine department ids meet the UI's. Every count here is the engine's; the UI only groups
 * agents by the department the engine gave each one and never puts an agent in a department itself.
 */

import type { AgentView, DepartmentId, DepartmentSpend, RunSummary, TeamListView } from '../../engine/types';
import type { BarPoint } from '../../parts/charts/types';
import { DEPT_IDS, type DeptId } from '../../parts/icons';

/** What an agent is doing, for its ring and its words. */
export type AgentState = 'working' | 'waiting' | 'failed' | 'idle';

/** An agent with the run it is on now (one waiting on the owner first, else one at work) and its state. */
export interface Member {
  agent: AgentView;
  run: RunSummary | undefined;
  state: AgentState;
}

/**
 * One department, as the panel and the one-department view draw it. `counts` are the engine's own; `jobs` (done
 * this week) and `spend` (this month, with its receipt) are there once the engine sends department summaries (W4 4A).
 */
export interface DepartmentData {
  dept: DeptId;
  /** The engine's own id for the department, when it sent one. */
  id?: DepartmentId | undefined;
  counts: { working: number; waiting: number; stopped: number; idle: number };
  jobs?: number | undefined;
  /** This week's jobs against the busiest department's, per mille, as the engine scaled them (4A2). */
  jobsPermille?: number | undefined;
  /** Spend this month with its receipt; the engine's rupees at the owner's rate, what running calls hold, in its
   *  words with that amount's own receipt (W4 4A1), and the share of the month's whole spend (4A2). 4Z3: `value` is the
   *  figure as the engine says it leads, `rupees` the other currency at the rate beneath it, `other` that amount alone. */
  spend?: { value: string; receiptId: string; rupees?: string | undefined; rate?: string | undefined; other?: string | undefined; held?: { words: string; receiptId: string } | undefined; share?: number | undefined } | undefined;
  members: Member[];
  /** The department's runs, latest first: the one-department view's recent work. */
  runs?: RunSummary[] | undefined;
  /** The playbook version its steps belong to, and the one a change makes (W4 4B). */
  version?: { current: number; next: number } | undefined;
  /** Jobs per week, scaled by the engine (W4 4A). */
  jobsByWeek?: BarPoint[] | undefined;
  /** Spend per week, by the same week keys, each week with its own receipt (W4 4A1's series). */
  spendByWeek?: { key: string; value: string | null; receiptId: string | null }[] | undefined;
}

/** The engine's department ids, as the UI's (the D class suffixes and token prefixes in icons.ts). */
export const DEPT_OF: Readonly<Record<DepartmentId, DeptId>> = {
  sales: 'sales',
  marketing: 'mkt',
  production: 'prod',
  money: 'money',
  operations: 'ops',
};

/** The toggle's choice from the address: `all`, or a department id the UI knows. */
export function chosenDept(value: string | undefined): 'all' | DeptId {
  return value !== undefined && (DEPT_IDS as readonly string[]).includes(value) ? (value as DeptId) : 'all';
}

/** An agent is waiting when its run waits on the owner, working when it has a run at work, failed when its latest run
 *  stopped, idle otherwise. The engine's own state wins when it sends one (W4 4A1). */
export function stateOf(agent: AgentView, runs: readonly RunSummary[] | undefined): AgentState {
  if (agent.state) return agent.state;
  const mine = (runs ?? []).filter((run) => run.agent === agent.name);
  if (mine.some((run) => run.state === 'waiting')) return 'waiting';
  if (mine.some((run) => run.state === 'active')) return 'working';
  const latest = latestFirst(mine)[0];
  return latest?.state === 'failed' ? 'failed' : 'idle';
}

/** Runs, the latest started first (ISO times sort as text). */
export function latestFirst(runs: readonly RunSummary[]): RunSummary[] {
  return [...runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
}

/**
 * The departments the engine sent, in its order, each with the agents it put there; null when it sends none (the
 * engine before W4 4A), so Team shows one tile of agents instead. Agents with no department, or one the engine did
 * not list, are returned apart and never placed in one.
 */
export function departmentsOf(view: TeamListView | undefined, members: readonly Member[], runs: readonly RunSummary[] | undefined, version?: DepartmentData['version']): { departments: DepartmentData[]; apart: Member[] } | null {
  if (!view?.departments || view.departments.length === 0) return null;
  const listed = new Set(view.departments.map((d) => d.id));
  const departments = view.departments.map((d): DepartmentData => {
    const mine = members.filter((member) => member.agent.department === d.id);
    const names = new Set(mine.map((member) => member.agent.name));
    const jobsByWeek = d.series.jobs.map((point): BarPoint => ({
      key: point.key, label: point.label, value: point.value ?? '', valuePermille: point.valuePermille, receiptId: point.receiptId ?? undefined,
    }));
    return {
      dept: DEPT_OF[d.id],
      id: d.id,
      counts: d.counts,
      jobs: d.doneThisWeek.count,
      jobsPermille: d.doneThisWeek.permille,
      spend: spendOf(d.spendThisMonth),
      members: mine,
      runs: latestFirst((runs ?? []).filter((run) => names.has(run.agent))),
      jobsByWeek: jobsByWeek.length > 0 ? jobsByWeek : undefined,
      // 4Z3: each week as the engine says it leads (rupees or dollars first, dollars to two decimals).
      spendByWeek: d.series.spend.length > 0 ? d.series.spend.map((point) => ({ key: point.key, value: point.lead?.figure ?? point.value, receiptId: point.receiptId })) : undefined,
      version,
    };
  });
  const apart = members.filter((member) => !member.agent.department || !listed.has(member.agent.department));
  return { departments, apart };
}

/**
 * A spend figure as Team draws it: the engine's text, receipt and rupees, and the held amount only with its receipt.
 * 4Z3: led as the engine says (rupees or dollars first), the other currency beneath it.
 */
export function spendOf(spend: DepartmentSpend): NonNullable<DepartmentData['spend']> {
  return {
    value: spend.lead?.figure ?? spend.display,
    receiptId: spend.receiptId,
    rupees: spend.lead ? spend.lead.beside : spend.rupees,
    other: spend.lead?.other,
    rate: spend.rate,
    held: spend.held && spend.heldReceiptId ? { words: spend.held, receiptId: spend.heldReceiptId } : undefined,
    share: spend.sharePermille,
  };
}

/** The playbook version in use (venture.improve.status), and the one an instruction change makes. */
export function versionOf(inUse: { version: number } | null | undefined): DepartmentData['version'] {
  return inUse ? { current: inUse.version, next: inUse.version + 1 } : undefined;
}

/** Keeper, the engine's own jobs as code (W4 4A1): its id on every team, and code, not AI. */
export const KEEPER_ID = 'keeper';
export function isKeeper(agent: AgentView): boolean {
  return agent.id === KEEPER_ID && agent.kind === 'code';
}

/**
 * Helpers under the agent they report to (W4 4J12 sets `parentId`): each helper right after its parent, in the
 * engine's order otherwise. A helper whose parent is not in the list keeps its place.
 */
export function nested(members: readonly Member[]): Member[] {
  const ids = new Set(members.map((member) => member.agent.id));
  const helps = (member: Member) => member.agent.parentId && ids.has(member.agent.parentId) ? member.agent.parentId : null;
  const out: Member[] = [];
  const place = (member: Member) => {
    out.push(member);
    for (const helper of members) if (helps(helper) === member.agent.id) place(helper);
  };
  for (const member of members) if (!helps(member)) place(member);
  return out.length === members.length ? out : [...members];
}

/**
 * The engine's words without the rate they end with ("₹38.00 at ₹83.50 per $1 (your rate, set ...)" as "₹38.00"), so a
 * page says the rate once. Only the exact words the engine sends as `rate` are taken off; anything else stays whole.
 */
export function withoutRate(text: string, rate: string | undefined): string {
  const tail = rate ? ` at ${rate}` : null;
  return tail && text.endsWith(tail) ? text.slice(0, -tail.length) : text;
}
