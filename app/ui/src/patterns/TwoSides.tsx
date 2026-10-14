/**
 * TwoSides: two columns that are never merged. Each side has its own heading and its own
 * label (measured beside guess, as known then beside as known now, the meaning in use
 * beside the meaning tried on a copy). Nothing is drawn across the two. Under a narrow
 * width the second side moves under the first; each keeps its heading and label.
 */

import { useId, type ReactNode } from 'react';
import type { StatementLabel } from '../app/presentation.ts';
import { Label } from '../parts/Label';
import s from './TwoSides.module.css';

export interface Side {
  /** The side's heading, already localised. */
  heading: string;
  /** The fixed word that says what kind of statement this side is. */
  label?: StatementLabel | undefined;
  children: ReactNode;
}

export interface TwoSidesProps {
  /** What the comparison is about, for screen readers. */
  title: string;
  left: Side;
  right: Side;
  className?: string | undefined;
}

function SideColumn({ side, which }: { side: Side; which: 'left' | 'right' }) {
  const id = useId();
  return (
    <section className={[s.side, s[which]].join(' ')} aria-labelledby={id} data-side={which}>
      <h3 id={id} className={s.heading}>
        {side.heading}
        {side.label !== undefined && <Label kind={side.label} className={s.label} />}
      </h3>
      <div className={s.body}>{side.children}</div>
    </section>
  );
}

export function TwoSides({ title, left, right, className }: TwoSidesProps) {
  return (
    <div className={[s.wrap, className].filter(Boolean).join(' ')} role="group" aria-label={title}>
      <div className={s.sides}>
        <SideColumn side={left} which="left" />
        <SideColumn side={right} which="right" />
      </div>
    </div>
  );
}
