import { useId, useMemo } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { setQuery, useRoute } from '../../shell/navigation';
import { useNarrow } from '../../shell/useNarrow';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips } from '../../parts/FilterChips';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented, departmentChoices } from '../../parts/Segmented';
import { Bento, Tile, TileHead, type TileSpan } from '../../parts/Tile';
import { AgentList } from './AgentCard';
import { AgentSheet } from './AgentSheet';
import { CountsLine, DepartmentPanel } from './DepartmentPanel';
import { chosenDept, departmentsOf, type DepartmentData, type Member } from './departments';
import { OneDepartment } from './OneDepartment';
import { membersOf, refreshOn } from './shared';
import { TeamStats } from './TeamStats';
import s from './Team.module.css';

/**
 * Team (D-Team): who is working, who waits on you and the AI spend this month, then the agents as cards. Once the
 * engine sends departments (W4 4A) the agents sit in their five tinted department panels, with a toggle that shows
 * one department at a time (held in the address as `?dept=`); before that they sit in one tile, never placed in a
 * department by the UI. A card's name opens the agent panel; what it is doing now opens that run. Everything refreshes
 * as runs move.
 */
export function Place() {
  const t = useT();
  const route = useRoute();
  const narrow = useNarrow();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn });
  const overview = useResource('venture.money.overview', {}, { refreshOn });
  const agents = team.data?.agents;
  const members = useMemo(() => membersOf(agents ?? [], runs.data?.runs), [agents, runs.data]);
  const split = departmentsOf(team.data, members, runs.data?.runs);
  // The page line counts the departments people work in; every department the engine lists gets its panel (the five
  // are fixed, so an empty one shows with its way forward).
  const staffed = split ? split.departments.filter((department) => department.members.length > 0) : [];
  const chosen = chosenDept(route.query.dept);
  const some = agents !== undefined && agents.length > 0;
  const spent = overview.data?.lines.find((line) => line.id === 'spent');

  function show(id: string) {
    const { dept: _dropped, ...rest } = route.query;
    setQuery(id === 'all' ? rest : { ...rest, dept: id });
  }

  const count = String(agents?.length ?? 0);
  const agentsWord = t('team.agentCount', { count });
  const line = !some ? undefined : split
    ? t('team.subDepts', { agents: agentsWord, depts: t('team.deptCount', { count: String(staffed.length) }) })
    : t('team.sub', { agents: agentsWord });

  return (
    <>
      <PageTitle title={t('place.team')} line={line} count={some ? count : undefined} />
      {team.error && <p className={s.failed}>{t('team.failed', { message: team.error.message })}</p>}
      {agents?.length === 0 && (
        <EmptyState title={t('team.empty')} actions={[{ label: t('team.emptyLink'), href: '#/business/plan' }]} />
      )}
      {some && (
        <div className={s.page}>
          {split && (
            <div className={s.toolbar}>
              {/* A phone: the same choice as a row of filter chips that scrolls sideways (D-STYLE "Segmented toggle"). */}
              {narrow
                ? <FilterChips label={t('dept.show')} options={departmentChoices(t)} value={chosen} onChange={show} scroll />
                : <Segmented mode="buttons" label={t('dept.show')} options={departmentChoices(t)} value={chosen} onChange={show} />}
            </div>
          )}
          {split && chosen !== 'all' ? (
            <OneDepartment data={split.departments.find((d) => d.dept === chosen) ?? emptyDepartment(chosen)} onChanged={team.reload} />
          ) : (
            <>
              <TeamStats members={members} spent={spent} />
              {split ? <Departments departments={split.departments} apart={split.apart} /> : <AllAgents members={members} />}
            </>
          )}
        </div>
      )}
    </>
  );
}

/** A department the engine did not list, or lists with nobody in it. */
function emptyDepartment(dept: DepartmentData['dept']): DepartmentData {
  return { dept, counts: { working: 0, waiting: 0, stopped: 0, idle: 0 }, members: [] };
}

/** Before the engine sends departments: every agent in one tile, on the neutral wash. */
function AllAgents({ members }: { members: readonly Member[] }) {
  const t = useT();
  const headId = useId();
  return (
    <Tile as="section" labelledBy={headId}>
      <TileHead id={headId} title={t('team.all')} meta={<CountsLine counts={countsOf(members)} as="span" />} />
      <AgentList members={members} label={t('team.list')} ground="inner" />
    </Tile>
  );
}

/** The engine's counts are per department; for the one tile they are counted here from each agent's state. */
function countsOf(members: readonly Member[]): DepartmentData['counts'] {
  const of = (state: Member['state']) => members.filter((member) => member.state === state).length;
  return { working: of('working'), waiting: of('waiting'), stopped: of('failed'), idle: of('idle') };
}

/**
 * The tinted department panels, two to a row: a panel with one agent beside one with more takes five columns to their
 * seven (D-Team), two alike share the row, and a last one alone takes it whole. Agents the engine put in no department
 * follow in a plain tile.
 */
function Departments({ departments, apart }: { departments: DepartmentData[]; apart: Member[] }) {
  const t = useT();
  const apartId = useId();
  const spans = spansOf(departments);
  return (
    <Bento as="section" label={t('team.departments')} className={s.depts}>
      {departments.map((department, at) => <DepartmentPanel key={department.dept} data={department} span={spans[at]} />)}
      {apart.length > 0 && (
        <Tile as="section" span={12} labelledBy={apartId}>
          <TileHead id={apartId} title={t('team.apart')} />
          <AgentList members={apart} label={t('team.apart')} ground="inner" />
        </Tile>
      )}
    </Bento>
  );
}

function spansOf(departments: readonly DepartmentData[]): TileSpan[] {
  const single = (department: DepartmentData | undefined) => (department?.members.length ?? 0) <= 1;
  const spans: TileSpan[] = [];
  for (let at = 0; at < departments.length; at += 2) {
    if (at + 1 >= departments.length) { spans.push(12); break; }
    const first = single(departments[at]);
    const second = single(departments[at + 1]);
    if (first === second) spans.push(6, 6);
    else if (first) spans.push(5, 7);
    else spans.push(7, 5);
  }
  return spans;
}

export const sheets = { agent: AgentSheet };
