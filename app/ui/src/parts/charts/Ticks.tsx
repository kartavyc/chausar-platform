import { UPRIGHT, raise } from './plot';
import type { ChartTick } from './types';
import s from './Charts.module.css';

/**
 * The level labels to the left of a plot (D's y axis words), drawn at their per mille heights through the plot's own
 * transform. The gutter is as wide as the longest label in DM Mono characters (`ch`), plus one for air, so a long
 * amount fits without measuring anything; the labels end at its right edge.
 */
export function Gutter({ ticks, height, up }: { ticks: ChartTick[]; height: number; up: string }) {
  const longest = ticks.reduce((most, tick) => Math.max(most, tick.label.length), 0);
  return (
    <svg className={s.gutter} data-gutter="" width={`${longest + 1}ch`} height={height} focusable="false">
      <g transform={up}>
        {ticks.map((tick) => (
          <g key={tick.permille} transform={raise(tick.permille)}>
            <text className={s.tick} data-tick="" transform={UPRIGHT} x="100%" dx="-6" y="4" textAnchor="end">{tick.label}</text>
          </g>
        ))}
      </g>
    </svg>
  );
}
