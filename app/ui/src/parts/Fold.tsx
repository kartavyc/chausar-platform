import type { DetailsHTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './Fold.module.css';

export interface FoldProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, 'summary'> {
  /** The words that open it. They sit beside the chevron, each child its own item in the row. */
  summary: ReactNode;
  /** A fold that holds something that cannot be undone reads red, as Delete does. */
  tone?: 'danger' | undefined;
  summaryClassName?: string | undefined;
  summaryId?: string | undefined;
  'data-fold'?: string | undefined;
  ref?: Ref<HTMLDetailsElement> | undefined;
}

/**
 * The one disclosure: a native `details` with the app's chevron and plain dark words, never link blue. Every fold in the
 * app is this part; a place may add a class for its own spacing, never a colour. No animation here: the height motion
 * comes with the motion system.
 */
export function Fold({ summary, tone, summaryClassName, summaryId, className, children, ...rest }: FoldProps) {
  return (
    <details data-fold="" {...rest} className={cx(s.fold, className)}>
      <summary id={summaryId} className={cx(s.summary, summaryClassName)} data-tone={tone}>
        <span className={s.mark} data-fold-mark="" data-fold-chevron="" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
        {summary}
      </summary>
      {children}
    </details>
  );
}
