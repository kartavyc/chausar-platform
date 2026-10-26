import { useT } from '../text';
import { Icon } from './Icon';
import type { IconName } from './icons';
import type { RunStep, RunSummary } from '../engine/types';
import s from './Steps.module.css';

const WORD: Record<RunStep['state'], string> = { done: 'steps.done', current: 'steps.current', pending: 'steps.pending', waiting: 'steps.waiting', failed: 'steps.failed' };

/** The icon inside a mark. The current step is a still arc and a pending one an empty dashed circle, so no two
 *  states share a shape: colour never carries a state alone (D-TeamDept `.tick`, `.spin`, `.pend-dot`; D-Work `.xk`). */
const MARK_ICON: Partial<Record<RunStep['state'], IconName>> = { done: 'check', waiting: 'clock', failed: 'x' };

export interface StepsProps {
  steps: RunStep[];
  /** Per-stage progress from the engine. Unmeasured progress says "indeterminate"; nothing pretends with a bar. */
  progress?: RunSummary['progress'] | undefined;
  /** Fold each step's tool lines under it. */
  showTools?: boolean;
}

/** The current step: a quarter arc on a ring, drawn once and never turning (nothing loops). */
function StillArc() {
  return (
    <svg className={s.arc} data-arc="" viewBox="0 0 20 20" width="20" height="20" focusable="false" aria-hidden="true">
      <circle className={s.arcTrack} cx="10" cy="10" r="7.5" fill="none" />
      <path className={s.arcPart} d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5" fill="none" />
    </svg>
  );
}

/**
 * A run's steps, named by purpose, each with a mark: done a check on the soft accent with its time, current a still
 * arc and bold words, pending a dashed circle in grey, waiting a clock and amber words, failed an x with the engine's
 * error under it. The marks are hidden from screen readers; the words say each state.
 */
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
          {steps.map((step) => {
            const icon = MARK_ICON[step.state];
            return (
              <li key={step.id} className={s[step.state]} data-state={step.state}>
                <div className={s.line}>
                  <span className={s.mark} aria-hidden="true" data-mark={step.state}>
                    {step.state === 'current' ? <StillArc /> : icon ? <Icon name={icon} size={12} /> : null}
                  </span>
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
            );
          })}
        </ol>
      )}
    </div>
  );
}
