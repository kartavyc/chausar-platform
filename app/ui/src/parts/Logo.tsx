import { useT } from '../text';
import { cx } from './cx';
import s from './Logo.module.css';

export interface LogoProps {
  /** `plain`: the ink square and the accent square, for light and dark pages alike (ink follows the theme).
   *  `in-avatar`: the mark inside the Chausar avatar's selected square, so its first square takes the colour on
   *  selected and inverts with the theme. */
  variant?: 'plain' | 'in-avatar' | undefined;
  /** Side of the mark in px (an svg attribute). The rail draws it at 22. */
  size?: number | undefined;
  /** Add the lowercase "chausar" wordmark after the mark. */
  wordmark?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Chausar's logo: two rounded squares on a diagonal (inside.chausar.co.in), the second in the accent, and the
 * lowercase wordmark. The mark is decorative (`aria-hidden`); the link or heading around it carries the name.
 * Its colours are the `--fg`, `--on-selected` and `--accent` tokens, never literals.
 */
export function Logo({ variant = 'plain', size = 22, wordmark = false, className }: LogoProps) {
  const t = useT();
  const mark = (
    // The class goes on the mark when it stands alone, and on the wrapper when the wordmark is beside it.
    <svg className={cx(s.mark, !wordmark && className)} width={size} height={size} viewBox="0 0 37 37" aria-hidden="true" focusable="false">
      <rect className={variant === 'in-avatar' ? s.firstInAvatar : s.first} x="0" y="0" width="18" height="18" rx="4.5" />
      <rect className={s.second} x="19" y="19" width="18" height="18" rx="4.5" />
    </svg>
  );
  if (!wordmark) return mark;
  return (
    <span className={cx(s.logo, className)}>
      {mark}
      <span className={s.word}>{t('logo.wordmark')}</span>
    </span>
  );
}
