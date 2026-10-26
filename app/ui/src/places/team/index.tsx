import { useId, useMemo } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { setQuery, useRoute } from '../../shell/navigation';
import { useNarrow } from '../../shell/useNarrow';
import { EmptyState } from '../../parts/EmptyState';
import { FilterChips } from '../../parts/FilterChips';
import { PageTitle } from '../../parts/PageTitle';
import { Segmented, departmentChoices } from '../../parts/Segmented';
import { Icon } from '../../parts/Icon';
import { Bento, Tile, TileHead, type TileSpan } from '../../parts/Tile';
import { AgentList } from './AgentCard';
import { AgentSheet } from './AgentSheet';
import { CountsLine, DepartmentPanel } from './DepartmentPanel';
import { chosenDept, departmentsOf, versionOf, type DepartmentData, type Member } from './departments';
import { HealthLine } from './HealthLine';
import { JobsTile } from './JobsTile';
import { OneDepartment } from './OneDepartment';
import { membersOf, refreshOn } from './shared';
import { TeamStats } from './TeamStats';
import s from './Team.module.css';

/**
 * Team (D-Team): who is working, who waits on you and the AI spend this month, then the agents as cards. Once the
 * engine sends departments (W4 4A) the agents sit in their five tinted department panels, with a toggle that shows
 * one department at a time (held in the address as `?dept=`); before that they sit in one tile, never placed in a
 * department by the UI. Keeper, the engine's own jobs as code, sits in Operations; an agent's health shows on its card,
 * and the team's own above the departments. A card's name opens the agent panel; what it is doing now opens that run.
 * Everything refreshes as runs move.
 */
export function Place() {
  const t = useT();
  const route = useRoute();
  const narrow = useNarrow();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn });
  const overview = useResource('venture.money.overview', {}, { refreshOn });
  // The playbook version in use, for "An instruction change makes version n" on one department (W4 4A2).
  const improve = useResource('venture.improve.status', {}, { refreshOn });
  const agents = team.data?.agents;
  const members = useMemo(() => membersOf(agents ?? [], runs.data?.runs), [agents, runs.data]);
  const split = departmentsOf(team.data, members, runs.data?.runs, versionOf(improve.data?.inUse));
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
              {/* A phone: the same choice as filter chips (D-STYLE "Segmented toggle"); 4Z2: they wrap, so no chip starts cut
                  off at the edge as the row scrolled to the chosen one. */}
              {narrow
                ? <FilterChips label={t('dept.show')} options={withCounts(departmentChoices(t), members, split.departments)} value={chosen} onChange={show} />
                : <Segmented mode="buttons" label={t('dept.show')} options={departmentChoices(t)} value={chosen} onChange={show} />}
              {/* An agent joins with a way to earn: its playbook brings the team that works it (spec 5.1). */}
              <a className={s.addAgent} href="#/onboarding"><Icon name="plus" size={16} />{t('team.addAgent')}</a>
            </div>
          )}
          {team.data?.teamHealth && team.data.teamHealth.status !== 'healthy' && (
            <section className={s.teamHealth} aria-label={t('team.health.team')}>
              <HealthLine health={team.data.teamHealth} agentId="team" onCleared={team.reload} />
            </section>
          )}
          {split && chosen !== 'all' ? (
            <OneDepartment data={split.departments.find((d) => d.dept === chosen) ?? emptyDepartment(chosen)} onChanged={team.reload} />
          ) : (
            <>
              <TeamStats members={members} spent={spent} totals={team.data?.totals} bars={split?.departments.flatMap((d) => (d.jobsPermille === undefined ? [] : [d.jobsPermille]))} />
              {split
                ? <Departments departments={split.departments} apart={split.apart} jobs={team.data?.totals?.doneThisWeek.count} onChanged={team.reload} />
                : <AllAgents members={members} onChanged={team.reload} />}
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
function AllAgents({ members, onChanged }: { members: readonly Member[]; onChanged: () => void }) {
  const t = useT();
  const headId = useId();
  return (
    <Tile as="section" labelledBy={headId}>
      <TileHead id={headId} title={t('team.all')} meta={<CountsLine counts={countsOf(members)} as="span" />} />
      <AgentList members={members} label={t('team.list')} ground="inner" onChanged={onChanged} />
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
function Departments({ departments, apart, jobs, onChanged }: { departments: DepartmentData[]; apart: Member[]; jobs: number | undefined; onChanged: () => void }) {
  const t = useT();
  const apartId = useId();
  const spans = spansOf(departments);
  // D-Team: the jobs tile takes the place beside a last panel that would stand alone, else a row of its own.
  const lone = spans[spans.length - 1] === 12;
  if (jobs !== undefined && lone) spans[spans.length - 1] = 6;
  return (
    <Bento as="section" label={t('team.departments')} className={s.depts}>
      {departments.map((department, at) => <DepartmentPanel key={department.dept} data={department} span={spans[at]} onChanged={onChanged} />)}
      {jobs !== undefined && <JobsTile departments={departments} total={jobs} span={lone ? 6 : 12} />}
      {apart.length > 0 && (
        <Tile as="section" span={12} labelledBy={apartId}>
          <TileHead id={apartId} title={t('team.apart')} />
          <AgentList members={apart} label={t('team.apart')} ground="inner" onChanged={onChanged} />
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

/** The phone's chips, each with how many agents it holds (D-Phone-Team): all of them, or a department's. */
function withCounts<O extends { id: string }>(options: O[], members: readonly Member[], departments: readonly DepartmentData[]): (O & { count: number })[] {
  return options.map((option) => ({
    ...option,
    count: option.id === 'all' ? members.length : departments.find((department) => department.dept === option.id)?.members.length ?? 0,
  }));
}

