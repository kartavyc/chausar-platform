import { useRef, type ReactNode } from 'react';
import { useLeaveEnd, type Drawn } from '../useLeaving';
import { motionOff } from '../motion';
import type { DrawnBlock } from './useLayout';
import motion from '../Leave.module.css';
import s from './Layout.module.css';

/** Keep a hidden block in its grid slot until its close ends; Undo grows it back there. */
export function MovingBlock({ row, left, children }: { row: Drawn<DrawnBlock>; left: (key: string) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLeaveEnd(ref, row.leaving, () => left(row.key));
  return <div ref={ref} className={`${motion.row} ${s.movingBlock}`} data-block={row.key}
    data-leaving={row.leaving ? '' : undefined} data-arriving={row.arriving && !motionOff() ? '' : undefined}
    inert={row.leaving} aria-hidden={row.leaving || undefined}>
    <div className={motion.inner}>{children}</div>
  </div>;
}
