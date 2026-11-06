import { useT, type T } from '../text';
import type { RunSummary } from '../engine/types';
import { cx } from './cx';
import s from './ProgressRing.module.css';

/** Measured steps from the engine, or `indeterminate` when it cannot count them yet. */
export type StepProgress = NonNullable<RunSummary['progress']>;

/** What the run is doing: working (the accent), waiting on the owner (amber) or stopped (red). */
export type ProgressTone = 'working' | 'waiting' | 'failed';

/** The steps when they can be shown as a count: a total of 0 (or less) is no step count, never "0 of 0". */
export function measuredSteps(progress: StepProgress): { done: number; total: number } | null {
  return progress === 'indeterminate' || progress.total <= 0 ? null : progress;
}

/**
 * The words a progress ring or bar is named by: "3 of 5 steps done", "2 of 3 steps done, waiting on you",
 * "Working, no step count yet". The counts are the engine's; nothing is worked out from them.
 */
export function progressLabel(t: T, progress: StepProgress, tone: ProgressTone = 'working'): string {
  const steps = measuredSteps(progress);
  if (!steps) {
    return t(tone === 'waiting' ? 'ring.indeterminateWaiting' : tone === 'failed' ? 'ring.indeterminateFailed' : 'ring.indeterminate');
  }
  const values = { done: steps.done, total: steps.total, count: steps.total };
  return t(tone === 'waiting' ? 'ring.stepsWaiting' : tone === 'failed' ? 'ring.stepsFailed' : 'ring.steps', values);
}

export interface ProgressRingProps {
  progress: StepProgress;
  tone?: ProgressTone | undefined;
  className?: string | undefined;
}

/**
 * D's `.pring`: a 40 px ring that fills by steps done, with "3/5" in the middle (past 9 steps only the steps done fit,
 * so the hole shows "10" and the name still says "10 of 12 steps done"). The arc is drawn by SVG attributes alone:
 * `pathLength` is the step total and the dash is "done total", so the UI never divides anything. Unmeasured work is
 * a still quarter arc with three dots and no numbers; nothing spins.
 */
export function ProgressRing({ progress, tone = 'working', className }: ProgressRingProps) {
  const t = useT();
  const steps = measuredSteps(progress);
  return (
    <span className={cx(s.ring, className)} role="img" aria-label={progressLabel(t, progress, tone)} data-tone={tone}>
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
        <circle className={s.track} cx="20" cy="20" r="16" fill="none" strokeWidth="4" />
        {steps ? (
          steps.done > 0 && (
            <circle
              className={s.arc}
              data-arc=""
              cx="20"
              cy="20"
              r="16"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength={steps.total}
              strokeDasharray={`${steps.done} ${steps.total}`}
              transform="rotate(-90 20 20)"
            />
          )
        ) : (
          <>
            <circle
              className={s.arc}
              data-arc=""
              cx="20"
              cy="20"
              r="16"
              fill="none"
              strokeWidth="4"
              strokeLinecap="round"
              pathLength={4}
              strokeDasharray="1 4"
              transform="rotate(30 20 20)"
            />
            <circle className={s.dot} data-dot="" cx="15" cy="20" r="1.5" />
            <circle className={s.dot} data-dot="" cx="20" cy="20" r="1.5" />
            <circle className={s.dot} data-dot="" cx="25" cy="20" r="1.5" />
          </>
        )}
      </svg>
      {steps && (
        <b className={cx(s.label, 'mono')} data-label="" aria-hidden="true">
          {steps.total > 9 ? steps.done : `${steps.done}/${steps.total}`}
        </b>
      )}
    </span>
  );
}
