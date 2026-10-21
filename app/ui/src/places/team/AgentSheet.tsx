import { useEffect, useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type AgentView, type RunSummary } from '../../engine/types';
import { openSheet } from '../../shell/navigation';
import type { SheetComponentProps } from '../../shell/sheets';
import { cx } from '../../parts/cx';
import { Gate } from '../../parts/Gate';
import { Sheet } from '../../parts/Sheet';
import { POSTURES, Result, agentRow, refreshOn } from './shared';
import s from './Team.module.css';

type GateValue = 'auto' | 'hold';

/**
 * One agent: its posture in words and what that means, its playbook steps each with an auto or hold gate, what it
 * has spent, and its runs. A gate moves when clicked and settles on the engine's answer; a refusal moves it back and
 * says why. Floor steps always ask and have no switch.
 */
export function AgentSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const client = useEngine();
  const stepsId = useId();
  const runsId = useId();
  const team = useResource('venture.team.list', {}, { refreshOn });
  const runs = useResource('venture.runs.list', { state: 'all' }, { refreshOn });
  // The engine's answer to a gate change, shown until the list itself is read again.
  const [saved, setSaved] = useState<AgentView | null>(null);
  const [pending, setPending] = useState<{ stepId: string; gate: GateValue } | null>(null);
  const [problem, setProblem] = useState<{ stepId: string; text: string } | null>(null);
  useEffect(() => { setSaved(null); }, [team.data]);

  const agent = saved ?? team.data?.agents.find((a) => a.id === id);
  if (!agent) {
    const title = team.data ? t('team.notFound') : team.error ? t('team.failed', { message: team.error.message }) : t('team.loading');
    return <Sheet label={t('team.sheet')} title={title} onClose={onClose} returnFocus={returnFocus} />;
  }

  async function change(stepId: string, gate: GateValue) {
    if (pending || !agent) return;
    setProblem(null);
    setPending({ stepId, gate });
    try {
      const reply = await client.request('venture.team.gate', { agentId: agent.id, stepId, gate });
      setSaved(reply.agent);
    } catch (error) {
      const floor = error instanceof EngineError && error.code === 'GATE_FLOOR';
      const message = error instanceof Error ? error.message : String(error);
      setProblem({ stepId, text: floor ? t('team.gateFloor') : t('team.gateFailed', { message }) });
      if (floor) team.reload();
    } finally {
      setPending(null);
    }
  }

  const known = POSTURES.includes(agent.posture);
  const mine = (runs.data?.runs ?? []).filter((run) => run.agent === agent.name);

  return (
    <Sheet label={t('team.sheet')} title={agent.name} line={agent.role} onClose={onClose} returnFocus={returnFocus}>
      <section className={s.section}>
        <h3 className={s.small}>{t('team.posture')}</h3>
        <p className={s.posture}>{known ? t(`team.posture.${agent.posture}`) : agent.posture}</p>
        {known && <p className={s.means}>{t(`team.postureMeans.${agent.posture}`)}</p>}
      </section>

      <section className={s.section}>
        <h3 id={stepsId} className={s.small}>{t('team.steps')}</h3>
        <ul className={s.steps} aria-labelledby={stepsId}>
          {agent.steps.map((step) => (
            <li key={step.id} className={s.step}>
              <span className={s.purpose}>{step.purpose}</span>
              <Gate
                purpose={step.purpose}
                gate={pending?.stepId === step.id ? pending.gate : step.gate}
                floor={step.floor}
                disabled={pending !== null}
                onChange={(gate) => void change(step.id, gate)}
              />
              {problem?.stepId === step.id && <p role="alert" className={s.problem}>{problem.text}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className={s.section}>
        <h3 className={s.small}>{t('team.spend')}</h3>
        <p className={s.spend}>{agent.spend}</p>
      </section>

      <section className={s.section}>
        <h3 id={runsId} className={s.small}>{t('team.runs')}</h3>
        {runs.error && <p className={s.failed}>{t('team.failed', { message: runs.error.message })}</p>}
        {runs.data && mine.length === 0 && <p className={s.quiet}>{t('team.runsNone')}</p>}
        {mine.length > 0 && (
          <ul className={s.runs} aria-labelledby={runsId}>
            {mine.map((run) => <RunLine key={run.runId} run={run} agentId={agent.id} />)}
          </ul>
        )}
      </section>
    </Sheet>
  );
}

/** One run: its purpose opens the shell's run sheet; under it, waiting, progress, failure or result. */
function RunLine({ run, agentId }: { run: RunSummary; agentId: string }) {
  const t = useT();
  return (
    <li className={s.run} data-row="" tabIndex={-1}>
      <span className={s.runTop}>
        <button type="button" className={s.runOpen} data-open="" onClick={(event) => openSheet('run', run.runId, agentRow(agentId) ?? event.currentTarget)}>
          {run.purpose}
        </button>
        <span className={cx(s.elapsed, 'mono')}>{run.state === 'waiting' ? t('run.paused') : run.elapsed}</span>
      </span>
      {run.state === 'waiting' ? (
        <span className={s.waiting}>{t('run.waiting')}</span>
      ) : run.state === 'failed' ? (
        <span className={s.failure}>{run.result ?? t('run.stopped')}</span>
      ) : run.state === 'done' ? (
        run.result !== undefined && <span className={s.result}><Result line={run.result} receiptId={run.receiptId} estimate={run.estimate} /></span>
      ) : run.progress === 'indeterminate' ? (
        <span className={s.quiet}>{t('steps.indeterminate')}</span>
      ) : run.progress ? (
        <span className={s.quiet}>{t('steps.progress', { done: run.progress.done, total: run.progress.total })}</span>
      ) : null}
    </li>
  );
}
