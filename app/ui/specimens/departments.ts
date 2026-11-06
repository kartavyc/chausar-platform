/**
 * The department views W4 4A1 makes the engine send (`venture.team.list` gains `department` per agent and a
 * `departments` summary), laid over the fake engine's Lumen Studio team, as tests/places/team-v2.test.tsx does. For the
 * parts page only: the fake engine itself sends departments once W4 4A2 lands.
 */

import type { AgentView, DepartmentView, EngineClient, SeriesPoint, TeamListView } from '../src/engine/types';

const DEPARTMENT_OF: Record<string, AgentView['department']> = { editor: 'production', researcher: 'marketing', producer: 'sales', publisher: 'marketing' };

const WEEKS = ['21 Sep', '28 Sep', '5 Oct', '12 Oct', '19 Oct', 'This week'];
function jobs(values: number[], receiptId: string): SeriesPoint[] {
  const most = Math.max(...values, 1);
  return values.map((value, i) => ({ key: `w${i}`, label: WEEKS[i]!, value: String(value), valuePermille: Math.round((value * 1000) / most), receiptId }));
}

function view(id: DepartmentView['id'], counts: DepartmentView['counts'], done: number, spend: string, receiptId: string, series: number[] = []): DepartmentView {
  return {
    id, name: id, counts, doneThisWeek: { count: done, receiptId }, spendThisMonth: { display: spend, receiptId },
    series: { jobs: series.length ? jobs(series, receiptId) : [], spend: [] },
  };
}

export function withDepartments(base: EngineClient): EngineClient {
  const request = base.request.bind(base);
  return {
    ...base,
    request: (async (method: string, params?: unknown) => {
      const answer = await request(method as never, params as never);
      if (method !== 'venture.team.list') return answer;
      const team = answer as TeamListView;
      return {
        ...team,
        agents: team.agents.map((agent) => ({ ...agent, department: DEPARTMENT_OF[agent.id] ?? agent.department })),
        departments: [
          view('sales', { working: 0, waiting: 1, stopped: 0, idle: 0 }, 3, '₹0.00', 'R-0415'),
          view('marketing', { working: 1, waiting: 0, stopped: 0, idle: 1 }, 7, '₹18.00', 'R-0412'),
          view('production', { working: 1, waiting: 0, stopped: 1, idle: 0 }, 6, '₹42.10', 'R-0419', [4, 5, 3, 6, 5, 6]),
          view('money', { working: 0, waiting: 0, stopped: 0, idle: 0 }, 0, '₹0.00', 'R-0402'),
          view('operations', { working: 0, waiting: 0, stopped: 0, idle: 0 }, 0, '₹0.00', 'R-0402'),
        ],
      } satisfies TeamListView;
    }) as EngineClient['request'],
  };
}
