import { cx } from './cx';
import { ICONS, type IconName } from './icons';
import s from './Icon.module.css';

/** The D icon sizes: `.i12` to `.i22`, and 18 for a plain `.i`. */
export type IconSize = 12 | 14 | 16 | 18 | 20 | 22;

export interface IconProps {
  name: IconName;
  size?: IconSize | undefined;
  /** Give a label only when the icon alone carries meaning; it then reads as an image with that name. Most icons sit
   *  beside words that already say it, so they stay hidden from screen readers. */
  label?: string | undefined;
  /** Draw it solid (D's `.fill`), as the play mark on a video preview is. */
  filled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * One Lucide icon from the allowlist in `icons.ts`, drawn with the D stroke (1.75) in the current text colour.
 * The size is an svg attribute and `data-size`, never a style.
 */
export function Icon({ name, size = 18, label, filled, className }: IconProps) {
  const Glyph = ICONS[name];
  const a11y = label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label };
  return (
    <Glyph
      size={size}
      strokeWidth={1.75}
      focusable="false"
      className={cx(s.icon, className)}
      data-size={size}
      data-filled={filled ? '' : undefined}
      {...a11y}
    />
  );
}
