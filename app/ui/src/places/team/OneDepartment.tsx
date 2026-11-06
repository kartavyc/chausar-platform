import { useId, useState } from 'react';
import { useT } from '../../text';
import type { AgentView, RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { Inner, Lift } from '../../parts/Card';
import { BarChart } from '../../parts/charts/BarChart';
import { Chip, StateChip } from '../../parts/Chip';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { Count, Figure, proofOf } from '../../parts/Figure';
import { ProgressBar } from '../../parts/ProgressBar';
import { Bento, Panel, Tile, TileHead } from '../../parts/Tile';
import { AgentList } from './AgentCard';
import { DeptIcon } from './DepartmentPanel';
import type { DepartmentData } from './departments';
import { GateList } from './GateList';
import { Result, elapsedOf, toneOf } from './shared';
import s from './Team.module.css';

/** Recent work shows the department's latest runs, at most this many. */
const MOST_RECENT = 3;

export interface OneDepartmentProps {
  data: DepartmentData;
  /** A gate changed, or the engine refused one: read the team again. */
  onChanged?: (() => void) | undefined;
}

/**
 * One department at a time (D-TeamDept): the department as a hero panel (what it is for, its counts as chips, jobs
 * this week, spend this month with its receipt, and how many playbook steps it has), its agents, how it runs (each
 * step with its gate; floor steps always ask), its recent runs, and its jobs by week when the engine sends them. A
 * department with no agents says so in one sentence and points to the ways to earn (spec section 8).
 */
export function OneDepartment({ data, onChanged }: OneDepartmentProps) {
  const t = useT();
  const heroId = useId();
  const agentsId = useId();
  const flowId = useId();
  const recentId = useId();
  const chartId = useId();
  // The engine's answer to a gate change, by agent, with the agent it replaced. It is shown while the team is read
  // again, and kept if that read fails: a switch never flips back to a gate the engine no longer has. Once the read
  // lands (a new agent arrives for that id), the read wins.
  const [saved, setSaved] = useState<ReadonlyMap<string, { from: AgentView; agent: AgentView }>>(() => new Map());
  const name = t(`dept.${data.dept}`);
  if (data.members.length === 0) {
    return <EmptyState title={t('team.dept.none', { dept: name })} actions={[{ label: t('team.dept.noneLink'), href: '#/onboarding' }]} />;
  }
  const agents = data.members.map(({ agent }) => {
    const answer = saved.get(agent.id);
    return answer && answer.from === agent ? answer.agent : agent;
  });

  function keep(answer: AgentView) {
    const from = data.members.find((member) => member.agent.id === answer.id)?.agent;
    if (from) setSaved((before) => new Map(before).set(answer.id, { from, agent: answer }));
    onChanged?.();
  }
  const steps = agents.flatMap((agent) => agent.steps).length;
  const proof = data.spend ? proofOf({ receiptId: data.spend.receiptId }) : null;
  const recent = (data.runs ?? []).slice(0, MOST_RECENT);
  const chart = data.jobsByWeek && data.jobsByWeek.length > 0 ? data.jobsByWeek : null;
  const { counts } = data;

  return (
    <div className={s.one}>
      <Panel as="section" dept={data.dept} labelledBy={heroId} className={s.hero}>
        <DeptIcon dept={data.dept} large />
        <div className={s.heroText}>
          <h2 id={heroId} className={s.heroName}>{name}</h2>
          <p className={s.heroLine}>{t(`team.dept.about.${data.dept}`)}</p>
          {(counts.working > 0 || counts.stopped > 0 || counts.waiting > 0) && (
            <p className={s.heroChips}>
              {counts.working > 0 && <Chip tone="working">{t('team.dept.working', { count: counts.working })}</Chip>}
              {counts.stopped > 0 && <Chip tone="fail">{t('team.dept.stopped', { count: counts.stopped })}</Chip>}
              {counts.waiting > 0 && <Chip tone="wait">{t('team.dept.waiting', { count: counts.waiting })}</Chip>}
            </p>
          )}
        </div>
        <div className={s.heroStats}>
          {data.jobs !== undefined && (
            <Lift card={false} className={s.heroStat}>
              <Count value={data.jobs} className={s.heroCount} />
              <span className={s.heroLabel}>{t('team.dept.jobs')}</span>
            </Lift>
          )}
          {data.spend && proof && (
            <Lift card={false} className={s.heroStat}>
              <Figure value={data.spend.value} {...proof} size="hero" />
              <span className={s.heroLabel}>{t('team.dept.spent')}</span>
            </Lift>
          )}
          <Lift card={false} className={s.heroStat}>
            <Count value={steps} className={s.heroCount} />
            <span className={s.heroLabel}>{t('team.dept.steps')}</span>
          </Lift>
        </div>
      </Panel>

      <Bento className={s.split}>
        <Tile as="section" span={5} labelledBy={agentsId} className={s.column}>
          <TileHead id={agentsId} title={t('team.dept.agentsHead')} />
          <AgentList members={data.members} label={t('team.dept.agents', { dept: name })} dept={data.dept} ground="inner" />
        </Tile>
        <Tile as="section" span={7} labelledBy={flowId} className={s.column}>
          <TileHead id={flowId} title={t('team.dept.flow', { dept: name })} meta={data.version ? t('team.dept.versionNow', { version: data.version.current }) : undefined} />
          <p className={s.flowSub}>{t('team.dept.flowSub')}</p>
          <GateList agents={agents} look="flow" dept={data.dept} onSaved={keep} onFloor={onChanged} />
          {data.version && <p className={s.flowFoot}>{t('team.dept.version', { version: data.version.next })}</p>}
        </Tile>
      </Bento>

      <Bento className={s.split}>
        <Tile as="section" span={chart ? 8 : 12} labelledBy={recentId}>
          <TileHead id={recentId} title={t('team.dept.recent')} more={{ href: '#/work', label: t('team.dept.openWork') }} />
          {recent.length > 0
            ? <ul className={s.recent}>{recent.map((run) => <RecentRun key={run.runId} run={run} />)}</ul>
            : <p className={s.quiet}>{t('team.runsNone')}</p>}
        </Tile>
        {chart && (
          <Tile as="section" span={4} labelledBy={chartId}>
            <TileHead id={chartId} title={t('team.dept.chart')} />
            <BarChart
              kind="count"
              series={[{ label: t('team.dept.chartSeries'), points: chart }]}
              dept={data.dept}
              label={t('team.dept.chartLabel', { values: chart.map((point) => `${point.label} ${point.value}`).join(', ') })}
            />
          </Tile>
        )}
      </Bento>
    </div>
  );
}

/** One recent run as a small card: its state in words, what it was for (it opens the run), and how it went. */
function RecentRun({ run }: { run: RunSummary }) {
  const t = useT();
  const titleId = useId();
  return (
    <li className={s.recentItem}>
      <Inner as="article" labelledBy={titleId} className={s.work}>
        <p className={s.workKind}>
          <StateChip kind="run" value={run.state} />
          <span className={cx(s.elapsed, 'mono')}>{elapsedOf(t, run)}</span>
        </p>
        <h3 id={titleId} className={s.workTitle}>
          <button type="button" className={s.workOpen} onClick={(event) => openSheet('run', run.runId, event.currentTarget)}>{run.purpose}</button>
        </h3>
        {run.state === 'failed' && <p className={s.failure}>{run.result ?? t('run.stopped')}</p>}
        {run.state === 'done' && run.result !== undefined && (
          <p className={s.workLine}><Result line={run.result} receiptId={run.receiptId} estimate={run.estimate} /></p>
        )}
        {(run.state === 'active' || run.state === 'waiting') && run.progress && <ProgressBar progress={run.progress} tone={toneOf(run)} className={s.workBar} />}
      </Inner>
    </li>
  );
}
