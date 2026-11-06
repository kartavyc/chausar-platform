import type { ReactNode } from 'react';
import sLocal from './Stack.module.css';

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
  // Zero-width boxes draw nothing and keep their node so a later value can transition in place.
  const shown = segments;
  const nested = shown.reduceRight<ReactNode>(
    (inner, segment, i) => (
      <g key={segment.id}>
        <rect className={sLocal.seg} x="0" y="0" width={segment.permille} height="14" {...segment.attrs}>
          <title>{segment.title}</title>
        </rect>
        {segment.permille > 0 && shown.slice(0, i).some(before => before.permille > 0) && <line className={sLocal.gap} x1="0" x2="0" y1="0" y2="14" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
        <g className={sLocal.offset} transform={`translate(${segment.permille} 0)`}>{inner}</g>
      </g>
    ),
    null,
  );
  return (
    <svg
      className={sLocal.stack}
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
