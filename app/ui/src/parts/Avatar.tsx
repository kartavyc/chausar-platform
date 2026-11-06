import { cx } from './cx';
import { Icon } from './Icon';
import { DEPT_ICONS, type DeptId } from './icons';
import { Logo } from './Logo';
import s from './Avatar.module.css';

export type { DeptId } from './icons';

/** The D avatar sizes (`av24` to `av52`, and 60 for a story). */
export type AvatarSize = 24 | 28 | 32 | 36 | 40 | 52 | 60;

/** What the ring says. Idle draws no ring. The ring is shape and colour only: the words beside it always say the
 *  state too, since a ring is hidden from screen readers and below 3:1 on white. */
export type AvatarState = 'working' | 'waiting' | 'failed' | 'idle';

const LETTER = /[\p{L}\p{N}]/u;

/** One grapheme segmenter for every avatar, made once. Without Intl.Segmenter, code points stand in. */
const SEGMENTER = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function graphemes(text: string): string[] {
  return SEGMENTER ? Array.from(SEGMENTER.segment(text), (part) => part.segment) : Array.from(text);
}

/**
 * Two initials for a name, drawn locally: the first letter of each of the first two words ("Meera Joshi" MJ), or the
 * first two letters of a single word ("Editor" ED). Only letters and digits count, so punctuation is skipped
 * ("O'Neil" ON, "J.R." JR) and a word without any ("&") is no word. Each initial is a whole grapheme cluster, so a
 * Devanagari vowel sign or conjunct stays with its letter ("राहुल मेहता" रामे). Each is uppercased on its own and keeps
 * only its first grapheme, so a letter that grows ("ß" to "SS") still gives two at most. Nothing to take gives "?".
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/)
    .map((word) => graphemes(word).filter((part) => LETTER.test(part)))
    .filter((letters) => letters.length > 0);
  const [first, second] = words;
  if (!first) return '?';
  const picked = second ? [first[0]!, second[0]!] : first.slice(0, 2);
  return picked.map((letter) => graphemes(letter.toLocaleUpperCase())[0]!).join('');
}

export interface AvatarProps {
  /** The agent's, client's or person's name; the avatar shows its initials. */
  name: string;
  /** The department tint. Left out, the avatar sits on the neutral wash (`data-dept="none"`). */
  dept?: DeptId | undefined;
  state?: AvatarState | undefined;
  /** Draw the department's icon on a small solid badge (stories). Only drawn when `dept` is given. */
  badge?: boolean | undefined;
  size?: AvatarSize | undefined;
  className?: string | undefined;
}

/**
 * An agent, client or person as initials in a rounded square on their department's tint, with a status ring.
 * It is decorative (`aria-hidden`): the name and the state are always also in words beside it. No image is ever
 * loaded for it and nothing is fetched. The ring's inner gap is the ground under the avatar, `--ring-ground`, which
 * the container sets (surface on tiles, the inner grey on inner cards, the tint on a department panel).
 */
export function Avatar({ name, dept, state, badge = false, size = 36, className }: AvatarProps) {
  return (
    <span
      className={cx(s.avatar, className)}
      aria-hidden="true"
      data-dept={dept ?? 'none'}
      data-state={state && state !== 'idle' ? state : undefined}
      data-size={size}
    >
      {initialsOf(name)}
      {badge && dept && (
        <span className={s.badge} data-badge="" data-dept={dept}>
          <Icon name={DEPT_ICONS[dept]} size={12} />
        </span>
      )}
    </span>
  );
}

/**
 * Chausar itself as an avatar (the chief of staff's story and thread, W4 4C): the mark on the selected ground, with
 * the same ring states as an agent.
 */
export function ChausarAvatar({ state, size = 36, className }: Pick<AvatarProps, 'state' | 'size' | 'className'>) {
  return (
    <span
      className={cx(s.avatar, s.chausar, className)}
      aria-hidden="true"
      data-chausar=""
      data-dept="none"
      data-state={state && state !== 'idle' ? state : undefined}
      data-size={size}
    >
      {/* The mark is sized by the avatar's CSS (half its side), so nothing is computed here. */}
      <Logo variant="in-avatar" />
    </span>
  );
}
