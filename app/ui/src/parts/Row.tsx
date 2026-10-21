import { useId, type ReactNode } from 'react';
import { cx } from './cx';
import s from './Row.module.css';

export interface RowProps {
  id: string;
  /** "Business · agent", in small grey type above the title. */
  eyebrow?: ReactNode;
  title: ReactNode;
  line?: ReactNode;
  /** Anything under the line: a change, a notice, an inline confirm. */
  children?: ReactNode;
  /** The row's buttons, right-aligned; the primary goes last. */
  actions?: ReactNode;
  /** Opening the row (Enter, or a click on the title) shows its detail in the sheet. */
  onOpen?: ((origin: HTMLElement) => void) | undefined;
  /** The primary needs a second confirm: keyboard A and D never act on this row. */
  secondAsk?: boolean;
  className?: string;
}

/**
 * One row in a list: a hairline above, no box. The row itself is focusable (J and K move between rows); its title
 * is the button that opens it. Lists of rows are <ul> elements.
 */
export function Row({ id, eyebrow, title, line, children, actions, onOpen, secondAsk, className }: RowProps) {
  const titleId = useId();
  return (
    <li className={cx(s.row, className)} data-row="" data-row-id={id} data-second-ask={secondAsk ? '' : undefined} tabIndex={-1} aria-labelledby={titleId}>
      <div className={s.body}>
        {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
        {onOpen ? (
          <button type="button" id={titleId} className={cx(s.title, s.titleButton)} data-open="" onClick={(event) => onOpen(event.currentTarget)}>
            {title}
          </button>
        ) : (
          <div id={titleId} className={s.title}>{title}</div>
        )}
        {line && <div className={s.line}>{line}</div>}
        {children}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
    </li>
  );
}
