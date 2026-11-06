import { useT } from '../text';
import { cx } from './cx';
import { measuredSteps, progressLabel, type ProgressTone, type StepProgress } from './ProgressRing';
import s from './ProgressBar.module.css';

/** Up to this many steps the bar draws one segment per step; past it, segments get too thin to read. */
export const MOST_SEGMENTS = 12;

export interface ProgressBarProps {
  progress: StepProgress;
  tone?: ProgressTone | undefined;
  /** Show "3 of 5" beside the bar (default). Leave it out when the place says the count itself. */
  showCount?: boolean | undefined;
  className?: string | undefined;
}

/**
 * D's `.pbar`. Up to 12 steps it is one segment per step with the done ones filled; past that it is one svg whose
 * viewBox is the step total and whose fill rect is as wide as the steps done, stretched to the bar. Either way the
 * length is the engine's own counts as SVG or DOM attributes: nothing is divided or sized in code. Unmeasured work
 * (or a total of 0) is one still segment, "No step count yet"; it never moves. The bar is an image named in words;
 * the count beside it is for the eye.
 */
export function ProgressBar({ progress, tone = 'working', showCount = true, className }: ProgressBarProps) {
  const t = useT();
  const steps = measuredSteps(progress);
  // Unmeasured and working is "No step count yet"; waiting or stopped says that as well, as the ring does.
  const label = steps || tone !== 'working' ? progressLabel(t, progress, tone) : t('bar.indeterminate');
  return (
    <span className={cx(s.bar, className)} data-tone={tone}>
      <span className={s.track} role="img" aria-label={label}>
        {!steps ? (
          <span className={s.segment} data-segment="" data-still="" />
        ) : steps.total > MOST_SEGMENTS ? (
          <svg className={s.long} viewBox={`0 0 ${steps.total} 1`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <rect className={s.rest} data-track="" x="0" y="0" width={steps.total} height="1" />
            {steps.done > 0 && <rect className={s.fill} data-done="" x="0" y="0" width={steps.done} height="1" />}
          </svg>
        ) : (
          Array.from({ length: steps.total }, (_, step) => (
            <span key={step} className={s.segment} data-segment="" data-filled={step < steps.done ? '' : undefined} />
          ))
        )}
      </span>
      {steps && showCount && (
        <span className={cx(s.count, 'mono')} data-label="" data-count="" aria-hidden="true">
          {t('bar.count', { done: steps.done, total: steps.total })}
        </span>
      )}
    </span>
  );
}
