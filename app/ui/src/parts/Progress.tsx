import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../text';
import { useWork, type WorkStepView } from '../engine/useWork';
import { LONG_WORK } from '../../../../platform/shared/venture/views/work-steps.ts';
import type { WorkKind } from '../../../../platform/runtime/venture/views/work-steps.ts';
import { Button } from './Button';
import { Icon } from './Icon';
import { StillArc } from './StepMark';
import { Swap } from './Swap';
import { formatAge } from '../../../../platform/shared/owner-format.ts';
import s from './Progress.module.css';

/**
 * The time since `from`, as words that change once a second ("1 min 20 s"): plain text, not an animation, so it shows
 * under reduced motion and with animations off too. Nothing under a second.
 */
export function useElapsed(from: string | null, running = true): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    if (!running || !from) return undefined;
    setNow(new Date().toISOString());
    const timer = setInterval(() => setNow(new Date().toISOString()), 1000);
    return () => clearInterval(timer);
  }, [from, running]);
  return from ? formatAge(from, now) : '';
}

/** The moment a wait started, kept while it runs and forgotten when it ends. */
function useStartedAt(running: boolean): string | null {
  const started = useRef<string | null>(null);
  if (running && !started.current) started.current = new Date().toISOString();
  if (!running) started.current = null;
  return started.current;
}

function StepRow({ step, label, since, t }: { step: WorkStepView; label: string; since: string | null; t: ReturnType<typeof useT> }) {
  const elapsed = useElapsed(step.state === 'current' ? since : null);
  const word = step.state === 'failed' ? t('progress.failed') : step.state === 'done' ? t('steps.done') : step.state === 'current' ? t('steps.current') : t('steps.pending');
  return (
    <li className={s.step} data-state={step.state}>
      <span className={s.mark} aria-hidden="true">
        <Swap value={step.state}>
          {step.state === 'current' ? <StillArc /> : step.state === 'done' ? <Icon name="check" size={14} /> : step.state === 'failed' ? <Icon name="x" size={14} /> : <span className={s.pending} />}
        </Swap>
      </span>
      <span className={s.words}>{label}</span>
      {step.state === 'current' && elapsed && <span className={s.elapsed}>{elapsed}</span>}
      {step.state === 'failed' && <span className={s.failed}>{word}</span>}
      {step.state !== 'failed' && <span className="sr-only">{word}</span>}
    </li>
  );
}

export interface ProgressProps {
  kind: WorkKind;
  /** The page's own request is on its way. Left out, the part shows only a job it finds running. */
  active?: boolean | undefined;
  /** The steps when the job's own list names them (a tool, a practice client): each step's id, in order. */
  stepIds?: readonly string[] | undefined;
  /** The words for a step whose id is not in the kind's list (a tool's name, a practice client's name). */
  labelOf?: ((id: string) => string) | undefined;
  /** "Keep working" on a long job: the words say where its result lands. Long kinds only. */
  landsAt?: string | undefined;
  /** "Stop waiting", where the owner only stops watching and the answer is still taken when it lands. */
  onStopWaiting?: (() => void) | undefined;
  stopWaitingLabel?: string | undefined;
  children?: ReactNode;
}

/**
 * Long work as what it is (one-shot C3 task 11): the steps listed up front, a still arc on the current one with its
 * elapsed time, a tick on each done one, and a failed one saying so in words. Nothing spins and nothing loops. Long
 * kinds offer "Keep working": the owner leaves the page, the job goes on, and the words say where the result lands.
 * It draws nothing when nothing runs, so it never counts against a page at rest.
 */
export function Progress({ kind, active = false, stepIds, labelOf, landsAt, onStopWaiting, stopWaitingLabel, children }: ProgressProps) {
  const t = useT();
  const work = useWork(kind, { active, stepIds });
  if (!work.live) return null;
  return (
    <div className={s.progress} role="status" data-progress={kind}>
      <ol className={s.steps}>
        {work.steps.map((step) => (
          <StepRow key={step.id} step={step} label={step.label || labelOf?.(step.id) || step.id} since={step.since ?? work.startedAt} t={t} />
        ))}
      </ol>
      {children}
      {LONG_WORK.has(kind) && (
        <p className={s.leave}>
          <a href="#/today" data-keep-working="">{t('progress.keepWorking')}</a>{landsAt ? ` ${landsAt}` : ''}
        </p>
      )}
      {onStopWaiting && <p className={s.leave}><Button variant="quiet" size="sm" onClick={onStopWaiting}>{stopWaitingLabel ?? t('progress.stopWaiting')}</Button></p>}
    </div>
  );
}

/**
 * One still line for a single wait ("Writing, 8 s"): a chat's turn, an app being made, a backup. The words stay put and
 * the time changes as text, never three dots and never a loop.
 */
export function WaitLine({ label, running = true, className }: { label: string; running?: boolean; className?: string | undefined }) {
  const started = useStartedAt(running);
  const elapsed = useElapsed(started, running);
  if (!running) return null;
  return <p className={className ?? s.line} role="status" data-wait-line="">{elapsed ? `${label}, ${elapsed}` : label}</p>;
}

/** A label with its elapsed time, for a button that says what it is doing ("Backing up, 8 s"). */
export function useWaitLabel(label: string, running: boolean): string {
  const started = useStartedAt(running);
  const elapsed = useElapsed(started, running);
  return running && elapsed ? `${label}, ${elapsed}` : label;
}
