import { useId, type ButtonHTMLAttributes, type Ref } from 'react';
import { useT } from '../text';
import { cx } from './cx';
import { Icon } from './Icon';
import { SwapWords } from './Swap';
import { motionOff } from './motion';
import { useOldCopy, useSwapped } from './Swap';
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
  /** One-shot B4: why it can't be pressed yet. Given, the button is `disabled` and the reason is printed under it, tied
   *  by `aria-describedby`. Left out (or empty), it follows `disabled` alone, as a busy button does. */
  disabledReason?: string | undefined;
  /** One-shot B4: it destroys or stops something. Red words on an outline, never the accent fill. */
  tone?: 'danger' | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

export function Button({
  variant = 'secondary', size, locked = false, lockedReason, lockedNoteId, disabledReason, tone,
  className, type = 'button', ref, disabled, title, children, onClick, ...rest
}: ButtonProps) {
  const t = useT();
  const lockedId = useId();
  const reasonId = useId();
  const { old: wasLocked, gen, clear } = useSwapped(locked, locked);
  const leavingLock = !locked && wasLocked === true && !motionOff();
  const lockRef = useOldCopy(gen, leavingLock, clear);
  if (import.meta.env.DEV && variant === 'chat' && !rest['aria-label'] && !rest['aria-labelledby']) {
    throw new Error('A chat button needs an aria-label that says whose chat it opens, such as "Chat with Editor".');
  }
  const height = size ?? (variant === 'chat' ? 'sm' : 'md');
  const reason = lockedReason ?? t('button.locked');
  // Locked: "Locked." and the note line (or the reason when there is no note) join whatever it already describes.
  const describedBy = cx(rest['aria-describedby'], locked && lockedId, locked && lockedNoteId, disabledReason && reasonId) || undefined;
  const off = disabled || Boolean(disabledReason);
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
        data-tone={tone}
        data-locked={locked ? '' : undefined}
        aria-disabled={locked && !off ? true : undefined}
        disabled={off}
        title={locked ? reason : title}
        onClick={locked ? (event) => event.preventDefault() : onClick}
        {...rest}
        aria-describedby={describedBy}
      >
        {(locked || leavingLock) && <span ref={lockRef} className={s.lock} aria-hidden="true" data-lock-leaving={leavingLock ? '' : undefined}><Icon name="lock" size={height === 'sm' ? 14 : 16} /></span>}
        {variant === 'chat' && <Icon name="message-square" size={14} />}
        {/* One-shot C3 task 8: a label that changes (Save to Saved) fades in place; at rest the text stands alone. */}
        {typeof children === 'string' ? <SwapWords>{children}</SwapWords> : children ?? (variant === 'chat' ? t('button.chat') : null)}
      </button>
      {locked && <span id={lockedId} hidden>{lockedNoteId ? t('button.lockedWord') : t('button.lockedWhy', { reason })}</span>}
      {disabledReason && <span id={reasonId} className={s.reason} data-disabled-reason="">{disabledReason}</span>}
    </>
  );
}
