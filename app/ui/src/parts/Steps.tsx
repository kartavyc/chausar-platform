import { useT } from '../text';
import type { RunStep, RunSummary } from '../engine/types';
import s from './Steps.module.css';

const MARK: Record<RunStep['state'], string> = { done: '✓', current: '○', pending: '○', waiting: '○', failed: '✕' };
const WORD: Record<RunStep['state'], string> = { done: 'steps.done', current: 'steps.current', pending: 'steps.pending', waiting: 'steps.waiting', failed: 'steps.failed' };

export interface StepsProps {
  steps: RunStep[];
  /** Per-stage progress from the engine. Unmeasured progress says "indeterminate"; nothing pretends with a bar. */
  progress?: RunSummary['progress'] | undefined;
  /** Fold each step's tool lines under it. */
  showTools?: boolean;
}

/** A run's steps, named by purpose: ✓ done with its time, ○ current in ink, pending in grey, waiting in amber. */
export function Steps({ steps, progress, showTools = false }: StepsProps) {
  const t = useT();
  return (
    <div className={s.wrap}>
      {progress !== undefined && (
        <p className={s.progress}>
          {progress === 'indeterminate' ? t('steps.indeterminate') : t('steps.progress', { done: progress.done, total: progress.total })}
        </p>
      )}
      {steps.length > 0 && (
        <ol className={s.steps} aria-label={t('steps.list')}>
          {steps.map((step) => (
            <li key={step.id} className={s[step.state]} data-state={step.state}>
              <div className={s.line}>
                <span className={s.mark} aria-hidden="true">{MARK[step.state]}</span>
                <span className={s.purpose}>
                  {step.purpose}
                  {step.state !== 'waiting' && <span className="sr-only">, {t(WORD[step.state])}{step.audited ? `, ${t('steps.audited')}` : ''}</span>}
                </span>
                {step.state === 'waiting' ? (
                  <span className={s.waitWord}>{t('steps.waiting')}</span>
                ) : step.elapsed ? (
                  <span className={`${s.time} mono`}>{step.elapsed}</span>
                ) : null}
              </div>
              {step.error && <p className={s.error}>{step.error}</p>}
              {showTools && step.tools && step.tools.length > 0 && (
                <details className={s.tools}>
                  <summary>{t('steps.tools', { count: step.tools.length })}</summary>
                  {step.tools.map((tool, i) => (
                    <p key={i} className={s.tool}>
                      <span className="mono">{tool.name}</span> {tool.line}
                    </p>
                  ))}
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
