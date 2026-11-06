import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { paint, svgId } from './plot';
import type { GoalBarData } from './types';
import s from './Charts.module.css';

export type GoalBarTone = 'dark' | 'light';

export interface GoalBarProps {
  data: GoalBarData;
  /** `dark` on the dark goal card (D's `.g-bar`, the default); `light` on a white tile (D's `.gb` on Money). */
  tone?: GoalBarTone | undefined;
}

/**
 * The goal bar: money invoiced this month toward the owner's goal (before tax), the part ready to issue striped after
 * it, and a thin marker at today's pace. Everything is per mille of the goal on a 0 to 1000 viewBox, so the browser
 * scales it and nothing is divided. The bar is one image named by the engine's sentence. The pace marker is drawn in
 * a second layer that may reach past the bar's edges, as D's does.
 */
export function GoalBar({ data, tone = 'dark' }: GoalBarProps) {
  const stripes = svgId(useId(), 'ready');
  const pace = data.pacePermille;
  return (
    <div className={s.goalBar} data-tone={tone} role="img" aria-label={data.label}>
      <svg className={s.goalTrack} viewBox="0 0 1000 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={stripes} patternUnits="userSpaceOnUse" width="12" height="12" patternTransform="rotate(45)">
            <rect className={s.goalStripe} x="0" y="0" width="5" height="12" />
          </pattern>
        </defs>
        <rect className={s.goalGround} x="0" y="0" width="1000" height="14" />
        <rect className={s.goalFill} data-part="invoiced" x="0" y="0" width={data.invoicedPermille} height="14" />
        {data.readyPermille > 0 && (
          <>
            <rect className={s.goalFill} data-part="ready" x={data.invoicedPermille} y="0" width={data.readyPermille} height="14" />
            <rect data-part="ready-stripes" x={data.invoicedPermille} y="0" width={data.readyPermille} height="14" fill={paint(stripes)} />
          </>
        )}
      </svg>
      <svg className={s.goalPace} viewBox="0 0 1000 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <line className={s.paceGround} x1={pace} x2={pace} y1="-3.5" y2="17.5" strokeWidth="7" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        <line className={s.paceMark} data-part="pace" x1={pace} x2={pace} y1="-3.5" y2="17.5" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

export interface GoalBarKeyProps {
  /** The amount ready to issue, as a `Figure` with its receipt. Left out, the key has no "Ready to issue" item. */
  ready?: ReactNode;
  tone?: GoalBarTone | undefined;
}

/** The goal bar's key (D's `.g-legend`): Invoiced, Ready to issue with its figure, and Today's pace. */
export function GoalBarKey({ ready, tone = 'dark' }: GoalBarKeyProps) {
  const t = useT();
  const stripes = svgId(useId(), 'key');
  return (
    <ul className={s.goalKey} data-tone={tone}>
      <li className={s.key}>
        <svg className={s.keySwatch} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
          <rect className={s.goalFill} width="10" height="10" rx="3" />
        </svg>
        {t('chart.goal.invoiced')}
      </li>
      {ready !== undefined && (
        <li className={s.key}>
          <svg className={s.keySwatch} width="10" height="10" viewBox="0 0 10 10" aria-hidden="true" focusable="false">
            <defs>
              <pattern id={stripes} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
                <rect className={s.goalStripe} x="0" y="0" width="2" height="4" />
              </pattern>
            </defs>
            <rect className={s.goalFill} width="10" height="10" rx="3" />
            <rect width="10" height="10" rx="3" fill={paint(stripes)} />
          </svg>
          {t('chart.goal.ready')}
          {ready}
        </li>
      )}
      <li className={s.key}>
        <svg className={s.keySwatch} width="3" height="12" viewBox="0 0 3 12" aria-hidden="true" focusable="false">
          <rect className={s.paceSwatch} width="3" height="12" rx="1" />
        </svg>
        {t('chart.goal.pace')}
      </li>
    </ul>
  );
}
