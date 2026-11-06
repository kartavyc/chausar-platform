/**
 * Team's departments (spec section 3 "Team", 5.1): the view model the department panel and the one-department view
 * draw, and the one place engine department ids meet the UI's. Every count here is the engine's; the UI only groups
 * agents by the department the engine gave each one and never puts an agent in a department itself.
 */

import type { AgentView, DepartmentId, RunSummary, TeamListView } from '../../engine/types';
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
  counts: { working: number; waiting: number; stopped: number; idle: number };
  jobs?: number | undefined;
  spend?: { value: string; receiptId: string } | undefined;
  members: Member[];
  /** The department's runs, latest first: the one-department view's recent work. */
  runs?: RunSummary[] | undefined;
  /** The playbook version its steps belong to, and the one a change makes (W4 4B). */
  version?: { current: number; next: number } | undefined;
  /** Jobs per week, scaled by the engine (W4 4A). */
  jobsByWeek?: BarPoint[] | undefined;
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
export function departmentsOf(view: TeamListView | undefined, members: readonly Member[], runs: readonly RunSummary[] | undefined): { departments: DepartmentData[]; apart: Member[] } | null {
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
      counts: d.counts,
      jobs: d.doneThisWeek.count,
      spend: { value: d.spendThisMonth.display, receiptId: d.spendThisMonth.receiptId },
      members: mine,
      runs: latestFirst((runs ?? []).filter((run) => names.has(run.agent))),
      jobsByWeek: jobsByWeek.length > 0 ? jobsByWeek : undefined,
    };
  });
  const apart = members.filter((member) => !member.agent.department || !listed.has(member.agent.department));
  return { departments, apart };
}
