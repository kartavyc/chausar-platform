import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './InlineError.module.css';

export interface InlineFix {
  label: string;
  onSelect: () => void;
  /** The fix is on its way: the button waits and says so. */
  busy?: boolean | undefined;
}

export interface InlineErrorProps {
  /** The one short line. Red for a real failure. */
  children: ReactNode;
  /** The long reason after the line, in the normal colour and whole. */
  detail?: string | undefined;
  /** `expected`: a known state (no AI yet, a permission still to give), in muted words with a small amber icon. */
  tone?: 'failure' | 'expected' | undefined;
  /** The one thing that fixes it, right in the line. */
  fix?: InlineFix | undefined;
  /** For a control this line describes (`aria-describedby`). */
  id?: string | undefined;
  className?: string | undefined;
}

/**
 * An error in the slot of the card or button that failed, never a line under the whole page (B4 task 4, SCREENS P11).
 * It carries the fix as a button when there is one, is red only for a real failure, and long words wrap: nothing cuts
 * them. The line alone is the live region, so its words read the same with or without a fix. The words are the
 * caller's: this part only says where they show.
 */
export function InlineError({ children, detail, tone = 'failure', fix, id, className }: InlineErrorProps) {
  return (
    <div className={cx(s.inline, className)} data-inline-error="">
      <p id={id} className={s.line} data-tone={tone} role={tone === 'failure' ? 'alert' : 'status'}>
        <Icon name="triangle-alert" size={14} />
        <span className={s.words}>
          {children}
          {detail && <>{' '}<span className={s.detail} data-detail="">{detail}</span></>}
        </span>
      </p>
      {fix && <Button size="sm" disabled={fix.busy} aria-busy={fix.busy || undefined} onClick={fix.onSelect}>{fix.label}</Button>}
    </div>
  );
}
