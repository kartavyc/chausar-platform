import { useT } from '../text';
import { cx } from './cx';
import s from './StrengthDots.module.css';

/** How well the owner knows someone, 0 (no signals yet) to 5 (close), as code worked it out from weighted signals
 *  that fade over time (spec 5.5, W4 4D). The UI only draws it. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4 | 5;

const TOTAL = 5;
const DOTS = [1, 2, 3, 4, 5] as const;

export interface StrengthDotsProps {
  level: StrengthLevel;
  /** Opens the receipt of how the owner knows them: each signal and its source. Left out, the dots are a picture. */
  onOpen?: (() => void) | undefined;
  className?: string | undefined;
}

/**
 * Relationship strength as five dots and a word (D's `.str` and `.dots`). The dots are hidden from screen readers;
 * the name says the word and the level. With `onOpen` it is a button that opens how you know them.
 */
export function StrengthDots({ level, onOpen, className }: StrengthDotsProps) {
  const t = useT();
  const word = t(`strength.level.${level}`);
  const values = { word: word.toLocaleLowerCase(), level, total: TOTAL };
  const content = (
    <>
      <span className={s.dots} aria-hidden="true">
        {DOTS.map((dot) => <span key={dot} className={s.dot} data-dot="" data-filled={dot <= level ? '' : undefined} />)}
      </span>
      <span aria-hidden={onOpen ? undefined : 'true'}>{word}</span>
    </>
  );
  if (!onOpen) {
    return <span className={cx(s.strength, className)} role="img" aria-label={t('strength.label', values)}>{content}</span>;
  }
  return (
    <button type="button" className={cx(s.strength, s.open, className)} aria-label={t('strength.open', values)} onClick={onOpen}>
      {content}
    </button>
  );
}
