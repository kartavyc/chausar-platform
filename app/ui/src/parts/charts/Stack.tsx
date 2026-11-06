import type { ReactNode } from 'react';
import s from './Charts.module.css';

export interface StackSegment {
  id: string;
  permille: number;
  /** The `data-*` attribute that colours the segment (`data-bucket`, `data-dept`). */
  attrs: Record<string, string>;
  /** The hover line: the segment's words and amount. The legend and the table say it too. */
  title: string;
}

/**
 * One thin bar split into segments (D's `.aging` and `.sbar`), on a 0 to 1000 scale. Each segment is nested inside the
 * one before it and moved along by that segment's own length, so the positions add up in the SVG, never in code. A
 * segment of 0 draws nothing. Segments after the first start with a 2 px gap in the ground colour, the same width at
 * any tile width.
 */
export function Stack({ segments, label, thin }: { segments: StackSegment[]; label: string; thin?: boolean | undefined }) {
  const shown = segments.filter((segment) => segment.permille > 0);
  const nested = shown.reduceRight<ReactNode>(
    (inner, segment, i) => (
      <g key={segment.id}>
        <rect className={s.seg} x="0" y="0" width={segment.permille} height="14" {...segment.attrs}>
          <title>{segment.title}</title>
        </rect>
        {i > 0 && <line className={s.gap} x1="0" x2="0" y1="0" y2="14" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        <g transform={`translate(${segment.permille} 0)`}>{inner}</g>
      </g>
    ),
    null,
  );
  return (
    <svg
      className={s.stack}
      data-size={thin ? 'thin' : undefined}
      viewBox="0 0 1000 14"
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      focusable="false"
    >
      {nested}
    </svg>
  );
}
