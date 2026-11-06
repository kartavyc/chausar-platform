import type { DeptId } from '../icons';
import s from './Charts.module.css';

export interface MiniBarsProps {
  /** Each bar's height, per mille of the tallest the engine scaled to. The last bar is the current one. */
  heights: number[];
  /** The engine's sentence that reads the bars. Left out, the bars are decoration beside a figure that already says
   *  the number, so they are hidden from screen readers. */
  label?: string | undefined;
  /** A department's own colour: its solid for the current bar and its panel line for the rest. */
  dept?: DeptId | undefined;
  /** Whether the last bar is "now" (weeks). Bars that are not a time line (one per department, W4 4A2) have none. */
  current?: boolean | undefined;
}

/**
 * The small bars in a stat tile (D's "Done this week" bars, 80 by 32): 8 px bars 4 px apart, the current one in chart
 * ink and the rest in the lighter grey. Heights stay per mille in the markup; the group scales them to 32 px (1000 per
 * mille is 32 px, so the 2 px rounded top that Charts.module.css clips is 62.5 per mille tall). No heights, no bars.
 */
export function MiniBars({ heights, label, dept, current = true }: MiniBarsProps) {
  if (heights.length === 0) return null;
  const last = current ? heights.length - 1 : -1;
  const a11y = label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  return (
    <svg className={s.mini} data-dept={dept} width={heights.length * 12 - 4} height="32" focusable="false" {...a11y}>
      <g transform="matrix(1 0 0 -0.032 0 32)">
        {heights.map((height, i) => (
          <rect key={i} className={s.miniBar} data-current={i === last ? '' : undefined} x={i * 12} y="0" width="8" height={height} />
        ))}
      </g>
    </svg>
  );
}
