import { useId } from 'react';
import { useT } from '../text';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import type { RunSummary } from '../engine/types';
import s from './JobList.module.css';

export interface JobListProps {
  runs: RunSummary[];
  onOpen: (run: RunSummary, origin: HTMLElement) => void;
  /** Left out, failed jobs show their failure without a Run again button. */
  onRunAgain?: ((run: RunSummary) => void) | undefined;
}

/** Long work, BridgeClip layout: active above previous, per-stage progress, "indeterminate" when unmeasured,
 *  real failure text and Run again. Previous jobs fold to one line each. */
export function JobList({ runs, onOpen, onRunAgain }: JobListProps) {
  const t = useT();
  const id = useId();
  const active = runs.filter((r) => r.state === 'active' || r.state === 'waiting');
  const previous = runs.filter((r) => r.state === 'done' || r.state === 'failed');
  if (active.length === 0 && previous.length === 0) return <EmptyState title={t('jobs.none')} />;

  const open = (run: RunSummary) => (
    <button type="button" className={s.purpose} data-open="" onClick={(event) => onOpen(run, event.currentTarget)}>
      {run.purpose}
    </button>
  );

  return (
    <div className={s.lists}>
      {active.length > 0 && (
        <section aria-labelledby={`${id}-active`}>
          <h2 id={`${id}-active`} className={s.heading}>{t('jobs.active')}</h2>
          <ul className={s.list}>
            {active.map((run) => (
              <li key={run.runId} className={s.job} data-row="" data-row-id={run.runId} tabIndex={-1}>
                <span className={s.agent}>{run.agent}</span>
                {open(run)}
                {run.state === 'waiting' ? (
                  <span className={s.wait}>{t('run.waiting')}</span>
                ) : run.progress === 'indeterminate' ? (
                  <span className={s.stage}>{t('steps.indeterminate')}</span>
                ) : run.progress ? (
                  <span className={s.stage}>
                    <progress className={s.bar} value={run.progress.done} max={run.progress.total} aria-label={t('steps.progress', { done: run.progress.done, total: run.progress.total })} />
                    <span>{t('steps.progress', { done: run.progress.done, total: run.progress.total })}</span>
                  </span>
                ) : null}
                <span className={`${s.elapsed} mono`}>{run.state === 'waiting' ? t('run.paused') : run.elapsed}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {previous.length > 0 && (
        <section aria-labelledby={`${id}-previous`}>
          <h2 id={`${id}-previous`} className={s.heading}>{t('jobs.previous')}</h2>
          <ul className={s.list}>
            {previous.map((run) => (
              <li key={run.runId} className={s.job} data-row="" data-row-id={run.runId} tabIndex={-1}>
                <span className={s.agent}>{run.agent}</span>
                {open(run)}
                {run.state === 'failed' ? (
                  <span className={s.failed}>
                    <span className={s.failure}>{run.result ?? t('run.stopped')}</span>
                    {onRunAgain && <Button data-key="primary" onClick={() => onRunAgain(run)}>{t('run.again')}</Button>}
                  </span>
                ) : run.result !== undefined ? (
                  <span className={s.result}>
                    {run.estimate ? <ModelEstimate value={run.result} /> : <>{run.result}{run.receiptId && <> <Receipt id={run.receiptId} /></>}</>}
                  </span>
                ) : null}
                <span className={`${s.elapsed} mono`}>{run.elapsed}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
