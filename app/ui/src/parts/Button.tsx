import { useId, type ButtonHTMLAttributes, type Ref } from 'react';
import { useT } from '../text';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './Button.module.css';

/**
 * primary: the one filled button in a card or row (the accent), always last.
 * secondary: outlined. quiet: reads like a link. ink: a dark secondary (D's `.btn.ink`).
 * chat: the quiet "Chat" button beside an agent (D's `button.chat`); never a primary, and its `aria-label` must say
 * whose chat it opens.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'ink' | 'chat';

/** D's button heights: sm 30 (`--control-sm`), md 36 (`--control`), lg 44 (`--target`, big cards), xl 48
 *  (`--control-xl`, the next best step and every phone card). */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  /** Left out: md, or sm for the chat button. */
  size?: ButtonSize | undefined;
  /** Locked until the owner does something first (view before approve): `aria-disabled` with clicks ignored (it stays
   *  in the Tab order), the lock icon, "Locked" in its description, and the soft accent when it is the primary. It
   *  keeps `data-variant="primary"`, so it is still the card's one primary. */
  locked?: boolean | undefined;
  /** Why it is locked, as the button's title ("Unlocks after you watch it"). */
  lockedReason?: string | undefined;
  /** The id of the visible note line that says why it is locked, so a screen reader hears it with the button. */
  lockedNoteId?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function Button({
  variant = 'secondary', size, locked = false, lockedReason, lockedNoteId,
  className, type = 'button', ref, disabled, title, children, onClick, ...rest
}: ButtonProps) {
  const t = useT();
  const lockedId = useId();
  if (import.meta.env.DEV && variant === 'chat' && !rest['aria-label'] && !rest['aria-labelledby']) {
    throw new Error('A chat button needs an aria-label that says whose chat it opens, such as "Chat with Editor".');
  }
  const height = size ?? (variant === 'chat' ? 'sm' : 'md');
  const reason = lockedReason ?? t('button.locked');
  // Locked: "Locked." and the note line (or the reason when there is no note) join whatever it already describes.
  const describedBy = cx(rest['aria-describedby'], locked && lockedId, locked && lockedNoteId) || undefined;
  // A locked button is aria-disabled, not disabled, so it stays in the Tab order and can say why it is locked; a
  // click (or Enter, Space, a form submit) does nothing. Native `disabled` stays for a busy button.
  return (
    <>
      <button
        ref={ref}
        type={type}
        className={cx(s.button, s[variant], className)}
        data-variant={variant}
        data-size={height}
        data-locked={locked ? '' : undefined}
        aria-disabled={locked && !disabled ? true : undefined}
        disabled={disabled}
        title={locked ? reason : title}
        onClick={locked ? (event) => event.preventDefault() : onClick}
        {...rest}
        aria-describedby={describedBy}
      >
        {locked && <Icon name="lock" size={height === 'sm' ? 14 : 16} />}
        {variant === 'chat' && <Icon name="message-square" size={14} />}
        {children ?? (variant === 'chat' ? t('button.chat') : null)}
      </button>
      {locked && <span id={lockedId} hidden>{lockedNoteId ? t('button.lockedWord') : t('button.lockedWhy', { reason })}</span>}
    </>
  );
}
