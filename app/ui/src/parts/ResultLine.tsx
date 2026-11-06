import type { ComponentPropsWithoutRef } from 'react';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './ResultLine.module.css';

export interface ResultLineProps extends ComponentPropsWithoutRef<'p'> {
  /** `problem`: a refusal, in red and said at once. Left out, a result: a small check beside the words. */
  tone?: 'done' | 'problem' | undefined;
}

/**
 * One line's height kept for a result ("Saved", "Shared", a refusal), there before anything is pressed, so the words
 * arrive without pushing down what follows (B4 task 5, SCREENS P12). No text, no mark and nothing said.
 */
export function ResultLine({ tone = 'done', children, className, ...rest }: ResultLineProps) {
  const filled = children !== undefined && children !== null && children !== false && children !== '';
  return (
    <p {...rest} className={cx(s.slot, className)} data-result-line="" data-tone={tone} role={tone === 'problem' ? 'alert' : 'status'}>
      {filled && tone === 'done' && <Icon name="check" size={14} />}
      {filled && <span className={s.words}>{children}</span>}
    </p>
  );
}
