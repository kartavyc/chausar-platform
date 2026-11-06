import { useRef, type ReactNode } from 'react';
import { cx } from './cx';
import { usePresence } from './motion';
import s from './RevealBlock.module.css';

/**
 * A block that opens in place (one-shot C3 task 7): a form under its button, a field under its row, a warning that
 * appears. Its height eases from nothing and its words fade over the sheet time; closing runs the other way over the
 * exit time, and it stays mounted (`data-open="false"`, inert) until that ends. At first render an open block is just
 * there, and with motion off it comes and goes at once. The one place a height moves, with the mini app frame.
 * (The file is RevealBlock because parts/reveal.ts already names a helper, and Windows folds the case of file names.)
 */
export function Reveal({ open, children, className }: { open: boolean; children: ReactNode; className?: string | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const { mounted, state } = usePresence(open, ref);
  if (!mounted) return null;
  const closing = state === 'closing';
  return (
    <div ref={ref} className={cx(s.reveal, className)} data-open={closing ? 'false' : 'true'} inert={closing}>
      <div className={s.inner}>{children}</div>
    </div>
  );
}
