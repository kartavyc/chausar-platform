import { useId } from 'react';
import { useT } from '../text';
import { Avatar, type AvatarState } from './Avatar';
import { Button } from './Button';
import { EmptyState } from './EmptyState';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import { Row } from './Row';
import type { RunState, RunSummary } from '../engine/types';
import s from './JobList.module.css';

export interface JobListProps {
  runs: RunSummary[];
  onOpen: (run: RunSummary, origin: HTMLElement) => void;
  /** Left out, failed jobs show their failure without a Run again button. */
  onRunAgain?: ((run: RunSummary) => void) | undefined;
}

/** The ring each run's state draws around its agent: working, waiting on you, stopped; a finished run has none. */
const RINGS: Readonly<Record<RunState, AvatarState>> = { active: 'working', waiting: 'waiting', failed: 'failed', done: 'idle' };

/**
 * Long work in D's look (Today's "Working now" and Work's "Finished" tiles): two tiles of list rows, active above
 * previous. Each run shows its agent's avatar ringed by its state, the purpose (which opens it), and its progress: a
 * still bar in the state's colour with "3 of 5" when measured, a still segment and "indeterminate" when not. Nothing
 * moves. Previous runs show their result with its receipt or "model estimate", and a failure in its own words with
 * Run again.
 */
export function JobList({ runs, onOpen, onRunAgain }: JobListProps) {
  const t = useT();
  const id = useId();
  const active = runs.filter((r) => r.state === 'active' || r.state === 'waiting');
  const previous = runs.filter((r) => r.state === 'done' || r.state === 'failed');
  if (active.length === 0 && previous.length === 0) return <EmptyState title={t('jobs.none')} />;

  const mark = (run: RunSummary) => <Avatar name={run.agent} state={RINGS[run.state]} size={32} />;
  const open = (run: RunSummary) => (origin: HTMLElement) => onOpen(run, origin);

  const progress = (run: RunSummary) => {
    const waiting = run.state === 'waiting';
    const unmeasured = run.progress === 'indeterminate';
    const words = waiting
      ? <span className={s.wait}>{t(unmeasured ? 'ring.indeterminateWaiting' : 'run.waiting')}</span>
      : run.progress === 'indeterminate'
        ? <span>{t('ring.indeterminate')}</span>
        : run.progress
          ? <span className="mono" data-count="">{t('steps.progress', { done: run.progress.done, total: run.progress.total })}</span>
          : null;
    if (!words) return undefined;
    return (
      <span className={s.progress}>
        {run.progress === 'indeterminate' ? (
          <span className={s.track} data-still="" aria-hidden="true"><span className={s.still} data-tone={waiting ? 'wait' : 'working'} /></span>
        ) : run.progress ? (
          <progress
            className={s.bar}
            data-tone={waiting ? 'wait' : 'working'}
            value={run.progress.done}
            max={run.progress.total}
            aria-label={t('steps.progress', { done: run.progress.done, total: run.progress.total })}
          />
        ) : null}
        {words}
      </span>
    );
  };

  /** The sub line of a previous run: its agent, then what came of it (a failure in fail words). */
  const result = (run: RunSummary) => {
    const outcome = run.state === 'failed' ? <span className={s.failure}>{run.result ?? t('run.stopped')}</span> : run.result;
    return outcome === undefined ? run.agent : <>{run.agent}{' · '}{outcome}</>;
  };

  const proof = (run: RunSummary) => {
    if (run.state !== 'done' || run.result === undefined) return undefined;
    // A model-written result never carries a receipt, even when one is sent.
    if (run.estimate) return <ModelEstimate />;
    return run.receiptId ? <Receipt id={run.receiptId} /> : undefined;
  };

  return (
    <div className={s.lists}>
      {active.length > 0 && (
        <section className={s.tile} data-tile="" aria-labelledby={`${id}-active`}>
          <h2 id={`${id}-active`} className={s.heading}>{t('jobs.active')}</h2>
          <ul className={s.list}>
            {active.map((run) => (
              <Row
                key={run.runId} id={run.runId} mark={mark(run)} title={run.purpose} line={run.agent} onOpen={open(run)}
                aside={progress(run)} end={run.state === 'waiting' ? t('run.paused') : run.elapsed}
              />
            ))}
          </ul>
        </section>
      )}
      {previous.length > 0 && (
        <section className={s.tile} data-tile="" aria-labelledby={`${id}-previous`}>
          <h2 id={`${id}-previous`} className={s.heading}>{t('jobs.previous')}</h2>
          <ul className={s.list}>
            {previous.map((run) => (
              <Row
                key={run.runId} id={run.runId} mark={mark(run)} title={run.purpose} line={result(run)} onOpen={open(run)} dense
                aside={proof(run)}
                actions={run.state === 'failed' && onRunAgain ? <Button size="sm" data-key="primary" onClick={() => onRunAgain(run)}>{t('run.again')}</Button> : undefined}
                end={run.elapsed}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
