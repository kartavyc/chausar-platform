import { useId, type ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { PendingLink } from './Provenance';
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
  /** D's leading mark: an `Avatar` (size 32) or a `StatusMark`. Both are hidden from screen readers, so the words in
   *  the row must say the state too. */
  mark?: ReactNode;
  /** D's `.lr-p`: a short progress bar with its words, or a receipt, between the words and the buttons. */
  aside?: ReactNode;
  /** D's `.lr-e`: a time or duration at the far end, in DM Mono. */
  end?: ReactNode;
  /** D's `.lrow.ev`: 52 px instead of 60, for lists of past events. */
  dense?: boolean | undefined;
  /** The row's link has no address yet: a disabled "link not ready yet" sits with the actions (catalogue U17). */
  linkPending?: boolean | undefined;
  className?: string;
}

/**
 * One row in a list, D's `.lrow`: at least 60 px, a soft line between rows, an optional mark (avatar or status
 * circle), the title and its sub line, then the aside, the buttons and the end time. The row itself is focusable (J
 * and K move between rows); its title is the button that opens it. Lists of rows are <ul> elements.
 */
export function Row({ id, eyebrow, title, line, children, actions, onOpen, secondAsk, mark, aside, end, dense, linkPending, className }: RowProps) {
  const titleId = useId();
  return (
    <li
      className={cx(s.row, className)}
      data-row=""
      data-row-id={id}
      data-second-ask={secondAsk ? '' : undefined}
      data-dense={dense ? '' : undefined}
      data-tall={children ? '' : undefined}
      tabIndex={-1}
      aria-labelledby={titleId}
    >
      {mark && <span className={s.lead}>{mark}</span>}
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
      {aside && <div className={s.aside}>{aside}</div>}
      {(actions || linkPending) && <div className={s.actions}>{linkPending && <PendingLink />}{actions}</div>}
      {end && <span className={cx(s.end, 'mono')}>{end}</span>}
    </li>
  );
}

/** What a status circle says, by its icon as well as its colour: done, not done, a question, a model estimate, a
 *  failure. */
export type StatusTone = 'ok' | 'no' | 'question' | 'estimate' | 'fail';

const STATUS_ICONS: Readonly<Record<StatusTone, IconName>> = {
  ok: 'check',
  no: 'x',
  question: 'circle-help',
  estimate: 'trending-up',
  fail: 'triangle-alert',
};

/**
 * D's status circle (`.sic`): a 28 px circle with an icon, the leading mark of a past-event row. It is decorative
 * (`aria-hidden`); the row's words say what happened.
 */
export function StatusMark({ tone }: { tone: StatusTone }) {
  return (
    <span className={s.mark} data-tone={tone} aria-hidden="true">
      <Icon name={STATUS_ICONS[tone]} size={14} />
    </span>
  );
}
