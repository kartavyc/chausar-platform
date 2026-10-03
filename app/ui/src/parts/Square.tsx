/**
 * Square: one of the seven marks. 8 pixels (10 in Simple), slightly rounded.
 * Always hidden from screen readers; the state is always also in words. The words are
 * rendered beside the square, visually hidden unless `showWords` is set, so a state is
 * never shown by colour alone.
 */

import type { Mark } from '../app/presentation.ts';
import { useT } from '../app/text';
import s from './Square.module.css';

export const MARK_WORDS: Readonly<Record<Mark, string>> = {
  cha: 'MARK.cha',
  you: 'MARK.you',
  wait: 'MARK.wait',
  busy: 'MARK.busy',
  unsure: 'MARK.unsure',
  guess: 'MARK.guess',
  off: 'MARK.off',
};

export interface SquareProps {
  mark: Mark;
  /** A text key for the words. Defaults to the mark's own words. */
  wordsKey?: string | undefined;
  /** Show the words beside the square instead of hiding them visually. */
  showWords?: boolean | undefined;
  className?: string | undefined;
}

export function Square({ mark, wordsKey, showWords = false, className }: SquareProps) {
  const t = useT();
  const words = t(wordsKey ?? MARK_WORDS[mark]);
  return (
    <>
      <span className={[s.square, s[mark], className].filter(Boolean).join(' ')} aria-hidden="true" />
      <span className={showWords ? s.words : 'sr'}>{words}</span>
    </>
  );
}
