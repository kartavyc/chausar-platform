import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { cx } from '../../parts/cx';
import { EmptyState } from '../../parts/EmptyState';
import { PageTitle } from '../../parts/PageTitle';
import { Row } from '../../parts/Row';
import type { AgentView, RunSummary } from '../../engine/types';
import { AgentSheet } from './AgentSheet';
import { Result, currentRun, refreshOn } from './shared';
import s from './Team.module.css';

/**
 * Team: one row per agent (name, role, what it is doing now, its last result). What it is doing now opens that run;
 * the name opens the agent sheet with its posture, gates, spend and runs. Rows refresh as runs move.
 */
export function Place() {
  const t = useT();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'active' }, { refreshOn });
  const agents = team.data?.agents;
  const some = agents !== undefined && agents.length > 0;

  return (
    <>
      <PageTitle title={t('place.team')} line={some ? t('team.line') : undefined} />
      {team.error && <p className={s.failed}>{t('team.failed', { message: team.error.message })}</p>}
      {agents?.length === 0 && (
        <EmptyState title={t('team.empty')} action={<a className={s.link} href="#/business/plan">{t('team.emptyLink')}</a>} />
      )}
      {some && (
        <ul className={s.list} aria-label={t('team.list')}>
          {agents.map((agent) => <AgentRow key={agent.id} agent={agent} run={currentRun(runs.data?.runs, agent.name)} />)}
        </ul>
      )}
    </>
  );
}

function AgentRow({ agent, run }: { agent: AgentView; run: RunSummary | undefined }) {
  const t = useT();
  const waiting = run?.state === 'waiting';
  return (
    <Row id={agent.id} title={agent.name} line={agent.role} onOpen={(origin) => openSheet('agent', agent.id, origin)}>
      <dl className={s.facts}>
        <div className={s.fact}>
          <dt>{t('team.now')}</dt>
          <dd>
            {run ? (
              <button
                type="button"
                className={cx(s.now, waiting && s.waiting)}
                data-waiting={waiting ? '' : undefined}
                onClick={(event) => openSheet('run', run.runId, event.currentTarget)}
              >
                {agent.now}
              </button>
            ) : agent.now}
          </dd>
        </div>
        <div className={s.fact}>
          <dt>{t('team.last')}</dt>
          <dd>
            {agent.last
              ? <Result line={agent.last.line} receiptId={agent.last.receiptId} estimate={agent.last.estimate} />
              : <span className={s.none}>{t('team.lastNone')}</span>}
          </dd>
        </div>
      </dl>
    </Row>
  );
}

export const sheets = { agent: AgentSheet };
