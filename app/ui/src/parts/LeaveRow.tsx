import { useRef, type ReactNode } from 'react';
import { cx } from './cx';
import { staggerClass, useLeaveEnd, type Drawn } from './useLeaving';
import s from './Leave.module.css';

/**
 * One row of a list that lets things leave and arrive (one-shot C3 task 13): give it a row from `useLeavingList` and that
 * list's `left`. Leaving, it is hidden from readers and out of the Tab order, fades and slips, then its height closes;
 * arriving, it fades and rises, staggered for the first five when `place` is given. `flipId` lets it slide when the list
 * reorders (parts/flip.ts). With motion off every time here is 0 and a leaving row is gone at once.
 */
export function LeaveRow<T>({ row, left, place, flipId, className, children }: {
  row: Drawn<T>; left: (key: string) => void; place?: number | undefined; flipId?: string | undefined; className?: string | undefined; children: ReactNode;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useLeaveEnd(ref, row.leaving, () => left(row.key));
  const stagger = row.arriving && place !== undefined ? staggerClass(place) : undefined;
  return (
    <li
      ref={ref} className={cx(s.row, stagger && s[stagger], className)} data-leaving={row.leaving ? '' : undefined} data-arriving={row.arriving ? '' : undefined}
      data-flip-id={flipId} inert={row.leaving} aria-hidden={row.leaving ? true : undefined}
    >
      <div className={s.inner}>{children}</div>
    </li>
  );
}
