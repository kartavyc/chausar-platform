import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import type { KeeperJobView, VentureRunEvent } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import { Avatar } from '../../parts/Avatar';
import { Inner, Lift } from '../../parts/Card';
import { Chip } from '../../parts/Chip';
import type { DeptId } from '../../parts/icons';
import type { Member } from './departments';
import { RING } from './shared';
import s from './Team.module.css';

/** Keeper's jobs change when one of them runs (keeper.ran), and with the business. */
const onKeeper = (event: VentureRunEvent) => event.type === 'keeper.ran' || event.type === 'queue.changed';

const OUTCOME_TONE = { ok: 'done', warn: 'wait', failed: 'fail' } as const;

/**
 * Keeper's jobs as the engine reads them from records (venture.team.keeper): each job's name, its last run's outcome in
 * the UI's words (done, look at this, failed, or not run yet) and the engine's line for it. Nothing is claimed for a
 * job with no record: its outcome is "Not run yet", with the engine's note on why when it gives one.
 */
export function KeeperJobs({ name }: { name: string }) {
  const keeper = useKeeper();
  return <JobList name={name} keeper={keeper} />;
}

function useKeeper() {
  return useResource('venture.team.keeper', {}, { refreshOn: onKeeper });
}

function JobList({ name, keeper }: { name: string; keeper: ReturnType<typeof useKeeper> }) {
  const t = useT();
  if (keeper.error) return <p className={s.problem}>{t('team.keeper.failed', { message: keeper.error.message })}</p>;
  if (!keeper.data) return null;
  return (
    <ul className={s.jobs} aria-label={t('team.keeper.jobs', { name })}>
      {keeper.data.jobs.map((job) => <JobRow key={job.id} job={job} />)}
    </ul>
  );
}

/**
 * One job: with a run, its outcome in the UI's words and the engine's line for it; with none, the engine's note on why
 * (its own words, said once), or, with no note either, the UI's "Not run yet".
 */
function JobRow({ job }: { job: KeeperJobView }) {
  const t = useT();
  return (
    <li className={s.job} data-job={job.id}>
      <p className={s.jobHead}>
        <span className={s.jobName}>{job.name}</span>
        {job.lastRun && <Chip tone={OUTCOME_TONE[job.lastRun.outcome]}>{t(`team.keeper.outcome.${job.lastRun.outcome}`)}</Chip>}
        {!job.lastRun && job.note === null && <Chip tone="neutral">{t('team.keeper.notRun')}</Chip>}
      </p>
      {job.lastRun && <p className={s.jobLine}>{job.lastRun.line}</p>}
      {!job.lastRun && job.note !== null && <p className={s.jobLine}>{job.note}</p>}
    </li>
  );
}

/** How Keeper's jobs stand, in one line: how many to look at, or that every job that ran went fine. */
function KeeperSummary({ jobs }: { jobs: readonly KeeperJobView[] | undefined }) {
  const t = useT();
  if (!jobs) return null;
  const attention = jobs.filter((job) => job.lastRun && job.lastRun.outcome !== 'ok').length;
  const ran = jobs.some((job) => job.lastRun);
  if (attention > 0) return <p className={s.now} data-tone="wait">{t('team.keeper.attention', { count: attention })}</p>;
  return ran ? <p className={s.now}>{t('team.keeper.allGood')}</p> : null;
}

/**
 * Keeper as a card (spec 5.1): code, not AI, said in a chip; no Chat button and no posture, since it acts on nothing
 * the owner approves. Its name opens its panel, like any agent's; under it, how its jobs stand, and the jobs themselves:
 * as rows when `open` (Operations alone), else one step away, in a fold.
 */
export function KeeperCard({ member, dept, ground, open = false }: { member: Member; dept?: DeptId | undefined; ground: 'inner' | 'lift'; open?: boolean | undefined }) {
  const t = useT();
  const nameId = useId();
  const { agent, state } = member;
  const Card = ground === 'lift' ? Lift : Inner;
  const keeper = useKeeper();
  return (
    <li className={s.agent} data-row="" data-row-id={agent.id} data-keeper="" tabIndex={-1} aria-labelledby={nameId}>
      <Card className={s.card}>
        <div className={s.top}>
          <Avatar name={agent.name} dept={dept ?? 'ops'} state={RING[state]} size={40} />
          <div className={s.id}>
            <button type="button" id={nameId} className={s.name} data-open="" onClick={(event) => openSheet('agent', agent.id, event.currentTarget)}>
              {agent.name}
            </button>
            <p className={s.role}><Chip tone="line">{t('team.keeper.code')}</Chip></p>
          </div>
        </div>
        <KeeperSummary jobs={keeper.data?.jobs} />
        {/* Operations shown alone has room for the jobs as rows; among all five departments they wait one step away. */}
        {open ? <JobList name={agent.name} keeper={keeper} /> : (
          <details className={s.keeperFold}>
            <summary className={s.keeperSee}>{t('team.keeper.see')}</summary>
            <JobList name={agent.name} keeper={keeper} />
          </details>
        )}
      </Card>
    </li>
  );
}
